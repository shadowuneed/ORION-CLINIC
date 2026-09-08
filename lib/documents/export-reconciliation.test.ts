import { describe, expect, it, vi } from 'vitest';
import { exportPrefix, reconcileExportAttempt } from './export-reconciliation';
import { exportArtifactKinds } from './protocol-artifacts';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';

function fixture() {
  const scope: WorkspaceScope = { organizationId: 'org-a', facilityId: 'fac-a', encounterId: 'enc-a',
    reviewerMembershipId: 'member-a', accessAssignmentId: 'assignment-a', accessPermission: 'encounter.manage' };
  const intent = { protocolId: 'protocol-a', protocolVersion: 2, actorId: 'user-a', idempotencyKey: crypto.randomUUID() };
  const attemptId = crypto.randomUUID();
  const prefix = `${exportPrefix(scope, intent.protocolId, intent.protocolVersion)}/attempt-${attemptId}`;
  const manifest = { schemaVersion: 2, status: 'publication_pending', accessAssignmentId: scope.accessAssignmentId,
    intent, createdAt: Date.now(), requestId: 'original-request', artifacts: exportArtifactKinds.map(kind => ({ kind,
      filename: `${kind}.bin`, objectKey: `${prefix}/${kind}.bin`, mimeType: 'application/octet-stream',
      sha256: 'a'.repeat(64), byteSize: 10 })) };
  const objects = new Set([...manifest.artifacts.map(a => a.objectKey), `${prefix}/manifest.json`, 'unrelated/file']);
  const bucket = { get: vi.fn(async () => ({ size: 2000, text: async () => JSON.stringify(manifest) })),
    delete: vi.fn(async (key: string) => { objects.delete(key); }) };
  const repository = { assertGenerationAuthorized: vi.fn(async () => undefined),
    fenceUnpublishedAttempt: vi.fn(async () => true) };
  return { manifest, objects, bucket, repository, prefix,
    args: { scope, intent, attemptId, requestId: 'cleanup-request', bucket, repository } as unknown as Parameters<typeof reconcileExportAttempt>[0] };
}

describe('explicit pending export reconciliation', () => {
  it('fences before deleting only owned keys and removes the manifest last', async () => {
    const f = fixture();
    f.bucket.delete.mockImplementation(async key => {
      expect(f.repository.fenceUnpublishedAttempt).toHaveBeenCalledOnce();
      f.objects.delete(key);
    });
    expect(await reconcileExportAttempt(f.args)).toEqual({ status: 'cleaned' });
    expect([...f.objects]).toEqual(['unrelated/file']);
    expect(f.bucket.delete.mock.calls.at(-1)?.[0]).toBe(`${f.prefix}/manifest.json`);
  });
  it.each(['uploading', 'published'])('retains %s manifests without fencing', async status => {
    const f = fixture(); f.manifest.status = status;
    expect(await reconcileExportAttempt(f.args)).toEqual({ status: 'retained' });
    expect(f.repository.fenceUnpublishedAttempt).not.toHaveBeenCalled();
    expect(f.bucket.delete).not.toHaveBeenCalled();
  });
  it('retains legacy manifests without assignment attribution', async () => {
    const f = fixture(); f.manifest.schemaVersion = 1;
    expect(await reconcileExportAttempt(f.args)).toEqual({ status: 'retained' });
    expect(f.bucket.delete).not.toHaveBeenCalled();
  });
  it.each(['assignment', 'actor', 'intent', 'path', 'duplicate'])('rejects mismatched %s without deletion', async mismatch => {
    const f = fixture();
    if (mismatch === 'assignment') f.manifest.accessAssignmentId = 'another-assignment';
    if (mismatch === 'actor') f.manifest.intent = { ...f.manifest.intent, actorId: 'other-user' };
    if (mismatch === 'intent') f.manifest.intent = { ...f.manifest.intent, idempotencyKey: crypto.randomUUID() };
    if (mismatch === 'path') f.manifest.artifacts[0].objectKey = 'unrelated/file';
    if (mismatch === 'duplicate') f.manifest.artifacts[0] = f.manifest.artifacts[1];
    expect(await reconcileExportAttempt(f.args)).toEqual({ status: 'retained' });
    expect(f.repository.fenceUnpublishedAttempt).not.toHaveBeenCalled();
    expect(f.bucket.delete).not.toHaveBeenCalled();
  });
  it('retains files when publication won the race', async () => {
    const f = fixture(); f.repository.fenceUnpublishedAttempt.mockResolvedValue(false);
    expect(await reconcileExportAttempt(f.args)).toEqual({ status: 'retained' });
    expect(f.bucket.delete).not.toHaveBeenCalled();
  });
  it('does not delete after an uncertain fence commit', async () => {
    const f = fixture(); f.repository.fenceUnpublishedAttempt.mockRejectedValue(new Error('connection lost'));
    await expect(reconcileExportAttempt(f.args)).rejects.toThrow('connection lost');
    expect(f.bucket.delete).not.toHaveBeenCalled();
  });
  it('keeps the manifest after partial deletion and safely retries', async () => {
    const f = fixture(); f.bucket.delete.mockRejectedValueOnce(new Error('storage down'));
    expect(await reconcileExportAttempt(f.args)).toEqual({ status: 'retry_required' });
    expect(f.objects.has(`${f.prefix}/manifest.json`)).toBe(true);
    expect(await reconcileExportAttempt(f.args)).toEqual({ status: 'cleaned' });
    expect([...f.objects]).toEqual(['unrelated/file']);
  });
  it('does not fence or delete after revocation during manifest reading', async () => {
    const f = fixture();
    f.repository.assertGenerationAuthorized.mockResolvedValueOnce(undefined).mockRejectedValue(new Error('revoked'));
    await expect(reconcileExportAttempt(f.args)).rejects.toThrow('revoked');
    expect(f.repository.fenceUnpublishedAttempt).not.toHaveBeenCalled();
    expect(f.bucket.delete).not.toHaveBeenCalled();
  });
});
