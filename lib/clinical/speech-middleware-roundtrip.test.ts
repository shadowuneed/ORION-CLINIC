import { Readable } from 'node:stream';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { describe, expect, it, vi } from 'vitest';
import { clinicalLocalMiddleware } from '../../scripts/clinical-local-middleware';
import { clinicalCommandSchema } from './contracts';
import { encounterFixture } from './test-fixtures';

describe('HTTP to speech transport boundary', () => {
  it('forwards the exact audio resource selectors and bytes, but not caller identity headers', async () => {
    const bytes = Buffer.from([82, 73, 70, 70, 0, 1, 2, 3]);
    const request = Readable.from([bytes]) as unknown as IncomingMessage;
    Object.assign(request, { url: '/api/clinical/v1/speech/transcribe', method: 'POST', aborted: false,
      headers: { host: '127.0.0.1:3200', origin: 'http://127.0.0.1:3200', 'content-type': 'audio/wav',
        'x-orion-encounter-id': 'encounter-1', 'x-orion-speech-session-id': '9e02b6cf-774e-4fa4-adc0-324cc6fd8981', 'x-orion-utterance-index': '7',
        'x-orion-role': 'administrator', 'x-orion-actor-id': 'attacker', authorization: 'must-not-forward' }, socket: { remoteAddress: '127.0.0.1' } });
    const state = { statusCode: 200, destroyed: false, writableEnded: false, payload: '', setHeader: vi.fn(),
      end(value: Buffer) { this.payload = value.toString(); this.writableEnded = true; } };
    const calls: Request[] = [];
    const middleware = clinicalLocalMiddleware({ port: 3200, principal: () => ({ issuer: 'local', subject: 'doctor-1', generation: 'a'.repeat(32), revalidate: async () => true }),
      repository: { snapshot: async () => encounterFixture(), patient: async () => encounterFixture(), command: async () => ({}) },
      parseCommand: input => clinicalCommandSchema.parse(input),
      speech: { handle: async input => {
        calls.push(input.request); expect(input.actor).toEqual({ issuer: 'local', subject: 'doctor-1' });
        expect(new Uint8Array(await input.request.arrayBuffer())).toEqual(new Uint8Array(bytes));
        return Response.json({ accepted: true });
      } },
    });
    await middleware(request, state as unknown as ServerResponse, vi.fn());
    expect(state.statusCode).toBe(200); expect(calls).toHaveLength(1);
    const headers = calls[0].headers;
    expect(headers.get('x-orion-encounter-id')).toBe('encounter-1');
    expect(headers.get('x-orion-speech-session-id')).toBe('9e02b6cf-774e-4fa4-adc0-324cc6fd8981');
    expect(headers.get('x-orion-utterance-index')).toBe('7');
    expect(headers.get('x-orion-role')).toBeNull(); expect(headers.get('x-orion-actor-id')).toBeNull(); expect(headers.get('authorization')).toBeNull();
  });

  function liveHarness({ path = '/api/clinical/v1/analysis/live', origin = 'http://127.0.0.1:3200', body = JSON.stringify({ encounterId: 'encounter-1' }), valid = true } = {}) {
    const request = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
    Object.assign(request, { url: path, method: 'POST', aborted: false,
      headers: { host: '127.0.0.1:3200', origin, 'content-type': 'application/json', 'x-orion-role': 'administrator' }, socket: { remoteAddress: '127.0.0.1' } });
    const state = { statusCode: 200, destroyed: false, writableEnded: false, payload: '', setHeader: vi.fn(),
      end(value: Buffer | string) { this.payload = value.toString(); this.writableEnded = true; } };
    const handle = vi.fn(async (input: { request: Request }) => {
      expect(input.request.headers.get('x-orion-role')).toBeNull();
      expect(await input.request.json()).toEqual({ encounterId: 'encounter-1' });
      return Response.json({ error: { code: 'ANALYSIS_RATE_LIMITED', message: 'Later' }, retryAfterMs: 90000 }, { status: 429, headers: { 'Retry-After': '90' } });
    });
    const command = vi.fn(async () => ({})); const revalidate = vi.fn(async () => valid);
    const middleware = clinicalLocalMiddleware({ port: 3200,
      principal: () => ({ issuer: 'local', subject: 'doctor-1', generation: 'a'.repeat(32), revalidate }),
      repository: { snapshot: async () => encounterFixture(), patient: async () => encounterFixture(), command },
      parseCommand: input => clinicalCommandSchema.parse(input), speech: { handle },
    });
    return { state, handle, command, revalidate, run: () => middleware(request, state as unknown as ServerResponse, vi.fn()) };
  }
  it('routes exact live analysis as read-only with bounded input and Retry-After propagation', async () => {
    const test = liveHarness(); await test.run();
    expect(test.state.statusCode).toBe(429); expect(test.handle).toHaveBeenCalledTimes(1); expect(test.command).not.toHaveBeenCalled();
    expect(test.state.setHeader).toHaveBeenCalledWith('Retry-After', '90');
    expect(test.state.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
    expect(test.revalidate.mock.calls.length).toBeGreaterThanOrEqual(4);
  });
  it.each([
    [{ path: '/api/clinical/v1/analysis/live/other' }, 404],
    [{ body: JSON.stringify({ encounterId: 'a'.repeat(4096) }) }, 413],
    [{ origin: 'https://attacker.invalid' }, 403],
    [{ valid: false }, 409],
  ] as const)('rejects unsafe analysis transport before the bridge: %j', async (options, status) => {
    const test = liveHarness(options); await test.run();
    expect(test.state.statusCode).toBe(status); expect(test.handle).not.toHaveBeenCalled(); expect(test.command).not.toHaveBeenCalled();
  });
});
