'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import {
  Building2,
  Check,
  CircleAlert,
  KeyRound,
  LoaderCircle,
  Pencil,
  Plus,
  RotateCcw,
  ShieldCheck,
  UserRoundCog,
  UserX,
  X,
} from 'lucide-react';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
import {
  clinicPermissions,
  organizationRoles,
  type ClinicPermission,
  type OrganizationRole,
} from '@/lib/domain/access-governance';
import type {
  AccessAdministrationWorkspace as Workspace,
  ManagedAccessAssignment,
  ManagedDepartment,
} from '@/lib/repositories/access-administration';
import styles from './access-administration-workspace.module.css';

const roleLabels: Record<OrganizationRole, string> = {
  doctor: 'Врач',
  nurse: 'Медсестра',
  registrar: 'Регистратор',
  administrator: 'Администратор',
  medical_lead: 'Медицинский руководитель',
  auditor: 'Аудитор',
  service: 'Сервисная роль',
};

const permissionLabels: Record<ClinicPermission, string> = {
  'clinic.dashboard.read': 'Рабочий день',
  'patient.directory.read': 'Реестр пациентов',
  'patient.profile.write': 'Изменение карточек',
  'encounter.read': 'Просмотр приёмов',
  'encounter.manage': 'Ведение приёма',
  'orders.manage': 'Направления',
  'scheduling.manage': 'Запись и очередь',
  'care.manage': 'Наблюдение',
  'observations.manage': 'Показатели',
  'communications.manage': 'Связь с пациентом',
  'access.self.read': 'Собственные права',
  'access.manage': 'Управление доступом',
  'audit.read': 'Журнал аудита',
  'clinical_policy.review': 'Проверка клинических правил',
  'service.integration.execute': 'Системная интеграция',
};

const kindLabels = {
  clinical: 'Клиническое',
  diagnostic: 'Диагностическое',
  administrative: 'Административное',
  support: 'Поддержка',
} as const;

type DialogState =
  | { kind: 'department-create' }
  | { kind: 'department-edit'; department: ManagedDepartment }
  | { kind: 'assignment-grant'; effectiveFrom: number }
  | { kind: 'assignment-edit'; assignment: ManagedAccessAssignment }
  | { kind: 'assignment-revoke'; assignment: ManagedAccessAssignment }
  | null;

type ApiError = { error?: { message?: string; requestId?: string } };

function formatDate(value: number | null) {
  if (value === null) return 'Без ограничения';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Almaty',
  }).format(new Date(value));
}

function toDateTimeLocal(value: number) {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(value - offset).toISOString().slice(0, 16);
}

function toTimestamp(value: string) {
  return new Date(value).getTime();
}

export function AccessAdministrationWorkspace({
  actorAssignmentId,
  facility,
  organization,
  initialWorkspace,
}: {
  actorAssignmentId: string;
  facility: { id: string; name: string };
  organization: { id: string; name: string };
  initialWorkspace: Workspace;
}) {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const [selectedDepartmentId, setSelectedDepartmentId] = useState(
    initialWorkspace.departments[0]?.id ?? '',
  );
  const [dialog, setDialog] = useState<DialogState>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<{ message: string; requestId?: string } | null>(null);

  const selectedDepartment =
    workspace.departments.find((department) => department.id === selectedDepartmentId) ??
    workspace.departments[0] ?? null;
  const assignments = selectedDepartment
    ? workspace.assignments.filter(
        (assignment) => assignment.departmentId === selectedDepartment.id,
      )
    : [];
  const activeAssignments = workspace.assignments.filter(
    (assignment) => assignment.status === 'active',
  ).length;

  async function refresh() {
    const query = new URLSearchParams({
      facilityId: facility.id,
      actorAssignmentId,
    });
    const response = await fetch(`/api/access/admin?${query.toString()}`, {
      cache: 'no-store',
    });
    const body = (await response.json()) as { workspace?: Workspace } & ApiError;
    if (!response.ok || !body.workspace) {
      throw new Error(body.error?.message ?? 'Не удалось обновить данные D1.');
    }
    setWorkspace(body.workspace);
    setSelectedDepartmentId((current) =>
      body.workspace?.departments.some((item) => item.id === current)
        ? current
        : body.workspace?.departments[0]?.id ?? '',
    );
  }

  async function mutate(
    path: string,
    method: 'POST' | 'PATCH',
    payload: Record<string, unknown>,
    successMessage: string,
  ) {
    setBusy(true);
    setError(null);
    setMessage(null);
    try {
      const response = await fetch(path, {
        method,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          facilityId: facility.id,
          actorAssignmentId,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = (await response.json()) as ApiError;
      if (!response.ok) {
        setError({
          message: body.error?.message ?? 'Команда отклонена.',
          requestId: body.error?.requestId,
        });
        return;
      }
      await refresh();
      setDialog(null);
      setMessage(successMessage);
    } catch {
      setError({ message: 'Сервер недоступен. Изменения не подтверждены.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Версионируемые полномочия · D1</span>
          <h1>Управление доступом</h1>
          <p>{organization.name} · {facility.name}</p>
        </div>
        <button className={styles.primaryButton} onClick={() => setDialog({ kind: 'department-create' })} type="button">
          <Plus aria-hidden="true" size={18} /> Новое отделение
        </button>
      </header>

      {message ? <div className={styles.successMessage} role="status"><Check size={18} /><span>{message}</span><button aria-label="Закрыть сообщение" onClick={() => setMessage(null)} type="button"><X size={17} /></button></div> : null}
      {error && !dialog ? <ErrorMessage error={error} onClose={() => setError(null)} /> : null}

      <section className={styles.metrics} aria-label="Состояние доступа">
        <article><Building2 size={19} /><span><small>Отделения</small><strong>{workspace.departments.length}</strong></span></article>
        <article><ShieldCheck size={19} /><span><small>Действующие назначения</small><strong>{activeAssignments}</strong></span></article>
        <article><UserRoundCog size={19} /><span><small>Сотрудники филиала</small><strong>{workspace.memberships.length}</strong></span></article>
      </section>

      <section className={styles.boundary}>
        <KeyRound aria-hidden="true" size={21} />
        <div><strong>Каждая команда создаёт новую неизменяемую версию</strong><p>Удаления истории нет. Отзыв доступа сохраняется как новая версия и попадает в журнал аудита.</p></div>
        <Link href={`/access?assignmentId=${encodeURIComponent(actorAssignmentId)}`}>Мои права</Link>
      </section>

      <div className={styles.workspace}>
        <aside className={styles.departmentPanel}>
          <div className={styles.panelHeader}><div><small>Структура филиала</small><h2>Отделения</h2></div></div>
          {workspace.departments.length ? (
            <div className={styles.departmentList}>
              {workspace.departments.map((department) => {
                const count = workspace.assignments.filter(
                  (assignment) => assignment.departmentId === department.id,
                ).length;
                const active = department.id === selectedDepartment?.id;
                return (
                  <button
                    aria-current={active ? 'true' : undefined}
                    className={active ? styles.departmentActive : ''}
                    key={department.id}
                    onClick={() => setSelectedDepartmentId(department.id)}
                    type="button"
                  >
                    <span><strong>{department.name}</strong><small>{department.code} · версия {department.version}</small></span>
                    <em className={department.status === 'active' ? styles.statusActive : styles.statusDisabled}>{department.status === 'active' ? 'Активно' : 'Отключено'}</em>
                    <b>{count}</b>
                  </button>
                );
              })}
            </div>
          ) : (
            <div className={styles.emptyCompact}><Building2 size={25} /><strong>Отделений пока нет</strong><span>Создайте первое отделение для назначения сотрудников.</span></div>
          )}
        </aside>

        <section className={styles.assignmentPanel}>
          {selectedDepartment ? (
            <>
              <div className={styles.assignmentHeader}>
                <div><span className={styles.eyebrow}>{kindLabels[selectedDepartment.kind]} отделение</span><h2>{selectedDepartment.name}</h2><p>Код неизменяемого корня: <code>{selectedDepartment.code}</code></p></div>
                <div className={styles.headerActions}>
                  <button className={styles.secondaryButton} onClick={() => setDialog({ kind: 'department-edit', department: selectedDepartment })} type="button"><Pencil size={17} /> Изменить</button>
                  <button className={styles.primaryButton} disabled={selectedDepartment.status !== 'active'} onClick={() => setDialog({ kind: 'assignment-grant', effectiveFrom: Date.now() })} type="button"><Plus size={17} /> Выдать доступ</button>
                </div>
              </div>
              <div className={styles.versionLine}><span>Текущая версия {selectedDepartment.version}</span><span>{selectedDepartment.changeReason}</span><span>{formatDate(selectedDepartment.changedAt)}</span></div>
              {assignments.length ? (
                <div className={styles.assignmentList}>
                  {assignments.map((assignment) => {
                    const self = assignment.id === actorAssignmentId;
                    return (
                      <article key={assignment.id}>
                        <div className={styles.assignmentIdentity}><span className={styles.personMark} aria-hidden="true">{assignment.memberDisplayName.slice(0, 1)}</span><span><strong>{assignment.memberDisplayName}</strong><small>{assignment.roles.map((role) => roleLabels[role]).join(', ')}</small></span></div>
                        <div className={styles.assignmentTerms}><span><small>Статус</small><strong className={assignment.status === 'active' ? styles.statusTextActive : styles.statusTextInactive}>{assignment.status === 'active' ? 'Действует' : assignment.status === 'expired' ? 'Истёк' : 'Отозван'}</strong></span><span><small>Срок</small><strong>{formatDate(assignment.effectiveFrom)} — {formatDate(assignment.effectiveUntil)}</strong></span><span><small>Версия</small><strong>{assignment.version}</strong></span></div>
                        <div className={styles.assignmentActions}>
                          {self ? <span className={styles.selfBadge}>Текущий контур</span> : <>
                            <button className={styles.secondaryButton} onClick={() => setDialog({ kind: 'assignment-edit', assignment })} type="button">{assignment.status === 'revoked' ? <RotateCcw size={16} /> : <Pencil size={16} />}{assignment.status === 'revoked' ? 'Возобновить' : 'Изменить'}</button>
                            {assignment.status !== 'revoked' ? <button className={styles.dangerButton} onClick={() => setDialog({ kind: 'assignment-revoke', assignment })} type="button"><UserX size={16} /> Отозвать</button> : null}
                          </>}
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className={styles.empty}><UserRoundCog size={30} /><strong>Назначений в отделении нет</strong><p>Выберите сотрудника и выдайте только необходимые роли и разрешения.</p><button className={styles.primaryButton} disabled={selectedDepartment.status !== 'active'} onClick={() => setDialog({ kind: 'assignment-grant', effectiveFrom: Date.now() })} type="button"><Plus size={17} /> Выдать первый доступ</button></div>
              )}
            </>
          ) : (
            <div className={styles.empty}><Building2 size={30} /><strong>Создайте отделение</strong><p>После этого появится управление назначениями сотрудников.</p></div>
          )}
        </section>
      </div>

      {dialog?.kind === 'department-create' || dialog?.kind === 'department-edit' ? (
        <DepartmentDialog
          busy={busy}
          department={dialog.kind === 'department-edit' ? dialog.department : null}
          error={error}
          protectedDepartment={
            dialog.kind === 'department-edit' &&
            workspace.assignments.some(
              (assignment) =>
                assignment.id === actorAssignmentId &&
                assignment.departmentId === dialog.department.id,
            )
          }
          onClose={() => { if (!busy) { setDialog(null); setError(null); } }}
          onSubmit={(payload) =>
            dialog.kind === 'department-create'
              ? mutate('/api/access/admin/departments', 'POST', payload, 'Отделение создано и сохранено в D1.')
              : mutate(`/api/access/admin/departments/${encodeURIComponent(dialog.department.id)}`, 'PATCH', { ...payload, expectedVersion: dialog.department.version }, 'Новая версия отделения сохранена.')
          }
        />
      ) : null}

      {selectedDepartment && (dialog?.kind === 'assignment-grant' || dialog?.kind === 'assignment-edit' || dialog?.kind === 'assignment-revoke') ? (
        <AssignmentDialog
          assignment={dialog.kind === 'assignment-grant' ? null : dialog.assignment}
          busy={busy}
          department={selectedDepartment}
          error={error}
          memberships={workspace.memberships.filter((membership) =>
            dialog.kind !== 'assignment-grant' ||
            !workspace.assignments.some((assignment) => assignment.departmentId === selectedDepartment.id && assignment.membershipId === membership.id)
          )}
          initialEffectiveFrom={
            dialog.kind === 'assignment-grant'
              ? dialog.effectiveFrom
              : dialog.assignment.effectiveFrom
          }
          mode={dialog.kind === 'assignment-revoke' ? 'revoke' : dialog.kind === 'assignment-edit' ? 'edit' : 'grant'}
          onClose={() => { if (!busy) { setDialog(null); setError(null); } }}
          onSubmit={(payload) => {
            if (dialog.kind === 'assignment-grant') {
              return mutate('/api/access/admin/assignments', 'POST', { ...payload, departmentId: selectedDepartment.id }, 'Доступ выдан и сохранён в D1.');
            }
            return mutate(`/api/access/admin/assignments/${encodeURIComponent(dialog.assignment.id)}`, 'PATCH', { ...payload, expectedVersion: dialog.assignment.version }, dialog.kind === 'assignment-revoke' ? 'Доступ отозван. История сохранена.' : 'Новая версия доступа сохранена.');
          }}
        />
      ) : null}
    </main>
  );
}

function ErrorMessage({ error, onClose }: { error: { message: string; requestId?: string }; onClose?: () => void }) {
  return <div className={styles.errorMessage} role="alert"><CircleAlert size={18} /><span><strong>{error.message}</strong>{error.requestId ? <small>{error.requestId}</small> : null}</span>{onClose ? <button aria-label="Закрыть ошибку" onClick={onClose} type="button"><X size={17} /></button> : null}</div>;
}

function DepartmentDialog({
  busy,
  department,
  error,
  protectedDepartment,
  onClose,
  onSubmit,
}: {
  busy: boolean;
  department: ManagedDepartment | null;
  error: { message: string; requestId?: string } | null;
  protectedDepartment: boolean;
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const [code, setCode] = useState(department?.code ?? '');
  const [name, setName] = useState(department?.name ?? '');
  const [kind, setKind] = useState<ManagedDepartment['kind']>(department?.kind ?? 'clinical');
  const [status, setStatus] = useState<ManagedDepartment['status']>(department?.status ?? 'active');
  const [reason, setReason] = useState('');
  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form aria-labelledby="department-dialog-title" aria-modal="true" className={styles.dialog} onSubmit={(event) => { event.preventDefault(); onSubmit({ ...(department ? {} : { code }), name, kind, status, changeReason: reason }); }} role="dialog">
        <header><div><span className={styles.eyebrow}>Версионный справочник</span><h2 id="department-dialog-title">{department ? 'Изменить отделение' : 'Новое отделение'}</h2></div><button aria-label="Закрыть" disabled={busy} onClick={onClose} type="button"><X size={19} /></button></header>
        {error ? <ErrorMessage error={error} /> : null}
        <div className={styles.formGrid}>
          <label><span>Код</span><input disabled={Boolean(department)} maxLength={40} minLength={2} onChange={(event) => setCode(event.target.value.toLowerCase().replace(/[^a-z0-9_-]/g, ''))} placeholder="endocrinology" required value={code} /></label>
          <label><span>Тип</span><select onChange={(event) => setKind(event.target.value as ManagedDepartment['kind'])} value={kind}>{Object.entries(kindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className={styles.fullField}><span>Название</span><input maxLength={160} minLength={2} onChange={(event) => setName(event.target.value)} required value={name} /></label>
          {department ? <label><span>Статус</span><select onChange={(event) => setStatus(event.target.value as ManagedDepartment['status'])} value={status}><option value="active">Активно</option><option disabled={protectedDepartment} value="disabled">Отключено</option></select>{protectedDepartment ? <small>Текущий административный контур нельзя отключить из самого себя.</small> : null}</label> : null}
          <label className={styles.fullField}><span>Основание</span><textarea maxLength={500} minLength={3} onChange={(event) => setReason(event.target.value)} placeholder="Почему создаётся или изменяется отделение" required rows={3} value={reason} /></label>
        </div>
        <footer><button className={styles.secondaryButton} disabled={busy} onClick={onClose} type="button">Отмена</button><button className={styles.primaryButton} disabled={busy} type="submit">{busy ? <LoaderCircle className={styles.spin} size={17} /> : <Check size={17} />}{busy ? 'Сохраняем…' : 'Сохранить версию'}</button></footer>
      </form>
    </div>
  );
}

function AssignmentDialog({
  assignment,
  busy,
  department,
  error,
  initialEffectiveFrom,
  memberships,
  mode,
  onClose,
  onSubmit,
}: {
  assignment: ManagedAccessAssignment | null;
  busy: boolean;
  department: ManagedDepartment;
  error: { message: string; requestId?: string } | null;
  initialEffectiveFrom: number;
  memberships: Workspace['memberships'];
  mode: 'grant' | 'edit' | 'revoke';
  onClose: () => void;
  onSubmit: (payload: Record<string, unknown>) => void;
}) {
  const defaultRole = memberships[0]?.legacyRole === 'nurse'
    ? 'nurse'
    : memberships[0]?.legacyRole === 'registrar'
      ? 'registrar'
      : 'doctor';
  const [membershipId, setMembershipId] = useState(assignment?.membershipId ?? memberships[0]?.id ?? '');
  const [roles, setRoles] = useState<OrganizationRole[]>(assignment?.roles ?? [defaultRole]);
  const initialOverrides = useMemo(() => Object.fromEntries(clinicPermissions.map((permission) => [permission, assignment?.allowPermissions.includes(permission) ? 'allow' : assignment?.denyPermissions.includes(permission) ? 'deny' : 'inherit'])) as Record<ClinicPermission, 'inherit' | 'allow' | 'deny'>, [assignment]);
  const [overrides, setOverrides] = useState(initialOverrides);
  const [effectiveFrom, setEffectiveFrom] = useState(
    toDateTimeLocal(initialEffectiveFrom),
  );
  const [effectiveUntil, setEffectiveUntil] = useState(assignment?.effectiveUntil ? toDateTimeLocal(assignment.effectiveUntil) : '');
  const [reason, setReason] = useState('');
  const title = mode === 'grant' ? 'Выдать доступ' : mode === 'revoke' ? 'Отозвать доступ' : assignment?.status === 'revoked' ? 'Возобновить доступ' : 'Изменить доступ';
  function submit(event: React.FormEvent) {
    event.preventDefault();
    const allowPermissions = clinicPermissions.filter((permission) => overrides[permission] === 'allow');
    const denyPermissions = clinicPermissions.filter((permission) => overrides[permission] === 'deny');
    onSubmit({
      membershipId,
      roles,
      allowPermissions,
      denyPermissions,
      effectiveFrom: toTimestamp(effectiveFrom),
      effectiveUntil: effectiveUntil ? toTimestamp(effectiveUntil) : null,
      status: mode === 'revoke' ? 'revoked' : 'active',
      changeReason: reason,
    });
  }
  return (
    <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <form aria-labelledby="assignment-dialog-title" aria-modal="true" className={`${styles.dialog} ${styles.dialogWide}`} onSubmit={submit} role="dialog">
        <header><div><span className={styles.eyebrow}>{department.name}</span><h2 id="assignment-dialog-title">{title}</h2></div><button aria-label="Закрыть" disabled={busy} onClick={onClose} type="button"><X size={19} /></button></header>
        {error ? <ErrorMessage error={error} /> : null}
        {mode === 'revoke' ? <div className={styles.revokeNotice}><CircleAlert size={20} /><div><strong>Сотрудник сразу потеряет эти полномочия</strong><p>История и предыдущие версии останутся в D1. Само назначение не удаляется.</p></div></div> : (
          <div className={styles.formGrid}>
            <label className={styles.fullField}><span>Сотрудник</span><select disabled={mode !== 'grant'} onChange={(event) => setMembershipId(event.target.value)} required value={membershipId}>{memberships.map((membership) => <option key={membership.id} value={membership.id}>{membership.displayName} · {membership.legacyRole}</option>)}</select></label>
            <fieldset className={styles.fullField}><legend>Роли организации</legend><div className={styles.roleGrid}>{organizationRoles.map((role) => <label key={role}><input checked={roles.includes(role)} onChange={(event) => setRoles((current) => event.target.checked ? [...current, role] : current.filter((item) => item !== role))} type="checkbox" /><span>{roleLabels[role]}</span></label>)}</div></fieldset>
            <label><span>Действует с</span><input onChange={(event) => setEffectiveFrom(event.target.value)} required type="datetime-local" value={effectiveFrom} /></label>
            <label><span>Действует до</span><input min={effectiveFrom} onChange={(event) => setEffectiveUntil(event.target.value)} type="datetime-local" value={effectiveUntil} /></label>
            <fieldset className={`${styles.fullField} ${styles.permissionOverrides}`}><legend>Исключения из роли</legend><p>Оставьте «По роли», если точечное исключение не требуется. Явный запрет всегда сильнее разрешения.</p><div>{clinicPermissions.map((permission) => <label key={permission}><span><strong>{permissionLabels[permission]}</strong><small>{permission}</small></span><select aria-label={`Правило: ${permissionLabels[permission]}`} onChange={(event) => setOverrides((current) => ({ ...current, [permission]: event.target.value as 'inherit' | 'allow' | 'deny' }))} value={overrides[permission]}><option value="inherit">По роли</option><option value="allow">Разрешить</option><option value="deny">Запретить</option></select></label>)}</div></fieldset>
          </div>
        )}
        <div className={styles.reasonBlock}><label><span>{mode === 'revoke' ? 'Основание отзыва' : 'Основание изменения'}</span><textarea maxLength={500} minLength={3} onChange={(event) => setReason(event.target.value)} required rows={3} value={reason} /></label></div>
        <footer><button className={styles.secondaryButton} disabled={busy} onClick={onClose} type="button">Отмена</button><button className={mode === 'revoke' ? styles.dangerButton : styles.primaryButton} disabled={busy || roles.length === 0 || !membershipId} type="submit">{busy ? <LoaderCircle className={styles.spin} size={17} /> : mode === 'revoke' ? <UserX size={17} /> : <Check size={17} />}{busy ? 'Сохраняем…' : title}</button></footer>
      </form>
    </div>
  );
}

export function AccessAdministrationSelection({ assignments }: { assignments: readonly AccessAssignmentSummary[] }) {
  return <main className={styles.main}><header className={styles.pageHeader}><div><span className={styles.eyebrow}>Без объединения полномочий</span><h1>Выберите контур администратора</h1><p>Изменения будут ограничены одним филиалом и одним текущим назначением.</p></div></header><section className={styles.selectionGrid}>{assignments.map((assignment) => <Link href={`/access/manage?assignmentId=${encodeURIComponent(assignment.assignmentId)}`} key={assignment.assignmentId}><Building2 size={21} /><span><strong>{assignment.department.name}</strong><small>{assignment.organization.name} · {assignment.facility.name}</small></span><b>Открыть</b></Link>)}</section></main>;
}

export function AccessAdministrationState({ title, text }: { title: string; text: string }) {
  return <main className={styles.main}><section className={styles.state}><KeyRound size={30} /><span className={styles.eyebrow}>Доступ закрыт безопасно</span><h1>{title}</h1><p>{text}</p><Link href="/access">Проверить мои права</Link></section></main>;
}
