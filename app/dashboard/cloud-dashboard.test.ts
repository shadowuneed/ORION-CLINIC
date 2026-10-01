import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';

// Exercise the real hooks and click handlers without a new DOM dependency.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[],
  memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0,
}));
vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const same = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  return {
    ...actual,
    useState(initial: unknown) {
      const index = hooks.stateIndex++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
    },
    useRef(initial: unknown) {
      const index = hooks.refIndex++;
      if (!hooks.refs[index]) hooks.refs[index] = { current: initial };
      return hooks.refs[index];
    },
    useCallback(value: unknown, deps: unknown[]) {
      const index = hooks.memoIndex++;
      if (!hooks.memos[index] || !same(hooks.memos[index].deps, deps)) hooks.memos[index] = { value, deps };
      return hooks.memos[index].value;
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = hooks.effectIndex++;
      const previous = hooks.effects[index];
      if (previous && same(previous.deps, deps)) return;
      hooks.pending.push(() => { previous?.cleanup?.(); hooks.effects[index] = { deps, cleanup: effect() }; });
    },
  };
});
vi.mock('next/link', () => ({ default: 'a' }));
vi.mock('@/lib/workspace-access-context', () => {
  const request = (input: string, init?: RequestInit) => fetch(input, init);
  return { useWorkspaceFetch: () => request };
});

import { CloudDashboard } from './cloud-dashboard';

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const value = node as Element;
  return [value, ...elements(value.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ').trim();
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'object' && 'props' in node) return text((node as Element).props.children as ReactNode);
  return String(node);
}
function button(tree: ReactNode, label: string) {
  const match = elements(tree).find(value => value.type === 'button' && text(value.props.children as ReactNode) === label);
  expect(match, `button ${label}`).toBeDefined();
  return match!;
}
function render(props = scope) {
  hooks.stateIndex = hooks.refIndex = hooks.memoIndex = hooks.effectIndex = 0;
  return CloudDashboard(props);
}
async function effects() {
  hooks.pending.splice(0).forEach(effect => effect());
  await vi.runOnlyPendingTimersAsync();
}
async function mount() { render(); await effects(); return render(); }
async function click(tree: ReactNode, label: string) {
  (button(tree, label).props.onClick as () => void)();
  await vi.runAllTimersAsync();
  return render();
}
function response(body: unknown, status = 200) { return Response.json(body, { status }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { resolve, promise };
}
const scope = { facilityId: 'facility-a', accessAssignmentId: 'assignment-a' };
function patient(index = 0, status: 'active' | 'inactive' | 'merged' = 'active') {
  return { id: `patient-${index}`, displayName: `Persisted patient ${index}`, medicalRecordNumber: `MRN-${index}`,
    version: index + 1, status, updatedAt: 1_000_000 - index };
}
function payload(patients = [patient()], hasMore = false) {
  return { facility: { id: scope.facilityId, name: 'Persisted clinic' },
    accessAssignment: { assignmentId: scope.accessAssignmentId }, patients,
    page: { hasMore, nextCursor: hasMore ? 'opaque-cursor' : null }, observedAt: 2_000_000, persistence: 'supabase' };
}

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.pending = [];
  vi.useFakeTimers();
  vi.stubGlobal('document', { cookie: '__Host-orion-cloud-generation=' + 'a'.repeat(32) });
});
afterEach(() => {
  hooks.effects.forEach(effect => effect.cleanup?.());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('truthful cloud registry dashboard', () => {
  it('keeps initial navigation and loading markup stable across SSR and hydration', () => {
    vi.stubGlobal('document', undefined);
    const server = render();
    vi.stubGlobal('document', { cookie: '__Host-orion-cloud-generation=' + 'a'.repeat(32) });
    const client = render();
    expect(text(client)).toBe(text(server));
    const hrefs = (tree: ReactNode) => elements(tree).filter(element => element.type === 'a').map(element => element.props.href);
    expect(hrefs(client)).toEqual(hrefs(server));
  });

  it('uses one bounded scoped GET, actual fields and only working registry links', async () => {
    const fetchMock = vi.fn().mockResolvedValue(response(payload()));
    vi.stubGlobal('fetch', fetchMock);
    const tree = await mount();
    const url = new URL(fetchMock.mock.calls[0][0], 'https://orion.test');
    expect(url.pathname).toBe('/api/patients');
    expect(Object.fromEntries(url.searchParams)).toEqual({ status: 'all', limit: '25', ...scope });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', credentials: 'same-origin' });
    expect(text(tree)).toContain('Persisted patient 0');
    expect(text(tree)).toContain('MRN-0');
    expect(text(tree)).toContain('Версия 1');
    expect(text(tree)).toContain('Источник: Supabase');
    expect(text(tree)).toContain('Проверено сервером:');
    const links = elements(tree).filter(element => element.type === 'a');
    expect(links.every(element => new URL(String(element.props.href), 'https://orion.test').pathname.startsWith('/patients'))).toBe(true);
    expect(text(tree)).toContain('не полная история');
    expect(text(tree)).toContain('Не подключены к центру');
    await vi.advanceTimersByTimeAsync(120_000);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('labels a full 25-row page with more records as partial, never as clinic totals', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload(Array.from({ length: 25 }, (_, index) => patient(index)), true))));
    const tree = await mount();
    expect(elements(tree).filter(element => element.type === 'li')).toHaveLength(25);
    expect(text(tree)).toContain('Показаны 25 последних карт. Есть другие записи в реестре.');
    expect(text(tree)).toContain('Это не счётчик клинических задач');
    expect(text(tree)).not.toContain('Всего пациентов');
    expect(text(tree)).not.toContain('Нет срочных');
    expect(elements(tree).some(element => element.props.id === 'cloud-sample-analytics')).toBe(false);
  });

  it('opens analytics only by the real button, using current sample counts and explicit limits', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(payload(Array.from({ length: 25 }, (_, index) => patient(index, index === 1 ? 'inactive' : 'active')), true))));
    let tree = await mount();
    expect(elements(tree).some(element => element.props.id === 'cloud-sample-analytics')).toBe(false);
    tree = await click(tree, 'Аналитика выборки');
    expect(elements(tree).some(element => element.props.id === 'cloud-sample-analytics')).toBe(true);
    expect(text(tree)).toContain('Не общие показатели клиники');
    expect(text(tree)).toContain('часть реестра не загружена');
    expect(button(tree, 'Скрыть аналитику').props['aria-expanded']).toBe(true);
    tree = await click(tree, 'Скрыть аналитику');
    expect(elements(tree).some(element => element.props.id === 'cloud-sample-analytics')).toBe(false);
  });

  it('distinguishes a successful empty registry from an unavailable source', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(payload([]))).mockResolvedValueOnce(response({ error: { message: 'Private provider detail' } }, 503)));
    let tree = await mount();
    expect(text(tree)).toContain('В этом контуре пока нет карт');
    expect(text(tree)).toContain('Источник ответил успешно');
    tree = await click(tree, 'Обновить');
    expect(text(tree)).toContain('Не удалось загрузить изменения');
    expect(text(tree)).not.toContain('В этом контуре пока нет карт');
    expect(text(tree)).not.toContain('Private provider detail');
  });

  it.each([401, 403, 409])('clears existing rows and analytics on a denied refresh (%s)', async status => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(payload())).mockResolvedValueOnce(response({ error: { message: 'Denied' } }, status)));
    let tree = await mount();
    tree = await click(tree, 'Аналитика выборки');
    tree = await click(tree, 'Обновить');
    expect(text(tree)).not.toContain('Persisted patient 0');
    expect(elements(tree).some(element => element.props.id === 'cloud-sample-analytics')).toBe(false);
    expect(text(tree)).toContain(status === 403 ? 'Нет доступа к изменениям карт' : 'Нужно подтвердить вход');
  });

  it.each(['facility', 'assignment'])('rejects a mismatched %s response without publishing its rows', async field => {
    const body = payload();
    if (field === 'facility') body.facility.id = 'other-facility';
    else body.accessAssignment.assignmentId = 'other-assignment';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(body)));
    const tree = await mount();
    expect(text(tree)).toContain('Рабочий контур не подтверждён');
    expect(text(tree)).not.toContain('Persisted patient 0');
    expect(text(tree)).not.toContain('Persisted clinic');
  });

  it('hides old scope immediately before the replacement effect and loads its new scope', async () => {
    const nextBody = deferred<unknown>();
    const fetchMock = vi.fn().mockResolvedValueOnce(response(payload()))
      .mockResolvedValueOnce({ status: 200, ok: true, json: () => nextBody.promise });
    vi.stubGlobal('fetch', fetchMock);
    await mount();
    const nextScope = { ...scope, accessAssignmentId: 'assignment-b' };
    let tree = render(nextScope);
    expect(text(tree)).not.toContain('Persisted patient 0');
    await effects();
    tree = render(nextScope);
    expect(text(tree)).toContain('Загружаем сохранённые карты');
    nextBody.resolve({ ...payload([patient(1)]), accessAssignment: { assignmentId: nextScope.accessAssignmentId } });
    await vi.runAllTimersAsync();
    expect(text(render(nextScope))).toContain('Persisted patient 1');
  });

  it('rejects late JSON after an account switch and hides a previously loaded account immediately', async () => {
    const body = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response(payload()))
      .mockResolvedValueOnce({ status: 200, ok: true, json: () => body.promise }));
    let tree = await mount();
    expect(text(tree)).toContain('Persisted patient 0');
    (button(tree, 'Обновить').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    document.cookie = '__Host-orion-cloud-generation=' + 'b'.repeat(32);
    body.resolve(payload([patient(99)]));
    await vi.runAllTimersAsync();
    tree = render();
    expect(text(tree)).not.toContain('Persisted patient 99');
    expect(text(tree)).not.toContain('Persisted patient 0');
  });

  it('drops a late response from a superseded scope even if its transport ignores abort', async () => {
    const oldBody = deferred<unknown>();
    const fetchMock = vi.fn().mockResolvedValueOnce({ status: 200, ok: true, json: () => oldBody.promise })
      .mockResolvedValueOnce(response({ ...payload([patient(1)]), facility: { id: 'facility-b', name: 'Second persisted clinic' } }));
    vi.stubGlobal('fetch', fetchMock);
    await mount();
    const nextScope = { ...scope, facilityId: 'facility-b' };
    render(nextScope); await effects();
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
    expect(text(render(nextScope))).toContain('Second persisted clinic');
    oldBody.resolve(payload([patient(99)]));
    await vi.runAllTimersAsync();
    expect(text(render(nextScope))).not.toContain('Persisted patient 99');
    expect(text(render(nextScope))).toContain('Persisted patient 1');
  });

  it('projects away patient contacts and shows unknown provenance instead of inventing a source/time', async () => {
    const value = { ...payload(), observedAt: undefined, persistence: undefined,
      patients: [{ ...patient(), phone: 'PRIVATE-CONTACT', testIin: '123456789012', address: 'PRIVATE-ADDRESS' }] };
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(value)));
    const tree = await mount();
    expect(text(tree)).toContain('Источник не подтверждён');
    expect(text(tree)).toContain('Время проверки источника не указано');
    expect(text(tree)).not.toContain('PRIVATE-');
    expect(JSON.stringify(hooks.states)).not.toContain('PRIVATE-');
    expect(JSON.stringify(hooks.states)).not.toContain('123456789012');
  });

  it.each([
    ['oversized page', () => payload(Array.from({ length: 26 }, (_, index) => patient(index)))],
    ['duplicate identities', () => payload([patient(), patient()])],
    ['unbounded time', () => payload([{ ...patient(), updatedAt: Number.MAX_SAFE_INTEGER }])],
    ['wrong order', () => payload([patient(1), patient(0)])],
    ['invalid patient URL identity', () => payload([{ ...patient(), id: '../outside' }])],
  ])('fails closed for %s', async (_label, factory) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response(factory())));
    const tree = await mount();
    expect(text(tree)).toContain('Не удалось загрузить изменения');
    expect(elements(tree).filter(element => element.type === 'li')).toHaveLength(0);
  });

  it('does not request an invalid scope or an absent account generation', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    render({ ...scope, facilityId: 'invalid/facility' }); await effects();
    expect(text(render({ ...scope, facilityId: 'invalid/facility' }))).toContain('Рабочий контур не подтверждён');
    expect(fetchMock).not.toHaveBeenCalled();
    document.cookie = '';
    render(); await effects();
    expect(text(render())).toContain('Нужно подтвердить вход');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
