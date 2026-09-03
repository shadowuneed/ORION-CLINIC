import { describe, expect, it } from 'vitest';
import {
  archivePatientProfileSchema,
  createPatientSchema,
  patientListQuerySchema,
  updatePatientProfileSchema,
} from './patient';

describe('patient input contract', () => {
  it('accepts a complete artificial-data patient record', () => {
    expect(
      createPatientSchema.parse({
        displayName: '  Айдана Тестова  ',
        birthDate: '1990-05-12',
        sexAtBirth: 'female',
        testIin: '900512400001',
        phone: '+7 700 000 00 01',
        email: 'patient@example.test',
        address: 'г. Алматы',
        testDataAcknowledged: true,
        idempotencyKey: '00000000-0000-4000-8000-000000000001',
      }).displayName,
    ).toBe('Айдана Тестова');
  });

  it('rejects malformed IIN-like identifiers and future birth dates', () => {
    const base = {
      displayName: 'Тестовый пациент',
      birthDate: null,
      sexAtBirth: 'not_recorded' as const,
      phone: null,
      email: null,
      address: null,
      testDataAcknowledged: true as const,
      idempotencyKey: '00000000-0000-4000-8000-000000000001',
    };
    expect(createPatientSchema.safeParse({ ...base, testIin: '123' }).success).toBe(false);
    expect(
      createPatientSchema.safeParse({
        ...base,
        testIin: null,
        birthDate: '2999-01-01',
      }).success,
    ).toBe(false);
  });

  it('caps patient directory pagination input', () => {
    expect(
      patientListQuerySchema.parse({ status: 'active', limit: '100' }).limit,
    ).toBe(100);
    expect(patientListQuerySchema.safeParse({ limit: '101' }).success).toBe(false);
  });

  it('accepts a versioned profile update and requires a meaningful reason', () => {
    const update = {
      displayName: 'Айдана Тестова',
      birthDate: '1990-05-12',
      sexAtBirth: 'female' as const,
      phone: '+7 701 000 00 01',
      email: 'updated@example.test',
      address: 'г. Алматы',
      changeReason: 'Контакты уточнены со слов пациента',
      testDataAcknowledged: true as const,
      expectedVersion: 1,
      idempotencyKey: '00000000-0000-4000-8000-000000000010',
    };

    expect(updatePatientProfileSchema.parse(update).displayName).toBe('Айдана Тестова');
    expect(
      updatePatientProfileSchema.safeParse({ ...update, changeReason: ' ' }).success,
    ).toBe(false);
  });

  it('requires optimistic versioning for archive commands', () => {
    expect(
      archivePatientProfileSchema.safeParse({
        changeReason: 'Дубликат тестовой карточки',
        testDataAcknowledged: true,
        expectedVersion: 0,
        idempotencyKey: '00000000-0000-4000-8000-000000000011',
      }).success,
    ).toBe(false);
  });
});
