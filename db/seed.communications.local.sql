-- Phase 7 local fixtures. No provider credentials and no real destinations.
INSERT INTO department_access_assignments (
  id, organization_id, facility_id, department_id, membership_id,
  created_by_membership_id, created_at
)
SELECT
  'access-assignment-care-nurse', 'org-a', 'fac-a',
  'department-a-general-medicine', 'membership-care-nurse', 'membership-a', 1704067200000
WHERE NOT EXISTS (
  SELECT 1 FROM department_access_assignments
  WHERE id = 'access-assignment-care-nurse'
);

INSERT INTO department_access_assignment_versions (
  id, organization_id, facility_id, assignment_id, department_id,
  membership_id, version, supersedes_version_id, status, source_type,
  roles_json, allow_permissions_json, deny_permissions_json,
  effective_from, effective_until, change_reason,
  changed_by_membership_id, changed_at, created_at
)
SELECT
  'access-assignment-care-nurse-v1', 'org-a', 'fac-a',
  'access-assignment-care-nurse', 'department-a-general-medicine',
  'membership-care-nurse', 1, NULL, 'active', 'bootstrap',
  '["nurse"]', '[]', '[]', 1704067200000, NULL,
  'synthetic_local_access_bootstrap', 'membership-a',
  1704067200000, 1704067200000
WHERE NOT EXISTS (
  SELECT 1 FROM department_access_assignment_versions
  WHERE id = 'access-assignment-care-nurse-v1'
);

INSERT INTO department_access_assignment_heads (
  id, organization_id, facility_id, assignment_id, department_id,
  membership_id, current_version_id, lock_version, created_at, updated_at
)
SELECT
  'access-assignment-head-care-nurse', 'org-a', 'fac-a',
  'access-assignment-care-nurse', 'department-a-general-medicine',
  'membership-care-nurse', 'access-assignment-care-nurse-v1', 1,
  1704067200000, 1704067200000
WHERE NOT EXISTS (
  SELECT 1 FROM department_access_assignment_heads
  WHERE id = 'access-assignment-head-care-nurse'
);

INSERT OR IGNORE INTO communication_policy_versions (
  id, organization_id, facility_id, policy_code, version, status,
  source_type, quiet_start_minute, quiet_end_minute, max_attempts,
  retry_delay_minutes, protected_link_mode, approved_by_membership_id,
  approved_at, created_at
) VALUES (
  'communication-policy-local-v1', 'org-a', 'fac-a',
  'ORION_LOCAL_COMMS_V1', 1, 'active_test', 'local_test',
  1260, 480, 2, 5, 'disabled_minimum_content_only',
  'membership-a', 1788566400000, 1788566400000
);

INSERT OR IGNORE INTO communication_template_versions (
  id, organization_id, facility_id, template_code, version, status,
  source_type, purpose, channel, language, body, placeholders_json,
  content_hash, minimum_content_only, protected_link_required,
  approved_by_membership_id, approved_at, created_at
) VALUES
  ('communication-template-appointment-whatsapp-ru-v1', 'org-a', 'fac-a', 'APPOINTMENT_WHATSAPP_RU', 1, 'approved_test', 'local_test', 'appointment_reminder', 'whatsapp', 'ru', 'ORION: напоминание о записи в {{facilityName}} на {{appointmentDate}} в {{appointmentTime}}.', '["facilityName","appointmentDate","appointmentTime"]', '98527ad52a17ebc38680b60be1bf50cadd5fab4c65400d3aa3572232097120ac', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-appointment-whatsapp-kk-v1', 'org-a', 'fac-a', 'APPOINTMENT_WHATSAPP_KK', 1, 'approved_test', 'local_test', 'appointment_reminder', 'whatsapp', 'kk', 'ORION: {{facilityName}} мекемесіндегі қабылдау {{appointmentDate}} күні сағат {{appointmentTime}}.', '["facilityName","appointmentDate","appointmentTime"]', '59242b057e4ab7f34176f12ff17dbc05ab144ab62d09aa2562319182f932a065', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-appointment-telegram-ru-v1', 'org-a', 'fac-a', 'APPOINTMENT_TELEGRAM_RU', 1, 'approved_test', 'local_test', 'appointment_reminder', 'telegram', 'ru', 'ORION: напоминание о записи в {{facilityName}} на {{appointmentDate}} в {{appointmentTime}}.', '["facilityName","appointmentDate","appointmentTime"]', '98527ad52a17ebc38680b60be1bf50cadd5fab4c65400d3aa3572232097120ac', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-appointment-telegram-kk-v1', 'org-a', 'fac-a', 'APPOINTMENT_TELEGRAM_KK', 1, 'approved_test', 'local_test', 'appointment_reminder', 'telegram', 'kk', 'ORION: {{facilityName}} мекемесіндегі қабылдау {{appointmentDate}} күні сағат {{appointmentTime}}.', '["facilityName","appointmentDate","appointmentTime"]', '59242b057e4ab7f34176f12ff17dbc05ab144ab62d09aa2562319182f932a065', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-appointment-sms-ru-v1', 'org-a', 'fac-a', 'APPOINTMENT_SMS_RU', 1, 'approved_test', 'local_test', 'appointment_reminder', 'sms', 'ru', 'ORION: напоминание о записи в {{facilityName}} на {{appointmentDate}} в {{appointmentTime}}.', '["facilityName","appointmentDate","appointmentTime"]', '98527ad52a17ebc38680b60be1bf50cadd5fab4c65400d3aa3572232097120ac', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-appointment-sms-kk-v1', 'org-a', 'fac-a', 'APPOINTMENT_SMS_KK', 1, 'approved_test', 'local_test', 'appointment_reminder', 'sms', 'kk', 'ORION: {{facilityName}} мекемесіндегі қабылдау {{appointmentDate}} күні сағат {{appointmentTime}}.', '["facilityName","appointmentDate","appointmentTime"]', '59242b057e4ab7f34176f12ff17dbc05ab144ab62d09aa2562319182f932a065', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-appointment-voice-ru-v1', 'org-a', 'fac-a', 'APPOINTMENT_VOICE_RU', 1, 'approved_test', 'local_test', 'appointment_reminder', 'voice', 'ru', 'ORION: напоминание о записи в {{facilityName}} на {{appointmentDate}} в {{appointmentTime}}.', '["facilityName","appointmentDate","appointmentTime"]', '98527ad52a17ebc38680b60be1bf50cadd5fab4c65400d3aa3572232097120ac', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-appointment-voice-kk-v1', 'org-a', 'fac-a', 'APPOINTMENT_VOICE_KK', 1, 'approved_test', 'local_test', 'appointment_reminder', 'voice', 'kk', 'ORION: {{facilityName}} мекемесіндегі қабылдау {{appointmentDate}} күні сағат {{appointmentTime}}.', '["facilityName","appointmentDate","appointmentTime"]', '59242b057e4ab7f34176f12ff17dbc05ab144ab62d09aa2562319182f932a065', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-care-whatsapp-ru-v1', 'org-a', 'fac-a', 'CARE_WHATSAPP_RU', 1, 'approved_test', 'local_test', 'care_plan_reminder', 'whatsapp', 'ru', 'ORION: напоминание о пункте согласованного плана на {{dueDate}}. Клиника: {{facilityName}}.', '["dueDate","facilityName"]', 'd3ae89edf7e68c37f443ac3140f6b6104d2b22831d4a96a47d1cb6bed591eefa', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-care-whatsapp-kk-v1', 'org-a', 'fac-a', 'CARE_WHATSAPP_KK', 1, 'approved_test', 'local_test', 'care_plan_reminder', 'whatsapp', 'kk', 'ORION: келісілген жоспар тармағы {{dueDate}} күні. Клиника: {{facilityName}}.', '["dueDate","facilityName"]', '5f8c4def24f761c80afc7752a72628df5ffd6a1d503004463059f0a44f066768', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-care-telegram-ru-v1', 'org-a', 'fac-a', 'CARE_TELEGRAM_RU', 1, 'approved_test', 'local_test', 'care_plan_reminder', 'telegram', 'ru', 'ORION: напоминание о пункте согласованного плана на {{dueDate}}. Клиника: {{facilityName}}.', '["dueDate","facilityName"]', 'd3ae89edf7e68c37f443ac3140f6b6104d2b22831d4a96a47d1cb6bed591eefa', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-care-telegram-kk-v1', 'org-a', 'fac-a', 'CARE_TELEGRAM_KK', 1, 'approved_test', 'local_test', 'care_plan_reminder', 'telegram', 'kk', 'ORION: келісілген жоспар тармағы {{dueDate}} күні. Клиника: {{facilityName}}.', '["dueDate","facilityName"]', '5f8c4def24f761c80afc7752a72628df5ffd6a1d503004463059f0a44f066768', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-care-sms-ru-v1', 'org-a', 'fac-a', 'CARE_SMS_RU', 1, 'approved_test', 'local_test', 'care_plan_reminder', 'sms', 'ru', 'ORION: напоминание о пункте согласованного плана на {{dueDate}}. Клиника: {{facilityName}}.', '["dueDate","facilityName"]', 'd3ae89edf7e68c37f443ac3140f6b6104d2b22831d4a96a47d1cb6bed591eefa', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-care-sms-kk-v1', 'org-a', 'fac-a', 'CARE_SMS_KK', 1, 'approved_test', 'local_test', 'care_plan_reminder', 'sms', 'kk', 'ORION: келісілген жоспар тармағы {{dueDate}} күні. Клиника: {{facilityName}}.', '["dueDate","facilityName"]', '5f8c4def24f761c80afc7752a72628df5ffd6a1d503004463059f0a44f066768', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-care-voice-ru-v1', 'org-a', 'fac-a', 'CARE_VOICE_RU', 1, 'approved_test', 'local_test', 'care_plan_reminder', 'voice', 'ru', 'ORION: напоминание о пункте согласованного плана на {{dueDate}}. Клиника: {{facilityName}}.', '["dueDate","facilityName"]', 'd3ae89edf7e68c37f443ac3140f6b6104d2b22831d4a96a47d1cb6bed591eefa', 1, 0, 'membership-a', 1788566400000, 1788566400000),
  ('communication-template-care-voice-kk-v1', 'org-a', 'fac-a', 'CARE_VOICE_KK', 1, 'approved_test', 'local_test', 'care_plan_reminder', 'voice', 'kk', 'ORION: келісілген жоспар тармағы {{dueDate}} күні. Клиника: {{facilityName}}.', '["dueDate","facilityName"]', '5f8c4def24f761c80afc7752a72628df5ffd6a1d503004463059f0a44f066768', 1, 0, 'membership-a', 1788566400000, 1788566400000);
