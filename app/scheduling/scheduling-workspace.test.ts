import { describe, expect, it } from 'vitest';
import { createElement, type ComponentProps } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { schedulingCapabilities } from '@/lib/auth/scheduling-access';
import type { SchedulingAppointmentRecord, SchedulingQueueTicketRecord } from '@/lib/repositories/scheduling-workflow';
import {
  buildActiveQueueBoard,
  buildSchedulingAccessQuery,
  buildSchedulingOperationKey,
  isExpiredSchedulingHold,
  nextQueueAction,
  QueuePanel,
  unknownSchedulingOutcomeMessage,
} from './scheduling-workspace';

describe('scheduling workspace queue flow', () => {
  it('shows only current authorized tickets in date and number order', () => {
    const appointment = (id: string, referral: string, patient: string, status: SchedulingAppointmentRecord['current']['status'] = 'confirmed'): SchedulingAppointmentRecord => ({
      id, serviceRequestId: referral,
      patient: { id: patient, displayName: patient, medicalRecordNumber: patient },
      slot: { id: `slot-${id}`, providerId: 'provider', providerName: 'Doctor',
        serviceId: 'service', serviceName: 'Consultation', specialtyId: 'specialty',
        specialtyName: 'Medicine', startsAt: 1_800_000_000_000, endsAt: 1_800_000_180_000 },
      current: { id: `version-${id}`, version: 1, status, slotVersion: 1,
        preferenceSnapshotId: 'preference', serviceRequestVersionId: 'request-version',
        holdExpiresAt: null, confirmedAt: 1_799_999_000_000, changeReason: 'test' },
    });
    const ticket = (id: string, appointmentId: string, patient: string, day: string, sequence: number, status: SchedulingQueueTicketRecord['current']['status'] = 'issued'): SchedulingQueueTicketRecord => ({
      id, appointmentId, patient: { id: patient, displayName: patient, medicalRecordNumber: patient },
      serviceDate: day, sequence, displayNumber: `A${sequence}`,
      current: { id: `version-${id}`, version: 1, status, roomLabel: null,
        exceptionCode: null, exceptionNote: null, changeReason: 'test' },
    });
    const appointments = [
      appointment('allowed-1', 'referral-a', 'patient-a'),
      appointment('allowed-2', 'referral-a', 'patient-b'),
      appointment('other-scope', 'referral-b', 'patient-c'),
      appointment('unconfirmed', 'referral-a', 'patient-d', 'held'),
    ];
    const tickets = [
      ticket('later', 'allowed-1', 'patient-a', '2026-10-02', 2),
      ticket('cross-scope', 'other-scope', 'patient-c', '2026-10-01', 1),
      ticket('wrong-patient', 'allowed-1', 'patient-c', '2026-10-01', 1),
      ticket('unconfirmed', 'unconfirmed', 'patient-d', '2026-10-01', 1),
      ticket('finished', 'allowed-1', 'patient-a', '2026-10-01', 1, 'completed'),
      ticket('first', 'allowed-2', 'patient-b', '2026-10-02', 1, 'arrived'),
    ];
    expect(buildActiveQueueBoard(tickets, appointments, ['referral-a']).map(({ ticket: item }) => item.id))
      .toEqual(['first', 'later']);
  });
  it.each([false, true])('gates both queue buttons on test acknowledgement=%s', (acknowledged) => {
    const props: ComponentProps<typeof QueuePanel> = {
      busy: false, testDataAcknowledged: acknowledged,
      capabilities: schedulingCapabilities('registrar'),
      ticket: { id: 'ticket-test', appointmentId: 'appointment-test', sequence: 1,
        displayNumber: 'A001', serviceDate: '2026-09-15',
        patient: { id: 'patient-test', medicalRecordNumber: 'TEST', displayName: 'Artificial patient' },
        current: { id: 'version-test', status: 'issued', version: 1, roomLabel: null,
          exceptionCode: null, exceptionNote: null, changeReason: 'Artificial test' } },
      queueReason: 'Artificial check', roomLabel: 'Test room', exceptionCode: 'TEST',
      exceptionNote: 'Artificial exception', onAction() {}, setExceptionCode() {},
      setExceptionNote() {}, setQueueReason() {}, setRoomLabel() {},
    };
    const html = renderToStaticMarkup(createElement(QueuePanel, props));
    const buttons = [...html.matchAll(/<button\b[^>]*>/g)].map(match => match[0]);
    expect(buttons).toHaveLength(2);
    for (const button of buttons) expect(button.includes('disabled')).toBe(!acknowledged);
  });
  it('keeps the exact access assignment in reads and idempotency scope', () => {
    const query = new URLSearchParams(
      buildSchedulingAccessQuery({
        accessAssignmentId: 'assignment-a',
        facilityId: 'facility-a',
      }),
    );
    expect(query.get('accessAssignmentId')).toBe('assignment-a');
    expect(query.get('facilityId')).toBe('facility-a');
    expect(buildSchedulingOperationKey('assignment-a', 'queue:call')).toBe(
      'assignment-a:queue:call',
    );
  });

  it('keeps the deterministic queue transition sequence', () => {
    expect(nextQueueAction('issued')).toBe('arrive');
    expect(nextQueueAction('arrived')).toBe('call');
    expect(nextQueueAction('called')).toBe('start_service');
    expect(nextQueueAction('in_service')).toBe('complete');
    expect(nextQueueAction('completed')).toBeNull();
    expect(nextQueueAction('cancelled')).toBeNull();
    expect(nextQueueAction('exception')).toBeNull();
  });

  it('does not claim failure when a network outcome is unknown', () => {
    const message = unknownSchedulingOutcomeMessage();
    expect(message).toContain('Сервер мог сохранить действие');
    expect(message).toContain('тот же ключ защиты от дублей');
  });

  it('shows an expired hold as requiring manual release', () => {
    expect(
      isExpiredSchedulingHold(
        { status: 'held', holdExpiresAt: 10_000 },
        10_000,
      ),
    ).toBe(true);
    expect(
      isExpiredSchedulingHold(
        { status: 'held', holdExpiresAt: 10_001 },
        10_000,
      ),
    ).toBe(false);
    expect(
      isExpiredSchedulingHold(
        { status: 'confirmed', holdExpiresAt: null },
        10_000,
      ),
    ).toBe(false);
  });
});
