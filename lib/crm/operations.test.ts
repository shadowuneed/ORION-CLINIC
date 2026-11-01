import { describe, expect, it } from 'vitest';
import type { CrmSnapshot, CrmVisitStatus } from './contracts';
import { crmCalendarDay, crmDailyVisits, crmDeviceDateToIso, crmOperationsIndex, crmPatientRows, crmPriorities, crmRescheduleCommand,
  crmResourceRows, crmTaskCreateCommand, crmTaskRows } from './operations';

const now = '2026-10-06T07:00:00.000Z';
const key = '00000000-0000-4000-8000-000000000001';
function snapshot(): CrmSnapshot {
  return { schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'clinic-a', name: 'Искусственная клиника' }, generatedAt: now,
    rooms: [{ id: 'room-a', name: 'Кабинет консультации', kind: 'consultation', x: 0, y: 0, width: 5, depth: 4 },
      { id: 'room-b', name: 'Диагностика', kind: 'diagnostics', x: 6, y: 0, width: 5, depth: 4 }],
    staff: [{ id: 'staff-a', name: 'Искусственный врач', role: 'doctor', roomId: 'room-a' }, { id: 'staff-b', name: 'Искусственная медсестра', role: 'nurse', roomId: 'room-b' }],
    services: [{ id: 'service-a', name: 'Консультация симуляции', durationMinutes: 20, roomKind: 'consultation' }],
    patients: [{ id: 'patient-a', name: 'Анна Тестовая', mrn: 'SIM-01', sex: 'female' }, { id: 'patient-no-visits', name: 'Борис Безвизитный', mrn: 'SIM-02', sex: 'male' }],
    visits: [{ id: 'visit-a', patientId: 'patient-a', staffId: 'staff-a', roomId: 'room-a', serviceId: 'service-a', status: 'queued', version: 3, scheduledAt: '2026-10-06T00:30:00.000Z', updatedAt: now }],
    tasks: [{ id: 'task-a', visitId: 'visit-a', patientId: 'patient-a', ownerId: 'staff-b', kind: 'preparation', title: 'Подготовить кабинет', status: 'pending', priority: 'routine', dueAt: '2026-10-06T06:00:00.000Z', version: 1 }],
    events: [], capabilities: { read: true, manage: true } };
}

describe('CRM operations date and search projections', () => {
  it('assigns a UTC-midnight record to the correct explicitly selected calendar zone', () => {
    expect(crmCalendarDay('2026-10-06T00:30:00.000Z', 'America/New_York')).toBe('2026-10-05');
    expect(crmCalendarDay('2026-10-05T21:30:00.000Z', 'Asia/Almaty')).toBe('2026-10-06');
    const data = snapshot();
    expect(crmDailyVisits(data, '2026-10-05', 'America/New_York')).toHaveLength(1);
    expect(crmDailyVisits(data, '2026-10-06', 'America/New_York')).toEqual([]);
  });
  it('matches names, MRN, service and room literally, and keeps terminal visits accessible', () => {
    const data = snapshot(); data.visits[0].status = 'cancelled';
    expect(crmDailyVisits(data, '', 'UTC', 'sim-01', 'cancelled')).toHaveLength(1);
    expect(crmDailyVisits(data, '', 'UTC', 'ИСКУССТВЕННЫЙ ВРАЧ')).toHaveLength(1);
    expect(crmDailyVisits(data, '', 'UTC', 'консультации')).toHaveLength(1);
    expect(crmDailyVisits(data, '', 'UTC', '%')).toEqual([]);
    expect(crmDailyVisits(data, '', 'UTC', '', 'queued')).toEqual([]);
  });
  it('orders schedule records by time and stable ID without mutating the snapshot', () => {
    const data = snapshot(); data.visits.push({ ...data.visits[0], id: 'visit-earlier', scheduledAt: '2026-10-05T23:00:00.000Z' });
    expect(crmDailyVisits(data, '', 'UTC').map(row => row.id)).toEqual(['visit-earlier', 'visit-a']);
    expect(data.visits[0].id).toBe('visit-a');
  });
  it('filters tasks by their own owner/status and searches linked patient data', () => {
    const data = snapshot(); data.tasks.push({ ...data.tasks[0], id: 'task-urgent', priority: 'urgent', status: 'escalated', dueAt: '2026-10-07T07:00:00.000Z' });
    expect(crmTaskRows(data).map(row => row.id)).toEqual(['task-urgent', 'task-a']);
    expect(crmTaskRows(data, 'SIM-01', 'escalated', 'staff-b').map(row => row.id)).toEqual(['task-urgent']);
    expect(crmTaskRows(data, '', 'all', 'staff-a')).toEqual([]);
  });
  it('retains a searchable patient with no visits, and separates total/active visits from open tasks', () => {
    const data = snapshot(); data.visits.push({ ...data.visits[0], id: 'visit-completed', status: 'completed', scheduledAt: '2026-10-07T07:00:00.000Z' });
    data.tasks.push({ ...data.tasks[0], id: 'task-completed', status: 'completed' });
    const rows = crmPatientRows(data);
    expect(rows.find(row => row.patient.id === 'patient-a')).toMatchObject({ activeVisits: 1, openTasks: 1, latestVisit: { id: 'visit-completed' } });
    expect(crmPatientRows(data, 'SIM-02', 'male')[0]).toMatchObject({ patient: { id: 'patient-no-visits' }, visits: [], latestVisit: null, openTasks: 0 });
    expect(crmPatientRows(data, 'БОРИС', 'female')).toEqual([]);
  });
  it('reuses a grouped snapshot index across searches without changing its grouped source arrays', () => {
    const data = snapshot(); const index = crmOperationsIndex(data);
    expect(index.patientVisits.get('patient-a')?.map(visit => visit.id)).toEqual(['visit-a']);
    expect(index.patientTasks.get('patient-a')?.map(task => task.id)).toEqual(['task-a']);
    expect(index.staffTasks.get('staff-a')).toBeUndefined();
    expect(crmPatientRows(data, 'SIM-01', 'all', index)[0].activeVisits).toBe(1);
    expect(crmResourceRows(data, 'консультация', index).services[0].active).toBe(1);
    expect(index.patientVisits.get('patient-a')?.[0]).toBe(data.visits[0]);
  });
});

describe('CRM saved priorities and resources', () => {
  it('calculates overdue against the snapshot clock, excludes completed tasks and sorts bounded feed honestly', () => {
    const data = snapshot();
    data.tasks.push({ ...data.tasks[0], id: 'done-overdue', status: 'completed', priority: 'urgent' }, { ...data.tasks[0], id: 'at-deadline', dueAt: now, status: 'escalated', priority: 'urgent' });
    data.events.push({ id: 'event-old', resourceId: 'visit-a', kind: 'visit.created', actorLabel: 'Тест', createdAt: '2026-10-05T07:00:00.000Z', fromStatus: null, toStatus: 'scheduled' }, { id: 'event-new', resourceId: 'visit-a', kind: 'visit.rescheduled', actorLabel: 'Тест', createdAt: now, fromStatus: 'scheduled', toStatus: 'scheduled' });
    const priorities = crmPriorities(data);
    expect(priorities.overdue.map(row => row.id)).toEqual(['task-a']);
    expect(priorities.urgent.map(row => row.id)).toEqual(['at-deadline']);
    expect(priorities.escalated.map(row => row.id)).toEqual(['at-deadline']);
    expect(priorities.events.map(row => row.id)).toEqual(['event-new', 'event-old']);
    expect(data.events[0].id).toBe('event-old');
  });
  it('counts current room use and linked staff tasks without implying staff location or a real free slot', () => {
    const data = snapshot(); data.visits[0].status = 'in_service';
    const rows = crmResourceRows(data);
    expect(rows.rooms[0]).toMatchObject({ active: 1, inService: 1 });
    expect(rows.rooms[1]).toMatchObject({ active: 0, inService: 0 });
    expect(rows.staff[0]).toMatchObject({ activeVisits: 1, openTasks: 0 });
    expect(rows.staff[1]).toMatchObject({ activeVisits: 0, openTasks: 1 });
    expect(rows.services[0]).toMatchObject({ visits: 1, active: 1 });
    expect(rows.services[0].rooms.map(row => row.id)).toEqual(['room-a']);
    expect(crmResourceRows(data, 'медсестра').staff.map(row => row.person.id)).toEqual(['staff-b']);
  });
  it('returns actual emptiness for an empty simulation rather than fallback resources', () => {
    const data = snapshot(); data.rooms = []; data.staff = []; data.services = []; data.patients = []; data.visits = []; data.tasks = [];
    expect(crmPatientRows(data)).toEqual([]); expect(crmResourceRows(data)).toEqual({ rooms: [], staff: [], services: [] });
    expect(crmPriorities(data).upcoming).toEqual([]);
  });
});

describe('CRM explicit creation and rescheduling commands', () => {
  const draft = { visitId: 'visit-a', ownerId: 'staff-b', kind: 'follow_up', title: ' Повторный тестовый контакт ', priority: 'routine', dueAt: '2026-10-06T14:00' };
  it('converts device-local date to canonical milliseconds, trims title and carries the supplied retry key', () => {
    const command = crmTaskCreateCommand(draft, key);
    expect(command).toMatchObject({ type: 'task.create', visitId: 'visit-a', ownerId: 'staff-b', title: 'Повторный тестовый контакт', dueAt: new Date(draft.dueAt).toISOString(), testDataAcknowledged: true, idempotencyKey: key });
    expect(draft.title).toBe(' Повторный тестовый контакт ');
  });
  it.each(['2026-02-30T12:00', '2026-10-06', '2026-10-06T25:00', '', '2026-10-06T14:00Z'])('rejects invalid or timezone-bearing local input: %s', value => {
    expect(crmDeviceDateToIso(value)).toBeNull(); expect(crmTaskCreateCommand({ ...draft, dueAt: value }, key)).toBeNull();
  });
  it.each([{ title: '' }, { title: 'x'.repeat(241) }, { title: 'Строка\nс переносом' }, { ownerId: '' }, { kind: 'diagnosis' }, { priority: 'critical' }])('refuses a task outside the dedicated contract: %j', change => {
    expect(crmTaskCreateCommand({ ...draft, ...change }, key)).toBeNull();
  });
  it.each(['arrived', 'queued', 'in_service', 'completed', 'cancelled'] satisfies CrmVisitStatus[])('does not build a reschedule for %s', status => {
    expect(crmRescheduleCommand({ ...snapshot().visits[0], status }, '2026-10-07T12:00', key)).toBeNull();
  });
  it('pins exact current visit version and date without changing another field or the source record', () => {
    const visit = { ...snapshot().visits[0], status: 'scheduled' as const };
    expect(crmRescheduleCommand(visit, '2026-10-07T12:00', key)).toEqual({ type: 'visit.reschedule', visitId: visit.id, expectedVersion: 3, scheduledAt: new Date('2026-10-07T12:00').toISOString(), testDataAcknowledged: true, idempotencyKey: key });
    expect(visit.scheduledAt).toBe('2026-10-06T00:30:00.000Z');
  });
});
