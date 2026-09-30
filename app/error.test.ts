import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it, vi } from 'vitest';
import RouteError from './error';

it('offers a deliberate retry without exposing internal errors or auto-redirecting', () => {
  const reset = vi.fn();
  const html = renderToStaticMarkup(createElement(RouteError, { error: new Error('private internal payload'), reset }));
  expect(html).toContain('Раздел не удалось открыть');
  expect(html).toContain('Повторить загрузку');
  expect(html).not.toContain('private internal payload');
  expect(html).not.toContain('http-equiv');
  expect(reset).not.toHaveBeenCalled();
});
