'use client';

import Link from 'next/link';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Activity, ArrowUpRight, BarChart3, CalendarClock, CheckCheck, Clock3, FileHeart, FlaskConical, Info, RefreshCw, ShieldCheck, Users, X } from 'lucide-react';
import { z } from 'zod';
import { readCloudGenerationCookie } from '@/lib/cloud/account-fence';
import { useWorkspaceFetch } from '@/lib/workspace-access-context';
import { createPatientRequestFence } from '@/app/patients/pagination-client';
import styles from './cloud-dashboard.module.css';

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,160}$/);
// A timestamp must also be a representable JavaScript Date, not merely a safe integer.
const timestamp = z.number().int().nonnegative().max(8_640_000_000_000_000);
const card = z.object({
  id, displayName: z.string().trim().min(2).max(160),
  medicalRecordNumber: z.string().min(3).max(80),
  status: z.enum(['active', 'inactive', 'merged']), version: z.number().int().positive(),
  updatedAt: timestamp,
});
// Keep only displayed registry fields: no national identifiers, contact details or clinical text.
const snapshot = z.object({
  facility: z.object({ id, name: z.string().trim().min(2).max(160) }),
  accessAssignment: z.object({ assignmentId: id }),
  patients: z.array(card).max(25),
  page: z.object({ hasMore: z.boolean(), nextCursor: z.string().min(1).max(2048).nullable() })
    .refine(value => value.hasMore === (value.nextCursor !== null)),
  observedAt: timestamp.optional(), persistence: z.string().max(40).optional(),
});
type Snapshot = z.infer<typeof snapshot>;
type State = 'loading' | 'ready' | 'unavailable' | 'expired' | 'forbidden' | 'scope';
type View = { state: State; scopeKey: string; generation: string | null; data?: Snapshot };
const statusLabels = { active: 'Активная карта', inactive: 'В архиве', merged: 'Объединённая карта' } as const;

function currentGeneration() {
  return typeof document === 'undefined' ? null : readCloudGenerationCookie(document.cookie);
}
function formatTime(value: number) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }).format(value);
}
function initials(value: string) {
  return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join('').toUpperCase();
}
function validRows(value: Snapshot) {
  return new Set(value.patients.map(patient => patient.id)).size === value.patients.length &&
    value.patients.every((patient, index) => index === 0 ||
      value.patients[index - 1].updatedAt > patient.updatedAt ||
      (value.patients[index - 1].updatedAt === patient.updatedAt && value.patients[index - 1].id > patient.id)) &&
    (!value.page.hasMore || value.patients.length === 25);
}

/** Registry activity only. No clinical-state inference, background polling or detail fan-out. */
export function CloudDashboard({ facilityId, accessAssignmentId }: { facilityId: string; accessAssignmentId: string }) {
  const request = useWorkspaceFetch();
  const scopeKey = JSON.stringify([facilityId, accessAssignmentId]);
  const generation = currentGeneration();
  const [view, setView] = useState<View>({ state: 'loading', scopeKey, generation });
  const [analyticsOpen, setAnalyticsOpen] = useState(false);
  const requests = useRef(createPatientRequestFence(currentGeneration));
  const scoped = (path: string) => `${path}?${new URLSearchParams({ facilityId, accessAssignmentId })}`;

  const load = useCallback(async () => {
    requests.current.retire();
    const pending = requests.current.begin('dashboard');
    const account = currentGeneration();
    const next = (state: State, data?: Snapshot) => setView({ state, scopeKey, generation: account, data });
    next('loading');
    setAnalyticsOpen(false);
    if (!id.safeParse(facilityId).success || !id.safeParse(accessAssignmentId).success) {
      next('scope'); pending.finish(); return;
    }
    if (!account) { next('expired'); pending.finish(); return; }
    try {
      const params = new URLSearchParams({ status: 'all', limit: '25', facilityId, accessAssignmentId });
      const response = await request(`/api/patients?${params}`, { cache: 'no-store', credentials: 'same-origin', signal: pending.signal });
      if (!pending.current()) return;
      if (response.status === 401) { next('expired'); return; }
      if (response.status === 403) { next('forbidden'); return; }
      if (response.status === 409) { next('expired'); return; }
      if (!response.ok) { next('unavailable'); return; }
      const body: unknown = await response.json();
      if (!pending.current()) return;
      const parsed = snapshot.safeParse(body);
      if (!parsed.success || !validRows(parsed.data)) { next('unavailable'); return; }
      if (parsed.data.facility.id !== facilityId || parsed.data.accessAssignment.assignmentId !== accessAssignmentId) {
        next('scope'); return;
      }
      next('ready', parsed.data);
    } catch {
      if (pending.current()) next('unavailable');
    } finally { pending.finish(); }
  }, [request, facilityId, accessAssignmentId, scopeKey]);

  useEffect(() => {
    const fence = requests.current;
    const timer = setTimeout(() => { void load(); }, 0);
    return () => { clearTimeout(timer); fence.retire(); };
  }, [load]);

  // Prop/account changes hide the previous scope before the next effect runs.
  const sameContext = view.scopeKey === scopeKey && view.generation === generation;
  const state = sameContext ? view.state : generation ? 'loading' : 'expired';
  const data = sameContext && state === 'ready' ? view.data : undefined;
  const cards = data?.patients ?? [];
  // Navigation still performs independent authorization. Keep its initial
  // markup identical during SSR/hydration, when document.cookie is unavailable.
  const canOpen = id.safeParse(facilityId).success && id.safeParse(accessAssignmentId).success;
  const visibleAnalytics = analyticsOpen && Boolean(data);
  const messages: Record<Exclude<State, 'ready' | 'loading'>, { title: string; text: string }> = {
    unavailable: { title: 'Не удалось загрузить изменения', text: 'Источник недоступен или ответ не прошёл проверку. Это не означает, что карт или событий нет.' },
    expired: { title: 'Нужно подтвердить вход', text: 'Сеанс завершён или изменился. Прежние данные скрыты. Выполните вход заново.' },
    forbidden: { title: 'Нет доступа к изменениям карт', text: 'В выбранном рабочем назначении не подтверждено право просмотра реестра. Данные скрыты.' },
    scope: { title: 'Рабочий контур не подтверждён', text: 'Параметры или ответ не соответствуют выбранной клинике и назначению. Чужие данные не показаны.' },
  };

  return <main className={styles.dashboard} aria-labelledby="cloud-dashboard-title">
    <header className={styles.heading}>
      <div><p className={styles.eyebrow}><Activity size={15} aria-hidden="true" />ORION · РАБОЧИЙ ЦЕНТР</p>
        <h1 id="cloud-dashboard-title">Последние изменения карт</h1>
        <p className={styles.lead}>Сохранённые данные пациентов — в одном рабочем контуре.</p>
      </div>
      <div className={styles.actions}>
        {canOpen && <Link className={styles.primary} href={scoped('/patients')}><Users size={16} aria-hidden="true" />Реестр пациентов</Link>}
        <button type="button" onClick={() => { void load(); }} disabled={state === 'loading'}><RefreshCw size={16} aria-hidden="true" />Обновить</button>
      </div>
    </header>

    <section className={styles.context} aria-label="Источник и рабочий контур">
      <div><ShieldCheck size={19} aria-hidden="true" /><span><strong>{data?.facility.name ?? 'Выбранный рабочий контур'}</strong><small>Только текущие сохранённые состояния карт</small></span></div>
      <div className={styles.provenance}><span>{data?.persistence === 'supabase' ? 'Источник: Supabase' : 'Источник не подтверждён'}</span>
        {data?.observedAt !== undefined ? <time dateTime={new Date(data.observedAt).toISOString()}>Проверено сервером: {formatTime(data.observedAt)}</time> : <small>Время проверки источника не указано</small>}
      </div>
    </section>

    <section className={styles.activity} aria-labelledby="cloud-registry-feed-title" aria-busy={state === 'loading'}>
      <header className={styles.sectionHeading}><div><p className={styles.eyebrow}>ЛЕНТА ОБНОВЛЕНИЙ</p><h2 id="cloud-registry-feed-title">Карты пациентов</h2></div>
        <button type="button" disabled={!data} aria-expanded={visibleAnalytics} aria-controls="cloud-sample-analytics" onClick={() => setAnalyticsOpen(open => !open)}><BarChart3 size={16} aria-hidden="true" />{visibleAnalytics ? 'Скрыть аналитику' : 'Аналитика выборки'}</button>
      </header>
      <p className={styles.explanation}>Последнее сохранённое состояние каждой карты, а не полная история всех её изменений. Порядок — от последнего обновления.</p>
      {state === 'loading' ? <div className={styles.state} role="status"><Clock3 size={23} aria-hidden="true" /><strong>Загружаем сохранённые карты…</strong><span>Проверяем выбранный рабочий доступ.</span></div>
        : state !== 'ready' ? <div className={styles.state} role="alert"><Info size={23} aria-hidden="true" /><strong>{messages[state].title}</strong><span>{messages[state].text}</span>{state === 'expired' && <Link href="/sign-in">Перейти ко входу <ArrowUpRight size={15} aria-hidden="true" /></Link>}</div>
          : cards.length === 0 ? <div className={styles.state} role="status"><CheckCheck size={23} aria-hidden="true" /><strong>В этом контуре пока нет карт</strong><span>Источник ответил успешно. Новые сохранённые карты появятся здесь после обновления.</span></div>
            : <ul className={styles.cards}>{cards.map(patient => <li key={patient.id}><Link className={styles.card} href={scoped(`/patients/${patient.id}`)}>
              <div className={styles.avatar} aria-hidden="true">{initials(patient.displayName)}</div>
              <div className={styles.cardIdentity}><strong>{patient.displayName}</strong><span>№ {patient.medicalRecordNumber}</span></div>
              <ArrowUpRight className={styles.openIcon} size={17} aria-hidden="true" />
              <span className={styles.status} data-status={patient.status}>{statusLabels[patient.status]}</span>
              <span className={styles.version}>Версия {patient.version}</span>
              <div className={styles.cardTime}><Clock3 size={13} aria-hidden="true" /><time dateTime={new Date(patient.updatedAt).toISOString()}>Сохранено {formatTime(patient.updatedAt)}</time></div>
            </Link></li>)}</ul>}
      {data && <footer className={styles.feedFootnote}><span>{data.page.hasMore ? `Показаны ${cards.length} последних карт. Есть другие записи в реестре.` : `В выборке ${cards.length} карт.`} Это не счётчик клинических задач.</span>{data.page.hasMore && <Link href={scoped('/patients')}>Открыть весь реестр <ArrowUpRight size={14} aria-hidden="true" /></Link>}</footer>}
    </section>

    {visibleAnalytics && data && <section id="cloud-sample-analytics" className={styles.analytics} aria-labelledby="cloud-sample-title">
      <header className={styles.sectionHeading}><div><p className={styles.eyebrow}>АНАЛИТИКА ПО КНОПКЕ</p><h2 id="cloud-sample-title">Структура загруженной выборки</h2></div><button type="button" onClick={() => setAnalyticsOpen(false)} aria-label="Закрыть аналитику"><X size={17} aria-hidden="true" /></button></header>
      <p className={styles.explanation}>Только {cards.length} загруженных карт. Не общие показатели клиники и не оценка состояния пациентов{data.page.hasMore ? '; часть реестра не загружена' : ''}.</p>
      <div className={styles.sampleBars}>{(['active', 'inactive', 'merged'] as const).map(status => {
        const count = cards.filter(patient => patient.status === status).length;
        return <div key={status}><span>{statusLabels[status]}</span><strong>{count}</strong><div className={styles.bar} aria-hidden="true"><i style={{ width: `${cards.length ? count / cards.length * 100 : 0}%` }} /></div></div>;
      })}</div>
    </section>}

    <section className={styles.availability} aria-labelledby="cloud-sources-title">
      <header><p className={styles.eyebrow}>КЛИНИЧЕСКИЕ ИСТОЧНИКИ</p><h2 id="cloud-sources-title">Не входят в эту ленту</h2><p>Для этих источников здесь ещё нет подтверждённых данных. Отсутствие записей на экране не означает отсутствие срочных задач.</p></header>
      <div className={styles.sourceGrid}>
        <article><FlaskConical size={21} aria-hidden="true" /><div><h3>Анализы и направления</h3><p>Не подключены к центру</p></div></article>
        <article><FileHeart size={21} aria-hidden="true" /><div><h3>Наблюдение и показатели</h3><p>Не подключены к центру</p></div></article>
        <article><CalendarClock size={21} aria-hidden="true" /><div><h3>Очередь и связь с пациентами</h3><p>Не подключены к центру</p></div></article>
      </div>
    </section>
  </main>;
}
