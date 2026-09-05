import { env } from 'cloudflare:workers';
import { resolveCommunicationAccess } from '@/lib/auth/communication-access';
import { getSiteIdentity, toSiteIdentityPrincipal } from '@/lib/auth/site-identity';
import { parseRuntimeConfig } from '@/lib/config/runtime';
import { recordChannelConsentSchema } from '@/lib/domain/patient-communications';
import { apiFailure, apiSuccess, createApiRequestContext, hasSameOrigin } from '@/lib/http/api-response';
import { communicationApiFailure } from '@/lib/http/communication-api-errors';
import { D1PatientCommunicationsRepository } from '@/lib/repositories/patient-communications';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const context = createApiRequestContext(request, '/api/communications/consents');
  if (!hasSameOrigin(request)) {
    return apiFailure(context, 403, 'INVALID_ORIGIN', 'Запрос отклонён.');
  }
  let payload;
  try {
    payload = recordChannelConsentSchema.parse(await request.json());
  } catch {
    return apiFailure(
      context,
      400,
      'INVALID_CHANNEL_CONSENT',
      'Проверьте канал, язык, решение пациента и версию.',
    );
  }
  try {
    if (!parseRuntimeConfig(env).syntheticDataOnly) {
      return apiFailure(context, 503, 'DATA_MODE_NOT_APPROVED', 'Тестовые согласия отключены.');
    }
    const identity = getSiteIdentity(request);
    if (!identity) return apiFailure(context, 401, 'UNAUTHENTICATED', 'Требуется вход.');
    const access = await resolveCommunicationAccess(
      new D1WorkspaceAccessRepository(env.DB),
      toSiteIdentityPrincipal(identity),
      payload.facilityId,
    );
    const consent = await new D1PatientCommunicationsRepository(
      env.DB,
      access.scope,
    ).recordChannelConsent({
      patientId: payload.patientId,
      channel: payload.channel,
      decision: payload.decision,
      preferredLanguage: payload.preferredLanguage,
      destinationRef: payload.destinationRef,
      destinationHint: payload.destinationHint,
      destinationVerified: payload.destinationVerified,
      source: payload.source,
      expectedVersion: payload.expectedVersion,
      noticeVersion: payload.noticeVersion,
      noticeHash: payload.noticeHash,
      reason: payload.reason,
      idempotencyKey: payload.idempotencyKey,
      requestId: context.requestId,
    });
    return apiSuccess(context, { consent, persistence: 'd1' }, 201);
  } catch (error) {
    return communicationApiFailure(context, error, 'CHANNEL_CONSENT_FAILED', 'Не удалось сохранить решение пациента по каналу.');
  }
}
