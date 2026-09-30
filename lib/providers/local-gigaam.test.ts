import { describe, expect, it, vi } from 'vitest';
import { LocalGigaamProvider } from './local-gigaam';

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

  it('accepts silence as an empty result without inventing a transcript', async () => {
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
    ).resolves.toMatchObject({ text: '', utteranceIndex: 0 });
  });

  it('normalizes the exact sidecar no-voice 422 without inventing text or speaker', async () => {
    const provider = new LocalGigaamProvider({
      baseUrl: 'http://127.0.0.1:3101',
      model: 'gigaam-multilingual-local',
      fetchImpl: async () => Response.json(
        { detail: 'В реплике не обнаружен различимый голос.' },
        { status: 422 },
      ),
    });

    await expect(provider.transcribe({
      upstreamSessionId: 'owned-session',
      utteranceIndex: 4,
      audio: new Uint8Array(48),
    })).resolves.toEqual({
      upstreamSessionId: 'owned-session', utteranceIndex: 4, text: '',
      language: 'unknown', role: 'unknown', roleSource: 'unassigned',
      speakerConfidenceBasisPoints: null, startedAtMs: 0, endedAtMs: 0,
      durationMs: 0, processingMs: 0,
      providerPayload: { detail: 'В реплике не обнаружен различимый голос.' },
    });
  });

  it.each([
    { detail: 'Не удалось прочитать WAV-аудио.' },
    { detail: 'Реплика короче 0.35 секунды. Запишите чуть дольше.' },
    { detail: 'Реплика длиннее 24.5 секунды. Разделите её на части.' },
    { detail: [{ loc: ['body', 'utterance_index'], msg: 'Field required' }] },
    { detail: 'В реплике не обнаружен различимый голос. Другой сбой.' },
    { detail: null },
    {},
    null,
  ])('rejects other 422 validation responses as invalid audio: %j', async (body) => {
    const provider = new LocalGigaamProvider({
      baseUrl: 'http://127.0.0.1:3101', model: 'gigaam-multilingual-local',
      fetchImpl: async () => Response.json(body, { status: 422 }),
    });
    await expect(provider.transcribe({
      upstreamSessionId: 'owned-session', utteranceIndex: 4, audio: new Uint8Array(48),
    })).rejects.toMatchObject({ code: 'invalid_audio' });
  });

  it('does not skip a malformed 422 body', async () => {
    const provider = new LocalGigaamProvider({
      baseUrl: 'http://127.0.0.1:3101', model: 'gigaam-multilingual-local',
      fetchImpl: async () => new Response('invalid JSON', { status: 422 }),
    });
    await expect(provider.transcribe({
      upstreamSessionId: 'owned-session', utteranceIndex: 4, audio: new Uint8Array(48),
    })).rejects.toMatchObject({ code: 'invalid_audio' });
  });

  it.each([[400, 'invalid_audio'], [413, 'invalid_audio'], [500, 'unavailable'], [503, 'not_ready']] as const)(
    'preserves HTTP %i errors even with the no-voice detail', async (status, code) => {
      const provider = new LocalGigaamProvider({
        baseUrl: 'http://127.0.0.1:3101', model: 'gigaam-multilingual-local',
        fetchImpl: async () => Response.json(
          { detail: 'В реплике не обнаружен различимый голос.' }, { status },
        ),
      });
      await expect(provider.transcribe({
        upstreamSessionId: 'owned-session', utteranceIndex: 4, audio: new Uint8Array(48),
      })).rejects.toMatchObject({ code });
    },
  );
});
