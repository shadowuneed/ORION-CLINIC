CREATE TABLE `protocol_amendments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`base_protocol_version_id` text NOT NULL,
	`amended_protocol_version_id` text NOT NULL,
	`reason` text NOT NULL,
	`amendment_text` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`base_protocol_version_id`) REFERENCES `protocol_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`amended_protocol_version_id`) REFERENCES `protocol_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`base_protocol_version_id`) REFERENCES `protocol_versions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`amended_protocol_version_id`) REFERENCES `protocol_versions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "protocol_amendments_versions_distinct" CHECK("protocol_amendments"."base_protocol_version_id" <> "protocol_amendments"."amended_protocol_version_id"),
	CONSTRAINT "protocol_amendments_reason_length" CHECK(length(trim("protocol_amendments"."reason")) between 10 and 500),
	CONSTRAINT "protocol_amendments_text_length" CHECK(length(trim("protocol_amendments"."amendment_text")) between 1 and 8000)
);
--> statement-breakpoint
CREATE INDEX `protocol_amendments_encounter_time_idx` ON `protocol_amendments` (`encounter_id`,`created_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `protocol_amendments_amended_protocol_uidx` ON `protocol_amendments` (`amended_protocol_version_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `protocol_amendments_scope_id_uidx` ON `protocol_amendments` (`organization_id`,`facility_id`,`id`);
--> statement-breakpoint
CREATE TRIGGER `protocol_amendments_lineage_guard`
BEFORE INSERT ON `protocol_amendments`
WHEN NOT EXISTS (
  SELECT 1
  FROM `protocol_versions` base
  JOIN `protocol_versions` amended
    ON amended.`organization_id` = base.`organization_id`
    AND amended.`facility_id` = base.`facility_id`
    AND amended.`encounter_id` = base.`encounter_id`
    AND amended.`supersedes_protocol_version_id` = base.`id`
    AND amended.`version` = base.`version` + 1
  WHERE base.`organization_id` = NEW.`organization_id`
    AND base.`facility_id` = NEW.`facility_id`
    AND base.`encounter_id` = NEW.`encounter_id`
    AND base.`id` = NEW.`base_protocol_version_id`
    AND base.`status` = 'signed'
    AND amended.`id` = NEW.`amended_protocol_version_id`
    AND amended.`status` = 'signed'
    AND amended.`signed_by_membership_id` = NEW.`created_by_membership_id`
    AND amended.`signed_at` = NEW.`created_at`
)
BEGIN
  SELECT RAISE(ABORT, 'protocol amendment must link consecutive signed versions');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_amendments_no_update`
BEFORE UPDATE ON `protocol_amendments`
BEGIN
  SELECT RAISE(ABORT, 'protocol amendment is append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_amendments_no_delete`
BEFORE DELETE ON `protocol_amendments`
BEGIN
  SELECT RAISE(ABORT, 'protocol amendment is append-only');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `encounters_finalized_update_guard`;
--> statement-breakpoint
CREATE TRIGGER `encounters_finalized_update_guard`
BEFORE UPDATE ON `encounters`
WHEN OLD.`status` IN ('finalized', 'amended')
  AND NOT (
    NEW.`status` = 'amended'
    AND NEW.`version` = OLD.`version` + 1
    AND NEW.`updated_at` >= OLD.`updated_at`
    AND NEW.`id` IS OLD.`id`
    AND NEW.`organization_id` IS OLD.`organization_id`
    AND NEW.`facility_id` IS OLD.`facility_id`
    AND NEW.`patient_id` IS OLD.`patient_id`
    AND NEW.`clinician_membership_id` IS OLD.`clinician_membership_id`
    AND NEW.`reason_for_visit` IS OLD.`reason_for_visit`
    AND NEW.`started_at` IS OLD.`started_at`
    AND NEW.`ended_at` IS OLD.`ended_at`
    AND NEW.`finalized_at` IS OLD.`finalized_at`
    AND NEW.`created_at` IS OLD.`created_at`
    AND EXISTS (
      SELECT 1
      FROM `protocol_amendments` amendment
      JOIN `protocol_heads` head
        ON head.`organization_id` = amendment.`organization_id`
        AND head.`facility_id` = amendment.`facility_id`
        AND head.`encounter_id` = amendment.`encounter_id`
        AND head.`current_protocol_version_id` = amendment.`amended_protocol_version_id`
        AND head.`current_signed_protocol_version_id` = amendment.`amended_protocol_version_id`
      WHERE amendment.`organization_id` = OLD.`organization_id`
        AND amendment.`facility_id` = OLD.`facility_id`
        AND amendment.`encounter_id` = OLD.`id`
        AND amendment.`created_by_membership_id` = OLD.`clinician_membership_id`
        AND amendment.`created_at` = NEW.`updated_at`
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'finalized encounter requires a linked signed amendment');
END;
