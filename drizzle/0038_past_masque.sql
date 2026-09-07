ALTER TABLE `transcription_runs` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);
--> statement-breakpoint
CREATE VIEW speech_capture_assignments AS
SELECT access.* FROM transcript_correction_assignments access
JOIN encounters encounter ON encounter.id=access.encounter_id
WHERE encounter.status='in_progress' AND EXISTS (
  SELECT 1 FROM consent_heads head JOIN consent_events event ON event.id=head.current_consent_event_id
    AND event.organization_id=head.organization_id AND event.facility_id=head.facility_id
    AND event.encounter_id=head.encounter_id AND event.patient_id=head.patient_id AND event.consent_type=head.consent_type
  WHERE head.organization_id=access.organization_id AND head.facility_id=access.facility_id
    AND head.encounter_id=access.encounter_id AND head.patient_id=encounter.patient_id
    AND event.consent_type='transient_audio_processing' AND event.decision='granted'
    AND event.effective_at <= unixepoch('subsec')*1000
    AND (event.expires_at IS NULL OR event.expires_at > unixepoch('subsec')*1000)
);
--> statement-breakpoint
CREATE TRIGGER speech_run_assignment_insert BEFORE INSERT ON transcription_runs
WHEN NEW.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM speech_capture_assignments access WHERE access.assignment_id=NEW.access_assignment_id
    AND access.organization_id=NEW.organization_id AND access.facility_id=NEW.facility_id
    AND access.encounter_id=NEW.encounter_id AND access.membership_id=NEW.started_by_membership_id
)
BEGIN SELECT RAISE(ABORT,'speech session requires current assignment and consent'); END;
--> statement-breakpoint
CREATE TRIGGER speech_run_assignment_immutable BEFORE UPDATE ON transcription_runs
WHEN NEW.access_assignment_id IS NOT OLD.access_assignment_id
BEGIN SELECT RAISE(ABORT,'speech assignment is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER speech_run_assignment_update BEFORE UPDATE ON transcription_runs
WHEN OLD.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM encounter_access_assignment_permissions access WHERE access.assignment_id=OLD.access_assignment_id
    AND access.organization_id=OLD.organization_id AND access.facility_id=OLD.facility_id
    AND access.membership_id=OLD.started_by_membership_id AND access.can_manage=1
    AND access.effective_from <= unixepoch('subsec')*1000
    AND (access.effective_until IS NULL OR access.effective_until > unixepoch('subsec')*1000)
)
BEGIN SELECT RAISE(ABORT,'speech update requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER speech_result_assignment_guard BEFORE INSERT ON transcription_results
WHEN EXISTS (SELECT 1 FROM transcription_runs run WHERE run.id=NEW.transcription_run_id AND run.access_assignment_id IS NOT NULL)
AND NOT EXISTS (
  SELECT 1 FROM transcription_runs run JOIN speech_capture_assignments access ON access.assignment_id=run.access_assignment_id
    AND access.organization_id=run.organization_id AND access.facility_id=run.facility_id AND access.encounter_id=run.encounter_id
  WHERE run.id=NEW.transcription_run_id AND run.organization_id=NEW.organization_id
    AND run.facility_id=NEW.facility_id AND run.encounter_id=NEW.encounter_id
    AND run.status='running' AND access.membership_id=run.started_by_membership_id
)
BEGIN SELECT RAISE(ABORT,'speech result requires current assignment and consent'); END;
--> statement-breakpoint
CREATE TRIGGER speech_audit_assignment_guard BEFORE INSERT ON audit_events
WHEN NEW.action='transcript.ingest.stt' AND NOT EXISTS (
  SELECT 1 FROM transcription_runs run JOIN speech_capture_assignments access ON access.assignment_id=run.access_assignment_id
    AND access.organization_id=run.organization_id AND access.facility_id=run.facility_id AND access.encounter_id=run.encounter_id
  JOIN memberships member ON member.id=access.membership_id
  JOIN transcription_results result ON result.transcription_run_id=run.id AND result.organization_id=run.organization_id
    AND result.facility_id=run.facility_id AND result.encounter_id=run.encounter_id
  WHERE run.id=json_extract(NEW.metadata_json,'$.transcriptionRunId')
    AND access.assignment_id=json_extract(NEW.metadata_json,'$.accessAssignmentId')
    AND NEW.organization_id=run.organization_id AND NEW.facility_id=run.facility_id
    AND NEW.actor_type='user' AND NEW.actor_id=member.user_id AND NEW.actor_membership_id=access.membership_id
    AND run.started_by_membership_id=access.membership_id
    AND NEW.entity_type='transcript_segment' AND NEW.entity_id=result.transcript_segment_id
)
BEGIN SELECT RAISE(ABORT,'speech audit requires matching assignment'); END;
