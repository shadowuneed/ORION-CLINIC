import { describe, expect, it } from 'vitest';
import { buildTeamGrant, buildTeamRestriction, effectiveTeamPermissions, emptyTeamGrant, permissionChoice, type TeamGrant, type TeamRestriction } from './team-model';
import { directoryFixture } from './test-fixtures';

const key = '4652da2e-f0b4-4f4b-96ae-796e7c19ec14';
function grant(): TeamGrant { return { ...emptyTeamGrant(), membershipId: 'membership-1', roles: ['doctor'], staffId: 'staff-1', specialty: 'Терапевт', reason: 'Смена обязанностей', confirmed: true }; }
function restriction(): TeamRestriction { return { type: 'assignment.revoke', membershipId: 'membership-1', resourceId: 'assignment-1', expectedVersion: 4, name: 'Врач для проверки', reason: 'Изменение обязанностей', confirmed: true }; }

describe('explicit same-clinic employee grants', () => {
  it('starts without any selected role, grant or confirmation', () => {
    expect(emptyTeamGrant()).toMatchObject({ roles: [], allowPermissions: [], denyPermissions: [], confirmed: false, staffId: '' });
    expect(effectiveTeamPermissions(emptyTeamGrant())).toEqual([]);
    expect(() => buildTeamGrant(directoryFixture(), { ...grant(), confirmed: false }, key)).toThrow('Подтвердите');
  });
  it('creates only the selected account membership with no password or identity override', () => {
    const command = buildTeamGrant(directoryFixture(), grant(), key);
    expect(command).toEqual({ type: 'assignment.create', clinicId: 'crm-clinic-local', idempotencyKey: key,
      membershipId: 'membership-1', roles: ['doctor'], allowPermissions: [], denyPermissions: [], staffId: 'staff-1', specialty: 'Терапевт', reason: 'Смена обязанностей' });
    expect(command).not.toHaveProperty('password'); expect(command).not.toHaveProperty('actor');
  });
  it('rejects a foreign, disabled membership or disabled account', () => {
    expect(() => buildTeamGrant(directoryFixture(), { ...grant(), membershipId: 'another-clinic-member' }, key)).toThrow('действующего');
    const data = directoryFixture(); data.memberships[0].status = 'disabled';
    expect(() => buildTeamGrant(data, grant(), key)).toThrow('действующего');
    data.memberships[0].status = 'active'; data.accounts[0].status = 'disabled';
    expect(() => buildTeamGrant(data, grant(), key)).toThrow('действующего');
  });
  it('requires an explicitly selected existing doctor and specialty to manage encounters', () => {
    for (const partial of [{ staffId: '' }, { staffId: 'staff-2' }, { staffId: 'foreign-staff' }, { specialty: ' ' }]) {
      expect(() => buildTeamGrant(directoryFixture(), { ...grant(), ...partial }, key)).toThrow('явно выберите');
    }
    expect(buildTeamGrant(directoryFixture(), { ...grant(), roles: ['registrar'], staffId: '', specialty: '' }, key)).toMatchObject({ staffId: null, specialty: null });
  });
  it('does not create or replace grants on a noninteractive imported membership', () => {
    const data = directoryFixture(); data.memberships[0].interactive = false;
    expect(() => buildTeamGrant(data, grant(), key)).toThrow('интерактивный доступ закрыт');
    expect(() => buildTeamGrant(data, { ...grant(), assignmentId: 'assignment-1', expectedVersion: 4 }, key)).toThrow('интерактивный доступ закрыт');
    expect(buildTeamRestriction(data, restriction(), key).type).toBe('assignment.revoke');
  });
  it('replaces only the exact current assignment with the same practitioner link and CAS', () => {
    const form = { ...grant(), assignmentId: 'assignment-1', expectedVersion: 4 };
    expect(buildTeamGrant(directoryFixture(), form, key)).toMatchObject({ type: 'assignment.replace', assignmentId: 'assignment-1', expectedVersion: 4, staffId: 'staff-1', specialty: 'Терапевт' });
    expect(() => buildTeamGrant(directoryFixture(), { ...form, expectedVersion: 3 }, key)).toThrow('уже изменилось');
    expect(() => buildTeamGrant(directoryFixture(), { ...form, membershipId: 'membership-2' }, key)).toThrow('уже изменилось');
    const changed = directoryFixture(); changed.assignments[0].status = 'revoked';
    expect(() => buildTeamGrant(changed, form, key)).toThrow('уже изменилось');
  });
  it('permission choice is mutually exclusive and changing it resets confirmation', () => {
    const allowed = permissionChoice(grant(), 'encounter.manage', 'allow');
    const denied = permissionChoice({ ...allowed, confirmed: true }, 'encounter.manage', 'deny');
    expect(denied.allowPermissions).not.toContain('encounter.manage'); expect(denied.denyPermissions).toContain('encounter.manage');
    expect(denied.confirmed).toBe(false); expect(effectiveTeamPermissions(denied)).not.toContain('encounter.manage');
    const reset = permissionChoice(denied, 'encounter.manage', 'default');
    expect(reset.denyPermissions).toEqual([]); expect(effectiveTeamPermissions(reset)).toContain('encounter.manage');
  });
  it('rejects empty roles/reason, conflicting overrides and mixed service roles', () => {
    for (const partial of [{ roles: [] }, { reason: ' ' }, { roles: ['service', 'doctor'] as TeamGrant['roles'] },
      { allowPermissions: ['access.manage'] as TeamGrant['allowPermissions'], denyPermissions: ['access.manage'] as TeamGrant['denyPermissions'] }]) {
      expect(() => buildTeamGrant(directoryFixture(), { ...grant(), ...partial }, key)).toThrow();
    }
  });
});

describe('confirmed versioned restriction', () => {
  it('requires explicit confirmation, reason and unchanged selected assignment', () => {
    for (const partial of [{ confirmed: false }, { reason: ' ' }, { expectedVersion: 3 }, { membershipId: 'membership-2' }, { resourceId: 'foreign-assignment' }]) {
      expect(() => buildTeamRestriction(directoryFixture(), { ...restriction(), ...partial }, key)).toThrow();
    }
    expect(buildTeamRestriction(directoryFixture(), restriction(), key)).toEqual({ type: 'assignment.revoke', clinicId: 'crm-clinic-local', assignmentId: 'assignment-1', expectedVersion: 4, reason: 'Изменение обязанностей', idempotencyKey: key });
  });
  it('membership disable cannot substitute another target or reuse an old version', () => {
    const selection = { ...restriction(), type: 'membership.disable' as const, resourceId: 'membership-1', expectedVersion: 2 };
    expect(buildTeamRestriction(directoryFixture(), selection, key)).toMatchObject({ type: 'membership.disable', membershipId: 'membership-1', expectedVersion: 2 });
    expect(() => buildTeamRestriction(directoryFixture(), { ...selection, resourceId: 'membership-2' }, key)).toThrow('уже изменился');
    expect(() => buildTeamRestriction(directoryFixture(), { ...selection, expectedVersion: 1 }, key)).toThrow('уже изменился');
  });
});
