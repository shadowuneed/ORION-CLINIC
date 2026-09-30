import { parseSupabaseCloudConfig, type SupabaseCloudConfig } from './supabase-config.server';

if (typeof window !== 'undefined') throw new Error('Cloud RPC is server-only.');

export const cloudRpcNames = [
  'orion_access_overview', 'orion_patients_list', 'orion_patient_detail',
  'orion_patient_create', 'orion_patient_update', 'orion_patient_archive',
] as const;
export type CloudRpcName = typeof cloudRpcNames[number];

export class CloudRpcError extends Error {
  constructor(readonly kind: 'unauthenticated' | 'forbidden' | 'conflict' | 'unavailable') {
    super('The cloud database request could not be completed.');
    this.name = 'CloudRpcError';
  }
}

async function boundedJson(response: Response): Promise<unknown> {
  const maxBytes = 1_048_576;
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
  if (response.status === 409) throw new CloudRpcError('conflict');
  if (!response.ok) throw new CloudRpcError('unavailable');
  const result = await boundedJson(response);
  if (signal.aborted) throw new CloudRpcError('unavailable');
  return result;
}
