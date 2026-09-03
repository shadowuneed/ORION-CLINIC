import { z } from 'zod';

const cleanText = (minimum: number, maximum: number) =>
  z
    .string()
    .trim()
    .min(minimum)
    .max(maximum)
    .refine((value) => !/[\u0000-\u001f\u007f]/.test(value));

export const patientBirthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value &&
      parsed.valueOf() <= Date.now()
    );
  });

export const createPatientSchema = z.object({
  facilityId: z.string().min(1).max(100).optional(),
  displayName: cleanText(2, 160),
  birthDate: patientBirthDateSchema.nullable(),
  sexAtBirth: z.enum(['female', 'male', 'unknown', 'not_recorded']),
  testIin: z
    .string()
    .trim()
    .regex(/^\d{12}$/)
    .nullable(),
  phone: cleanText(5, 40).nullable(),
  email: z.string().trim().email().max(160).nullable(),
  address: cleanText(3, 300).nullable(),
  testDataAcknowledged: z.literal(true),
  idempotencyKey: z.string().uuid(),
});

export const createPatientEncounterSchema = z.object({
  facilityId: z.string().min(1).max(100).optional(),
  reasonForVisit: cleanText(2, 500).nullable(),
  idempotencyKey: z.string().uuid(),
});

const patientProfileFields = {
  displayName: cleanText(2, 160),
  birthDate: patientBirthDateSchema.nullable(),
  sexAtBirth: z.enum(['female', 'male', 'unknown', 'not_recorded']),
  phone: cleanText(5, 40).nullable(),
  email: z.string().trim().email().max(160).nullable(),
  address: cleanText(3, 300).nullable(),
};

export const updatePatientProfileSchema = z.object({
  facilityId: z.string().min(1).max(100).optional(),
  ...patientProfileFields,
  changeReason: cleanText(3, 300),
  testDataAcknowledged: z.literal(true),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export const archivePatientProfileSchema = z.object({
  facilityId: z.string().min(1).max(100).optional(),
  changeReason: cleanText(3, 300),
  testDataAcknowledged: z.literal(true),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export const patientListQuerySchema = z.object({
  facilityId: z.string().min(1).max(100).optional(),
  query: z.string().trim().max(120).optional(),
  status: z.enum(['active', 'inactive', 'merged', 'all']).default('active'),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});
