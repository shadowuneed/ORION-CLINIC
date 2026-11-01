import { z } from 'zod';
import { crmActorSchema, crmSnapshotSchema } from '../crm/contracts';

export const regionalIdSchema = z.string().min(1).max(160).regex(/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/);
const text = z.string().min(1).max(1000);
const time = z.iso.datetime({ precision: 3 });
const count = z.number().int().min(0).max(10_000_000);
const version = z.number().int().positive().max(2_147_483_647);
export const regionalActorSchema = crmActorSchema;
export const regionalMetricsSchema = z.object({
  hospitalCount: count, polyclinicCount: count, patientCount: count, activeVisits: count,
  queuedVisits: count, openTasks: count, overdueTasks: count, completedTasks: count,
  totalTasks: count, onTimeTasks: count, dueTasks: count,
  kpiPercent: z.number().min(0).max(100).nullable(),
}).strict();
export const regionalDistrictSchema = regionalMetricsSchema.extend({
  id: regionalIdSchema, name: z.string().min(1).max(160), kind: z.enum(['district', 'city']),
  regionId: z.enum(['turkestan', 'shymkent']),
}).strict();
export const regionalFacilitySchema = regionalMetricsSchema.extend({
  id: regionalIdSchema, districtId: regionalIdSchema, clinicId: regionalIdSchema,
  name: z.string().min(1).max(160), kind: z.enum(['hospital', 'polyclinic']),
  latitude: z.number().min(40).max(47), longitude: z.number().min(66).max(72),
  address: z.string().min(1).max(240), populated: z.boolean(),
}).strict();
export const regionalInsightSchema = z.object({ id: regionalIdSchema, severity: z.enum(['info', 'warning']),
  title: text, detail: text, districtId: regionalIdSchema.optional(), facilityId: regionalIdSchema.optional(),
}).strict();
export const regionalKpiDefinitionSchema = z.object({ title: text, formula: text, periodStart: time, periodEnd: time }).strict();
export const regionalScopeSchema = z.object({ schemaVersion: z.literal(1), canViewRegion: z.boolean(),
  facilities: z.array(z.object({ id: regionalIdSchema, name: z.string().max(160), kind: z.enum(['hospital', 'polyclinic']),
    clinicId: regionalIdSchema, districtId: regionalIdSchema, canManage: z.boolean() }).strict()).max(200), generatedAt: time,
}).strict();
export const regionalCapabilitiesSchema = z.object({ manage: z.boolean(), readPatients: z.boolean(), readClinical: z.boolean(),
  manageVisits: z.boolean(), startVisits: z.boolean(), manageTasks: z.boolean(), manageLabs: z.boolean(), reviewLabs: z.boolean(),
  dispense: z.boolean(), receiveProcurement: z.boolean() }).strict();
export const regionalOverviewSchema = z.object({
  schemaVersion: z.literal(1), dataMode: z.literal('training'), generatedAt: time,
  districts: z.array(regionalDistrictSchema).max(30), facilities: z.array(regionalFacilitySchema).max(200),
  totals: regionalMetricsSchema, insights: z.array(regionalInsightSchema).max(20), sourceNote: text,
  kpiDefinition: regionalKpiDefinitionSchema,
}).strict();
export const regionalMedicalRecordSchema = z.object({
  patientId: regionalIdSchema, trainingIin: z.string().regex(/^TRAIN-[A-Z0-9-]{3,32}$/), birthDate: z.iso.date(),
  allergies: z.array(text).max(20),
  conditions: z.array(z.object({ code: z.string().max(20), name: text, since: z.iso.date(), status: z.enum(['active', 'resolved']) }).strict()).max(30),
  history: z.array(z.object({ id: regionalIdSchema, date: time, title: text, detail: text, doctor: z.string().max(160) }).strict()).max(50),
}).strict();
export const regionalPrescriptionSchema = z.object({
  id: regionalIdSchema, patientId: regionalIdSchema, stockId: regionalIdSchema, drugName: text,
  dose: text, instructions: text, quantity: z.number().int().min(1).max(1000),
  status: z.enum(['approved', 'dispensed']), prescribedBy: z.string().max(160), prescribedAt: time,
  dispensedAt: time.nullable(), version,
}).strict();
export const regionalLabSchema = z.object({ id: regionalIdSchema, patientId: regionalIdSchema, name: text,
  priority: z.enum(['routine', 'urgent']), status: z.enum(['ordered', 'ready', 'reviewed']),
  orderedAt: time, dueAt: time, result: z.string().max(1000).nullable(), unit: z.string().max(40).nullable(),
  reference: z.string().max(160), completedAt: time.nullable(), reviewedAt: time.nullable(), version,
}).strict();
export const regionalStockSchema = z.object({ id: regionalIdSchema, drugName: text, unit: z.string().max(40),
  quantity: count, reorderPoint: count, batch: z.string().max(80), expiresAt: z.iso.date(), version,
}).strict();
export const regionalProcurementSchema = z.object({ id: regionalIdSchema, stockId: regionalIdSchema,
  drugName: text, supplier: text, quantity: z.number().int().min(1).max(100000),
  amountKzt: z.number().min(0).max(1_000_000_000), status: z.enum(['ordered', 'received']),
  orderedAt: time, dueAt: time, receivedAt: time.nullable(), version,
}).strict();
export const regionalWorkTaskSchema = z.object({ id: regionalIdSchema, patientId: regionalIdSchema.nullable(),
  visitId: regionalIdSchema.nullable(), ownerId: regionalIdSchema, title: text,
  category: z.enum(['care', 'laboratory', 'pharmacy', 'procurement']), priority: z.enum(['routine', 'urgent']),
  status: z.enum(['pending', 'in_progress', 'completed', 'escalated']), dueAt: time, completedAt: time.nullable(), version,
}).strict();
export const regionalEventSchema = z.object({ id: regionalIdSchema, action: text, resourceId: regionalIdSchema,
  actorLabel: z.string().max(160), createdAt: time }).strict();
export const regionalFacilitySnapshotSchema = z.object({
  schemaVersion: z.literal(1), dataMode: z.literal('training'), facility: regionalFacilitySchema, crm: crmSnapshotSchema,
  medicalRecords: z.array(regionalMedicalRecordSchema).max(1000), prescriptions: z.array(regionalPrescriptionSchema).max(2000),
  labs: z.array(regionalLabSchema).max(2000), stocks: z.array(regionalStockSchema).max(500),
  procurements: z.array(regionalProcurementSchema).max(500), workTasks: z.array(regionalWorkTaskSchema).max(2000),
  events: z.array(regionalEventSchema).max(50), capabilities: regionalCapabilitiesSchema, generatedAt: time,
  kpiDefinition: regionalKpiDefinitionSchema, insights: z.array(regionalInsightSchema).max(20),
}).strict().superRefine((value, context) => {
  const patients = new Set(value.crm.patients.map(row => row.id));
  const stocks = new Set(value.stocks.map(row => row.id));
  for (const row of [...value.medicalRecords, ...value.prescriptions, ...value.labs]) {
    if (!patients.has(row.patientId)) context.addIssue({ code: 'custom', message: 'Missing patient relation' });
  }
  for (const row of [...value.prescriptions, ...value.procurements]) {
    if (!stocks.has(row.stockId)) context.addIssue({ code: 'custom', message: 'Missing stock relation' });
  }
  if (value.facility.clinicId !== value.crm.clinic.id) context.addIssue({ code: 'custom', message: 'Mismatched facility scope' });
});
const base = { facilityId: regionalIdSchema, expectedVersion: version, idempotencyKey: z.uuid() };
export const regionalCommandSchema = z.discriminatedUnion('type', [
  z.object({ ...base, type: z.literal('visit.transition'), visitId: regionalIdSchema, action: z.enum(['arrive', 'queue', 'call', 'requeue', 'start', 'cancel']) }).strict(),
  z.object({ ...base, type: z.literal('task.transition'), taskId: regionalIdSchema, status: z.enum(['in_progress', 'completed', 'escalated']) }).strict(),
  z.object({ ...base, type: z.literal('lab.complete'), labId: regionalIdSchema, result: text.refine(s => s.trim().length > 0), unit: z.string().max(40) }).strict(),
  z.object({ ...base, type: z.literal('lab.review'), labId: regionalIdSchema }).strict(),
  z.object({ ...base, type: z.literal('prescription.dispense'), prescriptionId: regionalIdSchema }).strict(),
  z.object({ ...base, type: z.literal('procurement.receive'), procurementId: regionalIdSchema }).strict(),
]);
export const regionalCommandResultSchema = z.object({ resourceId: regionalIdSchema, version, replayed: z.boolean() }).strict();
export type RegionalActor = z.infer<typeof regionalActorSchema>;
export type RegionalOverview = z.infer<typeof regionalOverviewSchema>;
export type RegionalScope = z.infer<typeof regionalScopeSchema>;
export type RegionalDistrict = z.infer<typeof regionalDistrictSchema>;
export type RegionalFacility = z.infer<typeof regionalFacilitySchema>;
export type RegionalFacilitySnapshot = z.infer<typeof regionalFacilitySnapshotSchema>;
export type RegionalCommand = z.infer<typeof regionalCommandSchema>;
export type RegionalCommandResult = z.infer<typeof regionalCommandResultSchema>;
