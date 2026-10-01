import { correctObservationSchema } from '@/lib/domain/observations';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { boundedObservationPayload, cloudObservationAccess, cloudObservationFailure, cloudObservationMutationAllowed,
  cloudObservationScope, validateCloudObservationCommand } from '@/lib/cloud/observation-api.server';
import { parseCloudObservationMutation } from '@/lib/cloud/observation-response-contracts.server';

export const dynamic = 'force-dynamic';

export async function PATCH(request: Request, { params }: { params: Promise<{ observationId: string }> }) {
  const context = createApiRequestContext(request, '/api/observations/:observationId');
  if (!cloudObservationMutationAllowed(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  const { observationId } = await params;
  if (!/^[a-zA-Z0-9_-]{1,160}$/.test(observationId)) return apiFailure(context, 400, 'INVALID_OBSERVATION_QUERY', 'Проверьте выбранную запись.');
  const parsed = correctObservationSchema.safeParse(await boundedObservationPayload(request).catch(() => null));
  if (!parsed.success) return apiFailure(context, 422, 'OBSERVATION_INVALID', 'Проверьте значения, причину исправления и текущую версию.');
  try {
    validateCloudObservationCommand(parsed.data);
    const { database, access } = await cloudObservationAccess(request, parsed.data);
    const result = parseCloudObservationMutation(await database.call('orion_observation_correct', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id, observation_id: observationId, payload: parsed.data,
    }), cloudObservationScope(access, parsed.data.patientId), { observationId, expectedVersion: parsed.data.expectedVersion });
    return apiSuccess(context, { ...result, persistence: 'supabase' });
  } catch (error) { return cloudObservationFailure(context, error); }
}
