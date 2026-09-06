import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { AccessAdministrationScope } from '@/lib/auth/access-administration';
import {
  AccessAdministrationConflictError,
  D1AccessAdministrationRepository,
} from './access-administration';

type TestBoundStatement = {
  sql: string;
  bindings: SQLInputValue[];
  bind(...values: unknown[]): D1PreparedStatement;
  first<T = unknown>(columnName?: string): Promise<T | null>;
  all<T = unknown>(): Promise<D1Result<T>>;
  run<T = unknown>(): Promise<D1Result<T>>;
  raw<T = unknown>(): Promise<T[]>;
};

const databases: DatabaseSync[] = [];

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

function fixture() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  database.exec(readFileSync('db/seed.local.sql', 'utf8'));
  const scope: AccessAdministrationScope = {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    actorUserId: 'user-a',
    actorMembershipId: 'membership-a',
    actorAssignmentId: 'access-assignment-a-general-medicine',
    actorAssignmentVersionId:
      'access-assignment-a-general-medicine-local-admin',
  };
  return {
    database,
    repository: new D1AccessAdministrationRepository(
      createD1Adapter(database),
      scope,
    ),
  };
}

afterEach(() => {
  for (const database of databases.splice(0)) database.close();
});

describe('D1 access administration repository', () => {
  it('creates and versions a department with idempotent replay and audit', async () => {
    const { database, repository } = fixture();
    const command = {
      facilityId: 'fac-a',
      actorAssignmentId: 'access-assignment-a-general-medicine',
      idempotencyKey: '4e83348b-0830-43b0-89c8-a92a1ad5d45b',
      code: 'endocrinology',
      name: 'Эндокринология',
      kind: 'clinical' as const,
      changeReason: 'Открыт новый кабинет',
      actorId: 'user-a',
      requestId: 'request-department-create',
    };

    const created = await repository.createDepartment(command);
    await expect(repository.createDepartment(command)).resolves.toEqual(created);
    expect(created).toMatchObject({ version: 1 });

    const workspace = await repository.getWorkspace();
    const department = workspace.departments.find(
      (candidate) => candidate.id === created.departmentId,
    );
    expect(department).toMatchObject({
      code: 'endocrinology',
      name: 'Эндокринология',
      status: 'active',
      version: 1,
    });

    const updated = await repository.updateDepartment({
      facilityId: 'fac-a',
      actorAssignmentId: 'access-assignment-a-general-medicine',
      idempotencyKey: '734918ae-e106-45a0-9149-81c370ae5fc8',
      departmentId: created.departmentId,
      expectedVersion: 1,
      name: 'Эндокринология и диабетология',
      kind: 'clinical',
      status: 'active',
      changeReason: 'Уточнена зона ответственности',
      actorId: 'user-a',
      requestId: 'request-department-update',
    });
    expect(updated).toEqual({ departmentId: created.departmentId, version: 2 });
    expect(
      database
        .prepare(
          'select count(*) as count from department_versions where department_id = ?',
        )
        .get(created.departmentId),
    ).toEqual({ count: 2 });
    expect(
      database
        .prepare(
          "select count(*) as count from audit_events where action like 'access.department.%' and entity_id = ?",
        )
        .get(created.departmentId),
    ).toEqual({ count: 2 });
  });

  it('grants, revokes and retains immutable assignment history', async () => {
    const { database, repository } = fixture();
    const granted = await repository.grantAssignment({
      facilityId: 'fac-a',
      actorAssignmentId: 'access-assignment-a-general-medicine',
      idempotencyKey: '10add663-24b1-4f0a-a7f8-64ea1e124bb0',
      departmentId: 'department-a-general-medicine',
      membershipId: 'access-membership-nurse-b',
      roles: ['nurse'],
      allowPermissions: [],
      denyPermissions: ['communications.manage'],
      effectiveFrom: 1_704_067_200_000,
      effectiveUntil: null,
      changeReason: 'Назначение в кабинет',
      actorId: 'user-a',
      requestId: 'request-assignment-grant',
    });
    const revoked = await repository.updateAssignment({
      facilityId: 'fac-a',
      actorAssignmentId: 'access-assignment-a-general-medicine',
      idempotencyKey: 'be199e9b-d1e0-476d-930c-57220e1a1bbd',
      assignmentId: granted.assignmentId,
      expectedVersion: 1,
      status: 'revoked',
      roles: ['nurse'],
      allowPermissions: [],
      denyPermissions: ['communications.manage'],
      effectiveFrom: 1_704_067_200_000,
      effectiveUntil: null,
      changeReason: 'Смена подразделения',
      actorId: 'user-a',
      requestId: 'request-assignment-revoke',
    });
    expect(revoked).toEqual({ assignmentId: granted.assignmentId, version: 2 });
    expect(
      database
        .prepare(
          'select count(*) as count from department_access_assignment_versions where assignment_id = ?',
        )
        .get(granted.assignmentId),
    ).toEqual({ count: 2 });
    expect(
      (await repository.getWorkspace()).assignments.find(
        (candidate) => candidate.id === granted.assignmentId,
      ),
    ).toMatchObject({ status: 'revoked', version: 2 });
  });

  it('rejects self-mutation, self-disable and stale department versions', async () => {
    const { repository } = fixture();
    await expect(
      repository.updateAssignment({
        facilityId: 'fac-a',
        actorAssignmentId: 'access-assignment-a-general-medicine',
        idempotencyKey: '44393848-22d6-4af5-8504-0af154ef96f4',
        assignmentId: 'access-assignment-a-general-medicine',
        expectedVersion: 2,
        status: 'revoked',
        roles: ['doctor', 'administrator'],
        allowPermissions: [],
        denyPermissions: [],
        effectiveFrom: 1_704_067_200_000,
        effectiveUntil: null,
        changeReason: 'Попытка отозвать себя',
        actorId: 'user-a',
        requestId: 'request-self-revoke',
      }),
    ).rejects.toBeInstanceOf(AccessAdministrationConflictError);

    await expect(
      repository.updateDepartment({
        facilityId: 'fac-a',
        actorAssignmentId: 'access-assignment-a-general-medicine',
        idempotencyKey: '07ff93dd-7ba9-4602-b30d-b23af8997365',
        departmentId: 'department-a-general-medicine',
        expectedVersion: 1,
        name: 'Общая медицина',
        kind: 'clinical',
        status: 'disabled',
        changeReason: 'Попытка отключить свой контур',
        actorId: 'user-a',
        requestId: 'request-self-disable',
      }),
    ).rejects.toBeInstanceOf(AccessAdministrationConflictError);

    await expect(
      repository.updateDepartment({
        facilityId: 'fac-a',
        actorAssignmentId: 'access-assignment-a-general-medicine',
        idempotencyKey: '1d7aab78-49df-4d14-ae3e-f70f3d173917',
        departmentId: 'department-a-general-medicine',
        expectedVersion: 99,
        name: 'Общая медицина',
        kind: 'clinical',
        status: 'active',
        changeReason: 'Устаревшая команда',
        actorId: 'user-a',
        requestId: 'request-stale-department',
      }),
    ).rejects.toBeInstanceOf(AccessAdministrationConflictError);
  });

  it('keeps department roots, versions and heads append-only in SQLite', () => {
    const { database } = fixture();

    expect(() =>
      database
        .prepare("update departments set name = 'Подмена' where id = ?")
        .run('department-a-general-medicine'),
    ).toThrow();
    expect(() =>
      database
        .prepare('delete from department_versions where id = ?')
        .run('department-a-general-medicine-v1'),
    ).toThrow();
    expect(() =>
      database
        .prepare('delete from department_heads where department_id = ?')
        .run('department-a-general-medicine'),
    ).toThrow();
  });
});
