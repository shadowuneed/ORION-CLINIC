import { createHash } from 'node:crypto';
import { EventEmitter } from 'node:events';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { PassThrough } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { VerifiedLocalPrincipal } from '../../scripts/local-account-auth';
import { regionalBriefingMiddleware } from '../../scripts/regional-ai-briefing';
import {
  regionalBriefingContentSchema, regionalBriefingRequestSchema,
  regionalBriefingResponseSchema, regionalBriefingSource, regionalFacilityBriefingSource,
} from './briefing';
import type { RegionalOverview } from './contracts';
import type { RegionalKpiSnapshot } from './kpi';
import { regionalKpiBriefingRequestSchema, regionalKpiBriefingResponseSchema, regionalKpiBriefingSource } from './kpi-briefing';

const time = '2026-10-08T10:00:00.000Z';
const actor = { issuer: 'local', subject: 'doctor-1' };
const metrics = { hospitalCount: 1, polyclinicCount: 1, patientCount: 4, activeVisits: 2,
  queuedVisits: 1, openTasks: 3, overdueTasks: 1, onTimeTasks: 3, dueTasks: 4,
  completedTasks: 3, totalTasks: 6, kpiPercent: 75 };
function overview(): RegionalOverview {
  return { schemaVersion: 1, dataMode: 'training', generatedAt: time,
    districts: [{ ...metrics, id: 'sauran', name: 'PRIVATE DISTRICT LABEL', kind: 'district', regionId: 'turkestan' },
      { ...metrics, id: 'shymkent', name: 'PRIVATE CITY LABEL', kind: 'city', regionId: 'shymkent' }],
    facilities: [{ ...metrics, id: 'facility-1', districtId: 'sauran', clinicId: 'private-clinic-id', name: 'PRIVATE CLINIC LABEL',
      kind: 'hospital', latitude: 43.39, longitude: 68.02, address: 'PRIVATE STREET', populated: true }],
    totals: { ...metrics }, insights: [{ id: 'private-insight', severity: 'warning', title: 'PRIVATE NOTE', detail: 'PRIVATE MEDICAL TEXT' }],
    sourceNote: 'PRIVATE SOURCE DESCRIPTION',
    kpiDefinition: { title: 'PRIVATE KPI TITLE', formula: 'PRIVATE KPI FORMULA', periodStart: '2026-09-08T10:00:00.000Z', periodEnd: time },
  };
}
const content = { summary: 'Одна задача просрочена; проверить ответственного.', priorities: ['Проверить очередь и срок задачи.'] };
function kpiSnapshot(): RegionalKpiSnapshot {
  return { schemaVersion: 1, dataMode: 'training', generatedAt: time, period: { start: '2026-09-01', end: '2026-09-30' },
    definitions: [{ id: 'complaints-hospital', title: 'PRIVATE indicator text', category: 'quality', sourceType: 'internal',
      sourceTitle: 'PRIVATE note', sourceUrl: null, sourceVersion: 'v1', applicableKinds: ['hospital'], basis: 'ratio_per_1000',
      direction: 'lower', target: 1, targetPeriod: 'calendar_month', unit: '‰', numeratorLabel: 'PRIVATE', denominatorLabel: 'PRIVATE', periodKind: 'interval', note: 'PRIVATE' }],
    facilities: [{ id: 'facility-1', name: 'PRIVATE facility', kind: 'hospital', districtId: 'sauran', regionId: 'turkestan' },
      { id: 'facility-shymkent', name: 'PRIVATE CITY', kind: 'hospital', districtId: 'shymkent', regionId: 'shymkent' }],
    observations: [{ facilityId: 'facility-1', indicatorId: 'complaints-hospital', numerator: 1, denominator: 500, sourceCount: 501, lastObservedAt: time },
      { facilityId: 'facility-shymkent', indicatorId: 'complaints-hospital', numerator: 9, denominator: 100, sourceCount: 109, lastObservedAt: time }] };
}
const providerResponse = (value: unknown = content) => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { status: 200 });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

type MiddlewareOptions = Parameters<typeof regionalBriefingMiddleware>[0];
class TestResponse extends EventEmitter {
  statusCode = 200; writableEnded = false; destroyed = false; raw = '';
  headers = new Map<string, unknown>();
  setHeader(name: string, value: unknown) { this.headers.set(name.toLowerCase(), value); return this; }
  end(value: string) { this.raw = value; this.writableEnded = true; this.emit('finish'); }
  json() { return JSON.parse(this.raw); }
}
function harness() {
  const snapshot = overview();
  const principal = { ...actor, generation: 'test-session-generation', revalidate: vi.fn(async () => true) } as VerifiedLocalPrincipal;
  const repository = {
    kpi: vi.fn(async (_actor: unknown, _query: unknown, revalidate?: () => Promise<void>) => { await revalidate?.(); return kpiSnapshot(); }),
    overview: vi.fn(async (_actor: unknown, revalidate?: () => Promise<void>) => { await revalidate?.(); return structuredClone(snapshot); }),
    facility: vi.fn(async (_actor: unknown, id: string, revalidate?: () => Promise<void>) => {
      await revalidate?.(); const facility = snapshot.facilities.find(row => row.id === id);
      if (!facility) throw new Error('REGIONAL_NOT_FOUND');
      return structuredClone({ facility, kpiDefinition: snapshot.kpiDefinition });
    }),
    saveBriefing: vi.fn(async (_actor: unknown, _artifact: unknown, revalidate?: () => Promise<void>) => { await revalidate?.(); return { id: 'briefing-1' }; }),
  };
  const fetcher = vi.fn<typeof fetch>(async () => providerResponse());
  const options: MiddlewareOptions = { port: 3200, principal: () => principal, repository,
    provider: { apiKey: 'private-provider-key', model: 'model-test', baseUrl: 'https://api.groq.com/openai/v1' }, fetcher };
  const middleware = regionalBriefingMiddleware(options);
  const begin = (config: { body?: unknown; raw?: string; method?: string; url?: string; headers?: Record<string, string | undefined>; remote?: string; noEnd?: boolean } = {}) => {
    const req = Object.assign(new PassThrough(), {
      method: config.method ?? 'POST', url: config.url ?? '/api/regional/v1/briefing',
      headers: { host: '127.0.0.1:3200', origin: 'http://127.0.0.1:3200', 'content-type': 'application/json', ...config.headers },
      socket: { remoteAddress: config.remote ?? '127.0.0.1' }, aborted: false,
    }) as unknown as IncomingMessage;
    const response = new TestResponse(); const next = vi.fn();
    const finished = middleware(req, response as unknown as ServerResponse, next);
    if (!config.noEnd) (req as unknown as PassThrough).end(config.raw ?? JSON.stringify(config.body ?? {}));
    return { req, response, finished, next };
  };
  const run = async (config: Parameters<typeof begin>[0] = {}) => { const request = begin(config); await request.finished; return request.response; };
  return { snapshot, principal, repository, options, fetcher, begin, run };
}
afterEach(() => { vi.useRealTimers(); });

describe('regional briefing aggregate projection', () => {
  it('projects only fixed KPI numeric evidence and excludes Shymkent from the oblast', () => {
    const source = regionalKpiBriefingSource(kpiSnapshot(), { start: '2026-09-01', end: '2026-09-30' });
    expect(JSON.stringify(source)).not.toContain('PRIVATE');
    expect(source.indicators[0]).toMatchObject({ numerator: 1, denominator: 500, value: 2, target: 1, status: 'outside_target' });
    expect(source.indicators[0].coverage).toEqual({ eligible: 1, reporting: 1, missing: 0 });
    const city = regionalKpiBriefingSource(kpiSnapshot(), { start: '2026-09-01', end: '2026-09-30', districtId: 'shymkent' });
    expect(city.indicators[0].numerator).toBe(9);
  });
  it('rejects KPI mismatched periods, invalid dates and browser-provided counts', () => {
    expect(() => regionalKpiBriefingSource(kpiSnapshot(), { start: '2026-08-01', end: '2026-08-31' })).toThrow();
    for (const value of [{ start: '2026-02-30', end: '2026-03-01' }, { start: '2024-01-01', end: '2026-09-30' },
      { start: '2026-09-01', end: '2026-09-30', metrics }, { start: '2026-09-01', end: '2026-09-30', districtId: 'a', facilityId: 'b' }]) {
      expect(regionalKpiBriefingRequestSchema.safeParse(value).success).toBe(false);
    }
  });
  it('sends only fixed counters, scope IDs and the KPI period, excluding names, addresses and clinical free text', () => {
    const source = regionalBriefingSource(overview(), {});
    expect(JSON.stringify(source)).not.toContain('PRIVATE');
    expect(JSON.stringify(source)).not.toContain('private-clinic-id');
    expect(source.comparisons.map(row => row.id)).toEqual(['sauran']);
    expect(source.metrics).toEqual(metrics);
    expect(source.dataMode).toBe('training');
    expect(source.scopeId).toBe('turkestan');
  });
  it('keeps Shymkent separate and facility scope limited to its own counters', () => {
    expect(regionalBriefingSource(overview(), { districtId: 'shymkent' }).comparisons.map(row => row.id)).toEqual(['shymkent']);
    const source = regionalBriefingSource(overview(), { facilityId: 'facility-1' });
    expect(source.scopeType).toBe('facility'); expect(source.comparisons).toEqual([]);
    expect(() => regionalBriefingSource(overview(), { facilityId: 'missing' })).toThrow('REGIONAL_NOT_FOUND');
    const snapshot = overview();
    const facilityOnly = { facility: snapshot.facilities[0], kpiDefinition: snapshot.kpiDefinition,
      medicalRecords: [{ name: 'PRIVATE PATIENT', diagnosis: 'PRIVATE CONDITION' }] };
    expect(regionalFacilityBriefingSource(facilityOnly, 'facility-1')).toEqual(source);
    expect(JSON.stringify(regionalFacilityBriefingSource(facilityOnly, 'facility-1'))).not.toContain('PRIVATE');
    expect(() => regionalFacilityBriefingSource(facilityOnly, 'foreign-facility')).toThrow('REGIONAL_NOT_FOUND');
  });
  it('rejects browser-provided actor, counters, free text and ambiguous scope', () => {
    for (const body of [{ actor }, { metrics }, { text: 'text' }, { districtId: 'sauran', facilityId: 'facility-1' }, { facilityId: '../secret' }]) {
      expect(regionalBriefingRequestSchema.safeParse(body).success).toBe(false);
    }
    expect(regionalBriefingRequestSchema.safeParse({}).success).toBe(true);
    expect(regionalBriefingContentSchema.safeParse({ ...content, action: 'complete' }).success).toBe(false);
    expect(regionalBriefingContentSchema.safeParse({ summary: 'x'.repeat(901), priorities: [] }).success).toBe(false);
  });
});

describe('authenticated regional AI briefing boundary', () => {
  it('generates concise period-bound KPI draft only from current canonical aggregates', async () => {
    const test = harness(); const body = { start: '2026-09-01', end: '2026-09-30', districtId: 'sauran' };
    const response = await test.run({ url: '/api/regional/v1/kpi/briefing', body }); expect(response.statusCode).toBe(200);
    expect(test.repository.kpi).toHaveBeenCalledTimes(2);
    const sent = JSON.parse(test.fetcher.mock.calls[0][1]!.body as string);
    expect(sent.messages).toHaveLength(2); expect(sent.messages[0].content).toContain('не более трёх');
    expect(sent.messages[1].content).not.toContain('PRIVATE'); expect(sent.messages[1].content).not.toContain('patient');
    expect(JSON.parse(sent.messages[1].content).indicators[0].value).toBe(2);
    expect(regionalKpiBriefingResponseSchema.parse(response.json())).toMatchObject({ period: { start: body.start, end: body.end }, scopeType: 'district', scopeId: 'sauran', reviewRequired: true });
  });
  it('fences network KPI briefings from employee scopes and never falls back to patient snapshots', async () => {
    const denied = Object.assign(new Error('private grants'), { status: 403 });
    const test = harness(); test.repository.overview.mockRejectedValue(denied);
    expect((await test.run({ url: '/api/regional/v1/kpi/briefing', body: { start: '2026-09-01', end: '2026-09-30' } })).statusCode).toBe(403);
    expect(test.repository.kpi).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    const facility = harness(); facility.repository.overview.mockRejectedValue(denied);
    expect((await facility.run({ url: '/api/regional/v1/kpi/briefing', body: { start: '2026-09-01', end: '2026-09-30', facilityId: 'facility-1' } })).statusCode).toBe(200);
    expect(facility.repository.overview).not.toHaveBeenCalled(); expect(facility.repository.facility).not.toHaveBeenCalled();
  });
  it('enforces concise output and validates scope before KPI egress', async () => {
    const long = harness(); long.fetcher.mockResolvedValue(providerResponse({ summary: 'x'.repeat(351), priorities: [] }));
    expect((await long.run({ url: '/api/regional/v1/kpi/briefing', body: { start: '2026-09-01', end: '2026-09-30' } })).statusCode).toBe(502);
    expect(long.repository.saveBriefing).not.toHaveBeenCalled();
    const wrong = harness(); expect((await wrong.run({ url: '/api/regional/v1/kpi/briefing', body: { start: '2026-09-01', end: '2026-09-30', districtId: 'absent' } })).statusCode).toBe(404);
    expect(wrong.fetcher).not.toHaveBeenCalled();
  });
  it('persists only an immutable draft with the exact canonical provider-input hash and verified actor', async () => {
    const test = harness();
    const changed = overview(); changed.totals.queuedVisits = 7;
    test.repository.overview.mockResolvedValueOnce(overview()).mockResolvedValueOnce(changed);
    const response = await test.run(); expect(response.statusCode).toBe(200);
    const [url, request] = test.fetcher.mock.calls[0];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect(request).toMatchObject({ method: 'POST', redirect: 'error' });
    const sent = JSON.parse(request!.body as string);
    expect(sent.messages[1].content).not.toContain('PRIVATE');
    expect(JSON.parse(sent.messages[1].content).metrics.queuedVisits).toBe(7);
    const hash = createHash('sha256').update(sent.messages[1].content).digest('hex');
    expect(test.repository.saveBriefing).toHaveBeenCalledExactlyOnceWith(actor, expect.objectContaining({
      sourceHash: hash, scopeId: 'turkestan', scopeType: 'region', provider: 'groq', ...content,
    }), expect.any(Function));
    expect(regionalBriefingResponseSchema.parse(response.json())).toMatchObject({ ...content, sourceHash: hash, reviewRequired: true });
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.raw).not.toContain('private-provider-key');
  });
  it('rejects anonymous, foreign origin, proxy and non-loopback calls before any database/provider access', async () => {
    const anonymous = harness(); anonymous.options.principal = () => undefined;
    expect((await anonymous.run()).statusCode).toBe(401);
    expect(anonymous.repository.overview).not.toHaveBeenCalled();
    for (const config of [{ headers: { origin: 'https://foreign.example' } }, { remote: '192.168.1.10' },
      { headers: { 'x-forwarded-host': 'foreign.example' } }, { headers: { 'x-forwarded-proto': 'https' } },
      { headers: { forwarded: 'for=remote' } }, { headers: { 'sec-fetch-site': 'cross-site' } }]) {
      const test = harness(); expect((await test.run(config)).statusCode).toBe(403);
      expect(test.repository.overview).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    }
  });
  it('uses only an employee\'s current exact facility, never reads an oblast overview, and hashes that facility input', async () => {
    const test = harness(); const denied = Object.assign(new Error('REGIONAL_ACCESS_DENIED'), { status: 403 });
    test.repository.overview.mockRejectedValue(denied);
    const response = await test.run({ body: { facilityId: 'facility-1' } });
    expect(response.statusCode).toBe(200); expect(test.repository.overview).not.toHaveBeenCalled();
    expect(test.repository.facility).toHaveBeenCalledTimes(2);
    for (const args of test.repository.facility.mock.calls) expect(args).toEqual([actor, 'facility-1', expect.any(Function)]);
    const sent = JSON.parse(test.fetcher.mock.calls[0][1]!.body as string).messages[1].content as string;
    expect(JSON.parse(sent)).toMatchObject({ scopeType: 'facility', scopeId: 'facility-1', metrics, comparisons: [] });
    expect(sent).not.toContain('PRIVATE'); expect(sent).not.toContain('shymkent');
    expect(test.repository.saveBriefing).toHaveBeenCalledWith(actor, expect.objectContaining({
      scopeType: 'facility', scopeId: 'facility-1', sourceHash: createHash('sha256').update(sent).digest('hex'),
    }), expect.any(Function));
  });
  it('denies staff regional and district requests and rejects foreign or revoked facility scope before egress', async () => {
    const denied = Object.assign(new Error('private assignment detail'), { status: 403 });
    for (const scope of [{}, { districtId: 'sauran' }, { districtId: 'shymkent' }]) {
      const test = harness(); test.repository.overview.mockRejectedValue(denied);
      expect((await test.run({ body: scope })).statusCode).toBe(403);
      expect(test.repository.facility).not.toHaveBeenCalled(); expect(test.fetcher).not.toHaveBeenCalled();
    }
    const foreign = harness(); foreign.repository.facility.mockRejectedValue(denied);
    expect((await foreign.run({ body: { facilityId: 'foreign-facility' } })).statusCode).toBe(403);
    expect(foreign.repository.overview).not.toHaveBeenCalled(); expect(foreign.fetcher).not.toHaveBeenCalled();
    const revoked = harness(); revoked.repository.facility
      .mockResolvedValueOnce({ facility: revoked.snapshot.facilities[0], kpiDefinition: revoked.snapshot.kpiDefinition })
      .mockRejectedValueOnce(denied);
    expect((await revoked.run({ body: { facilityId: 'facility-1' } })).statusCode).toBe(403);
    expect(revoked.fetcher).not.toHaveBeenCalled(); expect(revoked.repository.saveBriefing).not.toHaveBeenCalled();
    const revokedAfter = harness(); revokedAfter.repository.saveBriefing.mockRejectedValue(denied);
    expect((await revokedAfter.run({ body: { facilityId: 'facility-1' } })).statusCode).toBe(403);
    expect(revokedAfter.repository.overview).not.toHaveBeenCalled();
    const wrongScope = harness(); wrongScope.repository.facility.mockResolvedValue({
      facility: { ...wrongScope.snapshot.facilities[0], id: 'foreign-facility' }, kpiDefinition: wrongScope.snapshot.kpiDefinition,
    });
    expect((await wrongScope.run({ body: { facilityId: 'facility-1' } })).statusCode).toBe(404);
    expect(wrongScope.fetcher).not.toHaveBeenCalled();
  });
  it('preserves safe repository missing-object and unavailable statuses without exposing database details', async () => {
    for (const status of [404, 503]) {
      const test = harness(); test.repository.facility.mockRejectedValue(Object.assign(new Error('private SQL text'), { status }));
      const response = await test.run({ body: { facilityId: 'facility-1' } });
      expect(response.statusCode).toBe(status); expect(response.raw).not.toContain('private');
      expect(test.fetcher).not.toHaveBeenCalled(); expect(test.repository.saveBriefing).not.toHaveBeenCalled();
    }
  });
  it('rejects unsupported methods, malformed JSON, large bodies and missing objects without inference', async () => {
    for (const [config, status] of [
      [{ method: 'GET' }, 405], [{ headers: { 'content-type': 'text/plain' } }, 415],
      [{ raw: '{broken' }, 400], [{ body: { actor } }, 400],
      [{ headers: { 'content-length': '2049' } }, 413], [{ raw: 'x'.repeat(2049) }, 413],
      [{ body: { facilityId: 'not-found' } }, 404],
    ] as const) {
      const test = harness(); expect((await test.run(config)).statusCode).toBe(status);
      expect(test.fetcher).not.toHaveBeenCalled(); expect(test.repository.saveBriefing).not.toHaveBeenCalled();
    }
  });
  it('has no provider fallback and refuses arbitrary or redirect-capable endpoint configuration', async () => {
    for (const baseUrl of ['http://127.0.0.1:9999', 'https://api.groq.com/openai/v1/', 'https://api.groq.com.evil.example/openai/v1']) {
      const test = harness(); test.options.provider!.baseUrl = baseUrl;
      expect((await test.run()).statusCode).toBe(503); expect(test.fetcher).not.toHaveBeenCalled();
    }
    const missing = harness(); missing.options.provider = null;
    expect((await missing.run()).statusCode).toBe(503);
    const redirect = harness(); redirect.fetcher.mockResolvedValue(new Response(null, { status: 307, headers: { Location: 'https://foreign.example' } }));
    expect((await redirect.run()).statusCode).toBe(502);
    expect(redirect.repository.saveBriefing).not.toHaveBeenCalled();
  });
  it('rechecks current PostgreSQL network grants before egress and rejects revocation after generation', async () => {
    const denied = Object.assign(new Error('private SQL detail'), { status: 403 });
    const before = harness(); before.repository.overview.mockResolvedValueOnce(overview()).mockRejectedValueOnce(denied);
    const response = await before.run(); expect(response.statusCode).toBe(403);
    expect(before.fetcher).not.toHaveBeenCalled(); expect(response.raw).not.toContain('private SQL detail');
    const after = harness(); after.fetcher.mockImplementation(async () => {
      vi.mocked(after.principal.revalidate).mockResolvedValue(false); return providerResponse();
    });
    expect((await after.run()).statusCode).toBe(401); expect(after.repository.saveBriefing).not.toHaveBeenCalled();
    const save = harness(); save.repository.saveBriefing.mockRejectedValueOnce(denied);
    expect((await save.run()).statusCode).toBe(403);
  });
  it('rejects malformed, oversized or unsupported provider output and never leaks transport details', async () => {
    for (const output of [{ ...content, action: 'prescribe' }, { summary: 'x'.repeat(901), priorities: [] }, { summary: '', priorities: [] }]) {
      const test = harness(); test.fetcher.mockResolvedValue(providerResponse(output));
      expect((await test.run()).statusCode).toBe(502); expect(test.repository.saveBriefing).not.toHaveBeenCalled();
    }
    const oversized = harness(); oversized.fetcher.mockResolvedValue(new Response('x'.repeat(64001)));
    expect((await oversized.run()).statusCode).toBe(502); expect(oversized.repository.saveBriefing).not.toHaveBeenCalled();
    const failed = harness(); failed.fetcher.mockRejectedValue(new Error('private-provider-key private-patient SQL details'));
    const response = await failed.run(); expect(response.statusCode).toBe(502); expect(response.raw).not.toContain('private-');
  });
  it('serializes each actor and rate-limits repeated explicit requests', async () => {
    const test = harness(); const waiting = deferred<Response>(); test.fetcher.mockReturnValue(waiting.promise);
    const first = test.begin();
    await vi.waitFor(() => expect(test.fetcher).toHaveBeenCalledTimes(1));
    const busy = await test.run(); expect(busy.statusCode).toBe(429); expect(busy.headers.get('retry-after')).toBe('30');
    waiting.resolve(providerResponse()); await first.finished;
    expect(first.response.statusCode).toBe(200); expect((await test.run()).statusCode).toBe(429);
    expect(test.fetcher).toHaveBeenCalledTimes(1);
  });
  it('cancels on client disconnect and never saves a late provider response', async () => {
    const test = harness(); const waiting = deferred<Response>(); test.fetcher.mockReturnValue(waiting.promise);
    const request = test.begin(); await vi.waitFor(() => expect(test.fetcher).toHaveBeenCalledTimes(1));
    request.response.destroyed = true; request.response.emit('close'); await request.finished;
    const late = providerResponse(); const cancel = vi.spyOn(late.body!, 'cancel');
    waiting.resolve(late); await Promise.resolve(); await Promise.resolve();
    expect(test.repository.saveBriefing).not.toHaveBeenCalled(); expect(request.response.raw).toBe('');
    expect(test.fetcher.mock.calls[0][1]!.signal!.aborted).toBe(true);
    expect(cancel).toHaveBeenCalledTimes(1);
  });
  it.each(['fetch', 'read', 'principal', 'database', 'facility'] as const)('enforces a hard deadline when %s ignores cancellation', async (phase) => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(time));
    const test = harness(); const stalled = new Promise<never>(() => undefined);
    if (phase === 'fetch') test.fetcher.mockReturnValue(stalled);
    if (phase === 'read') test.fetcher.mockResolvedValue(new Response(new ReadableStream({ pull: () => stalled, cancel: () => stalled })));
    if (phase === 'principal') vi.mocked(test.principal.revalidate).mockReturnValue(stalled);
    if (phase === 'database') test.repository.overview.mockReturnValue(stalled);
    if (phase === 'facility') test.repository.facility.mockReturnValue(stalled);
    const request = test.begin(phase === 'facility' ? { body: { facilityId: 'facility-1' } } : {});
    await vi.advanceTimersByTimeAsync(25001); await request.finished;
    expect(request.response.statusCode).toBe(504); expect(test.repository.saveBriefing).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it('bounds a request body that never finishes and does not start a provider request', async () => {
    vi.useFakeTimers(); const test = harness(); const request = test.begin({ noEnd: true });
    await vi.advanceTimersByTimeAsync(5001); await request.finished;
    expect(request.response.statusCode).toBe(408); expect(test.fetcher).not.toHaveBeenCalled();
    (request.req as unknown as PassThrough).end();
  });
});
