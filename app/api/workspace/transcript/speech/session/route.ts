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

const startSchema = z.object({
  encounterId: z.string().min(1).max(100),
  doctorFirst: z.literal(true),
});
const finishSchema = z.object({
  encounterId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(120),
  status: z.enum(['completed', 'cancelled']).default('completed'),
});

async function parseAccess(request: Request, encounterId: string) {
  const identity = getSiteIdentity(request);
  if (!identity) return null;
  const access = await resolveClinicianWorkspaceAccess(
    new D1WorkspaceAccessRepository(env.DB),
    toSiteIdentityPrincipal(identity),
    encounterId,
  );
  return { identity, access };
}

function knownFailure(
  context: ReturnType<typeof createApiRequestContext>,
  error: unknown,
) {
  if (error instanceof MembershipRequiredError || error instanceof ClinicianRoleRequiredError) {
    return apiFailure(context, 403, 'FORBIDDEN', 'Речевой контур доступен назначенному врачу.');
  }
  if (error instanceof AccessibleEncounterNotFoundError || error instanceof SpeechCaptureNotFoundError) {
    return apiFailure(context, 404, 'NOT_FOUND', 'Приём или речевая сессия не найдены.');
  }
  if (error instanceof SpeechCaptureConsentRequiredError) {
    return apiFailure(
      context,
      409,
      'SPEECH_CONSENT_REQUIRED',
      'Нужны согласия на приём, локальную обработку аудио и хранение расшифровки.',
    );
  }
  if (error instanceof SpeechCaptureLifecycleError) {
    return apiFailure(context, 422, 'SPEECH_NOT_AVAILABLE', 'Распознавание доступно только во время приёма.');
  }
  if (error instanceof SpeechCaptureConflictError) {
    return apiFailure(context, 409, 'SPEECH_CONFLICT', 'Состояние речевой сессии изменилось.');
  }
  if (error instanceof SpeechProviderError) {
    return apiFailure(
      context,
      503,
      error.code === 'not_ready' ? 'SPEECH_MODEL_LOADING' : 'SPEECH_PROVIDER_UNAVAILABLE',
      error.code === 'not_ready'
        ? 'Локальная модель ещё загружается.'
        : 'Локальный речевой сервис недоступен.',
    );
  }
  return null;
}

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/transcript/speech/session',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  if (!getSiteIdentity(request)) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
  }
  const parsed = startSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(context, 400, 'INVALID_REQUEST', 'Некорректный запуск микрофона.');
  }

  try {
    parseRuntimeConfig(env);
    const config = parseClinicalProviderConfig(env);
    const resolved = await parseAccess(request, parsed.data.encounterId);
    if (!resolved) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
    }
    const repository = new D1TranscriptIngestionRepository(
      env.DB,
      resolved.access.scope,
    );
    const consentEventIds = await repository.preflightStart();
    const provider = new LocalGigaamProvider({
      baseUrl: config.localSpeech.baseUrl,
      model: config.localSpeech.model,
    });
    const health = await provider.health(AbortSignal.timeout(5_000));
    if (!health.ready) {
      throw new SpeechProviderError(
        health.reachable ? 'not_ready' : 'unavailable',
      );
    }
    const speechSession = await provider.createSession({
      doctorFirst: true,
      signal: AbortSignal.timeout(10_000),
    });
    try {
      const session = await repository.persistStartedSession({
        speechSession,
        consentEventIds,
        actorId: resolved.access.user.id,
        requestId: context.requestId,
      });
      return apiSuccess(context, { session, audioRetention: false }, 201);
    } catch (error) {
      await provider.deleteSession(speechSession.upstreamSessionId).catch(() => undefined);
      throw error;
    }
  } catch (error) {
    return (
      knownFailure(context, error) ??
      apiFailure(context, 500, 'SPEECH_SESSION_FAILED', 'Не удалось начать локальное распознавание.')
    );
  }
}

export async function DELETE(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/transcript/speech/session',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  if (!getSiteIdentity(request)) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
  }
  const parsed = finishSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return apiFailure(context, 400, 'INVALID_REQUEST', 'Некорректная речевая сессия.');
  }

  try {
    parseRuntimeConfig(env);
    const config = parseClinicalProviderConfig(env);
    const resolved = await parseAccess(request, parsed.data.encounterId);
    if (!resolved) {
      return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
    }
    const repository = new D1TranscriptIngestionRepository(
      env.DB,
      resolved.access.scope,
    );
    const upstreamSessionId = await repository.getUpstreamSessionId(
      parsed.data.sessionId,
    );
    const provider = new LocalGigaamProvider({
      baseUrl: config.localSpeech.baseUrl,
      model: config.localSpeech.model,
    });
    const providerCleanup = await provider
      .deleteSession(upstreamSessionId, AbortSignal.timeout(5_000))
      .then(() => 'completed' as const)
      .catch(() => 'deferred' as const);
    await repository.finishSession(parsed.data.sessionId, parsed.data.status);
    return apiSuccess(context, {
      sessionId: parsed.data.sessionId,
      status: parsed.data.status,
      providerCleanup,
    });
  } catch (error) {
    return (
      knownFailure(context, error) ??
      apiFailure(context, 500, 'SPEECH_SESSION_FINISH_FAILED', 'Не удалось завершить распознавание.')
    );
  }
}
