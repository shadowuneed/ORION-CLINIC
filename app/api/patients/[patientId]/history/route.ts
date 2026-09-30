import { z } from 'zod';
import { apiFailure, apiSuccess, createApiRequestContext } from '@/lib/http/api-response';
import { cloudPatientAccess, cloudPatientCursorScope, cloudPatientFailure } from '@/lib/cloud/patient-api.server';
import { decodeCloudPatientCursor } from '@/lib/cloud/patient-cursor.server';
import { parseCloudPatientHistoryPage } from '@/lib/cloud/response-contracts';

export const dynamic = 'force-dynamic';
const querySchema = z.object({ kind: z.enum(['profile', 'encounters']),
  facilityId: z.string().min(1).max(100).optional(), accessAssignmentId: z.string().min(1).max(160).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(25) });

export async function GET(request: Request, { params }: { params: Promise<{ patientId: string }> }) {
  const context = createApiRequestContext(request, '/api/patients/:patientId/history');
  const { patientId } = await params;
  const query = new URL(request.url).searchParams;
  const parsed = querySchema.safeParse({ kind: query.get('kind'), facilityId: query.get('facilityId') ?? undefined,
    accessAssignmentId: query.get('accessAssignmentId') ?? undefined, limit: query.get('limit') ?? undefined });
  if (!parsed.success) return apiFailure(context, 400, 'INVALID_QUERY', 'Проверьте параметры истории.');
  let cursor;
  try {
    if (query.getAll('cursor').length !== 1) throw new Error('Missing or ambiguous cursor.');
    cursor = decodeCloudPatientCursor(query.get('cursor'));
    if (!cursor || cursor.kind !== parsed.data.kind || cursor.patientId !== patientId) throw new Error('Wrong cursor scope.');
  } catch { return apiFailure(context, 400, 'INVALID_CONTINUATION', 'Проверьте параметры страницы.'); }
  try {
    const { database, access } = await cloudPatientAccess(request, 'patient.directory.read',
      parsed.data.accessAssignmentId, parsed.data.facilityId);
    const result = parseCloudPatientHistoryPage(await database.call('orion_patient_history_page', {
      assignment_id: access.assignment.assignmentId, facility_id: access.facility.id, patient_id: patientId,
      history_kind: parsed.data.kind, max_results: parsed.data.limit, cursor,
    }), access.assignment.assignmentId, patientId, parsed.data.kind, cloudPatientCursorScope(access), cursor.profileVersion);
    return apiSuccess(context, result);
  } catch (error) { return cloudPatientFailure(context, error); }
}
