import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import { clinicalActorSchema, type ClinicalActor } from '../lib/clinical/contracts';
import { directoryCommandSchema, directoryCommandResultSchema, directorySnapshotSchema, type DirectoryCommand, type DirectorySnapshot } from '../lib/clinical/directory-contracts';
import type { CrmPostgresConfig } from './crm-postgres-repository';

export type DirectoryCommandResult = z.infer<typeof directoryCommandResultSchema>;
export type DirectoryPostgresRepository = {
  snapshot(actor: ClinicalActor, clinicId: string, revalidate?: () => Promise<void>): Promise<DirectorySnapshot>;
  command(actor: ClinicalActor, command: DirectoryCommand, revalidate?: () => Promise<void>): Promise<DirectoryCommandResult>;
  close(): Promise<void>;
};
export const directoryErrorCodes = new Set(['DIRECTORY_NOT_ACTIVE', 'DIRECTORY_ACCESS_DENIED', 'DIRECTORY_INVALID_COMMAND',
  'DIRECTORY_RESOURCE_NOT_FOUND', 'DIRECTORY_VERSION_CONFLICT', 'DIRECTORY_IDEMPOTENCY_CONFLICT', 'DIRECTORY_INVALID_TRANSITION',
  'DIRECTORY_STAFF_MAPPING_REQUIRED', 'DIRECTORY_MAPPING_CONFLICT', 'DIRECTORY_LAST_ADMIN_REQUIRED']);
export class DirectoryRepositoryError extends Error { constructor(readonly code: string) { super(code); } }
type PoolPort = { connect(): Promise<PoolClient>; end(): Promise<void> };
const clinicSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);

/** Private server entrypoint: no generic SQL, client identity or PG* fallback. */
export function createDirectoryPostgresRepository(config: CrmPostgresConfig, suppliedPool?: PoolPort): DirectoryPostgresRepository {
  if (typeof window !== 'undefined') throw new DirectoryRepositoryError('DIRECTORY_UNAVAILABLE');
  if (config.host !== '127.0.0.1' || config.port !== 55432 || config.database !== 'orion_crm_local' || config.user !== 'orion_crm_app' ||
    typeof config.password !== 'string' || config.password.length < 16 || config.password.length > 256 || /[\r\n\0]/.test(config.password)) throw new DirectoryRepositoryError('DIRECTORY_UNAVAILABLE');
  const { password } = config;
  const pool = suppliedPool ?? new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'orion_crm_app', password,
    ssl: false, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, query_timeout: 8000,
    statement_timeout: 7000, lock_timeout: 2000, idle_in_transaction_session_timeout: 10000, application_name: 'orion-local-directory' });
  if (pool instanceof Pool) pool.on('error', () => { /* Do not emit credential-bearing driver errors. */ });
  async function run<T>(actor: ClinicalActor, sql: string, value: string, schema: z.ZodType<T>, revalidate?: () => Promise<void>): Promise<T> {
    const identity = clinicalActorSchema.parse(actor);
    let client: PoolClient | undefined; let begun = false; let committed = false; let validationFailed = false;
    const check = async () => { try { await revalidate?.(); } catch (error) { validationFailed = true; throw error; } };
    try {
      await check(); client = await pool.connect(); await check();
      // Snapshot writes its access audit, so it also runs in a writable transaction.
      await client.query('BEGIN'); begun = true; await check();
      const response = await client.query(sql, [identity.issuer, identity.subject, value]);
      const result = schema.parse(response.rows[0]?.result); await check();
      await client.query('COMMIT'); committed = true; await check(); return result;
    } catch (error) {
      if (client && begun && !committed) await client.query('ROLLBACK').catch(() => undefined);
      if (validationFailed) throw error;
      const candidate = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
      if (typeof candidate.code === 'string' && /^PT(400|403|404|409|503)$/.test(candidate.code) &&
        typeof candidate.message === 'string' && directoryErrorCodes.has(candidate.message)) throw new DirectoryRepositoryError(candidate.message);
      throw new DirectoryRepositoryError('DIRECTORY_UNAVAILABLE');
    } finally { client?.release(); }
  }
  return {
    snapshot: (actor, clinicId, revalidate) => run(actor, 'SELECT public.orion_directory_snapshot_v1($1::text,$2::text,$3::text) AS result', clinicSchema.parse(clinicId), directorySnapshotSchema, revalidate),
    command: (actor, command, revalidate) => run(actor, 'SELECT public.orion_directory_command_v1($1::text,$2::text,$3::jsonb) AS result', JSON.stringify(directoryCommandSchema.parse(command)), directoryCommandResultSchema, revalidate),
    close: () => pool.end(),
  };
}
