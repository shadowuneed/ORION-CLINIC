CREATE TRIGGER `clinical_section_versions_state_content_valid`
BEFORE INSERT ON `clinical_section_versions`
WHEN
  (NEW.`review_state` IN ('empty', 'explicitly_absent') AND length(trim(NEW.`content`)) <> 0)
  OR (NEW.`review_state` IN ('ai_draft', 'clinician_edited', 'reviewed') AND length(trim(NEW.`content`)) = 0)
  OR (NEW.`review_state` IN ('reviewed', 'explicitly_absent') AND (NEW.`reviewed_by_membership_id` IS NULL OR NEW.`reviewed_at` IS NULL))
  OR (NEW.`review_state` NOT IN ('reviewed', 'explicitly_absent') AND (NEW.`reviewed_by_membership_id` IS NOT NULL OR NEW.`reviewed_at` IS NOT NULL))
BEGIN
  SELECT RAISE(ABORT, 'clinical section state, content, and reviewer must be consistent');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_section_versions_requires_current_head`
BEFORE INSERT ON `clinical_section_versions`
WHEN NEW.`version` > 1
  AND NOT EXISTS (
    SELECT 1 FROM `clinical_section_heads` head
    WHERE head.`organization_id` = NEW.`organization_id`
      AND head.`facility_id` = NEW.`facility_id`
      AND head.`encounter_id` = NEW.`encounter_id`
      AND head.`code` = NEW.`code`
      AND head.`current_version_id` = NEW.`supersedes_section_version_id`
      AND head.`lock_version` = NEW.`version` - 1
  )
BEGIN
  SELECT RAISE(ABORT, 'clinical section version must extend the current head');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_section_heads_initial_version_only`
BEFORE INSERT ON `clinical_section_heads`
WHEN NEW.`lock_version` <> 1
  OR NOT EXISTS (
    SELECT 1 FROM `clinical_section_versions` version
    WHERE version.`id` = NEW.`current_version_id`
      AND version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`encounter_id` = NEW.`encounter_id`
      AND version.`code` = NEW.`code`
      AND version.`version` = 1
  )
BEGIN
  SELECT RAISE(ABORT, 'clinical section head must start at version one');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_section_heads_advance_only`
BEFORE UPDATE ON `clinical_section_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`encounter_id` IS NOT OLD.`encounter_id`
  OR NEW.`code` IS NOT OLD.`code`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `clinical_section_versions` version
    WHERE version.`id` = NEW.`current_version_id`
      AND version.`organization_id` = OLD.`organization_id`
      AND version.`facility_id` = OLD.`facility_id`
      AND version.`encounter_id` = OLD.`encounter_id`
      AND version.`code` = OLD.`code`
      AND version.`supersedes_section_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'clinical section head must advance by one version');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_section_heads_no_delete`
BEFORE DELETE ON `clinical_section_heads`
BEGIN
  SELECT RAISE(ABORT, 'clinical section heads cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_extend_current_head`
BEFORE INSERT ON `audit_events`
WHEN NOT EXISTS (
  SELECT 1 FROM `audit_stream_heads` head
  WHERE head.`organization_id` = NEW.`organization_id`
    AND head.`facility_id` = NEW.`facility_id`
    AND head.`last_sequence` = NEW.`sequence` - 1
    AND head.`last_event_hash` IS NEW.`previous_hash`
)
BEGIN
  SELECT RAISE(ABORT, 'audit event must extend the current stream head');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_stream_heads_genesis_only`
BEFORE INSERT ON `audit_stream_heads`
WHEN NEW.`last_sequence` <> 0 OR NEW.`last_event_hash` IS NOT NULL OR NEW.`lock_version` <> 1
BEGIN
  SELECT RAISE(ABORT, 'audit stream head must start at genesis');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_stream_heads_advance_only`
BEFORE UPDATE ON `audit_stream_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`last_sequence` <> OLD.`last_sequence` + 1
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1 FROM `audit_events` event
    WHERE event.`organization_id` = OLD.`organization_id`
      AND event.`facility_id` = OLD.`facility_id`
      AND event.`sequence` = NEW.`last_sequence`
      AND event.`event_hash` = NEW.`last_event_hash`
      AND event.`previous_hash` IS OLD.`last_event_hash`
  )
BEGIN
  SELECT RAISE(ABORT, 'audit stream head must advance by one event');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_stream_heads_no_delete`
BEFORE DELETE ON `audit_stream_heads`
BEGIN
  SELECT RAISE(ABORT, 'audit stream heads cannot be deleted');
END;
--> statement-breakpoint
CREATE TRIGGER `command_idempotency_starts_processing`
BEFORE INSERT ON `command_idempotency`
WHEN NEW.`status` <> 'processing'
  OR NEW.`result_resource_type` IS NOT NULL
  OR NEW.`result_resource_id` IS NOT NULL
  OR NEW.`response_json` IS NOT NULL
  OR NEW.`completed_at` IS NOT NULL
BEGIN
  SELECT RAISE(ABORT, 'idempotency command must start in processing state');
END;
--> statement-breakpoint
CREATE TRIGGER `command_idempotency_complete_once`
BEFORE UPDATE ON `command_idempotency`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`actor_membership_id` IS NOT OLD.`actor_membership_id`
  OR NEW.`operation` IS NOT OLD.`operation`
  OR NEW.`idempotency_key` IS NOT OLD.`idempotency_key`
  OR NEW.`request_hash` IS NOT OLD.`request_hash`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR OLD.`status` <> 'processing'
  OR NEW.`status` NOT IN ('succeeded', 'failed')
  OR NEW.`completed_at` IS NULL
  OR (
    NEW.`status` = 'succeeded'
    AND (
      NEW.`result_resource_type` IS NULL
      OR NEW.`result_resource_id` IS NULL
      OR NEW.`response_json` IS NULL
    )
  )
  OR (
    NEW.`status` = 'failed'
    AND (NEW.`result_resource_type` IS NOT NULL OR NEW.`result_resource_id` IS NOT NULL)
  )
  OR (
    NEW.`status` = 'succeeded'
    AND NEW.`result_resource_type` = 'clinical_section_version'
    AND NOT EXISTS (
      SELECT 1 FROM `clinical_section_versions` version
      JOIN `clinical_section_heads` head
        ON head.`organization_id` = version.`organization_id`
        AND head.`facility_id` = version.`facility_id`
        AND head.`encounter_id` = version.`encounter_id`
        AND head.`code` = version.`code`
        AND head.`current_version_id` = version.`id`
      WHERE version.`id` = NEW.`result_resource_id`
        AND version.`organization_id` = NEW.`organization_id`
        AND version.`facility_id` = NEW.`facility_id`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'idempotency command transition is invalid');
END;
--> statement-breakpoint
CREATE TRIGGER `command_idempotency_no_delete`
BEFORE DELETE ON `command_idempotency`
BEGIN
  SELECT RAISE(ABORT, 'idempotency commands cannot be deleted');
END;
