import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import type { SpeechTranscription } from '@/lib/providers/speech-to-text';
import { D1ConsentRepository } from './consent';
import { D1TranscriptIngestionRepository, SpeechCaptureConsentRequiredError, SpeechCaptureLifecycleError, SpeechCaptureNotFoundError, SpeechCaptureConflictError } from './transcript-ingestion';
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
  const repository = new D1TranscriptIngestionRepository(d1, scope);
  const consent = new D1ConsentRepository(d1, scope);
  if (!await consent.hasEffectiveConsent('transient_audio_processing')) await consent.recordCommand({ consentType: 'transient_audio_processing',
    decision: 'granted', noticeLanguage: 'ru', source: 'verbal', expectedVersion: 0, actorId: 'user-a', requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
  const ids = await repository.preflightStart();
  const session = await repository.persistStartedSession({ speechSession: { upstreamSessionId: 'synthetic-upstream', provider: 'local-gigaam', model: 'synthetic', modelVersion: 'v1' },
    consentEventIds: ids, actorId: 'user-a', requestId: crypto.randomUUID() });
  const request = { sessionId: session.id, utteranceIndex: 0, audio: new Uint8Array([1,2,3]) };
  const prepared = await repository.prepareTranscription(request);
  const result: SpeechTranscription = { upstreamSessionId: 'synthetic-upstream', utteranceIndex: 0, text: 'Синтетическая реплика', role: 'patient', roleSource: 'model',
    language: 'ru', speakerConfidenceBasisPoints: null, startedAtMs: 0, endedAtMs: 1000, durationMs: 1000, processingMs: 1, providerPayload: {} };
  const commit = { sessionId: session.id, utteranceIndex: 0, inputHash: prepared.inputHash, result, actorId: 'user-a', requestId: crypto.randomUUID() };
  return { db, d1, scope, hooks, repository, consent, session, request, commit };
}
it('persists exact ownership, transcription and replay, without duplicate text', async () => {
  const { db, scope, repository, session, request, commit } = await fixture();
  expect(db.prepare('select access_assignment_id from transcription_runs where id=?').get(session.id)?.access_assignment_id).toBe(scope.accessAssignmentId);
  const segment = await repository.commitTranscription(commit);
  expect((await repository.prepareTranscription(request)).replay).toEqual(segment);
  expect(await repository.commitTranscription(commit)).toEqual(segment);
  await repository.finishSession(session.id, 'completed');
  await expect(repository.prepareTranscription(request)).rejects.toBeInstanceOf(SpeechCaptureLifecycleError);
});
it('rejects delayed results and replay after access revocation', async () => {
  const { db, repository, request, commit } = await fixture();
  await repository.commitTranscription(commit);
  db.exec("update memberships set status='disabled' where id='membership-a'");
  await expect(repository.prepareTranscription(request)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  await expect(repository.commitTranscription(commit)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
});
it('rejects delayed result after consent withdrawal but allows authorized cleanup', async () => {
  const { repository, consent, session, commit } = await fixture();
  await consent.recordCommand({ consentType: 'transient_audio_processing', decision: 'withdrawn', noticeLanguage: 'ru', source: 'verbal', expectedVersion: 1,
    actorId: 'user-a', requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });
  await expect(repository.commitTranscription(commit)).rejects.toBeInstanceOf(SpeechCaptureConsentRequiredError);
  expect(await repository.getUpstreamSessionId(session.id)).toBe('synthetic-upstream');
  await repository.finishSession(session.id, 'cancelled');
});
it('rejects another assignment of the same doctor for use, replay and cleanup', async () => {
  const { db, d1, scope, session, request, repository, commit } = await fixture();
  await repository.commitTranscription(commit);
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
  const other = new D1TranscriptIngestionRepository(d1, { ...scope, accessAssignmentId: 'access-assignment-a-secondary' });
  await expect(other.prepareTranscription(request)).rejects.toBeInstanceOf(SpeechCaptureNotFoundError);
  await expect(other.getUpstreamSessionId(session.id)).rejects.toBeInstanceOf(SpeechCaptureNotFoundError);
  await expect(other.finishSession(session.id, 'cancelled')).rejects.toBeInstanceOf(SpeechCaptureNotFoundError);
});
it('rolls back all transcript data when permission is revoked immediately before batch', async () => {
  const { db, hooks, repository, commit } = await fixture();
  const count = db.prepare('select count(*) as n from transcript_segments').get()?.n;
  hooks.beforeBatch = () => { hooks.beforeBatch = undefined; db.exec("update memberships set status='disabled' where id='membership-a'"); };
  await expect(repository.commitTranscription(commit)).rejects.toThrow();
  expect(db.prepare('select count(*) as n from transcript_segments').get()?.n).toBe(count);
  expect(db.prepare('select count(*) as n from transcription_results').get()?.n).toBe(0);
});
it('rejects wrong actor and a provider response from another session', async () => {
  const { repository, commit } = await fixture();
  await expect(repository.commitTranscription({ ...commit, actorId: 'user-b' })).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  await expect(repository.commitTranscription({ ...commit, result: { ...commit.result, upstreamSessionId: 'other' } })).rejects.toBeInstanceOf(SpeechCaptureConflictError);
});
it('does not persist a provider-created session if permission was revoked while starting', async () => {
  const { db, repository } = await fixture();
  const consentEventIds = await repository.preflightStart();
  db.exec("update memberships set status='disabled' where id='membership-a'");
  await expect(repository.persistStartedSession({ speechSession: { upstreamSessionId: 'late', provider: 'local-gigaam', model: 'synthetic', modelVersion: 'v1' },
    consentEventIds, actorId: 'user-a', requestId: crypto.randomUUID() })).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  expect(db.prepare("select count(*) as n from transcription_runs where upstream_session_id='late'").get()?.n).toBe(0);
});
