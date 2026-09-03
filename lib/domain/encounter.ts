import { z } from 'zod';

export const encounterStatusSchema = z.enum([
  'draft',
  'ready',
  'in_progress',
  'review',
  'finalized',
  'amended',
  'cancelled',
]);

export type EncounterStatus = z.infer<typeof encounterStatusSchema>;

export const clinicalSectionCodeSchema = z.enum([
  'complaints',
  'history_of_present_illness',
  'past_medical_history',
  'allergy_status',
  'objective_findings',
  'preliminary_diagnosis',
  'examination_plan',
  'treatment_plan',
]);

export type ClinicalSectionCode = z.infer<typeof clinicalSectionCodeSchema>;

export const clinicalSectionReviewStateSchema = z.enum([
  'empty',
  'ai_draft',
  'clinician_edited',
  'reviewed',
  'explicitly_absent',
]);

export type ClinicalSectionReviewState = z.infer<
  typeof clinicalSectionReviewStateSchema
>;

const encounterTransitions: Readonly<
  Record<EncounterStatus, readonly EncounterStatus[]>
> = {
  draft: ['ready', 'cancelled'],
  ready: ['in_progress', 'cancelled'],
  in_progress: ['review', 'cancelled'],
  review: ['in_progress', 'finalized', 'cancelled'],
  finalized: ['amended'],
  amended: ['amended'],
  cancelled: [],
};

export function canTransitionEncounter(
  current: EncounterStatus,
  next: EncounterStatus,
): boolean {
  return encounterTransitions[current].includes(next);
}

export function assertEncounterTransition(
  current: EncounterStatus,
  next: EncounterStatus,
): void {
  if (!canTransitionEncounter(current, next)) {
    throw new Error(`Недопустимый переход приёма: ${current} -> ${next}`);
  }
}

export function isEncounterClinicalRecordEditable(
  status: EncounterStatus,
): boolean {
  return status === 'in_progress' || status === 'review';
}

export function isEncounterResumable(status: EncounterStatus): boolean {
  return status === 'in_progress' || status === 'review';
}

export type ClinicalSectionReview = {
  code: ClinicalSectionCode;
  state: ClinicalSectionReviewState;
};

export type ProtocolReadiness = {
  ready: boolean;
  unresolved: ClinicalSectionCode[];
};

export function getProtocolReadiness(
  sections: readonly ClinicalSectionReview[],
): ProtocolReadiness {
  const stateByCode = new Map<ClinicalSectionCode, ClinicalSectionReviewState>();

  for (const section of sections) {
    if (stateByCode.has(section.code)) {
      throw new Error(`Конфликт версий клинического раздела: ${section.code}`);
    }

    stateByCode.set(section.code, section.state);
  }

  const unresolved = clinicalSectionCodeSchema.options.filter((code) => {
    const state = stateByCode.get(code);
    return state !== 'reviewed' && state !== 'explicitly_absent';
  });

  return {
    ready: unresolved.length === 0,
    unresolved,
  };
}

export const suggestionReviewStateSchema = z.enum([
  'proposed',
  'accepted',
  'edited_and_accepted',
  'rejected',
  'expired',
]);

export type SuggestionReviewState = z.infer<
  typeof suggestionReviewStateSchema
>;

export function suggestionEntersProtocol(
  state: SuggestionReviewState,
): boolean {
  return state === 'accepted' || state === 'edited_and_accepted';
}
