import { workspaceRequestSelection, workspaceAssignmentFailure } from '@/lib/auth/workspace-request-access';
import { env } from 'cloudflare:workers';
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
import { isConsentEffective } from '@/lib/domain/consent';
import {
  apiFailure,
  apiSuccess,
  createApiRequestContext,
} from '@/lib/http/api-response';
import { SYNTHETIC_CONSENT_POLICY } from '@/lib/policies/synthetic-consent';
import {
  AccessAuditRequestConflictError,
  AccessAuditUnavailableError,
  D1AccessAuditRepository,
} from '@/lib/repositories/access-audit';
import { D1ClinicalSectionRepository } from '@/lib/repositories/clinical-sections';
import { D1ConsentRepository } from '@/lib/repositories/consent';
import { D1DocumentExportRepository } from '@/lib/repositories/document-export';
import { D1EncounterRecoveryRepository } from '@/lib/repositories/encounter-recovery';
import { D1ProtocolAmendmentRepository } from '@/lib/repositories/protocol-amendment';
import { D1ProtocolReviewRepository } from '@/lib/repositories/protocol-review';
import { D1SuggestionReviewRepository } from '@/lib/repositories/suggestion-review';
import { D1TranscriptRepository } from '@/lib/repositories/transcript';
import { D1WorkspaceAccessRepository } from '@/lib/repositories/workspace-access';

export const dynamic = 'force-dynamic';

class WorkspaceSnapshotChangedError extends Error {}

export async function GET(request: Request) {
  const context = createApiRequestContext(request, '/api/workspace');
  const identity = getSiteIdentity(request);

  if (!identity) {
    return apiFailure(
      context,
      401,
      'UNAUTHENTICATED',
      'Требуется вход врача.',
    );
  }

  const requestedEncounterId = new URL(request.url).searchParams
    .get('encounterId')
    ?.trim();

  if (requestedEncounterId && requestedEncounterId.length > 100) {
    return apiFailure(
      context,
      400,
      'INVALID_REQUEST',
      'Некорректный идентификатор приёма.',
    );
  }

  try {
    const config = parseRuntimeConfig(env);
    const access = await resolveClinicianWorkspaceAccess(
      new D1WorkspaceAccessRepository(env.DB, workspaceRequestSelection(request)),
      toSiteIdentityPrincipal(identity),
      requestedEncounterId,
    );
    const recommendationRepository = new D1SuggestionReviewRepository(
      env.DB,
      access.scope,
    );
    const sectionRepository = new D1ClinicalSectionRepository(
      env.DB,
      access.scope,
    );
    const transcriptRepository = new D1TranscriptRepository(
      env.DB,
      access.scope,
    );
    const consentRepository = new D1ConsentRepository(env.DB, access.scope);
    const protocolRepository = new D1ProtocolReviewRepository(
      env.DB,
      access.scope,
    );
    const amendmentRepository = new D1ProtocolAmendmentRepository(
      env.DB,
      access.scope,
    );
    const documentRepository = new D1DocumentExportRepository(
      env.DB,
      access.scope,
    );
    const recoveryRepository = new D1EncounterRecoveryRepository(
      env.DB,
      access.scope,
    );
    const loadCurrentResources = async () => {
      const [
        recommendations,
        clinicalSections,
        consents,
        protocolDraft,
        amendments,
        exports,
      ] = await Promise.all([
        recommendationRepository.list(),
        sectionRepository.list(),
        consentRepository.listCurrent(),
        protocolRepository.getCurrentSummary(),
        amendmentRepository.list(),
        documentRepository.listCurrentArtifacts(),
      ]);
      const transcriptConsent = consents.find(
        (consent) => consent.type === 'transcript_storage',
      );
      const canReadTranscript = isConsentEffective(transcriptConsent);
      const transcript = canReadTranscript
        ? await transcriptRepository.listCurrent()
        : [];

      return {
        recommendations,
        clinicalSections,
        consents,
        protocolDraft,
        amendments,
        exports,
        canReadTranscript,
        transcript,
      };
    };

    let resources: Awaited<ReturnType<typeof loadCurrentResources>> | null = null;
    let serverSnapshot: Awaited<
      ReturnType<typeof recoveryRepository.getServerSnapshot>
    > = null;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const before = await recoveryRepository.getServerSnapshot();
      if (!before) throw new AccessibleEncounterNotFoundError();
      const current = await loadCurrentResources();
      const after = await recoveryRepository.getServerSnapshot();
      if (!after) throw new AccessibleEncounterNotFoundError();

      if (before.revision === after.revision) {
        resources = current;
        serverSnapshot = after;
        break;
      }
    }

    if (!resources || !serverSnapshot) {
      throw new WorkspaceSnapshotChangedError(
        'Workspace state changed during recovery read',
      );
    }

    const {
      recommendations,
      clinicalSections,
      consents,
      protocolDraft,
      amendments,
      exports,
      canReadTranscript,
      transcript,
    } = resources;

    if (clinicalSections.length !== 8) {
      throw new Error('Clinical section set is incomplete');
    }

    const accessAudit = await new D1AccessAuditRepository(
      env.DB,
      access.scope,
    ).recordWorkspaceRead({
      actorId: access.user.id,
      requestId: context.requestId,
    });

    return apiSuccess(
      context,
      {
        environment: config.environment,
        dataMode: 'synthetic-only',
        persistence: 'local-d1',
        viewer: {
          id: access.user.id,
          displayName: access.user.displayName,
          role: access.membership.role,
        },
        organization: {
          id: access.membership.organizationId,
          name: access.membership.organizationName,
        },
        facility: {
          id: access.membership.facilityId,
          name: access.membership.facilityName,
        },
        encounter: {
          ...access.encounter,
          status: serverSnapshot.status,
          version: serverSnapshot.encounterVersion,
          startedAt: serverSnapshot.startedAt,
          updatedAt: serverSnapshot.statusUpdatedAt,
        },
        encounters: access.encounters.map((encounter) =>
          encounter.id === serverSnapshot.encounterId
            ? {
                ...encounter,
                status: serverSnapshot.status,
                version: serverSnapshot.encounterVersion,
                startedAt: serverSnapshot.startedAt,
                updatedAt: serverSnapshot.statusUpdatedAt,
              }
            : encounter,
        ),
        recovery: serverSnapshot.resumable
          ? {
              source: 'server-d1' as const,
              encounterId: serverSnapshot.encounterId,
              status: serverSnapshot.status as 'in_progress' | 'review',
              encounterVersion: serverSnapshot.encounterVersion,
              startedAt: serverSnapshot.startedAt,
              revision: serverSnapshot.revision,
              saved: {
                ...serverSnapshot.saved,
                transcriptSegmentCount: canReadTranscript
                  ? serverSnapshot.saved.transcriptSegmentCount
                  : null,
              },
              browserDraftsIncluded: false as const,
            }
          : null,
        consents,
        consentPolicy: SYNTHETIC_CONSENT_POLICY,
        transcriptAccess: canReadTranscript ? 'granted' : 'consent-required',
        transcript,
        recommendations,
        clinicalSections,
        protocolDraft,
        amendments,
        exports,
        accessAudit,
      },
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
        'Клиническая запись доступна только назначенному врачу.',
      );
    }
    if (error instanceof AccessibleEncounterNotFoundError) {
      return apiFailure(
        context,
        404,
        'ENCOUNTER_NOT_FOUND',
        'Приём не найден или недоступен.',
      );
    }
    if (error instanceof WorkspaceSnapshotChangedError) {
      return apiFailure(
        context,
        409,
        'WORKSPACE_STATE_CHANGED',
        'Состояние приёма изменилось во время загрузки. Повторите проверку.',
      );
    }
    if (
      error instanceof AccessAuditUnavailableError ||
      error instanceof AccessAuditRequestConflictError
    ) {
      return apiFailure(
        context,
        503,
        'ACCESS_AUDIT_UNAVAILABLE',
        'Не удалось зафиксировать доступ. Запись не открыта.',
      );
    }
    return apiFailure(
      context,
      503,
      'WORKSPACE_UNAVAILABLE',
      'Серверное состояние приёма временно недоступно.',
    );
  }
}
