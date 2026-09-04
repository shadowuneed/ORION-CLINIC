import { describe, expect, it } from 'vitest';
import {
  chronicDueState,
  createChronicEnrollmentSchema,
  nextChronicTaskStatus,
  saveSignedCarePlanSchema,
} from './chronic-care';

const uuid = (value: number) =>
  `00000000-0000-4000-8000-${value.toString().padStart(12, '0')}`;

describe('chronic-care domain', () => {
  it('classifies reproducible due cohorts using the supplied clinic date', () => {
    expect(chronicDueState('pending', '2026-09-03', '2026-09-04')).toBe('overdue');
    expect(chronicDueState('in_progress', '2026-09-11', '2026-09-04')).toBe(
      'due_soon',
    );
    expect(chronicDueState('pending', '2026-09-12', '2026-09-04')).toBe('current');
    expect(chronicDueState('completed', '2026-08-01', '2026-09-04')).toBe(
      'closed',
    );
  });

  it('accepts only explicit doctor confirmation for a local enrollment', () => {
    const parsed = createChronicEnrollmentSchema.parse({
      patientId: 'patient-a',
      basisEncounterId: 'encounter-a',
      basisProtocolVersionId: 'protocol-version-a',
      registryCode: 'SYN-ENDO-01',
      diagnosisDisplay: 'Тестовый диагноз',
      diagnosisCode: null,
      diagnosisBasis: 'Подтверждено врачом по подписанному протоколу.',
      doctorConfirmed: true,
      localSourceAcknowledged: true,
      reason: 'Первичное включение',
      idempotencyKey: uuid(1),
    });
    expect(parsed.registryCode).toBe('SYN-ENDO-01');
    expect(() =>
      createChronicEnrollmentSchema.parse({ ...parsed, doctorConfirmed: false }),
    ).toThrow();
  });

  it('rejects duplicate, out-of-period tasks in a signed plan', () => {
    const base = {
      enrollmentId: 'enrollment-a',
      expectedEnrollmentVersion: 1,
      expectedPlanVersion: null,
      content: {
        effectiveFrom: '2026-09-01',
        effectiveTo: '2026-12-01',
        goals: ['Контроль самочувствия'],
        treatmentPlan: 'Тестовый план мероприятий, утверждённый врачом.',
        dietPlan: 'Тестовые рекомендации по рациону, утверждённые врачом.',
        medications: [],
        tasks: [
          {
            key: 'follow-up',
            kind: 'follow_up_visit' as const,
            title: 'Контрольный приём',
            dueDate: '2026-10-01',
            ownerRole: 'clinician' as const,
            assignedMembershipId: 'membership-a',
            instructions: null,
          },
        ],
      },
      doctorConfirmed: true as const,
      localSourceAcknowledged: true as const,
      reason: 'Подписание тестового плана',
      idempotencyKey: uuid(2),
    };
    expect(saveSignedCarePlanSchema.parse(base).content.tasks).toHaveLength(1);
    expect(() =>
      saveSignedCarePlanSchema.parse({
        ...base,
        content: {
          ...base.content,
          tasks: [
            ...base.content.tasks,
            { ...base.content.tasks[0], dueDate: '2027-01-01' },
          ],
        },
      }),
    ).toThrow();
  });

  it('keeps escalations doctor-resolved and terminal tasks immutable', () => {
    expect(nextChronicTaskStatus('pending', 'start')).toBe('in_progress');
    expect(nextChronicTaskStatus('in_progress', 'escalate')).toBe('escalated');
    expect(nextChronicTaskStatus('escalated', 'resolve')).toBe('completed');
    expect(() => nextChronicTaskStatus('pending', 'resolve')).toThrow();
    expect(() => nextChronicTaskStatus('completed', 'start')).toThrow();
  });
});
