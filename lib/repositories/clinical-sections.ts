import { hashAuditEvent } from '@/lib/audit/event-hash';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import { assertCurrentEncounterWriteAccess } from '@/lib/auth/encounter-write-access';
import { D1ConsentRepository } from './consent';

export const clinicalSectionCodes = [
  'complaints',
  'history_of_present_illness',
  'past_medical_history',
  'allergy_status',
  'objective_findings',
  'preliminary_diagnosis',
  'examination_plan',
  'treatment_plan',
] as const;

export type ClinicalSectionCode = (typeof clinicalSectionCodes)[number];
export type ClinicalSectionReviewState =
  | 'empty'
  | 'ai_draft'
  | 'clinician_edited'
  | 'reviewed'
  | 'explicitly_absent';
export type ClinicalSectionAction =
  | 'save_draft'
  | 'mark_reviewed'
  | 'mark_absent';

export type PersistedClinicalSection = {
  code: ClinicalSectionCode;
  title: string;
  content: string;
  reviewState: ClinicalSectionReviewState;
  version: number;
  evidence: string[];
  provenance: {
    sourceType: 'synthetic_fixture' | 'ai_draft' | 'clinician';
    sourceIds: string[];
  };
  reviewedBy: string | null;
  reviewedAt: number | null;
  updatedAt: number;
};

export type RecordClinicalSectionCommand = {
  sectionCode: ClinicalSectionCode;
  action: ClinicalSectionAction;
  content?: string;
  expectedVersion: number;
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};

type SectionRow = {
  code: ClinicalSectionCode;
  content: string;
  reviewState: ClinicalSectionReviewState;
  provenanceJson: string;
  lockVersion: number;
  contentVersion: number;
  reviewedBy: string | null;
  reviewedAt: number | null;
  updatedAt: number;
  currentVersionId: string;
  encounterStatus: string;
};

type AuditHeadRow = {
  lastSequence: number;
  lastEventHash: string | null;
  lockVersion: number;
};

type IdempotencyRow = {
  accessAssignmentId: string | null;
  requestHash: string;
  status: string;
  resultResourceType: string | null;
  resultResourceId: string | null;
};

const sectionTitles: Record<ClinicalSectionCode, string> = {
  complaints: 'Жалобы',
  history_of_present_illness: 'Анамнез заболевания',
  past_medical_history: 'Анамнез жизни',
  allergy_status: 'Аллергологический статус',
  objective_findings: 'Объективные данные',
  preliminary_diagnosis: 'Предварительный диагноз',
  examination_plan: 'План обследования',
  treatment_plan: 'План лечения и корректировок',
};

export class ClinicalSectionNotFoundError extends Error {}
export class ClinicalSectionConflictError extends Error {}
export class ClinicalSectionValidationError extends Error {}
export class ClinicalSectionCareConsentRequiredError extends Error {}

export interface ClinicalSectionRepository {
  list(): Promise<PersistedClinicalSection[]>;
  recordCommand(
    input: RecordClinicalSectionCommand,
  ): Promise<PersistedClinicalSection>;
}

function parseProvenance(value: string): PersistedClinicalSection['provenance'] {
  try {
    const parsed = JSON.parse(value) as {
      sourceType?: unknown;
      sourceIds?: unknown;
    };
    const sourceType =
      parsed.sourceType === 'ai_draft' ||
      parsed.sourceType === 'clinician' ||
      parsed.sourceType === 'synthetic_fixture'
        ? parsed.sourceType
        : 'synthetic_fixture';
    const sourceIds = Array.isArray(parsed.sourceIds)
      ? parsed.sourceIds.filter((item): item is string => typeof item === 'string')
      : [];
    return { sourceType, sourceIds };
  } catch {
    return { sourceType: 'synthetic_fixture', sourceIds: [] };
  }
}

function mapSection(row: SectionRow): PersistedClinicalSection {
  const provenance = parseProvenance(row.provenanceJson);
  return {
    code: row.code,
    title: sectionTitles[row.code],
    content: row.content,
    reviewState: row.reviewState,
    version: row.lockVersion,
    evidence:
      provenance.sourceIds.length > 0
        ? provenance.sourceIds
        : ['Нет подтверждённых источников'],
    provenance,
    reviewedBy: row.reviewedBy,
    reviewedAt: row.reviewedAt,
    updatedAt: row.updatedAt,
  };
}

function normalizedContent(input: RecordClinicalSectionCommand) {
  if (input.action === 'mark_absent') return '';
  return (input.content ?? '').replace(/\r\n/g, '\n').trim();
}

function targetReviewState(
  input: RecordClinicalSectionCommand,
  content: string,
): ClinicalSectionReviewState {
  if (input.action === 'mark_absent') return 'explicitly_absent';
  if (input.action === 'mark_reviewed') {
    if (!content) {
      throw new ClinicalSectionValidationError(
        'An empty clinical section cannot be reviewed',
      );
    }
    return 'reviewed';
  }
  return content ? 'clinician_edited' : 'empty';
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

export class D1ClinicalSectionRepository implements ClinicalSectionRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
  ) {}

  async list() {
    const scope = this.scope;
    const result = await this.database
      .prepare(`
        select
          version.code,
          version.content,
          version.review_state as reviewState,
          version.provenance_json as provenanceJson,
          head.lock_version as lockVersion,
          version.version as contentVersion,
          reviewer.display_name as reviewedBy,
          version.reviewed_at as reviewedAt,
          head.updated_at as updatedAt,
          head.current_version_id as currentVersionId,
          encounter.status as encounterStatus
        from clinical_section_heads head
        join clinical_section_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.encounter_id = head.encounter_id
          and version.code = head.code
          and version.id = head.current_version_id
        left join memberships reviewer_membership
          on reviewer_membership.organization_id = version.organization_id
          and reviewer_membership.facility_id = version.facility_id
          and reviewer_membership.id = version.reviewed_by_membership_id
        left join users reviewer on reviewer.id = reviewer_membership.user_id
        join encounters encounter
          on encounter.organization_id = head.organization_id
          and encounter.facility_id = head.facility_id
          and encounter.id = head.encounter_id
        where head.organization_id = ?1
          and head.facility_id = ?2
          and head.encounter_id = ?3
        order by case version.code
          when 'complaints' then 1
          when 'history_of_present_illness' then 2
          when 'past_medical_history' then 3
          when 'allergy_status' then 4
          when 'objective_findings' then 5
          when 'preliminary_diagnosis' then 6
          when 'examination_plan' then 7
          when 'treatment_plan' then 8
          else 99 end
      `)
      .bind(scope.organizationId, scope.facilityId, scope.encounterId)
      .all<SectionRow>();

    return result.results.map(mapSection);
  }

  async recordCommand(input: RecordClinicalSectionCommand) {
    await this.assertCommandAccess(input.actorId);
    const content = normalizedContent(input);
    const reviewState = targetReviewState(input, content);
    const requestHash = await sha256(
      JSON.stringify({
        accessAssignmentId: this.scope.accessAssignmentId,
        encounterId: this.scope.encounterId,
        sectionCode: input.sectionCode,
        action: input.action,
        content,
        expectedVersion: input.expectedVersion,
      }),
    );
    const replay = await this.findIdempotency(input.idempotencyKey);

    if (replay) {
      return this.resolveReplay(replay, requestHash, input.actorId);
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertCommandAccess(input.actorId);
      const current = await this.getRowByCode(input.sectionCode);
      if (!current) throw new ClinicalSectionNotFoundError('Section was not found');
      if (!['in_progress', 'review'].includes(current.encounterStatus)) {
        throw new ClinicalSectionValidationError('Encounter is not editable');
      }
      if (current.lockVersion !== input.expectedVersion) {
        throw new ClinicalSectionConflictError('Section changed on the server');
      }

      const auditHead = await this.getAuditHead();
      if (!auditHead) throw new Error('Audit stream is unavailable');

      try {
        return await this.commitCommand({
          input,
          current,
          auditHead,
          content,
          reviewState,
          requestHash,
        });
      } catch (error) {
        await this.assertCommandAccess(input.actorId);
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash, input.actorId);

        const latest = await this.getRowByCode(input.sectionCode);
        if (!latest || latest.lockVersion !== input.expectedVersion) {
          throw new ClinicalSectionConflictError('Section changed on the server');
        }
        if (attempt === 2) throw error;
      }
    }

    throw new Error('Clinical section command retry was exhausted');
  }

  private async commitCommand(args: {
    input: RecordClinicalSectionCommand;
    current: SectionRow;
    auditHead: AuditHeadRow;
    content: string;
    reviewState: ClinicalSectionReviewState;
    requestHash: string;
  }) {
    const { input, current, auditHead, content, reviewState, requestHash } = args;
    const scope = this.scope;
    const now = Date.now();
    const versionId = `section-${input.sectionCode}-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const auditSequence = auditHead.lastSequence + 1;
    const nextContentVersion = current.contentVersion + 1;
    const reviewerMembershipId =
      reviewState === 'reviewed' || reviewState === 'explicitly_absent'
        ? scope.reviewerMembershipId
        : null;
    const reviewedAt = reviewerMembershipId ? now : null;
    const provenance = JSON.stringify({
      sourceType: 'clinician',
      accessAssignmentId: scope.accessAssignmentId,
      sourceIds: parseProvenance(current.provenanceJson).sourceIds,
      previousVersionId: current.currentVersionId,
    });
    const contentHash = await sha256(content);
    const auditMetadata = JSON.stringify({
      accessAssignmentId: scope.accessAssignmentId,
      sectionCode: input.sectionCode,
      action: input.action,
      previousVersion: input.expectedVersion,
      resultingVersion: input.expectedVersion + 1,
      resultingState: reviewState,
      contentHash,
    });
    const auditAction = `clinical_section.${input.action}`;
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: scope.organizationId,
      facilityId: scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: scope.reviewerMembershipId,
      action: auditAction,
      outcome: 'succeeded',
      purpose: 'synthetic_clinical_documentation',
      schemaVersion: 1,
      entityType: 'clinical_section_version',
      entityId: versionId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    await this.assertCommandAccess(input.actorId);
    const results = await this.database.batch([
      this.database
        .prepare(`
          insert into command_idempotency (
            id, organization_id, facility_id, actor_membership_id,
            operation, idempotency_key, request_hash, status, created_at, access_assignment_id
          ) values (
            ?1, ?2, ?3, ?4, 'clinical_section.command', ?5, ?6,
            'processing', ?7, ?8
          )
        `)
        .bind(
          commandId,
          scope.organizationId,
          scope.facilityId,
          scope.reviewerMembershipId,
          input.idempotencyKey,
          requestHash,
          now,
          scope.accessAssignmentId!,
        ),
      this.database
        .prepare(`
          insert into clinical_section_versions (
            id, organization_id, facility_id, encounter_id, code, content,
            review_state, provenance_json, created_by_type, created_by_id,
            reviewed_by_membership_id, reviewed_at, version,
            supersedes_section_version_id, created_at, access_assignment_id
          ) values (
            ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'user', ?9,
            ?10, ?11, ?12, ?13, ?14, ?15
          )
        `)
        .bind(
          versionId,
          scope.organizationId,
          scope.facilityId,
          scope.encounterId,
          input.sectionCode,
          content,
          reviewState,
          provenance,
          input.actorId,
          reviewerMembershipId,
          reviewedAt,
          nextContentVersion,
          current.currentVersionId,
          now,
          scope.accessAssignmentId!,
        ),
      this.database
        .prepare(`
          update clinical_section_heads
          set current_version_id = ?1, lock_version = lock_version + 1,
            updated_at = ?2
          where organization_id = ?3 and facility_id = ?4
            and encounter_id = ?5 and code = ?6 and lock_version = ?7
            and current_version_id = ?8
        `)
        .bind(
          versionId,
          now,
          scope.organizationId,
          scope.facilityId,
          scope.encounterId,
          input.sectionCode,
          input.expectedVersion,
          current.currentVersionId,
        ),
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          ) values (
            ?1, ?2, ?3, ?4, 'user', ?5, ?6, ?7, 'succeeded',
            'synthetic_clinical_documentation', 1, 'clinical_section_version',
            ?8, ?9, ?10, ?11, ?12, ?13
          )
        `)
        .bind(
          auditEventId,
          scope.organizationId,
          scope.facilityId,
          auditSequence,
          input.actorId,
          scope.reviewerMembershipId,
          auditAction,
          versionId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
        ),
      this.database
        .prepare(`
          update audit_stream_heads
          set last_sequence = ?1, last_event_hash = ?2,
            lock_version = lock_version + 1, updated_at = ?3
          where organization_id = ?4 and facility_id = ?5
            and last_sequence = ?6 and lock_version = ?7
        `)
        .bind(
          auditSequence,
          eventHash,
          now,
          scope.organizationId,
          scope.facilityId,
          auditHead.lastSequence,
          auditHead.lockVersion,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded',
            result_resource_type = 'clinical_section_version',
            result_resource_id = ?1,
            response_json = ?2,
            completed_at = ?3
          where id = ?4 and status = 'processing'
        `)
        .bind(
          versionId,
          JSON.stringify({ resourceVersionId: versionId }),
          now,
          commandId,
        ),
    ]);

    if (results.some((result) => result.meta.changes !== 1)) {
      throw new ClinicalSectionConflictError('Command was not committed');
    }

    const committed = await this.getRowByVersionId(versionId);
    if (!committed) throw new Error('Committed section version is unavailable');
    return mapSection(committed);
  }

  private async getAuditHead() {
    const scope = this.scope;
    return this.database
      .prepare(`
        select last_sequence as lastSequence, last_event_hash as lastEventHash,
          lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2
      `)
      .bind(scope.organizationId, scope.facilityId)
      .first<AuditHeadRow>();
  }

  private async getRowByCode(code: ClinicalSectionCode) {
    const scope = this.scope;
    return this.database
      .prepare(`
        select
          version.code,
          version.content,
          version.review_state as reviewState,
          version.provenance_json as provenanceJson,
          head.lock_version as lockVersion,
          version.version as contentVersion,
          reviewer.display_name as reviewedBy,
          version.reviewed_at as reviewedAt,
          head.updated_at as updatedAt,
          head.current_version_id as currentVersionId,
          encounter.status as encounterStatus
        from clinical_section_heads head
        join clinical_section_versions version
          on version.id = head.current_version_id
          and version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.encounter_id = head.encounter_id
          and version.code = head.code
        left join memberships reviewer_membership
          on reviewer_membership.organization_id = version.organization_id
          and reviewer_membership.facility_id = version.facility_id
          and reviewer_membership.id = version.reviewed_by_membership_id
        left join users reviewer on reviewer.id = reviewer_membership.user_id
        join encounters encounter
          on encounter.organization_id = head.organization_id
          and encounter.facility_id = head.facility_id
          and encounter.id = head.encounter_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3 and head.code = ?4
      `)
      .bind(scope.organizationId, scope.facilityId, scope.encounterId, code)
      .first<SectionRow>();
  }

  private async getRowByVersionId(versionId: string) {
    const scope = this.scope;
    return this.database
      .prepare(`
        select
          version.code,
          version.content,
          version.review_state as reviewState,
          version.provenance_json as provenanceJson,
          version.version as lockVersion,
          version.version as contentVersion,
          reviewer.display_name as reviewedBy,
          version.reviewed_at as reviewedAt,
          version.created_at as updatedAt,
          version.id as currentVersionId,
          encounter.status as encounterStatus
        from clinical_section_versions version
        join encounters encounter
          on encounter.organization_id = version.organization_id
          and encounter.facility_id = version.facility_id
          and encounter.id = version.encounter_id
        left join memberships reviewer_membership
          on reviewer_membership.organization_id = version.organization_id
          and reviewer_membership.facility_id = version.facility_id
          and reviewer_membership.id = version.reviewed_by_membership_id
        left join users reviewer on reviewer.id = reviewer_membership.user_id
        where version.organization_id = ?1 and version.facility_id = ?2
          and version.encounter_id = ?3 and version.id = ?4
      `)
      .bind(
        scope.organizationId,
        scope.facilityId,
        scope.encounterId,
        versionId,
      )
      .first<SectionRow>();
  }

  private async findIdempotency(idempotencyKey: string) {
    const scope = this.scope;
    return this.database
      .prepare(`
        select request_hash as requestHash, status, access_assignment_id as accessAssignmentId,
          result_resource_type as resultResourceType,
          result_resource_id as resultResourceId
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3
          and operation = 'clinical_section.command'
          and idempotency_key = ?4
      `)
      .bind(
        scope.organizationId,
        scope.facilityId,
        scope.reviewerMembershipId,
        idempotencyKey,
      )
      .first<IdempotencyRow>();
  }

  private async assertCommandAccess(actorId: string) {
    await assertCurrentEncounterWriteAccess(this.database, this.scope, actorId);
    if (!await new D1ConsentRepository(this.database, this.scope).hasEffectiveConsent('care')) {
      throw new ClinicalSectionCareConsentRequiredError();
    }
  }

  private async resolveReplay(replay: IdempotencyRow, requestHash: string, actorId: string) {
    await this.assertCommandAccess(actorId);
    if (
      replay.accessAssignmentId !== this.scope.accessAssignmentId ||
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'clinical_section_version' ||
      !replay.resultResourceId
    ) {
      throw new ClinicalSectionConflictError(
        'Idempotency key was already used for another command',
      );
    }

    const version = await this.getRowByVersionId(replay.resultResourceId);
    if (!version) throw new Error('Stored command result is unavailable');
    return mapSection(version);
  }
}
