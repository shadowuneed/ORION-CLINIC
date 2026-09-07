import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, expect, it } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { D1ConsentRepository, ConsentConflictError, type RecordConsentCommand } from './consent';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const assignmentId = 'access-assignment-a-general-medicine';
function fixture() {
  const db = new DatabaseSync(':memory:'); databases.push(db);
  db.exec('pragma foreign_keys=on');
  for (const file of readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) db.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  db.exec(readFileSync('db/seed.local.sql', 'utf8'));
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const hooks: { beforeBatch?: () => void } = {};
  function prepare(sql: string, bindings: SQLInputValue[] = []) {
    return { bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async () => db.prepare(sql).get(...bindings) ?? null,
      all: async () => ({ results: db.prepare(sql).all(...bindings) }),
      run: async () => ({ meta: { changes: Number(db.prepare(sql).run(...bindings).changes) } }) };
  }
  const d1 = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    hooks.beforeBatch?.(); db.exec('begin immediate');
    try { const results = []; for (const statement of statements) results.push(await statement.run()); db.exec('commit'); return results; }
    catch (error) { db.exec('rollback'); throw error; }
  } } as unknown as D1Database;
  const scope: WorkspaceScope = { organizationId: 'org-a', facilityId: 'fac-a', encounterId: 'encounter-a',
    reviewerMembershipId: 'membership-a', accessAssignmentId: assignmentId, accessPermission: 'encounter.manage' };
  return { db, d1, scope, hooks, repository: new D1ConsentRepository(d1, scope) };
}
function command(overrides: Partial<RecordConsentCommand> = {}): RecordConsentCommand {
  return { consentType: 'audio_retention', decision: 'granted', noticeLanguage: 'ru', source: 'verbal', expectedVersion: 0,
    actorId: 'user-a', requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), ...overrides };
}

it('captures first consent without prior consent of that type, stores attribution and replays without duplicate events', async () => {
  const { db, repository } = fixture(); const input = command();
  const result = await repository.recordCommand(input);
  expect(result).toMatchObject({ version: 1, decision: 'granted' });
  expect(await repository.recordCommand(input)).toEqual(result);
  expect(db.prepare('select access_assignment_id from consent_events where id=?').get(result.id)).toEqual({ access_assignment_id: assignmentId });
  expect(db.prepare("select access_assignment_id from command_idempotency where operation='consent.command'").all()).toEqual([{ access_assignment_id: assignmentId }]);
  expect(db.prepare("select metadata_json from audit_events where entity_id=?").get(result.id)?.metadata_json).toContain(assignmentId);
  await expect(repository.recordCommand({ ...input, noticeLanguage: 'kk' })).rejects.toBeInstanceOf(ConsentConflictError);
});

it('allows withdrawal and regrant after care consent is no longer effective', async () => {
  const { repository } = fixture();
  await repository.recordCommand(command({ consentType: 'care', decision: 'withdrawn', expectedVersion: 1 }));
  expect(await repository.hasEffectiveConsent('care')).toBe(false);
  await expect(repository.recordCommand(command())).resolves.toMatchObject({ decision: 'granted' });
  await expect(repository.recordCommand(command({ consentType: 'care', expectedVersion: 2 }))).resolves.toMatchObject({ decision: 'granted', version: 3 });
});

it('grants initial care consent on an encounter with no consent history', async () => {
  const { db, d1, scope } = fixture();
  db.exec(`insert into encounters (id,organization_id,facility_id,patient_id,clinician_membership_id)
    select 'encounter-first-care',organization_id,facility_id,patient_id,clinician_membership_id from encounters where id='encounter-a'`);
  const repository = new D1ConsentRepository(d1, { ...scope, encounterId: 'encounter-first-care' });
  expect(await repository.hasEffectiveConsent('care')).toBe(false);
  await expect(repository.recordCommand(command({ consentType: 'care' }))).resolves.toMatchObject({ version: 1, decision: 'granted' });
});

it('does not let direct SQL register an unattributed consent command', () => {
  const { db } = fixture();
  expect(() => db.exec(`insert into command_idempotency
    (id,organization_id,facility_id,actor_membership_id,operation,idempotency_key,request_hash,status)
    values ('forged','org-a','fac-a','membership-a','consent.command','forged','hash','processing')`))
    .toThrow(/consent command requires current exact assignment/);
});

it.each([{ accessAssignmentId: undefined }, { accessPermission: 'encounter.read' as const }, { facilityId: 'fac-b' }, { encounterId: 'encounter-b' }])(
  'rejects absent, read-only and wrong scopes %j', async (patch) => {
    const { d1, scope } = fixture();
    await expect(new D1ConsentRepository(d1, { ...scope, ...patch }).recordCommand(command())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

it('rejects wrong acting user and completed replay after membership revocation', async () => {
  const { db, repository } = fixture(); const input = command();
  await expect(repository.recordCommand({ ...input, actorId: 'user-b' })).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  await repository.recordCommand(input);
  db.exec("update memberships set status='disabled' where id='membership-a'");
  await expect(repository.recordCommand(input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
});

it('rolls back on revocation between preflight and batch', async () => {
  const { db, hooks, repository } = fixture();
  hooks.beforeBatch = () => { hooks.beforeBatch = undefined; db.exec("update memberships set status='disabled' where id='membership-a'"); };
  await expect(repository.recordCommand(command())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  expect(db.prepare("select count(*) as n from consent_events where consent_type='audio_retention'").get()?.n).toBe(0);
  expect(db.prepare("select count(*) as n from command_idempotency where operation='consent.command'").get()?.n).toBe(0);
});

it('rejects cross-assignment replay but allows a deliberate new command with current version', async () => {
  const { db, d1, scope, repository } = fixture(); const input = command();
  await repository.recordCommand(input);
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
  const other = new D1ConsentRepository(d1, { ...scope, accessAssignmentId: 'access-assignment-a-secondary' });
  await expect(other.recordCommand(input)).rejects.toBeInstanceOf(ConsentConflictError);
  await expect(other.recordCommand(command({ decision: 'withdrawn', expectedVersion: 1 }))).resolves.toMatchObject({ version: 2 });
});
