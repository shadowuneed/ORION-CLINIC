import type { ClinicalAnalysisResponse, ClinicalSuggestion } from './clinical-contract';
import type { ConsentDecision, ConsentType } from './domain/consent';
import type { SuggestionLedgerEntry } from './encounter-history';
import type { LocalSpeechToken } from './live-local-speech-client';

export type LiveEncounterStatus =
  | 'draft'
  | 'ready'
  | 'in_progress'
  | 'review'
  | 'finalized'
  | 'amended'
  | 'cancelled';

export type LiveConsent = {
  id: string;
  type: ConsentType;
  decision: ConsentDecision;
  version: number;
  noticeLanguage: 'ru' | 'kk';
  source: 'written' | 'verbal' | 'digital';
  policyVersion: string;
  policyHash: string;
  externalProcessor: string | null;
  capturedBy: string;
  occurredAt: number;
  effectiveAt: number;
  expiresAt: number | null;
};

export type LiveWorkspaceSnapshot = {
  encounter: {
    id: string;
    status: LiveEncounterStatus;
    version: number;
    startedAt: number | null;
    patient: {
      id: string;
      displayName: string;
      medicalRecordNumber: string;
    };
  };
  transcript: Array<{
    id: string;
    version: number;
    role: 'doctor' | 'patient' | 'other' | 'unknown';
    language: 'ru' | 'kk' | 'mixed' | 'unknown';
    text: string;
    startedAtMs: number;
    endedAtMs: number;
    state: 'provisional' | 'final' | 'corrected';
  }>;
  consents: LiveConsent[];
  recommendations: Array<{
    id: string;
    eyebrow: string;
    tone: 'question' | 'safety' | 'action';
    original: {
      title: string;
      content: string;
      evidence: Array<{ sourceId: string; quote?: string }>;
    };
    currentDerivative: {
      id: string;
      version: number;
      title: string;
      content: string;
    } | null;
    review: {
      state:
        | 'pending'
        | 'accepted'
        | 'edited_and_accepted'
        | 'rejected'
        | 'expired';
      version: number;
    };
    effectiveTitle: string | null;
    effectiveContent: string | null;
  }>;
};

export type LiveRecommendationReference = {
  expectedVersion: number;
  derivativeVersionId: string | null;
};

export function getLiveConsent(
  snapshot: LiveWorkspaceSnapshot,
  type: ConsentType,
) {
  return snapshot.consents.find((item) => item.type === type) ?? null;
}

export function isLiveConsentEffective(
  snapshot: LiveWorkspaceSnapshot,
  type: ConsentType,
  externalProcessor?: string,
  at = Date.now(),
) {
  const consent = getLiveConsent(snapshot, type);
  return Boolean(
    consent?.decision === 'granted' &&
      consent.effectiveAt <= at &&
      (consent.expiresAt === null || consent.expiresAt > at) &&
      (!externalProcessor || consent.externalProcessor === externalProcessor),
  );
}

export function getLiveConsentState(
  snapshot: LiveWorkspaceSnapshot,
  at = Date.now(),
) {
  const care = isLiveConsentEffective(snapshot, 'care', undefined, at);
  const transcript = isLiveConsentEffective(
    snapshot,
    'transcript_storage',
    undefined,
    at,
  );
  const localAudio = isLiveConsentEffective(
    snapshot,
    'transient_audio_processing',
    undefined,
    at,
  );
  const audioRetention = isLiveConsentEffective(
    snapshot,
    'audio_retention',
    undefined,
    at,
  );
  const externalAi = isLiveConsentEffective(
    snapshot,
    'external_ai_processing',
    'groq',
    at,
  );
  return {
    care,
    transcript,
    localAudio,
    audioRetention,
    externalAi,
    speechReady: care && transcript && localAudio,
    analysisReady: care && transcript && externalAi,
  };
}

export function mapLiveTranscript(
  snapshot: LiveWorkspaceSnapshot,
): LocalSpeechToken[] {
  return snapshot.transcript
    .filter(
      (segment) =>
        (segment.state === 'final' || segment.state === 'corrected') &&
        segment.text.trim().length > 0,
    )
    .map((segment) => ({
      sourceId: segment.id,
      version: segment.version,
      text: segment.text.trim(),
      startMs: segment.startedAtMs,
      endMs: segment.endedAtMs,
      confidence: null,
      isFinal: true,
      speaker:
        segment.role === 'doctor' || segment.role === 'patient'
          ? segment.role
          : null,
      language: segment.language,
    }));
}

function categoryFor(
  recommendation: LiveWorkspaceSnapshot['recommendations'][number],
): ClinicalSuggestion['category'] {
  if (/лекар|препарат|медикамент/iu.test(recommendation.eyebrow)) {
    return 'medication';
  }
  if (recommendation.tone === 'question') return 'clarification';
  if (recommendation.tone === 'safety') return 'safety';
  return 'option';
}

export function mapLiveRecommendations(
  snapshot: LiveWorkspaceSnapshot,
  generatedAt = new Date().toISOString(),
) {
  const ledger: Record<string, SuggestionLedgerEntry> = {};
  const references: Record<string, LiveRecommendationReference> = {};
  const suggestions: ClinicalSuggestion[] = [];

  for (const recommendation of snapshot.recommendations) {
    const title =
      recommendation.effectiveTitle ??
      recommendation.currentDerivative?.title ??
      recommendation.original.title;
    const clinicianPrompt =
      recommendation.effectiveContent ??
      recommendation.currentDerivative?.content ??
      recommendation.original.content;
    const category = categoryFor(recommendation);
    const suggestion: ClinicalSuggestion = {
      id: recommendation.id,
      category,
      priority: recommendation.tone === 'safety' ? 'attention' : 'routine',
      title,
      rationale: recommendation.original.content,
      clinicianPrompt,
      evidenceSegmentIds: recommendation.original.evidence.map(
        (item) => item.sourceId,
      ),
    };
    const status =
      recommendation.review.state === 'rejected'
        ? ('discarded' as const)
        : recommendation.review.state === 'accepted' ||
            recommendation.review.state === 'edited_and_accepted'
          ? ('accepted' as const)
          : ('pending' as const);
    ledger[recommendation.id] = {
      id: recommendation.id,
      suggestion,
      draftTitle: title,
      draftPrompt: clinicianPrompt,
      status,
      firstSeenAt: generatedAt,
      lastSeenAt: generatedAt,
      decidedAt: status === 'pending' ? undefined : generatedAt,
      acceptedSnapshot:
        status === 'accepted'
          ? {
              title,
              clinicianPrompt,
              category,
              evidenceSegmentIds: [...suggestion.evidenceSegmentIds],
              acceptedAt: generatedAt,
            }
          : undefined,
    };
    references[recommendation.id] = {
      expectedVersion: recommendation.review.version,
      derivativeVersionId: recommendation.currentDerivative?.id ?? null,
    };
    suggestions.push(suggestion);
  }

  const analysis: ClinicalAnalysisResponse | null = suggestions.length
    ? {
        provider: 'groq',
        model: 'openai/gpt-oss-120b',
        generatedAt,
        summary: `Серверных подсказок в текущей версии: ${suggestions.length}. Каждая требует решения врача.`,
        suggestions,
      }
    : null;

  return {
    analysis,
    ledger,
    references,
    suggestionIds: suggestions.map((suggestion) => suggestion.id),
  };
}

export function mergeLiveTokens(
  persisted: LocalSpeechToken[],
  captured: LocalSpeechToken[],
) {
  const tokens = new Map<string, LocalSpeechToken>();
  for (const [index, token] of [...persisted, ...captured].entries()) {
    const key =
      token.sourceId ??
      `${token.startMs ?? 'unknown'}:${token.speaker ?? 'unknown'}:${index}:${token.text}`;
    tokens.set(key, token);
  }
  return [...tokens.values()].sort(
    (left, right) => (left.startMs ?? Number.MAX_SAFE_INTEGER) - (right.startMs ?? Number.MAX_SAFE_INTEGER),
  );
}
