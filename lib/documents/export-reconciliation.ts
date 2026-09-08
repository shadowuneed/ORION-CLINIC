import { z } from 'zod';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { exportArtifactKinds } from './protocol-artifacts';
import type { D1DocumentExportRepository, ExportIntent } from '@/lib/repositories/document-export';

export function exportPrefix(scope: Pick<WorkspaceScope, 'organizationId' | 'facilityId' | 'encounterId'>,
  protocolId: string, protocolVersion: number) {
  const part = (value: string) => encodeURIComponent(value).replaceAll('%', '_');
  return ['synthetic-exports', part(scope.organizationId), part(scope.facilityId),
    part(scope.encounterId), part(protocolId), `v${protocolVersion}`].join('/');
}

const manifestSchema = z.object({
  schemaVersion: z.literal(2), status: z.literal('publication_pending'),
  accessAssignmentId: z.string().min(1), createdAt: z.number().int().nonnegative(),
  intent: z.object({ protocolId: z.string(), protocolVersion: z.number().int().positive(),
    actorId: z.string(), idempotencyKey: z.string().uuid() }),
  requestId: z.string(),
  artifacts: z.array(z.object({ kind: z.enum(exportArtifactKinds), filename: z.string().min(1).max(250),
    objectKey: z.string().max(2000), mimeType: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    byteSize: z.number().int().positive().max(Number.MAX_SAFE_INTEGER) })).length(5),
});

/** Explicit, one-attempt operation. No age policy, bucket scan, scheduler or manifest-supplied deletion paths. */
export async function reconcileExportAttempt(args: {
  bucket: Pick<R2Bucket, 'get' | 'delete'>;
  repository: Pick<D1DocumentExportRepository, 'assertGenerationAuthorized' | 'fenceUnpublishedAttempt'>;
  scope: WorkspaceScope; intent: ExportIntent; attemptId: string; requestId: string;
}) {
  z.string().uuid().parse(args.attemptId);
  const { repository, bucket, intent, scope } = args;
  await repository.assertGenerationAuthorized(intent.protocolId, intent.protocolVersion, intent.actorId);
  const prefix = `${exportPrefix(scope, intent.protocolId, intent.protocolVersion)}/attempt-${args.attemptId}`;
  const manifestKey = `${prefix}/manifest.json`;
  const object = await bucket.get(manifestKey);
  if (!object) return { status: 'absent' as const };
  if (object.size > 16_384) return { status: 'retained' as const };
  const parsed = manifestSchema.safeParse(JSON.parse(await object.text()));
  if (!parsed.success) return { status: 'retained' as const };
  const manifest = parsed.data;
  if (manifest.accessAssignmentId !== scope.accessAssignmentId ||
    Object.entries(intent).some(([key, value]) => manifest.intent[key as keyof ExportIntent] !== value) ||
    new Set(manifest.artifacts.map(a => a.kind)).size !== 5 ||
    new Set(manifest.artifacts.map(a => a.filename)).size !== 5 ||
    manifest.artifacts.some(a => /[/\\]/.test(a.filename) || ['.', '..', 'manifest.json'].includes(a.filename) ||
      a.objectKey !== `${prefix}/${a.filename}`)) return { status: 'retained' as const };

  await repository.assertGenerationAuthorized(intent.protocolId, intent.protocolVersion, intent.actorId);
  if (!await repository.fenceUnpublishedAttempt({ ...intent, manifestKey,
    artifacts: manifest.artifacts, requestId: args.requestId })) return { status: 'retained' as const };
  // Permanent SQL fences now prohibit every future reference, including delayed publication.
  const results = await Promise.allSettled(manifest.artifacts.map(a => bucket.delete(`${prefix}/${a.filename}`)));
  if (results.some(result => result.status === 'rejected')) return { status: 'retry_required' as const };
  await bucket.delete(manifestKey);
  return { status: 'cleaned' as const };
}
