import Link from 'next/link';
import {
  Building2,
  Check,
  CircleMinus,
  Database,
  GitBranch,
  LockKeyhole,
  ShieldCheck,
  UserRoundCog,
  UsersRound,
} from 'lucide-react';
import type { AccessAssignmentSummary } from '@/lib/auth/access-governance';
import { clinicPermissions, type ClinicPermission, type OrganizationRole } from '@/lib/domain/access-governance';
import styles from './access-workspace.module.css';

const roleLabels: Record<OrganizationRole, string> = {
  doctor: 'Врач',
  nurse: 'Медсестра',
  registrar: 'Регистратор',
  administrator: 'Администратор',
  medical_lead: 'Медицинский руководитель',
  auditor: 'Аудитор',
  service: 'Сервисная роль',
};

const roleResponsibilities: Record<OrganizationRole, string> = {
  doctor: 'Ведёт приём, проверяет протокол и принимает клинические решения. Доступность каждого действия определяется разрешениями ниже.',
  nurse: 'Фиксирует измерения и ответы пациента, выполняет задачи наблюдения и сообщает врачу об отклонениях. Не заменяет врача при постановке диагноза и выборе лечения.',
  registrar: 'Работает с карточками пациентов, записью и очередью в пределах своего назначения. Не принимает клинические решения.',
  administrator: 'Управляет рабочими назначениями сотрудников при наличии соответствующего разрешения. Эта роль сама по себе не даёт права вести приём или подписывать протокол.',
  medical_lead: 'Проверяет клинические правила и качество работы в рамках выданных разрешений. Полномочия врача не добавляются автоматически.',
  auditor: 'Проверяет доступные записи аудита. Роль аудитора не означает право менять клинические записи.',
  service: 'Предназначена для серверных интеграций, а не интерактивной работы сотрудника.',
};

const permissionLabels: Record<ClinicPermission, string> = {
  'clinic.dashboard.read': 'Рабочий день',
  'patient.directory.read': 'Реестр пациентов',
  'patient.profile.write': 'Изменение карточек пациентов',
  'encounter.read': 'Просмотр приёмов',
  'encounter.manage': 'Ведение приёма и протокола',
  'orders.manage': 'Направления и результаты',
  'scheduling.manage': 'Запись и электронная очередь',
  'care.manage': 'План наблюдения',
  'observations.manage': 'Измерения пациента',
  'communications.manage': 'Сообщения и напоминания',
  'access.self.read': 'Просмотр собственного доступа',
  'access.manage': 'Управление назначениями доступа',
  'audit.read': 'Чтение журнала аудита',
  'clinical_policy.review': 'Проверка клинических правил',
  'service.integration.execute': 'Системные интеграции',
};

function formatDate(value: number | null) {
  if (value === null) return 'Без ограничения';
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'Asia/Almaty',
  }).format(new Date(value));
}

export function AccessWorkspace({
  assignments,
  selected,
  cloudMode = false,
}: {
  assignments: readonly AccessAssignmentSummary[];
  selected: AccessAssignmentSummary | null;
  cloudMode?: boolean;
}) {
  if (!selected) {
    return (
      <main className={styles.main}>
        <header className={styles.pageHeader}>
          <div>
            <span className={styles.eyebrow}>Без объединения полномочий</span>
            <h1>Выберите рабочий контур</h1>
            <p>ORION не смешивает роли разных филиалов и подразделений. Выберите, где вы работаете сейчас.</p>
          </div>
        </header>
        <section className={styles.selectionGrid} aria-label="Доступные рабочие контуры">
          {assignments.map((assignment) => (
            <Link
              className={styles.scopeChoice}
              href={`/access?assignmentId=${encodeURIComponent(assignment.assignmentId)}`}
              key={assignment.assignmentId}
            >
              <Building2 aria-hidden="true" size={22} />
              <span>
                <strong>{assignment.department.name}</strong>
                <small>{assignment.organization.name} · {assignment.facility.name}</small>
                <em>{assignment.roles.map((role) => roleLabels[role]).join(', ')}</em>
              </span>
              <span aria-hidden="true">→</span>
            </Link>
          ))}
        </section>
      </main>
    );
  }

  const granted = new Set(selected.effectivePermissions);
  const hasClinicalDataAccess = [
    'patient.directory.read',
    'encounter.read',
    'encounter.manage',
  ].some((permission) => granted.has(permission as ClinicPermission));

  return (
    <main className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Права текущего пользователя</span>
          <h1>Мой доступ</h1>
          <p>Полномочия рассчитаны сервером из текущей версии назначения в {cloudMode ? 'Supabase' : 'D1'}. Права разных контуров не складываются.</p>
        </div>
        <div className={styles.headerActions}>
          {!cloudMode && granted.has('access.manage') ? (
            <Link
              className={styles.manageLink}
              href={`/access/manage?assignmentId=${encodeURIComponent(selected.assignmentId)}`}
            >
              <UserRoundCog aria-hidden="true" size={18} />
              Управление доступом
            </Link>
          ) : null}
          <span className={styles.d1Badge}>
            <Database aria-hidden="true" size={18} />
            <span><strong>{cloudMode ? 'Supabase · PostgreSQL · текущая версия' : 'D1 · текущая версия'}</strong><small>Не данные браузера</small></span>
          </span>
        </div>
      </header>

      {assignments.length > 1 ? (
        <nav className={styles.scopeSwitch} aria-label="Сменить рабочий контур">
          {assignments.map((assignment) => (
            <Link
              aria-current={assignment.assignmentId === selected.assignmentId ? 'page' : undefined}
              className={assignment.assignmentId === selected.assignmentId ? styles.scopeActive : ''}
              href={`/access?assignmentId=${encodeURIComponent(assignment.assignmentId)}`}
              key={assignment.assignmentId}
            >
              {assignment.department.name}
            </Link>
          ))}
        </nav>
      ) : null}

      <section className={styles.summaryGrid} aria-label="Текущий рабочий контур">
        <article>
          <Building2 aria-hidden="true" size={20} />
          <span><small>Организация</small><strong>{selected.organization.name}</strong></span>
        </article>
        <article>
          <GitBranch aria-hidden="true" size={20} />
          <span><small>Филиал</small><strong>{selected.facility.name}</strong></span>
        </article>
        <article>
          <UsersRound aria-hidden="true" size={20} />
          <span><small>Подразделение</small><strong>{selected.department.name}</strong><em>{selected.department.code}</em></span>
        </article>
      </section>

      <section className={styles.boundary}>
        <ShieldCheck aria-hidden="true" size={22} />
        <div>
          <strong>{hasClinicalDataAccess ? 'Клинические данные доступны в назначенном контуре' : 'Клинические данные не входят в это назначение'}</strong>
          <p>Даже разрешённое действие дополнительно ограничивается филиалом, отношением к пациенту, целью доступа, статусом записи и действующим согласием.</p>
          {cloudMode && <p>Разрешения назначены; не все разделы ещё перенесены в облако. Наличие разрешения не означает, что соответствующий раздел уже работает.</p>}
        </div>
      </section>

      <div className={styles.workspace}>
        <section className={styles.rolesPanel}>
          <div className={styles.sectionTitle}>
            <span><LockKeyhole aria-hidden="true" size={19} /></span>
            <div><small>Назначение</small><h2>Роль и срок действия</h2></div>
          </div>
          <div className={styles.roles}>
            {selected.roles.map((role) => <span key={role}>{roleLabels[role]}</span>)}
          </div>
          <section aria-label="Обязанности выбранной роли">
            {selected.roles.length > 1 ? (
              <p><strong>В этом назначении совмещены роли.</strong> Поэтому доступны обязанности нескольких ролей. Это не отдельные аккаунты; при проверке работы медсестры или администратора используйте отдельное назначение с нужными правами.</p>
            ) : null}
            {selected.roles.map((role) => (
              <p key={role}><strong>{roleLabels[role]}.</strong> {roleResponsibilities[role]}</p>
            ))}
            <p>Описание роли — не выдача прав. Проверяйте список разрешений этого назначения; запрет или отсутствие разрешения ограничивает действие.</p>
          </section>
          <dl className={styles.metadata}>
            <div><dt>Статус</dt><dd>Активно</dd></div>
            <div><dt>Начало</dt><dd>{formatDate(selected.effectiveFrom)}</dd></div>
            <div><dt>Окончание</dt><dd>{formatDate(selected.effectiveUntil)}</dd></div>
            <div><dt>Источник</dt><dd>{selected.source === 'bootstrap' ? (cloudMode ? 'Начальное назначение ORION Cloud' : 'Локальная начальная настройка') : 'Администратор организации'}</dd></div>
            <div><dt>Версия</dt><dd>{selected.assignmentVersion}</dd></div>
          </dl>
        </section>

        <section className={styles.permissionsPanel}>
          <div className={styles.sectionTitle}>
            <span><ShieldCheck aria-hidden="true" size={19} /></span>
            <div><small>Вычислено сервером</small><h2>Разрешения этого контура</h2></div>
          </div>
          <div className={styles.permissionList}>
            {clinicPermissions.map((permission) => {
              const allowed = granted.has(permission);
              return (
                <div className={allowed ? styles.permissionGranted : styles.permissionDenied} key={permission}>
                  <span aria-hidden="true">{allowed ? <Check size={17} /> : <CircleMinus size={17} />}</span>
                  <span><strong>{permissionLabels[permission]}</strong><small>{permission}</small></span>
                  <em>{allowed ? 'Разрешено' : 'Не разрешено'}</em>
                </div>
              );
            })}
          </div>
        </section>
      </div>
    </main>
  );
}

export function AccessWorkspaceState({
  title,
  text,
}: {
  title: string;
  text: string;
}) {
  return (
    <main className={styles.main}>
      <section className={styles.statePanel}>
        <LockKeyhole aria-hidden="true" size={30} />
        <span className={styles.eyebrow}>Доступ закрыт безопасно</span>
        <h1>{title}</h1>
        <p>{text}</p>
      </section>
    </main>
  );
}
