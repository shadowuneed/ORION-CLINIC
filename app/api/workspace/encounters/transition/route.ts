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
  D1EncounterLifecycleRepository,
  EncounterCareConsentRequiredError,
  EncounterLifecycleNotFoundError,
  EncounterTransitionConflictError,
  EncounterTransitionValidationError,
} from '@/lib/repositories/encounter-lifecycle';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z.object({
  encounterId: z.string().min(1).max(100),
  nextStatus: z.enum(['ready', 'in_progress']),
  expectedVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/encounters/transition',
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

  let payload: z.infer<typeof commandSchema>;
  try {
    payload = commandSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_REQUEST',
      'Проверьте статус приёма и повторите.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.encounterId,
    );
    const transition = await new D1EncounterLifecycleRepository(
      env.DB,
      access.scope,
    ).recordTransition({
      nextStatus: payload.nextStatus,
      expectedVersion: payload.expectedVersion,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(context, { transition, persistence: 'local-d1' });
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
        'Статус приёма может менять только назначенный врач.',
      );
    }
    if (
      error instanceof AccessibleEncounterNotFoundError ||
      error instanceof EncounterLifecycleNotFoundError
    ) {
      return apiFailure(
        context,
        404,
        'ENCOUNTER_NOT_FOUND',
        'Приём не найден или недоступен.',
      );
    }
    if (error instanceof EncounterCareConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'CARE_CONSENT_REQUIRED',
        'Сначала зафиксируйте действующее решение пациента о приёме.',
      );
    }
    if (error instanceof EncounterTransitionConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Статус приёма уже изменился. Обновите данные.',
      );
    }
    if (error instanceof EncounterTransitionValidationError) {
      return apiFailure(
        context,
        422,
        'INVALID_ENCOUNTER_TRANSITION',
        'Такой переход статуса сейчас недоступен.',
      );
    }

    return apiFailure(
      context,
      500,
      'ENCOUNTER_TRANSITION_FAILED',
      'Не удалось изменить статус приёма.',
    );
  }
}
