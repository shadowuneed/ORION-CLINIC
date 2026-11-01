import { z } from 'zod';
import { regionalIdSchema } from './contracts';

export const DIRECTIVE_FILE_BYTES = 2 * 1024 * 1024;
export const DIRECTIVE_TOTAL_BYTES = 6 * 1024 * 1024;
export const DIRECTIVE_FILE_COUNT = 3;
const DAY_MS = 86_400_000;
const version = z.number().int().min(1).max(2_147_483_647);
const progress = z.number().int().min(0).max(100);
const time = z.iso.datetime({ offset: true });
const text = (max: number) => z.string().min(1).max(max).refine(value => value.trim().length > 0, 'Text must not be blank');
const date = z.iso.date().refine(value => {
  const parsed = new Date(`${value}T00:00:00Z`);
  return value >= '1900-01-01' && value <= '2200-12-31' && Number.isFinite(parsed.getTime())
    && parsed.toISOString().slice(0, 10) === value;
}, 'Invalid date');

export const regionalDirectiveStatusSchema = z.enum([
  'assigned', 'in_progress', 'submitted', 'returned_documents', 'returned_work', 'accepted',
]);
export const regionalDirectiveMimeSchema = z.enum([
  'application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'image/png', 'image/jpeg', 'text/plain',
]);
const purpose = z.enum(['report', 'supporting', 'explanation']);
const fileName = text(180).refine(value => value === value.trim() && !/[<>:"/\\|?*\p{Cc}\p{Cf}]/u.test(value)
  && !value.startsWith('.') && !/[. ]$/.test(value) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value), 'Unsafe filename');
const extensions: Record<z.infer<typeof regionalDirectiveMimeSchema>, readonly string[]> = {
  'application/pdf': ['pdf'],
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': ['docx'],
  'image/png': ['png'], 'image/jpeg': ['jpg', 'jpeg'], 'text/plain': ['txt'],
};

/** Byte length without allocating decoded file bytes in every UI/server validation. */
export function directiveBase64ByteLength(value: string): number | null {
  if (!value.length || value.length % 4 !== 0 || !/^[A-Za-z0-9+/]+={0,2}$/.test(value)) return null;
  const padding = value.endsWith('==') ? 2 : value.endsWith('=') ? 1 : 0;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  const last = alphabet.indexOf(value[value.length - padding - 1]);
  if ((padding === 2 && (last & 15) !== 0) || (padding === 1 && (last & 3) !== 0)) return null;
  return value.length / 4 * 3 - padding;
}

function checkFileType(value: { fileName: string; mimeType: z.infer<typeof regionalDirectiveMimeSchema> }, context: z.RefinementCtx) {
  const extension = value.fileName.split('.').at(-1)?.toLowerCase() ?? '';
  if (!extensions[value.mimeType].includes(extension)) {
    context.addIssue({ code: 'custom', path: ['fileName'], message: 'Filename extension does not match declared type' });
  }
}

export const regionalDirectiveUploadSchema = z.object({
  fileName, mimeType: regionalDirectiveMimeSchema, purpose,
  contentBase64: z.string().min(4).max(Math.ceil(DIRECTIVE_FILE_BYTES / 3) * 4).refine(value => {
    const length = directiveBase64ByteLength(value);
    return length !== null && length > 0 && length <= DIRECTIVE_FILE_BYTES;
  }, 'Expected canonical base64 for a file of at most 2 MiB'),
}).strict().superRefine(checkFileType);

export const regionalDirectiveAttachmentSchema = z.object({
  id: regionalIdSchema, fileName, mimeType: regionalDirectiveMimeSchema, purpose,
  byteLength: z.number().int().min(1).max(DIRECTIVE_FILE_BYTES),
  sha256: z.string().regex(/^[a-f0-9]{64}$/), uploadedAt: time,
}).strict().superRefine(checkFileType);

function checkPackage(files: z.infer<typeof regionalDirectiveUploadSchema>[], mainPurpose: 'report' | 'explanation', context: z.RefinementCtx) {
  if (files.filter(file => file.purpose === mainPurpose).length !== 1 || files.some(file => file.purpose !== mainPurpose && file.purpose !== 'supporting')) {
    context.addIssue({ code: 'custom', path: ['attachments'], message: `Exactly one ${mainPurpose} and optional supporting documents required` });
  }
  if (files.reduce((sum, file) => sum + (directiveBase64ByteLength(file.contentBase64) ?? 0), 0) > DIRECTIVE_TOTAL_BYTES) {
    context.addIssue({ code: 'custom', path: ['attachments'], message: 'Document package exceeds 6 MiB' });
  }
  if (new Set(files.map(file => file.fileName.toLocaleLowerCase('ru-RU'))).size !== files.length) {
    context.addIssue({ code: 'custom', path: ['attachments'], message: 'Duplicate filename in package' });
  }
}

const base = { assignmentId: regionalIdSchema, expectedVersion: version, idempotencyKey: z.uuid() };
const files = z.array(regionalDirectiveUploadSchema).min(1).max(DIRECTIVE_FILE_COUNT);
export const regionalDirectiveCommandSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('create'), expectedVersion: z.literal(0), idempotencyKey: z.uuid(),
    title: text(180), authorityReference: text(180), details: text(4000), dueDate: date,
    facilityIds: z.array(regionalIdSchema).min(1).max(36),
  }).strict().superRefine((value, context) => {
    if (new Set(value.facilityIds).size !== value.facilityIds.length) {
      context.addIssue({ code: 'custom', path: ['facilityIds'], message: 'Repeated recipient facility' });
    }
  }),
  z.object({ ...base, type: z.literal('progress'), progress }).strict(),
  z.object({ ...base, type: z.literal('submit'), actualCompletedDate: date, attachments: files }).strict()
    .superRefine((value, context) => checkPackage(value.attachments, 'report', context)),
  z.object({ ...base, type: z.literal('explain'), message: text(4000), attachments: files }).strict()
    .superRefine((value, context) => checkPackage(value.attachments, 'explanation', context)),
  z.object({ ...base, type: z.literal('review'), decision: z.enum(['accept', 'return_documents', 'return_work']),
    remark: z.string().max(2000).optional(),
  }).strict().superRefine((value, context) => {
    if (value.decision !== 'accept' && !value.remark?.trim()) {
      context.addIssue({ code: 'custom', path: ['remark'], message: 'Return requires a review remark' });
    }
  }),
]);

export const regionalDirectivesQuerySchema = z.object({ facilityId: regionalIdSchema.optional() }).strict();
export const regionalDirectiveCommandResultSchema = z.object({
  directiveId: regionalIdSchema, assignmentId: regionalIdSchema.nullable(), version, replayed: z.boolean(),
}).strict();

export const regionalDirectiveHistorySchema = z.object({
  id: regionalIdSchema, version, at: time, actorLabel: text(180),
  action: z.enum(['create', 'progress', 'submit', 'explain', 'review']),
  status: regionalDirectiveStatusSchema, progress, actualCompletedDate: date.nullable(),
  remark: z.string().max(4000).nullable(), attachmentIds: z.array(regionalIdSchema).max(3),
}).strict();

export const regionalDirectiveAssignmentSchema = z.object({
  id: regionalIdSchema, facilityId: regionalIdSchema, version, status: regionalDirectiveStatusSchema, progress,
  actualCompletedDate: date.nullable(), submittedAt: time.nullable(), reviewedAt: time.nullable(),
  reviewRemark: z.string().max(2000).nullable(), explanationRequired: z.boolean(),
  attachments: z.array(regionalDirectiveAttachmentSchema).max(150),
  history: z.array(regionalDirectiveHistorySchema).min(1).max(50),
}).strict().superRefine((value, context) => {
  const reported = ['submitted', 'returned_documents', 'accepted'].includes(value.status);
  if (reported && (value.actualCompletedDate === null || value.submittedAt === null || value.progress !== 100)) {
    context.addIssue({ code: 'custom', message: 'Reported completion needs its date, report timestamp and full declared progress' });
  }
  if (['returned_documents', 'returned_work', 'accepted'].includes(value.status) && value.reviewedAt === null) {
    context.addIssue({ code: 'custom', path: ['reviewedAt'], message: 'Reviewed state requires review time' });
  }
  if (['returned_documents', 'returned_work'].includes(value.status) && !value.reviewRemark?.trim()) {
    context.addIssue({ code: 'custom', path: ['reviewRemark'], message: 'Returned work requires review remark' });
  }
  if (value.status === 'accepted' && value.explanationRequired) {
    context.addIssue({ code: 'custom', message: 'Acceptance cannot omit a required late-work explanation' });
  }
  const attachmentIds = new Set(value.attachments.map(row => row.id));
  if (attachmentIds.size !== value.attachments.length || new Set(value.history.map(row => row.id)).size !== value.history.length
    || new Set(value.history.map(row => row.version)).size !== value.history.length) {
    context.addIssue({ code: 'custom', message: 'Repeated attachment or revision' });
  }
  const head = value.history[0];
  if (head && (head.version !== value.version || head.status !== value.status || head.progress !== value.progress
    || head.actualCompletedDate !== value.actualCompletedDate)) {
    context.addIssue({ code: 'custom', path: ['history', 0], message: 'Revision head does not match current assignment' });
  }
  for (const [index, row] of value.history.entries()) {
    if (row.version > value.version || row.attachmentIds.some(id => !attachmentIds.has(id))
      || (index > 0 && value.history[index - 1].version <= row.version)) {
      context.addIssue({ code: 'custom', path: ['history', index], message: 'Revision or attachment relation is invalid' });
    }
  }
});

export const regionalDirectiveSchema = z.object({
  id: regionalIdSchema, title: text(180), authorityReference: text(180), details: text(4000),
  issuedAt: time, issuedDate: date, dueDate: date,
  assignments: z.array(regionalDirectiveAssignmentSchema).min(1).max(36),
}).strict().superRefine((value, context) => {
  if (value.issuedDate > value.dueDate) context.addIssue({ code: 'custom', path: ['dueDate'], message: 'Deadline precedes issuance' });
  if (new Set(value.assignments.map(row => row.facilityId)).size !== value.assignments.length) {
    context.addIssue({ code: 'custom', path: ['assignments'], message: 'Repeated recipient facility' });
  }
  for (const [index, row] of value.assignments.entries()) {
    if (row.actualCompletedDate !== null && row.actualCompletedDate < value.issuedDate) {
      context.addIssue({ code: 'custom', path: ['assignments', index, 'actualCompletedDate'], message: 'Completion precedes issuance' });
    }
  }
});

export const regionalDirectivesSnapshotSchema = z.object({
  schemaVersion: z.literal(1), dataMode: z.literal('training'), generatedAt: time, today: date, actorId: regionalIdSchema,
  capabilities: z.object({ issue: z.boolean(), review: z.boolean() }).strict(),
  facilities: z.array(z.object({ id: regionalIdSchema, name: text(180), canSubmit: z.boolean() }).strict()).max(200),
  directives: z.array(regionalDirectiveSchema).max(100),
}).strict().superRefine((value, context) => {
  const facilityIds = new Set(value.facilities.map(row => row.id));
  const assignmentIds = new Set<string>();
  if (facilityIds.size !== value.facilities.length || new Set(value.directives.map(row => row.id)).size !== value.directives.length) {
    context.addIssue({ code: 'custom', message: 'Duplicate facility or directive' });
  }
  for (const [index, directive] of value.directives.entries()) {
    if (directive.issuedDate > value.today) context.addIssue({ code: 'custom', path: ['directives', index], message: 'Future issuance is invalid' });
    for (const assignment of directive.assignments) {
      if (!facilityIds.has(assignment.facilityId) || assignmentIds.has(assignment.id)
        || (assignment.actualCompletedDate !== null && assignment.actualCompletedDate > value.today)) {
        context.addIssue({ code: 'custom', path: ['directives', index, 'assignments'], message: 'Invalid assignment scope or completion date' });
      }
      assignmentIds.add(assignment.id);
    }
  }
});

export const regionalDirectiveAttachmentResponseSchema = z.object({
  schemaVersion: z.literal(1), attachment: regionalDirectiveAttachmentSchema,
  contentBase64: z.string().min(4).max(Math.ceil(DIRECTIVE_FILE_BYTES / 3) * 4),
}).strict().superRefine((value, context) => {
  if (directiveBase64ByteLength(value.contentBase64) !== value.attachment.byteLength) {
    context.addIssue({ code: 'custom', path: ['contentBase64'], message: 'Download length does not match stored metadata' });
  }
});

export type RegionalDirectiveCommand = z.infer<typeof regionalDirectiveCommandSchema>;
export type RegionalDirectiveCommandResult = z.infer<typeof regionalDirectiveCommandResultSchema>;
export type RegionalDirectivesQuery = z.infer<typeof regionalDirectivesQuerySchema>;
export type RegionalDirectivesSnapshot = z.infer<typeof regionalDirectivesSnapshotSchema>;
export type RegionalDirective = z.infer<typeof regionalDirectiveSchema>;
export type RegionalDirectiveAssignment = z.infer<typeof regionalDirectiveAssignmentSchema>;
export type RegionalDirectiveAttachment = z.infer<typeof regionalDirectiveAttachmentSchema>;
export type RegionalDirectiveUpload = z.infer<typeof regionalDirectiveUploadSchema>;
export type RegionalDirectiveAttachmentResponse = z.infer<typeof regionalDirectiveAttachmentResponseSchema>;

export type DirectiveTimeline = {
  completion: 'pending' | 'reported' | 'accepted';
  timeliness: 'not_due' | 'due_today' | 'overdue' | 'reported_on_time' | 'reported_late' | 'accepted_on_time' | 'accepted_late';
  progress: number; daysRemaining: number; totalDays: number; elapsedDays: number; elapsedPercent: number;
  actualCompletedDate: string | null; explanationRequired: boolean; late: boolean;
};

/** Describes saved evidence and time; never invents a required linear work pace. */
export function deriveDirectiveTimeline(directive: RegionalDirective, assignment: RegionalDirectiveAssignment, today: string): DirectiveTimeline {
  date.parse(today);
  if (!directive.assignments.some(row => row.id === assignment.id && row.facilityId === assignment.facilityId)) {
    throw new Error('DIRECTIVE_ASSIGNMENT_MISMATCH');
  }
  const daysRemaining = (Date.parse(directive.dueDate) - Date.parse(today)) / DAY_MS;
  const totalDays = (Date.parse(directive.dueDate) - Date.parse(directive.issuedDate)) / DAY_MS + 1;
  const elapsedDays = Math.min(totalDays, Math.max(0, (Date.parse(today) - Date.parse(directive.issuedDate)) / DAY_MS));
  const reported = ['submitted', 'returned_documents', 'accepted'].includes(assignment.status) && assignment.actualCompletedDate !== null;
  const completion = assignment.status === 'accepted' ? 'accepted' : reported ? 'reported' : 'pending';
  const late = reported ? assignment.actualCompletedDate! > directive.dueDate : daysRemaining < 0;
  const timeliness = completion === 'accepted' ? late ? 'accepted_late' : 'accepted_on_time'
    : reported ? late ? 'reported_late' : 'reported_on_time'
      : daysRemaining < 0 ? 'overdue' : daysRemaining === 0 ? 'due_today' : 'not_due';
  return { completion, timeliness, progress: assignment.progress, daysRemaining, totalDays, elapsedDays,
    elapsedPercent: elapsedDays / totalDays * 100, actualCompletedDate: reported ? assignment.actualCompletedDate : null,
    explanationRequired: assignment.explanationRequired, late };
}

/** UI affordances only. The transaction must independently reauthorize every command. */
export function allowedDirectiveActions(snapshot: RegionalDirectivesSnapshot, assignment: RegionalDirectiveAssignment) {
  const belongs = snapshot.directives.some(row => row.assignments.some(item => item.id === assignment.id && item.facilityId === assignment.facilityId));
  const head = belongs && snapshot.facilities.some(row => row.id === assignment.facilityId && row.canSubmit);
  const review = belongs && snapshot.capabilities.review && assignment.status === 'submitted';
  return {
    progress: head && ['assigned', 'in_progress', 'returned_work'].includes(assignment.status),
    submit: head && ['assigned', 'in_progress', 'returned_documents', 'returned_work'].includes(assignment.status),
    explain: head && assignment.explanationRequired && assignment.status !== 'accepted',
    review,
    accept: review && !assignment.explanationRequired,
    returnDocuments: review,
    returnWork: review,
  };
}
