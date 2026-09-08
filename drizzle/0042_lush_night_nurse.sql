CREATE TABLE `encounter_transition_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`access_assignment_id` text NOT NULL,
	`actor_membership_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`previous_status` text NOT NULL,
	`previous_version` integer NOT NULL,
	`resulting_status` text NOT NULL,
	`resulting_version` integer NOT NULL,
	`started_at` integer,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`access_assignment_id`) REFERENCES `department_access_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `encounter_transition_version_uidx` ON `encounter_transition_events` (`encounter_id`,`resulting_version`);
--> statement-breakpoint
CREATE TRIGGER encounter_transition_event_no_update BEFORE UPDATE ON encounter_transition_events
BEGIN SELECT RAISE(ABORT,'encounter transition history is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_transition_event_no_delete BEFORE DELETE ON encounter_transition_events
BEGIN SELECT RAISE(ABORT,'encounter transition history is immutable'); END;
--> statement-breakpoint
-- Inserted first in the lifecycle batch: any failed authority or stale version
-- aborts the transaction before the encounter or audit stream is changed.
CREATE TRIGGER encounter_transition_event_authority BEFORE INSERT ON encounter_transition_events
WHEN NOT EXISTS (
  SELECT 1 FROM protocol_write_assignments access
  JOIN encounters encounter ON encounter.id=access.encounter_id
  JOIN memberships member ON member.id=access.membership_id
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.encounter_id=NEW.encounter_id
    AND access.membership_id=NEW.actor_membership_id AND member.user_id=NEW.actor_id
    AND encounter.status=NEW.previous_status AND encounter.version=NEW.previous_version
    AND NEW.resulting_version=NEW.previous_version+1 AND NEW.occurred_at>=encounter.updated_at
    AND ((NEW.previous_status='draft' AND NEW.resulting_status IN ('ready','cancelled'))
      OR (NEW.previous_status='ready' AND NEW.resulting_status IN ('in_progress','cancelled'))
      OR (NEW.previous_status='in_progress' AND NEW.resulting_status='cancelled')
      OR (NEW.previous_status='review' AND NEW.resulting_status IN ('in_progress','cancelled')))
    AND NEW.started_at IS CASE WHEN NEW.resulting_status='in_progress'
      THEN coalesce(encounter.started_at,NEW.occurred_at) ELSE encounter.started_at END
)
BEGIN SELECT RAISE(ABORT,'encounter transition requires current assignment and version'); END;
--> statement-breakpoint
-- Scope only this operation's new immutable event. An older lifecycle event
-- cannot constrain subsequent protocol-driven review/sign/amend transitions.
CREATE TRIGGER encounter_transition_event_update BEFORE UPDATE ON encounters
WHEN (NEW.status<>OLD.status OR NEW.version<>OLD.version) AND EXISTS (SELECT 1 FROM encounter_transition_events event
  WHERE event.encounter_id=NEW.id AND event.resulting_version=NEW.version)
AND NOT EXISTS (
  SELECT 1 FROM encounter_transition_events event JOIN protocol_write_assignments access
    ON access.assignment_id=event.access_assignment_id AND access.membership_id=event.actor_membership_id
    AND access.organization_id=event.organization_id AND access.facility_id=event.facility_id
    AND access.encounter_id=event.encounter_id
  WHERE event.encounter_id=NEW.id AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.previous_status=OLD.status AND event.previous_version=OLD.version
    AND event.resulting_status=NEW.status AND event.resulting_version=NEW.version
    AND event.started_at IS NEW.started_at AND event.occurred_at=NEW.updated_at
)
BEGIN SELECT RAISE(ABORT,'encounter transition does not match authorized event'); END;
--> statement-breakpoint
CREATE VIEW current_encounter_transition_events AS
SELECT event.* FROM encounter_transition_events event
JOIN protocol_write_assignments access ON access.assignment_id=event.access_assignment_id
  AND access.membership_id=event.actor_membership_id AND access.organization_id=event.organization_id
  AND access.facility_id=event.facility_id AND access.encounter_id=event.encounter_id
JOIN encounters encounter ON encounter.id=event.encounter_id AND encounter.status=event.resulting_status
  AND encounter.version=event.resulting_version AND encounter.started_at IS event.started_at
  AND encounter.updated_at=event.occurred_at;
--> statement-breakpoint
CREATE TRIGGER encounter_transition_audit_authority BEFORE INSERT ON audit_events
WHEN NEW.action LIKE 'encounter.transition.%' AND NOT EXISTS (
  SELECT 1 FROM current_encounter_transition_events event
  WHERE event.id=json_extract(NEW.metadata_json,'$.commandId')
    AND event.access_assignment_id=json_extract(NEW.metadata_json,'$.accessAssignmentId')
    AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.encounter_id=NEW.entity_id AND NEW.entity_type='encounter'
    AND event.actor_membership_id=NEW.actor_membership_id AND event.actor_id=NEW.actor_id
    AND NEW.actor_type='user' AND NEW.outcome='succeeded'
    AND NEW.action='encounter.transition.'||event.resulting_status AND NEW.occurred_at=event.occurred_at
    AND json_extract(NEW.metadata_json,'$.previousStatus')=event.previous_status
    AND json_extract(NEW.metadata_json,'$.resultingStatus')=event.resulting_status
    AND json_extract(NEW.metadata_json,'$.previousVersion')=event.previous_version
    AND json_extract(NEW.metadata_json,'$.resultingVersion')=event.resulting_version
)
BEGIN SELECT RAISE(ABORT,'encounter transition audit does not match event'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_transition_command_authority BEFORE INSERT ON command_idempotency
WHEN NEW.operation='encounter.transition' AND NOT EXISTS (
  SELECT 1 FROM current_encounter_transition_events event
  WHERE event.id=NEW.id AND event.access_assignment_id=NEW.access_assignment_id
    AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.actor_membership_id=NEW.actor_membership_id AND event.occurred_at=NEW.created_at
    AND NEW.status='processing' AND NEW.response_json IS NULL
    AND NEW.result_resource_id IS NULL AND NEW.result_resource_type IS NULL
)
BEGIN SELECT RAISE(ABORT,'encounter transition command requires matching event'); END;
--> statement-breakpoint
CREATE TRIGGER encounter_transition_result_authority BEFORE UPDATE ON command_idempotency
WHEN NEW.operation='encounter.transition' AND NEW.status='succeeded' AND NOT EXISTS (
  SELECT 1 FROM current_encounter_transition_events event JOIN audit_events audit
    ON audit.entity_id=event.encounter_id AND audit.entity_type='encounter'
    AND audit.organization_id=event.organization_id AND audit.facility_id=event.facility_id
    AND audit.action='encounter.transition.'||event.resulting_status AND audit.outcome='succeeded'
    AND audit.actor_membership_id=event.actor_membership_id AND audit.actor_id=event.actor_id
    AND json_extract(audit.metadata_json,'$.commandId')=event.id
    AND json_extract(audit.metadata_json,'$.accessAssignmentId')=event.access_assignment_id
  WHERE event.id=NEW.id AND event.organization_id=NEW.organization_id AND event.facility_id=NEW.facility_id
    AND event.access_assignment_id=NEW.access_assignment_id AND event.actor_membership_id=NEW.actor_membership_id
    AND NEW.result_resource_type='encounter_transition' AND NEW.result_resource_id=event.encounter_id
    AND NEW.completed_at=event.occurred_at
    AND json_extract(NEW.response_json,'$.encounterId')=event.encounter_id
    AND json_extract(NEW.response_json,'$.status')=event.resulting_status
    AND json_extract(NEW.response_json,'$.version')=event.resulting_version
    AND json_extract(NEW.response_json,'$.updatedAt')=event.occurred_at
    AND json_extract(NEW.response_json,'$.startedAt') IS event.started_at
    AND (event.started_at IS NOT NULL OR json_type(NEW.response_json,'$.startedAt')='null')
)
BEGIN SELECT RAISE(ABORT,'encounter transition result does not match event and audit'); END;
