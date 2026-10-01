import { z } from 'zod';
import { AccessAssignmentNotFoundError, AccessMembershipRequiredError, AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { MultipleObservationAccessSelectionRequiredError, observationCapabilities, ObservationPermissionRequiredError,
  resolveObservationAccess, type ObservationAccess } from '@/lib/auth/observation-access';
import type { ObservationRole } from '@/lib/auth/observation-access';
import { observationListQuerySchema, validateMeasuredAt } from '@/lib/domain/observations';
import { apiFailure, type ApiRequestContext } from '@/lib/http/api-response';
import { CloudAccessGovernanceRepository } from './access-repository.server';
import { cloudDatabaseForRequest, CloudSessionChangedError } from './database-context.server';
import { boundedPatientPayload, cloudPatientMutationAllowed } from './patient-api.server';
import { InvalidCloudObservationCursorError } from './observation-cursor.server';
import { CloudRpcError } from './supabase-rpc.server';

if (typeof window !== 'undefined') throw new Error('Cloud observation API is server-only.');

export class InvalidCloudObservationSelectionError extends Error {}
export class CloudObservationValidationError extends Error {}
export class CloudObservationDataModeUnavailableError extends Error {}
const id = z.string().min(1).max(160).refine(value => value === value.trim() && !/[\u0000-\u001f\u007f,]/.test(value));
const facility = id.max(100);
type Selection = { accessAssignmentId?: string; facilityId?: string };

export function cloudObservationRequestSelection(request: Request, body: Selection = {}): Selection {
  const query = new URL(request.url).searchParams;
  if (['POST', 'PATCH'].includes(request.method) && [...query.keys()].some(key => !['accessAssignmentId', 'facilityId'].includes(key))) {
    // Mutation target comes only from the strict body/path. Do not ignore a
    // second patient/cursor selector hidden in the URL, even if SQL remains safe.
    throw new InvalidCloudObservationSelectionError();
  }
  const selection: Selection = {};
  for (const [key, header, schema] of [['accessAssignmentId', 'x-orion-access-assignment-id', id],
    ['facilityId', 'x-orion-facility-id', facility]] as const) {
    const values = query.getAll(key);
    const fromHeader = request.headers.get(header);
    const supplied = [...values, ...(fromHeader === null ? [] : [fromHeader]), ...(body[key] === undefined ? [] : [body[key]!])];
    if (values.length > 1 || supplied.some(value => !schema.safeParse(value).success || value !== supplied[0])) {
      throw new InvalidCloudObservationSelectionError();
    }
    if (supplied[0] !== undefined) selection[key] = supplied[0];
  }
  return selection;
}

/** Cloud requires a selected patient; a broad patient picker is a separate registry request. */
export function cloudObservationReadQuery(request: Request) {
  const params = new URL(request.url).searchParams;
  const keys = ['facilityId', 'accessAssignmentId', 'patientId', 'limit', 'cursor'];
  if (keys.some(key => params.getAll(key).length > 1) || [...params.keys()].some(key => !keys.includes(key))) {
    throw new InvalidCloudObservationSelectionError();
  }
  const selection = cloudObservationRequestSelection(request);
  const parsed = observationListQuerySchema.extend({ facilityId: facility.optional(), accessAssignmentId: id.optional(),
    patientId: id, limit: z.coerce.number().int().min(1).max(50).default(25) }).safeParse({
    ...selection, patientId: params.get('patientId') ?? undefined, limit: params.get('limit') ?? undefined,
  });
  if (!parsed.success) throw new InvalidCloudObservationSelectionError();
  return { ...parsed.data, cursor: params.get('cursor') };
}

export async function cloudObservationAccess(request: Request, body: Selection = {}) {
  const selection = cloudObservationRequestSelection(request, body);
  if (process.env.ORION_SYNTHETIC_DATA_ONLY !== 'true') throw new CloudObservationDataModeUnavailableError();
  const database = await cloudDatabaseForRequest(request);
  const access = await resolveObservationAccess(new CloudAccessGovernanceRepository(database), database.principal,
    selection.accessAssignmentId, selection.facilityId);
  return { database, access };
}

export function cloudObservationScope(access: ObservationAccess, patientId: string) {
  return { organizationId: access.organization.id, facilityId: access.facility.id, patientId,
    accessAssignmentId: access.assignment.assignmentId };
}
export function cloudObservationMetadata(access: ObservationAccess, role: ObservationRole = access.scope.role) {
  return { viewer: { ...access.user, membershipId: access.scope.membershipId, accessAssignmentId: access.assignment.assignmentId,
    role }, organization: access.organization, facility: access.facility,
    assignments: access.assignments, dataMode: 'synthetic-only' as const,
    capabilities: observationCapabilities(role),
    thresholdPolicy: { status: 'not_configured' as const, decision: 'DEC-006' as const,
      message: 'Правила критичности и клиническая интерпретация не настроены. Записанные значения оценивает сотрудник.' },
    persistence: 'supabase' as const };
}
export function validateCloudObservationCommand(payload: { measuredAt: number; patientId: string; expectedVersion?: number }) {
  if (!id.safeParse(payload.patientId).success || (payload.expectedVersion !== undefined && payload.expectedVersion >= 2147483647)) {
    throw new CloudObservationValidationError();
  }
  try { validateMeasuredAt(payload.measuredAt); }
  catch { throw new CloudObservationValidationError(); }
}
// These existing helpers enforce configured HTTPS origin, same-site JSON,
// synthetic mode and16KiB streamed UTF-8 body. The verified database context
// separately requires the current session-generation header.
export const cloudObservationMutationAllowed = cloudPatientMutationAllowed;
export const boundedObservationPayload = boundedPatientPayload;

export function cloudObservationFailure(context: ApiRequestContext, error: unknown) {
  if (error instanceof CloudSessionChangedError) return apiFailure(context, 409, 'SESSION_CHANGED', 'Аккаунт изменился. Выполните вход заново.');
  if (error instanceof InvalidCloudObservationSelectionError) return apiFailure(context, 400, 'INVALID_OBSERVATION_QUERY', 'Проверьте пациента и рабочий контур.');
  if (error instanceof InvalidCloudObservationCursorError) return apiFailure(context, 400, 'INVALID_CONTINUATION', 'Проверьте параметры страницы.');
  if (error instanceof CloudObservationValidationError) return apiFailure(context, 422, 'OBSERVATION_INVALID', 'Проверьте значения, время и текущую версию.');
  if (error instanceof MultipleObservationAccessSelectionRequiredError) return apiFailure(context, 409, 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED',
    'Выберите рабочий контур.', { assignments: error.assignments });
  if (error instanceof CloudRpcError && error.kind === 'unauthenticated') return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
  if (error instanceof CloudRpcError && error.kind === 'not_found') return apiFailure(context, 404, 'OBSERVATION_NOT_FOUND', 'Запись или пациент недоступны.');
  if (error instanceof AccessAssignmentNotFoundError || error instanceof AccessMembershipRequiredError || error instanceof AccessPermissionRequiredError ||
    error instanceof ObservationPermissionRequiredError || (error instanceof CloudRpcError && error.kind === 'forbidden')) {
    return apiFailure(context, 403, 'OBSERVATION_FORBIDDEN', 'Нет доступа к показателям в выбранном рабочем контуре.');
  }
  if (error instanceof CloudRpcError && error.kind === 'conflict') {
    if (error.observationRejection === 'PAGINATION_STALE') return apiFailure(context, 409, 'PAGINATION_STALE', 'Рабочие права или запись изменились. Начните загрузку страницы заново.');
    if (error.observationRejection === 'OBSERVATION_VERSION_CONFLICT') return apiFailure(context, 409, 'OBSERVATION_VERSION_CONFLICT', 'Запись уже изменили. Загрузите серверную версию перед повтором.');
    if (error.observationRejection === 'OBSERVATION_NO_CHANGE') return apiFailure(context, 409, 'OBSERVATION_NO_CHANGE', 'Значения не изменились. Проверьте изменения или отмените исправление.');
    if (error.observationRejection === 'OBSERVATION_IDEMPOTENCY_CONFLICT') return apiFailure(context, 409, 'OBSERVATION_IDEMPOTENCY_CONFLICT', 'Эта команда уже использована для другой операции. Обновите данные и проверьте сохранённый результат.');
    return apiFailure(context, 409, 'OBSERVATION_CONFLICT', 'Запись, рабочие права или позиция страницы изменились. Обновите данные перед повтором.');
  }
  if (error instanceof CloudRpcError && error.kind === 'invalid') {
    if (error.statusCode === 400) return apiFailure(context, 400, 'INVALID_OBSERVATION_REQUEST', 'Проверьте параметры запроса или начните загрузку заново.');
    if (error.observationRejection === 'OBSERVATION_BMI_OUT_OF_RANGE') return apiFailure(context, 422, 'OBSERVATION_BMI_OUT_OF_RANGE', 'Сочетание роста и веса находится вне поддерживаемого диапазона записи. Проверьте введённые значения.');
    return apiFailure(context, 422, 'OBSERVATION_INVALID', 'Проверьте данные запроса.');
  }
  return apiFailure(context, 503, 'OBSERVATIONS_UNAVAILABLE', 'Не удалось подтвердить доступ или выполнить операцию в облачной базе.');
}
