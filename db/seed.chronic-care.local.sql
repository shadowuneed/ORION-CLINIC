-- Explicit, rerunnable Phase 6 fixture for the local synthetic-only contour.
-- Nothing here represents a real patient, diagnosis, medicine, registry entry,
-- ERDB/PUZ submission, entitlement, message, or clinical recommendation.

INSERT OR IGNORE INTO users (
  id, external_issuer, external_subject, display_name, status
) VALUES (
  'user-care-nurse', 'orion:synthetic', 'local-care-nurse',
  'М. Тестовая', 'active'
);

INSERT OR IGNORE INTO memberships (
  id, organization_id, facility_id, user_id, role, status
) VALUES (
  'membership-care-nurse', 'org-a', 'fac-a',
  'user-care-nurse', 'nurse', 'active'
);

INSERT OR IGNORE INTO patients (
  id, organization_id, facility_id, medical_record_number, display_name,
  birth_date, sex_at_birth, status, created_at, updated_at
) VALUES (
  'patient-care-a', 'org-a', 'fac-a', 'SYN-CARE-01',
  'Тестовый пациент Н.', '1978-05-16', 'not_recorded', 'active',
  1788300000000, 1788300000000
);

INSERT OR IGNORE INTO encounters (
  id, organization_id, facility_id, patient_id, clinician_membership_id,
  status, reason_for_visit, started_at, ended_at, finalized_at,
  created_at, updated_at, version
) VALUES (
  'encounter-care-a', 'org-a', 'fac-a', 'patient-care-a', 'membership-a',
  'finalized', 'Синтетический эндокринологический приём для проверки наблюдения',
  1788386400000, 1788390000000, 1788390000000,
  1788386400000, 1788390000000, 1
);

INSERT OR IGNORE INTO protocol_versions (
  id, organization_id, facility_id, encounter_id, version, status,
  content_json, source_hash, created_by_membership_id,
  signed_by_membership_id, signed_at, supersedes_protocol_version_id,
  created_at
) VALUES (
  'protocol-care-a-v1', 'org-a', 'fac-a', 'encounter-care-a', 1, 'draft',
  '{"fixture":"synthetic chronic-care basis"}',
  'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
  'membership-a', NULL, NULL, NULL, 1788387000000
);

INSERT INTO protocol_heads (
  id, organization_id, facility_id, encounter_id,
  current_protocol_version_id, current_signed_protocol_version_id,
  lock_version, updated_at
)
SELECT
  'protocol-head-care-a', 'org-a', 'fac-a', 'encounter-care-a',
  'protocol-care-a-v1', NULL, 1, 1788387000000
WHERE NOT EXISTS (
  SELECT 1 FROM protocol_heads WHERE id = 'protocol-head-care-a'
);

INSERT OR IGNORE INTO protocol_versions (
  id, organization_id, facility_id, encounter_id, version, status,
  content_json, source_hash, created_by_membership_id,
  signed_by_membership_id, signed_at, supersedes_protocol_version_id,
  created_at
) VALUES (
  'protocol-care-a-v2', 'org-a', 'fac-a', 'encounter-care-a', 2, 'signed',
  '{"fixture":"synthetic chronic-care basis","doctorConfirmed":true}',
  'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
  'membership-a', 'membership-a', 1788390000000,
  'protocol-care-a-v1', 1788390000000
);

UPDATE protocol_heads
SET current_protocol_version_id = 'protocol-care-a-v2',
  current_signed_protocol_version_id = 'protocol-care-a-v2',
  lock_version = 2,
  updated_at = 1788390000000
WHERE id = 'protocol-head-care-a'
  AND current_protocol_version_id = 'protocol-care-a-v1'
  AND lock_version = 1;

INSERT INTO chronic_registry_enrollments (
  id, organization_id, facility_id, patient_id, registry_code,
  source_type, source_label, managing_clinician_membership_id,
  created_by_membership_id, access_assignment_id, created_at
)
SELECT
  'chronic-enrollment-care-a', 'org-a', 'fac-a', 'patient-care-a',
  'SYN-ENDO-01', 'local_test',
  'Локальное тестовое наблюдение · не ЭРДБ/ПУЗ',
  'membership-a', 'membership-a',
  'access-assignment-a-general-medicine', 1788390300000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_registry_enrollments
  WHERE id = 'chronic-enrollment-care-a'
);

INSERT INTO chronic_registry_enrollment_versions (
  id, organization_id, facility_id, enrollment_id, version,
  supersedes_version_id, status, basis_encounter_id,
  basis_protocol_version_id, diagnosis_display, diagnosis_code,
  diagnosis_basis, decision_reason, decided_by_membership_id,
  access_assignment_id, decided_at, created_at
)
SELECT
  'chronic-enrollment-care-a-v1', 'org-a', 'fac-a',
  'chronic-enrollment-care-a', 1, NULL, 'active',
  'encounter-care-a', 'protocol-care-a-v2',
  'Нарушение углеводного обмена — тестовый сценарий', 'SYN-ENDO-01',
  'Синтетическое решение врача по текущему подписанному протоколу; не является диагнозом реального пациента.',
  'Включение в локальный тестовый контур наблюдения',
  'membership-a', 'access-assignment-a-general-medicine',
  1788390300000, 1788390300000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_registry_enrollment_versions
  WHERE id = 'chronic-enrollment-care-a-v1'
);

INSERT INTO chronic_registry_enrollment_heads (
  id, organization_id, facility_id, enrollment_id, current_version_id,
  lock_version, created_at, updated_at
)
SELECT
  'chronic-enrollment-head-care-a', 'org-a', 'fac-a',
  'chronic-enrollment-care-a', 'chronic-enrollment-care-a-v1',
  1, 1788390300000, 1788390300000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_registry_enrollment_heads
  WHERE id = 'chronic-enrollment-head-care-a'
);

INSERT INTO chronic_care_plans (
  id, organization_id, facility_id, enrollment_id, patient_id,
  created_by_membership_id, access_assignment_id, created_at
)
SELECT
  'chronic-care-plan-care-a', 'org-a', 'fac-a',
  'chronic-enrollment-care-a', 'patient-care-a',
  'membership-a', 'access-assignment-a-general-medicine', 1788390600000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_plans WHERE id = 'chronic-care-plan-care-a'
);

INSERT INTO chronic_care_plan_versions (
  id, organization_id, facility_id, care_plan_id, enrollment_id,
  enrollment_version_id, version, supersedes_version_id,
  effective_from, effective_to, goals_json, treatment_plan, diet_plan,
  medications_json, task_blueprints_json, content_hash,
  signed_by_membership_id, access_assignment_id, signed_at, change_reason, created_at
)
SELECT
  'chronic-care-plan-care-a-v1', 'org-a', 'fac-a',
  'chronic-care-plan-care-a', 'chronic-enrollment-care-a',
  'chronic-enrollment-care-a-v1', 1, NULL,
  '2026-08-20', '2027-02-28',
  '["Контроль тестовых показателей самочувствия","Соблюдение согласованного врачом плана"]',
  'Синтетический план мероприятий для проверки диспансерного наблюдения. Клиническое решение принимает врач.',
  'Синтетический план питания для проверки интерфейса. Не является рекомендацией реальному пациенту.',
  '[{"name":"Тестовый препарат A","dose":"1 условная единица","route":"условно","schedule":"по тестовому расписанию","startsOn":"2026-08-20","endsOn":null,"instructions":"Синтетическая запись, не медицинское назначение."}]',
  '[{"key":"nurse-contact-overdue","kind":"nurse_contact","title":"Уточнить самочувствие пациента","dueDate":"2026-09-01","ownerRole":"nurse","assignedMembershipId":"membership-care-nurse","instructions":"Записать ответ пациента без постановки диагноза."},{"key":"nurse-contact-soon","kind":"nurse_contact","title":"Повторный контакт медсестры","dueDate":"2026-09-09","ownerRole":"nurse","assignedMembershipId":"membership-care-nurse","instructions":"Уточнить выполнение плана и передать отклонения врачу."},{"key":"doctor-follow-up","kind":"follow_up_visit","title":"Контрольный приём врача","dueDate":"2026-10-15","ownerRole":"clinician","assignedMembershipId":"membership-a","instructions":"Врач проверяет динамику и принимает клиническое решение."}]',
  '311bc8f88c536fdc5ad1086dc345737403480e5b5253614b981fa4d113903243',
  'membership-a', 'access-assignment-a-general-medicine', 1788390600000,
  'Синтетическая подписанная версия для проверки этапа 6',
  1788390600000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_plan_versions
  WHERE id = 'chronic-care-plan-care-a-v1'
);

INSERT INTO chronic_care_plan_heads (
  id, organization_id, facility_id, care_plan_id, current_version_id,
  lock_version, created_at, updated_at
)
SELECT
  'chronic-care-plan-head-care-a', 'org-a', 'fac-a',
  'chronic-care-plan-care-a', 'chronic-care-plan-care-a-v1',
  1, 1788390600000, 1788390600000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_plan_heads
  WHERE id = 'chronic-care-plan-head-care-a'
);

INSERT INTO chronic_care_tasks (
  id, organization_id, facility_id, enrollment_id, care_plan_id,
  source_plan_version_id, patient_id, blueprint_key, kind, title,
  owner_role, assigned_membership_id, access_assignment_id, created_at
)
SELECT
  'chronic-task-care-overdue', 'org-a', 'fac-a',
  'chronic-enrollment-care-a', 'chronic-care-plan-care-a',
  'chronic-care-plan-care-a-v1', 'patient-care-a',
  'nurse-contact-overdue', 'nurse_contact',
  'Уточнить самочувствие пациента', 'nurse',
  'membership-care-nurse', 'access-assignment-a-general-medicine', 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_tasks WHERE id = 'chronic-task-care-overdue'
);

INSERT INTO chronic_care_tasks (
  id, organization_id, facility_id, enrollment_id, care_plan_id,
  source_plan_version_id, patient_id, blueprint_key, kind, title,
  owner_role, assigned_membership_id, access_assignment_id, created_at
)
SELECT
  'chronic-task-care-soon', 'org-a', 'fac-a',
  'chronic-enrollment-care-a', 'chronic-care-plan-care-a',
  'chronic-care-plan-care-a-v1', 'patient-care-a',
  'nurse-contact-soon', 'nurse_contact',
  'Повторный контакт медсестры', 'nurse',
  'membership-care-nurse', 'access-assignment-a-general-medicine', 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_tasks WHERE id = 'chronic-task-care-soon'
);

INSERT INTO chronic_care_tasks (
  id, organization_id, facility_id, enrollment_id, care_plan_id,
  source_plan_version_id, patient_id, blueprint_key, kind, title,
  owner_role, assigned_membership_id, access_assignment_id, created_at
)
SELECT
  'chronic-task-care-follow-up', 'org-a', 'fac-a',
  'chronic-enrollment-care-a', 'chronic-care-plan-care-a',
  'chronic-care-plan-care-a-v1', 'patient-care-a',
  'doctor-follow-up', 'follow_up_visit',
  'Контрольный приём врача', 'clinician',
  'membership-a', 'access-assignment-a-general-medicine', 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_tasks WHERE id = 'chronic-task-care-follow-up'
);

INSERT INTO chronic_care_task_versions (
  id, organization_id, facility_id, task_id, version,
  supersedes_version_id, status, due_date, instructions,
  contact_method, wellbeing, response_summary, responded_at,
  escalation_reason, escalated_at, completed_at, change_reason,
  changed_by_membership_id, access_assignment_id, created_at
)
SELECT
  'chronic-task-care-overdue-v1', 'org-a', 'fac-a',
  'chronic-task-care-overdue', 1, NULL, 'pending', '2026-09-01',
  'Записать ответ пациента без постановки диагноза.',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  'Создано из подписанной тестовой версии плана',
  'membership-a', 'access-assignment-a-general-medicine', 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_task_versions
  WHERE id = 'chronic-task-care-overdue-v1'
);

INSERT INTO chronic_care_task_versions (
  id, organization_id, facility_id, task_id, version,
  supersedes_version_id, status, due_date, instructions,
  contact_method, wellbeing, response_summary, responded_at,
  escalation_reason, escalated_at, completed_at, change_reason,
  changed_by_membership_id, access_assignment_id, created_at
)
SELECT
  'chronic-task-care-soon-v1', 'org-a', 'fac-a',
  'chronic-task-care-soon', 1, NULL, 'pending', '2026-09-09',
  'Уточнить выполнение плана и передать отклонения врачу.',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  'Создано из подписанной тестовой версии плана',
  'membership-a', 'access-assignment-a-general-medicine', 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_task_versions
  WHERE id = 'chronic-task-care-soon-v1'
);

INSERT INTO chronic_care_task_versions (
  id, organization_id, facility_id, task_id, version,
  supersedes_version_id, status, due_date, instructions,
  contact_method, wellbeing, response_summary, responded_at,
  escalation_reason, escalated_at, completed_at, change_reason,
  changed_by_membership_id, access_assignment_id, created_at
)
SELECT
  'chronic-task-care-follow-up-v1', 'org-a', 'fac-a',
  'chronic-task-care-follow-up', 1, NULL, 'pending', '2026-10-15',
  'Врач проверяет динамику и принимает клиническое решение.',
  NULL, NULL, NULL, NULL, NULL, NULL, NULL,
  'Создано из подписанной тестовой версии плана',
  'membership-a', 'access-assignment-a-general-medicine', 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_task_versions
  WHERE id = 'chronic-task-care-follow-up-v1'
);

INSERT INTO chronic_care_task_heads (
  id, organization_id, facility_id, task_id, current_version_id,
  lock_version, created_at, updated_at
)
SELECT
  'chronic-task-head-care-overdue', 'org-a', 'fac-a',
  'chronic-task-care-overdue', 'chronic-task-care-overdue-v1',
  1, 1788390900000, 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_task_heads
  WHERE id = 'chronic-task-head-care-overdue'
);

INSERT INTO chronic_care_task_heads (
  id, organization_id, facility_id, task_id, current_version_id,
  lock_version, created_at, updated_at
)
SELECT
  'chronic-task-head-care-soon', 'org-a', 'fac-a',
  'chronic-task-care-soon', 'chronic-task-care-soon-v1',
  1, 1788390900000, 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_task_heads
  WHERE id = 'chronic-task-head-care-soon'
);

INSERT INTO chronic_care_task_heads (
  id, organization_id, facility_id, task_id, current_version_id,
  lock_version, created_at, updated_at
)
SELECT
  'chronic-task-head-care-follow-up', 'org-a', 'fac-a',
  'chronic-task-care-follow-up', 'chronic-task-care-follow-up-v1',
  1, 1788390900000, 1788390900000
WHERE NOT EXISTS (
  SELECT 1 FROM chronic_care_task_heads
  WHERE id = 'chronic-task-head-care-follow-up'
);
