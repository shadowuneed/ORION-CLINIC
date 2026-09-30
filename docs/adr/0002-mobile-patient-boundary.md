# ADR-0002: Separate patient identity and explicit protocol publication

- Status: Accepted for the isolated synthetic engineering contract below. Clinical publication policy, patient identity adapters and runtime activation remain pending.
- Date: 2026-09-24
- Scope: MOBILE-1/M0 groundwork for M1; not a mobile application or a completed patient API.
- Related decisions: [MASTER_PLAN](../MASTER_PLAN.md), DEC-008/009/010/011/017/018; [mobile application plan](../operations/mobile-application-plan.md); [requirements audit](../operations/requirements-audit-2026-09-24.md).

## Context

ORION has immutable signed clinical protocol versions, scoped staff reads, source integrity checks and fail-closed access auditing. These are useful foundations, but they do not establish a patient's identity, their relationship to a clinical record, or permission to publish that record to a patient application. Signing a protocol and releasing a patient-facing view are separate decisions.

Existing web identities, staff sessions and facility assignments must not become patient credentials by selecting a `patientId`. A matching name, email, medical record number or demographic value is not a verified patient relationship. Native clients must not manufacture Sites identity headers, use a local development identity, or imitate a staff workspace membership.

The first bounded use case is an adult synthetic patient reading an explicitly released view of their own current signed protocol. Caregiver, guardian/minor and staff-companion access are deliberately outside this first contract. This does not make the application, speech or biometrics a prerequisite for clinical care; the wider plan retains accessible, assisted and non-app paths.

## Decision

### 1. Separate authentication, patient relationship and publication

All three must be present and current; none substitutes for another:

| Fact | Authoritative future source | Required boundary |
| --- | --- | --- |
| Authenticated patient principal | Approved patient identity/session adapter | Patient audience, active session, immutable actor/issuer/subject binding and current identity version; not a staff session re-labelled by the client |
| Verified self relationship | Clinic-controlled patient-link workflow under DEC-017 | Exact actor identity, organization, facility and patient; verified adult-self eligibility, `protocol.read` purpose, version, validity interval and terminal revocation |
| Explicit patient publication | Authorized clinic publication workflow | Exact patient/encounter, signed protocol ID/version/source hash, allowed projection policy, release version, validity interval and withdrawal state |

The relationship grant is not created by this read. Establishing, correcting or replacing a link needs independently verified evidence and an audited authorized workflow. No automatic email/name/identifier matching, cross-facility expansion or family-account inference is allowed. A corrected relationship receives a new identity/version; a revoked grant must not be restored through an active/inactive toggle. A future patient identity may share an identity provider with staff, but audience, credential acceptance and authorization remain separate.

Publication is a version-pinned grant to the patient, not a grant to a particular phone or an implicit grant to any representative. A current self relationship must still authorize every read. The future release record needs the releasing actor, authority and policy evidence in its durable audit; the pure evaluator does not prove those facts. A clinician-approved patient-publication policy, including sensitive content and amendment wording, is **unresolved** under DEC-010/011/017. The contract's synthetic policy identifier is not that approval.

### 2. Read a pinned signed source, not the general workspace

The first read uses the exact `protocol_versions` row pinned by the release and requires it to equal `protocol_heads.current_signed_protocol_version_id`. A newer signed version makes the previous release unavailable through this current-view contract; it does not grant access to the new version. A draft is never returned. There is no fallback to another version, encounter, patient or facility.

This first endpoint is not a historical-record access policy: future history/previous-version access needs explicit release rules and accurate version labels. Clinical correction does not delete the old immutable source. Legal rights to copies and the clinic's alternative provision workflow must be settled by the clinic, not inferred from this technical restriction.

Patient ownership is resolved through the scoped DB join `protocol_versions → encounters.patient_id → patients`, not from display text in the signed JSON. The JSON currently contains patient demographics but no authoritative patient ID. The adapter must validate the full signed source, signed lifecycle, scoped joins and current active patient/facility/organization; the pure contract also recomputes SHA-256 over the exact input string and checks the pinned hash and encounter ID.

### 3. Construct a patient-specific allowlisted view

The initial projection is `synthetic_patient_protocol_view_v1`, schema version 1, `dataMode: synthetic-only`. It is an explicitly selected clinical view, **not** a full legal document copy, export bundle or original-file download.

Included fields:

- Release ID/version/time and signed protocol ID/version/hash/signature time/clinician display name.
- Patient display name from the pinned clinical snapshot; identity linking does not rely on that name.
- Exactly one of each of the eight clinical section codes, with exact recorded text and `reviewed` or `explicitly_absent` state. A human reviewer and review time are required, including explicit absence; an unreviewed or duplicate/missing section denies the whole view.
- Only `accepted` or `edited_and_accepted` recommendations, using the exact effective clinician-approved title/content, not the original suggestion. Missing reviewer/time/effective content or a proposed/rejected recommendation denies the whole view; it is not silently filtered into an apparently complete protocol.
- Signed amendment text, signer display name and signature time, no internal amendment reason. Clinical review/signature timestamps cannot be later than the signed protocol.

Excluded: raw transcript/audio, evidence quotes/source IDs, original AI suggestions, model/provider provenance, internal amendment reasons, MRN/birth date, identity/session/relationship IDs, staff membership IDs, audit payloads, object-storage keys and existing download URLs. New unknown source fields are not automatically published. The mapper constructs each output field and preserves reviewed clinical text without rewriting or translating it. Clinician approval is still required for the actual patient-facing content policy; a structural allowlist cannot recognize every sensitive fact embedded in clinical prose.

The first pure contract bounds JSON to 2,000,000 characters, section/recommendation text to 80,000 characters, recommendation titles and amendment text to 8,000 characters, and recommendation/amendment arrays to 100 each. Exceeding these bounds denies rather than truncates clinical content. They are engineering test limits, not a clinical document-length policy; the eventual API also needs byte/request limits before expensive parsing.

### 4. Enforce current authority at the publication boundary

The future server flow is:

1. Resolve an authenticated patient principal from the approved credential adapter. Do not accept the pure contract input as a request body.
2. Resolve the current self relationship, release and exact scoped signed source. Resolve current identity/link/release/head versions independently of the initially loaded snapshots. Use server/DB time; the client cannot supply authoritative time or scope.
3. Evaluate authorization and construct the bounded view; validate source integrity and publication policy. Missing or malformed required inputs deny; no permissive defaults.
4. Durably record an access-preparation event with exact actor, purpose, resource and relationship/release/source version pins. Commit-time guards and a checked audit head must reject partial/ignored publication, cross-scope data and stale pins.
5. Recheck current session, relationship, release, signed head and scope after audit, immediately before returning protected bytes. A changed/revoked/expired snapshot denies, and retry must reload all authority rather than reuse an old successful projection.

The future audit stream must identify the patient actor and relationship independently; do not fabricate a staff membership to satisfy `D1AccessAuditRepository`. Design its schema/transaction guards as a separate M1 task. Audit means authorization/response preparation, not proven receipt or that a person read the record.

The final authorization observation is the response's defined ordering point. A concurrent revocation committed before that check must prevent the response; revocation after it cannot retroactively retract bytes already released. Do not promise instantaneous deletion from a recipient's screen/device. Persistent offline copies and their revocation/retention limits remain M4/DEC-018, not this contract.

### 5. Keep the transport narrow and non-enumerating

The proposed first read is an opaque release-ID lookup, for example `GET /api/mobile/v1/protocol-releases/:releaseId`; **no route is mounted by this ADR**. The final name is an adapter decision. A release ID is a selector, never a credential. No public patient lookup, general encounter payload, directory, export ZIP, direct object URL or arbitrary return URL accompanies it.

Proposed transport behavior: no identity → 401; authenticated but missing/foreign/unreleased/unavailable-to-that-subject resource → the same non-enumerating 404 shape; operational DB/audit/crypto failure → unavailable/error, never an authenticated fallback or success with stale data. Malformed selectors are rejected before lookup without resource metadata. Use `Cache-Control: no-store`, no shared/public cache, and no conditional 304 shortcut in the first adapter. Source hashes, names, counts and scope identifiers must not leak on denied responses. Logs use opaque request IDs and bounded internal failure codes, not clinical content, credentials or complete contract inputs.

## Existing-code mapping and changes deliberately not made

| Current implementation | Reuse or boundary for the first slice |
| --- | --- |
| [`db/schema.ts`](../../db/schema.ts): `encounters`, `protocolVersions`, `protocolHeads` | Existing scoped patient link and immutable source/signature metadata. Patient-account relationships and publication records are new concepts, not fields to infer from these tables. No schema change in this checkpoint. |
| [`lib/auth/workspace-access.ts`](../../lib/auth/workspace-access.ts), [`encounter-read-access.ts`](../../lib/auth/encounter-read-access.ts) | Staff membership/assignment authorization remains intact. No patient exception or new role is added to this guard. |
| [`D1ProtocolReviewRepository.getCurrentPreview`](../../lib/repositories/protocol-review.ts), [`ProtocolPreview`](../../lib/domain/protocol-preview.ts) | Demonstrate integrity-checked projection, but use staff scope/current head, allow draft status and include amendment reasons. Do not expose this DTO or method directly to patients. |
| [`signedProtocolContentSchema`](../../lib/documents/protocol-artifacts.ts) | Source format and eight clinical codes. Full source also contains transcript/provenance/evidence; it is not a patient response schema. The new pure module has no dependency on document-generation code. |
| [`D1DocumentExportRepository`](../../lib/repositories/document-export.ts), [`download route`](../../app/api/workspace/exports/download/route.ts) | Reuse the design pattern of exact current signed source, integrity checks and final authorization around audited response preparation. Existing staff export artifacts and access checks do not authorize patient downloads. |
| [`D1AccessAuditRepository`](../../lib/repositories/access-audit.ts), [`workspace route`](../../app/api/workspace/route.ts) | Reference for fail-closed access audit and recheck. Current stream is staff-membership-bound, so a patient adapter needs its own correct actor model and transactional guards. |

## Executable contract delivered in this checkpoint

[`lib/mobile/patient-protocol.ts`](../../lib/mobile/patient-protocol.ts) exports:

```ts
evaluatePatientProtocolRelease(input: unknown): Promise<
  | { allowed: false }
  | { allowed: true; projection: PatientProtocolProjection }
>
```

Inputs are trusted server-resolved `principal`, `relationship`, `release`, `source`, independent `current` version pins and `now`. Validation accepts patient/adult-self scope only; all required fields must exist. The function has no I/O, session issuance, persistence, clinical mutations, audit writes or runtime activation. Its only package dependency is existing `zod`; source hashing uses WebCrypto. An operational crypto exception propagates instead of being disguised as an unauthenticated fallback.

**Limits:** validation cannot authenticate a caller, establish patient identity, prove a clinician's authority, make a stale DB read fresh, prevent a later revocation race, or replace a durable release/audit transaction. The text `server_verified` in a supplied object is an adapter assertion, not cryptographic evidence. Current version pins only detect disagreement with the independently supplied current facts. Neither a TypeScript type nor a passing test authorizes a response. This function must not be wired to HTTP JSON or called client-side as a security control.

[`lib/mobile/patient-protocol.test.ts`](../../lib/mobile/patient-protocol.test.ts) uses isolated in-memory synthetic objects, not a database or clinical fixtures. It covers exact accepted projection/field exclusion; two subjects with the same audience; staff/caregiver/minor denial; missing, expired, revoked and stale grants; wrong patient/facility/organization/encounter; unpublished/new signed versions; integrity mismatch; duplicate/missing/unreviewed sections; original/proposed/rejected AI content; absent human review; absent arrays; invalid chronology; stable expiry boundaries; source bounds; and operational crypto failure. These are pure unit tests, not DB durability, race, HTTP, native-device or production evidence.

## Next bounded vertical slice and acceptance gates

1. **M1 identity/link/release persistence design:** approve the concrete adapter data contract and migration ownership with the auth/schema work; add isolated DB relationships, explicit synthetic publication events and terminal revoke/version guards. Keep existing staff guards unchanged. DEC-017 verification/delegation policy must be resolved before real patient linking; it does not block synthetic local engineering.
2. **M1 server read and patient audit:** implement scoped joins/full source validation, new actor-aware audit, atomic publication assertions and final current recheck. Test with the complete migration chain, a unique temporary file DB, close/reopen and two connections. Prove cross-patient denial, terminal revoke/restore behavior, new-version non-disclosure, audit failure/ignored writes, stale snapshot and revoke-before-final-check races. Test responses without exposing metadata on denial. No test fixture is a deployment credential.
3. **M2 genuine read-only native slice:** only after the protected API/auth gates, install internal iOS and Android builds against that backend: patient A reads their released document, relaunches, then loses access after revoke; patient B and an unauthorized representative cannot open the same deep link. Test physical-device VoiceOver/TalkBack, large text and non-voice access. No sensitive offline cache in this first slice.

No patient endpoint, identity provider, mobile skeleton, native dependency, account, service, database migration or deployment is introduced here. M0 has an executable boundary; M1 and the application remain unimplemented. Work stays in the existing ORION-CLINIC repository and approved resources; the absolute prohibition on all dir echoes resources remains in force. This ADR does not require repetitive approval of ordinary safe local work, but it does not authorize real data, clinical publication, external accounts/resources or store release.

## Verification for this checkpoint

- Full current AGENTS/MASTER_PLAN/mobile plan and the source mapping above were read.
- Focused contract tests: **87/87 passed**.
- Focused ESLint and `pnpm typecheck`: passed on the shared snapshot.
- ADR relative links, new-file whitespace and `git diff --check`: passed. Search confirms no application/runtime import of the new module; its only caller is the focused test file.
- No DB, provider, device, HTTP or runtime verification was performed or claimed. Aggregate gates remain a separate integration checkpoint.
