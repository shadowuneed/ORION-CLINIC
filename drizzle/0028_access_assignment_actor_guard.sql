DROP TRIGGER department_access_assignment_versions_insert_guard;
--> statement-breakpoint
CREATE TRIGGER department_access_assignment_versions_insert_guard
BEFORE INSERT ON department_access_assignment_versions
FOR EACH ROW
BEGIN
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM department_access_assignments assignment
    WHERE assignment.organization_id = NEW.organization_id
      AND assignment.facility_id = NEW.facility_id
      AND assignment.id = NEW.assignment_id
      AND assignment.department_id = NEW.department_id
      AND assignment.membership_id = NEW.membership_id
  ) THEN RAISE(ABORT, 'access assignment version scope mismatch') END;
  SELECT CASE WHEN NOT EXISTS (
    SELECT 1 FROM memberships membership
    JOIN users user ON user.id = membership.user_id
    WHERE membership.organization_id = NEW.organization_id
      AND membership.facility_id = NEW.facility_id
      AND membership.id = NEW.changed_by_membership_id
      AND membership.status = 'active'
      AND user.status = 'active'
  ) THEN RAISE(ABORT, 'access assignment actor must be active in scope') END;
  SELECT CASE WHEN NEW.source_type = 'administrator' AND NOT EXISTS (
    SELECT 1
    FROM department_access_assignments actor_assignment
    JOIN department_access_assignment_heads actor_head
      ON actor_head.organization_id = actor_assignment.organization_id
      AND actor_head.facility_id = actor_assignment.facility_id
      AND actor_head.assignment_id = actor_assignment.id
    JOIN department_access_assignment_versions actor_version
      ON actor_version.organization_id = actor_head.organization_id
      AND actor_version.facility_id = actor_head.facility_id
      AND actor_version.assignment_id = actor_head.assignment_id
      AND actor_version.id = actor_head.current_version_id
    JOIN department_heads actor_department_head
      ON actor_department_head.organization_id = actor_assignment.organization_id
      AND actor_department_head.facility_id = actor_assignment.facility_id
      AND actor_department_head.department_id = actor_assignment.department_id
    JOIN department_versions actor_department_version
      ON actor_department_version.organization_id = actor_department_head.organization_id
      AND actor_department_version.facility_id = actor_department_head.facility_id
      AND actor_department_version.department_id = actor_department_head.department_id
      AND actor_department_version.id = actor_department_head.current_version_id
    WHERE actor_assignment.organization_id = NEW.organization_id
      AND actor_assignment.facility_id = NEW.facility_id
      AND actor_assignment.membership_id = NEW.changed_by_membership_id
      AND actor_version.status = 'active'
      AND actor_version.effective_from <= NEW.changed_at
      AND (actor_version.effective_until IS NULL OR actor_version.effective_until > NEW.changed_at)
      AND actor_department_version.status = 'active'
      AND NOT EXISTS (
        SELECT 1 FROM json_each(actor_version.deny_permissions_json)
        WHERE value = 'access.manage'
      )
      AND (
        EXISTS (SELECT 1 FROM json_each(actor_version.roles_json) WHERE value = 'administrator')
        OR EXISTS (SELECT 1 FROM json_each(actor_version.allow_permissions_json) WHERE value = 'access.manage')
      )
  ) THEN RAISE(ABORT, 'administrator source requires current access.manage') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.roles_json)
    WHERE type <> 'text' OR value NOT IN (
      'doctor', 'nurse', 'registrar', 'administrator',
      'medical_lead', 'auditor', 'service'
    )
  ) THEN RAISE(ABORT, 'access assignment contains an unknown role') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.roles_json)
    GROUP BY value HAVING count(*) > 1
  ) THEN RAISE(ABORT, 'access assignment contains duplicate roles') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.roles_json) WHERE value = 'service'
  ) AND json_array_length(NEW.roles_json) <> 1
    THEN RAISE(ABORT, 'service role cannot be combined with interactive roles') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.allow_permissions_json)
    WHERE type <> 'text' OR value NOT IN (
      'clinic.dashboard.read', 'patient.directory.read',
      'patient.profile.write', 'encounter.read', 'encounter.manage',
      'orders.manage', 'scheduling.manage', 'care.manage',
      'observations.manage', 'communications.manage', 'access.self.read',
      'access.manage', 'audit.read', 'clinical_policy.review',
      'service.integration.execute'
    )
  ) THEN RAISE(ABORT, 'access assignment contains an unknown allow permission') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.allow_permissions_json)
    GROUP BY value HAVING count(*) > 1
  ) THEN RAISE(ABORT, 'access assignment contains duplicate allow permissions') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.deny_permissions_json)
    WHERE type <> 'text' OR value NOT IN (
      'clinic.dashboard.read', 'patient.directory.read',
      'patient.profile.write', 'encounter.read', 'encounter.manage',
      'orders.manage', 'scheduling.manage', 'care.manage',
      'observations.manage', 'communications.manage', 'access.self.read',
      'access.manage', 'audit.read', 'clinical_policy.review',
      'service.integration.execute'
    )
  ) THEN RAISE(ABORT, 'access assignment contains an unknown deny permission') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM json_each(NEW.deny_permissions_json)
    GROUP BY value HAVING count(*) > 1
  ) THEN RAISE(ABORT, 'access assignment contains duplicate deny permissions') END;
  SELECT CASE WHEN EXISTS (
    SELECT 1
    FROM json_each(NEW.allow_permissions_json) allow_permission
    JOIN json_each(NEW.deny_permissions_json) deny_permission
      ON deny_permission.value = allow_permission.value
  ) THEN RAISE(ABORT, 'access assignment allow and deny permissions overlap') END;
  SELECT CASE WHEN NEW.version = 1 AND EXISTS (
    SELECT 1 FROM department_access_assignment_heads head
    WHERE head.organization_id = NEW.organization_id
      AND head.facility_id = NEW.facility_id
      AND head.assignment_id = NEW.assignment_id
  ) THEN RAISE(ABORT, 'access assignment initial version already has a head') END;
  SELECT CASE WHEN NEW.version > 1 AND NOT EXISTS (
    SELECT 1
    FROM department_access_assignment_heads head
    JOIN department_access_assignment_versions previous
      ON previous.organization_id = head.organization_id
      AND previous.facility_id = head.facility_id
      AND previous.assignment_id = head.assignment_id
      AND previous.department_id = head.department_id
      AND previous.membership_id = head.membership_id
      AND previous.id = head.current_version_id
    WHERE head.organization_id = NEW.organization_id
      AND head.facility_id = NEW.facility_id
      AND head.assignment_id = NEW.assignment_id
      AND head.department_id = NEW.department_id
      AND head.membership_id = NEW.membership_id
      AND previous.id = NEW.supersedes_version_id
      AND previous.version + 1 = NEW.version
  ) THEN RAISE(ABORT, 'access assignment version must extend the current head') END;
END;
