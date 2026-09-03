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
import { D1ConsentRepository } from '@/lib/repositories/consent';
import {
  D1SuggestionReviewRepository,
  SuggestionConsentRequiredError,
  SuggestionConflictError,
  SuggestionEditUnchangedError,
  SuggestionLifecycleError,
  SuggestionNotFoundError,
  SuggestionValidationError,
} from '@/lib/repositories/suggestion-review';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const editSchema = z.object({
  encounterId: z.string().min(1).max(100),
  recommendationId: z.string().min(1).max(100),
  title: z.string().trim().min(1).max(300),
  content: z.string().trim().min(1).max(8000),
  reason: z.string().trim().min(3).max(500),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/recommendations/edit',
  );
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
  }

  let payload: z.infer<typeof editSchema>;
  try {
    payload = editSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_REQUEST',
      'Проверьте текст и основание редакции.',
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
    const recommendation = await new D1SuggestionReviewRepository(
      env.DB,
      access.scope,
    ).createDerivative({
      recommendationId: payload.recommendationId,
      title: payload.title,
      content: payload.content,
      reason: payload.reason,
      expectedVersion: payload.expectedVersion,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });
    return apiSuccess(context, { recommendation, persistence: 'local-d1' });
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
        'Редактировать подсказку может только назначенный врач.',
      );
    }
    if (
      error instanceof AccessibleEncounterNotFoundError ||
      error instanceof SuggestionNotFoundError
    ) {
      return apiFailure(context, 404, 'NOT_FOUND', 'Подсказка не найдена.');
    }
    if (error instanceof SuggestionConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'CARE_CONSENT_REQUIRED',
        'Сначала зафиксируйте действующее решение пациента о приёме.',
      );
    }
    if (error instanceof SuggestionConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Подсказка уже изменилась. Обновите сравнение и повторите.',
      );
    }
    if (error instanceof SuggestionEditUnchangedError) {
      return apiFailure(
        context,
        422,
        'EDIT_CONTENT_UNCHANGED',
        'Редакция совпадает с текущим текстом. Используйте обычное принятие.',
      );
    }
    if (error instanceof SuggestionLifecycleError) {
      return apiFailure(
        context,
        422,
        'RECOMMENDATION_NOT_EDITABLE',
        'После начала проверки протокола подсказки неизменяемы.',
      );
    }
    if (error instanceof SuggestionValidationError) {
      return apiFailure(
        context,
        422,
        'INVALID_EDIT',
        'Проверьте текст и основание редакции.',
      );
    }
    return apiFailure(
      context,
      503,
      'EDIT_UNAVAILABLE',
      'Не удалось сохранить версию врача.',
    );
  }
}
