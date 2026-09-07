import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { D1ConsentRepository } from './consent';
import { D1TranscriptRepository, TranscriptConflictError, TranscriptConsentRequiredError, TranscriptLifecycleError, type CorrectTranscriptCommand } from './transcript';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
function fixture() {
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
  return { db, d1, scope, hooks, repository: new D1TranscriptRepository(d1, scope) };
}
function command(): CorrectTranscriptCommand {
  return { segmentId: 'seg-001', expectedVersion: 1, text: 'Синтетическая исправленная реплика', role: 'patient', language: 'kk',
    actorId: 'user-a', requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() };
}
it('persists a versioned role/text correction with exact assignment and unchanged source timing', async () => {
  const { db, repository, scope } = fixture(); const input = command();
  const before = db.prepare("select * from transcript_segments where id='seg-001'").get();
  const result = await repository.correct(input);
  expect(result).toMatchObject({ version: 2, role: 'patient', language: 'kk', state: 'corrected', startedAtMs: 8000, endedAtMs: 16000 });
  expect(await repository.correct(input)).toEqual(result);
  expect(db.prepare("select * from transcript_segments where id='seg-001'").get()).toEqual(before);
  expect(db.prepare('select access_assignment_id from transcript_segments where id=?').get(result.id)?.access_assignment_id).toBe(scope.accessAssignmentId);
  expect(db.prepare("select access_assignment_id from command_idempotency where operation='transcript.correct'").get()?.access_assignment_id).toBe(scope.accessAssignmentId);
  expect(db.prepare('select metadata_json from audit_events where entity_id=?').get(result.id)?.metadata_json).toContain(scope.accessAssignmentId);
  await expect(repository.correct({ ...input, text: 'Другой текст' })).rejects.toBeInstanceOf(TranscriptConflictError);
  await expect(repository.correct(command())).rejects.toBeInstanceOf(TranscriptConflictError);
});
it.each([{ accessAssignmentId: undefined }, { accessPermission: 'encounter.read' as const }, { facilityId: 'fac-b' }, { encounterId: 'encounter-b' }])(
  'denies invalid scope %j', async (patch) => {
    const { d1, scope } = fixture();
    await expect(new D1TranscriptRepository(d1, { ...scope, ...patch }).correct(command())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });
it('rejects wrong user and replay after revocation', async () => {
  const { db, repository } = fixture(); const input = command();
  await expect(repository.correct({ ...input, actorId: 'user-b' })).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  await repository.correct(input); db.exec("update memberships set status='disabled' where id='membership-a'");
  await expect(repository.correct(input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
});
it('rolls back when access disappears between preflight and batch', async () => {
  const { db, hooks, repository } = fixture();
  hooks.beforeBatch = () => { hooks.beforeBatch = undefined; db.exec("update memberships set status='disabled' where id='membership-a'"); };
  await expect(repository.correct(command())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  expect(db.prepare("select count(*) as n from transcript_segments where version>1").get()?.n).toBe(0);
});
it('does not replay stored text after transcript consent withdrawal', async () => {
  const { d1, scope, repository } = fixture(); const input = command(); await repository.correct(input);
  await new D1ConsentRepository(d1, scope).recordCommand({ consentType: 'transcript_storage', decision: 'withdrawn', noticeLanguage: 'ru',
    source: 'verbal', expectedVersion: 1, actorId: 'user-a', idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID() });
  await expect(repository.correct(input)).rejects.toBeInstanceOf(TranscriptConsentRequiredError);
});
it('rejects cross-assignment replay', async () => {
  const { db, d1, scope, repository } = fixture(); const input = command(); await repository.correct(input);
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
  await expect(new D1TranscriptRepository(d1, { ...scope, accessAssignmentId: 'access-assignment-a-secondary' }).correct(input))
    .rejects.toBeInstanceOf(TranscriptConflictError);
});
it('denies completed replay when the encounter is no longer editable', async () => {
  const { db, repository } = fixture(); const input = command(); await repository.correct(input);
  db.exec("update encounters set status='cancelled',version=version+1 where id='encounter-a'");
  await expect(repository.correct(input)).rejects.toBeInstanceOf(TranscriptLifecycleError);
});
it('direct SQL cannot create an unattributed correction command', () => {
  const { db } = fixture();
  expect(() => db.exec(`insert into command_idempotency
    (id,organization_id,facility_id,actor_membership_id,operation,idempotency_key,request_hash,status)
    values ('forged','org-a','fac-a','membership-a','transcript.correct','forged','hash','processing')`))
    .toThrow(/transcript command requires current exact assignment/);
});
