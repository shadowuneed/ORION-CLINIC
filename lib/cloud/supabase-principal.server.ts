import type { IdentityPrincipal } from '@/lib/auth/workspace-access';
import { CloudConfigurationError, parseSupabaseCloudConfig, type SupabaseCloudConfig } from './supabase-config.server';

if (typeof window !== 'undefined') throw new Error('Cloud identity verification is server-only.');

const MAX_USER_BYTES = 16_384;
const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;

export class CloudIdentityUnavailableError extends Error {
  constructor() {
    super('Cloud identity verification is temporarily unavailable.');
    this.name = 'CloudIdentityUnavailableError';
  }
}

async function readBoundedUser(response: Response): Promise<unknown> {
  const length = response.headers.get('content-length');
  if ((length && (!/^\d+$/.test(length) || Number(length) > MAX_USER_BYTES)) ||
    !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) {
    throw new CloudIdentityUnavailableError();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_USER_BYTES) throw new CloudIdentityUnavailableError();
      chunks.push(value);
    }
  } catch {
    await reader.cancel().catch(() => undefined);
    throw new CloudIdentityUnavailableError();
  } finally { reader.releaseLock(); }
  const body = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength; }
  try { return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(body)); }
  catch { throw new CloudIdentityUnavailableError(); }
}

// Not mounted until the PostgreSQL assignment resolver and session boundary are ready.
// An authenticated subject is NOT a clinician, membership, permission or patient scope.
export async function verifySupabasePrincipal(config: SupabaseCloudConfig, accessToken: string | null,
  options: { fetch?: typeof fetch; signal?: AbortSignal } = {}): Promise<IdentityPrincipal | null> {
  // Revalidate even injected configurations; a caller cannot select an arbitrary token destination.
  try {
    config = parseSupabaseCloudConfig({ ORION_SUPABASE_PROJECT_REF: config.projectRef,
      ORION_SUPABASE_URL: config.origin, ORION_SUPABASE_PUBLISHABLE_KEY: config.publishableKey });
  } catch (error) {
    if (error instanceof CloudConfigurationError) throw error;
    throw new CloudConfigurationError();
  }
  if (!accessToken || accessToken.length > 8_192 || !/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(accessToken)) return null;
  const deadline = AbortSignal.timeout(5_000);
  const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
  if (signal.aborted) throw new CloudIdentityUnavailableError();
  let response: Response;
  try {
    response = await (options.fetch ?? fetch)(`${config.origin}/auth/v1/user`, {
      method: 'GET', headers: { apikey: config.publishableKey, authorization: `Bearer ${accessToken}` },
      cache: 'no-store', redirect: 'error', signal,
    });
  } catch { throw new CloudIdentityUnavailableError(); }
  if (signal.aborted || response.redirected || (response.url && response.url !== `${config.origin}/auth/v1/user`)) {
    throw new CloudIdentityUnavailableError();
  }
  if (response.status === 401 || response.status === 403) return null;
  if (!response.ok) throw new CloudIdentityUnavailableError();
  const user = await readBoundedUser(response);
  if (signal.aborted || !user || typeof user !== 'object' || Array.isArray(user)) throw new CloudIdentityUnavailableError();
  const candidate = user as Record<string, unknown>;
  if (typeof candidate.id !== 'string' || !UUID.test(candidate.id) || candidate.role !== 'authenticated' ||
    candidate.is_anonymous !== false || !(candidate.email === null || typeof candidate.email === 'string')) {
    throw new CloudIdentityUnavailableError();
  }
  if (typeof candidate.email === 'string' && candidate.email.length > 320) throw new CloudIdentityUnavailableError();
  return Object.freeze({ issuer: config.issuer, subject: candidate.id, email: candidate.email as string | null });
}
