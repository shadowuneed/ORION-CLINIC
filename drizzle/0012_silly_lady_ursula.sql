CREATE TABLE `transcription_results` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`transcription_run_id` text NOT NULL,
	`transcript_segment_id` text NOT NULL,
	`utterance_index` integer NOT NULL,
	`input_hash` text NOT NULL,
	`response_hash` text NOT NULL,
	`consent_event_ids_json` text NOT NULL,
	`duration_ms` integer NOT NULL,
	`processing_ms` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transcription_run_id`) REFERENCES `transcription_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`transcript_segment_id`) REFERENCES `transcript_segments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`transcription_run_id`) REFERENCES `transcription_runs`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`transcript_segment_id`) REFERENCES `transcript_segments`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transcription_results_utterance_nonnegative" CHECK("transcription_results"."utterance_index" >= 0),
	CONSTRAINT "transcription_results_hashes_valid" CHECK(length("transcription_results"."input_hash") = 64 and length("transcription_results"."response_hash") = 64),
	CONSTRAINT "transcription_results_timing_valid" CHECK("transcription_results"."duration_ms" >= 0 and "transcription_results"."processing_ms" >= 0),
	CONSTRAINT "transcription_results_consent_events_json" CHECK(json_valid("transcription_results"."consent_event_ids_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcription_results_run_utterance_uidx` ON `transcription_results` (`transcription_run_id`,`utterance_index`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcription_results_scope_id_uidx` ON `transcription_results` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE TABLE `transcription_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`upstream_session_id` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`model_version` text NOT NULL,
	`policy_version` text NOT NULL,
	`consent_event_ids_json` text NOT NULL,
	`status` text DEFAULT 'running' NOT NULL,
	`next_utterance_index` integer DEFAULT 0 NOT NULL,
	`started_by_membership_id` text NOT NULL,
	`request_id` text NOT NULL,
	`error_code` text,
	`started_at` integer NOT NULL,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`started_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`started_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transcription_runs_status_enum" CHECK("transcription_runs"."status" in ('running', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "transcription_runs_consent_events_json" CHECK(json_valid("transcription_runs"."consent_event_ids_json")),
	CONSTRAINT "transcription_runs_next_utterance_nonnegative" CHECK("transcription_runs"."next_utterance_index" >= 0),
	CONSTRAINT "transcription_runs_completion_valid" CHECK("transcription_runs"."completed_at" is null or "transcription_runs"."completed_at" >= "transcription_runs"."started_at")
);
--> statement-breakpoint
CREATE INDEX `transcription_runs_encounter_status_idx` ON `transcription_runs` (`encounter_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcription_runs_scope_id_uidx` ON `transcription_runs` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcription_runs_scope_encounter_id_uidx` ON `transcription_runs` (`organization_id`,`facility_id`,`encounter_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcription_runs_scope_upstream_uidx` ON `transcription_runs` (`organization_id`,`facility_id`,`upstream_session_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_scope_encounter_id_uidx` ON `transcript_segments` (`organization_id`,`facility_id`,`encounter_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER `transcription_results_no_update`
BEFORE UPDATE ON `transcription_results`
BEGIN
  SELECT RAISE(ABORT, 'transcription results are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `transcription_results_no_delete`
BEFORE DELETE ON `transcription_results`
BEGIN
  SELECT RAISE(ABORT, 'transcription results are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `transcription_results_extend_running_session`
BEFORE INSERT ON `transcription_results`
WHEN NOT EXISTS (
  SELECT 1 FROM `transcription_runs` run
  WHERE run.`organization_id` = NEW.`organization_id`
    AND run.`facility_id` = NEW.`facility_id`
    AND run.`encounter_id` = NEW.`encounter_id`
    AND run.`id` = NEW.`transcription_run_id`
    AND run.`status` = 'running'
    AND run.`next_utterance_index` = NEW.`utterance_index`
)
BEGIN
  SELECT RAISE(ABORT, 'transcription result must extend a running session');
END;
--> statement-breakpoint
CREATE TRIGGER `transcription_runs_guard_update`
BEFORE UPDATE ON `transcription_runs`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`encounter_id` IS NOT OLD.`encounter_id`
  OR NEW.`upstream_session_id` IS NOT OLD.`upstream_session_id`
  OR NEW.`provider` IS NOT OLD.`provider`
  OR NEW.`model` IS NOT OLD.`model`
  OR NEW.`model_version` IS NOT OLD.`model_version`
  OR NEW.`policy_version` IS NOT OLD.`policy_version`
  OR NEW.`consent_event_ids_json` IS NOT OLD.`consent_event_ids_json`
  OR NEW.`started_by_membership_id` IS NOT OLD.`started_by_membership_id`
  OR NEW.`request_id` IS NOT OLD.`request_id`
  OR NEW.`started_at` IS NOT OLD.`started_at`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR OLD.`status` <> 'running'
  OR (
    NEW.`status` = 'running'
    AND (
      NEW.`next_utterance_index` <> OLD.`next_utterance_index` + 1
      OR NEW.`completed_at` IS NOT NULL
      OR NEW.`error_code` IS NOT OLD.`error_code`
    )
  )
  OR (
    NEW.`status` IN ('completed', 'cancelled', 'failed')
    AND (
      NEW.`next_utterance_index` <> OLD.`next_utterance_index`
      OR NEW.`completed_at` IS NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid transcription run transition');
END;
--> statement-breakpoint
CREATE TRIGGER `transcription_runs_no_delete`
BEFORE DELETE ON `transcription_runs`
BEGIN
  SELECT RAISE(ABORT, 'transcription runs cannot be deleted');
END;
