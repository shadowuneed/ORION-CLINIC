'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Building2, CalendarDays, CalendarPlus, Check, ClipboardList, Clock3, DoorOpen, History, LayoutDashboard, List, RefreshCw, Search, ShieldCheck, Stethoscope, Users } from 'lucide-react';
import { crmSnapshotSchema, crmVisitStatuses, type CrmCommand, type CrmSnapshot, type CrmTaskAction, type CrmTaskStatus, type CrmVisit, type CrmVisitStatus } from '@/lib/crm/contracts';
import { allowedCrmTaskActions } from '@/lib/crm/domain';
import { crmBirthDateLabel } from '@/lib/crm/patient-presentation';
import { CrmScene, type CrmSelection } from './crm-scene';
import { CrmOperations } from './crm-operations';
import { CrmBookingForm, CrmScheduling, CrmVisitActions } from './crm-scheduling';
import { CrmMapConsole } from './crm-map-console';
import styles from './crm.module.css';
import Link from 'next/link';
import { StartEncounterButton } from '../clinical/start-encounter-button';

export const crmVisitLabels: Record<CrmVisitStatus, string> = { scheduled: 'Запланирован', arrived: 'Прибыл', queued: 'В очереди', called: 'Вызван', in_service: 'На приёме', completed: 'Завершён', cancelled: 'Отменён', no_show: 'Неявка' };
const taskLabels: Record<CrmTaskStatus, string> = { pending: 'Ожидает', in_progress: 'В работе', completed: 'Завершена', escalated: 'Передана на разбор' };
const taskActionLabels: Record<CrmTaskAction, string> = { start: 'Взять в работу', complete: 'Завершить задачу', escalate: 'Передать на разбор' };
const roleLabels = { doctor: 'Врач', nurse: 'Медсестра', registrar: 'Регистратор', support: 'Поддержка' };
const roomLabels = { reception: 'Регистратура', consultation: 'Консультация', diagnostics: 'Диагностика', treatment: 'Процедурная', staff: 'Комната сотрудников' };
const stageStatuses: CrmVisitStatus[] = ['scheduled', 'arrived', 'queued', 'called', 'in_service', 'completed'];
export type CrmView = 'clinic' | 'overview' | 'schedule' | 'tasks' | 'patients' | 'resources';
const workspaceViews = [
  { id: 'clinic', label: 'План клиники', short: 'Карта', icon: Building2 },
  { id: 'overview', label: 'Рабочий центр', short: 'События', icon: LayoutDashboard },
  { id: 'schedule', label: 'Записи и очередь', short: 'Очередь', icon: CalendarDays },
  { id: 'tasks', label: 'Задачи', short: 'Задачи', icon: ClipboardList },
  { id: 'patients', label: 'Пациенты CRM', short: 'Пациенты', icon: Users },
  { id: 'resources', label: 'Команда и услуги', short: 'Ресурсы', icon: Stethoscope },
] as const;
export function crmHistoryDescription(event: CrmSnapshot['events'][number]) {
  if (event.kind === 'visit.rescheduled') return 'Время запланированного визита изменено';
  const labels = event.kind.startsWith('task.') ? taskLabels : crmVisitLabels;
  const statusLabel = (status: string) => (labels as Record<string, string>)[status] ?? status;
  return `${event.fromStatus ? `${statusLabel(event.fromStatus)} → ` : ''}${statusLabel(event.toStatus)}`;
}

function dateLabel(value: string, full = false) {
  return new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit', ...(full ? { year: 'numeric' } : {}) }).format(new Date(value));
}
function initials(value: string) { return value.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join(''); }

export function crmSummary(snapshot: CrmSnapshot) {
  return {
    active: snapshot.visits.filter(visit => !['completed', 'cancelled', 'no_show'].includes(visit.status)).length,
    queued: snapshot.visits.filter(visit => visit.status === 'queued').length,
    occupiedRooms: new Set(snapshot.visits.filter(visit => ['called', 'in_service'].includes(visit.status)).map(visit => visit.roomId)).size,
    openTasks: snapshot.tasks.filter(task => task.status !== 'completed').length,
  };
}
export function filterCrmVisits(snapshot: CrmSnapshot, search: string, status: string): CrmVisit[] {
  const query = search.trim().toLocaleLowerCase('ru-RU');
  const patients = new Map(snapshot.patients.map(patient => [patient.id, patient]));
  const staff = new Map(snapshot.staff.map(person => [person.id, person.name]));
  const rooms = new Map(snapshot.rooms.map(room => [room.id, room.name]));
  const services = new Map(snapshot.services.map(service => [service.id, service.name]));
  return snapshot.visits.filter(visit => (status === 'all' || visit.status === status) && (!query || [patients.get(visit.patientId)?.name, patients.get(visit.patientId)?.mrn, staff.get(visit.staffId), rooms.get(visit.roomId), services.get(visit.serviceId), crmVisitLabels[visit.status]].join(' ').toLocaleLowerCase('ru-RU').includes(query)));
}

/** A full snapshot may also contain another tab's creation. Never guess its ID. */
export function createdCrmVisit(snapshot: CrmSnapshot, command: Extract<CrmCommand, { type: 'visit.create' }>, previousIds: ReadonlySet<string>): CrmVisit | null {
  const matching = snapshot.visits.filter(visit => visit.patientId === command.patientId && visit.staffId === command.staffId && visit.roomId === command.roomId && visit.serviceId === command.serviceId && visit.scheduledAt === command.scheduledAt);
  const added = matching.filter(visit => !previousIds.has(visit.id));
  return added.length === 1 ? added[0] : added.length === 0 && matching.length === 1 ? matching[0] : null;
}

class CrmRequestError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
/** Both reads and commands return a validated, complete server snapshot. */
export async function readCrmResponse(response: Response): Promise<CrmSnapshot> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const message = body && typeof body === 'object' && 'error' in body && body.error && typeof body.error === 'object' && 'message' in body.error && typeof body.error.message === 'string' ? body.error.message.slice(0, 400) : 'Сервис CRM недоступен. Повторите запрос.';
    throw new CrmRequestError(message, response.status);
  }
  const result = crmSnapshotSchema.safeParse(body);
  if (!result.success) throw new CrmRequestError('Сервер вернул неполное состояние CRM. Обновите данные.', 502);
  return result.data;
}

export function CrmWorkspace({ initialSnapshot = null, initialView = 'clinic' }: { initialSnapshot?: CrmSnapshot | null; initialView?: CrmView }) {
  const [snapshot, setSnapshot] = useState<CrmSnapshot | null>(initialSnapshot);
  const [loading, setLoading] = useState(initialSnapshot === null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [pendingCommand, setPendingCommand] = useState<CrmCommand | null>(null);
  const [acknowledged, setAcknowledged] = useState(false);
  const [selection, setSelection] = useState<CrmSelection | null>(null);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [showForm, setShowForm] = useState(false);
  const [bookingPatientId, setBookingPatientId] = useState<string | undefined>();
  const [drawerTab, setDrawerTab] = useState<'details' | 'history'>('details');
  const [view, setView] = useState<CrmView>(initialView);
  const [operationsEpoch, setOperationsEpoch] = useState(0);
  const writeLock = useRef(false);
  const sequence = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const newVisitButton = useRef<HTMLButtonElement>(null);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const detailHeading = useRef<HTMLHeadingElement>(null);

  const load = useCallback(async () => {
    const request = ++sequence.current;
    controller.current?.abort();
    const next = new AbortController(); controller.current = next;
    setLoading(true); setError(null); setNotice('');
    try {
      // The root LocalAccountBoundary supplies the session generation and fences
      // late responses. This module never selects or forwards an identity.
      const data = await readCrmResponse(await fetch('/api/crm/v1/snapshot', { cache: 'no-store', credentials: 'same-origin', signal: AbortSignal.any([next.signal, AbortSignal.timeout(15000)]) }));
      if (request === sequence.current && !next.signal.aborted) setSnapshot(data);
    } catch (cause) {
      if (request === sequence.current && !next.signal.aborted) {
        if (cause instanceof CrmRequestError && [401, 403].includes(cause.status)) { setSnapshot(null); setAcknowledged(false); }
        setError(cause instanceof CrmRequestError ? cause.message : 'Не удалось загрузить CRM. Проверьте соединение и повторите.');
      }
    } finally { if (request === sequence.current) setLoading(false); }
  }, []);
  useEffect(() => {
    const requests = sequence;
    const active = controller;
    const timer = window.setTimeout(() => void load(), 0);
    return () => { window.clearTimeout(timer); ++requests.current; active.current?.abort(); };
  }, [load]);
  useEffect(() => { if (showForm) formHeading.current?.closest('[data-crm-map-console]')?.querySelector<HTMLButtonElement>('[data-crm-console-drag-header] button[aria-controls]')?.focus({ preventScroll: true }); }, [showForm]);
  useEffect(() => {
    if (!selection || showForm) return;
    detailHeading.current?.closest('[data-crm-map-console]')?.querySelector<HTMLButtonElement>('[data-crm-console-drag-header] button[aria-controls]')?.focus({ preventScroll: true });
  }, [selection, showForm]);

  const filtered = useMemo(() => snapshot ? filterCrmVisits(snapshot, search, status) : [], [snapshot, search, status]);
  const visibleVisitIds = useMemo(() => new Set(filtered.map(visit => visit.id)), [filtered]);
  const summary = snapshot ? crmSummary(snapshot) : null;
  const canManage = snapshot?.capabilities.manage === true;
  const canWrite = canManage && acknowledged && !loading && !busy && !error && !pendingCommand;
  const selectedVisit = selection?.kind === 'visit' ? snapshot?.visits.find(visit => visit.id === selection.id) : null;
  const selectedRoom = selection?.kind === 'room' ? snapshot?.rooms.find(room => room.id === selection.id) : null;
  const selectedStaff = selection?.kind === 'staff' ? snapshot?.staff.find(person => person.id === selection.id) : null;
  const selectedPatient = snapshot?.patients.find(patient => patient.id === (selection?.kind === 'patient' ? selection.id : selectedVisit?.patientId));
  const selectedService = selection?.kind === 'service' ? snapshot?.services.find(service => service.id === selection.id) : null;
  const selectedVisits = snapshot?.visits.filter(visit => selectedVisit ? visit.id === selectedVisit.id : selectedRoom ? visit.roomId === selectedRoom.id : selectedStaff ? visit.staffId === selectedStaff.id : selectedPatient ? visit.patientId === selectedPatient.id : selectedService ? visit.serviceId === selectedService.id : false) ?? [];
  const selectedVisitIds = new Set(selectedVisits.map(visit => visit.id));
  const selectedTasks = snapshot?.tasks.filter(task => selectedVisitIds.has(task.visitId) || (selectedStaff && task.ownerId === selectedStaff.id)) ?? [];
  const historyIds = new Set([...selectedVisits.map(visit => visit.id), ...selectedTasks.map(task => task.id)]);
  const history = snapshot?.events.filter(event => historyIds.has(event.resourceId)) ?? [];

  function select(next: CrmSelection) {
    if (showForm || busy || pendingCommand) return;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelection(next); setDrawerTab('details');
  }
  function closeDrawer() { setSelection(null); requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }); }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented || busy || pendingCommand) return;
      if (event.target instanceof Element && event.target.closest('[data-crm-map-console], form, input, select, textarea, [contenteditable]:not([contenteditable="false"])')) return;
      if (showForm) { setShowForm(false); newVisitButton.current?.focus(); }
      else if (selection) { setSelection(null); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }
      else if (view !== 'clinic') setView('clinic');
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [showForm, selection, busy, pendingCommand, view]);

  async function execute(command: CrmCommand): Promise<boolean> {
    if (!canManage || !acknowledged || busy || loading || writeLock.current ||
      (pendingCommand && pendingCommand.idempotencyKey !== command.idempotencyKey)) return false;
    writeLock.current = true;
    const request = ++sequence.current;
    controller.current?.abort();
    const next = new AbortController(); controller.current = next;
    const previousIds = new Set(snapshot?.visits.map(visit => visit.id));
    setBusy(true); setPendingCommand(command); setError(null); setNotice('');
    try {
      const data = await readCrmResponse(await fetch('/api/crm/v1/commands', { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(command), signal: AbortSignal.any([next.signal, AbortSignal.timeout(20000)]) }));
      if (request !== sequence.current || next.signal.aborted) return false;
      setSnapshot(data); setPendingCommand(null); setNotice('Изменение сохранено в CRM.');
      // A confirmed retry is authoritative too: discard the submitted form so a
      // still-populated draft cannot accidentally be submitted with a fresh key.
      if (command.type === 'task.create' || command.type === 'visit.reschedule') setOperationsEpoch(value => value + 1);
      if (command.type === 'visit.create') {
        const created = createdCrmVisit(data, command, previousIds);
        setShowForm(false); setBookingPatientId(undefined);
        if (created) { setSelection({ kind: 'visit', id: created.id }); setDrawerTab('details'); }
        else { setSelection(null); setSearch(''); setStatus('all'); setNotice('Визит сохранён. Откройте нужную запись в списке визитов.'); }
        newVisitButton.current?.focus({ preventScroll: true });
      }
      return true;
    } catch (cause) {
      if (request !== sequence.current || next.signal.aborted) return false;
      if (cause instanceof CrmRequestError && [401, 403].includes(cause.status)) { setSnapshot(null); setAcknowledged(false); }
      if (cause instanceof CrmRequestError && cause.status >= 400 && cause.status < 500) setPendingCommand(null);
      setError(cause instanceof CrmRequestError ? cause.message : 'Ответ на изменение не получен. Повторите тот же запрос, чтобы проверить сохранение без дубликата.');
      return false;
    } finally { writeLock.current = false; if (request === sequence.current) setBusy(false); }
  }

  return <main className={`${styles.workspace} ${styles.gameWorkspace}`} aria-busy={loading || busy}>
    <header className={styles.pageHeader}><div><p className={styles.eyebrow}>ORION / CRM</p><div className={styles.titleLine}><h1>Клиника в движении</h1><span className={styles.simulationBadge}><ShieldCheck size={14} aria-hidden="true" />Учебная БД{snapshot ? ` · ${snapshot.patients.length} пациентов` : ''}</span></div><p className={styles.subtitle}>Кабинеты, пациенты, записи и задачи загружаются из базы CRM.</p></div><div className={styles.headerActions}><button className={styles.secondaryButton} type="button" onClick={() => void load()} disabled={loading || busy || !!pendingCommand} aria-label="Обновить состояние CRM"><RefreshCw size={16} aria-hidden="true" className={loading ? styles.spinning : undefined} /><span>Обновить</span></button><button className={styles.primaryButton} ref={newVisitButton} type="button" disabled={!canManage || loading || busy || !!pendingCommand || !!error} onClick={() => { setBookingPatientId(selectedPatient?.id); setShowForm(true); setSelection(null); }}><CalendarPlus size={17} aria-hidden="true" />Новый визит</button></div></header>

    {snapshot && <>
      <nav className={styles.workspaceNav} aria-label="Инструменты единой карты CRM">{workspaceViews.map(item => <button key={item.id} type="button" aria-label={item.label} title={item.label} aria-pressed={view === item.id} disabled={busy || !!pendingCommand || showForm} onClick={() => { setView(current => current === item.id ? 'clinic' : item.id); setSelection(null); }}><item.icon size={18} aria-hidden="true" /><span>{item.short}</span></button>)}</nav>
      <div className={styles.controlNotice}><ShieldCheck size={17} aria-hidden="true" /><p>{canManage ? 'Изменения сохраняются в общей PostgreSQL-базе ORION. Здесь показаны только ваши визиты и задачи.' : 'Для вашего аккаунта доступен только просмотр CRM.'}</p>{canManage && <label className={styles.acknowledgment}><input type="checkbox" checked={acknowledged} disabled={busy || !!pendingCommand} onChange={event => setAcknowledged(event.target.checked)} /><span>Работаю с учебной БД</span></label>}</div>
    </>}

    {snapshot && <>
      {<div className={styles.summaryRow} aria-label="Показатели загруженных записей">{[
        { label: 'Активные визиты', value: summary!.active, icon: Users, detail: 'Все загруженные записи', tone: 'teal' },
        { label: 'В очереди', value: summary!.queued, icon: Clock3, detail: 'Сохранённый этап', tone: 'blue' },
        { label: 'Кабинеты заняты', value: summary!.occupiedRooms, icon: DoorOpen, detail: `Приём или вызов · из ${snapshot.rooms.length}`, tone: 'purple' },
        { label: 'Открытые задачи', value: summary!.openTasks, icon: ClipboardList, detail: 'Включая переданные на разбор', tone: 'amber' },
      ].map(item => <article className={styles.metric} key={item.label} data-tone={item.tone}><span className={styles.metricIcon}><item.icon size={18} aria-hidden="true" /></span><div><span>{item.label}</span><strong>{item.value}</strong><small>{item.detail}</small></div></article>)}</div>}
      <div className={styles.searchRow}><label className={styles.searchField}><Search size={17} aria-hidden="true" /><span className={styles.srOnly}>Поиск по пациенту, сотруднику, кабинету или услуге в CRM</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Найти визит на карте…" maxLength={160} /></label><label className={styles.statusField}><span className={styles.srOnly}>Этап визита</span><select value={status} onChange={event => setStatus(event.target.value)}><option value="all">Все этапы</option>{crmVisitStatuses.map(item => <option value={item} key={item}>{crmVisitLabels[item]}</option>)}</select></label></div>
    </>}
    <div className={styles.feedback} aria-live="polite" aria-atomic="true">{loading && <p role="status">{snapshot ? 'Обновляем сохранённое состояние…' : 'Открываем CRM…'}</p>}{busy && <p role="status">Сохраняем изменение…</p>}{notice && <p className={styles.successMessage}><Check size={15} aria-hidden="true" />{notice}</p>}{error && <div className={styles.errorMessage} role="alert"><p>{error}{snapshot && ' Показано последнее успешно загруженное состояние.'}</p>{pendingCommand ? <button type="button" className={styles.secondaryButton} disabled={busy || loading || !acknowledged} onClick={() => void execute(pendingCommand)}>Повторить тот же запрос</button> : <button type="button" className={styles.secondaryButton} disabled={loading || busy} onClick={() => void load()}>Загрузить актуальные данные</button>}</div>}</div>
    {!snapshot && loading && <div className={styles.initialPlaceholder} aria-hidden="true"><div className={styles.placeholderNav} /><div className={styles.placeholderMetrics}>{[0, 1, 2, 3].map(key => <div key={key} />)}</div><div className={styles.placeholderScene}><Building2 size={40} /></div></div>}
    {!snapshot && !loading && <section className={styles.unavailable}><Building2 size={38} aria-hidden="true" /><h2>CRM пока недоступна</h2><p>Помещения, пациенты и показатели появятся после успешной загрузки из отдельной CRM.</p></section>}

    {snapshot && <>
      <div className={styles.mapStage}>
        <CrmScene gameMode snapshot={snapshot} selection={selection} onSelect={select} visibleVisitIds={visibleVisitIds} />
        <p className={styles.mapHelp}>Тяни карту · колесо — масштаб · объект — детали · Home — вернуть вид. Движение по БД, не геолокация.</p>
        {view !== 'clinic' && !showForm && !selection && <CrmMapConsole key={`${view}:${operationsEpoch}`} title={workspaceViews.find(item=>item.id===view)?.label ?? 'Инструменты CRM'} kind="operations" disabled={busy || !!pendingCommand} onClose={()=>setView('clinic')}>
          {view === 'schedule' ? <CrmScheduling snapshot={snapshot} onSelect={select} onCommand={execute} canWrite={canWrite} blocked={busy || loading || !!pendingCommand || !!error} /> : <CrmOperations snapshot={snapshot} view={view} onSelect={select} onCommand={execute} canWrite={canWrite} blocked={busy || loading || !!pendingCommand || !!error} />}
        </CrmMapConsole>}
        <div className={styles.mapFlow}>
          <section className={styles.flowCard} aria-labelledby="crm-flow-title"><header><h2 id="crm-flow-title">Маршрут визита</h2><span>Этапы меняются вручную</span></header><div className={styles.flowRail}>{stageStatuses.map((stage, index) => <button type="button" key={stage} data-status={stage} aria-pressed={status === stage} onClick={() => setStatus(current => current === stage ? 'all' : stage)}><span className={styles.stageNumber}>{index + 1}</span><span><strong>{crmVisitLabels[stage]}</strong><small>{snapshot.visits.filter(visit => visit.status === stage).length} записей</small></span>{index < stageStatuses.length - 1 && <ArrowRight size={15} className={styles.stageArrow} aria-hidden="true" />}</button>)}</div></section>
        </div>
        {(selection || showForm) && <CrmMapConsole title={showForm ? 'Новый визит' : selectedPatient?.name ?? selectedRoom?.name ?? selectedStaff?.name ?? selectedService?.name ?? 'Детали объекта'} kind={showForm ? 'booking' : 'details'} disabled={busy || !!pendingCommand} onClose={()=>{if(showForm){setShowForm(false);newVisitButton.current?.focus();}else closeDrawer();}}>
        <aside className={styles.drawer} data-crm-console-details aria-labelledby="crm-detail-title">
          {showForm ? <><h2 className={styles.srOnly} id="crm-detail-title" ref={formHeading} tabIndex={-1}>Новый визит</h2>
            <CrmBookingForm snapshot={snapshot} onCommand={execute} canWrite={canWrite} blocked={busy || loading || !!pendingCommand || !!error} initialPatientId={bookingPatientId} /></> : <>
            <h2 className={styles.srOnly} id="crm-detail-title" ref={detailHeading} tabIndex={-1}>{selectedPatient?.name ?? selectedRoom?.name ?? selectedStaff?.name ?? selectedService?.name ?? 'Выберите объект'}</h2>
            {!selection ? <div className={styles.drawerIntro}><div className={styles.introIcon}><Stethoscope size={32} aria-hidden="true" /></div><h3>Каждая деталь связана с записью</h3><p>Откройте кабинет на схеме или визит в списке, чтобы увидеть сотрудников, задачи и историю.</p><div className={styles.clinicName}><Building2 size={17} aria-hidden="true" /><span>{snapshot.clinic.name}</span></div><div className={styles.miniLegend}><span><i data-status="queued" />Очередь</span><span><i data-status="in_service" />Приём</span><span><i data-status="completed" />Завершено</span></div></div> : <>
              <div className={styles.drawerTabs} aria-label="Представление выбранного объекта"><button type="button" aria-pressed={drawerTab === 'details'} onClick={() => setDrawerTab('details')}><List size={15} aria-hidden="true" />Детали</button><button type="button" aria-pressed={drawerTab === 'history'} onClick={() => setDrawerTab('history')}><History size={15} aria-hidden="true" />История <span>{history.length}</span></button></div>
              {drawerTab === 'history' ? <div className={styles.historyPanel}><p className={styles.muted}>Последние 50 событий CRM; показаны события выбранного объекта.</p>{history.length === 0 ? <p className={styles.emptyNote}>Событий в загруженной истории пока нет.</p> : <ol className={styles.historyList}>{[...history].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(event => <li key={event.id}><span className={styles.historyDot} /><div><strong>{event.kind.startsWith('visit') ? 'Визит' : 'Задача CRM'}</strong><p>{crmHistoryDescription(event)}</p><small>{event.actorLabel} · {dateLabel(event.createdAt)}</small></div></li>)}</ol>}</div> : <div className={styles.drawerDetails}>
                {selectedPatient && <><div className={styles.headerActions}><StartEncounterButton patientId={selectedPatient.id} visitId={selectedVisit?.id} className={styles.primaryButton} disabled={busy || loading || !!pendingCommand || !!error || !!selectedVisit && ['completed', 'cancelled', 'no_show'].includes(selectedVisit.status)} label={selectedVisit?.status === 'in_service' ? 'Открыть приём' : 'Начать приём'} /><Link className={styles.secondaryButton} href={`/patients/${encodeURIComponent(selectedPatient.id)}`}>Карта пациента</Link></div><p className={styles.emptyNote}>Дата рождения {crmBirthDateLabel(selectedPatient.birthDate)}. Карта, записи приёмов и очередь связаны с одним пациентом в PostgreSQL.</p></>}
                {selectedVisit && <><div className={styles.visitIdentity}><span className={styles.patientAvatar}>{initials(selectedPatient?.name ?? '')}</span><div><strong>{selectedPatient?.mrn}</strong><span className={styles.statusBadge} data-status={selectedVisit.status}>{crmVisitLabels[selectedVisit.status]}</span></div></div><dl className={styles.detailFields}><div><dt>Услуга</dt><dd>{snapshot.services.find(service => service.id === selectedVisit.serviceId)?.name}</dd></div><div><dt>Сотрудник</dt><dd>{snapshot.staff.find(person => person.id === selectedVisit.staffId)?.name}</dd></div><div><dt>Кабинет</dt><dd>{snapshot.rooms.find(room => room.id === selectedVisit.roomId)?.name}</dd></div><div><dt>Запланирован</dt><dd>{dateLabel(selectedVisit.scheduledAt, true)}</dd></div><div><dt>Длительность записи</dt><dd>{selectedVisit.durationMinutes ? `${selectedVisit.durationMinutes} мин` : 'Не зафиксирована'}</dd></div><div><dt>Последнее изменение</dt><dd>{dateLabel(selectedVisit.updatedAt)}</dd></div></dl>{selectedVisit.bookingSource === 'catalogue_backfill' && <p className={styles.emptyNote}>Длительность старой записи закреплена по каталогу при подключении календаря; это не измеренное время приёма.</p>}<CrmVisitActions key={`${selectedVisit.id}:${selectedVisit.version}`} snapshot={snapshot} visit={selectedVisit} onCommand={execute} canWrite={canWrite} suppressStart blocked={busy || loading || !!pendingCommand || !!error} /></>}
                {selectedRoom && <><p className={styles.roomType}>{roomLabels[selectedRoom.kind]}</p><h3>Сотрудники кабинета</h3><div className={styles.staffList}>{snapshot.staff.filter(person => person.roomId === selectedRoom.id).map(person => <button type="button" key={person.id} disabled={busy || !!pendingCommand} onClick={() => select({ kind: 'staff', id: person.id })}><span className={styles.staffAvatar}>{initials(person.name)}</span><span><strong>{person.name}</strong><small>{roleLabels[person.role]}</small></span><ArrowRight size={14} aria-hidden="true" /></button>)}</div></>}
                {selectedStaff && <p className={styles.roomType}>{roleLabels[selectedStaff.role]} · {snapshot.rooms.find(room => room.id === selectedStaff.roomId)?.name}</p>}
                {selectedPatient && !selectedVisit && <><div className={styles.visitIdentity}><span className={styles.patientAvatar}>{initials(selectedPatient.name)}</span><div><strong>{selectedPatient.mrn}</strong><span className={styles.muted}>{({ female: 'Женский', male: 'Мужской', unknown: 'Пол не указан' })[selectedPatient.sex]}</span></div></div><dl className={styles.detailFields}><div><dt>Визитов в CRM</dt><dd>{selectedVisits.length}</dd></div><div><dt>Открытых задач</dt><dd>{selectedTasks.filter(task => task.status !== 'completed').length}</dd></div><div><dt>Последнее изменение</dt><dd>{selectedVisits.length ? dateLabel([...selectedVisits].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0].updatedAt) : 'Визитов пока нет'}</dd></div></dl><p className={styles.emptyNote}>Это реестр CRM. Медицинские показатели и контакты из старой базы сюда не переносились.</p></>}
                {selectedService && <><dl className={styles.detailFields}><div><dt>Продолжительность</dt><dd>{selectedService.durationMinutes} мин</dd></div><div><dt>Тип кабинета</dt><dd>{roomLabels[selectedService.roomKind]}</dd></div></dl><h3>Совместимые кабинеты</h3><div className={styles.drawerVisitList}>{snapshot.rooms.filter(room => room.kind === selectedService.roomKind).map(room => <button key={room.id} type="button" disabled={busy || !!pendingCommand} onClick={() => select({ kind: 'room', id: room.id })}><strong>{room.name}</strong><ArrowRight size={15} aria-hidden="true" /></button>)}</div></>}
                {!selectedVisit && <><h3>Визиты <span>{selectedVisits.length}</span></h3>{selectedVisits.length === 0 && <p className={styles.emptyNote}>Для этого объекта визитов пока нет.</p>}<div className={styles.drawerVisitList}>{selectedVisits.slice(0, 30).map(visit => <button type="button" key={visit.id} disabled={busy || !!pendingCommand} onClick={() => select({ kind: 'visit', id: visit.id })}><span><strong>{snapshot.patients.find(patient => patient.id === visit.patientId)?.name}</strong><small>{dateLabel(visit.scheduledAt)}</small></span><span className={styles.statusBadge} data-status={visit.status}>{crmVisitLabels[visit.status]}</span></button>)}</div>{selectedVisits.length > 30 && <p className={styles.muted}>Первые 30 записей; все визиты доступны в списке ниже.</p>}</>}
                <h3>Задачи CRM <span>{selectedTasks.length}</span></h3>{selectedTasks.length === 0 && <p className={styles.emptyNote}>Сохранённых задач пока нет.</p>}<div className={styles.taskList}>{selectedTasks.slice(0, 30).map(task => <article key={task.id}><div className={styles.taskHeader}><ClipboardList size={15} aria-hidden="true" /><strong>{task.title}</strong>{task.priority === 'urgent' && <span className={styles.urgentBadge}>Срочная</span>}</div><p>{snapshot.staff.find(person => person.id === task.ownerId)?.name} · до {dateLabel(task.dueAt)}</p><span className={styles.taskStatus}>{taskLabels[task.status]}</span><div className={styles.taskActions}>{allowedCrmTaskActions(task.status).map(action => <button type="button" className={styles.secondaryButton} disabled={!canWrite} key={action} onClick={() => { if (canWrite) void execute({ type: 'task.transition', taskId: task.id, expectedVersion: task.version, action, testDataAcknowledged: true, idempotencyKey: crypto.randomUUID() }); }}>{taskActionLabels[action]}</button>)}</div></article>)}</div>{selectedTasks.length > 30 && <p className={styles.muted}>Показаны первые 30 задач выбранного объекта.</p>}
              </div>}
            </>}
          </>}
        </aside></CrmMapConsole>}
      </div>
      <div className={styles.safetyBar}><Activity size={17} aria-hidden="true" /><p>CRM, карточка пациента и очный приём используют одну базу. Подтверждённая запись приёма появляется в карточке; черновики остаются у автора.</p>{!canManage && <span>Только просмотр</span>}</div>
      {view === 'clinic' && <details className={styles.recordList} open={snapshot.visits.length === 0 || search.length > 0}><summary><List size={18} aria-hidden="true" /><span>Визиты списком</span><b>{filtered.length}</b><span className={styles.listHint}>Все этапы · доступно с клавиатуры</span></summary><div className={styles.visitTable}>{filtered.length === 0 ? <p className={styles.emptyNote}>{snapshot.visits.length === 0 ? 'Визитов пока нет. Создайте первый визит — он появится здесь и на схеме.' : 'По этим условиям визиты не найдены. Измените поиск или этап.'}</p> : filtered.slice(0, 100).map(visit => <button type="button" className={styles.visitRow} key={visit.id} aria-pressed={selection?.kind === 'visit' && selection.id === visit.id} disabled={showForm || busy || !!pendingCommand} onClick={() => select({ kind: 'visit', id: visit.id })}><span className={styles.patientAvatar}>{initials(snapshot.patients.find(patient => patient.id === visit.patientId)?.name ?? '')}</span><span className={styles.rowPatient}><strong>{snapshot.patients.find(patient => patient.id === visit.patientId)?.name}</strong><small>{snapshot.patients.find(patient => patient.id === visit.patientId)?.mrn}</small></span><span className={styles.rowService}>{snapshot.services.find(service => service.id === visit.serviceId)?.name}<small>{snapshot.staff.find(person => person.id === visit.staffId)?.name}</small></span><span className={styles.rowTime}>{dateLabel(visit.scheduledAt)}</span><span className={styles.statusBadge} data-status={visit.status}>{crmVisitLabels[visit.status]}</span><ArrowRight size={16} aria-hidden="true" /></button>)}</div>{filtered.length > 100 && <p className={styles.muted}>Первые 100 из {filtered.length} найденных записей. Уточните поиск для остальных.</p>}</details>}
    </>}
  </main>;
}
