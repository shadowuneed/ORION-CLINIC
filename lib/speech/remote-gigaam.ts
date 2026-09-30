/**
 * Unmounted control-plane foundation for a future dedicated GigaAM gateway.
 * This is NOT the loopback sidecar API or a SpeechToTextProvider implementation.
 * No audio/transcription/delete endpoint is implemented or selected as fallback.
 *
 * Deployment configuration and preparation evidence come only from trusted
 * server code. Shape validation is NOT credential/consent/assignment validation.
 * Before mounting: provision a dedicated authenticated gateway, enforce DNS/IP
 * egress at the network layer (these hostname checks do not stop rebinding),
 * approve processor-specific audio consent, and add durable run/revalidation,
 * upstream cleanup/idempotency and request-bound authorization. A timeout can
 * leave an upstream session allocated; never retry create automatically.
 */
if (typeof window !== 'undefined') {
  throw new Error('Remote speech control requires server execution');
}

const PROTOCOL = 'orion-gigaam-control/v1' as const;
const MAX_RESPONSE_BYTES = 16_384;
const MAX_RESPONSE_CHUNKS = 256;
const HEALTH_DEADLINE_MS = 5_000;
const CREATE_DEADLINE_MS = 10_000;

export type RemoteSpeechControlErrorCode =
  | 'invalid_configuration'
  | 'invalid_request'
  | 'unauthorized'
  | 'rate_limited'
  | 'unavailable'
  | 'timeout'
  | 'cancelled'
  | 'invalid_response';

export class RemoteSpeechControlError extends Error {
  constructor(readonly code: RemoteSpeechControlErrorCode) {
    super('Remote speech control request failed');
    this.name = 'RemoteSpeechControlError';
  }
}

type Pins = Readonly<{
  processorId: string;
  model: string;
  modelRevision: string;
}>;

type Configuration = Pins & Readonly<{
  mode: 'remote-gigaam';
  origin: string;
  serviceToken: string;
}>;

/** Reference-only evidence, neither a bearer capability nor a consent decision. */
export type RemoteSpeechPreparationEvidence = Readonly<{
  processorId: string;
  noticeVersion: number;
  consentEventId: string;
  consentVersion: number;
}>;

export type RemoteSpeechControlTransport = Readonly<{
  state: 'configured';
  capabilities: Readonly<{
    health: true;
    createSession: true;
    transcribe: false;
    deleteSession: false;
  }>;
  health(signal?: AbortSignal): Promise<Pins & Readonly<{ ready: boolean }>>;
  createSession(input: unknown, signal?: AbortSignal): Promise<Pins & Readonly<{
    upstreamSessionId: string;
    doctorFirst: boolean;
  }>>;
}>;

function fields(value: unknown, keys: readonly string[]): Record<string, unknown> {
  if (typeof value !== 'object' || value === null) throw new TypeError();
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) throw new TypeError();
  const ownKeys = Reflect.ownKeys(value);
  if (ownKeys.length !== keys.length || ownKeys.some(key => typeof key !== 'string' || !keys.includes(key))) {
    throw new TypeError();
  }
  const result: Record<string, unknown> = Object.create(null);
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor?.enumerable || !('value' in descriptor)) throw new TypeError();
    result[key] = descriptor.value;
  }
  return result;
}

function identifier(value: unknown, max = 128): string {
  if (typeof value !== 'string' || value.length > max || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)) {
    throw new TypeError();
  }
  return value;
}

function positiveVersion(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) throw new TypeError();
  return value as number;
}

function origin(value: unknown): string {
  if (typeof value !== 'string' || value.length > 261 || !/^https:\/\/[a-z0-9.-]+$/.test(value)) {
    throw new TypeError();
  }
  const url = new URL(value);
  const labels = url.hostname.split('.');
  if (url.origin !== value || labels.length < 2 || labels.some(label =>
    label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label),
  ) || !/^[a-z]{2,63}$/.test(labels.at(-1)!)) throw new TypeError();
  const forbiddenLabels = new Set([
    'localhost', 'local', 'localdomain', 'internal', 'intranet', 'corp',
    'lan', 'home', 'metadata', 'invalid', 'test', 'example', 'arpa',
  ]);
  if (labels.some(label => forbiddenLabels.has(label))) throw new TypeError();
  return value;
}

function configuration(value: unknown): Configuration | 'disabled' | 'unconfigured' {
  try {
    if (value === undefined || value === null) return 'unconfigured';
    // Inspect a data descriptor first; never invoke a configuration getter.
    const mode = Object.getOwnPropertyDescriptor(value, 'mode');
    if (mode && 'value' in mode && mode.value === 'disabled') {
      fields(value, ['mode']);
      return 'disabled';
    }
    const raw = fields(value, ['mode', 'origin', 'processorId', 'model', 'modelRevision', 'serviceToken']);
    if (raw.mode !== 'remote-gigaam' || typeof raw.serviceToken !== 'string' ||
      !/^[A-Za-z0-9_-]{32,256}$/.test(raw.serviceToken) ||
      typeof raw.modelRevision !== 'string' || !/^[0-9a-f]{40}$/.test(raw.modelRevision)) throw new TypeError();
    return Object.freeze({
      mode: 'remote-gigaam', origin: origin(raw.origin),
      processorId: identifier(raw.processorId), model: identifier(raw.model),
      modelRevision: raw.modelRevision, serviceToken: raw.serviceToken,
    });
  } catch {
    throw new RemoteSpeechControlError('invalid_configuration');
  }
}

function preparation(input: unknown, config: Configuration): boolean {
  try {
    const raw = fields(input, ['doctorFirst', 'preparationEvidence']);
    if (typeof raw.doctorFirst !== 'boolean') throw new TypeError();
    const evidence = fields(raw.preparationEvidence, ['processorId', 'noticeVersion', 'consentEventId', 'consentVersion']);
    if (identifier(evidence.processorId) !== config.processorId) throw new TypeError();
    positiveVersion(evidence.noticeVersion);
    identifier(evidence.consentEventId, 256);
    positiveVersion(evidence.consentVersion);
    return raw.doctorFirst;
  } catch {
    throw new RemoteSpeechControlError('invalid_request');
  }
}

function responsePins(raw: Record<string, unknown>, config: Configuration): void {
  if (raw.protocol !== PROTOCOL || raw.processorId !== config.processorId ||
    raw.model !== config.model || raw.modelRevision !== config.modelRevision) {
    throw new RemoteSpeechControlError('invalid_response');
  }
}

/**
 * Explicit injected fetch only: importing/configuring never contacts a service.
 * Missing configuration is not a local/cloud fallback. `configured` does not
 * mean reachable, authorized for clinical work, or deployable. Never serialize
 * or log configuration/evidence; the factory intentionally does not expose it.
 */
export function createRemoteGigaamControlTransport(
  input: unknown,
  dependencies: { fetchImpl: typeof fetch },
): RemoteSpeechControlTransport | Readonly<{ state: 'disabled' | 'unconfigured' }> {
  const parsed = configuration(input);
  if (typeof parsed === 'string') return Object.freeze({ state: parsed });
  const config: Configuration = parsed;
  let fetchImpl: typeof fetch;
  try {
    const raw = fields(dependencies, ['fetchImpl']);
    if (typeof raw.fetchImpl !== 'function') throw new TypeError();
    fetchImpl = raw.fetchImpl as typeof fetch;
  } catch {
    throw new RemoteSpeechControlError('invalid_configuration');
  }
  const pins = Object.freeze({
    processorId: config.processorId, model: config.model, modelRevision: config.modelRevision,
  });

  async function request(
    path: '/v1/control/health' | '/v1/control/sessions',
    body: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<unknown> {
    if (signal !== undefined && !(signal instanceof AbortSignal)) {
      throw new RemoteSpeechControlError('invalid_request');
    }
    if (signal?.aborted) throw new RemoteSpeechControlError('cancelled');
    const controller = new AbortController();
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let stopError: RemoteSpeechControlError | undefined;
    let rejectStop!: (reason: RemoteSpeechControlError) => void;
    const stopped = new Promise<never>((_, reject) => { rejectStop = reject; });
    function discard(target?: Response) {
      // Cancellation may reject or never settle; neither may hold the deadline.
      try { void (reader ? reader.cancel() : target?.body?.cancel())?.catch(() => {}); } catch { /* no details */ }
    }
    function stop(code: 'timeout' | 'cancelled') {
      if (stopError) return;
      stopError = new RemoteSpeechControlError(code);
      rejectStop(stopError);
      controller.abort();
      discard(response);
    }
    const onAbort = () => stop('cancelled');
    signal?.addEventListener('abort', onAbort, { once: true });
    const timer = setTimeout(() => stop('timeout'), body === undefined ? HEALTH_DEADLINE_MS : CREATE_DEADLINE_MS);
    const url = `${config.origin}${path}`;
    let phase: 'fetch' | 'response' = 'fetch';
    try {
      // A fetch ignoring abort may resolve after this method returned. Its body
      // must still be discarded, and a late rejection must remain handled.
      const pending = Promise.resolve().then(() => {
        if (stopError) throw stopError;
        return fetchImpl(url, {
          method: body === undefined ? 'GET' : 'POST',
          headers: {
            Authorization: `Bearer ${config.serviceToken}`, Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
          },
          body, signal: controller.signal, redirect: 'error', credentials: 'omit',
          cache: 'no-store', referrerPolicy: 'no-referrer',
        });
      }).then(value => {
        if (stopError) { discard(value); throw stopError; }
        return value;
      });
      response = await Promise.race([pending, stopped]);
      // A fulfilled read/fetch can win Promise.race even when cancellation has
      // already settled in the same turn. Cancellation still forbids success.
      if (stopError) throw stopError;
      phase = 'response';
      if (!(response instanceof Response) || response.redirected ||
        (response.url && response.url !== url) || response.type === 'opaqueredirect' ||
        (response.status >= 300 && response.status < 400)) {
        throw new RemoteSpeechControlError('invalid_response');
      }
      if (response.status !== (body === undefined ? 200 : 201)) {
        throw new RemoteSpeechControlError(
          response.status === 401 || response.status === 403 ? 'unauthorized'
            : response.status === 429 ? 'rate_limited' : 'unavailable',
        );
      }
      const contentType = response.headers.get('content-type');
      const lengthHeader = response.headers.get('content-length');
      const contentEncoding = response.headers.get('content-encoding');
      if (!contentType || !/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) ||
        (contentEncoding !== null && contentEncoding !== 'identity') ||
        (lengthHeader !== null && (!/^[1-9][0-9]{0,4}$/.test(lengthHeader) || Number(lengthHeader) > MAX_RESPONSE_BYTES)) ||
        !response.body) throw new RemoteSpeechControlError('invalid_response');
      reader = response.body.getReader();
      const decoder = new TextDecoder('utf-8', { fatal: true });
      let bytes = 0;
      let chunks = 0;
      let text = '';
      while (true) {
        const part = await Promise.race([reader.read(), stopped]);
        if (stopError) throw stopError;
        if (part.done) break;
        if (!(part.value instanceof Uint8Array) || ++chunks > MAX_RESPONSE_CHUNKS ||
          (bytes += part.value.byteLength) > MAX_RESPONSE_BYTES) {
          throw new RemoteSpeechControlError('invalid_response');
        }
        text += decoder.decode(part.value, { stream: true });
      }
      if (lengthHeader !== null && bytes !== Number(lengthHeader)) throw new RemoteSpeechControlError('invalid_response');
      text += decoder.decode();
      if (stopError) throw stopError;
      return JSON.parse(text) as unknown;
    } catch (error) {
      if (stopError) throw stopError;
      if (error instanceof RemoteSpeechControlError) throw error;
      throw new RemoteSpeechControlError(phase === 'fetch' ? 'unavailable' : 'invalid_response');
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
      controller.abort();
      discard(response);
      try { reader?.releaseLock(); } catch { /* no details */ }
    }
  }

  return Object.freeze({
    state: 'configured',
    capabilities: Object.freeze({ health: true, createSession: true, transcribe: false, deleteSession: false }),
    async health(signal?: AbortSignal) {
      const payload = await request('/v1/control/health', undefined, signal);
      // request() has removed its listener; cancellation in the await handoff
      // must not become a successful publication or an invalid-response error.
      if (signal?.aborted) throw new RemoteSpeechControlError('cancelled');
      try {
        const raw = fields(payload, ['protocol', 'processorId', 'model', 'modelRevision', 'status']);
        responsePins(raw, config);
        if (raw.status !== 'ready' && raw.status !== 'not_ready') throw new TypeError();
        return Object.freeze({ ...pins, ready: raw.status === 'ready' });
      } catch { throw new RemoteSpeechControlError('invalid_response'); }
    },
    async createSession(input: unknown, signal?: AbortSignal) {
      const doctorFirst = preparation(input, config);
      const payload = await request('/v1/control/sessions', JSON.stringify({ protocol: PROTOCOL, ...pins, doctorFirst }), signal);
      if (signal?.aborted) throw new RemoteSpeechControlError('cancelled');
      try {
        const raw = fields(payload, ['protocol', 'processorId', 'model', 'modelRevision', 'sessionId', 'doctorFirst']);
        responsePins(raw, config);
        if (typeof raw.sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,200}$/.test(raw.sessionId) ||
          raw.doctorFirst !== doctorFirst) throw new TypeError();
        return Object.freeze({ ...pins, upstreamSessionId: raw.sessionId, doctorFirst });
      } catch { throw new RemoteSpeechControlError('invalid_response'); }
    },
  });
}
