import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { hashAccessAuditEvent } from '@/lib/audit/access-event-hash';
import {
  AccessAuditUnavailableError,
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

function applyMigrations(target: DatabaseSync) {
  target.exec('pragma foreign_keys = on');
  for (const fileName of readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
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

function createD1Adapter(target: DatabaseSync): D1Database {
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
  };
}

function createFixture() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  database.exec(readFileSync('db/seed.local.sql', 'utf8'));
  const d1 = createD1Adapter(database);
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
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('access audit repository', () => {
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
        schemaVersion: 1,
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
    ).rejects.toBeInstanceOf(AccessAuditUnavailableError);
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
