import { Pool, type PoolClient, type QueryResult } from 'pg';
import { z } from 'zod';
import { clinicalActorSchema, clinicalInternalCommandSchema, clinicalCommandResultSchema, clinicalSnapshotSchema,
  type ClinicalActor, type ClinicalInternalCommand, type ClinicalCommandResult, type ClinicalSnapshot } from '../lib/clinical/contracts';
import type { CrmPostgresConfig } from './crm-postgres-repository';

export type ClinicalPostgresRepository = {
  snapshot(actor: ClinicalActor, revalidate?: () => Promise<void>): Promise<ClinicalSnapshot>;
  patient(actor: ClinicalActor, patientId: string, revalidate?: () => Promise<void>): Promise<ClinicalSnapshot>;
  command(actor: ClinicalActor, command: ClinicalInternalCommand, revalidate?: () => Promise<void>): Promise<ClinicalCommandResult>;
  close(): Promise<void>;
};
const errors = new Set(['CLINICAL_ACCESS_DENIED','CLINICAL_RESOURCE_NOT_FOUND','CLINICAL_VERSION_CONFLICT','CLINICAL_IDEMPOTENCY_CONFLICT',
  'CLINICAL_INVALID_TRANSITION','CLINICAL_INVALID_COMMAND','CLINICAL_REVIEW_REQUIRED','CLINICAL_CONSENT_REQUIRED','CLINICAL_SNAPSHOT_LIMIT','CLINICAL_CAPACITY_CONFLICT','CLINICAL_QUEUE_ORDER_CONFLICT']);
export class ClinicalRepositoryError extends Error { constructor(readonly code: string) { super(code); } }
type PoolPort = { connect(): Promise<PoolClient>; end(): Promise<void> };

/** Explicit trusted-server boundary; never consume PG* or browser-supplied URLs. */
export function createClinicalPostgresRepository(config: CrmPostgresConfig, suppliedPool?: PoolPort): ClinicalPostgresRepository {
  if (typeof window !== 'undefined') throw new Error('Server-only clinical repository');
  if (config.host!=='127.0.0.1' || config.port!==55432 || config.database!=='orion_crm_local' || config.user!=='orion_crm_app' ||
    typeof config.password!=='string' || config.password.length<16 || config.password.length>256 || /[\r\n\0]/.test(config.password)) throw new Error('Invalid dedicated local clinical configuration');
  const { password } = config;
  const pool = suppliedPool ?? new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'orion_crm_app', password,
    ssl: false, max: 4, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, query_timeout: 8000,
    statement_timeout: 7000, lock_timeout: 2000, idle_in_transaction_session_timeout: 10000, application_name: 'orion-clinical-local' });
  if (pool instanceof Pool) pool.on('error', () => { /* Never disclose connection strings in request logs. */ });
  async function run<T>(actor: ClinicalActor, query: string, extra: unknown[], schema: z.ZodType<T>, revalidate?: () => Promise<void>): Promise<T> {
    const safeActor = clinicalActorSchema.parse(actor);
    let client: PoolClient | undefined; let begun = false; let committed = false;
    // Revalidation exceptions intentionally remain SESSION_CHANGED to the HTTP boundary.
    let validationFailed = false;
    const check = async () => { try { await revalidate?.(); } catch(error) { validationFailed=true; throw error; } };
    try {
      await check(); client = await pool.connect(); await check();
      await client.query('BEGIN'); begun=true; await check();
      const response: QueryResult = await client.query(query,[safeActor.issuer,safeActor.subject,...extra]);
      const data = schema.parse(response.rows[0]?.result); await check();
      await client.query('COMMIT'); committed=true; await check(); return data;
    } catch (error) {
      if (client && begun && !committed) await client.query('ROLLBACK').catch(()=>undefined);
      if (validationFailed) throw error;
      const candidate = error && typeof error==='object' ? error as {code?:unknown;message?:unknown} : {};
      if (typeof candidate.code==='string' && /^PT(400|403|404|409|503)$/.test(candidate.code) && typeof candidate.message==='string' && errors.has(candidate.message)) throw new ClinicalRepositoryError(candidate.message);
      throw new ClinicalRepositoryError('CLINICAL_UNAVAILABLE');
    } finally { client?.release(); }
  }
  return {
    snapshot: (actor,revalidate) => run(actor,'SELECT public.orion_clinical_snapshot_v1($1::text,$2::text,NULL::text) AS result',[],clinicalSnapshotSchema,revalidate),
    patient: (actor,patientId,revalidate) => {
      const safeId=z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/).parse(patientId);
      return run(actor,'SELECT public.orion_clinical_snapshot_v1($1::text,$2::text,$3::text) AS result',[safeId],clinicalSnapshotSchema,revalidate);
    },
    command: (actor,body,revalidate) => {
      const command=clinicalInternalCommandSchema.parse(body);
      return run(actor,'SELECT public.orion_clinical_command_v1($1::text,$2::text,$3::jsonb) AS result',[JSON.stringify(command)],clinicalCommandResultSchema,revalidate);
    },
    close: () => pool.end(),
  };
}
