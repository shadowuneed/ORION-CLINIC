ALTER TABLE `patient_profile_versions`
ADD COLUMN `supersedes_profile_version_id` text
  REFERENCES `patient_profile_versions`(`id`) ON UPDATE no action ON DELETE no action
  CHECK(length(trim(`change_reason`)) > 0);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_profile_versions_supersedes_once_uidx` ON `patient_profile_versions` (`supersedes_profile_version_id`);--> statement-breakpoint
CREATE TRIGGER `patient_profile_versions_extend_current_head`
BEFORE INSERT ON `patient_profile_versions`
WHEN
  (NEW.`version` = 1 AND NEW.`supersedes_profile_version_id` IS NOT NULL)
  OR (
    NEW.`version` > 1
    AND NOT EXISTS (
      SELECT 1
      FROM `patient_profile_heads` head
      JOIN `patient_profile_versions` previous
        ON previous.`organization_id` = head.`organization_id`
        AND previous.`facility_id` = head.`facility_id`
        AND previous.`patient_id` = head.`patient_id`
        AND previous.`id` = head.`current_version_id`
      WHERE head.`organization_id` = NEW.`organization_id`
        AND head.`facility_id` = NEW.`facility_id`
        AND head.`patient_id` = NEW.`patient_id`
        AND head.`current_version_id` = NEW.`supersedes_profile_version_id`
        AND head.`lock_version` = NEW.`version` - 1
        AND previous.`status` = 'active'
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'patient profile version must extend the active current head');
END;--> statement-breakpoint
CREATE TRIGGER `patient_profile_versions_no_update`
BEFORE UPDATE ON `patient_profile_versions`
BEGIN
  SELECT RAISE(ABORT, 'patient profile versions are immutable');
END;--> statement-breakpoint
CREATE TRIGGER `patient_profile_versions_no_delete`
BEFORE DELETE ON `patient_profile_versions`
BEGIN
  SELECT RAISE(ABORT, 'patient profile versions cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `patient_profile_heads_initial_version_only`
BEFORE INSERT ON `patient_profile_heads`
WHEN NEW.`lock_version` <> 1
  OR NOT EXISTS (
    SELECT 1
    FROM `patient_profile_versions` version
    WHERE version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`patient_id` = NEW.`patient_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`version` = 1
      AND version.`supersedes_profile_version_id` IS NULL
  )
BEGIN
  SELECT RAISE(ABORT, 'patient profile head must start at version one');
END;--> statement-breakpoint
CREATE TRIGGER `patient_profile_heads_advance_only`
BEFORE UPDATE ON `patient_profile_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`patient_id` IS NOT OLD.`patient_id`
  OR NEW.`updated_at` < OLD.`updated_at`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NOT EXISTS (
    SELECT 1
    FROM `patient_profile_versions` version
    WHERE version.`organization_id` = OLD.`organization_id`
      AND version.`facility_id` = OLD.`facility_id`
      AND version.`patient_id` = OLD.`patient_id`
      AND version.`id` = NEW.`current_version_id`
      AND version.`supersedes_profile_version_id` = OLD.`current_version_id`
      AND version.`version` = NEW.`lock_version`
  )
BEGIN
  SELECT RAISE(ABORT, 'patient profile head must advance by one immutable version');
END;--> statement-breakpoint
CREATE TRIGGER `patient_profile_heads_no_delete`
BEFORE DELETE ON `patient_profile_heads`
BEGIN
  SELECT RAISE(ABORT, 'patient profile heads cannot be deleted');
END;
