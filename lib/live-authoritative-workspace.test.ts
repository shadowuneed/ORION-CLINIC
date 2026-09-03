import { describe, expect, it } from 'vitest';
import {
  getLiveConsentState,
  mapLiveRecommendations,
  mapLiveTranscript,
  mergeLiveTokens,
  type LiveWorkspaceSnapshot,
} from './live-authoritative-workspace';

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
      { type: 'care', decision: 'granted', externalProcessor: null },
      {
        type: 'transcript_storage',
        decision: 'granted',
        externalProcessor: null,
      },
      {
        type: 'transient_audio_processing',
        decision: 'granted',
        externalProcessor: null,
      },
      {
        type: 'external_ai_processing',
        decision: 'granted',
        externalProcessor: 'groq',
      },
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
    const state = getLiveConsentState(snapshot());
    expect(state.speechReady).toBe(true);
    expect(state.analysisReady).toBe(true);
    expect(state.audioRetention).toBe(false);

    const changed = snapshot();
    changed.consents[3] = {
      type: 'external_ai_processing',
      decision: 'granted',
      externalProcessor: 'another-provider',
    };
    expect(getLiveConsentState(changed).analysisReady).toBe(false);
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
