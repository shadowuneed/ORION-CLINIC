import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import type { SignedProtocolContent } from '@/lib/documents/protocol-artifacts';
import { D1DocumentExportRepository } from './document-export';
import {
  D1ProtocolAmendmentRepository,
  ProtocolAmendmentConflictError,
  ProtocolAmendmentConsentRequiredError,
  ProtocolAmendmentNotFoundError,
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
      const row = target.prepare(sql).get(...bindings) as Record<string, T> | undefined;
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

  const scope: WorkspaceScope = {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    encounterId: 'encounter-a',
    reviewerMembershipId: 'membership-a',
  };
  const d1 = createD1Adapter(database);
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

describe('signed protocol amendment repository', () => {
  it('creates one immutable signed successor, advances heads, and appends audit', async () => {
    const { database, d1, repository, scope } = await createFixture();
    const input = command();
    const result = await repository.amend(input);
    const replay = await repository.amend(input);

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
      ProtocolAmendmentNotFoundError,
    );

    const corrupted = await createFixture({ invalidSourceHash: true });
    await expect(corrupted.repository.amend(command())).rejects.toBeInstanceOf(
      ProtocolAmendmentSourceChangedError,
    );
  });
});
