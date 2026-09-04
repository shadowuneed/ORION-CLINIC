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

export const CHRONIC_REGISTRY_SOURCE_LABEL =
  'Локальное тестовое наблюдение · не ЭРДБ/ПУЗ';
export const CHRONIC_DUE_SOON_DAYS = 7;
export const chronicRegistryStatuses = ['active', 'paused', 'closed'] as const;
export const chronicTaskKinds = [
  'nurse_contact',
  'follow_up_visit',
  'control_test',
  'medication_review',
] as const;
export const chronicTaskStatuses = [
  'pending',
  'in_progress',
  'completed',
  'escalated',
  'cancelled',
] as const;
export const chronicTaskOwnerRoles = ['clinician', 'nurse'] as const;
export const wellbeingStates = ['stable', 'concerning', 'urgent'] as const;
export const contactMethods = ['in_person', 'phone', 'digital'] as const;

export type ChronicRegistryStatus = (typeof chronicRegistryStatuses)[number];
export type ChronicTaskKind = (typeof chronicTaskKinds)[number];
export type ChronicTaskStatus = (typeof chronicTaskStatuses)[number];
export type ChronicTaskOwnerRole = (typeof chronicTaskOwnerRoles)[number];
export type WellbeingState = (typeof wellbeingStates)[number];
export type ContactMethod = (typeof contactMethods)[number];
export type ChronicDueState = 'current' | 'due_soon' | 'overdue' | 'closed';

export const medicationPlanItemSchema = z
  .object({
    name: cleanText(2, 200),
    dose: cleanText(1, 100),
    route: cleanText(1, 80),
    schedule: cleanText(2, 200),
    startsOn: isoDate,
    endsOn: z.union([isoDate, z.null()]),
    instructions: nullableText(2, 1_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.endsOn && value.endsOn < value.startsOn) {
      context.addIssue({
        code: 'custom',
        path: ['endsOn'],
        message: 'Дата окончания не может быть раньше даты начала',
      });
    }
  });

export const careTaskBlueprintSchema = z
  .object({
    key: cleanText(2, 80).regex(/^[a-z0-9][a-z0-9_-]*$/),
    kind: z.enum(chronicTaskKinds),
    title: cleanText(3, 240),
    dueDate: isoDate,
    ownerRole: z.enum(chronicTaskOwnerRoles),
    assignedMembershipId: id,
    instructions: nullableText(3, 1_000),
  })
  .strict();

export const signedCarePlanContentSchema = z
  .object({
    effectiveFrom: isoDate,
    effectiveTo: isoDate,
    goals: z.array(cleanText(3, 500)).min(1).max(20),
    treatmentPlan: cleanText(10, 5_000),
    dietPlan: cleanText(10, 3_000),
    medications: z.array(medicationPlanItemSchema).max(30),
    tasks: z.array(careTaskBlueprintSchema).min(1).max(40),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effectiveTo < value.effectiveFrom) {
      context.addIssue({
        code: 'custom',
        path: ['effectiveTo'],
        message: 'План не может закончиться раньше даты начала',
      });
    }
    const keys = new Set<string>();
    for (const [index, task] of value.tasks.entries()) {
      if (keys.has(task.key)) {
        context.addIssue({
          code: 'custom',
          path: ['tasks', index, 'key'],
          message: 'Ключ задачи должен быть уникальным в версии плана',
        });
      }
      keys.add(task.key);
      if (task.dueDate < value.effectiveFrom || task.dueDate > value.effectiveTo) {
        context.addIssue({
          code: 'custom',
          path: ['tasks', index, 'dueDate'],
          message: 'Дата задачи должна входить в период плана',
        });
      }
    }
  });

export type MedicationPlanItem = z.infer<typeof medicationPlanItemSchema>;
export type CareTaskBlueprint = z.infer<typeof careTaskBlueprintSchema>;
export type SignedCarePlanContent = z.infer<typeof signedCarePlanContentSchema>;

export const chronicCareListQuerySchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    dueState: z
      .enum(['all', 'current', 'due_soon', 'overdue', 'closed'])
      .default('all'),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

export const createChronicEnrollmentSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    patientId: id,
    basisEncounterId: id,
    basisProtocolVersionId: id,
    registryCode: cleanText(2, 80).regex(/^[A-Z0-9][A-Z0-9_-]*$/),
    diagnosisDisplay: cleanText(3, 500),
    diagnosisCode: nullableText(2, 80),
    diagnosisBasis: cleanText(10, 3_000),
    doctorConfirmed: z.literal(true),
    localSourceAcknowledged: z.literal(true),
    reason: cleanText(3, 500),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const saveSignedCarePlanSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    enrollmentId: id,
    expectedEnrollmentVersion: z.number().int().positive(),
    expectedPlanVersion: z.union([z.number().int().positive(), z.null()]),
    content: signedCarePlanContentSchema,
    doctorConfirmed: z.literal(true),
    localSourceAcknowledged: z.literal(true),
    reason: cleanText(3, 500),
    idempotencyKey: z.string().uuid(),
  })
  .strict();

export const chronicTaskCommandSchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    action: z.enum([
      'start',
      'record_response',
      'escalate',
      'complete',
      'resolve',
      'cancel',
    ]),
    expectedTaskVersion: z.number().int().positive(),
    reason: cleanText(3, 500),
    contactMethod: z.enum(contactMethods).nullable().optional().default(null),
    wellbeing: z.enum(wellbeingStates).nullable().optional().default(null),
    responseSummary: nullableText(3, 2_000).optional().default(null),
    escalationReason: nullableText(3, 1_000).optional().default(null),
    idempotencyKey: z.string().uuid(),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.action === 'record_response') {
      if (!value.contactMethod) {
        context.addIssue({
          code: 'custom',
          path: ['contactMethod'],
          message: 'Укажите способ контакта',
        });
      }
      if (!value.wellbeing) {
        context.addIssue({
          code: 'custom',
          path: ['wellbeing'],
          message: 'Зафиксируйте самочувствие со слов пациента',
        });
      }
      if (!value.responseSummary) {
        context.addIssue({
          code: 'custom',
          path: ['responseSummary'],
          message: 'Запишите ответ пациента',
        });
      }
    } else if (value.contactMethod || value.wellbeing || value.responseSummary) {
      context.addIssue({
        code: 'custom',
        path: ['responseSummary'],
        message: 'Ответ пациента допустим только для record_response',
      });
    }
    if (value.action === 'escalate' && !value.escalationReason) {
      context.addIssue({
        code: 'custom',
        path: ['escalationReason'],
        message: 'Укажите причину эскалации врачу',
      });
    }
    if (value.action !== 'escalate' && value.escalationReason) {
      context.addIssue({
        code: 'custom',
        path: ['escalationReason'],
        message: 'Причина эскалации допустима только для escalate',
      });
    }
  });

const taskTransitions: Record<
  ChronicTaskStatus,
  ReadonlySet<ChronicTaskStatus>
> = {
  pending: new Set(['in_progress', 'completed', 'escalated', 'cancelled']),
  in_progress: new Set(['in_progress', 'completed', 'escalated', 'cancelled']),
  completed: new Set(),
  escalated: new Set(['completed', 'cancelled']),
  cancelled: new Set(),
};

export function nextChronicTaskStatus(
  current: ChronicTaskStatus,
  action:
    | 'start'
    | 'record_response'
    | 'escalate'
    | 'complete'
    | 'resolve'
    | 'cancel',
) {
  if (current === 'escalated' && action !== 'resolve' && action !== 'cancel') {
    throw new Error('Эскалированную задачу закрывает или отменяет только врач');
  }
  if (action === 'resolve' && current !== 'escalated') {
    throw new Error('Закрыть эскалацию можно только из статуса escalated');
  }
  const next: Record<typeof action, ChronicTaskStatus> = {
    start: 'in_progress',
    record_response: 'in_progress',
    escalate: 'escalated',
    complete: 'completed',
    resolve: 'completed',
    cancel: 'cancelled',
  };
  const result = next[action];
  if (!taskTransitions[current].has(result)) {
    throw new Error(`Недопустимое изменение задачи: ${current} -> ${result}`);
  }
  return result;
}

export function chronicDueState(
  status: ChronicTaskStatus,
  dueDate: string,
  today = new Date().toISOString().slice(0, 10),
): ChronicDueState {
  if (status === 'completed' || status === 'cancelled') return 'closed';
  if (dueDate < today) return 'overdue';
  const daysUntilDue =
    (Date.parse(`${dueDate}T00:00:00.000Z`) -
      Date.parse(`${today}T00:00:00.000Z`)) /
    (24 * 60 * 60 * 1_000);
  if (daysUntilDue <= CHRONIC_DUE_SOON_DAYS) {
    return 'due_soon';
  }
  return 'current';
}
