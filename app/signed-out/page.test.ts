import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
vi.mock('../chatgpt-auth', () => ({ getChatGPTUser: vi.fn(async () => null) }));
import { getChatGPTUser } from '../chatgpt-auth';
import SignedOutPage from './page';

it('renders a public exit page with only deliberate sign-in navigation', async () => {
  const html = renderToStaticMarkup(await SignedOutPage());
  expect(html).toContain('Сеанс завершён');
  expect(html).toContain('/sign-in?return_to=%2F');
  expect(html).not.toContain('http-equiv');
  expect(html).not.toContain('/signin-with-chatgpt');
});

it('does not claim a direct visit to this page revoked an active session', async () => {
  vi.mocked(getChatGPTUser).mockResolvedValueOnce({ userId: 'synthetic-staff', displayName: 'Сотрудник', email: null, fullName: null });
  const html = renderToStaticMarkup(await SignedOutPage());
  expect(html).toContain('Сеанс ещё открыт');
  expect(html).toContain('/signout-with-chatgpt?return_to=%2Fsigned-out');
  expect(html).not.toContain('Сеанс завершён');
});
