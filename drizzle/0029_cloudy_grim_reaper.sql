ALTER TABLE `command_idempotency` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `command_idempotency_access_assignment_idx` ON `command_idempotency` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
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
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`deny_permissions_json`)
    WHERE value = 'orders.manage'
  )
  AND EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'doctor'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'service'
  );--> statement-breakpoint
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
        AND access.`effective_from` <= NEW.`created_at`
        AND (
          access.`effective_until` IS NULL
          OR access.`effective_until` > NEW.`created_at`
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'order command requires selected current orders.manage assignment');
END;--> statement-breakpoint
CREATE TRIGGER `command_idempotency_order_access_update_guard`
BEFORE UPDATE ON `command_idempotency`
WHEN NEW.`operation` LIKE 'order.%'
  AND (
    NEW.`access_assignment_id` IS NOT OLD.`access_assignment_id`
    OR NEW.`access_assignment_id` IS NULL
    OR NOT EXISTS (
      SELECT 1 FROM `order_access_assignment_permissions` access
      WHERE access.`assignment_id` = NEW.`access_assignment_id`
        AND access.`organization_id` = NEW.`organization_id`
        AND access.`facility_id` = NEW.`facility_id`
        AND access.`membership_id` = NEW.`actor_membership_id`
        AND access.`effective_from` <= coalesce(NEW.`completed_at`, NEW.`created_at`)
        AND (
          access.`effective_until` IS NULL
          OR access.`effective_until` > coalesce(NEW.`completed_at`, NEW.`created_at`)
        )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'order command assignment is immutable and must remain authorized');
END;--> statement-breakpoint
CREATE TRIGGER `service_requests_order_access_guard`
BEFORE INSERT ON `service_requests`
WHEN NOT EXISTS (
  SELECT 1 FROM `order_access_assignment_permissions` access
  WHERE access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`effective_from` <= NEW.`created_at`
    AND (access.`effective_until` IS NULL OR access.`effective_until` > NEW.`created_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'service request actor requires current orders.manage');
END;--> statement-breakpoint
CREATE TRIGGER `service_request_versions_order_access_guard`
BEFORE INSERT ON `service_request_versions`
WHEN NOT EXISTS (
  SELECT 1 FROM `order_access_assignment_permissions` access
  WHERE access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`authored_by_membership_id`
    AND access.`effective_from` <= NEW.`created_at`
    AND (access.`effective_until` IS NULL OR access.`effective_until` > NEW.`created_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'service request version actor requires current orders.manage');
END;--> statement-breakpoint
CREATE TRIGGER `diagnostic_reports_order_access_guard`
BEFORE INSERT ON `diagnostic_reports`
WHEN NOT EXISTS (
  SELECT 1 FROM `order_access_assignment_permissions` access
  WHERE access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`effective_from` <= NEW.`created_at`
    AND (access.`effective_until` IS NULL OR access.`effective_until` > NEW.`created_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report actor requires current orders.manage');
END;--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_artifacts_order_access_guard`
BEFORE INSERT ON `diagnostic_report_artifacts`
WHEN NOT EXISTS (
  SELECT 1 FROM `order_access_assignment_permissions` access
  WHERE access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`effective_from` <= NEW.`created_at`
    AND (access.`effective_until` IS NULL OR access.`effective_until` > NEW.`created_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'diagnostic artifact actor requires current orders.manage');
END;--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_versions_order_access_guard`
BEFORE INSERT ON `diagnostic_report_versions`
WHEN NOT EXISTS (
  SELECT 1 FROM `order_access_assignment_permissions` access
  WHERE access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`effective_from` <= NEW.`created_at`
    AND (access.`effective_until` IS NULL OR access.`effective_until` > NEW.`created_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report version actor requires current orders.manage');
END;--> statement-breakpoint
CREATE TRIGGER `diagnostic_result_upload_intents_order_access_guard`
BEFORE INSERT ON `diagnostic_result_upload_intents`
WHEN NOT EXISTS (
  SELECT 1 FROM `order_access_assignment_permissions` access
  WHERE access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`effective_from` <= NEW.`created_at`
    AND (access.`effective_until` IS NULL OR access.`effective_until` > NEW.`created_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'diagnostic upload actor requires current orders.manage');
END;--> statement-breakpoint
CREATE TRIGGER `diagnostic_result_upload_intents_order_access_update_guard`
BEFORE UPDATE ON `diagnostic_result_upload_intents`
WHEN NOT EXISTS (
  SELECT 1 FROM `order_access_assignment_permissions` access
  WHERE access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`effective_from` <= NEW.`updated_at`
    AND (access.`effective_until` IS NULL OR access.`effective_until` > NEW.`updated_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'diagnostic upload actor requires current orders.manage');
END;
