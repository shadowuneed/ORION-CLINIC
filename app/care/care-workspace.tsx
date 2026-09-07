'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  CalendarDays,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  FilePenLine,
  HeartPulse,
  LoaderCircle,
  LockKeyhole,
  MessageSquareText,
  Plus,
  RefreshCw,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserRoundCheck,
  UsersRound,
  X,
} from 'lucide-react';
import type {
  ChronicAssignee,
  ChronicCareWorkspace as ChronicCareWorkspaceData,
  ChronicEnrollmentRecord,
  ChronicTaskRecord,
} from '@/lib/repositories/chronic-care-workflow';
import type {
  ChronicDueState,
  ChronicTaskKind,
  ChronicTaskOwnerRole,
  ContactMethod,
  WellbeingState,
} from '@/lib/domain/chronic-care';
import styles from './care.module.css';

type AccessAssignmentOption = {
  assignmentId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
  role: 'clinician' | 'nurse';
};

type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: { assignments?: AccessAssignmentOption[] };
};

type ChronicCareResponse = Partial<ChronicCareWorkspaceData> & {
  viewer?: {
    id: string;
    displayName: string;
    membershipId: string;
    accessAssignmentId: string;
    role: 'clinician' | 'nurse';
  };
  organization?: { id: string; name: string };
  facility?: { id: string; name: string };
  accessAssignment?: AccessAssignmentOption;
  accessAssignments?: AccessAssignmentOption[];
  persistence?: 'd1';
  error?: ApiError;
};

type LoadState =
  | 'loading'
  | 'ready'
  | 'assignment'
  | 'unauthenticated'
  | 'forbidden'
  | 'error';

type TaskAction =
  | 'start'
  | 'record_response'
  | 'escalate'
  | 'complete'
  | 'resolve'
  | 'cancel';

type MedicationDraft = {
  key: string;
  name: string;
  dose: string;
  route: string;
  schedule: string;
  startsOn: string;
  endsOn: string;
  instructions: string;
};

type TaskDraft = {
  key: string;
  kind: ChronicTaskKind;
  title: string;
  dueDate: string;
  ownerRole: ChronicTaskOwnerRole;
  assignedMembershipId: string;
  instructions: string;
};

const dueLabels: Record<ChronicDueState, string> = {
  overdue: 'Просрочено',
  due_soon: 'Срок подходит',
  current: 'По плану',
  closed: 'Закрыто',
};

const taskKindLabels: Record<ChronicTaskKind, string> = {
  nurse_contact: 'Контакт медсестры',
  follow_up_visit: 'Повторный приём',
  control_test: 'Контрольное исследование',
  medication_review: 'Проверка лекарственного плана',
};

const taskStatusLabels: Record<ChronicTaskRecord['current']['status'], string> = {
  pending: 'Ожидает',
  in_progress: 'В работе',
  completed: 'Завершено',
  escalated: 'Передано врачу',
  cancelled: 'Отменено',
};

const contactLabels: Record<ContactMethod, string> = {
  in_person: 'Лично',
  phone: 'Телефон',
  digital: 'Цифровой канал',
};

const wellbeingLabels: Record<WellbeingState, string> = {
  stable: 'Без ухудшения со слов пациента',
  concerning: 'Есть настораживающие изменения',
  urgent: 'Нужна срочная оценка врачом',
};

function isoToday() {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, '0'),
    String(now.getDate()).padStart(2, '0'),
  ].join('-');
}

function addDays(date: string, days: number) {
  const value = new Date(`${date}T12:00:00`);
  value.setDate(value.getDate() + days);
  return [
    value.getFullYear(),
    String(value.getMonth() + 1).padStart(2, '0'),
    String(value.getDate()).padStart(2, '0'),
  ].join('-');
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`));
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

function joinClass(...values: Array<string | false | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function buildChronicCareAccessQuery(
  facilityId?: string,
  accessAssignmentId?: string,
) {
  const params = new URLSearchParams({ dueState: 'all', limit: '200' });
  if (facilityId) params.set('facilityId', facilityId);
  if (accessAssignmentId) params.set('accessAssignmentId', accessAssignmentId);
  return params;
}

export function buildChronicCareOperationKey(
  accessAssignmentId: string,
  operation: string,
) {
  return `${accessAssignmentId || 'unselected'}|${operation}`;
}

export function unknownChronicCareOutcomeMessage() {
  return 'Связь прервалась. Сервер мог сохранить действие. Обновите данные; если изменение не появилось, повторите — ORION использует тот же ключ защиты от дублей.';
}

export function allowedCareTaskActions(
  task: Pick<ChronicTaskRecord, 'current' | 'ownerRole'>,
  capabilities: ChronicCareWorkspaceData['capabilities'],
  viewerRole: ChronicCareWorkspaceData['role'],
) {
  const result: TaskAction[] = [];
  const ownsOperationalTask = task.ownerRole === viewerRole;
  if (
    ownsOperationalTask &&
    task.current.status === 'pending' &&
    capabilities['task.start']
  ) result.push('start');
  if (
    ownsOperationalTask &&
    (task.current.status === 'pending' || task.current.status === 'in_progress') &&
    capabilities['task.response']
  ) result.push('record_response');
  if (
    ownsOperationalTask &&
    (task.current.status === 'pending' || task.current.status === 'in_progress') &&
    capabilities['task.escalate']
  ) result.push('escalate');
  if (
    ownsOperationalTask &&
    (task.current.status === 'pending' || task.current.status === 'in_progress') &&
    capabilities['task.complete']
  ) result.push('complete');
  if (task.current.status === 'escalated' && capabilities['task.resolve']) result.push('resolve');
  if (
    !['completed', 'cancelled'].includes(task.current.status) &&
    capabilities['task.cancel']
  ) result.push('cancel');
  return result;
}

function errorFrom(payload: ChronicCareResponse, fallback: string): ApiError {
  return payload.error ?? { code: 'UNKNOWN_ERROR', message: fallback };
}

function newTaskDraft(
  assignees: ChronicAssignee[],
  effectiveFrom: string,
  index: number,
): TaskDraft {
  const nurse = assignees.find((candidate) => candidate.role === 'nurse');
  const doctor = assignees.find((candidate) => candidate.role === 'clinician');
  const assignee = nurse ?? doctor;
  return {
    key: `task-${Date.now()}-${index}`,
    kind: nurse ? 'nurse_contact' : 'follow_up_visit',
    title: nurse ? 'Уточнить самочувствие пациента' : 'Контрольный приём врача',
    dueDate: addDays(effectiveFrom, 7 + index * 14),
    ownerRole: assignee?.role ?? 'clinician',
    assignedMembershipId: assignee?.membershipId ?? '',
    instructions: nurse
      ? 'Записать ответ пациента и при необходимости передать врачу.'
      : 'Проверить динамику и принять клиническое решение.',
  };
}

export function ChronicCareWorkspace() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<ChronicCareResponse>({});
  const [selectedAccessAssignmentId, setSelectedAccessAssignmentId] = useState('');
  const [assignmentOptions, setAssignmentOptions] = useState<AccessAssignmentOption[]>([]);
  const [selectedEnrollmentId, setSelectedEnrollmentId] = useState('');
  const [selectedTaskId, setSelectedTaskId] = useState('');
  const [dueFilter, setDueFilter] = useState<ChronicDueState | 'all'>('all');
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [enrollmentOpen, setEnrollmentOpen] = useState(false);
  const [planOpen, setPlanOpen] = useState(false);

  const facilityRef = useRef('');
  const accessAssignmentRef = useRef('');
  const selectedEnrollmentRef = useRef('');
  const commandKeys = useRef(new Map<string, string>());
  const loadAbort = useRef<AbortController | null>(null);
  const loadGeneration = useRef(0);

  const [basisId, setBasisId] = useState('');
  const [registryCode, setRegistryCode] = useState('SYN-ENDO-01');
  const [diagnosisDisplay, setDiagnosisDisplay] = useState('');
  const [diagnosisCode, setDiagnosisCode] = useState('');
  const [diagnosisBasis, setDiagnosisBasis] = useState('');
  const [enrollmentReason, setEnrollmentReason] = useState(
    'Решение врача о локальном тестовом наблюдении',
  );
  const [doctorConfirmed, setDoctorConfirmed] = useState(false);
  const [localSourceAcknowledged, setLocalSourceAcknowledged] = useState(false);

  const [effectiveFrom, setEffectiveFrom] = useState(isoToday());
  const [effectiveTo, setEffectiveTo] = useState(addDays(isoToday(), 90));
  const [goals, setGoals] = useState('');
  const [treatmentPlan, setTreatmentPlan] = useState('');
  const [dietPlan, setDietPlan] = useState('');
  const [medications, setMedications] = useState<MedicationDraft[]>([]);
  const [taskDrafts, setTaskDrafts] = useState<TaskDraft[]>([]);
  const [planReason, setPlanReason] = useState('Врач подписал план наблюдения');
  const [planDoctorConfirmed, setPlanDoctorConfirmed] = useState(false);
  const [planSourceAcknowledged, setPlanSourceAcknowledged] = useState(false);

  const [taskReason, setTaskReason] = useState('Статус подтверждён сотрудником');
  const [contactMethod, setContactMethod] = useState<ContactMethod>('phone');
  const [wellbeing, setWellbeing] = useState<WellbeingState>('stable');
  const [responseSummary, setResponseSummary] = useState('');
  const [escalationReason, setEscalationReason] = useState('');

  const load = useCallback(async (preferredEnrollmentId?: string, quiet = false) => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    if (!quiet) setState('loading');
    try {
      const params = buildChronicCareAccessQuery(
        facilityRef.current || undefined,
        accessAssignmentRef.current || undefined,
      );
      const response = await fetch(`/api/care?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const payload = (await response.json()) as ChronicCareResponse;
      if (controller.signal.aborted || generation !== loadGeneration.current) return;
      setData(payload);
      if (response.status === 401) {
        setState('unauthenticated');
      } else if (
        response.status === 409 &&
        payload.error?.code === 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED'
      ) {
        setAssignmentOptions(payload.error.details?.assignments ?? []);
        setState('assignment');
      } else if (response.status === 403) {
        setState('forbidden');
      } else if (
        !response.ok ||
        !payload.enrollments ||
        !payload.tasks ||
        !payload.eligibleBases ||
        !payload.assignees ||
        !payload.cohortCounts ||
        !payload.capabilities ||
        !payload.role ||
        !payload.viewer ||
        !payload.organization ||
        !payload.facility ||
        !payload.accessAssignment
      ) {
        setState('error');
      } else {
        const resolvedFacility = payload.facility?.id ?? facilityRef.current;
        const resolvedAssignment = payload.accessAssignment.assignmentId;
        facilityRef.current = resolvedFacility;
        accessAssignmentRef.current = resolvedAssignment;
        setSelectedAccessAssignmentId(resolvedAssignment);
        setAssignmentOptions(payload.accessAssignments ?? []);
        const url = new URL(window.location.href);
        url.searchParams.set('facilityId', resolvedFacility);
        url.searchParams.set('accessAssignmentId', resolvedAssignment);
        window.history.replaceState(null, '', `${url.pathname}${url.search}`);
        const candidate = preferredEnrollmentId ?? selectedEnrollmentRef.current;
        const nextEnrollment = payload.enrollments.some((item) => item.id === candidate)
          ? candidate
          : payload.enrollments[0]?.id ?? '';
        selectedEnrollmentRef.current = nextEnrollment;
        setSelectedEnrollmentId(nextEnrollment);
        setState('ready');
      }
    } catch (cause) {
      if (
        controller.signal.aborted ||
        generation !== loadGeneration.current ||
        (cause instanceof DOMException && cause.name === 'AbortError')
      ) return;
      setState('error');
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      facilityRef.current = params.get('facilityId') ?? '';
      accessAssignmentRef.current = params.get('accessAssignmentId') ?? '';
      setSelectedAccessAssignmentId(accessAssignmentRef.current);
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadAbort.current?.abort();
    };
  }, [load]);

  const enrollments = data.enrollments ?? [];
  const tasks = data.tasks ?? [];
  const eligibleBases = data.eligibleBases ?? [];
  const assignees = data.assignees ?? [];
  const capabilities = data.capabilities;
  const selectedEnrollment = enrollments.find(
    (item) => item.id === selectedEnrollmentId,
  );
  const enrollmentTasks = tasks.filter(
    (task) => task.enrollmentId === selectedEnrollmentId,
  );
  const visibleTasks = enrollmentTasks.filter(
    (task) => dueFilter === 'all' || task.current.dueState === dueFilter,
  );
  const selectedTask = tasks.find((task) => task.id === selectedTaskId);

  const counts = useMemo(
    () =>
      data.cohortCounts ?? {
        overdue: 0,
        due_soon: 0,
        current: 0,
        closed: 0,
      },
    [data.cohortCounts],
  );

  function selectAssignment(assignmentId: string) {
    if (busy || enrollmentOpen || planOpen || selectedTaskId) return;
    const assignment = assignmentOptions.find(
      (candidate) => candidate.assignmentId === assignmentId,
    );
    if (!assignment) return;
    accessAssignmentRef.current = assignment.assignmentId;
    facilityRef.current = assignment.facilityId;
    setSelectedAccessAssignmentId(assignment.assignmentId);
    selectedEnrollmentRef.current = '';
    setSelectedEnrollmentId('');
    setMessage(null);
    setOperationError(null);
    const url = new URL(window.location.href);
    url.searchParams.set('facilityId', assignment.facilityId);
    url.searchParams.set('accessAssignmentId', assignment.assignmentId);
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    void load();
  }

  function selectEnrollment(id: string) {
    selectedEnrollmentRef.current = id;
    setSelectedEnrollmentId(id);
    setSelectedTaskId('');
    setPlanOpen(false);
    setMessage(null);
    setOperationError(null);
  }

  async function postCommand<T>(
    operation: string,
    url: string,
    payload: Record<string, unknown>,
    pick: (body: Record<string, unknown>) => T | undefined,
  ) {
    if (busy || !facilityRef.current || !accessAssignmentRef.current) return null;
    const operationKey = buildChronicCareOperationKey(
      accessAssignmentRef.current,
      operation,
    );
    const idempotencyKey = commandKeys.current.get(operationKey) ?? crypto.randomUUID();
    commandKeys.current.set(operationKey, idempotencyKey);
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
          ...(accessAssignmentRef.current
            ? { accessAssignmentId: accessAssignmentRef.current }
            : {}),
          idempotencyKey,
        }),
      });
      const body = (await response.json()) as Record<string, unknown> & {
        error?: ApiError;
      };
      if (!response.ok) {
        setOperationError(errorFrom(body as ChronicCareResponse, 'Операция не выполнена.'));
        return null;
      }
      const value = pick(body);
      commandKeys.current.delete(operationKey);
      return value ?? null;
    } catch {
      setOperationError({
        code: 'OUTCOME_UNKNOWN',
        message: unknownChronicCareOutcomeMessage(),
      });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function submitEnrollment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const basis = eligibleBases.find(
      (candidate) => `${candidate.encounterId}:${candidate.protocolVersionId}` === basisId,
    );
    if (!basis) return;
    const result = await postCommand<ChronicEnrollmentRecord>(
      'enrollment-create',
      '/api/care/enrollments',
      {
        patientId: basis.patient.id,
        basisEncounterId: basis.encounterId,
        basisProtocolVersionId: basis.protocolVersionId,
        registryCode,
        diagnosisDisplay,
        diagnosisCode: diagnosisCode.trim() || null,
        diagnosisBasis,
        doctorConfirmed,
        localSourceAcknowledged,
        reason: enrollmentReason,
      },
      (body) => body.enrollment as ChronicEnrollmentRecord | undefined,
    );
    if (!result) return;
    setEnrollmentOpen(false);
    setDoctorConfirmed(false);
    setLocalSourceAcknowledged(false);
    setMessage('Решение врача сохранено. Пациент включён только в локальный тестовый регистр.');
    await load(result.id, true);
  }

  function openPlanEditor() {
    if (!selectedEnrollment) return;
    const current = selectedEnrollment.plan?.current.content;
    const nextFrom = current?.effectiveFrom ?? data.today ?? isoToday();
    setEffectiveFrom(nextFrom);
    setEffectiveTo(current?.effectiveTo ?? addDays(nextFrom, 90));
    setGoals(current?.goals.join('\n') ?? '');
    setTreatmentPlan(current?.treatmentPlan ?? '');
    setDietPlan(current?.dietPlan ?? '');
    setMedications(
      current?.medications.map((item, index) => ({
        key: `medication-${index}`,
        name: item.name,
        dose: item.dose,
        route: item.route,
        schedule: item.schedule,
        startsOn: item.startsOn,
        endsOn: item.endsOn ?? '',
        instructions: item.instructions ?? '',
      })) ?? [],
    );
    setTaskDrafts(
      current?.tasks.map((item) => ({
        ...item,
        instructions: item.instructions ?? '',
      })) ?? [newTaskDraft(assignees, nextFrom, 0)],
    );
    setPlanReason(
      selectedEnrollment.plan
        ? 'Врач подписал новую версию плана наблюдения'
        : 'Врач подписал первичный план наблюдения',
    );
    setPlanDoctorConfirmed(false);
    setPlanSourceAcknowledged(false);
    setPlanOpen(true);
  }

  async function submitPlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedEnrollment) return;
    const result = await postCommand(
      `plan-${selectedEnrollment.id}`,
      '/api/care/plans',
      {
        enrollmentId: selectedEnrollment.id,
        expectedEnrollmentVersion: selectedEnrollment.current.version,
        expectedPlanVersion: selectedEnrollment.plan?.current.version ?? null,
        content: {
          effectiveFrom,
          effectiveTo,
          goals: goals.split('\n').map((item) => item.trim()).filter(Boolean),
          treatmentPlan,
          dietPlan,
          medications: medications.map((item) => ({
            name: item.name,
            dose: item.dose,
            route: item.route,
            schedule: item.schedule,
            startsOn: item.startsOn,
            endsOn: item.endsOn || null,
            instructions: item.instructions.trim() || null,
          })),
          tasks: taskDrafts.map((item) => ({
            ...item,
            instructions: item.instructions.trim() || null,
          })),
        },
        doctorConfirmed: planDoctorConfirmed,
        localSourceAcknowledged: planSourceAcknowledged,
        reason: planReason,
      },
      (body) => body.plan,
    );
    if (!result) return;
    setPlanOpen(false);
    setMessage(
      'Подписанная версия плана сохранена. Рабочие задачи пересчитаны только из этой версии.',
    );
    await load(selectedEnrollment.id, true);
  }

  async function runTaskAction(action: TaskAction) {
    if (!selectedTask) return;
    const result = await postCommand<ChronicTaskRecord>(
      `task-${selectedTask.id}-${action}`,
      `/api/care/tasks/${encodeURIComponent(selectedTask.id)}/command`,
      {
        action,
        expectedTaskVersion: selectedTask.current.version,
        reason: taskReason,
        contactMethod: action === 'record_response' ? contactMethod : null,
        wellbeing: action === 'record_response' ? wellbeing : null,
        responseSummary: action === 'record_response' ? responseSummary : null,
        escalationReason: action === 'escalate' ? escalationReason : null,
      },
      (body) => body.task as ChronicTaskRecord | undefined,
    );
    if (!result) return;
    setMessage(`Задача обновлена: ${taskStatusLabels[result.current.status]}.`);
    setSelectedTaskId('');
    setResponseSummary('');
    setEscalationReason('');
    await load(selectedEnrollmentId, true);
  }

  if (state !== 'ready') {
    return (
      <CareState
        state={state}
        error={data.error}
        assignments={assignmentOptions}
        selectedAssignmentId={selectedAccessAssignmentId}
        onAssignment={selectAssignment}
        onRetry={() => void load()}
      />
    );
  }
  const viewerRole = data.role;
  if (!viewerRole) {
    return (
      <CareState
        state="error"
        error={{ code: 'INVALID_CHRONIC_CARE_RESPONSE', message: 'Сервер не вернул роль рабочего места.' }}
        assignments={assignmentOptions}
        selectedAssignmentId={selectedAccessAssignmentId}
        onAssignment={selectAssignment}
        onRetry={() => void load()}
      />
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Диспансерное наблюдение</span>
          <h1>Контрольные списки по подписанному плану</h1>
          <p>
            Врач подтверждает диагноз и план. Медсестра фиксирует ответ пациента и
            передаёт врачу отклонения — без автоматической постановки диагноза.
          </p>
        </div>
        <div className={styles.sourceBadge}>
          <ShieldCheck aria-hidden="true" size={20} />
          <span>
            <strong>{data.sourceLabel}</strong>
            <small>D1 · синтетические данные · внешние регистры не подключены</small>
          </span>
        </div>
      </header>

      <section className={styles.stats} aria-label="Состояние наблюдения">
        <article>
          <CircleAlert aria-hidden="true" size={20} />
          <span><strong>{counts.overdue}</strong><small>просрочено</small></span>
        </article>
        <article>
          <Clock3 aria-hidden="true" size={20} />
          <span><strong>{counts.due_soon}</strong><small>срок в течение 7 дней</small></span>
        </article>
        <article>
          <HeartPulse aria-hidden="true" size={20} />
          <span><strong>{enrollments.filter((item) => item.current.status === 'active').length}</strong><small>активных наблюдений</small></span>
        </article>
        <article>
          <MessageSquareText aria-hidden="true" size={20} />
          <span><strong>{tasks.filter((task) => task.current.status === 'escalated').length}</strong><small>ожидают решения врача</small></span>
        </article>
      </section>

      <section className={styles.toolbar}>
        <div className={styles.toolbarMeta}>
          <LockKeyhole aria-hidden="true" size={17} />
          <span>
            <strong>{data.viewer?.role === 'nurse' ? 'Рабочее место медсестры' : 'Рабочее место врача'}</strong>
            <small>{data.facility?.name} · сегодня {formatDate(data.today ?? isoToday())}</small>
          </span>
        </div>
        <div className={styles.toolbarActions}>
          {assignmentOptions.length > 1 ? (
            <select
              aria-label="Рабочий контур"
              disabled={Boolean(busy || enrollmentOpen || planOpen || selectedTaskId)}
              onChange={(event) => selectAssignment(event.target.value)}
              value={selectedAccessAssignmentId}
            >
              {assignmentOptions.map((assignment) => (
                <option key={assignment.assignmentId} value={assignment.assignmentId}>
                  {assignment.facilityName} · {assignment.departmentName} · {assignment.role === 'nurse' ? 'медсестра' : 'врач'}
                </option>
              ))}
            </select>
          ) : null}
          <button className={styles.secondaryButton} onClick={() => void load(selectedEnrollmentId)} type="button">
            <RefreshCw aria-hidden="true" size={16} /> Обновить
          </button>
          {capabilities?.['enrollment.confirm'] ? (
            <button
              className={styles.primaryButton}
              disabled={eligibleBases.length === 0}
              onClick={() => {
                const first = eligibleBases[0];
                setBasisId(first ? `${first.encounterId}:${first.protocolVersionId}` : '');
                setEnrollmentOpen(true);
              }}
              type="button"
            >
              <Plus aria-hidden="true" size={17} /> Включить пациента
            </button>
          ) : null}
        </div>
      </section>

      {message ? (
        <div className={styles.successMessage} role="status">
          <CheckCircle2 aria-hidden="true" size={18} />
          <span>{message}</span>
          <button aria-label="Закрыть сообщение" onClick={() => setMessage(null)} type="button"><X size={17} /></button>
        </div>
      ) : null}
      {operationError ? (
        <div className={styles.errorMessage} role="alert">
          <AlertTriangle aria-hidden="true" size={18} />
          <span>{operationError.message}<small>{operationError.requestId ?? operationError.code}</small></span>
          <button aria-label="Закрыть ошибку" onClick={() => setOperationError(null)} type="button"><X size={17} /></button>
        </div>
      ) : null}

      <section className={styles.workspace}>
        <aside className={styles.registryList}>
          <header>
            <span><strong>{enrollments.length}</strong><small>пациентов</small></span>
            <UserRoundCheck aria-hidden="true" size={18} />
          </header>
          {enrollments.length === 0 ? (
            <div className={styles.emptyList}>
              <UsersRound aria-hidden="true" size={24} />
              <strong>Наблюдений пока нет</strong>
              <p>Врач может включить пациента только по текущему подписанному протоколу.</p>
            </div>
          ) : (
            enrollments.map((enrollment) => {
              const open = tasks.filter(
                (task) =>
                  task.enrollmentId === enrollment.id &&
                  !['completed', 'cancelled'].includes(task.current.status),
              );
              const urgent = open.filter(
                (task) => task.current.dueState === 'overdue' || task.current.status === 'escalated',
              ).length;
              return (
                <button
                  className={joinClass(
                    styles.registryCard,
                    selectedEnrollmentId === enrollment.id && styles.registryCardActive,
                  )}
                  key={enrollment.id}
                  onClick={() => selectEnrollment(enrollment.id)}
                  type="button"
                >
                  <span className={styles.registryCode}>{enrollment.registryCode}</span>
                  <strong>{enrollment.patient.displayName}</strong>
                  <small>{enrollment.patient.medicalRecordNumber}</small>
                  <span className={styles.cardMeta}>
                    {urgent > 0 ? <b>{urgent} требуют внимания</b> : <span>{open.length} открытых задач</span>}
                  </span>
                  <ChevronRight className={styles.cardArrow} aria-hidden="true" size={17} />
                </button>
              );
            })
          )}
        </aside>

        <section className={styles.detail}>
          {selectedEnrollment ? (
            <>
              <header className={styles.detailHeader}>
                <div>
                  <span className={styles.eyebrow}>Карточка наблюдения</span>
                  <h2>{selectedEnrollment.patient.displayName}</h2>
                  <p>{selectedEnrollment.current.diagnosisDisplay}</p>
                </div>
                <div className={styles.patientIdentity}>
                  <Stethoscope aria-hidden="true" size={19} />
                  <span>
                    <strong>{selectedEnrollment.managingClinician}</strong>
                    <small>ответственный врач · v{selectedEnrollment.current.version}</small>
                  </span>
                </div>
              </header>

              <div className={styles.recordGrid}>
                <article>
                  <span>Основание</span>
                  <strong>Подписанный протокол</strong>
                  <small>{selectedEnrollment.current.basisProtocolVersionId}</small>
                </article>
                <article>
                  <span>Диагноз подтвердил</span>
                  <strong>Врач</strong>
                  <small>{formatTimestamp(selectedEnrollment.current.decidedAt)}</small>
                </article>
                <article>
                  <span>Источник</span>
                  <strong>Локальный тестовый D1</strong>
                  <small>не ЭРДБ / не ПУЗ</small>
                </article>
                <article>
                  <span>План</span>
                  <strong>{selectedEnrollment.plan ? `Подписан · v${selectedEnrollment.plan.current.version}` : 'Не подписан'}</strong>
                  <small>{selectedEnrollment.plan ? formatTimestamp(selectedEnrollment.plan.current.signedAt) : 'Задачи не создаются'}</small>
                </article>
              </div>

              <section className={styles.planSummary}>
                <header>
                  <div>
                    <span className={styles.eyebrow}>Решение врача</span>
                    <h3>План наблюдения</h3>
                  </div>
                  {capabilities?.['plan.sign'] ? (
                    <button className={styles.secondaryButton} onClick={openPlanEditor} type="button">
                      <FilePenLine aria-hidden="true" size={16} />
                      {selectedEnrollment.plan ? 'Новая версия' : 'Составить план'}
                    </button>
                  ) : null}
                </header>
                {selectedEnrollment.plan ? (
                  <div className={styles.planContent}>
                    <div>
                      <small>Период</small>
                      <strong>{formatDate(selectedEnrollment.plan.current.content.effectiveFrom)} — {formatDate(selectedEnrollment.plan.current.content.effectiveTo)}</strong>
                    </div>
                    <div>
                      <small>Цели</small>
                      <ul>{selectedEnrollment.plan.current.content.goals.map((goal) => <li key={goal}>{goal}</li>)}</ul>
                    </div>
                    <div>
                      <small>Лекарственный раздел</small>
                      <strong>{selectedEnrollment.plan.current.content.medications.length > 0 ? `${selectedEnrollment.plan.current.content.medications.length} позиций, подписано врачом` : 'Врач не указал препараты'}</strong>
                    </div>
                    <div>
                      <small>Контрольные действия</small>
                      <strong>{selectedEnrollment.plan.current.content.tasks.length} задач из этой версии</strong>
                    </div>
                  </div>
                ) : (
                  <div className={styles.emptyPlan}>
                    <ClipboardCheck aria-hidden="true" size={24} />
                    <div><strong>План ещё не подписан</strong><p>До подписи врача рабочие задачи и напоминания не создаются.</p></div>
                  </div>
                )}
              </section>

              <section className={styles.taskSection}>
                <header>
                  <div>
                    <span className={styles.eyebrow}>Рабочий список</span>
                    <h3>Задачи из подписанного плана</h3>
                  </div>
                  <select aria-label="Фильтр срока" value={dueFilter} onChange={(event) => setDueFilter(event.target.value as ChronicDueState | 'all')}>
                    <option value="all">Все задачи</option>
                    <option value="overdue">Просрочено</option>
                    <option value="due_soon">Срок подходит</option>
                    <option value="current">По плану</option>
                    <option value="closed">Закрыто</option>
                  </select>
                </header>
                {visibleTasks.length === 0 ? (
                  <div className={styles.emptyTasks}>Нет задач для выбранного фильтра.</div>
                ) : (
                  <div className={styles.taskList}>
                    {visibleTasks.map((task) => {
                      const actions = capabilities
                        ? allowedCareTaskActions(task, capabilities, viewerRole)
                        : [];
                      return (
                        <article className={styles.taskCard} key={task.id}>
                          <div className={styles.taskTopline}>
                            <span className={joinClass(styles.dueBadge, styles[`due_${task.current.dueState}`])}>{dueLabels[task.current.dueState]}</span>
                            <span className={styles.statusBadge}>{taskStatusLabels[task.current.status]}</span>
                          </div>
                          <h4>{task.title}</h4>
                          <p>{task.current.inclusionReason}</p>
                          <dl>
                            <div><dt>Срок</dt><dd>{formatDate(task.current.dueDate)}</dd></div>
                            <div><dt>Ответственный</dt><dd>{task.assignedTo} · {task.ownerRole === 'nurse' ? 'медсестра' : 'врач'}</dd></div>
                            <div><dt>Источник</dt><dd>план v{selectedEnrollment.plan?.current.version ?? '—'} · {task.blueprintKey}</dd></div>
                          </dl>
                          {task.current.responseSummary ? (
                            <div className={styles.responseNote}>
                              <strong>Ответ пациента · {task.current.contactMethod ? contactLabels[task.current.contactMethod] : '—'}</strong>
                              <p>{task.current.responseSummary}</p>
                              <small>{task.current.wellbeing ? wellbeingLabels[task.current.wellbeing] : ''}</small>
                            </div>
                          ) : null}
                          {task.current.escalationReason ? (
                            <div className={styles.escalationNote}>
                              <strong>Передано врачу</strong>
                              <p>{task.current.escalationReason}</p>
                            </div>
                          ) : null}
                          {actions.length > 0 ? (
                            <button className={styles.taskButton} onClick={() => {
                              setSelectedTaskId(task.id);
                              setTaskReason('Статус подтверждён сотрудником');
                              setResponseSummary('');
                              setEscalationReason('');
                            }} type="button">
                              Открыть действия <ChevronRight aria-hidden="true" size={15} />
                            </button>
                          ) : null}
                        </article>
                      );
                    })}
                  </div>
                )}
              </section>
            </>
          ) : (
            <div className={styles.emptyDetail}>
              <HeartPulse aria-hidden="true" size={30} />
              <h2>Выберите наблюдение</h2>
              <p>Здесь появятся подписанный план, сроки и рабочие задачи.</p>
            </div>
          )}
        </section>
      </section>

      <section className={styles.externalBoundary}>
        <header><ShieldCheck aria-hidden="true" size={18} /><strong>Внешние действия не имитируются</strong></header>
        <div>
          {(data.externalBlocks ?? []).map((item) => (
            <span key={item.code}><b>{item.code}</b>{item.label}<small>Не подключено</small></span>
          ))}
        </div>
      </section>

      {enrollmentOpen ? (
        <div className={styles.overlay} role="presentation">
          <form className={styles.dialog} onSubmit={submitEnrollment}>
            <header><div><span className={styles.eyebrow}>Только врач</span><h2>Подтвердить наблюдение</h2></div><button aria-label="Закрыть" onClick={() => setEnrollmentOpen(false)} type="button"><X size={19} /></button></header>
            <div className={styles.formGrid}>
              <label className={styles.full}><span>Пациент и подписанный протокол</span><select required value={basisId} onChange={(event) => setBasisId(event.target.value)}>{eligibleBases.map((basis) => <option key={`${basis.encounterId}:${basis.protocolVersionId}`} value={`${basis.encounterId}:${basis.protocolVersionId}`}>{basis.patient.displayName} · {basis.patient.medicalRecordNumber} · протокол v{basis.protocolVersion}</option>)}</select></label>
              <label><span>Код локального регистра</span><input required value={registryCode} onChange={(event) => setRegistryCode(event.target.value.toUpperCase())} /></label>
              <label><span>Код диагноза <small>необязательно</small></span><input value={diagnosisCode} onChange={(event) => setDiagnosisCode(event.target.value)} /></label>
              <label className={styles.full}><span>Диагноз, подтверждённый врачом</span><input minLength={3} required value={diagnosisDisplay} onChange={(event) => setDiagnosisDisplay(event.target.value)} /></label>
              <label className={styles.full}><span>Основание решения врача</span><textarea minLength={10} required rows={3} value={diagnosisBasis} onChange={(event) => setDiagnosisBasis(event.target.value)} /></label>
              <label className={styles.full}><span>Причина записи</span><input minLength={3} required value={enrollmentReason} onChange={(event) => setEnrollmentReason(event.target.value)} /></label>
            </div>
            <label className={styles.confirmCheck}><input checked={doctorConfirmed} onChange={(event) => setDoctorConfirmed(event.target.checked)} required type="checkbox" /><span><strong>Я, врач, подтверждаю диагноз и решение о наблюдении</strong><small>ORION не принимает это решение автоматически.</small></span></label>
            <label className={styles.confirmCheck}><input checked={localSourceAcknowledged} onChange={(event) => setLocalSourceAcknowledged(event.target.checked)} required type="checkbox" /><span><strong>Понимаю: это локальный тестовый регистр</strong><small>Запись не отправляется в ЭРДБ или ПУЗ.</small></span></label>
            <footer><button className={styles.secondaryButton} onClick={() => setEnrollmentOpen(false)} type="button">Отмена</button><button className={styles.primaryButton} disabled={Boolean(busy)} type="submit">{busy === 'enrollment-create' ? <LoaderCircle className={styles.spin} size={17} /> : <Check size={17} />} Сохранить решение врача</button></footer>
          </form>
        </div>
      ) : null}

      {planOpen && selectedEnrollment ? (
        <div className={styles.overlay} role="presentation">
          <form className={joinClass(styles.dialog, styles.planDialog)} onSubmit={submitPlan}>
            <header><div><span className={styles.eyebrow}>Неизменяемая версия</span><h2>Подписать план наблюдения</h2></div><button aria-label="Закрыть" onClick={() => setPlanOpen(false)} type="button"><X size={19} /></button></header>
            <div className={styles.formGrid}>
              <label><span>Действует с</span><input required type="date" value={effectiveFrom} onChange={(event) => setEffectiveFrom(event.target.value)} /></label>
              <label><span>Действует до</span><input min={effectiveFrom} required type="date" value={effectiveTo} onChange={(event) => setEffectiveTo(event.target.value)} /></label>
              <label className={styles.full}><span>Цели <small>каждая с новой строки</small></span><textarea minLength={3} required rows={3} value={goals} onChange={(event) => setGoals(event.target.value)} /></label>
              <label className={styles.full}><span>План лечения и мероприятий</span><textarea minLength={10} required rows={4} value={treatmentPlan} onChange={(event) => setTreatmentPlan(event.target.value)} /></label>
              <label className={styles.full}><span>План питания / коррекции образа жизни</span><textarea minLength={10} required rows={3} value={dietPlan} onChange={(event) => setDietPlan(event.target.value)} /></label>
            </div>
            <EditorSection title="Лекарственный раздел" hint="Только врач указывает и подписывает; ORION не предлагает препараты автоматически." onAdd={() => setMedications((current) => [...current, { key: `medication-${Date.now()}`, name: '', dose: '', route: '', schedule: '', startsOn: effectiveFrom, endsOn: '', instructions: '' }])}>
              {medications.length === 0 ? <p className={styles.editorEmpty}>Препараты не указаны врачом.</p> : medications.map((medication, index) => <div className={styles.editorCard} key={medication.key}><button aria-label="Удалить препарат" className={styles.removeButton} onClick={() => setMedications((current) => current.filter((item) => item.key !== medication.key))} type="button"><Trash2 size={15} /></button><div className={styles.formGrid}><label><span>Название</span><input required value={medication.name} onChange={(event) => setMedications((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item))} /></label><label><span>Доза</span><input required value={medication.dose} onChange={(event) => setMedications((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, dose: event.target.value } : item))} /></label><label><span>Путь введения</span><input required value={medication.route} onChange={(event) => setMedications((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, route: event.target.value } : item))} /></label><label><span>Режим</span><input required value={medication.schedule} onChange={(event) => setMedications((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, schedule: event.target.value } : item))} /></label><label><span>Начало</span><input required type="date" value={medication.startsOn} onChange={(event) => setMedications((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, startsOn: event.target.value } : item))} /></label><label><span>Окончание</span><input type="date" value={medication.endsOn} onChange={(event) => setMedications((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, endsOn: event.target.value } : item))} /></label><label className={styles.full}><span>Инструкции</span><input value={medication.instructions} onChange={(event) => setMedications((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, instructions: event.target.value } : item))} /></label></div></div>)}
            </EditorSection>
            <EditorSection title="Контрольные задачи" hint="Каждая задача обязана иметь срок, владельца и источник — эту подписанную версию плана." onAdd={() => setTaskDrafts((current) => [...current, newTaskDraft(assignees, effectiveFrom, current.length)])}>
              {taskDrafts.map((task, index) => <div className={styles.editorCard} key={task.key}><button aria-label="Удалить задачу" className={styles.removeButton} disabled={taskDrafts.length === 1} onClick={() => setTaskDrafts((current) => current.filter((item) => item.key !== task.key))} type="button"><Trash2 size={15} /></button><div className={styles.formGrid}><label><span>Тип задачи</span><select value={task.kind} onChange={(event) => setTaskDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, kind: event.target.value as ChronicTaskKind } : item))}>{Object.entries(taskKindLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Срок</span><input min={effectiveFrom} max={effectiveTo} required type="date" value={task.dueDate} onChange={(event) => setTaskDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, dueDate: event.target.value } : item))} /></label><label className={styles.full}><span>Название</span><input minLength={3} required value={task.title} onChange={(event) => setTaskDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, title: event.target.value } : item))} /></label><label><span>Роль владельца</span><select value={task.ownerRole} onChange={(event) => { const role = event.target.value as ChronicTaskOwnerRole; const assignee = assignees.find((candidate) => candidate.role === role); setTaskDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ownerRole: role, assignedMembershipId: assignee?.membershipId ?? '' } : item)); }}><option value="nurse">Медсестра</option><option value="clinician">Врач</option></select></label><label><span>Ответственный</span><select required value={task.assignedMembershipId} onChange={(event) => setTaskDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, assignedMembershipId: event.target.value } : item))}>{assignees.filter((candidate) => candidate.role === task.ownerRole).map((assignee) => <option key={assignee.membershipId} value={assignee.membershipId}>{assignee.displayName}</option>)}</select></label><label className={styles.full}><span>Инструкция</span><textarea rows={2} value={task.instructions} onChange={(event) => setTaskDrafts((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, instructions: event.target.value } : item))} /></label></div></div>)}
            </EditorSection>
            <label className={styles.formLabel}><span>Причина новой версии</span><input minLength={3} required value={planReason} onChange={(event) => setPlanReason(event.target.value)} /></label>
            <label className={styles.confirmCheck}><input checked={planDoctorConfirmed} onChange={(event) => setPlanDoctorConfirmed(event.target.checked)} required type="checkbox" /><span><strong>Я, врач, проверил и подписываю весь план</strong><small>Включая лекарственный раздел, сроки и исполнителей.</small></span></label>
            <label className={styles.confirmCheck}><input checked={planSourceAcknowledged} onChange={(event) => setPlanSourceAcknowledged(event.target.checked)} required type="checkbox" /><span><strong>Понимаю границу локального тестового контура</strong><small>План не отправляется во внешние регистры и не запускает уведомления.</small></span></label>
            <footer><button className={styles.secondaryButton} onClick={() => setPlanOpen(false)} type="button">Отмена</button><button className={styles.primaryButton} disabled={Boolean(busy)} type="submit">{busy?.startsWith('plan-') ? <LoaderCircle className={styles.spin} size={17} /> : <ShieldCheck size={17} />} Подписать неизменяемую версию</button></footer>
          </form>
        </div>
      ) : null}

      {selectedTask && capabilities ? (
        <div className={styles.overlay} role="presentation">
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-label="Действия с задачей">
            <header><div><span className={styles.eyebrow}>{taskStatusLabels[selectedTask.current.status]}</span><h2>{selectedTask.title}</h2></div><button aria-label="Закрыть" onClick={() => setSelectedTaskId('')} type="button"><X size={19} /></button></header>
            <div className={styles.taskContext}><CalendarDays size={18} /><span><strong>Срок {formatDate(selectedTask.current.dueDate)}</strong><small>{selectedTask.current.inclusionReason}</small></span></div>
            <label className={styles.formLabel}><span>Основание действия</span><input minLength={3} required value={taskReason} onChange={(event) => setTaskReason(event.target.value)} /></label>
            {allowedCareTaskActions(selectedTask, capabilities, viewerRole).includes('record_response') ? <div className={styles.responseForm}><h3>Структурированный ответ пациента</h3><div className={styles.formGrid}><label><span>Способ контакта</span><select value={contactMethod} onChange={(event) => setContactMethod(event.target.value as ContactMethod)}>{Object.entries(contactLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span>Самочувствие со слов пациента</span><select value={wellbeing} onChange={(event) => setWellbeing(event.target.value as WellbeingState)}>{Object.entries(wellbeingLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label className={styles.full}><span>Ответ пациента</span><textarea minLength={3} rows={3} value={responseSummary} onChange={(event) => setResponseSummary(event.target.value)} /></label></div><button className={styles.secondaryButton} disabled={Boolean(busy) || responseSummary.trim().length < 3} onClick={() => void runTaskAction('record_response')} type="button"><MessageSquareText size={16} /> Записать ответ</button></div> : null}
            {allowedCareTaskActions(selectedTask, capabilities, viewerRole).includes('escalate') ? <div className={styles.escalationForm}><label className={styles.formLabel}><span>Причина передачи врачу</span><textarea minLength={3} rows={2} value={escalationReason} onChange={(event) => setEscalationReason(event.target.value)} /></label><button className={styles.warningButton} disabled={Boolean(busy) || escalationReason.trim().length < 3} onClick={() => void runTaskAction('escalate')} type="button"><CircleAlert size={16} /> Передать врачу</button></div> : null}
            <footer className={styles.actionFooter}>{allowedCareTaskActions(selectedTask, capabilities, viewerRole).includes('start') ? <button className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => void runTaskAction('start')} type="button">Начать работу</button> : null}{allowedCareTaskActions(selectedTask, capabilities, viewerRole).includes('complete') ? <button className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => void runTaskAction('complete')} type="button"><Check size={16} /> Завершить</button> : null}{allowedCareTaskActions(selectedTask, capabilities, viewerRole).includes('resolve') ? <button className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => void runTaskAction('resolve')} type="button"><UserRoundCheck size={16} /> Решение врача принято</button> : null}{allowedCareTaskActions(selectedTask, capabilities, viewerRole).includes('cancel') ? <button className={styles.dangerButton} disabled={Boolean(busy)} onClick={() => void runTaskAction('cancel')} type="button">Отменить задачу</button> : null}</footer>
          </section>
        </div>
      ) : null}
    </main>
  );
}

function EditorSection({
  title,
  hint,
  onAdd,
  children,
}: {
  title: string;
  hint: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className={styles.editorSection}>
      <header><div><h3>{title}</h3><p>{hint}</p></div><button className={styles.secondaryButton} onClick={onAdd} type="button"><Plus size={16} /> Добавить</button></header>
      {children}
    </section>
  );
}

function CareState({
  state,
  error,
  assignments,
  selectedAssignmentId,
  onAssignment,
  onRetry,
}: {
  state: LoadState;
  error?: ApiError;
  assignments: AccessAssignmentOption[];
  selectedAssignmentId: string;
  onAssignment: (assignmentId: string) => void;
  onRetry: () => void;
}) {
  const content = {
    loading: ['Загружаем наблюдение', 'Читаем подписанные планы и рабочие задачи из D1.'],
    assignment: ['Выберите рабочий контур', 'Назначения по отделениям не объединяются. Роль и права берутся только из выбранного контура.'],
    unauthenticated: ['Требуется вход', 'Откройте ORION Clinic через авторизованный контур.'],
    forbidden: ['Нет доступа', 'Выбранное назначение недоступно. Откройте «Наблюдение» в меню, чтобы выбрать действующий рабочий контур.'],
    error: ['Наблюдение временно недоступно', error?.message ?? 'Проверьте локальную базу и повторите.'],
    ready: ['', ''],
  }[state];
  return (
    <main className={styles.statePanel}>
      {state === 'loading' ? <LoaderCircle className={styles.spin} size={28} /> : <CircleAlert size={28} />}
      <span className={styles.eyebrow}>Безопасная остановка</span>
      <h1>{content[0]}</h1>
      <p>{content[1]}</p>
      {state === 'assignment' ? <select aria-label="Рабочий контур" value={selectedAssignmentId} onChange={(event) => onAssignment(event.target.value)}><option value="">Выберите назначение</option>{assignments.map((assignment) => <option key={assignment.assignmentId} value={assignment.assignmentId}>{assignment.organizationName} · {assignment.facilityName} · {assignment.departmentName} · {assignment.role === 'nurse' ? 'медсестра' : 'врач'}</option>)}</select> : null}
      {state === 'error' ? <button className={styles.primaryButton} onClick={onRetry} type="button"><RefreshCw size={16} /> Повторить</button> : null}
    </main>
  );
}
