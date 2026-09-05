import { describe, expect, it } from 'vitest';
import {
  createObservationSchema,
  fromStoredObservationValues,
  toStoredObservationValues,
  validateMeasuredAt,
  type ObservationInputValues,
} from './observations';

const uuid = '00000000-0000-4000-8000-000000000001';

function validPayload() {
  const values: ObservationInputValues = {
    heightCm: 170,
    weightKg: 68.2,
    systolicMmhg: 122,
    diastolicMmhg: 78,
    temperatureC: 36.6,
  };
  return {
    patientId: 'patient-a',
    measuredAt: Date.UTC(2026, 8, 5, 8, 0),
    context: 'pre_visit' as const,
    values,
    note: 'Синтетическое контрольное измерение',
    reason: 'Первичная запись тестовых показателей',
    syntheticDataAcknowledged: true as const,
    idempotencyKey: uuid,
  };
}

describe('patient observation contract', () => {
  it('derives BMI from scaled height and weight without storing floats', () => {
    const stored = toStoredObservationValues(validPayload().values);

    expect(stored).toEqual({
      heightMm: 1700,
      weightGrams: 68_200,
      bmiHundredths: 2360,
      systolicMmhg: 122,
      diastolicMmhg: 78,
      temperatureMilliC: 36_600,
    });
    expect(fromStoredObservationValues(stored).bmi).toBe(23.6);
  });

  it('requires complete anthropometry and blood-pressure pairs', () => {
    const missingWeight = validPayload();
    missingWeight.values.weightKg = null;
    expect(createObservationSchema.safeParse(missingWeight).success).toBe(false);

    const missingDiastolic = validPayload();
    missingDiastolic.values.diastolicMmhg = null;
    expect(createObservationSchema.safeParse(missingDiastolic).success).toBe(false);
  });

  it('accepts one standalone measurement group but rejects an empty record', () => {
    const temperatureOnly = validPayload();
    temperatureOnly.values = {
      heightCm: null,
      weightKg: null,
      systolicMmhg: null,
      diastolicMmhg: null,
      temperatureC: 36.7,
    };
    expect(createObservationSchema.safeParse(temperatureOnly).success).toBe(true);

    temperatureOnly.values.temperatureC = null;
    expect(createObservationSchema.safeParse(temperatureOnly).success).toBe(false);
  });

  it('rejects inverted pressure and impossible or far-future timestamps', () => {
    const inverted = validPayload();
    inverted.values.systolicMmhg = 70;
    inverted.values.diastolicMmhg = 90;
    expect(createObservationSchema.safeParse(inverted).success).toBe(false);

    expect(() => validateMeasuredAt(Date.UTC(1999, 0, 1), Date.UTC(2026, 0, 1))).toThrow();
    expect(() => validateMeasuredAt(2_000, 1_000)).toThrow();
  });
});
