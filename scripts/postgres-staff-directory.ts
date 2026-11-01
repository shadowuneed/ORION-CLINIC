import { Pool, type PoolClient, type QueryResult } from 'pg';
import type { CrmPostgresConfig } from './crm-postgres-repository.ts';
import type { LocalAccountAuthority, LocalStaffDirectoryProvider, StaffRow } from './local-account-store.ts';

type PoolPort = { connect(): Promise<PoolClient>; end(): Promise<void> };
export type PostgresDirectoryMode = { source: 'legacy_d1' | 'postgres'; revision: number; importComplete: boolean };
export type PostgresStaffDirectory = LocalStaffDirectoryProvider & { mode(): Promise<PostgresDirectoryMode>; close(): Promise<void> };
export class StaffDirectoryUnavailableError extends Error {
  constructor() { super('STAFF_DIRECTORY_UNAVAILABLE'); }
}

function parseMode(value: unknown): PostgresDirectoryMode {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new StaffDirectoryUnavailableError();
  const mode = value as Record<string, unknown>;
  if ((mode.source !== 'legacy_d1' && mode.source !== 'postgres') || typeof mode.importComplete !== 'boolean' ||
    typeof mode.revision !== 'number' || !Number.isSafeInteger(mode.revision) || mode.revision < 1 ||
    (mode.source === 'postgres' && !mode.importComplete)) throw new StaffDirectoryUnavailableError();
  return { source: mode.source, revision: mode.revision, importComplete: mode.importComplete };
}

/** Both persistent authorities must agree before startup can select a directory.
 * A missing, restored, or partially switched fence must never silently select D1.
 */
export function assertDirectoryAuthority(value: unknown, privateAuthority: LocalAccountAuthority): void {
  const mode = parseMode(value);
  if ((mode.source === 'legacy_d1' && privateAuthority === 'legacy_d1') ||
    (mode.source === 'postgres' && privateAuthority === 'postgresql' && mode.importComplete)) return;
  throw new StaffDirectoryUnavailableError();
}

/** Trusted-server-only authentication directory, never an HTTP endpoint.
 * Mode and principals come from PG; no input can choose a different database.
 */
export function createPostgresStaffDirectory(config: CrmPostgresConfig, suppliedPool?: PoolPort): PostgresStaffDirectory {
  if (typeof window !== 'undefined') throw new StaffDirectoryUnavailableError();
  if (config.host !== '127.0.0.1' || config.port !== 55432 || config.database !== 'orion_crm_local' || config.user !== 'orion_crm_app' ||
    typeof config.password !== 'string' || config.password.length < 16 || config.password.length > 256 || /[\r\n\0]/.test(config.password)) throw new StaffDirectoryUnavailableError();
  const { password } = config;
  const pool = suppliedPool ?? new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'orion_crm_app', password,
    ssl: false, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, query_timeout: 5000,
    statement_timeout: 4000, lock_timeout: 1500, idle_in_transaction_session_timeout: 7000, application_name: 'orion-local-identity' });
  if (pool instanceof Pool) pool.on('error', () => { /* Never emit credential-bearing driver errors. */ });
  async function run<T>(read: (client: PoolClient) => Promise<T>): Promise<T> {
    let client: PoolClient | undefined; let begun = false;
    try {
      client = await pool.connect(); await client.query('BEGIN READ ONLY'); begun = true;
      const result = await read(client);
      await client.query('COMMIT'); begun = false;
      return result;
    } catch {
      if (client && begun) await client.query('ROLLBACK').catch(() => undefined);
      throw new StaffDirectoryUnavailableError();
    } finally { client?.release(); }
  }
  async function readMode(client: PoolClient) {
    const result: QueryResult = await client.query('SELECT public.orion_directory_mode_v1() AS result');
    return parseMode(result.rows[0]?.result);
  }
  return {
    source: 'postgresql',
    mode: () => run(readMode),
    loadStaff: () => run(async client => {
      const mode = await readMode(client);
      if (mode.source !== 'postgres' || !mode.importComplete) throw new StaffDirectoryUnavailableError();
      const result: QueryResult = await client.query('SELECT public.orion_directory_principals_v1() AS result');
      if (!Array.isArray(result.rows[0]?.result)) throw new StaffDirectoryUnavailableError();
      // Store boundary validates exact IDs and rejects ambiguous identities.
      return result.rows[0].result as StaffRow[];
    }),
    close: () => pool.end(),
  };
}
