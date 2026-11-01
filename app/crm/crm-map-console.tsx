'use client';

import { useEffect, useId, useRef, useState, useSyncExternalStore, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, GripVertical, RotateCcw, X } from 'lucide-react';
import styles from './crm-map-console.module.css';

export type CrmMapConsoleProps = { title: string; onClose: () => void; children: ReactNode; disabled: boolean; kind: 'operations' | 'details' | 'booking' };
export type CrmConsolePoint = { x: number; y: number };
export type CrmConsoleBounds = { viewportWidth: number; viewportHeight: number; width: number; height: number };
const finite = (value: number, fallback = 0) => Number.isFinite(value) ? Math.max(0, value) : fallback;

/** Keep the full panel within the viewport when possible; its title stays reachable. */
export function boundCrmConsolePosition(point: CrmConsolePoint, bounds: CrmConsoleBounds): CrmConsolePoint {
  const viewportWidth = finite(bounds.viewportWidth), viewportHeight = finite(bounds.viewportHeight);
  const margin = Math.min(12, viewportWidth / 2);
  const top = Math.min(84, Math.max(0, viewportHeight - 48));
  const maxX = Math.max(margin, viewportWidth - finite(bounds.width) - margin);
  const maxY = Math.max(top, viewportHeight - finite(bounds.height) - 12);
  return { x: Math.max(margin, Math.min(maxX, Number.isFinite(point.x) ? point.x : margin)),
    y: Math.max(top, Math.min(maxY, Number.isFinite(point.y) ? point.y : top)) };
}

export function crmConsoleOwnsEscape(target: Element | null): boolean {
  if (!target) return false;
  return !target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"]), form, [role="dialog"], [aria-modal="true"], [data-crm-escape-owned]');
}
function mobileConsole() { return window.matchMedia('(max-width: 760px)').matches; }
function subscribeConsoleViewport(changed: () => void) {
  const media = window.matchMedia('(max-width: 760px)');
  media.addEventListener('change', changed); return () => media.removeEventListener('change', changed);
}
const subscribeClientConsole = () => () => {};
const clientConsoleSnapshot = () => true;
const serverConsoleSnapshot = () => false;

export function CrmMapConsole({ title, onClose, children, disabled, kind }: CrmMapConsoleProps) {
  const id = useId();
  const titleId = `crm-console-title-${id}`;
  const bodyId = `crm-console-body-${id}`;
  const mobile = useSyncExternalStore(subscribeConsoleViewport, mobileConsole, () => false);
  const client = useSyncExternalStore(subscribeClientConsole, clientConsoleSnapshot, serverConsoleSnapshot);
  const [position, setPosition] = useState<CrmConsolePoint | null>(null);
  const panel = useRef<HTMLElement>(null);
  const drag = useRef<{ pointerId: number; client: CrmConsolePoint; lastClient: CrmConsolePoint; origin: CrmConsolePoint; target: HTMLElement } | null>(null);

  function bounds(): CrmConsoleBounds | null {
    const rect = panel.current?.getBoundingClientRect();
    return rect ? { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight } : null;
  }
  function move(dx: number, dy: number) {
    if (disabled || mobile || mobileConsole()) return;
    const rect = panel.current?.getBoundingClientRect(); const limit = bounds();
    if (!rect || !limit) return;
    setPosition(current => boundCrmConsolePosition({ x: (current?.x ?? rect.left) + dx, y: (current?.y ?? rect.top) + dy }, limit));
  }
  function reset() { if (!disabled) { drag.current = null; setPosition(null); } }

  useEffect(() => {
    const element = panel.current;
    const initial = element?.getBoundingClientRect();
    let previous = initial ? { width: initial.width, height: initial.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight } : null;
    const constrain = () => {
      const rect = element?.getBoundingClientRect();
      if (!rect || element !== panel.current || mobileConsole()) return;
      const nextBounds = { width: rect.width, height: rect.height, viewportWidth: window.innerWidth, viewportHeight: window.innerHeight };
      if (previous && Math.abs(previous.width - rect.width) < .5 && Math.abs(previous.height - rect.height) < .5 &&
        previous.viewportWidth === nextBounds.viewportWidth && previous.viewportHeight === nextBounds.viewportHeight) return;
      previous = nextBounds;
      setPosition(current => {
        if (!current && !drag.current) return current;
        const next = boundCrmConsolePosition(current ?? { x: rect.left, y: rect.top }, nextBounds);
        if (drag.current) { drag.current.origin = next; drag.current.client = drag.current.lastClient; }
        return next.x === current?.x && next.y === current?.y ? current : next;
      });
    };
    const frame = requestAnimationFrame(constrain);
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(constrain);
    if (element) observer?.observe(element);
    window.addEventListener('resize', constrain);
    window.visualViewport?.addEventListener('resize', constrain);
    return () => {
      cancelAnimationFrame(frame); observer?.disconnect(); window.removeEventListener('resize', constrain); window.visualViewport?.removeEventListener('resize', constrain);
      const active = drag.current;
      if (active?.target.hasPointerCapture(active.pointerId)) active.target.releasePointerCapture(active.pointerId);
      drag.current = null;
    };
  }, [kind, client]);

  function beginDrag(event: PointerEvent<HTMLElement>) {
    if (disabled || mobile || mobileConsole() || event.button !== 0 || !event.isPrimary) return;
    if (event.target instanceof Element && event.target.closest('[data-crm-console-control]')) return;
    const rect = panel.current?.getBoundingClientRect();
    if (!rect) return;
    // Preserve the focused field and its selection while the title is dragged.
    event.preventDefault(); event.stopPropagation();
    const point = { x: event.clientX, y: event.clientY };
    drag.current = { pointerId: event.pointerId, client: point, lastClient: point, origin: { x: rect.left, y: rect.top }, target: event.currentTarget };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function endDrag(event: PointerEvent<HTMLElement>) {
    if (drag.current?.pointerId !== event.pointerId) return;
    drag.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }
  function keyboardMove(event: KeyboardEvent<HTMLButtonElement>) {
    if (disabled || mobile || mobileConsole()) return;
    const step = event.shiftKey ? 48 : 16;
    if (event.key === 'ArrowLeft') move(-step, 0); else if (event.key === 'ArrowRight') move(step, 0);
    else if (event.key === 'ArrowUp') move(0, -step); else if (event.key === 'ArrowDown') move(0, step);
    else if (event.key === 'Home') reset(); else return;
    event.preventDefault(); event.stopPropagation();
  }

  const content = <section ref={panel} className={`${styles.console} ${styles[kind]}`} data-crm-map-console={kind} data-crm-console-portal={client ? 'body' : 'ssr'} aria-labelledby={titleId}
    style={position ? { left: position.x, top: position.y, right: 'auto' } : undefined} onKeyDown={event => {
      if (event.key !== 'Escape' || disabled || event.defaultPrevented || !crmConsoleOwnsEscape(event.target instanceof Element ? event.target : null)) return;
      event.preventDefault(); event.stopPropagation(); onClose();
    }}>
    <header className={styles.titlebar} data-crm-console-drag-header onPointerDown={beginDrag} onPointerMove={event => {
      const current = drag.current; const limit = bounds();
      if (!current || current.pointerId !== event.pointerId || !limit || disabled || mobile || mobileConsole()) return;
      event.preventDefault(); event.stopPropagation();
      current.lastClient = { x: event.clientX, y: event.clientY };
      setPosition(boundCrmConsolePosition({ x: current.origin.x + event.clientX - current.client.x, y: current.origin.y + event.clientY - current.client.y }, limit));
    }} onPointerUp={endDrag} onPointerCancel={endDrag} onLostPointerCapture={() => { drag.current = null; }}>
      <h2><button className={styles.handle} type="button" disabled={disabled || mobile} onKeyDown={keyboardMove}
      aria-label={`Переместить окно «${title}». Стрелки — движение, Shift — крупный шаг, Home — исходное положение.`} aria-controls={bodyId} title={title}>
      <GripVertical size={17} aria-hidden="true" /><span id={titleId}>{title}</span></button></h2>
      <button className={styles.iconButton} data-crm-console-control type="button" disabled={disabled || mobile} onClick={reset} aria-label={`Вернуть исходное положение окна «${title}»`} title="Вернуть положение"><RotateCcw size={16} aria-hidden="true" /></button>
      <button className={styles.closeButton} data-crm-console-control type="button" disabled={disabled} onClick={() => { if (!disabled) onClose(); }} aria-label={`Закрыть окно «${title}» и вернуться к карте`} title="Закрыть окно"><X size={18} aria-hidden="true" /></button>
    </header>
    <nav className={styles.positionControls} aria-label={`Положение окна «${title}»`}>
      <span>Тяни окно за заголовок</span><button type="button" disabled={disabled || mobile} className={styles.moveButton} onClick={() => move(-48, 0)} aria-label="Переместить окно влево"><ArrowLeft size={14} aria-hidden="true" /></button>
      <button type="button" disabled={disabled || mobile} className={styles.moveButton} onClick={() => move(0, -48)} aria-label="Переместить окно вверх"><ArrowUp size={14} aria-hidden="true" /></button>
      <button type="button" disabled={disabled || mobile} className={styles.moveButton} onClick={() => move(0, 48)} aria-label="Переместить окно вниз"><ArrowDown size={14} aria-hidden="true" /></button>
      <button type="button" disabled={disabled || mobile} className={styles.moveButton} onClick={() => move(48, 0)} aria-label="Переместить окно вправо"><ArrowRight size={14} aria-hidden="true" /></button>
    </nav>
    <div className={styles.body} id={bodyId} data-crm-console-body>{children}</div>
  </section>;
  // Hydration starts with the same inline markup as SSR, then uses viewport
  // coordinates independently of the transformed/clipped clinical workspace.
  return client ? createPortal(content, document.body) : content;
}
