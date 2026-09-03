CREATE TABLE `access_audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`stream_key` text NOT NULL,
	`sequence` integer NOT NULL,
	`actor_user_id` text NOT NULL,
	`actor_membership_id` text NOT NULL,
	`actor_role` text NOT NULL,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`purpose_code` text NOT NULL,
	`route_code` text NOT NULL,
	`decision_code` text NOT NULL,
	`response_status` integer NOT NULL,
	`encounter_id` text NOT NULL,
	`document_artifact_id` text,
	`artifact_kind` text,
	`request_id` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`previous_hash` text,
	`event_hash` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`actor_membership_id`,`actor_user_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`,`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`document_artifact_id`) REFERENCES `document_artifacts`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "access_audit_sequence_positive" CHECK("access_audit_events"."sequence" > 0),
	CONSTRAINT "access_audit_schema_version_positive" CHECK("access_audit_events"."schema_version" > 0),
	CONSTRAINT "access_audit_stream_matches_actor" CHECK("access_audit_events"."stream_key" = 'membership:' || "access_audit_events"."actor_membership_id"),
	CONSTRAINT "access_audit_genesis_consistent" CHECK(("access_audit_events"."sequence" = 1 and "access_audit_events"."previous_hash" is null) or ("access_audit_events"."sequence" > 1 and "access_audit_events"."previous_hash" is not null)),
	CONSTRAINT "access_audit_action_resource_consistent" CHECK((
        "access_audit_events"."action" = 'workspace.read'
        and "access_audit_events"."route_code" = 'workspace'
        and "access_audit_events"."purpose_code" = 'synthetic_direct_patient_care'
        and "access_audit_events"."document_artifact_id" is null
        and "access_audit_events"."artifact_kind" is null
      ) or (
        "access_audit_events"."action" = 'document.download'
        and "access_audit_events"."route_code" = 'document_export_download'
        and "access_audit_events"."purpose_code" = 'synthetic_clinical_export_download'
        and "access_audit_events"."document_artifact_id" is not null
        and "access_audit_events"."artifact_kind" is not null
      )),
	CONSTRAINT "access_audit_success_decision_consistent" CHECK(("access_audit_events"."outcome" = 'succeeded' and "access_audit_events"."response_status" between 200 and 299 and "access_audit_events"."decision_code" = 'authorized_response_prepared') or ("access_audit_events"."outcome" <> 'succeeded' and "access_audit_events"."decision_code" <> 'authorized_response_prepared')),
	CONSTRAINT "access_audit_response_status_valid" CHECK("access_audit_events"."response_status" between 100 and 599),
	CONSTRAINT "access_audit_actor_role_enum" CHECK("access_audit_events"."actor_role" in ('clinician')),
	CONSTRAINT "access_audit_action_enum" CHECK("access_audit_events"."action" in ('workspace.read', 'document.download')),
	CONSTRAINT "access_audit_outcome_enum" CHECK("access_audit_events"."outcome" in ('succeeded', 'denied', 'failed')),
	CONSTRAINT "access_audit_purpose_enum" CHECK("access_audit_events"."purpose_code" in ('synthetic_direct_patient_care', 'synthetic_clinical_export_download')),
	CONSTRAINT "access_audit_route_enum" CHECK("access_audit_events"."route_code" in ('workspace', 'document_export_download')),
	CONSTRAINT "access_audit_artifact_kind_enum" CHECK("access_audit_events"."artifact_kind" in ('protocol_docx', 'protocol_pdf', 'transcript_txt', 'audit_json', 'bundle_zip'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_audit_stream_sequence_uidx` ON `access_audit_events` (`organization_id`,`facility_id`,`stream_key`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `access_audit_request_uidx` ON `access_audit_events` (`request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `access_audit_event_hash_uidx` ON `access_audit_events` (`event_hash`);--> statement-breakpoint
CREATE UNIQUE INDEX `access_audit_stream_sequence_hash_uidx` ON `access_audit_events` (`organization_id`,`facility_id`,`stream_key`,`sequence`,`event_hash`);--> statement-breakpoint
CREATE INDEX `access_audit_scope_time_idx` ON `access_audit_events` (`organization_id`,`facility_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `access_audit_actor_time_idx` ON `access_audit_events` (`organization_id`,`facility_id`,`actor_membership_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `access_audit_encounter_time_idx` ON `access_audit_events` (`organization_id`,`facility_id`,`encounter_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `access_audit_document_time_idx` ON `access_audit_events` (`organization_id`,`facility_id`,`document_artifact_id`,`occurred_at`);--> statement-breakpoint
CREATE TABLE `access_audit_stream_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`stream_key` text NOT NULL,
	`actor_membership_id` text NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`last_event_hash` text,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`actor_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`stream_key`,`last_sequence`,`last_event_hash`) REFERENCES `access_audit_events`(`organization_id`,`facility_id`,`stream_key`,`sequence`,`event_hash`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "access_audit_stream_heads_match_actor" CHECK("access_audit_stream_heads"."stream_key" = 'membership:' || "access_audit_stream_heads"."actor_membership_id"),
	CONSTRAINT "access_audit_stream_heads_sequence_nonnegative" CHECK("access_audit_stream_heads"."last_sequence" >= 0),
	CONSTRAINT "access_audit_stream_heads_lock_positive" CHECK("access_audit_stream_heads"."lock_version" > 0),
	CONSTRAINT "access_audit_stream_heads_genesis_consistent" CHECK(("access_audit_stream_heads"."last_sequence" = 0 and "access_audit_stream_heads"."last_event_hash" is null) or ("access_audit_stream_heads"."last_sequence" > 0 and "access_audit_stream_heads"."last_event_hash" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `access_audit_stream_heads_scope_uidx` ON `access_audit_stream_heads` (`organization_id`,`facility_id`,`stream_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_scope_encounter_id_uidx` ON `document_artifacts` (`organization_id`,`facility_id`,`encounter_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_scope_id_user_uidx` ON `memberships` (`organization_id`,`facility_id`,`id`,`user_id`);--> statement-breakpoint
CREATE TRIGGER `access_audit_events_no_update`
BEFORE UPDATE ON `access_audit_events`
BEGIN
  SELECT RAISE(ABORT, 'access audit events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `access_audit_events_no_delete`
BEFORE DELETE ON `access_audit_events`
BEGIN
  SELECT RAISE(ABORT, 'access audit events are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `access_audit_events_extend_current_head`
BEFORE INSERT ON `access_audit_events`
WHEN NOT EXISTS (
  SELECT 1 FROM `access_audit_stream_heads` head
  WHERE head.`organization_id` = NEW.`organization_id`
    AND head.`facility_id` = NEW.`facility_id`
    AND head.`stream_key` = NEW.`stream_key`
    AND head.`actor_membership_id` = NEW.`actor_membership_id`
    AND head.`last_sequence` = NEW.`sequence` - 1
    AND head.`last_event_hash` IS NEW.`previous_hash`
)
BEGIN
  SELECT RAISE(ABORT, 'access audit event must extend its actor stream head');
END;--> statement-breakpoint
CREATE TRIGGER `access_audit_events_active_clinician`
BEFORE INSERT ON `access_audit_events`
WHEN NOT EXISTS (
  SELECT 1 FROM `memberships` membership
  WHERE membership.`organization_id` = NEW.`organization_id`
    AND membership.`facility_id` = NEW.`facility_id`
    AND membership.`id` = NEW.`actor_membership_id`
    AND membership.`user_id` = NEW.`actor_user_id`
    AND membership.`role` = NEW.`actor_role`
    AND membership.`role` = 'clinician'
    AND membership.`status` = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'access audit actor must be an active clinician');
END;--> statement-breakpoint
CREATE TRIGGER `access_audit_events_assigned_resource`
BEFORE INSERT ON `access_audit_events`
WHEN
  NOT EXISTS (
    SELECT 1 FROM `encounters` encounter
    WHERE encounter.`organization_id` = NEW.`organization_id`
      AND encounter.`facility_id` = NEW.`facility_id`
      AND encounter.`id` = NEW.`encounter_id`
      AND encounter.`clinician_membership_id` = NEW.`actor_membership_id`
  )
  OR (
    NEW.`action` = 'document.download'
    AND NOT EXISTS (
      SELECT 1 FROM `document_artifacts` artifact
      JOIN `protocol_heads` protocol_head
        ON protocol_head.`organization_id` = artifact.`organization_id`
        AND protocol_head.`facility_id` = artifact.`facility_id`
        AND protocol_head.`encounter_id` = artifact.`encounter_id`
        AND protocol_head.`current_signed_protocol_version_id` = artifact.`protocol_version_id`
      WHERE artifact.`organization_id` = NEW.`organization_id`
        AND artifact.`facility_id` = NEW.`facility_id`
        AND artifact.`encounter_id` = NEW.`encounter_id`
        AND artifact.`id` = NEW.`document_artifact_id`
        AND artifact.`kind` = NEW.`artifact_kind`
        AND artifact.`status` = 'ready'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'access audit resource must remain authorized');
END;--> statement-breakpoint
CREATE TRIGGER `access_audit_stream_heads_genesis_only`
BEFORE INSERT ON `access_audit_stream_heads`
WHEN NEW.`last_sequence` <> 0
  OR NEW.`last_event_hash` IS NOT NULL
  OR NEW.`lock_version` <> 1
BEGIN
  SELECT RAISE(ABORT, 'access audit stream head must start at genesis');
END;--> statement-breakpoint
CREATE TRIGGER `access_audit_stream_heads_advance_only`
BEFORE UPDATE ON `access_audit_stream_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`stream_key` IS NOT OLD.`stream_key`
  OR NEW.`actor_membership_id` IS NOT OLD.`actor_membership_id`
  OR NEW.`last_sequence` <> OLD.`last_sequence` + 1
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `access_audit_events` event
    WHERE event.`organization_id` = OLD.`organization_id`
      AND event.`facility_id` = OLD.`facility_id`
      AND event.`stream_key` = OLD.`stream_key`
      AND event.`actor_membership_id` = OLD.`actor_membership_id`
      AND event.`sequence` = NEW.`last_sequence`
      AND event.`event_hash` = NEW.`last_event_hash`
      AND event.`previous_hash` IS OLD.`last_event_hash`
  )
BEGIN
  SELECT RAISE(ABORT, 'access audit stream head must advance by one event');
END;--> statement-breakpoint
CREATE TRIGGER `access_audit_stream_heads_no_delete`
BEFORE DELETE ON `access_audit_stream_heads`
BEGIN
  SELECT RAISE(ABORT, 'access audit stream heads cannot be deleted');
END;
