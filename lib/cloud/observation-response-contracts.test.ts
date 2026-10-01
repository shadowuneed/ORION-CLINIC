import { describe, expect, it } from 'vitest';
import { decodeCloudObservationCursor } from './observation-cursor.server';
import { parseCloudObservationHistoryPage, parseCloudObservationMutation, parseCloudObservationsPage } from './observation-response-contracts.server';
import { historyCursor, observationCursorBase, observationEnvelope, observationList, observationMutation,
  observationNow, observationRecord, observationScope, observationVersion } from './observation-test-fixtures';

describe('prepared cloud observation RPC response contracts', () => {
  it('retains source/time/current record and explicitly partial history without clinical inference', () => {
    const result = parseCloudObservationsPage(observationList(2), observationScope, { limit: 25 });
    expect(result.observations[0].history).toHaveLength(1);
    expect(result.observations[0].historyCount).toBe(2);
    expect(result.observations[0].historyPage.hasMore).toBe(true);
    expect(decodeCloudObservationCursor(result.observations[0].historyPage.nextCursor)).toEqual(historyCursor());
    expect(result.clinicalInterpretation).toBe('not_performed');
    expect(result).not.toHaveProperty('riskScore');
  });
  it('permits a successful empty page, not a fake normal-valued record', () => {
    expect(parseCloudObservationsPage({ ...observationList(), observations: [] }, observationScope).observations).toEqual([]);
  });
  it.each(['organizationId', 'facilityId', 'patientId', 'accessAssignmentId'] as const)('rejects wrong root %s', field => {
    expect(() => parseCloudObservationsPage({ ...observationList(), [field]: 'other' }, observationScope)).toThrow();
  });
  it.each([{ role: 'administrator' }, { timeZone: 'invalid-zone' }, { sourceLabel: 'invented source' },
    { clinicalInterpretation: 'normal' }, { riskScore: 87 }, { observedAt: observationNow + 0.1 }])
    ('rejects invented/malformed envelope %j', patch => expect(() => parseCloudObservationsPage({ ...observationList(), ...patch }, observationScope)).toThrow());
  it.each([{ heightCm: 165.01 }, { weightKg: 64.0001 }, { bmi: 24 }, { bmi: null }, { temperatureC: 36.5001 },
    { systolicMmhg: 118.5 }, { systolicMmhg: 76 }, { diastolicMmhg: null }, { heightCm: null }])
    ('rejects invalid persisted precision/pressure/BMI/groups %j', patch => {
      const value = observationList(); Object.assign(value.observations[0].current.values, patch);
      expect(() => parseCloudObservationsPage(value, observationScope)).toThrow();
    });
  it('rejects impossible source timestamps but permits explicitly entered five-minute measurement clock skew', () => {
    const value = observationList(); const current = value.observations[0].current;
    current.measuredAt = observationNow + 300000; value.observations[0].history[0] = { ...current };
    expect(() => parseCloudObservationsPage(value, observationScope)).not.toThrow();
    current.measuredAt++; value.observations[0].history[0] = { ...current };
    expect(() => parseCloudObservationsPage(value, observationScope)).toThrow();
    current.measuredAt = observationNow; current.recordedAt = observationNow + 1;
    value.observations[0].history[0] = { ...current };
    expect(() => parseCloudObservationsPage(value, observationScope)).toThrow();
  });
  it('requires exact current version/history count/current snapshot and cursor position', () => {
    for (const patch of [{ historyCount: 3 }, { currentVersion: 1 }, { history: [] },
      { history: [observationVersion(1)] }, { historyPage: { hasMore: false, nextCursor: null } },
      { historyPage: { hasMore: true, nextCursor: { ...historyCursor(), beforeVersion: 1 } } },
      { historyPage: { hasMore: true, nextCursor: { ...historyCursor(), observationId: 'other' } } }]) {
      const value = observationList(2); Object.assign(value.observations[0], patch);
      expect(() => parseCloudObservationsPage(value, observationScope)).toThrow();
    }
  });
  it('rejects duplicate list rows, wrong patient, disorder and more flag without a full requested window', () => {
    const value = observationList();
    expect(() => parseCloudObservationsPage({ ...value, observations: [value.observations[0], value.observations[0]] }, observationScope)).toThrow();
    expect(() => parseCloudObservationsPage({ ...value, patient: { ...value.patient, id: 'other' } }, observationScope)).toThrow();
    const second = observationRecord(1, 'observation-b'); second.current.measuredAt++; second.history[0] = { ...second.current };
    expect(() => parseCloudObservationsPage({ ...value, observations: [...value.observations, second] }, observationScope)).toThrow();
    const last = value.observations[0];
    const cursor = { ...observationCursorBase(), kind: 'observations', observationId: last.id, observationVersion: 1,
      measuredAt: last.current.measuredAt, recordedAt: last.current.recordedAt };
    expect(() => parseCloudObservationsPage({ ...value, page: { hasMore: true, nextCursor: cursor } }, observationScope, { limit: 25 })).toThrow();
    const page = parseCloudObservationsPage({ ...value, page: { hasMore: true, nextCursor: cursor } }, observationScope, { limit: 1 });
    expect(decodeCloudObservationCursor(page.page.nextCursor)).toEqual(cursor);
  });
  it('uses the transaction envelope current assignment version, not a stale authorization preflight', () => {
    const value = observationList(2); value.assignmentVersionId = 'fresh-version';
    value.observations[0].historyPage.nextCursor!.assignmentVersionId = 'fresh-version';
    expect(() => parseCloudObservationsPage(value, observationScope)).not.toThrow();
    value.observations[0].historyPage.nextCursor!.assignmentVersionId = 'old-version';
    expect(() => parseCloudObservationsPage(value, observationScope)).toThrow();
  });
  it('requires contiguous ordered selected-history versions and matching current/head/cursor totals', () => {
    const value = { ...observationEnvelope(), observationId: 'observation-a', observationVersion: 2,
      items: [observationVersion(2), observationVersion(1)], page: { hasMore: false, nextCursor: null } };
    const result = parseCloudObservationHistoryPage(value, observationScope, 'observation-a');
    expect(result.historyCount).toBe(2); expect(result.currentVersion).toBe(2);
    for (const patch of [{ observationId: 'other' }, { observationVersion: 3 }, { items: [value.items[1], value.items[0]] },
      { items: [value.items[0], value.items[0]] }, { items: [] }, { items: [value.items[0]] }]) {
      expect(() => parseCloudObservationHistoryPage({ ...value, ...patch }, observationScope, 'observation-a')).toThrow();
    }
    const continuing = { ...value, items: [observationVersion(1)] };
    expect(parseCloudObservationHistoryPage(continuing, observationScope, 'observation-a', { cursor: historyCursor() }).items).toHaveLength(1);
    expect(() => parseCloudObservationHistoryPage({ ...continuing, observationVersion: 3 }, observationScope, 'observation-a', { cursor: historyCursor() })).toThrow();
    expect(() => parseCloudObservationHistoryPage(continuing, observationScope, 'observation-a')).toThrow();
  });
  it('only exposes a correctly anchored bounded history next-page token', () => {
    const value = { ...observationEnvelope(), observationId: 'observation-a', observationVersion: 2,
      items: [observationVersion(2)], page: { hasMore: true, nextCursor: historyCursor() } };
    const result = parseCloudObservationHistoryPage(value, observationScope, 'observation-a', { limit: 1 });
    expect(decodeCloudObservationCursor(result.page.nextCursor)).toEqual(historyCursor());
    expect(() => parseCloudObservationHistoryPage(value, observationScope, 'observation-a', { limit: 25 })).toThrow();
    expect(() => parseCloudObservationHistoryPage({ ...value, page: { ...value.page, nextCursor: { ...historyCursor(), beforeVersion: 1 } } }, observationScope, 'observation-a', { limit: 1 })).toThrow();
  });
  it('permits an immutable command-time cursor under fresh authority only on exact replay', () => {
    const value = observationMutation(2, true); value.assignmentVersionId = 'fresh-version';
    const result = parseCloudObservationMutation(value, observationScope, { observationId: 'observation-a', expectedVersion: 1 });
    expect(result.replayed).toBe(true);
    expect(decodeCloudObservationCursor(result.observation.historyPage.nextCursor)?.assignmentVersionId).toBe('assignment-version-a');
    expect(() => parseCloudObservationMutation({ ...value, replayed: false }, observationScope, { observationId: 'observation-a', expectedVersion: 1 })).toThrow();
    for (const field of ['organizationId', 'facilityId', 'patientId', 'assignmentId', 'observationId'] as const) {
      const invalid = observationMutation(2, true); invalid.observation.historyPage.nextCursor![field] = 'other';
      expect(() => parseCloudObservationMutation(invalid, observationScope, { observationId: 'observation-a', expectedVersion: 1 })).toThrow();
    }
  });
  it('checks create/correction version and selected root before exposing a successful mutation', () => {
    expect(() => parseCloudObservationMutation(observationMutation(2), observationScope, {})).toThrow();
    expect(() => parseCloudObservationMutation(observationMutation(2), observationScope, { observationId: 'other', expectedVersion: 1 })).toThrow();
    expect(() => parseCloudObservationMutation(observationMutation(2), observationScope, { observationId: 'observation-a', expectedVersion: 3 })).toThrow();
    expect(parseCloudObservationMutation(observationMutation(), observationScope, {}).observation.currentVersion).toBe(1);
  });
});
