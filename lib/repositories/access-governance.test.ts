import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import {
  AccessAssignmentNotFoundError,
  resolveAccessOverview,
} from '@/lib/auth/access-governance';
import type { IdentityPrincipal } from '@/lib/auth/workspace-access';
import { D1AccessGovernanceRepository } from './access-governance';

type TestBoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
};

type ScopeFixture = {
  organizationId: string;
  facilityId: string;
  departmentId: string;
  userId: string;
  membershipId: string;
  administratorMembershipId: string;
  assignmentId: string;
  versionId: string;
  headId: string;
  principal: IdentityPrincipal;
};

const databases: DatabaseSync[] = [];
const EFFECTIVE_FROM = Date.UTC(2026, 0, 1);

function applyMigrations(target: DatabaseSync) {
  target.exec('pragma foreign_keys = on');
  for (const fileName of readdirSync('drizzle')
    .filter((name) => name.endsWith('.sql'))
    .sort()) {
    target.exec(
      readFileSync(join('drizzle', fileName), 'utf8').replaceAll(
        '--> statement-breakpoint',
        '',
      ),
    );
  }
}

function d1Result<T>(results: T[], changes = 0) {
  return { success: true, results, meta: { changes } } as unknown as D1Result<T>;
}

function createD1Adapter(target: DatabaseSync): D1Database {
  const prepareBound = (
    sql: string,
    bindings: SQLInputValue[] = [],
  ): TestBoundStatement => ({
    sql,
    bindings,
    bind(...values: unknown[]) {
      return prepareBound(sql, values as SQLInputValue[]) as unknown as D1PreparedStatement;
    },
    async first<T = unknown>(columnName?: string) {
      const row = target.prepare(sql).get(...bindings) as Record<string, T> | undefined;
      if (!row) return null;
      return columnName ? row[columnName] ?? null : (row as T);
    },
    async all<T = unknown>() {
      return d1Result(target.prepare(sql).all(...bindings) as T[]);
    },
    async run<T = unknown>() {
      const result = target.prepare(sql).run(...bindings);
      return d1Result<T>([], Number(result.changes));
    },
    async raw<T = unknown>() {
      return target
        .prepare(sql)
        .all(...bindings)
        .map((row) => Object.values(row as Record<string, unknown>)) as T[];
    },
  });

  return {
    prepare(sql: string) {
      return prepareBound(sql) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      target.exec('begin immediate');
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) {
          results.push(await (statement as unknown as TestBoundStatement).run<T>());
        }
        target.exec('commit');
        return results;
      } catch (error) {
        target.exec('rollback');
        throw error;
      }
    },
    async exec(query: string) {
      target.exec(query);
      return { count: 0, duration: 0 };
    },
    withSession() {
      throw new Error('Sessions are not used in this test');
    },
    dump() {
      throw new Error('Dump is not used in this test');
    },
  } as unknown as D1Database;
}

function databaseFixture() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  return {
    database,
    repository: new D1AccessGovernanceRepository(createD1Adapter(database)),
  };
}

function insertScope(
  database: DatabaseSync,
  suffix: string,
  externalSubject: string,
  options: {
    rolesJson?: string;
    allowPermissionsJson?: string;
    denyPermissionsJson?: string;
  } = {},
): ScopeFixture {
  const organizationId = `org-${suffix}`;
  const facilityId = `fac-${suffix}`;
  const departmentId = `department-${suffix}`;
  const userId = `user-${suffix}`;
  const membershipId = `membership-${suffix}`;
  const administratorUserId = `administrator-user-${suffix}`;
  const administratorMembershipId = `administrator-membership-${suffix}`;
  const assignmentId = `assignment-${suffix}`;
  const versionId = `${assignmentId}-v1`;
  const headId = `${assignmentId}-head`;

  database
    .prepare('insert into organizations (id, name) values (?, ?)')
    .run(organizationId, `Clinic ${suffix.toUpperCase()}`);
  database
    .prepare(
      'insert into facilities (id, organization_id, name) values (?, ?, ?)',
    )
    .run(facilityId, organizationId, `Facility ${suffix.toUpperCase()}`);
  database
    .prepare(`
      insert into users (
        id, external_issuer, external_subject, display_name, status
      ) values (?, 'openai:sites', ?, ?, 'active')
    `)
    .run(userId, externalSubject, `User ${suffix.toUpperCase()}`);
  database
    .prepare(`
      insert into memberships (
        id, organization_id, facility_id, user_id, role, status
      ) values (?, ?, ?, ?, 'clinician', 'active')
    `)
    .run(membershipId, organizationId, facilityId, userId);
  database
    .prepare(`
      insert into users (
        id, external_issuer, external_subject, display_name, status
      ) values (?, 'openai:sites', ?, ?, 'active')
    `)
    .run(
      administratorUserId,
      `administrator-${suffix}`,
      `Administrator ${suffix.toUpperCase()}`,
    );
  database
    .prepare(`
      insert into memberships (
        id, organization_id, facility_id, user_id, role, status
      ) values (?, ?, ?, ?, 'administrator', 'active')
    `)
    .run(
      administratorMembershipId,
      organizationId,
      facilityId,
      administratorUserId,
    );
  database
    .prepare(`
      insert into departments (
        id, organization_id, facility_id, code, name, kind, status
      ) values (?, ?, ?, ?, ?, 'clinical', 'active')
    `)
    .run(
      departmentId,
      organizationId,
      facilityId,
      `clinic_${suffix}`,
      `Department ${suffix.toUpperCase()}`,
    );
  database
    .prepare(`
      insert into department_access_assignments (
        id, organization_id, facility_id, department_id, membership_id,
        created_by_membership_id
      ) values (?, ?, ?, ?, ?, ?)
    `)
    .run(
      assignmentId,
      organizationId,
      facilityId,
      departmentId,
      membershipId,
      administratorMembershipId,
    );
  database
    .prepare(`
      insert into department_access_assignment_versions (
        id, organization_id, facility_id, assignment_id, department_id,
        membership_id, version, supersedes_version_id, status, source_type,
        roles_json, allow_permissions_json, deny_permissions_json,
        effective_from, effective_until, change_reason,
        changed_by_membership_id, changed_at
      ) values (?, ?, ?, ?, ?, ?, 1, null, 'active', 'administrator',
        ?, ?, ?, ?, null, 'Initial test assignment', ?, ?)
    `)
    .run(
      versionId,
      organizationId,
      facilityId,
      assignmentId,
      departmentId,
      membershipId,
      options.rolesJson ?? JSON.stringify(['doctor']),
      options.allowPermissionsJson ?? JSON.stringify(['access.manage']),
      options.denyPermissionsJson ?? JSON.stringify(['encounter.manage']),
      EFFECTIVE_FROM,
      administratorMembershipId,
      EFFECTIVE_FROM,
    );
  database
    .prepare(`
      insert into department_access_assignment_heads (
        id, organization_id, facility_id, assignment_id, department_id,
        membership_id, current_version_id, lock_version
      ) values (?, ?, ?, ?, ?, ?, ?, 1)
    `)
    .run(
      headId,
      organizationId,
      facilityId,
      assignmentId,
      departmentId,
      membershipId,
      versionId,
    );

  return {
    organizationId,
    facilityId,
    departmentId,
    userId,
    membershipId,
    administratorMembershipId,
    assignmentId,
    versionId,
    headId,
    principal: {
      issuer: 'openai:sites',
      subject: externalSubject,
      email: `${externalSubject}@example.test`,
    },
  };
}

function insertSuccessor(
  database: DatabaseSync,
  scope: ScopeFixture,
  options: {
    id?: string;
    rolesJson?: string;
    allowPermissionsJson?: string;
    denyPermissionsJson?: string;
    supersedesVersionId?: string;
    version?: number;
  } = {},
) {
  const id = options.id ?? `${scope.assignmentId}-v2`;
  database
    .prepare(`
      insert into department_access_assignment_versions (
        id, organization_id, facility_id, assignment_id, department_id,
        membership_id, version, supersedes_version_id, status, source_type,
        roles_json, allow_permissions_json, deny_permissions_json,
        effective_from, effective_until, change_reason,
        changed_by_membership_id, changed_at
      ) values (?, ?, ?, ?, ?, ?, ?, ?, 'active', 'administrator',
        ?, ?, ?, ?, null, 'Updated test assignment', ?, ?)
    `)
    .run(
      id,
      scope.organizationId,
      scope.facilityId,
      scope.assignmentId,
      scope.departmentId,
      scope.membershipId,
      options.version ?? 2,
      options.supersedesVersionId ?? scope.versionId,
      options.rolesJson ?? JSON.stringify(['auditor']),
      options.allowPermissionsJson ?? JSON.stringify([]),
      options.denyPermissionsJson ?? JSON.stringify([]),
      EFFECTIVE_FROM + 1,
      scope.administratorMembershipId,
      EFFECTIVE_FROM + 1,
    );
  return id;
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('D1 access-governance repository', () => {
  it('resolves the current department assignment and derives deny-first permissions', async () => {
    const { database, repository } = databaseFixture();
    const scope = insertScope(database, 'a', 'site-user-a');

    const overview = await resolveAccessOverview(
      repository,
      scope.principal,
      scope.assignmentId,
    );

    expect(overview.selected).toMatchObject({
      assignmentId: scope.assignmentId,
      assignmentVersionId: scope.versionId,
      assignmentVersion: 1,
      status: 'active',
      source: 'administrator',
      organization: { id: scope.organizationId, status: 'active' },
      facility: { id: scope.facilityId, status: 'active' },
      department: { id: scope.departmentId, status: 'active' },
      membership: { id: scope.membershipId, status: 'active' },
      user: { id: scope.userId, status: 'active' },
      roles: ['doctor'],
      allowPermissions: ['access.manage'],
      denyPermissions: ['encounter.manage'],
    });
    expect(overview.selected.effectivePermissions).toContain('access.manage');
    expect(overview.selected.effectivePermissions).not.toContain(
      'encounter.manage',
    );
  });

  it('isolates identities and gives a neutral result for a cross-scope assignment id', async () => {
    const { database, repository } = databaseFixture();
    const scopeA = insertScope(database, 'a', 'site-user-a');
    const scopeB = insertScope(database, 'b', 'site-user-b');

    await expect(repository.listPrincipalAssignments(scopeA.principal)).resolves
      .toMatchObject([{ assignmentId: scopeA.assignmentId }]);
    await expect(repository.listPrincipalAssignments(scopeB.principal)).resolves
      .toMatchObject([{ assignmentId: scopeB.assignmentId }]);
    await expect(
      resolveAccessOverview(repository, scopeA.principal, scopeB.assignmentId),
    ).rejects.toBeInstanceOf(AccessAssignmentNotFoundError);
  });

  it('reads only the exact version selected by the guarded current head', async () => {
    const { database, repository } = databaseFixture();
    const scope = insertScope(database, 'a', 'site-user-a');
    const version2Id = insertSuccessor(database, scope);
    const headAdvanceAt = Date.now() + 1_000;

    const beforeAdvance = await repository.listPrincipalAssignments(scope.principal);
    expect(beforeAdvance[0]).toMatchObject({
      assignmentVersionId: scope.versionId,
      assignmentVersion: 1,
      roles: ['doctor'],
    });

    database
      .prepare(`
        update department_access_assignment_heads
        set current_version_id = ?, lock_version = 2, updated_at = ?
        where id = ?
      `)
      .run(version2Id, headAdvanceAt, scope.headId);

    const afterAdvance = await repository.listPrincipalAssignments(scope.principal);
    expect(afterAdvance[0]).toMatchObject({
      assignmentVersionId: version2Id,
      assignmentVersion: 2,
      roles: ['auditor'],
    });
    expect(
      database
        .prepare(`
          select count(*) as count
          from department_access_assignment_versions
          where assignment_id = ?
        `)
        .get(scope.assignmentId),
    ).toEqual({ count: 2 });
  });

  it.each([
    ['unknown role', JSON.stringify(['superuser']), '[]', '[]'],
    ['duplicate role', JSON.stringify(['doctor', 'doctor']), '[]', '[]'],
    ['unknown permission', JSON.stringify(['doctor']), JSON.stringify(['patient.delete']), '[]'],
    [
      'duplicate permission',
      JSON.stringify(['doctor']),
      JSON.stringify(['access.self.read', 'access.self.read']),
      '[]',
    ],
    [
      'allow and deny overlap',
      JSON.stringify(['doctor']),
      JSON.stringify(['access.self.read']),
      JSON.stringify(['access.self.read']),
    ],
    [
      'mixed service and interactive roles',
      JSON.stringify(['service', 'doctor']),
      '[]',
      '[]',
    ],
  ])(
    'rejects direct SQL with %s',
    (_label, rolesJson, allowPermissionsJson, denyPermissionsJson) => {
      const { database } = databaseFixture();
      const scope = insertScope(database, 'a', 'site-user-a');

      expect(() =>
        insertSuccessor(database, scope, {
          rolesJson,
          allowPermissionsJson,
          denyPermissionsJson,
        }),
      ).toThrow();
      expect(
        database
          .prepare(`
            select count(*) as count
            from department_access_assignment_versions
            where assignment_id = ?
          `)
          .get(scope.assignmentId),
      ).toEqual({ count: 1 });
    },
  );

  it('keeps assignments and versions immutable and advances heads only to a direct successor', () => {
    const { database } = databaseFixture();
    const scope = insertScope(database, 'a', 'site-user-a');
    const headAdvanceAt = Date.now() + 1_000;

    expect(() =>
      database
        .prepare(`
          update department_access_assignments
          set department_id = department_id
          where id = ?
        `)
        .run(scope.assignmentId),
    ).toThrow();
    expect(() =>
      database
        .prepare('delete from department_access_assignments where id = ?')
        .run(scope.assignmentId),
    ).toThrow();
    expect(() =>
      database
        .prepare(`
          update department_access_assignment_versions
          set change_reason = 'Mutated history'
          where id = ?
        `)
        .run(scope.versionId),
    ).toThrow();
    expect(() =>
      database
        .prepare('delete from department_access_assignment_versions where id = ?')
        .run(scope.versionId),
    ).toThrow();

    const version2Id = insertSuccessor(database, scope);
    expect(() =>
      database
        .prepare(`
          update department_access_assignment_heads
          set current_version_id = ?, updated_at = ?
          where id = ?
        `)
        .run(version2Id, headAdvanceAt, scope.headId),
    ).toThrow();

    database
      .prepare(`
        update department_access_assignment_heads
        set current_version_id = ?, lock_version = 2, updated_at = ?
        where id = ?
      `)
      .run(version2Id, headAdvanceAt, scope.headId);

    expect(() =>
      database
        .prepare(`
          update department_access_assignment_heads
          set current_version_id = ?, lock_version = 3, updated_at = ?
          where id = ?
        `)
        .run(scope.versionId, headAdvanceAt + 1, scope.headId),
    ).toThrow();
    expect(() =>
      database
        .prepare('delete from department_access_assignment_heads where id = ?')
        .run(scope.headId),
    ).toThrow();
  });
});
