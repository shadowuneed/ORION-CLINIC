export const consentTypes = [
  'care',
  'transient_audio_processing',
  'audio_retention',
  'transcript_storage',
  'external_ai_processing',
  'data_exchange',
  'notifications',
] as const;

export type ConsentType = (typeof consentTypes)[number];
export type ConsentDecision = 'granted' | 'denied' | 'withdrawn';

export type EffectiveConsent = {
  decision: ConsentDecision;
  effectiveAt: number;
  expiresAt: number | null;
};

export function canRecordConsentDecision(
  current: ConsentDecision | null,
  next: ConsentDecision,
) {
  if (next !== 'withdrawn') return true;
  return current === 'granted';
}

export function assertConsentDecisionTransition(
  current: ConsentDecision | null,
  next: ConsentDecision,
) {
  if (!canRecordConsentDecision(current, next)) {
    throw new Error(
      `Недопустимое изменение согласия: ${current ?? 'none'} -> ${next}`,
    );
  }
}

export function isConsentEffective(
  consent: EffectiveConsent | null | undefined,
  at = Date.now(),
) {
  return Boolean(
    consent?.decision === 'granted' &&
      consent.effectiveAt <= at &&
      (consent.expiresAt === null || consent.expiresAt > at),
  );
}
