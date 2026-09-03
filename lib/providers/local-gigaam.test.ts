import { describe, expect, it, vi } from 'vitest';
import { LocalGigaamProvider } from './local-gigaam';
import { SpeechProviderError } from './speech-to-text';

describe('local GigaAM provider', () => {
  it('does not treat top-level health ok as ready while the model is loading', async () => {
    const provider = new LocalGigaamProvider({
      baseUrl: 'http://127.0.0.1:3101',
      model: 'gigaam-multilingual-local',
      fetchImpl: async () =>
        new Response(JSON.stringify({ status: 'ok', stt: { status: 'loading' } })),
    });
    await expect(provider.health()).resolves.toMatchObject({
      reachable: true,
      ready: false,
      detail: 'loading',
    });
  });

  it('maps provider speaker and timing without trusting client metadata', async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(
        JSON.stringify({
          sessionId: 'upstream-session',
          utteranceIndex: 3,
          text: 'Сәлеметсіз бе, басым ауырып тұр.',
          language: null,
          speaker: {
            id: 'patient',
            confidence: 0.82,
            method: 'embedding',
            status: 'matched',
          },
          durationMs: 1450,
          processingMs: 610,
        }),
        { status: 200 },
      ),
    );
    const provider = new LocalGigaamProvider({
      baseUrl: 'http://127.0.0.1:3101',
      model: 'gigaam-multilingual-local',
      fetchImpl,
    });
    const result = await provider.transcribe({
      upstreamSessionId: 'upstream-session',
      utteranceIndex: 3,
      audio: new Uint8Array([82, 73, 70, 70]),
    });
    expect(result).toMatchObject({
      utteranceIndex: 3,
      role: 'patient',
      roleSource: 'voice_calibration',
      language: 'unknown',
      speakerConfidenceBasisPoints: 8200,
      durationMs: 1450,
      processingMs: 610,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('rejects empty provider text', async () => {
    const provider = new LocalGigaamProvider({
      baseUrl: 'http://127.0.0.1:3101',
      model: 'gigaam-multilingual-local',
      fetchImpl: async () =>
        new Response(
          JSON.stringify({
            sessionId: 'upstream-session',
            utteranceIndex: 0,
            text: '',
            speaker: {},
            durationMs: 1,
            processingMs: 1,
          }),
        ),
    });
    await expect(
      provider.transcribe({
        upstreamSessionId: 'upstream-session',
        utteranceIndex: 0,
        audio: new Uint8Array([1]),
      }),
    ).rejects.toBeInstanceOf(SpeechProviderError);
  });
});
