import { describe, expect, it } from 'vitest';
import {
  assertNotificationTransition,
  isQuietMinute,
  manualContactCommandSchema,
  nextManualContactState,
  recordChannelConsentSchema,
  renderApprovedTemplate,
  resolveCommunicationWindow,
} from './patient-communications';

describe('patient communications domain', () => {
  it('requires a verified synthetic destination for a granted channel', () => {
    const base = {
      patientId: 'patient-a',
      channel: 'sms' as const,
      decision: 'granted' as const,
      preferredLanguage: 'ru' as const,
      source: 'verbal' as const,
      expectedVersion: null,
      noticeVersion: 'local-v1',
      noticeHash: 'a'.repeat(64),
      reason: 'Пациент выбрал канал',
      syntheticDataAcknowledged: true as const,
      idempotencyKey: '00000000-0000-4000-8000-000000000701',
    };
    expect(
      recordChannelConsentSchema.safeParse({
        ...base,
        destinationRef: 'real-phone',
        destinationHint: '+7 *** ** 01',
        destinationVerified: true,
      }).success,
    ).toBe(false);
    expect(
      recordChannelConsentSchema.safeParse({
        ...base,
        destinationRef: 'test:sms:patient-a',
        destinationHint: 'Тестовый канал · SMS',
        destinationVerified: true,
      }).success,
    ).toBe(true);
    expect(
      recordChannelConsentSchema.safeParse({
        ...base,
        destinationRef: 'test:sms:patient-a',
        destinationHint: '+7 700 000 00 01',
        destinationVerified: true,
      }).success,
    ).toBe(false);
  });

  it('handles overnight quiet hours and resolves the next allowed minute', () => {
    expect(isQuietMinute(22 * 60, 21 * 60, 8 * 60)).toBe(true);
    expect(isQuietMinute(7 * 60 + 59, 21 * 60, 8 * 60)).toBe(true);
    expect(isQuietMinute(8 * 60, 21 * 60, 8 * 60)).toBe(false);
    expect(isQuietMinute(14 * 60, 21 * 60, 8 * 60)).toBe(false);

    const requestedAt = Date.parse('2026-09-05T22:17:34.000Z');
    const result = resolveCommunicationWindow({
      requestedAt,
      timeZone: 'UTC',
      quietStartMinute: 21 * 60,
      quietEndMinute: 8 * 60,
    });
    expect(result.deferred).toBe(true);
    expect(new Date(result.nextAttemptAt).toISOString()).toBe(
      '2026-09-06T08:00:00.000Z',
    );
  });

  it('does not allow a failed local provider check to become a delivery claim', () => {
    expect(() =>
      assertNotificationTransition('scheduled', 'retry_scheduled'),
    ).not.toThrow();
    expect(() =>
      assertNotificationTransition('manual_contact_required', 'delivered'),
    ).toThrow(/Недопустимое изменение/);
    expect(() =>
      assertNotificationTransition('suppressed_opt_out', 'retry_scheduled'),
    ).toThrow(/Недопустимое изменение/);
  });

  it('requires a complete manually recorded patient response', () => {
    const parsed = manualContactCommandSchema.safeParse({
      action: 'record_response',
      expectedVersion: 1,
      reason: 'Ответ получен при ручном звонке',
      responseKind: 'confirmed',
      responseLanguage: null,
      responseSummary: 'Пациент подтвердил запись',
      idempotencyKey: '00000000-0000-4000-8000-000000000702',
    });
    expect(parsed.success).toBe(false);
    expect(nextManualContactState('open', 'record_response')).toBe('in_progress');
  });

  it('renders only allowlisted fields from the approved template', () => {
    expect(
      renderApprovedTemplate(
        'Запись в {{facilityName}}: {{appointmentDate}} {{appointmentTime}}.',
        ['facilityName', 'appointmentDate', 'appointmentTime'],
        {
          facilityName: 'ORION Clinic',
          appointmentDate: '06.09.2026',
          appointmentTime: '10:30',
        },
      ),
    ).toBe('Запись в ORION Clinic: 06.09.2026 10:30.');
    expect(() =>
      renderApprovedTemplate(
        'Диагноз: {{diagnosis}}',
        ['facilityName'],
        { diagnosis: 'не должен попасть' },
      ),
    ).toThrow(/недоступное поле/);
  });
});
