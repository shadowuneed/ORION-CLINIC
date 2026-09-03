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
  D1ProtocolSigningRepository,
  ProtocolSigningConflictError,
  ProtocolSigningConsentRequiredError,
  ProtocolSigningLifecycleError,
  ProtocolSigningNotFoundError,
  ProtocolSigningSourceChangedError,
} from '@/lib/repositories/protocol-signing';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z.object({
  encounterId: z.string().min(1).max(100),
  protocolId: z.string().min(1).max(100),
  expectedProtocolVersion: z.number().int().positive(),
  expectedEncounterVersion: z.number().int().positive(),
  expectedProtocolHeadVersion: z.number().int().positive(),
  acknowledgeClinicianResponsibility: z.literal(true),
  confirmation: z.literal('SIGN_SYNTHETIC_PROTOCOL'),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/protocols/sign',
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
      'Подтвердите личную проверку документа перед подписанием.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.encounterId,
    );
    const result = await new D1ProtocolSigningRepository(
      env.DB,
      access.scope,
    ).sign({
      protocolId: payload.protocolId,
      expectedProtocolVersion: payload.expectedProtocolVersion,
      expectedEncounterVersion: payload.expectedEncounterVersion,
      expectedProtocolHeadVersion: payload.expectedProtocolHeadVersion,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(context, { ...result, persistence: 'local-d1' }, 201);
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
        'Протокол может подписать только назначенный врач.',
      );
    }
    if (
      error instanceof AccessibleEncounterNotFoundError ||
      error instanceof ProtocolSigningNotFoundError
    ) {
      return apiFailure(
        context,
        404,
        'PROTOCOL_NOT_FOUND',
        'Черновик протокола не найден или недоступен.',
      );
    }
    if (error instanceof ProtocolSigningConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'CONSENT_CHANGED',
        'Согласие изменилось после создания черновика. Подписание остановлено.',
      );
    }
    if (error instanceof ProtocolSigningSourceChangedError) {
      return apiFailure(
        context,
        409,
        'PROTOCOL_SOURCE_CHANGED',
        'Разделы или расшифровка изменились после создания черновика.',
      );
    }
    if (error instanceof ProtocolSigningLifecycleError) {
      return apiFailure(
        context,
        422,
        'INVALID_ENCOUNTER_TRANSITION',
        'Подписание доступно только на этапе врачебной проверки.',
      );
    }
    if (error instanceof ProtocolSigningConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Документ уже изменился. Обновите приём и повторите.',
      );
    }

    return apiFailure(
      context,
      500,
      'PROTOCOL_SIGNING_FAILED',
      'Не удалось подписать протокол.',
    );
  }
}
