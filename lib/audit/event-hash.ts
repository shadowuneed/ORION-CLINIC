export type AuditEventHashInput = {
  previousHash: string | null;
  organizationId: string;
  facilityId: string;
  sequence: number;
  actorType: 'user' | 'service';
  actorId: string;
  actorMembershipId: string | null;
  action: string;
  outcome: 'succeeded' | 'denied' | 'failed';
  purpose: string;
  schemaVersion: number;
  entityType: string;
  entityId: string;
  requestId: string;
  metadataJson: string;
  occurredAt: number;
};

export async function hashAuditEvent(input: AuditEventHashInput) {
  const canonicalEvent = JSON.stringify({
    hashSchemaVersion: 1,
    previousHash: input.previousHash,
    organizationId: input.organizationId,
    facilityId: input.facilityId,
    sequence: input.sequence,
    actorType: input.actorType,
    actorId: input.actorId,
    actorMembershipId: input.actorMembershipId,
    action: input.action,
    outcome: input.outcome,
    purpose: input.purpose,
    schemaVersion: input.schemaVersion,
    entityType: input.entityType,
    entityId: input.entityId,
    requestId: input.requestId,
    metadataJson: input.metadataJson,
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
