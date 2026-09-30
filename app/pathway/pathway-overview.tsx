'use client';

import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { z } from 'zod';
import { Activity, ClipboardList, HeartPulse, RefreshCw, UserRound } from 'lucide-react';
import styles from './pathway.module.css';

const patient = z.object({ id: z.string(), displayName: z.string(), medicalRecordNumber: z.string() });
const timestamp = z.number().int().min(0).max(8_640_000_000_000_000);
const orderResponse = z.object({ orders: z.array(z.object({ id: z.string(), patient, current: z.object({ requestedService: z.string(), status: z.string(), createdAt: timestamp }) })) });
const careResponse = z.object({ enrollments: z.array(z.object({ id: z.string(), patient, current: z.object({ diagnosisDisplay: z.string(), decidedAt: timestamp, status: z.string() }) })), tasks: z.array(z.object({ id: z.string(), patient, title: z.string(), current: z.object({ dueDate: z.string(), status: z.string() }) })) });
const observationResponse = z.object({ patients: z.array(patient), observations: z.array(z.object({ id: z.string(), patient, current: z.object({ measuredAt: timestamp, context: z.string() }) })) });

type Patient = z.infer<typeof patient>;
type Source = 'orders' | 'care' | 'observations';
type Event = { id: string; patient: Patient; title: string; subtitle: string; date: number; source: Source; status: string };
type SourceResult = { patients: Patient[]; events: Event[]; count: number };
type OverviewState = { scope: string; results: Partial<Record<Source, SourceResult>>; unavailable: Source[] };
const emptyResults: OverviewState['results'] = {};
const sourceTitles: Record<Source, string> = { orders: 'Назначения', care: 'Наблюдение', observations: 'Показатели' };
const statusTitles: Record<string, string> = {
  draft: 'черновик', active: 'активно', on_hold: 'приостановлено', completed: 'выполнено',
  cancelled: 'отменено', pending: 'запланировано', in_progress: 'в работе',
  pre_visit: 'до приёма', consultation: 'на приёме', follow_up: 'контроль', other: 'другое',
};

export function pathwaySourceUrl(source: Source, query: URLSearchParams) {
  const params = new URLSearchParams({ limit: '100' });
  for (const key of ['facilityId', 'accessAssignmentId']) {
    for (const value of query.getAll(key)) params.append(key, value);
  }
  return `/api/${source === 'observations' ? 'observations' : source}?${params}`;
}

export function projectPathwaySource(source: Source, raw: unknown): SourceResult {
  if (source === 'orders') {
    const data = orderResponse.parse(raw);
    return { patients: data.orders.map((item) => item.patient), count: data.orders.length,
      events: data.orders.map((item) => ({ id: item.id, patient: item.patient, title: item.current.requestedService,
        subtitle: 'Направление или анализ', date: item.current.createdAt, source, status: item.current.status })) };
  }
  if (source === 'care') {
    const data = careResponse.parse(raw);
    return { patients: [...data.enrollments.map((item) => item.patient), ...data.tasks.map((item) => item.patient)], count: data.enrollments.length + data.tasks.length,
      events: [
        ...data.enrollments.map((item) => ({ id: item.id, patient: item.patient, title: item.current.diagnosisDisplay,
          subtitle: 'Решение о наблюдении', date: item.current.decidedAt, source, status: item.current.status })),
        ...data.tasks.map((item) => ({ id: item.id, patient: item.patient, title: item.title,
          subtitle: 'Срок задачи', date: Date.parse(`${item.current.dueDate}T12:00:00`), source, status: item.current.status })),
      ].filter((item) => Number.isFinite(item.date)) };
  }
  const data = observationResponse.parse(raw);
  return { patients: data.patients, count: data.observations.length,
    events: data.observations.map((item) => ({ id: item.id, patient: item.patient, title: 'Измерение пациента',
      subtitle: 'Записанные показатели', date: item.current.measuredAt, source, status: item.current.context })) };
}

function displayDate(value: number) {
  return new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'short', year: 'numeric' }).format(value);
}

export function PathwayOverview({ capabilities }: {
  capabilities: { orders: boolean; chronicCare: boolean; observations: boolean; communications: boolean };
}) {
  const searchParams = useSearchParams();
  const scope = new URLSearchParams();
  for (const key of ['facilityId', 'accessAssignmentId']) {
    for (const value of searchParams.getAll(key)) scope.append(key, value);
  }
  const query = scope.toString();
  const [selectedPatientId, setSelectedPatientId] = useState(() => searchParams.get('patientId') ?? '');
  const [state, setState] = useState<OverviewState>({ scope: query, results: {}, unavailable: [] });
  const [pending, setPending] = useState(true);
  const [reload, setReload] = useState(0);
  const results = state.scope === query ? state.results : emptyResults;
  const loading = pending || state.scope !== query;

  useEffect(() => {
    const syncSelection = () => setSelectedPatientId(new URLSearchParams(window.location.search).get('patientId') ?? '');
    window.addEventListener('popstate', syncSelection);
    return () => window.removeEventListener('popstate', syncSelection);
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const sources: Source[] = [
      ...(capabilities.orders ? ['orders' as const] : []),
      ...(capabilities.chronicCare ? ['care' as const] : []),
      ...(capabilities.observations ? ['observations' as const] : []),
    ];
    const timer = window.setTimeout(() => {
      setPending(true);
      void Promise.all(sources.map(async (source) => {
        try {
          const response = await fetch(pathwaySourceUrl(source, new URLSearchParams(query)), { cache: 'no-store', signal: controller.signal });
          if (!response.ok) throw new Error('Не удалось загрузить раздел');
          return [source, projectPathwaySource(source, await response.json())] as const;
        } catch {
          return [source, null] as const;
        }
      })).then((entries) => {
        if (controller.signal.aborted) return;
        setState({ scope: query, results: Object.fromEntries(entries.filter(([, data]) => data !== null)),
          unavailable: entries.filter(([, data]) => data === null).map(([source]) => source) });
        setPending(false);
      });
    }, 0);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, reload, capabilities.orders, capabilities.chronicCare, capabilities.observations]);

  const patients = useMemo(() => {
    const unique = new Map<string, Patient>();
    Object.values(results).forEach((source) => source?.patients.forEach((item) => unique.set(item.id, item)));
    return [...unique.values()].sort((a, b) => a.displayName.localeCompare(b.displayName, 'ru'));
  }, [results]);
  const selectedPatient = patients.find((item) => item.id === selectedPatientId);
  const activePatientId = selectedPatient?.id ?? '';
  const events = useMemo(() => activePatientId ? Object.values(results).flatMap((source) => source?.events ?? [])
    .filter((item) => item.patient.id === activePatientId)
    .sort((a, b) => b.date - a.date).slice(0, 8) : [], [results, activePatientId]);
  const modules = [
    { source: 'orders' as const, view: 'orders' as const, label: 'Направления', enabled: capabilities.orders, icon: ClipboardList },
    { source: 'care' as const, view: 'care' as const, label: 'Наблюдение', enabled: capabilities.chronicCare, icon: HeartPulse },
    { source: 'observations' as const, view: 'observations' as const, label: 'Показатели', enabled: capabilities.observations, icon: Activity },
  ].filter((item) => item.enabled);

  function choosePatient(id: string) {
    const url = new URL(window.location.href);
    if (id) url.searchParams.set('patientId', id);
    else url.searchParams.delete('patientId');
    window.history.pushState(null, '', `${url.pathname}${url.search}${url.hash}`);
    setSelectedPatientId(id);
  }

  return <div className={styles.overview}>
    <header className={styles.overviewHeader}>
      <div><span className={styles.eyebrow}>РАБОЧАЯ ОБЛАСТЬ ВНУТРИ ORION</span><h1>Маршрут пациента</h1>
        <p>История действий и инструменты ухода в одной карте. Здесь показаны только доступные вам записи из подключённых разделов.</p></div>
      <div className={styles.patientPicker}><label htmlFor="pathway-patient">Пациент</label><select id="pathway-patient" value={activePatientId} onChange={(event) => choosePatient(event.target.value)}>
        <option value="">Выберите пациента</option>{patients.map((item) => <option key={item.id} value={item.id}>{item.displayName} · {item.medicalRecordNumber}</option>)}
      </select></div>
    </header>
    {selectedPatient && <section className={styles.patientHero} aria-label="Контекст маршрута">
      <div className={styles.patientIdentity}><span className={styles.patientAvatar}><UserRound size={27} aria-hidden="true" /></span><div><small>ВЫБРАННЫЙ ПАЦИЕНТ</small><strong>{selectedPatient.displayName}</strong><span>{selectedPatient.medicalRecordNumber}</span></div></div>
      <div className={styles.patientSignals}>{modules.map((item) => { const Icon = item.icon; const result = results[item.source];
        const count = result?.events.filter((event) => event.patient.id === activePatientId).length;
        return <div key={item.source}><Icon size={18} aria-hidden="true" /><span><strong>{loading || !result ? '—' : count}</strong><small>{item.label}</small></span></div>;
      })}</div>
    </section>}
    {state.scope === query && state.unavailable.length > 0 && <p className={styles.partialNotice} role="status">Не удалось загрузить: {state.unavailable.map((item) => sourceTitles[item]).join(', ')}. Их данные не включены в эту карту.</p>}
    <section className={styles.timelineSection} aria-labelledby="pathway-timeline-title">
      <div className={styles.timelineHeading}><div><span className={styles.eyebrow}>ХРОНОЛОГИЯ И СРОКИ</span><h2 id="pathway-timeline-title">Лента маршрута</h2><p>События и сроки задач из доступных разделов · не более 100 записей на раздел.</p></div>
        <button type="button" onClick={() => setReload((current) => current + 1)} disabled={loading}><RefreshCw size={17} aria-hidden="true" />Обновить</button></div>
      {!activePatientId ? <p className={styles.timelineEmpty}>Выберите пациента наверху — здесь появятся его назначения, наблюдение и записанные показатели.</p> : loading ? <p className={styles.timelineEmpty}>Загружаем историю маршрута…</p> : events.length === 0 ?
        <p className={styles.timelineEmpty}>В выбранной карте пока нет доступных событий.</p> :
        <div className={styles.timelineScroller}><div className={styles.timelineTrack}>
          {events.map((event) => <article className={styles.timelineEvent} key={`${event.source}:${event.id}`}>
            <span className={styles.timelineNode} aria-hidden="true" /><time dateTime={new Date(event.date).toISOString()}>{displayDate(event.date)}</time>
            <div className={styles.timelineCard}><small>{sourceTitles[event.source]} · {statusTitles[event.status] ?? event.status}</small><strong>{event.title}</strong>
              <span>{event.subtitle}</span></div>
          </article>)}
        </div></div>}
    </section>
  </div>;
}
