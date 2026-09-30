import { z } from 'zod';

const identifier = z.string().min(1).max(180).regex(/^[a-zA-Z0-9][a-zA-Z0-9_.:-]*$/);
const contextSchema = z.object({
  facilityId: identifier.max(100),
  accessAssignmentId: identifier,
  patientId: identifier,
  careTaskId: identifier,
});

export type CareObservationContext = z.infer<typeof contextSchema>;
export type CareObservationRequest =
  | { status: 'none' }
  | { status: 'invalid' }
  | { status: 'requested'; context: CareObservationContext };

/** URL selectors are requests, never evidence of permission or task ownership. */
export function readCareObservationContext(params: URLSearchParams): CareObservationRequest {
  if (!params.has('careTaskId')) return { status: 'none' };
  const keys = ['facilityId', 'accessAssignmentId', 'patientId', 'careTaskId'] as const;
  if (keys.some((key) => params.getAll(key).length !== 1)) return { status: 'invalid' };
  const parsed = contextSchema.safeParse(Object.fromEntries(keys.map((key) => [key, params.get(key)])));
  return parsed.success ? { status: 'requested', context: parsed.data } : { status: 'invalid' };
}

/** Only these two local destinations exist; a caller cannot supply a return URL. */
export function careObservationUrl(destination: 'care' | 'observations', context: CareObservationContext) {
  const parsed = contextSchema.parse(context);
  return `/${destination}?${new URLSearchParams(parsed)}`;
}

/** Preserve even malformed/duplicate selectors across sign-in for fail-closed validation. */
export function careObservationPageUrl(
  destination: 'care' | 'observations',
  query: Record<string, string | string[] | undefined>,
) {
  const params = new URLSearchParams();
  for (const key of ['facilityId', 'accessAssignmentId', 'patientId', 'careTaskId']) {
    const value = query[key];
    for (const item of Array.isArray(value) ? value : value === undefined ? [] : [value]) {
      params.append(key, item);
    }
  }
  return `/${destination}${params.size ? `?${params}` : ''}`;
}

export function clearCareObservationContext(params: URLSearchParams) {
  params.delete('careTaskId');
}

export function matchesCareObservationSelection(
  context: CareObservationContext,
  selected: { facilityId?: string; accessAssignmentId: string; patientId: string },
) {
  return context.facilityId === selected.facilityId &&
    context.accessAssignmentId === selected.accessAssignmentId && context.patientId === selected.patientId;
}

const taskSchema = z.object({
  id: identifier,
  enrollmentId: identifier,
  sourcePlanVersionId: identifier,
  title: z.string().min(1),
  patient: z.object({ id: identifier }),
  current: z.object({ status: z.enum(['pending', 'in_progress', 'escalated', 'completed', 'cancelled']) }),
});
const enrollmentSchema = z.object({
  id: identifier,
  patient: z.object({ id: identifier }),
  current: z.object({ status: z.enum(['active', 'paused', 'closed']) }),
  plan: z.object({ current: z.object({ id: identifier }) }).nullable(),
});
const authorizedWorkspaceSchema = z.object({
  facility: z.object({ id: identifier }),
  accessAssignment: z.object({ assignmentId: identifier }),
  tasks: z.array(taskSchema),
  enrollments: z.array(enrollmentSchema),
});

export type CareObservationTask = z.infer<typeof taskSchema>;

export function canOpenCareTaskMeasurements(
  task: CareObservationTask,
  enrollment: z.infer<typeof enrollmentSchema> | undefined,
) {
  return Boolean(enrollment && enrollment.id === task.enrollmentId &&
    enrollment.patient.id === task.patient.id && enrollment.current.status === 'active' &&
    enrollment.plan?.current.id === task.sourcePlanVersionId &&
    ['pending', 'in_progress', 'escalated'].includes(task.current.status));
}

/** Match only records returned by the existing scoped, audited care endpoint. */
export function resolveCareObservationTask(context: CareObservationContext, response: unknown) {
  const parsed = authorizedWorkspaceSchema.safeParse(response);
  if (!parsed.success || parsed.data.facility.id !== context.facilityId ||
    parsed.data.accessAssignment.assignmentId !== context.accessAssignmentId) return null;
  const task = parsed.data.tasks.find((candidate) => candidate.id === context.careTaskId &&
    candidate.patient.id === context.patientId);
  if (!task || !parsed.data.enrollments.some((enrollment) =>
    enrollment.id === task.enrollmentId && enrollment.patient.id === context.patientId)) return null;
  return task;
}

export async function loadCareObservationTask(
  context: CareObservationContext,
  signal: AbortSignal,
  fetchImpl: typeof fetch = fetch,
) {
  const params = new URLSearchParams({
    facilityId: context.facilityId,
    accessAssignmentId: context.accessAssignmentId,
    dueState: 'all',
    limit: '200',
  });
  const response = await fetchImpl(`/api/care?${params}`, {
    cache: 'no-store', credentials: 'same-origin', signal,
  });
  if (!response.ok || signal.aborted) return null;
  const body: unknown = await response.json();
  return signal.aborted ? null : resolveCareObservationTask(context, body);
}
