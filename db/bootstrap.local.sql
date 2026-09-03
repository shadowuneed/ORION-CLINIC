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

INSERT OR IGNORE INTO audit_stream_heads (
  id, organization_id, facility_id, last_sequence, last_event_hash, lock_version
) VALUES ('audit-head-org-a-fac-a', 'org-a', 'fac-a', 0, NULL, 1);
