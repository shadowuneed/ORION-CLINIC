import { describe, expect, it } from 'vitest';
import {
  allowedNextDiagnosticReportStatuses,
  assertDiagnosticReportTransition,
  canCompleteServiceRequest,
  createServiceRequestSchema,
  detectDiagnosticArtifactMime,
  diagnosticArtifactObjectKey,
  diagnosticResultReviewSchema,
  nextServiceRequestStatus,
  sanitizeDiagnosticFileName,
} from './orders';

describe('service request domain', () => {
  it('requires a specialty only for referrals', () => {
    const base = {
      encounterId: 'encounter-a',
      priority: 'routine' as const,
      requestedService: 'Консультация эндокринолога',
      medicalJustification: 'Повышенный уровень глюкозы требует консультации',
      clinicianNote: null,
      testDataAcknowledged: true as const,
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    };
    expect(
      createServiceRequestSchema.safeParse({
        ...base,
        kind: 'referral',
        targetSpecialty: null,
      }).success,
    ).toBe(false);
    expect(
      createServiceRequestSchema.safeParse({
        ...base,
        kind: 'referral',
        targetSpecialty: 'Эндокринолог',
      }).success,
    ).toBe(true);
  });

  it('keeps draft creation and clinician approval separate', () => {
    expect(nextServiceRequestStatus('draft', 'approve')).toBe('active');
    expect(() => nextServiceRequestStatus('draft', 'complete')).toThrow(
      'Недопустимое изменение направления',
    );
    expect(() => nextServiceRequestStatus('completed', 'revoke')).toThrow(
      'Недопустимое изменение направления',
    );
  });

  it('requires a reconcilliation explanation', () => {
    const parsed = diagnosticResultReviewSchema.safeParse({
      decision: 'needs_reconciliation',
      note: null,
      expectedReportVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000002',
    });
    expect(parsed.success).toBe(false);
  });

  it('allows completion only after clinician review of a final result', () => {
    expect(
      canCompleteServiceRequest({ reportStatus: 'final', reviewState: 'reviewed' }),
    ).toBe(true);
    expect(
      canCompleteServiceRequest({ reportStatus: 'preliminary', reviewState: 'reviewed' }),
    ).toBe(false);
    expect(
      canCompleteServiceRequest({ reportStatus: 'final', reviewState: 'pending' }),
    ).toBe(false);
  });

  it('guards diagnostic report lifecycle and file signatures', () => {
    expect(() => assertDiagnosticReportTransition('preliminary', 'final')).not.toThrow();
    expect(() => assertDiagnosticReportTransition('final', 'registered')).toThrow();
    expect(detectDiagnosticArtifactMime(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]))).toBe(
      'application/pdf',
    );
    expect(detectDiagnosticArtifactMime(new Uint8Array([1, 2, 3]))).toBeNull();
    expect(sanitizeDiagnosticFileName('../анализ?.pdf')).toBe('.._анализ_.pdf');
  });

  it.each([
    [null, ['registered', 'preliminary', 'final']],
    ['registered', ['registered', 'preliminary', 'final']],
    ['preliminary', ['preliminary', 'final', 'corrected']],
    ['final', ['final', 'amended', 'corrected']],
    ['amended', ['amended', 'corrected']],
    ['corrected', ['amended', 'corrected']],
    ['cancelled', []],
    ['entered_in_error', []],
  ] as const)(
    'returns only attachable report transitions after %s',
    (current, expected) => {
      expect(allowedNextDiagnosticReportStatuses(current)).toEqual(expected);
    },
  );

  it('uses both content and command identity for immutable diagnostic object keys', () => {
    const base = {
      organizationId: 'org-a',
      facilityId: 'fac-a',
      sha256: 'a'.repeat(64),
      uploadIdentityHash: 'b'.repeat(64),
      mimeType: 'application/pdf' as const,
    };
    const key = diagnosticArtifactObjectKey(base);
    expect(key).toBe(
      `diagnostic-results/org-a/fac-a/${'a'.repeat(64)}/${'b'.repeat(64)}.pdf`,
    );
    expect(
      diagnosticArtifactObjectKey({ ...base, sha256: 'c'.repeat(64) }),
    ).not.toBe(key);
    expect(() =>
      diagnosticArtifactObjectKey({ ...base, sha256: '../unsafe' }),
    ).toThrow(/SHA-256/);
  });
});
