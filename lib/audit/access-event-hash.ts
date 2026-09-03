export type AccessAuditEventHashInput = {
  previousHash: string | null;
  organizationId: string;
  facilityId: string;
  streamKey: string;
  sequence: number;
  actorUserId: string;
  actorMembershipId: string;
  actorRole: 'clinician';
  action: 'workspace.read' | 'document.download';
  outcome: 'succeeded' | 'denied' | 'failed';
  purposeCode:
    | 'synthetic_direct_patient_care'
    | 'synthetic_clinical_export_download';
  routeCode: 'workspace' | 'document_export_download';
  decisionCode: string;
  responseStatus: number;
  encounterId: string;
  documentArtifactId: string | null;
  artifactKind: string | null;
  requestId: string;
  schemaVersion: number;
  occurredAt: number;
};

export async function hashAccessAuditEvent(input: AccessAuditEventHashInput) {
  const canonicalEvent = JSON.stringify({
    hashDomain: 'orion.access-audit.v1',
    previousHash: input.previousHash,
    organizationId: input.organizationId,
    facilityId: input.facilityId,
    streamKey: input.streamKey,
    sequence: input.sequence,
    actorUserId: input.actorUserId,
    actorMembershipId: input.actorMembershipId,
    actorRole: input.actorRole,
    action: input.action,
    outcome: input.outcome,
    purposeCode: input.purposeCode,
    routeCode: input.routeCode,
    decisionCode: input.decisionCode,
    responseStatus: input.responseStatus,
    encounterId: input.encounterId,
    documentArtifactId: input.documentArtifactId,
    artifactKind: input.artifactKind,
    requestId: input.requestId,
    schemaVersion: input.schemaVersion,
    occurredAt: input.occurredAt,
  });
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalEvent),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('');
}
