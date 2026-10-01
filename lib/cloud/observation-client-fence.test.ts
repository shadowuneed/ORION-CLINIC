import { describe, expect, it } from 'vitest';
import { observationEnvelope, observationList, observationMutation, observationNow, observationRecord,
  observationScope, observationVersion } from './observation-test-fixtures';
import { encodeCloudObservationCursor } from './observation-cursor.server';
import { appendCloudObservationHistory, appendCloudObservationRows, buildCloudObservationCommand,
  CloudObservationClientError, cloudObservationCanCorrect, cloudObservationDraft, cloudObservationQuery,
  cloudObservationSelectionKey, createCloudObservationFence, freezeCloudObservationCommand,
  parseCloudObservationHistoryClient, parseCloudObservationLatestClient, parseCloudObservationListClient,
  parseCloudObservationMutationClient, readBoundedCloudObservationResponse, type CloudObservationRecord } from './observation-client-fence';

const generation = 'a'.repeat(32);
function record(version = 1, identity = 'observation-a'): CloudObservationRecord {
  const source = observationRecord(version, identity);
  const current = { ...source.current, sourceLabel: 'Облачный ручной ввод · тестовые данные' as const };
  return { ...source, current, history: [current], historyPage: { ...source.historyPage, nextCursor: source.historyPage.nextCursor
    ? encodeCloudObservationCursor(source.historyPage.nextCursor) : null } };
}
function page(version = 1) {
  return { ...observationList(version), persistence: 'supabase', observations: [record(version)],
    viewer: { id: 'staff-a', displayName: 'Синтетический сотрудник', membershipId: 'membership-a', role: 'clinician', accessAssignmentId: 'assignment-a' },
    organization: { id: 'org-a', name: 'Клиника тестовая' }, facility: { id: 'facility-a', name: 'Корпус тестовый' },
    accessAssignment: { assignmentId: 'assignment-a', assignmentVersionId: 'assignment-version-a' },
    patientSelection: 'explicit', dataMode: 'synthetic-only', capabilities: { 'workspace.read': true, 'observation.record': true, 'observation.correct': true },
    thresholdPolicy: { status: 'not_configured', decision: 'DEC-006', message: 'Оценку выполняет сотрудник.' } };
}
const latest = () => ({ ...observationEnvelope(), persistence: 'supabase', vitals: {
  anthropometry: { observationId: 'anthro-a', version: 2, measuredAt: observationNow - 30000, recordedBy: 'Сотрудник Тестовый',
    sourceLabel: observationEnvelope().sourceLabel, heightCm: 165, weightKg: 64, bmi: 23.51 },
  bloodPressure: { observationId: 'pressure-a', version: 1, measuredAt: observationNow - 10000, recordedBy: 'Сотрудник Тестовый',
    sourceLabel: observationEnvelope().sourceLabel, systolicMmhg: 118, diastolicMmhg: 76 },
  temperature: null } });

describe('cloud observation request publication fences', () => {
  it('pins every request to the exact four-part scope and session generation', () => {
    const fence = createCloudObservationFence(() => generation); fence.select(observationScope);
    const request = fence.begin('list', observationScope);
    expect(request.current()).toBe(true); expect(request.headers['orion-session-generation']).toBe(generation);
    expect(fence.begin('latest', { ...observationScope, patientId: 'other' }).current()).toBe(false);
    expect(cloudObservationSelectionKey(observationScope)).not.toBe(cloudObservationSelectionKey({ ...observationScope, organizationId: 'other' }));
  });
  it.each([null, '', 'bad'])('fails closed for missing or malformed generation %s', account => {
    const fence = createCloudObservationFence(() => account); fence.select(observationScope);
    expect(fence.accountCurrent()).toBe(false); expect(fence.begin('list', observationScope).current()).toBe(false);
  });
  it('aborts every lane after selected patient changes, including mutation and history', () => {
    const fence = createCloudObservationFence(() => generation); fence.select(observationScope);
    const requests = ['list', 'latest', 'history', 'mutation'].map(lane => fence.begin(lane, observationScope));
    fence.select({ ...observationScope, patientId: 'next-patient' });
    for (const request of requests) { expect(request.signal.aborted).toBe(true); expect(request.current()).toBe(false); }
  });
  it('prevents late publication when generation changes while JSON is resolving', async () => {
    let account = generation;
    const fence = createCloudObservationFence(() => account); fence.select(observationScope);
    const request = fence.begin('list', observationScope);
    const reading = readBoundedCloudObservationResponse(Response.json(page()));
    account = 'b'.repeat(32); await reading;
    expect(request.current()).toBe(false); expect(fence.accountCurrent()).toBe(false);
  });
  it('replaces a lane without cancelling independently loading latest groups', () => {
    const fence = createCloudObservationFence(() => generation); fence.select(observationScope);
    const older = fence.begin('history', observationScope); const latestRequest = fence.begin('latest', observationScope);
    const newer = fence.begin('history', observationScope); older.finish();
    expect(older.current()).toBe(false); expect(newer.current()).toBe(true); expect(latestRequest.current()).toBe(true);
    fence.retire(); expect(newer.signal.aborted).toBe(true); expect(latestRequest.current()).toBe(false);
  });
  it('cannot recapture a changed cookie by clicking refresh before the account watcher runs', () => {
    let account = generation;
    const fence = createCloudObservationFence(() => account); expect(fence.select(observationScope)).toBe(true);
    account = 'b'.repeat(32);
    expect(fence.select(observationScope)).toBe(false); expect(fence.generation()).toBeNull();
    expect(fence.begin('mutation', observationScope).current()).toBe(false);
    fence.retire(); expect(fence.select(observationScope)).toBe(false);
  });
  it('uses a selected patient and page25, never the broad local limit100 query', () => {
    const query = new URLSearchParams(cloudObservationQuery(observationScope));
    expect(query.get('patientId')).toBe('patient-a'); expect(query.get('accessAssignmentId')).toBe('assignment-a');
    expect(query.get('facilityId')).toBe('facility-a'); expect(query.get('limit')).toBe('25');
    expect(new URLSearchParams(cloudObservationQuery(observationScope, { paged: false })).has('limit')).toBe(false);
    expect(new URLSearchParams(cloudObservationQuery(observationScope, { cursor: 'opaque-next' })).get('cursor')).toBe('opaque-next');
  });
});

describe('cloud observation bounded response contracts', () => {
  it('accepts the API current window without inventing history or interpretation', () => {
    const result = parseCloudObservationListClient(page(3), observationScope);
    expect(result.observations[0].history).toHaveLength(1); expect(result.observations[0].historyCount).toBe(3);
    expect(result.observations[0].historyPage.hasMore).toBe(true); expect(result.clinicalInterpretation).toBe('not_performed');
  });
  it.each(['organizationId', 'facilityId', 'patientId', 'accessAssignmentId'] as const)('rejects mismatched %s', key => {
    expect(() => parseCloudObservationListClient({ ...page(), [key]: 'other' }, observationScope)).toThrow();
  });
  it('rejects wrong viewer scope, role, profile metadata and duplicated records', () => {
    const value = page();
    for (const malformed of [
      { ...value, viewer: { ...value.viewer, accessAssignmentId: 'other' } },
      { ...value, viewer: { ...value.viewer, role: 'nurse' } },
      { ...value, facility: { ...value.facility, id: 'other' } },
      { ...value, observations: [record(), record()] },
      { ...value, observations: [{ ...record(), historyCount: 2 }] },
      { ...value, observations: [{ ...record(), current: { ...record().current, values: { ...record().current.values, bmi: 99 } } }] },
    ]) expect(() => parseCloudObservationListClient(malformed, observationScope)).toThrow();
  });
  it('does not present an undersized hasMore page as complete or allow a26th row', () => {
    expect(() => parseCloudObservationListClient({ ...page(), page: { hasMore: true, nextCursor: 'opaque' } }, observationScope)).toThrow();
    expect(() => parseCloudObservationListClient({ ...page(), observations: Array.from({ length: 26 }, (_, index) => record(1, `obs-${index}`)) }, observationScope)).toThrow();
  });
  it('rejects overlapping or out-of-order continuation rows instead of replacing immutable identities', () => {
    const first = record(); const next = record(1, 'observation-b');
    next.current = { ...next.current, measuredAt: first.current.measuredAt - 1 }; next.history = [next.current];
    expect(appendCloudObservationRows([first], [next])).toHaveLength(2);
    expect(() => appendCloudObservationRows([first], [first])).toThrow();
    expect(() => appendCloudObservationRows([next], [first])).toThrow();
    expect(() => appendCloudObservationRows(Array.from({ length: 500 }, () => first), [next])).toThrow();
  });
  it('keeps latest groups independent, with recorded times and null, not normal values', () => {
    const result = parseCloudObservationLatestClient(latest(), observationScope);
    expect(result.vitals.anthropometry?.measuredAt).not.toBe(result.vitals.bloodPressure?.measuredAt);
    expect(result.vitals.temperature).toBeNull(); expect(result.timeZone).toBe('Asia/Almaty');
    const pressureOnly = latest(); pressureOnly.vitals.anthropometry = null as never;
    expect(parseCloudObservationLatestClient(pressureOnly, observationScope).vitals.anthropometry).toBeNull();
  });
  it('rejects fake clinical interpretation, out-of-bounds timestamps and invalid latest BMI', () => {
    expect(() => parseCloudObservationLatestClient({ ...latest(), clinicalInterpretation: 'normal' }, observationScope)).toThrow();
    const invalid = latest(); invalid.vitals.anthropometry.bmi = 24;
    expect(() => parseCloudObservationLatestClient(invalid, observationScope)).toThrow();
    const future = latest(); future.vitals.bloodPressure.measuredAt = observationNow + 300001;
    expect(() => parseCloudObservationLatestClient(future, observationScope)).toThrow();
  });
  it('paginates version history independently and rejects changed head or gaps', () => {
    const selected = record(3);
    const payload = { ...observationEnvelope(), persistence: 'supabase', observationId: selected.id, observationVersion: 3,
      currentVersion: 3, historyCount: 3, items: [observationVersion(2), observationVersion(1)], page: { hasMore: false, nextCursor: null } };
    const result = parseCloudObservationHistoryClient(payload, observationScope, selected);
    expect(appendCloudObservationHistory(selected.history, result.items).map(item => item.version)).toEqual([3, 2, 1]);
    expect(() => parseCloudObservationHistoryClient({ ...payload, observationVersion: 4 }, observationScope, selected)).toThrow();
    expect(() => appendCloudObservationHistory(selected.history, [observationVersion(1)])).toThrow();
    expect(() => appendCloudObservationHistory(selected.history, selected.history)).toThrow();
    expect(() => appendCloudObservationHistory(selected.history, [])).toThrow();
  });
  it('accepts only the command-time mutation version and exact selected observation', () => {
    const payload = { ...observationMutation(3, true), persistence: 'supabase', observation: record(3) };
    expect(parseCloudObservationMutationClient(payload, observationScope, { observationId: 'observation-a', expectedVersion: 2 }).replayed).toBe(true);
    expect(() => parseCloudObservationMutationClient(payload, observationScope, { observationId: 'other', expectedVersion: 2 })).toThrow();
    expect(() => parseCloudObservationMutationClient(payload, observationScope, { expectedVersion: 3 })).toThrow();
  });
  it('limits UTF8 response bytes even when content-length is absent', async () => {
    await expect(readBoundedCloudObservationResponse(new Response(' '.repeat(768 * 1024 + 1)))).rejects.toThrow('размер');
    await expect(readBoundedCloudObservationResponse(new Response('{}', { headers: { 'content-length': String(768 * 1024 + 1) } }))).rejects.toThrow('размер');
    const response = new Response('"' + 'я'.repeat(400000) + '"');
    await expect(readBoundedCloudObservationResponse(response)).rejects.toThrow('размер');
  });
  it('preserves typed safe API errors rather than presenting failure as zero measurements', async () => {
    const response = Response.json({ error: { code: 'PAGINATION_STALE', message: 'Обновите данные.' } }, { status: 409 });
    await expect(readBoundedCloudObservationResponse(response)).rejects.toMatchObject({ status: 409, code: 'PAGINATION_STALE' });
    expect(new CloudObservationClientError(403, 'OBSERVATION_FORBIDDEN', 'Нет доступа.').message).toBe('Нет доступа.');
    await expect(readBoundedCloudObservationResponse(new Response('<html>error</html>', { status: 503 }))).rejects.toThrow();
  });
  it.each([401, 403, 404])('retains access denial status %s even for invalid JSON, missing and oversized bodies', async status => {
    for (const response of [new Response('<html>not authorized</html>', { status }), new Response(null, { status }),
      new Response(' '.repeat(768 * 1024 + 1), { status }), Response.json({}, { status, headers: { 'content-length': 'invalid' } })]) {
      await expect(readBoundedCloudObservationResponse(response)).rejects.toMatchObject({ status });
    }
  });
  it('clears denial immediately from headers without waiting for a never-closing error stream', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('{"error":')); },
      cancel() { cancelled = true; },
    });
    await expect(readBoundedCloudObservationResponse(new Response(stream, { status: 401 }))).rejects.toMatchObject({ status: 401 });
    expect(cancelled).toBe(true);
  });
});

describe('cloud observation command review and retries', () => {
  it('requires human test-data acknowledgment, complete groups and a correction reason', () => {
    const draft = cloudObservationDraft(undefined, observationNow); draft.heightCm = '165'; draft.weightKg = '64';
    expect(() => buildCloudObservationCommand(observationScope, draft, undefined, observationNow)).toThrow();
    draft.syntheticDataAcknowledged = true;
    expect(buildCloudObservationCommand(observationScope, draft, undefined, observationNow).values.heightCm).toBe(165);
    draft.weightKg = ''; expect(() => buildCloudObservationCommand(observationScope, draft, undefined, observationNow)).toThrow();
    const correction = cloudObservationDraft(record(3), observationNow); correction.syntheticDataAcknowledged = true;
    expect(() => buildCloudObservationCommand(observationScope, correction, record(3), observationNow)).toThrow();
    correction.reason = 'Исправлено по листу измерений';
    expect(buildCloudObservationCommand(observationScope, correction, record(3), observationNow)).toMatchObject({ expectedVersion: 3 });
  });
  it('preserves the original millisecond measurement time if the displayed input is unchanged', () => {
    const observation = record(); observation.current.measuredAt = observationNow - 10001;
    const draft = cloudObservationDraft(observation); draft.reason = 'Уточнён вес'; draft.syntheticDataAcknowledged = true;
    expect(buildCloudObservationCommand(observationScope, draft, observation, observationNow).measuredAt).toBe(observation.current.measuredAt);
  });
  it('rejects out-of-range derived BMI without changing the domain contract', () => {
    const draft = cloudObservationDraft(undefined, observationNow);
    Object.assign(draft, { heightCm: '40', weightKg: '500', syntheticDataAcknowledged: true });
    expect(() => buildCloudObservationCommand(observationScope, draft, undefined, observationNow)).toThrow('ИМТ');
  });
  it('lets a nurse correct only the current recorder, not the root creator or an old history owner', () => {
    const nurse = { id: 'staff-nurse', displayName: 'Сотрудник Тестовый', membershipId: 'membership-a', role: 'nurse' as const, accessAssignmentId: 'assignment-a' };
    const own = record(); expect(cloudObservationCanCorrect(nurse, own)).toBe(true);
    const others = record(); others.current.recordedByMembershipId = 'membership-b';
    expect(cloudObservationCanCorrect(nurse, others)).toBe(false);
    expect(cloudObservationCanCorrect({ ...nurse, role: 'clinician' }, others)).toBe(true);
  });
  it('freezes exact bytes and UUID across a retry, even if draft objects later change', () => {
    const draft = cloudObservationDraft(undefined, observationNow);
    Object.assign(draft, { heightCm: '165', weightKg: '64', syntheticDataAcknowledged: true });
    const command = buildCloudObservationCommand(observationScope, draft, undefined, observationNow);
    const frozen = freezeCloudObservationCommand(observationScope, command, generation);
    command.values.weightKg = 99; draft.idempotencyKey = crypto.randomUUID();
    expect(JSON.parse(frozen.body).values.weightKg).toBe(64); expect(JSON.parse(frozen.body).idempotencyKey).toBe(frozen.idempotencyKey);
    expect(frozen.method).toBe('POST'); expect(frozen.generation).toBe(generation); expect(Object.isFrozen(frozen)).toBe(true);
    expect(() => freezeCloudObservationCommand({ ...observationScope, patientId: 'other' }, command, generation)).toThrow();
    expect(() => freezeCloudObservationCommand(observationScope, command, 'invalid')).toThrow();
    expect(() => freezeCloudObservationCommand(observationScope, command, generation, 'observation-a')).toThrow();
  });
});
