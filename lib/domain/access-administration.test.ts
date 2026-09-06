import { describe, expect, it } from 'vitest';
import {
  createDepartmentSchema,
  grantAccessAssignmentSchema,
  serializeAccessRules,
  updateAccessAssignmentSchema,
} from './access-administration';

const scope = {
  facilityId: 'fac-a',
  actorAssignmentId: 'assignment-admin',
  idempotencyKey: '94a3cb15-2522-4d61-aac7-534674ca99c2',
};

describe('access administration contracts', () => {
  it('normalizes a valid department command and rejects unsafe codes', () => {
    expect(
      createDepartmentSchema.parse({
        ...scope,
        code: 'endo_2',
        name: ' Эндокринология ',
        kind: 'clinical',
        changeReason: ' Новый кабинет ',
      }),
    ).toMatchObject({
      code: 'endo_2',
      name: 'Эндокринология',
      changeReason: 'Новый кабинет',
    });
    expect(
      createDepartmentSchema.safeParse({
        ...scope,
        code: '../admin',
        name: 'Администраторы',
        kind: 'administrative',
        changeReason: 'Новый кабинет',
      }).success,
    ).toBe(false);
  });

  it('rejects overlapping access rules and invalid effective windows', () => {
    const base = {
      ...scope,
      departmentId: 'department-a',
      membershipId: 'membership-a',
      roles: ['doctor'] as const,
      allowPermissions: ['patient.directory.read'] as const,
      denyPermissions: ['patient.directory.read'] as const,
      effectiveFrom: 20,
      effectiveUntil: 10,
      changeReason: 'Работа в кабинете',
    };
    expect(grantAccessAssignmentSchema.safeParse(base).success).toBe(false);
  });

  it('rejects a service role mixed with an interactive role', () => {
    expect(
      updateAccessAssignmentSchema.safeParse({
        ...scope,
        expectedVersion: 1,
        status: 'active',
        roles: ['service', 'doctor'],
        allowPermissions: [],
        denyPermissions: [],
        effectiveFrom: 1,
        effectiveUntil: null,
        changeReason: 'Изменение роли',
      }).success,
    ).toBe(false);
  });

  it('serializes stable deny-first effective permissions', () => {
    expect(
      serializeAccessRules({
        roles: ['doctor'],
        allowPermissions: ['audit.read'],
        denyPermissions: ['patient.profile.write'],
      }),
    ).toMatchObject({
      rolesJson: '["doctor"]',
      allowPermissionsJson: '["audit.read"]',
      denyPermissionsJson: '["patient.profile.write"]',
      effectivePermissions: expect.not.arrayContaining([
        'patient.profile.write',
      ]),
    });
  });
});
