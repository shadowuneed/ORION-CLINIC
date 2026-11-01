import { describe, expect, it, vi } from 'vitest';
import { createClinicalSpeechBridge, type ClinicalSpeechRepository } from '../../scripts/clinical-speech-bridge';
import { encounterFixture } from './test-fixtures';
import type { ClinicalInternalCommand, ClinicalSnapshot } from './contracts';
import type { SpeechToTextProvider } from '../providers/speech-to-text';
import type { ClinicalAnalysisProvider } from '../providers/clinical-analysis';
import { ClinicalAnalysisProviderError } from '../providers/groq-clinical-analysis';
import { liveAnalysisResponseSchema, LIVE_ANALYSIS_INTERVAL_MS } from './live-analysis';

const actor = { issuer: 'local', subject: 'doctor-1' };
function wav() {
  const body = new Uint8Array(364); const view = new DataView(body.buffer);
  const string = (at: number, value: string) => [...value].forEach((char, i) => { body[at + i] = char.charCodeAt(0); });
  string(0, 'RIFF'); string(8, 'WAVE'); string(12, 'fmt '); string(36, 'data');
  view.setUint32(4, body.length - 8, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
  view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 320, true);
  return body;
}
function harness(data = encounterFixture(), analyze?: ClinicalAnalysisProvider['analyze']) {
  const writes: ClinicalInternalCommand[] = [];
  const repository: ClinicalSpeechRepository = {
    snapshot: vi.fn(async () => structuredClone(data)), patient: vi.fn(async () => structuredClone(data)),
    command: vi.fn(async (_actor, command) => { writes.push(command); return { resourceId: 'segment-1', encounterId: 'encounter-1', version: 1, replayed: false }; }),
  };
  const provider: SpeechToTextProvider = {
    health: vi.fn(async () => ({ reachable: true, ready: true, provider: 'local', model: 'model', detail: 'ready' })),
    createSession: vi.fn(async () => ({ upstreamSessionId: 'private-upstream', provider: 'local', model: 'model', modelVersion: 'v1' })),
    transcribe: vi.fn<SpeechToTextProvider['transcribe']>(async input => ({ upstreamSessionId: input.upstreamSessionId, utteranceIndex: input.utteranceIndex, text: 'Учебный исходный текст.',
      role: 'patient', language: 'ru', roleSource: 'model', speakerConfidenceBasisPoints: null, startedAtMs: 0, endedAtMs: 1000, durationMs: 1000, processingMs: 1, providerPayload: {} })),
    deleteSession: vi.fn(async () => undefined),
  };
  let clock = 1;
  const bridge = createClinicalSpeechBridge({ repository, provider, analysisProvider: analyze ? { analyze } : undefined, now: () => clock });
  const request = async (path: string, method: string, body?: unknown, selectedActor = actor) => {
    const req = new Request(`http://127.0.0.1:3200/api/clinical/v1/${path}`, { method, headers: body ? { 'Content-Type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined });
    return bridge.handle({ request: req, actor: selectedActor, revalidate: async () => undefined });
  };
  const create = async () => {
    const response = await request('speech/session', 'POST', { encounterId: 'encounter-1', doctorFirst: true });
    const body = await response!.json() as { session: { id: string } }; return body.session.id;
  };
  const transcribe = async (sessionId: string, index = 0, selectedActor = actor, body = wav()) => bridge.handle({
    request: new Request('http://127.0.0.1:3200/api/clinical/v1/speech/transcribe', { method: 'POST', headers: { 'Content-Type': 'audio/wav', 'X-Orion-Encounter-Id': 'encounter-1', 'X-Orion-Speech-Session-Id': sessionId, 'X-Orion-Utterance-Index': String(index) }, body: new Uint8Array(body) }),
    actor: selectedActor, revalidate: async () => undefined,
  });
  return { bridge, writes, repository, provider, request, create, transcribe, advance: (ms = 21 * 60000) => { clock += ms; } };
}

describe('PostgreSQL speech bridge', () => {
  it('requires all three decisions before creating or sending any local audio', async () => {
    const data = encounterFixture(); data.consents[0].localAudioProcessing = false;
    const test = harness(data); const response = await test.request('speech/session', 'POST', { encounterId: 'encounter-1' });
    expect(response?.status).toBe(409); expect(test.provider.createSession).not.toHaveBeenCalled(); expect(test.writes).toEqual([]);
  });
  it('persists canonical text before returning a segment and supports exact retries', async () => {
    const test = harness(); const sessionId = await test.create();
    const response = await test.transcribe(sessionId); expect(response?.status).toBe(200);
    expect(test.writes[0]).toMatchObject({ type: 'transcript.append', encounterId: 'encounter-1', sessionId, utteranceIndex: 0, text: 'Учебный исходный текст.' });
    expect(JSON.stringify(test.writes)).not.toContain('private-upstream'); expect(JSON.stringify(test.writes)).not.toContain('audio');
    const body = await response!.json(); expect(body).toMatchObject({ segment: { id: 'segment-1', version: 1, text: 'Учебный исходный текст.' }, audioRetention: false });
    expect((await test.transcribe(sessionId))?.status).toBe(200); expect(test.writes).toHaveLength(1); expect(test.provider.transcribe).toHaveBeenCalledTimes(1);
  });
  it('denies another account and out-of-order segments without invoking STT', async () => {
    const test = harness(); const session = await test.create();
    expect((await test.transcribe(session, 0, { ...actor, subject: 'another-doctor' }))?.status).toBe(409);
    expect((await test.transcribe(session, 3))?.status).toBe(409); expect(test.provider.transcribe).not.toHaveBeenCalled();
  });
  it('checks consent again after inference and does not persist if it was withdrawn', async () => {
    const data = encounterFixture(); const test = harness(data); const session = await test.create();
    const original = test.provider.transcribe;
    test.provider.transcribe = async input => { const result = await original(input); data.consents[0].transcriptStorage = false; return result; };
    expect((await test.transcribe(session))?.status).toBe(409); expect(test.writes).toEqual([]);
  });
  it('rejects malformed audio, duplicate sessions and expired sessions', async () => {
    const test = harness(); const session = await test.create();
    expect((await test.request('speech/session', 'POST', { encounterId: 'encounter-1' }))?.status).toBe(409);
    expect((await test.transcribe(session, 0, actor, new Uint8Array(50)))?.status).toBe(400);
    test.advance(); expect((await test.transcribe(session))?.status).toBe(409); expect(test.provider.transcribe).not.toHaveBeenCalled();
  });
  it('never emits provider details, SQL or secret-bearing errors', async () => {
    const test = harness(); const session = await test.create();
    test.provider.transcribe = async () => { throw new Error('secret-provider-key-and-patient-text'); };
    const response = await test.transcribe(session); expect(response?.status).toBe(503); expect(await response!.text()).not.toContain('secret-provider-key'); expect(test.writes).toEqual([]);
  });
});

function aiData(): ClinicalSnapshot {
  const data = encounterFixture(); data.consents[0].externalAiProcessing = true;
  data.transcript = [{ id: 'segment-source', encounterId: 'encounter-1', sequence: 1, role: 'patient', language: 'ru', text: 'Учебный исходный текст.', startedAtMs: 0, endedAtMs: 1000, createdAt: data.generatedAt }];
  return data;
}
const analyze: ClinicalAnalysisProvider['analyze'] = async () => ({ provider: 'groq', model: 'model', modelVersion: 'v1', policyVersion: 'policy', durationMs: 1, raw: {},
  output: { summary: 'Непроверенный черновик', suggestions: [{ category: 'clarification', riskLevel: 'informational', title: 'Уточнение', content: 'Уточнить сведения?', evidence: [{ sourceId: 'segment-source', quote: 'Учебный исходный текст.' }] }],
    sections: [{ code: 'history_of_present_illness', content: 'ИИ-черновик по исходному тексту.', evidence: [{ sourceId: 'segment-source', quote: 'Учебный исходный текст.' }] },
      { code: 'complaints', content: 'Нельзя заменять запись врача.', evidence: [{ sourceId: 'segment-source', quote: 'Учебный исходный текст.' }] }] } });

describe('explicit PostgreSQL AI draft preparation', () => {
  const input = { encounterId: 'encounter-1', expectedVersion: 2, idempotencyKey: 'a3265ebe-f02d-4bcf-93a2-c85c4c623a97' };
  it('requires separate external AI consent before a provider request', async () => {
    const data = aiData(); data.consents[0].externalAiProcessing = false; const mock = vi.fn(analyze); const test = harness(data, mock);
    expect((await test.request('analysis', 'POST', input))?.status).toBe(409); expect(mock).not.toHaveBeenCalled();
  });
  it('loads patient-scoped canonical transcript and saves only a draft without replacing the doctor', async () => {
    const data = aiData(); const test = harness(data, analyze); const response = await test.request('analysis', 'POST', input);
    expect(response?.status).toBe(200); expect(test.repository.patient).toHaveBeenCalled();
    expect(test.writes).toHaveLength(1); const saved = test.writes[0]; expect(saved.type).toBe('note.save');
    if (saved.type !== 'note.save') throw new Error('Wrong command');
    expect(saved.content.complaints).toBe(data.notes[0].content.complaints);
    expect(saved.content.history).toContain('Источники ИИ-черновика'); expect(saved.content.examination).toBe(''); expect(saved.source).toBe('ai_assisted');
    expect(test.writes.some(command => command.type === 'note.publish' || command.type === 'referral.create')).toBe(false);
  });
  it('discards generated output when the doctor edits the note during inference', async () => {
    const data = aiData(); const test = harness(data, async input => { const result = await analyze(input); data.encounters[0].version += 1; return result; });
    expect((await test.request('analysis', 'POST', input))?.status).toBe(409); expect(test.writes).toEqual([]);
  });
  it('rejects unsupported source quotes before saving any clinical field', async () => {
    const test = harness(aiData(), async input => { const result = await analyze(input); result.output.sections[0].evidence[0].quote = 'Никто этого не говорил'; return result; });
    expect((await test.request('analysis', 'POST', input))?.status).toBe(503); expect(test.writes).toEqual([]);
  });
  it.each(['consent', 'consent-version', 'note-version', 'source'] as const)('rechecks %s immediately before sending a structured draft request', async change => {
    const data = aiData(); const mock = vi.fn(analyze); const test = harness(data, mock); let validations = 0;
    const response = await test.bridge.handle({
      request: new Request('http://127.0.0.1:3200/api/clinical/v1/analysis', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(input) }), actor,
      revalidate: async () => {
        validations += 1;
        if (validations !== 2) return; // The first snapshot was already loaded.
        if (change === 'consent') data.consents[0].externalAiProcessing = false;
        if (change === 'consent-version') data.consents[0].version += 1;
        if (change === 'note-version') data.encounters[0].version += 1;
        if (change === 'source') data.transcript[0].text += ' Изменено перед отправкой.';
      },
    });
    expect(response?.status).toBe(409); expect(mock).not.toHaveBeenCalled(); expect(test.writes).toEqual([]);
  });
});

function liveData(): ClinicalSnapshot {
  const data = aiData();
  data.transcript[0].text += ' Это исключительно учебный материал для проверки источников и согласий в автоматическом тесте.';
  return data;
}
const liveInput = { encounterId: 'encounter-1' };
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function appendTranscript(data: ClinicalSnapshot) {
  const previous = data.transcript.at(-1)!;
  data.transcript.push({ ...previous, id: `segment-${previous.sequence + 1}`, sequence: previous.sequence + 1, text: 'Новая учебная реплика после начала анализа.' });
}

describe('read-only live PostgreSQL suggestions', () => {
  it('accepts only an encounter selector and requires current explicit consent', async () => {
    const data = liveData(); const mock = vi.fn(analyze); const test = harness(data, mock);
    expect((await test.request('analysis/live', 'GET'))?.status).toBe(405);
    expect((await test.request('analysis/live', 'POST', { ...liveInput, transcript: 'Browser text' }))?.status).toBe(400);
    expect((await test.request('analysis/live', 'POST', { ...liveInput, actor }))?.status).toBe(400);
    expect((await test.request('analysis/live/extra', 'POST', liveInput))).toBeNull();
    for (const key of ['care', 'transcriptStorage', 'externalAiProcessing'] as const) {
      data.consents[0][key] = false;
      expect((await test.request('analysis/live', 'POST', liveInput))?.status).toBe(409);
      data.consents[0][key] = true;
    }
    data.encounters[0].practitionerId = 'doctor-2';
    expect((await test.request('analysis/live', 'POST', liveInput))?.status).toBe(404);
    data.encounters[0].practitionerId = 'doctor-1'; data.encounters[0].status = 'completed';
    expect((await test.request('analysis/live', 'POST', liveInput))?.status).toBe(409);
    expect(mock).not.toHaveBeenCalled(); expect(test.writes).toEqual([]);
  });
  it('waits for meaningful canonical text without provider use and reports missing configuration honestly', async () => {
    const mock = vi.fn(analyze); const short = harness(aiData(), mock);
    const response = await short.request('analysis/live', 'POST', liveInput);
    expect(response?.status).toBe(200);
    expect(liveAnalysisResponseSchema.parse(await response!.json())).toMatchObject({ status: 'waiting', reason: 'more_text', retryAfterMs: 0, suggestions: [] });
    expect(mock).not.toHaveBeenCalled(); expect(short.writes).toEqual([]);
    const unconfigured = await harness(liveData()).request('analysis/live', 'POST', liveInput);
    expect(unconfigured?.status).toBe(503); expect(await unconfigured!.json()).toMatchObject({ error: { code: 'ANALYSIS_NOT_CONFIGURED' } });
  });
  it('returns exact canonical evidence and source revision, without saving a note or publishing facts', async () => {
    const data = liveData(); data.consents[0].localAudioProcessing = false; // Stored text can be analyzed independently of audio.
    const mock = vi.fn(analyze); const test = harness(data, mock);
    const response = await test.request('analysis/live', 'POST', liveInput);
    expect(response?.status).toBe(200);
    const result = liveAnalysisResponseSchema.parse(await response!.json());
    expect(result).toMatchObject({ status: 'ready', encounterId: 'encounter-1', cached: false, reviewRequired: true,
      source: { lastSequence: 1, segmentIds: ['segment-source'], analyzedSegments: 1, totalSegments: 1 },
      suggestions: [{ evidence: [{ sourceId: 'segment-source', sequence: 1, quote: 'Учебный исходный текст.' }] }] });
    expect(result.source.revision).toMatch(/^[a-f0-9]{64}$/);
    expect(mock.mock.calls[0][0]).toMatchObject({ mode: 'live', segments: [{ id: 'segment-source', text: data.transcript[0].text }] });
    expect(test.repository.patient).toHaveBeenCalledWith(actor, 'patient-1', expect.any(Function));
    expect(test.repository.command).not.toHaveBeenCalled(); expect(test.writes).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('ИИ-черновик по исходному тексту');
  });
  it('reuses only the same actor/encounter/consent/source, rechecking authorization even on a cache hit', async () => {
    const data = liveData(); const mock = vi.fn(analyze); const test = harness(data, mock);
    const first = liveAnalysisResponseSchema.parse(await (await test.request('analysis/live', 'POST', liveInput))!.json());
    const cached = await (await test.request('analysis/live', 'POST', liveInput))!.json();
    expect(cached).toMatchObject({ cached: true, source: first.source, suggestions: first.suggestions });
    expect(mock).toHaveBeenCalledTimes(1);
    data.consents[0].externalAiProcessing = false;
    expect((await test.request('analysis/live', 'POST', liveInput))?.status).toBe(409);
    data.consents[0].externalAiProcessing = true; data.consents[0].version += 1;
    expect(await (await test.request('analysis/live', 'POST', liveInput))!.json()).toMatchObject({ status: 'waiting', reason: 'cooldown' });
    test.advance(LIVE_ANALYSIS_INTERVAL_MS);
    expect(await (await test.request('analysis/live', 'POST', liveInput))!.json()).toMatchObject({ cached: false });
    // The fake repository authorizes both issuers; the bridge must not share their cache.
    expect(await (await test.request('analysis/live', 'POST', liveInput, { issuer: 'another-authorized-issuer', subject: actor.subject }))!.json()).toMatchObject({ cached: false });
    expect(mock).toHaveBeenCalledTimes(3); expect(test.writes).toEqual([]);
  });
  it('coalesces identical concurrent requests and never starts another request while a newer window waits', async () => {
    const data = liveData(); const started = deferred<void>(); const release = deferred<void>();
    const mock = vi.fn<ClinicalAnalysisProvider['analyze']>(async input => { started.resolve(); await release.promise; return analyze(input); });
    const test = harness(data, mock); const first = test.request('analysis/live', 'POST', liveInput); await started.promise;
    const reads = vi.mocked(test.repository.patient).mock.calls.length;
    const second = test.request('analysis/live', 'POST', liveInput);
    // Wait for the second request's scoped authorization, without timing-dependent sleep.
    await vi.waitFor(() => expect(test.repository.patient).toHaveBeenCalledTimes(reads + 1));
    appendTranscript(data);
    expect(await (await test.request('analysis/live', 'POST', liveInput))!.json()).toMatchObject({ status: 'waiting', reason: 'busy' });
    release.resolve(); const [a, b] = await Promise.all([first, second]);
    expect(a?.status).toBe(200); expect(b?.status).toBe(200); expect(mock).toHaveBeenCalledTimes(1);
    expect(await b!.json()).toMatchObject({ cached: true, source: { lastSequence: 1 } }); expect(test.writes).toEqual([]);
  });
  it('limits new windows to one provider attempt per interval, including invalid provider responses', async () => {
    const data = liveData(); const mock = vi.fn(analyze); const test = harness(data, mock);
    await test.request('analysis/live', 'POST', liveInput); appendTranscript(data);
    expect(await (await test.request('analysis/live', 'POST', liveInput))!.json()).toMatchObject({ status: 'waiting', reason: 'cooldown', retryAfterMs: 12000 });
    expect(mock).toHaveBeenCalledTimes(1); test.advance(12000);
    expect((await test.request('analysis/live', 'POST', liveInput))?.status).toBe(200); expect(mock).toHaveBeenCalledTimes(2);
    const failing = vi.fn<ClinicalAnalysisProvider['analyze']>(async () => { throw new Error('private provider information'); });
    const failed = harness(liveData(), failing); const response = await failed.request('analysis/live', 'POST', liveInput);
    expect(response?.status).toBe(503); expect(await response!.text()).not.toContain('private provider information');
    expect(await (await failed.request('analysis/live', 'POST', liveInput))!.json()).toMatchObject({ status: 'waiting', reason: 'cooldown' });
    expect(failing).toHaveBeenCalledTimes(1);
  });
  it('honors provider cooldown with sanitized 429 and Retry-After, without repeated upstream attempts', async () => {
    const mock = vi.fn<ClinicalAnalysisProvider['analyze']>(async () => { throw new ClinicalAnalysisProviderError('rate_limited', 'private key', 90); });
    const test = harness(liveData(), mock); const response = await test.request('analysis/live', 'POST', liveInput);
    expect(response?.status).toBe(429); expect(response!.headers.get('Retry-After')).toBe('90');
    expect(await response!.json()).toMatchObject({ error: { code: 'ANALYSIS_RATE_LIMITED' }, retryAfterMs: 90000 });
    test.advance(12000);
    expect(await (await test.request('analysis/live', 'POST', liveInput))!.json()).toMatchObject({ status: 'waiting', reason: 'cooldown', retryAfterMs: 78000 });
    expect(mock).toHaveBeenCalledTimes(1); expect(test.writes).toEqual([]);
  });
  it.each(['consent', 'consent-version', 'role', 'text', 'deleted', 'closed', 'owner'] as const)('discards a result after %s changes during inference', async change => {
    const data = liveData(); const test = harness(data, async input => {
      const result = await analyze(input);
      if (change === 'consent') data.consents[0].externalAiProcessing = false;
      if (change === 'consent-version') data.consents[0].version += 1;
      if (change === 'role') data.transcript[0].role = 'doctor';
      if (change === 'text') data.transcript[0].text += ' Изменено.';
      if (change === 'deleted') data.transcript = [];
      if (change === 'closed') data.encounters[0].status = 'completed';
      if (change === 'owner') data.encounters[0].practitionerId = 'doctor-2';
      return result;
    });
    const response = await test.request('analysis/live', 'POST', liveInput);
    expect([404, 409]).toContain(response?.status); expect(await response!.text()).not.toContain('Непроверенный черновик'); expect(test.writes).toEqual([]);
  });
  it('does not discard useful sourced hints when a note is edited or a new canonical segment is appended', async () => {
    const data = liveData(); const test = harness(data, async input => {
      const result = await analyze(input); data.encounters[0].version += 1; data.notes[0].content.plan = 'Запись врача'; appendTranscript(data); return result;
    });
    const response = await test.request('analysis/live', 'POST', liveInput);
    expect(response?.status).toBe(200); expect(await response!.json()).toMatchObject({ status: 'ready', source: { lastSequence: 1, totalSegments: 1 } });
    expect(data.notes[0].content.plan).toBe('Запись врача'); expect(test.writes).toEqual([]);
  });
  it('rejects invented evidence before returning any suggestion', async () => {
    const test = harness(liveData(), async input => { const output = await analyze(input); output.output.suggestions[0].evidence[0].quote = 'Несуществующая цитата'; return output; });
    const response = await test.request('analysis/live', 'POST', liveInput);
    expect(response?.status).toBe(503); expect(await response!.text()).not.toContain('Несуществующая цитата'); expect(test.writes).toEqual([]);
  });
  it('uses only the bounded latest window while identifying its place in the full transcript', async () => {
    const data = liveData(); const original = data.transcript[0];
    data.transcript = Array.from({ length: 30 }, (_, index) => ({ ...original, id: index === 29 ? 'segment-source' : `segment-${index + 1}`, sequence: index + 1 }));
    const mock = vi.fn(analyze); const test = harness(data, mock); const response = await test.request('analysis/live', 'POST', liveInput);
    expect(response?.status).toBe(200); expect(await response!.json()).toMatchObject({ source: { lastSequence: 30, analyzedSegments: 24, totalSegments: 30 } });
    expect(mock.mock.calls[0][0].segments).toHaveLength(24); expect(mock.mock.calls[0][0].segments[0].id).toBe('segment-7');
    data.transcript.at(-1)!.text = 'Я'.repeat(16001);
    expect((await test.request('analysis/live', 'POST', liveInput))?.status).toBe(413); expect(mock).toHaveBeenCalledTimes(1);
  });
  it('expires stored results and cancels late output when the bridge closes', async () => {
    const mock = vi.fn(analyze); const test = harness(liveData(), mock);
    await test.request('analysis/live', 'POST', liveInput); test.advance(5 * 60000 + 1);
    expect(await (await test.request('analysis/live', 'POST', liveInput))!.json()).toMatchObject({ cached: false }); expect(mock).toHaveBeenCalledTimes(2);
    const started = deferred<void>(); const release = deferred<void>(); let signal: AbortSignal | undefined;
    const closing = harness(liveData(), async input => { signal = input.signal; started.resolve(); await release.promise; return analyze(input); });
    const pending = closing.request('analysis/live', 'POST', liveInput); await started.promise; await closing.bridge.close();
    expect(signal?.aborted).toBe(true); expect((await pending)?.status).toBe(503); release.resolve(); expect(closing.writes).toEqual([]);
  });
  it('bounds live work across actors and frees reservations after settlement', async () => {
    const gate = deferred<void>(); const mock = vi.fn<ClinicalAnalysisProvider['analyze']>(async input => { await gate.promise; return analyze(input); });
    const test = harness(liveData(), mock); const requests: Promise<Response | null>[] = [];
    for (let index = 0; index < 8; index += 1) requests.push(test.request('analysis/live', 'POST', liveInput, { ...actor, issuer: `authorized-${index}` }));
    await vi.waitFor(() => expect(mock).toHaveBeenCalledTimes(8));
    const next = await test.request('analysis/live', 'POST', liveInput, { ...actor, issuer: 'authorized-9' });
    expect(await next!.json()).toMatchObject({ status: 'waiting', reason: 'busy' }); expect(mock).toHaveBeenCalledTimes(8);
    gate.resolve(); expect((await Promise.all(requests)).every(response => response?.status === 200)).toBe(true);
    expect((await test.request('analysis/live', 'POST', liveInput, { ...actor, issuer: 'authorized-9' }))?.status).toBe(200);
    expect(mock).toHaveBeenCalledTimes(9); expect(test.writes).toEqual([]);
  });
  it('ends a stalled provider at the deadline without exposing delayed output or retaining its busy slot', async () => {
    vi.useFakeTimers();
    try {
      const entered = deferred<void>(); const result = deferred<Awaited<ReturnType<ClinicalAnalysisProvider['analyze']>>>();
      const test = harness(liveData(), async () => { entered.resolve(); return result.promise; });
      const pending = test.request('analysis/live', 'POST', liveInput); await entered.promise;
      await vi.advanceTimersByTimeAsync(35000);
      expect((await pending)?.status).toBe(503);
      const followup = await test.request('analysis/live', 'POST', liveInput);
      expect(await followup!.json()).toMatchObject({ status: 'waiting', reason: 'cooldown' }); // Controlled test clock is unchanged.
      result.resolve(await analyze({ segments: [] })); expect(test.writes).toEqual([]);
    } finally { vi.useRealTimers(); }
  });
  it('revalidates the authenticated generation after inference instead of returning stale protected data', async () => {
    let valid = true; const test = harness(liveData(), async input => { const result = await analyze(input); valid = false; return result; });
    const response = await test.bridge.handle({
      request: new Request('http://127.0.0.1:3200/api/clinical/v1/analysis/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(liveInput) }), actor,
      revalidate: async () => { if (!valid) throw Object.assign(new Error('private details'), { code: 'SESSION_CHANGED' }); },
    });
    expect(response?.status).toBe(409); expect(await response!.json()).toMatchObject({ error: { code: 'SESSION_CHANGED' } }); expect(test.writes).toEqual([]);
  });
  it.each(['consent', 'consent-version', 'source', 'owner', 'closed'] as const)('never sends text after %s changes between initial authorization and actual provider start', async change => {
    const data = liveData(); const provider = vi.fn(analyze); const test = harness(data, provider);
    let validations = 0;
    const response = await test.bridge.handle({
      request: new Request('http://127.0.0.1:3200/api/clinical/v1/analysis/live', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(liveInput) }), actor,
      revalidate: async () => {
        validations += 1;
        // handle + initial context start/end are done. This awaited generation
        // check used to be the only check between queueing and external egress.
        if (validations !== 4) return;
        if (change === 'consent') data.consents[0].externalAiProcessing = false;
        if (change === 'consent-version') data.consents[0].version += 1;
        if (change === 'source') data.transcript[0].text += ' Исправлено до отправки.';
        if (change === 'owner') data.encounters[0].practitionerId = 'doctor-2';
        if (change === 'closed') data.encounters[0].status = 'completed';
      },
    });
    expect([404, 409]).toContain(response?.status); expect(provider).not.toHaveBeenCalled(); expect(test.writes).toEqual([]);
  });
});
