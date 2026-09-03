import { describe, expect, it } from 'vitest';
import { hashAuditEvent, type AuditEventHashInput } from './event-hash';

const baseEvent: AuditEventHashInput = {
  previousHash: null,
  organizationId: 'org-a',
  facilityId: 'fac-a',
  sequence: 1,
  actorType: 'user',
  actorId: 'user-a',
  actorMembershipId: 'membership-a',
  action: 'clinical_section.mark_reviewed',
  outcome: 'succeeded',
  purpose: 'synthetic_clinical_documentation',
  schemaVersion: 1,
  entityType: 'clinical_section_version',
  entityId: 'section-v2',
  requestId: 'request-a',
  metadataJson: '{"contentHash":"hash-a"}',
  occurredAt: 1000,
};

describe('hashAuditEvent', () => {
  it('is deterministic for the same canonical event', async () => {
    expect(await hashAuditEvent(baseEvent)).toBe(await hashAuditEvent(baseEvent));
  });

  it('binds metadata and the previous hash', async () => {
    const original = await hashAuditEvent(baseEvent);
    expect(
      await hashAuditEvent({ ...baseEvent, metadataJson: '{"contentHash":"hash-b"}' }),
    ).not.toBe(original);
    expect(
      await hashAuditEvent({ ...baseEvent, previousHash: 'previous-event' }),
    ).not.toBe(original);
  });
});
