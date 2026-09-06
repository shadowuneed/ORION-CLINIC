ALTER TABLE `diagnostic_report_artifacts` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `diagnostic_report_artifacts_access_assignment_idx` ON `diagnostic_report_artifacts` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `diagnostic_report_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `diagnostic_report_versions_access_assignment_idx` ON `diagnostic_report_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `diagnostic_reports` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `diagnostic_reports_access_assignment_idx` ON `diagnostic_reports` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `diagnostic_result_upload_intents` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `diagnostic_result_upload_intents_access_assignment_idx` ON `diagnostic_result_upload_intents` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `service_request_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `service_request_versions_access_assignment_idx` ON `service_request_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `service_requests` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `service_requests_access_assignment_idx` ON `service_requests` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);
--> statement-breakpoint
DROP TRIGGER `command_idempotency_order_access_insert_guard`;
--> statement-breakpoint
DROP TRIGGER `command_idempotency_order_access_update_guard`;
--> statement-breakpoint
DROP TRIGGER `service_requests_order_access_guard`;
--> statement-breakpoint
DROP TRIGGER `service_request_versions_order_access_guard`;
--> statement-breakpoint
DROP TRIGGER `diagnostic_reports_order_access_guard`;
--> statement-breakpoint
DROP TRIGGER `diagnostic_report_artifacts_order_access_guard`;
--> statement-breakpoint
DROP TRIGGER `diagnostic_report_versions_order_access_guard`;
--> statement-breakpoint
DROP TRIGGER `diagnostic_result_upload_intents_order_access_guard`;
--> statement-breakpoint
DROP TRIGGER `diagnostic_result_upload_intents_order_access_update_guard`;
--> statement-breakpoint
DROP VIEW `order_access_assignment_permissions`;
--> statement-breakpoint
CREATE VIEW `order_access_assignment_permissions` AS
SELECT
  assignment.`id` AS `assignment_id`,
  assignment.`organization_id`,
  assignment.`facility_id`,
  assignment.`membership_id`,
  assignment_version.`effective_from`,
  assignment_version.`effective_until`
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
  AND EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'doctor'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'service'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`deny_permissions_json`)
    WHERE value = 'orders.manage'
  );
--> statement-breakpoint
CREATE TRIGGER `command_idempotency_order_access_insert_guard`
BEFORE INSERT ON `command_idempotency`
WHEN NEW.`operation` LIKE 'order.%'
  AND (
    NEW.`access_assignment_id` IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM `order_access_assignment_permissions` access
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
  SELECT RAISE(ABORT, 'order command requires selected current doctor orders.manage assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `command_idempotency_access_assignment_immutable`
BEFORE UPDATE ON `command_idempotency`
WHEN NEW.`access_assignment_id` IS NOT OLD.`access_assignment_id`
BEGIN
  SELECT RAISE(ABORT, 'command access assignment is immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `service_requests_order_access_guard`
BEFORE INSERT ON `service_requests`
WHEN NEW.`access_assignment_id` IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM `order_access_assignment_permissions` access
    JOIN `encounters` encounter
      ON encounter.`organization_id` = NEW.`organization_id`
      AND encounter.`facility_id` = NEW.`facility_id`
      AND encounter.`id` = NEW.`encounter_id`
      AND encounter.`clinician_membership_id` = NEW.`created_by_membership_id`
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`created_by_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'service request requires exact current doctor assignment and treating encounter');
END;
--> statement-breakpoint
CREATE TRIGGER `service_request_versions_order_access_guard`
BEFORE INSERT ON `service_request_versions`
WHEN NEW.`access_assignment_id` IS NULL
  OR NEW.`approved_by_membership_id` IS NOT NULL
    AND NEW.`approved_by_membership_id` IS NOT NEW.`authored_by_membership_id`
  OR NOT EXISTS (
    SELECT 1
    FROM `order_access_assignment_permissions` access
    JOIN `service_requests` request
      ON request.`organization_id` = NEW.`organization_id`
      AND request.`facility_id` = NEW.`facility_id`
      AND request.`id` = NEW.`service_request_id`
    JOIN `encounters` encounter
      ON encounter.`organization_id` = request.`organization_id`
      AND encounter.`facility_id` = request.`facility_id`
      AND encounter.`id` = request.`encounter_id`
      AND encounter.`clinician_membership_id` = NEW.`authored_by_membership_id`
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`authored_by_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'service request version requires exact current doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_reports_order_access_guard`
BEFORE INSERT ON `diagnostic_reports`
WHEN NEW.`access_assignment_id` IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM `order_access_assignment_permissions` access
    JOIN `service_requests` request
      ON request.`organization_id` = NEW.`organization_id`
      AND request.`facility_id` = NEW.`facility_id`
      AND request.`id` = NEW.`service_request_id`
    JOIN `encounters` encounter
      ON encounter.`organization_id` = request.`organization_id`
      AND encounter.`facility_id` = request.`facility_id`
      AND encounter.`id` = request.`encounter_id`
      AND encounter.`clinician_membership_id` = NEW.`created_by_membership_id`
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`created_by_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report requires exact current doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_artifacts_order_access_guard`
BEFORE INSERT ON `diagnostic_report_artifacts`
WHEN NEW.`access_assignment_id` IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM `order_access_assignment_permissions` access
    JOIN `service_requests` request
      ON request.`organization_id` = NEW.`organization_id`
      AND request.`facility_id` = NEW.`facility_id`
      AND request.`id` = NEW.`service_request_id`
    JOIN `encounters` encounter
      ON encounter.`organization_id` = request.`organization_id`
      AND encounter.`facility_id` = request.`facility_id`
      AND encounter.`id` = request.`encounter_id`
      AND encounter.`clinician_membership_id` = NEW.`created_by_membership_id`
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`created_by_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic artifact requires exact current doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_versions_order_access_guard`
BEFORE INSERT ON `diagnostic_report_versions`
WHEN NEW.`access_assignment_id` IS NULL
  OR NEW.`reviewed_by_membership_id` IS NOT NULL
    AND NEW.`reviewed_by_membership_id` IS NOT NEW.`created_by_membership_id`
  OR NOT EXISTS (
    SELECT 1
    FROM `order_access_assignment_permissions` access
    JOIN `service_requests` request
      ON request.`organization_id` = NEW.`organization_id`
      AND request.`facility_id` = NEW.`facility_id`
      AND request.`id` = NEW.`service_request_id`
    JOIN `encounters` encounter
      ON encounter.`organization_id` = request.`organization_id`
      AND encounter.`facility_id` = request.`facility_id`
      AND encounter.`id` = request.`encounter_id`
      AND encounter.`clinician_membership_id` = NEW.`created_by_membership_id`
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`created_by_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report version requires exact current doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_result_upload_intents_order_access_guard`
BEFORE INSERT ON `diagnostic_result_upload_intents`
WHEN NEW.`access_assignment_id` IS NULL
  OR NOT EXISTS (
    SELECT 1
    FROM `order_access_assignment_permissions` access
    JOIN `command_idempotency` command
      ON command.`organization_id` = NEW.`organization_id`
      AND command.`facility_id` = NEW.`facility_id`
      AND command.`id` = NEW.`command_id`
      AND command.`access_assignment_id` = NEW.`access_assignment_id`
      AND command.`actor_membership_id` = NEW.`created_by_membership_id`
    JOIN `service_requests` request
      ON request.`organization_id` = NEW.`organization_id`
      AND request.`facility_id` = NEW.`facility_id`
      AND request.`id` = NEW.`service_request_id`
    JOIN `encounters` encounter
      ON encounter.`organization_id` = request.`organization_id`
      AND encounter.`facility_id` = request.`facility_id`
      AND encounter.`id` = request.`encounter_id`
      AND encounter.`clinician_membership_id` = NEW.`created_by_membership_id`
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`created_by_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (
        access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic upload requires exact selected doctor assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `diagnostic_result_upload_intents_access_immutable`
BEFORE UPDATE ON `diagnostic_result_upload_intents`
WHEN NEW.`access_assignment_id` IS NOT OLD.`access_assignment_id`
  OR NEW.`created_by_membership_id` IS NOT OLD.`created_by_membership_id`
  OR NEW.`command_id` IS NOT OLD.`command_id`
  OR NEW.`service_request_id` IS NOT OLD.`service_request_id`
BEGIN
  SELECT RAISE(ABORT, 'diagnostic upload access attribution is immutable');
END;
