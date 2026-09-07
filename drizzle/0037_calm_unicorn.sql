ALTER TABLE `transcript_segments` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);
--> statement-breakpoint
CREATE VIEW transcript_correction_assignments AS
SELECT access.*, encounter.id AS encounter_id FROM encounter_access_assignment_permissions access
JOIN encounters encounter ON encounter.organization_id=access.organization_id AND encounter.facility_id=access.facility_id
  AND encounter.clinician_membership_id=access.membership_id
JOIN patients patient ON patient.id=encounter.patient_id AND patient.organization_id=encounter.organization_id
  AND patient.facility_id=encounter.facility_id AND patient.status='active'
WHERE access.can_manage=1 AND encounter.status IN ('in_progress','review')
  AND access.effective_from <= unixepoch('subsec')*1000
  AND (access.effective_until IS NULL OR access.effective_until > unixepoch('subsec')*1000)
  AND 2=(SELECT count(DISTINCT event.consent_type) FROM consent_heads head
    JOIN consent_events event ON event.id=head.current_consent_event_id
      AND event.organization_id=head.organization_id AND event.facility_id=head.facility_id
      AND event.patient_id=head.patient_id AND event.encounter_id=head.encounter_id AND event.consent_type=head.consent_type
    WHERE head.encounter_id=encounter.id AND head.organization_id=encounter.organization_id
      AND head.facility_id=encounter.facility_id AND head.patient_id=patient.id
      AND event.consent_type IN ('care','transcript_storage') AND event.decision='granted'
      AND event.effective_at <= unixepoch('subsec')*1000
      AND (event.expires_at IS NULL OR event.expires_at > unixepoch('subsec')*1000));
--> statement-breakpoint
-- Raw ingestion/legacy fixtures remain a separate writer migration. Interactive
-- correction commands and audits always require attributed versions below.
CREATE TRIGGER transcript_assignment_guard BEFORE INSERT ON transcript_segments
WHEN NEW.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM transcript_correction_assignments access
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.encounter_id=NEW.encounter_id
    AND access.membership_id=NEW.corrected_by_membership_id
    AND NEW.state='corrected' AND NEW.speaker_role_source='manual'
)
BEGIN SELECT RAISE(ABORT,'transcript correction requires current assigned doctor and consent'); END;
--> statement-breakpoint
CREATE TRIGGER transcript_audit_assignment_guard BEFORE INSERT ON audit_events
WHEN NEW.action='transcript.correct' AND NOT EXISTS (
  SELECT 1 FROM transcript_segments segment
  JOIN transcript_correction_assignments access ON access.assignment_id=segment.access_assignment_id
    AND access.organization_id=segment.organization_id AND access.facility_id=segment.facility_id AND access.encounter_id=segment.encounter_id
  JOIN memberships member ON member.id=access.membership_id
  WHERE segment.id=NEW.entity_id AND NEW.entity_type='transcript_segment'
    AND NEW.organization_id=segment.organization_id AND NEW.facility_id=segment.facility_id
    AND NEW.actor_type='user' AND NEW.actor_id=member.user_id AND NEW.actor_membership_id=access.membership_id
    AND segment.corrected_by_membership_id=access.membership_id
    AND json_extract(NEW.metadata_json,'$.accessAssignmentId')=access.assignment_id
)
BEGIN SELECT RAISE(ABORT,'transcript audit requires matching current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER transcript_command_assignment_guard BEFORE INSERT ON command_idempotency
WHEN NEW.operation='transcript.correct' AND NOT EXISTS (
  SELECT 1 FROM transcript_correction_assignments access WHERE access.assignment_id=NEW.access_assignment_id
    AND access.organization_id=NEW.organization_id AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.actor_membership_id
)
BEGIN SELECT RAISE(ABORT,'transcript command requires current exact assignment'); END;
--> statement-breakpoint
CREATE TRIGGER transcript_command_result_guard BEFORE UPDATE ON command_idempotency
WHEN NEW.operation='transcript.correct' AND NEW.status='succeeded' AND NOT EXISTS (
  SELECT 1 FROM transcript_segments segment
  JOIN transcript_correction_assignments access ON access.assignment_id=segment.access_assignment_id
    AND access.organization_id=segment.organization_id AND access.facility_id=segment.facility_id AND access.encounter_id=segment.encounter_id
  WHERE segment.id=NEW.result_resource_id AND NEW.result_resource_type='transcript_segment_version'
    AND segment.organization_id=NEW.organization_id AND segment.facility_id=NEW.facility_id
    AND segment.access_assignment_id=NEW.access_assignment_id AND segment.corrected_by_membership_id=NEW.actor_membership_id
    AND access.membership_id=NEW.actor_membership_id
)
BEGIN SELECT RAISE(ABORT,'transcript result requires matching current assignment'); END;
