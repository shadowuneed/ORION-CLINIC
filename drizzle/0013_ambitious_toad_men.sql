-- `analysis_runs` already has inbound foreign keys from clinical_suggestions.
-- D1 does not allow disabling FK enforcement across the table-rebuild statements
-- emitted by SQLite migration generators, so this forward migration adds only
-- nullable provenance columns and enforces the new scoped membership relation
-- with a trigger. Existing composite tenant/encounter FKs remain unchanged.
ALTER TABLE `analysis_runs` ADD COLUMN `requested_by_membership_id` text;
--> statement-breakpoint
ALTER TABLE `analysis_runs` ADD COLUMN `request_id` text;
--> statement-breakpoint
ALTER TABLE `analysis_runs` ADD COLUMN `consent_event_ids_json` text
  CHECK(`consent_event_ids_json` is null or json_valid(`consent_event_ids_json`));
--> statement-breakpoint
ALTER TABLE `analysis_runs` ADD COLUMN `transcript_acknowledged_at` integer;
--> statement-breakpoint
CREATE TRIGGER `analysis_runs_validate_requester_insert`
BEFORE INSERT ON `analysis_runs`
WHEN NEW.`requested_by_membership_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `memberships`
    WHERE `memberships`.`organization_id` = NEW.`organization_id`
      AND `memberships`.`facility_id` = NEW.`facility_id`
      AND `memberships`.`id` = NEW.`requested_by_membership_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'analysis requester must be a scoped membership');
END;
--> statement-breakpoint
CREATE TRIGGER `analysis_runs_guard_update`
BEFORE UPDATE ON `analysis_runs`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`encounter_id` IS NOT OLD.`encounter_id`
  OR NEW.`kind` IS NOT OLD.`kind`
  OR NEW.`provider` IS NOT OLD.`provider`
  OR NEW.`model` IS NOT OLD.`model`
  OR NEW.`model_version` IS NOT OLD.`model_version`
  OR NEW.`policy_version` IS NOT OLD.`policy_version`
  OR NEW.`input_hash` IS NOT OLD.`input_hash`
  OR NEW.`source_record_ids_json` IS NOT OLD.`source_record_ids_json`
  OR NEW.`requested_by_membership_id` IS NOT OLD.`requested_by_membership_id`
  OR NEW.`request_id` IS NOT OLD.`request_id`
  OR NEW.`consent_event_ids_json` IS NOT OLD.`consent_event_ids_json`
  OR NEW.`transcript_acknowledged_at` IS NOT OLD.`transcript_acknowledged_at`
  OR NEW.`created_at` IS NOT OLD.`created_at`
  OR OLD.`status` NOT IN ('queued', 'running')
  OR (
    OLD.`status` = 'queued'
    AND (NEW.`status` <> 'running' OR NEW.`started_at` IS NULL)
  )
  OR (
    OLD.`status` = 'running'
    AND (
      NEW.`status` NOT IN ('succeeded', 'failed', 'superseded')
      OR NEW.`completed_at` IS NULL
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'invalid analysis run transition');
END;
--> statement-breakpoint
CREATE TRIGGER `analysis_runs_no_delete`
BEFORE DELETE ON `analysis_runs`
BEGIN
  SELECT RAISE(ABORT, 'analysis runs cannot be deleted');
END;
