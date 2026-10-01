import { createObservationSchema } from '@/lib/domain/observations';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { boundedObservationPayload, cloudObservationAccess, cloudObservationFailure, cloudObservationMetadata,
  cloudObservationMutationAllowed, cloudObservationReadQuery, cloudObservationScope, validateCloudObservationCommand } from '@/lib/cloud/observation-api.server';
import { decodeCloudObservationCursor, requireCloudObservationCursorScope } from '@/lib/cloud/observation-cursor.server';
import { parseCloudObservationMutation, parseCloudObservationsPage } from '@/lib/cloud/observation-response-contracts.server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/observations');
  try {
    const query = cloudObservationReadQuery(request);
    const cursor = decodeCloudObservationCursor(query.cursor);
    if (cursor && (cursor.kind !== 'observations' || cursor.patientId !== query.patientId)) {
      return apiFailure(context, 400, 'INVALID_CONTINUATION', 'Проверьте параметры страницы.');
    }
    const { database, access } = await cloudObservationAccess(request, query);
    const scope = cloudObservationScope(access, query.patientId);
    requireCloudObservationCursorScope(cursor, scope, 'observations');
    const result = parseCloudObservationsPage(await database.call('orion_observations_page', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id, patient_id: query.patientId,
      max_results: query.limit, cursor,
    }), scope, { limit: query.limit, cursor });
    return apiSuccess(context, { ...cloudObservationMetadata(access, result.role), ...result,
      accessAssignment: { assignmentId: result.accessAssignmentId, assignmentVersionId: result.assignmentVersionId },
      patients: [result.patient], patientSelection: 'explicit', historyMode: 'bounded-current-window' });
  } catch (error) { return cloudObservationFailure(context, error); }
}

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/observations');
  if (!cloudObservationMutationAllowed(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  const parsed = createObservationSchema.safeParse(await boundedObservationPayload(request).catch(() => null));
  if (!parsed.success) return apiFailure(context, 422, 'OBSERVATION_INVALID', 'Проверьте пациента, время и заполненные группы показателей.');
  try {
    validateCloudObservationCommand(parsed.data);
    const { database, access } = await cloudObservationAccess(request, parsed.data);
    const result = parseCloudObservationMutation(await database.call('orion_observation_create', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id, payload: parsed.data,
    }), cloudObservationScope(access, parsed.data.patientId), {});
    return apiSuccess(context, { ...result, persistence: 'supabase' }, 201);
  } catch (error) { return cloudObservationFailure(context, error); }
}
