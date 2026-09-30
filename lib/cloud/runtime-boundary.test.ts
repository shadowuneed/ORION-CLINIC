import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { deriveEffectivePermissions } from '@/lib/domain/access-governance';
import { getSiteIdentity } from '@/lib/auth/site-identity';
import { cloudDatabaseForRequest, CloudSessionChangedError, type CloudDatabaseContext } from './database-context.server';
import { CloudAccessGovernanceRepository } from './access-repository.server';
import { parseCloudAccessOverview, parseCloudPatientDetail, parseCloudPatientList, parseCloudPatientMutation } from './response-contracts';
import type { CloudRpcName } from './supabase-rpc.server';
import { cloudGenerationCookie, cloudGenerationHeader, readCloudGenerationCookie } from './account-fence';
import { CloudAccountBoundary } from '@/app/cloud-account-boundary';

const control = vi.hoisted(() => ({ session: vi.fn(), access: vi.fn(), headers: vi.fn(),
  effect: undefined as undefined | (() => void | (() => void)), refs: [] as Array<{ current: unknown }>, refIndex: 0 }));
vi.mock('./auth-session.server', () => ({ readCloudAuthSession: control.session, readCloudAccessToken: control.access }));
vi.mock('next/headers', () => ({ headers: control.headers }));
vi.mock('react', () => ({ cache: (fn: unknown) => fn, useLayoutEffect: (effect: () => void | (() => void)) => { control.effect = effect; },
  useRef: (initial: unknown) => { const index = control.refIndex++; return control.refs[index] ??= { current: initial }; } }));

const principal = { issuer: `https://${'a'.repeat(20)}.supabase.co/auth/v1`, subject: '00000000-0000-4000-8000-000000000001', email: 'synthetic@example.invalid' };
const sessionId = '00000000-0000-4000-8000-000000000002';
const generation = sessionId.replaceAll('-', '');
function request(value: string | null = generation) {
  return new Request('https://orion.invalid/api/patients', { headers: value === null ? {} : { [cloudGenerationHeader]: value } });
}
function assignment() {
  return { assignmentId: 'assignment-a', assignmentVersionId: 'assignment-version-a', assignmentVersion: 1,
    status: 'active', source: 'bootstrap', effectiveFrom: 1, effectiveUntil: null,
    organization: { id: 'org-a', name: 'Synthetic organization', status: 'active' },
    facility: { id: 'facility-a', name: 'Synthetic facility', status: 'active' },
    department: { id: 'department-a', code: 'medicine', name: 'Synthetic department', kind: 'clinical', status: 'active' },
    membership: { id: 'member-a', legacyRole: 'clinician', status: 'active' },
    user: { id: 'staff-a', displayName: 'Synthetic employee', status: 'active' },
    roles: ['doctor'], allowPermissions: [], denyPermissions: [], effectivePermissions: deriveEffectivePermissions(['doctor']) };
}
function overview() {
  return { user: { id: 'staff-a', displayName: 'Synthetic employee' }, assignments: [assignment()], observedAt: 1 };
}
function patient() {
  return { id: 'patient-a', medicalRecordNumber: 'SYN-1', displayName: 'Synthetic patient', birthDate: null,
    sexAtBirth: 'female', status: 'active', testIin: null, phone: null, email: null, address: null, photoUrl: null,
    encounterCount: 0, latestEncounter: null, createdAt: 1, updatedAt: 1, version: 1 };
}
const endPage = { hasMore: false, nextCursor: null };
function patientDetail() {
  return { ...patient(), encounters: [], profileHistory: [{ id: 'profile-a', version: 1, status: 'active',
    changeReason: 'Synthetic create', createdAt: 1, actorDisplayName: 'Synthetic employee' }], profileHistoryCount: 1,
    encountersPage: endPage, profileHistoryPage: endPage };
}

beforeEach(() => {
  vi.stubEnv('ORION_SUPABASE_PROJECT_REF', 'a'.repeat(20));
  vi.stubEnv('ORION_SUPABASE_URL', `https://${'a'.repeat(20)}.supabase.co`);
  vi.stubEnv('ORION_SUPABASE_PUBLISHABLE_KEY', `sb_publishable_${'b'.repeat(24)}`);
  control.session.mockReset().mockResolvedValue({ principal, sessionId });
  control.access.mockReset().mockReturnValue('synthetic.payload.signature');
  control.effect = undefined;
  control.refs = []; control.refIndex = 0;
  vi.stubGlobal('fetch', vi.fn());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe('cloud server runtime authorization boundary', () => {
  it.each([null, '', 'f'.repeat(32), '00000000-0000-4000-8000-000000000002'])('rejects missing or stale generation before any RPC: %s', async value => {
    await expect(cloudDatabaseForRequest(request(value))).rejects.toBeInstanceOf(CloudSessionChangedError);
    expect(fetch).not.toHaveBeenCalled();
  });
  it('retains verified principal/session only and does not copy forged gateway identity', async () => {
    const supplied = request();
    supplied.headers.set('oai-authenticated-user-id', 'forged-administrator');
    supplied.headers.set('x-orion-local-issuer', 'forged-issuer');
    supplied.headers.set('x-orion-local-generation', 'a'.repeat(32));
    const database = await cloudDatabaseForRequest(supplied);
    expect(database.principal).toEqual(principal);
    expect(database.sessionId).toBe(sessionId);
    expect(Object.isFrozen(database)).toBe(true);
    expect(Object.keys(database).sort()).toEqual(['call', 'principal', 'sessionId']);
    vi.stubGlobal('__ORION_LOCAL_CREDENTIALS__', false);
    expect(getSiteIdentity(supplied)).toBeNull();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('does not let forged headers replace missing provider authentication', async () => {
    control.session.mockResolvedValue(null);
    control.access.mockReturnValue(null);
    const supplied = request();
    supplied.headers.set('oai-authenticated-user-id', 'forged-administrator');
    await expect(cloudDatabaseForRequest(supplied)).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it('permits generation-free SSR only with verified authentication, not as a grant', async () => {
    expect((await cloudDatabaseForRequest(request(null), false)).principal).toEqual(principal);
    control.access.mockReturnValue(null);
    await expect(cloudDatabaseForRequest(request(null), false)).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['orion_execute_sql', '../users', 'select * from patients', 'orion_patients_list?sql=SELECT', 'query'])('denies unknown/raw-SQL call %s without network', async name => {
    const database = await cloudDatabaseForRequest(request());
    await expect(database.call(name as CloudRpcName, { sql: 'SELECT 1' })).rejects.toMatchObject({ kind: 'unavailable' });
    expect(fetch).not.toHaveBeenCalled();
  });
  it.each(['issuer', 'subject'])('rejects a forged principal %s before accessing assignments', async field => {
    const call = vi.fn();
    const repository = new CloudAccessGovernanceRepository({ principal, sessionId, call } as CloudDatabaseContext);
    await expect(repository.listPrincipalAssignments({ ...principal, [field]: 'forged' })).rejects.toMatchObject({ kind: 'forbidden' });
    expect(call).not.toHaveBeenCalled();
  });
});

describe('cloud response runtime validators', () => {
  it('accepts the exact scoped access and patient response contracts', () => {
    expect(parseCloudAccessOverview(overview()).assignments).toHaveLength(1);
    expect(parseCloudPatientList({ patients: [patient()], page: endPage, accessAssignmentId: 'assignment-a', observedAt: 1 }, 'assignment-a')).toHaveLength(1);
    expect(parseCloudPatientDetail({ patient: patientDetail(), accessAssignmentId: 'assignment-a', observedAt: 1 }, 'assignment-a', 'patient-a')?.id).toBe('patient-a');
  });
  it('rejects identity inconsistencies and repeated assignments', () => {
    const value = overview();
    expect(() => parseCloudAccessOverview({ ...value, assignments: [...value.assignments, ...value.assignments] })).toThrow();
    expect(() => parseCloudAccessOverview({ ...value, user: { ...value.user, id: 'other-staff' } })).toThrow();
    expect(() => parseCloudAccessOverview({ ...value, user: { ...value.user, displayName: 'Other employee' } })).toThrow();
  });
  it('recomputes grants, rejects unknown roles and does not combine permission fragments', () => {
    const value = overview();
    const invalid = [
      { ...assignment(), roles: ['auditor'], effectivePermissions: ['access.self.read', 'audit.read', 'patient.profile.write'] },
      { ...assignment(), roles: ['superuser'] },
      { ...assignment(), denyPermissions: ['patient.profile.write'] },
      { ...assignment(), effectivePermissions: [...assignment().effectivePermissions, 'raw.sql.execute'] },
    ];
    for (const item of invalid) expect(() => parseCloudAccessOverview({ ...value, assignments: [item] })).toThrow();
  });
  it('rejects mixed scopes, duplicate patients, extra fields and unscoped photo URLs', () => {
    const value = { patients: [patient()], page: endPage, accessAssignmentId: 'assignment-a', observedAt: 1 };
    expect(() => parseCloudPatientList(value, 'assignment-b')).toThrow();
    expect(() => parseCloudPatientList({ ...value, patients: [patient(), patient()] }, 'assignment-a')).toThrow();
    expect(() => parseCloudPatientList({ ...value, secret: 'synthetic' }, 'assignment-a')).toThrow();
    expect(() => parseCloudPatientList({ ...value, patients: [{ ...patient(), photoUrl: 'https://unscoped.invalid/patient.png' }] }, 'assignment-a')).toThrow();
  });
  it('rejects a different patient identity and mutation-only metadata in a read response', () => {
    const value = { patient: patientDetail(), accessAssignmentId: 'assignment-a', observedAt: 1 };
    expect(() => parseCloudPatientDetail(value, 'assignment-b', 'patient-a')).toThrow();
    expect(() => parseCloudPatientDetail(value, 'assignment-a', 'patient-b')).toThrow();
    expect(() => parseCloudPatientDetail({ ...value, replayed: false }, 'assignment-a', 'patient-a')).toThrow();
  });
  it('validates both committed and replayed mutation wrappers without loosening read responses', () => {
    const value = { patient: patientDetail(), accessAssignmentId: 'assignment-a', observedAt: 1 };
    for (const replayed of [false, true]) expect(parseCloudPatientMutation({ ...value, replayed }, 'assignment-a', 'patient-a').id).toBe('patient-a');
    expect(() => parseCloudPatientMutation(value, 'assignment-a', 'patient-a')).toThrow();
    expect(() => parseCloudPatientMutation({ ...value, replayed: 'true' }, 'assignment-a', 'patient-a')).toThrow();
    expect(() => parseCloudPatientMutation({ ...value, replayed: true }, 'assignment-b', 'patient-a')).toThrow();
    expect(() => parseCloudPatientMutation({ ...value, replayed: true }, 'assignment-a', 'patient-b')).toThrow();
  });
});

function browserFence(cookie = `${cloudGenerationCookie}=${generation}`) {
  const transport = vi.fn().mockResolvedValue(Response.json({ synthetic: true }));
  const replace = vi.fn();
  const documentFixture = { cookie, visibilityState: 'visible', documentElement: { style: { visibility: '' } } };
  const windowFixture = { fetch: transport, location: { href: 'https://orion.invalid/patients', origin: 'https://orion.invalid', replace, reload: vi.fn() },
    setInterval: vi.fn().mockReturnValue(1), clearInterval: vi.fn(), addEventListener: vi.fn(), removeEventListener: vi.fn() };
  vi.stubGlobal('window', windowFixture); vi.stubGlobal('document', documentFixture);
  expect(CloudAccountBoundary({ generation, children: 'synthetic children' })).toBe('synthetic children');
  const cleanup = control.effect?.();
  return { windowFixture, documentFixture, transport, replace, cleanup };
}

describe('cloud account stale-tab client fence', () => {
  it('unloads the document before accepting a different SSR generation on rerender', () => {
    const fixture = browserFence();
    fixture.cleanup?.();
    const nextGeneration = 'f'.repeat(32);
    fixture.documentFixture.cookie = `${cloudGenerationCookie}=${nextGeneration}`;
    control.refIndex = 0;
    CloudAccountBoundary({ generation: nextGeneration, children: 'new account children' });
    control.effect?.();
    expect(fixture.documentFixture.documentElement.style.visibility).toBe('hidden');
    expect(fixture.replace).toHaveBeenCalledOnce();
    expect(fixture.replace).toHaveBeenCalledWith('/sign-in');
    expect(fixture.transport).not.toHaveBeenCalled();
    // A further SSR rerender must not reset the already-invalidated document.
    control.refIndex = 0;
    CloudAccountBoundary({ generation, children: 'old account children' });
    const cleanup = control.effect?.();
    expect(fixture.replace).toHaveBeenCalledOnce();
    expect(fixture.documentFixture.documentElement.style.visibility).toBe('hidden');
    cleanup?.();
  });
  it('does not leave the old account active when SSR authentication disappears', () => {
    const fixture = browserFence();
    fixture.cleanup?.();
    control.refIndex = 0;
    CloudAccountBoundary({ generation: null, children: 'signed-out children' });
    control.effect?.();
    expect(fixture.replace).toHaveBeenCalledWith('/sign-in');
    expect(fixture.documentFixture.documentElement.style.visibility).toBe('hidden');
    expect(fixture.transport).not.toHaveBeenCalled();
  });
  it.each(['', `${cloudGenerationCookie}=${'f'.repeat(32)}`, `${cloudGenerationCookie}=${generation}; ${cloudGenerationCookie}=${generation}`])('hides and unloads stale account state before API reuse', cookie => {
    const fixture = browserFence(cookie);
    expect(fixture.documentFixture.documentElement.style.visibility).toBe('hidden');
    expect(fixture.replace).toHaveBeenCalledWith('/sign-in');
    expect(fixture.transport).not.toHaveBeenCalled();
    fixture.cleanup?.();
  });
  it('sets the SSR generation on same-origin APIs, overriding a forged caller header', async () => {
    const fixture = browserFence();
    await fixture.windowFixture.fetch('/api/patients', { headers: { [cloudGenerationHeader]: 'forged' } });
    expect(new Headers(fixture.transport.mock.calls[0][1].headers).get(cloudGenerationHeader)).toBe(generation);
    fixture.cleanup?.();
  });
  it('refuses stale API traffic without network, including after a cookie change', async () => {
    const fixture = browserFence();
    fixture.documentFixture.cookie = `${cloudGenerationCookie}=${'f'.repeat(32)}`;
    await expect(fixture.windowFixture.fetch('/api/patients')).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.transport).not.toHaveBeenCalled();
    expect(fixture.replace).toHaveBeenCalledWith('/sign-in');
    fixture.cleanup?.();
  });
  it('discards a response that arrives after the account generation changed', async () => {
    const fixture = browserFence();
    let resolveResponse: ((response: Response) => void) | undefined;
    fixture.transport.mockImplementationOnce(() => new Promise<Response>(resolve => { resolveResponse = resolve; }));
    const pending = fixture.windowFixture.fetch('/api/patients');
    fixture.documentFixture.cookie = `${cloudGenerationCookie}=${'f'.repeat(32)}`;
    resolveResponse?.(Response.json({ synthetic: true }));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(fixture.documentFixture.documentElement.style.visibility).toBe('hidden');
    fixture.cleanup?.();
  });
  it('treats SESSION_CHANGED as an account invalidation, not an ordinary record conflict', async () => {
    const fixture = browserFence();
    fixture.transport.mockResolvedValueOnce(Response.json({ error: { code: 'SESSION_CHANGED' } }, { status: 409 }));
    await fixture.windowFixture.fetch('/api/patients');
    expect(fixture.replace).toHaveBeenCalledWith('/sign-in');
    fixture.cleanup?.();
  });
  it('does not attach generation to another origin or non-API content', async () => {
    const fixture = browserFence();
    await fixture.windowFixture.fetch('https://other.invalid/api/public');
    await fixture.windowFixture.fetch('/favicon.svg');
    expect(fixture.transport.mock.calls[0][1]).toBeUndefined();
    expect(fixture.transport.mock.calls[1][1]).toBeUndefined();
    fixture.cleanup?.();
  });
  it('rejects malformed and repeated generation cookies without treating them as authority', () => {
    expect(readCloudGenerationCookie(`${cloudGenerationCookie}=${generation}`)).toBe(generation);
    expect(readCloudGenerationCookie(`${cloudGenerationCookie}=${sessionId}`)).toBeNull();
    expect(readCloudGenerationCookie(`${cloudGenerationCookie}=${generation};${cloudGenerationCookie}=${generation}`)).toBeNull();
  });
});
