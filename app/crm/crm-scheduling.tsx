'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarClock, CalendarDays, Check, Clock3, DoorOpen, Info, List, Search, ShieldCheck, Users, X } from 'lucide-react';
import { crmCommandSchema, crmVisitStatuses, type CrmCommand, type CrmSnapshot, type CrmVisit, type CrmVisitAction, type CrmVisitStatus } from '@/lib/crm/contracts';
import { allowedCrmVisitActions, canRescheduleCrmVisit } from '@/lib/crm/domain';
import { crmOperationsIndex, crmRoomKindLabels, crmStaffRoleLabels } from '@/lib/crm/operations';
import { availableSlots, bookingAvailability, clinicCalendar, clinicDateTimeToIso, clinicDay, clinicMinute,
  queueActionState, queueOrderSource, queueTimeSource, queueVisits, visitConflicts, visitDuration, visitDurationSource, waitingAge } from '@/lib/crm/scheduling';
import type { CrmSelection } from './crm-scene';
import styles from './crm-scheduling.module.css';
import { StartEncounterButton } from '../clinical/start-encounter-button';

type SharedProps = { snapshot: CrmSnapshot; onCommand: (command: CrmCommand) => Promise<boolean>; canWrite: boolean; blocked: boolean };
export type CrmSchedulingProps = SharedProps & { onSelect: (selection: CrmSelection) => void };
export type CrmBookingFormProps = SharedProps & { initialPatientId?: string };
type BookingDraft = { patientId: string; staffId: string; roomId: string; serviceId: string; day: string; time: string };
const statusLabels: Record<CrmVisitStatus, string> = { scheduled: 'Запланирован', arrived: 'Прибыл', queued: 'В очереди', called: 'Приглашён', in_service: 'На приёме', completed: 'Завершён', cancelled: 'Отменён', no_show: 'Не явился' };
const actionLabels: Record<CrmVisitAction, string> = { arrive: 'Отметить прибытие', queue: 'В очередь', call: 'Пригласить в кабинет', requeue: 'Вернуть в очередь', start: 'Начать приём', complete: 'Завершить визит', cancel: 'Отменить визит', mark_no_show: 'Отметить неявку' };
const queueStates: CrmVisitStatus[] = ['in_service', 'called', 'queued', 'arrived'];
const weekdayLabels = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const minuteLabel = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
function formatVisitDate(iso: string, timeZone?: string, timeOnly = false) {
  if (!timeZone) return iso;
  return new Intl.DateTimeFormat('ru-RU', { timeZone, ...(timeOnly ? {} : { day: '2-digit', month: 'short' }), hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join(''); }
function writeGuidance(snapshot: CrmSnapshot, canWrite: boolean, blocked: boolean) {
  return !snapshot.capabilities.manage ? 'Доступ к этой CRM позволяет только просмотр.' : blocked ? 'Дождитесь сохранения или разрешите неопределённый результат в сообщении рабочего пространства.' : !canWrite ? 'Для изменений подтвердите работу с учебной БД внизу рабочего пространства.' : '';
}

export type CrmVisitActionsProps = SharedProps & { visit: CrmVisit; suppressStart?: boolean };
/** All entry points share current-state/FIFO checks and explicit destructive confirmation. */
export function CrmVisitActions({ snapshot, visit, onCommand, canWrite, blocked, suppressStart = false }: CrmVisitActionsProps) {
  const [confirmation, setConfirmation] = useState<'cancel' | 'mark_no_show' | null>(null);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const lock = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const locked = blocked || sending;
  const enabled = canWrite && snapshot.capabilities.manage && !locked;
  const guidance = writeGuidance(snapshot, canWrite, locked);
  useEffect(() => { if (confirmation) heading.current?.focus({ preventScroll: true }); }, [confirmation]);
  function close() {
    if (locked) return;
    setConfirmation(null);
    if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
  }
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && confirmation && !locked) {
        setConfirmation(null); if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [confirmation, locked]);
  async function perform(action: CrmVisitAction) {
    if (!enabled || lock.current || !queueActionState(snapshot, visit, action).allowed) return;
    lock.current = true; setSending(true); setError('');
    try {
      if (await onCommand({ type: 'visit.transition', visitId: visit.id, expectedVersion: visit.version, action, testDataAcknowledged: true, idempotencyKey: crypto.randomUUID() })) {
        setConfirmation(null); requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); });
      }
    } catch { setError('Ответ на изменение не получен. Проверьте сообщение рабочего пространства и сохранённый результат.'); }
    finally { lock.current = false; setSending(false); }
  }
  return <div className={styles.visitActions}>
    <div className={styles.rowActions}>{!suppressStart && !['completed', 'cancelled', 'no_show'].includes(visit.status) && <StartEncounterButton patientId={visit.patientId} visitId={visit.id} className={styles.primaryButton} disabled={!enabled || !!confirmation} label={visit.status === 'in_service' ? 'Открыть приём' : 'Начать приём'} />}{allowedCrmVisitActions(visit.status).filter(action => !['start', 'complete'].includes(action)).map(action => {
      const state = queueActionState(snapshot, visit, action);
      return <div key={action}><button type="button" className={['call', 'start', 'complete'].includes(action) ? styles.primaryButton : styles.smallButton} disabled={!enabled || !state.allowed || !!confirmation} title={guidance || state.reason || undefined} onClick={() => {
        opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
        if (action === 'cancel' || action === 'mark_no_show') setConfirmation(action); else void perform(action);
      }}>{actionLabels[action]}</button>{!state.allowed && state.reason && <small className={styles.actionReason}>{state.reason}</small>}</div>;
    })}</div>
    {confirmation && <section className={styles.confirmation} aria-label="Подтверждение ручного изменения визита"><h3 ref={heading} tabIndex={-1}>{confirmation === 'cancel' ? 'Отменить визит?' : 'Отметить неявку?'}</h3><strong>Связанные задачи останутся самостоятельными. Они не завершаются и не отменяются автоматически.</strong><p>{snapshot.tasks.filter(task => task.visitId === visit.id && task.status !== 'completed').length} открытых задач связано с этим визитом.</p><div><button type="button" className={styles.smallButton} disabled={locked} onClick={close}>Оставить визит</button><button type="button" className={styles.primaryButton} disabled={!enabled || !queueActionState(snapshot, visit, confirmation).allowed} onClick={() => void perform(confirmation)}>Подтвердить {confirmation === 'cancel' ? 'отмену' : 'неявку'}</button></div></section>}
    {sending && <p className={styles.note} role="status">Сохраняем изменение этапа…</p>}{error && <p className={styles.error} role="alert">{error}</p>}
  </div>;
}

/** Shared booking/transfer form: nothing is persisted until root confirms true. */
export function CrmBookingForm({ snapshot, onCommand, canWrite, blocked, initialPatientId }: CrmBookingFormProps) {
  return <BookingFields snapshot={snapshot} onCommand={onCommand} canWrite={canWrite} blocked={blocked} initialPatientId={initialPatientId} />;
}

function BookingFields({ snapshot, onCommand, canWrite, blocked, initialPatientId, visit, onSaved }: CrmBookingFormProps & { visit?: CrmVisit; onSaved?: () => void }) {
  const calendar = useMemo(() => clinicCalendar(snapshot), [snapshot]);
  const index = useMemo(() => crmOperationsIndex(snapshot), [snapshot]);
  const ownRoom = snapshot.rooms.find(room => room.id === snapshot.staff.find(person => person.id === snapshot.capabilities.staffId)?.roomId);
  const availableServices = snapshot.services.filter(service => !snapshot.capabilities.staffId || service.roomKind === ownRoom?.kind);
  const [draft, setDraft] = useState<BookingDraft>(() => ({ patientId: visit?.patientId ?? (initialPatientId && index.patients.has(initialPatientId) ? initialPatientId : ''),
    roomId: visit?.roomId ?? snapshot.staff.find(person => person.id === snapshot.capabilities.staffId)?.roomId ?? '', staffId: visit?.staffId ?? snapshot.capabilities.staffId ?? '', serviceId: visit?.serviceId ?? '',
    day: calendar ? clinicDay(snapshot.generatedAt, calendar.timeZone) ?? '' : '', time: '' }));
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);
  const [availableOnly, setAvailableOnly] = useState(true);
  const [slotPage, setSlotPage] = useState(0);
  const lock = useRef(false);
  const locked = blocked || sending;
  const enabled = canWrite && snapshot.capabilities.manage && !locked;
  const service = index.services.get(draft.serviceId);
  const scoped = !!draft.patientId && !!draft.staffId && !!draft.roomId && !!draft.serviceId;
  const scheduledAt = calendar ? clinicDateTimeToIso(draft.day, draft.time, calendar.timeZone) : null;
  const availability = useMemo(() => scoped && scheduledAt ? bookingAvailability(snapshot,
    { patientId: draft.patientId, staffId: draft.staffId, roomId: draft.roomId, serviceId: draft.serviceId, scheduledAt }, visit?.id) : null,
    [snapshot, scoped, scheduledAt, draft.patientId, draft.staffId, draft.roomId, draft.serviceId, visit?.id]);
  const slots = useMemo(() => calendar && scoped && draft.day ? availableSlots(snapshot, {
    patientId: draft.patientId, staffId: draft.staffId, roomId: draft.roomId, serviceId: draft.serviceId, day: draft.day,
  }, visit?.id) : [], [snapshot, calendar, scoped, draft.day, draft.patientId, draft.staffId, draft.roomId, draft.serviceId, visit?.id]);
  const filteredSlots = availableOnly ? slots.filter(slot => slot.available) : slots;
  const page = Math.min(slotPage, Math.max(0, Math.ceil(filteredSlots.length / 48) - 1));
  const guidance = writeGuidance(snapshot, canWrite, locked);
  const duration = visit ? visitDuration(snapshot, visit) : service?.durationMinutes ?? null;

  function change(values: Partial<BookingDraft>) { setDraft(current => ({ ...current, ...values })); setSlotPage(0); setError(''); setSaved(false); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!enabled || lock.current || !scheduledAt || !availability?.available || !calendar || (visit && !canRescheduleCrmVisit(visit.status))) return;
    const value = visit ? { type: 'visit.reschedule', visitId: visit.id, expectedVersion: visit.version, scheduledAt,
      testDataAcknowledged: true, idempotencyKey: crypto.randomUUID() } : { type: 'visit.create', patientId: draft.patientId,
      staffId: draft.staffId, roomId: draft.roomId, serviceId: draft.serviceId, scheduledAt, testDataAcknowledged: true, idempotencyKey: crypto.randomUUID() };
    const command = crmCommandSchema.safeParse(value);
    if (!command.success) { setError('Проверьте выбранные связи и дату записи.'); return; }
    lock.current = true; setSending(true); setError(''); setSaved(false);
    try {
      if (await onCommand(command.data)) {
        setSaved(true); setDraft(current => ({ ...current, time: '' })); onSaved?.();
      }
    } catch { setError('Ответ о сохранении не получен. Поля сохранены; проверьте сообщение рабочего пространства.'); }
    finally { lock.current = false; setSending(false); }
  }

  return <form className={styles.bookingForm} onSubmit={submit} aria-label={visit ? 'Перенос визита по календарю клиники' : 'Новый визит по календарю клиники'}>
    <div className={styles.formLead}><CalendarClock size={20} aria-hidden="true" /><div><h3>{visit ? 'Перенос записи' : 'Запись на визит'}</h3><p>{visit ? 'Пациент, услуга, сотрудник и кабинет сохраняются. Сроки связанных задач не меняются автоматически.' : 'Выберите пациента, услугу, кабинет и сотрудника — затем доступное время.'}</p></div></div>
    {calendar ? <p className={styles.calendarPolicy}><Clock3 size={14} aria-hidden="true" />Время клиники · {calendar.timeZone} · {calendar.weekdays.map(day => weekdayLabels[day - 1]).join(', ')} · {minuteLabel(calendar.openMinute)}–{minuteLabel(calendar.closeMinute)}</p> : <p className={styles.warning} role="status">Календарная политика не загружена. Слоты и запись пока недоступны; расписание не подставляется.</p>}
    {guidance && <p className={styles.guidance}>{guidance}</p>}
    {initialPatientId && !index.patients.has(initialPatientId) && <p className={styles.warning}>Указанный пациент отсутствует в загруженной CRM. Выберите доступную карту.</p>}
    <fieldset disabled={locked || !calendar} className={styles.bookingFields}>
      <label className={styles.fullField}><span>Пациент</span><select value={draft.patientId} required disabled={!!visit} onChange={event => change({ patientId: event.target.value, time: '' })}><option value="">Выберите пациента и номер карты</option>{snapshot.patients.map(patient => <option key={patient.id} value={patient.id}>{patient.name} · {patient.mrn}</option>)}</select></label>
      <label className={styles.fullField}><span>Услуга · {visit ? 'длительность визита' : 'длительность из каталога'}</span><select value={draft.serviceId} required disabled={!!visit} onChange={event => change({ serviceId: event.target.value, roomId: ownRoom?.id ?? '', staffId: snapshot.capabilities.staffId ?? '', time: '' })}><option value="">Выберите услугу</option>{(visit ? snapshot.services : availableServices).map(service => <option key={service.id} value={service.id}>{service.name} · {visit && service.id === visit.serviceId ? duration ?? 'не задана' : service.durationMinutes} мин</option>)}</select></label>
      <label><span>Подходящий кабинет</span><select value={draft.roomId} required disabled={!!visit || !draft.serviceId} onChange={event => change({ roomId: event.target.value, staffId: snapshot.capabilities.staffId ?? '', time: '' })}><option value="">Выберите кабинет</option>{snapshot.rooms.filter(room => (!service || room.kind === service.roomKind) && (!snapshot.capabilities.staffId || snapshot.staff.some(person => person.id === snapshot.capabilities.staffId && person.roomId === room.id))).map(room => <option key={room.id} value={room.id}>{room.name}</option>)}</select></label>
      <label><span>Врач приёма</span><select value={draft.staffId} required disabled={!!visit || !draft.roomId || !!snapshot.capabilities.staffId} onChange={event => change({ staffId: event.target.value, time: '' })}><option value="">Выберите сотрудника</option>{snapshot.staff.filter(person => person.roomId === draft.roomId && (!snapshot.capabilities.staffId || person.id === snapshot.capabilities.staffId)).map(person => <option key={person.id} value={person.id}>{person.name} · {crmStaffRoleLabels[person.role]}</option>)}</select></label>
      <label><span>Дата в часовом поясе клиники</span><input type="date" required value={draft.day} onChange={event => change({ day: event.target.value, time: '' })} /></label>
      <label><span>Время начала · {calendar?.timeZone ?? 'не загружено'}</span><input type="time" required value={draft.time} step={300} onChange={event => change({ time: event.target.value })} /></label>
    </fieldset>
    {duration !== null && <p className={styles.durationNote}>Интервал записи: {duration} минут{visit ? ' — длительность сохранённого визита' : ' — сервер закрепит длительность при сохранении'}.</p>}
    {calendar && scoped && draft.day && <section className={styles.slots} aria-label="Подсказки времени по загруженному состоянию"><header><h4>Время по текущему состоянию</h4><label><input type="checkbox" checked={availableOnly} disabled={locked} onChange={event => { setAvailableOnly(event.target.checked); setSlotPage(0); }} /><span>Только доступное</span></label></header><p className={styles.note}>{slots.filter(slot => slot.available).length} доступных интервалов из {slots.length} рассчитанных. Подсказки могут устареть; окончательная проверка — на сервере.</p>
      {filteredSlots.length === 0 ? <p className={styles.empty}>Для выбранных связей и даты подходящего времени нет. Измените дату или включите просмотр занятых интервалов.</p> : <div className={styles.slotGrid}>{filteredSlots.slice(page * 48, page * 48 + 48).map(slot => <div key={slot.scheduledAt}><button type="button" disabled={locked || !slot.available} aria-pressed={scheduledAt === slot.scheduledAt} onClick={() => change({ time: slot.timeLabel })} title={slot.reasons.join(' · ') || 'Выбрать время в CRM'}>{slot.timeLabel}</button>{!slot.available && <small>{slot.reasons[0] ?? 'Недоступно по снимку'}</small>}</div>)}</div>}
      {filteredSlots.length > 48 && <nav className={styles.pagination} aria-label="Страницы подсказок времени"><span>{page * 48 + 1}–{Math.min(page * 48 + 48, filteredSlots.length)} из {filteredSlots.length}</span><button type="button" className={styles.smallButton} disabled={locked || page === 0} onClick={() => setSlotPage(page - 1)}>Назад</button><button type="button" className={styles.smallButton} disabled={locked || (page + 1) * 48 >= filteredSlots.length} onClick={() => setSlotPage(page + 1)}>Далее</button></nav>}
    </section>}
    {calendar && !scoped && <p className={styles.note}>Подсказки времени появятся после выбора всех четырёх связей: пациент, услуга, кабинет, сотрудник.</p>}
    {availability && <div className={availability.available ? styles.availableMessage : styles.warning} role="status">{availability.available ? <><Check size={14} aria-hidden="true" />Выбранное время доступно по загруженному состоянию. Сервер проверит его снова при сохранении.</> : <><Info size={14} aria-hidden="true" /><div><strong>Запись на это время недоступна</strong><ul>{availability.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul></div></>}</div>}
    {draft.day && draft.time && !scheduledAt && <p className={styles.warning}>Дата и время не образуют однозначный интервал в часовом поясе клиники. Выберите другое время.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}{sending && <p className={styles.note} role="status">Сохраняем запись…</p>}{saved && <p className={styles.availableMessage} role="status"><Check size={14} aria-hidden="true" />Сохранение подтверждено сервером.</p>}
    <button className={styles.primaryButton} type="submit" disabled={!enabled || !scheduledAt || !availability?.available || (!!visit && !canRescheduleCrmVisit(visit.status))}><Check size={16} aria-hidden="true" />{visit ? 'Сохранить перенос' : 'Сохранить визит'}</button>
    <p className={styles.boundary}>Сохранение записи не выполняет внешнюю запись, оплату или автоматическое подтверждение пациента.</p>
  </form>;
}

export function CrmScheduling({ snapshot, onSelect, onCommand, canWrite, blocked }: CrmSchedulingProps) {
  const calendar = useMemo(() => clinicCalendar(snapshot), [snapshot]);
  const index = useMemo(() => crmOperationsIndex(snapshot), [snapshot]);
  const [day, setDay] = useState(() => calendar ? clinicDay(snapshot.generatedAt, calendar.timeZone) ?? '' : '');
  const [search, setSearch] = useState('');
  const [staffId, setStaffId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [status, setStatus] = useState('all');
  const [tab, setTab] = useState<'calendar' | 'list'>('calendar');
  const [queueRoom, setQueueRoom] = useState('');
  const [queueStaff, setQueueStaff] = useState('');
  const [pages, setPages] = useState({ calendar: 0, queue: 0 });
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const opener = useRef<HTMLElement | null>(null);
  const rescheduleHeading = useRef<HTMLElement>(null);
  const locked = blocked;
  const enabled = canWrite && snapshot.capabilities.manage && !locked;
  const guidance = writeGuidance(snapshot, canWrite, locked);
  const selectedReschedule = rescheduleId ? index.visits.get(rescheduleId) : null;
  const orderedQueue = useMemo(() => queueVisits(snapshot), [snapshot]);
  const filtered = useMemo(() => snapshot.visits.filter(visit => {
    const patient = index.patients.get(visit.patientId);
    return (!calendar || !day || clinicDay(visit.scheduledAt, calendar.timeZone) === day) && (!staffId || visit.staffId === staffId) &&
      (!roomId || visit.roomId === roomId) && (!serviceId || visit.serviceId === serviceId) && (status === 'all' || visit.status === status) &&
      [patient?.name, patient?.mrn, index.staff.get(visit.staffId)?.name, index.rooms.get(visit.roomId)?.name, index.services.get(visit.serviceId)?.name].join(' ').toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU'));
  }).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)), [snapshot, calendar, day, staffId, roomId, serviceId, status, index, search]);
  const queue = useMemo(() => {
    const queuedIds = new Map(orderedQueue.map((visit, order) => [visit.id, order]));
    return snapshot.visits.filter(visit => queueStates.includes(visit.status) && (!queueRoom || visit.roomId === queueRoom) && (!queueStaff || visit.staffId === queueStaff))
      .sort((a, b) => queueStates.indexOf(a.status) - queueStates.indexOf(b.status) || (a.status === 'queued' ? (queuedIds.get(a.id) ?? 0) - (queuedIds.get(b.id) ?? 0) : a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)));
  }, [snapshot, orderedQueue, queueRoom, queueStaff]);
  const calendarPage = Math.min(pages.calendar, Math.max(0, Math.ceil(filtered.length / 100) - 1));
  const queuePage = Math.min(pages.queue, Math.max(0, Math.ceil(queue.length / 100) - 1));
  const calendarRows = filtered.slice(calendarPage * 100, calendarPage * 100 + 100);
  const queueRows = queue.slice(queuePage * 100, queuePage * 100 + 100);
  const conflicts = useMemo(() => new Map([...calendarRows, ...queueRows].map(visit => [visit.id, visitConflicts(snapshot, visit)])), [snapshot, calendarRows, queueRows]);
  const terminalCount = filtered.filter(visit => ['cancelled', 'no_show', 'completed'].includes(visit.status)).length;

  useEffect(() => { if (rescheduleId) rescheduleHeading.current?.focus({ preventScroll: true }); }, [rescheduleId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !locked && rescheduleId) {
        setRescheduleId(null);
        if (opener.current?.isConnected) opener.current.focus({ preventScroll: true });
      }
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [locked, rescheduleId]);
  function rememberOpener() { opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; }
  function restoreOpener() { requestAnimationFrame(() => { if (opener.current?.isConnected) opener.current.focus({ preventScroll: true }); }); }

  function select(visit: CrmVisit) { if (!locked) onSelect({ kind: 'visit', id: visit.id }); }
  function actionButtons(visit: CrmVisit) {
    return <><CrmVisitActions snapshot={snapshot} visit={visit} onCommand={onCommand} canWrite={canWrite} blocked={locked || !!rescheduleId} />
      {canRescheduleCrmVisit(visit.status) && <button className={styles.smallButton} type="button" disabled={!enabled || !calendar || !!rescheduleId} onClick={() => { rememberOpener(); setRescheduleId(visit.id); }}><CalendarClock size={14} aria-hidden="true" />Перенести</button>}</>;
  }
  function record(visit: CrmVisit, inQueue = false) {
    const patient = index.patients.get(visit.patientId);
    const duration = visitDuration(snapshot, visit);
    const conflict = conflicts.get(visit.id);
    const age = inQueue && visit.status === 'queued' ? waitingAge(snapshot, visit) : null;
    const roomOrder = visit.status === 'queued' ? orderedQueue.filter(row => row.roomId === visit.roomId).findIndex(row => row.id === visit.id) + 1 : null;
    const staffOrder = visit.status === 'queued' ? orderedQueue.filter(row => row.staffId === visit.staffId).findIndex(row => row.id === visit.id) + 1 : null;
    return <article key={visit.id} className={styles.record} data-status={visit.status}>
      <div className={styles.recordMain}><button className={styles.recordLink} type="button" disabled={locked} onClick={() => select(visit)}><span className={styles.avatar}>{initials(patient?.name ?? '')}</span><span><strong>{patient?.name}</strong><small>{patient?.mrn} · {index.services.get(visit.serviceId)?.name}</small></span><ArrowRight size={14} aria-hidden="true" /></button><span className={styles.status} data-status={visit.status}>{statusLabels[visit.status]}</span></div>
      <div className={styles.recordMeta}><span><Clock3 size={13} aria-hidden="true" />{formatVisitDate(visit.scheduledAt, calendar?.timeZone)} · {duration === null ? 'Длительность не сохранена' : `${duration} мин`}</span><span>{index.rooms.get(visit.roomId)?.name} · {index.staff.get(visit.staffId)?.name}</span></div>
      {visitDurationSource(snapshot, visit) === 'legacy_catalogue' && <p className={styles.legacy}>Для старой записи длительность взята из каталога; исторический интервал не был закреплён.</p>}
      {visit.bookingSource === 'catalogue_backfill' && <p className={styles.legacy}>Старая запись: длительность закреплена при переносе каталога. Существующие записи сохранены независимо от новой календарной политики.</p>}
      {conflict && conflict.conflictVisitIds.length > 0 && <p className={styles.conflict}><Info size={13} aria-hidden="true" />Пересечение по загруженному состоянию: {conflict.reasons.join(' · ')}. Запись сохранена и не скрыта.</p>}
      {inQueue && visit.status === 'queued' && <div className={styles.queueOrder}><span>По кабинету: {roomOrder}. По сотруднику: {staffOrder}.{queueOrderSource(visit) === 'legacy_queue_time' ? ' Предварительный порядок старой записи; последовательность не подтверждена.' : ''}</span><span>{age === null ? 'Время постановки не подтверждено' : `Ожидание на момент снимка: ${Math.floor(age)} мин`}{queueTimeSource(visit) === 'legacy_updatedAt' ? ' · для старой записи по времени изменения' : ''}</span></div>}
      {inQueue && visit.status === 'called' && <p className={styles.calledNote}>Приглашение сохранено; кабинет, сотрудник и пациент заняты до начала приёма или явного возврата в очередь.</p>}
      {actionButtons(visit)}
    </article>;
  }

  function pager(kind: 'calendar' | 'queue', total: number, page: number) {
    return total > 100 ? <nav className={styles.pagination} aria-label={kind === 'queue' ? 'Страницы очереди' : 'Страницы календарных записей'}><span>{page * 100 + 1}–{Math.min(page * 100 + 100, total)} из {total} записей</span><button className={styles.smallButton} type="button" disabled={page === 0} onClick={() => setPages(current => ({ ...current, [kind]: page - 1 }))}>Предыдущие</button><button className={styles.smallButton} type="button" disabled={(page + 1) * 100 >= total} onClick={() => setPages(current => ({ ...current, [kind]: page + 1 }))}>Следующие</button></nav> : null;
  }

  return <section className={styles.scheduling} aria-labelledby="crm-scheduling-title">
    <header className={styles.header}><div><h2 id="crm-scheduling-title">Записи и очередь</h2><p>Связанные интервалы приёма и ручное движение пациента по этапам CRM.</p></div>{calendar && <span className={styles.policyBadge}><Clock3 size={14} aria-hidden="true" />Время клиники · {calendar.timeZone}</span>}</header>
    {guidance && <p className={styles.guidance}><ShieldCheck size={14} aria-hidden="true" />{guidance}</p>}
    {!calendar && <p className={styles.warning}>Календарная политика не загружена. Показаны сохранённые записи с исходным временем; доступные интервалы не рассчитываются.</p>}
    {selectedReschedule && <section ref={rescheduleHeading} tabIndex={-1} className={styles.reschedulePanel} aria-label="Явный перенос визита"><header><strong>{index.patients.get(selectedReschedule.patientId)?.name}</strong><button className={styles.iconButton} type="button" disabled={locked} aria-label="Закрыть перенос визита" onClick={() => { setRescheduleId(null); restoreOpener(); }}><X size={17} /></button></header><BookingFields key={selectedReschedule.id} snapshot={snapshot} onCommand={onCommand} canWrite={canWrite} blocked={locked || !canRescheduleCrmVisit(selectedReschedule.status)} visit={selectedReschedule} onSaved={() => { setRescheduleId(null); restoreOpener(); }} /></section>}
    <div className={styles.filters}><label className={styles.search}><Search size={16} aria-hidden="true" /><span className={styles.srOnly}>Поиск записей по пациенту и связям</span><input value={search} maxLength={160} placeholder="Имя, карта, сотрудник, услуга…" onChange={event => { setSearch(event.target.value); setPages(current => ({ ...current, calendar: 0 })); }} /></label><label><span>Дата клиники</span><input type="date" value={day} disabled={!calendar} onChange={event => { setDay(event.target.value); setPages(current => ({ ...current, calendar: 0 })); }} /></label><label><span>Сотрудник</span><select value={staffId} onChange={event => { setStaffId(event.target.value); setPages(current => ({ ...current, calendar: 0 })); }}><option value="">Все сотрудники</option>{snapshot.staff.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label><label><span>Кабинет</span><select value={roomId} onChange={event => { setRoomId(event.target.value); setPages(current => ({ ...current, calendar: 0 })); }}><option value="">Все кабинеты</option>{snapshot.rooms.map(room => <option value={room.id} key={room.id}>{room.name}</option>)}</select></label><label><span>Услуга</span><select value={serviceId} onChange={event => { setServiceId(event.target.value); setPages(current => ({ ...current, calendar: 0 })); }}><option value="">Все услуги</option>{snapshot.services.map(service => <option value={service.id} key={service.id}>{service.name}</option>)}</select></label><label><span>Этап</span><select value={status} onChange={event => { setStatus(event.target.value); setPages(current => ({ ...current, calendar: 0 })); }}><option value="all">Все этапы</option>{crmVisitStatuses.map(status => <option value={status} key={status}>{statusLabels[status]}</option>)}</select></label></div>
    <div className={styles.calendarToolbar}><p><b>{filtered.length}</b> записей по фильтру · {terminalCount} завершённых, отменённых или с неявкой</p><nav aria-label="Представление календаря"><button type="button" aria-pressed={tab === 'calendar'} onClick={() => setTab('calendar')}><CalendarDays size={15} aria-hidden="true" />Интервалы</button><button type="button" aria-pressed={tab === 'list'} onClick={() => setTab('list')}><List size={15} aria-hidden="true" />Список</button></nav></div>
    {tab === 'calendar' && calendar && day && <CalendarTimeline snapshot={snapshot} visits={calendarRows} day={day} onSelect={onSelect} blocked={locked} />}
    <section className={styles.calendarList} aria-label="Сохранённые записи выбранного календарного дня">{filtered.length === 0 ? <p className={styles.empty}>По этой дате и фильтрам записей нет. Можно выбрать другую дату или создать визит через кнопку над рабочим пространством.</p> : <div className={styles.recordGrid}>{calendarRows.map(visit => record(visit))}</div>}</section>
    {pager('calendar', filtered.length, calendarPage)}
    <p className={styles.note}>Все существующие записи остаются видимыми, включая пересечения и время вне новой политики. Длительность новых записей закреплена на сервере. Календарь показывает сохранённые интервалы записей.</p>
    <section className={styles.queueSection} aria-labelledby="crm-queue-title"><header className={styles.header}><div><h2 id="crm-queue-title"><Users size={20} aria-hidden="true" />Текущая очередь</h2><p>Все сохранённые активные визиты, включая записи прошлых дат. Дата календаря на эту очередь не влияет.</p></div><span className={styles.policyBadge}>{queue.length} записей</span></header><div className={styles.queueFilters}><label><span>Кабинет очереди</span><select value={queueRoom} onChange={event => { setQueueRoom(event.target.value); setPages(current => ({ ...current, queue: 0 })); }}><option value="">Все кабинеты</option>{snapshot.rooms.map(room => <option value={room.id} key={room.id}>{room.name}</option>)}</select></label><label><span>Сотрудник очереди</span><select value={queueStaff} onChange={event => { setQueueStaff(event.target.value); setPages(current => ({ ...current, queue: 0 })); }}><option value="">Все сотрудники</option>{snapshot.staff.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label></div>
      <p className={styles.note}>Приглашение возможно только для первого визита одновременно по кабинету и сотруднику. Проверяется вся сохранённая очередь; приглашённый или обслуживаемый пациент занимает ресурсы. Ожидание рассчитано на {formatVisitDate(snapshot.generatedAt, calendar?.timeZone)} и не обновляется таймером.</p>
      {queue.length === 0 ? <p className={styles.empty}>В сохранённом состоянии нет прибывших, ожидающих, приглашённых или обслуживаемых визитов по этим условиям.</p> : queueStates.map(state => {
        const allRows = queue.filter(visit => visit.status === state); if (!allRows.length) return null;
        const rows = queueRows.filter(visit => visit.status === state);
        return <section className={styles.queueGroup} key={state} aria-label={statusLabels[state]}><h3><span className={styles.stageDot} data-status={state} />{statusLabels[state]} <b>{allRows.length}</b></h3>{rows.length ? <div className={styles.recordGrid}>{rows.map(visit => record(visit, true))}</div> : <p className={styles.note}>Записи этого этапа находятся на другой странице очереди.</p>}</section>;
      })}{pager('queue', queue.length, queuePage)}
    </section><p className={styles.boundary}>Очередь CRM. Приглашение меняет запись в CRM; это не звонок пациенту, физическое отслеживание или клиническая триажная оценка. При отмене и неявке связанные задачи остаются самостоятельными.</p>
  </section>;
}

function CalendarTimeline({ snapshot, visits, day, onSelect, blocked }: { snapshot: CrmSnapshot; visits: CrmVisit[]; day: string; onSelect: (selection: CrmSelection) => void; blocked: boolean }) {
  const calendar = clinicCalendar(snapshot);
  const index = useMemo(() => crmOperationsIndex(snapshot), [snapshot]);
  if (!calendar) return null;
  const range = calendar.closeMinute - calendar.openMinute;
  const hours = Array.from({ length: Math.ceil(range / 60) + 1 }, (_, number) => Math.min(calendar.closeMinute, calendar.openMinute + number * 60));
  const timed = visits.filter(visit => {
    const start = clinicMinute(visit.scheduledAt, calendar.timeZone); const duration = visitDuration(snapshot, visit);
    return clinicDay(visit.scheduledAt, calendar.timeZone) === day && start !== null && duration !== null && start >= calendar.openMinute && start + duration <= calendar.closeMinute;
  });
  const excluded = visits.length - timed.length;
  const rows = snapshot.rooms.filter(room => visits.some(visit => visit.roomId === room.id));
  return <section className={styles.timeline} aria-label="Условная шкала интервалов по кабинетам"><div className={styles.timelineScroll}><div className={styles.timelineInner}><div className={styles.timeHeader}><span>Кабинет</span><div>{hours.map((minute, index) => <time key={`${minute}-${index}`} style={{ left: `${(minute - calendar.openMinute) / range * 100}%` }}>{minuteLabel(minute)}</time>)}</div></div>{rows.map(room => {
    const roomVisits = timed.filter(visit => visit.roomId === room.id);
    const lanes: number[] = []; const positions = roomVisits.map(visit => {
      const start = clinicMinute(visit.scheduledAt, calendar.timeZone)!; const duration = visitDuration(snapshot, visit)!;
      let lane = lanes.findIndex(end => end <= start); if (lane < 0) lane = lanes.length;
      lanes[lane] = start + duration; return { visit, start, duration, lane };
    });
    return <div className={styles.timelineRow} key={room.id}><button type="button" className={styles.roomHeading} disabled={blocked} onClick={() => onSelect({ kind: 'room', id: room.id })}><DoorOpen size={15} aria-hidden="true" /><strong>{room.name}</strong><small>{crmRoomKindLabels[room.kind]}</small></button><div className={styles.track} style={{ height: Math.max(68, lanes.length * 54 + 14) }}>{hours.map((minute, index) => <i key={`${minute}-${index}`} style={{ left: `${(minute - calendar.openMinute) / range * 100}%` }} />)}{positions.map(({ visit, start, duration, lane }) => <button type="button" className={styles.interval} data-status={visit.status} key={visit.id} disabled={blocked} style={{ left: `${(start - calendar.openMinute) / range * 100}%`, width: `${duration / range * 100}%`, top: lane * 54 + 10 }} onClick={() => onSelect({ kind: 'visit', id: visit.id })} aria-label={`Открыть визит ${index.patients.get(visit.patientId)?.name}, ${minuteLabel(start)}, ${duration} минут, ${statusLabels[visit.status]}`} title={`${index.patients.get(visit.patientId)?.name} · ${minuteLabel(start)}–${minuteLabel(start + duration)} · ${index.staff.get(visit.staffId)?.name} · ${statusLabels[visit.status]}`}><strong>{index.patients.get(visit.patientId)?.name}</strong><small>{minuteLabel(start)} · {duration} мин</small></button>)}</div></div>;
  })}</div></div><p className={styles.note}>Ширина цветного интервала соответствует длительности. Все записи также доступны списком ниже.{excluded > 0 ? ` ${excluded} записей вне рабочего диапазона или без подтверждённой длительности показаны только в списке; они не скрыты.` : ''}</p></section>;
}
