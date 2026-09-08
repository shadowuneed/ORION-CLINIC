ALTER TABLE `access_audit_events` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);
--> statement-breakpoint
CREATE VIEW current_download_audit_access AS
SELECT access.assignment_id, access.organization_id, access.facility_id, access.membership_id,
  member.user_id, encounter.id AS encounter_id, artifact.id AS artifact_id, artifact.kind
FROM encounter_access_assignment_permissions access
JOIN memberships member ON member.id=access.membership_id AND member.organization_id=access.organization_id AND member.facility_id=access.facility_id
JOIN encounters encounter ON encounter.organization_id=access.organization_id AND encounter.facility_id=access.facility_id
  AND encounter.clinician_membership_id=access.membership_id AND encounter.status IN ('finalized','amended')
JOIN patients patient ON patient.id=encounter.patient_id AND patient.organization_id=encounter.organization_id
  AND patient.facility_id=encounter.facility_id AND patient.status='active'
JOIN protocol_heads head ON head.organization_id=encounter.organization_id AND head.facility_id=encounter.facility_id AND head.encounter_id=encounter.id
JOIN protocol_versions version ON version.id=head.current_signed_protocol_version_id AND version.status='signed'
JOIN document_artifacts artifact ON artifact.organization_id=encounter.organization_id AND artifact.facility_id=encounter.facility_id
  AND artifact.encounter_id=encounter.id AND artifact.protocol_version_id=version.id AND artifact.status='ready'
WHERE access.can_read=1 AND access.effective_from<=unixepoch('subsec')*1000
  AND (access.effective_until IS NULL OR access.effective_until>unixepoch('subsec')*1000);
--> statement-breakpoint
CREATE TRIGGER download_audit_selected_authority BEFORE INSERT ON access_audit_events
WHEN (NEW.action='document.download' OR NEW.access_assignment_id IS NOT NULL OR NEW.schema_version=2)
  AND NOT EXISTS (
    SELECT 1 FROM current_download_audit_access access
    WHERE NEW.action='document.download' AND NEW.schema_version=2 AND NEW.outcome='succeeded'
      AND access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
      AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.actor_membership_id
      AND access.user_id=NEW.actor_user_id AND access.encounter_id=NEW.encounter_id
      AND access.artifact_id=NEW.document_artifact_id AND access.kind=NEW.artifact_kind
  )
BEGIN SELECT RAISE(ABORT,'download audit requires current selected assignment'); END;
--> statement-breakpoint
DROP TRIGGER access_audit_events_active_clinician;
--> statement-breakpoint
CREATE TRIGGER access_audit_events_active_clinician BEFORE INSERT ON access_audit_events
WHEN NEW.action<>'document.download' AND NOT EXISTS (
  SELECT 1 FROM memberships membership
  WHERE membership.organization_id=NEW.organization_id AND membership.facility_id=NEW.facility_id
    AND membership.id=NEW.actor_membership_id AND membership.user_id=NEW.actor_user_id
    AND membership.role=NEW.actor_role AND membership.role='clinician' AND membership.status='active'
)
BEGIN SELECT RAISE(ABORT,'access audit actor must be an active clinician'); END;
