import { updatePatientProfileSchema } from '@/lib/domain/patient';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { boundedPatientPayload, cloudPatientAccess, cloudPatientCursorScope, cloudPatientFailure, cloudPatientMutationAllowed } from '@/lib/cloud/patient-api.server';
import { parseCloudPatientDetail, parseCloudPatientMutation } from '@/lib/cloud/response-contracts';

export const dynamic = 'force-dynamic';

export async function GET(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const context = createApiRequestContext(request, '/api/patients/:patientId');
  const { patientId } = await params;
  const query = new URL(request.url).searchParams;
  try {
    const { database, access } = await cloudPatientAccess(request, 'patient.directory.read', query.get('accessAssignmentId') ?? undefined,
      query.get('facilityId') ?? undefined);
    const patient = parseCloudPatientDetail(await database.call('orion_patient_detail', {
      assignment_id: access.assignment.assignmentId, patient_id: patientId, facility_id: access.facility.id,
    }), access.assignment.assignmentId, patientId, cloudPatientCursorScope(access));
    if (!patient) return apiFailure(context, 404, 'PATIENT_NOT_FOUND', 'Карточка недоступна.');
    return apiSuccess(context, { viewer: { ...access.user, role: access.assignment.roles.join(', ') },
      organization: access.organization, facility: access.facility, accessAssignment: access.assignment,
      assignments: access.assignments, permissions: {
        canUpdate: access.assignment.effectivePermissions.includes('patient.profile.write') && patient.status === 'active',
        canArchive: access.assignment.effectivePermissions.includes('patient.profile.write') && patient.status === 'active',
        canCreateEncounter: false,
      }, patient, persistence: 'supabase' });
  } catch (error) { return cloudPatientFailure(context, error); }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const context = createApiRequestContext(request, '/api/patients/:patientId');
  if (!cloudPatientMutationAllowed(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  const parsed = updatePatientProfileSchema.safeParse(await boundedPatientPayload(request).catch(() => null));
  if (!parsed.success) return apiFailure(context, 400, 'INVALID_PATIENT', 'Проверьте данные пациента.');
  const { patientId } = await params;
  try {
    const { database, access } = await cloudPatientAccess(request, 'patient.profile.write', parsed.data.accessAssignmentId, parsed.data.facilityId);
    const { facilityId: _facility, accessAssignmentId: _assignment, ...payload } = parsed.data;
    void _facility; void _assignment;
    const patient = parseCloudPatientMutation(await database.call('orion_patient_update', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id, payload: { ...payload, patientId },
    }), access.assignment.assignmentId, patientId, cloudPatientCursorScope(access));
    if (!patient) return apiFailure(context, 404, 'PATIENT_NOT_FOUND', 'Карточка недоступна.');
    return apiSuccess(context, { patient, persistence: 'supabase' });
  } catch (error) { return cloudPatientFailure(context, error); }
}
