-- Local application bootstrap only.
--
-- This file creates the minimum organization, facility and authenticated
-- clinician context required to use ORION Clinic. It intentionally does not
-- create patients, encounters, consents, transcripts or clinical records.

INSERT OR IGNORE INTO organizations (id, name)
VALUES ('org-a', 'ORION Clinic');

INSERT OR IGNORE INTO facilities (id, organization_id, name)
VALUES ('fac-a', 'org-a', 'Главный филиал');

INSERT OR IGNORE INTO users (
  id, external_issuer, external_subject, display_name, status
) VALUES (
  'user-a', 'openai:sites', 'local_seedy',
  'Врач ORION', 'active'
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

INSERT OR IGNORE INTO departments (
  id, organization_id, facility_id, code, name, kind, status
) VALUES (
  'department-a-general-medicine', 'org-a', 'fac-a',
  'general_medicine', 'Общая медицина', 'clinical', 'active'
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

INSERT OR IGNORE INTO audit_stream_heads (
  id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
) VALUES ('audit-head-org-a-fac-a', 'org-a', 'fac-a', 0, NULL, 1);
