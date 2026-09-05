CREATE TABLE `patient_observation_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`observation_id`) REFERENCES `patient_observation_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `patient_observation_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`observation_id`) REFERENCES `patient_observation_records`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`observation_id`,`current_version_id`) REFERENCES `patient_observation_versions`(`organization_id`,`facility_id`,`observation_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_observation_heads_lock_positive" CHECK("patient_observation_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_observation_heads_scope_record_uidx` ON `patient_observation_heads` (`organization_id`,`facility_id`,`observation_id`);--> statement-breakpoint
CREATE INDEX `patient_observation_heads_patient_idx` ON `patient_observation_heads` (`organization_id`,`facility_id`,`patient_id`,`updated_at`);--> statement-breakpoint
CREATE TABLE `patient_observation_records` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`source_type` text NOT NULL,
	`source_label` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_observation_records_source_enum" CHECK("patient_observation_records"."source_type" in ('manual_test')),
	CONSTRAINT "patient_observation_records_source_label_length" CHECK(length(trim("patient_observation_records"."source_label")) between 3 and 200)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_observation_records_scope_id_uidx` ON `patient_observation_records` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE INDEX `patient_observation_records_patient_idx` ON `patient_observation_records` (`organization_id`,`facility_id`,`patient_id`,`created_at`);--> statement-breakpoint
CREATE TABLE `patient_observation_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`observation_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`version` integer NOT NULL,
	`supersedes_version_id` text,
	`measured_at` integer NOT NULL,
	`measurement_context` text NOT NULL,
	`height_mm` integer,
	`height_unit` text,
	`weight_grams` integer,
	`weight_unit` text,
	`bmi_hundredths` integer,
	`bmi_unit` text,
	`systolic_mmhg` integer,
	`diastolic_mmhg` integer,
	`pressure_unit` text,
	`temperature_milli_c` integer,
	`temperature_unit` text,
	`note` text,
	`recorded_by_membership_id` text NOT NULL,
	`recorded_at` integer NOT NULL,
	`change_reason` text NOT NULL,
	`input_hash` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`observation_id`) REFERENCES `patient_observation_records`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_version_id`) REFERENCES `patient_observation_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recorded_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`observation_id`) REFERENCES `patient_observation_records`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`recorded_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_observation_versions_context_enum" CHECK("patient_observation_versions"."measurement_context" in ('pre_visit', 'consultation', 'follow_up', 'other')),
	CONSTRAINT "patient_observation_versions_height_unit_enum" CHECK("patient_observation_versions"."height_unit" in ('mm')),
	CONSTRAINT "patient_observation_versions_weight_unit_enum" CHECK("patient_observation_versions"."weight_unit" in ('g')),
	CONSTRAINT "patient_observation_versions_bmi_unit_enum" CHECK("patient_observation_versions"."bmi_unit" in ('kg_m2')),
	CONSTRAINT "patient_observation_versions_pressure_unit_enum" CHECK("patient_observation_versions"."pressure_unit" in ('mmHg')),
	CONSTRAINT "patient_observation_versions_temperature_unit_enum" CHECK("patient_observation_versions"."temperature_unit" in ('milli_celsius')),
	CONSTRAINT "patient_observation_versions_version_positive" CHECK("patient_observation_versions"."version" > 0),
	CONSTRAINT "patient_observation_versions_predecessor" CHECK(("patient_observation_versions"."version" = 1 and "patient_observation_versions"."supersedes_version_id" is null) or ("patient_observation_versions"."version" > 1 and "patient_observation_versions"."supersedes_version_id" is not null)),
	CONSTRAINT "patient_observation_versions_has_measurement" CHECK("patient_observation_versions"."height_mm" is not null or "patient_observation_versions"."systolic_mmhg" is not null or "patient_observation_versions"."temperature_milli_c" is not null),
	CONSTRAINT "patient_observation_versions_anthropometry_complete" CHECK(("patient_observation_versions"."height_mm" is null and "patient_observation_versions"."height_unit" is null and "patient_observation_versions"."weight_grams" is null and "patient_observation_versions"."weight_unit" is null and "patient_observation_versions"."bmi_hundredths" is null and "patient_observation_versions"."bmi_unit" is null) or ("patient_observation_versions"."height_mm" between 400 and 2500 and "patient_observation_versions"."height_unit" = 'mm' and "patient_observation_versions"."weight_grams" between 1000 and 500000 and "patient_observation_versions"."weight_unit" = 'g' and "patient_observation_versions"."bmi_hundredths" between 500 and 10000 and "patient_observation_versions"."bmi_unit" = 'kg_m2')),
	CONSTRAINT "patient_observation_versions_bmi_derived" CHECK("patient_observation_versions"."bmi_hundredths" is null or "patient_observation_versions"."bmi_hundredths" = cast((("patient_observation_versions"."weight_grams" * 100000.0) / ("patient_observation_versions"."height_mm" * "patient_observation_versions"."height_mm")) + 0.5 as integer)),
	CONSTRAINT "patient_observation_versions_pressure_complete" CHECK(("patient_observation_versions"."systolic_mmhg" is null and "patient_observation_versions"."diastolic_mmhg" is null and "patient_observation_versions"."pressure_unit" is null) or ("patient_observation_versions"."systolic_mmhg" between 40 and 300 and "patient_observation_versions"."diastolic_mmhg" between 20 and 200 and "patient_observation_versions"."systolic_mmhg" > "patient_observation_versions"."diastolic_mmhg" and "patient_observation_versions"."pressure_unit" = 'mmHg')),
	CONSTRAINT "patient_observation_versions_temperature_complete" CHECK(("patient_observation_versions"."temperature_milli_c" is null and "patient_observation_versions"."temperature_unit" is null) or ("patient_observation_versions"."temperature_milli_c" between 30000 and 45000 and "patient_observation_versions"."temperature_unit" = 'milli_celsius')),
	CONSTRAINT "patient_observation_versions_note_length" CHECK("patient_observation_versions"."note" is null or length(trim("patient_observation_versions"."note")) between 3 and 1000),
	CONSTRAINT "patient_observation_versions_reason_length" CHECK(length(trim("patient_observation_versions"."change_reason")) between 3 and 500),
	CONSTRAINT "patient_observation_versions_input_hash" CHECK(length("patient_observation_versions"."input_hash") = 64 and lower("patient_observation_versions"."input_hash") = "patient_observation_versions"."input_hash")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_observation_versions_scope_version_uidx` ON `patient_observation_versions` (`organization_id`,`facility_id`,`observation_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_observation_versions_scope_id_uidx` ON `patient_observation_versions` (`organization_id`,`facility_id`,`observation_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `patient_observation_versions_supersedes_once_uidx` ON `patient_observation_versions` (`supersedes_version_id`);--> statement-breakpoint
CREATE INDEX `patient_observation_versions_patient_time_idx` ON `patient_observation_versions` (`organization_id`,`facility_id`,`patient_id`,`measured_at`);
--> statement-breakpoint
CREATE TRIGGER patient_observation_records_insert_guard
BEFORE INSERT ON patient_observation_records
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM patients patient
    WHERE patient.organization_id = NEW.organization_id
      AND patient.facility_id = NEW.facility_id
      AND patient.id = NEW.patient_id
      AND patient.status = 'active'
  ) THEN RAISE(ABORT, 'observation patient must be active in scope') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM memberships membership
    JOIN users user ON user.id = membership.user_id
    WHERE membership.organization_id = NEW.organization_id
      AND membership.facility_id = NEW.facility_id
      AND membership.id = NEW.created_by_membership_id
      AND membership.status = 'active'
      AND membership.role IN ('clinician', 'nurse')
      AND user.status = 'active'
  ) THEN RAISE(ABORT, 'observation creator must be an active clinical member') END;
END;
--> statement-breakpoint
CREATE TRIGGER patient_observation_records_no_update
BEFORE UPDATE ON patient_observation_records
BEGIN
  SELECT RAISE(ABORT, 'observation records are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER patient_observation_records_no_delete
BEFORE DELETE ON patient_observation_records
BEGIN
  SELECT RAISE(ABORT, 'observation records are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER patient_observation_versions_insert_guard
BEFORE INSERT ON patient_observation_versions
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM patient_observation_records record
    WHERE record.organization_id = NEW.organization_id
      AND record.facility_id = NEW.facility_id
      AND record.id = NEW.observation_id
      AND record.patient_id = NEW.patient_id
  ) THEN RAISE(ABORT, 'observation version patient mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM memberships membership
    JOIN users user ON user.id = membership.user_id
    WHERE membership.organization_id = NEW.organization_id
      AND membership.facility_id = NEW.facility_id
      AND membership.id = NEW.recorded_by_membership_id
      AND membership.status = 'active'
      AND membership.role IN ('clinician', 'nurse')
      AND user.status = 'active'
  ) THEN RAISE(ABORT, 'observation recorder must be an active clinical member') END;
  SELECT CASE WHEN NEW.measured_at < 946684800000
    OR NEW.measured_at > NEW.recorded_at + 300000
    THEN RAISE(ABORT, 'observation measured_at is outside the accepted clock range') END;
  SELECT CASE WHEN NEW.version = 1 AND EXISTS (
    SELECT 1 FROM patient_observation_heads head
    WHERE head.organization_id = NEW.organization_id
      AND head.facility_id = NEW.facility_id
      AND head.observation_id = NEW.observation_id
  ) THEN RAISE(ABORT, 'observation initial version already has a head') END;
  SELECT CASE WHEN NEW.version > 1 AND NOT EXISTS (
    SELECT 1
    FROM patient_observation_heads head
    JOIN patient_observation_versions previous
      ON previous.organization_id = head.organization_id
      AND previous.facility_id = head.facility_id
      AND previous.observation_id = head.observation_id
      AND previous.id = head.current_version_id
    WHERE head.organization_id = NEW.organization_id
      AND head.facility_id = NEW.facility_id
      AND head.observation_id = NEW.observation_id
      AND head.patient_id = NEW.patient_id
      AND previous.id = NEW.supersedes_version_id
      AND previous.version + 1 = NEW.version
  ) THEN RAISE(ABORT, 'observation version must extend the current head') END;
END;
--> statement-breakpoint
CREATE TRIGGER patient_observation_versions_no_update
BEFORE UPDATE ON patient_observation_versions
BEGIN
  SELECT RAISE(ABORT, 'observation versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER patient_observation_versions_no_delete
BEFORE DELETE ON patient_observation_versions
BEGIN
  SELECT RAISE(ABORT, 'observation versions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER patient_observation_heads_insert_guard
BEFORE INSERT ON patient_observation_heads
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM patient_observation_records record
    JOIN patient_observation_versions current
      ON current.organization_id = record.organization_id
      AND current.facility_id = record.facility_id
      AND current.observation_id = record.id
    WHERE record.organization_id = NEW.organization_id
      AND record.facility_id = NEW.facility_id
      AND record.id = NEW.observation_id
      AND record.patient_id = NEW.patient_id
      AND current.id = NEW.current_version_id
      AND current.patient_id = NEW.patient_id
      AND current.version = 1
      AND current.supersedes_version_id IS NULL
      AND NEW.lock_version = 1
  ) THEN RAISE(ABORT, 'observation head must start at version 1') END;
END;
--> statement-breakpoint
CREATE TRIGGER patient_observation_heads_advance_guard
BEFORE UPDATE ON patient_observation_heads
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NEW.id <> OLD.id
    OR NEW.organization_id <> OLD.organization_id
    OR NEW.facility_id <> OLD.facility_id
    OR NEW.observation_id <> OLD.observation_id
    OR NEW.patient_id <> OLD.patient_id
    OR NEW.created_at <> OLD.created_at
    OR NEW.current_version_id = OLD.current_version_id
    OR NEW.lock_version <> OLD.lock_version + 1
    OR NEW.updated_at < OLD.updated_at
    THEN RAISE(ABORT, 'observation head identity or lock is invalid') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1
    FROM patient_observation_versions next
    JOIN patient_observation_versions previous
      ON previous.organization_id = next.organization_id
      AND previous.facility_id = next.facility_id
      AND previous.observation_id = next.observation_id
      AND previous.id = next.supersedes_version_id
    WHERE next.organization_id = NEW.organization_id
      AND next.facility_id = NEW.facility_id
      AND next.observation_id = NEW.observation_id
      AND next.patient_id = NEW.patient_id
      AND next.id = NEW.current_version_id
      AND previous.id = OLD.current_version_id
      AND next.version = previous.version + 1
  ) THEN RAISE(ABORT, 'observation head must advance to the direct successor') END;
END;
--> statement-breakpoint
CREATE TRIGGER patient_observation_heads_no_delete
BEFORE DELETE ON patient_observation_heads
BEGIN
  SELECT RAISE(ABORT, 'observation heads cannot be deleted');
END;
