'use client';

import { clinicalCommandResultSchema, clinicalCommandSchema, clinicalSnapshotSchema, type ClinicalCommand, type ClinicalSnapshot } from './contracts';

export class ClinicalRequestError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) { super(message); this.name = 'ClinicalRequestError'; }
}
export async function clinicalJson(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? body.error : null;
    const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
    throw new ClinicalRequestError(typeof record.message === 'string' ? record.message : 'Не удалось выполнить запрос. Сохранённые данные остаются в базе.',
      typeof record.code === 'string' ? record.code : 'REQUEST_FAILED', response.status);
  }
  return body;
}
export async function loadClinicalSnapshot(signal?: AbortSignal, patientId?: string): Promise<ClinicalSnapshot> {
  const url = patientId ? `/api/clinical/v1/patients/${encodeURIComponent(patientId)}` : '/api/clinical/v1/snapshot';
  const value = await clinicalJson(await fetch(url, { cache: 'no-store', signal }));
  const parsed = clinicalSnapshotSchema.safeParse(value);
  if (!parsed.success) throw new ClinicalRequestError('Сервер вернул несовместимую запись. Обновите страницу.', 'INVALID_SNAPSHOT', 502);
  return parsed.data;
}
export async function sendClinicalCommand(input: ClinicalCommand) {
  const command = clinicalCommandSchema.parse(input);
  const value = await clinicalJson(await fetch('/api/clinical/v1/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), cache: 'no-store' }));
  const parsed = clinicalCommandResultSchema.safeParse(value);
  if (!parsed.success) throw new ClinicalRequestError('Ответ о сохранении не подтверждён. Обновите запись перед повтором.', 'INVALID_RECEIPT', 502);
  return parsed.data;
}
