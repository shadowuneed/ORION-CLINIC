CREATE TABLE `suggestion_derivative_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`current_derivative_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `clinical_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_derivative_version_id`) REFERENCES `suggestion_derivative_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`) REFERENCES `clinical_suggestions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`current_derivative_version_id`) REFERENCES `suggestion_derivative_versions`(`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suggestion_derivative_heads_lock_positive" CHECK("suggestion_derivative_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_derivative_heads_scope_suggestion_uidx` ON `suggestion_derivative_heads` (`organization_id`,`facility_id`,`suggestion_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_derivative_heads_scope_subject_id_uidx` ON `suggestion_derivative_heads` (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`);--> statement-breakpoint
CREATE TABLE `suggestion_derivative_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`version` integer NOT NULL,
	`title` text NOT NULL,
	`content` text NOT NULL,
	`content_hash` text NOT NULL,
	`evidence_json` text NOT NULL,
	`provenance_json` text NOT NULL,
	`reason` text NOT NULL,
	`authored_by_membership_id` text NOT NULL,
	`supersedes_derivative_version_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `clinical_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`authored_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_derivative_version_id`) REFERENCES `suggestion_derivative_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`) REFERENCES `clinical_suggestions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`authored_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suggestion_derivative_versions_version_positive" CHECK("suggestion_derivative_versions"."version" > 0),
	CONSTRAINT "suggestion_derivative_versions_title_length" CHECK(length(trim("suggestion_derivative_versions"."title")) between 1 and 300),
	CONSTRAINT "suggestion_derivative_versions_content_length" CHECK(length(trim("suggestion_derivative_versions"."content")) between 1 and 8000),
	CONSTRAINT "suggestion_derivative_versions_reason_length" CHECK(length(trim("suggestion_derivative_versions"."reason")) between 3 and 500),
	CONSTRAINT "suggestion_derivative_versions_hash_length" CHECK(length("suggestion_derivative_versions"."content_hash") = 64),
	CONSTRAINT "suggestion_derivative_versions_evidence_json" CHECK(json_valid("suggestion_derivative_versions"."evidence_json")),
	CONSTRAINT "suggestion_derivative_versions_provenance_json" CHECK(json_valid("suggestion_derivative_versions"."provenance_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_derivative_versions_scope_subject_version_uidx` ON `suggestion_derivative_versions` (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_derivative_versions_scope_subject_id_uidx` ON `suggestion_derivative_versions` (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_derivative_versions_supersedes_once_uidx` ON `suggestion_derivative_versions` (`supersedes_derivative_version_id`);--> statement-breakpoint
CREATE INDEX `suggestion_derivative_versions_encounter_created_idx` ON `suggestion_derivative_versions` (`encounter_id`,`created_at`);--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_state_matches_decision_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_state_matches_decision_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_advance_only`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_no_delete`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_expired_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_expired_update`;--> statement-breakpoint
CREATE TABLE `__legacy_suggestion_review_heads` AS
SELECT `id`, `organization_id`, `facility_id`, `encounter_id`, `suggestion_id`,
  `state`, `current_decision_id`, `lock_version`, `updated_at`
FROM `suggestion_review_heads`;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`reviewer_membership_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`expected_version` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`decision` text NOT NULL,
	`result_state` text NOT NULL,
	`reviewed_derivative_version_id` text,
	`edited_content` text,
	`reason` text,
	`decided_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `clinical_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_derivative_version_id`) REFERENCES `suggestion_derivative_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`) REFERENCES `clinical_suggestions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`reviewer_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`reviewed_derivative_version_id`) REFERENCES `suggestion_derivative_versions`(`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_decisions_sequence_positive" CHECK("__new_review_decisions"."sequence" > 0),
	CONSTRAINT "review_decisions_version_positive" CHECK("__new_review_decisions"."expected_version" > 0),
	CONSTRAINT "review_decisions_edited_content_valid" CHECK(("__new_review_decisions"."decision" = 'edit_and_accept' and length(trim(coalesce("__new_review_decisions"."edited_content", ''))) > 0) or ("__new_review_decisions"."decision" <> 'edit_and_accept' and "__new_review_decisions"."edited_content" is null)),
	CONSTRAINT "review_decisions_decision_enum" CHECK("__new_review_decisions"."decision" in ('accept', 'edit_and_accept', 'reject', 'restore')),
	CONSTRAINT "review_decisions_result_state_enum" CHECK("__new_review_decisions"."result_state" in ('proposed', 'accepted', 'edited_and_accepted', 'rejected')),
	CONSTRAINT "review_decisions_transition_consistent" CHECK(("__new_review_decisions"."decision" = 'accept' and "__new_review_decisions"."reviewed_derivative_version_id" is null and "__new_review_decisions"."result_state" = 'accepted') or ("__new_review_decisions"."decision" = 'accept' and "__new_review_decisions"."reviewed_derivative_version_id" is not null and "__new_review_decisions"."result_state" = 'edited_and_accepted') or ("__new_review_decisions"."decision" = 'edit_and_accept' and "__new_review_decisions"."result_state" = 'edited_and_accepted') or ("__new_review_decisions"."decision" = 'reject' and "__new_review_decisions"."result_state" = 'rejected') or ("__new_review_decisions"."decision" = 'restore' and "__new_review_decisions"."result_state" = 'proposed'))
);
--> statement-breakpoint
INSERT INTO `__new_review_decisions`("id", "organization_id", "facility_id", "encounter_id", "suggestion_id", "reviewer_membership_id", "sequence", "expected_version", "idempotency_key", "decision", "result_state", "reviewed_derivative_version_id", "edited_content", "reason", "decided_at", "created_at") SELECT "id", "organization_id", "facility_id", "encounter_id", "suggestion_id", "reviewer_membership_id", "sequence", "expected_version", "idempotency_key", "decision", "result_state", NULL, "edited_content", "reason", "decided_at", "created_at" FROM `review_decisions`;--> statement-breakpoint
DROP TABLE `suggestion_review_heads`;--> statement-breakpoint
DROP TABLE `review_decisions`;--> statement-breakpoint
ALTER TABLE `__new_review_decisions` RENAME TO `review_decisions`;--> statement-breakpoint
CREATE UNIQUE INDEX `review_decisions_scope_subject_id_uidx` ON `review_decisions` (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`);--> statement-breakpoint
CREATE TABLE `suggestion_review_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`state` text DEFAULT 'proposed' NOT NULL,
	`current_decision_id` text,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `clinical_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_decision_id`) REFERENCES `review_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`) REFERENCES `clinical_suggestions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`current_decision_id`) REFERENCES `review_decisions`(`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suggestion_review_heads_lock_positive" CHECK("suggestion_review_heads"."lock_version" > 0),
	CONSTRAINT "suggestion_review_heads_decision_consistency" CHECK(("suggestion_review_heads"."state" in ('proposed', 'expired') and "suggestion_review_heads"."current_decision_id" is null) or ("suggestion_review_heads"."state" not in ('proposed', 'expired') and "suggestion_review_heads"."current_decision_id" is not null)),
	CONSTRAINT "suggestion_review_heads_state_enum" CHECK("suggestion_review_heads"."state" in ('proposed', 'accepted', 'edited_and_accepted', 'rejected', 'expired'))
);--> statement-breakpoint
INSERT INTO `suggestion_review_heads`(
  "id", "organization_id", "facility_id", "encounter_id", "suggestion_id",
  "state", "current_decision_id", "lock_version", "updated_at"
) SELECT
  "id", "organization_id", "facility_id", "encounter_id", "suggestion_id",
  "state", "current_decision_id", "lock_version", "updated_at"
FROM `__legacy_suggestion_review_heads`;--> statement-breakpoint
DROP TABLE `__legacy_suggestion_review_heads`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `review_decisions_suggestion_sequence_uidx` ON `review_decisions` (`suggestion_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_decisions_scope_idempotency_uidx` ON `review_decisions` (`organization_id`,`facility_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_decisions_scope_id_uidx` ON `review_decisions` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE INDEX `review_decisions_encounter_time_idx` ON `review_decisions` (`encounter_id`,`decided_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_review_heads_scope_suggestion_uidx` ON `suggestion_review_heads` (`organization_id`,`facility_id`,`suggestion_id`);--> statement-breakpoint
CREATE TRIGGER `suggestion_derivative_versions_no_update`
BEFORE UPDATE ON `suggestion_derivative_versions`
BEGIN
  SELECT RAISE(ABORT, 'suggestion derivative versions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_derivative_versions_no_delete`
BEFORE DELETE ON `suggestion_derivative_versions`
BEGIN
  SELECT RAISE(ABORT, 'suggestion derivative versions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_derivative_versions_linear_insert`
BEFORE INSERT ON `suggestion_derivative_versions`
WHEN
  (NEW.`version` = 1 AND NEW.`supersedes_derivative_version_id` IS NOT NULL)
  OR (
    NEW.`version` > 1
    AND (
      NEW.`supersedes_derivative_version_id` IS NULL
      OR NOT EXISTS (
        SELECT 1
        FROM `suggestion_derivative_versions` parent
        JOIN `suggestion_derivative_heads` head
          ON head.`organization_id` = parent.`organization_id`
          AND head.`facility_id` = parent.`facility_id`
          AND head.`encounter_id` = parent.`encounter_id`
          AND head.`suggestion_id` = parent.`suggestion_id`
          AND head.`current_derivative_version_id` = parent.`id`
        WHERE parent.`id` = NEW.`supersedes_derivative_version_id`
          AND parent.`organization_id` = NEW.`organization_id`
          AND parent.`facility_id` = NEW.`facility_id`
          AND parent.`encounter_id` = NEW.`encounter_id`
          AND parent.`suggestion_id` = NEW.`suggestion_id`
          AND parent.`version` = NEW.`version` - 1
          AND head.`lock_version` = NEW.`version` - 1
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'suggestion derivative must extend the current version');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_derivative_versions_clinician_guard`
BEFORE INSERT ON `suggestion_derivative_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `encounters` encounter
  JOIN `memberships` membership
    ON membership.`organization_id` = encounter.`organization_id`
    AND membership.`facility_id` = encounter.`facility_id`
    AND membership.`id` = encounter.`clinician_membership_id`
  JOIN `suggestion_review_heads` review_head
    ON review_head.`organization_id` = encounter.`organization_id`
    AND review_head.`facility_id` = encounter.`facility_id`
    AND review_head.`encounter_id` = encounter.`id`
    AND review_head.`suggestion_id` = NEW.`suggestion_id`
  JOIN `consent_heads` consent_head
    ON consent_head.`organization_id` = encounter.`organization_id`
    AND consent_head.`facility_id` = encounter.`facility_id`
    AND consent_head.`encounter_id` = encounter.`id`
    AND consent_head.`consent_type` = 'care'
  JOIN `consent_events` consent_event
    ON consent_event.`organization_id` = consent_head.`organization_id`
    AND consent_event.`facility_id` = consent_head.`facility_id`
    AND consent_event.`encounter_id` = consent_head.`encounter_id`
    AND consent_event.`id` = consent_head.`current_consent_event_id`
  WHERE encounter.`organization_id` = NEW.`organization_id`
    AND encounter.`facility_id` = NEW.`facility_id`
    AND encounter.`id` = NEW.`encounter_id`
    AND encounter.`status` = 'in_progress'
    AND encounter.`clinician_membership_id` = NEW.`authored_by_membership_id`
    AND membership.`id` = NEW.`authored_by_membership_id`
    AND membership.`role` = 'clinician'
    AND membership.`status` = 'active'
    AND review_head.`state` = 'proposed'
    AND review_head.`current_decision_id` IS NULL
    AND consent_event.`decision` = 'granted'
    AND consent_event.`effective_at` <= NEW.`created_at`
    AND (consent_event.`expires_at` IS NULL OR consent_event.`expires_at` > NEW.`created_at`)
)
BEGIN
  SELECT RAISE(ABORT, 'suggestion derivative requires assigned clinician, care consent, and in-progress review');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_derivative_heads_initial_version_only`
BEFORE INSERT ON `suggestion_derivative_heads`
WHEN NEW.`lock_version` <> 1
  OR NOT EXISTS (
    SELECT 1 FROM `suggestion_derivative_versions` version
    WHERE version.`id` = NEW.`current_derivative_version_id`
      AND version.`organization_id` = NEW.`organization_id`
      AND version.`facility_id` = NEW.`facility_id`
      AND version.`encounter_id` = NEW.`encounter_id`
      AND version.`suggestion_id` = NEW.`suggestion_id`
      AND version.`version` = 1
      AND version.`supersedes_derivative_version_id` IS NULL
      AND version.`created_at` = NEW.`updated_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'suggestion derivative head must start at version one');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_derivative_heads_advance_only`
BEFORE UPDATE ON `suggestion_derivative_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`encounter_id` IS NOT OLD.`encounter_id`
  OR NEW.`suggestion_id` IS NOT OLD.`suggestion_id`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NEW.`updated_at` <= OLD.`updated_at`
  OR NOT EXISTS (
    SELECT 1 FROM `suggestion_derivative_versions` version
    WHERE version.`id` = NEW.`current_derivative_version_id`
      AND version.`organization_id` = OLD.`organization_id`
      AND version.`facility_id` = OLD.`facility_id`
      AND version.`encounter_id` = OLD.`encounter_id`
      AND version.`suggestion_id` = OLD.`suggestion_id`
      AND version.`version` = NEW.`lock_version`
      AND version.`supersedes_derivative_version_id` = OLD.`current_derivative_version_id`
      AND version.`created_at` = NEW.`updated_at`
  )
BEGIN
  SELECT RAISE(ABORT, 'suggestion derivative head must advance by one version');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_derivative_heads_no_delete`
BEFORE DELETE ON `suggestion_derivative_heads`
BEGIN
  SELECT RAISE(ABORT, 'suggestion derivative heads cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `review_decisions_no_update`
BEFORE UPDATE ON `review_decisions`
BEGIN
  SELECT RAISE(ABORT, 'review decisions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `review_decisions_no_delete`
BEFORE DELETE ON `review_decisions`
BEGIN
  SELECT RAISE(ABORT, 'review decisions are append-only');
END;--> statement-breakpoint
CREATE TRIGGER `review_decisions_current_subject_guard`
BEFORE INSERT ON `review_decisions`
WHEN NEW.`sequence` <> NEW.`expected_version`
  OR NOT EXISTS (
    SELECT 1
    FROM `suggestion_review_heads` review_head
    JOIN `encounters` encounter
      ON encounter.`organization_id` = review_head.`organization_id`
      AND encounter.`facility_id` = review_head.`facility_id`
      AND encounter.`id` = review_head.`encounter_id`
    JOIN `memberships` membership
      ON membership.`organization_id` = encounter.`organization_id`
      AND membership.`facility_id` = encounter.`facility_id`
      AND membership.`id` = encounter.`clinician_membership_id`
    JOIN `consent_heads` consent_head
      ON consent_head.`organization_id` = encounter.`organization_id`
      AND consent_head.`facility_id` = encounter.`facility_id`
      AND consent_head.`encounter_id` = encounter.`id`
      AND consent_head.`consent_type` = 'care'
    JOIN `consent_events` consent_event
      ON consent_event.`organization_id` = consent_head.`organization_id`
      AND consent_event.`facility_id` = consent_head.`facility_id`
      AND consent_event.`encounter_id` = consent_head.`encounter_id`
      AND consent_event.`id` = consent_head.`current_consent_event_id`
    WHERE review_head.`organization_id` = NEW.`organization_id`
      AND review_head.`facility_id` = NEW.`facility_id`
      AND review_head.`encounter_id` = NEW.`encounter_id`
      AND review_head.`suggestion_id` = NEW.`suggestion_id`
      AND review_head.`lock_version` = NEW.`expected_version`
      AND encounter.`status` = 'in_progress'
      AND encounter.`clinician_membership_id` = NEW.`reviewer_membership_id`
      AND membership.`id` = NEW.`reviewer_membership_id`
      AND membership.`role` = 'clinician'
      AND membership.`status` = 'active'
      AND consent_event.`decision` = 'granted'
      AND consent_event.`effective_at` <= NEW.`decided_at`
      AND (consent_event.`expires_at` IS NULL OR consent_event.`expires_at` > NEW.`decided_at`)
      AND (
        (NEW.`decision` IN ('accept', 'reject', 'edit_and_accept') AND review_head.`state` = 'proposed')
        OR (NEW.`decision` = 'restore' AND review_head.`state` IN ('accepted', 'edited_and_accepted', 'rejected'))
      )
      AND (
        (
          NOT EXISTS (
            SELECT 1 FROM `suggestion_derivative_heads` derivative_head
            WHERE derivative_head.`organization_id` = NEW.`organization_id`
              AND derivative_head.`facility_id` = NEW.`facility_id`
              AND derivative_head.`encounter_id` = NEW.`encounter_id`
              AND derivative_head.`suggestion_id` = NEW.`suggestion_id`
          )
          AND NEW.`reviewed_derivative_version_id` IS NULL
        )
        OR EXISTS (
          SELECT 1 FROM `suggestion_derivative_heads` derivative_head
          WHERE derivative_head.`organization_id` = NEW.`organization_id`
            AND derivative_head.`facility_id` = NEW.`facility_id`
            AND derivative_head.`encounter_id` = NEW.`encounter_id`
            AND derivative_head.`suggestion_id` = NEW.`suggestion_id`
            AND derivative_head.`current_derivative_version_id` = NEW.`reviewed_derivative_version_id`
        )
      )
  )
BEGIN
  SELECT RAISE(ABORT, 'review decision must target the current editable suggestion version');
END;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_state_matches_decision_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_state_matches_decision_update`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_expired_insert`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_expired_update`;--> statement-breakpoint
CREATE TRIGGER `suggestion_review_heads_state_matches_decision_insert`
BEFORE INSERT ON `suggestion_review_heads`
WHEN NEW.`current_decision_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `review_decisions` decision
    WHERE decision.`id` = NEW.`current_decision_id`
      AND decision.`organization_id` = NEW.`organization_id`
      AND decision.`facility_id` = NEW.`facility_id`
      AND decision.`encounter_id` = NEW.`encounter_id`
      AND decision.`suggestion_id` = NEW.`suggestion_id`
      AND decision.`result_state` = NEW.`state`
  )
BEGIN
  SELECT RAISE(ABORT, 'suggestion head must match its current decision');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_review_heads_advance_only`
BEFORE UPDATE ON `suggestion_review_heads`
WHEN
  NEW.`id` IS NOT OLD.`id`
  OR NEW.`organization_id` IS NOT OLD.`organization_id`
  OR NEW.`facility_id` IS NOT OLD.`facility_id`
  OR NEW.`encounter_id` IS NOT OLD.`encounter_id`
  OR NEW.`suggestion_id` IS NOT OLD.`suggestion_id`
  OR NEW.`lock_version` <> OLD.`lock_version` + 1
  OR NEW.`updated_at` <= OLD.`updated_at`
  OR NOT (
    EXISTS (
      SELECT 1 FROM `review_decisions` decision
      WHERE decision.`organization_id` = OLD.`organization_id`
        AND decision.`facility_id` = OLD.`facility_id`
        AND decision.`encounter_id` = OLD.`encounter_id`
        AND decision.`suggestion_id` = OLD.`suggestion_id`
        AND decision.`sequence` = OLD.`lock_version`
        AND decision.`expected_version` = OLD.`lock_version`
        AND decision.`decided_at` = NEW.`updated_at`
        AND decision.`result_state` = NEW.`state`
        AND (
          (NEW.`state` = 'proposed' AND NEW.`current_decision_id` IS NULL AND decision.`decision` = 'restore')
          OR (NEW.`state` <> 'proposed' AND NEW.`current_decision_id` = decision.`id`)
        )
    )
    OR (
      OLD.`state` = 'proposed'
      AND NEW.`state` = 'proposed'
      AND OLD.`current_decision_id` IS NULL
      AND NEW.`current_decision_id` IS NULL
      AND EXISTS (
        SELECT 1
        FROM `suggestion_derivative_heads` derivative_head
        JOIN `suggestion_derivative_versions` derivative
          ON derivative.`organization_id` = derivative_head.`organization_id`
          AND derivative.`facility_id` = derivative_head.`facility_id`
          AND derivative.`encounter_id` = derivative_head.`encounter_id`
          AND derivative.`suggestion_id` = derivative_head.`suggestion_id`
          AND derivative.`id` = derivative_head.`current_derivative_version_id`
        WHERE derivative_head.`organization_id` = OLD.`organization_id`
          AND derivative_head.`facility_id` = OLD.`facility_id`
          AND derivative_head.`encounter_id` = OLD.`encounter_id`
          AND derivative_head.`suggestion_id` = OLD.`suggestion_id`
          AND derivative.`created_at` = NEW.`updated_at`
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'suggestion review head must advance by one reviewed version');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_review_heads_no_delete`
BEFORE DELETE ON `suggestion_review_heads`
BEGIN
  SELECT RAISE(ABORT, 'suggestion review heads cannot be deleted');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_review_heads_expired_insert`
BEFORE INSERT ON `suggestion_review_heads`
WHEN NEW.`state` = 'expired'
  AND NOT EXISTS (
    SELECT 1 FROM `clinical_suggestions` suggestion
    WHERE suggestion.`id` = NEW.`suggestion_id`
      AND suggestion.`organization_id` = NEW.`organization_id`
      AND suggestion.`facility_id` = NEW.`facility_id`
      AND suggestion.`encounter_id` = NEW.`encounter_id`
      AND suggestion.`expires_at` IS NOT NULL
      AND suggestion.`expires_at` <= unixepoch('now') * 1000
  )
BEGIN
  SELECT RAISE(ABORT, 'suggestion can expire only after its expiry time');
END;--> statement-breakpoint
CREATE TRIGGER `suggestion_review_heads_expired_update`
BEFORE UPDATE ON `suggestion_review_heads`
WHEN NEW.`state` = 'expired'
  AND NOT EXISTS (
    SELECT 1 FROM `clinical_suggestions` suggestion
    WHERE suggestion.`id` = NEW.`suggestion_id`
      AND suggestion.`organization_id` = NEW.`organization_id`
      AND suggestion.`facility_id` = NEW.`facility_id`
      AND suggestion.`encounter_id` = NEW.`encounter_id`
      AND suggestion.`expires_at` IS NOT NULL
      AND suggestion.`expires_at` <= unixepoch('now') * 1000
  )
BEGIN
  SELECT RAISE(ABORT, 'suggestion can expire only after its expiry time');
END;
