import type { PatientDirectoryRole } from './facility-access';

export const schedulingPermissions = [
  'workspace.read',
  'preference.capture',
  'appointment.hold',
  'appointment.confirm',
  'appointment.cancel',
  'appointment.expire',
  'appointment.no_show',
  'queue.issue',
  'queue.arrive',
  'queue.call',
  'queue.start_service',
  'queue.complete',
  'queue.exception',
] as const;

export type SchedulingPermission = (typeof schedulingPermissions)[number];

const schedulingPermissionMatrix: Record<
  PatientDirectoryRole,
  ReadonlySet<SchedulingPermission>
> = {
  clinician: new Set([
    'workspace.read',
    'preference.capture',
    'appointment.hold',
    'appointment.confirm',
    'appointment.cancel',
    'appointment.no_show',
    'queue.issue',
    'queue.arrive',
    'queue.call',
    'queue.start_service',
    'queue.complete',
    'queue.exception',
  ]),
  registrar: new Set([
    'workspace.read',
    'preference.capture',
    'appointment.hold',
    'appointment.confirm',
    'appointment.cancel',
    'appointment.no_show',
    'queue.issue',
    'queue.arrive',
    'queue.call',
    'queue.exception',
  ]),
};

export class SchedulingPermissionRequiredError extends Error {
  constructor(public readonly permission: SchedulingPermission) {
    super(`The ${permission} scheduling permission is required`);
    this.name = 'SchedulingPermissionRequiredError';
  }
}

export function hasSchedulingPermission(
  role: PatientDirectoryRole,
  permission: SchedulingPermission,
) {
  return schedulingPermissionMatrix[role]?.has(permission) ?? false;
}

export function requireSchedulingPermission(
  role: PatientDirectoryRole,
  permission: SchedulingPermission,
) {
  if (!hasSchedulingPermission(role, permission)) {
    throw new SchedulingPermissionRequiredError(permission);
  }
}

export function schedulingCapabilities(role: PatientDirectoryRole) {
  return Object.fromEntries(
    schedulingPermissions.map((permission) => [
      permission,
      hasSchedulingPermission(role, permission),
    ]),
  ) as Record<SchedulingPermission, boolean>;
}
