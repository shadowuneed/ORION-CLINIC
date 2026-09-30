'use client';

import { OrionMark } from '@/app/brand/orion-brand';
import { useCallback, useEffect, useRef, useState } from 'react';
import { PathwayLink as Link } from './pathway-link';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { ArrowUpRight, RefreshCw, Search, CalendarClock, ClipboardList, HeartPulse, BarChart3, PhoneCall, AlertCircle, Sparkles, BellRing, CheckCheck, Clock3, ChevronDown } from 'lucide-react';
import { dashboardBriefingResponseSchema } from '@/lib/dashboard-briefing';
import { dashboardSummaryUrl, summarizeDashboardSource, type DashboardModule, type DashboardSource } from '@/lib/dashboard-summary';
import { recentEncounterDates } from '@/lib/dashboard-activity';
import { dashboardSignals, prioritizedSignals, type DashboardSignal } from '@/lib/dashboard-events';
import { dashboardWorkItems, sortDashboardWork, type DashboardWorkItem } from '@/lib/dashboard-work-items';
import type { AccessibleEncounter } from '@/lib/auth/workspace-access';
import { useWorkspaceCanManage, useWorkspaceFetch, useWorkspaceUrl } from '@/lib/workspace-access-context';
import styles from './clinic-dashboard.module.css';

const labels: Record<AccessibleEncounter['status'], string> = {
  draft: 'Черновик', ready: 'Готов к приёму', in_progress: 'Приём идёт',
  review: 'На проверке', finalized: 'Завершён', amended: 'Исправлен', cancelled: 'Отменён',
};

const encounterSchema = z.object({
  id: z.string(), facilityName: z.string(), updatedAt: z.number().finite(),
  status: z.enum(['draft', 'ready', 'in_progress', 'review', 'finalized', 'amended', 'cancelled']),
  patient: z.object({ displayName: z.string(), medicalRecordNumber: z.string() }),
});
const responseSchema = z.object({
  encounters: z.array(encounterSchema).optional(),
  error: z.object({ code: z.string(), message: z.string() }).optional(),
});

export function ClinicDashboard({ capabilities }: { capabilities: { patientDirectory: boolean; scheduling: boolean; chronicCare: boolean; orders: boolean; communications: boolean; pathway: boolean } }) {
  const workspaceFetch = useWorkspaceFetch();
  const workspaceUrl = useWorkspaceUrl();
  const canManage = useWorkspaceCanManage();
  const searchParams = useSearchParams();
  const selectionQuery = new URL(workspaceUrl(`/?${searchParams.toString()}`), 'https://orion.invalid').searchParams.toString();
  const [encounters, setEncounters] = useState<z.infer<typeof encounterSchema>[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('all');
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [modules, setModules] = useState<Partial<Record<DashboardSource, DashboardModule>>>({});
  const [signals, setSignals] = useState<DashboardSignal[]>([]);
  const [workItems, setWorkItems] = useState<DashboardWorkItem[]>([]);
  const [sourcesLoading, setSourcesLoading] = useState(true);
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const [briefing, setBriefing] = useState<z.infer<typeof dashboardBriefingResponseSchema> | null>(null);
  const [briefingError, setBriefingError] = useState('');
  const [briefingLoading, setBriefingLoading] = useState(false);
  const requestRef = useRef<AbortController | null>(null);
  const briefingRequestRef = useRef<AbortController | null>(null);
  const load = useCallback(async () => {
    requestRef.current?.abort();
    briefingRequestRef.current?.abort();
    const controller = new AbortController();
    requestRef.current = controller;
    const signal = controller.signal;
    setLoading(true);
    setError('');
    setModules({});
    setSignals([]);
    setWorkItems([]);
    setEncounters([]);
    setSourcesLoading(true);
    setBriefing(null);
    setBriefingError('');
    setBriefingLoading(false);
    const sources: DashboardSource[] = [
      ...(capabilities.scheduling ? ['scheduling' as const] : []),
      ...(capabilities.orders ? ['orders' as const] : []),
      ...(capabilities.chronicCare ? ['care' as const] : []),
      ...(capabilities.communications ? ['communications' as const] : []),
    ];
    void Promise.all(sources.map(async (source) => {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const response = await fetch(dashboardSummaryUrl(source, new URLSearchParams(selectionQuery)), { cache: 'no-store', signal });
          if (!response.ok) {
            if (response.status >= 500 && attempt === 0) continue;
            break;
          }
          const payload = await response.json();
          return [source, summarizeDashboardSource(source, payload), dashboardSignals(source, payload), dashboardWorkItems(source, payload)] as const;
        } catch {
          if (signal?.aborted || attempt > 0) break;
        }
      }
      return [source, { state: 'unavailable' } as DashboardModule, [] as DashboardSignal[], [] as DashboardWorkItem[]] as const;
    })).then((loaded) => {
      if (signal?.aborted) return;
      setModules(Object.fromEntries(loaded.map(([source, module]) => [source, module])));
      setSignals(loaded.flatMap(([, , items]) => items));
      setWorkItems(loaded.flatMap(([, , , items]) => items));
      setSourcesLoading(false);
    });
    try {
      // Scoped/audited summary does not load a selected encounter's clinical data.
      const response = await workspaceFetch('/api/workspace?view=worklist', { cache: 'no-store', signal });
      const body = responseSchema.parse(await response.json());
      if (signal?.aborted) return;
      if (response.status === 404 && body.error?.code === 'ENCOUNTER_NOT_FOUND') {
        setEncounters([]);
      } else if (!response.ok || !body.encounters) {
        throw new Error(body.error?.message ?? 'Не удалось загрузить рабочий день.');
      } else {
        setEncounters(body.encounters);
      }
      setUpdatedAt(Date.now());
    } catch (failure) {
      if (signal?.aborted) return;
      setEncounters([]);
      setError(failure instanceof Error ? failure.message : 'Не удалось связаться с сервером.');
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [workspaceFetch, selectionQuery, capabilities.scheduling, capabilities.orders, capabilities.chronicCare, capabilities.communications]);
  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); requestRef.current?.abort(); briefingRequestRef.current?.abort(); };
  }, [load]);
  const active = encounters.filter((item) => ['draft', 'ready', 'in_progress'].includes(item.status));
  const review = encounters.filter((item) => item.status === 'review');
  const completed = encounters.filter((item) => ['finalized', 'amended'].includes(item.status));
  const visible = encounters.filter((item) => {
    const matches = `${item.patient.displayName} ${item.patient.medicalRecordNumber}`.toLocaleLowerCase().includes(search.toLocaleLowerCase().trim());
    return matches && (filter === 'all' || (filter === 'active' && active.includes(item)) ||
      (filter === 'review' && item.status === 'review') || (filter === 'completed' && completed.includes(item)));
  });
  const reviewSignals: DashboardSignal[] = review.map((item) => ({ id: `review-${item.id}`, category: 'Проверка протокола', title: item.patient.displayName, patient: item.facilityName, timestamp: item.updatedAt, urgency: 'soon', href: `/?encounterId=${encodeURIComponent(item.id)}`, kind: 'attention' }));
  const allAttention = prioritizedSignals([...signals, ...reviewSignals], 'attention', 400);
  const attention = allAttention.slice(0, 6);
  const sourcesIncomplete = Object.values(modules).some((module) => module?.state === 'unavailable');
  const generateBriefing = async () => {
    if (loading || sourcesLoading || error || sourcesIncomplete || briefingLoading) return;
    setBriefingLoading(true);
    setBriefingError('');
    setBriefing(null);
    const controller = new AbortController();
    briefingRequestRef.current = controller;
    const counts = {
      openEncounters: active.length,
      reviewEncounters: review.length,
      urgentOrders: signals.filter((item) => item.id.startsWith('order-attention-')).length,
      overdueCareTasks: signals.filter((item) => item.category === 'Просроченная задача').length,
      manualVoiceTasks: signals.filter((item) => item.category === 'Ручной звонок ожидает' || (item.category === 'Эскалация связи' && item.title === 'Связаться по телефону')).length,
      queueExceptions: signals.filter((item) => item.category === 'Исключение в очереди').length,
    };
    try {
      const response = await workspaceFetch('/api/dashboard/briefing', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(counts), signal: controller.signal });
      const payload = await response.json() as { briefing?: unknown; error?: { message?: string } };
      if (controller.signal.aborted) return;
      if (!response.ok) throw new Error(payload.error?.message ?? 'Не удалось получить сводку Groq.');
      setBriefing(dashboardBriefingResponseSchema.parse(payload.briefing));
    } catch (failure) {
      if (controller.signal.aborted) return;
      setBriefingError(failure instanceof Error ? failure.message : 'Groq сейчас недоступен.');
    } finally {
      if (!controller.signal.aborted) setBriefingLoading(false);
    }
  };
  const encounterEvents: DashboardSignal[] = encounters.map((item) => ({
    id: `encounter-${item.id}`, category: 'Приём · ' + labels[item.status], title: item.patient.displayName,
    patient: item.facilityName, timestamp: item.updatedAt, urgency: 'normal',
    href: `/?encounterId=${encodeURIComponent(item.id)}`, kind: 'event',
  }));
  const recentEvents = prioritizedSignals([...signals, ...encounterEvents], 'event', 8);
  const refreshing = loading || sourcesLoading;
  const sourceCards = ([
    ['orders', 'Анализы и направления', 'Нет открытых назначений', ClipboardList, '/pathway?view=orders'],
    ['care', 'План наблюдения', 'Нет открытых задач наблюдения', HeartPulse, '/pathway?view=care'],
    ['scheduling', 'Очередь', 'Нет активных талонов', CalendarClock, '/scheduling'],
    ['communications', 'Связь с пациентами', 'Нет открытых задач связи', PhoneCall, '/pathway?view=communications'],
  ] as const).filter(([source]) => source === 'scheduling' ? capabilities.scheduling : source === 'orders' ? capabilities.orders : source === 'care' ? capabilities.chronicCare : capabilities.communications);
  const scopedLink = (path: string) => {
    const url = new URL(workspaceUrl(path), 'https://orion.invalid');
    if (url.pathname === '/scheduling') for (const key of ['facilityId', 'accessAssignmentId']) {
      for (const value of new URLSearchParams(selectionQuery).getAll(key)) url.searchParams.append(key, value);
    }
    return `${url.pathname}${url.search}`;
  };
  const recent = recentEncounterDates(encounters);
  const peak = Math.max(1, ...recent.map((point) => point.count));
  const chartPoints = recent.map((point, index) => `${20 + index * 53},${108 - (point.count / peak) * 80}`).join(' ');
  const seenInWindow = recent.reduce((sum, point) => sum + point.count, 0);
  const total = encounters.length || 1;
  const activeEnd = active.length / total * 100;
  const reviewEnd = activeEnd + review.length / total * 100;
  const completedEnd = reviewEnd + completed.length / total * 100;

  return <main className={styles.dashboard}>
    <header className={styles.heading}>
      <div className={styles.headingCopy}><p className={styles.eyebrow}><BellRing size={14} aria-hidden="true" /> ORION · ВАШ РАБОЧИЙ ОБЗОР</p><h1>Центр событий</h1>
        <p>Приоритеты, ближайшие действия и последние изменения.</p>
        <div className={styles.headingActions}>
          {canManage && <Link className={styles.primaryAction} href={workspaceUrl('/encounters/new')}>+ Новый пациент и приём</Link>}
          <button aria-controls="dashboard-analytics" aria-expanded={analyticsOpen} onClick={() => setAnalyticsOpen((open) => !open)} type="button"><BarChart3 size={17} aria-hidden="true" />{analyticsOpen ? 'Скрыть аналитику' : 'Открыть аналитику'}</button>
          <button onClick={() => void load()} disabled={refreshing}>{refreshing ? <OrionMark animated size={20} /> : <RefreshCw size={17} />}{refreshing ? 'Загрузка…' : 'Обновить'}</button>
        </div>
      </div>
      <div className={styles.snapshot} role="status"><span><Clock3 size={14} aria-hidden="true" />{refreshing ? 'Обновляем записи' : updatedAt ? `Обновлено в ${new Date(updatedAt).toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}` : 'Нет свежего снимка'}</span><small>Только ваш рабочий доступ</small></div>
    </header>
    <div className={styles.summaryStrip} aria-label="Сводка текущих записей">
      <div data-tone="urgent"><AlertCircle size={18} aria-hidden="true" /><strong>{refreshing ? '…' : allAttention.length}</strong><span>требуют внимания{sourcesIncomplete || error ? ' · неполные данные' : ''}</span></div>
      <div><ClipboardList size={18} aria-hidden="true" /><strong>{loading || error ? '—' : active.length}</strong><span>приёмов в работе</span></div>
      <div><CheckCheck size={18} aria-hidden="true" /><strong>{loading || error ? '—' : review.length}</strong><span>ожидают проверки</span></div>
      {capabilities.chronicCare && <div><HeartPulse size={18} aria-hidden="true" /><strong>{refreshing ? '…' : modules.care?.state === 'unavailable' ? '—' : workItems.filter((item) => item.source === 'care').length}</strong><span>задач наблюдения{modules.care?.state === 'unavailable' ? ' · недоступно' : ''}</span></div>}
    </div>
    {error && <p role="alert" className={styles.partialFeed}>Приёмы не загружены: {error}</p>}
    <div className={styles.eventGrid}>
    <section className={styles.attentionSection} aria-labelledby="dashboard-attention">
      <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>В ПЕРВУЮ ОЧЕРЕДЬ</span><h2 id="dashboard-attention">Требует внимания <span className={styles.countBadge}>{refreshing ? '…' : allAttention.length}</span></h2></div><AlertCircle size={22} aria-hidden="true" /></div>
      {refreshing ? <p className={styles.feedEmpty}>Проверяем события…</p> : attention.length === 0 ? <p className={styles.feedEmpty}>{sourcesIncomplete || error ? 'В загруженных источниках срочных задач нет. Часть данных недоступна.' : 'Открытых срочных задач нет.'}</p>
        : <div className={styles.attentionGrid}>{attention.map((item) => <Link key={item.id} href={scopedLink(item.href)} className={styles.attentionCard} data-urgency={item.urgency}>
          <span>{item.category}</span><strong>{item.title}</strong><small>{item.patient}</small><em>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(item.timestamp)} <ArrowUpRight size={15} aria-hidden="true" /></em>
        </Link>)}</div>}
      {allAttention.length > attention.length && <p className={styles.partialFeed}>Показаны первые {attention.length} из {allAttention.length}. Остальные — в разделах ниже.</p>}
      {(sourcesIncomplete || error) && <p className={styles.partialFeed} role="status">Не все данные загружены. Недоступные разделы отмечены отдельно.</p>}
    </section>
    <section className={styles.recentSection} aria-labelledby="dashboard-recent">
      <div className={styles.sectionTitle}><div><span className={styles.eyebrow}>ЛЕНТА ОБНОВЛЕНИЙ</span><h2 id="dashboard-recent">Последние изменения</h2></div><Clock3 size={20} aria-hidden="true" /></div>
      {refreshing ? <p className={styles.feedEmpty}>Загружаем события…</p> : recentEvents.length === 0 ? <p className={styles.feedEmpty}>В загруженных записях пока нет событий.</p>
        : <div className={styles.recentList}>{recentEvents.map((item) => <Link key={item.id} href={workspaceUrl(item.href)} className={styles.recentItem}>
          <span className={styles.eventDot} /><span><small>{item.category}</small><strong>{item.title}</strong><em>{item.patient}</em></span><time dateTime={new Date(item.timestamp).toISOString()}>{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }).format(item.timestamp)}</time>
        </Link>)}</div>}
      <p className={styles.cardFootnote}>По последнему изменению каждой записи</p>
    </section>
    {sourceCards.map(([source, title, emptyLabel, Icon, href]) => {
      const data = modules[source];
      const items = sortDashboardWork(workItems.filter((item) => item.source === source));
      return <section key={source} className={styles.sourceCard} aria-label={title}>
        <header><span className={styles.operationIcon}><Icon size={20} aria-hidden="true" /></span><h2>{title}</h2><span className={styles.countBadge}>{!data ? '…' : data.state === 'unavailable' ? '—' : items.length}</span></header>
        {!data ? <p className={styles.sourceEmpty}>Загружаем записи…</p> : data.state === 'unavailable' ? <p className={styles.sourceEmpty} role="status">Источник недоступен. Попробуйте обновить.</p> : !items.length ? <p className={styles.sourceEmpty}><CheckCheck size={20} aria-hidden="true" />{emptyLabel}</p> : <div className={styles.sourceRows}>{items.slice(0, 3).map((item) => <Link href={scopedLink(item.href)} key={item.id} className={styles.sourceRow}>
          <span><strong>{item.title}</strong><small>{item.patient}</small></span><span className={styles.rowMeta}><em data-attention={item.attention}>{item.status}</em>{item.timestamp !== null && Number.isFinite(item.timestamp) && <time dateTime={new Date(item.timestamp).toISOString()}>{item.dateKind === 'due' ? 'Срок: ' : item.dateKind === 'day' ? '' : 'Изм.: '}{new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', ...(item.dateKind === 'due' || item.dateKind === 'day' ? { timeZone: 'UTC' } : {}) }).format(item.timestamp)}</time>}</span>
        </Link>)}</div>}
        <footer><small>{data?.state === 'ready' && (data.limited ? 'Выборка ограничена 100 записями' : source === 'scheduling' ? `${data.secondary} подтверждённых записей` : items.length > 3 ? `Ещё ${items.length - 3} в разделе` : 'Текущие сохранённые записи')}</small><Link href={scopedLink(href)}>Открыть раздел <ArrowUpRight size={14} aria-hidden="true" /></Link></footer>
      </section>;
    })}
    {canManage && <section className={styles.aiPanel} aria-labelledby="dashboard-ai-title">
      <div className={styles.aiIcon}><Sparkles size={23} aria-hidden="true" /></div>
      <div className={styles.aiBody}><span className={styles.eyebrow}>ПОМОЩНИК · GROQ</span><h2 id="dashboard-ai-title">Сводка приоритетов с ИИ</h2>
        <p>Поможет расставить рабочие задачи. Передаются только счётчики, без данных пациентов. Выводы требуют вашей проверки.</p>
        {briefing && <div className={styles.aiResult} role="status"><strong>{briefing.summary}</strong>{briefing.priorities.length > 0 && <ol>{briefing.priorities.map((item, index) => <li key={`${index}-${item}`}>{item}</li>)}</ol>}</div>}
        {briefingError && <p className={styles.aiError} role="alert">{briefingError}</p>}
      </div>
      <button type="button" onClick={() => void generateBriefing()} disabled={loading || sourcesLoading || Boolean(error) || sourcesIncomplete || briefingLoading}>{briefingLoading ? 'Формируем…' : briefing ? 'Обновить сводку' : 'Сформировать сводку'}</button>
    </section>}
    </div>
    {analyticsOpen && <section id="dashboard-analytics" className={styles.insights} aria-label="Аналитика приёмов">
      {loading || error ? <p className={styles.feedEmpty} role="status">{loading ? 'Загружаем данные для аналитики…' : 'Аналитика недоступна: не удалось получить приёмы.'}</p> : <>
      <article className={styles.overallCard}>
        <div className={styles.insightTitle}><span>Общая картина</span><ClipboardList size={20} aria-hidden="true" /></div>
        <strong className={styles.totalValue}>{loading || error ? '—' : encounters.length}</strong>
        <span className={styles.totalCaption}>приёмов в текущей доступной выборке</span>
        <div className={styles.overallSegments} aria-hidden="true"><i style={{ flexGrow: active.length }} /><i style={{ flexGrow: review.length }} /><i style={{ flexGrow: completed.length }} /><i style={{ flexGrow: Math.max(0, encounters.length - active.length - review.length - completed.length) }} /></div>
        <div className={styles.overallMini}>
          <span><strong>{loading || error ? '—' : active.length}</strong>В работе</span>
          <span><strong>{loading || error ? '—' : review.length}</strong>На проверке</span>
          <span><strong>{loading || error ? '—' : completed.length}</strong>Завершены</span>
        </div>
      </article>
      <article className={styles.trendCard}>
        <div className={styles.insightTitle}><span>Динамика записей</span><small>7 дней до последнего изменения · UTC</small></div>
        <strong>{loading || error ? '—' : seenInWindow} <small>приёмов</small></strong>
        <svg viewBox="0 0 360 126" preserveAspectRatio="none" role="img" aria-label={loading || error ? 'Динамика недоступна' : `Приёмы по дате последнего изменения: ${recent.map((point) => `${point.label} — ${point.count}`).join(', ')}`}>
          <path d="M20 108H338" className={styles.chartAxis} />
          <polygon points={`20,108 ${chartPoints} 338,108`} className={styles.chartArea} />
          <polyline points={chartPoints} className={styles.chartLine} />
          {recent.map((point, index) => <circle key={point.day} cx={20 + index * 53} cy={108 - (point.count / peak) * 80} r="3.5" className={styles.chartDot} />)}
        </svg>
        <div className={styles.trendLabels}>{recent.map((point) => <span key={point.day}>{point.label}</span>)}</div>
      </article>
      <article className={styles.mixCard}>
        <div className={styles.insightTitle}><span>Состояния приёмов</span><small>Доля текущей выборки</small></div>
        <div className={styles.mixBody}>
          <div className={styles.donut} role="img" aria-label={`В работе ${active.length}, на проверке ${review.length}, завершены ${completed.length}, прочие ${encounters.length - active.length - review.length - completed.length}`}
            style={{ background: `conic-gradient(var(--brand) 0 ${activeEnd}%, #d6e88c ${activeEnd}% ${reviewEnd}%, var(--ink-soft) ${reviewEnd}% ${completedEnd}%, var(--line-strong) ${completedEnd}% 100%)` }}><span>{loading || error ? '—' : encounters.length}</span></div>
          <ul><li><i />В работе <strong>{active.length}</strong></li><li><i />На проверке <strong>{review.length}</strong></li><li><i />Завершены <strong>{completed.length}</strong></li></ul>
        </div>
      </article>
      </>}
    </section>}
    <details className={styles.worklist}>
      <summary className={styles.worklistToggle}><ClipboardList size={20} aria-hidden="true" /><span><strong>Все приёмы</strong><small>{loading || error ? 'Реестр недоступен' : `${encounters.length} в текущем рабочем доступе`} · поиск и фильтры</small></span><ChevronDown size={18} aria-hidden="true" /></summary>
      <div className={styles.listHeader}><div><h2 id="dashboard-list">Назначенные приёмы</h2><p>Откройте карточку для продолжения приёма или проверки протокола.</p></div>
        <label className={styles.search}><Search size={18}/><input aria-label="Поиск пациента в приёмах" placeholder="Пациент или номер карты" value={search} onChange={(event) => setSearch(event.target.value)} /></label>
      </div>
      <div className={styles.filters} role="group" aria-label="Фильтр приёмов">
        {[['all', 'Все'], ['active', 'В работе'], ['review', 'На проверке'], ['completed', 'Завершены']].map(([id, label]) =>
          <button key={id} type="button" aria-pressed={filter === id} onClick={() => setFilter(id)}>{label}</button>)}
      </div>
      {error ? <div role="alert" className={styles.empty}><h3>Не удалось загрузить приёмы</h3><p>{error}</p><button onClick={() => void load()}>Повторить загрузку</button></div>
        : loading ? <p role="status" className={styles.empty}><OrionMark animated size={40} /> Загружаем данные из БД…</p>
        : visible.length === 0 ? <div className={styles.empty}><h3>{encounters.length ? 'По этому фильтру приёмов нет' : 'Нет назначенных приёмов'}</h3><p>Измените фильтр или откройте реестр пациентов.</p></div>
        : <div className={styles.tableWrap}><table><thead><tr><th>Пациент</th><th>Состояние</th><th>Последнее изменение</th><th><span className={styles.srOnly}>Действие</span></th></tr></thead>
          <tbody>{visible.map((item) => <tr key={item.id}><td><strong>{item.patient.displayName}</strong><small>{item.patient.medicalRecordNumber} · {item.facilityName}</small></td>
            <td><span className={styles.status} data-state={item.status}>{labels[item.status]}</span></td>
            <td>{new Intl.DateTimeFormat('ru-RU', { dateStyle: 'short', timeStyle: 'short' }).format(item.updatedAt)}</td>
            <td><Link href={workspaceUrl(`/?encounterId=${encodeURIComponent(item.id)}`)}>Открыть приём <ArrowUpRight size={16}/></Link></td></tr>)}</tbody></table></div>}
      <footer>{updatedAt && !error ? `Обновлено ${new Date(updatedAt).toLocaleTimeString('ru-RU')}` : 'Серверный реестр приёмов'}</footer>
    </details>
  </main>;
}
