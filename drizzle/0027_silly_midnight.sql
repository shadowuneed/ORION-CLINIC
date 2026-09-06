CREATE TABLE `department_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`department_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `department_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`department_id`) REFERENCES `departments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`department_id`,`current_version_id`) REFERENCES `department_versions`(`organization_id`,`facility_id`,`department_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_heads_lock_positive" CHECK("department_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_heads_scope_department_uidx` ON `department_heads` (`organization_id`,`facility_id`,`department_id`);--> statement-breakpoint
CREATE INDEX `department_heads_scope_updated_idx` ON `department_heads` (`organization_id`,`facility_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `department_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`department_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`name` text NOT NULL,
	`kind` text NOT NULL,
	`status` text NOT NULL,
	`change_reason` text NOT NULL,
	`changed_by_membership_id` text NOT NULL,
	`changed_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`department_id`) REFERENCES `departments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `department_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`changed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`department_id`) REFERENCES `departments`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`changed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "department_versions_kind_enum" CHECK("department_versions"."kind" in ('clinical', 'diagnostic', 'administrative', 'support')),
	CONSTRAINT "department_versions_status_enum" CHECK("department_versions"."status" in ('active', 'disabled')),
	CONSTRAINT "department_versions_version_positive" CHECK("department_versions"."version" > 0),
	CONSTRAINT "department_versions_predecessor" CHECK(("department_versions"."version" = 1 and "department_versions"."supersedes_version_id" is null) or ("department_versions"."version" > 1 and "department_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "department_versions_name_length" CHECK(length(trim("department_versions"."name")) between 2 and 160),
	CONSTRAINT "department_versions_reason_length" CHECK(length(trim("department_versions"."change_reason")) between 3 and 500)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `department_versions_scope_version_uidx` ON `department_versions` (`organization_id`,`facility_id`,`department_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_versions_scope_id_uidx` ON `department_versions` (`organization_id`,`facility_id`,`department_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `department_versions_supersedes_once_uidx` ON `department_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE INDEX `department_versions_scope_status_idx` ON `department_versions` (`organization_id`,`facility_id`,`status`,`changed_at`);
--> statement-breakpoint
CREATE TRIGGER departments_insert_guard
BEFORE INSERT ON departments
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.version <> 1 OR NOT EXISTS (
    SELECT 1 FROM facilities facility
    JOIN organizations organization ON organization.id = facility.organization_id
    WHERE facility.organization_id = NEW.organization_id
      AND facility.id = NEW.facility_id
      AND facility.status = 'active'
      AND organization.status = 'active'
  ) THEN RAISE(ABORT, 'department requires an active facility scope') END;
END;
--> statement-breakpoint
CREATE TRIGGER departments_no_update
BEFORE UPDATE ON departments
BEGIN
  SELECT RAISE(ABORT, 'department roots are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER departments_no_delete
BEFORE DELETE ON departments
BEGIN
  SELECT RAISE(ABORT, 'department roots cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER department_versions_insert_guard
BEFORE INSERT ON department_versions
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM departments department
    JOIN memberships actor
      ON actor.organization_id = department.organization_id
      AND actor.facility_id = department.facility_id
      AND actor.id = NEW.changed_by_membership_id
    JOIN users actor_user ON actor_user.id = actor.user_id
    WHERE department.organization_id = NEW.organization_id
      AND department.facility_id = NEW.facility_id
      AND department.id = NEW.department_id
      AND actor.status = 'active'
      AND actor_user.status = 'active'
  ) THEN RAISE(ABORT, 'department version requires an active scoped actor') END;
  SELECT CASE WHEN NEW.version = 1 AND (
    NEW.supersedes_version_id IS NOT NULL
    OR EXISTS (
      SELECT 1 FROM department_versions existing
      WHERE existing.organization_id = NEW.organization_id
        AND existing.facility_id = NEW.facility_id
        AND existing.department_id = NEW.department_id
    )
    OR NOT EXISTS (
      SELECT 1 FROM departments department
      WHERE department.organization_id = NEW.organization_id
        AND department.facility_id = NEW.facility_id
        AND department.id = NEW.department_id
        AND department.name = NEW.name
        AND department.kind = NEW.kind
        AND department.status = NEW.status
    )
  ) THEN RAISE(ABORT, 'department version 1 must match a new root') END;
  SELECT CASE WHEN NEW.version > 1 AND NOT EXISTS (
    SELECT 1
    FROM department_heads head
    JOIN department_versions previous
      ON previous.organization_id = head.organization_id
      AND previous.facility_id = head.facility_id
      AND previous.department_id = head.department_id
      AND previous.id = head.current_version_id
    WHERE head.organization_id = NEW.organization_id
      AND head.facility_id = NEW.facility_id
      AND head.department_id = NEW.department_id
      AND previous.id = NEW.supersedes_version_id
      AND NEW.version = previous.version + 1
      AND NEW.changed_at >= previous.changed_at
  ) THEN RAISE(ABORT, 'department version must extend the current head') END;
END;
--> statement-breakpoint
CREATE TRIGGER department_versions_no_update
BEFORE UPDATE ON department_versions
BEGIN
  SELECT RAISE(ABORT, 'department versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER department_versions_no_delete
BEFORE DELETE ON department_versions
BEGIN
  SELECT RAISE(ABORT, 'department versions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER department_heads_insert_guard
BEFORE INSERT ON department_heads
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM department_versions version
    WHERE version.organization_id = NEW.organization_id
      AND version.facility_id = NEW.facility_id
      AND version.department_id = NEW.department_id
      AND version.id = NEW.current_version_id
      AND version.version = 1
      AND version.supersedes_version_id IS NULL
      AND NEW.lock_version = 1
  ) THEN RAISE(ABORT, 'department head must start at version 1') END;
END;
--> statement-breakpoint
CREATE TRIGGER department_heads_advance_guard
BEFORE UPDATE ON department_heads
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.facility_id <> OLD.facility_id
    OR NEW.department_id <> OLD.department_id
    OR NEW.created_at <> OLD.created_at
    OR NEW.current_version_id = OLD.current_version_id
    OR NEW.lock_version <> OLD.lock_version + 1
    OR NEW.updated_at < OLD.updated_at
    THEN RAISE(ABORT, 'department head identity or lock is invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM department_versions next
    JOIN department_versions previous
      ON previous.organization_id = next.organization_id
      AND previous.facility_id = next.facility_id
      AND previous.department_id = next.department_id
      AND previous.id = next.supersedes_version_id
    WHERE next.organization_id = NEW.organization_id
      AND next.facility_id = NEW.facility_id
      AND next.department_id = NEW.department_id
      AND next.id = NEW.current_version_id
      AND previous.id = OLD.current_version_id
      AND next.version = previous.version + 1
  ) THEN RAISE(ABORT, 'department head must advance to the direct successor') END;
END;
--> statement-breakpoint
CREATE TRIGGER department_heads_no_delete
BEFORE DELETE ON department_heads
BEGIN
  SELECT RAISE(ABORT, 'department heads cannot be deleted');
END;
--> statement-breakpoint
DROP TRIGGER department_access_assignment_versions_insert_guard;
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
    FROM department_access_assignments actor_assignment
    JOIN department_access_assignment_heads actor_head
      ON actor_head.organization_id = actor_assignment.organization_id
      AND actor_head.facility_id = actor_assignment.facility_id
      AND actor_head.assignment_id = actor_assignment.id
    JOIN department_access_assignment_versions actor_version
      ON actor_version.organization_id = actor_head.organization_id
      AND actor_version.facility_id = actor_head.facility_id
      AND actor_version.assignment_id = actor_head.assignment_id
      AND actor_version.id = actor_head.current_version_id
    JOIN department_heads actor_department_head
      ON actor_department_head.organization_id = actor_assignment.organization_id
      AND actor_department_head.facility_id = actor_assignment.facility_id
      AND actor_department_head.department_id = actor_assignment.department_id
    JOIN department_versions actor_department_version
      ON actor_department_version.organization_id = actor_department_head.organization_id
      AND actor_department_version.facility_id = actor_department_head.facility_id
      AND actor_department_version.department_id = actor_department_head.department_id
      AND actor_department_version.id = actor_department_head.current_version_id
    WHERE actor_assignment.organization_id = NEW.organization_id
      AND actor_assignment.facility_id = NEW.facility_id
      AND actor_assignment.membership_id = NEW.changed_by_membership_id
      AND actor_version.status = 'active'
      AND actor_version.effective_from <= NEW.changed_at
      AND (actor_version.effective_until IS NULL OR actor_version.effective_until > NEW.changed_at)
      AND actor_department_version.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(actor_version.deny_permissions_json)
        WHERE value = 'access.manage'
      )
      AND (
        EXISTS (
          SELECT 1 FROM json_each(actor_version.roles_json)
          WHERE value = 'administrator'
        )
        OR EXISTS (
          SELECT 1 FROM json_each(actor_version.allow_permissions_json)
          WHERE value = 'access.manage'
        )
      )
  ) THEN RAISE(ABORT, 'administrator source requires current access.manage') END;
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
