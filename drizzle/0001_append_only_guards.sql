CREATE TRIGGER `consent_events_no_update`
BEFORE UPDATE ON `consent_events`
BEGIN
  SELECT RAISE(ABORT, 'consent events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `consent_events_no_delete`
BEFORE DELETE ON `consent_events`
BEGIN
  SELECT RAISE(ABORT, 'consent events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `consent_events_supersedes_same_subject`
BEFORE INSERT ON `consent_events`
WHEN NEW.`supersedes_consent_event_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `consent_events` parent
    WHERE parent.`id` = NEW.`supersedes_consent_event_id`
      AND parent.`organization_id` = NEW.`organization_id`
      AND parent.`facility_id` = NEW.`facility_id`
      AND parent.`patient_id` = NEW.`patient_id`
      AND parent.`consent_type` = NEW.`consent_type`
  )
BEGIN
  SELECT RAISE(ABORT, 'consent predecessor must belong to the same subject');
END;
--> statement-breakpoint
CREATE TRIGGER `transcript_segments_no_update`
BEFORE UPDATE ON `transcript_segments`
BEGIN
  SELECT RAISE(ABORT, 'transcript segment versions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `transcript_segments_no_delete`
BEFORE DELETE ON `transcript_segments`
BEGIN
  SELECT RAISE(ABORT, 'transcript segment versions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `transcript_segments_supersedes_same_segment`
BEFORE INSERT ON `transcript_segments`
WHEN NEW.`supersedes_segment_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `transcript_segments` parent
    WHERE parent.`id` = NEW.`supersedes_segment_id`
      AND parent.`organization_id` = NEW.`organization_id`
      AND parent.`facility_id` = NEW.`facility_id`
      AND parent.`encounter_id` = NEW.`encounter_id`
      AND parent.`segment_index` = NEW.`segment_index`
  )
BEGIN
  SELECT RAISE(ABORT, 'transcript predecessor must be the same segment');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_section_versions_no_update`
BEFORE UPDATE ON `clinical_section_versions`
BEGIN
  SELECT RAISE(ABORT, 'clinical section versions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_section_versions_no_delete`
BEFORE DELETE ON `clinical_section_versions`
BEGIN
  SELECT RAISE(ABORT, 'clinical section versions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_section_versions_supersedes_same_section`
BEFORE INSERT ON `clinical_section_versions`
WHEN NEW.`supersedes_section_version_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `clinical_section_versions` parent
    WHERE parent.`id` = NEW.`supersedes_section_version_id`
      AND parent.`organization_id` = NEW.`organization_id`
      AND parent.`facility_id` = NEW.`facility_id`
      AND parent.`encounter_id` = NEW.`encounter_id`
      AND parent.`code` = NEW.`code`
  )
BEGIN
  SELECT RAISE(ABORT, 'clinical section predecessor must be the same section');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_suggestions_no_update`
BEFORE UPDATE ON `clinical_suggestions`
BEGIN
  SELECT RAISE(ABORT, 'clinical suggestions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `clinical_suggestions_no_delete`
BEFORE DELETE ON `clinical_suggestions`
BEGIN
  SELECT RAISE(ABORT, 'clinical suggestions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `review_decisions_no_update`
BEFORE UPDATE ON `review_decisions`
BEGIN
  SELECT RAISE(ABORT, 'review decisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `review_decisions_no_delete`
BEFORE DELETE ON `review_decisions`
BEGIN
  SELECT RAISE(ABORT, 'review decisions are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `suggestion_review_heads_state_matches_decision_insert`
BEFORE INSERT ON `suggestion_review_heads`
WHEN NEW.`current_decision_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `review_decisions` decision
    WHERE decision.`id` = NEW.`current_decision_id`
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
      AND decision.`result_state` = NEW.`state`
  )
BEGIN
  SELECT RAISE(ABORT, 'suggestion head must match its current decision');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_versions_no_update`
BEFORE UPDATE ON `protocol_versions`
BEGIN
  SELECT RAISE(ABORT, 'protocol versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_versions_no_delete`
BEFORE DELETE ON `protocol_versions`
BEGIN
  SELECT RAISE(ABORT, 'protocol versions are immutable');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_versions_supersedes_same_encounter`
BEFORE INSERT ON `protocol_versions`
WHEN NEW.`supersedes_protocol_version_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `protocol_versions` parent
    WHERE parent.`id` = NEW.`supersedes_protocol_version_id`
      AND parent.`organization_id` = NEW.`organization_id`
      AND parent.`facility_id` = NEW.`facility_id`
      AND parent.`encounter_id` = NEW.`encounter_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'protocol predecessor must belong to the same encounter');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_heads_signed_pointer_insert`
BEFORE INSERT ON `protocol_heads`
WHEN NEW.`current_signed_protocol_version_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `protocol_versions` version
    WHERE version.`id` = NEW.`current_signed_protocol_version_id`
      AND version.`status` = 'signed'
  )
BEGIN
  SELECT RAISE(ABORT, 'signed protocol pointer must reference a signed version');
END;
--> statement-breakpoint
CREATE TRIGGER `protocol_heads_signed_pointer_update`
BEFORE UPDATE ON `protocol_heads`
WHEN NEW.`current_signed_protocol_version_id` IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM `protocol_versions` version
    WHERE version.`id` = NEW.`current_signed_protocol_version_id`
      AND version.`status` = 'signed'
  )
BEGIN
  SELECT RAISE(ABORT, 'signed protocol pointer must reference a signed version');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_no_update`
BEFORE UPDATE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_no_delete`
BEFORE DELETE ON `audit_events`
BEGIN
  SELECT RAISE(ABORT, 'audit events are append-only');
END;
--> statement-breakpoint
CREATE TRIGGER `audit_events_chain_consistent`
BEFORE INSERT ON `audit_events`
WHEN NEW.`sequence` > 1
  AND NOT EXISTS (
    SELECT 1 FROM `audit_events` parent
    WHERE parent.`organization_id` = NEW.`organization_id`
      AND parent.`facility_id` = NEW.`facility_id`
      AND parent.`sequence` = NEW.`sequence` - 1
      AND parent.`event_hash` = NEW.`previous_hash`
  )
BEGIN
  SELECT RAISE(ABORT, 'audit event must extend the current tenant chain');
END;
--> statement-breakpoint
CREATE TRIGGER `encounters_finalized_no_update`
BEFORE UPDATE ON `encounters`
WHEN OLD.`status` IN ('finalized', 'amended')
BEGIN
  SELECT RAISE(ABORT, 'finalized encounters are immutable');
END;
