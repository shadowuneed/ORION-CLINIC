PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE UNIQUE INDEX `audit_scope_sequence_hash_uidx` ON `audit_events` (`organization_id`,`facility_id`,`sequence`,`event_hash`);--> statement-breakpoint
CREATE TABLE `__new_audit_stream_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`last_event_hash` text,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`last_sequence`,`last_event_hash`) REFERENCES `audit_events`(`organization_id`,`facility_id`,`sequence`,`event_hash`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_stream_heads_sequence_nonnegative" CHECK("__new_audit_stream_heads"."last_sequence" >= 0),
	CONSTRAINT "audit_stream_heads_lock_positive" CHECK("__new_audit_stream_heads"."lock_version" > 0),
	CONSTRAINT "audit_stream_heads_genesis_consistent" CHECK(("__new_audit_stream_heads"."last_sequence" = 0 and "__new_audit_stream_heads"."last_event_hash" is null) or ("__new_audit_stream_heads"."last_sequence" > 0 and "__new_audit_stream_heads"."last_event_hash" is not null))
);
--> statement-breakpoint
INSERT INTO `__new_audit_stream_heads`("id", "organization_id", "facility_id", "last_sequence", "last_event_hash", "lock_version", "updated_at") SELECT "id", "organization_id", "facility_id", "last_sequence", "last_event_hash", "lock_version", "updated_at" FROM `audit_stream_heads`;--> statement-breakpoint
DROP TABLE `audit_stream_heads`;--> statement-breakpoint
ALTER TABLE `__new_audit_stream_heads` RENAME TO `audit_stream_heads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `audit_stream_heads_scope_uidx` ON `audit_stream_heads` (`organization_id`,`facility_id`);--> statement-breakpoint
CREATE TABLE `__new_suggestion_review_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`state` text DEFAULT 'proposed' NOT NULL,
	`current_decision_id` text,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `clinical_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_decision_id`) REFERENCES `review_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`) REFERENCES `clinical_suggestions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`current_decision_id`) REFERENCES `review_decisions`(`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suggestion_review_heads_lock_positive" CHECK("__new_suggestion_review_heads"."lock_version" > 0),
	CONSTRAINT "suggestion_review_heads_decision_consistency" CHECK(("__new_suggestion_review_heads"."state" in ('proposed', 'expired') and "__new_suggestion_review_heads"."current_decision_id" is null) or ("__new_suggestion_review_heads"."state" not in ('proposed', 'expired') and "__new_suggestion_review_heads"."current_decision_id" is not null)),
	CONSTRAINT "suggestion_review_heads_state_enum" CHECK("__new_suggestion_review_heads"."state" in ('proposed', 'accepted', 'edited_and_accepted', 'rejected', 'expired'))
);
--> statement-breakpoint
INSERT INTO `__new_suggestion_review_heads`("id", "organization_id", "facility_id", "encounter_id", "suggestion_id", "state", "current_decision_id", "lock_version", "updated_at") SELECT "id", "organization_id", "facility_id", "encounter_id", "suggestion_id", "state", "current_decision_id", "lock_version", "updated_at" FROM `suggestion_review_heads`;--> statement-breakpoint
DROP TABLE `suggestion_review_heads`;--> statement-breakpoint
ALTER TABLE `__new_suggestion_review_heads` RENAME TO `suggestion_review_heads`;--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_review_heads_scope_suggestion_uidx` ON `suggestion_review_heads` (`organization_id`,`facility_id`,`suggestion_id`);
