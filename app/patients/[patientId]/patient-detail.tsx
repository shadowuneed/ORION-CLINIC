'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  ArrowLeft,
  ArrowUpRight,
  Archive,
  CalendarPlus,
  Camera,
  CircleAlert,
  FileText,
  History,
  IdCard,
  Mail,
  MapPin,
  Pencil,
  Phone,
  RefreshCw,
  Stethoscope,
  UserRound,
  X,
} from 'lucide-react';
import type { EncounterSummary, PatientDetail } from '@/lib/repositories/patient-registry';
import { appendPatientPhotoVersion } from '@/lib/domain/patient-photo';
import styles from '../patients.module.css';

type DetailResponse = {
  viewer?: { id: string; displayName: string; role: string };
  facility?: { id: string; name: string };
  accessAssignment?: { assignmentId: string };
  patient?: PatientDetail;
  permissions?: {
    canUpdate: boolean;
    canArchive: boolean;
    canCreateEncounter: boolean;
  };
  error?: {
    code?: string;
    message: string;
    requestId?: string;
    details?: { currentVersion?: number; currentStatus?: string };
  };
};

const encounterStatus: Record<EncounterSummary['status'], string> = {
  draft: 'Черновик',
  ready: 'Готов к началу',
  in_progress: 'Приём идёт',
  review: 'Проверка',
  finalized: 'Завершён',
  amended: 'Исправлен',
  cancelled: 'Отменён',
};

function formatDate(value: string | null) {
  if (!value) return 'Не указана';
  return new Intl.DateTimeFormat('ru-RU', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  }).format(new Date(`${value}T00:00:00`));
}

function formatTimestamp(value: number) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'long',
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

export function PatientDetailView({
  patientId,
  facilityId,
  accessAssignmentId,
}: {
  patientId: string;
  facilityId?: string;
  accessAssignmentId?: string;
}) {
  const router = useRouter();
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [data, setData] = useState<DetailResponse>({});
  const [encounterOpen, setEncounterOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<DetailResponse['error']>();
  const [message, setMessage] = useState<string | null>(null);
  const [photoSaving, setPhotoSaving] = useState(false);
  const encounterKey = useRef<string | null>(null);
  const updateKey = useRef<string | null>(null);
  const archiveKey = useRef<string | null>(null);
  const accessParams = new URLSearchParams();
  if (facilityId) accessParams.set('facilityId', facilityId);
  if (accessAssignmentId) {
    accessParams.set('accessAssignmentId', accessAssignmentId);
  }
  const facilityQuery = accessParams.size ? `?${accessParams}` : '';

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}${facilityQuery}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = (await response.json()) as DetailResponse;
      setData(payload);
      setState(response.ok && payload.patient ? 'ready' : 'error');
    } catch {
      setState('error');
    }
  }, [facilityQuery, patientId]);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function createEncounter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (saving) return;
    const form = new FormData(event.currentTarget);
    const idempotencyKey = encounterKey.current ?? crypto.randomUUID();
    encounterKey.current = idempotencyKey;
    setSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/encounters`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          reasonForVisit: String(form.get('reasonForVisit') ?? '') || null,
          facilityId,
          accessAssignmentId,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        encounter?: EncounterSummary;
        error?: { message: string };
      };
      if (!response.ok || !payload.encounter) {
        if (response.status < 500) encounterKey.current = null;
        setMessage(payload.error?.message ?? 'Не удалось создать приём.');
        return;
      }
      encounterKey.current = null;
      router.push(`/?encounterId=${encodeURIComponent(payload.encounter.id)}`);
    } catch {
      setMessage('Сервер не ответил. Обновите карточку перед повтором.');
    } finally {
      setSaving(false);
    }
  }

  async function replacePhoto(file: File | undefined) {
    if (!file || photoSaving) return;
    setPhotoSaving(true);
    setMessage(null);
    try {
      const response = await fetch(`/api/patients/${encodeURIComponent(patientId)}/photo${facilityQuery}`, {
        method: 'PUT',
        credentials: 'same-origin',
        headers: { 'Content-Type': file.type },
        body: file,
      });
      const payload = (await response.json()) as { error?: { message: string } };
      if (!response.ok) {
        setMessage(payload.error?.message ?? 'Не удалось сохранить фотографию.');
        return;
      }
      await load();
    } catch {
      setMessage('Не удалось отправить фотографию.');
    } finally {
      setPhotoSaving(false);
    }
  }

  async function updateProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileSaving || !data.patient) return;
    const form = new FormData(event.currentTarget);
    const idempotencyKey = updateKey.current ?? crypto.randomUUID();
    updateKey.current = idempotencyKey;
    setProfileSaving(true);
    setProfileError(undefined);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/patients/${encodeURIComponent(patientId)}`,
        {
          method: 'PATCH',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facilityId,
            accessAssignmentId,
            displayName: String(form.get('displayName') ?? ''),
            birthDate: String(form.get('birthDate') ?? '') || null,
            sexAtBirth: String(form.get('sexAtBirth') ?? 'not_recorded'),
            phone: String(form.get('phone') ?? '') || null,
            email: String(form.get('email') ?? '') || null,
            address: String(form.get('address') ?? '') || null,
            changeReason: String(form.get('changeReason') ?? ''),
            testDataAcknowledged: form.get('testDataAcknowledged') === 'on',
            expectedVersion: data.patient.version,
            idempotencyKey,
          }),
        },
      );
      const payload = (await response.json()) as DetailResponse;
      if (!response.ok || !payload.patient) {
        if (response.status < 500) updateKey.current = null;
        setProfileError(payload.error ?? { message: 'Не удалось сохранить карточку.' });
        return;
      }
      updateKey.current = null;
      setData((current) => ({ ...current, patient: payload.patient }));
      setEditOpen(false);
      setMessage(`Карточка сохранена как версия ${payload.patient.version}. Предыдущая версия осталась в истории.`);
    } catch {
      setProfileError({
        message: 'Сервер не ответил. Не отправляйте новую команду до повторной проверки карточки.',
      });
    } finally {
      setProfileSaving(false);
    }
  }

  async function archiveProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (profileSaving || !data.patient) return;
    const form = new FormData(event.currentTarget);
    const idempotencyKey = archiveKey.current ?? crypto.randomUUID();
    archiveKey.current = idempotencyKey;
    setProfileSaving(true);
    setProfileError(undefined);
    setMessage(null);
    try {
      const response = await fetch(
        `/api/patients/${encodeURIComponent(patientId)}/archive`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facilityId,
            accessAssignmentId,
            changeReason: String(form.get('changeReason') ?? ''),
            testDataAcknowledged: form.get('testDataAcknowledged') === 'on',
            expectedVersion: data.patient.version,
            idempotencyKey,
          }),
        },
      );
      const payload = (await response.json()) as DetailResponse;
      if (!response.ok || !payload.patient) {
        if (response.status < 500) archiveKey.current = null;
        setProfileError(payload.error ?? { message: 'Не удалось архивировать карточку.' });
        return;
      }
      archiveKey.current = null;
      setData((current) => ({ ...current, patient: payload.patient }));
      setArchiveOpen(false);
      setMessage('Карточка перемещена в архив. Пациент, приёмы и история не удалены.');
    } catch {
      setProfileError({
        message: 'Сервер не ответил. Обновите карточку перед повторной командой.',
      });
    } finally {
      setProfileSaving(false);
    }
  }

  async function reloadAfterConflict() {
    updateKey.current = null;
    archiveKey.current = null;
    setProfileError(undefined);
    setEditOpen(false);
    setArchiveOpen(false);
    await load();
  }

  const patient = data.patient;

  return (
    <main className={styles.main}>
      <div className={styles.detailTopline}>
        <Link className={styles.backLink} href={`/patients${facilityQuery}`}>
          <ArrowLeft aria-hidden="true" size={18} />
          Все пациенты
        </Link>
        {patient && (
          <div className={styles.detailActions}>
            {patient.status === 'active' && data.permissions?.canUpdate && (
              <button
                className={styles.secondaryButton}
                onClick={() => {
                  setProfileError(undefined);
                  setEditOpen(true);
                }}
                type="button"
              >
                <Pencil aria-hidden="true" size={17} />
                Редактировать
              </button>
            )}
            {patient.status === 'active' && data.permissions?.canArchive && (
              <button
                className={styles.dangerButton}
                onClick={() => {
                  setProfileError(undefined);
                  setArchiveOpen(true);
                }}
                type="button"
              >
                <Archive aria-hidden="true" size={17} />
                Архивировать
              </button>
            )}
            {patient.status === 'active' && data.permissions?.canCreateEncounter && (
              <button className={styles.primaryButton} onClick={() => setEncounterOpen(true)} type="button">
                <CalendarPlus aria-hidden="true" size={19} />
                Новый приём
              </button>
            )}
          </div>
        )}
      </div>

      {state === 'loading' && (
        <div className={styles.statePanel} role="status">
          <RefreshCw className={styles.spin} aria-hidden="true" size={28} />
          <h2>Открываем карточку</h2>
          <p>Загружаем пациента и историю приёмов из D1.</p>
        </div>
      )}

      {state === 'error' && (
        <div className={styles.statePanel}>
          <UserRound aria-hidden="true" size={32} />
          <h2>Карточка недоступна</h2>
          <p>{data.error?.message ?? 'Запись не найдена или нет доступа.'}</p>
          <button className={styles.secondaryButton} onClick={() => void load()} type="button">Повторить</button>
        </div>
      )}

      {state === 'ready' && patient && (
        <>
          <section className={styles.patientHero}>
            <div className={styles.photoBlock}>
              {patient.photoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  alt={`Фотография ${patient.displayName}`}
                  src={appendPatientPhotoVersion(patient.photoUrl, patient.updatedAt)}
                />
              ) : (
                <span>{initials(patient.displayName)}</span>
              )}
              {patient.status === 'active' && (
                <label className={styles.photoAction}>
                  <Camera aria-hidden="true" size={16} />
                  {photoSaving ? 'Сохраняем…' : 'Фото'}
                  <input
                    accept="image/jpeg,image/png,image/webp"
                    disabled={photoSaving}
                    onChange={(event) => void replacePhoto(event.target.files?.[0])}
                    type="file"
                  />
                </label>
              )}
            </div>
            <div className={styles.heroIdentity}>
              <span className={styles.eyebrow}>Карточка пациента</span>
              <div className={styles.patientTitleLine}>
                <h1>{patient.displayName}</h1>
                {patient.status !== 'active' && (
                  <span className={styles.archiveBadge}>Архив</span>
                )}
              </div>
              <div className={styles.heroMeta}>
                <span><IdCard aria-hidden="true" size={16} /> {patient.medicalRecordNumber}</span>
                <span>{patient.testIin ? `ИИН ${patient.testIin}` : 'ИИН не указан'}</span>
                <span>{formatDate(patient.birthDate)}</span>
              </div>
            </div>
            <div className={styles.heroStats}>
              <span>
                <strong>{patient.encounterCount}</strong>
                <small>приёмов</small>
              </span>
              <span>
                <strong>v{patient.version}</strong>
                <small>версия карточки</small>
              </span>
            </div>
          </section>

          {message && <div className={styles.detailMessage}>{message}</div>}

          {patient.status !== 'active' && (
            <section className={styles.archiveBanner}>
              <Archive aria-hidden="true" size={22} />
              <div>
                <strong>Карточка находится в архиве</strong>
                <p>История и все приёмы сохранены. Редактирование, замена фото и создание новых приёмов заблокированы.</p>
              </div>
            </section>
          )}

          <div className={styles.detailGrid}>
            <section className={styles.infoPanel}>
              <header>
                <h2>Контактные данные</h2>
                <span>D1</span>
              </header>
              <dl>
                <div><dt><Phone aria-hidden="true" size={17} /> Телефон</dt><dd>{patient.phone ?? 'Не указан'}</dd></div>
                <div><dt><Mail aria-hidden="true" size={17} /> Email</dt><dd>{patient.email ?? 'Не указан'}</dd></div>
                <div><dt><MapPin aria-hidden="true" size={17} /> Адрес</dt><dd>{patient.address ?? 'Не указан'}</dd></div>
              </dl>
            </section>

            <section className={`${styles.infoPanel} ${styles.timelinePanel}`}>
              <header>
                <h2>История приёмов</h2>
                <span>{patient.encounters.length}</span>
              </header>
              {patient.encounters.length === 0 ? (
                <div className={styles.timelineEmpty}>
                  <Stethoscope aria-hidden="true" size={28} />
                  <strong>Приёмов ещё нет</strong>
                  <p>Создайте первый приём из этой карточки.</p>
                </div>
              ) : (
                <div className={styles.timeline}>
                  {patient.encounters.map((encounter) => (
                    <article key={encounter.id}>
                      <span className={styles.timelineDot} />
                      <div>
                        <span className={styles.statusTag}>{encounterStatus[encounter.status]}</span>
                        <h3>{encounter.reasonForVisit ?? 'Причина обращения не указана'}</h3>
                        <p>{formatTimestamp(encounter.updatedAt)} · версия {encounter.version}</p>
                      </div>
                      <Link className={styles.encounterOpen} href={`/?encounterId=${encodeURIComponent(encounter.id)}`}>
                        <FileText aria-hidden="true" size={17} />
                        Открыть запись
                        <ArrowUpRight aria-hidden="true" size={16} />
                      </Link>
                    </article>
                  ))}
                </div>
              )}
            </section>
          </div>

          <section className={`${styles.infoPanel} ${styles.profileHistoryPanel}`}>
            <header>
              <h2><History aria-hidden="true" size={18} /> История карточки</h2>
              <span>{patient.profileHistory.length}</span>
            </header>
            {patient.profileHistory.length === 0 ? (
              <div className={styles.profileHistoryEmpty}>
                Для этой старой тестовой записи ещё нет версионной истории.
              </div>
            ) : (
              <ol className={styles.profileHistoryList}>
                {patient.profileHistory.map((entry) => (
                  <li key={entry.id}>
                    <span className={entry.status === 'inactive' ? styles.historyArchiveDot : styles.historyDot} />
                    <div>
                      <strong>Версия {entry.version} · {entry.status === 'inactive' ? 'Архив' : 'Активная'}</strong>
                      <p>{entry.changeReason === 'initial_registration' || entry.changeReason === 'synthetic_seed_registration' ? 'Первичная регистрация карточки' : entry.changeReason}</p>
                    </div>
                    <small>{entry.actorDisplayName}<br />{formatTimestamp(entry.createdAt)}</small>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}

      {editOpen && patient && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !profileSaving) setEditOpen(false);
        }}>
          <section aria-labelledby="edit-patient-title" aria-modal="true" className={styles.modal} role="dialog">
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.eyebrow}>Новая неизменяемая версия</span>
                <h2 id="edit-patient-title">Редактировать карточку</h2>
                <p>Текущая версия: {patient.version}. ИИН остаётся без изменений.</p>
              </div>
              <button aria-label="Закрыть" className={styles.closeButton} disabled={profileSaving} onClick={() => setEditOpen(false)} type="button">
                <X aria-hidden="true" size={22} />
              </button>
            </header>
            <form className={styles.patientForm} onSubmit={updateProfile}>
              <label className={styles.fieldWide}>
                <span>ФИО *</span>
                <input autoFocus defaultValue={patient.displayName} maxLength={160} minLength={2} name="displayName" required />
              </label>
              <div className={styles.identifierReadOnly}>
                <span>ИИН</span>
                <strong>{patient.testIin ?? 'Не указан'}</strong>
                <small>Изменение идентификатора требует отдельной проверяемой операции.</small>
              </div>
              <label>
                <span>Дата рождения</span>
                <input defaultValue={patient.birthDate ?? ''} max={new Date().toISOString().slice(0, 10)} name="birthDate" type="date" />
              </label>
              <label>
                <span>Пол</span>
                <select defaultValue={patient.sexAtBirth} name="sexAtBirth">
                  <option value="not_recorded">Не записан</option>
                  <option value="female">Женский</option>
                  <option value="male">Мужской</option>
                  <option value="unknown">Не определён</option>
                </select>
              </label>
              <label>
                <span>Телефон</span>
                <input defaultValue={patient.phone ?? ''} maxLength={40} name="phone" />
              </label>
              <label>
                <span>Email</span>
                <input defaultValue={patient.email ?? ''} maxLength={160} name="email" type="email" />
              </label>
              <label className={styles.fieldWide}>
                <span>Адрес</span>
                <input defaultValue={patient.address ?? ''} maxLength={300} name="address" />
              </label>
              <label className={styles.fieldWide}>
                <span>Причина изменения *</span>
                <textarea maxLength={300} minLength={3} name="changeReason" placeholder="Например: телефон уточнён со слов пациента" required rows={3} />
              </label>
              <label className={`${styles.confirmation} ${styles.fieldWide}`}>
                <input name="testDataAcknowledged" required type="checkbox" />
                <span>
                  <strong>Подтверждаю искусственные данные</strong>
                  <small>Контур пока не одобрен для реальных данных пациентов.</small>
                </span>
              </label>
              {profileError && (
                <div className={`${styles.formError} ${styles.fieldWide}`} role="alert">
                  <CircleAlert aria-hidden="true" size={18} />
                  <div>
                    <strong>{profileError.message}</strong>
                    {profileError.requestId && <small>Код запроса: {profileError.requestId}</small>}
                    {profileError.code === 'PATIENT_VERSION_CONFLICT' && (
                      <button onClick={() => void reloadAfterConflict()} type="button">
                        Загрузить серверную версию {profileError.details?.currentVersion ? `v${profileError.details.currentVersion}` : ''}
                      </button>
                    )}
                  </div>
                </div>
              )}
              <div className={`${styles.formActions} ${styles.fieldWide}`}>
                <button className={styles.secondaryButton} disabled={profileSaving} onClick={() => setEditOpen(false)} type="button">Отмена</button>
                <button className={styles.primaryButton} disabled={profileSaving} type="submit">{profileSaving ? 'Сохраняем…' : 'Сохранить новую версию'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {archiveOpen && patient && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !profileSaving) setArchiveOpen(false);
        }}>
          <section aria-labelledby="archive-patient-title" aria-modal="true" className={`${styles.modal} ${styles.modalCompact}`} role="dialog">
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.eyebrow}>Без физического удаления</span>
                <h2 id="archive-patient-title">Архивировать карточку?</h2>
                <p>{patient.displayName} · версия {patient.version}</p>
              </div>
              <button aria-label="Закрыть" className={styles.closeButton} disabled={profileSaving} onClick={() => setArchiveOpen(false)} type="button">
                <X aria-hidden="true" size={22} />
              </button>
            </header>
            <form className={`${styles.patientForm} ${styles.archiveForm}`} onSubmit={archiveProfile}>
              <div className={`${styles.archiveExplanation} ${styles.fieldWide}`}>
                <Archive aria-hidden="true" size={22} />
                <p>Карточка исчезнет из активного списка, но пациент, история приёмов, документы и все предыдущие версии останутся в D1.</p>
              </div>
              <label className={styles.fieldWide}>
                <span>Причина архивирования *</span>
                <textarea autoFocus maxLength={300} minLength={3} name="changeReason" placeholder="Укажите проверяемую причину" required rows={4} />
              </label>
              <label className={`${styles.confirmation} ${styles.fieldWide}`}>
                <input name="testDataAcknowledged" required type="checkbox" />
                <span>Подтверждаю, что карточка содержит только искусственные данные.</span>
              </label>
              {profileError && (
                <div className={`${styles.formError} ${styles.fieldWide}`} role="alert">
                  <CircleAlert aria-hidden="true" size={18} />
                  <div>
                    <strong>{profileError.message}</strong>
                    {profileError.requestId && <small>Код запроса: {profileError.requestId}</small>}
                    {profileError.code === 'PATIENT_VERSION_CONFLICT' && (
                      <button onClick={() => void reloadAfterConflict()} type="button">Обновить карточку</button>
                    )}
                  </div>
                </div>
              )}
              <div className={`${styles.formActions} ${styles.fieldWide}`}>
                <button className={styles.secondaryButton} disabled={profileSaving} onClick={() => setArchiveOpen(false)} type="button">Отмена</button>
                <button className={styles.dangerButton} disabled={profileSaving} type="submit">{profileSaving ? 'Архивируем…' : 'Переместить в архив'}</button>
              </div>
            </form>
          </section>
        </div>
      )}

      {encounterOpen && patient && (
        <div className={styles.modalBackdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !saving) setEncounterOpen(false);
        }}>
          <section aria-labelledby="create-encounter-title" aria-modal="true" className={`${styles.modal} ${styles.modalCompact}`} role="dialog">
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.eyebrow}>Новая запись в D1</span>
                <h2 id="create-encounter-title">Новый приём</h2>
                <p>{patient.displayName}</p>
              </div>
              <button aria-label="Закрыть" className={styles.closeButton} disabled={saving} onClick={() => setEncounterOpen(false)} type="button">
                <X aria-hidden="true" size={22} />
              </button>
            </header>
            <form className={styles.encounterForm} onSubmit={createEncounter}>
              <label>
                <span>Причина обращения</span>
                <textarea autoFocus maxLength={500} minLength={2} name="reasonForVisit" placeholder="Опишите цель приёма" required rows={5} />
              </label>
              <div className={styles.encounterNotice}>
                Будет создан отдельный приём в статусе «Черновик» и восемь пустых клинических разделов. Ничего не заполняется автоматически.
              </div>
              {message && <div className={styles.formError}>{message}</div>}
              <div className={styles.formActions}>
                <button className={styles.secondaryButton} disabled={saving} onClick={() => setEncounterOpen(false)} type="button">Отмена</button>
                <button className={styles.primaryButton} disabled={saving} type="submit">{saving ? 'Создаём…' : 'Создать и открыть'}</button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}
