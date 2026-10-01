import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PATCH as update } from '@/app/api/patients/[patientId]/route';
import { POST as archive } from '@/app/api/patients/[patientId]/archive/route';
import { callCloudRpc } from './supabase-rpc.server';
import { parseSupabaseCloudConfig } from './supabase-config.server';

const control = vi.hoisted(() => ({ access: vi.fn(), transport: vi.fn() }));
vi.mock('./patient-api.server', async importOriginal => ({
  ...await importOriginal<typeof import('./patient-api.server')>(), cloudPatientAccess: control.access,
}));

const origin = 'https://orion.example.invalid';
const projectRef = 'a'.repeat(20);
const source = { ORION_SUPABASE_PROJECT_REF: projectRef, ORION_SUPABASE_URL: `https://${projectRef}.supabase.co`,
  ORION_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'b'.repeat(24)}`, ORION_CLOUD_PUBLIC_ORIGIN: origin,
  ORION_SYNTHETIC_DATA_ONLY: 'true' };
const config = parseSupabaseCloudConfig(source);
const params = { params: Promise.resolve({ patientId: 'patient-a' }) };
const payload = { facilityId: 'facility-a', accessAssignmentId: 'assignment-a', displayName: 'Synthetic Patient',
  birthDate: null, sexAtBirth: 'not_recorded', phone: null, email: null, address: null,
  changeReason: 'Synthetic acceptance correction', testDataAcknowledged: true, expectedVersion: 1,
  idempotencyKey: '11111111-1111-4111-8111-111111111111' };
function request(operation: 'update' | 'archive') {
  return new Request(`${origin}/api/patients/patient-a${operation === 'archive' ? '/archive' : ''}`, {
    method: operation === 'archive' ? 'POST' : 'PATCH',
    headers: { Origin: origin, 'Sec-Fetch-Site': 'same-origin', 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

beforeEach(() => {
  Object.entries(source).forEach(([name, value]) => vi.stubEnv(name, value));
  control.transport.mockReset();
  control.access.mockReset().mockResolvedValue({ database: { call: (name: Parameters<typeof callCloudRpc>[0]['name'], args: Record<string, unknown>) =>
    callCloudRpc({ config, accessToken: 'synthetic.payload.signature', name, args, fetch: control.transport }) },
  access: { assignment: { assignmentId: 'assignment-a' }, facility: { id: 'facility-a' } } });
});
afterEach(() => vi.unstubAllEnvs());

describe('cloud patient mutation rejection recovery', () => {
  it.each([
    ['update', 409, 'PATIENT_VERSION_CONFLICT'],
    ['archive', 409, 'PATIENT_VERSION_CONFLICT'],
    ['update', 409, 'PATIENT_PROFILE_NOT_ACTIVE'],
    ['update', 422, 'PATIENT_PROFILE_UNCHANGED'],
    ['archive', 422, 'PATIENT_ALREADY_ARCHIVED'],
  ] as const)('returns a recoverable %s rejection %s %s without provider details', async (operation, status, code) => {
    control.transport.mockResolvedValueOnce(Response.json({ code: `PT${status}`, message: code,
      details: 'private provider content', hint: 'private provider hint' }, { status }));
    const response = await (operation === 'archive' ? archive : update)(request(operation), params);
    expect(response.status).toBe(status);
    const result = await response.text();
    expect(JSON.parse(result)).toMatchObject({ error: { code, requestId: expect.any(String) } });
    expect(result).not.toContain('private');
    expect(result).not.toContain('synthetic.payload.signature');
    expect(result).not.toContain('sb_publishable_');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(control.access).toHaveBeenCalledWith(expect.any(Request), 'patient.profile.write', 'assignment-a', 'facility-a');
  });
  it.each([409, 422, 503])('redacts unknown provider failures %s', async status => {
    control.transport.mockResolvedValueOnce(Response.json({ code: `PT${status}`, message: 'private provider content', details: 'private row' }, { status }));
    const response = await update(request('update'), params);
    expect(response.status).toBe(status === 422 ? 400 : status);
    const result = await response.text();
    expect(result).not.toContain('private');
    expect(result).not.toContain('synthetic.payload.signature');
    expect(result).not.toContain('sb_publishable_');
  });
});
