'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Activity, AlertCircle, ArrowLeft, CheckCircle2, Clock3, HeartPulse, History, Pencil, Plus,
  RefreshCw, Ruler, Scale, ShieldCheck, Thermometer, X } from 'lucide-react';
import type { LatestPatientVitals, ObservationVersionRecord } from '@/lib/repositories/patient-observations';
import type { ObservationContext } from '@/lib/domain/observations';
import { readCloudGenerationCookie } from '@/lib/cloud/account-fence';
import { appendCloudObservationHistory, appendCloudObservationRows, buildCloudObservationCommand,
  CLOUD_OBSERVATION_WINDOW_LIMIT, CloudObservationClientError, cloudObservationCanCorrect, cloudObservationDraft,
  cloudObservationQuery, cloudObservationSelectionKey, createCloudObservationFence, freezeCloudObservationCommand,
  parseCloudObservationHistoryClient, parseCloudObservationLatestClient, parseCloudObservationListClient,
  parseCloudObservationMutationClient, readBoundedCloudObservationResponse,
  type CloudObservationDraft, type CloudObservationHistory, type CloudObservationRecord,
  type CloudObservationSelection, type CloudObservationWorkspace } from '@/lib/cloud/observation-client-fence';
import styles from './cloud-observations.module.css';

const contextLabels: Record<ObservationContext, string> = {
  pre_visit: 'Перед приёмом', consultation: 'Консультация', follow_up: 'Контрольное наблюдение', other: 'Другой контекст',
};
const number = (value: number) => value.toLocaleString('ru-RU', { maximumFractionDigits: 3 });
export function cloudObservationFormatTime(value: number, timeZone: string) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone, day: '2-digit', month: 'short', year: 'numeric',
    hour: '2-digit', minute: '2-digit' }).format(new Date(value));
}
const errorMessage = (error: unknown) => error instanceof CloudObservationClientError ? error.message :
  'Не удалось получить подтверждённые данные. Обновите список.';
const accessFailure = (error: unknown) => error instanceof CloudObservationClientError &&
  ([401, 403, 404].includes(error.status) || error.code === 'SESSION_CHANGED');
type LatestState = { state: 'loading' | 'ready' | 'unavailable'; vitals: LatestPatientVitals | null; timeZone: string };
type FrozenCommand = ReturnType<typeof freezeCloudObservationCommand>;
type MeasurementForm = { scopeKey: string; correction?: CloudObservationRecord; draft: CloudObservationDraft;
  frozen: FrozenCommand | null; outcome: 'editable' | 'pending' | 'unknown' | 'conflict'; error: string | null };

/** The anatomy is an illustration, never a scan, sex inference or risk score. */
export function CloudObservationLatestPanel({ latest, sexAtBirth }: {
  latest: LatestState; sexAtBirth?: 'female' | 'male' | 'unknown' | 'not_recorded';
}) {
  const vitals = latest.state === 'ready' ? latest.vitals : null;
  const anatomy = sexAtBirth === 'female'
    ? { src: '/patient-body/anatomy-female-v1.png', alt: 'Женская анатомическая схема — иллюстрация' }
    : { src: '/patient-body/anatomy-v1.png', alt: sexAtBirth === 'male'
      ? 'Мужская анатомическая схема — иллюстрация' : 'Общая анатомическая схема — пол не указан' };
  const missing = latest.state === 'loading' ? 'Загружаем…' : latest.state === 'unavailable' ? 'Не удалось загрузить' : 'Не записано';
  const groups = [
    { key: 'anthropometry', label: 'Рост, вес и ИМТ', Icon: Ruler, source: vitals?.anthropometry,
      value: vitals?.anthropometry ? `${number(vitals.anthropometry.heightCm)} см · ${number(vitals.anthropometry.weightKg)} кг` : '—',
      secondary: vitals?.anthropometry ? `ИМТ ${number(vitals.anthropometry.bmi!)} кг/м²` : null },
    { key: 'bloodPressure', label: 'Давление', Icon: HeartPulse, source: vitals?.bloodPressure,
      value: vitals?.bloodPressure ? `${vitals.bloodPressure.systolicMmhg}/${vitals.bloodPressure.diastolicMmhg}` : '—',
      secondary: vitals?.bloodPressure ? 'мм рт. ст.' : null },
    { key: 'temperature', label: 'Температура', Icon: Thermometer, source: vitals?.temperature,
      value: vitals?.temperature ? `${number(vitals.temperature.temperatureC)} °C` : '—', secondary: null },
  ];
  return <section className={styles.latestPanel} aria-labelledby="cloud-latest-title">
    <div className={styles.anatomy}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={anatomy.src} alt={anatomy.alt} width="1024" height="1536" />
      {vitals?.bloodPressure && <span className={`${styles.callout} ${styles.heartCallout}`}><HeartPulse size={13} aria-hidden="true" />
        {vitals.bloodPressure.systolicMmhg}/{vitals.bloodPressure.diastolicMmhg}</span>}
      {vitals?.anthropometry && <span className={`${styles.callout} ${styles.weightCallout}`}><Scale size={13} aria-hidden="true" />
        {number(vitals.anthropometry.weightKg)} кг</span>}
      {vitals?.temperature && <span className={`${styles.callout} ${styles.temperatureCallout}`}><Thermometer size={13} aria-hidden="true" />
        {number(vitals.temperature.temperatureC)} °C</span>}
      <small>Иллюстративная схема</small>
    </div>
    <div className={styles.latestContent}>
      <span className={styles.eyebrow}>Последние сохранённые значения</span>
      <h2 id="cloud-latest-title">Карта показателей</h2>
      <div className={styles.latestGroups}>{groups.map(({ key, label, Icon, source, value, secondary }) => <article key={key} className={styles.latestGroup}>
        <span className={styles.groupLabel}><Icon size={15} aria-hidden="true" />{label}</span>
        <strong>{value}</strong>{secondary && <span className={styles.secondary}>{secondary}</span>}
        <small>{source ? cloudObservationFormatTime(source.measuredAt, latest.timeZone) : missing}</small>
        {source && <small>{source.recordedBy} · версия {source.version}</small>}
      </article>)}</div>
      <p className={styles.explanation}>Каждая группа сохраняет своё время измерения. Отсутствующее значение не означает норму.
        Клиническая оценка и правила тревоги не настроены.</p>
    </div>
  </section>;
}

export function CloudObservationValues({ version }: { version: ObservationVersionRecord }) {
  const values = version.values;
  return <div className={styles.values}>
    {values.heightCm !== null && <span><Ruler size={14} aria-hidden="true" />{number(values.heightCm)} см</span>}
    {values.weightKg !== null && <span><Scale size={14} aria-hidden="true" />{number(values.weightKg)} кг</span>}
    {values.bmi !== null && <span>ИМТ {number(values.bmi)} кг/м²</span>}
    {values.systolicMmhg !== null && <span><HeartPulse size={14} aria-hidden="true" />{values.systolicMmhg}/{values.diastolicMmhg} мм рт. ст.</span>}
    {values.temperatureC !== null && <span><Thermometer size={14} aria-hidden="true" />{number(values.temperatureC)} °C</span>}
  </div>;
}

export function CloudObservationsView({ selection, patientSexAtBirth }: {
  selection: CloudObservationSelection; patientSexAtBirth?: 'female' | 'male' | 'unknown' | 'not_recorded';
}) {
  const scopeKey = cloudObservationSelectionKey(selection);
  // Pin request callbacks to scalar bindings, not a newly-created parent object.
  const scope = useMemo(() => ({ ...selection }), [scopeKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const requests = useRef(createCloudObservationFence(() => readCloudGenerationCookie(document.cookie)));
  const formSection = useRef<HTMLElement>(null);
  const [loaded, setLoaded] = useState<{ scopeKey: string; value: CloudObservationWorkspace } | null>(null);
  const [latest, setLatest] = useState<{ scopeKey: string; value: LatestState } | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<CloudObservationHistory | null>(null);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [form, setForm] = useState<MeasurementForm | null>(null);
  const workspace = loaded?.scopeKey === scopeKey ? loaded.value : null;
  const selected = workspace?.observations.find(row => row.id === selectedId) ?? null;
  const activeForm = form?.scopeKey === scopeKey ? form : null;
  const workspaceRef = useRef(workspace); workspaceRef.current = workspace;
  const selectedRef = useRef(selectedId); selectedRef.current = selectedId;

  const clearAccess = useCallback((message: string) => {
    requests.current.retire(); setLoaded(null); setLatest(null); setSelectedId(null); setHistory(null);
    setForm(null); setLoading(false); setLoadingMore(false); setHistoryLoading(false); setNotice(null); setError(message);
  }, []);
  const loadLatest = useCallback(async () => {
    const ticket = requests.current.begin('latest', scope);
    try {
      if (!ticket.current()) return;
      const response = await fetch(`/api/observations/latest-vitals?${cloudObservationQuery(scope, { paged: false })}`,
        { cache: 'no-store', credentials: 'same-origin', signal: ticket.signal, headers: ticket.headers });
      const payload = await readBoundedCloudObservationResponse(response);
      if (!ticket.current()) return;
      const result = parseCloudObservationLatestClient(payload, scope);
      if (ticket.current()) setLatest({ scopeKey, value: { state: 'ready', ...result } });
    } catch (failure) {
      if (!ticket.current()) return;
      if (accessFailure(failure)) clearAccess(errorMessage(failure));
      else setLatest({ scopeKey, value: { state: 'unavailable', vitals: null, timeZone: 'UTC' } });
    } finally { ticket.finish(); }
  }, [scope, scopeKey, clearAccess]);
  const loadList = useCallback(async (continuation?: string) => {
    const ticket = requests.current.begin('list', scope);
    if (continuation) setLoadingMore(true); else setLoading(true);
    try {
      if (!ticket.current()) return;
      const previous = continuation ? workspaceRef.current : null;
      const response = await fetch(`/api/observations?${cloudObservationQuery(scope, { cursor: continuation })}`,
        { cache: 'no-store', credentials: 'same-origin', signal: ticket.signal, headers: ticket.headers });
      const payload = await readBoundedCloudObservationResponse(response);
      if (!ticket.current()) return;
      const result = parseCloudObservationListClient(payload, scope);
      const observations = continuation ? appendCloudObservationRows(previous?.observations ?? [], result.observations) : result.observations;
      if (continuation && (!previous || previous.page.nextCursor !== continuation || previous.assignmentVersionId !== result.assignmentVersionId ||
        previous.viewer.id !== result.viewer.id || previous.viewer.membershipId !== result.viewer.membershipId ||
        previous.viewer.role !== result.viewer.role || result.page.nextCursor === continuation)) throw new Error('Рабочий контур или позиция страницы изменились.');
      if (!ticket.current()) return;
      setLoaded({ scopeKey, value: { ...result, observations } }); setError(null);
    } catch (failure) {
      if (!ticket.current()) return;
      if (accessFailure(failure)) clearAccess(errorMessage(failure));
      else setError(errorMessage(failure));
    } finally {
      if (ticket.current()) { setLoading(false); setLoadingMore(false); }
      ticket.finish();
    }
  }, [scope, scopeKey, clearAccess]);
  const refresh = useCallback(() => {
    if (!requests.current.select(scope)) { clearAccess('Аккаунт изменился или сеанс завершён. Выполните вход и обновите страницу.'); return; }
    setLoaded(null); setLatest({ scopeKey, value: { state: 'loading', vitals: null, timeZone: 'UTC' } });
    setSelectedId(null); setHistory(null); setHistoryError(null); setError(null);
    setForm(current => current?.scopeKey === scopeKey ? current : null);
    if (!requests.current.accountCurrent()) { clearAccess('Сеанс изменился. Выполните вход заново.'); return; }
    void loadList(); void loadLatest();
  }, [scope, scopeKey, loadList, loadLatest, clearAccess]);

  useEffect(() => {
    const fence = requests.current;
    refresh();
    const checkAccount = () => {
      if (!fence.accountCurrent()) clearAccess('Аккаунт изменился. Выполните вход заново.');
    };
    // This only checks the readable generation cookie; no polling of Supabase.
    const timer = window.setInterval(checkAccount, 1000);
    window.addEventListener('focus', checkAccount); document.addEventListener('visibilitychange', checkAccount);
    return () => { window.clearInterval(timer); window.removeEventListener('focus', checkAccount);
      document.removeEventListener('visibilitychange', checkAccount); fence.retire(); };
  }, [refresh, clearAccess]);
  const formOpen = activeForm !== null;
  useEffect(() => {
    if (formOpen) formSection.current?.scrollIntoView({ block: 'start', behavior: 'auto' });
  }, [formOpen]);

  function chooseObservation(observation: CloudObservationRecord) {
    requests.current.begin('history', scope).cancel();
    setSelectedId(observation.id); setHistoryError(null); setHistoryLoading(false);
    setHistory({ observationId: observation.id, currentVersion: observation.currentVersion, items: observation.history,
      page: observation.historyPage, timeZone: workspace!.timeZone });
  }
  async function loadHistory() {
    if (!selected || !history?.page.nextCursor || historyLoading) return;
    const observation = selected; const previous = history; const cursor = history.page.nextCursor;
    const ticket = requests.current.begin('history', scope); setHistoryLoading(true); setHistoryError(null);
    try {
      if (!ticket.current()) return;
      const response = await fetch(`/api/observations/${encodeURIComponent(observation.id)}/history?${cloudObservationQuery(scope, { cursor })}`,
        { cache: 'no-store', credentials: 'same-origin', signal: ticket.signal, headers: ticket.headers });
      const payload = await readBoundedCloudObservationResponse(response);
      if (!ticket.current() || selectedRef.current !== observation.id) return;
      const result = parseCloudObservationHistoryClient(payload, scope, observation);
      if (result.page.nextCursor === cursor) throw new Error('Позиция истории не изменилась.');
      const items = appendCloudObservationHistory(previous.items, result.items);
      if (ticket.current() && selectedRef.current === observation.id) setHistory({ ...result, items });
    } catch (failure) {
      if (!ticket.current() || selectedRef.current !== observation.id) return;
      if (accessFailure(failure)) clearAccess(errorMessage(failure));
      else setHistoryError('История не подтверждена или изменилась. Обновите список и откройте запись заново.');
    } finally { if (ticket.current()) setHistoryLoading(false); ticket.finish(); }
  }
  function openForm(correction?: CloudObservationRecord) {
    if (!workspace || !requests.current.accountCurrent() || !workspace.capabilities[correction ? 'observation.correct' : 'observation.record'] ||
      (correction && !cloudObservationCanCorrect(workspace.viewer, correction))) return;
    setNotice(null); setForm({ scopeKey, correction, draft: cloudObservationDraft(correction), frozen: null, outcome: 'editable', error: null });
  }
  function editDraft<Key extends keyof CloudObservationDraft>(key: Key, value: CloudObservationDraft[Key]) {
    setForm(current => !current || current.scopeKey !== scopeKey || current.frozen ? current : { ...current, error: null,
      draft: { ...current.draft, [key]: value, idempotencyKey: crypto.randomUUID() } });
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!activeForm || !workspace || activeForm.outcome === 'pending' || activeForm.outcome === 'conflict') return;
    let command = activeForm.frozen;
    if (!command) {
      try { command = freezeCloudObservationCommand(scope, buildCloudObservationCommand(scope, activeForm.draft, activeForm.correction),
        requests.current.generation() ?? '', activeForm.correction?.id); }
      catch (failure) { setForm(current => current ? { ...current, error: failure instanceof Error && !('issues' in failure)
        ? failure.message : 'Проверьте время, заполненные группы, причину и подтверждение тестовых данных.' } : null); return; }
    }
    if (command.scopeKey !== scopeKey || command.generation !== requests.current.generation() ||
      !requests.current.accountCurrent()) { clearAccess('Сеанс изменился. Выполните вход заново.'); return; }
    const frozen = command;
    const ticket = requests.current.begin('mutation', scope);
    setForm(current => current ? { ...current, frozen, outcome: 'pending', error: null } : null);
    try {
      if (!ticket.current()) return;
      const response = await fetch(frozen.url, { method: frozen.method, body: frozen.body, signal: ticket.signal,
        cache: 'no-store', credentials: 'same-origin', headers: { ...ticket.headers, 'content-type': 'application/json' } });
      const payload = await readBoundedCloudObservationResponse(response);
      if (!ticket.current()) return;
      const result = parseCloudObservationMutationClient(payload, scope, frozen);
      if (!ticket.current()) return;
      // A replay receipt is a command-time snapshot, not the registry's current head.
      setForm(null); setNotice(result.replayed ? 'Сервер подтвердил ранее сохранённую команду. Получаем текущие значения.' :
        'Измерение сохранено. Предыдущие версии остаются в истории.');
      refresh();
    } catch (failure) {
      if (!ticket.current()) return;
      if (accessFailure(failure)) { clearAccess(errorMessage(failure)); return; }
      const unknown = !(failure instanceof CloudObservationClientError) || failure.status >= 500;
      setForm(current => current && current.scopeKey === scopeKey ? { ...current,
        frozen: unknown ? frozen : null, outcome: unknown ? 'unknown' : failure instanceof CloudObservationClientError && failure.status === 409 ? 'conflict' : 'editable',
        error: unknown ? 'Ответ не подтверждён: сервер мог сохранить измерение. Ввод заблокирован; повторите ту же команду с тем же ключом.' : errorMessage(failure) } : null);
    } finally { ticket.finish(); }
  }

  const patientUrl = `/patients/${encodeURIComponent(scope.patientId)}?${new URLSearchParams({ facilityId: scope.facilityId, accessAssignmentId: scope.accessAssignmentId })}`;
  const latestValue = latest?.scopeKey === scopeKey ? latest.value : { state: 'loading' as const, vitals: null, timeZone: 'UTC' };
  if (!workspace) return <section className={styles.workspace} aria-busy={loading}>
    <Link className={styles.back} href={patientUrl}><ArrowLeft size={16} aria-hidden="true" />Карточка пациента</Link>
    <h1>Показатели пациента</h1>
    {error ? <div className={styles.error} role="alert"><AlertCircle size={19} aria-hidden="true" />{error}</div> :
      <p role="status">Подтверждаем доступ и загружаем сохранённые измерения…</p>}
    {!loading && <button className={styles.button} type="button" onClick={refresh}><RefreshCw size={16} aria-hidden="true" />Повторить загрузку</button>}
  </section>;

  return <div className={styles.workspace}>
    <header className={styles.header}>
      <div><Link className={styles.back} href={patientUrl}><ArrowLeft size={16} aria-hidden="true" />Карточка пациента</Link>
        <span className={styles.eyebrow}>Показатели · {workspace.patient.medicalRecordNumber}</span>
        <h1>{workspace.patient.displayName}</h1><p>{workspace.facility.name} · {workspace.viewer.role === 'clinician' ? 'Врач' : 'Медсестра'}
          <span className={styles.source}>Тестовые данные · Supabase</span></p></div>
      <div className={styles.actions}>
        <button className={styles.button} type="button" disabled={loading || activeForm?.outcome === 'pending'} onClick={refresh}>
          <RefreshCw size={16} aria-hidden="true" />Обновить</button>
        <button className={`${styles.button} ${styles.primary}`} type="button" disabled={Boolean(activeForm) || !workspace.capabilities['observation.record']}
          onClick={() => openForm()}><Plus size={16} aria-hidden="true" />Записать измерение</button>
      </div>
    </header>
    {notice && <div className={styles.notice} role="status"><CheckCircle2 size={17} aria-hidden="true" />{notice}</div>}
    {error && <div className={styles.error} role="alert"><AlertCircle size={17} aria-hidden="true" />{error}</div>}
    <CloudObservationLatestPanel latest={latestValue} sexAtBirth={patientSexAtBirth} />
    <section className={styles.records} aria-labelledby="cloud-records-title">
      <header className={styles.sectionHeader}><div><h2 id="cloud-records-title">Сохранённые измерения</h2>
        <p>Измерено · {workspace.timeZone}. История исправлений открывается отдельно для каждой записи.</p></div>
        <span>{workspace.observations.length} загружено</span></header>
      {!workspace.observations.length ? <div className={styles.empty}><Activity size={24} aria-hidden="true" /><h3>Измерений пока нет</h3>
        <p>Значения появятся только после подтверждённой записи сотрудником.</p></div> : <div className={styles.recordList}>
        {workspace.observations.map(observation => <article className={`${styles.record} ${selectedId === observation.id ? styles.selected : ''}`} key={observation.id}>
          <div className={styles.recordMeta}><strong>{cloudObservationFormatTime(observation.current.measuredAt, workspace.timeZone)}</strong>
            <span>{contextLabels[observation.current.context]} · версия {observation.currentVersion}</span></div>
          <CloudObservationValues version={observation.current} />
          <div className={styles.recordFooter}><span>{observation.current.recordedBy}</span><div className={styles.actions}>
            <button className={styles.textButton} type="button" disabled={Boolean(activeForm)} onClick={() => chooseObservation(observation)}>
              <History size={15} aria-hidden="true" />История · {observation.historyCount}</button>
            {workspace.capabilities['observation.correct'] && cloudObservationCanCorrect(workspace.viewer, observation) &&
              <button className={styles.textButton} type="button" disabled={Boolean(activeForm)} onClick={() => openForm(observation)}>
                <Pencil size={15} aria-hidden="true" />Исправить</button>}
          </div></div>
        </article>)}
      </div>}
      {workspace.page.hasMore && workspace.observations.length < CLOUD_OBSERVATION_WINDOW_LIMIT && <button className={styles.button} type="button"
        disabled={loadingMore || Boolean(activeForm)} onClick={() => void loadList(workspace.page.nextCursor!)}>
        {loadingMore ? 'Загружаем…' : 'Ещё 25 измерений'}</button>}
      {workspace.page.hasMore && workspace.observations.length >= CLOUD_OBSERVATION_WINDOW_LIMIT &&
        <p className={styles.explanation}>Окно ограничено {CLOUD_OBSERVATION_WINDOW_LIMIT} последними записями. Это не полная выгрузка истории.</p>}
    </section>
    {selected && history?.observationId === selected.id && <section className={styles.history} aria-labelledby="cloud-history-title">
      <header className={styles.sectionHeader}><div><h2 id="cloud-history-title">История измерения</h2><p>Неизменяемые версии · {selected.historyCount} всего</p></div>
        <button className={styles.textButton} type="button" aria-label="Закрыть историю" onClick={() => {
          requests.current.begin('history', scope).cancel(); setSelectedId(null); setHistory(null); setHistoryLoading(false);
        }}><X size={18} aria-hidden="true" /></button></header>
      {historyError && <p className={styles.error} role="alert">{historyError}</p>}
      {history.items.map(version => <article className={styles.historyEntry} key={version.id}>
        <div className={styles.recordMeta}><strong>Версия {version.version}</strong><span>{contextLabels[version.context]} · измерено {cloudObservationFormatTime(version.measuredAt, history.timeZone)}</span></div>
        <CloudObservationValues version={version} /><p>{version.changeReason}</p>{version.note && <p className={styles.note}>Примечание: {version.note}</p>}
        <small><Clock3 size={13} aria-hidden="true" />Записано {cloudObservationFormatTime(version.recordedAt, history.timeZone)} · {version.recordedBy}</small>
      </article>)}
      {history.page.hasMore && history.items.length + Math.min(25, selected.historyCount - history.items.length) <= CLOUD_OBSERVATION_WINDOW_LIMIT && <button className={styles.button} type="button"
        disabled={historyLoading || Boolean(activeForm) || Boolean(historyError)} onClick={() => void loadHistory()}>
        {historyLoading ? 'Загружаем…' : 'Загрузить предыдущие версии'}</button>}
      {!history.page.hasMore && <p className={styles.explanation}>Все версии этой записи загружены.</p>}
      {history.page.hasMore && history.items.length + Math.min(25, selected.historyCount - history.items.length) > CLOUD_OBSERVATION_WINDOW_LIMIT &&
        <p className={styles.explanation}>Окно истории ограничено {CLOUD_OBSERVATION_WINDOW_LIMIT} версиями; старые версии сохранены на сервере.</p>}
    </section>}
    {activeForm && <section ref={formSection} className={styles.formSection} aria-labelledby="cloud-measurement-form-title">
      <header className={styles.sectionHeader}><div><span className={styles.eyebrow}>Ручной ввод сотрудника</span>
        <h2 id="cloud-measurement-form-title">{activeForm.correction ? `Исправить версию ${activeForm.correction.currentVersion}` : 'Новое измерение'}</h2></div>
        <button className={styles.textButton} type="button" disabled={activeForm.outcome === 'pending' || activeForm.outcome === 'unknown'}
          aria-label="Закрыть форму" onClick={() => setForm(null)}><X size={18} aria-hidden="true" /></button></header>
      <form onSubmit={event => void save(event)}>
        <fieldset disabled={Boolean(activeForm.frozen) || activeForm.outcome === 'conflict'} className={styles.formFields}>
          <div className={styles.formRow}><label>Время измерения (часовой пояс устройства)
            <input type="datetime-local" step="1" required value={activeForm.draft.measuredAt} onChange={event => editDraft('measuredAt', event.target.value)} /></label>
            <label>Контекст<select value={activeForm.draft.context} onChange={event => editDraft('context', event.target.value as ObservationContext)}>
              {Object.entries(contextLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
          <div className={styles.formGroups}>
            <div><label className={styles.checkbox}><input type="checkbox" checked={activeForm.draft.includeAnthropometry}
              onChange={event => editDraft('includeAnthropometry', event.target.checked)} />Рост и вес</label>
              <div className={styles.inputPair}><label>Рост, см<input inputMode="decimal" value={activeForm.draft.heightCm} disabled={!activeForm.draft.includeAnthropometry}
                onChange={event => editDraft('heightCm', event.target.value)} /></label><label>Вес, кг<input inputMode="decimal" value={activeForm.draft.weightKg}
                disabled={!activeForm.draft.includeAnthropometry} onChange={event => editDraft('weightKg', event.target.value)} /></label></div></div>
            <div><label className={styles.checkbox}><input type="checkbox" checked={activeForm.draft.includePressure}
              onChange={event => editDraft('includePressure', event.target.checked)} />Давление</label>
              <div className={styles.inputPair}><label>Верхнее<input inputMode="numeric" value={activeForm.draft.systolicMmhg} disabled={!activeForm.draft.includePressure}
                onChange={event => editDraft('systolicMmhg', event.target.value)} /></label><label>Нижнее<input inputMode="numeric" value={activeForm.draft.diastolicMmhg}
                disabled={!activeForm.draft.includePressure} onChange={event => editDraft('diastolicMmhg', event.target.value)} /></label></div></div>
            <div><label className={styles.checkbox}><input type="checkbox" checked={activeForm.draft.includeTemperature}
              onChange={event => editDraft('includeTemperature', event.target.checked)} />Температура</label>
              <label>°C<input inputMode="decimal" value={activeForm.draft.temperatureC} disabled={!activeForm.draft.includeTemperature}
                onChange={event => editDraft('temperatureC', event.target.value)} /></label></div>
          </div>
          <label>{activeForm.correction ? 'Причина исправления' : 'Основание записи'}<input required minLength={3} maxLength={500}
            value={activeForm.draft.reason} onChange={event => editDraft('reason', event.target.value)} /></label>
          <label>Примечание (необязательно)<textarea maxLength={1000} rows={2} value={activeForm.draft.note} onChange={event => editDraft('note', event.target.value)} /></label>
          <label className={styles.checkbox}><input type="checkbox" required checked={activeForm.draft.syntheticDataAcknowledged}
            onChange={event => editDraft('syntheticDataAcknowledged', event.target.checked)} />Подтверждаю: это тестовые данные, не сведения реального пациента.</label>
        </fieldset>
        {activeForm.error && <p className={styles.error} role="alert"><AlertCircle size={16} aria-hidden="true" />{activeForm.error}</p>}
        <div className={styles.formFooter}><p><ShieldCheck size={16} aria-hidden="true" />{activeForm.correction ? 'Исправление создаёт следующую версию. Исходная запись не удаляется.' :
          'Сохраняются только заполненные группы. ИМТ рассчитывается из записанных роста и веса.'}</p>
          <button className={`${styles.button} ${styles.primary}`} type="submit" disabled={activeForm.outcome === 'pending' || activeForm.outcome === 'conflict'}>
            {activeForm.outcome === 'pending' ? 'Сохраняем…' : activeForm.outcome === 'unknown' ? 'Повторить ту же команду' : 'Подтвердить и сохранить'}</button></div>
        {activeForm.outcome === 'conflict' && <button className={styles.button} type="button" onClick={() => { setForm(null); refresh(); }}>
          Обновить данные и открыть исправление заново</button>}
      </form>
    </section>}
  </div>;
}
