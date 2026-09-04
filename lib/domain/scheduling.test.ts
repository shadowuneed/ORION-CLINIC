import { describe, expect, it } from 'vitest';
import {
  SCHEDULING_HOLD_TTL_MS,
  SCHEDULING_CONFIRMATION_STATEMENT_VERSION,
  SYNTHETIC_SCHEDULE_SOURCE_LABEL,
  assertQueueTicketCanBeIssued,
  assertReferralEligibleForScheduling,
  assertSchedulingAppointmentTransition,
  assertSchedulingQueueTransition,
  assertSchedulingSlotTransition,
  confirmSchedulingAppointmentSchema,
  createSchedulingPreferenceSchema,
  holdSchedulingSlotSchema,
  hashSchedulingConfirmationStatement,
  issueSchedulingQueueTicketSchema,
  nextSchedulingAppointmentStatus,
  nextSchedulingQueueStatus,
  preferredTimeRangeSchema,
  schedulingAppointmentCommandSchema,
  schedulingHoldExpiresAt,
  schedulingConfirmationStatement,
  schedulingListQuerySchema,
  schedulingQueueCommandSchema,
  schedulingSourceKinds,
} from './scheduling';

const uuid = (suffix: number) =>
  `00000000-0000-4000-8000-${String(suffix).padStart(12, '0')}`;

describe('scheduling domain', () => {
  it('exposes only a visibly manual test source', () => {
    expect(schedulingSourceKinds).toEqual(['manual_test']);
    expect(SYNTHETIC_SCHEDULE_SOURCE_LABEL).toBe(
      'Тестовое ручное расписание · не КМИС',
    );
  });

  it('validates list and patient preference ranges', () => {
    expect(
      schedulingListQuerySchema.parse({
        dateFrom: '2026-09-10',
        dateTo: '2026-09-17',
        slotStatus: 'available',
        limit: '25',
      }),
    ).toMatchObject({ slotStatus: 'available', limit: 25 });
    expect(
      schedulingListQuerySchema.safeParse({
        dateFrom: '2026-09-18',
        dateTo: '2026-09-17',
      }).success,
    ).toBe(false);
    expect(
      schedulingListQuerySchema.safeParse({ dateFrom: '2026-02-30' }).success,
    ).toBe(false);
    expect(
      preferredTimeRangeSchema.safeParse({
        earliestLocalTime: '09:00',
        latestLocalTime: '12:00',
      }).success,
    ).toBe(true);
    expect(
      preferredTimeRangeSchema.safeParse({
        earliestLocalTime: '12:00',
        latestLocalTime: '09:00',
      }).success,
    ).toBe(false);

    const preference = {
      serviceRequestId: 'referral-a',
      serviceRequestVersionId: 'referral-version-a',
      preferredDateFrom: '2026-09-10',
      preferredDateTo: '2026-09-17',
      earliestLocalTime: '09:00',
      latestLocalTime: '12:00',
      preferredProviderId: null,
      notes: 'Пациент предпочитает первую половину дня',
      noticeLanguage: 'ru' as const,
      testDataAcknowledged: true as const,
      idempotencyKey: uuid(1),
    };
    expect(createSchedulingPreferenceSchema.safeParse(preference).success).toBe(true);
    expect(
      createSchedulingPreferenceSchema.safeParse({
        ...preference,
        testDataAcknowledged: false,
      }).success,
    ).toBe(false);
  });

  it('requires an active referral with explicit doctor approval', () => {
    expect(() =>
      assertReferralEligibleForScheduling({
        requestKind: 'referral',
        status: 'active',
        approvedByMembershipId: 'membership-a',
        approvedAt: Date.now(),
      }),
    ).not.toThrow();
    for (const invalid of [
      {
        requestKind: 'service',
        status: 'active',
        approvedByMembershipId: 'membership-a',
        approvedAt: Date.now(),
      },
      {
        requestKind: 'referral',
        status: 'draft',
        approvedByMembershipId: 'membership-a',
        approvedAt: Date.now(),
      },
      {
        requestKind: 'referral',
        status: 'active',
        approvedByMembershipId: null,
        approvedAt: null,
      },
    ]) {
      expect(() => assertReferralEligibleForScheduling(invalid)).toThrow(
        /подтверждённое направление/,
      );
    }
  });

  it('enforces slot, appointment and queue transition graphs', () => {
    expect(() => assertSchedulingSlotTransition('available', 'held')).not.toThrow();
    expect(() => assertSchedulingSlotTransition('held', 'booked')).not.toThrow();
    expect(() => assertSchedulingSlotTransition('booked', 'available')).not.toThrow();
    expect(() => assertSchedulingSlotTransition('available', 'booked')).toThrow();
    expect(() => assertSchedulingSlotTransition('withdrawn', 'available')).toThrow();

    expect(nextSchedulingAppointmentStatus('held', 'cancel')).toBe('cancelled');
    expect(nextSchedulingAppointmentStatus('held', 'expire_hold')).toBe('expired');
    expect(nextSchedulingAppointmentStatus('confirmed', 'mark_no_show')).toBe('no_show');
    expect(() => assertSchedulingAppointmentTransition('held', 'completed')).toThrow();
    expect(() => nextSchedulingAppointmentStatus('completed', 'cancel')).toThrow();

    expect(nextSchedulingQueueStatus('issued', 'arrive')).toBe('arrived');
    expect(nextSchedulingQueueStatus('arrived', 'call')).toBe('called');
    expect(nextSchedulingQueueStatus('called', 'start_service')).toBe('in_service');
    expect(nextSchedulingQueueStatus('in_service', 'complete')).toBe('completed');
    expect(() => assertSchedulingQueueTransition('issued', 'called')).toThrow();
  });

  it('requires exact versions, synthetic acknowledgement and patient confirmation', () => {
    expect(
      holdSchedulingSlotSchema.safeParse({
        serviceRequestId: 'referral-a',
        slotId: 'slot-a',
        preferenceSnapshotId: 'preference-a',
        expectedSlotVersion: 1,
        testDataAcknowledged: true,
        idempotencyKey: uuid(2),
      }).success,
    ).toBe(true);

    const confirmation = {
      expectedAppointmentVersion: 1,
      expectedSlotVersion: 2,
      confirmation: {
        subject: 'patient' as const,
        method: 'verbal_in_person' as const,
        language: 'ru' as const,
        statementVersion: 'synthetic-v1',
        statementHash: 'a'.repeat(64),
        acknowledged: true as const,
      },
      reason: 'Пациент лично подтвердил выбранное время',
      idempotencyKey: uuid(3),
    };
    expect(confirmSchedulingAppointmentSchema.safeParse(confirmation).success).toBe(true);
    expect(
      confirmSchedulingAppointmentSchema.safeParse({
        ...confirmation,
        confirmation: { ...confirmation.confirmation, acknowledged: false },
      }).success,
    ).toBe(false);

    expect(
      schedulingAppointmentCommandSchema.safeParse({
        action: 'cancel',
        expectedAppointmentVersion: 2,
        expectedSlotVersion: 3,
        reason: 'Пациент попросил отменить запись',
        idempotencyKey: uuid(4),
      }).success,
    ).toBe(true);
    expect(
      issueSchedulingQueueTicketSchema.safeParse({
        appointmentId: 'appointment-a',
        expectedAppointmentVersion: 2,
        testDataAcknowledged: true,
        idempotencyKey: uuid(5),
      }).success,
    ).toBe(true);
  });

  it('validates operational context for queue commands', () => {
    const base = {
      expectedQueueVersion: 1,
      reason: 'Операционное действие сотрудника',
      idempotencyKey: uuid(6),
    };
    expect(
      schedulingQueueCommandSchema.safeParse({
        ...base,
        action: 'call',
        roomLabel: null,
      }).success,
    ).toBe(false);
    expect(
      schedulingQueueCommandSchema.safeParse({
        ...base,
        action: 'call',
        roomLabel: 'Кабинет 204',
      }).success,
    ).toBe(true);
    expect(
      schedulingQueueCommandSchema.safeParse({
        ...base,
        action: 'mark_exception',
        exceptionCode: 'PATIENT_UNWELL',
        exceptionNote: 'Пациенту требуется дополнительная оценка врача',
      }).success,
    ).toBe(true);
    expect(
      schedulingQueueCommandSchema.safeParse({
        ...base,
        action: 'arrive',
        exceptionCode: 'UNEXPECTED',
      }).success,
    ).toBe(false);
    expect(
      schedulingQueueCommandSchema.safeParse({
        ...base,
        action: 'complete',
      }).success,
    ).toBe(false);
  });

  it('uses a server-owned fixed hold TTL and gates queue issue', () => {
    expect(schedulingHoldExpiresAt(1_000)).toBe(1_000 + SCHEDULING_HOLD_TTL_MS);
    expect(() => assertQueueTicketCanBeIssued('confirmed')).not.toThrow();
    expect(() => assertQueueTicketCanBeIssued('held')).toThrow(/подтверждённой/);
  });

  it('canonicalizes and hashes the exact patient confirmation context', async () => {
    const input = {
      appointmentId: 'appointment-a',
      slotId: 'slot-a',
      startsAt: 1_800_000_000_000,
      endsAt: 1_800_001_800_000,
      subject: 'patient' as const,
      method: 'verbal_in_person' as const,
      language: 'ru' as const,
    };
    expect(schedulingConfirmationStatement(input)).toBe(
      JSON.stringify({
        version: SCHEDULING_CONFIRMATION_STATEMENT_VERSION,
        ...input,
      }),
    );
    await expect(hashSchedulingConfirmationStatement(input)).resolves.toMatch(
      /^[a-f0-9]{64}$/,
    );
    await expect(
      hashSchedulingConfirmationStatement({ ...input, language: 'kk' }),
    ).resolves.not.toBe(await hashSchedulingConfirmationStatement(input));
  });
});
