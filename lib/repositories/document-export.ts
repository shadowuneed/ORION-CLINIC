import { hashAuditEvent } from '@/lib/audit/event-hash';
import { assertCurrentEncounterReadAccess } from '@/lib/auth/encounter-read-access';
import { assertCurrentEncounterWriteAccess } from '@/lib/auth/encounter-write-access';
import type { WorkspaceScope } from '@/lib/auth/workspace-access';
import {
  exportArtifactKinds,
  signedProtocolContentSchema,
  type ExportArtifactKind,
  type ExportAuditEvent,
  type SignedProtocolExportSource,
} from '@/lib/documents/protocol-artifacts';

type SignedProtocolRow = {
  protocolId: string;
  protocolVersion: number;
  contentJson: string;
  sourceHash: string;
  signedAt: number;
  signedByMembershipId: string;
  signedByDisplayName: string;
  encounterStatus: string;
};

type AuditEventRow = Omit<ExportAuditEvent, 'metadata'> & {
  metadataJson: string;
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
  responseJson: string | null;
};

type ArtifactRow = {
  id: string;
  kind: ExportArtifactKind;
  objectKey: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
};

export type ExportArtifactMetadata = {
  kind: ExportArtifactKind;
  filename: string;
  objectKey: string;
  mimeType: string;
  sha256: string;
  byteSize: number;
};

export type ExportArtifactSummary = ExportArtifactMetadata & {
  id: string;
};

export type ExportPackageSummary = {
  encounterId: string;
  protocolId: string;
  protocolVersion: number;
  artifacts: ExportArtifactSummary[];
};

export type RecordExportCommand = {
  protocolId: string;
  protocolVersion: number;
  artifacts: ExportArtifactMetadata[];
  idempotencyKey: string;
  actorId: string;
  requestId: string;
};
export type ExportIntent = Pick<RecordExportCommand, 'protocolId' | 'protocolVersion' | 'idempotencyKey' | 'actorId'>;

export class DocumentExportConflictError extends Error {}
export class DocumentExportLifecycleError extends Error {}
export class DocumentExportNotFoundError extends Error {}
export class DocumentExportSourceChangedError extends Error {}

async function sha256Text(value: string) {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}

function parseMetadata(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

function parseStoredResult(value: string | null) {
  if (!value) return null;
  try {
    const result = JSON.parse(value) as ExportPackageSummary;
    if (
      typeof result.encounterId !== 'string' ||
      typeof result.protocolId !== 'string' ||
      typeof result.protocolVersion !== 'number' ||
      !Array.isArray(result.artifacts) ||
      result.artifacts.length !== exportArtifactKinds.length ||
      !result.artifacts.every(
        (artifact) =>
          typeof artifact.id === 'string' &&
          exportArtifactKinds.includes(artifact.kind) &&
          typeof artifact.filename === 'string' &&
          typeof artifact.objectKey === 'string' &&
          typeof artifact.mimeType === 'string' &&
          typeof artifact.sha256 === 'string' &&
          typeof artifact.byteSize === 'number',
      )
    ) {
      return null;
    }
    return result;
  } catch {
    return null;
  }
}

function filenameFromKey(objectKey: string) {
  return objectKey.split('/').at(-1) ?? 'ORION-export';
}

export class D1DocumentExportRepository {
  constructor(
    private readonly database: D1Database,
    private readonly scope: WorkspaceScope,
    private readonly actorId?: string,
  ) {}

  async getSignedSource(): Promise<SignedProtocolExportSource> {
    await this.assertReadAccess();
    const row = await this.getSignedProtocolRow();
    if (!row) {
      throw new DocumentExportNotFoundError('Signed protocol was not found');
    }
    if (!['finalized', 'amended'].includes(row.encounterStatus)) {
      throw new DocumentExportLifecycleError('Encounter is not finalized');
    }
    let candidate: unknown;
    try {
      candidate = JSON.parse(row.contentJson) as unknown;
    } catch {
      throw new DocumentExportSourceChangedError('Protocol content is invalid');
    }
    const content = signedProtocolContentSchema.safeParse(candidate);
    if (
      !content.success ||
      (await sha256Text(row.contentJson)) !== row.sourceHash ||
      content.data.encounter.id !== this.scope.encounterId
    ) {
      throw new DocumentExportSourceChangedError(
        'Signed protocol source snapshot failed integrity validation',
      );
    }

    const auditRows = await this.getEncounterAuditEvents();
    await this.assertReadAccess();
    return {
      protocol: {
        id: row.protocolId,
        version: row.protocolVersion,
        sourceHash: row.sourceHash,
        signedAt: row.signedAt,
        signedByMembershipId: row.signedByMembershipId,
        signedByDisplayName: row.signedByDisplayName,
      },
      content: content.data,
      auditEvents: auditRows.map(({ metadataJson, ...auditEvent }) => ({
        ...auditEvent,
        metadata: parseMetadata(metadataJson),
      })),
    };
  }

  async listCurrentArtifacts(): Promise<ExportArtifactSummary[]> {
    await this.assertReadAccess();
    const result = await this.database
      .prepare(`
        select artifact.id, artifact.kind, artifact.object_key as objectKey,
          artifact.mime_type as mimeType, artifact.sha256,
          artifact.byte_size as byteSize
        from document_artifacts artifact
        join protocol_heads head
          on head.organization_id = artifact.organization_id
          and head.facility_id = artifact.facility_id
          and head.encounter_id = artifact.encounter_id
          and head.current_signed_protocol_version_id = artifact.protocol_version_id
        where artifact.organization_id = ?1 and artifact.facility_id = ?2
          and artifact.encounter_id = ?3 and artifact.status = 'ready'
          and artifact.export_command_id is (
            select latest.export_command_id from document_artifacts latest
            where latest.organization_id = artifact.organization_id
              and latest.facility_id = artifact.facility_id
              and latest.encounter_id = artifact.encounter_id
              and latest.protocol_version_id = artifact.protocol_version_id
              and latest.status = 'ready' and latest.export_command_id is not null
            order by latest.created_at desc, latest.export_command_id desc limit 1
          )
        order by case artifact.kind
          when 'protocol_docx' then 1 when 'protocol_pdf' then 2
          when 'transcript_txt' then 3 when 'audit_json' then 4
          when 'bundle_zip' then 5 else 6 end
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<ArtifactRow>();
    await this.assertReadAccess();
    return result.results.map((row) => ({
      ...row,
      filename: filenameFromKey(row.objectKey),
    }));
  }

  async recordGenerated(input: RecordExportCommand) {
    await this.assertGenerationAuthorized(input.protocolId, input.protocolVersion, input.actorId);
    this.validateArtifacts(input.artifacts);
    const requestHash = await this.intentHash(input);
    const replay = await this.findIdempotency(input.idempotencyKey);
    if (replay) return this.resolveReplay(replay, requestHash, input);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertGenerationAuthorized(input.protocolId, input.protocolVersion, input.actorId);
      const [protocol, auditHead] = await Promise.all([
        this.getSignedProtocolRow(),
        this.getAuditHead(),
      ]);
      if (!protocol || protocol.protocolId !== input.protocolId) {
        throw new DocumentExportNotFoundError('Signed protocol was not found');
      }
      if (protocol.protocolVersion !== input.protocolVersion || !['finalized', 'amended'].includes(protocol.encounterStatus)) {
        throw new DocumentExportConflictError('Signed protocol changed');
      }
      if (!auditHead) throw new Error('Audit stream is unavailable');
      try {
        return await this.commitGenerated({ input, requestHash, protocol, auditHead });
      } catch (error) {
        await this.assertGenerationAuthorized(input.protocolId, input.protocolVersion, input.actorId);
        const racedReplay = await this.findIdempotency(input.idempotencyKey);
        if (racedReplay) return this.resolveReplay(racedReplay, requestHash, input);
        if (attempt === 2) throw error;
      }
    }
    throw new Error('Document export retry was exhausted');
  }

  async findGenerated(input: ExportIntent) {
    await this.assertGenerationAuthorized(input.protocolId, input.protocolVersion, input.actorId);
    const replay = await this.findIdempotency(input.idempotencyKey);
    return replay ? this.resolveReplay(replay, await this.intentHash(input), input) : null;
  }

  private intentHash(input: ExportIntent) {
    return sha256Text(
      JSON.stringify({
        schemaVersion: 2,
        accessAssignmentId: this.scope.accessAssignmentId,
        encounterId: this.scope.encounterId,
        protocolId: input.protocolId,
        protocolVersion: input.protocolVersion,
      }),
    );
  }

  async getDownload(kind: ExportArtifactKind, artifactId?: string) {
    await this.assertReadAccess();
    const row = await this.database
      .prepare(`
        select artifact.id, artifact.kind, artifact.object_key as objectKey,
          artifact.mime_type as mimeType, artifact.sha256,
          artifact.byte_size as byteSize
        from document_artifacts artifact
        join protocol_heads head
          on head.organization_id = artifact.organization_id
          and head.facility_id = artifact.facility_id
          and head.encounter_id = artifact.encounter_id
          and head.current_signed_protocol_version_id = artifact.protocol_version_id
        join encounters encounter
          on encounter.organization_id = artifact.organization_id
          and encounter.facility_id = artifact.facility_id
          and encounter.id = artifact.encounter_id
        where artifact.organization_id = ?1 and artifact.facility_id = ?2
          and artifact.encounter_id = ?3 and artifact.kind = ?4
          and artifact.status = 'ready'
          and encounter.clinician_membership_id = ?5
          and encounter.status in ('finalized', 'amended')
          and (?6 is null or artifact.id = ?6)
        order by artifact.created_at desc, artifact.export_command_id desc, artifact.id desc
        limit 1
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        kind,
        this.scope.reviewerMembershipId,
        artifactId ?? null,
      )
      .first<ArtifactRow>();
    await this.assertReadAccess();
    return row ? { ...row, filename: filenameFromKey(row.objectKey) } : null;
  }

  private assertReadAccess(actorId = this.actorId) {
    return assertCurrentEncounterReadAccess(this.database, this.scope, actorId);
  }

  async assertGenerationAuthorized(protocolId: string, protocolVersion: number, actorId: string) {
    await assertCurrentEncounterWriteAccess(this.database, this.scope, actorId);
    const current = await this.getSignedProtocolRow();
    if (!current || current.protocolId !== protocolId || current.protocolVersion !== protocolVersion ||
      !['finalized', 'amended'].includes(current.encounterStatus)) {
      throw new DocumentExportConflictError('Signed protocol changed or is unavailable');
    }
    await assertCurrentEncounterWriteAccess(this.database, this.scope, actorId);
  }

  async assertDownloadAuthorized(artifact: ExportArtifactSummary, actorId: string) {
    await this.assertReadAccess(actorId);
    const current = await this.getDownload(artifact.kind, artifact.id);
    if (!current || current.id !== artifact.id || current.objectKey !== artifact.objectKey ||
      current.sha256 !== artifact.sha256 || current.byteSize !== artifact.byteSize || current.mimeType !== artifact.mimeType) {
      throw new DocumentExportConflictError('Download artifact changed');
    }
    await this.assertReadAccess(actorId);
  }

  async auditDownload(
    artifact: ExportArtifactSummary,
    input: { actorId: string; requestId: string },
  ) {
    await this.assertDownloadAuthorized(artifact, input.actorId);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      await this.assertDownloadAuthorized(artifact, input.actorId);
      const auditHead = await this.getAuditHead();
      if (!auditHead) throw new Error('Audit stream is unavailable');
      const now = Date.now();
      const auditEventId = `audit-${crypto.randomUUID()}`;
      const auditSequence = auditHead.lastSequence + 1;
      const metadataJson = JSON.stringify({
        accessAssignmentId: this.scope.accessAssignmentId,
        artifactId: artifact.id,
        kind: artifact.kind,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
      });
      const eventHash = await hashAuditEvent({
        previousHash: auditHead.lastEventHash,
        organizationId: this.scope.organizationId,
        facilityId: this.scope.facilityId,
        sequence: auditSequence,
        actorType: 'user',
        actorId: input.actorId,
        actorMembershipId: this.scope.reviewerMembershipId,
        action: 'document.download.authorized',
        outcome: 'succeeded',
        purpose: 'synthetic_clinical_export_download',
        schemaVersion: 1,
        entityType: 'document_artifact',
        entityId: artifact.id,
        requestId: input.requestId,
        metadataJson,
        occurredAt: now,
      });
      try {
        await this.assertDownloadAuthorized(artifact, input.actorId);
        const results = await this.database.batch([
          this.database
            .prepare(`
              insert into audit_events (
                id, organization_id, facility_id, sequence, actor_type, actor_id,
                actor_membership_id, action, outcome, purpose, schema_version,
                entity_type, entity_id, request_id, metadata_json, previous_hash,
                event_hash, occurred_at
              )
              select ?1, ?2, ?3, ?4, 'user', ?5, ?6,
                'document.download.authorized', 'succeeded',
                'synthetic_clinical_export_download', 1,
                'document_artifact', ?7, ?8, ?9, ?10, ?11, ?12
              where exists (
                select 1 from document_artifacts artifact
                join protocol_heads head
                  on head.organization_id = artifact.organization_id
                  and head.facility_id = artifact.facility_id
                  and head.encounter_id = artifact.encounter_id
                  and head.current_signed_protocol_version_id = artifact.protocol_version_id
                where artifact.organization_id = ?2 and artifact.facility_id = ?3
                  and artifact.encounter_id = ?13 and artifact.id = ?7
                  and artifact.status = 'ready'
              )
            `)
            .bind(
              auditEventId,
              this.scope.organizationId,
              this.scope.facilityId,
              auditSequence,
              input.actorId,
              this.scope.reviewerMembershipId,
              artifact.id,
              input.requestId,
              metadataJson,
              auditHead.lastEventHash,
              eventHash,
              now,
              this.scope.encounterId,
            ),
          this.database
            .prepare(`
              update audit_stream_heads
              set last_sequence = ?1, last_event_hash = ?2,
                lock_version = lock_version + 1, updated_at = ?3
              where organization_id = ?4 and facility_id = ?5
                and last_sequence = ?6 and lock_version = ?7
                and exists (select 1 from audit_events where id = ?8)
            `)
            .bind(
              auditSequence,
              eventHash,
              now,
              this.scope.organizationId,
              this.scope.facilityId,
              auditHead.lastSequence,
              auditHead.lockVersion,
              auditEventId,
            ),
        ]);
        if (results.every((result) => result.meta.changes === 1)) return;
      } catch (error) {
        await this.assertDownloadAuthorized(artifact, input.actorId);
        if (attempt === 2) throw error;
      }
    }
    throw new DocumentExportConflictError('Audit stream changed during download');
  }

  private validateArtifacts(artifacts: ExportArtifactMetadata[]) {
    const actual = artifacts.map((artifact) => artifact.kind).sort();
    const expected = [...exportArtifactKinds].sort();
    if (
      actual.length !== expected.length ||
      new Set(artifacts.map(artifact => artifact.objectKey)).size !== artifacts.length ||
      actual.some((kind, index) => kind !== expected[index]) ||
      artifacts.some(
        (artifact) =>
          !artifact.filename ||
          !artifact.objectKey ||
          artifact.filename !== filenameFromKey(artifact.objectKey) ||
          !artifact.mimeType ||
          !/^[a-f0-9]{64}$/.test(artifact.sha256) ||
          !Number.isSafeInteger(artifact.byteSize) || artifact.byteSize <= 0,
      )
    ) {
      throw new DocumentExportSourceChangedError('Export artifact set is invalid');
    }
  }

  private async commitGenerated(args: {
    input: RecordExportCommand;
    requestHash: string;
    protocol: SignedProtocolRow;
    auditHead: AuditHeadRow;
  }) {
    const { input, requestHash, protocol, auditHead } = args;
    const now = Date.now();
    const artifactSummaries: ExportArtifactSummary[] = [];
    for (const artifact of input.artifacts) {
      artifactSummaries.push({
        ...artifact,
        id: `artifact-${(await sha256Text(artifact.objectKey)).slice(0, 32)}`,
      });
    }
    const result: ExportPackageSummary = {
      encounterId: this.scope.encounterId,
      protocolId: protocol.protocolId,
      protocolVersion: protocol.protocolVersion,
      artifacts: artifactSummaries,
    };
    const responseJson = JSON.stringify(result);
    const auditEventId = `audit-${crypto.randomUUID()}`;
    const commandId = `command-${crypto.randomUUID()}`;
    const auditSequence = auditHead.lastSequence + 1;
    const auditMetadata = JSON.stringify({
      accessAssignmentId: this.scope.accessAssignmentId,
      exportCommandId: commandId,
      protocolId: protocol.protocolId,
      protocolVersion: protocol.protocolVersion,
      artifacts: artifactSummaries.map((artifact) => ({
        id: artifact.id,
        kind: artifact.kind,
        sha256: artifact.sha256,
        byteSize: artifact.byteSize,
      })),
    });
    const eventHash = await hashAuditEvent({
      previousHash: auditHead.lastEventHash,
      organizationId: this.scope.organizationId,
      facilityId: this.scope.facilityId,
      sequence: auditSequence,
      actorType: 'user',
      actorId: input.actorId,
      actorMembershipId: this.scope.reviewerMembershipId,
      action: 'document.export.generate',
      outcome: 'succeeded',
      purpose: 'synthetic_signed_protocol_export',
      schemaVersion: 1,
      entityType: 'protocol_version',
      entityId: protocol.protocolId,
      requestId: input.requestId,
      metadataJson: auditMetadata,
      occurredAt: now,
    });

    const statements = artifactSummaries.map((artifact) =>
      this.database
        .prepare(`
          insert into document_artifacts (
            id, organization_id, facility_id, encounter_id,
            protocol_version_id, kind, object_key, mime_type, sha256,
            byte_size, status, created_by_membership_id, created_at, access_assignment_id, export_command_id
          )
          select ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10,
            'ready', ?11, ?12, ?14, ?15
          where exists (
            select 1 from protocol_heads head
            join protocol_versions version
              on version.organization_id = head.organization_id
              and version.facility_id = head.facility_id
              and version.encounter_id = head.encounter_id
              and version.id = head.current_signed_protocol_version_id
            where head.organization_id = ?2 and head.facility_id = ?3
              and head.encounter_id = ?4 and version.id = ?5
              and version.status = 'signed' and version.version = ?13
          )
        `)
        .bind(
          artifact.id,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.encounterId,
          protocol.protocolId,
          artifact.kind,
          artifact.objectKey,
          artifact.mimeType,
          artifact.sha256,
          artifact.byteSize,
          this.scope.reviewerMembershipId,
          now,
          protocol.protocolVersion,
          this.scope.accessAssignmentId!,
          commandId,
        ),
    );
    await this.assertGenerationAuthorized(input.protocolId, input.protocolVersion, input.actorId);
    const batchResults = await this.database.batch([
      ...statements,
      this.database
        .prepare(`
          insert into audit_events (
            id, organization_id, facility_id, sequence, actor_type, actor_id,
            actor_membership_id, action, outcome, purpose, schema_version,
            entity_type, entity_id, request_id, metadata_json, previous_hash,
            event_hash, occurred_at
          )
          select ?1, ?2, ?3, ?4, 'user', ?5, ?6,
            'document.export.generate', 'succeeded',
            'synthetic_signed_protocol_export', 1,
            'protocol_version', ?7, ?8, ?9, ?10, ?11, ?12
          where exists (
            select 1 from protocol_heads head
            join protocol_versions version
              on version.organization_id = head.organization_id
              and version.facility_id = head.facility_id
              and version.encounter_id = head.encounter_id
              and version.id = head.current_signed_protocol_version_id
            where head.organization_id = ?2 and head.facility_id = ?3
              and head.encounter_id = ?13 and version.id = ?7
              and version.status = 'signed' and version.version = ?14
          )
        `)
        .bind(
          auditEventId,
          this.scope.organizationId,
          this.scope.facilityId,
          auditSequence,
          input.actorId,
          this.scope.reviewerMembershipId,
          protocol.protocolId,
          input.requestId,
          auditMetadata,
          auditHead.lastEventHash,
          eventHash,
          now,
          this.scope.encounterId,
          protocol.protocolVersion,
        ),
      this.database
        .prepare(`
          update audit_stream_heads
          set last_sequence = ?1, last_event_hash = ?2,
            lock_version = lock_version + 1, updated_at = ?3
          where organization_id = ?4 and facility_id = ?5
            and last_sequence = ?6 and lock_version = ?7
            and exists (select 1 from audit_events where id = ?8)
        `)
        .bind(
          auditSequence,
          eventHash,
          now,
          this.scope.organizationId,
          this.scope.facilityId,
          auditHead.lastSequence,
          auditHead.lockVersion,
          auditEventId,
        ),
      this.database
        .prepare(`
          insert into command_idempotency (
            id, organization_id, facility_id, actor_membership_id,
            operation, idempotency_key, request_hash, status, created_at, access_assignment_id
          ) select ?1, ?2, ?3, ?4, 'document.export.generate',
            ?5, ?6, 'processing', ?7, ?9
          where exists (select 1 from audit_events where id = ?8)
        `)
        .bind(
          commandId,
          this.scope.organizationId,
          this.scope.facilityId,
          this.scope.reviewerMembershipId,
          input.idempotencyKey,
          requestHash,
          now,
          auditEventId,
          this.scope.accessAssignmentId!,
        ),
      this.database
        .prepare(`
          update command_idempotency
          set status = 'succeeded', result_resource_type = 'export_bundle',
            result_resource_id = ?1, response_json = ?2, completed_at = ?3
          where id = ?4 and status = 'processing'
            and exists (select 1 from audit_events where id = ?5)
        `)
        .bind(protocol.protocolId, responseJson, now, commandId, auditEventId),
    ]);
    if (batchResults.some((batchResult) => batchResult.meta.changes !== 1)) {
      throw new DocumentExportConflictError(
        'Signed protocol changed before export metadata commit',
      );
    }
    return result;
  }

  private async getSignedProtocolRow() {
    return this.database
      .prepare(`
        select version.id as protocolId, version.version as protocolVersion,
          version.content_json as contentJson, version.source_hash as sourceHash,
          version.signed_at as signedAt,
          version.signed_by_membership_id as signedByMembershipId,
          clinician.display_name as signedByDisplayName,
          encounter.status as encounterStatus
        from protocol_heads head
        join protocol_versions version
          on version.organization_id = head.organization_id
          and version.facility_id = head.facility_id
          and version.encounter_id = head.encounter_id
          and version.id = head.current_signed_protocol_version_id
        join encounters encounter
          on encounter.organization_id = head.organization_id
          and encounter.facility_id = head.facility_id
          and encounter.id = head.encounter_id
        join memberships signer
          on signer.organization_id = version.organization_id
          and signer.facility_id = version.facility_id
          and signer.id = version.signed_by_membership_id
        join users clinician on clinician.id = signer.user_id
        where head.organization_id = ?1 and head.facility_id = ?2
          and head.encounter_id = ?3 and version.status = 'signed'
          and encounter.clinician_membership_id = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
        this.scope.reviewerMembershipId,
      )
      .first<SignedProtocolRow>();
  }

  private async getEncounterAuditEvents() {
    const result = await this.database
      .prepare(`
        select event.id, event.sequence, event.actor_type as actorType,
          event.actor_id as actorId, event.action, event.outcome, event.purpose,
          event.entity_type as entityType, event.entity_id as entityId,
          event.request_id as requestId, event.metadata_json as metadataJson,
          event.previous_hash as previousHash, event.event_hash as eventHash,
          event.occurred_at as occurredAt
        from audit_events event
        where event.organization_id = ?1 and event.facility_id = ?2
          and (
            (event.entity_type = 'encounter' and event.entity_id = ?3)
            or (event.entity_type = 'consent_event' and event.entity_id in (
              select id from consent_events
              where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
            ))
            or (event.entity_type = 'clinical_section_version' and event.entity_id in (
              select id from clinical_section_versions
              where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
            ))
            or (event.entity_type = 'transcript_segment' and event.entity_id in (
              select id from transcript_segments
              where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
            ))
            or (event.entity_type = 'clinical_suggestion' and event.entity_id in (
              select id from clinical_suggestions
              where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
            ))
            or (event.entity_type = 'suggestion_derivative_version' and event.entity_id in (
              select id from suggestion_derivative_versions
              where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
            ))
            or (event.entity_type = 'protocol_version' and event.entity_id in (
              select id from protocol_versions
              where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
            ))
            or (event.entity_type = 'protocol_amendment' and event.entity_id in (
              select id from protocol_amendments
              where organization_id = ?1 and facility_id = ?2 and encounter_id = ?3
            ))
          )
        order by event.sequence
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.encounterId,
      )
      .all<AuditEventRow>();
    return result.results;
  }

  private async getAuditHead() {
    return this.database
      .prepare(`
        select last_sequence as lastSequence, last_event_hash as lastEventHash,
          lock_version as lockVersion
        from audit_stream_heads
        where organization_id = ?1 and facility_id = ?2
      `)
      .bind(this.scope.organizationId, this.scope.facilityId)
      .first<AuditHeadRow>();
  }

  private async findIdempotency(idempotencyKey: string) {
    return this.database
      .prepare(`
        select request_hash as requestHash, status, access_assignment_id as accessAssignmentId,
          result_resource_type as resultResourceType,
          result_resource_id as resultResourceId,
          response_json as responseJson
        from command_idempotency
        where organization_id = ?1 and facility_id = ?2
          and actor_membership_id = ?3
          and operation = 'document.export.generate'
          and idempotency_key = ?4
      `)
      .bind(
        this.scope.organizationId,
        this.scope.facilityId,
        this.scope.reviewerMembershipId,
        idempotencyKey,
      )
      .first<IdempotencyRow>();
  }

  private async resolveReplay(replay: IdempotencyRow, requestHash: string, input: ExportIntent) {
    await this.assertGenerationAuthorized(input.protocolId, input.protocolVersion, input.actorId);
    const result = parseStoredResult(replay.responseJson);
    if (
      replay.accessAssignmentId !== this.scope.accessAssignmentId ||
      replay.requestHash !== requestHash ||
      replay.status !== 'succeeded' ||
      replay.resultResourceType !== 'export_bundle' ||
      !replay.resultResourceId ||
      result?.encounterId !== this.scope.encounterId ||
      result?.protocolId !== input.protocolId ||
      result?.protocolVersion !== input.protocolVersion ||
      result?.protocolId !== replay.resultResourceId
    ) {
      throw new DocumentExportConflictError(
        'Idempotency key was already used for another export command',
      );
    }
    return result;
  }
}
