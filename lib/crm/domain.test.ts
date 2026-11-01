import { describe, expect, it } from 'vitest';
import { crmCommandSchema, crmSnapshotSchema, type CrmSnapshot } from './contracts';
import { allowedCrmTaskActions, allowedCrmVisitActions, canRescheduleCrmVisit, nextCrmTaskStatus, nextCrmVisitStatus } from './domain';

const time = '2026-10-06T08:00:00.000Z';
function snapshot(): CrmSnapshot {
  return {
    schemaVersion: 1, mode: 'synthetic_simulation', clinic: { id: 'clinic-a', name: 'Test clinic' },
    generatedAt: time, capabilities: { read: true, manage: true },
    rooms: [{ id: 'room-a', name: 'Room', kind: 'consultation', x: 0, y: 0, width: 4, depth: 4 }],
    staff: [{ id: 'staff-a', name: 'Test staff', role: 'doctor', roomId: 'room-a' }],
    services: [{ id: 'service-a', name: 'Test consultation', durationMinutes: 30, roomKind: 'consultation' }],
    patients: [{ id: 'patient-a', name: 'Test patient', mrn: 'CRM-TEST-0001', sex: 'unknown' }],
    visits: [{ id: 'visit-a', patientId: 'patient-a', staffId: 'staff-a', roomId: 'room-a',
      serviceId: 'service-a', scheduledAt: time, status: 'scheduled', version: 1, updatedAt: time }],
    tasks: [{ id: 'task-a', visitId: 'visit-a', patientId: 'patient-a', ownerId: 'staff-a',
      kind: 'preparation', title: 'Test preparation', priority: 'routine', dueAt: time, status: 'pending', version: 1 }], events: [],
  };
}
describe('CRM simulation domain', () => {
  it('requires every explicit arrival/queue/service step', () => {
    expect(nextCrmVisitStatus('scheduled', 'arrive')).toBe('arrived');
    expect(nextCrmVisitStatus('arrived', 'queue')).toBe('queued');
    expect(nextCrmVisitStatus('queued', 'call')).toBe('called');
    expect(nextCrmVisitStatus('called', 'start')).toBe('in_service');
    expect(nextCrmVisitStatus('called', 'requeue')).toBe('queued');
    expect(nextCrmVisitStatus('queued', 'start')).toBeNull();
    expect(nextCrmVisitStatus('in_service', 'complete')).toBe('completed');
    expect(nextCrmVisitStatus('scheduled', 'start')).toBeNull();
    expect(nextCrmVisitStatus('arrived', 'complete')).toBeNull();
    expect(nextCrmVisitStatus('in_service', 'cancel')).toBeNull();
  });
  it.each(['completed', 'cancelled', 'no_show'] as const)('has no automatic restart from terminal visit %s', status => {
    expect(allowedCrmVisitActions(status)).toEqual([]);
    expect(nextCrmVisitStatus(status, 'arrive')).toBeNull();
  });
  it('escalation requires explicit manual review before continuing a task', () => {
    expect(allowedCrmTaskActions('pending')).toEqual(['start', 'escalate']);
    expect(nextCrmTaskStatus('pending', 'complete')).toBeNull();
    expect(nextCrmTaskStatus('pending', 'escalate')).toBe('escalated');
    expect(nextCrmTaskStatus('in_progress', 'complete')).toBe('completed');
    expect(allowedCrmTaskActions('escalated')).toEqual(['start']);
    expect(nextCrmTaskStatus('escalated', 'start')).toBe('in_progress');
    expect(nextCrmTaskStatus('escalated', 'complete')).toBeNull();
    expect(allowedCrmTaskActions('completed')).toEqual([]);
  });
  it('accepts complete related snapshots and truly empty datasets', () => {
    expect(crmSnapshotSchema.safeParse(snapshot()).success).toBe(true);
    const empty = { ...snapshot(), rooms: [], staff: [], services: [], patients: [], visits: [], tasks: [] };
    expect(crmSnapshotSchema.safeParse(empty).success).toBe(true);
  });
  it.each(['patientId', 'roomId', 'staffId', 'serviceId'] as const)('rejects an orphan visit %s', key => {
    const data = snapshot(); data.visits[0][key] = 'missing';
    expect(crmSnapshotSchema.safeParse(data).success).toBe(false);
  });
  it('rejects patient mixing in linked tasks and duplicate entity IDs', () => {
    const data = snapshot(); data.tasks[0].patientId = 'another-patient';
    expect(crmSnapshotSchema.safeParse(data).success).toBe(false);
    const duplicated = snapshot(); duplicated.rooms.push(duplicated.rooms[0]);
    expect(crmSnapshotSchema.safeParse(duplicated).success).toBe(false);
  });
  it('rejects fake production mode, unexpected provider fields and unbounded events', () => {
    expect(crmSnapshotSchema.safeParse({ ...snapshot(), mode: 'production' }).success).toBe(false);
    expect(crmSnapshotSchema.safeParse({ ...snapshot(), serviceRoleKey: 'unexpected' }).success).toBe(false);
    const data = snapshot(); data.events = Array.from({ length: 51 }, (_, i) => ({
      id: `event-${i}`, resourceId: 'visit-a', kind: 'visit.created', actorLabel: 'Test', createdAt: time,
      fromStatus: null, toStatus: 'scheduled',
    }));
    expect(crmSnapshotSchema.safeParse(data).success).toBe(false);
  });
  it('rejects missing synthetic acknowledgment and caller-supplied status/actor', () => {
    const command = { type: 'visit.transition', visitId: 'visit-a', expectedVersion: 1, action: 'arrive',
      idempotencyKey: '11111111-1111-4111-8111-111111111111', testDataAcknowledged: true };
    expect(crmCommandSchema.safeParse(command).success).toBe(true);
    expect(crmCommandSchema.safeParse({ ...command, testDataAcknowledged: false }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ ...command, actorId: 'doctor' }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ ...command, status: 'completed' }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ ...command, expectedVersion: 0 }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ ...command, action: 'sign' }).success).toBe(false);
  });
  it('accepts strict linked task creation without caller-selected patient or status', () => {
    const command = { type: 'task.create', visitId: 'visit-a', ownerId: 'staff-a', kind: 'follow_up',
      title: 'Проверить учебную задачу', priority: 'urgent', dueAt: time, testDataAcknowledged: true,
      idempotencyKey: '11111111-1111-4111-8111-111111111111' };
    expect(crmCommandSchema.safeParse(command).success).toBe(true);
    for (const extra of [{ patientId: 'patient-a' }, { status: 'completed' }, { role: 'doctor' }]) {
      expect(crmCommandSchema.safeParse({ ...command, ...extra }).success).toBe(false);
    }
    expect(crmCommandSchema.safeParse({ ...command, title: '  ' }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ ...command, title: 'line\nbreak' }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ ...command, priority: 'critical' }).success).toBe(false);
  });
  it('allows rescheduling only a scheduled visit using strict ISO milliseconds', () => {
    expect(canRescheduleCrmVisit('scheduled')).toBe(true);
    for (const status of ['arrived', 'queued', 'called', 'in_service', 'completed', 'cancelled', 'no_show'] as const) expect(canRescheduleCrmVisit(status)).toBe(false);
    const command = { type: 'visit.reschedule', visitId: 'visit-a', expectedVersion: 1,
      scheduledAt: time, testDataAcknowledged: true, idempotencyKey: '11111111-1111-4111-8111-111111111111' };
    expect(crmCommandSchema.safeParse(command).success).toBe(true);
    expect(crmCommandSchema.safeParse({ ...command, scheduledAt: '2026-10-06T08:00' }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ ...command, expectedVersion: 0 }).success).toBe(false);
    expect(crmCommandSchema.safeParse({ ...command, action: 'arrive' }).success).toBe(false);
  });
  it('accepts actual booking provenance/timestamps while retaining old synthetic fixture compatibility', () => {
    const data = snapshot();
    data.calendar = { timeZone: 'Asia/Qyzylorda', weekdays: [1, 2, 3, 4, 5], openMinute: 540, closeMinute: 1080, source: 'synthetic_policy' };
    Object.assign(data.visits[0], { durationMinutes: 30, bookingSource: 'booking', arrivedAt: null, queuedAt: null,
      calledAt: null, startedAt: null, completedAt: null });
    expect(crmSnapshotSchema.safeParse(data).success).toBe(true);
    expect(crmSnapshotSchema.safeParse({ ...data, calendar: { ...data.calendar, closeMinute: 500 } }).success).toBe(false);
    expect(crmSnapshotSchema.safeParse({ ...data, calendar: { ...data.calendar, weekdays: [1, 1] } }).success).toBe(false);
  });
});
