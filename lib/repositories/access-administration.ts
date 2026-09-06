import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { AccessAdministrationScope } from '@/lib/auth/access-administration';
import type {
  CreateDepartmentCommand,
  DepartmentKind,
  DepartmentStatus,
  GrantAccessAssignmentCommand,
  UpdateAccessAssignmentCommand,
  UpdateDepartmentCommand,
} from '@/lib/domain/access-administration';
import { serializeAccessRules } from '@/lib/domain/access-administration';
import { parseAccessAssignment } from '@/lib/domain/access-governance';
import type {
  ClinicPermission,
  OrganizationRole,
} from '@/lib/domain/access-governance';
import type { MembershipRole } from '@/lib/auth/workspace-access';

export type ManagedDepartment = {
  id: string;
  code: string;
  name: string;
  kind: DepartmentKind;
  status: DepartmentStatus;
  version: number;
  versionId: string;
  lockVersion: number;
  changeReason: string;
  changedAt: number;
};

export type ManagedMembership = {
  id: string;
  displayName: string;
  legacyRole: MembershipRole;
  status: 'active' | 'disabled';
};

export type ManagedAccessAssignment = {
  id: string;
  departmentId: string;
  membershipId: string;
  memberDisplayName: string;
  version: number;
  versionId: string;
  lockVersion: number;
  status: 'active' | 'revoked' | 'expired';
  roles: OrganizationRole[];
  allowPermissions: ClinicPermission[];
  denyPermissions: ClinicPermission[];
  effectivePermissions: ClinicPermission[];
  effectiveFrom: number;
  effectiveUntil: number | null;
  changeReason: string;
  changedAt: number;
};

export type AccessAdministrationWorkspace = {
  scope: { organizationId: string; facilityId: string };
  departments: ManagedDepartment[];
  memberships: ManagedMembership[];
  assignments: ManagedAccessAssignment[];
};

type DepartmentRow = {
  id: string;
  code: string;
  name: string;
  kind: DepartmentKind;
  status: DepartmentStatus;
  version: number;
  versionId: string;
  lockVersion: number;
  changeReason: string;
  changedAt: number;
};

type AssignmentRow = {
  id: string;
  departmentId: string;
  membershipId: string;
  memberDisplayName: string;
  version: number;
  versionId: string;
  lockVersion: number;
  status: 'active' | 'revoked';
  rolesJson: string;
  allowPermissionsJson: string;
  denyPermissionsJson: string;
  effectiveFrom: number;
  effectiveUntil: number | null;
  changeReason: string;
  changedAt: number;
};

type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type CommandRow = {
  requestHash: string;
  status: 'processing' | 'succeeded' | 'failed';
  resultResourceId: string | null;
  responseJson: string | null;
};

export class AccessAdministrationForbiddenError extends Error {
  constructor() {
    super('The selected assignment no longer grants access.manage');
    this.name = 'AccessAdministrationForbiddenError';
  }
}

export class AccessAdministrationNotFoundError extends Error {
  constructor(resource: 'department' | 'assignment' | 'membership') {
    super(`The ${resource} was not found in the selected scope`);
    this.name = 'AccessAdministrationNotFoundError';
  }
}

export class AccessAdministrationConflictError extends Error {
  constructor(message = 'The access command conflicts with current state') {
    super(message);
    this.name = 'AccessAdministrationConflictError';
  }
}

export class AccessAdministrationUnchangedError extends Error {
  constructor() {
    super('The command does not change the current version');
    this.name = 'AccessAdministrationUnchangedError';
  }
}

function toAssignment(row: AssignmentRow): ManagedAccessAssignment {
  const parsed = parseAccessAssignment({
    rolesJson: row.rolesJson,
    allowPermissionsJson: row.allowPermissionsJson,
    denyPermissionsJson: row.denyPermissionsJson,
  });
  const status =
    row.status === 'revoked'
      ? 'revoked'
      : row.effectiveUntil !== null && row.effectiveUntil <= Date.now()
        ? 'expired'
        : 'active';
  return {
    id: row.id,
    departmentId: row.departmentId,
    membershipId: row.membershipId,
    memberDisplayName: row.memberDisplayName,
    version: row.version,
    versionId: row.versionId,
    lockVersion: row.lockVersion,
    status,
    ...parsed,
    effectiveFrom: row.effectiveFrom,
    effectiveUntil: row.effectiveUntil,
    changeReason: row.changeReason,
    changedAt: row.changedAt,
  };
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class D1AccessAdministrationRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: AccessAdministrationScope,
  ) {}

  async getWorkspace(): Promise<AccessAdministrationWorkspace> {
    await this.assertAuthorized();
    const departments = await this.database
      .prepare(`
        select department.id, department.code,
          version.name, version.kind, version.status, version.version,
          version.id as versionId, head.lock_version as lockVersion,
          version.change_reason as changeReason, version.changed_at as changedAt
        from departments department
        join department_heads head
          on head.organization_id = department.organization_id
          and head.facility_id = department.facility_id
          and head.department_id = department.id
        join department_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.department_id = head.department_id
          and version.id = head.current_version_id
        where department.organization_id = ?1 and department.facility_id = ?2
        order by version.status, version.name, department.id
      `)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .all<DepartmentRow>();
    const memberships = await this.database
      .prepare(`
        select membership.id, user.display_name as displayName,
          membership.role as legacyRole, membership.status
        from memberships membership
        join users user on user.id = membership.user_id
        where membership.organization_id = ?1 and membership.facility_id = ?2
          and user.status = 'active'
        order by membership.status, user.display_name, membership.id
      `)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .all<ManagedMembership>();
    const assignments = await this.database
      .prepare(`
        select assignment.id, assignment.department_id as departmentId,
          assignment.membership_id as membershipId,
          user.display_name as memberDisplayName,
          version.version, version.id as versionId,
          head.lock_version as lockVersion, version.status,
          version.roles_json as rolesJson,
          version.allow_permissions_json as allowPermissionsJson,
          version.deny_permissions_json as denyPermissionsJson,
          version.effective_from as effectiveFrom,
          version.effective_until as effectiveUntil,
          version.change_reason as changeReason,
          version.changed_at as changedAt
        from department_access_assignments assignment
        join department_access_assignment_heads head
          on head.organization_id = assignment.organization_id
          and head.facility_id = assignment.facility_id
          and head.assignment_id = assignment.id
        join department_access_assignment_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.assignment_id = head.assignment_id
          and version.id = head.current_version_id
        join memberships membership
          on membership.organization_id = assignment.organization_id
          and membership.facility_id = assignment.facility_id
          and membership.id = assignment.membership_id
        join users user on user.id = membership.user_id
        where assignment.organization_id = ?1 and assignment.facility_id = ?2
        order by user.display_name, assignment.id
      `)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .all<AssignmentRow>();
    return {
      scope: {
        organizationId: this.scope.organizationId,
        facilityId: this.scope.facilityId,
      },
      departments: departments.results,
      memberships: memberships.results,
      assignments: assignments.results.map(toAssignment),
    };
  }

  async createDepartment(
    input: CreateDepartmentCommand & { actorId: string; requestId: string },
  ): Promise<{ departmentId: string; version: number }> {
    const operation = 'access.department.create';
    const normalized = {
      code: input.code.trim(),
      name: input.name.trim(),
      kind: input.kind,
      changeReason: input.changeReason.trim(),
    };
    const requestHash = await sha256(JSON.stringify({ operation, ...normalized }));
    const replay = await this.findCommand(operation, input.idempotencyKey);
    if (replay) {
      return this.resolveReplay<{ departmentId: string; version: number }>(
        replay,
        requestHash,
      );
    }

    const now = Date.now();
    const departmentId = `department-${crypto.randomUUID()}`;
    const versionId = `department-version-${crypto.randomUUID()}`;
    const headId = `department-head-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const response = { departmentId, version: 1 };
    const statements = [
      this.commandStart(commandId, operation, input.idempotencyKey, requestHash, now),
      this.database.prepare(`
        insert into departments (
          id, organization_id, facility_id, code, name, kind, status,
          created_at, updated_at, version
        )
        select ?1, ?2, ?3, ?4, ?5, ?6, 'active', ?7, ?7, 1
        where exists (select 1 from command_idempotency where id = ?8 and status = 'processing')
      `).bind(
        departmentId, this.scope.organizationId, this.scope.facilityId,
        normalized.code, normalized.name, normalized.kind, now, commandId,
      ),
      this.database.prepare(`
        insert into department_versions (
          id, organization_id, facility_id, department_id, version,
          supersedes_version_id, name, kind, status, change_reason,
          changed_by_membership_id, changed_at, created_at
        )
        select ?1, ?2, ?3, ?4, 1, null, ?5, ?6, 'active', ?7, ?8, ?9, ?9
        where exists (select 1 from command_idempotency where id = ?10 and status = 'processing')
      `).bind(
        versionId, this.scope.organizationId, this.scope.facilityId,
        departmentId, normalized.name, normalized.kind, normalized.changeReason,
        this.scope.actorMembershipId, now, commandId,
      ),
      this.database.prepare(`
        insert into department_heads (
          id, organization_id, facility_id, department_id, current_version_id,
          lock_version, created_at, updated_at
        )
        select ?1, ?2, ?3, ?4, ?5, 1, ?6, ?6
        where exists (select 1 from command_idempotency where id = ?7 and status = 'processing')
      `).bind(
        headId, this.scope.organizationId, this.scope.facilityId,
        departmentId, versionId, now, commandId,
      ),
    ];
    return this.commitCommand({
      commandId,
      operation,
      idempotencyKey: input.idempotencyKey,
      requestHash,
      actorId: input.actorId,
      requestId: input.requestId,
      entityType: 'department',
      entityId: departmentId,
      metadata: { action: 'create', code: normalized.code, version: 1 },
      response,
      now,
      statements,
    });
  }

  async updateDepartment(
    input: UpdateDepartmentCommand & { actorId: string; requestId: string },
  ): Promise<{ departmentId: string; version: number }> {
    const operation = 'access.department.change';
    const normalized = {
      name: input.name.trim(),
      kind: input.kind,
      status: input.status,
      changeReason: input.changeReason.trim(),
    };
    const requestHash = await sha256(JSON.stringify({
      operation,
      departmentId: input.departmentId,
      expectedVersion: input.expectedVersion,
      ...normalized,
    }));
    const replay = await this.findCommand(operation, input.idempotencyKey);
    if (replay) {
      return this.resolveReplay<{ departmentId: string; version: number }>(
        replay,
        requestHash,
      );
    }
    const current = await this.getDepartment(input.departmentId);
    if (!current) throw new AccessAdministrationNotFoundError('department');
    if (current.version !== input.expectedVersion) {
      throw new AccessAdministrationConflictError('Department version is stale');
    }
    if (
      current.name === normalized.name && current.kind === normalized.kind &&
      current.status === normalized.status
    ) throw new AccessAdministrationUnchangedError();
    if (normalized.status === 'disabled') {
      const actorAssignment = await this.getAssignment(
        this.scope.actorAssignmentId,
      );
      if (actorAssignment?.departmentId === current.id) {
        throw new AccessAdministrationConflictError(
          'The department authorizing this session cannot disable itself',
        );
      }
    }

    const now = Date.now();
    const versionId = `department-version-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const nextVersion = current.version + 1;
    const response = { departmentId: current.id, version: nextVersion };
    const statements = [
      this.commandStart(commandId, operation, input.idempotencyKey, requestHash, now),
      this.database.prepare(`
        insert into department_versions (
          id, organization_id, facility_id, department_id, version,
          supersedes_version_id, name, kind, status, change_reason,
          changed_by_membership_id, changed_at, created_at
        )
        select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?12
        where exists (select 1 from command_idempotency where id = ?13 and status = 'processing')
      `).bind(
        versionId, this.scope.organizationId, this.scope.facilityId,
        current.id, nextVersion, current.versionId, normalized.name,
        normalized.kind, normalized.status, normalized.changeReason,
        this.scope.actorMembershipId, now, commandId,
      ),
      this.database.prepare(`
        update department_heads
        set current_version_id = ?1, lock_version = lock_version + 1, updated_at = ?2
        where organization_id = ?3 and facility_id = ?4 and department_id = ?5
          and current_version_id = ?6 and lock_version = ?7
          and exists (select 1 from command_idempotency where id = ?8 and status = 'processing')
      `).bind(
        versionId, now, this.scope.organizationId, this.scope.facilityId,
        current.id, current.versionId, current.lockVersion, commandId,
      ),
    ];
    return this.commitCommand({
      commandId, operation, idempotencyKey: input.idempotencyKey, requestHash,
      actorId: input.actorId, requestId: input.requestId,
      entityType: 'department', entityId: current.id,
      metadata: { action: normalized.status === 'disabled' ? 'disable' : 'change', version: nextVersion },
      response, now, statements,
    });
  }

  async grantAssignment(
    input: GrantAccessAssignmentCommand & { actorId: string; requestId: string },
  ): Promise<{ assignmentId: string; version: number }> {
    const operation = 'access.assignment.grant';
    const rules = serializeAccessRules(input);
    const requestHash = await sha256(JSON.stringify({
      operation,
      departmentId: input.departmentId,
      membershipId: input.membershipId,
      roles: input.roles,
      allowPermissions: input.allowPermissions,
      denyPermissions: input.denyPermissions,
      effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil,
      changeReason: input.changeReason.trim(),
    }));
    const replay = await this.findCommand(operation, input.idempotencyKey);
    if (replay) {
      return this.resolveReplay<{ assignmentId: string; version: number }>(
        replay,
        requestHash,
      );
    }
    const department = await this.getDepartment(input.departmentId);
    if (!department || department.status !== 'active') {
      throw new AccessAdministrationNotFoundError('department');
    }
    if (!(await this.getMembership(input.membershipId))) {
      throw new AccessAdministrationNotFoundError('membership');
    }

    const now = Date.now();
    const assignmentId = `access-assignment-${crypto.randomUUID()}`;
    const versionId = `access-version-${crypto.randomUUID()}`;
    const headId = `access-head-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const response = { assignmentId, version: 1 };
    const statements = [
      this.commandStart(commandId, operation, input.idempotencyKey, requestHash, now),
      this.database.prepare(`
        insert into department_access_assignments (
          id, organization_id, facility_id, department_id, membership_id,
          created_by_membership_id, created_at
        )
        select ?1, ?2, ?3, ?4, ?5, ?6, ?7
        where exists (select 1 from command_idempotency where id = ?8 and status = 'processing')
      `).bind(
        assignmentId, this.scope.organizationId, this.scope.facilityId,
        input.departmentId, input.membershipId, this.scope.actorMembershipId,
        now, commandId,
      ),
      this.database.prepare(`
        insert into department_access_assignment_versions (
          id, organization_id, facility_id, assignment_id, department_id,
          membership_id, version, supersedes_version_id, status, source_type,
          roles_json, allow_permissions_json, deny_permissions_json,
          effective_from, effective_until, change_reason,
          changed_by_membership_id, changed_at, created_at
        )
        select ?1, ?2, ?3, ?4, ?5, ?6, 1, null, 'active', 'administrator',
          ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?14
        where exists (select 1 from command_idempotency where id = ?15 and status = 'processing')
      `).bind(
        versionId, this.scope.organizationId, this.scope.facilityId,
        assignmentId, input.departmentId, input.membershipId,
        rules.rolesJson, rules.allowPermissionsJson, rules.denyPermissionsJson,
        input.effectiveFrom, input.effectiveUntil, input.changeReason.trim(),
        this.scope.actorMembershipId, now, commandId,
      ),
      this.database.prepare(`
        insert into department_access_assignment_heads (
          id, organization_id, facility_id, assignment_id, department_id,
          membership_id, current_version_id, lock_version, created_at, updated_at
        )
        select ?1, ?2, ?3, ?4, ?5, ?6, ?7, 1, ?8, ?8
        where exists (select 1 from command_idempotency where id = ?9 and status = 'processing')
      `).bind(
        headId, this.scope.organizationId, this.scope.facilityId,
        assignmentId, input.departmentId, input.membershipId,
        versionId, now, commandId,
      ),
    ];
    return this.commitCommand({
      commandId, operation, idempotencyKey: input.idempotencyKey, requestHash,
      actorId: input.actorId, requestId: input.requestId,
      entityType: 'department_access_assignment', entityId: assignmentId,
      metadata: { action: 'grant', departmentId: input.departmentId, membershipId: input.membershipId, version: 1 },
      response, now, statements,
    });
  }

  async updateAssignment(
    input: UpdateAccessAssignmentCommand & { actorId: string; requestId: string },
  ): Promise<{ assignmentId: string; version: number }> {
    const operation = input.status === 'revoked'
      ? 'access.assignment.revoke'
      : 'access.assignment.change';
    const rules = serializeAccessRules(input);
    const requestHash = await sha256(JSON.stringify({
      operation, assignmentId: input.assignmentId,
      expectedVersion: input.expectedVersion, status: input.status,
      roles: input.roles, allowPermissions: input.allowPermissions,
      denyPermissions: input.denyPermissions, effectiveFrom: input.effectiveFrom,
      effectiveUntil: input.effectiveUntil, changeReason: input.changeReason.trim(),
    }));
    const replay = await this.findCommand(operation, input.idempotencyKey);
    if (replay) {
      return this.resolveReplay<{ assignmentId: string; version: number }>(
        replay,
        requestHash,
      );
    }
    if (input.assignmentId === this.scope.actorAssignmentId) {
      throw new AccessAdministrationConflictError(
        'The assignment authorizing this session cannot change itself',
      );
    }
    const current = await this.getAssignment(input.assignmentId);
    if (!current) throw new AccessAdministrationNotFoundError('assignment');
    if (current.version !== input.expectedVersion) {
      throw new AccessAdministrationConflictError('Assignment version is stale');
    }
    if (
      current.status === input.status &&
      JSON.stringify(current.roles) === JSON.stringify(input.roles) &&
      JSON.stringify(current.allowPermissions) === JSON.stringify(input.allowPermissions) &&
      JSON.stringify(current.denyPermissions) === JSON.stringify(input.denyPermissions) &&
      current.effectiveFrom === input.effectiveFrom &&
      current.effectiveUntil === input.effectiveUntil
    ) throw new AccessAdministrationUnchangedError();
    if (input.status === 'active') {
      const department = await this.getDepartment(current.departmentId);
      if (!department || department.status !== 'active') {
        throw new AccessAdministrationConflictError('A disabled department cannot receive active access');
      }
    }

    const now = Date.now();
    const versionId = `access-version-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const nextVersion = current.version + 1;
    const response = { assignmentId: current.id, version: nextVersion };
    const statements = [
      this.commandStart(commandId, operation, input.idempotencyKey, requestHash, now),
      this.database.prepare(`
        insert into department_access_assignment_versions (
          id, organization_id, facility_id, assignment_id, department_id,
          membership_id, version, supersedes_version_id, status, source_type,
          roles_json, allow_permissions_json, deny_permissions_json,
          effective_from, effective_until, change_reason,
          changed_by_membership_id, changed_at, created_at
        )
        select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, 'administrator',
          ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?17
        where exists (select 1 from command_idempotency where id = ?18 and status = 'processing')
      `).bind(
        versionId, this.scope.organizationId, this.scope.facilityId,
        current.id, current.departmentId, current.membershipId,
        nextVersion, current.versionId, input.status,
        rules.rolesJson, rules.allowPermissionsJson, rules.denyPermissionsJson,
        input.effectiveFrom, input.effectiveUntil, input.changeReason.trim(),
        this.scope.actorMembershipId, now, commandId,
      ),
      this.database.prepare(`
        update department_access_assignment_heads
        set current_version_id = ?1, lock_version = lock_version + 1, updated_at = ?2
        where organization_id = ?3 and facility_id = ?4 and assignment_id = ?5
          and current_version_id = ?6 and lock_version = ?7
          and exists (select 1 from command_idempotency where id = ?8 and status = 'processing')
      `).bind(
        versionId, now, this.scope.organizationId, this.scope.facilityId,
        current.id, current.versionId, current.lockVersion, commandId,
      ),
    ];
    return this.commitCommand({
      commandId, operation, idempotencyKey: input.idempotencyKey, requestHash,
      actorId: input.actorId, requestId: input.requestId,
      entityType: 'department_access_assignment', entityId: current.id,
      metadata: { action: input.status === 'revoked' ? 'revoke' : 'change', version: nextVersion },
      response, now, statements,
    });
  }

  private async getDepartment(id: string) {
    return this.database.prepare(`
      select department.id, department.code, version.name, version.kind,
        version.status, version.version, version.id as versionId,
        head.lock_version as lockVersion, version.change_reason as changeReason,
        version.changed_at as changedAt
      from departments department
      join department_heads head
        on head.organization_id = department.organization_id
        and head.facility_id = department.facility_id
        and head.department_id = department.id
      join department_versions version
        on version.organization_id = head.organization_id
        and version.facility_id = head.facility_id
        and version.department_id = head.department_id
        and version.id = head.current_version_id
      where department.organization_id = ?1 and department.facility_id = ?2
        and department.id = ?3 limit 1
    `).bind(this.scope.organizationId, this.scope.facilityId, id).first<DepartmentRow>();
  }

  private async getMembership(id: string) {
    return this.database.prepare(`
      select membership.id
      from memberships membership join users user on user.id = membership.user_id
      where membership.organization_id = ?1 and membership.facility_id = ?2
        and membership.id = ?3 and membership.status = 'active'
        and user.status = 'active' limit 1
    `).bind(this.scope.organizationId, this.scope.facilityId, id).first<{ id: string }>();
  }

  private async getAssignment(id: string) {
    const row = await this.database.prepare(`
      select assignment.id, assignment.department_id as departmentId,
        assignment.membership_id as membershipId, user.display_name as memberDisplayName,
        version.version, version.id as versionId, head.lock_version as lockVersion,
        version.status, version.roles_json as rolesJson,
        version.allow_permissions_json as allowPermissionsJson,
        version.deny_permissions_json as denyPermissionsJson,
        version.effective_from as effectiveFrom, version.effective_until as effectiveUntil,
        version.change_reason as changeReason, version.changed_at as changedAt
      from department_access_assignments assignment
      join department_access_assignment_heads head
        on head.organization_id = assignment.organization_id
        and head.facility_id = assignment.facility_id and head.assignment_id = assignment.id
      join department_access_assignment_versions version
        on version.organization_id = head.organization_id
        and version.facility_id = head.facility_id
        and version.assignment_id = head.assignment_id and version.id = head.current_version_id
      join memberships membership on membership.id = assignment.membership_id
      join users user on user.id = membership.user_id
      where assignment.organization_id = ?1 and assignment.facility_id = ?2
        and assignment.id = ?3 limit 1
    `).bind(this.scope.organizationId, this.scope.facilityId, id).first<AssignmentRow>();
    return row ? toAssignment(row) : null;
  }

  private async assertAuthorized() {
    const allowed = await this.database.prepare(this.actorAuthorizationSql())
      .bind(
        this.scope.organizationId, this.scope.facilityId,
        this.scope.actorMembershipId, this.scope.actorUserId,
        this.scope.actorAssignmentId, this.scope.actorAssignmentVersionId,
        Date.now(), Date.now(),
      ).first<{ allowed: number }>();
    if (!allowed) throw new AccessAdministrationForbiddenError();
  }

  private actorAuthorizationSql() {
    return `
      select 1 as allowed
      from department_access_assignment_heads actor_head
      join department_access_assignment_versions actor_version
        on actor_version.organization_id = actor_head.organization_id
        and actor_version.facility_id = actor_head.facility_id
        and actor_version.assignment_id = actor_head.assignment_id
        and actor_version.id = actor_head.current_version_id
      join department_access_assignments actor_assignment
        on actor_assignment.organization_id = actor_head.organization_id
        and actor_assignment.facility_id = actor_head.facility_id
        and actor_assignment.id = actor_head.assignment_id
      join memberships actor_membership
        on actor_membership.organization_id = actor_assignment.organization_id
        and actor_membership.facility_id = actor_assignment.facility_id
        and actor_membership.id = actor_assignment.membership_id
      join users actor_user on actor_user.id = actor_membership.user_id
      join department_heads actor_department_head
        on actor_department_head.organization_id = actor_assignment.organization_id
        and actor_department_head.facility_id = actor_assignment.facility_id
        and actor_department_head.department_id = actor_assignment.department_id
      join department_versions actor_department_version
        on actor_department_version.organization_id = actor_department_head.organization_id
        and actor_department_version.facility_id = actor_department_head.facility_id
        and actor_department_version.department_id = actor_department_head.department_id
        and actor_department_version.id = actor_department_head.current_version_id
      where actor_head.organization_id = ? and actor_head.facility_id = ?
        and actor_membership.id = ? and actor_user.id = ?
        and actor_head.assignment_id = ? and actor_version.id = ?
        and actor_version.status = 'active'
        and actor_version.effective_from <= ?
        and (actor_version.effective_until is null or actor_version.effective_until > ?)
        and actor_membership.status = 'active' and actor_user.status = 'active'
        and actor_department_version.status = 'active'
        and not exists (
          select 1 from json_each(actor_version.deny_permissions_json)
          where value = 'access.manage'
        )
        and (
          exists (select 1 from json_each(actor_version.roles_json) where value = 'administrator')
          or exists (select 1 from json_each(actor_version.allow_permissions_json) where value = 'access.manage')
        )
      limit 1
    `;
  }

  private commandStart(
    commandId: string,
    operation: string,
    key: string,
    requestHash: string,
    now: number,
  ) {
    return this.database.prepare(`
      insert into command_idempotency (
        id, organization_id, facility_id, actor_membership_id,
        operation, idempotency_key, request_hash, status, created_at
      )
      select ?, ?, ?, ?, ?, ?, ?, 'processing', ?
      where exists (${this.actorAuthorizationSql()})
    `).bind(
      commandId, this.scope.organizationId, this.scope.facilityId,
      this.scope.actorMembershipId, operation, key, requestHash, now,
      this.scope.organizationId, this.scope.facilityId,
      this.scope.actorMembershipId, this.scope.actorUserId,
      this.scope.actorAssignmentId, this.scope.actorAssignmentVersionId, now, now,
    );
  }

  private async commitCommand<T extends Record<string, unknown>>(input: {
    commandId: string;
    operation: string;
    idempotencyKey: string;
    requestHash: string;
    actorId: string;
    requestId: string;
    entityType: string;
    entityId: string;
    metadata: Record<string, unknown>;
    response: T;
    now: number;
    statements: D1PreparedStatement[];
  }): Promise<T> {
    const auditHead = await this.getAuditHead();
    if (!auditHead) throw new AccessAdministrationConflictError('Audit stream unavailable');
    const sequence = auditHead.lastSequence + 1;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const metadataJson = JSON.stringify(input.metadata);
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.actorMembershipId,
      action: input.operation,
      outcome: 'succeeded',
      purpose: 'access_administration',
      schemaVersion: 1,
      entityType: input.entityType,
      entityId: input.entityId,
      requestId: input.requestId,
      metadataJson,
      occurredAt: input.now,
    });
    const tail = [
      this.database.prepare(`
        insert into audit_events (
          id, organization_id, facility_id, sequence, actor_type, actor_id,
          actor_membership_id, action, outcome, purpose, schema_version,
          entity_type, entity_id, request_id, metadata_json, previous_hash,
          event_hash, occurred_at
        )
        select ?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded',
          'access_administration', 1, ?8, ?9, ?10, ?11, ?12, ?13, ?14
        where exists (select 1 from command_idempotency where id = ?15 and status = 'processing')
      `).bind(
        auditEventId, this.scope.organizationId, this.scope.facilityId,
        sequence, input.actorId, this.scope.actorMembershipId,
        input.operation, input.entityType, input.entityId, input.requestId,
        metadataJson, auditHead.lastEventHash, eventHash, input.now, input.commandId,
      ),
      this.database.prepare(`
        update audit_stream_heads
        set last_sequence = ?1, last_event_hash = ?2,
          lock_version = lock_version + 1, updated_at = ?3
        where organization_id = ?4 and facility_id = ?5
          and last_sequence = ?6 and lock_version = ?7
          and exists (select 1 from audit_events where id = ?8)
      `).bind(
        sequence, eventHash, input.now,
        this.scope.organizationId, this.scope.facilityId,
        auditHead.lastSequence, auditHead.lockVersion, auditEventId,
      ),
      this.database.prepare(`
        update command_idempotency
        set status = 'succeeded', result_resource_type = ?1,
          result_resource_id = ?2, response_json = ?3, completed_at = ?4
        where id = ?5 and status = 'processing'
          and exists (select 1 from audit_events where id = ?6)
      `).bind(
        input.entityType, input.entityId, JSON.stringify(input.response),
        input.now, input.commandId, auditEventId,
      ),
    ];
    let batchError: unknown;
    try {
      const results = await this.database.batch([...input.statements, ...tail]);
      if (results.every((result) => result.meta.changes === 1)) return input.response;
    } catch (error) {
      // A racing retry is resolved below from the durable command record.
      batchError = error;
    }
    const replay = await this.findCommand(input.operation, input.idempotencyKey);
    if (replay) return this.resolveReplay<T>(replay, input.requestHash);
    throw new AccessAdministrationConflictError(
      batchError instanceof Error
        ? `The access command conflicts with current state: ${batchError.message}`
        : undefined,
    );
  }

  private getAuditHead() {
    return this.database.prepare(`
      select last_sequence as lastSequence, last_event_hash as lastEventHash,
        lock_version as lockVersion
      from audit_stream_heads
      where organization_id = ?1 and facility_id = ?2 limit 1
    `).bind(this.scope.organizationId, this.scope.facilityId).first<AuditHeadRow>();
  }

  private findCommand(operation: string, key: string) {
    return this.database.prepare(`
      select request_hash as requestHash, status,
        result_resource_id as resultResourceId, response_json as responseJson
      from command_idempotency
      where organization_id = ?1 and facility_id = ?2
        and actor_membership_id = ?3 and operation = ?4
        and idempotency_key = ?5 limit 1
    `).bind(
      this.scope.organizationId, this.scope.facilityId,
      this.scope.actorMembershipId, operation, key,
    ).first<CommandRow>();
  }

  private resolveReplay<T extends Record<string, unknown>>(
    row: CommandRow,
    requestHash: string,
  ): T {
    if (row.requestHash !== requestHash || row.status !== 'succeeded' || !row.responseJson) {
      throw new AccessAdministrationConflictError('Idempotency key is already bound');
    }
    try {
      return JSON.parse(row.responseJson) as T;
    } catch {
      throw new AccessAdministrationConflictError('Stored command response is invalid');
    }
  }
}
