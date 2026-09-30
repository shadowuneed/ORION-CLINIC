import { afterEach, describe, expect, it, vi } from 'vitest';
import { STAFF_SESSION_COOKIE, hashStaffSessionToken, type StaffSessionRepository } from '../auth/staff-session';
import { createLocalMaterialLifecycle } from './lifecycle';
import { localMaterialConsentTypes, resolveLocalMaterialContext, type LocalMaterialContextSnapshotReader } from './server-context';

const token = 'a'.repeat(64);
const selection = () => ({ accessAssignmentId: 'assignment-a', facilityId: 'facility-a', patientId: 'patient-a', encounterId: 'encounter-a' });
const headers = () => new Headers({ Cookie: `${STAFF_SESSION_COOKIE}=${token}` });
const consent = (type: typeof localMaterialConsentTypes[number] = 'care') => ({
  type, eventId: `consent-${type}`, version: 1, decision: 'granted' as string,
  effectiveAt: 1_000, expiresAt: null as number | null,
  policyVersion: 'synthetic-local-v1', policyHash: 'synthetic-policy-hash', externalProcessor: null as string | null,
});
function row() {
  return {
    ...selection(), observedAt: 2_000, sessionId: 'session-a', userId: 'user-a', userVersion: 1,
    issuer: 'orion:individual-staff', subject: 'subject-a', membershipId: 'membership-a', membershipVersion: 1,
    organizationId: 'organization-a', organizationVersion: 1, facilityVersion: 1,
    departmentId: 'department-a', departmentVersion: 1, departmentVersionId: 'department-version-a',
    assignmentVersion: 1, assignmentVersionId: 'assignment-version-a',
    patientVersion: 1, patientVersionId: 'patient-version-a', encounterVersion: 1,
    encounterStatus: 'in_progress', canManage: 1, consentsIntegrity: 1,
    consentsJson: JSON.stringify(localMaterialConsentTypes.map(type => consent(type))),
  };
}
function dependencies(raw: unknown = row()) {
  const sessions: StaffSessionRepository = {
    create: vi.fn(async () => null), revoke: vi.fn(async () => {}), revokeAll: vi.fn(async () => {}),
    resolve: vi.fn(async () => ({
      sessionId: 'session-a', userId: 'user-a', displayName: 'Synthetic Doctor A',
      principal: { issuer: 'orion:individual-staff', subject: 'subject-a', email: 'a@staff.example.test' },
      createdAt: 1_000, lastSeenAt: 2_000, idleExpiresAt: 1_802_000, absoluteExpiresAt: 28_801_000,
    })),
  };
  const contexts: LocalMaterialContextSnapshotReader = { readSnapshot: vi.fn(async () => raw) };
  return { sessions, contexts };
}
const resolve = (raw: unknown = row()) => resolveLocalMaterialContext(headers(), selection(), dependencies(raw));
async function resolved(raw: unknown = row()) {
  const result = await resolve(raw);
  if (result.status !== 'resolved') throw new Error(`Expected resolved fixture: ${result.status}`);
  return result;
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.resetModules(); });

describe('unmounted server local material metadata boundary', () => {
  it.each([
    null, [], {}, { ...selection(), userId: 'user-b' }, { ...selection(), patientId: undefined },
    { ...selection(), encounterId: '' }, { ...selection(), encounterId: ' x' },
    { ...selection(), encounterId: 'x\u0085y' }, { ...selection(), encounterId: 'x\ud800y' },
    { ...selection(), encounterId: 'x'.repeat(257) },
  ])('rejects incomplete/non-exact selection %j before any IO', async value => {
    const deps = dependencies();
    expect(await resolveLocalMaterialContext(headers(), value, deps)).toEqual({ status: 'invalid-request' });
    expect(deps.sessions.resolve).not.toHaveBeenCalled();
    expect(deps.contexts.readSnapshot).not.toHaveBeenCalled();
  });

  it.each([null, 'role=doctor', `${STAFF_SESSION_COOKIE}=invalid`,
    `${STAFF_SESSION_COOKIE}=${token}; ${STAFF_SESSION_COOKIE}=${token}`,
  ])('rejects cookie %s without trusting Sites or role headers', async cookie => {
    const input = new Headers({ 'oai-authenticated-user-id': 'user-a', 'X-Role': 'doctor', Authorization: `Bearer ${token}` });
    if (cookie) input.set('Cookie', cookie);
    const deps = dependencies();
    expect(await resolveLocalMaterialContext(input, selection(), deps)).toEqual({ status: 'unauthenticated' });
    expect(deps.sessions.resolve).not.toHaveBeenCalled();
    expect(deps.contexts.readSnapshot).not.toHaveBeenCalled();
  });

  it('preserves preflight denial and outage without querying scope', async () => {
    const deps = dependencies();
    vi.mocked(deps.sessions.resolve).mockResolvedValueOnce(null).mockRejectedValueOnce(new Error('private error'));
    expect(await resolveLocalMaterialContext(headers(), selection(), deps)).toEqual({ status: 'unauthenticated' });
    expect(await resolveLocalMaterialContext(headers(), selection(), deps)).toEqual({ status: 'unavailable' });
    expect(deps.contexts.readSnapshot).not.toHaveBeenCalled();
  });

  it('maps final absence uniformly to forbidden and never logs database exception contents', async () => {
    expect(await resolve(null)).toEqual({ status: 'forbidden' });
    const deps = dependencies();
    vi.mocked(deps.contexts.readSnapshot).mockRejectedValueOnce(new Error(`private ${token}`));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const logs = vi.spyOn(console, 'log').mockImplementation(() => {});
    expect(await resolveLocalMaterialContext(headers(), selection(), deps)).toEqual({ status: 'unavailable' });
    expect(errors).not.toHaveBeenCalled(); expect(warnings).not.toHaveBeenCalled(); expect(logs).not.toHaveBeenCalled();
  });

  it('captures exact headers and selection before awaiting and freezes the final query input', async () => {
    const deps = dependencies(); const original = await deps.sessions.resolve('unused');
    let release!: () => void;
    const waiting = new Promise<void>(accept => { release = accept; });
    vi.mocked(deps.sessions.resolve).mockImplementationOnce(async () => { await waiting; return original; });
    const inputHeaders = headers(); const selected = selection();
    const pending = resolveLocalMaterialContext(inputHeaders, selected, deps);
    inputHeaders.set('Cookie', `${STAFF_SESSION_COOKIE}=${'b'.repeat(64)}`);
    selected.patientId = 'patient-b'; release();
    expect((await pending).status).toBe('resolved');
    const captured = vi.mocked(deps.contexts.readSnapshot).mock.calls[0][0];
    expect(captured).toEqual({ ...selection(), tokenHash: await hashStaffSessionToken(token),
      userId: 'user-a', issuer: 'orion:individual-staff', subject: 'subject-a' });
    expect(Object.isFrozen(captured)).toBe(true);
  });

  it.each(['userId', 'issuer', 'subject', 'accessAssignmentId', 'facilityId', 'patientId', 'encounterId'])(
    'fails closed on a mismatched repository %s', async field => {
      expect(await resolve({ ...row(), [field]: 'other-value' })).toEqual({ status: 'unavailable' });
    },
  );

  it.each([
    { observedAt: 0 }, { assignmentVersion: 1.2 }, { userVersion: 0 }, { membershipVersion: undefined },
    { organizationVersion: -1 }, { facilityVersion: Number.MAX_SAFE_INTEGER + 1 },
    { patientVersionId: undefined }, { patientVersionId: '' }, { assignmentVersionId: ' x' },
    { encounterStatus: 'unknown' }, { canManage: true }, { consentsIntegrity: 0 },
    { consentsJson: 'not json' }, { consentsJson: 'x'.repeat(65_537) },
    { consentsJson: JSON.stringify([consent(), consent()]) },
    { consentsJson: JSON.stringify([{ ...consent(), type: 'notifications' }]) },
    { consentsJson: JSON.stringify([{ ...consent(), version: 0 }]) },
    { consentsJson: JSON.stringify([{ ...consent(), expiresAt: 1_000 }]) },
    { consentsJson: JSON.stringify([{ ...consent(), decision: 'yes' }]) },
    { consentsJson: JSON.stringify([{ ...consent(), secretExtra: true }]) },
  ])('fails closed for corrupt raw metadata %j', async override => {
    expect(await resolve({ ...row(), ...override })).toEqual({ status: 'unavailable' });
  });

  it.each([
    ['granted', 1_000, null, true], ['denied', 1_000, null, false], ['withdrawn', 1_000, null, false],
    ['granted', 2_001, null, false], ['granted', 2_000, null, true], ['granted', 1_000, 2_000, false],
    ['granted', 1_000, 2_001, true],
  ] as const)('evaluates %s/%s/%s only at the final database clock', async (decision, effectiveAt, expiresAt, expected) => {
    vi.spyOn(Date, 'now').mockImplementation(() => { throw new Error('No application clock authority'); });
    const result = await resolved({ ...row(), consentsJson: JSON.stringify([{ ...consent(), decision, effectiveAt, expiresAt }]) });
    expect(result.consents.care?.effectiveByTime).toBe(expected);
    expect(result.context.consentVersions.care).toBe(1);
    expect(result.consents.audio_retention).toBeNull();
    expect(result.context.consentVersions.audioRetention).toBeNull();
    expect(result).not.toHaveProperty('permissions'); expect(result).not.toHaveProperty('canReadAudio');
  });

  it('preserves external processor provenance without treating temporal grant as processor approval', async () => {
    const result = await resolved({ ...row(), consentsJson: JSON.stringify([
      { ...consent('external_ai_processing'), externalProcessor: 'synthetic-unapproved-provider' },
    ]) });
    expect(result.consents.external_ai_processing).toMatchObject({ effectiveByTime: true, externalProcessor: 'synthetic-unapproved-provider' });
    expect(result.consents.care).toBeNull(); // Metadata read is not a clinical action grant.
    expect(result).not.toHaveProperty('authorized');
  });

  it('returns a deeply immutable minimal DTO accepted by the unmounted lifecycle, with no material/session credentials', async () => {
    const result = await resolved({ ...row(), secretTranscript: 'private transcript', displayName: 'private name', tokenHash: token });
    for (const object of [result, result.context, result.context.consentVersions, result.versions, result.consents, ...Object.values(result.consents)]) {
      expect(Object.isFrozen(object)).toBe(true);
    }
    const text = JSON.stringify(result);
    for (const privateValue of [token, 'session-a', 'private transcript', 'private name', 'tokenHash', 'secretTranscript']) expect(text).not.toContain(privateValue);
    expect(Object.keys(result).sort()).toEqual(['consents', 'context', 'observedAt', 'status', 'versions']);
    expect(result.context.authorizationGeneration).toMatch(/^context-v1:[a-f0-9]{64}$/);
    const lifecycle = createLocalMaterialLifecycle(); lifecycle.replaceContext(result.context);
    expect(lifecycle.capture()?.context).toEqual(result.context);
    lifecycle.invalidate(); expect(lifecycle.capture()).toBeNull();
  });

  it('uses canonical consent ordering and ignores observation time when version and temporal state are unchanged', async () => {
    const first = await resolved();
    const second = await resolved({ ...row(), observedAt: 2_500, consentsJson: JSON.stringify(localMaterialConsentTypes.toReversed().map(type => consent(type))) });
    expect(first.context.authorizationGeneration).toBe(second.context.authorizationGeneration);
  });

  it.each([
    { sessionId: 'session-b' }, { userVersion: 2 }, { membershipVersion: 2 }, { organizationVersion: 2 }, { facilityVersion: 2 },
    { assignmentVersion: 2 }, { assignmentVersionId: 'assignment-head-b' }, { departmentVersion: 2 },
    { departmentVersionId: 'department-head-b' }, { departmentId: 'department-b' }, { membershipId: 'membership-b' },
    { patientVersion: 2 }, { patientVersionId: 'patient-version-b' }, { patientVersionId: null },
    { encounterVersion: 2 }, { encounterStatus: 'finalized' }, { canManage: 0 },
    { consentsJson: '[]' },
    { consentsJson: JSON.stringify([{ ...consent(), eventId: 'new-event' }]) },
  ])('changes the non-bearer fingerprint when authority/provenance pins change %j', async override => {
    expect((await resolved({ ...row(), ...override })).context.authorizationGeneration).not.toBe((await resolved()).context.authorizationGeneration);
  });

  it('changes generation at a consent temporal boundary without requiring version mutation', async () => {
    const raw = { ...row(), consentsJson: JSON.stringify([{ ...consent(), expiresAt: 2_001 }]) };
    const before = await resolved(raw); const after = await resolved({ ...raw, observedAt: 2_001 });
    expect(before.consents.care?.effectiveByTime).toBe(true); expect(after.consents.care?.effectiveByTime).toBe(false);
    expect(before.context.authorizationGeneration).not.toBe(after.context.authorizationGeneration);
  });

  it('fails closed when fingerprint hashing fails without returning partial context', async () => {
    const digest = crypto.subtle.digest.bind(crypto.subtle); let calls = 0;
    vi.spyOn(crypto.subtle, 'digest').mockImplementation((...args) => {
      if (++calls === 3) return Promise.reject(new Error('synthetic fingerprint failure'));
      return digest(...args);
    });
    expect(await resolve()).toEqual({ status: 'unavailable' });
    expect(calls).toBe(3);
  });

  it('rejects accidental client import before any context can be read', async () => {
    vi.resetModules(); vi.stubGlobal('window', {});
    await expect(import('./server-context')).rejects.toThrow(/server execution|server-only/);
  });
});
