import { describe, expect, it } from 'vitest';
import type {
  ChronicCareWorkspace,
  ChronicTaskRecord,
} from '@/lib/repositories/chronic-care-workflow';
import {
  allowedCareTaskActions,
  unknownChronicCareOutcomeMessage,
} from './care-workspace';

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
