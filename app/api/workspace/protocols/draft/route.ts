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
  D1ProtocolReviewRepository,
  ProtocolReviewConflictError,
  ProtocolReviewConsentRequiredError,
  ProtocolReviewLifecycleError,
  ProtocolReviewNotFoundError,
  ProtocolReviewReadinessError,
  ProtocolTranscriptReadinessError,
} from '@/lib/repositories/protocol-review';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z.object({
  encounterId: z.string().min(1).max(100),
  expectedEncounterVersion: z.number().int().positive(),
  idempotencyKey: z.string().uuid(),
});

const sectionNames = {
  complaints: 'жалобы',
  history_of_present_illness: 'анамнез заболевания',
  past_medical_history: 'анамнез жизни',
  allergy_status: 'аллергологический статус',
  objective_findings: 'объективные данные',
  preliminary_diagnosis: 'предварительный диагноз',
  examination_plan: 'план обследования',
  treatment_plan: 'план лечения',
} as const;

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/protocols/draft',
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
      'Проверьте версию приёма и повторите.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity),
      payload.encounterId,
    );
    const result = await new D1ProtocolReviewRepository(
      env.DB,
      access.scope,
    ).beginReview({
      expectedEncounterVersion: payload.expectedEncounterVersion,
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
        'Черновик протокола может создать только назначенный врач.',
      );
    }
    if (
      error instanceof AccessibleEncounterNotFoundError ||
      error instanceof ProtocolReviewNotFoundError
    ) {
      return apiFailure(
        context,
        404,
        'ENCOUNTER_NOT_FOUND',
        'Приём не найден или недоступен.',
      );
    }
    if (error instanceof ProtocolReviewConsentRequiredError) {
      return apiFailure(
        context,
        409,
        'CARE_CONSENT_REQUIRED',
        'Сначала зафиксируйте действующее решение пациента о приёме.',
      );
    }
    if (error instanceof ProtocolReviewReadinessError) {
      return apiFailure(
        context,
        422,
        'CLINICAL_SECTIONS_UNRESOLVED',
        `Нужно проверить обязательные разделы: ${error.unresolved.map((code) => sectionNames[code]).join(', ')}.`,
      );
    }
    if (error instanceof ProtocolTranscriptReadinessError) {
      return apiFailure(
        context,
        422,
        'TRANSCRIPT_UNRESOLVED',
        `Подтвердите говорящего и финальный текст реплик: ${error.unresolvedSegmentIndexes.join(', ')}.`,
      );
    }
    if (error instanceof ProtocolReviewLifecycleError) {
      return apiFailure(
        context,
        422,
        'INVALID_ENCOUNTER_TRANSITION',
        'К проверке можно перейти только из активного приёма.',
      );
    }
    if (error instanceof ProtocolReviewConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Исходные данные изменились. Обновите приём и повторите.',
      );
    }

    return apiFailure(
      context,
      500,
      'PROTOCOL_DRAFT_FAILED',
      'Не удалось создать черновик протокола.',
    );
  }
}
