import { describe, expect, it } from 'vitest';
import {
  getLiveConsentState,
  getLiveConsent,
  isLiveConsentEffective,
  mapLiveRecommendations,
  mapLiveTranscript,
  mergeLiveTokens,
  type LiveWorkspaceSnapshot,
} from './live-authoritative-workspace';

function grantedConsent(
  type: LiveWorkspaceSnapshot['consents'][number]['type'],
  externalProcessor: string | null = null,
): LiveWorkspaceSnapshot['consents'][number] {
  return {
    id: `consent-${type}`,
    type,
    decision: 'granted',
    version: 1,
    noticeLanguage: 'ru',
    source: 'verbal',
    policyVersion: 'synthetic-v1',
    policyHash: 'a'.repeat(64),
    externalProcessor,
    capturedBy: 'Тестовый врач',
    occurredAt: 1_000,
    effectiveAt: 1_000,
    expiresAt: null,
  };
}

function snapshot(): LiveWorkspaceSnapshot {
  return {
    encounter: {
      id: 'encounter-test',
      status: 'in_progress',
      version: 3,
      startedAt: 1_000,
      patient: {
        id: 'patient-test',
        displayName: 'Тестовый пациент',
        medicalRecordNumber: 'SYN-01',
      },
    },
    transcript: [
      {
        id: 'segment-1',
        version: 2,
        role: 'doctor',
        language: 'ru',
        text: '  Что вас беспокоит? ',
        startedAtMs: 0,
        endedAtMs: 1_000,
        state: 'corrected',
      },
    ],
    consents: [
      grantedConsent('care'),
      grantedConsent('transcript_storage'),
      grantedConsent('transient_audio_processing'),
      grantedConsent('external_ai_processing', 'groq'),
    ],
    recommendations: [
      {
        id: 'suggestion-1',
        eyebrow: 'Что уточнить',
        tone: 'question',
        original: {
          title: 'Уточнить длительность',
          content: 'Спросите, когда начались симптомы.',
          evidence: [{ sourceId: 'segment-1' }],
        },
        currentDerivative: null,
        review: { state: 'pending', version: 4 },
        effectiveTitle: null,
        effectiveContent: null,
      },
    ],
  };
}

describe('authoritative live workspace adapters', () => {
  it('requires the exact consent set for speech and Groq analysis', () => {
    const state = getLiveConsentState(snapshot(), 2_000);
    expect(state.speechReady).toBe(true);
    expect(state.analysisReady).toBe(true);
    expect(state.audioRetention).toBe(false);

    const changed = snapshot();
    changed.consents[3] = grantedConsent(
      'external_ai_processing',
      'another-provider',
    );
    expect(getLiveConsentState(changed, 2_000).analysisReady).toBe(false);
  });

  it('exposes the current version and rejects expired consent', () => {
    const changed = snapshot();
    changed.consents[0] = {
      ...grantedConsent('care'),
      version: 7,
      expiresAt: 1_500,
    };

    expect(getLiveConsent(changed, 'care')?.version).toBe(7);
    expect(isLiveConsentEffective(changed, 'care', undefined, 1_400)).toBe(true);
    expect(isLiveConsentEffective(changed, 'care', undefined, 1_600)).toBe(false);
    expect(getLiveConsentState(changed, 1_600).speechReady).toBe(false);
  });

  it('keeps immutable transcript identifiers and versions', () => {
    expect(mapLiveTranscript(snapshot())).toEqual([
      expect.objectContaining({
        sourceId: 'segment-1',
        version: 2,
        speaker: 'doctor',
        text: 'Что вас беспокоит?',
      }),
    ]);
  });

  it('maps server review state and optimistic version references', () => {
    const mapped = mapLiveRecommendations(
      snapshot(),
      '2026-09-03T00:00:00.000Z',
    );
    expect(mapped.ledger['suggestion-1']?.status).toBe('pending');
    expect(mapped.references['suggestion-1']).toEqual({
      expectedVersion: 4,
      derivativeVersionId: null,
    });
    expect(mapped.analysis?.suggestions[0]?.evidenceSegmentIds).toEqual([
      'segment-1',
    ]);
  });

  it('deduplicates a freshly captured segment after a server reload', () => {
    const mappedSegment = mapLiveTranscript(snapshot())[0]!;
    expect(mergeLiveTokens([mappedSegment], [{ ...mappedSegment, text: 'Новая версия' }])).toHaveLength(1);
    expect(mergeLiveTokens([mappedSegment], [{ ...mappedSegment, text: 'Новая версия' }])[0]?.text).toBe(
      'Новая версия',
    );
  });
});
