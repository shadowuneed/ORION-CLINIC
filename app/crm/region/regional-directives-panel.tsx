'use client';

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Download, FileText, Plus, RefreshCw, Search } from 'lucide-react';
import { z } from 'zod';
import { allowedDirectiveActions, deriveDirectiveTimeline, regionalDirectiveUploadSchema, regionalDirectiveCommandResultSchema, regionalDirectiveCommandSchema, regionalDirectivesQuerySchema, regionalDirectivesSnapshotSchema,
  type RegionalDirectiveCommand, type RegionalDirectivesSnapshot, type RegionalDirectiveAssignment } from '@/lib/regional/directives';
import styles from './regional-directives-panel.module.css';

type Directive = RegionalDirectivesSnapshot['directives'][number];
type AssignmentRow = { directive: Directive; assignment: RegionalDirectiveAssignment; facilityName: string };
type PendingWrite = { actorId: string; command: RegionalDirectiveCommand; body: string };
type UploadPurpose = 'report' | 'supporting' | 'explanation';
type Upload = { fileName: string; mimeType: string; contentBase64: string; purpose: UploadPurpose };
const MIB = 1024 * 1024;
const acceptedFiles = '.pdf,.docx,.png,.jpg,.jpeg,.txt';
const mimeByExtension: Record<string, string> = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', txt: 'text/plain' };
const dayFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
const momentFormat = new Intl.DateTimeFormat('ru-RU', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Qyzylorda' });
const labels: Record<RegionalDirectiveAssignment['status'], string> = {
  assigned: 'Назначено', in_progress: 'В работе', submitted: 'На проверке', returned_documents: 'Исправить документы', returned_work: 'Доработать работу', accepted: 'Принято',
};
function day(value: string) { return dayFormat.format(new Date(`${value}T12:00:00Z`)); }
function moment(value: string) { return momentFormat.format(new Date(value)); }

export class DirectiveRequestError extends Error {
  constructor(readonly status: number, readonly code: string | undefined, message: string) { super(message); }
}
export function directiveAccessLost(cause: unknown) {
  return cause instanceof DirectiveRequestError && ([401, 403].includes(cause.status) || cause.code === 'SESSION_CHANGED');
}
export function directivePendingRequest(actorId: string, command: RegionalDirectiveCommand, previous: PendingWrite | null = null): PendingWrite {
  if (previous) {
    if (previous.actorId !== actorId) throw new DirectiveRequestError(409, 'SESSION_CHANGED', 'Войдите тем же сотрудником, который отправил действие.');
    if (previous.command.idempotencyKey !== command.idempotencyKey) throw new Error('Сначала подтвердите сохранение предыдущего действия.');
    return previous;
  }
  const checked = regionalDirectiveCommandSchema.parse(command);
  return { actorId, command: checked, body: JSON.stringify(checked) };
}
/** Only explicit pre-commit domain rejections can release a pending write. */
export function directiveWriteRejected(cause: unknown) {
  return cause instanceof DirectiveRequestError && cause.status >= 400 && cause.status < 500 && ![401, 403].includes(cause.status)
    && ['DIRECTIVE_INVALID_QUERY', 'DIRECTIVE_INVALID_COMMAND', 'DIRECTIVE_FILE_INVALID', 'DIRECTIVE_VERSION_CONFLICT',
      'DIRECTIVE_IDEMPOTENCY_CONFLICT', 'DIRECTIVE_INVALID_TRANSITION', 'DIRECTIVE_EXPLANATION_REQUIRED', 'DIRECTIVE_COMPLETION_DATE_LOCKED',
      'DIRECTIVE_REWORK_DATE_REQUIRED', 'DIRECTIVE_NOT_FOUND', 'DIRECTIVE_INVALID_ATTACHMENT'].includes(cause.code ?? '');
}
async function directiveResponse(response: Response): Promise<unknown> {
  const body: unknown = await response.json().catch(() => null);
  if (!response.ok) {
    const error = z.object({ error: z.object({ code: z.string().max(100).optional() }) }).safeParse(body);
    const code = error.success ? error.data.error.code : undefined;
    const messages: Record<string, string> = {
      DIRECTIVE_VERSION_CONFLICT: 'Поручение уже изменилось. Обновите данные и повторите нужное действие.',
      DIRECTIVE_INVALID_TRANSITION: 'Это действие недоступно в текущем состоянии. Обновите поручение.',
      DIRECTIVE_EXPLANATION_REQUIRED: 'Сначала руководитель должен отправить объяснительное письмо о нарушении срока.',
      DIRECTIVE_COMPLETION_DATE_LOCKED: 'При исправлении документов дата фактического выполнения должна остаться прежней.',
      DIRECTIVE_REWORK_DATE_REQUIRED: 'После возврата работы укажите дату выполнения не раньше дня возврата.',
      DIRECTIVE_FILE_INVALID: 'Формат документа не подтверждён. Выберите настоящий PDF, DOCX, PNG, JPEG или UTF-8 TXT.',
      DIRECTIVE_INVALID_ATTACHMENT: 'Не удалось проверить документ. Проверьте формат, имя и ограничение 2 МБ на файл.',
      DIRECTIVE_INVALID_COMMAND: 'Проверьте заполненные поля, даты и обязательные документы.',
      DIRECTIVE_NOT_FOUND: 'Поручение больше недоступно. Обновите список.',
    };
    throw new DirectiveRequestError(response.status, code,
      response.status === 401 || response.status === 403 ? 'Доступ к поручениям изменился. Проверьте вход и права.'
        : code && messages[code] ? messages[code]
          : response.status === 409 ? 'Запись изменилась или действие недоступно. Обновите данные после проверки сохранения.'
          : response.status === 413 ? 'Общий размер документов слишком большой.' : 'Не удалось подтвердить действие. Повторите проверку.');
  }
  return body;
}
export async function loadRegionalDirectives(facilityId: string | undefined, signal: AbortSignal): Promise<RegionalDirectivesSnapshot> {
  const query = regionalDirectivesQuerySchema.parse(facilityId ? { facilityId } : {});
  signal.throwIfAborted();
  const params = new URLSearchParams(query);
  const response = await fetch(`/api/regional/v1/directives${params.size ? `?${params}` : ''}`, { credentials: 'same-origin', cache: 'no-store', signal });
  signal.throwIfAborted();
  const body = await directiveResponse(response); signal.throwIfAborted();
  const value = regionalDirectivesSnapshotSchema.parse(body);
  if (facilityId && (value.facilities.some(row => row.id !== facilityId)
    || value.directives.some(row => row.assignments.some(assignment => assignment.facilityId !== facilityId)))) throw new Error('Получены данные другого учреждения.');
  return value;
}
const commandReceiptSchema = z.object({ result: regionalDirectiveCommandResultSchema,
  snapshot: regionalDirectivesSnapshotSchema }).strict();
export async function sendRegionalDirective(pending: PendingWrite, signal: AbortSignal) {
  signal.throwIfAborted();
  const response = await fetch('/api/regional/v1/directives/commands', { method: 'POST', credentials: 'same-origin', cache: 'no-store',
    headers: { 'Content-Type': 'application/json', 'X-Orion-Directive-Actor': pending.actorId }, body: pending.body, signal });
  signal.throwIfAborted();
  const body = await directiveResponse(response); signal.throwIfAborted();
  const receipt = commandReceiptSchema.parse(body);
  if (receipt.snapshot.actorId !== pending.actorId) throw new DirectiveRequestError(409, 'SESSION_CHANGED', 'Сеанс изменился до подтверждения сохранения.');
  if (pending.command.type !== 'create' && receipt.result.assignmentId !== pending.command.assignmentId) throw new Error('Получено подтверждение другого поручения.');
  const directive = receipt.snapshot.directives.find(row => row.id === receipt.result.directiveId);
  if (!directive || (receipt.result.assignmentId && !directive.assignments.some(row => row.id === receipt.result.assignmentId && row.version >= receipt.result.version))) throw new Error('Сохранение не подтверждено актуальной записью.');
  return receipt;
}

function scopeSnapshot(snapshot: RegionalDirectivesSnapshot, facilityId?: string): RegionalDirectivesSnapshot {
  if (!facilityId) return snapshot;
  return { ...snapshot, facilities: snapshot.facilities.filter(row => row.id === facilityId),
    directives: snapshot.directives.flatMap(row => { const assignments = row.assignments.filter(item => item.facilityId === facilityId); return assignments.length ? [{ ...row, assignments }] : []; }) };
}

/** The chosen files stay local until the user submits. Server checks bytes again. */
export async function prepareDirectiveUploads(primary: File | undefined, supporting: readonly File[], purpose: 'report' | 'explanation'): Promise<Upload[]> {
  if (!primary) throw new Error(purpose === 'report' ? 'Прикрепите основной отчёт.' : 'Прикрепите объяснительное письмо.');
  const files = [primary, ...supporting];
  if (files.length > 3) throw new Error('Можно загрузить основной документ и не более двух приложений.');
  if (new Set(files.map(file => file.name.toLocaleLowerCase('ru-RU'))).size !== files.length) throw new Error('Имена документов в одной отправке должны различаться.');
  if (files.some(file => file.size < 1 || file.size > 2 * MIB) || files.reduce((sum, file) => sum + file.size, 0) > 6 * MIB) throw new Error('Каждый документ — от 1 байта до 2 МБ; всего — не более 6 МБ.');
  const prepared: Upload[] = [];
  for (const [index, file] of files.entries()) {
    const extension = file.name.split('.').at(-1)?.toLowerCase() ?? '';
    const mimeType = mimeByExtension[extension];
    if (!mimeType || (file.type && file.type !== mimeType) || file.name.length > 180) throw new Error('Поддерживаются PDF, DOCX, PNG, JPEG и TXT с именем до 180 символов.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (bytes.byteLength !== file.size) throw new Error('Документ изменился во время чтения. Выберите файл заново.');
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 32768) binary += String.fromCharCode(...bytes.subarray(offset, offset + 32768));
    const parsed = regionalDirectiveUploadSchema.safeParse({ fileName: file.name, mimeType, contentBase64: btoa(binary), purpose: index === 0 ? purpose : 'supporting' });
    if (!parsed.success) throw new Error('Проверьте имя и формат документа: недопустимы пути, управляющие символы и системные имена.');
    prepared.push(parsed.data);
  }
  return prepared;
}

export function directiveRows(snapshot: RegionalDirectivesSnapshot): AssignmentRow[] {
  return snapshot.directives.flatMap(directive => directive.assignments.map(assignment => ({ directive, assignment,
    facilityName: snapshot.facilities.find(row => row.id === assignment.facilityId)?.name ?? 'Учреждение' })));
}
export function currentDirectiveAttachments(assignment: RegionalDirectiveAssignment) {
  const workRevision = Math.max(0, ...assignment.history.filter(row => row.action === 'review' && row.status === 'returned_work').map(row => row.version));
  const latest = (action: 'submit' | 'explain') => assignment.history.filter(row => row.action === action && row.version > workRevision).sort((a, b) => b.version - a.version)[0];
  const ids = new Set([...(latest('submit')?.attachmentIds ?? []), ...(latest('explain')?.attachmentIds ?? [])]);
  return assignment.attachments.filter(row => ids.has(row.id));
}
export function directiveTiming(directive: Directive, assignment: RegionalDirectiveAssignment, today: string) {
  const timeline = deriveDirectiveTimeline(directive, assignment, today);
  if (timeline.actualCompletedDate) {
    const timely = !timeline.late;
    return { label: timeline.completion === 'accepted' ? timely ? 'Выполнено в срок' : 'Выполнено с опозданием'
      : timely ? 'Заявлено выполнение в срок' : 'Заявлено выполнение с опозданием', tone: timely ? 'success' : 'warning' };
  }
  return today > directive.dueDate ? { label: 'Срок истёк · работа не подтверждена', tone: 'warning' }
    : { label: `Срок: ${day(directive.dueDate)}`, tone: 'brand' };
}

export function directiveMinCompletionDate(directive: Directive, assignment: RegionalDirectiveAssignment) {
  // Saving progress after a work return changes status to in_progress, but does
  // not remove the work-cycle boundary enforced by PostgreSQL.
  const returnAt = assignment.history.find(row => row.action === 'review' && row.status === 'returned_work')?.at
    ?? (['returned_work', 'in_progress'].includes(assignment.status) ? assignment.reviewedAt : null);
  if (!returnAt) return directive.issuedDate;
  const parts = new Intl.DateTimeFormat('en-CA', { year: 'numeric', month: '2-digit', day: '2-digit', timeZone: 'Asia/Qyzylorda' }).formatToParts(new Date(returnAt));
  const part = (type: string) => parts.find(item => item.type === type)?.value ?? '';
  return [directive.issuedDate, `${part('year')}-${part('month')}-${part('day')}`].sort().at(-1)!;
}

export function RegionalDirectivesPanel({ scopeKey = 'directives-session', facilityId }: { scopeKey?: string; facilityId?: string }) {
  return <DirectivesSession key={scopeKey} facilityId={facilityId} />;
}
function DirectivesSession({ facilityId }: { facilityId?: string }) {
  const [snapshot, setSnapshot] = useState<RegionalDirectivesSnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingWrite | null>(null);
  const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [search, setSearch] = useState(''); const [filter, setFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null); const [creating, setCreating] = useState(false);
  const pendingRef = useRef<PendingWrite | null>(null); const writeLock = useRef(false); const readGeneration = useRef(0);
  const readController = useRef<AbortController | null>(null); const snapshotActor = useRef<string | null>(null);
  const [selectedScope, setSelectedScope] = useState(facilityId);
  const currentSnapshot = selectedScope === facilityId ? snapshot : null;
  const refresh = useCallback(async () => {
    if (writeLock.current) return;
    const run = ++readGeneration.current; readController.current?.abort();
    const controller = new AbortController(); readController.current = controller;
    setLoading(true); setSnapshot(null); setCreating(false); setError('');
    try {
      const value = await loadRegionalDirectives(facilityId, AbortSignal.any([controller.signal, AbortSignal.timeout(20000)]));
      if (controller.signal.aborted || run !== readGeneration.current) return;
      setSelectedScope(facilityId); snapshotActor.current = value.actorId;
      if (pendingRef.current && pendingRef.current.actorId !== value.actorId) {
        setError('Проверка сохранения относится к другому аккаунту. Войдите тем же сотрудником; повтор не отправлен.');
        return;
      }
      setSnapshot(value);
    } catch (cause) {
      if (controller.signal.aborted || run !== readGeneration.current) return;
      snapshotActor.current = null;
      setError(directiveAccessLost(cause) ? 'Нет доступа к поручениям. Войдите назначенным администратором поручений или руководителем учреждения.' : 'Поручения не загрузились. Проверьте подключение и повторите запрос.');
    } finally { if (!controller.signal.aborted && run === readGeneration.current) setLoading(false); }
  }, [facilityId]);
  useEffect(() => { const timer = setTimeout(() => void refresh(), 0); const fence = readGeneration;
    return () => { clearTimeout(timer); ++fence.current; readController.current?.abort(); };
  }, [refresh]);
  useEffect(() => {
    const beforeUnload = (event: BeforeUnloadEvent) => { if (writeLock.current || pendingRef.current) event.preventDefault(); };
    const navigation = (event: MouseEvent) => {
      if (!writeLock.current && !pendingRef.current) return;
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>('a[href]') : null;
      if (!link || link.hasAttribute('download') || link.target === '_blank' || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const url = new URL(link.href, window.location.href);
      if (`${url.pathname}${url.search}` === `${window.location.pathname}${window.location.search}`) return;
      event.preventDefault(); event.stopPropagation(); setError('Сначала проверьте сохранение. Повтор использует тот же запрос и документы.');
    };
    const location = `${window.location.pathname}${window.location.search}`;
    const popstate = (event: PopStateEvent) => { if (writeLock.current || pendingRef.current) {
      event.stopImmediatePropagation(); window.history.pushState(window.history.state, '', location); setError('Сначала завершите проверку сохранения.');
    } };
    window.addEventListener('beforeunload', beforeUnload); window.addEventListener('popstate', popstate, true); document.addEventListener('click', navigation, true);
    return () => { window.removeEventListener('beforeunload', beforeUnload); window.removeEventListener('popstate', popstate, true); document.removeEventListener('click', navigation, true); };
  }, []);

  async function execute(command: RegionalDirectiveCommand) {
    if (writeLock.current || !snapshotActor.current || !currentSnapshot) return false;
    const prior = pendingRef.current;
    if (prior && (prior.actorId !== snapshotActor.current || prior.command.idempotencyKey !== command.idempotencyKey)) {
      setError('Сначала подтвердите сохранение предыдущего действия.'); return false;
    }
    const request = directivePendingRequest(snapshotActor.current, command, prior);
    pendingRef.current = request; setPending(request); writeLock.current = true; setBusy(true); setError(''); setNotice('');
    ++readGeneration.current; readController.current?.abort();
    try {
      const receipt = await sendRegionalDirective(request, AbortSignal.timeout(30000));
      pendingRef.current = null; setPending(null); setSnapshot(scopeSnapshot(receipt.snapshot, facilityId)); setCreating(false);
      snapshotActor.current = receipt.snapshot.actorId; setSelectedScope(facilityId);
      setSelectedId(receipt.result.assignmentId ?? receipt.snapshot.directives.find(row => row.id === receipt.result.directiveId)?.assignments[0]?.id ?? null);
      setNotice(receipt.result.replayed ? 'Действие уже было сохранено. Показана запись из базы.' : 'Сохранено в базе. История и документы обновлены.');
      return true;
    } catch (cause) {
      if (directiveWriteRejected(cause)) { pendingRef.current = null; setPending(null); }
      if (directiveAccessLost(cause)) { setSnapshot(null); snapshotActor.current = null; setCreating(false); }
      setError(cause instanceof DirectiveRequestError ? cause.message : 'Ответ на сохранение не подтверждён. Нажмите «Проверить сохранение» — повтор не создаст второе действие.');
      return false;
    } finally { writeLock.current = false; setBusy(false); }
  }

  const rows = currentSnapshot ? directiveRows(currentSnapshot) : [];
  const visibleRows = rows.filter(row => `${row.directive.title} ${row.directive.authorityReference} ${row.facilityName}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU'))
    && (filter === 'all' || (filter === 'active' ? !['submitted', 'accepted'].includes(row.assignment.status) : row.assignment.status === filter)));
  const selected = visibleRows.find(row => row.assignment.id === selectedId) ?? visibleRows[0];
  const blocked = busy || Boolean(pending) || loading;
  return <main className={styles.workspace}>
    <header className={styles.header}><div><h1>Поручения и отчёты</h1><p>Фиксированный срок · документы руководителя · проверка администратором</p></div>
      <div className={styles.headerActions}><span className={styles.mode}>Учебная база</span>
        <a className={styles.button} href="/crm" aria-disabled={Boolean(pending) || busy}><ArrowLeft size={16} />К учреждениям</a>
        <button className={styles.button} type="button" onClick={() => void refresh()} disabled={busy || loading} aria-label="Обновить поручения"><RefreshCw size={16} /></button>
        {currentSnapshot?.capabilities.issue && <button className={styles.primary} type="button" onClick={() => { setCreating(true); setNotice(''); }} disabled={blocked}><Plus size={16} />Новое поручение</button>}
      </div></header>
    {pending && <div className={styles.pending} role="status"><span><strong>{busy ? 'Сохраняем действие…' : 'Нужно подтвердить сохранение'}</strong>
      До подтверждения другие изменения и переходы приостановлены. Документы повторно выбирать не нужно.</span>
      <button className={styles.secondary} type="button" onClick={() => void execute(pending.command)} disabled={busy || loading || !currentSnapshot}>Проверить сохранение</button>
      {!currentSnapshot && <button className={styles.button} type="button" onClick={() => void refresh()} disabled={busy || loading}>Проверить вход и права</button>}</div>}
    {error && <div className={styles.error} role="alert">{error}</div>}
    {notice && <div className={styles.notice} role="status"><Check size={16} />{notice}</div>}
    {loading ? <div className={styles.loading} role="status">Загружаем поручения из базы…</div> : !currentSnapshot ? <div className={styles.empty}><p>Поручения доступны только с назначенными полномочиями.</p>
      <button className={styles.button} type="button" onClick={() => void refresh()}>Повторить проверку доступа</button></div> : <>
      <div className={styles.overview} aria-label="Состояние поручений"><div><strong>{rows.filter(row => !['accepted', 'submitted'].includes(row.assignment.status)).length}</strong><span>В работе и на доработке</span></div>
        <div><strong>{rows.filter(row => row.assignment.status === 'submitted').length}</strong><span>Ожидают проверки</span></div>
        <div><strong>{rows.filter(row => deriveDirectiveTimeline(row.directive, row.assignment, currentSnapshot.today).late).length}</strong><span>С нарушением срока</span></div>
        <div><strong>{rows.filter(row => row.assignment.status === 'accepted').length}</strong><span>Принято администратором</span></div></div>
      {creating && currentSnapshot.capabilities.issue && <CreateDirectiveForm snapshot={currentSnapshot} disabled={blocked} execute={execute} onClose={() => setCreating(false)} />}
      <div className={styles.filters}><label className={styles.search}><Search size={16} /><input type="search" value={search} maxLength={180} onChange={event => setSearch(event.target.value)} placeholder="Поручение, документ или учреждение" aria-label="Найти поручение" disabled={blocked} /></label>
        <select value={filter} onChange={event => setFilter(event.target.value)} aria-label="Фильтр по состоянию" disabled={blocked}>
          <option value="all">Все поручения</option><option value="active">Работа и доработка</option><option value="submitted">На проверке</option><option value="accepted">Принято</option></select></div>
      <div className={styles.columns}><div className={styles.list} aria-label="Поручения учреждений">{visibleRows.map(row => <button key={row.assignment.id} type="button" className={styles.row}
        aria-pressed={row.assignment.id === selected?.assignment.id} disabled={blocked} onClick={() => { setSelectedId(row.assignment.id); setNotice(''); }}>
        <strong>{row.directive.title}</strong><span>{row.facilityName}</span><div className={styles.rowFooter}><span className={styles.badge}>{labels[row.assignment.status]}</span><small>{row.assignment.progress}% · до {day(row.directive.dueDate)}</small></div>
        <progress className={styles.progress} max={100} value={row.assignment.progress} aria-label={`Прогресс: ${row.assignment.progress}%`} /></button>)}
        {!visibleRows.length && <div className={styles.empty}>{rows.length ? 'По этому фильтру поручений нет.' : 'Поручения пока не назначены.'}</div>}</div>
        {selected ? <RegionalDirectiveDetail key={`${selected.assignment.id}:${selected.assignment.version}`} row={selected} snapshot={currentSnapshot} disabled={blocked} execute={execute} />
          : <div className={styles.empty}>Выберите поручение, чтобы увидеть срок, документы и действия.</div>}
      </div><p className={styles.footnote}>Срок поручения не переносится. Дата фактического выполнения и дата проверки учитываются отдельно. Отчёт не считается принятым до решения администратора.</p>
    </>}
  </main>;
}

function CreateDirectiveForm({ snapshot, disabled, execute, onClose }: { snapshot: RegionalDirectivesSnapshot; disabled: boolean; execute: (command: RegionalDirectiveCommand) => Promise<boolean>; onClose: () => void }) {
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled) return;
    const data = new FormData(event.currentTarget);
    const parsed = regionalDirectiveCommandSchema.safeParse({ type: 'create', idempotencyKey: crypto.randomUUID(), expectedVersion: 0,
      title: data.get('title'), authorityReference: data.get('authorityReference'), details: data.get('details'), dueDate: data.get('dueDate'), facilityIds: data.getAll('facilityId') });
    if (!parsed.success) { setError('Заполните основание, название, содержание, срок и выберите учреждения.'); return; }
    setError(''); await execute(parsed.data);
  }
  return <section className={styles.create}><form className={styles.form} onSubmit={event => void submit(event)}><fieldset disabled={disabled}><legend>Новое поручение учреждениям</legend>
    <div className={styles.formGrid}><label>Основание: номер приказа или письма<input name="authorityReference" required maxLength={180} placeholder="Письмо №… от …" /></label>
      <label>Выполнить не позднее<input name="dueDate" type="date" required min={snapshot.today} /></label>
      <label className={styles.fullWidth}>Название поручения<input name="title" required maxLength={180} /></label>
      <label className={styles.fullWidth}>Что необходимо выполнить<textarea name="details" required maxLength={4000} rows={3} /></label></div>
    <div><p>Учреждения-исполнители</p><div className={styles.facilities}>{snapshot.facilities.map(facility => <label key={facility.id}><input type="checkbox" name="facilityId" value={facility.id} />{facility.name}</label>)}</div></div>
    <small>После назначения срок фиксируется. Здесь регистрируется поручение вручную, а не отправляется государственный приказ.</small>
    {error && <p className={styles.error} role="alert">{error}</p>}<div className={styles.formActions}><button className={styles.primary} type="submit">Назначить поручение</button><button className={styles.quiet} type="button" onClick={onClose}>Отмена</button></div>
  </fieldset></form></section>;
}

export function RegionalDirectiveDetail({ row, snapshot, disabled, execute }: { row: AssignmentRow; snapshot: RegionalDirectivesSnapshot; disabled: boolean; execute: (command: RegionalDirectiveCommand) => Promise<boolean> }) {
  const { directive, assignment, facilityName } = row;
  const canSubmit = Boolean(snapshot.facilities.find(facility => facility.id === assignment.facilityId)?.canSubmit);
  const timing = directiveTiming(directive, assignment, snapshot.today);
  const timeline = deriveDirectiveTimeline(directive, assignment, snapshot.today);
  const pendingWork = timeline.completion === 'pending';
  const elapsedLabel = `Прошло ${timeline.elapsedDays} из ${timeline.totalDays} дней`;
  const deadlineLabel = !pendingWork ? timing.label : timeline.daysRemaining > 0 ? `Осталось ${daysLabel(timeline.daysRemaining)}`
    : timeline.daysRemaining === 0 ? 'Срок сегодня' : `Просрочено на ${daysLabel(-timeline.daysRemaining)}`;
  const actions = allowedDirectiveActions(snapshot, assignment);
  const currentAttachments = currentDirectiveAttachments(assignment);
  return <section className={styles.details} aria-label={`Поручение: ${directive.title}`}><div className={styles.detailHeading}><div><span className={styles.eyebrow}>{facilityName}</span><h2>{directive.title}</h2></div><FileText size={23} /></div>
    <p className={styles.reference}>{directive.authorityReference} · назначено {day(directive.issuedDate)}</p>
    <div className={styles.badges}><span className={styles.badge} data-tone={assignment.status === 'accepted' ? 'success' : 'brand'}>{labels[assignment.status]}</span><span className={styles.badge} data-tone={timing.tone}>{timing.label}</span>
      {assignment.explanationRequired && <span className={styles.badge} data-tone="warning">Требуется объяснительное письмо</span>}</div>
    <p className={styles.instructions}>{directive.details}</p>
    <div className={styles.timelineComparison} role="group" aria-label="Прогресс работы и календарный срок">
      <div><div className={styles.timelineHeading}><span>{timeline.completion === 'accepted' ? 'Выполнение принято' : 'Работа заявлена'}</span><strong>{timeline.progress}%</strong></div>
        <progress className={styles.progress} max={100} value={timeline.progress} aria-label="Заявленный прогресс работы" />
        <small>{timeline.completion === 'accepted' ? 'Подтверждено администратором' : 'Выполнение подтверждает администратор'}</small></div>
      <div data-overdue={pendingWork && timeline.daysRemaining < 0}><div className={styles.timelineHeading}><span>Календарный срок</span><strong>{elapsedLabel}</strong></div>
        <progress className={`${styles.progress} ${styles.timeProgress}`} max={100} value={timeline.elapsedPercent} aria-label="Использованная доля срока" aria-valuetext={elapsedLabel} />
        <small>{deadlineLabel}</small></div>
    </div>
    <dl className={styles.facts}><div><dt>Фиксированный срок</dt><dd>{day(directive.dueDate)}</dd></div>
      <div><dt>Фактически выполнено</dt><dd>{assignment.actualCompletedDate ? day(assignment.actualCompletedDate) : 'Не заявлено'}</dd></div>
      <div><dt>Отчёт направлен</dt><dd>{assignment.submittedAt ? moment(assignment.submittedAt) : 'Не направлен'}</dd></div><div><dt>Решение администратора</dt><dd>{assignment.reviewedAt ? moment(assignment.reviewedAt) : 'Ожидается'}</dd></div></dl>
    {assignment.reviewRemark && <div className={styles.remark}><strong>Замечание администратора</strong>{assignment.reviewRemark}</div>}
    {currentAttachments.length > 0 && <div><span className={styles.eyebrow}>Последние документы текущей работы</span><AttachmentLinks attachments={currentAttachments} /></div>}
    {actions.submit && <>
      {actions.progress && <ProgressForm assignment={assignment} disabled={disabled} execute={execute} />}
      <DocumentForm key={`report:${assignment.version}`} assignment={assignment} directive={directive} today={snapshot.today} purpose="report" disabled={disabled} execute={execute} />
    </>}
    {actions.explain && <DocumentForm key={`explanation:${assignment.version}`} assignment={assignment} directive={directive} today={snapshot.today} purpose="explanation" disabled={disabled} execute={execute} />}
    {actions.review && <ReviewForm assignment={assignment} disabled={disabled} execute={execute} />}
    {!canSubmit && !snapshot.capabilities.review && <p className={styles.footnote}>Просмотр поручения. Документы отправляет назначенный руководитель учреждения.</p>}
    <details className={styles.history}><summary>История изменений · {assignment.history.length}</summary><ol>{assignment.history.map(item => <li key={item.id}>
      <strong>{item.action === 'create' ? 'Поручение назначено' : item.action === 'progress' ? 'Обновлён прогресс' : item.action === 'submit' ? 'Отчёт направлен' : item.action === 'explain' ? 'Направлено объяснение' : labels[item.status]}</strong>
      <time dateTime={item.at}>{moment(item.at)}</time><small>{item.actorLabel} · версия {item.version} · прогресс {item.progress}%</small>
      {item.actualCompletedDate && <small>Фактическое выполнение: {day(item.actualCompletedDate)}</small>}{item.remark && <p>{item.remark}</p>}
      <AttachmentLinks attachments={assignment.attachments.filter(attachment => item.attachmentIds.includes(attachment.id))} />
    </li>)}</ol><p className={styles.footnote}>Последние 50 сохранённых изменений. Ранее отправленные документы не заменяются новой загрузкой.</p>
      {assignment.attachments.length > 0 && <details><summary>Все сохранённые вложения · {assignment.attachments.length}</summary><AttachmentLinks attachments={assignment.attachments} /></details>}</details>
  </section>;
}

function daysLabel(count: number) {
  const remainder = count % 100;
  const last = count % 10;
  return `${count} ${remainder >= 11 && remainder <= 14 ? 'дней' : last === 1 ? 'день' : last >= 2 && last <= 4 ? 'дня' : 'дней'}`;
}

function AttachmentLinks({ attachments }: { attachments: RegionalDirectiveAssignment['attachments'] }) {
  return <div className={styles.attachments}>{attachments.map(file => <a key={file.id} href={`/api/regional/v1/directive-attachments/${encodeURIComponent(file.id)}`} download>
    <Download size={14} />{file.fileName} ({Math.max(1, Math.round(file.byteLength / 1024))} КБ) · {moment(file.uploadedAt)}</a>)}</div>;
}
function ProgressForm({ assignment, disabled, execute }: { assignment: RegionalDirectiveAssignment; disabled: boolean; execute: (command: RegionalDirectiveCommand) => Promise<boolean> }) {
  const [progress, setProgress] = useState(assignment.progress); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled) return;
    const parsed = regionalDirectiveCommandSchema.safeParse({ type: 'progress', assignmentId: assignment.id, expectedVersion: assignment.version, idempotencyKey: crypto.randomUUID(), progress });
    if (!parsed.success) { setError('Укажите целое число от 0 до 100.'); return; }
    setError(''); await execute(parsed.data);
  }
  return <section className={styles.actionSection}><form className={`${styles.form} ${styles.progressForm}`} onSubmit={event => void submit(event)}>
    <label>Прогресс работы, %<input type="number" min={0} max={100} step={1} required value={progress} onChange={event => setProgress(Number(event.target.value))} disabled={disabled} /></label>
    <button className={styles.button} type="submit" disabled={disabled || progress === assignment.progress}>Сохранить прогресс</button>{error && <p className={styles.error} role="alert">{error}</p>}
  </form></section>;
}

function DocumentForm({ assignment, directive, today, purpose, disabled, execute }: { assignment: RegionalDirectiveAssignment; directive: Directive; today: string; purpose: 'report' | 'explanation'; disabled: boolean; execute: (command: RegionalDirectiveCommand) => Promise<boolean> }) {
  const [preparing, setPreparing] = useState(false); const [error, setError] = useState('');
  const retired = useRef(false);
  useEffect(() => { retired.current = false; return () => { retired.current = true; }; }, []);
  const correction = purpose === 'report' && assignment.status === 'returned_documents';
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (disabled || preparing) return;
    const data = new FormData(event.currentTarget); setPreparing(true); setError('');
    try {
      const primary = data.get('primary'); const supporting = data.getAll('supporting').filter((file): file is File => file instanceof File && file.size > 0);
      const attachments = await prepareDirectiveUploads(primary instanceof File && primary.size ? primary : undefined, supporting, purpose);
      if (retired.current) return;
      const base = { assignmentId: assignment.id, expectedVersion: assignment.version, idempotencyKey: crypto.randomUUID(), attachments };
      const parsed = regionalDirectiveCommandSchema.safeParse(purpose === 'report'
        ? { ...base, type: 'submit', actualCompletedDate: correction ? assignment.actualCompletedDate : data.get('actualCompletedDate') }
        : { ...base, type: 'explain', message: data.get('message') });
      if (!parsed.success) throw new Error('Проверьте дату, текст и прикреплённые документы.');
      await execute(parsed.data);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'Не удалось прочитать документы.'); }
    finally { if (!retired.current) setPreparing(false); }
  }
  return <section className={styles.actionSection}><form className={styles.form} onSubmit={event => void submit(event)}><fieldset disabled={disabled || preparing}>
    <legend>{purpose === 'explanation' ? 'Объяснение нарушения срока' : correction ? 'Исправленные документы' : 'Отчёт о выполнении'}</legend>
    {purpose === 'report' ? correction ? <small>Фактическое выполнение: {assignment.actualCompletedDate ? day(assignment.actualCompletedDate) : 'не указано'}. Исправление документов не меняет дату работы.</small>
      : <label>Дата фактического выполнения<input type="date" name="actualCompletedDate" required min={directiveMinCompletionDate(directive, assignment)} max={today} defaultValue={assignment.actualCompletedDate ?? today} /></label>
      : <label>Причина и текущие действия<textarea name="message" required maxLength={4000} rows={3} /></label>}
    <label>{purpose === 'report' ? 'Основной отчёт' : 'Объяснительное письмо'}<input type="file" name="primary" accept={acceptedFiles} required /></label>
    <label>Приложения, если нужны<input type="file" name="supporting" accept={acceptedFiles} multiple /></label>
    <small>PDF, DOCX, PNG, JPEG или TXT. Основной документ и до двух приложений; каждый до 2 МБ. Только учебные данные, без реальных сведений о пациентах.</small>
    {purpose === 'explanation' && <small>Объяснение не переносит срок и не закрывает поручение.</small>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.formActions}><button className={styles.primary} type="submit">{preparing ? 'Читаем документы…' : purpose === 'explanation' ? 'Отправить объяснение' : 'Отправить на проверку'}</button></div>
  </fieldset></form></section>;
}
function ReviewForm({ assignment, disabled, execute }: { assignment: RegionalDirectiveAssignment; disabled: boolean; execute: (command: RegionalDirectiveCommand) => Promise<boolean> }) {
  const [decision, setDecision] = useState<'accept' | 'return_documents' | 'return_work'>('accept'); const [remark, setRemark] = useState(''); const [error, setError] = useState('');
  async function submit(event: FormEvent) {
    event.preventDefault(); if (disabled) return;
    const parsed = regionalDirectiveCommandSchema.safeParse({ type: 'review', assignmentId: assignment.id, expectedVersion: assignment.version, idempotencyKey: crypto.randomUUID(), decision, remark });
    if (!parsed.success) { setError('Для возврата укажите замечание.'); return; }
    setError(''); await execute(parsed.data);
  }
  return <section className={styles.actionSection}><form className={styles.form} onSubmit={event => void submit(event)}><fieldset disabled={disabled}><legend>Решение по отчёту</legend>
    <label>Результат проверки<select value={decision} onChange={event => setDecision(event.target.value as typeof decision)}><option value="accept">Принять выполнение</option>
      <option value="return_documents">Вернуть документы на исправление</option><option value="return_work">Вернуть работу на доработку</option></select></label>
    <label>{decision === 'accept' ? 'Комментарий, если нужен' : 'Обязательное замечание'}<textarea value={remark} onChange={event => setRemark(event.target.value)} required={decision !== 'accept'} maxLength={2000} rows={3} /></label>
    {decision === 'return_documents' && <small>Дата выполнения сохраняется: исправляются только документы.</small>}
    {decision === 'return_work' && <small>Работа не принята. Руководитель должен завершить её и сообщить новую фактическую дату; исходный срок остаётся прежним.</small>}
    {decision === 'accept' && assignment.explanationRequired && <p className={styles.remark}>Сначала руководитель должен направить объяснительное письмо о нарушении срока.</p>}
    {error && <p className={styles.error} role="alert">{error}</p>}
    <div className={styles.formActions}><button className={styles.primary} type="submit" disabled={decision === 'accept' && assignment.explanationRequired}>{decision === 'accept' ? 'Подтвердить выполнение' : decision === 'return_documents' ? 'Вернуть документы' : 'Вернуть работу'}</button></div>
  </fieldset></form></section>;
}
