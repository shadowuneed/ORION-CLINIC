CREATE TABLE `staff_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`token_hash` text NOT NULL,
	`user_id` text NOT NULL,
	`user_version` integer NOT NULL,
	`identity_issuer` text NOT NULL,
	`identity_subject` text NOT NULL,
	`created_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	`idle_expires_at` integer NOT NULL,
	`absolute_expires_at` integer NOT NULL,
	`revoked_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "staff_sessions_id_valid" CHECK(length("staff_sessions"."id") between 1 and 128 and "staff_sessions"."id" = trim("staff_sessions"."id")),
	CONSTRAINT "staff_sessions_hash_valid" CHECK(length("staff_sessions"."token_hash") = 64 and "staff_sessions"."token_hash" not glob '*[^0-9a-f]*'),
	CONSTRAINT "staff_sessions_user_version_positive" CHECK(typeof("staff_sessions"."user_version") = 'integer' and "staff_sessions"."user_version" > 0),
	CONSTRAINT "staff_sessions_identity_valid" CHECK(length(trim("staff_sessions"."identity_issuer")) > 0 and length(trim("staff_sessions"."identity_subject")) > 0),
	CONSTRAINT "staff_sessions_created_at_valid" CHECK(typeof("staff_sessions"."created_at") = 'integer' and "staff_sessions"."created_at" > 0),
	CONSTRAINT "staff_sessions_last_seen_valid" CHECK(typeof("staff_sessions"."last_seen_at") = 'integer' and "staff_sessions"."last_seen_at" >= "staff_sessions"."created_at" and "staff_sessions"."last_seen_at" < "staff_sessions"."absolute_expires_at"),
	CONSTRAINT "staff_sessions_absolute_lifetime" CHECK(typeof("staff_sessions"."absolute_expires_at") = 'integer' and "staff_sessions"."absolute_expires_at" = "staff_sessions"."created_at" + 28800000),
	CONSTRAINT "staff_sessions_idle_lifetime" CHECK(typeof("staff_sessions"."idle_expires_at") = 'integer' and "staff_sessions"."idle_expires_at" = min("staff_sessions"."absolute_expires_at", "staff_sessions"."last_seen_at" + 1800000)),
	CONSTRAINT "staff_sessions_revoked_at_valid" CHECK("staff_sessions"."revoked_at" is null or (typeof("staff_sessions"."revoked_at") = 'integer' and "staff_sessions"."revoked_at" > 0)),
	CONSTRAINT "staff_sessions_version_positive" CHECK(typeof("staff_sessions"."version") = 'integer' and "staff_sessions"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `staff_sessions_token_hash_uidx` ON `staff_sessions` (`token_hash`);--> statement-breakpoint
CREATE INDEX `staff_sessions_user_idx` ON `staff_sessions` (`user_id`,`revoked_at`);
--> statement-breakpoint
-- Only a currently active individual principal can receive a new session. All
-- timestamps are derived from the database statement clock, not from a client.
CREATE TRIGGER staff_sessions_insert_guard
BEFORE INSERT ON staff_sessions
WHEN NEW.version <> 1 OR NEW.revoked_at IS NOT NULL
  -- REPLACE may skip delete triggers: explicitly fence every previously used id/hash.
  OR EXISTS (SELECT 1 FROM staff_sessions existing WHERE existing.id = NEW.id OR existing.token_hash = NEW.token_hash)
  OR NEW.created_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NEW.last_seen_at <> NEW.created_at
  OR NOT EXISTS (
    SELECT 1 FROM users user WHERE user.id = NEW.user_id AND user.status = 'active'
      AND user.version = NEW.user_version AND user.external_issuer = NEW.identity_issuer
      AND user.external_subject = NEW.identity_subject
  )
BEGIN SELECT RAISE(ABORT, 'staff session requires current active identity and server time'); END;
--> statement-breakpoint
-- A token, principal snapshot, creation time and absolute deadline are permanent.
-- A live session may only be touched at the current database time, or revoked.
-- Revocation works even for a disabled user or an already expired session.
CREATE TRIGGER staff_sessions_update_guard
BEFORE UPDATE ON staff_sessions
WHEN OLD.revoked_at IS NOT NULL
  OR NEW.id IS NOT OLD.id OR NEW.token_hash IS NOT OLD.token_hash
  OR NEW.user_id IS NOT OLD.user_id OR NEW.user_version IS NOT OLD.user_version
  OR NEW.identity_issuer IS NOT OLD.identity_issuer OR NEW.identity_subject IS NOT OLD.identity_subject
  OR NEW.created_at IS NOT OLD.created_at OR NEW.absolute_expires_at IS NOT OLD.absolute_expires_at
  OR NEW.version <> OLD.version + 1
  OR NOT (
    (NEW.revoked_at IS NOT NULL AND NEW.revoked_at = CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND NEW.last_seen_at = OLD.last_seen_at AND NEW.idle_expires_at = OLD.idle_expires_at)
    OR (NEW.revoked_at IS NULL
      AND OLD.idle_expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND OLD.absolute_expires_at > CAST(unixepoch('subsec') * 1000 AS INTEGER)
      AND NEW.last_seen_at = max(OLD.last_seen_at, CAST(unixepoch('subsec') * 1000 AS INTEGER))
      AND NEW.idle_expires_at = min(OLD.absolute_expires_at, NEW.last_seen_at + 1800000)
      AND EXISTS (
        SELECT 1 FROM users user WHERE user.id = OLD.user_id AND user.status = 'active'
          AND user.version = OLD.user_version AND user.external_issuer = OLD.identity_issuer
          AND user.external_subject = OLD.identity_subject
      ))
  )
BEGIN SELECT RAISE(ABORT, 'staff session transition is invalid or no longer authorized'); END;
--> statement-breakpoint
CREATE TRIGGER staff_sessions_no_delete
BEFORE DELETE ON staff_sessions
BEGIN SELECT RAISE(ABORT, 'staff session tombstones cannot be deleted'); END;
--> statement-breakpoint
-- Invalidate existing sessions in the same user-update transaction. Merely
-- comparing the current snapshot on reads would allow disable/reactivate or
-- identity/version change-and-restore to resurrect an old session.
CREATE TRIGGER users_invalidate_staff_sessions
AFTER UPDATE ON users
WHEN NEW.status IS NOT OLD.status OR NEW.version IS NOT OLD.version
  OR NEW.external_issuer IS NOT OLD.external_issuer OR NEW.external_subject IS NOT OLD.external_subject
BEGIN
  UPDATE staff_sessions
  SET revoked_at = CAST(unixepoch('subsec') * 1000 AS INTEGER), version = version + 1
  WHERE user_id = OLD.id AND revoked_at IS NULL;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM staff_sessions WHERE user_id = OLD.id AND revoked_at IS NULL)
    THEN RAISE(ABORT, 'user change did not invalidate staff sessions') END;
END;
--> statement-breakpoint
-- INSERT OR REPLACE on users is not an UPDATE and may skip delete triggers.
-- An AFTER INSERT check closes that path without affecting INSERT OR IGNORE
-- that performs no actual write. Unchanged identity replacements remain valid.
CREATE TRIGGER users_insert_invalidate_staff_sessions
AFTER INSERT ON users
WHEN EXISTS (
  SELECT 1 FROM staff_sessions session WHERE session.user_id = NEW.id AND session.revoked_at IS NULL
    AND (NEW.status <> 'active' OR session.user_version IS NOT NEW.version
      OR session.identity_issuer IS NOT NEW.external_issuer OR session.identity_subject IS NOT NEW.external_subject)
)
BEGIN
  UPDATE staff_sessions
  SET revoked_at = CAST(unixepoch('subsec') * 1000 AS INTEGER), version = version + 1
  WHERE user_id = NEW.id AND revoked_at IS NULL;
  SELECT CASE WHEN EXISTS (SELECT 1 FROM staff_sessions WHERE user_id = NEW.id AND revoked_at IS NULL)
    THEN RAISE(ABORT, 'user replacement did not invalidate staff sessions') END;
END;
