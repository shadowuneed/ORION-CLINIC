import { z } from 'zod';
import {
  SpeechProviderError,
  type SpeechToTextProvider,
} from './speech-to-text';

const sessionResponseSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    engine: z.record(z.string(), z.unknown()).optional(),
  })
  .passthrough();

const transcriptionResponseSchema = z
  .object({
    sessionId: z.string().min(1).max(200),
    utteranceIndex: z.number().int().nonnegative(),
    text: z.string().trim().min(1).max(8_000),
    language: z.string().nullable().optional(),
    speaker: z
      .object({
        id: z.string().optional(),
        label: z.string().optional(),
        confidence: z.number().min(0).max(1).nullable().optional(),
        method: z.string().optional(),
        status: z.string().optional(),
      })
      .passthrough(),
    durationMs: z.number().int().nonnegative(),
    processingMs: z.number().int().nonnegative(),
  })
  .passthrough();

type LocalGigaamOptions = {
  baseUrl: string;
  model: string;
  fetchImpl?: typeof fetch;
};

function mapLanguage(
  value: string | null | undefined,
): 'ru' | 'kk' | 'mixed' | 'unknown' {
  const normalized = value?.toLowerCase();
  if (normalized === 'ru' || normalized === 'kk' || normalized === 'mixed') {
    return normalized;
  }
  return 'unknown' as const;
}

function mapRole(
  value: string | undefined,
): 'doctor' | 'patient' | 'other' | 'unknown' {
  const normalized = value?.toLowerCase();
  if (normalized === 'doctor' || normalized === 'patient' || normalized === 'other') {
    return normalized;
  }
  return 'unknown' as const;
}

function mapRoleSource(value: string | undefined) {
  if (value === 'embedding') return 'voice_calibration' as const;
  if (value === 'order_fallback') return 'model' as const;
  return 'unassigned' as const;
}

export class LocalGigaamProvider implements SpeechToTextProvider {
  private readonly fetchImpl: typeof fetch;
  private readonly baseUrl: string;

  constructor(private readonly options: LocalGigaamOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
  }

  async health(signal?: AbortSignal) {
    try {
      const response = await this.fetchImpl(`${this.baseUrl}/health`, { signal });
      if (!response.ok) {
        return {
          reachable: true,
          ready: false,
          provider: 'local-gigaam',
          model: this.options.model,
          detail: `HTTP ${response.status}`,
        };
      }
      const raw = (await response.json()) as Record<string, unknown>;
      const stt =
        typeof raw.stt === 'object' && raw.stt !== null
          ? (raw.stt as Record<string, unknown>)
          : null;
      const ready = raw.status === 'ok' && (!stt || stt.status === 'ready');
      return {
        reachable: true,
        ready,
        provider: 'local-gigaam',
        model: this.options.model,
        detail: ready ? 'ready' : String(stt?.status ?? raw.status ?? 'loading'),
      };
    } catch {
      return {
        reachable: false,
        ready: false,
        provider: 'local-gigaam',
        model: this.options.model,
        detail: 'unreachable',
      };
    }
  }

  async createSession(input: { doctorFirst: boolean; signal?: AbortSignal }) {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/sessions`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ doctorFirst: input.doctorFirst }),
        signal: input.signal,
      });
    } catch {
      throw new SpeechProviderError('unavailable');
    }
    if (!response.ok) {
      throw new SpeechProviderError(
        response.status === 503 ? 'not_ready' : 'unavailable',
      );
    }
    const parsed = sessionResponseSchema.safeParse(await response.json());
    if (!parsed.success) throw new SpeechProviderError('invalid_response');
    return {
      upstreamSessionId: parsed.data.sessionId,
      provider: 'local-gigaam',
      model: this.options.model,
      modelVersion: this.options.model,
    };
  }

  async transcribe(input: {
    upstreamSessionId: string;
    utteranceIndex: number;
    audio: Uint8Array;
    signal?: AbortSignal;
  }) {
    const form = new FormData();
    const audioBuffer = Uint8Array.from(input.audio).buffer;
    form.set('audio', new Blob([audioBuffer], { type: 'audio/wav' }), 'utterance.wav');
    form.set('session_id', input.upstreamSessionId);
    form.set('utterance_index', String(input.utteranceIndex));
    form.set('encoding', 'wav');
    form.set('sample_rate', '16000');
    form.set('channels', '1');

    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/v1/transcribe`, {
        method: 'POST',
        body: form,
        signal: input.signal,
      });
    } catch {
      throw new SpeechProviderError('unavailable');
    }
    if (!response.ok) {
      throw new SpeechProviderError(
        response.status === 400 || response.status === 413
          ? 'invalid_audio'
          : response.status === 503
            ? 'not_ready'
            : 'unavailable',
      );
    }
    const raw = (await response.json()) as Record<string, unknown>;
    const parsed = transcriptionResponseSchema.safeParse(raw);
    if (!parsed.success) throw new SpeechProviderError('invalid_response');
    const speakerConfidence = parsed.data.speaker.confidence;
    return {
      upstreamSessionId: parsed.data.sessionId,
      utteranceIndex: parsed.data.utteranceIndex,
      text: parsed.data.text,
      language: mapLanguage(parsed.data.language),
      role: mapRole(parsed.data.speaker.id ?? parsed.data.speaker.label),
      roleSource: mapRoleSource(parsed.data.speaker.method),
      speakerConfidenceBasisPoints:
        typeof speakerConfidence === 'number'
          ? Math.round(speakerConfidence * 10_000)
          : null,
      startedAtMs: 0,
      endedAtMs: parsed.data.durationMs,
      durationMs: parsed.data.durationMs,
      processingMs: parsed.data.processingMs,
      providerPayload: raw,
    };
  }

  async deleteSession(upstreamSessionId: string, signal?: AbortSignal) {
    try {
      const response = await this.fetchImpl(
        `${this.baseUrl}/v1/sessions/${encodeURIComponent(upstreamSessionId)}`,
        { method: 'DELETE', signal },
      );
      if (!response.ok && response.status !== 404) {
        throw new SpeechProviderError('unavailable');
      }
    } catch (error) {
      if (error instanceof SpeechProviderError) throw error;
      throw new SpeechProviderError('unavailable');
    }
  }
}
