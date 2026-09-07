import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import SignedOutPage from './page';

it('renders a public exit page with only deliberate sign-in navigation', () => {
  const html = renderToStaticMarkup(SignedOutPage());
  expect(html).toContain('Сеанс завершён');
  expect(html).toContain('/signin-with-chatgpt?return_to=%2F');
  expect(html).not.toContain('http-equiv');
});
