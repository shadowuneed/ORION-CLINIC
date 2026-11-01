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
import type { ClinicalResearchResponse } from '../lib/clinical-research-contract';
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
};

type SessionState = 'ready' | 'listening' | 'review';
type SpeakerRole = 'doctor' | 'patient' | 'unknown';
type Theme = 'light' | 'dark';

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

const FIRST_LIVE_ANALYSIS_DELAY_MS = 1_200;
const LIVE_ANALYSIS_INTERVAL_MS = 12_000;
const MEDICATION_CHECKS: Array<{ id: MedicationCheck; label: string }> = [
  { id: 'indication', label: 'Показание и цель проверены' },
  { id: 'interactions', label: 'Текущие препараты и взаимодействия проверены' },
  { id: 'allergies', label: 'Аллергии и нежелательные реакции проверены' },
  {
    id: 'contraindications',
    label: 'Противопоказания и факторы пациента проверены',
  },
];

type WorkingClinicalSegment = ClinicalTranscriptSegment & {
  speaker: string | null;
  endMs: number | null;
  detectedLanguages: Set<'ru' | 'kk'>;
};

function readPersistedTheme(): Theme | null {
  try {
    const saved = window.localStorage.getItem('orion-theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    // Fall through to the cookie preference.
  }

  try {
    const cookieTheme = document.cookie.match(
      /(?:^|;\s*)orion-theme=(light|dark)(?:;|$)/,
    )?.[1];
    return cookieTheme === 'light' || cookieTheme === 'dark'
      ? cookieTheme
      : null;
  } catch {
    return null;
  }
}

function persistTheme(theme: Theme) {
  try {
    window.localStorage.setItem('orion-theme', theme);
  } catch {
    // The cookie below keeps the preference when storage is unavailable.
  }

  try {
    document.cookie = `orion-theme=${theme}; Path=/; Max-Age=31536000; SameSite=Lax`;
  } catch {
    // The visual switch still works when all persistence is blocked.
  }
}

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

export function OrionWorkspace({ clinicianName }: WorkspaceProps) {
  const [theme, setTheme] = useState<Theme | null>(null);
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
  const currentEncounterRef = useRef<OrionEncounterRecord | null>(null);
  const speech = useLocalSpeechTranscription();

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const resolveTheme = (): Theme =>
      document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light';
    const syncTheme = window.setTimeout(() => setTheme(resolveTheme()), 0);

    const followSystemTheme = (event: MediaQueryListEvent) => {
      if (readPersistedTheme()) return;
      const nextTheme: Theme = event.matches ? 'dark' : 'light';
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.style.colorScheme = nextTheme;
      setTheme(nextTheme);
    };

    media.addEventListener('change', followSystemTheme);
    return () => {
      window.clearTimeout(syncTheme);
      media.removeEventListener('change', followSystemTheme);
    };
  }, []);

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

  const transcriptTurns = useMemo(
    () => [
      ...groupTokens(speech.finalTokens, false),
      ...groupTokens(speech.provisionalTokens, true),
    ],
    [speech.finalTokens, speech.provisionalTokens],
  );

  const detectedSpeakers = useMemo(
    () =>
      Array.from(
        new Set(
          speech.finalTokens
            .map((token) => token.speaker)
            .filter(
              (speaker): speaker is 'doctor' | 'patient' =>
                speaker === 'doctor' || speaker === 'patient',
            ),
        ),
      ),
    [speech.finalTokens],
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
    () => segmentFinalTokens(speech.finalTokens, roleForSpeaker),
    [roleForSpeaker, speech.finalTokens],
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
    [analysisCharacterCount, analysisKey, analysisSegments],
  );

  useEffect(() => {
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
  }, [analysisCharacterCount, analysisKey, runAnalysis, sessionState]);

  useEffect(() => {
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

  const reviewSuggestion = (
    id: string,
    status: SuggestionDecisionStatus,
  ) => {
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
      const evidence = analysisSegments.filter((segment) =>
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
    [analysisSegments],
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
      groupTokens(speech.finalTokens, false).map((turn) => ({
        id: turn.id,
        role: roleForSpeaker(turn.speaker),
        language: turn.language,
        text: turn.text.trim(),
        startMs: turn.startMs,
      })),
    [roleForSpeaker, speech.finalTokens],
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
            <button
              type="button"
              onClick={() =>
                setEditingSuggestionId(isEditing ? null : suggestion.id)
              }
            >
              {isEditing ? 'Готово' : 'Изменить'}
            </button>
          )}
        </div>

        <div className="suggestion-actions">
          {entry.status === 'discarded' ? (
            <button
              className="restore"
              type="button"
              onClick={() => reviewSuggestion(suggestion.id, 'pending')}
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
                  (isMedication && !medicationIsChecked(suggestion.id))
                }
                title={
                  isMedication && !medicationIsChecked(suggestion.id)
                    ? 'Сначала подтвердите проверки безопасности'
                    : undefined
                }
                onClick={() => reviewSuggestion(suggestion.id, 'accepted')}
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
                onClick={() => reviewSuggestion(suggestion.id, 'discarded')}
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

  const toggleTheme = () => {
    const currentTheme =
      theme ??
      (document.documentElement.dataset.theme === 'dark' ? 'dark' : 'light');
    const nextTheme: Theme = currentTheme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = nextTheme;
    document.documentElement.style.colorScheme = nextTheme;
    persistTheme(nextTheme);
    setTheme(nextTheme);
  };

  return (
    <main className={`orion-shell is-${sessionState}`}>
      <header className="orion-header">
        <a className="orion-brand" href="#workspace" aria-label="ORION — клинический ассистент">
          <span className="orion-mark" aria-hidden="true"><i /><i /><i /></span>
          <span><strong>ORION</strong><small>клинический ассистент</small></span>
        </a>

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
            aria-label={`Открыть историю приёмов: ${historyRecords.length}`}
          >
            <span aria-hidden="true">▤</span>
            История <b>{historyRecords.length}</b>
          </button>
          <button
            className={`theme-toggle is-${theme ?? 'light'}`}
            type="button"
            aria-label={theme === 'dark' ? 'Включить светлую тему' : 'Включить тёмную тему'}
            title={theme === 'dark' ? 'Светлая тема' : 'Тёмная тема'}
            onClick={toggleTheme}
          >
            <span className="theme-toggle__icon" aria-hidden="true">
              {theme === 'dark' ? '☀' : '☾'}
            </span>
            <span>{theme === 'dark' ? 'Светлая' : 'Тёмная'}</span>
          </button>
          <div className="clinician-chip">
            <span className="clinician-avatar" aria-hidden="true">В</span>
            <span><small>Рабочее место</small><strong>{clinicianName}</strong></span>
          </div>
        </div>
      </header>

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
            <p className="eyebrow">Новый приём</p>
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
                onChange={(event) => setPatientName(event.target.value)}
              />
              <small>Необязательно · сохраняется только в этом браузере</small>
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

              <div className="consent-stack">
                <label className="consent-control">
                  <input type="checkbox" checked={consentConfirmed} onChange={(event) => setConsentConfirmed(event.target.checked)} />
                  <span className="consent-box" aria-hidden="true">✓</span>
                  <span><strong>Согласие на расшифровку получено</strong><small>Пациент уведомлён о локальном STT и текстовом ИИ-анализе</small></span>
                </label>
                <label className="consent-control is-optional">
                  <input type="checkbox" checked={audioConsentConfirmed} onChange={(event) => setAudioConsentConfirmed(event.target.checked)} />
                  <span className="consent-box" aria-hidden="true">✓</span>
                  <span><strong>Записывать аудио этого приёма</strong><small>Отдельное согласие: файл останется только в истории этого браузера</small></span>
                </label>
              </div>

              <button className="primary-action" type="button" disabled={!consentConfirmed} onClick={startSession}>
                <span className="action-icon" aria-hidden="true" /> Начать приём
              </button>
              {!consentConfirmed && <small className="action-hint">Сначала подтвердите согласие пациента</small>}
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
                    <span>{speech.finalTokens.length} подтверждённых реплик</span>
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
                {detectedSpeakers.length >= 2 && (
                  <button type="button" onClick={swapSpeakerRoles}>
                    Поменять роли
                  </button>
                )}
              </div>
              <button
                className="stop-action"
                type="button"
                disabled={speech.status === 'requesting' || speech.status === 'connecting'}
                onClick={() => void stopSession()}
              >
                <span aria-hidden="true" /> Завершить приём
              </button>
            </div>
          )}

          {sessionState === 'review' && (
            <div className="session-review">
              <span className="review-symbol" aria-hidden="true">✓</span>
              <p className="eyebrow">Приём завершён</p>
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
                    {speech.finalTokens.length
                      ? `${speech.finalTokens.length} подтверждённых реплик`
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
              <button className="secondary-action" type="button" onClick={() => void resetSession()}>Новый приём</button>
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

          {analysisSegments.length > 0 && analysisStatus !== 'loading' && (
            <button
              className="analysis-refresh"
              type="button"
              onClick={() =>
                void runAnalysis(sessionState === 'review' ? 'final' : 'live', true)
              }
            >
              Обновить по подтверждённому тексту
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

