ALTER TABLE `appointment_slot_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `appointment_slot_versions_access_assignment_idx` ON `appointment_slot_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `appointment_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `appointment_versions_access_assignment_idx` ON `appointment_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `appointments` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `appointments_access_assignment_idx` ON `appointments` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `queue_ticket_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `queue_ticket_versions_access_assignment_idx` ON `queue_ticket_versions` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `queue_tickets` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `queue_tickets_access_assignment_idx` ON `queue_tickets` (`organization_id`,`facility_id`,`access_assignment_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `scheduling_preference_snapshots` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
CREATE INDEX `scheduling_preferences_access_assignment_idx` ON `scheduling_preference_snapshots` (`organization_id`,`facility_id`,`access_assignment_id`,`captured_at`);
--> statement-breakpoint
CREATE VIEW `scheduling_access_assignment_permissions` AS
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
    WHERE value = 'registrar'
  ) THEN 1 ELSE 0 END AS `is_registrar`
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
      WHERE value = 'registrar'
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'service'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`deny_permissions_json`)
    WHERE value = 'scheduling.manage'
  );
--> statement-breakpoint
CREATE TRIGGER `command_idempotency_scheduling_access_insert_guard`
BEFORE INSERT ON `command_idempotency`
WHEN NEW.`operation` IN (
  'scheduling.preference.create',
  'scheduling.appointment.hold',
  'scheduling.appointment.confirm',
  'scheduling.appointment.cancel',
  'scheduling.appointment.expire_hold',
  'scheduling.appointment.mark_no_show',
  'scheduling.queue.issue',
  'scheduling.queue.arrive',
  'scheduling.queue.call',
  'scheduling.queue.start_service',
  'scheduling.queue.complete',
  'scheduling.queue.mark_exception'
)
AND (
  NEW.`access_assignment_id` IS NULL
  OR NOT EXISTS (
    SELECT 1 FROM `scheduling_access_assignment_permissions` access
    WHERE access.`assignment_id` = NEW.`access_assignment_id`
      AND access.`organization_id` = NEW.`organization_id`
      AND access.`facility_id` = NEW.`facility_id`
      AND access.`membership_id` = NEW.`actor_membership_id`
      AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
      AND (access.`effective_until` IS NULL
        OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
      AND NOT (
        access.`is_doctor` = 0
        AND access.`is_registrar` = 1
        AND NEW.`operation` IN (
          'scheduling.appointment.expire_hold',
          'scheduling.queue.start_service',
          'scheduling.queue.complete'
        )
      )
      AND NEW.`operation` <> 'scheduling.appointment.expire_hold'
  )
)
BEGIN
  SELECT RAISE(ABORT, 'scheduling command requires exact current assignment and allowed role');
END;
--> statement-breakpoint
CREATE TRIGGER `scheduling_preferences_access_insert_guard`
BEFORE INSERT ON `scheduling_preference_snapshots`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1
  FROM `scheduling_access_assignment_permissions` access
  JOIN `service_requests` request
    ON request.`organization_id` = NEW.`organization_id`
    AND request.`facility_id` = NEW.`facility_id`
    AND request.`id` = NEW.`referral_request_id`
  JOIN `encounters` encounter
    ON encounter.`organization_id` = request.`organization_id`
    AND encounter.`facility_id` = request.`facility_id`
    AND encounter.`id` = request.`encounter_id`
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`captured_by_membership_id`
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
    AND (access.`is_doctor` = 0
      OR encounter.`clinician_membership_id` = access.`membership_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'scheduling preference requires exact current assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `appointments_access_insert_guard`
BEFORE INSERT ON `appointments`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1
  FROM `scheduling_access_assignment_permissions` access
  JOIN `service_requests` request
    ON request.`organization_id` = NEW.`organization_id`
    AND request.`facility_id` = NEW.`facility_id`
    AND request.`id` = NEW.`referral_request_id`
  JOIN `encounters` encounter
    ON encounter.`organization_id` = request.`organization_id`
    AND encounter.`facility_id` = request.`facility_id`
    AND encounter.`id` = request.`encounter_id`
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
    AND (access.`is_doctor` = 0
      OR encounter.`clinician_membership_id` = access.`membership_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'appointment requires exact current assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_versions_access_insert_guard`
BEFORE INSERT ON `appointment_versions`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1 FROM `scheduling_access_assignment_permissions` access
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`changed_by_membership_id`
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
    AND NOT (access.`is_doctor` = 0 AND access.`is_registrar` = 1
      AND NEW.`status` = 'completed')
    AND NEW.`status` <> 'expired'
)
OR (
  NEW.`version` = 1
  AND NOT EXISTS (
    SELECT 1 FROM `appointments` appointment
    WHERE appointment.`organization_id` = NEW.`organization_id`
      AND appointment.`facility_id` = NEW.`facility_id`
      AND appointment.`id` = NEW.`appointment_id`
      AND appointment.`created_by_membership_id` = NEW.`changed_by_membership_id`
      AND appointment.`access_assignment_id` = NEW.`access_assignment_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'appointment version requires exact current assignment and allowed role');
END;
--> statement-breakpoint
CREATE TRIGGER `appointment_slot_versions_access_insert_guard`
BEFORE INSERT ON `appointment_slot_versions`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1 FROM `scheduling_access_assignment_permissions` access
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`changed_by_membership_id`
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
)
BEGIN
  SELECT RAISE(ABORT, 'slot version requires exact current assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `queue_tickets_access_insert_guard`
BEFORE INSERT ON `queue_tickets`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1
  FROM `scheduling_access_assignment_permissions` access
  JOIN `appointments` appointment
    ON appointment.`organization_id` = NEW.`organization_id`
    AND appointment.`facility_id` = NEW.`facility_id`
    AND appointment.`id` = NEW.`appointment_id`
  JOIN `service_requests` request
    ON request.`organization_id` = appointment.`organization_id`
    AND request.`facility_id` = appointment.`facility_id`
    AND request.`id` = appointment.`referral_request_id`
  JOIN `encounters` encounter
    ON encounter.`organization_id` = request.`organization_id`
    AND encounter.`facility_id` = request.`facility_id`
    AND encounter.`id` = request.`encounter_id`
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`created_by_membership_id`
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
    AND (access.`is_doctor` = 0
      OR encounter.`clinician_membership_id` = access.`membership_id`)
)
BEGIN
  SELECT RAISE(ABORT, 'queue ticket requires exact current assignment');
END;
--> statement-breakpoint
CREATE TRIGGER `queue_ticket_versions_access_insert_guard`
BEFORE INSERT ON `queue_ticket_versions`
WHEN NEW.`access_assignment_id` IS NULL OR NOT EXISTS (
  SELECT 1 FROM `scheduling_access_assignment_permissions` access
  WHERE access.`assignment_id` = NEW.`access_assignment_id`
    AND access.`organization_id` = NEW.`organization_id`
    AND access.`facility_id` = NEW.`facility_id`
    AND access.`membership_id` = NEW.`changed_by_membership_id`
    AND access.`effective_from` <= cast(unixepoch() as integer) * 1000
    AND (access.`effective_until` IS NULL
      OR access.`effective_until` > cast(unixepoch() as integer) * 1000)
    AND NOT (access.`is_doctor` = 0 AND access.`is_registrar` = 1
      AND NEW.`status` IN ('in_service', 'completed'))
)
OR (
  NEW.`version` = 1
  AND NOT EXISTS (
    SELECT 1 FROM `queue_tickets` ticket
    WHERE ticket.`organization_id` = NEW.`organization_id`
      AND ticket.`facility_id` = NEW.`facility_id`
      AND ticket.`id` = NEW.`queue_ticket_id`
      AND ticket.`created_by_membership_id` = NEW.`changed_by_membership_id`
      AND ticket.`access_assignment_id` = NEW.`access_assignment_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'queue version requires exact current assignment and allowed role');
END;
