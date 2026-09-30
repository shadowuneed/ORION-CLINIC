import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestHeaders, sessionReader } = vi.hoisted(() => ({ requestHeaders: vi.fn(), sessionReader: vi.fn() }));
vi.mock('next/headers', () => ({ headers: requestHeaders }));
vi.mock('@/lib/cloud/database-context.server', () => ({ cloudDatabaseForPage: sessionReader }));
import { getChatGPTUser } from './chatgpt-auth';

describe('cloud server identity adapter', () => {
  beforeEach(() => { vi.resetAllMocks(); requestHeaders.mockResolvedValue(new Headers()); });
  it('accepts only the server-verified Supabase principal, not request identity headers', async () => {
    requestHeaders.mockResolvedValue(new Headers({ 'oai-user-id': 'forged-admin', 'oai-user-name': 'Forged', 'x-orion-local-login': 'admin' }));
    sessionReader.mockResolvedValue({ principal: { issuer: 'https://project.supabase.co/auth/v1', subject: 'verified-user', email: 'staff@example.test' }, sessionId: 'server-only-session' });
    expect(await getChatGPTUser()).toEqual({ userId: 'verified-user', displayName: 'staff@example.test', email: 'staff@example.test', fullName: null, issuer: 'https://project.supabase.co/auth/v1' });
    expect(sessionReader).toHaveBeenCalledOnce();
  });
  it('does not fall back to forged legacy headers without a verified cookie', async () => {
    requestHeaders.mockResolvedValue(new Headers({ 'oai-user-id': 'forged-admin', 'oai-user-name': 'Forged' }));
    sessionReader.mockRejectedValue(new Error('Unauthenticated cloud context'));
    expect(await getChatGPTUser()).toBeNull();
  });
  it('fails closed when identity verification is unavailable', async () => {
    sessionReader.mockRejectedValue(new Error('upstream failure'));
    expect(await getChatGPTUser()).toBeNull();
  });
});
