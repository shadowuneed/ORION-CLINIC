-- ONLINE-1C2a2-fence: additive pending-operation invalidation only.
-- This is NOT current-action authorization, consent enforcement, key custody or
-- a broker. New reservations still require a future authorizing coordinator.
-- Only preparing/prepared operations retire; committed receipts and prior
-- retirement reasons remain unchanged. Existing 0050 triggers publish the
-- permanent retired event in the same source-mutation transaction.
--
-- Historical authority changes were not durably observed before this migration.
-- Conservatively retire pre-installation pending operations; their current
-- fingerprint cannot prove that no disable/re-enable occurred. This only runs
-- when the migration is explicitly applied, never on ordinary runtime startup.
UPDATE local_material_reservations
SET state = 'retired', retire_reason = 'authority_changed'
WHERE state IN ('preparing', 'prepared');
--> statement-breakpoint
SELECT CASE WHEN NOT EXISTS (
  SELECT 1 FROM local_material_reservations WHERE state IN ('preparing', 'prepared')
) THEN 1 ELSE json('local_material_authority_fence_incomplete') END AS verified;
--> statement-breakpoint
-- AFTER triggers avoid side effects for INSERT/UPDATE OR IGNORE that writes no
-- source row. INSERT also observes successful REPLACE when recursive_triggers=0
-- skips the displaced row's DELETE trigger. Every retirement is asserted so a
-- silently ignored pending-row update fails and rolls back the source mutation.

CREATE TRIGGER local_material_organizations_update_fence
AFTER UPDATE ON organizations
WHEN NEW.id IS NOT OLD.id OR NEW.status IS NOT OLD.status OR NEW.version IS NOT OLD.version
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = OLD.id OR json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.id);
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = OLD.id OR json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.id)
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
--> statement-breakpoint
CREATE TRIGGER local_material_organizations_insert_fence
AFTER INSERT ON organizations
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.id);
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.id)
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
--> statement-breakpoint
CREATE TRIGGER local_material_organizations_delete_fence
AFTER DELETE ON organizations
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = OLD.id);
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = OLD.id)
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
--> statement-breakpoint
-- Facility identity changes fence both the source and any same-id displaced row.
-- A name-only UPDATE normally preserves operations. UPDATE/INSERT OR REPLACE
-- can instead displace another id through UNIQUE(organization_id,name): its
-- missing facility is matched in the incoming organization after the write.
-- No broad organization-wide cancellation is needed for an ordinary new facility.
CREATE TRIGGER local_material_facilities_update_fence
AFTER UPDATE ON facilities
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.status IS NOT OLD.status OR NEW.version IS NOT OLD.version OR NEW.name IS NOT OLD.name
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (((NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.status IS NOT OLD.status OR NEW.version IS NOT OLD.version) AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') IN (OLD.id, NEW.id))
    OR (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.organization_id
      AND NOT EXISTS (SELECT 1 FROM facilities facility
        WHERE facility.id = json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId'))));
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (((NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.status IS NOT OLD.status OR NEW.version IS NOT OLD.version) AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') IN (OLD.id, NEW.id))
    OR (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.organization_id
      AND NOT EXISTS (SELECT 1 FROM facilities facility
        WHERE facility.id = json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId'))))
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
--> statement-breakpoint
CREATE TRIGGER local_material_facilities_insert_fence
AFTER INSERT ON facilities
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') IN (NEW.id) OR (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.organization_id
      AND NOT EXISTS (SELECT 1 FROM facilities facility
        WHERE facility.id = json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId'))));
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') IN (NEW.id) OR (json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.organization_id
      AND NOT EXISTS (SELECT 1 FROM facilities facility
        WHERE facility.id = json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId'))))
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
--> statement-breakpoint
CREATE TRIGGER local_material_facilities_delete_fence
AFTER DELETE ON facilities
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') IN (OLD.id));
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND (json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') IN (OLD.id))
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
--> statement-breakpoint
-- The descriptor does not contain a membership id. The stable selected
-- assignment locates it; the immutable owner user/org/facility tuple also matches
-- an alternate-id victim of UNIQUE(organization_id,facility_id,user_id) REPLACE.
-- Keeping both selectors covers changed identity and a surviving assignment root
-- without treating a supplied fingerprint as authority.
CREATE TRIGGER local_material_memberships_update_fence
AFTER UPDATE ON memberships
WHEN NEW.id IS NOT OLD.id OR NEW.organization_id IS NOT OLD.organization_id OR NEW.facility_id IS NOT OLD.facility_id OR NEW.user_id IS NOT OLD.user_id OR NEW.role IS NOT OLD.role OR NEW.status IS NOT OLD.status OR NEW.version IS NOT OLD.version
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND ((
    EXISTS (SELECT 1 FROM department_access_assignments assignment
      WHERE assignment.id = json_extract(local_material_reservations.descriptor_json, '$.owner.accessAssignmentId')
        AND assignment.membership_id IN (OLD.id, NEW.id))
    OR (local_material_reservations.owner_user_id = OLD.user_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = OLD.organization_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') = OLD.facility_id)
    OR (local_material_reservations.owner_user_id = NEW.user_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.organization_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') = NEW.facility_id)
  ));
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND ((
    EXISTS (SELECT 1 FROM department_access_assignments assignment
      WHERE assignment.id = json_extract(local_material_reservations.descriptor_json, '$.owner.accessAssignmentId')
        AND assignment.membership_id IN (OLD.id, NEW.id))
    OR (local_material_reservations.owner_user_id = OLD.user_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = OLD.organization_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') = OLD.facility_id)
    OR (local_material_reservations.owner_user_id = NEW.user_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.organization_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') = NEW.facility_id)
  ))
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
--> statement-breakpoint
CREATE TRIGGER local_material_memberships_insert_fence
AFTER INSERT ON memberships
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND ((
    EXISTS (SELECT 1 FROM department_access_assignments assignment
      WHERE assignment.id = json_extract(local_material_reservations.descriptor_json, '$.owner.accessAssignmentId')
        AND assignment.membership_id IN (NEW.id))
    OR (local_material_reservations.owner_user_id = NEW.user_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.organization_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') = NEW.facility_id)
  ));
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND ((
    EXISTS (SELECT 1 FROM department_access_assignments assignment
      WHERE assignment.id = json_extract(local_material_reservations.descriptor_json, '$.owner.accessAssignmentId')
        AND assignment.membership_id IN (NEW.id))
    OR (local_material_reservations.owner_user_id = NEW.user_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = NEW.organization_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') = NEW.facility_id)
  ))
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
--> statement-breakpoint
CREATE TRIGGER local_material_memberships_delete_fence
AFTER DELETE ON memberships
BEGIN
  UPDATE local_material_reservations
  SET state = 'retired', retire_reason = 'authority_changed'
  WHERE local_material_reservations.state IN ('preparing', 'prepared') AND ((
    EXISTS (SELECT 1 FROM department_access_assignments assignment
      WHERE assignment.id = json_extract(local_material_reservations.descriptor_json, '$.owner.accessAssignmentId')
        AND assignment.membership_id IN (OLD.id))
    OR (local_material_reservations.owner_user_id = OLD.user_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = OLD.organization_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') = OLD.facility_id)
  ));
  SELECT CASE WHEN EXISTS (
    SELECT 1 FROM local_material_reservations
    WHERE local_material_reservations.state IN ('preparing', 'prepared') AND ((
    EXISTS (SELECT 1 FROM department_access_assignments assignment
      WHERE assignment.id = json_extract(local_material_reservations.descriptor_json, '$.owner.accessAssignmentId')
        AND assignment.membership_id IN (OLD.id))
    OR (local_material_reservations.owner_user_id = OLD.user_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.organizationId') = OLD.organization_id
      AND json_extract(local_material_reservations.descriptor_json, '$.owner.facilityId') = OLD.facility_id)
  ))
  ) THEN RAISE(ABORT, 'authority change did not retire pending local material operations') END;
END;
