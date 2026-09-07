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
  clinicalSectionCodes,
  ClinicalSectionConflictError,
  ClinicalSectionNotFoundError,
  ClinicalSectionValidationError,
  ClinicalSectionCareConsentRequiredError,
  D1ClinicalSectionRepository,
} from '@/lib/repositories/clinical-sections';
import { D1ConsentRepository } from '@/lib/repositories/consent';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

const commandSchema = z
  .object({
    encounterId: z.string().min(1).max(100),
    sectionCode: z.enum(clinicalSectionCodes),
    action: z.enum(['save_draft', 'mark_reviewed', 'mark_absent']),
    content: z.string().max(12_000).optional(),
    expectedVersion: z.number().int().positive(),
    idempotencyKey: z.string().uuid(),
  })
  .superRefine((value, context) => {
    if (value.action !== 'mark_absent' && typeof value.content !== 'string') {
      context.addIssue({
        code: 'custom',
        path: ['content'],
        message: 'Content is required for this action',
      });
    }
  });

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/sections/command',
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
      'Проверьте содержимое раздела и повторите.',
    );
  }

  try {
    parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
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
    const repository = new D1ClinicalSectionRepository(env.DB, access.scope);
    const section = await repository.recordCommand({
      sectionCode: payload.sectionCode,
      action: payload.action,
      content: payload.content,
      expectedVersion: payload.expectedVersion,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(context, { section, persistence: 'local-d1' });
  } catch (error) {
    const assignmentFailure = workspaceAssignmentFailure(context, error);
    if (assignmentFailure) return assignmentFailure;
    if (error instanceof ClinicalSectionCareConsentRequiredError) {
      return apiFailure(context, 409, 'CARE_CONSENT_REQUIRED',
        'Сначала зафиксируйте действующее решение пациента о приёме.');
    }
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
        'Изменять запись может только назначенный врач.',
      );
    }
    if (error instanceof AccessibleEncounterNotFoundError) {
      return apiFailure(
        context,
        404,
        'NOT_FOUND',
        'Раздел не найден.',
      );
    }
    if (error instanceof ClinicalSectionNotFoundError) {
      return apiFailure(context, 404, 'NOT_FOUND', 'Раздел не найден.');
    }
    if (error instanceof ClinicalSectionConflictError) {
      return apiFailure(
        context,
        409,
        'VERSION_CONFLICT',
        'Раздел уже изменён. Ваш текст сохранён на экране.',
      );
    }
    if (error instanceof ClinicalSectionValidationError) {
      return apiFailure(
        context,
        422,
        'SECTION_NOT_REVIEWABLE',
        'Раздел нельзя подтвердить в текущем состоянии.',
      );
    }

    return apiFailure(
      context,
      500,
      'SECTION_COMMAND_FAILED',
      'Не удалось сохранить изменение раздела.',
    );
  }
}
