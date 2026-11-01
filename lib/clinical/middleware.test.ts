import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { clinicalLocalMiddleware } from '../../scripts/clinical-local-middleware';
import { clinicalCommandSchema, type ClinicalSnapshot } from './contracts';

const snapshot: ClinicalSnapshot = { schemaVersion: 1, clinicId: 'clinic', practitioner: { id: 'doctor', staffId: 'staff', name: 'Doctor', specialty: 'Therapy' }, practitioners: [], patients: [], encounters: [], notes: [], referrals: [], consents: [], transcript: [], generatedAt: '2026-10-07T10:00:00.000Z' };
const command = { type: 'encounter.start', patientId: 'patient', idempotencyKey: 'd6a6fd5a-cfa8-437b-90ab-811bb1d71a16' };
function fixture(options: { path?: string; method?: string; body?: unknown; rawBody?: string; headers?: Record<string, string>; anonymous?: boolean; configured?: boolean } = {}) {
  const state = { valid: true };
  const read = vi.fn(async () => snapshot);
  const patient = vi.fn(async () => snapshot);
  const result = { resourceId: 'encounter', encounterId: 'encounter', version: 1, replayed: false };
  const write = vi.fn(async () => result);
  const speech = { handle: vi.fn(async () => new Response('{}', { headers: { 'Content-Type': 'application/json' } })) };
  const repository = { snapshot: read, patient, command: write };
  const request = Readable.from([Buffer.from(options.rawBody ?? JSON.stringify(options.body ?? command))]) as unknown as IncomingMessage;
  Object.assign(request, { url: options.path ?? '/api/clinical/v1/commands', method: options.method ?? 'POST', aborted: false,
    headers: { host: '127.0.0.1:3200', origin: 'http://127.0.0.1:3200', 'content-type': 'application/json', ...options.headers }, socket: { remoteAddress: '127.0.0.1' } });
  const output = { statusCode: 200, destroyed: false, writableEnded: false, body: '', headers: new Map<string, unknown>(),
    setHeader(name: string, value: unknown) { this.headers.set(name.toLowerCase(), value); },
    end(body = '') { this.body = String(body); this.writableEnded = true; } };
  const next = vi.fn();
  const middleware = clinicalLocalMiddleware({ port: 3200, principal: () => options.anonymous ? undefined : {
    issuer: 'verified', subject: 'doctor-1', generation: 'a'.repeat(32), revalidate: async () => state.valid,
  }, repository: options.configured === false ? null : repository, parseCommand: value => clinicalCommandSchema.parse(value), speech });
  return { state, output, read, patient, write, speech, result, next, run: () => middleware(request, output as unknown as ServerResponse, next) };
}

describe('unified clinical HTTP boundary', () => {
  it('passes unrelated routes without reading clinical data', async () => {
    const f = fixture({ path: '/help', anonymous: true }); await f.run(); expect(f.next).toHaveBeenCalledOnce(); expect(f.read).not.toHaveBeenCalled();
  });
  it('requires the private principal even with forged HTTP roles', async () => {
    const f = fixture({ anonymous: true, headers: { 'oai-authenticated-user-id': 'admin', 'x-orion-role': 'doctor' } }); await f.run(); expect(f.output.statusCode).toBe(401); expect(f.write).not.toHaveBeenCalled();
  });
  it('uses exact verified actor and returns canonical command result', async () => {
    const f = fixture(); await f.run(); expect(f.write).toHaveBeenCalledWith({ issuer: 'verified', subject: 'doctor-1' }, command, expect.any(Function)); expect(JSON.parse(f.output.body)).toEqual(f.result); expect(f.output.headers.get('cache-control')).toBe('no-store');
  });
  it.each<Record<string, string>>([{ origin: 'https://evil.invalid' }, { 'sec-fetch-site': 'cross-site' }, { host: 'evil.invalid' }, { 'x-forwarded-host': 'localhost:3200' }])('denies host/origin forgery %j', async headers => {
    const f = fixture({ headers }); await f.run(); expect(f.output.statusCode).toBe(403); expect(f.write).not.toHaveBeenCalled();
  });
  it('enforces origin on DELETE speech session', async () => {
    const f = fixture({ path: '/api/clinical/v1/speech/session', method: 'DELETE', headers: { origin: 'https://evil.invalid' } }); await f.run(); expect(f.output.statusCode).toBe(403); expect(f.speech.handle).not.toHaveBeenCalled();
  });
  it('dispatches scoped patient reads', async () => {
    const f = fixture({ path: '/api/clinical/v1/patients/patient-10', method: 'GET' }); await f.run(); expect(f.patient).toHaveBeenCalledWith({ issuer: 'verified', subject: 'doctor-1' }, 'patient-10', expect.any(Function)); expect(f.output.statusCode).toBe(200);
  });
  it('dispatches the doctor inbox read', async () => {
    const f = fixture({ path: '/api/clinical/v1/snapshot', method: 'GET' }); await f.run(); expect(f.read).toHaveBeenCalledOnce();
  });
  it('rejects browser transcript injection', async () => {
    const f = fixture({ body: { ...command, type: 'transcript.append', text: 'forged' } }); await f.run(); expect(f.output.statusCode).toBe(400); expect(f.write).not.toHaveBeenCalled();
  });
  it('rejects caller-supplied actor and clinic selectors', async () => {
    const f = fixture({ body: { ...command, clinicId: 'other', actor: 'admin' } }); await f.run(); expect(f.output.statusCode).toBe(400); expect(f.write).not.toHaveBeenCalled();
  });
  it.each(['{', 'null', '[]'])('rejects malformed commands %s', async rawBody => {
    const f = fixture({ rawBody }); await f.run(); expect(f.output.statusCode).toBe(400); expect(f.write).not.toHaveBeenCalled();
  });
  it('limits JSON body without trusting Content-Length', async () => {
    const f = fixture({ rawBody: ' '.repeat(96 * 1024 + 1) }); await f.run(); expect(f.output.statusCode).toBe(413); expect(f.write).not.toHaveBeenCalled();
  });
  it('does not fallback when PG is absent', async () => {
    const f = fixture({ configured: false }); await f.run(); expect(f.output.statusCode).toBe(503); expect(f.output.body).not.toContain('patients');
  });
  it('drops a response after revocation during database read', async () => {
    const f = fixture({ path: '/api/clinical/v1/snapshot', method: 'GET' }); f.read.mockImplementationOnce(async () => { f.state.valid = false; return snapshot; }); await f.run(); expect(f.output.statusCode).toBe(409); expect(f.output.body).not.toContain('clinicId');
  });
  it('does not expose driver statements or credentials', async () => {
    const f = fixture(); f.write.mockRejectedValueOnce(Object.assign(new Error('postgres://sensitive-password'), { code: 'XX000' })); await f.run(); expect(f.output.statusCode).toBe(503); expect(f.output.body).not.toContain('sensitive');
  });
  it.each(['PRIVATE_DETAIL_ACCESS_DENIED', 'PRIVATE_DETAIL_CONFLICT', 'PRIVATE_DETAIL_NOT_FOUND', '__proto__', 'toString'])('does not publish a driver code just because its suffix resembles a domain error: %s', async code => {
    const f = fixture(); f.write.mockRejectedValueOnce(Object.assign(new Error('private error'), { code })); await f.run();
    expect(f.output.statusCode).toBe(503); expect(JSON.parse(f.output.body).error.code).toBe('CLINICAL_UNAVAILABLE'); expect(f.output.body).not.toContain('PRIVATE_DETAIL');
  });
  it.each([
    ['/api/clinical/v1/speech/transcribe', 'POST', 800001], ['/api/clinical/v1/speech/session', 'POST', 4097],
    ['/api/clinical/v1/speech/session', 'DELETE', 4097], ['/api/clinical/v1/analysis', 'POST', 4097],
  ])('bounds %s %s before forwarding the payload', async (path, method, size) => {
    const f = fixture({ path, method, rawBody: ' '.repeat(size) }); await f.run(); expect(f.output.statusCode).toBe(413); expect(f.speech.handle).not.toHaveBeenCalled();
  });
  it('retains exact known conflict codes and actionable messages', async () => {
    const f = fixture(); f.write.mockRejectedValueOnce(Object.assign(new Error('private SQL'), { code: 'CLINICAL_CAPACITY_CONFLICT' })); await f.run();
    expect(f.output.statusCode).toBe(409); expect(JSON.parse(f.output.body).error.code).toBe('CLINICAL_CAPACITY_CONFLICT'); expect(f.output.body).toContain('Кабинет или врач уже заняты');
  });
});
