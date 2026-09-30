import { describe, expect, it, vi } from 'vitest';
import {
  canOpenCareTaskMeasurements,
  careObservationPageUrl,
  careObservationUrl,
  clearCareObservationContext,
  loadCareObservationTask,
  matchesCareObservationSelection,
  readCareObservationContext,
  resolveCareObservationTask,
} from './care-observation-navigation';

const context = { facilityId: 'fac-a', accessAssignmentId: 'assignment-nurse-a', patientId: 'patient-a', careTaskId: 'task-a' };
const task = {
  id: 'task-a', enrollmentId: 'enrollment-a', sourcePlanVersionId: 'plan-version-a',
  title: 'Записать давление', patient: { id: 'patient-a' }, current: { status: 'in_progress' as const },
};
const enrollment = {
  id: 'enrollment-a', patient: { id: 'patient-a' }, current: { status: 'active' as const },
  plan: { current: { id: 'plan-version-a' } },
};
const workspace = {
  facility: { id: 'fac-a' }, accessAssignment: { assignmentId: 'assignment-nurse-a' },
  tasks: [task], enrollments: [enrollment],
};

describe('care task and observation navigation', () => {
  it('round trips exact selectors using only fixed local paths', () => {
    const params = new URL(careObservationUrl('observations', context), 'https://clinic.invalid').searchParams;
    params.set('returnTo', 'https://other.invalid');
    const result = readCareObservationContext(params);
    expect(result).toEqual({ status: 'requested', context });
    expect(careObservationUrl('care', context)).toBe('/care?facilityId=fac-a&accessAssignmentId=assignment-nurse-a&patientId=patient-a&careTaskId=task-a');
    expect(careObservationUrl('care', context)).not.toContain('returnTo');
  });

  it.each(['facilityId', 'accessAssignmentId', 'patientId', 'careTaskId'] as const)(
    'rejects missing, blank, duplicate and malformed %s selectors', (key) => {
      for (const replacement of [undefined, '', ' task-a ', 'task/other', 'task\nother']) {
        const params = new URLSearchParams(context);
        if (replacement === undefined) params.delete(key); else params.set(key, replacement);
        expect(readCareObservationContext(params).status).toBe(key === 'careTaskId' && replacement === undefined ? 'none' : 'invalid');
      }
      const params = new URLSearchParams(context);
      params.append(key, context[key]);
      expect(readCareObservationContext(params)).toEqual({ status: 'invalid' });
    },
  );

  it('keeps invalid selectors invalid across sign-in and excludes arbitrary destinations', () => {
    const path = careObservationPageUrl('observations', { ...context, careTaskId: ['task-a', 'task-b'], returnTo: 'https://other.invalid' });
    expect(path.startsWith('/observations?')).toBe(true);
    expect(readCareObservationContext(new URL(path, 'https://clinic.invalid').searchParams)).toEqual({ status: 'invalid' });
    expect(path).not.toContain('other.invalid');
  });

  it('requires returned exact scope, patient, task and enrollment', () => {
    expect(resolveCareObservationTask(context, workspace)).toEqual(task);
    for (const mismatch of [
      { ...workspace, facility: { id: 'fac-b' } },
      { ...workspace, accessAssignment: { assignmentId: 'assignment-other' } },
      { ...workspace, tasks: [] },
      { ...workspace, tasks: [{ ...task, patient: { id: 'patient-b' } }] },
      { ...workspace, enrollments: [] },
      { ...workspace, enrollments: [{ ...enrollment, patient: { id: 'patient-b' } }] },
      { error: { code: 'FORBIDDEN' } },
    ]) expect(resolveCareObservationTask(context, mismatch)).toBeNull();
  });

  it('offers measurement entry only for open tasks from the current active signed plan', () => {
    expect(canOpenCareTaskMeasurements(task, enrollment)).toBe(true);
    expect(canOpenCareTaskMeasurements(task, undefined)).toBe(false);
    expect(canOpenCareTaskMeasurements(task, { ...enrollment, current: { status: 'paused' } })).toBe(false);
    expect(canOpenCareTaskMeasurements(task, { ...enrollment, plan: null })).toBe(false);
    expect(canOpenCareTaskMeasurements(task, { ...enrollment, plan: { current: { id: 'new-plan' } } })).toBe(false);
    expect(canOpenCareTaskMeasurements({ ...task, current: { status: 'completed' } }, enrollment)).toBe(false);
    expect(canOpenCareTaskMeasurements({ ...task, current: { status: 'cancelled' } }, enrollment)).toBe(false);
    // Returning to an accessible completed task still shows its actual status.
    expect(resolveCareObservationTask(context, { ...workspace, tasks: [{ ...task, current: { status: 'completed' } }] })?.current.status).toBe('completed');
  });

  it('does not retain task context after changing patient, facility or assignment', () => {
    expect(matchesCareObservationSelection(context, context)).toBe(true);
    for (const key of ['patientId', 'facilityId', 'accessAssignmentId'] as const) {
      expect(matchesCareObservationSelection(context, { ...context, [key]: 'other' })).toBe(false);
    }
    const params = new URLSearchParams(context);
    clearCareObservationContext(params);
    params.set('patientId', 'patient-b');
    expect(readCareObservationContext(params)).toEqual({ status: 'none' });
    expect(params.get('accessAssignmentId')).toBe(context.accessAssignmentId);
  });

  it('revalidates through the scoped care GET and performs no task command', async () => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(workspace));
    const controller = new AbortController();
    expect(await loadCareObservationTask(context, controller.signal, request)).toEqual(task);
    expect(request).toHaveBeenCalledExactlyOnceWith('/api/care?facilityId=fac-a&accessAssignmentId=assignment-nurse-a&dueState=all&limit=200', {
      cache: 'no-store', credentials: 'same-origin', signal: controller.signal,
    });
  });

  it.each([401, 403, 404, 503])('returns no task data after server denial %s', async (status) => {
    const request = vi.fn<typeof fetch>().mockResolvedValue(Response.json(workspace, { status }));
    expect(await loadCareObservationTask(context, new AbortController().signal, request)).toBeNull();
  });

  it('discards a task response after its navigation request was aborted', async () => {
    const controller = new AbortController();
    const request = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      return Response.json(workspace);
    });
    expect(await loadCareObservationTask(context, controller.signal, request)).toBeNull();
  });
});
