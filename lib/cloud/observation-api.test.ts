import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
import { GET as list, POST as create } from '@/app/api/observations/route';
import { PATCH as correct } from '@/app/api/observations/[observationId]/route';
import { GET as history } from '@/app/api/observations/[observationId]/history/route';
import { GET as latest } from '@/app/api/observations/latest-vitals/route';
import { CloudSessionChangedError } from './database-context.server';
import { CloudRpcError } from './supabase-rpc.server';
import { encodeCloudObservationCursor } from './observation-cursor.server';
import { cloudObservationRequestSelection } from './observation-api.server';
import { historyCursor, observationAssignment, observationCommand, observationEnvelope, observationList, observationMutation,
  observationNow, observationVersion } from './observation-test-fixtures';

const control = vi.hoisted(() => ({ database: vi.fn(), listAssignments: vi.fn(), call: vi.fn() }));
vi.mock('./database-context.server', async importOriginal => ({
  ...await importOriginal<typeof import('./database-context.server')>(), cloudDatabaseForRequest: control.database,
}));
vi.mock('./access-repository.server', () => ({ CloudAccessGovernanceRepository: class {
  listPrincipalAssignments = control.listAssignments;
} }));
const origin = 'https://orion.example.invalid';
const source = { ORION_SUPABASE_PROJECT_REF: 'a'.repeat(20), ORION_SUPABASE_URL: `https://${'a'.repeat(20)}.supabase.co`,
  ORION_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'b'.repeat(24)}`, ORION_CLOUD_PUBLIC_ORIGIN: origin, ORION_SYNTHETIC_DATA_ONLY: 'true' };
const request = (path: string, init: RequestInit = {}) => new Request(`${origin}${path}`, {
  ...init, headers: { 'orion-session-generation': 'a'.repeat(32), ...Object.fromEntries(new Headers(init.headers)) },
});
const mutation = (path: string, payload: unknown, method = 'POST', headers?: HeadersInit) => request(path, {
  method, headers: { origin, 'sec-fetch-site': 'same-origin', 'content-type': 'application/json', ...Object.fromEntries(new Headers(headers)) },
  body: JSON.stringify(payload),
});
const routeParams = { params: Promise.resolve({ observationId: 'observation-a' }) };
const scoped = '?patientId=patient-a&facilityId=facility-a&accessAssignmentId=assignment-a';
type TestBody = { patients: unknown[]; observations: Array<{ history: unknown[]; historyCount: number }>; error: { code: string } };

beforeEach(() => {
  Object.entries(source).forEach(([name, value]) => vi.stubEnv(name, value));
  vi.spyOn(Date, 'now').mockReturnValue(observationNow);
  control.call.mockReset();
  control.listAssignments.mockReset().mockResolvedValue([observationAssignment()]);
  control.database.mockReset().mockResolvedValue({ principal: { issuer: 'https://project.supabase.co/auth/v1', subject: 'staff-a', email: null },
    sessionId: 'a'.repeat(32), call: control.call });
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe('prepared real cloud observation HTTP handlers', () => {
  it('loads one explicitly selected patient with bounded current records and partial-history metadata', async () => {
    control.call.mockResolvedValue(observationList(2));
    const response = await list(request(`/api/observations${scoped}`));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(control.call).toHaveBeenCalledExactlyOnceWith('orion_observations_page', {
      assignment_id: 'assignment-a', facility_id: 'facility-a', patient_id: 'patient-a', max_results: 25, cursor: null,
    });
    const body = await response.json() as TestBody;
    expect(body).toMatchObject({ persistence: 'supabase', dataMode: 'synthetic-only', role: 'clinician', clinicalInterpretation: 'not_performed',
      thresholdPolicy: { status: 'not_configured', decision: 'DEC-006' }, patientSelection: 'explicit', historyMode: 'bounded-current-window' });
    expect(body.patients).toHaveLength(1);
    expect(body.observations[0].history).toHaveLength(1);
    expect(body.observations[0].historyCount).toBe(2);
    expect(body).not.toHaveProperty('totalPatients');
    expect(body).not.toHaveProperty('urgentCount');
  });
  it('distinguishes successful empty records from an unavailable source', async () => {
    control.call.mockResolvedValue({ ...observationList(), observations: [] });
    const empty = await list(request(`/api/observations${scoped}`));
    expect(empty.status).toBe(200); expect((await empty.json() as TestBody).observations).toEqual([]);
    control.call.mockRejectedValue(new Error('private upstream failure'));
    const failure = await list(request(`/api/observations${scoped}`));
    expect(failure.status).toBe(503); expect(await failure.text()).not.toContain('private upstream');
  });
  it.each(['', '?limit=25', `${scoped}&limit=51`, `${scoped}&limit=0`, `${scoped}&limit=25&limit=25`,
    `${scoped}&patientId=patient-b`, `${scoped}&facilityId=other`, `${scoped}&accessAssignmentId=other`,
    `${scoped}&cursor=bad`, `${scoped}&cursor=`, `${scoped}&cursor=e30&cursor=e30`, `${scoped}&patientSelector=first200`,
    '?patientId=%20patient-a', '?patientId=patient-a&facilityId=%20facility-a'])
    ('rejects missing patient, ambiguous selectors and unsafe page parameters before auth/network %s', async query => {
      expect((await list(request(`/api/observations${query}`))).status).toBe(400);
      expect(control.database).not.toHaveBeenCalled(); expect(control.call).not.toHaveBeenCalled();
    });
  it('uses the exact header/query selection and rejects conflicts before auth', async () => {
    const invalid = request(`/api/observations${scoped}`, { headers: { 'x-orion-access-assignment-id': 'different' } });
    expect((await list(invalid)).status).toBe(400); expect(control.database).not.toHaveBeenCalled();
    expect(() => cloudObservationRequestSelection(request('/api/observations?facilityId=facility-a'), { facilityId: 'different' })).toThrow();
    expect(() => cloudObservationRequestSelection(request('/api/observations', { headers: { 'x-orion-facility-id': 'facility-a,facility-b' } }))).toThrow();
  });
  it.each(['patientId=other', 'cursor=ignored', 'limit=200', 'query=ignored'])
    ('rejects hidden mutation URL selectors instead of ignoring them %s', async query => {
      expect((await create(mutation(`/api/observations?${query}`, observationCommand()))).status).toBe(400);
      expect((await correct(mutation(`/api/observations/observation-a?${query}`, { ...observationCommand(), expectedVersion: 1 }, 'PATCH'), routeParams)).status).toBe(400);
      expect(control.database).not.toHaveBeenCalled(); expect(control.call).not.toHaveBeenCalled();
    });
  it('never auto-selects between eligible departments or lends a role across assignments', async () => {
    control.listAssignments.mockResolvedValue([observationAssignment(), observationAssignment({ assignmentId: 'assignment-b' })]);
    const multiple = await list(request('/api/observations?patientId=patient-a'));
    expect(multiple.status).toBe(409); expect((await multiple.json() as TestBody).error.code).toBe('ACCESS_ASSIGNMENT_SELECTION_REQUIRED');
    expect(control.call).not.toHaveBeenCalled();
    control.listAssignments.mockResolvedValue([observationAssignment({ effectivePermissions: [] }), observationAssignment({ assignmentId: 'assignment-b', roles: ['administrator'] })]);
    expect((await list(request('/api/observations?patientId=patient-a'))).status).toBe(403);
    expect(control.call).not.toHaveBeenCalled();
  });
  it.each<Partial<AccessAssignmentSummary>>([{ roles: ['service', 'doctor'] }, { effectiveUntil: observationNow }, { status: 'revoked' },
    { roles: ['registrar'] }, { effectivePermissions: [], denyPermissions: ['observations.manage'] }])
    ('rejects inactive, nonclinical or denied selected assignment %j', async patch => {
      control.listAssignments.mockResolvedValue([observationAssignment(patch)]);
      expect((await list(request(`/api/observations${scoped}`))).status).toBe(403);
      expect(control.call).not.toHaveBeenCalled();
    });
  it('does not replace an explicitly wrong assignment/facility with another valid grant', async () => {
    expect((await list(request('/api/observations?patientId=patient-a&accessAssignmentId=missing'))).status).toBe(403);
    expect((await list(request('/api/observations?patientId=patient-a&accessAssignmentId=assignment-a&facilityId=wrong'))).status).toBe(403);
    expect(control.call).not.toHaveBeenCalled();
  });
  it('loads only selected observation history and requires the current snapshot version', async () => {
    control.call.mockResolvedValue({ ...observationEnvelope(), observationId: 'observation-a', observationVersion: 2,
      items: [observationVersion(1)], page: { hasMore: false, nextCursor: null } });
    const cursor = historyCursor();
    const response = await history(request(`/api/observations/observation-a/history${scoped}&cursor=${encodeCloudObservationCursor(cursor)}`), routeParams);
    expect(response.status).toBe(200);
    expect(control.call).toHaveBeenCalledWith('orion_observation_history_page', { assignment_id: 'assignment-a', facility_id: 'facility-a',
      patient_id: 'patient-a', observation_id: 'observation-a', max_results: 25, cursor });
    expect(await response.json()).toMatchObject({ historyCount: 2, currentVersion: 2, historyMode: 'bounded-selected-observation' });
    control.call.mockResolvedValue({ ...observationEnvelope(), observationId: 'observation-a', observationVersion: 3,
      items: [observationVersion(1)], page: { hasMore: false, nextCursor: null } });
    expect((await history(request(`/api/observations/observation-a/history${scoped}&cursor=${encodeCloudObservationCursor(cursor)}`), routeParams)).status).toBe(503);
  });
  it('rejects wrong cursor kind or patient/selected observation before auth', async () => {
    const cursor = encodeCloudObservationCursor(historyCursor());
    expect((await list(request(`/api/observations${scoped}&cursor=${cursor}`))).status).toBe(400);
    expect((await history(request(`/api/observations/observation-a/history${scoped}&cursor=${encodeCloudObservationCursor(historyCursor(2, 2, 'other'))}`), routeParams)).status).toBe(400);
    expect((await history(request(`/api/observations/observation-a/history${scoped}&cursor=${encodeCloudObservationCursor({ ...historyCursor(), patientId: 'other' })}`), routeParams)).status).toBe(400);
    expect(control.database).not.toHaveBeenCalled();
  });
  it('rejects a cursor crossing the independently resolved tenant before its clinical RPC', async () => {
    expect((await history(request(`/api/observations/observation-a/history${scoped}&cursor=${encodeCloudObservationCursor({ ...historyCursor(), organizationId: 'other' })}`), routeParams)).status).toBe(400);
    expect(control.call).not.toHaveBeenCalled();
  });
  it('latest vitals retain empty measurement groups instead of invented healthy values', async () => {
    control.call.mockResolvedValue({ ...observationEnvelope(), vitals: { anthropometry: null, bloodPressure: null, temperature: null } });
    const response = await latest(request(`/api/observations/latest-vitals${scoped}`));
    expect(response.status).toBe(200);
    expect(control.call).toHaveBeenCalledWith('orion_patient_latest_vitals', { assignment_id: 'assignment-a', patient_id: 'patient-a', facility_id: 'facility-a' });
    expect(await response.json()).toMatchObject({ vitals: { anthropometry: null, bloodPressure: null, temperature: null }, persistence: 'supabase' });
  });
  it.each([`${scoped}&limit=1`, `${scoped}&cursor=bad`, '?patientId=patient-a&patientId=patient-b', ''])
    ('rejects unsupported latest parameters before network', async query => {
      expect((await latest(request(`/api/observations/latest-vitals${query}`))).status).toBe(400);
      expect(control.database).not.toHaveBeenCalled();
    });
  it('creates and corrects using strict synthetic command schemas and the committing RPC record', async () => {
    const payload = observationCommand(); control.call.mockResolvedValueOnce(observationMutation());
    const created = await create(mutation('/api/observations', payload));
    expect(created.status).toBe(201);
    expect(control.call).toHaveBeenCalledWith('orion_observation_create', { assignment_id: 'assignment-a', facility_id: 'facility-a', payload });
    control.call.mockResolvedValueOnce(observationMutation(2));
    const correction = { ...payload, expectedVersion: 1 };
    const corrected = await correct(mutation('/api/observations/observation-a', correction, 'PATCH'), routeParams);
    expect(corrected.status).toBe(200);
    expect(control.call).toHaveBeenLastCalledWith('orion_observation_correct', { assignment_id: 'assignment-a', facility_id: 'facility-a', observation_id: 'observation-a', payload: correction });
    expect(await corrected.json()).toMatchObject({ observation: { currentVersion: 2, historyCount: 2 }, persistence: 'supabase' });
  });
  it('permits immutable command-time replay under fresh scope without inventing a current head', async () => {
    const value = observationMutation(2, true); value.assignmentVersionId = 'fresh-version';
    control.call.mockResolvedValue(value);
    const response = await correct(mutation('/api/observations/observation-a', { ...observationCommand(), expectedVersion: 1 }, 'PATCH'), routeParams);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ replayed: true, assignmentVersionId: 'fresh-version', observation: { currentVersion: 2 } });
  });
  it.each([{ syntheticDataAcknowledged: false }, { idempotencyKey: 'not-uuid' }, { measuredAt: observationNow + 300001 },
    { patientId: 'x'.repeat(161) }, { extra: 'authority' }, { reason: '' },
    { values: { ...observationCommand().values, diastolicMmhg: null } }])
    ('rejects invalid create command before auth %j', async patch => {
      expect((await create(mutation('/api/observations', { ...observationCommand(), ...patch }))).status).toBe(422);
      expect(control.database).not.toHaveBeenCalled(); expect(control.call).not.toHaveBeenCalled();
    });
  it.each([undefined, 0, -1, 1.1, 2147483647])('requires current integer expectedVersion for correction', async expectedVersion => {
    expect((await correct(mutation('/api/observations/observation-a', { ...observationCommand(), expectedVersion }, 'PATCH'), routeParams)).status).toBe(422);
    expect(control.database).not.toHaveBeenCalled();
  });
  it.each<Record<string, string>>([{ origin: 'https://foreign.invalid' }, { 'sec-fetch-site': 'cross-site' }, { 'content-type': 'text/plain' }])
    ('blocks cross-site/non-JSON commands before reading body or authority', async headers => {
      expect((await create(mutation('/api/observations', observationCommand(), 'POST', headers))).status).toBe(403);
      expect(control.database).not.toHaveBeenCalled(); expect(control.call).not.toHaveBeenCalled();
    });
  it('fails closed without approved synthetic mode and bounds oversized streamed bodies', async () => {
    vi.stubEnv('ORION_SYNTHETIC_DATA_ONLY', 'false');
    expect((await list(request(`/api/observations${scoped}`))).status).toBe(503);
    expect(control.database).not.toHaveBeenCalled();
    vi.stubEnv('ORION_SYNTHETIC_DATA_ONLY', 'true');
    expect((await create(mutation('/api/observations', { ...observationCommand(), note: 'x'.repeat(20000) }))).status).toBe(422);
    expect(control.database).not.toHaveBeenCalled();
  });
  it('exposes only safe recognized denial statuses/codes, never private provider payloads', async () => {
    const cases: [CloudRpcError, number, string][] = [
      [new CloudRpcError('unauthenticated'), 401, 'UNAUTHENTICATED'], [new CloudRpcError('forbidden'), 403, 'OBSERVATION_FORBIDDEN'],
      [new CloudRpcError('not_found'), 404, 'OBSERVATION_NOT_FOUND'], [new CloudRpcError('unavailable'), 503, 'OBSERVATIONS_UNAVAILABLE'],
      [new CloudRpcError('invalid', undefined, 400), 400, 'INVALID_OBSERVATION_REQUEST'],
      [new CloudRpcError('invalid', undefined, 422, 'OBSERVATION_BMI_OUT_OF_RANGE'), 422, 'OBSERVATION_BMI_OUT_OF_RANGE'],
      [new CloudRpcError('conflict', undefined, 409, 'PAGINATION_STALE'), 409, 'PAGINATION_STALE'],
      [new CloudRpcError('conflict', undefined, 409, 'OBSERVATION_VERSION_CONFLICT'), 409, 'OBSERVATION_VERSION_CONFLICT'],
      [new CloudRpcError('conflict', undefined, 409, 'OBSERVATION_NO_CHANGE'), 409, 'OBSERVATION_NO_CHANGE'],
      [new CloudRpcError('conflict', undefined, 409, 'OBSERVATION_IDEMPOTENCY_CONFLICT'), 409, 'OBSERVATION_IDEMPOTENCY_CONFLICT'],
    ];
    for (const [error, status, code] of cases) {
      control.call.mockRejectedValueOnce(error);
      const response = await list(request(`/api/observations${scoped}`));
      expect(response.status).toBe(status);
      const body = await response.json() as TestBody; expect(body.error.code).toBe(code);
      expect(JSON.stringify(body)).not.toMatch(/bearer|sb_publishable_|inputHash/);
    }
  });
  it('hides results on a session-generation change before any clinical read', async () => {
    control.database.mockRejectedValue(new CloudSessionChangedError());
    const response = await list(request(`/api/observations${scoped}`));
    expect(response.status).toBe(409); expect((await response.json() as TestBody).error.code).toBe('SESSION_CHANGED');
    expect(control.call).not.toHaveBeenCalled();
  });
  it('does not expose malformed RPC provenance or cross-patient results', async () => {
    control.call.mockResolvedValue({ ...observationList(), patientId: 'other-patient' });
    expect((await list(request(`/api/observations${scoped}`))).status).toBe(503);
    control.call.mockResolvedValue({ ...observationEnvelope(), vitals: { anthropometry: null, bloodPressure: null, temperature: null }, riskScore: 87 });
    expect((await latest(request(`/api/observations/latest-vitals${scoped}`))).status).toBe(503);
  });
});
