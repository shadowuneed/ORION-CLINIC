import { AccessAssignmentNotFoundError, AccessMembershipRequiredError, AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { MultiplePatientAccessSelectionRequiredError, resolvePatientDirectoryAccess, type PatientDirectoryPermission } from '@/lib/auth/patient-directory-access';
import { apiFailure, type ApiRequestContext } from '@/lib/http/api-response';
import { cloudDatabaseForRequest, CloudSessionChangedError } from './database-context.server';
import { CloudAccessGovernanceRepository } from './access-repository.server';
import { CloudRpcError } from './supabase-rpc.server';
import { parseCloudAuthConfig } from './auth-config.server';

export async function cloudPatientAccess(request: Request, permission: PatientDirectoryPermission,
  assignmentId?: string, facilityId?: string) {
  const database = await cloudDatabaseForRequest(request);
  const access = await resolvePatientDirectoryAccess(new CloudAccessGovernanceRepository(database),
    database.principal, permission, assignmentId, facilityId);
  return { database, access };
}

export function cloudPatientFailure(context: ApiRequestContext, error: unknown) {
  if (error instanceof CloudSessionChangedError) return apiFailure(context, 409, 'SESSION_CHANGED', 'Аккаунт изменился. Выполните вход заново.');
  if (error instanceof MultiplePatientAccessSelectionRequiredError) {
    return apiFailure(context, 409, 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED', 'Выберите рабочий контур.', { assignments: error.assignments });
  }
  if (error instanceof CloudRpcError && error.kind === 'unauthenticated') return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
  if (error instanceof AccessAssignmentNotFoundError || error instanceof AccessMembershipRequiredError ||
      error instanceof AccessPermissionRequiredError || (error instanceof CloudRpcError && error.kind === 'forbidden')) {
    return apiFailure(context, 403, 'PATIENT_DIRECTORY_FORBIDDEN', 'Нет доступа к реестру.');
  }
  if (error instanceof CloudRpcError && error.kind === 'conflict') {
    return apiFailure(context, 409, 'PATIENT_COMMAND_CONFLICT', 'Состояние изменилось. Обновите карточку.');
  }
  return apiFailure(context, 503, 'CLOUD_DATABASE_UNAVAILABLE', 'Не удалось подтвердить доступ или сохранить операцию в облачной базе.');
}

export function cloudPatientMutationAllowed(request: Request) {
  try {
    const config = parseCloudAuthConfig(process.env);
    return process.env.ORION_SYNTHETIC_DATA_ONLY === 'true' &&
      new URL(request.url).origin === config.publicOrigin && request.headers.get('origin') === config.publicOrigin &&
      ['same-origin', null].includes(request.headers.get('sec-fetch-site')) &&
      /^application\/json(?:\s*;|$)/i.test(request.headers.get('content-type') ?? '');
  } catch { return false; }
}

export async function boundedPatientPayload(request: Request): Promise<unknown> {
  if (!request.body) throw new Error('Missing request.');
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 16_384) throw new Error('Request too large.');
      chunks.push(value);
    }
  } catch (error) { await reader.cancel().catch(() => undefined); throw error; }
  finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}
