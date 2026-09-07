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
  D1TranscriptRepository,
  TranscriptConflictError,
  TranscriptConsentRequiredError,
  TranscriptLifecycleError,
  TranscriptNotFoundError,
} from '@/lib/repositories/transcript';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z.object({
  encounterId: z.string().min(1).max(100),
  segmentId: z.string().min(1).max(100),
  expectedVersion: z.number().int().positive(),
  text: z.string().trim().min(1).max(8_000),
  role: z.enum(['doctor', 'patient', 'other', 'unknown']),
  language: z.enum(['ru', 'kk', 'mixed', 'unknown']),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/transcript/correct',
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
      'Проверьте текст, язык и роль говорящего.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity),
      payload.encounterId,
    );
    const segment = await new D1TranscriptRepository(
      env.DB,
      access.scope,
    ).correct({
      segmentId: payload.segmentId,
      expectedVersion: payload.expectedVersion,
      text: payload.text,
      role: payload.role,
      language: payload.language,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(context, { segment, persistence: 'local-d1' });
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
        'Расшифровку может исправлять только назначенный врач.',
      );
    }
    if (
      error instanceof AccessibleEncounterNotFoundError ||
      error instanceof TranscriptNotFoundError
    ) {
      return apiFailure(
        context,
        404,
        'TRANSCRIPT_SEGMENT_NOT_FOUND',
        'Сегмент не найден или недоступен.',
      );
    }
    if (error instanceof TranscriptConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'TRANSCRIPT_CONSENT_REQUIRED',
        'Нужны действующие решения пациента о приёме и хранении расшифровки.',
      );
    }
    if (error instanceof TranscriptLifecycleError) {
      return apiFailure(
        context,
        422,
        'TRANSCRIPT_NOT_EDITABLE',
        'Подписанная расшифровка неизменяема. Создайте корректировку протокола.',
      );
    }
    if (error instanceof TranscriptConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Сегмент уже изменён. Обновите расшифровку.',
      );
    }

    return apiFailure(
      context,
      500,
      'TRANSCRIPT_CORRECTION_FAILED',
      'Не удалось сохранить исправление расшифровки.',
    );
  }
}
