'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type LocalSpeechStatus =
  | 'idle'
  | 'requesting_permission'
  | 'connecting'
  | 'listening'
  | 'stopping'
  | 'error';

export type LocalSpeechSegment = {
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

type SpeechApiError = {
  error?: { code?: string; message?: string; requestId?: string };
};

type UseLocalSpeechOptions = {
  encounterId: string | null;
  enabled: boolean;
  onSegment: (segment: LocalSpeechSegment) => void;
  onStatusMessage?: (message: string) => void;
};

type CaptureRuntime = {
  stream: MediaStream;
  context: AudioContext;
  source: MediaStreamAudioSourceNode;
  worklet: AudioWorkletNode;
  silentGain: GainNode;
  sessionId: string;
  sampleRate: number;
  flushPending: (() => void) | null;
};

const TARGET_SAMPLE_RATE = 16_000;
const NOISE_CALIBRATION_MS = 350;
const PRE_ROLL_MS = 300;
const SPEECH_TRIGGER_MS = 140;
const END_SILENCE_MS = 240;
const MIN_VOICED_MS = 160;
const MAX_UTTERANCE_MS = 8_000;

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function rms(samples: Float32Array) {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / Math.max(1, samples.length));
}

function concatFrames(frames: Float32Array[]) {
  const length = frames.reduce((total, frame) => total + frame.length, 0);
  const output = new Float32Array(length);
  let offset = 0;
  for (const frame of frames) {
    output.set(frame, offset);
    offset += frame.length;
  }
  return output;
}

function resampleTo16Khz(input: Float32Array, inputRate: number) {
  if (inputRate === TARGET_SAMPLE_RATE) return input;
  const outputLength = Math.max(
    1,
    Math.round((input.length * TARGET_SAMPLE_RATE) / inputRate),
  );
  const output = new Float32Array(outputLength);
  const ratio = inputRate / TARGET_SAMPLE_RATE;
  for (let index = 0; index < outputLength; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(input.length - 1, left + 1);
    const fraction = position - left;
    output[index] = input[left] * (1 - fraction) + input[right] * fraction;
  }
  return output;
}

function encodeWav(input: Float32Array, inputRate: number) {
  const samples = resampleTo16Khz(input, inputRate);
  const buffer = new ArrayBuffer(44 + samples.length * 2);
  const view = new DataView(buffer);
  const writeAscii = (offset: number, value: string) => {
    for (let index = 0; index < value.length; index += 1) {
      view.setUint8(offset + index, value.charCodeAt(index));
    }
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, TARGET_SAMPLE_RATE, true);
  view.setUint32(28, TARGET_SAMPLE_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeAscii(36, 'data');
  view.setUint32(40, samples.length * 2, true);
  for (let index = 0; index < samples.length; index += 1) {
    const sample = clamp(samples[index], -1, 1);
    view.setInt16(
      44 + index * 2,
      sample < 0 ? sample * 0x8000 : sample * 0x7fff,
      true,
    );
  }
  return buffer;
}

async function readApiError(response: Response, fallback: string) {
  try {
    const payload = (await response.json()) as SpeechApiError;
    return payload.error?.message ?? fallback;
  } catch {
    return fallback;
  }
}

export function useLocalSpeechCapture(options: UseLocalSpeechOptions) {
  const [status, setStatus] = useState<LocalSpeechStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [pendingUtterances, setPendingUtterances] = useState(0);
  const [speechActive, setSpeechActive] = useState(false);
  const runtimeRef = useRef<CaptureRuntime | null>(null);
  const queueRef = useRef<Promise<void>>(Promise.resolve());
  const utteranceIndexRef = useRef(0);
  const startAttemptRef = useRef(0);
  const startedAtRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const mountedRef = useRef(true);
  const stopRef = useRef<(reason?: 'completed' | 'cancelled') => Promise<void>>(
    async () => undefined,
  );
  const onSegmentRef = useRef(options.onSegment);
  const onStatusMessageRef = useRef(options.onStatusMessage);
  const encounterIdRef = useRef(options.encounterId);

  useEffect(() => {
    onSegmentRef.current = options.onSegment;
    onStatusMessageRef.current = options.onStatusMessage;
    encounterIdRef.current = options.encounterId;
  });

  const releaseAudio = useCallback(async () => {
    const runtime = runtimeRef.current;
    runtimeRef.current = null;
    if (!runtime) return;
    runtime.worklet.port.onmessage = null;
    runtime.worklet.disconnect();
    runtime.source.disconnect();
    runtime.silentGain.disconnect();
    for (const track of runtime.stream.getTracks()) track.stop();
    await runtime.context.close().catch(() => undefined);
  }, []);

  const stop = useCallback(
    async (reason: 'completed' | 'cancelled' = 'completed') => {
      startAttemptRef.current += 1;
      const runtime = runtimeRef.current;
      if (!runtime) {
        if (mountedRef.current) setStatus('idle');
        return;
      }
      if (mountedRef.current) setStatus('stopping');
      if (reason === 'completed') runtime.flushPending?.();
      await releaseAudio();
      await queueRef.current.catch(() => undefined);
      const encounterId = encounterIdRef.current;
      if (encounterId) {
        await fetch('/api/workspace/transcript/speech/session', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            encounterId,
            sessionId: runtime.sessionId,
            status: reason,
          }),
        }).catch(() => undefined);
      }
      startedAtRef.current = null;
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
      timerRef.current = null;
      if (mountedRef.current) {
        setElapsedSeconds(0);
        setSpeechActive(false);
        setStatus('idle');
      }
    },
    [releaseAudio],
  );
  useEffect(() => {
    stopRef.current = stop;
  }, [stop]);

  const start = useCallback(async () => {
    if (!options.enabled || !options.encounterId || runtimeRef.current) return;
    const startAttempt = startAttemptRef.current + 1;
    startAttemptRef.current = startAttempt;
    setError(null);
    setStatus('requesting_permission');
    let stream: MediaStream | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      if (startAttemptRef.current !== startAttempt) {
        for (const track of stream.getTracks()) track.stop();
        if (mountedRef.current) setStatus('idle');
        return;
      }
      setStatus('connecting');
      const sessionResponse = await fetch(
        '/api/workspace/transcript/speech/session',
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            encounterId: options.encounterId,
            doctorFirst: true,
          }),
        },
      );
      if (!sessionResponse.ok) {
        throw new Error(
          await readApiError(
            sessionResponse,
            'Не удалось подключить локальную модель речи.',
          ),
        );
      }
      const sessionPayload = (await sessionResponse.json()) as {
        session: { id: string };
      };
      if (startAttemptRef.current !== startAttempt) {
        for (const track of stream.getTracks()) track.stop();
        await fetch('/api/workspace/transcript/speech/session', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            encounterId: options.encounterId,
            sessionId: sessionPayload.session.id,
            status: 'cancelled',
          }),
        }).catch(() => undefined);
        if (mountedRef.current) setStatus('idle');
        return;
      }
      const context = new AudioContext({ latencyHint: 'interactive' });
      await context.audioWorklet.addModule('/orion-pcm-processor.js');
      await context.resume();
      if (startAttemptRef.current !== startAttempt) {
        for (const track of stream.getTracks()) track.stop();
        await context.close().catch(() => undefined);
        await fetch('/api/workspace/transcript/speech/session', {
          method: 'DELETE',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            encounterId: options.encounterId,
            sessionId: sessionPayload.session.id,
            status: 'cancelled',
          }),
        }).catch(() => undefined);
        if (mountedRef.current) setStatus('idle');
        return;
      }
      const source = context.createMediaStreamSource(stream);
      const worklet = new AudioWorkletNode(context, 'orion-pcm-processor');
      const silentGain = context.createGain();
      silentGain.gain.value = 0;
      source.connect(worklet);
      worklet.connect(silentGain);
      silentGain.connect(context.destination);
      const runtime: CaptureRuntime = {
        stream,
        context,
        source,
        worklet,
        silentGain,
        sessionId: sessionPayload.session.id,
        sampleRate: context.sampleRate,
        flushPending: null,
      };
      runtimeRef.current = runtime;
      utteranceIndexRef.current = 0;
      queueRef.current = Promise.resolve();

      let calibratedMs = 0;
      let noiseFloor = 0.004;
      let preRoll: Float32Array[] = [];
      let preRollMs = 0;
      let triggerMs = 0;
      let silenceMs = 0;
      let voicedMs = 0;
      let utteranceMs = 0;
      let utteranceFrames: Float32Array[] | null = null;

      const enqueue = (frames: Float32Array[]) => {
        const index = utteranceIndexRef.current;
        utteranceIndexRef.current += 1;
        const wav = encodeWav(concatFrames(frames), runtime.sampleRate);
        setPendingUtterances((count) => count + 1);
        queueRef.current = queueRef.current
          .then(async () => {
            const response = await fetch(
              '/api/workspace/transcript/speech/transcribe',
              {
                method: 'POST',
                headers: {
                  'content-type': 'audio/wav',
                  'x-orion-encounter-id': options.encounterId!,
                  'x-orion-speech-session-id': runtime.sessionId,
                  'x-orion-utterance-index': String(index),
                },
                body: wav,
              },
            );
            if (!response.ok) {
              throw new Error(
                await readApiError(response, 'Не удалось распознать реплику.'),
              );
            }
            const payload = (await response.json()) as {
              segment: LocalSpeechSegment;
            };
            onSegmentRef.current(payload.segment);
          })
          .catch((uploadError: unknown) => {
            const message =
              uploadError instanceof Error
                ? uploadError.message
                : 'Локальное распознавание остановлено.';
            if (mountedRef.current) {
              setError(message);
              setStatus('error');
            }
            onStatusMessageRef.current?.(message);
            void stopRef.current('cancelled');
          })
          .finally(() => {
            if (mountedRef.current) {
              setPendingUtterances((count) => Math.max(0, count - 1));
            }
          });
      };

      runtime.flushPending = () => {
        if (!utteranceFrames || voicedMs < MIN_VOICED_MS) return;
        const completed = utteranceFrames;
        utteranceFrames = null;
        setSpeechActive(false);
        enqueue(completed);
        triggerMs = 0;
        silenceMs = 0;
        voicedMs = 0;
        utteranceMs = 0;
      };

      worklet.port.onmessage = (event: MessageEvent<Float32Array>) => {
        const frame = event.data;
        if (!(frame instanceof Float32Array) || frame.length === 0) return;
        const frameMs = (frame.length / runtime.sampleRate) * 1000;
        const level = rms(frame);
        if (calibratedMs < NOISE_CALIBRATION_MS) {
          noiseFloor = noiseFloor * 0.9 + level * 0.1;
          calibratedMs += frameMs;
        }
        const startThreshold = clamp(noiseFloor * 1.8, 0.0045, 0.03);
        const continueThreshold = clamp(noiseFloor * 1.35, 0.003, 0.02);

        if (!utteranceFrames) {
          preRoll.push(frame);
          preRollMs += frameMs;
          while (preRollMs > PRE_ROLL_MS && preRoll.length > 1) {
            const removed = preRoll.shift();
            if (removed) preRollMs -= (removed.length / runtime.sampleRate) * 1000;
          }
          triggerMs = level >= startThreshold ? triggerMs + frameMs : 0;
          if (calibratedMs >= NOISE_CALIBRATION_MS && triggerMs >= SPEECH_TRIGGER_MS) {
            utteranceFrames = [...preRoll];
            utteranceMs = preRollMs;
            voicedMs = triggerMs;
            silenceMs = 0;
            preRoll = [];
            preRollMs = 0;
            setSpeechActive(true);
          }
          return;
        }

        utteranceFrames.push(frame);
        utteranceMs += frameMs;
        if (level >= continueThreshold) {
          silenceMs = 0;
          voicedMs += frameMs;
        } else {
          silenceMs += frameMs;
        }
        if (silenceMs >= END_SILENCE_MS || utteranceMs >= MAX_UTTERANCE_MS) {
          const completed = utteranceFrames;
          utteranceFrames = null;
          setSpeechActive(false);
          if (voicedMs >= MIN_VOICED_MS) enqueue(completed);
          triggerMs = 0;
          silenceMs = 0;
          voicedMs = 0;
          utteranceMs = 0;
        }
      };

      startedAtRef.current = Date.now();
      timerRef.current = window.setInterval(() => {
        if (startedAtRef.current) {
          setElapsedSeconds(Math.floor((Date.now() - startedAtRef.current) / 1000));
        }
      }, 500);
      setStatus('listening');
      onStatusMessageRef.current?.(
        'Локальное распознавание запущено. Первой говорит врач.',
      );
    } catch (startError) {
      if (stream) for (const track of stream.getTracks()) track.stop();
      if (startAttemptRef.current !== startAttempt) {
        if (mountedRef.current) setStatus('idle');
        return;
      }
      const message =
        startError instanceof DOMException && startError.name === 'NotAllowedError'
          ? 'Браузер не дал доступ к микрофону.'
          : startError instanceof Error
            ? startError.message
            : 'Не удалось запустить микрофон.';
      setError(message);
      setStatus('error');
      onStatusMessageRef.current?.(message);
    }
  }, [options.enabled, options.encounterId]);

  useEffect(() => {
    if (!options.enabled && runtimeRef.current) void stop('cancelled');
  }, [options.enabled, stop]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      void stopRef.current('cancelled');
    };
  }, []);

  return {
    status,
    error,
    elapsedSeconds,
    pendingUtterances,
    speechActive,
    isRecording: status === 'listening' || status === 'connecting',
    isBusy:
      status === 'requesting_permission' ||
      status === 'connecting' ||
      status === 'stopping',
    hasProvisional: speechActive || pendingUtterances > 0,
    start,
    stop,
  };
}
