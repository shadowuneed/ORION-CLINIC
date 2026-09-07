import { workspaceRequestSelection, workspaceAssignmentFailure } from '@/lib/auth/workspace-request-access';
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
import { consentTypes } from '@/lib/domain/consent';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import { SYNTHETIC_CONSENT_POLICY } from '@/lib/policies/synthetic-consent';
import {
  ConsentConflictError,
  ConsentEncounterNotFoundError,
  ConsentValidationError,
  D1ConsentRepository,
} from '@/lib/repositories/consent';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z.object({
  encounterId: z.string().min(1).max(100),
  consentType: z.enum(consentTypes),
  decision: z.enum(['granted', 'denied', 'withdrawn']),
  noticeLanguage: z.enum(['ru', 'kk']),
  source: z.enum(['written', 'verbal', 'digital']),
  expectedVersion: z.number().int().nonnegative(),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/consents/command',
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
      'Проверьте решение пациента и повторите.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity),
      payload.encounterId,
    );
    const consent = await new D1ConsentRepository(
      env.DB,
      access.scope,
    ).recordCommand({
      consentType: payload.consentType,
      decision: payload.decision,
      noticeLanguage: payload.noticeLanguage,
      source: payload.source,
      expectedVersion: payload.expectedVersion,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(context, {
      consent,
      policy: SYNTHETIC_CONSENT_POLICY,
      persistence: 'local-d1',
    });
  } catch (error) {
    const assignmentFailure = workspaceAssignmentFailure(context, error);
    if (assignmentFailure) return assignmentFailure;
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
        'Решение пациента может фиксировать только назначенный врач.',
      );
    }
    if (
      error instanceof AccessibleEncounterNotFoundError ||
      error instanceof ConsentEncounterNotFoundError
    ) {
      return apiFailure(
        context,
        404,
        'NOT_FOUND',
        'Приём не найден или недоступен.',
      );
    }
    if (error instanceof ConsentConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Решение о согласии уже изменилось. Обновите данные.',
      );
    }
    if (error instanceof ConsentValidationError) {
      return apiFailure(
        context,
        422,
        'INVALID_CONSENT_TRANSITION',
        'Отозвать можно только ранее предоставленное согласие.',
      );
    }

    return apiFailure(
      context,
      500,
      'CONSENT_COMMAND_FAILED',
      'Не удалось сохранить решение пациента.',
    );
  }
}
