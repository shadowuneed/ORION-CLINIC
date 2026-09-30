import { CloudConfigurationError, parseSupabaseCloudConfig, type SupabaseCloudConfig } from './supabase-config.server';

if (typeof window !== 'undefined') throw new Error('Cloud authentication is server-only.');

export type CloudAuthConfig = Readonly<{ supabase: SupabaseCloudConfig; publicOrigin: string }>;

export function parseCloudAuthConfig(source: Record<string, unknown>): CloudAuthConfig {
  const supabase = parseSupabaseCloudConfig(source);
  const value = source.ORION_CLOUD_PUBLIC_ORIGIN;
  if (typeof value !== 'string') throw new CloudConfigurationError();
  let url: URL;
  try { url = new URL(value); } catch { throw new CloudConfigurationError(); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.pathname !== '/' ||
    url.search || url.hash || url.hostname === 'localhost' || /^[\d.]+$/.test(url.hostname) || url.hostname.includes(':')) {
    throw new CloudConfigurationError();
  }
  return Object.freeze({ supabase, publicOrigin: url.origin });
}
