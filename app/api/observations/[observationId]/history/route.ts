import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { cloudObservationAccess, cloudObservationFailure, cloudObservationReadQuery, cloudObservationScope } from '@/lib/cloud/observation-api.server';
import { decodeCloudObservationCursor, requireCloudObservationCursorScope } from '@/lib/cloud/observation-cursor.server';
import { parseCloudObservationHistoryPage } from '@/lib/cloud/observation-response-contracts.server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ observationId: string }> }) {
  const context = createApiRequestContext(request, '/api/observations/:observationId/history');
  const { observationId } = await params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(observationId)) return apiFailure(context, 400, 'INVALID_OBSERVATION_QUERY', 'Проверьте выбранную запись.');
  try {
    const query = cloudObservationReadQuery(request);
    const cursor = decodeCloudObservationCursor(query.cursor);
    if (cursor && (cursor.kind !== 'observation_history' || cursor.patientId !== query.patientId || cursor.observationId !== observationId)) {
      return apiFailure(context, 400, 'INVALID_CONTINUATION', 'Проверьте параметры истории.');
    }
    const { database, access } = await cloudObservationAccess(request, query);
    const scope = cloudObservationScope(access, query.patientId);
    requireCloudObservationCursorScope(cursor, scope, 'observation_history', observationId);
    const result = parseCloudObservationHistoryPage(await database.call('orion_observation_history_page', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id, patient_id: query.patientId,
      observation_id: observationId, max_results: query.limit, cursor,
    }), scope, observationId, { limit: query.limit, cursor });
    return apiSuccess(context, { ...result, persistence: 'supabase', historyMode: 'bounded-selected-observation' });
  } catch (error) { return cloudObservationFailure(context, error); }
}
