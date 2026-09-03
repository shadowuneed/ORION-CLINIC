import { describe, expect, it } from 'vitest';
import { hashAuditEvent } from './event-hash';
import { hashAccessAuditEvent } from './access-event-hash';

const input = {
  previousHash: null,
  organizationId: 'org-a',
  facilityId: 'fac-a',
  streamKey: 'membership:membership-a',
  sequence: 1,
  actorUserId: 'user-a',
  actorMembershipId: 'membership-a',
  actorRole: 'clinician' as const,
  action: 'workspace.read' as const,
  outcome: 'succeeded' as const,
  purposeCode: 'synthetic_direct_patient_care' as const,
  routeCode: 'workspace' as const,
  decisionCode: 'authorized_response_prepared',
  responseStatus: 200,
  encounterId: 'encounter-a',
  documentArtifactId: null,
  artifactKind: null,
  requestId: 'request-a',
  schemaVersion: 1,
  occurredAt: 1_788_250_000_000,
};

describe('access audit event hash', () => {
  it('is deterministic and binds the previous hash and protected resource', async () => {
    const first = await hashAccessAuditEvent(input);
    const same = await hashAccessAuditEvent({ ...input });
    const next = await hashAccessAuditEvent({
      ...input,
      previousHash: first,
      sequence: 2,
      requestId: 'request-b',
    });
    const anotherEncounter = await hashAccessAuditEvent({
      ...input,
      encounterId: 'encounter-b',
    });

    expect(first).toMatch(/^[a-f0-9]{64}$/);
    expect(same).toBe(first);
    expect(next).not.toBe(first);
    expect(anotherEncounter).not.toBe(first);
  });

  it('uses a separate hash domain from the clinical audit chain', async () => {
    const accessHash = await hashAccessAuditEvent(input);
    const clinicalHash = await hashAuditEvent({
      previousHash: null,
      organizationId: input.organizationId,
      facilityId: input.facilityId,
      sequence: input.sequence,
      actorType: 'user',
      actorId: input.actorUserId,
      actorMembershipId: input.actorMembershipId,
      action: input.action,
      outcome: input.outcome,
      purpose: input.purposeCode,
      schemaVersion: input.schemaVersion,
      entityType: 'encounter',
      entityId: input.encounterId,
      requestId: input.requestId,
      metadataJson: '{}',
      occurredAt: input.occurredAt,
    });

    expect(accessHash).not.toBe(clinicalHash);
  });
});
