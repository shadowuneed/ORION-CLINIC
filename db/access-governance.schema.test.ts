import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

let database: DatabaseSync;

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

function seedAccessScope(target: DatabaseSync) {
  target.exec(`
    insert into organizations (id, name) values ('org-a', 'Clinic A');
    insert into organizations (id, name) values ('org-b', 'Clinic B');
    insert into facilities (id, organization_id, name)
      values ('fac-a', 'org-a', 'Facility A');
    insert into facilities (id, organization_id, name)
      values ('fac-b', 'org-b', 'Facility B');
    insert into users (
      id, external_issuer, external_subject, display_name, status
    ) values
      ('user-a', 'https://idp.test', 'doctor-a', 'Doctor A', 'active'),
      ('user-admin', 'https://idp.test', 'admin-a', 'Admin A', 'active'),
      ('user-b', 'https://idp.test', 'doctor-b', 'Doctor B', 'active');
    insert into memberships (
      id, organization_id, facility_id, user_id, role, status
    ) values
      ('membership-a', 'org-a', 'fac-a', 'user-a', 'clinician', 'active'),
      ('membership-admin', 'org-a', 'fac-a', 'user-admin', 'administrator', 'active'),
      ('membership-b', 'org-b', 'fac-b', 'user-b', 'clinician', 'active');
    insert into departments (
      id, organization_id, facility_id, code, name, kind, status
    ) values
      ('department-a', 'org-a', 'fac-a', 'general', 'General', 'clinical', 'active'),
      ('department-b', 'org-b', 'fac-b', 'general', 'General', 'clinical', 'active');
  `);
}

function insertAssignmentRoot(target: DatabaseSync) {
  target.exec(`
    insert into department_access_assignments (
      id, organization_id, facility_id, department_id, membership_id,
      created_by_membership_id, created_at
    ) values (
      'assignment-a', 'org-a', 'fac-a', 'department-a', 'membership-a',
      'membership-admin', 1000
    );
  `);
}

function insertVersionOne(target: DatabaseSync) {
  target.exec(`
    insert into department_access_assignment_versions (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, version, supersedes_version_id, status, source_type,
      roles_json, allow_permissions_json, deny_permissions_json,
      effective_from, effective_until, change_reason,
      changed_by_membership_id, changed_at, created_at
    ) values (
      'assignment-a-v1', 'org-a', 'fac-a', 'assignment-a', 'department-a',
      'membership-a', 1, null, 'active', 'bootstrap',
      '["doctor"]', '["access.self.read"]', '["audit.read"]',
      1000, null, 'synthetic initial assignment',
      'membership-admin', 1000, 1000
    );
    insert into department_access_assignment_heads (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, current_version_id, lock_version, created_at, updated_at
    ) values (
      'assignment-a-head', 'org-a', 'fac-a', 'assignment-a', 'department-a',
      'membership-a', 'assignment-a-v1', 1, 1000, 1000
    );
  `);
}

function versionSql(input: {
  id: string;
  version: number;
  supersedesVersionId: string;
  rolesJson?: string;
  allowPermissionsJson?: string;
  denyPermissionsJson?: string;
  status?: 'active' | 'revoked';
}) {
  return `
    insert into department_access_assignment_versions (
      id, organization_id, facility_id, assignment_id, department_id,
      membership_id, version, supersedes_version_id, status, source_type,
      roles_json, allow_permissions_json, deny_permissions_json,
      effective_from, effective_until, change_reason,
      changed_by_membership_id, changed_at, created_at
    ) values (
      '${input.id}', 'org-a', 'fac-a', 'assignment-a', 'department-a',
      'membership-a', ${input.version}, '${input.supersedesVersionId}',
      '${input.status ?? 'active'}', 'bootstrap',
      '${input.rolesJson ?? '["doctor"]'}',
      '${input.allowPermissionsJson ?? '[]'}',
      '${input.denyPermissionsJson ?? '[]'}',
      1000, null, 'synthetic assignment change',
      'membership-admin', ${1000 + input.version}, ${1000 + input.version}
    );
  `;
}

describe('department access assignment SQLite invariants', () => {
  beforeEach(() => {
    database = new DatabaseSync(':memory:');
    applyMigrations(database);
    seedAccessScope(database);
    insertAssignmentRoot(database);
  });

  afterEach(() => database.close());

  it('keeps the legacy membership role while adding a scoped department role', () => {
    insertVersionOne(database);

    const current = database
      .prepare(`
        select membership.role as legacy_role, version.roles_json
        from department_access_assignment_heads head
        join department_access_assignment_versions version
          on version.id = head.current_version_id
        join memberships membership on membership.id = head.membership_id
        where head.id = 'assignment-a-head'
      `)
      .get() as { legacy_role: string; roles_json: string };

    expect(current).toEqual({
      legacy_role: 'clinician',
      roles_json: '["doctor"]',
    });
  });

  it('advances only through an immutable direct successor', () => {
    insertVersionOne(database);
    database.exec(
      versionSql({
        id: 'assignment-a-v2',
        version: 2,
        supersedesVersionId: 'assignment-a-v1',
        status: 'revoked',
      }),
    );

    expect(() =>
      database.exec(
        versionSql({
          id: 'assignment-a-v3',
          version: 3,
          supersedesVersionId: 'assignment-a-v2',
        }),
      ),
    ).toThrow(/extend the current head/i);
    expect(() =>
      database.exec(`
        update department_access_assignment_heads
        set current_version_id = 'assignment-a-v2', lock_version = 3,
            updated_at = 1002
        where id = 'assignment-a-head';
      `),
    ).toThrow(/identity or lock is invalid/i);

    database.exec(`
      update department_access_assignment_heads
      set current_version_id = 'assignment-a-v2', lock_version = 2,
          updated_at = 1002
      where id = 'assignment-a-head';
    `);

    expect(
      database
        .prepare(`
          select version.version, version.status, head.lock_version
          from department_access_assignment_heads head
          join department_access_assignment_versions version
            on version.id = head.current_version_id
          where head.id = 'assignment-a-head'
        `)
        .get(),
    ).toMatchObject({ version: 2, status: 'revoked', lock_version: 2 });
    expect(() =>
      database.exec(`
        update department_access_assignment_versions
        set status = 'active' where id = 'assignment-a-v2';
      `),
    ).toThrow(/immutable/i);
    expect(() =>
      database.exec(`
        delete from department_access_assignment_heads
        where id = 'assignment-a-head';
      `),
    ).toThrow(/cannot be deleted/i);
    expect(() =>
      database.exec(`
        delete from department_access_assignments where id = 'assignment-a';
      `),
    ).toThrow(/append-only/i);
  });

  it.each([
    ['unknown role', '["owner"]', '[]', '[]', /unknown role/i],
    ['duplicate role', '["doctor","doctor"]', '[]', '[]', /duplicate roles/i],
    [
      'mixed service role',
      '["service","doctor"]',
      '[]',
      '[]',
      /service role cannot be combined/i,
    ],
    [
      'unknown permission',
      '["doctor"]',
      '["patient.delete"]',
      '[]',
      /unknown allow permission/i,
    ],
    [
      'duplicate permission',
      '["doctor"]',
      '["access.self.read","access.self.read"]',
      '[]',
      /duplicate allow permissions/i,
    ],
    [
      'allow and deny overlap',
      '["doctor"]',
      '["access.self.read"]',
      '["access.self.read"]',
      /allow and deny permissions overlap/i,
    ],
  ])(
    'rejects %s at the database boundary',
    (_label, rolesJson, allowPermissionsJson, denyPermissionsJson, message) => {
      expect(() =>
        database.exec(
          versionSql({
            id: 'assignment-a-v1',
            version: 1,
            supersedesVersionId: '',
            rolesJson,
            allowPermissionsJson,
            denyPermissionsJson,
          }).replace("1, '',", '1, null,'),
        ),
      ).toThrow(message);
    },
  );

  it('rejects cross-tenant department and membership scope', () => {
    expect(() =>
      database.exec(`
        insert into department_access_assignments (
          id, organization_id, facility_id, department_id, membership_id,
          created_by_membership_id
        ) values (
          'cross-scope', 'org-a', 'fac-a', 'department-b', 'membership-a',
          'membership-admin'
        );
      `),
    ).toThrow(/department must be active in scope|foreign key constraint failed/i);
  });
});
