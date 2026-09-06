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
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const [year, month, day] = value.split('-').map(Number);
    const parsed = new Date(Date.UTC(year, month - 1, day));
    return (
      parsed.getUTCFullYear() === year &&
      parsed.getUTCMonth() === month - 1 &&
      parsed.getUTCDate() === day
    );
  }, 'Укажите существующую дату в формате ГГГГ-ММ-ДД');
const localTime = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);

export const schedulingSourceKinds = ['manual_test'] as const;
export const SYNTHETIC_SCHEDULE_SOURCE_LABEL =
  'Тестовое ручное расписание · не КМИС';
export const SCHEDULING_HOLD_TTL_MS = 15 * 60 * 1_000;
export const SCHEDULING_CONFIRMATION_STATEMENT_VERSION =
  'orion-scheduling-confirmation-v1';

export const schedulingSlotStatuses = [
  'available',
  'held',
  'booked',
  'withdrawn',
] as const;
export const schedulingAppointmentStatuses = [
  'held',
  'confirmed',
  'cancelled',
  'expired',
  'no_show',
  'completed',
] as const;
export const schedulingQueueStatuses = [
  'issued',
  'arrived',
  'called',
  'in_service',
  'completed',
  'cancelled',
  'exception',
] as const;
export const patientConfirmationSubjects = ['patient', 'proxy'] as const;
export const patientConfirmationMethods = [
  'verbal_in_person',
  'verbal_phone',
  'digital',
] as const;
export const schedulingLanguages = ['ru', 'kk'] as const;

export type SchedulingSourceKind = (typeof schedulingSourceKinds)[number];
export type SchedulingSlotStatus = (typeof schedulingSlotStatuses)[number];
export type SchedulingAppointmentStatus =
  (typeof schedulingAppointmentStatuses)[number];
export type SchedulingQueueStatus = (typeof schedulingQueueStatuses)[number];
export type SchedulingLanguage = (typeof schedulingLanguages)[number];

export type SchedulingConfirmationStatementInput = {
  appointmentId: string;
  slotId: string;
  startsAt: number;
  endsAt: number;
  subject: (typeof patientConfirmationSubjects)[number];
  method: (typeof patientConfirmationMethods)[number];
  language: SchedulingLanguage;
};

export function schedulingConfirmationStatement(
  input: SchedulingConfirmationStatementInput,
) {
  return JSON.stringify({
    version: SCHEDULING_CONFIRMATION_STATEMENT_VERSION,
    appointmentId: input.appointmentId,
    slotId: input.slotId,
    startsAt: input.startsAt,
    endsAt: input.endsAt,
    subject: input.subject,
    method: input.method,
    language: input.language,
  });
}

export async function hashSchedulingConfirmationStatement(
  input: SchedulingConfirmationStatementInput,
) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(schedulingConfirmationStatement(input)),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export const schedulingListQuerySchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    accessAssignmentId: id.optional(),
    dateFrom: isoDate.optional(),
    dateTo: isoDate.optional(),
    specialtyId: id.optional(),
    providerId: id.optional(),
    slotStatus: z.enum([...schedulingSlotStatuses, 'all']).default('all'),
    appointmentStatus: z
      .enum([...schedulingAppointmentStatuses, 'all'])
      .default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.dateFrom && value.dateTo && value.dateFrom > value.dateTo) {
      context.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'Конечная дата не может быть раньше начальной',
      });
    }
  });

export const preferredTimeRangeSchema = z
  .object({
    earliestLocalTime: z.union([localTime, z.null()]),
    latestLocalTime: z.union([localTime, z.null()]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.earliestLocalTime === null) !==
      (value.latestLocalTime === null)
    ) {
      context.addIssue({
        code: 'custom',
        path: ['latestLocalTime'],
        message: 'Укажите обе границы времени или оставьте обе пустыми',
      });
    }
    if (
      value.earliestLocalTime &&
      value.latestLocalTime &&
      value.earliestLocalTime > value.latestLocalTime
    ) {
      context.addIssue({
        code: 'custom',
        path: ['latestLocalTime'],
        message: 'Конечное время не может быть раньше начального',
      });
    }
  });

export const createSchedulingPreferenceSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    accessAssignmentId: id.optional(),
    serviceRequestId: id,
    serviceRequestVersionId: id,
    preferredDateFrom: isoDate,
    preferredDateTo: isoDate,
    earliestLocalTime: z.union([localTime, z.null()]),
    latestLocalTime: z.union([localTime, z.null()]),
    preferredProviderId: z.union([id, z.null()]),
    notes: nullableText(2, 1_000),
    noticeLanguage: z.enum(schedulingLanguages),
    testDataAcknowledged: z.literal(true),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.preferredDateFrom > value.preferredDateTo) {
      context.addIssue({
        code: 'custom',
        path: ['preferredDateTo'],
        message: 'Конечная дата не может быть раньше начальной',
      });
    }
    const time = preferredTimeRangeSchema.safeParse({
      earliestLocalTime: value.earliestLocalTime,
      latestLocalTime: value.latestLocalTime,
    });
    if (!time.success) {
      for (const issue of time.error.issues) {
        context.addIssue({
          code: 'custom',
          path: issue.path,
          message: issue.message,
        });
      }
    }
  });

export const holdSchedulingSlotSchema = z.object({
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: id.optional(),
  serviceRequestId: id,
  slotId: id,
  preferenceSnapshotId: id,
  expectedSlotVersion: z.number().int().positive(),
  testDataAcknowledged: z.literal(true),
  idempotencyKey: z.string().uuid(),
}).strict();

export const confirmSchedulingAppointmentSchema = z.object({
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: id.optional(),
  expectedAppointmentVersion: z.number().int().positive(),
  expectedSlotVersion: z.number().int().positive(),
  confirmation: z.object({
    subject: z.enum(patientConfirmationSubjects),
    method: z.enum(patientConfirmationMethods),
    language: z.enum(schedulingLanguages),
    statementVersion: cleanText(1, 80),
    statementHash: z.string().regex(/^[a-f0-9]{64}$/),
    acknowledged: z.literal(true),
  }),
  reason: cleanText(3, 500),
  idempotencyKey: z.string().uuid(),
}).strict();

export const schedulingAppointmentCommandSchema = z.object({
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: id.optional(),
  action: z.enum(['cancel', 'expire_hold', 'mark_no_show']),
  expectedAppointmentVersion: z.number().int().positive(),
  expectedSlotVersion: z.number().int().positive(),
  reason: cleanText(3, 500),
  idempotencyKey: z.string().uuid(),
}).strict();

export const issueSchedulingQueueTicketSchema = z.object({
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: id.optional(),
  appointmentId: id,
  expectedAppointmentVersion: z.number().int().positive(),
  testDataAcknowledged: z.literal(true),
  idempotencyKey: z.string().uuid(),
}).strict();

export const schedulingQueueCommandSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    accessAssignmentId: id.optional(),
    action: z.enum([
      'arrive',
      'call',
      'start_service',
      'complete',
      'mark_exception',
    ]),
    expectedQueueVersion: z.number().int().positive(),
    expectedAppointmentVersion: z.number().int().positive().optional(),
    reason: cleanText(3, 500),
    roomLabel: nullableText(1, 80).optional().default(null),
    exceptionCode: nullableText(2, 80).optional().default(null),
    exceptionNote: nullableText(3, 500).optional().default(null),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      (value.action === 'call' || value.action === 'start_service') &&
      !value.roomLabel
    ) {
      context.addIssue({
        code: 'custom',
        path: ['roomLabel'],
        message: 'Укажите кабинет',
      });
    }
    if (value.action === 'mark_exception') {
      if (!value.exceptionCode) {
        context.addIssue({
          code: 'custom',
          path: ['exceptionCode'],
          message: 'Укажите код исключения',
        });
      }
      if (!value.exceptionNote) {
        context.addIssue({
          code: 'custom',
          path: ['exceptionNote'],
          message: 'Опишите исключение',
        });
      }
    } else if (value.exceptionCode || value.exceptionNote) {
      context.addIssue({
        code: 'custom',
        path: ['exceptionCode'],
        message: 'Поля исключения допустимы только для mark_exception',
      });
    }
    if (value.action === 'complete' && !value.expectedAppointmentVersion) {
      context.addIssue({
        code: 'custom',
        path: ['expectedAppointmentVersion'],
        message: 'Для завершения укажите версию записи',
      });
    }
  });

const slotTransitions: Record<
  SchedulingSlotStatus,
  ReadonlySet<SchedulingSlotStatus>
> = {
  available: new Set(['held', 'withdrawn']),
  held: new Set(['booked', 'available']),
  booked: new Set(['available']),
  withdrawn: new Set(),
};

const appointmentTransitions: Record<
  SchedulingAppointmentStatus,
  ReadonlySet<SchedulingAppointmentStatus>
> = {
  held: new Set(['confirmed', 'cancelled', 'expired']),
  confirmed: new Set(['cancelled', 'no_show', 'completed']),
  cancelled: new Set(),
  expired: new Set(),
  no_show: new Set(),
  completed: new Set(),
};

const queueTransitions: Record<
  SchedulingQueueStatus,
  ReadonlySet<SchedulingQueueStatus>
> = {
  issued: new Set(['arrived', 'cancelled', 'exception']),
  arrived: new Set(['called', 'cancelled', 'exception']),
  called: new Set(['in_service', 'cancelled', 'exception']),
  in_service: new Set(['completed', 'exception']),
  completed: new Set(),
  cancelled: new Set(),
  exception: new Set(),
};

export function assertSchedulingSlotTransition(
  current: SchedulingSlotStatus,
  next: SchedulingSlotStatus,
) {
  if (!slotTransitions[current].has(next)) {
    throw new Error(`Недопустимое изменение слота: ${current} -> ${next}`);
  }
}

export function assertSchedulingAppointmentTransition(
  current: SchedulingAppointmentStatus,
  next: SchedulingAppointmentStatus,
) {
  if (!appointmentTransitions[current].has(next)) {
    throw new Error(`Недопустимое изменение записи: ${current} -> ${next}`);
  }
}

export function assertSchedulingQueueTransition(
  current: SchedulingQueueStatus,
  next: SchedulingQueueStatus,
) {
  if (!queueTransitions[current].has(next)) {
    throw new Error(`Недопустимое изменение очереди: ${current} -> ${next}`);
  }
}

export function nextSchedulingAppointmentStatus(
  current: SchedulingAppointmentStatus,
  action: 'cancel' | 'expire_hold' | 'mark_no_show',
) {
  const next: Record<typeof action, SchedulingAppointmentStatus> = {
    cancel: 'cancelled',
    expire_hold: 'expired',
    mark_no_show: 'no_show',
  };
  assertSchedulingAppointmentTransition(current, next[action]);
  return next[action];
}

export function nextSchedulingQueueStatus(
  current: SchedulingQueueStatus,
  action: 'arrive' | 'call' | 'start_service' | 'complete' | 'mark_exception',
) {
  const next: Record<typeof action, SchedulingQueueStatus> = {
    arrive: 'arrived',
    call: 'called',
    start_service: 'in_service',
    complete: 'completed',
    mark_exception: 'exception',
  };
  assertSchedulingQueueTransition(current, next[action]);
  return next[action];
}

export function assertReferralEligibleForScheduling(input: {
  requestKind: string;
  status: string;
  approvedByMembershipId: string | null;
  approvedAt: number | null;
}) {
  if (
    input.requestKind !== 'referral' ||
    input.status !== 'active' ||
    !input.approvedByMembershipId ||
    !input.approvedAt
  ) {
    throw new Error('Для записи нужно действующее подтверждённое направление');
  }
}

export function assertQueueTicketCanBeIssued(
  appointmentStatus: SchedulingAppointmentStatus,
) {
  if (appointmentStatus !== 'confirmed') {
    throw new Error('Талон очереди доступен только для подтверждённой записи');
  }
}

export function schedulingHoldExpiresAt(now = Date.now()) {
  return now + SCHEDULING_HOLD_TTL_MS;
}
