import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AccessPermissionRequiredError } from '@/lib/auth/access-governance';
import { AccessAuditUnavailableError } from '@/lib/repositories/access-audit';

const state = vi.hoisted(() => ({ signedIn: true, revoked: false, audit: vi.fn(), readAccess: vi.fn(), sections: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }));
vi.mock('@/lib/config/runtime', () => ({ parseRuntimeConfig: () => ({ environment: 'test' }) }));
vi.mock('@/lib/auth/site-identity', () => ({ getSiteIdentity: () => state.signedIn ? { id: 'identity-a' } : null,
  toSiteIdentityPrincipal: () => ({}) }));
vi.mock('@/lib/auth/encounter-read-access', () => ({ assertCurrentEncounterReadAccess: state.readAccess }));
vi.mock('@/lib/auth/workspace-access', async original => ({ ...await original<object>(),
  resolveClinicianWorkspaceAccess: async () => ({ user: { id: 'user-a', displayName: 'Test doctor' },
    membership: { role: 'clinician', organizationId: 'org-a', facilityId: 'fac-a' },
    scope: { organizationId: 'org-a', facilityId: 'fac-a', encounterId: 'enc-a', reviewerMembershipId: 'member-a',
      accessAssignmentId: 'assignment-a', accessPermission: 'encounter.read' },
    encounter: { id: 'enc-a' }, encounters: [{ id: 'enc-a' }] }) }));
vi.mock('@/lib/repositories/workspace-access', () => ({ D1WorkspaceAccessRepository: class {} }));
vi.mock('@/lib/repositories/access-audit', async original => ({ ...await original<object>(),
  D1AccessAuditRepository: class { recordWorkspaceRead = state.audit; } }));
vi.mock('@/lib/repositories/clinical-sections', () => ({ D1ClinicalSectionRepository: class { list = state.sections; } }));
vi.mock('@/lib/repositories/consent', () => ({ D1ConsentRepository: class { async listCurrent() { return []; } } }));
vi.mock('@/lib/repositories/document-export', () => ({ D1DocumentExportRepository: class { async listCurrentArtifacts() { return []; } } }));
vi.mock('@/lib/repositories/encounter-recovery', () => ({ D1EncounterRecoveryRepository: class {
  async getServerSnapshot() { return { revision: 'revision-a', encounterId: 'enc-a', status: 'draft', encounterVersion: 1 }; }
} }));
vi.mock('@/lib/repositories/protocol-amendment', () => ({ D1ProtocolAmendmentRepository: class { async list() { return []; } } }));
vi.mock('@/lib/repositories/protocol-review', () => ({ D1ProtocolReviewRepository: class { async getCurrentSummary() { return null; } } }));
vi.mock('@/lib/repositories/suggestion-review', () => ({ D1SuggestionReviewRepository: class { async list() { return []; } } }));
vi.mock('@/lib/repositories/transcript', () => ({ D1TranscriptRepository: class { async listCurrent() { return []; } } }));
import { GET } from './route';

const get = () => GET(new Request('https://orion.test/api/workspace?encounterId=enc-a&accessAssignmentId=assignment-a'));
beforeEach(() => {
  vi.clearAllMocks(); state.signedIn = true; state.revoked = false;
  state.sections.mockResolvedValue(Array.from({ length: 8 }, (_, i) => ({ id: `${i}`, content: 'PRIVATE_SYNTHETIC_RECORD' })));
  state.audit.mockImplementation(async () => {
    if (state.revoked) throw new AccessPermissionRequiredError('encounter.read');
    return { action: 'workspace.read', recordedAt: 1000 };
  });
  state.readAccess.mockImplementation(async () => { if (state.revoked) throw new AccessPermissionRequiredError('encounter.read'); });
});

describe('workspace response publication boundary', () => {
  it('rejects anonymous reads before loading records', async () => {
    state.signedIn = false;
    expect((await get()).status).toBe(401);
    expect(state.sections).not.toHaveBeenCalled(); expect(state.audit).not.toHaveBeenCalled();
  });
  it('does not release data after access changes during resource loading', async () => {
    state.sections.mockImplementation(async () => {
      state.revoked = true;
      return Array.from({ length: 8 }, () => ({ content: 'PRIVATE_SYNTHETIC_RECORD' }));
    });
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('PRIVATE_SYNTHETIC_RECORD');
  });
  it('rechecks exact scope after the audit operation and withholds data after revocation', async () => {
    state.audit.mockImplementation(async () => { state.revoked = true; return { action: 'workspace.read', recordedAt: 1000 }; });
    const response = await get();
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain('PRIVATE_SYNTHETIC_RECORD');
    expect(state.readAccess).toHaveBeenCalledWith({}, expect.objectContaining({ accessAssignmentId: 'assignment-a', encounterId: 'enc-a' }), 'user-a');
  });
  it('does not release clinical content when the audit cannot commit', async () => {
    state.audit.mockRejectedValue(new AccessAuditUnavailableError());
    const response = await get();
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain('PRIVATE_SYNTHETIC_RECORD');
  });
  it('returns the record and receipt only after the final read authorization', async () => {
    const response = await get();
    expect(response.status).toBe(200);
    expect(state.audit).toHaveBeenCalledOnce(); expect(state.readAccess).toHaveBeenCalledOnce();
    expect(await response.text()).toContain('PRIVATE_SYNTHETIC_RECORD');
  });
});
