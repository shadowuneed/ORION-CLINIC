'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  type LocalSpeechToken,
  useLocalSpeechTranscription,
} from '../lib/live-local-speech-client';
import {
  ClinicalAnalysisRequestError,
  requestClinicalAnalysis,
} from '../lib/clinical-analysis-client';
import { requestClinicalResearch } from '../lib/clinical-research-client';
import type {
  ClinicalAnalysisResponse,
  ClinicalLanguage,
  ClinicalSuggestion,
  ClinicalTranscriptSegment,
} from '../lib/clinical-contract';
import type { ConsentDecision, ConsentType } from '../lib/domain/consent';
import type { ClinicalResearchResponse } from '../lib/clinical-research-contract';
import {
  getLiveConsent,
  getLiveConsentState,
  isLiveConsentEffective,
  mapLiveRecommendations,
  mapLiveTranscript,
  mergeLiveTokens,
  type LiveConsent,
  type LiveRecommendationReference,
  type LiveWorkspaceSnapshot,
} from '../lib/live-authoritative-workspace';
import {
  downloadAudio,
  downloadAudit,
  downloadEncounterArchive,
  downloadProtocol,
  downloadTranscript,
} from '../lib/encounter-export';
import {
  listEncounters,
  markAbandonedEncountersInterrupted,
  saveEncounter,
  type OrionEncounterRecord,
  type SuggestionDecisionStatus,
  type SuggestionLedgerEntry,
} from '../lib/encounter-history';
import { EncounterHistoryPanel } from './encounter-history-panel';

type WorkspaceProps = {
  clinicianName: string;
  requestedEncounterId: string | null;
};

type SessionState = 'ready' | 'listening' | 'review';
type SpeakerRole = 'doctor' | 'patient' | 'unknown';

type TranscriptTurn = {
  id: string;
  speaker: string | null;
  language: 'ru' | 'kk' | 'mixed' | 'unknown';
  text: string;
  startMs: number | null;
  provisional: boolean;
};

type AnalysisStatus = 'idle' | 'waiting' | 'loading' | 'ready' | 'error';
type SuggestionView = 'active' | 'trash';
type MedicationCheck =
  | 'indication'
  | 'interactions'
  | 'allergies'
  | 'contraindications';
type ResearchState = {
  status: 'loading' | 'ready' | 'error';
  result?: ClinicalResearchResponse;
  error?: string;
};

type AuthoritativeLoadState =
  | 'loading'
  | 'ready'
  | 'unauthenticated'
  | 'forbidden'
  | 'error';

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
    requestId?: string;
  };
};

const FIRST_LIVE_ANALYSIS_DELAY_MS = 1_200;
const LIVE_ANALYSIS_INTERVAL_MS = 12_000;
const REQUIRED_LIVE_CONSENTS: Array<{
  type: Extract<
    ConsentType,
    'care' | 'transcript_storage' | 'transient_audio_processing'
  >;
  title: string;
  description: string;
}> = [
  {
    type: 'care',
    title: 'Приём и документация',
    description: 'Разрешает врачу вести и сохранять запись этого приёма.',
  },
  {
    type: 'transcript_storage',
    title: 'Хранение расшифровки',
    description: 'Разрешает сохранить распознанный текст в истории приёма.',
  },
  {
    type: 'transient_audio_processing',
    title: 'Локальная обработка аудио',
    description: 'Нужна для передачи коротких фрагментов локальному STT на этом ПК.',
  },
];
const MEDICATION_CHECKS: Array<{ id: MedicationCheck; label: string }> = [
  { id: 'indication', label: 'Показание и цель проверены' },
  { id: 'interactions', label: 'Текущие препараты и взаимодействия проверены' },
  { id: 'allergies', label: 'Аллергии и нежелательные реакции проверены' },
  {
    id: 'contraindications',
    label: 'Противопоказания и факторы пациента проверены',
  },
];

function liveConsentDecisionLabel(consent: LiveConsent | null) {
  if (!consent) return 'Решение ещё не зафиксировано';
  if (consent.decision === 'granted') return `Предоставлено · версия ${consent.version}`;
  if (consent.decision === 'denied') return `Зафиксирован отказ · версия ${consent.version}`;
  return `Согласие отозвано · версия ${consent.version}`;
}

type WorkingClinicalSegment = ClinicalTranscriptSegment & {
  speaker: string | null;
  endMs: number | null;
  detectedLanguages: Set<'ru' | 'kk'>;
};

function formatDuration(totalSeconds: number) {
  const minutes = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const seconds = (totalSeconds % 60).toString().padStart(2, '0');
  return `${minutes}:${seconds}`;
}

function groupTokens(tokens: LocalSpeechToken[], provisional: boolean) {
  const turns: TranscriptTurn[] = [];

  for (const token of tokens) {
    const previous = turns.at(-1);
    const sameTurn =
      previous &&
      previous.speaker === token.speaker &&
      previous.language === token.language;

    if (sameTurn) {
      previous.text = `${previous.text.trimEnd()} ${token.text.trimStart()}`;
      continue;
    }

    turns.push({
      id: `${token.startMs ?? 'live'}-${token.speaker ?? 'unknown'}-${turns.length}`,
      speaker: token.speaker,
      language: token.language,
      text: token.text,
      startMs: token.startMs,
      provisional,
    });
  }

  return turns.filter((turn) => turn.text.trim().length > 0);
}

function segmentFinalTokens(
  tokens: LocalSpeechToken[],
  roleForSpeaker: (speaker: string | null) => SpeakerRole,
) {
  const working: WorkingClinicalSegment[] = [];

  for (const [index, token] of tokens.entries()) {
    if (!token.isFinal || !token.text.trim()) continue;

    const previous = working.at(-1);
    const gap =
      previous?.endMs !== null &&
      previous?.endMs !== undefined &&
      token.startMs !== null
        ? token.startMs - previous.endMs
        : null;
    const continuesPrevious = Boolean(
      previous &&
        previous.speaker === token.speaker &&
        (gap === null || gap <= 1_800) &&
        previous.text.length + token.text.length <= 1_000,
    );

    if (continuesPrevious && previous) {
      previous.text = `${previous.text.trimEnd()} ${token.text.trimStart()}`;
      previous.endMs = token.endMs ?? previous.endMs;
      if (token.language === 'ru' || token.language === 'kk') {
        previous.detectedLanguages.add(token.language);
      } else if (token.language === 'mixed') {
        previous.detectedLanguages.add('ru');
        previous.detectedLanguages.add('kk');
      }
      continue;
    }

    const detectedLanguages = new Set<'ru' | 'kk'>();
    if (token.language === 'ru' || token.language === 'kk') {
      detectedLanguages.add(token.language);
    } else if (token.language === 'mixed') {
      detectedLanguages.add('ru');
      detectedLanguages.add('kk');
    }

    working.push({
      id: `seg_${token.startMs ?? index}_${working.length}`,
      role: roleForSpeaker(token.speaker),
      language: token.language,
      text: token.text,
      speaker: token.speaker,
      endMs: token.endMs,
      detectedLanguages,
    });
  }

  return working.slice(-24).map((segment): ClinicalTranscriptSegment => {
    let language: ClinicalLanguage = 'unknown';
    if (segment.detectedLanguages.size > 1) language = 'mixed';
    else if (segment.detectedLanguages.has('ru')) language = 'ru';
    else if (segment.detectedLanguages.has('kk')) language = 'kk';

    return {
      id: segment.id,
      role: segment.role,
      language,
      text: segment.text.trim(),
    };
  });
}

function formatTranscriptTime(milliseconds: number | null) {
  if (milliseconds === null) return 'сейчас';
  return formatDuration(Math.floor(milliseconds / 1_000));
}

function languageLabel(language: TranscriptTurn['language']) {
  if (language === 'ru') return 'RU';
  if (language === 'kk') return 'KZ';
  if (language === 'mixed') return 'RU/KZ';
  return '—';
}

function suggestionCategoryLabel(category: ClinicalSuggestion['category']) {
  if (category === 'clarification') return 'Что уточнить';
  if (category === 'safety') return 'Безопасность';
  if (category === 'medication') return 'Вариант лекарства';
  return 'Вариант действия';
}

function suggestionCategoryGlyph(category: ClinicalSuggestion['category']) {
  if (category === 'clarification') return '?';
  if (category === 'safety') return '!';
  if (category === 'medication') return 'Rx';
  return '+';
}

function suggestionPriorityLabel(priority: ClinicalSuggestion['priority']) {
  if (priority === 'urgent') return 'Срочно проверить';
  if (priority === 'attention') return 'Обратить внимание';
  return 'Обычный приоритет';
}

export function OrionWorkspace({
  clinicianName,
  requestedEncounterId,
}: WorkspaceProps) {
  const [visitRailCollapsed, setVisitRailCollapsed] = useState(false);
  const [consentConfirmed, setConsentConfirmed] = useState(false);
  const [audioConsentConfirmed, setAudioConsentConfirmed] = useState(false);
  const [patientName, setPatientName] = useState('');
  const [sessionState, setSessionState] = useState<SessionState>('ready');
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [rolesSwapped, setRolesSwapped] = useState(false);
  const [analysisStatus, setAnalysisStatus] = useState<AnalysisStatus>('idle');
  const [analysis, setAnalysis] = useState<ClinicalAnalysisResponse | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [suggestionLedger, setSuggestionLedger] = useState<
    Record<string, SuggestionLedgerEntry>
  >({});
  const [currentSuggestionIds, setCurrentSuggestionIds] = useState<string[]>([]);
  const [suggestionView, setSuggestionView] = useState<SuggestionView>('active');
  const [medicationChecks, setMedicationChecks] = useState<
    Record<string, Partial<Record<MedicationCheck, boolean>>>
  >({});
  const [editingSuggestionId, setEditingSuggestionId] = useState<string | null>(
    null,
  );
  const [researchBySuggestion, setResearchBySuggestion] = useState<
    Record<string, ResearchState>
  >({});
  const analysisAbortRef = useRef<AbortController | null>(null);
  const researchAbortRef = useRef<AbortController | null>(null);
  const lastAnalyzedKeyRef = useRef('');
  const latestAnalysisKeyRef = useRef('');
  const lastAnalysisStartedAtRef = useRef(0);
  const analysisBackoffUntilRef = useRef(0);
  const [encounterId, setEncounterId] = useState<string | null>(null);
  const [encounterStartedAt, setEncounterStartedAt] = useState<string | null>(null);
  const [encounterEndedAt, setEncounterEndedAt] = useState<string | null>(null);
  const [historyRecords, setHistoryRecords] = useState<OrionEncounterRecord[]>([]);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [archiveDownloading, setArchiveDownloading] = useState(false);
  const [authoritativeEncounterId, setAuthoritativeEncounterId] = useState(
    requestedEncounterId,
  );
  const [authoritativeSnapshot, setAuthoritativeSnapshot] =
    useState<LiveWorkspaceSnapshot | null>(null);
  const [authoritativeLoadState, setAuthoritativeLoadState] =
    useState<AuthoritativeLoadState>('loading');
  const [authoritativeMessage, setAuthoritativeMessage] = useState<string | null>(
    null,
  );
  const [consentNoticeLanguage, setConsentNoticeLanguage] = useState<'ru' | 'kk'>(
    'ru',
  );
  const [pendingConsentType, setPendingConsentType] =
    useState<ConsentType | null>(null);
  const [consentActionMessage, setConsentActionMessage] = useState<string | null>(
    null,
  );
  const [confirmAudioConsentWithdrawal, setConfirmAudioConsentWithdrawal] =
    useState(false);
  const [persistedSpeechTokens, setPersistedSpeechTokens] = useState<
    LocalSpeechToken[]
  >([]);
  const [serverRecommendationReferences, setServerRecommendationReferences] =
    useState<Record<string, LiveRecommendationReference>>({});
  const [acknowledgedTranscriptKey, setAcknowledgedTranscriptKey] = useState<
    string | null
  >(null);
  const [pendingServerRecommendationId, setPendingServerRecommendationId] =
    useState<string | null>(null);
  const [serverEditReasons, setServerEditReasons] = useState<
    Record<string, string>
  >({});
  const serverCommandKeys = useRef<Record<string, string>>({});
  const consentCommandKeys = useRef<Record<string, string>>({});
  const currentEncounterRef = useRef<OrionEncounterRecord | null>(null);
  const handlePersistedSegment = useCallback((persistedSegment: LocalSpeechToken) => {
    setPersistedSpeechTokens((current) => mergeLiveTokens(current, [persistedSegment]));
    setAcknowledgedTranscriptKey(null);
  }, []);
  const speech = useLocalSpeechTranscription({
    encounterId: authoritativeEncounterId,
    onPersistedSegment: handlePersistedSegment,
  });

  useEffect(() => {
    try {
      setVisitRailCollapsed(
        window.localStorage.getItem('orion-visit-rail-collapsed') === 'true',
      );
    } catch {
      // The rail remains expanded when browser storage is unavailable.
    }
  }, []);

  const toggleVisitRail = () => {
    setVisitRailCollapsed((current) => {
      const next = !current;
      try {
        window.localStorage.setItem(
          'orion-visit-rail-collapsed',
          String(next),
        );
      } catch {
        // Visual state still works for the current tab.
      }
      return next;
    });
  };

  const loadAuthoritativeWorkspace = useCallback(async (encounterId?: string) => {
    setAuthoritativeLoadState('loading');
    setAuthoritativeMessage(null);
    try {
      const query = encounterId
        ? `?encounterId=${encodeURIComponent(encounterId)}`
        : '';
      const response = await fetch(`/api/workspace${query}`, {
        cache: 'no-store',
      });
      const payload = (await response.json().catch(() => null)) as
        | (LiveWorkspaceSnapshot & ApiErrorPayload)
        | null;

      if (response.status === 401) {
        setAuthoritativeLoadState('unauthenticated');
        setAuthoritativeSnapshot(null);
        setAuthoritativeMessage(payload?.error?.message ?? 'Требуется вход врача.');
        return false;
      }
      if (response.status === 403 || response.status === 404) {
        setAuthoritativeLoadState('forbidden');
        setAuthoritativeSnapshot(null);
        setAuthoritativeMessage(
          payload?.error?.message ?? 'Приём не найден или недоступен врачу.',
        );
        return false;
      }
      if (
        !response.ok ||
        !payload?.encounter?.id ||
        !Array.isArray(payload.transcript) ||
        !Array.isArray(payload.consents) ||
        !Array.isArray(payload.recommendations)
      ) {
        throw new Error(
          payload?.error?.message ?? 'Серверное состояние приёма недоступно.',
        );
      }

      const snapshot: LiveWorkspaceSnapshot = payload;
      const consent = getLiveConsentState(snapshot);
      const mappedRecommendations = mapLiveRecommendations(snapshot);
      const persistedTokens = mapLiveTranscript(snapshot);
      const resolvedEncounterId = snapshot.encounter.id;
      const startedAt = snapshot.encounter.startedAt
        ? new Date(snapshot.encounter.startedAt).toISOString()
        : null;

      setAuthoritativeEncounterId(resolvedEncounterId);
      setAuthoritativeSnapshot(snapshot);
      setPersistedSpeechTokens(persistedTokens);
      setPatientName(snapshot.encounter.patient.displayName);
      setConsentConfirmed(consent.speechReady);
      setAudioConsentConfirmed(consent.audioRetention);
      setConsentNoticeLanguage(
        getLiveConsent(snapshot, 'care')?.noticeLanguage ?? 'ru',
      );
      setConfirmAudioConsentWithdrawal(false);
      setEncounterId(resolvedEncounterId);
      setEncounterStartedAt(startedAt);
      setEncounterEndedAt(null);
      setAnalysis(mappedRecommendations.analysis);
      setSuggestionLedger(mappedRecommendations.ledger);
      setCurrentSuggestionIds(mappedRecommendations.suggestionIds);
      setServerRecommendationReferences(mappedRecommendations.references);
      setAnalysisStatus(
        mappedRecommendations.suggestionIds.length > 0 ? 'ready' : 'idle',
      );
      setAnalysisError(null);
      setSuggestionView('active');
      setEditingSuggestionId(null);
      setServerEditReasons({});
      setAuthoritativeLoadState('ready');
      setSessionState(
        ['review', 'finalized', 'amended', 'cancelled'].includes(
          snapshot.encounter.status,
        )
          ? 'review'
          : 'ready',
      );
      setElapsedSeconds(0);

      const currentUrl = new URL(window.location.href);
      if (currentUrl.searchParams.get('encounterId') !== resolvedEncounterId) {
        currentUrl.searchParams.set('encounterId', resolvedEncounterId);
        window.history.replaceState(null, '', currentUrl);
      }
      return true;
    } catch (error) {
      setAuthoritativeSnapshot(null);
      setAuthoritativeLoadState('error');
      setAuthoritativeMessage(
        error instanceof Error
          ? error.message
          : 'Не удалось загрузить точную серверную версию приёма.',
      );
      return false;
    }
  }, []);

  async function recordLiveConsentDecision(
    consentType: ConsentType,
    decision: ConsentDecision,
  ) {
    if (
      !authoritativeEncounterId ||
      !authoritativeSnapshot ||
      authoritativeLoadState !== 'ready' ||
      pendingConsentType
    ) {
      return;
    }

    const current = getLiveConsent(authoritativeSnapshot, consentType);
    const expectedVersion = current?.version ?? 0;
    const fingerprint = `${authoritativeEncounterId}:${consentType}:${decision}:${expectedVersion}:${consentNoticeLanguage}`;
    const idempotencyKey =
      consentCommandKeys.current[fingerprint] ?? crypto.randomUUID();
    consentCommandKeys.current[fingerprint] = idempotencyKey;

    setPendingConsentType(consentType);
    setConsentActionMessage(null);

    try {
      const response = await fetch('/api/workspace/consents/command', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: authoritativeEncounterId,
          consentType,
          decision,
          noticeLanguage: consentNoticeLanguage,
          source: 'verbal',
          expectedVersion,
          idempotencyKey,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ({ consent?: LiveConsent } & ApiErrorPayload)
        | null;

      if (response.status === 409) {
        delete consentCommandKeys.current[fingerprint];
        await loadAuthoritativeWorkspace(authoritativeEncounterId);
        setConsentActionMessage(
          payload?.error?.message ??
            'Решение изменилось в другой вкладке. Загружена актуальная версия.',
        );
        return;
      }

      if (!response.ok || !payload?.consent) {
        if (response.status < 500) {
          delete consentCommandKeys.current[fingerprint];
        }
        setConsentActionMessage(
          payload?.error?.message ?? 'Не удалось сохранить решение пациента.',
        );
        return;
      }

      delete consentCommandKeys.current[fingerprint];
      await loadAuthoritativeWorkspace(authoritativeEncounterId);
      setConsentActionMessage(
        decision === 'granted'
          ? `Согласие «${
              consentType === 'audio_retention'
                ? 'локальная аудиозапись'
                : REQUIRED_LIVE_CONSENTS.find((item) => item.type === consentType)
                    ?.title ?? consentType
            }» зафиксировано в D1.`
          : 'Отзыв согласия на локальную аудиозапись зафиксирован в D1.',
      );
    } catch {
      setConsentActionMessage(
        'Ответ сервера не получен. Обновите состояние приёма перед повтором.',
      );
    } finally {
      setPendingConsentType(null);
      setConfirmAudioConsentWithdrawal(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadAuthoritativeWorkspace(requestedEncounterId ?? undefined);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [loadAuthoritativeWorkspace, requestedEncounterId]);

  useEffect(() => {
    if (sessionState !== 'listening') return;
    const timer = window.setInterval(() => {
      setElapsedSeconds((current) => current + 1);
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [sessionState]);

  const statusLabel = useMemo(() => {
    if (sessionState === 'listening') return 'Приём идёт';
    if (sessionState === 'review') return 'Проверка решений';
    return 'Готов к приёму';
  }, [sessionState]);

  const finalSpeechTokens = useMemo(
    () => mergeLiveTokens(persistedSpeechTokens, speech.finalTokens),
    [persistedSpeechTokens, speech.finalTokens],
  );

  const transcriptTurns = useMemo(
    () => [
      ...groupTokens(finalSpeechTokens, false),
      ...groupTokens(speech.provisionalTokens, true),
    ],
    [finalSpeechTokens, speech.provisionalTokens],
  );

  const detectedSpeakers = useMemo(
    () =>
      Array.from(
        new Set(
          finalSpeechTokens
            .map((token) => token.speaker)
            .filter(
              (speaker): speaker is 'doctor' | 'patient' =>
                speaker === 'doctor' || speaker === 'patient',
            ),
        ),
      ),
    [finalSpeechTokens],
  );

  const roleForSpeaker = useCallback(
    (speaker: string | null): SpeakerRole => {
      if (!speaker) return 'unknown';
      if (speaker === 'doctor') return rolesSwapped ? 'patient' : 'doctor';
      if (speaker === 'patient') return rolesSwapped ? 'doctor' : 'patient';
      return 'unknown';
    },
    [rolesSwapped],
  );

  const analysisSegments = useMemo(
    () => segmentFinalTokens(finalSpeechTokens, roleForSpeaker),
    [finalSpeechTokens, roleForSpeaker],
  );
  const authoritativeTranscriptSnapshot = useMemo(
    () =>
      finalSpeechTokens
        .filter(
          (
            token,
          ): token is LocalSpeechToken & { sourceId: string; version: number } =>
            Boolean(
              token.isFinal &&
                token.sourceId &&
                typeof token.version === 'number' &&
                Number.isInteger(token.version) &&
                token.version > 0,
            ),
        )
        .slice(-24)
        .map((token) => ({ id: token.sourceId, version: token.version })),
    [finalSpeechTokens],
  );
  const authoritativeTranscriptKey = useMemo(
    () => JSON.stringify(authoritativeTranscriptSnapshot),
    [authoritativeTranscriptSnapshot],
  );
  const transcriptAcknowledged = Boolean(
    authoritativeTranscriptSnapshot.length > 0 &&
      acknowledgedTranscriptKey === authoritativeTranscriptKey,
  );
  const analysisKey = useMemo(
    () =>
      analysisSegments
        .map((segment) => `${segment.id}:${segment.role}:${segment.text}`)
        .join('|'),
    [analysisSegments],
  );
  const analysisCharacterCount = useMemo(
    () =>
      analysisSegments.reduce(
        (total, segment) => total + segment.text.length,
        0,
      ),
    [analysisSegments],
  );

  useEffect(() => {
    latestAnalysisKeyRef.current = analysisKey;
    const activeRequest = analysisAbortRef.current;
    if (!activeRequest) return;
    analysisAbortRef.current = null;
    activeRequest.abort();
    setAnalysisStatus((current) =>
      current === 'loading' ? (analysisKey ? 'waiting' : 'idle') : current,
    );
  }, [analysisKey]);

  const runAnalysis = useCallback(
    async (mode: 'live' | 'final', force = false) => {
      if (authoritativeEncounterId) {
        if (
          !authoritativeSnapshot ||
          authoritativeSnapshot.encounter.status !== 'in_progress'
        ) {
          setAnalysisStatus('error');
          setAnalysisError(
            'Новые черновики можно создать только для приёма со статусом «идёт».',
          );
          return;
        }
        const consent = getLiveConsentState(authoritativeSnapshot);
        if (!consent.analysisReady) {
          setAnalysisStatus('error');
          setAnalysisError(
            'В D1 нет действующего согласия на передачу расшифровки в Groq.',
          );
          return;
        }
        if (!transcriptAcknowledged || authoritativeTranscriptSnapshot.length === 0) {
          setAnalysisStatus('error');
          setAnalysisError(
            'Сначала сверьте текст, язык и роли говорящих в текущей версии расшифровки.',
          );
          return;
        }

        const commandFingerprint = JSON.stringify({
          encounterId: authoritativeEncounterId,
          snapshot: authoritativeTranscriptSnapshot,
        });
        const idempotencyKey =
          serverCommandKeys.current[commandFingerprint] ?? crypto.randomUUID();
        serverCommandKeys.current[commandFingerprint] = idempotencyKey;
        setAnalysisStatus('loading');
        setAnalysisError(null);
        try {
          const response = await fetch('/api/workspace/recommendations/generate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              encounterId: authoritativeEncounterId,
              snapshot: authoritativeTranscriptSnapshot,
              acknowledged: true,
              idempotencyKey,
            }),
          });
          const payload = (await response.json().catch(() => null)) as
            | ({ runId?: string; replay?: boolean } & ApiErrorPayload)
            | null;
          if (!response.ok || !payload?.runId) {
            if (response.status < 500) {
              delete serverCommandKeys.current[commandFingerprint];
            }
            throw new Error(
              payload?.error?.message ??
                'Не удалось сохранить серверные клинические черновики.',
            );
          }
          delete serverCommandKeys.current[commandFingerprint];
          await loadAuthoritativeWorkspace(authoritativeEncounterId);
          setAcknowledgedTranscriptKey(null);
          setAnalysisStatus('ready');
        } catch (error) {
          setAnalysisStatus('error');
          setAnalysisError(
            error instanceof Error
              ? error.message
              : 'Клинический анализ временно недоступен.',
          );
        }
        return;
      }

      if (analysisCharacterCount < 40 || analysisSegments.length === 0) return;
      if (!force && analysisKey === lastAnalyzedKeyRef.current) return;

      analysisAbortRef.current?.abort();
      researchAbortRef.current?.abort();
      const controller = new AbortController();
      const requestedKey = analysisKey;
      analysisAbortRef.current = controller;
      lastAnalysisStartedAtRef.current = Date.now();
      setAnalysisStatus('loading');
      setAnalysisError(null);

      try {
        const result = await requestClinicalAnalysis(
          { segments: analysisSegments, mode },
          controller.signal,
        );
        if (
          controller.signal.aborted ||
          analysisAbortRef.current !== controller ||
          latestAnalysisKeyRef.current !== requestedKey
        ) {
          return;
        }

        lastAnalyzedKeyRef.current = requestedKey;
        analysisBackoffUntilRef.current = 0;
        setAnalysis(result);
        setResearchBySuggestion({});
        setCurrentSuggestionIds(result.suggestions.map((suggestion) => suggestion.id));
        setSuggestionLedger((current) => {
          const next = { ...current };
          const now = new Date().toISOString();
          for (const suggestion of result.suggestions) {
            const existing = current[suggestion.id];
            next[suggestion.id] = existing
              ? {
                  ...existing,
                  suggestion:
                    existing.status === 'pending'
                      ? suggestion
                      : existing.suggestion,
                  draftTitle:
                    existing.status === 'pending' &&
                    existing.draftTitle === existing.suggestion.title
                      ? suggestion.title
                      : existing.draftTitle,
                  draftPrompt:
                    existing.status === 'pending' &&
                    existing.draftPrompt === existing.suggestion.clinicianPrompt
                      ? suggestion.clinicianPrompt
                      : existing.draftPrompt,
                  lastSeenAt: now,
                }
              : {
                  id: suggestion.id,
                  suggestion,
                  draftTitle: suggestion.title,
                  draftPrompt: suggestion.clinicianPrompt,
                  status: 'pending',
                  firstSeenAt: now,
                  lastSeenAt: now,
                };
          }
          return next;
        });
        setAnalysisStatus('ready');
      } catch (error) {
        if (
          controller.signal.aborted ||
          analysisAbortRef.current !== controller ||
          latestAnalysisKeyRef.current !== requestedKey
        ) {
          return;
        }
        if (
          error instanceof ClinicalAnalysisRequestError &&
          error.status === 429
        ) {
          const retryAfterSeconds = error.retryAfterSeconds ?? 30;
          analysisBackoffUntilRef.current = Math.max(
            analysisBackoffUntilRef.current,
            Date.now() + Math.max(1, retryAfterSeconds) * 1_000,
          );
        }
        setAnalysisStatus('error');
        setAnalysisError(
          error instanceof Error
            ? error.message
            : 'Клинический анализ временно недоступен.',
        );
      } finally {
        if (analysisAbortRef.current === controller) {
          analysisAbortRef.current = null;
        }
      }
    },
    [
      analysisCharacterCount,
      analysisKey,
      analysisSegments,
      authoritativeEncounterId,
      authoritativeSnapshot,
      authoritativeTranscriptSnapshot,
      loadAuthoritativeWorkspace,
      transcriptAcknowledged,
    ],
  );

  useEffect(() => {
    if (authoritativeEncounterId) return;
    if (
      sessionState !== 'listening' ||
      analysisCharacterCount < 80 ||
      analysisKey === lastAnalyzedKeyRef.current
    ) {
      return;
    }

    setAnalysisStatus((current) =>
      current === 'loading' ? current : 'waiting',
    );
    const elapsedSinceLastStart =
      Date.now() - lastAnalysisStartedAtRef.current;
    const delay = lastAnalysisStartedAtRef.current
      ? Math.max(500, LIVE_ANALYSIS_INTERVAL_MS - elapsedSinceLastStart)
      : FIRST_LIVE_ANALYSIS_DELAY_MS;
    const scheduledDelay = Math.max(
      delay,
      analysisBackoffUntilRef.current - Date.now(),
    );
    const timer = window.setTimeout(() => {
      void runAnalysis('live');
    }, scheduledDelay);
    return () => window.clearTimeout(timer);
  }, [
    analysisCharacterCount,
    analysisKey,
    authoritativeEncounterId,
    runAnalysis,
    sessionState,
  ]);

  useEffect(() => {
    if (authoritativeEncounterId) return;
    if (
      sessionState !== 'review' ||
      (speech.status !== 'finished' && speech.status !== 'error') ||
      analysisCharacterCount < 40 ||
      analysisKey === lastAnalyzedKeyRef.current
    ) {
      return;
    }

    const delay = Math.max(
      400,
      analysisBackoffUntilRef.current - Date.now(),
    );
    const timer = window.setTimeout(() => {
      void runAnalysis('final', true);
    }, delay);
    return () => window.clearTimeout(timer);
  }, [
    analysisCharacterCount,
    analysisKey,
    authoritativeEncounterId,
    runAnalysis,
    sessionState,
    speech.status,
  ]);

  useEffect(
    () => () => {
      analysisAbortRef.current?.abort();
      researchAbortRef.current?.abort();
    },
    [],
  );

  const speechStatusLabel = useMemo(() => {
    if (speech.status === 'requesting') return 'Подключаем микрофон';
    if (speech.status === 'connecting') return 'Готовим локальный STT';
    if (speech.status === 'streaming' && speech.activity === 'speaking') {
      return 'Слышу речь · записываю';
    }
    if (speech.status === 'streaming' && speech.activity === 'recognizing') {
      return 'Реплика принята · распознаём';
    }
    if (speech.status === 'streaming') {
      return 'Говорите · локальный RU/KZ контур активен';
    }
    if (speech.status === 'stopping') return 'Завершаем расшифровку';
    if (speech.status === 'finished') return 'Расшифровка завершена';
    if (speech.status === 'error') return 'Речевой контур не запущен';
    return 'Микрофон ожидает запуска';
  }, [speech.activity, speech.status]);

  const startSession = () => {
    if (!consentConfirmed) return;
    if (authoritativeEncounterId) {
      if (
        authoritativeLoadState !== 'ready' ||
        !authoritativeSnapshot ||
        authoritativeSnapshot.encounter.status !== 'in_progress' ||
        !getLiveConsentState(authoritativeSnapshot).speechReady
      ) {
        setAuthoritativeMessage(
          'Для запуска нужен приём со статусом «идёт» и действующие согласия на лечение, расшифровку и локальную обработку аудио.',
        );
        return;
      }
      const startedAt = authoritativeSnapshot.encounter.startedAt
        ? new Date(authoritativeSnapshot.encounter.startedAt).toISOString()
        : new Date().toISOString();
      analysisAbortRef.current?.abort();
      analysisAbortRef.current = null;
      researchAbortRef.current?.abort();
      setRolesSwapped(false);
      setElapsedSeconds(0);
      setAnalysisError(null);
      setSuggestionView('active');
      setMedicationChecks({});
      setEditingSuggestionId(null);
      setEncounterId(authoritativeEncounterId);
      setEncounterStartedAt(startedAt);
      setEncounterEndedAt(null);
      setHistoryError(null);
      setAuthoritativeMessage(null);
      setSessionState('listening');
      void speech.start({ recordAudio: audioConsentConfirmed });
      return;
    }
    const startedAt = new Date().toISOString();
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    researchAbortRef.current?.abort();
    setElapsedSeconds(0);
    setRolesSwapped(false);
    setAnalysisStatus('idle');
    setAnalysis(null);
    setAnalysisError(null);
    setSuggestionLedger({});
    setCurrentSuggestionIds([]);
    setSuggestionView('active');
    setMedicationChecks({});
    setEditingSuggestionId(null);
    setResearchBySuggestion({});
    setEncounterId(crypto.randomUUID());
    setEncounterStartedAt(startedAt);
    setEncounterEndedAt(null);
    setHistoryError(null);
    lastAnalyzedKeyRef.current = '';
    lastAnalysisStartedAtRef.current = 0;
    analysisBackoffUntilRef.current = 0;
    setSessionState('listening');
    void speech.start({ recordAudio: audioConsentConfirmed });
  };

  const stopSession = async () => {
    setEncounterEndedAt((current) => current ?? new Date().toISOString());
    setSessionState('review');
    if (
      speech.status === 'streaming' ||
      speech.status === 'connecting' ||
      speech.status === 'requesting'
    ) {
      await speech.stop();
    }
  };

  const resetSession = async () => {
    const finalizedAudio =
      sessionState === 'ready' ? null : await speech.stop();
    const currentRecord = currentEncounterRef.current;
    if (currentRecord) {
      try {
        const completedRecord: OrionEncounterRecord = {
          ...currentRecord,
          status: 'completed',
          endedAt: currentRecord.endedAt ?? new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          audio: finalizedAudio ?? currentRecord.audio,
          audioMimeType:
            finalizedAudio?.type || currentRecord.audioMimeType,
        };
        await saveEncounter(completedRecord);
        setHistoryRecords((records) => [
          completedRecord,
          ...records.filter((record) => record.id !== completedRecord.id),
        ]);
      } catch (error) {
        setHistoryError(
          error instanceof Error
            ? error.message
            : 'Последний приём не удалось сохранить.',
        );
        return;
      }
    }
    if (authoritativeEncounterId) {
      speech.reset();
      setEncounterEndedAt(null);
      setAcknowledgedTranscriptKey(null);
      await loadAuthoritativeWorkspace(authoritativeEncounterId);
      return;
    }
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    researchAbortRef.current?.abort();
    speech.reset();
    setConsentConfirmed(false);
    setAudioConsentConfirmed(false);
    setPatientName('');
    setElapsedSeconds(0);
    setRolesSwapped(false);
    setAnalysisStatus('idle');
    setAnalysis(null);
    setAnalysisError(null);
    setSuggestionLedger({});
    setCurrentSuggestionIds([]);
    setSuggestionView('active');
    setMedicationChecks({});
    setEditingSuggestionId(null);
    setResearchBySuggestion({});
    setEncounterId(null);
    setEncounterStartedAt(null);
    setEncounterEndedAt(null);
    currentEncounterRef.current = null;
    lastAnalyzedKeyRef.current = '';
    lastAnalysisStartedAtRef.current = 0;
    analysisBackoffUntilRef.current = 0;
    setSessionState('ready');
  };

  const swapSpeakerRoles = () => {
    analysisAbortRef.current?.abort();
    analysisAbortRef.current = null;
    researchAbortRef.current?.abort();
    setRolesSwapped((value) => !value);
    setAnalysis(null);
    setAnalysisStatus('waiting');
    setAnalysisError(null);
    setCurrentSuggestionIds(
      Object.values(suggestionLedger)
        .filter((entry) => entry.status !== 'discarded')
        .map((entry) => entry.id),
    );
    setSuggestionLedger((current) =>
      Object.fromEntries(
        Object.entries(current).map(([id, entry]) => [
          id,
          {
            ...entry,
            status:
              entry.status === 'accepted'
                ? ('pending' as const)
                : entry.status,
            decidedAt:
              entry.status === 'accepted' ? undefined : entry.decidedAt,
          },
        ]),
      ),
    );
    setMedicationChecks({});
    setEditingSuggestionId(null);
    setResearchBySuggestion({});
    lastAnalyzedKeyRef.current = '';
    lastAnalysisStartedAtRef.current = 0;
    analysisBackoffUntilRef.current = 0;
  };

  const reviewSuggestion = async (
    id: string,
    status: SuggestionDecisionStatus,
  ) => {
    if (authoritativeEncounterId) {
      const reference = serverRecommendationReferences[id];
      if (!reference || pendingServerRecommendationId) return;
      const decision =
        status === 'accepted'
          ? 'accept'
          : status === 'discarded'
            ? 'reject'
            : 'restore';
      const fingerprint = `${authoritativeEncounterId}:${id}:${decision}:${reference.expectedVersion}:${reference.derivativeVersionId ?? 'original'}`;
      const idempotencyKey =
        serverCommandKeys.current[fingerprint] ?? crypto.randomUUID();
      serverCommandKeys.current[fingerprint] = idempotencyKey;
      setPendingServerRecommendationId(id);
      setAuthoritativeMessage('Фиксируем решение врача в D1…');
      try {
        const response = await fetch('/api/workspace/recommendations/decision', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            encounterId: authoritativeEncounterId,
            recommendationId: id,
            decision,
            derivativeVersionId: reference.derivativeVersionId,
            expectedVersion: reference.expectedVersion,
            idempotencyKey,
          }),
        });
        const payload = (await response.json().catch(() => null)) as
          | ({ recommendation?: unknown } & ApiErrorPayload)
          | null;
        if (!response.ok || !payload?.recommendation) {
          if (response.status < 500) delete serverCommandKeys.current[fingerprint];
          throw new Error(
            payload?.error?.message ?? 'Не удалось сохранить решение врача.',
          );
        }
        delete serverCommandKeys.current[fingerprint];
        await loadAuthoritativeWorkspace(authoritativeEncounterId);
        setAuthoritativeMessage(
          status === 'accepted'
            ? 'Решение принято и сохранено в D1.'
            : status === 'discarded'
              ? 'Рекомендация сохранена в серверной корзине.'
              : 'Рекомендация возвращена на проверку.',
        );
      } catch (error) {
        setAuthoritativeMessage(
          error instanceof Error
            ? error.message
            : 'Ответ сервера не получен; решение не подтверждено.',
        );
      } finally {
        setPendingServerRecommendationId(null);
      }
      return;
    }

    setSuggestionLedger((current) => {
      const entry = current[id];
      if (!entry) return current;
      const now = new Date().toISOString();
      return {
        ...current,
        [id]: {
          ...entry,
          status,
          decidedAt: status === 'pending' ? undefined : now,
          acceptedSnapshot:
            status === 'accepted'
              ? {
                  title: entry.draftTitle,
                  clinicianPrompt: entry.draftPrompt,
                  category: entry.suggestion.category,
                  evidenceSegmentIds: [...entry.suggestion.evidenceSegmentIds],
                  acceptedAt: now,
                }
              : entry.acceptedSnapshot,
        },
      };
    });
    if (status === 'pending') {
      setCurrentSuggestionIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
    }
    setEditingSuggestionId(null);
  };

  const saveServerSuggestionEdit = async (id: string) => {
    if (!authoritativeEncounterId || pendingServerRecommendationId) return;
    const entry = suggestionLedger[id];
    const reference = serverRecommendationReferences[id];
    const title = entry?.draftTitle.trim() ?? '';
    const content = entry?.draftPrompt.trim() ?? '';
    const reason = serverEditReasons[id]?.trim() ?? '';
    if (!entry || !reference || !title || !content || reason.length < 3) {
      setAuthoritativeMessage(
        'Для серверной версии заполните заголовок, текст и основание изменения (минимум 3 символа).',
      );
      return;
    }
    const fingerprint = JSON.stringify({
      encounterId: authoritativeEncounterId,
      recommendationId: id,
      expectedVersion: reference.expectedVersion,
      title,
      content,
      reason,
    });
    const idempotencyKey =
      serverCommandKeys.current[fingerprint] ?? crypto.randomUUID();
    serverCommandKeys.current[fingerprint] = idempotencyKey;
    setPendingServerRecommendationId(id);
    setAuthoritativeMessage('Сохраняем отдельную версию врача в D1…');
    try {
      const response = await fetch('/api/workspace/recommendations/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          encounterId: authoritativeEncounterId,
          recommendationId: id,
          expectedVersion: reference.expectedVersion,
          title,
          content,
          reason,
          idempotencyKey,
        }),
      });
      const payload = (await response.json().catch(() => null)) as
        | ({ recommendation?: unknown } & ApiErrorPayload)
        | null;
      if (!response.ok || !payload?.recommendation) {
        if (response.status < 500) delete serverCommandKeys.current[fingerprint];
        throw new Error(
          payload?.error?.message ?? 'Не удалось сохранить версию врача.',
        );
      }
      delete serverCommandKeys.current[fingerprint];
      await loadAuthoritativeWorkspace(authoritativeEncounterId);
      setEditingSuggestionId(null);
      setAuthoritativeMessage(
        'Версия врача сохранена. Теперь её можно принять или отправить в корзину.',
      );
    } catch (error) {
      setAuthoritativeMessage(
        error instanceof Error
          ? error.message
          : 'Ответ сервера не получен; версия не подтверждена.',
      );
    } finally {
      setPendingServerRecommendationId(null);
    }
  };

  const updateSuggestionReview = (
    id: string,
    field: 'title' | 'clinicianPrompt',
    value: string,
  ) => {
    setCurrentSuggestionIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setSuggestionLedger((current) => {
      const entry = current[id];
      if (!entry) return current;
      return {
        ...current,
        [id]: {
          ...entry,
          [field === 'title' ? 'draftTitle' : 'draftPrompt']: value.slice(0, 260),
          status: entry.status === 'accepted' ? 'pending' : entry.status,
          acceptedSnapshot:
            entry.status === 'accepted' ? undefined : entry.acceptedSnapshot,
          decidedAt: entry.status === 'accepted' ? undefined : entry.decidedAt,
        },
      };
    });
  };

  const runResearch = useCallback(
    async (suggestion: ClinicalSuggestion) => {
      const evidence = authoritativeEncounterId
        ? finalSpeechTokens
            .filter(
              (token) =>
                token.sourceId &&
                suggestion.evidenceSegmentIds.includes(token.sourceId),
            )
            .map(
              (token): ClinicalTranscriptSegment => ({
                id: token.sourceId!,
                role: roleForSpeaker(token.speaker),
                language: token.language,
                text: token.text.trim(),
              }),
            )
        : analysisSegments.filter((segment) =>
            suggestion.evidenceSegmentIds.includes(segment.id),
          );
      if (evidence.length === 0) return;

      researchAbortRef.current?.abort();
      const controller = new AbortController();
      researchAbortRef.current = controller;
      setResearchBySuggestion((current) => ({
        ...current,
        [suggestion.id]: { status: 'loading' },
      }));

      try {
        const result = await requestClinicalResearch(
          {
            suggestion: {
              title: suggestion.title,
              rationale: suggestion.rationale,
              clinicianPrompt: suggestion.clinicianPrompt,
            },
            evidence,
          },
          controller.signal,
        );
        if (controller.signal.aborted || researchAbortRef.current !== controller) {
          return;
        }
        setResearchBySuggestion((current) => ({
          ...current,
          [suggestion.id]: { status: 'ready', result },
        }));
      } catch (error) {
        if (controller.signal.aborted || researchAbortRef.current !== controller) {
          return;
        }
        setResearchBySuggestion((current) => ({
          ...current,
          [suggestion.id]: {
            status: 'error',
            error:
              error instanceof Error
                ? error.message
                : 'Проверка источников временно недоступна.',
          },
        }));
      }
    },
    [analysisSegments, authoritativeEncounterId, finalSpeechTokens, roleForSpeaker],
  );

  const activeSuggestionEntries = useMemo(() => {
    const currentIds = new Set(currentSuggestionIds);
    return Object.values(suggestionLedger)
      .filter(
        (entry) =>
          entry.status !== 'discarded' &&
          (entry.status === 'accepted' || currentIds.has(entry.id)),
      )
      .sort((left, right) => left.firstSeenAt.localeCompare(right.firstSeenAt));
  }, [currentSuggestionIds, suggestionLedger]);
  const discardedSuggestionEntries = useMemo(
    () =>
      Object.values(suggestionLedger)
        .filter((entry) => entry.status === 'discarded')
        .sort((left, right) => right.lastSeenAt.localeCompare(left.lastSeenAt)),
    [suggestionLedger],
  );
  const reviewedSuggestionCount = useMemo(
    () =>
      currentSuggestionIds.filter(
        (id) =>
          suggestionLedger[id] && suggestionLedger[id].status !== 'pending',
      ).length,
    [currentSuggestionIds, suggestionLedger],
  );
  const acceptedSuggestionCount = useMemo(
    () =>
      Object.values(suggestionLedger).filter(
        (entry) => entry.status === 'accepted',
      ).length,
    [suggestionLedger],
  );
  const pendingSuggestionCount = useMemo(
    () =>
      activeSuggestionEntries.filter((entry) => entry.status === 'pending')
        .length,
    [activeSuggestionEntries],
  );

  const encounterTranscript = useMemo(
    () =>
      groupTokens(finalSpeechTokens, false).map((turn) => ({
        id: turn.id,
        role: roleForSpeaker(turn.speaker),
        language: turn.language,
        text: turn.text.trim(),
        startMs: turn.startMs,
      })),
    [finalSpeechTokens, roleForSpeaker],
  );

  const currentEncounter = useMemo<OrionEncounterRecord | null>(() => {
    if (!encounterId || !encounterStartedAt) return null;
    return {
      version: 1,
      id: encounterId,
      status: sessionState === 'listening' ? 'in_progress' : 'completed',
      clinicianName,
      patientName: patientName.trim(),
      startedAt: encounterStartedAt,
      endedAt: encounterEndedAt,
      updatedAt: new Date().toISOString(),
      durationSeconds: elapsedSeconds,
      consent: {
        transcription: consentConfirmed,
        audioRecording: audioConsentConfirmed,
        confirmedAt: encounterStartedAt,
      },
      transcript: encounterTranscript,
      analysisSummary: analysis?.summary ?? null,
      decisions: Object.values(suggestionLedger),
      audio: speech.recordedAudio,
      audioMimeType: speech.recordedAudio?.type || null,
      audioError: speech.recordingError,
    };
  }, [
    analysis?.summary,
    audioConsentConfirmed,
    clinicianName,
    consentConfirmed,
    elapsedSeconds,
    encounterEndedAt,
    encounterId,
    encounterStartedAt,
    encounterTranscript,
    patientName,
    sessionState,
    speech.recordedAudio,
    speech.recordingError,
    suggestionLedger,
  ]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await markAbandonedEncountersInterrupted();
        const records = await listEncounters();
        if (!cancelled) setHistoryRecords(records);
      } catch (error) {
        if (!cancelled) {
          setHistoryError(
            error instanceof Error
              ? error.message
              : 'Локальная история недоступна.',
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    currentEncounterRef.current = currentEncounter;
    if (!currentEncounter) return;
    const timer = window.setTimeout(() => {
      void saveEncounter(currentEncounter)
        .then(() => {
          setHistoryRecords((records) =>
            [
              currentEncounter,
              ...records.filter((record) => record.id !== currentEncounter.id),
            ].sort((left, right) =>
              right.startedAt.localeCompare(left.startedAt),
            ),
          );
          setHistoryError(null);
        })
        .catch((error) => {
          setHistoryError(
            error instanceof Error
              ? error.message
              : 'Приём не удалось сохранить локально.',
          );
        });
    }, 300);
    return () => window.clearTimeout(timer);
  }, [currentEncounter]);

  const renameEncounter = async (recordId: string, nextName: string) => {
    const source =
      currentEncounterRef.current?.id === recordId
        ? currentEncounterRef.current
        : historyRecords.find((record) => record.id === recordId);
    if (!source) throw new Error('Приём не найден в локальной истории.');

    const updated: OrionEncounterRecord = {
      ...source,
      patientName: nextName.trim().slice(0, 100),
      updatedAt: new Date().toISOString(),
    };
    await saveEncounter(updated);
    if (currentEncounterRef.current?.id === recordId) {
      currentEncounterRef.current = updated;
      setPatientName(updated.patientName ?? '');
    }
    setHistoryRecords((records) =>
      records.map((record) => (record.id === recordId ? updated : record)),
    );
  };

  const medicationIsChecked = (id: string) =>
    MEDICATION_CHECKS.every((item) => medicationChecks[id]?.[item.id]);

  const toggleMedicationCheck = (id: string, check: MedicationCheck) => {
    setMedicationChecks((current) => ({
      ...current,
      [id]: {
        ...current[id],
        [check]: !current[id]?.[check],
      },
    }));
  };

  const renderSuggestionCard = (entry: SuggestionLedgerEntry) => {
    const suggestion = entry.suggestion;
    const isEditing = editingSuggestionId === suggestion.id;
    const research = researchBySuggestion[suggestion.id];
    const isMedication = suggestion.category === 'medication';
    const promptLabel =
      suggestion.category === 'clarification'
        ? 'Можно спросить пациента'
        : isMedication
          ? 'Вариант для клинической проверки'
          : 'Что может рассмотреть врач';

    return (
      <article
        className={`suggestion-card category-${suggestion.category} status-${entry.status}`}
        key={suggestion.id}
      >
        <div className="suggestion-origin">Рекомендация ORION</div>
        <div className="suggestion-card__meta">
          <span className={`insight-icon ${suggestion.category}`}>
            {suggestionCategoryGlyph(suggestion.category)}
          </span>
          <div>
            <strong>{suggestionCategoryLabel(suggestion.category)}</strong>
            <small>{suggestionPriorityLabel(suggestion.priority)}</small>
          </div>
          <span className="review-state">
            {entry.status === 'accepted'
              ? 'Добавлено'
              : entry.status === 'discarded'
                ? 'В корзине'
                : 'Ожидает врача'}
          </span>
        </div>

        {isEditing ? (
          <div className="suggestion-editor">
            <label>
              Заголовок решения
              <textarea
                value={entry.draftTitle}
                onChange={(event) =>
                  updateSuggestionReview(
                    suggestion.id,
                    'title',
                    event.target.value,
                  )
                }
              />
            </label>
            <label>
              Формулировка для врача
              <textarea
                value={entry.draftPrompt}
                onChange={(event) =>
                  updateSuggestionReview(
                    suggestion.id,
                    'clinicianPrompt',
                    event.target.value,
                  )
                }
              />
            </label>
            {authoritativeEncounterId && (
              <label>
                Основание изменения
                <textarea
                  value={serverEditReasons[suggestion.id] ?? ''}
                  maxLength={500}
                  placeholder="Например: уточнено после осмотра пациента"
                  onChange={(event) =>
                    setServerEditReasons((current) => ({
                      ...current,
                      [suggestion.id]: event.target.value,
                    }))
                  }
                />
              </label>
            )}
          </div>
        ) : (
          <>
            <h3>{entry.draftTitle}</h3>
            <p>{suggestion.rationale}</p>
            <div className="suggestion-prompt">
              <span>{promptLabel}</span>
              <strong>{entry.draftPrompt}</strong>
            </div>
          </>
        )}

        {isMedication && entry.status !== 'discarded' && (
          <fieldset className="medication-checklist">
            <legend>Перед добавлением в протокол</legend>
            {MEDICATION_CHECKS.map((item) => (
              <label key={item.id}>
                <input
                  type="checkbox"
                  checked={Boolean(medicationChecks[suggestion.id]?.[item.id])}
                  onChange={() => toggleMedicationCheck(suggestion.id, item.id)}
                />
                <span>{item.label}</span>
              </label>
            ))}
            <small>
              ORION предлагает только вариант. Дозу, путь, кратность и длительность определяет врач.
            </small>
          </fieldset>
        )}

        <div className="suggestion-evidence">
          <span>
            Основание: {suggestion.evidenceSegmentIds.length}{' '}
            {suggestion.evidenceSegmentIds.length === 1
              ? 'фрагмент'
              : 'фрагмента'}
          </span>
          {entry.status !== 'discarded' && (
            <div className="suggestion-edit-actions">
              {isEditing && authoritativeEncounterId ? (
                <>
                  <button
                    type="button"
                    disabled={
                      pendingServerRecommendationId === suggestion.id ||
                      authoritativeReviewLocked
                    }
                    onClick={() => void saveServerSuggestionEdit(suggestion.id)}
                  >
                    Сохранить версию
                  </button>
                  <button
                    type="button"
                    disabled={pendingServerRecommendationId === suggestion.id}
                    onClick={() => setEditingSuggestionId(null)}
                  >
                    Отмена
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  disabled={
                    pendingServerRecommendationId === suggestion.id ||
                    authoritativeReviewLocked
                  }
                  onClick={() =>
                    setEditingSuggestionId(isEditing ? null : suggestion.id)
                  }
                >
                  {isEditing ? 'Готово' : 'Изменить'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="suggestion-actions">
          {entry.status === 'discarded' ? (
            <button
              className="restore"
              type="button"
              disabled={
                pendingServerRecommendationId === suggestion.id ||
                authoritativeReviewLocked
              }
              onClick={() => void reviewSuggestion(suggestion.id, 'pending')}
            >
              Вернуть в рекомендации
            </button>
          ) : (
            <>
              <button
                className="accept"
                type="button"
                disabled={
                  entry.status === 'accepted' ||
                  pendingServerRecommendationId === suggestion.id ||
                  authoritativeReviewLocked ||
                  (isMedication && !medicationIsChecked(suggestion.id))
                }
                title={
                  isMedication && !medicationIsChecked(suggestion.id)
                    ? 'Сначала подтвердите проверки безопасности'
                    : undefined
                }
                onClick={() => void reviewSuggestion(suggestion.id, 'accepted')}
              >
                {entry.status === 'accepted'
                  ? 'Добавлено в протокол'
                  : suggestion.category === 'clarification'
                    ? 'Добавить вопрос'
                    : 'Добавить в протокол'}
              </button>
              <button
                className="reject"
                type="button"
                disabled={
                  pendingServerRecommendationId === suggestion.id ||
                  authoritativeReviewLocked
                }
                onClick={() => void reviewSuggestion(suggestion.id, 'discarded')}
              >
                В корзину
              </button>
            </>
          )}
        </div>

        {entry.status !== 'discarded' && (
          <div className={`research-check is-${research?.status ?? 'idle'}`}>
            <button
              type="button"
              disabled={research?.status === 'loading'}
              onClick={() => void runResearch(suggestion)}
            >
              {research?.status === 'loading'
                ? 'Compound ищет источники…'
                : research?.status === 'ready'
                  ? 'Обновить проверку'
                  : 'Проверить по источникам'}
            </button>
            {research?.status === 'error' && <p role="alert">{research.error}</p>}
            {research?.status === 'ready' && research.result && (
              <div className="research-result">
                <strong>Проверка Compound</strong>
                <p>{research.result.answer}</p>
                {research.result.sources.length > 0 && (
                  <ul>
                    {research.result.sources.map((source) => (
                      <li key={source.url}>
                        <a href={source.url} target="_blank" rel="noreferrer">
                          {source.title}
                        </a>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
          </div>
        )}
      </article>
    );
  };

  const clarificationEntries = activeSuggestionEntries.filter(
    (entry) => entry.suggestion.category === 'clarification',
  );
  const recommendationEntries = activeSuggestionEntries.filter(
    (entry) => entry.suggestion.category !== 'clarification',
  );
  const authoritativeConsent = authoritativeSnapshot
    ? getLiveConsentState(authoritativeSnapshot)
    : null;
  const requiredConsentRows = REQUIRED_LIVE_CONSENTS.map((purpose) => ({
    ...purpose,
    consent: authoritativeSnapshot
      ? getLiveConsent(authoritativeSnapshot, purpose.type)
      : null,
    effective: authoritativeSnapshot
      ? isLiveConsentEffective(authoritativeSnapshot, purpose.type)
      : false,
  }));
  const missingRequiredConsents = requiredConsentRows.filter(
    (purpose) => !purpose.effective,
  );
  const audioRetentionConsent = authoritativeSnapshot
    ? getLiveConsent(authoritativeSnapshot, 'audio_retention')
    : null;
  const authoritativeEncounterIsActive =
    authoritativeSnapshot?.encounter.status === 'in_progress';
  const authoritativeReviewLocked = Boolean(
    authoritativeSnapshot && !authoritativeEncounterIsActive,
  );
  const canStartAuthoritativeSpeech = Boolean(
    authoritativeLoadState === 'ready' &&
      authoritativeEncounterIsActive &&
      authoritativeConsent?.speechReady,
  );
  const canManageLiveConsents = Boolean(
    authoritativeLoadState === 'ready' && authoritativeEncounterIsActive,
  );

  return (
    <main className={`orion-shell is-${sessionState}`}>
      <section aria-label="Состояние очного приёма" className="orion-header">
        <div className="orion-header__context" aria-label="Текущий режим">
          <span className="context-dot" />
          <span>Очный приём</span>
          <span className="context-separator" />
          <strong>{statusLabel}</strong>
        </div>

        <div className="header-actions">
          <button
            className="history-trigger"
            type="button"
            onClick={() => setHistoryOpen(true)}
            aria-label={`Открыть локальные материалы приёмов: ${historyRecords.length}`}
          >
            <span aria-hidden="true">▤</span>
            <span className="history-trigger__label">Локальные файлы</span>
            <b>{historyRecords.length}</b>
          </button>
        </div>
      </section>

      <section
        className={`live-authoritative-banner is-${authoritativeLoadState}`}
        aria-live="polite"
      >
        <div>
          <strong>
            {authoritativeLoadState === 'loading'
              ? 'Загружаем точную запись из D1…'
              : authoritativeLoadState === 'ready'
                ? `D1 · ${authoritativeSnapshot?.encounter.patient.displayName ?? 'приём загружен'}`
                : 'Серверная запись не открыта'}
          </strong>
          <span>
            {authoritativeMessage ??
              (authoritativeLoadState === 'ready'
                ? `Приём ${authoritativeSnapshot?.encounter.id ?? ''} · статус: ${authoritativeSnapshot?.encounter.status ?? '—'}`
                : 'Речевой контур и решения заблокированы до точной авторизации приёма.')}
          </span>
        </div>
        <div className="live-authoritative-actions">
          {authoritativeLoadState !== 'loading' &&
            authoritativeLoadState !== 'ready' && (
              <button
                type="button"
                onClick={() =>
                  void loadAuthoritativeWorkspace(
                    authoritativeEncounterId ?? requestedEncounterId ?? undefined,
                  )
                }
              >
                Повторить
              </button>
            )}
          <a
            href={
              authoritativeEncounterId
                ? `/?encounterId=${encodeURIComponent(authoritativeEncounterId)}`
                : '/'
            }
          >
            Клиническая запись
          </a>
        </div>
      </section>

      <section
        className={`orion-workspace${visitRailCollapsed ? ' has-collapsed-rail' : ''}`}
        id="workspace"
      >
        <aside
          className={`visit-rail${visitRailCollapsed ? ' is-collapsed' : ''}`}
          aria-label="Параметры приёма"
        >
          <button
            className="rail-toggle"
            type="button"
            aria-expanded={!visitRailCollapsed}
            aria-label={
              visitRailCollapsed
                ? 'Развернуть панель приёма'
                : 'Свернуть панель приёма'
            }
            title={visitRailCollapsed ? 'Развернуть панель' : 'Свернуть панель'}
            onClick={toggleVisitRail}
          >
            <span aria-hidden="true">{visitRailCollapsed ? '›' : '‹'}</span>
            <small>{visitRailCollapsed ? 'Открыть' : 'Скрыть'}</small>
          </button>
          <div className="rail-section">
            <p className="eyebrow">Текущий приём D1</p>
            <h1>Консультация<br />в кабинете</h1>
            <p className="rail-copy">Один общий микрофон. ORION разделяет голоса и показывает подсказки только врачу.</p>
          </div>

          <div className="visit-details">
            <label className="patient-name-field" htmlFor="patient-name">
              <span>Пациент / название</span>
              <input
                id="patient-name"
                type="text"
                value={patientName}
                maxLength={100}
                autoComplete="off"
                placeholder="Например, Айдос К."
                disabled={Boolean(authoritativeSnapshot)}
                onChange={(event) => setPatientName(event.target.value)}
              />
              <small>
                {authoritativeSnapshot
                  ? `Из D1 · карта ${authoritativeSnapshot.encounter.patient.medicalRecordNumber}`
                  : 'Загружается из выбранной клинической записи'}
              </small>
            </label>
            <div className="detail-row"><span>Языки</span><strong>Русский · Қазақша</strong></div>
            <div className="detail-row"><span>Говорящие</span><strong>Врач · Пациент</strong></div>
          </div>

          <div className="privacy-note">
            <span className="privacy-icon" aria-hidden="true">◎</span>
            <div>
              <strong>
                {audioConsentConfirmed
                  ? 'Аудиозапись хранится локально'
                  : 'Аудиозапись выключена'}
              </strong>
              <p>
                {sessionState === 'listening' && speech.status === 'streaming'
                  ? audioConsentConfirmed
                    ? 'Микрофон используется для локального STT и записи в историю этого браузера. В Groq уходит только текст.'
                    : 'Реплики распознаются локально на этом ПК; аудиофайл не создаётся. В Groq уходит только текст.'
                  : sessionState === 'review'
                    ? speech.recordedAudio
                      ? `Запись готова: ${(speech.recordedAudio.size / 1_048_576).toFixed(1)} МБ. Она не отправляется в Groq.`
                      : audioConsentConfirmed
                        ? speech.recordingError ?? 'Аудиозапись не была создана.'
                        : 'Аудиофайл не создавался.'
                    : 'До запуска микрофона звук не захватывается. Запись включается отдельным согласием.'}
              </p>
            </div>
          </div>
        </aside>

        <section className="conversation-stage" aria-label="Рабочая область приёма">
          <div className="stage-topline">
            <div><span className={`live-indicator is-${sessionState}`} /><strong>{statusLabel}</strong></div>
            <time dateTime={`PT${elapsedSeconds}S`}>{formatDuration(elapsedSeconds)}</time>
          </div>

          {sessionState === 'ready' && (
            <div className="session-ready">
              <div className="listening-orbit" aria-hidden="true">
                <span className="orbit orbit-one" />
                <span className="orbit orbit-two" />
                <span className="orbit-core">O</span>
              </div>
              <p className="eyebrow">Перед началом</p>
              <h2>Спокойный разговор.<br />Точная поддержка.</h2>
              <p className="stage-description">Ассистент не вмешивается в беседу. Он фиксирует контекст и готовит варианты для решения врача.</p>

              <div
                className="live-consent-preflight"
                aria-labelledby="live-consent-title"
                id="live-consents"
              >
                <div className="live-consent-preflight__header">
                  <span>
                    <strong id="live-consent-title">Решения пациента перед записью</strong>
                    <small>
                      Врач фиксирует ответ пациента. Каждое действие создаёт новую версию в D1.
                    </small>
                  </span>
                  <div className="live-consent-language" aria-label="Язык уведомления пациенту">
                    <small>Язык</small>
                    {(['ru', 'kk'] as const).map((language) => (
                      <button
                        aria-pressed={consentNoticeLanguage === language}
                        className={consentNoticeLanguage === language ? 'is-active' : ''}
                        disabled={Boolean(pendingConsentType)}
                        key={language}
                        onClick={() => setConsentNoticeLanguage(language)}
                        type="button"
                      >
                        {language === 'ru' ? 'RU' : 'ҚАЗ'}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="live-consent-list">
                  {requiredConsentRows.map((purpose) => (
                    <div
                      className={`live-consent-row${purpose.effective ? ' is-granted' : ' is-missing'}`}
                      key={purpose.type}
                    >
                      <span className="live-consent-row__state" aria-hidden="true">
                        {purpose.effective ? '✓' : '!'}
                      </span>
                      <span className="live-consent-row__copy">
                        <strong>{purpose.title}</strong>
                        <small>{purpose.description}</small>
                        <em>{liveConsentDecisionLabel(purpose.consent)}</em>
                      </span>
                      {purpose.effective ? (
                        <span className="live-consent-row__badge">Готово</span>
                      ) : (
                        <button
                          className="live-consent-row__action"
                          disabled={!canManageLiveConsents || Boolean(pendingConsentType)}
                          onClick={() =>
                            void recordLiveConsentDecision(purpose.type, 'granted')
                          }
                          type="button"
                        >
                          {pendingConsentType === purpose.type
                            ? 'Сохраняем…'
                            : 'Зафиксировать предоставление'}
                        </button>
                      )}
                    </div>
                  ))}

                  <div
                    className={`live-consent-row is-optional${authoritativeConsent?.audioRetention ? ' is-granted' : ''}`}
                  >
                    <span className="live-consent-row__state" aria-hidden="true">
                      {authoritativeConsent?.audioRetention ? '●' : '○'}
                    </span>
                    <span className="live-consent-row__copy">
                      <strong>Сохранять локальный аудиофайл <b>необязательно</b></strong>
                      <small>Аудио останется только в локальной истории этого браузера.</small>
                      <em>{liveConsentDecisionLabel(audioRetentionConsent)}</em>
                    </span>
                    {authoritativeConsent?.audioRetention ? (
                      <button
                        className="live-consent-row__secondary"
                        disabled={!canManageLiveConsents || Boolean(pendingConsentType)}
                        onClick={() => setConfirmAudioConsentWithdrawal(true)}
                        type="button"
                      >
                        Не записывать
                      </button>
                    ) : (
                      <button
                        className="live-consent-row__action"
                        disabled={!canManageLiveConsents || Boolean(pendingConsentType)}
                        onClick={() =>
                          void recordLiveConsentDecision('audio_retention', 'granted')
                        }
                        type="button"
                      >
                        {pendingConsentType === 'audio_retention'
                          ? 'Сохраняем…'
                          : 'Включить с согласия пациента'}
                      </button>
                    )}
                  </div>
                </div>

                {confirmAudioConsentWithdrawal && (
                  <div className="live-consent-confirm" role="alertdialog" aria-modal="true">
                    <strong>Перестать сохранять аудио этого приёма?</strong>
                    <small>
                      Будет зафиксирован отзыв. Расшифровка сможет продолжаться без создания аудиофайла.
                    </small>
                    <span>
                      <button
                        disabled={Boolean(pendingConsentType)}
                        onClick={() =>
                          void recordLiveConsentDecision('audio_retention', 'withdrawn')
                        }
                        type="button"
                      >
                        Да, зафиксировать отзыв
                      </button>
                      <button
                        disabled={Boolean(pendingConsentType)}
                        onClick={() => setConfirmAudioConsentWithdrawal(false)}
                        type="button"
                      >
                        Отмена
                      </button>
                    </span>
                  </div>
                )}

                <div className="live-consent-preflight__footer">
                  <span>
                    {missingRequiredConsents.length === 0
                      ? 'Три обязательных решения действуют — можно запускать STT.'
                      : `Нужно зафиксировать ещё: ${missingRequiredConsents.length}.`}
                  </span>
                  <a
                    href={
                      authoritativeEncounterId
                        ? `/?encounterId=${encodeURIComponent(authoritativeEncounterId)}#patient-consents`
                        : '/#patient-consents'
                    }
                  >
                    Все согласия и история отзывов
                  </a>
                </div>
                {consentActionMessage && (
                  <p className="live-consent-message" role="status" aria-live="polite">
                    {consentActionMessage}
                  </p>
                )}
              </div>

              <button
                className="primary-action"
                type="button"
                disabled={!canStartAuthoritativeSpeech}
                onClick={startSession}
              >
                <span className="action-icon" aria-hidden="true" /> Начать расшифровку
              </button>
              {!canStartAuthoritativeSpeech && (
                <small className="action-hint">
                  {authoritativeLoadState === 'loading'
                    ? 'Проверяем серверную запись и согласия…'
                    : authoritativeLoadState !== 'ready'
                      ? 'Сначала откройте доступную запись пациента'
                    : !authoritativeEncounterIsActive
                      ? 'Сначала переведите приём в статус «идёт» в клинической записи'
                      : missingRequiredConsents.length > 0
                        ? `Зафиксируйте: ${missingRequiredConsents.map((item) => item.title).join(', ')}`
                        : 'Проверяем готовность локального речевого контура'}
                </small>
              )}
            </div>
          )}

          {sessionState === 'listening' && (
            <div
              className={`session-listening${transcriptTurns.length ? ' has-transcript' : ''}`}
              aria-live="polite"
            >
              <div className="sound-field" aria-hidden="true">
                {Array.from({ length: 24 }, (_, index) => <i key={index} style={{ '--bar': index } as React.CSSProperties} />)}
              </div>
              <p className="eyebrow">{speechStatusLabel}</p>

              {transcriptTurns.length === 0 ? (
                <>
                  <h2>Разговор остаётся главным</h2>
                  <p className="stage-description">
                    {speech.error
                      ? 'Микрофон не передаёт аудио. Исправьте настройку и повторите запуск.'
                      : 'Врач говорит первым для калибровки. Затем ORION размечает русский и казахский текст по голосам.'}
                  </p>
                  {speech.error && (
                    <div className="speech-error" role="alert">
                      <strong>Что нужно проверить</strong>
                      <p>{speech.error}</p>
                      <button
                        type="button"
                        onClick={() =>
                          void speech.start({ recordAudio: audioConsentConfirmed })
                        }
                      >
                        Повторить подключение
                      </button>
                    </div>
                  )}
                </>
              ) : (
                <div className="live-transcript">
                  <div className="live-transcript__heading">
                    <div>
                      <h2>Живая расшифровка</h2>
                      <p>Подтверждённый текст видит только врач</p>
                    </div>
                    <span>{finalSpeechTokens.length} подтверждённых реплик</span>
                  </div>

                  <div className="transcript-feed" aria-label="Живая расшифровка разговора">
                    {transcriptTurns.map((turn) => {
                      const role = roleForSpeaker(turn.speaker);
                      const roleLabel =
                        role === 'doctor'
                          ? 'Врач'
                          : role === 'patient'
                            ? 'Пациент'
                            : `Голос ${turn.speaker ?? '—'}`;

                      return (
                        <article
                          className={`transcript-turn role-${role}${turn.provisional ? ' is-provisional' : ''}`}
                          key={`${turn.provisional ? 'live' : 'final'}-${turn.id}`}
                        >
                          <div className="transcript-meta">
                            <strong><i />{roleLabel}</strong>
                            <span>{languageLabel(turn.language)}</span>
                            <time>{formatTranscriptTime(turn.startMs)}</time>
                          </div>
                          <p>{turn.text.trim()}</p>
                          {turn.provisional && <small>уточняется…</small>}
                        </article>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="speaker-calibration">
                <span><i className="speaker-dot doctor" /> Врач</span>
                <span><i className="speaker-dot patient" /> Пациент</span>
                <small>
                  {detectedSpeakers.length
                    ? 'Первый распознанный голос назначен врачу'
                    : 'Калибровка голосов ожидается'}
                </small>
                {detectedSpeakers.length >= 2 && authoritativeEncounterId ? (
                  <a
                    href={`/?encounterId=${encodeURIComponent(authoritativeEncounterId)}`}
                  >
                    Исправить роли в записи
                  </a>
                ) : detectedSpeakers.length >= 2 ? (
                  <button type="button" onClick={swapSpeakerRoles}>
                    Поменять роли
                  </button>
                ) : null}
              </div>
              <button
                className="stop-action"
                type="button"
                disabled={speech.status === 'requesting' || speech.status === 'connecting'}
                onClick={() => void stopSession()}
              >
                <span aria-hidden="true" /> Остановить расшифровку
              </button>
            </div>
          )}

          {sessionState === 'review' && (
            <div className="session-review">
              <span className="review-symbol" aria-hidden="true">✓</span>
              <p className="eyebrow">Расшифровка остановлена</p>
              <h2>Сначала решения.<br />Затем протокол.</h2>
              <p className="stage-description">
                {speech.status === 'stopping'
                  ? 'ORION принимает последние подтверждённые слова. Решения можно проверять после завершения расшифровки.'
                  : 'Врач проверяет факты, меняет или отклоняет рекомендации и только после этого создаёт документ.'}
              </p>
              <div className="review-evidence">
                <div>
                  <span>Расшифровка</span>
                  <strong>
                    {finalSpeechTokens.length
                      ? `${finalSpeechTokens.length} подтверждённых реплик`
                      : 'Нет подтверждённого текста'}
                  </strong>
                </div>
                <div>
                  <span>Подсказки</span>
                  <strong>
                    {currentSuggestionIds.length
                      ? `${reviewedSuggestionCount} из ${currentSuggestionIds.length} проверено`
                      : analysisStatus === 'loading'
                        ? 'Финальный анализ идёт'
                        : 'Нет проверенных подсказок'}
                  </strong>
                </div>
                <div>
                  <span>Аудиофайл</span>
                  <strong>
                    {speech.recordedAudio
                      ? `${(speech.recordedAudio.size / 1_048_576).toFixed(1)} МБ · локально`
                      : audioConsentConfirmed
                        ? speech.recordingStatus === 'recording'
                          ? 'Завершается…'
                          : 'Не создан'
                        : 'Запись выключена'}
                  </strong>
                </div>
              </div>
              <div className="review-steps" aria-label="Этапы проверки">
                <span><b>1</b> Проверить расшифровку</span>
                <span><b>2</b> Принять решения ({acceptedSuggestionCount})</span>
                <span><b>3</b> Протокол — после проверки</span>
              </div>
              {pendingSuggestionCount > 0 && (
                <p className="review-warning" role="status">
                  Осталось проверить: {pendingSuggestionCount}. Протокол всё равно включит только явно принятые пункты.
                </p>
              )}
              <div className="review-downloads" aria-label="Скачать материалы приёма">
                <button
                  className="download-all"
                  type="button"
                  disabled={!currentEncounter || archiveDownloading}
                  onClick={() => {
                    if (!currentEncounter) return;
                    setArchiveDownloading(true);
                    setHistoryError(null);
                    void downloadEncounterArchive(currentEncounter)
                      .catch((error) => {
                        setHistoryError(
                          error instanceof Error
                            ? error.message
                            : 'Не удалось собрать архив приёма.',
                        );
                      })
                      .finally(() => setArchiveDownloading(false));
                  }}
                >
                  <strong>
                    {archiveDownloading ? 'Собираем архив…' : 'Скачать всё'}
                  </strong>
                  <small>ZIP · протокол, расшифровка, аудио и аудит</small>
                </button>
                <button
                  type="button"
                  disabled={
                    !currentEncounter ||
                    (acceptedSuggestionCount === 0 &&
                      encounterTranscript.length === 0)
                  }
                  onClick={() => currentEncounter && downloadProtocol(currentEncounter)}
                >
                  <strong>Протокол</strong><small>Word · принятое + весь разговор</small>
                </button>
                <button
                  type="button"
                  disabled={!currentEncounter || encounterTranscript.length === 0}
                  onClick={() => currentEncounter && downloadTranscript(currentEncounter)}
                >
                  <strong>Расшифровка</strong><small>TXT · весь разговор</small>
                </button>
                <button
                  type="button"
                  disabled={!currentEncounter?.audio}
                  onClick={() => currentEncounter && downloadAudio(currentEncounter)}
                >
                  <strong>Аудио</strong><small>Исходная локальная запись</small>
                </button>
                <button
                  type="button"
                  disabled={!currentEncounter}
                  onClick={() => currentEncounter && downloadAudit(currentEncounter)}
                >
                  <strong>Полный аудит</strong><small>JSON · включая корзину</small>
                </button>
              </div>
              {historyError && <p className="history-error" role="alert">{historyError}</p>}
              {authoritativeReviewLocked && authoritativeEncounterId ? (
                <a
                  className="secondary-action"
                  href={`/?encounterId=${encodeURIComponent(authoritativeEncounterId)}`}
                >
                  Открыть клиническую запись
                </a>
              ) : (
                <button
                  className="secondary-action"
                  type="button"
                  onClick={() => void resetSession()}
                >
                  Продолжить расшифровку
                </button>
              )}
            </div>
          )}
        </section>

        <aside className="assistant-panel" aria-label="Подсказки ORION">
          <div className="panel-heading">
            <div><p className="eyebrow">Только для врача</p><h2>Подсказки</h2></div>
            <span className="private-pill">Приватно</span>
          </div>

          {analysis || activeSuggestionEntries.length > 0 || discardedSuggestionEntries.length > 0 ? (
            <div className="assistant-results">
              <div
                className="analysis-summary"
                role="status"
                aria-live="polite"
                aria-busy={analysisStatus === 'loading'}
              >
                <div>
                  <span className={`analysis-dot is-${analysisStatus}`} />
                  <strong>
                    {analysisStatus === 'loading'
                      ? 'Обновляем по новым словам'
                      : analysisStatus === 'waiting'
                        ? 'Ждём паузу для обновления'
                        : analysisStatus === 'error'
                          ? 'Предыдущие подсказки · проверьте актуальность'
                          : 'GPT-OSS 120B · подтверждённый текст'}
                  </strong>
                </div>
                <p>{analysis?.summary ?? 'Перепроверяем рекомендации после изменения ролей говорящих.'}</p>
              </div>

              {analysisStatus === 'error' && (
                <div className="analysis-inline-error" role="alert">
                  <div>
                    <strong>Не удалось обновить подсказки</strong>
                    <p>{analysisError ?? 'Клинический анализ временно недоступен.'}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() =>
                      void runAnalysis(
                        sessionState === 'review' ? 'final' : 'live',
                        true,
                      )
                    }
                  >
                    Повторить
                  </button>
                </div>
              )}

              <div className="suggestion-tabs" role="tablist" aria-label="Рекомендации и корзина">
                <button
                  type="button"
                  role="tab"
                  aria-selected={suggestionView === 'active'}
                  className={suggestionView === 'active' ? 'is-active' : ''}
                  onClick={() => setSuggestionView('active')}
                >
                  Рекомендации <b>{activeSuggestionEntries.length}</b>
                </button>
                <button
                  type="button"
                  role="tab"
                  aria-selected={suggestionView === 'trash'}
                  className={suggestionView === 'trash' ? 'is-active' : ''}
                  onClick={() => setSuggestionView('trash')}
                >
                  Корзина <b>{discardedSuggestionEntries.length}</b>
                </button>
              </div>

              {suggestionView === 'active' ? (
                <div className="suggestion-list" aria-live="polite">
                  {clarificationEntries.length > 0 && (
                    <section className="suggestion-group" aria-labelledby="clarification-group-title">
                      <div className="suggestion-group__heading">
                        <div><span>01</span><h3 id="clarification-group-title">Уточнить у пациента</h3></div>
                        <b>{clarificationEntries.length}</b>
                      </div>
                      {clarificationEntries.map(renderSuggestionCard)}
                    </section>
                  )}
                  {recommendationEntries.length > 0 && (
                    <section className="suggestion-group" aria-labelledby="recommendation-group-title">
                      <div className="suggestion-group__heading">
                        <div><span>02</span><h3 id="recommendation-group-title">Рекомендации врачу</h3></div>
                        <b>{recommendationEntries.length}</b>
                      </div>
                      {recommendationEntries.map(renderSuggestionCard)}
                    </section>
                  )}
                  {activeSuggestionEntries.length === 0 && (
                    <div className="suggestion-list-empty">
                      <strong>Активных рекомендаций нет</strong>
                      <p>Пункты из корзины можно вернуть в любой момент.</p>
                    </div>
                  )}
                </div>
              ) : (
                <div className="suggestion-list is-trash" aria-live="polite">
                  {discardedSuggestionEntries.length > 0 ? (
                    <section className="suggestion-group" aria-labelledby="trash-group-title">
                      <div className="suggestion-group__heading">
                        <div><span>↺</span><h3 id="trash-group-title">Сохранённые отклонения</h3></div>
                        <b>{discardedSuggestionEntries.length}</b>
                      </div>
                      {discardedSuggestionEntries.map(renderSuggestionCard)}
                    </section>
                  ) : (
                    <div className="suggestion-list-empty">
                      <strong>Корзина пуста</strong>
                      <p>Отклонённые пункты не удаляются и появятся здесь.</p>
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <>
              <div
                className={`assistant-empty is-${analysisStatus}`}
                role={analysisStatus === 'error' ? 'alert' : 'status'}
                aria-live="polite"
                aria-busy={analysisStatus === 'loading'}
              >
                <span className="assistant-glyph" aria-hidden="true">
                  {analysisStatus === 'loading' || analysisStatus === 'waiting'
                    ? '···'
                    : analysisStatus === 'error'
                      ? '!'
                      : '✦'}
                </span>
                <h3>
                  {analysisStatus === 'loading'
                    ? 'Проверяем подтверждённый текст'
                    : analysisStatus === 'waiting'
                      ? 'Ждём естественную паузу'
                      : analysisStatus === 'error'
                        ? 'Анализ временно недоступен'
                        : sessionState === 'listening' && speech.status === 'error'
                          ? 'Речевой контур не запущен'
                          : analysisStatus === 'ready'
                            ? 'Надёжных подсказок пока нет'
                            : 'Здесь будет только важное'}
                </h3>
                <p>
                  {analysisError ??
                    'GPT-OSS 120B получает только подтверждённый текст. ORION не перебивает разговор и не принимает решения за врача.'}
                </p>
                {analysisStatus === 'error' && analysisSegments.length > 0 && (
                  <button
                    className="analysis-retry"
                    type="button"
                    onClick={() => void runAnalysis(sessionState === 'review' ? 'final' : 'live', true)}
                  >
                    Повторить анализ
                  </button>
                )}
              </div>

              <div className="insight-types" aria-label="Типы подсказок">
                <div><span className="insight-icon clarification">?</span><p><strong>Что уточнить</strong><small>Недостающие сведения</small></p></div>
                <div><span className="insight-icon safety">!</span><p><strong>Безопасность</strong><small>Красные флаги и риски</small></p></div>
                <div><span className="insight-icon option">+</span><p><strong>Варианты действий</strong><small>Только для решения врача</small></p></div>
                <div><span className="insight-icon medication">Rx</span><p><strong>Лекарственные варианты</strong><small>После проверки рисков врачом</small></p></div>
              </div>
            </>
          )}

          {authoritativeEncounterId && authoritativeTranscriptSnapshot.length > 0 && (
            <label className="analysis-acknowledgement">
              <input
                type="checkbox"
                checked={transcriptAcknowledged}
                disabled={!authoritativeEncounterIsActive || analysisStatus === 'loading'}
                onChange={(event) =>
                  setAcknowledgedTranscriptKey(
                    event.target.checked ? authoritativeTranscriptKey : null,
                  )
                }
              />
              <span>
                <strong>Я сверил(а) текст, язык и роли говорящих</strong>
                <small>
                  Подтверждение относится к текущим {authoritativeTranscriptSnapshot.length}{' '}
                  финальным репликам и сбросится при появлении новой.
                </small>
              </span>
            </label>
          )}

          {authoritativeMessage && (
            <p className="authoritative-action-message" role="status">
              {authoritativeMessage}
            </p>
          )}

          {analysisSegments.length > 0 && analysisStatus !== 'loading' && (
            <button
              className="analysis-refresh"
              type="button"
              disabled={
                Boolean(authoritativeEncounterId) &&
                (!transcriptAcknowledged ||
                  !authoritativeEncounterIsActive ||
                  !authoritativeConsent?.analysisReady)
              }
              onClick={() =>
                void runAnalysis(sessionState === 'review' ? 'final' : 'live', true)
              }
            >
              {authoritativeEncounterId
                ? 'Создать серверные черновики'
                : 'Обновить по подтверждённому тексту'}
            </button>
          )}

          <div className="decision-rule">
            <span aria-hidden="true">01</span>
            <p><strong>Решение принимает врач</strong><small>Ничего не попадёт в протокол без подтверждения.</small></p>
          </div>
        </aside>
      </section>

      <footer className="orion-footer">
        <span>ORION clinical workspace</span>
        <div>
          <span><i className="footer-dot" /> Тестовый контур · без реальных данных пациентов</span>
          <span>RU + KZ</span>
          <span>Локальный STT · Groq AI</span>
        </div>
      </footer>
      {historyOpen && (
        <EncounterHistoryPanel
          records={historyRecords}
          preferredEncounterId={encounterId}
          onRename={renameEncounter}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </main>
  );
}
