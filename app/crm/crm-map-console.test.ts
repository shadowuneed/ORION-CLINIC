import { createElement, isValidElement, type ReactElement, type ReactNode, type ReactPortal } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CrmMapConsole, boundCrmConsolePosition, crmConsoleOwnsEscape, type CrmMapConsoleProps } from './crm-map-console';

const hooks = vi.hoisted(() => ({ active: false, cursor: 0, refCursor: 0, states: [] as unknown[], refs: [] as Array<{ current: unknown }>, effects: [] as Array<() => void | (() => void)> }));
vi.mock('react', async importOriginal => {
  const react = await importOriginal<typeof import('react')>();
  return { ...react,
    useState: ((initial: unknown) => {
      if (!hooks.active) return react.useState(initial);
      const index = hooks.cursor++; if (!(index in hooks.states)) hooks.states[index] = typeof initial === 'function' ? initial() : initial;
      return [hooks.states[index], (next: unknown) => { hooks.states[index] = typeof next === 'function' ? next(hooks.states[index]) : next; }];
    }) as typeof react.useState,
    useRef: ((initial: unknown) => {
      if (!hooks.active) return react.useRef(initial);
      const index = hooks.refCursor++; return hooks.refs[index] ??= { current: initial };
    }) as typeof react.useRef,
    useEffect: ((effect: () => void | (() => void), dependencies: unknown[]) => { if (!hooks.active) react.useEffect(effect, dependencies); else hooks.effects.push(effect); }) as typeof react.useEffect,
    useId: () => hooks.active ? 'console-test' : react.useId(),
    useSyncExternalStore: ((subscribe: unknown, snapshot: () => unknown, server: () => unknown) => hooks.active ? snapshot() : react.useSyncExternalStore(subscribe as (onChange: () => void) => () => void, snapshot, server)) as typeof react.useSyncExternalStore,
  };
});
type ElementNode = ReactElement<Record<string, unknown>>;
function elements(node: unknown): ElementNode[] {
  if (Array.isArray(node)) return node.flatMap(elements);
  if (!isValidElement(node)) return [];
  const value = node as ElementNode; return [value, ...elements(value.props.children)];
}
function button(tree: unknown, label: string) { return elements(tree).find(node => node.type === 'button' && String(node.props['aria-label']).includes(label))!; }
function startInteraction(mobile = false) {
  hooks.active = true; hooks.cursor = 0; hooks.refCursor = 0; hooks.states = []; hooks.refs = []; hooks.effects = [];
  vi.stubGlobal('window', { innerWidth: mobile ? 390 : 1200, innerHeight: 800, matchMedia: () => ({ matches: mobile }), addEventListener: vi.fn(), removeEventListener: vi.fn() });
  vi.stubGlobal('document', { body: { nodeType: 1 } });
  vi.stubGlobal('Element', class { closest() { return null; } });
}
function rerender(draw: () => unknown): ElementNode {
  hooks.cursor = 0; hooks.refCursor = 0; hooks.effects = [];
  const result = draw(); return (isValidElement(result) ? result : (result as ReactPortal).children) as ElementNode;
}
function renderConsole(props: Omit<CrmMapConsoleProps, 'children'>, children: ReactNode) {
  const attributes: CrmMapConsoleProps = { ...props, children: undefined };
  return renderToStaticMarkup(createElement(CrmMapConsole, attributes, children));
}
afterEach(() => { hooks.active = false; vi.unstubAllGlobals(); });

describe('floating map console semantic shell', () => {
  it.each(['operations', 'details', 'booking'] as const)('renders %s over the map with persistent content and native move/close controls', kind => {
    const close = vi.fn();
    const html = renderConsole({ kind, title: 'Тестовая CRM', onClose: close, disabled: false }, createElement('input', { defaultValue: 'Несохранённое поле', 'aria-label': 'Тестовое поле' }));
    expect(html).toContain('<section'); expect(html).toContain('aria-labelledby='); expect(html).toContain(`data-crm-map-console="${kind}"`);
    expect(html).toContain('data-crm-console-portal="ssr"');
    expect(html).toContain('Несохранённое поле'); expect(html).toContain('Переместить окно влево'); expect(html).toContain('вернуться к карте');
    expect(html).not.toContain('aria-modal'); expect(html).not.toContain('role="dialog"'); expect(html).not.toContain('inert');
    expect(close).not.toHaveBeenCalled();
  });
  it('keeps pending operations from closing through native controls', () => {
    const html = renderConsole({ kind: 'booking', title: 'Запись', onClose: vi.fn(), disabled: true }, 'Форма');
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*aria-label="Закрыть окно/);
  });
});

describe('map console viewport bounds and Escape ownership', () => {
  const bounds = { viewportWidth: 1200, viewportHeight: 800, width: 300, height: 400 };
  it('contains normal movement within the visible desktop area', () => {
    expect(boundCrmConsolePosition({ x: -300, y: -300 }, bounds)).toEqual({ x: 12, y: 84 });
    expect(boundCrmConsolePosition({ x: 5000, y: 5000 }, bounds)).toEqual({ x: 888, y: 388 });
    expect(boundCrmConsolePosition({ x: 180, y: 130 }, bounds)).toEqual({ x: 180, y: 130 });
  });
  it('keeps an oversized window title reachable and normalizes invalid/tiny measurements', () => {
    expect(boundCrmConsolePosition({ x: Infinity, y: NaN }, { ...bounds, width: 2000, height: 2000 })).toEqual({ x: 12, y: 84 });
    expect(boundCrmConsolePosition({ x: 800, y: 900 }, { viewportWidth: 0, viewportHeight: 0, width: 300, height: 400 })).toEqual({ x: 0, y: 0 });
    expect(boundCrmConsolePosition({ x: 0, y: -10 }, { ...bounds, viewportHeight: 70 }).y).toBe(22);
  });
  it('leaves input/form/modal/contenteditable Escape handling to the child', () => {
    for (const match of ['input', 'textarea', 'select', 'form', 'contenteditable', 'dialog', 'data-crm-escape-owned']) {
      const closest = vi.fn((selector: string) => selector.includes(match) ? {} : null);
      expect(crmConsoleOwnsEscape({ closest } as unknown as Element)).toBe(false);
    }
    expect(crmConsoleOwnsEscape({ closest: () => null } as unknown as Element)).toBe(true);
    expect(crmConsoleOwnsEscape(null)).toBe(false);
  });
});

describe('map console native movement without replacing form state', () => {
  it('moves by keyboard controls and resets without replacing the child element', () => {
    startInteraction(); const child = createElement('input', { defaultValue: 'Незавершённая запись' });
    const draw = () => CrmMapConsole({ title: 'Пациент', kind: 'details', onClose: vi.fn(), disabled: false, children: child });
    let tree = rerender(draw);
    hooks.refs[0].current = { getBoundingClientRect: () => ({ left: 500, top: 100, width: 300, height: 400 }) };
    (button(tree, 'вправо').props.onClick as () => void)(); tree = rerender(draw);
    expect(tree.props.style).toMatchObject({ left: 548, top: 100 });
    expect(elements(tree).find(node => node.type === 'input')).toBe(child);
    (button(tree, 'Вернуть исходное').props.onClick as () => void)(); tree = rerender(draw);
    expect(tree.props.style).toBeUndefined(); expect(elements(tree).find(node => node.type === 'input')).toBe(child);
  });
  it('clamps pointer dragging and releases capture without invoking close', () => {
    startInteraction(); const close = vi.fn();
    const draw = () => CrmMapConsole({ title: 'Задачи', kind: 'operations', onClose: close, disabled: false, children: 'Данные' });
    let tree = rerender(draw); hooks.refs[0].current = { getBoundingClientRect: () => ({ left: 100, top: 100, width: 700, height: 400 }) };
    const target = { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn().mockReturnValue(true), releasePointerCapture: vi.fn() };
    const event = { currentTarget: target, pointerId: 2, isPrimary: true, button: 0, clientX: 200, clientY: 120, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    const handle = elements(tree).find(node => node.type === 'header')!;
    (handle.props.onPointerDown as (event: unknown) => void)(event);
    (handle.props.onPointerMove as (event: unknown) => void)({ ...event, clientX: 10000, clientY: 10000 }); tree = rerender(draw);
    expect(tree.props.style).toMatchObject({ left: 488, top: 388 });
    (handle.props.onPointerUp as (event: unknown) => void)(event);
    expect(target.setPointerCapture).toHaveBeenCalledWith(2); expect(target.releasePointerCapture).toHaveBeenCalledWith(2); expect(close).not.toHaveBeenCalled();
  });
  it('disables movement on mobile rather than moving the bottom sheet horizontally', () => {
    startInteraction(true); const draw = () => CrmMapConsole({ title: 'Запись', kind: 'booking', onClose: vi.fn(), disabled: false, children: 'Форма' });
    const tree = rerender(draw); hooks.refs[0].current = { getBoundingClientRect: () => ({ left: 8, top: 250, width: 374, height: 400 }) };
    expect(button(tree, 'вправо').props.disabled).toBe(true);
    (button(tree, 'вправо').props.onClick as () => void)(); expect(rerender(draw).props.style).toBeUndefined();
  });
  it('supports a large keyboard step and Home reset from the focused title handle', () => {
    startInteraction(); const draw = () => CrmMapConsole({ title: 'Команда', kind: 'operations', onClose: vi.fn(), disabled: false, children: 'Данные' });
    let tree = rerender(draw); hooks.refs[0].current = { getBoundingClientRect: () => ({ left: 200, top: 100, width: 700, height: 400 }) };
    const handle = button(tree, 'Переместить окно «');
    const key = handle.props.onKeyDown as (event: unknown) => void;
    const event = { key: 'ArrowDown', shiftKey: true, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    key(event); tree = rerender(draw); expect(tree.props.style).toMatchObject({ left: 200, top: 148 });
    expect(event.preventDefault).toHaveBeenCalledOnce(); key({ ...event, key: 'Home' }); expect(rerender(draw).props.style).toBeUndefined();
  });
  it('keeps a disabled console open even if its native close callback is invoked directly', () => {
    startInteraction(); const close = vi.fn();
    const tree = rerender(() => CrmMapConsole({ title: 'Запись', kind: 'booking', onClose: close, disabled: true, children: 'Данные' }));
    (button(tree, 'Закрыть окно').props.onClick as () => void)(); expect(close).not.toHaveBeenCalled();
  });
  it('handles Escape only for an unowned, unprevented event inside the window', () => {
    startInteraction(); class EventTargetElement { constructor(readonly owned = false) {} closest() { return this.owned ? {} : null; } }
    vi.stubGlobal('Element', EventTargetElement);
    const close = vi.fn(); const tree = rerender(() => CrmMapConsole({ title: 'Обзор', kind: 'operations', onClose: close, disabled: false, children: 'Данные' }));
    const handler = tree.props.onKeyDown as (event: unknown) => void;
    const event = { key: 'Escape', target: new EventTargetElement(true), defaultPrevented: false, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    handler(event); handler({ ...event, target: new EventTargetElement(), defaultPrevented: true }); expect(close).not.toHaveBeenCalled();
    handler({ ...event, target: new EventTargetElement() }); expect(close).toHaveBeenCalledOnce();
  });
});

describe('map console body portal and stable titlebar drag', () => {
  it('uses document.body rather than the transformed/clipped workspace as its client container', () => {
    startInteraction(); const child = createElement('input', { defaultValue: 'Незавершённое поле' });
    const props = { title: 'Пациент', kind: 'details' as const, onClose: vi.fn(), disabled: false, children: child };
    const portal = CrmMapConsole(props) as ReactPortal & { containerInfo: unknown };
    expect(portal.containerInfo).toBe(document.body);
    const tree = portal.children as ElementNode;
    hooks.refs[0].current = { parentElement: { getBoundingClientRect: () => ({ left: 80, top: 68 }) }, getBoundingClientRect: () => ({ left: 500, top: 120, width: 300, height: 400 }) };
    (button(tree, 'вправо').props.onClick as () => void)();
    const next = rerender(() => CrmMapConsole(props));
    expect(next.props.style).toMatchObject({ left: 548, top: 120 });
    expect(next.props['data-crm-console-portal']).toBe('body');
    expect(elements(next).find(node => node.type === 'input')).toBe(child);
  });
  it('does not end pointer capture on the observer initial notification or unchanged size', () => {
    startInteraction(); let notify: () => void = () => {};
    const frames: Array<() => void> = [];
    vi.stubGlobal('requestAnimationFrame', (fn: () => void) => { frames.push(fn); return frames.length; }); vi.stubGlobal('cancelAnimationFrame', vi.fn());
    vi.stubGlobal('ResizeObserver', class { constructor(fn: () => void) { notify = fn; } observe() {} disconnect() {} });
    const draw = () => CrmMapConsole({ title: 'Обзор', kind: 'operations', onClose: vi.fn(), disabled: false, children: 'Данные' });
    let tree = rerender(draw);
    hooks.refs[0].current = { getBoundingClientRect: () => ({ left: 100, top: 120, width: 700, height: 400 }) };
    const cleanup = hooks.effects[0]();
    const header = elements(tree).find(node => node.type === 'header')!;
    const target = { setPointerCapture: vi.fn(), hasPointerCapture: vi.fn().mockReturnValue(true), releasePointerCapture: vi.fn() };
    const event = { currentTarget: target, target: new Element(), pointerId: 7, isPrimary: true, button: 0, clientX: 200, clientY: 130, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (header.props.onPointerDown as (event: unknown) => void)(event);
    notify(); frames[0](); expect(target.releasePointerCapture).not.toHaveBeenCalled();
    (header.props.onPointerMove as (event: unknown) => void)({ ...event, clientX: 275, clientY: 165 }); tree = rerender(draw);
    expect(tree.props.style).toMatchObject({ left: 175, top: 155 });
    (header.props.onPointerUp as (event: unknown) => void)(event); expect(target.releasePointerCapture).toHaveBeenCalledWith(7);
    if (typeof cleanup === 'function') cleanup();
  });
  it('excludes close and reset controls from titlebar capture while allowing the title/background', () => {
    startInteraction(); class ControlElement { closest() { return {}; } }
    vi.stubGlobal('Element', ControlElement);
    const tree = rerender(() => CrmMapConsole({ title: 'Запись', kind: 'booking', onClose: vi.fn(), disabled: false, children: 'Форма' }));
    hooks.refs[0].current = { getBoundingClientRect: () => ({ left: 500, top: 120, width: 420, height: 400 }) };
    const target = { setPointerCapture: vi.fn() };
    const event = { currentTarget: target, target: new ControlElement(), pointerId: 3, isPrimary: true, button: 0, clientX: 600, clientY: 130, preventDefault: vi.fn(), stopPropagation: vi.fn() };
    (elements(tree).find(node => node.type === 'header')!.props.onPointerDown as (event: unknown) => void)(event);
    expect(target.setPointerCapture).not.toHaveBeenCalled(); expect(event.preventDefault).not.toHaveBeenCalled();
  });
});
