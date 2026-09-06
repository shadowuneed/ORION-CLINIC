INSERT OR IGNORE INTO organizations (id, name)
VALUES ('org-a', 'ORION Synthetic Clinic');

INSERT OR IGNORE INTO facilities (id, organization_id, name)
VALUES ('fac-a', 'org-a', 'Synthetic Main Facility');

INSERT OR IGNORE INTO users (
  id, external_issuer, external_subject, display_name, status
) VALUES (
  'user-a', 'openai:sites', 'local_seedy',
  'А. Сейдахметова', 'active'
);

UPDATE users
SET external_issuer = 'openai:sites', external_subject = 'local_seedy'
WHERE id = 'user-a'
  AND external_issuer = 'orion:synthetic'
  AND external_subject = 'synthetic-clinician';

INSERT OR IGNORE INTO memberships (
  id, organization_id, facility_id, user_id, role, status
) VALUES (
  'membership-a', 'org-a', 'fac-a', 'user-a', 'clinician', 'active'
);

INSERT OR IGNORE INTO users (
  id, external_issuer, external_subject, display_name, status
) VALUES
  ('access-user-nurse-b', 'orion:synthetic', 'synthetic-access-nurse-b', 'Медсестра Б.', 'active'),
  ('access-user-registrar-c', 'orion:synthetic', 'synthetic-access-registrar-c', 'Регистратор В.', 'active');

INSERT OR IGNORE INTO memberships (
  id, organization_id, facility_id, user_id, role, status
) VALUES
  ('access-membership-nurse-b', 'org-a', 'fac-a', 'access-user-nurse-b', 'nurse', 'active'),
  ('access-membership-registrar-c', 'org-a', 'fac-a', 'access-user-registrar-c', 'registrar', 'active');

INSERT OR IGNORE INTO departments (
  id, organization_id, facility_id, code, name, kind, status
) VALUES (
  'department-a-general-medicine', 'org-a', 'fac-a',
  'general_medicine', 'Общая медицина', 'clinical', 'active'
);

INSERT INTO department_versions (
  id, organization_id, facility_id, department_id, version,
  supersedes_version_id, name, kind, status, change_reason,
  changed_by_membership_id, changed_at, created_at
)
SELECT
  'department-a-general-medicine-v1', 'org-a', 'fac-a',
  'department-a-general-medicine', 1, NULL, 'Общая медицина', 'clinical',
  'active', 'synthetic_local_department_bootstrap', 'membership-a',
  1704067200000, 1704067200000
WHERE NOT EXISTS (
  SELECT 1 FROM department_versions
  WHERE id = 'department-a-general-medicine-v1'
);

INSERT INTO department_heads (
  id, organization_id, facility_id, department_id, current_version_id,
  lock_version, created_at, updated_at
)
SELECT
  'department-head-a-general-medicine', 'org-a', 'fac-a',
  'department-a-general-medicine', 'department-a-general-medicine-v1', 1,
  1704067200000, 1704067200000
WHERE NOT EXISTS (
  SELECT 1 FROM department_heads
  WHERE id = 'department-head-a-general-medicine'
);

INSERT INTO department_access_assignments (
  id, organization_id, facility_id, department_id, membership_id,
  created_by_membership_id, created_at
)
SELECT
  'access-assignment-a-general-medicine', 'org-a', 'fac-a',
  'department-a-general-medicine', 'membership-a', 'membership-a', 1704067200000
WHERE NOT EXISTS (
  SELECT 1 FROM department_access_assignments
  WHERE id = 'access-assignment-a-general-medicine'
);

INSERT INTO department_access_assignment_versions (
  id, organization_id, facility_id, assignment_id, department_id,
  membership_id, version, supersedes_version_id, status, source_type,
  roles_json, allow_permissions_json, deny_permissions_json,
  effective_from, effective_until, change_reason,
  changed_by_membership_id, changed_at, created_at
)
SELECT
  'access-assignment-a-general-medicine-v1', 'org-a', 'fac-a',
  'access-assignment-a-general-medicine', 'department-a-general-medicine',
  'membership-a', 1, NULL, 'active', 'bootstrap',
  '["doctor"]', '[]', '[]', 1704067200000, NULL,
  'synthetic_local_access_bootstrap', 'membership-a',
  1704067200000, 1704067200000
WHERE NOT EXISTS (
  SELECT 1 FROM department_access_assignment_versions
  WHERE id = 'access-assignment-a-general-medicine-v1'
);

INSERT INTO department_access_assignment_heads (
  id, organization_id, facility_id, assignment_id, department_id,
  membership_id, current_version_id, lock_version, created_at, updated_at
)
SELECT
  'access-assignment-head-a-general-medicine', 'org-a', 'fac-a',
  'access-assignment-a-general-medicine', 'department-a-general-medicine',
  'membership-a', 'access-assignment-a-general-medicine-v1', 1,
  1704067200000, 1704067200000
WHERE NOT EXISTS (
  SELECT 1 FROM department_access_assignment_heads
  WHERE id = 'access-assignment-head-a-general-medicine'
);

INSERT INTO department_access_assignment_versions (
  id, organization_id, facility_id, assignment_id, department_id,
  membership_id, version, supersedes_version_id, status, source_type,
  roles_json, allow_permissions_json, deny_permissions_json,
  effective_from, effective_until, change_reason,
  changed_by_membership_id, changed_at, created_at
)
SELECT
  'access-assignment-a-general-medicine-local-admin',
  current.organization_id, current.facility_id, current.assignment_id,
  current.department_id, current.membership_id, current.version + 1,
  current.id, 'active', 'bootstrap', '["doctor","administrator"]',
  current.allow_permissions_json, current.deny_permissions_json,
  current.effective_from, current.effective_until,
  'synthetic_local_access_administration', 'membership-a',
  CASE WHEN current.changed_at >= 1788652800000
    THEN current.changed_at + 1 ELSE 1788652800000 END,
  CASE WHEN current.changed_at >= 1788652800000
    THEN current.changed_at + 1 ELSE 1788652800000 END
FROM department_access_assignment_heads head
JOIN department_access_assignment_versions current
  ON current.id = head.current_version_id
WHERE head.id = 'access-assignment-head-a-general-medicine'
  AND NOT EXISTS (
    SELECT 1 FROM json_each(current.roles_json) WHERE value = 'administrator'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(current.allow_permissions_json)
    WHERE value = 'access.manage'
  )
  AND NOT EXISTS (
    SELECT 1 FROM department_access_assignment_versions
    WHERE id = 'access-assignment-a-general-medicine-local-admin'
  );

UPDATE department_access_assignment_heads
SET current_version_id = 'access-assignment-a-general-medicine-local-admin',
  lock_version = lock_version + 1,
  updated_at = (
    SELECT changed_at FROM department_access_assignment_versions
    WHERE id = 'access-assignment-a-general-medicine-local-admin'
  )
WHERE id = 'access-assignment-head-a-general-medicine'
  AND current_version_id = (
    SELECT supersedes_version_id FROM department_access_assignment_versions
    WHERE id = 'access-assignment-a-general-medicine-local-admin'
  );

INSERT OR IGNORE INTO patients (
  id, organization_id, facility_id, medical_record_number, display_name,
  birth_date, sex_at_birth, status
) VALUES (
  'patient-a', 'org-a', 'fac-a', 'SYN-0042', 'Айдана С.',
  '1984-04-12', 'female', 'active'
);

INSERT OR IGNORE INTO patient_profile_versions (
  id, organization_id, facility_id, patient_id, version, display_name,
  birth_date, sex_at_birth, status, created_by_membership_id, change_reason
) VALUES (
  'profile-patient-a-v1', 'org-a', 'fac-a', 'patient-a', 1, 'Айдана С.',
  '1984-04-12', 'female', 'active', 'membership-a', 'synthetic_seed_registration'
);

INSERT OR IGNORE INTO patient_profile_heads (
  id, organization_id, facility_id, patient_id, current_version_id, lock_version
)
SELECT 'profile-head-patient-a', 'org-a', 'fac-a', 'patient-a', profile.id, 1
FROM patient_profile_versions profile
WHERE profile.organization_id = 'org-a' AND profile.facility_id = 'fac-a'
  AND profile.patient_id = 'patient-a' AND profile.version = 1;

INSERT OR IGNORE INTO encounters (
  id, organization_id, facility_id, patient_id, clinician_membership_id,
  status, reason_for_visit, started_at
) VALUES (
  'encounter-a', 'org-a', 'fac-a', 'patient-a', 'membership-a',
  'in_progress', 'Синтетический первичный приём', 1787902200000
);

INSERT OR IGNORE INTO consent_events (
  id, organization_id, facility_id, patient_id, encounter_id, version,
  consent_type, decision, captured_by_membership_id, policy_version,
  policy_hash, notice_language, source, occurred_at, effective_at
) VALUES
  (
    'consent-a-care-v1', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 1,
    'care', 'granted', 'membership-a', 'synthetic-local-v1',
    '23d23241bbdf590681ef18941576e994598e84124c5bd25dc99b9fe209ee238e',
    'ru', 'verbal', 1787902200000, 1787902200000
  ),
  (
    'consent-a-transcript-v1', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 1,
    'transcript_storage', 'granted', 'membership-a', 'synthetic-local-v1',
    '23d23241bbdf590681ef18941576e994598e84124c5bd25dc99b9fe209ee238e',
    'ru', 'verbal', 1787902200000, 1787902200000
  );

INSERT OR IGNORE INTO consent_heads (
  id, organization_id, facility_id, patient_id, encounter_id, consent_type,
  current_consent_event_id, lock_version
) VALUES
  ('consent-head-a-care', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 'care', 'consent-a-care-v1', 1),
  ('consent-head-a-transcript', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 'transcript_storage', 'consent-a-transcript-v1', 1);

INSERT OR IGNORE INTO transcript_segments (
  id, organization_id, facility_id, encounter_id, segment_index, version,
  speaker_role, speaker_role_source, language_code, text,
  started_at_ms, ended_at_ms, state
) VALUES
  (
    'seg-001', 'org-a', 'fac-a', 'encounter-a', 1, 1,
    'doctor', 'voice_calibration', 'ru',
    'Здравствуйте. Расскажите, пожалуйста, что вас беспокоит и как давно это началось?',
    8000, 16000, 'final'
  ),
  (
    'seg-002', 'org-a', 'fac-a', 'encounter-a', 2, 1,
    'patient', 'voice_calibration', 'kk',
    'Соңғы екі аптада шөлдеу күшейді, түнде бірнеше рет су ішу үшін оянамын.',
    17000, 30000, 'final'
  ),
  (
    'seg-003', 'org-a', 'fac-a', 'encounter-a', 3, 1,
    'doctor', 'voice_calibration', 'ru',
    'Стали ли вы чаще мочиться? Изменился вес или аппетит?',
    31000, 38000, 'final'
  ),
  (
    'seg-004', 'org-a', 'fac-a', 'encounter-a', 4, 1,
    'patient', 'voice_calibration', 'mixed',
    'Иә, жиі барамын. За месяц примерно три килограмма жоғалттым.',
    39000, 49000, 'final'
  );

INSERT OR IGNORE INTO analysis_runs (
  id, organization_id, facility_id, encounter_id, kind, provider, model,
  model_version, policy_version, input_hash, source_record_ids_json, status,
  started_at, completed_at
) VALUES (
  'analysis-workspace', 'org-a', 'fac-a', 'encounter-a', 'suggestions',
  'synthetic', 'fixture', '1', 'synthetic-policy-1',
  'synthetic-workspace-input', '["seg-002","seg-004"]', 'succeeded',
  1787902260000, 1787902261000
);

INSERT OR IGNORE INTO clinical_suggestions (
  id, organization_id, facility_id, encounter_id, analysis_run_id, category,
  risk_level, title, original_content, evidence_json
) VALUES
  (
    'rec-1', 'org-a', 'fac-a', 'encounter-a', 'analysis-workspace',
    'clarification', 'informational', 'Текущая лекарственная терапия',
    'Спросить о рецептурных и безрецептурных препаратах, витаминах и времени последнего приёма.',
    '[{"sourceId":"conversation-gap","quote":"В разговоре лекарства ещё не обсуждались"}]'
  ),
  (
    'rec-2', 'org-a', 'fac-a', 'encounter-a', 'analysis-workspace',
    'safety', 'attention', 'Аллергологический статус не подтверждён',
    'До формирования плана лечения уточнить реакции на препараты и пищевые аллергены.',
    '[{"sourceId":"allergy-status","quote":"Обязательный раздел пока пуст"}]'
  ),
  (
    'rec-3', 'org-a', 'fac-a', 'encounter-a', 'analysis-workspace',
    'action', 'informational', 'Проверить полноту объективных данных',
    'Сверить давление, пульс, ИМТ и результаты доврачебного осмотра перед заключением.',
    '[{"sourceId":"objective-findings","quote":"Связано с разделом «Объективные данные»"}]'
  );

INSERT OR IGNORE INTO suggestion_review_heads (
  id, organization_id, facility_id, encounter_id, suggestion_id, state,
  current_decision_id, lock_version
) VALUES
  ('head-rec-1', 'org-a', 'fac-a', 'encounter-a', 'rec-1', 'proposed', NULL, 1),
  ('head-rec-2', 'org-a', 'fac-a', 'encounter-a', 'rec-2', 'proposed', NULL, 1),
  ('head-rec-3', 'org-a', 'fac-a', 'encounter-a', 'rec-3', 'proposed', NULL, 1);

INSERT OR IGNORE INTO clinical_section_versions (
  id, organization_id, facility_id, encounter_id, code, content,
  review_state, provenance_json, created_by_type, created_by_id,
  reviewed_by_membership_id, reviewed_at, version
) VALUES
  (
    'section-complaints-v1', 'org-a', 'fac-a', 'encounter-a', 'complaints',
    'Усиление жажды в течение двух недель, учащённое мочеиспускание, пробуждения ночью для питья воды. Пациент отмечает снижение массы тела примерно на 3 кг за последний месяц.',
    'reviewed', '{"sourceType":"synthetic_fixture","sourceIds":["seg-002","seg-004"]}',
    'user', 'synthetic-clinician', 'membership-a', 1787902261000, 1
  ),
  (
    'section-present-v1', 'org-a', 'fac-a', 'encounter-a',
    'history_of_present_illness',
    'Черновик требует уточнения начала симптомов, динамики, предыдущих измерений глюкозы и обращений за медицинской помощью.',
    'ai_draft', '{"sourceType":"ai_draft","sourceIds":["seg-002","seg-003","seg-004"]}',
    'service', 'synthetic-analysis', NULL, NULL, 1
  ),
  (
    'section-history-v1', 'org-a', 'fac-a', 'encounter-a',
    'past_medical_history', '', 'empty',
    '{"sourceType":"synthetic_fixture","sourceIds":[]}',
    'service', 'synthetic-analysis', NULL, NULL, 1
  ),
  (
    'section-allergy-v1', 'org-a', 'fac-a', 'encounter-a',
    'allergy_status', '', 'empty',
    '{"sourceType":"synthetic_fixture","sourceIds":[]}',
    'service', 'synthetic-analysis', NULL, NULL, 1
  ),
  (
    'section-objective-v1', 'org-a', 'fac-a', 'encounter-a',
    'objective_findings',
    'АД 132/84 мм рт. ст., пульс 78 уд/мин, ИМТ 27,4 кг/м². Значения импортированы из синтетического доврачебного осмотра.',
    'reviewed', '{"sourceType":"synthetic_fixture","sourceIds":["obs-bp-001","obs-pulse-001","obs-bmi-001"]}',
    'user', 'synthetic-clinician', 'membership-a', 1787902261000, 1
  ),
  (
    'section-diagnosis-v1', 'org-a', 'fac-a', 'encounter-a',
    'preliminary_diagnosis',
    'Диагностическое заключение не сформировано. ИИ может предложить варианты только для проверки врачом.',
    'ai_draft', '{"sourceType":"ai_draft","sourceIds":["seg-002","seg-004"]}',
    'service', 'synthetic-analysis', NULL, NULL, 1
  ),
  (
    'section-exam-v1', 'org-a', 'fac-a', 'encounter-a',
    'examination_plan', '', 'empty',
    '{"sourceType":"synthetic_fixture","sourceIds":[]}',
    'service', 'synthetic-analysis', NULL, NULL, 1
  ),
  (
    'section-treatment-v1', 'org-a', 'fac-a', 'encounter-a',
    'treatment_plan', '', 'empty',
    '{"sourceType":"synthetic_fixture","sourceIds":[]}',
    'service', 'synthetic-analysis', NULL, NULL, 1
  );

INSERT OR IGNORE INTO clinical_section_heads (
  id, organization_id, facility_id, encounter_id, code,
  current_version_id, lock_version
) VALUES
  ('section-head-complaints', 'org-a', 'fac-a', 'encounter-a', 'complaints', 'section-complaints-v1', 1),
  ('section-head-present', 'org-a', 'fac-a', 'encounter-a', 'history_of_present_illness', 'section-present-v1', 1),
  ('section-head-history', 'org-a', 'fac-a', 'encounter-a', 'past_medical_history', 'section-history-v1', 1),
  ('section-head-allergy', 'org-a', 'fac-a', 'encounter-a', 'allergy_status', 'section-allergy-v1', 1),
  ('section-head-objective', 'org-a', 'fac-a', 'encounter-a', 'objective_findings', 'section-objective-v1', 1),
  ('section-head-diagnosis', 'org-a', 'fac-a', 'encounter-a', 'preliminary_diagnosis', 'section-diagnosis-v1', 1),
  ('section-head-exam', 'org-a', 'fac-a', 'encounter-a', 'examination_plan', 'section-exam-v1', 1),
  ('section-head-treatment', 'org-a', 'fac-a', 'encounter-a', 'treatment_plan', 'section-treatment-v1', 1);

-- A second assigned synthetic encounter keeps the consent-gated lifecycle
-- reproducible without editing the primary in-progress fixture.
INSERT OR IGNORE INTO patients (
  id, organization_id, facility_id, medical_record_number, display_name,
  birth_date, sex_at_birth, status, created_at, updated_at
) VALUES (
  'patient-a-lifecycle', 'org-a', 'fac-a', 'SYN-LIFE-01',
  'Тестовый пациент Л.', '1992-09-18', 'not_recorded', 'active',
  1787800000000, 1787800000000
);

INSERT OR IGNORE INTO patient_profile_versions (
  id, organization_id, facility_id, patient_id, version, display_name,
  birth_date, sex_at_birth, status, created_by_membership_id, change_reason,
  created_at
) VALUES (
  'profile-patient-a-lifecycle-v1', 'org-a', 'fac-a',
  'patient-a-lifecycle', 1, 'Тестовый пациент Л.', '1992-09-18',
  'not_recorded', 'active', 'membership-a', 'synthetic_seed_registration',
  1787800000000
);

INSERT OR IGNORE INTO patient_profile_heads (
  id, organization_id, facility_id, patient_id, current_version_id,
  lock_version, updated_at
)
SELECT 'profile-head-patient-a-lifecycle', 'org-a', 'fac-a',
  'patient-a-lifecycle', profile.id, 1, 1787800000000
FROM patient_profile_versions profile
WHERE profile.organization_id = 'org-a' AND profile.facility_id = 'fac-a'
  AND profile.patient_id = 'patient-a-lifecycle' AND profile.version = 1;

INSERT OR IGNORE INTO encounters (
  id, organization_id, facility_id, patient_id, clinician_membership_id,
  status, reason_for_visit, created_at, updated_at, version
) VALUES (
  'encounter-a-lifecycle', 'org-a', 'fac-a', 'patient-a-lifecycle',
  'membership-a', 'draft', 'Проверка управляемого жизненного цикла',
  1787800000000, 1787800000000, 1
);

INSERT OR IGNORE INTO consent_events (
  id, organization_id, facility_id, patient_id, encounter_id, version,
  consent_type, decision, captured_by_membership_id, policy_version,
  policy_hash, notice_language, source, occurred_at, effective_at
) VALUES (
  'consent-a-lifecycle-care-v1', 'org-a', 'fac-a', 'patient-a-lifecycle',
  'encounter-a-lifecycle', 1, 'care', 'granted', 'membership-a',
  'synthetic-local-v1',
  '23d23241bbdf590681ef18941576e994598e84124c5bd25dc99b9fe209ee238e',
  'ru', 'verbal', 1787800000000, 1787800000000
);

INSERT OR IGNORE INTO consent_heads (
  id, organization_id, facility_id, patient_id, encounter_id, consent_type,
  current_consent_event_id, lock_version, created_at, updated_at
) VALUES (
  'consent-head-a-lifecycle-care', 'org-a', 'fac-a', 'patient-a-lifecycle',
  'encounter-a-lifecycle', 'care', 'consent-a-lifecycle-care-v1', 1,
  1787800000000, 1787800000000
);

INSERT OR IGNORE INTO clinical_section_versions (
  id, organization_id, facility_id, encounter_id, code, content,
  review_state, provenance_json, created_by_type, created_by_id, version,
  created_at
) VALUES
  ('life-section-complaints-v1', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'complaints', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1, 1787800000000),
  ('life-section-present-v1', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'history_of_present_illness', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1, 1787800000000),
  ('life-section-history-v1', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'past_medical_history', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1, 1787800000000),
  ('life-section-allergy-v1', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'allergy_status', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1, 1787800000000),
  ('life-section-objective-v1', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'objective_findings', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1, 1787800000000),
  ('life-section-diagnosis-v1', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'preliminary_diagnosis', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1, 1787800000000),
  ('life-section-exam-v1', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'examination_plan', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1, 1787800000000),
  ('life-section-treatment-v1', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'treatment_plan', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1, 1787800000000);

INSERT OR IGNORE INTO clinical_section_heads (
  id, organization_id, facility_id, encounter_id, code,
  current_version_id, lock_version, updated_at
) VALUES
  ('life-head-complaints', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'complaints', 'life-section-complaints-v1', 1, 1787800000000),
  ('life-head-present', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'history_of_present_illness', 'life-section-present-v1', 1, 1787800000000),
  ('life-head-history', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'past_medical_history', 'life-section-history-v1', 1, 1787800000000),
  ('life-head-allergy', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'allergy_status', 'life-section-allergy-v1', 1, 1787800000000),
  ('life-head-objective', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'objective_findings', 'life-section-objective-v1', 1, 1787800000000),
  ('life-head-diagnosis', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'preliminary_diagnosis', 'life-section-diagnosis-v1', 1, 1787800000000),
  ('life-head-exam', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'examination_plan', 'life-section-exam-v1', 1, 1787800000000),
  ('life-head-treatment', 'org-a', 'fac-a', 'encounter-a-lifecycle', 'treatment_plan', 'life-section-treatment-v1', 1, 1787800000000);

INSERT OR IGNORE INTO audit_stream_heads (
  id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
) VALUES ('audit-head-org-a-fac-a', 'org-a', 'fac-a', 0, NULL, 1);

-- A second isolated tenant and a non-clinician role make local authorization
-- denial cases reproducible without real patient data.
INSERT OR IGNORE INTO organizations (id, name)
VALUES ('org-b', 'ORION Synthetic Clinic B');

INSERT OR IGNORE INTO facilities (id, organization_id, name)
VALUES ('fac-b', 'org-b', 'Synthetic North Facility');

INSERT OR IGNORE INTO users (
  id, external_issuer, external_subject, display_name, status
) VALUES
  ('user-b', 'openai:sites', 'local_other_clinician', 'Б. Нуртаев', 'active'),
  ('user-registrar', 'openai:sites', 'local_registrar', 'Р. Тестовая', 'active');

INSERT OR IGNORE INTO memberships (
  id, organization_id, facility_id, user_id, role, status
) VALUES
  ('membership-b', 'org-b', 'fac-b', 'user-b', 'clinician', 'active'),
  ('membership-registrar', 'org-a', 'fac-a', 'user-registrar', 'registrar', 'active');

INSERT OR IGNORE INTO patients (
  id, organization_id, facility_id, medical_record_number, display_name,
  birth_date, sex_at_birth, status
) VALUES (
  'patient-b', 'org-b', 'fac-b', 'SYN-B-0001', 'Синтетический пациент Б.',
  '1991-09-05', 'male', 'active'
);

INSERT OR IGNORE INTO patient_profile_versions (
  id, organization_id, facility_id, patient_id, version, display_name,
  birth_date, sex_at_birth, status, created_by_membership_id, change_reason
) VALUES (
  'profile-patient-b-v1', 'org-b', 'fac-b', 'patient-b', 1,
  'Синтетический пациент Б.', '1991-09-05', 'male', 'active',
  'membership-b', 'synthetic_seed_registration'
);

INSERT OR IGNORE INTO patient_profile_heads (
  id, organization_id, facility_id, patient_id, current_version_id, lock_version
)
SELECT 'profile-head-patient-b', 'org-b', 'fac-b', 'patient-b', profile.id, 1
FROM patient_profile_versions profile
WHERE profile.organization_id = 'org-b' AND profile.facility_id = 'fac-b'
  AND profile.patient_id = 'patient-b' AND profile.version = 1;

INSERT OR IGNORE INTO encounters (
  id, organization_id, facility_id, patient_id, clinician_membership_id,
  status, reason_for_visit, started_at
) VALUES (
  'encounter-b', 'org-b', 'fac-b', 'patient-b', 'membership-b',
  'in_progress', 'Изолированный синтетический приём', 1787815800000
);

INSERT OR IGNORE INTO consent_events (
  id, organization_id, facility_id, patient_id, encounter_id, version,
  consent_type, decision, captured_by_membership_id, policy_version,
  policy_hash, notice_language, source, occurred_at, effective_at
) VALUES
  (
    'consent-b-care-v1', 'org-b', 'fac-b', 'patient-b', 'encounter-b', 1,
    'care', 'granted', 'membership-b', 'synthetic-local-v1',
    '23d23241bbdf590681ef18941576e994598e84124c5bd25dc99b9fe209ee238e',
    'kk', 'verbal', 1787815800000, 1787815800000
  ),
  (
    'consent-b-transcript-v1', 'org-b', 'fac-b', 'patient-b', 'encounter-b', 1,
    'transcript_storage', 'denied', 'membership-b', 'synthetic-local-v1',
    '23d23241bbdf590681ef18941576e994598e84124c5bd25dc99b9fe209ee238e',
    'kk', 'verbal', 1787815800000, 1787815800000
  );

INSERT OR IGNORE INTO consent_heads (
  id, organization_id, facility_id, patient_id, encounter_id, consent_type,
  current_consent_event_id, lock_version
) VALUES
  ('consent-head-b-care', 'org-b', 'fac-b', 'patient-b', 'encounter-b', 'care', 'consent-b-care-v1', 1),
  ('consent-head-b-transcript', 'org-b', 'fac-b', 'patient-b', 'encounter-b', 'transcript_storage', 'consent-b-transcript-v1', 1);

INSERT OR IGNORE INTO clinical_section_versions (
  id, organization_id, facility_id, encounter_id, code, content,
  review_state, provenance_json, created_by_type, created_by_id, version
) VALUES
  ('section-b-complaints-v1', 'org-b', 'fac-b', 'encounter-b', 'complaints', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1),
  ('section-b-present-v1', 'org-b', 'fac-b', 'encounter-b', 'history_of_present_illness', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1),
  ('section-b-history-v1', 'org-b', 'fac-b', 'encounter-b', 'past_medical_history', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1),
  ('section-b-allergy-v1', 'org-b', 'fac-b', 'encounter-b', 'allergy_status', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1),
  ('section-b-objective-v1', 'org-b', 'fac-b', 'encounter-b', 'objective_findings', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1),
  ('section-b-diagnosis-v1', 'org-b', 'fac-b', 'encounter-b', 'preliminary_diagnosis', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1),
  ('section-b-exam-v1', 'org-b', 'fac-b', 'encounter-b', 'examination_plan', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1),
  ('section-b-treatment-v1', 'org-b', 'fac-b', 'encounter-b', 'treatment_plan', '', 'empty', '{"sourceType":"synthetic_fixture","sourceIds":[]}', 'service', 'synthetic-seed', 1);

INSERT OR IGNORE INTO clinical_section_heads (
  id, organization_id, facility_id, encounter_id, code,
  current_version_id, lock_version
) VALUES
  ('section-head-b-complaints', 'org-b', 'fac-b', 'encounter-b', 'complaints', 'section-b-complaints-v1', 1),
  ('section-head-b-present', 'org-b', 'fac-b', 'encounter-b', 'history_of_present_illness', 'section-b-present-v1', 1),
  ('section-head-b-history', 'org-b', 'fac-b', 'encounter-b', 'past_medical_history', 'section-b-history-v1', 1),
  ('section-head-b-allergy', 'org-b', 'fac-b', 'encounter-b', 'allergy_status', 'section-b-allergy-v1', 1),
  ('section-head-b-objective', 'org-b', 'fac-b', 'encounter-b', 'objective_findings', 'section-b-objective-v1', 1),
  ('section-head-b-diagnosis', 'org-b', 'fac-b', 'encounter-b', 'preliminary_diagnosis', 'section-b-diagnosis-v1', 1),
  ('section-head-b-exam', 'org-b', 'fac-b', 'encounter-b', 'examination_plan', 'section-b-exam-v1', 1),
  ('section-head-b-treatment', 'org-b', 'fac-b', 'encounter-b', 'treatment_plan', 'section-b-treatment-v1', 1);

INSERT OR IGNORE INTO audit_stream_heads (
  id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
) VALUES ('audit-head-org-b-fac-b', 'org-b', 'fac-b', 0, NULL, 1);
