import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { chronicCareCapabilities } from '@/lib/auth/chronic-care-access';
import type {
  ChronicCareWorkspace,
  ChronicTaskRecord,
} from '@/lib/repositories/chronic-care-workflow';
import {
  allowedCareTaskActions,
  CareTaskMeasurementsLink,
  buildChronicCareAccessQuery,
  buildChronicCareOperationKey,
  unknownChronicCareOutcomeMessage,
} from './care-workspace';

describe('task measurement navigation', () => {
  it('links the exact task and patient without completing the task', () => {
    const html = renderToStaticMarkup(createElement(CareTaskMeasurementsLink, {
      task: { id: 'task-a', title: 'Контроль давления', patient: { id: 'patient-a', displayName: 'Тест', medicalRecordNumber: 'SYN-A' } },
      facilityId: 'fac-a', accessAssignmentId: 'assignment-a', disabled: false,
    }));
    expect(html).toContain('/observations?facilityId=fac-a&amp;accessAssignmentId=assignment-a&amp;patientId=patient-a&amp;careTaskId=task-a');
    expect(html).toContain('Запись показателей не завершает задачу.');
  });

  it('does not navigate away while a command or unsaved dialog is open', () => {
    const html = renderToStaticMarkup(createElement(CareTaskMeasurementsLink, {
      task: { id: 'task-a', title: 'Контроль давления', patient: { id: 'patient-a', displayName: 'Тест', medicalRecordNumber: 'SYN-A' } },
      facilityId: 'fac-a', accessAssignmentId: 'assignment-a', disabled: true,
    }));
    expect(html).toContain('aria-disabled="true"');
    expect(html).not.toContain('href=');
  });
});

const capabilities = {
  'workspace.read': true,
  'enrollment.confirm': false,
  'plan.sign': false,
  'task.start': true,
  'task.response': true,
  'task.escalate': true,
  'task.complete': true,
  'task.resolve': false,
  'task.cancel': false,
} satisfies ChronicCareWorkspace['capabilities'];

function task(status: ChronicTaskRecord['current']['status']) {
  return {
    ownerRole: 'nurse',
    current: { status },
  } as Pick<ChronicTaskRecord, 'current' | 'ownerRole'>;
}

describe('chronic-care workspace actions', () => {
  it.each(['pending', 'in_progress', 'escalated', 'completed', 'cancelled'] as const)(
    'uses actual server nurse capabilities without exposing doctor decisions for %s', (status) => {
      const actions = allowedCareTaskActions(task(status), chronicCareCapabilities('nurse'), 'nurse');
      expect(actions).not.toContain('resolve');
      expect(actions).not.toContain('cancel');
      if (['escalated', 'completed', 'cancelled'].includes(status)) expect(actions).toEqual([]);
    },
  );
  it('does not expose a colleague role task as actionable just because permission exists', () => {
    const doctorTask = { ...task('pending'), ownerRole: 'clinician' as const };
    expect(allowedCareTaskActions(doctorTask, chronicCareCapabilities('nurse'), 'nurse')).toEqual([]);
    expect(allowedCareTaskActions(task('pending'), chronicCareCapabilities('clinician'), 'clinician')).toEqual(['cancel']);
  });
  it('shows nurse actions only before escalation', () => {
    expect(allowedCareTaskActions(task('pending'), capabilities, 'nurse')).toEqual([
      'start',
      'record_response',
      'escalate',
      'complete',
    ]);
    expect(allowedCareTaskActions(task('escalated'), capabilities, 'nurse')).toEqual([]);
  });

  it('shows doctor resolution for an escalated task', () => {
    expect(
      allowedCareTaskActions(task('escalated'), {
        ...capabilities,
        'task.resolve': true,
        'task.cancel': true,
      }, 'clinician'),
    ).toEqual(['resolve', 'cancel']);
  });

  it('does not expose nurse workflow actions in the doctor workspace', () => {
    expect(
      allowedCareTaskActions(task('pending'), {
        ...capabilities,
        'task.response': false,
        'task.escalate': false,
        'task.cancel': true,
      }, 'clinician'),
    ).toEqual(['cancel']);
  });

  it('warns that a timed-out command may already be persisted', () => {
    expect(unknownChronicCareOutcomeMessage().toLowerCase()).toContain(
      'сервер мог сохранить',
    );
    expect(unknownChronicCareOutcomeMessage()).toContain('ключ защиты от дублей');
  });
});

describe('chronic-care workspace access scope', () => {
  it('keeps the facility and exact assignment in every list request', () => {
    expect(
      buildChronicCareAccessQuery('fac-a', 'assignment-a').toString(),
    ).toBe(
      'dueState=all&limit=200&facilityId=fac-a&accessAssignmentId=assignment-a',
    );
    expect(buildChronicCareAccessQuery().toString()).toBe(
      'dueState=all&limit=200',
    );
  });

  it('isolates command retry identities by the selected assignment', () => {
    expect(
      buildChronicCareOperationKey('assignment-a', 'task-a-complete'),
    ).not.toBe(
      buildChronicCareOperationKey('assignment-b', 'task-a-complete'),
    );
  });
});
