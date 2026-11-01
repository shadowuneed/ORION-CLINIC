import type { ClinicalSnapshot } from './contracts';
import type { LocalSpeechToken } from '../live-local-speech-client';

export type ConversationLine = { id: string; sequence: number; text: string; role: 'doctor' | 'patient' | 'unknown'; language: string; createdAt: string | null };
/** Persisted speech responses can arrive before their next snapshot. Exact IDs
 * prevent duplicate bubbles; sequence preserves order across resumed clocks. */
export function conversationLines(segments: ClinicalSnapshot['transcript'], tokens: LocalSpeechToken[]): ConversationLine[] {
  const lines = new Map<string, ConversationLine>(segments.map(segment => [segment.id, {
    id: segment.id, sequence: segment.sequence, text: segment.text, role: segment.role, language: segment.language, createdAt: segment.createdAt,
  }]));
  for (const token of tokens) {
    if (!token.isFinal || !token.sourceId || !token.segmentIndex || lines.has(token.sourceId)) continue;
    lines.set(token.sourceId, { id: token.sourceId, sequence: token.segmentIndex, text: token.text,
      role: token.speaker === 'doctor' || token.speaker === 'patient' ? token.speaker : 'unknown', language: token.language, createdAt: null });
  }
  return [...lines.values()].sort((a, b) => a.sequence - b.sequence);
}
export function conversationClock(seconds: number) {
  const value = Math.max(0, Math.floor(seconds));
  return `${Math.floor(value / 60).toString().padStart(2, '0')}:${(value % 60).toString().padStart(2, '0')}`;
}
