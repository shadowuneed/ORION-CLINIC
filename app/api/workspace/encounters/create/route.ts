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
} from '@/lib/auth/workspace-access';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
  hasSameOrigin,
} from '@/lib/http/api-response';
import {
  D1EncounterCreationRepository,
  EncounterCreationConflictError,
  PotentialPatientDuplicateError,
} from '@/lib/repositories/encounter-creation';
import { resolveEncounterAssignmentAccess } from '@/lib/auth/encounter-assignment-access';
import { D1AccessGovernanceRepository } from '@/lib/repositories/access-governance';

export const dynamic = 'force-dynamic';

const birthDateSchema = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((value) => {
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return (
      !Number.isNaN(parsed.valueOf()) &&
      parsed.toISOString().slice(0, 10) === value &&
      parsed.valueOf() <= Date.now()
    );
  });

const commandSchema = z.object({
  // Accepted only for old clients; never used as authority or as an idempotency input.
  sourceEncounterId: z.string().min(1).max(100).optional(),
  patient: z.object({
    displayName: z
      .string()
      .trim()
      .min(2)
      .max(120)
      .refine((value) => !/[\u0000-\u001f\u007f]/.test(value)),
    birthDate: birthDateSchema.nullable(),
    sexAtBirth: z.enum(['female', 'male', 'unknown', 'not_recorded']),
  }),
  reasonForVisit: z.string().trim().max(500).nullable(),
  syntheticDataAcknowledged: z.literal(true),
  idempotencyKey: z.string().uuid(),
});

export async function POST(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/encounters/create',
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
      'Заполните синтетическую карточку и подтвердите режим тестовых данных.',
    );
  }

  try {
    const config = parseRuntimeConfig(env);
    if (!config.syntheticDataOnly) {
      return apiFailure(
        context,
        503,
        'DATA_MODE_NOT_APPROVED',
        'Создание записей отключено до утверждения production-контура.',
      );
    }

    const access = await resolveEncounterAssignmentAccess(
      new D1AccessGovernanceRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      'encounter.manage',
      workspaceRequestSelection(request),
    );
    const created = await new D1EncounterCreationRepository(
      env.DB,
      { organizationId: access.organization.id, facilityId: access.facility.id,
        reviewerMembershipId: access.membership.id, accessAssignmentId: access.assignmentId,
        accessPermission: 'encounter.manage' },
    ).create({
      patient: payload.patient,
      reasonForVisit: payload.reasonForVisit,
      idempotencyKey: payload.idempotencyKey,
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(
      context,
      { created, dataMode: 'synthetic-only', persistence: 'local-d1' },
      201,
    );
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
        'Создать приём может только врач в текущем локальном контуре.',
      );
    }
    if (error instanceof AccessibleEncounterNotFoundError) {
      return apiFailure(
        context,
        404,
        'SOURCE_ENCOUNTER_NOT_FOUND',
        'Исходный рабочий контекст не найден или недоступен.',
      );
    }
    if (error instanceof PotentialPatientDuplicateError) {
      return apiFailure(
        context,
        409,
        'POTENTIAL_PATIENT_DUPLICATE',
        'Найдена похожая активная тестовая карточка. Автоматическое объединение запрещено.',
      );
    }
    if (error instanceof EncounterCreationConflictError) {
      return apiFailure(
        context,
        409,
        'CREATION_CONFLICT',
        'Команда уже использована с другими данными. Обновите список приёмов.',
      );
    }

    return apiFailure(
      context,
      500,
      'ENCOUNTER_CREATION_FAILED',
      'Не удалось создать синтетический приём.',
    );
  }
}
