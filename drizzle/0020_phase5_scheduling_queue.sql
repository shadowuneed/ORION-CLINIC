CREATE TABLE `appointment_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`appointment_id`) REFERENCES `appointments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`appointment_id`,`current_version_id`) REFERENCES `appointment_versions`(`organization_id`,`facility_id`,`appointment_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "appointment_heads_lock_positive" CHECK("appointment_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_heads_scope_appointment_uidx` ON `appointment_heads` (`organization_id`,`facility_id`,`appointment_id`);--> statement-breakpoint
CREATE TABLE `appointment_slot_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`slot_id`) REFERENCES `appointment_slots`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`slot_id`,`current_version_id`) REFERENCES `appointment_slot_versions`(`organization_id`,`facility_id`,`slot_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "appointment_slot_heads_lock_positive" CHECK("appointment_slot_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_slot_heads_scope_slot_uidx` ON `appointment_slot_heads` (`organization_id`,`facility_id`,`slot_id`);--> statement-breakpoint
CREATE TABLE `appointment_slot_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`slot_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`status` text NOT NULL,
	`appointment_id` text,
	`patient_id` text,
	`referral_request_id` text,
	`referral_version_id` text,
	`held_by_membership_id` text,
	`hold_expires_at` integer,
	`change_reason` text NOT NULL,
	`changed_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `appointment_slot_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`slot_id`) REFERENCES `appointment_slots`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`changed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "appointment_slot_versions_status_enum" CHECK("appointment_slot_versions"."status" in ('available', 'held', 'booked', 'withdrawn')),
	CONSTRAINT "appointment_slot_versions_version_positive" CHECK("appointment_slot_versions"."version" > 0),
	CONSTRAINT "appointment_slot_versions_initial_predecessor" CHECK(("appointment_slot_versions"."version" = 1 and "appointment_slot_versions"."supersedes_version_id" is null) or ("appointment_slot_versions"."version" > 1 and "appointment_slot_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "appointment_slot_versions_assignment_consistent" CHECK((
          "appointment_slot_versions"."status" in ('available', 'withdrawn')
          and "appointment_slot_versions"."appointment_id" is null
          and "appointment_slot_versions"."patient_id" is null
          and "appointment_slot_versions"."referral_request_id" is null
          and "appointment_slot_versions"."referral_version_id" is null
          and "appointment_slot_versions"."held_by_membership_id" is null
          and "appointment_slot_versions"."hold_expires_at" is null
        ) or (
          "appointment_slot_versions"."status" = 'held'
          and "appointment_slot_versions"."appointment_id" is not null
          and "appointment_slot_versions"."patient_id" is not null
          and "appointment_slot_versions"."referral_request_id" is not null
          and "appointment_slot_versions"."referral_version_id" is not null
          and "appointment_slot_versions"."held_by_membership_id" is not null
          and "appointment_slot_versions"."hold_expires_at" > "appointment_slot_versions"."created_at"
        ) or (
          "appointment_slot_versions"."status" = 'booked'
          and "appointment_slot_versions"."appointment_id" is not null
          and "appointment_slot_versions"."patient_id" is not null
          and "appointment_slot_versions"."referral_request_id" is not null
          and "appointment_slot_versions"."referral_version_id" is not null
          and "appointment_slot_versions"."held_by_membership_id" is not null
          and "appointment_slot_versions"."hold_expires_at" is null
        ))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_slot_versions_scope_version_uidx` ON `appointment_slot_versions` (`organization_id`,`facility_id`,`slot_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_slot_versions_scope_id_uidx` ON `appointment_slot_versions` (`organization_id`,`facility_id`,`slot_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_slot_versions_supersedes_once_uidx` ON `appointment_slot_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE TABLE `appointment_slots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`schedule_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`service_id` text NOT NULL,
	`starts_at` integer NOT NULL,
	`ends_at` integer NOT NULL,
	`source_type` text DEFAULT 'manual_test' NOT NULL,
	`source_label` text NOT NULL,
	`source_system` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`source_observed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`schedule_id`,`provider_id`,`service_id`) REFERENCES `provider_schedules`(`organization_id`,`facility_id`,`id`,`provider_id`,`service_id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "appointment_slots_source_type_enum" CHECK("appointment_slots"."source_type" in ('manual_test', 'external')),
	CONSTRAINT "appointment_slots_window_valid" CHECK("appointment_slots"."ends_at" > "appointment_slots"."starts_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_slots_scope_id_uidx` ON `appointment_slots` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_slots_source_locator_uidx` ON `appointment_slots` (`organization_id`,`facility_id`,`source_system`,`source_record_id`,`source_revision`);--> statement-breakpoint
CREATE INDEX `appointment_slots_provider_time_idx` ON `appointment_slots` (`organization_id`,`facility_id`,`provider_id`,`starts_at`);--> statement-breakpoint
CREATE TABLE `appointment_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`status` text NOT NULL,
	`slot_id` text NOT NULL,
	`preference_snapshot_id` text NOT NULL,
	`referral_version_id` text NOT NULL,
	`hold_expires_at` integer,
	`confirmation_subject` text,
	`confirmation_method` text,
	`confirmation_language` text,
	`confirmation_statement_version` text,
	`confirmation_statement_hash` text,
	`confirmed_at` integer,
	`change_reason` text NOT NULL,
	`changed_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `appointment_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`appointment_id`) REFERENCES `appointments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`slot_id`) REFERENCES `appointment_slots`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`preference_snapshot_id`) REFERENCES `scheduling_preference_snapshots`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`changed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "appointment_versions_status_enum" CHECK("appointment_versions"."status" in ('held', 'confirmed', 'cancelled', 'expired', 'no_show', 'completed')),
	CONSTRAINT "appointment_versions_confirmation_subject_enum" CHECK("appointment_versions"."confirmation_subject" in ('patient', 'proxy')),
	CONSTRAINT "appointment_versions_confirmation_method_enum" CHECK("appointment_versions"."confirmation_method" in ('verbal_in_person', 'verbal_phone', 'digital')),
	CONSTRAINT "appointment_versions_confirmation_language_enum" CHECK("appointment_versions"."confirmation_language" in ('ru', 'kk')),
	CONSTRAINT "appointment_versions_version_positive" CHECK("appointment_versions"."version" > 0),
	CONSTRAINT "appointment_versions_initial_predecessor" CHECK(("appointment_versions"."version" = 1 and "appointment_versions"."supersedes_version_id" is null) or ("appointment_versions"."version" > 1 and "appointment_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "appointment_versions_hold_consistent" CHECK("appointment_versions"."status" <> 'held' or ("appointment_versions"."hold_expires_at" > "appointment_versions"."created_at" and "appointment_versions"."confirmed_at" is null)),
	CONSTRAINT "appointment_versions_nonheld_no_expiry" CHECK("appointment_versions"."status" = 'held' or "appointment_versions"."hold_expires_at" is null),
	CONSTRAINT "appointment_versions_confirmation_complete" CHECK((
        "appointment_versions"."confirmation_subject" is null and "appointment_versions"."confirmation_method" is null and "appointment_versions"."confirmation_language" is null and "appointment_versions"."confirmation_statement_version" is null and "appointment_versions"."confirmation_statement_hash" is null and "appointment_versions"."confirmed_at" is null
      ) or (
        "appointment_versions"."confirmation_subject" is not null and "appointment_versions"."confirmation_method" is not null and "appointment_versions"."confirmation_language" is not null and length("appointment_versions"."confirmation_statement_hash") = 64 and "appointment_versions"."confirmed_at" is not null
      )),
	CONSTRAINT "appointment_versions_confirmed_has_confirmation" CHECK("appointment_versions"."status" not in ('confirmed', 'no_show', 'completed') or "appointment_versions"."confirmed_at" is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_versions_scope_version_uidx` ON `appointment_versions` (`organization_id`,`facility_id`,`appointment_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_versions_scope_id_uidx` ON `appointment_versions` (`organization_id`,`facility_id`,`appointment_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `appointment_versions_supersedes_once_uidx` ON `appointment_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE TABLE `appointments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`referral_request_id` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`referral_request_id`) REFERENCES `service_requests`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `appointments_scope_id_uidx` ON `appointments` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE INDEX `appointments_referral_idx` ON `appointments` (`organization_id`,`facility_id`,`referral_request_id`);--> statement-breakpoint
CREATE INDEX `appointments_patient_idx` ON `appointments` (`organization_id`,`facility_id`,`patient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `provider_schedules` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`provider_id` text NOT NULL,
	`service_id` text NOT NULL,
	`timezone` text NOT NULL,
	`valid_from` integer NOT NULL,
	`valid_to` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_type` text DEFAULT 'manual_test' NOT NULL,
	`source_label` text NOT NULL,
	`source_system` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`source_observed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`provider_id`) REFERENCES `scheduling_providers`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`service_id`) REFERENCES `scheduling_services`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "provider_schedules_status_enum" CHECK("provider_schedules"."status" in ('active', 'withdrawn')),
	CONSTRAINT "provider_schedules_source_type_enum" CHECK("provider_schedules"."source_type" in ('manual_test', 'external')),
	CONSTRAINT "provider_schedules_window_valid" CHECK("provider_schedules"."valid_to" > "provider_schedules"."valid_from")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `provider_schedules_scope_id_uidx` ON `provider_schedules` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `provider_schedules_scope_tuple_uidx` ON `provider_schedules` (`organization_id`,`facility_id`,`id`,`provider_id`,`service_id`);--> statement-breakpoint
CREATE INDEX `provider_schedules_provider_window_idx` ON `provider_schedules` (`organization_id`,`facility_id`,`provider_id`,`valid_from`,`valid_to`);--> statement-breakpoint
CREATE TABLE `queue_ticket_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`queue_ticket_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`queue_ticket_id`) REFERENCES `queue_tickets`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`queue_ticket_id`,`current_version_id`) REFERENCES `queue_ticket_versions`(`organization_id`,`facility_id`,`queue_ticket_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_ticket_heads_lock_positive" CHECK("queue_ticket_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_ticket_heads_scope_ticket_uidx` ON `queue_ticket_heads` (`organization_id`,`facility_id`,`queue_ticket_id`);--> statement-breakpoint
CREATE TABLE `queue_ticket_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`queue_ticket_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`status` text NOT NULL,
	`room_label` text,
	`exception_code` text,
	`exception_note` text,
	`change_reason` text NOT NULL,
	`changed_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `queue_ticket_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`queue_ticket_id`) REFERENCES `queue_tickets`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`changed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_ticket_versions_status_enum" CHECK("queue_ticket_versions"."status" in ('issued', 'arrived', 'called', 'in_service', 'completed', 'cancelled', 'exception')),
	CONSTRAINT "queue_ticket_versions_version_positive" CHECK("queue_ticket_versions"."version" > 0),
	CONSTRAINT "queue_ticket_versions_initial_predecessor" CHECK(("queue_ticket_versions"."version" = 1 and "queue_ticket_versions"."supersedes_version_id" is null) or ("queue_ticket_versions"."version" > 1 and "queue_ticket_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "queue_ticket_versions_room_consistent" CHECK("queue_ticket_versions"."status" not in ('called', 'in_service', 'completed') or length(trim("queue_ticket_versions"."room_label")) between 1 and 80),
	CONSTRAINT "queue_ticket_versions_exception_consistent" CHECK(("queue_ticket_versions"."status" = 'exception' and length(trim("queue_ticket_versions"."exception_code")) between 2 and 80 and length(trim("queue_ticket_versions"."exception_note")) between 3 and 500) or ("queue_ticket_versions"."status" <> 'exception' and "queue_ticket_versions"."exception_code" is null and "queue_ticket_versions"."exception_note" is null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_ticket_versions_scope_version_uidx` ON `queue_ticket_versions` (`organization_id`,`facility_id`,`queue_ticket_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `queue_ticket_versions_scope_id_uidx` ON `queue_ticket_versions` (`organization_id`,`facility_id`,`queue_ticket_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `queue_ticket_versions_supersedes_once_uidx` ON `queue_ticket_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE TABLE `queue_tickets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`appointment_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`service_date` text NOT NULL,
	`sequence` integer NOT NULL,
	`display_number` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`appointment_id`) REFERENCES `appointments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "queue_tickets_sequence_positive" CHECK("queue_tickets"."sequence" > 0),
	CONSTRAINT "queue_tickets_service_date_valid" CHECK(length("queue_tickets"."service_date") = 10 and date("queue_tickets"."service_date") is not null)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `queue_tickets_scope_id_uidx` ON `queue_tickets` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `queue_tickets_scope_appointment_uidx` ON `queue_tickets` (`organization_id`,`facility_id`,`appointment_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `queue_tickets_scope_sequence_uidx` ON `queue_tickets` (`organization_id`,`facility_id`,`service_date`,`sequence`);--> statement-breakpoint
CREATE TABLE `scheduling_preference_snapshots` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`referral_request_id` text NOT NULL,
	`referral_version_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_preference_id` text,
	`preferred_date_from` text NOT NULL,
	`preferred_date_to` text NOT NULL,
	`earliest_local_time` text,
	`latest_local_time` text,
	`preferred_provider_id` text,
	`notes` text,
	`notice_language` text NOT NULL,
	`captured_by_membership_id` text NOT NULL,
	`captured_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_preference_id`) REFERENCES `scheduling_preference_snapshots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`referral_request_id`,`referral_version_id`) REFERENCES `service_request_versions`(`organization_id`,`facility_id`,`service_request_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`preferred_provider_id`) REFERENCES `scheduling_providers`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`captured_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduling_preferences_language_enum" CHECK("scheduling_preference_snapshots"."notice_language" in ('ru', 'kk')),
	CONSTRAINT "scheduling_preferences_version_positive" CHECK("scheduling_preference_snapshots"."version" > 0),
	CONSTRAINT "scheduling_preferences_initial_predecessor" CHECK(("scheduling_preference_snapshots"."version" = 1 and "scheduling_preference_snapshots"."supersedes_preference_id" is null) or ("scheduling_preference_snapshots"."version" > 1 and "scheduling_preference_snapshots"."supersedes_preference_id" is not null)),
	CONSTRAINT "scheduling_preferences_date_range" CHECK(length("scheduling_preference_snapshots"."preferred_date_from") = 10 and date("scheduling_preference_snapshots"."preferred_date_from") is not null and length("scheduling_preference_snapshots"."preferred_date_to") = 10 and date("scheduling_preference_snapshots"."preferred_date_to") is not null and date("scheduling_preference_snapshots"."preferred_date_to") >= date("scheduling_preference_snapshots"."preferred_date_from")),
	CONSTRAINT "scheduling_preferences_time_range" CHECK(("scheduling_preference_snapshots"."earliest_local_time" is null and "scheduling_preference_snapshots"."latest_local_time" is null) or (time("scheduling_preference_snapshots"."earliest_local_time" || ':00') is not null and time("scheduling_preference_snapshots"."latest_local_time" || ':00') is not null and time("scheduling_preference_snapshots"."latest_local_time" || ':00') >= time("scheduling_preference_snapshots"."earliest_local_time" || ':00')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduling_preferences_scope_id_uidx` ON `scheduling_preference_snapshots` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduling_preferences_referral_version_uidx` ON `scheduling_preference_snapshots` (`organization_id`,`facility_id`,`referral_request_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduling_preferences_supersedes_once_uidx` ON `scheduling_preference_snapshots` (`supersedes_preference_id`);--> statement-breakpoint
CREATE INDEX `scheduling_preferences_patient_idx` ON `scheduling_preference_snapshots` (`organization_id`,`facility_id`,`patient_id`,`captured_at`);--> statement-breakpoint
CREATE TABLE `scheduling_providers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`specialty_id` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_type` text DEFAULT 'manual_test' NOT NULL,
	`source_label` text NOT NULL,
	`source_system` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`source_observed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`specialty_id`) REFERENCES `scheduling_specialties`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduling_providers_status_enum" CHECK("scheduling_providers"."status" in ('active', 'inactive')),
	CONSTRAINT "scheduling_providers_source_type_enum" CHECK("scheduling_providers"."source_type" in ('manual_test', 'external')),
	CONSTRAINT "scheduling_providers_name_length" CHECK(length(trim("scheduling_providers"."display_name")) between 2 and 180)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduling_providers_scope_id_uidx` ON `scheduling_providers` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE INDEX `scheduling_providers_specialty_status_idx` ON `scheduling_providers` (`organization_id`,`facility_id`,`specialty_id`,`status`);--> statement-breakpoint
CREATE TABLE `scheduling_services` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`specialty_id` text NOT NULL,
	`code` text NOT NULL,
	`display_name` text NOT NULL,
	`duration_minutes` integer NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_type` text DEFAULT 'manual_test' NOT NULL,
	`source_label` text NOT NULL,
	`source_system` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`source_observed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`specialty_id`) REFERENCES `scheduling_specialties`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduling_services_status_enum" CHECK("scheduling_services"."status" in ('active', 'inactive')),
	CONSTRAINT "scheduling_services_source_type_enum" CHECK("scheduling_services"."source_type" in ('manual_test', 'external')),
	CONSTRAINT "scheduling_services_duration_range" CHECK("scheduling_services"."duration_minutes" between 5 and 1440)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduling_services_scope_id_uidx` ON `scheduling_services` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduling_services_scope_code_uidx` ON `scheduling_services` (`organization_id`,`facility_id`,`code`);--> statement-breakpoint
CREATE INDEX `scheduling_services_specialty_status_idx` ON `scheduling_services` (`organization_id`,`facility_id`,`specialty_id`,`status`);--> statement-breakpoint
CREATE TABLE `scheduling_specialties` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`code` text NOT NULL,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`source_type` text DEFAULT 'manual_test' NOT NULL,
	`source_label` text NOT NULL,
	`source_system` text NOT NULL,
	`source_record_id` text NOT NULL,
	`source_revision` text NOT NULL,
	`source_observed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "scheduling_specialties_status_enum" CHECK("scheduling_specialties"."status" in ('active', 'inactive')),
	CONSTRAINT "scheduling_specialties_source_type_enum" CHECK("scheduling_specialties"."source_type" in ('manual_test', 'external')),
	CONSTRAINT "scheduling_specialties_code_length" CHECK(length(trim("scheduling_specialties"."code")) between 1 and 80),
	CONSTRAINT "scheduling_specialties_name_length" CHECK(length(trim("scheduling_specialties"."display_name")) between 2 and 180)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `scheduling_specialties_scope_id_uidx` ON `scheduling_specialties` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `scheduling_specialties_scope_code_uidx` ON `scheduling_specialties` (`organization_id`,`facility_id`,`code`);
--> statement-breakpoint
CREATE TRIGGER `scheduling_preferences_require_current_referral`
BEFORE INSERT ON `scheduling_preference_snapshots`
WHEN NOT EXISTS (
  SELECT 1
  FROM `service_requests` request
  JOIN `service_request_heads` head
    ON head.`organization_id` = request.`organization_id`
    AND head.`facility_id` = request.`facility_id`
    AND head.`service_request_id` = request.`id`
  JOIN `service_request_versions` version
    ON version.`organization_id` = head.`organization_id`
    AND version.`facility_id` = head.`facility_id`
    AND version.`service_request_id` = head.`service_request_id`
    AND version.`id` = head.`current_version_id`
  WHERE request.`organization_id` = NEW.`organization_id`
    AND request.`facility_id` = NEW.`facility_id`
    AND request.`id` = NEW.`referral_request_id`
    AND request.`patient_id` = NEW.`patient_id`
    AND request.`request_kind` = 'referral'
    AND version.`id` = NEW.`referral_version_id`
    AND version.`status` = 'active'
    AND version.`approved_by_membership_id` IS NOT NULL
    AND version.`approved_at` IS NOT NULL
)
BEGIN
  SELECT RAISE(ABORT, 'scheduling preference requires current active approved referral');
END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_preferences_linear_history`
BEFORE INSERT ON `scheduling_preference_snapshots`
WHEN
  (NEW.`version` = 1 AND NEW.`supersedes_preference_id` IS NOT NULL)
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `scheduling_preference_snapshots` previous
      WHERE previous.`id` = NEW.`supersedes_preference_id`
        AND previous.`organization_id` = NEW.`organization_id`
        AND previous.`facility_id` = NEW.`facility_id`
        AND previous.`patient_id` = NEW.`patient_id`
        AND previous.`referral_request_id` = NEW.`referral_request_id`
        AND previous.`version` + 1 = NEW.`version`
        AND NOT EXISTS (
          SELECT 1
          FROM `scheduling_preference_snapshots` newer
          WHERE newer.`organization_id` = previous.`organization_id`
            AND newer.`facility_id` = previous.`facility_id`
            AND newer.`referral_request_id` = previous.`referral_request_id`
            AND newer.`version` > previous.`version`
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'scheduling preference must extend latest version');
END;
--> statement-breakpoint
CREATE TRIGGER `appointments_exact_referral_patient`
BEFORE INSERT ON `appointments`
WHEN NOT EXISTS (
  SELECT 1 FROM `service_requests` request
  WHERE request.`organization_id` = NEW.`organization_id`
    AND request.`facility_id` = NEW.`facility_id`
    AND request.`id` = NEW.`referral_request_id`
    AND request.`patient_id` = NEW.`patient_id`
    AND request.`request_kind` = 'referral'
)
BEGIN
  SELECT RAISE(ABORT, 'appointment must belong to referral patient');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_versions_one_active_referral`
BEFORE INSERT ON `appointment_versions`
WHEN NEW.`version` = 1 AND EXISTS (
  SELECT 1
  FROM `appointments` existing_appointment
  JOIN `appointment_heads` existing_head
    ON existing_head.`organization_id` = existing_appointment.`organization_id`
    AND existing_head.`facility_id` = existing_appointment.`facility_id`
    AND existing_head.`appointment_id` = existing_appointment.`id`
  JOIN `appointment_versions` existing_version
    ON existing_version.`organization_id` = existing_head.`organization_id`
    AND existing_version.`facility_id` = existing_head.`facility_id`
    AND existing_version.`appointment_id` = existing_head.`appointment_id`
    AND existing_version.`id` = existing_head.`current_version_id`
  JOIN `appointments` new_appointment
    ON new_appointment.`organization_id` = NEW.`organization_id`
    AND new_appointment.`facility_id` = NEW.`facility_id`
    AND new_appointment.`id` = NEW.`appointment_id`
  WHERE existing_appointment.`organization_id` = NEW.`organization_id`
    AND existing_appointment.`facility_id` = NEW.`facility_id`
    AND existing_appointment.`referral_request_id` = new_appointment.`referral_request_id`
    AND existing_appointment.`id` <> NEW.`appointment_id`
    AND existing_version.`status` IN ('held', 'confirmed')
)
BEGIN
  SELECT RAISE(ABORT, 'referral already has an active appointment');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_versions_extend_current_head`
BEFORE INSERT ON `appointment_versions`
WHEN
  (
    NEW.`version` = 1
    AND (
      NEW.`status` <> 'held'
      OR NEW.`supersedes_version_id` IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM `appointment_heads` head
        WHERE head.`organization_id` = NEW.`organization_id`
          AND head.`facility_id` = NEW.`facility_id`
          AND head.`appointment_id` = NEW.`appointment_id`
      )
    )
  )
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `appointment_heads` head
      JOIN `appointment_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`appointment_id` = head.`appointment_id`
        AND previous.`id` = head.`current_version_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`appointment_id` = NEW.`appointment_id`
        AND previous.`id` = NEW.`supersedes_version_id`
        AND previous.`version` + 1 = NEW.`version`
        AND previous.`slot_id` = NEW.`slot_id`
        AND previous.`preference_snapshot_id` = NEW.`preference_snapshot_id`
        AND previous.`referral_version_id` = NEW.`referral_version_id`
        AND (
          (previous.`status` = 'held' AND NEW.`status` IN ('confirmed', 'cancelled', 'expired'))
          OR (previous.`status` = 'confirmed' AND NEW.`status` IN ('cancelled', 'no_show', 'completed'))
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'appointment version must extend current head');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_versions_initial_exact_hold`
BEFORE INSERT ON `appointment_versions`
WHEN NEW.`version` = 1 AND NOT EXISTS (
  SELECT 1
  FROM `appointments` appointment
  JOIN `scheduling_preference_snapshots` preference
    ON preference.`organization_id` = appointment.`organization_id`
    AND preference.`facility_id` = appointment.`facility_id`
    AND preference.`patient_id` = appointment.`patient_id`
    AND preference.`referral_request_id` = appointment.`referral_request_id`
    AND preference.`id` = NEW.`preference_snapshot_id`
    AND preference.`referral_version_id` = NEW.`referral_version_id`
  JOIN `appointment_slot_heads` slot_head
    ON slot_head.`organization_id` = appointment.`organization_id`
    AND slot_head.`facility_id` = appointment.`facility_id`
    AND slot_head.`slot_id` = NEW.`slot_id`
  JOIN `appointment_slot_versions` slot_version
    ON slot_version.`organization_id` = slot_head.`organization_id`
    AND slot_version.`facility_id` = slot_head.`facility_id`
    AND slot_version.`slot_id` = slot_head.`slot_id`
    AND slot_version.`id` = slot_head.`current_version_id`
  WHERE appointment.`organization_id` = NEW.`organization_id`
    AND appointment.`facility_id` = NEW.`facility_id`
    AND appointment.`id` = NEW.`appointment_id`
    AND slot_version.`status` = 'available'
)
BEGIN
  SELECT RAISE(ABORT, 'appointment hold requires exact preference and available slot');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_versions_confirm_exact_hold`
BEFORE INSERT ON `appointment_versions`
WHEN NEW.`status` = 'confirmed' AND NOT EXISTS (
  SELECT 1
  FROM `appointments` appointment
  JOIN `appointment_slot_heads` slot_head
    ON slot_head.`organization_id` = appointment.`organization_id`
    AND slot_head.`facility_id` = appointment.`facility_id`
    AND slot_head.`slot_id` = NEW.`slot_id`
  JOIN `appointment_slot_versions` slot_version
    ON slot_version.`organization_id` = slot_head.`organization_id`
    AND slot_version.`facility_id` = slot_head.`facility_id`
    AND slot_version.`slot_id` = slot_head.`slot_id`
    AND slot_version.`id` = slot_head.`current_version_id`
  WHERE appointment.`organization_id` = NEW.`organization_id`
    AND appointment.`facility_id` = NEW.`facility_id`
    AND appointment.`id` = NEW.`appointment_id`
    AND slot_version.`status` = 'held'
    AND slot_version.`appointment_id` = appointment.`id`
    AND slot_version.`patient_id` = appointment.`patient_id`
    AND slot_version.`referral_request_id` = appointment.`referral_request_id`
    AND slot_version.`referral_version_id` = NEW.`referral_version_id`
    AND slot_version.`hold_expires_at` > NEW.`confirmed_at`
)
BEGIN
  SELECT RAISE(ABORT, 'appointment confirmation requires unexpired exact hold');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_heads_start_at_one`
BEFORE INSERT ON `appointment_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `appointment_versions` version
  WHERE version.`organization_id` = NEW.`organization_id`
    AND version.`facility_id` = NEW.`facility_id`
    AND version.`appointment_id` = NEW.`appointment_id`
    AND version.`id` = NEW.`current_version_id`
    AND version.`version` = 1
    AND version.`status` = 'held'
)
BEGIN
  SELECT RAISE(ABORT, 'appointment head must start at held version one');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_heads_advance_only`
BEFORE UPDATE ON `appointment_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`appointment_id` IS NOT OLD.`appointment_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `appointment_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`appointment_id` = NEW.`appointment_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'appointment head must advance by one version');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_versions_extend_current_head`
BEFORE INSERT ON `appointment_slot_versions`
WHEN
  (
    NEW.`version` = 1
    AND (
      NEW.`status` <> 'available'
      OR NEW.`supersedes_version_id` IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM `appointment_slot_heads` head
        WHERE head.`organization_id` = NEW.`organization_id`
          AND head.`facility_id` = NEW.`facility_id`
          AND head.`slot_id` = NEW.`slot_id`
      )
    )
  )
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `appointment_slot_heads` head
      JOIN `appointment_slot_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`slot_id` = head.`slot_id`
        AND previous.`id` = head.`current_version_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`slot_id` = NEW.`slot_id`
        AND previous.`id` = NEW.`supersedes_version_id`
        AND previous.`version` + 1 = NEW.`version`
        AND (
          (previous.`status` = 'available' AND NEW.`status` IN ('held', 'withdrawn'))
          OR (previous.`status` = 'held' AND NEW.`status` IN ('booked', 'available'))
          OR (previous.`status` = 'booked' AND NEW.`status` = 'available')
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'slot version must extend current head');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_versions_exact_hold`
BEFORE INSERT ON `appointment_slot_versions`
WHEN NEW.`status` = 'held' AND NOT EXISTS (
  SELECT 1
  FROM `appointments` appointment
  JOIN `appointment_heads` appointment_head
    ON appointment_head.`organization_id` = appointment.`organization_id`
    AND appointment_head.`facility_id` = appointment.`facility_id`
    AND appointment_head.`appointment_id` = appointment.`id`
  JOIN `appointment_versions` appointment_version
    ON appointment_version.`organization_id` = appointment_head.`organization_id`
    AND appointment_version.`facility_id` = appointment_head.`facility_id`
    AND appointment_version.`appointment_id` = appointment_head.`appointment_id`
    AND appointment_version.`id` = appointment_head.`current_version_id`
  WHERE appointment.`organization_id` = NEW.`organization_id`
    AND appointment.`facility_id` = NEW.`facility_id`
    AND appointment.`id` = NEW.`appointment_id`
    AND appointment.`patient_id` = NEW.`patient_id`
    AND appointment.`referral_request_id` = NEW.`referral_request_id`
    AND appointment_version.`status` = 'held'
    AND appointment_version.`slot_id` = NEW.`slot_id`
    AND appointment_version.`referral_version_id` = NEW.`referral_version_id`
    AND appointment_version.`hold_expires_at` = NEW.`hold_expires_at`
)
BEGIN
  SELECT RAISE(ABORT, 'slot hold must match exact appointment hold');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_versions_exact_booking`
BEFORE INSERT ON `appointment_slot_versions`
WHEN NEW.`status` = 'booked' AND NOT EXISTS (
  SELECT 1
  FROM `appointments` appointment
  JOIN `appointment_heads` appointment_head
    ON appointment_head.`organization_id` = appointment.`organization_id`
    AND appointment_head.`facility_id` = appointment.`facility_id`
    AND appointment_head.`appointment_id` = appointment.`id`
  JOIN `appointment_versions` appointment_version
    ON appointment_version.`organization_id` = appointment_head.`organization_id`
    AND appointment_version.`facility_id` = appointment_head.`facility_id`
    AND appointment_version.`appointment_id` = appointment_head.`appointment_id`
    AND appointment_version.`id` = appointment_head.`current_version_id`
  WHERE appointment.`organization_id` = NEW.`organization_id`
    AND appointment.`facility_id` = NEW.`facility_id`
    AND appointment.`id` = NEW.`appointment_id`
    AND appointment.`patient_id` = NEW.`patient_id`
    AND appointment.`referral_request_id` = NEW.`referral_request_id`
    AND appointment_version.`status` = 'confirmed'
    AND appointment_version.`slot_id` = NEW.`slot_id`
    AND appointment_version.`referral_version_id` = NEW.`referral_version_id`
)
BEGIN
  SELECT RAISE(ABORT, 'slot booking requires exact confirmed appointment');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_heads_start_at_one`
BEFORE INSERT ON `appointment_slot_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `appointment_slot_versions` version
  WHERE version.`organization_id` = NEW.`organization_id`
    AND version.`facility_id` = NEW.`facility_id`
    AND version.`slot_id` = NEW.`slot_id`
    AND version.`id` = NEW.`current_version_id`
    AND version.`version` = 1
    AND version.`status` = 'available'
)
BEGIN
  SELECT RAISE(ABORT, 'slot head must start at available version one');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_heads_advance_only`
BEFORE UPDATE ON `appointment_slot_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`slot_id` IS NOT OLD.`slot_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `appointment_slot_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`slot_id` = NEW.`slot_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'slot head must advance by one version');
END;
--> statement-breakpoint
CREATE TRIGGER `queue_tickets_require_confirmed_appointment`
BEFORE INSERT ON `queue_tickets`
WHEN NOT EXISTS (
  SELECT 1
  FROM `appointments` appointment
  JOIN `appointment_heads` head
    ON head.`organization_id` = appointment.`organization_id`
    AND head.`facility_id` = appointment.`facility_id`
    AND head.`appointment_id` = appointment.`id`
  JOIN `appointment_versions` version
    ON version.`organization_id` = head.`organization_id`
    AND version.`facility_id` = head.`facility_id`
    AND version.`appointment_id` = head.`appointment_id`
    AND version.`id` = head.`current_version_id`
  WHERE appointment.`organization_id` = NEW.`organization_id`
    AND appointment.`facility_id` = NEW.`facility_id`
    AND appointment.`id` = NEW.`appointment_id`
    AND appointment.`patient_id` = NEW.`patient_id`
    AND version.`status` = 'confirmed'
)
BEGIN
  SELECT RAISE(ABORT, 'queue ticket requires confirmed appointment');
END;
--> statement-breakpoint
CREATE TRIGGER `queue_ticket_versions_extend_current_head`
BEFORE INSERT ON `queue_ticket_versions`
WHEN
  (
    NEW.`version` = 1
    AND (
      NEW.`status` <> 'issued'
      OR NEW.`supersedes_version_id` IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM `queue_ticket_heads` head
        WHERE head.`organization_id` = NEW.`organization_id`
          AND head.`facility_id` = NEW.`facility_id`
          AND head.`queue_ticket_id` = NEW.`queue_ticket_id`
      )
    )
  )
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `queue_ticket_heads` head
      JOIN `queue_ticket_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`queue_ticket_id` = head.`queue_ticket_id`
        AND previous.`id` = head.`current_version_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`queue_ticket_id` = NEW.`queue_ticket_id`
        AND previous.`id` = NEW.`supersedes_version_id`
        AND previous.`version` + 1 = NEW.`version`
        AND (
          (previous.`status` = 'issued' AND NEW.`status` IN ('arrived', 'cancelled', 'exception'))
          OR (previous.`status` = 'arrived' AND NEW.`status` IN ('called', 'cancelled', 'exception'))
          OR (previous.`status` = 'called' AND NEW.`status` IN ('in_service', 'cancelled', 'exception'))
          OR (previous.`status` = 'in_service' AND NEW.`status` IN ('completed', 'exception'))
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'queue ticket version must extend current head');
END;
--> statement-breakpoint
CREATE TRIGGER `queue_ticket_heads_start_at_one`
BEFORE INSERT ON `queue_ticket_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `queue_ticket_versions` version
  WHERE version.`organization_id` = NEW.`organization_id`
    AND version.`facility_id` = NEW.`facility_id`
    AND version.`queue_ticket_id` = NEW.`queue_ticket_id`
    AND version.`id` = NEW.`current_version_id`
    AND version.`version` = 1
    AND version.`status` = 'issued'
)
BEGIN
  SELECT RAISE(ABORT, 'queue head must start at issued version one');
END;
--> statement-breakpoint
CREATE TRIGGER `queue_ticket_heads_advance_only`
BEFORE UPDATE ON `queue_ticket_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`queue_ticket_id` IS NOT OLD.`queue_ticket_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `queue_ticket_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`queue_ticket_id` = NEW.`queue_ticket_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'queue head must advance by one version');
END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_specialties_manual_source_only`
BEFORE INSERT ON `scheduling_specialties`
WHEN NEW.`source_type` <> 'manual_test' OR NEW.`source_label` <> 'Тестовое ручное расписание · не КМИС'
BEGIN SELECT RAISE(ABORT, 'only labelled manual test schedule is enabled'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_services_manual_source_only`
BEFORE INSERT ON `scheduling_services`
WHEN NEW.`source_type` <> 'manual_test' OR NEW.`source_label` <> 'Тестовое ручное расписание · не КМИС'
BEGIN SELECT RAISE(ABORT, 'only labelled manual test schedule is enabled'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_providers_manual_source_only`
BEFORE INSERT ON `scheduling_providers`
WHEN NEW.`source_type` <> 'manual_test' OR NEW.`source_label` <> 'Тестовое ручное расписание · не КМИС'
BEGIN SELECT RAISE(ABORT, 'only labelled manual test schedule is enabled'); END;
--> statement-breakpoint
CREATE TRIGGER `provider_schedules_manual_source_only`
BEFORE INSERT ON `provider_schedules`
WHEN NEW.`source_type` <> 'manual_test' OR NEW.`source_label` <> 'Тестовое ручное расписание · не КМИС'
BEGIN SELECT RAISE(ABORT, 'only labelled manual test schedule is enabled'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slots_manual_source_only`
BEFORE INSERT ON `appointment_slots`
WHEN NEW.`source_type` <> 'manual_test' OR NEW.`source_label` <> 'Тестовое ручное расписание · не КМИС'
BEGIN SELECT RAISE(ABORT, 'only labelled manual test schedule is enabled'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_specialties_no_update` BEFORE UPDATE ON `scheduling_specialties`
BEGIN SELECT RAISE(ABORT, 'scheduling specialties are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_services_no_update` BEFORE UPDATE ON `scheduling_services`
BEGIN SELECT RAISE(ABORT, 'scheduling services are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_providers_no_update` BEFORE UPDATE ON `scheduling_providers`
BEGIN SELECT RAISE(ABORT, 'scheduling providers are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `provider_schedules_no_update` BEFORE UPDATE ON `provider_schedules`
BEGIN SELECT RAISE(ABORT, 'provider schedules are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slots_no_update` BEFORE UPDATE ON `appointment_slots`
BEGIN SELECT RAISE(ABORT, 'appointment slots are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_preferences_no_update` BEFORE UPDATE ON `scheduling_preference_snapshots`
BEGIN SELECT RAISE(ABORT, 'scheduling preferences are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `appointments_no_update` BEFORE UPDATE ON `appointments`
BEGIN SELECT RAISE(ABORT, 'appointments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_versions_no_update` BEFORE UPDATE ON `appointment_versions`
BEGIN SELECT RAISE(ABORT, 'appointment versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_versions_no_update` BEFORE UPDATE ON `appointment_slot_versions`
BEGIN SELECT RAISE(ABORT, 'slot versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `queue_tickets_no_update` BEFORE UPDATE ON `queue_tickets`
BEGIN SELECT RAISE(ABORT, 'queue tickets are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `queue_ticket_versions_no_update` BEFORE UPDATE ON `queue_ticket_versions`
BEGIN SELECT RAISE(ABORT, 'queue ticket versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_specialties_no_delete` BEFORE DELETE ON `scheduling_specialties`
BEGIN SELECT RAISE(ABORT, 'scheduling specialties cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_services_no_delete` BEFORE DELETE ON `scheduling_services`
BEGIN SELECT RAISE(ABORT, 'scheduling services cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_providers_no_delete` BEFORE DELETE ON `scheduling_providers`
BEGIN SELECT RAISE(ABORT, 'scheduling providers cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `provider_schedules_no_delete` BEFORE DELETE ON `provider_schedules`
BEGIN SELECT RAISE(ABORT, 'provider schedules cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slots_no_delete` BEFORE DELETE ON `appointment_slots`
BEGIN SELECT RAISE(ABORT, 'appointment slots cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_preferences_no_delete` BEFORE DELETE ON `scheduling_preference_snapshots`
BEGIN SELECT RAISE(ABORT, 'scheduling preferences cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `appointments_no_delete` BEFORE DELETE ON `appointments`
BEGIN SELECT RAISE(ABORT, 'appointments cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_versions_no_delete` BEFORE DELETE ON `appointment_versions`
BEGIN SELECT RAISE(ABORT, 'appointment versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_heads_no_delete` BEFORE DELETE ON `appointment_heads`
BEGIN SELECT RAISE(ABORT, 'appointment heads cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_versions_no_delete` BEFORE DELETE ON `appointment_slot_versions`
BEGIN SELECT RAISE(ABORT, 'slot versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_heads_no_delete` BEFORE DELETE ON `appointment_slot_heads`
BEGIN SELECT RAISE(ABORT, 'slot heads cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `queue_tickets_no_delete` BEFORE DELETE ON `queue_tickets`
BEGIN SELECT RAISE(ABORT, 'queue tickets cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `queue_ticket_versions_no_delete` BEFORE DELETE ON `queue_ticket_versions`
BEGIN SELECT RAISE(ABORT, 'queue ticket versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `queue_ticket_heads_no_delete` BEFORE DELETE ON `queue_ticket_heads`
BEGIN SELECT RAISE(ABORT, 'queue ticket heads cannot be deleted'); END;
