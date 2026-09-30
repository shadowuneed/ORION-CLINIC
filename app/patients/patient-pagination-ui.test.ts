import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import type { PatientDetail, PatientProfileHistoryEntry, PatientSummary } from '@/lib/repositories/patient-registry';

// A small hook driver exercises the real client handlers without adding a DOM
// dependency. State updates are published on the next explicit render.
const hooks = vi.hoisted(() => ({
  states: [] as unknown[], refs: [] as { current: unknown }[],
  memos: [] as { value: unknown; deps: unknown[] }[],
  effects: [] as { deps: unknown[]; cleanup?: () => void }[],
  pending: [] as (() => void)[], stateIndex: 0, refIndex: 0, memoIndex: 0, effectIndex: 0,
  push: vi.fn(),
}));

vi.mock('react', async importOriginal => {
  const actual = await importOriginal<typeof import('react')>();
  const unchanged = (a: unknown[], b: unknown[]) => a.length === b.length && a.every((value, index) => Object.is(value, b[index]));
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
      if (!hooks.memos[index] || !unchanged(hooks.memos[index].deps, deps)) hooks.memos[index] = { value, deps };
      return hooks.memos[index].value;
    },
    useEffect(effect: () => (() => void) | undefined, deps: unknown[]) {
      const index = hooks.effectIndex++;
      const previous = hooks.effects[index];
      if (previous && unchanged(previous.deps, deps)) return;
      hooks.pending.push(() => { previous?.cleanup?.(); hooks.effects[index] = { deps, cleanup: effect() }; });
    },
  };
});
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: hooks.push }) }));
vi.mock('next/link', () => ({ default: 'a' }));

import { PatientDirectory } from './patient-directory';
import { PatientDetailView } from './[patientId]/patient-detail';

type Element = ReactElement<Record<string, unknown>>;
function elements(node: ReactNode): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!node || typeof node !== 'object' || !('props' in node)) return [];
  const element = node as Element;
  return [element, ...elements(element.props.children as ReactNode)];
}
function text(node: ReactNode): string {
  if (Array.isArray(node)) return node.map(text).join(' ').replace(/\s+/g, ' ').trim();
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'object' && 'props' in node) return text((node as Element).props.children as ReactNode);
  return String(node);
}
function button(tree: ReactNode, label: string) {
  const match = elements(tree).find(element => element.type === 'button' && text(element.props.children as ReactNode) === label);
  expect(match, `button ${label}`).toBeDefined();
  return match!;
}
function render(component: () => ReactElement) {
  hooks.stateIndex = hooks.refIndex = hooks.memoIndex = hooks.effectIndex = 0;
  return component();
}
async function mount(component: () => ReactElement) {
  render(component);
  hooks.pending.splice(0).forEach(effect => effect());
  await vi.runOnlyPendingTimersAsync();
  return render(component);
}
function response(payload: unknown, status = 200) { return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } }); }
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const facility = 'facility-a';
const assignment = 'assignment-a';
const scope = { facility: { id: facility, name: 'Synthetic clinic' }, accessAssignment: { assignmentId: assignment } };
const summary = (id: string): PatientSummary => ({
  id, displayName: `Synthetic ${id}`, medicalRecordNumber: id, birthDate: null,
  sexAtBirth: 'not_recorded', testIin: null, phone: null, email: null, address: null,
  photoUrl: null, status: 'active', version: 1, encounterCount: 0,
  latestEncounter: null, createdAt: 1, updatedAt: 1,
});
const profile = (id: string, version: number) => ({
  id, version, status: 'active', changeReason: `Synthetic change ${version}`,
  actorDisplayName: 'Synthetic actor', createdAt: version,
} as PatientProfileHistoryEntry);
const patient = (): PatientDetail => ({
  ...summary('patient-a'), version: 3, encounters: [],
  profileHistory: [profile('history-3', 3)], profileHistoryCount: 3,
  profileHistoryPage: { hasMore: true, nextCursor: 'profile-next' },
  encountersPage: { hasMore: false, nextCursor: null },
} as PatientDetail);

beforeEach(() => {
  hooks.states = []; hooks.refs = []; hooks.memos = []; hooks.effects = []; hooks.pending = [];
  hooks.push.mockReset();
  vi.useFakeTimers();
  vi.stubGlobal('document', { cookie: '__Host-orion-cloud-generation=' + 'a'.repeat(32) });
  const location = { search: `?facilityId=${facility}&accessAssignmentId=${assignment}`, href: `https://orion.test/patients?facilityId=${facility}&accessAssignmentId=${assignment}` };
  vi.stubGlobal('window', { location, history: { replaceState: vi.fn() }, setTimeout, clearTimeout });
});
afterEach(() => {
  hooks.effects.forEach(effect => effect.cleanup?.());
  vi.useRealTimers(); vi.unstubAllGlobals();
});

describe('patient pagination client behavior', () => {
  it('loads a small cloud first page and appends the scoped continuation without duplicate rows', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...scope, patients: [summary('a'), summary('b')], page: { hasMore: true, nextCursor: 'opaque-next' } }))
      .mockResolvedValueOnce(response({ ...scope, patients: [summary('b'), summary('c')], page: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal('fetch', fetchMock);
    const component = () => PatientDirectory({ paginated: true, photoAvailable: false });
    let tree = await mount(component);
    expect(String(fetchMock.mock.calls[0][0])).toContain('limit=25');
    await (button(tree, 'Загрузить ещё пациентов').props.onClick as () => Promise<void>)();
    // onClick deliberately starts a void promise, so flush the JSON microtasks.
    await vi.runAllTimersAsync();
    tree = render(component);
    expect(text(tree)).toContain('Synthetic a');
    expect(text(tree)).toContain('Synthetic c');
    expect(elements(tree).filter(element => element.type === 'article')).toHaveLength(3);
    const next = new URL(String(fetchMock.mock.calls[1][0]), 'https://orion.test');
    expect(Object.fromEntries(next.searchParams)).toMatchObject({ limit: '25', cursor: 'opaque-next', facilityId: facility, accessAssignmentId: assignment });
    expect(text(tree)).not.toContain('Загрузить ещё пациентов');
    expect(text(tree)).not.toContain('загружена полностью');
  });

  it('retains rows after a continuation failure and offers retry plus an explicit refresh', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...scope, patients: [summary('a')], page: { hasMore: true, nextCursor: 'next' } }))
      .mockResolvedValueOnce(response({ error: { message: 'Synthetic temporary failure' } }, 503));
    vi.stubGlobal('fetch', fetchMock);
    const component = () => PatientDirectory({ paginated: true });
    let tree = await mount(component);
    (button(tree, 'Загрузить ещё пациентов').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    tree = render(component);
    expect(text(tree)).toContain('Synthetic a');
    expect(text(tree)).toContain('Synthetic temporary failure');
    expect(button(tree, 'Загрузить ещё пациентов').props.disabled).toBe(false);
    expect(button(tree, 'Обновить список с начала').props.disabled).toBe(false);
  });

  it('does not publish an old list body after the account generation changed', async () => {
    const body = deferred<unknown>();
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ status: 200, ok: true, json: () => body.promise }));
    const component = () => PatientDirectory({ paginated: true });
    await mount(component);
    document.cookie = '__Host-orion-cloud-generation=' + 'b'.repeat(32);
    body.resolve({ ...scope, patients: [summary('private-old')], page: { hasMore: false, nextCursor: null } });
    await vi.runAllTimersAsync();
    expect(text(render(component))).not.toContain('Synthetic private-old');
  });

  it('keeps a changed-version history response out of the displayed patient and preserves the old history', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...scope, patient: patient() }))
      .mockResolvedValueOnce(response({ historyKind: 'profile', patientId: 'patient-a', profileVersion: 4,
        items: [profile('wrong-version-entry', 2)], page: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal('fetch', fetchMock);
    const component = () => PatientDetailView({ patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment, photoAvailable: false, vitalsAvailable: false, encounterWorkspaceAvailable: false });
    let tree = await mount(component);
    (button(tree, 'Загрузить более ранние версии').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    tree = render(component);
    expect(text(tree)).toContain('Версия 3');
    expect(text(tree)).not.toContain('Synthetic change 2');
    expect(text(tree)).toContain('Показанные записи сохранены');
    const next = new URL(String(fetchMock.mock.calls[1][0]), 'https://orion.test');
    expect(Object.fromEntries(next.searchParams)).toMatchObject({ kind: 'profile', limit: '25', cursor: 'profile-next', facilityId: facility, accessAssignmentId: assignment });
  });

  it('loads older profile rows and explicitly disables cloud photo, vitals and workspace features', async () => {
    const value = patient();
    value.encounters = [{ id: 'encounter-a', reasonForVisit: 'Synthetic reason', status: 'draft', version: 1, updatedAt: 1 } as PatientDetail['encounters'][number]];
    value.encounterCount = 1;
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...scope, patient: value }))
      .mockResolvedValueOnce(response({ historyKind: 'profile', patientId: 'patient-a', profileVersion: 3,
        items: [profile('history-3', 3), profile('history-2', 2)], page: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal('fetch', fetchMock);
    const component = () => PatientDetailView({ patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment, photoAvailable: false, vitalsAvailable: false, encounterWorkspaceAvailable: false });
    let tree = await mount(component);
    hooks.pending.splice(0).forEach(effect => effect());
    await vi.runAllTimersAsync();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(elements(tree).find(element => element.type === 'input' && element.props.type === 'file')?.props.disabled).toBe(true);
    expect(text(tree)).toContain('Измерения и клинический рабочий стол пока недоступны');
    expect(elements(tree).filter(element => element.type === 'a').every(element => !String(element.props.href).startsWith('/?encounterId'))).toBe(true);
    (button(tree, 'Загрузить более ранние версии').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    tree = render(component);
    expect(text(tree)).toContain('Версия 2');
    expect(text(tree)).toContain('Загружено 2 из 3');
    expect(elements(tree).filter(element => element.type === 'li')).toHaveLength(2);
    expect(text(tree)).not.toContain('Загрузить более ранние версии');
  });

  it('hides old patient actions immediately when the requested context changes before the next effect', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(response({ ...scope, patient: patient(), permissions: { canUpdate: true, canArchive: true, canCreateEncounter: false } })));
    const props = { patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment, vitalsAvailable: false };
    await mount(() => PatientDetailView(props));
    const tree = render(() => PatientDetailView({ ...props, accessAssignmentId: 'other-assignment' }));
    expect(text(tree)).not.toContain('Synthetic patient-a');
    expect(text(tree)).not.toContain('Редактировать');
    expect(text(tree)).not.toContain('Архивировать');
  });

  it.each([401, 403])('clears displayed directory rows on a denied %s continuation', async status => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...scope, patients: [summary('private')], page: { hasMore: true, nextCursor: 'next' } }))
      .mockResolvedValueOnce(response({ error: { message: 'Synthetic access denial' } }, status));
    vi.stubGlobal('fetch', fetchMock);
    const component = () => PatientDirectory({ paginated: true });
    const tree = await mount(component);
    (button(tree, 'Загрузить ещё пациентов').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    const denied = render(component);
    expect(text(denied)).not.toContain('Synthetic private');
    expect(elements(denied).filter(element => element.type === 'article')).toHaveLength(0);
    expect(button(denied, 'Добавить пациента').props.disabled).toBe(true);
  });

  it.each([401, 403])('clears patient and edit form on a denied %s history request', async status => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...scope, patient: patient(), permissions: { canUpdate: true, canArchive: true, canCreateEncounter: false } }))
      .mockResolvedValueOnce(response({ error: { message: 'Synthetic access denial' } }, status));
    vi.stubGlobal('fetch', fetchMock);
    const component = () => PatientDetailView({ patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment, vitalsAvailable: false });
    let tree = await mount(component);
    (button(tree, 'Редактировать').props.onClick as () => void)();
    tree = render(component);
    expect(text(tree)).toContain('Редактировать карточку');
    (button(tree, 'Загрузить более ранние версии').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    tree = render(component);
    expect(text(tree)).not.toContain('Synthetic patient-a');
    expect(text(tree)).not.toContain('Редактировать карточку');
    expect(elements(tree).filter(element => element.props.role === 'dialog')).toHaveLength(0);
  });

  it.each([401, 403])('clears patient and form on a denied %s profile mutation', async status => {
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...scope, patient: patient(), permissions: { canUpdate: true, canArchive: true, canCreateEncounter: false } }))
      .mockResolvedValueOnce(response({ error: { message: 'Synthetic access denial' } }, status));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('FormData', class { get(name: string) { return name === 'displayName' ? 'Synthetic patient-a' : name === 'changeReason' ? 'Synthetic test update' : ''; } });
    const component = () => PatientDetailView({ patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment, vitalsAvailable: false });
    let tree = await mount(component);
    (button(tree, 'Редактировать').props.onClick as () => void)();
    tree = render(component);
    const form = elements(tree).find(element => element.type === 'form');
    await (form!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: {} });
    tree = render(component);
    expect(text(tree)).not.toContain('Synthetic patient-a');
    expect(text(tree)).not.toContain('Редактировать карточку');
    expect(elements(tree).filter(element => element.props.role === 'dialog')).toHaveLength(0);
  });

  it('keeps already loaded history after a bounded mutation and uses the new version cursor', async () => {
    const next = { ...patient(), version: 4, profileHistory: [profile('history-4', 4)], profileHistoryCount: 4,
      profileHistoryPage: { hasMore: true, nextCursor: 'new-version-cursor' } };
    const fetchMock = vi.fn().mockResolvedValueOnce(response({ ...scope, patient: patient(), permissions: { canUpdate: true, canArchive: true, canCreateEncounter: false } }))
      .mockResolvedValueOnce(response({ historyKind: 'profile', patientId: 'patient-a', profileVersion: 3, items: [profile('history-2', 2)], page: { hasMore: true, nextCursor: 'old-version-cursor' } }))
      .mockResolvedValueOnce(response({ ...scope, patient: next }))
      .mockResolvedValueOnce(response({ historyKind: 'profile', patientId: 'patient-a', profileVersion: 4, items: [profile('history-2', 2), profile('history-1', 1)], page: { hasMore: false, nextCursor: null } }));
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('FormData', class { get(name: string) { return name === 'displayName' ? 'Synthetic patient-a' : name === 'changeReason' ? 'Synthetic test update' : ''; } });
    const component = () => PatientDetailView({ patientId: 'patient-a', facilityId: facility, accessAssignmentId: assignment, vitalsAvailable: false });
    let tree = await mount(component);
    (button(tree, 'Загрузить более ранние версии').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    tree = render(component);
    (button(tree, 'Редактировать').props.onClick as () => void)();
    tree = render(component);
    const form = elements(tree).find(element => element.type === 'form');
    await (form!.props.onSubmit as (event: unknown) => Promise<void>)({ preventDefault() {}, currentTarget: {} });
    tree = render(component);
    expect(text(tree)).toContain('Версия 4');
    expect(text(tree)).toContain('Версия 3');
    expect(text(tree)).toContain('Версия 2');
    expect(text(tree)).toContain('Загружено 3 из 4');
    (button(tree, 'Загрузить более ранние версии').props.onClick as () => void)();
    await vi.runAllTimersAsync();
    tree = render(component);
    expect(new URL(String(fetchMock.mock.calls[3][0]), 'https://orion.test').searchParams.get('cursor')).toBe('new-version-cursor');
    expect(elements(tree).filter(element => element.type === 'li')).toHaveLength(4);
  });
});
