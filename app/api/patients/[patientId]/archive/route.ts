import { archivePatientProfileSchema } from '@/lib/domain/patient';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { boundedPatientPayload, cloudPatientAccess, cloudPatientFailure, cloudPatientMutationAllowed } from '@/lib/cloud/patient-api.server';
import { parseCloudPatientMutation } from '@/lib/cloud/response-contracts';

export const dynamic = 'force-dynamic';

export async function POST(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const context = createApiRequestContext(request, '/api/patients/:patientId/archive');
  if (!cloudPatientMutationAllowed(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  const parsed = archivePatientProfileSchema.safeParse(await boundedPatientPayload(request).catch(() => null));
  if (!parsed.success) return apiFailure(context, 400, 'INVALID_PATIENT', 'Проверьте причину архивирования.');
  const { patientId } = await params;
  try {
    const { database, access } = await cloudPatientAccess(request, 'patient.profile.write', parsed.data.accessAssignmentId, parsed.data.facilityId);
    const { facilityId: _facility, accessAssignmentId: _assignment, ...payload } = parsed.data;
    void _facility; void _assignment;
    const patient = parseCloudPatientMutation(await database.call('orion_patient_archive', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id, payload: { ...payload, patientId },
    }), access.assignment.assignmentId, patientId);
    if (!patient) return apiFailure(context, 404, 'PATIENT_NOT_FOUND', 'Карточка недоступна.');
    return apiSuccess(context, { patient, persistence: 'supabase' });
  } catch (error) { return cloudPatientFailure(context, error); }
}
