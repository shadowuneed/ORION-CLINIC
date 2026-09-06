-- Explicit synthetic Phase 8A engineering fixture.
-- Run only after db:seed:local; normal ORION startup does not insert this record.

INSERT INTO patient_observation_records (
  id, organization_id, facility_id, patient_id, source_type, source_label,
  created_by_membership_id, access_assignment_id, created_at
)
SELECT
  'observation-local-a', 'org-a', 'fac-a', 'patient-a', 'manual_test',
  'Локальный ручной ввод · тестовые данные', 'membership-a',
  'access-assignment-a-general-medicine', 1788595200000
WHERE NOT EXISTS (
  SELECT 1 FROM patient_observation_records WHERE id = 'observation-local-a'
);

INSERT INTO patient_observation_versions (
  id, organization_id, facility_id, observation_id, patient_id,
  version, supersedes_version_id, measured_at, measurement_context,
  height_mm, height_unit, weight_grams, weight_unit, bmi_hundredths, bmi_unit,
  systolic_mmhg, diastolic_mmhg, pressure_unit,
  temperature_milli_c, temperature_unit, note,
  recorded_by_membership_id, access_assignment_id, recorded_at,
  change_reason, input_hash, created_at
)
SELECT
  'observation-version-local-a-v1', 'org-a', 'fac-a',
  'observation-local-a', 'patient-a', 1, NULL, 1788594900000, 'pre_visit',
  1650, 'mm', 64000, 'g', 2351, 'kg_m2',
  118, 76, 'mmHg', 36500, 'milli_celsius',
  'Синтетические показатели для проверки интерфейса.',
  'membership-a', 'access-assignment-a-general-medicine',
  1788595200000, 'Первичная тестовая запись',
  'cccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc',
  1788595200000
WHERE NOT EXISTS (
  SELECT 1 FROM patient_observation_versions
  WHERE id = 'observation-version-local-a-v1'
);

INSERT INTO patient_observation_heads (
  id, organization_id, facility_id, observation_id, patient_id,
  current_version_id, lock_version, created_at, updated_at
)
SELECT
  'observation-head-local-a', 'org-a', 'fac-a', 'observation-local-a',
  'patient-a', 'observation-version-local-a-v1', 1,
  1788595200000, 1788595200000
WHERE NOT EXISTS (
  SELECT 1 FROM patient_observation_heads WHERE id = 'observation-head-local-a'
);
