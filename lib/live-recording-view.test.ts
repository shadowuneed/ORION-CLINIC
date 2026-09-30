import { describe, expect, it } from 'vitest';
import { recordingViewTokens } from './live-recording-view';
import type { LocalSpeechToken } from './live-local-speech-client';

const token = (sourceId?: string, version = 1): LocalSpeechToken => ({
  sourceId, version, text: 'Test speech', startMs: 0, endMs: 1000,
  confidence: null, isFinal: true, speaker: 'doctor', language: 'ru',
});

describe('recording transcript view', () => {
  it('hides pre-existing transcript without mutating encounter data', () => {
    const old = token('old');
    const fresh = token('new');
    const tokens = [old, fresh];
    expect(recordingViewTokens(tokens, ['old'], false)).toEqual([fresh]);
    expect(tokens).toEqual([old, fresh]);
    expect(recordingViewTokens(tokens, ['old'], true)).toBe(tokens);
  });
  it('keeps newly persisted and unpersisted speech visible at equal timestamps', () => {
    const tokens = [token('old'), token('new'), token()];
    expect(recordingViewTokens(tokens, ['old'], false)).toEqual(tokens.slice(1));
  });
  it('does not present a corrected old turn as new speech', () => {
    expect(recordingViewTokens([token('old', 2)], ['old'], false)).toEqual([]);
  });
  it('shows the whole transcript in a new recording with no baseline', () => {
    const tokens = [token('new')];
    expect(recordingViewTokens(tokens, [], false)).toEqual(tokens);
  });
});
