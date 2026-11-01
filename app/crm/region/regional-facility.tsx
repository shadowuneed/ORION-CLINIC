'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowRight, Check, ClipboardList, Clock3, FileText, FlaskConical, History, Package, Pill, Search, Users, X } from 'lucide-react';
import type { RegionalCommand, RegionalFacilitySnapshot } from '@/lib/regional/contracts';
import type { CrmVisit } from '@/lib/crm/contracts';
import { allowedCrmVisitActions } from '@/lib/crm/domain';
import { queueActionState, queueVisits } from '@/lib/crm/scheduling';
import { CrmScene, type CrmSelection } from '../crm-scene';
import crmStyles from '../crm.module.css';
import { regionalDate } from './regional-workspace';
import styles from './regional-workspace.module.css';

type Tab = 'visits' | 'patients' | 'labs' | 'pharmacy' | 'procurement' | 'tasks' | 'history';
type CommandInput = RegionalCommand extends infer C ? C extends RegionalCommand ? Omit<C, 'facilityId' | 'idempotencyKey'> : never : never;
type ConfirmationState = { title: string; detail: string; command: CommandInput };
type VisitAction = Extract<RegionalCommand, { type: 'visit.transition' }>['action'];
type VisitChoice = { action: VisitAction; label: string; confirmation: string; explanation: string; disabledReason: string | null };
const visitChoices: Record<VisitAction, Omit<VisitChoice, 'action' | 'disabledReason'>> = {
  arrive: { label: 'Отметить прибытие', confirmation: 'Пациент прибыл в учреждение?', explanation: 'Прибытие сохранится в визите. Медицинская карта не изменится.' },
  queue: { label: 'Поставить в очередь', confirmation: 'Поставить пациента в очередь?', explanation: 'В базе будет закреплён порядок ожидания для кабинета и сотрудника.' },
  call: { label: 'Вызвать в кабинет', confirmation: 'Вызвать пациента в кабинет?', explanation: 'Визит получит статус «Вызван». Вызов пациенту сообщите лично: автоматическая отправка уведомлений не подключена.' },
  requeue: { label: 'Вернуть в очередь', confirmation: 'Вернуть пациента в очередь?', explanation: 'Резерв кабинета освободится, визит получит новое место в конце очереди.' },
  start: { label: 'Отметить начало приёма', confirmation: 'Пациент принят в кабинете?', explanation: 'Изменится этап визита. Запись разговора и медицинский протокол не запускаются автоматически.' },
  cancel: { label: 'Отменить визит', confirmation: 'Отменить этот визит?', explanation: 'Визит будет отменён. Медицинская карта и история пациента сохранятся.' },
};

/** The server remains authoritative; this is a read-only explanation of its saved queue state. */
export function regionalVisitActions(snapshot: RegionalFacilitySnapshot, visit: CrmVisit): VisitChoice[] {
  if (!snapshot.capabilities.readPatients) return [];
  // Regional commands have their own permissions; keep the embedded legacy CRM read-only.
  const queueSnapshot = { ...snapshot.crm, capabilities: { ...snapshot.crm.capabilities,
    manage: snapshot.capabilities.manage && snapshot.capabilities.manageVisits } };
  return allowedCrmVisitActions(visit.status).filter((action): action is VisitAction => Object.hasOwn(visitChoices, action)).map(action => {
    const state = queueActionState(queueSnapshot, visit, action);
    return { action, ...visitChoices[action], disabledReason: !snapshot.capabilities.manage || !snapshot.capabilities.manageVisits ? 'Ваш доступ к визитам позволяет только просмотр.'
      : action === 'start' && !snapshot.capabilities.startVisits ? 'Начало приёма отмечает врач с доступом к проведению приёма.' : state.reason };
  });
}

export function regionalCommandAllowed(snapshot: RegionalFacilitySnapshot, command: Pick<RegionalCommand, 'type'> & { action?: VisitAction }): boolean {
  if (!snapshot.capabilities.manage) return false;
  if (command.type === 'visit.transition' && command.action === 'start' && !snapshot.capabilities.startVisits) return false;
  const capability = { 'visit.transition': 'manageVisits', 'task.transition': 'manageTasks', 'lab.complete': 'manageLabs',
    'lab.review': 'reviewLabs', 'prescription.dispense': 'dispense', 'procurement.receive': 'receiveProcurement' } as const;
  return snapshot.capabilities[capability[command.type]];
}

export function regionalActiveVisits(snapshot: RegionalFacilitySnapshot): CrmVisit[] {
  const queue = new Map(queueVisits(snapshot.crm).map((visit, index) => [visit.id, index]));
  const priority = { in_service: 0, called: 1, queued: 2, arrived: 3, scheduled: 4 };
  return snapshot.crm.visits.filter(visit => Object.hasOwn(priority, visit.status)).sort((a, b) =>
    priority[a.status as keyof typeof priority] - priority[b.status as keyof typeof priority]
    || (a.status === 'queued' && b.status === 'queued' ? queue.get(a.id)! - queue.get(b.id)! : 0)
    || a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id));
}
const labels = { scheduled: 'Запланирован', arrived: 'Прибыл', queued: 'В очереди', called: 'Вызван', in_service: 'На приёме', completed: 'Завершён', cancelled: 'Отменён', no_show: 'Неявка',
  pending: 'Ожидает', in_progress: 'В работе', escalated: 'На разборе', ordered: 'Заказан', ready: 'Готов', reviewed: 'Проверен врачом', approved: 'Назначен', dispensed: 'Выдан', received: 'Получен' };
const tabs = [
  { id: 'visits', label: 'Визиты и очередь', icon: Clock3 },
  { id: 'patients', label: 'Пациенты', icon: Users }, { id: 'labs', label: 'Анализы', icon: FlaskConical },
  { id: 'pharmacy', label: 'Аптека', icon: Pill }, { id: 'procurement', label: 'Закупки', icon: Package },
  { id: 'tasks', label: 'Задачи', icon: ClipboardList }, { id: 'history', label: 'История', icon: History },
] as const;
function Status({ status }: { status: keyof typeof labels }) { return <span className={styles.status} data-status={status}>{labels[status]}</span>; }
function Empty({ children }: { children: React.ReactNode }) { return <div className={styles.empty}>{children}</div>; }

export function RegionalFacilityWorkspace({ snapshot, busy, actionError = '', execute }: {
  snapshot: RegionalFacilitySnapshot; busy: boolean; actionError?: string; execute: (command: RegionalCommand) => Promise<boolean>;
}) {
  const [tab, setTab] = useState<Tab>('patients');
  const [search, setSearch] = useState('');
  const [patientId, setPatientId] = useState<string | null>(null);
  const [selection, setSelection] = useState<CrmSelection | null>(null);
  const [confirmation, setConfirmationState] = useState<ConfirmationState | null>(null);
  const [confirmationError, setConfirmationError] = useState('');
  const submission = useRef<{ confirmation: ConfirmationState; command: RegionalCommand } | null>(null);
  const [labDraft, setLabDraft] = useState<{ id: string; result: string; unit: string } | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const lock = useRef(false);
  const patients = useMemo(() => new Map(snapshot.crm.patients.map(row => [row.id, row])), [snapshot.crm.patients]);
  const staff = useMemo(() => new Map(snapshot.crm.staff.map(row => [row.id, row])), [snapshot.crm.staff]);
  const activePatient = snapshot.capabilities.readPatients && patientId ? patients.get(patientId) : undefined;
  const selectedVisit = selection?.kind === 'visit' ? snapshot.crm.visits.find(visit => visit.id === selection.id && visit.patientId === patientId) : undefined;
  const record = snapshot.capabilities.readClinical ? snapshot.medicalRecords.find(row => row.patientId === patientId) : undefined;
  const visibleVisitIds = useMemo(() => new Set(snapshot.capabilities.readPatients ? snapshot.crm.visits.map(row => row.id) : []), [snapshot.crm.visits, snapshot.capabilities.readPatients]);
  const mapSnapshot = useMemo(() => !snapshot.capabilities.readPatients ? { ...snapshot.crm, patients: [], visits: [], tasks: [] }
    : snapshot.capabilities.readClinical ? snapshot.crm : { ...snapshot.crm, tasks: [] }, [snapshot.crm, snapshot.capabilities.readPatients, snapshot.capabilities.readClinical]);
  const selectedRoom = selection?.kind === 'room' ? snapshot.crm.rooms.find(row => row.id === selection.id) : undefined;
  const selectedStaff = selection?.kind === 'staff' ? staff.get(selection.id) : undefined;
  const selectedPatientIds = selectedRoom || selectedStaff ? new Set(snapshot.crm.visits.filter(visit => selectedRoom ? visit.roomId === selectedRoom.id : visit.staffId === selectedStaff?.id).map(visit => visit.patientId)) : null;
  const visiblePatients = snapshot.capabilities.readPatients ? snapshot.crm.patients.filter(row => (!selectedPatientIds || selectedPatientIds.has(row.id)) && `${row.name} ${row.mrn}`.toLocaleLowerCase('ru-RU').includes(search.toLocaleLowerCase('ru-RU'))) : [];
  const canWrite = snapshot.capabilities.manage && !busy && !submitting;
  const activeVisits = useMemo(() => regionalActiveVisits(snapshot), [snapshot]);
  const visibleWorkTasks = snapshot.workTasks.filter(task => !task.patientId && !task.visitId || snapshot.capabilities.readPatients && snapshot.capabilities.readClinical);
  const availableTabs = tabs.filter(item => item.id === 'patients' || item.id === 'visits' ? snapshot.capabilities.readPatients
    : item.id === 'labs' ? snapshot.capabilities.readClinical
      : item.id === 'pharmacy' ? snapshot.capabilities.readClinical || snapshot.capabilities.dispense
        : item.id === 'procurement' ? snapshot.capabilities.receiveProcurement : true);
  const activeTab = availableTabs.some(item => item.id === tab) ? tab : availableTabs[0].id;
  const name = (id: string) => patients.get(id)?.name ?? 'Пациент';
  const commandBase = () => ({ facilityId: snapshot.facility.id, idempotencyKey: crypto.randomUUID() });
  function setConfirmation(value: ConfirmationState | null) {
    setConfirmationState(value); setConfirmationError('');
    if (!value) submission.current = null;
  }
  function select(value: CrmSelection) {
    if (busy) return;
    setSelection(value);
    if (value.kind === 'visit') { const visit = snapshot.crm.visits.find(row => row.id === value.id); if (visit) { setPatientId(visit.patientId); setTab('patients'); } }
    else if (value.kind === 'patient') { setPatientId(value.id); setTab('patients'); }
    else if (value.kind === 'staff' || value.kind === 'room') { setPatientId(null); setTab('patients'); }
  }
  function requestVisitAction(visit: CrmVisit, choice: VisitChoice) {
    if (!canWrite || choice.disabledReason) return;
    const current = snapshot.crm.visits.find(row => row.id === visit.id);
    if (!current || current.version !== visit.version || !regionalVisitActions(snapshot, current).some(row => row.action === choice.action && !row.disabledReason)) return;
    const room = snapshot.crm.rooms.find(row => row.id === visit.roomId)?.name ?? 'Кабинет из записи';
    setConfirmation({ title: choice.confirmation,
      detail: `${name(visit.patientId)} · ${room} · ${staff.get(visit.staffId)?.name ?? 'Сотрудник из записи'}. ${choice.explanation}`,
      command: { type: 'visit.transition', visitId: visit.id, expectedVersion: visit.version, action: choice.action } });
  }
  async function confirm() {
    if (!confirmation || lock.current || !canWrite) return;
    if (!regionalCommandAllowed(snapshot, confirmation.command)) { setConfirmationError('Для этого действия больше нет доступа. Закройте окно и обновите данные.'); return; }
    lock.current = true; setSubmitting(true);
    setConfirmationError('');
    if (submission.current?.confirmation !== confirmation) submission.current = { confirmation, command: { ...confirmation.command, ...commandBase() } as RegionalCommand };
    try { if (await execute(submission.current.command)) { setConfirmation(null); setLabDraft(null); submission.current = null; } }
    catch { setConfirmationError('Не удалось подтвердить сохранение. Повторите действие: будет использован тот же запрос.'); }
    finally { lock.current = false; setSubmitting(false); }
  }
  return <section className={styles.facilityWorkspace} aria-label="Рабочее пространство учреждения">
    <div className={`${crmStyles.workspace} ${styles.clinicMap}`}>
      <div className={styles.clinicCaption}><div><span className={styles.eyebrow}>ПЛАН УЧРЕЖДЕНИЯ</span><h2>Люди и кабинеты</h2></div><span>{snapshot.crm.rooms.length} кабинетов · {snapshot.crm.staff.length} сотрудников</span></div>
      <CrmScene snapshot={mapSnapshot} selection={selection} onSelect={select} visibleVisitIds={visibleVisitIds} focusSelection facilityMode />
      <div className={styles.clinicSummary}><span><Activity size={15} />{snapshot.facility.activeVisits} активных визитов</span><span><Clock3 size={15} />{snapshot.facility.queuedVisits} в очереди</span><span>Положение по записям БД</span></div>
      {snapshot.capabilities.readPatients && activeVisits.length > 0 && <div className={styles.queueStrip}><strong>Активные визиты по времени записи</strong>{snapshot.crm.visits.filter(visit => !['completed', 'cancelled', 'no_show'].includes(visit.status)).sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt)).slice(0, 5).map(visit =>
        <button type="button" key={visit.id} onClick={() => select({ kind: 'visit', id: visit.id })}><span>{regionalDate(visit.scheduledAt)}</span><strong>{name(visit.patientId)}</strong><Status status={visit.status} /></button>)}</div>}
    </div>
    <div className={styles.medicalPanel}>
      <nav className={styles.facilityTabs} aria-label="Разделы учреждения">{availableTabs.map(({ id, label, icon: Icon }) => <button key={id} type="button" aria-pressed={activeTab === id} onClick={() => { setTab(id); setLabDraft(null); }}><Icon size={16} />{label}</button>)}</nav>
      <div className={styles.medicalContent}>
        {activeTab === 'visits' && <>
          <div className={styles.panelHeading}><h2>Визиты и очередь</h2><span className={styles.count}>{activeVisits.length}</span></div>
          <p className={styles.sectionDescription}>Сначала текущие приёмы и вызванные пациенты, затем очередь в сохранённом порядке. Каждое изменение требует подтверждения.</p>
          {activeVisits.map(visit => <RegionalVisitCard key={visit.id} snapshot={snapshot} visit={visit} busy={busy || submitting}
            onAction={choice => requestVisitAction(visit, choice)} onOpenPatient={() => select({ kind: 'visit', id: visit.id })} />)}
          {!activeVisits.length && <Empty>Активных визитов нет. Завершённые записи сохранены в карточках пациентов.</Empty>}
        </>}
        {activeTab === 'patients' && <>
          {activePatient ? <>
            <button type="button" className={styles.back} onClick={() => { setPatientId(null); setSelection(null); }}>← Все пациенты</button>
            <div className={styles.patientHeader}><span className={styles.patientAvatar}>{activePatient.name.split(' ').slice(0, 2).map(part => part[0]).join('')}</span><div><h2>{activePatient.name}</h2><p>{activePatient.sex === 'female' ? 'Женщина' : activePatient.sex === 'male' ? 'Мужчина' : 'Пол не указан'}{record ? ` · ${regionalDate(record.birthDate, true)}` : ''}</p><small>Карта {activePatient.mrn}</small></div></div>
            {selectedVisit && <RegionalVisitCard snapshot={snapshot} visit={selectedVisit} busy={busy || submitting} onAction={choice => requestVisitAction(selectedVisit, choice)} />}
            {!selectedVisit && snapshot.crm.visits.some(visit => visit.patientId === patientId) && <>
              <h3 className={styles.sectionTitle}><Clock3 size={17} />Визиты пациента</h3>
              {snapshot.crm.visits.filter(visit => visit.patientId === patientId).sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt)).map(visit =>
                <button className={styles.recordButton} key={visit.id} type="button" onClick={() => select({ kind: 'visit', id: visit.id })}><span>{regionalDate(visit.scheduledAt)}<small>{snapshot.crm.rooms.find(room => room.id === visit.roomId)?.name}</small></span><Status status={visit.status} /></button>)}
            </>}
            {record ? <>
              <dl className={styles.facts}><div><dt>Учебный идентификатор вместо ИИН</dt><dd>{record.trainingIin}</dd></div><div><dt>Аллергии</dt><dd>{record.allergies.length ? record.allergies.join('; ') : 'В записи не указаны'}</dd></div></dl>
              <h3 className={styles.sectionTitle}><FileText size={17} />Состояния и заболевания</h3>
              {record.conditions.length ? record.conditions.map((condition, index) => <article key={index} className={styles.record}><div><strong>{condition.name}</strong><span className={styles.muted}>{condition.code} · с {regionalDate(condition.since, true)}</span></div><span className={styles.status}>{condition.status === 'active' ? 'Наблюдается' : 'В анамнезе'}</span></article>) : <Empty>Нет сохранённых состояний.</Empty>}
              <h3 className={styles.sectionTitle}><Pill size={17} />Назначенные лекарства</h3>
              {snapshot.prescriptions.filter(row => row.patientId === patientId).map(row => <article className={styles.record} key={row.id}><div><strong>{row.drugName} · {row.dose}</strong><p>{row.instructions}</p><small>{row.prescribedBy} · {regionalDate(row.prescribedAt)}</small></div><Status status={row.status} /></article>)}
              {snapshot.prescriptions.every(row => row.patientId !== patientId) && <Empty>Сохранённых рецептов нет.</Empty>}
              <h3 className={styles.sectionTitle}><FlaskConical size={17} />Исследования</h3>
              {snapshot.labs.filter(row => row.patientId === patientId).map(row => <button key={row.id} type="button" className={styles.recordButton} onClick={() => setTab('labs')}><span><strong>{row.name}</strong><small>{row.result ? `${row.result} ${row.unit ?? ''}` : 'Результат пока не внесён'}</small></span><Status status={row.status} /></button>)}
              <h3 className={styles.sectionTitle}><History size={17} />История болезни</h3>
              <div className={styles.timeline}>{record.history.map(item => <article key={item.id}><span>{regionalDate(item.date)}</span><strong>{item.title}</strong><p>{item.detail}</p><small>{item.doctor}</small></article>)}</div>
            </> : <Empty>{snapshot.capabilities.readClinical ? 'Медицинская запись ещё не заполнена.' : 'Медицинское содержание доступно только сотрудникам с клиническими правами.'}</Empty>}
          </> : <>
            <div className={styles.panelHeading}><h2>{selectedRoom?.name ?? selectedStaff?.name ?? 'Пациенты учреждения'}</h2>{(selectedRoom || selectedStaff) && <button type="button" onClick={() => setSelection(null)} aria-label="Снять выбор объекта"><X size={16} /></button>}</div>
            {(selectedRoom || selectedStaff) && <div className={styles.objectInfo}><p>{selectedRoom ? 'Пациенты с визитами в выбранный кабинет' : 'Пациенты выбранного сотрудника'}</p>{snapshot.crm.visits.filter(v => selectedRoom ? v.roomId === selectedRoom.id : v.staffId === selectedStaff?.id).map(visit => <button className={styles.recordButton} key={visit.id} type="button" onClick={() => select({ kind: 'visit', id: visit.id })}><span>{name(visit.patientId)}<small>{regionalDate(visit.scheduledAt)}</small></span><Status status={visit.status} /></button>)}</div>}
            <label className={styles.search}><Search size={16} /><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Имя или номер карты" aria-label="Найти пациента учреждения" /></label>
            {visiblePatients.map(patient => {
              const chart = snapshot.capabilities.readClinical ? snapshot.medicalRecords.find(row => row.patientId === patient.id) : undefined;
              return <button key={patient.id} type="button" className={styles.patientRow} onClick={() => select({ kind: 'patient', id: patient.id })}><span className={styles.smallAvatar}>{patient.name[0]}</span><span><strong>{patient.name}</strong><small>{patient.mrn}{chart ? ` · ${chart.conditions[0]?.name ?? 'Карта заполнена'}` : ''}</small></span><ArrowRight size={16} /></button>;
            })}
            {!visiblePatients.length && <Empty>В этом учреждении ещё нет карт пациентов.</Empty>}
          </>}
        </>}
        {activeTab === 'labs' && <><div className={styles.panelHeading}><h2>Анализы и результаты</h2><span className={styles.count}>{snapshot.labs.length}</span></div><p className={styles.sectionDescription}>Заявка → результат → проверка врачом</p>
          {snapshot.labs.map(lab => <article className={styles.workCard} key={lab.id}><div className={styles.rowHeading}><strong>{lab.name}</strong><Status status={lab.status} /></div><button className={styles.textLink} type="button" onClick={() => { setPatientId(lab.patientId); setTab('patients'); }}>{name(lab.patientId)}</button>
            <p>Срок: {regionalDate(lab.dueAt)}{lab.priority === 'urgent' && <span className={styles.urgent}> · Срочно</span>}</p>
            {lab.result !== null && <div className={styles.labResult}><strong>{lab.result} {lab.unit}</strong><small>Референс из записи: {lab.reference || 'не указан'}</small></div>}
            {lab.status === 'ordered' && (labDraft?.id === lab.id ? <form className={styles.inlineForm} onSubmit={event => { event.preventDefault(); if (canWrite && snapshot.capabilities.manageLabs && labDraft.result.trim()) setConfirmation({ title: 'Сохранить результат анализа?', detail: `${lab.name} · ${name(lab.patientId)}. Результат будет доступен в медицинской карте для проверки врачом.`, command: { type: 'lab.complete', labId: lab.id, expectedVersion: lab.version, result: labDraft.result.trim(), unit: labDraft.unit.trim() } }); }}>
              <label>Результат<textarea required maxLength={1000} value={labDraft.result} onChange={event => setLabDraft({ ...labDraft, result: event.target.value })} /></label><label>Единицы<input maxLength={40} value={labDraft.unit} onChange={event => setLabDraft({ ...labDraft, unit: event.target.value })} /></label><button type="submit" className={styles.primary} disabled={!canWrite || !snapshot.capabilities.manageLabs}>Сохранить результат</button>
            </form> : <button className={styles.button} type="button" disabled={!canWrite || !snapshot.capabilities.manageLabs} onClick={() => setLabDraft({ id: lab.id, result: '', unit: '' })}>Внести результат</button>)}
            {lab.status === 'ready' && <button type="button" className={styles.button} disabled={!canWrite || !snapshot.capabilities.reviewLabs} onClick={() => setConfirmation({ title: 'Подтвердить проверку результата?', detail: `${lab.name} · ${name(lab.patientId)}. Вы подтверждаете, что просмотрели внесённый результат.`, command: { type: 'lab.review', labId: lab.id, expectedVersion: lab.version } })}><Check size={15} />Результат проверен</button>}
          </article>)}{!snapshot.labs.length && <Empty>Исследования пока не назначены.</Empty>}</>}
        {activeTab === 'pharmacy' && <><div className={styles.panelHeading}><h2>Лекарства и выдача</h2><Pill size={21} /></div>
          <h3 className={styles.sectionTitle}>Остатки по партиям</h3>{snapshot.stocks.map(stock => <div key={stock.id} className={styles.stockRow} data-low={stock.quantity <= stock.reorderPoint}><div><strong>{stock.drugName}</strong><small>Партия {stock.batch} · до {regionalDate(stock.expiresAt, true)}</small></div><span><strong>{stock.quantity}</strong> {stock.unit}<small>Минимум {stock.reorderPoint}</small></span></div>)}
          <h3 className={styles.sectionTitle}>Рецепты пациентов</h3>{snapshot.prescriptions.map(row => {
            const stock = snapshot.stocks.find(s => s.id === row.stockId); const insufficient = !stock || stock.quantity < row.quantity;
            return <article className={styles.workCard} key={row.id}><div className={styles.rowHeading}><strong>{row.drugName}</strong><Status status={row.status} /></div><button type="button" className={styles.textLink} onClick={() => { setPatientId(row.patientId); setTab('patients'); }}>{name(row.patientId)}</button><p>{row.dose} · {row.instructions}</p><small>{row.prescribedBy} · {regionalDate(row.prescribedAt)}</small>
              {row.status === 'approved' && <><button className={styles.button} type="button" disabled={!canWrite || !snapshot.capabilities.dispense || insufficient} onClick={() => setConfirmation({ title: 'Подтвердить выдачу лекарства?', detail: `${name(row.patientId)}: ${row.drugName}, ${row.quantity} ${stock?.unit ?? 'ед.'}. Остаток партии уменьшится с ${stock?.quantity} до ${(stock?.quantity ?? 0) - row.quantity}.`, command: { type: 'prescription.dispense', prescriptionId: row.id, expectedVersion: row.version } })}><Package size={15} />Выдать {row.quantity} {stock?.unit}</button>{insufficient && <p className={styles.urgent}>На складе недостаточно. Проверьте закупки.</p>}</>}
              {row.dispensedAt && <p className={styles.muted}>Выдано {regionalDate(row.dispensedAt)}</p>}
            </article>;
          })}{!snapshot.prescriptions.length && <Empty>Рецептов в этом учреждении пока нет.</Empty>}</>}
        {activeTab === 'procurement' && <><div className={styles.panelHeading}><h2>Закупки и поставки</h2><Package size={21} /></div><p className={styles.sectionDescription}>Сохранённые заказы поставщикам. Приёмка пополняет склад выбранного учреждения.</p>
          {snapshot.procurements.map(row => <article className={styles.workCard} key={row.id}><div className={styles.rowHeading}><strong>{row.drugName}</strong><Status status={row.status} /></div><p>{row.supplier}</p><dl className={styles.facts}><div><dt>Количество</dt><dd>{row.quantity} {snapshot.stocks.find(s => s.id === row.stockId)?.unit}</dd></div><div><dt>Сумма заказа</dt><dd>{row.amountKzt.toLocaleString('ru-RU')} ₸</dd></div><div><dt>Ожидается</dt><dd>{regionalDate(row.dueAt)}</dd></div></dl>
            {row.status === 'ordered' && <button className={styles.button} type="button" disabled={!canWrite || !snapshot.capabilities.receiveProcurement} onClick={() => setConfirmation({ title: 'Принять поставку на склад?', detail: `${row.drugName}: ${row.quantity} единиц от ${row.supplier}. Сохранённый остаток будет увеличен один раз.`, command: { type: 'procurement.receive', procurementId: row.id, expectedVersion: row.version } })}><Check size={15} />Подтвердить приёмку</button>}
            {row.receivedAt && <p className={styles.muted}>Принято {regionalDate(row.receivedAt)}</p>}
          </article>)}{!snapshot.procurements.length && <Empty>Нет сохранённых заказов.</Empty>}</>}
        {activeTab === 'tasks' && <><div className={styles.panelHeading}><h2>Рабочие задачи</h2><span className={styles.count}>{visibleWorkTasks.length}</span></div><p className={styles.sectionDescription}>Выполнение этих задач меняет показатели соблюдения сроков, но не медицинские KPI. Показаны задачи в вашем доступе.</p>
          {visibleWorkTasks.map(task => <article key={task.id} className={styles.workCard}><div className={styles.rowHeading}><strong>{task.title}</strong><Status status={task.status} /></div>{task.patientId && <button type="button" className={styles.textLink} onClick={() => { setPatientId(task.patientId); setTab('patients'); }}>{name(task.patientId)}</button>}<p>{staff.get(task.ownerId)?.name ?? 'Ответственный сотрудник'} · {regionalDate(task.dueAt)}</p>{task.priority === 'urgent' && <span className={styles.urgent}>Срочная задача</span>}
            {task.status !== 'completed' && <div className={styles.cardActions}>{(task.status === 'pending' ? ['in_progress', 'escalated'] : task.status === 'in_progress' ? ['completed', 'escalated'] : []).map(status => <button key={status} className={styles.button} type="button" disabled={!canWrite || !snapshot.capabilities.manageTasks} onClick={() => setConfirmation({ title: status === 'completed' ? 'Завершить задачу?' : status === 'escalated' ? 'Передать задачу на разбор?' : 'Взять задачу в работу?', detail: task.title, command: { type: 'task.transition', taskId: task.id, expectedVersion: task.version, status: status as 'completed' | 'in_progress' | 'escalated' } })}>{status === 'completed' ? 'Завершить' : status === 'escalated' ? 'На разбор' : 'В работу'}</button>)}</div>}
          </article>)}{!visibleWorkTasks.length && <Empty>Доступных задач пока нет.</Empty>}</>}
        {activeTab === 'history' && <><h2>История действий</h2><p className={styles.sectionDescription}>Записи журнала учреждения из базы данных</p><div className={styles.timeline}>{snapshot.events.map(event => <article key={event.id}><span>{regionalDate(event.createdAt)}</span><strong>{({ 'visit.transition': 'Изменён этап визита', 'task.transition': 'Изменён статус задачи', 'lab.complete': 'Внесён результат анализа', 'lab.review': 'Результат проверен врачом', 'prescription.dispense': 'Лекарство выдано', 'procurement.receive': 'Поставка принята' } as Record<string, string>)[event.action] ?? event.action}</strong><small>{event.actorLabel}</small></article>)}</div>{!snapshot.events.length && <Empty>После первого сохранённого действия здесь появится запись.</Empty>}</>}
      </div>
    </div>
    {confirmation && <RegionalConfirmation title={confirmation.title} detail={confirmation.detail} error={confirmationError || actionError} busy={busy || submitting}
      allowed={regionalCommandAllowed(snapshot, confirmation.command)} onConfirm={() => void confirm()} onClose={() => setConfirmation(null)} />}
  </section>;
}
export function RegionalVisitCard({ snapshot, visit, busy, onAction, onOpenPatient }: {
  snapshot: RegionalFacilitySnapshot; visit: CrmVisit; busy: boolean;
  onAction: (choice: VisitChoice) => void; onOpenPatient?: () => void;
}) {
  if (!snapshot.capabilities.readPatients) return <Empty>Нет доступа к сведениям визита.</Empty>;
  const patient = snapshot.crm.patients.find(row => row.id === visit.patientId);
  const room = snapshot.crm.rooms.find(row => row.id === visit.roomId);
  const staff = snapshot.crm.staff.find(row => row.id === visit.staffId);
  const queuePosition = visit.status === 'queued' ? queueVisits(snapshot.crm)
    .filter(row => row.roomId === visit.roomId || row.staffId === visit.staffId).findIndex(row => row.id === visit.id) + 1 : 0;
  const choices = regionalVisitActions(snapshot, visit);
  const reasons = [...new Set(choices.map(choice => choice.disabledReason).filter((reason): reason is string => Boolean(reason)))];
  return <article className={styles.workCard} aria-label={`Визит: ${patient?.name ?? 'Пациент из записи'}`}>
    <div className={styles.rowHeading}><strong>{onOpenPatient ? <button type="button" className={styles.textLink} onClick={onOpenPatient}>{patient?.name ?? 'Открыть пациента'}</button> : 'Выбранный визит'}</strong><Status status={visit.status} /></div>
    <p>{regionalDate(visit.scheduledAt)} · {room?.name ?? 'Кабинет из записи'}</p>
    <small>{staff?.name ?? 'Сотрудник из записи'}{queuePosition > 0 ? ` · Место в очереди: ${queuePosition}` : ''}</small>
    {choices.length > 0 && <div className={styles.cardActions}>{choices.map(choice => <button key={choice.action} className={choice.action === 'cancel' ? styles.button : styles.primary}
      type="button" disabled={busy || Boolean(choice.disabledReason)} title={choice.disabledReason ?? choice.explanation}
      onClick={() => { if (!busy && !choice.disabledReason) onAction(choice); }}>{choice.label}</button>)}</div>}
    {reasons.map(reason => <p key={reason} className={styles.muted}>{reason}</p>)}
    {visit.status === 'in_service' && <p className={styles.sectionDescription}>Приём идёт. Завершение требует медицинской записи врача; на этой панели оно недоступно.</p>}
  </article>;
}
export function RegionalConfirmation({ title, detail, error, busy, allowed, onConfirm, onClose }: { title: string; detail: string; error: string; busy: boolean; allowed: boolean; onConfirm: () => void; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => { const node = ref.current; node?.showModal(); return () => node?.close(); }, []);
  return <dialog ref={ref} className={styles.dialog} aria-labelledby="regional-command-title" onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}>
    <h2 id="regional-command-title">{title}</h2><p>{detail}</p>{error && <p role="alert" className={styles.urgent}>{error}</p>}{!allowed && <p role="alert" className={styles.urgent}>Для этого действия нет действующего доступа.</p>}<div className={styles.cardActions}><button className={styles.button} type="button" disabled={busy} onClick={onClose}>Отмена</button><button className={styles.primary} type="button" disabled={busy || !allowed} onClick={() => { if (!busy && allowed) onConfirm(); }}>{busy ? 'Сохраняем…' : 'Подтвердить'}</button></div>
  </dialog>;
}
