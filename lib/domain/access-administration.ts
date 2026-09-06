import { z } from 'zod';
import {
  clinicPermissions,
  organizationRoles,
  parseAccessAssignment,
  type ClinicPermission,
  type OrganizationRole,
} from './access-governance';

export const departmentKinds = [
  'clinical',
  'diagnostic',
  'administrative',
  'support',
] as const;

export type DepartmentKind = (typeof departmentKinds)[number];
export type DepartmentStatus = 'active' | 'disabled';

const scopedCommand = {
  facilityId: z.string().trim().min(1).max(128),
  actorAssignmentId: z.string().trim().min(1).max(160),
  idempotencyKey: z.string().uuid(),
};

const changeReason = z.string().trim().min(3).max(500);
const departmentName = z.string().trim().min(2).max(160);

export const accessAdministrationQuerySchema = z.object({
  facilityId: z.string().trim().min(1).max(128).optional(),
  actorAssignmentId: z.string().trim().min(1).max(160).optional(),
});

export const createDepartmentSchema = z.object({
  ...scopedCommand,
  code: z
    .string()
    .trim()
    .min(2)
    .max(40)
    .regex(/^[a-z0-9_-]+$/),
  name: departmentName,
  kind: z.enum(departmentKinds),
  changeReason,
});

export const updateDepartmentSchema = z.object({
  ...scopedCommand,
  expectedVersion: z.number().int().positive(),
  name: departmentName,
  kind: z.enum(departmentKinds),
  status: z.enum(['active', 'disabled']),
  changeReason,
});

const accessRules = {
  roles: z.array(z.enum(organizationRoles)).min(1).max(organizationRoles.length),
  allowPermissions: z.array(z.enum(clinicPermissions)).max(clinicPermissions.length),
  denyPermissions: z.array(z.enum(clinicPermissions)).max(clinicPermissions.length),
};

function validateRules(
  input: {
    roles: OrganizationRole[];
    allowPermissions: ClinicPermission[];
    denyPermissions: ClinicPermission[];
    effectiveFrom: number;
    effectiveUntil: number | null;
  },
  context: z.RefinementCtx,
) {
  if (input.effectiveUntil !== null && input.effectiveUntil <= input.effectiveFrom) {
    context.addIssue({
      code: 'custom',
      path: ['effectiveUntil'],
      message: 'effectiveUntil must be later than effectiveFrom',
    });
  }
  try {
    parseAccessAssignment({
      rolesJson: JSON.stringify(input.roles),
      allowPermissionsJson: JSON.stringify(input.allowPermissions),
      denyPermissionsJson: JSON.stringify(input.denyPermissions),
    });
  } catch (error) {
    context.addIssue({
      code: 'custom',
      path: ['roles'],
      message: error instanceof Error ? error.message : 'Invalid access rules',
    });
  }
}

export const grantAccessAssignmentSchema = z
  .object({
    ...scopedCommand,
    departmentId: z.string().trim().min(1).max(160),
    membershipId: z.string().trim().min(1).max(160),
    ...accessRules,
    effectiveFrom: z.number().int().nonnegative(),
    effectiveUntil: z.number().int().positive().nullable(),
    changeReason,
  })
  .superRefine(validateRules);

export const updateAccessAssignmentSchema = z
  .object({
    ...scopedCommand,
    expectedVersion: z.number().int().positive(),
    status: z.enum(['active', 'revoked']),
    ...accessRules,
    effectiveFrom: z.number().int().nonnegative(),
    effectiveUntil: z.number().int().positive().nullable(),
    changeReason,
  })
  .superRefine(validateRules);

export type CreateDepartmentCommand = z.infer<typeof createDepartmentSchema>;
export type UpdateDepartmentCommand = z.infer<typeof updateDepartmentSchema> & {
  departmentId: string;
};
export type GrantAccessAssignmentCommand = z.infer<
  typeof grantAccessAssignmentSchema
>;
export type UpdateAccessAssignmentCommand = z.infer<
  typeof updateAccessAssignmentSchema
> & { assignmentId: string };

export function serializeAccessRules(input: {
  roles: OrganizationRole[];
  allowPermissions: ClinicPermission[];
  denyPermissions: ClinicPermission[];
}) {
  const parsed = parseAccessAssignment({
    rolesJson: JSON.stringify(input.roles),
    allowPermissionsJson: JSON.stringify(input.allowPermissions),
    denyPermissionsJson: JSON.stringify(input.denyPermissions),
  });
  return {
    rolesJson: JSON.stringify(parsed.roles),
    allowPermissionsJson: JSON.stringify(parsed.allowPermissions),
    denyPermissionsJson: JSON.stringify(parsed.denyPermissions),
    effectivePermissions: parsed.effectivePermissions,
  };
}
