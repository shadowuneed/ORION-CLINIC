import { describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { createElement } from 'react';

vi.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams() }));
vi.mock('../orders/orders-workspace', () => ({ OrdersWorkspace: () => createElement('div', null, 'orders-pane') }));
vi.mock('../care/care-workspace', () => ({ ChronicCareWorkspace: () => createElement('div', null, 'care-pane') }));
vi.mock('../observations/observation-workspace', () => ({ ObservationWorkspaceView: () => createElement('div', null, 'observations-pane') }));
vi.mock('../communications/communications-workspace', () => ({ CommunicationsWorkspace: () => createElement('div', null, 'communications-pane') }));

import { PathwayWorkspace, permittedPathwayView } from './pathway-workspace';

const all = { orders: true, chronicCare: true, observations: true, communications: true };

describe('patient pathway working area', () => {
  it('opens only a permitted view and falls back to the first authorized tool', () => {
    expect(permittedPathwayView('care', all)).toBe('care');
    expect(permittedPathwayView('orders', { ...all, orders: false })).toBe('overview');
    expect(permittedPathwayView(undefined, all)).toBe('overview');
    expect(permittedPathwayView('care', { ...all, orders: false, chronicCare: false, observations: false, communications: false })).toBeNull();
  });

  it('shows one tool navigation without exposing unavailable tools', () => {
    const html = renderToStaticMarkup(createElement(PathwayWorkspace, {
      initialView: 'care', capabilities: { ...all, orders: false, observations: false, communications: false },
    }));
    expect(html).toContain('Инструменты маршрута');
    expect(html).toContain('aria-current="page"');
    expect(html).not.toContain('Этапы маршрута пациента');
    expect(html).toContain('Открываем план наблюдения…');
    expect(html).not.toContain('orders-pane');
    expect(html).not.toContain('Анализы и направления');
  });
  it('opens a separate inner-platform overview by default, not an order form', () => {
    const html = renderToStaticMarkup(createElement(PathwayWorkspace, { capabilities: all }));
    expect(html).toContain('РАБОЧАЯ ОБЛАСТЬ ВНУТРИ ORION');
    expect(html).toContain('Лента маршрута');
    expect(html).toContain('Выберите пациента');
    expect(html).not.toContain('orders-pane');
  });
});
