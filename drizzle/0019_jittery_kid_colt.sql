CREATE TABLE `diagnostic_result_upload_intents` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`command_id` text NOT NULL,
	`service_request_id` text NOT NULL,
	`artifact_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'reserved' NOT NULL,
	`failure_code` text,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`command_id`) REFERENCES `command_idempotency`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`command_id`) REFERENCES `command_idempotency`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`) REFERENCES `service_requests`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "diagnostic_result_upload_intents_mime_enum" CHECK("diagnostic_result_upload_intents"."mime_type" in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "diagnostic_result_upload_intents_status_enum" CHECK("diagnostic_result_upload_intents"."status" in ('reserved', 'object_stored', 'committed', 'cleanup_pending', 'cleaned')),
	CONSTRAINT "diagnostic_result_upload_intents_sha256_length" CHECK(length("diagnostic_result_upload_intents"."sha256") = 64),
	CONSTRAINT "diagnostic_result_upload_intents_size_positive" CHECK("diagnostic_result_upload_intents"."byte_size" > 0),
	CONSTRAINT "diagnostic_result_upload_intents_file_name_length" CHECK(length(trim("diagnostic_result_upload_intents"."file_name")) between 1 and 180),
	CONSTRAINT "diagnostic_result_upload_intents_failure_consistent" CHECK(("diagnostic_result_upload_intents"."status" in ('cleanup_pending', 'cleaned') and "diagnostic_result_upload_intents"."failure_code" is not null) or ("diagnostic_result_upload_intents"."status" not in ('cleanup_pending', 'cleaned') and "diagnostic_result_upload_intents"."failure_code" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_result_upload_intents_scope_command_uidx` ON `diagnostic_result_upload_intents` (`organization_id`,`facility_id`,`command_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_result_upload_intents_scope_object_uidx` ON `diagnostic_result_upload_intents` (`organization_id`,`facility_id`,`object_key`);--> statement-breakpoint
CREATE INDEX `diagnostic_result_upload_intents_reconcile_idx` ON `diagnostic_result_upload_intents` (`organization_id`,`facility_id`,`status`,`updated_at`);
--> statement-breakpoint
CREATE TRIGGER `diagnostic_result_upload_intents_start_reserved`
BEFORE INSERT ON `diagnostic_result_upload_intents`
WHEN NEW.`status` <> 'reserved'
  OR NEW.`failure_code` IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM `command_idempotency` command
    WHERE command.`id` = NEW.`command_id`
      AND command.`organization_id` = NEW.`organization_id`
      AND command.`facility_id` = NEW.`facility_id`
      AND command.`actor_membership_id` = NEW.`created_by_membership_id`
      AND command.`operation` = 'order.result.attach'
      AND command.`status` = 'processing'
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic result upload intent must start reserved');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_result_upload_intents_transition_only`
BEFORE UPDATE ON `diagnostic_result_upload_intents`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`command_id` IS NOT OLD.`command_id`
  OR NEW.`service_request_id` IS NOT OLD.`service_request_id`
  OR NEW.`artifact_id` IS NOT OLD.`artifact_id`
  OR NEW.`object_key` IS NOT OLD.`object_key`
  OR NEW.`file_name` IS NOT OLD.`file_name`
  OR NEW.`mime_type` IS NOT OLD.`mime_type`
  OR NEW.`sha256` IS NOT OLD.`sha256`
  OR NEW.`byte_size` IS NOT OLD.`byte_size`
  OR NEW.`created_by_membership_id` IS NOT OLD.`created_by_membership_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`updated_at` < OLD.`updated_at`
  OR OLD.`status` IN ('committed', 'cleaned')
  OR NOT (
    (OLD.`status` = 'reserved' AND NEW.`status` IN ('object_stored', 'cleanup_pending'))
    OR (OLD.`status` = 'object_stored' AND NEW.`status` IN ('committed', 'cleanup_pending'))
    OR (OLD.`status` = 'cleanup_pending' AND NEW.`status` = 'cleaned')
  )
  OR (
    NEW.`status` = 'object_stored'
    AND NOT EXISTS (
      SELECT 1 FROM `command_idempotency` command
      WHERE command.`id` = NEW.`command_id`
        AND command.`organization_id` = NEW.`organization_id`
        AND command.`facility_id` = NEW.`facility_id`
        AND command.`status` = 'processing'
    )
  )
  OR (
    NEW.`status` = 'committed'
    AND (
      NOT EXISTS (
        SELECT 1 FROM `command_idempotency` command
        WHERE command.`id` = NEW.`command_id`
          AND command.`organization_id` = NEW.`organization_id`
          AND command.`facility_id` = NEW.`facility_id`
          AND command.`status` = 'succeeded'
          AND command.`result_resource_type` = 'service_request'
          AND command.`result_resource_id` = NEW.`service_request_id`
      )
      OR NOT EXISTS (
        SELECT 1 FROM `diagnostic_report_artifacts` artifact
        WHERE artifact.`id` = NEW.`artifact_id`
          AND artifact.`organization_id` = NEW.`organization_id`
          AND artifact.`facility_id` = NEW.`facility_id`
          AND artifact.`service_request_id` = NEW.`service_request_id`
          AND artifact.`object_key` = NEW.`object_key`
          AND artifact.`file_name` = NEW.`file_name`
          AND artifact.`mime_type` = NEW.`mime_type`
          AND artifact.`sha256` = NEW.`sha256`
          AND artifact.`byte_size` = NEW.`byte_size`
      )
    )
  )
  OR (
    NEW.`status` IN ('cleanup_pending', 'cleaned')
    AND (
      NOT EXISTS (
        SELECT 1 FROM `command_idempotency` command
        WHERE command.`id` = NEW.`command_id`
          AND command.`organization_id` = NEW.`organization_id`
          AND command.`facility_id` = NEW.`facility_id`
          AND command.`status` = 'failed'
      )
      OR EXISTS (
        SELECT 1 FROM `diagnostic_report_artifacts` artifact
        WHERE artifact.`organization_id` = NEW.`organization_id`
          AND artifact.`facility_id` = NEW.`facility_id`
          AND artifact.`id` = NEW.`artifact_id`
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic result upload intent transition is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_result_upload_intents_no_delete`
BEFORE DELETE ON `diagnostic_result_upload_intents`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic result upload intents cannot be deleted');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `diagnostic_report_versions_review_from_pending`;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_versions_review_from_pending`
BEFORE INSERT ON `diagnostic_report_versions`
WHEN NEW.`review_state` IN ('reviewed', 'needs_reconciliation')
  AND NOT EXISTS (
    SELECT 1
    FROM `diagnostic_report_versions` previous
    WHERE previous.`organization_id` = NEW.`organization_id`
      AND previous.`facility_id` = NEW.`facility_id`
      AND previous.`service_request_id` = NEW.`service_request_id`
      AND previous.`diagnostic_report_id` = NEW.`diagnostic_report_id`
      AND previous.`id` = NEW.`supersedes_version_id`
      AND previous.`review_state` = 'pending'
      AND previous.`report_status` IS NEW.`report_status`
      AND previous.`conclusion` IS NEW.`conclusion`
      AND previous.`artifact_id` IS NEW.`artifact_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report review must preserve the exact pending payload');
END;
