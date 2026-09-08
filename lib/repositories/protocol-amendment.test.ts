import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import type { SignedProtocolContent } from '@/lib/documents/protocol-artifacts';
import { D1DocumentExportRepository, DocumentExportConflictError } from './document-export';
import { exportArtifactKinds } from '@/lib/documents/protocol-artifacts';
import { exportPrefix } from '@/lib/documents/export-reconciliation';
import {
  D1ProtocolAmendmentRepository,
  ProtocolAmendmentConflictError,
  ProtocolAmendmentConsentRequiredError,
  ProtocolAmendmentSourceChangedError,
} from './protocol-amendment';

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
  return {
    success: true,
    results,
    meta: { changes },
  } as unknown as D1Result<T>;
}

function createD1Adapter(target: DatabaseSync, afterRead?: (sql: string, database: DatabaseSync) => void, beforeBatch?: () => void): D1Database {
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
      const row = target.prepare(sql).get(...bindings) as Record<string, T> | undefined;
      afterRead?.(sql, target);
      if (!row) return null;
      if (columnName) return row[columnName] ?? null;
      return row as T;
    },
    async all<T = unknown>() {
      return d1Result(target.prepare(sql).all(...bindings) as T[]);
    },
    async run<T = unknown>() {
      const result = target.prepare(sql).run(...bindings);
      return d1Result<T>([], Number(result.changes));
    },
    async raw<T = unknown>() {
      return target.prepare(sql).all(...bindings).map((row) =>
        Object.values(row as Record<string, unknown>),
      ) as T[];
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
          results.push(
            await (statement as unknown as TestBoundStatement).run<T>(),
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

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function signedContent(encounterId: string): SignedProtocolContent {
  const sectionCodes: SignedProtocolContent['sections'][number]['code'][] = [
    'complaints',
    'history_of_present_illness',
    'past_medical_history',
    'allergy_status',
    'objective_findings',
    'preliminary_diagnosis',
    'examination_plan',
    'treatment_plan',
  ];
  return {
    schemaVersion: 1,
    dataMode: 'synthetic-only',
    encounter: {
      id: encounterId,
      sourceVersion: 2,
      reasonForVisit: 'Синтетический сценарий проверки',
      startedAt: 1_000,
      endedAt: 2_000,
    },
    patient: {
      medicalRecordNumber: 'SYN-AMEND-001',
      displayName: 'Синтетический пациент',
      birthDate: null,
      sexAtBirth: 'not_recorded',
    },
    clinicianMembershipId: 'membership-a',
    sections: sectionCodes.map((code, index) => ({
      sourceVersionId: `section-${index + 1}`,
      code,
      version: 1,
      content: `Проверенный синтетический раздел ${index + 1}`,
      reviewState: 'reviewed',
      reviewedByMembershipId: 'membership-a',
      reviewedAt: 2_000,
    })),
    recommendations: [],
    transcript: {
      included: false,
      consentEventId: null,
      segments: [],
    },
    amendments: [],
  };
}

async function createFixture(options?: {
  careDecision?: 'granted' | 'denied';
  invalidSourceHash?: boolean;
  afterRead?: (sql: string, database: DatabaseSync) => void;
  beforeBatch?: () => void;
}) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  const now = Date.now() - 10_000;
  database.exec(`
    insert into organizations (id, name) values ('org-a', 'Clinic A');
    insert into organizations (id, name) values ('org-b', 'Clinic B');
    insert into facilities (id, organization_id, name)
      values ('fac-a', 'org-a', 'Facility A');
    insert into facilities (id, organization_id, name)
      values ('fac-b', 'org-b', 'Facility B');
    insert into users (id, external_issuer, external_subject, display_name, status)
      values ('user-a', 'openai:sites', 'doctor-a', 'Doctor A', 'active');
    insert into users (id, external_issuer, external_subject, display_name, status)
      values ('user-b', 'openai:sites', 'doctor-b', 'Doctor B', 'active');
    insert into memberships (
      id, organization_id, facility_id, user_id, role, status
    ) values ('membership-a', 'org-a', 'fac-a', 'user-a', 'clinician', 'active');
    insert into memberships (
      id, organization_id, facility_id, user_id, role, status
    ) values ('membership-b', 'org-b', 'fac-b', 'user-b', 'clinician', 'active');
    insert into patients (
      id, organization_id, facility_id, medical_record_number, display_name
    ) values ('patient-a', 'org-a', 'fac-a', 'SYN-AMEND-001', 'Synthetic A');
  `);
  database
    .prepare(`
      insert into encounters (
        id, organization_id, facility_id, patient_id, clinician_membership_id,
        status, reason_for_visit, started_at, ended_at, finalized_at, version,
        created_at, updated_at
      ) values (
        'encounter-a', 'org-a', 'fac-a', 'patient-a', 'membership-a',
        'finalized', 'Synthetic amendment test', 1000, 2000, ?1, 3, ?2, ?1
      )
    `)
    .run(now - 1_000, now - 5_000);

  const contentJson = JSON.stringify(signedContent('encounter-a'));
  const sourceHash = options?.invalidSourceHash
    ? '0'.repeat(64)
    : await sha256(contentJson);
  database
    .prepare(`
      insert into protocol_versions (
        id, organization_id, facility_id, encounter_id, version, status,
        content_json, source_hash, created_by_membership_id, created_at
      ) values (
        'protocol-v1', 'org-a', 'fac-a', 'encounter-a', 1, 'draft',
        ?1, ?2, 'membership-a', ?3
      )
    `)
    .run(contentJson, sourceHash, now - 4_000);
  database
    .prepare(`
      insert into protocol_heads (
        id, organization_id, facility_id, encounter_id,
        current_protocol_version_id, lock_version, updated_at
      ) values (
        'protocol-head-a', 'org-a', 'fac-a', 'encounter-a',
        'protocol-v1', 1, ?1
      )
    `)
    .run(now - 4_000);
  database
    .prepare(`
      insert into protocol_versions (
        id, organization_id, facility_id, encounter_id, version, status,
        content_json, source_hash, created_by_membership_id,
        signed_by_membership_id, signed_at, supersedes_protocol_version_id,
        created_at
      ) values (
        'protocol-v2', 'org-a', 'fac-a', 'encounter-a', 2, 'signed',
        ?1, ?2, 'membership-a', 'membership-a', ?3, 'protocol-v1', ?3
      )
    `)
    .run(contentJson, sourceHash, now - 2_000);
  database
    .prepare(`
      update protocol_heads
      set current_protocol_version_id = 'protocol-v2',
        current_signed_protocol_version_id = 'protocol-v2',
        lock_version = 2, updated_at = ?1
      where id = 'protocol-head-a'
    `)
    .run(now - 2_000);
  database
    .prepare(`
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at, created_at
      ) values (
        'care-v1', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 1,
        'care', ?1, 'membership-a', 'synthetic-test-v1', ?2,
        'ru', 'verbal', ?3, ?3, ?3
      )
    `)
    .run(options?.careDecision ?? 'granted', 'a'.repeat(64), now - 3_000);
  database
    .prepare(`
      insert into consent_heads (
        id, organization_id, facility_id, patient_id, encounter_id,
        consent_type, current_consent_event_id, lock_version, created_at, updated_at
      ) values (
        'care-head-a', 'org-a', 'fac-a', 'patient-a', 'encounter-a',
        'care', 'care-v1', 1, ?1, ?1
      )
    `)
    .run(now - 3_000);
  database.exec(`
    insert into audit_stream_heads (
      id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
    ) values ('audit-head-a', 'org-a', 'fac-a', 0, null, 1);
  `);

  database.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const scope: WorkspaceScope = {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    encounterId: 'encounter-a',
    reviewerMembershipId: 'membership-a',
    accessAssignmentId: 'access-assignment-a-general-medicine',
    accessPermission: 'encounter.manage',
  };
  const d1 = createD1Adapter(database, options?.afterRead, options?.beforeBatch);
  return {
    database,
    d1,
    scope,
    repository: new D1ProtocolAmendmentRepository(
      d1,
      scope,
    ),
  };
}

function command(overrides?: Partial<Parameters<D1ProtocolAmendmentRepository['amend']>[0]>) {
  return {
    baseProtocolId: 'protocol-v2',
    expectedProtocolVersion: 2,
    expectedProtocolHeadVersion: 2,
    expectedEncounterVersion: 3,
    reason: 'Уточнение после личной проверки врача',
    text: 'Подписанное синтетическое дополнение к протоколу.',
    idempotencyKey: crypto.randomUUID(),
    actorId: 'user-a',
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('signed export repository authorization', () => {
  const exportCommand = () => ({ protocolId: 'protocol-v2', protocolVersion: 2,
    idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID(),
    artifacts: exportArtifactKinds.map(kind => ({ kind, filename: `${kind}.fixture`,
      objectKey: `synthetic-export-test/${kind}.fixture`, mimeType: 'application/octet-stream',
      sha256: 'a'.repeat(64), byteSize: 10 })) });

  it('allows a read scope to read signed source but not generate exports', async () => {
    const { d1, scope } = await createFixture();
    const repository = new D1DocumentExportRepository(d1, { ...scope, accessPermission: 'encounter.read' }, 'user-a');
    expect((await repository.getSignedSource()).protocol.id).toBe('protocol-v2');
    await expect(repository.recordGenerated(exportCommand())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  const cleanupCommand = (scope: WorkspaceScope) => {
    const input = exportCommand();
    const prefix = `${exportPrefix(scope, input.protocolId, input.protocolVersion)}/attempt-${crypto.randomUUID()}`;
    return { ...input, manifestKey: `${prefix}/manifest.json`,
      artifacts: input.artifacts.map(a => ({ ...a, objectKey: `${prefix}/${a.filename}` })) };
  };

  it('permanently fences all five keys before a delayed publication can commit', async () => {
    const { database, d1, scope } = await createFixture();
    const repository = new D1DocumentExportRepository(d1, scope, 'user-a');
    const input = cleanupCommand(scope);
    expect(await repository.fenceUnpublishedAttempt(input)).toBe(true);
    expect(await repository.fenceUnpublishedAttempt(input)).toBe(true);
    await expect(repository.recordGenerated(input)).rejects.toThrow('fenced');
    expect(database.prepare('select count(*) as n from document_artifacts').get()?.n).toBe(0);
    expect(database.prepare('select count(*) as n from export_cleanup_fences').get()?.n).toBe(5);
    expect(database.prepare('select count(*) as n from audit_events').get()?.n).toBe(0);
    expect(() => database.exec('delete from export_cleanup_fences')).toThrow('permanent');
    expect(() => database.exec("update export_cleanup_fences set request_id='changed'")).toThrow('permanent');
  });

  it('retains a committed package instead of fencing any of its files', async () => {
    const { database, d1, scope } = await createFixture();
    const repository = new D1DocumentExportRepository(d1, scope, 'user-a');
    const input = cleanupCommand(scope);
    await repository.recordGenerated(input);
    expect(await repository.fenceUnpublishedAttempt(input)).toBe(false);
    expect(database.prepare('select count(*) as n from export_cleanup_fences').get()?.n).toBe(0);
    expect((await repository.listCurrentArtifacts())).toHaveLength(5);
  });

  it('rolls back every fence when a publisher commits after the preflight reference check', async () => {
    const { database, scope } = await createFixture();
    const input = cleanupCommand(scope);
    // A committed legacy artifact represents the competing publisher at the batch boundary.
    let fired = false;
    const d1 = createD1Adapter(database, undefined, () => {
      if (fired) return; fired = true;
      const a = input.artifacts[4];
      database.prepare(`insert into document_artifacts (id,organization_id,facility_id,encounter_id,
        protocol_version_id,kind,object_key,mime_type,sha256,byte_size,status,created_by_membership_id)
        values ('raced','org-a','fac-a','encounter-a','protocol-v2',?,?,?,?,?,'ready','membership-a')`)
        .run(a.kind, a.objectKey, a.mimeType, a.sha256, a.byteSize);
    });
    await expect(new D1DocumentExportRepository(d1, scope, 'user-a').fenceUnpublishedAttempt(input)).rejects.toThrow('referenced');
    expect(database.prepare('select count(*) as n from export_cleanup_fences').get()?.n).toBe(0);
    expect(database.prepare('select count(*) as n from document_artifacts').get()?.n).toBe(1);
  });

  it('rolls back cleanup after revocation between authorization and batch', async () => {
    const { database, scope } = await createFixture();
    const d1 = createD1Adapter(database, undefined, () => database.exec("update memberships set status='disabled' where id='membership-a'"));
    await expect(new D1DocumentExportRepository(d1, scope, 'user-a').fenceUnpublishedAttempt(cleanupCommand(scope))).rejects.toThrow('current assignment');
    expect(database.prepare('select count(*) as n from export_cleanup_fences').get()?.n).toBe(0);
  });

  it('fails atomically if a fence insert was silently skipped', async () => {
    const { database, d1, scope } = await createFixture();
    const input = cleanupCommand(scope);
    database.exec(`create trigger test_skip_cleanup before insert on export_cleanup_fences
      when NEW.object_key like '%bundle_zip.fixture' begin select raise(ignore); end`);
    await expect(new D1DocumentExportRepository(d1, scope, 'user-a').fenceUnpublishedAttempt(input)).rejects.toThrow();
    expect(database.prepare('select count(*) as n from export_cleanup_fences').get()?.n).toBe(0);
  });

  it('rolls back export publication after access is revoked immediately before its batch', async () => {
    let intercepted = false;
    const { database, d1, scope } = await createFixture({ beforeBatch: () => {
      intercepted = true;
      database.exec("update memberships set status='disabled' where id='membership-a'");
    } });
    const repository = new D1DocumentExportRepository(d1, scope, 'user-a');
    await expect(repository.recordGenerated(exportCommand())).rejects.toThrow();
    expect(intercepted).toBe(true);
    for (const table of ['document_artifacts', 'command_idempotency', 'audit_events']) {
      expect(database.prepare(`select count(*) as count from ${table}`).get()).toEqual({ count: 0 });
    }
  });

  it('keeps packages immutable, replays intent and downloads the exact original artifact', async () => {
    const { database, d1, scope } = await createFixture();
    const repository = new D1DocumentExportRepository(d1, scope, 'user-a');
    const input = exportCommand();
    const first = await repository.recordGenerated(input);
    const changedFiles = input.artifacts.map(a => ({ ...a, objectKey: `second/${a.filename}` }));
    expect(await repository.recordGenerated({ ...input, artifacts: changedFiles })).toEqual(first);
    expect(await repository.findGenerated(input)).toEqual(first);
    const second = await repository.recordGenerated({ ...exportCommand(), artifacts: changedFiles });
    const current = await repository.listCurrentArtifacts();
    expect(current).toHaveLength(5);
    const ids = current.map(a => a.id).sort();
    expect([first, second].some(p => JSON.stringify(p.artifacts.map(a => a.id).sort()) === JSON.stringify(ids))).toBe(true);
    const original = first.artifacts.find(a => a.kind === 'protocol_docx')!;
    expect(await repository.getDownload('protocol_docx', original.id)).toEqual(original);
    await repository.assertDownloadAuthorized(original, 'user-a');
    expect(() => database.prepare('update document_artifacts set sha256=? where id=?').run('b'.repeat(64), original.id)).toThrow();
    expect(() => database.prepare('delete from document_artifacts where id=?').run(original.id)).toThrow();
  }, 20000);

  it.each(['missing', 'wrong-user', 'revoked'] as const)('denies %s source/list/download access', async kind => {
    const { database, d1, scope } = await createFixture();
    if (kind === 'missing') scope.accessAssignmentId = undefined;
    if (kind === 'revoked') database.exec("update memberships set status='disabled' where id='membership-a'");
    const repository = new D1DocumentExportRepository(d1, scope, kind === 'wrong-user' ? 'user-b' : 'user-a');
    await expect(repository.getSignedSource()).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    await expect(repository.listCurrentArtifacts()).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    await expect(repository.getDownload('protocol_docx')).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('denies returning source when access is revoked during its read', async () => {
    let revoked = false;
    const { d1, scope } = await createFixture({ afterRead: (sql, db) => {
      if (sql.includes('version.content_json as contentJson')) {
        db.exec("update memberships set status='disabled' where id='membership-a'"); revoked = true;
      }
    } });
    await expect(new D1DocumentExportRepository(d1, scope, 'user-a').getSignedSource()).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(revoked).toBe(true);
  });

  it('attributes generation and rejects cross-assignment and revoked command replay', async () => {
    const { database, d1, scope } = await createFixture();
    const repository = new D1DocumentExportRepository(d1, scope, 'user-a');
    const input = exportCommand();
    const generated = await repository.recordGenerated(input);
    expect(await repository.recordGenerated(input)).toEqual(generated);
    expect(database.prepare("select access_assignment_id from command_idempotency where operation='document.export.generate'").get())
      .toEqual({ access_assignment_id: scope.accessAssignmentId });
    const artifact = await repository.getDownload('protocol_docx');
    expect(artifact).toBeTruthy();
    await repository.assertDownloadAuthorized(artifact!, 'user-a');
    await expect(repository.assertDownloadAuthorized({ ...artifact!, sha256: 'b'.repeat(64) }, 'user-a')).rejects.toBeInstanceOf(DocumentExportConflictError);
    database.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    await expect(new D1DocumentExportRepository(d1, { ...scope, accessAssignmentId: 'access-assignment-a-secondary' }, 'user-a').recordGenerated(input))
      .rejects.toBeInstanceOf(DocumentExportConflictError);
    database.exec("update memberships set status='disabled' where id='membership-a'");
    await expect(repository.recordGenerated(input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    await expect(repository.assertDownloadAuthorized(artifact!, 'user-a')).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  }, 20000);

  it('rejects revoked generation at final repository preflight without writes', async () => {
    let revoked = false;
    const { database, d1, scope } = await createFixture({ afterRead: (sql, db) => {
      if (sql.includes('from audit_stream_heads')) {
        db.exec("update memberships set status='disabled' where id='membership-a'"); revoked = true;
      }
    } });
    await expect(new D1DocumentExportRepository(d1, scope, 'user-a').recordGenerated(exportCommand())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(revoked).toBe(true);
    for (const table of ['document_artifacts', 'command_idempotency', 'audit_events']) {
      expect(database.prepare(`select count(*) as count from ${table}`).get()).toEqual({ count: 0 });
    }
  });
});

describe('signed protocol amendment repository', () => {
  it('rolls back amendment after final-preflight revocation and retains signed history', async () => {
    let intercepted = false;
    const { database, repository } = await createFixture({ beforeBatch: () => {
      intercepted = true;
      database.exec("update memberships set status='disabled' where id='membership-a'");
    } });
    const snapshot = () => ['protocol_versions', 'protocol_amendments', 'protocol_heads', 'encounters', 'command_idempotency', 'audit_events', 'audit_stream_heads']
      .map((table) => database.prepare(`select * from ${table} order by id`).all());
    const before = snapshot();
    await expect(repository.amend(command())).rejects.toThrow();
    expect(intercepted).toBe(true);
    expect(snapshot()).toEqual(before);
    expect(() => database.prepare(`insert into protocol_versions
      (id,organization_id,facility_id,encounter_id,version,status,content_json,source_hash,created_by_membership_id,
       signed_by_membership_id,signed_at,supersedes_protocol_version_id,created_at,access_assignment_id)
      select 'unauthorized-successor',organization_id,facility_id,encounter_id,version+1,'signed',content_json,source_hash,
        created_by_membership_id,signed_by_membership_id,signed_at,id,created_at,'access-assignment-a-general-medicine'
      from protocol_versions where id='protocol-v2'`).run()).toThrow('protocol version requires current assignment');
    expect(snapshot()).toEqual(before);
  });
  it('rechecks amendment access after the source snapshot without changing signed history', async () => {
    const { database, repository } = await createFixture({ afterRead: (sql, db) => {
      if (sql.includes('from audit_stream_heads')) db.exec("update memberships set status='disabled' where id='membership-a'");
    } });
    const before = database.prepare('select * from protocol_versions order by id').all();
    await expect(repository.amend(command())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select * from protocol_versions order by id').all()).toEqual(before);
    expect(database.prepare('select count(*) as count from protocol_amendments').get()?.count).toBe(0);
  });
  it('requires current exact assignment for new commands and replay', async () => {
    const { database, d1, scope, repository } = await createFixture();
    for (const patch of [{ accessAssignmentId: undefined }, { accessPermission: 'encounter.read' as const }]) {
      await expect(new D1ProtocolAmendmentRepository(d1, { ...scope, ...patch }).amend(command()))
        .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    }
    await expect(repository.amend(command({ actorId: 'user-b' }))).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    const input = command();
    await repository.amend(input);
    expect(database.prepare("select access_assignment_id from command_idempotency where operation='protocol.amend'").get()?.access_assignment_id).toBe(scope.accessAssignmentId);
    database.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    await expect(new D1ProtocolAmendmentRepository(d1, { ...scope, accessAssignmentId: 'access-assignment-a-secondary' }).amend(input))
      .rejects.toBeInstanceOf(ProtocolAmendmentConflictError);
    database.exec("update memberships set status='disabled' where id='membership-a'");
    await expect(repository.amend(input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as count from protocol_amendments').get()?.count).toBe(1);
  });
  it('creates one immutable signed successor, advances heads, and appends audit', async () => {
    const { database, d1, repository, scope } = await createFixture();
    const input = command();
    const result = await repository.amend(input);
    const replay = await repository.amend(input);

    expect(database.prepare('select access_assignment_id from protocol_versions where id=?').get(result.protocol.id)?.access_assignment_id).toBe(scope.accessAssignmentId);
    expect(database.prepare('select access_assignment_id from protocol_amendments where id=?').get(result.amendment.id)?.access_assignment_id).toBe(scope.accessAssignmentId);
    expect(() => database.prepare('update protocol_versions set access_assignment_id=null where id=?').run(result.protocol.id)).toThrow();
    expect(() => database.prepare('update protocol_amendments set access_assignment_id=null where id=?').run(result.amendment.id)).toThrow();

    expect(replay).toEqual(result);
    expect(result.protocol).toMatchObject({ version: 3, status: 'signed', headVersion: 3 });
    expect(result.amendment).toMatchObject({ sequence: 1, protocolVersion: 3 });
    expect(result.transition).toMatchObject({ status: 'amended', version: 4 });
    expect(
      database.prepare(`select count(*) as count from protocol_amendments`).get(),
    ).toMatchObject({ count: 1 });
    expect(
      database.prepare(`select status, version from encounters where id = 'encounter-a'`).get(),
    ).toMatchObject({ status: 'amended', version: 4 });
    expect(
      database.prepare(`
        select current_protocol_version_id as currentId,
          current_signed_protocol_version_id as signedId, lock_version as lockVersion
        from protocol_heads where id = 'protocol-head-a'
      `).get(),
    ).toMatchObject({
      currentId: result.protocol.id,
      signedId: result.protocol.id,
      lockVersion: 3,
    });
    const auditEvent =
      database.prepare(`
        select action, entity_type as entityType, entity_id as entityId,
          previous_hash as previousHash, event_hash as eventHash
        from audit_events
      `).get() as Record<string, unknown>;
    expect(auditEvent).toMatchObject({
      action: 'protocol.amend_and_sign',
      entityType: 'protocol_amendment',
      entityId: result.amendment.id,
      previousHash: null,
    });
    expect(auditEvent.eventHash).toMatch(/^[a-f0-9]{64}$/);
    expect(
      database.prepare(`
        select last_sequence as lastSequence, last_event_hash as lastEventHash
        from audit_stream_heads where id = 'audit-head-a'
      `).get(),
    ).toMatchObject({ lastSequence: 1, lastEventHash: auditEvent.eventHash });
    const storedContent = JSON.parse(
      String(
        (
          database
            .prepare(`select content_json as contentJson from protocol_versions where id = ?1`)
            .get(result.protocol.id) as { contentJson: string }
        ).contentJson,
      ),
    ) as SignedProtocolContent;
    expect(storedContent.amendments).toHaveLength(1);
    expect(storedContent.amendments[0]).toMatchObject({
      id: result.amendment.id,
      baseProtocolId: 'protocol-v2',
      reason: input.reason,
      text: input.text,
    });
    const exportSource = await new D1DocumentExportRepository(
      d1,
      scope,
    ).getSignedSource();
    expect(exportSource.auditEvents).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          action: 'protocol.amend_and_sign',
          entityType: 'protocol_amendment',
          entityId: result.amendment.id,
        }),
      ]),
    );
  });

  it('supports a second linear amendment without reopening the signed record', async () => {
    const { repository } = await createFixture();
    const first = await repository.amend(command());
    const second = await repository.amend(
      command({
        baseProtocolId: first.protocol.id,
        expectedProtocolVersion: first.protocol.version,
        expectedProtocolHeadVersion: first.protocol.headVersion,
        expectedEncounterVersion: first.transition.version,
        reason: 'Второе уточнение после повторной проверки врача',
        text: 'Второе отдельное подписанное синтетическое дополнение.',
      }),
    );

    expect(second.protocol).toMatchObject({ version: 4, headVersion: 4 });
    expect(second.transition).toMatchObject({ status: 'amended', version: 5 });
    expect(await repository.list()).toMatchObject([
      { sequence: 1, protocolVersion: 3 },
      { sequence: 2, protocolVersion: 4 },
    ]);
  });

  it('rejects changed replay payloads and stale optimistic versions', async () => {
    const { repository } = await createFixture();
    const initial = command();
    const first = await repository.amend(initial);

    await expect(
      repository.amend({ ...initial, text: 'Другой текст с тем же ключом.' }),
    ).rejects.toBeInstanceOf(ProtocolAmendmentConflictError);
    await expect(
      repository.amend(
        command({
          baseProtocolId: first.protocol.id,
          expectedProtocolVersion: 2,
          expectedProtocolHeadVersion: first.protocol.headVersion,
          expectedEncounterVersion: first.transition.version,
        }),
      ),
    ).rejects.toBeInstanceOf(ProtocolAmendmentConflictError);
  });

  it('fails closed when care consent is denied', async () => {
    const { database, repository } = await createFixture({ careDecision: 'denied' });

    await expect(repository.amend(command())).rejects.toBeInstanceOf(
      ProtocolAmendmentConsentRequiredError,
    );
    expect(
      database.prepare(`select count(*) as count from protocol_amendments`).get(),
    ).toMatchObject({ count: 0 });
  });

  it('fails closed for another tenant scope and a corrupted signed source', async () => {
    const other = await createFixture();
    const crossTenant = new D1ProtocolAmendmentRepository(
      createD1Adapter(other.database),
      {
        organizationId: 'org-b',
        facilityId: 'fac-b',
        encounterId: 'encounter-a',
        reviewerMembershipId: 'membership-b',
      },
    );
    await expect(crossTenant.amend(command())).rejects.toBeInstanceOf(
      AccessPermissionRequiredError,
    );

    const corrupted = await createFixture({ invalidSourceHash: true });
    await expect(corrupted.repository.amend(command())).rejects.toBeInstanceOf(
      ProtocolAmendmentSourceChangedError,
    );
  });
});
