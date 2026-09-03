CREATE TRIGGER `encounters_status_transition_guard`
BEFORE UPDATE ON `encounters`
WHEN NEW.`status` <> OLD.`status`
  AND NOT (
    NEW.`id` IS OLD.`id`
    AND NEW.`organization_id` IS OLD.`organization_id`
    AND NEW.`facility_id` IS OLD.`facility_id`
    AND NEW.`patient_id` IS OLD.`patient_id`
    AND NEW.`clinician_membership_id` IS OLD.`clinician_membership_id`
    AND NEW.`reason_for_visit` IS OLD.`reason_for_visit`
    AND NEW.`created_at` IS OLD.`created_at`
    AND NEW.`version` = OLD.`version` + 1
    AND NEW.`updated_at` >= OLD.`updated_at`
    AND (
      (OLD.`status` = 'draft' AND NEW.`status` IN ('ready', 'cancelled'))
      OR (OLD.`status` = 'ready' AND NEW.`status` IN ('in_progress', 'cancelled'))
      OR (OLD.`status` = 'in_progress' AND NEW.`status` IN ('review', 'cancelled'))
      OR (OLD.`status` = 'review' AND NEW.`status` IN ('in_progress', 'finalized', 'cancelled'))
      OR (OLD.`status` = 'finalized' AND NEW.`status` = 'amended')
      OR (OLD.`status` = 'amended' AND NEW.`status` = 'amended')
    )
    AND (NEW.`status` <> 'in_progress' OR NEW.`started_at` IS NOT NULL)
    AND (
      NEW.`status` NOT IN ('ready', 'in_progress')
      OR EXISTS (
        SELECT 1
        FROM `consent_heads` head
        JOIN `consent_events` event
          ON event.`organization_id` = head.`organization_id`
          AND event.`facility_id` = head.`facility_id`
          AND event.`patient_id` = head.`patient_id`
          AND event.`encounter_id` = head.`encounter_id`
          AND event.`consent_type` = head.`consent_type`
          AND event.`id` = head.`current_consent_event_id`
        WHERE head.`organization_id` = OLD.`organization_id`
          AND head.`facility_id` = OLD.`facility_id`
          AND head.`patient_id` = OLD.`patient_id`
          AND head.`encounter_id` = OLD.`id`
          AND head.`consent_type` = 'care'
          AND event.`decision` = 'granted'
          AND event.`effective_at` <= unixepoch('subsec') * 1000
          AND (
            event.`expires_at` IS NULL
            OR event.`expires_at` > unixepoch('subsec') * 1000
          )
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'encounter status transition is invalid or lacks effective care consent');
END;
