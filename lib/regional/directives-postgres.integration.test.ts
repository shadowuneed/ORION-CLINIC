import { createHash, randomUUID } from 'node:crypto';
import { readFileSync, realpathSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { Client } from 'pg';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  DIRECTIVE_FILE_BYTES, deriveDirectiveTimeline, regionalDirectiveAttachmentResponseSchema,
  regionalDirectiveCommandResultSchema, regionalDirectiveCommandSchema, regionalDirectivesSnapshotSchema,
  type RegionalDirectiveUpload, type RegionalDirectivesSnapshot,
} from './directives';

// Explicitly selected public RPC seam: no migration, real credentials, provisioning,
// or clinical writes. All synthetic principals, reports and audits are rolled back.
describe.runIf(process.env.ORION_DIRECTIVES_PG_TEST === '1')('directive public SQL contracts and authorization', () => {
  let db: Client | undefined;
  let connected = false; let began = false; let example = false;
  let today: string; let yesterday: string; let earlier: string; let tomorrow: string;
  let baseline: string;
  const suffix = randomUUID();
  const issuer = `orion:directive-dto:${suffix}`;
  const subjects = ['admin', 'head-a', 'head-b', 'platform-admin', 'dual'] as const;
  type Subject = typeof subjects[number];
  const identity = (subject: Subject) => `directive-dto-${subject}-${suffix}`;
  const ids = subjects.map(identity);
  const facilityA = 'turkestan-hospital'; const facilityB = 'turkestan-polyclinic';

  async function protectedFingerprint() {
    const result = await db!.query(`SELECT md5(coalesce(string_agg(data,E'\n' ORDER BY data),'')) fingerprint FROM (
      SELECT 'account:'||to_jsonb(a)::text data FROM orion_directory.accounts a WHERE NOT id=ANY($1::text[])
      UNION ALL SELECT 'membership:'||to_jsonb(m)::text FROM orion_directory.memberships m WHERE NOT user_id=ANY($1::text[])
      UNION ALL SELECT 'assignment:'||to_jsonb(a)::text FROM orion_directory.assignments a WHERE NOT membership_id=ANY($1::text[])
      UNION ALL SELECT 'network:'||to_jsonb(g)::text FROM orion_region.network_grants g WHERE NOT user_id=ANY($1::text[])
      UNION ALL SELECT 'directive:'||to_jsonb(g)::text FROM orion_region.directive_grants g WHERE NOT user_id=ANY($1::text[])
    ) protected`, [ids]);
    return result.rows[0].fingerprint as string;
  }

  beforeAll(async () => {
    if (!process.env.LOCALAPPDATA) throw new Error('Dedicated PC runtime required');
    const runtime = join(process.env.LOCALAPPDATA, 'ORION-Clinic-CRM');
    const data = join(runtime, 'data');
    const marker = JSON.parse(readFileSync(join(runtime, 'cluster-owner.json'), 'utf8'));
    const admin = JSON.parse(readFileSync(join(runtime, 'admin.json'), 'utf8'));
    if (marker?.kind !== 'orion-crm-local-v1' || marker?.port !== 55432 || typeof marker?.data !== 'string'
      || resolve(marker.data).toLowerCase() !== resolve(data).toLowerCase()
      || admin?.host !== '127.0.0.1' || admin?.port !== 55432 || admin?.user !== 'postgres'
      || typeof admin?.password !== 'string' || !/^[A-Za-z0-9_-]{32,128}$/.test(admin.password)) {
      throw new Error('Exact dedicated PostgreSQL ownership required');
    }
    const { password } = admin;
    db = new Client({ host: '127.0.0.1', port: 55432, user: 'postgres', password,
      database: 'orion_crm_local', ssl: false, connectionTimeoutMillis: 3000,
      statement_timeout: 15000, lock_timeout: 3000, application_name: 'orion-directive-contract-rollback-tests' });
    await db.connect(); connected = true;
    const target = (await db.query('SELECT current_database() name, inet_server_port() port')).rows[0];
    const directory = (await db.query('SHOW data_directory')).rows[0].data_directory;
    if (target.name !== 'orion_crm_local' || target.port !== 55432
      || realpathSync(directory).toLowerCase() !== realpathSync(data).toLowerCase()) {
      throw new Error('Unexpected PostgreSQL target; no test mutations made');
    }
    const installed = (await db.query(`SELECT to_regprocedure('public.orion_regional_directives_v1(text,text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.orion_regional_directive_command_v1(text,text,jsonb)') IS NOT NULL
      AND to_regprocedure('public.orion_regional_directive_attachment_v1(text,text,text)') IS NOT NULL installed`)).rows[0].installed;
    if (!installed) throw new Error('Apply reviewed directive migration before opting into this test');
    await db.query('BEGIN'); began = true;
    baseline = await protectedFingerprint();
    const dates = (await db.query(`SELECT d::text today,(d-1)::text yesterday,(d-10)::text earlier,(d+1)::text tomorrow
      FROM (SELECT (clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date d) local_dates`)).rows[0];
    ({ today, yesterday, earlier, tomorrow } = dates);
    for (const subject of subjects) {
      const id = identity(subject);
      const clinic = subject === 'head-b' ? 'region-turkestan-polyclinic'
        : ['head-a', 'dual'].includes(subject) ? 'region-turkestan-hospital' : 'crm-clinic-local';
      await db.query("INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES($1,$2,$3,'Directive rollback fixture','active','postgres')", [id, issuer, subject]);
      await db.query("INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status,interactive) VALUES($1,$2,$2,'active',true)", [clinic, id]);
      if (subject === 'platform-admin') {
        await db.query("INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES($1,$2,$2,ARRAY['administrator'],'active',clock_timestamp()-interval '1 day')", [clinic, id]);
      } else {
        if (['admin', 'dual'].includes(subject)) await db.query(`INSERT INTO orion_region.directive_grants(id,user_id,role,clinic_id,membership_id,reason)
          VALUES($1,$2,'administrator',$3,$2,'Transaction-only directive contract verification')`, [`admin-${id}`, id, clinic]);
        if (['head-a', 'head-b', 'dual'].includes(subject)) await db.query(`INSERT INTO orion_region.directive_grants(id,user_id,role,facility_id,clinic_id,membership_id,reason)
          VALUES($1,$2,'head',$3,$4,$2,'Transaction-only directive contract verification')`, [`head-${id}`, id, subject === 'head-b' ? facilityB : facilityA, clinic]);
      }
    }
  }, 30000);

  beforeEach(async () => { if (began) { await db!.query('SAVEPOINT example'); example = true; } });
  afterEach(async () => {
    if (example) { await db!.query('ROLLBACK TO SAVEPOINT example'); await db!.query('RELEASE SAVEPOINT example'); example = false; }
  });
  afterAll(async () => {
    if (!db) return;
    try {
      if (began) {
        await db.query('ROLLBACK'); began = false;
        expect((await db.query('SELECT count(*)::integer n FROM orion_directory.accounts WHERE id=ANY($1::text[])', [ids])).rows[0].n).toBe(0);
        if (baseline) expect(await protectedFingerprint(), 'Existing identities and permissions must not change').toBe(baseline);
      }
    } finally { if (connected) await db.end(); }
  });

  async function asRuntime(sql: string, params: unknown[] = []): Promise<unknown> {
    await db!.query('SAVEPOINT directive_rpc');
    try {
      await db!.query('SET LOCAL ROLE orion_crm_app');
      const result = (await db!.query(sql, params)).rows[0]?.result;
      await db!.query('RESET ROLE'); await db!.query('RELEASE SAVEPOINT directive_rpc');
      return result;
    } catch (error) {
      await db!.query('ROLLBACK TO SAVEPOINT directive_rpc'); await db!.query('RELEASE SAVEPOINT directive_rpc');
      throw error;
    }
  }
  async function snapshot(subject: Subject = 'admin', query: unknown = {}) {
    return regionalDirectivesSnapshotSchema.parse(await asRuntime('SELECT public.orion_regional_directives_v1($1,$2,$3::jsonb) result', [issuer, subject, JSON.stringify(query)]));
  }
  async function command(value: unknown, subject: Subject = 'admin') {
    return regionalDirectiveCommandResultSchema.parse(await asRuntime('SELECT public.orion_regional_directive_command_v1($1,$2,$3::jsonb) result', [issuer, subject, JSON.stringify(value)]));
  }
  const createCommand = (facilityIds = [facilityA, facilityB]) => regionalDirectiveCommandSchema.parse({
    type: 'create', idempotencyKey: randomUUID(), expectedVersion: 0, title: 'Проверка отчёта учреждения',
    authorityReference: 'Учебное поручение — rollback fixture', details: 'Только искусственные материалы, без данных пациентов.', dueDate: tomorrow, facilityIds,
  });
  const upload = (purpose: 'report' | 'explanation' = 'report', text = 'Training evidence only.'): RegionalDirectiveUpload => ({
    fileName: `${purpose}.txt`, mimeType: 'text/plain', purpose, contentBase64: Buffer.from(text).toString('base64'),
  });
  const mutation = (type: 'progress' | 'submit' | 'explain' | 'review', assignmentId: string, expectedVersion: number, extra: object) => ({
    type, assignmentId, expectedVersion, idempotencyKey: randomUUID(), ...extra,
  });
  function selected(value: RegionalDirectivesSnapshot, directiveId: string, facilityId = facilityA) {
    const directive = value.directives.find(row => row.id === directiveId)!;
    expect(directive).toBeDefined();
    const assignment = directive.assignments.find(row => row.facilityId === facilityId)!;
    expect(assignment).toBeDefined();
    return { directive, assignment };
  }
  async function created(facilities = [facilityA, facilityB]) {
    const receipt = await command(createCommand(facilities));
    return selected(await snapshot(), receipt.directiveId);
  }
  async function download(id: string, subject: Subject = 'head-a') {
    return regionalDirectiveAttachmentResponseSchema.parse(await asRuntime('SELECT public.orion_regional_directive_attachment_v1($1,$2,$3) result', [issuer, subject, id]));
  }
  // Time is a test boundary: add a historical fixture instead of editing the
  // immutable issued date/deadline or changing the server clock.
  async function historical() {
    const directiveId = `historical-${randomUUID()}`; const assignmentId = `assignment-${randomUUID()}`;
    await db!.query(`INSERT INTO orion_region.directives(id,title,authority_reference,details,issued_by,issued_date,due_date)
      VALUES($1,'Historical training directive','Rollback fixture','No patient information',$2,$3::date,$4::date)`, [directiveId, identity('admin'), earlier, yesterday]);
    await db!.query('INSERT INTO orion_region.directive_assignments(id,directive_id,facility_id) VALUES($1,$2,$3)', [assignmentId, directiveId, facilityA]);
    await db!.query(`INSERT INTO orion_region.directive_events(assignment_id,version,user_id,action,status,progress,work_cycle)
      VALUES($1,1,$2,'create','assigned',0,1)`, [assignmentId, identity('admin')]);
    return selected(await snapshot(), directiveId);
  }

  it('parses real snapshots and keeps directive authority separate from clinical administrator authority', async () => {
    const admin = await snapshot();
    expect(admin.actorId).toBe(identity('admin'));
    expect(admin.capabilities).toEqual({ issue: true, review: true });
    expect(admin.facilities).toHaveLength(36);
    expect(admin.facilities.every(row => !row.canSubmit)).toBe(true);
    const head = await snapshot('head-a');
    expect(head.facilities.map(row => row.id)).toEqual([facilityA]);
    expect(head.facilities[0].canSubmit).toBe(true);
    expect(head.capabilities).toEqual({ issue: false, review: false });
    await expect(snapshot('platform-admin')).rejects.toMatchObject({ code: 'PT403' });
    await expect(snapshot('head-a', { facilityId: facilityB })).rejects.toMatchObject({ code: 'PT403' });
    expect(JSON.stringify(head)).not.toMatch(/contentBase64|patientId|birthDate|password|issuer/);
  });

  it('does not turn a dedicated administrative grant into access to patient records or the clinical network', async () => {
    for (const subject of ['admin', 'head-a'] as const) {
      await expect(asRuntime('SELECT public.orion_regional_facility_v1($1,$2,$3) result', [issuer, subject, facilityA]))
        .rejects.toMatchObject({ code: 'PT403' });
      await expect(asRuntime('SELECT public.orion_regional_overview_v1($1,$2) result', [issuer, subject]))
        .rejects.toMatchObject({ code: 'PT403' });
    }
  });

  it('keeps each hospital assignment independent and requires a report plus independent approval', async () => {
    const { directive, assignment } = await created();
    expect(directive.assignments).toHaveLength(2);
    await expect(command(createCommand(), 'head-a')).rejects.toMatchObject({ code: 'PT403' });
    await expect(command(mutation('progress', assignment.id, 1, { progress: 100 }))).rejects.toMatchObject({ code: 'PT403' });
    await command(mutation('progress', assignment.id, 1, { progress: 100 }), 'head-a');
    let current = selected(await snapshot(), directive.id);
    expect(current.assignment).toMatchObject({ status: 'in_progress', progress: 100, actualCompletedDate: null, version: 2 });
    expect(deriveDirectiveTimeline(current.directive, current.assignment, today).completion).toBe('pending');
    await command(mutation('submit', assignment.id, 2, { actualCompletedDate: today, attachments: [upload()] }), 'head-a');
    await expect(command(mutation('review', assignment.id, 3, { decision: 'accept' }), 'head-a')).rejects.toMatchObject({ code: 'PT403' });
    await command(mutation('review', assignment.id, 3, { decision: 'accept' }));
    current = selected(await snapshot(), directive.id);
    expect(current.assignment).toMatchObject({ status: 'accepted', version: 4, progress: 100, actualCompletedDate: today });
    expect(deriveDirectiveTimeline(current.directive, current.assignment, today).timeliness).toBe('accepted_on_time');
    expect(selected(await snapshot(), directive.id, facilityB).assignment).toMatchObject({ status: 'assigned', version: 1, progress: 0 });
    expect(current.assignment.history.map(row => row.action)).toEqual(['review', 'submit', 'progress', 'create']);
  });

  it('replays the same operation without another report and rejects changed UUID payloads or stale versions', async () => {
    const firstCommand = createCommand();
    const first = await command(firstCommand);
    expect(await command(firstCommand)).toEqual({ ...first, replayed: true });
    await expect(command({ ...firstCommand, title: 'Different instruction' })).rejects.toMatchObject({ code: 'PT409', message: 'DIRECTIVE_IDEMPOTENCY_CONFLICT' });
    const { assignment } = selected(await snapshot(), first.directiveId);
    const submission = mutation('submit', assignment.id, 1, { actualCompletedDate: today, attachments: [upload()] });
    const receipt = await command(submission, 'head-a');
    expect(await command(submission, 'head-a')).toEqual({ ...receipt, replayed: true });
    const current = selected(await snapshot(), first.directiveId).assignment;
    expect(current.attachments).toHaveLength(1); expect(current.history).toHaveLength(2);
    await expect(command(mutation('progress', assignment.id, 1, { progress: 50 }), 'head-a')).rejects.toMatchObject({ code: 'PT409', message: 'DIRECTIVE_VERSION_CONFLICT' });
  });

  it('keeps private downloads within the assigned hospital and returns the exact uploaded bytes and digest', async () => {
    const { directive, assignment } = await created();
    const file = upload();
    await command(mutation('submit', assignment.id, 1, { actualCompletedDate: today, attachments: [file] }), 'head-a');
    const metadata = selected(await snapshot(), directive.id).assignment.attachments[0];
    const result = await download(metadata.id);
    expect(result.contentBase64).toBe(file.contentBase64);
    expect(result.attachment.sha256).toBe(createHash('sha256').update(Buffer.from(file.contentBase64, 'base64')).digest('hex'));
    expect((await download(metadata.id, 'admin')).attachment.id).toBe(metadata.id);
    await expect(download(metadata.id, 'head-b')).rejects.toMatchObject({ code: 'PT403' });
    await expect(download(metadata.id, 'platform-admin')).rejects.toMatchObject({ code: 'PT403' });
    await expect(download('directive-file-missing', 'head-b')).rejects.toMatchObject({ code: 'PT403' });
    await expect(command(mutation('progress', assignment.id, 2, { progress: 25 }), 'head-b')).rejects.toMatchObject({ code: 'PT403' });
  });

  it('keeps timely actual completion timely even when the report and approval occur after the deadline', async () => {
    const { directive, assignment } = await historical();
    await command(mutation('submit', assignment.id, 1, { actualCompletedDate: yesterday, attachments: [upload()] }), 'head-a');
    let current = selected(await snapshot(), directive.id);
    expect(current.assignment.explanationRequired).toBe(false);
    expect(deriveDirectiveTimeline(current.directive, current.assignment, today).timeliness).toBe('reported_on_time');
    await command(mutation('review', assignment.id, 2, { decision: 'accept' }));
    current = selected(await snapshot(), directive.id);
    expect(Date.parse(current.assignment.reviewedAt!)).toBeGreaterThanOrEqual(Date.parse(`${today}T00:00:00+05:00`));
    expect(deriveDirectiveTimeline(current.directive, current.assignment, today).timeliness).toBe('accepted_on_time');
  });

  it('preserves the actual work date when documents are returned, while retaining both report revisions', async () => {
    const { directive, assignment } = await historical();
    await command(mutation('submit', assignment.id, 1, { actualCompletedDate: yesterday, attachments: [upload()] }), 'head-a');
    await command(mutation('review', assignment.id, 2, { decision: 'return_documents', remark: 'Приложите подпись к отчёту.' }));
    let current = selected(await snapshot(), directive.id).assignment;
    expect(current).toMatchObject({ status: 'returned_documents', actualCompletedDate: yesterday, progress: 100, version: 3 });
    await expect(command(mutation('submit', assignment.id, 3, { actualCompletedDate: today, attachments: [upload()] }), 'head-a'))
      .rejects.toMatchObject({ code: 'PT409', message: 'DIRECTIVE_COMPLETION_DATE_LOCKED' });
    await command(mutation('submit', assignment.id, 3, { actualCompletedDate: yesterday, attachments: [upload('report', 'Corrected training report.')] }), 'head-a');
    current = selected(await snapshot(), directive.id).assignment;
    expect(current.actualCompletedDate).toBe(yesterday); expect(current.attachments).toHaveLength(2);
    expect(current.history.map(row => row.version)).toEqual([4, 3, 2, 1]);
    await command(mutation('review', assignment.id, 4, { decision: 'accept' }));
    const accepted = selected(await snapshot(), directive.id);
    expect(deriveDirectiveTimeline(accepted.directive, accepted.assignment, today).timeliness).toBe('accepted_on_time');
  });

  it('starts a new work cycle after substantive return, requires a current explanation, and never moves the deadline', async () => {
    const { directive, assignment } = await historical();
    await command(mutation('submit', assignment.id, 1, { actualCompletedDate: today, attachments: [upload()] }), 'head-a');
    await expect(command(mutation('review', assignment.id, 2, { decision: 'accept' })))
      .rejects.toMatchObject({ code: 'PT409', message: 'DIRECTIVE_EXPLANATION_REQUIRED' });
    await command(mutation('explain', assignment.id, 2, { message: 'Причина задержки в учебном примере.', attachments: [upload('explanation')] }), 'head-a');
    await command(mutation('review', assignment.id, 3, { decision: 'return_work', remark: 'Работа требует повторного выполнения.' }));
    let current = selected(await snapshot(), directive.id);
    expect(current.assignment).toMatchObject({ status: 'returned_work', actualCompletedDate: null, submittedAt: null, progress: 0, explanationRequired: true, version: 4 });
    expect(current.directive.dueDate).toBe(yesterday);
    await expect(command(mutation('submit', assignment.id, 4, { actualCompletedDate: yesterday, attachments: [upload()] }), 'head-a'))
      .rejects.toMatchObject({ code: 'PT409', message: 'DIRECTIVE_REWORK_DATE_REQUIRED' });
    await command(mutation('submit', assignment.id, 4, { actualCompletedDate: today, attachments: [upload()] }), 'head-a');
    await expect(command(mutation('review', assignment.id, 5, { decision: 'accept' })))
      .rejects.toMatchObject({ code: 'PT409', message: 'DIRECTIVE_EXPLANATION_REQUIRED' });
    await command(mutation('explain', assignment.id, 5, { message: 'Объяснение нового цикла работ.', attachments: [upload('explanation')] }), 'head-a');
    await command(mutation('review', assignment.id, 6, { decision: 'accept' }));
    current = selected(await snapshot(), directive.id);
    expect(current.directive.dueDate).toBe(yesterday);
    expect(deriveDirectiveTimeline(current.directive, current.assignment, today).timeliness).toBe('accepted_late');
  });

  it('does not accept an explanatory letter before any missed deadline, including a NULL work date', async () => {
    const { assignment } = await created();
    await expect(command(mutation('explain', assignment.id, 1, { message: 'Not overdue.', attachments: [upload('explanation')] }), 'head-a'))
      .rejects.toMatchObject({ code: 'PT409', message: 'DIRECTIVE_INVALID_TRANSITION' });
  });

  it.each(['accept', 'return_documents', 'return_work'] as const)('rejects self-review for %s even when the submitter also has the dedicated administrator grant', async decision => {
    const { assignment } = await created();
    await command(mutation('submit', assignment.id, 1, { actualCompletedDate: today, attachments: [upload()] }), 'dual');
    await expect(command(mutation('review', assignment.id, 2, { decision, remark: 'Self-review not allowed.' }), 'dual'))
      .rejects.toMatchObject({ code: 'PT403' });
  });

  it.each(['grant', 'membership', 'account'] as const)('rechecks revoked %s before reads, downloads and idempotent command replay', async revoked => {
    const { directive, assignment } = await created();
    const submission = mutation('submit', assignment.id, 1, { actualCompletedDate: today, attachments: [upload()] });
    await command(submission, 'head-a');
    const fileId = selected(await snapshot(), directive.id).assignment.attachments[0].id;
    if (revoked === 'grant') await db!.query('UPDATE orion_region.directive_grants SET active=false WHERE user_id=$1', [identity('head-a')]);
    if (revoked === 'membership') await db!.query("UPDATE orion_directory.memberships SET status='disabled' WHERE user_id=$1", [identity('head-a')]);
    if (revoked === 'account') await db!.query("UPDATE orion_directory.accounts SET status='disabled' WHERE id=$1", [identity('head-a')]);
    await expect(snapshot('head-a')).rejects.toMatchObject({ code: 'PT403' });
    await expect(download(fileId)).rejects.toMatchObject({ code: 'PT403' });
    await expect(command(submission, 'head-a')).rejects.toMatchObject({ code: 'PT403' });
    expect(selected(await snapshot(), directive.id).assignment.version).toBe(2);
  });

  it('does not expose raw tables or private helper execution to the runtime role or PUBLIC', async () => {
    await expect(asRuntime('SELECT content result FROM orion_region.directive_attachments LIMIT 1')).rejects.toMatchObject({ code: '42501' });
    await expect(asRuntime('SELECT orion_region.directive_access($1,$2) result', [issuer, 'admin'])).rejects.toMatchObject({ code: '42501' });
    const publicPrivileges = (await db!.query(`SELECT p.proname FROM pg_proc p CROSS JOIN LATERAL aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) acl
      WHERE p.oid=ANY(ARRAY['public.orion_regional_directives_v1(text,text,jsonb)'::regprocedure,
        'public.orion_regional_directive_command_v1(text,text,jsonb)'::regprocedure,
        'public.orion_regional_directive_attachment_v1(text,text,text)'::regprocedure]) AND acl.grantee=0 AND acl.privilege_type='EXECUTE'`)).rows;
    expect(publicPrivileges).toEqual([]);
  });

  it.each(['../report.txt', 'report:secret.txt', 'CON.txt', 'report\u202etxt.txt', '.report.txt', 'report.txt.'])('rejects unsafe stored filename %s at the SQL boundary', async fileName => {
    const { directive, assignment } = await created();
    await expect(command(mutation('submit', assignment.id, 1, { actualCompletedDate: today, attachments: [{ ...upload(), fileName }] }), 'head-a'))
      .rejects.toMatchObject({ code: 'PT400' });
    expect(selected(await snapshot(), directive.id).assignment).toMatchObject({ version: 1, status: 'assigned', attachments: [] });
  });

  it.each([
    { label: 'ASCII duplicate', attachments: [upload(), { ...upload(), purpose: 'supporting', fileName: 'REPORT.txt' }] },
    { label: 'Cyrillic duplicate', attachments: [{ ...upload(), fileName: 'Отчёт.txt' }, { ...upload(), purpose: 'supporting', fileName: 'ОТЧЁТ.TXT' }] },
    { label: 'noncanonical base64', attachments: [{ ...upload(), contentBase64: 'Zh==' }] },
    { label: 'forged PDF signature', attachments: [{ ...upload(), fileName: 'report.pdf', mimeType: 'application/pdf' }] },
  ])('rejects $label without a partial report or revision', async ({ attachments }) => {
    const { directive, assignment } = await created();
    await expect(command(mutation('submit', assignment.id, 1, { actualCompletedDate: today, attachments }), 'head-a'))
      .rejects.toMatchObject({ code: 'PT400' });
    const current = selected(await snapshot(), directive.id).assignment;
    expect(current.version).toBe(1); expect(current.attachments).toEqual([]); expect(current.history).toHaveLength(1);
  });

  it('supports a bounded 2 MiB text report and refuses bytes beyond that limit', async () => {
    const { directive, assignment } = await created();
    const file = upload('report', 'x'.repeat(DIRECTIVE_FILE_BYTES));
    await command(mutation('submit', assignment.id, 1, { actualCompletedDate: today, attachments: [file] }), 'head-a');
    const stored = selected(await snapshot(), directive.id).assignment.attachments[0];
    expect(stored.byteLength).toBe(DIRECTIVE_FILE_BYTES);
    expect((await download(stored.id)).contentBase64).toBe(file.contentBase64);
    const other = selected(await snapshot(), directive.id, facilityB).assignment;
    await expect(command(mutation('submit', other.id, 1, { actualCompletedDate: today, attachments: [upload('report', 'x'.repeat(DIRECTIVE_FILE_BYTES + 1))] }), 'head-b'))
      .rejects.toMatchObject({ code: 'PT400' });
  }, 30000);

  it('rejects an API deadline edit and future completion without changing existing work', async () => {
    const { directive, assignment } = await created();
    await expect(command({ ...mutation('progress', assignment.id, 1, { progress: 25 }), dueDate: tomorrow }, 'head-a'))
      .rejects.toMatchObject({ code: 'PT400' });
    await expect(command(mutation('submit', assignment.id, 1, { actualCompletedDate: tomorrow, attachments: [upload()] }), 'head-a'))
      .rejects.toMatchObject({ code: 'PT400' });
    const current = selected(await snapshot(), directive.id);
    expect(current.assignment.version).toBe(1); expect(current.directive.dueDate).toBe(tomorrow);
  });

  it.each(['\u00a0', '😀'.repeat(91)])('does not persist a title that would invalidate the readable DTO', async title => {
    await expect(command({ ...createCommand(), title })).rejects.toMatchObject({ code: 'PT400' });
    await expect(snapshot()).resolves.toMatchObject({ schemaVersion: 1 });
  });
});
