import { describe, expect, it } from 'vitest';
import type { CommunicationWorkspace, ManualContactTaskRecord, NotificationRecord } from '@/lib/repositories/patient-communications';
import {
  allowedManualActions,
  allowedNotificationActions,
  findChannelConsent,
  fromZonedLocalInput,
  toZonedLocalInput,
  unknownCommunicationOutcomeMessage,
} from './communications-workspace';

const allCapabilities = {
  'workspace.read': true,
  'consent.capture': true,
  'notification.schedule': true,
  'notification.process': true,
  'notification.cancel': true,
  'manual.start': true,
  'manual.response': true,
  'manual.complete': true,
  'manual.escalate': true,
  'manual.cancel': true,
} satisfies CommunicationWorkspace['capabilities'];

function notification(state: NotificationRecord['current']['state']): NotificationRecord {
  return {
    id: 'notification-1',
    patient: {
      id: 'patient-1',
      displayName: 'Тестовый пациент',
      medicalRecordNumber: 'SYN-001',
    },
    current: {
      id: 'notification-event-1',
      version: 1,
      state,
      purpose: 'appointment_reminder',
      channel: 'sms',
      language: 'ru',
      consentEventId: 'consent-1',
      templateVersionId: 'template-1',
      policyVersionId: 'policy-1',
      sourceType: 'appointment',
      sourceRecordId: 'appointment-1',
      sourceVersionId: 'appointment-event-1',
      requestedAt: 1,
      scheduledAt: 2,
      nextAttemptAt: 3,
      destinationHint: 'test:***01',
      renderedBody: 'Тестовое напоминание',
      contentHash: 'hash',
      attemptCount: 0,
      failureOwnerMembershipId: 'membership-1',
      failureOwner: 'Тестовый врач',
      lastFailureCode: null,
      changeReason: 'Тест',
    },
    attempts: [],
  };
}

function manualTask(state: ManualContactTaskRecord['current']['state']): ManualContactTaskRecord {
  return {
    id: 'task-1',
    notificationId: 'notification-1',
    patient: {
      id: 'patient-1',
      displayName: 'Тестовый пациент',
      medicalRecordNumber: 'SYN-001',
    },
    channel: 'voice',
    destinationHint: 'test:***01',
    current: {
      id: 'task-event-1',
      version: 1,
      state,
      assignedMembershipId: 'membership-1',
      assignedTo: 'Тестовый врач',
      dueAt: 3,
      failureReason: 'Провайдер не подключён',
      responseId: null,
      outcomeSummary: null,
      changeReason: 'Тест',
    },
  };
}

describe('communications workspace decisions', () => {
  it('selects the consent for the exact patient and channel', () => {
    const consents = [
      {
        id: 'consent-1',
        patientId: 'patient-1',
        channel: 'sms' as const,
        version: 1,
        decision: 'granted' as const,
        preferredLanguage: 'ru' as const,
        destinationHint: 'test:***01',
        destinationVerifiedAt: 1,
        noticeVersion: 'v1',
        noticeHash: 'hash',
        source: 'verbal' as const,
        effectiveAt: 1,
        capturedByMembershipId: 'membership-1',
        changeReason: 'Тест',
      },
    ];

    expect(findChannelConsent(consents, 'patient-1', 'sms')?.id).toBe('consent-1');
    expect(findChannelConsent(consents, 'patient-1', 'telegram')).toBeUndefined();
  });

  it('offers processing, manual fallback, and cancellation only for an active queue item', () => {
    expect(allowedNotificationActions(notification('scheduled'), allCapabilities)).toEqual([
      'retry_now',
      'require_manual_contact',
      'cancel',
    ]);
    expect(allowedNotificationActions(notification('delivered'), allCapabilities)).toEqual([]);
    expect(allowedNotificationActions(notification('suppressed_opt_out'), allCapabilities)).toEqual([]);
  });

  it('respects notification capabilities', () => {
    const capabilities = {
      ...allCapabilities,
      'notification.process': false,
    };

    expect(allowedNotificationActions(notification('retry_scheduled'), capabilities)).toEqual([
      'cancel',
    ]);
  });

  it('does not offer early processing or manual fallback for a future initial schedule', () => {
    const future = notification('scheduled');
    future.current.scheduledAt = 2_000;
    future.current.nextAttemptAt = 2_000;

    expect(allowedNotificationActions(future, allCapabilities, 1_000)).toEqual([
      'cancel',
    ]);
    expect(allowedNotificationActions(future, allCapabilities, 2_000)).toEqual([
      'retry_now',
      'require_manual_contact',
      'cancel',
    ]);
  });

  it('does not expose state-changing actions for a completed manual task', () => {
    expect(allowedManualActions(manualTask('open'), allCapabilities)).toEqual([
      'start',
      'record_response',
      'complete',
      'escalate',
      'cancel',
    ]);
    expect(allowedManualActions(manualTask('escalated'), allCapabilities)).toEqual([
      'complete',
      'cancel',
    ]);
    expect(allowedManualActions(manualTask('completed'), allCapabilities)).toEqual([]);
  });

  it('round-trips a facility wall-clock value independently from browser timezone', () => {
    const instant = Date.UTC(2026, 8, 9, 9, 30);
    const local = toZonedLocalInput(instant, 'Asia/Almaty');

    expect(local).toBe('2026-09-09T14:30');
    expect(fromZonedLocalInput(local, 'Asia/Almaty')).toBe(instant);
  });

  it('warns that a failed client request can still have been persisted', () => {
    expect(unknownCommunicationOutcomeMessage()).toContain('Сервер мог сохранить действие');
    expect(unknownCommunicationOutcomeMessage()).toContain('защиты от дублей');
  });
});
