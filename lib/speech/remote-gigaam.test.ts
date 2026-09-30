import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createRemoteGigaamControlTransport,
  RemoteSpeechControlError,
  type RemoteSpeechControlTransport,
} from './remote-gigaam';

const pins = {
  processorId: 'synthetic-dedicated-gigaam', model: 'gigaam-multilingual',
  modelRevision: 'a'.repeat(40),
};
const protocol = 'orion-gigaam-control/v1';
const syntheticServiceToken = 'synthetic-test-service-credential-not-real';
const origin = 'https://speech.synthetic-orion.org';
function config(overrides: Record<string, unknown> = {}) {
  return { mode: 'remote-gigaam', origin, ...pins, serviceToken: syntheticServiceToken, ...overrides };
}
function input(overrides: Record<string, unknown> = {}) {
  return {
    doctorFirst: true,
    preparationEvidence: {
      processorId: pins.processorId, noticeVersion: 1,
      consentEventId: 'synthetic-consent-event', consentVersion: 2,
    },
    ...overrides,
  };
}
function health(overrides: Record<string, unknown> = {}) {
  return { protocol, ...pins, status: 'ready', ...overrides };
}
function session(overrides: Record<string, unknown> = {}) {
  return { protocol, ...pins, sessionId: 'synthetic-session', doctorFirst: true, ...overrides };
}
function json(value: unknown, status = 200, headers?: HeadersInit) {
  return new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', ...headers } });
}
function transport(fetchImpl: typeof fetch, source: unknown = config()): RemoteSpeechControlTransport {
  const result = createRemoteGigaamControlTransport(source, { fetchImpl });
  if (result.state !== 'configured') throw new Error('Expected synthetic configured transport');
  return result;
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
function assertError(error: unknown, code: string) {
  expect(error).toBeInstanceOf(RemoteSpeechControlError);
  expect(error).toMatchObject({ code, message: 'Remote speech control request failed' });
  expect(error).not.toHaveProperty('cause');
  expect(String(error)).not.toContain(syntheticServiceToken);
  expect(String(error)).not.toContain('upstream-sensitive-detail');
}
async function expectFailure(promise: Promise<unknown>, code: string) {
  const result = await promise.then(() => null, error => error as unknown);
  assertError(result, code);
}

beforeEach(() => {
  // No test may accidentally leave the injected fake and contact a real host.
  vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Real fetch is forbidden in this suite'); }));
});
afterEach(() => {
  expect(globalThis.fetch).not.toHaveBeenCalled();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('remote GigaAM control configuration (no actual network)', () => {
  it.each([undefined, null])('is explicitly unconfigured without a fallback: %s', value => {
    const fetchImpl = vi.fn();
    expect(createRemoteGigaamControlTransport(value, { fetchImpl })).toEqual({ state: 'unconfigured' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('has a strict disabled state and no operations or secret exposure', () => {
    const fetchImpl = vi.fn();
    const result = createRemoteGigaamControlTransport({ mode: 'disabled' }, { fetchImpl });
    expect(result).toEqual({ state: 'disabled' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('exposes only control operations, not an audio provider or cleanup success', () => {
    const fetchImpl = vi.fn();
    const result = transport(fetchImpl);
    expect(result.capabilities).toEqual({ health: true, createSession: true, transcribe: false, deleteSession: false });
    expect(result).not.toHaveProperty('transcribe');
    expect(result).not.toHaveProperty('deleteSession');
    expect(JSON.stringify(result)).not.toContain(syntheticServiceToken);
    expect(result).not.toHaveProperty('origin');
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.capabilities)).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    {}, { mode: 'local' }, { mode: 'disabled', origin }, { ...config(), serviceToken: undefined },
    { ...config(), apiKey: 'synthetic-unexpected' }, [], new Date(), 'remote-gigaam',
  ])('rejects malformed/unknown configuration instead of selecting fallback %#', value => {
    const fetchImpl = vi.fn();
    let failure;
    try { createRemoteGigaamControlTransport(value, { fetchImpl }); } catch (error) { failure = error; }
    assertError(failure, 'invalid_configuration');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    'http://speech.synthetic-orion.org', `${origin}/`, `${origin}/v1`, `${origin}?x=1`,
    `${origin}#fragment`, `${origin}:443`, `${origin}:8443`, ` ${origin}`, `${origin}\n`,
    'https://user:password@speech.synthetic-orion.org', 'https://SPEECH.synthetic-orion.org',
    'https://speech.synthetic-orion.org.', 'https://speech..synthetic-orion.org',
    'https://-speech.synthetic-orion.org', 'https://speech-.synthetic-orion.org',
    'https://speech_synthetic.org', 'https://127.0.0.1', 'https://10.1.2.3',
    'https://169.254.169.254', 'https://192.168.1.1', 'https://172.16.0.1',
    'https://8.8.8.8', 'https://2130706433', 'https://0x7f000001', 'https://127.1',
    'https://[::1]', 'https://[::ffff:127.0.0.1]', 'https://[2606:4700:4700::1111]',
    'https://localhost', 'https://service.localhost', 'https://metadata.google.internal',
    'https://service.home.arpa', 'https://speech.local', 'https://speech.test',
    'https://speech.invalid', 'https://speech.example.com', 'https://speech.corp',
    'https://speech.intranet', 'https://speech.lan', 'https://speech.localdomain',
    'https://speech', 'https://речь.synthetic-orion.org', 'https://speech%2esynthetic-orion.org',
    'https://speech.synthetic-orion.org\\@127.0.0.1',
    `https://${'a'.repeat(64)}.synthetic-orion.org`,
  ])('rejects noncanonical/reserved/IP destination: %s', value => {
    const fetchImpl = vi.fn();
    expect(() => transport(fetchImpl, config({ origin: value }))).toThrowError(RemoteSpeechControlError);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each(['', 'a'.repeat(31), 'a'.repeat(257), 'space is forbidden even with long value',
    'synthetic-long-secret\r\nInjected: header', 'synthetic-long-secret-with-unicode-я', 42, null])(
    'rejects malformed service token without echoing it %#', value => {
      let failure;
      try { transport(vi.fn(), config({ serviceToken: value })); } catch (error) { failure = error; }
      assertError(failure, 'invalid_configuration');
    },
  );
  it.each([
    { processorId: '' }, { processorId: ' processor' }, { model: 'a\nmodel' },
    { model: 'a'.repeat(129) }, { modelRevision: 'latest' }, { modelRevision: 'A'.repeat(40) },
    { modelRevision: 'a'.repeat(39) },
  ])('requires fixed safe processor/model/revision pins %#', value => {
    expect(() => transport(vi.fn(), config(value))).toThrowError(RemoteSpeechControlError);
  });
  it('copies config and injected fetch; later mutation cannot change destination/credential/pins', async () => {
    const fetchImpl = vi.fn(async () => json(health()));
    const source = config();
    const dependencies = { fetchImpl };
    const result = createRemoteGigaamControlTransport(source, dependencies);
    source.origin = 'https://other.synthetic-orion.org';
    source.serviceToken = 'synthetic-changed-service-credential';
    source.processorId = 'changed';
    dependencies.fetchImpl = vi.fn(async () => { throw new Error('Replacement must not run'); });
    if (result.state !== 'configured') throw new Error('Expected configured');
    await result.health();
    expect(fetchImpl).toHaveBeenCalledWith(`${origin}/v1/control/health`, expect.objectContaining({
      headers: expect.objectContaining({ Authorization: `Bearer ${syntheticServiceToken}` }),
    }));
    expect(dependencies.fetchImpl).not.toHaveBeenCalled();
  });
  it('rejects getters/symbols/nonenumerable/custom prototypes without reading getter', () => {
    const getter = vi.fn(() => syntheticServiceToken);
    const accessor = { ...config() };
    Object.defineProperty(accessor, 'serviceToken', { get: getter, enumerable: true });
    const hidden = { ...config() };
    Object.defineProperty(hidden, 'model', { value: pins.model, enumerable: false });
    for (const value of [accessor, hidden, { ...config(), [Symbol('extra')]: 1 }, Object.assign(Object.create({ inherited: true }), config())]) {
      expect(() => transport(vi.fn(), value)).toThrowError(RemoteSpeechControlError);
    }
    expect(getter).not.toHaveBeenCalled();
  });
  it.each(['getPrototypeOf', 'ownKeys', 'getOwnPropertyDescriptor'] as const)('sanitizes throwing configuration Proxy %s', trap => {
    let failure;
    const value = new Proxy(config(), { [trap]: () => { throw new Error('upstream-sensitive-detail'); } });
    try { transport(vi.fn(), value); } catch (error) { failure = error; }
    assertError(failure, 'invalid_configuration');
  });
  it('accepts null-prototype DTOs but requires an explicit fetch dependency', () => {
    expect(transport(vi.fn(), Object.assign(Object.create(null), config())).state).toBe('configured');
    expect(() => createRemoteGigaamControlTransport(config(), {} as { fetchImpl: typeof fetch })).toThrowError(RemoteSpeechControlError);
  });
  it('refuses browser execution on import', async () => {
    vi.resetModules();
    vi.stubGlobal('window', {});
    await expect(import('./remote-gigaam')).rejects.toThrow('Remote speech control requires server execution');
    vi.resetModules();
  });
});

describe('authenticated strict metadata contracts', () => {
  it.each(['ready', 'not_ready'])('validates health and returns only frozen configured pins/readiness: %s', async status => {
    const fetchImpl = vi.fn(async () => json(health({ status })));
    const result = await transport(fetchImpl).health();
    expect(result).toEqual({ ...pins, ready: status === 'ready' });
    expect(Object.isFrozen(result)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(`${origin}/v1/control/health`, expect.objectContaining({
      method: 'GET', body: undefined, redirect: 'error', credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', Authorization: `Bearer ${syntheticServiceToken}` },
    }));
  });
  it.each([true, false])('creates only a metadata session, echo-pins doctorFirst=%s', async doctorFirst => {
    const fetchImpl = vi.fn(async () => json(session({ doctorFirst }), 201));
    const result = await transport(fetchImpl).createSession(input({ doctorFirst }));
    expect(result).toEqual({ ...pins, upstreamSessionId: 'synthetic-session', doctorFirst });
    expect(Object.isFrozen(result)).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${origin}/v1/control/sessions`);
    expect(init.method).toBe('POST');
    expect(init.body).toBe(JSON.stringify({ protocol, ...pins, doctorFirst }));
    expect(String(init.body)).not.toContain('synthetic-consent-event');
    expect(init.headers).toEqual({ Accept: 'application/json', Authorization: `Bearer ${syntheticServiceToken}`, 'Content-Type': 'application/json' });
    expect(init).not.toHaveProperty('audio');
  });
  it.each([
    {}, { doctorFirst: true }, input({ doctorFirst: 1 }), input({ audio: new Uint8Array(1) }),
    input({ preparationEvidence: null }), input({ preparationEvidence: {} }),
    input({ preparationEvidence: { ...input().preparationEvidence, processorId: 'other' } }),
    input({ preparationEvidence: { ...input().preparationEvidence, noticeVersion: 0 } }),
    input({ preparationEvidence: { ...input().preparationEvidence, consentVersion: Number.MAX_SAFE_INTEGER + 1 } }),
    input({ preparationEvidence: { ...input().preparationEvidence, consentEventId: '' } }),
    input({ preparationEvidence: { ...input().preparationEvidence, consentEventId: 'synthetic\nsecret' } }),
    input({ preparationEvidence: { ...input().preparationEvidence, granted: true } }),
    input({ preparationEvidence: { ...input().preparationEvidence, role: 'doctor' } }),
  ])('does not fetch for malformed/mismatched preparation evidence %#', async value => {
    const fetchImpl = vi.fn();
    await expectFailure(transport(fetchImpl).createSession(value), 'invalid_request');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('does not invoke evidence accessors, and sanitizes a revoked Proxy', async () => {
    const fetchImpl = vi.fn();
    const getter = vi.fn(() => input().preparationEvidence);
    const value = { doctorFirst: true };
    Object.defineProperty(value, 'preparationEvidence', { enumerable: true, get: getter });
    await expectFailure(transport(fetchImpl).createSession(value), 'invalid_request');
    const proxy = Proxy.revocable(input(), {});
    proxy.revoke();
    await expectFailure(transport(fetchImpl).createSession(proxy.proxy), 'invalid_request');
    expect(getter).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it.each([
    null, [], { status: 'ok', stt: { status: 'ready' } }, health({ protocol: 'v2' }),
    health({ processorId: 'another' }), health({ model: 'another' }), health({ modelRevision: 'b'.repeat(40) }),
    health({ status: 'loading' }), health({ internalError: 'upstream-sensitive-detail' }),
  ])('rejects unknown/raw-sidecar/extra/mismatched health response %#', async value => {
    await expectFailure(transport(vi.fn(async () => json(value))).health(), 'invalid_response');
  });
  it.each([
    session({ protocol: 'v2' }), session({ processorId: 'another' }), session({ model: 'another' }),
    session({ modelRevision: 'b'.repeat(40) }), session({ doctorFirst: false }), session({ sessionId: '' }),
    session({ sessionId: 'a'.repeat(201) }), session({ sessionId: '../another' }), session({ sessionId: 'synthetic\nsecret' }),
    session({ audioPersistence: 'none' }), { sessionId: 'raw-sidecar', engine: {} },
  ])('rejects malformed/unpinned create response without fallback or false success %#', async value => {
    const fetchImpl = vi.fn(async () => json(value, 201));
    await expectFailure(transport(fetchImpl).createSession(input()), 'invalid_response');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each([[401, 'unauthorized'], [403, 'unauthorized'], [429, 'rate_limited'], [500, 'unavailable'], [503, 'unavailable'], [422, 'unavailable']] as const)(
    'maps HTTP %i without reading error details or retrying', async (status, code) => {
      const cancel = vi.fn();
      const body = new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('upstream-sensitive-detail')); }, cancel });
      const fetchImpl = vi.fn(async () => new Response(body, { status }));
      await expectFailure(transport(fetchImpl).health(), code);
      expect(fetchImpl).toHaveBeenCalledOnce();
      expect(cancel).toHaveBeenCalledOnce();
    },
  );
  it.each([301, 302, 303, 307, 308])('rejects redirect %s without following Location', async status => {
    const fetchImpl = vi.fn(async () => new Response(null, { status, headers: { Location: 'https://169.254.169.254/secret' } }));
    await expectFailure(transport(fetchImpl).health(), 'invalid_response');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('rejects a fetch implementation that followed a redirect or returned a different URL', async () => {
    for (const [key, value] of [['redirected', true], ['url', 'https://other.synthetic-orion.org/v1/control/health']] as const) {
      const response = json(health());
      Object.defineProperty(response, key, { value });
      await expectFailure(transport(vi.fn(async () => response)).health(), 'invalid_response');
    }
  });
  it('accepts only the exact fixed response URL when supplied by fetch', async () => {
    const response = json(health());
    Object.defineProperty(response, 'url', { value: `${origin}/v1/control/health` });
    expect(await transport(vi.fn(async () => response)).health()).toEqual({ ...pins, ready: true });
  });
  it('sanitizes synchronous and asynchronous fetch errors with no retries', async () => {
    for (const fetchImpl of [vi.fn(() => { throw new Error(`upstream-sensitive-detail ${syntheticServiceToken}`); }), vi.fn(async () => { throw new Error('upstream-sensitive-detail'); })]) {
      await expectFailure(transport(fetchImpl).health(), 'unavailable');
      expect(fetchImpl).toHaveBeenCalledOnce();
    }
  });
});

describe('bounded response and cancellation', () => {
  it.each([
    { 'Content-Type': 'text/plain' }, { 'Content-Type': 'application/json; charset=latin1' },
    { 'Content-Length': '16385' }, { 'Content-Length': '0' }, { 'Content-Length': '-1' },
    { 'Content-Length': '1e3' }, { 'Content-Length': '3, 3' }, { 'Content-Length': '99999999999999999' },
    { 'Content-Encoding': 'gzip' },
  ])('rejects unsafe response headers before reading body %#', async headers => {
    const cancel = vi.fn();
    const responseHeaders = new Headers({ 'Content-Type': 'application/json' });
    for (const [key, value] of Object.entries(headers)) {
      if (value !== undefined) responseHeaders.set(key, value);
    }
    const response = new Response(new ReadableStream({ cancel }), { headers: responseHeaders });
    await expectFailure(transport(vi.fn(async () => response)).health(), 'invalid_response');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds actual streamed bytes with no Content-Length and cancels overflow', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({
      start(controller) { controller.enqueue(new Uint8Array(16_384)); controller.enqueue(new Uint8Array(1)); }, cancel,
    }), { headers: { 'Content-Type': 'application/json' } });
    await expectFailure(transport(vi.fn(async () => response)).health(), 'invalid_response');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it('bounds pathological empty stream chunks rather than waiting forever', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream({ pull(controller) { controller.enqueue(new Uint8Array(0)); }, cancel }), { headers: { 'Content-Type': 'application/json' } });
    await expectFailure(transport(vi.fn(async () => response)).health(), 'invalid_response');
    expect(cancel).toHaveBeenCalledOnce();
  });
  it.each(['', '{', 'null', '[1]', '{"status":"ready"}', 'upstream-sensitive-detail'])('rejects malformed/incomplete JSON DTO %#', async text => {
    await expectFailure(transport(vi.fn(async () => new Response(text, { headers: { 'Content-Type': 'application/json' } }))).health(), 'invalid_response');
  });
  it('rejects invalid UTF-8 and declared length mismatch', async () => {
    await expectFailure(transport(vi.fn(async () => new Response(new Uint8Array([0xc3, 0x28]), { headers: { 'Content-Type': 'application/json' } }))).health(), 'invalid_response');
    await expectFailure(transport(vi.fn(async () => json(health(), 200, { 'Content-Length': '1' }))).health(), 'invalid_response');
  });
  it('accepts split UTF-8 JSON with exact byte length and charset', async () => {
    const bytes = new TextEncoder().encode(JSON.stringify(health()));
    const response = new Response(new ReadableStream({ start(controller) {
      controller.enqueue(bytes.slice(0, 13)); controller.enqueue(bytes.slice(13)); controller.close();
    } }), { headers: { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': String(bytes.length) } });
    expect(await transport(vi.fn(async () => response)).health()).toEqual({ ...pins, ready: true });
  });
  it.each(['health', 'createSession'] as const)('bounds never-resolving %s fetch and aborts its signal', async method => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(() => new Promise<Response>(() => {}));
    const client = transport(fetchImpl);
    const failure = expectFailure(method === 'health' ? client.health() : client.createSession(input()), 'timeout');
    await vi.advanceTimersByTimeAsync(method === 'health' ? 5_000 : 10_000);
    await failure;
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])?.[1];
    expect(init?.signal?.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('closes a late response after deadline, even if cancel never settles', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const failure = expectFailure(transport(vi.fn(() => pending.promise)).health(), 'timeout');
    await vi.advanceTimersByTimeAsync(5_000);
    await failure;
    pending.resolve(new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } }));
    await vi.advanceTimersByTimeAsync(0);
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('handles a late fetch rejection after timeout without publishing it', async () => {
    vi.useFakeTimers();
    const pending = deferred<Response>();
    const failure = expectFailure(transport(vi.fn(() => pending.promise)).health(), 'timeout');
    await vi.advanceTimersByTimeAsync(5_000);
    await failure;
    pending.reject(new Error('upstream-sensitive-detail'));
    await vi.advanceTimersByTimeAsync(0);
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['never', 'reject'] as const)('deadline covers stalled body reads and %s-settling cancellation', async cancelMode => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => cancelMode === 'never' ? new Promise<void>(() => {}) : Promise.reject(new Error('upstream-sensitive-detail')));
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } });
    const failure = expectFailure(transport(vi.fn(async () => response)).health(), 'timeout');
    await vi.advanceTimersByTimeAsync(5_000);
    await failure;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('makes caller pre-abort a non-request, preserving no fallback', async () => {
    const fetchImpl = vi.fn();
    const controller = new AbortController();
    controller.abort();
    await expectFailure(transport(fetchImpl).health(controller.signal), 'cancelled');
    await expectFailure(transport(fetchImpl).createSession(input(), controller.signal), 'cancelled');
    expect(fetchImpl).not.toHaveBeenCalled();
  });
  it('handles caller abort during stalled body and does not wait for cancellation', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const response = new Response(new ReadableStream({ cancel }), { headers: { 'Content-Type': 'application/json' } });
    const failure = expectFailure(transport(vi.fn(async () => response)).health(controller.signal), 'cancelled');
    await vi.advanceTimersByTimeAsync(1);
    controller.abort();
    await failure;
    expect(cancel).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });
  it.each(['health', 'createSession'] as const)('rejects %s when a fulfilled body read closes and aborts in the same turn', async method => {
    const controller = new AbortController();
    const value = method === 'health' ? health() : session();
    const body = new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new TextEncoder().encode(JSON.stringify(value))); },
      pull(stream) { stream.close(); controller.abort(); },
    });
    const fetchImpl = vi.fn(async () => new Response(body, {
      status: method === 'health' ? 200 : 201,
      headers: { 'Content-Type': 'application/json' },
    }));
    const client = transport(fetchImpl);
    await expectFailure(method === 'health' ? client.health(controller.signal)
      : client.createSession(input(), controller.signal), 'cancelled');
    expect(controller.signal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(['health', 'createSession'] as const)('rejects %s when caller aborts after request cleanup but before outer publication', async method => {
    const controller = new AbortController();
    const remove = controller.signal.removeEventListener.bind(controller.signal);
    vi.spyOn(controller.signal, 'removeEventListener').mockImplementation((...args) => {
      remove(...args);
      // request() finally releases its listener, before the outer await resumes.
      controller.abort();
    });
    const fetchImpl = vi.fn(async () => json(method === 'health' ? health() : session(), method === 'health' ? 200 : 201));
    const client = transport(fetchImpl);
    await expectFailure(method === 'health' ? client.health(controller.signal)
      : client.createSession(input(), controller.signal), 'cancelled');
    expect(controller.signal.aborted).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it.each(['health', 'createSession'] as const)('preserves cancellation when %s body read errors and aborts in the same turn', async method => {
    const controller = new AbortController();
    const value = method === 'health' ? health() : session();
    const body = new ReadableStream<Uint8Array>({
      start(stream) { stream.enqueue(new TextEncoder().encode(JSON.stringify(value))); },
      pull(stream) { stream.error(new Error('upstream-sensitive-detail')); controller.abort(); },
    });
    const client = transport(vi.fn(async () => new Response(body, {
      status: method === 'health' ? 200 : 201,
      headers: { 'Content-Type': 'application/json' },
    })));
    await expectFailure(method === 'health' ? client.health(controller.signal)
      : client.createSession(input(), controller.signal), 'cancelled');
  });
  it('removes abort listener after successful completion and clears deadline', async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    await transport(vi.fn(async () => json(health()))).health(controller.signal);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
    controller.abort();
  });
});
