import { Pool } from 'pg';
import {
  crmActorSchema, crmCommandResultSchema, crmCommandSchema, crmSnapshotSchema,
  type CrmActor, type CrmCommand, type CrmCommandResult, type CrmSnapshot,
} from '../lib/crm/contracts';

if (typeof window !== 'undefined') throw new Error('CRM repository is server-only.');

export type CrmPostgresConfig = Readonly<{
  host: '127.0.0.1'; port: 55432; database: 'orion_crm_local'; user: 'orion_crm_app'; password: string;
}>;
export type CrmRevalidate = () => void | Promise<void>;
export type CrmRepositoryErrorCode = 'CRM_ACCESS_DENIED' | 'CRM_RESOURCE_NOT_FOUND' |
  'CRM_VERSION_CONFLICT' | 'CRM_IDEMPOTENCY_CONFLICT' | 'CRM_INVALID_TRANSITION' |
  'CRM_CAPACITY_CONFLICT' | 'CRM_SCHEDULE_CONFLICT' | 'CRM_OUTSIDE_HOURS' | 'CRM_PAST_SLOT' |
  'CRM_QUEUE_ORDER_CONFLICT' | 'CRM_NO_SHOW_TOO_EARLY' | 'CRM_CLINICAL_WORKFLOW_REQUIRED' | 'CRM_INVALID_COMMAND' | 'CRM_UNAVAILABLE';
export class CrmRepositoryError extends Error {
  constructor(readonly code: CrmRepositoryErrorCode, readonly status: 400 | 403 | 404 | 409 | 503) {
    super('CRM request could not be completed.'); this.name = 'CrmRepositoryError';
  }
}

export type CrmPostgresRepository = {
  snapshot(actor: CrmActor, revalidate?: CrmRevalidate): Promise<CrmSnapshot>;
  command(actor: CrmActor, command: CrmCommand, revalidate?: CrmRevalidate): Promise<CrmCommandResult>;
  close(): Promise<void>;
};

function normalizeError(error: unknown): CrmRepositoryError {
  if (error instanceof CrmRepositoryError) return error;
  const record = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
  if (record.code === 'PT403' && record.message === 'CLINICAL_ACCESS_DENIED') return new CrmRepositoryError('CRM_ACCESS_DENIED', 403);
  const approved: [string, CrmRepositoryErrorCode, 400 | 403 | 404 | 409][] = [
    ['PT403', 'CRM_ACCESS_DENIED', 403], ['PT404', 'CRM_RESOURCE_NOT_FOUND', 404],
    ['PT400', 'CRM_INVALID_COMMAND', 400], ['PT409', 'CRM_VERSION_CONFLICT', 409],
    ['PT409', 'CRM_IDEMPOTENCY_CONFLICT', 409], ['PT409', 'CRM_INVALID_TRANSITION', 409],
    ['PT409', 'CRM_CAPACITY_CONFLICT', 409],
    ['PT409', 'CRM_SCHEDULE_CONFLICT', 409], ['PT409', 'CRM_OUTSIDE_HOURS', 409],
    ['PT409', 'CRM_PAST_SLOT', 409], ['PT409', 'CRM_QUEUE_ORDER_CONFLICT', 409],
    ['PT409', 'CRM_NO_SHOW_TOO_EARLY', 409],
    ['PT409', 'CRM_CLINICAL_WORKFLOW_REQUIRED', 409],
  ];
  const match = approved.find(([code, message]) => code === record.code && message === record.message);
  return match ? new CrmRepositoryError(match[1], match[2]) : new CrmRepositoryError('CRM_UNAVAILABLE', 503);
}

/** Dedicated loopback only. Does not read process.env, files, D1 or Supabase. */
export function createCrmPostgresRepository(config: CrmPostgresConfig): CrmPostgresRepository {
  if (!config || config.host !== '127.0.0.1' || config.port !== 55432 || config.database !== 'orion_crm_local' ||
    config.user !== 'orion_crm_app' || typeof config.password !== 'string' || config.password.length < 16 ||
    config.password.length > 256 || /[\r\n\0]/.test(config.password)) throw new TypeError('Invalid dedicated CRM database configuration.');
  // Copy exact options; pg receives no omitted connection fields/environment fallback.
  const { password } = config;
  const pool = new Pool({ host: config.host, port: config.port, database: config.database,
    user: config.user, password, ssl: false, max: 4,
    connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, query_timeout: 6000,
    statement_timeout: 5000, lock_timeout: 2000, idle_in_transaction_session_timeout: 10000,
    application_name: 'orion-crm-local-v1',
  });
  // Background connection failure must not crash Vite or log credential-bearing errors.
  pool.on('error', () => undefined);
  let closed = false;

  async function request<T>(actorInput: CrmActor, body: CrmCommand | undefined,
    parse: (value: unknown) => T, revalidate?: CrmRevalidate): Promise<T> {
    if (closed) throw new CrmRepositoryError('CRM_UNAVAILABLE', 503);
    const actor = crmActorSchema.safeParse(actorInput);
    if (!actor.success) throw new CrmRepositoryError('CRM_ACCESS_DENIED', 403);
    // Snapshot before the first await; caller mutation cannot change attribution/body.
    const command = body === undefined ? undefined : crmCommandSchema.safeParse(body);
    if (command && !command.success) throw new CrmRepositoryError('CRM_INVALID_COMMAND', 400);
    const parameters = command?.success ? [actor.data.issuer, actor.data.subject, JSON.stringify(command.data)] :
      [actor.data.issuer, actor.data.subject];
    const query = command ? 'SELECT public.orion_clinical_crm_command_v1($1::text,$2::text,$3::jsonb) AS result' :
      'SELECT public.orion_clinical_crm_snapshot_v1($1::text,$2::text) AS result';
    let revalidationFailed = false;
    const current = async () => {
      try { await revalidate?.(); } catch (error) { revalidationFailed = true; throw error; }
    };
    await current();
    let client;
    try { client = await pool.connect(); }
    catch (error) { throw normalizeError(error); }
    let begun = false;
    try {
      await current(); // Pool wait is not an authority lease.
      await client.query('BEGIN'); begun = true;
      await current();
      const response = await client.query<{ result: unknown }>(query, parameters);
      if (response.rows.length !== 1) throw new CrmRepositoryError('CRM_UNAVAILABLE', 503);
      const result = parse(response.rows[0].result);
      await current(); // Failed auth/contract rolls back command, history, audit and receipt.
      await client.query('COMMIT'); begun = false;
      await current(); // A late revoke suppresses response; a valid commit remains durable.
      return result;
    } catch (error) {
      if (begun) await client.query('ROLLBACK').catch(() => undefined);
      if (revalidationFailed) throw error;
      throw normalizeError(error);
    } finally { client.release(); }
  }

  return {
    snapshot: (actor, revalidate) => request(actor, undefined, value => crmSnapshotSchema.parse(value), revalidate),
    command: (actor, command, revalidate) => request(actor, command, value => crmCommandResultSchema.parse(value), revalidate),
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
}
