import { z } from 'zod';

const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const nullableText = (minimum: number, maximum: number) =>
  z.union([cleanText(minimum, maximum), z.null()]);

const id = z.string().trim().min(1).max(180);

export const communicationChannels = [
  'whatsapp',
  'telegram',
  'sms',
  'voice',
] as const;
export const communicationLanguages = ['ru', 'kk'] as const;
export const communicationPurposes = [
  'appointment_reminder',
  'care_plan_reminder',
] as const;
export const communicationSourceTypes = ['appointment', 'care_plan_task'] as const;
export const channelConsentDecisions = ['granted', 'denied', 'withdrawn'] as const;
export const notificationStates = [
  'scheduled',
  'deferred_quiet_hours',
  'retry_scheduled',
  'delivered',
  'provider_unavailable',
  'manual_contact_required',
  'patient_replied',
  'manual_contact_completed',
  'suppressed_opt_out',
  'cancelled_source',
  'cancelled_by_staff',
] as const;
export const deliveryOutcomes = [
  'delivered',
  'provider_unavailable',
  'suppressed_opt_out',
  'cancelled_source',
  'deferred_quiet_hours',
] as const;
export const manualContactStates = [
  'open',
  'in_progress',
  'completed',
  'escalated',
  'cancelled',
] as const;
export const patientResponseKinds = [
  'confirmed',
  'declined',
  'question',
  'callback_requested',
  'other',
] as const;

export type CommunicationChannel = (typeof communicationChannels)[number];
export type CommunicationLanguage = (typeof communicationLanguages)[number];

const syntheticChannelLabels: Record<CommunicationChannel, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  sms: 'SMS',
  voice: 'телефонный звонок',
};

export function syntheticDestinationRef(
  channel: CommunicationChannel,
  patientId: string,
) {
  return `test:${channel}:${patientId}`;
}

export function syntheticDestinationHint(channel: CommunicationChannel) {
  return `Тестовый канал · ${syntheticChannelLabels[channel]}`;
}
export type CommunicationPurpose = (typeof communicationPurposes)[number];
export type CommunicationSourceType = (typeof communicationSourceTypes)[number];
export type ChannelConsentDecision = (typeof channelConsentDecisions)[number];
export type NotificationState = (typeof notificationStates)[number];
export type DeliveryOutcome = (typeof deliveryOutcomes)[number];
export type ManualContactState = (typeof manualContactStates)[number];
export type PatientResponseKind = (typeof patientResponseKinds)[number];

export const LOCAL_COMMUNICATION_SOURCE_LABEL =
  'Локальная тестовая очередь · провайдеры не подключены';
export const LOCAL_COMMUNICATION_POLICY_CODE = 'ORION_LOCAL_COMMS_V1';

export const communicationListQuerySchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    patientId: id.optional(),
    state: z.enum([...notificationStates, 'all']).default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const recordChannelConsentSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    patientId: id,
    channel: z.enum(communicationChannels),
    decision: z.enum(channelConsentDecisions),
    preferredLanguage: z.enum(communicationLanguages),
    destinationRef: nullableText(3, 240),
    destinationHint: nullableText(2, 120),
    destinationVerified: z.boolean(),
    source: z.enum(['written', 'verbal', 'digital']),
    expectedVersion: z.union([z.number().int().positive(), z.null()]),
    noticeVersion: cleanText(2, 80),
    noticeHash: z.string().regex(/^[a-f0-9]{64}$/),
    reason: cleanText(3, 500),
    syntheticDataAcknowledged: z.literal(true),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.decision === 'granted') {
      if (
        value.destinationRef !== syntheticDestinationRef(value.channel, value.patientId)
      ) {
        context.addIssue({
          code: 'custom',
          path: ['destinationRef'],
          message: 'В локальном контуре допустим только системный test:-алиас пациента',
        });
      }
      if (value.destinationHint !== syntheticDestinationHint(value.channel)) {
        context.addIssue({
          code: 'custom',
          path: ['destinationHint'],
          message: 'Реальный номер или адрес нельзя сохранять в синтетическом контуре',
        });
      }
      if (!value.destinationVerified) {
        context.addIssue({
          code: 'custom',
          path: ['destinationVerified'],
          message: 'Назначение должно быть проверено сотрудником',
        });
      }
    }
    if (value.decision !== 'granted' && value.destinationVerified) {
      context.addIssue({
        code: 'custom',
        path: ['destinationVerified'],
        message: 'Проверка назначения применяется только к разрешённому каналу',
      });
    }
    if (value.decision === 'withdrawn' && value.expectedVersion === null) {
      context.addIssue({
        code: 'custom',
        path: ['expectedVersion'],
        message: 'Нельзя отозвать ещё не существующее согласие',
      });
    }
  });

export const scheduleNotificationSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    sourceType: z.enum(communicationSourceTypes),
    sourceRecordId: id,
    sourceVersionId: id,
    channel: z.enum(communicationChannels),
    language: z.enum(communicationLanguages),
    scheduledAt: z.number().int().positive(),
    reason: cleanText(3, 500),
    syntheticDataAcknowledged: z.literal(true),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const processNotificationSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    action: z.enum(['process_due', 'retry_now', 'cancel', 'require_manual_contact']),
    expectedVersion: z.number().int().positive(),
    reason: cleanText(3, 500),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const manualContactCommandSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    action: z.enum(['start', 'record_response', 'complete', 'escalate', 'cancel']),
    expectedVersion: z.number().int().positive(),
    reason: cleanText(3, 500),
    responseKind: z.enum(patientResponseKinds).nullable().optional().default(null),
    responseLanguage: z.enum(communicationLanguages).nullable().optional().default(null),
    responseSummary: nullableText(3, 2_000).optional().default(null),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    const responseFields = [
      value.responseKind,
      value.responseLanguage,
      value.responseSummary,
    ];
    if (value.action === 'record_response') {
      if (responseFields.some((field) => field === null)) {
        context.addIssue({
          code: 'custom',
          path: ['responseSummary'],
          message: 'Для ответа укажите тип, язык и содержание',
        });
      }
    } else if (responseFields.some((field) => field !== null)) {
      context.addIssue({
        code: 'custom',
        path: ['responseSummary'],
        message: 'Поля ответа допустимы только для record_response',
      });
    }
  });

export function purposeForSource(sourceType: CommunicationSourceType): CommunicationPurpose {
  return sourceType === 'appointment'
    ? 'appointment_reminder'
    : 'care_plan_reminder';
}

export function isQuietMinute(minute: number, startMinute: number, endMinute: number) {
  if (startMinute === endMinute) return false;
  if (startMinute < endMinute) {
    return minute >= startMinute && minute < endMinute;
  }
  return minute >= startMinute || minute < endMinute;
}

export function localMinuteOfDay(timestamp: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(
    parts
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, Number(part.value)]),
  );
  return (values.hour ?? 0) * 60 + (values.minute ?? 0);
}

export function resolveCommunicationWindow(input: {
  requestedAt: number;
  timeZone: string;
  quietStartMinute: number;
  quietEndMinute: number;
}) {
  const currentMinute = localMinuteOfDay(input.requestedAt, input.timeZone);
  if (!isQuietMinute(currentMinute, input.quietStartMinute, input.quietEndMinute)) {
    return { deferred: false, nextAttemptAt: input.requestedAt } as const;
  }

  const rounded = input.requestedAt - (input.requestedAt % 60_000);
  for (let minutes = 1; minutes <= 24 * 60 + 1; minutes += 1) {
    const candidate = rounded + minutes * 60_000;
    const minute = localMinuteOfDay(candidate, input.timeZone);
    if (!isQuietMinute(minute, input.quietStartMinute, input.quietEndMinute)) {
      return { deferred: true, nextAttemptAt: candidate } as const;
    }
  }
  throw new Error('Не удалось вычислить окончание тихих часов');
}

const allowedNotificationTransitions: Record<
  NotificationState,
  ReadonlySet<NotificationState>
> = {
  scheduled: new Set([
    'deferred_quiet_hours',
    'retry_scheduled',
    'delivered',
    'provider_unavailable',
    'manual_contact_required',
    'suppressed_opt_out',
    'cancelled_source',
    'cancelled_by_staff',
  ]),
  deferred_quiet_hours: new Set([
    'retry_scheduled',
    'delivered',
    'provider_unavailable',
    'manual_contact_required',
    'suppressed_opt_out',
    'cancelled_source',
    'cancelled_by_staff',
  ]),
  retry_scheduled: new Set([
    'retry_scheduled',
    'delivered',
    'provider_unavailable',
    'manual_contact_required',
    'suppressed_opt_out',
    'cancelled_source',
    'cancelled_by_staff',
  ]),
  provider_unavailable: new Set(['retry_scheduled', 'manual_contact_required']),
  manual_contact_required: new Set([
    'patient_replied',
    'manual_contact_completed',
    'cancelled_by_staff',
  ]),
  patient_replied: new Set(['manual_contact_completed']),
  delivered: new Set(['patient_replied', 'manual_contact_completed']),
  manual_contact_completed: new Set(),
  suppressed_opt_out: new Set(),
  cancelled_source: new Set(),
  cancelled_by_staff: new Set(),
};

export function assertNotificationTransition(
  current: NotificationState,
  next: NotificationState,
) {
  if (!allowedNotificationTransitions[current].has(next)) {
    throw new Error(`Недопустимое изменение уведомления: ${current} -> ${next}`);
  }
}

const allowedManualTransitions: Record<ManualContactState, ReadonlySet<ManualContactState>> = {
  open: new Set(['in_progress', 'completed', 'escalated', 'cancelled']),
  in_progress: new Set(['in_progress', 'completed', 'escalated', 'cancelled']),
  escalated: new Set(['completed', 'cancelled']),
  completed: new Set(),
  cancelled: new Set(),
};

export function nextManualContactState(
  current: ManualContactState,
  action: 'start' | 'record_response' | 'complete' | 'escalate' | 'cancel',
) {
  const next: Record<typeof action, ManualContactState> = {
    start: 'in_progress',
    record_response: 'in_progress',
    complete: 'completed',
    escalate: 'escalated',
    cancel: 'cancelled',
  };
  const result = next[action];
  if (!allowedManualTransitions[current].has(result)) {
    throw new Error(`Недопустимое изменение ручного контакта: ${current} -> ${result}`);
  }
  return result;
}

export function renderApprovedTemplate(
  body: string,
  allowedPlaceholders: readonly string[],
  values: Record<string, string>,
) {
  const placeholders = [...body.matchAll(/{{([a-zA-Z][a-zA-Z0-9_]*)}}/g)].map(
    (match) => match[1],
  );
  for (const placeholder of placeholders) {
    if (!allowedPlaceholders.includes(placeholder) || !(placeholder in values)) {
      throw new Error(`Шаблон содержит недоступное поле: ${placeholder}`);
    }
  }
  const rendered = body.replace(
    /{{([a-zA-Z][a-zA-Z0-9_]*)}}/g,
    (_, key: string) => values[key],
  );
  if (/{{|}}/.test(rendered)) {
    throw new Error('Шаблон содержит незаполненное поле');
  }
  return rendered;
}
