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
import { parseClinicalProviderConfig } from '@/lib/config/clinical-providers';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
} from '@/lib/http/api-response';
import { LocalGigaamProvider } from '@/lib/providers/local-gigaam';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  const context = createApiRequestContext(
    request,
    '/api/workspace/transcript/speech/health',
  );
  const identity = getSiteIdentity(request);
  if (!identity) {
    return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход врача.');
  }
  const encounterId = z
    .string()
    .min(1)
    .max(100)
    .safeParse(new URL(request.url).searchParams.get('encounterId'));
  if (!encounterId.success) {
    return apiFailure(context, 400, 'INVALID_REQUEST', 'Некорректный приём.');
  }

  try {
    parseRuntimeConfig(env);
    const config = parseClinicalProviderConfig(env);
    await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity),
      encounterId.data,
    );
    const health = await new LocalGigaamProvider({
      baseUrl: config.localSpeech.baseUrl,
      model: config.localSpeech.model,
    }).health(AbortSignal.timeout(5_000));
    return apiSuccess(context, { health, audioRetention: false });
  } catch (error) {
    const assignmentFailure = workspaceAssignmentFailure(context, error);
    if (assignmentFailure) return assignmentFailure;
    if (error instanceof MembershipRequiredError) {
      return apiFailure(context, 403, 'MEMBERSHIP_REQUIRED', 'Нет доступа к клинике.');
    }
    if (error instanceof ClinicianRoleRequiredError) {
      return apiFailure(context, 403, 'CLINICIAN_ROLE_REQUIRED', 'Нужна роль врача.');
    }
    if (error instanceof AccessibleEncounterNotFoundError) {
      return apiFailure(context, 404, 'NOT_FOUND', 'Приём не найден.');
    }
    return apiFailure(
      context,
      503,
      'SPEECH_HEALTH_UNAVAILABLE',
      'Не удалось проверить локальный речевой сервис.',
    );
  }
}
