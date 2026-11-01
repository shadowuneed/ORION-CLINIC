import { describe, expect, it } from 'vitest';
import type { CrmSnapshot, CrmVisit } from './contracts';
import { availableSlots, bookingAvailability, clinicCalendar, clinicDateTimeToIso, clinicDay, clinicMinute,
  CRM_AVAILABILITY_NOTICE, intervalsOverlap, queueActionState, queueOrderSource, queueTimeSource, queueVisits, visitBookingInterval,
  visitConflicts, visitDuration, visitDurationSource, waitingAge, type CrmCalendar } from './scheduling';

const now = '2026-10-05T03:00:00.000Z'; // Monday 08:00 in the explicitly configured test calendar.
const calendar: CrmCalendar = { timeZone: 'Asia/Almaty', weekdays: [1, 2, 3, 4, 5], openMinute: 540, closeMinute: 1080, source: 'synthetic_policy' };
function snapshot(): CrmSnapshot & { calendar?: CrmCalendar } {
  return { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'test-clinic', name: 'Искусственная клиника' }, calendar: { ...calendar, weekdays: [...calendar.weekdays] },
    rooms: [{ id: 'room-a', name: 'Тест А', kind: 'consultation', x: 0, y: 0, width: 5, depth: 4 },
      { id: 'room-b', name: 'Тест Б', kind: 'consultation', x: 6, y: 0, width: 5, depth: 4 }],
    staff: [{ id: 'staff-a', name: 'Тест А', role: 'doctor', roomId: 'room-a' }, { id: 'staff-b', name: 'Тест Б', role: 'doctor', roomId: 'room-b' }],
    patients: [{ id: 'patient-a', name: 'Искусственный А', mrn: 'SIM-01', sex: 'unknown' }, { id: 'patient-b', name: 'Искусственный Б', mrn: 'SIM-02', sex: 'unknown' }],
    services: [{ id: 'service-a', name: 'Учебная консультация', roomKind: 'consultation', durationMinutes: 30 }],
    visits: [], tasks: [], events: [], capabilities: { read: true, manage: true }, generatedAt: now };
}
function visit(overrides: Partial<CrmVisit> = {}): CrmVisit {
  return { id: 'visit-a', roomId: 'room-a', staffId: 'staff-a', patientId: 'patient-a', serviceId: 'service-a',
    status: 'scheduled', version: 1, queueOrder: 1, scheduledAt: '2026-10-05T05:00:00.000Z', updatedAt: now, ...overrides };
}
const input = { roomId: 'room-a', staffId: 'staff-a', patientId: 'patient-a', serviceId: 'service-a', scheduledAt: '2026-10-05T04:00:00.000Z' };

describe('CRM clinic calendar and strict local time', () => {
  it('uses the clinic IANA zone rather than the browser/UTC day', () => {
    expect(clinicDateTimeToIso('2026-10-05', '09:00', 'Asia/Almaty')).toBe('2026-10-05T04:00:00.000Z');
    expect(clinicDay('2026-10-04T16:00:00.000Z', 'Asia/Tokyo')).toBe('2026-10-05');
    expect(clinicMinute('2026-10-04T16:00:00.000Z', 'Asia/Tokyo')).toBe(60);
    expect(clinicDateTimeToIso('2026-10-05', '01:00', 'Asia/Tokyo')).toBe('2026-10-04T16:00:00.000Z');
  });
  it.each([['2026-02-29', '10:00'], ['2026-04-31', '10:00'], ['2026-10-05', '24:00'], ['2026-10-05', '9:00'], ['bad', '10:00']])('does not normalise an invalid date/time %s %s', (day, time) => {
    expect(clinicDateTimeToIso(day, time, 'UTC')).toBeNull();
  });
  it('rejects offset strings, unknown zones, nonexistent and ambiguous DST wall-clock minutes', () => {
    expect(clinicDateTimeToIso('2026-10-05', '10:00', '+05:00')).toBeNull();
    expect(clinicDateTimeToIso('2026-10-05', '10:00', 'No/Such_Zone')).toBeNull();
    expect(clinicDateTimeToIso('2026-03-29', '02:30', 'Europe/Paris')).toBeNull();
    expect(clinicDateTimeToIso('2026-10-25', '02:30', 'Europe/Paris')).toBeNull();
    expect(clinicDateTimeToIso('2026-03-29', '03:30', 'Europe/Paris')).toBe('2026-03-29T01:30:00.000Z');
    expect(clinicDay('2026-02-30T00:00:00.000Z', 'UTC')).toBeNull();
  });
  it('never invents hours for absent or malformed calendar metadata', () => {
    const data = snapshot(); delete data.calendar;
    expect(clinicCalendar(data)).toBeNull();
    expect(bookingAvailability(data, input)).toMatchObject({ available: false });
    expect(availableSlots(data, { ...input, day: '2026-10-05' })).toEqual([]);
    data.calendar = { ...calendar, weekdays: [1, 1] }; expect(clinicCalendar(data)).toBeNull();
    data.calendar = { ...calendar, openMinute: 1000, closeMinute: 900 }; expect(clinicCalendar(data)).toBeNull();
    data.calendar = { ...calendar, timeZone: 'No/Such_Zone' }; expect(clinicCalendar(data)).toBeNull();
  });
});

describe('CRM frozen half-open booking intervals', () => {
  it('uses a frozen visit duration even after the service catalogue changes', () => {
    const data = snapshot(), row = visit({ durationMinutes: 90, bookingSource: 'booking' });
    data.services[0].durationMinutes = 20;
    expect(visitDuration(data, row)).toBe(90); expect(visitDurationSource(data, row)).toBe('frozen');
    expect(visitBookingInterval(data, row)).toMatchObject({ durationMinutes: 90, startMs: Date.parse(row.scheduledAt), endMs: Date.parse(row.scheduledAt) + 90 * 60000 });
  });
  it('labels the optional legacy fallback explicitly and fails closed on a present invalid frozen duration', () => {
    const data = snapshot(), row = visit();
    expect(visitDuration(data, row)).toBe(30); expect(visitDurationSource(data, row)).toBe('legacy_catalogue');
    expect(visitDuration(data, visit({ durationMinutes: 0 }))).toBeNull();
    data.services = []; expect(visitDurationSource(data, row)).toBe('missing');
  });
  it('allows adjacent intervals but detects one minute of overlap', () => {
    expect(intervalsOverlap({ startMs: 0, endMs: 30 }, { startMs: 30, endMs: 60 })).toBe(false);
    expect(intervalsOverlap({ startMs: 0, endMs: 31 }, { startMs: 30, endMs: 60 })).toBe(true);
    const data = snapshot(); data.visits = [visit({ scheduledAt: '2026-10-05T04:30:00.000Z', durationMinutes: 30 })];
    expect(bookingAvailability(data, input).available).toBe(true);
    expect(bookingAvailability(data, { ...input, scheduledAt: '2026-10-05T04:01:00.000Z' }).conflictVisitIds).toEqual(['visit-a']);
  });
  it.each(['roomId', 'staffId', 'patientId'] as const)('protects the %s resource, even when the other resources differ', resource => {
    const data = snapshot();
    const other = visit({ id: 'other', roomId: 'room-b', staffId: 'staff-b', patientId: 'patient-b', scheduledAt: input.scheduledAt, durationMinutes: 30 });
    other[resource] = input[resource]; data.visits = [other];
    expect(bookingAvailability(data, input)).toMatchObject({ available: false, conflictVisitIds: ['other'] });
  });
  it.each(['completed', 'cancelled', 'no_show'] as const)('releases interval capacity for terminal stage %s', status => {
    const data = snapshot(); data.visits = [visit({ status, scheduledAt: input.scheduledAt, durationMinutes: 30 })];
    expect(bookingAvailability(data, input).available).toBe(true);
    expect(visitConflicts(data, data.visits[0])).toEqual({ conflictVisitIds: [], reasons: [] });
  });
  it('retains and reports existing conflicts independently of policy hours, with the stored duration', () => {
    const data = snapshot(); delete data.calendar;
    data.visits = [visit({ scheduledAt: '2026-10-05T00:00:00.000Z', durationMinutes: 90 }), visit({ id: 'other', scheduledAt: '2026-10-05T01:00:00.000Z', durationMinutes: 30 })];
    expect(visitConflicts(data, data.visits[0]).conflictVisitIds).toEqual(['other']);
    expect(data.visits).toHaveLength(2);
  });
  it('does not declare a resource free when a related active interval cannot be determined', () => {
    const data = snapshot(); data.visits = [visit({ durationMinutes: 0 })];
    expect(bookingAvailability(data, input).available).toBe(false);
    expect(bookingAvailability(data, input).reasons.join(' ')).toContain('длительности');
  });
  it('rescheduling excludes only the exact existing visit and preserves its frozen duration', () => {
    const data = snapshot(); data.visits = [visit({ durationMinutes: 90 })];
    const result = bookingAvailability(data, input, 'visit-a');
    expect(result).toMatchObject({ available: true, durationMinutes: 90, durationSource: 'frozen' });
    expect(bookingAvailability(data, { ...input, scheduledAt: data.visits[0].scheduledAt }, 'visit-a').reasons.join(' ')).toContain('другое время');
    expect(bookingAvailability(data, { ...input, patientId: 'patient-b' }, 'visit-a').available).toBe(false);
    expect(bookingAvailability(data, input, 'missing').available).toBe(false);
    data.visits[0].status = 'arrived'; expect(bookingAvailability(data, input, 'visit-a').available).toBe(false);
  });
});

describe('CRM advisory availability slots', () => {
  it('requires the entire service interval inside the configured weekday/hours', () => {
    const data = snapshot();
    expect(bookingAvailability(data, { ...input, scheduledAt: '2026-10-05T12:30:00.000Z' }).available).toBe(true); // 17:30→18:00
    expect(bookingAvailability(data, { ...input, scheduledAt: '2026-10-05T12:40:00.000Z' }).available).toBe(false);
    expect(bookingAvailability(data, { ...input, scheduledAt: '2026-10-05T03:50:00.000Z' }).available).toBe(false);
    expect(bookingAvailability(data, { ...input, scheduledAt: '2026-10-10T04:00:00.000Z' }).available).toBe(false);
    expect(availableSlots(data, { ...input, day: '2026-10-10' })).toEqual([]);
  });
  it('allows an exclusive end at midnight only for a closeMinute=1440 policy', () => {
    const data = snapshot(); data.calendar = { ...calendar, timeZone: 'UTC', openMinute: 1380, closeMinute: 1440 };
    expect(bookingAvailability(data, { ...input, scheduledAt: '2026-10-05T23:30:00.000Z' }).available).toBe(true);
    expect(bookingAvailability(data, { ...input, scheduledAt: '2026-10-05T23:40:00.000Z' }).available).toBe(false);
  });
  it('makes ten-minute candidates with disabled past/conflicted choices, not invented success', () => {
    const data = snapshot(); data.generatedAt = '2026-10-05T04:05:00.000Z';
    data.visits = [visit({ durationMinutes: 30 })];
    const slots = availableSlots(data, { ...input, day: '2026-10-05' });
    expect(slots).toHaveLength(52);
    expect(slots[0]).toMatchObject({ timeLabel: '09:00', available: false });
    expect(slots[1]).toMatchObject({ timeLabel: '09:10', available: true });
    expect(slots.find(slot => slot.timeLabel === '09:30')?.available).toBe(true);
    expect(slots.find(slot => slot.timeLabel === '09:40')?.available).toBe(false);
    expect(slots.at(-1)?.timeLabel).toBe('17:30');
    expect(CRM_AVAILABILITY_NOTICE).toContain('сервер повторно проверит');
    expect(bookingAvailability(data, { ...input, scheduledAt: data.generatedAt }).available).toBe(false);
  });
  it('does not offer slots for incompatible staff/rooms, services or missing records', () => {
    const data = snapshot();
    expect(availableSlots(data, { ...input, staffId: 'staff-b', day: '2026-10-05' })).toEqual([]);
    expect(bookingAvailability(data, { ...input, staffId: 'staff-b' }).reasons.join(' ')).toContain('не назначен');
    data.staff[0].role = 'support'; expect(bookingAvailability(data, input).reasons.join(' ')).toContain('врачу или медсестре');
    data.staff[0].role = 'doctor';
    data.rooms[0].kind = 'diagnostics'; expect(bookingAvailability(data, input).reasons.join(' ')).toContain('не соответствует');
    expect(availableSlots(data, { ...input, patientId: 'missing', day: '2026-10-05' })).toEqual([]);
  });
  it('does not promise a date outside the server-supported booking range', () => {
    expect(bookingAvailability(snapshot(), { ...input, scheduledAt: '2100-01-04T04:00:00.000Z' }).reasons.join(' ')).toContain('2020–2099');
  });
  it('shows why a concurrent fresh snapshot can invalidate an earlier candidate without mutating the old snapshot', () => {
    const data = snapshot(), before = JSON.stringify(data);
    expect(bookingAvailability(data, input).available).toBe(true);
    const fresh = { ...data, visits: [visit({ scheduledAt: input.scheduledAt, durationMinutes: 30 })] };
    expect(bookingAvailability(fresh, input).available).toBe(false);
    expect(JSON.stringify(data)).toBe(before);
  });
  it('bounds a full-day grid at 144 candidates and evaluates a complete 1000-visit snapshot', () => {
    const data = snapshot(); data.calendar = { ...calendar, timeZone: 'UTC', openMinute: 0, closeMinute: 1440 };
    data.services[0].durationMinutes = 5;
    data.visits = Array.from({ length: 1000 }, (_, index) => visit({ id: `visit-${index}`, durationMinutes: 5 }));
    const slots = availableSlots(data, { ...input, day: '2026-10-05' });
    expect(slots).toHaveLength(144);
    expect(slots.find(slot => slot.timeLabel === '05:00')?.available).toBe(false);
  });
});

describe('CRM FIFO queue and saved-clock action hints', () => {
  it('orders by immutable latest-queue sequence despite clock skew, with appointment/id ties and an explicit legacy source', () => {
    const data = snapshot();
    data.visits = [visit({ id: 'later', status: 'queued', queueOrder: 200, queuedAt: '2026-10-05T02:00:00.000Z', scheduledAt: '2026-10-05T02:00:00.000Z' }),
      visit({ id: 'early', status: 'queued', queueOrder: 100, queuedAt: '2026-10-05T02:40:00.000Z', scheduledAt: '2026-10-05T05:00:00.000Z' }), visit({ id: 'called', status: 'called' })];
    expect(queueVisits(data).map(row => row.id)).toEqual(['early', 'later']);
    data.visits[1].queuedAt = '2026-10-05T02:55:00.000Z'; // Explicit server-side requeue goes to the end.
    data.visits[1].queueOrder = 300;
    expect(queueVisits(data).map(row => row.id)).toEqual(['later', 'early']);
    expect(queueTimeSource(data.visits[0])).toBe('queuedAt');
    expect(queueOrderSource(data.visits[0])).toBe('audit_sequence');
    expect(queueTimeSource(visit({ status: 'queued' }))).toBe('legacy_updatedAt');
    data.visits = [visit({ id: 'z', status: 'queued' }), visit({ id: 'a', status: 'queued' })];
    expect(queueVisits(data).map(row => row.id)).toEqual(['a', 'z']);
  });
  it('allows only the FIFO head for both the assigned room and staff, not appointment-time priority', () => {
    const data = snapshot();
    const first = visit({ id: 'first', status: 'queued', queueOrder: 100, queuedAt: '2026-10-05T02:40:00.000Z' });
    const second = visit({ id: 'second', status: 'queued', queueOrder: 200, queuedAt: '2026-10-05T02:50:00.000Z', patientId: 'patient-b' });
    data.visits = [second, first];
    expect(queueActionState(data, first, 'call').allowed).toBe(true);
    expect(queueActionState(data, second, 'call')).toMatchObject({ allowed: false });
    first.roomId = 'room-b'; // Same staff FIFO still blocks the later record.
    expect(queueActionState(data, second, 'call').allowed).toBe(false);
    first.roomId = 'room-a'; first.staffId = 'staff-b'; // Same room FIFO still blocks it.
    expect(queueActionState(data, second, 'call').allowed).toBe(false);
  });
  it.each(['roomId', 'staffId', 'patientId'] as const)('called/in-service reservations lock the %s until an explicit release', resource => {
    const data = snapshot(); const queued = visit({ status: 'queued', queuedAt: '2026-10-05T02:40:00.000Z' });
    const reserved = visit({ id: 'reserved', status: 'called', roomId: 'room-b', staffId: 'staff-b', patientId: 'patient-b' });
    reserved[resource] = queued[resource]; data.visits = [queued, reserved];
    expect(queueActionState(data, queued, 'call').allowed).toBe(false);
    reserved.status = 'in_service'; expect(queueActionState(data, queued, 'call').allowed).toBe(false);
    reserved.status = 'completed'; expect(queueActionState(data, queued, 'call').allowed).toBe(true);
  });
  it('starts only a called visit, supports explicit requeue and leaves no-show to scheduled records whose time has come', () => {
    const data = snapshot(); const row = visit({ status: 'queued' }); data.visits = [row];
    expect(queueActionState(data, row, 'start').allowed).toBe(false);
    row.status = 'called'; expect(queueActionState(data, row, 'start').allowed).toBe(true);
    expect(queueActionState(data, row, 'requeue').allowed).toBe(true);
    expect(queueActionState(data, row, 'mark_no_show').allowed).toBe(false);
    row.status = 'scheduled'; expect(queueActionState(data, row, 'mark_no_show').allowed).toBe(false);
    row.scheduledAt = now; expect(queueActionState(data, row, 'mark_no_show').allowed).toBe(true);
  });
  it('gives readonly/stale/invalid action denial reasons without producing a command or changing a record', () => {
    const data = snapshot(); const row = visit({ status: 'queued' }); data.visits = [row]; const before = JSON.stringify(data);
    expect(queueActionState(data, { ...row, version: 2 }, 'call').reason).toContain('изменилось');
    expect(queueActionState(data, row, 'automatic')).toMatchObject({ allowed: false });
    expect(JSON.stringify(data)).toBe(before);
    data.capabilities.manage = false; expect(queueActionState(data, row, 'call').reason).toContain('просмотр');
  });
  it('uses legacy time only for display and denies calling until related canonical order is known', () => {
    const data = snapshot();
    const row = visit({ status: 'queued', queueOrder: null, queuedAt: null, updatedAt: '2026-10-05T02:40:00.000Z' });
    data.visits = [row];
    expect(queueOrderSource(row)).toBe('legacy_queue_time');
    expect(queueVisits(data)).toEqual([row]);
    expect(queueActionState(data, row, 'call').reason).toContain('не подтверждён');
    const canonical = visit({ id: 'canonical', status: 'queued', queueOrder: 10 }); data.visits.push(canonical);
    expect(queueActionState(data, canonical, 'call').allowed).toBe(false);
  });
  it('calculates wait minutes only from the snapshot clock, with honest absent/future metadata states', () => {
    const data = snapshot(); const row = visit({ status: 'queued', queuedAt: '2026-10-05T02:45:00.000Z' });
    expect(waitingAge(data, row)).toBe(15);
    expect(waitingAge(data, { ...row, status: 'called' })).toBe(15);
    expect(waitingAge(data, { ...row, status: 'completed' })).toBeNull();
    expect(waitingAge(data, { ...row, queuedAt: '2026-10-05T03:01:00.000Z' })).toBeNull();
    expect(waitingAge(data, visit({ status: 'queued', updatedAt: '2026-10-05T02:50:00.000Z' }))).toBe(10);
  });
});
