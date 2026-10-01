import { describe, expect, it } from 'vitest';
import { parseCloudPatientListPage } from './response-contracts';

const value = { patients: [], page: { hasMore: false, nextCursor: null }, accessAssignmentId: 'assignment-a', observedAt: 123456 };
describe('cloud registry response provenance', () => {
  it('retains the checked RPC observedAt, not a client clock or invented update timestamp', () => {
    expect(parseCloudPatientListPage(value, 'assignment-a')).toEqual({ patients: [], page: value.page, observedAt: value.observedAt });
  });
  it.each([undefined, null, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1, '123456'])
    ('rejects an invalid RPC provenance timestamp %j', observedAt => {
      expect(() => parseCloudPatientListPage({ ...value, observedAt }, 'assignment-a')).toThrow();
    });
  it('rejects a wrong assignment even with valid provenance', () => {
    expect(() => parseCloudPatientListPage(value, 'assignment-b')).toThrow();
  });
});
