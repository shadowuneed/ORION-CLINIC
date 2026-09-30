import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import {
  evaluatePatientProtocolRelease, PATIENT_PROTOCOL_PROJECTION_POLICY, patientProtocolSectionCodes,
} from './patient-protocol';

const now = 10_000;
const scope = { organizationId: 'org-a', facilityId: 'facility-a', patientId: 'patient-a' };
const hash = (text: string) => createHash('sha256').update(text, 'utf8').digest('hex');

function content() {
  return {
    schemaVersion: 1, dataMode: 'synthetic-only',
    encounter: { id: 'encounter-a', sourceVersion: 3, reasonForVisit: 'Not projected' },
    patient: { displayName: 'Синтетический пациент Ә', medicalRecordNumber: 'PRIVATE-MRN', birthDate: 'PRIVATE-DOB' },
    clinicianMembershipId: 'private-membership',
    sections: patientProtocolSectionCodes.map(code => ({
      code, content: `  Текст: ${code}. Қазақша\n`, reviewState: 'reviewed',
      sourceVersionId: `private-source-${code}`, version: 2,
      reviewedByMembershipId: 'reviewer-a', reviewedAt: 3_000,
    })),
    recommendations: [{
      state: 'edited_and_accepted', reviewedByMembershipId: 'reviewer-a', reviewedAt: 3_000,
      original: { title: 'UNREVIEWED-AI-TITLE', content: 'UNREVIEWED-AI-CONTENT' },
      effective: { title: 'Проверено врачом', content: '  Точное решение врача.\n', evidence: ['PRIVATE-EVIDENCE'] },
      provenance: { provider: 'PRIVATE-PROVIDER' }, sourceSuggestionId: 'PRIVATE-SUGGESTION',
    }],
    amendments: [{
      text: 'Подписанное дополнение', signedAt: 4_000, signedByMembershipId: 'reviewer-a',
      signedByDisplayName: 'Врач А', id: 'private-amendment', reason: 'PRIVATE-INTERNAL-REASON',
    }],
    transcript: { included: true, consentEventId: 'PRIVATE-CONSENT', segments: ['PRIVATE-TRANSCRIPT'] },
    auditEvents: ['PRIVATE-AUDIT'], objectKey: 'PRIVATE-OBJECT',
  };
}

function fixture() {
  const contentJson = JSON.stringify(content());
  return {
    now,
    principal: {
      audience: 'patient', verification: 'server_verified', actorId: 'actor-a',
      issuer: 'orion:patient', subject: 'subject-a', identityVersion: 2,
      sessionId: 'session-a', status: 'active', expiresAt: now + 1,
    },
    relationship: {
      id: 'relationship-a', version: 3, kind: 'self', eligibility: 'adult_self',
      status: 'active', purpose: 'protocol.read', actorId: 'actor-a',
      issuer: 'orion:patient', subject: 'subject-a', identityVersion: 2, ...scope,
      verifiedAt: 1_000, validFrom: 2_000, expiresAt: null, revokedAt: null,
    },
    release: {
      id: 'release-a', version: 4, status: 'released', audience: 'patient_self', ...scope,
      encounterId: 'encounter-a', protocolId: 'protocol-a', protocolVersion: 5,
      sourceHash: hash(contentJson), projectionPolicy: PATIENT_PROTOCOL_PROJECTION_POLICY,
      releasedAt: 6_000, effectiveAt: 7_000, expiresAt: null, revokedAt: null,
    },
    source: {
      ...scope, encounterId: 'encounter-a', encounterStatus: 'finalized',
      protocolId: 'protocol-a', protocolVersion: 5, status: 'signed',
      sourceHash: hash(contentJson), signedAt: 5_000, signedByDisplayName: 'Врач А', contentJson,
    },
    current: {
      actorId: 'actor-a', sessionId: 'session-a', identityVersion: 2,
      relationshipId: 'relationship-a', relationshipVersion: 3,
      releaseId: 'release-a', releaseVersion: 4, signedProtocolId: 'protocol-a',
      organizationStatus: 'active', facilityStatus: 'active', patientStatus: 'active',
    },
  };
}

type Fixture = ReturnType<typeof fixture>;
type Mutation = (input: Fixture) => void;

function replaceContent(input: Fixture, mutate: (value: ReturnType<typeof content>) => void) {
  const value = content();
  mutate(value);
  input.source.contentJson = JSON.stringify(value);
  input.source.sourceHash = hash(input.source.contentJson);
  input.release.sourceHash = input.source.sourceHash;
}

describe('future own-patient protocol boundary (pure, unmounted)', () => {
  it('allows an exact released current signed version, preserving reviewed clinical text only', async () => {
    const input = fixture();
    const decision = await evaluatePatientProtocolRelease(input);
    expect(decision.allowed).toBe(true);
    if (!decision.allowed) throw new Error('Expected the synthetic own-patient grant');
    expect(decision.projection).toEqual({
      schemaVersion: 1, dataMode: 'synthetic-only', projectionPolicy: PATIENT_PROTOCOL_PROJECTION_POLICY,
      release: { id: 'release-a', version: 4, releasedAt: 6_000 },
      protocol: { id: 'protocol-a', version: 5, sourceHash: input.source.sourceHash, signedAt: 5_000, signedByDisplayName: 'Врач А' },
      patient: { displayName: 'Синтетический пациент Ә' },
      sections: content().sections.map(section => ({
        code: section.code, content: section.content, reviewState: section.reviewState,
      })),
      recommendations: [{ title: 'Проверено врачом', content: '  Точное решение врача.\n' }],
      amendments: [{ text: 'Подписанное дополнение', signedAt: 4_000, signedByDisplayName: 'Врач А' }],
    });
    const output = JSON.stringify(decision);
    expect(output).not.toMatch(/PRIVATE-|private-|UNREVIEWED-AI|subject-a|session-a|relationship-a/);
    expect(output).not.toMatch(/medicalRecordNumber|birthDate|transcript|provenance|evidence|reason|objectKey/);
  });

  it('supports explicit absence, accepted recommendations and exact start boundaries', async () => {
    const input = fixture();
    input.relationship.validFrom = now;
    input.relationship.verifiedAt = now;
    input.release.effectiveAt = now;
    replaceContent(input, value => {
      value.sections[0].reviewState = 'explicitly_absent';
      value.sections[0].content = '';
      value.recommendations[0].state = 'accepted';
    });
    expect((await evaluatePatientProtocolRelease(input)).allowed).toBe(true);
  });

  it('allows explicitly empty reviewed arrays without inventing recommendations or amendments', async () => {
    const input = fixture();
    replaceContent(input, value => { value.recommendations = []; value.amendments = []; });
    const decision = await evaluatePatientProtocolRelease(input);
    expect(decision.allowed && decision.projection.recommendations).toEqual([]);
    expect(decision.allowed && decision.projection.amendments).toEqual([]);
  });

  const denials: Array<[string, Mutation]> = [
    ['staff audience', x => { x.principal.audience = 'staff'; }],
    ['caregiver audience', x => { x.principal.audience = 'caregiver'; }],
    ['unverified identity', x => { x.principal.verification = 'client_claimed'; }],
    ['disabled identity', x => { x.principal.status = 'disabled'; }],
    ['expiry at exact server time', x => { x.principal.expiresAt = now; }],
    ['other authenticated actor', x => { x.principal.actorId = 'actor-b'; }],
    ['other identity issuer', x => { x.principal.issuer = 'other:issuer'; }],
    ['other identity subject', x => { x.principal.subject = 'subject-b'; }],
    ['stale identity version', x => { x.current.identityVersion += 1; }],
    ['another current actor', x => { x.current.actorId = 'actor-b'; }],
    ['another current session', x => { x.current.sessionId = 'session-b'; }],
    ['caregiver relationship', x => { x.relationship.kind = 'caregiver'; }],
    ['minor eligibility', x => { x.relationship.eligibility = 'minor'; }],
    ['pending patient link', x => { x.relationship.status = 'pending'; }],
    ['wrong patient-link purpose', x => { x.relationship.purpose = 'appointments.read'; }],
    ['stale link identity version', x => { x.relationship.identityVersion -= 1; }],
    ['expired patient link', x => { Object.assign(x.relationship, { expiresAt: now }); }],
    ['revoked patient link even with active status', x => { Object.assign(x.relationship, { revokedAt: 9_000 }); }],
    ['not yet effective patient link', x => { x.relationship.validFrom = now + 1; }],
    ['patient-link verification after validity start', x => { x.relationship.verifiedAt = 2_001; }],
    ['stale relationship version', x => { x.current.relationshipVersion += 1; }],
    ['replaced relationship identity', x => { x.current.relationshipId = 'relationship-new'; }],
    ['another relationship patient', x => { x.relationship.patientId = 'patient-b'; }],
    ['another relationship facility', x => { x.relationship.facilityId = 'facility-b'; }],
    ['another relationship organization', x => { x.relationship.organizationId = 'org-b'; }],
    ['suspended organization', x => { x.current.organizationStatus = 'suspended'; }],
    ['suspended facility', x => { x.current.facilityStatus = 'suspended'; }],
    ['inactive patient', x => { x.current.patientStatus = 'archived'; }],
    ['signed but unpublished protocol', x => { x.release.status = 'pending'; }],
    ['withdrawn release even with released status', x => { Object.assign(x.release, { revokedAt: 9_000 }); }],
    ['expired publication at exact boundary', x => { Object.assign(x.release, { expiresAt: now }); }],
    ['future publication', x => { x.release.effectiveAt = now + 1; }],
    ['publication effective before release', x => { x.release.releasedAt = 7_001; }],
    ['publication before signature', x => { x.release.releasedAt = 4_999; }],
    ['stale release version', x => { x.current.releaseVersion += 1; }],
    ['replaced release identity', x => { x.current.releaseId = 'release-new'; }],
    ['other release audience', x => { x.release.audience = 'caregiver'; }],
    ['unknown projection policy', x => { x.release.projectionPolicy = 'other-policy'; }],
    ['cross-patient source', x => { x.source.patientId = 'patient-b'; }],
    ['cross-facility source', x => { x.source.facilityId = 'facility-b'; }],
    ['cross-organization source', x => { x.source.organizationId = 'org-b'; }],
    ['cross-encounter source', x => { x.source.encounterId = 'encounter-b'; }],
    ['other protocol id', x => { x.source.protocolId = 'protocol-b'; }],
    ['other protocol version', x => { x.source.protocolVersion += 1; }],
    ['new signed head without explicit new release', x => { x.current.signedProtocolId = 'protocol-new'; }],
    ['draft source', x => { x.source.status = 'draft'; }],
    ['unfinished encounter', x => { x.source.encounterStatus = 'in_progress'; }],
    ['mismatched pinned hash', x => { x.release.sourceHash = '0'.repeat(64); }],
    ['corrupted bytes', x => { x.source.contentJson += ' '; }],
    ['hash with trailing newline', x => { x.source.sourceHash += '\n'; x.release.sourceHash = x.source.sourceHash; }],
    ['invalid JSON with matching hash', x => {
      x.source.contentJson = '{'; x.source.sourceHash = hash('{'); x.release.sourceHash = x.source.sourceHash;
    }],
    ['overlarge source JSON', x => { x.source.contentJson = ' '.repeat(2_000_001); }],
    ['invalid clock', x => { x.now = Number.NaN; }],
    ['unsafe timestamp', x => { x.now = Number.MAX_SAFE_INTEGER + 1; }],
    ['fractional version', x => { x.relationship.version = 3.5; }],
    ['client header masquerading as principal', x => { Object.assign(x.principal, { 'oai-authenticated-user-id': 'actor-a' }); }],
    ['client-selected patient id', x => { Object.assign(x, { patientId: 'patient-b' }); }],
  ];

  it.each(denials)('denies %s without returning any record metadata', async (_name, mutate) => {
    const input = fixture();
    mutate(input);
    expect(await evaluatePatientProtocolRelease(input)).toEqual({ allowed: false });
  });

  it.each(['principal', 'relationship', 'release', 'source', 'current', 'now'] as const)(
    'requires %s (no optional permissive authorization inputs)', async key => {
      const input: Record<string, unknown> = fixture();
      delete input[key];
      expect(await evaluatePatientProtocolRelease(input)).toEqual({ allowed: false });
    },
  );

  const contentDenials: Array<[string, (value: ReturnType<typeof content>) => void]> = [
    ['different encounter', x => { x.encounter.id = 'encounter-b'; }],
    ['real data mode', x => { x.dataMode = 'real'; }],
    ['unknown content version', x => { x.schemaVersion = 2; }],
    ['missing clinical section', x => { x.sections.pop(); }],
    ['duplicate clinical code among eight sections', x => { x.sections[1].code = x.sections[0].code; }],
    ['unreviewed section', x => { x.sections[0].reviewState = 'draft'; }],
    ['section without human reviewer', x => { Object.assign(x.sections[0], { reviewedByMembershipId: null }); }],
    ['absence without human reviewer', x => { Object.assign(x.sections[0], { reviewState: 'explicitly_absent', reviewedByMembershipId: null }); }],
    ['section reviewed after signature', x => { x.sections[0].reviewedAt = 5_001; }],
    ['unreviewed AI recommendation', x => { x.recommendations[0].state = 'proposed'; }],
    ['rejected recommendation', x => { x.recommendations[0].state = 'rejected'; }],
    ['accepted recommendation without reviewer', x => { Object.assign(x.recommendations[0], { reviewedByMembershipId: null }); }],
    ['accepted recommendation without effective text', x => { Object.assign(x.recommendations[0], { effective: undefined }); }],
    ['recommendation reviewed after signature', x => { x.recommendations[0].reviewedAt = 5_001; }],
    ['amendment signed after protocol', x => { x.amendments[0].signedAt = 5_001; }],
    ['amendment without signer', x => { Object.assign(x.amendments[0], { signedByMembershipId: null }); }],
    ['missing recommendations array', x => { Object.assign(x, { recommendations: undefined }); }],
    ['missing amendments array', x => { Object.assign(x, { amendments: undefined }); }],
  ];

  it.each(contentDenials)('denies signed content with %s', async (_name, mutate) => {
    const input = fixture();
    replaceContent(input, mutate);
    expect(await evaluatePatientProtocolRelease(input)).toEqual({ allowed: false });
  });

  it('keeps patients with the same audience distinct', async () => {
    const input = fixture();
    Object.assign(input.principal, { actorId: 'actor-b', subject: 'subject-b', sessionId: 'session-b' });
    Object.assign(input.current, { actorId: 'actor-b', sessionId: 'session-b' });
    Object.assign(input.relationship, { actorId: 'actor-b', subject: 'subject-b', patientId: 'patient-b' });
    expect(await evaluatePatientProtocolRelease(input)).toEqual({ allowed: false });
  });

  it('does not mutate its snapshots or retain old output as authority for a later revoked read', async () => {
    const input = fixture();
    const original = structuredClone(input);
    expect((await evaluatePatientProtocolRelease(input)).allowed).toBe(true);
    expect(input).toEqual(original);
    Object.assign(input.relationship, { revokedAt: now });
    expect(await evaluatePatientProtocolRelease(input)).toEqual({ allowed: false });
    expect(input.source.contentJson).toBe(original.source.contentJson);
  });

  it('propagates operational crypto failure without returning a projection or a fallback identity', async () => {
    const digest = vi.spyOn(crypto.subtle, 'digest').mockRejectedValueOnce(new Error('crypto unavailable'));
    try { await expect(evaluatePatientProtocolRelease(fixture())).rejects.toThrow('crypto unavailable'); }
    finally { digest.mockRestore(); }
  });
});
