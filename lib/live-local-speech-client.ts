'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type LocalSpeechToken = {
  sourceId?: string;
  version?: number;
  text: string;
  startMs: number | null;
  endMs: number | null;
  confidence: number | null;
  isFinal: boolean;
  speaker: string | null;
  language: 'ru' | 'kk' | 'mixed' | 'unknown';
};

export type TranscriptionStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'streaming'
  | 'stopping'
  | 'finished'
  | 'error';

export type SpeechActivity =
  | 'idle'
  | 'listening'
  | 'speaking'
  | 'recognizing';

export type RecordingStatus =
  | 'idle'
  | 'recording'
  | 'ready'
  | 'unavailable'
  | 'error';

export type LocalSpeechStartOptions = {
  recordAudio?: boolean;
};

export type LocalSpeechEngine = {
  stt: string;
  speaker: string;
  device: string;
  modelStatus: string;
};

type SessionResponse = {
  sessionId?: string;
  engine?: unknown;
  session?: {
    id?: unknown;
    provider?: unknown;
    model?: unknown;
    modelVersion?: unknown;
  };
};

type PersistedSegmentResponse = {
  segment?: {
    id?: unknown;
    version?: unknown;
    role?: unknown;
    language?: unknown;
    text?: unknown;
    startedAtMs?: unknown;
    endedAtMs?: unknown;
  };
};

type LocalSpeechTranscriptionOptions = {
  encounterId?: string | null;
  onPersistedSegment?: (persistedSegment: LocalSpeechToken) => void;
};

type WireToken = {
  text?: unknown;
  start?: unknown;
  end?: unknown;
  confidence?: unknown;
};

type TranscriptionResponse = {
  text?: unknown;
  tokens?: unknown;
  language?: unknown;
  speaker?: unknown;
  durationMs?: unknown;
};

type SpeakerResponse = {
  id?: unknown;
  confidence?: unknown;
};

type BufferedFrame = {
  samples: Float32Array;
  startSample: number;
};

type PendingUtterance = {
  samples: Float32Array;
  startSample: number;
  index: number;
};

type CaptureState = {
  accepting: boolean;
  sampleCursor: number;
  preRoll: BufferedFrame[];
  preRollSamples: number;
  voicedLeadSamples: number;
  utteranceChunks: Float32Array[];
  utteranceStartSample: number | null;
  utteranceSamples: number;
  utteranceVoicedSamples: number;
  silenceSamples: number;
  utteranceIndex: number;
  noiseFloorRms: number;
  calibrationSamples: number;
};

type WorkletMessage =
  | { type: 'pcm'; samples: Float32Array | ArrayBuffer; sampleRate: number }
  | { type: 'flushed' };

const TARGET_SAMPLE_RATE = 16_000;
const NOISE_CALIBRATION_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.35);
const NOISE_CALIBRATION_WAIT_MS = 400;
const END_SILENCE_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.24);
const SHORT_PAUSE_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.18);
const TRAILING_SILENCE_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.12);
const PRE_ROLL_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.32);
const SPEECH_TRIGGER_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.14);
const MIN_SPEECH_SAMPLES = Math.round(TARGET_SAMPLE_RATE * 0.12);
const SOFT_MAX_UTTERANCE_SAMPLES = TARGET_SAMPLE_RATE * 6;
const HARD_MAX_UTTERANCE_SAMPLES = TARGET_SAMPLE_RATE * 10;
const MIN_START_RMS_THRESHOLD = 0.0045;
const MAX_START_RMS_THRESHOLD = 0.03;
const MIN_CONTINUE_RMS_THRESHOLD = 0.003;
const MAX_CONTINUE_RMS_THRESHOLD = 0.02;
const LOCAL_TRANSCRIBE_TIMEOUT_MS = 30_000;
const MEDIA_RECORDER_STOP_TIMEOUT_MS = 3_000;
const MEDIA_RECORDER_TIMESLICE_MS = 1_000;
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const RECORDING_MIME_PREFERENCES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
] as const;

function preferredRecordingMimeType() {
  if (typeof MediaRecorder === 'undefined') return null;
  if (typeof MediaRecorder.isTypeSupported !== 'function') return '';

  for (const mimeType of RECORDING_MIME_PREFERENCES) {
    try {
      if (MediaRecorder.isTypeSupported(mimeType)) return mimeType;
    } catch {
      // Fall through to the next format or the browser default.
    }
  }

  return '';
}

function createCaptureState(): CaptureState {
  return {
    accepting: false,
    sampleCursor: 0,
    preRoll: [],
    preRollSamples: 0,
    voicedLeadSamples: 0,
    utteranceChunks: [],
    utteranceStartSample: null,
    utteranceSamples: 0,
    utteranceVoicedSamples: 0,
    silenceSamples: 0,
    utteranceIndex: 0,
    noiseFloorRms: 0.0025,
    calibrationSamples: 0,
  };
}

function readableError(error: unknown) {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError') {
      return 'Доступ к микрофону не предоставлен.';
    }
    if (error.name === 'NotFoundError') {
      return 'Микрофон не найден.';
    }
    if (error.name === 'NotReadableError') {
      return 'Микрофон занят другим приложением.';
    }
    if (error.name === 'TimeoutError') {
      return 'Локальное распознавание не ответило за 30 секунд.';
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return 'Не удалось запустить локальное распознавание.';
}

function readableRecordingError(error: unknown) {
  if (error instanceof Error && error.message) return error.message;
  return 'Не удалось записать аудио. Расшифровка продолжает работать.';
}

async function responseError(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => null)) as
    | { error?: unknown }
    | null;
  if (typeof payload?.error === 'string') return payload.error;
  if (
    payload?.error &&
    typeof payload.error === 'object' &&
    'message' in payload.error &&
    typeof payload.error.message === 'string'
  ) {
    return payload.error.message;
  }
  return fallback;
}

function normalizeEngine(value: unknown): LocalSpeechEngine | null {
  if (!value || typeof value !== 'object') return null;
  const engine = value as Record<string, unknown>;
  if (
    typeof engine.stt !== 'string' ||
    typeof engine.speaker !== 'string' ||
    typeof engine.device !== 'string' ||
    typeof engine.modelStatus !== 'string'
  ) {
    return null;
  }
  return {
    stt: engine.stt,
    speaker: engine.speaker,
    device: engine.device,
    modelStatus: engine.modelStatus,
  };
}

function resampleTo16Khz(input: Float32Array, sourceRate: number) {
  if (sourceRate === TARGET_SAMPLE_RATE) return input.slice();
  if (!Number.isFinite(sourceRate) || sourceRate < TARGET_SAMPLE_RATE) {
    return input.slice();
  }

  const ratio = sourceRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.max(1, Math.round(input.length / ratio));
  const output = new Float32Array(outputLength);

  for (let outputIndex = 0; outputIndex < outputLength; outputIndex += 1) {
    const sourceStart = Math.floor(outputIndex * ratio);
    const sourceEnd = Math.min(
      input.length,
      Math.max(sourceStart + 1, Math.floor((outputIndex + 1) * ratio)),
    );
    let sum = 0;
    for (let sourceIndex = sourceStart; sourceIndex < sourceEnd; sourceIndex += 1) {
      sum += input[sourceIndex];
    }
    output[outputIndex] = sum / (sourceEnd - sourceStart);
  }

  return output;
}

function rootMeanSquare(samples: Float32Array) {
  let squaredSum = 0;
  for (const sample of samples) squaredSum += sample * sample;
  return Math.sqrt(squaredSum / Math.max(1, samples.length));
}

function joinSamples(chunks: Float32Array[], totalSamples: number) {
  const joined = new Float32Array(totalSamples);
  let offset = 0;
  for (const chunk of chunks) {
    joined.set(chunk, offset);
    offset += chunk.length;
  }
  return joined;
}

function encodeWav(samples: Float32Array) {
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);

  const writeText = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };

  writeText(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, 'WAVE');
  writeText(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  let outputOffset = 44;
  for (const sample of samples) {
    const clamped = Math.max(-1, Math.min(1, sample));
    view.setInt16(
      outputOffset,
      clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff,
      true,
    );
    outputOffset += 2;
  }

  return buffer;
}

function normalizeLanguage(value: unknown, text: string): LocalSpeechToken['language'] {
  if (value === 'ru' || value === 'kk' || value === 'mixed') return value;
  const hasKazakhSpecific = /[әғқңөұүһі]/iu.test(text);
  const hasRussianSpecific = /[ёцщъыьэ]/iu.test(text);
  if (hasKazakhSpecific && hasRussianSpecific) return 'mixed';
  if (hasKazakhSpecific) return 'kk';
  if (/[а-яё]/iu.test(text)) return 'ru';
  return 'unknown';
}

function relativeMilliseconds(value: unknown, durationMs: number | null) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }
  if (durationMs !== null && value <= durationMs / 1_000 + 2) {
    return Math.round(value * 1_000);
  }
  return Math.round(value);
}

function normalizeTranscription(
  payload: TranscriptionResponse,
  utteranceStartMs: number,
): LocalSpeechToken | null {
  const text = typeof payload.text === 'string' ? payload.text.trim() : '';
  if (!text) return null;

  const durationMs =
    typeof payload.durationMs === 'number' &&
    Number.isFinite(payload.durationMs) &&
    payload.durationMs >= 0
      ? payload.durationMs
      : null;
  const wireTokens = Array.isArray(payload.tokens)
    ? (payload.tokens.filter(
        (token): token is WireToken => Boolean(token && typeof token === 'object'),
      ) as WireToken[])
    : [];
  const firstToken = wireTokens.at(0);
  const lastToken = wireTokens.at(-1);
  const relativeStart = relativeMilliseconds(firstToken?.start, durationMs) ?? 0;
  const relativeEnd =
    relativeMilliseconds(lastToken?.end, durationMs) ?? durationMs;
  const speaker =
    payload.speaker && typeof payload.speaker === 'object'
      ? (payload.speaker as SpeakerResponse)
      : null;
  const confidences = wireTokens
    .map((token) => token.confidence)
    .filter(
      (confidence): confidence is number =>
        typeof confidence === 'number' &&
        Number.isFinite(confidence) &&
        confidence >= 0 &&
        confidence <= 1,
    );
  const speakerConfidence =
    typeof speaker?.confidence === 'number' &&
    Number.isFinite(speaker.confidence) &&
    speaker.confidence >= 0 &&
    speaker.confidence <= 1
      ? speaker.confidence
      : null;

  return {
    text,
    startMs: utteranceStartMs + relativeStart,
    endMs:
      relativeEnd === null ? null : utteranceStartMs + Math.max(relativeStart, relativeEnd),
    confidence:
      confidences.length > 0
        ? confidences.reduce((sum, value) => sum + value, 0) / confidences.length
        : speakerConfidence,
    isFinal: true,
    speaker: typeof speaker?.id === 'string' ? speaker.id : null,
    language: normalizeLanguage(payload.language, text),
  };
}

function normalizePersistedSegment(
  payload: PersistedSegmentResponse,
): LocalSpeechToken | null {
  const segment = payload.segment;
  if (!segment || typeof segment !== 'object') return null;
  const text = typeof segment.text === 'string' ? segment.text.trim() : '';
  const sourceId = typeof segment.id === 'string' ? segment.id : '';
  const version =
    typeof segment.version === 'number' && Number.isInteger(segment.version)
      ? segment.version
      : null;
  if (!sourceId || !version || !text) return null;
  const role =
    segment.role === 'doctor' || segment.role === 'patient'
      ? segment.role
      : null;
  const startedAtMs =
    typeof segment.startedAtMs === 'number' &&
    Number.isFinite(segment.startedAtMs)
      ? segment.startedAtMs
      : null;
  const endedAtMs =
    typeof segment.endedAtMs === 'number' && Number.isFinite(segment.endedAtMs)
      ? segment.endedAtMs
      : null;

  return {
    sourceId,
    version,
    text,
    startMs: startedAtMs,
    endMs: endedAtMs,
    confidence: null,
    isFinal: true,
    speaker: role,
    language: normalizeLanguage(segment.language, text),
  };
}

export function useLocalSpeechTranscription(
  options: LocalSpeechTranscriptionOptions = {},
) {
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [activity, setActivity] = useState<SpeechActivity>('idle');
  const [finalTokens, setFinalTokens] = useState<LocalSpeechToken[]>([]);
  const [provisionalTokens, setProvisionalTokens] = useState<LocalSpeechToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [engine, setEngine] = useState<LocalSpeechEngine | null>(null);
  const [recordedAudio, setRecordedAudio] = useState<Blob | null>(null);
  const [recordingStatus, setRecordingStatus] =
    useState<RecordingStatus>('idle');
  const [recordingError, setRecordingError] = useState<string | null>(null);

  const statusRef = useRef<TranscriptionStatus>('idle');
  const runRef = useRef(0);
  const sessionIdRef = useRef<string | null>(null);
  const captureRef = useRef<CaptureState>(createCaptureState());
  const uploadChainRef = useRef<Promise<void>>(Promise.resolve());
  const pendingUploadsRef = useRef(0);
  const uploadFailedRef = useRef(false);
  const requestAbortRef = useRef<AbortController | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const silentGainRef = useRef<GainNode | null>(null);
  const flushResolverRef = useRef<(() => void) | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const recordingChunksRef = useRef<Blob[]>([]);
  const recordingMimeTypeRef = useRef('');
  const recordedAudioRef = useRef<Blob | null>(null);
  const recordingErrorRef = useRef<string | null>(null);
  const recordingEpochRef = useRef(0);
  const recordingStopPromiseRef = useRef<Promise<Blob | null> | null>(null);
  const stopOperationRef = useRef<Promise<Blob | null> | null>(null);
  const encounterIdRef = useRef(options.encounterId ?? null);
  const onPersistedSegmentRef = useRef(options.onPersistedSegment);

  useEffect(() => {
    encounterIdRef.current = options.encounterId ?? null;
    onPersistedSegmentRef.current = options.onPersistedSegment;
  });

  const updateStatus = useCallback((nextStatus: TranscriptionStatus) => {
    statusRef.current = nextStatus;
    setStatus(nextStatus);
  }, []);

  const updateActivity = useCallback((nextActivity: SpeechActivity) => {
    setActivity((current) =>
      current === nextActivity ? current : nextActivity,
    );
  }, []);

  const syncActivity = useCallback(() => {
    if (statusRef.current !== 'streaming') return;
    if (captureRef.current.utteranceStartSample !== null) {
      updateActivity('speaking');
    } else if (pendingUploadsRef.current > 0) {
      updateActivity('recognizing');
    } else {
      updateActivity('listening');
    }
  }, [updateActivity]);

  const discardRecording = useCallback((updateReactState = true) => {
    recordingEpochRef.current += 1;
    const recorder = mediaRecorderRef.current;
    mediaRecorderRef.current = null;
    recordingStopPromiseRef.current = null;
    recordingChunksRef.current = [];
    recordingMimeTypeRef.current = '';
    recordedAudioRef.current = null;
    recordingErrorRef.current = null;

    if (recorder) {
      recorder.ondataavailable = null;
      recorder.onerror = null;
      if (recorder.state !== 'inactive') {
        try {
          recorder.stop();
        } catch {
          // Stopping tracks below also releases a recorder that already failed.
        }
      }
    }

    if (updateReactState) {
      setRecordedAudio(null);
      setRecordingError(null);
      setRecordingStatus('idle');
    }
  }, []);

  const startRecording = useCallback(
    (stream: MediaStream, enabled: boolean) => {
      if (!enabled) return;

      const preferredMimeType = preferredRecordingMimeType();
      if (preferredMimeType === null) {
        const message = 'Этот браузер не поддерживает запись аудио.';
        recordingErrorRef.current = message;
        setRecordingError(message);
        setRecordingStatus('unavailable');
        return;
      }

      const epoch = recordingEpochRef.current + 1;
      recordingEpochRef.current = epoch;
      recordingChunksRef.current = [];
      recordingMimeTypeRef.current = preferredMimeType;
      recordedAudioRef.current = null;
      recordingErrorRef.current = null;
      setRecordedAudio(null);
      setRecordingError(null);

      try {
        const recorder = preferredMimeType
          ? new MediaRecorder(stream, { mimeType: preferredMimeType })
          : new MediaRecorder(stream);
        mediaRecorderRef.current = recorder;
        recordingMimeTypeRef.current = recorder.mimeType || preferredMimeType;

        recorder.ondataavailable = (event: BlobEvent) => {
          if (
            epoch !== recordingEpochRef.current ||
            mediaRecorderRef.current !== recorder ||
            event.data.size === 0
          ) {
            return;
          }
          recordingChunksRef.current.push(event.data);
        };
        recorder.onerror = (event: Event) => {
          if (
            epoch !== recordingEpochRef.current ||
            mediaRecorderRef.current !== recorder
          ) {
            return;
          }
          const recorderEvent = event as Event & { error?: unknown };
          const message = readableRecordingError(recorderEvent.error);
          recordingErrorRef.current = message;
          setRecordingError(message);
          setRecordingStatus('error');
        };

        recorder.start(MEDIA_RECORDER_TIMESLICE_MS);
        setRecordingStatus('recording');
      } catch (caught) {
        mediaRecorderRef.current = null;
        recordingChunksRef.current = [];
        recordingMimeTypeRef.current = '';
        const message = readableRecordingError(caught);
        recordingErrorRef.current = message;
        setRecordingError(message);
        setRecordingStatus('error');
      }
    },
    [],
  );

  const stopRecording = useCallback((): Promise<Blob | null> => {
    const pendingStop = recordingStopPromiseRef.current;
    if (pendingStop) return pendingStop;

    const recorder = mediaRecorderRef.current;
    if (!recorder) return Promise.resolve(recordedAudioRef.current);

    const epoch = recordingEpochRef.current;
    const stopPromise = new Promise<Blob | null>((resolve) => {
      let settled = false;
      let timeoutId: number | null = null;

      const finish = (timedOut: boolean) => {
        if (settled) return;
        settled = true;
        recorder.removeEventListener('stop', handleStop);
        if (timeoutId !== null) window.clearTimeout(timeoutId);

        if (
          epoch !== recordingEpochRef.current ||
          mediaRecorderRef.current !== recorder
        ) {
          resolve(null);
          return;
        }

        mediaRecorderRef.current = null;
        recorder.ondataavailable = null;
        recorder.onerror = null;

        if (timedOut) {
          const message = 'Браузер не завершил аудиофайл вовремя.';
          recordingErrorRef.current = message;
          recordedAudioRef.current = null;
          setRecordedAudio(null);
          setRecordingError(message);
          setRecordingStatus('error');
          resolve(null);
          return;
        }

        if (recordingErrorRef.current) {
          recordedAudioRef.current = null;
          setRecordedAudio(null);
          setRecordingStatus('error');
          resolve(null);
          return;
        }

        const chunks = recordingChunksRef.current;
        const mimeType =
          recorder.mimeType || recordingMimeTypeRef.current || chunks[0]?.type;
        const blob = chunks.length > 0
          ? new Blob(chunks, mimeType ? { type: mimeType } : undefined)
          : null;
        recordingChunksRef.current = [];
        recordedAudioRef.current = blob;
        setRecordedAudio(blob);
        if (blob) {
          setRecordingStatus('ready');
        } else {
          const message = 'Браузер завершил запись без аудиоданных.';
          recordingErrorRef.current = message;
          setRecordingError(message);
          setRecordingStatus('error');
        }
        resolve(blob);
      };

      const handleStop = () => finish(false);
      recorder.addEventListener('stop', handleStop, { once: true });
      timeoutId = window.setTimeout(
        () => finish(true),
        MEDIA_RECORDER_STOP_TIMEOUT_MS,
      );

      if (recorder.state === 'inactive') {
        window.queueMicrotask(handleStop);
        return;
      }
      try {
        recorder.stop();
      } catch {
        finish(true);
      }
    });

    recordingStopPromiseRef.current = stopPromise;
    void stopPromise.finally(() => {
      if (recordingStopPromiseRef.current === stopPromise) {
        recordingStopPromiseRef.current = null;
      }
    });
    return stopPromise;
  }, []);

  const tearDownAudio = useCallback(() => {
    captureRef.current.accepting = false;
    flushResolverRef.current?.();
    flushResolverRef.current = null;

    const worklet = workletNodeRef.current;
    if (worklet) worklet.port.onmessage = null;
    worklet?.disconnect();
    sourceNodeRef.current?.disconnect();
    silentGainRef.current?.disconnect();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close().catch(() => undefined);

    workletNodeRef.current = null;
    sourceNodeRef.current = null;
    silentGainRef.current = null;
    streamRef.current = null;
    audioContextRef.current = null;
  }, []);

  const releaseSession = useCallback(async (
    sessionId: string,
    completion: 'completed' | 'cancelled' = 'completed',
  ) => {
    const encounterId = encounterIdRef.current;
    try {
      await fetch(
        encounterId
          ? '/api/workspace/transcript/speech/session'
          : '/api/local-speech/session',
        {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          encounterId
            ? { encounterId, sessionId, status: completion }
            : { sessionId },
        ),
        keepalive: true,
        },
      );
    } catch {
      // The local service also expires abandoned in-memory sessions.
    }
  }, []);

  const takeUtterance = useCallback((): PendingUtterance | null => {
    const capture = captureRef.current;
    if (
      capture.utteranceStartSample === null ||
      capture.utteranceSamples === 0
    ) {
      return null;
    }

    let utterance: PendingUtterance | null = null;
    if (capture.utteranceVoicedSamples >= MIN_SPEECH_SAMPLES) {
      const joined = joinSamples(
        capture.utteranceChunks,
        capture.utteranceSamples,
      );
      const removableSilence = Math.max(
        0,
        capture.silenceSamples - TRAILING_SILENCE_SAMPLES,
      );
      const keptSamples = Math.max(1, joined.length - removableSilence);
      utterance = {
        samples:
          keptSamples === joined.length ? joined : joined.slice(0, keptSamples),
        startSample: capture.utteranceStartSample,
        index: capture.utteranceIndex,
      };
    }

    if (utterance) capture.utteranceIndex += 1;
    capture.utteranceChunks = [];
    capture.utteranceStartSample = null;
    capture.utteranceSamples = 0;
    capture.utteranceVoicedSamples = 0;
    capture.silenceSamples = 0;
    capture.voicedLeadSamples = 0;
    capture.preRoll = [];
    capture.preRollSamples = 0;
    return utterance;
  }, []);

  const enqueueUtterance = useCallback(
    (utterance: PendingUtterance) => {
      const sessionId = sessionIdRef.current;
      const run = runRef.current;
      if (!sessionId || uploadFailedRef.current) return;

      pendingUploadsRef.current += 1;
      updateActivity('recognizing');
      const task = uploadChainRef.current.then(async () => {
        try {
          if (run !== runRef.current) return;
          const timeoutSignal = AbortSignal.timeout(
            LOCAL_TRANSCRIBE_TIMEOUT_MS,
          );
          const sessionSignal = requestAbortRef.current?.signal;
          const encounterId = encounterIdRef.current;
          const response = await fetch(encounterId
            ? '/api/workspace/transcript/speech/transcribe'
            : '/api/local-speech/transcribe', {
            method: 'POST',
            headers: {
              'Content-Type': 'audio/wav',
              ...(encounterId
                ? {
                    'X-Orion-Encounter-Id': encounterId,
                    'X-Orion-Speech-Session-Id': sessionId,
                  }
                : { 'X-Orion-Session-Id': sessionId }),
              'X-Orion-Utterance-Index': String(utterance.index),
            },
            body: encodeWav(utterance.samples),
            signal: sessionSignal
              ? AbortSignal.any([sessionSignal, timeoutSignal])
              : timeoutSignal,
          });
          if (!response.ok) {
            throw new Error(
              await responseError(
                response,
                'Локальное распознавание не обработало фрагмент.',
              ),
            );
          }

          const payload = (await response.json().catch(() => null)) as
            | TranscriptionResponse
            | PersistedSegmentResponse
            | null;
          if (!payload || run !== runRef.current) return;
          const speechToken = encounterId
            ? normalizePersistedSegment(payload as PersistedSegmentResponse)
            : normalizeTranscription(
                payload as TranscriptionResponse,
                Math.round(
                  (utterance.startSample / TARGET_SAMPLE_RATE) * 1_000,
                ),
              );
          if (!speechToken) return;

          setFinalTokens((current) => {
            const previous = current.at(-1);
            const needsSpace =
              previous &&
              !/\s$/u.test(previous.text) &&
              !/^[,.;:!?…\])}]/u.test(speechToken.text);
            return [
              ...current,
              needsSpace
                ? { ...speechToken, text: ` ${speechToken.text}` }
                : speechToken,
            ];
          });
          if (encounterId) onPersistedSegmentRef.current?.(speechToken);
          setProvisionalTokens([]);
        } finally {
          if (run === runRef.current) {
            pendingUploadsRef.current = Math.max(
              0,
              pendingUploadsRef.current - 1,
            );
            syncActivity();
          }
        }
      });

      uploadChainRef.current = task;
      void task.catch(async (caught) => {
        if (run !== runRef.current) return;
        uploadFailedRef.current = true;
        setError(readableError(caught));
        updateActivity('idle');
        updateStatus('error');
        await stopRecording();
        if (run !== runRef.current) return;
        tearDownAudio();
      });
    },
    [
      stopRecording,
      syncActivity,
      tearDownAudio,
      updateActivity,
      updateStatus,
    ],
  );

  const processPcm = useCallback(
    (input: Float32Array, sourceRate: number) => {
      const capture = captureRef.current;
      if (!capture.accepting || input.length === 0) return;

      const samples = resampleTo16Khz(input, sourceRate);
      const startSample = capture.sampleCursor;
      capture.sampleCursor += samples.length;
      const rms = rootMeanSquare(samples);
      const waitingForSpeech = capture.utteranceStartSample === null;

      if (waitingForSpeech) {
        capture.preRoll.push({ samples, startSample });
        capture.preRollSamples += samples.length;
        while (
          capture.preRoll.length > 1 &&
          capture.preRollSamples > PRE_ROLL_SAMPLES
        ) {
          const removed = capture.preRoll.shift();
          if (removed) capture.preRollSamples -= removed.samples.length;
        }

        if (capture.calibrationSamples < NOISE_CALIBRATION_SAMPLES) {
          capture.calibrationSamples += samples.length;
          capture.noiseFloorRms =
            capture.noiseFloorRms * 0.85 + Math.min(rms, 0.04) * 0.15;
          capture.voicedLeadSamples = 0;
          return;
        }

        const startThreshold = Math.min(
          MAX_START_RMS_THRESHOLD,
          Math.max(MIN_START_RMS_THRESHOLD, capture.noiseFloorRms * 1.8),
        );
        const voiced = rms >= startThreshold;
        if (!voiced) {
          capture.noiseFloorRms =
            capture.noiseFloorRms * 0.97 + Math.min(rms, 0.04) * 0.03;
        }

        capture.voicedLeadSamples = voiced
          ? capture.voicedLeadSamples + samples.length
          : 0;
        if (capture.voicedLeadSamples < SPEECH_TRIGGER_SAMPLES) return;

        capture.utteranceStartSample = capture.preRoll[0]?.startSample ?? startSample;
        capture.utteranceChunks = capture.preRoll.map((frame) => frame.samples);
        capture.utteranceSamples = capture.preRollSamples;
        capture.utteranceVoicedSamples = capture.voicedLeadSamples;
        capture.preRoll = [];
        capture.preRollSamples = 0;
        capture.silenceSamples = 0;
        updateActivity('speaking');
        return;
      }

      const continueThreshold = Math.min(
        MAX_CONTINUE_RMS_THRESHOLD,
        Math.max(
          MIN_CONTINUE_RMS_THRESHOLD,
          capture.noiseFloorRms * 1.35,
        ),
      );
      const voiced = rms >= continueThreshold;
      capture.utteranceChunks.push(samples);
      capture.utteranceSamples += samples.length;
      if (voiced) {
        capture.utteranceVoicedSamples += samples.length;
        capture.silenceSamples = 0;
      } else {
        capture.silenceSamples += samples.length;
      }

      const reachedNaturalPause =
        capture.silenceSamples >= END_SILENCE_SAMPLES;
      const reachedSoftLimitAtPause =
        capture.utteranceSamples >= SOFT_MAX_UTTERANCE_SAMPLES &&
        capture.silenceSamples >= SHORT_PAUSE_SAMPLES;
      const reachedHardLimit =
        capture.utteranceSamples >= HARD_MAX_UTTERANCE_SAMPLES;
      if (reachedNaturalPause || reachedSoftLimitAtPause || reachedHardLimit) {
        const utterance = takeUtterance();
        if (utterance) enqueueUtterance(utterance);
        else syncActivity();
      }
    },
    [enqueueUtterance, syncActivity, takeUtterance, updateActivity],
  );

  const flushWorklet = useCallback(async () => {
    const worklet = workletNodeRef.current;
    if (!worklet) return;

    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(() => {
        if (flushResolverRef.current) flushResolverRef.current = null;
        resolve();
      }, 500);
      flushResolverRef.current = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      worklet.port.postMessage({ type: 'flush' });
    });
  }, []);

  const start = useCallback(async (options: LocalSpeechStartOptions = {}) => {
    if (!['idle', 'finished', 'error'].includes(statusRef.current)) return;

    const previousSession = sessionIdRef.current;
    if (previousSession) void releaseSession(previousSession, 'cancelled');
    sessionIdRef.current = null;
    stopOperationRef.current = null;
    discardRecording();
    tearDownAudio();
    requestAbortRef.current?.abort();
    const controller = new AbortController();
    requestAbortRef.current = controller;
    const run = runRef.current + 1;
    runRef.current = run;
    captureRef.current = createCaptureState();
    uploadChainRef.current = Promise.resolve();
    pendingUploadsRef.current = 0;
    uploadFailedRef.current = false;
    setFinalTokens([]);
    setProvisionalTokens([]);
    setError(null);
    setEngine(null);
    updateActivity('idle');
    updateStatus('requesting');

    try {
      const encounterId = encounterIdRef.current;
      const healthResponse = await fetch(
        encounterId
          ? `/api/workspace/transcript/speech/health?encounterId=${encodeURIComponent(encounterId)}`
          : '/api/local-speech/health', {
        signal: controller.signal,
        cache: 'no-store',
        },
      );
      if (!healthResponse.ok) {
        throw new Error(
          await responseError(
            healthResponse,
            'Локальный речевой сервис не запущен.',
          ),
        );
      }
      if (run !== runRef.current) return;

      updateStatus('connecting');
      const sessionResponse = await fetch(encounterId
        ? '/api/workspace/transcript/speech/session'
        : '/api/local-speech/session', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(
          encounterId
            ? { encounterId, doctorFirst: true }
            : { doctorFirst: true },
        ),
        signal: controller.signal,
      });
      if (!sessionResponse.ok) {
        throw new Error(
          await responseError(
            sessionResponse,
            'Не удалось создать локальную речевую сессию.',
          ),
        );
      }
      const session = (await sessionResponse.json()) as SessionResponse;
      const sessionId = encounterId
        ? typeof session.session?.id === 'string'
          ? session.session.id
          : ''
        : session.sessionId ?? '';
      if (!sessionId || !SESSION_ID_PATTERN.test(sessionId)) {
        throw new Error('Локальный речевой сервис вернул некорректную сессию.');
      }
      if (run !== runRef.current) {
        void releaseSession(sessionId, 'cancelled');
        return;
      }
      sessionIdRef.current = sessionId;
      setEngine(
        normalizeEngine(session.engine) ??
          (encounterId && session.session
            ? {
                stt:
                  typeof session.session.model === 'string'
                    ? session.session.model
                    : 'local-stt',
                speaker: 'CAMPPlus',
                device: 'localhost',
                modelStatus: 'ready',
              }
            : null),
      );

      if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error('Этот браузер не поддерживает захват звука.');
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (run !== runRef.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      startRecording(stream, options.recordAudio === true);

      const context = new AudioContext({ latencyHint: 'interactive' });
      audioContextRef.current = context;
      if (!context.audioWorklet) {
        throw new Error('Браузер не поддерживает локальную обработку аудио.');
      }
      await context.audioWorklet.addModule('/orion-live-pcm-processor.js');
      if (run !== runRef.current) return;

      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'orion-pcm-processor', {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
      });
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      sourceNodeRef.current = source;
      workletNodeRef.current = worklet;
      silentGainRef.current = silentGain;

      worklet.port.onmessage = (event: MessageEvent<WorkletMessage>) => {
        if (event.data?.type === 'flushed') {
          flushResolverRef.current?.();
          flushResolverRef.current = null;
          return;
        }
        if (event.data?.type !== 'pcm') return;
        const samples =
          event.data.samples instanceof Float32Array
            ? event.data.samples
            : new Float32Array(event.data.samples);
        processPcm(samples, event.data.sampleRate);
      };

      captureRef.current.accepting = true;
      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(context.destination);
      await context.resume();
      await new Promise<void>((resolve) => {
        window.setTimeout(resolve, NOISE_CALIBRATION_WAIT_MS);
      });
      if (run !== runRef.current) return;
      updateStatus('streaming');
      syncActivity();
    } catch (caught) {
      if (run !== runRef.current || controller.signal.aborted) return;
      discardRecording();
      tearDownAudio();
      const sessionId = sessionIdRef.current;
      sessionIdRef.current = null;
      if (sessionId) void releaseSession(sessionId, 'cancelled');
      setError(readableError(caught));
      updateActivity('idle');
      updateStatus('error');
    }
  }, [
    discardRecording,
    processPcm,
    releaseSession,
    syncActivity,
    startRecording,
    tearDownAudio,
    updateActivity,
    updateStatus,
  ]);

  const stop = useCallback((): Promise<Blob | null> => {
    const pendingOperation = stopOperationRef.current;
    if (pendingOperation) return pendingOperation;

    if (
      statusRef.current === 'idle' ||
      statusRef.current === 'finished'
    ) {
      return Promise.resolve(recordedAudioRef.current);
    }

    const operation = (async () => {
      if (
        statusRef.current === 'requesting' ||
        statusRef.current === 'connecting'
      ) {
        runRef.current += 1;
        const completionRun = runRef.current;
        const controller = requestAbortRef.current;
        const sessionId = sessionIdRef.current;
        controller?.abort();

        const audio = await stopRecording();
        if (completionRun !== runRef.current) return null;
        tearDownAudio();
        if (sessionIdRef.current === sessionId) sessionIdRef.current = null;
        if (sessionId) await releaseSession(sessionId, 'cancelled');
        if (completionRun !== runRef.current) return audio;
        if (requestAbortRef.current === controller) {
          requestAbortRef.current = null;
        }
        pendingUploadsRef.current = 0;
        updateActivity('idle');
        updateStatus('finished');
        return audio;
      }

      const completionRun = runRef.current;
      const sessionId = sessionIdRef.current;
      const controller = requestAbortRef.current;
      updateStatus('stopping');
      await flushWorklet();
      if (completionRun !== runRef.current) return null;
      captureRef.current.accepting = false;
      const lastUtterance = takeUtterance();
      if (lastUtterance) enqueueUtterance(lastUtterance);

      // MediaRecorder shares the microphone stream with the Worklet. Its final
      // dataavailable event must arrive before tearDownAudio stops the tracks.
      const audio = await stopRecording();
      if (completionRun !== runRef.current) return null;
      tearDownAudio();

      await uploadChainRef.current.catch(() => undefined);
      if (sessionIdRef.current === sessionId) sessionIdRef.current = null;
      if (sessionId) await releaseSession(sessionId, 'completed');
      if (completionRun !== runRef.current) return audio;
      if (requestAbortRef.current === controller) {
        requestAbortRef.current = null;
      }
      setProvisionalTokens([]);
      pendingUploadsRef.current = 0;
      updateActivity('idle');
      updateStatus(uploadFailedRef.current ? 'error' : 'finished');
      return audio;
    })();

    stopOperationRef.current = operation;
    void operation.finally(() => {
      if (stopOperationRef.current === operation) {
        stopOperationRef.current = null;
      }
    });
    return operation;
  }, [
    enqueueUtterance,
    flushWorklet,
    releaseSession,
    stopRecording,
    takeUtterance,
    tearDownAudio,
    updateActivity,
    updateStatus,
  ]);

  const reset = useCallback(() => {
    runRef.current += 1;
    stopOperationRef.current = null;
    requestAbortRef.current?.abort();
    requestAbortRef.current = null;
    const sessionId = sessionIdRef.current;
    sessionIdRef.current = null;
    if (sessionId) void releaseSession(sessionId, 'cancelled');
    discardRecording();
    tearDownAudio();
    captureRef.current = createCaptureState();
    uploadChainRef.current = Promise.resolve();
    pendingUploadsRef.current = 0;
    uploadFailedRef.current = false;
    setFinalTokens([]);
    setProvisionalTokens([]);
    setError(null);
    setEngine(null);
    updateActivity('idle');
    updateStatus('idle');
  }, [
    discardRecording,
    releaseSession,
    tearDownAudio,
    updateActivity,
    updateStatus,
  ]);

  useEffect(
    () => () => {
      runRef.current += 1;
      stopOperationRef.current = null;
      requestAbortRef.current?.abort();
      const sessionId = sessionIdRef.current;
      if (sessionId) void releaseSession(sessionId, 'cancelled');
      discardRecording(false);
      tearDownAudio();
    },
    [discardRecording, releaseSession, tearDownAudio],
  );

  return {
    status,
    activity,
    finalTokens,
    provisionalTokens,
    error,
    engine,
    recordedAudio,
    recordingStatus,
    recordingError,
    start,
    stop,
    reset,
  };
}
