import { Buffer } from 'node:buffer';
import { describe, expect, it } from 'vitest';
import {
  allowedDirectiveActions, deriveDirectiveTimeline, directiveBase64ByteLength,
  DIRECTIVE_FILE_BYTES, regionalDirectiveAttachmentResponseSchema, regionalDirectiveCommandSchema,
  regionalDirectivesQuerySchema, regionalDirectivesSnapshotSchema, regionalDirectiveUploadSchema,
  type RegionalDirective, type RegionalDirectiveAssignment, type RegionalDirectiveCommand,
  type RegionalDirectiveUpload, type RegionalDirectivesSnapshot,
} from './directives';

const key = '9063dd89-a573-46f7-afd8-0cde8a85be33';
const commandBase = { assignmentId: 'assignment-a', expectedVersion: 1, idempotencyKey: key };
function upload(purpose: RegionalDirectiveUpload['purpose'] = 'report'): RegionalDirectiveUpload {
  return { fileName: 'Отчёт.txt', mimeType: 'text/plain', purpose, contentBase64: 'YWJj' };
}
function assignment(overrides: Partial<RegionalDirectiveAssignment> = {}): RegionalDirectiveAssignment {
  const row: RegionalDirectiveAssignment = {
    id: 'assignment-a', facilityId: 'hospital-a', version: 1, status: 'assigned', progress: 0,
    actualCompletedDate: null, submittedAt: null, reviewedAt: null, reviewRemark: null,
    explanationRequired: false, attachments: [], history: [], ...overrides,
  };
  row.history = [{ id: 'revision-a', version: row.version, at: '2026-10-01T05:00:00Z', actorLabel: 'Руководитель',
    action: row.status === 'assigned' ? 'create' : 'submit', status: row.status, progress: row.progress,
    actualCompletedDate: row.actualCompletedDate, remark: null, attachmentIds: [] }];
  return row;
}
function directive(row = assignment()): RegionalDirective {
  return { id: 'directive-a', title: 'Подготовить кабинет', authorityReference: 'Приказ №15',
    details: 'Учебное поручение без медицинских текстов', issuedAt: '2026-10-01T05:00:00Z',
    issuedDate: '2026-10-01', dueDate: '2026-10-10', assignments: [row] };
}
function snapshot(row = assignment()): RegionalDirectivesSnapshot {
  return { schemaVersion: 1, dataMode: 'training', generatedAt: '2026-10-09T05:00:00Z', today: '2026-10-09',
    actorId: 'head-a', capabilities: { issue: false, review: false },
    facilities: [{ id: 'hospital-a', name: 'Больница А', canSubmit: true }], directives: [directive(row)] };
}
function submitted(overrides: Partial<RegionalDirectiveAssignment> = {}) {
  return assignment({ version: 2, status: 'submitted', progress: 100, actualCompletedDate: '2026-10-05',
    submittedAt: '2026-10-08T05:00:00Z', ...overrides });
}

describe('strict directive commands', () => {
  const create: RegionalDirectiveCommand = { type: 'create', expectedVersion: 0, idempotencyKey: key,
    title: 'Проверить оснащение', authorityReference: 'Письмо №15', details: 'Проверить перечень оснащения',
    dueDate: '2026-10-31', facilityIds: ['hospital-a', 'polyclinic-b'] };

  it('accepts a fixed-date multi-facility issue command and exact empty/single-facility query', () => {
    expect(regionalDirectiveCommandSchema.parse(create)).toEqual(create);
    expect(regionalDirectivesQuerySchema.parse({})).toEqual({});
    expect(regionalDirectivesQuerySchema.parse({ facilityId: 'hospital-a' })).toEqual({ facilityId: 'hospital-a' });
  });

  it.each([
    { expectedVersion: 1 }, { idempotencyKey: 'retry-anything' }, { facilityIds: [] },
    { facilityIds: ['hospital-a', 'hospital-a'] }, { facilityIds: Array.from({ length: 37 }, (_, i) => `facility-${i}`) },
    { dueDate: '2026-02-29' }, { dueDate: '2026-99-99' }, { dueDate: '2026-10-01T00:00:00Z' },
    { title: ' ' }, { title: 'a'.repeat(181) }, { details: 'a'.repeat(4001) },
    { userId: 'other-admin' }, { attachments: [upload()] },
  ])('rejects malformed issue/authority fields: %j', patch => {
    expect(regionalDirectiveCommandSchema.safeParse({ ...create, ...patch }).success).toBe(false);
  });

  it('has no deadline-edit or deadline-extension command', () => {
    for (const type of ['reschedule', 'extend', 'change_due_date', 'delete']) {
      expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type, dueDate: '2027-01-01' }).success).toBe(false);
    }
    expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'progress', progress: 50, dueDate: '2027-01-01' }).success).toBe(false);
    expect(regionalDirectivesQuerySchema.safeParse({ actorId: 'admin' }).success).toBe(false);
  });

  it.each([0, 85, 100])('accepts declared progress %i without automatically submitting a report', progress => {
    expect(regionalDirectiveCommandSchema.parse({ ...commandBase, type: 'progress', progress })).toMatchObject({ type: 'progress', progress });
  });

  it.each([-1, 100.1, 101, Infinity, NaN])('rejects invalid progress %s', progress => {
    expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'progress', progress }).success).toBe(false);
  });

  it('requires a main report and allows two supporting documents', () => {
    const files = [upload(), { ...upload('supporting'), fileName: 'Акт.txt' }, { ...upload('supporting'), fileName: 'Приложение.txt' }];
    expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'submit', actualCompletedDate: '2026-10-08', attachments: files }).success).toBe(true);
    for (const attachments of [[], [upload('supporting')], [upload('explanation')], [upload(), { ...upload(), fileName: 'Другой.txt' }], [...files, { ...upload('supporting'), fileName: 'Четвёртый.txt' }]]) {
      expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'submit', actualCompletedDate: '2026-10-08', attachments }).success).toBe(false);
    }
  });

  it('requires an uploaded explanatory letter, not just text or a report attachment', () => {
    const value = { ...commandBase, type: 'explain', message: 'Причина просрочки', attachments: [upload('explanation')] };
    expect(regionalDirectiveCommandSchema.safeParse(value).success).toBe(true);
    expect(regionalDirectiveCommandSchema.safeParse({ ...value, attachments: [] }).success).toBe(false);
    expect(regionalDirectiveCommandSchema.safeParse({ ...value, attachments: [upload()] }).success).toBe(false);
    expect(regionalDirectiveCommandSchema.safeParse({ ...value, message: ' ' }).success).toBe(false);
  });

  it('separates accepting from two return decisions, requiring a remark for either return', () => {
    expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'review', decision: 'accept' }).success).toBe(true);
    for (const decision of ['return_documents', 'return_work']) {
      expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'review', decision, remark: 'Исправить замечания' }).success).toBe(true);
      for (const remark of [undefined, '', ' ']) expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'review', decision, remark }).success).toBe(false);
    }
    expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'review', decision: 'accept', actualCompletedDate: '2026-09-01' }).success).toBe(false);
  });
});

describe('bounded attachment wire contracts', () => {
  it.each(['', 'YQ', 'YQ=', 'YR==', 'YWJ=', 'YWJj\n', 'YW Jj', 'data:text/plain;base64,YWJj', '====', 'АААА'])('rejects noncanonical base64 %j', value => {
    expect(directiveBase64ByteLength(value)).toBeNull();
    expect(regionalDirectiveUploadSchema.safeParse({ ...upload(), contentBase64: value }).success).toBe(false);
  });

  it.each([['YQ==', 1], ['YWI=', 2], ['YWJj', 3]] as const)('measures canonical base64 %s', (value, length) => {
    expect(directiveBase64ByteLength(value)).toBe(length);
  });

  it('validates maximum-size payloads without recursive regular expression stack overflow', () => {
    const maximum = Buffer.alloc(DIRECTIVE_FILE_BYTES, 97).toString('base64');
    expect(directiveBase64ByteLength(maximum)).toBe(DIRECTIVE_FILE_BYTES);
    expect(regionalDirectiveUploadSchema.safeParse({ ...upload(), contentBase64: maximum }).success).toBe(true);
    expect(regionalDirectiveUploadSchema.safeParse({ ...upload(), contentBase64: Buffer.alloc(DIRECTIVE_FILE_BYTES + 1).toString('base64') }).success).toBe(false);
    const attachments = ['Отчёт.txt', 'Акт.txt', 'Приложение.txt'].map((fileName, index) => ({ ...upload(index === 0 ? 'report' : 'supporting'), fileName, contentBase64: maximum }));
    expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'submit', actualCompletedDate: '2026-10-08', attachments }).success).toBe(true);
  });

  it.each(['../report.txt', 'C:\\report.txt', 'report/one.txt', '.hidden.txt', 'CON.txt', 'LPT1.txt',
    'report.txt ', ' report.txt', 'report.txt.', 'report\n.txt', 'report\u202e.txt', 'report:stream.txt', 'report?.txt'])('rejects unsafe download filename %j', fileName => {
    expect(regionalDirectiveUploadSchema.safeParse({ ...upload(), fileName }).success).toBe(false);
  });

  it('requires matching allowed extension/type and rejects extra caller-declared hash or size', () => {
    for (const patch of [{ fileName: 'report.exe' }, { mimeType: 'text/html', fileName: 'report.html' },
      { mimeType: 'application/pdf' }, { sha256: 'a'.repeat(64) }, { byteLength: 3 }]) {
      expect(regionalDirectiveUploadSchema.safeParse({ ...upload(), ...patch }).success).toBe(false);
    }
    expect(regionalDirectiveUploadSchema.safeParse({ ...upload(), fileName: 'Акт.PDF', mimeType: 'application/pdf' }).success).toBe(true);
  });

  it('rejects duplicate package filenames ignoring case', () => {
    expect(regionalDirectiveCommandSchema.safeParse({ ...commandBase, type: 'submit', actualCompletedDate: '2026-10-08',
      attachments: [upload(), { ...upload('supporting'), fileName: 'ОТЧЁТ.TXT' }] }).success).toBe(false);
  });

  it('binds downloaded bytes to declared bounded metadata', () => {
    const value = { schemaVersion: 1, attachment: { id: 'file-a', fileName: 'Отчёт.txt', mimeType: 'text/plain', purpose: 'report',
      byteLength: 3, sha256: 'a'.repeat(64), uploadedAt: '2026-10-08T05:00:00Z' }, contentBase64: 'YWJj' };
    expect(regionalDirectiveAttachmentResponseSchema.safeParse(value).success).toBe(true);
    expect(regionalDirectiveAttachmentResponseSchema.safeParse({ ...value, contentBase64: 'YWI=' }).success).toBe(false);
    expect(regionalDirectiveAttachmentResponseSchema.safeParse({ ...value, password: 'unexpected' }).success).toBe(false);
  });
});

describe('strict scope and revision snapshot', () => {
  it('parses explicit dedicated grants without inferring platform administrator rights', () => {
    expect(regionalDirectivesSnapshotSchema.parse(snapshot())).toEqual(snapshot());
    const noGrant = { ...snapshot(), capabilities: { issue: false, review: false }, facilities: [], directives: [] };
    expect(regionalDirectivesSnapshotSchema.safeParse(noGrant).success).toBe(true);
    expect(regionalDirectivesSnapshotSchema.safeParse({ ...snapshot(), actorId: undefined }).success).toBe(false);
    expect(regionalDirectivesSnapshotSchema.safeParse({ ...snapshot(), role: 'administrator' }).success).toBe(false);
  });

  it.each(['unknown-facility', 'duplicate-directive', 'duplicate-assignment', 'future-completion',
    'pre-issue-completion', 'deadline-before-issue', 'future-issue', 'head-mismatch', 'missing-history',
    'missing-attachment', 'duplicate-version', 'accepted-without-report', 'returned-without-remark', 'accepted-without-explanation'])('rejects inconsistent saved state: %s', kind => {
    const row = submitted(); const value = snapshot(row);
    if (kind === 'unknown-facility') row.facilityId = 'other';
    if (kind === 'duplicate-directive') value.directives.push({ ...value.directives[0] });
    if (kind === 'duplicate-assignment') value.directives[0].assignments.push({ ...row });
    if (kind === 'future-completion') { row.actualCompletedDate = '2026-10-10'; row.history[0].actualCompletedDate = row.actualCompletedDate; }
    if (kind === 'pre-issue-completion') { row.actualCompletedDate = '2026-09-30'; row.history[0].actualCompletedDate = row.actualCompletedDate; }
    if (kind === 'deadline-before-issue') value.directives[0].dueDate = '2026-09-30';
    if (kind === 'future-issue') value.directives[0].issuedDate = '2026-10-10';
    if (kind === 'head-mismatch') row.history[0].progress = 99;
    if (kind === 'missing-history') row.history = [];
    if (kind === 'missing-attachment') row.history[0].attachmentIds = ['unknown'];
    if (kind === 'duplicate-version') row.history.push({ ...row.history[0], id: 'duplicate-version' });
    if (kind === 'accepted-without-report') { row.status = 'accepted'; row.submittedAt = null; }
    if (kind === 'returned-without-remark') { row.status = 'returned_documents'; row.reviewRemark = ' '; }
    if (kind === 'accepted-without-explanation') { row.status = 'accepted'; row.explanationRequired = true; }
    expect(regionalDirectivesSnapshotSchema.safeParse(value).success).toBe(false);
  });
});

describe('completion, timeliness and review remain distinct', () => {
  it('shows the same 85% against elapsed time without inventing a linear expected pace', () => {
    const row = assignment({ status: 'in_progress', progress: 85 }); const work = directive(row);
    const early = deriveDirectiveTimeline(work, row, '2026-10-03');
    const late = deriveDirectiveTimeline(work, row, '2026-10-11');
    expect(early).toMatchObject({ progress: 85, completion: 'pending', timeliness: 'not_due', elapsedPercent: 20 });
    expect(late).toMatchObject({ progress: 85, completion: 'pending', timeliness: 'overdue', elapsedPercent: 100 });
    expect(early).not.toHaveProperty('expectedProgress'); expect(late).not.toHaveProperty('qualityScore');
  });

  it('does not claim that declared 100% is an accepted or submitted report', () => {
    const row = assignment({ status: 'in_progress', progress: 100 });
    expect(deriveDirectiveTimeline(directive(row), row, '2026-10-09')).toMatchObject({ progress: 100, completion: 'pending' });
  });

  it('keeps timely actual work timely when submitted or accepted later', () => {
    const row = submitted({ submittedAt: '2026-10-15T05:00:00Z' }); const work = directive(row);
    expect(deriveDirectiveTimeline(work, row, '2026-10-20')).toMatchObject({ completion: 'reported', timeliness: 'reported_on_time', late: false });
    row.status = 'accepted'; row.reviewedAt = '2026-10-25T05:00:00Z';
    expect(deriveDirectiveTimeline(work, row, '2026-10-26')).toMatchObject({ completion: 'accepted', timeliness: 'accepted_on_time', late: false });
  });

  it('marks accepted late work late even with an explanatory letter and later review', () => {
    const row = submitted({ status: 'accepted', actualCompletedDate: '2026-10-11', reviewedAt: '2026-10-25T05:00:00Z', explanationRequired: false });
    expect(deriveDirectiveTimeline(directive(row), row, '2026-10-26')).toMatchObject({ completion: 'accepted', timeliness: 'accepted_late', late: true });
  });

  it('document correction preserves completion; returned work is incomplete until resubmitted', () => {
    const row = submitted({ status: 'returned_documents', reviewedAt: '2026-10-20T05:00:00Z', reviewRemark: 'Исправить приложение' });
    const work = directive(row);
    expect(deriveDirectiveTimeline(work, row, '2026-10-21')).toMatchObject({ completion: 'reported', timeliness: 'reported_on_time', actualCompletedDate: '2026-10-05' });
    row.status = 'returned_work';
    expect(deriveDirectiveTimeline(work, row, '2026-10-21')).toMatchObject({ completion: 'pending', timeliness: 'overdue', actualCompletedDate: null });
  });

  it('treats the fixed deadline day inclusively and supports single-day assignments', () => {
    const row = assignment(); const work = directive(row); work.issuedDate = '2026-10-10';
    expect(deriveDirectiveTimeline(work, row, '2026-10-10')).toMatchObject({ timeliness: 'due_today', daysRemaining: 0, totalDays: 1, elapsedPercent: 0 });
    expect(deriveDirectiveTimeline(work, row, '2026-10-11')).toMatchObject({ timeliness: 'overdue', elapsedPercent: 100 });
  });

  it('rejects an unrelated assignment and malformed reference date', () => {
    expect(() => deriveDirectiveTimeline(directive(), assignment({ id: 'unknown' }), '2026-10-09')).toThrow('DIRECTIVE_ASSIGNMENT_MISMATCH');
    expect(() => deriveDirectiveTimeline(directive(), assignment(), '2026-02-30')).toThrow();
  });
});

describe('dedicated role UI affordances (transaction separately reauthorizes)', () => {
  it('lets only the assigned head progress and submit, not approve', () => {
    const value = snapshot();
    expect(allowedDirectiveActions(value, value.directives[0].assignments[0])).toEqual({ progress: true, submit: true, explain: false,
      review: false, accept: false, returnDocuments: false, returnWork: false });
    value.facilities[0].canSubmit = false;
    expect(allowedDirectiveActions(value, value.directives[0].assignments[0]).submit).toBe(false);
  });

  it('allows late report submission but blocks acceptance until required current-cycle explanation', () => {
    const row = submitted({ explanationRequired: true }); const value = snapshot(row);
    value.capabilities = { issue: true, review: true }; value.facilities[0].canSubmit = false;
    expect(allowedDirectiveActions(value, row)).toMatchObject({ review: true, accept: false, returnDocuments: true, returnWork: true, explain: false });
    row.explanationRequired = false;
    expect(allowedDirectiveActions(value, row).accept).toBe(true);
    row.status = 'in_progress'; row.explanationRequired = true; value.facilities[0].canSubmit = true;
    expect(allowedDirectiveActions(value, row)).toMatchObject({ submit: true, explain: true, review: false });
  });

  it('does not allow progress to change a report awaiting review or document-only correction', () => {
    for (const status of ['submitted', 'returned_documents', 'accepted'] as const) {
      const row = submitted({ status }); const value = snapshot(row);
      expect(allowedDirectiveActions(value, row).progress).toBe(false);
      expect(allowedDirectiveActions(value, row).submit).toBe(status === 'returned_documents');
    }
  });

  it('does not show actions for an assignment outside the authorized payload', () => {
    expect(Object.values(allowedDirectiveActions(snapshot(), assignment({ id: 'unknown' })))).toEqual(Array(7).fill(false));
  });
});
