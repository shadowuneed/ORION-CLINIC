CREATE TABLE `staff_credential_events` (
	`id` text PRIMARY KEY NOT NULL,
	`credential_id` text NOT NULL,
	`user_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_version` integer NOT NULL,
	`actor_issuer` text NOT NULL,
	`actor_subject` text NOT NULL,
	`action` text NOT NULL,
	`previous_version` integer NOT NULL,
	`version` integer NOT NULL,
	`user_version` integer NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`credential_id`) REFERENCES `staff_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_credential_events_action_valid" CHECK("staff_credential_events"."action" in ('provision', 'reset', 'disable')),
	CONSTRAINT "staff_credential_events_version_valid" CHECK("staff_credential_events"."version" = "staff_credential_events"."previous_version" + 1 and "staff_credential_events"."previous_version" >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_credential_events_version_uidx` ON `staff_credential_events` (`credential_id`,`version`);--> statement-breakpoint
CREATE TABLE `staff_credentials` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`login_normalized` text NOT NULL,
	`identity_issuer` text NOT NULL,
	`identity_subject` text NOT NULL,
	`password_hash` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`user_version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL,
	`event_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_version` integer NOT NULL,
	`actor_issuer` text NOT NULL,
	`actor_subject` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_credentials_login_valid" CHECK(length("staff_credentials"."login_normalized") between 3 and 128 and "staff_credentials"."login_normalized" not glob '*[^a-z0-9._@+-]*' and substr("staff_credentials"."login_normalized", 1, 1) glob '[a-z0-9]'),
	CONSTRAINT "staff_credentials_status_valid" CHECK("staff_credentials"."status" in ('active', 'disabled')),
	CONSTRAINT "staff_credentials_versions_valid" CHECK(typeof("staff_credentials"."version") = 'integer' and "staff_credentials"."version" > 0 and typeof("staff_credentials"."user_version") = 'integer' and "staff_credentials"."user_version" > 1 and typeof("staff_credentials"."actor_version") = 'integer' and "staff_credentials"."actor_version" > 0),
	CONSTRAINT "staff_credentials_times_valid" CHECK(typeof("staff_credentials"."created_at") = 'integer' and "staff_credentials"."created_at" > 0 and typeof("staff_credentials"."updated_at") = 'integer' and "staff_credentials"."updated_at" >= "staff_credentials"."created_at")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_credentials_user_uidx` ON `staff_credentials` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `staff_credentials_login_uidx` ON `staff_credentials` (`login_normalized`);--> statement-breakpoint
CREATE UNIQUE INDEX `staff_credentials_event_uidx` ON `staff_credentials` (`event_id`);--> statement-breakpoint
CREATE TABLE `staff_login_attempts` (
	`id` text PRIMARY KEY NOT NULL,
	`login_normalized` text NOT NULL,
	`credential_id` text,
	`credential_version` integer,
	`user_id` text,
	`user_version` integer,
	`identity_issuer` text,
	`identity_subject` text,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`status` text NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`credential_id`) REFERENCES `staff_credentials`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_login_attempts_login_valid" CHECK(length("staff_login_attempts"."login_normalized") between 3 and 128 and "staff_login_attempts"."login_normalized" not glob '*[^a-z0-9._@+-]*' and substr("staff_login_attempts"."login_normalized", 1, 1) glob '[a-z0-9]'),
	CONSTRAINT "staff_login_attempts_status_valid" CHECK("staff_login_attempts"."status" in ('pending', 'failed', 'verified')),
	CONSTRAINT "staff_login_attempts_times_valid" CHECK(typeof("staff_login_attempts"."created_at") = 'integer' and "staff_login_attempts"."created_at" > 0 and "staff_login_attempts"."expires_at" = "staff_login_attempts"."created_at" + 120000 and ("staff_login_attempts"."completed_at" is null or (typeof("staff_login_attempts"."completed_at") = 'integer' and "staff_login_attempts"."completed_at" >= "staff_login_attempts"."created_at"))),
	CONSTRAINT "staff_login_attempts_snapshot_valid" CHECK(("staff_login_attempts"."credential_id" is null and "staff_login_attempts"."credential_version" is null and "staff_login_attempts"."user_id" is null and "staff_login_attempts"."user_version" is null and "staff_login_attempts"."identity_issuer" is null and "staff_login_attempts"."identity_subject" is null) or ("staff_login_attempts"."credential_id" is not null and "staff_login_attempts"."credential_version" > 0 and "staff_login_attempts"."user_id" is not null and "staff_login_attempts"."user_version" > 0 and "staff_login_attempts"."identity_issuer" is not null and "staff_login_attempts"."identity_subject" is not null)),
	CONSTRAINT "staff_login_attempts_completion_valid" CHECK(("staff_login_attempts"."status" = 'pending' and "staff_login_attempts"."completed_at" is null) or ("staff_login_attempts"."status" <> 'pending' and "staff_login_attempts"."completed_at" is not null))
);
--> statement-breakpoint
CREATE INDEX `staff_login_attempts_window_idx` ON `staff_login_attempts` (`login_normalized`,`created_at`);
--> statement-breakpoint
-- New individual credentials have no connection to clinical roles. These are
-- trusted internal commands; an HTTP administration authorization layer is not mounted.
CREATE TRIGGER staff_credentials_insert_guard BEFORE INSERT ON staff_credentials
WHEN NEW.version <> 1 OR NEW.status <> 'active'
  OR EXISTS (SELECT 1 FROM staff_credentials WHERE id = NEW.id OR user_id = NEW.user_id OR login_normalized = NEW.login_normalized)
  OR length(NEW.id) NOT BETWEEN 1 AND 128 OR NEW.id <> trim(NEW.id)
  OR length(NEW.event_id) NOT BETWEEN 1 AND 128 OR NEW.event_id <> trim(NEW.event_id)
  OR NEW.created_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER) OR NEW.updated_at <> NEW.created_at
  OR length(NEW.password_hash) <> 123 OR substr(NEW.password_hash, 1, 26) <> 'orion$scrypt$v1$32768$8$3$'
  OR substr(NEW.password_hash, 27, 32) GLOB '*[^0-9a-f]*' OR substr(NEW.password_hash, 59, 1) <> '$'
  OR substr(NEW.password_hash, 60, 64) GLOB '*[^0-9a-f]*'
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND status = 'active'
    AND version = NEW.user_version - 1 AND external_issuer = NEW.identity_issuer AND external_subject = NEW.identity_subject)
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND status = 'active'
    AND version = NEW.actor_version AND external_issuer = NEW.actor_issuer AND external_subject = NEW.actor_subject)
BEGIN SELECT RAISE(ABORT, 'credential provisioning requires exact current identities'); END;
--> statement-breakpoint
CREATE TRIGGER staff_credentials_update_guard BEFORE UPDATE ON staff_credentials
WHEN NEW.id IS NOT OLD.id OR NEW.user_id IS NOT OLD.user_id OR NEW.login_normalized IS NOT OLD.login_normalized
  OR NEW.identity_issuer IS NOT OLD.identity_issuer OR NEW.identity_subject IS NOT OLD.identity_subject
  OR NEW.created_at IS NOT OLD.created_at OR NEW.version <> OLD.version + 1 OR NEW.event_id = OLD.event_id
  OR length(NEW.event_id) NOT BETWEEN 1 AND 128 OR NEW.event_id <> trim(NEW.event_id)
  OR NEW.updated_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NOT (NEW.status = 'active' OR (OLD.status = 'active' AND NEW.status = 'disabled' AND NEW.password_hash = OLD.password_hash))
  OR length(NEW.password_hash) <> 123 OR substr(NEW.password_hash, 1, 26) <> 'orion$scrypt$v1$32768$8$3$'
  OR substr(NEW.password_hash, 27, 32) GLOB '*[^0-9a-f]*' OR substr(NEW.password_hash, 59, 1) <> '$'
  OR substr(NEW.password_hash, 60, 64) GLOB '*[^0-9a-f]*'
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND status = 'active'
    AND version = NEW.user_version - 1 AND external_issuer = NEW.identity_issuer AND external_subject = NEW.identity_subject)
  OR NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.actor_id AND status = 'active'
    AND version = NEW.actor_version AND external_issuer = NEW.actor_issuer AND external_subject = NEW.actor_subject)
BEGIN SELECT RAISE(ABORT, 'credential change requires current versions and exact identities'); END;
--> statement-breakpoint
CREATE TRIGGER staff_credentials_no_delete BEFORE DELETE ON staff_credentials
BEGIN SELECT RAISE(ABORT, 'credential identity cannot be deleted or reassigned'); END;
--> statement-breakpoint
CREATE TRIGGER staff_credential_events_insert_guard BEFORE INSERT ON staff_credential_events
WHEN EXISTS (SELECT 1 FROM staff_credential_events WHERE id = NEW.id OR (credential_id = NEW.credential_id AND version = NEW.version))
  OR NOT EXISTS (SELECT 1 FROM staff_credentials credential WHERE credential.id = NEW.credential_id
    AND credential.event_id = NEW.id AND credential.user_id = NEW.user_id AND credential.version = NEW.version
    AND credential.user_version = NEW.user_version AND credential.actor_id = NEW.actor_id
    AND credential.actor_version = NEW.actor_version AND credential.actor_issuer = NEW.actor_issuer
    AND credential.actor_subject = NEW.actor_subject AND credential.updated_at = NEW.occurred_at
    AND NEW.occurred_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
    AND NEW.action = CASE WHEN NEW.version = 1 THEN 'provision' WHEN credential.status = 'disabled' THEN 'disable' ELSE 'reset' END)
  OR (NEW.version > 1 AND NOT EXISTS (SELECT 1 FROM staff_credential_events
    WHERE credential_id = NEW.credential_id AND version = NEW.previous_version))
BEGIN SELECT RAISE(ABORT, 'credential audit requires matching current publication'); END;
--> statement-breakpoint
CREATE TRIGGER staff_credential_events_no_update BEFORE UPDATE ON staff_credential_events
BEGIN SELECT RAISE(ABORT, 'credential audit is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER staff_credential_events_no_delete BEFORE DELETE ON staff_credential_events
BEGIN SELECT RAISE(ABORT, 'credential audit is append only'); END;
--> statement-breakpoint
CREATE TRIGGER staff_credentials_publish_insert AFTER INSERT ON staff_credentials
BEGIN
  INSERT INTO staff_credential_events (id, credential_id, user_id, actor_id, actor_version, actor_issuer, actor_subject,
    action, previous_version, version, user_version, occurred_at)
  VALUES (NEW.event_id, NEW.id, NEW.user_id, NEW.actor_id, NEW.actor_version, NEW.actor_issuer, NEW.actor_subject,
    'provision', 0, NEW.version, NEW.user_version, NEW.updated_at);
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM staff_credential_events WHERE id = NEW.event_id AND credential_id = NEW.id AND version = NEW.version)
    THEN RAISE(ABORT, 'credential audit was not published') END;
  UPDATE users SET version = NEW.user_version, updated_at = NEW.updated_at WHERE id = NEW.user_id AND version = NEW.user_version - 1;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND version = NEW.user_version)
    THEN RAISE(ABORT, 'credential user epoch was not published') END;
END;
--> statement-breakpoint
CREATE TRIGGER staff_credentials_publish_update AFTER UPDATE ON staff_credentials
BEGIN
  INSERT INTO staff_credential_events (id, credential_id, user_id, actor_id, actor_version, actor_issuer, actor_subject,
    action, previous_version, version, user_version, occurred_at)
  VALUES (NEW.event_id, NEW.id, NEW.user_id, NEW.actor_id, NEW.actor_version, NEW.actor_issuer, NEW.actor_subject,
    CASE WHEN NEW.status = 'disabled' THEN 'disable' ELSE 'reset' END, OLD.version, NEW.version, NEW.user_version, NEW.updated_at);
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM staff_credential_events WHERE id = NEW.event_id AND credential_id = NEW.id AND version = NEW.version)
    THEN RAISE(ABORT, 'credential audit was not published') END;
  UPDATE users SET version = NEW.user_version, updated_at = NEW.updated_at WHERE id = NEW.user_id AND version = NEW.user_version - 1;
  SELECT CASE WHEN NOT EXISTS (SELECT 1 FROM users WHERE id = NEW.user_id AND version = NEW.user_version)
    THEN RAISE(ABORT, 'credential user epoch was not published') END;
END;
--> statement-breakpoint
-- A verified pre-reset grant cannot become valid by restoring an older user epoch.
-- Uncredentialed users keep earlier status/epoch semantics. Ignored inserts have
-- no AFTER INSERT side effects; actual REPLACE of credentialed identities is denied.
-- UPDATE OR REPLACE is neither an INSERT nor an update of the displaced row:
-- immutable primary identity prevents an unrelated row from taking its user id.
CREATE TRIGGER staff_auth_users_id_immutable BEFORE UPDATE ON users
WHEN NEW.id IS NOT OLD.id
BEGIN SELECT RAISE(ABORT, 'user identity id is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER staff_credential_users_epoch_guard BEFORE UPDATE ON users
WHEN EXISTS (SELECT 1 FROM staff_credentials WHERE user_id = OLD.id)
  AND (NEW.version < OLD.version OR typeof(NEW.version) <> 'integer'
    OR ((NEW.status IS NOT OLD.status OR NEW.external_issuer IS NOT OLD.external_issuer OR NEW.external_subject IS NOT OLD.external_subject)
      AND NEW.version <= OLD.version))
BEGIN SELECT RAISE(ABORT, 'credentialed identity requires a monotonic user epoch'); END;
--> statement-breakpoint
CREATE TRIGGER staff_credential_users_replace_guard AFTER INSERT ON users
WHEN EXISTS (SELECT 1 FROM staff_credentials WHERE user_id = NEW.id)
BEGIN SELECT RAISE(ABORT, 'credentialed identity must be updated, not replaced'); END;
--> statement-breakpoint
CREATE TRIGGER staff_login_attempts_insert_guard BEFORE INSERT ON staff_login_attempts
WHEN EXISTS (SELECT 1 FROM staff_login_attempts WHERE id = NEW.id)
  OR length(NEW.id) NOT BETWEEN 1 AND 128 OR NEW.id <> trim(NEW.id)
  OR NEW.status <> 'pending' OR NEW.completed_at IS NOT NULL
  OR NEW.created_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR (SELECT count(*) FROM staff_login_attempts WHERE login_normalized = NEW.login_normalized
    AND created_at > CAST(unixepoch('subsec') * 1000 AS INTEGER) - 300000) >= 5
  OR (NEW.credential_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM staff_credentials credential JOIN users user ON user.id = credential.user_id
    WHERE credential.id = NEW.credential_id AND credential.login_normalized = NEW.login_normalized
      AND credential.version = NEW.credential_version AND credential.status = 'active'
      AND user.id = NEW.user_id AND user.status = 'active' AND user.version = NEW.user_version
      AND user.version = credential.user_version AND user.external_issuer = NEW.identity_issuer
      AND user.external_subject = NEW.identity_subject AND credential.identity_issuer = user.external_issuer
      AND credential.identity_subject = user.external_subject))
BEGIN SELECT RAISE(ABORT, 'login reservation requires current snapshot and remaining capacity'); END;
--> statement-breakpoint
CREATE TRIGGER staff_login_attempts_update_guard BEFORE UPDATE ON staff_login_attempts
WHEN OLD.status <> 'pending' OR NEW.status NOT IN ('failed', 'verified')
  OR NEW.id IS NOT OLD.id OR NEW.login_normalized IS NOT OLD.login_normalized
  OR NEW.credential_id IS NOT OLD.credential_id OR NEW.credential_version IS NOT OLD.credential_version
  OR NEW.user_id IS NOT OLD.user_id OR NEW.user_version IS NOT OLD.user_version
  OR NEW.identity_issuer IS NOT OLD.identity_issuer OR NEW.identity_subject IS NOT OLD.identity_subject
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
  OR NEW.completed_at IS NOT CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR (NEW.status = 'verified' AND (NEW.expires_at <= CAST(unixepoch('subsec') * 1000 AS INTEGER)
    OR NOT EXISTS (SELECT 1 FROM staff_credentials credential JOIN users user ON user.id = credential.user_id
      WHERE credential.id = NEW.credential_id AND credential.version = NEW.credential_version AND credential.status = 'active'
        AND user.id = NEW.user_id AND user.status = 'active' AND user.version = NEW.user_version
        AND credential.user_version = user.version AND user.external_issuer = NEW.identity_issuer
        AND user.external_subject = NEW.identity_subject AND credential.identity_issuer = user.external_issuer
        AND credential.identity_subject = user.external_subject)))
BEGIN SELECT RAISE(ABORT, 'login reservation is immutable or no longer current'); END;
--> statement-breakpoint
CREATE TRIGGER staff_login_attempts_no_delete BEFORE DELETE ON staff_login_attempts
BEGIN SELECT RAISE(ABORT, 'login reservations cannot be deleted to reset throttling'); END;
