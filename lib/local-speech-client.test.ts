import { describe, expect, it, vi } from 'vitest';
import { createLocalSpeechUploadQueue, type LocalSpeechSegment } from './local-speech-client';

function segment(index: number): LocalSpeechSegment {
  return {
    id: `segment-${index}`, segmentIndex: index, version: 1,
    role: 'unknown', roleSource: 'unassigned', language: 'ru',
    text: `Синтетическая реплика ${index}`, startedAtMs: 0, endedAtMs: 1000,
    state: 'final',
  };
}

const silence = () => Response.json({ skipped: 'no_speech', segment: null });

describe('clinical local speech upload queue', () => {
  it('serializes queued audio and reuses the index after leading and intervening silence', async () => {
    let releaseFirst!: (response: Response) => void;
    const firstResponse = new Promise<Response>((resolve) => { releaseFirst = resolve; });
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockReturnValueOnce(firstResponse)
      .mockResolvedValueOnce(silence())
      .mockResolvedValueOnce(Response.json({ segment: segment(0) }))
      .mockResolvedValueOnce(silence())
      .mockResolvedValueOnce(Response.json({ segment: segment(1) }));
    const queue = createLocalSpeechUploadQueue({
      fetchImpl, encounterId: 'encounter-a', sessionId: 'session-a',
    });
    const uploads = Array.from({ length: 5 }, () => queue.enqueue(new ArrayBuffer(48)));
    await Promise.resolve();
    expect(fetchImpl).toHaveBeenCalledOnce();
    releaseFirst(silence());

    await expect(Promise.all(uploads)).resolves.toEqual([
      null, null, segment(0), null, segment(1),
    ]);
    await queue.drain();
    expect(fetchImpl.mock.calls.map(([, init]) =>
      new Headers(init?.headers).get('x-orion-utterance-index')),
    ).toEqual(['0', '0', '0', '1', '1']);
    for (const [url, init] of fetchImpl.mock.calls) {
      expect(url).toBe('/api/workspace/transcript/speech/transcribe');
      expect(new Headers(init?.headers).get('x-orion-encounter-id')).toBe('encounter-a');
      expect(new Headers(init?.headers).get('x-orion-speech-session-id')).toBe('session-a');
    }
  });

  it.each([400, 409, 422, 503])('keeps HTTP %i fatal and does not send already queued audio', async (status) => {
    const fetchImpl = vi.fn(async () => Response.json({
      error: { code: 'SPEECH_INVALID_AUDIO', message: 'Реплика отклонена.' },
    }, { status }));
    const queue = createLocalSpeechUploadQueue({ fetchImpl, encounterId: 'enc-a', sessionId: 'session-a' });
    const results = await Promise.allSettled([
      queue.enqueue(new ArrayBuffer(48)), queue.enqueue(new ArrayBuffer(48)),
    ]);
    expect(results).toEqual([
      { status: 'rejected', reason: new Error('Реплика отклонена.') },
      { status: 'rejected', reason: new Error('Реплика отклонена.') },
    ]);
    await expect(queue.drain()).resolves.toBeUndefined();
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it.each([
    null, {}, { segment: null }, { skipped: 'no_speech' },
    { skipped: 'unknown', segment: null }, { skipped: 'no_speech', segment: segment(0) },
  ])('rejects malformed or ambiguous success payloads: %j', async (payload) => {
    const queue = createLocalSpeechUploadQueue({
      fetchImpl: async () => Response.json(payload), encounterId: 'enc-a', sessionId: 'session-a',
    });
    await expect(queue.enqueue(new ArrayBuffer(48))).rejects.toThrow('некорректный ответ');
  });

  it('keeps a network failure fatal but starts a new capture session at index zero', async () => {
    const fetchImpl = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new Error('Network failure'))
      .mockResolvedValueOnce(Response.json({ segment: segment(0) }));
    const first = createLocalSpeechUploadQueue({ fetchImpl, encounterId: 'enc-a', sessionId: 'session-a' });
    await expect(first.enqueue(new ArrayBuffer(48))).rejects.toThrow('Network failure');
    await expect(first.enqueue(new ArrayBuffer(48))).rejects.toThrow('Network failure');
    const second = createLocalSpeechUploadQueue({ fetchImpl, encounterId: 'enc-a', sessionId: 'session-b' });
    await expect(second.enqueue(new ArrayBuffer(48))).resolves.toEqual(segment(0));
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get('x-orion-utterance-index')).toBe('0');
    expect(new Headers(fetchImpl.mock.calls[1][1]?.headers).get('x-orion-speech-session-id')).toBe('session-b');
  });
});
