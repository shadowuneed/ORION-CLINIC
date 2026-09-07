ALTER TABLE `review_decisions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
ALTER TABLE `suggestion_derivative_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);
--> statement-breakpoint
CREATE VIEW recommendation_write_assignments AS
SELECT access.*, encounter.id AS encounter_id FROM encounter_access_assignment_permissions access
JOIN encounters encounter ON encounter.organization_id=access.organization_id AND encounter.facility_id=access.facility_id
  AND encounter.clinician_membership_id=access.membership_id
JOIN patients patient ON patient.id=encounter.patient_id AND patient.organization_id=encounter.organization_id
  AND patient.facility_id=encounter.facility_id AND patient.status='active'
WHERE access.can_manage=1 AND encounter.status='in_progress'
  AND access.effective_from <= unixepoch('subsec')*1000
  AND (access.effective_until IS NULL OR access.effective_until > unixepoch('subsec')*1000)
  AND EXISTS (SELECT 1 FROM consent_heads head JOIN consent_events event ON event.id=head.current_consent_event_id
    AND event.organization_id=head.organization_id AND event.facility_id=head.facility_id
    AND event.patient_id=head.patient_id AND event.encounter_id=head.encounter_id AND event.consent_type=head.consent_type
    WHERE head.organization_id=encounter.organization_id AND head.facility_id=encounter.facility_id
      AND head.encounter_id=encounter.id AND head.patient_id=patient.id AND event.consent_type='care'
      AND event.decision='granted' AND event.effective_at <= unixepoch('subsec')*1000
      AND (event.expires_at IS NULL OR event.expires_at > unixepoch('subsec')*1000));
--> statement-breakpoint
CREATE VIEW attributed_recommendation_writes AS
SELECT id,organization_id,facility_id,encounter_id,suggestion_id,access_assignment_id,
  authored_by_membership_id AS membership_id,'suggestion_derivative_version' AS resource_type
FROM suggestion_derivative_versions
UNION ALL SELECT id,organization_id,facility_id,encounter_id,suggestion_id,access_assignment_id,
  reviewer_membership_id,'review_decision' FROM review_decisions;
--> statement-breakpoint
CREATE TRIGGER recommendation_derivative_assignment BEFORE INSERT ON suggestion_derivative_versions
WHEN NEW.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM recommendation_write_assignments access WHERE access.assignment_id=NEW.access_assignment_id
    AND access.organization_id=NEW.organization_id AND access.facility_id=NEW.facility_id
    AND access.encounter_id=NEW.encounter_id AND access.membership_id=NEW.authored_by_membership_id
)
BEGIN SELECT RAISE(ABORT,'recommendation derivative requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER recommendation_decision_assignment BEFORE INSERT ON review_decisions
WHEN NEW.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM recommendation_write_assignments access WHERE access.assignment_id=NEW.access_assignment_id
    AND access.organization_id=NEW.organization_id AND access.facility_id=NEW.facility_id
    AND access.encounter_id=NEW.encounter_id AND access.membership_id=NEW.reviewer_membership_id
)
BEGIN SELECT RAISE(ABORT,'recommendation decision requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER recommendation_command_assignment BEFORE INSERT ON command_idempotency
WHEN NEW.operation IN ('suggestion.derivative.create','suggestion.decision') AND NOT EXISTS (
  SELECT 1 FROM recommendation_write_assignments access WHERE access.assignment_id=NEW.access_assignment_id
    AND access.organization_id=NEW.organization_id AND access.facility_id=NEW.facility_id AND access.membership_id=NEW.actor_membership_id
)
BEGIN SELECT RAISE(ABORT,'recommendation command requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER recommendation_result_assignment BEFORE UPDATE ON command_idempotency
WHEN NEW.operation IN ('suggestion.derivative.create','suggestion.decision') AND NEW.status='succeeded' AND NOT EXISTS (
  SELECT 1 FROM attributed_recommendation_writes record JOIN recommendation_write_assignments access
    ON access.assignment_id=record.access_assignment_id AND access.organization_id=record.organization_id
    AND access.facility_id=record.facility_id AND access.encounter_id=record.encounter_id AND access.membership_id=record.membership_id
  WHERE record.id=NEW.result_resource_id AND record.resource_type=NEW.result_resource_type
    AND record.organization_id=NEW.organization_id AND record.facility_id=NEW.facility_id
    AND record.access_assignment_id=NEW.access_assignment_id AND record.membership_id=NEW.actor_membership_id
    AND record.resource_type=CASE NEW.operation WHEN 'suggestion.decision' THEN 'review_decision' ELSE 'suggestion_derivative_version' END
)
BEGIN SELECT RAISE(ABORT,'recommendation result requires matching assignment'); END;
--> statement-breakpoint
CREATE TRIGGER recommendation_audit_assignment BEFORE INSERT ON audit_events
WHEN NEW.action IN ('suggestion.derivative.create','suggestion.accept','suggestion.reject','suggestion.restore') AND NOT EXISTS (
  SELECT 1 FROM attributed_recommendation_writes record JOIN recommendation_write_assignments access
    ON access.assignment_id=record.access_assignment_id AND access.organization_id=record.organization_id
    AND access.facility_id=record.facility_id AND access.encounter_id=record.encounter_id AND access.membership_id=record.membership_id
  JOIN memberships member ON member.id=access.membership_id
  WHERE record.organization_id=NEW.organization_id AND record.facility_id=NEW.facility_id
    AND NEW.actor_type='user' AND NEW.actor_id=member.user_id AND NEW.actor_membership_id=record.membership_id
    AND json_extract(NEW.metadata_json,'$.accessAssignmentId')=record.access_assignment_id
    AND ((NEW.action='suggestion.derivative.create' AND NEW.entity_type=record.resource_type AND NEW.entity_id=record.id)
      OR (record.resource_type='review_decision' AND NEW.entity_type='clinical_suggestion' AND NEW.entity_id=record.suggestion_id
        AND record.id=json_extract(NEW.metadata_json,'$.decisionId')
        AND EXISTS (SELECT 1 FROM review_decisions decision
          WHERE decision.id=record.id AND NEW.action='suggestion.' || decision.decision)))
)
BEGIN SELECT RAISE(ABORT,'recommendation audit requires matching assignment'); END;
