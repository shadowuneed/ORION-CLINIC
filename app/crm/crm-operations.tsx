'use client';

import { useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { ArrowRight, CalendarDays, CalendarClock, Check, ClipboardList, Clock3, DoorOpen, History, Plus, Search, ShieldCheck, Stethoscope, Users, X } from 'lucide-react';
import { crmTaskStatuses, crmVisitStatuses, type CrmCommand, type CrmSnapshot, type CrmTask, type CrmTaskStatus, type CrmVisit } from '@/lib/crm/contracts';
import { allowedCrmTaskActions, canRescheduleCrmVisit } from '@/lib/crm/domain';
import { crmCalendarDay, crmDailyVisits, crmOperationsIndex, crmOperationTaskLabels, crmOperationVisitLabels, crmPatientRows,
  crmPriorities, crmResourceRows, crmRescheduleCommand, crmRoomKindLabels, crmSexLabels, crmStaffRoleLabels, crmTaskCreateCommand,
  crmTaskKindLabels, crmTaskRows } from '@/lib/crm/operations';
import type { CrmSelection } from './crm-scene';
import { CrmScheduling } from './crm-scheduling';
import { crmBirthDateLabel } from '@/lib/crm/patient-presentation';
import styles from './crm-operations.module.css';

export type CrmOperationsView = 'overview' | 'schedule' | 'tasks' | 'patients' | 'resources';
export type CrmOperationsProps = { snapshot: CrmSnapshot; view: CrmOperationsView; onSelect: (selection: CrmSelection) => void;
  onCommand: (command: CrmCommand) => Promise<boolean>; canWrite: boolean; blocked: boolean };
type TaskDraft = { visitId: string; ownerId: string; kind: string; title: string; priority: string; dueAt: string };
const emptyTask: TaskDraft = { visitId: '', ownerId: '', kind: '', title: '', priority: '', dueAt: '' };
const headings = { overview: ['Рабочий центр', 'Что требует внимания в сохранённых записях'], schedule: ['Записи и очередь', 'Визиты на выбранную дату и их текущие этапы'],
  tasks: ['Задачи команды', 'Подготовка, организация услуги и повторный контакт'], patients: ['Пациенты CRM', 'Карточки пациентов из базы CRM. Источник регистрации указан в записи.'],
  resources: ['Команда и кабинеты', 'Сотрудники, помещения и каталог услуг'] } as const;

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join(''); }
function formatDate(iso: string, timeZone: string, timeOnly = false) {
  return new Intl.DateTimeFormat('ru-RU', { timeZone, ...(timeOnly ? {} : { day: '2-digit', month: 'short' }), hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
}

export function CrmOperations({ snapshot, view, onSelect, onCommand, canWrite, blocked }: CrmOperationsProps) {
  // Retain the old component API, but never expose the pre-calendar scheduling
  // path. Every scheduling entry uses the same guarded calendar/queue workflow.
  return view === 'schedule' ? <CrmScheduling snapshot={snapshot} onSelect={onSelect} onCommand={onCommand} canWrite={canWrite} blocked={blocked} />
    : <CrmOperationPanels snapshot={snapshot} view={view} onSelect={onSelect} onCommand={onCommand} canWrite={canWrite} blocked={blocked} />;
}

function CrmOperationPanels({ snapshot, view, onSelect, onCommand, canWrite, blocked }: CrmOperationsProps) {
  const [timeZone] = useState(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [day, setDay] = useState(() => crmCalendarDay(snapshot.generatedAt, timeZone));
  const [search, setSearch] = useState('');
  const [visitStatus, setVisitStatus] = useState('all');
  const [taskStatus, setTaskStatus] = useState<CrmTaskStatus | 'all'>('all');
  const [ownerId, setOwnerId] = useState('');
  const [sex, setSex] = useState('all');
  const [resourceTab, setResourceTab] = useState<'rooms' | 'staff' | 'services'>('rooms');
  const [form, setForm] = useState<'task' | null>(null);
  const [taskDraft, setTaskDraft] = useState<TaskDraft>(() => ({ ...emptyTask, ownerId: snapshot.capabilities.staffId ?? '', priority: 'routine' }));
  const [rescheduleId, setRescheduleId] = useState<string | null>(null);
  const [newTime, setNewTime] = useState('');
  const [localError, setLocalError] = useState('');
  const [sending, setSending] = useState(false);
  const [pages, setPages] = useState<Record<string, number>>({});
  const commandLock = useRef(false);
  const formHeading = useRef<HTMLHeadingElement>(null);
  const taskOpener = useRef<HTMLButtonElement>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const index = useMemo(() => crmOperationsIndex(snapshot), [snapshot]);
  const priorities = useMemo(() => crmPriorities(snapshot), [snapshot]);
  const daily = useMemo(() => crmDailyVisits(snapshot, day, timeZone, search, visitStatus, index), [snapshot, day, timeZone, search, visitStatus, index]);
  const tasks = useMemo(() => crmTaskRows(snapshot, search, taskStatus, ownerId, index), [snapshot, search, taskStatus, ownerId, index]);
  const patients = useMemo(() => crmPatientRows(snapshot, search, sex, index), [snapshot, search, sex, index]);
  const resources = useMemo(() => crmResourceRows(snapshot, search, index), [snapshot, search, index]);
  const locked = blocked || sending;
  const writeEnabled = canWrite && snapshot.capabilities.manage && !locked;
  const rescheduleVisit = rescheduleId ? index.visits.get(rescheduleId) : null;
  const taskVisit = taskDraft.visitId ? index.visits.get(taskDraft.visitId) : null;
  const priorityTasks = useMemo(() => {
    const ids = new Set([...priorities.overdue, ...priorities.urgent, ...priorities.escalated].map(task => task.id));
    return crmTaskRows(snapshot, '', 'all', '', index).filter(task => ids.has(task.id)).slice(0, 8);
  }, [snapshot, priorities, index]);
  const pageKey = view === 'resources' ? `resources-${resourceTab}` : view;
  const total = view === 'schedule' ? daily.length : view === 'tasks' ? tasks.length : view === 'patients' ? patients.length : view === 'resources' ? resources[resourceTab].length : 0;
  const page = Math.min(pages[pageKey] ?? 0, Math.max(0, Math.ceil(total / 100) - 1));
  const pageStart = page * 100;
  const pageTasks = tasks.slice(pageStart, pageStart + 100);
  function resetPage() { setPages({}); }
  const pagination = total > 100 ? <nav className={styles.pagination} aria-label="Страницы загруженных записей"><span>{pageStart + 1}–{Math.min(pageStart + 100, total)} из {total} найденных записей</span><button type="button" className={styles.smallButton} disabled={page === 0} onClick={() => setPages(current => ({ ...current, [pageKey]: page - 1 }))}>Предыдущие</button><button type="button" className={styles.smallButton} disabled={pageStart + 100 >= total} onClick={() => setPages(current => ({ ...current, [pageKey]: page + 1 }))}>Следующие</button></nav> : null;

  useEffect(() => { if (form || rescheduleId) formHeading.current?.focus({ preventScroll: true }); }, [form, rescheduleId]);
  useEffect(() => {
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || locked || (!form && !rescheduleId)) return;
      setForm(null); setRescheduleId(null); setLocalError('');
      if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
    };
    window.addEventListener('keydown', escape); return () => window.removeEventListener('keydown', escape);
  }, [locked, form, rescheduleId]);

  function select(selection: CrmSelection) { if (!locked && !form && !rescheduleId) onSelect(selection); }
  function closeForm() {
    if (locked) return;
    setForm(null); setRescheduleId(null); setLocalError('');
    if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
  }
  async function submitCommand(command: CrmCommand, closeOnSuccess = false) {
    if (!writeEnabled || commandLock.current) return;
    commandLock.current = true; setSending(true); setLocalError('');
    try {
      const saved = await onCommand(command);
      if (saved && closeOnSuccess) {
        setForm(null); setRescheduleId(null); setTaskDraft({ ...emptyTask, ownerId: snapshot.capabilities.staffId ?? '', priority: 'routine' }); setNewTime('');
        if (returnFocus.current?.isConnected) returnFocus.current.focus({ preventScroll: true });
      }
    } catch { setLocalError('Ответ на сохранение не получен. Проверьте сообщение в рабочем пространстве; данные формы сохранены.'); }
    finally { commandLock.current = false; setSending(false); }
  }
  function submitTask(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writeEnabled) return;
    if (!taskVisit || taskVisit.status === 'cancelled' || (['completed', 'no_show'].includes(taskVisit.status) && taskDraft.kind !== 'follow_up')) {
      setLocalError('После завершения или неявки доступен только повторный контакт; для отменённого визита задача не создаётся.'); return;
    }
    const command = crmTaskCreateCommand(taskDraft, crypto.randomUUID());
    if (!command) { setLocalError('Заполните все поля. Название — до 240 символов, дата и время должны быть корректными.'); return; }
    void submitCommand(command, true);
  }
  function submitReschedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!writeEnabled || !rescheduleVisit) return;
    const command = crmRescheduleCommand(rescheduleVisit, newTime, crypto.randomUUID());
    if (!command) { setLocalError('Перенести можно только запланированный визит. Выберите корректную дату и время.'); return; }
    void submitCommand(command, true);
  }
  function beginReschedule(visit: CrmVisit) {
    if (!writeEnabled || !canRescheduleCrmVisit(visit.status)) return;
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setRescheduleId(visit.id); setForm(null); setNewTime(''); setLocalError('');
  }
  const disableSelect = locked || !!form || !!rescheduleId;
  const guidance = !snapshot.capabilities.manage ? 'Ваш доступ к этой CRM позволяет только просмотр.'
    : locked ? 'Дождитесь завершения операции или разрешите неопределённый результат в сообщении выше.'
    : !canWrite ? 'Для изменений подтвердите работу с учебной БД над разделами рабочего пространства. При ошибке загрузите актуальное состояние.' : '';

  function visitRow(visit: CrmVisit, reschedule = false) {
    const patient = index.patients.get(visit.patientId);
    return <div className={styles.visitRow} key={visit.id}>
      <time className={styles.visitTime} dateTime={visit.scheduledAt}>{formatDate(visit.scheduledAt, timeZone, view === 'schedule' && !!day)}</time>
      <button type="button" className={styles.visitLink} disabled={disableSelect} onClick={() => select({ kind: 'visit', id: visit.id })} aria-label={`Открыть визит: ${patient?.name}, ${formatDate(visit.scheduledAt, timeZone)}`}>
        <span className={styles.avatar}>{initials(patient?.name ?? '')}</span><span><strong>{patient?.name}</strong><small>{index.services.get(visit.serviceId)?.name} · {patient?.mrn}</small></span>
      </button><span className={styles.visitContext}>{index.rooms.get(visit.roomId)?.name}<small>{index.staff.get(visit.staffId)?.name}</small></span>
      <span className={styles.status} data-status={visit.status}>{crmOperationVisitLabels[visit.status]}</span>
      {reschedule && <button className={styles.smallButton} type="button" disabled={!writeEnabled || !canRescheduleCrmVisit(visit.status) || !!rescheduleId} onClick={() => beginReschedule(visit)} title={canRescheduleCrmVisit(visit.status) ? guidance || 'Изменить дату и время визита' : 'Перенос доступен только до прибытия'}><CalendarClock size={14} aria-hidden="true" />Перенести</button>}
    </div>;
  }

  function taskCard(task: CrmTask) {
    const overdue = task.status !== 'completed' && task.dueAt < snapshot.generatedAt;
    return <article className={styles.taskCard} key={task.id}>
      <div className={styles.taskMeta}><span>{crmTaskKindLabels[task.kind]}</span><span className={styles.priority} data-urgent={task.priority === 'urgent'}>{task.priority === 'urgent' ? 'Срочная' : 'Обычная'}</span></div>
      <h3>{task.title}</h3><button type="button" className={styles.textLink} disabled={disableSelect} onClick={() => select({ kind: 'visit', id: task.visitId })}>{index.patients.get(task.patientId)?.name}<ArrowRight size={13} aria-hidden="true" /></button>
      <p className={styles.taskOwner}>{index.staff.get(task.ownerId)?.name}</p><p className={styles.taskDeadline} data-overdue={overdue}><Clock3 size={13} aria-hidden="true" />{overdue ? 'Срок прошёл: ' : 'До '}{formatDate(task.dueAt, timeZone)}</p>
      <div className={styles.taskActions}>{allowedCrmTaskActions(task.status).map(action => <button type="button" className={styles.smallButton} key={action} disabled={!writeEnabled} title={guidance || undefined}
        onClick={() => void submitCommand({ type: 'task.transition', taskId: task.id, expectedVersion: task.version, action, testDataAcknowledged: true, idempotencyKey: crypto.randomUUID() })}>
        {action === 'start' ? task.status === 'escalated' ? 'Вернуть в работу' : 'Взять в работу' : action === 'complete' ? 'Завершить' : 'Передать на разбор'}
      </button>)}</div>
    </article>;
  }

  return <section className={styles.operations} aria-labelledby="crm-operations-title">
    <header className={styles.header}><div><h2 id="crm-operations-title">{headings[view][0]}</h2><p>{headings[view][1]}</p></div><span className={styles.zone}><Clock3 size={14} aria-hidden="true" />Время устройства · {timeZone}</span>{view === 'tasks' && <button ref={taskOpener} type="button" className={styles.primaryButton} disabled={!writeEnabled || !!form || !!rescheduleId} title={guidance || undefined} onClick={() => {
      returnFocus.current = taskOpener.current; setForm('task'); setLocalError('');
    }}><Plus size={16} aria-hidden="true" />Создать задачу</button>}</header>
    {guidance && <p className={styles.writeGuidance} id="crm-operations-write-guidance"><ShieldCheck size={15} aria-hidden="true" />{guidance}</p>}
    {localError && <p className={styles.formError} role="alert">{localError}</p>}
    {sending && <p role="status" className={styles.note}>Сохраняем изменение CRM…</p>}

    {form === 'task' && <form className={styles.form} aria-labelledby="crm-task-create-title" onSubmit={submitTask}>
      <header><div><h3 id="crm-task-create-title" tabIndex={-1} ref={formHeading}>Новая задача по визиту</h3><p>Задача сохраняется в CRM и связывается с существующим визитом.</p></div><button type="button" className={styles.iconButton} disabled={locked} aria-label="Закрыть создание задачи" onClick={closeForm}><X size={17} /></button></header>
      <fieldset disabled={!writeEnabled}><label className={styles.wideField}><span>Визит</span><select required value={taskDraft.visitId} onChange={event => setTaskDraft(current => ({ ...current, visitId: event.target.value, kind: '' }))}><option value="">Выберите визит и пациента</option>{snapshot.visits.filter(visit => visit.status !== 'cancelled').map(visit => <option value={visit.id} key={visit.id}>{index.patients.get(visit.patientId)?.name} · {formatDate(visit.scheduledAt, timeZone)} · {crmOperationVisitLabels[visit.status]}</option>)}</select></label>
        <label><span>Ответственный сотрудник</span><select required value={taskDraft.ownerId} disabled={!!snapshot.capabilities.staffId} onChange={event => setTaskDraft(current => ({ ...current, ownerId: event.target.value }))}><option value="">Выберите сотрудника</option>{snapshot.staff.filter(person => !snapshot.capabilities.staffId || person.id === snapshot.capabilities.staffId).map(person => <option value={person.id} key={person.id}>{person.name} · {crmStaffRoleLabels[person.role]}</option>)}</select></label>
        <label><span>Тип задачи</span><select required value={taskDraft.kind} onChange={event => setTaskDraft(current => ({ ...current, kind: event.target.value }))}><option value="">Выберите тип</option>{Object.entries(crmTaskKindLabels).filter(([kind]) => !['completed', 'no_show'].includes(taskVisit?.status ?? '') || kind === 'follow_up').map(([kind, label]) => <option value={kind} key={kind}>{label}</option>)}</select></label>
        <label className={styles.wideField}><span>Что нужно сделать</span><input required minLength={1} maxLength={240} value={taskDraft.title} onChange={event => setTaskDraft(current => ({ ...current, title: event.target.value }))} placeholder="Например, подготовить кабинет к визиту" /></label>
        <label><span>Приоритет</span><select required value={taskDraft.priority} onChange={event => setTaskDraft(current => ({ ...current, priority: event.target.value }))}><option value="">Выберите приоритет</option><option value="routine">Обычная</option><option value="urgent">Срочная задача CRM</option></select></label>
        <label><span>Срок · {timeZone}</span><input type="datetime-local" required value={taskDraft.dueAt} onChange={event => setTaskDraft(current => ({ ...current, dueAt: event.target.value }))} /></label>
      </fieldset>{taskVisit?.status === 'completed' && <p className={styles.note}>Визит уже завершён: доступна только задача повторного контакта.</p>}{snapshot.visits.filter(visit => visit.status !== 'cancelled').length === 0 && <p className={styles.note}>Нет подходящих визитов. Создайте визит кнопкой «Новый визит» над рабочим пространством.</p>}
      <footer><p>Ручные действия CRM · без внешних звонков и назначений</p><button type="button" className={styles.smallButton} disabled={locked} onClick={closeForm}>Отмена</button><button type="submit" className={styles.primaryButton} disabled={!writeEnabled || Object.values(taskDraft).some(value => !value.trim())}><Check size={15} aria-hidden="true" />Сохранить задачу</button></footer>
    </form>}
    {rescheduleVisit && <form className={styles.form} aria-labelledby="crm-reschedule-title" onSubmit={submitReschedule}>
      <header><div><h3 id="crm-reschedule-title" tabIndex={-1} ref={formHeading}>Перенести визит</h3><p>{index.patients.get(rescheduleVisit.patientId)?.name} · сейчас {formatDate(rescheduleVisit.scheduledAt, timeZone)}</p></div><button type="button" className={styles.iconButton} aria-label="Закрыть перенос визита" disabled={locked} onClick={closeForm}><X size={17} /></button></header>
      <fieldset disabled={!writeEnabled || !canRescheduleCrmVisit(rescheduleVisit.status)}><label><span>Новые дата и время · {timeZone}</span><input required type="datetime-local" value={newTime} onChange={event => setNewTime(event.target.value)} /></label></fieldset>
      {!canRescheduleCrmVisit(rescheduleVisit.status) && <p className={styles.note}>Этап визита уже изменился. Перенос недоступен после прибытия.</p>}
      <footer><p>Кабинет, услуга и сотрудник сохраняются. Сервер проверит текущую версию, этап и корректность времени. Сроки существующих задач не меняются автоматически.</p><button type="button" className={styles.smallButton} disabled={locked} onClick={closeForm}>Отмена</button><button type="submit" className={styles.primaryButton} disabled={!writeEnabled || !newTime || !canRescheduleCrmVisit(rescheduleVisit.status)}>Сохранить перенос</button></footer>
    </form>}

    {view === 'overview' && <div className={styles.overview}>
      <div className={styles.priorityStrip} aria-label="Приоритеты загруженного состояния"><div><Clock3 size={17} aria-hidden="true" /><strong>{priorities.overdue.length}</strong><span>Задач с прошедшим сроком</span></div><div><ClipboardList size={17} aria-hidden="true" /><strong>{priorities.escalated.length}</strong><span>Задач на разборе</span></div><div><Users size={17} aria-hidden="true" /><strong>{priorities.queue.length}</strong><span>Визитов в очереди</span></div><div><Stethoscope size={17} aria-hidden="true" /><strong>{priorities.inService.length}</strong><span>Приёмов</span></div></div>
      <p className={styles.note}>Сроки сверены с состоянием на {formatDate(snapshot.generatedAt, timeZone)}. Это организационные задачи CRM, не оценка здоровья.</p>
      <section className={styles.panel}><header><h3><ClipboardList size={17} aria-hidden="true" />Требуют внимания</h3><span>Срочные, с прошедшим сроком или на разборе</span></header>{priorityTasks.length === 0 ? <p className={styles.empty}>Таких задач в загруженном состоянии нет. Обычные задачи доступны в разделе «Задачи».</p> : <div className={styles.priorityList}>{priorityTasks.map(task => <div key={task.id}><button type="button" className={styles.priorityLink} disabled={disableSelect} onClick={() => select({ kind: 'visit', id: task.visitId })}><span className={styles.priorityDot} data-urgent={task.priority === 'urgent'} /><span><strong>{task.title}</strong><small>{index.patients.get(task.patientId)?.name} · {index.staff.get(task.ownerId)?.name}</small></span><ArrowRight size={15} aria-hidden="true" /></button><span className={styles.status} data-status={task.status}>{crmOperationTaskLabels[task.status]}</span><time dateTime={task.dueAt}>{formatDate(task.dueAt, timeZone)}</time></div>)}</div>}</section>
      <section className={styles.panel}><header><h3><CalendarDays size={17} aria-hidden="true" />Ближайшие запланированные визиты</h3><span>После времени снимка</span></header>{priorities.upcoming.length === 0 ? <p className={styles.empty}>Предстоящих запланированных визитов в загруженных записях нет.</p> : priorities.upcoming.slice(0, 6).map(visit => visitRow(visit))}</section>
      <section className={styles.panel}><header><h3><Users size={17} aria-hidden="true" />Ожидают следующего этапа</h3><span>Прибывшие и очередь · первые 8 записей</span></header>{priorities.queue.length + priorities.arrived.length === 0 ? <p className={styles.empty}>В загруженных записях нет прибывших визитов или визитов в очереди.</p> : [...priorities.queue, ...priorities.arrived].sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 8).map(visit => visitRow(visit))}</section>
      <section className={styles.panel}><header><h3><History size={17} aria-hidden="true" />Последние изменения</h3><span>До 12 из последних 50 событий</span></header>{priorities.events.length === 0 ? <p className={styles.empty}>Сохранённая история пока пуста. События появляются после явных изменений.</p> : <ol className={styles.feed}>{priorities.events.slice(0, 12).map(event => {
        const task = index.tasks.get(event.resourceId); const visit = task ? index.visits.get(task.visitId) : index.visits.get(event.resourceId);
        const title = event.kind === 'visit.rescheduled' ? 'Перенесён визит' : event.kind === 'visit.created' ? 'Создан визит' : event.kind === 'task.created' ? 'Создана задача' : event.kind === 'task.transitioned' ? 'Изменён этап задачи' : 'Изменён этап визита';
        return <li key={event.id}><span className={styles.feedDot} /><div><strong>{title}</strong><p>{event.actorLabel} · {event.kind.startsWith('task') ? crmOperationTaskLabels[event.toStatus as CrmTaskStatus] : crmOperationVisitLabels[event.toStatus as CrmVisit['status']]}</p>{visit && <button className={styles.textLink} type="button" disabled={disableSelect} onClick={() => select({ kind: 'visit', id: visit.id })}>{index.patients.get(visit.patientId)?.name}<ArrowRight size={12} aria-hidden="true" /></button>}</div><time dateTime={event.createdAt}>{formatDate(event.createdAt, timeZone)}</time></li>;
      })}</ol>}</section>
    </div>}

    {view !== 'overview' && <div className={styles.filters}>
      <label className={styles.search}><Search size={16} aria-hidden="true" /><span className={styles.srOnly}>Поиск в разделе {headings[view][0]}</span><input value={search} onChange={event => { setSearch(event.target.value); resetPage(); }} maxLength={160} placeholder={view === 'patients' ? 'Имя или номер карты…' : view === 'tasks' ? 'Задача, пациент, ответственный…' : view === 'resources' ? 'Кабинет, сотрудник или услуга…' : 'Пациент, сотрудник, кабинет…'} /></label>
      {view === 'schedule' && <><label><span>Дата на устройстве</span><input type="date" value={day} onChange={event => { setDay(event.target.value); resetPage(); }} /></label><label><span>Этап</span><select value={visitStatus} onChange={event => { setVisitStatus(event.target.value); resetPage(); }}><option value="all">Все этапы</option>{crmVisitStatuses.map(status => <option value={status} key={status}>{crmOperationVisitLabels[status]}</option>)}</select></label><button type="button" className={styles.smallButton} onClick={() => { setDay(crmCalendarDay(snapshot.generatedAt, timeZone)); resetPage(); }}>Дата снимка</button></>}
      {view === 'tasks' && <><label><span>Этап задачи</span><select value={taskStatus} onChange={event => { setTaskStatus(event.target.value as CrmTaskStatus | 'all'); resetPage(); }}><option value="all">Все этапы</option>{crmTaskStatuses.map(status => <option value={status} key={status}>{crmOperationTaskLabels[status]}</option>)}</select></label><label><span>Ответственный</span><select value={ownerId} onChange={event => { setOwnerId(event.target.value); resetPage(); }}><option value="">Все сотрудники</option>{snapshot.staff.map(person => <option value={person.id} key={person.id}>{person.name}</option>)}</select></label></>}
      {view === 'patients' && <label><span>Пол в карте</span><select value={sex} onChange={event => { setSex(event.target.value); resetPage(); }}><option value="all">Все записи</option>{Object.entries(crmSexLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>}
      {search && <button type="button" className={styles.smallButton} onClick={() => { setSearch(''); resetPage(); }}>Сбросить поиск</button>}
    </div>}

    {view === 'schedule' && <><div className={styles.dailyStats}><span><b>{daily.length}</b> визитов по фильтру</span><span><b>{daily.filter(visit => visit.status === 'queued').length}</b> в очереди</span><span><b>{daily.filter(visit => visit.status === 'in_service').length}</b> на приёме</span></div><section className={styles.panel} aria-label="Расписание визитов"><header><h3>{day ? `Визиты на ${day.split('-').reverse().join('.')}` : 'Все загруженные даты'}</h3><span>По времени записи · {timeZone}</span></header>{daily.length === 0 ? <p className={styles.empty}>На выбранную дату и по этим фильтрам визитов нет. Измените дату или воспользуйтесь кнопкой «Новый визит» над рабочим пространством.</p> : daily.slice(pageStart, pageStart + 100).map(visit => visitRow(visit, true))}</section><p className={styles.note}>Это сохранённые записи, не внешний источник доступных слотов. Перенос выполняется вручную только до прибытия с проверкой версии и времени. Проверка пересечений будущих записей пока не подключена. Сроки существующих задач не меняются автоматически.</p></>}

    {view === 'tasks' && <><div className={styles.board} aria-label="Доска задач CRM">{crmTaskStatuses.filter(status => taskStatus === 'all' || taskStatus === status).map(status => {
      const rows = pageTasks.filter(task => task.status === status);
      const count = tasks.filter(task => task.status === status).length;
      return <section className={styles.boardColumn} key={status} aria-label={crmOperationTaskLabels[status]}><header><span className={styles.columnDot} data-status={status} /><h3>{crmOperationTaskLabels[status]}</h3><b>{count}</b></header>{rows.length === 0 ? <p className={styles.columnEmpty}>{count ? 'На этой странице задач этого этапа нет. Перейдите дальше или выберите этап в фильтре.' : 'Задач по этим условиям нет.'}</p> : rows.map(taskCard)}</section>;
    })}</div><p className={styles.note}>«Передать на разбор» меняет организационный этап задачи. Это не диагноз и не срочная медицинская классификация. Возврат с разбора выполняется вручную.</p></>}

    {view === 'patients' && <section className={styles.panel} aria-label="Каталог пациентов CRM"><header><h3><Users size={17} aria-hidden="true" />Найдено пациентов: {patients.length}</h3><span>Включая пациентов без визитов</span></header>{patients.length === 0 ? <p className={styles.empty}>{snapshot.patients.length === 0 ? 'В отдельной CRM ещё нет пациентов.' : 'Пациенты по этим условиям не найдены. Измените имя, номер карты или фильтр пола.'}</p> : <div className={styles.patientTable}>{patients.slice(pageStart, pageStart + 100).map(({ patient, visits, activeVisits, openTasks, latestVisit }) => <article className={styles.patientRow} key={patient.id}>
      <button type="button" className={styles.patientLink} disabled={disableSelect} onClick={() => select({ kind: 'patient', id: patient.id })}><span className={styles.avatar} data-sex={patient.sex}>{initials(patient.name)}</span><span><strong>{patient.name}</strong><small>{patient.mrn} · {crmSexLabels[patient.sex]}</small><small>Дата рождения: {crmBirthDateLabel(patient.birthDate)}</small><small>{patient.registrationSource === 'manual_training' ? 'Профиль введён вручную' : 'Источник регистрации не указан'}</small></span><ArrowRight size={14} aria-hidden="true" /></button>
      <div className={styles.patientNumbers}><span><b>{visits.length}</b> визитов</span><span><b>{activeVisits}</b> активных</span><span><b>{openTasks}</b> задач</span></div>
      {latestVisit ? <button type="button" className={styles.latestVisit} disabled={disableSelect} onClick={() => select({ kind: 'visit', id: latestVisit.id })}><span>Последняя запись</span><strong>{formatDate(latestVisit.scheduledAt, timeZone)}</strong><small>{crmOperationVisitLabels[latestVisit.status]}</small></button> : <p className={styles.noVisits}>Визитов пока нет. Карта доступна для просмотра.</p>}
    </article>)}</div>}</section>}

    {view === 'resources' && <><nav className={styles.resourceTabs} aria-label="Каталог ресурсов">{[
      { id: 'rooms' as const, label: 'Кабинеты', count: snapshot.rooms.length, icon: DoorOpen },
      { id: 'staff' as const, label: 'Сотрудники', count: snapshot.staff.length, icon: Users },
      { id: 'services' as const, label: 'Услуги', count: snapshot.services.length, icon: Stethoscope },
    ].map(tab => <button type="button" key={tab.id} aria-pressed={resourceTab === tab.id} onClick={() => setResourceTab(tab.id)}><tab.icon size={16} aria-hidden="true" />{tab.label}<b>{tab.count}</b></button>)}</nav>
      <section className={styles.panel} aria-label="Сохранённые ресурсы CRM">
        {resourceTab === 'rooms' && (resources.rooms.length === 0 ? <p className={styles.empty}>Кабинеты по этим условиям не найдены.</p> : resources.rooms.slice(pageStart, pageStart + 100).map(({ room, staff, active, inService }) => <div className={styles.resourceRow} key={room.id}><button type="button" className={styles.resourceLink} disabled={disableSelect} onClick={() => select({ kind: 'room', id: room.id })}><span className={styles.resourceIcon}><DoorOpen size={20} aria-hidden="true" /></span><span><strong>{room.name}</strong><small>{crmRoomKindLabels[room.kind]}</small></span><ArrowRight size={14} aria-hidden="true" /></button><span className={styles.resourceCopy}>{staff.map(person => person.name).join(' · ') || 'Сотрудники не назначены'}</span><div className={styles.resourceCounts}><span><b>{active}</b> активных визитов</span><span className={styles.status} data-status={inService > 0 ? 'in_service' : 'scheduled'}>{inService > 0 ? `${inService} на приёме` : 'Нет визита на приёме'}</span></div></div>))}
        {resourceTab === 'staff' && (resources.staff.length === 0 ? <p className={styles.empty}>Сотрудники по этим условиям не найдены.</p> : resources.staff.slice(pageStart, pageStart + 100).map(({ person, room, activeVisits, openTasks }) => <div className={styles.resourceRow} key={person.id}><button type="button" className={styles.resourceLink} disabled={disableSelect} onClick={() => select({ kind: 'staff', id: person.id })}><span className={styles.avatar}>{initials(person.name)}</span><span><strong>{person.name}</strong><small>{crmStaffRoleLabels[person.role]}</small></span><ArrowRight size={14} aria-hidden="true" /></button><button className={styles.textLink} type="button" disabled={disableSelect || !room} onClick={() => room && select({ kind: 'room', id: room.id })}>{room?.name ?? 'Кабинет не указан'}</button><div className={styles.resourceCounts}><span><b>{activeVisits}</b> активных визитов</span><span><b>{openTasks}</b> открытых задач</span></div></div>))}
        {resourceTab === 'services' && (resources.services.length === 0 ? <p className={styles.empty}>Услуги по этим условиям не найдены.</p> : resources.services.slice(pageStart, pageStart + 100).map(({ service, rooms, visits, active }) => <div className={styles.resourceRow} key={service.id}><button type="button" className={styles.resourceLink} disabled={disableSelect} onClick={() => select({ kind: 'service', id: service.id })}><span className={styles.resourceIcon}><Stethoscope size={20} aria-hidden="true" /></span><span><strong>{service.name}</strong><small>{service.durationMinutes} минут · {crmRoomKindLabels[service.roomKind]}</small></span><ArrowRight size={14} aria-hidden="true" /></button><span className={styles.resourceCopy}>{rooms.map(room => room.name).join(' · ') || 'Подходящих помещений нет'}</span><div className={styles.resourceCounts}><span><b>{visits}</b> записей всего</span><span><b>{active}</b> активных</span></div></div>))}
      </section><p className={styles.note}>Нагрузка рассчитана из загруженных визитов и задач. Свободный кабинет на этом экране не означает доступный слот в реальной клинике.</p>
    </>}
    {pagination}
    <p className={styles.boundary}><ShieldCheck size={14} aria-hidden="true" />Действия CRM не выполняют диагностику, звонки, направления или оплату.</p>
  </section>;
}
