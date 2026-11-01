import { z } from 'zod';

const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const name = z.string().min(1).max(160);
const time = z.iso.datetime({ precision: 3 });
const version = z.number().int().positive().max(2_147_483_647);
const taskTitle = z.string().min(1).max(240).refine(value => value.trim() === value && !/[\p{Cc}\p{Surrogate}]/u.test(value));
export const crmVisitStatuses = ['scheduled', 'arrived', 'queued', 'called', 'in_service', 'completed', 'cancelled', 'no_show'] as const;
export const crmTaskStatuses = ['pending', 'in_progress', 'completed', 'escalated'] as const;
export const crmVisitActions = ['arrive', 'queue', 'call', 'requeue', 'start', 'complete', 'cancel', 'mark_no_show'] as const;
export const crmTaskActions = ['start', 'complete', 'escalate'] as const;
export type CrmVisitStatus = typeof crmVisitStatuses[number];
export type CrmTaskStatus = typeof crmTaskStatuses[number];
export type CrmVisitAction = typeof crmVisitActions[number];
export type CrmTaskAction = typeof crmTaskActions[number];

export const crmRoomSchema = z.object({
  id, name, kind: z.enum(['reception', 'consultation', 'diagnostics', 'treatment', 'staff']),
  x: z.number().finite().min(0).max(100), y: z.number().finite().min(0).max(100),
  width: z.number().finite().positive().max(100), depth: z.number().finite().positive().max(100),
  buildingId: id.optional(),
}).strict();
export const crmBuildingSchema = z.object({
  id, name, x: z.number().finite().min(0).max(100), y: z.number().finite().min(0).max(100),
  width: z.number().finite().positive().max(100), depth: z.number().finite().positive().max(100),
}).strict();
export const crmStaffSchema = z.object({
  id, name, role: z.enum(['doctor', 'nurse', 'registrar', 'support']), roomId: id,
}).strict();
export const crmServiceSchema = z.object({
  id, name, durationMinutes: z.number().int().min(5).max(240), roomKind: crmRoomSchema.shape.kind,
}).strict();
export const crmPatientSchema = z.object({
  id, name, mrn: name, sex: z.enum(['female', 'male', 'unknown']),
  birthDate: z.iso.date().optional(), registrationSource: z.literal('manual_training').optional(),
}).strict();
export const crmVisitSchema = z.object({
  id, patientId: id, staffId: id, roomId: id, serviceId: id, scheduledAt: time,
  status: z.enum(crmVisitStatuses), version, updatedAt: time,
  durationMinutes: z.number().int().min(5).max(240).optional(),
  bookingSource: z.enum(['catalogue_backfill', 'booking']).optional(),
  queueOrder: z.number().int().positive().max(2_147_483_647).nullable().optional(),
  arrivedAt: time.nullable().optional(), queuedAt: time.nullable().optional(), calledAt: time.nullable().optional(),
  startedAt: time.nullable().optional(), completedAt: time.nullable().optional(),
}).strict();
export const crmCalendarSchema = z.object({
  timeZone: z.string().min(1).max(80), weekdays: z.array(z.number().int().min(1).max(7)).min(1).max(7),
  openMinute: z.number().int().min(0).max(1439), closeMinute: z.number().int().min(1).max(1440),
  source: z.literal('synthetic_policy'),
}).strict().refine(value => value.closeMinute > value.openMinute && new Set(value.weekdays).size === value.weekdays.length);
export const crmTaskSchema = z.object({
  id, visitId: id, patientId: id, ownerId: id, kind: z.enum(['preparation', 'follow_up', 'service']),
  title: taskTitle, priority: z.enum(['routine', 'urgent']), dueAt: time,
  status: z.enum(crmTaskStatuses), version,
}).strict();
export const crmEventSchema = z.object({
  id, resourceId: id, kind: z.enum(['visit.created', 'visit.transitioned', 'visit.rescheduled', 'task.created', 'task.transitioned']),
  actorLabel: name, createdAt: time, fromStatus: z.string().max(32).nullable(),
  toStatus: z.enum([...crmVisitStatuses, ...crmTaskStatuses]),
}).strict();

export const crmSnapshotSchema = z.object({
  schemaVersion: z.literal(1), mode: z.literal('synthetic_simulation'),
  clinic: z.object({ id, name }).strict(),
  calendar: crmCalendarSchema.optional(),
  buildings: z.array(crmBuildingSchema).max(20).optional(),
  rooms: z.array(crmRoomSchema).max(100), staff: z.array(crmStaffSchema).max(200),
  services: z.array(crmServiceSchema).max(200), patients: z.array(crmPatientSchema).max(1000),
  visits: z.array(crmVisitSchema).max(1000), tasks: z.array(crmTaskSchema).max(2000),
  events: z.array(crmEventSchema).max(50),
  capabilities: z.object({ read: z.literal(true), manage: z.boolean(), staffId: id.optional() }).strict(), generatedAt: time,
}).strict().superRefine((snapshot, context) => {
  const sets = Object.fromEntries(['rooms', 'staff', 'services', 'patients', 'visits', 'tasks'].map(key => {
    const rows = snapshot[key as 'rooms' | 'staff' | 'services' | 'patients' | 'visits' | 'tasks'];
    const values = new Set(rows.map(row => row.id));
    if (values.size !== rows.length) context.addIssue({ code: 'custom', message: 'Duplicate entity ID', path: [key] });
    return [key, values];
  }));
  const visits = new Map(snapshot.visits.map(visit => [visit.id, visit]));
  if (snapshot.buildings) {
    const buildings = new Map(snapshot.buildings.map(building => [building.id, building]));
    if (buildings.size !== snapshot.buildings.length) context.addIssue({ code: 'custom', message: 'Duplicate building ID' });
    for (const room of snapshot.rooms) {
      const building = room.buildingId ? buildings.get(room.buildingId) : undefined;
      if (!building || room.x < building.x || room.y < building.y || room.x + room.width > building.x + building.width ||
        room.y + room.depth > building.y + building.depth) context.addIssue({ code: 'custom', message: 'Missing or inconsistent room building' });
    }
  } else if (snapshot.rooms.some(room => room.buildingId !== undefined)) {
    context.addIssue({ code: 'custom', message: 'Room building metadata requires building catalogue' });
  }
  for (const person of snapshot.staff) if (!sets.rooms.has(person.roomId)) context.addIssue({ code: 'custom', message: 'Missing staff room' });
  for (const visit of snapshot.visits) if (!sets.patients.has(visit.patientId) || !sets.staff.has(visit.staffId) ||
    !sets.rooms.has(visit.roomId) || !sets.services.has(visit.serviceId)) context.addIssue({ code: 'custom', message: 'Missing visit relation' });
  for (const task of snapshot.tasks) if (visits.get(task.visitId)?.patientId !== task.patientId || !sets.staff.has(task.ownerId)) {
    context.addIssue({ code: 'custom', message: 'Missing task relation' });
  }
});

const acknowledgment = { testDataAcknowledged: z.literal(true), idempotencyKey: z.uuid() };
export const crmCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('visit.create'), patientId: id, staffId: id, roomId: id,
    serviceId: id, scheduledAt: time, ...acknowledgment }).strict(),
  z.object({ type: z.literal('visit.transition'), visitId: id, expectedVersion: version,
    action: z.enum(crmVisitActions), ...acknowledgment }).strict(),
  z.object({ type: z.literal('visit.reschedule'), visitId: id, expectedVersion: version,
    scheduledAt: time, ...acknowledgment }).strict(),
  z.object({ type: z.literal('task.create'), visitId: id, ownerId: id,
    kind: crmTaskSchema.shape.kind, title: taskTitle, priority: crmTaskSchema.shape.priority,
    dueAt: time, ...acknowledgment }).strict(),
  z.object({ type: z.literal('task.transition'), taskId: id, expectedVersion: version,
    action: z.enum(crmTaskActions), ...acknowledgment }).strict(),
]);
export const crmCommandResultSchema = z.object({ resourceId: id, version, replayed: z.boolean() }).strict();
export const crmActorSchema = z.object({ issuer: z.string().min(1).max(256), subject: z.string().min(1).max(256) }).strict();
export type CrmActor = z.infer<typeof crmActorSchema>;
export type CrmSnapshot = z.infer<typeof crmSnapshotSchema>;
export type CrmRoom = z.infer<typeof crmRoomSchema>;
export type CrmBuilding = z.infer<typeof crmBuildingSchema>;
export type CrmStaff = z.infer<typeof crmStaffSchema>;
export type CrmService = z.infer<typeof crmServiceSchema>;
export type CrmPatient = z.infer<typeof crmPatientSchema>;
export type CrmVisit = z.infer<typeof crmVisitSchema>;
export type CrmCalendar = z.infer<typeof crmCalendarSchema>;
export type CrmTask = z.infer<typeof crmTaskSchema>;
export type CrmEvent = z.infer<typeof crmEventSchema>;
export type CrmCommand = z.infer<typeof crmCommandSchema>;
export type CrmCommandResult = z.infer<typeof crmCommandResultSchema>;

export function parseCrmSnapshot(value: unknown): CrmSnapshot { return crmSnapshotSchema.parse(value); }
export function parseCrmCommand(value: unknown): CrmCommand { return crmCommandSchema.parse(value); }
