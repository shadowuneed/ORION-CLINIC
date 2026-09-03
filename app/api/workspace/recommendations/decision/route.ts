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
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  D1SuggestionReviewRepository,
  SuggestionConsentRequiredError,
  SuggestionConflictError,
  SuggestionLifecycleError,
  SuggestionNotFoundError,
} from '@/lib/repositories/suggestion-review';
import { D1ConsentRepository } from '@/lib/repositories/consent';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const decisionSchema = z.object({
  encounterId: z.string().min(1).max(100),
  recommendationId: z.string().min(1).max(100),
  decision: z.enum(['accept', 'reject', 'restore']),
  derivativeVersionId: z.string().min(1).max(150).nullable().optional(),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/recommendations/decision',
  );

  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }

  const identity = getSiteIdentity(request);

  if (!identity) {
    return apiFailure(
      context,
      401,
      'UNAUTHENTICATED',
      'Требуется вход врача.',
    );
  }

  let payload: z.infer<typeof decisionSchema>;
  try {
    payload = decisionSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_REQUEST',
      'Некорректное решение.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.encounterId,
    );
    const hasCareConsent = await new D1ConsentRepository(
      env.DB,
      access.scope,
    ).hasEffectiveConsent('care');
    if (!hasCareConsent) {
      return apiFailure(
        context,
        409,
        'CARE_CONSENT_REQUIRED',
        'Сначала зафиксируйте действующее решение пациента о приёме.',
      );
    }
    const repository = new D1SuggestionReviewRepository(env.DB, access.scope);
    const recommendation = await repository.recordDecision({
      recommendationId: payload.recommendationId,
      derivativeVersionId: payload.derivativeVersionId ?? null,
      decision: payload.decision,
      expectedVersion: payload.expectedVersion,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(
      context,
      { recommendation, persistence: 'local-d1' },
    );
  } catch (error) {
    if (error instanceof MembershipRequiredError) {
      return apiFailure(
        context,
        403,
        'MEMBERSHIP_REQUIRED',
        'Для пользователя не найден активный доступ к клинике.',
      );
    }
    if (error instanceof ClinicianRoleRequiredError) {
      return apiFailure(
        context,
        403,
        'CLINICIAN_ROLE_REQUIRED',
        'Решение может принять только назначенный врач.',
      );
    }
    if (error instanceof AccessibleEncounterNotFoundError) {
      return apiFailure(
        context,
        404,
        'NOT_FOUND',
        'Подсказка не найдена.',
      );
    }
    if (error instanceof SuggestionNotFoundError) {
      return apiFailure(context, 404, 'NOT_FOUND', 'Подсказка не найдена.');
    }

    if (error instanceof SuggestionConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Решение уже изменилось. Обновите данные и повторите.',
      );
    }

    if (error instanceof SuggestionConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'CARE_CONSENT_REQUIRED',
        'Сначала зафиксируйте действующее решение пациента о приёме.',
      );
    }

    if (error instanceof SuggestionLifecycleError) {
      return apiFailure(
        context,
        422,
        'RECOMMENDATION_NOT_EDITABLE',
        'После подписания решения по подсказкам неизменяемы. Создайте корректировку протокола.',
      );
    }

    return apiFailure(
      context,
      503,
      'DECISION_UNAVAILABLE',
      'Не удалось сохранить решение врача.',
    );
  }
}
