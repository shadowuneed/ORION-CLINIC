ALTER TABLE `document_artifacts` ADD `access_assignment_id` text REFERENCES department_access_assignments(id);--> statement-breakpoint
ALTER TABLE `document_artifacts` ADD `export_command_id` text;
--> statement-breakpoint
CREATE INDEX document_export_command_idx ON document_artifacts(export_command_id);
--> statement-breakpoint
CREATE VIEW current_export_write_access AS
SELECT access.*, encounter.id AS encounter_id, version.id AS protocol_id, version.version AS protocol_version
FROM encounter_access_assignment_permissions access
JOIN encounters encounter ON encounter.organization_id=access.organization_id AND encounter.facility_id=access.facility_id
  AND encounter.clinician_membership_id=access.membership_id AND encounter.status IN ('finalized','amended')
JOIN patients patient ON patient.id=encounter.patient_id AND patient.organization_id=encounter.organization_id
  AND patient.facility_id=encounter.facility_id AND patient.status='active'
JOIN protocol_heads head ON head.encounter_id=encounter.id AND head.organization_id=encounter.organization_id AND head.facility_id=encounter.facility_id
JOIN protocol_versions version ON version.id=head.current_signed_protocol_version_id AND version.status='signed'
WHERE access.can_manage=1 AND access.effective_from<=unixepoch('subsec')*1000
  AND (access.effective_until IS NULL OR access.effective_until>unixepoch('subsec')*1000);
--> statement-breakpoint
CREATE TRIGGER document_export_insert_authority BEFORE INSERT ON document_artifacts
WHEN (NEW.access_assignment_id IS NOT NULL OR NEW.export_command_id IS NOT NULL) AND NOT EXISTS (
  SELECT 1 FROM current_export_write_access access
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.encounter_id=NEW.encounter_id
    AND access.protocol_id=NEW.protocol_version_id AND access.membership_id=NEW.created_by_membership_id
    AND NEW.export_command_id IS NOT NULL AND length(NEW.export_command_id)>0 AND NEW.status='ready'
    AND NEW.byte_size>0 AND length(NEW.sha256)=64
)
BEGIN SELECT RAISE(ABORT,'export artifact requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER document_export_no_rewrite BEFORE UPDATE ON document_artifacts
WHEN OLD.access_assignment_id IS NOT NULL OR OLD.export_command_id IS NOT NULL
  OR NEW.access_assignment_id IS NOT NULL OR NEW.export_command_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'published export artifact is immutable'); END;
--> statement-breakpoint
CREATE TRIGGER document_export_no_delete BEFORE DELETE ON document_artifacts
WHEN OLD.access_assignment_id IS NOT NULL OR OLD.export_command_id IS NOT NULL
BEGIN SELECT RAISE(ABORT,'published export artifact is immutable'); END;
--> statement-breakpoint
CREATE VIEW current_export_packages AS
SELECT artifact.export_command_id, artifact.organization_id, artifact.facility_id, artifact.encounter_id,
  artifact.protocol_version_id, artifact.access_assignment_id, artifact.created_by_membership_id,
  access.protocol_version, artifact.created_at
FROM document_artifacts artifact JOIN current_export_write_access access
  ON access.assignment_id=artifact.access_assignment_id AND access.organization_id=artifact.organization_id
  AND access.facility_id=artifact.facility_id AND access.encounter_id=artifact.encounter_id
  AND access.protocol_id=artifact.protocol_version_id AND access.membership_id=artifact.created_by_membership_id
WHERE artifact.status='ready'
GROUP BY artifact.export_command_id, artifact.organization_id, artifact.facility_id, artifact.encounter_id,
  artifact.protocol_version_id, artifact.access_assignment_id, artifact.created_by_membership_id, access.protocol_version, artifact.created_at
HAVING count(*)=5 AND count(DISTINCT artifact.kind)=5;
--> statement-breakpoint
CREATE TRIGGER document_export_audit_authority BEFORE INSERT ON audit_events
WHEN NEW.action='document.export.generate' AND NOT EXISTS (
  SELECT 1 FROM current_export_packages package JOIN memberships member ON member.id=package.created_by_membership_id
  WHERE package.export_command_id=json_extract(NEW.metadata_json,'$.exportCommandId')
    AND package.access_assignment_id=json_extract(NEW.metadata_json,'$.accessAssignmentId')
    AND package.organization_id=NEW.organization_id AND package.facility_id=NEW.facility_id
    AND package.created_by_membership_id=NEW.actor_membership_id AND member.user_id=NEW.actor_id
    AND NEW.actor_type='user' AND NEW.outcome='succeeded' AND NEW.entity_type='protocol_version'
    AND package.protocol_version_id=NEW.entity_id AND package.created_at=NEW.occurred_at
    AND json_extract(NEW.metadata_json,'$.protocolId')=package.protocol_version_id
    AND json_extract(NEW.metadata_json,'$.protocolVersion')=package.protocol_version
    AND json_array_length(NEW.metadata_json,'$.artifacts')=5
    AND (SELECT count(DISTINCT json_extract(j.value,'$.id')) FROM json_each(NEW.metadata_json,'$.artifacts') j
      JOIN document_artifacts a ON a.id=json_extract(j.value,'$.id') AND a.export_command_id=package.export_command_id
      AND a.kind=json_extract(j.value,'$.kind') AND a.sha256=json_extract(j.value,'$.sha256')
      AND a.byte_size=json_extract(j.value,'$.byteSize'))=5
)
BEGIN SELECT RAISE(ABORT,'export audit requires matching package'); END;
--> statement-breakpoint
CREATE TRIGGER document_export_command_authority BEFORE INSERT ON command_idempotency
WHEN NEW.operation='document.export.generate' AND NOT EXISTS (
  SELECT 1 FROM current_export_packages package JOIN audit_events audit
    ON json_extract(audit.metadata_json,'$.exportCommandId')=package.export_command_id
    AND audit.action='document.export.generate' AND audit.outcome='succeeded'
    AND audit.organization_id=package.organization_id AND audit.facility_id=package.facility_id
    AND audit.entity_id=package.protocol_version_id AND audit.actor_membership_id=package.created_by_membership_id
  WHERE package.export_command_id=NEW.id AND package.access_assignment_id=NEW.access_assignment_id
    AND package.organization_id=NEW.organization_id AND package.facility_id=NEW.facility_id
    AND package.created_by_membership_id=NEW.actor_membership_id AND package.created_at=NEW.created_at
    AND NEW.status='processing' AND NEW.response_json IS NULL AND NEW.result_resource_id IS NULL AND NEW.result_resource_type IS NULL
)
BEGIN SELECT RAISE(ABORT,'export command requires matching package and audit'); END;
--> statement-breakpoint
CREATE TRIGGER document_export_result_authority BEFORE UPDATE ON command_idempotency
WHEN NEW.operation='document.export.generate' AND NEW.status='succeeded' AND NOT EXISTS (
  SELECT 1 FROM current_export_packages package
  WHERE package.export_command_id=NEW.id AND package.access_assignment_id=NEW.access_assignment_id
    AND package.organization_id=NEW.organization_id AND package.facility_id=NEW.facility_id
    AND package.created_by_membership_id=NEW.actor_membership_id AND package.created_at=NEW.completed_at
    AND NEW.result_resource_type='export_bundle' AND NEW.result_resource_id=package.protocol_version_id
    AND json_extract(NEW.response_json,'$.protocolId')=package.protocol_version_id
    AND json_extract(NEW.response_json,'$.protocolVersion')=package.protocol_version
    AND json_extract(NEW.response_json,'$.encounterId')=package.encounter_id
    AND json_array_length(NEW.response_json,'$.artifacts')=5
    AND (SELECT count(DISTINCT json_extract(j.value,'$.id')) FROM json_each(NEW.response_json,'$.artifacts') j
      JOIN document_artifacts a ON a.id=json_extract(j.value,'$.id') AND a.export_command_id=package.export_command_id
      AND a.kind=json_extract(j.value,'$.kind') AND a.object_key=json_extract(j.value,'$.objectKey')
      AND a.mime_type=json_extract(j.value,'$.mimeType') AND a.sha256=json_extract(j.value,'$.sha256')
      AND a.byte_size=json_extract(j.value,'$.byteSize')
      AND length(json_extract(j.value,'$.filename'))>0
      AND substr(a.object_key,-length(json_extract(j.value,'$.filename')))=json_extract(j.value,'$.filename'))=5
)
BEGIN SELECT RAISE(ABORT,'export response requires matching package'); END;
