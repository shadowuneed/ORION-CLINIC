import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CrmCommand } from './contracts';

const mock = vi.hoisted(() => ({
  queries: [] as { text: string; values?: unknown[] }[],
  reply: {} as unknown, release: vi.fn(), end: vi.fn(), connect: vi.fn(), options: {} as Record<string, unknown>,
}));
vi.mock('pg', () => ({ Pool: class {
  constructor(options: Record<string, unknown>) { mock.options = options; }
  on() { return this; }
  connect = mock.connect;
  end = mock.end;
} }));
import { createCrmPostgresRepository, CrmRepositoryError, type CrmPostgresConfig } from '../../scripts/crm-postgres-repository';

const config: CrmPostgresConfig = { host: '127.0.0.1', port: 55432, database: 'orion_crm_local',
  user: 'orion_crm_app', password: ['synthetic', 'test', 'input', 'only'].join('-') };
const actor = { issuer: 'test:local', subject: 'operator-a' };
const command = (): Extract<CrmCommand, { type: 'visit.transition' }> => ({ type: 'visit.transition', visitId: 'visit-a', expectedVersion: 1,
  action: 'arrive', testDataAcknowledged: true, idempotencyKey: '11111111-1111-4111-8111-111111111111' });
beforeEach(() => {
  vi.clearAllMocks(); mock.queries = []; mock.reply = { resourceId: 'visit-a', version: 2, replayed: false };
  mock.connect.mockResolvedValue({ release: mock.release, async query(text: string, values?: unknown[]) {
    mock.queries.push({ text, values }); return { rows: text.startsWith('SELECT ') ? [{ result: mock.reply }] : [] };
  } });
});
describe('dedicated CRM repository boundary', () => {
  it('has no connection environment fallback or alternate host/database/user', () => {
    expect(() => createCrmPostgresRepository({ ...config, host: 'remote.example' } as unknown as CrmPostgresConfig)).toThrow();
    expect(() => createCrmPostgresRepository({ ...config, database: 'postgres' } as unknown as CrmPostgresConfig)).toThrow();
    expect(() => createCrmPostgresRepository({ ...config, user: 'postgres' } as unknown as CrmPostgresConfig)).toThrow();
    createCrmPostgresRepository(config);
    expect(mock.options).toMatchObject({ host: '127.0.0.1', port: 55432, database: 'orion_crm_local', user: 'orion_crm_app',
      connectionTimeoutMillis: 3000, statement_timeout: 5000, lock_timeout: 2000 });
  });
  it('snapshots exact actor and command before Pool waiting', async () => {
    const repository = createCrmPostgresRepository(config); const mutableActor = { ...actor }; const mutableCommand = command();
    const promise = repository.command(mutableActor, mutableCommand);
    mutableActor.subject = 'forged'; mutableCommand.action = 'cancel';
    await expect(promise).resolves.toEqual(mock.reply);
    const request = mock.queries.find(query => query.text.startsWith('SELECT '));
    expect(request?.values?.slice(0, 2)).toEqual(['test:local', 'operator-a']);
    expect(JSON.parse(request?.values?.[2] as string).action).toBe('arrive');
  });
  it('rolls back an otherwise valid command when current session changes before commit', async () => {
    const repository = createCrmPostgresRepository(config); const denied = new Error('SESSION_CHANGED'); let checks = 0;
    await expect(repository.command(actor, command(), () => { if (++checks === 4) throw denied; })).rejects.toBe(denied);
    expect(mock.queries.map(query => query.text)).toEqual(['BEGIN', expect.stringContaining('orion_clinical_crm_command_v1'), 'ROLLBACK']);
    expect(mock.release).toHaveBeenCalledOnce();
  });
  it('does not publish malformed data or commit its transaction', async () => {
    mock.reply = { resourceId: 'visit-a', version: 2, replayed: false, privateRow: true };
    const repository = createCrmPostgresRepository(config);
    await expect(repository.command(actor, command())).rejects.toMatchObject({ code: 'CRM_UNAVAILABLE', status: 503 });
    expect(mock.queries.at(-1)?.text).toBe('ROLLBACK');
  });
  it('late response fence preserves a committed receipt and suppresses stale response', async () => {
    const repository = createCrmPostgresRepository(config); const denied = new Error('SESSION_CHANGED'); let checks = 0;
    await expect(repository.command(actor, command(), () => { if (++checks === 5) throw denied; })).rejects.toBe(denied);
    expect(mock.queries.at(-1)?.text).toBe('COMMIT');
    expect(mock.queries.some(query => query.text === 'ROLLBACK')).toBe(false);
  });
  it('maps only reviewed SQL rejections and sanitizes arbitrary database messages', async () => {
    mock.connect.mockResolvedValue({ release: mock.release, async query(text: string) {
      if (text.startsWith('SELECT ')) throw { code: 'PT409', message: 'CRM_VERSION_CONFLICT' };
      return { rows: [] };
    } });
    const repository = createCrmPostgresRepository(config);
    await expect(repository.command(actor, command())).rejects.toMatchObject({ code: 'CRM_VERSION_CONFLICT', status: 409 });
    mock.connect.mockRejectedValue(new Error('private database connection details'));
    await expect(repository.command(actor, command())).rejects.toEqual(new CrmRepositoryError('CRM_UNAVAILABLE', 503));
  });
  it.each(['CRM_SCHEDULE_CONFLICT', 'CRM_OUTSIDE_HOURS', 'CRM_PAST_SLOT', 'CRM_QUEUE_ORDER_CONFLICT', 'CRM_NO_SHOW_TOO_EARLY', 'CRM_CLINICAL_WORKFLOW_REQUIRED'] as const)(
    'exposes exact reviewed scheduling rejection %s without database details', async code => {
      mock.connect.mockResolvedValue({ release: mock.release, async query(text: string) {
        if (text.startsWith('SELECT ')) throw { code: 'PT409', message: code, detail: 'private database detail' };
        return { rows: [] };
      } });
      const repository = createCrmPostgresRepository(config);
      await expect(repository.command(actor, command())).rejects.toMatchObject({ code, status: 409, message: 'CRM request could not be completed.' });
    });
  it('does not run after close, and close is idempotent', async () => {
    const repository = createCrmPostgresRepository(config); await repository.close(); await repository.close();
    expect(mock.end).toHaveBeenCalledOnce();
    await expect(repository.command(actor, command())).rejects.toMatchObject({ code: 'CRM_UNAVAILABLE' });
    expect(mock.connect).not.toHaveBeenCalled();
  });
});
