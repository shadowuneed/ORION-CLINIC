import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getCookie, requestCookies } = vi.hoisted(() => {
  const getCookie = vi.fn();
  return {
    getCookie,
    requestCookies: vi.fn(async () => ({ get: getCookie })),
  };
});

vi.mock('next/headers', () => ({ cookies: requestCookies, headers: async () => new Headers() }));
vi.mock('./client-navigation-recovery', () => ({ ClientNavigationRecovery: () => null }));
vi.mock('./pathway-transition-layer', () => ({ PathwayTransitionLayer: () => null }));
vi.mock('./local-account-boundary', () => ({ LocalAccountBoundary: ({ children }: { children: unknown }) => children }));

import RootLayout, { dynamic } from './layout';

async function renderLayout() {
  return renderToStaticMarkup(await RootLayout({ children: createElement('main', null, 'Synthetic workspace') }));
}

describe('root layout server-rendered theme', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getCookie.mockReturnValue(undefined);
  });

  it.each(['dark', 'light'])('uses the saved %s theme on the initial server render', async theme => {
    getCookie.mockReturnValue({ value: theme });

    const html = await renderLayout();

    expect(html).toContain(`data-theme="${theme}"`);
    expect(html).toContain(`style="color-scheme:${theme}"`);
    expect(html).toContain('lang="ru"');
    expect(html).toContain('<main>Synthetic workspace</main>');
    expect(requestCookies).toHaveBeenCalledOnce();
    expect(getCookie).toHaveBeenCalledExactlyOnceWith('orion-theme');
    expect(dynamic).toBe('force-dynamic');
  });

  it('defaults to light when the theme cookie is absent', async () => {
    const html = await renderLayout();

    expect(html).toContain('data-theme="light"');
    expect(html).toContain('style="color-scheme:light"');
  });

  it.each(['', 'Dark', ' dark ', 'system', 'dark" onload="alert(1)', '<script>alert(1)</script>'])(
    'defaults to light instead of rendering an invalid cookie value %j',
    async value => {
      getCookie.mockReturnValue({ value });

      const html = await renderLayout();

      expect(html).toContain('data-theme="light"');
      expect(html).toContain('style="color-scheme:light"');
      expect(html).not.toContain('data-theme="dark"');
      expect(html).not.toContain('onload=');
      expect(html).not.toContain('<script');
      expect(html).not.toContain('alert(1)');
    },
  );
});
