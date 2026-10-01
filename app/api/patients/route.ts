import { createPatientSchema, patientListQuerySchema } from '@/lib/domain/patient';
import { z } from 'zod';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { boundedPatientPayload, cloudPatientAccess, cloudPatientCursorScope, cloudPatientFailure, cloudPatientMutationAllowed } from '@/lib/cloud/patient-api.server';
import { parseCloudPatientMutation, parseCloudPatientListPage } from '@/lib/cloud/response-contracts';
import { decodeCloudPatientCursor } from '@/lib/cloud/patient-cursor.server';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/patients');
  const url = new URL(request.url);
  if (['query', 'status', 'facilityId', 'accessAssignmentId', 'limit', 'cursor']
    .some(key => url.searchParams.getAll(key).length > 1)) {
    return apiFailure(context, 400, 'INVALID_QUERY', 'Параметры поиска должны быть однозначными.');
  }
  const parsed = patientListQuerySchema.extend({ limit: z.coerce.number().int().min(1).max(50).default(25) }).safeParse({
    facilityId: url.searchParams.get('facilityId') ?? undefined,
    accessAssignmentId: url.searchParams.get('accessAssignmentId') ?? undefined,
    query: url.searchParams.get('query') ?? undefined, status: url.searchParams.get('status') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) return apiFailure(context, 400, 'INVALID_QUERY', 'Проверьте параметры поиска.');
  let cursor;
  try {
    if (url.searchParams.getAll('cursor').length > 1) throw new Error('Ambiguous cursor.');
    cursor = decodeCloudPatientCursor(url.searchParams.get('cursor'));
    if (cursor && cursor.kind !== 'directory') throw new Error('Wrong cursor kind.');
  } catch { return apiFailure(context, 400, 'INVALID_CONTINUATION', 'Проверьте параметры страницы.'); }
  try {
    const { database, access } = await cloudPatientAccess(request, 'patient.directory.read', parsed.data.accessAssignmentId, parsed.data.facilityId);
    const { patients, page, observedAt } = parseCloudPatientListPage(await database.call('orion_patients_list', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id,
      query: parsed.data.query ?? null, status: parsed.data.status, max_results: parsed.data.limit, cursor,
    }), access.assignment.assignmentId, cloudPatientCursorScope(access));
    // Read result and audit commit are one PostgreSQL RPC transaction.
    return apiSuccess(context, { viewer: { ...access.user, role: access.assignment.roles.join(', ') },
      organization: access.organization, facility: access.facility, accessAssignment: access.assignment,
      assignments: access.assignments, patients, page, observedAt, persistence: 'supabase' });
  } catch (error) { return cloudPatientFailure(context, error); }
}

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/patients');
  if (!cloudPatientMutationAllowed(request)) return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  const parsed = createPatientSchema.safeParse(await boundedPatientPayload(request).catch(() => null));
  if (!parsed.success) return apiFailure(context, 400, 'INVALID_PATIENT', 'Проверьте данные пациента.');
  try {
    const { database, access } = await cloudPatientAccess(request, 'patient.profile.write', parsed.data.accessAssignmentId, parsed.data.facilityId);
    const { facilityId: _facility, accessAssignmentId: _assignment, ...payload } = parsed.data;
    void _facility; void _assignment;
    const result = await database.call('orion_patient_create', { assignment_id: access.assignment.assignmentId,
      facility_id: access.facility.id, payload });
    const patient = parseCloudPatientMutation(result, access.assignment.assignmentId, undefined, cloudPatientCursorScope(access));
    return apiSuccess(context, { patient, persistence: 'supabase' }, 201);
  } catch (error) { return cloudPatientFailure(context, error); }
}
