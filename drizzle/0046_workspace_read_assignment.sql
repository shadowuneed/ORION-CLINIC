-- New reads require exact assignment attribution; historical events remain unchanged.
CREATE VIEW current_workspace_audit_access AS
SELECT access.assignment_id, access.organization_id, access.facility_id, access.membership_id,
  member.user_id, encounter.id AS encounter_id
FROM encounter_access_assignment_permissions access
JOIN memberships member ON member.id=access.membership_id
  AND member.organization_id=access.organization_id AND member.facility_id=access.facility_id
JOIN encounters encounter ON encounter.organization_id=access.organization_id AND encounter.facility_id=access.facility_id
  AND encounter.clinician_membership_id=access.membership_id
JOIN patients patient ON patient.id=encounter.patient_id AND patient.organization_id=encounter.organization_id
  AND patient.facility_id=encounter.facility_id AND patient.status='active'
WHERE access.can_read=1 AND access.effective_from<=unixepoch('subsec')*1000
  AND (access.effective_until IS NULL OR access.effective_until>unixepoch('subsec')*1000);
--> statement-breakpoint
DROP TRIGGER download_audit_selected_authority;
--> statement-breakpoint
CREATE TRIGGER download_audit_selected_authority BEFORE INSERT ON access_audit_events
WHEN NEW.action='document.download' AND NOT EXISTS (
  SELECT 1 FROM current_download_audit_access access
  WHERE NEW.schema_version=2 AND NEW.outcome='succeeded'
    AND access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.actor_membership_id
    AND access.user_id=NEW.actor_user_id AND access.encounter_id=NEW.encounter_id
    AND access.artifact_id=NEW.document_artifact_id AND access.kind=NEW.artifact_kind
)
BEGIN SELECT RAISE(ABORT,'download audit requires current selected assignment'); END;
--> statement-breakpoint
CREATE TRIGGER workspace_audit_selected_authority BEFORE INSERT ON access_audit_events
WHEN NEW.action='workspace.read' AND NOT EXISTS (
  SELECT 1 FROM current_workspace_audit_access access
  WHERE NEW.schema_version=2 AND NEW.outcome='succeeded'
    AND NEW.response_status=200 AND NEW.decision_code='authorized_response_prepared'
    AND access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.actor_membership_id
    AND access.user_id=NEW.actor_user_id AND access.encounter_id=NEW.encounter_id
)
BEGIN SELECT RAISE(ABORT,'workspace audit requires current selected assignment'); END;
--> statement-breakpoint
DROP TRIGGER access_audit_events_active_clinician;
