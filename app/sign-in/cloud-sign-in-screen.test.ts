import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// Exercise real client handlers and re-renders, not only static text or source.
const hooks = vi.hoisted(() => ({ states: [] as unknown[], refs: [] as { current: unknown }[], stateIndex: 0, refIndex: 0 }));
vi.mock('react', async original => ({
  ...await original<typeof import('react')>(),
  useState(initial: unknown) {
    const index = hooks.stateIndex++;
    if (!(index in hooks.states)) hooks.states[index] = initial;
    return [hooks.states[index], (value: unknown) => { hooks.states[index] = value; }];
  },
  useRef(initial: unknown) {
    const index = hooks.refIndex++;
    return hooks.refs[index] ??= { current: initial };
  },
}));
vi.mock('next/link', () => ({ default: 'a' }));
import { CloudSignInScreen } from './cloud-sign-in-screen';

type Element = ReactElement<Record<string, unknown>>;
function all(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(all);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...all(element.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ').trim();
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'object' && 'props' in node) return text((node as Element).props.children as ReactNode);
  return String(node);
}
function render(props: Parameters<typeof CloudSignInScreen>[0] = {}) {
  hooks.stateIndex = hooks.refIndex = 0;
  return CloudSignInScreen(props);
}
function button(tree: ReactNode, name: string): Element {
  const value = all(tree).find(element => element.type === 'button' && text(element.props.children as ReactNode) === name);
  expect(value, `button ${name}`).toBeDefined();
  return value!;
}
function enterCredentials() {
  const tree = render();
  const change = (id: string, value: string) => {
    const input = all(tree).find(element => element.props.id === id)!;
    (input.props.onChange as (event: unknown) => void)({ target: { value } });
  };
  change('cloud-email', 'synthetic-staff@example.invalid');
  change('cloud-password', 'synthetic-example-password');
}
function submit(tree: ReactNode) {
  const form = all(tree).find(element => element.type === 'form')!;
  (form.props.onSubmit as (event: unknown) => void)({ preventDefault: vi.fn() });
}
const json = (body: unknown, status = 200, headers?: Record<string, string>) => Response.json(body, { status, headers });
const challenge = () => json({ csrfToken: 'n'.repeat(43) });
const replace = vi.fn();

beforeEach(() => {
  hooks.states = []; hooks.refs = []; replace.mockReset();
  vi.useFakeTimers();
  vi.stubGlobal('window', { location: { replace } });
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe('cloud sign-in recovery and bounded requests', () => {
  it('adds explicit logout/renew controls after a session appears in another tab, without resending the password', async () => {
    const send = vi.fn().mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(json({ error: { code: 'SIGN_OUT_BEFORE_ACCOUNT_CHANGE' } }, 409))
      .mockResolvedValueOnce(challenge()).mockResolvedValueOnce(json({ authenticated: false, providerSessionRevoked: true }));
    vi.stubGlobal('fetch', send);
    enterCredentials(); submit(render()); await vi.runAllTimersAsync();
    const recovery = render();
    expect(text(recovery)).toContain('Сеанс нужно обновить');
    expect(text(recovery)).toContain('Найден прежний сеанс');
    expect(text(recovery)).not.toContain('Личность подтверждена');
    expect(all(recovery).some(element => element.props.type === 'password')).toBe(false);
    expect(replace).not.toHaveBeenCalled();
    expect(button(recovery, 'Завершить сеанс и войти снова').props.type).toBe('submit');
    submit(recovery);
    await vi.runAllTimersAsync();
    expect(send.mock.calls.map(call => call[0])).toEqual([
      '/api/auth/cloud/csrf', '/api/auth/cloud/login', '/api/auth/cloud/csrf', '/api/auth/cloud/logout',
    ]);
    expect(JSON.parse(send.mock.calls[3][1].body)).toEqual({ csrfToken: 'n'.repeat(43) });
    expect(replace).toHaveBeenCalledWith('/sign-in');
  });

  it('only renews a detected session after explicit continue, without claiming the account from cookie presence', async () => {
    const send = vi.fn().mockResolvedValueOnce(challenge())
      .mockResolvedValueOnce(json({ error: { code: 'SIGN_OUT_BEFORE_ACCOUNT_CHANGE' } }, 409))
      .mockResolvedValueOnce(challenge()).mockResolvedValueOnce(json({ authenticated: true }));
    vi.stubGlobal('fetch', send);
    enterCredentials(); submit(render()); await vi.runAllTimersAsync();
    const recovery = render();
    (button(recovery, 'Попробовать продолжить сеанс').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    expect(send.mock.calls[3][0]).toBe('/api/auth/cloud/refresh');
    expect(JSON.parse(send.mock.calls[3][1].body)).not.toHaveProperty('password');
    expect(replace).toHaveBeenCalledWith('/access');
  });

  it('guards simultaneous submissions before React publishes the busy state', async () => {
    let release!: (response: Response) => void;
    const pending = new Promise<Response>(resolve => { release = resolve; });
    const send = vi.fn().mockReturnValueOnce(pending).mockResolvedValueOnce(json({ authenticated: true }));
    vi.stubGlobal('fetch', send);
    enterCredentials(); const tree = render(); submit(tree); submit(tree);
    expect(send).toHaveBeenCalledTimes(1);
    release(challenge()); await vi.runAllTimersAsync();
    expect(send).toHaveBeenCalledTimes(2);
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace).toHaveBeenCalledWith('/access');
  });

  it('bounds the combined challenge/auth wait and lets the user retry after transport failure', async () => {
    const send = vi.fn().mockRejectedValueOnce(new Error('private upstream detail'));
    vi.stubGlobal('fetch', send);
    enterCredentials(); submit(render()); await vi.runAllTimersAsync();
    expect(send.mock.calls[0][1].signal).toBeInstanceOf(AbortSignal);
    const tree = render();
    expect(text(tree)).toContain('Сервис входа временно недоступен');
    expect(text(tree)).not.toContain('private upstream detail');
    expect(button(tree, 'Войти в рабочее место').props.disabled).toBe(false);
    expect(all(tree).find(element => element.props.id === 'cloud-password')?.props.value).toBe('');
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([401, 429, 503])('ordinary login rejection %s does not invent an existing session or echo provider details', async status => {
    const send = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(json({
      error: { code: status === 401 ? 'AUTH_REJECTED' : status === 429 ? 'AUTH_RATE_LIMITED' : 'AUTH_UNAVAILABLE', message: 'private upstream detail' },
    }, status));
    vi.stubGlobal('fetch', send);
    enterCredentials(); submit(render()); await vi.runAllTimersAsync();
    const tree = render();
    expect(text(tree)).toContain('Вход для сотрудников');
    expect(text(tree)).not.toContain('Завершить сеанс');
    expect(text(tree)).not.toContain('private upstream detail');
    expect(all(tree).find(element => element.props.id === 'cloud-password')?.props.value).toBe('');
    expect(replace).not.toHaveBeenCalled();
  });

  it('clears the old page on an explicit logout even if upstream revocation could not be confirmed', async () => {
    const send = vi.fn().mockResolvedValueOnce(challenge()).mockResolvedValueOnce(json({ error: { code: 'AUTH_UNAVAILABLE' } }, 503,
      { 'X-ORION-Local-Session-Cleared': 'true' }));
    vi.stubGlobal('fetch', send);
    const tree = render({ hasStoredSession: true });
    submit(tree);
    await vi.runAllTimersAsync();
    expect(replace).toHaveBeenCalledWith('/sign-in');
    expect(send.mock.calls[1][0]).toBe('/api/auth/cloud/logout');
  });
});
