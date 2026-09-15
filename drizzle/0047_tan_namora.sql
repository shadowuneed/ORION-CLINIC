CREATE TABLE `encounter_creation_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`access_assignment_id` text NOT NULL,
	`actor_membership_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`request_id` text NOT NULL,
	`request_hash` text NOT NULL,
	`response_json` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`access_assignment_id`) REFERENCES `department_access_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "encounter_creation_json_valid" CHECK(json_valid("encounter_creation_events"."response_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encounter_creation_events_patient_id_unique` ON `encounter_creation_events` (`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `encounter_creation_events_encounter_id_unique` ON `encounter_creation_events` (`encounter_id`);--> statement-breakpoint
ALTER TABLE `encounters` ADD `creation_command_id` text REFERENCES encounter_creation_events(id);--> statement-breakpoint
ALTER TABLE `patients` ADD `creation_command_id` text REFERENCES encounter_creation_events(id);
--> statement-breakpoint
CREATE VIEW current_encounter_creation_access AS
SELECT access.assignment_id,access.organization_id,access.facility_id,access.membership_id,member.user_id
FROM encounter_access_assignment_permissions access JOIN memberships member
  ON member.id=access.membership_id AND member.organization_id=access.organization_id AND member.facility_id=access.facility_id
WHERE access.can_manage=1 AND access.effective_from<=unixepoch('subsec')*1000
  AND (access.effective_until IS NULL OR access.effective_until>unixepoch('subsec')*1000);
--> statement-breakpoint
CREATE TRIGGER encounter_creation_event_authority BEFORE INSERT ON encounter_creation_events
WHEN NOT EXISTS (SELECT 1 FROM current_encounter_creation_access access
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.actor_membership_id AND access.user_id=NEW.actor_id
    AND length(NEW.request_hash)=64 AND length(NEW.request_id)>0
    AND json_extract(NEW.response_json,'$.patient.id')=NEW.patient_id
    AND json_extract(NEW.response_json,'$.encounter.id')=NEW.encounter_id
    AND json_extract(NEW.response_json,'$.encounter.status')='draft'
    AND json_extract(NEW.response_json,'$.encounter.version')=1
    AND json_type(NEW.response_json,'$.encounter.startedAt')='null'
    AND json_type(NEW.response_json,'$.encounter.reasonForVisit') IN ('null','text')
    AND json_type(NEW.response_json,'$.patient.birthDate') IN ('null','text')
    AND length(trim(json_extract(NEW.response_json,'$.patient.displayName'))) BETWEEN 2 AND 120
    AND json_extract(NEW.response_json,'$.patient.sexAtBirth') IN ('female','male','unknown','not_recorded')
    AND json_extract(NEW.response_json,'$.patient.medicalRecordNumber') LIKE 'SYN-%'
    AND NOT EXISTS (SELECT 1 FROM patients patient WHERE patient.organization_id=NEW.organization_id
      AND patient.facility_id=NEW.facility_id AND patient.status='active'
      AND lower(trim(patient.display_name))=lower(trim(json_extract(NEW.response_json,'$.patient.displayName')))
      AND patient.birth_date IS json_extract(NEW.response_json,'$.patient.birthDate'))
)
BEGIN SELECT RAISE(ABORT,'encounter creation requires current assignment and unique patient'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_creation_event_no_update BEFORE UPDATE ON encounter_creation_events
BEGIN SELECT RAISE(ABORT,'encounter creation events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_creation_event_no_delete BEFORE DELETE ON encounter_creation_events
BEGIN SELECT RAISE(ABORT,'encounter creation events are immutable'); END;
--> statement-breakpoint
CREATE VIEW current_encounter_creation_events AS
SELECT event.* FROM encounter_creation_events event JOIN current_encounter_creation_access access
  ON access.assignment_id=event.access_assignment_id AND access.organization_id=event.organization_id
  AND access.facility_id=event.facility_id AND access.membership_id=event.actor_membership_id AND access.user_id=event.actor_id;
--> statement-breakpoint
CREATE TRIGGER patient_creation_event_guard BEFORE INSERT ON patients
WHEN NEW.creation_command_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM current_encounter_creation_events event WHERE event.id=NEW.creation_command_id
    AND event.patient_id=NEW.id AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND NEW.status='active' AND NEW.version=1 AND NEW.created_at=event.occurred_at AND NEW.updated_at=event.occurred_at
    AND NEW.display_name=json_extract(event.response_json,'$.patient.displayName')
    AND NEW.birth_date IS json_extract(event.response_json,'$.patient.birthDate')
    AND NEW.sex_at_birth=json_extract(event.response_json,'$.patient.sexAtBirth')
    AND NEW.medical_record_number=json_extract(event.response_json,'$.patient.medicalRecordNumber')
)
BEGIN SELECT RAISE(ABORT,'patient does not match creation event'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_creation_event_guard BEFORE INSERT ON encounters
WHEN NEW.creation_command_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM current_encounter_creation_events event JOIN patients patient ON patient.id=event.patient_id
    AND patient.creation_command_id=event.id AND patient.status='active'
  WHERE event.id=NEW.creation_command_id AND event.encounter_id=NEW.id AND event.patient_id=NEW.patient_id
    AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.actor_membership_id=NEW.clinician_membership_id AND NEW.status='draft' AND NEW.version=1
    AND NEW.started_at IS NULL AND NEW.created_at=event.occurred_at AND NEW.updated_at=event.occurred_at
    AND NEW.reason_for_visit IS json_extract(event.response_json,'$.encounter.reasonForVisit')
)
BEGIN SELECT RAISE(ABORT,'encounter does not match creation event'); END;
--> statement-breakpoint
CREATE TRIGGER patient_creation_id_immutable BEFORE UPDATE ON patients
WHEN NEW.creation_command_id IS NOT OLD.creation_command_id
BEGIN SELECT RAISE(ABORT,'patient creation attribution is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_creation_id_immutable BEFORE UPDATE ON encounters
WHEN NEW.creation_command_id IS NOT OLD.creation_command_id
BEGIN SELECT RAISE(ABORT,'encounter creation attribution is immutable'); END;
--> statement-breakpoint
CREATE VIEW completed_encounter_creation_events AS
SELECT event.* FROM current_encounter_creation_events event
JOIN patients patient ON patient.id=event.patient_id AND patient.creation_command_id=event.id
  AND patient.organization_id=event.organization_id AND patient.facility_id=event.facility_id AND patient.status='active'
JOIN encounters encounter ON encounter.id=event.encounter_id AND encounter.creation_command_id=event.id
  AND encounter.organization_id=event.organization_id AND encounter.facility_id=event.facility_id
  AND encounter.patient_id=patient.id AND encounter.clinician_membership_id=event.actor_membership_id
  AND encounter.status='draft' AND encounter.version=1
JOIN patient_profile_heads profile_head ON profile_head.patient_id=patient.id
  AND profile_head.organization_id=event.organization_id AND profile_head.facility_id=event.facility_id
  AND profile_head.lock_version=1
JOIN patient_profile_versions profile ON profile.id=profile_head.current_version_id
  AND profile.patient_id=patient.id AND profile.organization_id=event.organization_id
  AND profile.facility_id=event.facility_id AND profile.version=1 AND profile.status='active'
  AND profile.created_by_membership_id=event.actor_membership_id
  AND profile.display_name=json_extract(event.response_json,'$.patient.displayName')
  AND profile.birth_date IS json_extract(event.response_json,'$.patient.birthDate')
  AND profile.sex_at_birth=json_extract(event.response_json,'$.patient.sexAtBirth')
  AND patient.display_name=profile.display_name AND patient.birth_date IS profile.birth_date
  AND patient.sex_at_birth=profile.sex_at_birth AND patient.version=1
  AND encounter.reason_for_visit IS json_extract(event.response_json,'$.encounter.reasonForVisit')
WHERE (SELECT count(*) FROM clinical_section_heads head JOIN clinical_section_versions version
  ON version.id=head.current_version_id AND version.organization_id=head.organization_id
  AND version.facility_id=head.facility_id AND version.encounter_id=head.encounter_id AND version.code=head.code
  WHERE head.organization_id=event.organization_id AND head.facility_id=event.facility_id AND head.encounter_id=event.encounter_id
    AND head.lock_version=1 AND version.version=1 AND version.review_state='empty' AND version.content=''
    AND version.created_by_type='service' AND version.created_by_id='synthetic-encounter-creation')=8;
--> statement-breakpoint
CREATE TRIGGER encounter_creation_audit_guard BEFORE INSERT ON audit_events
WHEN NEW.action='encounter.create_synthetic' AND NOT EXISTS (
  SELECT 1 FROM completed_encounter_creation_events event WHERE event.id=json_extract(NEW.metadata_json,'$.commandId')
    AND event.access_assignment_id=json_extract(NEW.metadata_json,'$.accessAssignmentId')
    AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.actor_id=NEW.actor_id AND event.actor_membership_id=NEW.actor_membership_id AND NEW.actor_type='user'
    AND NEW.entity_type='encounter' AND NEW.entity_id=event.encounter_id AND NEW.outcome='succeeded'
    AND NEW.purpose='synthetic_encounter_creation' AND NEW.request_id=event.request_id AND NEW.occurred_at=event.occurred_at
)
BEGIN SELECT RAISE(ABORT,'encounter creation audit does not match event'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_creation_command_guard BEFORE INSERT ON command_idempotency
WHEN NEW.operation='encounter.create_synthetic' AND NOT EXISTS (
  SELECT 1 FROM completed_encounter_creation_events event JOIN audit_events audit
    ON audit.organization_id=event.organization_id AND audit.facility_id=event.facility_id
    AND audit.action='encounter.create_synthetic' AND json_extract(audit.metadata_json,'$.commandId')=event.id
    AND audit.entity_id=event.encounter_id AND audit.outcome='succeeded'
  WHERE event.id=NEW.id AND event.access_assignment_id=NEW.access_assignment_id
    AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.actor_membership_id=NEW.actor_membership_id AND event.request_hash=NEW.request_hash
    AND event.occurred_at=NEW.created_at AND NEW.status='processing' AND NEW.response_json IS NULL
    AND NEW.result_resource_id IS NULL AND NEW.result_resource_type IS NULL
)
BEGIN SELECT RAISE(ABORT,'encounter creation command does not match event'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_creation_result_guard BEFORE UPDATE ON command_idempotency
WHEN NEW.operation='encounter.create_synthetic' AND NOT EXISTS (
  SELECT 1 FROM completed_encounter_creation_events event JOIN audit_events audit
    ON audit.organization_id=event.organization_id AND audit.facility_id=event.facility_id
    AND audit.action='encounter.create_synthetic' AND json_extract(audit.metadata_json,'$.commandId')=event.id
    AND audit.entity_id=event.encounter_id AND audit.outcome='succeeded'
  WHERE event.id=NEW.id AND event.access_assignment_id=NEW.access_assignment_id
    AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.actor_membership_id=NEW.actor_membership_id AND event.request_hash=NEW.request_hash
    AND NEW.status='succeeded' AND NEW.result_resource_type='synthetic_encounter'
    AND NEW.result_resource_id=event.encounter_id AND NEW.response_json=event.response_json
    AND NEW.completed_at=event.occurred_at
)
BEGIN SELECT RAISE(ABORT,'encounter creation result does not match event'); END;
