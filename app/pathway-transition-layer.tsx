'use client';

import { useEffect, useRef, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { HeartPulse, X } from 'lucide-react';
import {
  createPathwayTransitionController,
  PATHWAY_NAVIGATION_EVENT,
  type PathwayNavigation,
  type PathwayTransition,
} from '@/lib/pathway-transition';
import styles from './pathway-transition-layer.module.css';

export function PathwayTransitionLayer() {
  const router = useRouter();
  const pathname = usePathname();
  const routerRef = useRef(router);
  const [transition, setTransition] = useState<PathwayTransition | null>(null);
  const [failed, setFailed] = useState(false);
  const layer = useRef<HTMLDivElement>(null);
  const sourceFocus = useRef<HTMLElement | null>(null);
  const pendingFocus = useRef<'ready' | 'cancelled' | 'failed' | null>(null);
  const controllerRef = useRef<ReturnType<typeof createPathwayTransitionController> | null>(null);

  useEffect(() => { routerRef.current = router; }, [router]);

  useEffect(() => {
    const controller = createPathwayTransitionController({
      navigate: (target) => routerRef.current.push(target),
      publish: setTransition,
      settled: (outcome) => {
        pendingFocus.current = outcome;
        setFailed(outcome === 'failed');
      },
    });
    controllerRef.current = controller;
    const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
    const requested = (event: Event) => {
      if (!(event instanceof CustomEvent) || motion.matches) return;
      const request = event.detail as PathwayNavigation | null;
      if (!request || typeof request.from !== 'string' || typeof request.target !== 'string' || typeof request.label !== 'string') return;
      const target = new URL(request.target, window.location.href);
      if (target.origin !== window.location.origin ||
        (request.from === '/pathway') === (target.pathname === '/pathway')) return;
      event.preventDefault();
      setFailed(false);
      sourceFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      try { routerRef.current.prefetch(request.target); } catch { /* Normal route load remains available. */ }
      controller.start(request);
    };
    const reduce = () => { if (motion.matches) controller.reduceMotion(); };
    const backForward = () => controller.cancel();
    window.addEventListener(PATHWAY_NAVIGATION_EVENT, requested);
    window.addEventListener('popstate', backForward);
    motion.addEventListener('change', reduce);
    return () => {
      window.removeEventListener(PATHWAY_NAVIGATION_EVENT, requested);
      window.removeEventListener('popstate', backForward);
      motion.removeEventListener('change', reduce);
      controller.dispose();
      controllerRef.current = null;
    };
  }, []);

  useEffect(() => {
    const controller = controllerRef.current;
    if (!transition || !controller) return;
    const root = document.documentElement;
    root.dataset.orionRoutePhase = transition.phase;
    const inertShells = new Map<HTMLElement, boolean>();
    const checkPage = () => {
      const shells = document.querySelectorAll<HTMLElement>('[data-orion-route-path]');
      for (const shell of shells) {
        if (!inertShells.has(shell)) inertShells.set(shell, shell.inert);
        shell.inert = true;
      }
      const mounted = Array.from(shells).some((shell) => shell.dataset.orionRoutePath === pathname);
      if (mounted || (shells.length === 0 && document.querySelector('main'))) controller.ready(pathname);
    };
    checkPage();
    const observer = new MutationObserver(checkPage);
    observer.observe(document.body, { childList: true, subtree: true });
    layer.current?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Tab') event.preventDefault();
      if (event.key === 'Escape') controller.cancel();
    };
    window.addEventListener('keydown', keydown, true);
    return () => {
      observer.disconnect();
      window.removeEventListener('keydown', keydown, true);
      delete root.dataset.orionRoutePhase;
      for (const [shell, wasInert] of inertShells) shell.inert = wasInert;
    };
  }, [pathname, transition]);

  useEffect(() => {
    if (transition || !pendingFocus.current) return;
    // Restore focus only after the previous effect has released the inert shell.
    const outcome = pendingFocus.current;
    pendingFocus.current = null;
    const frame = requestAnimationFrame(() => {
      const destination = document.querySelector<HTMLElement>('[data-orion-page-content]');
      if (outcome === 'ready') destination?.focus({ preventScroll: true });
      else if (sourceFocus.current?.isConnected) sourceFocus.current.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [transition]);

  return <>
    {transition && <div ref={layer} className={styles.curtain} data-direction={transition.direction}
      data-phase={transition.phase} role="status" aria-live="polite" aria-label={transition.direction === 'open' ? 'Открываем маршрут пациента' : 'Возвращаемся в рабочее пространство'} tabIndex={-1}>
      <div className={styles.scene} aria-hidden="true">
        <div className={styles.medallion}>
          <span className={styles.halo} /><span className={styles.haloOuter} />
          <HeartPulse className={styles.icon} size={52} strokeWidth={1.4} />
        </div>
        <svg className={styles.trace} viewBox="0 0 520 72" focusable="false"><path pathLength="1" d="M2 36h157l19-1 13-18 17 36 22-44 21 54 18-27h249" /></svg>
        <strong>{transition.direction === 'open' ? 'Маршрут пациента' : 'Рабочее пространство'}</strong>
        <small>{transition.direction === 'open' ? 'Рабочая область пациента' : transition.label}</small>
      </div>
    </div>}
    {failed && <div className={styles.failure} role="status">Переход занял больше времени. Попробуйте открыть раздел ещё раз.
      <button type="button" aria-label="Закрыть сообщение" onClick={() => setFailed(false)}><X size={18} /></button>
    </div>}
  </>;
}
