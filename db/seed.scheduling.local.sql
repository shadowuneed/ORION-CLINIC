-- Explicit Phase 5 fixture for the local, synthetic-only scheduling contour.
-- This is a manual test schedule. It is not sourced from KMIS and must never be
-- represented as authoritative clinic availability.

INSERT INTO service_requests (
  id, organization_id, facility_id, patient_id, encounter_id,
  request_kind, created_by_membership_id, created_at
)
SELECT
  'service-request-scheduling-referral', 'org-a', 'fac-a',
  'patient-a-lifecycle', 'encounter-a-lifecycle', 'referral',
  'membership-a', 1788595200000
WHERE NOT EXISTS (
  SELECT 1 FROM service_requests
  WHERE id = 'service-request-scheduling-referral'
);

INSERT INTO service_request_versions (
  id, organization_id, facility_id, service_request_id, version,
  supersedes_version_id, status, priority, requested_service,
  target_specialty, medical_justification, clinician_note, status_reason,
  authored_by_membership_id, approved_by_membership_id, approved_at, created_at
)
SELECT
  'service-request-version-scheduling-referral-v1', 'org-a', 'fac-a',
  'service-request-scheduling-referral', 1, NULL, 'draft', 'routine',
  'Первичная консультация эндокринолога', 'Эндокринология',
  'Синтетическое направление для проверки локального контура записи.',
  'Только тестовые данные, без передачи во внешнюю систему.',
  'Создано из локального синтетического набора',
  'membership-a', NULL, NULL, 1788595201000
WHERE NOT EXISTS (
  SELECT 1 FROM service_request_versions
  WHERE id = 'service-request-version-scheduling-referral-v1'
);

INSERT INTO service_request_heads (
  id, organization_id, facility_id, service_request_id,
  current_version_id, lock_version, created_at, updated_at
)
SELECT
  'service-request-head-scheduling-referral', 'org-a', 'fac-a',
  'service-request-scheduling-referral',
  'service-request-version-scheduling-referral-v1', 1,
  1788595201000, 1788595201000
WHERE NOT EXISTS (
  SELECT 1 FROM service_request_heads
  WHERE id = 'service-request-head-scheduling-referral'
);

INSERT INTO service_request_versions (
  id, organization_id, facility_id, service_request_id, version,
  supersedes_version_id, status, priority, requested_service,
  target_specialty, medical_justification, clinician_note, status_reason,
  authored_by_membership_id, approved_by_membership_id, approved_at, created_at
)
SELECT
  'service-request-version-scheduling-referral-v2', 'org-a', 'fac-a',
  'service-request-scheduling-referral', 2,
  'service-request-version-scheduling-referral-v1', 'active', 'routine',
  'Первичная консультация эндокринолога', 'Эндокринология',
  'Синтетическое направление для проверки локального контура записи.',
  'Только тестовые данные, без передачи во внешнюю систему.',
  'Подтверждено врачом в синтетическом контуре',
  'membership-a', 'membership-a', 1788595260000, 1788595260000
WHERE NOT EXISTS (
  SELECT 1 FROM service_request_versions
  WHERE id = 'service-request-version-scheduling-referral-v2'
);

UPDATE service_request_heads
SET current_version_id = 'service-request-version-scheduling-referral-v2',
    lock_version = 2,
    updated_at = 1788595260000
WHERE id = 'service-request-head-scheduling-referral'
  AND current_version_id = 'service-request-version-scheduling-referral-v1'
  AND lock_version = 1;

INSERT INTO scheduling_specialties (
  id, organization_id, facility_id, code, display_name, status,
  source_type, source_label, source_system, source_record_id,
  source_revision, source_observed_at, created_at
)
SELECT
  'specialty-endocrinology-manual', 'org-a', 'fac-a', 'ENDO',
  'Эндокринология', 'active', 'manual_test',
  'Тестовое ручное расписание · не КМИС', 'orion-local-manual',
  'specialty-endo', 'fixture-2026-09', 1788595200000, 1788595200000
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling_specialties
  WHERE id = 'specialty-endocrinology-manual'
);

INSERT INTO scheduling_services (
  id, organization_id, facility_id, specialty_id, code, display_name,
  duration_minutes, status, source_type, source_label, source_system,
  source_record_id, source_revision, source_observed_at, created_at
)
SELECT
  'service-endocrinology-initial-manual', 'org-a', 'fac-a',
  'specialty-endocrinology-manual', 'ENDO-INITIAL',
  'Первичная консультация эндокринолога', 30, 'active', 'manual_test',
  'Тестовое ручное расписание · не КМИС', 'orion-local-manual',
  'service-endo-initial', 'fixture-2026-09', 1788595200000, 1788595200000
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling_services
  WHERE id = 'service-endocrinology-initial-manual'
);

INSERT INTO scheduling_providers (
  id, organization_id, facility_id, specialty_id, display_name, status,
  source_type, source_label, source_system, source_record_id,
  source_revision, source_observed_at, created_at
)
SELECT
  'provider-endocrinologist-manual', 'org-a', 'fac-a',
  'specialty-endocrinology-manual', 'Врач-эндокринолог · тестовый профиль',
  'active', 'manual_test', 'Тестовое ручное расписание · не КМИС',
  'orion-local-manual', 'provider-endo-01', 'fixture-2026-09',
  1788595200000, 1788595200000
WHERE NOT EXISTS (
  SELECT 1 FROM scheduling_providers
  WHERE id = 'provider-endocrinologist-manual'
);

INSERT INTO provider_schedules (
  id, organization_id, facility_id, provider_id, service_id, timezone,
  valid_from, valid_to, status, source_type, source_label, source_system,
  source_record_id, source_revision, source_observed_at, created_at
)
SELECT
  'schedule-endocrinology-manual-2027-01', 'org-a', 'fac-a',
  'provider-endocrinologist-manual', 'service-endocrinology-initial-manual',
  'Asia/Qyzylorda', 1798761600000, 1801440000000, 'active', 'manual_test',
  'Тестовое ручное расписание · не КМИС', 'orion-local-manual',
  'schedule-endo-2027-01', 'fixture-2026-09', 1788595200000, 1788595200000
WHERE NOT EXISTS (
  SELECT 1 FROM provider_schedules
  WHERE id = 'schedule-endocrinology-manual-2027-01'
);

INSERT INTO appointment_slots (
  id, organization_id, facility_id, schedule_id, provider_id, service_id,
  starts_at, ends_at, source_type, source_label, source_system,
  source_record_id, source_revision, source_observed_at, created_at
)
SELECT
  column1, 'org-a', 'fac-a', 'schedule-endocrinology-manual-2027-01',
  'provider-endocrinologist-manual', 'service-endocrinology-initial-manual',
  column2, column3, 'manual_test',
  'Тестовое ручное расписание · не КМИС', 'orion-local-manual',
  column4, 'fixture-2026-09', 1788595200000, 1788595200000
FROM (VALUES
  ('slot-endo-2027-01-14-0800', 1799895600000, 1799897400000, 'slot-endo-20270114-0800'),
  ('slot-endo-2027-01-14-0900', 1799899200000, 1799901000000, 'slot-endo-20270114-0900'),
  ('slot-endo-2027-01-15-1000', 1799989200000, 1799991000000, 'slot-endo-20270115-1000'),
  ('slot-endo-2027-01-16-1400', 1800090000000, 1800091800000, 'slot-endo-20270116-1400')
)
WHERE NOT EXISTS (
  SELECT 1 FROM appointment_slots existing WHERE existing.id = column1
);

INSERT INTO appointment_slot_versions (
  id, organization_id, facility_id, slot_id, version,
  supersedes_version_id, status, appointment_id, patient_id,
  referral_request_id, referral_version_id, held_by_membership_id,
  hold_expires_at, change_reason, changed_by_membership_id, created_at
)
SELECT
  'version-' || column1 || '-v1', 'org-a', 'fac-a', column1, 1,
  NULL, 'available', NULL, NULL, NULL, NULL, NULL, NULL,
  'Создано из явно обозначенного ручного тестового расписания',
  'membership-a', 1788595200000
FROM (VALUES
  ('slot-endo-2027-01-14-0800'),
  ('slot-endo-2027-01-14-0900'),
  ('slot-endo-2027-01-15-1000'),
  ('slot-endo-2027-01-16-1400')
)
WHERE NOT EXISTS (
  SELECT 1 FROM appointment_slot_versions existing
  WHERE existing.id = 'version-' || column1 || '-v1'
);

INSERT INTO appointment_slot_heads (
  id, organization_id, facility_id, slot_id, current_version_id,
  lock_version, created_at, updated_at
)
SELECT
  'head-' || column1, 'org-a', 'fac-a', column1,
  'version-' || column1 || '-v1', 1, 1788595200000, 1788595200000
FROM (VALUES
  ('slot-endo-2027-01-14-0800'),
  ('slot-endo-2027-01-14-0900'),
  ('slot-endo-2027-01-15-1000'),
  ('slot-endo-2027-01-16-1400')
)
WHERE NOT EXISTS (
  SELECT 1 FROM appointment_slot_heads existing
  WHERE existing.id = 'head-' || column1
);
