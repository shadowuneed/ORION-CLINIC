import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { regionalKpiSnapshotSchema, type RegionalKpiEvidence, type RegionalKpiSnapshot } from '@/lib/regional/kpi';
import { type RegionalKpiBriefing } from '@/lib/regional/kpi-briefing';
import { currentKpiMonth, lastCompletedKpiMonth, loadRegionalKpi, loadRegionalKpiEvidence, loadRegionalKpiBriefing, regionalKpiGroup, RegionalKpiAccessLostError,
  RegionalKpiAiBriefing, RegionalKpiBriefingContent, RegionalKpiBriefingCooldownError, RegionalKpiPanel, regionalKpiPanelScope, RegionalKpiResults } from './regional-kpi-panel';

const period = { start: '2026-09-01', end: '2026-09-30' };
function snapshot(): RegionalKpiSnapshot {
  return regionalKpiSnapshotSchema.parse({ schemaVersion: 1, dataMode: 'training', generatedAt: '2026-10-09T10:00:00Z', period,
    definitions: [{ id: 'complaints-hospital', title: 'Обоснованные жалобы: стационар', category: 'quality', sourceType: 'official',
      sourceTitle: 'Приказ МЗ РК', sourceUrl: 'https://adilet.zan.kz/rus/docs/V2000021713', sourceVersion: '2025-09-18',
      applicableKinds: ['hospital'], basis: 'ratio_per_1000', direction: 'lower', target: 1, targetPeriod: 'calendar_month',
      unit: 'на 1000', numeratorLabel: 'Обоснованные жалобы', denominatorLabel: 'Пролеченные пациенты',
      periodKind: 'interval', note: 'Редкие события требуют осторожной интерпретации.' }],
    facilities: [{ id: 'h-a', name: 'Арысская больница', kind: 'hospital', districtId: 'arys', regionId: 'turkestan' },
      { id: 'h-b', name: 'Больница без данных', kind: 'hospital', districtId: 'arys', regionId: 'turkestan' },
      { id: 'p-a', name: 'Поликлиника Арыса', kind: 'polyclinic', districtId: 'arys', regionId: 'turkestan' },
      { id: 'h-s', name: 'Больница Шымкента', kind: 'hospital', districtId: 'shymkent', regionId: 'shymkent' }],
    observations: [{ facilityId: 'h-a', indicatorId: 'complaints-hospital', numerator: 0, denominator: 240, sourceCount: 240, lastObservedAt: '2026-09-29T12:00:00Z' },
      { facilityId: 'h-s', indicatorId: 'complaints-hospital', numerator: 5, denominator: 500, sourceCount: 505, lastObservedAt: '2026-09-29T12:00:00Z' }],
  });
}
function evidence(): RegionalKpiEvidence {
  return { schemaVersion: 1, facilityId: 'h-a', indicatorId: 'complaints-hospital', period, total: 1, offset: 0, nextOffset: null,
    items: [{ id: 'care_episode:source-a', observedAt: '2026-09-29T12:00:00Z', kind: 'care_episode', label: 'Завершённое лечение', value: 1, unit: 'случай' }] };
}
function renderResults(value = snapshot(), changes: Partial<Parameters<typeof RegionalKpiResults>[0]> = {}) {
  return renderToStaticMarkup(createElement(RegionalKpiResults, { snapshot: value, scope: { regionId: 'turkestan' }, selectedIndicatorId: 'complaints-hospital',
    group: 'medical', onGroupChange: vi.fn(), tableOpen: true, filter: '', onChooseIndicator: vi.fn(), onToggleTable: vi.fn(), onFilterChange: vi.fn(), onSelectFacility: vi.fn(), onAccessLost: vi.fn(), ...changes }));
}
const signal = () => new AbortController().signal;
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('KPI panel reporting and visible scope', () => {
  it.each([
    ['2026-10-09T10:00:00Z', '2026-10-01', '2026-10-09'],
    ['2026-09-30T19:00:00Z', '2026-10-01', '2026-10-01'],
    ['2026-09-30T18:59:59Z', '2026-09-01', '2026-09-30'],
    ['2024-02-28T20:00:00Z', '2024-02-01', '2024-02-29'],
  ])('current-month shortcut ends today in clinic time, never a future month end: %s', (now, start, end) => {
    expect(currentKpiMonth(new Date(now))).toEqual({ start, end });
  });
  it.each([
    ['2026-10-09T10:00:00Z', '2026-09-01', '2026-09-30'],
    ['2026-09-30T19:00:00Z', '2026-09-01', '2026-09-30'],
    ['2026-09-30T18:59:59Z', '2026-08-01', '2026-08-31'],
    ['2024-03-01T00:00:00Z', '2024-02-01', '2024-02-29'],
    ['2026-01-01T00:00:00Z', '2025-12-01', '2025-12-31'],
  ])('uses the last complete clinic-local calendar month: %s', (now, start, end) => {
    expect(lastCompletedKpiMonth(new Date(now))).toEqual({ start, end });
  });
  it('excludes Shymkent only from the default regional total, not from assigned employee facilities', () => {
    expect(regionalKpiPanelScope({ canViewRegion: true })).toEqual({ regionId: 'turkestan' });
    expect(regionalKpiPanelScope({ canViewRegion: false })).toEqual({});
    expect(regionalKpiPanelScope({ canViewRegion: true, districtId: 'shymkent' })).toEqual({ districtId: 'shymkent' });
    expect(regionalKpiPanelScope({ canViewRegion: false, districtId: 'arys', facilityId: 'h-s' })).toEqual({ facilityId: 'h-s' });
  });
  it('has honest pending first render, explicit dates, no manufactured statistics, and no server render request', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-09T10:00:00Z'));
    const html = renderToStaticMarkup(createElement(RegionalKpiPanel, { scopeKey: 'session-a', canViewRegion: true, onAccessLost: vi.fn(), onSelectFacility: vi.fn() }));
    expect(html).toContain('Загружаем показатели из базы');
    expect(html).toContain('value="2026-09-01"'); expect(html).toContain('value="2026-09-30"');
    expect(html).toContain('Учебная БД'); expect(html).not.toContain('на 1000'); expect(fetch).not.toHaveBeenCalled();
    expect(html).toContain('Текущий месяц · по сегодня'); expect(html).toContain('Прошлый месяц');
  });
  it('renders only compatible institutions in scope, distinguishes real zero from missing, and shows evidence actions', () => {
    const html = renderResults();
    expect(html).toContain('Арысская больница'); expect(html).toContain('Больница без данных');
    expect(html).not.toContain('Больница Шымкента'); expect(html).not.toContain('Поликлиника Арыса');
    expect(html).toContain('>0</strong>'); expect(html).toContain('>—</strong>');
    expect(html).toContain('Нет записей для расчёта'); expect(html).toContain('Данные: 1/2');
    expect(html).toContain('Записи расчёта: Арысская больница'); expect(html).not.toContain('Записи расчёта: Больница без данных');
    expect(html).toContain('Учреждения отсортированы по названию, не по оценке качества');
  });
  it('keeps the table and source explanation collapsed until explicitly requested', () => {
    const html = renderResults(snapshot(), { tableOpen: false });
    expect(html).toContain('Таблица по учреждениям'); expect(html).not.toContain('<table>'); expect(html).not.toContain('<details');
  });
  it('shows official provenance and formula but does not apply monthly thresholds to arbitrary dates', () => {
    const value = snapshot(); value.period = { start: '2026-09-02', end: '2026-09-30' };
    const html = renderResults(value);
    expect(html).toContain('Методика МЗ РК'); expect(html).toContain('https://adilet.zan.kz/rus/docs/V2000021713');
    expect(html).toContain('Обоснованные жалобы ÷ Пролеченные пациенты × 1000');
    expect(html).toContain('только за полный календарный месяц'); expect(html).toContain('Без оценки по нормативу');
    expect(html).not.toContain('В пределах ориентира');
  });
  it('retains recorded complaints with missing denominator and never calls these absent records', () => {
    const value = snapshot(); value.observations[0] = { ...value.observations[0], numerator: 2, denominator: 0, sourceCount: 2 };
    const html = renderResults(value, { scope: { facilityId: 'h-a' } });
    expect(html).toContain('Нет данных для знаменателя'); expect(html).toContain('2 / 0');
    expect(html).toContain('Записи расчёта: Арысская больница'); expect(html).not.toContain('В пределах ориентира');
  });
  it('supports fast local case-insensitive table search and escapes database labels', () => {
    const value = snapshot(); value.facilities[0].name = 'Арыс <script>unsafe</script>';
    const html = renderResults(value, { filter: 'АРЫС' });
    expect(html).toContain('Арыс &lt;script&gt;unsafe&lt;/script&gt;'); expect(html).not.toContain('<script>unsafe');
    expect(html).not.toContain('Больница без данных');
    expect(renderResults(value, { filter: 'нет такого' })).toContain('По этому названию учреждений не найдено');
  });
  it('retains assigned Shymkent institution in an ordinary employee payload without other institutions', () => {
    const value = snapshot(); value.facilities = value.facilities.filter(row => row.id === 'h-s'); value.observations = value.observations.filter(row => row.facilityId === 'h-s');
    const html = renderResults(value, { scope: regionalKpiPanelScope({ canViewRegion: false }) });
    expect(html).toContain('Больница Шымкента'); expect(html).not.toContain('Арысская больница');
  });
  it('shows staffing source snapshot dates, not query refresh time, in cards and institution rows', () => {
    const value = snapshot(); value.definitions[0] = { ...value.definitions[0], id: 'doctor-staffing', title: 'Укомплектованность врачами',
      category: 'resources', basis: 'percent', target: 100, targetPeriod: 'snapshot', periodKind: 'snapshot', direction: 'higher', unit: '%' };
    value.observations = [{ ...value.observations[0], indicatorId: 'doctor-staffing', numerator: 8, denominator: 10, sourceCount: 18,
      lastObservedAt: '2026-08-31T20:00:00Z' }];
    const html = renderResults(value, { selectedIndicatorId: 'doctor-staffing' });
    expect(html.match(/Кадровый срез: 01 сент\. 2026 г\./g)).toHaveLength(2);
    expect(html).toContain('Кадровый срез: нет данных'); expect(html).not.toContain('Кадровый срез: 09 окт');
  });
  it('separates operational measures from medical/resource cards without losing the requested table selection', () => {
    const value = snapshot();
    value.definitions.push({ ...value.definitions[0], id: 'visits-completion', title: 'Завершённые визиты', category: 'operations',
      sourceType: 'internal', sourceTitle: 'Внутренний регистр', sourceUrl: null, target: null, targetPeriod: 'any', basis: 'percent' });
    value.definitions.push({ ...value.definitions[1], id: 'tasks-on-time', title: 'Задачи в срок' });
    const medical = renderResults(value, { group: 'medical' });
    expect(medical).toContain('Медицина и ресурсы'); expect(medical).toContain('Операционная работа');
    expect(medical).toContain('Обоснованные жалобы: стационар'); expect(medical).not.toContain('Завершённые визиты');
    const operations = renderResults(value, { group: 'operations', selectedIndicatorId: 'tasks-on-time', tableOpen: true });
    expect(operations).toContain('Завершённые визиты'); expect(operations).toContain('<h3>Задачи в срок</h3>');
    expect(operations).not.toContain('Обоснованные жалобы: стационар'); expect(operations).toContain('<table>');
    expect(regionalKpiGroup({ ...value.definitions[0], category: 'resources' })).toBe('medical');
    expect(regionalKpiGroup({ ...value.definitions[0], category: 'laboratory' })).toBe('medical');
    expect(regionalKpiGroup(value.definitions[1])).toBe('operations');
  });
  it('offers a way back to medical indicators when the operational group has no catalogue rows yet', () => {
    const html = renderResults(snapshot(), { group: 'operations' });
    expect(html).toContain('В этой группе нет применимых показателей'); expect(html).toContain('Медицина и ресурсы'); expect(html).not.toContain('<table>');
  });
});

describe('KPI authenticated fetch boundary', () => {
  it('uses explicit no-store same-origin reads and validates the returned period', async () => {
    const fetch = vi.fn(async () => Response.json(snapshot())); vi.stubGlobal('fetch', fetch);
    await expect(loadRegionalKpi(period, signal())).resolves.toEqual(snapshot());
    expect(fetch).toHaveBeenCalledWith('/api/regional/v1/kpi?start=2026-09-01&end=2026-09-30', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin', signal: expect.any(AbortSignal) }));
  });
  it('validates query before fetch and avoids fetching an already aborted request', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    await expect(loadRegionalKpi({ start: '2026-09-31', end: '2026-09-30' }, signal())).rejects.toThrow();
    const controller = new AbortController(); controller.abort();
    await expect(loadRegionalKpi(period, controller.signal)).rejects.toThrow(); expect(fetch).not.toHaveBeenCalled();
  });
  it.each([401, 403])('turns status %i into access loss without exposing server content', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ password: 'private', error: { message: 'internal secret' } }, { status })));
    await expect(loadRegionalKpi(period, signal())).rejects.toBeInstanceOf(RegionalKpiAccessLostError);
  });
  it('also treats changed session conflict as access loss', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'SESSION_CHANGED' } }, { status: 409 })));
    await expect(loadRegionalKpi(period, signal())).rejects.toBeInstanceOf(RegionalKpiAccessLostError);
  });
  it('rejects other institution, period, malformed payload, and private error details', async () => {
    const wrongPeriod = snapshot(); wrongPeriod.period = { ...period, start: '2026-09-02' };
    for (const response of [Response.json(wrongPeriod), Response.json({ ...snapshot(), token: 'secret' }), new Response('<html>login</html>')]) {
      vi.stubGlobal('fetch', vi.fn(async () => response)); await expect(loadRegionalKpi(period, signal())).rejects.toThrow();
    }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(snapshot())));
    await expect(loadRegionalKpi({ ...period, facilityId: 'h-a' }, signal())).rejects.toThrow('учреждению');
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { message: 'database-password-secret' } }, { status: 503 })));
    await expect(loadRegionalKpi(period, signal())).rejects.toThrow('Не удалось загрузить показатели');
  });
  it('rejects a late response after an abort even if the transport ignored the abort', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return Response.json(snapshot()); }));
    await expect(loadRegionalKpi(period, controller.signal)).rejects.toThrow();
  });
  it('checks abort again after asynchronous body parsing', async () => {
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, status: 200, json: async () => { controller.abort(); return snapshot(); } })));
    await expect(loadRegionalKpi(period, controller.signal)).rejects.toThrow();
  });
});

describe('read-only source evidence drilldown', () => {
  const query = { ...period, facilityId: 'h-a', indicatorId: 'complaints-hospital' as const, offset: 0 };
  it('requests one bounded page and validates source reference data', async () => {
    const fetch = vi.fn(async () => Response.json(evidence())); vi.stubGlobal('fetch', fetch);
    await expect(loadRegionalKpiEvidence(query, signal())).resolves.toEqual(evidence());
    expect(fetch).toHaveBeenCalledWith('/api/regional/v1/kpi/evidence?start=2026-09-01&end=2026-09-30&facilityId=h-a&indicatorId=complaints-hospital&offset=0', expect.objectContaining({ cache: 'no-store', credentials: 'same-origin' }));
  });
  it.each([{ facilityId: 'h-b' }, { indicatorId: 'complaints-polyclinic' }, { period: { ...period, end: '2026-09-29' } },
    { offset: 1, total: 2, nextOffset: null }, { patientName: 'private' }])('rejects mixed-scope or untrusted evidence: %j', patch => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...evidence(), ...patch })));
    return expect(loadRegionalKpiEvidence(query, signal())).rejects.toThrow();
  });
  it('fails closed for access loss and ignored aborts', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 403 })));
    await expect(loadRegionalKpiEvidence(query, signal())).rejects.toBeInstanceOf(RegionalKpiAccessLostError);
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return Response.json(evidence()); }));
    await expect(loadRegionalKpiEvidence(query, controller.signal)).rejects.toThrow();
  });
  it.each([
    ['pharmacy-fulfillment', 'prescription'], ['procurement-on-time', 'procurement'], ['tasks-on-time', 'work_task'],
    ['visits-completion', 'visit'], ['encounter-documentation', 'encounter'],
  ] as const)('accepts saved operational evidence for %s without fabricating a new source kind', async (indicatorId, kind) => {
    const value: RegionalKpiEvidence = { ...evidence(), indicatorId, items: [{ ...evidence().items[0], id: `${kind}:source-a`, kind, label: 'Исходная запись операции' }] };
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(value)));
    await expect(loadRegionalKpiEvidence({ ...period, facilityId: 'h-a', indicatorId, offset: 0 }, signal())).resolves.toEqual(value);
  });
});

describe('explicit KPI AI briefing', () => {
  function briefing(): RegionalKpiBriefing {
    return { id: 'briefing-a', provider: 'groq', model: 'verified-model', sourceHash: 'a'.repeat(64), generatedAt: '2026-10-09T12:00:00.000Z',
      reviewRequired: true, period, scopeType: 'region', scopeId: 'turkestan', summary: 'Показатель рассчитан для одного из двух учреждений.', priorities: ['Проверьте записи учреждения без данных.'] };
  }
  it('renders an explicit button without a provider call, and asks a multi-facility employee to select an institution', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const props = { snapshot: snapshot(), scope: { regionId: 'turkestan' }, canViewRegion: true, onAccessLost: vi.fn() };
    const html = renderToStaticMarkup(createElement(RegionalKpiAiBriefing, props));
    expect(html).toContain('Объяснить показатели'); expect(fetch).not.toHaveBeenCalled();
    const employee = renderToStaticMarkup(createElement(RegionalKpiAiBriefing, { ...props, canViewRegion: false, scope: {} }));
    expect(employee).toContain('Выберите одно учреждение'); expect(employee).toMatch(/<button[^>]+disabled=""/);
  });
  it('does not call AI without any persisted source rows', () => {
    const value = snapshot(); value.observations = [];
    const html = renderToStaticMarkup(createElement(RegionalKpiAiBriefing, { snapshot: value, scope: { regionId: 'turkestan' }, canViewRegion: true, onAccessLost: vi.fn() }));
    expect(html).toContain('Для сводки нужны исходные записи'); expect(html).toMatch(/<button[^>]+disabled=""/);
  });
  it('sends only period/scope selectors, never browser-supplied metrics or patient data', async () => {
    const fetch = vi.fn(async () => Response.json(briefing())); vi.stubGlobal('fetch', fetch);
    await expect(loadRegionalKpiBriefing(period, signal())).resolves.toEqual(briefing());
    expect(fetch).toHaveBeenCalledWith('/api/regional/v1/kpi/briefing', expect.objectContaining({ method: 'POST', credentials: 'same-origin', cache: 'no-store', body: JSON.stringify(period) }));
  });
  it.each([{ period: { ...period, start: '2026-09-02' } }, { scopeType: 'district', scopeId: 'arys' }, { scopeId: 'shymkent' }, { patientName: 'private' }])('rejects another scope, period, or unexpected data: %j', patch => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ ...briefing(), ...patch })));
    return expect(loadRegionalKpiBriefing(period, signal())).rejects.toThrow();
  });
  it('does not use failed provider text as a briefing or expose it to the user', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ summary: 'invented from failed call', error: { message: 'api-key-secret' } }, { status: 502 })));
    await expect(loadRegionalKpiBriefing(period, signal())).rejects.toThrow('временно недоступна');
  });
  it('honors a bounded cooldown without silently retrying the provider', async () => {
    const fetch = vi.fn(async () => Response.json({}, { status: 429, headers: { 'Retry-After': '99999' } })); vi.stubGlobal('fetch', fetch);
    await expect(loadRegionalKpiBriefing(period, signal())).rejects.toMatchObject({ seconds: 300 });
    expect(fetch).toHaveBeenCalledTimes(1); expect(new RegionalKpiBriefingCooldownError(60).message).toContain('60');
  });
  it('fails closed after an access loss or an ignored transport abort', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({}, { status: 403 })));
    await expect(loadRegionalKpiBriefing(period, signal())).rejects.toBeInstanceOf(RegionalKpiAccessLostError);
    const controller = new AbortController();
    vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return Response.json(briefing()); }));
    await expect(loadRegionalKpiBriefing(period, controller.signal)).rejects.toThrow();
  });
  it('shows a concise escaped draft with source date/hash/model and no generated action buttons', () => {
    const value = briefing(); value.summary = '<script>unsafe</script>'; value.priorities = ['Проверьте полноту.', 'Уточните период.', 'Откройте основания.'];
    const html = renderToStaticMarkup(createElement(RegionalKpiBriefingContent, { value }));
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;'); expect(html).not.toContain('<script>unsafe');
    expect(html.match(/<li>/g)).toHaveLength(3); expect(html).toContain('Черновик ИИ'); expect(html).toContain('verified-model');
    expect(html).toContain('a'.repeat(64)); expect(html).not.toContain('<button');
  });
});
