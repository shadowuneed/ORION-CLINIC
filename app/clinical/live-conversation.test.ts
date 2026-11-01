import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LocalSpeechToken, SpeechActivity, TranscriptionStatus } from '@/lib/live-local-speech-client';
import type { ClinicalSnapshot } from '@/lib/clinical/contracts';
import { encounterFixture } from '@/lib/clinical/test-fixtures';
import { conversationClock, conversationLines } from '@/lib/clinical/live-conversation';
import { LiveConversation } from './live-conversation';
import { ClinicalEncounterWorkspace } from './encounter-workspace';

const speech = vi.hoisted(() => ({
  status: 'idle' as TranscriptionStatus, activity: 'idle' as SpeechActivity,
  finalTokens: [] as LocalSpeechToken[], provisionalTokens: [] as LocalSpeechToken[],
  error: null as string | null, engine: null, recordedAudio: null,
  recordingStatus: 'idle', recordingError: null,
  start: vi.fn(), stop: vi.fn(), reset: vi.fn(), getCaptureStatus: vi.fn(() => 'idle'),
}));
vi.mock('@/lib/live-local-speech-client', () => ({ useLocalSpeechTranscription: () => speech }));

const segment = (id: string, sequence: number, role: 'doctor' | 'patient' | 'unknown', text: string): ClinicalSnapshot['transcript'][number] => ({
  id, sequence, role, text, encounterId: 'encounter-1', language: 'ru', startedAtMs: 5000,
  endedAtMs: 6000, createdAt: '2026-10-07T12:00:00.000Z',
});
const token = (sourceId: string | undefined, segmentIndex: number, text: string, speaker = 'doctor'): LocalSpeechToken => ({
  sourceId, segmentIndex, text, speaker, isFinal: true, version: 1,
  startMs: 0, endMs: 1000, confidence: null, language: 'kk',
});
function render(status: TranscriptionStatus, activity: SpeechActivity = 'idle', overrides = {}) {
  return renderToStaticMarkup(createElement(LiveConversation, {
    segments: [], tokens: [], status, activity, elapsed: 0, error: null, completed: false, ...overrides,
  }));
}
function button(html: string, text: string) {
  return (html.match(/<button\b[^>]*>[\s\S]*?<\/button>/g) ?? []).find(markup => markup.includes(text)) ?? '';
}
beforeEach(() => {
  speech.status = 'idle'; speech.activity = 'idle'; speech.finalTokens = []; speech.provisionalTokens = []; speech.error = null;
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('SSR must not send audio, transcript, or AI requests'); }));
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe('conversation-first encounter regression boundaries', () => {
  it('deduplicates authoritative replies and orders resumed sessions by database sequence, not recording time', () => {
    const saved = [segment('second', 7, 'patient', 'Сохранённая реплика пациента'), segment('first', 6, 'unknown', 'Начало разговора')];
    const captured = [token('second', 7, 'Не показывать повтор'), token('third', 8, 'Новая сохранённая реплика врача')];
    const lines = conversationLines(saved, captured);
    expect(lines.map(line => line.id)).toEqual(['first', 'second', 'third']);
    expect(lines[1].text).toBe('Сохранённая реплика пациента');
    const html = render('streaming', 'listening', { segments: saved, tokens: captured });
    expect(html).toContain('3 реплик'); expect(html).not.toContain('Не показывать повтор');
    expect(html.indexOf('Начало разговора')).toBeLessThan(html.indexOf('Сохранённая реплика пациента'));
    expect(html.indexOf('Сохранённая реплика пациента')).toBeLessThan(html.indexOf('Новая сохранённая реплика врача'));
    expect(html).toContain('Говорящий не определён'); expect(html).toContain('Пациент'); expect(html).toContain('Врач');
  });
  it('does not invent partial speech or present an unpersisted token as a saved turn', () => {
    const tokens = [token(undefined, 1, 'Не сохранено'), { ...token('partial', 2, 'Предварительное слово'), isFinal: false }];
    const html = render('streaming', 'recognizing', { tokens });
    expect(html).toContain('0 реплик'); expect(html).toContain('Распознаём реплику');
    expect(html).not.toContain('Не сохранено'); expect(html).not.toContain('Предварительное слово');
    expect(html).not.toContain('Микрофон не работает');
  });
  it.each([
    ['requesting', 'idle', 'Разрешите доступ к микрофону'],
    ['connecting', 'idle', 'Подключаем расшифровку'],
    ['streaming', 'listening', 'Микрофон включён · ожидаем речь'],
    ['streaming', 'speaking', 'Слышу речь'],
    ['streaming', 'recognizing', 'Распознаём реплику'],
    ['stopping', 'idle', 'Сохраняем последние слова'],
  ] as const)('shows an honest %s/%s status without fabricated text', (status, activity, label) => {
    const html = render(status, activity);
    expect(html).toContain(label); expect(html).toContain('0 реплик');
    expect(html).not.toContain('<blockquote');
  });
  it('preserves readable saved speech after a capture error', () => {
    const html = render('error', 'idle', { segments: [segment('saved', 1, 'patient', 'Уже сохранённый разговор')], error: 'Речевой сервис недоступен.' });
    expect(html).toContain('Уже сохранённый разговор'); expect(html).toContain('role="alert"');
    expect(html).toContain('Речевой сервис недоступен.'); expect(html).toContain('Запись остановлена');
  });
  it.each(['requesting', 'connecting'] as const)('keeps cancellation enabled while %s instead of trapping the user in microphone permission', status => {
    speech.status = status;
    const data = encounterFixture(); data.consents[0].externalAiProcessing = true;
    const html = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1', initialSnapshot: data }));
    const cancel = button(html, 'Отменить подключение');
    expect(cancel).not.toBe(''); expect(cancel).not.toContain('disabled');
    expect(html).toContain('Подсказки выключены'); expect(html).not.toContain('Приостановить подсказки ИИ');
  });
  it('disables completion while the final utterance is draining', () => {
    speech.status = 'stopping';
    const html = renderToStaticMarkup(createElement(ClinicalEncounterWorkspace, { encounterId: 'encounter-1', initialSnapshot: encounterFixture() }));
    expect(button(html, 'Сохраняем последние слова…')).toContain('disabled=""');
    expect(html).not.toContain('Сохранить заключение и завершить');
  });
  it('keeps transcript HTML inert and reports only the supplied recording duration', () => {
    const html = render('streaming', 'speaking', { elapsed: 65.9, segments: [segment('saved', 1, 'patient', '<script>private()</script>')] });
    expect(html).toContain('&lt;script&gt;private()&lt;/script&gt;'); expect(html).not.toContain('<script>');
    expect(html).toContain('01:05'); expect(conversationClock(-1)).toBe('00:00');
    expect(conversationClock(3661)).toBe('61:01');
  });
});
