import { readFileSync, readdirSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import { resolveClinicianWorkspaceAccess, AccessibleEncounterNotFoundError } from '@/lib/auth/workspace-access';
import { D1WorkspaceAccessRepository } from './workspace-access';

const databases: DatabaseSync[] = [];
afterEach(() => databases.splice(0).forEach((db) => db.close()));
const principal = { issuer: 'openai:sites', subject: 'local_seedy', email: null };

function fixture() {
  const db = new DatabaseSync(':memory:');
  databases.push(db);
  db.exec('pragma foreign_keys=on');
  for (const path of readdirSync('drizzle').filter((name) => name.endsWith('.sql')).sort()) {
    db.exec(readFileSync(`drizzle/${path}`, 'utf8'));
  }
  db.exec(readFileSync('db/seed.local.sql', 'utf8'));
  db.exec(readFileSync('db/bootstrap.local.sql', 'utf8'));
  function prepare(sql: string, values: SQLInputValue[] = []) {
    return {
      bind: (...bindings: SQLInputValue[]) => prepare(sql, bindings),
      all: async () => ({ success: true, results: db.prepare(sql).all(...values) }),
    };
  }
  const d1 = { prepare } as unknown as D1Database;
  return { db, d1 };
}

describe('D1 assigned workspace request authorization', () => {
  it('does not merge memberships and does not expose records after the selected membership is disabled', async () => {
    const { db, d1 } = fixture();
    const repo = new D1WorkspaceAccessRepository(d1);
    const memberships = await repo.listActiveMemberships(principal);
    expect(memberships).toHaveLength(1);
    await expect(repo.listAssignedEncounters([...memberships, ...memberships])).rejects.toThrow();
    db.exec("update memberships set status='disabled' where id='membership-a'");
    expect(await repo.listAssignedEncounters(memberships)).toEqual([]);
  });
  it('resolves one exact department assignment before listing assigned encounters', async () => {
    const { d1 } = fixture();
    const access = await resolveClinicianWorkspaceAccess(new D1WorkspaceAccessRepository(d1, {
      accessAssignmentId: 'access-assignment-a-general-medicine', facilityId: 'fac-a', permission: 'encounter.read',
    }), principal, 'encounter-a');
    expect(access.scope).toMatchObject({ encounterId: 'encounter-a', reviewerMembershipId: 'membership-a',
      accessAssignmentId: 'access-assignment-a-general-medicine', accessPermission: 'encounter.read' });
    expect(access.encounters.every((item) => item.facilityId === 'fac-a' && item.clinicianMembershipId === 'membership-a')).toBe(true);
  });
  it('does not reveal another clinician or tenant encounter', async () => {
    const { d1 } = fixture();
    await expect(resolveClinicianWorkspaceAccess(new D1WorkspaceAccessRepository(d1), principal, 'encounter-b'))
      .rejects.toBeInstanceOf(AccessibleEncounterNotFoundError);
  });
  it('never falls back after an explicit unknown assignment', async () => {
    const { d1 } = fixture();
    await expect(resolveClinicianWorkspaceAccess(new D1WorkspaceAccessRepository(d1, {
      accessAssignmentId: 'unknown', permission: 'encounter.manage',
    }), principal, 'encounter-a')).rejects.toThrow('requested access assignment');
  });
  it('rechecks current membership instead of reusing an earlier authorization', async () => {
    const { db, d1 } = fixture();
    const repo = new D1WorkspaceAccessRepository(d1);
    await expect(resolveClinicianWorkspaceAccess(repo, principal, 'encounter-a')).resolves.toBeDefined();
    db.exec("update memberships set status='disabled' where id='membership-a'");
    await expect(resolveClinicianWorkspaceAccess(repo, principal, 'encounter-a')).rejects.toThrow();
  });
});
