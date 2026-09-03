export type SpeechSession = {
  upstreamSessionId: string;
  provider: string;
  model: string;
  modelVersion: string;
};

export type SpeechTranscription = {
  upstreamSessionId: string;
  utteranceIndex: number;
  text: string;
  language: 'ru' | 'kk' | 'mixed' | 'unknown';
  role: 'doctor' | 'patient' | 'other' | 'unknown';
  roleSource: 'model' | 'voice_calibration' | 'unassigned';
  speakerConfidenceBasisPoints: number | null;
  startedAtMs: number;
  endedAtMs: number;
  durationMs: number;
  processingMs: number;
  providerPayload: Record<string, unknown>;
};

export type SpeechProviderHealth = {
  reachable: boolean;
  ready: boolean;
  provider: string;
  model: string;
  detail: string;
};

export interface SpeechToTextProvider {
  health(signal?: AbortSignal): Promise<SpeechProviderHealth>;
  createSession(input: {
    doctorFirst: boolean;
    signal?: AbortSignal;
  }): Promise<SpeechSession>;
  transcribe(input: {
    upstreamSessionId: string;
    utteranceIndex: number;
    audio: Uint8Array;
    signal?: AbortSignal;
  }): Promise<SpeechTranscription>;
  deleteSession(upstreamSessionId: string, signal?: AbortSignal): Promise<void>;
}

export class SpeechProviderError extends Error {
  constructor(
    readonly code:
      | 'unavailable'
      | 'not_ready'
      | 'invalid_audio'
      | 'invalid_response'
      | 'timeout',
    message = 'Speech provider failed',
  ) {
    super(message);
    this.name = 'SpeechProviderError';
  }
}
