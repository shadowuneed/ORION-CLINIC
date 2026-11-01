import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ClinicalRequestError } from '@/lib/clinical/encounter-client';
import type { ClinicalCommand, ClinicalCommandResult } from '@/lib/clinical/contracts';
import { StartEncounterButton, clinicalRequestDeadline, createClinicalCommandGate, sendBoundedClinicalCommand } from './start-encounter-button';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const key = '4652da2e-f0b4-4f4b-96ae-796e7c19ec14';
const start: ClinicalCommand = { type: 'encounter.start', patientId: 'patient-1', visitId: 'visit-7', idempotencyKey: key };
const receipt: ClinicalCommandResult = { resourceId: 'encounter-1', encounterId: 'encounter-1', version: 1, replayed: false };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

describe('atomic start/resume and registry command execution', () => {
  it('allows one in-flight request on rapid double click', async () => {
    const wait = deferred<ClinicalCommandResult>(); const transport = vi.fn(() => wait.promise); const gate = createClinicalCommandGate(transport);
    const first = gate.run(start); expect(await gate.run(start)).toEqual({ status: 'busy' });
    expect(transport).toHaveBeenCalledTimes(1); wait.resolve(receipt);
    expect(await first).toMatchObject({ status: 'confirmed', result: receipt }); expect(gate.pending()).toBeNull();
  });
  it('keeps exactly the original payload/key on ambiguous retries, including the selected visit', async () => {
    const transport = vi.fn().mockRejectedValueOnce(new TypeError('Connection lost')).mockResolvedValueOnce({ ...receipt, replayed: true });
    const gate = createClinicalCommandGate(transport);
    expect(await gate.run(start)).toMatchObject({ status: 'failed', pending: start });
    expect(await gate.run({ ...start, patientId: 'other-patient' })).toMatchObject({ status: 'failed', pending: start });
    expect(transport).toHaveBeenCalledTimes(1);
    expect(await gate.run(gate.pending()!)).toMatchObject({ status: 'confirmed', result: { replayed: true } });
    expect(transport.mock.calls[0][0]).toEqual(transport.mock.calls[1][0]);
  });
  it('retains registration text after a network failure without accepting mutated/new input', async () => {
    const transport = vi.fn().mockRejectedValue(new Error('Network lost')); const gate = createClinicalCommandGate(transport);
    const registration: ClinicalCommand = { type: 'patient.register', name: 'Имя пациента', birthDate: '1990-01-01', sex: 'female', idempotencyKey: key };
    expect(await gate.run(registration)).toMatchObject({ status: 'failed', pending: registration });
    registration.name = 'Изменённый ввод';
    expect(gate.pending()).toMatchObject({ name: 'Имя пациента', birthDate: '1990-01-01' });
    expect(await gate.run(registration)).toMatchObject({ status: 'failed' }); expect(transport).toHaveBeenCalledTimes(1);
  });
  it('releases a rejected CAS/permission command but preserves timeout/rate-limit ambiguity', async () => {
    for (const status of [400, 401, 403, 409]) {
      const gate = createClinicalCommandGate(vi.fn().mockRejectedValue(new ClinicalRequestError('Rejected', 'REJECTED', status)));
      expect(await gate.run(start)).toMatchObject({ status: 'failed', pending: null });
    }
    for (const status of [408, 429, 500, 502]) {
      const gate = createClinicalCommandGate(vi.fn().mockRejectedValue(new ClinicalRequestError('Unknown result', 'RETRY', status)));
      expect(await gate.run(start)).toMatchObject({ status: 'failed', pending: start });
    }
  });
  it('fences a late response after unmount or patient change and aborts the request', async () => {
    const wait = deferred<ClinicalCommandResult>(); let signal: AbortSignal | undefined;
    const gate = createClinicalCommandGate(async (_, requestSignal) => { signal = requestSignal; return wait.promise; });
    const running = gate.run(start); gate.cancel(); expect(signal?.aborted).toBe(true);
    wait.resolve(receipt); expect(await running).toEqual({ status: 'cancelled' }); expect(gate.pending()).toBeNull();
  });
  it('posts the explicit visit with no actor override and rejects a missing encounter receipt', async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(receipt)).mockResolvedValueOnce(Response.json({ ...receipt, encounterId: null })); vi.stubGlobal('fetch', fetch);
    expect(await sendBoundedClinicalCommand(start)).toEqual(receipt);
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(start); expect(fetch.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    await expect(sendBoundedClinicalCommand(start)).rejects.toMatchObject({ code: 'INVALID_RECEIPT', status: 502 });
  });
  it('times out a stuck request, aborts transport, and never treats timeout as confirmation', async () => {
    vi.useFakeTimers(); let signal: AbortSignal | undefined;
    const outcome = clinicalRequestDeadline(async requestSignal => { signal = requestSignal; return new Promise<never>(() => {}); }, undefined, 20).catch(error => error);
    await vi.advanceTimersByTimeAsync(21); expect(signal?.aborted).toBe(true);
    expect(await outcome).toMatchObject({ message: expect.stringContaining('не подтверждён') });
  });
  it('does not start an already cancelled request', async () => {
    const controller = new AbortController(); controller.abort(); const action = vi.fn();
    await expect(clinicalRequestDeadline(action, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(action).not.toHaveBeenCalled();
  });
  it('SSR shows one obvious start action and honours disabled state without issuing a request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const html = renderToStaticMarkup(createElement(StartEncounterButton, { patientId: 'patient-1', visitId: 'visit-7', disabled: true }));
    expect(html.match(/<button/g)).toHaveLength(1); expect(html).toContain('Начать приём'); expect(html).toContain('disabled=""');
    expect(fetch).not.toHaveBeenCalled();
  });
});
