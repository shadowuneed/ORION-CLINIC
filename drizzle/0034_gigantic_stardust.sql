ALTER TABLE `communication_manual_task_events` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
ALTER TABLE `communication_patient_responses` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
ALTER TABLE `notification_delivery_attempts` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
ALTER TABLE `outbox_events` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
ALTER TABLE `patient_channel_consent_events` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
ALTER TABLE `patient_notification_events` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);
--> statement-breakpoint
CREATE VIEW `communication_access_assignment_permissions` AS
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
  ) THEN 1 ELSE 0 END AS `is_nurse`,
  CASE WHEN EXISTS (SELECT 1 FROM json_each(assignment_version.`roles_json`) WHERE value = 'registrar') THEN 1 ELSE 0 END AS `is_registrar`
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
      WHERE value IN ('nurse', 'registrar')
    )
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`roles_json`)
    WHERE value = 'service'
  )
  AND NOT EXISTS (
    SELECT 1 FROM json_each(assignment_version.`deny_permissions_json`)
    WHERE value = 'communications.manage'
  );

--> statement-breakpoint
CREATE TRIGGER `command_idempotency_communication_access_guard`
BEFORE INSERT ON `command_idempotency`
WHEN (NEW.operation LIKE 'communication.%') AND (NEW.access_assignment_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM communication_access_assignment_permissions access
  WHERE access.assignment_id = NEW.access_assignment_id
    AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
    AND access.membership_id = NEW.actor_membership_id
    AND access.effective_from <= cast(unixepoch() as integer) * 1000
    AND (access.effective_until IS NULL OR access.effective_until > cast(unixepoch() as integer) * 1000) 
))
BEGIN SELECT RAISE(ABORT, 'communication write requires exact current assignment and allowed actor'); END;

--> statement-breakpoint
CREATE TRIGGER `outbox_events_communication_access_guard`
BEFORE INSERT ON `outbox_events`
WHEN (NEW.aggregate_type = 'patient_notification') AND (NEW.access_assignment_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM communication_access_assignment_permissions access
  WHERE access.assignment_id = NEW.access_assignment_id
    AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
    
    AND access.effective_from <= cast(unixepoch() as integer) * 1000
    AND (access.effective_until IS NULL OR access.effective_until > cast(unixepoch() as integer) * 1000) 
))
BEGIN SELECT RAISE(ABORT, 'communication write requires exact current assignment and allowed actor'); END;

--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_events_communication_access_guard`
BEFORE INSERT ON `patient_channel_consent_events`
WHEN (NEW.access_assignment_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM communication_access_assignment_permissions access
  WHERE access.assignment_id = NEW.access_assignment_id
    AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
    AND access.membership_id = NEW.captured_by_membership_id
    AND access.effective_from <= cast(unixepoch() as integer) * 1000
    AND (access.effective_until IS NULL OR access.effective_until > cast(unixepoch() as integer) * 1000) 
))
BEGIN SELECT RAISE(ABORT, 'communication write requires exact current assignment and allowed actor'); END;

--> statement-breakpoint
CREATE TRIGGER `patient_notification_events_communication_access_guard`
BEFORE INSERT ON `patient_notification_events`
WHEN (NEW.access_assignment_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM communication_access_assignment_permissions access
  WHERE access.assignment_id = NEW.access_assignment_id
    AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
    AND access.membership_id = NEW.changed_by_membership_id
    AND access.effective_from <= cast(unixepoch() as integer) * 1000
    AND (access.effective_until IS NULL OR access.effective_until > cast(unixepoch() as integer) * 1000) AND (
  (NEW.source_type = 'appointment' AND
    (access.is_doctor = 1 OR (access.is_nurse = 0 AND access.is_registrar = 1)) AND EXISTS (
      SELECT 1 FROM appointments appointment
      JOIN service_requests request ON request.id = appointment.referral_request_id
        AND request.organization_id = appointment.organization_id AND request.facility_id = appointment.facility_id
      JOIN encounters encounter ON encounter.id = request.encounter_id
        AND encounter.organization_id = request.organization_id AND encounter.facility_id = request.facility_id
      WHERE appointment.id = NEW.source_record_id AND appointment.organization_id = NEW.organization_id
        AND appointment.facility_id = NEW.facility_id
        AND (access.is_doctor = 0 OR encounter.clinician_membership_id = access.membership_id)
    ))
  OR (NEW.source_type = 'care_plan_task' AND EXISTS (
    SELECT 1 FROM chronic_care_tasks task JOIN chronic_registry_enrollments enrollment
      ON enrollment.id = task.enrollment_id AND enrollment.organization_id = task.organization_id
      AND enrollment.facility_id = task.facility_id
    WHERE task.id = NEW.source_record_id AND task.organization_id = NEW.organization_id
      AND task.facility_id = NEW.facility_id AND
      ((access.is_doctor = 1 AND enrollment.managing_clinician_membership_id = access.membership_id)
       OR (access.is_doctor = 0 AND access.is_nurse = 1 AND task.assigned_membership_id = access.membership_id))
  ))
)
    AND (NEW.state <> 'cancelled_by_staff' OR access.is_doctor = 1 OR access.is_nurse = 0)
))
BEGIN SELECT RAISE(ABORT, 'communication write requires exact current assignment and allowed actor'); END;

--> statement-breakpoint
CREATE TRIGGER `notification_delivery_attempts_communication_access_guard`
BEFORE INSERT ON `notification_delivery_attempts`
WHEN (NEW.access_assignment_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM communication_access_assignment_permissions access
  WHERE access.assignment_id = NEW.access_assignment_id
    AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
    AND access.membership_id = NEW.recorded_by_membership_id
    AND access.effective_from <= cast(unixepoch() as integer) * 1000
    AND (access.effective_until IS NULL OR access.effective_until > cast(unixepoch() as integer) * 1000) AND EXISTS (
 SELECT 1 FROM patient_notification_events notification WHERE notification.id = NEW.notification_event_id
 AND notification.organization_id = NEW.organization_id AND notification.facility_id = NEW.facility_id
 AND (
  (notification.source_type = 'appointment' AND
    (access.is_doctor = 1 OR (access.is_nurse = 0 AND access.is_registrar = 1)) AND EXISTS (
      SELECT 1 FROM appointments appointment
      JOIN service_requests request ON request.id = appointment.referral_request_id
        AND request.organization_id = appointment.organization_id AND request.facility_id = appointment.facility_id
      JOIN encounters encounter ON encounter.id = request.encounter_id
        AND encounter.organization_id = request.organization_id AND encounter.facility_id = request.facility_id
      WHERE appointment.id = notification.source_record_id AND appointment.organization_id = NEW.organization_id
        AND appointment.facility_id = NEW.facility_id
        AND (access.is_doctor = 0 OR encounter.clinician_membership_id = access.membership_id)
    ))
  OR (notification.source_type = 'care_plan_task' AND EXISTS (
    SELECT 1 FROM chronic_care_tasks task JOIN chronic_registry_enrollments enrollment
      ON enrollment.id = task.enrollment_id AND enrollment.organization_id = task.organization_id
      AND enrollment.facility_id = task.facility_id
    WHERE task.id = notification.source_record_id AND task.organization_id = NEW.organization_id
      AND task.facility_id = NEW.facility_id AND
      ((access.is_doctor = 1 AND enrollment.managing_clinician_membership_id = access.membership_id)
       OR (access.is_doctor = 0 AND access.is_nurse = 1 AND task.assigned_membership_id = access.membership_id))
  ))
))
))
BEGIN SELECT RAISE(ABORT, 'communication write requires exact current assignment and allowed actor'); END;

--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_events_communication_access_guard`
BEFORE INSERT ON `communication_manual_task_events`
WHEN (NEW.access_assignment_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM communication_access_assignment_permissions access
  WHERE access.assignment_id = NEW.access_assignment_id
    AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
    AND access.membership_id = NEW.changed_by_membership_id
    AND access.effective_from <= cast(unixepoch() as integer) * 1000
    AND (access.effective_until IS NULL OR access.effective_until > cast(unixepoch() as integer) * 1000) AND (
 (NEW.version > 1 AND NEW.assigned_membership_id = access.membership_id) OR
 (NEW.version = 1 AND EXISTS (SELECT 1 FROM patient_notification_heads head
 JOIN patient_notification_events notification ON notification.id = head.current_event_id
 WHERE head.notification_id = NEW.notification_id AND head.organization_id = NEW.organization_id
 AND head.facility_id = NEW.facility_id AND (
  (notification.source_type = 'appointment' AND
    (access.is_doctor = 1 OR (access.is_nurse = 0 AND access.is_registrar = 1)) AND EXISTS (
      SELECT 1 FROM appointments appointment
      JOIN service_requests request ON request.id = appointment.referral_request_id
        AND request.organization_id = appointment.organization_id AND request.facility_id = appointment.facility_id
      JOIN encounters encounter ON encounter.id = request.encounter_id
        AND encounter.organization_id = request.organization_id AND encounter.facility_id = request.facility_id
      WHERE appointment.id = notification.source_record_id AND appointment.organization_id = NEW.organization_id
        AND appointment.facility_id = NEW.facility_id
        AND (access.is_doctor = 0 OR encounter.clinician_membership_id = access.membership_id)
    ))
  OR (notification.source_type = 'care_plan_task' AND EXISTS (
    SELECT 1 FROM chronic_care_tasks task JOIN chronic_registry_enrollments enrollment
      ON enrollment.id = task.enrollment_id AND enrollment.organization_id = task.organization_id
      AND enrollment.facility_id = task.facility_id
    WHERE task.id = notification.source_record_id AND task.organization_id = NEW.organization_id
      AND task.facility_id = NEW.facility_id AND
      ((access.is_doctor = 1 AND enrollment.managing_clinician_membership_id = access.membership_id)
       OR (access.is_doctor = 0 AND access.is_nurse = 1 AND task.assigned_membership_id = access.membership_id))
  ))
)))
)
))
BEGIN SELECT RAISE(ABORT, 'communication write requires exact current assignment and allowed actor'); END;

--> statement-breakpoint
CREATE TRIGGER `communication_patient_responses_communication_access_guard`
BEFORE INSERT ON `communication_patient_responses`
WHEN (NEW.access_assignment_id IS NULL OR NOT EXISTS (
  SELECT 1 FROM communication_access_assignment_permissions access
  WHERE access.assignment_id = NEW.access_assignment_id
    AND access.organization_id = NEW.organization_id AND access.facility_id = NEW.facility_id
    AND access.membership_id = NEW.recorded_by_membership_id
    AND access.effective_from <= cast(unixepoch() as integer) * 1000
    AND (access.effective_until IS NULL OR access.effective_until > cast(unixepoch() as integer) * 1000) AND EXISTS (
 SELECT 1 FROM communication_manual_task_heads head
 JOIN communication_manual_task_events task ON task.id = head.current_event_id
 WHERE head.task_id = NEW.manual_task_id AND head.organization_id = NEW.organization_id
 AND head.facility_id = NEW.facility_id AND task.assigned_membership_id = access.membership_id
 AND task.notification_id = NEW.notification_id AND task.state IN ('open', 'in_progress')
)
))
BEGIN SELECT RAISE(ABORT, 'communication write requires exact current assignment and allowed actor'); END;

--> statement-breakpoint
DROP TRIGGER `patient_channel_consent_events_require_scope`;
--> statement-breakpoint

--> statement-breakpoint
DROP TRIGGER `patient_notification_events_require_initial_contract`;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_events_require_initial_contract`
BEFORE INSERT ON `patient_notification_events`
WHEN NEW.`version` = 1 AND (
  NEW.`state` NOT IN ('scheduled', 'deferred_quiet_hours')
  OR NEW.`supersedes_notification_event_id` IS NOT NULL
  OR NEW.`attempt_count` <> 0
  OR NEW.`last_failure_code` IS NOT NULL
  OR NEW.`template_values_json` IS NULL
  OR NOT json_valid(NEW.`template_values_json`)
  OR coalesce(json_type(NEW.`template_values_json`, '$.facilityName'), '') <> 'text'
  OR length(trim(json_extract(NEW.`template_values_json`, '$.facilityName'))) = 0
  OR NOT (
    (NEW.`source_type` = 'appointment' AND NEW.`purpose` = 'appointment_reminder'
      AND coalesce(json_type(NEW.`template_values_json`, '$.appointmentDate'), '') = 'text'
      AND coalesce(json_type(NEW.`template_values_json`, '$.appointmentTime'), '') = 'text'
      AND length(trim(json_extract(NEW.`template_values_json`, '$.appointmentDate'))) > 0
      AND length(trim(json_extract(NEW.`template_values_json`, '$.appointmentTime'))) > 0
      AND (SELECT count(*) FROM json_each(NEW.`template_values_json`)) = 3
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.`template_values_json`) value_item
        WHERE value_item.`key` NOT IN ('facilityName', 'appointmentDate', 'appointmentTime')
      ))
    OR
    (NEW.`source_type` = 'care_plan_task' AND NEW.`purpose` = 'care_plan_reminder'
      AND coalesce(json_type(NEW.`template_values_json`, '$.dueDate'), '') = 'text'
      AND length(trim(json_extract(NEW.`template_values_json`, '$.dueDate'))) > 0
      AND (SELECT count(*) FROM json_each(NEW.`template_values_json`)) = 2
      AND NOT EXISTS (
        SELECT 1 FROM json_each(NEW.`template_values_json`) value_item
        WHERE value_item.`key` NOT IN ('facilityName', 'dueDate')
      ))
  )
  OR NOT EXISTS (
    SELECT 1 FROM `patient_channel_consent_heads` consent_head
    JOIN `patient_channel_consent_events` consent
      ON consent.`organization_id` = consent_head.`organization_id`
      AND consent.`facility_id` = consent_head.`facility_id`
      AND consent.`patient_id` = consent_head.`patient_id`
      AND consent.`channel` = consent_head.`channel`
      AND consent.`id` = consent_head.`current_consent_event_id`
    JOIN `communication_template_versions` template
      ON template.`organization_id` = consent.`organization_id`
      AND template.`facility_id` = consent.`facility_id`
      AND template.`id` = NEW.`template_version_id`
      AND template.`purpose` = NEW.`purpose`
      AND template.`channel` = NEW.`channel`
      AND template.`language` = NEW.`language`
      AND template.`status` = 'approved_test'
      AND template.`source_type` = 'local_test'
      AND template.`minimum_content_only` = 1
      AND template.`protected_link_required` = 0
      AND instr(NEW.`rendered_body`, '{{') = 0
      AND instr(NEW.`rendered_body`, '}}') = 0
      AND NEW.`rendered_body` = CASE NEW.`purpose`
        WHEN 'appointment_reminder' THEN
          replace(
            replace(
              replace(template.`body`, '{{facilityName}}', json_extract(NEW.`template_values_json`, '$.facilityName')),
              '{{appointmentDate}}', json_extract(NEW.`template_values_json`, '$.appointmentDate')
            ),
            '{{appointmentTime}}', json_extract(NEW.`template_values_json`, '$.appointmentTime')
          )
        WHEN 'care_plan_reminder' THEN
          replace(
            replace(template.`body`, '{{facilityName}}', json_extract(NEW.`template_values_json`, '$.facilityName')),
            '{{dueDate}}', json_extract(NEW.`template_values_json`, '$.dueDate')
          )
      END
    JOIN `communication_policy_versions` policy
      ON policy.`organization_id` = consent.`organization_id`
      AND policy.`facility_id` = consent.`facility_id`
      AND policy.`id` = NEW.`policy_version_id`
      AND policy.`status` = 'active_test'
      AND policy.`source_type` = 'local_test'
    JOIN `facilities` facility
      ON facility.`organization_id` = consent.`organization_id`
      AND facility.`id` = consent.`facility_id`
      AND facility.`status` = 'active'
      AND facility.`name` = json_extract(NEW.`template_values_json`, '$.facilityName')
    JOIN `outbox_events` outbox
      ON outbox.`organization_id` = consent.`organization_id`
      AND outbox.`facility_id` = consent.`facility_id`
      AND outbox.`id` = NEW.`outbox_event_id`
      AND outbox.`aggregate_type` = 'patient_notification'
      AND outbox.`aggregate_id` = NEW.`notification_id`
      AND outbox.`aggregate_version` = 1
      AND outbox.`event_type` = 'patient_notification.dispatch_requested'
      AND outbox.`event_idempotency_key` = 'patient-notification:' || NEW.`notification_id`
      AND outbox.`command_id` IS NULL
      AND outbox.`status` = 'pending'
      AND outbox.`attempts` = 0
      AND outbox.`next_attempt_at` IS NEW.`next_attempt_at`
      AND outbox.`lease_owner` IS NULL
      AND outbox.`lease_expires_at` IS NULL
      AND outbox.`claimed_at` IS NULL
      AND outbox.`completed_at` IS NULL
      AND outbox.`last_error_code` IS NULL
      AND outbox.`last_error_at` IS NULL
      AND json_valid(outbox.`payload_json`)
      AND json_extract(outbox.`payload_json`, '$.notificationId') = NEW.`notification_id`
      AND json_extract(outbox.`payload_json`, '$.patientId') = NEW.`patient_id`
      AND json_extract(outbox.`payload_json`, '$.sourceType') = NEW.`source_type`
      AND json_extract(outbox.`payload_json`, '$.sourceRecordId') = NEW.`source_record_id`
      AND json_extract(outbox.`payload_json`, '$.sourceVersionId') = NEW.`source_version_id`
      AND json_extract(outbox.`payload_json`, '$.channel') = NEW.`channel`
      AND json_extract(outbox.`payload_json`, '$.templateVersionId') = NEW.`template_version_id`
      AND json_extract(outbox.`payload_json`, '$.contentHash') = NEW.`content_hash`
      AND (SELECT count(*) FROM json_each(outbox.`payload_json`)) = 8
      AND NOT EXISTS (
        SELECT 1 FROM json_each(outbox.`payload_json`) payload_item
        WHERE payload_item.`key` NOT IN (
          'notificationId', 'patientId', 'sourceType', 'sourceRecordId',
          'sourceVersionId', 'channel', 'templateVersionId', 'contentHash'
        )
      )
    JOIN `memberships` actor
      ON actor.`organization_id` = consent.`organization_id`
      AND actor.`facility_id` = consent.`facility_id`
      AND actor.`id` = NEW.`changed_by_membership_id`
      -- Actor role is enforced by the exact assignment guard.
      AND actor.`status` = 'active'
    JOIN `memberships` owner
      ON owner.`organization_id` = consent.`organization_id`
      AND owner.`facility_id` = consent.`facility_id`
      AND owner.`id` = NEW.`failure_owner_membership_id`
      AND owner.`role` IN ('clinician', 'nurse', 'registrar')
      AND owner.`status` = 'active'
    WHERE consent_head.`organization_id` = NEW.`organization_id`
      AND consent_head.`facility_id` = NEW.`facility_id`
      AND consent_head.`patient_id` = NEW.`patient_id`
      AND consent_head.`channel` = NEW.`channel`
      AND consent.`id` = NEW.`consent_event_id`
      AND consent.`decision` = 'granted'
      AND consent.`preferred_language` = NEW.`language`
      AND consent.`effective_at` <= NEW.`requested_at`
      AND consent.`destination_hint` = NEW.`destination_hint`
      AND consent.`destination_fingerprint` = NEW.`destination_fingerprint`
  )
  OR NOT EXISTS (
    SELECT 1 FROM `patients` patient
    WHERE patient.`organization_id` = NEW.`organization_id`
      AND patient.`facility_id` = NEW.`facility_id`
      AND patient.`id` = NEW.`patient_id`
      AND patient.`status` = 'active'
  )
  OR (
    NEW.`source_type` = 'appointment' AND NOT EXISTS (
      SELECT 1 FROM `appointments` appointment
      JOIN `appointment_heads` head
        ON head.`organization_id` = appointment.`organization_id`
        AND head.`facility_id` = appointment.`facility_id`
        AND head.`appointment_id` = appointment.`id`
        AND head.`current_version_id` = NEW.`source_version_id`
      JOIN `appointment_versions` version
        ON version.`organization_id` = head.`organization_id`
        AND version.`facility_id` = head.`facility_id`
        AND version.`appointment_id` = head.`appointment_id`
        AND version.`id` = head.`current_version_id`
        AND version.`status` = 'confirmed'
      WHERE appointment.`organization_id` = NEW.`organization_id`
        AND appointment.`facility_id` = NEW.`facility_id`
        AND appointment.`id` = NEW.`source_record_id`
        AND appointment.`patient_id` = NEW.`patient_id`
    )
  )
  OR (
    NEW.`source_type` = 'care_plan_task' AND NOT EXISTS (
      SELECT 1 FROM `chronic_care_tasks` task
      JOIN `chronic_care_task_heads` task_head
        ON task_head.`organization_id` = task.`organization_id`
        AND task_head.`facility_id` = task.`facility_id`
        AND task_head.`task_id` = task.`id`
      JOIN `chronic_care_task_versions` task_version
        ON task_version.`organization_id` = task_head.`organization_id`
        AND task_version.`facility_id` = task_head.`facility_id`
        AND task_version.`task_id` = task_head.`task_id`
        AND task_version.`id` = task_head.`current_version_id`
        AND task_version.`status` IN ('pending', 'in_progress', 'escalated')
      JOIN `chronic_care_plan_heads` plan_head
        ON plan_head.`organization_id` = task.`organization_id`
        AND plan_head.`facility_id` = task.`facility_id`
        AND plan_head.`care_plan_id` = task.`care_plan_id`
        AND plan_head.`current_version_id` = task.`source_plan_version_id`
      WHERE task.`organization_id` = NEW.`organization_id`
        AND task.`facility_id` = NEW.`facility_id`
        AND task.`id` = NEW.`source_record_id`
        AND task.`patient_id` = NEW.`patient_id`
        AND task.`source_plan_version_id` = NEW.`source_version_id`
    )
  )
)
BEGIN SELECT RAISE(ABORT, 'notification requires current consent, exact approved template render, policy, owner, exact outbox and valid source'); END;
