'use client';

import { lazy, Suspense, useEffect, useState } from 'react';
import { ClipboardList, HeartPulse, Activity, MessageSquareText, PanelsTopLeft } from 'lucide-react';
import { PathwayOverview } from './pathway-overview';
import styles from './pathway.module.css';

const loadOrders = () => import('../orders/orders-workspace');
const loadCare = () => import('../care/care-workspace');
const loadObservations = () => import('../observations/observation-workspace');
const loadCommunications = () => import('../communications/communications-workspace');
const OrdersWorkspace = lazy(() => loadOrders().then((module) => ({ default: module.OrdersWorkspace })));
const ChronicCareWorkspace = lazy(() => loadCare().then((module) => ({ default: module.ChronicCareWorkspace })));
const ObservationWorkspaceView = lazy(() => loadObservations().then((module) => ({ default: module.ObservationWorkspaceView })));
const CommunicationsWorkspace = lazy(() => loadCommunications().then((module) => ({ default: module.CommunicationsWorkspace })));

const views = [
  { id: 'orders', label: 'Анализы и направления', icon: ClipboardList, capability: 'orders' },
  { id: 'care', label: 'План наблюдения', icon: HeartPulse, capability: 'chronicCare' },
  { id: 'observations', label: 'Показатели', icon: Activity, capability: 'observations' },
  { id: 'communications', label: 'Связь с пациентом', icon: MessageSquareText, capability: 'communications' },
] as const;

export type PathwayView = 'overview' | (typeof views)[number]['id'];
type Capabilities = Record<(typeof views)[number]['capability'], boolean>;

export function permittedPathwayView(requested: string | undefined, capabilities: Capabilities): PathwayView | null {
  const available = views.filter((view) => capabilities[view.capability]);
  if (available.length === 0) return null;
  return available.find((view) => view.id === requested)?.id ?? 'overview';
}

export function PathwayWorkspace({ initialView, capabilities }: {
  initialView?: PathwayView;
  capabilities: Capabilities;
}) {
  const [view, setView] = useState<PathwayView | null>(() => permittedPathwayView(initialView, capabilities));
  const [visited, setVisited] = useState<PathwayView[]>(() => {
    const first = permittedPathwayView(initialView, capabilities);
    return first && first !== 'overview' ? [first] : [];
  });
  const availableViews = views.filter((item) => capabilities[item.capability]);
  useEffect(() => {
    const sync = () => {
      const next = permittedPathwayView(new URLSearchParams(window.location.search).get('view') ?? undefined, capabilities);
      setView(next);
      if (next && next !== 'overview') setVisited((current) => current.includes(next) ? current : [...current, next]);
    };
    window.addEventListener('popstate', sync);
    return () => window.removeEventListener('popstate', sync);
  }, [capabilities]);

  function select(next: PathwayView) {
    if (next !== 'overview' && !capabilities[views.find((item) => item.id === next)!.capability]) return;
    const url = new URL(window.location.href);
    url.searchParams.set('view', next);
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setView(next);
    if (next !== 'overview') setVisited((current) => current.includes(next) ? current : [...current, next]);
  }

  function warm(next: Exclude<PathwayView, 'overview'>) {
    const load = { orders: loadOrders, care: loadCare, observations: loadObservations, communications: loadCommunications }[next];
    void load();
  }

  return <main className={styles.page}>
    <div className={styles.innerBar}>
      <span className={styles.innerDots} aria-hidden="true"><i /><i /><i /></span>
      <button type="button" className={`${styles.innerTab} ${view === 'overview' ? styles.innerTabActive : ''}`} aria-current={view === 'overview' ? 'page' : undefined} onClick={() => select('overview')}><PanelsTopLeft size={16} aria-hidden="true" />Маршрут</button>
      <div className={styles.innerTabs} aria-label="Инструменты маршрута">{availableViews.map((item) => {
        const Icon = item.icon;
        return <button key={item.id} type="button" className={`${styles.innerTab} ${view === item.id ? styles.innerTabActive : ''}`} aria-current={view === item.id ? 'page' : undefined} onPointerEnter={() => warm(item.id)} onFocus={() => warm(item.id)} onClick={() => select(item.id)}><Icon size={15} aria-hidden="true" />{item.label}</button>;
      })}</div>
    </div>
    <div hidden={view !== 'overview'}><PathwayOverview capabilities={capabilities} /></div>
    <section className={styles.workspace} hidden={view === 'overview'} aria-label={views.find((item) => item.id === view)?.label ?? 'Инструменты маршрута'}>
        {visited.includes('orders') && capabilities.orders && <div className={styles.pane} hidden={view !== 'orders'}><Suspense fallback={<p className={styles.paneLoading}>Открываем назначения…</p>}><OrdersWorkspace /></Suspense></div>}
        {visited.includes('care') && capabilities.chronicCare && <div className={styles.pane} hidden={view !== 'care'}><Suspense fallback={<p className={styles.paneLoading}>Открываем план наблюдения…</p>}><ChronicCareWorkspace /></Suspense></div>}
        {visited.includes('observations') && capabilities.observations && <div className={styles.pane} hidden={view !== 'observations'}><Suspense fallback={<p className={styles.paneLoading}>Открываем показатели…</p>}><ObservationWorkspaceView /></Suspense></div>}
        {visited.includes('communications') && capabilities.communications && <div className={styles.pane} hidden={view !== 'communications'}><Suspense fallback={<p className={styles.paneLoading}>Открываем связь…</p>}><CommunicationsWorkspace /></Suspense></div>}
    </section>
  </main>;
}
