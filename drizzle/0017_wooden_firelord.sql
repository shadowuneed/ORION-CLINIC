CREATE TABLE `diagnostic_report_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`service_request_id` text NOT NULL,
	`diagnostic_report_id` text NOT NULL,
	`object_key` text NOT NULL,
	`file_name` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`source` text DEFAULT 'manual_upload' NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnostic_report_id`) REFERENCES `diagnostic_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`) REFERENCES `service_requests`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`,`diagnostic_report_id`) REFERENCES `diagnostic_reports`(`organization_id`,`facility_id`,`service_request_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "diagnostic_report_artifacts_mime_enum" CHECK("diagnostic_report_artifacts"."mime_type" in ('application/pdf', 'image/jpeg', 'image/png')),
	CONSTRAINT "diagnostic_report_artifacts_source_enum" CHECK("diagnostic_report_artifacts"."source" in ('manual_upload')),
	CONSTRAINT "diagnostic_report_artifacts_sha256_length" CHECK(length("diagnostic_report_artifacts"."sha256") = 64),
	CONSTRAINT "diagnostic_report_artifacts_size_positive" CHECK("diagnostic_report_artifacts"."byte_size" > 0),
	CONSTRAINT "diagnostic_report_artifacts_file_name_length" CHECK(length(trim("diagnostic_report_artifacts"."file_name")) between 1 and 180)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_report_artifacts_scope_object_uidx` ON `diagnostic_report_artifacts` (`organization_id`,`facility_id`,`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_report_artifacts_scope_report_id_uidx` ON `diagnostic_report_artifacts` (`organization_id`,`facility_id`,`diagnostic_report_id`,`id`);--> statement-breakpoint
CREATE INDEX `diagnostic_report_artifacts_request_idx` ON `diagnostic_report_artifacts` (`organization_id`,`facility_id`,`service_request_id`);--> statement-breakpoint
CREATE TABLE `diagnostic_report_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`service_request_id` text NOT NULL,
	`diagnostic_report_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnostic_report_id`) REFERENCES `diagnostic_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `diagnostic_report_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`,`diagnostic_report_id`) REFERENCES `diagnostic_reports`(`organization_id`,`facility_id`,`service_request_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`diagnostic_report_id`,`current_version_id`) REFERENCES `diagnostic_report_versions`(`organization_id`,`facility_id`,`diagnostic_report_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "diagnostic_report_heads_lock_positive" CHECK("diagnostic_report_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_report_heads_scope_report_uidx` ON `diagnostic_report_heads` (`organization_id`,`facility_id`,`diagnostic_report_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_report_heads_scope_request_uidx` ON `diagnostic_report_heads` (`organization_id`,`facility_id`,`service_request_id`);--> statement-breakpoint
CREATE TABLE `diagnostic_report_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`service_request_id` text NOT NULL,
	`diagnostic_report_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`report_status` text NOT NULL,
	`conclusion` text,
	`artifact_id` text,
	`review_state` text DEFAULT 'pending' NOT NULL,
	`reconciliation_note` text,
	`change_reason` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`reviewed_by_membership_id` text,
	`reviewed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`diagnostic_report_id`) REFERENCES `diagnostic_reports`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `diagnostic_report_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`artifact_id`) REFERENCES `diagnostic_report_artifacts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`,`diagnostic_report_id`) REFERENCES `diagnostic_reports`(`organization_id`,`facility_id`,`service_request_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`diagnostic_report_id`,`artifact_id`) REFERENCES `diagnostic_report_artifacts`(`organization_id`,`facility_id`,`diagnostic_report_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`reviewed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "diagnostic_report_versions_status_enum" CHECK("diagnostic_report_versions"."report_status" in ('registered', 'preliminary', 'final', 'amended', 'corrected', 'cancelled', 'entered_in_error')),
	CONSTRAINT "diagnostic_report_versions_review_enum" CHECK("diagnostic_report_versions"."review_state" in ('pending', 'reviewed', 'needs_reconciliation')),
	CONSTRAINT "diagnostic_report_versions_version_positive" CHECK("diagnostic_report_versions"."version" > 0),
	CONSTRAINT "diagnostic_report_versions_initial_predecessor" CHECK(("diagnostic_report_versions"."version" = 1 and "diagnostic_report_versions"."supersedes_version_id" is null) or ("diagnostic_report_versions"."version" > 1 and "diagnostic_report_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "diagnostic_report_versions_review_consistent" CHECK(("diagnostic_report_versions"."review_state" = 'pending' and "diagnostic_report_versions"."reviewed_by_membership_id" is null and "diagnostic_report_versions"."reviewed_at" is null) or ("diagnostic_report_versions"."review_state" <> 'pending' and "diagnostic_report_versions"."reviewed_by_membership_id" is not null and "diagnostic_report_versions"."reviewed_at" is not null)),
	CONSTRAINT "diagnostic_report_versions_reconciliation_note" CHECK("diagnostic_report_versions"."review_state" <> 'needs_reconciliation' or length(trim("diagnostic_report_versions"."reconciliation_note")) between 3 and 1000),
	CONSTRAINT "diagnostic_report_versions_change_reason" CHECK(length(trim("diagnostic_report_versions"."change_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_report_versions_scope_report_version_uidx` ON `diagnostic_report_versions` (`organization_id`,`facility_id`,`diagnostic_report_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_report_versions_scope_report_id_uidx` ON `diagnostic_report_versions` (`organization_id`,`facility_id`,`diagnostic_report_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_report_versions_supersedes_once_uidx` ON `diagnostic_report_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE TABLE `diagnostic_reports` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`service_request_id` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`) REFERENCES `service_requests`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_reports_scope_request_uidx` ON `diagnostic_reports` (`organization_id`,`facility_id`,`service_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_reports_scope_id_uidx` ON `diagnostic_reports` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `diagnostic_reports_scope_request_id_uidx` ON `diagnostic_reports` (`organization_id`,`facility_id`,`service_request_id`,`id`);--> statement-breakpoint
CREATE TABLE `service_request_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`service_request_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `service_request_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`) REFERENCES `service_requests`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`,`current_version_id`) REFERENCES `service_request_versions`(`organization_id`,`facility_id`,`service_request_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_request_heads_lock_positive" CHECK("service_request_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_request_heads_scope_request_uidx` ON `service_request_heads` (`organization_id`,`facility_id`,`service_request_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_request_heads_scope_id_uidx` ON `service_request_heads` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE TABLE `service_request_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`service_request_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`status` text NOT NULL,
	`priority` text NOT NULL,
	`requested_service` text NOT NULL,
	`target_specialty` text,
	`medical_justification` text NOT NULL,
	`clinician_note` text,
	`status_reason` text,
	`authored_by_membership_id` text NOT NULL,
	`approved_by_membership_id` text,
	`approved_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`service_request_id`) REFERENCES `service_requests`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `service_request_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authored_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_request_id`) REFERENCES `service_requests`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`authored_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`approved_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_request_versions_status_enum" CHECK("service_request_versions"."status" in ('draft', 'active', 'on_hold', 'revoked', 'completed', 'entered_in_error')),
	CONSTRAINT "service_request_versions_priority_enum" CHECK("service_request_versions"."priority" in ('routine', 'urgent', 'asap', 'stat')),
	CONSTRAINT "service_request_versions_version_positive" CHECK("service_request_versions"."version" > 0),
	CONSTRAINT "service_request_versions_initial_predecessor" CHECK(("service_request_versions"."version" = 1 and "service_request_versions"."supersedes_version_id" is null) or ("service_request_versions"."version" > 1 and "service_request_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "service_request_versions_service_length" CHECK(length(trim("service_request_versions"."requested_service")) between 2 and 300),
	CONSTRAINT "service_request_versions_justification_length" CHECK(length(trim("service_request_versions"."medical_justification")) between 10 and 2000),
	CONSTRAINT "service_request_versions_draft_not_approved" CHECK("service_request_versions"."status" <> 'draft' or ("service_request_versions"."approved_by_membership_id" is null and "service_request_versions"."approved_at" is null)),
	CONSTRAINT "service_request_versions_active_approved" CHECK("service_request_versions"."status" not in ('active', 'on_hold', 'completed') or ("service_request_versions"."approved_by_membership_id" is not null and "service_request_versions"."approved_at" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `service_request_versions_scope_request_version_uidx` ON `service_request_versions` (`organization_id`,`facility_id`,`service_request_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_request_versions_scope_request_id_uidx` ON `service_request_versions` (`organization_id`,`facility_id`,`service_request_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_request_versions_supersedes_once_uidx` ON `service_request_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE TABLE `service_requests` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`request_kind` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "service_requests_kind_enum" CHECK("service_requests"."request_kind" in ('laboratory', 'ecg', 'service', 'referral'))
);
--> statement-breakpoint
CREATE INDEX `service_requests_encounter_idx` ON `service_requests` (`organization_id`,`facility_id`,`encounter_id`);--> statement-breakpoint
CREATE INDEX `service_requests_patient_idx` ON `service_requests` (`organization_id`,`facility_id`,`patient_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `service_requests_scope_id_uidx` ON `service_requests` (`organization_id`,`facility_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER `service_requests_no_update`
BEFORE UPDATE ON `service_requests`
BEGIN
  SELECT RAISE(ABORT, 'service requests are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `service_requests_no_delete`
BEFORE DELETE ON `service_requests`
BEGIN
  SELECT RAISE(ABORT, 'service requests cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `service_request_versions_extend_current_head`
BEFORE INSERT ON `service_request_versions`
WHEN
  (NEW.`version` = 1 AND (
    NEW.`status` <> 'draft'
    OR EXISTS (
      SELECT 1 FROM `service_request_heads` head
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`service_request_id` = NEW.`service_request_id`
    )
  ))
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `service_request_heads` head
      JOIN `service_request_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`service_request_id` = head.`service_request_id`
        AND previous.`id` = head.`current_version_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`service_request_id` = NEW.`service_request_id`
        AND head.`current_version_id` = NEW.`supersedes_version_id`
        AND head.`lock_version` = NEW.`version` - 1
        AND (
          (previous.`status` = 'draft' AND NEW.`status` IN ('active', 'revoked', 'entered_in_error'))
          OR (previous.`status` = 'active' AND NEW.`status` IN ('on_hold', 'revoked', 'completed', 'entered_in_error'))
          OR (previous.`status` = 'on_hold' AND NEW.`status` IN ('active', 'revoked', 'entered_in_error'))
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'service request version must extend the current head with a valid transition');
END;
--> statement-breakpoint
CREATE TRIGGER `service_request_versions_no_update`
BEFORE UPDATE ON `service_request_versions`
BEGIN
  SELECT RAISE(ABORT, 'service request versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `service_request_versions_no_delete`
BEFORE DELETE ON `service_request_versions`
BEGIN
  SELECT RAISE(ABORT, 'service request versions cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `service_request_heads_initial_version_only`
BEFORE INSERT ON `service_request_heads`
WHEN NEW.`lock_version` <> 1
  OR NOT EXISTS (
    SELECT 1 FROM `service_request_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`service_request_id` = NEW.`service_request_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`version` = 1
      AND version.`status` = 'draft'
      AND version.`supersedes_version_id` IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'service request head must start at draft version one');
END;
--> statement-breakpoint
CREATE TRIGGER `service_request_heads_advance_only`
BEFORE UPDATE ON `service_request_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`service_request_id` IS NOT OLD.`service_request_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`updated_at` < OLD.`updated_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `service_request_versions` version
    WHERE version.`organization_id` = OLD.`organization_id`
      AND version.`facility_id` = OLD.`facility_id`
      AND version.`service_request_id` = OLD.`service_request_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'service request head must advance by one immutable version');
END;
--> statement-breakpoint
CREATE TRIGGER `service_request_heads_no_delete`
BEFORE DELETE ON `service_request_heads`
BEGIN
  SELECT RAISE(ABORT, 'service request heads cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_reports_no_update`
BEFORE UPDATE ON `diagnostic_reports`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic reports are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_reports_no_delete`
BEFORE DELETE ON `diagnostic_reports`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic reports cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_artifacts_no_update`
BEFORE UPDATE ON `diagnostic_report_artifacts`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report artifacts are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_artifacts_no_delete`
BEFORE DELETE ON `diagnostic_report_artifacts`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report artifacts cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_versions_extend_current_head`
BEFORE INSERT ON `diagnostic_report_versions`
WHEN
  (NEW.`version` = 1 AND EXISTS (
    SELECT 1 FROM `diagnostic_report_heads` head
    WHERE head.`organization_id` = NEW.`organization_id`
      AND head.`facility_id` = NEW.`facility_id`
      AND head.`diagnostic_report_id` = NEW.`diagnostic_report_id`
  ))
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `diagnostic_report_heads` head
      JOIN `diagnostic_report_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`diagnostic_report_id` = head.`diagnostic_report_id`
        AND previous.`id` = head.`current_version_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`diagnostic_report_id` = NEW.`diagnostic_report_id`
        AND head.`current_version_id` = NEW.`supersedes_version_id`
        AND head.`lock_version` = NEW.`version` - 1
        AND (
          previous.`report_status` = NEW.`report_status`
          OR (previous.`report_status` = 'registered' AND NEW.`report_status` IN ('preliminary', 'final', 'cancelled', 'entered_in_error'))
          OR (previous.`report_status` = 'preliminary' AND NEW.`report_status` IN ('final', 'corrected', 'cancelled', 'entered_in_error'))
          OR (previous.`report_status` IN ('final', 'amended', 'corrected') AND NEW.`report_status` IN ('amended', 'corrected', 'cancelled', 'entered_in_error'))
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report version must extend the current head with a valid transition');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_versions_no_update`
BEFORE UPDATE ON `diagnostic_report_versions`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_versions_no_delete`
BEFORE DELETE ON `diagnostic_report_versions`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report versions cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_heads_initial_version_only`
BEFORE INSERT ON `diagnostic_report_heads`
WHEN NEW.`lock_version` <> 1
  OR NOT EXISTS (
    SELECT 1 FROM `diagnostic_report_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`service_request_id` = NEW.`service_request_id`
      AND version.`diagnostic_report_id` = NEW.`diagnostic_report_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`version` = 1
      AND version.`supersedes_version_id` IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report head must start at version one');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_heads_advance_only`
BEFORE UPDATE ON `diagnostic_report_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`service_request_id` IS NOT OLD.`service_request_id`
  OR NEW.`diagnostic_report_id` IS NOT OLD.`diagnostic_report_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`updated_at` < OLD.`updated_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `diagnostic_report_versions` version
    WHERE version.`organization_id` = OLD.`organization_id`
      AND version.`facility_id` = OLD.`facility_id`
      AND version.`service_request_id` = OLD.`service_request_id`
      AND version.`diagnostic_report_id` = OLD.`diagnostic_report_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report head must advance by one immutable version');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_heads_no_delete`
BEFORE DELETE ON `diagnostic_report_heads`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report heads cannot be deleted');
END;
