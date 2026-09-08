ALTER TABLE `protocol_amendments` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
ALTER TABLE `protocol_versions` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);
--> statement-breakpoint
-- Current authority is evaluated inside the same transaction as each write.
-- NULL is retained only for historical/fixture writers; interactive commands
-- and their successful audit/result records always require attribution.
CREATE VIEW protocol_write_assignments AS
SELECT access.*, encounter.id AS encounter_id, encounter.status AS encounter_status
FROM encounter_access_assignment_permissions access
JOIN encounters encounter ON encounter.organization_id=access.organization_id
  AND encounter.facility_id=access.facility_id AND encounter.clinician_membership_id=access.membership_id
JOIN patients patient ON patient.id=encounter.patient_id AND patient.organization_id=encounter.organization_id
  AND patient.facility_id=encounter.facility_id AND patient.status='active'
WHERE access.can_manage=1 AND access.effective_from <= unixepoch('subsec')*1000
  AND (access.effective_until IS NULL OR access.effective_until > unixepoch('subsec')*1000)
  AND EXISTS (SELECT 1 FROM consent_heads head JOIN consent_events event ON event.id=head.current_consent_event_id
    AND event.organization_id=head.organization_id AND event.facility_id=head.facility_id
    AND event.patient_id=head.patient_id AND event.encounter_id=head.encounter_id AND event.consent_type=head.consent_type
    WHERE head.organization_id=encounter.organization_id AND head.facility_id=encounter.facility_id
      AND head.encounter_id=encounter.id AND head.patient_id=patient.id AND event.consent_type='care'
      AND event.decision='granted' AND event.effective_at <= unixepoch('subsec')*1000
      AND (event.expires_at IS NULL OR event.expires_at > unixepoch('subsec')*1000));
--> statement-breakpoint
CREATE TRIGGER protocol_version_assignment BEFORE INSERT ON protocol_versions
WHEN NEW.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM protocol_write_assignments access
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.encounter_id=NEW.encounter_id
    AND access.membership_id=NEW.created_by_membership_id
    AND ((NEW.status='draft' AND access.encounter_status='in_progress')
      OR (NEW.status='signed' AND NEW.signed_by_membership_id=access.membership_id
        AND EXISTS (SELECT 1 FROM protocol_versions parent
          WHERE parent.id=NEW.supersedes_protocol_version_id AND parent.encounter_id=NEW.encounter_id
            AND parent.organization_id=NEW.organization_id AND parent.facility_id=NEW.facility_id
            AND ((parent.status='draft' AND access.encounter_status='review')
              OR (parent.status='signed' AND access.encounter_status IN ('finalized','amended'))))))
)
BEGIN SELECT RAISE(ABORT,'protocol version requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER protocol_amendment_assignment BEFORE INSERT ON protocol_amendments
WHEN NEW.access_assignment_id IS NOT NULL AND NOT EXISTS (
  SELECT 1 FROM protocol_write_assignments access JOIN protocol_versions version
    ON version.id=NEW.amended_protocol_version_id AND version.organization_id=NEW.organization_id
    AND version.facility_id=NEW.facility_id AND version.encounter_id=NEW.encounter_id
    AND version.access_assignment_id=NEW.access_assignment_id AND version.status='signed'
    AND version.supersedes_protocol_version_id=NEW.base_protocol_version_id
    AND version.created_by_membership_id=NEW.created_by_membership_id
    AND version.signed_by_membership_id=NEW.created_by_membership_id
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.encounter_id=NEW.encounter_id
    AND access.membership_id=NEW.created_by_membership_id AND access.encounter_status IN ('finalized','amended')
)
BEGIN SELECT RAISE(ABORT,'protocol amendment requires matching assignment'); END;
--> statement-breakpoint
-- Result/audit writes occur after the encounter and protocol heads advance.
CREATE VIEW attributed_protocol_results AS
SELECT version.id, version.organization_id, version.facility_id, version.encounter_id,
  version.access_assignment_id, version.created_by_membership_id AS membership_id,
  version.id AS protocol_id, 'protocol_version' AS entity_type,
  CASE version.status WHEN 'draft' THEN 'protocol.begin_review' ELSE 'protocol.sign' END AS operation,
  CASE version.status WHEN 'draft' THEN 'protocol_draft' ELSE 'signed_protocol' END AS resource_type,
  CASE version.status WHEN 'draft' THEN 'protocol.draft.create_and_begin_review' ELSE 'protocol.sign_and_finalize' END AS action,
  CASE version.status WHEN 'draft' THEN 'review' ELSE 'finalized' END AS final_status
FROM protocol_versions version
WHERE version.status='draft' OR EXISTS (SELECT 1 FROM protocol_versions parent
  WHERE parent.id=version.supersedes_protocol_version_id AND parent.status='draft')
UNION ALL
SELECT amendment.id, amendment.organization_id, amendment.facility_id, amendment.encounter_id,
  amendment.access_assignment_id, amendment.created_by_membership_id,
  amendment.amended_protocol_version_id, 'protocol_amendment', 'protocol.amend',
  'protocol_amendment', 'protocol.amend_and_sign', 'amended'
FROM protocol_amendments amendment;
--> statement-breakpoint
CREATE TRIGGER protocol_head_assignment_insert BEFORE INSERT ON protocol_heads
WHEN EXISTS (SELECT 1 FROM protocol_versions version WHERE version.id=NEW.current_protocol_version_id
  AND version.access_assignment_id IS NOT NULL) AND NOT EXISTS (
  SELECT 1 FROM protocol_versions version JOIN protocol_write_assignments access
    ON access.assignment_id=version.access_assignment_id AND access.membership_id=version.created_by_membership_id
    AND access.encounter_id=version.encounter_id AND access.organization_id=version.organization_id
    AND access.facility_id=version.facility_id
  WHERE version.id=NEW.current_protocol_version_id AND version.encounter_id=NEW.encounter_id
    AND version.organization_id=NEW.organization_id AND version.facility_id=NEW.facility_id
    AND access.encounter_status='in_progress' AND version.status='draft'
)
BEGIN SELECT RAISE(ABORT,'protocol head requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER protocol_head_assignment_update BEFORE UPDATE ON protocol_heads
WHEN EXISTS (SELECT 1 FROM protocol_versions version WHERE version.id=NEW.current_protocol_version_id
  AND version.access_assignment_id IS NOT NULL) AND NOT EXISTS (
  SELECT 1 FROM protocol_versions version JOIN protocol_write_assignments access
    ON access.assignment_id=version.access_assignment_id AND access.membership_id=version.created_by_membership_id
    AND access.encounter_id=version.encounter_id AND access.organization_id=version.organization_id
    AND access.facility_id=version.facility_id
  JOIN protocol_versions parent ON parent.id=version.supersedes_protocol_version_id
  WHERE version.id=NEW.current_protocol_version_id AND version.encounter_id=NEW.encounter_id
    AND version.organization_id=NEW.organization_id AND version.facility_id=NEW.facility_id
    AND version.status='signed' AND version.signed_by_membership_id=access.membership_id
    AND ((parent.status='draft' AND access.encounter_status='review')
      OR (parent.status='signed' AND access.encounter_status IN ('finalized','amended')))
)
BEGIN SELECT RAISE(ABORT,'protocol head requires current assignment'); END;
--> statement-breakpoint
CREATE VIEW current_protocol_results AS
SELECT record.* FROM attributed_protocol_results record
JOIN protocol_write_assignments access ON access.assignment_id=record.access_assignment_id
  AND access.organization_id=record.organization_id AND access.facility_id=record.facility_id
  AND access.encounter_id=record.encounter_id AND access.membership_id=record.membership_id
  AND access.encounter_status=record.final_status
JOIN protocol_heads head ON head.organization_id=record.organization_id AND head.facility_id=record.facility_id
  AND head.encounter_id=record.encounter_id AND head.current_protocol_version_id=record.protocol_id
  AND (record.operation='protocol.begin_review' OR head.current_signed_protocol_version_id=record.protocol_id);
--> statement-breakpoint
CREATE TRIGGER protocol_command_assignment BEFORE INSERT ON command_idempotency
WHEN NEW.operation IN ('protocol.begin_review','protocol.sign','protocol.amend') AND (NEW.status<>'processing'
  OR NEW.result_resource_id IS NOT NULL OR NEW.result_resource_type IS NOT NULL OR NEW.response_json IS NOT NULL
  OR NOT EXISTS (
  SELECT 1 FROM current_protocol_results record WHERE record.operation=NEW.operation
    AND record.access_assignment_id=NEW.access_assignment_id AND record.membership_id=NEW.actor_membership_id
    AND record.organization_id=NEW.organization_id AND record.facility_id=NEW.facility_id
))
BEGIN SELECT RAISE(ABORT,'protocol command requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER protocol_result_assignment BEFORE UPDATE ON command_idempotency
WHEN NEW.operation IN ('protocol.begin_review','protocol.sign','protocol.amend') AND NEW.status='succeeded'
  AND NOT EXISTS (
    SELECT 1 FROM current_protocol_results record
    JOIN protocol_versions version ON version.id=record.protocol_id
    JOIN protocol_heads head ON head.encounter_id=record.encounter_id AND head.organization_id=record.organization_id
      AND head.facility_id=record.facility_id AND head.current_protocol_version_id=version.id
    JOIN encounters encounter ON encounter.id=record.encounter_id
    JOIN audit_events audit
      ON audit.organization_id=record.organization_id AND audit.facility_id=record.facility_id
      AND audit.entity_type=record.entity_type AND audit.entity_id=record.id AND audit.action=record.action
      AND audit.actor_membership_id=record.membership_id AND audit.outcome='succeeded'
      AND json_extract(audit.metadata_json,'$.accessAssignmentId')=record.access_assignment_id
    WHERE record.operation=NEW.operation AND record.resource_type=NEW.result_resource_type
      AND record.id=NEW.result_resource_id AND record.access_assignment_id=NEW.access_assignment_id
      AND record.membership_id=NEW.actor_membership_id AND record.organization_id=NEW.organization_id
      AND record.facility_id=NEW.facility_id AND json_extract(NEW.response_json,'$.protocol.id')=record.protocol_id
      AND json_extract(NEW.response_json,'$.protocol.version')=version.version
      AND json_extract(NEW.response_json,'$.protocol.status')=version.status
      AND json_extract(NEW.response_json,'$.protocol.sourceHash')=version.source_hash
      AND json_extract(NEW.response_json,'$.protocol.headVersion')=head.lock_version
      AND json_extract(NEW.response_json,'$.protocol.createdAt')=version.created_at
      AND json_extract(NEW.response_json,'$.protocol.signedAt') IS version.signed_at
      AND (version.status<>'draft' OR json_type(NEW.response_json,'$.protocol.signedAt')='null')
      AND json_extract(NEW.response_json,'$.transition.encounterId')=record.encounter_id
      AND json_extract(NEW.response_json,'$.transition.status')=record.final_status
      AND json_extract(NEW.response_json,'$.transition.version')=encounter.version
      AND (record.operation<>'protocol.amend' OR json_extract(NEW.response_json,'$.amendment.id')=record.id)
      AND (record.operation<>'protocol.amend' OR EXISTS (SELECT 1 FROM protocol_amendments amendment
        WHERE amendment.id=record.id
          AND json_extract(NEW.response_json,'$.amendment.baseProtocolId')=amendment.base_protocol_version_id
          AND json_extract(NEW.response_json,'$.amendment.protocolId')=amendment.amended_protocol_version_id
          AND json_extract(NEW.response_json,'$.amendment.protocolVersion')=version.version
          AND json_extract(NEW.response_json,'$.amendment.reason')=amendment.reason
          AND json_extract(NEW.response_json,'$.amendment.text')=amendment.amendment_text
          AND json_extract(NEW.response_json,'$.amendment.signedByMembershipId')=amendment.created_by_membership_id
          AND json_extract(NEW.response_json,'$.amendment.signedAt')=version.signed_at))
  )
BEGIN SELECT RAISE(ABORT,'protocol result requires matching assignment and audit'); END;
--> statement-breakpoint
CREATE TRIGGER protocol_audit_assignment BEFORE INSERT ON audit_events
WHEN NEW.action IN ('protocol.draft.create_and_begin_review','protocol.sign_and_finalize','protocol.amend_and_sign')
  AND NOT EXISTS (
    SELECT 1 FROM current_protocol_results record JOIN memberships member ON member.id=record.membership_id
    WHERE record.action=NEW.action AND record.entity_type=NEW.entity_type AND record.id=NEW.entity_id
      AND record.organization_id=NEW.organization_id AND record.facility_id=NEW.facility_id
      AND record.membership_id=NEW.actor_membership_id AND NEW.actor_type='user' AND NEW.actor_id=member.user_id
      AND NEW.outcome='succeeded' AND json_extract(NEW.metadata_json,'$.accessAssignmentId')=record.access_assignment_id
  )
BEGIN SELECT RAISE(ABORT,'protocol audit requires matching assignment'); END;
