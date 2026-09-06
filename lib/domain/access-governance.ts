export const organizationRoles = [
  'doctor',
  'nurse',
  'registrar',
  'administrator',
  'medical_lead',
  'auditor',
  'service',
] as const;

export type OrganizationRole = (typeof organizationRoles)[number];

export const clinicPermissions = [
  'clinic.dashboard.read',
  'patient.directory.read',
  'patient.profile.write',
  'encounter.read',
  'encounter.manage',
  'orders.manage',
  'scheduling.manage',
  'care.manage',
  'observations.manage',
  'communications.manage',
  'access.self.read',
  'access.manage',
  'audit.read',
  'clinical_policy.review',
  'service.integration.execute',
] as const;

export type ClinicPermission = (typeof clinicPermissions)[number];

/**
 * Stable baseline grants. Resource scope, treatment relationship, record state,
 * purpose and consent remain separate authorization requirements.
 */
export const roleDefaultPermissions = {
  doctor: [
    'clinic.dashboard.read',
    'patient.directory.read',
    'patient.profile.write',
    'encounter.read',
    'encounter.manage',
    'orders.manage',
    'scheduling.manage',
    'care.manage',
    'observations.manage',
    'communications.manage',
    'access.self.read',
  ],
  nurse: [
    'clinic.dashboard.read',
    'patient.directory.read',
    'encounter.read',
    'care.manage',
    'observations.manage',
    'communications.manage',
    'access.self.read',
  ],
  registrar: [
    'clinic.dashboard.read',
    'patient.directory.read',
    'patient.profile.write',
    'scheduling.manage',
    'communications.manage',
    'access.self.read',
  ],
  administrator: ['access.self.read', 'access.manage', 'audit.read'],
  medical_lead: [
    'clinic.dashboard.read',
    'patient.directory.read',
    'encounter.read',
    'access.self.read',
    'audit.read',
    'clinical_policy.review',
  ],
  auditor: ['access.self.read', 'audit.read'],
  service: ['service.integration.execute'],
} as const satisfies Record<OrganizationRole, readonly ClinicPermission[]>;

export type StoredAccessAssignment = {
  rolesJson: string;
  allowPermissionsJson: string;
  denyPermissionsJson: string;
};

export type ParsedAccessAssignment = {
  roles: OrganizationRole[];
  allowPermissions: ClinicPermission[];
  denyPermissions: ClinicPermission[];
  effectivePermissions: ClinicPermission[];
};

const organizationRoleSet = new Set<string>(organizationRoles);
const clinicPermissionSet = new Set<string>(clinicPermissions);

function parseUniqueStringArray<T extends string>(input: {
  raw: string;
  label: string;
  allowed: ReadonlySet<string>;
  requireValue?: boolean;
}): T[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input.raw);
  } catch {
    throw new Error(`${input.label} must be valid JSON`);
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`${input.label} must be a JSON array`);
  }
  if (input.requireValue && parsed.length === 0) {
    throw new Error(`${input.label} must contain at least one value`);
  }

  const seen = new Set<string>();
  for (const value of parsed) {
    if (typeof value !== 'string' || !input.allowed.has(value)) {
      throw new Error(`${input.label} contains an unknown value`);
    }
    if (seen.has(value)) {
      throw new Error(`${input.label} contains a duplicate value`);
    }
    seen.add(value);
  }

  return parsed as T[];
}

export function deriveEffectivePermissions(
  roles: readonly OrganizationRole[],
  allowPermissions: readonly ClinicPermission[] = [],
  denyPermissions: readonly ClinicPermission[] = [],
): ClinicPermission[] {
  const granted = new Set<ClinicPermission>();
  for (const role of roles) {
    if (!organizationRoleSet.has(role)) {
      throw new Error('roles contains an unknown value');
    }
    for (const permission of roleDefaultPermissions[role]) {
      granted.add(permission);
    }
  }
  for (const permission of allowPermissions) {
    if (!clinicPermissionSet.has(permission)) {
      throw new Error('allowPermissions contains an unknown value');
    }
    granted.add(permission);
  }
  for (const permission of denyPermissions) {
    if (!clinicPermissionSet.has(permission)) {
      throw new Error('denyPermissions contains an unknown value');
    }
    granted.delete(permission);
  }

  return clinicPermissions.filter((permission) => granted.has(permission));
}

export function parseAccessAssignment(
  assignment: StoredAccessAssignment,
): ParsedAccessAssignment {
  const roles = parseUniqueStringArray<OrganizationRole>({
    raw: assignment.rolesJson,
    label: 'rolesJson',
    allowed: organizationRoleSet,
    requireValue: true,
  });
  const allowPermissions = parseUniqueStringArray<ClinicPermission>({
    raw: assignment.allowPermissionsJson,
    label: 'allowPermissionsJson',
    allowed: clinicPermissionSet,
  });
  const denyPermissions = parseUniqueStringArray<ClinicPermission>({
    raw: assignment.denyPermissionsJson,
    label: 'denyPermissionsJson',
    allowed: clinicPermissionSet,
  });

  if (roles.includes('service') && roles.length !== 1) {
    throw new Error('service cannot be combined with interactive roles');
  }

  const denied = new Set(denyPermissions);
  if (allowPermissions.some((permission) => denied.has(permission))) {
    throw new Error('allowPermissionsJson and denyPermissionsJson overlap');
  }

  return {
    roles,
    allowPermissions,
    denyPermissions,
    effectivePermissions: deriveEffectivePermissions(
      roles,
      allowPermissions,
      denyPermissions,
    ),
  };
}
