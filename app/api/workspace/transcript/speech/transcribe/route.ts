import { env } from 'cloudflare:workers';
import { z } from 'zod';
import {
  getSiteIdentity,
  toSiteIdentityPrincipal,
} from '@/lib/auth/site-identity';
import {
  AccessibleEncounterNotFoundError,
  ClinicianRoleRequiredError,
  MembershipRequiredError,
  resolveClinicianWorkspaceAccess,
} from '@/lib/auth/workspace-access';
import { parseClinicalProviderConfig } from '@/lib/config/clinical-providers';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { LocalGigaamProvider } from '@/lib/providers/local-gigaam';
import { SpeechProviderError } from '@/lib/providers/speech-to-text';
import {
  D1TranscriptIngestionRepository,
  SpeechCaptureConflictError,
  SpeechCaptureConsentRequiredError,
  SpeechCaptureLifecycleError,
  SpeechCaptureNotFoundError,
} from '@/lib/repositories/transcript-ingestion';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const headerSchema = z.object({
  encounterId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(120),
  utteranceIndex: z.coerce.number().int().nonnegative().max(10_000),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/transcript/speech/transcribe',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
  }
  if (!request.headers.get('content-type')?.toLowerCase().startsWith('audio/wav')) {
    return apiFailure(context, 415, 'INVALID_AUDIO_TYPE', 'Ожидается аудио WAV 16 кГц mono.');
  }
  const headers = headerSchema.safeParse({
    encounterId: request.headers.get('x-orion-encounter-id'),
    sessionId: request.headers.get('x-orion-speech-session-id'),
    utteranceIndex: request.headers.get('x-orion-utterance-index'),
  });
  if (!headers.success) {
    return apiFailure(context, 400, 'INVALID_REQUEST', 'Некорректные параметры реплики.');
  }
  const declaredLength = Number(request.headers.get('content-length') ?? '0');
  if (declaredLength > 800_000) {
    return apiFailure(context, 413, 'AUDIO_TOO_LARGE', 'Реплика слишком длинная.');
  }
  const audio = new Uint8Array(await request.arrayBuffer());
  if (audio.byteLength < 48 || audio.byteLength > 800_000) {
    return apiFailure(context, 400, 'INVALID_AUDIO', 'Пустая или слишком длинная реплика.');
  }

  try {
    parseRuntimeConfig(env);
    const config = parseClinicalProviderConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      headers.data.encounterId,
    );
    const repository = new D1TranscriptIngestionRepository(env.DB, access.scope);
    const prepared = await repository.prepareTranscription({
      sessionId: headers.data.sessionId,
      utteranceIndex: headers.data.utteranceIndex,
      audio,
    });
    if (prepared.replay) {
      return apiSuccess(context, { segment: prepared.replay, replay: true });
    }
    const provider = new LocalGigaamProvider({
      baseUrl: config.localSpeech.baseUrl,
      model: config.localSpeech.model,
    });
    const transcription = await provider.transcribe({
      upstreamSessionId: prepared.run.upstreamSessionId,
      utteranceIndex: headers.data.utteranceIndex,
      audio,
      signal: AbortSignal.timeout(45_000),
    });
    const segment = await repository.commitTranscription({
      sessionId: headers.data.sessionId,
      utteranceIndex: headers.data.utteranceIndex,
      inputHash: prepared.inputHash,
      result: transcription,
      actorId: access.user.id,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      segment,
      replay: false,
      processingMs: transcription.processingMs,
      audioRetention: false,
    });
  } catch (error) {
    if (error instanceof MembershipRequiredError || error instanceof ClinicianRoleRequiredError) {
      return apiFailure(context, 403, 'FORBIDDEN', 'Распознавание доступно назначенному врачу.');
    }
    if (error instanceof AccessibleEncounterNotFoundError || error instanceof SpeechCaptureNotFoundError) {
      return apiFailure(context, 404, 'NOT_FOUND', 'Приём или речевая сессия не найдены.');
    }
    if (error instanceof SpeechCaptureConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'SPEECH_CONSENT_REQUIRED',
        'Согласие изменилось. Запись остановлена без сохранения этой реплики.',
      );
    }
    if (error instanceof SpeechCaptureLifecycleError) {
      return apiFailure(context, 422, 'SPEECH_NOT_AVAILABLE', 'Приём уже не принимает новые реплики.');
    }
    if (error instanceof SpeechCaptureConflictError) {
      return apiFailure(context, 409, 'SPEECH_CONFLICT', 'Реплики пришли не по порядку.');
    }
    if (error instanceof SpeechProviderError) {
      const status = error.code === 'invalid_audio' ? 400 : 503;
      return apiFailure(
        context,
        status,
        `SPEECH_${error.code.toUpperCase()}`,
        error.code === 'invalid_audio'
          ? 'Локальная модель не приняла эту реплику.'
          : 'Локальная модель временно недоступна.',
      );
    }
    return apiFailure(context, 500, 'TRANSCRIPTION_FAILED', 'Не удалось распознать реплику.');
  }
}
