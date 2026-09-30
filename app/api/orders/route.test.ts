import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OrderWorkflowConflictError } from '@/lib/repositories/order-workflow';

const state = vi.hoisted(() => ({ list: vi.fn(), get: vi.fn(), encounters: vi.fn(), audit: vi.fn(), source: vi.fn(), create: vi.fn() }));
vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }));
vi.mock('@/lib/config/runtime', () => ({ parseRuntimeConfig: () => ({ syntheticDataOnly: true }) }));
vi.mock('@/lib/auth/order-workflow-access', async original => ({ ...await original<object>(),
  resolveOrderWorkflowAccess: async () => ({ organization: { id: 'org-a' }, facility: { id: 'fac-a' },
    assignment: { assignmentId: 'assignment-a' }, assignments: [], scope: { organizationId: 'org-a', facilityId: 'fac-a',
      membershipId: 'membership-a', userId: 'user-a', accessAssignmentId: 'assignment-a', role: 'clinician' } }),
}));
vi.mock('@/lib/repositories/order-workflow', async original => ({ ...await original<object>(),
  D1OrderWorkflowRepository: class {
    list = state.list; get = state.get; listEncounterOptions = state.encounters;
    recordListRead = state.audit; getRecommendationSource = state.source; createDraft = state.create;
  },
}));

import { GET, POST } from './route';

beforeEach(() => {
  vi.clearAllMocks(); state.list.mockResolvedValue([]); state.get.mockResolvedValue({ id: 'saved-order' });
  state.encounters.mockResolvedValue([]); state.audit.mockResolvedValue(undefined);
  state.source.mockResolvedValue({ recommendationId: 'rec-a', recommendationVersion: 2, encounterId: 'enc-a',
    reviewDecisionId: 'decision-a', derivativeVersionId: null, state: 'accepted', title: 'Synthetic source',
    medicalJustification: 'Synthetic accepted source content', existingOrderId: null });
  state.create.mockResolvedValue({ id: 'saved-order', current: { status: 'draft' } });
});

describe('orders API boundary', () => {
  it('loads an exact accepted source and an exact saved order beyond list pagination', async () => {
    const response = await GET(new Request('https://orion.test/api/orders?facilityId=fac-a&accessAssignmentId=assignment-a&encounterId=enc-a&recommendationId=rec-a&recommendationVersion=2&requestId=saved-order', {
      headers: { 'oai-authenticated-user-id': 'doctor-a' },
    }));
    expect(response.status).toBe(200);
    expect(state.get).toHaveBeenCalledWith('saved-order'); expect(state.list).not.toHaveBeenCalled();
    expect(state.source).toHaveBeenCalledWith({ encounterId: 'enc-a', recommendationId: 'rec-a', recommendationVersion: 2 });
    const body = await response.json() as { recommendationSource: { reviewDecisionId: string } };
    expect(body.recommendationSource.reviewDecisionId).toBe('decision-a');
  });

  it.each(['recommendationId=rec-a', 'encounterId=enc-a&recommendationId=rec-a&recommendationVersion=0',
    'encounterId=enc-a&recommendationId=rec-a&recommendationId=rec-b&recommendationVersion=2'])('rejects incomplete or ambiguous source query: %s', async query => {
    expect((await GET(new Request(`https://orion.test/api/orders?${query}`))).status).toBe(400);
    expect(state.source).not.toHaveBeenCalled();
  });

  it('does not expose changed or rejected source content', async () => {
    state.source.mockRejectedValueOnce(new OrderWorkflowConflictError('private source details'));
    const response = await GET(new Request('https://orion.test/api/orders?encounterId=enc-a&recommendationId=rec-a&recommendationVersion=2', {
      headers: { 'oai-authenticated-user-id': 'doctor-a' },
    }));
    expect(response.status).toBe(409); expect(await response.text()).not.toContain('private source details');
  });

  it('passes only the source selector to explicit draft creation and rejects forged source provenance', async () => {
    const payload = { encounterId: 'enc-a', kind: 'laboratory', priority: 'routine', requestedService: 'Synthetic examination',
      targetSpecialty: null, medicalJustification: 'Explicit clinician medical justification', clinicianNote: null,
      testDataAcknowledged: true, idempotencyKey: '00000000-0000-4000-8000-000000000001',
      recommendationSource: { recommendationId: 'rec-a', recommendationVersion: 2 } };
    const post = (body: unknown) => POST(new Request('https://orion.test/api/orders', { method: 'POST',
      headers: { origin: 'https://orion.test', 'content-type': 'application/json', 'oai-authenticated-user-id': 'doctor-a' }, body: JSON.stringify(body) }));
    const response = await post(payload);
    expect(response.status).toBe(201);
    expect(state.create).toHaveBeenCalledWith(expect.objectContaining({ recommendationSource: payload.recommendationSource }));
    const forged = await post({ ...payload, recommendationSource: { ...payload.recommendationSource, reviewDecisionId: 'forged' } });
    expect(forged.status).toBe(400); expect(state.create).toHaveBeenCalledTimes(1);
  });
  it('requires identity before reading orders or touching D1', async () => {
    const response = await GET(
      new Request(
        'https://orion.test/api/orders?facilityId=fac-a&accessAssignmentId=assignment-a',
      ),
    );
    const body = (await response.json()) as {
      error: { code: string; requestId: string };
    };

    expect(response.status).toBe(401);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(response.headers.get('x-request-id')).toBe(body.error.requestId);
    expect(body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects a cross-origin order mutation before parsing or database access', async () => {
    const response = await POST(
      new Request('https://orion.test/api/orders', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          origin: 'https://outside.example',
        },
        body: JSON.stringify({}),
      }),
    );
    const body = (await response.json()) as { error: { code: string } };

    expect(response.status).toBe(403);
    expect(body.error.code).toBe('INVALID_ORIGIN');
  });
});
