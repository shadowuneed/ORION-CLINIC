import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { regionalFacilitySnapshotSchema, regionalOverviewSchema, regionalScopeSchema } from '@/lib/regional/contracts';

// The workspace fetches only in effects. Inject the loaded state for this
// composition regression; child map/KPI implementations have independent tests.
// Do not use this harness as evidence of browser geometry or navigation effects.
const renderState = vi.hoisted(() => ({ values: [] as unknown[], index: 0,
  effects: [] as Array<() => void | (() => void)>, writes: [] as Array<{ index: number; value: unknown }>,
  buttons: [] as Array<{ children?: unknown; onClick?: () => void }>,
  previewScrollRef: null as { current: { scrollIntoView: (options: ScrollIntoViewOptions) => void } | null } | null,
  preview: null as import('./regional-facility-preview').FacilityPreviewProps | null,
  selectFacility: null as ((id: string) => void) | null,
  completeFocus: null as ((id: string, anchor?: { clientX: number; clientY: number }) => void) | null }));
vi.mock('react/jsx-runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('react/jsx-runtime')>();
  function capture(type: unknown, props: unknown) {
    if (type === 'button' && props && typeof props === 'object') renderState.buttons.push(props);
    if (type === 'div' && props && typeof props === 'object' && 'aria-label' in props
      && props['aria-label'] === 'Сводка выбранного учреждения' && 'ref' in props) {
      renderState.previewScrollRef = props.ref as typeof renderState.previewScrollRef;
    }
  }
  return { ...actual,
    jsx: (...args: Parameters<typeof actual.jsx>) => { capture(args[0], args[1]); return actual.jsx(...args); },
    jsxs: (...args: Parameters<typeof actual.jsxs>) => { capture(args[0], args[1]); return actual.jsxs(...args); },
  };
});
vi.mock('react/jsx-dev-runtime', async importOriginal => {
  const actual = await importOriginal<typeof import('react/jsx-dev-runtime')>();
  return { ...actual, jsxDEV: (...args: Parameters<typeof actual.jsxDEV>) => {
    if (args[0] === 'button' && args[1] && typeof args[1] === 'object') renderState.buttons.push(args[1]);
    if (args[0] === 'div' && args[1] && typeof args[1] === 'object' && 'aria-label' in args[1]
      && args[1]['aria-label'] === 'Сводка выбранного учреждения' && 'ref' in args[1]) {
      renderState.previewScrollRef = args[1].ref as typeof renderState.previewScrollRef;
    }
    return actual.jsxDEV(...args);
  } };
});
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  return { ...actual, useState: ((initial: unknown) => {
    const index = renderState.index++;
    const [value, setValue] = actual.useState(index < renderState.values.length ? renderState.values[index] : initial);
    return [value, (next: unknown) => { renderState.writes.push({ index, value: next }); setValue(next); }];
  }) as typeof actual.useState, useEffect: ((effect, dependencies) => {
    renderState.effects.push(effect);
    return actual.useEffect(effect, dependencies);
  }) as typeof actual.useEffect };
});
vi.mock('./regional-map', () => ({ RegionalMap: ({ active, onOpenFacility, onFacilityFocusComplete }: {
  active: boolean; onOpenFacility: (id: string) => void;
  onFacilityFocusComplete: (id: string, anchor?: { clientX: number; clientY: number }) => void;
}) => {
  renderState.selectFacility = onOpenFacility;
  renderState.completeFocus = onFacilityFocusComplete;
  return createElement('div', { 'data-testid': 'regional-map', 'data-active': active }, 'Карта из географических данных');
} }));
vi.mock('./regional-facility', () => ({ RegionalFacilityWorkspace: ({ snapshot }: { snapshot: { facility: { id: string } } }) =>
  createElement('div', { 'data-testid': 'facility-interior', 'data-facility-id': snapshot.facility.id }, 'План выбранного учреждения') }));
vi.mock('./regional-kpi-panel', () => ({ RegionalKpiPanel: () => createElement('section', { 'data-testid': 'detailed-kpi' }, 'Подробные KPI и таблица') }));
vi.mock('./regional-facility-preview', async importOriginal => {
  const actual = await importOriginal<typeof import('./regional-facility-preview')>();
  return { ...actual, RegionalFacilityPreview: (props: import('./regional-facility-preview').FacilityPreviewProps) => {
    renderState.preview = props;
    return createElement(actual.RegionalFacilityPreview, props);
  } };
});

import { RegionalWorkspace } from './regional-workspace';

const time = '2026-10-09T10:00:00.000Z';
const metrics = { hospitalCount: 1, polyclinicCount: 0, patientCount: 2, activeVisits: 1, queuedVisits: 1,
  openTasks: 1, overdueTasks: 0, completedTasks: 0, totalTasks: 1, onTimeTasks: 0, dueTasks: 0, kpiPercent: null };
const institution = { ...metrics, id: 'sozak-hospital', clinicId: 'regional-sozak-hospital', districtId: 'sozak',
  name: 'Больница · Сузакский район', kind: 'hospital' as const, latitude: 43.88, longitude: 69.18,
  address: 'Сохранённый адрес учебного учреждения', populated: true };
const access = regionalScopeSchema.parse({ schemaVersion: 1, canViewRegion: true, generatedAt: time,
  facilities: [{ id: institution.id, clinicId: institution.clinicId, districtId: institution.districtId,
    name: institution.name, kind: institution.kind, canManage: true }] });
const overview = regionalOverviewSchema.parse({ schemaVersion: 1, dataMode: 'training', generatedAt: time,
  districts: [{ ...metrics, id: 'sozak', name: 'Сузакский район', kind: 'district', regionId: 'turkestan' }],
  facilities: [institution], totals: metrics, insights: [], sourceNote: 'Связанные учебные записи PostgreSQL',
  kpiDefinition: { title: 'Задачи вовремя', formula: 'Вовремя / с наступившим сроком', periodStart: time, periodEnd: time } });
const facilitySnapshot = regionalFacilitySnapshotSchema.parse({
  schemaVersion: 1, dataMode: 'training', generatedAt: time, facility: institution,
  kpiDefinition: overview.kpiDefinition, insights: [],
  crm: { schemaVersion: 1, mode: 'synthetic_simulation', generatedAt: time,
    clinic: { id: institution.clinicId, name: institution.name }, rooms: [], staff: [], services: [],
    patients: [], visits: [], tasks: [], events: [], capabilities: { read: true, manage: false } },
  medicalRecords: [], prescriptions: [], labs: [], stocks: [], procurements: [], workTasks: [], events: [],
  capabilities: { manage: false, readPatients: true, readClinical: true, manageVisits: false, startVisits: false,
    manageTasks: false, manageLabs: false, reviewLabs: false, dispense: false, receiveProcurement: false },
});

beforeEach(() => {
  renderState.index = 0;
  renderState.effects = [];
  renderState.writes = [];
  renderState.buttons = [];
  renderState.preview = null;
  renderState.previewScrollRef = null;
  renderState.selectFacility = null;
  renderState.completeFocus = null;
  renderState.values = [access, overview, null, 'sozak', null, '', institution.id, false, false, 0,
    null, null, false, '', false, '', null, false, '', false, null];
});

describe('loaded regional dispatcher composition', () => {
  it.each(['camera-pending', 'data-pending', 'stale-camera', 'stale-snapshot', 'ready'] as const)(
    'mounts the chosen 2.5D hospital only when its camera and data destination agree: %s', state => {
      renderState.values[4] = institution.id;
      renderState.values[2] = state === 'data-pending' ? null : state === 'stale-snapshot'
        ? { ...facilitySnapshot, facility: { ...institution, id: 'previous-hospital' } } : facilitySnapshot;
      renderState.values[10] = state === 'camera-pending' ? null : state === 'stale-camera' ? 'previous-hospital' : institution.id;
      const html = renderToStaticMarkup(createElement(RegionalWorkspace, { initialFacilityId: institution.id }));
      expect(html.includes('data-testid="facility-interior"')).toBe(state === 'ready');
      expect(html).toContain(`data-active="${state !== 'ready'}"`);
      if (state === 'ready') expect(html).toContain(`data-facility-id="${institution.id}"`);
    });

  it('ignores camera completion for a previous hospital after a new target is chosen', () => {
    renderState.values[4] = institution.id;
    renderToStaticMarkup(createElement(RegionalWorkspace, { initialFacilityId: institution.id }));
    renderState.completeFocus!('previous-hospital');
    expect(renderState.writes).toEqual([]);
    renderState.completeFocus!(institution.id);
    expect(renderState.writes).toContainEqual({ index: 10, value: institution.id });
  });

  function revealPreview(mobile: boolean, reducedMotion = false) {
    renderToStaticMarkup(createElement(RegionalWorkspace));
    const scrollIntoView = vi.fn();
    if (renderState.previewScrollRef) renderState.previewScrollRef.current = { scrollIntoView };
    const browser = Object.assign(new EventTarget(), {
      location: { pathname: '/crm', search: '?area=sozak', href: 'http://127.0.0.1:3200/crm?area=sozak' },
      history: { state: {}, replaceState: vi.fn(), pushState: vi.fn() },
      matchMedia: (query: string) => ({ matches: query.includes('prefers-reduced-motion') ? reducedMotion : mobile }),
    });
    vi.useFakeTimers();
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', new EventTarget());
    const cleanups = renderState.effects.map(effect => effect());
    try {
      // IO remains deferred; this runs the real loaded-workspace preview effect.
      return scrollIntoView;
    } finally {
      cleanups.forEach(cleanup => cleanup?.());
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  }

  it('reveals the selected hospital entry after choosing a scrolled mobile list row', () => {
    expect(revealPreview(true)).toHaveBeenCalledExactlyOnceWith({ behavior: 'smooth', block: 'start' });
  });

  it('leaves desktop map and adjacent selected-hospital summary in place', () => {
    expect(revealPreview(false)).not.toHaveBeenCalled();
  });

  it('reveals the mobile hospital entry immediately when reduced motion is requested', () => {
    expect(revealPreview(true, true)).toHaveBeenCalledExactlyOnceWith({ behavior: 'auto', block: 'start' });
  });

  it.each(['closed', 'denied', 'entering', 'reports'] as const)('does not scroll to a hidden or unavailable preview: %s', state => {
    if (state === 'closed') renderState.values[6] = null;
    if (state === 'denied') {
      renderState.values[0] = null;
      renderState.values[1] = null;
    }
    if (state === 'entering') renderState.values[4] = institution.id;
    if (state === 'reports') renderState.values.push('indicators', true);
    expect(revealPreview(true)).not.toHaveBeenCalled();
  });

  it('keeps selected-institution entry in the same stage as the map instead of a detached strip above it', () => {
    const html = renderToStaticMarkup(createElement(RegionalWorkspace));
    const mapStage = html.indexOf('aria-label="Карта и учреждение"');
    const selectedSummary = html.indexOf('aria-label="Краткая сводка учреждения"');
    expect(mapStage).toBeGreaterThan(-1);
    expect(selectedSummary).toBeGreaterThan(mapStage);
    expect(html.slice(selectedSummary)).toMatch(/<button[^>]*>Войти в больницу /);
    expect(html).not.toContain('>Открыть учреждение');
  });

  it('opens on the map without mounting the detailed KPI table above the navigation destination', () => {
    const html = renderToStaticMarkup(createElement(RegionalWorkspace));
    expect(html).toContain('data-testid="regional-map"');
    expect(html.includes('data-testid="detailed-kpi"')).toBe(false);
    expect(html).toContain('aria-label="Представление CRM"');
    expect(html).toMatch(/<button[^>]*aria-pressed="true"[^>]*>.*?Карта и больницы<\/button>/);
    expect(html).toMatch(/<button[^>]*aria-pressed="false"[^>]*>.*?Показатели и отчёты<\/button>/);
    expect(html.indexOf('aria-label="Поиск по всей медицинской сети"')).toBeLessThan(html.indexOf('aria-label="Карта и учреждение"'));
  });

  it('keeps the selected territory and preview while hiding and pausing the map on the reports view', () => {
    renderState.values.push('indicators', true);
    const html = renderToStaticMarkup(createElement(RegionalWorkspace));
    expect(html).toMatch(/<div[^>]+hidden=""[^>]+aria-label="Карта и учреждение"/);
    expect(html).toContain('data-testid="regional-map" data-active="false"');
    expect(html).toContain('data-testid="detailed-kpi"');
    expect(html).toContain('Войти в больницу');
    expect(html).toContain(institution.name);
    expect(html).toContain('Сузакский район');
  });

  it('does not discard an opened report when returning to the map, preserving report filters', () => {
    renderState.values.push('map', true);
    const html = renderToStaticMarkup(createElement(RegionalWorkspace));
    expect(html).toContain('data-testid="regional-map" data-active="true"');
    expect(html).toMatch(/<section[^>]+hidden=""[^>]+aria-label="Отчёты и показатели"/);
    expect(html).toContain('data-testid="detailed-kpi"');
  });

  it('uses the selected hospital counters for operational reports instead of its entire district', () => {
    renderState.values[1] = { ...overview,
      districts: overview.districts.map(row => ({ ...row, dueTasks: 10, onTimeTasks: 8 })),
      facilities: [{ ...institution, dueTasks: 2, onTimeTasks: 1 }],
    };
    renderState.values.push('indicators', true);
    const html = renderToStaticMarkup(createElement(RegionalWorkspace));
    expect(html.includes('1 вовремя из 2 с наступившим сроком')).toBe(true);
    expect(html.includes('8 вовремя из 10 с наступившим сроком')).toBe(false);
  });

  it('does not mix another hospital findings into the selected hospital operational report', () => {
    renderState.values[1] = { ...overview, insights: [
      { id: 'own', severity: 'warning', title: 'SELECTED_HOSPITAL_FINDING', detail: 'Своя запись', districtId: 'sozak', facilityId: institution.id },
      { id: 'other', severity: 'warning', title: 'OTHER_HOSPITAL_FINDING', detail: 'Другая запись', districtId: 'sozak', facilityId: 'sozak-polyclinic' },
    ] };
    renderState.values.push('indicators', true);
    const html = renderToStaticMarkup(createElement(RegionalWorkspace));
    expect(html.includes('SELECTED_HOSPITAL_FINDING')).toBe(true);
    expect(html.includes('OTHER_HOSPITAL_FINDING')).toBe(false);
  });

  it.each(['close', 'select', 'same-territory', 'unchanged'] as const)('publishes an AI response only while its selected scope stays current: %s', async action => {
    if (action === 'select') {
      renderState.values[0] = { ...access, facilities: [...access.facilities, { ...access.facilities[0], id: 'another-hospital' }] };
      renderState.values[1] = { ...overview, facilities: [...overview.facilities, { ...institution, id: 'another-hospital' }] };
    }
    renderState.values.push('indicators', true);
    renderToStaticMarkup(createElement(RegionalWorkspace));
    let resolveResponse!: (response: Response) => void;
    const response = new Promise<Response>(resolve => { resolveResponse = resolve; });
    const fetcher = vi.fn<typeof fetch>(() => response);
    vi.stubGlobal('fetch', fetcher);
    try {
      const analyze = renderState.buttons.find(button => Array.isArray(button.children) && button.children.includes('Сводка ИИ по задачам'));
      expect(analyze?.onClick).toBeDefined();
      analyze!.onClick!();
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(fetcher.mock.calls[0][1]?.body).toBe(JSON.stringify({ facilityId: institution.id }));
      if (action === 'close') renderState.preview!.onClose();
      else if (action === 'select') renderState.selectFacility!('another-hospital');
      else if (action === 'same-territory') {
        const territory = renderState.buttons.find(button => Array.isArray(button.children) && button.children.includes('Сузакский район'));
        expect(territory?.onClick).toBeDefined();
        territory!.onClick!();
      }
      const briefing = { id: 'old-briefing', provider: 'groq', model: 'fixture', sourceHash: 'a'.repeat(64),
        generatedAt: time, reviewRequired: true, summary: 'STALE_HOSPITAL_RESPONSE', priorities: [] };
      resolveResponse(Response.json(briefing));
      // One task boundary drains the fetch/json/validation promise chain; no IO.
      await new Promise(resolve => setTimeout(resolve, 0));
      expect(renderState.writes.some(write => write.index === 16 && typeof write.value === 'object' && write.value !== null
        && 'summary' in write.value && write.value.summary === 'STALE_HOSPITAL_RESPONSE')).toBe(action === 'unchanged');
      if (action !== 'unchanged') {
        expect(renderState.writes).toContainEqual({ index: 16, value: null });
        expect(renderState.writes).toContainEqual({ index: 19, value: false });
      }
    } finally { vi.unstubAllGlobals(); }
  });

  it('removes all map, preview, and report surfaces after access is invalidated', () => {
    renderState.values[0] = null;
    renderState.values[1] = null;
    renderState.values[6] = null;
    renderState.values.push('indicators', true);
    const html = renderToStaticMarkup(createElement(RegionalWorkspace));
    for (const label of ['data-testid="regional-map"', 'data-testid="detailed-kpi"', 'Краткая сводка учреждения', institution.name]) {
      expect(html.includes(label)).toBe(false);
    }
  });

  function dispatchHistory(pathname: string, search: string) {
    renderState.values.push('indicators', true);
    renderToStaticMarkup(createElement(RegionalWorkspace));
    const browser = Object.assign(new EventTarget(), {
      location: { pathname, search, href: `http://127.0.0.1:3200${pathname}${search}` },
      history: { state: {}, replaceState: vi.fn(), pushState: vi.fn() },
    });
    vi.useFakeTimers();
    vi.stubGlobal('window', browser);
    vi.stubGlobal('document', new EventTarget());
    // Root effects run before descendant effects. Capture the real popstate
    // callback without a browser dependency; deferred IO timers stay unexecuted.
    const cleanups = renderState.effects.slice(0, 5).map(effect => effect());
    try {
      browser.dispatchEvent(new Event('popstate'));
      return browser;
    } finally {
      cleanups.forEach(cleanup => cleanup?.());
      vi.useRealTimers();
      vi.unstubAllGlobals();
    }
  }

  it('reveals the navigated map destination on browser Back even when reports were previously selected', () => {
    const browser = dispatchHistory('/crm', '?area=sozak');
    expect(browser.history.replaceState).toHaveBeenCalledWith({}, '', '/crm?area=sozak');
    expect(renderState.writes).toContainEqual({ index: 21, value: 'map' });
  });

  it.each(['/patients', '/crm?view=clinic', '/crm?view=schedule', '/crm?view=directives'])('leaves unrelated history navigation %s to the application router', destination => {
    const url = new URL(destination, 'http://127.0.0.1:3200');
    const browser = dispatchHistory(url.pathname, url.search);
    expect(browser.history.replaceState).not.toHaveBeenCalled();
    expect(renderState.writes).toEqual([]);
  });
});
