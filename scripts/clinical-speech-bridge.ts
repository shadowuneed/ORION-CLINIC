import { createHash, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { clinicalTranscriptAppendSchema, type ClinicalActor, type ClinicalCommandResult, type ClinicalInternalCommand, type ClinicalSnapshot } from '../lib/clinical/contracts';
import { SpeechProviderError, type SpeechToTextProvider } from '../lib/providers/speech-to-text';
import { parseAndValidateClinicalAnalysis, type ClinicalAnalysisProvider } from '../lib/providers/clinical-analysis';
import { ClinicalAnalysisProviderError } from '../lib/providers/groq-clinical-analysis';
import { emptyEncounterNote, hasClinicalNote, mergeEmptyDraftFields, noteFingerprint } from '../lib/clinical/encounter-workflow';
import { LIVE_ANALYSIS_INTERVAL_MS, LIVE_ANALYSIS_MAX_CHARACTERS, LIVE_ANALYSIS_MAX_SEGMENTS, LIVE_ANALYSIS_MIN_CHARACTERS,
  liveAnalysisRequestSchema, liveAnalysisResponseSchema, type LiveAnalysisReady, type LiveAnalysisSource } from '../lib/clinical/live-analysis';

if (typeof window !== 'undefined') throw new Error('Clinical speech bridge is server-only.');

export type ClinicalSpeechRepository = {
  snapshot(actor: ClinicalActor, revalidate?: () => Promise<void>): Promise<ClinicalSnapshot>;
  patient(actor: ClinicalActor, patientId: string, revalidate?: () => Promise<void>): Promise<ClinicalSnapshot>;
  command(actor: ClinicalActor, command: ClinicalInternalCommand, revalidate?: () => Promise<void>): Promise<ClinicalCommandResult>;
};
export type ClinicalSpeechRequest = { request: Request; actor: ClinicalActor; revalidate: () => Promise<void> };
type Segment = { id: string; version: number; segmentIndex: number; text: string; role: string; language: string; startedAtMs: number; endedAtMs: number };
type Run = {
  id: string; owner: string; encounterId: string; upstreamId: string; nextIndex: number; expiresAt: number;
  busy: boolean; retry: { index: number; hash: string; key: string } | null;
  last: { index: number; hash: string; segment: Segment } | null;
};
class Rejected extends Error { constructor(readonly code: string, readonly status: number, readonly publicMessage: string, readonly retryAfterMs?: number) { super(code); } }
const sessionInput = z.object({ encounterId: z.string().min(1).max(160), doctorFirst: z.literal(true).optional() }).strict();
const closeInput = z.object({ encounterId: z.string().min(1).max(160), sessionId: z.string().uuid(), status: z.enum(['completed', 'cancelled']).optional() }).strict();
const headersInput = z.object({ encounterId: z.string().min(1).max(160), sessionId: z.string().uuid(), index: z.string().regex(/^\d{1,6}$/).transform(Number).pipe(z.number().int().min(0).max(100000)) });
const TTL_MS = 20 * 60_000;
const analysisInput = z.object({ encounterId: z.string().min(1).max(160), expectedVersion: z.number().int().positive(), idempotencyKey: z.string().uuid() }).strict();
const LIVE_CACHE_TTL_MS = 5 * 60_000;
type LiveJob = { encounterId: string; revision: string; consentVersion: number; controller: AbortController; promise: Promise<LiveAnalysisReady> };
type LiveActor = { nextAllowedAt: number; expiresAt: number; touchedAt: number; job: LiveJob | null;
  cache: { consentVersion: number; response: LiveAnalysisReady } | null };

async function abortableAnalysis<T>(run: () => Promise<T>, signal: AbortSignal): Promise<T> {
  let onAbort: (() => void) | undefined;
  try {
    return await new Promise<T>((resolve, reject) => {
      onAbort = () => reject(new Rejected('ANALYSIS_UNAVAILABLE', 503, 'ИИ-подсказки остановлены. Запись разговора продолжается.'));
      if (signal.aborted) { onAbort(); return; }
      signal.addEventListener('abort', onAbort, { once: true });
      // A provider that ignores AbortSignal must not keep an actor's slot forever.
      Promise.resolve().then(() => { signal.throwIfAborted(); return run(); }).then(resolve, reject);
    });
  } finally { if (onAbort) signal.removeEventListener('abort', onAbort); }
}

function reply(status: number, data: unknown, retryAfterMs?: number) {
  return Response.json(data, { status, headers: { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    ...(retryAfterMs ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) } : {}) } });
}
async function boundedBody(request: Request, max: number) {
  const declared = Number(request.headers.get('content-length') ?? 0);
  if (declared > max) throw new Rejected('BODY_TOO_LARGE', 413, 'Слишком большой фрагмент.');
  const reader = request.body?.getReader();
  if (!reader) return new Uint8Array();
  const chunks: Uint8Array[] = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.length;
      if (length > max) { await reader.cancel(); throw new Rejected('BODY_TOO_LARGE', 413, 'Слишком большой фрагмент.'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(length); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  return body;
}
async function readJson(request: Request) {
  if (!/^application\/json(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Rejected('JSON_REQUIRED', 415, 'Ожидается JSON.');
  try { return JSON.parse(new TextDecoder().decode(await boundedBody(request, 4096))) as unknown; }
  catch (error) { if (error instanceof Rejected) throw error; throw new Rejected('INVALID_REQUEST', 400, 'Проверьте параметры записи.'); }
}
function validWav(audio: Uint8Array) {
  if (audio.byteLength < 46 || audio.byteLength > 800000) return false;
  const view = new DataView(audio.buffer, audio.byteOffset, audio.byteLength);
  const ascii = (offset: number, value: string) => [...value].every((char, i) => audio[offset + i] === char.charCodeAt(0));
  return ascii(0, 'RIFF') && ascii(8, 'WAVE') && ascii(12, 'fmt ') && ascii(36, 'data') &&
    view.getUint32(4, true) === audio.byteLength - 8 && view.getUint32(16, true) === 16 &&
    view.getUint16(20, true) === 1 && view.getUint16(22, true) === 1 && view.getUint32(24, true) === 16000 &&
    view.getUint32(28, true) === 32000 && view.getUint16(32, true) === 2 && view.getUint16(34, true) === 16 &&
    view.getUint32(40, true) === audio.byteLength - 44 && (audio.byteLength - 44) % 2 === 0;
}

/** Local STT writes only canonical PostgreSQL text and never retains audio.
 * The separate analysis route sends canonical text to the optional AI provider
 * only on an explicit request with current external-processing consent. */
export function createClinicalSpeechBridge(options: { repository: ClinicalSpeechRepository; provider: SpeechToTextProvider; analysisProvider?: ClinicalAnalysisProvider; now?: () => number }) {
  const runs = new Map<string, Run>(); const now = options.now ?? Date.now;
  const pendingStarts = new Set<string>(); const activeAnalysis = new Set<string>();
  const liveActors = new Map<string, LiveActor>(); let closing = false;
  const owner = (actor: ClinicalActor) => JSON.stringify([actor.issuer, actor.subject]);
  const dispose = async (run: Run) => {
    runs.delete(run.id);
    await options.provider.deleteSession(run.upstreamId, AbortSignal.timeout(3000)).catch(() => undefined);
  };
  const authorize = async ({ actor, revalidate }: ClinicalSpeechRequest, encounterId: string) => {
    await revalidate();
    const snapshot = await options.repository.snapshot(actor, revalidate);
    const encounter = snapshot.encounters.find(item => item.id === encounterId && item.practitionerId === snapshot.practitioner.id);
    if (!encounter) throw new Rejected('NOT_FOUND', 404, 'Приём не найден или не назначен вам.');
    if (encounter.status !== 'in_progress') throw new Rejected('ENCOUNTER_CLOSED', 409, 'Приём уже завершён.');
    const consent = snapshot.consents.find(item => item.encounterId === encounterId);
    if (!consent?.care || !consent.transcriptStorage || !consent.localAudioProcessing) {
      throw new Rejected('SPEECH_CONSENT_REQUIRED', 409, 'Зафиксируйте решения пациента для лечения, хранения текста и локальной обработки аудио.');
    }
    await revalidate();
  };
  const analysisContext = async ({ actor, revalidate }: ClinicalSpeechRequest, encounterId: string) => {
    await revalidate();
    const global = await options.repository.snapshot(actor, revalidate);
    const owned = global.encounters.find(item => item.id === encounterId && item.practitionerId === global.practitioner.id);
    if (!owned) throw new Rejected('NOT_FOUND', 404, 'Приём не найден или не назначен вам.');
    const snapshot = await options.repository.patient(actor, owned.patientId, revalidate);
    const encounter = snapshot.encounters.find(item => item.id === encounterId && item.practitionerId === snapshot.practitioner.id);
    if (!encounter) throw new Rejected('NOT_FOUND', 404, 'Приём не найден или не назначен вам.');
    if (encounter.status !== 'in_progress') throw new Rejected('ENCOUNTER_CLOSED', 409, 'Приём уже завершён.');
    const consent = snapshot.consents.find(item => item.encounterId === encounter.id);
    if (!consent?.care || !consent.transcriptStorage || !consent.externalAiProcessing) throw new Rejected('AI_CONSENT_REQUIRED', 409, 'Для подсказок нужно отдельное решение пациента о передаче текста ИИ.');
    const transcript = snapshot.transcript.filter(item => item.encounterId === encounter.id).sort((a, b) => a.sequence - b.sequence);
    await revalidate(); return { encounter, consent, transcript };
  };
  const liveWindow = (transcript: ClinicalSnapshot['transcript']) => {
    const window: ClinicalSnapshot['transcript'] = []; let characters = 0;
    for (const segment of [...transcript].reverse()) {
      if (window.length >= LIVE_ANALYSIS_MAX_SEGMENTS || characters + segment.text.length > LIVE_ANALYSIS_MAX_CHARACTERS) break;
      window.unshift(segment); characters += segment.text.length;
    }
    if (transcript.length && !window.length) throw new Rejected('TRANSCRIPT_TOO_LARGE', 413, 'Последняя реплика слишком длинная для живой подсказки. Сохранённая расшифровка доступна врачу.');
    const revision = createHash('sha256').update(JSON.stringify(window.map(item => [item.id, item.sequence, item.role, item.language, item.text]))).digest('hex');
    const source: LiveAnalysisSource = { revision, lastSequence: transcript.at(-1)?.sequence ?? 0, segmentIds: window.map(item => item.id), analyzedSegments: window.length, totalSegments: transcript.length };
    return { window, source, characters };
  };
  const changedSource = (selected: ClinicalSnapshot['transcript'], current: ClinicalSnapshot['transcript']) => {
    const currentById = new Map(current.map(segment => [segment.id, segment]));
    return selected.some(segment => {
      const latest = currentById.get(segment.id);
      return !latest || latest.sequence !== segment.sequence || latest.text !== segment.text || latest.role !== segment.role || latest.language !== segment.language;
    });
  };
  const liveAnalysis = async (input: ClinicalSpeechRequest, encounterId: string) => {
    const actorKey = owner(input.actor); const context = await analysisContext(input, encounterId);
    const { window, source, characters } = liveWindow(context.transcript);
    const waiting = (reason: 'more_text' | 'cooldown' | 'busy', retryAfterMs: number) => reply(200, liveAnalysisResponseSchema.parse({
      schemaVersion: 1, status: 'waiting', encounterId, source, generatedAt: new Date(now()).toISOString(), retryAfterMs,
      reviewRequired: true, reason, summary: null, suggestions: [], cached: false,
    }));
    if (characters < LIVE_ANALYSIS_MIN_CHARACTERS) { await input.revalidate(); return waiting('more_text', 0); }
    if (!options.analysisProvider) throw new Rejected('ANALYSIS_NOT_CONFIGURED', 503, 'ИИ-подсказки пока не подключены. Запись разговора продолжает работать.');
    for (const [key, state] of liveActors) if (!state.job && state.expiresAt <= now()) liveActors.delete(key);
    let state = liveActors.get(actorKey);
    if (!state) {
      if (liveActors.size >= 32) {
        const oldest = [...liveActors].filter(([, item]) => !item.job).sort((a, b) => a[1].touchedAt - b[1].touchedAt)[0];
        if (oldest) liveActors.delete(oldest[0]); else return waiting('busy', LIVE_ANALYSIS_INTERVAL_MS);
      }
      state = { nextAllowedAt: 0, expiresAt: now() + LIVE_CACHE_TTL_MS, touchedAt: now(), job: null, cache: null }; liveActors.set(actorKey, state);
    }
    state.touchedAt = now();
    if (state.cache && (state.cache.consentVersion !== context.consent.version || state.cache.response.encounterId !== encounterId)) state.cache = null;
    const cached = state.cache?.response.source.revision === source.revision ? state.cache.response : null;
    let result: LiveAnalysisReady; let reused = !!cached;
    if (cached) result = cached;
    else {
      if (state.job && (state.job.encounterId !== encounterId || state.job.revision !== source.revision || state.job.consentVersion !== context.consent.version)) return waiting('busy', 1500);
      if (state.job) { reused = true; result = await state.job.promise; }
      else {
        if (state.nextAllowedAt > now()) return waiting('cooldown', Math.ceil(state.nextAllowedAt - now()));
        const reservation = `${actorKey}:${encounterId}`;
        if (activeAnalysis.has(reservation) || [...liveActors.values()].filter(item => item.job).length >= 8) return waiting('busy', LIVE_ANALYSIS_INTERVAL_MS);
        const provider = options.analysisProvider; const controller = new AbortController();
        const segments = window.map(item => ({ id: item.id, version: 1, role: item.role, language: item.language === 'auto' ? 'unknown' as const : item.language, text: item.text }));
        state.nextAllowedAt = now() + LIVE_ANALYSIS_INTERVAL_MS; state.expiresAt = now() + LIVE_CACHE_TTL_MS;
        activeAnalysis.add(reservation);
        const liveState = state;
        const deadline = setTimeout(() => controller.abort(), 35000);
        const promise = Promise.resolve().then(async () => {
          const request = { segments, signal: controller.signal, mode: 'live' as const };
          const generated = await abortableAnalysis(async () => {
            await input.revalidate();
            // Queueing/identity validation may have yielded since the first read.
            // Fetch authority, consent and the selected canonical evidence again
            // immediately before egress; do not keep a database lock over HTTP.
            const preflight = await analysisContext(input, encounterId);
            controller.signal.throwIfAborted();
            if (preflight.consent.version !== context.consent.version || changedSource(window, preflight.transcript)) {
              liveState.cache = null;
              throw new Rejected('ANALYSIS_CONTEXT_CHANGED', 409, 'Согласие или исходные реплики изменились. Текст не отправлен ИИ.');
            }
            return provider.analyze(request);
          }, controller.signal);
          if (closing || controller.signal.aborted) throw new Rejected('ANALYSIS_UNAVAILABLE', 503, 'ИИ-подсказки остановлены.');
          const output = parseAndValidateClinicalAnalysis(generated.output, segments);
          return liveAnalysisResponseSchema.parse({ schemaVersion: 1, status: 'ready', encounterId, summary: output.summary,
            suggestions: output.suggestions.map(item => ({ ...item,
              id: createHash('sha256').update(JSON.stringify([encounterId, item.category, item.riskLevel, item.title, item.content, item.evidence])).digest('hex').slice(0, 32),
              evidence: item.evidence.map(evidence => ({ ...evidence, sequence: window.find(segment => segment.id === evidence.sourceId)!.sequence })),
            })), source, generatedAt: new Date(now()).toISOString(), cached: false, retryAfterMs: LIVE_ANALYSIS_INTERVAL_MS, reviewRequired: true,
          }) as LiveAnalysisReady;
        }).catch(error => {
          if (error instanceof ClinicalAnalysisProviderError && error.code === 'rate_limited') {
            const retryAfterMs = Math.min(3_600_000, Math.max(LIVE_ANALYSIS_INTERVAL_MS, Math.ceil(error.retryAfterSeconds ?? 60) * 1000));
            liveState.nextAllowedAt = Math.max(liveState.nextAllowedAt, now() + retryAfterMs); liveState.expiresAt = Math.max(liveState.expiresAt, liveState.nextAllowedAt);
            throw new Rejected('ANALYSIS_RATE_LIMITED', 429, 'Лимит ИИ временно исчерпан. Запись разговора продолжается; подсказки можно обновить позже.', retryAfterMs);
          }
          throw error;
        }).finally(() => { clearTimeout(deadline); if (liveState.job?.promise === promise) liveState.job = null; activeAnalysis.delete(reservation); });
        state.job = { encounterId, revision: source.revision, consentVersion: context.consent.version, controller, promise };
        result = await promise;
      }
    }
    // This route is read-only. Concurrent note edits and newly appended speech
    // do not make an older, explicitly identified evidence window a signed fact.
    const latest = await analysisContext(input, encounterId);
    if (closing || latest.consent.version !== context.consent.version || changedSource(window, latest.transcript)) {
      state.cache = null; throw new Rejected('ANALYSIS_CONTEXT_CHANGED', 409, 'Согласие или исходные реплики изменились. Ответ ИИ не показан.');
    }
    await input.revalidate();
    // Keep only one bounded result for this actor; never cache raw provider data.
    state.cache = { consentVersion: context.consent.version, response: result }; state.expiresAt = Math.max(now() + LIVE_CACHE_TTL_MS, state.nextAllowedAt);
    return reply(200, { ...result, cached: reused, retryAfterMs: Math.max(0, Math.ceil(state.nextAllowedAt - now())) });
  };
  return {
    async handle(input: ClinicalSpeechRequest): Promise<Response | null> {
      const { request, actor, revalidate } = input;
      const url = new URL(request.url); const prefix = '/api/clinical/v1/speech';
      if (!url.pathname.startsWith(`${prefix}/`) && !['/api/clinical/v1/analysis', '/api/clinical/v1/analysis/live'].includes(url.pathname)) return null;
      let currentRun: Run | undefined;
      let startReservation: string | undefined; let analysisReservation: string | undefined;
      try {
        await revalidate();
        if (closing) throw new Rejected('SPEECH_UNAVAILABLE', 503, 'Локальный сервис завершает работу.');
        if (url.pathname === '/api/clinical/v1/analysis/live') {
          if (request.method !== 'POST') throw new Rejected('METHOD_NOT_ALLOWED', 405, 'Ожидается POST.');
          const parsed = liveAnalysisRequestSchema.safeParse(await readJson(request));
          if (!parsed.success) throw new Rejected('INVALID_REQUEST', 400, 'Проверьте параметры живого анализа.');
          return await liveAnalysis(input, parsed.data.encounterId);
        }
        if (url.pathname === '/api/clinical/v1/analysis') {
          if (request.method !== 'POST') throw new Rejected('METHOD_NOT_ALLOWED', 405, 'Ожидается POST.');
          const parsed = analysisInput.safeParse(await readJson(request));
          if (!parsed.success) throw new Rejected('INVALID_REQUEST', 400, 'Проверьте параметры анализа.');
          if (!options.analysisProvider) throw new Rejected('ANALYSIS_NOT_CONFIGURED', 503, 'Groq пока не настроен. Расшифровка сохранена, приём можно заполнить вручную.');
          const globalSnapshot = await options.repository.snapshot(actor, revalidate);
          const authorized = globalSnapshot.encounters.find(item => item.id === parsed.data.encounterId && item.practitionerId === globalSnapshot.practitioner.id);
          if (!authorized) throw new Rejected('NOT_FOUND', 404, 'Приём не найден или не назначен вам.');
          const snapshot = await options.repository.patient(actor, authorized.patientId, revalidate);
          const encounter = snapshot.encounters.find(item => item.id === parsed.data.encounterId && item.practitionerId === snapshot.practitioner.id);
          if (!encounter) throw new Rejected('NOT_FOUND', 404, 'Приём не найден или не назначен вам.');
          const consent = snapshot.consents.find(item => item.encounterId === encounter.id);
          if (!consent?.care || !consent.transcriptStorage || !consent.externalAiProcessing) throw new Rejected('AI_CONSENT_REQUIRED', 409, 'Для анализа нужно отдельное решение пациента о передаче текста Groq.');
          if (encounter.status !== 'in_progress' || encounter.version !== parsed.data.expectedVersion) throw new Rejected('VERSION_CONFLICT', 409, 'Запись изменилась. Обновите её перед анализом.');
          const lock = `${owner(actor)}:${encounter.id}`;
          if (activeAnalysis.has(lock) || liveActors.get(owner(actor))?.job) throw new Rejected('ANALYSIS_BUSY', 409, 'ИИ уже обрабатывает разговор. Повторите подготовку черновика после завершения подсказок.');
          activeAnalysis.add(lock); analysisReservation = lock;
          const transcript = snapshot.transcript.filter(item => item.encounterId === encounter.id).sort((a, b) => a.sequence - b.sequence);
          if (!transcript.length) throw new Rejected('NO_TRANSCRIPT', 409, 'Сохранённых реплик для анализа пока нет.');
          // A bounded current window is explicit: older source remains visible, never silently replaced.
          const window = transcript.slice(-24);
          if (window.reduce((total, segment) => total + segment.text.length, 0) > 48000) throw new Rejected('TRANSCRIPT_TOO_LARGE', 413, 'Слишком большой фрагмент для одного анализа. Сохранённый текст доступен для ручной проверки.');
          const segments = window.map(item => ({ id: item.id, version: 1, role: item.role, language: item.language === 'auto' ? 'unknown' as const : item.language, text: item.text }));
          await revalidate();
          const preflight = await analysisContext(input, encounter.id);
          if (preflight.encounter.version !== encounter.version || preflight.consent.version !== consent.version || changedSource(window, preflight.transcript)) {
            throw new Rejected('VERSION_CONFLICT', 409, 'Согласие, запись или исходные реплики изменились. Текст не отправлен ИИ.');
          }
          const result = await options.analysisProvider.analyze({ segments, signal: AbortSignal.timeout(35000) });
          const output = parseAndValidateClinicalAnalysis(result.output, segments);
          const proposed = emptyEncounterNote();
          const mapping = { complaints: 'complaints', history_of_present_illness: 'history', past_medical_history: 'history', allergy_status: 'history', objective_findings: 'examination', preliminary_diagnosis: 'assessment', examination_plan: 'plan', treatment_plan: 'plan' } as const;
          for (const section of output.sections) {
            const key = mapping[section.code];
            const evidence = section.evidence.map(item => `реплика ${window.find(segment => segment.id === item.sourceId)?.sequence ?? '?'}: «${item.quote}»`).join('; ');
            proposed[key] += `${proposed[key] ? '\n\n' : ''}${section.content}\nИсточники ИИ-черновика — ${evidence}`;
          }
          const existing = snapshot.notes.find(item => item.id === encounter.currentNoteId)?.content ?? emptyEncounterNote();
          const content = mergeEmptyDraftFields(existing, proposed);
          if (!hasClinicalNote(content) || noteFingerprint(content) === noteFingerprint(existing)) throw new Rejected('NO_NEW_DRAFT', 409, 'Нет новых обоснованных полей. Вручную заполненные разделы не заменены.');
          // Re-check actual consent after provider latency; the versioned save catches concurrent edits.
          const latest = await options.repository.snapshot(actor, revalidate);
          const latestEncounter = latest.encounters.find(item => item.id === encounter.id && item.practitionerId === latest.practitioner.id);
          const latestConsent = latest.consents.find(item => item.encounterId === encounter.id);
          if (!latestEncounter || latestEncounter.status !== 'in_progress' || latestEncounter.version !== encounter.version || !latestConsent?.care || !latestConsent.transcriptStorage || !latestConsent.externalAiProcessing) throw new Rejected('VERSION_CONFLICT', 409, 'Согласие или запись изменились. Ответ ИИ не сохранён.');
          const receipt = await options.repository.command(actor, { type: 'note.save', encounterId: encounter.id, expectedVersion: encounter.version,
            content, source: 'ai_assisted', idempotencyKey: parsed.data.idempotencyKey }, revalidate);
          await revalidate();
          return reply(200, { ...receipt, source: 'ai_assisted', status: 'draft', analyzedSegments: window.length, totalSegments: transcript.length });
        }
        for (const run of runs.values()) if (!run.busy && run.expiresAt <= now()) void dispose(run);
        if (url.pathname === `${prefix}/health` && request.method === 'GET') {
          await authorize(input, url.searchParams.get('encounterId') ?? '');
          const health = await options.provider.health(AbortSignal.timeout(5000));
          await revalidate();
          if (!health.ready) throw new Rejected('SPEECH_UNAVAILABLE', 503, 'Локальный речевой сервис не готов. Текст приёма можно заполнять вручную.');
          return reply(200, { ready: true, provider: health.provider, model: health.model });
        }
        if (url.pathname === `${prefix}/session` && request.method === 'POST') {
          const parsed = sessionInput.safeParse(await readJson(request));
          if (!parsed.success) throw new Rejected('INVALID_REQUEST', 400, 'Проверьте параметры записи.');
          await authorize(input, parsed.data.encounterId);
          const reservation = `${owner(actor)}:${parsed.data.encounterId}`;
          if (pendingStarts.has(reservation) || [...runs.values()].some(run => run.owner === owner(actor) && run.encounterId === parsed.data.encounterId)) throw new Rejected('SESSION_ACTIVE', 409, 'Запись этого приёма уже открыта. Завершите её в другой вкладке.');
          if (runs.size + pendingStarts.size >= 32) throw new Rejected('SPEECH_BUSY', 503, 'Речевой сервис занят. Повторите позже.');
          pendingStarts.add(reservation); startReservation = reservation;
          const session = await options.provider.createSession({ doctorFirst: true, signal: AbortSignal.timeout(10000) });
          const run: Run = { id: randomUUID(), owner: owner(actor), encounterId: parsed.data.encounterId, upstreamId: session.upstreamSessionId,
            nextIndex: 0, expiresAt: now() + TTL_MS, busy: false, retry: null, last: null };
          try { await authorize(input, run.encounterId); } catch (error) { await dispose(run); throw error; }
          runs.set(run.id, run);
          return reply(200, { session: { id: run.id, provider: session.provider, model: session.model, modelVersion: session.modelVersion } });
        }
        if (url.pathname === `${prefix}/session` && request.method === 'DELETE') {
          const parsed = closeInput.safeParse(await readJson(request));
          if (!parsed.success) throw new Rejected('INVALID_REQUEST', 400, 'Проверьте параметры записи.');
          const run = runs.get(parsed.data.sessionId);
          if (run && (run.owner !== owner(actor) || run.encounterId !== parsed.data.encounterId)) throw new Rejected('NOT_FOUND', 404, 'Речевая сессия не найдена.');
          if (run?.busy) throw new Rejected('SPEECH_BUSY', 409, 'Дождитесь сохранения последней реплики.');
          if (run) await dispose(run);
          await revalidate();
          return reply(200, { completed: true });
        }
        if (url.pathname !== `${prefix}/transcribe` || request.method !== 'POST') throw new Rejected('NOT_FOUND', 404, 'Маршрут не найден.');
        const headers = headersInput.safeParse({ encounterId: request.headers.get('x-orion-encounter-id'), sessionId: request.headers.get('x-orion-speech-session-id'), index: request.headers.get('x-orion-utterance-index') });
        if (!headers.success) throw new Rejected('INVALID_REQUEST', 400, 'Проверьте параметры реплики.');
        if (!/^audio\/wav(?:;|$)/i.test(request.headers.get('content-type') ?? '')) throw new Rejected('WAV_REQUIRED', 415, 'Ожидается аудио WAV 16 кГц mono.');
        const run = runs.get(headers.data.sessionId);
        if (!run || run.owner !== owner(actor) || run.encounterId !== headers.data.encounterId || run.expiresAt <= now()) throw new Rejected('SESSION_EXPIRED', 409, 'Речевая сессия истекла. Запустите запись снова.');
        if (run.busy) throw new Rejected('SPEECH_BUSY', 409, 'Предыдущая реплика ещё сохраняется.');
        run.busy = true; currentRun = run;
        const audio = await boundedBody(request, 800000);
        if (!validWav(audio)) throw new Rejected('INVALID_AUDIO', 400, 'Ожидается непустой WAV 16 кГц mono PCM16.');
        const hash = createHash('sha256').update(audio).digest('hex');
        const index = headers.data.index;
        await authorize(input, run.encounterId);
        if (run.last?.index === index && run.last.hash === hash) return reply(200, { segment: run.last.segment, replay: true });
        if (index !== run.nextIndex || run.retry && (run.retry.index !== index || run.retry.hash !== hash)) throw new Rejected('SPEECH_SEQUENCE_CONFLICT', 409, 'Порядок реплик изменился. Запустите запись снова.');
        run.retry ??= { index, hash, key: randomUUID() };
        const result = await options.provider.transcribe({ upstreamSessionId: run.upstreamId, utteranceIndex: index, audio, signal: AbortSignal.timeout(45000) });
        if (result.upstreamSessionId !== run.upstreamId || result.utteranceIndex !== index) throw new SpeechProviderError('invalid_response');
        await authorize(input, run.encounterId);
        if (!result.text.trim()) { run.retry = null; run.expiresAt = now() + TTL_MS; return reply(200, { skipped: 'no_speech', segment: null }); }
        const command = clinicalTranscriptAppendSchema.parse({ type: 'transcript.append', idempotencyKey: run.retry.key, encounterId: run.encounterId,
          sessionId: run.id, utteranceIndex: index, inputHash: hash, text: result.text,
          role: result.role === 'doctor' || result.role === 'patient' ? result.role : 'unknown',
          language: result.language === 'ru' || result.language === 'kk' ? result.language : 'auto', startedAtMs: result.startedAtMs, endedAtMs: result.endedAtMs });
        const persisted = await options.repository.command(actor, command, revalidate);
        await revalidate();
        const segment: Segment = { id: persisted.resourceId, version: 1, segmentIndex: persisted.version, text: command.text,
          role: command.role, language: command.language, startedAtMs: command.startedAtMs, endedAtMs: command.endedAtMs };
        run.last = { index, hash, segment }; run.nextIndex += 1; run.retry = null; run.expiresAt = now() + TTL_MS;
        return reply(200, { segment, replay: persisted.replayed, audioRetention: false });
      } catch (error) {
        if (error instanceof Rejected) return reply(error.status, { error: { code: error.code, message: error.publicMessage }, ...(error.retryAfterMs ? { retryAfterMs: error.retryAfterMs } : {}) }, error.retryAfterMs);
        const code = error && typeof error === 'object' && 'code' in error ? error.code : null;
        if (code === 'CLINICAL_ACCESS_DENIED') return reply(403, { error: { code, message: 'Доступ к этому приёму изменился.' } });
        if (code === 'SESSION_CHANGED') return reply(409, { error: { code, message: 'Сеанс изменился. Войдите заново.' } });
        return reply(503, { error: url.pathname === '/api/clinical/v1/analysis/live'
          ? { code: 'ANALYSIS_UNAVAILABLE', message: 'Подсказки ИИ не подтверждены. Запись разговора продолжается, медицинские записи не изменены.' }
          : url.pathname === '/api/clinical/v1/analysis'
          ? { code: 'ANALYSIS_UNAVAILABLE', message: 'Черновик ИИ не подтверждён. Сохранённые записи не заменены. Проверьте подключение Groq или заполните приём вручную.' }
          : { code: 'SPEECH_UNAVAILABLE', message: 'Реплика не подтверждена в базе. Проверьте локальный STT и повторите запись; ранее сохранённый текст остаётся в приёме.' } });
      } finally {
        if (currentRun) currentRun.busy = false;
        if (startReservation) pendingStarts.delete(startReservation);
        if (analysisReservation) activeAnalysis.delete(analysisReservation);
      }
    },
    async close() { closing = true; for (const state of liveActors.values()) state.job?.controller.abort(); liveActors.clear(); await Promise.all([...runs.values()].map(dispose)); },
  };
}
