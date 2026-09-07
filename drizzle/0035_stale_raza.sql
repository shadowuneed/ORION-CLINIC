ALTER TABLE `clinical_section_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);

--> statement-breakpoint
CREATE VIEW encounter_access_assignment_permissions AS
SELECT assignment.id AS assignment_id, assignment.organization_id, assignment.facility_id,
  assignment.membership_id, version.effective_from, version.effective_until,
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM json_each(version.deny_permissions_json) WHERE value = 'encounter.read'
  ) THEN 1 ELSE 0 END AS can_read,
  CASE WHEN NOT EXISTS (
    SELECT 1 FROM json_each(version.deny_permissions_json) WHERE value = 'encounter.manage'
  ) THEN 1 ELSE 0 END AS can_manage
FROM department_access_assignments assignment
JOIN department_access_assignment_heads head
  ON head.assignment_id = assignment.id AND head.organization_id = assignment.organization_id
  AND head.facility_id = assignment.facility_id AND head.membership_id = assignment.membership_id
  AND head.department_id = assignment.department_id
JOIN department_access_assignment_versions version
  ON version.id = head.current_version_id AND version.assignment_id = assignment.id
  AND version.organization_id = assignment.organization_id AND version.facility_id = assignment.facility_id
  AND version.membership_id = assignment.membership_id AND version.department_id = assignment.department_id
JOIN department_heads department_head
  ON department_head.department_id = assignment.department_id
  AND department_head.organization_id = assignment.organization_id AND department_head.facility_id = assignment.facility_id
JOIN department_versions department_version
  ON department_version.id = department_head.current_version_id
  AND department_version.department_id = assignment.department_id
  AND department_version.organization_id = assignment.organization_id AND department_version.facility_id = assignment.facility_id
JOIN memberships member ON member.id = assignment.membership_id
  AND member.organization_id = assignment.organization_id AND member.facility_id = assignment.facility_id
JOIN users user ON user.id = member.user_id
JOIN organizations organization ON organization.id = assignment.organization_id
JOIN facilities facility ON facility.id = assignment.facility_id AND facility.organization_id = assignment.organization_id
WHERE version.status = 'active' AND department_version.status = 'active'
  AND member.status = 'active' AND user.status = 'active'
  AND organization.status = 'active' AND facility.status = 'active'
  AND EXISTS (SELECT 1 FROM json_each(version.roles_json) WHERE value = 'doctor')
  AND NOT EXISTS (SELECT 1 FROM json_each(version.roles_json) WHERE value = 'service');
--> statement-breakpoint
CREATE TRIGGER command_idempotency_clinical_section_assignment_insert
BEFORE INSERT ON command_idempotency
WHEN NEW.operation = 'clinical_section.command' AND NOT EXISTS (
  SELECT 1 FROM encounter_access_assignment_permissions access
  WHERE access.assignment_id = NEW.access_assignment_id
    AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
    AND access.membership_id = NEW.actor_membership_id AND access.can_manage = 1
    AND access.effective_from <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
    AND (access.effective_until IS NULL OR access.effective_until > (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))
)
BEGIN SELECT RAISE(ABORT, 'clinical section command requires exact current assignment'); END;
--> statement-breakpoint
-- Initial fixture/creation rows and service AI drafts are separate migration gates.
-- Every human-authored or human-reviewed successor is covered, regardless of provenance label.
CREATE TRIGGER clinical_section_versions_assignment_guard
BEFORE INSERT ON clinical_section_versions
WHEN NEW.version > 1
  AND (NEW.created_by_type = 'user' OR NEW.review_state IN ('clinician_edited','reviewed','explicitly_absent'))
  AND NOT EXISTS (
    SELECT 1 FROM encounter_access_assignment_permissions access
    JOIN memberships member ON member.id = access.membership_id
      AND member.organization_id = access.organization_id AND member.facility_id = access.facility_id
    JOIN encounters encounter ON encounter.organization_id = access.organization_id
      AND encounter.facility_id = access.facility_id AND encounter.clinician_membership_id = access.membership_id
    JOIN patients patient ON patient.id = encounter.patient_id
      AND patient.organization_id = encounter.organization_id AND patient.facility_id = encounter.facility_id
    JOIN consent_heads consent_head ON consent_head.organization_id = encounter.organization_id
      AND consent_head.facility_id = encounter.facility_id AND consent_head.encounter_id = encounter.id
      AND consent_head.consent_type = 'care'
    JOIN consent_events consent ON consent.id = consent_head.current_consent_event_id
      AND consent.organization_id = encounter.organization_id AND consent.facility_id = encounter.facility_id
      AND consent.encounter_id = encounter.id AND consent.patient_id = encounter.patient_id AND consent.consent_type = 'care'
    WHERE access.assignment_id = NEW.access_assignment_id
      AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
      AND encounter.id = NEW.encounter_id AND patient.status = 'active'
      AND encounter.status IN ('in_progress','review') AND NEW.created_by_type = 'user'
      AND member.user_id = NEW.created_by_id
      AND (NEW.reviewed_by_membership_id IS NULL OR NEW.reviewed_by_membership_id = access.membership_id)
      AND json_extract(NEW.provenance_json,'$.accessAssignmentId') = access.assignment_id
      AND access.can_manage = 1 AND access.effective_from <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
      AND (access.effective_until IS NULL OR access.effective_until > (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))
      AND consent.decision = 'granted' AND consent.effective_at <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
      AND (consent.expires_at IS NULL OR consent.expires_at > (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))
  )
BEGIN SELECT RAISE(ABORT, 'clinical section successor requires current assigned doctor and care consent'); END;
--> statement-breakpoint
CREATE TRIGGER audit_events_clinical_section_assignment_guard
BEFORE INSERT ON audit_events
WHEN NEW.action IN ('clinical_section.save_draft','clinical_section.mark_reviewed','clinical_section.mark_absent')
  AND NOT EXISTS (
    SELECT 1 FROM clinical_section_versions version
    JOIN encounter_access_assignment_permissions access ON access.assignment_id = version.access_assignment_id
      AND access.organization_id = version.organization_id AND access.facility_id = version.facility_id
    JOIN memberships member ON member.id = access.membership_id
      AND member.organization_id = access.organization_id AND member.facility_id = access.facility_id
    WHERE version.id = NEW.entity_id AND NEW.entity_type = 'clinical_section_version'
      AND version.organization_id = NEW.organization_id AND version.facility_id = NEW.facility_id
      AND NEW.actor_type = 'user' AND NEW.actor_id = member.user_id
      AND version.created_by_id = NEW.actor_id AND NEW.actor_membership_id = access.membership_id
      AND json_extract(NEW.metadata_json,'$.accessAssignmentId') = access.assignment_id
      AND access.can_manage = 1 AND access.effective_from <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
      AND (access.effective_until IS NULL OR access.effective_until > (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))
  )
BEGIN SELECT RAISE(ABORT, 'clinical section audit requires matching assignment provenance'); END;
--> statement-breakpoint
CREATE TRIGGER command_idempotency_clinical_section_assignment_result
BEFORE UPDATE ON command_idempotency
WHEN NEW.operation = 'clinical_section.command' AND NEW.status = 'succeeded'
  AND NOT EXISTS (
    SELECT 1 FROM clinical_section_versions version
    JOIN encounter_access_assignment_permissions access ON access.assignment_id = version.access_assignment_id
      AND access.organization_id = version.organization_id AND access.facility_id = version.facility_id
    JOIN memberships member ON member.id = access.membership_id
      AND member.organization_id = access.organization_id AND member.facility_id = access.facility_id
    WHERE version.id = NEW.result_resource_id AND NEW.result_resource_type = 'clinical_section_version'
      AND version.organization_id = NEW.organization_id AND version.facility_id = NEW.facility_id
      AND version.access_assignment_id = NEW.access_assignment_id AND access.membership_id = NEW.actor_membership_id
      AND version.created_by_id = member.user_id
      AND access.can_manage = 1 AND access.effective_from <= (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER))
      AND (access.effective_until IS NULL OR access.effective_until > (CAST(strftime('%s','now') AS INTEGER) * 1000 + CAST(substr(strftime('%f','now'),4,3) AS INTEGER)))
  )
BEGIN SELECT RAISE(ABORT, 'clinical section result requires matching current assignment'); END;
