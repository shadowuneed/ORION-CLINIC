import { describe, expect, it } from 'vitest';
import {
  buildSchedulingAccessQuery,
  buildSchedulingOperationKey,
  isExpiredSchedulingHold,
  nextQueueAction,
  unknownSchedulingOutcomeMessage,
} from './scheduling-workspace';

describe('scheduling workspace queue flow', () => {
  it('keeps the exact access assignment in reads and idempotency scope', () => {
    const query = new URLSearchParams(
      buildSchedulingAccessQuery({
        accessAssignmentId: 'assignment-a',
        facilityId: 'facility-a',
      }),
    );
    expect(query.get('accessAssignmentId')).toBe('assignment-a');
    expect(query.get('facilityId')).toBe('facility-a');
    expect(buildSchedulingOperationKey('assignment-a', 'queue:call')).toBe(
      'assignment-a:queue:call',
    );
  });

  it('keeps the deterministic queue transition sequence', () => {
    expect(nextQueueAction('issued')).toBe('arrive');
    expect(nextQueueAction('arrived')).toBe('call');
    expect(nextQueueAction('called')).toBe('start_service');
    expect(nextQueueAction('in_service')).toBe('complete');
    expect(nextQueueAction('completed')).toBeNull();
    expect(nextQueueAction('cancelled')).toBeNull();
    expect(nextQueueAction('exception')).toBeNull();
  });

  it('does not claim failure when a network outcome is unknown', () => {
    const message = unknownSchedulingOutcomeMessage();
    expect(message).toContain('Сервер мог сохранить действие');
    expect(message).toContain('тот же ключ защиты от дублей');
  });

  it('shows an expired hold as requiring manual release', () => {
    expect(
      isExpiredSchedulingHold(
        { status: 'held', holdExpiresAt: 10_000 },
        10_000,
      ),
    ).toBe(true);
    expect(
      isExpiredSchedulingHold(
        { status: 'held', holdExpiresAt: 10_001 },
        10_000,
      ),
    ).toBe(false);
    expect(
      isExpiredSchedulingHold(
        { status: 'confirmed', holdExpiresAt: null },
        10_000,
      ),
    ).toBe(false);
  });
});
