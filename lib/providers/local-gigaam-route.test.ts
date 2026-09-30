import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({ prepare: vi.fn(), commit: vi.fn(), nextIndex: 0 }));
vi.mock('cloudflare:workers', () => ({ env: { DB: {} } }));
vi.mock('@/lib/auth/site-identity', () => ({
  getSiteIdentity: () => ({ id: 'identity-a' }), toSiteIdentityPrincipal: () => ({}),
}));
vi.mock('@/lib/auth/workspace-access', async (original) => ({
  ...await original<object>(),
  resolveClinicianWorkspaceAccess: async () => ({
    user: { id: 'user-a' },
    scope: { organizationId: 'org-a', facilityId: 'facility-a', encounterId: 'enc-a',
      reviewerMembershipId: 'member-a', accessAssignmentId: 'assignment-a' },
  }),
}));
vi.mock('@/lib/repositories/workspace-access', () => ({ D1WorkspaceAccessRepository: class {} }));
vi.mock('@/lib/repositories/transcript-ingestion', async (original) => ({
  ...await original<object>(),
  D1TranscriptIngestionRepository: class {
    prepareTranscription = state.prepare;
    commitTranscription = state.commit;
  },
}));

import { POST } from '@/app/api/workspace/transcript/speech/transcribe/route';
import { SpeechCaptureConsentRequiredError, SpeechCaptureLifecycleError } from '@/lib/repositories/transcript-ingestion';

const request = (index: number) => new Request(
  'http://orion.test/api/workspace/transcript/speech/transcribe?accessAssignmentId=assignment-a',
  {
    method: 'POST', headers: {
      origin: 'http://orion.test', 'content-type': 'audio/wav',
      'x-orion-encounter-id': 'enc-a', 'x-orion-speech-session-id': 'session-a',
      'x-orion-utterance-index': String(index),
    }, body: new Uint8Array(48),
  },
);

function speech(index: number) {
  return Response.json({
    sessionId: 'upstream-a', utteranceIndex: index, text: 'Синтетическая проверка.',
    speaker: {}, durationMs: 1000, processingMs: 10,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  state.nextIndex = 0;
  state.prepare.mockImplementation(async ({ utteranceIndex }: { utteranceIndex: number }) => {
    expect(utteranceIndex).toBe(state.nextIndex);
    return { run: { upstreamSessionId: 'upstream-a' }, inputHash: 'synthetic-hash' };
  });
  state.commit.mockImplementation(async ({ utteranceIndex }: { utteranceIndex: number }) => {
    expect(utteranceIndex).toBe(state.nextIndex);
    state.nextIndex += 1;
    return { id: `segment-${utteranceIndex}`, segmentIndex: utteranceIndex };
  });
});
afterEach(() => { vi.unstubAllGlobals(); });

describe('local GigaAM provider through the authoritative speech API', () => {
  it('returns no_speech without a commit and accepts the next speech at the same index', async () => {
    const fetchImpl = vi.fn()
      .mockResolvedValueOnce(speech(0))
      .mockResolvedValueOnce(Response.json(
        { detail: 'В реплике не обнаружен различимый голос.' }, { status: 422 },
      ))
      .mockResolvedValueOnce(speech(1));
    vi.stubGlobal('fetch', fetchImpl);

    expect((await POST(request(0))).status).toBe(200);
    const silence = await POST(request(1));
    expect(silence.status).toBe(200);
    expect(await silence.json()).toEqual({ skipped: 'no_speech', segment: null });
    expect(state.commit).toHaveBeenCalledOnce();
    expect(state.nextIndex).toBe(1);
    const nextSpeech = await POST(request(1));
    expect(nextSpeech.status).toBe(200);
    expect(await nextSpeech.json()).toMatchObject({ segment: { segmentIndex: 1 } });
    expect(state.commit).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls.map(([, init]) =>
      (init.body as FormData).get('utterance_index')),
    ).toEqual(['0', '1', '1']);
  });

  it('exposes other upstream 422 validation failures as invalid audio, not a skip or outage', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(
      { detail: 'Не удалось прочитать WAV-аудио.' }, { status: 422 },
    )));
    const response = await POST(request(0));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: 'SPEECH_INVALID_AUDIO' } });
    expect(state.commit).not.toHaveBeenCalled();
  });

  it.each([
    [new SpeechCaptureConsentRequiredError(), 409, 'SPEECH_CONSENT_REQUIRED'],
    [new SpeechCaptureLifecycleError(), 422, 'SPEECH_NOT_AVAILABLE'],
  ] as const)('keeps the pre-provider capture checks authoritative: %s', async (error, status, code) => {
    const fetchImpl = vi.fn();
    vi.stubGlobal('fetch', fetchImpl);
    state.prepare.mockRejectedValue(error);
    const response = await POST(request(0));
    expect(response.status).toBe(status);
    expect(await response.json()).toMatchObject({ error: { code } });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(state.commit).not.toHaveBeenCalled();
  });
});
