import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';

const state = vi.hoisted(() => ({ revoked: false, put: vi.fn(), get: vi.fn(), render: vi.fn(),
  audit: vi.fn(), record: vi.fn(), source: vi.fn(), download: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { DB: {}, FILES: { put: state.put, get: state.get } } }));
vi.mock('@/lib/config/runtime', () => ({ parseRuntimeConfig: vi.fn() }));
vi.mock('@/lib/auth/site-identity', () => ({ getSiteIdentity: () => ({ id: 'identity' }), toSiteIdentityPrincipal: () => ({}) }));
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
    async assertGenerationAuthorized() { if (state.revoked) throw new AccessPermissionRequiredError('encounter.manage'); }
    async assertDownloadAuthorized() { if (state.revoked) throw new AccessPermissionRequiredError('encounter.read'); }
  } }));
vi.mock('@/lib/repositories/access-audit', async original => ({ ...await original<object>(),
  D1AccessAuditRepository: class { recordDocumentDownload = state.audit; } }));
import { POST } from './generate/route';
import { GET } from './download/route';

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
  vi.clearAllMocks(); state.revoked = false;
  state.source.mockResolvedValue({ protocol: { id: 'protocol-a', version: 2, sourceHash: 'source-hash' } });
  state.render.mockResolvedValue(generated);
  state.put.mockResolvedValue(undefined);
  state.get.mockResolvedValue({ arrayBuffer: async () => bytes.buffer });
  state.audit.mockResolvedValue(undefined);
  state.download.mockResolvedValue(artifact);
  state.record.mockResolvedValue({ encounterId: 'enc-a', protocolId: 'protocol-a', protocolVersion: 2, artifacts: [artifact] });
});

describe('export API revalidation around asynchronous work', () => {
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
