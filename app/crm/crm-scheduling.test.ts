import { createElement, isValidElement, type ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CrmSnapshot, CrmVisit, CrmVisitStatus } from '@/lib/crm/contracts';
import { CrmBookingForm, CrmScheduling, CrmVisitActions } from './crm-scheduling';
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));

const hooks = vi.hoisted(() => ({ active: false, cursor: 0, refCursor: 0, states: [] as unknown[], refs: [] as Array<{ current: unknown }> }));
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react,
    useState: ((initial: unknown) => {
      if (!hooks.active) return react.useState(initial);
      const index = hooks.cursor++;
      if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
    }) as typeof react.useState,
    useRef: ((initial: unknown) => {
      if (!hooks.active) return react.useRef(initial);
      const index = hooks.refCursor++; return hooks.refs[index] ??= { current: initial };
    }) as typeof react.useRef,
    useMemo: ((factory: () => unknown, dependencies: unknown[]) => hooks.active ? factory() : react.useMemo(factory, dependencies)) as typeof react.useMemo,
    useEffect: ((effect: () => unknown, dependencies: unknown[]) => { if (!hooks.active) react.useEffect(effect as () => void, dependencies); }) as typeof react.useEffect,
  };
});

const now = '2026-10-06T04:00:00.000Z';
function visit(id = 'visit-a', status: CrmVisitStatus = 'scheduled'): CrmVisit {
  return { id, patientId: id === 'visit-a' ? 'patient-a' : 'patient-b', staffId: 'staff-a', roomId: 'room-a', serviceId: 'service-a',
    scheduledAt: '2026-10-06T05:00:00.000Z', status, version: 3, updatedAt: now, durationMinutes: 30, bookingSource: 'booking',
    arrivedAt: null, queuedAt: null, calledAt: null, startedAt: null, completedAt: null, queueOrder: null };
}
function snapshot(): CrmSnapshot {
  return { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'clinic-a', name: 'Искусственная клиника' },
    calendar: { timeZone: 'Asia/Qyzylorda', weekdays: [1, 2, 3, 4, 5], openMinute: 540, closeMinute: 1080, source: 'synthetic_policy' },
    rooms: [{ id: 'room-a', name: 'Кабинет А', kind: 'consultation', x: 0, y: 0, width: 5, depth: 4 }],
    staff: [{ id: 'staff-a', name: 'Тестовый врач', role: 'doctor', roomId: 'room-a' }],
    services: [{ id: 'service-a', name: 'Тестовая консультация', durationMinutes: 60, roomKind: 'consultation' }],
    patients: [{ id: 'patient-a', name: 'Анна Искусственная', mrn: 'SIM-A', sex: 'female' }, { id: 'patient-b', name: 'Борис Тестовый', mrn: 'SIM-B', sex: 'male' }],
    visits: [visit()], tasks: [], events: [], capabilities: { read: true, manage: true }, generatedAt: now };
}
function render(data = snapshot(), canWrite = true, blocked = false) {
  const onCommand = vi.fn().mockResolvedValue(true); const onSelect = vi.fn();
  return { html: renderToStaticMarkup(createElement(CrmScheduling, { snapshot: data, canWrite, blocked, onCommand, onSelect })), onCommand, onSelect };
}
type Element = ReactElement<Record<string, unknown>>;
function elements(node: unknown): Element[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const value = node as Element; return [value, ...elements(value.props.children)];
}
function plainText(node: unknown): string {
  if (Array.isArray(node)) return node.map(plainText).join('');
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  return isValidElement(node) ? plainText((node as Element).props.children) : '';
}
function control(tree: unknown, label: string) { return elements(tree).find(element => element.type === 'button' && plainText(element.props.children) === label)!; }
function field(tree: unknown, label: string) {
  const parent = elements(tree).find(element => element.type === 'label' && plainText(element.props.children).startsWith(label));
  return elements(parent).find(element => element.type === 'input' || element.type === 'select')!;
}
function startInteraction() {
  hooks.active = true; hooks.states = []; hooks.refs = []; hooks.cursor = 0; hooks.refCursor = 0;
  vi.stubGlobal('HTMLElement', class {}); vi.stubGlobal('document', { activeElement: null });
  vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { fn(); return 1; });
}
function rerender<T>(render: () => T): T { hooks.cursor = 0; hooks.refCursor = 0; return render(); }
afterEach(() => { hooks.active = false; vi.unstubAllGlobals(); });

describe('CRM linked calendar and durable queue presentation', () => {
  it('leaves start to the selected drawer header while retaining it in the schedule', () => {
    const data = snapshot();
    const props = { snapshot: data, visit: data.visits[0], onCommand: vi.fn().mockResolvedValue(true), canWrite: true, blocked: false };
    const drawer = renderToStaticMarkup(createElement(CrmVisitActions, { ...props, suppressStart: true }));
    const schedule = renderToStaticMarkup(createElement(CrmVisitActions, props));
    expect(drawer).not.toContain('Начать приём'); expect(schedule.match(/Начать приём/g)).toHaveLength(1);
  });
  it('uses clinic timezone and frozen visit duration, with no command or selection on render', () => {
    const { html, onCommand, onSelect } = render();
    expect(html).toContain('Asia/Qyzylorda'); expect(html).toContain('10:00'); expect(html).toContain('30 мин');
    expect(html).toContain('Ширина цветного интервала соответствует длительности');
    expect(html).not.toContain('Время устройства'); expect(onCommand).not.toHaveBeenCalled(); expect(onSelect).not.toHaveBeenCalled();
  });
  it('retains prior-date active queue records independently of the calendar date filter', () => {
    const data = snapshot(); const old = visit('visit-b', 'queued');
    old.scheduledAt = '2026-10-05T05:00:00.000Z'; old.queuedAt = '2026-10-05T05:10:00.000Z'; old.queueOrder = 2;
    data.visits.push(old);
    const html = render(data).html;
    expect(html).toContain('Борис Тестовый'); expect(html).toContain('Дата календаря на эту очередь не влияет');
    expect(html).toContain('Ожидание на момент снимка: 1370 мин');
    expect(html).toContain('По кабинету: 1. По сотруднику: 1.');
  });
  it('keeps queue invitation guards and exposes the separate atomic clinical start', () => {
    const data = snapshot(); const first = visit('visit-a', 'queued'); const second = visit('visit-b', 'queued');
    first.queueOrder = 4; first.queuedAt = now; second.queueOrder = 5; second.queuedAt = now;
    data.visits = [second, first]; const html = render(data).html;
    expect(html).toContain('Сначала вызовите первую запись очереди');
    expect(html).toContain('Пригласить в кабинет'); expect(html).toContain('Начать приём');
    expect(html).not.toContain('Отметить неявку');
  });
  it('disables guessed legacy queue order and shows a saved called reservation explicitly', () => {
    const data = snapshot(); data.visits = [visit('visit-a', 'queued'), visit('visit-b', 'called')];
    data.visits[1].calledAt = now;
    const html = render(data).html;
    expect(html).toContain('Приглашение сохранено'); expect(html).toContain('Предварительный порядок старой записи');
    expect(html).toContain('Начать приём'); expect(html).toContain('Вернуть в очередь');
    expect(html).toContain('уже занят');
  });
  it('shows old interval conflicts and out-of-policy records without silently dropping their patient', () => {
    const data = snapshot(); const legacy = visit('visit-b'); legacy.scheduledAt = '2026-10-06T05:10:00.000Z'; legacy.bookingSource = 'catalogue_backfill';
    data.visits.push(legacy, { ...visit('visit-outside'), patientId: 'patient-b', scheduledAt: '2026-10-06T02:00:00.000Z' });
    const html = render(data).html;
    expect(html).toContain('Пересечение по загруженному состоянию'); expect(html).toContain('Запись сохранена и не скрыта');
    expect(html).toContain('Борис Тестовый'); expect(html).toContain('вне рабочего диапазона');
    expect(html).toContain('длительность закреплена при переносе каталога');
  });
  it('does not invent calendar policy or available slots for an old/incomplete snapshot', () => {
    const data = snapshot(); delete data.calendar;
    expect(render(data).html).toContain('Календарная политика не загружена');
    const html = renderToStaticMarkup(createElement(CrmBookingForm, { snapshot: data, onCommand: vi.fn(), canWrite: true, blocked: false }));
    expect(html).toContain('Слоты и запись пока недоступны'); expect(html).toContain('disabled=""');
  });
  it('requires existing test-data write capability and blocks pending state on every entry point', () => {
    expect(render(snapshot(), false).html).toContain('подтвердите работу с учебной БД');
    const data = snapshot(); data.capabilities.manage = false;
    expect(render(data, true).html).toContain('позволяет только просмотр');
    expect(render(snapshot(), true, true).html).toContain('разрешите неопределённый результат');
  });
  it('prefills only an exact existing patient without selecting an arbitrary substitute', () => {
    const props = { snapshot: snapshot(), onCommand: vi.fn(), canWrite: true, blocked: false };
    const html = renderToStaticMarkup(createElement(CrmBookingForm, { ...props, initialPatientId: 'patient-b' }));
    expect(html).toContain('value="patient-b" selected=""');
    expect(html).toContain('Подсказки времени появятся после выбора всех четырёх связей');
    const missing = renderToStaticMarkup(createElement(CrmBookingForm, { ...props, initialPatientId: 'missing' }));
    expect(missing).toContain('Указанный пациент отсутствует'); expect(missing).not.toContain('value="patient-a" selected=""');
  });
  it('keeps terminal cancelled/no-show records in the calendar and documents independent tasks', () => {
    const data = snapshot(); data.visits = [visit('visit-a', 'no_show'), visit('visit-b', 'cancelled')];
    const html = render(data).html;
    expect(html).toContain('Не явился'); expect(html).toContain('Отменён');
    expect(html).toContain('связанные задачи остаются самостоятельными');
  });
});

describe('CRM common visit controls persistence', () => {
  it('requires a separate cancellation confirmation and leaves it open after a failed root save', async () => {
    startInteraction(); const data = snapshot(); const onCommand = vi.fn().mockResolvedValue(false);
    const draw = () => CrmVisitActions({ snapshot: data, visit: data.visits[0], onCommand, canWrite: true, blocked: false });
    let tree = rerender(draw);
    (control(tree, 'Отменить визит').props.onClick as () => void)();
    expect(onCommand).not.toHaveBeenCalled(); tree = rerender(draw);
    expect(plainText(tree)).toContain('Они не завершаются и не отменяются автоматически');
    (control(tree, 'Подтвердить отмену').props.onClick as () => void)();
    await Promise.resolve(); await Promise.resolve(); tree = rerender(draw);
    expect(onCommand).toHaveBeenCalledOnce(); expect(onCommand.mock.calls[0][0]).toMatchObject({ type: 'visit.transition', visitId: 'visit-a', expectedVersion: 3, action: 'cancel', testDataAcknowledged: true });
    expect(control(tree, 'Подтвердить отмену')).toBeDefined();
  });
  it('locks synchronously against repeated clicks and closes confirmation only after true', async () => {
    startInteraction(); const data = snapshot(); let resolve: (value: boolean) => void = () => {};
    const onCommand = vi.fn().mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    const draw = () => CrmVisitActions({ snapshot: data, visit: data.visits[0], onCommand, canWrite: true, blocked: false });
    let tree = rerender(draw); (control(tree, 'Отменить визит').props.onClick as () => void)(); tree = rerender(draw);
    const click = control(tree, 'Подтвердить отмену').props.onClick as () => void;
    click(); click(); expect(onCommand).toHaveBeenCalledOnce();
    resolve(true); await Promise.resolve(); await Promise.resolve(); tree = rerender(draw);
    expect(control(tree, 'Подтвердить отмену')).toBeUndefined();
  });
  it('does not call the root writer from a programmatically invoked blocked or invalid queue action', () => {
    startInteraction(); const data = snapshot(); data.visits = [visit('visit-a', 'queued')]; data.visits[0].queueOrder = 8;
    const onCommand = vi.fn(); const tree = rerender(() => CrmVisitActions({ snapshot: data, visit: data.visits[0], onCommand, canWrite: false, blocked: false }));
    (control(tree, 'Пригласить в кабинет').props.onClick as () => void)();
    expect(onCommand).not.toHaveBeenCalled();
  });
});

describe('CRM booking form explicit scoped persistence', () => {
  function bookingDraw(props: Parameters<typeof CrmBookingForm>[0]) {
    const wrapper = CrmBookingForm(props);
    return (wrapper.type as (props: typeof wrapper.props) => unknown)(wrapper.props);
  }
  function prepare(draw: () => unknown) {
    let tree = rerender(draw);
    for (const [label, value] of [['Пациент', 'patient-a'], ['Услуга ·', 'service-a'], ['Подходящий кабинет', 'room-a'], ['Врач приёма', 'staff-a'], ['Время начала ·', '12:00']]) {
      (field(tree, label).props.onChange as (event: { target: { value: string } }) => void)({ target: { value } });
      tree = rerender(draw);
    }
    return tree;
  }
  it('submits exact existing relations in clinic timezone and preserves the chosen time on false', async () => {
    startInteraction(); const onCommand = vi.fn().mockResolvedValue(false);
    const draw = () => bookingDraw({ snapshot: snapshot(), onCommand, canWrite: true, blocked: false });
    const tree = prepare(draw);
    expect(plainText(tree)).toContain('Выбранное время доступно по загруженному состоянию');
    const form = elements(tree).find(element => element.type === 'form')!;
    (form.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    await Promise.resolve(); await Promise.resolve();
    expect(onCommand).toHaveBeenCalledOnce(); expect(onCommand.mock.calls[0][0]).toMatchObject({ type: 'visit.create', patientId: 'patient-a', roomId: 'room-a', staffId: 'staff-a', serviceId: 'service-a', scheduledAt: '2026-10-06T07:00:00.000Z', testDataAcknowledged: true });
    expect(field(rerender(draw), 'Время начала ·').props.value).toBe('12:00');
  });
  it('blocks duplicate submission synchronously and clears selected time only after confirmed true', async () => {
    startInteraction(); let resolve: (value: boolean) => void = () => {};
    const onCommand = vi.fn().mockImplementation(() => new Promise<boolean>(done => { resolve = done; }));
    const draw = () => bookingDraw({ snapshot: snapshot(), onCommand, canWrite: true, blocked: false });
    const tree = prepare(draw); const form = elements(tree).find(element => element.type === 'form')!;
    const submit = form.props.onSubmit as (event: { preventDefault: () => void }) => void;
    submit({ preventDefault: vi.fn() }); submit({ preventDefault: vi.fn() }); expect(onCommand).toHaveBeenCalledOnce();
    resolve(true); await Promise.resolve(); await Promise.resolve();
    expect(field(rerender(draw), 'Время начала ·').props.value).toBe('');
  });
  it('does not write an occupied snapshot slot or bypass missing global acknowledgment through an event handler', () => {
    startInteraction(); const onCommand = vi.fn();
    let allowed = true;
    const draw = () => bookingDraw({ snapshot: snapshot(), onCommand, canWrite: allowed, blocked: false });
    let tree = prepare(draw); allowed = false; tree = rerender(draw);
    (elements(tree).find(element => element.type === 'form')!.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    expect(onCommand).not.toHaveBeenCalled();
    allowed = true; (field(tree, 'Время начала ·').props.onChange as (event: { target: { value: string } }) => void)({ target: { value: '10:10' } }); tree = rerender(draw);
    expect(plainText(tree)).toContain('Запись на это время недоступна');
    (elements(tree).find(element => element.type === 'form')!.props.onSubmit as (event: { preventDefault: () => void }) => void)({ preventDefault: vi.fn() });
    expect(onCommand).not.toHaveBeenCalled();
  });
});
