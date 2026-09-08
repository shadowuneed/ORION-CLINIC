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
  accessAssignmentId?: string | null;
};

export async function hashAccessAuditEvent(input: AccessAuditEventHashInput) {
  if (input.schemaVersion !== 1 && input.schemaVersion !== 2) throw new Error('Unsupported access audit schema');
  if (input.schemaVersion === 2 && !input.accessAssignmentId) throw new Error('Access audit assignment required');
  const canonicalEvent = JSON.stringify({
    hashDomain: input.schemaVersion === 2 ? 'orion.access-audit.v2' : 'orion.access-audit.v1',
    ...(input.schemaVersion === 2 ? { accessAssignmentId: input.accessAssignmentId } : {}),
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
