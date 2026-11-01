import { crmCommandSchema, type CrmCommand, type CrmSnapshot, type CrmTask, type CrmTaskStatus, type CrmVisit } from './contracts';

export const crmOperationVisitLabels = { scheduled: 'Запланирован', arrived: 'Прибыл', queued: 'В очереди', called: 'Вызван', in_service: 'На приёме', completed: 'Завершён', cancelled: 'Отменён', no_show: 'Неявка' } as const;
export const crmOperationTaskLabels = { pending: 'Ожидает', in_progress: 'В работе', completed: 'Завершена', escalated: 'На разборе' } as const;
export const crmStaffRoleLabels = { doctor: 'Врач', nurse: 'Медсестра', registrar: 'Регистратор', support: 'Поддержка' } as const;
export const crmRoomKindLabels = { reception: 'Регистратура', consultation: 'Консультация', diagnostics: 'Диагностика', treatment: 'Процедурная', staff: 'Для сотрудников' } as const;
export const crmTaskKindLabels = { preparation: 'Подготовка', follow_up: 'Повторный контакт', service: 'Организация услуги' } as const;
export const crmSexLabels = { female: 'Женский', male: 'Мужской', unknown: 'Не указан' } as const;
export const isOpenCrmTask = (task: CrmTask) => task.status !== 'completed';
export const isActiveCrmVisit = (visit: CrmVisit) => !['completed', 'cancelled', 'no_show'].includes(visit.status);
const match = (search: string, values: Array<string | undefined>) => values.join(' ').toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU'));

export function crmOperationsIndex(snapshot: CrmSnapshot) {
  const group = <T,>(rows: T[], key: (row: T) => string) => {
    const result = new Map<string, T[]>();
    for (const row of rows) { const id = key(row); const current = result.get(id); if (current) current.push(row); else result.set(id, [row]); }
    return result;
  };
  return { patients: new Map(snapshot.patients.map(row => [row.id, row])), staff: new Map(snapshot.staff.map(row => [row.id, row])),
    rooms: new Map(snapshot.rooms.map(row => [row.id, row])), services: new Map(snapshot.services.map(row => [row.id, row])),
    visits: new Map(snapshot.visits.map(row => [row.id, row])), tasks: new Map(snapshot.tasks.map(row => [row.id, row])),
    patientVisits: group(snapshot.visits, row => row.patientId), roomVisits: group(snapshot.visits, row => row.roomId),
    staffVisits: group(snapshot.visits, row => row.staffId), serviceVisits: group(snapshot.visits, row => row.serviceId),
    patientTasks: group(snapshot.tasks, row => row.patientId), staffTasks: group(snapshot.tasks, row => row.ownerId),
    roomStaff: group(snapshot.staff, row => row.roomId), kindRooms: group(snapshot.rooms, row => row.kind) };
}
export type CrmOperationsIndex = ReturnType<typeof crmOperationsIndex>;

function calendarDayWithFormatter(iso: string, formatter: Intl.DateTimeFormat) {
  const parts = formatter.formatToParts(new Date(iso));
  const value = (type: string) => parts.find(part => part.type === type)?.value ?? '';
  return `${value('year')}-${value('month')}-${value('day')}`;
}
/** Calendar grouping uses an explicit zone, never an ISO string's UTC day. */
export function crmCalendarDay(iso: string, timeZone: string): string {
  return calendarDayWithFormatter(iso, new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }));
}
export function crmDailyVisits(snapshot: CrmSnapshot, day: string, timeZone: string, search = '', status = 'all', index = crmOperationsIndex(snapshot)) {
  const formatter = day ? new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }) : null;
  return snapshot.visits.filter(visit => (!formatter || calendarDayWithFormatter(visit.scheduledAt, formatter) === day) &&
    (status === 'all' || visit.status === status) && match(search, [index.patients.get(visit.patientId)?.name,
      index.patients.get(visit.patientId)?.mrn, index.staff.get(visit.staffId)?.name, index.rooms.get(visit.roomId)?.name,
      index.services.get(visit.serviceId)?.name, crmOperationVisitLabels[visit.status]]))
    .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id));
}

export function crmTaskRows(snapshot: CrmSnapshot, search = '', status: CrmTaskStatus | 'all' = 'all', ownerId = '', index = crmOperationsIndex(snapshot)) {
  return snapshot.tasks.filter(task => (status === 'all' || task.status === status) && (!ownerId || task.ownerId === ownerId) &&
    match(search, [task.title, index.patients.get(task.patientId)?.name, index.patients.get(task.patientId)?.mrn,
      index.staff.get(task.ownerId)?.name, crmTaskKindLabels[task.kind], crmOperationTaskLabels[task.status]]))
    .sort((a, b) => Number(b.priority === 'urgent') - Number(a.priority === 'urgent') || a.dueAt.localeCompare(b.dueAt) || a.id.localeCompare(b.id));
}

export function crmPatientRows(snapshot: CrmSnapshot, search = '', sex = 'all', index = crmOperationsIndex(snapshot)) {
  return snapshot.patients.filter(patient => (sex === 'all' || patient.sex === sex) && match(search, [patient.name, patient.mrn]))
    .map(patient => {
      const visits = [...(index.patientVisits.get(patient.id) ?? [])]
        .sort((a, b) => b.scheduledAt.localeCompare(a.scheduledAt) || a.id.localeCompare(b.id));
      return { patient, visits, activeVisits: visits.filter(isActiveCrmVisit).length,
        openTasks: (index.patientTasks.get(patient.id) ?? []).filter(isOpenCrmTask).length,
        latestVisit: visits[0] ?? null };
    }).sort((a, b) => a.patient.name.localeCompare(b.patient.name, 'ru') || a.patient.id.localeCompare(b.patient.id));
}

export function crmPriorities(snapshot: CrmSnapshot) {
  // The displayed snapshot clock is reproducible; this view has no polling or timer.
  const now = Date.parse(snapshot.generatedAt);
  const openTasks = snapshot.tasks.filter(isOpenCrmTask);
  return { overdue: openTasks.filter(task => Date.parse(task.dueAt) < now), urgent: openTasks.filter(task => task.priority === 'urgent'),
    escalated: openTasks.filter(task => task.status === 'escalated'), queue: snapshot.visits.filter(visit => visit.status === 'queued'),
    arrived: snapshot.visits.filter(visit => visit.status === 'arrived'), inService: snapshot.visits.filter(visit => visit.status === 'in_service'),
    upcoming: snapshot.visits.filter(visit => visit.status === 'scheduled' && Date.parse(visit.scheduledAt) >= now)
      .sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id)),
    events: [...snapshot.events].sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)) };
}

export function crmResourceRows(snapshot: CrmSnapshot, search = '', index = crmOperationsIndex(snapshot)) {
  return {
    rooms: snapshot.rooms.filter(room => match(search, [room.name, crmRoomKindLabels[room.kind]])).map(room => ({ room,
      staff: index.roomStaff.get(room.id) ?? [], visits: index.roomVisits.get(room.id) ?? [],
      active: (index.roomVisits.get(room.id) ?? []).filter(isActiveCrmVisit).length,
      inService: (index.roomVisits.get(room.id) ?? []).filter(visit => visit.status === 'in_service').length })),
    staff: snapshot.staff.filter(person => match(search, [person.name, crmStaffRoleLabels[person.role], index.rooms.get(person.roomId)?.name])).map(person => ({ person,
      room: index.rooms.get(person.roomId), activeVisits: (index.staffVisits.get(person.id) ?? []).filter(isActiveCrmVisit).length,
      openTasks: (index.staffTasks.get(person.id) ?? []).filter(isOpenCrmTask).length })),
    services: snapshot.services.filter(service => match(search, [service.name, crmRoomKindLabels[service.roomKind]])).map(service => ({ service,
      rooms: index.kindRooms.get(service.roomKind) ?? [], visits: (index.serviceVisits.get(service.id) ?? []).length,
      active: (index.serviceVisits.get(service.id) ?? []).filter(isActiveCrmVisit).length })),
  };
}

/** Reject invalid/normalised calendar input before submitting a server command. */
export function crmDeviceDateToIso(input: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(input)) return null;
  const date = new Date(input);
  if (!Number.isFinite(date.getTime())) return null;
  const pad = (value: number) => String(value).padStart(2, '0');
  const roundTrip = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  return roundTrip === input ? date.toISOString() : null;
}
export function crmTaskCreateCommand(draft: { visitId: string; ownerId: string; kind: string; title: string; priority: string; dueAt: string }, idempotencyKey: string): CrmCommand | null {
  const dueAt = crmDeviceDateToIso(draft.dueAt);
  if (!dueAt) return null;
  const parsed = crmCommandSchema.safeParse({ ...draft, type: 'task.create', title: draft.title.trim(), dueAt, testDataAcknowledged: true, idempotencyKey });
  return parsed.success ? parsed.data : null;
}
export function crmRescheduleCommand(visit: CrmVisit, input: string, idempotencyKey: string): CrmCommand | null {
  if (visit.status !== 'scheduled') return null;
  const scheduledAt = crmDeviceDateToIso(input);
  if (!scheduledAt) return null;
  const parsed = crmCommandSchema.safeParse({ type: 'visit.reschedule', visitId: visit.id, expectedVersion: visit.version, scheduledAt, testDataAcknowledged: true, idempotencyKey });
  return parsed.success ? parsed.data : null;
}
