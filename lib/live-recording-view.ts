import type { LocalSpeechToken } from './live-local-speech-client';

// Display only: never use this filter for persistence, exports or AI source selection.
export function recordingViewTokens(
  tokens: LocalSpeechToken[], baselineIds: readonly string[], includeEarlier: boolean,
): LocalSpeechToken[] {
  if (includeEarlier) return tokens;
  const baseline = new Set(baselineIds);
  return tokens.filter((token) => !token.sourceId || !baseline.has(token.sourceId));
}
