CREATE TABLE `local_material_heads` (
	`material_id` text NOT NULL,
	`payload_kind` text NOT NULL,
	`receipt_id` text NOT NULL,
	`revision` integer NOT NULL,
	PRIMARY KEY(`material_id`, `payload_kind`),
	FOREIGN KEY (`receipt_id`) REFERENCES `local_material_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "local_material_head_kind" CHECK("local_material_heads"."payload_kind" in ('audio', 'transcript')),
	CONSTRAINT "local_material_head_revision" CHECK(typeof("local_material_heads"."revision") = 'integer' and "local_material_heads"."revision" between 1 and 9007199254740991)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_material_heads_receipt_uidx` ON `local_material_heads` (`receipt_id`);--> statement-breakpoint
CREATE TABLE `local_material_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`reservation_id` text NOT NULL,
	`envelope_hash` text NOT NULL,
	`envelope_bytes` integer NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`reservation_id`) REFERENCES `local_material_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "local_material_receipt_id_valid" CHECK(typeof("local_material_receipts"."id") = 'text' and length("local_material_receipts"."id") between 1 and 128 and "local_material_receipts"."id" = trim("local_material_receipts"."id")),
	CONSTRAINT "local_material_receipt_envelope_hash" CHECK(length("local_material_receipts"."envelope_hash") = 64 and "local_material_receipts"."envelope_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "local_material_receipt_envelope_bytes" CHECK(typeof("local_material_receipts"."envelope_bytes") = 'integer' and "local_material_receipts"."envelope_bytes" between 1 and 2097152),
	CONSTRAINT "local_material_receipt_clock" CHECK(typeof("local_material_receipts"."created_at") = 'integer' and "local_material_receipts"."created_at" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_material_receipts_reservation_uidx` ON `local_material_receipts` (`reservation_id`);--> statement-breakpoint
CREATE TABLE `local_material_registry_events` (
	`reservation_id` text NOT NULL,
	`event_type` text NOT NULL,
	`occurred_at` integer NOT NULL,
	PRIMARY KEY(`reservation_id`, `event_type`),
	FOREIGN KEY (`reservation_id`) REFERENCES `local_material_reservations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "local_material_registry_event_type" CHECK("local_material_registry_events"."event_type" in ('reserved', 'prepared', 'committed', 'retired')),
	CONSTRAINT "local_material_registry_event_clock" CHECK(typeof("local_material_registry_events"."occurred_at") = 'integer' and "local_material_registry_events"."occurred_at" > 0)
);
--> statement-breakpoint
CREATE TABLE `local_material_reservations` (
	`id` text PRIMARY KEY NOT NULL,
	`request_hash` text NOT NULL,
	`descriptor_json` text NOT NULL,
	`payload_kind` text NOT NULL,
	`material_id` text NOT NULL,
	`recording_run_id` text NOT NULL,
	`owner_user_id` text NOT NULL,
	`revision` integer NOT NULL,
	`expected_receipt_id` text,
	`authority_fingerprint` text NOT NULL,
	`session_id` text NOT NULL,
	`key_id` text NOT NULL,
	`policy_id` text NOT NULL,
	`wrapping_provider_id` text NOT NULL,
	`wrapping_key_ref` text,
	`wrapped_key` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`state` text NOT NULL,
	`retire_reason` text,
	FOREIGN KEY (`owner_user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`expected_receipt_id`) REFERENCES `local_material_receipts`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`session_id`) REFERENCES `staff_sessions`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "local_material_reservation_id_valid" CHECK(typeof("local_material_reservations"."id") = 'text' and length("local_material_reservations"."id") between 1 and 128 and "local_material_reservations"."id" = trim("local_material_reservations"."id")),
	CONSTRAINT "local_material_reservation_request_hash" CHECK(length("local_material_reservations"."request_hash") = 64 and "local_material_reservations"."request_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "local_material_reservation_authority_hash" CHECK(length("local_material_reservations"."authority_fingerprint") = 64 and "local_material_reservations"."authority_fingerprint" not glob '*[^0-9a-f]*'),
	CONSTRAINT "local_material_reservation_descriptor" CHECK(json_valid("local_material_reservations"."descriptor_json") and length("local_material_reservations"."descriptor_json") <= 16384),
	CONSTRAINT "local_material_reservation_material_valid" CHECK(length("local_material_reservations"."material_id") between 1 and 256 and "local_material_reservations"."material_id" = trim("local_material_reservations"."material_id") and length("local_material_reservations"."recording_run_id") between 1 and 256 and "local_material_reservations"."recording_run_id" = trim("local_material_reservations"."recording_run_id")),
	CONSTRAINT "local_material_reservation_revision_valid" CHECK(typeof("local_material_reservations"."revision") = 'integer' and "local_material_reservations"."revision" between 1 and 9007199254740991),
	CONSTRAINT "local_material_reservation_key_valid" CHECK(length("local_material_reservations"."key_id") between 16 and 128 and "local_material_reservations"."key_id" not glob '*[^A-Za-z0-9_-]*'),
	CONSTRAINT "local_material_reservation_policy_valid" CHECK(length("local_material_reservations"."policy_id") between 1 and 256 and "local_material_reservations"."policy_id" = trim("local_material_reservations"."policy_id") and length("local_material_reservations"."wrapping_provider_id") between 1 and 256 and "local_material_reservations"."wrapping_provider_id" = trim("local_material_reservations"."wrapping_provider_id")),
	CONSTRAINT "local_material_reservation_wrap_pair" CHECK(("local_material_reservations"."wrapping_key_ref" is null and "local_material_reservations"."wrapped_key" is null) or (typeof("local_material_reservations"."wrapping_key_ref") = 'text' and length("local_material_reservations"."wrapping_key_ref") between 1 and 256 and typeof("local_material_reservations"."wrapped_key") = 'text' and length("local_material_reservations"."wrapped_key") between 1 and 16384)),
	CONSTRAINT "local_material_reservation_clock" CHECK(typeof("local_material_reservations"."created_at") = 'integer' and "local_material_reservations"."created_at" > 0 and typeof("local_material_reservations"."expires_at") = 'integer' and "local_material_reservations"."expires_at" = "local_material_reservations"."created_at" + 120000 and "local_material_reservations"."expires_at" <= 9007199254740991),
	CONSTRAINT "local_material_reservation_kind" CHECK("local_material_reservations"."payload_kind" in ('audio', 'transcript')),
	CONSTRAINT "local_material_reservation_state" CHECK("local_material_reservations"."state" in ('preparing', 'prepared', 'committed', 'retired')),
	CONSTRAINT "local_material_reservation_state_wrap" CHECK(("local_material_reservations"."state" = 'preparing' and "local_material_reservations"."wrapped_key" is null) or ("local_material_reservations"."state" in ('prepared', 'committed') and "local_material_reservations"."wrapped_key" is not null) or "local_material_reservations"."state" = 'retired'),
	CONSTRAINT "local_material_reservation_retirement" CHECK(("local_material_reservations"."state" <> 'retired' and "local_material_reservations"."retire_reason" is null) or ("local_material_reservations"."state" = 'retired' and "local_material_reservations"."retire_reason" is not null and "local_material_reservations"."retire_reason" in ('expired', 'cancelled', 'authority_changed', 'preparation_failed')))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `local_material_reservations_key_uidx` ON `local_material_reservations` (`key_id`);--> statement-breakpoint
CREATE INDEX `local_material_reservations_stream_idx` ON `local_material_reservations` (`material_id`,`payload_kind`,`revision`);--> statement-breakpoint
CREATE INDEX `local_material_reservations_owner_idx` ON `local_material_reservations` (`owner_user_id`,`state`);
--> statement-breakpoint
-- INTERNAL STORAGE ONLY: these guards establish state/identity/CAS integrity,
-- not current clinical authority, policy approval, key custody or key release.
CREATE TRIGGER local_material_reservations_insert_guard
BEFORE INSERT ON local_material_reservations
WHEN EXISTS (SELECT 1 FROM local_material_reservations WHERE id = NEW.id OR key_id = NEW.key_id)
  OR NEW.state <> 'preparing' OR NEW.wrapping_key_ref IS NOT NULL OR NEW.wrapped_key IS NOT NULL
  OR NEW.retire_reason IS NOT NULL
  OR NEW.created_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR json_type(NEW.descriptor_json) IS NOT 'object'
  OR json_extract(NEW.descriptor_json, '$.schema') IS NOT 'orion-local-material/v1'
  OR json_extract(NEW.descriptor_json, '$.owner.audience') IS NOT 'staff'
  OR json_extract(NEW.descriptor_json, '$.owner.userId') IS NOT NEW.owner_user_id
  OR json_extract(NEW.descriptor_json, '$.localMaterialId') IS NOT NEW.material_id
  OR json_extract(NEW.descriptor_json, '$.recordingRunId') IS NOT NEW.recording_run_id
  OR json_type(NEW.descriptor_json, '$.revision') IS NOT 'integer'
  OR json_extract(NEW.descriptor_json, '$.revision') IS NOT NEW.revision
  OR NOT EXISTS (SELECT 1 FROM staff_sessions WHERE id = NEW.session_id AND user_id = NEW.owner_user_id)
  OR EXISTS (
    SELECT 1 FROM local_material_reservations previous WHERE previous.material_id = NEW.material_id
      AND (previous.owner_user_id IS NOT NEW.owner_user_id OR previous.recording_run_id IS NOT NEW.recording_run_id
        OR json_extract(previous.descriptor_json, '$.owner.issuer') IS NOT json_extract(NEW.descriptor_json, '$.owner.issuer')
        OR json_extract(previous.descriptor_json, '$.owner.subject') IS NOT json_extract(NEW.descriptor_json, '$.owner.subject')
        OR json_extract(previous.descriptor_json, '$.owner.organizationId') IS NOT json_extract(NEW.descriptor_json, '$.owner.organizationId')
        OR json_extract(previous.descriptor_json, '$.owner.facilityId') IS NOT json_extract(NEW.descriptor_json, '$.owner.facilityId')
        OR json_extract(previous.descriptor_json, '$.owner.accessAssignmentId') IS NOT json_extract(NEW.descriptor_json, '$.owner.accessAssignmentId')
        OR json_extract(previous.descriptor_json, '$.owner.patientId') IS NOT json_extract(NEW.descriptor_json, '$.owner.patientId')
        OR json_extract(previous.descriptor_json, '$.owner.encounterId') IS NOT json_extract(NEW.descriptor_json, '$.owner.encounterId'))
  )
  OR (NEW.expected_receipt_id IS NULL AND (NEW.revision <> 1 OR EXISTS (
    SELECT 1 FROM local_material_heads WHERE material_id = NEW.material_id AND payload_kind = NEW.payload_kind)))
  OR (NEW.expected_receipt_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM local_material_heads WHERE material_id = NEW.material_id AND payload_kind = NEW.payload_kind
      AND receipt_id = NEW.expected_receipt_id AND revision = NEW.revision - 1))
BEGIN SELECT RAISE(ABORT, 'invalid local material reservation'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_reservations_update_guard
BEFORE UPDATE ON local_material_reservations
WHEN OLD.state IN ('committed', 'retired')
  OR NEW.id IS NOT OLD.id OR NEW.request_hash IS NOT OLD.request_hash
  OR NEW.descriptor_json IS NOT OLD.descriptor_json OR NEW.payload_kind IS NOT OLD.payload_kind
  OR NEW.material_id IS NOT OLD.material_id OR NEW.recording_run_id IS NOT OLD.recording_run_id
  OR NEW.owner_user_id IS NOT OLD.owner_user_id OR NEW.revision IS NOT OLD.revision
  OR NEW.expected_receipt_id IS NOT OLD.expected_receipt_id
  OR NEW.authority_fingerprint IS NOT OLD.authority_fingerprint OR NEW.session_id IS NOT OLD.session_id
  OR NEW.key_id IS NOT OLD.key_id OR NEW.policy_id IS NOT OLD.policy_id
  OR NEW.wrapping_provider_id IS NOT OLD.wrapping_provider_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
  OR NOT EXISTS (SELECT 1 FROM local_material_registry_events WHERE reservation_id = OLD.id AND event_type = 'reserved')
  OR (OLD.state = 'prepared' AND NOT EXISTS (
    SELECT 1 FROM local_material_registry_events WHERE reservation_id = OLD.id AND event_type = 'prepared'))
  OR NOT (
    (OLD.state = 'preparing' AND NEW.state = 'prepared' AND NEW.retire_reason IS NULL
      AND NEW.wrapping_key_ref IS NOT NULL AND NEW.wrapped_key IS NOT NULL
      AND NEW.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER))
    OR (OLD.state = 'prepared' AND NEW.state = 'committed' AND NEW.retire_reason IS NULL
      AND NEW.wrapping_key_ref IS OLD.wrapping_key_ref AND NEW.wrapped_key IS OLD.wrapped_key
      AND NEW.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND EXISTS (SELECT 1 FROM local_material_receipts receipt JOIN local_material_heads head ON head.receipt_id = receipt.id
        WHERE receipt.reservation_id = OLD.id AND head.material_id = OLD.material_id
          AND head.payload_kind = OLD.payload_kind AND head.revision = OLD.revision
          AND receipt.created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)))
    OR (NEW.state = 'retired' AND NEW.retire_reason IS NOT NULL
      AND NEW.wrapping_key_ref IS OLD.wrapping_key_ref AND NEW.wrapped_key IS OLD.wrapped_key
      AND (NEW.retire_reason <> 'expired' OR NEW.expires_at <= CAST(unixepoch('subsec') * 1000 AS INTEGER)))
  )
BEGIN SELECT RAISE(ABORT, 'local material reservation is immutable or transition is invalid'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_reservations_no_delete BEFORE DELETE ON local_material_reservations
BEGIN SELECT RAISE(ABORT, 'local material reservations are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_registry_events_insert_guard BEFORE INSERT ON local_material_registry_events
WHEN EXISTS (SELECT 1 FROM local_material_registry_events WHERE reservation_id = NEW.reservation_id AND event_type = NEW.event_type)
  OR NEW.occurred_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NOT EXISTS (
    SELECT 1 FROM local_material_reservations reservation WHERE reservation.id = NEW.reservation_id
      AND ((NEW.event_type = 'reserved' AND reservation.state = 'preparing' AND reservation.created_at = NEW.occurred_at)
        OR (NEW.event_type = 'prepared' AND reservation.state = 'prepared')
        OR (NEW.event_type = 'committed' AND reservation.state = 'committed')
        OR (NEW.event_type = 'retired' AND reservation.state = 'retired')))
BEGIN SELECT RAISE(ABORT, 'invalid local material registry event'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_registry_events_no_update BEFORE UPDATE ON local_material_registry_events
BEGIN SELECT RAISE(ABORT, 'local material registry events are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_registry_events_no_delete BEFORE DELETE ON local_material_registry_events
BEGIN SELECT RAISE(ABORT, 'local material registry events are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_reservations_publish_insert AFTER INSERT ON local_material_reservations
BEGIN
  INSERT INTO local_material_registry_events (reservation_id, event_type, occurred_at)
    VALUES (NEW.id, 'reserved', NEW.created_at);
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM local_material_registry_events
    WHERE reservation_id = NEW.id AND event_type = 'reserved' AND occurred_at = NEW.created_at)
    THEN RAISE(ABORT, 'local material reservation event was not published') END;
END;
--> statement-breakpoint
CREATE TRIGGER local_material_reservations_publish_update AFTER UPDATE ON local_material_reservations
BEGIN
  INSERT INTO local_material_registry_events (reservation_id, event_type, occurred_at)
    VALUES (NEW.id, NEW.state, CAST(unixepoch('subsec') * 1000 AS INTEGER));
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM local_material_registry_events
    WHERE reservation_id = NEW.id AND event_type = NEW.state AND occurred_at = CAST(unixepoch('subsec') * 1000 AS INTEGER))
    THEN RAISE(ABORT, 'local material transition event was not published') END;
END;
--> statement-breakpoint
CREATE TRIGGER local_material_heads_insert_guard BEFORE INSERT ON local_material_heads
WHEN EXISTS (SELECT 1 FROM local_material_heads
    WHERE (material_id = NEW.material_id AND payload_kind = NEW.payload_kind) OR receipt_id = NEW.receipt_id)
  OR NEW.revision <> 1
  OR NOT EXISTS (
    SELECT 1 FROM local_material_receipts receipt JOIN local_material_reservations reservation ON reservation.id = receipt.reservation_id
    WHERE receipt.id = NEW.receipt_id AND reservation.material_id = NEW.material_id
      AND reservation.payload_kind = NEW.payload_kind AND reservation.revision = NEW.revision
      AND reservation.expected_receipt_id IS NULL AND reservation.state = 'prepared'
      AND reservation.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND receipt.created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER))
BEGIN SELECT RAISE(ABORT, 'invalid initial local material head'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_heads_update_guard BEFORE UPDATE ON local_material_heads
WHEN NEW.material_id IS NOT OLD.material_id OR NEW.payload_kind IS NOT OLD.payload_kind
  OR NEW.receipt_id IS OLD.receipt_id OR NEW.revision <> OLD.revision + 1
  OR NOT EXISTS (
    SELECT 1 FROM local_material_receipts receipt JOIN local_material_reservations reservation ON reservation.id = receipt.reservation_id
    WHERE receipt.id = NEW.receipt_id AND reservation.material_id = OLD.material_id
      AND reservation.payload_kind = OLD.payload_kind AND reservation.revision = NEW.revision
      AND reservation.expected_receipt_id = OLD.receipt_id AND reservation.state = 'prepared'
      AND reservation.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND receipt.created_at = CAST(unixepoch('subsec') * 1000 AS INTEGER))
BEGIN SELECT RAISE(ABORT, 'local material head must advance its exact predecessor'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_heads_no_delete BEFORE DELETE ON local_material_heads
BEGIN SELECT RAISE(ABORT, 'local material heads are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_receipts_insert_guard BEFORE INSERT ON local_material_receipts
WHEN EXISTS (SELECT 1 FROM local_material_receipts WHERE id = NEW.id OR reservation_id = NEW.reservation_id)
  OR NEW.created_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NOT EXISTS (
    SELECT 1 FROM local_material_reservations reservation WHERE reservation.id = NEW.reservation_id
      AND reservation.state = 'prepared' AND reservation.expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND EXISTS (SELECT 1 FROM local_material_registry_events WHERE reservation_id = reservation.id AND event_type = 'prepared')
      AND ((reservation.expected_receipt_id IS NULL AND reservation.revision = 1 AND NOT EXISTS (
          SELECT 1 FROM local_material_heads WHERE material_id = reservation.material_id AND payload_kind = reservation.payload_kind))
        OR (reservation.expected_receipt_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM local_material_heads WHERE material_id = reservation.material_id AND payload_kind = reservation.payload_kind
            AND receipt_id = reservation.expected_receipt_id AND revision = reservation.revision - 1))))
BEGIN SELECT RAISE(ABORT, 'local material commit requires a prepared current reservation'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_receipts_no_update BEFORE UPDATE ON local_material_receipts
BEGIN SELECT RAISE(ABORT, 'local material receipts are immutable'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_receipts_no_delete BEFORE DELETE ON local_material_receipts
BEGIN SELECT RAISE(ABORT, 'local material receipts are permanent'); END;
--> statement-breakpoint
CREATE TRIGGER local_material_receipts_publish_insert AFTER INSERT ON local_material_receipts
BEGIN
  INSERT INTO local_material_heads (material_id, payload_kind, receipt_id, revision)
    SELECT material_id, payload_kind, NEW.id, revision FROM local_material_reservations
      WHERE id = NEW.reservation_id AND expected_receipt_id IS NULL;
  UPDATE local_material_heads SET receipt_id = NEW.id, revision = revision + 1
    WHERE EXISTS (SELECT 1 FROM local_material_reservations reservation
      WHERE reservation.id = NEW.reservation_id AND reservation.expected_receipt_id = local_material_heads.receipt_id
        AND reservation.material_id = local_material_heads.material_id AND reservation.payload_kind = local_material_heads.payload_kind
        AND reservation.revision = local_material_heads.revision + 1);
  UPDATE local_material_reservations SET state = 'committed' WHERE id = NEW.reservation_id AND state = 'prepared';
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM local_material_reservations reservation
    JOIN local_material_heads head ON head.material_id = reservation.material_id AND head.payload_kind = reservation.payload_kind
    JOIN local_material_registry_events event ON event.reservation_id = reservation.id AND event.event_type = 'committed'
    WHERE reservation.id = NEW.reservation_id AND reservation.state = 'committed'
      AND head.receipt_id = NEW.id AND head.revision = reservation.revision AND event.occurred_at = NEW.created_at)
    THEN RAISE(ABORT, 'local material commit was not published atomically') END;
END;
