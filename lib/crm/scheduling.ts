import type { CrmSnapshot, CrmVisit, CrmVisitAction } from './contracts';
import { allowedCrmVisitActions } from './domain';

export type CrmCalendar = { timeZone: string; weekdays: number[]; openMinute: number; closeMinute: number; source: 'synthetic_policy' };
type CalendarSnapshot = CrmSnapshot & { calendar?: CrmCalendar };
type TimedVisit = CrmVisit & { durationMinutes?: number | null; queuedAt?: string | null; queueOrder?: number | null; bookingSource?: 'catalogue_backfill' | 'booking' };
export type CrmBookingInput = { patientId: string; staffId: string; roomId: string; serviceId: string; scheduledAt: string };
export type CrmSlotInput = Omit<CrmBookingInput, 'scheduledAt'> & { day: string };
export type CrmDurationSource = 'frozen' | 'legacy_catalogue' | 'missing';
export type CrmBookingInterval = { startMs: number; endMs: number; durationMinutes: number; durationSource: Exclude<CrmDurationSource, 'missing'> };
export type CrmBookingAvailability = { available: boolean; reasons: string[]; conflictVisitIds: string[]; durationMinutes: number | null; durationSource: CrmDurationSource };
export type CrmAvailableSlot = { scheduledAt: string; timeLabel: string; available: boolean; reasons: string[] };
export const CRM_AVAILABILITY_NOTICE = 'По последнему снимку базы. При сохранении сервер повторно проверит время и занятость.';
const minuteMs = 60_000;
const terminal = new Set(['completed', 'cancelled', 'no_show']);
const activeVisit = (visit: CrmVisit) => !terminal.has(visit.status);
const validDuration = (value: unknown): value is number => Number.isInteger(value) && Number(value) >= 5 && Number(value) <= 240;
const idsMatch = (a: Pick<CrmBookingInput, 'patientId' | 'staffId' | 'roomId' | 'serviceId'>, b: CrmVisit) =>
  a.patientId === b.patientId && a.staffId === b.staffId && a.roomId === b.roomId && a.serviceId === b.serviceId;
const sharedResource = (a: Pick<CrmBookingInput, 'patientId' | 'staffId' | 'roomId'>, b: CrmVisit) =>
  a.roomId === b.roomId || a.staffId === b.staffId || a.patientId === b.patientId;

function isoMs(value: unknown): number | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) && new Date(parsed).toISOString() === value ? parsed : null;
}
function utcDay(day: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const value = isoMs(`${day}T00:00:00.000Z`);
  return value;
}
function formatter(timeZone: string): Intl.DateTimeFormat | null {
  if (!/^(?:UTC|[A-Za-z_]+(?:\/[A-Za-z0-9_+-]+)+)$/.test(timeZone) || timeZone.length > 80) return null;
  try { return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }); }
  catch { return null; }
}
type LocalParts = { day: string; minute: number; second: number; weekday: number; naive: number };
function localParts(ms: number, format: Intl.DateTimeFormat): LocalParts | null {
  if (!Number.isFinite(ms)) return null;
  const parts = format.formatToParts(ms);
  const part = (type: string) => parts.find(value => value.type === type)?.value ?? '';
  const day = `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
  const base = utcDay(day);
  const minute = Number(part('hour')) * 60 + Number(part('minute'));
  const second = Number(part('second'));
  if (base === null || !Number.isInteger(minute) || minute < 0 || minute >= 1440 || !Number.isInteger(second) || second < 0 || second > 59) return null;
  return { day, minute, second, weekday: new Date(base).getUTCDay() || 7, naive: base + minute * minuteMs + second * 1000 };
}
export function clinicCalendar(snapshot: CrmSnapshot): CrmCalendar | null {
  const calendar = (snapshot as CalendarSnapshot).calendar;
  if (!calendar || calendar.source !== 'synthetic_policy' || !formatter(calendar.timeZone) ||
    !Array.isArray(calendar.weekdays) || !calendar.weekdays.length || calendar.weekdays.length > 7 || new Set(calendar.weekdays).size !== calendar.weekdays.length ||
    !calendar.weekdays.every(day => Number.isInteger(day) && day >= 1 && day <= 7) ||
    !Number.isInteger(calendar.openMinute) || !Number.isInteger(calendar.closeMinute) ||
    calendar.openMinute < 0 || calendar.closeMinute > 1440 || calendar.openMinute >= calendar.closeMinute) return null;
  return calendar;
}
export function clinicDay(iso: string, timeZone: string): string | null {
  const ms = isoMs(iso), format = formatter(timeZone);
  return ms === null || !format ? null : localParts(ms, format)?.day ?? null;
}
export function clinicMinute(iso: string, timeZone: string): number | null {
  const ms = isoMs(iso), format = formatter(timeZone);
  return ms === null || !format ? null : localParts(ms, format)?.minute ?? null;
}
function localTimeToIso(day: string, time: string, format: Intl.DateTimeFormat): string | null {
  const base = utcDay(day);
  if (base === null || !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) return null;
  const desiredMinute = Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
  const naive = base + desiredMinute * minuteMs;
  const offsets = new Set<number>();
  for (const shift of [-36, -12, 0, 12, 36]) {
    const probe = naive + shift * 3_600_000;
    const local = localParts(probe, format);
    if (local) offsets.add(local.naive - probe);
  }
  const candidates = [...offsets].map(offset => naive - offset).filter(ms => {
    const local = localParts(ms, format);
    return local?.day === day && local.minute === desiredMinute && local.second === 0;
  });
  // A skipped or repeated DST wall-clock minute is not silently normalised/guessed.
  return candidates.length === 1 ? new Date(candidates[0]).toISOString() : null;
}
export function clinicDateTimeToIso(day: string, time: string, timeZone: string): string | null {
  const format = formatter(timeZone);
  return format ? localTimeToIso(day, time, format) : null;
}

function durationFrom(visit: CrmVisit, services: ReadonlyMap<string, number>) {
  const saved = (visit as TimedVisit).durationMinutes;
  if (saved !== undefined && saved !== null) return validDuration(saved) ? saved : null;
  const legacy = services.get(visit.serviceId);
  return validDuration(legacy) ? legacy : null;
}
const durationMap = (snapshot: CrmSnapshot) => new Map(snapshot.services.slice(0, 200).map(service => [service.id, service.durationMinutes]));
export function visitDuration(snapshot: CrmSnapshot, visit: CrmVisit): number | null { return durationFrom(visit, durationMap(snapshot)); }
export function visitDurationSource(snapshot: CrmSnapshot, visit: CrmVisit): CrmDurationSource {
  if (visitDuration(snapshot, visit) === null) return 'missing';
  return (visit as TimedVisit).durationMinutes === undefined || (visit as TimedVisit).durationMinutes === null ? 'legacy_catalogue' : 'frozen';
}
function intervalFrom(visit: CrmVisit, services: ReadonlyMap<string, number>): CrmBookingInterval | null {
  const startMs = isoMs(visit.scheduledAt), durationMinutes = durationFrom(visit, services);
  if (startMs === null || durationMinutes === null) return null;
  return { startMs, endMs: startMs + durationMinutes * minuteMs, durationMinutes,
    durationSource: (visit as TimedVisit).durationMinutes === undefined || (visit as TimedVisit).durationMinutes === null ? 'legacy_catalogue' : 'frozen' };
}
export function visitBookingInterval(snapshot: CrmSnapshot, visit: CrmVisit): CrmBookingInterval | null { return intervalFrom(visit, durationMap(snapshot)); }
export function intervalsOverlap(a: Pick<CrmBookingInterval, 'startMs' | 'endMs'>, b: Pick<CrmBookingInterval, 'startMs' | 'endMs'>) {
  return a.startMs < b.endMs && b.startMs < a.endMs;
}
function conflictsFor(snapshot: CrmSnapshot, input: Pick<CrmBookingInput, 'patientId' | 'staffId' | 'roomId'>, interval: CrmBookingInterval, ignoreVisitId?: string) {
  const services = durationMap(snapshot);
  const conflicts: string[] = [], reasons: string[] = [];
  for (const visit of snapshot.visits.slice(0, 1000)) {
    if (!activeVisit(visit) || visit.id === ignoreVisitId || !sharedResource(input, visit)) continue;
    const other = intervalFrom(visit, services);
    if (!other) { reasons.push('Есть связанная активная запись без корректной длительности или времени. Обновите данные.'); continue; }
    if (intervalsOverlap(interval, other)) conflicts.push(visit.id);
  }
  if (conflicts.length) reasons.push('Этот интервал пересекается с активной записью кабинета, сотрудника или пациента.');
  return { conflictVisitIds: conflicts, reasons: [...new Set(reasons)] };
}
export function visitConflicts(snapshot: CrmSnapshot, visit: CrmVisit) {
  if (!activeVisit(visit)) return { conflictVisitIds: [], reasons: [] };
  const interval = visitBookingInterval(snapshot, visit);
  return interval ? conflictsFor(snapshot, visit, interval, visit.id) : { conflictVisitIds: [], reasons: ['У записи нет корректного времени или длительности. Конфликты определить нельзя.'] };
}

function withinCalendar(startMs: number, endMs: number, calendar: CrmCalendar, format: Intl.DateTimeFormat) {
  const start = localParts(startMs, format), end = localParts(endMs, format);
  if (!start || !end || !calendar.weekdays.includes(start.weekday)) return false;
  const exactMinute = (local: LocalParts, ms: number) => local.minute + local.second / 60 + ((ms % 1000 + 1000) % 1000) / minuteMs;
  if (exactMinute(start, startMs) < calendar.openMinute || exactMinute(start, startMs) >= calendar.closeMinute) return false;
  const nextDay = new Date(utcDay(start.day)! + 86_400_000).toISOString().slice(0, 10);
  const endingAtMidnight = calendar.closeMinute === 1440 && end.day === nextDay && exactMinute(end, endMs) === 0;
  if (!endingAtMidnight && (end.day !== start.day || exactMinute(end, endMs) > calendar.closeMinute)) return false;
  const startOffset = start.naive - Math.floor(startMs / 1000) * 1000;
  const endOffset = end.naive - Math.floor(endMs / 1000) * 1000;
  if (startOffset !== endOffset) {
    // Only transition-spanning intervals need the slower whole-interval check.
    for (let ms = startMs + minuteMs; ms < endMs; ms += minuteMs) {
      const local = localParts(ms, format);
      if (!local || local.day !== start.day || exactMinute(local, ms) < calendar.openMinute || exactMinute(local, ms) >= calendar.closeMinute) return false;
    }
  }
  return true;
}

function bookingContext(snapshot: CrmSnapshot, input: Omit<CrmBookingInput, 'scheduledAt'>, ignoreVisitId?: string) {
  const reasons: string[] = [];
  const calendar = clinicCalendar(snapshot);
  if (!calendar) reasons.push('Календарь клиники не настроен. Доступное время не рассчитывается.');
  const room = snapshot.rooms.slice(0, 100).find(row => row.id === input.roomId);
  const staff = snapshot.staff.slice(0, 200).find(row => row.id === input.staffId);
  const service = snapshot.services.slice(0, 200).find(row => row.id === input.serviceId);
  const patient = snapshot.patients.slice(0, 1000).find(row => row.id === input.patientId);
  if (!room || !staff || !service || !patient) reasons.push('Выберите существующие кабинет, сотрудника, услугу и пациента из снимка базы.');
  if (staff && room && staff.roomId !== room.id) reasons.push('Сотрудник не назначен в выбранный кабинет.');
  if (staff && staff.role !== 'doctor' && staff.role !== 'nurse') reasons.push('Запись на услугу доступна только к врачу или медсестре.');
  if (service && room && service.roomKind !== room.kind) reasons.push('Услуга не соответствует типу выбранного кабинета.');
  const existing = ignoreVisitId ? snapshot.visits.slice(0, 1000).find(row => row.id === ignoreVisitId) : undefined;
  if (ignoreVisitId && (!existing || !idsMatch(input, existing))) reasons.push('Ресурсы переноса не совпадают с сохранённым визитом. Обновите данные.');
  if (existing && existing.status !== 'scheduled') reasons.push('Перенос доступен только для запланированного визита.');
  const durationMinutes = existing ? visitDuration(snapshot, existing) : service && validDuration(service.durationMinutes) ? service.durationMinutes : null;
  const durationSource: CrmDurationSource = existing ? visitDurationSource(snapshot, existing) : durationMinutes === null ? 'missing' : 'frozen';
  if (durationMinutes === null) reasons.push('Длительность услуги не задана корректно.');
  const now = isoMs(snapshot.generatedAt);
  if (now === null) reasons.push('Время снимка базы некорректно. Обновите данные.');
  const services = durationMap(snapshot);
  const related = snapshot.visits.slice(0, 1000).filter(visit => activeVisit(visit) && visit.id !== ignoreVisitId && sharedResource(input, visit))
    .map(visit => ({ visit, interval: intervalFrom(visit, services) }));
  return { calendar, format: calendar ? formatter(calendar.timeZone) : null, durationMinutes, durationSource, now, reasons, related, existing };
}
function availabilityFrom(context: ReturnType<typeof bookingContext>, scheduledAt: string): CrmBookingAvailability {
  const reasons = [...context.reasons], conflictVisitIds: string[] = [];
  const startMs = isoMs(scheduledAt);
  if (startMs === null) reasons.push('Выберите корректную дату и время клиники.');
  if (startMs !== null && (startMs < Date.UTC(2020, 0, 1) || startMs >= Date.UTC(2100, 0, 1))) reasons.push('Дата записи должна быть в допустимом диапазоне 2020–2099.');
  if (context.existing?.scheduledAt === scheduledAt) reasons.push('Для переноса выберите другое время, отличное от сохранённого.');
  if (startMs !== null && context.now !== null && startMs <= context.now) reasons.push('Для записи требуется время после времени снимка базы.');
  if (startMs !== null && context.durationMinutes !== null) {
    const interval = { startMs, endMs: startMs + context.durationMinutes * minuteMs };
    if (context.calendar && context.format && !withinCalendar(interval.startMs, interval.endMs, context.calendar, context.format)) reasons.push('Весь визит должен помещаться в рабочий день календаря клиники.');
    for (const row of context.related) {
      if (!row.interval) reasons.push('Есть связанная активная запись без корректной длительности или времени. Обновите данные.');
      else if (intervalsOverlap(interval, row.interval)) conflictVisitIds.push(row.visit.id);
    }
    if (conflictVisitIds.length) reasons.push('Этот интервал пересекается с активной записью кабинета, сотрудника или пациента.');
  }
  return { available: reasons.length === 0, reasons: [...new Set(reasons)], conflictVisitIds,
    durationMinutes: context.durationMinutes, durationSource: context.durationSource };
}
/** Advisory projection only. The fresh server transaction is the booking authority. */
export function bookingAvailability(snapshot: CrmSnapshot, input: CrmBookingInput, ignoreVisitId?: string): CrmBookingAvailability {
  return availabilityFrom(bookingContext(snapshot, input, ignoreVisitId), input.scheduledAt);
}
export function availableSlots(snapshot: CrmSnapshot, input: CrmSlotInput, ignoreVisitId?: string): CrmAvailableSlot[] {
  const context = bookingContext(snapshot, input, ignoreVisitId);
  if (context.reasons.length || !context.calendar || !context.format || context.durationMinutes === null || utcDay(input.day) === null) return [];
  const weekday = new Date(utcDay(input.day)!).getUTCDay() || 7;
  if (!context.calendar.weekdays.includes(weekday)) return [];
  const slots: CrmAvailableSlot[] = [];
  for (let minute = Math.ceil(context.calendar.openMinute / 10) * 10; minute + context.durationMinutes <= context.calendar.closeMinute; minute += 10) {
    const timeLabel = `${String(Math.floor(minute / 60)).padStart(2, '0')}:${String(minute % 60).padStart(2, '0')}`;
    const scheduledAt = localTimeToIso(input.day, timeLabel, context.format);
    if (!scheduledAt) continue;
    const result = availabilityFrom(context, scheduledAt);
    slots.push({ scheduledAt, timeLabel, available: result.available, reasons: result.reasons });
  }
  return slots;
}

export function queueTimeSource(visit: CrmVisit): 'queuedAt' | 'legacy_updatedAt' {
  return isoMs((visit as TimedVisit).queuedAt) === null ? 'legacy_updatedAt' : 'queuedAt';
}
function queueMs(visit: CrmVisit) { return isoMs((visit as TimedVisit).queuedAt) ?? isoMs(visit.updatedAt); }
function queueOrder(visit: CrmVisit): number | null {
  const order = (visit as TimedVisit).queueOrder;
  return Number.isSafeInteger(order) && Number(order) > 0 ? Number(order) : null;
}
export function queueOrderSource(visit: CrmVisit): 'audit_sequence' | 'legacy_queue_time' {
  return queueOrder(visit) === null ? 'legacy_queue_time' : 'audit_sequence';
}
export function queueVisits(snapshot: CrmSnapshot): CrmVisit[] {
  return snapshot.visits.slice(0, 1000).filter(visit => visit.status === 'queued').sort((a, b) => {
    const left = queueOrder(a), right = queueOrder(b);
    const order = left !== null && right !== null ? left - right : left !== null ? -1 : right !== null ? 1 : (queueMs(a) ?? Infinity) - (queueMs(b) ?? Infinity);
    return order || a.scheduledAt.localeCompare(b.scheduledAt) || a.id.localeCompare(b.id);
  });
}
export function waitingAge(snapshot: CrmSnapshot, visit: CrmVisit): number | null {
  if (visit.status !== 'queued' && visit.status !== 'called') return null;
  const now = isoMs(snapshot.generatedAt), queued = queueMs(visit);
  return now === null || queued === null || queued > now ? null : Math.floor((now - queued) / minuteMs);
}
/** Organisational FIFO/capacity hints, never clinical triage or an autonomous call. */
export function queueActionState(snapshot: CrmSnapshot, visit: CrmVisit, action: CrmVisitAction | string): { allowed: boolean; reason: string | null } {
  const denied = (reason: string) => ({ allowed: false, reason });
  if (!snapshot.capabilities.manage) return denied('Ваш доступ к CRM позволяет только просмотр.');
  const current = snapshot.visits.slice(0, 1000).find(row => row.id === visit.id);
  if (!current || current.version !== visit.version || current.status !== visit.status || !idsMatch(visit, current)) return denied('Состояние записи изменилось. Обновите данные.');
  if (!allowedCrmVisitActions(visit.status).includes(action as CrmVisitAction)) return denied('Действие недоступно на сохранённом этапе визита.');
  if (action === 'mark_no_show') {
    const scheduled = isoMs(visit.scheduledAt), now = isoMs(snapshot.generatedAt);
    if (scheduled === null || now === null || scheduled > now) return denied('Неявку можно отметить только после наступления времени запланированного визита.');
  }
  if (action === 'call' || action === 'start') {
    const reserved = snapshot.visits.slice(0, 1000).find(row => row.id !== visit.id && (row.status === 'called' || row.status === 'in_service') && sharedResource(visit, row));
    if (reserved) return denied('Кабинет, сотрудник или пациент уже занят вызванным визитом либо приёмом.');
  }
  if (action === 'call') {
    const queue = queueVisits(snapshot);
    if (queue.some(row => (row.roomId === visit.roomId || row.staffId === visit.staffId) && queueOrder(row) === null)) return denied('Порядок очереди прежних записей не подтверждён. Обновите данные.');
    if (queue.find(row => row.roomId === visit.roomId)?.id !== visit.id || queue.find(row => row.staffId === visit.staffId)?.id !== visit.id) return denied('Сначала вызовите первую запись очереди для этого кабинета и сотрудника.');
  }
  return { allowed: true, reason: null };
}
