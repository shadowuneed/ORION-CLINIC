DROP TRIGGER IF EXISTS `transcript_segments_supersedes_same_segment`;
--> statement-breakpoint
CREATE TRIGGER `transcript_segments_version_lineage`
BEFORE INSERT ON `transcript_segments`
WHEN
  (NEW.`version` = 1 AND NEW.`supersedes_segment_id` IS NOT NULL)
  OR (
    NEW.`version` > 1
    AND (
      NEW.`supersedes_segment_id` IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM `transcript_segments` parent
        WHERE parent.`id` = NEW.`supersedes_segment_id`
          AND parent.`organization_id` = NEW.`organization_id`
          AND parent.`facility_id` = NEW.`facility_id`
          AND parent.`encounter_id` = NEW.`encounter_id`
          AND parent.`segment_index` = NEW.`segment_index`
          AND parent.`version` = NEW.`version` - 1
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'transcript version must extend its immediate predecessor');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `clinical_section_versions_supersedes_same_section`;
--> statement-breakpoint
CREATE TRIGGER `clinical_section_versions_version_lineage`
BEFORE INSERT ON `clinical_section_versions`
WHEN
  (NEW.`version` = 1 AND NEW.`supersedes_section_version_id` IS NOT NULL)
  OR (
    NEW.`version` > 1
    AND (
      NEW.`supersedes_section_version_id` IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM `clinical_section_versions` parent
        WHERE parent.`id` = NEW.`supersedes_section_version_id`
          AND parent.`organization_id` = NEW.`organization_id`
          AND parent.`facility_id` = NEW.`facility_id`
          AND parent.`encounter_id` = NEW.`encounter_id`
          AND parent.`code` = NEW.`code`
          AND parent.`version` = NEW.`version` - 1
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'clinical section version must extend its immediate predecessor');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `protocol_versions_supersedes_same_encounter`;
--> statement-breakpoint
CREATE TRIGGER `protocol_versions_version_lineage`
BEFORE INSERT ON `protocol_versions`
WHEN
  (NEW.`version` = 1 AND NEW.`supersedes_protocol_version_id` IS NOT NULL)
  OR (
    NEW.`version` > 1
    AND (
      NEW.`supersedes_protocol_version_id` IS NULL
      OR NOT EXISTS (
        SELECT 1 FROM `protocol_versions` parent
        WHERE parent.`id` = NEW.`supersedes_protocol_version_id`
          AND parent.`organization_id` = NEW.`organization_id`
          AND parent.`facility_id` = NEW.`facility_id`
          AND parent.`encounter_id` = NEW.`encounter_id`
          AND parent.`version` = NEW.`version` - 1
      )
    )
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol version must extend its immediate predecessor');
END;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_state_matches_decision_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `suggestion_review_heads_state_matches_decision_update`;
--> statement-breakpoint
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
END;
--> statement-breakpoint
CREATE TRIGGER `suggestion_review_heads_state_matches_decision_update`
BEFORE UPDATE ON `suggestion_review_heads`
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
END;
--> statement-breakpoint
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
END;
--> statement-breakpoint
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
--> statement-breakpoint
DROP TRIGGER IF EXISTS `encounters_finalized_no_update`;
--> statement-breakpoint
CREATE TRIGGER `encounters_finalized_update_guard`
BEFORE UPDATE ON `encounters`
WHEN OLD.`status` IN ('finalized', 'amended')
  AND NOT (
    OLD.`status` = 'finalized'
    AND NEW.`status` = 'amended'
    AND NEW.`version` = OLD.`version` + 1
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
  )
BEGIN
  SELECT RAISE(ABORT, 'finalized encounter permits only a versioned amendment transition');
END;
