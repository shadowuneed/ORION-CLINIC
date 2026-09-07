import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import type { ClinicalAnalysisProviderResult } from '@/lib/providers/clinical-analysis';
import { D1ConsentRepository } from './consent';
import { D1ClinicalAnalysisRepository, ClinicalAnalysisCommandConflictError, ClinicalAnalysisConsentRequiredError } from './clinical-analysis';
const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
async function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db); db.exec('pragma foreign_keys=on');
  for (const file of readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) db.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  db.exec(readFileSync('db/seed.local.sql', 'utf8')); db.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const hooks: { beforeBatch?: () => void } = {};
  function prepare(sql: string, bindings: SQLInputValue[] = []) {
    return { bind: (...values: SQLInputValue[]) => prepare(sql, values), first: async () => db.prepare(sql).get(...bindings) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...bindings) }), run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...bindings).changes) } }) };
  }
  const d1 = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    hooks.beforeBatch?.(); db.exec('begin immediate');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('commit'); return results; }
    catch (error) { db.exec('rollback'); throw error; }
  } } as unknown as D1Database;
  const scope: WorkspaceScope = { organizationId: 'org-a', facilityId: 'fac-a', encounterId: 'encounter-a',
    reviewerMembershipId: 'membership-a', accessAssignmentId: 'access-assignment-a-general-medicine', accessPermission: 'encounter.manage' };
  const consent = new D1ConsentRepository(d1, scope);
  if (!await consent.hasEffectiveConsent('external_ai_processing')) await consent.recordCommand({ consentType: 'external_ai_processing', decision: 'granted', noticeLanguage: 'ru', source: 'verbal',
    expectedVersion: 0, actorId: 'user-a', requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
  const repository = new D1ClinicalAnalysisRepository(d1, scope);
  const snapshot = db.prepare("select id,version from transcript_segments where encounter_id='encounter-a' order by segment_index").all() as {id: string; version: number}[];
  const input = { snapshot, acknowledged: true as const, provider: 'groq', model: 'synthetic', modelVersion: 'v1', actorId: 'user-a', requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
  const prepared = await repository.prepare(input);
  const output: ClinicalAnalysisProviderResult = { provider: 'groq', model: 'synthetic', modelVersion: 'v1', policyVersion: 'orion-clinical-drafts-v1', raw: {}, durationMs: 1,
    output: { summary: 'Синтетическая проверка', sections: [], suggestions: [{ category: 'clarification', riskLevel: 'informational', title: 'Уточнение', content: 'Уточните жалобы.',
      evidence: [{ sourceId: prepared.segments[0].id, quote: prepared.segments[0].text }] }] } };
  return { db, d1, scope, hooks, consent, repository, input, prepared, output };
}
it('persists attributed analysis, unapproved suggestions and exact replay', async () => {
  const { db, scope, repository, input, prepared, output } = await fixture();
  expect(await repository.complete(prepared, output, input)).toMatchObject({ runId: prepared.runId, suggestionCount: 1 });
  expect((await repository.prepare(input)).replayRunId).toBe(prepared.runId);
  expect(db.prepare('select access_assignment_id from analysis_runs where id=?').get(prepared.runId)?.access_assignment_id).toBe(scope.accessAssignmentId);
  expect(db.prepare('select metadata_json from audit_events where entity_id=?').get(prepared.runId)?.metadata_json).toContain(scope.accessAssignmentId);
  expect(db.prepare('select head.state,head.current_decision_id from suggestion_review_heads head join clinical_suggestions suggestion on suggestion.id=head.suggestion_id where suggestion.analysis_run_id=?').all(prepared.runId))
    .toEqual([{ state: 'proposed', current_decision_id: null }]);
});
it('rejects a delayed result and replay after access revocation', async () => {
  const { db, repository, input, prepared, output } = await fixture();
  db.exec("update memberships set status='disabled' where id='membership-a'");
  await expect(repository.complete(prepared, output, input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  await expect(repository.prepare(input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
});
it('rejects delayed result after external AI consent withdrawal', async () => {
  const { consent, repository, input, prepared, output } = await fixture();
  await consent.recordCommand({ consentType: 'external_ai_processing', decision: 'withdrawn', noticeLanguage: 'ru', source: 'verbal', expectedVersion: 1,
    actorId: 'user-a', requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
  await expect(repository.complete(prepared, output, input)).rejects.toBeInstanceOf(ClinicalAnalysisConsentRequiredError);
});
it('does not complete another assignment run or replay its command', async () => {
  const { db, d1, scope, repository, input, prepared, output } = await fixture();
  await repository.complete(prepared, output, input);
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
  const other = new D1ClinicalAnalysisRepository(d1, { ...scope, accessAssignmentId: 'access-assignment-a-secondary' });
  await expect(other.prepare(input)).rejects.toBeInstanceOf(ClinicalAnalysisCommandConflictError);
  await expect(other.complete(prepared, output, input)).rejects.toBeInstanceOf(ClinicalAnalysisCommandConflictError);
});
it('rolls back provider output on a revocation immediately before the write transaction', async () => {
  const { db, hooks, repository, input, prepared, output } = await fixture();
  hooks.beforeBatch = () => { hooks.beforeBatch = undefined; db.exec("update memberships set status='disabled' where id='membership-a'"); };
  await expect(repository.complete(prepared, output, input)).rejects.toThrow(/analysis completion requires/);
  expect(db.prepare('select status,raw_result_json from analysis_runs where id=?').get(prepared.runId)).toMatchObject({ status: 'running', raw_result_json: null });
});
