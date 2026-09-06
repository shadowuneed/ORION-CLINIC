'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowRight,
  Camera,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  UserRound,
  X,
} from 'lucide-react';
import type { PatientSummary } from '@/lib/repositories/patient-registry';
import { appendPatientPhotoVersion } from '@/lib/domain/patient-photo';
import styles from './patients.module.css';

type DirectoryResponse = {
  viewer?: { id: string; displayName: string; role: string };
  organization?: { id: string; name: string };
  facility?: { id: string; name: string };
  accessAssignment?: { assignmentId: string };
  assignments?: AssignmentOption[];
  patients?: PatientSummary[];
  error?: {
    code: string;
    message: string;
    requestId: string;
    details?: { assignments?: AssignmentOption[] };
  };
};

type AssignmentOption = {
  assignmentId: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentId: string;
  departmentName: string;
  roles: string[];
};

type LoadState =
  | 'loading'
  | 'ready'
  | 'assignment'
  | 'unauthenticated'
  | 'forbidden'
  | 'error';

type PatientListStatus = 'active' | 'inactive' | 'all';

const statusLabels: Record<string, string> = {
  active: 'Активен',
  inactive: 'Архив',
  merged: 'Объединён',
  draft: 'Черновик',
  ready: 'Готов к началу',
  in_progress: 'Приём идёт',
  review: 'Проверка',
  finalized: 'Завершён',
  amended: 'Исправлен',
  cancelled: 'Отменён',
};

function formatDate(value: string | null) {
  if (!value) return 'не указана';
  return new Intl.DateTimeFormat('ru-RU').format(new Date(`${value}T00:00:00`));
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join('')
    .toUpperCase();
}

export function PatientDirectory() {
  const router = useRouter();
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<DirectoryResponse>({});
  const [query, setQuery] = useState('');
  const [appliedQuery, setAppliedQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<PatientListStatus>('active');
  const [createOpen, setCreateOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [assignmentOptions, setAssignmentOptions] = useState<AssignmentOption[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [selectedAssignmentId, setSelectedAssignmentId] = useState('');
  const selectedFacilityRef = useRef('');
  const selectedAssignmentRef = useRef('');
  const statusFilterRef = useRef<PatientListStatus>('active');
  const createKey = useRef<string | null>(null);

  const load = useCallback(async (
    search = '',
    facilityId = selectedFacilityRef.current,
    assignmentId = selectedAssignmentRef.current,
    status = statusFilterRef.current,
  ) => {
    setState('loading');
    try {
      const params = new URLSearchParams({ status, limit: '100' });
      if (search.trim()) params.set('query', search.trim());
      if (facilityId) params.set('facilityId', facilityId);
      if (assignmentId) params.set('accessAssignmentId', assignmentId);
      const response = await fetch(`/api/patients?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = (await response.json()) as DirectoryResponse;
      setData(payload);
      if (response.status === 401) setState('unauthenticated');
      else if (
        response.status === 409 &&
        payload.error?.code === 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED'
      ) {
        setAssignmentOptions(payload.error.details?.assignments ?? []);
        setState('assignment');
      }
      else if (response.status === 403) setState('forbidden');
      else if (!response.ok || !payload.patients) setState('error');
      else {
        const resolvedFacilityId = payload.facility?.id ?? facilityId;
        const resolvedAssignmentId =
          payload.accessAssignment?.assignmentId ?? assignmentId;
        setAssignmentOptions(payload.assignments ?? []);
        selectedFacilityRef.current = resolvedFacilityId;
        selectedAssignmentRef.current = resolvedAssignmentId;
        setSelectedFacilityId(resolvedFacilityId);
        setSelectedAssignmentId(resolvedAssignmentId);
        setState('ready');
      }
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const facilityId = params.get('facilityId') ?? '';
    const assignmentId = params.get('accessAssignmentId') ?? '';
    const requestedStatus = params.get('status');
    const status: PatientListStatus =
      requestedStatus === 'inactive' || requestedStatus === 'all'
        ? requestedStatus
        : 'active';
    selectedFacilityRef.current = facilityId;
    selectedAssignmentRef.current = assignmentId;
    statusFilterRef.current = status;
    const timer = window.setTimeout(() => {
      setSelectedFacilityId(facilityId);
      setSelectedAssignmentId(assignmentId);
      setStatusFilter(status);
      void load('', facilityId, assignmentId, status);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function selectAssignment(assignment: AssignmentOption) {
    selectedFacilityRef.current = assignment.facilityId;
    selectedAssignmentRef.current = assignment.assignmentId;
    setSelectedFacilityId(assignment.facilityId);
    setSelectedAssignmentId(assignment.assignmentId);
    const url = new URL(window.location.href);
    url.searchParams.set('facilityId', assignment.facilityId);
    url.searchParams.set('accessAssignmentId', assignment.assignmentId);
    window.history.replaceState(null, '', url);
    void load(
      appliedQuery,
      assignment.facilityId,
      assignment.assignmentId,
      statusFilterRef.current,
    );
  }

  function selectStatus(status: PatientListStatus) {
    statusFilterRef.current = status;
    setStatusFilter(status);
    const url = new URL(window.location.href);
    if (status === 'active') url.searchParams.delete('status');
    else url.searchParams.set('status', status);
    window.history.replaceState(null, '', url);
    void load(
      appliedQuery,
      selectedFacilityRef.current,
      selectedAssignmentRef.current,
      status,
    );
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = query.trim();
    setAppliedQuery(next);
    void load(next);
  }

  async function createPatient(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const idempotencyKey = createKey.current ?? crypto.randomUUID();
    createKey.current = idempotencyKey;
    setSaving(true);
    setFormError(null);
    try {
      const response = await fetch('/api/patients', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          displayName: String(form.get('displayName') ?? ''),
          birthDate: String(form.get('birthDate') ?? '') || null,
          sexAtBirth: String(form.get('sexAtBirth') ?? 'not_recorded'),
          testIin: String(form.get('testIin') ?? '') || null,
          phone: String(form.get('phone') ?? '') || null,
          email: String(form.get('email') ?? '') || null,
          address: String(form.get('address') ?? '') || null,
          facilityId: selectedFacilityRef.current || undefined,
          accessAssignmentId: selectedAssignmentRef.current || undefined,
          testDataAcknowledged: form.get('testDataAcknowledged') === 'on',
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        patient?: PatientSummary;
        error?: { message: string };
      };
      if (!response.ok || !payload.patient) {
        if (response.status < 500) createKey.current = null;
        setFormError(payload.error?.message ?? 'Не удалось сохранить пациента.');
        return;
      }

      if (photo) {
        const facilityQuery = selectedFacilityRef.current
          ? `?facilityId=${encodeURIComponent(selectedFacilityRef.current)}&accessAssignmentId=${encodeURIComponent(selectedAssignmentRef.current)}`
          : '';
        const photoResponse = await fetch(`/api/patients/${encodeURIComponent(payload.patient.id)}/photo${facilityQuery}`, {
          method: 'PUT',
          credentials: 'same-origin',
          headers: { 'Content-Type': photo.type },
          body: photo,
        });
        if (!photoResponse.ok) {
          setFormError('Карточка создана, но фотография не сохранилась. Её можно добавить повторно из карточки.');
          createKey.current = null;
          await load(appliedQuery);
          return;
        }
      }

      createKey.current = null;
      const facilityQuery = selectedFacilityRef.current
          ? `?facilityId=${encodeURIComponent(selectedFacilityRef.current)}&accessAssignmentId=${encodeURIComponent(selectedAssignmentRef.current)}`
        : '';
      router.push(`/patients/${encodeURIComponent(payload.patient.id)}${facilityQuery}`);
    } catch {
      setFormError('Сервер не ответил. Обновите список перед повтором.');
    } finally {
      setSaving(false);
    }
  }

  const patients = data.patients ?? [];

  return (
    <main className={styles.main}>
      <section className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Реестр клиники</span>
          <h1>Пациенты</h1>
          <p>Карточки, идентификаторы и история приёмов хранятся в D1. Фотографии — в R2.</p>
        </div>
        <button className={styles.primaryButton} onClick={() => setCreateOpen(true)} type="button">
          <Plus aria-hidden="true" size={19} />
          Добавить пациента
        </button>
      </section>

      <section className={styles.toolbar}>
        <form className={styles.searchForm} onSubmit={submitSearch}>
          <Search aria-hidden="true" size={19} />
          <input
            aria-label="Поиск пациентов"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="ФИО, номер карты, тестовый ИИН или телефон"
            value={query}
          />
          <button type="submit">Найти</button>
        </form>
        <div aria-label="Статус карточки" className={styles.statusFilter} role="group">
          {([
            ['active', 'Активные'],
            ['inactive', 'Архив'],
            ['all', 'Все'],
          ] as const).map(([value, label]) => (
            <button
              aria-pressed={statusFilter === value}
              className={statusFilter === value ? styles.statusFilterActive : undefined}
              key={value}
              onClick={() => selectStatus(value)}
              type="button"
            >
              {label}
            </button>
          ))}
        </div>
        {assignmentOptions.length > 1 && (
          <label className={styles.facilitySelect}>
            <span>Рабочий контур</span>
            <select
              aria-label="Рабочий контур реестра"
              onChange={(event) => {
                const assignment = assignmentOptions.find(
                  (candidate) => candidate.assignmentId === event.target.value,
                );
                if (assignment) selectAssignment(assignment);
              }}
              value={selectedAssignmentId}
            >
              {assignmentOptions.map((assignment) => (
                <option key={assignment.assignmentId} value={assignment.assignmentId}>
                  {assignment.facilityName} · {assignment.departmentName}
                </option>
              ))}
            </select>
          </label>
        )}
        <div className={styles.storageStatus}>
          <ShieldCheck aria-hidden="true" size={17} />
          <span>{state === 'ready' ? `${patients.length} в текущей выборке` : 'Проверка базы'}</span>
        </div>
      </section>

      {state === 'loading' && (
        <div className={styles.statePanel} role="status">
          <RefreshCw className={styles.spin} aria-hidden="true" size={28} />
          <h2>Загружаем реестр</h2>
          <p>Читаем актуальные записи из D1.</p>
        </div>
      )}

      {state === 'unauthenticated' && (
        <div className={styles.statePanel}>
          <AlertCircle aria-hidden="true" size={30} />
          <h2>Нужен вход</h2>
          <p>Откройте платформу через авторизованный контур ORION Clinic.</p>
          <a className={styles.primaryButton} href="/signin-with-chatgpt?return_to=%2Fpatients" target="_top">Войти</a>
        </div>
      )}

      {state === 'assignment' && (
        <div className={styles.statePanel}>
          <ShieldCheck aria-hidden="true" size={30} />
          <h2>Выберите рабочий контур</h2>
          <p>Права разных отделений не объединяются автоматически.</p>
          <div className={styles.facilityChoices}>
            {assignmentOptions.map((assignment) => (
              <button
                className={styles.secondaryButton}
                key={assignment.assignmentId}
                onClick={() => selectAssignment(assignment)}
                type="button"
              >
                {assignment.organizationName} · {assignment.facilityName} ·{' '}
                {assignment.departmentName}
              </button>
            ))}
          </div>
        </div>
      )}

      {(state === 'forbidden' || state === 'error') && (
        <div className={styles.statePanel}>
          <AlertCircle aria-hidden="true" size={30} />
          <h2>{state === 'forbidden' ? 'Нет доступа к реестру' : 'Не удалось загрузить данные'}</h2>
          <p>{data.error?.message ?? 'Проверьте подключение и повторите.'}</p>
          <button className={styles.secondaryButton} onClick={() => void load(appliedQuery)} type="button">Повторить</button>
        </div>
      )}

      {state === 'ready' && patients.length === 0 && (
        <div className={styles.statePanel}>
          <UserRound aria-hidden="true" size={34} />
          <h2>{appliedQuery ? 'Ничего не найдено' : statusFilter === 'inactive' ? 'Архив пуст' : 'Пациентов пока нет'}</h2>
          <p>{appliedQuery ? 'Измените запрос или очистите поиск.' : statusFilter === 'inactive' ? 'Архивированные карточки появятся здесь и останутся доступными для аудита.' : 'Создайте первую карточку — она сохранится в базе и останется после перезапуска.'}</p>
          {!appliedQuery && statusFilter === 'active' && (
            <button className={styles.primaryButton} onClick={() => setCreateOpen(true)} type="button">
              <Plus aria-hidden="true" size={18} />
              Создать карточку
            </button>
          )}
        </div>
      )}

      {state === 'ready' && patients.length > 0 && (
        <section className={styles.patientTable} aria-label="Список пациентов">
          <div className={styles.tableHead}>
            <span>Пациент</span>
            <span>Идентификаторы</span>
            <span>Последний приём</span>
            <span>Всего</span>
            <span aria-hidden="true" />
          </div>
          {patients.map((patient) => (
            <article className={styles.patientRow} key={patient.id}>
              <div className={styles.patientIdentity}>
                {patient.photoUrl ? (
                  // Authenticated local endpoint; an ordinary img keeps the browser session.
                  // eslint-disable-next-line @next/next/no-img-element
                  <img alt="" className={styles.patientPhoto} src={appendPatientPhotoVersion(patient.photoUrl, patient.updatedAt)} />
                ) : (
                  <span className={styles.patientInitials}>{initials(patient.displayName)}</span>
                )}
                <span>
                  <strong>{patient.displayName}</strong>
                  {patient.status !== 'active' && (
                    <small className={styles.patientStatus}>{statusLabels[patient.status]}</small>
                  )}
                  <small>Дата рождения: {formatDate(patient.birthDate)}</small>
                  {patient.phone ? <small>{patient.phone}</small> : null}
                </span>
              </div>
              <div className={styles.identifierCell}>
                <strong>{patient.medicalRecordNumber}</strong>
                <small>{patient.testIin ? `ИИН: ${patient.testIin}` : 'ИИН не указан'}</small>
              </div>
              <div className={styles.encounterCell}>
                {patient.latestEncounter ? (
                  <>
                    <span className={styles.statusTag}>{statusLabels[patient.latestEncounter.status]}</span>
                    <strong>{patient.latestEncounter.reasonForVisit ?? 'Причина не указана'}</strong>
                    <small>{formatTimestamp(patient.latestEncounter.updatedAt)}</small>
                  </>
                ) : (
                  <span className={styles.muted}>Приёмов ещё нет</span>
                )}
              </div>
              <div className={styles.countCell}>{patient.encounterCount}</div>
              <Link
                aria-label={`Открыть карточку ${patient.displayName}`}
                className={styles.rowLink}
                href={`/patients/${encodeURIComponent(patient.id)}${selectedFacilityId ? `?facilityId=${encodeURIComponent(selectedFacilityId)}&accessAssignmentId=${encodeURIComponent(selectedAssignmentId)}` : ''}`}
              >
                <ArrowRight aria-hidden="true" size={20} />
              </Link>
            </article>
          ))}
        </section>
      )}

      {createOpen && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setCreateOpen(false);
        }}>
          <section aria-labelledby="create-patient-title" aria-modal="true" className={styles.modal} role="dialog">
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.eyebrow}>Новая запись в D1</span>
                <h2 id="create-patient-title">Карточка пациента</h2>
              </div>
              <button aria-label="Закрыть" className={styles.closeButton} disabled={saving} onClick={() => setCreateOpen(false)} type="button">
                <X aria-hidden="true" size={22} />
              </button>
            </header>
            <form className={styles.patientForm} onSubmit={createPatient}>
              <label className={styles.fieldWide}>
                <span>ФИО *</span>
                <input name="displayName" placeholder="Например, Айдос Касымов" required minLength={2} maxLength={160} />
              </label>
              <label>
                <span>Тестовый ИИН</span>
                <input inputMode="numeric" name="testIin" pattern="[0-9]{12}" placeholder="12 цифр" maxLength={12} />
              </label>
              <label>
                <span>Дата рождения</span>
                <input name="birthDate" type="date" max={new Date().toISOString().slice(0, 10)} />
              </label>
              <label>
                <span>Пол</span>
                <select defaultValue="not_recorded" name="sexAtBirth">
                  <option value="not_recorded">Не записан</option>
                  <option value="female">Женский</option>
                  <option value="male">Мужской</option>
                  <option value="unknown">Не определён</option>
                </select>
              </label>
              <label>
                <span>Телефон</span>
                <input name="phone" placeholder="+7 700 000 00 00" />
              </label>
              <label>
                <span>Email</span>
                <input name="email" type="email" placeholder="patient@example.test" />
              </label>
              <label className={styles.fieldWide}>
                <span>Адрес</span>
                <input name="address" placeholder="Город, улица, дом" />
              </label>
              <label className={`${styles.photoPicker} ${styles.fieldWide}`}>
                <Camera aria-hidden="true" size={22} />
                <span>
                  <strong>{photo ? photo.name : 'Добавить фотографию'}</strong>
                  <small>JPEG, PNG или WebP · до 4 МБ · файл хранится в R2</small>
                </span>
                <input accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhoto(event.target.files?.[0] ?? null)} type="file" />
              </label>
              <label className={`${styles.confirmation} ${styles.fieldWide}`}>
                <input name="testDataAcknowledged" required type="checkbox" />
                <span>Подтверждаю, что для локальной разработки использую только вымышленные данные.</span>
              </label>
              {formError && <div className={`${styles.formError} ${styles.fieldWide}`}>{formError}</div>}
              <div className={`${styles.formActions} ${styles.fieldWide}`}>
                <button className={styles.secondaryButton} disabled={saving} onClick={() => setCreateOpen(false)} type="button">Отмена</button>
                <button className={styles.primaryButton} disabled={saving} type="submit">
                  {saving ? 'Сохраняем…' : 'Создать карточку'}
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
