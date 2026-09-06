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

INSERT OR IGNORE INTO audit_stream_heads (
  id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
) VALUES ('audit-head-org-a-fac-a', 'org-a', 'fac-a', 0, NULL, 1);
