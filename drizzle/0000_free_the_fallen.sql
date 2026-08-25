CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text,
	`actor_user_id` text NOT NULL,
	`event_type` text NOT NULL,
	`metadata_json` text DEFAULT '{}' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE set null
);
--> statement-breakpoint
CREATE INDEX `audit_events_encounter_created_idx` ON `audit_events` (`encounter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `audit_events_actor_created_idx` ON `audit_events` (`actor_user_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`status` text NOT NULL,
	`notice_version` text NOT NULL,
	`recorded_by_user_id` text NOT NULL,
	`recorded_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `consent_events_encounter_idx` ON `consent_events` (`encounter_id`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`clinician_user_id` text NOT NULL,
	`patient_reference` text,
	`mode` text DEFAULT 'in_person' NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`language_mode` text DEFAULT 'ru_kk' NOT NULL,
	`consent_status` text DEFAULT 'not_recorded' NOT NULL,
	`consent_recorded_at` integer,
	`audio_retention` text DEFAULT 'none' NOT NULL,
	`transcription_provider` text,
	`transcription_region` text,
	`started_at` integer,
	`ended_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL
);
--> statement-breakpoint
CREATE INDEX `encounters_clinician_created_idx` ON `encounters` (`clinician_user_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `encounters_status_idx` ON `encounters` (`status`);--> statement-breakpoint
CREATE TABLE `protocols` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_json` text NOT NULL,
	`source_review_ids_json` text DEFAULT '[]' NOT NULL,
	`generated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`finalized_at` integer,
	`finalized_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `protocols_encounter_version_uidx` ON `protocols` (`encounter_id`,`version`);--> statement-breakpoint
CREATE TABLE `speaker_mappings` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`provider_speaker` text NOT NULL,
	`role` text DEFAULT 'unknown' NOT NULL,
	`method` text DEFAULT 'unassigned' NOT NULL,
	`confirmed_by_user_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE UNIQUE INDEX `speaker_mappings_encounter_provider_uidx` ON `speaker_mappings` (`encounter_id`,`provider_speaker`);--> statement-breakpoint
CREATE TABLE `suggestion_reviews` (
	`id` text PRIMARY KEY NOT NULL,
	`suggestion_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`action` text NOT NULL,
	`original_content` text NOT NULL,
	`final_content` text,
	`reason` text,
	`clinician_user_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`suggestion_id`) REFERENCES `suggestions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suggestion_reviews_suggestion_idx` ON `suggestion_reviews` (`suggestion_id`);--> statement-breakpoint
CREATE INDEX `suggestion_reviews_encounter_idx` ON `suggestion_reviews` (`encounter_id`);--> statement-breakpoint
CREATE TABLE `suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`rationale` text,
	`priority` text DEFAULT 'routine' NOT NULL,
	`review_state` text DEFAULT 'pending' NOT NULL,
	`source_segment_ids_json` text DEFAULT '[]' NOT NULL,
	`model_provider` text NOT NULL,
	`model_name` text NOT NULL,
	`model_version` text,
	`reviewed_by_user_id` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `suggestions_encounter_state_idx` ON `suggestions` (`encounter_id`,`review_state`);--> statement-breakpoint
CREATE INDEX `suggestions_encounter_priority_idx` ON `suggestions` (`encounter_id`,`priority`);--> statement-breakpoint
CREATE TABLE `transcript_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`encounter_id` text NOT NULL,
	`provider_segment_id` text,
	`provider_speaker` text,
	`speaker_role` text DEFAULT 'unknown' NOT NULL,
	`language_code` text DEFAULT 'unknown' NOT NULL,
	`content` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`ended_at_ms` integer NOT NULL,
	`confidence` real,
	`is_final` integer DEFAULT false NOT NULL,
	`clinician_verified` integer DEFAULT false NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `transcript_segments_encounter_time_idx` ON `transcript_segments` (`encounter_id`,`started_at_ms`);--> statement-breakpoint
CREATE INDEX `transcript_segments_encounter_final_idx` ON `transcript_segments` (`encounter_id`,`is_final`);