import { parseSupabaseCloudConfig, type SupabaseCloudConfig } from './supabase-config.server';

if (typeof window !== 'undefined') throw new Error('Cloud RPC is server-only.');

export const cloudRpcNames = [
  'orion_access_overview', 'orion_patients_list', 'orion_patient_detail',
  'orion_patient_create', 'orion_patient_update', 'orion_patient_archive',
  'orion_patient_history_page',
] as const;
export type CloudRpcName = typeof cloudRpcNames[number];
export type CloudPatientRejection = 'PATIENT_VERSION_CONFLICT' | 'PATIENT_PROFILE_NOT_ACTIVE' |
  'PATIENT_PROFILE_UNCHANGED' | 'PATIENT_ALREADY_ARCHIVED';

export class CloudRpcError extends Error {
  constructor(readonly kind: 'unauthenticated' | 'forbidden' | 'conflict' | 'invalid' | 'unavailable',
    readonly patientRejection?: CloudPatientRejection) {
    super('The cloud database request could not be completed.');
    this.name = 'CloudRpcError';
  }
}

async function boundedJson(response: Response, maxBytes = 1_048_576): Promise<unknown> {
  const length = response.headers.get('content-length');
  if (!/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') ||
      (length !== null && (!/^\d+$/.test(length) || Number(length) > maxBytes)) || !response.body) {
    throw new CloudRpcError('unavailable');
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new CloudRpcError('unavailable');
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new CloudRpcError('unavailable');
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes)); }
  catch { throw new CloudRpcError('unavailable'); }
}

/** Only exact reviewed SQL rejections, never upstream details or arbitrary text. */
async function patientRejection(response: Response, name: CloudRpcName): Promise<CloudPatientRejection | undefined> {
  if (name !== 'orion_patient_update' && name !== 'orion_patient_archive') return undefined;
  try {
    const body = await boundedJson(response, 4_096);
    if (!body || typeof body !== 'object' || Array.isArray(body)) return undefined;
    const value = body as Record<string, unknown>;
    if (value.code !== `PT${response.status}`) return undefined;
    if (response.status === 409 && (value.message === 'PATIENT_VERSION_CONFLICT' || value.message === 'PATIENT_PROFILE_NOT_ACTIVE')) {
      return value.message;
    }
    if (response.status === 422 && name === 'orion_patient_update' && value.message === 'PATIENT_PROFILE_UNCHANGED') {
      return value.message;
    }
    if (response.status === 422 && name === 'orion_patient_archive' && value.message === 'PATIENT_ALREADY_ARCHIVED') {
      return value.message;
    }
  } catch {
    // Malformed/oversized/private provider errors keep only their generic status.
    await response.body?.cancel().catch(() => undefined);
  }
  return undefined;
}

/**
 * Only typed, reviewed RPCs; no arbitrary SQL, service key or table access.
 * Supabase verifies the bearer and each SQL function rechecks its active session,
 * internal staff and selected assignment. Caller metadata is not authority.
 */
export async function callCloudRpc(input: {
  config: SupabaseCloudConfig;
  accessToken: string;
  name: CloudRpcName;
  args?: Record<string, unknown>;
  signal?: AbortSignal;
  fetch?: typeof fetch;
}): Promise<unknown> {
  const config = parseSupabaseCloudConfig({
    ORION_SUPABASE_PROJECT_REF: input.config.projectRef,
    ORION_SUPABASE_URL: input.config.origin,
    ORION_SUPABASE_PUBLISHABLE_KEY: input.config.publishableKey,
  });
  if (!(cloudRpcNames as readonly string[]).includes(input.name)) throw new CloudRpcError('unavailable');
  if (typeof input.accessToken !== 'string' || input.accessToken.length > 8_192 ||
      !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(input.accessToken)) {
    throw new CloudRpcError('unauthenticated');
  }
  let body: string;
  try { body = JSON.stringify(input.args ?? {}); } catch { throw new CloudRpcError('unavailable'); }
  if (new TextEncoder().encode(body).byteLength > 65_536) throw new CloudRpcError('unavailable');
  const deadline = AbortSignal.timeout(10_000);
  const signal = input.signal ? AbortSignal.any([input.signal, deadline]) : deadline;
  if (signal.aborted) throw new CloudRpcError('unavailable');
  const url = `${config.origin}/rest/v1/rpc/${input.name}`;
  let response: Response;
  try {
    response = await (input.fetch ?? fetch)(url, {
      method: 'POST', headers: { apikey: config.publishableKey,
        authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
      body, cache: 'no-store', redirect: 'error', signal,
    });
  } catch { throw new CloudRpcError('unavailable'); }
  if (signal.aborted || response.redirected || (response.url && response.url !== url)) throw new CloudRpcError('unavailable');
  if (response.status === 401) throw new CloudRpcError('unauthenticated');
  if (response.status === 403) throw new CloudRpcError('forbidden');
  if (response.status === 409 || response.status === 422) {
    const rejection = await patientRejection(response, input.name);
    if (signal.aborted) throw new CloudRpcError('unavailable');
    throw new CloudRpcError(response.status === 409 ? 'conflict' : 'invalid', rejection);
  }
  if (response.status === 400) throw new CloudRpcError('invalid');
  if (!response.ok) throw new CloudRpcError('unavailable');
  const result = await boundedJson(response);
  if (signal.aborted) throw new CloudRpcError('unavailable');
  return result;
}
