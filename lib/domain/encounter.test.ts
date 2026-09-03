import { describe, expect, it } from 'vitest';
import {
  assertEncounterTransition,
  canTransitionEncounter,
  clinicalSectionCodeSchema,
  getProtocolReadiness,
  isEncounterClinicalRecordEditable,
  isEncounterResumable,
  suggestionEntersProtocol,
} from './encounter';

describe('encounter state machine', () => {
  it('allows the normal clinician-controlled flow', () => {
    expect(canTransitionEncounter('draft', 'ready')).toBe(true);
    expect(canTransitionEncounter('ready', 'in_progress')).toBe(true);
    expect(canTransitionEncounter('in_progress', 'review')).toBe(true);
    expect(canTransitionEncounter('review', 'finalized')).toBe(true);
    expect(canTransitionEncounter('finalized', 'amended')).toBe(true);
    expect(canTransitionEncounter('amended', 'amended')).toBe(true);
  });

  it('blocks skipping review and reopening a cancelled encounter', () => {
    expect(canTransitionEncounter('in_progress', 'finalized')).toBe(false);
    expect(canTransitionEncounter('cancelled', 'in_progress')).toBe(false);
    expect(() => assertEncounterTransition('draft', 'finalized')).toThrow(
      'Недопустимый переход приёма',
    );
  });

  it('allows clinical edits only before the protocol is finalized', () => {
    expect(isEncounterClinicalRecordEditable('in_progress')).toBe(true);
    expect(isEncounterClinicalRecordEditable('review')).toBe(true);
    expect(isEncounterClinicalRecordEditable('finalized')).toBe(false);
    expect(isEncounterClinicalRecordEditable('amended')).toBe(false);
    expect(isEncounterClinicalRecordEditable('cancelled')).toBe(false);
  });

  it('offers recovery only for a started or review-stage encounter', () => {
    expect(isEncounterResumable('draft')).toBe(false);
    expect(isEncounterResumable('ready')).toBe(false);
    expect(isEncounterResumable('in_progress')).toBe(true);
    expect(isEncounterResumable('review')).toBe(true);
    expect(isEncounterResumable('finalized')).toBe(false);
    expect(isEncounterResumable('amended')).toBe(false);
    expect(isEncounterResumable('cancelled')).toBe(false);
  });
});

describe('protocol readiness', () => {
  it('requires every clinical section to be reviewed or explicitly absent', () => {
    const result = getProtocolReadiness([
      { code: 'complaints', state: 'reviewed' },
      { code: 'allergy_status', state: 'ai_draft' },
    ]);

    expect(result.ready).toBe(false);
    expect(result.unresolved).toContain('allergy_status');
    expect(result.unresolved).toContain('treatment_plan');
  });

  it('is ready when every required section has a human resolution', () => {
    const result = getProtocolReadiness(
      clinicalSectionCodeSchema.options.map((code) => ({
        code,
        state: code === 'past_medical_history' ? 'explicitly_absent' : 'reviewed',
      })),
    );

    expect(result).toEqual({ ready: true, unresolved: [] });
  });

  it('rejects conflicting current versions of the same section', () => {
    expect(() =>
      getProtocolReadiness([
        { code: 'allergy_status', state: 'reviewed' },
        { code: 'allergy_status', state: 'ai_draft' },
      ]),
    ).toThrow('Конфликт версий клинического раздела');
  });
});

describe('suggestion review boundary', () => {
  it('excludes pending, rejected, and expired suggestions from the protocol', () => {
    expect(suggestionEntersProtocol('proposed')).toBe(false);
    expect(suggestionEntersProtocol('rejected')).toBe(false);
    expect(suggestionEntersProtocol('expired')).toBe(false);
  });

  it('includes only explicitly accepted content', () => {
    expect(suggestionEntersProtocol('accepted')).toBe(true);
    expect(suggestionEntersProtocol('edited_and_accepted')).toBe(true);
  });
});
