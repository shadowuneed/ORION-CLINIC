import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { assertCurrentEncounterReadAccess } from '@/lib/auth/encounter-read-access';
import {
  encounterStatusSchema,
  isEncounterResumable,
  type EncounterStatus,
} from '@/lib/domain/encounter';

type EncounterRow = {
  encounterId: string;
  status: EncounterStatus;
  version: number;
  startedAt: number | null;
  statusUpdatedAt: number;
};

type ConsentHeadRow = {
  consentType: string;
  currentConsentEventId: string;
  lockVersion: number;
  decision: string;
  eventVersion: number;
  effectiveAt: number;
  expiresAt: number | null;
  updatedAt: number;
};

type TranscriptLeafRow = {
  id: string;
  segmentIndex: number;
  version: number;
  state: string;
  role: string;
  language: string;
  createdAt: number;
};

type ClinicalSectionHeadRow = {
  code: string;
  currentVersionId: string;
  lockVersion: number;
  reviewState: string;
  contentVersion: number;
  updatedAt: number;
};

type RecommendationHeadRow = {
  suggestionId: string;
  state: string;
  currentDecisionId: string | null;
  lockVersion: number;
  currentDerivativeVersionId: string | null;
  derivativeLockVersion: number | null;
  reviewUpdatedAt: number;
  derivativeUpdatedAt: number | null;
};

type ProtocolHeadRow = {
  currentProtocolVersionId: string;
  currentSignedProtocolVersionId: string | null;
  lockVersion: number;
  protocolVersion: number;
  protocolStatus: 'draft' | 'signed';
  sourceHash: string;
  updatedAt: number;
};

type ProtocolAmendmentRow = {
  id: string;
  baseProtocolVersionId: string;
  amendedProtocolVersionId: string;
  createdAt: number;
};

type DocumentArtifactRow = {
  id: string;
  protocolVersionId: string;
  kind: string;
  objectKey: string;
  sha256: string;
  byteSize: number;
  createdAt: number;
};

export type ServerEncounterRecoverySnapshot = {
  encounterId: string;
  status: EncounterStatus;
  encounterVersion: number;
  startedAt: number | null;
  statusUpdatedAt: number;
  resumable: boolean;
  revision: string;
  saved: {
    transcriptSegmentCount: number;
    clinicalSectionCount: number;
    reviewedClinicalSectionCount: number;
    acceptedRecommendationCount: number;
    protocolVersion: number | null;
    protocolStatus: 'draft' | 'signed' | null;
    amendmentCount: number;
    exportArtifactCount: number;
  };
};

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function rows<T>(result: D1Result<unknown>): T[] {
  return result.results as T[];
}

export class D1EncounterRecoveryRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async getServerSnapshot(): Promise<ServerEncounterRecoverySnapshot | null> {
    await assertCurrentEncounterReadAccess(this.database, this.scope);
    const results = await this.database.batch([
      this.database
        .prepare(`
          select encounter.id as encounterId, encounter.status,
            encounter.version, encounter.started_at as startedAt,
            encounter.updated_at as statusUpdatedAt
          from encounters encounter
          join memberships membership
            on membership.organization_id = encounter.organization_id
            and membership.facility_id = encounter.facility_id
            and membership.id = encounter.clinician_membership_id
            and membership.status = 'active'
          where encounter.organization_id = ?1
            and encounter.facility_id = ?2
            and encounter.id = ?3
            and encounter.clinician_membership_id = ?4
        `)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          this.scope.reviewerMembershipId,
        ),
      this.database
        .prepare(`
          select head.consent_type as consentType,
            head.current_consent_event_id as currentConsentEventId,
            head.lock_version as lockVersion, event.decision,
            event.version as eventVersion, event.effective_at as effectiveAt,
            event.expires_at as expiresAt, head.updated_at as updatedAt
          from consent_heads head
          join consent_events event
            on event.organization_id = head.organization_id
            and event.facility_id = head.facility_id
            and event.patient_id = head.patient_id
            and event.encounter_id = head.encounter_id
            and event.consent_type = head.consent_type
            and event.id = head.current_consent_event_id
          where head.organization_id = ?1 and head.facility_id = ?2
            and head.encounter_id = ?3
          order by head.consent_type
        `)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
        ),
      this.database
        .prepare(`
          select segment.id, segment.segment_index as segmentIndex,
            segment.version, segment.state, segment.speaker_role as role,
            segment.language_code as language, segment.created_at as createdAt
          from transcript_segments segment
          where segment.organization_id = ?1 and segment.facility_id = ?2
            and segment.encounter_id = ?3
            and not exists (
              select 1 from transcript_segments successor
              where successor.organization_id = segment.organization_id
                and successor.facility_id = segment.facility_id
                and successor.encounter_id = segment.encounter_id
                and successor.supersedes_segment_id = segment.id
            )
          order by segment.segment_index, segment.version, segment.id
        `)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
        ),
      this.database
        .prepare(`
          select head.code, head.current_version_id as currentVersionId,
            head.lock_version as lockVersion, version.review_state as reviewState,
            version.version as contentVersion, head.updated_at as updatedAt
          from clinical_section_heads head
          join clinical_section_versions version
            on version.organization_id = head.organization_id
            and version.facility_id = head.facility_id
            and version.encounter_id = head.encounter_id
            and version.code = head.code
            and version.id = head.current_version_id
          where head.organization_id = ?1 and head.facility_id = ?2
            and head.encounter_id = ?3
          order by head.code
        `)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
        ),
      this.database
        .prepare(`
          select review_head.suggestion_id as suggestionId,
            review_head.state, review_head.current_decision_id as currentDecisionId,
            review_head.lock_version as lockVersion,
            derivative_head.current_derivative_version_id as currentDerivativeVersionId,
            derivative_head.lock_version as derivativeLockVersion,
            review_head.updated_at as reviewUpdatedAt,
            derivative_head.updated_at as derivativeUpdatedAt
          from suggestion_review_heads review_head
          left join suggestion_derivative_heads derivative_head
            on derivative_head.organization_id = review_head.organization_id
            and derivative_head.facility_id = review_head.facility_id
            and derivative_head.encounter_id = review_head.encounter_id
            and derivative_head.suggestion_id = review_head.suggestion_id
          where review_head.organization_id = ?1
            and review_head.facility_id = ?2
            and review_head.encounter_id = ?3
          order by review_head.suggestion_id
        `)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
        ),
      this.database
        .prepare(`
          select head.current_protocol_version_id as currentProtocolVersionId,
            head.current_signed_protocol_version_id as currentSignedProtocolVersionId,
            head.lock_version as lockVersion, version.version as protocolVersion,
            version.status as protocolStatus, version.source_hash as sourceHash,
            head.updated_at as updatedAt
          from protocol_heads head
          join protocol_versions version
            on version.organization_id = head.organization_id
            and version.facility_id = head.facility_id
            and version.encounter_id = head.encounter_id
            and version.id = head.current_protocol_version_id
          where head.organization_id = ?1 and head.facility_id = ?2
            and head.encounter_id = ?3
        `)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
        ),
      this.database
        .prepare(`
          select amendment.id,
            amendment.base_protocol_version_id as baseProtocolVersionId,
            amendment.amended_protocol_version_id as amendedProtocolVersionId,
            amendment.created_at as createdAt
          from protocol_amendments amendment
          where amendment.organization_id = ?1 and amendment.facility_id = ?2
            and amendment.encounter_id = ?3
          order by amendment.created_at, amendment.id
        `)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
        ),
      this.database
        .prepare(`
          select artifact.id,
            artifact.protocol_version_id as protocolVersionId,
            artifact.kind, artifact.object_key as objectKey,
            artifact.sha256, artifact.byte_size as byteSize,
            artifact.created_at as createdAt
          from document_artifacts artifact
          join protocol_heads head
            on head.organization_id = artifact.organization_id
            and head.facility_id = artifact.facility_id
            and head.encounter_id = artifact.encounter_id
            and head.current_signed_protocol_version_id = artifact.protocol_version_id
          where artifact.organization_id = ?1 and artifact.facility_id = ?2
            and artifact.encounter_id = ?3 and artifact.status = 'ready'
          order by artifact.kind, artifact.id
        `)
        .bind(
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
        ),
    ]);

    const encounter = rows<EncounterRow>(results[0])[0];
    if (!encounter) return null;

    const status = encounterStatusSchema.parse(encounter.status);
    const consents = rows<ConsentHeadRow>(results[1]);
    const transcript = rows<TranscriptLeafRow>(results[2]);
    const sections = rows<ClinicalSectionHeadRow>(results[3]);
    const recommendations = rows<RecommendationHeadRow>(results[4]);
    const protocol = rows<ProtocolHeadRow>(results[5])[0] ?? null;
    const amendments = rows<ProtocolAmendmentRow>(results[6]);
    const exportArtifacts = rows<DocumentArtifactRow>(results[7]);
    const revision = await sha256(
      JSON.stringify({
        encounter: {
          id: encounter.encounterId,
          status,
          version: encounter.version,
          startedAt: encounter.startedAt,
          statusUpdatedAt: encounter.statusUpdatedAt,
        },
        consents,
        transcript,
        sections,
        recommendations,
        protocol,
        amendments,
        exportArtifacts,
      }),
    );

    await assertCurrentEncounterReadAccess(this.database, this.scope);
    return {
      encounterId: encounter.encounterId,
      status,
      encounterVersion: encounter.version,
      startedAt: encounter.startedAt,
      statusUpdatedAt: encounter.statusUpdatedAt,
      resumable: isEncounterResumable(status),
      revision,
      saved: {
        transcriptSegmentCount: transcript.length,
        clinicalSectionCount: sections.length,
        reviewedClinicalSectionCount: sections.filter((section) =>
          ['reviewed', 'explicitly_absent'].includes(section.reviewState),
        ).length,
        acceptedRecommendationCount: recommendations.filter((recommendation) =>
          ['accepted', 'edited_and_accepted'].includes(recommendation.state),
        ).length,
        protocolVersion: protocol?.protocolVersion ?? null,
        protocolStatus: protocol?.protocolStatus ?? null,
        amendmentCount: amendments.length,
        exportArtifactCount: exportArtifacts.length,
      },
    };
  }
}
