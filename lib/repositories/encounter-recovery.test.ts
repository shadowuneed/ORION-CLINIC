import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { D1ClinicalSectionRepository } from './clinical-sections';
import { D1EncounterRecoveryRepository } from './encounter-recovery';

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

function createD1Adapter(target: DatabaseSync, afterBatch?: () => void): D1Database {
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
      const row = target.prepare(sql).get(...bindings) as
        | Record<string, T>
        | undefined;
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
          const bound = statement as unknown as TestBoundStatement;
          results.push(
            /^\s*(select|pragma|with)\b/i.test(bound.sql)
              ? await bound.all<T>()
              : await bound.run<T>(),
          );
        }
        target.exec('commit');
        afterBatch?.();
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
      throw new Error('Sessions are not used by this repository test');
    },
    dump() {
      throw new Error('Dump is not used by this repository test');
    },
  } as unknown as D1Database;
}

function scopeFor(encounterId = 'encounter-a'): WorkspaceScope {
  return {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    encounterId,
    reviewerMembershipId: 'membership-a',
    accessAssignmentId: 'access-assignment-a-general-medicine',
    accessPermission: 'encounter.manage',
  };
}

function createFixture(encounterId = 'encounter-a') {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  database.exec(readFileSync('db/seed.local.sql', 'utf8'));
  database.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const d1 = createD1Adapter(database);
  const scope = scopeFor(encounterId);
  return {
    database,
    d1,
    scope,
    repository: new D1EncounterRecoveryRepository(d1, scope),
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('encounter recovery repository', () => {
  it('returns only the exact assigned server state and current heads', async () => {
    const { repository } = createFixture();

    const snapshot = await repository.getServerSnapshot();

    expect(snapshot).toMatchObject({
      encounterId: 'encounter-a',
      status: 'in_progress',
      encounterVersion: 1,
      resumable: true,
      saved: {
        transcriptSegmentCount: 4,
        clinicalSectionCount: 8,
        reviewedClinicalSectionCount: 2,
        acceptedRecommendationCount: 0,
        protocolVersion: null,
        protocolStatus: null,
        amendmentCount: 0,
        exportArtifactCount: 0,
      },
    });
    expect(snapshot?.revision).toMatch(/^[a-f0-9]{64}$/);
  });

  it('reconstructs the same snapshot after a new repository instance starts', async () => {
    const { d1, scope, repository } = createFixture();
    const beforeRestart = await repository.getServerSnapshot();

    const afterRestart = await new D1EncounterRecoveryRepository(
      d1,
      scope,
    ).getServerSnapshot();

    expect(afterRestart).toEqual(beforeRestart);
  });

  it('changes the recovery revision when a current clinical head advances', async () => {
    const { d1, scope, repository } = createFixture();
    const before = await repository.getServerSnapshot();
    const sectionRepository = new D1ClinicalSectionRepository(d1, scope);

    await sectionRepository.recordCommand({
      sectionCode: 'history_of_present_illness',
      action: 'mark_reviewed',
      content:
        'Синтетический врач проверил начало симптомов и динамику состояния.',
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    const after = await repository.getServerSnapshot();

    expect(after?.revision).not.toBe(before?.revision);
    expect(after?.saved.reviewedClinicalSectionCount).toBe(3);
  });

  it('does not label a draft encounter as resumable', async () => {
    const { repository } = createFixture('encounter-a-lifecycle');

    const snapshot = await repository.getServerSnapshot();

    expect(snapshot).toMatchObject({
      encounterId: 'encounter-a-lifecycle',
      status: 'draft',
      resumable: false,
    });
  });

  it('returns no snapshot after the assigned clinician membership is disabled', async () => {
    const { database, repository } = createFixture();
    database
      .prepare(`update memberships set status = 'disabled' where id = ?`)
      .run('membership-a');

    await expect(repository.getServerSnapshot()).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('uses the current doctor assignment rather than the legacy membership role', async () => {
    const { database, repository } = createFixture();
    database.exec("update memberships set role='registrar' where id='membership-a'");
    await expect(repository.getServerSnapshot()).resolves.toMatchObject({ encounterId: 'encounter-a' });
  });

  it.each([undefined, 'wrong-assignment'])('rejects an unselected or incorrect assignment: %s', async (accessAssignmentId) => {
    const { d1, scope } = createFixture();
    await expect(new D1EncounterRecoveryRepository(d1, { ...scope, accessAssignmentId }).getServerSnapshot())
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('withholds a snapshot when access disappears during the batch', async () => {
    const { database, scope } = createFixture();
    const d1 = createD1Adapter(database, () => {
      database.exec("update memberships set status='disabled' where id='membership-a'");
    });
    await expect(new D1EncounterRecoveryRepository(d1, scope).getServerSnapshot())
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });
});
