'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Stethoscope } from 'lucide-react';
import { ClinicalRequestError, clinicalJson } from '@/lib/clinical/encounter-client';
import { clinicalCommandResultSchema, clinicalCommandSchema, type ClinicalCommand, type ClinicalCommandResult } from '@/lib/clinical/contracts';

/** A deadline ends UI waiting, not proof that the server did not commit a write. */
export async function clinicalRequestDeadline<T>(action: (signal: AbortSignal) => Promise<T>, signal?: AbortSignal, timeoutMs = 20000): Promise<T> {
  const controller = new AbortController(); let timedOut = false;
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const aborted = new Promise<never>((_, reject) => {
    const rejectAbort = () => reject(timedOut ? new Error('Сервер не ответил вовремя. Результат ещё не подтверждён; повторите тот же запрос.') : new DOMException('Request cancelled', 'AbortError'));
    if (controller.signal.aborted) rejectAbort(); else controller.signal.addEventListener('abort', rejectAbort, { once: true });
  });
  try { return await Promise.race([aborted, controller.signal.aborted ? aborted : action(controller.signal)]); }
  finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
}

export async function sendBoundedClinicalCommand(command: ClinicalCommand, signal?: AbortSignal): Promise<ClinicalCommandResult> {
  const body = clinicalCommandSchema.parse(command);
  return clinicalRequestDeadline(async requestSignal => {
    const value = await clinicalJson(await fetch('/api/clinical/v1/commands', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: requestSignal }));
    const parsed = clinicalCommandResultSchema.safeParse(value);
    if (!parsed.success || (['encounter.start', 'referral.accept'].includes(body.type) && !parsed.data.encounterId)) {
      throw new ClinicalRequestError('Приём или сохранение не подтверждены сервером. Повторите тот же запрос.', 'INVALID_RECEIPT', 502);
    }
    return parsed.data;
  }, signal);
}

export type ClinicalCommandOutcome = { status: 'busy' } | { status: 'cancelled' } |
  { status: 'confirmed'; command: ClinicalCommand; result: ClinicalCommandResult } |
  { status: 'failed'; error: unknown; pending: ClinicalCommand | null };

/** One in-flight command; ambiguous retries keep the exact original payload/key. */
export function createClinicalCommandGate(transport = sendBoundedClinicalCommand) {
  let pending: ClinicalCommand | null = null; let active = false; let revision = 0; let controller: AbortController | null = null;
  return {
    pending: () => pending,
    cancel() { ++revision; controller?.abort(); controller = null; active = false; pending = null; },
    async run(input: ClinicalCommand): Promise<ClinicalCommandOutcome> {
      if (active) return { status: 'busy' };
      if (pending && JSON.stringify(input) !== JSON.stringify(pending)) return { status: 'failed', pending,
        error: new Error('Сначала подтвердите результат предыдущего запроса. Новое действие не отправлено.') };
      try { pending ??= clinicalCommandSchema.parse(input); } catch (error) { return { status: 'failed', error, pending: null }; }
      const command = pending; const currentRevision = revision; const currentController = new AbortController(); controller = currentController; active = true;
      try {
        const result = await transport(command, currentController.signal);
        if (revision !== currentRevision || currentController.signal.aborted) return { status: 'cancelled' };
        pending = null; return { status: 'confirmed', command, result };
      } catch (error) {
        if (revision !== currentRevision || currentController.signal.aborted) return { status: 'cancelled' };
        if (error instanceof ClinicalRequestError && error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) pending = null;
        return { status: 'failed', error, pending };
      } finally { if (revision === currentRevision) { active = false; controller = null; } }
    },
  };
}

type StartProps = { patientId: string; visitId?: string; className?: string; disabled?: boolean; label?: string };
/** Keying prevents a previous patient's completion from navigating a reused map button. */
export function StartEncounterButton(props: StartProps) { return <StartEncounterControl key={`${props.patientId}:${props.visitId ?? ''}`} {...props} />; }
function StartEncounterControl({ patientId, visitId, className, disabled = false, label = 'Начать приём' }: StartProps) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [gate] = useState(() => createClinicalCommandGate()); const mounted = useRef(true); const router = useRouter();
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; gate.cancel(); }; }, [gate]);
  async function start() {
    if (disabled) return;
    setBusy(true); setError('');
    const result = await gate.run(gate.pending() ?? { type: 'encounter.start', patientId, ...(visitId ? { visitId } : {}), idempotencyKey: crypto.randomUUID() });
    if (!mounted.current || result.status === 'cancelled' || result.status === 'busy') return;
    if (result.status === 'confirmed') router.push(`/clinical?encounterId=${encodeURIComponent(result.result.encounterId!)}`);
    else setError(result.error instanceof Error ? result.error.message : 'Не удалось открыть приём. Повторите запрос.');
    setBusy(false);
  }
  return <div><button className={className} type="button" disabled={disabled || busy} onClick={() => void start()}><Stethoscope size={16} aria-hidden="true" />{busy ? 'Открываем приём…' : error ? 'Повторить открытие приёма' : label}</button>{error && <p role="alert">{error}</p>}</div>;
}
