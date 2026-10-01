import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { cloudObservationAccess, cloudObservationFailure, cloudObservationReadQuery, cloudObservationScope } from '@/lib/cloud/observation-api.server';
import { parseCloudLatestVitals } from '@/lib/cloud/observation-latest-contract.server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/observations/latest-vitals');
  try {
    const query = cloudObservationReadQuery(request);
    const params = new URL(request.url).searchParams;
    if (params.has('limit') || params.has('cursor')) return apiFailure(context, 400, 'INVALID_OBSERVATION_QUERY', 'Проверьте параметры показателей.');
    const { database, access } = await cloudObservationAccess(request, query);
    const result = parseCloudLatestVitals(await database.call('orion_patient_latest_vitals', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id, patient_id: query.patientId,
    }), cloudObservationScope(access, query.patientId));
    return apiSuccess(context, { ...result, persistence: 'supabase' });
  } catch (error) { return cloudObservationFailure(context, error); }
}
