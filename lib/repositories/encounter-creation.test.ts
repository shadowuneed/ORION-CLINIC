import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { type EncounterCreationScope } from '@/lib/auth/encounter-creation-access';
import { D1EncounterCreationRepository, EncounterCreationConflictError, PotentialPatientDuplicateError } from './encounter-creation';
import { D1WorkspaceAccessRepository } from './workspace-access';
import { resolveClinicianWorkspaceAccess } from '@/lib/auth/workspace-access';

const opened: DatabaseSync[] = [];
afterEach(() => opened.splice(0).forEach(db => db.close()));
const scope: EncounterCreationScope = { organizationId: 'org-a', facilityId: 'fac-a', reviewerMembershipId: 'membership-a',
  accessAssignmentId: 'access-assignment-a-general-medicine', accessPermission: 'encounter.manage' };
const input = () => ({ patient: { displayName: 'Тестовый пациент создания', birthDate: null, sexAtBirth: 'not_recorded' as const },
  reasonForVisit: 'Синтетическая проверка', actorId: 'user-a', requestId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID() });

function fixture(beforeBatch?: (db: DatabaseSync) => void) {
  const db = new DatabaseSync(':memory:'); opened.push(db); db.exec('pragma foreign_keys=on');
  for (const name of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) db.exec(readFileSync(`drizzle/${name}`, 'utf8'));
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const prepare = (sql: string, bindings: SQLInputValue[] = []) => ({
    sql, bindings, bind: (...args: SQLInputValue[]) => prepare(sql, args),
    first: async () => db.prepare(sql).get(...bindings) ?? null,
    all: async () => ({ success: true, results: db.prepare(sql).all(...bindings), meta: { changes: 0 } }),
  });
  const d1 = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    beforeBatch?.(db);
    db.exec('begin immediate');
    try {
      const result = statements.map(s => /^\s*select/i.test(s.sql)
        ? { success: true, results: db.prepare(s.sql).all(...s.bindings), meta: { changes: 0 } }
        : { success: true, results: [], meta: { changes: Number(db.prepare(s.sql).run(...s.bindings).changes) } });
      db.exec('commit'); return result;
    } catch (error) { db.exec('rollback'); throw error; }
  } } as unknown as D1Database;
  return { db, d1, repo: new D1EncounterCreationRepository(d1, scope) };
}

function changeAssignment(db: DatabaseSync, patch: Record<string, SQLInputValue>) {
  const current = db.prepare(`select version.* from department_access_assignment_versions version
    join department_access_assignment_heads head on head.current_version_id=version.id where head.assignment_id=?`).get(scope.accessAssignmentId!)!;
  const successor = { ...current, id: crypto.randomUUID(), version: Number(current.version)+1, supersedes_version_id: current.id,
    changed_at: Date.now(), created_at: Date.now(), ...patch };
  const keys = Object.keys(successor);
  db.prepare(`insert into department_access_assignment_versions (${keys.join(',')}) values (${keys.map(() => '?').join(',')})`)
    .run(...keys.map(key => successor[key as keyof typeof successor] as SQLInputValue));
  db.prepare(`update department_access_assignment_heads set current_version_id=?,lock_version=lock_version+1,updated_at=? where assignment_id=?`)
    .run(successor.id,Date.now(),scope.accessAssignmentId!);
}

describe('independent encounter creation', () => {
  it('creates the first patient and encounter in an empty clinic and resolves it under the selected doctor assignment', async () => {
    const { db, d1, repo } = fixture();
    expect(db.prepare('select count(*) as n from encounters').get()?.n).toBe(0);
    db.exec("update memberships set role='registrar' where id='membership-a'");
    const command = input(); const result = await repo.create(command);
    expect(await repo.create(command)).toEqual(result);
    expect(db.prepare('select count(*) as n from clinical_section_heads').get()?.n).toBe(8);
    expect(db.prepare(`select version.display_name from patient_profile_heads head
      join patient_profile_versions version on version.id=head.current_version_id`).get()?.display_name).toBe(command.patient.displayName);
    expect(db.prepare('select count(*) as n from audit_events').get()?.n).toBe(1);
    expect(db.prepare('select access_assignment_id from command_idempotency').get()?.access_assignment_id).toBe(scope.accessAssignmentId);
    const workspace = await resolveClinicianWorkspaceAccess(new D1WorkspaceAccessRepository(d1, {
      accessAssignmentId: scope.accessAssignmentId, facilityId: 'fac-a', permission: 'encounter.read',
    }), { issuer: 'openai:sites', subject: 'local_seedy', email: null }, result.encounter.id);
    expect(workspace.encounter.patient.id).toBe(result.patient.id);
    expect(db.prepare('pragma foreign_key_check').all()).toEqual([]);
  });
  it.each([undefined, 'unknown'])('rejects missing/wrong selection %s', async accessAssignmentId => {
    const { d1, db } = fixture();
    await expect(new D1EncounterCreationRepository(d1, { ...scope, accessAssignmentId }).create(input())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(db.prepare('select count(*) as n from patients').get()?.n).toBe(0);
  });
  it.each([{ deny_permissions_json: '["encounter.manage"]' }, { roles_json: '["nurse"]' }, { effective_until: Date.now()-1000 }] as Record<string, SQLInputValue>[])
    ('denies disallowed current assignment %j', async patch => {
      const { db, repo } = fixture(); changeAssignment(db,patch);
      await expect(repo.create(input())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    });
  it('denies wrong actor and read-only scope', async () => {
    const { d1, repo } = fixture();
    await expect(repo.create({ ...input(), actorId: 'wrong-user' })).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    await expect(new D1EncounterCreationRepository(d1,{ ...scope, accessPermission: 'encounter.read' }).create(input()))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });
  it('rejects changed payload, a different valid assignment and revoked replay', async () => {
    const { db, d1, repo } = fixture(); const command=input(); await repo.create(command);
    await expect(repo.create({ ...command, reasonForVisit: 'Изменено' })).rejects.toBeInstanceOf(EncounterCreationConflictError);
    db.exec(readFileSync('db/bootstrap.local.sql','utf8').replaceAll('general-medicine','secondary').replaceAll('general_medicine','secondary'));
    await expect(new D1EncounterCreationRepository(d1,{ ...scope, accessAssignmentId:'access-assignment-a-secondary' }).create(command))
      .rejects.toBeInstanceOf(EncounterCreationConflictError);
    changeAssignment(db,{ status:'revoked' });
    await expect(repo.create(command)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });
  it('rejects duplicate patient creation', async () => {
    const { repo } = fixture(); await repo.create(input());
    await expect(repo.create(input())).rejects.toBeInstanceOf(PotentialPatientDuplicateError);
  });
  it('rolls back all writes when authorization changes immediately before the batch', async () => {
    const { db, repo } = fixture(db => changeAssignment(db,{ status:'revoked' }));
    await expect(repo.create(input())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    for (const table of ['patients','encounters','encounter_creation_events','audit_events','command_idempotency'])
      expect(db.prepare(`select count(*) as n from ${table}`).get()?.n).toBe(0);
  });
  it.each(['audit_stream_heads','clinical_section_heads','patient_profile_heads'])('rolls back skipped publication of %s', async table => {
    const { db, repo }=fixture();
    db.exec(`create trigger skip_write before ${table==='audit_stream_heads'?'update':'insert'} on ${table} begin select raise(ignore); end`);
    await expect(repo.create(input())).rejects.toThrow();
    for (const name of ['patients','encounters','encounter_creation_events','audit_events','command_idempotency'])
      expect(db.prepare(`select count(*) as n from ${name}`).get()?.n).toBe(0);
  });
});
