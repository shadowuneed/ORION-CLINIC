import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { requestHeaders } = vi.hoisted(() => ({ requestHeaders: vi.fn(async () => new Headers()) }));
vi.mock('next/headers', () => ({ headers: requestHeaders }));
vi.mock('../chatgpt-auth', () => ({ getChatGPTUser: vi.fn(async () => null) }));
import { getChatGPTUser } from '../chatgpt-auth';
import SignInPage from './page';

describe('cloud sign-in entry', () => {
  beforeEach(() => { requestHeaders.mockResolvedValue(new Headers()); });
  it('renders a real personal login without shared local-provider navigation', async () => {
    const html = renderToStaticMarkup(await SignInPage());
    expect(html).toContain('Вход для сотрудников');
    expect(html).toContain('type="email"');
    expect(html).toContain('type="password"');
    expect(html).toContain('autoComplete="username"');
    expect(html).toContain('autoComplete="current-password"');
    expect(html).toContain('Самостоятельная регистрация закрыта');
    expect(html).toContain('Общего технического профиля здесь нет');
    expect(html).not.toContain('/signin-with-chatgpt');
    expect(html).not.toContain('return_to');
    expect(html).not.toContain('http-equiv');
  });
  it('requires explicit sign-out to change the verified account', async () => {
    vi.mocked(getChatGPTUser).mockResolvedValueOnce({ userId: 'staff-1', displayName: 'Staff', email: 'staff@example.test', fullName: null });
    const html = renderToStaticMarkup(await SignInPage());
    expect(html).toContain('Ваш сеанс открыт');
    expect(html).toContain('staff@example.test');
    expect(html).toContain('Выйти и сменить аккаунт');
    expect(html).toContain('href="/access"');
    expect(html).not.toContain('type="password"');
    expect(html).not.toContain('/signin-with-chatgpt');
  });
  it('does not turn account metadata into a clinical role or permission', async () => {
    const html = renderToStaticMarkup(await SignInPage());
    expect(html).toContain('Права назначаются в клинике, а не выбираются на экране входа');
    expect(html).toContain('Успешный вход сам по себе не даёт доступа');
    expect(html).not.toContain('<select');
  });
  it('can explicitly renew or clear an expired access-cookie session without claiming authentication', async () => {
    requestHeaders.mockResolvedValue(new Headers({ cookie: '__Host-orion-cloud-refresh=example-refresh-cookie' }));
    const html = renderToStaticMarkup(await SignInPage());
    expect(html).toContain('Сеанс нужно обновить');
    expect(html).toContain('Продолжить сеанс');
    expect(html).toContain('Завершить сеанс и войти снова');
    expect(html).not.toContain('Ваш сеанс открыт');
    expect(html).not.toContain('example-refresh-cookie');
    expect(html).not.toContain('href="/access"');
  });
});
