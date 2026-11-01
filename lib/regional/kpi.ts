import { z } from 'zod';
import { regionalIdSchema } from './contracts';

const DAY_MS = 86_400_000;
const amount = z.number().finite().min(0).max(1_000_000_000_000);
const count = z.number().int().min(0).max(10_000_000);
const time = z.iso.datetime({ offset: true });
const label = z.string().min(1).max(240).refine(value => value.trim().length > 0);
const date = z.iso.date().refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return value >= '1900-01-01' && value <= '2200-12-31'
    && Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid calendar date');

function checkPeriod(value: { start: string; end: string }, context: z.RefinementCtx) {
  const days = (Date.parse(value.end) - Date.parse(value.start)) / DAY_MS;
  if (days < 0 || days > 365) {
    context.addIssue({ code: 'custom', path: ['end'], message: 'Expected an inclusive period of 1–366 days' });
  }
}

export const regionalKpiPeriodSchema = z.object({ start: date, end: date }).strict().superRefine(checkPeriod);
export const regionalKpiQuerySchema = z.object({
  start: date, end: date, facilityId: regionalIdSchema.optional(),
}).strict().superRefine(checkPeriod);

const evidenceIndicator = z.enum(['complaints-hospital', 'complaints-polyclinic', 'lab-turnaround', 'doctor-staffing',
  'pharmacy-fulfillment', 'procurement-on-time', 'tasks-on-time', 'visits-completion', 'encounter-documentation']);
export const regionalKpiEvidenceQuerySchema = z.object({
  start: date, end: date, facilityId: regionalIdSchema, indicatorId: evidenceIndicator,
  offset: z.number().int().min(0).max(10_000).optional(),
}).strict().superRefine(checkPeriod);

const evidenceItemSchema = z.object({
  id: z.string().min(1).max(200).regex(/^[a-z][a-z0-9_-]*(?::[a-zA-Z0-9][a-zA-Z0-9_-]*){1,3}$/),
  observedAt: time,
  kind: z.enum(['care_episode', 'complaint_decision', 'lab_sample', 'doctor_position', 'main_doctor',
    'prescription', 'procurement', 'work_task', 'visit', 'encounter']),
  label,
  value: amount.nullable(),
  unit: z.string().max(80),
}).strict();

export const regionalKpiEvidenceSchema = z.object({
  schemaVersion: z.literal(1), facilityId: regionalIdSchema, indicatorId: evidenceIndicator,
  period: regionalKpiPeriodSchema, total: count,
  offset: z.number().int().min(0).max(10_000),
  items: z.array(evidenceItemSchema).max(20),
  nextOffset: z.number().int().min(0).max(10_000).nullable(),
}).strict().superRefine((value, context) => {
  const expectedLength = Math.min(20, Math.max(0, value.total - value.offset));
  if (value.items.length !== expectedLength) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Evidence page count does not match total and offset' });
  }
  const next = value.offset + value.items.length;
  const expectedNext = next < value.total && next <= 10_000 && value.items.length > 0 ? next : null;
  if (value.nextOffset !== expectedNext) {
    context.addIssue({ code: 'custom', path: ['nextOffset'], message: 'Invalid evidence continuation' });
  }
  if (new Set(value.items.map(row => row.id)).size !== value.items.length) {
    context.addIssue({ code: 'custom', path: ['items'], message: 'Duplicate evidence reference' });
  }
  const allowedKinds: Record<string, readonly string[]> = {
    'complaints-hospital': ['care_episode', 'complaint_decision'],
    'complaints-polyclinic': ['care_episode', 'complaint_decision'],
    'lab-turnaround': ['lab_sample'], 'doctor-staffing': ['doctor_position', 'main_doctor'],
    'pharmacy-fulfillment': ['prescription'], 'procurement-on-time': ['procurement'],
    'tasks-on-time': ['work_task'], 'visits-completion': ['visit'], 'encounter-documentation': ['encounter'],
  };
  const kinds = allowedKinds[value.indicatorId];
  for (const [index, row] of value.items.entries()) {
    if (!kinds || !kinds.includes(row.kind)) {
      context.addIssue({ code: 'custom', path: ['items', index, 'kind'], message: 'Evidence does not belong to this indicator' });
    }
    const previous = value.items[index - 1];
    if (previous) {
      const earlier = Date.parse(previous.observedAt); const later = Date.parse(row.observedAt);
      if (earlier < later || (earlier === later && previous.id >= row.id)) {
        context.addIssue({ code: 'custom', path: ['items', index], message: 'Expected newest evidence first and stable reference order' });
      }
    }
  }
});

export const regionalKpiDefinitionSchema = z.object({
  id: regionalIdSchema,
  title: label,
  category: z.enum(['quality', 'resources', 'laboratory', 'operations']),
  sourceType: z.enum(['official', 'internal']),
  sourceTitle: label,
  sourceUrl: z.url({ protocol: /^https$/ }).max(1000).nullable(),
  sourceVersion: label,
  applicableKinds: z.array(z.enum(['hospital', 'polyclinic'])).min(1).max(2),
  basis: z.enum(['ratio_per_1000', 'percent', 'mean_minutes']),
  direction: z.enum(['lower', 'higher']),
  target: amount.nullable(),
  targetPeriod: z.enum(['calendar_month', 'snapshot', 'any']),
  unit: label,
  numeratorLabel: label,
  denominatorLabel: label,
  periodKind: z.enum(['interval', 'snapshot']),
  note: z.string().min(1).max(2000),
}).strict().superRefine((value, context) => {
  if (new Set(value.applicableKinds).size !== value.applicableKinds.length) {
    context.addIssue({ code: 'custom', path: ['applicableKinds'], message: 'Duplicate facility kind' });
  }
  if (value.sourceType === 'official' && value.sourceUrl === null) {
    context.addIssue({ code: 'custom', path: ['sourceUrl'], message: 'Official indicator requires its source' });
  }
  if ((value.targetPeriod === 'snapshot') !== (value.periodKind === 'snapshot')) {
    context.addIssue({ code: 'custom', path: ['targetPeriod'], message: 'Snapshot target must use a snapshot observation' });
  }
});

export const regionalKpiFacilitySchema = z.object({
  id: regionalIdSchema, name: label, kind: z.enum(['hospital', 'polyclinic']),
  districtId: regionalIdSchema, regionId: regionalIdSchema,
}).strict();

export const regionalKpiObservationSchema = z.object({
  facilityId: regionalIdSchema,
  indicatorId: regionalIdSchema,
  numerator: amount,
  denominator: amount,
  sourceCount: count,
  lastObservedAt: time.nullable(),
}).strict().superRefine((value, context) => {
  if ((value.denominator > 0 || value.numerator > 0) && value.sourceCount === 0) {
    context.addIssue({ code: 'custom', path: ['sourceCount'], message: 'Reported value requires source evidence and observation time' });
  }
  if ((value.sourceCount === 0) !== (value.lastObservedAt === null)) {
    context.addIssue({ code: 'custom', path: ['lastObservedAt'], message: 'Source evidence and observation time must be present together' });
  }
  if (value.denominator > 0 && !Number.isFinite(value.numerator / value.denominator * 1000)) {
    context.addIssue({ code: 'custom', path: ['denominator'], message: 'Unrepresentable rate' });
  }
});

export const regionalKpiSnapshotSchema = z.object({
  schemaVersion: z.literal(1), dataMode: z.literal('training'), generatedAt: time,
  period: regionalKpiPeriodSchema,
  definitions: z.array(regionalKpiDefinitionSchema).max(32),
  facilities: z.array(regionalKpiFacilitySchema).max(200),
  observations: z.array(regionalKpiObservationSchema).max(6400),
}).strict().superRefine((value, context) => {
  const definitions = new Map(value.definitions.map(row => [row.id, row]));
  const facilities = new Map(value.facilities.map(row => [row.id, row]));
  if (definitions.size !== value.definitions.length) {
    context.addIssue({ code: 'custom', path: ['definitions'], message: 'Duplicate indicator definition' });
  }
  if (facilities.size !== value.facilities.length) {
    context.addIssue({ code: 'custom', path: ['facilities'], message: 'Duplicate facility' });
  }
  const pairs = new Set<string>();
  for (const [index, row] of value.observations.entries()) {
    const definition = definitions.get(row.indicatorId);
    const facility = facilities.get(row.facilityId);
    const key = `${row.facilityId}:${row.indicatorId}`;
    const message = !definition ? 'Unknown indicator' : !facility ? 'Unknown facility'
      : !definition.applicableKinds.includes(facility.kind) ? 'Indicator is not applicable to this facility'
        : pairs.has(key) ? 'Duplicate facility indicator observation' : null;
    if (message) context.addIssue({ code: 'custom', path: ['observations', index], message });
    pairs.add(key);
  }
});

export type RegionalKpiQuery = z.infer<typeof regionalKpiQuerySchema>;
export type RegionalKpiEvidenceQuery = z.infer<typeof regionalKpiEvidenceQuerySchema>;
export type RegionalKpiEvidence = z.infer<typeof regionalKpiEvidenceSchema>;
export type RegionalKpiSnapshot = z.infer<typeof regionalKpiSnapshotSchema>;
export type RegionalKpiDefinition = z.infer<typeof regionalKpiDefinitionSchema>;
export type RegionalKpiFacility = z.infer<typeof regionalKpiFacilitySchema>;
export type RegionalKpiObservation = z.infer<typeof regionalKpiObservationSchema>;
export type RegionalKpiScope = { regionId?: string; districtId?: string; facilityId?: string };
export type RegionalKpiStatus = 'no_data' | 'within_target' | 'outside_target' | 'no_target';
export type RegionalKpiAggregate = {
  definition: RegionalKpiDefinition;
  period: RegionalKpiSnapshot['period'];
  value: number | null;
  numerator: number;
  denominator: number;
  sourceCount: number;
  incompleteDenominator: boolean;
  effectiveTarget: number | null;
  targetApplicability: 'applicable' | 'not_defined' | 'different_period';
  status: RegionalKpiStatus;
  coverage: { eligible: number; reporting: number; missing: number };
  lastObservedAt: string | null;
};

function isCalendarMonth(period: RegionalKpiSnapshot['period']): boolean {
  if (!period.start.endsWith('-01') || period.start.slice(0, 7) !== period.end.slice(0, 7)) return false;
  const nextDay = new Date(Date.parse(period.end) + DAY_MS).toISOString().slice(0, 10);
  return nextDay.endsWith('-01');
}

/** Display filtering only: the snapshot must already be parsed and authorized by the server. */
export function aggregateRegionalKpi(
  snapshot: RegionalKpiSnapshot, indicatorId: string, scope: RegionalKpiScope = {},
): RegionalKpiAggregate {
  const definition = snapshot.definitions.find(row => row.id === indicatorId);
  if (!definition) throw new Error('REGIONAL_KPI_INDICATOR_UNKNOWN');
  const facilities = snapshot.facilities.filter(row =>
    definition.applicableKinds.includes(row.kind)
    && (scope.regionId === undefined || row.regionId === scope.regionId)
    && (scope.districtId === undefined || row.districtId === scope.districtId)
    && (scope.facilityId === undefined || row.id === scope.facilityId));
  const ids = new Set(facilities.map(row => row.id));
  const rows = snapshot.observations.filter(row => row.indicatorId === indicatorId
    && ids.has(row.facilityId) && row.sourceCount > 0 && row.lastObservedAt !== null);
  // Sums of underlying amounts, never an average of facility percentages/means.
  // Snapshot rows contain one latest facility snapshot, not a sum across dates.
  const numerator = rows.reduce((total, row) => total + row.numerator, 0);
  const denominator = rows.reduce((total, row) => total + row.denominator, 0);
  const sourceCount = rows.reduce((total, row) => total + row.sourceCount, 0);
  const multiplier = definition.basis === 'ratio_per_1000' ? 1000 : definition.basis === 'percent' ? 100 : 1;
  // Recorded complaints with no corresponding activity denominator must not
  // disappear or borrow another institution's denominator to imply a valid rate.
  const incompleteDenominator = rows.some(row => row.numerator > 0 && row.denominator === 0);
  const reporting = rows.filter(row => row.denominator > 0).length;
  const value = denominator > 0 && !incompleteDenominator ? numerator / denominator * multiplier : null;
  const targetApplicability = definition.target === null ? 'not_defined'
    : definition.targetPeriod === 'calendar_month' && !isCalendarMonth(snapshot.period) ? 'different_period'
      : 'applicable';
  const effectiveTarget = targetApplicability === 'applicable' ? definition.target : null;
  const meetsTarget = value !== null && effectiveTarget !== null
    && (definition.direction === 'higher' ? value >= effectiveTarget : value <= effectiveTarget);
  const status: RegionalKpiStatus = value === null ? 'no_data' : effectiveTarget === null ? 'no_target'
    : meetsTarget ? 'within_target' : 'outside_target';
  const lastObservedAt = rows.reduce<string | null>((latest, row) =>
    latest === null || Date.parse(row.lastObservedAt!) > Date.parse(latest) ? row.lastObservedAt : latest, null);
  return {
    definition, period: { ...snapshot.period }, value, numerator, denominator, sourceCount, incompleteDenominator,
    effectiveTarget, targetApplicability, status,
    coverage: { eligible: ids.size, reporting, missing: ids.size - reporting }, lastObservedAt,
  };
}

export type RegionalKpiComparison = {
  comparable: boolean;
  reason: 'comparable' | 'different_indicator' | 'different_definition' | 'different_period' | 'no_data';
  delta: number | null;
};

/** For peer-facility comparison, never mix periods or differently versioned measures. */
export function compareRegionalKpi(left: RegionalKpiAggregate, right: RegionalKpiAggregate): RegionalKpiComparison {
  if (left.definition.id !== right.definition.id) return { comparable: false, reason: 'different_indicator', delta: null };
  const signature = (definition: RegionalKpiDefinition) => JSON.stringify({
    ...definition, applicableKinds: [...definition.applicableKinds].sort(),
  });
  if (signature(left.definition) !== signature(right.definition)) {
    return { comparable: false, reason: 'different_definition', delta: null };
  }
  if (left.period.start !== right.period.start || left.period.end !== right.period.end) {
    return { comparable: false, reason: 'different_period', delta: null };
  }
  if (left.value === null || right.value === null) return { comparable: false, reason: 'no_data', delta: null };
  return { comparable: true, reason: 'comparable', delta: left.value - right.value };
}
