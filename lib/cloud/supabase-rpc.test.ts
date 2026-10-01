import { describe, expect, it, vi } from 'vitest';
import { callCloudRpc, CloudRpcError, type CloudRpcName } from './supabase-rpc.server';
import { parseSupabaseCloudConfig } from './supabase-config.server';

const config = parseSupabaseCloudConfig({ ORION_SUPABASE_PROJECT_REF: 'a'.repeat(20),
  ORION_SUPABASE_URL: `https://${'a'.repeat(20)}.supabase.co`, ORION_SUPABASE_PUBLISHABLE_KEY: `sb_publishable_${'b'.repeat(24)}` });
const accessToken = 'synthetic.payload.signature';
const ok = () => Response.json({ assignments: [], observedAt: 1 });

describe('typed Supabase server RPC transport', () => {
  it('uses exact dedicated project and bearer with no redirects or cache', async () => {
    const transport = vi.fn().mockResolvedValue(ok());
    expect(await callCloudRpc({ config, accessToken, name: 'orion_access_overview', fetch: transport })).toEqual({ assignments: [], observedAt: 1 });
    const [url, init] = transport.mock.calls[0];
    expect(url).toBe(`${config.origin}/rest/v1/rpc/orion_access_overview`);
    expect(init).toMatchObject({ method: 'POST', body: '{}', cache: 'no-store', redirect: 'error',
      headers: { apikey: config.publishableKey, authorization: `Bearer ${accessToken}` } });
  });
  it.each(['', 'not-a-jwt', 'a'.repeat(8_193)])('rejects invalid token without network', async (token) => {
    const transport = vi.fn();
    await expect(callCloudRpc({ config, accessToken: token, name: 'orion_patients_list', fetch: transport })).rejects.toMatchObject({ kind: 'unauthenticated' });
    expect(transport).not.toHaveBeenCalled();
  });
  it('rejects unknown RPC and oversized payload before network', async () => {
    const transport = vi.fn();
    await expect(callCloudRpc({ config, accessToken, name: '../tables' as CloudRpcName, fetch: transport })).rejects.toBeInstanceOf(CloudRpcError);
    await expect(callCloudRpc({ config, accessToken, name: 'orion_patients_list', args: { query: 'x'.repeat(70_000) }, fetch: transport })).rejects.toBeInstanceOf(CloudRpcError);
    expect(transport).not.toHaveBeenCalled();
  });
  it.each([[401, 'unauthenticated'], [403, 'forbidden'], [409, 'conflict'], [400, 'invalid'], [422, 'invalid'], [500, 'unavailable']])(
    'redacts upstream failure %s', async (status, kind) => {
      const transport = vi.fn().mockResolvedValue(new Response('private upstream content', { status: status as number }));
      await expect(callCloudRpc({ config, accessToken, name: 'orion_access_overview', fetch: transport })).rejects.toMatchObject({ kind, message: 'The cloud database request could not be completed.' });
    },
  );
  it.each([
    ['orion_patient_update', 409, 'PATIENT_VERSION_CONFLICT', 'conflict'],
    ['orion_patient_archive', 409, 'PATIENT_VERSION_CONFLICT', 'conflict'],
    ['orion_patient_update', 409, 'PATIENT_PROFILE_NOT_ACTIVE', 'conflict'],
    ['orion_patient_update', 422, 'PATIENT_PROFILE_UNCHANGED', 'invalid'],
    ['orion_patient_archive', 422, 'PATIENT_ALREADY_ARCHIVED', 'invalid'],
  ] as const)('preserves only the reviewed rejection for %s %s %s', async (name, status, rejection, kind) => {
    const transport = vi.fn().mockResolvedValue(Response.json({ code: `PT${status}`, message: rejection,
      details: 'private provider content', hint: 'private provider hint' }, { status }));
    let failure: unknown;
    try { await callCloudRpc({ config, accessToken, name, fetch: transport }); } catch (error) { failure = error; }
    expect(failure).toMatchObject({ kind, patientRejection: rejection });
    expect(String(failure)).not.toContain('private');
    expect(JSON.stringify(failure)).not.toContain('private');
  });
  it.each([
    ['orion_patient_create', 409, 'PT409', 'PATIENT_VERSION_CONFLICT'],
    ['orion_access_overview', 409, 'PT409', 'PATIENT_VERSION_CONFLICT'],
    ['orion_patient_update', 409, '23505', 'PATIENT_VERSION_CONFLICT'],
    ['orion_patient_update', 409, 'PT422', 'PATIENT_VERSION_CONFLICT'],
    ['orion_patient_update', 409, 'PT409', 'PATIENT_COMMAND_CONFLICT'],
    ['orion_patient_update', 422, 'PT422', 'PATIENT_ALREADY_ARCHIVED'],
    ['orion_patient_archive', 422, 'PT422', 'PATIENT_PROFILE_UNCHANGED'],
    ['orion_patient_update', 422, 'PT422', 'private error content'],
  ] as const)('does not classify foreign or mismatched provider messages for %s %s', async (name, status, code, message) => {
    const transport = vi.fn().mockResolvedValue(Response.json({ code, message }, { status }));
    await expect(callCloudRpc({ config, accessToken, name, fetch: transport })).rejects.toMatchObject({
      kind: status === 409 ? 'conflict' : 'invalid', patientRejection: undefined,
    });
  });
  it.each([
    () => Response.json({ code: 'PT409', message: 'PATIENT_VERSION_CONFLICT', details: 'x'.repeat(4_096) }, { status: 409 }),
    () => new Response('{broken', { status: 409, headers: { 'Content-Type': 'application/json' } }),
    () => new Response(new Uint8Array([0xff]), { status: 409, headers: { 'Content-Type': 'application/json' } }),
    () => new Response('{}', { status: 409, headers: { 'Content-Type': 'application/json', 'Content-Length': '4097' } }),
    () => Response.json([{ code: 'PT409', message: 'PATIENT_VERSION_CONFLICT' }], { status: 409 }),
  ])('keeps malformed or overlarge rejections generic and private', async makeResponse => {
    await expect(callCloudRpc({ config, accessToken, name: 'orion_patient_update', fetch: vi.fn().mockResolvedValue(makeResponse()) }))
      .rejects.toMatchObject({ kind: 'conflict', patientRejection: undefined });
  });
  it('rejects redirected and wrong-origin responses', async () => {
    for (const property of ['url', 'redirected']) {
      const response = ok();
      Object.defineProperty(response, property, { value: property === 'url' ? 'https://other.example/rpc' : true });
      await expect(callCloudRpc({ config, accessToken, name: 'orion_access_overview', fetch: vi.fn().mockResolvedValue(response) })).rejects.toBeInstanceOf(CloudRpcError);
    }
  });
  it.each([
    () => new Response('{}', { headers: { 'content-type': 'text/html' } }),
    () => new Response('{}', { headers: { 'content-type': 'application/json', 'content-length': '1048577' } }),
    () => new Response('x'.repeat(1_048_577), { headers: { 'content-type': 'application/json' } }),
    () => new Response('{broken', { headers: { 'content-type': 'application/json' } }),
    () => new Response(new Uint8Array([0xff]), { headers: { 'content-type': 'application/json' } }),
  ])('bounds and validates response data', async (makeResponse) => {
    await expect(callCloudRpc({ config, accessToken, name: 'orion_access_overview', fetch: vi.fn().mockResolvedValue(makeResponse()) })).rejects.toBeInstanceOf(CloudRpcError);
  });
  it('honors already-aborted caller without network', async () => {
    const transport = vi.fn();
    await expect(callCloudRpc({ config, accessToken, name: 'orion_access_overview', signal: AbortSignal.abort(), fetch: transport })).rejects.toBeInstanceOf(CloudRpcError);
    expect(transport).not.toHaveBeenCalled();
  });
});
