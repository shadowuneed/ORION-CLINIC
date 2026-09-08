import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { exportArtifactKinds } from '@/lib/documents/protocol-artifacts';

const state = vi.hoisted(() => ({ revoked: false, signedIn: true, fence: vi.fn(), put: vi.fn(), get: vi.fn(), render: vi.fn(),
  audit: vi.fn(), record: vi.fn(), source: vi.fn(), download: vi.fn(), replay: vi.fn(), remove: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { DB: {}, FILES: { put: state.put, get: state.get, delete: state.remove } } }));
vi.mock('@/lib/config/runtime', () => ({ parseRuntimeConfig: vi.fn() }));
vi.mock('@/lib/auth/site-identity', () => ({ getSiteIdentity: () => state.signedIn ? ({ id: 'identity' }) : null, toSiteIdentityPrincipal: () => ({}) }));
vi.mock('@/lib/auth/workspace-access', async original => ({ ...await original<object>(),
  resolveClinicianWorkspaceAccess: async () => ({ user: { id: 'user-a' }, scope: { organizationId: 'org-a', facilityId: 'fac-a',
    encounterId: 'enc-a', reviewerMembershipId: 'membership-a', accessAssignmentId: 'assignment-a', accessPermission: 'encounter.manage' } }) }));
vi.mock('@/lib/repositories/workspace-access', () => ({ D1WorkspaceAccessRepository: class {} }));
vi.mock('@/lib/documents/protocol-artifacts', async original => ({ ...await original<object>(),
  generateProtocolArtifacts: state.render, sha256Bytes: async () => 'test-hash' }));
vi.mock('@/lib/repositories/document-export', async original => ({ ...await original<object>(),
  D1DocumentExportRepository: class {
    getSignedSource = state.source;
    getDownload = state.download;
    recordGenerated = state.record;
    findGenerated = state.replay;
    fenceUnpublishedAttempt = state.fence;
    async assertGenerationAuthorized() { if (state.revoked) throw new AccessPermissionRequiredError('encounter.manage'); }
    async assertDownloadAuthorized() { if (state.revoked) throw new AccessPermissionRequiredError('encounter.read'); }
  } }));
vi.mock('@/lib/repositories/access-audit', async original => ({ ...await original<object>(),
  D1AccessAuditRepository: class { recordDocumentDownload = state.audit; } }));
import { POST } from './generate/route';
import { GET } from './download/route';
import { POST as reconcile } from './reconcile/route';

const artifact = { id: 'artifact-a', kind: 'protocol_docx', filename: 'protocol.docx', objectKey: 'synthetic/test.docx',
  sha256: 'test-hash', byteSize: 2, mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
const bytes = new Uint8Array([1, 2]);
const generated = [{ ...artifact, bytes }];
const post = () => POST(new Request('https://orion.test/api/workspace/exports/generate', { method: 'POST',
  headers: { origin: 'https://orion.test', 'content-type': 'application/json' },
  body: JSON.stringify({ encounterId: 'enc-a', protocolId: 'protocol-a', expectedProtocolVersion: 2,
    acknowledgeSyntheticExport: true, idempotencyKey: crypto.randomUUID() }) }));
const get = () => GET(new Request('https://orion.test/api/workspace/exports/download?encounterId=enc-a&kind=protocol_docx'));

beforeEach(() => {
  vi.clearAllMocks(); state.revoked = false; state.signedIn = true;
  state.fence.mockResolvedValue(true);
  state.replay.mockResolvedValue(null);
  state.remove.mockResolvedValue(undefined);
  state.source.mockResolvedValue({ protocol: { id: 'protocol-a', version: 2, sourceHash: 'source-hash' } });
  state.render.mockResolvedValue(generated);
  state.put.mockResolvedValue(undefined);
  state.get.mockResolvedValue({ arrayBuffer: async () => bytes.buffer });
  state.audit.mockResolvedValue(undefined);
  state.download.mockResolvedValue(artifact);
  state.record.mockResolvedValue({ encounterId: 'enc-a', protocolId: 'protocol-a', protocolVersion: 2, artifacts: [artifact] });
});

describe('export API revalidation around asynchronous work', () => {
  const reconciliation = (origin = 'https://orion.test', extra = {}) => reconcile(new Request('https://orion.test/api/workspace/exports/reconcile', {
    method: 'POST', headers: { origin, 'content-type': 'application/json' },
    body: JSON.stringify({ encounterId: 'enc-a', protocolId: 'protocol-a', expectedProtocolVersion: 2,
      attemptId: crypto.randomUUID(), idempotencyKey: crypto.randomUUID(), acknowledgeSyntheticCleanup: true, ...extra }),
  }));
  it('requires authentication and same origin before inspecting reconciliation objects', async () => {
    state.signedIn = false;
    expect((await reconciliation()).status).toBe(401);
    state.signedIn = true;
    expect((await reconciliation('https://other.test')).status).toBe(403);
    expect(state.get).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
  });
  it('rejects caller-selected deletion paths and revoked reconciliation access', async () => {
    expect((await reconciliation('https://orion.test', { objectKey: 'other/file' })).status).toBe(400);
    state.revoked = true;
    expect((await reconciliation()).status).toBe(403);
    expect(state.get).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
  });
  it('returns an idempotent absent result without deleting when the exact attempt no longer exists', async () => {
    state.get.mockResolvedValue(null);
    const response = await reconciliation();
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain('absent');
    expect(state.fence).not.toHaveBeenCalled(); expect(state.remove).not.toHaveBeenCalled();
  });
  it('cleans one valid owned pending attempt only after a confirmed fence', async () => {
    const attemptId = crypto.randomUUID(); const idempotencyKey = crypto.randomUUID();
    const prefix = `synthetic-exports/org-a/fac-a/enc-a/protocol-a/v2/attempt-${attemptId}`;
    const manifest = { schemaVersion: 2, status: 'publication_pending', accessAssignmentId: 'assignment-a',
      createdAt: Date.now(), requestId: 'original-request',
      intent: { protocolId: 'protocol-a', protocolVersion: 2, actorId: 'user-a', idempotencyKey },
      artifacts: exportArtifactKinds.map(kind => ({ kind, filename: `${kind}.bin`, objectKey: `${prefix}/${kind}.bin`,
        mimeType: 'application/octet-stream', sha256: 'a'.repeat(64), byteSize: 2 })) };
    state.get.mockResolvedValue({ size: 2000, text: async () => JSON.stringify(manifest) });
    const response = await reconciliation('https://orion.test', { attemptId, idempotencyKey });
    expect(response.status).toBe(200);
    expect(JSON.stringify(await response.json())).toContain('cleaned');
    expect(state.fence).toHaveBeenCalledOnce(); expect(state.remove).toHaveBeenCalledTimes(6);
    expect(state.get).toHaveBeenCalledWith(`${prefix}/manifest.json`);
  });
  it('replays a completed intent without rendering or uploading another package', async () => {
    state.replay.mockResolvedValue({ artifacts: [artifact] });
    const response = await post();
    expect(response.status).toBe(201);
    expect(state.render).not.toHaveBeenCalled();
    expect(state.put).not.toHaveBeenCalled();
    expect(state.record).not.toHaveBeenCalled();
    expect(JSON.stringify(await response.json())).toContain('artifactId=artifact-a');
  });
  it('does not upload or publish when access is revoked during rendering', async () => {
    state.render.mockImplementation(async () => { state.revoked = true; return generated; });
    expect((await post()).status).toBe(403);
    expect(state.put).not.toHaveBeenCalled(); expect(state.record).not.toHaveBeenCalled();
  });
  it('does not release download bytes after revocation during object reading', async () => {
    state.get.mockResolvedValue({ arrayBuffer: async () => { state.revoked = true; return bytes.buffer; } });
    const response = await get();
    expect(response.status).toBe(403); expect(state.audit).not.toHaveBeenCalled();
    expect(response.headers.get('content-disposition')).toBeNull();
  });
  it('rechecks after recording access audit, before returning the file', async () => {
    state.audit.mockImplementation(async () => { state.revoked = true; });
    expect((await get()).status).toBe(403);
  });
  it('retains the selected assignment and facility in generated download links', async () => {
    const response = await post(); expect(response.status).toBe(201);
    const body = await response.json();
    const serialized = JSON.stringify(body);
    expect(serialized).toContain('accessAssignmentId=assignment-a');
    expect(serialized).toContain('facilityId=fac-a');
  });
  it('releases intact bytes only after the authorized access audit succeeds', async () => {
    const response = await get(); expect(response.status).toBe(200);
    expect(state.audit).toHaveBeenCalledOnce();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
  });
});
