# ORION Clinic — Master implementation and AI handoff plan

- Last updated: 2026-09-06
- Plan owner: product owner + clinical lead
- Current implementation agent: Codex
- Repository: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC`
- Legacy reference: `C:\Users\profm\OneDrive\Документы\ChatGPT\ariaproject`

## 0. Purpose and continuation protocol

This document is the canonical source of truth for ORION Clinic. It is written
so another engineer or AI agent can continue without access to the previous
conversation.

Before any change, the next agent must:

1. Read this file and root `AGENTS.md` completely.
2. Run `git status --short`, `git diff --stat`, and `git diff --check`.
3. Confirm the active phase and the single next task in **Current checkpoint**.
4. Inspect linked ADRs before changing an accepted architecture decision.
5. Use synthetic data only unless a later signed gate says otherwise.
6. Avoid touching the legacy checkout unless the active task is an explicit,
   reviewed migration.
7. Update the verification ledger and last handoff before ending work.

Status values:

- `NOT_STARTED`: no implementation work has begun.
- `IN_PROGRESS`: work exists but its acceptance gate is not satisfied.
- `BLOCKED`: a named decision or external dependency prevents safe progress.
- `DONE`: implementation and listed verification both pass.
- `DEFERRED`: intentionally postponed with a reason and dependency.

`DONE` is forbidden without changed-file evidence, an executable verification
command, its result, and known limitations.

## 1. Product mission

ORION Clinic is a clinician-controlled platform for the complete patient care
workflow, not a chat bot and not an autonomous diagnostic system.

Target flow:

```text
patient identification
  -> consent and encounter
  -> RU/KZ conversation capture
  -> reviewed structured clinical note
  -> signed protocol
  -> orders and referrals
  -> real scheduling and electronic queue
  -> care plan and follow-up
  -> patient communication and nurse tasks
  -> risk monitoring
  -> controlled inter-hospital handoff
```

Initial clinic-requested clinical sections:

1. Complaints.
2. History of present illness.
3. Past medical and life history.
4. Allergy status.
5. Objective findings.
6. Preliminary diagnosis.
7. Examination plan.
8. Treatment and correction plan.

Additional requested workflows include laboratory tests, ECG, specialist
referrals, available appointments, electronic queue, chronic-care enrollment,
medication and diet plans, repeated examinations, nurse follow-up, reminders,
free-medication accounting, pre-visit BMI and blood pressure, critical-patient
transfer, and a longitudinal handoff summary described by the client as a
"digital twin".

## 2. Non-negotiable clinical boundaries

AI may:

- transcribe speech and propose a speaker role;
- structure draft documentation from confirmed input;
- highlight missing information and propose clarifying questions;
- propose investigation, treatment, safety, and routing options;
- summarize only trusted, selected patient records;
- rank real slots returned by a scheduling source;
- draft reminders from an already signed care plan;
- draft a transfer summary from approved records.

AI must not independently:

- establish or communicate a final diagnosis;
- start, stop, or dose medication;
- sign a clinical document;
- issue a referral or place a patient on a registry;
- book an appointment without the required doctor/patient confirmation;
- assign a critical status;
- transfer a patient or disclose data to another organization;
- write directly to KMIS, ERDB, queue, pharmacy, or hospital systems.

Every AI artifact must store:

- `provider`, model identifier, and model version;
- prompt/policy version;
- input hash and source record identifiers;
- structured raw result and validation result;
- `DRAFT`, `ACCEPTED`, `EDITED`, `REJECTED`, or `EXPIRED` state;
- reviewer, review time, and immutable original content;
- the deterministic command created after approval, if any.

Rejected material is retained in audit and excluded from the signed protocol.

## 3. Legacy baseline and migration rule

The legacy ORION prototype is preserved. Verified reusable concepts:

- local GigaAM multilingual RU/KZ STT;
- short-utterance VAD and a local speech service;
- CAMPPlus-based doctor/patient voice mapping with manual correction;
- Groq JSON-schema analysis and evidence segment identifiers;
- doctor-only accept/edit/reject controls and rejected-item basket;
- local audio, transcript, audit, Word-compatible, and ZIP exports.

Known limitations that must not be copied as production architecture:

- browser IndexedDB as the authoritative record;
- shared/default "Doctor" identity or development auth bypass;
- public ngrok as an access-control mechanism;
- final RTF instead of a verified DOCX/PDF document pipeline;
- one-page state as a patient longitudinal record;
- direct coupling between UI, STT timing, and AI analysis;
- secrets or real patient material in tracked files or logs.

Migration procedure for each reusable component:

1. Record source files and dependency/license inventory.
2. Write the new interface and acceptance tests first.
3. Copy the smallest implementation unit, not the full directory.
4. Remove legacy environment, UI, and persistence assumptions.
5. Run RU/KZ quality and failure-mode tests.
6. Record the result and remaining limitations here.

## 4. Architecture target

Start with a modular monolith and explicit ports. Target logical components:

```text
Clinician / Nurse / Registrar / Admin web clients
                       |
                 API boundary
                       |
  Identity | Patients | Encounters | Documentation | Orders
  Scheduling | Queue | Care plans | Monitoring | Transfer
                       |
      PostgreSQL + object storage + transactional outbox
                       |
                  Background worker
                       |
   STT | LLM | KMIS | Lab/ECG | Registry | Messaging adapters
```

Current scaffold, used for the local first slice:

- Node.js 24.19 execution baseline;
- TypeScript 5.9 strict mode;
- React 19.2 and Next 16.3 through Vinext 1.0 beta/Vite 8;
- Tailwind CSS 4 plus product-specific CSS tokens;
- Drizzle ORM;
- local D1/R2 bindings for the web slice;
- Zod contracts and Vitest tests.

Production preference, pending DEC-008:

- PostgreSQL as transactional source of truth;
- S3-compatible encrypted object storage;
- transactional outbox and a worker backed by the same database initially;
- OIDC/SAML with MFA and clinic-controlled identity;
- OpenTelemetry traces/metrics and PHI-minimized structured logs;
- containers using identical application images locally and on the server.

D1/R2 must remain behind repositories. They are not approved for real medical
data until legal, security, residency, backup, and operational requirements are
signed off.

Required provider ports:

```ts
IdentityProvider
PatientRepository
EncounterRepository
AuditRepository
ObjectStorageProvider
SpeechToTextProvider
ClinicalAnalysisProvider
DocumentRenderer
ExternalPatientRegistry
ExternalSchedulingGateway
NotificationGateway
TransferGateway
```

## 5. Product design system

The interface must look like a deliberate clinical product, not a generic AI
dashboard.

Researched references and the principles taken from them:

- Abridge: human care context, strong typographic hierarchy, clear care journey.
- Nabla: calm deep-green clinical identity and restrained surfaces.
- Heidi: approachable language and obvious review-before-signoff flow.
- Linear: compact navigation, predictable spacing, muted secondary information,
  and visible state transitions.

ORION Clinic design rules:

- neutral warm-gray canvas, white clinical work surface, deep teal identity;
- color conveys role or status, never decoration alone;
- one self-hosted Cyrillic-capable variable font (`Golos Text Variable`) plus a restrained
  system mono stack for timestamps and identifiers;
- no gradients, glassmorphism, neon, oversized hero typography, or excessive
  pill-shaped cards in the application workspace;
- 16px base readable body text; recommendations never use tiny caption text;
- continuous workspace columns and separators instead of a wall of floating
  cards;
- doctor and patient use stable accessible colors plus written labels;
- every long task has explicit idle/running/succeeded/failed state;
- keyboard focus, contrast, touch targets, and screen-reader labels are release
  requirements;
- synthetic/demo data is clearly labelled and cannot be confused with a real
  record.

## 6. Domain model and invariants

Core entities:

- organization, facility, department, user, membership, role, permission;
- patient, patient identifier, duplicate-candidate resolution;
- encounter, consent event, transcript segment, audio asset;
- structured clinical section, evidence link, clinical observation;
- analysis run, AI suggestion, review decision;
- protocol version, signature, document artifact;
- service request, referral, diagnostic report;
- provider, specialty, schedule, slot, appointment, queue ticket;
- registry enrollment, care plan, goal, medication plan, clinical task;
- notification, delivery attempt, patient channel consent;
- risk flag, acknowledgement, escalation, transfer case, handoff snapshot;
- audit event, provenance, external identifier, outbox event.

Invariants:

- all tenant-owned rows contain organization/facility scope;
- all clinical changes have actor, time, version, and provenance;
- a signed protocol is immutable; correction creates a new version;
- a final transcript segment is corrected by a new version, not overwritten;
- AI never invokes an external write adapter directly;
- every command that can be retried has an idempotency key;
- external writes have requested/confirmed/failed/reconciled states;
- unknown speaker or insufficient confidence remains visibly unverified;
- audio retention is independent from transient audio processing consent;
- no clinical product data uses browser storage as its only copy.

Encounter state machine:

```text
DRAFT -> READY -> IN_PROGRESS -> REVIEW -> FINALIZED -> AMENDED
  |                                 |
  +------------> CANCELLED <--------+
```

Suggestion state machine:

```text
PROPOSED -> ACCEPTED
         -> EDITED_AND_ACCEPTED
         -> REJECTED
         -> EXPIRED
```

Protocol state machine:

```text
DRAFT -> SIGNED -> SUPERSEDED
```

## 7. Roles and access model

Minimum roles:

- doctor: assigned patient care and clinical signing;
- nurse: assigned monitoring tasks and approved care-plan information;
- registrar: demographics, scheduling, and queue without transcript/diagnosis;
- medical lead: policy-based clinical oversight;
- organization admin: identity and configuration without automatic PHI access;
- auditor/security: access events with minimized clinical content;
- integration service: narrow machine scopes without interactive login;
- system operator: technical health without clinical-content access.

Authorization is server-side on every request and download. It combines role,
organization, facility, treatment relationship, resource state, and purpose.
High-risk emergency access requires a reason, time limit, notification, and
post-event review.

## 8. Consent, retention, and audit

Separate consent/policy decisions are required for:

- transient audio processing for STT;
- long-term audio recording;
- transcript creation and storage;
- transfer to an external AI provider;
- KMIS and inter-organization exchange;
- WhatsApp, Telegram, SMS, and telephone contact;
- de-identified quality evaluation;
- model training, which is disabled by default.

Retention is configuration and policy data, never a hard-coded guess. Before a
real pilot, the clinic must approve:

`data type -> purpose -> legal basis -> retention -> storage -> access -> deletion -> backup expiry`

Audit is server-created, append-only, and includes reads, writes, exports,
downloads, rejected requests, consent changes, AI reviews, appointments,
messages, break-glass access, and integration actions. Technical logs must not
contain full transcripts, diagnoses, identifiers, authorization headers, or
prompts with PHI.

Previously disclosed development API keys and ngrok credentials must be rotated
before any environment containing real data is created. Their values must never
be copied into this repository or plan.

## 9. Implementation phases

### Phase 0 — Repository, plan, requirements, and architecture

Status: `IN_PROGRESS`; the traceable draft and verified Git baseline exist, but
clinic review, process discovery, responsibility approval, and KPIs remain open.

- [x] Preserve the legacy project.
- [x] Create a separate ORION Clinic directory.
- [x] Scaffold a current React/Next/Vinext web surface with durable-state and
      object-storage capabilities available locally.
- [x] Create root `AGENTS.md`, this master plan, and ADR-0001.
- [x] Initialize Git and create the first verified baseline commit.
- [x] Complete the first recognizable clinician workspace preview.
- [x] Record exact local launch and verification results.
- [x] Convert client messages into a traceable draft requirements catalogue and
      prepare the clinic discovery/review pack.
- [ ] Obtain named clinic product, clinical, operations, IT, and legal review of
      the catalogue; no draft item is treated as approved before that review.
- [ ] Run clinic discovery interviews and BPMN as-is/to-be workshops.
- [ ] Confirm pilot KPIs and sign the responsibility matrix.

Gate: a new agent can understand the product, restrictions, architecture,
current code, and next task from this repository alone.

### Phase 1 — Engineering foundation

Status: `DONE` for the verified synthetic local foundation. Production topology,
region, vendor, RPO/RTO, and operational ownership remain blocked by their named
decisions and are not part of this completion claim.

- [x] Define environment validation and safe configuration schema.
- [x] Add `/health/live` and `/health/ready`.
- [x] Add domain state machines and unit tests.
- [x] Add initial schema and generated migrations.
- [x] Add repository interfaces before runtime database queries.
- [x] Add correlation IDs, structured PHI-safe logging, and error envelopes.
- [x] Add scripts for lint, typecheck, unit tests, migration check, and build.
- [x] Add synthetic seed data only.
- [x] Decide and document the verified local runtime and the proposed container
      roles without selecting production infrastructure before DEC-008.
- [x] Demonstrate non-empty D1/R2 backup and restore in a clean isolated local
      environment.
- [x] Define CI gates including secret, dependency, migration-drift, and
      recovery checks.

Gate: a clean checkout starts reproducibly and all verification commands pass.

### Phase 2 — Identity, organizations, patients, and consent

Status: `IN_PROGRESS` for synthetic local data only.

- [x] Organization, facility, user, and membership base model.
- [x] Department base model plus versioned organization/facility-specific
      permission assignments for the synthetic local D1 slice. Assignment roots
      and versions are immutable, current heads advance linearly, explicit denial
      wins, and different scopes are never merged implicitly. The department
      catalogue itself still needs a versioned administrative lifecycle.
- [x] Stable doctor, nurse, registrar, administrator, medical-lead, auditor, and
      service-role catalogue with server-calculated baseline permissions and a
      read-only self-access screen. Service roles cannot open an interactive
      workspace.
- [ ] Add a versioned/audited department administration lifecycle plus
      administrator grant/change/revoke commands, then migrate every existing
      protected endpoint and database role guard from legacy `memberships.role`
      checks to one explicitly selected assignment and effective permission.
- [ ] Confirm external OIDC provider and MFA approach.
- [x] Provider-neutral identity principal and Sites identity adapter.
- [x] Backend membership, clinician-role, tenant, facility, and exact encounter-
      assignment enforcement for the current workspace read/write endpoints.
- [x] Deny-by-default unit cases for no membership, non-clinician role,
      unassigned encounter, and cross-tenant encounter identifiers.
- [x] Versioned artificial patient profile, test-IIN identifier, facility-scoped
      list/search and exact duplicate protection.
- [x] Append-only patient-profile update and terminal archive lifecycle with an
      immutable identifier, required change reason, optimistic `expectedVersion`,
      idempotent commands, linear-head database guards and explicit role checks.
- [ ] Production encrypted-identifier lookup and reviewed duplicate merge.
- [x] Patient creation is independent from encounter creation. The server creates
      a test MRN, persists profile/head/contacts, optionally stores photo bytes in
      R2 with D1 metadata, and can then create a separately assigned encounter with
      eight empty sections. The prior combined compatibility route remains available.
- [x] Versioned RU/KK synthetic consent notice and append-only consent events
      with an immutable current head; clinic/legal approval remains open.
- [x] Tenant/facility/patient/encounter scope enforcement on current clinical
      sections, recommendations, and transcript reads.
- [x] Append-only clinical command audit plus a separate per-membership hash
      chain for successful protected workspace reads and document-response
      preparation. Both reads fail closed if the scoped access event cannot be
      committed.
- [x] Patient list, detail and photo reads append PHI-minimized actions to the
      facility audit hash chain before any successful response is released.
- [ ] Durable global security-event sink for anonymous and pre-scope denied
      requests, including approved retention and access policy after DEC-009 and
      DEC-010. Current pre-scope denials remain PHI-minimized technical logs.
- [ ] Session revocation, service accounts, and break-glass workflow.

Gate: every protected endpoint has allow and deny tests; cross-tenant access
reveals neither existence nor content.

### Phase 3 — Complete encounter vertical slice

Status: `IN_PROGRESS` for the synthetic local vertical slice only.

- [x] Create a synthetic encounter and validate the consent-gated,
      optimistic, idempotent, audited `draft -> ready -> in_progress` path.
- [x] Require effective care consent for current clinical write commands and
      the implemented encounter lifecycle transitions.
- [x] Record separate required consents before transient audio processing,
      transcript storage, or external AI egress; re-check their current heads on
      every encounter-scoped server command.
- [x] Integrate the reviewed loopback-only GigaAM/CAMPPlus speech adapter and
      persist only final server-returned segments with provenance.
- [x] Persist final/corrected transcript segments with append-only lineage;
      provisional STT ingestion remains open until the speech adapter exists.
- [x] Persist doctor/patient/unknown role and manual corrections.
- [x] Persist eight structured synthetic draft clinical sections with evidence
      links; live AI generation remains intentionally disconnected.
- [x] Accept, edit, reject, and retain original AI suggestions. The original is
      immutable; every clinician edit is a versioned derivative with provenance,
      exact acceptance, basket/restore history, and signed-protocol traceability.
- [x] Require human resolution of all mandatory sections before signing.
- [x] Create immutable protocol versions and append-only signed amendments.
      Every amendment creates a new signed successor and never rewrites a
      prior signed snapshot.
- [x] Generate genuine DOCX, rendered PDF, transcript TXT, audit JSON, optional
      audio, and a ZIP package.
- [x] Lock transcript, structured-section, and recommendation mutations in the
      UI and server repository once the protocol is signed.
- [x] Recover an interrupted `in_progress` or `review` encounter from an exact
      assigned D1 server snapshot. Browser-only drafts are explicitly excluded,
      stale or unknown outcomes lock clinical actions until exact reconciliation,
      and no synthetic crash event or invented saved state is introduced.
- [ ] Validate Russian, Kazakh, mixed speech, noise, negation, medicines, and
      speaker attribution on an approved synthetic/consented corpus.

Gate: no unreviewed AI content enters a signed document; a signed version is
immutable and completely auditable.

### Phase 4 — Orders, referrals, laboratory, and ECG

Status: `IN_PROGRESS` for the provider-neutral synthetic local slice. The gate
remains open until named KMIS/LIS/ECG contracts and sandbox adapters are tested.

- [x] Service request and referral state machines in D1 with immutable versions.
- [x] Medical justification and separate doctor approval.
- [x] Laboratory and ECG artifact/result model with D1 metadata and R2 bytes.
- [ ] Import PDF/image/structured results with provenance. Manual verified
      PDF/JPEG/PNG attachment is implemented; structured vendor import is open.
- [x] Result-ready, clinician-reviewed and needs-reconciliation states.
- [ ] Cancellation, correction, retry, and reconciliation. Request revoke,
      versioned result correction, idempotent retry and manual reconciliation are
      implemented locally; external cancellation/acknowledgement/retry remain open.
- [ ] KMIS/LIS/ECG contracts and sandbox adapters.
- [ ] Keep raw waveform interpretation as a separately validated clinical scope.

Gate: request-to-result traceability works with sandbox data and no LLM creates
an external order.

### Phase 5 — Scheduling and electronic queue

Status: `IN_PROGRESS`

- [x] Provider, specialty, service, schedule, and slot models for the explicitly
      labelled local synthetic source.
- [ ] Read real availability through a versioned KMIS adapter.
- [x] Capture immutable patient date/time/provider preferences.
- [x] Hold, confirm, cancel, and no-show flows with explicit patient confirmation.
- [ ] Reschedule, waitlist, approved overbooking policy, and external reconciliation.
- [x] Idempotent booking and protection against concurrent double booking.
- [x] Queue ticket, arrival, room, call, completion, cancellation, and exception
      states.
- [ ] Patient and staff notifications.
- [x] Visible manual-test source and terminal manual-review fallback.
- [ ] Trusted expired-hold worker and reconciliation when KMIS is unavailable.

Gate: availability is never generated by AI; concurrent booking tests cannot
create two appointments in one slot. This gate passes for the local synthetic D1
slice only; real availability remains blocked on the authoritative KMIS contract.

### Phase 6 — Chronic care and staff worklists

Status: `IN_PROGRESS`

- [x] Doctor-confirmed registry enrollment for the local synthetic source.
- [x] Diagnosis basis, goals, treatment, medication, and diet plan.
- [x] Follow-up visits and control tests with due/overdue states.
- [x] Nurse tasks, patient responses, escalation, and doctor closure.
- [x] Cohort dashboard with deterministic reason for inclusion.
- [x] Medication review/adherence tasks derived from a signed plan.
- [ ] Refill and free-medication authoritative source integration.
- [ ] ERDB and PUZ adapters only after access and exact terminology are confirmed.

Gate: every care task derives from a signed plan and overdue cohorts are
reproducible from deterministic rules. This gate passes for the local synthetic
D1 slice; real registry/refill status remains blocked on authoritative systems,
legal basis and clinic-approved workflow.

### Phase 7 — Patient communications

Status: `IN_PROGRESS`

- [x] Per-channel opt-in/opt-out and preferred RU/KK language in local D1.
- [x] Versioned `approved_test` templates with minimal medical information.
- [x] Provider-disconnected local processing stub that cannot make a real call.
- [x] Scheduled reminder intentions from confirmed appointments and signed
      care-plan tasks.
- [x] Local queue, quiet-hour deferral, provider-unavailable attempt outcome,
      bounded retry,
      patient-response, manual-contact, and staff-escalation states.
- [x] Quiet hours and minimum-content policy; protected links remain unconfigured.
- [x] Append-only communication audit, idempotency and manual fallback.
- [ ] WhatsApp Business, Telegram, SMS and telephony adapter contracts, real
      provider implementations, delivery receipts, protected-link host and
      clinic-approved business accounts/content.

Gate: no message is sent without a valid purpose, approved content, channel
permission, delivery trace, and failure owner. The local no-send part passes with
synthetic system destinations; the production gate remains open until a real
provider, clinic approvals and end-to-end delivery/reconciliation tests exist.

### Phase 8 — Observation, critical patients, and transfer

Status: `IN_PROGRESS`

- [x] BMI, blood pressure, and temperature capture.
- [x] Clinic review packet and activation-blocked decision template for
      `DEC-006`/`DEC-007` (prepared, not clinic-approved).
- [ ] Other clinic-approved observation types and device ingestion.
- [ ] Clinic-approved deterministic thresholds and versioned rules.
- [ ] Alert, acknowledgement, escalation, and SLA states.
- [ ] Doctor confirmation of critical status and transfer decision.
- [ ] Receiving-facility notification and explicit acceptance.
- [ ] Minimal signed transfer packet and longitudinal handoff snapshot.
- [ ] Rejection, retry, timeout, manual call, and reconciliation.
- [ ] Define the first "digital twin" as read-only longitudinal summary unless
      a separate predictive-model specification is approved.

Gate: AI cannot trigger transfer; a transfer is not complete until the receiving
organization acknowledges the packet and patient.

### Phase 9 — Integration hardening

Status: `NOT_STARTED`

Each integration needs a passport containing owner, purpose, sandbox,
documentation, authentication, scopes, source of truth, data mapping, SLA,
rate limits, idempotency, retry, dead-letter handling, reconciliation, security,
manual fallback, and acceptance tests.

Target integrations: KMIS, ERDB, PUZ, laboratory, ECG, pharmacy/free medicines,
scheduling, messaging, telephony, and receiving hospitals.

Gate: contract tests and failure runbooks pass for every enabled adapter.

### Phase 10 — Clinical validation and production readiness

Status: `NOT_STARTED`

- [ ] Data-flow diagram, threat model, and privacy impact assessment.
- [ ] Signed RBAC, consent, retention, and clinical responsibility matrices.
- [ ] SAST, SCA, secret scan, SBOM, container scan, DAST, and penetration test.
- [ ] Load, concurrency, failover, disk-full, clock-skew, and recovery tests.
- [ ] Confirmed RPO/RTO and repeated backup restore drill.
- [ ] RU/KK STT WER/CER and speaker attribution metrics approved by clinicians.
- [ ] AI hallucination, omission, negation, evidence, and automation-bias tests.
- [ ] Shadow pilot with no automatic clinical/external actions.
- [ ] Limited patient pilot only after legal, security, clinical, and operational
      signoff.
- [ ] Production SLO, monitoring, on-call, incident response, rollback, access
      review, and model-degradation stop criteria.

Gate: clinic leadership explicitly approves production use and its remaining
risks; open Critical/High security findings are zero.

## 10. First vertical slice acceptance contract

The encounter slice is complete only when:

1. An authorized doctor can find/create a synthetic patient and encounter.
2. Required consents are enforced server-side.
3. Data survives a full local service restart.
4. RU, KK, and mixed speech produce visible provisional and final segments.
5. Doctor, patient, and unknown roles are distinct and correctable.
6. Corrections preserve the original version and audit event.
7. AI creates only drafts with evidence and inference provenance.
8. A doctor can replace AI text completely.
9. Rejected content remains in audit and the rejected basket.
10. Only reviewed sections enter the protocol.
11. Required sections block signing until reviewed or explicitly marked absent.
12. Signed protocols cannot be overwritten.
13. An amendment creates a new version linked to the prior version.
14. DOCX includes the structured record and full labelled transcript.
15. PDF is visually rendered and compared, not assumed from a successful build.
16. ZIP contains DOCX, PDF, TXT, JSON audit, and audio only when allowed.
17. Groq failure never destroys or blocks saving the encounter.
18. STT failure preserves confirmed segments and enables manual continuation.
19. Missing identity returns 401; insufficient scope returns 403.
20. Reads, writes, exports, downloads, review, and signing are audited.
21. Replayed idempotent requests do not create duplicates.
22. Concurrent edits cause a visible conflict, not a silent overwrite.
23. A clean backup restore reproduces the encounter and document hashes.
24. Local and server configurations require no source-code edits.

## 11. Security and quality release gates

Gate 0 — architecture approval:

- data-flow and threat model;
- clinic-approved role and responsibility matrix;
- consent and retention matrix;
- data placement and external AI conditions;
- manual fallback and incident ownership.

Gate 1 — synthetic internal environment:

- authorization and tenant-isolation tests pass;
- audit, provenance, versioning, and consent work;
- no real patient data and no live production integration;
- secrets are absent and previously disclosed keys are rotated;
- backup restore succeeds;
- no open Critical/High findings.

Gate 2 — shadow pilot:

- AI cannot sign, book, order, notify, register, or transfer;
- integrations are read-only or sandbox;
- clinicians compare drafts with independent documentation;
- clinical safety metrics and stop criteria are approved;
- personnel and incident owners are trained.

Gate 3 — limited patient pilot:

- unique accounts and MFA;
- legal, security, clinical, hosting, and provider contracts approved;
- external penetration test remediated;
- scope limited by clinic, specialty, users, and duration;
- rollback and incident communication tested.

Gate 4 — production:

- SLO and capacity tests;
- on-call and incident response;
- regular access review and backup drills;
- supplier and vulnerability management;
- periodic clinical reassessment of STT and AI quality.

## 12. Open decisions

| ID | Decision needed | Blocks | Owner |
|---|---|---|---|
| DEC-001 | Exact KMIS product, vendor, and version | Phases 4-5, 9 | Clinic IT |
| DEC-002 | KMIS API, sandbox, webhooks, auth, and write permissions | Phases 4-5, 9 | KMIS vendor |
| DEC-003 | Exact meaning and access path for ERDB | Phase 6 | Clinic/health authority |
| DEC-004 | Exact meaning and workflow for PUZ | Phase 6 | Clinical lead |
| DEC-005 | ECG format: PDF, image, XML/DICOM, or waveform | Phase 4 | Clinic/ECG vendor |
| DEC-006 | Clinical criteria and SLA for a "red" patient | Phase 8 | Clinical committee |
| DEC-007 | Required meaning of "digital twin" | Phase 8 | Product/clinical lead |
| DEC-008 | Production hosting, data residency, DB, storage, and backups | Phase 1 production gate | Clinic IT/legal/security |
| DEC-009 | External identity provider, MFA, and account lifecycle | Phase 2 | Clinic IT/security |
| DEC-010 | Retention periods for audio, transcript, drafts, audit, and backups | Phases 2-3 | Legal/clinical lead |
| DEC-011 | Electronic signature and legal status of the protocol | Phase 3 | Legal/clinical lead |
| DEC-012 | Approved patient channels and business accounts | Phase 7 | Clinic operations |
| DEC-013 | Pilot branches and receiving hospitals | Phases 2, 8 | Clinic leadership |
| DEC-014 | Source of truth for free-medication accounting | Phase 6 | Pharmacy/clinic IT |
| DEC-015 | SLO, RPO, RTO, support hours, and incident owner | Phase 10 | Clinic IT/leadership |
| DEC-016 | Pilot KPI and pass/fail thresholds | Phases 0, 10 | Product/clinical lead |

Unknown decisions do not block safe local foundation work. They block the
specific external integration or clinical release named above.

## 13. Verification contract

Only commands that exist in the repository may be reported as verified.
Target command set:

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm test
pnpm db:generate
pnpm build
pnpm security:secrets
pnpm security:dependencies
pnpm backup:drill:local
pnpm verify
pnpm verify:ci
git diff --check
```

Build success does not prove microphone, STT, role separation, real Word/PDF
rendering, authorization, backup, or external integration behavior.

### Verification ledger

| Date | Command | Result | Scope and limitation |
|---|---|---|---|
| 2026-08-28 | `pnpm install` | PASS | Scaffold dependencies installed; no product behavior verified |
| 2026-08-28 | `pnpm db:generate` | PASS | Generated the initial 22-table schema migration; generation alone does not prove runtime application |
| 2026-08-28 | `pnpm db:migrate:local` | PASS | Five migrations were applied to local D1, including linear clinical-section heads, current-head audit chains, terminal idempotency commands, tenant boundaries, expiry guards, and controlled amendments |
| 2026-08-28 | `pnpm db:seed:local` | PASS | Idempotent synthetic clinic, patient, encounter, three suggestions, all eight clinical-section heads/versions, and audit head inserted; no real data |
| 2026-08-28 | `pnpm test` | PASS | 7 files and 37 tests covering encounter rules, Sites identity parsing, runtime configuration, correlation/error safety, canonical audit hashes, storage readiness, and SQLite integrity invariants |
| 2026-08-28 | `pnpm verify` | PASS | ESLint, TypeScript, 37 tests, Drizzle schema check, 13 migration integration tests, and Vinext production build passed |
| 2026-08-28 | `GET /`, `/api/health`, `/api/health/live`, `/api/health/ready` | PASS | All returned HTTP 200 on local port 3200; readiness exercised the local D1 and R2 bindings |
| 2026-08-28 | Browser visual inspection | PASS | Golos Text loaded, recommendation headings are 17px, no horizontal overflow at 1280px, and no browser warnings/errors were observed |
| 2026-08-28 | Authenticated recommendation decision and reload | PASS | Local Sites sign-in accepted a synthetic recommendation, D1 state remained accepted after reload, lock version changed 1 to 2, and audit sequence changed 0 to 1 |
| 2026-08-28 | Authenticated clinical-section commands | PASS | `save_draft` created version 2, exact idempotent replay created no duplicate, stale version and changed-payload key returned 409, `mark_reviewed` created version 3, explicit absence created a blank reviewed version, and reload returned current heads only |
| 2026-08-28 | Clinical-section audit correlation | PASS | D1 contained one immutable audit event per committed command with a server-generated correlation ID; replay and rejected stale command added no event |
| 2026-08-28 | Anonymous `GET /api/workspace` | PASS | Returned HTTP 401; spoofed authentication headers sent outside the Sites sign-in cookie path were removed by the local dispatcher |
| 2026-08-28 | `pnpm install --frozen-lockfile` | PASS | Lockfile reproduced with Node 24.19.0 and pnpm 11.19.0 |
| 2026-08-28 | `pnpm db:generate` | PASS | Reconciled five-entry Drizzle journal and snapshots produced no schema changes for the 22-table model |
| 2026-08-28 | `pnpm security:secrets` | PASS | All 70 tracked files passed the value-redacting secret and sensitive-artifact baseline; provider-side historical/push scanning is still required before Gate 1 |
| 2026-08-28 | `pnpm security:dependencies` | PASS | pnpm advisory audit reported no known vulnerabilities after compatible transitive overrides |
| 2026-08-28 | `pnpm peers check` | PASS | No peer dependency issues were found in the updated dependency graph |
| 2026-08-28 | `pnpm backup:drill:local` | PASS | Isolated source was destroyed before restore; 23 tables, 38 rows, five migrations, three R2 objects, and 78,559 backup bytes matched by schema/data/object hashes; synthetic local D1/R2 only, no RPO/RTO claim |
| 2026-08-28 | `pnpm verify:ci` | PASS | Secret scan, zero-advisory dependency audit, lint, strict types, 37 tests, Drizzle check, warning-free production build, and a second complete isolated recovery drill passed |
| 2026-08-28 | CI YAML parse | PASS | Workflow and Dependabot YAML parsed successfully; no hosted GitHub runner or deployment was invoked locally |
| 2026-08-28 | `git diff --cached --check` | PASS | All 70 foundation files are staged with no whitespace errors; commit remains blocked only by missing Git author configuration |
| 2026-08-31 | Requirements trace and discovery pack | PASS | Added `clinic-leadership-catalogue.md` and `clinic-discovery-pack.md`; both remain drafts requiring named clinic review and do not authorize live integrations or real data |
| 2026-08-31 | `pnpm typecheck`, `pnpm lint`, `pnpm test` | PASS | Strict types and lint passed; 8 files and 43 tests passed, including five membership/role/assignment access cases |
| 2026-08-31 | `pnpm db:migrate:local`, `pnpm db:seed:local` | PASS | Local D1 accepted the updated idempotent synthetic seed with two isolated tenants, clinician and registrar roles, eight sections per assigned encounter, and four scoped transcript segments for the primary fixture |
| 2026-08-31 | Authenticated `GET /api/workspace` | PASS | Local Sites session resolved `local_seedy` to `membership-a`; returned only `encounter-a`, 8 sections, 4 D1 transcript segments, and 3 recommendations |
| 2026-08-31 | Authenticated cross-tenant request | PASS | The same Sites session requested `encounter-b` and received neutral HTTP 404 `ENCOUNTER_NOT_FOUND`; existence/content were not returned |
| 2026-08-31 | `pnpm verify:ci` | PASS | Lint, strict types, 43 tests, migration check, production build, zero known dependency advisories, and isolated recovery passed; recovery matched 23 tables, 67 rows, five migrations, three R2 objects, and 89,183 backup bytes |
| 2026-08-31 | Staged secret and whitespace gate | PASS | After staging the complete checkpoint, the value-redacting scan passed all 76 tracked files and `git diff --cached --check` reported no whitespace errors |
| 2026-08-31 | Versioned consent API | PASS | Local Sites-authenticated commands recorded append-only RU/KK synthetic decisions, returned the exact result on replay, rejected invalid withdrawal with 422, hid transcript without effective storage consent, and blocked clinical writes after care withdrawal with `CARE_CONSENT_REQUIRED` |
| 2026-08-31 | Encounter lifecycle API | PASS | A synthetic draft was blocked without care consent (409), advanced to ready after regrant (200), returned the identical snapshot on exact replay, and rejected changed payload under the same idempotency key (409); SQLite also enforces linear versioned transitions |
| 2026-08-31 | Synthetic encounter creation API | PASS | Authenticated creation returned 201 with a server-generated synthetic MRN, assigned clinician, draft encounter, and eight empty sections; exact replay reused the encounter ID, changed-key payload and duplicate candidate returned 409, and clinical write without consent returned 409 |
| 2026-08-31 | `pnpm db:migrate:local`, `pnpm db:seed:local` | PASS | Consent head/schema migration and two forward-only encounter lifecycle guard migrations applied; the 33-command seed remained idempotent and contains only synthetic fixtures |
| 2026-08-31 | `pnpm backup:drill:local` | PASS | Isolated source was destroyed before restore; schema/data/object hashes matched for 24 tables, 99 rows, eight migrations, three R2 objects, and 108,646 backup bytes; no production RPO/RTO claim |
| 2026-08-31 | Final `pnpm verify:ci` | PASS | Secret policy passed for 92 tracked files, dependency audit found no known vulnerabilities, lint and strict types passed, 9 files/48 tests passed, Drizzle reported no drift, Vinext built all routes, and isolated recovery again matched 24 tables/99 rows/eight migrations/three R2 objects/108,646 bytes |
| 2026-08-31 | Signed protocol and export browser flow | PASS | Local Sites-authenticated clinician created and signed immutable protocol v2 for the assigned synthetic encounter, regenerated five current D1/R2 artifacts, and downloaded ZIP, DOCX, PDF, TXT, and JSON through five audited HTTP 200 routes; anonymous download and same-origin generation returned 401 |
| 2026-08-31 | DOCX/PDF/ZIP artifact QA | PASS | Microsoft Word rendered the final DOCX as two legible pages and Poppler rendered the independent PDF as two legible pages with Russian/Kazakh text; the ZIP contained four artifacts plus manifest and every byte size/SHA-256 matched; no audio asset was claimed or included |
| 2026-08-31 | Final protocol checkpoint `pnpm verify:ci` | PASS | Secret policy passed for 105 staged files, dependency audit found no known vulnerabilities, lint and strict types passed, 10 files/52 tests passed, Drizzle reported no drift, Vinext built all workspace/document routes, and isolated recovery matched 24 tables/100 rows/nine migrations/three R2 objects/111,075 bytes after isolated-source destruction |
| 2026-08-31 | Authenticated signed-amendment browser flow and artifact QA | PASS | The assigned clinician amended synthetic protocol v2 into signed v3 with an immutable predecessor, explicit reason/text/author/time, one append-only amendment record, regenerated five current artifacts, and a visible amendment section in both two-page DOCX and PDF; every downloaded SHA-256 and ZIP manifest entry matched D1/R2, and audit JSON contained `protocol.amend_and_sign` |
| 2026-08-31 | Final amendment checkpoint `pnpm verify:ci` | PASS | Secret policy passed for 105 tracked files, dependency audit found no known vulnerabilities, lint and strict types passed, 11 files/57 tests passed, Drizzle reported no drift, Vinext built all routes, and isolated recovery matched 25 tables/101 rows/ten migrations/three R2 objects/116,049 bytes after isolated-source destruction |
| 2026-09-01 | Exact interrupted-encounter recovery behavior | PASS | Tests cover the seven-status resumability matrix, exact assigned encounter, current heads/leaves, deterministic 64-character recovery revision, revision change after a current section advances, identical reconstruction from a new repository instance, and denial after clinician membership is disabled |
| 2026-09-01 | Final recovery checkpoint `pnpm verify:ci` | PASS | Secret policy passed for 115 files, dependency audit found no known vulnerabilities, lint and strict types passed, 14 files/73 tests passed, Drizzle reported no drift, Vinext built all routes, and isolated recovery matched 27 tables/105 rows/11 migrations/three R2 objects/135,406 bytes after isolated-source destruction |
| 2026-09-01 | Staged recovery secret and whitespace gate | PASS | After the two recovery files were staged, the value-redacting policy passed all 117 tracked files; both `git diff --check` and `git diff --cached --check` reported no whitespace errors |
| 2026-09-02 | Local GigaAM/CAMPPlus synthetic speech smoke | PASS | The pinned local model on loopback transcribed a 6,615 ms Russian synthetic WAV into the expected complaint sentence and returned speaker role `Врач`; raw audio was removed from the speech service, cold processing took 65,531 ms, and no microphone/ambient audio or clinical quality claim is included |
| 2026-09-02 | Final speech/AI checkpoint `pnpm verify:ci` | PASS | Secret policy passed 183 tracked and untracked repository files, dependency audit found no known vulnerabilities, lint and strict types passed, 20 files/97 tests passed, Drizzle reported no drift, Vinext built all workspace/speech/analysis routes, and isolated recovery matched 31 tables/111 rows/15 migrations/three R2 objects/158,642 bytes after isolated-source destruction |
| 2026-09-02 | Launcher start/stop/restart and browser workspace | PASS | Root BAT launch applied 15 local migrations plus the idempotent 33-command seed, started web/STT on 3200/3101 and reported the absent Groq secret; the corrected stop script terminated only checkout-owned processes; authenticated browser recovery/consent state enabled the transcription control without granting microphone permission |
| 2026-09-02 | Primary `START_ORION.bat` compatibility entry point | PASS | The familiar launcher name now lives in the new ORION Clinic checkout, cold-started D1/STT/web successfully, and a second invocation returned success without duplicating services; the follow-up secret scan covered 184 tracked and untracked repository files and PowerShell/whitespace checks passed |
| 2026-09-02 | Groq structured provider contract | PASS with runtime limitation | Unit tests cover configuration, JSON Schema request/response mapping, evidence validation and provider failures; the real route is built and consent/snapshot-gated, but no external call was made because no fresh ignored `GROQ_API_KEY` is configured |
| 2026-09-02 | Migrated legacy live consultation route | PASS with compatibility limitation | The reviewed working UI/API bundle is now inside ORION Clinic at `/live`; strict types, lint, 20 files/97 tests, Drizzle check and production build passed, the secret scan covered 205 tracked/untracked files, a clean launcher restart returned HTTP 200, browser checks found consent gating/history/dark theme/navigation with no `/live` console errors, and the compatibility STT API reported ready GigaAM/CAMPPlus. Browser-local history/audio/export and automatic live analysis remain non-authoritative compatibility behavior, not the production record. |
| 2026-09-02 | D1-backed patient registry focused tests | PASS | 14 tests across facility access, patient validation and repository behavior covered facility-scoped list/read, persisted artificial patient creation, idempotency, duplicate test-IIN denial, clinician-only encounter creation, eight empty sections, photo metadata and tenant boundaries. |
| 2026-09-02 | Patient registry full build gate | PASS | Final `pnpm verify` passed lint, strict types, 24 test files/114 tests, Drizzle schema drift check and Vinext production build including `/patients`, `/patients/:patientId` and all patient API routes. Migration `0015` and the patient-free technical bootstrap applied to active local D1; `/`, `/patients`, one patient detail and `/live` returned HTTP 200, while anonymous patient API access returned 401. |
| 2026-09-02 | Patient-to-encounter browser journey | PASS for artificial local data | The authenticated clinician created an artificial patient through the UI, reloaded the detail page with the same D1 values, found the patient by test IIN, created a separate draft encounter and opened it on `/` by the new exact `encounterId`. The workspace showed the correct patient/reason, eight empty sections and no invented transcript or suggestions; browser warnings/errors were empty. Screenshots 13 and 14 document the registry and patient card. |
| 2026-09-02 | Patient access and photo hardening | PASS for current local scope | Patient list/detail/photo reads now fail closed unless their PHI-minimized `patient.*` event advances the facility audit hash chain. Multi-facility membership returns explicit facility choices and all list/detail/photo/write links preserve `facilityId`. Photo writes require the artificial-data gate, enforce 4 MB, verify JPEG/PNG/WebP magic bytes against declared MIME, hash R2 bytes and serve with `nosniff`. Registrar UI no longer offers clinician-only encounter creation. Browser recheck showed the exact D1-backed patient card with no console warnings/errors, and local D1 contained matching `patient.list`/`patient.read` audit events. |
| 2026-09-02 | Final patient-registry `pnpm verify:ci` | PASS | Secret policy covered 228 tracked/untracked files, dependency audit found no known vulnerabilities, lint/strict types passed, 24 files/114 tests passed, Drizzle reported no drift, all Vinext routes built, and the isolated recovery drill destroyed its source before restoring and matching 36 tables, 112 rows, 16 migrations, three R2 objects and 167,195 backup bytes. Active local D1 was not the drill target. |
| 2026-09-02 | Unified authenticated shell and browser route check | PASS for authenticated local UI | `/`, `/patients`, and `/live` rendered inside one Sites-authenticated ORION Clinic shell with the current display name/email, active navigation, sign-out, persistent theme/sidebar state, one global page header and no horizontal overflow. All three routes used the same Golos Text font stack; browser error/warning logs were empty. Screenshots 15-17 record loaded states, including four artificial D1 patient records. Anonymous UI routes redirected to sign-in and protected APIs returned 401. This does not verify production OIDC/MFA or replace route-level D1 authorization. |
| 2026-09-03 | Final unified-shell stabilization `pnpm verify:ci` | PASS | Secret policy covered 236 tracked/untracked files, dependency audit found no known vulnerabilities, lint/strict types passed, 25 files/119 tests passed including clinician-only compatibility-tool authorization and photo-query preservation, Drizzle reported no drift, all Vinext routes built, and the isolated recovery drill destroyed its source before restoring and matching 36 tables, 112 rows, 16 migrations, three R2 objects and 167,195 backup bytes. |
| 2026-09-03 | Partial-start and stale Vinext lock recovery | PASS | A failed web start had left STT ready and a Vinext lock whose PID had been reused by an unrelated Windows service. The launcher verified that port 3200 was free and the recorded process did not belong to this checkout, removed only that exact lock, reused the ready ORION STT, started the web process, and then returned success without duplication on a second `START_ORION.bat` invocation. |
| 2026-09-03 | Exact D1 live workspace, responsive audit and final `pnpm verify:ci` | PASS | `/live` reused the exact authorized D1 encounter and clinician-controlled analysis/review path; desktop/tablet/mobile browser checks found no final body overflow or console warnings/errors. Secret policy covered 243 tracked/untracked files, dependency audit found no known vulnerabilities, lint/strict types passed, 26 files/132 tests passed, Drizzle reported no drift, all Vinext routes built, and isolated recovery matched 36 tables/119 rows/17 migrations/three R2 objects/172,788 bytes after destroying its disposable source. |
| 2026-09-03 | Operational live controls, sign-out and requirements-gap final `pnpm verify:ci` | PASS | Secret policy covered 248 tracked/untracked files, dependency audit found no known vulnerabilities, lint/strict types passed, 27 files/135 tests passed, Drizzle reported no drift, all Vinext routes built, and isolated recovery destroyed its disposable source before matching 36 tables/119 rows/17 migrations/three R2 objects/172,788 bytes. Browser QA verified enabled D1-gated STT without starting the microphone, top-context sign-out, patient search/dialogs, live rail/history/theme and clinical-section edit/cancel with no warning/error logs. |
| 2026-09-04 | Phase 4 repository and authenticated API journey | PASS for synthetic local data | Five repository scenarios covered full request-to-result completion, exact replay/stale writes, registrar/unassigned/no-consent denial, reconciliation and SQLite immutability. A Sites-authenticated journey created `service-request-ed8b257b-a9af-45db-8192-d93d4774b9c8`, separately approved it, attached a synthetic PDF to R2, reviewed it, downloaded byte-identical SHA-256 `BD6BFD81B3C49FC8B1F639DA302C18343B301A87F8305EC86C3AB266D41FAF2B`, and completed version 3. No external system was called. |
| 2026-09-04 | Phase 4 browser and runtime stability audit | PASS for inspected controls | Authenticated `/orders` rendered the shared shell, real D1 list/detail, R2 download, filters and status history; create modal open/close and light/dark theme were exercised, and browser warning/error logs were empty. A verified Windows `EBUSY` crash caused by watching locked files under `.orion-runtime` was fixed by excluding runtime/storage paths from Vite watch. Screenshot 22 records the loaded result. No new clinical command was submitted through browser automation. |
| 2026-09-04 | Phase 4 post-audit integrity hardening | PASS for synthetic local data | Independent review findings were reproduced and closed: review successors must preserve the exact pending payload; terminal requests cannot be reviewed; result upload intent is durable before R2, exact retries return the original patient/encounter snapshot, audit-head contention retries fail closed, and UI status choices share domain transition rules. Thirty test files/172 tests, lint, strict types, Drizzle and all Vinext routes passed. |
| 2026-09-04 | Phase 4 local quality and recovery gates | PASS with external-audit exception | `pnpm verify` passed lint, strict types, 30 test files/172 tests, Drizzle schema check and all Vinext routes including the upload-reconciliation API and `/orders`; `PRAGMA quick_check` returned `ok`; isolated recovery destroyed its source before matching 44 tables/122 rows/20 migrations/three R2 objects/215,011 bytes. Secret policy passed 270 files. `pnpm audit` could not reach npm registry after retries, so aggregate `pnpm verify:ci` is correctly recorded as incomplete rather than passed. |
| 2026-09-05 | Phase 7 focused communications regression | PASS | Sixteen repository scenarios covered exact confirmed-appointment and signed-plan sources; stale/cancelled source rejection without outbox or audit mutation; separate channel consent; latest-template retirement; due-time and quiet-hour enforcement; disconnected-provider retry; exact fallback owner; response/completion/escalation; opt-out suppression; cross-task linkage and direct SQL body/payload/purpose/destination guards. The communication audit sequence and hash links advance through the complete local lifecycle while escalation leaves the signed care plan unchanged. |
| 2026-09-05 | Phase 7 D1 and authenticated browser audit | PASS for the inspected local no-send slice | Forward-only migrations `0022`-`0024` applied; the rerunnable fixture retained one active local policy and 16 RU/KK `approved_test` templates; `PRAGMA quick_check` returned `ok` and foreign-key check returned no rows. Authenticated `/communications` loaded five authorized synthetic patients, three current signed-plan sources for `SYN-CARE-01`, a fixed system-destination consent dialog and a 390 px layout without horizontal overflow or warning/error logs. No browser command changed consent or created a notification. |
| 2026-09-05 | Phase 7 final `pnpm verify:ci` and recovery | PASS | Resource-safe single-worker Vitest kept web/STT running while secret policy covered 341 tracked/untracked repository files, dependency audit found no known vulnerabilities, lint/strict types passed, 43 test files/253 tests passed, Drizzle reported no drift, and every Vinext route built including `/communications` plus five communication APIs. Isolated recovery destroyed its disposable source before matching 77 tables, 127 rows, 25 migrations, three R2 objects and 373,097 backup bytes. |
| 2026-09-05 | Phase 8A observation repository and D1 integrity | PASS for synthetic local capture | Six repository scenarios plus domain/access tests cover scaled values and derived BMI, required measurement groups, role/facility/active-patient boundaries, nurse ownership, exact idempotent replay, changed-key and stale-version conflicts, append-only corrections, direct SQL immutability and guarded head advancement. Migration `0025` applied; its fixture remained one record after two runs; active D1 `quick_check` returned `ok`, foreign-key check returned no rows, and the authenticated browser lifecycle left two records, three versions and two heads. |
| 2026-09-05 | Phase 8A authenticated browser and responsive audit | PASS for the inspected synthetic workflow | A Sites-authenticated clinician selected an existing artificial patient, recorded 172.4 cm/71.8 kg, algorithmic BMI 24.16, pressure 124/82 and temperature 36.7, then corrected temperature to 36.8 as version 2. Version 1 remained visible with reason/author/time/source; audit recorded read/record/correct events. A 390 px check had no horizontal overflow and browser warning/error logs were empty. Three verified screenshots are retained in the operator guide. No critical status, alert, notification or transfer was created. |
| 2026-09-05 | Phase 8A final `pnpm verify:ci` and recovery | PASS | Secret policy covered 361 tracked/untracked repository files, dependency audit found no known vulnerabilities, lint/strict types passed, 47 test files/269 tests passed, Drizzle reported no drift, and Vinext built `/observations` plus both observation APIs. Isolated recovery destroyed its disposable source before matching 80 tables, 128 rows, 26 migrations, three R2 objects and 389,707 backup bytes. |
| 2026-09-05 | Phase 8B clinic decision gate artifact and repository regression | PASS as an unapproved review artifact | The Russian review packet and machine-readable decision template cover deterministic rule scope/version ownership, repeat measurement, doctor confirmation/override, acknowledgement/escalation SLA, minimum signed transfer packet, receiving-facility contract, fallback/reconciliation and four explicit meanings of “digital twin”. Validation confirmed `draft_unapproved`, `activationBlocked: true`, an empty rule set and no preselected `DEC-007` meaning. Full `pnpm verify:ci` then passed secret policy for 363 files, dependency audit, lint/types, 47 test files/269 tests, schema/build and an isolated restore of 80 tables/128 rows/26 migrations/three R2 objects/389,707 bytes. This does not approve clinical thresholds or runtime behavior. |
| 2026-09-06 | Phase 2B department/access governance and complete regression | PASS for the synthetic local self-access slice | Migration `0026`, domain/repository/API/UI tests and the `/access` workspace cover immutable department assignments, linear current heads, seven stable role categories, explicit-deny precedence including denial of the self-access resource, service-role isolation, expired/disabled/revoked denial, explicit multi-scope selection and a minimized API response. `pnpm verify:ci` passed secret policy for 379 files, zero known dependency vulnerabilities, lint/types, 53 test files/325 tests, Drizzle/build and isolated recovery of 84 tables/133 rows/27 migrations/three R2 objects/412,447 bytes after source destruction (`c1ca56ad-c614-4eee-9f20-5e76d067110f`). Existing clinical APIs have not yet been migrated from their proven legacy role matrices. |
| 2026-09-06 | Phase 2B active D1 and browser audit | PASS for inspected local behavior | Migration/bootstrap reruns were idempotent; `PRAGMA quick_check` returned `ok`, foreign-key check returned no rows, and the current synthetic doctor assignment resolved to version 2 after an append-only local clock correction. Browser navigation from `/patients` to `/access`, all 15 permission states, light/dark theme, 653 px layout and zero body horizontal overflow were checked with no warning/error log. Anonymous `/api/access` returned 401. No clinical record, microphone, external AI or real patient data was used. |

## 14. Risk register

Initial risks to maintain:
- incorrect patient identity or duplicate merge;
- inaccurate RU/KK STT, mixed-language loss, or wrong speaker attribution;
- negation, medicine, unit, and dosage transcription errors;
- AI hallucination, omission, or unsupported certainty;
- unreviewed draft entering the protocol;
- automation bias and alert fatigue;
- cross-tenant or excessive-role access;
- sensitive data in logs, prompts, exports, or third-party messaging;
- lost audio, transcript, document, or audit event;
- unavailable AI, STT, KMIS, registry, network, or messaging provider;
- duplicate order/booking/message after retry;
- inconsistent schedule or external reconciliation failure;
- incorrect critical classification or incomplete transfer packet;
- unclear ownership of an alert, failed message, or receiving acknowledgement;
- untested restore, rollback, or manual fallback;
- scope expansion before the current release gate.

Each active risk must eventually record probability, impact, owner, preventive
control, detection, response, and residual acceptance.

## 15. Current checkpoint

- Active phases: `PHASE_0_IN_PROGRESS` for clinic review/discovery,
  `PHASE_2_IN_PROGRESS` for production identity/consent decisions,
  `PHASE_3_IN_PROGRESS` for the synthetic encounter vertical slice, and
  `PHASE_4_IN_PROGRESS` through `PHASE_8_IN_PROGRESS` for provider-neutral local
  slices whose external gates remain open. Phase 1 is complete only for the
  verified synthetic local engineering foundation.
- Completed current bounded slice: Phase 2B now stores departments and immutable,
  versioned organization/facility/member assignments in D1; validates the seven
  approved role categories and stable permission codes in TypeScript and SQLite;
  applies explicit denies after defaults and additions; rejects mixed service and
  interactive roles; requires an explicit choice instead of merging multiple
  scopes; and exposes only the current user's sanitized, read-only result on
  `/access`. Existing clinical resource, purpose, consent and lifecycle checks
  remain in force. This does not yet replace legacy role checks across the rest of
  the product and is not production identity approval.
- Phase 4 has an operational local `Направления` module without external
  delivery/acknowledgement. Phase 5 has local scheduling and queue without an
  authoritative KMIS source. Phase 6 has local signed-plan observation without
  ERDB/PUZ/free-medication systems. Phase 7 now has a local no-send communications
  outbox, but no messaging or telephony provider is connected. Phase 8 now has
  local observation capture plus a completed Phase 8B clinic review packet, but
  no approved thresholds, alerts or transfer. Phases 9-10 remain `NOT_STARTED`
  and are not represented as production operations.
- Completed current bounded slice: the Phase 8B `DEC-006`/`DEC-007` packet now
  gives clinic owners one fillable decision surface for deterministic rule scope,
  ownership/versioning, repeat measurement, human confirmation/override, SLA,
  receiving-facility acknowledgement, minimum signed transfer data, fallback,
  reconciliation and the exact meaning of “digital twin”. Its companion JSON is
  `draft_unapproved`, contains no rules or selected meaning and keeps activation
  blocked. This is governance evidence, not permission to classify or transfer.
- Completed current bounded slice: clinician-authored laboratory, ECG, service
  and specialist requests have immutable D1 versions, separate doctor approval,
  status history, manual PDF/JPEG/PNG results in R2, explicit review or
  reconciliation, audited downloads and a reviewed-final completion gate on the
  integrated `/orders` screen. Local `active` never claims external transmission.
  Follow-up migrations `0018`-`0019` bind each request to the exact encounter
  patient, enforce active care context and exact-payload review in SQLite, and
  track every R2 write through a durable upload intent. Expired unfinished uploads
  enter an audited two-pass cleanup state so a concurrent writer cannot leave an
  unaudited object; committed artifact rows remain immutable and are never cleaned
  by that path.
- Completed current bounded slice: every clinician page now uses one authenticated
  ORION Clinic shell. The shared page boundary requires Sites identity before rendering and
  provides the same actual display name/email, active navigation, sign-out,
  persisted theme and collapsible sidebar on `/`, `/patients`, patient detail and
  `/live`. The common shell is an authentication boundary; facility, patient and
  exact-encounter authorization remain server-side responsibilities.
- Completed current bounded slice: `/patients` is now a facility-authorized,
  D1-backed patient registry rather than an inert navigation item. It supports
  list/search, independently persisted artificial patient creation, versioned
  profile/identifier/contact data, optional R2 photo storage, patient detail and
  a separate clinician-assigned encounter creation path with eight empty sections.
  The resulting exact `encounterId` opens the authoritative dashboard on `/`.
  Multi-facility users must choose an authorized facility, and patient read
  responses fail closed unless the facility audit chain advances.
- Completed bounded slice: authenticated local speech capture and structured
  AI-draft generation are connected to the existing clinician-controlled encounter
  workflow. The browser performs calibrated voice-activity segmentation and sends
  ordered short WAV utterances; the server authorizes the exact assigned encounter,
  verifies current consent/lifecycle state, calls loopback-only GigaAM/CAMPPlus,
  and stores only final transcript segments and provenance. Raw audio is not kept.
- Transcript contract: active care, transcript-storage and transient-audio consent;
  `in_progress` encounter; one server-created upstream session; ordered/idempotent
  utterance hashes; append-only final segment versions; explicit STT/manual-review
  labels; immediate stop on consent/encounter change; no browser-visible upstream
  session identifier and no cross-patient stream reuse.
- AI contract: separate `external_ai_processing` consent for `groq`, stopped speech
  capture, no provisional segments, and clinician acknowledgement of the exact
  final/corrected transcript fingerprint. The server persists a durable running
  analysis before egress, invokes `openai/gpt-oss-120b` with JSON Schema, validates
  exact evidence quotes, rejects dose/imperative medication output, and creates
  only pending suggestions and AI-draft section versions. The clinician remains
  the only path to protocol acceptance.
- Operational surface: root `SETUP_ORION_CLINIC.bat`, `CONFIGURE_GROQ.bat`,
  primary `START_ORION.bat` (plus compatibility alias `START_ORION_CLINIC.bat`),
  and `STOP_ORION_CLINIC.bat` prepare and run the web
  workspace on `127.0.0.1:3200`, local speech on `127.0.0.1:3101`, forward-only
  D1 migrations, a patient-free technical identity bootstrap, ignored local
  secrets, PID files and logs. Patient/encounter fixtures are now an explicit
  engineering command and are not inserted by normal startup.
  Startup refuses occupied ports; stop validates checkout ownership and now works
  on Windows PowerShell without relying on the newer `String.Contains` overload.
  It also recovers a verified stale Vinext lock after Windows PID reuse and can
  reuse one already-ready ORION service when a previous partial start left only
  web or STT missing.
- Explicit legacy migration: the reviewed working face-to-face consultation UI,
  its browser VAD/STT client, Groq compatibility routes, history, recording and
  export behavior are available inside this checkout at `/live` as an additional
  module. The server-backed dashboard remains the main `/` surface. Its
  navigation item **«Очный приём · LIVE»** opens it; the old checkout is neither
  modified nor started as a second web process. The exact file map and
  compatibility limits are in `docs/migrations/legacy-live-consultation.md`.
- Documentation: `docs/user-guide/clinician-workspace.ru.md` now explains the D1
  patient registry/card/encounter flow, versioned profile update, stale-write
  recovery and non-destructive archive in addition to consent, microphone ownership,
  local no-retention STT, transcript review, explicit Groq launch and failure
  behavior. Nineteen verified desktop/mobile PNGs are retained with the guide;
  screenshots 18-19 show the versioned and archived patient states. Screenshots
  20-21 document the actionable `/live` consent gate and the eight-section
  clinical-record review guide. `docs/user-guide/orders-results.ru.md` explains
  the separate Phase 4 workflow and screenshot 22 records its loaded D1/R2 state.
  `docs/user-guide/scheduling-queue.ru.md` and
  `docs/user-guide/chronic-care.ru.md` document the local Phase 5 and Phase 6
  operator paths, role boundaries, retry behavior and external limitations.
  `docs/user-guide/patient-observations.ru.md` documents Phase 8A capture,
  correction/history behavior, safety boundary and three verified screenshots.
- Verification evidence on 2026-09-02: `pnpm verify:ci` passed secret scanning for
  183 tracked and untracked repository files, zero known dependency advisories,
  lint, strict types, 20 test files/97 tests, Drizzle drift check, every Vinext
  route build, and an isolated
  destructive-source restore matching 31 tables, 111 rows, 15 migrations, three
  R2 objects and 158,642 backup bytes. The source environment was destroyed before
  restore and hashes/cross-store integrity matched.
  After adding the compatibility launcher, a separate final secret scan covered
  184 files and PowerShell parsing plus staged/unstaged whitespace checks passed.
- Live-route evidence: after a clean stop/start, `/live` returned HTTP 200 and the
  migrated screen exposed the consent-gated start button, history drawer, dark
  theme and return link. A browser automation pass produced screenshot 12 with no
  console error on `/live`; the compatibility STT proxy and direct sidecar both
  reported the pinned GigaAM model and CAMPPlus speaker engine ready on CUDA. The
  post-migration secret policy passed all 205 tracked and untracked repository files.
- Patient browser evidence: a Sites-authenticated clinician created artificial
  patient `Пациент Проверка 0209`, reloaded the persisted D1 card, found it by test
  IIN, created a separate draft encounter and opened the exact new encounter in the
  main workspace. The workspace showed the correct patient/reason, eight empty
  sections and no invented transcript or AI output. Browser error/warning logs were
  empty. This is functional local evidence, not authorization for real patient data.
- Access-hardening evidence: the same card was reopened through a URL carrying
  `facilityId=fac-a`; the browser remained error-free and D1 contained the exact
  `patient.list` and `patient.read` actions with purpose `patient_directory_access`.
  Unit coverage validates facility-choice disclosure only for authorized
  memberships and file-signature rejection for false image uploads.
- Final gate: `pnpm verify:ci` passed for 236 repository files, zero known
  dependency advisories, 25 test files/119 tests and every production route. The
  isolated restore matched 36 tables/112 rows/16 migrations/three R2 objects and
  167,195 bytes after destroying only its isolated source environment.
- Speech evidence: the actual pinned local model returned the synthetic sentence
  `здравствуйте у меня болит голова второй день и поднялась температура`, role
  `Врач`, from a 6,615 ms 16 kHz mono WAV. A cold model start took 65,531 ms; this
  is functional evidence, not an approved latency or RU/KK quality benchmark.
- Browser evidence: the local Sites clinician opened the assigned synthetic
  encounter, received the access-audit receipt, confirmed recovery and all four
  separate consent decisions, and reached an enabled local-transcription control.
  No microphone permission was granted automatically and no ambient audio was
  captured. The corrected recovery grid computes to 44/438/190 px at the checked
  desktop viewport.
- Patient-mutation browser evidence on 2026-09-03: a Sites-authenticated clinician
  created two disposable artificial cards, appended profile version 2, archived as
  version 3, verified active/archive filtering and retained history, and reproduced
  a real stale-write conflict in two tabs. The first tab preserved its unsaved values
  and then loaded the second tab's server version. Browser logs contained no error or
  warning; no real patient data or external service was used.
- Latest final gate on 2026-09-03: `pnpm verify:ci` passed secret policy for 248
  tracked and untracked files, zero known dependency advisories, lint, strict types,
  27 test files/135 tests, Drizzle drift check and every production route build. The
  isolated destructive-source recovery matched 36 tables, 119 rows, 17 migrations,
  three R2 objects and 172,788 backup bytes after destroying only its disposable
  source environment.
- Phase 4 gate evidence on 2026-09-04: `pnpm verify` passed lint, types, 30 test
  files/172 tests, Drizzle and the complete Vinext build. D1 `quick_check` returned
  `ok`; isolated backup/restore matched 44 tables/122 rows/20 migrations/three R2
  objects/215,011 bytes; and the authenticated local request-to-result API/browser
  journey passed. Post-audit tests cover concurrent command replay, immutable
  response context, upload reservation/cleanup, exact review payloads, terminal
  states and UI transition choices. The external npm advisory endpoint timed out,
  so the aggregate `verify:ci` command is not labelled PASS for this checkpoint.
- Current data remains synthetic only. No clinic requirement, consent wording,
  model accuracy, or provider is approved for patient care merely because the
  local path works. Production OIDC/MFA, real patients, retention, legal signature,
  integrations, hosting, monitoring/SLO and clinical validation remain open.
- Current runtime at checkpoint: local web is intentionally left running on 3200.
  The loopback STT process is reachable on 3101, but its startup log reports that
  the pinned local model could not be loaded; it is not claimed ready in this
  checkpoint. Groq is wired but not runtime-verified because no fresh
  `GROQ_API_KEY` is present;
  previously disclosed keys were not copied. `CONFIGURE_GROQ.bat` is the only
  supported local secret-entry path and requires a restart.
- Completed current bounded slice: patient profile update and terminal archive are
  now server-backed D1 operations rather than presentation controls. Every mutation
  requires the current `expectedVersion`, a reason, explicit permission and a unique
  idempotency key; it appends a new immutable profile version and advances exactly
  one head. IIN cannot be changed by this workflow. Archive never deletes the patient,
  encounters, documents or earlier profile versions, and blocks later profile/photo/
  encounter writes. Active/archive/all directory filters and profile history expose
  the resulting state. A two-tab browser pass verified that a stale form receives a
  conflict, preserves its inputs and can load the server version.
- Completed current bounded slice: `/live` now resolves and displays the exact D1
  patient/encounter selected by the authoritative dashboard. Speech, transcript,
  acknowledgement, Groq generation and suggestion decisions re-authorize the exact
  assignment, lifecycle, consents and optimistic versions on the server. The live
  module does not substitute a random encounter, does not auto-run analysis in D1
  mode, and keeps IndexedDB names/history/optional audio explicitly non-authoritative.
- Browser/UI audit on 2026-09-03: desktop, 1024 px and 390 px checks covered the
  workday, patient directory, patient card and live route. Patient-search overflow,
  workday editor clipping, long-page recommendation visibility and the compact live
  header were corrected. Final pages had no body-level horizontal overflow and the
  browser warning/error log was empty. Microphone permission was not granted.
- Completed current defect checkpoint: `/live` no longer renders inert consent
  checkboxes. It exposes separate version-aware D1 commands for care/documentation,
  transcript storage and local transient-audio processing, plus an independent
  optional audio-retention decision. The start control unlocks only when the exact
  required current consent heads are effective. The shared shell now performs Sites
  sign-out at the top browsing context and keeps the action visible on mobile.
- Synthetic browser/API proof advanced only the artificial
  `encounter-a-lifecycle` care-consent head to version 8; it performed no microphone
  capture, external Groq call, protocol acceptance or real-patient mutation.
- Completed current usability checkpoint: the former ambiguous "Structured note"
  panel is now labelled as an eight-section clinical record and explains the
  edit/explicitly-absent/review sequence, current progress and the reason a section
  cannot yet be reviewed. This changes no clinical decision automatically.
- Requirements audit: `docs/requirements/implementation-gap-audit-2026-09-03.md`
  maps every clinic-leadership request to implemented, partial, not-started or
  external-input-blocked status. The working product now includes the encounter
  core, provider-neutral local directions/results and the local synthetic
  scheduling/queue slice. External order delivery, authoritative scheduling,
  chronic care, communications, observations and transfer remain open.
- Completed current bounded slice: `/scheduling` reads only approved referrals
  and explicitly labelled manual-test availability from D1; persists immutable
  preferences; performs idempotent/version-checked hold, patient confirmation,
  cancellation and no-show; prevents concurrent double booking; and advances an
  auditable queue ticket through arrival, call, service, completion or manual
  exception. Browser QA completed one full synthetic lifecycle. No AI-generated
  slot, real KMIS booking or notification is represented.
- Completed current bounded slice: `/care` reads a facility-scoped D1 registry,
  requires the managing doctor and the current doctor-signed protocol for local
  enrollment, signs immutable care-plan versions, and creates dated tasks only
  from the exact signed plan. Cohort reasons derive from the facility date. Nurses
  see only assigned tasks, record sourced patient responses and escalate; the
  managing doctor alone signs plans and resolves escalation. Browser QA covered
  the worklist, filters, plan editor, task dialog, responsive 390 px layout and
  empty warning/error console. ERDB/PUZ/free-medication/notification integrations
  remain visibly disconnected.
- Phase 6 gate evidence on 2026-09-05: `pnpm verify:ci` passed secret scanning
  for 313 tracked and untracked repository files, dependency audit with no known
  vulnerabilities, lint, strict types, 38 test files/208 tests, Drizzle drift
  check and the complete Vinext production build. Isolated destructive-source
  recovery matched 67 tables/124 rows/22 migrations/three R2 objects/316,415
  bytes. Active D1 `quick_check` returned `ok`, foreign-key check returned no
  rows, and the explicit rerunnable fixture retained one enrollment, one plan
  version and three current task versions. An unauthenticated direct API request
  returned 401 while the authenticated Sites browser loaded the same D1 cohort.
- Completed current bounded slice: `/communications` is a facility-scoped D1
  workspace for separate WhatsApp, Telegram, SMS and voice consent decisions,
  fixed `test:<channel>:<patientId>` destinations, latest approved RU/KK template
  resolution, and scheduled reminder intentions derived only from an actionable
  confirmed appointment or signed care-plan task. The transactional outbox records
  exact rendered content, policy, consent and source lineage before processing.
  The local processor is deliberately hard-disconnected: processing creates an
  audited provider-unavailable attempt, bounded retry or assigned manual-contact
  task and never sends, calls or fabricates delivery. Patient responses, nurse/
  doctor task actions, quiet hours, stale-version rejection and optimistic
  concurrency are persisted and role-authorized.
- Phase 7 local evidence on 2026-09-05: forward-only migrations `0022`-`0024`
  applied; the rerunnable fixture retained one policy and 16 latest RU/KK test
  templates; active D1 `quick_check` returned `ok` and foreign-key check returned
  no rows. Full repository verification and recovery evidence is recorded in the
  verification ledger above. Browser QA loaded five authorized synthetic patients,
  three exact signed-plan sources for `SYN-CARE-01`, the consent dialog and 390 px
  layout without warning/error logs or horizontal overflow; no consent or message
  command was submitted by browser automation.
- Completed current bounded slice: `/observations` now reads and writes
  facility-scoped synthetic measurements in D1. Height/weight, derived BMI, blood
  pressure and temperature retain explicit scaled units, source, recorder and
  measurement/recording times. Corrections append a version and advance one guarded
  head; no mutation or delete endpoint exists. Clinician/nurse permissions,
  idempotency, optimistic concurrency, active-patient scope and hash-chained audit
  are rechecked on the server.
- Phase 8A evidence on 2026-09-05: migration `0025` and its rerunnable fixture
  passed active D1 integrity; the authenticated browser completed create -> reload
  -> correct -> history for an artificial patient, showed versions 2 and 1, and had
  no warning/error logs or 390 px body overflow. The final aggregate gate covered
  361 files, 47 test files/269 tests and an isolated restore of 80 tables/128 rows/
  26 migrations/three R2 objects/389,707 bytes.
- Exact next bounded task: clinic owners review, fill and sign
  `docs/requirements/phase-8b-clinic-decision-packet.ru.md` and a separate approved
  copy of `phase-8b-decision-record.template.json`. Engineering must not infer
  signatures from chat. After valid `DEC-006`/`DEC-007` evidence exists, the next
  code checkpoint is an immutable signed-policy registry with no runtime alerts;
  critical classification, hospital notification and transfer stay blocked until
  their later explicit gates pass.
- Do not add ERDB/PUZ/free-medication adapters or infer a
  diagnosis from AI until their owners, terminology and legal basis are approved.
  The external parts of Phases 4 and 5 remain blocked on DEC-001/002/005 and the
  clinic scheduling contract.
  The synthetic RU/KK/MIXED
  speech-quality harness remains a required Phase 3 validation task and must precede
  any speech-model change or clinical accuracy claim.

### Historical checkpoint superseded on 2026-08-31

The following bullets are retained only as progress history. Do not continue from
their former "next task"; use the exact next task above.

- Active phases: `PHASE_0_IN_PROGRESS` for clinic review/discovery and
  `PHASE_2_IN_PROGRESS` for the bounded synthetic identity/consent foundation;
  the synthetic-only Phase 3 encounter slice is now also `IN_PROGRESS`. Phase 1
  is complete only for the verified synthetic local engineering foundation.
- Completed checkpoint: traceable draft clinic requirements and discovery pack;
  recognizable clinician workspace; encounter domain rules; a 23-table tenant-
  scoped domain schema; eight integrity/schema migrations; validated runtime configuration;
  PHI-minimized request logging/error envelopes; liveness/readiness endpoints;
  server-persisted recommendation and eight-section clinical-review paths;
  provider-neutral identity-to-membership resolution; exact assigned-encounter
  scoping for workspace reads and commands; D1-backed scoped transcript reads;
  versioned synthetic consent capture and consent-aware transcript access;
  synthetic patient/encounter creation with duplicate warning; audited,
  idempotent `draft -> ready -> in_progress` transitions; pinned CI gates; zero
  known dependency advisories; and a tested D1/R2 restore drill.
- Canonical requirement artifacts:
  `docs/requirements/clinic-leadership-catalogue.md` and
  `docs/requirements/clinic-discovery-pack.md`.
- Current data: synthetic only. No clinic requirement is approved merely because
  it appears in the draft catalogue.
- Current runtime: local web development server on port `3200` during explicit
  verification; no server deployment was performed.
- Current limitations: Sites authenticates a local synthetic user and D1 now
  authorizes the current clinician workspace through active membership, role,
  tenant, facility, patient, and exact encounter assignment. Production user
  provisioning, OIDC/MFA, multiple-membership selection, department permissions,
  real patient identity/search/merge, clinic-approved consent language,
  access-read audit, STT, AI analysis, document generation, and external systems
  are not connected. Current consent and creation flows are explicitly
  synthetic-only and are not approved for patient care.
- Production storage/auth: deliberately unresolved by DEC-008/DEC-009.
- Exact next implementation task: add append-only synthetic transcript
  correction/manual speaker assignment, then implement the clinician-controlled
  `in_progress -> review` transition and create an immutable protocol draft only
  when every mandatory section is reviewed or explicitly absent. Add allow/deny,
  stale-version, replay, audit, and recovery tests. Do not process audio or call
  AI, and do not infer KMIS/ERDB/PUZ/ECG/transfer contracts.

### Historical handoff superseded on 2026-08-31

- Date and time: 2026-08-31 13:20 +05:00
- Agent: Codex
- Phase: Phase 0 clinic review remains open; synthetic local Phase 1 is complete;
  bounded Phase 2 identity/consent and Phase 3 encounter slices are in progress
- Branch/commit: `main`; baseline commit pending because Git user name and email
  are not configured on this host
- Goal: preserve the verified foundation and finish the bounded synthetic
  patient/encounter, consent, and lifecycle checkpoint without enabling real
  patient data, audio processing, AI egress, or external systems.

Completed:

- added an immutable versioned consent-event/current-head model, RU/KK synthetic
  policy reference and hash, visible clinician capture controls, transcript
  storage gate, and effective-care gates for current clinical commands;
- added D1 and application guards for linear versioned encounter transitions,
  including millisecond-accurate consent checks, optimistic versions,
  idempotent replay snapshots, correlated audit events, and neutral errors;
- added synthetic-only patient/encounter creation with an explicit no-real-data
  acknowledgement, server-generated test MRN, exact clinician assignment, eight
  empty section heads/versions, duplicate candidate warning, audit, and replay;
- added a second assigned lifecycle fixture and a functional creation/lifecycle
  UI while leaving every new encounter without implicit consent;
- updated the recovery drill for versioned consent heads and dynamic migration
  discovery; recovery passed for 24 tables, 99 rows, eight migrations, and three
  R2 objects after destroying the isolated source;
- verified authenticated consent denial/regrant, blocked and allowed lifecycle
  behavior, exact replay, changed-key conflict, duplicate warning, creation,
  eight-section reload, and no-consent clinical denial against local port 3200;
- added the traceable clinic-leadership requirements catalogue and the workshop,
  RACI, KPI, integration-passport, and review-record discovery pack;
- added a provider-neutral identity principal and a D1 access repository that
  resolves active memberships from the local Sites identity;
- enforced clinician role and exact assigned encounter on workspace, section,
  recommendation, and transcript paths; unassigned/cross-tenant IDs return 404;
- parameterized clinical-section and recommendation repositories with the
  resolved scope, removing `SYNTHETIC_WORKSPACE_SCOPE` from runtime code;
- moved the visible synthetic transcript from static client copy to four scoped
  D1 segments and added a truthful empty state for encounters without transcript;
- updated the UI to display D1-derived viewer, organization, facility, patient,
  encounter status, record number, and assigned-encounter selector;
- added a second isolated synthetic tenant and a registrar fixture for repeatable
  denial cases without introducing real patient data;
- passed the aggregate `verify:ci` gate (strict types, lint, 43 tests, schema
  check, build, dependency/secret checks, isolated recovery), local seed,
  authenticated scoped workspace read, and neutral cross-tenant 404 verification;
- preserved the legacy checkout;
- created the new project directory;
- initialized an independent Git repository on `main`; no author identity was
  invented, so the first commit remains pending;
- generated the Sites/Vinext scaffold with D1 and R2 capabilities;
- installed dependencies after explicitly allowing the scaffold's required
  native build packages;
- created the agent protocol, master plan, and ADR-0001;
- researched current Abridge, Nabla, Heidi, and Linear design patterns;
- completed the professional clinician workspace using self-hosted Golos Text,
  stable doctor/patient role colors, eight structured sections, and clearly
  separated clinician-only recommendations;
- added encounter state and protocol-readiness rules with clinician-controlled
  suggestion inclusion;
- added 22 tenant-scoped tables, explicit SQLite constraints, immutable clinical
  versions, append-only decisions, audit chains, consent events, idempotency,
  and outbox delivery state;
- generated five schema/integrity migrations and applied them to local D1;
- added integration tests for tenant isolation, enum enforcement, final
  transcript immutability, and audit-chain integrity;
- fixed amendment, expiry, audit-head scope, version-lineage, and empty-schema
  readiness gaps found by an independent final audit;
- added D1/R2 liveness/readiness routes and a reproducible verification gate;
- added an idempotent synthetic seed and a D1 repository for recommendation
  review decisions;
- protected workspace API reads and writes with Sites identity headers, same-
  origin mutation checks, optimistic versions, idempotency, and append-only audit;
- connected accept/reject/restore UI actions to server persistence with explicit
  loading, saved, sign-in, and error states;
- added a fail-closed synthetic-only runtime configuration contract shared by
  Wrangler and the Vinext/Vite local runtime;
- added bounded correlation IDs, no-store API responses, uniform public error
  envelopes, and allowlisted technical logs that never accept clinical content;
- separated request correlation from mutation idempotency in the audit trail;
- seeded and served all eight canonical clinical sections through a D1
  repository rather than static UI copy;
- added immutable edit/review/explicit-absence versions, server-derived review
  states, exact replay, stale-write rejection, bounded audit-contention retry,
  and current-head-only reads;
- added SQLite guards preventing clinical/audit head regression, branching,
  deletion, inconsistent reviewed/empty content, and mutable idempotency records;
- connected the clinician editor to server versions with per-section unsaved
  drafts, visible state labels, one-step save-and-review, explicit absence
  confirmation, conflict preservation, and correlation-aware error recovery;
- documented the verified single-command local runtime, proposed web/worker/
  migrate roles, and server boundary while leaving hosting, residency, and
  production storage unresolved by DEC-008;
- reconciled custom migrations with the Drizzle journal and snapshots so clean
  generation produces no drift;
- updated compatible build/runtime dependencies, pinned Node 24.19.0 and pnpm
  11.19.0, and reduced the advisory audit to zero known vulnerabilities;
- added tracked-file secret/artifact scanning, Linux/Windows CI verification,
  migration-drift and recovery jobs, pinned action revisions, and weekly
  dependency update configuration;
- implemented and passed a destructive-in-isolation logical D1/R2 backup and
  restore drill with completed-backup markers, SHA-256 verification, source
  destruction, clean-target guards, audit continuity, and cross-store checks;
- verified the production build, 37 automated tests, authenticated persistence,
  exact replay, stale conflicts, explicit absence, audit correlation, reload,
  local health responses, frozen installation, dependency/secret gates, recovery,
  and the rendered interface baseline on port 3200.

Not implemented or not yet production-verified:

- production authentication and authorization enforcement;
- STT, AI provider, document renderer, external integration, or real patient
  workflow in this new codebase;
- server persistence for transcript corrections and protocol/signature actions;
  recommendation and structured-section review persistence are implemented only
  for assigned synthetic encounters and have not been clinically validated;
- production identity provisioning, multiple-membership selection, department
  permissions, real patient search/merge, clinic-approved consent content,
  access-read audit persistence, session revocation, service accounts, or
  break-glass access;
- approval of D1/R2 or any hosting region for medical data;
- production backup scheduling/retention, point-in-time recovery, disaster
  recovery, real-data security, clinical validation, and operational SLOs;
- first Git commit until the owner configures `user.name` and `user.email`.

Next exact step:

- implement append-only synthetic transcript correction and manual speaker-role
  assignment, then gate `in_progress -> review` and immutable protocol-draft
  creation on eight human-resolved clinical sections; keep audio/AI egress
  disabled and add replay, stale-write, denial, audit, and recovery coverage.

Do not touch:

- the legacy `ariaproject` working tree;
- previously created user data, audio, keys, or local environment files.

## 16. Last handoff

### 2026-09-06 — Phase 2B department and access-governance checkpoint

- Agent: Codex, with independent schema, authorization-test and self-access UX
  subtasks. Two delegated runs reached the workspace spend cap only after
  returning their findings; root independently completed and verified the work.
- Repository: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC` on
  `main`. The legacy `ariaproject` was not changed.
- Verified implementation commit: `578a448` (`feat: add department access
  governance`).
- Scope: synthetic local D1 only. Added departments, append-only organization /
  facility / membership access assignments, seven stable role categories,
  effective-permission derivation, a minimized authenticated `GET /api/access`
  contract and the read-only `/access` operational screen.
- Security boundary: explicit denial wins; expired, revoked, suspended, disabled
  and unknown assignments fail closed; a service role cannot be combined with an
  interactive role or open the workspace; multiple scopes require explicit
  selection and are never merged.
- Verification: `pnpm verify:ci` passed 379-file secret policy, dependency audit,
  lint/types, 53 test files/325 tests, schema/build and isolated restore of 84
  tables/133 rows/27 migrations/three R2 objects/412,447 bytes after destroying
  only the disposable source. D1 quick/foreign-key checks, double bootstrap,
  `/access`, anonymous 401 and responsive/theme browser behavior also passed.
- Runtime: web 3200, loopback STT 3101 and ngrok 4040 remain running. The reserved
  external URL returns HTTP 200. No deployment, microphone capture, external AI
  call, real data or production access claim was made.
- Owner working-tree note: the pre-existing standalone `a` under the risk-register
  heading remains deliberately unstaged and must not be removed or committed.
- Limitation: the rest of the clinical APIs still enforce their existing proven
  `memberships.role` matrices. There is no administrator grant/revoke UI or
  versioned department-administration workflow, production OIDC/MFA, session
  revocation, service credential or break-glass flow.
- Exact next bounded task (Phase 2C): add versioned department administration and
  append-only administrator commands for grant/change/revoke, then migrate one
  protected resource family at a time to an
  explicitly selected assignment and effective permission while preserving
  organization/facility/patient/purpose/consent/state checks and neutral denial.

### Previous handoff — 2026-09-05 Phase 8B

- Date: 2026-09-05, Phase 8B clinic decision-gate checkpoint.
- Agent: Codex.
- Repository: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC`.
- Product name: **ORION Clinic**; **ORION** is the short product mark.
- Branch/baseline before this checkpoint: `main` at `1bada2b`; Git identity is repository-local
  and derived from the authenticated owner `shadowuneed`, leaving global Git
  configuration unchanged.
- Verified Phase 8A implementation commit: `89819fe` (`feat: add audited patient
  observation capture`).
- Verified Phase 8B review-artifact commit: `3ee0f50` (`docs: add phase 8 clinic
  decision packet`).
- Private remote: `https://github.com/shadowuneed/ORION-CLINIC`.
- Owner working-tree note: the pre-existing standalone `a` under the risk-register
  heading remains deliberately unstaged and was neither removed nor staged.
- Runtime at handoff: local web and loopback speech processes are intentionally left
  running on ports `3200` and `3101`; no production deployment was made. The
  existing reserved ngrok endpoint is running through its external LocalAppData
  Traffic Policy: an anonymous application request returns Basic-auth `401`, while
  no credential or policy content is copied into Git. Web/STT readiness is `200`;
  STT reports local GigaAM/CAMPPlus ready on CUDA, but reachability is not a new
  RU/KK quality claim. Groq was not runtime-tested because no fresh ignored
  `GROQ_API_KEY` is configured. Ignored local secrets are never committed.

Completed in this checkpoint:

- added a Russian, clinic-facing `DEC-006`/`DEC-007` decision packet with explicit
  owners, evidence, rule/version fields, state transitions, acknowledgement/SLA,
  override, minimum transfer packet, receiving-facility and sign-off sections;
- added a machine-readable decision template that is deliberately
  `draft_unapproved`, activation-blocked, empty of clinical rules and without a
  preselected “digital twin” meaning;
- linked the packet from the catalogue, discovery pack and README, and updated
  the gap audit from `NOT_STARTED` to `BLOCKED_CLINIC_APPROVAL` without claiming
  any runtime critical-state or transfer capability;
- passed `pnpm verify:ci`: 363 files scanned, no known dependency vulnerabilities,
  lint/types, 47 test files/269 tests, Drizzle/build and isolated recovery of 80
  tables/128 rows/26 migrations/three R2 objects/389,707 bytes;
- restored the pre-existing reserved ngrok endpoint against port `3200` using the
  external LocalAppData Traffic Policy; the post-warning anonymous application
  request returned `401 Basic`, and no credential entered the repository;
- added migration `0025` with tenant-scoped observation record, immutable version
  and guarded current-head tables, scaled-unit constraints, derived-BMI checks,
  active-patient/member guards and append-only database triggers;
- added authenticated `GET/POST /api/observations` and version-checked
  `PATCH /api/observations/:observationId` with facility scope, clinician/nurse
  authorization, idempotency, optimistic concurrency and correlated audit;
- added the responsive `/observations` workspace with real D1 patient search,
  create/correct/history flows, light/dark support and an explicit no-interpretation
  boundary while `DEC-006` remains open;
- added the rerunnable observation fixture and Russian operator guide with verified
  desktop/form/mobile screenshots; a browser journey persisted a synthetic record,
  corrected it as version 2 and retained version 1 without console errors;
- passed the final `pnpm verify:ci`: 361 files scanned, no known dependency
  vulnerabilities, lint/types, 47 files/269 tests, Drizzle/build and isolated
  recovery of 80 tables/128 rows/26 migrations/three R2 objects/389,707 bytes;
- added the Phase 7 `/communications` workspace and provider-neutral D1 lifecycle
  for separate channel/language consent, signed-source scheduling, immutable
  outbox intent, quiet hours, bounded disconnected-provider retry, response and
  assigned manual fallback;
- restricted every destination to an exact system-generated synthetic alias,
  pinned exact approved template/policy/source lineage, and added SQL guards for
  direct destination, purpose, body, payload and cross-task response tampering;
- added facility/patient/role authorization, idempotent replay, optimistic version
  checks, current-source/consent validation and due-time enforcement in repository
  and API boundaries;
- added the rerunnable communications fixture, Russian operator guide and verified
  desktop/dialog/mobile screenshots without enabling a real provider or delivery;
- added migrations `0017`-`0019`, eight tenant-scoped D1 tables for request/report
  identity, immutable versions, current heads and R2 artifact metadata, plus
  durable result-upload intents and database triggers for no-update/no-delete,
  linear lineage, active-care, exact review-payload and cleanup lifecycle guards;
- added clinician-only, assigned-encounter and current-care-consent repository/API
  paths for draft, separate approval, hold/resume/revoke/error/complete, result
  attachment, review/reconciliation, idempotency, optimistic conflicts and
  PHI-minimized hash-chained audit;
- added the integrated `/orders` surface with search, type/status/facility filters,
  real D1 list/detail/history, creation, status controls, PDF/JPEG/PNG attachment,
  reviewed-result completion gate, R2 download and light/dark responsive states;
- verified the full synthetic HTTP journey, byte-identical file download, 172 tests,
  production build, D1 quick check and 44-table isolated recovery; recorded the npm
  advisory endpoint timeout separately instead of claiming aggregate CI success;
- closed the final independent-audit findings: immutable response replay includes
  the command-time patient/encounter context, terminal requests reject result review,
  audit contention retries fail closed, UI options reuse domain transitions, and
  incomplete R2 writes remain traceable through retry and audited expiry cleanup;
- fixed local Vinext stability by excluding checkout-local runtime, Wrangler,
  artifact, backup, export and recording paths from the source watcher;
- added the Phase 4 Russian user guide and verified screenshot 22. The local
  workflow does not claim KMIS/LIS/ECG transmission or clinical interpretation;
- replaced the non-interactive `/live` consent display with four independent,
  version-aware D1 actions: the three exact required decisions gate local STT and
  optional audio retention remains a separately revocable choice;
- made the missing consent names and versions visible, kept RU/KK capture language
  explicit, and verified that the start button becomes enabled only after the exact
  current heads are effective without starting the browser microphone;
- made Sites logout navigate the top-level browsing context, retained the action on
  compact layouts and added pure fail-closed navigation tests;
- renamed and documented the eight-section clinical-record review surface, including
  progress, edit/no-information choices and disabled-review explanations;
- added an implementation-gap audit covering all clinic-leadership requirements and
  recorded the then-current Phase 4-8 gaps; later checkpoints below supersede its
  local-module status without claiming external integrations;
- bound `/live` to the exact server-authorized D1 encounter, patient, consent,
  transcript, analysis acknowledgement and recommendation-review state;
- removed random encounter selection and automatic live analysis from authoritative
  D1 mode while retaining browser names/history/optional audio only as visibly local
  convenience artifacts;
- connected live speaker/text corrections and suggestion accept/reject/restore/edit
  actions to existing append-only, optimistic and idempotent D1 repositories;
- corrected patient-directory desktop/mobile sizing, workday editor clipping,
  sticky desktop clinician recommendations and compact mobile live navigation;
- audited protected API mutations for authentication/same-origin enforcement,
  verified web/STT health plus D1 quick/foreign-key integrity, and protected existing
  R2 patient-photo bytes from rollback deletion on an idempotent upload failure;

- added additive migration `0016` with a self-referential predecessor link,
  immutable profile-version and head guards, linear one-version head advancement
  and terminal archive enforcement without rewriting or deleting an existing row;
- added validated `PATCH /api/patients/:patientId` and
  `POST /api/patients/:patientId/archive` commands with same-origin checks,
  facility scope, explicit `patient.update`/`patient.archive` permissions,
  optimistic version conflicts, idempotency and PHI-minimized audit events;
- added integrated clinician UI for editing all mutable demographics/contacts,
  keeping IIN read-only, recording a mandatory reason, loading the current server
  version after a two-tab conflict, viewing the complete profile-version history,
  archiving without deletion and filtering active/archive/all records;
- verified with artificial browser data that create -> version 2 update -> version 3
  archive persists in D1, disappears from the active list, remains directly readable
  and appears in the archive; archived controls for edit/photo/new encounter are gone;
- wrapped `/`, `/patients`, patient detail and `/live` in one responsive ORION
  Clinic shell with consistent active navigation, current Sites identity,
  sign-out, persisted light/dark theme and collapsible sidebar;
- removed duplicate page-level product chrome and non-working future-stage global
  navigation; task-specific page content remains separate while typography,
  spacing tokens and authentication behavior are shared;
- removed development-only anonymous bypasses from compatibility speech and
  clinical-analysis routes; anonymous UI routes redirect to sign-in and protected
  APIs return 401;
- recorded loaded authenticated browser views of the workday, D1 patient registry
  and live consultation in screenshots 15-17;
- hardened `START_ORION.bat` against a verified stale Vinext PID lock and partial
  startup; one recovery start and one idempotent second start completed successfully;
- verified the final checkpoint with `pnpm verify:ci`: 248 repository files passed
  secret policy, dependency audit was clean, 27 files/135 tests passed, every route
  built and isolated D1/R2 recovery matched 36 tables/119 rows/17 migrations/three
  R2 objects/172,788 bytes after disposable-source destruction;
- added a facility-level authorization boundary independent of any existing
  encounter, with clinician/registrar allow cases and deny-by-default tests;
- added versioned patient profile versions/heads, test-IIN identifiers and R2
  photo asset/head metadata in additive migration `0015`; no active local row was
  deleted or rewritten;
- added authenticated `/api/patients` list/create, patient detail, photo and
  existing-patient encounter-create APIs backed by D1/R2 repositories, idempotency,
  duplicate protection and audit events;
- made successful patient list/detail/photo reads fail closed on the facility
  audit hash chain, added authorized multi-facility selection with scope-preserving
  links, content-verified test-only image uploads and clinician-only encounter UX;
- added `/patients` and `/patients/:patientId` with real search, create, persisted
  detail, contact/history views and a create-and-open encounter flow; removed fake
  navigation badges and made unimplemented modules visibly disabled;
- replaced automatic patient fixture insertion during normal launch with a
  patient-free technical bootstrap; `db:seed:local` remains an explicit optional
  engineering-fixture command and existing local records are preserved;
- verified the complete UI path with artificial data: create patient, reload,
  search by test IIN, create encounter and open the correct draft workspace with
  eight empty sections. Browser errors/warnings were empty; screenshots 13 and 14
  are included in the clinician guide;
- migrated the reviewed working ORION consultation surface into this repository
  at `/live`, including consent-gated microphone capture, live transcript,
  doctor/patient display, timed Groq suggestions, clinician decisions, basket,
  history/rename, optional browser recording and protocol/transcript/audit/ZIP
  downloads, without starting the old checkout as another application;
- reused the already-adapted loopback GigaAM/CAMPPlus service on port 3101 and
  added compatibility speech/clinical routes under the single web process on
  port 3200; no legacy secret or patient data was copied;
- added **«Очный приём · LIVE»** to the ORION Clinic navigation, a return link,
  and added migration inventory, README/user-guide routing and verified
  screenshot 12 while preserving the dashboard as the main `/` surface;
- added migrations `0012`-`0014` for speech sessions/runs/results, analysis-run
  consent and transcript acknowledgement, append-only/lifecycle guards, and one
  active analysis per exact input while preserving forward-only D1 upgrades;
- added loopback-only GigaAM/CAMPPlus provider, health/session/transcription APIs,
  consent/lifecycle/idempotency-checked transcript ingestion and append-only STT
  provenance with no raw-audio retention;
- added AudioWorklet PCM capture, calibration, RMS VAD, 300 ms pre-roll, ordered
  uploads, 16 kHz mono WAV encoding, explicit stop/finalization and stream cleanup;
- added server-side Groq `openai/gpt-oss-120b` provider, strict structured output,
  exact evidence validation, medication safety filters, durable runs, pending
  suggestions and AI-draft clinical sections;
- added the fourth external-AI consent, exact transcript fingerprint acknowledgement,
  explicit STT/correction labels, independent speech/analysis UI states and review
  blocking while capture/finalization/analysis is active;
- added self-contained `services/local-speech`, one-time setup/configuration and
  safe start/stop BAT/PowerShell scripts, local logs/PIDs, port collision guards,
  automatic local migration/bootstrap, and a synthetic speech smoke script;
- fixed the desktop recovery grid and Windows PowerShell stop-script compatibility;
- updated README and the Russian clinician guide with a verified eleventh screenshot.

Known limitations and non-claims:

- Phase 4 is only a provider-neutral local D1/R2 slice: no KMIS/LIS/ECG
  transmission, external acknowledgement/retry, structured vendor import or raw
  ECG-waveform interpretation is implemented. Phase 5 is only a labelled local
  synthetic D1 scheduling/queue slice: no real KMIS availability, reschedule,
  waitlist, notifications, trusted automatic hold-expiry worker or external
  reconciliation is implemented. Phase 6 chronic-care and nurse workflows are
  local synthetic D1 only. Phase 7 communications is a local no-send outbox with
  exact test aliases and a disconnected provider; it has no WhatsApp Business,
  Telegram, SMS, telephony, delivery receipt, protected-link host or approved
  production content/account. Phase 8A observation capture is local synthetic D1
  only; clinic-approved thresholds, critical status, alert/SLA, receiving-hospital
  acknowledgement, transfer packet and longitudinal handoff remain absent;
- the unified shell uses the current local Sites identity path; it does not approve
  production provisioning, OIDC/MFA, session policy or clinic role governance, and
  visual consistency is not evidence that every API authorization boundary has
  been clinically or production validated;
- duplicate merge, production encryption/search of real identifiers, production
  permission governance and department scoping remain open; the current explicit
  profile mutation matrix is limited to the synthetic clinician/registrar roles,
  and test IIN is allowed only behind the artificial-data development gate;
- `/live` is an additional interaction surface over the same exact D1 encounter;
  browser IndexedDB names/history and optional browser audio remain compatibility
  artifacts, not the authoritative D1/R2 signed medical record;
- the actual local speech model was verified with a synthetic WAV, but the browser
  microphone was not started automatically and no ambient audio was captured;
- speaker role `Врач` was returned for the enrolled first synthetic voice, but
  RU/KK/mixed WER/CER, diarization accuracy, clinical negation and medication
  benchmarks remain unapproved;
- the Groq request path and tests are complete, but no real external request was
  made without a fresh ignored `GROQ_API_KEY`; old disclosed keys were not reused;
- no real patient, production identity, clinic-approved consent, production
  hosting/storage/retention, legal signature, KMIS/ERDB/PUZ/ECG/messaging or
  clinical release is claimed;
- `pnpm verify:ci` proves this synthetic local build and isolated recovery, not
  production multi-region failover, RPO/RTO, SLO or medical safety.

Next agent commands:

```powershell
cd "C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC"
git status --short
git diff --check
.\START_ORION.bat
Invoke-RestMethod http://127.0.0.1:3101/health
Start-Process http://localhost:3200/observations
pnpm db:seed:local
pnpm db:seed:scheduling:local
pnpm db:seed:care:local
pnpm db:seed:communications:local
pnpm db:seed:observations:local
pnpm verify:ci
```

The next bounded slice is the Phase 8B clinic decision packet for DEC-006/DEC-007:
define proposed deterministic observation rules, rule-version approval and owner,
alert acknowledgement/escalation SLA, doctor confirmation/override, receiving-
facility contract, minimum signed transfer packet and the exact non-predictive
meaning of the longitudinal view. This is a review artifact, not permission to
activate clinical automation. Do not classify critical status, notify another
hospital or initiate transfer until named clinic owners approve it. The external
portions of Phases 4-7 remain blocked on their named decisions and provider
contracts. No external delivery, invented availability, inferred diagnosis or
ERDB/PUZ/free-medication claim is allowed until its source of truth, sandbox, legal
basis and human owner are named.
The synthetic RU/KK/MIXED speech-quality harness remains required before any speech
model change or clinical-accuracy claim. Do not implement patient merge or physical
deletion.

Do not touch the legacy `ariaproject`, do not add real patient data, do not copy
legacy/disclosed secrets, and do not start external clinic integrations without
the named open decisions. This is the current canonical continuation point.

## 17. Append-only plan change log

### 2026-08-28 — initial program plan

- Reason: clinic leadership requirements expanded ORION beyond a visit demo.
- Decision: preserve legacy and create a separate production-oriented codebase.
- Added: clinical boundaries, architecture, design rules, phases, gates, open
  decisions, acceptance contract, verification, risks, and handoff protocol.
- Next: first clinician workspace plus domain and schema foundation.

### 2026-08-28 — verified clinician workspace and data foundation

- Reason: the first durable checkpoint needed a real visual surface and
  enforceable data invariants before feature integrations.
- Decision: use Golos Text, keep all visible records synthetic, and model
  clinical changes as versioned or append-only data under tenant constraints.
- Added: clinician workspace, 22-table schema, four migrations, D1/R2 health
  checks, encounter rules, 21 tests, explicit migration check, and production
  build verification.
- Limitation: authentication, STT, AI, documents, and server-persisted encounter
  commands remain intentionally outside this checkpoint.
- Next: safe configuration and structured clinical-section persistence.

### 2026-08-28 — first server-persisted clinician decision

- Reason: the visual workspace needed an observable server-backed behavior, not
  only a static product surface and schema.
- Decision: keep the flow synthetic, require Sites identity for API access, and
  persist clinician recommendation decisions through a repository with
  optimistic versions, idempotency, append-only decisions, and chained audit.
- Added: idempotent local seed, workspace read API, recommendation decision API,
  authenticated local flow, same-origin mutation guard, and visible save states.
- Verified: an accepted decision remained accepted after reloading from D1,
  version advanced from 1 to 2, audit sequence advanced from 0 to 1, anonymous
  access returned 401, 21 tests passed, and the production build completed.
- Limitation: the membership is a synthetic fixture; production OIDC, RBAC, and
  clinic membership provisioning remain Phase 2 work.
- Next: environment/logging foundation and versioned clinical-section review.

### 2026-08-28 — completed synthetic local engineering foundation

- Reason: the next contributor needed a reproducible runtime boundary, enforced
  quality gates, and evidence that structured and object data can be recovered
  before feature work expands.
- Decision: keep the verified current runtime as Sites/Vinext with local D1/R2;
  describe future web/worker/migrate roles but do not create or claim a
  production container topology before DEC-008 and DEC-015 are resolved.
- Added: Node/pnpm pins, normalized repository files, reconciled Drizzle journal
  snapshots, secret and dependency gates, Linux/Windows CI, Dependabot, runtime
  topology, CI/runbook documentation, and a destructive-in-isolation D1/R2
  backup/restore drill.
- Verified: frozen install, clean migration generation, zero known dependency
  advisories, no peer issues, 70 tracked-file secret/artifact scan, 37 tests,
  production build, and recovery of 23 tables/38 rows/five migrations/three R2
  objects with database and object hashes.
- Limitation: this proves only the synthetic local foundation; vendor, region,
  production database/object storage, backup schedule, RPO, and RTO remain open.
- Next: trace the clinic leadership messages into a reviewed requirements
  catalogue before selecting Phase 2 implementation scope.

### 2026-08-31 — traceable clinic draft and membership-scoped workspace

- Reason: clinic-leadership messages had to become reviewable requirements, and
  the fixed `org-a/fac-a/encounter-a/membership-a` runtime shortcut was unsafe to
  extend into additional workflows.
- Decision: keep every source-derived requirement in draft state until named
  clinic review; begin only the provider-neutral, synthetic Phase 2 access slice
  that does not depend on unresolved production OIDC or clinic integrations.
- Added: requirements catalogue, discovery pack, provider-neutral principal,
  active D1 membership lookup, clinician/assignment authorization, scoped
  encounter summaries, D1 transcript reads, two isolated tenant fixtures, and
  updated dynamic workspace context.
- Verified: types, lint, 43 tests, local migration/seed, authenticated read of
  one assigned encounter with 8 sections/4 transcript segments/3 suggestions,
  and neutral 404 for an existing cross-tenant encounter ID.
- Limitation: local Sites identity and all records remain synthetic. This does
  not approve production authentication, real patient data, STT/AI egress, or
  any external system contract.
- Next: synthetic patient/encounter creation plus versioned consent capture and
  consent-gated encounter transitions with idempotent audit-backed commands.

### 2026-08-31 — versioned consent and synthetic encounter lifecycle

- Reason: the next durable slice needed to prove that an authenticated assigned
  clinician can create a test encounter, record a patient's explicit decision,
  and advance lifecycle state without hidden client-only shortcuts.
- Decision: remain fail-closed and synthetic-only; never infer consent, never
  auto-merge a duplicate candidate, and require D1 authorization, effective care
  consent, optimistic versions, idempotency, and append-only audit for mutations.
- Added: consent event heads and synthetic RU/KK policy hash, visible consent UI,
  transcript and care gates, forward-only lifecycle triggers, synthetic
  patient/encounter creation, eight initialized sections, duplicate warning,
  lifecycle controls, and dynamic migration-aware recovery verification.
- Verified: 48 automated tests, strict types/lint/schema check/build, authenticated
  consent deny/regrant and lifecycle commands, exact replay and changed-key
  conflict, idempotent creation and duplicate warning, eight-section reload,
  no-consent denial, and isolated D1/R2 recovery across 24 tables/99 rows/eight
  migrations/three objects.
- Limitation: the consent text and identity are local synthetic fixtures; no real
  patient data, audio, STT, AI, document signing, external integration, hosting,
  clinical validation, or legal approval is claimed.
- Next: append-only transcript corrections/manual speaker attribution followed by
  the human-review and immutable protocol-draft gate.

### 2026-08-31 — immutable signed protocol and verified document package

- Reason: the clinician-controlled encounter slice needed to produce a real,
  inspectable record from only human-resolved content instead of stopping at a
  browser draft.
- Decision: sign an immutable source snapshot, finalize the encounter, reject
  subsequent clinical mutations, and generate every document from that exact
  signed source; audio remains absent until a real consent-gated capture adapter
  exists.
- Added: append-only transcript correction and manual speaker/language review;
  mandatory-section readiness; immutable protocol draft and signed version;
  protocol-head integrity migration; DOCX/PDF/TXT/audit JSON/ZIP generation;
  D1/R2 artifact metadata and hashes; authenticated scoped generation/download;
  download audit; finalized UI/server mutation locks; and document controls in
  the clinician workspace.
- Verified: `pnpm verify:ci` passed 52 tests and recovery across 24 tables,
  100 rows, nine migrations, and three isolated R2 fixtures; authenticated live
  generation and all five downloads passed; Word and Poppler renders were both
  inspected as two pages; ZIP manifest size/hash checks passed for every file.
- Limitation: all records are synthetic. Live audio/STT/AI, production identity,
  legal e-signature, amendment, real integrations, deployment, and clinical
  validation remain open.
- Next: explicit versioned amendment from the signed protocol with reason,
  author, predecessor, new artifact package, and API/recovery denial coverage.

### 2026-08-31 — append-only signed protocol amendment

- Reason: a physician must be able to correct or supplement a signed protocol
  without deleting history or silently changing the document already signed.
- Decision: preserve every signed source, create a new signed successor and one
  append-only amendment record, expose only a dedicated amendment surface, and
  regenerate exports from the new immutable head.
- Added: `protocol_amendments`, protocol/encounter lineage triggers, amendment
  repository and API, exact idempotency and optimistic versions, clinician UI and
  history, amendment rendering in DOCX/PDF, artifact invalidation/regeneration,
  and amendment-aware audit export.
- Verified: authenticated v2 to v3 browser flow; 57 tests; clean lint, types,
  Drizzle, build, secrets, and dependency audit; two-page DOCX/PDF inspection;
  matching D1/R2/ZIP hashes; and isolated recovery across 25 tables, 101 rows,
  ten migrations, and three R2 fixtures.
- Limitation: all records remain synthetic; legal e-signature, live audio/STT/AI,
  production identity, external integrations, deployment, and clinical validation
  remain open.
- Next: versioned clinician editing of recommendations while retaining the
  immutable AI original, evidence provenance, decisions, and complete audit.

### 2026-09-01 — versioned clinician recommendation editing checkpoint

- Reason: a clinician must be able to refine an AI suggestion without changing
  its source or allowing an unreviewed text to enter the medical protocol.
- Decision: preserve the AI original, store every clinician edit as an immutable
  derivative, require acceptance of an exact derivative version, and snapshot
  that version into draft, signature, audit, and export artifacts.
- Added: migration `0010`; derivative version/head repositories; edit and exact
  decision APIs; original-versus-clinician comparison UI; basket/restore history;
  signed-protocol provenance; and DOCX/PDF/TXT/JSON/ZIP export coverage.
- Verified: legacy migration preservation; 27 targeted tests; full CI verification;
  authenticated synthetic browser flow; byte-identical draft/sign sources; visual
  inspection of two-page Word and PDF renders; matching D1/R2/ZIP hashes; and a
  destructive-in-isolation restore of 27 tables, 105 rows, 11 migrations, and
  three R2 objects.
- Limitation: all verification is local and synthetic. Real patients, production
  identity, legal e-signature, microphone/audio, STT, live AI, external clinic
  integrations, clinical validation, and deployment remain out of scope.
- Stop point: checkpoint complete. No next roadmap item was started; continue only
  after an explicit owner request.

### 2026-09-01 — protected access audit and illustrated user guide

- Reason: protected reads and file responses must be attributable without mixing
  access telemetry into the clinical command chain or copying PHI into audit.
- Decision: use one append-only hash stream per resolved clinician membership;
  fail closed before workspace JSON or file bytes; keep pre-scope denials in the
  existing PHI-safe request log until a separate global security retention model
  is approved.
- Added: migration `0011`, access hash/repository/tests, SQLite actor/resource and
  head guards, workspace/download routing, visible server receipt, recovery
  continuity, ten desktop/mobile screenshots and a Russian clinician guide.
- Verified: 16 files/80 tests, clean lint/types/Drizzle/build, zero known
  dependency advisories, 29-table/108-row/12-migration isolated recovery, two
  authenticated workspace reads, one PDF response event, matching access head,
  1440/390 visual checks and no browser console warnings/errors.
- Limitation: all data and files are synthetic and local. Production identity,
  global denied-request/WORM audit, retention, real patients, audio/STT/AI,
  integrations, legal signature and deployment remain open.
- Stop point: checkpoint complete. No next roadmap item was selected; continue
  only after an explicit owner request.

### 2026-09-01 — exact interrupted-encounter recovery checkpoint

- Reason: reopening the application or losing a mutation response must never
  switch patients, invent a saved draft, or let a clinician act on stale state.
- Decision: treat only `in_progress` and `review` as resumable, reconstruct them
  from exact assigned current D1 heads/leaves, and require explicit confirmation
  before enabling clinical actions. A lost response is an unknown outcome until
  the exact server version is reconciled.
- Added: deterministic encounter ordering; atomic recovery revision; stable
  before/after workspace read; exact encounter URL; recovery confirmation panel;
  action lock; safe failed-switch behavior; exact conflict refresh; and truthful
  browser-draft/network-outcome messages.
- Verified: all seven lifecycle statuses; exact assigned state and current heads;
  revision change after a clinical head advances; identical reconstruction from
  a new repository instance; disabled-membership denial; 14 files/73 tests;
  clean lint, types, Drizzle, and production build; zero known dependency
  vulnerabilities; and isolated D1/R2 recovery of 27 tables, 105 rows, 11
  migrations, and three objects after source destruction.
- Limitation: browser-only drafts remain unrecoverable by design; no production
  failover/RPO/RTO, authenticated browser click-through, real data, STT/AI,
  external integration, or deployment is claimed.
- Stop point: checkpoint complete. No next roadmap item was started; continue only
  after an explicit owner request.

### 2026-09-02 — local speech and clinician-gated AI-draft checkpoint

- Reason: the clinician workspace needed a real local conversation path and a
  real provider adapter instead of synthetic recommendation fixtures, while
  preserving consent, exact-patient scope and human decision boundaries.
- Decision: keep speech loopback-only and raw-audio-free; separate speech consent
  from external-AI consent; acknowledge an exact final/corrected transcript before
  egress; persist every provider run before calling it; accept no AI content into
  the protocol without a later explicit clinician command.
- Added: migrations `0012`-`0014`; GigaAM/CAMPPlus sidecar and authenticated speech
  APIs; AudioWorklet/VAD capture; append-only transcription provenance; Groq
  `openai/gpt-oss-120b` structured provider; evidence and medication safety checks;
  pending suggestion/section generation; UI consent/snapshot gates; safe Windows
  setup/start/stop/config scripts; synthetic smoke test and guide screenshot 11.
- Verified: 20 files/97 tests; zero known dependency advisories; clean lint/types/
  Drizzle/Vinext build; actual local synthetic Russian transcription; authenticated
  browser recovery and consent state; 31-table/111-row/15-migration/three-object
  isolated recovery with matching hashes after source destruction.
- Limitation: no microphone permission or ambient audio was captured during agent
  verification; RU/KK clinical quality is not approved; a real Groq request awaits
  a fresh ignored secret; all patient records remain synthetic and local.
- Next: after a new key is configured, verify one synthetic external analysis run
  remains clinician-controlled, then return to clinic requirements/discovery before
  selecting the next integration module.

### 2026-09-02 — migrated working live consultation into ORION Clinic

- Reason: the owner clarified that the actual working legacy consultation product,
  not only its launcher, had to be available inside the new repository.
- Decision: preserve the legacy checkout and migrate the reviewed functional bundle
  as the `/live` compatibility module under the single ORION Clinic web process;
  reuse the already-adapted local speech service and copy no secrets or patient data.
- Added: live consultation UI, compatibility STT/Groq routes and clients, speaker
  display, consent, history/rename, optional recording, clinician decision basket,
  downloads, dark theme, main navigation link, migration manifest and screenshot 12.
- Verified: strict types and lint, 20 files/97 tests, Vinext build with every new
  route, clean launcher restart, HTTP 200, ready compatibility STT health and a
  browser pass through navigation, consent gating, history and theme with no
  console error on `/live`.
- Limitation: browser-local history/audio/export and automatic live analysis are
  retained only for parity and are not the authoritative server medical record.
  Real-patient use, clinical validation, production auth/retention and a fresh
  externally tested Groq key remain open.

### 2026-09-02 — unified shell and authentication stabilization

- Reason: the dashboard, patient registry and migrated live consultation had
  separate page-level chrome and looked like unrelated presentations instead of
  one clinician workspace.
- Decision: require Sites identity at the shared page boundary, keep authorization in
  the existing facility/patient/encounter repositories, and expose only the
  authenticated display name/email to one shared client shell.
- Added: one responsive shell for `/`, `/patients`, patient detail and `/live`;
  active navigation, sign-out, persisted theme/sidebar state, safe authentication
  return paths, common design tokens and screenshots 15-17. Compatibility speech
  and analysis routes no longer accept development-only anonymous access. The
  launcher safely recovers checkout-local stale Vinext locks and partial starts.
- Verified: final `pnpm verify:ci` passed secret/dependency gates, strict types,
  lint, 25 files/119 tests, Drizzle, production build and isolated recovery; the
  three principal authenticated routes rendered with one header, common font and
  no horizontal overflow or browser errors. Anonymous UI/API checks failed closed.
- Limitation: no production OIDC/MFA, real-patient authorization, deployment or
  clinical-release claim. A common shell does not replace D1 scope checks.
- Next: continue the existing bounded patient profile update/archive lifecycle.
  Phases 4-10 remain `NOT_STARTED`.

### 2026-09-03 — versioned patient update and non-destructive archive

- Reason: the D1 patient registry could create and open a record but had no safe
  operational lifecycle for correcting demographics or removing a record from the
  active worklist.
- Decision: keep identifiers and all historical versions immutable; express every
  edit or archive as an append-only command against an expected head version. Archive
  is a terminal visible state, never a physical delete, and merge remains deferred.
- Added: migration `0016`, database linear-head/no-update/no-delete guards, idempotent
  repository commands and audit events, explicit role permissions, PATCH/archive APIs,
  integrated edit/archive/conflict/history UI, directory status filters and guide
  screenshots 18-19.
- Verified: repository/domain/schema behavior, stale writes, exact replay, role denial,
  post-archive write blocking and an authenticated two-tab browser scenario using only
  artificial data. The final CI/recovery figures are recorded in the current-checkpoint
  verification ledger above.
- Limitation: this does not approve real data, production identity/role governance,
  encrypted identifier search or duplicate merge.
- Next: bind `/live` to the exact authorized D1 encounter and its server-owned consent,
  transcript, analysis and clinician-review state. Phases 4-10 remain `NOT_STARTED`.

### 2026-09-03 — exact D1 live workspace and responsive product audit

- Reason: the migrated consultation screen still carried browser-owned encounter
  selection and analysis behavior, while several responsive layouts could clip or
  obscure working controls.
- Decision: treat `/live` as a second interaction surface for the same exact D1
  encounter, never as a separate record; keep browser history/audio visibly local,
  require explicit clinician acknowledgement before AI generation, and fix only
  measured layout defects rather than redesigning stable pages.
- Added: authoritative live snapshot adapter, encounter-scoped speech and analysis
  calls, optimistic clinician decisions and corrections, inaccessible/lifecycle
  locking, desktop/mobile overflow fixes, sticky desktop recommendations and safe R2
  upload rollback.
- Verified: 26 test files/132 tests, lint, strict types, web/readiness/STT health,
  D1 quick/foreign-key checks and browser passes for the workday, registry, patient
  card and live screen at desktop/tablet/mobile widths. The full CI/recovery figures
  are recorded in the verification ledger after the final gate.
- Limitation: no browser microphone or real Groq request was used in this audit;
  RU/KK clinical quality and all production/integration decisions remain open.
- Next: build an approved synthetic RU/KK/MIXED speech quality harness. Phases 4-10
  remain `NOT_STARTED`.

### 2026-09-03 — verified private Git baseline

- Reason: the product needed a recoverable remote baseline that another engineer or
  agent can clone without relying on this laptop or rediscovering the implementation
  history.
- Decision: publish only the new ORION Clinic checkout to a private repository;
  preserve the legacy `ariaproject`, local D1/R2/runtime state, model cache and all
  ignored secrets outside Git.
- Added: private `shadowuneed/ORION-CLINIC` remote and repository-local verified
  GitHub noreply identity; global Git configuration was not changed.
- Verified baseline: commit `0f1bc95` contains all 243 policy-scanned source,
  migration, documentation and synthetic screenshot files. The final handoff commit
  records the remote and checkpoint after that baseline.

### 2026-09-04 — hardened provider-neutral orders and results checkpoint

- Reason: clinic leadership requires laboratory/ECG/service requests and specialist
  referrals to become an operational workflow rather than disabled navigation.
- Decision: implement the complete local human-controlled lifecycle in D1/R2 while
  refusing to simulate transmission, acknowledgement or availability from an
  unnamed external clinic system.
- Added: migrations `0017`-`0019`; immutable request/report versions and heads;
  result-file metadata, hash validation and durable R2 upload intents; clinician/
  assignment/consent authorization; exact command-time replay; separate doctor
  approval; review/reconciliation and completion gates; guarded expiry cleanup;
  scoped APIs; integrated `/orders`; runtime watcher hardening; user guide and
  screenshot 22.
- Verified: authenticated synthetic draft -> approval -> R2 result -> doctor review
  -> byte-identical download -> completion; 30 test files/172 tests; lint/types/
  Drizzle/production build; D1 `quick_check`; browser create-modal/theme/list/detail
  check; and isolated recovery across 44 tables/122 rows/20 migrations/three R2
  objects/215,011 bytes after disposable-source destruction. Independent audit
  bypasses for payload-changing review, terminal review, mutable replay context,
  R2 orphaning, audit contention and invalid UI transitions have behavioral tests.
- Limitation: the npm advisory endpoint timed out during the final aggregate command;
  all local gates and secret policy passed, but `pnpm verify:ci` is not claimed as a
  complete pass. No external KMIS/LIS/ECG adapter, production identity/data,
  structured vendor import or waveform interpretation is included.
- Next: after explicit owner approval, implement the first synthetic D1 Phase 5
  scheduling/queue slice. Finish Phase 4 external delivery only after
  DEC-001/002/005 are resolved.

### 2026-09-04 — local synthetic scheduling and queue checkpoint

- Reason: clinic leadership requires an approved referral to continue into a
  visible appointment flow and electronic queue without duplicate registrar entry.
- Decision: implement a complete human-controlled local D1 lifecycle while clearly
  labelling every available slot as manual test data and refusing to represent it as
  KMIS availability.
- Added: migration `0020`; immutable specialty/service/provider/schedule/slot,
  preference, appointment and queue histories; optimistic heads; DB and repository
  concurrency guards; exact idempotency; patient-confirmation fingerprint; scoped
  APIs; `/scheduling`; rerunnable explicit fixture; guide and two browser screenshots.
- Verified: preference -> hold -> confirmation -> ticket -> arrival -> call ->
  in-service -> completion; exact replay; payload-conflict rejection; concurrent
  hold with exactly one winner; cancellation releasing a slot and queue; role and
  cross-facility denial; local D1 migration/seed rerun; desktop browser lifecycle
  plus a 390 px mobile pass without horizontal overflow or console warnings/errors;
  34 test files/192 tests; lint, strict types, Drizzle and production build; secret
  policy across 294 files; dependency audit with no known vulnerabilities; and an
  isolated recovery across 58 tables/123 rows/21 migrations/three R2 objects/
  270,203 bytes after disposable-source destruction.
- Limitation: no real schedule/KMIS adapter, notifications, reschedule, waitlist,
  approved priority policy, trusted automatic hold-expiry worker or external
  reconciliation is included. Existing slots are synthetic and dated fixtures.
- Next: implement the first synthetic Phase 6 doctor-confirmed chronic-care
  enrollment and versioned care-plan slice; keep ERDB/PUZ/free-medication adapters
  blocked until the clinic identifies their exact systems and legal basis.

### 2026-09-05 — local synthetic chronic-care and staff-worklist checkpoint

- Reason: clinic leadership requires the endocrinologist's confirmed diagnosis to
  continue into a multi-month plan, reproducible follow-up cohort and an assigned
  nurse worklist without allowing AI or a nurse to make the clinical decision.
- Decision: implement the complete local D1 lifecycle from the current signed
  doctor protocol while keeping every external registry and messaging action
  visibly disconnected.
- Added: migration `0021`; immutable registry enrollment, signed-plan and task
  versions with guarded heads; deterministic facility-date cohorts; scoped APIs;
  `/care`; rerunnable explicit fixture; role-specific actions; Russian guide.
- Verified: doctor enrollment and plan signing, exact task-plan lineage, nurse
  response/escalation, doctor resolution, stale-plan rejection, revision cleanup,
  exact idempotent replay, cross-facility denial, D1 migration/seed rerun and
  browser desktop/mobile behavior with no warning/error console output. The final
  aggregate gate covered 313 files, 38 test files/208 tests and an isolated
  restore of 67 tables/124 rows/22 migrations/three R2 objects/316,415 bytes.
- Limitation: no real ERDB/PUZ/free-medication source, refill workflow, automatic
  notification, clinic-approved escalation SLA, production identity/data or legal
  electronic signature is included.
- Next: implement a provider-neutral synthetic Phase 7 outbox without contacting
  a real patient or messaging provider.

### 2026-09-05 — provider-neutral patient-communications checkpoint

- Reason: clinic operations require reminders and follow-up responses to derive
  from already confirmed appointments and doctor-signed plans, while each channel
  remains under the patient's explicit language-specific choice and every failed
  contact has a visible owner.
- Decision: implement the complete local D1 intent/outbox/manual-fallback lifecycle
  with a hard-disconnected local processing stub. Accept only exact system-generated
  synthetic destinations and never request or persist a real phone/account value.
- Added: migrations `0022`-`0024`; per-channel consent event/head records; versioned
  RU/KK `approved_test` templates; versioned policy and quiet hours; exact source,
  template-values and rendered-body lineage; immutable notification/outbox,
  attempt, manual-task and response records; scoped APIs; `/communications`;
  rerunnable fixture; responsive UI; Russian operator guide and three screenshots.
- Verified: exact/stale/replay authorization; cross-facility and role denial;
  latest-template/retirement behavior; scheduled/quiet-hour controls; provider-
  unavailable retry and manual assignment; opt-out suppression; SQL-level source,
  consent, destination, purpose, body, payload and response-link guards; D1
  migration/fixture rerun and browser desktop/mobile behavior without warning or
  error logs. The final aggregate CI/recovery counts are recorded in section 13.
- Limitation: there is no real provider adapter, business account, delivery receipt,
  incoming webhook, protected-link host, clinic-approved wording, production
  identity/data or automatic worker. `delivered` is a reserved domain state and is
  never produced by the disconnected local adapter.
- Next: implement only versioned synthetic Phase 8 observation capture and its
  access/provenance contract. Keep critical classification, hospital notification
  and transfer blocked until DEC-006/DEC-007 are resolved by clinic owners.

### 2026-09-05 — versioned synthetic patient-observation checkpoint

- Reason: clinic leadership requires pre-visit height/weight/ИМТ, blood pressure
  and temperature to become durable clinical-workspace data instead of a static
  presentation, while interpretation and escalation remain human-controlled.
- Decision: implement only facility-scoped capture and correction history in local
  synthetic D1. Derive BMI algorithmically from exact inputs and expose no risk
  class, alert, notification or transfer before clinic policy approval.
- Added: migration `0025`; immutable observation versions and guarded heads;
  scaled units and BMI invariant; active-patient/member triggers; clinician/nurse
  access; idempotent/optimistic APIs; `/observations`; rerunnable fixture; Russian
  guide and three screenshots.
- Verified: exact replay/conflict and nurse-ownership scenarios; direct SQL
  immutability; active D1 integrity and fixture rerun; authenticated create ->
  correct -> history browser journey; light/dark and 390 px behavior without
  horizontal overflow or warning/error logs; final 47-file/269-test aggregate gate
  and isolated recovery of 80 tables/128 rows/26 migrations/three R2 objects.
- Limitation: there is no clinic-approved criticality rule, rule owner, SLA,
  device feed, alert, receiving-facility acknowledgement, transfer packet or
  predictive digital twin. No production identity/data or medical validation is
  claimed.
- Next: prepare the Phase 8B `DEC-006`/`DEC-007` clinic decision packet. Do not
  activate critical classification or transfer behavior before written approval.

### 2026-09-05 — Phase 8B clinic decision-gate checkpoint

- Reason: critical-state thresholds, response times, transfer acknowledgement and
  the term “digital twin” are clinical/operational decisions that engineering and
  AI must not invent.
- Decision: create a complete review and sign-off artifact before implementing a
  policy registry, rule evaluator, alert or transfer workflow.
- Added: `phase-8b-clinic-decision-packet.ru.md` with one-page decisions,
  deterministic rule contract, proposed human-controlled state models, blank SLA
  and override tables, minimum signed packet, receiving-facility contract, RACI,
  acceptance gate and next-agent order; plus an activation-blocked JSON template.
- Verified: JSON parses; status is `draft_unapproved`; `activationBlocked` is true;
  the rule list is empty; no `DEC-007` meaning is preselected; all required packet
  sections exist; whitespace validation passes. Full `pnpm verify:ci` passed
  secret scanning for 363 files, dependency audit, lint/types, 47 test files/269
  tests, Drizzle/build and isolated recovery of 80 tables/128 rows/26 migrations,
  three R2 objects and 389,707 bytes (`runId`
  `61f532f5-5e40-425f-a31e-c91c6eb20d60`).
- Limitation: no clinic signatures, clinical thresholds, SLA values, production
  identity/data, external endpoint, runtime classification, alert, hospital
  notification, transfer or predictive model is approved or implemented.
- Next: named clinic owners fill and sign the packet. Only then may engineering
  implement the immutable signed-policy registry as a separate checkpoint.
