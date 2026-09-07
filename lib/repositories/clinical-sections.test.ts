import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { D1ConsentRepository } from './consent';
import { D1ClinicalSectionRepository, ClinicalSectionConflictError, ClinicalSectionCareConsentRequiredError, type RecordClinicalSectionCommand } from './clinical-sections';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const assignmentId = 'access-assignment-a-general-medicine';

function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('pragma foreign_keys=on');
  for (const file of readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`drizzle/${file}`, 'utf8'));
  }
  db.exec(readFileSync('db/seed.local.sql', 'utf8'));
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const hooks: { beforeBatch?: () => void; mapSql?: (sql: string) => string } = {};
  function prepare(sql: string, bindings: SQLInputValue[] = []) {
    return {
      bind: (...values: SQLInputValue[]) => prepare(sql, values),
      first: async () => db.prepare(sql).get(...bindings) ?? null,
      all: async () => ({ success: true, results: db.prepare(sql).all(...bindings) }),
      run: async () => ({ success: true, results: [], meta: { changes: Number(db.prepare(hooks.mapSql?.(sql) ?? sql).run(...bindings).changes) } }),
    };
  }
  const d1 = { prepare, batch: async (statements: ReturnType<typeof prepare>[]) => {
    hooks.beforeBatch?.();
    db.exec('begin immediate');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      db.exec('commit');
      return results;
    } catch (error) { db.exec('rollback'); throw error; }
  } } as unknown as D1Database;
  const scope: WorkspaceScope = { organizationId: 'org-a', facilityId: 'fac-a', encounterId: 'encounter-a',
    reviewerMembershipId: 'membership-a', accessAssignmentId: assignmentId, accessPermission: 'encounter.manage' };
  return { db, d1, scope, hooks, repository: new D1ClinicalSectionRepository(d1, scope) };
}

function command(overrides: Partial<RecordClinicalSectionCommand> = {}): RecordClinicalSectionCommand {
  return { sectionCode: 'history_of_present_illness', action: 'save_draft', content: 'Синтетическое уточнение врача.',
    expectedVersion: 1, actorId: 'user-a', idempotencyKey: crypto.randomUUID(), requestId: crypto.randomUUID(), ...overrides };
}

function changeAssignment(db: DatabaseSync, patch: { roles?: string[]; deny?: string[]; status?: string; from?: number; until?: number }) {
  const current = db.prepare(`select version.* from department_access_assignment_versions version
    join department_access_assignment_heads head on head.current_version_id=version.id
    where head.assignment_id=?`).get(assignmentId)!;
  const id = crypto.randomUUID();
  const at = Math.max(Date.now(), Number(current.changed_at) + 1);
  db.prepare(`insert into department_access_assignment_versions
    (id,organization_id,facility_id,assignment_id,department_id,membership_id,version,supersedes_version_id,status,source_type,
     roles_json,allow_permissions_json,deny_permissions_json,effective_from,effective_until,change_reason,changed_by_membership_id,changed_at,created_at)
    select ?,organization_id,facility_id,assignment_id,department_id,membership_id,version+1,id,?,'bootstrap',
      ?,allow_permissions_json,?,?,?,'synthetic_test_change',changed_by_membership_id,?,?
    from department_access_assignment_versions where id=?`).run(id, patch.status ?? 'active',
      JSON.stringify(patch.roles ?? ['doctor']), JSON.stringify(patch.deny ?? []), patch.from ?? 1704067200000,
      patch.until ?? null, at, at, current.id as string);
  db.prepare(`update department_access_assignment_heads set current_version_id=?,lock_version=lock_version+1,updated_at=?
    where assignment_id=?`).run(id, at, assignmentId);
}

describe('clinical section assignment persistence', () => {
  it('stores exact assignment on command, immutable version and hashed audit; exact replay adds no rows', async () => {
    const { db, repository } = fixture();
    const input = command();
    const first = await repository.recordCommand(input);
    expect(first).toMatchObject({ version: 2, reviewState: 'clinician_edited' });
    expect(await repository.recordCommand(input)).toEqual(first);
    expect(db.prepare("select access_assignment_id from command_idempotency where operation='clinical_section.command'").all())
      .toEqual([{ access_assignment_id: assignmentId }]);
    expect(db.prepare('select access_assignment_id,provenance_json from clinical_section_versions where version=2').get())
      .toMatchObject({ access_assignment_id: assignmentId, provenance_json: expect.stringContaining(assignmentId) });
    expect(db.prepare("select metadata_json from audit_events where action='clinical_section.save_draft'").all())
      .toEqual([{ metadata_json: expect.stringContaining(assignmentId) }]);
    await expect(repository.recordCommand({ ...input, content: 'Изменённое содержание' })).rejects.toBeInstanceOf(ClinicalSectionConflictError);
    await expect(repository.recordCommand(command())).rejects.toBeInstanceOf(ClinicalSectionConflictError);
  });

  it.each([{ status: 'revoked' }, { deny: ['encounter.manage'] }, { roles: ['nurse'] },
    { roles: ['service'] }, { until: Date.now() - 1000 }, { from: Date.now() + 86400000 }])(
    'denies writes and completed replay after the assignment changes: %j', async (patch) => {
      const { db, repository } = fixture();
      const input = command();
      await repository.recordCommand(input);
      changeAssignment(db, patch);
      await expect(repository.recordCommand(input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
      await expect(repository.recordCommand(command({ expectedVersion: 2 }))).rejects.toBeInstanceOf(AccessPermissionRequiredError);
      expect(db.prepare("select count(*) as n from command_idempotency where operation='clinical_section.command'").get()?.n).toBe(1);
    },
  );

  it('requires explicit manage scope and exact acting user, treating member and patient facility', async () => {
    const { d1, scope } = fixture();
    for (const patch of [{ accessAssignmentId: undefined }, { accessPermission: 'encounter.read' as const },
      { encounterId: 'encounter-b' }, { facilityId: 'fac-b' }, { reviewerMembershipId: 'membership-registrar' }]) {
      await expect(new D1ClinicalSectionRepository(d1, { ...scope, ...patch }).recordCommand(command()))
        .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    }
    await expect(new D1ClinicalSectionRepository(d1, scope).recordCommand(command({ actorId: 'user-b' })))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('does not use a legacy membership role as repository write authority', async () => {
    const { db, repository } = fixture();
    db.exec("update memberships set role='registrar' where id='membership-a'");
    await expect(repository.recordCommand(command())).resolves.toMatchObject({ version: 2 });
  });

  it('blocks cross-assignment replay even when both scopes belong to the same doctor', async () => {
    const { db, d1, scope, repository } = fixture();
    const input = command();
    await repository.recordCommand(input);
    db.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    const other = new D1ClinicalSectionRepository(d1, { ...scope, accessAssignmentId: 'access-assignment-a-secondary' });
    await expect(other.recordCommand(input)).rejects.toBeInstanceOf(ClinicalSectionConflictError);
    await expect(other.recordCommand(command({ expectedVersion: 2 }))).resolves.toMatchObject({ version: 3 });
  });

  it('denies completed replay after care consent withdrawal', async () => {
    const { d1, scope, repository } = fixture();
    const input = command();
    await repository.recordCommand(input);
    await new D1ConsentRepository(d1, scope).recordCommand({ consentType: 'care', decision: 'withdrawn', noticeLanguage: 'ru',
      source: 'verbal', expectedVersion: 1, idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() });
    await expect(repository.recordCommand(input)).rejects.toBeInstanceOf(ClinicalSectionCareConsentRequiredError);
  });

  it('rolls back everything when permission is revoked after preflight but before the database batch', async () => {
    const { db, hooks, repository } = fixture();
    hooks.beforeBatch = () => { hooks.beforeBatch = undefined; changeAssignment(db, { deny: ['encounter.manage'] }); };
    await expect(repository.recordCommand(command())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(db.prepare("select count(*) as n from command_idempotency where operation='clinical_section.command'").get()?.n).toBe(0);
    expect(db.prepare('select count(*) as n from clinical_section_versions where version>1').get()?.n).toBe(0);
  });

  it('rejects mismatched audit provenance and rolls the command/version/head back', async () => {
    const { db, hooks, repository } = fixture();
    hooks.mapSql = (sql) => sql.includes('insert into audit_events') ? sql.replace('?10, ?11, ?12, ?13', "json_set(?10, '$.accessAssignmentId', 'forged'), ?11, ?12, ?13") : sql;
    await expect(repository.recordCommand(command())).rejects.toThrow(/matching assignment provenance/);
    expect(db.prepare('select count(*) as n from clinical_section_versions where version>1').get()?.n).toBe(0);
    expect(db.prepare("select count(*) as n from command_idempotency where operation='clinical_section.command'").get()?.n).toBe(0);
  });

  it.each([
    { id: null, actor: 'user-a' },
    { id: 'unknown-assignment', actor: 'user-a' },
    { id: assignmentId, actor: 'user-b' },
  ])(
    'direct SQL cannot impersonate a doctor or omit required attribution: %j', ({ id, actor }) => {
      const { db } = fixture();
      expect(() => db.prepare(`insert into clinical_section_versions
        (id,organization_id,facility_id,encounter_id,code,content,review_state,provenance_json,
        created_by_type,created_by_id,version,supersedes_section_version_id,access_assignment_id)
        values ('forged','org-a','fac-a','encounter-a','history_of_present_illness','forged','clinician_edited',?,
        'user',?,2,'section-present-v1',?)`).run(JSON.stringify({ accessAssignmentId: id }), actor, id)).toThrow(/assigned doctor/);
    },
  );
});
