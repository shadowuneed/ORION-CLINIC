import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

const { requestHeaders } = vi.hoisted(() => ({ requestHeaders: vi.fn(async () => new Headers({ host: '127.0.0.1:3200' })) }));
vi.mock('next/headers', () => ({ headers: requestHeaders }));
vi.mock('../chatgpt-auth', () => ({ getChatGPTUser: vi.fn(async () => null) }));
vi.mock('../authenticated-clinic-page', () => ({ getAuthenticatedClinicContext: vi.fn(async () => ({ profile: { staffName: 'А. Сейдахметова', roles: ['Врач'], workplace: 'Терапия' } })) }));
import { getChatGPTUser } from '../chatgpt-auth';
import SignInPage from './page';

describe('public sign-in entry', () => {
  it('has a deliberate provider navigation and explains actual local account limits', async () => {
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ return_to: '/live?encounterId=synthetic-visit' }) }));
    expect(html).toContain('Вход для сотрудников');
    expect(html).toContain('/signin-with-chatgpt?return_to=%2Faccess');
    expect(html).toContain('target="_top"');
    expect(html).toContain('Личный логин сотрудника здесь пока не подключён');
    expect(html).toContain('Карточка пациента — медицинская запись, а не аккаунт для входа');
    expect(html).toContain('Проверить рабочий профиль');
    expect(html).not.toContain('<input');
    expect(html).not.toContain('http-equiv');
  });
  it.each([{ values: ['//foreign.test'] }, { values: ['/live', '/patients'] }])('ignores duplicate return destinations %j', async ({ values }) => {
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ return_to: values }) }));
    expect(html).toContain('/signin-with-chatgpt?return_to=%2Faccess"');
  });
  it.each(['https://foreign.test', '/sign-in?return_to=/patients', '/signed-out'])('cannot redirect login to unsafe or recursive destination %s', async value => {
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({ return_to: value }) }));
    expect(html).toContain('/signin-with-chatgpt?return_to=%2Faccess"');
    expect(html).not.toContain('foreign.test');
  });
  it('does not label a non-loopback host as an independent local password setup', async () => {
    requestHeaders.mockResolvedValueOnce(new Headers({ host: 'clinic.example.test' }));
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Вход через подключённый провайдер');
    expect(html).not.toContain('Сейчас: технический вход для разработки');
    expect(html).not.toContain('<input');
  });
  it('identifies the current employee instead of presenting another anonymous login', async () => {
    vi.mocked(getChatGPTUser).mockResolvedValueOnce({ userId: 'staff-1', displayName: 'Dev provider', email: null, fullName: null });
    const html = renderToStaticMarkup(await SignInPage({ searchParams: Promise.resolve({}) }));
    expect(html).toContain('Вы уже вошли');
    expect(html).toContain('А. Сейдахметова');
    expect(html).toContain('Техническая личность окружения: Dev provider');
    expect(html).toContain('Выбрать рабочий доступ');
    expect(html).not.toContain('/signin-with-chatgpt');
  });
});
