import { describe, expect, it } from 'vitest';
import {
  assertConsentDecisionTransition,
  canRecordConsentDecision,
  isConsentEffective,
} from './consent';

describe('consent decision lineage', () => {
  it('allows an initial grant or denial but not an initial withdrawal', () => {
    expect(canRecordConsentDecision(null, 'granted')).toBe(true);
    expect(canRecordConsentDecision(null, 'denied')).toBe(true);
    expect(canRecordConsentDecision(null, 'withdrawn')).toBe(false);
  });

  it('allows withdrawal only from a current grant', () => {
    expect(canRecordConsentDecision('granted', 'withdrawn')).toBe(true);
    expect(canRecordConsentDecision('denied', 'withdrawn')).toBe(false);
    expect(canRecordConsentDecision('withdrawn', 'withdrawn')).toBe(false);
    expect(() =>
      assertConsentDecisionTransition('denied', 'withdrawn'),
    ).toThrow('Недопустимое изменение согласия');
  });
});

describe('effective consent', () => {
  it('requires a current grant inside its effective window', () => {
    expect(
      isConsentEffective(
        { decision: 'granted', effectiveAt: 100, expiresAt: 300 },
        200,
      ),
    ).toBe(true);
    expect(
      isConsentEffective(
        { decision: 'granted', effectiveAt: 201, expiresAt: null },
        200,
      ),
    ).toBe(false);
    expect(
      isConsentEffective(
        { decision: 'granted', effectiveAt: 100, expiresAt: 200 },
        200,
      ),
    ).toBe(false);
    expect(
      isConsentEffective(
        { decision: 'withdrawn', effectiveAt: 100, expiresAt: null },
        200,
      ),
    ).toBe(false);
  });
});
