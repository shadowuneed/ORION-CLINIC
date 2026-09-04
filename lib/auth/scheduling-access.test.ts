import { describe, expect, it } from 'vitest';
import {
  SchedulingPermissionRequiredError,
  hasSchedulingPermission,
  requireSchedulingPermission,
  schedulingCapabilities,
} from './scheduling-access';

describe('scheduling access', () => {
  it('gives a clinician scheduling and in-room controls', () => {
    expect(hasSchedulingPermission('clinician', 'appointment.hold')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'queue.arrive')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'queue.call')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'queue.start_service')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'queue.complete')).toBe(true);
    expect(hasSchedulingPermission('clinician', 'appointment.no_show')).toBe(true);
  });

  it('gives a registrar front-desk controls but no clinical completion', () => {
    expect(hasSchedulingPermission('registrar', 'appointment.hold')).toBe(true);
    expect(hasSchedulingPermission('registrar', 'queue.arrive')).toBe(true);
    expect(hasSchedulingPermission('registrar', 'queue.call')).toBe(true);
    expect(hasSchedulingPermission('registrar', 'appointment.no_show')).toBe(true);
    expect(hasSchedulingPermission('registrar', 'queue.complete')).toBe(false);
  });

  it('fails closed for unsupported actions', () => {
    expect(() =>
      requireSchedulingPermission('registrar', 'queue.start_service'),
    ).toThrow(SchedulingPermissionRequiredError);
    expect(schedulingCapabilities('registrar')['queue.start_service']).toBe(false);
  });

  it('reserves hold expiry for a trusted process instead of an interactive role', () => {
    expect(hasSchedulingPermission('clinician', 'appointment.expire')).toBe(false);
    expect(hasSchedulingPermission('registrar', 'appointment.expire')).toBe(false);
  });
});
