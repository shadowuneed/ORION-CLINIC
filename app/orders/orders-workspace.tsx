'use client';

import { OrionMark } from '@/app/brand/orion-brand';
import { orderActionBlocker } from '@/lib/workspace-ux';
import { chatGPTSignInPath } from '@/lib/auth/chatgpt-navigation';

import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowDownToLine,
  Check,
  CheckCircle2,
  ChevronRight,
  CirclePause,
  ClipboardList,
  FileCheck2,
  FileClock,
  FilePlus2,
  FlaskConical,
  History,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  UserRound,
  X,
} from 'lucide-react';
import type {
  OrderEncounterOption,
  ServiceRequestRecord,
} from '@/lib/repositories/order-workflow';
import {
  allowedNextDiagnosticReportStatuses,
  type DiagnosticReviewState,
  type ServiceRequestKind,
  type ServiceRequestStatus,
} from '@/lib/domain/orders';
import styles from './orders.module.css';

type AccessAssignmentOption = {
  assignmentId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  departmentName: string;
};

type OrdersResponse = {
  organization?: { id: string; name: string };
  facility?: { id: string; name: string };
  accessAssignment?: { assignmentId: string };
  assignments?: AccessAssignmentOption[];
  orders?: ServiceRequestRecord[];
  encounters?: OrderEncounterOption[];
  recommendationSource?: RecommendationTransferSource | null;
  error?: ApiError;
};

type RecommendationTransferSelection = {
  encounterId: string;
  recommendationId: string;
  recommendationVersion: number;
};

type RecommendationTransferSource = RecommendationTransferSelection & {
  reviewDecisionId: string;
  derivativeVersionId: string | null;
  title: string;
  medicalJustification: string;
  state: 'accepted' | 'edited_and_accepted';
  existingOrderId: string | null;
};

export function readRecommendationTransfer(params: URLSearchParams): RecommendationTransferSelection | null | 'invalid' {
  if (!params.has('recommendationId') && !params.has('recommendationVersion')) return null;
  const encounterId = params.get('encounterId')?.trim();
  const recommendationId = params.get('recommendationId')?.trim();
  const rawVersion = params.get('recommendationVersion') ?? '';
  const recommendationVersion = Number(rawVersion);
  if (!encounterId || !recommendationId || !/^[1-9]\d*$/.test(rawVersion) || !Number.isSafeInteger(recommendationVersion)) return 'invalid';
  return { encounterId, recommendationId, recommendationVersion };
}

export function matchesRecommendationTransfer(selection: RecommendationTransferSelection, source: RecommendationTransferSource | null | undefined) {
  return Boolean(source && source.encounterId === selection.encounterId && source.recommendationId === selection.recommendationId
    && source.recommendationVersion === selection.recommendationVersion && source.reviewDecisionId
    && ['accepted', 'edited_and_accepted'].includes(source.state));
}

export function orderRequestHref(requestId: string, facilityId: string, accessAssignmentId: string) {
  const params = new URLSearchParams(buildOrderAccessQuery(facilityId, accessAssignmentId));
  params.set('requestId', requestId);
  return `/orders?${params.toString()}`;
}

export function recommendationTransferConflict(
  status: number,
  code: string | undefined,
  selection: RecommendationTransferSelection | null | 'invalid',
  facilityId: string,
  accessAssignmentId: string,
) {
  if (status !== 409 || code !== 'ORDER_COMMAND_CONFLICT' || !selection || selection === 'invalid') return null;
  const params = new URLSearchParams(buildOrderAccessQuery(facilityId, accessAssignmentId));
  params.set('encounterId', selection.encounterId);
  return {
    message: 'Выбранная версия рекомендации изменилась или больше недоступна для переноса. Вернитесь в этот приём, проверьте актуальное решение врача и откройте принятую рекомендацию заново. На этом шаге направление не создавалось.',
    href: `/?${params.toString()}`,
  };
}

type ApiError = {
  code: string;
  message: string;
  requestId?: string;
  details?: { assignments?: AccessAssignmentOption[] };
};

type LoadState =
  | 'loading'
  | 'ready'
  | 'assignment'
  | 'unauthenticated'
  | 'forbidden'
  | 'error';

type OrderAction =
  | 'approve'
  | 'hold'
  | 'resume'
  | 'revoke'
  | 'complete'
  | 'mark_error';

type UncertainOperation = 'action' | 'upload' | 'review';

const statusLabels: Record<ServiceRequestStatus, string> = {
  draft: 'Черновик',
  active: 'Подтверждено',
  on_hold: 'Приостановлено',
  revoked: 'Отозвано',
  completed: 'Завершено',
  entered_in_error: 'Ошибочная запись',
};

const kindLabels: Record<ServiceRequestKind, string> = {
  laboratory: 'Лаборатория',
  ecg: 'ЭКГ',
  service: 'Услуга',
  referral: 'Специалист',
};

const priorityLabels = {
  routine: 'Планово',
  urgent: 'Срочно',
  asap: 'Как можно скорее',
  stat: 'Немедленно',
};

const reportStatusLabels = {
  registered: 'Зарегистрирован',
  preliminary: 'Предварительный',
  final: 'Финальный',
  amended: 'Дополненный',
  corrected: 'Исправленный',
  cancelled: 'Отменён',
  entered_in_error: 'Ошибочный',
};

const reviewLabels = {
  pending: 'Ожидает проверки врача',
  reviewed: 'Проверен врачом',
  needs_reconciliation: 'Нужно устранить расхождение',
};

const actionLabels: Record<OrderAction, string> = {
  approve: 'Подтвердить направление',
  hold: 'Приостановить',
  resume: 'Возобновить',
  revoke: 'Отозвать',
  complete: 'Завершить',
  mark_error: 'Отметить ошибочной',
};

export function unknownOutcomeMessage(operation: UncertainOperation) {
  const subject = ({
    action: 'действия',
    upload: 'загрузки файла',
    review: 'решения врача',
  } satisfies Record<UncertainOperation, string>)[operation];

  return `Связь прервалась. Исход ${subject} неизвестен: сервер мог сохранить изменение. Обновите направление. Если изменение не появилось, повторите операцию — будет использован тот же ключ защиты от дублей.`;
}

export function canShowDiagnosticReviewControls(
  requestStatus: ServiceRequestStatus,
  reviewState: DiagnosticReviewState,
) {
  return (
    reviewState === 'pending' &&
    requestStatus !== 'revoked' &&
    requestStatus !== 'entered_in_error'
  );
}

export function buildOrderAccessQuery(
  facilityId: string,
  accessAssignmentId: string,
) {
  const params = new URLSearchParams();
  if (facilityId) params.set('facilityId', facilityId);
  if (accessAssignmentId) {
    params.set('accessAssignmentId', accessAssignmentId);
  }
  const query = params.toString();
  return query ? `?${query}` : '';
}

export function buildScopedOperationKey(
  accessAssignmentId: string,
  ...parts: Array<string | number | null | undefined>
) {
  return [accessAssignmentId || 'unselected', ...parts.map(String)].join('|');
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

export function OrdersWorkspace() {
  const [state, setState] = useState<LoadState>('loading');
  const [data, setData] = useState<OrdersResponse>({});
  const [selectedId, setSelectedId] = useState('');
  const [openedRequestId, setOpenedRequestId] = useState('');
  const [selectedAccessAssignmentId, setSelectedAccessAssignmentId] = useState('');
  const [assignmentOptions, setAssignmentOptions] = useState<AccessAssignmentOption[]>([]);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState<ServiceRequestStatus | 'all'>('all');
  const [kind, setKind] = useState<ServiceRequestKind | 'all'>('all');
  const [createOpen, setCreateOpen] = useState(false);
  const [createKind, setCreateKind] = useState<ServiceRequestKind | ''>('laboratory');
  const [createFromRecommendation, setCreateFromRecommendation] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<ApiError | null>(null);
  const [sourceConflictHref, setSourceConflictHref] = useState('');
  const [actionReason, setActionReason] = useState('');
  const [reviewNote, setReviewNote] = useState('');
  const [selectedFileName, setSelectedFileName] = useState('');

  const facilityRef = useRef('');
  const accessAssignmentRef = useRef('');
  const statusRef = useRef<ServiceRequestStatus | 'all'>('all');
  const kindRef = useRef<ServiceRequestKind | 'all'>('all');
  const queryRef = useRef('');
  const selectedIdRef = useRef('');
  const createKeys = useRef(new Map<string, string>());
  const actionKeys = useRef(new Map<string, string>());
  const uploadKeys = useRef(new Map<string, string>());
  const reviewKeys = useRef(new Map<string, string>());
  const loadAbort = useRef<AbortController | null>(null);
  const loadGeneration = useRef(0);
  const transferSelection = useRef<RecommendationTransferSelection | null | 'invalid'>(null);
  const requestedOrderId = useRef('');

  const selectOrder = useCallback((orderId: string) => {
    if (selectedIdRef.current !== orderId) {
      setActionReason('');
      setReviewNote('');
      setSelectedFileName('');
      setMessage(null);
      setOperationError(null);
    }
    selectedIdRef.current = orderId;
    setSelectedId(orderId);
  }, []);

  const load = useCallback(async (preferredId?: string) => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    setState('loading');
    setSourceConflictHref('');
    setCreateOpen(false);
    setSelectedFileName('');
    try {
      if (transferSelection.current === 'invalid') {
        setData({ error: { code: 'INVALID_SOURCE', message: 'Ссылка на рекомендацию неполная. Вернитесь в приём и откройте принятую рекомендацию заново.' } });
        setState('error');
        return;
      }
      const params = new URLSearchParams({
        status: statusRef.current,
        kind: kindRef.current,
        limit: '100',
      });
      if (facilityRef.current) params.set('facilityId', facilityRef.current);
      if (accessAssignmentRef.current) {
        params.set('accessAssignmentId', accessAssignmentRef.current);
      }
      if (queryRef.current) params.set('query', queryRef.current);
      if (transferSelection.current) {
        const transfer = transferSelection.current;
        params.set('encounterId', transfer.encounterId);
        params.set('recommendationId', transfer.recommendationId);
        params.set('recommendationVersion', String(transfer.recommendationVersion));
      }
      const requestedId = preferredId ?? requestedOrderId.current;
      if (requestedId) params.set('requestId', requestedId);
      const response = await fetch(`/api/orders?${params.toString()}`, {
        cache: 'no-store',
        credentials: 'same-origin',
        signal: controller.signal,
      });
      const payload = (await response.json()) as OrdersResponse;
      if (controller.signal.aborted || generation !== loadGeneration.current) {
        return;
      }
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
      } else if (!response.ok || !payload.orders || !payload.encounters) {
        const conflict = recommendationTransferConflict(response.status, payload.error?.code, transferSelection.current, facilityRef.current, accessAssignmentRef.current);
        if (conflict) {
          setData({ ...payload, error: { ...payload.error!, message: conflict.message } });
          setSourceConflictHref(conflict.href);
        }
        setState('error');
      } else if (transferSelection.current && !matchesRecommendationTransfer(transferSelection.current, payload.recommendationSource)) {
        setData({ error: { code: 'SOURCE_NOT_VERIFIED', message: 'Сервер не подтвердил выбранную версию рекомендации. Откройте приём и проверьте её актуальное решение.' } });
        setState('error');
      } else if (requestedId && !payload.orders.some(order => order.id === requestedId)) {
        setData({ error: { code: 'ORDER_NOT_FOUND', message: 'Направление из ссылки не найдено в выбранном рабочем доступе. Другая запись вместо него не открыта.' } });
        setState('error');
      } else {
        const resolvedFacility = payload.facility?.id ?? facilityRef.current;
        const resolvedAssignment =
          payload.accessAssignment?.assignmentId ?? accessAssignmentRef.current;
        facilityRef.current = resolvedFacility;
        accessAssignmentRef.current = resolvedAssignment;
        setSelectedAccessAssignmentId(resolvedAssignment);
        setAssignmentOptions(payload.assignments ?? []);
        setOpenedRequestId(requestedId);
        const candidate = requestedId || (payload.recommendationSource ? payload.recommendationSource.existingOrderId ?? '' : selectedIdRef.current);
        selectOrder(
          payload.orders.some((order) => order.id === candidate)
            ? candidate
            : payload.recommendationSource ? '' : payload.orders[0]?.id ?? '',
        );
        setState('ready');
      }
    } catch (error) {
      if (
        !controller.signal.aborted &&
        generation === loadGeneration.current &&
        !(error instanceof DOMException && error.name === 'AbortError')
      ) {
        setState('error');
      }
    }
  }, [selectOrder]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const params = new URLSearchParams(window.location.search);
      facilityRef.current = params.get('facilityId') ?? '';
      accessAssignmentRef.current = params.get('accessAssignmentId') ?? '';
      transferSelection.current = readRecommendationTransfer(params);
      requestedOrderId.current = params.get('requestId') ?? '';
      setSelectedAccessAssignmentId(accessAssignmentRef.current);
      void load();
    }, 0);
    return () => {
      window.clearTimeout(timer);
      loadAbort.current?.abort();
      loadGeneration.current += 1;
    };
  }, [load]);

  const orders = data.orders ?? [];
  const encounters = data.encounters ?? [];
  const selected = orders.find((order) => order.id === selectedId) ?? null;
  const transferSource = state === 'ready' ? data.recommendationSource ?? null : null;
  const formSource = createFromRecommendation ? transferSource : null;

  function assignmentQuery() {
    return buildOrderAccessQuery(
      facilityRef.current,
      accessAssignmentRef.current,
    );
  }

  function selectAssignment(assignmentId: string) {
    if (busy) return;
    const assignment = assignmentOptions.find(
      (candidate) => candidate.assignmentId === assignmentId,
    );
    if (!assignment) return;
    accessAssignmentRef.current = assignment.assignmentId;
    facilityRef.current = assignment.facilityId;
    setSelectedAccessAssignmentId(assignment.assignmentId);
    setCreateOpen(false);
    setCreateFromRecommendation(false);
    setData({});
    const url = new URL(window.location.href);
    url.searchParams.set('accessAssignmentId', assignment.assignmentId);
    url.searchParams.set('facilityId', assignment.facilityId);
    window.history.replaceState(null, '', url);
    void load();
  }

  function applyFilters(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    queryRef.current = query.trim();
    statusRef.current = status;
    kindRef.current = kind;
    void load();
  }

  function clearFeedback() {
    setMessage(null);
    setOperationError(null);
  }

  function updateOrder(order: ServiceRequestRecord, successMessage: string) {
    setData((current) => ({
      ...current,
      orders: [
        order,
        ...(current.orders ?? []).filter((candidate) => candidate.id !== order.id),
      ],
    }));
    selectOrder(order.id);
    setMessage(successMessage);
    setOperationError(null);
  }

  async function createOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || state !== 'ready' || (createFromRecommendation && !formSource)) return;
    const generation = loadGeneration.current;
    const operationAssignment = accessAssignmentRef.current;
    const operationFacility = facilityRef.current;
    const currentOperation = () => generation === loadGeneration.current && operationAssignment === accessAssignmentRef.current && operationFacility === facilityRef.current;
    const form = new FormData(event.currentTarget);
    const commandPayload = {
      facilityId: facilityRef.current || undefined,
      accessAssignmentId: accessAssignmentRef.current || undefined,
      encounterId: formSource?.encounterId ?? String(form.get('encounterId') ?? ''),
      kind: String(form.get('kind') ?? ''),
      priority: String(form.get('priority') ?? ''),
      requestedService: String(form.get('requestedService') ?? ''),
      targetSpecialty:
        createKind === 'referral'
          ? String(form.get('targetSpecialty') ?? '') || null
          : null,
      medicalJustification: String(form.get('medicalJustification') ?? ''),
      clinicianNote: String(form.get('clinicianNote') ?? '') || null,
      testDataAcknowledged: true,
      ...(formSource ? { recommendationSource: { recommendationId: formSource.recommendationId, recommendationVersion: formSource.recommendationVersion } } : {}),
    };
    const keyName = buildScopedOperationKey(
      accessAssignmentRef.current,
      'create',
      JSON.stringify(commandPayload),
    );
    const idempotencyKey =
      createKeys.current.get(keyName) ?? crypto.randomUUID();
    createKeys.current.set(keyName, idempotencyKey);
    clearFeedback();
    setBusy('create');
    try {
      const response = await fetch('/api/orders', {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...commandPayload,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        order?: ServiceRequestRecord;
        error?: ApiError;
      };
      if (!currentOperation()) return;
      if (!response.ok || !payload.order) {
        if (response.status < 500) createKeys.current.delete(keyName);
        setOperationError(payload.error ?? { code: 'UNKNOWN', message: 'Не удалось создать направление.' });
        return;
      }
      createKeys.current.delete(keyName);
      setCreateOpen(false);
      setCreateFromRecommendation(false);
      transferSelection.current = null;
      requestedOrderId.current = payload.order.id;
      window.history.replaceState(null, '', orderRequestHref(payload.order.id, operationFacility, operationAssignment));
      updateOrder(payload.order, 'Черновик сохранён. Теперь врач должен отдельно его подтвердить.');
      await load(payload.order.id);
    } catch {
      if (!currentOperation()) return;
      setOperationError({
        code: 'NETWORK_ERROR',
        message: 'Сервер не ответил. Ключ повтора сохранён — повтор не создаст дубль.',
      });
    } finally {
      if (operationAssignment === accessAssignmentRef.current && operationFacility === facilityRef.current) setBusy(null);
    }
  }

  async function runAction(action: OrderAction) {
    if (!selected || busy || actionReason.trim().length < 3) return;
    const keyName = buildScopedOperationKey(
      accessAssignmentRef.current,
      'action',
      selected.id,
      selected.current.version,
      action,
    );
    const idempotencyKey = actionKeys.current.get(keyName) ?? crypto.randomUUID();
    actionKeys.current.set(keyName, idempotencyKey);
    clearFeedback();
    setBusy(`action:${action}`);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(selected.id)}/command`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facilityId: facilityRef.current || undefined,
            accessAssignmentId: accessAssignmentRef.current || undefined,
            action,
            reason: actionReason,
            expectedVersion: selected.current.version,
            idempotencyKey,
          }),
        },
      );
      const payload = (await response.json()) as {
        order?: ServiceRequestRecord;
        error?: ApiError;
      };
      if (!response.ok || !payload.order) {
        if (response.status < 500) actionKeys.current.delete(keyName);
        setOperationError(
          response.status >= 500
            ? { code: 'UNKNOWN_OUTCOME', message: unknownOutcomeMessage('action') }
            : payload.error ?? { code: 'UNKNOWN', message: 'Действие не выполнено.' },
        );
        return;
      }
      actionKeys.current.delete(keyName);
      setActionReason('');
      updateOrder(payload.order, `${actionLabels[action]}. Новая версия сохранена в истории.`);
      await load(payload.order.id);
    } catch {
      setOperationError({
        code: 'UNKNOWN_OUTCOME',
        message: unknownOutcomeMessage('action'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function uploadResult(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || busy) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const file = form.get('file');
    if (!(file instanceof File) || file.size === 0) {
      setOperationError({ code: 'FILE_REQUIRED', message: 'Выберите PDF, JPEG или PNG.' });
      return;
    }
    const keyName = buildScopedOperationKey(
      accessAssignmentRef.current,
      'upload',
      selected.id,
      selected.report?.current.version ?? 0,
      file.name,
      file.size,
      file.lastModified,
    );
    const idempotencyKey =
      uploadKeys.current.get(keyName) ?? crypto.randomUUID();
    uploadKeys.current.set(keyName, idempotencyKey);
    form.set('idempotencyKey', idempotencyKey);
    form.set('expectedReportVersion', String(selected.report?.current.version ?? 0));
    form.set('testDataAcknowledged', 'true');
    clearFeedback();
    setBusy('upload');
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(selected.id)}/result${assignmentQuery()}`,
        {
          method: 'PUT',
          credentials: 'same-origin',
          body: form,
        },
      );
      const payload = (await response.json()) as {
        order?: ServiceRequestRecord;
        error?: ApiError;
      };
      if (!response.ok || !payload.order) {
        if (response.status < 500) uploadKeys.current.delete(keyName);
        setOperationError(
          response.status >= 500
            ? { code: 'UNKNOWN_OUTCOME', message: unknownOutcomeMessage('upload') }
            : payload.error ?? { code: 'UNKNOWN', message: 'Файл не сохранён.' },
        );
        return;
      }
      uploadKeys.current.delete(keyName);
      formElement.reset();
      setSelectedFileName('');
      updateOrder(payload.order, 'Результат сохранён. До решения врача он остаётся непроверенным.');
      await load(payload.order.id);
    } catch {
      setOperationError({
        code: 'UNKNOWN_OUTCOME',
        message: unknownOutcomeMessage('upload'),
      });
    } finally {
      setBusy(null);
    }
  }

  async function reviewResult(decision: 'reviewed' | 'needs_reconciliation') {
    if (!selected?.report || busy) return;
    if (decision === 'needs_reconciliation' && reviewNote.trim().length < 3) {
      setOperationError({
        code: 'NOTE_REQUIRED',
        message: 'Опишите расхождение, которое нужно устранить.',
      });
      return;
    }
    const keyName = buildScopedOperationKey(
      accessAssignmentRef.current,
      'review',
      selected.id,
      selected.report.current.version,
      decision,
    );
    const idempotencyKey = reviewKeys.current.get(keyName) ?? crypto.randomUUID();
    reviewKeys.current.set(keyName, idempotencyKey);
    clearFeedback();
    setBusy(`review:${decision}`);
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(selected.id)}/result/review`,
        {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            facilityId: facilityRef.current || undefined,
            accessAssignmentId: accessAssignmentRef.current || undefined,
            decision,
            note: reviewNote.trim() || null,
            expectedReportVersion: selected.report.current.version,
            idempotencyKey,
          }),
        },
      );
      const payload = (await response.json()) as {
        order?: ServiceRequestRecord;
        error?: ApiError;
      };
      if (!response.ok || !payload.order) {
        if (response.status < 500) reviewKeys.current.delete(keyName);
        setOperationError(
          response.status >= 500
            ? { code: 'UNKNOWN_OUTCOME', message: unknownOutcomeMessage('review') }
            : payload.error ?? { code: 'UNKNOWN', message: 'Решение не сохранено.' },
        );
        return;
      }
      reviewKeys.current.delete(keyName);
      setReviewNote('');
      updateOrder(
        payload.order,
        decision === 'reviewed'
          ? 'Проверка врача зафиксирована. Финальное решение остаётся за врачом.'
          : 'Расхождение сохранено. Прикрепите исправленный результат после сверки.',
      );
      await load(payload.order.id);
    } catch {
      setOperationError({
        code: 'UNKNOWN_OUTCOME',
        message: unknownOutcomeMessage('review'),
      });
    } finally {
      setBusy(null);
    }
  }

  const openCount = orders.filter((order) =>
    ['draft', 'active', 'on_hold'].includes(order.current.status),
  ).length;
  const pendingReviewCount = orders.filter(
    (order) => order.report?.current.reviewState === 'pending',
  ).length;
  const reconciliationCount = orders.filter(
    (order) => order.report?.current.reviewState === 'needs_reconciliation',
  ).length;
  const signInReturnTo = `/orders${buildOrderAccessQuery(
    data.facility?.id ?? '',
    selectedAccessAssignmentId,
  )}`;
  const signInHref = chatGPTSignInPath(signInReturnTo);

  return (
    <main className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Клинический маршрут</span>
          <h1>Направления и результаты</h1>
          <p>
            Врач создаёт и подтверждает запрос, затем сверяет полученный документ.
            Внешняя отправка в КМИС пока не подключена.
          </p>
        </div>
        <button
          className={styles.primaryButton}
          disabled={state !== 'ready'}
          onClick={() => {
            clearFeedback();
            setCreateFromRecommendation(false);
            setCreateKind('laboratory');
            setCreateOpen(true);
          }}
          type="button"
        >
          <Plus aria-hidden="true" size={18} />
          Новое направление
        </button>
      </header>

      {transferSource && (
        <section className={styles.transferPanel} aria-labelledby="recommendation-transfer-title">
          <span className={styles.eyebrow}>Принято врачом · версия {transferSource.recommendationVersion}</span>
          <h2 id="recommendation-transfer-title">Направление из рекомендации</h2>
          <strong>{transferSource.title}</strong>
          <p>{transferSource.medicalJustification}</p>
          <p className={styles.hint}>1. Проверьте формулировку и выберите тип направления. 2. Сохраните черновик. 3. Подтвердите направление отдельно. Открытие этой страницы ничего не создаёт и не отправляет.</p>
          <div className={styles.actionRow}>
            {transferSource.existingOrderId ? (
              <a className={styles.primaryButton} href={orderRequestHref(transferSource.existingOrderId, data.facility?.id ?? '', selectedAccessAssignmentId)}>Открыть уже созданное направление</a>
            ) : (
              <button className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => {
                clearFeedback();
                setCreateFromRecommendation(true);
                setCreateKind('');
                setCreateOpen(true);
              }} type="button"><FilePlus2 aria-hidden="true" size={18} />Проверить и создать черновик</button>
            )}
            <a className={styles.secondaryButton} href={`/?${new URLSearchParams({ facilityId: data.facility?.id ?? '', accessAssignmentId: selectedAccessAssignmentId, encounterId: transferSource.encounterId }).toString()}`}>Вернуться в приём</a>
          </div>
        </section>
      )}

      {state === 'ready' && openedRequestId && (
        <div className={styles.successMessage} role="status"><FileCheck2 aria-hidden="true" size={18} />
          <span>Открыто сохранённое направление. {selected?.current.status === 'draft' ? 'Это черновик: проверьте его и подтвердите отдельным действием ниже.' : 'Текущий статус указан в карточке.'}</span>
          <a href={`/orders${buildOrderAccessQuery(data.facility?.id ?? '', selectedAccessAssignmentId)}`}>Все направления</a>
        </div>
      )}

      <section className={styles.stats} aria-label="Сводка направлений">
        <article>
          <ClipboardList aria-hidden="true" size={20} />
          <span><strong>{openCount}</strong><small>в работе</small></span>
        </article>
        <article>
          <FileClock aria-hidden="true" size={20} />
          <span><strong>{pendingReviewCount}</strong><small>ждут проверки</small></span>
        </article>
        <article className={reconciliationCount ? styles.statWarning : undefined}>
          <RotateCcw aria-hidden="true" size={20} />
          <span><strong>{reconciliationCount}</strong><small>на сверке</small></span>
        </article>
        <article>
          <ShieldCheck aria-hidden="true" size={20} />
          <span><strong>D1 + R2</strong><small>история и файлы</small></span>
        </article>
      </section>

      <form className={styles.toolbar} onSubmit={applyFilters}>
        <div className={styles.searchBox}>
          <Search aria-hidden="true" size={18} />
          <input
            aria-label="Поиск направлений"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Пациент, номер карты или назначение"
            value={query}
          />
        </div>
        <select aria-label="Тип направления" onChange={(event) => setKind(event.target.value as typeof kind)} value={kind}>
          <option value="all">Все типы</option>
          <option value="laboratory">Лаборатория</option>
          <option value="ecg">ЭКГ</option>
          <option value="service">Услуга</option>
          <option value="referral">Специалист</option>
        </select>
        <select aria-label="Статус направления" onChange={(event) => setStatus(event.target.value as typeof status)} value={status}>
          <option value="all">Все статусы</option>
          <option value="draft">Черновики</option>
          <option value="active">Подтверждённые</option>
          <option value="on_hold">Приостановленные</option>
          <option value="completed">Завершённые</option>
          <option value="revoked">Отозванные</option>
          <option value="entered_in_error">Ошибочные</option>
        </select>
        <button className={styles.secondaryButton} type="submit">
          <RefreshCw aria-hidden="true" size={17} />
          Обновить
        </button>
        {assignmentOptions.length > 1 && (
          <select
            aria-label="Рабочий контур"
            disabled={Boolean(busy) || state === 'loading'}
            onChange={(event) => selectAssignment(event.target.value)}
            value={selectedAccessAssignmentId}
          >
            {assignmentOptions.map((assignment) => (
              <option key={assignment.assignmentId} value={assignment.assignmentId}>
                {assignment.organizationName} · {assignment.facilityName} · {assignment.departmentName}
              </option>
            ))}
          </select>
        )}
      </form>

      {message && (
        <div className={styles.successMessage} role="status">
          <CheckCircle2 aria-hidden="true" size={18} />
          {message}
        </div>
      )}
      {operationError && (
        <div className={styles.errorMessage} role="alert">
          <AlertCircle aria-hidden="true" size={18} />
          <span>
            <strong>{operationError.message}</strong>
            {operationError.requestId && <small>Код обращения: {operationError.requestId}</small>}
          </span>
          <button aria-label="Закрыть сообщение" onClick={() => setOperationError(null)} type="button"><X size={16} /></button>
        </div>
      )}

      {state === 'loading' && <StatePanel icon={<OrionMark animated size={48} />} title="Загружаем направления" text="Читаем текущие версии и результаты из D1." />}
      {state === 'unauthenticated' && <StatePanel icon={<AlertCircle />} title="Нужен вход" text="Откройте платформу через авторизованный контур ORION Clinic." action={<a className={styles.primaryButton} href={signInHref} target="_top">Войти</a>} />}
      {state === 'forbidden' && <StatePanel icon={<ShieldCheck />} title="Нет доступа" text="Раздел доступен только врачу с активным назначением в клинике." />}
      {state === 'error' && <OrderLoadError message={data.error?.message} sourceConflictHref={sourceConflictHref} onRetry={() => void load()} />}
      {state === 'assignment' && <StatePanel icon={<ShieldCheck />} title="Выберите рабочий контур" text="Права разных отделений и филиалов не объединяются." action={<div className={styles.facilityChoices}>{assignmentOptions.map((assignment) => <button className={styles.secondaryButton} key={assignment.assignmentId} onClick={() => selectAssignment(assignment.assignmentId)} type="button">{assignment.organizationName} · {assignment.facilityName} · {assignment.departmentName}</button>)}</div>} />}

      {state === 'ready' && (
        <section className={styles.workspace}>
          <aside className={styles.orderList} aria-label="Список направлений">
            <header>
              <div><strong>{orders.length}</strong><span>в выборке</span></div>
              <small>сначала новые</small>
            </header>
            {orders.length === 0 ? (
              <div className={styles.listEmpty}>
                <FilePlus2 aria-hidden="true" size={25} />
                <strong>Направлений нет</strong>
                <span>Создайте первый врачебный черновик.</span>
              </div>
            ) : orders.map((order) => (
              <button
                aria-pressed={selectedId === order.id}
                className={joinClass(styles.orderCard, selectedId === order.id && styles.orderCardActive)}
                key={order.id}
                onClick={() => {
                  selectOrder(order.id);
                  clearFeedback();
                }}
                type="button"
              >
                <span className={styles.cardTopline}>
                  <span className={joinClass(styles.statusPill, styles[`status_${order.current.status}`])}>{statusLabels[order.current.status]}</span>
                  <small>v{order.current.version}</small>
                </span>
                <strong>{order.current.requestedService}</strong>
                <span className={styles.patientLine}><UserRound aria-hidden="true" size={15} />{order.patient.displayName}</span>
                <span className={styles.cardMeta}>{kindLabels[order.kind]} · {priorityLabels[order.current.priority]}</span>
                {order.report && <span className={joinClass(styles.reviewPill, styles[`review_${order.report.current.reviewState}`])}>{reviewLabels[order.report.current.reviewState]}</span>}
                <ChevronRight className={styles.cardArrow} aria-hidden="true" size={18} />
              </button>
            ))}
          </aside>

          <div className={styles.detail}>
            {selected ? (
              <OrderDetail
                actionReason={actionReason}
                busy={busy}
                key={selected.id}
                onAction={runAction}
                onActionReason={setActionReason}
                onFileName={setSelectedFileName}
                onReview={reviewResult}
                onReviewNote={setReviewNote}
                onUpload={uploadResult}
                order={selected}
                reviewNote={reviewNote}
                selectedFileName={selectedFileName}
                resultUrl={`/api/orders/${encodeURIComponent(selected.id)}/result${buildOrderAccessQuery(
                  data.facility?.id ?? '',
                  selectedAccessAssignmentId,
                )}`}
              />
            ) : (
              <div className={styles.detailEmpty}>
                <ClipboardList aria-hidden="true" size={32} />
                <h2>Выберите направление</h2>
                <p>Здесь появятся его версия, результат и действия врача.</p>
              </div>
            )}
          </div>
        </section>
      )}

      {createOpen && (
        <div className={styles.modalBackdrop} onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setCreateOpen(false);
        }}>
          <section aria-labelledby="create-order-title" aria-modal="true" className={styles.modal} role="dialog">
            <header className={styles.modalHeader}>
              <div>
                <span className={styles.eyebrow}>Версия 1 · черновик</span>
                <h2 id="create-order-title">{formSource ? 'Черновик из принятой рекомендации' : 'Новое направление'}</h2>
                <p>Сохранение не отправляет запрос. Подтверждение врача — отдельный шаг.</p>
              </div>
              <button aria-label="Закрыть" disabled={Boolean(busy)} onClick={() => setCreateOpen(false)} type="button"><X size={19} /></button>
            </header>
            <form className={styles.createForm} onSubmit={createOrder} key={formSource ? `${formSource.recommendationId}:${formSource.recommendationVersion}` : 'manual'}>
              {formSource && <div className={joinClass(styles.transferSummary, styles.fieldWide)}><strong>Источник: {formSource.title}</strong><p>Принятая версия {formSource.recommendationVersion}. Приём зафиксирован по серверному источнику. Тип и приоритет выбираете вы; текст можно изменить. Сохранение не подтверждает и не отправляет направление.</p></div>}
              <label className={styles.fieldWide}>
                <span>Приём и пациент</span>
                <select name="encounterId" required defaultValue={formSource?.encounterId ?? ''} disabled={Boolean(formSource)}>
                  <option disabled value="">Выберите приём</option>
                  {formSource && !encounters.some(encounter => encounter.id === formSource.encounterId) && <option value={formSource.encounterId}>Приём принятой рекомендации</option>}
                  {encounters.map((encounter) => (
                    <option disabled={!encounter.careConsentEffective} key={encounter.id} value={encounter.id}>
                      {encounter.patientName} · {encounter.medicalRecordNumber}{encounter.careConsentEffective ? '' : ' · нет согласия'}
                    </option>
                  ))}
                </select>
                <small>Доступны только ваши приёмы; без действующего согласия запись не создаётся.</small>
              </label>
              <label>
                <span>Тип</span>
                <select name="kind" required onChange={(event) => setCreateKind(event.target.value as ServiceRequestKind)} value={createKind}>
                  <option disabled value="">Выберите тип направления</option>
                  <option value="laboratory">Лабораторный анализ</option>
                  <option value="ecg">ЭКГ</option>
                  <option value="service">Процедура или услуга</option>
                  <option value="referral">Консультация специалиста</option>
                </select>
              </label>
              <label>
                <span>Приоритет</span>
                <select defaultValue={formSource ? '' : 'routine'} name="priority" required>
                  <option disabled value="">Выберите приоритет</option>
                  <option value="routine">Планово</option>
                  <option value="urgent">Срочно</option>
                  <option value="asap">Как можно скорее</option>
                  <option value="stat">Немедленно</option>
                </select>
              </label>
              <label className={styles.fieldWide}>
                <span>Что требуется</span>
                <input defaultValue={formSource?.title ?? ''} maxLength={300} minLength={2} name="requestedService" placeholder="Например, гликированный гемоглобин HbA1c" required />
              </label>
              {createKind === 'referral' && (
                <label className={styles.fieldWide}>
                  <span>Специальность</span>
                  <input maxLength={160} minLength={2} name="targetSpecialty" placeholder="Например, эндокринолог" required />
                </label>
              )}
              <label className={styles.fieldWide}>
                <span>Медицинское обоснование</span>
                <textarea defaultValue={formSource?.medicalJustification ?? ''} maxLength={2000} minLength={10} name="medicalJustification" placeholder="Клинические сведения, показания и цель запроса" required rows={4} />
                {formSource && <small>Проверьте показания и цель. Обоснование должно содержать от 10 до 2000 символов.</small>}
              </label>
              <label className={styles.fieldWide}>
                <span>Примечание исполнителю</span>
                <textarea maxLength={2000} name="clinicianNote" placeholder="Подготовка, сроки или другая важная информация" rows={3} />
              </label>
              <div className={joinClass(styles.formActions, styles.fieldWide)}>
                {operationError && <p className={styles.errorMessage} role="alert">{operationError.message}</p>}
                <button className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => setCreateOpen(false)} type="button">Отмена</button>
                <button className={styles.primaryButton} disabled={Boolean(busy) || (!formSource && encounters.length === 0)} type="submit">
                  {busy === 'create' ? <OrionMark animated size={20} /> : <FilePlus2 size={17} />}
                  Сохранить черновик
                </button>
              </div>
            </form>
          </section>
        </div>
      )}
    </main>
  );
}

export function OrderLoadError({ message, sourceConflictHref, onRetry }: {
  message?: string;
  sourceConflictHref: string;
  onRetry(): void;
}) {
  return <StatePanel icon={<AlertCircle />} title={sourceConflictHref ? 'Проверьте актуальную рекомендацию' : 'Не удалось загрузить данные'} text={message ?? 'Проверьте локальную базу и повторите.'} action={sourceConflictHref ? <a className={styles.primaryButton} href={sourceConflictHref}>Вернуться в этот приём</a> : <button className={styles.secondaryButton} onClick={onRetry} type="button">Повторить</button>} />;
}

function StatePanel({
  icon,
  title,
  text,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  text: string;
  action?: React.ReactNode;
}) {
  return <section className={styles.statePanel}>{icon}<h2>{title}</h2><p>{text}</p>{action}</section>;
}

function OrderDetail({
  order,
  busy,
  actionReason,
  reviewNote,
  selectedFileName,
  resultUrl,
  onActionReason,
  onReviewNote,
  onFileName,
  onAction,
  onReview,
  onUpload,
}: {
  order: ServiceRequestRecord;
  busy: string | null;
  actionReason: string;
  reviewNote: string;
  selectedFileName: string;
  resultUrl: string;
  onActionReason(value: string): void;
  onReviewNote(value: string): void;
  onFileName(value: string): void;
  onAction(action: OrderAction): void;
  onReview(decision: 'reviewed' | 'needs_reconciliation'): void;
  onUpload(event: FormEvent<HTMLFormElement>): void;
}) {
  const status = order.current.status;
  const actions: OrderAction[] =
    status === 'draft'
      ? ['approve', 'revoke', 'mark_error']
      : status === 'active'
        ? ['hold', 'complete', 'revoke', 'mark_error']
        : status === 'on_hold'
          ? ['resume', 'revoke', 'mark_error']
          : [];
  const currentReport = order.report?.current ?? null;
  const allowedReportStatuses = allowedNextDiagnosticReportStatuses(
    currentReport?.reportStatus ?? null,
  );
  const uploadStatuses =
    status === 'completed'
      ? allowedReportStatuses.filter(
          (reportStatus) =>
            reportStatus === 'amended' || reportStatus === 'corrected',
        )
      : allowedReportStatuses;
  const canUpload =
    ['active', 'on_hold', 'completed'].includes(status) &&
    uploadStatuses.length > 0;

  return (
    <>
      <header className={styles.detailHeader}>
        <div>
          <span className={joinClass(styles.statusPill, styles[`status_${status}`])}>{statusLabels[status]}</span>
          <h2>{order.current.requestedService}</h2>
          <p>{kindLabels[order.kind]} · {priorityLabels[order.current.priority]} · версия {order.current.version}</p>
        </div>
        <div className={styles.patientIdentity}>
          <UserRound aria-hidden="true" size={20} />
          <span><strong>{order.patient.displayName}</strong><small>{order.patient.medicalRecordNumber}</small></span>
        </div>
      </header>

      <section className={styles.factGrid}>
        <article><span>Приём</span><strong>{order.encounter.reasonForVisit ?? 'Причина не указана'}</strong><small>{order.encounter.status}</small></article>
        <article><span>Обоснование врача</span><strong>{order.current.medicalJustification}</strong></article>
        {order.current.targetSpecialty && <article><span>Специалист</span><strong>{order.current.targetSpecialty}</strong></article>}
        {order.current.clinicianNote && <article><span>Исполнителю</span><strong>{order.current.clinicianNote}</strong></article>}
      </section>

      {order.recommendationSource && (
        <section className={styles.transferSummary} aria-label="Источник направления">
          <strong>Создано из принятой рекомендации · версия {order.recommendationSource.recommendationVersion}</strong>
          <p>{order.recommendationSource.title}</p>
          <small>Источник сохранён вместе с направлением. Принятие подсказки и подтверждение направления — разные решения врача. Внешняя отправка не выполняется.</small>
        </section>
      )}

      {actions.length > 0 && (
        <section className={styles.decisionPanel}>
          <header><span><ShieldCheck aria-hidden="true" size={18} /><strong>Решение по направлению</strong></span><small>сохранится новой версией</small></header>
          <textarea
            aria-label="Основание действия"
            aria-describedby="order-action-guidance"
            maxLength={500}
            onChange={(event) => onActionReason(event.target.value)}
            placeholder="Укажите основание действия врача (минимум 3 символа)"
            rows={2}
            value={actionReason}
          />
          <p className={styles.hint} id="order-action-guidance" role="status">
            {orderActionBlocker('approve', Boolean(busy), actionReason, true)
              ?? 'Выберите действие ниже. Решение сохранится в истории направления; внешняя отправка не выполняется.'}
          </p>
          <div className={styles.actionRow}>
            {actions.map((action) => {
              const blocker = orderActionBlocker(action, Boolean(busy), actionReason, order.canComplete);
              const disabled = blocker !== null;
              return (
                <button
                  className={joinClass(
                    action === 'approve' || action === 'resume' || action === 'complete'
                      ? styles.primaryButton
                      : action === 'hold'
                        ? styles.warningButton
                        : styles.dangerButton,
                  )}
                  disabled={disabled}
                  aria-describedby={action === 'complete' && !order.canComplete ? 'order-action-guidance order-completion-guidance' : 'order-action-guidance'}
                  key={action}
                  onClick={() => onAction(action)}
                  title={blocker ?? undefined}
                  type="button"
                >
                  {busy === `action:${action}` ? <OrionMark animated size={20} /> : action === 'approve' ? <Check size={16} /> : action === 'resume' ? <Play size={16} /> : action === 'hold' ? <CirclePause size={16} /> : action === 'complete' ? <FileCheck2 size={16} /> : <Trash2 size={16} />}
                  {actionLabels[action]}
                </button>
              );
            })}
          </div>
          {status === 'active' && !order.canComplete && <p className={styles.hint} id="order-completion-guidance">Для завершения загрузите финальный, дополненный или исправленный результат ниже и подтвердите его проверку врачом.</p>}
        </section>
      )}

      <section className={styles.resultPanel}>
        <header>
          <div><FlaskConical aria-hidden="true" size={20} /><span><strong>Результат и заключение</strong><small>файл в R2 · метаданные и версии в D1</small></span></div>
          {currentReport && <span className={joinClass(styles.reviewPill, styles[`review_${currentReport.reviewState}`])}>{reviewLabels[currentReport.reviewState]}</span>}
        </header>

        {currentReport ? (
          <div className={styles.currentResult}>
            <div className={styles.resultSummary}>
              <FileCheck2 aria-hidden="true" size={24} />
              <span>
                <strong>{reportStatusLabels[currentReport.reportStatus]}</strong>
                <small>Версия {currentReport.version} · {formatTimestamp(currentReport.createdAt)}</small>
              </span>
              {currentReport.artifact && (
                <a className={styles.downloadButton} href={resultUrl}>
                  <ArrowDownToLine aria-hidden="true" size={17} />
                  Скачать {currentReport.artifact.fileName}
                </a>
              )}
            </div>
            {currentReport.conclusion && <p className={styles.conclusion}>{currentReport.conclusion}</p>}
            {currentReport.reconciliationNote && <div className={styles.reconciliation}><RotateCcw aria-hidden="true" size={18} /><span><strong>Нужно устранить расхождение</strong>{currentReport.reconciliationNote}</span></div>}
            {canShowDiagnosticReviewControls(
              status,
              currentReport.reviewState,
            ) && (
              <div className={styles.reviewBox}>
                <label><span>Комментарий при расхождении</span><textarea maxLength={1000} onChange={(event) => onReviewNote(event.target.value)} placeholder="Например, данные пациента или показатель не совпадают" rows={2} value={reviewNote} /></label>
                <div>
                  <button className={styles.secondaryButton} disabled={Boolean(busy)} onClick={() => onReview('needs_reconciliation')} type="button"><RotateCcw size={16} />Есть расхождение</button>
                  <button className={styles.primaryButton} disabled={Boolean(busy)} onClick={() => onReview('reviewed')} type="button"><Check size={16} />Проверено врачом</button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className={styles.noResult}><FileClock aria-hidden="true" size={27} /><strong>Результат ещё не загружен</strong><span>После получения документа прикрепите его ниже.</span></div>
        )}

        {canUpload && (
          <form className={styles.uploadForm} onSubmit={onUpload}>
            <div className={styles.uploadTitle}>
              <Upload aria-hidden="true" size={19} />
              <span><strong>{currentReport ? 'Новая версия результата' : 'Прикрепить результат'}</strong><small>PDF, JPEG или PNG · до 10 МБ</small></span>
            </div>
            <label className={styles.filePicker}>
              <input accept="application/pdf,image/jpeg,image/png" name="file" onChange={(event) => onFileName(event.target.files?.[0]?.name ?? '')} required type="file" />
              <FilePlus2 aria-hidden="true" size={18} />
              <span>{selectedFileName || 'Выбрать файл'}</span>
            </label>
            <label><span>Статус документа</span><select name="reportStatus">{uploadStatuses.map((value) => <option key={value} value={value}>{reportStatusLabels[value]}</option>)}</select></label>
            <label className={styles.fieldWide}><span>Заключение или ключевые показатели</span><textarea maxLength={4000} name="conclusion" placeholder="Перенесите текст из полученного результата без самостоятельной интерпретации" rows={3} /></label>
            <label className={styles.fieldWide}><span>Причина добавления версии</span><input maxLength={500} minLength={3} name="changeReason" placeholder={currentReport ? 'Например, получен исправленный документ' : 'Например, получен финальный результат'} required /></label>
            <div className={joinClass(styles.uploadActions, styles.fieldWide)}>
              <small>Загрузка не означает клиническое подтверждение.</small>
              <button className={styles.primaryButton} disabled={Boolean(busy)} type="submit">{busy === 'upload' ? <OrionMark animated size={20} /> : <Upload size={16} />}Сохранить результат</button>
            </div>
          </form>
        )}
      </section>

      <section className={styles.historyPanel}>
        <details>
          <summary><History aria-hidden="true" size={18} />История направления <span>{order.history.length}</span></summary>
          <ol>{order.history.map((entry) => <li key={entry.id}><span className={styles.historyDot} /><div><strong>v{entry.version} · {statusLabels[entry.status]}</strong><p>{entry.statusReason ?? 'Изменение без комментария'}</p><small>{entry.authoredBy} · {formatTimestamp(entry.createdAt)}</small></div></li>)}</ol>
        </details>
        {order.report && <details><summary><FileCheck2 aria-hidden="true" size={18} />История результата <span>{order.report.history.length}</span></summary><ol>{order.report.history.map((entry) => <li key={entry.id}><span className={styles.historyDot} /><div><strong>v{entry.version} · {reportStatusLabels[entry.reportStatus]} · {reviewLabels[entry.reviewState]}</strong><p>{entry.changeReason}</p><small>{entry.createdBy} · {formatTimestamp(entry.createdAt)}</small></div></li>)}</ol></details>}
      </section>
    </>
  );
}
