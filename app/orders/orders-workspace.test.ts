import { describe, expect, it } from 'vitest';
import {
  buildOrderAccessQuery,
  buildScopedOperationKey,
  canShowDiagnosticReviewControls,
  unknownOutcomeMessage,
} from './orders-workspace';

describe('orders workspace unknown outcomes', () => {
  it.each([
    ['action', 'действия'],
    ['upload', 'загрузки файла'],
    ['review', 'решения врача'],
  ] as const)('does not claim a failed %s when delivery is uncertain', (operation, subject) => {
    const message = unknownOutcomeMessage(operation);

    expect(message).toContain(`Исход ${subject} неизвестен`);
    expect(message).toContain('сервер мог сохранить изменение');
    expect(message).toContain('Обновите направление');
    expect(message).toContain('тот же ключ защиты от дублей');
  });
});

describe('orders workspace diagnostic review controls', () => {
  it.each(['revoked', 'entered_in_error'] as const)(
    'hides review actions for terminal request status %s',
    (status) => {
      expect(canShowDiagnosticReviewControls(status, 'pending')).toBe(false);
    },
  );

  it('shows review actions only while a mutable request has a pending review', () => {
    expect(canShowDiagnosticReviewControls('active', 'pending')).toBe(true);
    expect(canShowDiagnosticReviewControls('on_hold', 'pending')).toBe(true);
    expect(canShowDiagnosticReviewControls('completed', 'pending')).toBe(true);
    expect(canShowDiagnosticReviewControls('active', 'reviewed')).toBe(false);
    expect(
      canShowDiagnosticReviewControls('active', 'needs_reconciliation'),
    ).toBe(false);
  });
});

describe('orders workspace assignment propagation', () => {
  it('keeps the exact facility and assignment on artifact requests', () => {
    expect(buildOrderAccessQuery('fac-a', 'assignment-a')).toBe(
      '?facilityId=fac-a&accessAssignmentId=assignment-a',
    );
  });

  it('does not invent an access context when none was selected', () => {
    expect(buildOrderAccessQuery('', '')).toBe('');
  });

  it('isolates retry keys by the exact selected assignment', () => {
    expect(buildScopedOperationKey('assignment-a', 'review', 'order-a', 2))
      .not.toBe(
        buildScopedOperationKey('assignment-b', 'review', 'order-a', 2),
      );
  });
});
