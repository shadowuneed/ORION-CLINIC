import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import {
  D1SuggestionReviewRepository,
  SuggestionConflictError,
  SuggestionConsentRequiredError,
  SuggestionNotFoundError,
} from './suggestion-review';

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
      return target.prepare(sql).all(...bindings).map((row) =>
        Object.values(row as Record<string, unknown>),
      ) as T[];
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
      throw new Error('Sessions are not used by this repository test');
    },
    dump() {
      throw new Error('Dump is not used by this repository test');
    },
  } as unknown as D1Database;
}

function createFixture() {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  database.exec(readFileSync('db/seed.local.sql', 'utf8'));
  const scope: WorkspaceScope = {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    encounterId: 'encounter-a',
    reviewerMembershipId: 'membership-a',
  };
  const d1 = createD1Adapter(database);
  return {
    database,
    d1,
    scope,
    repository: new D1SuggestionReviewRepository(d1, scope),
  };
}

function editCommand(
  overrides?: Partial<Parameters<D1SuggestionReviewRepository['createDerivative']>[0]>,
) {
  return {
    recommendationId: 'rec-1',
    title: 'Уточнить текущие лекарства',
    content: 'Уточнить названия, дозы и время последнего приёма всех препаратов.',
    reason: 'Врач конкретизировал обязательные сведения для безопасного плана.',
    expectedVersion: 1,
    idempotencyKey: crypto.randomUUID(),
    actorId: 'user-a',
    requestId: crypto.randomUUID(),
    ...overrides,
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('suggestion review repository', () => {
  it('creates an immutable clinician derivative and exact replay without changing AI source', async () => {
    const { database, repository } = createFixture();
    const before = await repository.list();
    const input = editCommand();
    const created = await repository.createDerivative(input);
    const replay = await repository.createDerivative(input);

    expect(replay).toEqual(created);
    expect(created.original).toEqual(before[0].original);
    expect(created.currentDerivative).toMatchObject({
      version: 1,
      title: input.title,
      content: input.content,
      reason: input.reason,
      authoredByMembershipId: 'membership-a',
    });
    expect(created.review).toMatchObject({ state: 'pending', version: 2 });
    expect(
      database.prepare(`select count(*) as count from suggestion_derivative_versions`).get(),
    ).toMatchObject({ count: 1 });
    expect(
      database.prepare(`select original_content as content from clinical_suggestions where id = 'rec-1'`).get(),
    ).toMatchObject({ content: before[0].original.content });
    expect(
      database.prepare(`select count(*) as count from command_idempotency where operation = 'suggestion.derivative.create'`).get(),
    ).toMatchObject({ count: 1 });
  });

  it('keeps a linear v1 -> v2 chain and rejects a stale edit', async () => {
    const { database, repository } = createFixture();
    const first = await repository.createDerivative(editCommand());
    const second = await repository.createDerivative(
      editCommand({
        title: 'Проверить полный список препаратов',
        content: 'Зафиксировать названия, дозировки, кратность и последний приём.',
        reason: 'Добавлена кратность приёма.',
        expectedVersion: first.review.version,
      }),
    );

    expect(second.currentDerivative).toMatchObject({ version: 2 });
    expect(second.review.version).toBe(3);
    expect(
      database.prepare(`
        select child.version, child.supersedes_derivative_version_id as parentId
        from suggestion_derivative_versions child where child.version = 2
      `).get(),
    ).toMatchObject({ version: 2, parentId: first.currentDerivative?.id });
    await expect(
      repository.createDerivative(editCommand({ expectedVersion: 2 })),
    ).rejects.toBeInstanceOf(SuggestionConflictError);
    expect(
      database.prepare(`select count(*) as count from suggestion_derivative_versions`).get(),
    ).toMatchObject({ count: 2 });
  });

  it('accepts the exact current derivative and preserves it through reject/restore history', async () => {
    const { database, repository } = createFixture();
    const edited = await repository.createDerivative(editCommand());
    const accepted = await repository.recordDecision({
      recommendationId: edited.id,
      derivativeVersionId: edited.currentDerivative!.id,
      decision: 'accept',
      expectedVersion: edited.review.version,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    expect(accepted.review.state).toBe('edited_and_accepted');
    expect(accepted.effectiveContent).toBe(edited.currentDerivative?.content);

    const restored = await repository.recordDecision({
      recommendationId: accepted.id,
      derivativeVersionId: accepted.currentDerivative!.id,
      decision: 'restore',
      expectedVersion: accepted.review.version,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    const rejected = await repository.recordDecision({
      recommendationId: restored.id,
      derivativeVersionId: restored.currentDerivative!.id,
      decision: 'reject',
      expectedVersion: restored.review.version,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    expect(rejected.review.state).toBe('rejected');
    expect(rejected.currentDerivative).toEqual(edited.currentDerivative);
    expect(rejected.effectiveContent).toBeNull();
    expect(
      database.prepare(`select count(*) as count from review_decisions where suggestion_id = 'rec-1'`).get(),
    ).toMatchObject({ count: 3 });
  });

  it('rejects changed replay payloads and a decision against a stale derivative', async () => {
    const { repository } = createFixture();
    const key = crypto.randomUUID();
    const first = await repository.createDerivative(editCommand({ idempotencyKey: key }));
    await expect(
      repository.createDerivative(
        editCommand({
          idempotencyKey: key,
          content: 'Другой текст с тем же ключом.',
        }),
      ),
    ).rejects.toBeInstanceOf(SuggestionConflictError);

    const second = await repository.createDerivative(
      editCommand({
        expectedVersion: first.review.version,
        title: 'Новая текущая версия',
        content: 'Новая текущая версия текста врача.',
        reason: 'Повторная проверка.',
      }),
    );
    await expect(
      repository.recordDecision({
        recommendationId: second.id,
        derivativeVersionId: first.currentDerivative!.id,
        decision: 'accept',
        expectedVersion: second.review.version,
        idempotencyKey: crypto.randomUUID(),
        actorId: 'user-a',
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SuggestionConflictError);
  });

  it('fails closed for denied care consent and another tenant scope', async () => {
    const { database, d1, repository } = createFixture();
    const now = Date.now();
    database.prepare(`
      insert into consent_events (
        id, organization_id, facility_id, patient_id, encounter_id, version,
        consent_type, decision, captured_by_membership_id, policy_version,
        policy_hash, notice_language, source, occurred_at, effective_at,
        supersedes_consent_event_id, created_at
      ) values (
        'consent-a-care-v2-denied', 'org-a', 'fac-a', 'patient-a', 'encounter-a', 2,
        'care', 'denied', 'membership-a', 'synthetic-local-v1', ?1,
        'ru', 'verbal', ?2, ?2, 'consent-a-care-v1', ?2
      )
    `).run('c'.repeat(64), now);
    database.prepare(`
      update consent_heads set current_consent_event_id = 'consent-a-care-v2-denied',
        lock_version = 2, updated_at = ?1
      where id = 'consent-head-a-care'
    `).run(now);

    await expect(repository.createDerivative(editCommand())).rejects.toBeInstanceOf(
      SuggestionConsentRequiredError,
    );

    const foreignScope: WorkspaceScope = {
      organizationId: 'org-b',
      facilityId: 'fac-b',
      encounterId: 'encounter-b',
      reviewerMembershipId: 'membership-b',
    };
    await expect(
      new D1SuggestionReviewRepository(d1, foreignScope).createDerivative(
        editCommand(),
      ),
    ).rejects.toBeInstanceOf(SuggestionNotFoundError);
  });

  it('writes a PHI-minimal chained audit for edit and decision', async () => {
    const { database, repository } = createFixture();
    const edited = await repository.createDerivative(editCommand());
    await repository.recordDecision({
      recommendationId: edited.id,
      derivativeVersionId: edited.currentDerivative!.id,
      decision: 'accept',
      expectedVersion: edited.review.version,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    const rows = database.prepare(`
      select action, metadata_json as metadataJson,
        previous_hash as previousHash, event_hash as eventHash
      from audit_events order by sequence
    `).all() as Array<Record<string, string | null>>;
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      action: 'suggestion.derivative.create',
      previousHash: null,
    });
    expect(rows[1].previousHash).toBe(rows[0].eventHash);
    expect(rows[0].metadataJson).not.toContain(
      'Уточнить названия, дозы и время последнего приёма всех препаратов.',
    );
    expect(rows[0].metadataJson).toContain('contentHash');
  });
});
