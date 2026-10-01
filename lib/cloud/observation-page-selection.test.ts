import { describe, expect, it } from 'vitest';
import { cloudObservationPageReturnTo, cloudObservationPageSelection } from './observation-page-selection';

describe('cloud observation page selectors', () => {
  it('retains a single exact selected patient and operating assignment', () => {
    const scope = { facilityId: 'fac-a', accessAssignmentId: 'assignment-a', patientId: 'patient-a' };
    expect(cloudObservationPageSelection(scope)).toEqual(scope);
    expect(cloudObservationPageSelection({})).toEqual({ facilityId: undefined, accessAssignmentId: undefined, patientId: undefined });
  });
  it.each(['facilityId', 'accessAssignmentId', 'patientId'] as const)('rejects ambiguous/empty/unsafe explicit %s', key => {
    for (const value of [['same'], ['a', 'b'], '', ' ', 'a/b', 'a?b', 'a%2fb', 'x'.repeat(181)]) {
      expect(() => cloudObservationPageSelection({ [key]: value })).toThrow();
    }
  });
  it('does not silently discard an unported care task', () => {
    expect(() => cloudObservationPageSelection({ patientId: 'patient-a', careTaskId: 'task-a' })).toThrow();
  });
  it('preserves duplicate/invalid scope through sign-in instead of granting another selection', () => {
    const target = new URL(cloudObservationPageReturnTo({ patientId: ['a', 'b'], facilityId: '', careTaskId: 'task-a' }), 'https://example.invalid');
    expect(target.pathname).toBe('/observations');
    expect(target.searchParams.getAll('patientId')).toEqual(['a', 'b']);
    expect(target.searchParams.get('facilityId')).toBe('');
    expect(target.searchParams.get('careTaskId')).toBe('task-a');
  });
});
