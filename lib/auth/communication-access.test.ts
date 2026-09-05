import { describe, expect, it } from 'vitest';
import {
  assertCommunicationSourceAllowed,
  CommunicationPermissionRequiredError,
  hasCommunicationPermission,
} from './communication-access';

describe('communication access', () => {
  it('separates appointment and care-plan scheduling by operational role', () => {
    expect(() =>
      assertCommunicationSourceAllowed('registrar', 'appointment'),
    ).not.toThrow();
    expect(() =>
      assertCommunicationSourceAllowed('nurse', 'care_plan_task'),
    ).not.toThrow();
    expect(() =>
      assertCommunicationSourceAllowed('registrar', 'care_plan_task'),
    ).toThrow(CommunicationPermissionRequiredError);
    expect(() =>
      assertCommunicationSourceAllowed('nurse', 'appointment'),
    ).toThrow(CommunicationPermissionRequiredError);
  });

  it('keeps cancellation authority away from nurse fallback work', () => {
    expect(hasCommunicationPermission('nurse', 'notification.cancel')).toBe(false);
    expect(hasCommunicationPermission('clinician', 'notification.cancel')).toBe(true);
    expect(hasCommunicationPermission('registrar', 'notification.cancel')).toBe(true);
  });
});
