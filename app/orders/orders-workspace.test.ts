import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import {
  buildOrderAccessQuery,
  buildScopedOperationKey,
  canShowDiagnosticReviewControls,
  matchesRecommendationTransfer,
  orderRequestHref,
  readRecommendationTransfer,
  recommendationTransferConflict,
  OrderLoadError,
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

describe('accepted recommendation to order draft selection', () => {
  const selection = { encounterId: 'enc-a', recommendationId: 'hint-a', recommendationVersion: 2 };
  const source = {
    ...selection,
    reviewDecisionId: 'decision-a',
    derivativeVersionId: null,
    title: 'Accepted service suggestion',
    medicalJustification: 'Reviewed clinical justification',
    state: 'accepted' as const,
    existingOrderId: null,
  };

  it('does not treat normal order navigation or encounter context as a transfer', () => {
    expect(readRecommendationTransfer(new URLSearchParams())).toBeNull();
    expect(readRecommendationTransfer(new URLSearchParams('encounterId=enc-a&requestId=order-a'))).toBeNull();
  });

  it('reads identifiers only, never a title or clinical text from the URL', () => {
    const parsed = readRecommendationTransfer(new URLSearchParams('encounterId=enc-a&recommendationId=hint-a&recommendationVersion=2&title=untrusted&medicalJustification=untrusted'));
    expect(parsed).toEqual(selection);
  });

  it.each([
    'recommendationId=hint-a',
    'recommendationVersion=2',
    'encounterId=enc-a&recommendationId=hint-a',
    'encounterId=&recommendationId=hint-a&recommendationVersion=2',
    'encounterId=enc-a&recommendationId=&recommendationVersion=2',
    ...['0', '-1', '1.5', 'NaN', '1e2', '01', '9007199254740992'].map(version => `encounterId=enc-a&recommendationId=hint-a&recommendationVersion=${version}`),
  ])('blocks malformed transfer rather than creating an unlinked draft: %s', query => {
    expect(readRecommendationTransfer(new URLSearchParams(query))).toBe('invalid');
  });

  it('requires the exact accepted server snapshot and decision identity', () => {
    expect(matchesRecommendationTransfer(selection, source)).toBe(true);
    expect(matchesRecommendationTransfer(selection, { ...source, state: 'edited_and_accepted', derivativeVersionId: 'derivative-a' })).toBe(true);
    expect(matchesRecommendationTransfer(selection, null)).toBe(false);
    expect(matchesRecommendationTransfer(selection, { ...source, reviewDecisionId: '' })).toBe(false);
    expect(matchesRecommendationTransfer(selection, { ...source, recommendationVersion: 3 })).toBe(false);
    expect(matchesRecommendationTransfer(selection, { ...source, encounterId: 'enc-b' })).toBe(false);
    expect(matchesRecommendationTransfer(selection, { ...source, recommendationId: 'hint-b' })).toBe(false);
  });

  it('does not accept pending or rejected payloads even if an API returns them', () => {
    for (const state of ['pending', 'rejected', 'expired']) {
      expect(matchesRecommendationTransfer(selection, { ...source, state } as typeof source)).toBe(false);
    }
  });

  it('builds a durable exact order URL with scope and without source text', () => {
    const href = orderRequestHref('order-a&b', 'fac-a', 'assignment-a');
    const url = new URL(href, 'http://localhost');
    expect(url.pathname).toBe('/orders');
    expect(Object.fromEntries(url.searchParams)).toEqual({ facilityId: 'fac-a', accessAssignmentId: 'assignment-a', requestId: 'order-a&b' });
    expect(url.searchParams.has('recommendationId')).toBe(false);
    expect(url.searchParams.has('medicalJustification')).toBe(false);
  });

  it('explains stale source GET and returns to the exact scoped encounter instead of repeating the stale link', () => {
    const conflict = recommendationTransferConflict(409, 'ORDER_COMMAND_CONFLICT', selection, 'fac-a', 'assignment-a');
    expect(conflict?.message).toContain('версия рекомендации изменилась');
    expect(conflict?.message).toContain('На этом шаге направление не создавалось');
    const url = new URL(conflict!.href, 'http://localhost');
    expect(url.pathname).toBe('/');
    expect(Object.fromEntries(url.searchParams)).toEqual({ facilityId: 'fac-a', accessAssignmentId: 'assignment-a', encounterId: 'enc-a' });
  });

  it('renders a non-mutating return link without a stale retry loop', () => {
    const conflict = recommendationTransferConflict(409, 'ORDER_COMMAND_CONFLICT', selection, 'fac-a', 'assignment-a')!;
    const html = renderToStaticMarkup(createElement(OrderLoadError, { message: conflict.message, sourceConflictHref: conflict.href, onRetry: () => { throw new Error('Must not retry during render'); } }));
    expect(html).toContain('Проверьте актуальную рекомендацию');
    expect(html).toContain('Вернуться в этот приём');
    expect(html).toContain('accessAssignmentId=assignment-a');
    expect(html).toContain('encounterId=enc-a');
    expect(html).not.toContain('Повторить');
  });

  it('keeps ordinary network/server failure and retry visible', () => {
    const html = renderToStaticMarkup(createElement(OrderLoadError, { message: 'Сервер не ответил', sourceConflictHref: '', onRetry: () => undefined }));
    expect(html).toContain('Сервер не ответил');
    expect(html).toContain('Повторить');
    expect(html).not.toContain('Вернуться в этот приём');
  });

  it.each([
    [500, 'ORDER_COMMAND_CONFLICT', selection],
    [403, 'ORDER_COMMAND_CONFLICT', selection],
    [401, 'ORDER_COMMAND_CONFLICT', selection],
    [409, 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED', selection],
    [0, 'NETWORK_ERROR', selection],
    [409, 'ORDER_COMMAND_CONFLICT', null],
    [409, 'ORDER_COMMAND_CONFLICT', 'invalid'],
  ] as const)('does not mislabel unrelated failure or absent transfer (%s, %s)', (status, code, selector) => {
    expect(recommendationTransferConflict(status, code, selector, 'fac-a', 'assignment-a')).toBeNull();
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
