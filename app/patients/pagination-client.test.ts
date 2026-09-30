import { describe, expect, it } from 'vitest';
import { appendPatientRows, createPatientRequestFence, isPatientContinuationPage } from './pagination-client';

describe('patient pagination safety', () => {
  it('appends without losing displayed rows or duplicating overlapping identities', () => {
    const first = [{ id: 'a', value: 1 }, { id: 'b', value: 2 }];
    expect(appendPatientRows(first, [{ id: 'b', value: 3 }, { id: 'c', value: 4 }])).toEqual([
      { id: 'a', value: 1 }, { id: 'b', value: 3 }, { id: 'c', value: 4 },
    ]);
    expect(first).toEqual([{ id: 'a', value: 1 }, { id: 'b', value: 2 }]);
  });

  it('retires pending page, detail and mutation requests together on scope change', () => {
    const fence = createPatientRequestFence();
    const detail = fence.begin('detail');
    const history = fence.begin('profile-history');
    const mutation = fence.begin('mutation');
    fence.retire();
    for (const request of [detail, history, mutation]) {
      expect(request.signal.aborted).toBe(true);
      expect(request.current()).toBe(false);
    }
    expect(fence.begin('detail').current()).toBe(true);
  });

  it('blocks a late JSON publication after the account generation changes', async () => {
    let account = 'first-account';
    const fence = createPatientRequestFence(() => account);
    const request = fence.begin('list');
    const body = Promise.resolve({ id: 'private-row' });
    account = 'next-account';
    await body;
    expect(request.current()).toBe(false);
  });

  it('supersedes only the requested channel and does not retire a newer request when the older one finishes', () => {
    const fence = createPatientRequestFence();
    const older = fence.begin('profile-history');
    const other = fence.begin('encounters-history');
    const newer = fence.begin('profile-history');
    expect(older.signal.aborted).toBe(true);
    older.finish();
    expect(newer.current()).toBe(true);
    expect(other.current()).toBe(true);
    newer.cancel();
    expect(newer.signal.aborted).toBe(true);
    expect(newer.current()).toBe(false);
    expect(other.current()).toBe(true);
  });

  it('requires coherent bounded opaque continuation metadata', () => {
    expect(isPatientContinuationPage({ hasMore: true, nextCursor: 'opaque' })).toBe(true);
    expect(isPatientContinuationPage({ hasMore: false, nextCursor: null })).toBe(true);
    for (const value of [undefined, {}, { hasMore: true, nextCursor: null },
      { hasMore: true, nextCursor: '' }, { hasMore: false, nextCursor: 'hidden' },
      { hasMore: true, nextCursor: 'a'.repeat(2049) }]) {
      expect(isPatientContinuationPage(value)).toBe(false);
    }
  });
});
