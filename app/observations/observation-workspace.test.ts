import { describe, expect, it } from 'vitest';
import type { PatientObservationRecord } from '@/lib/repositories/patient-observations';
import {
  buildObservationAccessQuery,
  buildObservationOperationKey,
  calculateBmi,
  canCorrectObservation,
  unknownObservationOutcomeMessage,
} from './observation-workspace';

function observation(
  recordedByMembershipId = 'membership-nurse-a',
): PatientObservationRecord {
  return {
    id: 'observation-a',
    patient: {
      id: 'patient-a',
      displayName: 'Пациент Тестовый',
      medicalRecordNumber: 'SYN-OBS-01',
    },
    current: {
      id: 'observation-version-a',
      version: 1,
      supersedesVersionId: null,
      measuredAt: 1,
      context: 'pre_visit',
      values: {
        heightCm: 170,
        weightKg: 68.2,
        bmi: 23.6,
        systolicMmhg: 122,
        diastolicMmhg: 78,
        temperatureC: 36.6,
      },
      units: {
        height: 'cm',
        weight: 'kg',
        bmi: 'kg/m²',
        pressure: 'мм рт. ст.',
        temperature: '°C',
      },
      note: null,
      sourceType: 'manual_test',
      sourceLabel: 'Локальный ручной ввод · тестовые данные',
      recordedByMembershipId,
      accessAssignmentId: 'assignment-nurse-a',
      recordedBy: 'Медсестра Тестовая',
      recordedAt: 2,
      changeReason: 'Первичная запись',
      inputHash: 'a'.repeat(64),
    },
    history: [],
  };
}

describe('observation workspace decisions', () => {
  it('previews the same rounded BMI used by the server', () => {
    expect(calculateBmi('170', '68.2')).toBe(23.6);
    expect(calculateBmi('', '68.2')).toBeNull();
    expect(calculateBmi('0', '68.2')).toBeNull();
  });

  it('lets a doctor correct any visible record and a nurse only their own', () => {
    const clinician = {
      id: 'user-doctor',
      displayName: 'Врач',
      membershipId: 'membership-doctor',
      accessAssignmentId: 'assignment-doctor',
      role: 'clinician' as const,
    };
    const nurse = {
      id: 'user-nurse',
      displayName: 'Медсестра',
      membershipId: 'membership-nurse-a',
      accessAssignmentId: 'assignment-nurse-a',
      role: 'nurse' as const,
    };

    expect(canCorrectObservation(clinician, observation())).toBe(true);
    expect(canCorrectObservation(nurse, observation())).toBe(true);
    expect(canCorrectObservation(nurse, observation('membership-other'))).toBe(false);
  });

  it('treats a disconnected response as an unknown outcome, not a failed save', () => {
    expect(unknownObservationOutcomeMessage()).toContain('Сервер мог сохранить');
    expect(unknownObservationOutcomeMessage()).toContain('сначала обновите');
  });

  it('keeps facility and exact assignment in every observation request', () => {
    expect(
      buildObservationAccessQuery('fac-a', 'assignment-a').toString(),
    ).toBe('facilityId=fac-a&accessAssignmentId=assignment-a&limit=100');
    expect(buildObservationAccessQuery(undefined, undefined).toString()).toBe(
      'limit=100',
    );
  });

  it('isolates retry identities by selected assignment', () => {
    expect(
      buildObservationOperationKey('assignment-a', 'create', 'patient-a'),
    ).not.toBe(
      buildObservationOperationKey('assignment-b', 'create', 'patient-a'),
    );
  });
});
