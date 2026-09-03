CREATE TRIGGER `protocol_heads_initial_version_guard`
BEFORE INSERT ON `protocol_heads`
WHEN NEW.`lock_version` <> 1
  OR NEW.`current_signed_protocol_version_id` IS NOT NULL
  OR NOT EXISTS (
    SELECT 1
    FROM `protocol_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`encounter_id` = NEW.`encounter_id`
      AND version.`id` = NEW.`current_protocol_version_id`
      AND version.`version` = 1
      AND version.`status` = 'draft'
      AND version.`supersedes_protocol_version_id` IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol head must start at unsigned draft version one');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_heads_linear_advance`
BEFORE UPDATE ON `protocol_heads`
WHEN NOT (
  NEW.`id` IS OLD.`id`
  AND NEW.`organization_id` IS OLD.`organization_id`
  AND NEW.`facility_id` IS OLD.`facility_id`
  AND NEW.`encounter_id` IS OLD.`encounter_id`
  AND NEW.`lock_version` = OLD.`lock_version` + 1
  AND NEW.`updated_at` >= OLD.`updated_at`
  AND (
    NEW.`current_signed_protocol_version_id` IS OLD.`current_signed_protocol_version_id`
    OR NEW.`current_signed_protocol_version_id` IS NEW.`current_protocol_version_id`
  )
  AND NOT (
    OLD.`current_signed_protocol_version_id` IS NOT NULL
    AND NEW.`current_signed_protocol_version_id` IS NULL
  )
  AND EXISTS (
    SELECT 1
    FROM `protocol_versions` previous
    JOIN `protocol_versions` successor
      ON successor.`organization_id` = previous.`organization_id`
      AND successor.`facility_id` = previous.`facility_id`
      AND successor.`encounter_id` = previous.`encounter_id`
      AND successor.`supersedes_protocol_version_id` = previous.`id`
      AND successor.`version` = previous.`version` + 1
    WHERE previous.`organization_id` = OLD.`organization_id`
      AND previous.`facility_id` = OLD.`facility_id`
      AND previous.`encounter_id` = OLD.`encounter_id`
      AND previous.`id` = OLD.`current_protocol_version_id`
      AND successor.`id` = NEW.`current_protocol_version_id`
  )
)
BEGIN
  SELECT RAISE(ABORT, 'protocol head must advance by one immutable version');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_heads_no_delete`
BEFORE DELETE ON `protocol_heads`
BEGIN
  SELECT RAISE(ABORT, 'protocol head cannot be deleted');
END;
