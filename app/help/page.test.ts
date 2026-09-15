import { readFileSync } from 'node:fs';
import { renderToStaticMarkup } from 'react-dom/server';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../authenticated-clinic-page', () => ({
  getAuthenticatedClinicContext: vi.fn(async () => ({ user: {}, capabilities: {} })),
  AuthenticatedClinicPage: ({ children }: { children: ReactNode }) => children,
}));
import HelpPage from './page';
import { getAuthenticatedClinicContext } from '../authenticated-clinic-page';

describe('integrated user handbook', () => {
  it('requires the shared login and exposes an isolated accessible reader and download', async () => {
    const html = renderToStaticMarkup(await HelpPage());
    expect(getAuthenticatedClinicContext).toHaveBeenCalledWith('/help');
    expect(html).toContain('title="Иллюстрированная инструкция ORION Clinic"');
    expect(html).toContain('src="/user-guide.html"');
    expect(html).toContain('sandbox="allow-scripts allow-modals allow-downloads"');
    expect(html).not.toContain('allow-same-origin');
    expect(html).toContain('download="ORION-CLINIC-GUIDE.html"');
  });

  it('ships the exact offline handbook without missing anchors or external image dependencies', () => {
    const html = readFileSync('public/user-guide.html', 'utf8');
    expect(html).toBe(readFileSync('docs/user-guide/ORION-CLINIC-GUIDE.html', 'utf8'));
    expect([...html.matchAll(/<article id=/g)]).toHaveLength(17);
    expect([...html.matchAll(/<circle /g)]).toHaveLength(67);
    expect(html).not.toMatch(/(?:src|href)="https?:\/\//);
    const ids = new Set([...html.matchAll(/id="([^"]+)"/g)].map(match => match[1]));
    for (const match of html.matchAll(/href="#([^"]+)"/g)) expect(ids.has(match[1])).toBe(true);
  });
});
