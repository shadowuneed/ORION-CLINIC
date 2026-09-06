CREATE TABLE `department_access_assignment_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`department_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `department_access_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `department_access_assignment_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`assignment_id`,`department_id`,`membership_id`) REFERENCES `department_access_assignments`(`organization_id`,`facility_id`,`id`,`department_id`,`membership_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`assignment_id`,`department_id`,`membership_id`,`current_version_id`) REFERENCES `department_access_assignment_versions`(`organization_id`,`facility_id`,`assignment_id`,`department_id`,`membership_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_access_assignment_heads_lock_positive" CHECK("department_access_assignment_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_access_assignment_heads_scope_assignment_uidx` ON `department_access_assignment_heads` (`organization_id`,`facility_id`,`assignment_id`);--> statement-breakpoint
CREATE INDEX `department_access_assignment_heads_member_idx` ON `department_access_assignment_heads` (`organization_id`,`facility_id`,`membership_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `department_access_assignment_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`assignment_id` text NOT NULL,
	`department_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`status` text NOT NULL,
	`source_type` text NOT NULL,
	`roles_json` text NOT NULL,
	`allow_permissions_json` text DEFAULT '[]' NOT NULL,
	`deny_permissions_json` text DEFAULT '[]' NOT NULL,
	`effective_from` integer NOT NULL,
	`effective_until` integer,
	`change_reason` text NOT NULL,
	`changed_by_membership_id` text NOT NULL,
	`changed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`assignment_id`) REFERENCES `department_access_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `department_access_assignment_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`assignment_id`,`department_id`,`membership_id`) REFERENCES `department_access_assignments`(`organization_id`,`facility_id`,`id`,`department_id`,`membership_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`changed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_access_assignment_versions_status_enum" CHECK("department_access_assignment_versions"."status" in ('active', 'revoked')),
	CONSTRAINT "department_access_assignment_versions_source_enum" CHECK("department_access_assignment_versions"."source_type" in ('bootstrap', 'administrator')),
	CONSTRAINT "department_access_assignment_versions_version_positive" CHECK("department_access_assignment_versions"."version" > 0),
	CONSTRAINT "department_access_assignment_versions_predecessor" CHECK(("department_access_assignment_versions"."version" = 1 and "department_access_assignment_versions"."supersedes_version_id" is null) or ("department_access_assignment_versions"."version" > 1 and "department_access_assignment_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "department_access_assignment_versions_roles_json" CHECK(json_valid("department_access_assignment_versions"."roles_json") and json_type("department_access_assignment_versions"."roles_json") = 'array' and json_array_length("department_access_assignment_versions"."roles_json") > 0),
	CONSTRAINT "department_access_assignment_versions_allow_json" CHECK(json_valid("department_access_assignment_versions"."allow_permissions_json") and json_type("department_access_assignment_versions"."allow_permissions_json") = 'array'),
	CONSTRAINT "department_access_assignment_versions_deny_json" CHECK(json_valid("department_access_assignment_versions"."deny_permissions_json") and json_type("department_access_assignment_versions"."deny_permissions_json") = 'array'),
	CONSTRAINT "department_access_assignment_versions_effective_range" CHECK("department_access_assignment_versions"."effective_until" is null or "department_access_assignment_versions"."effective_until" > "department_access_assignment_versions"."effective_from"),
	CONSTRAINT "department_access_assignment_versions_reason_length" CHECK(length(trim("department_access_assignment_versions"."change_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_access_assignment_versions_scope_version_uidx` ON `department_access_assignment_versions` (`organization_id`,`facility_id`,`assignment_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_access_assignment_versions_scope_id_uidx` ON `department_access_assignment_versions` (`organization_id`,`facility_id`,`assignment_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_access_assignment_versions_scope_identity_uidx` ON `department_access_assignment_versions` (`organization_id`,`facility_id`,`assignment_id`,`department_id`,`membership_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_access_assignment_versions_supersedes_once_uidx` ON `department_access_assignment_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE INDEX `department_access_assignment_versions_effective_idx` ON `department_access_assignment_versions` (`organization_id`,`facility_id`,`membership_id`,`status`,`effective_from`,`effective_until`);--> statement-breakpoint
CREATE TABLE `department_access_assignments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`department_id` text NOT NULL,
	`membership_id` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`department_id`) REFERENCES `departments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_access_assignments_scope_id_uidx` ON `department_access_assignments` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_access_assignments_scope_identity_uidx` ON `department_access_assignments` (`organization_id`,`facility_id`,`id`,`department_id`,`membership_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_access_assignments_member_department_uidx` ON `department_access_assignments` (`organization_id`,`facility_id`,`department_id`,`membership_id`);--> statement-breakpoint
CREATE INDEX `department_access_assignments_member_idx` ON `department_access_assignments` (`organization_id`,`facility_id`,`membership_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `departments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`code` text NOT NULL,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "departments_kind_enum" CHECK("departments"."kind" in ('clinical', 'diagnostic', 'administrative', 'support')),
	CONSTRAINT "departments_status_enum" CHECK("departments"."status" in ('active', 'disabled')),
	CONSTRAINT "departments_code_format" CHECK(length(trim("departments"."code")) between 2 and 40 and "departments"."code" = lower("departments"."code") and "departments"."code" not glob '*[^a-z0-9_-]*'),
	CONSTRAINT "departments_name_length" CHECK(length(trim("departments"."name")) between 2 and 160),
	CONSTRAINT "departments_version_positive" CHECK("departments"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `departments_scope_id_uidx` ON `departments` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `departments_scope_code_uidx` ON `departments` (`organization_id`,`facility_id`,`code`);--> statement-breakpoint
CREATE INDEX `departments_scope_status_idx` ON `departments` (`organization_id`,`facility_id`,`status`,`name`);--> statement-breakpoint
CREATE TRIGGER department_access_assignments_insert_guard
BEFORE INSERT ON department_access_assignments
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM departments department
    WHERE department.organization_id = NEW.organization_id
      AND department.facility_id = NEW.facility_id
      AND department.id = NEW.department_id
      AND department.status = 'active'
  ) THEN RAISE(ABORT, 'access assignment department must be active in scope') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM memberships membership
    JOIN users user ON user.id = membership.user_id
    WHERE membership.organization_id = NEW.organization_id
      AND membership.facility_id = NEW.facility_id
      AND membership.id = NEW.membership_id
      AND membership.status = 'active'
      AND user.status = 'active'
  ) THEN RAISE(ABORT, 'access assignment member must be active in scope') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM memberships membership
    JOIN users user ON user.id = membership.user_id
    WHERE membership.organization_id = NEW.organization_id
      AND membership.facility_id = NEW.facility_id
      AND membership.id = NEW.created_by_membership_id
      AND membership.status = 'active'
      AND user.status = 'active'
  ) THEN RAISE(ABORT, 'access assignment creator must be active in scope') END;
END;
--> statement-breakpoint
CREATE TRIGGER department_access_assignments_no_update
BEFORE UPDATE ON department_access_assignments
BEGIN
  SELECT RAISE(ABORT, 'access assignments are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER department_access_assignments_no_delete
BEFORE DELETE ON department_access_assignments
BEGIN
  SELECT RAISE(ABORT, 'access assignments are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER department_access_assignment_versions_insert_guard
BEFORE INSERT ON department_access_assignment_versions
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM department_access_assignments assignment
    WHERE assignment.organization_id = NEW.organization_id
      AND assignment.facility_id = NEW.facility_id
      AND assignment.id = NEW.assignment_id
      AND assignment.department_id = NEW.department_id
      AND assignment.membership_id = NEW.membership_id
  ) THEN RAISE(ABORT, 'access assignment version scope mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM memberships membership
    JOIN users user ON user.id = membership.user_id
    WHERE membership.organization_id = NEW.organization_id
      AND membership.facility_id = NEW.facility_id
      AND membership.id = NEW.changed_by_membership_id
      AND membership.status = 'active'
      AND user.status = 'active'
  ) THEN RAISE(ABORT, 'access assignment actor must be active in scope') END;
  SELECT CASE WHEN NEW.source_type = 'administrator' AND NOT EXISTS (
    SELECT 1
    FROM memberships membership
    WHERE membership.organization_id = NEW.organization_id
      AND membership.facility_id = NEW.facility_id
      AND membership.id = NEW.changed_by_membership_id
      AND membership.role = 'administrator'
      AND membership.status = 'active'
  ) THEN RAISE(ABORT, 'administrator source requires an active administrator') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.roles_json)
    WHERE type <> 'text'
      OR value NOT IN (
        'doctor', 'nurse', 'registrar', 'administrator',
        'medical_lead', 'auditor', 'service'
      )
  ) THEN RAISE(ABORT, 'access assignment contains an unknown role') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.roles_json)
    GROUP BY value HAVING count(*) > 1
  ) THEN RAISE(ABORT, 'access assignment contains duplicate roles') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.roles_json) WHERE value = 'service'
  ) AND json_array_length(NEW.roles_json) <> 1
    THEN RAISE(ABORT, 'service role cannot be combined with interactive roles') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.allow_permissions_json)
    WHERE type <> 'text'
      OR value NOT IN (
        'clinic.dashboard.read', 'patient.directory.read',
        'patient.profile.write', 'encounter.read', 'encounter.manage',
        'orders.manage', 'scheduling.manage', 'care.manage',
        'observations.manage', 'communications.manage', 'access.self.read',
        'access.manage', 'audit.read', 'clinical_policy.review',
        'service.integration.execute'
      )
  ) THEN RAISE(ABORT, 'access assignment contains an unknown allow permission') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.allow_permissions_json)
    GROUP BY value HAVING count(*) > 1
  ) THEN RAISE(ABORT, 'access assignment contains duplicate allow permissions') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.deny_permissions_json)
    WHERE type <> 'text'
      OR value NOT IN (
        'clinic.dashboard.read', 'patient.directory.read',
        'patient.profile.write', 'encounter.read', 'encounter.manage',
        'orders.manage', 'scheduling.manage', 'care.manage',
        'observations.manage', 'communications.manage', 'access.self.read',
        'access.manage', 'audit.read', 'clinical_policy.review',
        'service.integration.execute'
      )
  ) THEN RAISE(ABORT, 'access assignment contains an unknown deny permission') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.deny_permissions_json)
    GROUP BY value HAVING count(*) > 1
  ) THEN RAISE(ABORT, 'access assignment contains duplicate deny permissions') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.allow_permissions_json) allow_permission
    JOIN json_each(NEW.deny_permissions_json) deny_permission
      ON deny_permission.value = allow_permission.value
  ) THEN RAISE(ABORT, 'access assignment allow and deny permissions overlap') END;
  SELECT CASE WHEN NEW.version = 1 AND EXISTS (
    SELECT 1
    FROM department_access_assignment_heads head
    WHERE head.organization_id = NEW.organization_id
      AND head.facility_id = NEW.facility_id
      AND head.assignment_id = NEW.assignment_id
  ) THEN RAISE(ABORT, 'access assignment initial version already has a head') END;
  SELECT CASE WHEN NEW.version > 1 AND NOT EXISTS (
    SELECT 1
    FROM department_access_assignment_heads head
    JOIN department_access_assignment_versions previous
      ON previous.organization_id = head.organization_id
      AND previous.facility_id = head.facility_id
      AND previous.assignment_id = head.assignment_id
      AND previous.department_id = head.department_id
      AND previous.membership_id = head.membership_id
      AND previous.id = head.current_version_id
    WHERE head.organization_id = NEW.organization_id
      AND head.facility_id = NEW.facility_id
      AND head.assignment_id = NEW.assignment_id
      AND head.department_id = NEW.department_id
      AND head.membership_id = NEW.membership_id
      AND previous.id = NEW.supersedes_version_id
      AND previous.version + 1 = NEW.version
  ) THEN RAISE(ABORT, 'access assignment version must extend the current head') END;
END;
--> statement-breakpoint
CREATE TRIGGER department_access_assignment_versions_no_update
BEFORE UPDATE ON department_access_assignment_versions
BEGIN
  SELECT RAISE(ABORT, 'access assignment versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER department_access_assignment_versions_no_delete
BEFORE DELETE ON department_access_assignment_versions
BEGIN
  SELECT RAISE(ABORT, 'access assignment versions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER department_access_assignment_heads_insert_guard
BEFORE INSERT ON department_access_assignment_heads
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM department_access_assignments assignment
    JOIN department_access_assignment_versions current
      ON current.organization_id = assignment.organization_id
      AND current.facility_id = assignment.facility_id
      AND current.assignment_id = assignment.id
      AND current.department_id = assignment.department_id
      AND current.membership_id = assignment.membership_id
    WHERE assignment.organization_id = NEW.organization_id
      AND assignment.facility_id = NEW.facility_id
      AND assignment.id = NEW.assignment_id
      AND assignment.department_id = NEW.department_id
      AND assignment.membership_id = NEW.membership_id
      AND current.id = NEW.current_version_id
      AND current.version = 1
      AND current.supersedes_version_id IS NULL
      AND NEW.lock_version = 1
  ) THEN RAISE(ABORT, 'access assignment head must start at version 1') END;
END;
--> statement-breakpoint
CREATE TRIGGER department_access_assignment_heads_advance_guard
BEFORE UPDATE ON department_access_assignment_heads
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.facility_id <> OLD.facility_id
    OR NEW.assignment_id <> OLD.assignment_id
    OR NEW.department_id <> OLD.department_id
    OR NEW.membership_id <> OLD.membership_id
    OR NEW.created_at <> OLD.created_at
    OR NEW.current_version_id = OLD.current_version_id
    OR NEW.lock_version <> OLD.lock_version + 1
    OR NEW.updated_at < OLD.updated_at
    THEN RAISE(ABORT, 'access assignment head identity or lock is invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM department_access_assignment_versions next
    JOIN department_access_assignment_versions previous
      ON previous.organization_id = next.organization_id
      AND previous.facility_id = next.facility_id
      AND previous.assignment_id = next.assignment_id
      AND previous.department_id = next.department_id
      AND previous.membership_id = next.membership_id
      AND previous.id = next.supersedes_version_id
    WHERE next.organization_id = NEW.organization_id
      AND next.facility_id = NEW.facility_id
      AND next.assignment_id = NEW.assignment_id
      AND next.department_id = NEW.department_id
      AND next.membership_id = NEW.membership_id
      AND next.id = NEW.current_version_id
      AND previous.id = OLD.current_version_id
      AND next.version = previous.version + 1
  ) THEN RAISE(ABORT, 'access assignment head must advance to the direct successor') END;
END;
--> statement-breakpoint
CREATE TRIGGER department_access_assignment_heads_no_delete
BEFORE DELETE ON department_access_assignment_heads
BEGIN
  SELECT RAISE(ABORT, 'access assignment heads cannot be deleted');
END;
