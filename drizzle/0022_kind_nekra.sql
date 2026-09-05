CREATE TABLE `communication_manual_task_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`task_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_task_event_id` text,
	`state` text NOT NULL,
	`assigned_membership_id` text NOT NULL,
	`due_at` integer NOT NULL,
	`failure_reason` text NOT NULL,
	`response_id` text,
	`outcome_summary` text,
	`changed_by_membership_id` text NOT NULL,
	`change_reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_task_event_id`) REFERENCES `communication_manual_task_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`response_id`) REFERENCES `communication_patient_responses`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`changed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`assigned_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "communication_manual_task_events_state_enum" CHECK("communication_manual_task_events"."state" in ('open', 'in_progress', 'completed', 'escalated', 'cancelled')),
	CONSTRAINT "communication_manual_task_events_version_positive" CHECK("communication_manual_task_events"."version" > 0),
	CONSTRAINT "communication_manual_task_events_predecessor" CHECK(("communication_manual_task_events"."version" = 1 and "communication_manual_task_events"."supersedes_task_event_id" is null) or ("communication_manual_task_events"."version" > 1 and "communication_manual_task_events"."supersedes_task_event_id" is not null)),
	CONSTRAINT "communication_manual_task_events_reason_length" CHECK(length(trim("communication_manual_task_events"."change_reason")) between 3 and 500),
	CONSTRAINT "communication_manual_task_events_failure_length" CHECK(length(trim("communication_manual_task_events"."failure_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_manual_task_events_scope_version_uidx` ON `communication_manual_task_events` (`organization_id`,`facility_id`,`task_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `communication_manual_task_events_scope_id_uidx` ON `communication_manual_task_events` (`organization_id`,`facility_id`,`task_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `communication_manual_task_events_notification_uidx` ON `communication_manual_task_events` (`organization_id`,`facility_id`,`notification_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `communication_manual_task_events_supersedes_once_uidx` ON `communication_manual_task_events` (`supersedes_task_event_id`);--> statement-breakpoint
CREATE TABLE `communication_manual_task_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`task_id` text NOT NULL,
	`current_event_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_event_id`) REFERENCES `communication_manual_task_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`task_id`,`current_event_id`) REFERENCES `communication_manual_task_events`(`organization_id`,`facility_id`,`task_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "communication_manual_task_heads_lock_positive" CHECK("communication_manual_task_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_manual_task_heads_scope_task_uidx` ON `communication_manual_task_heads` (`organization_id`,`facility_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `communication_patient_responses` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`manual_task_id` text NOT NULL,
	`response_kind` text NOT NULL,
	`language` text NOT NULL,
	`summary` text NOT NULL,
	`source` text NOT NULL,
	`recorded_by_membership_id` text NOT NULL,
	`received_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`recorded_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "communication_patient_responses_kind_enum" CHECK("communication_patient_responses"."response_kind" in ('confirmed', 'declined', 'question', 'callback_requested', 'other')),
	CONSTRAINT "communication_patient_responses_language_enum" CHECK("communication_patient_responses"."language" in ('ru', 'kk')),
	CONSTRAINT "communication_patient_responses_source_enum" CHECK("communication_patient_responses"."source" in ('staff_recorded')),
	CONSTRAINT "communication_patient_responses_summary_length" CHECK(length(trim("communication_patient_responses"."summary")) between 3 and 2000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_patient_responses_scope_id_uidx` ON `communication_patient_responses` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE INDEX `communication_patient_responses_notification_idx` ON `communication_patient_responses` (`organization_id`,`facility_id`,`notification_id`);--> statement-breakpoint
CREATE TABLE `communication_policy_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`policy_code` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`source_type` text NOT NULL,
	`quiet_start_minute` integer NOT NULL,
	`quiet_end_minute` integer NOT NULL,
	`max_attempts` integer NOT NULL,
	`retry_delay_minutes` integer NOT NULL,
	`protected_link_mode` text NOT NULL,
	`approved_by_membership_id` text NOT NULL,
	`approved_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`approved_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "communication_policy_versions_status_enum" CHECK("communication_policy_versions"."status" in ('active_test', 'retired')),
	CONSTRAINT "communication_policy_versions_source_enum" CHECK("communication_policy_versions"."source_type" in ('local_test')),
	CONSTRAINT "communication_policy_versions_link_mode_enum" CHECK("communication_policy_versions"."protected_link_mode" in ('disabled_minimum_content_only')),
	CONSTRAINT "communication_policy_versions_quiet_start_range" CHECK("communication_policy_versions"."quiet_start_minute" between 0 and 1439),
	CONSTRAINT "communication_policy_versions_quiet_end_range" CHECK("communication_policy_versions"."quiet_end_minute" between 0 and 1439),
	CONSTRAINT "communication_policy_versions_attempts_range" CHECK("communication_policy_versions"."max_attempts" between 1 and 10),
	CONSTRAINT "communication_policy_versions_retry_range" CHECK("communication_policy_versions"."retry_delay_minutes" between 1 and 1440),
	CONSTRAINT "communication_policy_versions_version_positive" CHECK("communication_policy_versions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_policy_versions_scope_version_uidx` ON `communication_policy_versions` (`organization_id`,`facility_id`,`policy_code`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `communication_policy_versions_scope_id_uidx` ON `communication_policy_versions` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE TABLE `communication_template_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`template_code` text NOT NULL,
	`version` integer NOT NULL,
	`status` text NOT NULL,
	`source_type` text NOT NULL,
	`purpose` text NOT NULL,
	`channel` text NOT NULL,
	`language` text NOT NULL,
	`body` text NOT NULL,
	`placeholders_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`minimum_content_only` integer DEFAULT true NOT NULL,
	`protected_link_required` integer DEFAULT false NOT NULL,
	`approved_by_membership_id` text NOT NULL,
	`approved_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`approved_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`approved_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "communication_template_versions_status_enum" CHECK("communication_template_versions"."status" in ('approved_test', 'retired')),
	CONSTRAINT "communication_template_versions_source_enum" CHECK("communication_template_versions"."source_type" in ('local_test')),
	CONSTRAINT "communication_template_versions_purpose_enum" CHECK("communication_template_versions"."purpose" in ('appointment_reminder', 'care_plan_reminder')),
	CONSTRAINT "communication_template_versions_channel_enum" CHECK("communication_template_versions"."channel" in ('whatsapp', 'telegram', 'sms', 'voice')),
	CONSTRAINT "communication_template_versions_language_enum" CHECK("communication_template_versions"."language" in ('ru', 'kk')),
	CONSTRAINT "communication_template_versions_placeholders_json" CHECK(json_valid("communication_template_versions"."placeholders_json")),
	CONSTRAINT "communication_template_versions_body_length" CHECK(length(trim("communication_template_versions"."body")) between 10 and 1000),
	CONSTRAINT "communication_template_versions_hash" CHECK(length("communication_template_versions"."content_hash") = 64 and lower("communication_template_versions"."content_hash") = "communication_template_versions"."content_hash"),
	CONSTRAINT "communication_template_versions_version_positive" CHECK("communication_template_versions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `communication_template_versions_scope_code_version_uidx` ON `communication_template_versions` (`organization_id`,`facility_id`,`template_code`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `communication_template_versions_scope_id_uidx` ON `communication_template_versions` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `communication_template_versions_scope_resolution_uidx` ON `communication_template_versions` (`organization_id`,`facility_id`,`purpose`,`channel`,`language`,`status`);--> statement-breakpoint
CREATE TABLE `notification_delivery_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`notification_event_id` text NOT NULL,
	`attempt_number` integer NOT NULL,
	`provider_adapter` text NOT NULL,
	`outcome` text NOT NULL,
	`error_code` text,
	`provider_message_id` text,
	`next_attempt_at` integer,
	`recorded_by_membership_id` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`notification_event_id`) REFERENCES `patient_notification_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`notification_id`,`notification_event_id`) REFERENCES `patient_notification_events`(`organization_id`,`facility_id`,`notification_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`recorded_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "notification_delivery_attempts_provider_enum" CHECK("notification_delivery_attempts"."provider_adapter" in ('disconnected')),
	CONSTRAINT "notification_delivery_attempts_outcome_enum" CHECK("notification_delivery_attempts"."outcome" in ('delivered', 'provider_unavailable', 'failed', 'unknown')),
	CONSTRAINT "notification_delivery_attempts_number_positive" CHECK("notification_delivery_attempts"."attempt_number" > 0),
	CONSTRAINT "notification_delivery_attempts_disconnected_never_delivered" CHECK("notification_delivery_attempts"."provider_adapter" <> 'disconnected' or "notification_delivery_attempts"."outcome" <> 'delivered')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `notification_delivery_attempts_scope_attempt_uidx` ON `notification_delivery_attempts` (`organization_id`,`facility_id`,`notification_id`,`attempt_number`);--> statement-breakpoint
CREATE TABLE `patient_channel_consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`channel` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_consent_event_id` text,
	`decision` text NOT NULL,
	`preferred_language` text NOT NULL,
	`destination_ref` text,
	`destination_hint` text,
	`destination_fingerprint` text,
	`destination_verified_at` integer,
	`notice_version` text NOT NULL,
	`notice_hash` text NOT NULL,
	`source` text NOT NULL,
	`effective_at` integer NOT NULL,
	`captured_by_membership_id` text NOT NULL,
	`change_reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_consent_event_id`) REFERENCES `patient_channel_consent_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`captured_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`captured_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_channel_consent_events_channel_enum" CHECK("patient_channel_consent_events"."channel" in ('whatsapp', 'telegram', 'sms', 'voice')),
	CONSTRAINT "patient_channel_consent_events_decision_enum" CHECK("patient_channel_consent_events"."decision" in ('granted', 'denied', 'withdrawn')),
	CONSTRAINT "patient_channel_consent_events_language_enum" CHECK("patient_channel_consent_events"."preferred_language" in ('ru', 'kk')),
	CONSTRAINT "patient_channel_consent_events_source_enum" CHECK("patient_channel_consent_events"."source" in ('written', 'verbal', 'digital')),
	CONSTRAINT "patient_channel_consent_events_version_positive" CHECK("patient_channel_consent_events"."version" > 0),
	CONSTRAINT "patient_channel_consent_events_predecessor" CHECK(("patient_channel_consent_events"."version" = 1 and "patient_channel_consent_events"."supersedes_consent_event_id" is null) or ("patient_channel_consent_events"."version" > 1 and "patient_channel_consent_events"."supersedes_consent_event_id" is not null)),
	CONSTRAINT "patient_channel_consent_events_destination_consistent" CHECK(("patient_channel_consent_events"."decision" = 'granted' and "patient_channel_consent_events"."destination_ref" is not null and "patient_channel_consent_events"."destination_hint" is not null and "patient_channel_consent_events"."destination_fingerprint" is not null and "patient_channel_consent_events"."destination_verified_at" is not null) or ("patient_channel_consent_events"."decision" <> 'granted' and "patient_channel_consent_events"."destination_ref" is null and "patient_channel_consent_events"."destination_hint" is null and "patient_channel_consent_events"."destination_fingerprint" is null and "patient_channel_consent_events"."destination_verified_at" is null)),
	CONSTRAINT "patient_channel_consent_events_notice_hash" CHECK(length("patient_channel_consent_events"."notice_hash") = 64 and lower("patient_channel_consent_events"."notice_hash") = "patient_channel_consent_events"."notice_hash"),
	CONSTRAINT "patient_channel_consent_events_destination_hash" CHECK("patient_channel_consent_events"."destination_fingerprint" is null or (length("patient_channel_consent_events"."destination_fingerprint") = 64 and lower("patient_channel_consent_events"."destination_fingerprint") = "patient_channel_consent_events"."destination_fingerprint")),
	CONSTRAINT "patient_channel_consent_events_reason_length" CHECK(length(trim("patient_channel_consent_events"."change_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_channel_consent_events_scope_version_uidx` ON `patient_channel_consent_events` (`organization_id`,`facility_id`,`patient_id`,`channel`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_channel_consent_events_scope_id_uidx` ON `patient_channel_consent_events` (`organization_id`,`facility_id`,`patient_id`,`channel`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_channel_consent_events_supersedes_once_uidx` ON `patient_channel_consent_events` (`supersedes_consent_event_id`);--> statement-breakpoint
CREATE TABLE `patient_channel_consent_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`channel` text NOT NULL,
	`current_consent_event_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_consent_event_id`) REFERENCES `patient_channel_consent_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`,`channel`,`current_consent_event_id`) REFERENCES `patient_channel_consent_events`(`organization_id`,`facility_id`,`patient_id`,`channel`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_channel_consent_heads_lock_positive" CHECK("patient_channel_consent_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_channel_consent_heads_scope_channel_uidx` ON `patient_channel_consent_heads` (`organization_id`,`facility_id`,`patient_id`,`channel`);--> statement-breakpoint
CREATE TABLE `patient_notification_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_notification_event_id` text,
	`state` text NOT NULL,
	`purpose` text NOT NULL,
	`channel` text NOT NULL,
	`language` text NOT NULL,
	`consent_event_id` text NOT NULL,
	`template_version_id` text NOT NULL,
	`policy_version_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_version_id` text NOT NULL,
	`requested_at` integer NOT NULL,
	`scheduled_at` integer NOT NULL,
	`next_attempt_at` integer,
	`destination_hint` text NOT NULL,
	`destination_fingerprint` text NOT NULL,
	`rendered_body` text NOT NULL,
	`content_hash` text NOT NULL,
	`outbox_event_id` text NOT NULL,
	`attempt_count` integer DEFAULT 0 NOT NULL,
	`failure_owner_membership_id` text NOT NULL,
	`last_failure_code` text,
	`changed_by_membership_id` text NOT NULL,
	`change_reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_notification_event_id`) REFERENCES `patient_notification_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consent_event_id`) REFERENCES `patient_channel_consent_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`template_version_id`) REFERENCES `communication_template_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`policy_version_id`) REFERENCES `communication_policy_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`outbox_event_id`) REFERENCES `outbox_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`failure_owner_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`,`channel`,`consent_event_id`) REFERENCES `patient_channel_consent_events`(`organization_id`,`facility_id`,`patient_id`,`channel`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`template_version_id`) REFERENCES `communication_template_versions`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`policy_version_id`) REFERENCES `communication_policy_versions`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`failure_owner_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`changed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_notification_events_state_enum" CHECK("patient_notification_events"."state" in ('scheduled', 'deferred_quiet_hours', 'retry_scheduled', 'delivered', 'provider_unavailable', 'manual_contact_required', 'patient_replied', 'manual_contact_completed', 'suppressed_opt_out', 'cancelled_source', 'cancelled_by_staff')),
	CONSTRAINT "patient_notification_events_purpose_enum" CHECK("patient_notification_events"."purpose" in ('appointment_reminder', 'care_plan_reminder')),
	CONSTRAINT "patient_notification_events_channel_enum" CHECK("patient_notification_events"."channel" in ('whatsapp', 'telegram', 'sms', 'voice')),
	CONSTRAINT "patient_notification_events_language_enum" CHECK("patient_notification_events"."language" in ('ru', 'kk')),
	CONSTRAINT "patient_notification_events_source_enum" CHECK("patient_notification_events"."source_type" in ('appointment', 'care_plan_task')),
	CONSTRAINT "patient_notification_events_version_positive" CHECK("patient_notification_events"."version" > 0),
	CONSTRAINT "patient_notification_events_predecessor" CHECK(("patient_notification_events"."version" = 1 and "patient_notification_events"."supersedes_notification_event_id" is null) or ("patient_notification_events"."version" > 1 and "patient_notification_events"."supersedes_notification_event_id" is not null)),
	CONSTRAINT "patient_notification_events_hashes" CHECK(length("patient_notification_events"."destination_fingerprint") = 64 and lower("patient_notification_events"."destination_fingerprint") = "patient_notification_events"."destination_fingerprint" and length("patient_notification_events"."content_hash") = 64 and lower("patient_notification_events"."content_hash") = "patient_notification_events"."content_hash"),
	CONSTRAINT "patient_notification_events_attempts_nonnegative" CHECK("patient_notification_events"."attempt_count" >= 0),
	CONSTRAINT "patient_notification_events_reason_length" CHECK(length(trim("patient_notification_events"."change_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_notification_events_scope_version_uidx` ON `patient_notification_events` (`organization_id`,`facility_id`,`notification_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_notification_events_scope_id_uidx` ON `patient_notification_events` (`organization_id`,`facility_id`,`notification_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_notification_events_source_schedule_uidx` ON `patient_notification_events` (`organization_id`,`facility_id`,`source_type`,`source_record_id`,`source_version_id`,`channel`,`scheduled_at`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_notification_events_supersedes_once_uidx` ON `patient_notification_events` (`supersedes_notification_event_id`);--> statement-breakpoint
CREATE TABLE `patient_notification_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`notification_id` text NOT NULL,
	`current_event_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_event_id`) REFERENCES `patient_notification_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`notification_id`,`current_event_id`) REFERENCES `patient_notification_events`(`organization_id`,`facility_id`,`notification_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_notification_heads_lock_positive" CHECK("patient_notification_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_notification_heads_scope_notification_uidx` ON `patient_notification_heads` (`organization_id`,`facility_id`,`notification_id`);
--> statement-breakpoint
CREATE TRIGGER `communication_policy_versions_no_update`
BEFORE UPDATE ON `communication_policy_versions`
BEGIN SELECT RAISE(ABORT, 'communication policy versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_policy_versions_no_delete`
BEFORE DELETE ON `communication_policy_versions`
BEGIN SELECT RAISE(ABORT, 'communication policy versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_template_versions_no_update`
BEFORE UPDATE ON `communication_template_versions`
BEGIN SELECT RAISE(ABORT, 'communication template versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_template_versions_no_delete`
BEFORE DELETE ON `communication_template_versions`
BEGIN SELECT RAISE(ABORT, 'communication template versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_events_require_scope`
BEFORE INSERT ON `patient_channel_consent_events`
WHEN NOT EXISTS (
  SELECT 1 FROM `patients` patient
  JOIN `memberships` actor
    ON actor.`organization_id` = patient.`organization_id`
    AND actor.`facility_id` = patient.`facility_id`
    AND actor.`id` = NEW.`captured_by_membership_id`
    AND actor.`role` IN ('clinician', 'nurse', 'registrar')
    AND actor.`status` = 'active'
  WHERE patient.`organization_id` = NEW.`organization_id`
    AND patient.`facility_id` = NEW.`facility_id`
    AND patient.`id` = NEW.`patient_id`
    AND patient.`status` = 'active'
) OR (NEW.`decision` = 'granted' AND NEW.`destination_ref` NOT LIKE 'test:%')
BEGIN SELECT RAISE(ABORT, 'channel consent requires active synthetic patient and authorized staff'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_events_extend_current_head`
BEFORE INSERT ON `patient_channel_consent_events`
WHEN (
    NEW.`version` = 1 AND (
      NEW.`supersedes_consent_event_id` IS NOT NULL OR EXISTS (
        SELECT 1 FROM `patient_channel_consent_heads` head
        WHERE head.`organization_id` = NEW.`organization_id`
          AND head.`facility_id` = NEW.`facility_id`
          AND head.`patient_id` = NEW.`patient_id`
          AND head.`channel` = NEW.`channel`
      )
    )
  ) OR (
    NEW.`version` > 1 AND NOT EXISTS (
      SELECT 1 FROM `patient_channel_consent_heads` head
      JOIN `patient_channel_consent_events` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`patient_id` = head.`patient_id`
        AND previous.`channel` = head.`channel`
        AND previous.`id` = head.`current_consent_event_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`patient_id` = NEW.`patient_id`
        AND head.`channel` = NEW.`channel`
        AND previous.`id` = NEW.`supersedes_consent_event_id`
        AND previous.`version` + 1 = NEW.`version`
    )
  )
BEGIN SELECT RAISE(ABORT, 'channel consent event must extend current head'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_heads_start_at_one`
BEFORE INSERT ON `patient_channel_consent_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `patient_channel_consent_events` event
  WHERE event.`organization_id` = NEW.`organization_id`
    AND event.`facility_id` = NEW.`facility_id`
    AND event.`patient_id` = NEW.`patient_id`
    AND event.`channel` = NEW.`channel`
    AND event.`id` = NEW.`current_consent_event_id`
    AND event.`version` = 1
)
BEGIN SELECT RAISE(ABORT, 'channel consent head must start at version one'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_heads_advance_only`
BEFORE UPDATE ON `patient_channel_consent_heads`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`patient_id` IS NOT OLD.`patient_id`
  OR NEW.`channel` IS NOT OLD.`channel`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `patient_channel_consent_events` event
    WHERE event.`organization_id` = NEW.`organization_id`
      AND event.`facility_id` = NEW.`facility_id`
      AND event.`patient_id` = NEW.`patient_id`
      AND event.`channel` = NEW.`channel`
      AND event.`id` = NEW.`current_consent_event_id`
      AND event.`supersedes_consent_event_id` = OLD.`current_consent_event_id`
      AND event.`version` = NEW.`lock_version`
  )
BEGIN SELECT RAISE(ABORT, 'channel consent head must advance by one version'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_events_require_initial_contract`
BEFORE INSERT ON `patient_notification_events`
WHEN NEW.`version` = 1 AND (
  NEW.`state` NOT IN ('scheduled', 'deferred_quiet_hours')
  OR NEW.`supersedes_notification_event_id` IS NOT NULL
  OR NEW.`attempt_count` <> 0
  OR NEW.`last_failure_code` IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM `patient_channel_consent_heads` consent_head
    JOIN `patient_channel_consent_events` consent
      ON consent.`organization_id` = consent_head.`organization_id`
      AND consent.`facility_id` = consent_head.`facility_id`
      AND consent.`patient_id` = consent_head.`patient_id`
      AND consent.`channel` = consent_head.`channel`
      AND consent.`id` = consent_head.`current_consent_event_id`
    JOIN `communication_template_versions` template
      ON template.`organization_id` = consent.`organization_id`
      AND template.`facility_id` = consent.`facility_id`
      AND template.`id` = NEW.`template_version_id`
      AND template.`purpose` = NEW.`purpose`
      AND template.`channel` = NEW.`channel`
      AND template.`language` = NEW.`language`
      AND template.`status` = 'approved_test'
      AND template.`source_type` = 'local_test'
      AND template.`minimum_content_only` = 1
      AND template.`protected_link_required` = 0
    JOIN `communication_policy_versions` policy
      ON policy.`organization_id` = consent.`organization_id`
      AND policy.`facility_id` = consent.`facility_id`
      AND policy.`id` = NEW.`policy_version_id`
      AND policy.`status` = 'active_test'
      AND policy.`source_type` = 'local_test'
    JOIN `outbox_events` outbox
      ON outbox.`organization_id` = consent.`organization_id`
      AND outbox.`facility_id` = consent.`facility_id`
      AND outbox.`id` = NEW.`outbox_event_id`
      AND outbox.`aggregate_type` = 'patient_notification'
      AND outbox.`aggregate_id` = NEW.`notification_id`
      AND outbox.`aggregate_version` = 1
      AND outbox.`status` = 'pending'
    JOIN `memberships` actor
      ON actor.`organization_id` = consent.`organization_id`
      AND actor.`facility_id` = consent.`facility_id`
      AND actor.`id` = NEW.`changed_by_membership_id`
      AND actor.`role` IN ('clinician', 'nurse', 'registrar')
      AND actor.`status` = 'active'
    JOIN `memberships` owner
      ON owner.`organization_id` = consent.`organization_id`
      AND owner.`facility_id` = consent.`facility_id`
      AND owner.`id` = NEW.`failure_owner_membership_id`
      AND owner.`role` IN ('clinician', 'nurse', 'registrar')
      AND owner.`status` = 'active'
    WHERE consent_head.`organization_id` = NEW.`organization_id`
      AND consent_head.`facility_id` = NEW.`facility_id`
      AND consent_head.`patient_id` = NEW.`patient_id`
      AND consent_head.`channel` = NEW.`channel`
      AND consent.`id` = NEW.`consent_event_id`
      AND consent.`decision` = 'granted'
      AND consent.`preferred_language` = NEW.`language`
      AND consent.`effective_at` <= NEW.`requested_at`
      AND consent.`destination_hint` = NEW.`destination_hint`
      AND consent.`destination_fingerprint` = NEW.`destination_fingerprint`
  )
  OR NOT EXISTS (
    SELECT 1 FROM `patients` patient
    WHERE patient.`organization_id` = NEW.`organization_id`
      AND patient.`facility_id` = NEW.`facility_id`
      AND patient.`id` = NEW.`patient_id`
      AND patient.`status` = 'active'
  )
  OR (
    NEW.`source_type` = 'appointment' AND NOT EXISTS (
      SELECT 1 FROM `appointments` appointment
      JOIN `appointment_heads` head
        ON head.`organization_id` = appointment.`organization_id`
        AND head.`facility_id` = appointment.`facility_id`
        AND head.`appointment_id` = appointment.`id`
        AND head.`current_version_id` = NEW.`source_version_id`
      JOIN `appointment_versions` version
        ON version.`organization_id` = head.`organization_id`
        AND version.`facility_id` = head.`facility_id`
        AND version.`appointment_id` = head.`appointment_id`
        AND version.`id` = head.`current_version_id`
        AND version.`status` = 'confirmed'
      WHERE appointment.`organization_id` = NEW.`organization_id`
        AND appointment.`facility_id` = NEW.`facility_id`
        AND appointment.`id` = NEW.`source_record_id`
        AND appointment.`patient_id` = NEW.`patient_id`
    )
  )
  OR (
    NEW.`source_type` = 'care_plan_task' AND NOT EXISTS (
      SELECT 1 FROM `chronic_care_tasks` task
      JOIN `chronic_care_task_heads` task_head
        ON task_head.`organization_id` = task.`organization_id`
        AND task_head.`facility_id` = task.`facility_id`
        AND task_head.`task_id` = task.`id`
      JOIN `chronic_care_task_versions` task_version
        ON task_version.`organization_id` = task_head.`organization_id`
        AND task_version.`facility_id` = task_head.`facility_id`
        AND task_version.`task_id` = task_head.`task_id`
        AND task_version.`id` = task_head.`current_version_id`
        AND task_version.`status` IN ('pending', 'in_progress', 'escalated')
      JOIN `chronic_care_plan_heads` plan_head
        ON plan_head.`organization_id` = task.`organization_id`
        AND plan_head.`facility_id` = task.`facility_id`
        AND plan_head.`care_plan_id` = task.`care_plan_id`
        AND plan_head.`current_version_id` = task.`source_plan_version_id`
      WHERE task.`organization_id` = NEW.`organization_id`
        AND task.`facility_id` = NEW.`facility_id`
        AND task.`id` = NEW.`source_record_id`
        AND task.`patient_id` = NEW.`patient_id`
        AND task.`source_plan_version_id` = NEW.`source_version_id`
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'notification requires current consent, approved template, policy, owner, outbox and valid source'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_events_extend_current_head`
BEFORE INSERT ON `patient_notification_events`
WHEN NEW.`version` > 1 AND NOT EXISTS (
  SELECT 1 FROM `patient_notification_heads` head
  JOIN `patient_notification_events` previous
    ON previous.`organization_id` = head.`organization_id`
    AND previous.`facility_id` = head.`facility_id`
    AND previous.`notification_id` = head.`notification_id`
    AND previous.`id` = head.`current_event_id`
  WHERE head.`organization_id` = NEW.`organization_id`
    AND head.`facility_id` = NEW.`facility_id`
    AND head.`notification_id` = NEW.`notification_id`
    AND previous.`id` = NEW.`supersedes_notification_event_id`
    AND previous.`version` + 1 = NEW.`version`
    AND previous.`patient_id` = NEW.`patient_id`
    AND previous.`purpose` = NEW.`purpose`
    AND previous.`channel` = NEW.`channel`
    AND previous.`language` = NEW.`language`
    AND previous.`consent_event_id` = NEW.`consent_event_id`
    AND previous.`template_version_id` = NEW.`template_version_id`
    AND previous.`policy_version_id` = NEW.`policy_version_id`
    AND previous.`source_type` = NEW.`source_type`
    AND previous.`source_record_id` = NEW.`source_record_id`
    AND previous.`source_version_id` = NEW.`source_version_id`
    AND previous.`requested_at` = NEW.`requested_at`
    AND previous.`scheduled_at` = NEW.`scheduled_at`
    AND previous.`destination_hint` = NEW.`destination_hint`
    AND previous.`destination_fingerprint` = NEW.`destination_fingerprint`
    AND previous.`rendered_body` = NEW.`rendered_body`
    AND previous.`content_hash` = NEW.`content_hash`
    AND previous.`outbox_event_id` = NEW.`outbox_event_id`
    AND previous.`failure_owner_membership_id` = NEW.`failure_owner_membership_id`
    AND NEW.`attempt_count` BETWEEN previous.`attempt_count` AND previous.`attempt_count` + 1
    AND (
      (previous.`state` = 'scheduled' AND NEW.`state` IN ('deferred_quiet_hours', 'retry_scheduled', 'provider_unavailable', 'manual_contact_required', 'suppressed_opt_out', 'cancelled_source', 'cancelled_by_staff'))
      OR (previous.`state` = 'deferred_quiet_hours' AND NEW.`state` IN ('retry_scheduled', 'provider_unavailable', 'manual_contact_required', 'suppressed_opt_out', 'cancelled_source', 'cancelled_by_staff'))
      OR (previous.`state` = 'retry_scheduled' AND NEW.`state` IN ('retry_scheduled', 'provider_unavailable', 'manual_contact_required', 'suppressed_opt_out', 'cancelled_source', 'cancelled_by_staff'))
      OR (previous.`state` = 'provider_unavailable' AND NEW.`state` IN ('retry_scheduled', 'manual_contact_required'))
      OR (previous.`state` = 'manual_contact_required' AND NEW.`state` IN ('patient_replied', 'manual_contact_completed', 'cancelled_by_staff'))
      OR (previous.`state` = 'patient_replied' AND NEW.`state` = 'manual_contact_completed')
    )
)
BEGIN SELECT RAISE(ABORT, 'notification event must extend the current immutable state'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_heads_start_at_one`
BEFORE INSERT ON `patient_notification_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `patient_notification_events` event
  WHERE event.`organization_id` = NEW.`organization_id`
    AND event.`facility_id` = NEW.`facility_id`
    AND event.`notification_id` = NEW.`notification_id`
    AND event.`id` = NEW.`current_event_id`
    AND event.`version` = 1
)
BEGIN SELECT RAISE(ABORT, 'notification head must start at version one'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_heads_advance_only`
BEFORE UPDATE ON `patient_notification_heads`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`notification_id` IS NOT OLD.`notification_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `patient_notification_events` event
    WHERE event.`organization_id` = NEW.`organization_id`
      AND event.`facility_id` = NEW.`facility_id`
      AND event.`notification_id` = NEW.`notification_id`
      AND event.`id` = NEW.`current_event_id`
      AND event.`supersedes_notification_event_id` = OLD.`current_event_id`
      AND event.`version` = NEW.`lock_version`
  )
BEGIN SELECT RAISE(ABORT, 'notification head must advance by one version'); END;
--> statement-breakpoint
CREATE TRIGGER `notification_delivery_attempts_require_current_state`
BEFORE INSERT ON `notification_delivery_attempts`
WHEN NEW.`provider_adapter` <> 'disconnected'
  OR NEW.`outcome` <> 'provider_unavailable'
  OR NEW.`provider_message_id` IS NOT NULL
  OR NEW.`error_code` <> 'PROVIDER_NOT_CONFIGURED'
  OR NOT EXISTS (
    SELECT 1 FROM `patient_notification_heads` head
    JOIN `patient_notification_events` event
      ON event.`organization_id` = head.`organization_id`
      AND event.`facility_id` = head.`facility_id`
      AND event.`notification_id` = head.`notification_id`
      AND event.`id` = head.`current_event_id`
    WHERE head.`organization_id` = NEW.`organization_id`
      AND head.`facility_id` = NEW.`facility_id`
      AND head.`notification_id` = NEW.`notification_id`
      AND event.`id` = NEW.`notification_event_id`
      AND event.`state` IN ('scheduled', 'deferred_quiet_hours', 'retry_scheduled')
      AND NEW.`attempt_number` = event.`attempt_count` + 1
  )
BEGIN SELECT RAISE(ABORT, 'local delivery attempt must record disconnected provider without claiming delivery'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_events_initial_contract`
BEFORE INSERT ON `communication_manual_task_events`
WHEN NEW.`version` = 1 AND (
  NEW.`state` <> 'open'
  OR NEW.`supersedes_task_event_id` IS NOT NULL
  OR NEW.`response_id` IS NOT NULL
  OR NEW.`outcome_summary` IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM `patient_notification_heads` head
    JOIN `patient_notification_events` notification
      ON notification.`organization_id` = head.`organization_id`
      AND notification.`facility_id` = head.`facility_id`
      AND notification.`notification_id` = head.`notification_id`
      AND notification.`id` = head.`current_event_id`
      AND notification.`state` = 'manual_contact_required'
    JOIN `memberships` assignee
      ON assignee.`organization_id` = notification.`organization_id`
      AND assignee.`facility_id` = notification.`facility_id`
      AND assignee.`id` = NEW.`assigned_membership_id`
      AND assignee.`status` = 'active'
      AND assignee.`role` IN ('clinician', 'nurse', 'registrar')
    WHERE head.`organization_id` = NEW.`organization_id`
      AND head.`facility_id` = NEW.`facility_id`
      AND head.`notification_id` = NEW.`notification_id`
  )
)
BEGIN SELECT RAISE(ABORT, 'manual task requires a failed notification and active owner'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_events_extend_current_head`
BEFORE INSERT ON `communication_manual_task_events`
WHEN NEW.`version` > 1 AND NOT EXISTS (
  SELECT 1 FROM `communication_manual_task_heads` head
  JOIN `communication_manual_task_events` previous
    ON previous.`organization_id` = head.`organization_id`
    AND previous.`facility_id` = head.`facility_id`
    AND previous.`task_id` = head.`task_id`
    AND previous.`id` = head.`current_event_id`
  WHERE head.`organization_id` = NEW.`organization_id`
    AND head.`facility_id` = NEW.`facility_id`
    AND head.`task_id` = NEW.`task_id`
    AND previous.`id` = NEW.`supersedes_task_event_id`
    AND previous.`version` + 1 = NEW.`version`
    AND previous.`notification_id` = NEW.`notification_id`
    AND previous.`assigned_membership_id` = NEW.`assigned_membership_id`
    AND previous.`due_at` = NEW.`due_at`
    AND previous.`failure_reason` = NEW.`failure_reason`
    AND (
      (previous.`state` = 'open' AND NEW.`state` IN ('in_progress', 'completed', 'escalated', 'cancelled'))
      OR (previous.`state` = 'in_progress' AND NEW.`state` IN ('in_progress', 'completed', 'escalated', 'cancelled'))
      OR (previous.`state` = 'escalated' AND NEW.`state` IN ('completed', 'cancelled'))
    )
)
BEGIN SELECT RAISE(ABORT, 'manual task event must extend current head'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_heads_start_at_one`
BEFORE INSERT ON `communication_manual_task_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `communication_manual_task_events` event
  WHERE event.`organization_id` = NEW.`organization_id`
    AND event.`facility_id` = NEW.`facility_id`
    AND event.`task_id` = NEW.`task_id`
    AND event.`id` = NEW.`current_event_id`
    AND event.`version` = 1
)
BEGIN SELECT RAISE(ABORT, 'manual task head must start at version one'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_heads_advance_only`
BEFORE UPDATE ON `communication_manual_task_heads`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`task_id` IS NOT OLD.`task_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `communication_manual_task_events` event
    WHERE event.`organization_id` = NEW.`organization_id`
      AND event.`facility_id` = NEW.`facility_id`
      AND event.`task_id` = NEW.`task_id`
      AND event.`id` = NEW.`current_event_id`
      AND event.`supersedes_task_event_id` = OLD.`current_event_id`
      AND event.`version` = NEW.`lock_version`
  )
BEGIN SELECT RAISE(ABORT, 'manual task head must advance by one version'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_patient_responses_require_manual_task`
BEFORE INSERT ON `communication_patient_responses`
WHEN NOT EXISTS (
  SELECT 1 FROM `communication_manual_task_heads` head
  JOIN `communication_manual_task_events` task
    ON task.`organization_id` = head.`organization_id`
    AND task.`facility_id` = head.`facility_id`
    AND task.`task_id` = head.`task_id`
    AND task.`id` = head.`current_event_id`
  WHERE head.`organization_id` = NEW.`organization_id`
    AND head.`facility_id` = NEW.`facility_id`
    AND head.`task_id` = NEW.`manual_task_id`
    AND task.`notification_id` = NEW.`notification_id`
    AND task.`state` IN ('open', 'in_progress')
    AND task.`assigned_membership_id` = NEW.`recorded_by_membership_id`
)
BEGIN SELECT RAISE(ABORT, 'patient response requires assigned open manual task'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_events_no_update` BEFORE UPDATE ON `patient_channel_consent_events`
BEGIN SELECT RAISE(ABORT, 'channel consent events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_events_no_update` BEFORE UPDATE ON `patient_notification_events`
BEGIN SELECT RAISE(ABORT, 'notification events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `notification_delivery_attempts_no_update` BEFORE UPDATE ON `notification_delivery_attempts`
BEGIN SELECT RAISE(ABORT, 'delivery attempts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_patient_responses_no_update` BEFORE UPDATE ON `communication_patient_responses`
BEGIN SELECT RAISE(ABORT, 'patient responses are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_events_no_update` BEFORE UPDATE ON `communication_manual_task_events`
BEGIN SELECT RAISE(ABORT, 'manual task events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_events_no_delete` BEFORE DELETE ON `patient_channel_consent_events`
BEGIN SELECT RAISE(ABORT, 'channel consent events cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_heads_no_delete` BEFORE DELETE ON `patient_channel_consent_heads`
BEGIN SELECT RAISE(ABORT, 'channel consent heads cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_events_no_delete` BEFORE DELETE ON `patient_notification_events`
BEGIN SELECT RAISE(ABORT, 'notification events cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_heads_no_delete` BEFORE DELETE ON `patient_notification_heads`
BEGIN SELECT RAISE(ABORT, 'notification heads cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `notification_delivery_attempts_no_delete` BEFORE DELETE ON `notification_delivery_attempts`
BEGIN SELECT RAISE(ABORT, 'delivery attempts cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_patient_responses_no_delete` BEFORE DELETE ON `communication_patient_responses`
BEGIN SELECT RAISE(ABORT, 'patient responses cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_events_no_delete` BEFORE DELETE ON `communication_manual_task_events`
BEGIN SELECT RAISE(ABORT, 'manual task events cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_heads_no_delete` BEFORE DELETE ON `communication_manual_task_heads`
BEGIN SELECT RAISE(ABORT, 'manual task heads cannot be deleted'); END;
