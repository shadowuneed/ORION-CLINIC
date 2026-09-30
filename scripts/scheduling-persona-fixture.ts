import type { DatabaseSync } from 'node:sqlite';
// Isolated browser fixtures only. Never imported by application code.
const SYNTHETIC_SCHEDULE_SOURCE_LABEL = 'Тестовое ручное расписание · не КМИС';

export function seedCareConsent(
  database: DatabaseSync,
  suffix: string,
  patientId: string,
  encounterId: string,
  occurredAt: number,
) {
  database
    .prepare(`
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at
      ) values (
        ?, 'org-a', 'fac-a', ?, ?, 1, 'care', 'granted', 'persona-doctor-member',
        'test-v1', ?, 'ru', 'verbal', ?, ?
      )
    `)
    .run(
      `consent-care-${suffix}-v1`,
      patientId,
      encounterId,
      '2'.repeat(64),
      occurredAt,
      occurredAt,
    );
  database
    .prepare(`
      insert into consent_heads (
        id, organization_id, facility_id, patient_id, encounter_id,
        consent_type, current_consent_event_id, lock_version,
        created_at, updated_at
      ) values (?, 'org-a', 'fac-a', ?, ?, 'care', ?, 1, ?, ?)
    `)
    .run(
      `consent-head-care-${suffix}`,
      patientId,
      encounterId,
      `consent-care-${suffix}-v1`,
      occurredAt,
      occurredAt,
    );
}

export function seedReferral(
  database: DatabaseSync,
  suffix: string,
  patientId: string,
  encounterId: string,
  createdAt: number,
) {
  const requestId = `referral-${suffix}`;
  const draftId = `referral-${suffix}-v1`;
  const activeId = `referral-${suffix}-v2`;
  const encounter = database
    .prepare(`
      select clinician_membership_id as clinicianMembershipId
      from encounters where id = ?
    `)
    .get(encounterId) as { clinicianMembershipId: string };
  const authorMembershipId = encounter.clinicianMembershipId;
  const accessAssignmentId =
    authorMembershipId === 'persona-doctor-member'
      ? 'persona-doctor-assignment'
      : 'persona-doctor-assignment';
  database
    .prepare(`
      insert into service_requests (
        id, organization_id, facility_id, patient_id, encounter_id,
        request_kind, created_by_membership_id, access_assignment_id, created_at
      ) values (
        ?, 'org-a', 'fac-a', ?, ?, 'referral', ?, ?, ?
      )
    `)
    .run(
      requestId,
      patientId,
      encounterId,
      authorMembershipId,
      accessAssignmentId,
      createdAt,
    );
  database
    .prepare(`
      insert into service_request_versions (
        id, organization_id, facility_id, service_request_id, version,
        supersedes_version_id, status, priority, requested_service,
        target_specialty, medical_justification, clinician_note,
        status_reason, authored_by_membership_id,
        access_assignment_id, approved_by_membership_id, approved_at, created_at
      ) values (
        ?, 'org-a', 'fac-a', ?, 1, null, 'draft', 'routine',
        'Консультация эндокринолога', 'Эндокринология',
        'Синтетическое направление для проверки расписания', null, null,
        ?, ?, null, null, ?
      )
    `)
    .run(
      draftId,
      requestId,
      authorMembershipId,
      accessAssignmentId,
      createdAt,
    );
  database
    .prepare(`
      insert into service_request_heads (
        id, organization_id, facility_id, service_request_id,
        current_version_id, lock_version, created_at, updated_at
      ) values (?, 'org-a', 'fac-a', ?, ?, 1, ?, ?)
    `)
    .run(`referral-${suffix}-head`, requestId, draftId, createdAt, createdAt);
  database
    .prepare(`
      insert into service_request_versions (
        id, organization_id, facility_id, service_request_id, version,
        supersedes_version_id, status, priority, requested_service,
        target_specialty, medical_justification, clinician_note,
        status_reason, authored_by_membership_id,
        access_assignment_id, approved_by_membership_id, approved_at, created_at
      ) values (
        ?, 'org-a', 'fac-a', ?, 2, ?, 'active', 'routine',
        'Консультация эндокринолога', 'Эндокринология',
        'Синтетическое направление для проверки расписания', null,
        'Проверено врачом', ?, ?, ?, ?, ?
      )
    `)
    .run(
      activeId,
      requestId,
      draftId,
      authorMembershipId,
      accessAssignmentId,
      authorMembershipId,
      createdAt + 1,
      createdAt + 1,
    );
  database
    .prepare(`
      update service_request_heads
      set current_version_id = ?, lock_version = 2, updated_at = ?
      where service_request_id = ? and lock_version = 1
    `)
    .run(activeId, createdAt + 1, requestId);
  return { requestId, versionId: activeId };
}

export function seedSchedule(database: DatabaseSync, now: number) {
  const source = SYNTHETIC_SCHEDULE_SOURCE_LABEL;
  database
    .prepare(`
      insert into scheduling_specialties (
        id, organization_id, facility_id, code, display_name, status,
        source_type, source_label, source_system, source_record_id,
        source_revision, source_observed_at, created_at
      ) values (
        'specialty-endocrinology', 'org-a', 'fac-a', 'ENDO',
        'Эндокринология', 'active', 'manual_test', ?, 'orion-test-manual',
        'specialty-endo', 'revision-1', ?, ?
      )
    `)
    .run(source, now, now);
  database
    .prepare(`
      insert into scheduling_services (
        id, organization_id, facility_id, specialty_id, code, display_name,
        duration_minutes, status, source_type, source_label, source_system,
        source_record_id, source_revision, source_observed_at, created_at
      ) values (
        'service-endocrinology-first', 'org-a', 'fac-a',
        'specialty-endocrinology', 'ENDO-FIRST',
        'Первичная консультация эндокринолога', 30, 'active',
        'manual_test', ?, 'orion-test-manual', 'service-endo-first',
        'revision-1', ?, ?
      )
    `)
    .run(source, now, now);
  database
    .prepare(`
      insert into scheduling_providers (
        id, organization_id, facility_id, specialty_id, display_name, status,
        source_type, source_label, source_system, source_record_id,
        source_revision, source_observed_at, created_at
      ) values (
        'provider-endocrinologist', 'org-a', 'fac-a',
        'specialty-endocrinology', 'Врач Эндокринолог', 'active',
        'manual_test', ?, 'orion-test-manual', 'provider-endo',
        'revision-1', ?, ?
      )
    `)
    .run(source, now, now);
  database
    .prepare(`
      insert into provider_schedules (
        id, organization_id, facility_id, provider_id, service_id, timezone,
        valid_from, valid_to, status, source_type, source_label, source_system,
        source_record_id, source_revision, source_observed_at, created_at
      ) values (
        'schedule-endocrinologist', 'org-a', 'fac-a',
        'provider-endocrinologist', 'service-endocrinology-first',
        'Asia/Almaty', ?, ?, 'active', 'manual_test', ?,
        'orion-test-manual', 'schedule-endo', 'revision-1', ?, ?
      )
    `)
    .run(now - 60_000, now + 86_400_000, source, now, now);

  const startsAt = [now + 3_600_000, now + 7_200_000];
  for (const [index, start] of startsAt.entries()) {
    const slotId = `slot-${index + 1}`;
    const versionId = `${slotId}-v1`;
    database
      .prepare(`
        insert into appointment_slots (
          id, organization_id, facility_id, schedule_id, provider_id,
          service_id, starts_at, ends_at, source_type, source_label,
          source_system, source_record_id, source_revision,
          source_observed_at, created_at
        ) values (
          ?, 'org-a', 'fac-a', 'schedule-endocrinologist',
          'provider-endocrinologist', 'service-endocrinology-first', ?, ?,
          'manual_test', ?, 'orion-test-manual', ?, 'revision-1', ?, ?
        )
      `)
      .run(slotId, start, start + 1_800_000, source, slotId, now, now);
    database
      .prepare(`
        insert into appointment_slot_versions (
          id, organization_id, facility_id, slot_id, version,
          supersedes_version_id, status, appointment_id, patient_id,
          referral_request_id, referral_version_id, held_by_membership_id,
          hold_expires_at, change_reason, changed_by_membership_id,
          access_assignment_id, created_at
        ) values (
          ?, 'org-a', 'fac-a', ?, 1, null, 'available', null, null,
          null, null, null, null, 'Ручное тестовое время доступно',
          'persona-doctor-member', 'persona-doctor-assignment', ?
        )
      `)
      .run(versionId, slotId, now);
    database
      .prepare(`
        insert into appointment_slot_heads (
          id, organization_id, facility_id, slot_id, current_version_id,
          lock_version, created_at, updated_at
        ) values (?, 'org-a', 'fac-a', ?, ?, 1, ?, ?)
      `)
      .run(`${slotId}-head`, slotId, versionId, now, now);
  }
  return { firstSlotStartsAt: startsAt[0] };
}
