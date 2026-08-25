'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

export type SonioxToken = {
  text: string;
  startMs: number | null;
  endMs: number | null;
  confidence: number | null;
  isFinal: boolean;
  speaker: string | null;
  language: 'ru' | 'kk' | 'unknown';
};

export type TranscriptionStatus =
  | 'idle'
  | 'requesting'
  | 'connecting'
  | 'streaming'
  | 'stopping'
  | 'finished'
  | 'error';

type CredentialResponse = {
  apiKey: string;
  expiresAt: string;
  websocketUrl: string;
  model: string;
  region: 'us' | 'eu' | 'jp';
};

type WireToken = {
  text?: string;
  start_ms?: number;
  end_ms?: number;
  confidence?: number;
  is_final?: boolean;
  speaker?: string;
  language?: string;
  translation_status?: string;
};

type WireMessage = {
  tokens?: WireToken[];
  finished?: boolean;
  error_code?: number;
  error_type?: string;
  error_message?: string;
};

function normalizeToken(token: WireToken): SonioxToken | null {
  if (!token.text || token.translation_status === 'translation') return null;
  if (token.text === '<end>' || token.text === '<fin>') return null;

  return {
    text: token.text,
    startMs: typeof token.start_ms === 'number' ? token.start_ms : null,
    endMs: typeof token.end_ms === 'number' ? token.end_ms : null,
    confidence:
      typeof token.confidence === 'number' ? token.confidence : null,
    isFinal: token.is_final === true,
    speaker: token.speaker ?? null,
    language:
      token.language === 'ru' || token.language === 'kk'
        ? token.language
        : 'unknown',
  };
}

function readableError(error: unknown) {
  if (error instanceof DOMException && error.name === 'NotAllowedError') {
    return 'Доступ к микрофону не предоставлен.';
  }
  if (error instanceof Error) return error.message;
  return 'Не удалось запустить распознавание.';
}

export function useSonioxTranscription() {
  const [status, setStatus] = useState<TranscriptionStatus>('idle');
  const [finalTokens, setFinalTokens] = useState<SonioxToken[]>([]);
  const [provisionalTokens, setProvisionalTokens] = useState<SonioxToken[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<'us' | 'eu' | 'jp' | null>(null);

  const socketRef = useRef<WebSocket | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const audioSendChainRef = useRef<Promise<void>>(Promise.resolve());
  const keepaliveRef = useRef<number | null>(null);
  const finishTimeoutRef = useRef<number | null>(null);

  const clearTimers = useCallback(() => {
    if (keepaliveRef.current !== null) {
      window.clearInterval(keepaliveRef.current);
      keepaliveRef.current = null;
    }
    if (finishTimeoutRef.current !== null) {
      window.clearTimeout(finishTimeoutRef.current);
      finishTimeoutRef.current = null;
    }
  }, []);

  const stopTracks = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
  }, []);

  const closeSocket = useCallback(() => {
    const socket = socketRef.current;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    socketRef.current = null;
  }, []);

  const start = useCallback(async () => {
    if (status !== 'idle' && status !== 'finished' && status !== 'error') return;

    clearTimers();
    closeSocket();
    stopTracks();
    setFinalTokens([]);
    setProvisionalTokens([]);
    setError(null);
    setRegion(null);
    setStatus('requesting');
    audioSendChainRef.current = Promise.resolve();

    try {
      const response = await fetch('/api/realtime/credentials', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });
      const body = (await response.json().catch(() => null)) as
        | CredentialResponse
        | { error?: string }
        | null;

      if (!response.ok || !body || !('apiKey' in body)) {
        throw new Error(
          body && 'error' in body && body.error
            ? body.error
            : 'Не удалось получить безопасный доступ к распознаванию.',
        );
      }

      setRegion(body.region);
      const mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
      });
      streamRef.current = mediaStream;

      const preferredMimeTypes = [
        'audio/webm;codecs=opus',
        'audio/ogg;codecs=opus',
        'audio/webm',
      ];
      const mimeType = preferredMimeTypes.find((candidate) =>
        MediaRecorder.isTypeSupported(candidate),
      );
      const recorder = new MediaRecorder(
        mediaStream,
        mimeType ? { mimeType, audioBitsPerSecond: 64_000 } : undefined,
      );
      recorderRef.current = recorder;

      setStatus('connecting');
      const socket = new WebSocket(body.websocketUrl);
      socket.binaryType = 'arraybuffer';
      socketRef.current = socket;

      socket.onopen = () => {
        socket.send(
          JSON.stringify({
            api_key: body.apiKey,
            model: body.model,
            audio_format: 'auto',
            language_hints: ['ru', 'kk'],
            language_hints_strict: false,
            enable_language_identification: true,
            enable_speaker_diarization: true,
            enable_endpoint_detection: false,
            context: {
              general: [
                { key: 'domain', value: 'Healthcare' },
                { key: 'languages', value: 'Russian and Kazakh' },
              ],
            },
          }),
        );

        recorder.ondataavailable = (event) => {
          if (!event.data.size) return;
          audioSendChainRef.current = audioSendChainRef.current.then(
            async () => {
              if (socket.readyState !== WebSocket.OPEN) return;
              socket.send(await event.data.arrayBuffer());
            },
          );
        };
        recorder.onerror = () => {
          setError('Ошибка захвата звука с микрофона.');
          setStatus('error');
        };
        recorder.start(250);
        setStatus('streaming');

        keepaliveRef.current = window.setInterval(() => {
          if (socket.readyState === WebSocket.OPEN) {
            socket.send(JSON.stringify({ type: 'keepalive' }));
          }
        }, 10_000);
      };

      socket.onmessage = (event) => {
        let message: WireMessage;
        try {
          message = JSON.parse(String(event.data)) as WireMessage;
        } catch {
          return;
        }

        if (message.error_code) {
          setError(
            message.error_message ??
              `Ошибка распознавания: ${message.error_type ?? message.error_code}`,
          );
          setStatus('error');
          clearTimers();
          stopTracks();
          return;
        }

        const tokens = (message.tokens ?? [])
          .map(normalizeToken)
          .filter((token): token is SonioxToken => token !== null);
        const stable = tokens.filter((token) => token.isFinal);
        const provisional = tokens.filter((token) => !token.isFinal);

        if (stable.length) setFinalTokens((current) => [...current, ...stable]);
        setProvisionalTokens(provisional);

        if (message.finished) {
          clearTimers();
          stopTracks();
          socketRef.current = null;
          recorderRef.current = null;
          setProvisionalTokens([]);
          setStatus('finished');
        }
      };

      socket.onerror = () => {
        setError('Не удалось установить защищённое соединение с Soniox.');
        setStatus('error');
        clearTimers();
        stopTracks();
      };

      socket.onclose = () => {
        clearTimers();
        stopTracks();
        socketRef.current = null;
        recorderRef.current = null;
        setStatus((current) =>
          current === 'stopping' || current === 'streaming'
            ? 'finished'
            : current,
        );
      };
    } catch (caught) {
      clearTimers();
      closeSocket();
      stopTracks();
      setError(readableError(caught));
      setStatus('error');
    }
  }, [clearTimers, closeSocket, status, stopTracks]);

  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    const socket = socketRef.current;

    setStatus('stopping');
    clearTimers();

    const finishStream = () => {
      stopTracks();
      if (socket?.readyState === WebSocket.OPEN) {
        socket.send(new Uint8Array(0));
        finishTimeoutRef.current = window.setTimeout(() => {
          closeSocket();
          setStatus('finished');
        }, 8_000);
      } else {
        closeSocket();
        setStatus('finished');
      }
    };

    if (recorder && recorder.state !== 'inactive') {
      recorder.onstop = () => {
        void audioSendChainRef.current.finally(finishStream);
      };
      recorder.stop();
    } else {
      finishStream();
    }
  }, [clearTimers, closeSocket, stopTracks]);

  const reset = useCallback(() => {
    clearTimers();
    closeSocket();
    stopTracks();
    setFinalTokens([]);
    setProvisionalTokens([]);
    setError(null);
    setRegion(null);
    setStatus('idle');
  }, [clearTimers, closeSocket, stopTracks]);

  useEffect(
    () => () => {
      clearTimers();
      closeSocket();
      stopTracks();
    },
    [clearTimers, closeSocket, stopTracks],
  );

  return {
    status,
    finalTokens,
    provisionalTokens,
    error,
    region,
    start,
    stop,
    reset,
  };
}
