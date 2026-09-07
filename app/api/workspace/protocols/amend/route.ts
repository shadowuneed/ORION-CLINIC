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
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  D1ProtocolAmendmentRepository,
  ProtocolAmendmentConflictError,
  ProtocolAmendmentConsentRequiredError,
  ProtocolAmendmentLifecycleError,
  ProtocolAmendmentNotFoundError,
  ProtocolAmendmentSourceChangedError,
} from '@/lib/repositories/protocol-amendment';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z.object({
  encounterId: z.string().min(1).max(100),
  baseProtocolId: z.string().min(1).max(100),
  expectedProtocolVersion: z.number().int().positive(),
  expectedProtocolHeadVersion: z.number().int().positive(),
  expectedEncounterVersion: z.number().int().positive(),
  reason: z.string().trim().min(10).max(500),
  text: z.string().trim().min(1).max(8_000),
  acknowledgeClinicianResponsibility: z.literal(true),
  confirmation: z.literal('SIGN_SYNTHETIC_AMENDMENT'),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/protocols/amend',
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
      'EXPLICIT_CONFIRMATION_REQUIRED',
      'Укажите причину, текст корректировки и подтвердите личное подписание.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity),
      payload.encounterId,
    );
    const result = await new D1ProtocolAmendmentRepository(
      env.DB,
      access.scope,
    ).amend({
      baseProtocolId: payload.baseProtocolId,
      expectedProtocolVersion: payload.expectedProtocolVersion,
      expectedProtocolHeadVersion: payload.expectedProtocolHeadVersion,
      expectedEncounterVersion: payload.expectedEncounterVersion,
      reason: payload.reason,
      text: payload.text,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(context, { ...result, persistence: 'local-d1' }, 201);
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
        'Корректировку может подписать только назначенный врач.',
      );
    }
    if (
      error instanceof AccessibleEncounterNotFoundError ||
      error instanceof ProtocolAmendmentNotFoundError
    ) {
      return apiFailure(
        context,
        404,
        'SIGNED_PROTOCOL_NOT_FOUND',
        'Подписанный протокол не найден или недоступен.',
      );
    }
    if (error instanceof ProtocolAmendmentConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'CARE_CONSENT_REQUIRED',
        'По текущей синтетической политике требуется действующее решение о приёме.',
      );
    }
    if (error instanceof ProtocolAmendmentSourceChangedError) {
      return apiFailure(
        context,
        409,
        'PROTOCOL_SOURCE_CHANGED',
        'Исходный подписанный протокол изменился или не прошёл контроль целостности.',
      );
    }
    if (error instanceof ProtocolAmendmentLifecycleError) {
      return apiFailure(
        context,
        422,
        'PROTOCOL_NOT_FINALIZED',
        'Корректировка доступна только после подписания протокола.',
      );
    }
    if (error instanceof ProtocolAmendmentConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Протокол уже изменился. Обновите приём и повторите.',
      );
    }

    return apiFailure(
      context,
      500,
      'PROTOCOL_AMENDMENT_FAILED',
      'Не удалось сохранить и подписать корректировку.',
    );
  }
}
