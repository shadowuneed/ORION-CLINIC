'use client';

import type { FormEvent } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity,
  AlertCircle,
  CheckCircle2,
  Clock3,
  FileClock,
  Gauge,
  History,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Ruler,
  Scale,
  Search,
  ShieldCheck,
  Thermometer,
  UserRound,
  X,
} from 'lucide-react';
import type { ObservationContext } from '@/lib/domain/observations';
import type {
  ObservationPatient,
  ObservationWorkspace,
  PatientObservationRecord,
} from '@/lib/repositories/patient-observations';
import styles from './observations.module.css';

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
  details?: {
    assignments?: AccessAssignmentOption[];
    currentVersion?: number;
  };
};

type ObservationsResponse = Partial<ObservationWorkspace> & {
  viewer?: {
    id: string;
    displayName: string;
    membershipId: string;
    accessAssignmentId: string;
    role: 'clinician' | 'nurse';
  };
  organization?: { id: string; name: string };
  facility?: { id: string; name: string };
  accessAssignment?: { assignmentId: string };
  assignments?: AccessAssignmentOption[];
  observation?: PatientObservationRecord;
  persistence?: 'd1';
  error?: ApiError;
};

type ReadyWorkspace = ObservationWorkspace & {
  viewer: NonNullable<ObservationsResponse['viewer']>;
  organization: NonNullable<ObservationsResponse['organization']>;
  facility: NonNullable<ObservationsResponse['facility']>;
  accessAssignment: NonNullable<ObservationsResponse['accessAssignment']>;
  assignments: AccessAssignmentOption[];
  persistence: 'd1';
};

type LoadState =
  | 'loading'
  | 'ready'
  | 'assignment'
  | 'unauthenticated'
  | 'forbidden'
  | 'error';

type MeasurementDraft = {
  measuredAt: string;
  context: ObservationContext;
  includeAnthropometry: boolean;
  heightCm: string;
  weightKg: string;
  includePressure: boolean;
  systolicMmhg: string;
  diastolicMmhg: string;
  includeTemperature: boolean;
  temperatureC: string;
  note: string;
  reason: string;
  acknowledged: boolean;
  idempotencyKey: string;
};

const contextLabels: Record<ObservationContext, string> = {
  pre_visit: 'Перед приёмом',
  consultation: 'Во время консультации',
  follow_up: 'Контрольное наблюдение',
  other: 'Другой контекст',
};

const roleLabels = {
  clinician: 'Врач',
  nurse: 'Медсестра',
} as const;

function localDateTimeInput(value = Date.now()) {
  const date = new Date(value - new Date(value).getTimezoneOffset() * 60_000);
  return date.toISOString().slice(0, 16);
}

function timestampFromInput(value: string) {
  const timestamp = new Date(value).getTime();
  return Number.isFinite(timestamp) ? timestamp : Number.NaN;
}

function errorFrom(payload: ObservationsResponse, fallback: string): ApiError {
  return payload.error ?? { code: 'UNKNOWN_ERROR', message: fallback };
}

function numberOrNull(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value.replace(',', '.'));
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function emptyDraft(): MeasurementDraft {
  return {
    measuredAt: localDateTimeInput(),
    context: 'pre_visit',
    includeAnthropometry: true,
    heightCm: '',
    weightKg: '',
    includePressure: true,
    systolicMmhg: '',
    diastolicMmhg: '',
    includeTemperature: true,
    temperatureC: '',
    note: '',
    reason: 'Первичная запись показателей',
    acknowledged: false,
    idempotencyKey: crypto.randomUUID(),
  };
}

function draftFromObservation(observation: PatientObservationRecord): MeasurementDraft {
  const values = observation.current.values;
  return {
    measuredAt: localDateTimeInput(values ? observation.current.measuredAt : Date.now()),
    context: observation.current.context,
    includeAnthropometry: values.heightCm !== null,
    heightCm: values.heightCm?.toString() ?? '',
    weightKg: values.weightKg?.toString() ?? '',
    includePressure: values.systolicMmhg !== null,
    systolicMmhg: values.systolicMmhg?.toString() ?? '',
    diastolicMmhg: values.diastolicMmhg?.toString() ?? '',
    includeTemperature: values.temperatureC !== null,
    temperatureC: values.temperatureC?.toString() ?? '',
    note: observation.current.note ?? '',
    reason: 'Исправление ранее записанных показателей',
    acknowledged: false,
    idempotencyKey: crypto.randomUUID(),
  };
}

export function calculateBmi(heightCm: string, weightKg: string) {
  const height = numberOrNull(heightCm);
  const weight = numberOrNull(weightKg);
  if (
    height === null ||
    weight === null ||
    !Number.isFinite(height) ||
    !Number.isFinite(weight) ||
    height <= 0 ||
    weight <= 0
  ) {
    return null;
  }
  return Math.round((weight / ((height / 100) ** 2)) * 100) / 100;
}

export function canCorrectObservation(
  viewer: ReadyWorkspace['viewer'],
  observation: PatientObservationRecord,
) {
  return (
    viewer.role === 'clinician' ||
    observation.current.recordedByMembershipId === viewer.membershipId
  );
}

export function unknownObservationOutcomeMessage() {
  return 'Связь прервалась. Сервер мог сохранить измерение. Не повторяйте ввод с новым ключом: сначала обновите список.';
}

function formatTimestamp(value: number, timeZone: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    timeZone,
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
}

function isReadyPayload(payload: ObservationsResponse): payload is ReadyWorkspace {
  return Boolean(
      payload.viewer &&
      payload.organization &&
      payload.facility &&
      payload.accessAssignment &&
      payload.dataMode &&
      payload.role &&
      payload.timeZone &&
      payload.sourceLabel &&
      payload.patients &&
      payload.observations &&
      payload.capabilities &&
      payload.clinicalInterpretation &&
      payload.thresholdPolicy &&
      payload.persistence,
  );
}

export function buildObservationAccessQuery(
  facilityId?: string,
  accessAssignmentId?: string,
) {
  const params = new URLSearchParams();
  if (facilityId) params.set('facilityId', facilityId);
  if (accessAssignmentId) {
    params.set('accessAssignmentId', accessAssignmentId);
  }
  params.set('limit', '100');
  return params;
}

export function buildObservationOperationKey(
  accessAssignmentId: string,
  ...parts: Array<string | number | null | undefined>
) {
  return [accessAssignmentId || 'unselected', ...parts.map(String)].join('|');
}

export function ObservationWorkspaceView() {
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [workspace, setWorkspace] = useState<ReadyWorkspace | null>(null);
  const [assignmentOptions, setAssignmentOptions] = useState<AccessAssignmentOption[]>([]);
  const [facilityId, setFacilityId] = useState<string | undefined>();
  const [accessAssignmentId, setAccessAssignmentId] = useState('');
  const [selectedPatientId, setSelectedPatientId] = useState('');
  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<
    | { mode: 'create'; observation: null }
    | { mode: 'correct'; observation: PatientObservationRecord }
    | null
  >(null);
  const [draft, setDraft] = useState<MeasurementDraft>(() => emptyDraft());
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const facilityRef = useRef('');
  const accessAssignmentRef = useRef('');
  const loadAbort = useRef<AbortController | null>(null);
  const loadGeneration = useRef(0);

  const load = useCallback(async (
    requestedFacilityId?: string,
    requestedAssignmentId?: string,
    requestedPatientId?: string | null,
  ) => {
    const generation = loadGeneration.current + 1;
    loadGeneration.current = generation;
    loadAbort.current?.abort();
    const controller = new AbortController();
    loadAbort.current = controller;
    setLoadState('loading');
    setError(null);
    try {
      const response = await fetch(
        `/api/observations?${buildObservationAccessQuery(
          requestedFacilityId,
          requestedAssignmentId,
        )}`,
        {
          cache: 'no-store',
          credentials: 'same-origin',
          signal: controller.signal,
        },
      );
      const payload = (await response.json()) as ObservationsResponse;
      if (controller.signal.aborted || generation !== loadGeneration.current) {
        return;
      }
      if (
        response.status === 409 &&
        payload.error?.code === 'ACCESS_ASSIGNMENT_SELECTION_REQUIRED'
      ) {
        setAssignmentOptions(payload.error.details?.assignments ?? []);
        setWorkspace(null);
        setLoadState('assignment');
        return;
      }
      if (response.status === 401) {
        setLoadState('unauthenticated');
        return;
      }
      if (response.status === 403) {
        setLoadState('forbidden');
        return;
      }
      if (!response.ok || !isReadyPayload(payload)) {
        throw errorFrom(payload, 'Не удалось загрузить показатели.');
      }
      const resolvedFacilityId = payload.facility.id;
      const resolvedAssignmentId = payload.accessAssignment.assignmentId;
      facilityRef.current = resolvedFacilityId;
      accessAssignmentRef.current = resolvedAssignmentId;
      const resolvedUrl = new URL(window.location.href);
      resolvedUrl.searchParams.set('facilityId', resolvedFacilityId);
      resolvedUrl.searchParams.set('accessAssignmentId', resolvedAssignmentId);
      window.history.replaceState(
        null,
        '',
        `${resolvedUrl.pathname}${resolvedUrl.search}`,
      );
      setAssignmentOptions(payload.assignments ?? []);
      setFacilityId(resolvedFacilityId);
      setAccessAssignmentId(resolvedAssignmentId);
      setWorkspace(payload);
      setSelectedPatientId((current) => {
        const preferredPatientId = requestedPatientId ?? current;
        return payload.patients.some(
          (patient) => patient.id === preferredPatientId,
        )
          ? preferredPatientId
          : payload.patients[0]?.id ?? '';
      });
      setLoadState('ready');
    } catch (cause) {
      if (
        controller.signal.aborted ||
        generation !== loadGeneration.current ||
        (cause instanceof DOMException && cause.name === 'AbortError')
      ) {
        return;
      }
      const nextError = cause as ApiError;
      setError({
        code: nextError.code ?? 'NETWORK_ERROR',
        message: nextError.message || 'Сервис показателей недоступен.',
        requestId: nextError.requestId,
      });
      setLoadState('error');
    }
  }, []);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requestedFacility = params.get('facilityId') ?? undefined;
    const requestedAssignment =
      params.get('accessAssignmentId') ?? undefined;
    const requestedPatient = params.get('patientId');
    facilityRef.current = requestedFacility ?? '';
    accessAssignmentRef.current = requestedAssignment ?? '';
    const loadTimer = window.setTimeout(() => {
      void load(requestedFacility, requestedAssignment, requestedPatient);
    }, 0);
    return () => {
      window.clearTimeout(loadTimer);
      loadAbort.current?.abort();
    };
  }, [load]);

  const filteredPatients = useMemo(() => {
    if (!workspace) return [];
    const needle = search.trim().toLocaleLowerCase('ru');
    if (!needle) return workspace.patients;
    return workspace.patients.filter((patient) =>
      `${patient.displayName} ${patient.medicalRecordNumber}`
        .toLocaleLowerCase('ru')
        .includes(needle),
    );
  }, [search, workspace]);

  const selectedPatient = workspace?.patients.find(
    (patient) => patient.id === selectedPatientId,
  );
  const selectedObservations = useMemo(
    () =>
      workspace?.observations.filter(
        (observation) => observation.patient.id === selectedPatientId,
      ) ?? [],
    [selectedPatientId, workspace],
  );
  const correctionCount =
    workspace?.observations.reduce(
      (total, observation) => total + Math.max(observation.history.length - 1, 0),
      0,
    ) ?? 0;
  const bmiPreview = draft.includeAnthropometry
    ? calculateBmi(draft.heightCm, draft.weightKg)
    : null;

  function chooseAssignment(nextAssignmentId: string) {
    if (!nextAssignmentId || pending || dialog) return;
    const assignment = assignmentOptions.find(
      (candidate) => candidate.assignmentId === nextAssignmentId,
    );
    if (!assignment) return;
    accessAssignmentRef.current = assignment.assignmentId;
    facilityRef.current = assignment.facilityId;
    setAccessAssignmentId(assignment.assignmentId);
    setFacilityId(assignment.facilityId);
    const url = new URL(window.location.href);
    url.searchParams.set('accessAssignmentId', assignment.assignmentId);
    url.searchParams.set('facilityId', assignment.facilityId);
    url.searchParams.delete('patientId');
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
    setSelectedPatientId('');
    void load(assignment.facilityId, assignment.assignmentId);
  }

  function choosePatient(patient: ObservationPatient) {
    setSelectedPatientId(patient.id);
    const url = new URL(window.location.href);
    url.searchParams.set('patientId', patient.id);
    if (facilityId) url.searchParams.set('facilityId', facilityId);
    if (accessAssignmentId) {
      url.searchParams.set('accessAssignmentId', accessAssignmentId);
    }
    window.history.replaceState(null, '', `${url.pathname}${url.search}`);
  }

  function openCreate() {
    if (!selectedPatient) return;
    setDraft(emptyDraft());
    setDialog({ mode: 'create', observation: null });
    setError(null);
    setSuccess(null);
  }

  function openCorrection(observation: PatientObservationRecord) {
    setDraft(draftFromObservation(observation));
    setDialog({ mode: 'correct', observation });
    setError(null);
    setSuccess(null);
  }

  function closeDialog() {
    if (pending) return;
    setDialog(null);
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (
      !dialog ||
      !selectedPatient ||
      !workspace ||
      !facilityId ||
      !accessAssignmentId
    ) return;
    const scopeSnapshot = {
      facilityId,
      accessAssignmentId,
      patientId: selectedPatient.id,
    };
    const dialogSnapshot = dialog;
    setPending(true);
    setError(null);
    setSuccess(null);
    const values = {
      heightCm: draft.includeAnthropometry ? numberOrNull(draft.heightCm) : null,
      weightKg: draft.includeAnthropometry ? numberOrNull(draft.weightKg) : null,
      systolicMmhg: draft.includePressure ? numberOrNull(draft.systolicMmhg) : null,
      diastolicMmhg: draft.includePressure ? numberOrNull(draft.diastolicMmhg) : null,
      temperatureC: draft.includeTemperature
        ? numberOrNull(draft.temperatureC)
        : null,
    };
    const payload = {
      facilityId: scopeSnapshot.facilityId,
      accessAssignmentId: scopeSnapshot.accessAssignmentId,
      patientId: scopeSnapshot.patientId,
      measuredAt: timestampFromInput(draft.measuredAt),
      context: draft.context,
      values,
      note: draft.note.trim() || null,
      reason: draft.reason.trim(),
      syntheticDataAcknowledged: draft.acknowledged,
      idempotencyKey: draft.idempotencyKey,
      ...(dialogSnapshot.mode === 'correct'
        ? { expectedVersion: dialogSnapshot.observation.current.version }
        : {}),
    };
    const endpoint =
      dialogSnapshot.mode === 'create'
        ? '/api/observations'
        : `/api/observations/${encodeURIComponent(dialogSnapshot.observation.id)}`;
    try {
      const response = await fetch(endpoint, {
        method: dialogSnapshot.mode === 'create' ? 'POST' : 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const result = (await response.json()) as ObservationsResponse;
      if (!response.ok || !result.observation) {
        const failure = errorFrom(result, 'Не удалось сохранить показатели.');
        setError(failure);
        return;
      }
      setDialog(null);
      setSuccess(
        dialogSnapshot.mode === 'create'
          ? 'Показатели записаны в D1 без автоматической медицинской оценки.'
          : `Исправление сохранено как версия ${result.observation.current.version}; предыдущая версия осталась в истории.`,
      );
      await load(
        scopeSnapshot.facilityId,
        scopeSnapshot.accessAssignmentId,
        scopeSnapshot.patientId,
      );
    } catch {
      setError({ code: 'UNKNOWN_OUTCOME', message: unknownObservationOutcomeMessage() });
    } finally {
      setPending(false);
    }
  }

  if (loadState === 'loading') {
    return <PageState icon={<LoaderCircle className={styles.spin} />} title="Загружаем показатели" text="Читаем текущие версии и историю из D1." />;
  }
  if (loadState === 'assignment') {
    return (
      <PageState
        icon={<Activity />}
        title="Выберите рабочий контур"
        text="Назначения по отделениям не объединяются. Роль и права будут взяты только из выбранного контура."
      >
        <select aria-label="Рабочий контур" defaultValue="" onChange={(event) => chooseAssignment(event.target.value)}>
          <option disabled value="">Выберите назначение</option>
          {assignmentOptions.map((option) => (
            <option key={option.assignmentId} value={option.assignmentId}>
              {option.organizationName} · {option.facilityName} · {option.departmentName} · {roleLabels[option.role]}
            </option>
          ))}
        </select>
      </PageState>
    );
  }
  if (loadState === 'unauthenticated') {
    return <PageState icon={<AlertCircle />} title="Требуется вход" text="Откройте ORION Clinic через авторизованный контур." />;
  }
  if (loadState === 'forbidden') {
    return <PageState icon={<ShieldCheck />} title="Нет доступа" text="В выбранном рабочем контуре показатели недоступны." />;
  }
  if (loadState === 'error' || !workspace) {
    return (
      <PageState icon={<AlertCircle />} title="Показатели недоступны" text={error?.message ?? 'Не удалось загрузить данные.'}>
        <button className={styles.secondaryButton} onClick={() => void load(facilityId, accessAssignmentId)} type="button"><RefreshCw size={17} />Повторить</button>
      </PageState>
    );
  }

  return (
    <main className={styles.main}>
      <header className={styles.pageHeader}>
        <div>
          <span className={styles.eyebrow}>Phase 8A · фиксация без интерпретации</span>
          <h1>Показатели пациента</h1>
          <p>Рост, вес, рассчитанный ИМТ, артериальное давление и температура сохраняются как неизменяемые версии с источником, временем и автором.</p>
        </div>
        <div className={styles.headerActions}>
          {assignmentOptions.length > 1 ? (
            <label className={styles.scopeSelector}>
              <span>Рабочий контур</span>
              <select
                aria-label="Рабочий контур показателей"
                disabled={pending || dialog !== null}
                onChange={(event) => chooseAssignment(event.target.value)}
                value={accessAssignmentId}
              >
                {assignmentOptions.map((option) => (
                  <option key={option.assignmentId} value={option.assignmentId}>
                    {option.facilityName} · {option.departmentName} · {roleLabels[option.role]}
                  </option>
                ))}
              </select>
            </label>
          ) : null}
          <div className={styles.sourceBadge}>
            <ShieldCheck aria-hidden="true" size={21} />
            <span><strong>{workspace.sourceLabel}</strong><small>Решение о критичности ORION не принимает</small></span>
          </div>
        </div>
      </header>

      {success ? <div className={styles.successMessage} role="status"><CheckCircle2 size={18} /><span>{success}</span><button aria-label="Закрыть сообщение" onClick={() => setSuccess(null)} type="button"><X size={17} /></button></div> : null}
      {error && !dialog ? <div className={styles.errorMessage} role="alert"><AlertCircle size={18} /><span><strong>{error.message}</strong>{error.requestId ? <small>{error.requestId}</small> : null}</span><button aria-label="Закрыть ошибку" onClick={() => setError(null)} type="button"><X size={17} /></button></div> : null}

      <section className={styles.stats} aria-label="Сводка показателей">
        <article><UserRound size={20} /><span><strong>{workspace.patients.length}</strong><small>доступных пациентов</small></span></article>
        <article><Activity size={20} /><span><strong>{workspace.observations.length}</strong><small>текущих записей</small></span></article>
        <article><FileClock size={20} /><span><strong>{correctionCount}</strong><small>сохранённых исправлений</small></span></article>
        <article><ShieldCheck size={20} /><span><strong>0</strong><small>автоматических решений</small></span></article>
      </section>

      <section className={styles.boundary}>
        <AlertCircle aria-hidden="true" size={20} />
        <div><strong>Порог критичности не настроен</strong><p>{workspace.thresholdPolicy.message} Значения нужно оценить сотруднику по действующим правилам клиники.</p></div>
        <span>{workspace.thresholdPolicy.decision}</span>
      </section>

      <section className={styles.workspace}>
        <aside className={styles.patientList}>
          <header><span>Пациенты <strong>{filteredPatients.length}</strong></span><small>D1</small></header>
          <label className={styles.searchField}><Search size={17} /><input aria-label="Поиск пациента" onChange={(event) => setSearch(event.target.value)} placeholder="ФИО или номер карты" value={search} /></label>
          <div className={styles.patientScroll}>
            {filteredPatients.map((patient) => {
              const count = workspace.observations.filter((item) => item.patient.id === patient.id).length;
              return (
                <button className={`${styles.patientCard} ${selectedPatientId === patient.id ? styles.patientCardActive : ''}`} key={patient.id} onClick={() => choosePatient(patient)} type="button">
                  <strong>{patient.displayName}</strong><small>{patient.medicalRecordNumber}</small><span>{count === 0 ? 'Нет измерений' : `${count} ${count === 1 ? 'запись' : 'записей'}`}</span>
                </button>
              );
            })}
            {filteredPatients.length === 0 ? <div className={styles.emptyList}><UserRound size={24} /><strong>Пациенты не найдены</strong><p>Измените строку поиска.</p></div> : null}
          </div>
        </aside>

        <div className={styles.detail}>
          {selectedPatient ? (
            <>
              <header className={styles.detailHeader}>
                <div><span className={styles.eyebrow}>Текущая карта показателей</span><h2>{selectedPatient.displayName}</h2><p>{selectedPatient.medicalRecordNumber} · {workspace.facility.name}</p></div>
                <button className={styles.primaryButton} onClick={openCreate} type="button"><Plus size={18} />Записать показатели</button>
              </header>

              {selectedObservations.length > 0 ? (
                <div className={styles.observationList}>
                  {selectedObservations.map((observation) => (
                    <ObservationCard
                      canCorrect={canCorrectObservation(workspace.viewer, observation)}
                      key={observation.id}
                      observation={observation}
                      onCorrect={() => openCorrection(observation)}
                      timeZone={workspace.timeZone}
                    />
                  ))}
                </div>
              ) : (
                <div className={styles.emptyDetail}><Activity size={32} /><h3>Показателей пока нет</h3><p>Запишите одно или несколько измерений. Пустые группы не будут сохраняться, а ИМТ вычислится из роста и веса.</p><button className={styles.primaryButton} onClick={openCreate} type="button"><Plus size={18} />Первая запись</button></div>
              )}
            </>
          ) : (
            <div className={styles.emptyDetail}><UserRound size={32} /><h3>Нет доступных пациентов</h3><p>Сначала создайте синтетическую карточку пациента в реестре.</p></div>
          )}
        </div>
      </section>

      {dialog && selectedPatient ? (
        <div className={styles.dialogBackdrop} onMouseDown={(event) => { if (event.currentTarget === event.target) closeDialog(); }}>
          <form aria-labelledby="observation-dialog-title" aria-modal="true" className={styles.dialog} onSubmit={submit} role="dialog">
            <header><div><span className={styles.eyebrow}>{dialog.mode === 'create' ? 'Новая неизменяемая запись' : `Исправление версии ${dialog.observation.current.version}`}</span><h2 id="observation-dialog-title">{dialog.mode === 'create' ? 'Записать показатели' : 'Создать новую версию'}</h2><p>{selectedPatient.displayName} · {selectedPatient.medicalRecordNumber}</p></div><button aria-label="Закрыть" disabled={pending} onClick={closeDialog} type="button"><X size={20} /></button></header>

            {error ? <div className={styles.dialogError} role="alert"><AlertCircle size={18} /><span><strong>{error.message}</strong>{error.requestId ? <small>{error.requestId}</small> : null}</span></div> : null}

            <div className={styles.formGrid}>
              <label><span>Время измерения</span><input onChange={(event) => setDraft((current) => ({ ...current, measuredAt: event.target.value }))} required type="datetime-local" value={draft.measuredAt} /></label>
              <label><span>Контекст</span><select onChange={(event) => setDraft((current) => ({ ...current, context: event.target.value as ObservationContext }))} value={draft.context}>{Object.entries(contextLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            </div>

            <MeasurementGroup checked={draft.includeAnthropometry} icon={<Scale size={19} />} label="Рост, вес и ИМТ" onChange={(checked) => setDraft((current) => ({ ...current, includeAnthropometry: checked }))}>
              <label><span>Рост, см</span><input disabled={!draft.includeAnthropometry} inputMode="decimal" max="250" min="40" onChange={(event) => setDraft((current) => ({ ...current, heightCm: event.target.value }))} required={draft.includeAnthropometry} step="0.1" type="number" value={draft.heightCm} /></label>
              <label><span>Вес, кг</span><input disabled={!draft.includeAnthropometry} inputMode="decimal" max="500" min="1" onChange={(event) => setDraft((current) => ({ ...current, weightKg: event.target.value }))} required={draft.includeAnthropometry} step="0.1" type="number" value={draft.weightKg} /></label>
              <div className={styles.derivedValue}><Ruler size={17} /><span>ИМТ</span><strong>{bmiPreview === null ? '—' : bmiPreview.toFixed(2)}</strong><small>кг/м² · рассчитывает алгоритм</small></div>
            </MeasurementGroup>

            <MeasurementGroup checked={draft.includePressure} icon={<Gauge size={19} />} label="Артериальное давление" onChange={(checked) => setDraft((current) => ({ ...current, includePressure: checked }))}>
              <label><span>Верхнее</span><input disabled={!draft.includePressure} inputMode="numeric" max="300" min="40" onChange={(event) => setDraft((current) => ({ ...current, systolicMmhg: event.target.value }))} required={draft.includePressure} step="1" type="number" value={draft.systolicMmhg} /><small>мм рт. ст.</small></label>
              <label><span>Нижнее</span><input disabled={!draft.includePressure} inputMode="numeric" max="200" min="20" onChange={(event) => setDraft((current) => ({ ...current, diastolicMmhg: event.target.value }))} required={draft.includePressure} step="1" type="number" value={draft.diastolicMmhg} /><small>мм рт. ст.</small></label>
            </MeasurementGroup>

            <MeasurementGroup checked={draft.includeTemperature} icon={<Thermometer size={19} />} label="Температура" onChange={(checked) => setDraft((current) => ({ ...current, includeTemperature: checked }))}>
              <label><span>Температура тела</span><input disabled={!draft.includeTemperature} inputMode="decimal" max="45" min="30" onChange={(event) => setDraft((current) => ({ ...current, temperatureC: event.target.value }))} required={draft.includeTemperature} step="0.1" type="number" value={draft.temperatureC} /><small>°C</small></label>
            </MeasurementGroup>

            <label className={styles.fullField}><span>Примечание</span><textarea maxLength={1000} onChange={(event) => setDraft((current) => ({ ...current, note: event.target.value }))} placeholder="Например, измерено после пяти минут покоя" rows={3} value={draft.note} /></label>
            <label className={styles.fullField}><span>{dialog.mode === 'create' ? 'Основание записи' : 'Причина исправления'}</span><input maxLength={500} minLength={3} onChange={(event) => setDraft((current) => ({ ...current, reason: event.target.value }))} required value={draft.reason} /></label>
            <label className={styles.confirmCheck}><input checked={draft.acknowledged} onChange={(event) => setDraft((current) => ({ ...current, acknowledged: event.target.checked }))} required type="checkbox" /><span><strong>Это синтетические тестовые данные</strong><small>ORION сохранит значения и происхождение, но не присвоит критический статус и не запустит перевод.</small></span></label>

            <footer><button className={styles.secondaryButton} disabled={pending} onClick={closeDialog} type="button">Отмена</button><button className={styles.primaryButton} disabled={pending || !draft.acknowledged} type="submit">{pending ? <LoaderCircle className={styles.spin} size={18} /> : dialog.mode === 'create' ? <Plus size={18} /> : <Pencil size={18} />}{pending ? 'Сохраняем…' : dialog.mode === 'create' ? 'Записать в D1' : 'Сохранить новую версию'}</button></footer>
          </form>
        </div>
      ) : null}
    </main>
  );
}

function MeasurementGroup({ checked, children, icon, label, onChange }: { checked: boolean; children: React.ReactNode; icon: React.ReactNode; label: string; onChange: (checked: boolean) => void }) {
  return (
    <fieldset className={`${styles.measurementGroup} ${checked ? styles.measurementGroupActive : ''}`}>
      <legend><label><input checked={checked} onChange={(event) => onChange(event.target.checked)} type="checkbox" />{icon}<span>{label}</span></label></legend>
      <div className={styles.measurementFields}>{children}</div>
    </fieldset>
  );
}

function ObservationCard({ canCorrect, observation, onCorrect, timeZone }: { canCorrect: boolean; observation: PatientObservationRecord; onCorrect: () => void; timeZone: string }) {
  const { current } = observation;
  const values = current.values;
  return (
    <article className={styles.observationCard}>
      <header><div><span className={styles.contextLabel}>{contextLabels[current.context]}</span><h3>{formatTimestamp(current.measuredAt, timeZone)}</h3></div><div className={styles.versionActions}><span className={styles.versionBadge}>Версия {current.version}{current.version > 1 ? ' · исправлено' : ''}</span>{canCorrect ? <button className={styles.secondaryButton} onClick={onCorrect} type="button"><Pencil size={16} />Исправить</button> : null}</div></header>
      <div className={styles.measurementCards}>
        {values.systolicMmhg !== null && values.diastolicMmhg !== null ? <div><Gauge size={20} /><span>Давление</span><strong>{values.systolicMmhg}/{values.diastolicMmhg}</strong><small>мм рт. ст.</small></div> : null}
        {values.temperatureC !== null ? <div><Thermometer size={20} /><span>Температура</span><strong>{values.temperatureC.toFixed(1)}</strong><small>°C</small></div> : null}
        {values.bmi !== null ? <div><Activity size={20} /><span>ИМТ</span><strong>{values.bmi.toFixed(2)}</strong><small>кг/м² · вычислено</small></div> : null}
        {values.heightCm !== null && values.weightKg !== null ? <div><Scale size={20} /><span>Рост / вес</span><strong>{values.heightCm} / {values.weightKg}</strong><small>см / кг</small></div> : null}
      </div>
      {current.note ? <p className={styles.note}>{current.note}</p> : null}
      <div className={styles.provenance}><span><UserRound size={15} /><b>{current.recordedBy}</b></span><span><Clock3 size={15} />Записано {formatTimestamp(current.recordedAt, timeZone)}</span><span><ShieldCheck size={15} />{current.sourceLabel}</span></div>
      {observation.history.length > 1 ? (
        <details className={styles.history}>
          <summary><History size={17} />История версий ({observation.history.length})</summary>
          <div>
            {observation.history.map((version) => (
              <section key={version.id}>
                <header><strong>Версия {version.version}</strong><span>{formatTimestamp(version.recordedAt, timeZone)}</span></header>
                <p>{version.changeReason}</p>
                <small>
                  {version.values.systolicMmhg !== null ? `АД ${version.values.systolicMmhg}/${version.values.diastolicMmhg} · ` : ''}
                  {version.values.temperatureC !== null ? `${version.values.temperatureC.toFixed(1)} °C · ` : ''}
                  {version.values.bmi !== null ? `ИМТ ${version.values.bmi.toFixed(2)} · ` : ''}
                  {version.recordedBy}
                </small>
              </section>
            ))}
          </div>
        </details>
      ) : null}
    </article>
  );
}

function PageState({ children, icon, text, title }: { children?: React.ReactNode; icon: React.ReactNode; text: string; title: string }) {
  return <main className={styles.statePanel}><div className={styles.stateIcon}>{icon}</div><h1>{title}</h1><p>{text}</p>{children}</main>;
}
