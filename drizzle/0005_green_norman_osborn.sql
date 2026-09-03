CREATE TABLE `consent_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`consent_type` text NOT NULL,
	`current_consent_event_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_consent_event_id`) REFERENCES `consent_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`,`encounter_id`,`consent_type`,`current_consent_event_id`) REFERENCES `consent_events`(`organization_id`,`facility_id`,`patient_id`,`encounter_id`,`consent_type`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "consent_heads_type_enum" CHECK("consent_heads"."consent_type" in ('care', 'transient_audio_processing', 'audio_retention', 'transcript_storage', 'external_ai_processing', 'data_exchange', 'notifications')),
	CONSTRAINT "consent_heads_lock_positive" CHECK("consent_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consent_heads_scope_subject_type_uidx` ON `consent_heads` (`organization_id`,`facility_id`,`patient_id`,`encounter_id`,`consent_type`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_heads_scope_id_uidx` ON `consent_heads` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`encounter_id` text,
	`version` integer DEFAULT 1 NOT NULL,
	`consent_type` text NOT NULL,
	`decision` text NOT NULL,
	`captured_by_membership_id` text NOT NULL,
	`policy_version` text NOT NULL,
	`policy_hash` text NOT NULL,
	`notice_language` text NOT NULL,
	`external_processor` text,
	`evidence_object_key` text,
	`source` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`effective_at` integer NOT NULL,
	`expires_at` integer,
	`supersedes_consent_event_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`captured_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_consent_event_id`) REFERENCES `consent_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`captured_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "consent_withdrawal_has_source" CHECK("__new_consent_events"."decision" <> 'withdrawn' or "__new_consent_events"."supersedes_consent_event_id" is not null),
	CONSTRAINT "consent_expiry_valid" CHECK("__new_consent_events"."expires_at" is null or "__new_consent_events"."expires_at" > "__new_consent_events"."effective_at"),
	CONSTRAINT "consent_version_positive" CHECK("__new_consent_events"."version" > 0),
	CONSTRAINT "consent_type_enum" CHECK("__new_consent_events"."consent_type" in ('care', 'transient_audio_processing', 'audio_retention', 'transcript_storage', 'external_ai_processing', 'data_exchange', 'notifications')),
	CONSTRAINT "consent_decision_enum" CHECK("__new_consent_events"."decision" in ('granted', 'denied', 'withdrawn')),
	CONSTRAINT "consent_notice_language_enum" CHECK("__new_consent_events"."notice_language" in ('ru', 'kk')),
	CONSTRAINT "consent_source_enum" CHECK("__new_consent_events"."source" in ('written', 'verbal', 'digital'))
);
--> statement-breakpoint
INSERT INTO `__new_consent_events`("id", "organization_id", "facility_id", "patient_id", "encounter_id", "version", "consent_type", "decision", "captured_by_membership_id", "policy_version", "policy_hash", "notice_language", "external_processor", "evidence_object_key", "source", "occurred_at", "effective_at", "expires_at", "supersedes_consent_event_id", "created_at") SELECT "id", "organization_id", "facility_id", "patient_id", "encounter_id", 1, "consent_type", "decision", "captured_by_membership_id", "policy_version", "policy_hash", "notice_language", "external_processor", "evidence_object_key", "source", "occurred_at", "effective_at", "expires_at", "supersedes_consent_event_id", "created_at" FROM `consent_events`;--> statement-breakpoint
DROP TABLE `consent_events`;--> statement-breakpoint
ALTER TABLE `__new_consent_events` RENAME TO `consent_events`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE INDEX `consent_patient_type_time_idx` ON `consent_events` (`patient_id`,`consent_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `consent_encounter_idx` ON `consent_events` (`encounter_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_scope_id_uidx` ON `consent_events` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_scope_subject_id_uidx` ON `consent_events` (`organization_id`,`facility_id`,`patient_id`,`consent_type`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_scope_encounter_version_uidx` ON `consent_events` (`organization_id`,`facility_id`,`patient_id`,`encounter_id`,`consent_type`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_scope_encounter_event_uidx` ON `consent_events` (`organization_id`,`facility_id`,`patient_id`,`encounter_id`,`consent_type`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_supersedes_once_uidx` ON `consent_events` (`supersedes_consent_event_id`);
--> statement-breakpoint
CREATE TRIGGER `consent_events_no_update`
BEFORE UPDATE ON `consent_events`
BEGIN
  SELECT RAISE(ABORT, 'consent events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `consent_events_no_delete`
BEFORE DELETE ON `consent_events`
BEGIN
  SELECT RAISE(ABORT, 'consent events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `consent_events_supersedes_same_subject`
BEFORE INSERT ON `consent_events`
WHEN NEW.`supersedes_consent_event_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `consent_events` parent
    WHERE parent.`id` = NEW.`supersedes_consent_event_id`
      AND parent.`organization_id` = NEW.`organization_id`
      AND parent.`facility_id` = NEW.`facility_id`
      AND parent.`patient_id` = NEW.`patient_id`
      AND parent.`encounter_id` = NEW.`encounter_id`
      AND parent.`consent_type` = NEW.`consent_type`
      AND parent.`version` + 1 = NEW.`version`
  )
BEGIN
  SELECT RAISE(ABORT, 'consent predecessor must be the immediate same subject version');
END;
--> statement-breakpoint
CREATE TRIGGER `consent_heads_current_matches_insert`
BEFORE INSERT ON `consent_heads`
WHEN NOT EXISTS (
  SELECT 1 FROM `consent_events` event
  WHERE event.`organization_id` = NEW.`organization_id`
    AND event.`facility_id` = NEW.`facility_id`
    AND event.`patient_id` = NEW.`patient_id`
    AND event.`encounter_id` = NEW.`encounter_id`
    AND event.`consent_type` = NEW.`consent_type`
    AND event.`id` = NEW.`current_consent_event_id`
    AND event.`version` = NEW.`lock_version`
)
BEGIN
  SELECT RAISE(ABORT, 'consent head must match its current event and version');
END;
--> statement-breakpoint
CREATE TRIGGER `consent_heads_advance_only`
BEFORE UPDATE ON `consent_heads`
WHEN NOT (
  NEW.`id` = OLD.`id`
  AND NEW.`organization_id` = OLD.`organization_id`
  AND NEW.`facility_id` = OLD.`facility_id`
  AND NEW.`patient_id` = OLD.`patient_id`
  AND NEW.`encounter_id` = OLD.`encounter_id`
  AND NEW.`consent_type` = OLD.`consent_type`
  AND NEW.`created_at` = OLD.`created_at`
  AND NEW.`lock_version` = OLD.`lock_version` + 1
  AND NEW.`current_consent_event_id` <> OLD.`current_consent_event_id`
  AND NEW.`updated_at` >= OLD.`updated_at`
  AND EXISTS (
    SELECT 1 FROM `consent_events` event
    WHERE event.`organization_id` = OLD.`organization_id`
      AND event.`facility_id` = OLD.`facility_id`
      AND event.`patient_id` = OLD.`patient_id`
      AND event.`encounter_id` = OLD.`encounter_id`
      AND event.`consent_type` = OLD.`consent_type`
      AND event.`id` = NEW.`current_consent_event_id`
      AND event.`supersedes_consent_event_id` = OLD.`current_consent_event_id`
      AND event.`version` = NEW.`lock_version`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'consent head must advance by one immutable event');
END;
--> statement-breakpoint
CREATE TRIGGER `consent_heads_no_delete`
BEFORE DELETE ON `consent_heads`
BEGIN
  SELECT RAISE(ABORT, 'consent heads cannot be deleted');
END;
