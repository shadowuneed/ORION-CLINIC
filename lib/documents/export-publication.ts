import type { GeneratedArtifact } from './protocol-artifacts';
import type { D1DocumentExportRepository, ExportIntent } from '@/lib/repositories/document-export';

/** Every invocation owns fresh keys. Never delete after an uncertain DB commit. */
export async function publishGeneratedExport(args: {
  bucket: Pick<R2Bucket, 'put' | 'delete'>;
  repository: Pick<D1DocumentExportRepository, 'recordGenerated' | 'assertGenerationAuthorized'>;
  intent: ExportIntent; requestId: string; prefix: string; sourceHash: string;
  artifacts: GeneratedArtifact[];
}) {
  const { bucket, repository, intent, artifacts } = args;
  if (new Set(artifacts.map(a => a.filename)).size !== artifacts.length ||
    artifacts.some(a => !a.filename || /[/\\]/.test(a.filename) || a.filename === '.' || a.filename === '..' || a.filename === 'manifest.json')) {
    throw new Error('Export filenames must be unique basenames');
  }
  const prefix = `${args.prefix}/attempt-${crypto.randomUUID()}`;
  const manifestKey = `${prefix}/manifest.json`;
  const metadata = artifacts.map(artifact => ({ kind: artifact.kind, filename: artifact.filename,
    objectKey: `${prefix}/${artifact.filename}`, mimeType: artifact.mimeType,
    sha256: artifact.sha256, byteSize: artifact.bytes.byteLength }));
  const keys = metadata.map(artifact => artifact.objectKey);
  const manifest = { schemaVersion: 1, createdAt: Date.now(), intent, requestId: args.requestId, artifacts: metadata };
  const mark = (status: string) => bucket.put(manifestKey, JSON.stringify({ ...manifest, status }),
    { httpMetadata: { contentType: 'application/json' } });
  const cleanup = async (ownedKeys: string[]) => {
    const results = await Promise.allSettled(ownedKeys.map(key => bucket.delete(key)));
    if (results.every(result => result.status === 'fulfilled')) await bucket.delete(manifestKey).catch(() => undefined);
  };
  let publicationAttempted = false;
  try {
    await repository.assertGenerationAuthorized(intent.protocolId, intent.protocolVersion, intent.actorId);
    await mark('uploading');
    const uploads = await Promise.allSettled(artifacts.map((artifact, index) => bucket.put(keys[index], artifact.bytes, {
      httpMetadata: { contentType: artifact.mimeType },
      customMetadata: { sha256: artifact.sha256, sourceHash: args.sourceHash, kind: artifact.kind, dataMode: 'synthetic-only' },
    })));
    const failed = uploads.find(result => result.status === 'rejected');
    if (failed?.status === 'rejected') throw failed.reason;
    await repository.assertGenerationAuthorized(intent.protocolId, intent.protocolVersion, intent.actorId);
    await mark('publication_pending');
    publicationAttempted = true;
    const result = await repository.recordGenerated({ ...intent, requestId: args.requestId, artifacts: metadata });
    const referenced = new Set(result.artifacts.map(artifact => artifact.objectKey));
    if (keys.every(key => !referenced.has(key))) await cleanup(keys); // another attempt won the same intent
    else await mark('published').catch(() => undefined); // DB is authoritative, marker failure cannot undo publication
    return result;
  } catch (error) {
    if (!publicationAttempted) await cleanup(keys);
    // Unknown DB outcome: retain owned files and manifest for reconciliation.
    throw error;
  }
}
