CREATE TABLE `patient_identifiers` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`kind` text NOT NULL,
	`normalized_value` text NOT NULL,
	`display_last4` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_identifiers_kind_enum" CHECK("patient_identifiers"."kind" in ('test_iin', 'other')),
	CONSTRAINT "patient_identifiers_status_enum" CHECK("patient_identifiers"."status" in ('active', 'revoked')),
	CONSTRAINT "patient_identifiers_version_positive" CHECK("patient_identifiers"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_identifiers_scope_active_value_uidx` ON `patient_identifiers` (`organization_id`,`facility_id`,`kind`,`normalized_value`) WHERE "patient_identifiers"."status" = 'active';--> statement-breakpoint
CREATE INDEX `patient_identifiers_scope_patient_idx` ON `patient_identifiers` (`organization_id`,`facility_id`,`patient_id`,`status`);--> statement-breakpoint
CREATE TABLE `patient_photo_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'ready' NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_photo_assets_byte_size_valid" CHECK("patient_photo_assets"."byte_size" > 0),
	CONSTRAINT "patient_photo_assets_version_positive" CHECK("patient_photo_assets"."version" > 0),
	CONSTRAINT "patient_photo_assets_status_enum" CHECK("patient_photo_assets"."status" in ('ready', 'deleted'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_photo_assets_scope_object_uidx` ON `patient_photo_assets` (`organization_id`,`facility_id`,`object_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_photo_assets_scope_patient_id_uidx` ON `patient_photo_assets` (`organization_id`,`facility_id`,`patient_id`,`id`);--> statement-breakpoint
CREATE TABLE `patient_photo_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`current_photo_asset_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_photo_asset_id`) REFERENCES `patient_photo_assets`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`,`current_photo_asset_id`) REFERENCES `patient_photo_assets`(`organization_id`,`facility_id`,`patient_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_photo_heads_lock_positive" CHECK("patient_photo_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_photo_heads_scope_patient_uidx` ON `patient_photo_heads` (`organization_id`,`facility_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `patient_profile_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `patient_profile_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`,`current_version_id`) REFERENCES `patient_profile_versions`(`organization_id`,`facility_id`,`patient_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_profile_heads_lock_positive" CHECK("patient_profile_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_profile_heads_scope_patient_uidx` ON `patient_profile_heads` (`organization_id`,`facility_id`,`patient_id`);--> statement-breakpoint
CREATE TABLE `patient_profile_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`version` integer NOT NULL,
	`display_name` text NOT NULL,
	`birth_date` text,
	`sex_at_birth` text DEFAULT 'not_recorded' NOT NULL,
	`phone` text,
	`email` text,
	`address` text,
	`status` text DEFAULT 'active' NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`change_reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_profile_versions_version_positive" CHECK("patient_profile_versions"."version" > 0),
	CONSTRAINT "patient_profile_versions_sex_at_birth_enum" CHECK("patient_profile_versions"."sex_at_birth" in ('female', 'male', 'unknown', 'not_recorded')),
	CONSTRAINT "patient_profile_versions_status_enum" CHECK("patient_profile_versions"."status" in ('active', 'inactive', 'merged'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_profile_versions_scope_patient_version_uidx` ON `patient_profile_versions` (`organization_id`,`facility_id`,`patient_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_profile_versions_scope_id_uidx` ON `patient_profile_versions` (`organization_id`,`facility_id`,`patient_id`,`id`);