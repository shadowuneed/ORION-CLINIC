CREATE TABLE `chronic_care_plan_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`care_plan_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`care_plan_id`) REFERENCES `chronic_care_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `chronic_care_plan_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`care_plan_id`) REFERENCES `chronic_care_plans`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`care_plan_id`,`current_version_id`) REFERENCES `chronic_care_plan_versions`(`organization_id`,`facility_id`,`care_plan_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chronic_care_plan_heads_lock_positive" CHECK("chronic_care_plan_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_plan_heads_scope_plan_uidx` ON `chronic_care_plan_heads` (`organization_id`,`facility_id`,`care_plan_id`);--> statement-breakpoint
CREATE TABLE `chronic_care_plan_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`care_plan_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`enrollment_version_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`effective_from` text NOT NULL,
	`effective_to` text NOT NULL,
	`goals_json` text NOT NULL,
	`treatment_plan` text NOT NULL,
	`diet_plan` text NOT NULL,
	`medications_json` text NOT NULL,
	`task_blueprints_json` text NOT NULL,
	`content_hash` text NOT NULL,
	`signed_by_membership_id` text NOT NULL,
	`signed_at` integer NOT NULL,
	`change_reason` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`care_plan_id`) REFERENCES `chronic_care_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_version_id`) REFERENCES `chronic_registry_enrollment_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `chronic_care_plan_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`care_plan_id`) REFERENCES `chronic_care_plans`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`enrollment_id`,`enrollment_version_id`) REFERENCES `chronic_registry_enrollment_versions`(`organization_id`,`facility_id`,`enrollment_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`signed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chronic_care_plan_versions_version_positive" CHECK("chronic_care_plan_versions"."version" > 0),
	CONSTRAINT "chronic_care_plan_versions_predecessor" CHECK(("chronic_care_plan_versions"."version" = 1 and "chronic_care_plan_versions"."supersedes_version_id" is null) or ("chronic_care_plan_versions"."version" > 1 and "chronic_care_plan_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "chronic_care_plan_versions_date_range" CHECK(length("chronic_care_plan_versions"."effective_from") = 10 and date("chronic_care_plan_versions"."effective_from") is not null and length("chronic_care_plan_versions"."effective_to") = 10 and date("chronic_care_plan_versions"."effective_to") is not null and date("chronic_care_plan_versions"."effective_to") >= date("chronic_care_plan_versions"."effective_from")),
	CONSTRAINT "chronic_care_plan_versions_hash" CHECK(length("chronic_care_plan_versions"."content_hash") = 64 and lower("chronic_care_plan_versions"."content_hash") = "chronic_care_plan_versions"."content_hash"),
	CONSTRAINT "chronic_care_plan_versions_reason_length" CHECK(length(trim("chronic_care_plan_versions"."change_reason")) between 3 and 500),
	CONSTRAINT "chronic_care_plan_versions_goals_json" CHECK(json_valid("chronic_care_plan_versions"."goals_json")),
	CONSTRAINT "chronic_care_plan_versions_medications_json" CHECK(json_valid("chronic_care_plan_versions"."medications_json")),
	CONSTRAINT "chronic_care_plan_versions_task_blueprints_json" CHECK(json_valid("chronic_care_plan_versions"."task_blueprints_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_plan_versions_scope_version_uidx` ON `chronic_care_plan_versions` (`organization_id`,`facility_id`,`care_plan_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_plan_versions_scope_id_uidx` ON `chronic_care_plan_versions` (`organization_id`,`facility_id`,`care_plan_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_plan_versions_supersedes_once_uidx` ON `chronic_care_plan_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE TABLE `chronic_care_plans` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_plans_scope_id_uidx` ON `chronic_care_plans` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_plans_enrollment_uidx` ON `chronic_care_plans` (`organization_id`,`facility_id`,`enrollment_id`);--> statement-breakpoint
CREATE TABLE `chronic_care_task_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`task_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `chronic_care_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `chronic_care_task_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`task_id`) REFERENCES `chronic_care_tasks`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`task_id`,`current_version_id`) REFERENCES `chronic_care_task_versions`(`organization_id`,`facility_id`,`task_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chronic_care_task_heads_lock_positive" CHECK("chronic_care_task_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_task_heads_scope_task_uidx` ON `chronic_care_task_heads` (`organization_id`,`facility_id`,`task_id`);--> statement-breakpoint
CREATE TABLE `chronic_care_task_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`task_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`status` text NOT NULL,
	`due_date` text NOT NULL,
	`instructions` text,
	`contact_method` text,
	`wellbeing` text,
	`response_summary` text,
	`responded_at` integer,
	`escalation_reason` text,
	`escalated_at` integer,
	`completed_at` integer,
	`change_reason` text NOT NULL,
	`changed_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`task_id`) REFERENCES `chronic_care_tasks`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `chronic_care_task_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`task_id`) REFERENCES `chronic_care_tasks`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`changed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chronic_care_task_versions_status_enum" CHECK("chronic_care_task_versions"."status" in ('pending', 'in_progress', 'completed', 'escalated', 'cancelled')),
	CONSTRAINT "chronic_care_task_versions_contact_method_enum" CHECK("chronic_care_task_versions"."contact_method" in ('in_person', 'phone', 'digital')),
	CONSTRAINT "chronic_care_task_versions_wellbeing_enum" CHECK("chronic_care_task_versions"."wellbeing" in ('stable', 'concerning', 'urgent')),
	CONSTRAINT "chronic_care_task_versions_version_positive" CHECK("chronic_care_task_versions"."version" > 0),
	CONSTRAINT "chronic_care_task_versions_predecessor" CHECK(("chronic_care_task_versions"."version" = 1 and "chronic_care_task_versions"."supersedes_version_id" is null) or ("chronic_care_task_versions"."version" > 1 and "chronic_care_task_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "chronic_care_task_versions_due_date" CHECK(length("chronic_care_task_versions"."due_date") = 10 and date("chronic_care_task_versions"."due_date") is not null),
	CONSTRAINT "chronic_care_task_versions_response_consistent" CHECK(("chronic_care_task_versions"."contact_method" is null and "chronic_care_task_versions"."wellbeing" is null and "chronic_care_task_versions"."response_summary" is null and "chronic_care_task_versions"."responded_at" is null) or ("chronic_care_task_versions"."contact_method" is not null and "chronic_care_task_versions"."wellbeing" is not null and length(trim("chronic_care_task_versions"."response_summary")) between 3 and 2000 and "chronic_care_task_versions"."responded_at" is not null)),
	CONSTRAINT "chronic_care_task_versions_escalation_consistent" CHECK(("chronic_care_task_versions"."escalation_reason" is null and "chronic_care_task_versions"."escalated_at" is null and "chronic_care_task_versions"."status" <> 'escalated') or ("chronic_care_task_versions"."escalation_reason" is not null and "chronic_care_task_versions"."escalated_at" is not null)),
	CONSTRAINT "chronic_care_task_versions_completion_consistent" CHECK(("chronic_care_task_versions"."status" = 'completed' and "chronic_care_task_versions"."completed_at" is not null) or ("chronic_care_task_versions"."status" <> 'completed' and "chronic_care_task_versions"."completed_at" is null)),
	CONSTRAINT "chronic_care_task_versions_reason_length" CHECK(length(trim("chronic_care_task_versions"."change_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_task_versions_scope_version_uidx` ON `chronic_care_task_versions` (`organization_id`,`facility_id`,`task_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_task_versions_scope_id_uidx` ON `chronic_care_task_versions` (`organization_id`,`facility_id`,`task_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_task_versions_supersedes_once_uidx` ON `chronic_care_task_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE TABLE `chronic_care_tasks` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`care_plan_id` text NOT NULL,
	`source_plan_version_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`blueprint_key` text NOT NULL,
	`kind` text NOT NULL,
	`title` text NOT NULL,
	`owner_role` text NOT NULL,
	`assigned_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`care_plan_id`) REFERENCES `chronic_care_plans`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`source_plan_version_id`) REFERENCES `chronic_care_plan_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assigned_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`care_plan_id`,`source_plan_version_id`) REFERENCES `chronic_care_plan_versions`(`organization_id`,`facility_id`,`care_plan_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`assigned_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chronic_care_tasks_kind_enum" CHECK("chronic_care_tasks"."kind" in ('nurse_contact', 'follow_up_visit', 'control_test', 'medication_review')),
	CONSTRAINT "chronic_care_tasks_owner_role_enum" CHECK("chronic_care_tasks"."owner_role" in ('clinician', 'nurse')),
	CONSTRAINT "chronic_care_tasks_blueprint_key_length" CHECK(length(trim("chronic_care_tasks"."blueprint_key")) between 2 and 80),
	CONSTRAINT "chronic_care_tasks_title_length" CHECK(length(trim("chronic_care_tasks"."title")) between 3 and 240)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_tasks_scope_id_uidx` ON `chronic_care_tasks` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_care_tasks_plan_blueprint_uidx` ON `chronic_care_tasks` (`organization_id`,`facility_id`,`source_plan_version_id`,`blueprint_key`);--> statement-breakpoint
CREATE INDEX `chronic_care_tasks_assignee_idx` ON `chronic_care_tasks` (`organization_id`,`facility_id`,`assigned_membership_id`);--> statement-breakpoint
CREATE TABLE `chronic_registry_enrollment_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `chronic_registry_enrollment_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`enrollment_id`,`current_version_id`) REFERENCES `chronic_registry_enrollment_versions`(`organization_id`,`facility_id`,`enrollment_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chronic_enrollment_heads_lock_positive" CHECK("chronic_registry_enrollment_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_enrollment_heads_scope_enrollment_uidx` ON `chronic_registry_enrollment_heads` (`organization_id`,`facility_id`,`enrollment_id`);--> statement-breakpoint
CREATE TABLE `chronic_registry_enrollment_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`enrollment_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`status` text NOT NULL,
	`basis_encounter_id` text NOT NULL,
	`basis_protocol_version_id` text NOT NULL,
	`diagnosis_display` text NOT NULL,
	`diagnosis_code` text,
	`diagnosis_basis` text NOT NULL,
	`decision_reason` text NOT NULL,
	`decided_by_membership_id` text NOT NULL,
	`decided_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `chronic_registry_enrollment_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`basis_encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`basis_protocol_version_id`) REFERENCES `protocol_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`decided_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`enrollment_id`) REFERENCES `chronic_registry_enrollments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`basis_encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`basis_encounter_id`,`basis_protocol_version_id`) REFERENCES `protocol_versions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`decided_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chronic_enrollment_versions_status_enum" CHECK("chronic_registry_enrollment_versions"."status" in ('active', 'paused', 'closed')),
	CONSTRAINT "chronic_enrollment_versions_version_positive" CHECK("chronic_registry_enrollment_versions"."version" > 0),
	CONSTRAINT "chronic_enrollment_versions_predecessor" CHECK(("chronic_registry_enrollment_versions"."version" = 1 and "chronic_registry_enrollment_versions"."supersedes_version_id" is null) or ("chronic_registry_enrollment_versions"."version" > 1 and "chronic_registry_enrollment_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "chronic_enrollment_versions_diagnosis_length" CHECK(length(trim("chronic_registry_enrollment_versions"."diagnosis_display")) between 3 and 500),
	CONSTRAINT "chronic_enrollment_versions_basis_length" CHECK(length(trim("chronic_registry_enrollment_versions"."diagnosis_basis")) between 10 and 3000),
	CONSTRAINT "chronic_enrollment_versions_reason_length" CHECK(length(trim("chronic_registry_enrollment_versions"."decision_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_enrollment_versions_scope_version_uidx` ON `chronic_registry_enrollment_versions` (`organization_id`,`facility_id`,`enrollment_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_enrollment_versions_scope_id_uidx` ON `chronic_registry_enrollment_versions` (`organization_id`,`facility_id`,`enrollment_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_enrollment_versions_supersedes_once_uidx` ON `chronic_registry_enrollment_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE TABLE `chronic_registry_enrollments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`registry_code` text NOT NULL,
	`source_type` text NOT NULL,
	`source_label` text NOT NULL,
	`managing_clinician_membership_id` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`managing_clinician_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`managing_clinician_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "chronic_enrollments_source_type_enum" CHECK("chronic_registry_enrollments"."source_type" in ('local_test')),
	CONSTRAINT "chronic_enrollments_registry_code_length" CHECK(length(trim("chronic_registry_enrollments"."registry_code")) between 2 and 80)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_enrollments_scope_id_uidx` ON `chronic_registry_enrollments` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `chronic_enrollments_patient_registry_uidx` ON `chronic_registry_enrollments` (`organization_id`,`facility_id`,`patient_id`,`registry_code`);
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollments_local_source_only`
BEFORE INSERT ON `chronic_registry_enrollments`
WHEN NEW.`source_type` <> 'local_test'
  OR NEW.`source_label` <> 'Локальное тестовое наблюдение · не ЭРДБ/ПУЗ'
BEGIN
  SELECT RAISE(ABORT, 'only labelled local test chronic registry is enabled');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollments_require_active_clinician_and_patient`
BEFORE INSERT ON `chronic_registry_enrollments`
WHEN NEW.`managing_clinician_membership_id` <> NEW.`created_by_membership_id`
  OR NOT EXISTS (
    SELECT 1 FROM `patients` patient
    WHERE patient.`organization_id` = NEW.`organization_id`
      AND patient.`facility_id` = NEW.`facility_id`
      AND patient.`id` = NEW.`patient_id`
      AND patient.`status` = 'active'
  )
  OR NOT EXISTS (
    SELECT 1 FROM `memberships` membership
    WHERE membership.`organization_id` = NEW.`organization_id`
      AND membership.`facility_id` = NEW.`facility_id`
      AND membership.`id` = NEW.`managing_clinician_membership_id`
      AND membership.`role` = 'clinician'
      AND membership.`status` = 'active'
  )
BEGIN
  SELECT RAISE(ABORT, 'chronic enrollment requires active patient and managing clinician');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollment_versions_require_current_signed_basis`
BEFORE INSERT ON `chronic_registry_enrollment_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `chronic_registry_enrollments` enrollment
  JOIN `encounters` encounter
    ON encounter.`organization_id` = enrollment.`organization_id`
    AND encounter.`facility_id` = enrollment.`facility_id`
    AND encounter.`id` = NEW.`basis_encounter_id`
    AND encounter.`patient_id` = enrollment.`patient_id`
    AND encounter.`clinician_membership_id` = enrollment.`managing_clinician_membership_id`
  JOIN `protocol_heads` protocol_head
    ON protocol_head.`organization_id` = encounter.`organization_id`
    AND protocol_head.`facility_id` = encounter.`facility_id`
    AND protocol_head.`encounter_id` = encounter.`id`
    AND protocol_head.`current_signed_protocol_version_id` = NEW.`basis_protocol_version_id`
  JOIN `protocol_versions` protocol_version
    ON protocol_version.`organization_id` = protocol_head.`organization_id`
    AND protocol_version.`facility_id` = protocol_head.`facility_id`
    AND protocol_version.`encounter_id` = protocol_head.`encounter_id`
    AND protocol_version.`id` = protocol_head.`current_signed_protocol_version_id`
    AND protocol_version.`status` = 'signed'
    AND protocol_version.`signed_by_membership_id` = enrollment.`managing_clinician_membership_id`
  JOIN `memberships` decider
    ON decider.`organization_id` = enrollment.`organization_id`
    AND decider.`facility_id` = enrollment.`facility_id`
    AND decider.`id` = NEW.`decided_by_membership_id`
    AND decider.`id` = enrollment.`managing_clinician_membership_id`
    AND decider.`role` = 'clinician'
    AND decider.`status` = 'active'
  WHERE enrollment.`organization_id` = NEW.`organization_id`
    AND enrollment.`facility_id` = NEW.`facility_id`
    AND enrollment.`id` = NEW.`enrollment_id`
)
BEGIN
  SELECT RAISE(ABORT, 'chronic enrollment decision requires current signed protocol and managing clinician');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollment_versions_extend_current_head`
BEFORE INSERT ON `chronic_registry_enrollment_versions`
WHEN (
    NEW.`version` = 1
    AND (
      NEW.`status` <> 'active'
      OR NEW.`supersedes_version_id` IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM `chronic_registry_enrollment_heads` head
        WHERE head.`organization_id` = NEW.`organization_id`
          AND head.`facility_id` = NEW.`facility_id`
          AND head.`enrollment_id` = NEW.`enrollment_id`
      )
    )
  )
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `chronic_registry_enrollment_heads` head
      JOIN `chronic_registry_enrollment_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`enrollment_id` = head.`enrollment_id`
        AND previous.`id` = head.`current_version_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`enrollment_id` = NEW.`enrollment_id`
        AND previous.`id` = NEW.`supersedes_version_id`
        AND previous.`version` + 1 = NEW.`version`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'chronic enrollment version must extend current head');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollment_heads_start_at_one`
BEFORE INSERT ON `chronic_registry_enrollment_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `chronic_registry_enrollment_versions` version
  WHERE version.`organization_id` = NEW.`organization_id`
    AND version.`facility_id` = NEW.`facility_id`
    AND version.`enrollment_id` = NEW.`enrollment_id`
    AND version.`id` = NEW.`current_version_id`
    AND version.`version` = 1
    AND version.`status` = 'active'
)
BEGIN
  SELECT RAISE(ABORT, 'chronic enrollment head must start at active version one');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollment_heads_advance_only`
BEFORE UPDATE ON `chronic_registry_enrollment_heads`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`enrollment_id` IS NOT OLD.`enrollment_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `chronic_registry_enrollment_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`enrollment_id` = NEW.`enrollment_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'chronic enrollment head must advance by one version');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plans_require_current_active_enrollment`
BEFORE INSERT ON `chronic_care_plans`
WHEN NOT EXISTS (
  SELECT 1
  FROM `chronic_registry_enrollments` enrollment
  JOIN `chronic_registry_enrollment_heads` head
    ON head.`organization_id` = enrollment.`organization_id`
    AND head.`facility_id` = enrollment.`facility_id`
    AND head.`enrollment_id` = enrollment.`id`
  JOIN `chronic_registry_enrollment_versions` version
    ON version.`organization_id` = head.`organization_id`
    AND version.`facility_id` = head.`facility_id`
    AND version.`enrollment_id` = head.`enrollment_id`
    AND version.`id` = head.`current_version_id`
    AND version.`status` = 'active'
  WHERE enrollment.`organization_id` = NEW.`organization_id`
    AND enrollment.`facility_id` = NEW.`facility_id`
    AND enrollment.`id` = NEW.`enrollment_id`
    AND enrollment.`patient_id` = NEW.`patient_id`
    AND enrollment.`managing_clinician_membership_id` = NEW.`created_by_membership_id`
)
BEGIN
  SELECT RAISE(ABORT, 'care plan requires current active enrollment and managing clinician');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plan_versions_require_current_enrollment_and_signer`
BEFORE INSERT ON `chronic_care_plan_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `chronic_care_plans` plan
  JOIN `chronic_registry_enrollments` enrollment
    ON enrollment.`organization_id` = plan.`organization_id`
    AND enrollment.`facility_id` = plan.`facility_id`
    AND enrollment.`id` = plan.`enrollment_id`
    AND enrollment.`id` = NEW.`enrollment_id`
  JOIN `chronic_registry_enrollment_heads` enrollment_head
    ON enrollment_head.`organization_id` = enrollment.`organization_id`
    AND enrollment_head.`facility_id` = enrollment.`facility_id`
    AND enrollment_head.`enrollment_id` = enrollment.`id`
    AND enrollment_head.`current_version_id` = NEW.`enrollment_version_id`
  JOIN `chronic_registry_enrollment_versions` enrollment_version
    ON enrollment_version.`organization_id` = enrollment_head.`organization_id`
    AND enrollment_version.`facility_id` = enrollment_head.`facility_id`
    AND enrollment_version.`enrollment_id` = enrollment_head.`enrollment_id`
    AND enrollment_version.`id` = enrollment_head.`current_version_id`
    AND enrollment_version.`status` = 'active'
  JOIN `memberships` signer
    ON signer.`organization_id` = enrollment.`organization_id`
    AND signer.`facility_id` = enrollment.`facility_id`
    AND signer.`id` = NEW.`signed_by_membership_id`
    AND signer.`id` = enrollment.`managing_clinician_membership_id`
    AND signer.`role` = 'clinician'
    AND signer.`status` = 'active'
  WHERE plan.`organization_id` = NEW.`organization_id`
    AND plan.`facility_id` = NEW.`facility_id`
    AND plan.`id` = NEW.`care_plan_id`
)
BEGIN
  SELECT RAISE(ABORT, 'care plan version requires current enrollment and managing clinician signature');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plan_versions_extend_current_head`
BEFORE INSERT ON `chronic_care_plan_versions`
WHEN (
    NEW.`version` = 1
    AND (
      NEW.`supersedes_version_id` IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM `chronic_care_plan_heads` head
        WHERE head.`organization_id` = NEW.`organization_id`
          AND head.`facility_id` = NEW.`facility_id`
          AND head.`care_plan_id` = NEW.`care_plan_id`
      )
    )
  )
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `chronic_care_plan_heads` head
      JOIN `chronic_care_plan_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`care_plan_id` = head.`care_plan_id`
        AND previous.`id` = head.`current_version_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`care_plan_id` = NEW.`care_plan_id`
        AND previous.`id` = NEW.`supersedes_version_id`
        AND previous.`version` + 1 = NEW.`version`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'care plan version must extend current head');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plan_heads_start_at_one`
BEFORE INSERT ON `chronic_care_plan_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `chronic_care_plan_versions` version
  WHERE version.`organization_id` = NEW.`organization_id`
    AND version.`facility_id` = NEW.`facility_id`
    AND version.`care_plan_id` = NEW.`care_plan_id`
    AND version.`id` = NEW.`current_version_id`
    AND version.`version` = 1
)
BEGIN
  SELECT RAISE(ABORT, 'care plan head must start at version one');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plan_heads_advance_only`
BEFORE UPDATE ON `chronic_care_plan_heads`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`care_plan_id` IS NOT OLD.`care_plan_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `chronic_care_plan_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`care_plan_id` = NEW.`care_plan_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'care plan head must advance by one version');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_tasks_require_current_signed_plan_blueprint`
BEFORE INSERT ON `chronic_care_tasks`
WHEN NOT EXISTS (
  SELECT 1
  FROM `chronic_care_plans` plan
  JOIN `chronic_care_plan_heads` plan_head
    ON plan_head.`organization_id` = plan.`organization_id`
    AND plan_head.`facility_id` = plan.`facility_id`
    AND plan_head.`care_plan_id` = plan.`id`
    AND plan_head.`current_version_id` = NEW.`source_plan_version_id`
  JOIN `chronic_care_plan_versions` plan_version
    ON plan_version.`organization_id` = plan_head.`organization_id`
    AND plan_version.`facility_id` = plan_head.`facility_id`
    AND plan_version.`care_plan_id` = plan_head.`care_plan_id`
    AND plan_version.`id` = plan_head.`current_version_id`
  JOIN `chronic_registry_enrollments` enrollment
    ON enrollment.`organization_id` = plan.`organization_id`
    AND enrollment.`facility_id` = plan.`facility_id`
    AND enrollment.`id` = plan.`enrollment_id`
  JOIN `chronic_registry_enrollment_heads` enrollment_head
    ON enrollment_head.`organization_id` = enrollment.`organization_id`
    AND enrollment_head.`facility_id` = enrollment.`facility_id`
    AND enrollment_head.`enrollment_id` = enrollment.`id`
  JOIN `chronic_registry_enrollment_versions` enrollment_version
    ON enrollment_version.`organization_id` = enrollment_head.`organization_id`
    AND enrollment_version.`facility_id` = enrollment_head.`facility_id`
    AND enrollment_version.`enrollment_id` = enrollment_head.`enrollment_id`
    AND enrollment_version.`id` = enrollment_head.`current_version_id`
    AND enrollment_version.`status` = 'active'
  JOIN `memberships` assignee
    ON assignee.`organization_id` = plan.`organization_id`
    AND assignee.`facility_id` = plan.`facility_id`
    AND assignee.`id` = NEW.`assigned_membership_id`
    AND assignee.`role` = NEW.`owner_role`
    AND assignee.`status` = 'active'
  JOIN json_each(plan_version.`task_blueprints_json`) blueprint
    ON json_extract(blueprint.value, '$.key') = NEW.`blueprint_key`
    AND json_extract(blueprint.value, '$.kind') = NEW.`kind`
    AND json_extract(blueprint.value, '$.title') = NEW.`title`
    AND json_extract(blueprint.value, '$.ownerRole') = NEW.`owner_role`
    AND json_extract(blueprint.value, '$.assignedMembershipId') = NEW.`assigned_membership_id`
  WHERE plan.`organization_id` = NEW.`organization_id`
    AND plan.`facility_id` = NEW.`facility_id`
    AND plan.`id` = NEW.`care_plan_id`
    AND plan.`enrollment_id` = NEW.`enrollment_id`
    AND plan.`patient_id` = NEW.`patient_id`
    AND (NEW.`owner_role` <> 'clinician'
      OR NEW.`assigned_membership_id` = enrollment.`managing_clinician_membership_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'chronic task must derive from current signed plan blueprint');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_versions_require_blueprint_and_actor`
BEFORE INSERT ON `chronic_care_task_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `chronic_care_tasks` task
  JOIN `chronic_care_plan_versions` plan_version
    ON plan_version.`organization_id` = task.`organization_id`
    AND plan_version.`facility_id` = task.`facility_id`
    AND plan_version.`care_plan_id` = task.`care_plan_id`
    AND plan_version.`id` = task.`source_plan_version_id`
  JOIN `chronic_registry_enrollments` enrollment
    ON enrollment.`organization_id` = task.`organization_id`
    AND enrollment.`facility_id` = task.`facility_id`
    AND enrollment.`id` = task.`enrollment_id`
  JOIN `memberships` actor
    ON actor.`organization_id` = task.`organization_id`
    AND actor.`facility_id` = task.`facility_id`
    AND actor.`id` = NEW.`changed_by_membership_id`
    AND actor.`status` = 'active'
  JOIN json_each(plan_version.`task_blueprints_json`) blueprint
    ON json_extract(blueprint.value, '$.key') = task.`blueprint_key`
    AND json_extract(blueprint.value, '$.dueDate') = NEW.`due_date`
    AND coalesce(json_extract(blueprint.value, '$.instructions'), '') = coalesce(NEW.`instructions`, '')
  WHERE task.`organization_id` = NEW.`organization_id`
    AND task.`facility_id` = NEW.`facility_id`
    AND task.`id` = NEW.`task_id`
    AND (actor.`id` = task.`assigned_membership_id`
      OR actor.`id` = enrollment.`managing_clinician_membership_id`)
    AND (NEW.`status` <> 'cancelled'
      OR actor.`id` = enrollment.`managing_clinician_membership_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'chronic task version must match signed blueprint and authorized actor');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_versions_state_consistency`
BEFORE INSERT ON `chronic_care_task_versions`
WHEN (NEW.`status` = 'escalated'
      AND (NEW.`escalation_reason` IS NULL OR NEW.`escalated_at` IS NULL))
  OR (NEW.`status` NOT IN ('escalated', 'completed')
      AND (NEW.`escalation_reason` IS NOT NULL OR NEW.`escalated_at` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'chronic task escalation fields do not match status');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_versions_extend_current_head`
BEFORE INSERT ON `chronic_care_task_versions`
WHEN (
    NEW.`version` = 1
    AND (
      NEW.`status` <> 'pending'
      OR NEW.`supersedes_version_id` IS NOT NULL
      OR NEW.`contact_method` IS NOT NULL
      OR NEW.`wellbeing` IS NOT NULL
      OR NEW.`response_summary` IS NOT NULL
      OR NEW.`responded_at` IS NOT NULL
      OR NEW.`escalation_reason` IS NOT NULL
      OR NEW.`escalated_at` IS NOT NULL
      OR NEW.`completed_at` IS NOT NULL
      OR EXISTS (
        SELECT 1 FROM `chronic_care_task_heads` head
        WHERE head.`organization_id` = NEW.`organization_id`
          AND head.`facility_id` = NEW.`facility_id`
          AND head.`task_id` = NEW.`task_id`
      )
    )
  )
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `chronic_care_task_heads` head
      JOIN `chronic_care_task_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`task_id` = head.`task_id`
        AND previous.`id` = head.`current_version_id`
      JOIN `chronic_care_tasks` task
        ON task.`organization_id` = head.`organization_id`
        AND task.`facility_id` = head.`facility_id`
        AND task.`id` = head.`task_id`
      JOIN `chronic_registry_enrollments` enrollment
        ON enrollment.`organization_id` = task.`organization_id`
        AND enrollment.`facility_id` = task.`facility_id`
        AND enrollment.`id` = task.`enrollment_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`task_id` = NEW.`task_id`
        AND previous.`id` = NEW.`supersedes_version_id`
        AND previous.`version` + 1 = NEW.`version`
        AND NEW.`due_date` = previous.`due_date`
        AND coalesce(NEW.`instructions`, '') = coalesce(previous.`instructions`, '')
        AND (
          (previous.`status` = 'pending' AND NEW.`status` IN ('in_progress', 'completed', 'escalated', 'cancelled'))
          OR (previous.`status` = 'in_progress' AND NEW.`status` IN ('in_progress', 'completed', 'escalated', 'cancelled'))
          OR (previous.`status` = 'escalated' AND NEW.`status` IN ('completed', 'cancelled')
            AND NEW.`changed_by_membership_id` = enrollment.`managing_clinician_membership_id`)
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'chronic task version must extend current head');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_heads_start_at_one`
BEFORE INSERT ON `chronic_care_task_heads`
WHEN NEW.`lock_version` <> 1 OR NOT EXISTS (
  SELECT 1 FROM `chronic_care_task_versions` version
  WHERE version.`organization_id` = NEW.`organization_id`
    AND version.`facility_id` = NEW.`facility_id`
    AND version.`task_id` = NEW.`task_id`
    AND version.`id` = NEW.`current_version_id`
    AND version.`version` = 1
    AND version.`status` = 'pending'
)
BEGIN
  SELECT RAISE(ABORT, 'chronic task head must start at pending version one');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_heads_advance_only`
BEFORE UPDATE ON `chronic_care_task_heads`
WHEN NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`task_id` IS NOT OLD.`task_id`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `chronic_care_task_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`task_id` = NEW.`task_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'chronic task head must advance by one version');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollments_no_update` BEFORE UPDATE ON `chronic_registry_enrollments`
BEGIN SELECT RAISE(ABORT, 'chronic enrollments are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollment_versions_no_update` BEFORE UPDATE ON `chronic_registry_enrollment_versions`
BEGIN SELECT RAISE(ABORT, 'chronic enrollment versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plans_no_update` BEFORE UPDATE ON `chronic_care_plans`
BEGIN SELECT RAISE(ABORT, 'chronic care plans are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plan_versions_no_update` BEFORE UPDATE ON `chronic_care_plan_versions`
BEGIN SELECT RAISE(ABORT, 'chronic care plan versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_tasks_no_update` BEFORE UPDATE ON `chronic_care_tasks`
BEGIN SELECT RAISE(ABORT, 'chronic care tasks are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_versions_no_update` BEFORE UPDATE ON `chronic_care_task_versions`
BEGIN SELECT RAISE(ABORT, 'chronic care task versions are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollments_no_delete` BEFORE DELETE ON `chronic_registry_enrollments`
BEGIN SELECT RAISE(ABORT, 'chronic enrollments cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollment_versions_no_delete` BEFORE DELETE ON `chronic_registry_enrollment_versions`
BEGIN SELECT RAISE(ABORT, 'chronic enrollment versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_enrollment_heads_no_delete` BEFORE DELETE ON `chronic_registry_enrollment_heads`
BEGIN SELECT RAISE(ABORT, 'chronic enrollment heads cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plans_no_delete` BEFORE DELETE ON `chronic_care_plans`
BEGIN SELECT RAISE(ABORT, 'chronic care plans cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plan_versions_no_delete` BEFORE DELETE ON `chronic_care_plan_versions`
BEGIN SELECT RAISE(ABORT, 'chronic care plan versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plan_heads_no_delete` BEFORE DELETE ON `chronic_care_plan_heads`
BEGIN SELECT RAISE(ABORT, 'chronic care plan heads cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_tasks_no_delete` BEFORE DELETE ON `chronic_care_tasks`
BEGIN SELECT RAISE(ABORT, 'chronic care tasks cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_versions_no_delete` BEFORE DELETE ON `chronic_care_task_versions`
BEGIN SELECT RAISE(ABORT, 'chronic care task versions cannot be deleted'); END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_heads_no_delete` BEFORE DELETE ON `chronic_care_task_heads`
BEGIN SELECT RAISE(ABORT, 'chronic care task heads cannot be deleted'); END;
