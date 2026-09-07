'use client';

import { useWorkspaceFetch, useWorkspaceUrl, useWorkspaceCanManage } from '@/lib/workspace-access-context';

import {
  Activity,
  CalendarDays,
  Check,
  Clock3,
  Download,
  FileArchive,
  FileText,
  FolderClock,
  MessageSquareText,
  Mic,
  Pencil,
  Plus,
  ShieldCheck,
  Sparkles,
  Square,
  X,
} from 'lucide-react';
import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useRouter } from 'next/navigation';
import { isEncounterResumable } from '@/lib/domain/encounter';
import { useLocalSpeechCapture } from '@/lib/local-speech-client';
import styles from './clinical-workspace.module.css';

type RecommendationState = 'pending' | 'accepted' | 'rejected' | 'expired';
type RecommendationReviewState =
  | 'pending'
  | 'accepted'
  | 'edited_and_accepted'
  | 'rejected'
  | 'expired';
type RecommendationMutationState =
  | 'idle'
  | 'saving'
  | 'success'
  | 'conflict'
  | 'error';
type RecommendationProvenance = {
  analysisRunId: string;
  provider: string;
  model: string;
  modelVersion: string;
  policyVersion: string;
  inputHash: string;
  sourceRecordIds: string[];
};
type PersistenceState =
  | 'loading'
  | 'saved'
  | 'saving'
  | 'error'
  | 'unauthenticated'
  | 'forbidden';

type RecoveryActionState = 'idle' | 'checking' | 'confirmed' | 'error';

type EncounterRecoverySnapshot = {
  source: 'server-d1';
  encounterId: string;
  status: 'in_progress' | 'review';
  encounterVersion: number;
  startedAt: number | null;
  revision: string;
  saved: {
    transcriptSegmentCount: number | null;
    clinicalSectionCount: number;
    reviewedClinicalSectionCount: number;
    acceptedRecommendationCount: number;
    protocolVersion: number | null;
    protocolStatus: 'draft' | 'signed' | null;
    amendmentCount: number;
    exportArtifactCount: number;
  };
  browserDraftsIncluded: false;
};

type Recommendation = {
  id: string;
  eyebrow: string;
  tone: 'question' | 'safety' | 'action';
  original: {
    title: string;
    content: string;
    evidence: Array<{ sourceId: string; quote?: string }>;
    provenance: RecommendationProvenance;
  };
  currentDerivative: {
    id: string;
    version: number;
    title: string;
    content: string;
    contentHash: string;
    evidence: Array<{ sourceId: string; quote?: string }>;
    provenance: RecommendationProvenance;
    reason: string;
    authoredByMembershipId: string;
    authoredByDisplayName: string;
    createdAt: number;
  } | null;
  review: {
    state: RecommendationReviewState;
    version: number;
    currentDecisionId: string | null;
    reviewedDerivativeVersionId: string | null;
    reviewerDisplayName: string | null;
    decidedAt: number | null;
  };
  effectiveContent: string | null;
  effectiveTitle: string | null;
  // Transitional fields remain in the API while this screen migrates.
  title: string;
  body: string;
  evidence: string;
  state: RecommendationState;
  version: number;
};

type ClinicalSectionReviewState =
  | 'empty'
  | 'ai_draft'
  | 'clinician_edited'
  | 'reviewed'
  | 'explicitly_absent';

type ClinicalSection = {
  code: string;
  title: string;
  content: string;
  reviewState: ClinicalSectionReviewState;
  version: number;
  evidence: string[];
  provenance: {
    sourceType: 'synthetic_fixture' | 'ai_draft' | 'clinician';
    sourceIds: string[];
  };
  reviewedBy: string | null;
  reviewedAt: number | null;
  updatedAt: number;
};

type SectionMutationState = 'idle' | 'saving' | 'success' | 'conflict' | 'error';

type ApiError = {
  code?: string;
  message?: string;
  requestId?: string;
};

type WorkspaceEncounter = {
  id: string;
  organizationId: string;
  organizationName: string;
  facilityId: string;
  facilityName: string;
  clinicianMembershipId: string;
  status:
    | 'draft'
    | 'ready'
    | 'in_progress'
    | 'review'
    | 'finalized'
    | 'amended'
    | 'cancelled';
  reasonForVisit: string | null;
  startedAt: number | null;
  updatedAt: number;
  version: number;
  patient: {
    id: string;
    medicalRecordNumber: string;
    displayName: string;
    birthDate: string | null;
    sexAtBirth: 'female' | 'male' | 'unknown' | 'not_recorded';
  };
};

type WorkspaceContext = {
  viewer: { id: string; displayName: string; role: string };
  organization: { id: string; name: string };
  facility: { id: string; name: string };
  encounter: WorkspaceEncounter;
  encounters: WorkspaceEncounter[];
};

type AccessAuditReceipt = {
  action: 'workspace.read';
  recordedAt: number;
};

type TranscriptTurn = {
  id: string;
  segmentIndex: number;
  version: number;
  role: 'doctor' | 'patient' | 'other' | 'unknown';
  roleSource: 'unassigned' | 'model' | 'voice_calibration' | 'manual';
  language: 'ru' | 'kk' | 'mixed' | 'unknown';
  text: string;
  startedAtMs: number;
  endedAtMs: number;
  state: 'provisional' | 'final' | 'corrected';
};

type ConsentType =
  | 'care'
  | 'transient_audio_processing'
  | 'audio_retention'
  | 'transcript_storage'
  | 'external_ai_processing'
  | 'data_exchange'
  | 'notifications';

type ConsentDecision = 'granted' | 'denied' | 'withdrawn';

type PersistedConsent = {
  id: string;
  type: ConsentType;
  decision: ConsentDecision;
  version: number;
  noticeLanguage: 'ru' | 'kk';
  source: 'written' | 'verbal' | 'digital';
  policyVersion: string;
  policyHash: string;
  externalProcessor: string | null;
  capturedBy: string;
  occurredAt: number;
  effectiveAt: number;
  expiresAt: number | null;
};

type ConsentPolicy = {
  version: string;
  sha256: string;
  documentPath: string;
  approvedForRealPatients: false;
};

type EncounterTransition = {
  encounterId: string;
  status: WorkspaceEncounter['status'];
  version: number;
  startedAt: number | null;
  updatedAt: number;
};

type CreatedSyntheticEncounter = {
  patient: WorkspaceEncounter['patient'];
  encounter: {
    id: string;
    status: 'draft';
    version: 1;
    reasonForVisit: string | null;
    startedAt: null;
  };
};

type ProtocolVersionSummary = {
  id: string;
  version: number;
  status: 'draft' | 'signed';
  sourceHash: string;
  createdAt: number;
  signedAt: number | null;
  headVersion: number;
};

type ProtocolAmendmentSummary = {
  id: string;
  sequence: number;
  baseProtocolId: string;
  protocolId: string;
  protocolVersion: number;
  reason: string;
  text: string;
  signedByMembershipId: string;
  signedByDisplayName: string;
  signedAt: number;
};

type ExportArtifactKind =
  | 'protocol_docx'
  | 'protocol_pdf'
  | 'transcript_txt'
  | 'audit_json'
  | 'bundle_zip';

type ExportArtifactSummary = {
  id: string;
  kind: ExportArtifactKind;
  filename: string;
  objectKey: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
  downloadUrl?: string;
};

const exportArtifactLabels: Record<ExportArtifactKind, string> = {
  protocol_docx: 'Протокол DOCX',
  protocol_pdf: 'Протокол PDF',
  transcript_txt: 'Расшифровка TXT',
  audit_json: 'Аудит JSON',
  bundle_zip: 'Полный комплект ZIP',
};

function formatFileSize(bytes: number) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / 1024 / 1024).toFixed(1)} МБ`;
}

const sectionStateLabels: Record<ClinicalSectionReviewState, string> = {
  empty: 'Не заполнено',
  ai_draft: 'Черновик ИИ · нужна проверка',
  clinician_edited: 'Изменено врачом · нужна проверка',
  reviewed: 'Проверено врачом',
  explicitly_absent: 'Сведения отсутствуют · подтверждено врачом',
};

function sectionStateStyle(state: ClinicalSectionReviewState) {
  if (state === 'reviewed') return 'reviewed';
  if (state === 'explicitly_absent') return 'absent';
  if (state === 'ai_draft' || state === 'clinician_edited') return 'draft';
  return 'empty';
}

const encounterStatusLabels: Record<WorkspaceEncounter['status'], string> = {
  draft: 'Черновик',
  ready: 'Готов к началу',
  in_progress: 'Приём идёт',
  review: 'Проверка',
  finalized: 'Завершён',
  amended: 'Исправлен',
  cancelled: 'Отменён',
};

const visibleConsentPurposes: Array<{
  type: ConsentType;
  title: string;
  description: string;
}> = [
  {
    type: 'care',
    title: 'Приём и документация',
    description: 'Нужно для сохранения решений врача.',
  },
  {
    type: 'transcript_storage',
    title: 'Хранение расшифровки',
    description: 'Без согласия текст разговора скрыт.',
  },
  {
    type: 'transient_audio_processing',
    title: 'Локальная обработка аудио',
    description: 'Реплики обрабатываются локально; сырое аудио не сохраняется.',
  },
  {
    type: 'external_ai_processing',
    title: 'Передача расшифровки в Groq',
    description: 'Отдельное согласие только для создания черновиков после проверки врачом.',
  },
];

const consentDecisionLabels: Record<ConsentDecision, string> = {
  granted: 'Предоставлено',
  denied: 'Отказ',
  withdrawn: 'Отозвано',
};

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  return `${String(Math.floor(seconds / 60)).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
}

function transcriptRoleLabel(role: TranscriptTurn['role']) {
  if (role === 'doctor') return 'Врач';
  if (role === 'patient') return 'Пациент';
  if (role === 'other') return 'Другой участник';
  return 'Роль не подтверждена';
}

function speechStatusLabel(status: ReturnType<typeof useLocalSpeechCapture>['status']) {
  if (status === 'requesting_permission') return 'Запрашиваем доступ к микрофону';
  if (status === 'connecting') return 'Подключаем локальный STT';
  if (status === 'listening') return 'Локальная расшифровка активна';
  if (status === 'stopping') return 'Дожидаемся сохранения реплик';
  if (status === 'error') return 'Речевой контур требует повтора';
  return 'Микрофон выключен';
}

function patientAge(birthDate: string | null) {
  if (!birthDate) return null;
  const birth = new Date(`${birthDate}T00:00:00Z`);
  if (Number.isNaN(birth.valueOf())) return null;
  const now = new Date();
  let age = now.getUTCFullYear() - birth.getUTCFullYear();
  const beforeBirthday =
    now.getUTCMonth() < birth.getUTCMonth() ||
    (now.getUTCMonth() === birth.getUTCMonth() &&
      now.getUTCDate() < birth.getUTCDate());
  if (beforeBirthday) age -= 1;
  return age >= 0 && age < 130 ? age : null;
}

export function ClinicalWorkspace() {
  const fetch = useWorkspaceFetch();
  const scopeUrl = useWorkspaceUrl();
  const canManageWorkspace = useWorkspaceCanManage();
  const router = useRouter();
  const [activeSection, setActiveSection] = useState('complaints');
  const [recommendations, setRecommendations] =
    useState<Recommendation[]>([]);
  const [workspaceContext, setWorkspaceContext] =
    useState<WorkspaceContext | null>(null);
  const [accessAuditReceipt, setAccessAuditReceipt] =
    useState<AccessAuditReceipt | null>(null);
  const [transcript, setTranscript] = useState<TranscriptTurn[]>([]);
  const [editingTranscriptId, setEditingTranscriptId] = useState<string | null>(
    null,
  );
  const [transcriptDraft, setTranscriptDraft] = useState<{
    text: string;
    role: TranscriptTurn['role'];
    language: TranscriptTurn['language'];
  } | null>(null);
  const [transcriptCorrectionPending, setTranscriptCorrectionPending] =
    useState(false);
  const [transcriptMessage, setTranscriptMessage] = useState<string | null>(null);
  const [consents, setConsents] = useState<PersistedConsent[]>([]);
  const [consentPolicy, setConsentPolicy] = useState<ConsentPolicy | null>(null);
  const [consentNoticeLanguage, setConsentNoticeLanguage] =
    useState<'ru' | 'kk'>('ru');
  const [pendingConsentType, setPendingConsentType] =
    useState<ConsentType | null>(null);
  const [consentMessage, setConsentMessage] = useState<string | null>(null);
  const [confirmConsentWithdrawalType, setConfirmConsentWithdrawalType] =
    useState<ConsentType | null>(null);
  const [encounterTransitionPending, setEncounterTransitionPending] =
    useState(false);
  const [encounterMessage, setEncounterMessage] = useState<string | null>(null);
  const [protocolVersion, setProtocolVersion] =
    useState<ProtocolVersionSummary | null>(null);
  const [showProtocolSigning, setShowProtocolSigning] = useState(false);
  const [protocolSigningAcknowledged, setProtocolSigningAcknowledged] =
    useState(false);
  const [protocolSigningPending, setProtocolSigningPending] = useState(false);
  const [amendments, setAmendments] = useState<ProtocolAmendmentSummary[]>([]);
  const [showAmendmentForm, setShowAmendmentForm] = useState(false);
  const [amendmentReason, setAmendmentReason] = useState('');
  const [amendmentText, setAmendmentText] = useState('');
  const [amendmentAcknowledged, setAmendmentAcknowledged] = useState(false);
  const [amendmentPending, setAmendmentPending] = useState(false);
  const [amendmentMessage, setAmendmentMessage] = useState<string | null>(null);
  const [exportArtifacts, setExportArtifacts] = useState<
    ExportArtifactSummary[]
  >([]);
  const [exportPending, setExportPending] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [showEncounterCreation, setShowEncounterCreation] = useState(false);
  const [encounterCreationPending, setEncounterCreationPending] =
    useState(false);
  const [encounterCreationMessage, setEncounterCreationMessage] =
    useState<string | null>(null);
  const [newPatientName, setNewPatientName] = useState('');
  const [newPatientBirthDate, setNewPatientBirthDate] = useState('');
  const [newPatientSex, setNewPatientSex] =
    useState<WorkspaceEncounter['patient']['sexAtBirth']>('not_recorded');
  const [newReasonForVisit, setNewReasonForVisit] = useState('');
  const [syntheticDataAcknowledged, setSyntheticDataAcknowledged] =
    useState(false);
  const [persistenceState, setPersistenceState] =
    useState<PersistenceState>('loading');
  const [recoverySnapshot, setRecoverySnapshot] =
    useState<EncounterRecoverySnapshot | null>(null);
  const [recoveryActionState, setRecoveryActionState] =
    useState<RecoveryActionState>('idle');
  const [recoveryMessage, setRecoveryMessage] = useState<string | null>(null);
  const [pendingRecommendationId, setPendingRecommendationId] =
    useState<string | null>(null);
  const [editingRecommendationId, setEditingRecommendationId] =
    useState<string | null>(null);
  const [recommendationDraft, setRecommendationDraft] = useState<{
    title: string;
    content: string;
    reason: string;
  } | null>(null);
  const [recommendationMutationState, setRecommendationMutationState] =
    useState<RecommendationMutationState>('idle');
  const [recommendationMessage, setRecommendationMessage] =
    useState<string | null>(null);
  const [recommendationRequestId, setRecommendationRequestId] =
    useState<string | null>(null);
  const [analysisState, setAnalysisState] = useState<
    'idle' | 'generating' | 'success' | 'error'
  >('idle');
  const [analysisMessage, setAnalysisMessage] = useState<string | null>(null);
  const [acknowledgedTranscriptFingerprint, setAcknowledgedTranscriptFingerprint] =
    useState<string | null>(null);
  const [clinicalSections, setClinicalSections] = useState<ClinicalSection[]>([]);
  const [sectionDrafts, setSectionDrafts] = useState<Record<string, string>>({});
  const [editingSectionCode, setEditingSectionCode] = useState<string | null>(null);
  const [pendingSectionCode, setPendingSectionCode] = useState<string | null>(null);
  const [sectionMutationState, setSectionMutationState] =
    useState<SectionMutationState>('idle');
  const [sectionMessage, setSectionMessage] = useState<string | null>(null);
  const [sectionRequestId, setSectionRequestId] = useState<string | null>(null);
  const [confirmAbsentCode, setConfirmAbsentCode] = useState<string | null>(null);
  const [pendingSectionSwitch, setPendingSectionSwitch] = useState<string | null>(
    null,
  );
  const sectionCommandKeys = useRef<Record<string, string>>({});
  const recommendationCommandKeys = useRef<Record<string, string>>({});
  const analysisCommandKeys = useRef<Record<string, string>>({});
  const consentCommandKeys = useRef<Record<string, string>>({});
  const encounterCommandKeys = useRef<Record<string, string>>({});
  const encounterCreationKeys = useRef<Record<string, string>>({});
  const transcriptCommandKeys = useRef<Record<string, string>>({});
  const protocolCommandKeys = useRef<Record<string, string>>({});
  const amendmentCommandKeys = useRef<Record<string, string>>({});
  const exportCommandKeys = useRef<Record<string, string>>({});
  const workspaceGridRef = useRef<HTMLDivElement>(null);

  const loadWorkspace = useCallback(async (encounterId?: string) => {
      try {
        const query = encounterId
          ? `?encounterId=${encodeURIComponent(encounterId)}`
          : '';
        const response = await fetch(`/api/workspace${query}`, {
          cache: 'no-store',
        });
        const payload = (await response.json()) as {
          viewer?: WorkspaceContext['viewer'];
          organization?: WorkspaceContext['organization'];
          facility?: WorkspaceContext['facility'];
          encounter?: WorkspaceEncounter;
          encounters?: WorkspaceEncounter[];
          recovery?: EncounterRecoverySnapshot | null;
          transcript?: TranscriptTurn[];
          consents?: PersistedConsent[];
          consentPolicy?: ConsentPolicy;
          recommendations?: Recommendation[];
          clinicalSections?: ClinicalSection[];
          protocolDraft?: ProtocolVersionSummary | null;
          amendments?: ProtocolAmendmentSummary[];
          exports?: ExportArtifactSummary[];
          accessAudit?: AccessAuditReceipt;
          error?: ApiError;
        };

        if (response.status === 401) {
          setWorkspaceContext(null);
          setAccessAuditReceipt(null);
          setTranscript([]);
          setConsents([]);
          setConsentPolicy(null);
          setRecommendations([]);
          setClinicalSections([]);
          setProtocolVersion(null);
          setAmendments([]);
          setExportArtifacts([]);
          setRecoverySnapshot(null);
          setRecoveryActionState('idle');
          setRecoveryMessage(null);
          setPersistenceState('unauthenticated');
          return false;
        }
        if (response.status === 403 || response.status === 404) {
          setWorkspaceContext(null);
          setAccessAuditReceipt(null);
          setTranscript([]);
          setConsents([]);
          setConsentPolicy(null);
          setRecommendations([]);
          setClinicalSections([]);
          setProtocolVersion(null);
          setAmendments([]);
          setExportArtifacts([]);
          setRecoverySnapshot(null);
          setRecoveryActionState('idle');
          setRecoveryMessage(null);
          setPersistenceState('forbidden');
          return false;
        }
        if (
          !response.ok ||
          !payload.viewer ||
          !payload.organization ||
          !payload.facility ||
          !payload.encounter ||
          !payload.encounters ||
          payload.accessAudit?.action !== 'workspace.read' ||
          typeof payload.accessAudit.recordedAt !== 'number' ||
          !payload.consents ||
          !payload.consentPolicy ||
          !payload.recommendations ||
          payload.clinicalSections?.length !== 8
        ) {
          throw new Error('Workspace is unavailable');
        }

        setWorkspaceContext({
          viewer: payload.viewer,
          organization: payload.organization,
          facility: payload.facility,
          encounter: payload.encounter,
          encounters: payload.encounters,
        });
        setAccessAuditReceipt(payload.accessAudit);
        setTranscript(payload.transcript ?? []);
        setConsents(payload.consents);
        setConsentPolicy(payload.consentPolicy);
        setRecommendations(payload.recommendations);
        setClinicalSections(payload.clinicalSections);
        setProtocolVersion(payload.protocolDraft ?? null);
        setAmendments(payload.amendments ?? []);
        setExportArtifacts(payload.exports ?? []);
        setRecoverySnapshot(payload.recovery ?? null);
        const currentUrl = new URL(window.location.href);
        currentUrl.searchParams.set('encounterId', payload.encounter.id);
        window.history.replaceState(null, '', scopeUrl(`${currentUrl.pathname}${currentUrl.search}`));
        setPersistenceState('saved');
        return true;
      } catch {
        setPersistenceState('error');
        return false;
      }
  }, [fetch, scopeUrl]);

  useEffect(() => {
    const requestedEncounterId = new URLSearchParams(window.location.search)
      .get('encounterId')
      ?.trim();
    const timer = window.setTimeout(
      () => void loadWorkspace(requestedEncounterId || undefined),
      0,
    );
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  const acceptedCount = useMemo(
    () =>
      recommendations.filter((item) =>
        ['accepted', 'edited_and_accepted'].includes(item.review.state),
      ).length,
    [recommendations],
  );
  const rejectedCount = useMemo(
    () => recommendations.filter((item) => item.state === 'rejected').length,
    [recommendations],
  );
  const pendingRecommendationCount = useMemo(
    () =>
      recommendations.filter((item) => item.review.state === 'pending').length,
    [recommendations],
  );
  const reviewedSectionCount = useMemo(
    () =>
      clinicalSections.filter((section) =>
        ['reviewed', 'explicitly_absent'].includes(section.reviewState),
      ).length,
    [clinicalSections],
  );
  const selectedSection = clinicalSections.find(
    (section) => section.code === activeSection,
  );
  const selectedDraft = selectedSection
    ? (sectionDrafts[selectedSection.code] ?? selectedSection.content)
    : '';
  const selectedDraftIsDirty = Boolean(
    selectedSection && selectedDraft !== selectedSection.content,
  );
  const hasDirtyDrafts = clinicalSections.some(
    (section) =>
      sectionDrafts[section.code] !== undefined &&
      sectionDrafts[section.code] !== section.content,
  );
  const selectedEncounterId = workspaceContext?.encounter.id ?? null;
  const resumableEncounters = useMemo(
    () =>
      (workspaceContext?.encounters ?? []).filter((encounter) =>
        isEncounterResumable(encounter.status),
      ),
    [workspaceContext?.encounters],
  );
  const activeRecovery =
    recoverySnapshot?.encounterId === selectedEncounterId
      ? recoverySnapshot
      : null;
  const serverStateConfirmed = persistenceState === 'saved';
  const recoveryConfirmed =
    !activeRecovery || recoveryActionState === 'confirmed';
  const workspaceActionsLocked =
    !canManageWorkspace || !serverStateConfirmed || !recoveryConfirmed;
  const selectedPatientAge = patientAge(
    workspaceContext?.encounter.patient.birthDate ?? null,
  );
  const currentCareConsent = consents.find(
    (consent) => consent.type === 'care',
  );
  const currentTranscriptConsent = consents.find(
    (consent) => consent.type === 'transcript_storage',
  );
  const currentAudioProcessingConsent = consents.find(
    (consent) => consent.type === 'transient_audio_processing',
  );
  const currentExternalAiConsent = consents.find(
    (consent) => consent.type === 'external_ai_processing',
  );
  const hasCurrentCareConsent = currentCareConsent?.decision === 'granted';
  const hasCurrentTranscriptConsent =
    currentTranscriptConsent?.decision === 'granted';
  const hasCurrentAudioProcessingConsent =
    currentAudioProcessingConsent?.decision === 'granted';
  const hasCurrentExternalAiConsent =
    currentExternalAiConsent?.decision === 'granted' &&
    currentExternalAiConsent.externalProcessor === 'groq';
  const speechAllowedByWorkspace =
    !workspaceActionsLocked &&
    workspaceContext?.encounter.status === 'in_progress' &&
    hasCurrentCareConsent &&
    hasCurrentTranscriptConsent &&
    hasCurrentAudioProcessingConsent;
  const handleSpeechSegment = useCallback((segment: TranscriptTurn) => {
    setTranscript((items) =>
      [...items.filter((item) => item.id !== segment.id), segment].sort(
        (left, right) => left.segmentIndex - right.segmentIndex,
      ),
    );
    setAcknowledgedTranscriptFingerprint(null);
    setAnalysisState('idle');
    setAnalysisMessage(null);
    setTranscriptMessage(
      'Реплика распознана локально и сохранена. Проверьте текст и роль говорящего.',
    );
  }, []);
  const speech = useLocalSpeechCapture({
    encounterId: selectedEncounterId,
    enabled: speechAllowedByWorkspace,
    onSegment: handleSpeechSegment,
    onStatusMessage: setTranscriptMessage,
  });
  const finalTranscript = useMemo(
    () =>
      transcript.filter(
        (segment) => segment.state === 'final' || segment.state === 'corrected',
      ),
    [transcript],
  );
  const transcriptSnapshotFingerprint = useMemo(
    () =>
      finalTranscript
        .map((segment) => `${segment.id}:${segment.version}`)
        .sort()
        .join('|'),
    [finalTranscript],
  );
  const transcriptSnapshotAcknowledged =
    transcriptSnapshotFingerprint.length > 0 &&
    acknowledgedTranscriptFingerprint === transcriptSnapshotFingerprint;
  const canGenerateSuggestions =
    !workspaceActionsLocked &&
    workspaceContext?.encounter.status === 'in_progress' &&
    hasCurrentCareConsent &&
    hasCurrentTranscriptConsent &&
    hasCurrentExternalAiConsent &&
    !speech.isRecording &&
    !speech.isBusy &&
    !speech.hasProvisional &&
    finalTranscript.length > 0 &&
    transcriptSnapshotAcknowledged &&
    analysisState !== 'generating';
  const canAcknowledgeTranscript =
    !workspaceActionsLocked &&
    workspaceContext?.encounter.status === 'in_progress' &&
    hasCurrentCareConsent &&
    hasCurrentTranscriptConsent &&
    hasCurrentExternalAiConsent &&
    !speech.isRecording &&
    !speech.isBusy &&
    !speech.hasProvisional &&
    finalTranscript.length > 0 &&
    analysisState !== 'generating';
  const speechUnavailableReason = !workspaceContext
    ? 'Сначала откройте доступный приём.'
    : workspaceContext.encounter.status !== 'in_progress'
      ? 'Микрофон доступен только во время приёма.'
      : !hasCurrentCareConsent ||
          !hasCurrentTranscriptConsent ||
          !hasCurrentAudioProcessingConsent
        ? 'Нужны согласия на приём, хранение текста и локальную обработку аудио.'
        : workspaceActionsLocked
          ? 'Сначала подтвердите серверное состояние приёма.'
          : null;
  const hasUnsavedChanges =
    hasDirtyDrafts ||
    editingTranscriptId !== null ||
    editingRecommendationId !== null ||
    speech.isRecording ||
    speech.isBusy ||
    speech.hasProvisional ||
    analysisState === 'generating' ||
    (showAmendmentForm &&
      (amendmentReason.trim().length > 0 || amendmentText.trim().length > 0));
  const clinicalRecordEditable =
    !workspaceActionsLocked &&
    (workspaceContext?.encounter.status === 'in_progress' ||
      workspaceContext?.encounter.status === 'review');
  const recommendationEditable =
    !workspaceActionsLocked &&
    workspaceContext?.encounter.status === 'in_progress' &&
    hasCurrentCareConsent;
  const bundleArtifact = exportArtifacts.find(
    (artifact) => artifact.kind === 'bundle_zip',
  );
  const nextEncounterStatus =
    workspaceContext?.encounter.status === 'draft'
      ? 'ready'
      : workspaceContext?.encounter.status === 'ready'
        ? 'in_progress'
        : null;

  useEffect(() => {
    if (!hasUnsavedChanges) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [hasUnsavedChanges]);

  function resetLocalEncounterState() {
    void speech.stop('cancelled');
    setSectionDrafts({});
    setEditingSectionCode(null);
    setEditingTranscriptId(null);
    setTranscriptDraft(null);
    setTranscriptMessage(null);
    setEditingRecommendationId(null);
    setRecommendationDraft(null);
    setRecommendationMutationState('idle');
    setRecommendationMessage(null);
    setRecommendationRequestId(null);
    setAnalysisState('idle');
    setAnalysisMessage(null);
    setAcknowledgedTranscriptFingerprint(null);
    setShowProtocolSigning(false);
    setProtocolSigningAcknowledged(false);
    setShowAmendmentForm(false);
    setAmendmentReason('');
    setAmendmentText('');
    setAmendmentAcknowledged(false);
    setAmendmentMessage(null);
    setExportMessage(null);
    setSectionMessage(null);
    setConsentMessage(null);
    setConfirmConsentWithdrawalType(null);
    setEncounterMessage(null);
    setActiveSection('complaints');
    setPendingSectionSwitch(null);
    setRecoveryActionState('idle');
    setRecoveryMessage(null);
  }

  async function changeEncounter(encounterId: string) {
    if (encounterId === selectedEncounterId) return;
    if (
      hasUnsavedChanges &&
      !window.confirm(
        'Есть несохранённый текст. При переходе к другому приёму эти изменения будут потеряны. Продолжить?',
      )
    ) {
      return;
    }

    await speech.stop('cancelled');
    setPersistenceState('loading');
    const loaded = await loadWorkspace(encounterId);
    if (loaded) {
      resetLocalEncounterState();
    } else {
      setEncounterMessage(
        'Не удалось подтвердить состояние выбранного приёма. Текущий черновик не изменён.',
      );
    }
  }

  function openPatientHistory() {
    const encounter = workspaceContext?.encounter;
    if (!encounter) return;
    if (
      hasUnsavedChanges &&
      !window.confirm(
        'Есть несохранённые изменения. Перед открытием карточки пациента сохраните их или подтвердите переход без сохранения.',
      )
    ) {
      return;
    }

    const query = new URLSearchParams({ facilityId: encounter.facilityId });
    router.push(
      `/patients/${encodeURIComponent(encounter.patient.id)}?${query.toString()}`,
    );
  }

  function openLiveConsultation() {
    if (!selectedEncounterId) return;
    if (
      hasUnsavedChanges &&
      !window.confirm(
        'Есть несохранённые изменения. Перед переходом в очный приём сохраните их или подтвердите переход без сохранения.',
      )
    ) {
      return;
    }
    router.push(
      scopeUrl(`/live?encounterId=${encodeURIComponent(selectedEncounterId)}`),
    );
  }

  function activateSection(sectionCode: string) {
    const section = clinicalSections.find((item) => item.code === sectionCode);
    if (!section) return;
    setActiveSection(section.code);
    setEditingSectionCode(
      sectionDrafts[section.code] !== undefined &&
        sectionDrafts[section.code] !== section.content
        ? section.code
        : null,
    );
    setSectionMessage(null);
    setSectionMutationState('idle');
    setConfirmAbsentCode(null);
    setPendingSectionSwitch(null);
  }

  function requestSectionSwitch(sectionCode: string) {
    if (sectionCode === activeSection) return;
    if (selectedDraftIsDirty) {
      setPendingSectionSwitch(sectionCode);
      return;
    }
    activateSection(sectionCode);
  }

  async function resumeCurrentEncounter() {
    if (!selectedEncounterId || !activeRecovery) return;

    setRecoveryActionState('checking');
    setRecoveryMessage('Проверяем точную серверную версию приёма…');
    setPersistenceState('loading');
    const loaded = await loadWorkspace(selectedEncounterId);
    if (!loaded) {
      setRecoveryActionState('error');
      setRecoveryMessage(
        'Актуальное состояние сервера не подтверждено. Клинические действия заблокированы до повторной проверки.',
      );
      return;
    }

    setRecoveryActionState('confirmed');
    setRecoveryMessage(
      'Показана подтверждённая серверная версия. Несохранённые данные браузера не восстанавливались.',
    );
    window.requestAnimationFrame(() => workspaceGridRef.current?.focus());
  }

  function beginTranscriptEdit(turn: TranscriptTurn) {
    if (!clinicalRecordEditable) return;
    setEditingTranscriptId(turn.id);
    setTranscriptDraft({
      text: turn.text,
      role: turn.role,
      language: turn.language,
    });
    setTranscriptMessage(null);
  }

  function cancelTranscriptEdit() {
    setEditingTranscriptId(null);
    setTranscriptDraft(null);
    setTranscriptMessage(null);
  }

  async function saveTranscriptCorrection(turn: TranscriptTurn) {
    if (
      !selectedEncounterId ||
      !transcriptDraft ||
      transcriptCorrectionPending ||
      workspaceActionsLocked
    ) {
      return;
    }
    if (!hasCurrentCareConsent || !hasCurrentTranscriptConsent) {
      setTranscriptMessage(
        'Нужны действующие решения пациента о приёме и хранении расшифровки.',
      );
      return;
    }

    const text = transcriptDraft.text.trim();
    if (!text) {
      setTranscriptMessage('Текст реплики не может быть пустым.');
      return;
    }

    const commandPayload = {
      encounterId: selectedEncounterId,
      segmentId: turn.id,
      expectedVersion: turn.version,
      text,
      role: transcriptDraft.role,
      language: transcriptDraft.language,
    };
    const commandFingerprint = JSON.stringify(commandPayload);
    const idempotencyKey =
      transcriptCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    transcriptCommandKeys.current[commandFingerprint] = idempotencyKey;
    setTranscriptCorrectionPending(true);
    setTranscriptMessage(null);
    setPersistenceState('saving');

    try {
      const response = await fetch('/api/workspace/transcript/correct', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commandPayload, idempotencyKey }),
      });
      const payload = (await response.json()) as {
        segment?: TranscriptTurn;
        error?: ApiError;
      };

      if (response.status === 401) {
        setPersistenceState('unauthenticated');
        setTranscriptMessage('Войдите как врач, чтобы исправить расшифровку.');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        delete transcriptCommandKeys.current[commandFingerprint];
        setPersistenceState('forbidden');
        setTranscriptMessage(
          payload.error?.message ?? 'Реплика больше не доступна этому врачу.',
        );
        return;
      }
      if (response.status === 409) {
        delete transcriptCommandKeys.current[commandFingerprint];
        setPersistenceState('saved');
        setTranscriptMessage(
          payload.error?.message ?? 'Реплика уже изменилась. Обновите данные.',
        );
        if (payload.error?.code === 'VERSION_CONFLICT') {
          setEditingTranscriptId(null);
          setTranscriptDraft(null);
          await loadWorkspace(selectedEncounterId);
        }
        return;
      }
      if (!response.ok || !payload.segment) {
        if (response.status < 500) {
          delete transcriptCommandKeys.current[commandFingerprint];
        }
        setPersistenceState('error');
        setTranscriptMessage(
          payload.error?.message ?? 'Не удалось сохранить исправление.',
        );
        return;
      }

      delete transcriptCommandKeys.current[commandFingerprint];
      setTranscript((items) =>
        items.map((item) => (item.id === turn.id ? payload.segment! : item)),
      );
      setEditingTranscriptId(null);
      setTranscriptDraft(null);
      setTranscriptMessage(
        `Исправление сохранено как версия ${payload.segment.version}; исходная версия не удалена.`,
      );
      setPersistenceState('saved');
    } catch {
      setPersistenceState('error');
      setTranscriptMessage(
        'Ответ сервера не получен. Результат исправления неизвестен; проверьте точную серверную версию перед повтором.',
      );
    } finally {
      setTranscriptCorrectionPending(false);
    }
  }

  function beginSectionEdit(section: ClinicalSection) {
    setEditingSectionCode(section.code);
    setSectionDrafts((drafts) => ({
      ...drafts,
      [section.code]: drafts[section.code] ?? section.content,
    }));
    setSectionMutationState('idle');
    setSectionMessage(null);
    setConfirmAbsentCode(null);
  }

  function cancelSectionEdit(section: ClinicalSection) {
    setSectionDrafts((drafts) => {
      const next = { ...drafts };
      delete next[section.code];
      return next;
    });
    setEditingSectionCode(null);
    setSectionMutationState('idle');
    setSectionMessage(null);
  }

  async function advanceEncounter() {
    const encounter = workspaceContext?.encounter;
    if (
      !encounter ||
      !nextEncounterStatus ||
      encounterTransitionPending ||
      workspaceActionsLocked
    ) {
      return;
    }
    if (!hasCurrentCareConsent) {
      setEncounterMessage(
        'Сначала зафиксируйте действующее решение пациента о приёме.',
      );
      return;
    }

    const commandFingerprint = `${encounter.id}:${nextEncounterStatus}:${encounter.version}`;
    const idempotencyKey =
      encounterCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    encounterCommandKeys.current[commandFingerprint] = idempotencyKey;
    setEncounterTransitionPending(true);
    setEncounterMessage(null);
    setPersistenceState('saving');

    try {
      const response = await fetch('/api/workspace/encounters/transition', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: encounter.id,
          nextStatus: nextEncounterStatus,
          expectedVersion: encounter.version,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        transition?: EncounterTransition;
        error?: ApiError;
      };

      if (response.status === 401) {
        setPersistenceState('unauthenticated');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        setPersistenceState('forbidden');
        return;
      }
      if (response.status === 409) {
        delete encounterCommandKeys.current[commandFingerprint];
        setEncounterMessage(
          payload.error?.message ?? 'Статус приёма изменился в другой вкладке.',
        );
        await loadWorkspace(encounter.id);
        return;
      }
      if (!response.ok || !payload.transition) {
        if (response.status < 500) {
          delete encounterCommandKeys.current[commandFingerprint];
        }
        setEncounterMessage(
          payload.error?.message ?? 'Не удалось изменить статус приёма.',
        );
        setPersistenceState('error');
        return;
      }

      delete encounterCommandKeys.current[commandFingerprint];
      setEncounterMessage(
        payload.transition.status === 'ready'
          ? 'Приём подготовлен. Начать его сможет только назначенный врач.'
          : 'Начало приёма зафиксировано в аудите.',
      );
      await loadWorkspace(encounter.id);
    } catch {
      setEncounterMessage(
        'Ответ сервера не получен. Итог перехода неизвестен; повторно проверьте этот приём перед следующим действием.',
      );
      setPersistenceState('error');
    } finally {
      setEncounterTransitionPending(false);
    }
  }

  async function beginProtocolReview() {
    const encounter = workspaceContext?.encounter;
    if (
      !encounter ||
      encounter.status !== 'in_progress' ||
      encounterTransitionPending ||
      workspaceActionsLocked
    ) {
      return;
    }
    if (
      speech.isRecording ||
      speech.isBusy ||
      speech.hasProvisional ||
      analysisState === 'generating'
    ) {
      setEncounterMessage(
        'Сначала остановите микрофон, дождитесь сохранения реплик и завершения анализа.',
      );
      return;
    }
    if (!hasCurrentCareConsent) {
      setEncounterMessage(
        'Сначала зафиксируйте действующее решение пациента о приёме.',
      );
      return;
    }

    const commandFingerprint = `${encounter.id}:review:${encounter.version}`;
    const idempotencyKey =
      protocolCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    protocolCommandKeys.current[commandFingerprint] = idempotencyKey;
    setEncounterTransitionPending(true);
    setEncounterMessage(null);
    setPersistenceState('saving');

    try {
      const response = await fetch('/api/workspace/protocols/draft', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: encounter.id,
          expectedEncounterVersion: encounter.version,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        protocol?: ProtocolVersionSummary & { status: 'draft' };
        transition?: EncounterTransition & { endedAt: number };
        error?: ApiError;
      };

      if (response.status === 401) {
        setPersistenceState('unauthenticated');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        delete protocolCommandKeys.current[commandFingerprint];
        setPersistenceState('forbidden');
        setEncounterMessage(
          payload.error?.message ?? 'Приём больше не доступен этому врачу.',
        );
        return;
      }
      if (response.status === 409) {
        delete protocolCommandKeys.current[commandFingerprint];
        setEncounterMessage(
          payload.error?.message ?? 'Исходные данные приёма изменились.',
        );
        if (payload.error?.code === 'VERSION_CONFLICT') {
          await loadWorkspace(encounter.id);
        }
        return;
      }
      if (!response.ok || !payload.protocol || !payload.transition) {
        if (response.status < 500) {
          delete protocolCommandKeys.current[commandFingerprint];
        }
        setPersistenceState(response.status === 422 ? 'saved' : 'error');
        setEncounterMessage(
          payload.error?.message ?? 'Не удалось создать черновик протокола.',
        );
        return;
      }

      delete protocolCommandKeys.current[commandFingerprint];
      setProtocolVersion(payload.protocol);
      setEncounterMessage(
        `Черновик протокола v${payload.protocol.version} создан из подтверждённых версий. Подписание ещё недоступно.`,
      );
      await loadWorkspace(encounter.id);
    } catch {
      setPersistenceState('error');
      setEncounterMessage(
        'Ответ сервера не получен. Создание черновика могло завершиться; сначала повторно загрузите этот приём.',
      );
    } finally {
      setEncounterTransitionPending(false);
    }
  }

  async function signProtocol() {
    const encounter = workspaceContext?.encounter;
    if (
      !encounter ||
      encounter.status !== 'review' ||
      !protocolVersion ||
      protocolVersion.status !== 'draft' ||
      !protocolSigningAcknowledged ||
      hasUnsavedChanges ||
      protocolSigningPending ||
      workspaceActionsLocked
    ) {
      return;
    }

    const commandPayload = {
      encounterId: encounter.id,
      protocolId: protocolVersion.id,
      expectedProtocolVersion: protocolVersion.version,
      expectedEncounterVersion: encounter.version,
      expectedProtocolHeadVersion: protocolVersion.headVersion,
      acknowledgeClinicianResponsibility: true as const,
      confirmation: 'SIGN_SYNTHETIC_PROTOCOL' as const,
    };
    const commandFingerprint = JSON.stringify(commandPayload);
    const idempotencyKey =
      protocolCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    protocolCommandKeys.current[commandFingerprint] = idempotencyKey;
    setProtocolSigningPending(true);
    setEncounterMessage(null);
    setPersistenceState('saving');

    try {
      const response = await fetch('/api/workspace/protocols/sign', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commandPayload, idempotencyKey }),
      });
      const payload = (await response.json()) as {
        protocol?: ProtocolVersionSummary & {
          status: 'signed';
          signedAt: number;
        };
        transition?: EncounterTransition & {
          endedAt: number;
          finalizedAt: number;
        };
        error?: ApiError;
      };

      if (response.status === 401) {
        setPersistenceState('unauthenticated');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        delete protocolCommandKeys.current[commandFingerprint];
        setPersistenceState('forbidden');
        setEncounterMessage(
          payload.error?.message ?? 'Документ больше не доступен этому врачу.',
        );
        return;
      }
      if (!response.ok || !payload.protocol || !payload.transition) {
        if (response.status < 500) {
          delete protocolCommandKeys.current[commandFingerprint];
        }
        setPersistenceState(response.status < 500 ? 'saved' : 'error');
        setEncounterMessage(
          payload.error?.message ?? 'Не удалось подписать протокол.',
        );
        if (response.status === 409) {
          await loadWorkspace(encounter.id);
        }
        return;
      }

      delete protocolCommandKeys.current[commandFingerprint];
      setProtocolVersion(payload.protocol);
      setShowProtocolSigning(false);
      setProtocolSigningAcknowledged(false);
      setEncounterMessage(
        `Протокол v${payload.protocol.version} подписан врачом. Приём финализирован.`,
      );
      await loadWorkspace(encounter.id);
    } catch {
      setPersistenceState('error');
      setEncounterMessage(
        'Ответ сервера не получен. Статус подписи неизвестен; сначала повторно загрузите этот приём.',
      );
    } finally {
      setProtocolSigningPending(false);
    }
  }

  async function amendSignedProtocol() {
    const encounter = workspaceContext?.encounter;
    const reason = amendmentReason.trim();
    const text = amendmentText.trim();
    if (
      !encounter ||
      !['finalized', 'amended'].includes(encounter.status) ||
      !protocolVersion ||
      protocolVersion.status !== 'signed' ||
      amendmentPending ||
      workspaceActionsLocked
    ) {
      return;
    }
    if (reason.length < 10) {
      setAmendmentMessage('Опишите причину корректировки минимум в 10 символах.');
      return;
    }
    if (!text) {
      setAmendmentMessage('Добавьте точный текст корректировки.');
      return;
    }
    if (!amendmentAcknowledged) {
      setAmendmentMessage('Подтвердите личную проверку и подписание врачом.');
      return;
    }

    const commandPayload = {
      encounterId: encounter.id,
      baseProtocolId: protocolVersion.id,
      expectedProtocolVersion: protocolVersion.version,
      expectedProtocolHeadVersion: protocolVersion.headVersion,
      expectedEncounterVersion: encounter.version,
      reason,
      text,
      acknowledgeClinicianResponsibility: true as const,
      confirmation: 'SIGN_SYNTHETIC_AMENDMENT' as const,
    };
    const commandFingerprint = JSON.stringify(commandPayload);
    const idempotencyKey =
      amendmentCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    amendmentCommandKeys.current[commandFingerprint] = idempotencyKey;
    setAmendmentPending(true);
    setAmendmentMessage(null);
    setPersistenceState('saving');

    try {
      const response = await fetch('/api/workspace/protocols/amend', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commandPayload, idempotencyKey }),
      });
      const payload = (await response.json()) as {
        protocol?: ProtocolVersionSummary & {
          status: 'signed';
          signedAt: number;
        };
        amendment?: ProtocolAmendmentSummary;
        transition?: EncounterTransition & {
          endedAt: number | null;
          finalizedAt: number | null;
        };
        error?: ApiError;
      };

      if (response.status === 401) {
        setPersistenceState('unauthenticated');
        setAmendmentMessage('Войдите как назначенный врач.');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        delete amendmentCommandKeys.current[commandFingerprint];
        setPersistenceState('forbidden');
        setAmendmentMessage(
          payload.error?.message ?? 'Протокол недоступен текущему врачу.',
        );
        return;
      }
      if (!response.ok || !payload.protocol || !payload.amendment || !payload.transition) {
        if (response.status < 500) {
          delete amendmentCommandKeys.current[commandFingerprint];
        }
        setPersistenceState(response.status < 500 ? 'saved' : 'error');
        setAmendmentMessage(
          payload.error?.message ?? 'Не удалось подписать корректировку.',
        );
        if (response.status === 409) {
          await loadWorkspace(encounter.id);
        }
        return;
      }

      delete amendmentCommandKeys.current[commandFingerprint];
      setProtocolVersion(payload.protocol);
      setAmendments((current) => [...current, payload.amendment!]);
      setShowAmendmentForm(false);
      setAmendmentReason('');
      setAmendmentText('');
      setAmendmentAcknowledged(false);
      setExportArtifacts([]);
      setExportMessage(
        'Создана новая подписанная версия. Подготовьте новый комплект документов.',
      );
      setEncounterMessage(
        `Корректировка №${payload.amendment.sequence} подписана. Текущая версия протокола — v${payload.protocol.version}.`,
      );
      setAmendmentMessage(
        'Корректировка сохранена отдельной неизменяемой подписанной версией.',
      );
      setPersistenceState('saved');
      await loadWorkspace(encounter.id);
    } catch {
      setPersistenceState('error');
      setAmendmentMessage(
        'Ответ сервера не получен. Статус корректировки неизвестен; сначала повторно загрузите этот приём.',
      );
    } finally {
      setAmendmentPending(false);
    }
  }

  async function generateExports() {
    const encounter = workspaceContext?.encounter;
    if (
      !encounter ||
      !['finalized', 'amended'].includes(encounter.status) ||
      !protocolVersion ||
      protocolVersion.status !== 'signed' ||
      exportPending ||
      workspaceActionsLocked
    ) {
      return;
    }

    const commandPayload = {
      encounterId: encounter.id,
      protocolId: protocolVersion.id,
      expectedProtocolVersion: protocolVersion.version,
      acknowledgeSyntheticExport: true as const,
    };
    const commandFingerprint = JSON.stringify(commandPayload);
    const idempotencyKey =
      exportCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    exportCommandKeys.current[commandFingerprint] = idempotencyKey;
    setExportPending(true);
    setExportMessage(null);
    setPersistenceState('saving');

    try {
      const response = await fetch('/api/workspace/exports/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commandPayload, idempotencyKey }),
      });
      const payload = (await response.json()) as {
        artifacts?: ExportArtifactSummary[];
        error?: ApiError;
      };

      if (response.status === 401) {
        setPersistenceState('unauthenticated');
        setExportMessage('Войдите как врач, чтобы подготовить документы.');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        delete exportCommandKeys.current[commandFingerprint];
        setPersistenceState('forbidden');
        setExportMessage(
          payload.error?.message ?? 'Документы недоступны текущему врачу.',
        );
        return;
      }
      if (response.status === 409 || response.status === 422) {
        delete exportCommandKeys.current[commandFingerprint];
        setPersistenceState('saved');
        setExportMessage(
          payload.error?.message ??
            'Подписанный источник изменился. Обновите приём и повторите.',
        );
        await loadWorkspace(encounter.id);
        return;
      }
      if (!response.ok || !payload.artifacts) {
        if (response.status < 500) {
          delete exportCommandKeys.current[commandFingerprint];
        }
        setPersistenceState('error');
        setExportMessage(
          payload.error?.message ?? 'Не удалось подготовить комплект документов.',
        );
        return;
      }

      delete exportCommandKeys.current[commandFingerprint];
      setExportArtifacts(payload.artifacts);
      setExportMessage(
        'Комплект проверен и сохранён. Каждое скачивание фиксируется в журнале аудита.',
      );
      setPersistenceState('saved');
    } catch {
      setPersistenceState('error');
      setExportMessage(
        'Ответ сервера не получен. Комплект мог быть подготовлен; сначала повторно загрузите этот приём.',
      );
    } finally {
      setExportPending(false);
    }
  }

  async function createSyntheticEncounter(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (
      !selectedEncounterId ||
      encounterCreationPending ||
      !serverStateConfirmed ||
      !syntheticDataAcknowledged
    ) {
      setEncounterCreationMessage(
        'Подтвердите, что вводите только вымышленные тестовые данные.',
      );
      return;
    }

    const commandPayload = {
      sourceEncounterId: selectedEncounterId,
      patient: {
        displayName: newPatientName.trim(),
        birthDate: newPatientBirthDate || null,
        sexAtBirth: newPatientSex,
      },
      reasonForVisit: newReasonForVisit.trim() || null,
      syntheticDataAcknowledged: true as const,
    };
    const commandFingerprint = JSON.stringify(commandPayload);
    const idempotencyKey =
      encounterCreationKeys.current[commandFingerprint] ?? crypto.randomUUID();
    encounterCreationKeys.current[commandFingerprint] = idempotencyKey;
    setEncounterCreationPending(true);
    setEncounterCreationMessage(null);
    setPersistenceState('saving');

    try {
      const response = await fetch('/api/workspace/encounters/create', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...commandPayload, idempotencyKey }),
      });
      const payload = (await response.json()) as {
        created?: CreatedSyntheticEncounter;
        error?: ApiError;
      };

      if (response.status === 401) {
        setPersistenceState('unauthenticated');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        setPersistenceState('forbidden');
        return;
      }
      if (!response.ok || !payload.created) {
        if (response.status < 500) {
          delete encounterCreationKeys.current[commandFingerprint];
        }
        setEncounterCreationMessage(
          payload.error?.message ?? 'Не удалось создать тестовый приём.',
        );
        setPersistenceState(response.status === 409 ? 'saved' : 'error');
        return;
      }

      delete encounterCreationKeys.current[commandFingerprint];
      setNewPatientName('');
      setNewPatientBirthDate('');
      setNewPatientSex('not_recorded');
      setNewReasonForVisit('');
      setSyntheticDataAcknowledged(false);
      setShowEncounterCreation(false);
      setEncounterCreationMessage(null);
      await loadWorkspace(payload.created.encounter.id);
    } catch {
      setEncounterCreationMessage(
        'Ответ сервера не получен. Приём мог быть создан; обновите список перед повтором с тем же запросом.',
      );
      setPersistenceState('error');
    } finally {
      setEncounterCreationPending(false);
    }
  }

  async function recordConsentDecision(
    consentType: ConsentType,
    decision: ConsentDecision,
  ) {
    if (!selectedEncounterId || pendingConsentType || !serverStateConfirmed) {
      return;
    }

    if (
      decision !== 'granted' &&
      ['care', 'transient_audio_processing', 'transcript_storage'].includes(
        consentType,
      )
    ) {
      await speech.stop('cancelled');
    }
    if (consentType === 'external_ai_processing' && decision !== 'granted') {
      setAcknowledgedTranscriptFingerprint(null);
      setAnalysisState('idle');
      setAnalysisMessage(null);
    }

    const current = consents.find((consent) => consent.type === consentType);
    const expectedVersion = current?.version ?? 0;
    const commandFingerprint = `${selectedEncounterId}:${consentType}:${decision}:${expectedVersion}:${consentNoticeLanguage}`;
    const idempotencyKey =
      consentCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    consentCommandKeys.current[commandFingerprint] = idempotencyKey;

    setPendingConsentType(consentType);
    setConfirmConsentWithdrawalType(null);
    setConsentMessage(null);
    setPersistenceState('saving');

    try {
      const response = await fetch('/api/workspace/consents/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: selectedEncounterId,
          consentType,
          decision,
          noticeLanguage: consentNoticeLanguage,
          source: 'verbal',
          expectedVersion,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        consent?: PersistedConsent;
        error?: ApiError;
      };

      if (response.status === 401) {
        setPersistenceState('unauthenticated');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        setPersistenceState('forbidden');
        return;
      }
      if (response.status === 409) {
        delete consentCommandKeys.current[commandFingerprint];
        setConsentMessage(
          payload.error?.message ?? 'Решение изменилось в другой вкладке.',
        );
        await loadWorkspace(selectedEncounterId);
        return;
      }
      if (!response.ok || !payload.consent) {
        if (response.status < 500) {
          delete consentCommandKeys.current[commandFingerprint];
        }
        setConsentMessage(
          payload.error?.message ?? 'Не удалось сохранить решение пациента.',
        );
        setPersistenceState('error');
        return;
      }

      setConsents((items) => {
        const next = items.filter((item) => item.type !== payload.consent?.type);
        return payload.consent ? [...next, payload.consent] : items;
      });
      delete consentCommandKeys.current[commandFingerprint];
      setConsentMessage(
        decision === 'granted'
          ? 'Предоставление согласия зафиксировано отдельной версией.'
          : decision === 'withdrawn'
            ? 'Отзыв зафиксирован; предыдущая версия сохранена в аудите.'
            : 'Отказ зафиксирован отдельной версией.',
      );
      setPersistenceState('saved');

      if (consentType === 'transcript_storage') {
        await loadWorkspace(selectedEncounterId);
      }
    } catch {
      setConsentMessage(
        'Ответ сервера не получен. Результат решения неизвестен; сначала повторно загрузите этот приём.',
      );
      setPersistenceState('error');
    } finally {
      setPendingConsentType(null);
    }
  }

  async function commitSection(
    section: ClinicalSection,
    action: 'save_draft' | 'mark_reviewed' | 'mark_absent',
  ) {
    if (pendingSectionCode || !selectedEncounterId) return;
    if (!hasCurrentCareConsent) {
      setSectionMutationState('error');
      setSectionMessage(
        'Сначала зафиксируйте действующее решение пациента о приёме.',
      );
      return;
    }

    const content =
      editingSectionCode === section.code
        ? (sectionDrafts[section.code] ?? section.content)
        : section.content;
    const commandFingerprint = JSON.stringify({
      encounterId: selectedEncounterId,
      sectionCode: section.code,
      action,
      content: action === 'mark_absent' ? '' : content,
      expectedVersion: section.version,
    });
    const idempotencyKey =
      sectionCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    sectionCommandKeys.current[commandFingerprint] = idempotencyKey;
    setPendingSectionCode(section.code);
    setSectionMutationState('saving');
    setSectionMessage(null);
    setSectionRequestId(null);

    try {
      const response = await fetch('/api/workspace/sections/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: selectedEncounterId,
          sectionCode: section.code,
          action,
          ...(action === 'mark_absent' ? {} : { content }),
          expectedVersion: section.version,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        section?: ClinicalSection;
        error?: ApiError;
      };

      if (response.status === 401) {
        delete sectionCommandKeys.current[commandFingerprint];
        setPersistenceState('unauthenticated');
        setSectionMutationState('error');
        setSectionMessage('Войдите как врач, чтобы сохранить запись.');
        return;
      }

      if (response.status === 403 || response.status === 404) {
        delete sectionCommandKeys.current[commandFingerprint];
        setPersistenceState('forbidden');
        setSectionMutationState('error');
        setSectionMessage(
          payload.error?.message ?? 'Приём больше не доступен этому врачу.',
        );
        setSectionRequestId(payload.error?.requestId ?? null);
        return;
      }

      if (response.status === 409) {
        delete sectionCommandKeys.current[commandFingerprint];
        setSectionMutationState('conflict');
        setSectionMessage(
          payload.error?.message ??
            'Раздел изменён в другой вкладке. Ваш текст не потерян.',
        );
        setSectionRequestId(payload.error?.requestId ?? null);
        return;
      }

      if (!response.ok || !payload.section) {
        if (response.status < 500) {
          delete sectionCommandKeys.current[commandFingerprint];
        }
        setSectionMutationState('error');
        setSectionMessage(
          payload.error?.message ?? 'Не удалось сохранить раздел.',
        );
        setSectionRequestId(payload.error?.requestId ?? null);
        return;
      }

      setClinicalSections((items) =>
        items.map((item) =>
          item.code === payload.section?.code ? payload.section : item,
        ),
      );
      delete sectionCommandKeys.current[commandFingerprint];
      setSectionDrafts((drafts) => {
        const next = { ...drafts };
        delete next[section.code];
        return next;
      });
      setEditingSectionCode(null);
      setConfirmAbsentCode(null);
      setSectionMutationState('success');
      setSectionMessage(
        action === 'mark_reviewed'
          ? 'Раздел проверен и сохранён в истории версий.'
          : action === 'mark_absent'
            ? 'Отсутствие сведений подтверждено врачом.'
            : 'Черновик врача сохранён. Раздел требует проверки.',
      );
      setPersistenceState('saved');
    } catch {
      setSectionMutationState('error');
      setPersistenceState('error');
      setSectionMessage(
        'Ответ сервера не получен. Ваш текст остался на экране, а результат сохранения нужно сверить с точной серверной версией.',
      );
    } finally {
      setPendingSectionCode(null);
    }
  }

  async function refreshAfterConflict() {
    if (!selectedEncounterId) return;
    const refreshed = await loadWorkspace(selectedEncounterId);
    if (!refreshed) {
      setSectionMutationState('conflict');
      setSectionMessage(
        'Не удалось загрузить серверную версию. Ваш текст по-прежнему сохранён на экране.',
      );
      return;
    }
    setSectionMutationState('idle');
    setSectionMessage('Серверная версия загружена; ваш текст сохранён в черновике.');
    setSectionRequestId(null);
  }

  async function copySelectedDraft() {
    try {
      await navigator.clipboard.writeText(selectedDraft);
      setSectionMessage('Ваш текст скопирован в буфер обмена.');
    } catch {
      setSectionMessage('Не удалось скопировать автоматически. Текст остаётся в редакторе.');
    }
  }

  function beginRecommendationEdit(recommendation: Recommendation) {
    if (!recommendationEditable || pendingRecommendationId) return;
    setEditingRecommendationId(recommendation.id);
    setRecommendationDraft({
      title: recommendation.currentDerivative?.title ?? recommendation.original.title,
      content:
        recommendation.currentDerivative?.content ?? recommendation.original.content,
      reason: '',
    });
    setRecommendationMutationState('idle');
    setRecommendationMessage(null);
    setRecommendationRequestId(null);
  }

  function cancelRecommendationEdit() {
    setEditingRecommendationId(null);
    setRecommendationDraft(null);
    setRecommendationMutationState('idle');
    setRecommendationMessage(null);
    setRecommendationRequestId(null);
  }

  async function saveRecommendationEdit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const current = recommendations.find(
      (item) => item.id === editingRecommendationId,
    );
    if (
      !current ||
      !recommendationDraft ||
      !selectedEncounterId ||
      !recommendationEditable ||
      pendingRecommendationId
    ) {
      return;
    }
    const title = recommendationDraft.title.trim();
    const content = recommendationDraft.content.trim();
    const reason = recommendationDraft.reason.trim();
    if (!title || !content || reason.length < 3) {
      setRecommendationMutationState('error');
      setRecommendationMessage(
        'Заполните заголовок, текст и основание редакции (минимум 3 символа).',
      );
      return;
    }
    const commandFingerprint = JSON.stringify({
      encounterId: selectedEncounterId,
      recommendationId: current.id,
      action: 'edit',
      expectedVersion: current.review.version,
      title,
      content,
      reason,
    });
    const idempotencyKey =
      recommendationCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    recommendationCommandKeys.current[commandFingerprint] = idempotencyKey;

    setPendingRecommendationId(current.id);
    setRecommendationMutationState('saving');
    setRecommendationMessage('Сохраняем отдельную неизменяемую версию врача…');
    setRecommendationRequestId(null);
    try {
      const response = await fetch('/api/workspace/recommendations/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: selectedEncounterId,
          recommendationId: current.id,
          expectedVersion: current.review.version,
          title,
          content,
          reason,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        recommendation?: Recommendation;
        error?: ApiError;
      };
      setRecommendationRequestId(payload.error?.requestId ?? null);
      if (response.status === 401) {
        delete recommendationCommandKeys.current[commandFingerprint];
        setPersistenceState('unauthenticated');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        delete recommendationCommandKeys.current[commandFingerprint];
        setPersistenceState('forbidden');
        return;
      }
      if (!response.ok || !payload.recommendation) {
        if (response.status < 500) {
          delete recommendationCommandKeys.current[commandFingerprint];
        }
        setRecommendationMutationState(
          response.status === 409 ? 'conflict' : 'error',
        );
        setRecommendationMessage(
          payload.error?.message ?? 'Не удалось сохранить версию врача.',
        );
        return;
      }
      setRecommendations((items) =>
        items.map((item) =>
          item.id === payload.recommendation?.id ? payload.recommendation : item,
        ),
      );
      delete recommendationCommandKeys.current[commandFingerprint];
      setEditingRecommendationId(null);
      setRecommendationDraft(null);
      setRecommendationMutationState('success');
      setRecommendationMessage(
        'Версия врача сохранена. Теперь её можно отдельно принять или отправить в корзину.',
      );
      setRecommendationRequestId(null);
    } catch {
      setRecommendationMutationState('error');
      setPersistenceState('error');
      setRecommendationMessage(
        'Ответ сервера не получен. Текст остался на экране, результат неизвестен; после сверки повтор использует тот же ключ.',
      );
    } finally {
      setPendingRecommendationId(null);
    }
  }

  async function refreshRecommendationAfterConflict() {
    const refreshed = await loadWorkspace(selectedEncounterId ?? undefined);
    if (!refreshed) {
      setRecommendationMutationState('conflict');
      setRecommendationMessage(
        'Не удалось загрузить серверную версию. Ваш текст остаётся в редакторе.',
      );
      return;
    }
    setRecommendationMutationState('idle');
    setRecommendationMessage(
      'Серверная версия обновлена; ваш текст остался в форме для сравнения.',
    );
    setRecommendationRequestId(null);
  }

  async function setRecommendationState(id: string, state: RecommendationState) {
    const current = recommendations.find((item) => item.id === id);
    if (
      !current ||
      pendingRecommendationId ||
      !selectedEncounterId ||
      !recommendationEditable ||
      editingRecommendationId !== null
    ) {
      return;
    }

    const decision =
      state === 'accepted' ? 'accept' : state === 'rejected' ? 'reject' : 'restore';
    const commandFingerprint = `${selectedEncounterId}:${id}:${decision}:${current.review.version}:${current.currentDerivative?.id ?? 'original'}`;
    const idempotencyKey =
      recommendationCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    recommendationCommandKeys.current[commandFingerprint] = idempotencyKey;

    setPendingRecommendationId(id);
    setRecommendationMutationState('saving');
    setRecommendationMessage('Фиксируем решение врача…');
    setRecommendationRequestId(null);

    try {
      const response = await fetch('/api/workspace/recommendations/decision', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: selectedEncounterId,
          recommendationId: id,
          decision,
          derivativeVersionId: current.currentDerivative?.id ?? null,
          expectedVersion: current.review.version,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        recommendation?: Recommendation;
        error?: ApiError;
      };

      if (response.status === 401) {
        delete recommendationCommandKeys.current[commandFingerprint];
        setPersistenceState('unauthenticated');
        return;
      }
      if (response.status === 403 || response.status === 404) {
        delete recommendationCommandKeys.current[commandFingerprint];
        setPersistenceState('forbidden');
        return;
      }
      if (!response.ok || !payload.recommendation) {
        if (response.status < 500) {
          delete recommendationCommandKeys.current[commandFingerprint];
        }
        setRecommendationMutationState(
          response.status === 409 ? 'conflict' : 'error',
        );
        setRecommendationMessage(
          payload.error?.message ?? 'Не удалось сохранить решение врача.',
        );
        setRecommendationRequestId(payload.error?.requestId ?? null);
        return;
      }

      setRecommendations((items) =>
        items.map((item) =>
          item.id === payload.recommendation?.id ? payload.recommendation : item,
        ),
      );
      delete recommendationCommandKeys.current[commandFingerprint];
      setRecommendationMutationState('success');
      setRecommendationMessage(
        state === 'accepted'
          ? current.currentDerivative
            ? 'Версия врача принята и войдёт в протокол.'
            : 'Оригинальная рекомендация принята и войдёт в протокол.'
          : state === 'rejected'
            ? 'Рекомендация сохранена в корзине и не войдёт в протокол.'
            : 'Рекомендация возвращена на проверку.',
      );
      setRecommendationRequestId(null);
    } catch {
      setRecommendationMutationState('error');
      setPersistenceState('error');
      setRecommendationMessage(
        'Ответ сервера не получен. Результат решения неизвестен; после сверки повтор использует тот же ключ операции.',
      );
    } finally {
      setPendingRecommendationId(null);
    }
  }

  async function generateClinicalDrafts() {
    if (!selectedEncounterId || !canGenerateSuggestions) {
      setAnalysisState('error');
      setAnalysisMessage(
        'Остановите запись, дождитесь финальных реплик и подтвердите точный снимок расшифровки.',
      );
      return;
    }

    const snapshot = finalTranscript.map(({ id, version }) => ({ id, version }));
    const commandFingerprint = JSON.stringify({
      encounterId: selectedEncounterId,
      snapshot,
    });
    const idempotencyKey =
      analysisCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
    analysisCommandKeys.current[commandFingerprint] = idempotencyKey;
    setAnalysisState('generating');
    setAnalysisMessage(
      `Groq анализирует ${finalTranscript.length} подтверждённых реплик…`,
    );

    try {
      const response = await fetch('/api/workspace/recommendations/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: selectedEncounterId,
          snapshot,
          acknowledged: true,
          idempotencyKey,
        }),
      });
      const payload = (await response.json()) as {
        runId?: string;
        replay?: boolean;
        suggestionCount?: number;
        sectionDraftCount?: number;
        error?: ApiError;
      };

      if (!response.ok || !payload.runId) {
        delete analysisCommandKeys.current[commandFingerprint];
        if (response.status === 401) setPersistenceState('unauthenticated');
        if (response.status === 403 || response.status === 404) {
          setPersistenceState('forbidden');
        }
        setAnalysisState('error');
        setAnalysisMessage(
          payload.error?.message ??
            'Не удалось создать черновики. Расшифровка и решения врача не изменены.',
        );
        return;
      }

      delete analysisCommandKeys.current[commandFingerprint];
      await loadWorkspace(selectedEncounterId);
      setAcknowledgedTranscriptFingerprint(null);
      setAnalysisState('success');
      setAnalysisMessage(
        payload.replay
          ? 'Черновики этого запроса уже были сохранены; показана серверная версия.'
          : `Создано подсказок: ${payload.suggestionCount ?? 0}; черновиков разделов: ${payload.sectionDraftCount ?? 0}. Каждый пункт требует решения врача.`,
      );
    } catch {
      setAnalysisState('error');
      setAnalysisMessage(
        'Ответ сервера не получен. Расшифровка сохранена; перед повтором сверьте её состояние.',
      );
    }
  }

  const persistenceLabel = {
    loading: 'D1 · загрузка состояния',
    saved: 'D1 · сохранено на сервере',
    saving: 'D1 · сохраняем решение',
    error: 'D1 · ошибка сохранения',
    unauthenticated: 'Требуется вход врача',
    forbidden: 'Нет доступа к приёму',
  }[persistenceState];

  return (
    <div className={styles.workspace}>
      <main className={styles.main}>
        <section className={styles.patientHeader}>
          <div>
            <div className={styles.crumbs}>
              Приёмы <span>/</span>{' '}
              {workspaceContext?.encounter.patient.medicalRecordNumber ?? 'доступ проверяется'}
            </div>
            <div className={styles.patientTitleRow}>
              <h1>{workspaceContext?.encounter.patient.displayName ?? 'Клиническая запись'}</h1>
              {workspaceContext && (
                <span className={styles.patientStatus}>
                  {encounterStatusLabels[workspaceContext.encounter.status]}
                </span>
              )}
              <span className={styles.syntheticLabel}>тестовые данные в БД</span>
              {accessAuditReceipt && (
                <span
                  className={styles.accessAuditBadge}
                  title={`Доступ к записи зафиксирован ${new Date(
                    accessAuditReceipt.recordedAt,
                  ).toLocaleString('ru-RU')}`}
                >
                  <ShieldCheck aria-hidden="true" size={13} />
                  Просмотр зафиксирован
                </span>
              )}
            </div>
            <p>
              {selectedPatientAge === null ? 'Возраст не указан' : `${selectedPatientAge} лет`}
              {' · '}
              {workspaceContext?.encounter.reasonForVisit ?? 'Причина обращения не указана'}
            </p>
          </div>
          <div className={styles.patientActions}>
            {workspaceContext && workspaceContext.encounters.length > 1 && (
              <label className={styles.encounterPicker}>
                <span>Назначенный приём</span>
                <select
                  value={workspaceContext.encounter.id}
                  onChange={(event) => void changeEncounter(event.target.value)}
                >
                  {workspaceContext.encounters.map((encounter) => (
                    <option key={encounter.id} value={encounter.id}>
                      {encounter.patient.displayName} ·{' '}
                      {encounter.patient.medicalRecordNumber} ·{' '}
                      {encounterStatusLabels[encounter.status]} ·{' '}
                      {encounter.facilityName}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <button
              className={styles.secondaryButton}
              onClick={openPatientHistory}
              type="button"
            >
              <CalendarDays size={17} /> История пациента
            </button>
            {selectedEncounterId && (
              <button
                className={styles.secondaryButton}
                onClick={openLiveConsultation}
                type="button"
              >
                <Mic size={17} /> Очный приём
              </button>
            )}
            <button
              className={styles.secondaryButton}
              onClick={() => {
                setShowEncounterCreation((value) => !value);
                setEncounterCreationMessage(null);
              }}
              type="button"
            >
              <Plus size={17} /> Новый тестовый приём
            </button>
            {nextEncounterStatus ? (
              <button
                className={styles.primaryButton}
                disabled={encounterTransitionPending || workspaceActionsLocked}
                onClick={() => void advanceEncounter()}
                type="button"
              >
                {encounterTransitionPending
                  ? 'Сохраняем…'
                  : nextEncounterStatus === 'ready'
                    ? 'Подготовить приём'
                    : 'Начать приём'}
              </button>
            ) : workspaceContext?.encounter.status === 'in_progress' ? (
              <button
                className={styles.primaryButton}
                disabled={
                  encounterTransitionPending ||
                  workspaceActionsLocked ||
                  speech.isRecording ||
                  speech.isBusy ||
                  speech.hasProvisional ||
                  analysisState === 'generating'
                }
                onClick={() => void beginProtocolReview()}
                type="button"
                title={
                  speech.isRecording || speech.isBusy || speech.hasProvisional
                    ? 'Сначала завершите локальную расшифровку'
                    : analysisState === 'generating'
                      ? 'Дождитесь завершения анализа'
                      : undefined
                }
              >
                {encounterTransitionPending
                  ? 'Фиксируем версии…'
                  : `К проверке · ${reviewedSectionCount}/8`}
              </button>
            ) : workspaceContext?.encounter.status === 'review' &&
              protocolVersion?.status === 'draft' ? (
              <button
                className={styles.primaryButton}
                disabled={hasUnsavedChanges || workspaceActionsLocked}
                onClick={() => {
                  setShowProtocolSigning((value) => !value);
                  setProtocolSigningAcknowledged(false);
                  setEncounterMessage(null);
                }}
                type="button"
                title={
                  hasUnsavedChanges
                    ? 'Сначала сохраните или отмените изменения'
                    : undefined
                }
              >
                Проверить и подписать · v{protocolVersion.version}
              </button>
            ) : ['finalized', 'amended'].includes(
                workspaceContext?.encounter.status ?? '',
              ) &&
              protocolVersion?.status === 'signed' ? (
              <button
                className={styles.primaryButton}
                disabled
                title="Подписанная версия неизменяема"
                type="button"
              >
                Подписан · v{protocolVersion.version}
              </button>
            ) : (
              <button
                className={styles.primaryButton}
                disabled
                title="Действие недоступно для текущего статуса"
                type="button"
              >
                Нет доступного перехода
              </button>
            )}
            {encounterMessage && (
              <span className={styles.encounterMessage} role="status">
                {encounterMessage}
              </span>
            )}
          </div>
        </section>

        {activeRecovery && (
          <section
            className={`${styles.recoveryPanel} ${
              !serverStateConfirmed ? styles.recoveryPanelUnconfirmed : ''
            }`}
            aria-labelledby="encounter-recovery-title"
          >
            <span className={styles.recoveryIcon} aria-hidden="true">
              <FolderClock size={24} strokeWidth={1.7} />
            </span>
            <div className={styles.recoveryCopy}>
              <span className={styles.sectionEyebrow}>
                {serverStateConfirmed
                  ? 'Состояние получено с сервера'
                  : recoveryActionState === 'checking'
                    ? 'Проверяем серверное состояние'
                    : 'Актуальность требует проверки'}
              </span>
              <h2 id="encounter-recovery-title">
                {recoveryActionState === 'confirmed'
                  ? 'Незавершённый приём подтверждён'
                  : serverStateConfirmed
                    ? 'Найден незавершённый приём'
                    : 'Клинические действия временно заблокированы'}
              </h2>
              <p>
                {workspaceContext?.encounter.patient.displayName} ·{' '}
                {workspaceContext?.encounter.patient.medicalRecordNumber} ·{' '}
                {encounterStatusLabels[activeRecovery.status]}
                {activeRecovery.startedAt
                  ? ` · начат ${new Date(activeRecovery.startedAt).toLocaleString(
                      'ru-RU',
                      { dateStyle: 'medium', timeStyle: 'short' },
                    )}`
                  : ''}
              </p>
              {serverStateConfirmed && (
                <div className={styles.recoveryStats}>
                  <span>
                    <strong>
                      {activeRecovery.saved.reviewedClinicalSectionCount}/
                      {activeRecovery.saved.clinicalSectionCount}
                    </strong>
                    разделов проверено
                  </span>
                  <span>
                    <strong>{activeRecovery.saved.acceptedRecommendationCount}</strong>
                    рекомендаций принято
                  </span>
                  <span>
                    <strong>
                      {activeRecovery.saved.transcriptSegmentCount ?? '—'}
                    </strong>
                    {activeRecovery.saved.transcriptSegmentCount === null
                      ? 'расшифровка скрыта согласием'
                      : 'реплик сохранено'}
                  </span>
                </div>
              )}
              <p className={styles.recoveryNotice}>
                Загружаются только подтверждённые записи D1. Несохранённый текст
                из закрытого браузера восстановить невозможно.
              </p>
              {resumableEncounters.length > 1 && (
                <p className={styles.recoveryChoiceNote}>
                  Найдено незавершённых приёмов: {resumableEncounters.length}.
                  Выберите нужный по пациенту, статусу и филиалу в списке выше.
                </p>
              )}
            </div>
            <div className={styles.recoveryActions}>
              <button
                className={styles.primaryButton}
                disabled={recoveryActionState === 'checking'}
                aria-busy={recoveryActionState === 'checking'}
                onClick={() => void resumeCurrentEncounter()}
                type="button"
              >
                {recoveryActionState === 'checking'
                  ? 'Проверяем…'
                  : recoveryActionState === 'confirmed'
                    ? 'Проверить снова'
                    : activeRecovery.status === 'review'
                      ? 'Продолжить проверку'
                      : 'Продолжить приём'}
              </button>
              {recoveryMessage && (
                <span
                  className={styles.recoveryMessage}
                  role={recoveryActionState === 'error' ? 'alert' : 'status'}
                  aria-live="polite"
                >
                  {recoveryMessage}
                </span>
              )}
            </div>
          </section>
        )}

        {showProtocolSigning &&
          workspaceContext?.encounter.status === 'review' &&
          protocolVersion?.status === 'draft' && (
            <section
              className={styles.protocolSigningPanel}
              aria-labelledby="protocol-signing-title"
            >
              <div>
                <span className={styles.sectionEyebrow}>Личное решение врача</span>
                <h2 id="protocol-signing-title">Подписание протокола</h2>
                <p>
                  Будет создана новая неизменяемая подписанная версия, а приём
                  перейдёт в статус «Завершён». Черновик останется в истории.
                </p>
                <code title={protocolVersion.sourceHash}>
                  Источник {protocolVersion.sourceHash.slice(0, 16)}…
                </code>
              </div>
              <div className={styles.protocolSigningDecision}>
                <label>
                  <input
                    checked={protocolSigningAcknowledged}
                    disabled={protocolSigningPending}
                    onChange={(event) =>
                      setProtocolSigningAcknowledged(event.target.checked)
                    }
                    type="checkbox"
                  />
                  <span>
                    Я лично проверил все разделы, говорящих и текст расшифровки
                    и принимаю ответственность за содержание протокола.
                  </span>
                </label>
                <div>
                  <button
                    disabled={protocolSigningPending}
                    onClick={() => {
                      setShowProtocolSigning(false);
                      setProtocolSigningAcknowledged(false);
                    }}
                    type="button"
                  >
                    Отмена
                  </button>
                  <button
                    className={styles.signProtocolButton}
                    disabled={
                      protocolSigningPending ||
                      !protocolSigningAcknowledged ||
                      hasUnsavedChanges
                    }
                    onClick={() => void signProtocol()}
                    type="button"
                  >
                    {protocolSigningPending
                      ? 'Подписываем…'
                      : 'Подписать и завершить'}
                  </button>
                </div>
              </div>
            </section>
          )}

        {['finalized', 'amended'].includes(
          workspaceContext?.encounter.status ?? '',
        ) &&
          protocolVersion?.status === 'signed' && (
            <section
              className={styles.exportPanel}
              aria-labelledby="protocol-export-title"
            >
              <div className={styles.exportIntro}>
                <span className={styles.sectionEyebrow}>
                  Подписанный источник · v{protocolVersion.version}
                </span>
                <h2 id="protocol-export-title">Документы по приёму</h2>
                <p>
                  DOCX и PDF содержат протокол и полную расшифровку с ролями
                  говорящих. TXT содержит отдельную расшифровку, JSON — журнал
                  происхождения и аудита.
                </p>
                <div className={styles.exportIntegrity}>
                  <ShieldCheck size={16} />
                  <span>
                    Источник <code>{protocolVersion.sourceHash.slice(0, 16)}…</code>
                  </span>
                </div>
              </div>

              <div className={styles.exportWorkspace}>
                <div className={styles.exportActions}>
                  <button
                    className={styles.secondaryButton}
                    disabled={exportPending}
                    onClick={() => void generateExports()}
                    type="button"
                  >
                    <FileArchive size={17} />
                    {exportPending
                      ? 'Формируем и проверяем…'
                      : exportArtifacts.length > 0
                        ? 'Обновить комплект'
                        : 'Подготовить комплект'}
                  </button>
                  {bundleArtifact && (
                    <a
                      className={styles.exportBundleLink}
                      href={scopeUrl(`/api/workspace/exports/download?encounterId=${encodeURIComponent(
                        workspaceContext!.encounter.id,
                      )}&kind=bundle_zip`)}
                    >
                      <Download size={17} /> Скачать всё одним ZIP
                    </a>
                  )}
                </div>

                {exportArtifacts.length > 0 ? (
                  <div className={styles.exportFiles}>
                    {exportArtifacts
                      .filter((artifact) => artifact.kind !== 'bundle_zip')
                      .map((artifact) => (
                        <a
                          className={styles.exportFile}
                          href={scopeUrl(`/api/workspace/exports/download?encounterId=${encodeURIComponent(
                            workspaceContext!.encounter.id,
                          )}&kind=${artifact.kind}`)}
                          key={artifact.id}
                        >
                          <span>
                            <FileText size={16} />
                            <strong>{exportArtifactLabels[artifact.kind]}</strong>
                          </span>
                          <small>
                            {formatFileSize(artifact.byteSize)} · SHA-256{' '}
                            {artifact.sha256.slice(0, 10)}…
                          </small>
                          <Download size={16} aria-hidden="true" />
                        </a>
                      ))}
                  </div>
                ) : (
                  <div className={styles.exportEmpty}>
                    Комплект ещё не создан. Файлы появятся только из текущей
                    подписанной версии.
                  </div>
                )}

                <div className={styles.exportAudioNotice}>
                  <Mic size={15} />
                  <span>
                    Аудиофайл не включён: захват аудио и STT в этом production
                    контуре ещё не подключены.
                  </span>
                </div>
                {exportMessage && (
                  <div
                    className={styles.exportMessage}
                    role="status"
                    aria-live="polite"
                  >
                    {exportMessage}
                  </div>
                )}
              </div>

              <div className={styles.amendmentArea}>
                <div className={styles.amendmentHeader}>
                  <div>
                    <span className={styles.sectionEyebrow}>
                      История после подписания
                    </span>
                    <h3>Подписанные корректировки</h3>
                    <p>
                      Исходный протокол остаётся неизменным. Каждая корректировка
                      создаёт следующую подписанную версию и новый комплект файлов.
                    </p>
                  </div>
                  <button
                    className={styles.secondaryButton}
                    disabled={amendmentPending}
                    onClick={() => {
                      setShowAmendmentForm((current) => !current);
                      setAmendmentMessage(null);
                      setAmendmentAcknowledged(false);
                    }}
                    type="button"
                  >
                    <Pencil size={16} />
                    {showAmendmentForm ? 'Закрыть форму' : 'Создать корректировку'}
                  </button>
                </div>

                {amendments.length > 0 ? (
                  <div className={styles.amendmentHistory}>
                    {amendments.map((amendment) => (
                      <article className={styles.amendmentCard} key={amendment.id}>
                        <div className={styles.amendmentCardTopline}>
                          <strong>Корректировка №{amendment.sequence}</strong>
                          <span>
                            {new Date(amendment.signedAt).toLocaleString('ru-RU')}
                          </span>
                        </div>
                        <dl>
                          <div>
                            <dt>Причина</dt>
                            <dd>{amendment.reason}</dd>
                          </div>
                          <div>
                            <dt>Подписанное дополнение</dt>
                            <dd>{amendment.text}</dd>
                          </div>
                        </dl>
                        <small>
                          Подписал: {amendment.signedByDisplayName} · версия протокола{' '}
                          {amendment.protocolVersion}
                        </small>
                      </article>
                    ))}
                  </div>
                ) : (
                  <div className={styles.amendmentEmpty}>
                    Подписанных корректировок пока нет.
                  </div>
                )}

                {showAmendmentForm && (
                  <form
                    className={styles.amendmentForm}
                    onSubmit={(event) => {
                      event.preventDefault();
                      void amendSignedProtocol();
                    }}
                  >
                    <div className={styles.amendmentWarning}>
                      <ShieldCheck size={18} />
                      <span>
                        Это не редактирование старого документа. После подписания
                        появится новая неизменяемая версия v{protocolVersion.version + 1}.
                      </span>
                    </div>
                    <label>
                      <span>Причина корректировки</span>
                      <input
                        disabled={amendmentPending}
                        maxLength={500}
                        minLength={10}
                        onChange={(event) => setAmendmentReason(event.target.value)}
                        placeholder="Например: уточнение формулировки после врачебной проверки"
                        required
                        value={amendmentReason}
                      />
                      <small>{amendmentReason.length} / 500</small>
                    </label>
                    <label>
                      <span>Текст подписанного дополнения</span>
                      <textarea
                        disabled={amendmentPending}
                        maxLength={8000}
                        onChange={(event) => setAmendmentText(event.target.value)}
                        placeholder="Укажите только проверенное врачом дополнение"
                        required
                        rows={4}
                        value={amendmentText}
                      />
                      <small>{amendmentText.length.toLocaleString('ru-RU')} / 8 000</small>
                    </label>
                    <label className={styles.amendmentConfirmation}>
                      <input
                        checked={amendmentAcknowledged}
                        disabled={amendmentPending}
                        onChange={(event) =>
                          setAmendmentAcknowledged(event.target.checked)
                        }
                        type="checkbox"
                      />
                      <span>
                        Я лично проверил текст и подписываю корректировку как
                        назначенный врач.
                      </span>
                    </label>
                    <div className={styles.amendmentActions}>
                      <button
                        disabled={amendmentPending}
                        onClick={() => {
                          setShowAmendmentForm(false);
                          setAmendmentReason('');
                          setAmendmentText('');
                          setAmendmentAcknowledged(false);
                          setAmendmentMessage(null);
                        }}
                        type="button"
                      >
                        Отмена
                      </button>
                      <button
                        className={styles.signProtocolButton}
                        disabled={
                          amendmentPending ||
                          amendmentReason.trim().length < 10 ||
                          amendmentText.trim().length === 0 ||
                          !amendmentAcknowledged
                        }
                        type="submit"
                      >
                        {amendmentPending
                          ? 'Подписываем новую версию…'
                          : 'Подписать корректировку'}
                      </button>
                    </div>
                    {amendmentMessage && (
                      <div className={styles.amendmentMessage} role="status">
                        {amendmentMessage}
                      </div>
                    )}
                  </form>
                )}
              </div>
            </section>
          )}

        {showEncounterCreation && (
          <section
            className={styles.encounterCreationPanel}
            aria-labelledby="encounter-creation-title"
          >
            <div className={styles.encounterCreationIntro}>
              <span className={styles.sectionEyebrow}>Локальный контур</span>
              <h2 id="encounter-creation-title">Новый синтетический приём</h2>
              <p>
                Не вводите имя или сведения реального пациента. Карточка будет
                назначена текущему врачу, а согласия останутся незаполненными.
              </p>
            </div>
            <form
              className={styles.encounterCreationForm}
              onSubmit={(event) => void createSyntheticEncounter(event)}
            >
              <label>
                <span>Вымышленное имя</span>
                <input
                  maxLength={120}
                  onChange={(event) => setNewPatientName(event.target.value)}
                  placeholder="Например, Тестовый пациент К."
                  required
                  value={newPatientName}
                />
              </label>
              <label>
                <span>Дата рождения</span>
                <input
                  onChange={(event) =>
                    setNewPatientBirthDate(event.target.value)
                  }
                  type="date"
                  value={newPatientBirthDate}
                />
              </label>
              <label>
                <span>Пол при рождении</span>
                <select
                  onChange={(event) =>
                    setNewPatientSex(
                      event.target.value as WorkspaceEncounter['patient']['sexAtBirth'],
                    )
                  }
                  value={newPatientSex}
                >
                  <option value="not_recorded">Не указан</option>
                  <option value="female">Женский</option>
                  <option value="male">Мужской</option>
                  <option value="unknown">Неизвестно</option>
                </select>
              </label>
              <label className={styles.reasonField}>
                <span>Причина обращения</span>
                <textarea
                  maxLength={500}
                  onChange={(event) => setNewReasonForVisit(event.target.value)}
                  placeholder="Только вымышленный сценарий"
                  rows={2}
                  value={newReasonForVisit}
                />
              </label>
              <label className={styles.syntheticConfirmation}>
                <input
                  checked={syntheticDataAcknowledged}
                  onChange={(event) =>
                    setSyntheticDataAcknowledged(event.target.checked)
                  }
                  type="checkbox"
                />
                <span>Подтверждаю: данные полностью вымышлены.</span>
              </label>
              <div className={styles.encounterCreationActions}>
                <button
                  className={styles.secondaryButton}
                  disabled={encounterCreationPending}
                  onClick={() => setShowEncounterCreation(false)}
                  type="button"
                >
                  Отмена
                </button>
                <button
                  className={styles.primaryButton}
                  disabled={encounterCreationPending}
                  type="submit"
                >
                  {encounterCreationPending ? 'Создаём…' : 'Создать черновик'}
                </button>
              </div>
              {encounterCreationMessage && (
                <div className={styles.encounterCreationMessage} role="status">
                  {encounterCreationMessage}
                </div>
              )}
            </form>
          </section>
        )}

        <section
          className={styles.consentPanel}
          aria-labelledby="consent-title"
          id="patient-consents"
        >
          <div className={styles.consentPanelHeader}>
            <div>
              <span className={styles.sectionEyebrow}>Перед обработкой данных</span>
              <h2 id="consent-title">Решения пациента</h2>
              <p>
                Фиксирует врач со слов пациента. Каждое изменение создаёт новую
                неизменяемую версию.
              </p>
            </div>
            <div className={styles.consentPolicyBox}>
              <span>Уведомление</span>
              <strong>{consentPolicy?.version ?? 'не загружено'}</strong>
              <em>только синтетический тест · не утверждено клиникой</em>
              <div className={styles.languageToggle} aria-label="Язык уведомления">
                {(['ru', 'kk'] as const).map((language) => (
                  <button
                    className={consentNoticeLanguage === language ? styles.languageToggleActive : ''}
                    key={language}
                    onClick={() => setConsentNoticeLanguage(language)}
                    type="button"
                  >
                    {language.toUpperCase()}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className={styles.consentGrid}>
            {visibleConsentPurposes.map((purpose) => {
              const consent = consents.find((item) => item.type === purpose.type);
              const isPending = pendingConsentType === purpose.type;
              return (
                <article className={styles.consentCard} key={purpose.type}>
                  <div className={styles.consentCardTopline}>
                    <strong>{purpose.title}</strong>
                    <span
                      className={`${styles.consentState} ${consent ? styles[`consentState_${consent.decision}`] : ''}`}
                    >
                      {consent
                        ? consentDecisionLabels[consent.decision]
                        : 'Не зафиксировано'}
                    </span>
                  </div>
                  <p>{purpose.description}</p>
                  <small>
                    {consent
                      ? `Версия ${consent.version} · ${consent.noticeLanguage.toUpperCase()} · ${consent.capturedBy}`
                      : 'Текущего события нет'}
                  </small>
                  <div className={styles.consentActions}>
                    {consent?.decision === 'granted' ? (
                      <button
                        disabled={isPending}
                        onClick={() =>
                          setConfirmConsentWithdrawalType(purpose.type)
                        }
                        type="button"
                      >
                        {isPending ? 'Сохраняем…' : 'Зафиксировать отзыв'}
                      </button>
                    ) : (
                      <>
                        <button
                          className={styles.consentGrantButton}
                          disabled={isPending}
                          onClick={() => void recordConsentDecision(purpose.type, 'granted')}
                          type="button"
                        >
                          {isPending ? 'Сохраняем…' : 'Предоставлено'}
                        </button>
                        {consent?.decision !== 'denied' && (
                          <button
                            disabled={isPending}
                            onClick={() => void recordConsentDecision(purpose.type, 'denied')}
                            type="button"
                          >
                            Отказ
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {confirmConsentWithdrawalType === purpose.type && (
                    <div
                      aria-labelledby={`withdraw-consent-${purpose.type}`}
                      className={styles.consentWithdrawalConfirm}
                      role="alertdialog"
                    >
                      <strong id={`withdraw-consent-${purpose.type}`}>
                        Подтвердить отзыв согласия?
                      </strong>
                      <p>
                        Это немедленно остановит связанные операции. Предыдущая
                        версия останется в журнале аудита.
                      </p>
                      <div className={styles.noticeActions}>
                        <button
                          className={styles.dangerButton}
                          disabled={isPending}
                          onClick={() =>
                            void recordConsentDecision(
                              purpose.type,
                              'withdrawn',
                            )
                          }
                          type="button"
                        >
                          Да, зафиксировать отзыв
                        </button>
                        <button
                          disabled={isPending}
                          onClick={() => setConfirmConsentWithdrawalType(null)}
                          type="button"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  )}
                </article>
              );
            })}
          </div>

          {consentMessage && (
            <div className={styles.consentMessage} role="status" aria-live="polite">
              {consentMessage}
            </div>
          )}
        </section>

        <section className={styles.vitalsBar} aria-label="Контекст приёма">
          <div>
            <small>Приём</small>
            <strong>
              {workspaceContext?.encounter.startedAt
                ? new Date(workspaceContext.encounter.startedAt).toLocaleString('ru-RU', {
                    day: '2-digit',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })
                : 'Время не указано'}
            </strong>
          </div>
          <div><small>Статус</small><strong>{workspaceContext ? encounterStatusLabels[workspaceContext.encounter.status] : '—'}</strong></div>
          <div><small>Карта</small><strong>{workspaceContext?.encounter.patient.medicalRecordNumber ?? '—'}</strong></div>
          <div><small>Подсказки</small><strong>{pendingRecommendationCount} <em>требуют решения</em></strong></div>
          <div>
            <small>Протокол</small>
            <strong>
              {protocolVersion
                ? `${protocolVersion.status === 'signed' ? 'Подписан' : 'Черновик'} v${protocolVersion.version}`
                : `${reviewedSectionCount} из 8`}{' '}
              <em>
                {protocolVersion
                  ? protocolVersion.status === 'signed'
                    ? 'неизменяем'
                    : 'не подписан'
                  : 'проверено'}
              </em>
            </strong>
          </div>
        </section>

        <div
          className={styles.workspaceGrid}
          ref={workspaceGridRef}
          tabIndex={-1}
        >
          <section className={styles.transcriptPane}>
            <div className={styles.paneHeader}>
              <div>
                <span className={styles.sectionEyebrow}>Разговор</span>
                <h2>Расшифровка</h2>
              </div>
              <div
                className={`${styles.captureStatus} ${speech.status === 'listening' ? styles.captureStatusActive : ''} ${speech.isBusy ? styles.captureStatusBusy : ''}`}
              >
                <span aria-hidden="true" />{' '}
                {speech.status === 'listening'
                  ? formatElapsed(speech.elapsedSeconds * 1000)
                  : transcript.length > 0
                  ? formatElapsed(transcript.at(-1)?.endedAtMs ?? 0)
                  : 'нет записи'}
              </div>
            </div>

            <div className={styles.transcriptList}>
              {transcript.length > 0 ? (
                transcript.map((turn) => (
                  <article
                    className={`${styles.turn} ${turn.role === 'doctor' ? styles.turnDoctor : turn.role === 'patient' ? styles.turnPatient : styles.turnUnknown}`}
                    key={turn.id}
                  >
                    <div className={styles.turnMeta}>
                      <strong>{transcriptRoleLabel(turn.role)}</strong>
                      <span>{turn.language.toUpperCase()}</span>
                      {turn.roleSource === 'manual' ? (
                        <span className={styles.manualTranscriptBadge}>
                          Исправлено врачом · v{turn.version}
                        </span>
                      ) : turn.state === 'provisional' ? (
                        <span className={styles.provisionalTranscriptBadge}>
                          Предварительно
                        </span>
                      ) : (
                        <span className={styles.sttTranscriptBadge}>
                          STT · требует проверки
                        </span>
                      )}
                      <time>{formatElapsed(turn.startedAtMs)}</time>
                      <button
                        type="button"
                        aria-label={`Исправить реплику: ${transcriptRoleLabel(turn.role)}`}
                        disabled={
                          transcriptCorrectionPending || !clinicalRecordEditable
                        }
                        onClick={() => beginTranscriptEdit(turn)}
                        title={
                          clinicalRecordEditable
                            ? 'Исправить текст, роль или язык новой версией'
                            : 'Подписанный приём неизменяем'
                        }
                      >
                        <Pencil size={14} />
                      </button>
                    </div>
                    {editingTranscriptId === turn.id && transcriptDraft ? (
                      <form
                        className={styles.transcriptEditor}
                        onSubmit={(event) => {
                          event.preventDefault();
                          void saveTranscriptCorrection(turn);
                        }}
                      >
                        <div className={styles.transcriptEditorFields}>
                          <label>
                            <span>Говорящий</span>
                            <select
                              value={transcriptDraft.role}
                              onChange={(event) =>
                                setTranscriptDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        role: event.target.value as TranscriptTurn['role'],
                                      }
                                    : current,
                                )
                              }
                            >
                              <option value="doctor">Врач</option>
                              <option value="patient">Пациент</option>
                              <option value="other">Другой участник</option>
                              <option value="unknown">Не подтверждено</option>
                            </select>
                          </label>
                          <label>
                            <span>Язык</span>
                            <select
                              value={transcriptDraft.language}
                              onChange={(event) =>
                                setTranscriptDraft((current) =>
                                  current
                                    ? {
                                        ...current,
                                        language: event.target
                                          .value as TranscriptTurn['language'],
                                      }
                                    : current,
                                )
                              }
                            >
                              <option value="ru">Русский</option>
                              <option value="kk">Қазақша</option>
                              <option value="mixed">Смешанная речь</option>
                              <option value="unknown">Не определён</option>
                            </select>
                          </label>
                        </div>
                        <label className={styles.transcriptEditorText}>
                          <span>Текст реплики</span>
                          <textarea
                            autoFocus
                            maxLength={8000}
                            value={transcriptDraft.text}
                            onChange={(event) =>
                              setTranscriptDraft((current) =>
                                current
                                  ? { ...current, text: event.target.value }
                                  : current,
                              )
                            }
                          />
                        </label>
                        <div className={styles.transcriptEditorActions}>
                          <button
                            type="button"
                            disabled={transcriptCorrectionPending}
                            onClick={cancelTranscriptEdit}
                          >
                            Отмена
                          </button>
                          <button
                            className={styles.transcriptSaveButton}
                            type="submit"
                            disabled={
                              transcriptCorrectionPending ||
                              transcriptDraft.text.trim().length === 0
                            }
                          >
                            {transcriptCorrectionPending
                              ? 'Сохраняем…'
                              : 'Сохранить новой версией'}
                          </button>
                        </div>
                      </form>
                    ) : (
                      <p>{turn.text}</p>
                    )}
                  </article>
                ))
              ) : (
                <div className={styles.transcriptEmpty} role="status">
                  <Mic size={24} />
                  <strong>Расшифровка для этого приёма отсутствует</strong>
                  <span>ORION не подставляет демонстрационный разговор другого пациента.</span>
                </div>
              )}
              {transcriptMessage && (
                <div
                  className={styles.transcriptMessage}
                  role="status"
                  aria-live="polite"
                >
                  {transcriptMessage}
                </div>
              )}
            </div>

            <div className={styles.speechFooter}>
              <div
                className={`${styles.micState} ${speech.status === 'listening' ? styles.micStateActive : ''}`}
              >
                <span className={styles.micIcon}><Mic aria-hidden="true" size={18} /></span>
                <span>
                  <strong>{speechStatusLabel(speech.status)}</strong>
                  <small>
                    {speechUnavailableReason ??
                      (speech.speechActive
                        ? 'Слышим речь; после короткой паузы реплика будет распознана.'
                        : speech.pendingUtterances > 0
                          ? `Распознаём реплик: ${speech.pendingUtterances}`
                          : 'Аудио обрабатывается на этом ПК и не сохраняется.')}
                  </small>
                </span>
              </div>
              <div className={styles.speechControls}>
                <span className={styles.languagePair}>RU · KK</span>
                <button
                  aria-busy={speech.isBusy}
                  aria-pressed={speech.status === 'listening'}
                  className={speech.status === 'listening' ? styles.speechStopButton : styles.speechStartButton}
                  disabled={
                    speech.status === 'listening'
                      ? false
                      : !speechAllowedByWorkspace || speech.isBusy
                  }
                  onClick={() =>
                    void (speech.status === 'listening'
                      ? speech.stop('completed')
                      : speech.start())
                  }
                  title={speechUnavailableReason ?? undefined}
                  type="button"
                >
                  {speech.status === 'listening' ? (
                    <><Square aria-hidden="true" size={14} /> Остановить</>
                  ) : (
                    <><Mic aria-hidden="true" size={16} /> Начать расшифровку</>
                  )}
                </button>
              </div>
              {speech.error && (
                <div className={styles.speechError} role="alert">{speech.error}</div>
              )}
            </div>
          </section>

          <section className={styles.notePane} id="clinical-record">
            <div className={styles.paneHeader}>
              <div>
                <span className={styles.sectionEyebrow}>Протокол приёма</span>
                <h2>Клиническая запись · 8 разделов</h2>
              </div>
              <span
                className={`${styles.saveState} ${persistenceState === 'saved' ? styles.saveStateSaved : ''} ${persistenceState === 'error' || persistenceState === 'unauthenticated' || persistenceState === 'forbidden' ? styles.saveStateError : ''}`}
              >
                {persistenceState === 'saved' ? <Check size={15} /> : <Clock3 size={15} />}
                {persistenceState === 'unauthenticated' ? (
                  <a href="/signin-with-chatgpt?return_to=/" target="_top">
                    Войти для сохранения
                  </a>
                ) : persistenceLabel}
              </span>
            </div>

            <div className={styles.noteGuide} role="note">
              <div>
                <strong>Что нужно сделать врачу</strong>
                <p>
                  Откройте каждый раздел, внесите или исправьте сведения и нажмите
                  «Проверить раздел». Если данных действительно нет — отдельно
                  выберите «Сведений нет». Только эти подтверждённые решения войдут
                  в протокол.
                </p>
              </div>
              <div
                className={styles.noteGuideProgress}
                aria-label={`Проверено разделов: ${reviewedSectionCount} из 8`}
              >
                <strong>{reviewedSectionCount}<span>/8</span></strong>
                <small>разделов проверено</small>
                <progress max={8} value={reviewedSectionCount} />
              </div>
            </div>

            <div className={styles.noteBody}>
              <nav className={styles.sectionRail} aria-label="Разделы протокола">
                {clinicalSections.map((section, index) => {
                  const stateStyle = sectionStateStyle(section.reviewState);
                  return (
                    <button
                      type="button"
                      aria-current={activeSection === section.code ? 'page' : undefined}
                      className={`${styles.sectionTab} ${activeSection === section.code ? styles.sectionTabActive : ''}`}
                      onClick={() => requestSectionSwitch(section.code)}
                      key={section.code}
                    >
                      <span className={styles.sectionIndex}>{String(index + 1).padStart(2, '0')}</span>
                      <span className={styles.sectionTabCopy}>
                        <span className={styles.sectionLabel}>{section.title}</span>
                        <small>{sectionStateLabels[section.reviewState]}</small>
                      </span>
                      <span
                        aria-hidden="true"
                        className={`${styles.sectionState} ${styles[`state_${stateStyle}`]}`}
                      />
                    </button>
                  );
                })}
              </nav>

              {selectedSection ? (
                <div className={styles.editor} aria-labelledby="active-section-title">
                  <div className={styles.editorHeader}>
                    <div>
                      <span>Раздел для проверки · версия {selectedSection.version}</span>
                      <h3 id="active-section-title">{selectedSection.title}</h3>
                      <span className={`${styles.sectionBadge} ${styles[`sectionBadge_${sectionStateStyle(selectedSection.reviewState)}`]}`}>
                        {sectionStateLabels[selectedSection.reviewState]}
                      </span>
                    </div>
                    {editingSectionCode !== selectedSection.code &&
                      clinicalRecordEditable && (
                      <button
                        className={styles.textButton}
                        onClick={() => beginSectionEdit(selectedSection)}
                        type="button"
                      >
                        <Pencil size={15} /> Редактировать
                      </button>
                    )}
                  </div>

                  {editingSectionCode === selectedSection.code ? (
                    <div className={styles.editorForm}>
                      <label htmlFor={`section-${selectedSection.code}`}>
                        Текст раздела
                      </label>
                      <textarea
                        id={`section-${selectedSection.code}`}
                        value={selectedDraft}
                        onChange={(event) =>
                          setSectionDrafts((drafts) => ({
                            ...drafts,
                            [selectedSection.code]: event.target.value,
                          }))
                        }
                        aria-describedby="section-editor-help"
                        maxLength={12_000}
                      />
                      <div className={styles.editorFormMeta} id="section-editor-help">
                        <span>{selectedDraft.length.toLocaleString('ru-RU')} / 12 000</span>
                        {selectedDraftIsDirty && <strong>Не сохранено</strong>}
                      </div>
                      <div className={styles.editorActions}>
                        <button
                          className={styles.primaryButton}
                          disabled={!selectedDraftIsDirty || pendingSectionCode === selectedSection.code}
                          onClick={() => void commitSection(selectedSection, 'save_draft')}
                          type="button"
                        >
                          {pendingSectionCode === selectedSection.code ? 'Сохраняем…' : 'Сохранить черновик'}
                        </button>
                        <button
                          className={styles.secondaryButton}
                          disabled={pendingSectionCode === selectedSection.code}
                          onClick={() => cancelSectionEdit(selectedSection)}
                          type="button"
                        >
                          Отмена
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className={`${styles.editorText} ${!selectedSection.content ? styles.editorTextEmpty : ''}`}>
                      {selectedSection.reviewState === 'explicitly_absent'
                        ? 'Врач явно подтвердил отсутствие сведений для этого раздела.'
                        : selectedSection.content ||
                          'Раздел не заполнен. Внесите сведения или явно подтвердите их отсутствие.'}
                    </div>
                  )}

                  {pendingSectionSwitch && (
                    <div
                      aria-labelledby="section-switch-title"
                      className={styles.sectionSwitchConfirm}
                      role="alertdialog"
                    >
                      <strong id="section-switch-title">
                        В разделе остался несохранённый текст
                      </strong>
                      <p>
                        Черновик останется только в этой вкладке и не попадёт в
                        медицинскую запись, пока вы не нажмёте «Сохранить
                        черновик».
                      </p>
                      <div className={styles.noticeActions}>
                        <button
                          className={styles.primaryButton}
                          onClick={() => setPendingSectionSwitch(null)}
                          type="button"
                        >
                          Остаться и сохранить
                        </button>
                        <button
                          onClick={() => activateSection(pendingSectionSwitch)}
                          type="button"
                        >
                          Перейти, оставить в памяти вкладки
                        </button>
                      </div>
                    </div>
                  )}

                  <div className={styles.evidenceRow}>
                    <FileText size={15} />
                    <span>
                      {selectedSection.provenance.sourceType === 'clinician'
                        ? 'Происхождение'
                        : 'Основание'}
                    </span>
                    <code>
                      {selectedSection.provenance.sourceType === 'clinician'
                        ? 'Изменено врачом; исходные ссылки сохранены в версии'
                        : selectedSection.evidence.join(', ')}
                    </code>
                  </div>

                  {sectionMessage && (
                    <div
                      className={`${styles.sectionNotice} ${sectionMutationState === 'conflict' || sectionMutationState === 'error' ? styles.sectionNoticeError : styles.sectionNoticeSuccess}`}
                      role={sectionMutationState === 'conflict' || sectionMutationState === 'error' ? 'alert' : 'status'}
                      aria-live="polite"
                    >
                      <strong>{sectionMessage}</strong>
                      {sectionRequestId && <small>Код запроса: {sectionRequestId}</small>}
                      {sectionMutationState === 'conflict' && (
                        <div className={styles.noticeActions}>
                          <button onClick={() => void refreshAfterConflict()} type="button">
                            Загрузить серверную версию
                          </button>
                          <button onClick={() => void copySelectedDraft()} type="button">
                            Скопировать мой текст
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {clinicalRecordEditable &&
                    confirmAbsentCode === selectedSection.code && (
                    <div className={styles.absenceConfirm} role="alert">
                      <strong>Подтвердить отсутствие сведений?</strong>
                      <p>
                        Будет создана новая пустая версия. Текущая серверная версия останется в истории и не удалится.
                      </p>
                      <div className={styles.noticeActions}>
                        <button
                          className={styles.dangerButton}
                          onClick={() => void commitSection(selectedSection, 'mark_absent')}
                          type="button"
                        >
                          Да, подтвердить отсутствие
                        </button>
                        <button onClick={() => setConfirmAbsentCode(null)} type="button">Отмена</button>
                      </div>
                    </div>
                  )}

                  <div className={styles.reviewRow}>
                    <div>
                      <ShieldCheck size={17} />
                      <span>
                        <strong>Решение принимает врач</strong>
                        <small>
                          {selectedSection.reviewedBy && selectedSection.reviewedAt
                            ? `${selectedSection.reviewedBy} · ${new Date(selectedSection.reviewedAt).toLocaleString('ru-RU')}`
                            : selectedDraft.trim()
                              ? 'Сверьте текст и подтвердите его отдельным действием'
                              : 'Сначала нажмите «Редактировать» либо подтвердите «Сведений нет»'}
                        </small>
                      </span>
                    </div>
                    <div className={styles.reviewActions}>
                      <button
                        className={styles.absentButton}
                        disabled={
                          !clinicalRecordEditable ||
                          pendingSectionCode === selectedSection.code ||
                          selectedDraftIsDirty
                        }
                        onClick={() => setConfirmAbsentCode(selectedSection.code)}
                        title={selectedDraftIsDirty ? 'Сначала сохраните или отмените изменения' : undefined}
                        type="button"
                      >
                        Сведений нет
                      </button>
                      <button
                        className={styles.reviewButton}
                        disabled={
                          !clinicalRecordEditable ||
                          !selectedDraft.trim() ||
                          pendingSectionCode === selectedSection.code ||
                          (selectedSection.reviewState === 'reviewed' && !selectedDraftIsDirty)
                        }
                        onClick={() => void commitSection(selectedSection, 'mark_reviewed')}
                        title={
                          !selectedDraft.trim()
                            ? 'Чтобы проверить раздел, сначала внесите текст или выберите «Сведений нет»'
                            : undefined
                        }
                        type="button"
                      >
                        <Check size={16} />
                        {pendingSectionCode === selectedSection.code
                          ? 'Сохраняем…'
                          : selectedDraftIsDirty
                            ? 'Сохранить и проверить'
                            : selectedSection.reviewState === 'reviewed'
                              ? 'Проверено'
                              : 'Проверить раздел'}
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={styles.noteGate} role="status">
                  <ShieldCheck size={22} />
                  <strong>
                    {persistenceState === 'unauthenticated'
                      ? 'Войдите как врач, чтобы открыть клиническую запись'
                      : persistenceState === 'forbidden'
                        ? 'Нет активного назначения на этот приём'
                      : persistenceState === 'error'
                        ? 'Клиническая запись временно недоступна'
                        : 'Загружаем восемь разделов из D1'}
                  </strong>
                  <span>Статический текст не подменяет серверную медицинскую запись.</span>
                </div>
              )}
            </div>
          </section>
        </div>
      </main>

      <aside className={styles.assistantPane}>
        <div className={styles.assistantHeader}>
          <div>
            <span className={styles.sectionEyebrow}>Только для врача</span>
            <h2>Клинические подсказки</h2>
          </div>
          <span className={styles.privateBadge}>Приватно</span>
        </div>

        <div className={styles.guardrail}>
          <ShieldCheck size={19} />
          <p><strong>Черновики, не решения.</strong> Решения врача сохраняются в D1 и журнале аудита; без проверки ничего не попадёт в протокол.</p>
        </div>

        <section
          aria-busy={analysisState === 'generating'}
          className={styles.analysisLauncher}
        >
          <div className={styles.analysisLauncherHeader}>
            <span className={styles.analysisIcon}><Sparkles aria-hidden="true" size={18} /></span>
            <div>
              <strong>Создать новые черновики</strong>
              <small>
                В Groq будет передан только выбранный текст из {finalTranscript.length}{' '}
                финальных реплик. Аудио не передаётся.
              </small>
            </div>
          </div>
          <label className={styles.analysisAcknowledgement}>
            <input
              checked={transcriptSnapshotAcknowledged}
              disabled={!canAcknowledgeTranscript}
              onChange={(event) =>
                setAcknowledgedTranscriptFingerprint(
                  event.target.checked ? transcriptSnapshotFingerprint : null,
                )
              }
              type="checkbox"
            />
            <span>
              Я сверил(а) текст, язык и роли говорящих в текущей
              версии расшифровки.
            </span>
          </label>
          {!hasCurrentExternalAiConsent && (
            <p className={styles.analysisRequirement}>
              Сначала зафиксируйте отдельное согласие «Передача расшифровки в Groq».
            </p>
          )}
          <button
            className={styles.analysisButton}
            disabled={!canGenerateSuggestions}
            onClick={() => void generateClinicalDrafts()}
            type="button"
          >
            <Sparkles aria-hidden="true" size={17} />
            {analysisState === 'generating'
              ? 'Создаём и проверяем…'
              : `Создать черновики из ${finalTranscript.length} реплик`}
          </button>
          {analysisMessage && (
            <div
              className={`${styles.analysisMessage} ${analysisState === 'error' ? styles.analysisMessageError : ''}`}
              role={analysisState === 'error' ? 'alert' : 'status'}
              aria-live="polite"
            >
              {analysisMessage}
            </div>
          )}
        </section>

        <div className={styles.suggestionSummary}>
          <span>{pendingRecommendationCount} ожидают решения</span>
          <span>{acceptedCount} принято</span>
          <span>{rejectedCount} в корзине</span>
        </div>

        {!recommendationEditable && workspaceContext && (
          <div className={styles.recommendationLock} role="status">
            <ShieldCheck size={17} />
            <span>
              {!hasCurrentCareConsent
                ? 'Решения недоступны до фиксации действующего согласия на приём.'
                : workspaceContext.encounter.status === 'review'
                  ? 'Черновик протокола уже зафиксирован. Подсказки доступны только для чтения.'
                  : ['finalized', 'amended'].includes(workspaceContext.encounter.status)
                    ? 'Подписанный протокол неизменяем. Исправления оформляются отдельной корректировкой.'
                    : 'Начните приём, чтобы рассматривать клинические подсказки.'}
            </span>
          </div>
        )}

        {recommendationMessage && (
          <div
            className={`${styles.recommendationNotice} ${recommendationMutationState === 'error' || recommendationMutationState === 'conflict' ? styles.recommendationNoticeError : ''}`}
            role={
              recommendationMutationState === 'error' ||
              recommendationMutationState === 'conflict'
                ? 'alert'
                : 'status'
            }
            aria-live="polite"
          >
            <strong>{recommendationMessage}</strong>
            {recommendationRequestId && <small>Запрос {recommendationRequestId}</small>}
            {recommendationMutationState === 'conflict' && (
              <button
                onClick={() => void refreshRecommendationAfterConflict()}
                type="button"
              >
                Обновить сравнение
              </button>
            )}
          </div>
        )}

        <div
          className={styles.recommendationList}
          aria-busy={
            recommendationMutationState === 'saving' ||
            analysisState === 'generating'
          }
        >
          {persistenceState === 'loading' ? (
            <div className={styles.recommendationEmpty} role="status">
              <Activity size={20} />
              <strong>Загружаем клинические подсказки</strong>
              <span>Получаем неизменяемые источники и решения из D1.</span>
            </div>
          ) : recommendations.length === 0 ? (
            <div className={styles.recommendationEmpty} role="status">
              <MessageSquareText size={20} />
              <strong>Подсказок для этого приёма пока нет</strong>
              <span>Проверьте расшифровку и запустите создание черновиков выше.</span>
            </div>
          ) : (
            recommendations.map((item) => {
              const isEditing = editingRecommendationId === item.id;
              const isBusy = pendingRecommendationId === item.id;
              const editedAndAccepted =
                item.review.state === 'edited_and_accepted';
              const evidence = item.original.evidence;
              return (
                <article
                  aria-busy={isBusy}
                  className={`${styles.recommendation} ${styles[`recommendation_${item.tone}`]}`}
                  key={item.id}
                >
                  <div className={styles.recommendationTopline}>
                    <span>{item.eyebrow}</span>
                    {editedAndAccepted && (
                      <b><Check size={14} /> Принята версия врача</b>
                    )}
                    {item.review.state === 'accepted' && (
                      <b><Check size={14} /> Принято без изменений</b>
                    )}
                    {item.review.state === 'pending' && item.currentDerivative && (
                      <b><Clock3 size={14} /> Версия врача ожидает решения</b>
                    )}
                    {item.review.state === 'rejected' && (
                      <b><X size={14} /> В корзине</b>
                    )}
                    {item.review.state === 'expired' && (
                      <b><Clock3 size={14} /> Истекла</b>
                    )}
                  </div>

                  <div
                    className={`${styles.recommendationComparison} ${(item.currentDerivative || isEditing) ? styles.recommendationComparisonTwo : ''}`}
                  >
                    <section className={styles.recommendationSource}>
                      <div className={styles.recommendationSourceLabel}>
                        <span>Оригинал ИИ</span>
                        <small>Неизменяемый</small>
                      </div>
                      <h3>{item.original.title}</h3>
                      <p>{item.original.content}</p>
                      <div className={styles.recommendationEvidence}>
                        <MessageSquareText size={16} />
                        <div>
                          {evidence.length > 0
                            ? evidence.map((entry) => (
                                <span key={`${item.id}-${entry.sourceId}`}>
                                  {entry.quote ?? entry.sourceId}
                                </span>
                              ))
                            : <span>Основание сохранено в аудите</span>}
                        </div>
                      </div>
                      <div className={styles.recommendationProvenance}>
                        {item.original.provenance.provider} ·{' '}
                        {item.original.provenance.model} ·{' '}
                        {item.original.provenance.policyVersion}
                      </div>
                    </section>

                    {isEditing && recommendationDraft ? (
                      <form
                        className={styles.recommendationEditor}
                        id={`recommendation-editor-${item.id}`}
                        onSubmit={(event) => void saveRecommendationEdit(event)}
                      >
                        <div className={styles.recommendationSourceLabel}>
                          <span>Новая версия врача</span>
                          <small>
                            v{(item.currentDerivative?.version ?? 0) + 1}
                          </small>
                        </div>
                        <label htmlFor={`recommendation-title-${item.id}`}>
                          Заголовок
                        </label>
                        <input
                          autoFocus
                          disabled={isBusy}
                          id={`recommendation-title-${item.id}`}
                          maxLength={300}
                          onChange={(event) =>
                            setRecommendationDraft((draft) =>
                              draft ? { ...draft, title: event.target.value } : draft,
                            )
                          }
                          value={recommendationDraft.title}
                        />
                        <label htmlFor={`recommendation-content-${item.id}`}>
                          Текст врача
                        </label>
                        <textarea
                          aria-describedby={`recommendation-edit-help-${item.id}`}
                          disabled={isBusy}
                          id={`recommendation-content-${item.id}`}
                          maxLength={8000}
                          onChange={(event) =>
                            setRecommendationDraft((draft) =>
                              draft ? { ...draft, content: event.target.value } : draft,
                            )
                          }
                          value={recommendationDraft.content}
                        />
                        <label htmlFor={`recommendation-reason-${item.id}`}>
                          Основание редакции
                        </label>
                        <textarea
                          disabled={isBusy}
                          id={`recommendation-reason-${item.id}`}
                          maxLength={500}
                          onChange={(event) =>
                            setRecommendationDraft((draft) =>
                              draft ? { ...draft, reason: event.target.value } : draft,
                            )
                          }
                          placeholder="Что и почему изменено врачом"
                          value={recommendationDraft.reason}
                        />
                        <div
                          className={styles.recommendationEditHelp}
                          id={`recommendation-edit-help-${item.id}`}
                        >
                          Оригинал останется неизменяемым. Сохранение создаёт новую
                          версию, но не принимает её автоматически.
                        </div>
                        <div className={styles.recommendationEditorActions}>
                          <button
                            disabled={isBusy}
                            onClick={cancelRecommendationEdit}
                            type="button"
                          >
                            Отмена
                          </button>
                          <button
                            className={styles.acceptButton}
                            disabled={
                              isBusy ||
                              !recommendationDraft.title.trim() ||
                              !recommendationDraft.content.trim() ||
                              recommendationDraft.reason.trim().length < 3
                            }
                            type="submit"
                          >
                            <Check size={16} />
                            {isBusy ? 'Сохраняем…' : 'Сохранить версию врача'}
                          </button>
                        </div>
                      </form>
                    ) : item.currentDerivative ? (
                      <section className={styles.recommendationDerivative}>
                        <div className={styles.recommendationSourceLabel}>
                          <span>Версия врача</span>
                          <small>v{item.currentDerivative.version}</small>
                        </div>
                        <h3>{item.currentDerivative.title}</h3>
                        <p>{item.currentDerivative.content}</p>
                        <dl className={styles.recommendationDerivativeMeta}>
                          <div>
                            <dt>Автор</dt>
                            <dd>{item.currentDerivative.authoredByDisplayName}</dd>
                          </div>
                          <div>
                            <dt>Создана</dt>
                            <dd>
                              {new Date(item.currentDerivative.createdAt).toLocaleString(
                                'ru-RU',
                                { dateStyle: 'short', timeStyle: 'short' },
                              )}
                            </dd>
                          </div>
                          <div>
                            <dt>Основание</dt>
                            <dd>{item.currentDerivative.reason}</dd>
                          </div>
                        </dl>
                      </section>
                    ) : null}
                  </div>

                  {!isEditing && item.review.state === 'pending' ? (
                    <div className={styles.recommendationActions}>
                      <button
                        className={styles.acceptButton}
                        disabled={!recommendationEditable || isBusy || Boolean(pendingRecommendationId)}
                        onClick={() => void setRecommendationState(item.id, 'accepted')}
                        type="button"
                      >
                        <Check size={16} />
                        {isBusy
                          ? 'Сохраняем…'
                          : item.currentDerivative
                            ? 'Принять версию врача'
                            : 'Принять без изменений'}
                      </button>
                      <button
                        aria-controls={`recommendation-editor-${item.id}`}
                        aria-expanded={isEditing}
                        className={styles.editButton}
                        disabled={!recommendationEditable || isBusy || Boolean(pendingRecommendationId)}
                        onClick={() => beginRecommendationEdit(item)}
                        type="button"
                      >
                        <Pencil size={16} />
                        {item.currentDerivative ? 'Создать новую версию' : 'Редактировать'}
                      </button>
                      <button
                        className={styles.rejectButton}
                        disabled={!recommendationEditable || isBusy || Boolean(pendingRecommendationId)}
                        onClick={() => void setRecommendationState(item.id, 'rejected')}
                        type="button"
                      >
                        <X size={16} /> В корзину
                      </button>
                    </div>
                  ) : !isEditing && item.review.state !== 'expired' ? (
                    <button
                      className={styles.restoreButton}
                      disabled={!recommendationEditable || isBusy || Boolean(pendingRecommendationId)}
                      onClick={() => void setRecommendationState(item.id, 'pending')}
                      type="button"
                    >
                      Вернуть на проверку
                    </button>
                  ) : null}
                </article>
              );
            })
          )}
        </div>

        <div className={styles.assistantFooter}>
          <Activity size={16} />
          <span>Речь распознаётся локально; Groq вызывается только после явного подтверждения врача</span>
        </div>
      </aside>
    </div>
  );
}
