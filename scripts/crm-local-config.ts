import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export type CrmLocalConfig = { host: '127.0.0.1'; port: 55432; database: 'orion_crm_local'; user: 'orion_crm_app'; password: string };

/** Intentionally no environment override, cloud URL, credentials in source, or fallback DB. */
export function readCrmLocalConfig(): CrmLocalConfig | null {
  const base = process.env.LOCALAPPDATA;
  if (!base) return null;
  const path = join(base, 'ORION-Clinic-CRM', 'runtime.json');
  if (!existsSync(path)) return null;
  const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (!value || typeof value !== 'object') throw new Error('Invalid local CRM configuration');
  const config = value as Record<string, unknown>;
  if (config.host !== '127.0.0.1' || config.port !== 55432 || config.database !== 'orion_crm_local' ||
    config.user !== 'orion_crm_app' || typeof config.password !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(config.password)) {
    throw new Error('Invalid local CRM configuration');
  }
  return config as CrmLocalConfig;
}
