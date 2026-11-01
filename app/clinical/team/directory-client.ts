'use client';

import { directoryCommandResultSchema, directoryCommandSchema, directorySnapshotSchema, type DirectoryCommand, type DirectorySnapshot } from '@/lib/clinical/directory-contracts';

export const LOCAL_DIRECTORY_CLINIC = 'crm-clinic-local';
export class DirectoryRequestError extends Error {
  constructor(readonly status: number, readonly code: string, message: string) { super(message); this.name = 'DirectoryRequestError'; }
}
async function read(response: Response) {
  const payload: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = payload && typeof payload === 'object' && 'error' in payload ? payload.error : null;
    const value = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
    throw new DirectoryRequestError(response.status, typeof value.code === 'string' ? value.code : 'DIRECTORY_UNAVAILABLE',
      response.status === 403 ? 'Доступ к управлению сотрудниками не назначен. Это не пустой список: записи закрыты для текущего аккаунта.' :
        typeof value.message === 'string' ? value.message : 'Не удалось получить подтверждение базы. Проверьте состояние перед повтором.');
  }
  return payload;
}
export async function loadDirectory(signal?: AbortSignal): Promise<DirectorySnapshot> {
  const payload = await read(await fetch(`/api/directory/v1/snapshot?clinicId=${LOCAL_DIRECTORY_CLINIC}`, { cache: 'no-store', signal }));
  const parsed = directorySnapshotSchema.safeParse(payload);
  if (!parsed.success || parsed.data.clinic.id !== LOCAL_DIRECTORY_CLINIC) throw new DirectoryRequestError(502, 'INVALID_DIRECTORY', 'Получен несовместимый справочник. Изменения закрыты.');
  return parsed.data;
}
export async function directoryCommand(command: DirectoryCommand) {
  const body = directoryCommandSchema.parse(command);
  if (body.clinicId !== LOCAL_DIRECTORY_CLINIC) throw new DirectoryRequestError(400, 'INVALID_CLINIC', 'Выбрана другая клиника.');
  const result = await read(await fetch('/api/directory/v1/commands', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' }));
  const parsed = directoryCommandResultSchema.safeParse(result);
  if (!parsed.success) throw new DirectoryRequestError(502, 'INVALID_RECEIPT', 'База не подтвердила результат. Обновите список перед повтором.');
  return parsed.data;
}
