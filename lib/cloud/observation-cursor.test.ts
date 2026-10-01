import { describe, expect, it } from 'vitest';
import { cloudObservationCursorSchema, decodeCloudObservationCursor, encodeCloudObservationCursor, requireCloudObservationCursorScope } from './observation-cursor.server';
import { historyCursor, observationCursorBase, observationNow, observationScope } from './observation-test-fixtures';

const list = { ...observationCursorBase(), kind: 'observations', observationId: 'observation-a', observationVersion: 1,
  measuredAt: observationNow, recordedAt: observationNow };
describe('prepared strict cloud observation continuation', () => {
  it.each([list, historyCursor()])('round-trips canonical scoped position without a credential', value => {
    const encoded = encodeCloudObservationCursor(value);
    expect(encoded.length).toBeLessThanOrEqual(2048);
    expect(decodeCloudObservationCursor(encoded)).toEqual(value);
    expect(Buffer.from(encoded, 'base64url').toString()).not.toContain('token');
  });
  it('only null means the initial page', () => {
    expect(decodeCloudObservationCursor(null)).toBeNull();
    expect(() => decodeCloudObservationCursor('')).toThrow();
  });
  it.each(['a'.repeat(2049), 'e30=', 'e30/', '_w', 'Zg', 'e30', `${encodeCloudObservationCursor(list)}=`])
    ('rejects malformed/noncanonical/oversized encoded input', value => expect(() => decodeCloudObservationCursor(value)).toThrow());
  it.each([{ ...list, extra: true }, { ...list, domainVersion: 2 }, { ...list, measuredAt: 0 },
    { ...list, recordedAt: Number.MAX_SAFE_INTEGER + 1 }, { ...list, observationVersion: 2147483648 },
    { ...list, patientId: ' patient-a' }, { ...list, assignmentId: 'assignment\n-a' },
    { ...historyCursor(), beforeVersion: 3 }, { ...historyCursor(), beforeVersion: 0 }])
    ('rejects malformed shape/position %j', value => expect(() => encodeCloudObservationCursor(value)).toThrow());
  it('rejects duplicate JSON keys and alternate JSON key order rather than silently normalizing them', () => {
    const canonical = Buffer.from(encodeCloudObservationCursor(list), 'base64url').toString();
    const duplicate = canonical.replace('"patientId":"patient-a"', '"patientId":"other","patientId":"patient-a"');
    expect(() => decodeCloudObservationCursor(Buffer.from(duplicate).toString('base64url'))).toThrow();
    const reordered = JSON.stringify({ kind: 'observations', ...observationCursorBase(), observationId: 'observation-a',
      observationVersion: 1, measuredAt: observationNow, recordedAt: observationNow });
    expect(() => decodeCloudObservationCursor(Buffer.from(reordered).toString('base64url'))).toThrow();
  });
  it('bounds decoded UTF-8 bytes as well as code-unit metadata and encoded length', () => {
    const huge = { ...list, organizationId: 'Ж'.repeat(160), facilityId: 'Ж'.repeat(160), assignmentId: 'Ж'.repeat(160),
      assignmentVersionId: 'Ж'.repeat(160), patientId: 'Ж'.repeat(160), observationId: 'Ж'.repeat(160) };
    expect(cloudObservationCursorSchema.safeParse(huge).success).toBe(true);
    expect(() => encodeCloudObservationCursor(huge)).toThrow();
  });
  it.each(['organizationId', 'facilityId', 'patientId', 'assignmentId'] as const)('rejects cross-scope %s', field => {
    const cursor = decodeCloudObservationCursor(encodeCloudObservationCursor({ ...list, [field]: 'other' }));
    expect(() => requireCloudObservationCursorScope(cursor, observationScope, 'observations')).toThrow();
  });
  it('never substitutes a kind or selected observation and delegates live grant-version authority to SQL', () => {
    const history = decodeCloudObservationCursor(encodeCloudObservationCursor(historyCursor()));
    expect(() => requireCloudObservationCursorScope(history, observationScope, 'observations')).toThrow();
    expect(() => requireCloudObservationCursorScope(history, observationScope, 'observation_history', 'observation-b')).toThrow();
    expect(() => requireCloudObservationCursorScope({ ...list, kind: 'observations', assignmentVersionId: 'old-version' }, observationScope, 'observations')).not.toThrow();
  });
});
