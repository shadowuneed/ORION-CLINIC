import { z } from 'zod';
import type { LatestPatientVitals } from '@/lib/repositories/patient-observations';

// Prepared contract for migration0005. No route/RPC is activated by this file.
if (typeof window !== 'undefined') throw new Error('Cloud observation contracts are server-only.');

export const CLOUD_OBSERVATION_SOURCE = 'Облачный ручной ввод · тестовые данные';
const id = z.string().min(1).max(160).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const text = z.string().min(2).max(300).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const time = z.number().int().min(946684800000).max(Number.MAX_SAFE_INTEGER);
const scaled = (minimum: number, maximum: number, scale: number) => z.number().min(minimum).max(maximum)
  .refine(value => Math.abs(value * scale - Math.round(value * scale)) < 0.000001);
const source = {
  observationId: id, version: z.number().int().positive().max(2147483647),
  measuredAt: time, recordedBy: text, sourceLabel: z.literal(CLOUD_OBSERVATION_SOURCE),
};
const anthropometry = z.object({ ...source, heightCm: scaled(40, 250, 10), weightKg: scaled(1, 500, 1000),
  bmi: scaled(5, 100, 100) }).strict().refine(value => {
    const heightMm = Math.round(value.heightCm * 10);
    const weightGrams = Math.round(value.weightKg * 1000);
    return Math.round(value.bmi * 100) === Math.round(weightGrams * 100000 / (heightMm * heightMm));
  });
const bloodPressure = z.object({ ...source, systolicMmhg: z.number().int().min(40).max(300),
  diastolicMmhg: z.number().int().min(20).max(200) }).strict().refine(value => value.systolicMmhg > value.diastolicMmhg);
const temperature = z.object({ ...source, temperatureC: scaled(30, 45, 1000) }).strict();
const latest = z.object({
  organizationId: id, facilityId: id, patientId: id, accessAssignmentId: id, assignmentVersionId: id,
  role: z.enum(['clinician', 'nurse']), timeZone: z.string().min(1).max(100),
  sourceLabel: z.literal(CLOUD_OBSERVATION_SOURCE), observedAt: time,
  clinicalInterpretation: z.literal('not_performed'),
  vitals: z.object({ anthropometry: anthropometry.nullable(), bloodPressure: bloodPressure.nullable(),
    temperature: temperature.nullable() }).strict(),
}).strict();

export type CloudObservationTransportScope = {
  organizationId: string; facilityId: string; patientId: string; accessAssignmentId: string;
};

/** Each measurement group retains its own source and time; null is not normal. */
export function parseCloudLatestVitals(value: unknown, scope: CloudObservationTransportScope) {
  const result = latest.parse(value);
  if (result.organizationId !== scope.organizationId || result.facilityId !== scope.facilityId ||
    result.patientId !== scope.patientId || result.accessAssignmentId !== scope.accessAssignmentId) {
    throw new Error('Inconsistent cloud observation scope.');
  }
  try { new Intl.DateTimeFormat('ru', { timeZone: result.timeZone }); }
  catch { throw new Error('Invalid cloud observation time zone.'); }
  // measuredAt may be explicitly entered up to5 minutes ahead of server time.
  for (const group of Object.values(result.vitals)) {
    if (group && group.measuredAt > result.observedAt + 300000) {
      throw new Error('Invalid cloud measurement time.');
    }
  }
  return { ...result, vitals: result.vitals as LatestPatientVitals };
}
