import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let database: DatabaseSync;

function applyMigrations(target: DatabaseSync) {
  target.exec('pragma foreign_keys = on');

  for (const fileName of readdirSync('drizzle').filter((name) =>
    name.endsWith('.sql'),
  ).sort()) {
    const migration = readFileSync(join('drizzle', fileName), 'utf8').replaceAll(
      '--> statement-breakpoint',
      '',
    );

    target.exec(migration);
  }
}

function seedTwoTenantScopes(target: DatabaseSync) {
  target.exec(`
    insert into organizations (id, name) values ('org-a', 'Clinic A');
    insert into organizations (id, name) values ('org-b', 'Clinic B');
    insert into facilities (id, organization_id, name)
      values ('fac-a', 'org-a', 'Facility A');
    insert into facilities (id, organization_id, name)
      values ('fac-b', 'org-b', 'Facility B');
    insert into users (id, external_issuer, external_subject, display_name, status)
      values ('user-a', 'https://idp.test', 'doctor-a', 'Doctor A', 'active');
    insert into users (id, external_issuer, external_subject, display_name, status)
      values ('user-b', 'https://idp.test', 'doctor-b', 'Doctor B', 'active');
    insert into memberships (
      id, organization_id, facility_id, user_id, role, status
    ) values (
      'membership-a', 'org-a', 'fac-a', 'user-a', 'clinician', 'active'
    );
    insert into memberships (
      id, organization_id, facility_id, user_id, role, status
    ) values (
      'membership-b', 'org-b', 'fac-b', 'user-b', 'clinician', 'active'
    );
    insert into patients (
      id, organization_id, facility_id, medical_record_number, display_name
    ) values ('patient-a', 'org-a', 'fac-a', 'A-001', 'Patient A');
    insert into patients (
      id, organization_id, facility_id, medical_record_number, display_name
    ) values ('patient-b', 'org-b', 'fac-b', 'B-001', 'Patient B');
  `);
}

function seedEncounter(target: DatabaseSync) {
  target.exec(`
    insert into encounters (
      id, organization_id, facility_id, patient_id,
      clinician_membership_id, status, started_at
    ) values (
      'encounter-a', 'org-a', 'fac-a', 'patient-a',
      'membership-a', 'in_progress', 1000
    );
  `);
}

function seedSuggestion(target: DatabaseSync, options?: { future?: boolean }) {
  const suffix = options?.future ? 'future' : 'expired';
  const expiresAt = options?.future ? 4_102_444_800_000 : 0;

  target.exec(`
    insert into analysis_runs (
      id, organization_id, facility_id, encounter_id, kind, provider, model,
      model_version, policy_version, input_hash, source_record_ids_json, status
    ) values (
      'analysis-${suffix}', 'org-a', 'fac-a', 'encounter-a', 'suggestions',
      'test', 'synthetic', '1', '1', 'input-${suffix}', '[]', 'succeeded'
    );
    insert into clinical_suggestions (
      id, organization_id, facility_id, encounter_id, analysis_run_id,
      category, risk_level, title, original_content, evidence_json, expires_at
    ) values (
      'suggestion-${suffix}', 'org-a', 'fac-a', 'encounter-a',
      'analysis-${suffix}', 'clarification', 'informational', 'Synthetic',
      'Synthetic content', '[]', ${expiresAt}
    );
  `);
}

function seedClinicalSection(target: DatabaseSync) {
  seedEncounter(target);
  target.exec(`
    insert into clinical_section_versions (
      id, organization_id, facility_id, encounter_id, code, content,
      review_state, provenance_json, created_by_type, created_by_id, version
    ) values (
      'section-v1', 'org-a', 'fac-a', 'encounter-a', 'complaints',
      'Initial draft', 'ai_draft', '{}', 'service', 'test', 1
    );
    insert into clinical_section_heads (
      id, organization_id, facility_id, encounter_id, code,
      current_version_id, lock_version
    ) values (
      'section-head', 'org-a', 'fac-a', 'encounter-a', 'complaints',
      'section-v1', 1
    );
  `);
}

describe('D1 schema security invariants', () => {
  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    applyMigrations(database);
    seedTwoTenantScopes(database);
  });

  afterEach(() => database.close());

  it('rejects a patient reference from another tenant', () => {
    expect(() =>
      database.exec(`
        insert into encounters (
          id, organization_id, facility_id, patient_id,
          clinician_membership_id, status
        ) values (
          'cross-tenant', 'org-a', 'fac-a', 'patient-b',
          'membership-a', 'draft'
        );
      `),
    ).toThrow(/foreign key constraint failed/i);
  });

  it('enforces enum values at the SQLite layer', () => {
    expect(() =>
      database.exec(`
        insert into patients (
          id, organization_id, facility_id, medical_record_number,
          display_name, status
        ) values ('bad-status', 'org-a', 'fac-a', 'A-002', 'Bad', 'unknown');
      `),
    ).toThrow(/check constraint failed/i);
  });

  it('keeps patient profiles immutable, linear and terminal after archive', () => {
    database.exec(`
      insert into patient_profile_versions (
        id, organization_id, facility_id, patient_id, version,
        display_name, sex_at_birth, status, created_by_membership_id,
        change_reason
      ) values (
        'profile-v1', 'org-a', 'fac-a', 'patient-a', 1,
        'Patient A', 'not_recorded', 'active', 'membership-a',
        'initial_registration'
      );
      insert into patient_profile_heads (
        id, organization_id, facility_id, patient_id,
        current_version_id, lock_version
      ) values (
        'profile-head', 'org-a', 'fac-a', 'patient-a', 'profile-v1', 1
      );
    `);

    expect(() =>
      database.exec(`update patient_profile_versions set display_name = 'Changed' where id = 'profile-v1';`),
    ).toThrow(/immutable/i);
    expect(() =>
      database.exec(`delete from patient_profile_versions where id = 'profile-v1';`),
    ).toThrow(/cannot be deleted/i);
    expect(() =>
      database.exec(`
        insert into patient_profile_versions (
          id, organization_id, facility_id, patient_id, version,
          display_name, sex_at_birth, status, created_by_membership_id,
          change_reason, supersedes_profile_version_id
        ) values (
          'profile-v3-branch', 'org-a', 'fac-a', 'patient-a', 3,
          'Patient A', 'not_recorded', 'active', 'membership-a',
          'invalid branch', 'profile-v1'
        );
      `),
    ).toThrow(/extend the active current head/i);

    database.exec(`
      insert into patient_profile_versions (
        id, organization_id, facility_id, patient_id, version,
        display_name, sex_at_birth, status, created_by_membership_id,
        change_reason, supersedes_profile_version_id
      ) values (
        'profile-v2', 'org-a', 'fac-a', 'patient-a', 2,
        'Patient A', 'not_recorded', 'inactive', 'membership-a',
        'test archive', 'profile-v1'
      );
    `);
    expect(() =>
      database.exec(`
        update patient_profile_heads
        set current_version_id = 'profile-v2', lock_version = 3
        where id = 'profile-head';
      `),
    ).toThrow(/advance by one immutable version/i);
    database.exec(`
      update patient_profile_heads
      set current_version_id = 'profile-v2', lock_version = 2
      where id = 'profile-head';
    `);
    expect(() =>
      database.exec(`delete from patient_profile_heads where id = 'profile-head';`),
    ).toThrow(/cannot be deleted/i);
    expect(() =>
      database.exec(`
        insert into patient_profile_versions (
          id, organization_id, facility_id, patient_id, version,
          display_name, sex_at_birth, status, created_by_membership_id,
          change_reason, supersedes_profile_version_id
        ) values (
          'profile-v3-after-archive', 'org-a', 'fac-a', 'patient-a', 3,
          'Patient A', 'not_recorded', 'active', 'membership-a',
          'invalid restore', 'profile-v2'
        );
      `),
    ).toThrow(/extend the active current head/i);
  });

  it('does not allow a final transcript version to be overwritten', () => {
    seedEncounter(database);
    database.exec(`
      insert into transcript_segments (
        id, organization_id, facility_id, encounter_id, segment_index,
        version, speaker_role, speaker_role_source, language_code, text,
        started_at_ms, ended_at_ms, state
      ) values (
        'segment-a', 'org-a', 'fac-a', 'encounter-a', 1,
        1, 'doctor', 'model', 'ru', 'Initial text', 0, 500, 'final'
      );
    `);

    expect(() =>
      database.exec(`
        update transcript_segments set text = 'Overwritten' where id = 'segment-a';
      `),
    ).toThrow(/append-only/i);
  });

  it('keeps transcript corrections append-only and exposes only the current branch head', () => {
    seedEncounter(database);
    database.exec(`
      insert into transcript_segments (
        id, organization_id, facility_id, encounter_id, segment_index,
        version, speaker_role, speaker_role_source, language_code, text,
        started_at_ms, ended_at_ms, state
      ) values (
        'segment-v1', 'org-a', 'fac-a', 'encounter-a', 1,
        1, 'unknown', 'model', 'mixed', 'Синтетическая исходная реплика',
        0, 500, 'final'
      );
      insert into transcript_segments (
        id, organization_id, facility_id, encounter_id, segment_index,
        version, speaker_role, speaker_role_source, language_code, text,
        started_at_ms, ended_at_ms, state, corrected_by_membership_id,
        supersedes_segment_id
      ) values (
        'segment-v2', 'org-a', 'fac-a', 'encounter-a', 1,
        2, 'patient', 'manual', 'kk', 'Синтетическая исправленная реплика',
        0, 500, 'corrected', 'membership-a', 'segment-v1'
      );
    `);

    const current = database
      .prepare(`
        select segment.id, segment.version, segment.speaker_role as role,
          segment.speaker_role_source as roleSource, segment.language_code as language,
          segment.text
        from transcript_segments segment
        where segment.encounter_id = 'encounter-a'
          and not exists (
            select 1 from transcript_segments successor
            where successor.supersedes_segment_id = segment.id
          )
      `)
      .all();

    expect(current).toEqual([
      {
        id: 'segment-v2',
        version: 2,
        role: 'patient',
        roleSource: 'manual',
        language: 'kk',
        text: 'Синтетическая исправленная реплика',
      },
    ]);
    expect(
      database
        .prepare(
          `select count(*) as count from transcript_segments where encounter_id = 'encounter-a'`,
        )
        .get(),
    ).toMatchObject({ count: 2 });

    expect(() =>
      database.exec(`
        insert into transcript_segments (
          id, organization_id, facility_id, encounter_id, segment_index,
          version, speaker_role, speaker_role_source, language_code, text,
          started_at_ms, ended_at_ms, state, corrected_by_membership_id,
          supersedes_segment_id
        ) values (
          'segment-v2-branch', 'org-a', 'fac-a', 'encounter-a', 1,
          3, 'doctor', 'manual', 'ru', 'Недопустимая параллельная ветка',
          0, 500, 'corrected', 'membership-a', 'segment-v1'
        );
      `),
    ).toThrow(/immediate predecessor|unique constraint failed/i);
  });

  it('requires a valid previous audit event in the same tenant chain', () => {
    database.exec(`
      insert into audit_stream_heads (
        id, organization_id, facility_id, last_sequence, last_event_hash
      ) values ('audit-head-a', 'org-a', 'fac-a', 0, null);
      insert into audit_events (
        id, organization_id, facility_id, sequence, actor_type, actor_id,
        actor_membership_id, action, outcome, purpose, entity_type, entity_id,
        request_id, metadata_json, previous_hash, event_hash, occurred_at
      ) values (
        'audit-1', 'org-a', 'fac-a', 1, 'user', 'membership-a',
        'membership-a', 'encounter.view', 'succeeded', 'care', 'encounter',
        'encounter-a', 'request-1', '{}', null, 'hash-1', 1000
      );
      update audit_stream_heads
      set last_sequence = 1, last_event_hash = 'hash-1', lock_version = 2
      where id = 'audit-head-a';
    `);

    expect(() =>
      database.exec(`
        insert into audit_events (
          id, organization_id, facility_id, sequence, actor_type, actor_id,
          actor_membership_id, action, outcome, purpose, entity_type, entity_id,
          request_id, metadata_json, previous_hash, event_hash, occurred_at
        ) values (
          'audit-2', 'org-a', 'fac-a', 2, 'user', 'membership-a',
          'membership-a', 'encounter.edit', 'succeeded', 'care', 'encounter',
          'encounter-a', 'request-2', '{}', 'wrong-hash', 'hash-2', 1001
        );
      `),
    ).toThrow(/current stream head|tenant chain/i);
  });

  it('permits only a linked immutable signed amendment after finalization', () => {
    seedEncounter(database);
    database.exec(`
      update encounters
      set status = 'review', ended_at = 2000, version = 2,
        updated_at = 4102444800000
      where id = 'encounter-a';
      insert into protocol_versions (
        id, organization_id, facility_id, encounter_id, version, status,
        content_json, source_hash, created_by_membership_id, created_at
      ) values (
        'protocol-amend-v1', 'org-a', 'fac-a', 'encounter-a', 1, 'draft',
        '{"schemaVersion":1}', 'source-amend-v1', 'membership-a', 4102444800000
      );
      insert into protocol_heads (
        id, organization_id, facility_id, encounter_id,
        current_protocol_version_id, lock_version, updated_at
      ) values (
        'protocol-amend-head', 'org-a', 'fac-a', 'encounter-a',
        'protocol-amend-v1', 1, 4102444800000
      );
      insert into protocol_versions (
        id, organization_id, facility_id, encounter_id, version, status,
        content_json, source_hash, created_by_membership_id,
        signed_by_membership_id, signed_at, supersedes_protocol_version_id,
        created_at
      ) values (
        'protocol-amend-v2', 'org-a', 'fac-a', 'encounter-a', 2, 'signed',
        '{"schemaVersion":1}', 'source-amend-v2', 'membership-a',
        'membership-a', 4102444801000, 'protocol-amend-v1', 4102444801000
      );
      update protocol_heads
      set current_protocol_version_id = 'protocol-amend-v2',
        current_signed_protocol_version_id = 'protocol-amend-v2',
        lock_version = 2, updated_at = 4102444801000
      where id = 'protocol-amend-head';
      update encounters
      set status = 'finalized', finalized_at = 4102444801000, version = 3,
        updated_at = 4102444801000
      where id = 'encounter-a';
    `);

    expect(() =>
      database.exec(`
        update encounters
        set status = 'amended', version = 4, updated_at = 4102444802000
        where id = 'encounter-a';
      `),
    ).toThrow(/linked signed amendment/i);

    database.exec(`
      insert into protocol_versions (
        id, organization_id, facility_id, encounter_id, version, status,
        content_json, source_hash, created_by_membership_id,
        signed_by_membership_id, signed_at, supersedes_protocol_version_id,
        created_at
      ) values (
        'protocol-amend-v3', 'org-a', 'fac-a', 'encounter-a', 3, 'signed',
        '{"schemaVersion":1,"amendments":[1]}', 'source-amend-v3',
        'membership-a', 'membership-a', 4102444802000,
        'protocol-amend-v2', 4102444802000
      );
      insert into protocol_amendments (
        id, organization_id, facility_id, encounter_id,
        base_protocol_version_id, amended_protocol_version_id,
        reason, amendment_text, created_by_membership_id, created_at
      ) values (
        'amendment-v1', 'org-a', 'fac-a', 'encounter-a',
        'protocol-amend-v2', 'protocol-amend-v3',
        'Уточнение после проверки', 'Подписанное дополнение',
        'membership-a', 4102444802000
      );
      update protocol_heads
      set current_protocol_version_id = 'protocol-amend-v3',
        current_signed_protocol_version_id = 'protocol-amend-v3',
        lock_version = 3, updated_at = 4102444802000
      where id = 'protocol-amend-head';
      update encounters
      set status = 'amended', version = 4, updated_at = 4102444802000
      where id = 'encounter-a';
    `);

    expect(
      database
        .prepare(`select status, version from encounters where id = 'encounter-a'`)
        .get(),
    ).toMatchObject({ status: 'amended', version: 4 });
    expect(() =>
      database.exec(`
        update encounters set reason_for_visit = 'silent rewrite'
        where id = 'encounter-a';
      `),
    ).toThrow(/linked signed amendment/i);
    expect(() =>
      database.exec(`
        update protocol_amendments set reason = 'Перезаписанная причина'
        where id = 'amendment-v1';
      `),
    ).toThrow(/append-only/i);
    expect(() =>
      database.exec(`delete from protocol_amendments where id = 'amendment-v1';`),
    ).toThrow(/append-only/i);
  });

  it('allows an expired suggestion head only after the recorded expiry time', () => {
    seedEncounter(database);
    seedSuggestion(database);
    seedSuggestion(database, { future: true });

    database.exec(`
      insert into suggestion_review_heads (
        id, organization_id, facility_id, encounter_id, suggestion_id,
        state, current_decision_id
      ) values (
        'head-expired', 'org-a', 'fac-a', 'encounter-a',
        'suggestion-expired', 'expired', null
      );
    `);

    expect(() =>
      database.exec(`
        insert into suggestion_review_heads (
          id, organization_id, facility_id, encounter_id, suggestion_id,
          state, current_decision_id
        ) values (
          'head-future', 'org-a', 'fac-a', 'encounter-a',
          'suggestion-future', 'expired', null
        );
      `),
    ).toThrow(/only after its expiry time/i);
  });

  it('binds the audit stream head to the exact tenant event and sequence', () => {
    database.exec(`
      insert into audit_stream_heads (
        id, organization_id, facility_id, last_sequence, last_event_hash
      ) values ('head-a', 'org-a', 'fac-a', 0, null);
      insert into audit_stream_heads (
        id, organization_id, facility_id, last_sequence, last_event_hash
      ) values ('head-b', 'org-b', 'fac-b', 0, null);
      insert into audit_events (
        id, organization_id, facility_id, sequence, actor_type, actor_id,
        actor_membership_id, action, outcome, purpose, entity_type, entity_id,
        request_id, metadata_json, previous_hash, event_hash, occurred_at
      ) values (
        'audit-b', 'org-b', 'fac-b', 1, 'user', 'membership-b',
        'membership-b', 'encounter.view', 'succeeded', 'care', 'encounter',
        'encounter-b', 'request-b', '{}', null, 'hash-b', 1000
      );
      update audit_stream_heads
      set last_sequence = 1, last_event_hash = 'hash-b', lock_version = 2
      where id = 'head-b';
    `);

    expect(() =>
      database.exec(`
        update audit_stream_heads
        set last_sequence = 1, last_event_hash = 'hash-b', lock_version = 2
        where id = 'head-a';
      `),
    ).toThrow(/advance by one event|foreign key constraint failed/i);
  });

  it('rejects orphaned transcript, clinical section, and protocol versions', () => {
    seedEncounter(database);

    expect(() =>
      database.exec(`
        insert into transcript_segments (
          id, organization_id, facility_id, encounter_id, segment_index,
          version, speaker_role, speaker_role_source, language_code, text,
          started_at_ms, ended_at_ms, state
        ) values (
          'segment-orphan', 'org-a', 'fac-a', 'encounter-a', 1, 2,
          'doctor', 'model', 'ru', 'Orphan', 0, 500, 'final'
        );
      `),
    ).toThrow(/immediate predecessor|current head/i);

    expect(() =>
      database.exec(`
        insert into clinical_section_versions (
          id, organization_id, facility_id, encounter_id, code, content,
          review_state, provenance_json, created_by_type, created_by_id, version
        ) values (
          'section-orphan', 'org-a', 'fac-a', 'encounter-a', 'complaints',
          'Orphan', 'ai_draft', '{}', 'service', 'test', 2
        );
      `),
    ).toThrow(/immediate predecessor|current head/i);

    expect(() =>
      database.exec(`
        insert into protocol_versions (
          id, organization_id, facility_id, encounter_id, version, status,
          content_json, source_hash, created_by_membership_id
        ) values (
          'protocol-orphan', 'org-a', 'fac-a', 'encounter-a', 2, 'draft',
          '{}', 'source-orphan', 'membership-a'
        );
      `),
    ).toThrow(/immediate predecessor/i);
  });

  it('keeps a protocol draft immutable after the current head is created', () => {
    seedEncounter(database);
    database.exec(`
      insert into protocol_versions (
        id, organization_id, facility_id, encounter_id, version, status,
        content_json, source_hash, created_by_membership_id
      ) values (
        'protocol-v1', 'org-a', 'fac-a', 'encounter-a', 1, 'draft',
        '{"schemaVersion":1}', 'source-v1', 'membership-a'
      );
      insert into protocol_heads (
        id, organization_id, facility_id, encounter_id,
        current_protocol_version_id, lock_version
      ) values (
        'protocol-head', 'org-a', 'fac-a', 'encounter-a', 'protocol-v1', 1
      );
    `);

    expect(() =>
      database.exec(`
        update protocol_versions
        set content_json = '{"schemaVersion":2}'
        where id = 'protocol-v1';
      `),
    ).toThrow(/immutable/i);
    expect(() =>
      database.exec(`delete from protocol_versions where id = 'protocol-v1';`),
    ).toThrow(/immutable/i);
    expect(() =>
      database.exec(`
        update protocol_heads
        set lock_version = 2, updated_at = 4102444800000
        where id = 'protocol-head';
      `),
    ).toThrow(/advance by one immutable version/i);

    database.exec(`
      insert into protocol_versions (
        id, organization_id, facility_id, encounter_id, version, status,
        content_json, source_hash, created_by_membership_id,
        signed_by_membership_id, signed_at, supersedes_protocol_version_id
      ) values (
        'protocol-v2', 'org-a', 'fac-a', 'encounter-a', 2, 'signed',
        '{"schemaVersion":1}', 'source-v1', 'membership-a',
        'membership-a', 2000, 'protocol-v1'
      );
      update protocol_heads
      set current_protocol_version_id = 'protocol-v2',
        current_signed_protocol_version_id = 'protocol-v2',
        lock_version = 2, updated_at = 4102444800000
      where id = 'protocol-head';
    `);

    expect(() =>
      database.exec(`
        update protocol_heads
        set current_protocol_version_id = 'protocol-v1', lock_version = 3,
          updated_at = 4102444801000
        where id = 'protocol-head';
      `),
    ).toThrow(/advance by one immutable version/i);
    expect(() =>
      database.exec(`delete from protocol_heads where id = 'protocol-head';`),
    ).toThrow(/cannot be deleted/i);
    expect(
      database
        .prepare(`
          select version.id, version.version, version.status, version.source_hash as sourceHash
          from protocol_heads head
          join protocol_versions version on version.id = head.current_protocol_version_id
          where head.id = 'protocol-head'
        `)
        .get(),
    ).toMatchObject({
      id: 'protocol-v2',
      version: 2,
      status: 'signed',
      sourceHash: 'source-v1',
    });
  });

  it('enforces clinical section content and human review consistency', () => {
    seedEncounter(database);

    expect(() =>
      database.exec(`
        insert into clinical_section_versions (
          id, organization_id, facility_id, encounter_id, code, content,
          review_state, provenance_json, created_by_type, created_by_id, version
        ) values (
          'bad-empty', 'org-a', 'fac-a', 'encounter-a', 'complaints',
          'Hidden content', 'empty', '{}', 'service', 'test', 1
        );
      `),
    ).toThrow(/state, content, and reviewer/i);

    expect(() =>
      database.exec(`
        insert into clinical_section_versions (
          id, organization_id, facility_id, encounter_id, code, content,
          review_state, provenance_json, created_by_type, created_by_id,
          reviewed_by_membership_id, reviewed_at, version
        ) values (
          'bad-review', 'org-a', 'fac-a', 'encounter-a', 'allergy_status',
          '', 'reviewed', '{}', 'user', 'user-a', 'membership-a', 1000, 1
        );
      `),
    ).toThrow(/state, content, and reviewer/i);
  });

  it('allows only linear clinical section head advancement', () => {
    seedClinicalSection(database);
    database.exec(`
      insert into clinical_section_versions (
        id, organization_id, facility_id, encounter_id, code, content,
        review_state, provenance_json, created_by_type, created_by_id,
        version, supersedes_section_version_id
      ) values (
        'section-v2', 'org-a', 'fac-a', 'encounter-a', 'complaints',
        'Edited', 'clinician_edited', '{}', 'user', 'user-a', 2, 'section-v1'
      );
    `);

    expect(() =>
      database.exec(`
        update clinical_section_heads
        set current_version_id = 'section-v2', lock_version = 3
        where id = 'section-head';
      `),
    ).toThrow(/advance by one version/i);

    database.exec(`
      update clinical_section_heads
      set current_version_id = 'section-v2', lock_version = 2
      where id = 'section-head';
    `);

    expect(() =>
      database.exec(`delete from clinical_section_heads where id = 'section-head';`),
    ).toThrow(/cannot be deleted/i);
    expect(() =>
      database.exec(`
        update clinical_section_heads
        set current_version_id = 'section-v1', lock_version = 3
        where id = 'section-head';
      `),
    ).toThrow(/advance by one version/i);
  });

  it('keeps consent events append-only and advances one current version', () => {
    seedEncounter(database);
    database.exec(`
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at
      ) values (
        'consent-v1', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 1,
        'care', 'granted', 'membership-a', 'test-v1', 'hash-v1', 'ru',
        'verbal', 1000, 1000
      );
      insert into consent_heads (
        id, organization_id, facility_id, patient_id, encounter_id,
        consent_type, current_consent_event_id, lock_version
      ) values (
        'consent-head', 'org-a', 'fac-a', 'patient-a', 'encounter-a',
        'care', 'consent-v1', 1
      );
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at,
        supersedes_consent_event_id
      ) values (
        'consent-v2', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 2,
        'care', 'withdrawn', 'membership-a', 'test-v1', 'hash-v1', 'ru',
        'verbal', 2000, 2000, 'consent-v1'
      );
      update consent_heads
      set current_consent_event_id = 'consent-v2', lock_version = 2,
        updated_at = 4102444800000
      where id = 'consent-head';
    `);

    expect(() =>
      database.exec(`
        update consent_events set decision = 'denied' where id = 'consent-v1';
      `),
    ).toThrow(/append-only/i);
    expect(() =>
      database.exec(`
        update consent_heads
        set current_consent_event_id = 'consent-v1', lock_version = 3
        where id = 'consent-head';
      `),
    ).toThrow(/advance by one immutable event/i);
    expect(() =>
      database.exec(`
        insert into consent_events (
          id, organization_id, facility_id, patient_id, encounter_id, version,
          consent_type, decision, captured_by_membership_id, policy_version,
          policy_hash, notice_language, source, occurred_at, effective_at,
          supersedes_consent_event_id
        ) values (
          'consent-branch', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 3,
          'care', 'denied', 'membership-a', 'test-v1', 'hash-v1', 'ru',
          'verbal', 3000, 3000, 'consent-v1'
        );
      `),
    ).toThrow(/unique constraint|immediate same subject version/i);
  });

  it('gates versioned encounter status transitions with effective care consent', () => {
    database.exec(`
      insert into encounters (
        id, organization_id, facility_id, patient_id,
        clinician_membership_id, status
      ) values (
        'encounter-lifecycle', 'org-a', 'fac-a', 'patient-a',
        'membership-a', 'draft'
      );
    `);

    expect(() =>
      database.exec(`
        update encounters
        set status = 'ready', version = 2, updated_at = 4102444800000
        where id = 'encounter-lifecycle';
      `),
    ).toThrow(/lacks effective care consent/i);

    database.exec(`
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at
      ) values (
        'consent-lifecycle', 'org-a', 'fac-a', 'patient-a',
        'encounter-lifecycle', 1, 'care', 'granted', 'membership-a',
        'test-v1', 'hash-v1', 'ru', 'verbal', 1000,
        cast(unixepoch('subsec') * 1000 as integer)
      );
      insert into consent_heads (
        id, organization_id, facility_id, patient_id, encounter_id,
        consent_type, current_consent_event_id, lock_version
      ) values (
        'consent-lifecycle-head', 'org-a', 'fac-a', 'patient-a',
        'encounter-lifecycle', 'care', 'consent-lifecycle', 1
      );
    `);

    expect(() =>
      database.exec(`
        update encounters
        set status = 'in_progress', version = 2, started_at = 2000,
          updated_at = 4102444800000
        where id = 'encounter-lifecycle';
      `),
    ).toThrow(/transition is invalid/i);

    database.exec(`
      update encounters
      set status = 'ready', version = 2, updated_at = 4102444800000
      where id = 'encounter-lifecycle';
    `);

    expect(() =>
      database.exec(`
        update encounters
        set status = 'in_progress', started_at = 3000,
          updated_at = 4102444801000
        where id = 'encounter-lifecycle';
      `),
    ).toThrow(/transition is invalid/i);

    database.exec(`
      update encounters
      set status = 'in_progress', version = 3, started_at = 3000,
        updated_at = 4102444801000
      where id = 'encounter-lifecycle';
    `);

    expect(() =>
      database.exec(`
        update encounters
        set status = 'finalized', version = 4,
          updated_at = 4102444802000
        where id = 'encounter-lifecycle';
      `),
    ).toThrow(/transition is invalid/i);
  });

  it('protects audit stream head advancement and deletion', () => {
    database.exec(`
      insert into audit_stream_heads (
        id, organization_id, facility_id, last_sequence, last_event_hash
      ) values ('audit-head', 'org-a', 'fac-a', 0, null);
      insert into audit_events (
        id, organization_id, facility_id, sequence, actor_type, actor_id,
        actor_membership_id, action, outcome, purpose, entity_type, entity_id,
        request_id, metadata_json, previous_hash, event_hash, occurred_at
      ) values (
        'audit-1', 'org-a', 'fac-a', 1, 'user', 'user-a', 'membership-a',
        'test', 'succeeded', 'test', 'test', 'test', 'request-1', '{}',
        null, 'hash-1', 1000
      );
      update audit_stream_heads
      set last_sequence = 1, last_event_hash = 'hash-1', lock_version = 2
      where id = 'audit-head';
    `);

    expect(() =>
      database.exec(`delete from audit_stream_heads where id = 'audit-head';`),
    ).toThrow(/cannot be deleted/i);
    expect(() =>
      database.exec(`
        update audit_stream_heads
        set last_sequence = 3, last_event_hash = 'missing', lock_version = 3
        where id = 'audit-head';
      `),
    ).toThrow(/advance by one event/i);
  });

  it('makes idempotency identity immutable and completion terminal', () => {
    seedClinicalSection(database);
    database.exec(`
      insert into command_idempotency (
        id, organization_id, facility_id, actor_membership_id,
        operation, idempotency_key, request_hash, status
      ) values (
        'command-a', 'org-a', 'fac-a', 'membership-a',
        'clinical_section.command', 'key-a', 'hash-a', 'processing'
      );
    `);

    expect(() =>
      database.exec(`
        update command_idempotency set request_hash = 'other'
        where id = 'command-a';
      `),
    ).toThrow(/transition is invalid/i);

    database.exec(`
      update command_idempotency
      set status = 'succeeded', result_resource_type = 'clinical_section_version',
        result_resource_id = 'section-v1', response_json = '{"resourceVersionId":"section-v1"}',
        completed_at = 1000
      where id = 'command-a';
    `);

    expect(() =>
      database.exec(`
        update command_idempotency set completed_at = 2000 where id = 'command-a';
      `),
    ).toThrow(/transition is invalid/i);
    expect(() =>
      database.exec(`delete from command_idempotency where id = 'command-a';`),
    ).toThrow(/cannot be deleted/i);
  });

  it('keeps clinician recommendation derivatives linear, immutable, and current', () => {
    database.exec(readFileSync('db/seed.local.sql', 'utf8'));
    const firstAt = Date.now() + 1_000;
    database.prepare(`
      insert into suggestion_derivative_versions (
        id, organization_id, facility_id, encounter_id, suggestion_id,
        version, title, content, content_hash, evidence_json, provenance_json,
        reason, authored_by_membership_id, created_at
      ) select (
        'derivative-v1'
      ), organization_id, facility_id, encounter_id, id, 1,
        'Версия врача', 'Уточнённый текст врача', ?1, evidence_json,
        '{"analysisRunId":"analysis-workspace","provider":"synthetic","model":"fixture","modelVersion":"1","policyVersion":"synthetic-policy-1","inputHash":"synthetic-workspace-input","sourceRecordIds":["seg-002"]}',
        'Клиническое уточнение', 'membership-a', ?2
      from clinical_suggestions where id = 'rec-1';
    `).run('a'.repeat(64), firstAt);
    database.prepare(`
      insert into suggestion_derivative_heads (
        id, organization_id, facility_id, encounter_id, suggestion_id,
        current_derivative_version_id, lock_version, updated_at
      ) values (
        'derivative-head-1', 'org-a', 'fac-a', 'encounter-a', 'rec-1',
        'derivative-v1', 1, ?1
      )
    `).run(firstAt);
    database.prepare(`
      update suggestion_review_heads set lock_version = 2, updated_at = ?1
      where suggestion_id = 'rec-1'
    `).run(firstAt);

    expect(() =>
      database.exec(`update suggestion_derivative_versions set content = 'x' where id = 'derivative-v1';`),
    ).toThrow(/append-only/i);
    expect(() =>
      database.exec(`delete from suggestion_derivative_versions where id = 'derivative-v1';`),
    ).toThrow(/append-only/i);
    expect(() =>
      database.exec(`delete from suggestion_derivative_heads where id = 'derivative-head-1';`),
    ).toThrow(/cannot be deleted/i);
    expect(() =>
      database.prepare(`
        insert into suggestion_derivative_versions (
          id, organization_id, facility_id, encounter_id, suggestion_id,
          version, title, content, content_hash, evidence_json, provenance_json,
          reason, authored_by_membership_id,
          supersedes_derivative_version_id, created_at
        ) select 'bad-v2', organization_id, facility_id, encounter_id, id, 2,
          'Bad', 'Bad branch', ?1, evidence_json, '{}', 'Bad branch reason',
          'membership-a', null, ?2
        from clinical_suggestions where id = 'rec-1'
      `).run('b'.repeat(64), firstAt + 1),
    ).toThrow(/extend the current version/i);
    expect(() =>
      database.prepare(`
        insert into review_decisions (
          id, organization_id, facility_id, encounter_id, suggestion_id,
          reviewer_membership_id, sequence, expected_version, idempotency_key,
          decision, result_state, reviewed_derivative_version_id, decided_at
        ) values (
          'bad-decision', 'org-a', 'fac-a', 'encounter-a', 'rec-1',
          'membership-a', 2, 2, 'bad-decision-key', 'accept',
          'accepted', null, ?1
        )
      `).run(firstAt + 2),
    ).toThrow(/current editable suggestion version/i);
  });

  it('upgrades legacy recommendation decisions without changing identity or state', () => {
    const legacy = new DatabaseSync(':memory:');
    try {
      legacy.exec('pragma foreign_keys = on');
      for (const fileName of readdirSync('drizzle')
        .filter((name) => /^000[0-9].*\.sql$/.test(name))
        .sort()) {
        legacy.exec(
          readFileSync(join('drizzle', fileName), 'utf8').replaceAll(
            '--> statement-breakpoint',
            '',
          ),
        );
      }
      const legacySeed = readFileSync('db/seed.local.sql', 'utf8')
        .replace(/INSERT OR IGNORE INTO patient_profile_versions[\s\S]*?;\r?\n/g, '')
        .replace(/INSERT OR IGNORE INTO patient_profile_heads[\s\S]*?;\r?\n/g, '');
      legacy.exec(legacySeed);
      legacy.exec(`
        insert into review_decisions (
          id, organization_id, facility_id, encounter_id, suggestion_id,
          reviewer_membership_id, sequence, expected_version, idempotency_key,
          decision, result_state, decided_at
        ) values (
          'legacy-decision', 'org-a', 'fac-a', 'encounter-a', 'rec-1',
          'membership-a', 1, 1, 'legacy-key', 'accept', 'accepted', 1787902270000
        );
        update suggestion_review_heads
        set state = 'accepted', current_decision_id = 'legacy-decision',
          lock_version = 2, updated_at = 1787902270000
        where suggestion_id = 'rec-1';
      `);
      const upgradeMigration = readFileSync(
        join('drizzle', '0010_suggestion_derivative_versions.sql'),
        'utf8',
      ).replaceAll('--> statement-breakpoint', '');
      legacy.exec('begin immediate');
      try {
        legacy.exec(upgradeMigration);
        legacy.exec('commit');
      } catch (error) {
        legacy.exec('rollback');
        throw error;
      }

      expect(
        legacy.prepare(`
          select id, result_state as state,
            reviewed_derivative_version_id as derivativeId,
            idempotency_key as idempotencyKey
          from review_decisions where id = 'legacy-decision'
        `).get(),
      ).toMatchObject({
        id: 'legacy-decision',
        state: 'accepted',
        derivativeId: null,
        idempotencyKey: 'legacy-key',
      });
      expect(legacy.prepare('pragma foreign_key_check').all()).toEqual([]);
      expect(
        legacy.prepare(`
          select count(*) as count from sqlite_master
          where type = 'trigger' and name = 'review_decisions_no_update'
        `).get(),
      ).toMatchObject({ count: 1 });
    } finally {
      legacy.close();
    }
  });

  it('installs the integrity marker used by readiness checks', () => {
    expect(
      database
        .prepare(`
          select count(*) as count
          from sqlite_master
          where type = 'trigger'
            and name = 'clinical_section_heads_advance_only'
        `)
        .get(),
    ).toMatchObject({ count: 1 });
  });
});
