'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleDot,
  Clock3,
  DoorOpen,
  LoaderCircle,
  MapPin,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  TicketCheck,
  UserRound,
  UsersRound,
  X,
} from 'lucide-react';
import type {
  SchedulingAppointmentRecord,
  SchedulingPreferenceSnapshot,
  SchedulingProvider,
  SchedulingQueueTicketRecord,
  SchedulingService,
  SchedulingSlotRecord,
  SchedulingSpecialty,
  SchedulingWorkspace as SchedulingWorkspaceData,
} from '@/lib/repositories/scheduling-workflow';
import type {
  SchedulingAppointmentStatus,
  SchedulingQueueStatus,
} from '@/lib/domain/scheduling';
import {
  SCHEDULING_CONFIRMATION_STATEMENT_VERSION,
  hashSchedulingConfirmationStatement,
} from '@/lib/domain/scheduling';
import styles from './scheduling.module.css';

type FacilityOption = {
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  role: 'clinician' | 'registrar';
};

type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: { facilities?: FacilityOption[] };
};

type SchedulingResponse = Partial<SchedulingWorkspaceData> & {
  viewer?: { id: string; displayName: string; role: string };
  organization?: { id: string; name: string };
  facility?: { id: string; name: string };
  facilities?: FacilityOption[];
  sourceLabel?: string;
  persistence?: 'd1';
  dataMode?: 'synthetic-only';
  error?: ApiError;
};

type LoadState =
  | 'loading'
  | 'ready'
  | 'facility'
  | 'unauthenticated'
  | 'forbidden'
  | 'error';

type QueueAction =
  | 'arrive'
  | 'call'
  | 'start_service'
  | 'complete'
  | 'mark_exception';

const appointmentLabels: Record<SchedulingAppointmentStatus, string> = {
  held: 'Время удерживается',
  confirmed: 'Запись подтверждена',
  cancelled: 'Запись отменена',
  expired: 'Резерв истёк',
  no_show: 'Пациент не пришёл',
  completed: 'Приём завершён',
};

const queueLabels: Record<SchedulingQueueStatus, string> = {
  issued: 'Талон выдан',
  arrived: 'Пациент прибыл',
  called: 'Вызван в кабинет',
  in_service: 'Идёт приём',
  completed: 'Обслуживание завершено',
  cancelled: 'Талон отменён',
  exception: 'Требуется ручная проверка',
};

const queueActionLabels: Record<QueueAction, string> = {
  arrive: 'Отметить прибытие',
  call: 'Вызвать пациента',
  start_service: 'Начать приём',
  complete: 'Завершить обслуживание',
  mark_exception: 'Передать на ручную проверку',
};

export function nextQueueAction(status: SchedulingQueueStatus): QueueAction | null {
  return {
    issued: 'arrive',
    arrived: 'call',
    called: 'start_service',
    in_service: 'complete',
    completed: null,
    cancelled: null,
    exception: null,
  }[status] as QueueAction | null;
}

export function unknownSchedulingOutcomeMessage() {
  return 'Связь прервалась. Сервер мог сохранить действие. Обновите данные; если изменение не появилось, повторите — ORION использует тот же ключ защиты от дублей.';
}

export function isExpiredSchedulingHold(
  current: Pick<SchedulingAppointmentRecord['current'], 'status' | 'holdExpiresAt'>,
  now = Date.now(),
) {
  return (
    current.status === 'held' &&
    current.holdExpiresAt !== null &&
    current.holdExpiresAt <= now
  );
}

function formatTimestamp(value: number | null) {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function formatSlot(slot: Pick<SchedulingSlotRecord, 'startsAt' | 'endsAt'>) {
  const date = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: '2-digit',
    month: 'long',
  }).format(new Date(slot.startsAt));
  const time = new Intl.DateTimeFormat('ru-RU', {
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${date}, ${time.format(new Date(slot.startsAt))}–${time.format(new Date(slot.endsAt))}`;
}

function isoDate(value: number) {
  const date = new Date(value);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function isActiveAppointment(status: SchedulingAppointmentStatus) {
  return status === 'held' || status === 'confirmed';
}

function apiErrorFrom(payload: SchedulingResponse, fallback: string): ApiError {
  return payload.error ?? { code: 'UNKNOWN_ERROR', message: fallback };
}

export function SchedulingWorkspace() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<SchedulingResponse>({});
  const [selectedReferralId, setSelectedReferralId] = useState('');
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [facilityOptions, setFacilityOptions] = useState<FacilityOption[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [testDataAcknowledged, setTestDataAcknowledged] = useState(false);
  const [patientConfirmed, setPatientConfirmed] = useState(false);
  const [confirmationMethod, setConfirmationMethod] = useState<
    'verbal_in_person' | 'verbal_phone' | 'digital'
  >('verbal_in_person');
  const [confirmationLanguage, setConfirmationLanguage] = useState<'ru' | 'kk'>('ru');
  const [appointmentReason, setAppointmentReason] = useState('');
  const [roomLabel, setRoomLabel] = useState('Кабинет 2');
  const [queueReason, setQueueReason] = useState('Статус подтверждён сотрудником');
  const [exceptionCode, setExceptionCode] = useState('MANUAL_REVIEW');
  const [exceptionNote, setExceptionNote] = useState('Требуется ручная сверка ситуации');

  const facilityRef = useRef('');
  const selectedReferralRef = useRef('');
  const commandKeys = useRef(new Map<string, string>());

  const selectReferral = useCallback((id: string) => {
    selectedReferralRef.current = id;
    setSelectedReferralId(id);
    setPatientConfirmed(false);
    setAppointmentReason('');
    setMessage(null);
    setOperationError(null);
  }, []);

  const load = useCallback(
    async (preferredReferralId?: string, options?: { quiet?: boolean }) => {
      if (!options?.quiet) setState('loading');
      try {
        const params = new URLSearchParams({ limit: '200' });
        if (facilityRef.current) params.set('facilityId', facilityRef.current);
        const response = await fetch(`/api/scheduling?${params.toString()}`, {
          cache: 'no-store',
          credentials: 'same-origin',
        });
        const payload = (await response.json()) as SchedulingResponse;
        setData(payload);
        if (response.status === 401) {
          setState('unauthenticated');
        } else if (
          response.status === 409 &&
          payload.error?.code === 'FACILITY_SELECTION_REQUIRED'
        ) {
          setFacilityOptions(payload.error.details?.facilities ?? []);
          setState('facility');
        } else if (response.status === 403) {
          setState('forbidden');
        } else if (
          !response.ok ||
          !payload.eligibleReferrals ||
          !payload.slots ||
          !payload.preferences ||
          !payload.appointments ||
          !payload.queue ||
          !payload.capabilities
        ) {
          setState('error');
        } else {
          const resolvedFacility = payload.facility?.id ?? facilityRef.current;
          facilityRef.current = resolvedFacility;
          setSelectedFacilityId(resolvedFacility);
          setFacilityOptions(payload.facilities ?? []);
          const candidate = preferredReferralId ?? selectedReferralRef.current;
          const nextReferral = payload.eligibleReferrals.some(
            (referral) => referral.serviceRequestId === candidate,
          )
            ? candidate
            : payload.eligibleReferrals[0]?.serviceRequestId ?? '';
          selectedReferralRef.current = nextReferral;
          setSelectedReferralId(nextReferral);
          setState('ready');
        }
      } catch {
        setState('error');
      }
    },
    [],
  );

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      facilityRef.current = params.get('facilityId') ?? '';
      setSelectedFacilityId(facilityRef.current);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const referrals = data.eligibleReferrals ?? [];
  const preferences = data.preferences ?? [];
  const appointments = data.appointments ?? [];
  const queue = data.queue ?? [];
  const slots = data.slots ?? [];
  const providers = data.providers ?? [];
  const services = data.services ?? [];
  const specialties = data.specialties ?? [];
  const capabilities = data.capabilities;

  const selectedReferral = referrals.find(
    (referral) => referral.serviceRequestId === selectedReferralId,
  );
  const currentPreference = preferences.find(
    (preference) => preference.serviceRequestId === selectedReferralId,
  );
  const referralAppointments = appointments.filter(
    (appointment) => appointment.serviceRequestId === selectedReferralId,
  );
  const activeAppointment = referralAppointments.find((appointment) =>
    isActiveAppointment(appointment.current.status),
  );
  const currentAppointment = activeAppointment ?? referralAppointments[0];
  const currentTicket = currentAppointment
    ? queue.find((ticket) => ticket.appointmentId === currentAppointment.id)
    : undefined;

  const visibleSlots = slots.filter((slot) => {
    const preferredProvider = currentPreference?.preferredProviderId;
    if (slot.current.status !== 'available') return false;
    if (preferredProvider && slot.providerId !== preferredProvider) return false;
    if (!currentPreference) return true;
    const date = isoDate(slot.startsAt);
    return (
      date >= currentPreference.preferredDateFrom &&
      date <= currentPreference.preferredDateTo
    );
  });

  function selectFacility(facilityId: string) {
    facilityRef.current = facilityId;
    setSelectedFacilityId(facilityId);
    const url = new URL(window.location.href);
    url.searchParams.set('facilityId', facilityId);
    window.history.replaceState(null, '', url);
    void load();
  }

  async function postCommand<T>(
    operation: string,
    url: string,
    payload: Record<string, unknown>,
    pick: (response: Record<string, unknown>) => T | undefined,
  ) {
    if (busy) return null;
    const idempotencyKey = commandKeys.current.get(operation) ?? crypto.randomUUID();
    commandKeys.current.set(operation, idempotencyKey);
    setBusy(operation);
    setMessage(null);
    setOperationError(null);
    try {
      const response = await fetch(url, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...payload,
          ...(facilityRef.current ? { facilityId: facilityRef.current } : {}),
          idempotencyKey,
        }),
      });
      const responsePayload = (await response.json()) as Record<string, unknown> & {
        error?: ApiError;
      };
      commandKeys.current.delete(operation);
      if (!response.ok) {
        setOperationError(
          responsePayload.error ?? {
            code: 'COMMAND_FAILED',
            message: 'Сервер отклонил действие.',
          },
        );
        return null;
      }
      const result = pick(responsePayload);
      if (!result) {
        setOperationError({
          code: 'INVALID_SERVER_RESPONSE',
          message: 'Сервер подтвердил действие без ожидаемых данных.',
        });
        return null;
      }
      return result;
    } catch {
      setOperationError({
        code: 'OUTCOME_UNKNOWN',
        message: unknownSchedulingOutcomeMessage(),
      });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function savePreference(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedReferral) return;
    const form = new FormData(event.currentTarget);
    const earliest = String(form.get('earliestLocalTime') ?? '').trim();
    const latest = String(form.get('latestLocalTime') ?? '').trim();
    const providerId = String(form.get('preferredProviderId') ?? '').trim();
    const notes = String(form.get('notes') ?? '').trim();
    const operation = `preference:${selectedReferral.serviceRequestId}`;
    const result = await postCommand<SchedulingPreferenceSnapshot>(
      operation,
      '/api/scheduling/preferences',
      {
        serviceRequestId: selectedReferral.serviceRequestId,
        serviceRequestVersionId: selectedReferral.serviceRequestVersionId,
        preferredDateFrom: String(form.get('preferredDateFrom') ?? ''),
        preferredDateTo: String(form.get('preferredDateTo') ?? ''),
        earliestLocalTime: earliest || null,
        latestLocalTime: latest || null,
        preferredProviderId: providerId || null,
        notes: notes || null,
        noticeLanguage: String(form.get('noticeLanguage') ?? 'ru'),
        testDataAcknowledged,
      },
      (payload) => payload.preference as SchedulingPreferenceSnapshot | undefined,
    );
    if (!result) return;
    setMessage(`Предпочтения пациента сохранены как неизменяемая версия ${result.version}.`);
    await load(selectedReferral.serviceRequestId, { quiet: true });
  }

  async function holdSlot(slot: SchedulingSlotRecord) {
    if (!selectedReferral || !currentPreference) return;
    const result = await postCommand<SchedulingAppointmentRecord>(
      `hold:${selectedReferral.serviceRequestId}:${slot.id}`,
      '/api/scheduling/appointments/hold',
      {
        serviceRequestId: selectedReferral.serviceRequestId,
        slotId: slot.id,
        preferenceSnapshotId: currentPreference.id,
        expectedSlotVersion: slot.current.version,
        testDataAcknowledged,
      },
      (payload) => payload.appointment as SchedulingAppointmentRecord | undefined,
    );
    if (!result) return;
    setMessage('Время удерживается 15 минут. Теперь требуется явное подтверждение пациента.');
    await load(selectedReferral.serviceRequestId, { quiet: true });
  }

  async function confirmAppointment(appointment: SchedulingAppointmentRecord) {
    if (!patientConfirmed) return;
    const statementVersion = SCHEDULING_CONFIRMATION_STATEMENT_VERSION;
    const statementHash = await hashSchedulingConfirmationStatement({
      appointmentId: appointment.id,
      slotId: appointment.slot.id,
      startsAt: appointment.slot.startsAt,
      endsAt: appointment.slot.endsAt,
      subject: 'patient',
      method: confirmationMethod,
      language: confirmationLanguage,
    });
    const result = await postCommand<SchedulingAppointmentRecord>(
      `confirm:${appointment.id}`,
      `/api/scheduling/appointments/${encodeURIComponent(appointment.id)}/confirm`,
      {
        expectedAppointmentVersion: appointment.current.version,
        expectedSlotVersion: appointment.current.slotVersion,
        confirmation: {
          subject: 'patient',
          method: confirmationMethod,
          language: confirmationLanguage,
          statementVersion,
          statementHash,
          acknowledged: true,
        },
        reason: 'Пациент явно подтвердил выбранные дату и время',
      },
      (payload) => payload.appointment as SchedulingAppointmentRecord | undefined,
    );
    if (!result) return;
    setPatientConfirmed(false);
    setMessage('Запись подтверждена пациентом и сохранена в D1.');
    await load(selectedReferralId, { quiet: true });
  }

  async function appointmentCommand(
    appointment: SchedulingAppointmentRecord,
    action: 'cancel' | 'mark_no_show',
  ) {
    const reason = appointmentReason.trim();
    if (reason.length < 3) return;
    const result = await postCommand<SchedulingAppointmentRecord>(
      `${action}:${appointment.id}:${appointment.current.version}`,
      `/api/scheduling/appointments/${encodeURIComponent(appointment.id)}/command`,
      {
        action,
        expectedAppointmentVersion: appointment.current.version,
        expectedSlotVersion: appointment.current.slotVersion,
        reason,
      },
      (payload) => payload.appointment as SchedulingAppointmentRecord | undefined,
    );
    if (!result) return;
    setAppointmentReason('');
    setMessage(action === 'cancel' ? 'Запись отменена; слот снова доступен.' : 'Неявка зафиксирована.');
    await load(selectedReferralId, { quiet: true });
  }

  async function issueQueue(appointment: SchedulingAppointmentRecord) {
    const result = await postCommand<SchedulingQueueTicketRecord>(
      `queue-issue:${appointment.id}`,
      '/api/scheduling/queue',
      {
        appointmentId: appointment.id,
        expectedAppointmentVersion: appointment.current.version,
        testDataAcknowledged,
      },
      (payload) => payload.ticket as SchedulingQueueTicketRecord | undefined,
    );
    if (!result) return;
    setMessage(`Электронный талон ${result.displayNumber} создан.`);
    await load(selectedReferralId, { quiet: true });
  }

  async function queueCommand(
    ticket: SchedulingQueueTicketRecord,
    action: QueueAction,
  ) {
    const reason = queueReason.trim();
    if (reason.length < 3) return;
    const result = await postCommand<SchedulingQueueTicketRecord>(
      `queue:${action}:${ticket.id}:${ticket.current.version}`,
      `/api/scheduling/queue/${encodeURIComponent(ticket.id)}/command`,
      {
        action,
        expectedQueueVersion: ticket.current.version,
        ...(action === 'complete' && currentAppointment
          ? { expectedAppointmentVersion: currentAppointment.current.version }
          : {}),
        reason,
        roomLabel:
          action === 'call' || action === 'start_service'
            ? roomLabel.trim() || null
            : null,
        exceptionCode: action === 'mark_exception' ? exceptionCode.trim() || null : null,
        exceptionNote: action === 'mark_exception' ? exceptionNote.trim() || null : null,
      },
      (payload) => payload.ticket as SchedulingQueueTicketRecord | undefined,
    );
    if (!result) return;
    setMessage(`Талон ${result.displayNumber}: ${queueLabels[result.current.status].toLowerCase()}.`);
    await load(selectedReferralId, { quiet: true });
  }

  if (state !== 'ready') {
    const content = {
      loading: {
        icon: <LoaderCircle className={styles.spin} aria-hidden="true" size={28} />,
        title: 'Загружаем расписание',
        text: 'Читаем актуальные версии направлений, слотов и очереди из локальной D1.',
      },
      facility: {
        icon: <MapPin aria-hidden="true" size={28} />,
        title: 'Выберите клинику',
        text: 'Доступно несколько площадок. Данные между ними не смешиваются.',
      },
      unauthenticated: {
        icon: <ShieldCheck aria-hidden="true" size={28} />,
        title: 'Требуется вход',
        text: 'Откройте ORION через авторизованный контур.',
      },
      forbidden: {
        icon: <ShieldCheck aria-hidden="true" size={28} />,
        title: 'Нет доступа',
        text: 'Нужна активная роль врача или регистратора в выбранной клинике.',
      },
      error: {
        icon: <AlertTriangle aria-hidden="true" size={28} />,
        title: 'Расписание недоступно',
        text: apiErrorFrom(data, 'Проверьте локальную D1 и повторите загрузку.').message,
      },
      ready: null,
    }[state];

    return content ? (
      <main className={styles.main}>
        <StatePanel
          icon={content.icon}
          title={content.title}
          text={content.text}
          action={
            state === 'facility' ? (
              <div className={styles.facilityChoices}>
                {facilityOptions.map((facility) => (
                  <button
                    className={styles.primaryButton}
                    key={`${facility.organizationId}:${facility.facilityId}`}
                    onClick={() => selectFacility(facility.facilityId)}
                    type="button"
                  >
                    {facility.organizationName} · {facility.facilityName}
                  </button>
                ))}
              </div>
            ) : state === 'error' ? (
              <button className={styles.secondaryButton} onClick={() => void load()} type="button">
                <RefreshCw aria-hidden="true" size={16} /> Повторить
              </button>
            ) : undefined
          }
        />
      </main>
    ) : null;
  }

  return (
    <main className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Запись и поток пациентов</span>
          <h1>Расписание и электронная очередь</h1>
          <p>
            От подтверждённого направления до приёма: предпочтения пациента,
            резерв времени, явное подтверждение и управляемая очередь.
          </p>
        </div>
        <div className={styles.sourceBadge}>
          <ShieldCheck aria-hidden="true" size={20} />
          <span>
            <strong>{data.sourceLabel ?? 'Тестовое ручное расписание · не КМИС'}</strong>
            <small>D1 · синтетические пациенты · без внешней записи</small>
          </span>
        </div>
      </header>

      <section className={styles.stats} aria-label="Сводка расписания">
        <article>
          <CalendarCheck2 aria-hidden="true" size={21} />
          <span><strong>{visibleSlots.length}</strong><small>свободных окон по выбору</small></span>
        </article>
        <article>
          <Stethoscope aria-hidden="true" size={21} />
          <span><strong>{referrals.length}</strong><small>действующих направлений</small></span>
        </article>
        <article>
          <CalendarClock aria-hidden="true" size={21} />
          <span><strong>{appointments.filter((item) => isActiveAppointment(item.current.status)).length}</strong><small>активных записей</small></span>
        </article>
        <article>
          <UsersRound aria-hidden="true" size={21} />
          <span><strong>{queue.filter((item) => !['completed', 'cancelled'].includes(item.current.status)).length}</strong><small>талонов в работе</small></span>
        </article>
      </section>

      {message ? (
        <div className={styles.successMessage} role="status">
          <CheckCircle2 aria-hidden="true" size={18} />
          <span>{message}</span>
          <button aria-label="Закрыть сообщение" onClick={() => setMessage(null)} type="button"><X size={16} /></button>
        </div>
      ) : null}
      {operationError ? (
        <div className={styles.errorMessage} role="alert">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>
            <strong>{operationError.message}</strong>
            <small>{operationError.code}{operationError.requestId ? ` · ${operationError.requestId}` : ''}</small>
          </span>
          <button aria-label="Закрыть ошибку" onClick={() => setOperationError(null)} type="button"><X size={16} /></button>
        </div>
      ) : null}

      <div className={styles.toolbar}>
        <label className={styles.syntheticCheck}>
          <input
            checked={testDataAcknowledged}
            onChange={(event) => setTestDataAcknowledged(event.target.checked)}
            type="checkbox"
          />
          <span>
            <strong>Работаю только с тестовыми данными</strong>
            <small>Обязательно для записи изменений в этот локальный контур</small>
          </span>
        </label>
        <div className={styles.toolbarActions}>
          {facilityOptions.length > 1 ? (
            <select aria-label="Клиника" onChange={(event) => selectFacility(event.target.value)} value={selectedFacilityId}>
              {facilityOptions.map((facility) => (
                <option key={`${facility.organizationId}:${facility.facilityId}`} value={facility.facilityId}>{facility.facilityName}</option>
              ))}
            </select>
          ) : null}
          <button className={styles.secondaryButton} onClick={() => void load(selectedReferralId, { quiet: true })} type="button">
            <RefreshCw aria-hidden="true" size={16} /> Обновить
          </button>
        </div>
      </div>

      <section className={styles.workspace}>
        <aside className={styles.referrals}>
          <header>
            <span><strong>{referrals.length}</strong><small>направлений</small></span>
            <small>только active + approved</small>
          </header>
          {referrals.length ? referrals.map((referral) => (
            <button
              className={`${styles.referralCard} ${selectedReferralId === referral.serviceRequestId ? styles.referralActive : ''}`}
              key={referral.serviceRequestId}
              onClick={() => selectReferral(referral.serviceRequestId)}
              type="button"
            >
              <span className={styles.referralType}>Направление к специалисту</span>
              <strong>{referral.requestedService}</strong>
              <span className={styles.patientLine}><UserRound aria-hidden="true" size={14} />{referral.patient.displayName}</span>
              <small>{referral.patient.medicalRecordNumber} · {referral.targetSpecialty ?? 'Специальность не указана'}</small>
              <ChevronRight className={styles.cardArrow} aria-hidden="true" size={17} />
            </button>
          )) : (
            <InlineEmpty title="Нет готовых направлений" text="Сначала врач должен подтвердить направление к специалисту и сохранить действующее согласие на медицинскую помощь." />
          )}
        </aside>

        <div className={styles.detail}>
          {selectedReferral ? (
            <>
              <header className={styles.detailHeader}>
                <div>
                  <span className={styles.eyebrow}>Маршрут пациента</span>
                  <h2>{selectedReferral.requestedService}</h2>
                  <p>Подтверждено врачом {formatTimestamp(selectedReferral.approvedAt)}</p>
                </div>
                <div className={styles.patientIdentity}>
                  <UserRound aria-hidden="true" size={19} />
                  <span><strong>{selectedReferral.patient.displayName}</strong><small>{selectedReferral.patient.medicalRecordNumber}</small></span>
                </div>
              </header>

              <div className={styles.steps}>
                <Step number="1" title="Предпочтения" done={Boolean(currentPreference)} />
                <Step number="2" title="Выбор времени" done={Boolean(currentAppointment)} />
                <Step number="3" title="Подтверждение" done={currentAppointment?.current.status === 'confirmed' || currentAppointment?.current.status === 'completed'} />
                <Step number="4" title="Очередь" done={Boolean(currentTicket)} />
              </div>

              <div className={styles.columns}>
                <section className={styles.panel}>
                  <PanelHeader number="01" title="Предпочтения пациента" text="Фиксируются со слов пациента; каждое сохранение создаёт новую версию." />
                  <PreferenceForm
                    busy={Boolean(busy)}
                    defaultDateFrom={currentPreference?.preferredDateFrom ?? (slots[0] ? isoDate(slots[0].startsAt) : '')}
                    defaultDateTo={currentPreference?.preferredDateTo ?? (slots.at(-1) ? isoDate(slots.at(-1)!.startsAt) : '')}
                    onSubmit={savePreference}
                    preference={currentPreference}
                    providers={providers}
                    testDataAcknowledged={testDataAcknowledged}
                  />
                </section>

                <section className={styles.panel}>
                  <PanelHeader number="02" title="Свободные окна" text="Показываются только сохранённые ручные тестовые слоты из D1." />
                  {activeAppointment ? (
                    <InlineEmpty title="У направления уже есть активная запись" text="Сначала завершите или отмените текущую запись. Второй активный резерв сервер не создаст." />
                  ) : currentPreference ? (
                    visibleSlots.length ? (
                      <div className={styles.slotList}>
                        {visibleSlots.map((slot) => (
                          <SlotButton
                            disabled={!testDataAcknowledged || Boolean(busy) || !capabilities?.['appointment.hold']}
                            key={slot.id}
                            onClick={() => void holdSlot(slot)}
                            providers={providers}
                            services={services}
                            slot={slot}
                            specialties={specialties}
                          />
                        ))}
                      </div>
                    ) : (
                      <InlineEmpty title="Нет окон по выбранным условиям" text="Измените даты или предпочтительного врача. ORION не создаёт свободное время самостоятельно." />
                    )
                  ) : (
                    <InlineEmpty title="Сначала сохраните предпочтения" text="После этого ORION отфильтрует только существующие слоты, не придумывая доступность." />
                  )}
                </section>
              </div>

              <section className={styles.panel}>
                <PanelHeader number="03" title="Запись пациента" text="Резерв не считается записью, пока пациент явно не подтвердил дату и время." />
                {currentAppointment ? (
                  <AppointmentPanel
                    appointment={currentAppointment}
                    appointmentReason={appointmentReason}
                    busy={Boolean(busy)}
                    canCancel={Boolean(capabilities?.['appointment.cancel'])}
                    canConfirm={Boolean(capabilities?.['appointment.confirm'])}
                    canNoShow={Boolean(capabilities?.['appointment.no_show'])}
                    confirmationLanguage={confirmationLanguage}
                    confirmationMethod={confirmationMethod}
                    onAppointmentReasonChange={setAppointmentReason}
                    onCancel={() => void appointmentCommand(currentAppointment, 'cancel')}
                    onConfirm={() => void confirmAppointment(currentAppointment)}
                    onIssueQueue={() => void issueQueue(currentAppointment)}
                    onLanguageChange={setConfirmationLanguage}
                    onMethodChange={setConfirmationMethod}
                    onNoShow={() => void appointmentCommand(currentAppointment, 'mark_no_show')}
                    onPatientConfirmedChange={setPatientConfirmed}
                    patientConfirmed={patientConfirmed}
                    queueExists={Boolean(currentTicket)}
                    testDataAcknowledged={testDataAcknowledged}
                    canIssueQueue={Boolean(capabilities?.['queue.issue'])}
                  />
                ) : (
                  <InlineEmpty title="Запись ещё не создана" text="Выберите одно из свободных окон. Оно будет удерживаться 15 минут до решения пациента." />
                )}
              </section>

              <section className={styles.panel}>
                <PanelHeader number="04" title="Электронная очередь" text="Порядок статусов задаёт система; ИИ не меняет очередь и приоритет." />
                {currentTicket ? (
                  <QueuePanel
                    appointment={currentAppointment}
                    busy={Boolean(busy)}
                    capabilities={capabilities}
                    exceptionCode={exceptionCode}
                    exceptionNote={exceptionNote}
                    onAction={(action) => void queueCommand(currentTicket, action)}
                    queueReason={queueReason}
                    roomLabel={roomLabel}
                    setExceptionCode={setExceptionCode}
                    setExceptionNote={setExceptionNote}
                    setQueueReason={setQueueReason}
                    setRoomLabel={setRoomLabel}
                    ticket={currentTicket}
                  />
                ) : (
                  <InlineEmpty title="Талон ещё не выдан" text="Талон создаётся только для явно подтверждённой записи пациента." />
                )}
              </section>
            </>
          ) : (
            <div className={styles.detailEmpty}>
              <CalendarClock aria-hidden="true" size={34} />
              <h2>Выберите направление</h2>
              <p>Рабочий маршрут начинается только с действующего направления, подтверждённого врачом.</p>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

function Step({ number, title, done }: { number: string; title: string; done: boolean }) {
  return (
    <div className={`${styles.stepItem} ${done ? styles.stepDone : ''}`}>
      <span>{done ? <Check aria-hidden="true" size={14} /> : number}</span>
      <strong>{title}</strong>
    </div>
  );
}

function PanelHeader({ number, title, text }: { number: string; title: string; text: string }) {
  return (
    <header className={styles.panelHeader}>
      <span className={styles.panelNumber}>{number}</span>
      <span><strong>{title}</strong><small>{text}</small></span>
    </header>
  );
}

function PreferenceForm({
  busy,
  defaultDateFrom,
  defaultDateTo,
  onSubmit,
  preference,
  providers,
  testDataAcknowledged,
}: {
  busy: boolean;
  defaultDateFrom: string;
  defaultDateTo: string;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  preference?: SchedulingPreferenceSnapshot;
  providers: SchedulingProvider[];
  testDataAcknowledged: boolean;
}) {
  return (
    <form className={styles.preferenceForm} key={`${preference?.id ?? 'new'}:${defaultDateFrom}`} onSubmit={onSubmit}>
      <label><span>С даты</span><input defaultValue={defaultDateFrom} name="preferredDateFrom" required type="date" /></label>
      <label><span>По дату</span><input defaultValue={defaultDateTo} name="preferredDateTo" required type="date" /></label>
      <label><span>Не раньше</span><input defaultValue={preference?.earliestLocalTime ?? ''} name="earliestLocalTime" type="time" /></label>
      <label><span>Не позже</span><input defaultValue={preference?.latestLocalTime ?? ''} name="latestLocalTime" type="time" /></label>
      <label className={styles.fieldWide}>
        <span>Предпочтительный врач</span>
        <select defaultValue={preference?.preferredProviderId ?? ''} name="preferredProviderId">
          <option value="">Любой доступный врач</option>
          {providers.map((provider) => <option key={provider.id} value={provider.id}>{provider.displayName}</option>)}
        </select>
      </label>
      <label><span>Язык уведомления</span><select defaultValue={preference?.noticeLanguage ?? 'ru'} name="noticeLanguage"><option value="ru">Русский</option><option value="kk">Қазақша</option></select></label>
      <label className={styles.fieldWide}><span>Комментарий пациента</span><textarea defaultValue={preference?.notes ?? ''} name="notes" placeholder="Например: после 15:00, кроме пятницы" /></label>
      <footer className={styles.formFooter}>
        <small>{preference ? `Текущая версия ${preference.version} · ${formatTimestamp(preference.capturedAt)}` : 'Предпочтения ещё не зафиксированы'}</small>
        <button className={styles.secondaryButton} disabled={busy || !testDataAcknowledged} type="submit"><Check aria-hidden="true" size={16} />Сохранить новую версию</button>
      </footer>
    </form>
  );
}

function SlotButton({
  disabled,
  onClick,
  providers,
  services,
  slot,
  specialties,
}: {
  disabled: boolean;
  onClick: () => void;
  providers: SchedulingProvider[];
  services: SchedulingService[];
  slot: SchedulingSlotRecord;
  specialties: SchedulingSpecialty[];
}) {
  const provider = providers.find((item) => item.id === slot.providerId);
  const service = services.find((item) => item.id === slot.serviceId);
  const specialty = specialties.find((item) => item.id === slot.specialtyId);
  return (
    <button className={styles.slot} disabled={disabled} onClick={onClick} type="button">
      <Clock3 aria-hidden="true" size={18} />
      <span>
        <strong>{formatSlot(slot)}</strong>
        <small>{provider?.displayName ?? 'Врач не указан'} · {specialty?.displayName ?? service?.displayName ?? 'Услуга'}</small>
      </span>
      <span className={styles.slotAction}>Удержать <ArrowRight aria-hidden="true" size={14} /></span>
    </button>
  );
}

function AppointmentPanel({
  appointment,
  appointmentReason,
  busy,
  canCancel,
  canConfirm,
  canIssueQueue,
  canNoShow,
  confirmationLanguage,
  confirmationMethod,
  onAppointmentReasonChange,
  onCancel,
  onConfirm,
  onIssueQueue,
  onLanguageChange,
  onMethodChange,
  onNoShow,
  onPatientConfirmedChange,
  patientConfirmed,
  queueExists,
  testDataAcknowledged,
}: {
  appointment: SchedulingAppointmentRecord;
  appointmentReason: string;
  busy: boolean;
  canCancel: boolean;
  canConfirm: boolean;
  canIssueQueue: boolean;
  canNoShow: boolean;
  confirmationLanguage: 'ru' | 'kk';
  confirmationMethod: 'verbal_in_person' | 'verbal_phone' | 'digital';
  onAppointmentReasonChange: (value: string) => void;
  onCancel: () => void;
  onConfirm: () => void;
  onIssueQueue: () => void;
  onLanguageChange: (value: 'ru' | 'kk') => void;
  onMethodChange: (value: 'verbal_in_person' | 'verbal_phone' | 'digital') => void;
  onNoShow: () => void;
  onPatientConfirmedChange: (value: boolean) => void;
  patientConfirmed: boolean;
  queueExists: boolean;
  testDataAcknowledged: boolean;
}) {
  const status = appointment.current.status;
  const holdExpired = isExpiredSchedulingHold(appointment.current);
  const displayedStatus = holdExpired ? 'expired' : status;
  const mutable = status === 'held' || status === 'confirmed';
  return (
    <div className={styles.appointment}>
      <div className={styles.appointmentFacts}>
        <span className={`${styles.status} ${styles[`appointment_${displayedStatus}`]}`}>{appointmentLabels[displayedStatus]}</span>
        <strong>{formatSlot(appointment.slot)}</strong>
        <span>{appointment.slot.providerName} · {appointment.slot.specialtyName}</span>
        <small>Версия записи {appointment.current.version} · версия слота {appointment.current.slotVersion}</small>
        {status === 'held' ? <small>Резерв до {formatTimestamp(appointment.current.holdExpiresAt)}</small> : null}
      </div>

      {status === 'held' && !holdExpired ? (
        <div className={styles.confirmBox}>
          <label className={styles.confirmCheck}>
            <input checked={patientConfirmed} onChange={(event) => onPatientConfirmedChange(event.target.checked)} type="checkbox" />
            <span><strong>Пациент явно подтвердил дату и время</strong><small>Это действие фиксирует сотрудник. ORION не отвечает за пациента и не подтверждает запись автоматически.</small></span>
          </label>
          <div className={styles.confirmFields}>
            <label><span>Как подтверждено</span><select onChange={(event) => onMethodChange(event.target.value as typeof confirmationMethod)} value={confirmationMethod}><option value="verbal_in_person">Устно в клинике</option><option value="verbal_phone">Устно по телефону</option><option value="digital">Цифровое подтверждение</option></select></label>
            <label><span>Язык</span><select onChange={(event) => onLanguageChange(event.target.value as 'ru' | 'kk')} value={confirmationLanguage}><option value="ru">Русский</option><option value="kk">Қазақша</option></select></label>
            <button className={styles.primaryButton} disabled={busy || !canConfirm || !patientConfirmed} onClick={onConfirm} type="button"><Check aria-hidden="true" size={16} />Подтвердить запись</button>
          </div>
        </div>
      ) : null}

      {holdExpired ? (
        <div className={styles.expiredNotice}>
          <AlertTriangle aria-hidden="true" size={18} />
          <span><strong>Этот резерв больше нельзя подтвердить</strong><small>Укажите основание ниже и освободите слот вручную. Автоматический trusted cleanup ещё не подключён.</small></span>
        </div>
      ) : null}

      {status === 'confirmed' && !queueExists ? (
        <button className={styles.primaryButton} disabled={busy || !canIssueQueue || !testDataAcknowledged} onClick={onIssueQueue} type="button"><TicketCheck aria-hidden="true" size={17} />Выдать электронный талон</button>
      ) : null}

      {mutable ? (
        <div className={styles.cancelBox}>
          <label><span>Основание ручного изменения</span><input onChange={(event) => onAppointmentReasonChange(event.target.value)} placeholder="Обязательная причина" value={appointmentReason} /></label>
          {status === 'confirmed' && canNoShow ? <button className={styles.secondaryButton} disabled={busy || appointmentReason.trim().length < 3} onClick={onNoShow} type="button">Отметить неявку</button> : null}
          {canCancel ? <button className={styles.dangerButton} disabled={busy || appointmentReason.trim().length < 3} onClick={onCancel} type="button">{holdExpired ? 'Освободить просроченный резерв' : 'Отменить запись'}</button> : null}
        </div>
      ) : null}
    </div>
  );
}

function QueuePanel({
  appointment,
  busy,
  capabilities,
  exceptionCode,
  exceptionNote,
  onAction,
  queueReason,
  roomLabel,
  setExceptionCode,
  setExceptionNote,
  setQueueReason,
  setRoomLabel,
  ticket,
}: {
  appointment?: SchedulingAppointmentRecord;
  busy: boolean;
  capabilities?: SchedulingWorkspaceData['capabilities'];
  exceptionCode: string;
  exceptionNote: string;
  onAction: (action: QueueAction) => void;
  queueReason: string;
  roomLabel: string;
  setExceptionCode: (value: string) => void;
  setExceptionNote: (value: string) => void;
  setQueueReason: (value: string) => void;
  setRoomLabel: (value: string) => void;
  ticket: SchedulingQueueTicketRecord;
}) {
  const action = nextQueueAction(ticket.current.status);
  const permission = action ? (`queue.${action === 'mark_exception' ? 'exception' : action}` as keyof SchedulingWorkspaceData['capabilities']) : null;
  const actionAllowed = permission ? capabilities?.[permission] : false;
  const needsRoom = action === 'call' || action === 'start_service';
  return (
    <div className={styles.queuePanel}>
      <div className={styles.ticketCard}>
        <div className={styles.ticketNumber}><small>ТАЛОН</small><strong>{ticket.displayNumber}</strong></div>
        <div className={styles.ticketBody}>
          <span className={`${styles.status} ${styles[`queue_${ticket.current.status}`]}`}>{queueLabels[ticket.current.status]}</span>
          <strong>{ticket.patient.displayName}</strong>
          <small>{ticket.serviceDate} · версия {ticket.current.version}</small>
          {ticket.current.roomLabel ? <span className={styles.room}><DoorOpen aria-hidden="true" size={15} />{ticket.current.roomLabel}</span> : null}
          {ticket.current.exceptionNote ? <span className={styles.exceptionText}>{ticket.current.exceptionCode}: {ticket.current.exceptionNote}</span> : null}
        </div>
      </div>

      {action ? (
        <div className={styles.queueControls}>
          <label><span>Основание изменения статуса</span><input onChange={(event) => setQueueReason(event.target.value)} value={queueReason} /></label>
          {needsRoom ? <label><span>Кабинет</span><input onChange={(event) => setRoomLabel(event.target.value)} value={roomLabel} /></label> : null}
          <button className={styles.primaryButton} disabled={busy || !actionAllowed || queueReason.trim().length < 3 || (needsRoom && !roomLabel.trim()) || (action === 'complete' && !appointment)} onClick={() => onAction(action)} type="button"><CircleDot aria-hidden="true" size={16} />{queueActionLabels[action]}</button>
        </div>
      ) : null}

      {!['completed', 'cancelled', 'exception'].includes(ticket.current.status) && capabilities?.['queue.exception'] ? (
        <details className={styles.exceptionBox}>
          <summary>Нештатная ситуация</summary>
          <div>
            <label><span>Код</span><input onChange={(event) => setExceptionCode(event.target.value)} value={exceptionCode} /></label>
            <label><span>Описание</span><input onChange={(event) => setExceptionNote(event.target.value)} value={exceptionNote} /></label>
            <button className={styles.dangerButton} disabled={busy || exceptionCode.trim().length < 2 || exceptionNote.trim().length < 3 || queueReason.trim().length < 3} onClick={() => onAction('mark_exception')} type="button">Передать на ручную проверку</button>
          </div>
        </details>
      ) : null}
    </div>
  );
}

function InlineEmpty({ title, text }: { title: string; text: string }) {
  return <div className={styles.inlineEmpty}><CalendarClock aria-hidden="true" size={24} /><strong>{title}</strong><span>{text}</span></div>;
}

function StatePanel({ icon, title, text, action }: { icon: React.ReactNode; title: string; text: string; action?: React.ReactNode }) {
  return <section className={styles.statePanel}>{icon}<h1>{title}</h1><p>{text}</p>{action}</section>;
}
