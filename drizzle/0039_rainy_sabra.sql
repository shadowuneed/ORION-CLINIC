ALTER TABLE `analysis_runs` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);
--> statement-breakpoint
CREATE VIEW clinical_analysis_assignments AS
SELECT access.* FROM transcript_correction_assignments access JOIN encounters encounter ON encounter.id=access.encounter_id
WHERE encounter.status='in_progress' AND EXISTS (
  SELECT 1 FROM consent_heads head JOIN consent_events event ON event.id=head.current_consent_event_id
    AND event.organization_id=head.organization_id AND event.facility_id=head.facility_id
    AND event.patient_id=head.patient_id AND event.encounter_id=head.encounter_id AND event.consent_type=head.consent_type
  WHERE head.organization_id=access.organization_id AND head.facility_id=access.facility_id
    AND head.encounter_id=access.encounter_id AND head.patient_id=encounter.patient_id
    AND event.consent_type='external_ai_processing' AND event.external_processor='groq' AND event.decision='granted'
    AND event.effective_at <= unixepoch('subsec')*1000 AND (event.expires_at IS NULL OR event.expires_at > unixepoch('subsec')*1000)
);
--> statement-breakpoint
CREATE TRIGGER analysis_assignment_insert BEFORE INSERT ON analysis_runs
WHEN NEW.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM clinical_analysis_assignments access WHERE access.assignment_id=NEW.access_assignment_id
    AND access.organization_id=NEW.organization_id AND access.facility_id=NEW.facility_id
    AND access.encounter_id=NEW.encounter_id AND access.membership_id=NEW.requested_by_membership_id
)
BEGIN SELECT RAISE(ABORT,'analysis requires current assignment and consent'); END;
--> statement-breakpoint
CREATE TRIGGER analysis_assignment_immutable BEFORE UPDATE ON analysis_runs
WHEN NEW.access_assignment_id IS NOT OLD.access_assignment_id
BEGIN SELECT RAISE(ABORT,'analysis assignment is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER analysis_assignment_completion BEFORE UPDATE ON analysis_runs
WHEN OLD.access_assignment_id IS NOT NULL AND NEW.status='succeeded' AND NOT EXISTS (
  SELECT 1 FROM clinical_analysis_assignments access WHERE access.assignment_id=NEW.access_assignment_id
    AND access.organization_id=NEW.organization_id AND access.facility_id=NEW.facility_id
    AND access.encounter_id=NEW.encounter_id AND access.membership_id=NEW.requested_by_membership_id
)
BEGIN SELECT RAISE(ABORT,'analysis completion requires current assignment and consent'); END;
--> statement-breakpoint
CREATE TRIGGER analysis_command_assignment BEFORE INSERT ON command_idempotency
WHEN NEW.operation='analysis.generate' AND NOT EXISTS (
  SELECT 1 FROM clinical_analysis_assignments access WHERE access.assignment_id=NEW.access_assignment_id
    AND access.organization_id=NEW.organization_id AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.actor_membership_id
)
BEGIN SELECT RAISE(ABORT,'analysis command requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER analysis_audit_assignment BEFORE INSERT ON audit_events
WHEN NEW.action='analysis.generate' AND NOT EXISTS (
  SELECT 1 FROM analysis_runs run JOIN clinical_analysis_assignments access ON access.assignment_id=run.access_assignment_id
    AND access.organization_id=run.organization_id AND access.facility_id=run.facility_id AND access.encounter_id=run.encounter_id
  JOIN memberships member ON member.id=access.membership_id
  WHERE run.id=NEW.entity_id AND NEW.entity_type='analysis_run' AND run.status='succeeded'
    AND run.organization_id=NEW.organization_id AND run.facility_id=NEW.facility_id
    AND access.membership_id=run.requested_by_membership_id AND NEW.actor_membership_id=access.membership_id
    AND NEW.actor_type='user' AND NEW.actor_id=member.user_id
    AND json_extract(NEW.metadata_json,'$.accessAssignmentId')=access.assignment_id
)
BEGIN SELECT RAISE(ABORT,'analysis audit requires matching assignment'); END;
--> statement-breakpoint
CREATE TRIGGER analysis_command_result_assignment BEFORE UPDATE ON command_idempotency
WHEN NEW.operation='analysis.generate' AND NEW.status='succeeded' AND NOT EXISTS (
  SELECT 1 FROM analysis_runs run JOIN clinical_analysis_assignments access ON access.assignment_id=run.access_assignment_id
    AND access.organization_id=run.organization_id AND access.facility_id=run.facility_id AND access.encounter_id=run.encounter_id
  WHERE run.id=NEW.result_resource_id AND NEW.result_resource_type='analysis_run'
    AND run.organization_id=NEW.organization_id AND run.facility_id=NEW.facility_id AND run.status='succeeded'
    AND run.access_assignment_id=NEW.access_assignment_id AND run.requested_by_membership_id=NEW.actor_membership_id
    AND access.membership_id=NEW.actor_membership_id
)
BEGIN SELECT RAISE(ABORT,'analysis result requires matching assignment'); END;
