import { afterEach, describe, expect, it, vi } from 'vitest';
import { DirectoryRequestError, directoryCommand, loadDirectory } from './directory-client';
import { directoryFixture } from './test-fixtures';

afterEach(() => vi.unstubAllGlobals());
const command = { type: 'account.create' as const, clinicId: 'crm-clinic-local', name: 'Новый сотрудник', idempotencyKey: '4652da2e-f0b4-4f4b-96ae-796e7c19ec14' };
describe('PG directory browser client', () => {
  it('loads only the exact local clinic and validates the response', async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json(directoryFixture())); vi.stubGlobal('fetch', fetch);
    expect(await loadDirectory()).toEqual(directoryFixture());
    expect(fetch.mock.calls[0][0]).toBe('/api/directory/v1/snapshot?clinicId=crm-clinic-local');
    expect(fetch.mock.calls[0][1]).toMatchObject({ cache: 'no-store' });
  });
  it('rejects a wrong-clinic or malformed successful response', async () => {
    const data = directoryFixture(); data.clinic.id = 'different-clinic';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json(data)));
    await expect(loadDirectory()).rejects.toMatchObject({ status: 502, code: 'INVALID_DIRECTORY' });
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ accounts: [] })));
    await expect(loadDirectory()).rejects.toBeInstanceOf(DirectoryRequestError);
  });
  it('does not turn a forbidden directory into a fake empty list', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ error: { code: 'FORBIDDEN', message: 'Closed' } }, { status: 403 })));
    await expect(loadDirectory()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', message: expect.stringContaining('Это не пустой список') });
  });
  it('returns the validated account receipt without claiming a password was provisioned', async () => {
    const result = { resourceId: 'membership-created', userId: 'user-created', version: 1, replayed: false };
    const fetch = vi.fn().mockResolvedValue(Response.json(result)); vi.stubGlobal('fetch', fetch);
    expect(await directoryCommand(command)).toEqual(result);
    expect(fetch.mock.calls[0][0]).toBe('/api/directory/v1/commands');
    expect(JSON.parse(fetch.mock.calls[0][1].body)).toEqual(command);
  });
  it('does not send foreign clinic commands or commands with forged identity fields', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(directoryCommand({ ...command, clinicId: 'foreign-clinic' })).rejects.toMatchObject({ code: 'INVALID_CLINIC' });
    await expect(directoryCommand({ ...command, actorId: 'owner' } as typeof command)).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();
  });
  it('requires a complete durable command receipt', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(Response.json({ success: true })));
    await expect(directoryCommand(command)).rejects.toMatchObject({ status: 502, code: 'INVALID_RECEIPT' });
  });
});
