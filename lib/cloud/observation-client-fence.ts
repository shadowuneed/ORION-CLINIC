import { z } from 'zod';
import { createObservationSchema, correctObservationSchema, observationContexts, observationValuesSchema,
  toStoredObservationValues, validateMeasuredAt, type ObservationContext } from '@/lib/domain/observations';
import type { LatestPatientVitals, ObservationVersionRecord } from '@/lib/repositories/patient-observations';
import { createPatientRequestFence } from '@/app/patients/pagination-client';
import { cloudGenerationHeader } from './account-fence';

export const CLOUD_OBSERVATION_PAGE_SIZE = 25;
export const CLOUD_OBSERVATION_WINDOW_LIMIT = 500;
export const CLOUD_OBSERVATION_SOURCE_LABEL = 'Облачный ручной ввод · тестовые данные';
export type CloudObservationSelection = {
  organizationId: string; facilityId: string; accessAssignmentId: string; patientId: string;
};
const id = z.string().min(1).max(160).regex(/^[a-zA-Z0-9_-]+$/);
const clean = (min: number, max: number) => z.string().min(min).max(max)
  .refine(value => value === value.trim() && !/[\u0000-\u001f\u007f]/.test(value));
const time = z.number().int().min(946684800000).max(Number.MAX_SAFE_INTEGER);
const positive = z.number().int().positive().max(2147483647);
const selectionSchema = z.object({ organizationId: id, facilityId: id.max(100), accessAssignmentId: id, patientId: id }).strict();
const pageSchema = z.object({ hasMore: z.boolean(), nextCursor: z.string().min(1).max(2048).nullable() }).strict()
  .refine(value => value.hasMore === (value.nextCursor !== null));
const valuesSchema = observationValuesSchema.safeExtend({ bmi: z.number().min(5).max(100).nullable() }).refine(value => {
  const stored = toStoredObservationValues(value);
  return value.bmi === (stored.bmiHundredths === null ? null : stored.bmiHundredths / 100) &&
    value.heightCm === (stored.heightMm === null ? null : stored.heightMm / 10) &&
    value.weightKg === (stored.weightGrams === null ? null : stored.weightGrams / 1000) &&
    value.temperatureC === (stored.temperatureMilliC === null ? null : stored.temperatureMilliC / 1000);
});
const versionSchema = z.object({ id, version: positive, supersedesVersionId: id.nullable(), measuredAt: time,
  context: z.enum(observationContexts), values: valuesSchema,
  units: z.object({ height: z.literal('cm'), weight: z.literal('kg'), bmi: z.literal('kg/m²'),
    pressure: z.literal('мм рт. ст.'), temperature: z.literal('°C') }).strict(),
  note: clean(3, 1000).nullable(), sourceType: z.literal('manual_test'), sourceLabel: z.literal(CLOUD_OBSERVATION_SOURCE_LABEL),
  recordedByMembershipId: id, accessAssignmentId: id, recordedBy: clean(2, 300), recordedAt: time,
  changeReason: clean(3, 500), inputHash: z.string().regex(/^[a-f0-9]{64}$/),
}).strict().refine(value => (value.version === 1) === (value.supersedesVersionId === null) && value.id !== value.supersedesVersionId);
const patientSchema = z.object({ id, displayName: clean(2, 300), medicalRecordNumber: clean(1, 300) }).strict();
const recordSchema = z.object({ id, patient: patientSchema, current: versionSchema, history: z.array(versionSchema).length(1),
  historyCount: positive, currentVersion: positive, historyPage: pageSchema }).strict();
const envelopeSchema = z.object({ organizationId: id, facilityId: id, patientId: id, accessAssignmentId: id,
  assignmentVersionId: id, role: z.enum(['clinician', 'nurse']), timeZone: clean(1, 100),
  sourceLabel: z.literal(CLOUD_OBSERVATION_SOURCE_LABEL), observedAt: time, clinicalInterpretation: z.literal('not_performed'),
  persistence: z.literal('supabase'),
});
const viewerSchema = z.object({ id, displayName: clean(2, 300), membershipId: id, accessAssignmentId: id,
  role: z.enum(['clinician', 'nurse']) }).strict();
const listSchema = envelopeSchema.extend({ patient: patientSchema, observations: z.array(recordSchema).max(CLOUD_OBSERVATION_PAGE_SIZE),
  page: pageSchema, viewer: viewerSchema, organization: z.object({ id, name: clean(1, 300) }).strict(),
  facility: z.object({ id, name: clean(1, 300) }).strict(), dataMode: z.literal('synthetic-only'),
  accessAssignment: z.object({ assignmentId: id, assignmentVersionId: id }).strict(), patientSelection: z.literal('explicit'),
  capabilities: z.object({ 'workspace.read': z.boolean(), 'observation.record': z.boolean(), 'observation.correct': z.boolean() }).strict(),
  thresholdPolicy: z.object({ status: z.literal('not_configured'), decision: z.literal('DEC-006'), message: clean(1, 1000) }).strict(),
});
export type CloudObservationRecord = z.infer<typeof recordSchema>;
export type CloudObservationWorkspace = z.infer<typeof listSchema>;
export type CloudObservationPage = z.infer<typeof pageSchema>;
export type CloudObservationViewer = z.infer<typeof viewerSchema>;
export type CloudObservationHistory = { observationId: string; currentVersion: number; items: ObservationVersionRecord[];
  page: CloudObservationPage; timeZone: string };
export type CloudObservationDraft = {
  measuredAt: string; initialMeasuredAt: string; originalMeasuredAt: number; context: ObservationContext;
  includeAnthropometry: boolean; heightCm: string; weightKg: string; includePressure: boolean;
  systolicMmhg: string; diastolicMmhg: string; includeTemperature: boolean; temperatureC: string;
  note: string; reason: string; syntheticDataAcknowledged: boolean; idempotencyKey: string;
};
export type CloudObservationCommand = z.infer<typeof createObservationSchema> | z.infer<typeof correctObservationSchema>;

export function cloudObservationSelectionKey(selection: CloudObservationSelection) {
  const value = selectionSchema.parse({ organizationId: selection.organizationId, facilityId: selection.facilityId,
    accessAssignmentId: selection.accessAssignmentId, patientId: selection.patientId });
  return JSON.stringify([value.organizationId, value.facilityId, value.accessAssignmentId, value.patientId]);
}
export function cloudObservationQuery(selection: CloudObservationSelection, options: { cursor?: string | null; paged?: boolean } = {}) {
  selectionSchema.parse(selection);
  const params = new URLSearchParams({ facilityId: selection.facilityId, accessAssignmentId: selection.accessAssignmentId,
    patientId: selection.patientId });
  if (options.paged !== false) params.set('limit', String(CLOUD_OBSERVATION_PAGE_SIZE));
  if (options.cursor) params.set('cursor', options.cursor);
  return params.toString();
}

/** A missing or switched session never publishes data, even after JSON parsing. */
export function createCloudObservationFence(readGeneration: () => string | null) {
  const fence = createPatientRequestFence(readGeneration);
  let scopeKey = '';
  let account: string | null = null;
  let boundAccount: string | null = null;
  return {
    select(selection: CloudObservationSelection) {
      fence.retire(); scopeKey = ''; account = null;
      const observed = readGeneration();
      // Retirement cancels requests, not the account binding. A refresh cannot
      // adopt a new session before the periodic cookie check clears old data.
      if (observed === null || !/^[a-f0-9]{32}$/.test(observed) || (boundAccount !== null && observed !== boundAccount)) return false;
      boundAccount = observed; scopeKey = cloudObservationSelectionKey(selection); account = observed;
      return true;
    },
    retire() { fence.retire(); account = null; scopeKey = ''; },
    generation() { return account; },
    accountCurrent() { return account !== null && /^[a-f0-9]{32}$/.test(account) && account === readGeneration(); },
    begin(channel: string, selection: CloudObservationSelection) {
      const key = cloudObservationSelectionKey(selection);
      const request = fence.begin(channel);
      const generation = account;
      return { ...request, generation,
        headers: { [cloudGenerationHeader]: generation ?? '' },
        current: () => generation !== null && /^[a-f0-9]{32}$/.test(generation) && key === scopeKey &&
          generation === account && generation === readGeneration() && request.current() };
    },
  };
}

function checkEnvelope(value: z.infer<typeof envelopeSchema>, selection: CloudObservationSelection) {
  if (cloudObservationSelectionKey(value) !== cloudObservationSelectionKey(selection)) throw new Error('Несовпадение рабочего контура.');
  new Intl.DateTimeFormat('ru-RU', { timeZone: value.timeZone });
}
function checkVersion(value: z.infer<typeof versionSchema>, observedAt: number) {
  if (value.recordedAt > observedAt || value.measuredAt > observedAt + 300000) throw new Error('Недостоверное время записи.');
}
function checkRecord(value: CloudObservationRecord, selection: CloudObservationSelection, observedAt: number) {
  checkVersion(value.current, observedAt);
  if (value.patient.id !== selection.patientId || value.currentVersion !== value.current.version ||
    value.historyCount !== value.currentVersion || JSON.stringify(value.history[0]) !== JSON.stringify(value.current) ||
    value.historyPage.hasMore !== (value.currentVersion > 1)) throw new Error('Неполная запись измерения.');
}
export function parseCloudObservationListClient(value: unknown, selection: CloudObservationSelection) {
  const result = listSchema.parse(value); checkEnvelope(result, selection);
  if (result.organization.id !== selection.organizationId || result.facility.id !== selection.facilityId ||
    result.patient.id !== selection.patientId || result.viewer.accessAssignmentId !== selection.accessAssignmentId ||
    result.viewer.role !== result.role || result.accessAssignment.assignmentId !== selection.accessAssignmentId ||
    result.accessAssignment.assignmentVersionId !== result.assignmentVersionId ||
    !result.capabilities['workspace.read'] || (result.page.hasMore && result.observations.length !== CLOUD_OBSERVATION_PAGE_SIZE) ||
    new Set(result.observations.map(row => row.id)).size !== result.observations.length) throw new Error('Неполная страница показателей.');
  for (const [index, row] of result.observations.entries()) {
    checkRecord(row, selection, result.observedAt);
    if (JSON.stringify(row.patient) !== JSON.stringify(result.patient) || (index > 0 && !observationAfter(result.observations[index - 1], row))) {
      throw new Error('Пациент записи или порядок страницы изменились.');
    }
  }
  return result;
}
export function parseCloudObservationHistoryClient(value: unknown, selection: CloudObservationSelection, observation: CloudObservationRecord) {
  const result = envelopeSchema.extend({ observationId: id, observationVersion: positive, currentVersion: positive,
    historyCount: positive, items: z.array(versionSchema).max(CLOUD_OBSERVATION_PAGE_SIZE), page: pageSchema }).parse(value);
  checkEnvelope(result, selection);
  if (result.observationId !== observation.id || result.observationVersion !== observation.currentVersion ||
    result.currentVersion !== result.observationVersion || result.historyCount !== result.observationVersion ||
    new Set(result.items.map(item => item.id)).size !== result.items.length ||
    (result.page.hasMore && result.items.length !== CLOUD_OBSERVATION_PAGE_SIZE)) throw new Error('Версия истории изменилась.');
  result.items.forEach(item => checkVersion(item, result.observedAt));
  return { observationId: result.observationId, currentVersion: result.currentVersion, items: result.items,
    page: result.page, timeZone: result.timeZone };
}
export function appendCloudObservationRows(current: readonly CloudObservationRecord[], next: readonly CloudObservationRecord[]) {
  const ids = new Set(current.map(row => row.id));
  if (next.some(row => ids.has(row.id)) || new Set(next.map(row => row.id)).size !== next.length ||
    current.length + next.length > CLOUD_OBSERVATION_WINDOW_LIMIT) throw new Error('Окно измерений изменилось. Обновите список.');
  const rows = [...current, ...next];
  if (rows.some((row, index) => index > 0 && !observationAfter(rows[index - 1], row))) throw new Error('Позиция списка изменилась.');
  return rows;
}
function observationAfter(left: CloudObservationRecord, right: CloudObservationRecord) {
  return left.current.measuredAt > right.current.measuredAt || (left.current.measuredAt === right.current.measuredAt &&
    (left.current.recordedAt > right.current.recordedAt || (left.current.recordedAt === right.current.recordedAt && left.id < right.id)));
}
export function appendCloudObservationHistory(current: readonly ObservationVersionRecord[], next: readonly ObservationVersionRecord[]) {
  const result = [...current, ...next];
  if (next.length === 0 || result.length > CLOUD_OBSERVATION_WINDOW_LIMIT || new Set(result.map(row => row.id)).size !== result.length ||
    result.some((row, index) => index > 0 && (result[index - 1].version !== row.version + 1 ||
      result[index - 1].supersedesVersionId !== row.id || result[index - 1].recordedAt < row.recordedAt))) {
    throw new Error('История изменилась. Откройте запись заново.');
  }
  return result;
}
const sourceSchema = { observationId: id, version: positive, measuredAt: time, recordedBy: clean(2, 300),
  sourceLabel: z.literal(CLOUD_OBSERVATION_SOURCE_LABEL) };
export function parseCloudObservationLatestClient(value: unknown, selection: CloudObservationSelection) {
  const result = envelopeSchema.extend({ vitals: z.object({
    anthropometry: z.object({ ...sourceSchema, heightCm: z.number().min(40).max(250), weightKg: z.number().min(1).max(500),
      bmi: z.number().min(5).max(100) }).strict().refine(item => toStoredObservationValues({ heightCm: item.heightCm,
        weightKg: item.weightKg, systolicMmhg: null, diastolicMmhg: null, temperatureC: null }).bmiHundredths! / 100 === item.bmi).nullable(),
    bloodPressure: z.object({ ...sourceSchema, systolicMmhg: z.number().int().min(40).max(300),
      diastolicMmhg: z.number().int().min(20).max(200) }).strict().refine(item => item.systolicMmhg > item.diastolicMmhg).nullable(),
    temperature: z.object({ ...sourceSchema, temperatureC: z.number().min(30).max(45) }).strict().nullable(),
  }).strict() }).parse(value);
  checkEnvelope(result, selection);
  if (Object.values(result.vitals).some(item => item && item.measuredAt > result.observedAt + 300000)) throw new Error('Время измерения изменилось.');
  return { vitals: result.vitals as LatestPatientVitals, timeZone: result.timeZone };
}
export function parseCloudObservationMutationClient(value: unknown, selection: CloudObservationSelection,
  command: { observationId?: string; expectedVersion?: number }) {
  const result = envelopeSchema.extend({ observation: recordSchema, replayed: z.boolean() }).parse(value);
  checkEnvelope(result, selection); checkRecord(result.observation, selection, result.observedAt);
  if ((command.observationId && result.observation.id !== command.observationId) ||
    result.observation.currentVersion !== (command.expectedVersion === undefined ? 1 : command.expectedVersion + 1)) {
    throw new Error('Результат команды не подтверждён.');
  }
  return result;
}
export function cloudObservationCanCorrect(viewer: CloudObservationViewer, observation: CloudObservationRecord) {
  return viewer.role === 'clinician' || observation.current.recordedByMembershipId === viewer.membershipId;
}
export function cloudObservationDateInput(value: number) {
  return new Date(value - new Date(value).getTimezoneOffset() * 60000).toISOString().slice(0, 19);
}
export function cloudObservationDraft(observation?: CloudObservationRecord, now = Date.now()): CloudObservationDraft {
  const measuredAt = observation?.current.measuredAt ?? now;
  const initialMeasuredAt = cloudObservationDateInput(measuredAt);
  const values = observation?.current.values;
  return { measuredAt: initialMeasuredAt, initialMeasuredAt, originalMeasuredAt: measuredAt,
    context: observation?.current.context ?? 'pre_visit', includeAnthropometry: values ? values.heightCm !== null : true,
    heightCm: values?.heightCm?.toString() ?? '', weightKg: values?.weightKg?.toString() ?? '',
    includePressure: values ? values.systolicMmhg !== null : true, systolicMmhg: values?.systolicMmhg?.toString() ?? '',
    diastolicMmhg: values?.diastolicMmhg?.toString() ?? '', includeTemperature: values ? values.temperatureC !== null : true,
    temperatureC: values?.temperatureC?.toString() ?? '', note: observation?.current.note ?? '',
    reason: observation ? '' : 'Первичная запись показателей', syntheticDataAcknowledged: false, idempotencyKey: crypto.randomUUID() };
}
const inputNumber = (value: string) => value.trim() ? Number(value.trim().replace(',', '.')) : null;
export function buildCloudObservationCommand(selection: CloudObservationSelection, draft: CloudObservationDraft,
  correction?: CloudObservationRecord, now = Date.now()): CloudObservationCommand {
  selectionSchema.parse(selection);
  const measuredAt = draft.measuredAt === draft.initialMeasuredAt ? draft.originalMeasuredAt : new Date(draft.measuredAt).getTime();
  validateMeasuredAt(measuredAt, now);
  const payload = { facilityId: selection.facilityId, accessAssignmentId: selection.accessAssignmentId,
    patientId: selection.patientId, measuredAt, context: draft.context,
    values: { heightCm: draft.includeAnthropometry ? inputNumber(draft.heightCm) : null,
      weightKg: draft.includeAnthropometry ? inputNumber(draft.weightKg) : null,
      systolicMmhg: draft.includePressure ? inputNumber(draft.systolicMmhg) : null,
      diastolicMmhg: draft.includePressure ? inputNumber(draft.diastolicMmhg) : null,
      temperatureC: draft.includeTemperature ? inputNumber(draft.temperatureC) : null },
    note: draft.note.trim() || null, reason: draft.reason, syntheticDataAcknowledged: draft.syntheticDataAcknowledged,
    idempotencyKey: draft.idempotencyKey, ...(correction ? { expectedVersion: correction.currentVersion } : {}) };
  const command = correction ? correctObservationSchema.parse(payload) : createObservationSchema.parse(payload);
  const bmi = toStoredObservationValues(command.values).bmiHundredths;
  if (bmi !== null && (bmi < 500 || bmi > 10000)) throw new Error('Проверьте рост и вес: рассчитанный ИМТ вне диапазона ввода.');
  if (correction && correction.patient.id !== selection.patientId) throw new Error('Пациент исправления изменился.');
  return command;
}

/** Freeze an unknown-outcome command; retries use exactly these bytes and UUID. */
export function freezeCloudObservationCommand(selection: CloudObservationSelection, command: CloudObservationCommand,
  generation: string, observationId?: string) {
  if (command.patientId !== selection.patientId || command.facilityId !== selection.facilityId ||
    command.accessAssignmentId !== selection.accessAssignmentId) throw new Error('Команда другого рабочего контура.');
  if (!/^[a-f0-9]{32}$/.test(generation) || Boolean(observationId) !== ('expectedVersion' in command)) throw new Error('Сеанс или тип команды изменился.');
  return Object.freeze({ scopeKey: cloudObservationSelectionKey(selection), generation, observationId,
    method: observationId ? 'PATCH' as const : 'POST' as const,
    url: observationId ? `/api/observations/${encodeURIComponent(id.parse(observationId))}` : '/api/observations',
    body: JSON.stringify(command), idempotencyKey: command.idempotencyKey,
    expectedVersion: 'expectedVersion' in command ? command.expectedVersion : undefined });
}
export class CloudObservationClientError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string) { super(message); }
}
export async function readBoundedCloudObservationResponse(response: Response): Promise<unknown> {
  if ([401, 403, 404].includes(response.status)) {
    // Headers already prove denial. Never wait for an open/trickling error body
    // while keeping previously authorized patient data visible.
    void response.body?.cancel().catch(() => undefined);
    throw new CloudObservationClientError(response.status, response.status === 401 ? 'UNAUTHENTICATED' :
      response.status === 403 ? 'OBSERVATION_FORBIDDEN' : 'OBSERVATION_NOT_FOUND',
    response.status === 401 ? 'Требуется вход.' : 'Выбранные показатели больше недоступны.');
  }
  try { return await readBoundedBody(response); }
  catch (error) {
    // Revocation or an unavailable selected patient clears cached data even if
    // an intermediary returns HTML, truncated JSON or an oversized error page.
    if ([401, 403, 404].includes(response.status) && !(error instanceof CloudObservationClientError)) {
      throw new CloudObservationClientError(response.status, response.status === 401 ? 'UNAUTHENTICATED' :
        response.status === 403 ? 'OBSERVATION_FORBIDDEN' : 'OBSERVATION_NOT_FOUND',
      response.status === 401 ? 'Требуется вход.' : 'Выбранные показатели больше недоступны.');
    }
    throw error;
  }
}
async function readBoundedBody(response: Response): Promise<unknown> {
  const maximum = 768 * 1024;
  const declared = response.headers.get('content-length');
  if (declared && (!/^\d+$/.test(declared) || Number(declared) > maximum)) throw new Error('Ответ превышает допустимый размер.');
  if (!response.body) throw new Error('Нет подтверждённого ответа.');
  const reader = response.body.getReader(); const decoder = new TextDecoder('utf-8', { fatal: true });
  let bytes = 0; let content = '';
  try {
    for (;;) {
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new Error('Ответ превышает допустимый размер.'); }
      content += decoder.decode(part.value, { stream: true });
    }
    content += decoder.decode();
  } finally { reader.releaseLock(); }
  const payload: unknown = JSON.parse(content);
  if (!response.ok) {
    const failure = z.object({ error: z.object({ code: clean(1, 100), message: clean(1, 1000) }) }).safeParse(payload);
    throw new CloudObservationClientError(response.status, failure.success ? failure.data.error.code : 'OBSERVATIONS_UNAVAILABLE',
      failure.success ? failure.data.error.message : 'Не удалось подтвердить доступ к показателям.');
  }
  return payload;
}
