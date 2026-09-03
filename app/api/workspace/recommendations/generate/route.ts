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
import {
  ClinicalAnalysisProviderError,
  GroqClinicalAnalysisProvider,
} from '@/lib/providers/groq-clinical-analysis';
import {
  ClinicalAnalysisCommandConflictError,
  ClinicalAnalysisCommitError,
  ClinicalAnalysisConsentRequiredError,
  ClinicalAnalysisLifecycleError,
  ClinicalAnalysisSnapshotConflictError,
  D1ClinicalAnalysisRepository,
  type PreparedClinicalAnalysis,
} from '@/lib/repositories/clinical-analysis';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z.object({
  encounterId: z.string().min(1).max(100),
  snapshot: z
    .array(
      z.object({
        id: z.string().min(1).max(100),
        version: z.number().int().positive(),
      }),
    )
    .min(1)
    .max(24),
  acknowledged: z.literal(true),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/recommendations/generate',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
  }
  const payload = commandSchema.safeParse(await request.json().catch(() => null));
  if (!payload.success) {
    return apiFailure(
      context,
      400,
      'INVALID_REQUEST',
      'Подтвердите точную текущую версию расшифровки.',
    );
  }

  let prepared: PreparedClinicalAnalysis | null = null;
  let repository: D1ClinicalAnalysisRepository | null = null;
  try {
    parseRuntimeConfig(env);
    const config = parseClinicalProviderConfig(env);
    if (!config.groq.apiKey) {
      return apiFailure(
        context,
        503,
        'AI_NOT_CONFIGURED',
        'Groq не настроен. Добавьте новый ключ как серверный секрет.',
      );
    }
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.data.encounterId,
    );
    repository = new D1ClinicalAnalysisRepository(env.DB, access.scope);
    prepared = await repository.prepare({
      snapshot: payload.data.snapshot,
      idempotencyKey: payload.data.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
      acknowledged: true,
      provider: 'groq',
      model: config.groq.model,
      modelVersion: config.groq.model,
    });
    if (prepared.replayRunId) {
      return apiSuccess(context, {
        runId: prepared.replayRunId,
        replay: true,
        message: 'Черновики этого запроса уже сохранены.',
      });
    }
    const provider = new GroqClinicalAnalysisProvider({
      apiKey: config.groq.apiKey,
      model: config.groq.model,
      baseUrl: config.groq.baseUrl,
    });
    const providerResult = await provider.analyze({
      segments: prepared.segments,
      signal: AbortSignal.timeout(30_000),
    });
    const completed = await repository.complete(prepared, providerResult, {
      actorId: access.user.id,
      requestId: context.requestId,
    });
    return apiSuccess(context, {
      ...completed,
      replay: false,
      provider: providerResult.provider,
      model: providerResult.model,
      policyVersion: providerResult.policyVersion,
    });
  } catch (error) {
    if (prepared && repository && !prepared.replayRunId) {
      const errorCode =
        error instanceof ClinicalAnalysisProviderError
          ? `provider_${error.code}`
          : error instanceof ClinicalAnalysisSnapshotConflictError
            ? 'snapshot_changed'
            : error instanceof ClinicalAnalysisConsentRequiredError
              ? 'consent_changed'
              : 'commit_failed';
      await repository.fail(prepared, errorCode).catch(() => undefined);
    }
    if (error instanceof MembershipRequiredError || error instanceof ClinicianRoleRequiredError) {
      return apiFailure(context, 403, 'FORBIDDEN', 'Черновики доступны назначенному врачу.');
    }
    if (error instanceof AccessibleEncounterNotFoundError) {
      return apiFailure(context, 404, 'NOT_FOUND', 'Приём не найден.');
    }
    if (error instanceof ClinicalAnalysisConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'AI_CONSENT_REQUIRED',
        'Нужны согласия на приём, хранение расшифровки и передачу Groq.',
      );
    }
    if (error instanceof ClinicalAnalysisLifecycleError) {
      return apiFailure(context, 422, 'AI_NOT_AVAILABLE', 'Черновики создаются только во время приёма.');
    }
    if (error instanceof ClinicalAnalysisSnapshotConflictError) {
      return apiFailure(
        context,
        409,
        'TRANSCRIPT_SNAPSHOT_CHANGED',
        'Расшифровка изменилась. Проверьте её заново.',
      );
    }
    if (error instanceof ClinicalAnalysisCommandConflictError) {
      return apiFailure(context, 409, 'ANALYSIS_CONFLICT', 'Этот запрос уже выполнялся или изменился.');
    }
    if (error instanceof ClinicalAnalysisProviderError) {
      const message =
        error.code === 'rate_limited'
          ? 'Groq временно ограничил частоту запросов. Повторите позже.'
          : error.code === 'unauthorized'
            ? 'Серверный ключ Groq недействителен.'
            : error.code === 'invalid_response'
              ? 'Ответ Groq не прошёл проверку доказательств и не сохранён.'
              : 'Groq временно недоступен. Расшифровка сохранена.';
      return apiFailure(context, 503, `AI_${error.code.toUpperCase()}`, message);
    }
    if (error instanceof ClinicalAnalysisCommitError) {
      return apiFailure(
        context,
        409,
        'ANALYSIS_COMMIT_BLOCKED',
        'Состояние приёма изменилось; результат ИИ не сохранён.',
      );
    }
    return apiFailure(context, 500, 'ANALYSIS_FAILED', 'Не удалось создать клинические черновики.');
  }
}
