DROP INDEX `communication_template_versions_scope_resolution_uidx`;--> statement-breakpoint
CREATE INDEX `communication_template_versions_scope_resolution_idx` ON `communication_template_versions` (`organization_id`,`facility_id`,`purpose`,`channel`,`language`,`status`,`version`);--> statement-breakpoint
ALTER TABLE `patient_notification_events` ADD `template_values_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `communication_patient_responses_task_notification_id_uidx` ON `communication_patient_responses` (`organization_id`,`facility_id`,`manual_task_id`,`notification_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER `patient_channel_consent_events_require_exact_test_destination`
BEFORE INSERT ON `patient_channel_consent_events`
WHEN NEW.`decision` = 'granted' AND (
  NEW.`destination_ref` <> 'test:' || NEW.`channel` || ':' || NEW.`patient_id`
  OR NEW.`destination_hint` <> CASE NEW.`channel`
    WHEN 'whatsapp' THEN 'Тестовый канал · WhatsApp'
    WHEN 'telegram' THEN 'Тестовый канал · Telegram'
    WHEN 'sms' THEN 'Тестовый канал · SMS'
    WHEN 'voice' THEN 'Тестовый канал · телефонный звонок'
  END
)
BEGIN SELECT RAISE(ABORT, 'only the exact system synthetic destination is allowed'); END;
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
      AND actor.`role` IN ('clinician', 'nurse', 'registrar')
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
--> statement-breakpoint
DROP TRIGGER `patient_notification_events_extend_current_head`;
--> statement-breakpoint
CREATE TRIGGER `patient_notification_events_extend_current_head`
BEFORE INSERT ON `patient_notification_events`
WHEN NEW.`version` > 1 AND NOT EXISTS (
  SELECT 1 FROM `patient_notification_heads` head
  JOIN `patient_notification_events` previous
    ON previous.`organization_id` = head.`organization_id`
    AND previous.`facility_id` = head.`facility_id`
    AND previous.`notification_id` = head.`notification_id`
    AND previous.`id` = head.`current_event_id`
  WHERE head.`organization_id` = NEW.`organization_id`
    AND head.`facility_id` = NEW.`facility_id`
    AND head.`notification_id` = NEW.`notification_id`
    AND previous.`id` = NEW.`supersedes_notification_event_id`
    AND previous.`version` + 1 = NEW.`version`
    AND previous.`patient_id` = NEW.`patient_id`
    AND previous.`purpose` = NEW.`purpose`
    AND previous.`channel` = NEW.`channel`
    AND previous.`language` = NEW.`language`
    AND previous.`consent_event_id` = NEW.`consent_event_id`
    AND previous.`template_version_id` = NEW.`template_version_id`
    AND previous.`policy_version_id` = NEW.`policy_version_id`
    AND previous.`source_type` = NEW.`source_type`
    AND previous.`source_record_id` = NEW.`source_record_id`
    AND previous.`source_version_id` = NEW.`source_version_id`
    AND previous.`requested_at` = NEW.`requested_at`
    AND previous.`scheduled_at` = NEW.`scheduled_at`
    AND previous.`destination_hint` = NEW.`destination_hint`
    AND previous.`destination_fingerprint` = NEW.`destination_fingerprint`
    AND previous.`rendered_body` = NEW.`rendered_body`
    AND previous.`template_values_json` IS NEW.`template_values_json`
    AND previous.`content_hash` = NEW.`content_hash`
    AND previous.`outbox_event_id` = NEW.`outbox_event_id`
    AND previous.`failure_owner_membership_id` = NEW.`failure_owner_membership_id`
    AND NEW.`attempt_count` BETWEEN previous.`attempt_count` AND previous.`attempt_count` + 1
    AND (
      (previous.`state` = 'scheduled' AND NEW.`state` IN ('deferred_quiet_hours', 'retry_scheduled', 'provider_unavailable', 'manual_contact_required', 'suppressed_opt_out', 'cancelled_source', 'cancelled_by_staff'))
      OR (previous.`state` = 'deferred_quiet_hours' AND NEW.`state` IN ('retry_scheduled', 'provider_unavailable', 'manual_contact_required', 'suppressed_opt_out', 'cancelled_source', 'cancelled_by_staff'))
      OR (previous.`state` = 'retry_scheduled' AND NEW.`state` IN ('retry_scheduled', 'provider_unavailable', 'manual_contact_required', 'suppressed_opt_out', 'cancelled_source', 'cancelled_by_staff'))
      OR (previous.`state` = 'provider_unavailable' AND NEW.`state` IN ('retry_scheduled', 'manual_contact_required'))
      OR (previous.`state` = 'manual_contact_required' AND NEW.`state` IN ('patient_replied', 'manual_contact_completed', 'cancelled_by_staff'))
      OR (previous.`state` = 'patient_replied' AND NEW.`state` = 'manual_contact_completed')
    )
)
BEGIN SELECT RAISE(ABORT, 'notification event must extend the current immutable state'); END;
--> statement-breakpoint
CREATE TRIGGER `communication_manual_task_events_require_scoped_response`
BEFORE INSERT ON `communication_manual_task_events`
WHEN NEW.`response_id` IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM `communication_patient_responses` response
  WHERE response.`organization_id` = NEW.`organization_id`
    AND response.`facility_id` = NEW.`facility_id`
    AND response.`manual_task_id` = NEW.`task_id`
    AND response.`notification_id` = NEW.`notification_id`
    AND response.`id` = NEW.`response_id`
)
BEGIN SELECT RAISE(ABORT, 'manual task response must belong to the same task and notification'); END;
