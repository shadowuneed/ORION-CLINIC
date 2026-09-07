ALTER TABLE `chronic_care_plan_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `chronic_care_plan_versions_access_assignment_idx` ON `chronic_care_plan_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `chronic_care_plans` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `chronic_care_plans_access_assignment_idx` ON `chronic_care_plans` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `chronic_care_task_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `chronic_care_task_versions_access_assignment_idx` ON `chronic_care_task_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `chronic_care_tasks` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `chronic_care_tasks_access_assignment_idx` ON `chronic_care_tasks` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `chronic_registry_enrollment_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `chronic_enrollment_versions_access_assignment_idx` ON `chronic_registry_enrollment_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `chronic_registry_enrollments` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `chronic_enrollments_access_assignment_idx` ON `chronic_registry_enrollments` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);
--> statement-breakpoint
CREATE VIEW `chronic_care_access_assignment_permissions` AS
SELECT
  assignment.`id` AS `assignment_id`,
  assignment.`organization_id`,
  assignment.`facility_id`,
  assignment.`membership_id`,
  assignment_version.`effective_from`,
  assignment_version.`effective_until`,
  CASE WHEN EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'doctor'
  ) THEN 1 ELSE 0 END AS `is_doctor`,
  CASE WHEN EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'nurse'
  ) THEN 1 ELSE 0 END AS `is_nurse`
FROM `department_access_assignments` assignment
JOIN `department_access_assignment_heads` assignment_head
  ON assignment_head.`organization_id` = assignment.`organization_id`
  AND assignment_head.`facility_id` = assignment.`facility_id`
  AND assignment_head.`assignment_id` = assignment.`id`
  AND assignment_head.`department_id` = assignment.`department_id`
  AND assignment_head.`membership_id` = assignment.`membership_id`
JOIN `department_access_assignment_versions` assignment_version
  ON assignment_version.`organization_id` = assignment_head.`organization_id`
  AND assignment_version.`facility_id` = assignment_head.`facility_id`
  AND assignment_version.`assignment_id` = assignment_head.`assignment_id`
  AND assignment_version.`department_id` = assignment_head.`department_id`
  AND assignment_version.`membership_id` = assignment_head.`membership_id`
  AND assignment_version.`id` = assignment_head.`current_version_id`
JOIN `department_heads` department_head
  ON department_head.`organization_id` = assignment.`organization_id`
  AND department_head.`facility_id` = assignment.`facility_id`
  AND department_head.`department_id` = assignment.`department_id`
JOIN `department_versions` department_version
  ON department_version.`organization_id` = department_head.`organization_id`
  AND department_version.`facility_id` = department_head.`facility_id`
  AND department_version.`department_id` = department_head.`department_id`
  AND department_version.`id` = department_head.`current_version_id`
JOIN `memberships` membership
  ON membership.`organization_id` = assignment.`organization_id`
  AND membership.`facility_id` = assignment.`facility_id`
  AND membership.`id` = assignment.`membership_id`
JOIN `users` user ON user.`id` = membership.`user_id`
JOIN `organizations` organization ON organization.`id` = assignment.`organization_id`
JOIN `facilities` facility
  ON facility.`organization_id` = assignment.`organization_id`
  AND facility.`id` = assignment.`facility_id`
WHERE assignment_version.`status` = 'active'
  AND department_version.`status` = 'active'
  AND membership.`status` = 'active'
  AND user.`status` = 'active'
  AND organization.`status` = 'active'
  AND facility.`status` = 'active'
  AND (
    EXISTS (
      SELECT 1 FROM json_each(assignment_version.`roles_json`)
      WHERE value = 'doctor'
    )
    OR EXISTS (
      SELECT 1 FROM json_each(assignment_version.`roles_json`)
      WHERE value = 'nurse'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'service'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`deny_permissions_json`)
    WHERE value = 'care.manage'
  );
--> statement-breakpoint
CREATE TRIGGER `command_idempotency_chronic_care_access_insert_guard`
BEFORE INSERT ON `command_idempotency`
WHEN NEW.`operation` IN (
  'chronic.enrollment.create',
  'chronic.plan.sign',
  'chronic.task.command'
)
AND (
  NEW.`access_assignment_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `chronic_care_access_assignment_permissions` access
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`actor_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
      AND (
        NEW.`operation` = 'chronic.task.command'
        OR access.`is_doctor` = 1
      )
  )
)
BEGIN
  SELECT RAISE(ABORT, 'chronic-care command requires exact current assignment and allowed role');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_registry_enrollments_access_insert_guard`
BEFORE INSERT ON `chronic_registry_enrollments`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1 FROM `chronic_care_access_assignment_permissions` access
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`membership_id` = NEW.`managing_clinician_membership_id`
    AND access.`is_doctor` = 1
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
)
BEGIN
  SELECT RAISE(ABORT, 'chronic enrollment requires exact current doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_registry_enrollment_versions_access_insert_guard`
BEFORE INSERT ON `chronic_registry_enrollment_versions`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1
  FROM `chronic_care_access_assignment_permissions` access
  JOIN `chronic_registry_enrollments` enrollment
    ON enrollment.`organization_id` = NEW.`organization_id`
    AND enrollment.`facility_id` = NEW.`facility_id`
    AND enrollment.`id` = NEW.`enrollment_id`
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`decided_by_membership_id`
    AND enrollment.`managing_clinician_membership_id` = access.`membership_id`
    AND access.`is_doctor` = 1
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
    AND (
      NEW.`version` > 1
      OR enrollment.`access_assignment_id` = NEW.`access_assignment_id`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'chronic enrollment version requires exact current doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plans_access_insert_guard`
BEFORE INSERT ON `chronic_care_plans`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1
  FROM `chronic_care_access_assignment_permissions` access
  JOIN `chronic_registry_enrollments` enrollment
    ON enrollment.`organization_id` = NEW.`organization_id`
    AND enrollment.`facility_id` = NEW.`facility_id`
    AND enrollment.`id` = NEW.`enrollment_id`
    AND enrollment.`patient_id` = NEW.`patient_id`
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND enrollment.`managing_clinician_membership_id` = access.`membership_id`
    AND access.`is_doctor` = 1
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
)
BEGIN
  SELECT RAISE(ABORT, 'chronic care plan requires exact current doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_plan_versions_access_insert_guard`
BEFORE INSERT ON `chronic_care_plan_versions`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1
  FROM `chronic_care_access_assignment_permissions` access
  JOIN `chronic_care_plans` plan
    ON plan.`organization_id` = NEW.`organization_id`
    AND plan.`facility_id` = NEW.`facility_id`
    AND plan.`id` = NEW.`care_plan_id`
    AND plan.`enrollment_id` = NEW.`enrollment_id`
  JOIN `chronic_registry_enrollments` enrollment
    ON enrollment.`organization_id` = plan.`organization_id`
    AND enrollment.`facility_id` = plan.`facility_id`
    AND enrollment.`id` = plan.`enrollment_id`
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`signed_by_membership_id`
    AND enrollment.`managing_clinician_membership_id` = access.`membership_id`
    AND access.`is_doctor` = 1
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
    AND (
      NEW.`version` > 1
      OR (
        plan.`created_by_membership_id` = NEW.`signed_by_membership_id`
        AND plan.`access_assignment_id` = NEW.`access_assignment_id`
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'chronic care plan version requires exact current doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_tasks_access_insert_guard`
BEFORE INSERT ON `chronic_care_tasks`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1
  FROM `chronic_care_access_assignment_permissions` access
  JOIN `chronic_care_plan_versions` plan_version
    ON plan_version.`organization_id` = NEW.`organization_id`
    AND plan_version.`facility_id` = NEW.`facility_id`
    AND plan_version.`care_plan_id` = NEW.`care_plan_id`
    AND plan_version.`id` = NEW.`source_plan_version_id`
    AND plan_version.`enrollment_id` = NEW.`enrollment_id`
  JOIN `chronic_registry_enrollments` enrollment
    ON enrollment.`organization_id` = NEW.`organization_id`
    AND enrollment.`facility_id` = NEW.`facility_id`
    AND enrollment.`id` = NEW.`enrollment_id`
    AND enrollment.`patient_id` = NEW.`patient_id`
  JOIN `memberships` assignee
    ON assignee.`organization_id` = NEW.`organization_id`
    AND assignee.`facility_id` = NEW.`facility_id`
    AND assignee.`id` = NEW.`assigned_membership_id`
    AND assignee.`role` = NEW.`owner_role`
    AND assignee.`status` = 'active'
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND plan_version.`access_assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = plan_version.`signed_by_membership_id`
    AND enrollment.`managing_clinician_membership_id` = access.`membership_id`
    AND access.`is_doctor` = 1
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
)
BEGIN
  SELECT RAISE(ABORT, 'chronic care task requires signed-plan doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `chronic_care_task_versions_access_insert_guard`
BEFORE INSERT ON `chronic_care_task_versions`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1
  FROM `chronic_care_access_assignment_permissions` access
  JOIN `chronic_care_tasks` task
    ON task.`organization_id` = NEW.`organization_id`
    AND task.`facility_id` = NEW.`facility_id`
    AND task.`id` = NEW.`task_id`
  JOIN `chronic_registry_enrollments` enrollment
    ON enrollment.`organization_id` = task.`organization_id`
    AND enrollment.`facility_id` = task.`facility_id`
    AND enrollment.`id` = task.`enrollment_id`
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`changed_by_membership_id`
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
    AND (
      (
        NEW.`version` = 1
        AND access.`is_doctor` = 1
        AND enrollment.`managing_clinician_membership_id` = access.`membership_id`
        AND task.`access_assignment_id` = NEW.`access_assignment_id`
      )
      OR (
        NEW.`version` > 1
        AND EXISTS (
          SELECT 1
          FROM `chronic_care_task_heads` head
          JOIN `chronic_care_task_versions` previous
            ON previous.`organization_id` = head.`organization_id`
            AND previous.`facility_id` = head.`facility_id`
            AND previous.`task_id` = head.`task_id`
            AND previous.`id` = head.`current_version_id`
          WHERE head.`organization_id` = NEW.`organization_id`
            AND head.`facility_id` = NEW.`facility_id`
            AND head.`task_id` = NEW.`task_id`
            AND previous.`id` = NEW.`supersedes_version_id`
            AND previous.`version` + 1 = NEW.`version`
            AND (
              (
                access.`is_doctor` = 1
                AND enrollment.`managing_clinician_membership_id` = access.`membership_id`
                AND (
                  (
                    task.`owner_role` = 'clinician'
                    AND previous.`status` IN ('pending', 'in_progress')
                    AND NEW.`status` IN ('in_progress', 'completed', 'cancelled')
                  )
                  OR (
                    previous.`status` = 'escalated'
                    AND NEW.`status` IN ('completed', 'cancelled')
                  )
                  OR (
                    task.`owner_role` = 'nurse'
                    AND previous.`status` IN ('pending', 'in_progress', 'escalated')
                    AND NEW.`status` = 'cancelled'
                  )
                )
              )
              OR (
                access.`is_doctor` = 0
                AND access.`is_nurse` = 1
                AND task.`owner_role` = 'nurse'
                AND task.`assigned_membership_id` = access.`membership_id`
                AND previous.`status` IN ('pending', 'in_progress')
                AND NEW.`status` IN ('in_progress', 'completed', 'escalated')
              )
            )
        )
      )
    )
)
BEGIN
  SELECT RAISE(ABORT, 'chronic care task version requires exact assignment and allowed lifecycle role');
END;
