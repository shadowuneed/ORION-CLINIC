'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, Check, KeyRound, LockKeyhole, Plus, RefreshCw, Search, ShieldCheck, UserRoundCog, Users, X } from 'lucide-react';
import { clinicPermissions, organizationRoles, type OrganizationRole } from '@/lib/domain/access-governance';
import type { DirectoryCommand, DirectorySnapshot } from '@/lib/clinical/directory-contracts';
import { DirectoryRequestError, directoryCommand, loadDirectory, LOCAL_DIRECTORY_CLINIC } from './directory-client';
import { buildTeamGrant, buildTeamRestriction, effectiveTeamPermissions, emptyTeamGrant, permissionChoice, teamAccountName, teamPermissions, teamRoles, type TeamGrant, type TeamRestriction } from './team-model';
import styles from './team.module.css';

type Confirmation = TeamRestriction;
function errorText(error: unknown) { return error instanceof Error ? error.message : 'Изменение не подтверждено. Обновите состояние перед повтором.'; }
export function ClinicalTeam({ initialSnapshot }: { initialSnapshot?: DirectorySnapshot }) {
  const [snapshot, setSnapshot] = useState<DirectorySnapshot | null>(initialSnapshot ?? null);
  const [loading, setLoading] = useState(!initialSnapshot); const [denied, setDenied] = useState(false);
  const [error, setError] = useState<string | null>(null); const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false); const busyRef = useRef(false);
  const [search, setSearch] = useState(''); const [newName, setNewName] = useState(''); const [showCreate, setShowCreate] = useState(false);
  const [createdId, setCreatedId] = useState<string | null>(null);
  const [form, setForm] = useState<TeamGrant | null>(null); const [confirmation, setConfirmation] = useState<Confirmation | null>(null);
  const commandKeys = useRef(new Map<string, string>()); const formHeading = useRef<HTMLHeadingElement>(null);
  const handleError = useCallback((caught: unknown) => {
    setError(errorText(caught));
    if (caught instanceof DirectoryRequestError && [401, 403].includes(caught.status)) {
      setDenied(true); setSnapshot(null); setForm(null); setConfirmation(null);
    }
  }, [setError, setDenied, setSnapshot, setForm, setConfirmation]);
  const refresh = useCallback(async () => {
    const next = await loadDirectory(); setSnapshot(next); setDenied(false); return next;
  }, [setSnapshot, setDenied]);
  useEffect(() => {
    const controller = new AbortController();
    void loadDirectory(controller.signal).then(next => { if (!controller.signal.aborted) { setSnapshot(next); setDenied(false); } }).catch(caught => {
      if (!controller.signal.aborted) handleError(caught);
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [handleError]);
  const run = async (action: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null); setMessage(null);
    try { await action(); } catch (caught) { handleError(caught); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const idempotency = (input: unknown) => {
    const fingerprint = JSON.stringify(input); const key = commandKeys.current.get(fingerprint) ?? crypto.randomUUID();
    commandKeys.current.set(fingerprint, key); return { fingerprint, key };
  };
  const execute = async (command: DirectoryCommand, fingerprint: string) => {
    const receipt = await directoryCommand(command); await refresh(); commandKeys.current.delete(fingerprint); return receipt;
  };
  const createAccount = () => run(async () => {
    if (!snapshot || snapshot.clinic.id !== LOCAL_DIRECTORY_CLINIC || newName.trim().length < 2) throw new Error('Введите имя сотрудника этой клиники.');
    const input = { type: 'account.create' as const, clinicId: snapshot.clinic.id, name: newName.trim() }; const { fingerprint, key } = idempotency(input);
    const receipt = await execute({ ...input, idempotencyKey: key }, fingerprint);
    setCreatedId(receipt.userId); setNewName(''); setShowCreate(false);
    setMessage('Учётная запись и участие в клинике созданы без ролей и без пароля. Доступ и локальные данные для входа настраиваются отдельно.');
  });
  const openGrant = (membershipId: string, assignment?: DirectorySnapshot['assignments'][number]) => {
    setConfirmation(null); setError(null);
    setForm(assignment ? { membershipId, assignmentId: assignment.id, expectedVersion: assignment.version,
      roles: [...assignment.roles], allowPermissions: [...assignment.allowPermissions], denyPermissions: [...assignment.denyPermissions],
      staffId: assignment.staffId ?? '', specialty: assignment.specialty ?? '', reason: '', confirmed: false } :
      { ...emptyTeamGrant(), membershipId });
    requestAnimationFrame(() => formHeading.current?.focus());
  };
  const changeForm = (values: Partial<TeamGrant>) => setForm(current => current ? { ...current, ...values, confirmed: false } : null);
  const toggleRole = (role: OrganizationRole, checked: boolean) => {
    if (form) changeForm({ roles: checked ? [...form.roles, role] : form.roles.filter(item => item !== role) });
  };
  const saveGrant = () => run(async () => {
    if (!snapshot || !form) throw new Error('Выберите сотрудника и назначение.');
    const { fingerprint, key } = idempotency({ clinicId: snapshot.clinic.id, form });
    const command = buildTeamGrant(snapshot, form, key);
    await execute(command, fingerprint); setForm(null); setMessage('Назначение сохранено в PostgreSQL. Сервер проверяет эти права на каждом запросе.');
  });
  const openConfirmation = (selection: Omit<Confirmation, 'reason' | 'confirmed'>) => {
    setForm(null); setConfirmation({ ...selection, reason: '', confirmed: false }); setError(null);
    requestAnimationFrame(() => formHeading.current?.focus());
  };
  const confirmRestriction = () => run(async () => {
    if (!snapshot || !confirmation) throw new Error('Выберите сотрудника и назначение.');
    const { fingerprint, key } = idempotency({ clinicId: snapshot.clinic.id, confirmation });
    await execute(buildTeamRestriction(snapshot, confirmation, key), fingerprint); setConfirmation(null);
    setMessage('Изменение доступа сохранено. Медицинские записи сотрудника не удалены.');
  });
  const memberships = useMemo(() => snapshot?.memberships.filter(membership => {
    const name = teamAccountName(snapshot, membership.id);
    return `${name} ${membership.userId}`.toLocaleLowerCase('ru-RU').includes(search.trim().toLocaleLowerCase('ru-RU'));
  }) ?? [], [snapshot, search]);
  const effective = form ? effectiveTeamPermissions(form) : [];

  if (!snapshot) return <main className={styles.state}><LockKeyhole size={36} /><h1>{denied ? 'Управление доступом закрыто' : loading ? 'Проверяем доступ администратора' : 'Справочник пока недоступен'}</h1>
    <p>{error ?? 'Загружаем учётные записи из PostgreSQL. Роли и пароли не создаются автоматически.'}</p><Link href="/">Вернуться в рабочий центр</Link>
    {!loading && <button type="button" disabled={busy} onClick={() => void run(async () => { await refresh(); })}>Повторить проверку</button>}</main>;
  return <main className={styles.page}>
    <header className={styles.header}><div><Link className={styles.back} href="/"><ArrowLeft size={16} /> Рабочий центр</Link><span className={styles.eyebrow}>{snapshot.clinic.name} · PostgreSQL</span><h1>Команда и доступ</h1><p>Сотрудник, его роль и границы доступа — отдельные решения администратора.</p></div><div className={styles.actions}>
      <button type="button" disabled={busy} onClick={() => void run(async () => { await refresh(); setMessage('Список обновлён. Открытые изменения нужно сверить с актуальной версией.'); })}><RefreshCw size={16} /> Обновить</button>
      <button type="button" className={styles.primary} disabled={busy} onClick={() => setShowCreate(value => !value)}><Plus size={16} /> Добавить сотрудника</button>
    </div></header>
    {error && <p className={styles.error} role="alert">{error}</p>}{message && <p className={styles.success} role="status">{message}</p>}
    {createdId && <section className={styles.credentialsNotice}><KeyRound size={21} /><div><strong>Создан ID: <code>{createdId}</code></strong><p>Это идентификатор записи, не логин или пароль. Локальный пароль ещё не создан. Администратору компьютера нужно выполнить из папки ORION:</p><code>node scripts/configure-postgres-account.mjs {createdId}</code><p>Команда выдаёт только первый пароль и сохраняет его в приватной локальной памятке. Существующий пароль не заменяется. Не вводите пароль в клинические заметки.</p></div><button type="button" aria-label="Закрыть уведомление об учётной записи" onClick={() => setCreatedId(null)}><X size={16} /></button></section>}
    {showCreate && <form className={styles.create} onSubmit={event => { event.preventDefault(); void createAccount(); }}><label htmlFor="new-staff-name">Имя сотрудника<input id="new-staff-name" value={newName} onChange={event => setNewName(event.target.value)} maxLength={160} minLength={2} required disabled={busy} placeholder="Фамилия и имя" /></label>
      <div><button type="submit" className={styles.primary} disabled={busy || newName.trim().length < 2}>Создать запись без пароля</button><p>Роли, назначения пациентов и пароль этим действием не выдаются.</p></div></form>}
    <div className={styles.info}><ShieldCheck size={20} /><p>Права действуют только в этой клинике. Роль врача сама по себе не открывает всех пациентов: сервер также проверяет связь с лечением. Прямой запрет отменяет разрешение роли.</p></div>
    <div className={styles.layout}>
      <section className={styles.listPanel} aria-label="Сотрудники клиники"><div className={styles.search}><Search size={18} /><input aria-label="Найти сотрудника" value={search} onChange={event => setSearch(event.target.value)} placeholder="Имя сотрудника или ID" /></div>
        <div className={styles.count}><Users size={16} />{memberships.length} сотрудников в выборке</div>
        {memberships.length ? memberships.map(membership => {
          const account = snapshot.accounts.find(item => item.id === membership.userId); const active = membership.status === 'active' && account?.status === 'active';
          const assignments = snapshot.assignments.filter(item => item.membershipId === membership.id);
          return <article className={styles.person} key={membership.id}><header><div><h2>{account?.name ?? 'Недоступная учётная запись'}</h2><small>{membership.userId}</small></div><span className={active && membership.interactive ? styles.active : styles.disabled}>{!active ? 'Участие отключено' : membership.interactive ? 'Участие активно' : 'Интерактивный вход закрыт'}</span></header>
            {!membership.interactive && <p className={styles.hint}>Это участие не разрешает интерактивный вход. Изменение ролей само по себе не включает вход.</p>}
            {assignments.length ? assignments.map(assignment => <div className={styles.assignment} key={assignment.id}><div className={styles.assignmentTitle}><strong>{assignment.roles.map(role => teamRoles[role]).join(' · ')}</strong><span>v{assignment.version} · {assignment.status === 'active' ? 'действует' : 'отозвано'}</span></div>
              <details><summary>Разрешения: {assignment.effectivePermissions.length}</summary><ul className={styles.permissionList}>{assignment.effectivePermissions.map(permission => <li key={permission}><Check size={13} />{teamPermissions[permission]}</li>)}</ul>
                {assignment.denyPermissions.length > 0 && <p className={styles.denied}>Явно запрещено: {assignment.denyPermissions.map(permission => teamPermissions[permission]).join(', ')}</p>}
                <p className={styles.hint}>Назначение {assignment.id}</p></details>
              {active && assignment.status === 'active' && <div className={styles.actions}>{membership.interactive && <button type="button" disabled={busy} onClick={() => openGrant(membership.id, assignment)}>Изменить назначение</button>}<button type="button" className={styles.dangerButton} disabled={busy} onClick={() => openConfirmation({ type: 'assignment.revoke', membershipId: membership.id, resourceId: assignment.id, expectedVersion: assignment.version, name: account!.name })}>Отозвать назначение</button></div>}
            </div>) : <p className={styles.hint}>Назначений нет. Учётная запись не даёт клинических полномочий без действующего назначения.</p>}
            {active && <footer className={styles.actions}>{membership.interactive && <button type="button" disabled={busy} onClick={() => openGrant(membership.id)}><Plus size={14} /> Новое назначение</button>}<button type="button" className={styles.dangerButton} disabled={busy} onClick={() => openConfirmation({ type: 'membership.disable', membershipId: membership.id, resourceId: membership.id, expectedVersion: membership.version, name: account!.name })}>Отключить от клиники</button></footer>}
          </article>;
        }) : <p className={styles.empty}>{search ? 'Сотрудников по этому запросу нет.' : 'В подтверждённом справочнике пока нет сотрудников.'}</p>}
      </section>
      <aside className={styles.editor} aria-label="Изменение доступа">
        {!form && !confirmation && <div className={styles.instructions}><UserRoundCog size={35} /><h2>Выберите действие у сотрудника</h2><p>Просмотрите действующие разрешения, затем откройте нужное назначение. Изменения не сохраняются при выборе роли — только после проверки и подтверждения.</p><ol><li>Учётная запись идентифицирует сотрудника.</li><li>Участие связывает его с клиникой.</li><li>Назначение определяет роли и разрешения.</li><li>Локальный пароль настраивается отдельно.</li></ol></div>}
        {form && <form onSubmit={event => { event.preventDefault(); void saveGrant(); }}><header className={styles.editorHeading}><div><span className={styles.eyebrow}>{form.assignmentId ? 'Изменение назначения' : 'Новое назначение'}</span><h2 ref={formHeading} tabIndex={-1}>{teamAccountName(snapshot, form.membershipId)}</h2></div><button type="button" aria-label="Закрыть редактор назначения" disabled={busy} onClick={() => setForm(null)}><X size={17} /></button></header>
          <fieldset disabled={busy}><legend>Роли — выберите явно</legend><div className={styles.roles}>{organizationRoles.map(role => <label key={role}><input type="checkbox" checked={form.roles.includes(role)} onChange={event => toggleRole(role, event.target.checked)} /><span>{teamRoles[role]}</span></label>)}</div><p className={styles.hint}>Техническую интеграцию нельзя совмещать с личными ролями сотрудника.</p></fieldset>
          {form.roles.includes('doctor') && <fieldset disabled={busy}><legend>Связь с врачом в клинике</legend><label htmlFor="staff-position">Штатная запись врача<select id="staff-position" value={form.staffId} onChange={event => changeForm({ staffId: event.target.value })}><option value="">Выберите существующую запись</option>{snapshot.staff.filter(item => item.role === 'doctor').map(item => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label htmlFor="staff-specialty">Специальность<input id="staff-specialty" value={form.specialty} maxLength={160} onChange={event => changeForm({ specialty: event.target.value })} placeholder="Например, эндокринолог" /></label><p className={styles.hint}>Проверьте соответствие реальному сотруднику. Существующее назначение другому человеку не переносится автоматически.</p></fieldset>}
          <details className={styles.overrides}><summary>Точные разрешения и запреты</summary><p className={styles.hint}>«По роли» использует базовые права роли. «Запретить» исключает право даже при его наличии в роли.</p><div className={styles.overridesGrid}>{clinicPermissions.map(permission => <label key={permission}>{teamPermissions[permission]}<select disabled={busy} aria-label={`Право: ${teamPermissions[permission]}`} value={form.denyPermissions.includes(permission) ? 'deny' : form.allowPermissions.includes(permission) ? 'allow' : 'default'} onChange={event => setForm(current => current ? permissionChoice(current, permission, event.target.value as 'default' | 'allow' | 'deny') : null)}><option value="default">По роли</option><option value="allow">Разрешить дополнительно</option><option value="deny">Запретить</option></select></label>)}</div></details>
          <div className={styles.preview}><strong>После сохранения: {effective.length} разрешений</strong>{effective.length ? <ul>{effective.map(permission => <li key={permission}>{teamPermissions[permission]}</li>)}</ul> : <p>Права ещё не выбраны.</p>}<p>Это предварительный расчёт. Сервер проверит полномочия администратора и границы доступа повторно.</p></div>
          <label className={styles.field} htmlFor="grant-reason">Причина изменения<textarea id="grant-reason" value={form.reason} maxLength={1000} rows={3} required disabled={busy} onChange={event => changeForm({ reason: event.target.value })} placeholder="Основание назначения или изменения обязанностей" /></label>
          <label className={styles.confirm}><input type="checkbox" checked={form.confirmed} disabled={busy} onChange={event => setForm(current => current ? { ...current, confirmed: event.target.checked } : null)} /><span>Проверил(а) сотрудника, роли, дополнительные разрешения и запреты. Подтверждаю это назначение.</span></label>
          <button type="submit" className={styles.primary} disabled={busy || !form.confirmed || !form.roles.length || !form.reason.trim()}><ShieldCheck size={17} />{busy ? 'Сохраняем…' : 'Сохранить назначение'}</button>
        </form>}
        {confirmation && <form onSubmit={event => { event.preventDefault(); void confirmRestriction(); }}><header className={styles.editorHeading}><div><span className={styles.eyebrow}>Ограничение доступа</span><h2 ref={formHeading} tabIndex={-1}>{confirmation.type === 'membership.disable' ? 'Отключить от клиники?' : 'Отозвать назначение?'}</h2></div><button type="button" aria-label="Отменить ограничение доступа" disabled={busy} onClick={() => setConfirmation(null)}><X size={17} /></button></header>
          <div className={styles.warning}><strong>{confirmation.name}</strong><p>{confirmation.type === 'membership.disable' ? 'Доступ через все назначения этого участия будет закрыт. Медицинские записи не удаляются; доступ в других клиниках этим действием не меняется.' : 'Будут отозваны права выбранного назначения. Другие действующие назначения сотрудника сохранятся.'}</p><small>Версия для изменения: {confirmation.expectedVersion}</small></div>
          <label className={styles.field} htmlFor="restriction-reason">Причина<textarea id="restriction-reason" required maxLength={1000} rows={4} value={confirmation.reason} disabled={busy} onChange={event => setConfirmation(current => current ? { ...current, reason: event.target.value, confirmed: false } : null)} /></label>
          <label className={styles.confirm}><input type="checkbox" checked={confirmation.confirmed} disabled={busy} onChange={event => setConfirmation(current => current ? { ...current, confirmed: event.target.checked } : null)} /><span>Подтверждаю ограничение доступа для {confirmation.name}. Причина указана верно.</span></label>
          <div className={styles.actions}><button type="submit" className={styles.restrict} disabled={busy || !confirmation.confirmed || !confirmation.reason.trim()}>{busy ? 'Сохраняем…' : confirmation.type === 'membership.disable' ? 'Да, отключить участие' : 'Да, отозвать назначение'}</button><button type="button" disabled={busy} onClick={() => setConfirmation(null)}>Отмена</button></div>
        </form>}
      </aside>
    </div>
  </main>;
}
