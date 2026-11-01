import { Pool, type PoolClient } from 'pg';
import { z } from 'zod';
import {
  regionalActorSchema, regionalCommandResultSchema, regionalCommandSchema, regionalFacilitySnapshotSchema,
  regionalIdSchema, regionalOverviewSchema, regionalScopeSchema, type RegionalActor, type RegionalCommand,
  type RegionalCommandResult, type RegionalFacilitySnapshot, type RegionalOverview, type RegionalScope,
} from '../lib/regional/contracts';
import type { CrmPostgresConfig } from './crm-postgres-repository';
import { regionalKpiQuerySchema, regionalKpiSnapshotSchema, regionalKpiEvidenceQuerySchema, regionalKpiEvidenceSchema,
  type RegionalKpiQuery, type RegionalKpiSnapshot, type RegionalKpiEvidenceQuery, type RegionalKpiEvidence } from '../lib/regional/kpi';
import { regionalDirectivesQuerySchema, regionalDirectivesSnapshotSchema, regionalDirectiveCommandSchema,
  regionalDirectiveCommandResultSchema, regionalDirectiveAttachmentResponseSchema,
  type RegionalDirectivesQuery, type RegionalDirectivesSnapshot, type RegionalDirectiveCommand,
  type RegionalDirectiveCommandResult, type RegionalDirectiveAttachmentResponse } from '../lib/regional/directives';

const briefingArtifactSchema = z.object({
  scopeType: z.enum(['region', 'district', 'facility']), scopeId: regionalIdSchema,
  sourceHash: z.string().regex(/^[a-f0-9]{64}$/), provider: z.literal('groq'), model: z.string().min(1).max(120),
  summary: z.string().trim().min(1).max(900), priorities: z.array(z.string().trim().min(1).max(300)).max(5), generatedAt: z.iso.datetime(),
}).strict();
export type RegionalBriefingArtifact = z.infer<typeof briefingArtifactSchema>;
type Revalidate = () => void | Promise<void>;
export type RegionalPostgresRepository = {
  scope(actor: RegionalActor, revalidate?: Revalidate): Promise<RegionalScope>;
  overview(actor: RegionalActor, revalidate?: Revalidate): Promise<RegionalOverview>;
  kpi(actor: RegionalActor, query: RegionalKpiQuery, revalidate?: Revalidate): Promise<RegionalKpiSnapshot>;
  kpiEvidence(actor: RegionalActor, query: RegionalKpiEvidenceQuery, revalidate?: Revalidate): Promise<RegionalKpiEvidence>;
  directives(actor: RegionalActor, query: RegionalDirectivesQuery, revalidate?: Revalidate): Promise<RegionalDirectivesSnapshot>;
  directiveCommand(actor: RegionalActor, command: RegionalDirectiveCommand, revalidate?: Revalidate): Promise<RegionalDirectiveCommandResult>;
  directiveAttachment(actor: RegionalActor, attachmentId: string, revalidate?: Revalidate): Promise<RegionalDirectiveAttachmentResponse>;
  facility(actor: RegionalActor, facilityId: string, revalidate?: Revalidate): Promise<RegionalFacilitySnapshot>;
  command(actor: RegionalActor, command: RegionalCommand, revalidate?: Revalidate): Promise<RegionalCommandResult>;
  saveBriefing(actor: RegionalActor, artifact: RegionalBriefingArtifact, revalidate?: Revalidate): Promise<{ id: string }>;
  close(): Promise<void>;
};
export class RegionalRepositoryError extends Error {
  constructor(readonly code: string, readonly status: number) { super('Regional request could not be completed.'); }
}
const errorStatus: Record<string, number> = {
  REGIONAL_ACCESS_DENIED: 403, REGIONAL_NOT_FOUND: 404, REGIONAL_INVALID_COMMAND: 400, REGIONAL_KPI_INVALID_QUERY: 400,
  REGIONAL_VERSION_CONFLICT: 409, REGIONAL_IDEMPOTENCY_CONFLICT: 409,
  REGIONAL_INVALID_TRANSITION: 409, REGIONAL_STOCK_UNAVAILABLE: 409, REGIONAL_LIMIT: 503,
  REGIONAL_CAPACITY_CONFLICT: 409, REGIONAL_QUEUE_CONFLICT: 409,
  DIRECTIVE_ACCESS_DENIED: 403, DIRECTIVE_NOT_FOUND: 404, DIRECTIVE_INVALID_QUERY: 400,
  DIRECTIVE_INVALID_COMMAND: 400, DIRECTIVE_INVALID_ATTACHMENT: 400, DIRECTIVE_VERSION_CONFLICT: 409,
  DIRECTIVE_IDEMPOTENCY_CONFLICT: 409, DIRECTIVE_INVALID_TRANSITION: 409, DIRECTIVE_EXPLANATION_REQUIRED: 409,
  DIRECTIVE_FILE_INVALID: 400, DIRECTIVE_COMPLETION_DATE_LOCKED: 409, DIRECTIVE_REWORK_DATE_REQUIRED: 409,
  DIRECTIVE_LIMIT: 503,
};
type PoolPort = { connect(): Promise<PoolClient>; end(): Promise<void> };
/** Fixed local target, no process.env connection fallback or browser-supplied identity. */
export function createRegionalPostgresRepository(config: CrmPostgresConfig, suppliedPool?: PoolPort): RegionalPostgresRepository {
  if (typeof window !== 'undefined' || !config || config.host !== '127.0.0.1' || config.port !== 55432 ||
    config.database !== 'orion_crm_local' || config.user !== 'orion_crm_app' || typeof config.password !== 'string' ||
    config.password.length < 16 || config.password.length > 256 || /[\r\n\0]/.test(config.password)) {
    throw new RegionalRepositoryError('REGIONAL_UNAVAILABLE', 503);
  }
  const { password } = config;
  const pool = suppliedPool ?? new Pool({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'orion_crm_app',
    password, ssl: false, max: 2, connectionTimeoutMillis: 3000, idleTimeoutMillis: 10000, query_timeout: 8000,
    statement_timeout: 7000, lock_timeout: 2000, idle_in_transaction_session_timeout: 10000, application_name: 'orion-regional-local' });
  if (pool instanceof Pool) pool.on('error', () => undefined);
  let closed = false;
  async function run<T>(actor: RegionalActor, sql: string, value: string | undefined, schema: z.ZodType<T>, revalidate?: Revalidate): Promise<T> {
    const identity = regionalActorSchema.safeParse(actor);
    if (!identity.success) throw new RegionalRepositoryError('REGIONAL_ACCESS_DENIED', 403);
    if (closed) throw new RegionalRepositoryError('REGIONAL_UNAVAILABLE', 503);
    let client: PoolClient | undefined; let begun = false; let validationFailed = false;
    const check = async () => { try { await revalidate?.(); } catch (error) { validationFailed = true; throw error; } };
    try {
      await check(); client = await pool.connect(); await check();
      await client.query('BEGIN'); begun = true; await check();
      const params = [identity.data.issuer, identity.data.subject, ...(value === undefined ? [] : [value])];
      const response = await client.query(sql, params);
      const result = schema.parse(response.rows[0]?.result); await check();
      await client.query('COMMIT'); begun = false; await check(); return result;
    } catch (error) {
      if (client && begun) await client.query('ROLLBACK').catch(() => undefined);
      if (validationFailed) throw error;
      const e = error && typeof error === 'object' ? error as { code?: unknown; message?: unknown } : {};
      if (typeof e.code === 'string' && /^PT(400|403|404|409|503)$/.test(e.code) && typeof e.message === 'string' && errorStatus[e.message]) {
        throw new RegionalRepositoryError(e.message, errorStatus[e.message]);
      }
      throw new RegionalRepositoryError('REGIONAL_UNAVAILABLE', 503);
    } finally { client?.release(); }
  }
  return {
    scope: (actor, revalidate) => run(actor, 'SELECT public.orion_regional_scope_v1($1::text,$2::text) AS result', undefined, regionalScopeSchema, revalidate),
    overview: (actor, revalidate) => run(actor, 'SELECT public.orion_regional_overview_v1($1::text,$2::text) AS result', undefined, regionalOverviewSchema, revalidate),
    kpi: (actor, query, revalidate) => run(actor, 'SELECT public.orion_regional_kpi_v1($1::text,$2::text,$3::jsonb) AS result', JSON.stringify(regionalKpiQuerySchema.parse(query)), regionalKpiSnapshotSchema, revalidate),
    kpiEvidence: (actor, query, revalidate) => run(actor, 'SELECT public.orion_regional_kpi_evidence_v1($1::text,$2::text,$3::jsonb) AS result', JSON.stringify(regionalKpiEvidenceQuerySchema.parse(query)), regionalKpiEvidenceSchema, revalidate),
    directives: (actor, query, revalidate) => run(actor, 'SELECT public.orion_regional_directives_v1($1::text,$2::text,$3::jsonb) AS result', JSON.stringify(regionalDirectivesQuerySchema.parse(query)), regionalDirectivesSnapshotSchema, revalidate),
    directiveCommand: (actor, command, revalidate) => run(actor, 'SELECT public.orion_regional_directive_command_v1($1::text,$2::text,$3::jsonb) AS result', JSON.stringify(regionalDirectiveCommandSchema.parse(command)), regionalDirectiveCommandResultSchema, revalidate),
    directiveAttachment: (actor, id, revalidate) => run(actor, 'SELECT public.orion_regional_directive_attachment_v1($1::text,$2::text,$3::text) AS result', regionalIdSchema.parse(id), regionalDirectiveAttachmentResponseSchema, revalidate),
    facility: (actor, id, revalidate) => run(actor, 'SELECT public.orion_regional_facility_v1($1::text,$2::text,$3::text) AS result', regionalIdSchema.parse(id), regionalFacilitySnapshotSchema, revalidate),
    command: (actor, command, revalidate) => run(actor, 'SELECT public.orion_regional_command_v1($1::text,$2::text,$3::jsonb) AS result', JSON.stringify(regionalCommandSchema.parse(command)), regionalCommandResultSchema, revalidate),
    saveBriefing: (actor, artifact, revalidate) => run(actor, 'SELECT public.orion_regional_briefing_save_v1($1::text,$2::text,$3::jsonb) AS result', JSON.stringify(briefingArtifactSchema.parse(artifact)), z.object({ id: regionalIdSchema }).strict(), revalidate),
    async close() { if (!closed) { closed = true; await pool.end(); } },
  };
}
