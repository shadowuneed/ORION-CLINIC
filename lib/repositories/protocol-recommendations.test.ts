import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { D1ClinicalSectionRepository } from './clinical-sections';
import { D1ProtocolReviewRepository } from './protocol-review';
import { D1ProtocolSigningRepository } from './protocol-signing';
import {
  D1SuggestionReviewRepository,
  SuggestionLifecycleError,
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

type StoredProtocolContent = {
  schemaVersion: number;
  dataMode: string;
  recommendations: Array<{
    sourceSuggestionId: string;
    sourceAnalysisRunId: string;
    sourceDecisionId: string;
    sourceDerivativeVersionId: string | null;
    state: string;
    original: {
      title: string;
      content: string;
      evidence: Array<{ sourceId: string; quote?: string }>;
    };
    effective: {
      title: string;
      content: string;
      evidence: Array<{ sourceId: string; quote?: string }>;
    };
    provenance: {
      provider: string;
      model: string;
      modelVersion: string;
      policyVersion: string;
      inputHash: string;
      sourceRecordIds: string[];
    };
    reviewedByMembershipId: string;
    reviewedByDisplayName: string;
    reviewedAt: number;
  }>;
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
  return {
    success: true,
    results,
    meta: { changes },
  } as unknown as D1Result<T>;
}

type WriteHooks = { beforeBatch?: () => void; beforeStatement?: (statement: TestBoundStatement) => void };

function createD1Adapter(target: DatabaseSync, afterRead?: (sql: string, database: DatabaseSync) => void, hooks?: WriteHooks): D1Database {
  const prepareBound = (
    sql: string,
    bindings: SQLInputValue[] = [],
  ): TestBoundStatement => ({
    sql,
    bindings,
    bind(...values: unknown[]) {
      return prepareBound(
        sql,
        values as SQLInputValue[],
      ) as unknown as D1PreparedStatement;
    },
    async first<T = unknown>(columnName?: string) {
      const row = target.prepare(sql).get(...bindings) as
        | Record<string, T>
        | undefined;
      afterRead?.(sql, target);
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
        .map((row) =>
          Object.values(row as Record<string, unknown>),
        ) as T[];
    },
  });

  return {
    prepare(sql: string) {
      return prepareBound(sql) as unknown as D1PreparedStatement;
    },
    async batch<T = unknown>(statements: D1PreparedStatement[]) {
      hooks?.beforeBatch?.();
      target.exec('begin immediate');
      try {
        const results: D1Result<T>[] = [];
        for (const statement of statements) {
          hooks?.beforeStatement?.(statement as unknown as TestBoundStatement);
          results.push(
            await (statement as unknown as TestBoundStatement).run<T>(),
          );
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

function createFixture(afterRead?: (sql: string, database: DatabaseSync) => void, hooks?: WriteHooks) {
  const database = new DatabaseSync(':memory:');
  databases.push(database);
  applyMigrations(database);
  database.exec(readFileSync('db/seed.local.sql', 'utf8'));
  database.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const scope: WorkspaceScope = {
    organizationId: 'org-a',
    facilityId: 'fac-a',
    encounterId: 'encounter-a',
    reviewerMembershipId: 'membership-a',
    accessAssignmentId: 'access-assignment-a-general-medicine',
    accessPermission: 'encounter.manage',
  };
  const d1 = createD1Adapter(database, afterRead, hooks);
  return {
    database,
    d1,
    scope,
    sections: new D1ClinicalSectionRepository(d1, scope),
    suggestions: new D1SuggestionReviewRepository(d1, scope),
    review: new D1ProtocolReviewRepository(d1, scope),
    signing: new D1ProtocolSigningRepository(d1, scope),
  };
}

async function resolveMandatorySections(
  repository: D1ClinicalSectionRepository,
) {
  const sections = await repository.list();
  for (const section of sections) {
    if (
      section.reviewState === 'reviewed' ||
      section.reviewState === 'explicitly_absent'
    ) {
      continue;
    }
    const hasContent = section.content.trim().length > 0;
    await repository.recordCommand({
      sectionCode: section.code,
      action: hasContent ? 'mark_reviewed' : 'mark_absent',
      content: hasContent ? section.content : undefined,
      expectedVersion: section.version,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
  }
}

function readProtocolContent(database: DatabaseSync, protocolId: string) {
  const row = database
    .prepare(`select content_json as contentJson from protocol_versions where id = ?1`)
    .get(protocolId) as { contentJson: string } | undefined;
  if (!row) throw new Error('Protocol fixture was not persisted');
  return {
    raw: row.contentJson,
    parsed: JSON.parse(row.contentJson) as StoredProtocolContent,
  };
}

afterEach(() => {
  while (databases.length > 0) databases.pop()?.close();
});

describe('recommendations in the immutable protocol source', () => {
  it.each(['draft', 'sign'] as const)('rolls back %s when access is revoked after final preflight', async (operation) => {
    let armed = false;
    const { database, sections, review, signing } = createFixture(undefined, { beforeBatch: () => {
      if (armed) {
        armed = false;
        database.exec(`insert into department_access_assignment_versions
          (id,organization_id,facility_id,assignment_id,department_id,membership_id,version,supersedes_version_id,
           status,source_type,roles_json,allow_permissions_json,deny_permissions_json,effective_from,effective_until,
           change_reason,changed_by_membership_id,changed_at,created_at)
          select 'revoked-protocol-test',v.organization_id,v.facility_id,v.assignment_id,v.department_id,v.membership_id,
            v.version+1,v.id,'revoked','bootstrap',v.roles_json,v.allow_permissions_json,v.deny_permissions_json,
            v.effective_from,v.effective_until,'synthetic revocation test',v.changed_by_membership_id,v.changed_at+1,v.created_at+1
          from department_access_assignment_versions v join department_access_assignment_heads h on h.current_version_id=v.id
          where h.assignment_id='access-assignment-a-general-medicine';
          update department_access_assignment_heads set current_version_id='revoked-protocol-test',
            lock_version=lock_version+1,updated_at=updated_at+1 where assignment_id='access-assignment-a-general-medicine';`);
      }
    } });
    database.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    await resolveMandatorySections(sections);
    const input = { expectedEncounterVersion: 1, idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() };
    const draft = operation === 'sign' ? await review.beginReview(input) : null;
    const snapshot = () => ['protocol_versions', 'protocol_heads', 'audit_events', 'audit_stream_heads', 'command_idempotency', 'encounters']
      .map((table) => database.prepare(`select * from ${table} order by id`).all());
    const before = snapshot();
    armed = true;
    await expect(operation === 'draft' ? review.beginReview(input) : signing.sign({
      protocolId: draft!.protocol.id, expectedProtocolVersion: draft!.protocol.version,
      expectedProtocolHeadVersion: draft!.protocol.headVersion, expectedEncounterVersion: draft!.transition.version,
      idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID(),
    })).rejects.toThrow();
    expect(armed).toBe(false);
    expect(snapshot()).toEqual(before);
    expect(database.prepare("select assignment_id from encounter_access_assignment_permissions where assignment_id='access-assignment-a-secondary'").get()).toBeTruthy();
    expect(database.prepare("select assignment_id from encounter_access_assignment_permissions where assignment_id='access-assignment-a-general-medicine'").get()).toBeUndefined();
  });

  it.each(['audit', 'result', 'encounter', 'hash'] as const)('rejects mismatched draft %s and rolls back every clinical write', async (target) => {
    let armed = false;
    let intercepted = 0;
    const { database, sections, review } = createFixture(undefined, { beforeStatement: (statement) => {
      if (!armed) return;
      if (target === 'audit' && statement.sql.includes('insert into audit_events')) {
        intercepted++;
        const changed = statement.bindings.map((value) => {
          if (typeof value !== 'string' || !value.startsWith('{') || !value.includes('accessAssignmentId')) return value;
          return JSON.stringify({ ...JSON.parse(value), accessAssignmentId: 'wrong-assignment' });
        });
        statement.bindings.splice(0, statement.bindings.length, ...changed);
      }
      if (target === 'result' && statement.sql.includes('update command_idempotency')) {
        intercepted++;
        statement.bindings[0] = 'wrong-protocol';
      }
      if ((target === 'encounter' || target === 'hash') && statement.sql.includes('update command_idempotency')) {
        intercepted++;
        const response = JSON.parse(String(statement.bindings[1]));
        if (target === 'encounter') response.transition.encounterId = 'another-encounter';
        else response.protocol.sourceHash = 'wrong-source';
        statement.bindings[1] = JSON.stringify(response);
      }
    } });
    await resolveMandatorySections(sections);
    const before = database.prepare('select * from audit_events order by id').all();
    armed = true;
    await expect(review.beginReview({ expectedEncounterVersion: 1, idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() }))
      .rejects.toThrow();
    expect(intercepted).toBeGreaterThan(0);
    expect(database.prepare('select count(*) as count from protocol_versions').get()?.count).toBe(0);
    expect(database.prepare('select * from audit_events order by id').all()).toEqual(before);
    expect(database.prepare("select status from encounters where id='encounter-a'").get()?.status).toBe('in_progress');
  }, 20000); // Full migration fixture plus repeated rollback attempts exceed the unit-test default.
  it.each(['draft', 'sign'] as const)('rechecks access after reading the %s snapshot and before saving', async (operation) => {
    let armed = false;
    const { database, sections, review, signing } = createFixture((sql, db) => {
      if (armed && sql.includes('from audit_stream_heads')) {
        armed = false;
        db.exec("update memberships set status='disabled' where id='membership-a'");
      }
    });
    await resolveMandatorySections(sections);
    const draftInput = { expectedEncounterVersion: Number(database.prepare("select version from encounters where id='encounter-a'").get()?.version),
      idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() };
    const draft = operation === 'sign' ? await review.beginReview(draftInput) : null;
    const before = database.prepare('select count(*) as count from protocol_versions').get();
    armed = true;
    const result = operation === 'draft' ? review.beginReview(draftInput) : signing.sign({
      protocolId: draft!.protocol.id, expectedProtocolVersion: draft!.protocol.version,
      expectedProtocolHeadVersion: draft!.protocol.headVersion, expectedEncounterVersion: draft!.transition.version,
      idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID(),
    });
    await expect(result).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(database.prepare('select count(*) as count from protocol_versions').get()).toEqual(before);
  });
  it.each(['draft', 'sign'] as const)('requires current assignment for %s commands and replay', async (operation) => {
    const { database, d1, scope, sections, review, signing } = createFixture();
    await resolveMandatorySections(sections);
    const draftInput = { expectedEncounterVersion: Number(database.prepare("select version from encounters where id='encounter-a'").get()?.version),
      idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() };
    const draft = operation === 'sign' ? await review.beginReview(draftInput) : null;
    const signInput = { protocolId: draft?.protocol.id ?? '', expectedProtocolVersion: draft?.protocol.version ?? 0,
      expectedProtocolHeadVersion: draft?.protocol.headVersion ?? 0, expectedEncounterVersion: draft?.transition.version ?? 0,
      idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() };
    const invoke = (selected = scope, actorId = 'user-a') => operation === 'draft'
      ? new D1ProtocolReviewRepository(d1, selected).beginReview({ ...draftInput, actorId })
      : new D1ProtocolSigningRepository(d1, selected).sign({ ...signInput, actorId });
    for (const patch of [{ accessAssignmentId: undefined }, { accessPermission: 'encounter.read' as const }]) {
      await expect(invoke({ ...scope, ...patch })).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    }
    await expect(invoke(scope, 'user-b')).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    const result = operation === 'draft' ? await review.beginReview(draftInput) : await signing.sign(signInput);
    expect(await invoke()).toEqual(result);
    const op = operation === 'draft' ? 'protocol.begin_review' : 'protocol.sign';
    expect(database.prepare('select access_assignment_id from command_idempotency where operation=?').get(op)?.access_assignment_id).toBe(scope.accessAssignmentId);
    expect(database.prepare('select access_assignment_id from protocol_versions where id=?').get(result.protocol.id)?.access_assignment_id).toBe(scope.accessAssignmentId);
    expect(() => database.prepare(`insert into command_idempotency
      (id,organization_id,facility_id,actor_membership_id,operation,idempotency_key,request_hash,status,
       access_assignment_id,result_resource_type,result_resource_id,response_json,created_at)
      select 'bad-command',organization_id,facility_id,actor_membership_id,operation,'bad-key',request_hash,'succeeded',
        access_assignment_id,result_resource_type,'wrong-result',response_json,created_at
      from command_idempotency where operation=?`).run(op)).toThrow('protocol command requires current assignment');
    database.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    await expect(invoke({ ...scope, accessAssignmentId: 'access-assignment-a-secondary' })).rejects.toThrow('Idempotency key');
    database.exec("update memberships set status='disabled' where id='membership-a'");
    await expect(invoke()).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(readProtocolContent(database, result.protocol.id).raw).toBeTruthy();
  }, 20000); // Full migration fixture, section review and protocol/replay checks are integration work.
  it('snapshots only the exact clinician-accepted derivative and signs that same source', async () => {
    const { database, sections, suggestions, review, signing } = createFixture();
    await resolveMandatorySections(sections);

    const clinicianTitle = 'Уточнить полный список препаратов';
    const clinicianContent =
      'Зафиксировать названия, дозировки, кратность и время последнего приёма.';
    const derivative = await suggestions.createDerivative({
      recommendationId: 'rec-1',
      title: clinicianTitle,
      content: clinicianContent,
      reason: 'Врач добавил обязательные детали для безопасного плана.',
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    const accepted = await suggestions.recordDecision({
      recommendationId: derivative.id,
      derivativeVersionId: derivative.currentDerivative!.id,
      decision: 'accept',
      expectedVersion: derivative.review.version,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    const rejected = await suggestions.recordDecision({
      recommendationId: 'rec-2',
      derivativeVersionId: null,
      decision: 'reject',
      expectedVersion: 1,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    expect(rejected.review.state).toBe('rejected');

    const encounterBeforeReview = database
      .prepare(`select version from encounters where id = 'encounter-a'`)
      .get() as { version: number };
    const draft = await review.beginReview({
      expectedEncounterVersion: encounterBeforeReview.version,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    const draftContent = readProtocolContent(database, draft.protocol.id);

    expect(draftContent.parsed).toMatchObject({
      schemaVersion: 1,
      dataMode: 'synthetic-only',
    });
    expect(draftContent.parsed.recommendations).toHaveLength(1);
    expect(draftContent.parsed.recommendations[0]).toEqual({
      sourceSuggestionId: 'rec-1',
      sourceAnalysisRunId: 'analysis-workspace',
      sourceDecisionId: accepted.review.currentDecisionId,
      sourceDerivativeVersionId: derivative.currentDerivative!.id,
      state: 'edited_and_accepted',
      original: {
        title: 'Текущая лекарственная терапия',
        content:
          'Спросить о рецептурных и безрецептурных препаратах, витаминах и времени последнего приёма.',
        evidence: [
          {
            sourceId: 'conversation-gap',
            quote: 'В разговоре лекарства ещё не обсуждались',
          },
        ],
      },
      effective: {
        title: clinicianTitle,
        content: clinicianContent,
        evidence: [
          {
            sourceId: 'conversation-gap',
            quote: 'В разговоре лекарства ещё не обсуждались',
          },
        ],
      },
      provenance: {
        provider: 'synthetic',
        model: 'fixture',
        modelVersion: '1',
        policyVersion: 'synthetic-policy-1',
        inputHash: 'synthetic-workspace-input',
        sourceRecordIds: ['seg-002', 'seg-004'],
      },
      reviewedByMembershipId: 'membership-a',
      reviewedByDisplayName: 'А. Сейдахметова',
      reviewedAt: accepted.review.decidedAt,
    });

    expect(
      draftContent.raw.includes(
        'До формирования плана лечения уточнить реакции на препараты',
      ),
    ).toBe(false);
    expect(
      draftContent.raw.includes(
        'Сверить давление, пульс, ИМТ',
      ),
    ).toBe(false);
    expect(
      database
        .prepare(`
          select state from suggestion_review_heads
          where suggestion_id in ('rec-2', 'rec-3') order by suggestion_id
        `)
        .all(),
    ).toEqual([{ state: 'rejected' }, { state: 'proposed' }]);

    await expect(
      suggestions.createDerivative({
        recommendationId: 'rec-3',
        title: 'Уточнить объективные данные',
        content: 'Повторно проверить АД, пульс и ИМТ перед подписанием.',
        reason: 'Врач уточнил объём повторной проверки.',
        expectedVersion: 1,
        idempotencyKey: crypto.randomUUID(),
        actorId: 'user-a',
        requestId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(SuggestionLifecycleError);

    const signed = await signing.sign({
      protocolId: draft.protocol.id,
      expectedProtocolVersion: draft.protocol.version,
      expectedEncounterVersion: draft.transition.version,
      expectedProtocolHeadVersion: draft.protocol.headVersion,
      idempotencyKey: crypto.randomUUID(),
      actorId: 'user-a',
      requestId: crypto.randomUUID(),
    });
    const signedContent = readProtocolContent(database, signed.protocol.id);

    expect(signed.protocol).toMatchObject({
      version: 2,
      status: 'signed',
      sourceHash: draft.protocol.sourceHash,
    });
    expect(signed.transition).toMatchObject({ status: 'finalized', version: 3 });
    expect(signedContent.raw).toBe(draftContent.raw);
    expect(signedContent.parsed.recommendations).toEqual(
      draftContent.parsed.recommendations,
    );
    expect(
      database
        .prepare(`select status from protocol_versions where id = ?1`)
        .get(draft.protocol.id),
    ).toEqual({ status: 'draft' });
  }, 20000);
});
