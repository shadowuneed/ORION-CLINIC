import { describe, expect, it } from 'vitest';
import {
  clinicPermissions,
  deriveEffectivePermissions,
  parseAccessAssignment,
  roleDefaultPermissions,
  type ClinicPermission,
  type StoredAccessAssignment,
} from './access-governance';

function stored(
  overrides: Partial<StoredAccessAssignment> = {},
): StoredAccessAssignment {
  return {
    rolesJson: JSON.stringify(['doctor']),
    allowPermissionsJson: JSON.stringify(['access.self.read']),
    denyPermissionsJson: JSON.stringify([]),
    ...overrides,
  };
}

describe('access-assignment domain contract', () => {
  it('parses known unique roles and permissions and derives a canonical effective set', () => {
    const parsed = parseAccessAssignment(
      stored({
        allowPermissionsJson: JSON.stringify([
          'access.self.read',
          'access.manage',
        ]),
        denyPermissionsJson: JSON.stringify(['encounter.manage']),
      }),
    );

    expect(parsed).toMatchObject({
      roles: ['doctor'],
      allowPermissions: ['access.self.read', 'access.manage'],
      denyPermissions: ['encounter.manage'],
    });
    expect(parsed.effectivePermissions).toContain('access.self.read');
    expect(parsed.effectivePermissions).toContain('access.manage');
    expect(parsed.effectivePermissions).not.toContain('encounter.manage');
    expect(parsed.effectivePermissions).toEqual(
      clinicPermissions.filter((permission) =>
        parsed.effectivePermissions.includes(permission),
      ),
    );
  });

  it('applies explicit deny after role defaults and explicit allows', () => {
    const rolePermission = roleDefaultPermissions.doctor[0];
    expect(rolePermission).toBeDefined();

    const deniedRoleDefault = deriveEffectivePermissions(
      ['doctor'],
      [],
      [rolePermission],
    );
    const deniedExplicitAllow = deriveEffectivePermissions(
      ['doctor'],
      ['access.manage'],
      ['access.manage'],
    );

    expect(deniedRoleDefault).not.toContain(rolePermission);
    expect(deniedExplicitAllow).not.toContain('access.manage');
  });

  it('returns effective permissions in the stable catalogue order', () => {
    const unorderedAllow: ClinicPermission[] = [
      'service.integration.execute',
      'access.self.read',
      'patient.directory.read',
    ];
    const result = deriveEffectivePermissions([], unorderedAllow);

    expect(result).toEqual(
      clinicPermissions.filter((permission) => unorderedAllow.includes(permission)),
    );
  });

  it.each([
    [
      'malformed JSON',
      stored({ rolesJson: '["doctor"' }),
    ],
    [
      'non-array roles',
      stored({ rolesJson: JSON.stringify({ role: 'doctor' }) }),
    ],
    [
      'non-array allow permissions',
      stored({ allowPermissionsJson: JSON.stringify('access.self.read') }),
    ],
    [
      'non-array deny permissions',
      stored({ denyPermissionsJson: JSON.stringify(null) }),
    ],
    [
      'empty roles',
      stored({ rolesJson: JSON.stringify([]) }),
    ],
    [
      'unknown role',
      stored({ rolesJson: JSON.stringify(['superuser']) }),
    ],
    [
      'unknown allow permission',
      stored({ allowPermissionsJson: JSON.stringify(['patient.delete']) }),
    ],
    [
      'unknown deny permission',
      stored({ denyPermissionsJson: JSON.stringify(['patient.delete']) }),
    ],
    [
      'duplicate role',
      stored({ rolesJson: JSON.stringify(['doctor', 'doctor']) }),
    ],
    [
      'duplicate allow permission',
      stored({
        allowPermissionsJson: JSON.stringify([
          'access.self.read',
          'access.self.read',
        ]),
      }),
    ],
    [
      'duplicate deny permission',
      stored({
        denyPermissionsJson: JSON.stringify([
          'encounter.manage',
          'encounter.manage',
        ]),
      }),
    ],
    [
      'explicit allow and deny overlap',
      stored({
        allowPermissionsJson: JSON.stringify(['access.self.read']),
        denyPermissionsJson: JSON.stringify(['access.self.read']),
      }),
    ],
  ])('rejects %s instead of guessing access', (_label, input) => {
    expect(() => parseAccessAssignment(input)).toThrow(Error);
  });
});
