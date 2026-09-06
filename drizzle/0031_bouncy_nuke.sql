ALTER TABLE `patient_observation_records` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `patient_observation_records_access_assignment_idx` ON `patient_observation_records` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `patient_observation_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `patient_observation_versions_access_assignment_idx` ON `patient_observation_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);
--> statement-breakpoint
DROP TRIGGER `patient_observation_records_insert_guard`;
--> statement-breakpoint
DROP TRIGGER `patient_observation_versions_insert_guard`;
--> statement-breakpoint
CREATE VIEW `observation_access_assignment_permissions` AS
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
JOIN `organizations` organization
  ON organization.`id` = assignment.`organization_id`
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
    WHERE value = 'observations.manage'
  );
--> statement-breakpoint
CREATE TRIGGER `command_idempotency_observation_access_insert_guard`
BEFORE INSERT ON `command_idempotency`
WHEN NEW.`operation` IN ('observation.create', 'observation.correct')
  AND (
    NEW.`access_assignment_id` IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM `observation_access_assignment_permissions` access
      WHERE access.`assignment_id` = NEW.`access_assignment_id`
        AND access.`organization_id` = NEW.`organization_id`
        AND access.`facility_id` = NEW.`facility_id`
        AND access.`membership_id` = NEW.`actor_membership_id`
        AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
        AND (
          access.`effective_until` IS NULL
          OR access.`effective_until` > cast(unixepoch() as integer) * 1000
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'observation command requires selected current doctor or nurse observations.manage assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `patient_observation_records_insert_guard`
BEFORE INSERT ON `patient_observation_records`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `patients` patient
    WHERE patient.`organization_id` = NEW.`organization_id`
      AND patient.`facility_id` = NEW.`facility_id`
      AND patient.`id` = NEW.`patient_id`
      AND patient.`status` = 'active'
  ) THEN RAISE(ABORT, 'observation patient must be active in scope') END;
  SELECT CASE WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
    SELECT 1 FROM `observation_access_assignment_permissions` access
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`created_by_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
  ) THEN RAISE(ABORT, 'observation record requires exact current doctor or nurse assignment') END;
END;
--> statement-breakpoint
CREATE TRIGGER `patient_observation_versions_insert_guard`
BEFORE INSERT ON `patient_observation_versions`
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM `patient_observation_records` record
    WHERE record.`organization_id` = NEW.`organization_id`
      AND record.`facility_id` = NEW.`facility_id`
      AND record.`id` = NEW.`observation_id`
      AND record.`patient_id` = NEW.`patient_id`
  ) THEN RAISE(ABORT, 'observation version patient mismatch') END;
  SELECT CASE WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
    SELECT 1 FROM `observation_access_assignment_permissions` access
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`recorded_by_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
  ) THEN RAISE(ABORT, 'observation version requires exact current doctor or nurse assignment') END;
  SELECT CASE WHEN NEW.`version` = 1 AND NOT EXISTS (
    SELECT 1 FROM `patient_observation_records` record
    WHERE record.`organization_id` = NEW.`organization_id`
      AND record.`facility_id` = NEW.`facility_id`
      AND record.`id` = NEW.`observation_id`
      AND record.`created_by_membership_id` = NEW.`recorded_by_membership_id`
      AND record.`access_assignment_id` = NEW.`access_assignment_id`
  ) THEN RAISE(ABORT, 'observation initial version must match root actor and assignment') END;
  SELECT CASE WHEN NEW.`measured_at` < 946684800000
    OR NEW.`measured_at` > NEW.`recorded_at` + 300000
    THEN RAISE(ABORT, 'observation measured_at is outside the accepted clock range') END;
  SELECT CASE WHEN NEW.`version` = 1 AND EXISTS (
    SELECT 1 FROM `patient_observation_heads` head
    WHERE head.`organization_id` = NEW.`organization_id`
      AND head.`facility_id` = NEW.`facility_id`
      AND head.`observation_id` = NEW.`observation_id`
  ) THEN RAISE(ABORT, 'observation initial version already has a head') END;
  SELECT CASE WHEN NEW.`version` > 1 AND NOT EXISTS (
    SELECT 1
    FROM `patient_observation_heads` head
    JOIN `patient_observation_versions` previous
      ON previous.`organization_id` = head.`organization_id`
      AND previous.`facility_id` = head.`facility_id`
      AND previous.`observation_id` = head.`observation_id`
      AND previous.`id` = head.`current_version_id`
    JOIN `observation_access_assignment_permissions` access
      ON access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`recorded_by_membership_id`
    WHERE head.`organization_id` = NEW.`organization_id`
      AND head.`facility_id` = NEW.`facility_id`
      AND head.`observation_id` = NEW.`observation_id`
      AND head.`patient_id` = NEW.`patient_id`
      AND previous.`id` = NEW.`supersedes_version_id`
      AND previous.`version` + 1 = NEW.`version`
      AND (
        access.`is_doctor` = 1
        OR (
          access.`is_doctor` = 0
          AND access.`is_nurse` = 1
          AND previous.`recorded_by_membership_id` = NEW.`recorded_by_membership_id`
        )
      )
  ) THEN RAISE(ABORT, 'observation version must extend current head within actor role boundary') END;
END;
