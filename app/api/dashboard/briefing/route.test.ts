import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('cloudflare:workers', () => ({ env: { GROQ_LLM_API_KEY: 'test-only-key' } }));
vi.mock('@/lib/auth/clinical-tool-access', () => ({
  verifyClinicalToolAccess: vi.fn(async () => ({ ok: true, identityId: crypto.randomUUID(), accessAssignmentId: 'assignment-a' })),
}));
vi.mock('@/lib/repositories/access-governance', () => ({ D1AccessGovernanceRepository: class {} }));

import { POST } from './route';
import { verifyClinicalToolAccess } from '@/lib/auth/clinical-tool-access';

const url = 'https://orion.test/api/dashboard/briefing?facilityId=fac-a&accessAssignmentId=assignment-a';
const counts = { openEncounters: 2, reviewEncounters: 0, urgentOrders: 1, overdueCareTasks: 0, manualVoiceTasks: 1, queueExceptions: 0 };
function request(body: unknown, origin = 'https://orion.test') {
  return new Request(url, { method: 'POST', headers: { Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
}

afterEach(() => vi.unstubAllGlobals());

describe('dashboard briefing provider boundary', () => {
  it('rejects requests from another origin', async () => {
    expect((await POST(request(counts, 'https://elsewhere.test'))).status).toBe(403);
  });

  it('rejects patient text and unexpected keys before contacting Groq', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(request({ ...counts, patientName: 'Do not send' }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requires a clinical assignment before contacting Groq', async () => {
    vi.mocked(verifyClinicalToolAccess).mockResolvedValueOnce({ ok: false, status: 403, code: 'clinical_tool_forbidden', message: 'No access' });
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    expect((await POST(request(counts))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends only aggregate counts and validates a short briefing', async () => {
    const fetchMock = vi.fn(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body)) as { messages: { content: string }[] };
      expect(body.messages.at(-1)?.content).toBe(JSON.stringify(counts));
      expect(String(init.body)).not.toContain('patientName');
      return Response.json({ choices: [{ message: { content: JSON.stringify({ summary: 'Одно срочное назначение и одна ручная задача связи.', priorities: ['Проверить срочное назначение.'] }) } }] });
    });
    vi.stubGlobal('fetch', fetchMock);
    const response = await POST(request(counts));
    expect(response.status).toBe(200);
    expect((await response.json() as { scope: string }).scope).toBe('aggregate_counts_only');
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
