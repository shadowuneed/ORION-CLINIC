import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { hashAccessAuditEvent } from '@/lib/audit/access-event-hash';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import {
  AccessAuditUnavailableError,
  AccessAuditRequestConflictError,
  D1AccessAuditRepository,
} from './access-audit';

type TestBoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
};

const databases: DatabaseSync[] = [];

function applyMigrations(target: DatabaseSync, includeWorkspaceAudit = true) {
  target.exec('pragma foreign_keys = on');
  for (const fileName of readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql') && (includeWorkspaceAudit || !name.startsWith('0046_')))
    .sort()) {
    target.exec(
      readFileSync(join('drizzle', fileName), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
  }
}

function d1Result<T>(results: T[], changes = 0) {
  return { success: true, results, meta: { changes } } as unknown as D1Result<T>;
}

function createD1Adapter(target: DatabaseSync, beforeBatch?: () => void): D1Database {
  const prepareBound = (
    sql: string,
    bindings: SQLInputValue[] = [],
  ): TestBoundStatement => ({
    sql,
    bindings,
    bind(...values: unknown[]) {
      return prepareBound(sql, values as SQLInputValue[]) as unknown as D1PreparedStatement;
    },
    async first<T = unknown>(columnName?: string) {
      const row = target.prepare(sql).get(...bindings) as
        | Record<string, T>
        | undefined;
      if (!row) return null;
      return columnName ? row[columnName] ?? null : (row as T);
    },
    async all<T = unknown>() {
      return d1Result(target.prepare(sql).all(...bindings) as T[]);
    },
    async run<T = unknown>() {
      const result = target.prepare(sql).run(...bindings);
      return d1Result<T>([], Number(result.changes));
    },
    async raw<T = unknown>() {
      return target
        .prepare(sql)
        .all(...bindings)
        .map((row) => Object.values(row as Record<string, unknown>)) as T[];
    },
  });

  return {
    prepare(sql: string) {
      return prepareBound(sql) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      beforeBatch?.();
      target.exec('begin immediate');
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) {
          const bound = statement as unknown as TestBoundStatement;
          results.push(
            /^\s*(select|pragma|with)\b/i.test(bound.sql)
              ? await bound.all<T>()
              : await bound.run<T>(),
          );
        }
        target.exec('commit');
        return results;
      } catch (error) {
        target.exec('rollback');
        throw error;
      }
    },
    async exec(query: string) {
      target.exec(query);
      return { count: 0, duration: 0 };
    },
    withSession() {
      throw new Error('Sessions are not used by this repository test');
    },
    dump() {
      throw new Error('Dump is not used by this repository test');
    },
  } as unknown as D1Database;
}

function scope(): WorkspaceScope {
  return {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    encounterId: 'encounter-a',
    reviewerMembershipId: 'membership-a',
    accessAssignmentId: 'access-assignment-a-general-medicine',
    accessPermission: 'encounter.read',
  };
}

function createFixture(beforeBatch?: (database: DatabaseSync) => void, includeWorkspaceAudit = true) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database, includeWorkspaceAudit);
  database.exec(readFileSync('db/seed.local.sql', 'utf8'));
  database.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const d1 = createD1Adapter(database, () => beforeBatch?.(database));
  return {
    database,
    repository: new D1AccessAuditRepository(d1, scope()),
  };
}

function addReadyArtifact(database: DatabaseSync) {
  database.exec(`
    insert into protocol_versions (
      id, organization_id, facility_id, encounter_id, version, status,
      content_json, source_hash, created_by_membership_id, created_at
    ) values (
      'access-protocol-v1', 'org-a', 'fac-a', 'encounter-a', 1, 'draft',
      '{}', '${'a'.repeat(64)}', 'membership-a', 1788250000000
    );
    insert into protocol_heads (
      id, organization_id, facility_id, encounter_id,
      current_protocol_version_id, lock_version, updated_at
    ) values (
      'access-protocol-head', 'org-a', 'fac-a', 'encounter-a',
      'access-protocol-v1', 1, 1788250000000
    );
    insert into protocol_versions (
      id, organization_id, facility_id, encounter_id, version, status,
      content_json, source_hash, created_by_membership_id,
      signed_by_membership_id, signed_at, supersedes_protocol_version_id,
      created_at
    ) values (
      'access-protocol-v2', 'org-a', 'fac-a', 'encounter-a', 2, 'signed',
      '{}', '${'a'.repeat(64)}', 'membership-a', 'membership-a',
      1788250001000, 'access-protocol-v1', 1788250001000
    );
    update protocol_heads
    set current_protocol_version_id = 'access-protocol-v2',
      current_signed_protocol_version_id = 'access-protocol-v2',
      lock_version = 2, updated_at = 1788250001000
    where id = 'access-protocol-head';
    insert into document_artifacts (
      id, organization_id, facility_id, encounter_id, protocol_version_id,
      kind, object_key, mime_type, sha256, byte_size, status,
      created_by_membership_id, created_at
    ) values (
      'access-document', 'org-a', 'fac-a', 'encounter-a',
      'access-protocol-v2', 'protocol_pdf', 'synthetic/access.pdf',
      'application/pdf', '${'b'.repeat(64)}', 12, 'ready',
      'membership-a', 1788250000000
    );
  `);
  database.exec("update encounters set status='review', version=version+1 where id='encounter-a'");
  database.exec("update encounters set status='finalized', version=version+1, ended_at=1788250001000 where id='encounter-a'");
}

function changeSelectedAccess(database: DatabaseSync, patch: Record<string, SQLInputValue>) {
  const current = database.prepare(`select version.* from department_access_assignment_versions version
    join department_access_assignment_heads head on head.current_version_id=version.id
    where head.assignment_id=?`).get(scope().accessAssignmentId!)!;
  const now = Date.now();
  const successor = { ...current, id: crypto.randomUUID(), version: Number(current.version) + 1,
    supersedes_version_id: current.id, changed_at: now, created_at: now, ...patch };
  const columns = Object.keys(successor);
  database.prepare(`insert into department_access_assignment_versions (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`)
    .run(...columns.map(key => successor[key as keyof typeof successor] as SQLInputValue));
  database.prepare(`update department_access_assignment_heads set current_version_id=?, lock_version=lock_version+1,
    updated_at=? where assignment_id=?`).run(successor.id, now, scope().accessAssignmentId!);
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('access audit repository', () => {
  const artifact = { id: 'access-document', kind: 'protocol_pdf' as const };

  it('requires the selected read assignment and the exact user for workspace reads', async () => {
    const { database } = createFixture();
    for (const selected of [undefined, 'wrong-assignment']) {
      const repository = new D1AccessAuditRepository(createD1Adapter(database), { ...scope(), accessAssignmentId: selected });
      await expect(repository.recordWorkspaceRead({ actorId: 'user-a', requestId: crypto.randomUUID() }))
        .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    }
    await expect(new D1AccessAuditRepository(createD1Adapter(database), scope())
      .recordWorkspaceRead({ actorId: 'user-b', requestId: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as n from access_audit_stream_heads').get()?.n).toBe(0);
  });

  it('does not replay workspace receipts under another valid assignment or after revocation', async () => {
    const { database, repository } = createFixture();
    const input = { actorId: 'user-a', requestId: crypto.randomUUID() };
    const first = await repository.recordWorkspaceRead(input);
    expect(await repository.recordWorkspaceRead(input)).toEqual(first);
    database.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    const other = new D1AccessAuditRepository(createD1Adapter(database), { ...scope(), accessAssignmentId: 'access-assignment-a-secondary' });
    await expect(other.recordWorkspaceRead(input)).rejects.toBeInstanceOf(AccessAuditRequestConflictError);
    changeSelectedAccess(database, { status: 'revoked' });
    await expect(repository.recordWorkspaceRead(input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    await expect(other.recordWorkspaceRead({ ...input, requestId: crypto.randomUUID() })).resolves.toMatchObject({ action: 'workspace.read' });
  });

  it.each([
    { deny_permissions_json: '["encounter.read"]' },
    { effective_until: Date.now() - 10000 },
    { roles_json: '["nurse"]' },
  ] as Record<string, SQLInputValue>[])('denies current workspace access with %j', async patch => {
    const { database, repository } = createFixture();
    changeSelectedAccess(database, patch);
    await expect(repository.recordWorkspaceRead({ actorId: 'user-a', requestId: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as n from access_audit_events').get()?.n).toBe(0);
  });

  it('allows a doctor read assignment even when the legacy role is registrar and manage is denied', async () => {
    const { database, repository } = createFixture();
    database.exec("update memberships set role='registrar' where id='membership-a'");
    changeSelectedAccess(database, { deny_permissions_json: '["encounter.manage"]' });
    await expect(repository.recordWorkspaceRead({ actorId: 'user-a', requestId: crypto.randomUUID() }))
      .resolves.toMatchObject({ action: 'workspace.read' });
  });

  it('rolls back workspace audit on selected-assignment revocation immediately before the batch', async () => {
    const { database, repository } = createFixture(db => changeSelectedAccess(db, { status: 'revoked' }));
    await expect(repository.recordWorkspaceRead({ actorId: 'user-a', requestId: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as n from access_audit_events').get()?.n).toBe(0);
    expect(database.prepare('select last_sequence from access_audit_stream_heads').get()?.last_sequence).toBe(0);
  });

  it('rolls back workspace events if stream-head publication was skipped', async () => {
    const { database, repository } = createFixture();
    database.exec('create trigger skip_workspace_head before update on access_audit_stream_heads begin select raise(ignore); end');
    await expect(repository.recordWorkspaceRead({ actorId: 'user-a', requestId: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(AccessAuditUnavailableError);
    expect(database.prepare('select count(*) as n from access_audit_events').get()?.n).toBe(0);
  });

  it('SQL refuses new legacy, unattributed and incorrectly attributed workspace events', async () => {
    const { database, repository } = createFixture();
    await repository.recordWorkspaceRead({ actorId: 'user-a', requestId: crypto.randomUUID() });
    const row = database.prepare('select * from access_audit_events').get()!;
    const columns = Object.keys(row);
    for (const patch of [{ access_assignment_id: null }, { schema_version: 1 }, { access_assignment_id: 'unknown' },
      { outcome: 'denied' }, { response_status: 403 }, { decision_code: 'unverified' }]) {
      const candidate = { ...row, id: crypto.randomUUID(), request_id: crypto.randomUUID(), sequence: 2,
        previous_hash: row.event_hash, event_hash: 'c'.repeat(64), ...patch };
      expect(() => database.prepare(`insert into access_audit_events (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`)
        .run(...columns.map(key => candidate[key as keyof typeof candidate] as SQLInputValue)))
        .toThrow('workspace audit requires current selected assignment');
    }
    expect(database.prepare('select count(*) as n from access_audit_events').get()?.n).toBe(1);
  });

  it('preserves historical v1 bytes and chains a v2 event without allowing legacy receipt replay', async () => {
    const source = createFixture();
    const requestId = crypto.randomUUID();
    await source.repository.recordWorkspaceRead({ actorId: 'user-a', requestId });
    const row = source.database.prepare('select * from access_audit_events').get()!;
    const legacyHash = await hashAccessAuditEvent({ previousHash: null, organizationId: 'org-a', facilityId: 'fac-a',
      streamKey: 'membership:membership-a', sequence: 1, actorUserId: 'user-a', actorMembershipId: 'membership-a',
      actorRole: 'clinician', action: 'workspace.read', outcome: 'succeeded', purposeCode: 'synthetic_direct_patient_care',
      routeCode: 'workspace', decisionCode: 'authorized_response_prepared', responseStatus: 200, encounterId: 'encounter-a',
      documentArtifactId: null, artifactKind: null, requestId, schemaVersion: 1, occurredAt: Number(row.occurred_at) });
    const old = createFixture(undefined, false);
    old.database.exec(`insert into access_audit_stream_heads (id,organization_id,facility_id,stream_key,actor_membership_id)
      values ('legacy-head','org-a','fac-a','membership:membership-a','membership-a')`);
    const legacy = { ...row, schema_version: 1, access_assignment_id: null, event_hash: legacyHash };
    const columns = Object.keys(legacy);
    old.database.prepare(`insert into access_audit_events (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`)
      .run(...columns.map(key => legacy[key as keyof typeof legacy] as SQLInputValue));
    old.database.prepare(`update access_audit_stream_heads set last_sequence=1,last_event_hash=?,lock_version=2 where id='legacy-head'`)
      .run(legacyHash);
    old.database.exec(readFileSync('drizzle/0046_workspace_read_assignment.sql', 'utf8').replaceAll('--> statement-breakpoint', ''));
    expect(old.database.prepare('select * from access_audit_events where id=?').get(row.id)).toEqual(legacy);
    await expect(old.repository.recordWorkspaceRead({ actorId: 'user-a', requestId })).rejects.toBeInstanceOf(AccessAuditRequestConflictError);
    await old.repository.recordWorkspaceRead({ actorId: 'user-a', requestId: crypto.randomUUID() });
    expect(old.database.prepare('select schema_version,previous_hash from access_audit_events where sequence=2').get())
      .toEqual({ schema_version: 2, previous_hash: legacyHash });
  });

  it('rejects missing/read-denied assignment and wrong actors before creating an audit stream', async () => {
    const { database } = createFixture();
    addReadyArtifact(database);
    for (const selected of [undefined, 'wrong-assignment']) {
      const repository = new D1AccessAuditRepository(createD1Adapter(database), { ...scope(), accessAssignmentId: selected });
      await expect(repository.recordDocumentDownload(artifact, { actorId: 'user-a', requestId: crypto.randomUUID() }))
        .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    }
    const repository = new D1AccessAuditRepository(createD1Adapter(database), scope());
    await expect(repository.recordDocumentDownload(artifact, { actorId: 'user-b', requestId: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as count from access_audit_stream_heads').get()).toEqual({ count: 0 });
  });

  it('checks current rights on same-request replay and rejects another selected assignment', async () => {
    const { database, repository } = createFixture();
    addReadyArtifact(database);
    const input = { actorId: 'user-a', requestId: crypto.randomUUID() };
    const first = await repository.recordDocumentDownload(artifact, input);
    expect(await repository.recordDocumentDownload(artifact, input)).toEqual(first);
    database.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    const second = new D1AccessAuditRepository(createD1Adapter(database), { ...scope(), accessAssignmentId: 'access-assignment-a-secondary' });
    await expect(second.recordDocumentDownload(artifact, input)).rejects.toBeInstanceOf(AccessAuditRequestConflictError);
    database.exec("update memberships set status='disabled' where id='membership-a'");
    await expect(repository.recordDocumentDownload(artifact, input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as count from access_audit_events').get()).toEqual({ count: 1 });
  });

  it('rolls back the event and leaves the stream at genesis after pre-batch revocation', async () => {
    const { database, repository } = createFixture(db => db.exec("update memberships set status='disabled' where id='membership-a'"));
    addReadyArtifact(database);
    await expect(repository.recordDocumentDownload(artifact, { actorId: 'user-a', requestId: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as count from access_audit_events').get()).toEqual({ count: 0 });
    expect(database.prepare('select last_sequence from access_audit_stream_heads').get()).toEqual({ last_sequence: 0 });
  });

  it('uses the current doctor assignment rather than the legacy membership role', async () => {
    const { database, repository } = createFixture();
    addReadyArtifact(database);
    database.exec("update memberships set role='registrar' where id='membership-a'");
    await expect(repository.recordDocumentDownload(artifact, { actorId: 'user-a', requestId: crypto.randomUUID() })).resolves.toMatchObject({ action: 'document.download' });
  });

  it('rolls back a successfully inserted event when the head update is skipped', async () => {
    const { database, repository } = createFixture();
    addReadyArtifact(database);
    database.exec('create trigger test_skip_access_head before update on access_audit_stream_heads begin select raise(ignore); end');
    await expect(repository.recordDocumentDownload(artifact, { actorId: 'user-a', requestId: crypto.randomUUID() }))
      .rejects.toBeInstanceOf(AccessAuditUnavailableError);
    expect(database.prepare('select count(*) as count from access_audit_events').get()).toEqual({ count: 0 });
    expect(database.prepare('select last_sequence from access_audit_stream_heads').get()).toEqual({ last_sequence: 0 });
  });

  it('SQL rejects missing attribution, legacy download schema and a wrong selected assignment', async () => {
    const { database, repository } = createFixture();
    addReadyArtifact(database);
    await repository.recordDocumentDownload(artifact, { actorId: 'user-a', requestId: crypto.randomUUID() });
    const row = database.prepare('select * from access_audit_events').get()!;
    const columns = Object.keys(row);
    for (const patch of [{ access_assignment_id: null }, { schema_version: 1 }, { access_assignment_id: 'unknown' }]) {
      const candidate = { ...row, id: crypto.randomUUID(), request_id: crypto.randomUUID(), sequence: 2,
        previous_hash: row.event_hash, event_hash: 'c'.repeat(64), ...patch };
      expect(() => database.prepare(`insert into access_audit_events (${columns.join(',')}) values (${columns.map(() => '?').join(',')})`)
        .run(...columns.map(key => candidate[key as keyof typeof candidate] as SQLInputValue))).toThrow('download audit requires current selected assignment');
    }
    expect(database.prepare('select count(*) as count from access_audit_events').get()).toEqual({ count: 1 });
  });

  it('appends a PHI-minimized workspace-read event and advances the actor head', async () => {
    const { database, repository } = createFixture();

    const receipt = await repository.recordWorkspaceRead({
      actorId: 'user-a',
      requestId: 'request-workspace-a',
    });
    const event = database
      .prepare('select * from access_audit_events')
      .get() as Record<string, string | number | null>;
    const head = database
      .prepare('select * from access_audit_stream_heads')
      .get() as Record<string, string | number | null>;

    expect(receipt).toEqual({
      action: 'workspace.read',
      recordedAt: event.occurred_at,
    });
    expect(event).toMatchObject({
      organization_id: 'org-a',
      facility_id: 'fac-a',
      stream_key: 'membership:membership-a',
      sequence: 1,
      actor_user_id: 'user-a',
      actor_membership_id: 'membership-a',
      actor_role: 'clinician',
      action: 'workspace.read',
      outcome: 'succeeded',
      schema_version: 2,
      access_assignment_id: scope().accessAssignmentId,
      purpose_code: 'synthetic_direct_patient_care',
      route_code: 'workspace',
      decision_code: 'authorized_response_prepared',
      response_status: 200,
      encounter_id: 'encounter-a',
      document_artifact_id: null,
      artifact_kind: null,
      request_id: 'request-workspace-a',
    });
    expect(Object.keys(event)).not.toContain('metadata_json');
    expect(head).toMatchObject({
      stream_key: 'membership:membership-a',
      last_sequence: 1,
      last_event_hash: event.event_hash,
      lock_version: 2,
    });
    expect(event.event_hash).toBe(
      await hashAccessAuditEvent({
        previousHash: null,
        organizationId: 'org-a',
        facilityId: 'fac-a',
        streamKey: 'membership:membership-a',
        sequence: 1,
        actorUserId: 'user-a',
        actorMembershipId: 'membership-a',
        actorRole: 'clinician',
        action: 'workspace.read',
        outcome: 'succeeded',
        purposeCode: 'synthetic_direct_patient_care',
        routeCode: 'workspace',
        decisionCode: 'authorized_response_prepared',
        responseStatus: 200,
        encounterId: 'encounter-a',
        documentArtifactId: null,
        artifactKind: null,
        requestId: 'request-workspace-a',
        schemaVersion: 2,
        accessAssignmentId: scope().accessAssignmentId,
        occurredAt: Number(event.occurred_at),
      }),
    );
  });

  it('returns the same receipt on internal replay and chains a new request', async () => {
    const { database, repository } = createFixture();
    const input = { actorId: 'user-a', requestId: 'request-replay' };

    const first = await repository.recordWorkspaceRead(input);
    const replay = await repository.recordWorkspaceRead(input);
    await repository.recordWorkspaceRead({
      actorId: 'user-a',
      requestId: 'request-next',
    });
    const events = database
      .prepare(
        'select sequence, previous_hash, event_hash from access_audit_events order by sequence',
      )
      .all() as Array<Record<string, string | number | null>>;

    expect(replay).toEqual(first);
    expect(events).toHaveLength(2);
    expect(events[0]?.sequence).toBe(1);
    expect(events[1]?.sequence).toBe(2);
    expect(events[1]?.previous_hash).toBe(events[0]?.event_hash);
  });

  it('fails closed after the clinician membership is disabled', async () => {
    const { database, repository } = createFixture();
    database.exec("update memberships set status = 'disabled' where id = 'membership-a'");

    await expect(
      repository.recordWorkspaceRead({
        actorId: 'user-a',
        requestId: 'request-disabled',
      }),
    ).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(
      database.prepare('select count(*) as count from access_audit_events').get(),
    ).toEqual({ count: 0 });
  });

  it('records a ready current document without copying storage metadata', async () => {
    const { database, repository } = createFixture();
    addReadyArtifact(database);

    await repository.recordDocumentDownload(
      { id: 'access-document', kind: 'protocol_pdf' },
      { actorId: 'user-a', requestId: 'request-document' },
    );
    const event = database
      .prepare('select * from access_audit_events')
      .get() as Record<string, string | number | null>;

    expect(event).toMatchObject({
      action: 'document.download',
      access_assignment_id: scope().accessAssignmentId,
      schema_version: 2,
      encounter_id: 'encounter-a',
      document_artifact_id: 'access-document',
      artifact_kind: 'protocol_pdf',
    });
    expect(JSON.stringify(event)).not.toContain('synthetic/access.pdf');
    expect(JSON.stringify(event)).not.toContain('application/pdf');
    expect(JSON.stringify(event)).not.toContain('bbbbbbbb');
  });

  it('enforces append-only events and immutable stream heads in SQLite', async () => {
    const { database, repository } = createFixture();
    await repository.recordWorkspaceRead({
      actorId: 'user-a',
      requestId: 'request-immutable',
    });

    expect(() =>
      database.exec("update access_audit_events set decision_code = 'changed'"),
    ).toThrow(/append-only/);
    expect(() => database.exec('delete from access_audit_events')).toThrow(
      /append-only/,
    );
    expect(() => database.exec('delete from access_audit_stream_heads')).toThrow(
      /cannot be deleted/,
    );
  });
});
