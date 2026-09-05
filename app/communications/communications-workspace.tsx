'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  BellRing,
  CalendarClock,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  Clock3,
  Headphones,
  Languages,
  LoaderCircle,
  MessageCircleMore,
  MessageSquareText,
  PhoneCall,
  RefreshCw,
  SendHorizontal,
  ShieldCheck,
  Smartphone,
  UserRound,
  UserRoundCheck,
  X,
} from 'lucide-react';
import {
  communicationChannels,
  syntheticDestinationHint,
  syntheticDestinationRef,
  type ChannelConsentDecision,
  type CommunicationChannel,
  type CommunicationLanguage,
  type ManualContactState,
  type NotificationState,
  type PatientResponseKind,
} from '@/lib/domain/patient-communications';
import type {
  ChannelConsentRecord,
  CommunicationPatient,
  CommunicationSourceRecord,
  CommunicationWorkspace,
  ManualContactTaskRecord,
  NotificationRecord,
} from '@/lib/repositories/patient-communications';
import styles from './communications.module.css';

type FacilityOption = {
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  role: 'clinician' | 'nurse' | 'registrar';
};

type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: { facilities?: FacilityOption[] };
};

type CommunicationsResponse = Partial<CommunicationWorkspace> & {
  viewer?: {
    id: string;
    displayName: string;
    role: 'clinician' | 'nurse' | 'registrar';
  };
  organization?: { id: string; name: string };
  facility?: { id: string; name: string };
  facilities?: FacilityOption[];
  persistence?: 'd1';
  notification?: NotificationRecord;
  error?: ApiError;
};

type LoadState =
  | 'loading'
  | 'ready'
  | 'facility'
  | 'unauthenticated'
  | 'forbidden'
  | 'error';

type NotificationAction = 'retry_now' | 'cancel' | 'require_manual_contact';
type ManualAction = 'start' | 'record_response' | 'complete' | 'escalate' | 'cancel';

const channelLabels: Record<CommunicationChannel, string> = {
  whatsapp: 'WhatsApp',
  telegram: 'Telegram',
  sms: 'SMS',
  voice: 'Телефонный звонок',
};

const consentLabels: Record<ChannelConsentDecision, string> = {
  granted: 'Разрешён',
  denied: 'Отказ',
  withdrawn: 'Отозван',
};

const notificationLabels: Record<NotificationState, string> = {
  scheduled: 'Запланировано',
  deferred_quiet_hours: 'Отложено до конца тихих часов',
  retry_scheduled: 'Ожидает повтора',
  delivered: 'Доставлено',
  provider_unavailable: 'Провайдер недоступен',
  manual_contact_required: 'Нужен ручной контакт',
  patient_replied: 'Ответ пациента записан',
  manual_contact_completed: 'Ручной контакт завершён',
  suppressed_opt_out: 'Подавлено после отзыва согласия',
  cancelled_source: 'Источник больше не актуален',
  cancelled_by_staff: 'Отменено сотрудником',
};

const manualLabels: Record<ManualContactState, string> = {
  open: 'Открыта',
  in_progress: 'В работе',
  completed: 'Завершена',
  escalated: 'Эскалирована',
  cancelled: 'Отменена',
};

const responseLabels: Record<PatientResponseKind, string> = {
  confirmed: 'Подтвердил',
  declined: 'Отказался',
  question: 'Задал вопрос',
  callback_requested: 'Просит перезвонить',
  other: 'Другое',
};

const roleLabels: Record<FacilityOption['role'], string> = {
  clinician: 'Врач',
  nurse: 'Медсестра',
  registrar: 'Регистратор',
};

const localNoticeHash =
  '6f9fcb72aa4a2de91cb7f4f35f418297605638e92c38875b191350a838ce99bd';

function timeZoneParts(value: number, timeZone: string) {
  return Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(new Date(value))
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
}

function formatTimestamp(value: number | null, timeZone: string) {
  if (value === null) return '—';
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

export function toZonedLocalInput(value: number, timeZone: string) {
  const parts = timeZoneParts(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function timeZoneOffset(value: number, timeZone: string) {
  const parts = timeZoneParts(value, timeZone);
  const representedAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return representedAsUtc - value;
}

export function fromZonedLocalInput(value: string, timeZone: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return Number.NaN;
  const wallTime = Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
  );
  let result = wallTime - timeZoneOffset(wallTime, timeZone);
  result = wallTime - timeZoneOffset(result, timeZone);
  return result;
}

function errorFrom(payload: CommunicationsResponse, fallback: string): ApiError {
  return payload.error ?? { code: 'UNKNOWN_ERROR', message: fallback };
}

export function unknownCommunicationOutcomeMessage() {
  return 'Связь прервалась. Сервер мог сохранить действие. Обновите данные; ORION сохранил тот же ключ защиты от дублей.';
}

export function findChannelConsent(
  consents: ChannelConsentRecord[],
  patientId: string,
  channel: CommunicationChannel,
) {
  return consents.find(
    (consent) => consent.patientId === patientId && consent.channel === channel,
  );
}

export function allowedNotificationActions(
  notification: NotificationRecord,
  capabilities: CommunicationWorkspace['capabilities'],
  now = Date.now(),
) {
  const actions: NotificationAction[] = [];
  if (
    ['scheduled', 'deferred_quiet_hours', 'retry_scheduled'].includes(
      notification.current.state,
    )
  ) {
    if (capabilities['notification.process']) {
      const dueAt = notification.current.nextAttemptAt ?? notification.current.scheduledAt;
      if (dueAt <= now) actions.push('retry_now');
      if (dueAt <= now) actions.push('require_manual_contact');
    }
    if (capabilities['notification.cancel']) actions.push('cancel');
  }
  return actions;
}

export function allowedManualActions(
  task: ManualContactTaskRecord,
  capabilities: CommunicationWorkspace['capabilities'],
) {
  const actions: ManualAction[] = [];
  if (task.current.state === 'open' && capabilities['manual.start']) actions.push('start');
  if (
    ['open', 'in_progress'].includes(task.current.state) &&
    capabilities['manual.response']
  ) actions.push('record_response');
  if (
    ['open', 'in_progress', 'escalated'].includes(task.current.state) &&
    capabilities['manual.complete']
  ) actions.push('complete');
  if (
    ['open', 'in_progress'].includes(task.current.state) &&
    capabilities['manual.escalate']
  ) actions.push('escalate');
  if (
    !['completed', 'cancelled'].includes(task.current.state) &&
    capabilities['manual.cancel']
  ) actions.push('cancel');
  return actions;
}

function ChannelIcon({ channel }: { channel: CommunicationChannel }) {
  if (channel === 'voice') return <PhoneCall aria-hidden="true" size={18} />;
  if (channel === 'sms') return <Smartphone aria-hidden="true" size={18} />;
  return <MessageCircleMore aria-hidden="true" size={18} />;
}

export function CommunicationsWorkspace() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<CommunicationsResponse>({});
  const [facilityOptions, setFacilityOptions] = useState<FacilityOption[]>([]);
  const [selectedFacilityId, setSelectedFacilityId] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [selectedNotificationId, setSelectedNotificationId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [consentTarget, setConsentTarget] = useState<{
    patient: CommunicationPatient;
    channel: CommunicationChannel;
  } | null>(null);
  const [consentDecision, setConsentDecision] = useState<ChannelConsentDecision>('granted');
  const [consentLanguage, setConsentLanguage] = useState<CommunicationLanguage>('ru');
  const [consentVerified, setConsentVerified] = useState(false);
  const [consentReason, setConsentReason] = useState('Решение пациента зафиксировано сотрудником');
  const [scheduleTarget, setScheduleTarget] = useState<CommunicationSourceRecord | null>(null);
  const [scheduleChannel, setScheduleChannel] = useState<CommunicationChannel>('sms');
  const [scheduleAt, setScheduleAt] = useState('');
  const [scheduleReason, setScheduleReason] = useState('Напомнить о подтверждённом событии');
  const [responseTarget, setResponseTarget] = useState<ManualContactTaskRecord | null>(null);
  const [responseKind, setResponseKind] = useState<PatientResponseKind>('confirmed');
  const [responseLanguage, setResponseLanguage] = useState<CommunicationLanguage>('ru');
  const [responseSummary, setResponseSummary] = useState('');

  const facilityRef = useRef('');
  const patientRef = useRef('');
  const notificationRef = useRef('');
  const commandKeys = useRef(new Map<string, string>());
  const dialogRef = useRef<HTMLFormElement>(null);
  const dialogReturnFocusRef = useRef<HTMLElement | null>(null);

  const closeActiveDialog = useCallback(() => {
    setConsentTarget(null);
    setScheduleTarget(null);
    setResponseTarget(null);
  }, []);

  const load = useCallback(async (quiet = false) => {
    if (!quiet) setState('loading');
    try {
      const params = new URLSearchParams({ state: 'all', limit: '200' });
      if (facilityRef.current) params.set('facilityId', facilityRef.current);
      const response = await fetch(`/api/communications?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
      });
      const payload = (await response.json()) as CommunicationsResponse;
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
        !payload.patients ||
        !payload.consents ||
        !payload.sources ||
        !payload.notifications ||
        !payload.manualTasks ||
        !payload.templates ||
        !payload.capabilities
      ) {
        setState('error');
      } else {
        const resolvedFacility = payload.facility?.id ?? facilityRef.current;
        facilityRef.current = resolvedFacility;
        setSelectedFacilityId(resolvedFacility);
        setFacilityOptions(payload.facilities ?? []);
        const nextPatient = payload.patients.some((item) => item.id === patientRef.current)
          ? patientRef.current
          : payload.patients[0]?.id ?? '';
        patientRef.current = nextPatient;
        setSelectedPatientId(nextPatient);
        const patientNotifications = payload.notifications.filter(
          (item) => item.patient.id === nextPatient,
        );
        const nextNotification = patientNotifications.some(
          (item) => item.id === notificationRef.current,
        )
          ? notificationRef.current
          : patientNotifications[0]?.id ?? '';
        notificationRef.current = nextNotification;
        setSelectedNotificationId(nextNotification);
        setState('ready');
      }
    } catch {
      setState('error');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      facilityRef.current = params.get('facilityId') ?? '';
      setSelectedFacilityId(facilityRef.current);
      void load();
    }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const dialogOpen = consentTarget !== null || scheduleTarget !== null || responseTarget !== null;
  useEffect(() => {
    if (!dialogOpen) return;
    const dialog = dialogRef.current;
    if (!dialog) return;
    const focusableSelector =
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
    const focusable = () => [...dialog.querySelectorAll<HTMLElement>(focusableSelector)];
    const first = focusable()[0] ?? dialog;
    first.focus();
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeActiveDialog();
        return;
      }
      if (event.key !== 'Tab') return;
      const elements = focusable();
      if (elements.length === 0) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const firstElement = elements[0];
      const lastElement = elements[elements.length - 1];
      if (event.shiftKey && document.activeElement === firstElement) {
        event.preventDefault();
        lastElement.focus();
      } else if (!event.shiftKey && document.activeElement === lastElement) {
        event.preventDefault();
        firstElement.focus();
      }
    };
    dialog.addEventListener('keydown', onKeyDown);
    return () => {
      dialog.removeEventListener('keydown', onKeyDown);
      dialogReturnFocusRef.current?.focus();
      dialogReturnFocusRef.current = null;
    };
  }, [closeActiveDialog, dialogOpen]);

  const patients = data.patients ?? [];
  const consents = data.consents ?? [];
  const sources = data.sources ?? [];
  const notifications = useMemo(
    () => data.notifications ?? [],
    [data.notifications],
  );
  const manualTasks = data.manualTasks ?? [];
  const capabilities = data.capabilities;
  const facilityTimeZone = data.policy?.timeZone ?? 'UTC';
  const selectedPatient = patients.find((patient) => patient.id === selectedPatientId);
  const patientSources = sources.filter((source) => source.patient.id === selectedPatientId);
  const patientNotifications = notifications.filter(
    (notification) => notification.patient.id === selectedPatientId,
  );
  const patientManualTasks = manualTasks.filter(
    (task) => task.patient.id === selectedPatientId,
  );
  const selectedNotification = patientNotifications.find(
    (notification) => notification.id === selectedNotificationId,
  ) ?? patientNotifications[0];
  const selectedPatientConsents = consents.filter(
    (consent) => consent.patientId === selectedPatientId,
  );

  const stats = useMemo(() => ({
    scheduled: notifications.filter((item) =>
      ['scheduled', 'deferred_quiet_hours', 'retry_scheduled'].includes(item.current.state),
    ).length,
    manual: notifications.filter((item) => item.current.state === 'manual_contact_required').length,
    completed: notifications.filter((item) =>
      ['manual_contact_completed', 'patient_replied'].includes(item.current.state),
    ).length,
    blocked: notifications.filter((item) =>
      ['suppressed_opt_out', 'cancelled_source', 'cancelled_by_staff'].includes(item.current.state),
    ).length,
  }), [notifications]);

  async function mutate(
    key: string,
    path: string,
    body: Record<string, unknown>,
    successMessage: string | ((payload: CommunicationsResponse) => string),
  ) {
    const idempotencyKey = commandKeys.current.get(key) ?? crypto.randomUUID();
    commandKeys.current.set(key, idempotencyKey);
    setBusy(key);
    setMessage(null);
    setOperationError(null);
    try {
      const response = await fetch(path, {
        method: 'POST',
        cache: 'no-store',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...body,
          facilityId: facilityRef.current || undefined,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as CommunicationsResponse;
      if (!response.ok) {
        commandKeys.current.delete(key);
        setOperationError(errorFrom(payload, 'Операция не выполнена.'));
        return null;
      }
      commandKeys.current.delete(key);
      setMessage(
        typeof successMessage === 'function' ? successMessage(payload) : successMessage,
      );
      await load(true);
      return payload;
    } catch {
      setOperationError({
        code: 'UNKNOWN_OUTCOME',
        message: unknownCommunicationOutcomeMessage(),
      });
      return null;
    } finally {
      setBusy(null);
    }
  }

  function chooseFacility(facilityId: string) {
    facilityRef.current = facilityId;
    setSelectedFacilityId(facilityId);
    const params = new URLSearchParams(window.location.search);
    params.set('facilityId', facilityId);
    window.history.replaceState(null, '', `/communications?${params.toString()}`);
    void load();
  }

  function choosePatient(patientId: string) {
    patientRef.current = patientId;
    notificationRef.current = '';
    setSelectedPatientId(patientId);
    setSelectedNotificationId('');
  }

  function openConsent(
    patient: CommunicationPatient,
    channel: CommunicationChannel,
    opener: HTMLElement,
  ) {
    const current = findChannelConsent(consents, patient.id, channel);
    dialogReturnFocusRef.current = opener;
    setConsentTarget({ patient, channel });
    setConsentDecision(current?.decision ?? 'granted');
    setConsentLanguage(current?.preferredLanguage ?? 'ru');
    setConsentVerified(false);
    setConsentReason('Решение пациента зафиксировано сотрудником');
  }

  async function submitConsent(event: FormEvent) {
    event.preventDefault();
    if (!consentTarget) return;
    const current = findChannelConsent(
      consents,
      consentTarget.patient.id,
      consentTarget.channel,
    );
    const granted = consentDecision === 'granted';
    const ok = await mutate(
      `consent:${consentTarget.patient.id}:${consentTarget.channel}`,
      '/api/communications/consents',
      {
        patientId: consentTarget.patient.id,
        channel: consentTarget.channel,
        decision: consentDecision,
        preferredLanguage: consentLanguage,
        destinationRef: granted
          ? syntheticDestinationRef(consentTarget.channel, consentTarget.patient.id)
          : null,
        destinationHint: granted ? syntheticDestinationHint(consentTarget.channel) : null,
        destinationVerified: granted ? consentVerified : false,
        source: 'verbal',
        expectedVersion: current?.version ?? null,
        noticeVersion: 'ORION-COMMS-LOCAL-V1',
        noticeHash: localNoticeHash,
        reason: consentReason,
        syntheticDataAcknowledged: true,
      },
      `Решение по каналу ${channelLabels[consentTarget.channel]} сохранено в D1.`,
    );
    if (ok) setConsentTarget(null);
  }

  function openSchedule(source: CommunicationSourceRecord, opener: HTMLElement) {
    const granted = selectedPatientConsents.filter((consent) => consent.decision === 'granted');
    dialogReturnFocusRef.current = opener;
    setScheduleTarget(source);
    setScheduleChannel(granted[0]?.channel ?? 'sms');
    setScheduleAt(
      toZonedLocalInput(
        source.occursAt - 24 * 60 * 60_000,
        data.policy?.timeZone ?? 'UTC',
      ),
    );
    setScheduleReason('Напомнить о подтверждённом событии');
  }

  async function submitSchedule(event: FormEvent) {
    event.preventDefault();
    if (!scheduleTarget) return;
    const consent = findChannelConsent(
      consents,
      scheduleTarget.patient.id,
      scheduleChannel,
    );
    if (!consent || consent.decision !== 'granted') {
      setOperationError({
        code: 'COMMUNICATION_CONSENT_REQUIRED',
        message: 'Сначала зафиксируйте разрешение пациента для выбранного канала.',
      });
      return;
    }
    const ok = await mutate(
      `schedule:${scheduleTarget.type}:${scheduleTarget.recordId}:${scheduleChannel}:${scheduleAt}`,
      '/api/communications/notifications',
      {
        sourceType: scheduleTarget.type,
        sourceRecordId: scheduleTarget.recordId,
        sourceVersionId: scheduleTarget.versionId,
        channel: scheduleChannel,
        language: consent.preferredLanguage,
        scheduledAt: fromZonedLocalInput(
          scheduleAt,
          data.policy?.timeZone ?? 'UTC',
        ),
        reason: scheduleReason,
        syntheticDataAcknowledged: true,
      },
      'Намерение уведомления сохранено. Отправка не выполнялась.',
    );
    if (ok) setScheduleTarget(null);
  }

  async function runNotificationAction(
    notification: NotificationRecord,
    action: NotificationAction,
  ) {
    const messages: Record<NotificationAction, string> = {
      retry_now: 'Локальная попытка зафиксирована. Внешней отправки не было.',
      cancel: 'Уведомление отменено сотрудником.',
      require_manual_contact: 'Ручная передача обработана.',
    };
    await mutate(
      `notification:${notification.id}:${action}:${notification.current.version}`,
      `/api/communications/notifications/${encodeURIComponent(notification.id)}/command`,
      {
        action,
        expectedVersion: notification.current.version,
        reason:
          action === 'cancel'
            ? 'Отменено уполномоченным сотрудником'
            : action === 'require_manual_contact'
              ? 'Сотрудник перевёл контакт в ручную работу'
              : 'Проверка локального адаптера без внешнего вызова',
      },
      action === 'require_manual_contact'
        ? (payload) =>
            payload.notification?.current.state === 'manual_contact_required'
              ? 'Создана задача ручного контакта.'
              : 'Действие зафиксировано; задача не создана.'
        : messages[action],
    );
  }

  async function runManualAction(
    task: ManualContactTaskRecord,
    action: ManualAction,
    opener?: HTMLElement,
  ) {
    if (action === 'record_response') {
      dialogReturnFocusRef.current = opener ?? null;
      setResponseTarget(task);
      setResponseSummary('');
      return;
    }
    await mutate(
      `manual:${task.id}:${action}:${task.current.version}`,
      `/api/communications/manual-tasks/${encodeURIComponent(task.id)}/command`,
      {
        action,
        expectedVersion: task.current.version,
        reason:
          action === 'start'
            ? 'Сотрудник начал ручной контакт'
            : action === 'complete'
              ? 'Ручной контакт завершён сотрудником'
              : action === 'escalate'
                ? 'Задача эскалирована для ручной проверки'
                : 'Ручная задача отменена сотрудником',
        responseKind: null,
        responseLanguage: null,
        responseSummary: null,
      },
      'Статус ручной задачи сохранён в D1.',
    );
  }

  async function submitResponse(event: FormEvent) {
    event.preventDefault();
    if (!responseTarget) return;
    const ok = await mutate(
      `manual:${responseTarget.id}:record_response:${responseTarget.current.version}`,
      `/api/communications/manual-tasks/${encodeURIComponent(responseTarget.id)}/command`,
      {
        action: 'record_response',
        expectedVersion: responseTarget.current.version,
        reason: 'Сотрудник записал ответ пациента после ручного контакта',
        responseKind,
        responseLanguage,
        responseSummary,
      },
      'Ответ пациента записан без автоматического изменения лечения.',
    );
    if (ok) setResponseTarget(null);
  }

  if (state !== 'ready' || !capabilities) {
    const panel = {
      loading: ['Загружаем очередь', 'Читаем согласия, источники и ручные задачи из D1.'],
      facility: ['Выберите клинику', 'Для работы с коммуникациями нужен один конкретный филиал.'],
      unauthenticated: ['Нужен вход', 'Откройте ORION Clinic через авторизованный контур.'],
      forbidden: ['Нет доступа', 'Нужна активная роль врача, медсестры или регистратора.'],
      error: ['Контур недоступен', data.error?.message ?? 'Не удалось прочитать данные D1.'],
      ready: ['', ''],
    }[state];
    return (
      <main className={styles.statePanel}>
        {state === 'loading' ? <LoaderCircle className={styles.spin} size={36} /> : <CircleAlert size={36} />}
        <small>Связь с пациентом</small>
        <h1>{panel[0]}</h1>
        <p>{panel[1]}</p>
        {state === 'facility' ? (
          <select aria-label="Клиника" value={selectedFacilityId} onChange={(event) => chooseFacility(event.target.value)}>
            <option value="">Выберите клинику</option>
            {facilityOptions.map((facility) => <option key={facility.facilityId} value={facility.facilityId}>{facility.organizationName} · {facility.facilityName}</option>)}
          </select>
        ) : state === 'error' ? (
          <button className={styles.primaryButton} onClick={() => void load()} type="button"><RefreshCw size={17} /> Повторить</button>
        ) : null}
      </main>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Контур после приёма</span>
          <h1>Связь с пациентом</h1>
          <p>Согласия по каналам, напоминания и ручные задачи хранятся в D1. Каждый канал разрешается отдельно.</p>
        </div>
        <div className={styles.boundaryBadge}>
          <ShieldCheck aria-hidden="true" size={20} />
          <span><strong>Провайдеры не подключены</strong><small>Отправка не выполняется · только синтетические данные</small></span>
        </div>
      </header>

      <section className={styles.stats} aria-label="Сводка очереди">
        <article><Clock3 size={19} /><span><strong>{stats.scheduled}</strong><small>в очереди или ожидают повтора</small></span></article>
        <article><Headphones size={19} /><span><strong>{stats.manual}</strong><small>требуют ручного контакта</small></span></article>
        <article><UserRoundCheck size={19} /><span><strong>{stats.completed}</strong><small>ответов и завершённых контактов</small></span></article>
        <article><CircleAlert size={19} /><span><strong>{stats.blocked}</strong><small>подавлено или отменено</small></span></article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.toolbarMeta}><MessageSquareText size={18} /><span><strong>{data.facility?.name ?? 'Филиал'}</strong><small>{data.viewer?.displayName} · {data.viewer?.role ? roleLabels[data.viewer.role] : ''}</small></span></div>
        <div className={styles.toolbarActions}>
          {facilityOptions.length > 1 ? <select aria-label="Сменить клинику" value={selectedFacilityId} onChange={(event) => chooseFacility(event.target.value)}>{facilityOptions.map((facility) => <option key={facility.facilityId} value={facility.facilityId}>{facility.facilityName}</option>)}</select> : null}
          <button className={styles.secondaryButton} disabled={busy !== null} onClick={() => void load()} type="button"><RefreshCw size={16} /> Обновить</button>
        </div>
      </section>

      {message ? <div className={styles.successMessage} role="status"><CheckCircle2 size={18} /><span>{message}</span><button aria-label="Закрыть" onClick={() => setMessage(null)} type="button"><X size={16} /></button></div> : null}
      {operationError ? <div className={styles.errorMessage} role="alert"><AlertTriangle size={18} /><span><strong>{operationError.message}</strong><small>{operationError.code}{operationError.requestId ? ` · ${operationError.requestId}` : ''}</small></span><button aria-label="Закрыть" onClick={() => setOperationError(null)} type="button"><X size={16} /></button></div> : null}

      <section className={styles.workspace}>
        <aside className={styles.patientList}>
          <header><span>Пациенты</span><strong>{patients.length}</strong></header>
          {patients.length ? patients.map((patient) => {
            const granted = consents.filter((consent) => consent.patientId === patient.id && consent.decision === 'granted').length;
            return <button aria-pressed={patient.id === selectedPatientId} className={`${styles.patientCard} ${patient.id === selectedPatientId ? styles.patientCardActive : ''}`} key={patient.id} onClick={() => choosePatient(patient.id)} type="button"><span className={styles.patientAvatar}>{patient.displayName.slice(0, 1)}</span><span><strong>{patient.displayName}</strong><small>{patient.medicalRecordNumber}</small><em>{granted} из 4 каналов разрешено</em></span><ChevronRight size={16} /></button>;
          }) : <div className={styles.emptyList}><UserRound size={24} /><strong>Нет пациентов</strong><p>Сначала добавьте синтетическую карточку в реестре.</p></div>}
        </aside>

        <div className={styles.detail}>
          {selectedPatient ? <>
            <header className={styles.detailHeader}><div><span className={styles.eyebrow}>Карта коммуникаций</span><h2>{selectedPatient.displayName}</h2><p>{selectedPatient.medicalRecordNumber} · внутренние тестовые идентификаторы</p></div><div className={styles.dataBoundary}><ShieldCheck size={17} /><span><strong>Синтетические данные</strong><small>Назначения хранятся как системные test:-алиасы</small></span></div></header>

            <section className={styles.sectionCard}>
              <header><div><span className={styles.eyebrow}>01 · Право на канал</span><h3>Согласия пациента</h3></div><small>Каждый канал независим</small></header>
              <div className={styles.channelGrid}>{communicationChannels.map((channel) => {
                const consent = findChannelConsent(consents, selectedPatient.id, channel);
                return <article className={styles.channelCard} key={channel} data-decision={consent?.decision ?? 'missing'}><div className={styles.channelTop}><span className={styles.channelIcon}><ChannelIcon channel={channel} /></span><span className={styles.stateTag}>{consent ? consentLabels[consent.decision] : 'Не зафиксировано'}</span></div><h4>{channelLabels[channel]}</h4><p>{consent?.destinationHint ?? 'Назначение не сохранено'}</p><small>{consent ? `${consent.preferredLanguage.toUpperCase()} · версия ${consent.version}` : 'Нужно решение пациента'}</small><button className={styles.secondaryButton} disabled={!capabilities['consent.capture'] || busy !== null} onClick={(event) => openConsent(selectedPatient, channel, event.currentTarget)} type="button">{consent ? 'Изменить' : 'Зафиксировать'}</button></article>;
              })}</div>
            </section>

            <section className={styles.sectionCard}>
              <header><div><span className={styles.eyebrow}>02 · Основание</span><h3>Подтверждённые источники</h3></div><small>Точная версия записи или плана</small></header>
              <div className={styles.sourceList}>{patientSources.length ? patientSources.map((source) => <article className={styles.sourceCard} key={`${source.type}:${source.recordId}`}><span className={styles.sourceIcon}>{source.type === 'appointment' ? <CalendarClock size={18} /> : <BellRing size={18} />}</span><div><strong>{source.title}</strong><small>{source.type === 'appointment' ? 'Подтверждённая запись' : 'Задача подписанного плана'} · {formatTimestamp(source.occursAt, facilityTimeZone)}</small><em>{source.versionId}</em></div><button className={styles.primaryButton} disabled={!capabilities['notification.schedule'] || !selectedPatientConsents.some((item) => item.decision === 'granted') || busy !== null} onClick={(event) => openSchedule(source, event.currentTarget)} type="button"><SendHorizontal size={15} /> Поставить в очередь</button></article>) : <div className={styles.emptyInline}><CalendarClock size={22} /><span><strong>Нет допустимых источников</strong><small>Нужна текущая подтверждённая запись или задача подписанного плана.</small></span></div>}</div>
            </section>

            <section className={styles.queueSection}>
              <div className={styles.queueList}><header><div><span className={styles.eyebrow}>03 · D1 outbox</span><h3>Очередь уведомлений</h3></div><strong>{patientNotifications.length}</strong></header>{patientNotifications.length ? patientNotifications.map((notification) => <button aria-pressed={selectedNotification?.id === notification.id} className={`${styles.notificationRow} ${selectedNotification?.id === notification.id ? styles.notificationRowActive : ''}`} key={notification.id} onClick={() => { notificationRef.current = notification.id; setSelectedNotificationId(notification.id); }} type="button"><span className={styles.notificationChannel}><ChannelIcon channel={notification.current.channel} /></span><span><strong>{channelLabels[notification.current.channel]}</strong><small>{notificationLabels[notification.current.state]}</small><em>{formatTimestamp(notification.current.scheduledAt, facilityTimeZone)}</em></span><ChevronRight size={15} /></button>) : <div className={styles.emptyInline}><MessageSquareText size={22} /><span><strong>Очередь пуста</strong><small>Запланируйте первое напоминание из подтверждённого источника.</small></span></div>}</div>
              <div className={styles.notificationDetail}>{selectedNotification ? <><header><span className={styles.stateTag} data-state={selectedNotification.current.state}>{notificationLabels[selectedNotification.current.state]}</span><small>версия {selectedNotification.current.version}</small></header><h3>{channelLabels[selectedNotification.current.channel]} · {selectedNotification.current.language.toUpperCase()}</h3><p className={styles.messagePreview}>{selectedNotification.current.renderedBody}</p><div className={styles.notSent}><CircleAlert size={17} /><span><strong>Это не отправленное сообщение</strong><small>Хранится намерение и предпросмотр. Провайдер отключён.</small></span></div><dl><div><dt>Следующая попытка</dt><dd>{formatTimestamp(selectedNotification.current.nextAttemptAt, facilityTimeZone)}</dd></div><div><dt>Попытки</dt><dd>{selectedNotification.current.attemptCount}</dd></div><div><dt>Ответственный</dt><dd>{selectedNotification.current.failureOwner}</dd></div><div><dt>Назначение</dt><dd>{selectedNotification.current.destinationHint}</dd></div></dl>{selectedNotification.attempts.length ? <div className={styles.attempts}><strong>История попыток</strong>{selectedNotification.attempts.map((attempt) => <span key={attempt.id}><b>#{attempt.attemptNumber}</b><small>Провайдер не настроен · {formatTimestamp(attempt.occurredAt, facilityTimeZone)}</small></span>)}</div> : null}<div className={styles.actionRow}>{allowedNotificationActions(selectedNotification, capabilities).map((action) => <button className={action === 'cancel' ? styles.dangerButton : action === 'require_manual_contact' ? styles.warningButton : styles.primaryButton} disabled={busy !== null} key={action} onClick={() => void runNotificationAction(selectedNotification, action)} type="button">{action === 'retry_now' ? 'Проверить адаптер' : action === 'require_manual_contact' ? 'Передать вручную' : 'Отменить'}</button>)}</div></> : <div className={styles.emptyDetail}><MessageSquareText size={27} /><h3>Выберите уведомление</h3><p>Здесь будут статус, текст, попытки и ответственный.</p></div>}</div>
            </section>

            <section className={styles.sectionCard}>
              <header><div><span className={styles.eyebrow}>04 · Ручной fallback</span><h3>Задачи сотрудника</h3></div><small>Не изменяют лечение и диагноз</small></header>
              <div className={styles.manualList}>{patientManualTasks.length ? patientManualTasks.map((task) => <article className={styles.manualCard} key={task.id}><div className={styles.manualTop}><span className={styles.stateTag} data-state={task.current.state}>{manualLabels[task.current.state]}</span><small>{channelLabels[task.channel]} · {task.destinationHint}</small></div><h4>Связаться с {task.patient.displayName}</h4><p>{task.current.failureReason}</p><dl><div><dt>Исполнитель</dt><dd>{task.current.assignedTo}</dd></div><div><dt>Срок</dt><dd>{formatTimestamp(task.current.dueAt, facilityTimeZone)}</dd></div>{task.current.outcomeSummary ? <div><dt>Результат</dt><dd>{task.current.outcomeSummary}</dd></div> : null}</dl><div className={styles.actionRow}>{allowedManualActions(task, capabilities).map((action) => <button className={action === 'cancel' ? styles.dangerButton : action === 'escalate' ? styles.warningButton : styles.secondaryButton} disabled={busy !== null} key={action} onClick={(event) => void runManualAction(task, action, event.currentTarget)} type="button">{action === 'start' ? 'Начать' : action === 'record_response' ? 'Записать ответ' : action === 'complete' ? 'Завершить' : action === 'escalate' ? 'Эскалировать' : 'Отменить'}</button>)}</div></article>) : <div className={styles.emptyInline}><Headphones size={22} /><span><strong>Нет назначенных ручных задач</strong><small>Они появятся после исчерпания повторов или ручного решения.</small></span></div>}</div>
            </section>

            <section className={styles.policyStrip}><ShieldCheck size={18} /><span><strong>Локальная политика: {data.policy?.policyCode ?? 'не загружена'}</strong><small>Часовой пояс {facilityTimeZone} · тихие часы {data.policy ? `${String(Math.floor(data.policy.quietStartMinute / 60)).padStart(2, '0')}:${String(data.policy.quietStartMinute % 60).padStart(2, '0')}–${String(Math.floor(data.policy.quietEndMinute / 60)).padStart(2, '0')}:${String(data.policy.quietEndMinute % 60).padStart(2, '0')}` : '—'} · {data.templates?.length ?? 0} тестовых шаблонов RU/KK · защищённая ссылка не настроена</small></span></section>
          </> : <div className={styles.emptyDetail}><UserRound size={28} /><h2>Выберите пациента</h2><p>Рабочая карта покажет согласия, источники, очередь и ручные задачи.</p></div>}
        </div>
      </section>

      {consentTarget ? <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) closeActiveDialog(); }}><form aria-labelledby="consent-title" aria-modal="true" className={styles.dialog} onSubmit={submitConsent} ref={dialogRef} role="dialog" tabIndex={-1}><header><div><span className={styles.eyebrow}>Канал пациента</span><h2 id="consent-title">{channelLabels[consentTarget.channel]}</h2></div><button aria-label="Закрыть" onClick={closeActiveDialog} type="button"><X size={18} /></button></header><div className={styles.formGrid}><label><span>Решение</span><select value={consentDecision} onChange={(event) => { const value = event.target.value as ChannelConsentDecision; setConsentDecision(value); setConsentVerified(false); }}><option value="granted">Разрешил</option><option value="denied">Отказал</option>{findChannelConsent(consents, consentTarget.patient.id, consentTarget.channel) ? <option value="withdrawn">Отозвал разрешение</option> : null}</select></label><label><span>Предпочитаемый язык</span><select value={consentLanguage} onChange={(event) => setConsentLanguage(event.target.value as CommunicationLanguage)}><option value="ru">Русский</option><option value="kk">Қазақша</option></select></label>{consentDecision === 'granted' ? <><div className={`${styles.fixedDestination} ${styles.full}`}><span>Системное тестовое назначение</span><strong>{syntheticDestinationHint(consentTarget.channel)}</strong><small>Поле не редактируется: реальный номер или адрес в этот контур не попадёт.</small></div><label className={`${styles.confirmCheck} ${styles.full}`}><input checked={consentVerified} onChange={(event) => setConsentVerified(event.target.checked)} type="checkbox" /><span><strong>Сотрудник повторно подтвердил решение пациента</strong><small>Это не проверка реального мессенджера или номера.</small></span></label></> : null}<label className={styles.full}><span>Основание</span><textarea minLength={3} onChange={(event) => setConsentReason(event.target.value)} required rows={3} value={consentReason} /></label></div><footer><button className={styles.secondaryButton} onClick={closeActiveDialog} type="button">Закрыть</button><button className={styles.primaryButton} disabled={busy !== null || (consentDecision === 'granted' && !consentVerified)} type="submit">{busy?.startsWith('consent:') ? <LoaderCircle className={styles.spin} size={16} /> : null} Сохранить в D1</button></footer></form></div> : null}

      {scheduleTarget ? <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) closeActiveDialog(); }}><form aria-labelledby="schedule-title" aria-modal="true" className={styles.dialog} onSubmit={submitSchedule} ref={dialogRef} role="dialog" tabIndex={-1}><header><div><span className={styles.eyebrow}>Намерение, а не отправка</span><h2 id="schedule-title">Поставить в очередь</h2></div><button aria-label="Закрыть" onClick={closeActiveDialog} type="button"><X size={18} /></button></header><div className={styles.dialogNotice}><CircleAlert size={18} /><span><strong>Внешней отправки не будет</strong><small>Провайдеры не подключены. D1 запишет очередь и честный сбой.</small></span></div><div className={styles.formGrid}><label className={styles.full}><span>Источник</span><input disabled value={`${scheduleTarget.title} · ${scheduleTarget.versionId}`} /></label><label><span>Канал с текущим согласием</span><select value={scheduleChannel} onChange={(event) => setScheduleChannel(event.target.value as CommunicationChannel)}>{selectedPatientConsents.filter((consent) => consent.decision === 'granted').map((consent) => <option key={consent.channel} value={consent.channel}>{channelLabels[consent.channel]} · {consent.preferredLanguage.toUpperCase()}</option>)}</select></label><label><span>Плановое время · {facilityTimeZone}</span><input onChange={(event) => setScheduleAt(event.target.value)} required type="datetime-local" value={scheduleAt} /></label><label className={styles.full}><span>Основание</span><textarea minLength={3} onChange={(event) => setScheduleReason(event.target.value)} required rows={3} value={scheduleReason} /></label></div><footer><button className={styles.secondaryButton} onClick={closeActiveDialog} type="button">Закрыть</button><button className={styles.primaryButton} disabled={busy !== null || !selectedPatientConsents.some((consent) => consent.decision === 'granted')} type="submit">Сохранить намерение</button></footer></form></div> : null}

      {responseTarget ? <div className={styles.overlay} onMouseDown={(event) => { if (event.target === event.currentTarget) closeActiveDialog(); }}><form aria-labelledby="response-title" aria-modal="true" className={styles.dialog} onSubmit={submitResponse} ref={dialogRef} role="dialog" tabIndex={-1}><header><div><span className={styles.eyebrow}>Ручной контакт</span><h2 id="response-title">Записать ответ пациента</h2></div><button aria-label="Закрыть" onClick={closeActiveDialog} type="button"><X size={18} /></button></header><div className={styles.formGrid}><label><span>Тип ответа</span><select value={responseKind} onChange={(event) => setResponseKind(event.target.value as PatientResponseKind)}>{Object.entries(responseLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Язык</span><select value={responseLanguage} onChange={(event) => setResponseLanguage(event.target.value as CommunicationLanguage)}><option value="ru">Русский</option><option value="kk">Қазақша</option></select></label><label className={styles.full}><span>Краткая запись со слов пациента</span><textarea maxLength={2000} minLength={3} onChange={(event) => setResponseSummary(event.target.value)} required rows={5} value={responseSummary} /></label></div><div className={styles.dialogNotice}><Languages size={18} /><span><strong>Только фиксация ответа</strong><small>ORION не меняет диагноз, лечение, запись или план автоматически.</small></span></div><footer><button className={styles.secondaryButton} onClick={closeActiveDialog} type="button">Закрыть</button><button className={styles.primaryButton} disabled={busy !== null || responseSummary.trim().length < 3} type="submit">Записать в D1</button></footer></form></div> : null}
    </main>
  );
}
