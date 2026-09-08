import { describe, expect, it, vi } from 'vitest';
import { publishGeneratedExport } from './export-publication';
import type { GeneratedArtifact } from './protocol-artifacts';

function fixture() {
  const objects = new Map<string, unknown>();
  const bucket = {
    put: vi.fn(async (key: string, value: unknown) => { objects.set(key, value); return null; }),
    delete: vi.fn(async (key: string) => { objects.delete(key); }),
  };
  const repository = {
    assertGenerationAuthorized: vi.fn(async () => undefined),
    recordGenerated: vi.fn(async (input: { artifacts: unknown[] }) => ({ artifacts: input.artifacts })),
  };
  const args = { bucket, repository, intent: { protocolId: 'protocol-a', protocolVersion: 1,
    actorId: 'user-a', idempotencyKey: 'intent-a' }, requestId: 'request-a', prefix: 'synthetic-test', sourceHash: 'source',
    accessAssignmentId: 'assignment-a',
    artifacts: [{ kind: 'transcript_txt', filename: 'transcript.txt', mimeType: 'text/plain', sha256: 'a'.repeat(64),
      bytes: new Uint8Array([1, 2]) }] as GeneratedArtifact[] };
  return { objects, bucket, repository, args: args as unknown as Parameters<typeof publishGeneratedExport>[0] };
}

describe('owned export publication', () => {
  it('rejects path-like or reserved filenames before writing anything', async () => {
    const f = fixture();
    f.args.artifacts[0].filename = '../other.txt';
    await expect(publishGeneratedExport(f.args)).rejects.toThrow('basenames');
    expect(f.bucket.put).not.toHaveBeenCalled();
  });
  it('waits for late uploads before cleaning a partially failed package', async () => {
    const f = fixture();
    f.args.artifacts.push({ ...f.args.artifacts[0], filename: 'late.txt' });
    let finish: () => void = () => undefined;
    const late = new Promise<void>(resolve => { finish = resolve; });
    f.bucket.put.mockImplementation(async (key, value) => {
      if (key.endsWith('/transcript.txt')) throw new Error('upload failed');
      if (key.endsWith('/late.txt')) await late;
      f.objects.set(key, value);
      return null;
    });
    const publication = publishGeneratedExport(f.args);
    const assertion = expect(publication).rejects.toThrow('upload failed');
    finish();
    await assertion;
    expect(f.repository.recordGenerated).not.toHaveBeenCalled();
    expect(f.objects.size).toBe(0);
  });
  it('uses fresh keys for each attempt without overwriting a published object', async () => {
    const f = fixture();
    const first = await publishGeneratedExport(f.args);
    const second = await publishGeneratedExport(f.args);
    expect(first.artifacts[0].objectKey).not.toBe(second.artifacts[0].objectKey);
    expect(f.objects.has(first.artifacts[0].objectKey)).toBe(true);
    expect(f.objects.has(second.artifacts[0].objectKey)).toBe(true);
    expect(f.bucket.delete).not.toHaveBeenCalled();
  });
  it('retains files after an uncertain database result', async () => {
    const f = fixture();
    f.repository.recordGenerated.mockRejectedValue(new Error('connection lost after commit'));
    await expect(publishGeneratedExport(f.args)).rejects.toThrow('connection lost');
    expect(f.bucket.delete).not.toHaveBeenCalled();
    expect([...f.objects.keys()].some(key => key.endsWith('/transcript.txt'))).toBe(true);
    expect([...f.objects.values()].some(value => typeof value === 'string' && value.includes('publication_pending'))).toBe(true);
  });
  it('cleans only its own files when a concurrent attempt won', async () => {
    const f = fixture();
    f.objects.set('previous/valid.txt', 'existing');
    f.repository.recordGenerated.mockResolvedValue({ artifacts: [{ objectKey: 'previous/valid.txt' }] });
    await publishGeneratedExport(f.args);
    expect([...f.objects.keys()]).toEqual(['previous/valid.txt']);
  });
  it('cleans pre-publication uploads when authorization is revoked', async () => {
    const f = fixture();
    f.repository.assertGenerationAuthorized.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('revoked'));
    await expect(publishGeneratedExport(f.args)).rejects.toThrow('revoked');
    expect(f.repository.recordGenerated).not.toHaveBeenCalled();
    expect(f.objects.size).toBe(0);
  });
});
