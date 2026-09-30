// No client import: this module is a server configuration boundary, not a props object.
if (typeof window !== 'undefined') throw new Error('Cloud configuration is server-only.');

export type SupabaseCloudConfig = Readonly<{
  projectRef: string;
  origin: string;
  publishableKey: string;
  issuer: string;
}>;

export class CloudConfigurationError extends Error {
  constructor() {
    super('ORION cloud configuration is missing or invalid.');
    this.name = 'CloudConfigurationError';
  }
}

// An exact dedicated project prevents accidental reuse of another application.
// Passwords, database URLs and elevated API keys are intentionally not accepted here.
export function parseSupabaseCloudConfig(source: Record<string, unknown>): SupabaseCloudConfig {
  const ref = source.ORION_SUPABASE_PROJECT_REF;
  const value = source.ORION_SUPABASE_URL;
  const key = source.ORION_SUPABASE_PUBLISHABLE_KEY;
  if (typeof ref !== 'string' || !/^[a-z]{20}$/.test(ref) || typeof value !== 'string' ||
    typeof key !== 'string' || !/^sb_publishable_[A-Za-z0-9_-]{16,256}$/.test(key)) {
    throw new CloudConfigurationError();
  }
  let url: URL;
  try { url = new URL(value); } catch { throw new CloudConfigurationError(); }
  if (url.protocol !== 'https:' || url.hostname !== `${ref}.supabase.co` || url.port ||
    url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new CloudConfigurationError();
  }
  return Object.freeze({ projectRef: ref, origin: url.origin, publishableKey: key, issuer: `${url.origin}/auth/v1` });
}
