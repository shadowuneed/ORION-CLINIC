import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { D1EncounterLifecycleRepository, EncounterTransitionConflictError, EncounterTransitionValidationError } from './encounter-lifecycle';
import { D1ClinicalSectionRepository } from './clinical-sections';
import { D1ProtocolReviewRepository } from './protocol-review';
import { D1ProtocolSigningRepository } from './protocol-signing';
import { D1ProtocolAmendmentRepository } from './protocol-amendment';

type Statement = { sql: string; bindings: SQLInputValue[]; run(): Promise<D1Result> };
type Hooks = { beforeBatch?: () => void; beforeStatement?: (statement: Statement) => void };
const databases: DatabaseSync[] = [];
afterEach(() => { while (databases.length) databases.pop()!.close(); });

function fixture(hooks: Hooks = {}) {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('pragma foreign_keys=on');
  for (const name of readdirSync('drizzle').filter(n => n.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`drizzle/${name}`, 'utf8').replaceAll('--> statement-breakpoint', ''));
  }
  db.exec(readFileSync('db/seed.local.sql', 'utf8'));
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  const prepare = (sql: string, bindings: SQLInputValue[] = []): unknown => ({
    sql, bindings,
    bind: (...values: SQLInputValue[]) => prepare(sql, values),
    first: async () => db.prepare(sql).get(...bindings) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...bindings), success: true }),
    run: async () => ({ success: true, results: [], meta: { changes: Number(db.prepare(sql).run(...bindings).changes) } }),
  });
  const d1 = {
    prepare,
    async batch(statements: Statement[]) {
      hooks.beforeBatch?.();
      db.exec('begin immediate');
      try {
        const results = [];
        for (const statement of statements) {
          hooks.beforeStatement?.(statement);
          results.push(await statement.run());
        }
        db.exec('commit');
        return results;
      } catch (error) { db.exec('rollback'); throw error; }
    },
  } as unknown as D1Database;
  const scope: WorkspaceScope = { organizationId: 'org-a', facilityId: 'fac-a',
    encounterId: 'encounter-a-lifecycle', reviewerMembershipId: 'membership-a',
    accessAssignmentId: 'access-assignment-a-general-medicine', accessPermission: 'encounter.manage' };
  return { db, d1, scope, repository: new D1EncounterLifecycleRepository(d1, scope) };
}

function command(nextStatus: 'ready' | 'in_progress' | 'cancelled' = 'ready', expectedVersion = 1) {
  return { nextStatus, expectedVersion, idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() };
}
function snapshot(db: DatabaseSync) {
  return ['encounters', 'encounter_transition_events', 'command_idempotency', 'audit_events', 'audit_stream_heads']
    .map(table => db.prepare(`select * from ${table} order by id`).all());
}

describe('lifecycle exact-assignment transaction boundary', () => {
  it('persists draft/ready/start, immutable attribution and command-time replay after cancellation', async () => {
    const { db, repository, scope } = fixture();
    const input = command();
    const ready = await repository.recordTransition(input);
    expect(ready).toMatchObject({ status: 'ready', version: 2, startedAt: null });
    const started = await repository.recordTransition(command('in_progress', 2));
    expect(started.startedAt).toBeTypeOf('number');
    await repository.recordTransition(command('cancelled', 3));
    expect(await repository.recordTransition(input)).toEqual(ready);
    expect(db.prepare('select access_assignment_id from encounter_transition_events').all())
      .toEqual(Array(3).fill({ access_assignment_id: scope.accessAssignmentId }));
    expect(() => db.exec("update encounter_transition_events set actor_id='user-b'")) .toThrow(/immutable/);
    expect(() => db.exec('delete from encounter_transition_events')).toThrow(/immutable/);
  });

  it.each(['missing', 'read-only', 'wrong-user', 'revoked'] as const)('denies %s authority without writes', async kind => {
    const { db, d1, scope } = fixture();
    if (kind === 'missing') scope.accessAssignmentId = undefined;
    if (kind === 'read-only') scope.accessPermission = 'encounter.read';
    if (kind === 'revoked') db.exec("update memberships set status='disabled' where id='membership-a'");
    const before = snapshot(db);
    await expect(new D1EncounterLifecycleRepository(d1, scope).recordTransition({ ...command(), actorId: kind === 'wrong-user' ? 'user-b' : 'user-a' }))
      .rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(snapshot(db)).toEqual(before);
  });

  it('rejects replay after revocation and under a different selected assignment', async () => {
    const { db, d1, repository, scope } = fixture();
    const input = command();
    await repository.recordTransition(input);
    // A second active assignment cannot adopt the first assignment command.
    db.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    const second = db.prepare("select assignment_id from encounter_access_assignment_permissions where membership_id='membership-a' and assignment_id<>? and can_manage=1").get(scope.accessAssignmentId!) as { assignment_id: string };
    expect(second).toBeTruthy();
    await expect(new D1EncounterLifecycleRepository(d1, { ...scope, accessAssignmentId: second.assignment_id }).recordTransition(input))
      .rejects.toBeInstanceOf(EncounterTransitionConflictError);
    db.exec("update memberships set status='disabled' where id='membership-a'");
    await expect(repository.recordTransition(input)).rejects.toBeInstanceOf(AccessPermissionRequiredError);
  });

  it('revocation after preflight aborts before any lifecycle write', async () => {
    let called = false;
    const { db, repository } = fixture({ beforeBatch: () => {
      called = true;
      db.exec(`insert into department_access_assignment_versions
        (id,organization_id,facility_id,assignment_id,department_id,membership_id,version,supersedes_version_id,
         status,source_type,roles_json,allow_permissions_json,deny_permissions_json,effective_from,effective_until,
         change_reason,changed_by_membership_id,changed_at,created_at)
        select 'revoked-lifecycle-test',v.organization_id,v.facility_id,v.assignment_id,v.department_id,v.membership_id,
          v.version+1,v.id,'revoked','bootstrap',v.roles_json,v.allow_permissions_json,v.deny_permissions_json,
          v.effective_from,v.effective_until,'synthetic revocation test',v.changed_by_membership_id,v.changed_at+1,v.created_at+1
        from department_access_assignment_versions v join department_access_assignment_heads h on h.current_version_id=v.id
        where h.assignment_id='access-assignment-a-general-medicine';
        update department_access_assignment_heads set current_version_id='revoked-lifecycle-test',
          lock_version=lock_version+1,updated_at=updated_at+1 where assignment_id='access-assignment-a-general-medicine';`);
    } });
    db.exec(readFileSync('db/bootstrap.local.sql', 'utf8').replaceAll('general-medicine', 'secondary').replaceAll('general_medicine', 'secondary'));
    const before = snapshot(db);
    await expect(repository.recordTransition(command())).rejects.toBeInstanceOf(AccessPermissionRequiredError);
    expect(called).toBe(true);
    expect(snapshot(db)).toEqual(before);
    expect(db.prepare("select assignment_id from encounter_access_assignment_permissions where assignment_id='access-assignment-a-secondary'").get()).toBeTruthy();
  });

  it('continues the actual start -> reviewed protocol -> signed -> amended workflow', async () => {
    const { db, d1, scope, repository } = fixture();
    await repository.recordTransition(command());
    await repository.recordTransition(command('in_progress', 2));
    const sections = new D1ClinicalSectionRepository(d1, scope);
    for (const section of await sections.list()) {
      await sections.recordCommand({ sectionCode: section.code, action: 'mark_absent', expectedVersion: section.version,
        idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() });
    }
    const draft = await new D1ProtocolReviewRepository(d1, scope).beginReview({
      expectedEncounterVersion: 3, idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() });
    const signed = await new D1ProtocolSigningRepository(d1, scope).sign({
      protocolId: draft.protocol.id, expectedProtocolVersion: draft.protocol.version,
      expectedProtocolHeadVersion: draft.protocol.headVersion, expectedEncounterVersion: draft.transition.version,
      idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() });
    const original = db.prepare('select * from protocol_versions where id=?').get(signed.protocol.id);
    const amended = await new D1ProtocolAmendmentRepository(d1, scope).amend({
      baseProtocolId: signed.protocol.id, expectedProtocolVersion: signed.protocol.version,
      expectedProtocolHeadVersion: signed.protocol.headVersion, expectedEncounterVersion: signed.transition.version,
      reason: 'Synthetic clinician correction', text: 'Synthetic signed amendment for integration testing.',
      idempotencyKey: crypto.randomUUID(), actorId: 'user-a', requestId: crypto.randomUUID() });
    expect(amended.transition.status).toBe('amended');
    expect(db.prepare('select * from protocol_versions where id=?').get(signed.protocol.id)).toEqual(original);
    expect(db.prepare('select count(*) as count from encounter_transition_events').get()).toEqual({ count: 2 });
  }, 20000);

  it.each(['audit', 'result', 'encounter', 'event', 'no-update'] as const)('rolls back tampered %s writes', async kind => {
    let intercepted = 0;
    const { db, repository } = fixture({ beforeStatement: statement => {
      if (kind === 'audit' && statement.sql.includes('insert into audit_events')) {
        statement.bindings[9] = JSON.stringify({ accessAssignmentId: 'wrong', commandId: 'wrong' }); intercepted++;
      }
      if (kind === 'result' && statement.sql.includes('update command_idempotency')) {
        const result = JSON.parse(statement.bindings[1] as string); result.encounterId = 'encounter-b';
        statement.bindings[1] = JSON.stringify(result); intercepted++;
      }
      if (kind === 'encounter' && statement.sql.includes('update encounters')) { statement.bindings[0] = 'cancelled'; intercepted++; }
      if (kind === 'no-update' && statement.sql.includes('update encounters')) { statement.bindings[4] = 'missing-encounter'; intercepted++; }
      if (kind === 'event' && statement.sql.includes('insert into encounter_transition_events')) { statement.bindings[4] = 'wrong'; intercepted++; }
    } });
    const before = snapshot(db);
    await expect(repository.recordTransition(command())).rejects.toThrow();
    expect(intercepted).toBeGreaterThan(0);
    expect(snapshot(db)).toEqual(before);
  });

  it('does not let ordinary lifecycle commands create or sign a protocol', async () => {
    const { db, repository } = fixture();
    const before = snapshot(db);
    await expect(repository.recordTransition({ ...command(), nextStatus: 'finalized' })).rejects.toBeInstanceOf(EncounterTransitionValidationError);
    expect(snapshot(db)).toEqual(before);
  });
});
