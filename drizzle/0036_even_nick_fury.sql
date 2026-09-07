ALTER TABLE `consent_events` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);
--> statement-breakpoint
-- Legacy fixture/independent creation events remain unattributed. Command and
-- audit guards below require attribution for every interactive consent command.
CREATE TRIGGER consent_event_assignment_guard BEFORE INSERT ON consent_events
WHEN NEW.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM encounter_access_assignment_permissions access
  JOIN encounters encounter ON encounter.organization_id=access.organization_id
    AND encounter.facility_id=access.facility_id AND encounter.clinician_membership_id=access.membership_id
  JOIN patients patient ON patient.id=encounter.patient_id AND patient.organization_id=encounter.organization_id
    AND patient.facility_id=encounter.facility_id AND patient.status='active'
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.captured_by_membership_id
    AND encounter.id=NEW.encounter_id AND patient.id=NEW.patient_id AND access.can_manage=1
    AND access.effective_from <= unixepoch('subsec')*1000
    AND (access.effective_until IS NULL OR access.effective_until > unixepoch('subsec')*1000)
)
BEGIN SELECT RAISE(ABORT,'consent requires current exact assignment'); END;
--> statement-breakpoint
CREATE TRIGGER consent_audit_assignment_guard BEFORE INSERT ON audit_events
WHEN NEW.action IN ('consent.granted','consent.denied','consent.withdrawn') AND NOT EXISTS (
  SELECT 1 FROM consent_events event
  JOIN encounter_access_assignment_permissions access ON access.assignment_id=event.access_assignment_id
    AND access.organization_id=event.organization_id AND access.facility_id=event.facility_id
  JOIN memberships member ON member.id=access.membership_id
  WHERE event.id=NEW.entity_id AND NEW.entity_type='consent_event'
    AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND NEW.actor_type='user' AND NEW.actor_id=member.user_id
    AND NEW.actor_membership_id=access.membership_id AND event.captured_by_membership_id=access.membership_id
    AND json_extract(NEW.metadata_json,'$.accessAssignmentId')=access.assignment_id
    AND NEW.action='consent.' || event.decision AND access.can_manage=1
    AND access.effective_from <= unixepoch('subsec')*1000
    AND (access.effective_until IS NULL OR access.effective_until > unixepoch('subsec')*1000)
)
BEGIN SELECT RAISE(ABORT,'consent audit requires matching current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER consent_command_assignment_guard BEFORE INSERT ON command_idempotency
WHEN NEW.operation='consent.command' AND NOT EXISTS (
  SELECT 1 FROM encounter_access_assignment_permissions access
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.actor_membership_id AND access.can_manage=1
    AND access.effective_from <= unixepoch('subsec')*1000
    AND (access.effective_until IS NULL OR access.effective_until > unixepoch('subsec')*1000)
)
BEGIN SELECT RAISE(ABORT,'consent command requires current exact assignment'); END;
--> statement-breakpoint
CREATE TRIGGER consent_command_result_guard BEFORE UPDATE ON command_idempotency
WHEN NEW.operation='consent.command' AND NEW.status='succeeded' AND NOT EXISTS (
  SELECT 1 FROM consent_events event
  JOIN encounter_access_assignment_permissions access ON access.assignment_id=event.access_assignment_id
    AND access.organization_id=event.organization_id AND access.facility_id=event.facility_id
  WHERE event.id=NEW.result_resource_id AND NEW.result_resource_type='consent_event'
    AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.access_assignment_id=NEW.access_assignment_id
    AND event.captured_by_membership_id=NEW.actor_membership_id AND access.membership_id=NEW.actor_membership_id
    AND access.can_manage=1 AND access.effective_from <= unixepoch('subsec')*1000
    AND (access.effective_until IS NULL OR access.effective_until > unixepoch('subsec')*1000)
)
BEGIN SELECT RAISE(ABORT,'consent result requires matching current assignment'); END;
