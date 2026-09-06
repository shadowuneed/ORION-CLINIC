import { z } from 'zod';

const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

const nullableNumber = (minimum: number, maximum: number) =>
  z.union([z.number().finite().min(minimum).max(maximum), z.null()]);

const id = z.string().trim().min(1).max(180);

export const observationContexts = [
  'pre_visit',
  'consultation',
  'follow_up',
  'other',
] as const;

export type ObservationContext = (typeof observationContexts)[number];

export const LOCAL_OBSERVATION_SOURCE_LABEL =
  'Локальный ручной ввод · тестовые данные';

export const observationValuesSchema = z
  .object({
    heightCm: nullableNumber(40, 250),
    weightKg: nullableNumber(1, 500),
    systolicMmhg: z.union([z.number().int().min(40).max(300), z.null()]),
    diastolicMmhg: z.union([z.number().int().min(20).max(200), z.null()]),
    temperatureC: nullableNumber(30, 45),
  })
  .strict()
  .superRefine((value, context) => {
    const hasHeight = value.heightCm !== null;
    const hasWeight = value.weightKg !== null;
    if (hasHeight !== hasWeight) {
      context.addIssue({
        code: 'custom',
        path: [hasHeight ? 'weightKg' : 'heightCm'],
        message: 'Для расчёта ИМТ нужны и рост, и вес',
      });
    }

    const hasSystolic = value.systolicMmhg !== null;
    const hasDiastolic = value.diastolicMmhg !== null;
    if (hasSystolic !== hasDiastolic) {
      context.addIssue({
        code: 'custom',
        path: [hasSystolic ? 'diastolicMmhg' : 'systolicMmhg'],
        message: 'Для давления нужны оба значения',
      });
    }
    if (
      value.systolicMmhg !== null &&
      value.diastolicMmhg !== null &&
      value.systolicMmhg <= value.diastolicMmhg
    ) {
      context.addIssue({
        code: 'custom',
        path: ['systolicMmhg'],
        message: 'Верхнее давление должно быть больше нижнего',
      });
    }

    if (
      !hasHeight &&
      !hasSystolic &&
      value.temperatureC === null
    ) {
      context.addIssue({
        code: 'custom',
        path: ['temperatureC'],
        message: 'Заполните хотя бы одну группу показателей',
      });
    }
  });

export const observationListQuerySchema = z
  .object({
    facilityId: z.string().trim().min(1).max(100).optional(),
    accessAssignmentId: id.optional(),
    patientId: id.optional(),
    limit: z.coerce.number().int().min(1).max(200).default(100),
  })
  .strict();

const observationCommandBase = {
  facilityId: z.string().trim().min(1).max(100).optional(),
  accessAssignmentId: id.optional(),
  patientId: id,
  measuredAt: z.number().int().positive(),
  context: z.enum(observationContexts),
  values: observationValuesSchema,
  note: z.union([cleanText(3, 1_000), z.null()]),
  syntheticDataAcknowledged: z.literal(true),
  idempotencyKey: z.string().uuid(),
} as const;

export const createObservationSchema = z
  .object({
    ...observationCommandBase,
    reason: cleanText(3, 500),
  })
  .strict();

export const correctObservationSchema = z
  .object({
    ...observationCommandBase,
    expectedVersion: z.number().int().positive(),
    reason: cleanText(3, 500),
  })
  .strict();

export type ObservationInputValues = z.infer<typeof observationValuesSchema>;

export type StoredObservationValues = {
  heightMm: number | null;
  weightGrams: number | null;
  bmiHundredths: number | null;
  systolicMmhg: number | null;
  diastolicMmhg: number | null;
  temperatureMilliC: number | null;
};

function rounded(value: number, scale: number) {
  return Math.round((value + Number.EPSILON) * scale);
}

export function toStoredObservationValues(
  values: ObservationInputValues,
): StoredObservationValues {
  const heightMm = values.heightCm === null ? null : rounded(values.heightCm, 10);
  const weightGrams = values.weightKg === null ? null : rounded(values.weightKg, 1_000);
  const bmiHundredths =
    heightMm === null || weightGrams === null
      ? null
      : Math.round((weightGrams * 100_000) / (heightMm * heightMm));

  return {
    heightMm,
    weightGrams,
    bmiHundredths,
    systolicMmhg: values.systolicMmhg,
    diastolicMmhg: values.diastolicMmhg,
    temperatureMilliC:
      values.temperatureC === null ? null : rounded(values.temperatureC, 1_000),
  };
}

export function fromStoredObservationValues(
  values: StoredObservationValues,
): ObservationInputValues & { bmi: number | null } {
  return {
    heightCm: values.heightMm === null ? null : values.heightMm / 10,
    weightKg: values.weightGrams === null ? null : values.weightGrams / 1_000,
    bmi: values.bmiHundredths === null ? null : values.bmiHundredths / 100,
    systolicMmhg: values.systolicMmhg,
    diastolicMmhg: values.diastolicMmhg,
    temperatureC:
      values.temperatureMilliC === null
        ? null
        : values.temperatureMilliC / 1_000,
  };
}

export function validateMeasuredAt(measuredAt: number, now = Date.now()) {
  const earliest = Date.UTC(2000, 0, 1);
  const maximumClockSkew = 5 * 60 * 1_000;
  if (measuredAt < earliest || measuredAt > now + maximumClockSkew) {
    throw new Error('Время измерения находится вне допустимого диапазона');
  }
}
