import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { regionalDirectivesSnapshotSchema, type RegionalDirectiveAssignment, type RegionalDirectiveCommand, type RegionalDirectivesSnapshot } from '@/lib/regional/directives';
import { currentDirectiveAttachments, directiveAccessLost, directiveMinCompletionDate, directivePendingRequest, DirectiveRequestError,
  directiveRows, directiveTiming, directiveWriteRejected, loadRegionalDirectives, prepareDirectiveUploads, RegionalDirectiveDetail,
  RegionalDirectivesPanel, sendRegionalDirective } from './regional-directives-panel';

const time = '2026-10-09T10:00:00Z';
const uuid = '9063dd89-a573-46f7-afd8-0cde8a85be33';
function snapshot(patch: Partial<RegionalDirectiveAssignment> = {}): RegionalDirectivesSnapshot {
  return regionalDirectivesSnapshotSchema.parse({ schemaVersion: 1, dataMode: 'training', actorId: 'head-a', generatedAt: time, today: '2026-10-09',
    capabilities: { issue: false, review: false }, facilities: [{ id: 'hospital-a', name: 'Больница А', canSubmit: true }],
    directives: [{ id: 'directive-a', title: 'Подготовить кабинет', authorityReference: 'Письмо №12', details: 'Подготовить оборудование и приложить акт.',
      issuedAt: '2026-10-01T10:00:00Z', issuedDate: '2026-10-01', dueDate: '2026-10-08', assignments: [{
        id: 'assignment-a', facilityId: 'hospital-a', version: 1, status: 'in_progress', progress: 85, actualCompletedDate: null,
        submittedAt: null, reviewedAt: null, reviewRemark: null, explanationRequired: false, attachments: [], ...patch,
        history: [{ id: 'history-current', version: patch.version ?? 1, at: time, actorLabel: 'Руководитель', action: 'progress', status: patch.status ?? 'in_progress',
          progress: patch.progress ?? 85, actualCompletedDate: patch.actualCompletedDate ?? null, remark: patch.reviewRemark ?? null, attachmentIds: [] }],
      }] }],
  });
}
function report(): RegionalDirectiveAssignment['attachments'][number] {
  return { id: 'attachment-a', fileName: 'Отчёт.txt', mimeType: 'text/plain', byteLength: 3, sha256: 'a'.repeat(64), purpose: 'report', uploadedAt: time };
}
function renderDetail(value: RegionalDirectivesSnapshot, disabled = false) {
  const execute = vi.fn(async () => true);
  return { html: renderToStaticMarkup(createElement(RegionalDirectiveDetail, { row: directiveRows(value)[0], snapshot: value, disabled, execute })), execute };
}
function command(): RegionalDirectiveCommand {
  return { type: 'progress', assignmentId: 'assignment-a', expectedVersion: 1, idempotencyKey: uuid, progress: 90 };
}
const signal = () => new AbortController().signal;
afterEach(() => vi.unstubAllGlobals());

describe('directive workflow rendering', () => {
  it('does not request or manufacture protected reports during first render', () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    const html = renderToStaticMarkup(createElement(RegionalDirectivesPanel));
    expect(html).toContain('Загружаем поручения из базы'); expect(html).not.toContain('Новое поручение'); expect(html).not.toContain('85%'); expect(fetch).not.toHaveBeenCalled();
  });
  it('gives the assigned institution head simple progress, report and required-file controls, not review powers', () => {
    const { html, execute } = renderDetail(snapshot());
    expect(html).toContain('Сохранить прогресс'); expect(html).toContain('Отправить на проверку'); expect(html).toContain('type="file"');
    expect(html).toContain('name="primary"'); expect(html).toContain('Дата фактического выполнения');
    expect(html).not.toContain('Подтвердить выполнение'); expect(html).not.toContain('Перенести срок'); expect(execute).not.toHaveBeenCalled();
  });
  it('hides all head actions from a user without the facility submission grant', () => {
    const value = snapshot(); value.facilities[0].canSubmit = false;
    const { html } = renderDetail(value);
    expect(html).not.toContain('Сохранить прогресс'); expect(html).not.toContain('type="file"'); expect(html).toContain('назначенный руководитель');
  });
  it('allows review only to the dedicated reviewer and separates accept from two return reasons', () => {
    const value = snapshot({ status: 'submitted', progress: 100, actualCompletedDate: '2026-10-08', submittedAt: time });
    value.capabilities.review = true; value.facilities[0].canSubmit = false;
    const { html } = renderDetail(value);
    expect(html).toContain('Подтвердить выполнение'); expect(html).toContain('Вернуть документы на исправление'); expect(html).toContain('Вернуть работу на доработку');
    expect(html).not.toContain('Отправить на проверку'); expect(html).not.toContain('type="file"');
  });
  it('shows an explanatory-letter form for late work and prevents reviewer acceptance before the letter', () => {
    const value = snapshot({ status: 'submitted', progress: 100, actualCompletedDate: '2026-10-09', submittedAt: time, explanationRequired: true });
    expect(renderDetail(value).html).toContain('Отправить объяснение');
    value.capabilities.review = true; value.facilities[0].canSubmit = false;
    const { html } = renderDetail(value);
    expect(html).toContain('объяснительное письмо'); expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Подтвердить выполнение/);
  });
  it('keeps the actual completion date fixed when only documents are returned', () => {
    const value = snapshot({ status: 'returned_documents', progress: 100, actualCompletedDate: '2026-10-07', submittedAt: time, reviewedAt: time, reviewRemark: 'Исправить подпись' });
    const { html } = renderDetail(value);
    expect(html).toContain('Исправленные документы'); expect(html).toContain('Исправление документов не меняет дату работы');
    expect(html).not.toContain('name="actualCompletedDate"'); expect(html).not.toContain('Сохранить прогресс'); expect(html).toContain('Исправить подпись');
  });
  it('requires rework completion no earlier than the return day in Kazakhstan, allowing same-day completion', () => {
    const value = snapshot({ status: 'returned_work', reviewedAt: '2026-10-08T20:30:00Z', reviewRemark: 'Работа не закончена' });
    const row = directiveRows(value)[0];
    expect(directiveMinCompletionDate(row.directive, row.assignment)).toBe('2026-10-09');
    expect(renderDetail(value).html).toContain('min="2026-10-09"');
  });
  it('keeps the work-return date after saving progress changes status back to in_progress', () => {
    const value = snapshot({ status: 'in_progress', version: 4, progress: 90, reviewedAt: '2026-10-08T20:30:00Z', reviewRemark: 'Работа не закончена' });
    const row = directiveRows(value)[0];
    row.assignment.history.push({ id: 'history-return', version: 3, at: '2026-10-08T20:30:00Z', actorLabel: 'Администратор', action: 'review', status: 'returned_work',
      progress: 80, actualCompletedDate: null, remark: 'Закончить работу', attachmentIds: [] });
    expect(directiveMinCompletionDate(row.directive, row.assignment)).toBe('2026-10-09');
    expect(renderDetail(value).html).toContain('min="2026-10-09"');
    row.assignment.history = row.assignment.history.slice(0, 1);
    expect(directiveMinCompletionDate(row.directive, row.assignment)).toBe('2026-10-09');
  });
  it('does not treat a late review as late work and keeps genuinely late acceptance explicit', () => {
    const value = snapshot({ status: 'accepted', progress: 100, actualCompletedDate: '2026-10-08', submittedAt: time, reviewedAt: time });
    let row = directiveRows(value)[0]; expect(directiveTiming(row.directive, row.assignment, value.today).label).toBe('Выполнено в срок');
    value.directives[0].assignments[0].actualCompletedDate = '2026-10-09'; row = directiveRows(value)[0];
    expect(directiveTiming(row.directive, row.assignment, value.today).label).toBe('Выполнено с опозданием');
    const { html } = renderDetail(value); expect(html).not.toContain('type="file"'); expect(html).not.toContain('Сохранить прогресс');
  });
  it('does not invent a linear target pace from 85 percent progress', () => {
    const value = snapshot(); const row = directiveRows(value)[0];
    expect(directiveTiming(row.directive, row.assignment, value.today).label).toContain('Срок истёк');
    const { html } = renderDetail(value); expect(html).toContain('85%'); expect(html).not.toContain('Должно быть'); expect(html).not.toContain('Ожидаемый прогресс');
  });
  it('compares early 85 percent with elapsed calendar days without inventing a pace score', () => {
    const value = snapshot(); value.today = '2026-10-04'; value.directives[0].dueDate = '2026-10-31';
    const { html } = renderDetail(value);
    expect(html).toContain('Работа заявлена'); expect(html).toContain('85%');
    expect(html).toContain('Прошло 3 из 31 дней'); expect(html).toContain('Осталось 27 дней');
    expect(html).toContain('aria-label="Заявленный прогресс работы"');
    expect(html).toContain('aria-label="Использованная доля срока"');
    expect(html).not.toContain('Опережение'); expect(html).not.toContain('Должно быть');
  });
  it('distinguishes the same 85 percent after its deadline and shows the exact overdue days', () => {
    const { html } = renderDetail(snapshot());
    expect(html).toContain('85%'); expect(html).toContain('Прошло 8 из 8 дней');
    expect(html).toContain('Просрочено на 1 день'); expect(html).toContain('data-overdue="true"');
    expect(html).not.toContain('Выполнение принято');
  });
  it('shows due-today explicitly and never treats a reported 100 percent as approval', () => {
    const value = snapshot({ progress: 100 }); value.today = value.directives[0].dueDate;
    const { html } = renderDetail(value);
    expect(html).toContain('Срок сегодня'); expect(html).toContain('100%');
    expect(html).toContain('Выполнение подтверждает администратор'); expect(html).not.toContain('Выполнение принято');
  });
  it('keeps accepted on-time work on time even when its review happens after the deadline', () => {
    const value = snapshot({ status: 'accepted', progress: 100, actualCompletedDate: '2026-10-08', submittedAt: time, reviewedAt: time });
    const { html } = renderDetail(value);
    expect(html).toContain('Выполнение принято'); expect(html).toContain('Выполнено в срок');
    expect(html).toContain('Прошло 8 из 8 дней');
    expect(html).not.toContain('Просрочено на'); expect(html).not.toContain('data-overdue="true"');
  });
  it('uses authenticated constant-path attachment downloads, preserves revisions and escapes supplied text', () => {
    const value = snapshot(); const row = value.directives[0].assignments[0];
    row.attachments = [report()]; row.history = [{ id: 'history-a', version: 1, at: time, actorLabel: 'Руководитель', action: 'submit', status: 'submitted',
      progress: 100, actualCompletedDate: '2026-10-08', remark: '<script>unsafe</script>', attachmentIds: ['attachment-a'] }];
    value.directives[0].details = '<img src=x onerror=alert(1)>';
    const { html } = renderDetail(value);
    expect(html).toContain('href="/api/regional/v1/directive-attachments/attachment-a"'); expect(html).toContain('download=""');
    expect(html).toContain('&lt;script&gt;unsafe&lt;/script&gt;'); expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;'); expect(html).not.toContain('<script>unsafe');
    expect(html).toContain('Ранее отправленные документы не заменяются');
  });
  it('distinguishes current-cycle documents from a previous work cycle', () => {
    const value = snapshot({ version: 5 }); const row = value.directives[0].assignments[0];
    row.attachments = [report(), { ...report(), id: 'attachment-b', fileName: 'Новый отчёт.txt' }];
    row.history = [{ id: 'history-a', version: 2, at: time, actorLabel: 'Руководитель', action: 'submit', status: 'submitted', progress: 100, actualCompletedDate: '2026-10-08', remark: null, attachmentIds: ['attachment-a'] },
      { id: 'history-b', version: 3, at: time, actorLabel: 'Администратор', action: 'review', status: 'returned_work', progress: 85, actualCompletedDate: null, remark: 'Доработать', attachmentIds: [] },
      { id: 'history-c', version: 5, at: time, actorLabel: 'Руководитель', action: 'submit', status: 'submitted', progress: 100, actualCompletedDate: '2026-10-09', remark: null, attachmentIds: ['attachment-b'] }];
    expect(currentDirectiveAttachments(row).map(file => file.id)).toEqual(['attachment-b']);
    expect(row.attachments).toHaveLength(2);
  });
});

describe('local document preparation', () => {
  it('encodes real chosen bytes once, preserving report/supporting purposes and Unicode names', async () => {
    const primary = new File(['Отчёт'], 'Отчёт.txt', { type: 'text/plain' }); const extra = new File(['abc'], 'Акт.txt', { type: 'text/plain' });
    const files = await prepareDirectiveUploads(primary, [extra], 'report');
    expect(files).toHaveLength(2); expect(files[0]).toMatchObject({ fileName: 'Отчёт.txt', purpose: 'report', mimeType: 'text/plain' });
    expect(files[0].contentBase64).toBe(Buffer.from('Отчёт').toString('base64')); expect(files[1]).toMatchObject({ purpose: 'supporting', contentBase64: 'YWJj' });
  });
  it('allows an empty browser MIME only when the extension resolves to a supported declared type', async () => {
    expect((await prepareDirectiveUploads(new File(['abc'], 'Письмо.txt'), [], 'explanation'))[0].purpose).toBe('explanation');
  });
  it('requires the main uploaded document and bounds number, size and unique names before encoding', async () => {
    const file = new File(['abc'], 'Отчёт.txt', { type: 'text/plain' });
    await expect(prepareDirectiveUploads(undefined, [], 'report')).rejects.toThrow('Прикрепите');
    await expect(prepareDirectiveUploads(file, [file, file, file], 'report')).rejects.toThrow('не более двух');
    await expect(prepareDirectiveUploads(file, [file], 'report')).rejects.toThrow('различаться');
    await expect(prepareDirectiveUploads(new File([], 'Пустой.txt'), [], 'report')).rejects.toThrow('2 МБ');
    await expect(prepareDirectiveUploads(new File([new Uint8Array(2 * 1024 * 1024 + 1)], 'Большой.txt'), [], 'report')).rejects.toThrow('2 МБ');
  });
  it.each([['bad.html', 'text/html'], ['bad.pdf', 'text/plain'], ['../bad.txt', 'text/plain'], ['CON.txt', 'text/plain']])('rejects unsupported or unsafe filename/type %s', async (name, type) => {
    await expect(prepareDirectiveUploads(new File(['abc'], name, { type }), [], 'report')).rejects.toThrow();
  });
});

describe('protected reads and pending write reconciliation', () => {
  it('validates authorized scope and no-store GET without inventing data', async () => {
    const fetch = vi.fn(async () => Response.json(snapshot())); vi.stubGlobal('fetch', fetch);
    await expect(loadRegionalDirectives('hospital-a', signal())).resolves.toEqual(snapshot());
    expect(fetch).toHaveBeenCalledWith('/api/regional/v1/directives?facilityId=hospital-a', expect.objectContaining({ credentials: 'same-origin', cache: 'no-store' }));
    await expect(loadRegionalDirectives('hospital-b', signal())).rejects.toThrow('другого учреждения');
  });
  it('does not retain a protected late read when the transport ignores abort', async () => {
    const controller = new AbortController(); vi.stubGlobal('fetch', vi.fn(async () => { controller.abort(); return Response.json(snapshot()); }));
    await expect(loadRegionalDirectives(undefined, controller.signal)).rejects.toThrow();
  });
  it('does not expose server error content and identifies denied or changed sessions', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ error: { code: 'DIRECTIVE_ACCESS_DENIED', message: 'database-secret' } }, { status: 403 })));
    await expect(loadRegionalDirectives(undefined, signal())).rejects.toThrow('Доступ к поручениям изменился');
    expect(directiveAccessLost(new DirectiveRequestError(409, 'SESSION_CHANGED', 'changed'))).toBe(true);
    expect(directiveAccessLost(new DirectiveRequestError(401, undefined, 'expired'))).toBe(true);
  });
  it('freezes the original serialized command and files across retries, blocking a different actor or command', () => {
    const initial = command(); const pending = directivePendingRequest('head-a', initial);
    if (initial.type === 'progress') initial.progress = 5;
    expect(JSON.parse(pending.body).progress).toBe(90);
    expect(directivePendingRequest('head-a', initial, pending)).toBe(pending);
    expect(() => directivePendingRequest('head-b', initial, pending)).toThrow('тем же сотрудником');
    expect(() => directivePendingRequest('head-a', { ...initial, idempotencyKey: 'cf7346f8-e3b8-4cd6-9b1d-95c6037cf59f' }, pending)).toThrow('предыдущего');
  });
  it('returns known committed acknowledgement and sends exactly the preserved JSON body', async () => {
    const next = snapshot({ version: 2, progress: 90 });
    const receipt = { result: { directiveId: 'directive-a', assignmentId: 'assignment-a', version: 2, replayed: true }, snapshot: next };
    const fetch = vi.fn(async () => Response.json(receipt)); vi.stubGlobal('fetch', fetch);
    const pending = directivePendingRequest('head-a', command());
    await expect(sendRegionalDirective(pending, signal())).resolves.toEqual(receipt);
    expect(fetch).toHaveBeenCalledWith('/api/regional/v1/directives/commands', expect.objectContaining({ method: 'POST', body: pending.body, credentials: 'same-origin', cache: 'no-store',
      headers: { 'Content-Type': 'application/json', 'X-Orion-Directive-Actor': 'head-a' } }));
  });
  it.each(['actor', 'assignment', 'directive', 'malformed'])('rejects a wrong %s acknowledgement without releasing uncertainty', async kind => {
    const value = snapshot({ version: 2, progress: 90 });
    const receipt = { result: { directiveId: 'directive-a', assignmentId: 'assignment-a', version: 2, replayed: false }, snapshot: value };
    if (kind === 'actor') value.actorId = 'head-b';
    if (kind === 'assignment') receipt.result.assignmentId = 'assignment-b';
    if (kind === 'directive') receipt.result.directiveId = 'directive-b';
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(kind === 'malformed' ? { ok: true } : receipt)));
    await expect(sendRegionalDirective(directivePendingRequest('head-a', command()), signal())).rejects.toThrow();
  });
  it('keeps network/auth/server failure uncertain, releasing only proven domain rejections', () => {
    for (const error of [new Error('network'), new DirectiveRequestError(401, undefined, 'expired'), new DirectiveRequestError(403, 'DIRECTIVE_ACCESS_DENIED', 'denied'),
      new DirectiveRequestError(409, 'SESSION_CHANGED', 'changed'), new DirectiveRequestError(503, 'DIRECTIVE_LIMIT', 'limit'), new DirectiveRequestError(503, 'DIRECTIVE_INVALID_COMMAND', 'untrusted')]) {
      expect(directiveWriteRejected(error)).toBe(false);
    }
    for (const code of ['DIRECTIVE_VERSION_CONFLICT', 'DIRECTIVE_INVALID_TRANSITION', 'DIRECTIVE_COMPLETION_DATE_LOCKED', 'DIRECTIVE_REWORK_DATE_REQUIRED']) {
      expect(directiveWriteRejected(new DirectiveRequestError(409, code, 'rejected'))).toBe(true);
    }
    expect(directiveWriteRejected(new DirectiveRequestError(400, 'DIRECTIVE_INVALID_ATTACHMENT', 'invalid'))).toBe(true);
  });
});
