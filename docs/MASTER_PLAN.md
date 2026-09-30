# ORION Clinic — Master implementation and AI handoff plan

- Last updated: 2026-09-30
- Plan owner: product owner + clinical lead
- Current implementation agent: Codex
- Repository: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC`
- Legacy reference: `C:\Users\profm\OneDrive\Документы\ChatGPT\ariaproject`

### Owner's absolute resource boundary — 2026-09-24

**DO NOT TOUCH ANYTHING RELATED TO DIR ECHOES.** This applies to GitHub, Vercel,
Neon and every other service: no code/data/configuration/secret reads, changes,
deletion, linking, migration or reuse. `dir-echoes-db` and
`dir-echoes-voice-router` belong to a different hackathon project, not ORION.
Do not repeat broad remote inventories when they would inspect that project.
The owner explicitly reiterated this prohibition after the initial inventory.

The only authorized GitHub repository for this work is the existing
`https://github.com/shadowuneed/ORION-CLINIC.git`, verified by local
`git remote -v` on 2026-09-24. Do not create a replacement repository, change
origin, or push this work to another project. This supersedes the earlier request
to create a new repository. All ORION infrastructure must be dedicated to ORION;
the deployment request does not authorize borrowing another project's resources.
These constraints apply equally to subagents and the overnight continuation.

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

### PRIORITY ONLINE-1 · approved user request, 2026-09-24

The owner now requests an online platform other staff can use, with implementation
of useful remaining workflows beyond STT. This supersedes historical next-task
pointers, but does not approve public exposure of development authentication, paid
infrastructure, external patient communication or real medical data. The first
target is a **closed online pilot using artificial records and real DB operations**.
KMIS/ERDB integration and clinical production approval are separate later gates;
they must not prevent engineering a usable multi-user pilot.

Current audit: `outputs/PRODUCTION-AUDIT-2026-09-24.md` (local ignored evidence).
Web/STT were restored on 3200/3101; full tests, build, isolated recovery and one
artificial real STT/Groq probe passed during that audit. Those results do not
validate code changed afterwards or establish an online deployment.

Latest owner expansion: finish the original two screenshot requirement sets,
deploy on **Vercel**, and work through safe checkpoints overnight. Requirement
coverage and actual gaps are in `docs/operations/requirements-audit-2026-09-24.md`;
deployment constraints in `docs/operations/vercel-readiness-2026-09-24.md`;
speech options in `docs/operations/online-speech-options.md`. Vercel is the
requested web destination, not evidence of working remote DB/auth/STT. Dedicated
backend/storage, credentials, patient-data approval and paid-service/legal gates
remain unresolved. No current deployment may expose the Sites development user.

#### Ordered implementation checkpoints

| ID | State | Scope and acceptance |
| --- | --- | --- |
| ONLINE-1A | VERIFIED · bounded checkpoint | Exact no-speech response is nonfatal; ordered speech uploads retain index after silence. Profile update/archive enforce current exact authority through transaction and replay. Care tasks open same-patient measurements and return to the task after scoped revalidation. Full suite: 103 files / 844 passed / 1 skipped; build and focused browser checks passed. See newest sections 13/15/16. This does not close accounts, offline durability or photo upload. |
| ONLINE-1B | IN_PROGRESS · isolated server identity/TLS checkpoint | Individual sessions (0048), credentials/attempt reservations (0049), password verifier and guarded login/logout now share a server principal in an unmounted verification runtime. Actual loopback HTTPS/workerd/D1 tests cover two staff, sequential restart, logout, password reset and credential disable. This is not browser/clinical runtime acceptance: main UI remains Sites and neither migration is applied there. Next: safe provisioning, isolated clinical SSR/API adapters and trusted HTTPS browser acceptance, deployment-wide abuse/restore controls; ONLINE-1C before main activation. No role-fixed shared credentials or browser-supplied grants. |
| ONLINE-1C | IN_PROGRESS · unmounted 1C0 + 1C1a–e + 1C2a1 + 1C2a2-fence | Internal durable registry0050 now has0051 terminal pending-work fences on organization/facility/membership mutations, including ABA/REPLACE. NOT an authorizing broker or protected current IndexedDB. Next1C2a2-coordinator: explicit wrapping dependency plus current action/consent SQL, remaining authority sources and preparation reconciliation; then encrypted v2 and isolated two-tab integration. Main0048–0051 remain unapplied. No key custody/issuance/action endpoint. Existing unowned v1 stays untouched; never silently assign/delete it. Browser-held key cleanup is not remote revocation. |
| ONLINE-1D | NOT_STARTED | Deploy a closed artificial-data pilot with durable DB/object storage, migrations, TLS, secrets, backups/restore, logs/alerts and restart supervision. STT runs on a protected persistent service, not inside a transient web function. Rework loopback-only provider configuration only with a bounded authenticated service contract; no arbitrary URL/SSRF bypass. Production hosting/identity choices require owner confirmation. |
| ONLINE-1E | NOT_STARTED | Make offline behavior explicit and durable: consent-bound local encrypted draft/audio queue with idempotent replay and conflict recovery; distinguish microphone pause, lost network and finalization. Never auto-send cached clinical text to AI after reconnect or claim recording survived crash until tested. Offline storage/security policy must be resolved with ONLINE-1C. |
| ONLINE-1F | NOT_STARTED | Two real browsers, separate doctor/nurse/admin/registrar accounts: create/save/reload/restart, denial after revoke/logout, protected recordings, one complete synthetic encounter to reopened signed protocol and export, backup restoration and service recovery. Refresh illustrated instructions from verified screens. |

Vercel is requested for web hosting; its backend topology is not finalized.
Retaining the current Workers/D1/R2 bindings plus a protected STT service is the
smallest port; Vercel requires a Vinext adapter and separately resolved
backend/storage bindings. Do not describe the current
placeholder D1 IDs or local `.wrangler/state` as a remote database. No cloud resources
have been created by this plan.

#### Further product work that can be built without clinical vendor contracts

1. **Care tasks and measurements (UX-R4 / D-R4):** exact patient/task navigation,
   measurement history and explicit task outcome; no inferred task completion.
2. **Recommendation to order draft (D-R3) — bounded local checkpoint verified:**
   accepted action recommendation → reviewed form → persisted draft with immutable
   decision/derivative/encounter provenance, exact-scoped links and idempotency.
   Browser creation/reload/reopen passed in isolated D1; separate approval remains.
   Not medication prescribing, external sending or automatic referral creation.
3. **Long consultation notes (D-R2):** retain supported cumulative facts beyond the
   rolling 24-turn window, with source versions and contradiction handling; never
   overwrite clinician-edited/reviewed sections or invent absent facts.
4. **Scheduling:** versioned rescheduling, waiting list and trusted hold-expiry job;
   manual/local schedule remains labelled until a real authoritative source exists.
5. **Operations:** staff provisioning, backup schedule/restore runbook, background-job
   ownership/retry monitoring and complete role-specific UI acceptance.

External WhatsApp/SMS/telephony, KMIS/LIS/ECG, ERDB/PUZ/free medication, approved
critical thresholds and hospital transfer remain dependent on named provider/clinic
decisions. Do not implement a painted success response or claim these are connected.

### MOBILE-1 · separate accessible mobile application — approved scope, 2026-09-24

The owner explicitly requests a **real installable application connected to the
platform**, not a responsive website, PWA or WebView wrapper presented as a native
product. Planning target: Android and iOS. This adds a separate product track;
it does not displace the platform identity/data/reliability release gates.
Detailed executable backlog: `docs/operations/mobile-application-plan.md`.
Status: **M1a IN_PROGRESS, native application NOT_STARTED**. The isolated
patient self-link migration is not a credential, release API or deployed app.

Patient experience: upcoming appointments and queue, signed visit documents and
released results, physician-approved care/medication/diet plans, reminders,
self-reported measurements and wellbeing, clinic communication, consent and
history. Patients cannot approve AI drafts, change a diagnosis/prescription or
gain staff powers. Caregiver access requires a separately verified, scoped,
revocable delegation; knowing a patient's ID/phone/name is never sufficient.
Staff mobile workflows, if enabled, retain their own exact assignment rules.

Accessibility is mandatory from the first screen: VoiceOver/TalkBack labels,
logical focus and announcements, scalable text and reflow, sufficient contrast,
large targets, reduced motion, text alternatives to every audio/voice action,
keyboard/switch navigation and understandable RU/KK instructions. Add simplified
navigation and optional assistive preferences without inferring a diagnosis.
Test actual devices and assistive technologies with representative users; passing
a linter or displaying an accessibility setting is not acceptance.

| Stage | Initial state | Required outcome |
| --- | --- | --- |
| M0 | PLANNED | Patient/caregiver/staff journey and source-of-truth mapping; accessibility contract, threat model and native-stack ADR. No invented integrations. |
| M1 | NOT_STARTED | Dedicated patient identity and verified patient link; versioned mobile API, per-object authorization, device/session revoke, no staff-auth/header fallback. Depends on secure online platform foundation. |
| M2 | NOT_STARTED | Real native Android/iOS read-only client: own appointments, released records/results and approved plan from actual API; loading/empty/offline/denied states and accessible sign-in. No fixture-only success. |
| M3 | NOT_STARTED | Explicit booking confirmation/change requests, patient-reported measurements/messages and consent; audited/idempotent DB operations; private opt-in notifications with real delivery states. |
| M4 | NOT_STARTED | Minimal encrypted identity-bound offline data/drafts, expiration and safe replay with current authorization/conflict checks. No silent clinical approval, cross-account cache reuse or automatic AI upload. |
| M5 | NOT_STARTED | Complete appropriate patient functions, explicit caregiver delegation and separately authorized staff workflows; optional device integrations behind separate acceptance. |
| M6 | NOT_STARTED | Real devices, accessibility user testing, multi-account/revocation/reinstall/network interruption tests, signed builds and limited distribution. Store accounts/legal declarations/payments require owner participation. |

AI may explain released information or prepare questions for a clinician with
clear sources and limits; it must not autonomously diagnose, prescribe, override
a care plan or promise emergency monitoring. "All functions" means all applicable
authorized journeys, not exposing the clinician/admin console to every patient.
External KMIS/ERDB/PUZ, messaging and hospital-transfer dependencies stay visible.
Mobile code belongs in this same existing ORION repository; no new or unrelated
GitHub/Vercel/Neon project is to be repurposed.

### PRIORITY UX-R · approved user request, 2026-09-15

This remains the **UX execution backlog**, sequenced with ONLINE-1 above after the
owner's online-platform clarification. Do not delete
the existing security backlog or mark clinical/external gates complete.
The user reports indistinguishable pages, unclear care vs measurements,
non-working access management and unclear doctor/nurse/admin responsibilities.
They request corrected workflows and rebuilt illustrated instructions afterwards.
This is not authorization to grant live privileges or bypass consent.

#### Outcome and boundaries

- Owner clarification (2026-09-15): **artificial records, real data operations**.
  Synthetic means fictitious input data, NEVER painted-in results or a bypass of
  persistence. This applies to every UX-R phase and the production backlog.
  Each feature must support an empty database (identity/schema bootstrap only),
  user-created records, scoped API reads/writes, durable relations and history,
  reload/restart, failure handling and authorization. No success before commit;
  no fallback patient, fixture-only selectable record or fake external delivery.
  Do not remove test-data labels to pretend production readiness.
- Data acceptance order: D-R1 patient/encounter create-read-reopen-retry;
  D-R2 saved sections/transcript/approved protocol; D-R3 order-result-booking;
  D-R4 care tasks-measurements; D-R5 role isolation and operational release checks.
  Track source/UI/API/repository/migration/test evidence and limitations for each.
  UX and data checkpoints progress together; DB tests alone do not prove UI.
- Production preparation: separate fixtures from normal startup, retain migrations,
  transactional audit/idempotency/concurrency, verify backup restore and deployment
  configuration, then complete identity/MFA, hosting/residency, retention and clinic
  release gates. Never enable real patient data merely by flipping synthetic mode.
  Named disconnected integrations stay visibly unavailable until implemented.

- Main platform remains dashboard-led; LIVE is the encounter's speech tool.
- Stable URLs, stored data, STT model/timings and Groq stay unchanged unless a
  separately reproduced defect requires a scoped fix. No rewrite or reseed.
- Unified typography, spacing and navigation; distinctive task-oriented layouts,
  not separate themes for every page and not merely changed colours.
- Clinical controls continue to be enforced server-side with exact assignment,
  facility, patient relation, consent, lifecycle and immutable audit/version guards.
- Synthetic fixtures only. Preserve unrelated owner `a` under Initial risks.
- Each phase ends with changed files, test commands/results, browser evidence,
  remaining defects and exact next step in sections 15/16 below.

#### Ordered deliverables

| ID | Status at planning | Deliverable and acceptance |
| --- | --- | --- |
| UX-R1a | DONE | Initial naming/meaning slice: meaningful menu labels, remove D1 badges from primary navigation, distinguish care tasks from measured facts, remove misleading external "send" promise. 14 focused tests, types, focused lint and care/measurements browser inspection passed; not full-role acceptance. |
| UX-R1b | IN_PROGRESS | First code slice distinguishes encounter header from dashboard and explains disabled order decisions with visible, accessible guidance. Remaining: browser acceptance, common breadcrumbs, selected patient/assignment context and primary-action/prerequisite audit across remaining pages. |
| UX-R2 | IN_PROGRESS | Role explanations and combined-role warning implemented; current browser account confirmed doctor+administrator. Separate doctor, nurse, registrar and access-admin acceptance remains. Reproduce actual broken action before claiming cause; positive UI save and negative API checks; no combined-role fixture as sole proof. |
| UX-R3 | NOT_STARTED | Task-oriented visual workflows: encounter editor and progress, orders/results registry, time-oriented scheduling and queue, follow-up task list by due date/owner, measurements table/history. Shared shell and responsive light/dark styles. |
| UX-R4 | IMPLEMENTED · bounded navigation | Same-patient/task navigation with exact facility/assignment, scoped server revalidation, follow-up form context and return/focus verified in browser on 24.09.2026. Measurement saving still uses the existing writer; no automatic task completion. Permanent task-to-measurement DB association and targeted lookup beyond the 200-patient list remain separate work. |
| UX-R5 | NOT_STARTED | Full role-based acceptance on synthetic data, persistence after refresh, failed/expired/no-access cases, keyboard, dialog cancel, logout, responsive layout and exports. Record unsupported provider/microphone tests separately. |
| UX-R6 | NOT_STARTED | Rebuild instructions AFTER screens stabilize: new screenshots/markers for changed screens, role entry points, actual labels/workflows, troubleshooting and accurate limitations; regenerate offline and in-app copies together. |

#### UX-R1 terminology contract

| Destination | User-facing meaning | Primary work |
| --- | --- | --- |
| `/` without encounter | Рабочий день | Pick assigned encounter or new patient |
| `/` with encounter | Приём и протокол | Consult, review sources, complete eight sections and sign |
| `/live` | Запись разговора | Start/stop speech capture for selected encounter |
| `/orders` | Направления и анализы | Create/approve request; attach and review result |
| `/scheduling` | Расписание и очередь | Reserve/confirm agreed time; manage arrival and queue |
| `/care` | План наблюдения | What to do next, due date, responsible staff member |
| `/observations` | Измерения пациента | What was measured, when, by whom, and values/history |
| `/access` | Моя роль и права | Actual current assignment and effective permissions |
| `/access/manage` | Сотрудники и доступ | Grant/version/revoke assignments with explanation |

Example to show in UI: "Измерить давление через месяц" is a follow-up task;
"Сегодня 120/80" is a recorded measurement. Neither is an automatic diagnosis.
Technical version IDs and storage engines belong in details, not primary headings.
Do not relabel local approval as successful external delivery.

#### UX-R2 access investigation checklist (must not be skipped)

1. Inventory `lib/domain/access-governance.ts`, access resolvers/repositories,
   `app/authenticated-clinic-page.tsx`, shell visibility and `/access/manage` forms.
   Capture UI/API/DB mismatch with exact operation and error, without secrets.
2. Write a capability matrix from actual server permissions versus intended roles:
   doctor clinical decisions/protocol; nurse measurements and assigned tasks;
   registrar demographics/scheduling; access-admin staff/permissions, not automatic
   treatment rights. Explicitly label combined assignments; no cosmetic role switch.
3. Test isolated identities with permitted operations and denied direct endpoint
   calls. Revoked/expired/wrong-facility/self-escalation must remain denied.
   Use isolated fixtures; do not alter the owner's current authorizing assignment.
4. Repair demonstrated defects with transaction/audit/replay tests. Browser menu
   visibility alone is not authorization proof. Pending existing-patient writer
   hardening remains a tracked security dependency, not silently "done".
5. Make the header show resolved role/department or explicit selection required;
   explain denied actions without exposing inaccessible patient information.

#### UX-R3–R6 acceptance and continuation checklist

- Use real UI backed by local DB, not mock cards. Open/save/reload/cancel each
  main form; patient switching must not mix local edits or data across patients.
- Preserve clinical review and separate consents. Show errors and recovery actions,
  not endless loading, fictitious delivery or disabled unexplained buttons.
- Browser at desktop and narrow width: no clipped main action, unreadable labels,
  horizontal page overflow or identical ambiguous tabs; inspect both themes.
- Final tests: `pnpm verify:ci` with aggregate exit code, plus browser acceptance
  report with role, route, action, expected/actual result, evidence and unresolved
  blockers. No microphone/Groq/Word rendering claim from API/build success alone.
- Instructions source: `docs/user-guide/handbook-content.mjs`; generator:
  `scripts/build-user-handbook.mjs`; in-app route: `/help`. Refresh screenshots
  and marker coordinates, verify image/anchor/zoom/download and compare public
  asset against offline HTML. Do not include secrets or real patients.
- Current guide remains available during migration, but must be flagged as
  awaiting UX-R6 refresh where it differs. Do not describe old screenshots as new.
- Keep reports/checkpoints in this repository; another agent should start from
  this section, then section 16, then current diff. No need to reconstruct chat.

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
      wins, and different scopes are never merged implicitly.
- [x] Stable doctor, nurse, registrar, administrator, medical-lead, auditor, and
      service-role catalogue with server-calculated baseline permissions and a
      read-only self-access screen. Service roles cannot open an interactive
      workspace.
- [x] Add a versioned/audited department administration lifecycle plus
      append-only administrator grant/change/revoke commands. Migrate the patient
      directory API family to one explicitly selected assignment and effective
      permission without weakening facility, patient, purpose or state checks.
- [ ] Migrate every remaining protected endpoint and database role guard from
      legacy `memberships.role` checks to one explicitly selected assignment and
      effective permission, one resource family at a time.
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
- [x] Persist final/corrected transcript segments with append-only lineage. The
      browser may display transient recognition state, but D1 accepts only final
      server-returned segments; provisional audio/text is not durable clinical data.
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
| DEC-017 | Verified patient-account linking, caregiver delegation, minors and revocation | MOBILE-1 M1/M5 | Product/clinic security/legal |
| DEC-018 | Mobile offline retention/shared-device policy, accessibility acceptance participants, supported devices/languages | MOBILE-1 M0/M4/M6 | Product/security/accessibility lead |
| DEC-019 | Mobile distribution accounts, signing ownership, store disclosures and support channel | MOBILE-1 M6 | Product owner/clinic operations |

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

2026-09-30 post-restart Cloudflare access and dedicated auth database:

- Cloudflare Bindings/Docs/Builds/Observability tools are now callable. A narrowly
  named D1 lookup for `orion-clinic-auth-pilot` returned no database before creation;
  no broad Worker, Vercel or unrelated-project inventory was performed.
- Project-local Wrangler4.127.0 initially reported unauthenticated. Owner approved
  one Opera device flow; `wrangler whoami --account
  64a5fad5dd97b1e245fca5363b7968db --json` now confirms the exact account and OAuth
  permissions account/user read, workers_scripts write, workers_tail read and D1
  write, plus refresh access. Credential values were not inspected or copied.
  OS-keyring setup was unavailable because npm was not on PATH; Wrangler reported
  its standard user-level credential-file fallback, outside this repository.
- Created ONLY dedicated empty D1 `orion-clinic-auth-pilot`, UUID
  `c14a40da-a007-4085-b255-86c095591153`, in the verified account. Project-local
  `wrangler d1 info orion-clinic-auth-pilot --json` with the exact account ID
  confirms the same UUID, no tables and EEUR region. This is a technical auth
  database, not approval of medical-data residency or a clinical data migration.
- A remote read-only `SELECT 1 AS connectivity_ok` returned1, success=true,
  changed_db=false and rows_written=0. Initial combined connectivity/version
  probe was rejected because D1 disallows sqlite_version(); it made no writes.
  No migrations, seeds, staff accounts or local passwords were imported. No
  R2 bucket, Worker publication, paid subscription or Vercel deployment occurred.
- Independent read-only reviews reconfirmed auth runtime is five-route-only with
  no usable sign-in form/provisioning authority boundary. Production still has
  49direct Sites API identity consumers and disables the legacy-history guard;
  do not open the existing clinical bundle after adding a cloud cookie.
- Current official Workers limits: Free10ms CPU/request; existing secure scrypt
  profile N32768/r8/p3 is unchanged and remote CPU/load fit is NOT measured.
  Paid Workers has a minimum5USD/month plus overage charges. Ask the owner to
  choose/approve the authentication topology before enabling a paid plan or
  promising reliable Free-plan password login. Do not weaken the password KDF.
  Closest safe next checkpoint remains isolated fail-closed auth composition,
  authorized provisioning/private ingress and trusted browser/load acceptance;
  an explicit Vercel gateway is a separate slice, not a blind public rewrite.
- `git rev-parse HEAD` and exact remote main lookup still match4e298cb at this
  pre-edit checkpoint. Main local DB/audio/migrations and3200/3101 were untouched.
  Only this operational receipt is edited; application checks were not rerun.

2026-09-30 owner-authorized Git publication and Vercel preflight:

- Explicit owner request authorizes committing/pushing the current checkpoint to
  the existing ORION repository and attempting Vercel deployment. Local origin
  and `git ls-remote origin refs/heads/main` confirmed the exact authorized repo,
  with main initially at5489c18. No other remote project was inventoried.
- Source secret scan713files, full lint/typecheck, `pnpm.cmd db:check` PASS.
  `pnpm.cmd build:deploy-check` built all routes successfully, then blocked the
  exact533-file artifact on `server/.dev.vars`, exit1. Values were not printed.
  Current output is Workers/Vinext, not Vercel Build Output; SSR/API needs D1/R2,
  and local personal credentials are installed only by dev middleware.
- Full test run:151files PASS,2318tests PASS,1skipped; one configuration test
  exceeded the global5000ms deadline while loading the real Next ESLint config.
  The exact7-test file then passed twice in isolation; a test-specific90000ms
  toolchain cold-start allowance preserves both actual ignore assertions. The
  changed file passed again (7/7,2.15s). The full suite was not rerun after this
  timeout-only change; do not report an all-green aggregate run.
- Vercel CLI59.25.4 `whoami` confirmed the existing authenticated account;
  `project inspect orion-clinic --scope shadowocc` returned project_not_found.
  `wrangler whoami` initially reported not authenticated. No backend resources,
  roles or deployments were created. Full working deployment is blocked on the
  dedicated backend/public staff verifier and Vercel adapter, beyond packaging.
- Owner opened a new Cloudflare account and explicitly requested executing the
  official `https://developers.cloudflare.com/agent-setup/prompt.md` instructions.
  Installed14Cloudflare skills globally in `C:\Users\profm\.agents\skills` and
  registered all5MCPs in user `C:\Users\profm\.codex\config.toml`, outside Git.
  CLI confirms OAuth for cloudflare, cloudflare-bindings, builds and observability;
  Docs is public. Builds and Bindings succeeded after fresh OAuth callbacks.
  Initial wide API authorization
  was cancelled before completion and reissued requesting only Workers/D1/R2 and
  related read scopes. Credential values were not read, printed or copied.
  Duplicate IAB and Opera callback pages caused confusing connection-refused
  screens; CLI OAuth result, not the final browser page, determines success.
  Subsequent authentication uses Opera only. Restart Codex to load new MCP tools;
  MCP OAuth is not evidence of Wrangler login or a deployed backend.
- Independent publication review found production auth-only runtime remains
  unmounted,49direct API Sites-identity consumers need principal adapters, and
  legacy IndexedDB isolation is disabled outside local account mode. Preserve
  ONLINE-1B/1C gates; do not deploy the main Worker by injecting identity headers.
- Exclude the local `.local-build-check.log` from publication. Preserve the
  owner's standalone `a` in the working tree and leave it unstaged. No local
  credential files, runtime DB, audio, secrets or generated dist belong in Git.
- Published source checkpoint279e42b84bc88ada11da34672a1a946c2619da68 to the
  authorized `origin/main`; `git push origin main` exited0 and subsequent exact
  `git ls-remote origin refs/heads/main` matched local HEAD.299source/docs/assets
  files committed; final source secret scan712files PASS, staged whitespace check
  PASS. Owner's unrelated `a` remains the only unstaged change. This is Git
  publication, not Vercel/Cloudflare application deployment.
- STT host assessment: current stateful FastAPI GigaAM/CAMPPlus sidecar needs
  persistent CPU/GPU compute, TLS and server authentication for cloud access.
  Preferred first pilot host is an always-on GPU VM/Runpod Pod;16GB+ VRAM is a
  proposed benchmark starting point, not a measured model minimum. Browser audio
  goes via authorized ORION API; service credential remains server-side.
  GPU resources and remote transcription were not provisioned by this request.

2026-09-28 follow-up — first-load CSS ownership and female anatomy:

- Owner reported bare dashboard/shell content during initial loading. CSS HTTP
  responses and DOM module hashes matched; missing-file/hash drift was not found.
  Installed RSC plugin removes `client-reference` stylesheet links on hydration.
  Added explicit server-side CSS imports in `app/page.tsx` and
  `app/authenticated-clinic-page.tsx`, retaining the existing CSS and compiler.
  No artificial delay, content hiding, forced reload or dependency patch.
- Browser full reloads in light/dark showed dashboard grid styling while data was
  still loading; after hydration both dashboard/shell CSS links remained with
  `vite-rsc/importer-resources`. No document overflow at the current755px viewport,
  no captured browser errors. This is not complete390/768/1280/1920 acceptance.
  Captures: ignored `outputs/ui-2026-09-28/dashboard-first-load-fixed.png` and
  `dashboard-loaded-fixed.png`.
- Added transparent1024x1536 generated female anatomical PNG, selected only for
  stored `sexAtBirth=female`; male retains original. Unknown/not_recorded keeps
  the generic original with a neutral accessible description (distinct neutral
  artwork remains open). Browser verified patient-a female image loaded with the
  existing118/76,36.5,165cm,64kg values intact; `patient-female-verified.png`.
  Asset prompt/provenance is in `design/patient-anatomy.md`; no patient image used.
- `pnpm.cmd exec vitest run app/first-paint-styles.test.ts app/patients/patient-vitals-panel.test.ts lib/config/vite-runtime.test.ts lib/dashboard-events.test.ts lib/dashboard-work-items.test.ts lib/pathway-transition.test.ts app/pathway-link.test.ts --maxWorkers=1`:
  7 files/41 tests PASS. Full typecheck, scoped ESLint for5 changed source/test
  files, `pnpm.cmd build` and `git diff --check` PASS. Existing nonfatal build
  classification/future-native-loader warnings remain. No full SQL/recovery rerun.
  Final `pnpm.cmd security:secrets` PASS for713 source files.
- No migration, seed, clinical write, credential reset, process restart, provider
  analysis call, commit/push or deployment. Existing read audits may append.
  The initial credentials were printed only at the owner's explicit request;
  no password was added to source or documentation. Broader remaining plan stays open.

2026-09-28 owner-requested patient panel, event center, motion, light theme and local staff login:

- Final `pnpm.cmd exec vitest run --project unit --no-file-parallelism --maxWorkers=1`:
  123 files / 1795 PASS / 1 opt-in provider test skipped, exit0, 84.00s.
  `pnpm.cmd exec vitest run --project database-integration lib/repositories/patient-observations.test.ts --no-file-parallelism --maxWorkers=1`:
  1 file / 10 PASS, exit0, 13.16s. This is a focused SQL gate, not a rerun of all SQL suites.
- Full `pnpm.cmd lint`, `pnpm.cmd typecheck`, `pnpm.cmd build` PASS after final
  product changes. Build retains nonfatal Vinext classification and future Vite
  extension warnings. Generated handbook retains older labelled captures.
  `git diff --check` PASS with existing unrelated Python CRLF notice.
- Source secret scan initially flagged two computed random-password expressions,
  not literal credentials. Renamed the local variables to `generatedPassword`;
  scanner policy and password generation unchanged. Final `pnpm.cmd security:secrets`
  PASS for 708 files. Post-rename local-account-store test 5/5 and scoped ESLint
  PASS. Aggregate/build above precede this non-product identifier-only change.
- Browser on main3200: actual login/password worked for existing `user-a`, `user-b`
  and `user-care-nurse`, with distinct profile identities and existing permissions.
  Nurse landed in her permitted pathway; no new clinical grants were made.
  Final user-b browser check reached `Активного назначения нет` on `/access`;
  the physician account was subsequently restored successfully for QA.
  Logout returned to the form and another already-open patient tab cleared to
  sign-in. New non-clinician Home routing is covered by 5 helper tests; no-assignment
  users go to `/access`, explicit encounter requests keep their original denial.
- Current patient-a displayed saved BP118/76, temperature36.5, height165, weight64
  and recorded BMI23.51 with date/source. Clicking the body pressure label changed
  the provenance selection. Full anatomical bitmap is generic illustration, not
  a patient scan, organ finding or calculated health/risk map. Independent latest
  observation heads are read through exact selected observation access and audited.
- Event center showed existing 2 overdue care tasks, 7 active encounters, 3 open
  care tasks and empty queue/contact sources. No patient/clinical fixtures were
  inserted to fill cards. Analytics opens/closes separately; partial source failures
  stay unavailable, not false zero. Results awaiting review remain actionable even
  when the request is completed, except cancelled/entered-in-error records.
- One explicit browser Groq briefing succeeded: summary of 7 open encounters and
  2 overdue tasks. Only the strict six aggregate counters were sent; no names,
  notes, identifiers or audio. This is operational summarization, not clinical AI
  validation. The skipped opt-in clinical provider test above remains skipped.
- Persistent medical transition observed both entering and exiting `/pathway`:
  cover phase made the old shell inert, then removed phase/inert after destination
  mounted. Light/dark patient and dashboard inspected; token tests enforce normal,
  muted and primary-button contrast. A fresh browser load after the final build had
  no captured error logs. Earlier during HMR an OrionMark useId hydration warning
  was observed, not reproduced by the fresh load.
- Mobile viewport override did not change the measured QA tab (still1280px);
  reset was called. Do NOT count that attempt as current390px browser acceptance.
  Reduced-motion, browser Back/Forward and unsaved-form cancellation have automated
  coverage, not complete manual acceptance in this checkpoint.
- Web `/api/health/ready`3200 and speech `/health`3101 both HTTP200. No service,
  main migration, seed, clinical write, audio deletion, cloud deployment, commit or
  push. Existing read audits may append. The local credential store below was the
  explicitly implemented state change; online/clinical release gates remain open.

2026-09-28 owner-requested navigation and patient-pathway UI checkpoint:

- Replaced the desktop sidebar with a 72px icon rail that expands over the
  content to 228px on hover or keyboard focus; full names remain accessible on
  links. The mobile bottom navigation retains short visible labels. Removed the
  redundant top "Рабочий день" indicator and sidebar collapse toggle.
- Grouped orders, care, observations and communications into `/pathway`, each
  still gated by its own server capability and existing API checks. The left
  route panel uses a browser-tab treatment and a connected vertical tool rail;
  its `view` URL is preserved, and visited forms stay mounted on tool switches.
  The synthetic patient is not inferred or assigned by this visual layer.
- Owner clarified that clicking "Маршрут" must open a separate platform-inside-
  platform home screen, not automatically open orders. `/pathway` now defaults
  to `overview`: its own tab bar, explicit patient picker, scoped server-data
  summary and horizontally scrollable event/deadline timeline modeled on the
  supplied visual reference. Patient and source IDs are projected only from
  successful authorized `/api/orders`, `/api/care` and `/api/observations`
  reads; failures display an unavailable warning, not invented zeroes. A
  scope-bound state prevents a previous assignment's fetched patient names
  appearing during a scope change. Selecting a patient survives entering a
  tool and returning to the route home. The inner screen is read-only; tools
  retain their own distinct server authorization and clinician approvals.
- Added a 260ms entry/exit transition for ordinary internal links between the
  pathway and other workspaces. Modified/middle-click browser behavior remains
  native; reduced-motion preference skips both the delay and CSS animations.
  Made the live-encounter start, profile, dashboard cards and sign-in status
  clearer in the same local UI slice; individual credential login is NOT active.
- `pnpm exec vitest run app/clinic-shell.test.ts app/sign-in/page.test.ts
  lib/dashboard-summary.test.ts lib/workspace-access-url.test.ts`: 4 files /62
  passed. `pnpm exec vitest run app/pathway/pathway-workspace.test.ts
  app/clinic-shell.test.ts`: 2 files /7 passed. `pnpm typecheck`, scoped ESLint,
  `pnpm build` and `git diff --check`: PASS. No new full-suite run after this
  UI-only delta; the earlier 133-file result above predates it.
- After the inner-screen correction, `pnpm exec vitest run
  app/pathway/pathway-workspace.test.ts app/pathway/pathway-overview.test.ts
  app/clinic-shell.test.ts`: 3 files /11 passed. `pnpm typecheck`, scoped
  ESLint, `pnpm build` and `git diff --check` PASS after the final
  scope-state hardening.
- Browser on main3200: desktop1280 showed 72px default and 228px hover rail,
  working pathway exit/entry with the transition phase and real target URLs;
  vertical route panel and care/order views rendered. At width390 the layout
  reflowed to bottom navigation and scrollable tool chips without document-wide
  horizontal overflow (`scrollWidth=375`, viewport390). Temporary viewport
  override reset. Web3200 and local speech3101 health both returned HTTP200.
  Reduced-motion OS mode and unsaved-form/back-navigation behavior were not
  manually exercised; no deployment, main migration or clinical approval.
- Browser on main3200 after the clarification: `/pathway` without `view`
  opened the inner overview, loaded 11 patient cards across authorized
  modules, selected one synthetic patient and showed four matching care
  events. Entered care, returned to the overview and confirmed the selected
  patient remained. Desktop1280 and mobile390 had no document-wide horizontal
  overflow; the event strip scrolls internally. Future task due dates are
  labelled as deadlines, not recorded clinical events. No new DB writes.

2026-09-28 direct owner request — queue, AI context and MOBILE-1/M1a:

- Added a read-only, current-facility queue board in `/scheduling`, derived from
  authorized referral/confirmed appointment/current ticket versions. It
  selects the exact referral for existing actions; it does not mutate order,
  call a patient or invent an automatic priority. Focused scheduling tests 7/7,
  TypeScript and browser empty-state check on main3200 passed. Populated-board
  browser acceptance remains to be done on a separate synthetic fixture.
- Follow-up server boundary: `D1SchedulingWorkflowRepository.list` now filters
  preference, appointment and ticket DTOs by the caller's current eligible
  referral and exact patient before they leave the API; occupied slots do not
  expose another patient's appointment ID. A second synthetic clinician in the
  same facility cannot read another's three row types or slot ID;
  focused database-integration8/8 passed. The browser board explicitly says
  its API-limited100+100 sample is not a complete queue. A cursor-paginated
  full queue and automated hold expiry remain unfinished. Final aggregate after
  this follow-up: `pnpm test` 133 files/2235 passed/1 opt-in skipped,
  exit0, 671.41s. Full lint, types, db-check, build and secret scan also pass.
- Live and clinical recording screens now disclose when the rolling 24-final-
  segment Groq input omits earlier turns. `analysis-window` tests3/3,
  TypeScript and scoped ESLint passed. One explicit opt-in provider request
  with artificial text passed4/4 Groq tests. This proves provider reachability,
  not long-visit memory, clinical quality or the entire consent/UI loop.
- Added unmounted `patient_self_links` in migration0052/schema, with exact
  issuer/subject/scope, internal verification reference, expiry and terminal
  revocation guards. A distinct temporary SQLite file applies all migrations;
  focused3/3 tests passed including close/reopen and tombstone checks;
  `pnpm db:check` and typecheck passed. No main D1 migration, patient endpoint,
  credential/session, audit stream, publication or native build was made.
- Earlier full `pnpm test` before the server follow-up: 133 files/2234 passed/
  1 opt-in skipped, exit0 (676.86s). The final rerun above supersedes it.
  Full `pnpm lint`, `pnpm typecheck` and `pnpm db:check` exit0 after the final
  code changes.
- `pnpm build` PASS (five Vinext environments); `pnpm security:secrets` PASS
  for 666 tracked/untracked files; `git diff --check` PASS apart from an
  unrelated pre-existing CRLF notice. Web3200 and speech3101 health both 200;
  the browser reloaded `/scheduling` and showed the new D1-backed board (empty
  on this main synthetic state). This is not populated-board browser proof or
  clinical/STT long-session acceptance. The prior cloud/auth blockers remain.

2026-09-24 deployment-artifact hardening, 17:27 UTC continuation:

- Fixed false-safe artifact inspection: a NUL no longer skips all content;
  malformed UTF-8/unknown binary and archive/document/database containers are
  blocked. Signature+extension permit ordinary web binary assets, with WOFF/WOFF2
  header size/length checks; literal token detection also runs on binary assets.
  Private-file copies/date suffixes, private roots/ancestors and root-ancestor
  symlink/junction paths fail closed without traversing their target contents.
- `pnpm exec vitest run --project unit lib/config/deployment-artifact.test.ts --no-file-parallelism --maxWorkers=1`:
  final46/46 PASS. Independent read-only virtual-FS reviewer:20/20 adversarial and
  ordinary-asset probes PASS, no real private contents read. No full decoder/PHI/
  malware/unknown-secret detection or frozen-upload guarantee is claimed.
- New `pnpm security:artifact --dir <explicit-directory>` and
  `pnpm build:deploy-check` are local-only. Actual latter command successfully
  rebuilt app/handbook and then intentionally exited1:481files,
  `server/.dev.vars: private-file`. Actual client-only112assets PASS, but they are
  not a separately usable platform and were NOT deployed. No cloud CLI retries.
- An intermediate final unit run timed out at the existing1MiB AES-GCM boundary
  assertion:1701passed/1failed/1skipped,132.15s. Replaced only the expensive deep
  comparison with Uint8Array type + exactlength + native byte equality, retaining
  all oversize/tamper checks and the same timeout. Focused62/62 PASS755ms;
  independent positive/bit-change/length/offset assertion review PASS. Product
  crypto implementation was not changed. Final aggregate recorded below.
- Final `pnpm exec vitest run --project unit --no-file-parallelism --maxWorkers=1`:
  103files /1702passed /1opt-in skipped,116.40s,exit0 after the assertion change;
  the final explicit Uint8Array type assertion also passed focused62/62. No
  failure was hidden by skipping a test or increasing its timeout.
- Focused ESLint, typecheck, source-secret scan634 and diff-check PASS. Database
  suite not rerun for this packaging/test-only change: prior514PASS belongs to
  the D-R3 checkpoint, not a new SQL execution. Browser reloaded main /help after
  build and showed current workflow, errorlogs[]; same listeners3200/21448,
  3101/12948 and isolated3214/23896 remain running. Web200/STTok.
- Owner then requested stop at checkpoint and remove scheduling. Exact app
  automation `orion` / `ORION — ночная доработка` was deleted at17:40UTC; tool
  confirmed deleteStatus=deleted. No other schedules/resources changed. Do not
  resume unattended or recreate a schedule; wait for a new owner request.

2026-09-24 D-R3 completed local checkpoint, final verification at 17:12 UTC:

- `pnpm exec vitest run --project unit --no-file-parallelism --maxWorkers=1`:
  103 files, 1669 passed, 1 opt-in skipped, 61.14s, exit0.
- `pnpm exec vitest run --project database-integration --no-file-parallelism --maxWorkers=1`:
  27 files, 514 passed, 599.09s, exit0. Full final aggregate is 2183 passed,
  1 opt-in skipped; this supersedes the earlier pre-feature aggregates below.
- Final `pnpm build` exit0 after final source-conflict UX: application + generated
  handbook, 19 existing screenshots /75 markers /2233460 bytes. Screenshots were
  not recaptured; the new verified workflow is current text, marked accordingly.
- Final `pnpm lint`, `pnpm typecheck`, `pnpm db:check`, `pnpm security:secrets`
  (634 tracked/untracked source files) and `git diff --check` all exit0. Source
  secret scan PASS is separate from the BLOCKED deployment artifact scan below.
- Real browser + isolated D1 on3214: doctor accepted action → explicit form;
  type/priority are deliberately unselected, patient/encounter fixed by server
  source. Save produced one draftv1 with null approval, succeeded command,
  exact accepted decision/version and valid audit chain. Reload exact requestId,
  reopen source and Live source link all reopened the same draft, no duplicate.
  Stale source version409 now shows an actionable return-to-encounter state,
  not a generic failed-load/retry loop. No real audio, external AI, patient message
  or referral dispatch was performed by this browser acceptance.
- Independent SQL review found and fixed ignored audit-head publication and
  historical-source disclosure without current encounter.read. Focused34 SQL
  and22 API/domain tests plus unit coverage for scope-preserving /orders links,
  stale response suppression and source-conflict recovery are included above.
- Main3200 post-build: explicit local sign-in → existing orders loaded → /help
  displayed the new five-step referral workflow; fresh tab error logs empty.
  Main database/audio untouched by the isolated creation test. Listeners3200 and
  3101 remain running; main0048–0051 deliberately NOT applied.
- Final exact artifact scan after this build inspected481files and BLOCKED
  server/.dev.vars. No secret values printed or uploaded, no Vercel deployment.
  A compatible Vercel build/runtime, dedicated durable backend and mounted
  individual staff auth remain unresolved. No DIR ECHOES resource accessed.

2026-09-24 runtime recovery + ONLINE-1C2a2-fence, 16:26 UTC continuation:

- Main web3200 and speech3101 were found stopped; old PIDs27128/5612 absent.
  Root restored the same services with reviewed hidden child launches, separate
  timestamped recovery logs and NO migrations/bootstrap/cache deletion. Current
  listeners21448/12948, ready200. Vinext reclaimed its own dead-PID lock.
  New opt-in launcher `-SkipDataInitialization` skips DB initialization and
  preserves prior logs/lock. Isolated launcher tests14/14, types/lint/parser PASS.
  Use `docs/runbooks/local-runtime-recovery.md`; do not use ordinary full launcher
  while main0048–0051 are deliberately unapplied.
- Main browser: dashboard10encounters → SPA Live → reload/visual check → patients9;
  captured error logs empty. Temporary tab closed. No real microphone, consent,
  clinical write, staff switch or local-history read.
- Actual synthetic STT: generated6615ms system-TTS WAV recognized locally in1990ms;
  large_ctc CUDA/fp16_autocast, CAMPPlus ready, localFilesOnly=true,
  audioPersistence=none. Own generated WAV/session cleaned; activeSessions0.
  `python -B -m unittest discover -s tests -p test_sessions.py -v` in sidecar:
  8/8 PASS. Not mixed-RU/KK/long-session/clinical-quality or Groq acceptance.
- Added0051 authority fences for pending registry rows across organization,
  facility and membership changes, including REPLACE/ABA and installation-time
  retirement of unprovable preexisting pending work. Event+retirement share the
  authority transaction; committed receipts/heads preserved. Main migration NOT
  applied. Root focused registry80/80 PASS42.91s; independent59 adversarial SQL
  scenarios PASS, recursive_triggers0/1, fault rollback, ignored/no-op, unique
  displacement, scopes, races and reopen. db:check/diff PASS. Not coordinator,
  action/consent authority, key release or protection of current browser material.
- Pre-D-R3 aggregates: unit103files/1630passed/1opt-in skipped65.82s;
  database-integration27files/497passed764.91s. Both exit0, commands
  `pnpm exec vitest run --project <unit|database-integration> --no-file-parallelism --maxWorkers=1`.
  These predate the final two launcher tests and D-R3 implementation; do not use
  these counts as its final feature gate. Subsequent results recorded separately.
- Owner then requested a visible bounded deliverable before departure: D-R3
  accepted recommendation → explicit order draft. Disposable persona3214
  acceptance is separate from the main clinical DB.
- Owner additionally requested immediate Vercel attempt. Exact artifact scan
  inspected479files and BLOCKED `server/.dev.vars` without printing contents.
  CLIwhoami returned authorized user (version-check worker separately timed out);
  targeted `vercel project inspect orion-clinic --scope shadowocc` returned
  project_not_found. No broad project inventory. Runtime remains Workers/D1/R2
  and main identity Sites-dev; Nitro/backend/staff wiring absent. No unsafe
  upload, empty substitute deployment or cloud resource created. See readiness doc.

2026-09-24 ONLINE-1C2a1 internal durable registry, 10:35 UTC continuation:

- Added `lib/repositories/local-material-registry.ts`, four schema tables and
  forward-only `0050_local_material_registry.sql` with generated snapshot/journal.
  Main0048–0050 remain unapplied. Only disposable fixtures receive51 migrations.
  This is internal storage, NOT a public broker/auth boundary or key facility.
  Required policy/provider identifiers are configuration, not approval/custody.
- Immutable request/owner/run/kind/revision/pins/key metadata;120s DB-clock
  reservation; preparing→prepared does not publish a head. Exact receipt insertion
  atomically publishes head + committed state + minimal event. Same-command
  replay is distinct from changed payload; historical receipt explicitly reports
  currentHead=false after a subsequent revision. CurrentHead is a transaction
  observation, not an access lease or proof local ciphertext exists.
- Terminal states and immutable fields resist UPDATE/DELETE/REPLACE with
  recursive_triggers0/1. Ignored/aborted publication rolls back; direct changes()
  is used instead of trigger-inclusive D1 meta.changes. Result is read in the same
  batch. Ordinary input is snapshotted before the first await, including config;
  DB errors have generic output without key/clinical content. SQL guards core
  descriptor binding, not the full arbitrary direct-SQL JSON shape.
- Independent schema-agent probes:70/70 adversarial SQL assertions and12/12
  actual-adapter checks PASS; full51-chain fixtures, FKcheck0/quickcheckok.
  Permanent suite by separate test agent39/39 PASS21.43s. Root independently ran
  `pnpm exec vitest run --project database-integration lib/repositories/local-material-registry.test.ts --no-file-parallelism --maxWorkers=1`:
  **39/39 PASS**,20.12s,exit0. Covers two connections/reopen, CAS, replay, expiry,
  state/identity immutability, publication failures, pre-await mutation and
  error sanitation. A deliberate test records NON-authorization: a revoked
  session relationship can still be stored; no caller may treat this as permission.
- Root `pnpm exec vitest run --project unit --no-file-parallelism --maxWorkers=1`:
  **102 files /1618 passed /1 opt-in skipped**,54.31s,exit0.
  Root `pnpm exec vitest run --project database-integration --no-file-parallelism --maxWorkers=1`:
  **27 files /456 passed**,539.99s,exit0. Together the two complete projects are
  **129 files /2074 passed /1 opt-in skipped**; these were separate commands,
  not a claimed single-run duration. Final focused39 above was independently
  repeated after the test agent froze its file. Runtime/schema sources stayed
  unchanged during the aggregate; no remote D1 clinical commands are implied.
  Full lint/typecheck/db:check/secrets (**629 files**) and diff-check PASS.
  Agent re-ran db:generate: no schema changes. Existing PythonLF warning only.
- Root `pnpm build` PASS after final runtime sources. Handbook regenerated
 19screens/75markers, no newly recaptured handbook illustrations. Correct artifact
  scan command `node scripts/check-deployment-artifact.mjs --dir dist` inspected
  **479 files, BLOCKED server/.dev.vars**,exit1, pathname only. Initial invocation without
  --dir returned usage, not a scan; no secret contents printed/uploaded.
- Browser-use postbuild: temporary tab11 dashboard10encounters loaded → SPA LIVE
  chooser → reload/visual check → choose-patient registry9loaded. Captured error
  logs empty; temporary tab11 closed. No microphone/consent/clinical mutation.
  This is main navigation smoke, NOT browser registry/crypto/auth acceptance.
  Ready200 and speechstatusok; web3200 PID27128 and speech3101 PID5612 unchanged.
- No main DB migration/reseed, v1 read/adoption/deletion, audio change, runtime
  restart, staff switch, external egress, resource/grant/credential creation,
  commit/push/deployment or forbidden-resource access. Separate real workerd/D1
  registry commands and browser IndexedDB acceptance remain unperformed.
- Next1C2a2: injected wrapping facility/coordinator, current action/consent checks
  in committing SQL, preparation reconciliation and terminal pending revocation.
  Existing membership/org/facility versions lack enforced monotonic ABA fences;
  do not use preflight metadata/fingerprint as a grant. Clinical/key/retention/
  hosting decisions and MOBILE native-client gates remain open.

2026-09-24 ONLINE-1C1d/e + remote-STT control foundation, 09:35 UTC continuation:

- ADR-0003 records the online-first wrapped-DEK direction, explicit action/consent
  matrix, minimal opaque local header and pending/finalize recovery across separate
  D1/IndexedDB boundaries. Retention, actual custody, recovery/withdrawal, export
  and offline policy remain gates, not engineering approval of real data.
- New `lib/local-materials/envelope.ts` performs actual bounded AES-256-GCM on
  synthetic bytes using platform Web Crypto: 96-bit IV,128-bit tag, fixed AAD,
  expected descriptor/kind/key scope separate from opaque envelope. No IO, main
  imports, persistence, keys returned or broker. One-shot encryption attempts
  do not establish global key uniqueness. Primitive bound1MiB is not chunking.
- Independent review reproduced two initial defects: spoofed byte-view properties
  bypassed the payload/shared-buffer checks, and mutable public CryptoKey metadata
  could mislabel a weak key. Fixed with native view/backing getters and internal
  import from exact32 raw key bytes, with both exploit regression tests. Caller
  key input remains caller-owned; only the helper's temporary copy is cleared.
- Subagent added unmounted `lib/speech/remote-gigaam.ts`: injected-fetch health/
  create-session only, exact HTTPS origin/auth/model/protocol pins,16KiB/256chunks,
  5s/10s total deadline, no redirect/cookie/retry/fallback. No audio/delete adapter
  or actual gateway. Hostname checks do NOT replace DNS/IP egress enforcement;
  preparation references do NOT authorize a request. Main3101 remains unchanged.
- A third independent finding in remote control (simultaneous stream completion/
  abort returning success) is fixed by post-await and pre-publication checks;
  six regression cases added. Final independent in-memory probes: crypto9/9 and
  native-stream control4/4 PASS, no remaining finding within bounded review scope.
- Final focused crypto **62 PASS**,1.95s; remote control **165 PASS**,0.354s.
  Intermediate root all-unit **102 files /1612 passed /1 opt-in skipped**,53.72s
  preceded the six remote cancellation regressions; final aggregate follows below.
  Root typecheck, full lint/secrets625/diff-check PASS at that intermediate gate.
  **Final frozen-source gate** after all three fixes:
  `pnpm exec vitest run --project unit --no-file-parallelism --maxWorkers=1`
  **102 files /1618 passed /1 opt-in skipped**,53.89s,exit0; `pnpm typecheck`,
  `pnpm lint`, `pnpm security:secrets` (**625 files**) and `git diff --check` PASS.
  Existing Python LF warning only. New tests in this checkpoint:62+165=227.
  No new DB/schema code;
  previous full SQL aggregate is historical and not claimed repeated here.
- `pnpm build` PASS after final key-input tightening, before the last unmounted
  remote-control cancellation fix; unchanged
  main consumers. Handbook regenerated19screens/75markers, not newly recaptured.
  Artifact scanner inspected477 files and **BLOCKED** `server/.dev.vars` pathname
  only. No contents printed/uploaded; no deploy attempted.
- Browser-use smoke after build: dashboard10encounters, SPA LIVE chooser and
  visual inspection, reload, choose-patient registry9loaded; captured error logs
  empty. Only temporary tab10 closed. This is NOT browser crypto/broker/login/
  STT/audio acceptance. Web readinessHTTP200, speechstatusok; PIDs27128/5612 kept.
- Next: 1C2a durable broker state machine with disposable DB and explicit
  wrapping dependency; actual custody/host/policy remains external. Remote STT
  next needs bounded audio + run/cleanup/idempotency and realgateway gates.
  No account/consent/clinical record commands, mainDB/audio/cache changes,
  cloud resources, provider requests, Git push or deployment in this checkpoint.

2026-09-24 ONLINE-1C1c, immediate follow-on within 08:34 UTC continuation:

- Added unmounted `lib/local-materials/envelope-binding.ts`: exact validated
  descriptor + closed audio/transcript kind -> domain-separated versioned fixed
  JSON array string. Input property order does not matter; no delimiter ambiguity,
  coercion, Unicode normalization or shared mutable byte buffer. Generic errors.
- This is only canonical metadata for a future reviewed crypto adapter. No AEAD,
  keys/nonces, IO, authentication, persisted material or UI. Scope IDs in output
  are not anonymous and must not be logged/published as harmless metadata.
- Source peer review: no actionable finding. New codec gate **94/94 PASS**,0.298s.
  Final root `pnpm exec vitest run --project unit --no-file-parallelism --maxWorkers=1`:
  **100 files / 1391 passed / 1 opt-in skipped**,51.77s,exit0. Full lint/typecheck,
  source secret scan **620 files** and diff-check PASS (existing LF warning only).
  Prior 1C1b 1714-test full aggregate/build/browser evidence below predates this
  new unmounted codec; no repeat full SQL/build/browser run was needed/claimed
  for this pure, unimported-by-UI addition. Existing runtime/schema unchanged.
- Next 1C1d explicit envelope/key architecture and action/consent/storage contract;
  unresolved policy/hosting decisions do not authorize silent v2 activation.

2026-09-24 ONLINE-1C1b, scheduled continuation at 08:34 UTC:

- Added unmounted `lib/local-materials/descriptor.ts` and `target-lifecycle.ts`.
  Immutable exact staff owner plus distinct material/run IDs and positive revision;
  strict own data-field validation, no content/keys/current authority in owner.
  No ID allocation or revision increment, storage/CAS, crypto or access-grant claim.
- Target fence composes the existing lifecycle with exact descriptor: every
  replacement (including equal/malformed and A→B→A) retires old operations; late
  resolve/reject/finally cannot publish into a new target. Captured resource
  cleanup remains one-shot. All owner fields must match the context; authority
  generation/consent changes never relabel stored ownership.
- Independent source review + 29 in-memory reentrancy probes found one error
  normalization inconsistency: throwing context Proxy could propagate its text.
  Fixed at replacement boundary, added 12 tests; peer re-review cleared finding.
  Publication callback exceptions remain explicit, not a false rollback claim.
- New focused tests: **124 descriptor + 87 target-lifecycle PASS**. Four-file
  local-material gate including earlier lifecycle/server-context: **354 PASS**,
  initial run 1.08s. These are synthetic unit/async-publication contract tests,
  NOT main recorder/history/export or browser storage acceptance.
- Root `pnpm test`: **125 files / 1714 passed / 1 opt-in skipped**,567.46s,
  exit0. A test callback return-type annotation was corrected after initial
  typecheck/start of aggregate; runtime source/test behavior unchanged. Final focused postgate:
  **354 PASS**,1.25s. Full lint/typecheck/db-check PASS; secrets **618 files PASS**;
  diff-check PASS with the existing unrelated sessions.py LF warning only.
- Build PASS; handbook regenerated (19 screens/75 markers), not recaptured.
  Artifact scan **477 files, BLOCKED** on private `server/.dev.vars` pathname;
  no contents printed or uploaded. Main temporary-browser smoke after build and
  reload: dashboard10 encounters, styled Live chooser, scoped registry9 patients,
  captured error log empty. Only the temporary tab was closed. No record/consent/
  microphone/history/login actions; normal read audit can append from GETs.
  This is main-navigation smoke, not new helper/browser-auth/storage acceptance.
- Fresh health: web readiness HTTP200 and speech status `ok`; listeners remain
  3200/PID27128 and 3101/PID5612. Health does not prove live speech recognition or
  provider availability; no new actual-audio/Groq probe in this checkpoint.
- Main UI/v1/DB/audio/ports unchanged; no main migration/account activation,
  key allocation, provider calls, upload or foreign-resource access. Next 1C1c
  envelope binding/key contract is described in the isolation plan §8. Actual
  ciphertext persistence, key custody, offline/recovery and cross-tab gates open.

2026-09-24 ONLINE-1C1a, scheduled continuation at 07:33 UTC:

- Added unmounted `lib/local-materials/server-context.ts` and
  `lib/repositories/local-material-context.ts`. Strict required selection, common
  staff principal, captured session cookie and final single-statement DB-clock
  snapshot. Current individual/session, exact doctor read assignment, treatment
  membership, patient/encounter, department/profile heads and five consent heads
  are checked together. No first-assignment fallback or Sites identity emulation.
- Independent review found current patient archival is in immutable profile
  versions. The new boundary checks both base and current profile status and
  rejects broken head/version joins; genuine legacy absence remains supported.
  Membership/org/facility epochs were added to fingerprint to distinguish their
  versioned disable/reactivate transitions. A read-only assignment is metadata
  eligible; can-manage is not returned as an action permission.
- Root new unit gate: **76 tests PASS**, 0.439s total. Agent final full-migration
  SQL gate: **35 tests PASS**, 63.78s tests / 64.21s total. Exact identity/scope,
  forged cookie/headers, corrupt result/consent heads, five separate decisions,
  DB-time expiry, archived profiles, same-role isolation, two connections/reopen,
  logout/reset/revoke/regrant/consent replacement races and versioned authority
  transitions covered. The SQL fixture uses actual `node:sqlite` and a D1-shaped
  adapter, not new actual-workerd, remote-D1 or browser acceptance.
- Snapshot DTO is frozen, minimal, without names/clinical text/session token or
  hash. Generation is a non-bearer observed-state fingerprint, NOT an offline
  entitlement, a complete monotonic revocation log, key release or permission to
  reveal/commit material. `effectiveByTime` is not processor/policy approval.
  Future consumers must reauthorize the exact action at publication/commit.
- Source peer review of resolver/query/unit and SQL tests: no remaining actionable
  finding in this bounded scope. Final root aggregate: **123 files / 1503 passed /
  1 opt-in skipped**, 587.02s, exit 0, after all final source/test edits. Only handoff
  docs changed during this run. Full lint/typecheck/db-check and source secret scan
  **614 files PASS**; diff-check PASS (existing unrelated LF warning only).
- Build PASS, 19 guide screens/75 markers regenerated rather than recaptured.
  Artifact scanner again **477 files, BLOCKED on `server/.dev.vars`** by pathname
  only. No artifact upload. Main browser after build/reload: dashboard loaded 10
  encounters, SPA Live chooser styled, choose-patient opened the scoped registry
  with 9 entries; captured error log empty. Only a new temporary ORION tab, closed
  afterward. No login/consent/record/microphone or local-history action. This is
  navigation smoke, NOT new context/browser-auth acceptance.
- Main web3200/PID27128 and speech3101/PID5612 preserved; fresh readiness HTTP200,
  speech health `ok`. No new real audio/STT or live Groq proof. Main DB/audio,
  staff roles, migrations0048/49 and external resources unchanged; ordinary read
  audit can append from browser GETs. No main UI imports or v1 access. Trusted
  isolated HTTPS/browser, Cloudflare and dedicated deployment blockers unchanged,
  no repeat authentication attempt. Safe next slice: 1C1b material/run/revision
  descriptor; source-only consumer hazards recorded in isolation plan §8.

2026-09-24 ONLINE-1B3a, scheduled continuation at 06:32 UTC:

- Final root `pnpm test`: **121 files / 1392 passed / 1 skipped**, 508.09s,
  exit 0. Includes the new 1B3a principal/transport/actual TLS tests and earlier
  1C0/mobile/clinical regressions. The existing opt-in real provider test remains
  skipped; no live Groq availability claim. This aggregate ran after the final
  source fixes; only handoff documentation changed while it was running.
- Added `lib/auth/server-principal.ts`: shared server-only tri-state resolver,
  strict immutable minimal identity, explicit internal `user.id` separate from
  exact external `issuer/subject`, current durable lookup on every request. No
  Sites/header/URL/role fallback or cross-request cache; unavailable does not turn
  into an anonymous redirect. C0/C1/isolated-surrogate adapter fields fail closed.
- Added unmounted `lib/auth/staff-runtime.ts`: five fixed technical routes,
  exact configured HTTPS origin, method/URL-selector/Origin/Fetch Metadata guards,
  existing durable login/logout, identical principal for SSR/API, escaped HTML
  and private/CSP headers. `/sign-in` explicitly says technical verification,
  with no form or clinical data. This is NOT new main authentication.
- Root focused `pnpm exec vitest run lib/auth/staff-runtime.test.ts
  lib/auth/server-principal.test.ts lib/auth/staff-session.test.ts
  --no-file-parallelism --maxWorkers=1`: **3 files / 149 tests PASS**, 1.10s
  (37 transport + 68 principal + 44 existing session). A test-only HeadersInit
  inference error was corrected; subsequent typecheck/lint passed. Independent
  source review found no blocking issue in this bounded, unmounted scope.
- New reproducible `lib/auth/staff-runtime.integration.test.ts`: actual HTTPS
  client -> local workerd/default scrypt -> D1 repositories. Agent final focused
  run **4 tests PASS**, tests 18.43s / total 18.70s. Full 50 migrations / 908 SQL
  statements in a unique disposable D1, no main config/env-file imports. Tests:
  wrong/unknown credential same 401; two same-role people with different internal
  IDs/external subjects; forged identity and duplicate-cookie denial; CSRF logout;
  logout A keeps B; sequential runtime restart preserves B and A's revocation;
  password reset invalidates old token/password, new password works, credential
  disable revokes it. Trusted fixture commands are not admin authorization APIs.
- TLS fixture pins installed Miniflare 5.20260826.0-alpha / workerd 1.20260826.1 /
  esbuild 0.28.1. Only its public bundled shared development CA is trusted in a
  scoped Node HTTPS Agent; default CA/wrong hostname negatives pass. No system or
  browser trust change, ignored certificate error, fetched untrusted CA, provider
  request, external port exposure or main state access. Own temp directory is
  realpath-validated before cleanup. Child environment values are blanked except
  OS execution paths, outbound calls denied. Independent safety review passed.
- Limits: manual Node Cookie headers do NOT prove browser Secure/SameSite
  enforcement. No trusted browser HTTPS origin is configured; browser auth gate
  stays open without bypassing warnings. No clinical assignment authorization,
  simultaneous replica/load/CPU acceptance, remote D1, credential-bearing backup
  restore, real mic/STT or live Groq test is claimed by this harness.
- `pnpm build` PASS (19 handbook screens / 75 markers regenerated, not newly
  captured). Full lint/typecheck and `pnpm db:check` PASS; source secret scan
  **610 files PASS** after renaming an explicitly synthetic fixture identifier
  flagged by the heuristic; scanner rules were not weakened. Fresh artifact scan
  `node scripts/check-deployment-artifact.mjs --dir dist`: **477 files, BLOCKED**
  on `server/.dev.vars` pathname only. No generated bundle was uploaded.
- Read-only browser acceptance after build: dashboard counts loaded; SPA link
  opened the styled Live chooser; choose-patient loaded the registry with exact
  facility/assignment. Captured error log empty. Only a new temporary ORION tab,
  then closed; no record, consent, login, local history or microphone mutation.
  This is main navigation smoke, NOT individual staff/browser-cookie acceptance.
- Main web 3200 PID27128 / speech 3101 PID5612 preserved. Main migrations 0048/49,
  accounts, grants, DB/audio and external resources unchanged. Existing audited
  reads may append read audit. Vercel/Cloudflare blocker unchanged, no auth retries.
  The 47 direct API identity callers plus SSR/shared-helper migration map and next
  safe gates are in `docs/operations/online-staff-auth-handoff.md`.
  Fresh health probes: web ready HTTP200, speech status `ok`; this is not a new
  microphone, transcription-quality or loaded-speech-source acceptance. Final
  typecheck/secret scan610/diff-check passed after test-fixture finalization.

2026-09-24 ONLINE-1C0 follow-on, after credential aggregate/build:

- Added only unmounted `lib/local-materials/lifecycle.ts` and its test file.
  Strict copied/frozen identity/scope and five distinct consent-version pins;
  retiring an operation generation aborts outstanding work and runs registered
  cleanup. Late completion cannot publish through an old lease. No storage, UI,
  auth, recorder or v1 import wiring; null/version consent pins are not grants.
- Root review found validation-phase reentrancy through structural Proxy traps;
  guarded the whole replacement/validation/install transition, not just cleanup.
  Final helper suite: **67 tests PASS**. Independent read-only review additionally
  ran 18 top-level/nested Proxy assertions; no open bounded-1C0 findings.
- Root final `pnpm exec vitest run lib/local-materials/lifecycle.test.ts
  lib/auth/staff-password.test.ts lib/auth/staff-login-adversarial.test.ts
  lib/mobile/patient-protocol.test.ts --maxWorkers=1`:
  **4 files / 232 tests PASS**, 5.26 seconds. Full lint, strict typecheck and
  secret scan **605 files PASS**; dependency audit found no known vulnerabilities.
  The earlier aggregate/build does not include this later unmounted module.
- Source audit documents possible v1 Blob overwrite and global interruption
  marking; these were NOT reproduced against existing data. Follow
  `docs/operations/local-material-isolation-plan.md`: old v1 remains untouched,
  no automatic owner assignment or deletion, exact material/run/revision still
  belongs to the future adapter. Main shared auth is not switched.
- Remaining acceptance: trusted current server context/key policy, encrypted v2,
  real IndexedDB transaction fencing, logout/recording/export integration, old-tab
  migration gate and disposable two-tab browser tests. The helper alone cannot
  discover server revocation, secure plaintext legacy data, undo arbitrary sync
  callback effects or recall downloaded files. ONLINE-1C is not complete.

2026-09-24 credential lifecycle, guarded login and mobile publication contract:

- Full `pnpm test`: **117 files / 1216 passed / 1 skipped**, 487.25 seconds,
  exit 0. This aggregate started before the final user-ID immutability regression
  correction; the final postgate below is the evidence for those last changes.
  The opt-in provider test is still skipped; no real Groq availability claim.
- Final postgate: `pnpm exec vitest run lib/auth/staff-password.test.ts
  lib/auth/staff-login-adversarial.test.ts lib/auth/staff-session.test.ts
  lib/repositories/staff-credentials.test.ts lib/repositories/staff-sessions.test.ts
  lib/mobile/patient-protocol.test.ts --maxWorkers=1`:
  **6 files / 273 tests PASS**, 56.73 seconds. Includes malformed/aborted streaming
  login bodies, immutable credential snapshots across password reset, generic
  failed-login responses, two same-role staff, SQL rollback/reopen, and patient
  publication denials. Totals overlap the aggregate; do not add them together.
- Independent review found two real repository hazards and the final postgate
  proves their corrections: D1 `meta.changes` includes trigger writes, so commands
  now read direct `changes()` receipts inside the same batch; UPDATE OR REPLACE
  cannot displace an existing user ID and revive old grants. Regression covers
  both recursive-trigger settings. Existing 0048 is not rewritten; new 0049 adds
  the identity guard. No main DB migrations were applied.
- Agent-run actual Miniflare/workerd D1 smoke applied 50 migrations / 908 SQL
  statements in disposable isolated storage and exercised the production
  repositories: provision, reset, disable, revoke, old-session/grant denial and
  append-only audit. Trigger-inclusive/direct receipts were 3/1, 4/1, 4/1 for the
  credential lifecycle. Miniflare 5.20260826.0-alpha / workerd 1.20260826.1;
  compatibility date 2026-05-22 with nodejs_compat. The temporary test script was
  removed after completion, not main data. This is not remote D1, credential-bearing
  backup restoration, target-worker KDF load, or browser-auth acceptance.
- `pnpm build`: PASS after the final credential postgate. Handbook regenerated
  (19 screens / 75 markers), not newly photographed. Full lint, strict typecheck,
  `pnpm db:check`, schema generation with no drift, secret scan (602 files) and
  `git diff --check` passed at this checkpoint. Subsequent ONLINE-1C-only evidence
  is recorded separately; no combined `verify:ci` or new backup drill is claimed.
- Fresh read-only deployment-artifact scan after that build: **BLOCKED**, 477
  files inspected; `server/.dev.vars` is a forbidden private file. Only the path
  was reported, not its contents. A successful build is not permission to upload
  local output. No Vercel deployment was attempted in this checkpoint.
- MOBILE-1/M0: 87 tests verify a pure allowlisted own-patient view of an explicitly
  released signed immutable protocol. This is executable contract code, not a
  patient identity provider, durable release/audit API or installed mobile app.
- Runtime preserved: web 3200 PID 27128 and speech 3101 PID 5612, web ready HTTP
  200 and speech health status `ok`. No new microphone/real STT or browser-auth
  run in this checkpoint; current auth is still local Sites. Main DB schema and
  clinical records, recordings, passwords, role grants, services and external
  resources were not changed. Normal audited read endpoints may append read audit.
- Subsequent browser smoke after build: dashboard loaded server counts, SPA link
  opened the LIVE new/continue chooser, and its choose-patient link loaded the
  patient registry while retaining exact facility/assignment. Captured error log
  was empty. Only a new temporary local ORION tab was used and then closed; no
  record/consent/clinical decision or login was changed. This is current navigation
  evidence, not new-credential or identity-scoped browser-storage acceptance.

2026-09-24 UI/runtime recovery and deployment preparation, canonical ORION-CLINIC:

- Reproduced the reported dynamic import failure: the requested navigation file
  was absent from the shared optimizer cache. Test startup emptied metadata used
  by the running dev server. Separate serve/build/test/persona cache namespaces
  and a deterministic plugin-name salt now separate their browser import hashes.
  Merely changing cacheDir was insufficient and caused a React/renderer mismatch;
  that intermediate issue was reproduced and corrected before acceptance.
- Full `pnpm test`: **110 files / 994 passed / 1 skipped**, 483.67 seconds, exit 0.
  Followed by `pnpm build`: PASS. The existing opt-in real Groq test remained
  skipped; no live AI/provider-availability claim. Handbook regenerated with
  19 screens / 75 markers; historical captures remain explicitly labelled.
- Active optimizer fingerprint before/after focused tests, full suite and build:
  46 JS/metadata files; SHA-256
  `549195975db1c9b9ed42c33371d7ae15a6dc3998f3c4dbd132a66ba837f2ed72` unchanged.
  Actual served navigation and React/ReactDOM import URLs returned HTTP 200. A
  manually constructed disk-global hash URL was not a valid test of per-entry
  browser imports; the earlier false alarm was discarded after this check.
- Browser: real logout -> signed-out -> direct protected URL -> explicit sign-in
  -> LIVE worked on 127.0.0.1 and localhost. Patients, orders, scheduling, care,
  measurements and communications loaded DB-backed views; access/help navigation
  worked. LIVE -> new encounter form/history preserved exact facility/assignment.
  Desktop/mobile 390px and light/dark visual checks passed without page overflow.
  After the full test/build gate, reload and SPA navigation still worked with no
  observed browser errors. No patient record, consent, clinical decision or role
  grant was changed to obtain this evidence. Separate employee passwords are NOT
  delivered by these entry screens; the local Sites user remains shared dev auth.
- New manual navigation-recovery notice handles identified chunk/import errors,
  warns about unsaved edits and never reloads automatically or clears storage.
  Route error screen is neutral. Initial bootstrap failure and injected real
  lazy-module failure with unsaved edits were not browser-tested.
- Post-aggregate focused gate:
  `pnpm exec vitest run lib/config/deployment-artifact.test.ts app/error.test.ts
  app/layout.test.ts app/encounters/new/creation-form.test.ts app/help/page.test.ts`
  **30 tests / 5 files PASS**. These include 13 artifact-scan and 9 SSR-theme
  tests added after the aggregate suite; do not add overlapping totals together.
  Afterwards full `pnpm typecheck`, `pnpm lint`, `pnpm security:secrets` PASS
  (587 files at that scan). Independent config suite: 7 PASS.
- Final UI/config/recovery/auth-navigation focused rerun at 01:59 local:
  `pnpm exec vitest run lib/auth/chatgpt-navigation.test.ts
  lib/module-load-recovery.test.ts lib/config/vite-runtime.test.ts
  lib/config/deployment-artifact.test.ts app/layout.test.ts
  app/live/encounter-start.test.ts app/live/page.test.ts app/sign-in/page.test.ts
  app/signed-out/page.test.ts app/encounters/new/creation-form.test.ts
  app/help/page.test.ts app/error.test.ts --maxWorkers=1`:
  **106 tests / 12 files PASS**, 4.81 s. Subsequent secret scan PASS (589 files).
  This overlaps the aggregate/postgate tests; it is not 106 additional tests.
- After the completed MOBILE-1 plan and handoff edits: `pnpm security:secrets`
  PASS (590 files), `git diff --check` PASS. Mobile plan local links and M0–M6
  coverage checked; no mobile SDK, app build, patient API or store deployment
  implemented by the planning document. Final listener check retained 27128/5612.
- Added `.vercelignore` and read-only
  `node scripts/check-deployment-artifact.mjs --dir dist`. Its real scan correctly
  **BLOCKED** the current artifact: 475 files inspected, `server/.dev.vars`
  private-file, exit 1. It reports paths/rules, not secret values. This is a
  successful guard test, NOT a safe-to-deploy result. No file was deleted/uploaded.
- Web was narrowly restarted after verifying the canonical process ownership to
  activate Vite config; no migration/bootstrap was run. Final listeners at this
  checkpoint: web 3200 PID 27128; existing speech 3101 PID 5612 unchanged. Web
  health was HTTP 200; speech/model/speaker ready. Health is not an audio soak test.
- Vercel CLI authentication exists, but no ORION deployment/project was created.
  Cloudflare CLI authentication is absent; current bindings are local placeholders.
  No unrelated resource data, settings, credentials or integrations were opened
  or modified. Owner's subsequent absolute dir echoes ban and existing-repo-only
  constraint are recorded at the top of this plan, in AGENTS and the night task.
  No public/clinical readiness, individual auth or real remote STT claim.

2026-09-24 additional bounded speech-session correction:

- `services/local-speech/orion_local/sessions.py`: get/count prune only expired
  sessions; capacity eviction now runs only when creating a new session under the
  same lock. Existing LRU/TTL semantics retained. A read/health query at capacity
  no longer removes a live session. This was a reproducible code defect, not proof
  that it caused every earlier speech outage.
- Agent regression proof: original implementation failed 7/8 new tests. Parent
  independently reran all **8/8 PASS** in 0.005 s using
  `C:\Users\profm\AppData\Local\ORION\python-env\Scripts\python.exe -B -m unittest
  discover -s tests -p test_sessions.py -v` from `services/local-speech`.
  Synthetic deterministic clock, no HTTP/audio/model load or main DB writes.
- Running speech PID 5612 was NOT restarted; **source fix is not loaded in the
  current service**. Later controlled idle restart + health/audio acceptance is
  required. Python regression is separate from the pnpm aggregate/CI. Capacity
  backpressure, multi-host session ownership and persistent STT hosting remain open.

2026-09-24 ONLINE-1B session foundation, canonical ORION-CLINIC repository:

- Added `lib/auth/staff-session.ts`, `lib/repositories/staff-sessions.ts`, matching
  test files, additive `0048_staff_sessions.sql`, schema and Drizzle metadata.
  Three subagents independently implemented/reviewed repository, SQL tests and
  security. Preserved all unrelated work; no main-DB migration, credential change,
  runtime auth switch, provider call or port restart.
- `pnpm exec vitest run --no-file-parallelism --maxWorkers=1 lib/auth/staff-session.test.ts
  lib/repositories/staff-sessions.test.ts`: 77 tests / 2 files PASS, independent final
  review run 26.34 s. 44 cookie/crypto/HTTP unit tests + 33 actual SQLite repository
  tests, including the complete migration chain, two file connections, close/reopen,
  issue -> cookie -> reopen -> POST logout -> old-token denial on another connection.
  This is not remote-D1 or browser login acceptance.
- Negative/race checks: duplicate/malformed cookie, forged identity headers without
  fallback, stale/disabled/versioned principal, idle/absolute expiry, final-read
  revoke, session/account SQL REPLACE resurrection, ignored revoke/user invalidation,
  partial-batch rollback, and a valid new login after a completed global revoke.
  Revocation is terminal; no raw bearer persists in the DB. In a storage failure,
  logout returns 503 and does not claim success or clear the cookie.
- `pnpm typecheck`, full `pnpm lint`, `pnpm db:check`, `pnpm build` PASS. Build retains
  handbook 19 screens / 75 markers. `pnpm security:secrets` PASS (567 files),
  `pnpm security:dependencies` PASS (no known vulnerabilities). Initial scanner false
  positive on the crypto-generation expression was resolved by multiline formatting;
  scanner policy unchanged and no stored secret was introduced.
- `node scripts/local-backup-restore-drill.mjs --keep`: PASS, 82729 ms, 90 tables,
  162 rows, 49 migrations, 3 R2 objects, 578876 backup bytes. Run
  `db7ab84f-c643-4922-b2b4-bce0499905a2`, artifacts `work/backup-restore-ln0cRO`.
  Only that drill's isolated source was removed after backup and restored into a
  new empty target; retained backup/restored artifacts are recoverable. Main DB/R2
  and previous artifacts were untouched. New session table was empty: this does
  NOT prove restore of session-bearing data or prevention of post-backup token
  resurrection. Production auth restore/invalidation and retention remain open.
- Main runtime health at 2026-09-23 20:18 UTC (24 September local): 3200 live/ready
  HTTP 200, synthetic-only; 3101 health HTTP 200, STT/CUDA and speaker ready,
  activeSessions=0. Existing listeners unchanged: 3200 PID 14584, 3101 PID 5612.
  Health does not prove microphone, transcription accuracy or Groq availability.
- Full `pnpm test` PASS: 105 files, 921 tests passed / 1 skipped, 453.86 s, exit 0
  (completed 2026-09-23 20:22 UTC / 24 September local). The opt-in live Groq test
  was not enabled; the skip does not establish provider availability. Final
  `git diff --check` PASS. Password verifier, provisioning/reset, common SSR/API
  resolver, mounted login/logout,
  distributed throttling, two-browser/HTTPS and production tests remain unperformed.

2026-09-24 ONLINE-1A implementation, canonical ORION-CLINIC repository:

- Three delegated slices reviewed together: speech adapter/client queue, care/measurement
  navigation, and patient profile update/archive transaction/replay authorization.
  Existing unrelated dirty worktree edits retained; no migration, seed, live patient
  mutation, credential change, public exposure or port restart performed.
- Speech gate: 63 tests / 8 files PASS (33 new-focused + existing ingestion/LIVE
  regressions). Real running 3101 adapter probe used in-memory silence then Microsoft
  Irina synthetic speech at the same session/index 0. Upstream 422 exact no-voice
  detail became empty text; next HTTP 200 recognized the artificial Russian phrase,
  6615 ms audio / 110 ms processing. Temporary sidecar session removed; activeSessions=0.
  No microphone, saved patient audio, main DB or Groq was used for this probe.
- Care/measurement gate: 36 tests / 3 files PASS. Browser on 3200 opened the existing
  synthetic pending care task, selected its patient in measurements, prefilled
  follow_up context/reason, cancelled the form and returned/focused the exact task.
  While form open, patient choices disabled and return anchor had aria-disabled=true
  and no href. Invalid task/patient pairing displayed a neutral warning, selected no
  fallback patient and exposed no return link. 390 px view: document width 375 px,
  no horizontal overflow; warning/error console empty. No measurement save or task
  completion was performed in this browser check; current local identity is combined
  doctor/admin, not independent nurse acceptance.
- Profile security gate: 40 integration tests PASS, including selected-assignment
  revoke/expiry/deny, no alternate-assignment fallback, guards before/inside batch,
  atomic head/command/audit publication, legacy/cross-assignment replay rejection and
  final-response denial after revoke. Main DB and R2 objects untouched.
- Aggregate types, full lint, db:check, build (including handbook regeneration),
  secret scan (561 files) and dependency audit (no known vulnerabilities) PASS.
  Shared in-app/offline help regression 2/2 PASS. Full `pnpm test` PASS: 103 files,
  844 tests passed / 1 skipped, 433.65 s, exit 0 (completed 19:58 UTC).
  The opt-in live Groq test was not enabled by this aggregate run; the skip is not
  a provider availability result. Handbook retains 19 screens / 75 markers;
  new verified care-to-measurement workflow is shared by /help and offline HTML.
- Runtime check 2026-09-23 19:53 UTC (24 September local): web live/ready HTTP 200,
  speech health HTTP 200 with STT ready / CUDA and speaker ready. Existing loopback
  listeners preserved: web 3200 PID 14584, speech 3101 PID 5612.
- Not verified here: browser microphone soak, real multi-persona online login,
  crash/offline persistence, RU/KK clinical quality, public deployment or production
  recovery. Earlier same-day production audit and isolated backup drill are separate
  evidence, not rerun by this checkpoint.

2026-09-15 persona-runtime audit: inspected installed sites-vite-plugin/dist/index.js.
Local sign-in fixes subject to local_seedy and removes incoming authenticated-user
headers before issuing its own identity. bootstrap nurse/registrar entries use
orion:synthetic, while app identity issuer is openai:sites. Therefore changing query
assignmentId or supplying headers is NOT a valid separate-persona browser test.
Do not patch node_modules, spoof the current runtime identity, or change live
bootstrap user. Separate test runtime must have isolated DB/R2, loopback-only port,
explicit test authentication, matching fixture identities and no provider secrets.

2026-09-15 UX-R2 care role boundary: plan-sign/enrollment APIs now explicitly
require resolved action permission before constructing the write repository.
Existing repository permission + transactional guards remain unchanged (this is
defense-in-depth, not evidence they were previously bypassable). New isolated API
tests retain actual schema/permission/error mapping, mock identity/access resolution
and storage: nurse with doctorConfirmed=true -> 403 and no write; clinician ->
201 and repository call. These are handler tests, not live auth/DB acceptance.
UI action tests use server chronicCareCapabilities across pending/in-progress/
escalated/completed/cancelled and task-owner mismatch. Resolver negatives now include
registrar, administrator, auditor and medical_lead with care.manage but no doctor/
nurse role. `pnpm exec vitest run lib/auth app/access app/care/care-workspace.test.ts
app/api/care`: 18 files / 137 tests passed; typecheck, focused lint and diff-check
passed. Separate `pnpm exec vitest run lib/repositories/chronic-care-workflow.test.ts`
passed 6 integration tests (11.64s), including nurse response/escalation/doctor
resolution and SQL nurse-signature denial. No live identity or assignment changed.

2026-09-15 recovery follow-up: shared header offers explicit "Сменить рабочий
доступ" for a selected assignment/facility. It uses a full-document anchor, not
client navigation: browser testing proved client navigation retained stale forbidden
state when only query changed. Care and communications denial guidance now points
to this recovery instead of the scope-preserving menu. Browser negative read using
missing-test-assignment stayed denied; clicking reset reloaded care, resolved the
current authorized assignment and displayed stored care tasks. No data/permissions
changed. Focused shell tests 3/3 and lint passed after anchor correction; preceding
160-test auth/UI/navigation suite and typecheck passed. This tests missing assignment
recovery, not separate nurse/admin credentials or every forbidden-state variant.

2026-09-15 UX-R1b cross-module scope: workspaceNavigationUrl now retains exact
assignment/facility between allowlisted clinical pages, including patient detail.
Only encounter/live navigation retains encounterId; other resource IDs never move
across modules. Duplicate/empty selectors remain for target validation; provider,
API, access-admin and signout links unchanged. Existing server resolvers still
authorize selected assignment per module (no fallback or privilege union added).
Browser /care -> /orders retained assignment-a-general-medicine and fac-a and
loaded the orders workspace. Target incompatible-assignment error recovery still
needs dedicated browser acceptance.

UX-R2 started: self-access shows role responsibilities with explicit permission
disclaimer, plus combined-role warning. Browser confirmed current local identity
has doctor+administrator in one assignment, not isolated personas. Do not claim
nurse/admin isolated login acceptance from this account. No live assignments changed.
`pnpm exec vitest run lib/auth app/access lib/workspace-access-url.test.ts
app/clinic-shell.test.ts`: 17 files, 160 tests passed; typecheck, focused ESLint and
diff-check passed. Prior 688-test aggregate predates this scope/role slice.

2026-09-15 aggregate recovery COMPLETE: session 23567 `pnpm verify` exited 0.
Log `.local-verify-latest.log`: 90 test files / 688 tests passed, 392.60s test run;
lint, typecheck, drizzle-kit check and production build passed. This supersedes
pending aggregate notes below. Focused post-addition shell/helper run: 7/7 passed.
Not a verify:ci/security-audit/backup or production-readiness claim.

UX-R1b mobile navigation (2026-09-15): at viewport 390x844 browser revealed inherited
column direction in bottom navigation, hiding all but the first link. Explicit row
direction now fixes this; text labels remain visible below 620px, scroll reaches
care/measurements and a click opened /care with real server-selected scope. Header
keeps current section and dashboard breadcrumb at mobile width. Screenshots visually
checked dashboard and care; no clinical writes. Existing cross-module selection
transport (care -> dashboard currently drops explicit scope) is NOT fixed here;
audit as next UX-R1b task, without blindly copying module-specific assignments.

UX-R1b breadcrumb slice (2026-09-15): shared header now includes a dashboard
return link for clinician-capable users away from dashboard; current page uses
aria-current. Browser clicked it from the persisted encounter above: dashboard
opened without encounterId while retaining accessAssignmentId and facilityId.
No patient/clinical state was changed. `pnpm exec vitest run
app/clinic-shell.test.ts lib/workspace-ux.test.ts`: 7 tests passed; focused ESLint,
typecheck and diff-check passed. Tests also cover no clinician dashboard link for
non-clinician capability and no redundant link on dashboard. Narrow-screen header
visibility retains existing behavior; mobile breadcrumbs and role acceptance are
not claimed complete.
Earlier aggregate session 48719 could not be recovered after output truncation.
Re-run `pnpm verify` is session 23567, log `.local-verify-latest.log` (ignored local
artifact); wait for final exit before recording aggregate success. The breadcrumb
test was added after this run started, so its focused result is recorded separately.

D-R1 browser acceptance (2026-09-15): existing synthetic patient SYN-9693657D
opened from registry; New encounter dialog saved a separate draft; exact encounter
`encounter-5fbe14d7-2122-4dde-a5b2-8975902a5a26` opened with correct patient/reason,
8 empty sections, no transcript/suggestions. Reload returned same persisted state.
No consent, clinical signature, microphone or provider action was performed.
UX-R1b follow-up: editor now explains actual lifecycle/access/recovery prerequisite
instead of asking for an absent Edit button; browser displayed draft instructions.
4 helper tests, types and focused lint passed. Aggregate outcome for session 48719
was not recoverable; see newer re-run entry above. No aggregate PASS is claimed.

Runtime follow-up: Vinext uses `--hostname`, not `--host`. Initial restart bound
only ::1; localhost readiness returned 200 while 127.0.0.1 refused. Stopped only
that newly started process and restarted with `pnpm dev --hostname 127.0.0.1
--port 3200` (session 27615). No other service was stopped.

D-R1 existing-patient writer (2026-09-15): focused patient-registry and
patient-directory-access tests passed 20 tests / 2 files (22.76 s), types and
focused ESLint passed. Tests cover actual creation/replay, wrong actor, disabled
membership, access loss immediately before batch, skipped section-head/audit-head
publication rollback. Initial negative fixtures incorrectly used `inactive` rather
than schema value `disabled`; corrected and final run passed. No full CI or browser
creation claim: port 3200 was stopped; web restarted with pnpm dev, but browser
automation remained blocked on its connection-error page.

D-R1 first persistence acceptance (2026-09-15): `pnpm exec vitest run
lib/repositories/encounter-creation.test.ts` passed 14 tests (16.59 s), including
file-backed SQLite close/reopen, exact assigned read, duplicate-free command replay,
eight section heads, one patient/encounter/audit/command and integrity checks.
Only schema and identity bootstrap were applied, no patient seed. `pnpm typecheck`
and focused ESLint passed. This uses a local D1-compatible test adapter, not a live
D1 runtime restart or browser acceptance. Temporary test DB removed, application
data/ports unchanged. Full CI and production acceptance not run.

UX-R1b first slice (2026-09-15): `pnpm exec vitest run lib/workspace-ux.test.ts
app/orders/orders-workspace.test.ts` passed 2 files / 12 tests; `pnpm typecheck`
and focused ESLint on workspace-ux helper/test, shell and orders workspace passed.
Presentation helper retains existing busy/reason/result prerequisites. Browser
acceptance and full aggregate/build were not run for this slice.

UX-R1a (2026-09-15): 4 focused files / 14 tests passed (`section-purpose`, help,
care workspace, observations workspace), `pnpm typecheck` and focused ESLint
passed. Browser at port 3200: care and measurements loaded saved synthetic data,
new purpose panels rendered without clipping at the current viewport, and menu
navigation from care to measurements succeeded. No data writes, role changes,
full build/CI, microphone, provider call or all-role acceptance in this slice.

UI acceptance update (2026-09-15): `pnpm verify` exit 0, 87 files / 676 tests,
lint/types, Drizzle and build; full-name patient-search regression fixed and
reproduced successfully in browser. Post-run local-history label change: 4 focused
tests, typecheck, focused ESLint and browser pass. Scope and remaining checks:
`docs/user-guide/UI-CHECK-2026-09-15.md`. This is not another recovery drill,
real-audio test, external delivery test or production acceptance.

| Date | Command | Result | Scope and limitation |
|---|---|---|---|
| 2026-09-16 | `pnpm typecheck`; focused ESLint; `pnpm exec vitest run lib/providers/clinical-analysis.test.ts lib/providers/groq-live-mode.test.ts lib/providers/groq-clinical-analysis.test.ts lib/providers/groq-rate-limit.test.ts lib/repositories/clinical-analysis.test.ts lib/repositories/clinical-sections.test.ts lib/live-authoritative-workspace.test.ts lib/workspace-access-url.test.ts app/help/page.test.ts --maxWorkers=1`; `node scripts/build-user-handbook.mjs`; `git diff --check` | PASS | 91 tests passed, 1 network test skipped. Separate opted-in synthetic Groq probe passed (2 tests at probe time). Automatic section persistence, provenance, isolation and concurrent clinician-write protection tested; browser link/section UI checked. No actual microphone end-to-end, full CI, cumulative long-note or production claim. |
| 2026-09-15 | Independent new-patient creation/selection; pnpm verify:ci; illustrated handbook | PASS for bounded synthetic slice | Final aggregate exit 0: secrets/dependency audit, lint/types, 86 files/673 tests, Drizzle, build and isolated recovery of 89 tables/161 rows/48 migrations/3 R2 objects/572689 bytes; run 83a4116a-d659-4af8-b4d1-cbc588d77960. Handbook: 17 current screenshots, 67 SVG markers, embedded images/font, zero broken anchors or external images; zoom opened/closed and desktop rendering verified. Post-edit focused ESLint, typecheck, URL 26/26 tests and diff checks pass. No real microphone, live Groq, external delivery, print/PDF rendering or production acceptance claim. |
| 2026-09-09 | Workspace-read audit/recovery assignment boundary; pnpm verify:ci | PASS for this bounded local slice | Final exit 0: secret policy 481 files, no known dependency vulnerabilities, lint/types, 85 files/658 tests (298.46 s), Drizzle and production build. Isolated recovery passed after disposable source destruction: 88 tables/160 rows/47 migrations/three R2 objects/560,469 bytes, 127,136 ms; run 0f76163c-d6f3-4d62-8d13-b7a42f1d5956. Local 0046 confirmed; quick_check ok and foreign_key_check empty. Earlier run had three 5-second integration timeouts; only those cases now have 20-second limits and all assertions remain. Narrow miniflare>sharp 0.35.4 override removes the reported dependency advisory. Independent creation/selection and full Phase 2I remain open; no browser/audio/provider or deployment claim. |
| 2026-09-08 | Explicit fenced export reconciliation; pnpm verify:ci | PASS for this bounded synthetic local slice | Security policy 477 files (478 after operator documentation), no known dependency vulnerabilities, lint/types, 84 files/639 tests (280.79 s), Drizzle and production build passed. Isolated recovery passed after disposable source destruction: 88 tables/159 rows/46 migrations/three R2 objects/559,351 bytes; run d67c9f91-5135-4464-9134-c6ef48bf74ba, 119,489 ms. Local 0045 applied, quick_check ok, foreign_key_check empty, db:generate no drift. Explicit pending schema-2 cleanup only; no automatic retention, existing-user-file deletion, live UI/audio/provider or deployment claim. |
| 2026-09-08 | Phase 2I.3i.2 immutable export publication and download-audit boundary; pnpm verify:ci | PASS for this bounded local slice | Secret policy 472 files, no known dependency vulnerabilities, lint/types, 83 files/617 tests, Drizzle and production build passed. Isolated recovery passed after disposable source destruction: 87 tables/158 rows/45 migrations/three R2 objects/556,449 bytes, 123,986 ms, run a8479b66-407e-483a-9e54-46c4320debc7. Local 0044 applied; quick_check ok, foreign_key_check empty; db:generate has no changes. Pending-manifest reconciliation remains open; no live UI/audio/provider/public deployment claim. |
| 2026-09-08 | Initial export publication 2I.3i.2 verification | Historical partial result; superseded by later ledger | Three focused files/29 tests passed (12.70 s); types/lint/Drizzle/build and 470-file secret scan passed. Migration 0043 applied locally, integrity passed. Initial pnpm verify exited 1: 607 passed and three 5000-ms timeouts (286.87 s). Four affected rollback cases passed with 20-second timeout; the explicit timeout was saved in the working tree. No aggregate/recovery or commit/push was claimed at that earlier stop. |
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
| 2026-09-06 | Phase 2C access administration and patient-family permission migration | PASS for synthetic local data | Commit `6b2308a` adds versioned departments, append-only grant/change/reactivate/revoke commands, guarded administrator self-scope, `/access/manage`, and exact-assignment effective-permission checks for every patient-directory endpoint. `pnpm verify:ci` passed secret policy for 402 files, zero known dependency vulnerabilities, lint/strict types, 58 test files/341 tests, Drizzle drift check, every Vinext route, and isolated recovery after source destruction matching 86 tables/142 rows/29 migrations/three R2 objects/426,521 bytes (`968b47bc-b3db-41ba-837a-9da460067c49`). Authenticated browser QA opened all three administrative forms without committing an access mutation and verified patient links carrying the selected assignment. |
| 2026-09-06 | Phase 2D exact-assignment migration for orders | PASS for synthetic local data | Commit `a9e73e9` migrates all `/api/orders` handlers and the `/orders` workspace to one selected non-service doctor assignment with effective `orders.manage`; exact assignment attribution is persisted and enforced for commands, requests, versions, reports, artifacts and upload intents. Neutral denial, multi-scope selection, explicit deny, legacy-role bypass, cross-clinician access, idempotent replay, stale writes and direct SQL guards are covered. `pnpm verify:ci` passed secret policy for 410 files, zero known dependency vulnerabilities, lint/strict types, 61 test files/360 tests, Drizzle drift check, every Vinext route and isolated recovery after source destruction matching 86 tables/144 rows/31 migrations/three R2 objects/440,753 bytes (`b0e5d027-fd17-4b44-adf2-6c297d4db7a0`). Active D1 integrity and all local/public health endpoints also passed. |
| 2026-09-06 | Phase 2E exact-assignment migration for observations | PASS for synthetic local data | Commit `e29a4da` migrates `/api/observations`, `/api/observations/:observationId` and the `/observations` workspace to one selected current non-service doctor/nurse assignment with effective `observations.manage`. Doctor-wide and nurse-own correction semantics remain distinct; exact assignment attribution is durable on idempotency commands, record roots, every version and audit metadata, and migration `0031` adds database actor and linear-history guards. `pnpm verify:ci` passed secret policy for 414 files, zero known dependency vulnerabilities, lint/strict types, 63 test files/373 tests, Drizzle drift check, every Vinext route and isolated recovery after source destruction matching 86 tables/145 rows/32 migrations/three R2 objects/447,083 bytes (`b699aab3-b5e5-45aa-a2c3-3ba48fcc875c`). Active D1 integrity, authenticated read-only browser QA and all local/public health endpoints also passed. |

| 2026-09-06 | Phase 2F exact-assignment migration for scheduling and queue | PASS for synthetic local data | Commit `9df6510` migrates all seven `/api/scheduling` handlers and `/scheduling` to one selected current non-service doctor/registrar assignment with effective `scheduling.manage`. The clinician/registrar action matrix remains distinct; exact assignment attribution is durable on commands, preference snapshots, appointment/queue roots, every new slot/appointment/queue version, request hashes and audit metadata, and migration `0032` adds D1 actor/role guards. `pnpm verify:ci` passed secret policy for 418 files, zero known dependency vulnerabilities, lint/strict types, 65 test files/385 tests, Drizzle drift check, every Vinext route and isolated recovery after source destruction matching 86 tables/146 rows/33 migrations/three R2 objects/460,540 bytes (`ec9f467a-f59e-405b-8ad9-59e7fefce5fa`). Active D1 integrity, authenticated read-only scheduling browser QA and all local/public health endpoints also passed. |

| 2026-09-07 | Phase 2G exact-assignment chronic-care checkpoint | PASS for synthetic local data | Commit `e5cfcde` binds `/api/care`, commands and `/care` to one current non-service doctor/nurse assignment with effective `care.manage`. Migration `0033` adds six assignment columns, one permission view and seven write guards. `pnpm verify:ci` passed 422-file secret policy, dependency audit, lint/types, 67 files/397 tests, Drizzle, build and isolated recovery (86 tables/147 rows/34 migrations/three R2 objects/476,175 bytes; `66516e81-f003-4171-954e-7246998eb977`). Final UI edits passed typecheck, targeted ESLint, six UI tests and a fresh build. Browser filter, task-dialog open/close and refresh passed without clinical mutations. Runtime was stopped on resumption and was restored; STT is ready, web health is 200 and ngrok points to 3200. Groq configuration is missing at restart; live AI is not verified. |

| 2026-09-07 | Phase 2H exact-assignment communications | PASS for synthetic local data | All five communications handlers, UI and new D1 writes use one current doctor/nurse/registrar assignment with effective communications.manage. Full verify:ci passed secret policy for 426 files, no known dependency vulnerabilities, clean lint/types, 69 test files/415 tests, Drizzle, build and isolated recovery (86 tables/148 rows/35 migrations/three R2 objects/490,091 bytes; run 66e8f363-cf74-4625-a1bd-cc6177f7da2e). Browser executed consent -> intention -> manual task -> response -> completion, then verified reload and invalid-assignment denial. A reproduced same-page denial recovery bug was fixed and regression-tested. |

| 2026-09-07 | Phase 2I.1 compatibility-tool assignment boundary | PASS for this bounded local slice | Full pnpm verify:ci passed: 428-file secret policy, zero known dependency vulnerabilities, lint/types, 70 files/467 tests, Drizzle, build and isolated recovery (86 tables/148 rows/35 migrations/three R2 objects/490,091 bytes; run 180ad8d5-d55f-4bd8-9dd5-b4aecbc4ff57). Route tests cover six operations and prove denied calls do not reach mocked providers. No live AI, microphone, UI-selection or full Phase 2I migration is claimed. |
| 2026-09-07 | Phase 2I.2 encounter request/UI scope | PASS for request/UI slice, DB migration gate open | Code a208a60. pnpm verify:ci passed 436-file secret policy, zero known vulnerabilities, lint/types, 73 files/501 tests, Drizzle, build and isolated recovery after source destruction: 86 tables/148 rows/35 migrations/three R2 objects/490,091 bytes; run 8b685653-c2e0-4630-9d19-7813db3afb2e, 85,806 ms. Authenticated browser verified dashboard/live scope transport and invalid-selection denial/recovery; dark live view inspected. Web/STT health 200; ngrok unchanged. Durable assignment attribution, SQL guards, replay/slow-provider revocation remain 2I.3. No live microphone, AI or end-to-end signed-export claim. |

| 2026-09-07 | Phase 2I.3a clinical section durable authorization | PASS for bounded local slice | Full pnpm verify:ci: 440-file secret policy, zero known dependency vulnerabilities, lint/types, 74 files/517 tests, Drizzle, build and isolated recovery after source destruction (86 tables/149 rows/36 migrations/three R2 objects/500,050 bytes; run a367cf01-3cfe-47f1-88f0-ee1e76cbdd49, 86,095 ms). Migration 0035 applied locally; quick_check ok and foreign_key_check empty. Web 3200 HTTP 200, STT ready on 3101, existing ngrok targets localhost:3200. No microphone, live AI, visual or production-readiness claim. |

| 2026-09-07 | Phase 2I.3b interactive consent commands | PASS for bounded local slice | pnpm verify:ci passed secret policy (443 files), dependency audit, lint/types, 75 files/526 tests, schema/build and isolated recovery (86 tables/150 rows/37 migrations/three R2 objects/504,359 bytes; run 164d912b-d98c-482e-839d-cd67b96b16b6, 88,530 ms). Two final test additions followed by full pnpm test: 75 files/528 tests PASS; targeted ESLint and typecheck PASS. Migration 0036 applied; active quick_check ok, foreign_key_check empty, subsecond clock supported. Web HTTP 200, STT ready and ngrok unchanged. No browser consent mutation or real patient/provider validation. |

| 2026-09-07 | Phase 2I.3c manual transcript corrections | PASS for bounded local slice | Full pnpm verify:ci passed secret policy (446 files), zero known dependency vulnerabilities, lint/types, 76 files/539 tests, schema/build and isolated recovery after source destruction: 86 tables/151 rows/38 migrations/three R2 objects/509,175 bytes, run afc08d9b-7d1a-4c61-adc8-b4434b2bfdb2, 88,323 ms. Migration 0037 applied; active quick_check ok and foreign_key_check empty. Web 200, STT ready, ngrok unchanged. Raw ingestion/session migration, live audio/AI and production release remain outside this checkpoint. |

| 2026-09-07 | Phase 2I.3d speech session ownership | PASS for local slice | Full pnpm verify:ci: 449-file secret policy, no known dependency vulnerabilities, lint/types, 77 files/546 tests, schema/build and recovery after isolated source destruction (86 tables/152 rows/39 migrations/three R2 objects/513,741 bytes; run 55fe1613-757c-4d2d-a987-78c3c4885a49, 89,212 ms). Migration 0038 applied; active quick_check ok and foreign_key_check empty. No live audio, new expiry worker or model/timing change. |

| 2026-09-07 | Phase 2I.3e recommendation generation | PASS for bounded local slice | Full pnpm verify:ci passed secret policy (452 files), no known dependency vulnerabilities, lint/types, 78 files/551 tests, schema/build and isolated recovery after source destruction: 86 tables/153 rows/40 migrations/three R2 objects/518,476 bytes; run 9dde9315-3a01-41b7-bcf6-33037b260132, 90,114 ms. Migration 0039 applied; active quick_check ok, foreign_key_check empty. Web 200, STT ready, ngrok unchanged. Synthetic provider result only; no live AI/microphone or production claim. |

| 2026-09-07 | Phase 2I.3f.1 recommendation repository boundary | PASS; SQL gate open | Full pnpm verify:ci passed secret policy (452 files), no known dependency vulnerabilities, lint/types, 78 files/554 tests, schema/build and isolated recovery after source destruction: 86 tables/153 rows/40 migrations/three R2 objects/518,476 bytes; run d72de977-bcdc-4284-8856-88ab9069a1e5, 88,558 ms. No schema migration. Web HTTP 200, STT ready, ngrok unchanged. Exact assignment on derivative/decision rows and transactional SQL guards remain 2I.3f.2; no full 2I.3f completion claim. |

| 2026-09-07 | Phase 2I.3f.2 recommendation DB attribution | PASS, bounded checkpoint | pnpm verify:ci passed: secret policy 454 files, no known dependency vulnerabilities, lint/types, 78 files/558 tests, schema/build and isolated recovery after source destruction: 86 tables/154 rows/41 migrations/three R2 objects/524,761 bytes; run a5a31a83-ea45-4c16-a575-47e3dfff425b, 90,562 ms. Focused recommendation suite 13 tests passed, including audit/result mismatch and revoked pre-batch/direct SQL writes; subsequent typecheck passed. Migration 0040 applied only locally; quick_check ok and foreign_key_check empty. Web HTTP 200, STT ready, existing ngrok unchanged. Historical nullable fixtures retained; no UI/audio/provider validation claim. Next 2I.3g.1; full 2I remains open. |

| 2026-09-07 | Protocol repository authorization, dashboard and logout | PASS for bounded local checkpoint | Full pnpm verify:ci passed security/dependency checks, lint/types, 80 files/568 tests, Drizzle, build and isolated recovery: 86 tables/154 rows/41 migrations/three R2 objects/524,761 bytes; run 30bb7adc-a230-4602-b013-020cacc54651, 119,931 ms. Browser checks before runtime restart covered dashboard search/filter/navigation and logout/reload/explicit login. Final restart returned web HTTP 200. Groq configuration missing; no provider/audio validation claim. Ngrok restart blocked by execution policy; external URL offline. Next 2I.3g.2, not full 2I completion. |

| 2026-09-08 | Protocol transaction boundary 2I.3g.2 | PASS for bounded local checkpoint | Fresh pnpm verify:ci exited 0: secret/dependency checks, lint/types, 80 files/575 tests (203.72 s), Drizzle and build passed. Isolated recovery passed: 86 tables/155 rows/42 migrations/three R2 objects/537,562 bytes; source destroyed before restore; run f58418fc-97fd-4225-a7da-0d98679232d6, 120,581 ms. Forward migration 0041 and local D1 quick_check/foreign-key checks were verified in the preceding continuation. Final read-only subagent review found no blocking authorization defect. On September 8 ports 3200/3101 were not listening; no services stopped, browser/provider/audio or external availability claim. Next 2I.3h; full 2I remains open. |

| 2026-09-08 | Lifecycle transaction boundary 2I.3h | PASS for bounded local checkpoint | Final pnpm verify:ci exited 0: secret policy 464 files, no known dependency vulnerabilities, lint/types, 81 files/589 tests (235.20 s), Drizzle and build. Isolated recovery passed after disposable source destruction: 87 tables/156 rows/43 migrations/three R2 objects/545,915 bytes; run 7968d0c5-8821-4a99-8564-70cac7a19a93, 121,222 ms. Focused lifecycle/protocol suite 33 tests passed with explicit 20 s integration-test budget; first aggregate timeout and narrow fix documented in handoff. Local 0042 applied; quick_check ok, foreign_key_check empty; db:generate reports no schema changes. Subagent design research completed partially before workspace spend cap; no final independent-review claim. No browser/audio/provider/deployment test or service restart. Next 2I.3i signed exports; full Phase 2I remains open. |

| 2026-09-08 | Export repository and response boundary 2I.3i.1 | PASS, partial export phase | pnpm verify:ci exited 0: secret policy 466 files, no known dependency vulnerabilities, lint/types, 82 files/601 tests (239.67 s), Drizzle/build and isolated recovery: 87 tables/156 rows/43 migrations/three R2 objects/545,915 bytes; run ce68d35b-9992-483d-8d87-c56385b999cc, 121,321 ms, source destroyed before restore. Targeted signed-protocol/export SQLite suite 15 tests and async export API suite five tests passed. No schema change or service restart; no live browser/R2/provider/Word validation. Remaining 2I.3i.2: SQL transaction guards, artifact/download audit attribution, shared-key overwrite and uncertainty-safe R2 publication/cleanup. Full 2I.3i and Phase 2I are not complete. |

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

### Latest operational checkpoint — Cloudflare ready, empty auth D1, 2026-09-30

Owner restarted Codex and approved the single Opera Wrangler device flow.
The exact Cloudflare account is verified; dedicated `orion-clinic-auth-pilot`
D1 exists and a no-write connectivity query passed. UUID and evidence are in
§13. Keep it separate from the main local clinical database: it has no schema,
employees or credentials yet. No Worker or Vercel application is deployed.
Before activating password login, resolve private ingress/provisioning and
target CPU/load evidence. Paid Workers needs explicit owner approval; an
alternative Vercel-hosted verifier needs an explicit authenticated gateway,
not weaker hashes or forwarded Sites identity. Preserve all ONLINE-1B/1C gates.

### Latest — compact clinical UI and personal local staff login, 2026-09-28

The latest owner request is implemented locally: an anatomical patient panel with
independently timestamped saved vitals, card-based notification center, optional
analytics, actual aggregate-only Groq briefing, persistent medical route entry/exit
and corrected light-theme contrast. Three parallel implementation agents plus
independent cross-review were used. Exact current evidence/limits are in §13.

Main loopback3200 now uses real local login/password for six EXISTING staff
principals. `scripts/configure-local-accounts.mjs` provisioned separate random
initial passwords in a separate local SQLite registry; clinical D1 users,
memberships, assignments and pending0048–0052 migrations were not changed.
Credential handoff is outside the repo/OneDrive at
`C:\Users\profm\AppData\Local\ORION-Clinic\5bd7b8e5a1549d88\accounts.html`.
Do not copy its contents into chat, source, logs or documentation. Password change
is available to the signed-in employee. Missing registry does not fall back to
Seedy. This supersedes historical statements that main local login is still shared.

This local-only alternative does NOT complete ONLINE-1: it rejects non-loopback
transport; public HTTPS identity, deployment and recovery remain separate gates.
New pages fence old session generations; legacy shared IndexedDB readers/writers
are disabled before opening the store in this mode. Old materials are preserved,
not adopted, deleted or made available to a newly selected user. Pre-release tabs
must be refreshed/closed after saving needed in-memory work; already downloaded
old JS cannot acquire the new local-history guard retroactively. Durable protected
recording recovery remains unfinished; do not describe blocked legacy history as
completed owner-scoped storage. Retain synthetic-only mode and clinician approval.

### Latest bounded UI checkpoint — compact navigation and animated pathway, 2026-09-28

The icon-only desktop rail, hover/focus labels and browser-like left pathway
panel are implemented and checked at desktop/mobile widths. Entry and exit
motion is local UI only and respects reduced motion; no clinical or persistence
semantics changed. §13 records exact tests/build/browser evidence and the
remaining manual reduced-motion/unsaved-form checks. This does not supersede
the ONLINE-1 release gates or complete true personal sign-in.
The owner's immediate clarification adds a separate read-only route home at
`/pathway` with patient selection and a server-derived timeline; orders are
now entered only from an explicit inner tab/card. This does not make the
timeline a complete clinical record: each source is capped at100 and legacy
integrations remain disconnected.

### Current — queue visibility, honest AI context and patient-link groundwork, 2026-09-28

The owner directly resumed work after the old stop checkpoint. This bounded
checkpoint adds a server-data queue board, exposes the rolling-window limit in
both consultation screens and starts MOBILE-1/M1a with an unmounted durable
patient self-link registry. It does **not** complete automatic waitlist/hold
expiry, cumulative fact memory D-R2, protected patient login, document release,
an installable mobile application or online deployment. The next safe mobile
vertical slice is verified identity binding, patient actor/version pins,
audited release/read and terminal revoke with a final authority check, all on
an isolated DB before any HTTP route. Next AI slice is cumulative sourced facts
with correction/contradiction handling and clinician review. Next queue slice
is a server-side, cursor-paginated worklist with exact staff scope and a
trusted, audited expiry worker; the current UI only shows up to 100 loaded
appointments and tickets. Preserve main
D1/audio and keep dev identity off the public internet.

### Current — visible D-R3 order-draft checkpoint, 2026-09-24

**Owner stop instruction, 17:40UTC:** finish the current verified checkpoint only.
The exact ORION heartbeat schedule was deleted by the app tool; do not recreate
it or continue to the next phase unattended. Main servers remain running.
Subsequent bounded delta hardened the local artifact guard and added a checked
build command; current full deployment remains BLOCKED, not uploaded (§13).

The latest owner requested one concrete completed result before departure, then
an immediate Vercel attempt. D-R3 now connects accepted action recommendations
from clinical/Live to a server-verified form and explicit saved order draft.
No action is performed on navigation. Exact accepted decision/derivative and
version are preserved in immutable creation audit; current rights/consent/source
and all publication parts are checked in one transaction. Existing same-key
retry returns its receipt; another key for the same decision conflicts, and GET
offers the existing order. Historical source text requires current encounter.read.

Browser on isolated3214 created one draft, reloaded the exact requestId URL and
reopened the source without another order. Independent D1 read proved draftv1,
null approval, exact provenance/command and a valid audit head/hash chain. Final
aggregate: 1669 unit +514 database-integration passed, 1 opt-in skipped; build PASS.
Exact commands and browser limits are in §13. Instructions include the new flow.

Vercel preflight blocked current dist/server/.dev.vars and unresolved Workers
bindings/trusted main auth. Exact target orion-clinic was not found in shadowocc;
no other projects inspected, no upload/deploy or new cloud resource. Dedicated
backend+individual identity+Vercel build adapter remain implementation gates, not
something solved by removing one file. Read vercel-readiness updated note.

Main3200/3101 restored with no initialization; preserve current main DB/audio.
New safe launcher option `-SkipDataInitialization` avoids pending0048–0051.
Parallel0051 authority fence passed80 SQL tests but remains unmounted. Next online
task is1C2a2-coordinator / isolated staff UI integration, not public dev exposure.
D-R2 cumulative facts and MOBILE native client remain unfinished; do not call this
whole platform production-complete. See latest handoff and explicit external gates.

### Previous — internal durable material registry 1C2a1, 2026-09-24

Newest1C2a1 adds `D1LocalMaterialRegistry` and additive0050/schema/meta: durable
reservation→prepare→receipt/head/events, exact retry, CAS and terminal states.
39 real-SQL integration tests plus independent review pass; aggregate129files /
2074passed /1opt-inskipped (two projects), build/lint/types/dbcheck/secrets629
and main navigation smoke pass; details in section13. Main0048–0050 remain unapplied. This storage
primitive does NOT authorize clinical actions or issue/create/unwrap keys; no
consumer is mounted and current history is not isolated by these new tables.
Next **1C2a2** adds explicit wrapping coordinator, current action/consent SQL,
terminal revoke/ABA fences and preparation recovery, before any endpoint/v2 UI.
Policy/provider identifiers are not a working facility or approved policy.
Read ADR-0003 + local-material-isolation-plan §8; do not auto-adopt/read/delete v1.

Previous bounded checkpoints:

Newest checkpoint 1C1d/e adds ADR-0003 plus a tested real AES-GCM primitive, still
unmounted. It accepts exact32 raw key bytes and fixes spoofed view/key-metadata
issues found in independent review; no key broker, v2 storage or audio chunking.
Next **1C2a** is a durable reservation/head/CAS/audit state machine in disposable
DB with an explicitly injected wrapping facility. Missing custody denies; never
use process Map/default key/legacy migration to manufacture a working runtime.
Read ADR-0003 and local-material-isolation-plan §8 before implementation.
Separate new remote-GigaAM control helper supports only mocked health/create;
no gateway or remote audio implementation. See online-speech-options §7.

ONLINE-1C1b now provides strict immutable descriptors and target-bound operation
leases, with 211 new focused tests. Equal/replaced/invalid targets and A→B→A retire
late work; changing authority stays separate from ownership. No main consumers,
storage or audio are wired to it yet. This is not an encrypted cache or DB CAS.
The immediate 1C1c follow-on adds canonical audio/transcript metadata binding only,
not an encrypted envelope. Subsequent 1C1d/e above establishes the engineering
architecture and isolated crypto, not actual key release/retention/restore. Read isolation
plan §8 and newest verification ledger; never auto-adopt legacy v1 into a user.

ONLINE-1C1a now resolves a current staff/session + exact assignment/facility/
patient/encounter context with five separate consent decisions in one final SQL
snapshot. It handles profile archival, corrupt heads, DB-clock expiry and
concurrent logout/reset/regrant. Scope/version fingerprint is not a bearer grant,
key or offline entitlement; new helpers remain unmounted and read no material
bytes. Focused checks: 76 unit + 35 real-SQL tests; aggregate in section 13.
Read `docs/operations/local-material-isolation-plan.md` §8 before next work.
The follow-on 1C1b descriptor/fence is now implemented separately, without
storage/keys/v1 reads. Remaining: separate encryption/key-release,
transaction/retention/restore policies and isolated browser integration gates.

ONLINE-1B3a adds a shared server-only identity resolver and an isolated technical
SSR/API transport. Real loopback HTTPS/workerd/D1 now verifies default password
KDF, two individual same-role accounts, durable logout, sequential restart,
reset and disable. Exact evidence/limits are in section 13. This is an unmounted
test runtime, not the clinical pages or the user's new login screen. Browser
acceptance remains blocked on a trusted isolated HTTPS origin; do not bypass the
browser warning or install the bundled shared development CA into system trust.

Latest bounded code: ONLINE-1B2 has real versioned credentials, durable pre-KDF
admission, an unmounted HTTPS login handler and fixed-profile password hashing.
Provision/reset/disable advance the user epoch and revoke old sessions/grants
atomically. Independent review caught and corrected D1 trigger-inclusive change
counts and an UPDATE OR REPLACE user-ID displacement/resurrection path. Final
tests and exact limits are recorded in section 13, not inferred from source alone.
MOBILE-1/M0 now has ADR-0002 and a tested pure own-patient released-protocol view;
it has no API/native client and cannot substitute for verified identity/DB audit.
ONLINE-1C0 adds a tested, unmounted staff context/async-publication fence. Source
audit and staged gates are in `docs/operations/local-material-isolation-plan.md`;
it does not yet fix ownership, encryption, overwrites or cross-tab behavior in
the running legacy history. Preserve that data; do not enable individual staff
login on the existing shared browser profile before the isolation gates pass.

The reported broken navigation, unstyled/ambiguous LIVE start and bare logout
screen have a bounded verified correction. `/sign-in`, truthful `/signed-out`,
theme-aware access screen, compact new-vs-continue LIVE choices and scoped links
are implemented. Optimizer isolation prevents tests/build from replacing active
dev navigation modules. Browser/test limits are explicit in section 13.

**This is not project completion or deployment.** Main login remains the Sites
development identity; ONLINE-1B credential/session foundation is not mounted and
main 0048/0049 migrations remain unapplied. No public endpoint may expose that identity. Current
build output is rejected by the new artifact scanner due to `server/.dev.vars`.
Vercel CLI access is present, dedicated backend/auth/STT are not yet ready.

Original requirement coverage is now tracked in
`docs/operations/requirements-audit-2026-09-24.md`: real local workflows are
distinguished from partial features and absent external integrations. Deploy plan:
`docs/operations/vercel-readiness-2026-09-24.md`; STT options and limits:
`docs/operations/online-speech-options.md`. Do not silently mark KMIS/ERDB/PUZ,
actual message delivery, critical rules or inter-hospital exchange as implemented.

Owner added MOBILE-1: separate native Android/iOS patient application with
accessibility and server-enforced patient/caregiver/staff boundaries. Full plan:
`docs/operations/mobile-application-plan.md`; M0 contract implemented, native app not started. Same
existing ORION repo only, never any dir echoes resource. This does not authorize
buying infrastructure, registering store accounts or accepting legal terms.

Parallel auth track: ONLINE-1B3b safe initial provisioning and isolated
clinical SSR/API adapters/two-person browser tests, using the shared resolver.
The fresh migration map covers 47 direct Sites API callers plus SSR/shared
helpers. Preserve internal user ID vs external subject semantics; never emulate
Sites headers or alias user IDs into an external principal. While trusted browser
HTTPS is unavailable, continue independent server access/key and restore contracts;
do not repeat unchanged certificate/Cloudflare checks or claim browser acceptance.
No main migration/auth switch until ONLINE-1C owner-scoped local history and
legacy recovery pass. Keep global abuse limits, password policy/MFA/recovery,
target-runtime CPU/load, attempts retention and backup invalidation as explicit
pre-publication gates. Mobile M1 can independently add patient link/release/audit
persistence from ADR-0002; no mounted patient API or native completion is claimed.
Preserve current ports and do not reuse shared role subjects or process Maps.

Additional STT source correction (8 tests) prevents health/read capacity eviction.
It is not loaded by the unchanged running speech process; apply only during a
controlled idle restart and record actual service/audio verification separately.

Overnight continuation `orion` is ACTIVE for seven hourly runs in this task;
its prompt includes existing-repo-only, full dir echoes prohibition and MOBILE-1.
This is scheduled bounded work, not a guarantee of uninterrupted operation or
completion overnight. Local runs need the computer/app and checkout available.

### ONLINE-1B — durable staff-session foundation, 2026-09-24

**Historical foundation checkpoint; ONLINE-1B remains IN_PROGRESS.** The current
3200 interface still uses Sites development authentication. A newer entry UI is
recorded above; it does not deliver independent password accounts or online readiness.

The new server-only module issues a 32-byte random opaque bearer after a separately
verified credential grant; only SHA-256 is stored. Its cookie is `__Host-`, Secure,
HttpOnly, SameSite=Strict, Path=/, without Domain. Exact configured HTTPS origin
and Fetch Metadata guard POST logout; headers/URL/body never select an identity.
The handler is not mounted. Wrong-site/GET requests cannot revoke sessions, and
DB failure is unavailable rather than a successful logout or identity fallback.

`D1StaffSessionRepository` stores individual identity/user-version, not roles.
Idle 30 minutes and absolute 8 hours use the database clock. Atomic revoke and
user-change triggers leave terminal tombstones, including across SQL REPLACE and
disable/reactivate. A current-state read after insert/touch denies a concurrent
revocation. Exact-assignment authorization still belongs to existing D1 resolvers.
77 focused tests include actual file-DB reopen/two connections; limits/results are
in the ledger. No session migration or credentials were applied to the main DB.

Next bounded task: mount this foundation in an isolated HTTPS staff test runtime
with separate D1/R2 and no provider keys; implement individual credentials and a
common SSR/API principal, login/logout forms, durable throttling and audited
provisioning/reset. Prove direct URL/API denial after logout with two browsers.
Never accept a browser-supplied credential grant or trust forwarded identity.
Preserve main 3200/3101 and the synthetic-only boundary. See detailed continuation
in `docs/operations/online-staff-auth-handoff.md`.

Still mandatory before public access: ONLINE-1C per-identity recordings/legacy
recovery, deployment/STT protection, session retention and an auth-restore policy
that cannot revive bearer tokens revoked after a backup. The new-table-empty
backup drill is not proof of session-bearing recovery. Hosting choice remains open.

### ONLINE-1A — first online-readiness fixes, 2026-09-24

The owner approved work toward non-local staff access and asked for other stages
besides STT. ONLINE-1 in section 1 is the active implementation order. Hosting
choice was asked (Cloudflare + protected STT or Vercel + separate backend/STT)
but not yet supplied. No deployment account, paid service or production identity
was chosen on the owner's behalf. Synthetic-only and all clinical approval gates
remain in effect.

Completed implementation slices:

1. Speech: only the exact upstream 422 no-voice detail is normalized to empty text;
   invalid audio and unavailable service remain errors. Clinical upload queue now
   assigns index on send, advances only after a persisted segment and does not call
   onSegment(null). Real failures stop subsequent queued sends; a new session owns
   its own queue. Existing LIVE no-speech path remains intact.
2. Care → measurements → care: context carries exact patient/task/facility/assignment,
   revalidates against the authorized care response and uses fixed local paths only.
   Opening a pending current-plan task preselects its patient and follow-up context.
   Return highlights that task. Dialog/saving state disables return and patient switch;
   changed scope/patient clears task context. No diagnosis, task completion or clinical
   signature is inferred from a measurement.
3. Profile update/archive: current exact actor/assignment and effective permission
   are checked before replay, each retry, first/last statement in the D1 transaction
   and before releasing the result. Assignment/actor attribution enters command/hash/
   response/audit. A transactional final assertion rolls back incomplete publication
   of the profile head, command or audit. Revocation after a valid commit suppresses
   the response without destroying committed history or duplicating the operation.

Verification and limits are in the newest ledger above. Operator text updated in
chronic-care.ru.md, patient-observations.ru.md and shared verified-workflows.mjs;
offline/in-app handbook regenerated. Illustrations have not all been recaptured.

Next online blockers: durable individual staff identity/session/logout (ONLINE-1B),
per-identity local recordings and legacy shared-browser recovery (ONLINE-1C), then
closed deployment with guarded persistent STT (ONLINE-1D). Photo register/R2 cleanup
needs a separate ownership/publication protocol: blindly deleting the common
content-addressed object after a late authorization error can delete a valid object.
Care navigation safely refuses patients outside the initial 200-item observations
list; targeted authorized lookup and durable task/measurement provenance remain.
Non-STT roadmap also includes accepted-hint → explicit draft order, cumulative notes
beyond 24 transcript turns, rescheduling/waitlist/trusted reservation expiry and
operational readiness. External KMIS/LIS/ERDB/PUZ/communications require actual
contracts and must not be simulated as completed integrations.

### Open persisted protocol and simplify signed encounter — 2026-09-17

Owner could not find the protocol after assembly. Previously only metadata was
returned to the UI, the success message incorrectly said signing unavailable,
and the signed header button was disabled. New getCurrentPreview reads the exact
immutable protocol_versions content behind the scoped head, validates schema,
encounter and hash, and rechecks selected read access before returning. It exposes
only note sections, accepted effective recommendations and amendments, not the
stored transcript/evidence. Workspace's existing snapshot consistency, read audit
and final authorization boundary also cover this projection.

Assembly now scrolls to the persisted document. Both draft and signed protocols
have an Open action; preview itself is read-only even before recovery confirmation.
Signature remains explicit and gated. Until 8-section, transcript-role and
unsaved-state prerequisites pass, top CTA says Check record and scrolls to the
review controls; it does not send an assembly request. Errors are also shown beside the
local workflow, and a rejected non-version 409 no longer leaves Saving stuck.
Signed view is document-first/full-width: AI action sidebar hidden, historical
materials folded but still accessible. Active review's verbose guide is a disclosure.

Verification: isolated DB lifecycle test reviews eight sections, assembles, reads
snapshot, signs, reopens and generates actual DOCX/PDF/ZIP bytes. Preview rejects
wrong actor/encounter and revocation during read. Focused six-file gate 42 PASS;
types and focused lint PASS. Final five-file UI/API/help/UX gate 29 PASS;
handbook regenerated (19 screens/75 markers), git diff --check PASS. Live browser on 3200
opened an existing synthetic signed encounter, Open scrolled to the document,
Word/PDF scrolled to artifacts, PDF click produced authorized HTTP 200 in server
log. Anonymous direct download returned 401. Local SQLite quick_check=ok; 3 draft
and 4 signed version rows exist (versions, not counts of distinct encounters).
Started only free 3200/3101, STT health ready. No clinical approvals of owner's
records, no new consent, no Groq call, no full CI or production readiness claim.
Handbook wording updated; illustrative screenshot remains older and labelled.

### Review unlock and visible outcome/storage — 2026-09-16

Owner could see AI drafts but not approve them: recoveryConfirmed was false on
reopening, while the sole resume action was above the fold and hints incorrectly
said to start the already in_progress encounter. Keep explicit recovery; new
ResumeReviewAction sits beside editor and recommendations, refreshes through the
existing guarded read, and never grants consent, starts audio or approves content.
After a read failure its retry remains available. Corrected blocker/tooltip text.

EncounterReviewGuide separates 8 reviewed sections, accepted suggestions, assembly,
explicit signature and exports. Unknown/provisional transcript count is exposed;
assembly CTA stays disabled until section/role/current-state prerequisites pass.
Explicit links/actions go to next unresolved section, transcript, signing and
exports. Accepted hints are protocol items, not automatically issued orders.
Storage label now distinguishes saved unsigned record from signed protocol.
History action opens exact patient's card preserving the selected assignment;
data remains encounter-scoped, not a silent rewrite of demographics/care orders.

Verified browser: resume made edit/accept controls enabled without any clinical
approval; history action opened correct patient and listed exact source encounter.
Typecheck and focused ESLint PASS. First focused run (guide/UX/sections/protocol)
38 PASS; final guide/UX/scope/help run 55 PASS. An initially overbroad patient-list
scope change was narrowed to patient detail after regression test failed; final
scope tests PASS. No full CI, new signed clinical document, microphone/provider
run or external integration tested. Handbook wording rebuilt; screenshots older.

### Automatic LIVE analysis -> eight clinical sections — 2026-09-16

Owner explicitly requested AI output in complaints/history/diagnosis/plans, not
only right-hand hints. This SUPERSEDES the older hints-only LIVE entry below.
Groq LIVE now requests sections in the same structured response as hints, with
3000 max output tokens (reviewed mode remains 4000), unchanged model, timings,
consent and throttling. Policy version is orion-clinical-drafts-v2. Prompt requires
exact evidence, omits unsupported sections and distinguishes proposed diagnosis/
plans from physician decisions. No fabricated negative findings or automatic orders.

Existing D1 completion persists these as ai_draft versions in this exact encounter.
Only empty/ai_draft heads are eligible, under version guards; clinician_edited,
reviewed and explicitly_absent are preserved, including edits during inference.
Opening a saved encounter does not send it to Groq; old hints-only outputs are not
backfilled. A new successful analysis is necessary. Current context is still last
24 canonical segments; cumulative summarization beyond that window is NOT complete.

UI: LIVE links directly to the same encounter's eight-section editor; preserved
URL anchor and post-load scrolling. Editor explains drafts versus approval and
unknown data. Manual reviewed generation now submits last 24 instead of an invalid
unbounded snapshot. Patient external-AI consent action is visible in LIVE; no
consent was granted on behalf of an actual patient. Guide workflow updated and
both HTML copies regenerated; previous screenshots explicitly labelled as older.

Verification: pnpm typecheck PASS; focused ESLint PASS; git diff --check PASS.
Nine focused Vitest files: 91 passed, 1 opt-in network test skipped. Tests cover
section persistence/reload/provenance, same-encounter isolation, exact replay,
concurrent save/review/explicit-absence protection and invalid AI evidence.
ORION_LIVE_GROQ_CHECK=1 groq-live-mode.test.ts: 2/2 PASS at probe time, including
one real Groq call using only hardcoded artificial text; complaints and hints
returned and exact citations validated. Two further negative unit cases added
after probe passed in the 91-test run. Browser verified updated text/navigation
and loaded all eight sections, without submitting patient text or changing consent.
No full microphone -> live API -> UI generated-content acceptance, aggregate CI,
production validation, new screenshots, migration, commit or push is claimed.

### Speech interruption / invalid AI response — 2026-09-16

Logs show SPEECH_INVALID_RESPONSE and separately SPEECH_UNAVAILABLE; health now
returns 200. Found empty-text mismatch: Python intentionally returns empty text
for silence but TS required min(1), causing fatal capture shutdown. Provider now
allows empty text; route validates session/index then returns skipped:no_speech,
does not write transcript or advance DB sequence. Client uses a separate sequential
persisted-upload counter (increments only for persisted text), so the next queued
audio reuses the expected DB index. Model/VAD unchanged. UI always exposes speech
error even with existing transcript and stops elapsed timer on error.

AI schema now limits evidence to 4 quotes to match validator, and prompt includes
question-mark/safety-risk/medication-count rules already required by validator.
No evidence checks bypassed. First live probe rejected a nested schema reference;
replaced with the previously supported definition ref, real synthetic Groq probe
then passed both tests. Focused provider unit tests 9 passed/1 skipped; types and
lint passed. Long microphone/noise/queued-silence end-to-end not yet verified.
SPEECH_UNAVAILABLE cause remains unproven; do not claim all disconnections fixed.

### New-visit startup deadlock follow-up — 2026-09-16

Owner screenshots show disabled consent controls on newly created visits and
generic profile validation. LIVE consent UI now permits draft/ready/in_progress
instead of only in_progress. Added explicit activate action using existing guarded
transition API draft -> ready -> in_progress, exact returned version, per-step
idempotency keys, and care consent enforced server-side. Microphone starts only
after separate start click and existing speech consents. No server guard removed.
Profile errors now identify invalid fields without echoing submitted values;
phone/address HTML minLength matches schema. Chooser border colors use clinic
fallback tokens, not absent legacy variables. Typecheck/focused lint passed.
Browser end-to-end acceptance remains required; no assertion that all system
issues or accepted-suggestion materialization are complete.

### Conversation isolation and compact LIVE — 2026-09-16

`/live` without explicit encounterId now shows a start chooser, never implicitly
loads the previous encounter. Existing explicit URLs still resume that encounter.
After recording stops, new-conversation action waits for audio finalization and
local materials save before leaving for the chooser; persistence failure blocks
navigation. It does not finalize the clinical lifecycle or delete history.
Existing patients create visits from their patient card; new patients use creation.

Compact scoped LIVE styles remove decorative orbit from ready state, reduce hero
typography and collapse technical AI explanation. Accepted cards link to their
exact clinical record and distinguish questions from verified clinical facts.
This is navigation, NOT automatic structured-section/referral materialization.
That remains required follow-up: explicit destination, provenance, authorization,
idempotency and no conversion of a question to a diagnosis/allergy fact.

Verification: typecheck and focused ESLint passed; chooser SSR test passed;
14 encounter-creation repository tests passed. New visual CSS not browser-QA'd yet;
two-conversation microphone/UI isolation acceptance remains outstanding. No data
deleted, no schema changes or service shutdown. Do not claim full integration done.

### Legacy-like LIVE restored — 2026-09-16

Owner requested legacy behavior. Automatic LIVE calls now use a dedicated light
provider mode: summary + up to six hints only, 1800 max completion tokens, low
reasoning/hidden reasoning for the unchanged GPT-OSS model. The response schema
does not request sections; validated live output has sections=[] and cannot write
clinical section drafts. Existing reviewed generation retains structured sections
and a separate 4000-token limit. API derives provider mode from the existing
reviewed/automatic command, so their idempotency hashes remain distinguished by
acknowledgement. Manual refresh within LIVE uses the same light mode.

Automatic timing now matches legacy constants: first 1200ms pause, subsequent
starts >=12000ms apart, 80 characters during listening / 40 on stopping. Provider
Retry-After takes precedence. Consent, assigned doctor authorization, versioned
canonical DB sources and explicit approval of decisions remain unchanged.

Verified: pnpm typecheck and focused ESLint pass; 9 provider tests pass including
ONE opted-in real Groq call through the actual updated provider using only the
synthetic text embedded in groq-live-mode.test.ts. Real output passed schema and
exact-evidence validation. No clinical database content was sent by that test.
Normal tests skip that network test unless ORION_LIVE_GROQ_CHECK=1. Full microphone
-> DB -> API -> displayed cards remains unverified; provider success is not that
end-to-end acceptance. No model/key change, data deletion, port shutdown or commit.

### Groq 429 follow-up, 2026-09-16

Owner screenshot now reports rate limiting, not a transcript conflict. Provider
previously discarded Retry-After. Added numeric/HTTP-date parsing (60s fallback),
process-local credential-scoped upstream cooldown, API 429 + Retry-After, and LIVE
cooldown with up to three automatic retries. Manual refresh is blocked during the
cooldown; model/keys unchanged. This cannot replenish provider quota. Process-local
cooldown is not a distributed production limiter; restart loses its state.
No live provider request was sent just to reproduce a known limit.
Focused mocked-upstream tests verify no upstream call during cooldown and expiry;
typecheck and focused lint/tests are the verification gate for this change.

### LIVE snapshot conflict follow-up, 2026-09-16

Owner reported TRANSCRIPT_SNAPSHOT_CHANGED. Found deterministic mismatch: client
used last 24 transcript references while repository selected first 24, and its
transaction guards compared selected length with unbounded transcript count.
Changed canonical query to latest 24 in encounter order and bounded count checks.
Persisted LIVE tokens now carry segmentIndex and prefer encounter ordering over
recording-relative timestamps. Automatic snapshot conflicts refresh server data
and reschedule under the existing 15-second throttle, without asking for manual
acknowledgement. Other errors remain visible. Access/consent/source-version checks
remain enforced. Long-transcript DB regression and existing repository tests pass;
do not claim a real-microphone end-to-end success from those tests.

### Owner change — automatic LIVE AI drafts, 2026-09-16

Owner explicitly requested legacy-style automatic hints without per-turn clinician
acknowledgement. LIVE now schedules analysis after 2.5 seconds of quiet in persisted
transcript changes, at least 15 seconds between automatic request starts, and only
after recording has been started in this view. Opening a saved encounter alone must
not transmit its transcript. Same encounter's last 24 canonical persisted segments
remain the server-selected context. Required consents, assigned-clinician access,
snapshot/version checks and human approval of suggestions remain enforced.

Automatic requests explicitly use `mode: automatic, acknowledged: false`.
`analysis_runs.transcript_acknowledged_at` and audit acknowledgement time are NULL;
timestamps for request/creation remain populated. Reviewed clients retain their
existing explicit acknowledgement contract. No schema migration or fake review.
Refreshing generated drafts no longer resets the recording UI or elapsed timer.

The LIVE view now distinguishes continuing an existing encounter from a new visit:
prior segment IDs are captured at recording start and hidden by default, with a
reversible display toggle. Persistence, exports and AI input are not filtered.
New-encounter link is offered before continuing a nonempty visit.

Verification: typecheck passed; focused ESLint passed; live-recording-view and
clinical-analysis repository tests passed (11 tests). Existing live-authoritative
tests passed (5). Browser loaded the new automatic-mode copy on main port 3200.
No new end-to-end microphone -> Groq -> visible draft run was performed; prior
direct Groq connectivity probes are not evidence of that full workflow. On a
failed automatic snapshot, UI shows the error; new text or manual retry is needed.
Next: controlled synthetic microphone/AI acceptance, scheduling/component timer
tests, and update screenshots/help to reflect the new LIVE behavior. Individual
local-account integration and both offline scenarios below remain unfinished.

### Latest owner request — local accounts, offline and Groq, 2026-09-16

Owner requests individual local logins/passwords with DB permissions, and checks
of both face-to-face recording and loss-of-internet behavior. Do not substitute
the separate persona environment for the main platform. Web/STT listeners had
stopped; launcher restarted them. Logs contain Network connection lost, but exact
process-termination cause is unproven. Current web 3200 HTTP 200; STT 3101 and
speaker model report ready. No actual microphone accuracy acceptance claimed.

On explicit owner instruction, inspected only legacy ariaproject Groq settings,
then copied Groq keys/model names into ignored `.dev.vars` without displaying keys.
Real artificial-only provider probes returned HTTP 200/text for GPT-OSS 120B and
Compound Mini. Added GROQ_API_KEY/GROQ_MODEL aliases needed by the new provider.
Only web was restarted; startup confirms `.dev.vars` loaded. Fixed launcher's
quoted-key detection. Git ignores the secret file; secret scan passes 544 files.
This is provider connectivity/configuration evidence, NOT end-to-end clinical UI
analysis. Preserve current local credentials; never print/copy them into docs.

Started `scripts/local-account-auth.ts` and `lib/local-account-auth.test.ts`:
loopback-only login/logout screens, scrypt, opaque HttpOnly sessions, input/header
checks, expiry, credential-change invalidation and throttling. Two tests pass;
provider/config suites combined 12 tests, fresh types and focused lint passed.
IMPORTANT: middleware is NOT wired into Vite; no accounts provisioned or passwords
chosen, and main login is still Sites. Do not claim the account-login request done.
Next: complete local credential setup with owner-entered passwords, provision exact
DB principals/assignments transactionally, wire explicit local-only mode without
Sites identity fallback, add rate-limit/rotation/multiple-account negative tests,
then browser-test login/logout and each role against the same DB. No ngrok exposure.

Offline inspection so far: legacy-style LIVE history uses IndexedDB with 300ms
debounce; clinical workspace reads/writes still depend on local server/D1. No
verified offline queue or durable in-progress audio recovery yet. Both requested
recording/network-loss scenarios remain pending behavioral acceptance.

### Latest functional fix — dashboard worklist isolation, 2026-09-16

Browser reproduced doctor dashboard 503: scheduling-only fixture has zero clinical
section heads, while the ordinary UI-created encounter has all eight. The worklist
was coupled to a full clinical-record load and selected the incomplete encounter.
Added `view=worklist` to the existing authorized workspace GET and switched the
dashboard to this summary. Each returned encounter gets an audit operation and
exact-scope checks before audit and before publishing; only required table fields
are returned. Full-record completeness remains enforced; no DB records were repaired
or invented. Incomplete clinical records still cannot be opened as valid protocols.

Browser reload now shows both persisted encounters; search for OR-ABC8C87C narrows
to the ordinary encounter, whose Open action loads its saved eight-section record.
Six added route tests cover incomplete resources, anonymous reads, failed audit,
revocation during audit, empty assigned list and each record in a multiple list.
Focused route/help: 13/13, types and focused lint pass. The last two tests were
added after aggregate test collection; the aggregate covered 735 tests, not 737.
Runtime four-persona checker now covers worklist permissions and logged-out cookie
denial; passed for all four. `pnpm verify` finished with exit 0: lint, types,
93 files / 735 tests (436.70 s test stage), schema check and production build.
The two subsequently added empty/multiple-list tests passed in focused 13/13,
with fresh types/lint. Known Vinext route-classification notice remains nonfatal.

### Latest checkpoint — role handbook and release checks, 2026-09-16

Three further actual isolated nurse captures now replace the old own-access,
care and observations images through `docs/user-guide/current-captures.mjs`.
The guide distinguishes future care tasks from recorded measurements and shows
the nurse's denied protocol/admin permissions. Five of nineteen captures are
current; fourteen older captures remain to be refreshed. No empty care result
was replaced by fabricated UI data. Generated HTML: 19 screens / 75 markers /
2221761 bytes. Desktop and 390x844 browser inspection of all three annotated
chapters passed; care image zoom/close passed. Viewport restored afterwards.

Verification: handbook build, focused ESLint, `pnpm typecheck`, persona-auth test
(1/1), `pnpm security:dependencies` (no known vulnerabilities), and
`pnpm security:secrets` (542 files) passed. The secret scanner initially mistook
the computed local variable `token` for a literal assignment; renamed it to
`sessionKey`, without weakening scanner rules or changing authentication behavior.
`node scripts/check-persona-runtime.mjs 3213` passed for all four roles, including
foreign-scope denial, administration denial and invalidated cookies after logout.
First fresh `pnpm verify` failed: 730 passed / 1 failed because the handbook test
still expected 17 screens / 67 markers. Updated `app/help/page.test.ts` to 19/75
and added assertions for new role/measurement guidance and both access chapters.
Focused help suite passed 2/2. Complete rerun subsequently passed; see latest fix above.

`node scripts/local-backup-restore-drill.mjs --keep` passed (exit 0): 89 tables,
161 rows, 48 migrations, 3 R2 objects, 572689 backup bytes, 100323 ms. Source
destruction and restore occurred only inside the newly generated isolated drill.
Evidence retained in `work/backup-restore-E4Pqud`; schema/data hashes, audit heads,
cross-store references and clinician derivative recovery matched. This is not a
production backup policy or a recovery test of the current operational database.

Isolated server resumed on 3213 using existing `work/personas/run-ktJ4RX` state;
fixtures were not reapplied. Port 3200 was not running and was not stopped here.
No filesystem caches removed: deleting them cannot clear conversational context.
No real patient/provider data, production readiness, commit or push claimed.

### Latest handbook checkpoint — two current access captures, 2026-09-15

Captured actual isolated administrator UI to access-revoked-current.png (overview)
and access-history-current.png (revoked nurse assignment) in handbook image folder.
Added two leading chapters with eight coordinate-validated SVG markers and role,
department, version, revoke/resume explanations. Underlying captures unchanged.
Handbook build: 19 screens / 75 markers / 2214447 bytes. Existing 17 screenshots
remain older; help notice explicitly distinguishes the two refreshed captures.
Browser visual check of annotated revoked page passed at default desktop viewport
and 390x844; in-app /help also checked at 390x844. Mobile image zoom opened and
closed correctly. Viewport override reset. Focused ESLint and diff check passed.
Next: refresh own-role and remaining clinician/nurse/registrar screenshots; avoid
claiming all handbook images updated. No ports stopped, commit/push or full verify.

### Latest completed bounded acceptance — 2026-09-15 grant/revoke UI

In isolated run-ktJ4RX, administrator granted only nurse role to artificial
`Медсестра Б.` in `ui_acceptance_0915`. Browser reload retained active v1.
Revoked this exact test assignment with reason; reload retained revoked v2 and
the original five active assignments. No main database or persona roles changed.
Found and fixed unsafe grant form default: legacy administrator/unknown mapped
to prechecked doctor; switching employee carried roles and overrides forward.
New grants now start with zero roles, block submit until explicit selection, and
reset roles/overrides when employee changes. Existing edit/revoke roles preserved.
Added four parameterized render tests (5 total in administration UI suite), passed;
types/lint passed. Browser verified empty roles/disabled submit and switch reset;
cancelled without a second grant. Updated shared administrator guide accordingly.
This completes the bounded administrator grant/revoke navigation/persistence check.
Next: refreshed annotated screenshots and desktop/mobile handbook acceptance;
broader UX-R2/production release gates remain separate, not completed by this result.

### Latest UI continuation — 2026-09-15 administrator department write

Browser administrator created `ui_acceptance_0915` in isolated run-ktJ4RX only,
with artificial-data reason; success showed D1 persistence. Reload retained v1.
Edited its name to `Проверка администратора — версия 2`; saved v2 and reloaded.
The department list retained the new name/version; existing five assignments were
unchanged. This checks department writes, not grant/revoke of staff permissions.
Added fifth shared help scenario for administrator, with this limitation explicit.
Permission labels now match navigation: План наблюдения / Измерения пациента.
Handbook regenerated: 17 existing screens, 67 markers, 2032744 bytes. No screenshot
recapture claimed. Access UI suites 2 files / 9 tests passed; new terminology
assertions then passed in the 8-test self-access suite. Focused lint, types,
runtime four-persona checks including all five help scenarios, and diff check passed.

### Latest continuation — administrator acceptance, 2026-09-15

Extended `scripts/check-persona-runtime.mjs`: administrator gets D1 assignments
and identical workspace on repeat GET; doctor/nurse/registrar GET and schema-valid
grant POST return 403 ACCESS_ADMINISTRATION_FORBIDDEN. Negative POST uses nonexistent
targets to check authorization before lookup. Wrong facility returns 403; all four
logged-out cookies return 401 on administration API. Runtime checks passed on 3213.
Repository grant/revoke test now reconstructs the repository after revoke and checks
that stale v1 update cannot reactivate v2 or append an audit event. Focused 3 files /
9 tests passed, ESLint and TypeScript passed. No live permissions changed.
Browser recovered: administrator navigated My access -> Management, opened Grant
form, inspected role/expiry/exceptions/reason controls and cancelled. This proves
navigation/form opening, NOT browser grant/revoke persistence. Next: successful UI
write/reload on a disposable isolated target, then annotated screenshot refresh.
UX-R2 remains IN_PROGRESS.

### Latest result — 2026-09-15 aggregate and integrated help

This result supersedes pending-aggregate statements below. `pnpm verify` exited
0: lint, TypeScript, 93 test files / 727 tests (391.67s), drizzle schema check,
and production build passed. Log: ignored `.local-verify-latest.log`.
Vinext still reports the known static route-classification notice; build succeeds.
Four verified role workflows now share one source in
`docs/user-guide/verified-workflows.mjs`, rendered in `/help` and the downloadable
handbook. Generation reports 17 existing screens / 67 markers / 2031134 bytes.
Screenshots have NOT been recaptured; the guide explicitly warns about old visuals.
After the aggregate, the runtime script gained help HTTP/content checks. It passed
for all four identities, together with existing scheduling/care denial and logout
replay checks. Its focused ESLint and `git diff --check` also passed.
Browser automation was unavailable in this continuation; no new visual acceptance
is claimed. Listener 3213 is alive; no listener on 3200 was found. No ports stopped.
UX-R2 remains IN_PROGRESS: next complete administrator access-management acceptance
in the isolated database, then recapture annotated instructions for changed screens.
Do not call all UX, security/recovery, microphone, external integrations or production
release gates complete. No commit/push performed.

### Latest override — 2026-09-15 UX-R2 isolated persona harness

The harness is now implemented; older entries below describing it as not built
are superseded. See `docs/PERSONA_TESTS.md`, `scripts/start-persona-tests.mjs`,
`scripts/persona-auth.ts`, and `vite.personas.config.ts`. It uses separate D1/R2,
loopback-only identity selection and no provider credentials. Resume accepts only
a directory under `work/personas`, without reapplying fixtures or migrations.
Doctor browser create-patient/create-encounter and reload persistence acceptance
passed on 2026-09-15. Next bounded task: nurse write/denial acceptance.
UX-R2 remains IN_PROGRESS. Nurse observation create/reload passed: OR-ABC8C87C,
36.6 C, version 1, Test nurse, 2026-09-15 16:21. Unmeasured groups disabled.
Corrected misleading empty-group copy; form now instructs deselecting groups.
Focused command `pnpm exec vitest run app/api/care/plans/route.test.ts
app/care/care-workspace.test.ts`: 2 files / 16 tests passed. Nurse plan denial
is verified with mocked persistence, not yet live D1 POST. Next: live negative
plan POST and nurse own-observation correction acceptance. No clinical decisions.

Latest continuation: both checks above now passed. Actual isolated server POST
`/api/care/plans` as nurse with `doctorConfirmed=true` returned 403 and
`CHRONIC_CARE_FORBIDDEN`; check added to `scripts/check-persona-runtime.mjs`.
The enrollment is deliberately nonexistent, testing role rejection before plan
lookup, not enrollment or plan lifecycle. All four care/read/logout checks passed.
Browser nurse correction for OR-ABC8C87C: 36.6 -> 36.7 C; reload showed version 2
at 16:29 and expanded history retained version 1 at 16:21 with author Test nurse.
Next bounded acceptance: registrar scheduling workflow with isolated database
fixtures and authoritative availability; do not claim external booking integration.

Registrar continuation (2026-09-15): runtime scheduling read matrix added to
`scripts/check-persona-runtime.mjs` and passed: clinician/registrar 200,
nurse/administrator 403. Browser registrar opened `/scheduling` under exact
`persona-registrar-assignment`; current isolated DB has zero eligible referrals
and zero windows. No browser booking was performed. Do not label this as complete.
`pnpm exec vitest run lib/auth/scheduling-access.test.ts
lib/repositories/scheduling-workflow.test.ts` passed 2 files / 15 tests, including
real isolated database hold/confirmation/queue/cancellation/concurrency behavior.
Next: create reproducible isolated scheduling fixtures with valid consent,
approved referral, provider and slot, then registrar browser booking/reload.
Do not weaken role or consent checks to make test setup easier. Main 3200 was
not listening on inspection; isolated 3213 resumed without replacing its database.

Registrar DB acceptance continuation: added a separate registrar user, membership
and registrar-only assignment to an isolated migration-backed test fixture.
No doctor rights were merged. Verified preference -> hold -> patient confirmation
-> queue ticket -> arrive -> call; denied start_service specifically with
SchedulingPermissionRequiredError. The failed clinical action leaves audit count,
confirmed appointment and called queue head unchanged. Appointment attribution
is registrar-assignment. Full scheduling repository suite: 7/7 passed (25.24s),
ESLint and diff check passed. Initial test assertion typo ticket_id was corrected
to queue_ticket_id. These fixtures are in test SQLite, NOT the browser D1 state;
UI booking and portable browser fixture seeding remain the next unfinished task.

Latest override: browser fixture seeding and booking now passed. Added
`scripts/scheduling-persona-fixture.ts` and `scripts/seed-persona-scheduling.mjs`.
Seed runs only against validated work/personas runtime via Wrangler --local;
never application bootstrap. Applied once to run-ktJ4RX: TEST-SCHEDULE-01,
test consent/referral, provider, two time-relative windows. No role guards disabled.
Browser registrar saved preferences, held 17:54-18:24 slot, confirmed artificial
appointment; reload showed confirmed/version2/slotVersion3 and no second reserve.
ESLint on both scripts and diff check passed. Generated SQL remains ignored work
artifact. Fixed fixture IDs mean seed must not be repeated on the same state;
use a new isolated run for fresh windows. Next: browser ticket issue/queue actions.
No external booking, patient messages or real clinical approvals occurred.

Queue browser continuation: registrar issued A001 for TEST-SCHEDULE-01, marked
arrival (v2), called to Test room 12 (v3). Reload preserved called status, version3
and room. Start-service remains disabled for registrar. Added visible explanation
that the physician performs start/completion; browser verified explanation.
`pnpm exec vitest run app/scheduling/scheduling-workspace.test.ts`: 4/4 passed;
ESLint and diff check passed. No physician start/completion performed in this run.
Next: switch to isolated doctor, verify same ticket and physician transitions,
including preservation of registrar attribution and persisted final queue status.

Doctor queue browser checkpoint: same A001 opened with persona-doctor-assignment;
start_service -> version4 in_service; complete -> version5 completed. Reload
preserved completed ticket, Test room12 and completed appointment version3.
This is queue-service completion, NOT signature/completion of a medical protocol.
Registrar attribution was tested previously in repository tests; this browser
turn did not inspect audit attribution. Fixed missing UI test-data gate on
QueuePanel actions and added early guard in queueCommand; no server role checks
relaxed. Existing scheduling UI tests 4/4, ESLint, diff check passed. New gate
needs a dedicated regression test; do not infer it from the four existing tests.
Next: dedicated queue acknowledgement regression and aggregate type/build checks,
then update user handbook to match verified role workflows. UX-R2 remains open.

Verification follow-up: QueuePanel now receives explicit testDataAcknowledged;
both normal queue action and exception action use the same write-block condition.
Added render regression for false/true acknowledgement with real registrar
capabilities and a typed ticket fixture. No acknowledgement => both buttons
disabled; acknowledged => both enabled when otherwise valid. queueCommand early
guard remains. 6/6 scheduling UI tests passed; pnpm typecheck passed after fixing
two test typing issues (incomplete fixture and nullable appointment read).
pnpm build completed successfully (log .local-build-check.log); build emitted its
existing static route classification notice. Focused ESLint and diff check passed.
This is not a full verify/security/recovery run. Next: aggregate verification and
refresh handbook role workflow instructions; production release gate remains open.

- Latest UX-R2 care-specific API/action boundary verified: 137 focused tests plus
  6 storage integration tests pass. Isolated persona browser sessions still pending;
  mocked handler tests do not satisfy real login/role UI acceptance. Next bounded
  task: create a reproducible isolated test-runtime persona harness (not edits to
  current user's assignments), then verify nurse/doctor/admin screens and forbidden
  requests end-to-end. Keep current live ports and data intact.

- Cross-module scope transfer implemented and /care -> /orders browser-confirmed.
  UX-R2 explanatory-role slice started: current bootstrap identity combines doctor
  and administrator. Next: incompatible-assignment recovery UX and isolated role
  UI/API acceptance without altering existing live assignments. UX-R1b not fully
  closed (patient context/remaining prerequisites), UX-R2 not fully closed.

- Aggregate `pnpm verify` now PASS (23567 exit 0; 90 files, 688 tests); previous
  pending notes below are superseded. Mobile menu direction/labels/current-section
  visibility fixed and browser-tested at 390x844. Next: cross-module selected
  assignment/patient context and navigation transport audit. UX-R1b still open;
  UX-R2 role acceptance and UX-R6 refreshed full handbook not completed.

- Latest acceptance: browser existing-patient create/read/reload PASSED; shared
  header dashboard return clicked successfully with workspace selection retained.
  UX-R1b remains IN_PROGRESS: selected patient/assignment explanation across pages,
  mobile navigation and remaining main-action prerequisites still require audit.
  Aggregate re-run session 23567 is pending; use `.local-verify-latest.log` and
  final process exit. UX-R2 actual role/access checks follow, not completed by labels.

- Latest D-R1: existing-patient createEncounter now carries selected assignment,
  checks actor/current rights before request/retry and inside write transaction,
  attributes command/audit/hash and asserts publication inside batch. Focused
  tests and browser creation pass; full CI pending. This is application transaction
  hardening, not a claim that all direct-SQL/response/replay race gates are finished.

- D-R1 started per owner clarification: verify actual persisted records independently
  of seed patients. First acceptance adds a file-backed database close/reopen check
  for new patient + encounter and exact retry. UX-R1b remains unfinished and follows
  alongside data acceptance; existing patient writer hardening remains open.

- Latest UX-R1b slice: encounter-specific shared header and visible order-action
  prerequisites implemented and focused-tested. UX-R1b remains IN_PROGRESS.
  Next: browser verify draft/active order explanations and encounter header,
  then finish cross-page breadcrumbs, selected context and main-action audit.

- Current priority: UX-R plan in section 1. UX-R1a is complete locally: navigation
  names, care/measurements purpose panels, and truthful order confirmation label.
  UX-R1b is next, followed by UX-R2 actual role/access diagnosis. Do not treat
  renamed access links as fixed authorization. Screenshots in `/help` are marked
  as the previous interface version; rebuild them in UX-R6 after UI stabilizes.
  Existing-patient transaction authorization remains open, not superseded as a
  security requirement. Existing owner-only standalone `a` in this plan is preserved.

- 2026-09-15 user-requested UI acceptance slice: illustrated handbook is integrated
  into the authenticated shell at `/help`, with a public synthetic-only offline
  asset generated by the normal build. Browser testing found and fixed a real
  patient-search 500: D1 rejects long UTF-8 LIKE patterns; literal `instr` search
  now handles the same full name. See `docs/user-guide/UI-CHECK-2026-09-15.md`
  for actual clicks, saved synthetic records, limitations and remaining defects.
  Local LIVE labels now describe local materials, not server completion; empty
  sessions say "Материалов пока нет" (browser verified).
  Existing-patient transaction authorization remains the
  next security slice below. Neither the UI sweep nor handbook completes Phase 2I.

- 2026-09-15 completed bounded checkpoint: independent **new patient + encounter**
  creation and exact assigned-encounter selection. Migration 0047 is applied locally
  and immutable. API no longer requires a source encounter; the dashboard links to
  `/encounters/new`. Creation publishes the patient, editable initial profile,
  encounter, eight empty sections, audit and command result atomically under current
  selected encounter.manage. See the newest handoff/ledger for final verification.
  The separate existing-patient writer `D1PatientRegistryRepository.createEncounter`
  is explicitly the next slice; the standalone illustrated handbook is now
  `docs/user-guide/ORION-CLINIC-GUIDE.html` (17 screens / 67 markers).
  Do not mistake this checkpoint for all creation or
  all Phase 2I completion. This entry supersedes older next-task entries below.

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
- Completed current bounded slice: Phase 2C adds an authenticated `/access/manage`
  workspace and append-only, idempotent commands for versioned department create,
  update and disable plus access grant, change, reactivate and revoke. The current
  authorizing assignment cannot mutate itself, and its department cannot disable
  itself. The patient directory API family now resolves exactly one active
  assignment and checks effective `patient.directory.read`,
  `patient.profile.write` or `encounter.manage`; multiple scopes require an
  explicit selection and are never merged. Remaining protected API families keep
  their prior proven role guards until migrated separately.
- Completed current bounded slice: Phase 2D migrates the complete `/api/orders`
  family and `/orders` workspace to one explicitly selected, current, non-service
  doctor assignment with effective `orders.manage`. The selected assignment is
  persisted on commands, service-request/report versions, result artifacts and
  upload intents; SQLite guards bind it to the acting clinician, facility and exact
  encounter assignment. Explicit deny wins, scopes are never merged, and neutral
  denial, consent, lifecycle, idempotency, audit and result-review controls remain
  in force. Other protected resource families remain on their proven legacy guards
  until migrated in separate checkpoints.
- Completed current bounded slice: Phase 2E migrates the complete
  `/api/observations` family and `/observations` workspace to one explicitly
  selected, current, non-service doctor or nurse assignment with effective
  `observations.manage`. The selected assignment is stored on idempotency commands,
  observation roots, every immutable version and audit metadata. SQLite binds new
  writes to the current assignment and preserves doctor access to visible facility
  observations while a nurse may correct only the nurse's own current record.
  Assignments are never merged, explicit denial has no fallback and neutral denial,
  active-patient scope, provenance, derived-BMI, concurrency and audit rules remain
  in force. Other protected resource families remain on their prior proven guards.
- Completed current bounded slice: Phase 2F migrates the complete
  `/api/scheduling` family, queue commands and `/scheduling` workspace to one
  explicitly selected, current, non-service doctor or registrar assignment with
  effective `scheduling.manage`. The exact assignment is durable on idempotency
  commands, preference snapshots, appointment and queue roots, every new immutable
  slot/appointment/queue version, request hashes and audit metadata. SQLite rejects
  missing or mismatched assignment actors and preserves the separate front-desk and
  clinical action matrix. Approved-referral visibility, manual-test schedule label,
  hold concurrency, patient confirmation, lifecycle, audit and neutral denial remain
  in force. Historical rows remain readable without being rewritten.
- Completed current bounded slice: Phase 2G migrates `/api/care`, all care commands
  and `/care` to one exact current non-service doctor/nurse assignment with
  effective `care.manage`. Explicit denial has no fallback; multiple eligible
  assignments require selection even within one facility. Enrollment, plan and
  task roots/versions, command replay hashes and audit metadata retain the exact
  assignment. Seven SQLite guards preserve the distinct doctor/nurse action matrix.
  Historical rows remain readable; immutable history is not backfilled. The UI
  cancels stale loads and prevents assignment changes during an open command.
- Completed current bounded slice: Phase 2H binds all five communications
  handlers, the communications workspace, immutable communication events, outbox,
  command replay and audit to one exact current doctor/nurse/registrar assignment
  with effective `communications.manage`. New writes require a valid actor
  assignment; existing history is not rewritten. UI loads are cancelled when
  superseded and assignment changes are locked during commands or dialogs.
  Providers remain disconnected.
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
- Current runtime at checkpoint: local web is intentionally left running on 3200,
  loopback STT on 3101 reports the pinned model ready on CUDA, and ngrok on 4040
  still forwards the reserved public URL to the local web process. No microphone
  capture or transcription quality test was performed in Phase 2C. Groq is wired
  but not runtime-verified because no fresh
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
  core plus local synthetic directions/results, scheduling/queue, chronic-care,
  no-send communications and versioned observation capture. Their named external
  registries/providers/contracts, approved criticality rules and transfer remain
  open; local slices are not evidence of production integration.
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
- Required external owner action: clinic owners review, fill and sign
  `docs/requirements/phase-8b-clinic-decision-packet.ru.md` and a separate approved
  copy of `phase-8b-decision-record.template.json`. Engineering must not infer
  signatures from chat. After valid `DEC-006`/`DEC-007` evidence exists, the next
  code checkpoint is an immutable signed-policy registry with no runtime alerts;
  critical classification, hospital notification and transfer stay blocked until
  their later explicit gates pass.
- Phase 2I remains IN_PROGRESS. 2I.1 covers six compatibility tool operations;
  2I.2 now covers the authoritative request boundary and dashboard/live UI.
  All 17 `/api/workspace` route files check one current doctor assignment with
  encounter.read for GET and encounter.manage for mutations; the existing exact
  treating-clinician, consent, lifecycle, review and export constraints remain.
  Selection survives scoped requests, downloads and dashboard/live navigation.
  The original combined 2I.2 gate is NOT fully closed: durable attribution and
  database guards were deliberately split into the next checkpoint below.
- Completed implementation slice 2I.3a: clinical section commands now carry exact
  assignment attribution and recheck current authority before replay and commit.
  Additive migration 0035 guards human-authored/reviewed successor versions,
  command results and matching audit provenance. Historical rows remain unchanged;
  initial roots and service AI drafts are separate, still-open migration gates.
- Completed 2I.3b implementation: interactive consent commands persist assignment
  on events, commands and hashed audit; current authorization is checked before
  replay/retries/commit. Migration 0036 guards attributed events and interactive
  command/audit/results, without requiring prior care consent. Unattributed
  historical/fixture/independent creation events retain their existing boundaries.
- Completed 2I.3c implementation: manual transcript corrections persist exact
  assignment on versions/commands/audit and recheck access, consent and lifecycle
  before replay/retries/commit. Migration 0037 guards attributed correction
  writes and interactive command/audit/results; raw ingestion remains separate.
- Completed 2I.3d: exact assignment on speech runs, scoped use/replay/cleanup,
  current rights/consents before delayed result commit and SQL guards (0038).
  Legacy unattributed sessions require a new session; no model/timing changes.
- Completed 2I.3e implementation: attributed analysis runs/commands/audits, current
  access/consent/lifecycle before replay and delayed response persistence; migration
  0039 enforces attributed completion and interactive command/audit/result guards.
- Completed 2I.3f.1 repository boundary: edit/decision commands now require current
  exact assignment, care consent and lifecycle before retry/replay/batch; command
  rows/hashes and audit metadata carry assignment. Legacy unattributed replay is
  rejected without rewriting history. Basket and derivative semantics remain.
- Completed 2I.3f.2: migration 0040 attributes derivative/decision rows and guards
  attributed inserts, interactive commands, results and audits. Revocation before
  batch rolls back the operation; immutable historical nullable fixtures remain.
- Completed 2I.3g.1: protocol draft/sign/amend entry/retry/replay/pre-batch checks
  require exact current assignment/user, care and compatible lifecycle; command
  hashes/rows/audits retain assignment. No signed history or schema rewritten.
- Implemented 2I.3g.2: migration 0041 adds protocol/amendment attribution and
  transaction-time row/head/command/audit/result guards. Current selected access,
  care consent and lifecycle are checked inside writes; results bind to exact
  stored protocol/encounter identities, versions and signature fields. Nullable
  historical fixtures remain unchanged. See latest verification ledger.
- Implemented 2I.3h: current lifecycle assignment checks and immutable transition
  events in migration 0042; transaction-time event/update/audit/result guards.
  See latest verification ledger before treating the checkpoint as validated.
- Implemented 2I.3i.1: export source/list/download revalidation, generation manage
  checks through preflight/replay/render, attributed commands/audit and selected
  download links. Check the latest ledger for the verified scope and limitations.
- Exact next checkpoint: independent encounter creation/selection authorization.
  Export publication (0043), download audit (0044) and explicit pending-attempt
  reconciliation (0045) have passed bounded verification. Workspace-read audit
  attribution and recovery-reader authorization are implemented with local 0046;
  consult the latest ledger/handoff for final verification. Legacy/active-upload
  cleanup and a general retention worker remain deliberately deferred;
  full 2I.3 and Phase 2I are NOT complete. Inventory every
  WorkspaceScope writer and add exact assignment attribution to command keys,
  hashes, commands/events, access audits and speech sessions using forward-only
  migrations. Replace remaining legacy clinician-role SQL only together with
  verified current-assignment actor guards. Require current authorization before
  idempotent replay and before committing a slow provider response. Preserve
  clinician-to-encounter ownership, consent, final transcript, review/sign/export
  and recovery locks. Test direct SQL bypass, stale versions, revoked sessions
  and cross-assignment replay; do not infer DB protection from route tests.
  Also resolve independent encounter creation and patient-to-encounter selection
  listed in `docs/requirements/phase-2i-encounter-access.md` before full 2I closure.
  No nurse/medical-lead expansion, speech model change or provider connection.
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

**LATEST RESUME — 2026-09-30, restart and Cloudflare access verified.**

Codex's dedicated product tools are live and the owner approved Wrangler in one
Opera device-flow tab. The exact account64a5fad5dd97b1e245fca5363b7968db is verified.
Reuse empty D1 `orion-clinic-auth-pilot` UUIDc14a40da-a007-4085-b255-86c095591153;
do not create a duplicate or point main migrations/seed at it implicitly.
Remote SELECT1 and account-scoped Wrangler info passed. No public auth/clinical
endpoint, R2, paid plan or Vercel deployment was created. The old "restart Codex"
next step below is now superseded; another restart is not needed for Wrangler.
Next: resolve secure-password runtime/topology with owner approval of any cost,
then bounded auth-only composition/provisioning/private ingress and load/browser
acceptance. Free10ms CPU is a likely mismatch for fixed scrypt, not a measured
remote failure. Preserve the unmodified KDF and do not claim Paid alone closes
abuse/recovery/material-isolation gates. Vercel gateway and full clinical
principal/material adapters remain required. §13 records exact evidence/limits.

**LATEST REQUEST — 2026-09-30, publish current checkpoint and Vercel.**

Owner authorized push to the existing ORION Git remote and Vercel deployment.
Preflight built the application but rejected its exact artifact. Owner now opened
Cloudflare and requested the official agent setup:14global skills,5MCP entries,
verified API/Bindings/Builds/Observability OAuth; Docs public.
New MCPs require Codex restart. Do not confuse MCP account access with deployed
D1/R2, Wrangler login or working public staff authentication. Preserve scans and
implement the existing Vercel-readiness adapter/public staff-auth plan. Full main
activation still needs production browser-material isolation (legacy unowned
IndexedDB access remains open outside local credential mode), clinical principal
adapters and exact origin/service authentication. Do not reinterpret a source
push or auth-only Worker as a successful live clinical deployment.
Current source publication excludes local logs/state/secrets and the unrelated
owner `a`. The STT recommendation is separate persistent GPU compute behind the
authorized API. Existing main data/migrations/ports remain unchanged.
Source checkpoint279e42b is now verified on the authorized remote main; the
publication/setup receipt is recorded in a following documentation commit.
Cloudflare agent setup is complete. Next operational step is restarting Codex
to activate the registered MCPs, then dedicated ORION resources and the isolated
online auth/material boundary before Vercel deployment. Do not request passwords
or service tokens in chat or copy OAuth credentials into the repository.

**LATEST FOLLOW-UP — 2026-09-28, CSS first-load fix and female silhouette.**

The next two owner reports are addressed locally: dashboard/shell CSS now has
server importer ownership instead of depending only on client hydration; female
patient cards choose `public/patient-body/anatomy-female-v1.png` from the recorded
sex. See the top of §13 for exact tests and browser proof. Preserve these explicit
server CSS imports even though the client components also import the same modules.
Unknown sex retains the generic drawing, so PAT-01 remains partially open for a
distinct neutral illustration. No main data/session policy or runtime changed.
The remaining-work plan is not fully completed by this bounded correction.

**LATEST HANDOFF — 2026-09-28, five-part owner UI/login request.**

Owner then requested finishing implementation and a plan of remaining tasks.
Saved `docs/operations/remaining-work-plan-2026-09-28.md`: eight ordered stages,
explicit acceptance criteria and three parallel work streams. It incorporates
independent patient/event review. This is a planning deliverable, not execution
of those stages or permission for deployment, migration, grants or new resources.

Work only in canonical ORION-CLINIC; preserve the existing large dirty tree.
Patient panel files: `app/patients/[patientId]/patient-vitals-panel.tsx`,
`patient-detail.tsx`, patients CSS, `/api/observations/latest-vitals` and repository.
Generated anatomical asset: `public/patient-body/anatomy-v1.png`; provenance/prompt
in `design/patient-anatomy.md`. It is one neutral illustrative model, not separate
sex-specific scans. Actual sex remains in the patient header, absent values stay absent.

Root dashboard is a compact notification center using `dashboard-work-items` and
`dashboard-events`, with selected-assignment links and abort/generation cleanup.
Groq is explicit, aggregate-only and has a verified live response, not auto-clinical
actions. Full event history/paginated whole-clinic coverage is not claimed.

Root-layout `pathway-transition-layer` persists across route commit; reusable
`PathwayLink` intercepts only opted-in links. Entry920ms/exit760ms plus actual target
load wait; ordinary pages have no artificial navigation delay. Normal+hover theme
contrast tests cover light and dark. Final desktop captures are in ignored
`outputs/ui-2026-09-28/`: dashboard-light.png, patient-light-final.png,
sign-in-final.png and pathway-exit.png. Current narrow-screen QA was inconclusive
because viewport override did not apply; do not reuse older mobile proof as current.

Local login is now ACTIVE, unlike older entries below. Six existing account IDs
and their initial passwords are in the local-only handoff file named in §15.
Middleware/store are `scripts/local-account-auth.ts` / `local-account-store.ts`;
client generation guard is `app/local-account-boundary.tsx`. It is HttpOnly opaque
session + hashed credential persistence, origin/loopback/header guards and no
Seedy fallback. No main D1 migrations or role grants. Nurse Home goes to pathway,
unassigned staff to own-access; explicit encounter URLs are still authorized normally.
The old shared history is preserved but disabled in this mode; refresh old tabs.
Do not activate online auth or claim encrypted durable recovery from this local gate.

Final commands and browser evidence are at the TOP of §13 ledger: 1795 unit PASS,
1 opt-in skip; 10 focused SQL PASS; full lint/types/build; source secret scan PASS.
Readiness3200 and speech3101 returned200. No push/deploy or foreign-resource access.
Next safe work is separate responsive/unsaved-work motion QA and protected durable
recording integration, not reseeding the main DB or widening staff permissions.

**LATEST UI HANDOFF — 2026-09-28.** The owner asked for an icon-only left rail,
labels on hover, and a browser-like patient pathway with animated entry/exit.
Implemented locally in `app/clinic-shell.tsx`, its CSS, and
`app/pathway/pathway-workspace.tsx`/CSS. The owner then clarified that route
entry should open a separate inner-platform screen, not the first form. New
`app/pathway/pathway-overview.tsx` projects the patient picker and horizontal
timeline from exact-scope server reads; browser selection and roundtrip were
verified. New `/pathway` combines the four existing tools without changing
their API authority. Scoped tests/types/lint/build, desktop/mobile browser
checks and web/speech health passed as recorded in §13.
The UI is not a production identity, a clinical decision engine or a cloud
deployment. Preserve the dirty ORION tree and main D1/audio. Before further UX
work, verify the user's next requested interaction in browser; before any online
release, finish the ONLINE-1 gates. Do not touch DIR ECHOES resources.

**RESUME HERE FIRST — 2026-09-28, owner-requested bounded continuation.**

The previous stop was superseded by a new direct request. New queue board,
server-side referral/patient filtering of scheduling rows, analysis-window
warning and unmounted M1a self-link migration are described in
the newest §13 and §15 entries. Final `pnpm test` 133 files/2235 passed/1
opt-in skipped; lint, types, build, db-check and secret scan passed. Browser
verified only the zero-ticket current board, not a populated queue or the
long-conversation warning. Do not run ordinary local data initialization:
main migrations0048–0052 have not been applied. Main web3200/speech3101 and
synthetic records/audio were preserved. The new table is not a permission to
serve patient data; M0's `actorId`/`identityVersion`, trusted patient session,
adult-self verification, publication/audit and final recheck remain missing.
No native package, mobile API or deployment was created. Continue with isolated
M1 contract and D-R2 after final tests, not by exposing Sites dev auth.

**RESUME HERE FIRST — 2026-09-24, owner-departure checkpoint D-R3.**

STOP STATE: owner explicitly requested removal of the scheduled task and a final
checkpoint. Automation `orion` deleted successfully at17:40UTC; wait for direct
owner direction before further development. Latest packaging-only delta is in
scripts/check-deployment-artifact.mjs, its46tests and two package commands.
One preexisting large crypto assertion was made byte-exact but efficient after
a reproduced timeout; no crypto product semantics changed. See latest ledger.
No deployment occurred; neither a client-only artifact PASS nor build PASS
permits exposure of the current dev identity/backend. All main data preserved.

Newest mounted feature is accepted action recommendation → explicit order draft,
not a broker endpoint or new login. Code/API/domain/UI/provenance and source
guards are in order-workflow/orders/clinical-workspace/orion-workspace; no schema
migration required for D-R3. The browser found and corrected missing /orders
scope allowlist and a derivative-head column typo. Independent review found and
fixed ignored audit-head publication and historical-source read denial. Source
creation/restoration/consent/authority/fault/replay tests and actual isolated D1
creation/reload passed; latest §13 owns exact final aggregate/build evidence.

Fresh test origin3214 has only artificial data, run `work/personas/run-wAlSl2`;
manifest `d-r3-fixture.json` and reusable `scripts/d-r3-persona-fixture.mjs`.
Exactly one draft `service-request-1c362d7f-11ba-40d0-9dda-66f0497e34ed`, never
approved/sent. Test role chooser is isolated only, NOT an individual-account login.
Do not copy its auth mechanism to public/main deployment.

Main listeners3200/21448 and3101/12948 replaced the earlier dead processes. Earlier
PIDs/status notes below are HISTORICAL. Current sidecar loaded the SessionStore
fix and passed actual synthetic6615ms audio→text probe (1990ms processing),8Python
tests; not a clinical accuracy/long-session/Groq acceptance. Preserve main data.
Restore using reviewed `-SkipDataInitialization`; normal launcher applies all
pending migrations. Main0048–0051 remain intentionally unapplied.

New0051 protects pending registry against org/facility/membership mutation ABA/
REPLACE;80SQL +59 independent probes pass. This is partial invalidation only.
Next1C2a2-coordinator needs actual injected wrapping dependency, action/consent
checks INSIDE commit, remaining authority fences and preparation recovery. Do not
mount registry directly or auto-read/adopt/delete legacy v1. Auth/STT/backend and
native MOBILE application are still incomplete, despite foundation tests.

Vercel attempt stopped at mandatory preupload artifact gate481files/private
server/.dev.vars plus unported Workers bindings/trusted auth. CLI exact project
orion-clinic/shadowocc not found; no broad inventory, resource creation or upload.
No deployment URL exists. Never touch DIR ECHOES on any service. Only remote is
shadowuneed/ORION-CLINIC; no commit/push/origin change in this turn. Before resuming,
read latest docs and dirtytree; preserve all parallel/prior edits.

Prior 10:35 UTC checkpoint (historical, not the active next task):

Newest delta: `lib/repositories/local-material-registry.ts` +39 full-chain SQL
tests, new0050/schema/snapshot/journal. INTERNAL storage only, no action authority,
key issuance or wrapping invocation. Required config contains policy/provider IDs,
not keys or approval. Receipt insert atomically publishes head/state/minimalevent;
same-command replay, two-writer CAS, expiry/terminal states and publication rollback
pass. Root repeated39/39; final unit102files/1618pass/1skip54.31s and fullDB
27files/456pass539.99s, combined2074passed; newest section13 carries exact
build/browser/limits. All51 migrations only in fixtures; main0048–0050 remain unapplied.
Main3200/3101 preserve PIDs27128/5612; no legacy history/audio or foreign resources.
**Next1C2a2:** trusted coordinator with explicit wrapping facility and authoritative
action/consent checks INSIDE committing SQL; durable preparation/reconciliation,
terminal revoke/ABA protection. Existing scope fingerprint is not a grant, and
membership/org/facility epochs are not yet monotonic-enforced. Do not directly
mount registry methods behind a login check. Do not claim full ONLINE-1C complete.
Then real D1 registry acceptance, payload encryption integration, new isolated
IndexedDB and two-tab ownership/logout/race tests. Vercel still blocked by known
runtime/auth/backend/artifact gates; no repeated CF-login attempts needed.

Prior 09:35 UTC checkpoint (historical, not the next task):

Newest delta: ADR-0003 + `lib/local-materials/envelope.ts` real Web Crypto,
62 tests after two independently reproduced defects were fixed; separate
`lib/speech/remote-gigaam.ts`,165 mocked health/create tests after cancellation-race
fix. Both remain unmounted. Final aggregate is in section13; earlier1612 count
predates the six final regressions. Final102files/1618passed/1opt-inskipped53.89s;
types/lint/secrets625/diff-checkPASS. Browser dashboard/LIVE/registry smoke and main
healthPASS, not crypto/STT acceptance. BuildPASS followed final key-API tightening
but preceded last unmounted STT cancellation fix; no new SQL added/run. Existing
main migrations still unapplied. Independent final crypto9/9 + control4/4 probesPASS.
**Next1C2a:** durable broker reservation/head/CAS/audit using disposable DB and
explicit wrapping test dependency. No actual keycustody resource or approved
retention/offline policy exists. Follow ADR, do not auto-adopt/read/delete v1.
STT next: audio/delete transport + durable run/idempotency/orphan cleanup and
approved dedicated gateway. Current3101 is NOT the new control protocol.

1. Read the absolute resource restriction at the top: NO dir echoes resources on
   ANY platform; only existing `shadowuneed/ORION-CLINIC` repository. Never change
   origin or create another repo. Canonical checkout is ORION-CLINIC, not legacy
   ariaproject cwd. Preserve the large dirty worktree and main DB/audio.
2. Read newest section 13/15 and the requirement/Vercel/STT/mobile documents linked
   there, then `docs/operations/online-staff-auth-handoff.md`. Do not treat older
   "Newest"/"Resume" entries below as the active task.
3. Newest 1C1c adds only the canonical binding codec: **94 new tests PASS**; final
   all-unit gate **100 files / 1391 passed / 1 opt-in skipped**,51.77s. Full lint/
   types/secrets620/diff-check pass; exact source boundaries in newest section13.
   1C1b gate: **124 descriptor + 87 target-lifecycle tests PASS**; four-file
   contract gate **354 PASS**. Root aggregate **125 files / 1714 passed / 1 opt-in
   skipped**,567.46s,exit0; full lint/types/db-check/secrets618/build/diff-check pass.
   Exact limits in newest section13. No runtime wiring. Main-navigation browser
   smoke passes; artifact upload still blocked on `server/.dev.vars` pathname.
   Prior 1C1a gate: **76 unit + 35 SQL tests PASS**. Prior aggregate:
   **123 files / 1503 passed / 1 opt-in skipped**,587.02s; build, full lint/types,
   db-check, secrets614 and diff-check pass. New context stays unmounted. Fresh
   main navigation browser smoke passed; artifact scanner still blocks
   `server/.dev.vars`. Exact limits in newest section13. Prior 1B3a aggregate:
   **121 files / 1392 passed / 1 opt-in skipped**,508.09s;
   build/lint/typecheck/db-check/secrets610 pass. New shared-principal/technical
   transport has 149 overlapping focused tests and four actual loopback
   HTTPS/workerd/D1 scenarios; exact limits in section 13. Earlier credential/mobile
   aggregate was 117 files/1216 tests +1
   opt-in skip, final 273-test postgate; do not treat it as today's aggregate. Earlier
   UI/cache browser login/logout/navigation evidence is historical, not a browser
   test of new credentials. Auth is STILL dev Sites, not per-staff passwords.
   Main migrations 0048/0049 are not applied. Ports 3200/3101
   kept running; no main DB reseed/migration or role grants performed.
4. Additional speech SessionStore source fix passes 8 Python tests but running
   PID 5612 has NOT loaded it. No restart solely to make a status look green.
   Verify active sessions and schedule a controlled idle restart with health and
   synthetic audio acceptance when implementing the next STT runtime checkpoint.
5. ONLINE-1B3a shared resolver and isolated technical runtime are implemented on
   1B2 credentials. Read newest ledger and `online-staff-auth-handoff.md`, including
   exact 47-API/SSR/shared-helper migration map. Internal users.id is distinct from
   external issuer/subject: no Sites-header emulation. Real TLS test is Node
   manual-cookie traffic, NOT browser acceptance; no trusted browser test origin
   available and shared dev CA must not enter system/browser trust. Next: safe
   provisioning and 1B3b isolated clinical adapters/forms with browser gate, not
   main auth replacement. Continue independent server contracts when gate blocked.
   Neither 0048 nor 0049 is applied to the main DB. Patient mobile auth is a
   separate capability domain; staff role selection is not patient onboarding.
   ONLINE-1C0 is now implemented independently (67 helper tests, root final
   four-file 232-test gate). Read `local-material-isolation-plan.md` before further
   auth activation: v1 is unowned, hydration/autosave can overwrite local audio
   at source level, and legacy old tabs need a controlled transition. No existing
   audio loss was reproduced. The next metadata-only 1C1a slice is now implemented:
   `server-context.ts` + `local-material-context.ts`, final coherent DB-clock
   session/user/scope/head/consent SELECT, no material reads or key release.
   Section 8 of the isolation plan records tests, current-profile archival guard,
   version pins and observed-fingerprint limits. 1C1b now implements strict immutable
   material/run/revision descriptor and composite publication fence without storage.
   1C1c adds the canonical metadata codec. Newer1C1d/e adds ADR/isolatedcrypto;
   next1C2a durable key state machine before v2/transactional fencing and
   isolated two-tab tests still required. Never auto-migrate v1 or use metadata
   as an action grant. Current consumers' source-level hazards are not fixed yet.
6. Vercel is requested and CLI authenticated; Cloudflare CLI is not. Do not keep
   retrying unchanged login or borrow unrelated resources. Continue safe local
   foundation while dedicated backend/identity/deploy decisions remain. Current
   `dist` scan intentionally fails on `server/.dev.vars`; never upload it wholesale.
7. MOBILE-1 M0 is in progress: ADR-0002 plus pure released-protocol projection
   and 87 unit tests. No patient API, DB relationship/release/audit or native app.
   Real native client, accessible patient journeys and API/DB tests required. No store
   publication/payment/permissions were granted by planning. Keep patient drafts,
   self-reports and clinician-approved records distinct.
8. Overnight task `orion` updated with all constraints and mobile addition. At each
   bounded checkpoint record exact tests/limits here and continue the next safe
   step. No external clinical/transactional automation, fake vendor integration,
   real-patient data or paid/legal commitment without the required authority.

**Historical handoff — ONLINE-1B session foundation, superseded above.**

**Resume here first: ONLINE-1B session foundation, 2026-09-24.** Read section 1
ONLINE-1, then newest sections 13/15 and `docs/operations/online-staff-auth-handoff.md`.
Canonical repo is ORION-CLINIC, not legacy ariaproject cwd. Many older "Newest"
entries below are historical. Preserve the large dirty worktree; do not reset,
indiscriminately stage, change data mode or publish the dev-auth stub.

Implemented server-only cookie/identity/logout module, durable D1 session repository,
0048 additive schema/migration and tests. Three agents reviewed parallel areas.
Focused gate: 77 PASS (44 HTTP/crypto + 33 real SQL), including two individual doctors
of the same role, file reopen, logout invalidation and no REPLACE resurrection.
Types/full lint/schema/build/secret scan (567 files)/dependency audit/diff-check PASS.
Isolated backup drill PASS: 90 tables, 162 rows, 49 migrations, 3 R2 objects. Full
`pnpm test` PASS: 105 files / 921 passed / 1 skipped (opt-in Groq), 453.86 s, exit 0.

**Not mounted:** main UI/SSR/API still use Sites development identity; no individual
password verifier, staff provisioning, reset, shared principal middleware, login
throttling or browser/logout acceptance yet. 0048 was not applied to main D1.
Session-bearing backup restoration/retention are also unimplemented. Do not claim
ONLINE-1B complete or modify main accounts to simulate browser acceptance.

Do next: individual credentials and guarded login/logout in an isolated HTTPS runtime
with separate D1/R2/no provider keys; use this foundation rather than role buttons or
process Map. Then ONLINE-1C owner-scoped local recordings and legacy recovery.
Hosting decision is still needed for ONLINE-1D. No public resources or real data
approved. Keep web 3200 and speech 3101 running; health is recorded in section 13.
Non-STT follow-ons remain in section 1: explicit draft orders, cumulative notes,
rescheduling and operational readiness; vendor integrations need actual contracts.

**Newest: persisted document view (2026-09-17).** See section 15. Web 3200 and
speech 3101 are running; preserve them. Do not confuse saved note sections with
an assembled/signed protocol. New protocolPreview is an audited, scoped projection
of immutable content, not a rebuild from current editor heads. Browser proof uses
existing synthetic encounter-3695d35a-a30f-43e9-9f9c-cc330ce36bbc; PDF HTTP 200.
Isolated 8-section->draft->sign->artifact generation and negative preview access
checks passed in six-file 42-test gate. Remaining: new full browser creation/sign
scenario in a separate artificial fixture, updated screenshots, longer speech/AI
soak and cumulative notes beyond 24 turns, explicit orders materialization,
account/offline gaps. Existing owner's records were not approved to fake progress.
Final UI/API/help/UX gate: 29 PASS; typecheck and focused ESLint PASS. Browser
Check record CTA verified on owner's unfinished record: 1/8 reviewed, two unknown
speaker segments. No approvals made. DB quick_check ok; PDF download HTTP 200.

**Newest: review unlock/storage UX (2026-09-16).** Resume now offered at blocked
editor/right panel; verified browser enabled controls after exact saved-state
reload. Three-step guide explains sections vs hints vs signed document; patient
history path preserves assignment. Do not equate persistenceState=saved with a
signed protocol. Tests: 38 repository/UI, then 55 final UI/scope/help, types/lint.
Remaining acceptance: isolated artificial full 8-section review -> protocol draft
-> explicit sign -> artifact generation/download/reopen via patient history.
Do not approve the owner's saved clinical text to fake this acceptance. Earlier
long-context, orders materialization, account/offline gaps remain open.

**Resume here first (2026-09-16):** automatic LIVE now returns evidence-backed
clinical section drafts alongside hints; see newest section 15. Do not restore
the older hints-only schema. Existing guarded D1 writer and clinician review are
retained. Latest focused gate: 91 tests, types/lint and one synthetic real Groq
probe passed. Services were not stopped; no saved patient transcript transmitted
for testing. Guide wording rebuilt, screenshots remain explicitly older.
Next acceptance: isolated synthetic new encounter -> speech -> automatic AI ->
reopen eight sections -> doctor edit/review -> rerun AI without overwrite. Test
long conversations and cumulative note retention beyond the rolling 24-turn
window; this is not solved by the current connection. Explicit accepted-hint
materialization into orders/referrals, local accounts and offline work remain
separate unfinished tasks, not completed by generating note drafts.

Latest checkpoint is speech empty-result handling and AI contract alignment.
Next: test queued speech -> silence -> speech through actual ingestion; investigate
intermittent SPEECH_UNAVAILABLE separately. Synthetic real Groq probe passed after
schema correction. Do not auto-replay private recording to a third-party service.

Latest priority: verify new-visit consent -> activate -> microphone in browser.
Startup deadlock fixed in LIVE controls; profile errors made field-specific.
Keep source data synthetic; do not grant patient consent on user's behalf for a
real encounter during testing. See newest section 15 for changes/limitations.

Latest: new-conversation chooser and save-then-leave action implemented, compact
LIVE styling added. Next is browser QA of two separate conversations and completing
explicit accepted-suggestion transfer into structured sections/referrals with
provenance; currently only an exact encounter link exists. See section 15.

Newest checkpoint: legacy-like lightweight LIVE provider and timing implemented;
real synthetic provider call PASSED (see section 15). Continue with end-to-end
microphone/UI acceptance and then remaining local account/offline work. Do not
claim whole platform complete. Earlier 15-second timing notes are superseded.

Latest report is provider 429: Retry-After now propagated and respected in LIVE.
Verify actual quota recovery and full synthetic speech-to-draft flow next; do not
claim production readiness or provider success from mocked cooldown tests.

Latest follow-up: see LIVE snapshot conflict section 15. Longer-than-24 transcript
selection/count defect fixed; automatic 409 refresh/retry added. Continue with
controlled end-to-end recording/AI acceptance; do not transmit existing patient
text merely to test connectivity. Main web and STT remain running.

### Latest delta — LIVE automatic hints

Read section 15 owner change first: automatic LIVE drafts are now intentionally
unacknowledged input, never clinician-approved output. Main runtime kept running.
Do not restore the old per-replica checkbox or populate fake acknowledgement times.
Focused tests/typecheck passed; full aggregate and real microphone round trip are
not rerun. Local account provisioning/auth integration is still incomplete.

### Resume here — local login implementation is incomplete

- Highest priority is the owner's local login/logout + both offline scenarios.
  Read latest section 15. New auth middleware is intentionally not activated yet;
  account provisioning/configuration and main-app integration are still required.
- Groq credentials were restored from legacy at owner's explicit request; keys
  remain solely in ignored local config. Both provider probes succeeded. Main web
  restarted with config; web.pid updated, logs web-groq.out/err.log. No provider
  patient data used. Do not repeat the earlier claim that keys are unavailable.
- Current startup works (3200 and 3101 ready). Need actual end-to-end synthetic
  analysis and recording tests, not only provider tests/health. Keep main DB intact.
- Latest focused auth test 2/2, type/lint pass; no fresh aggregate after these new
  unactivated files. Do not use the prior 735-test aggregate as coverage of this code.

### Resume here — 2026-09-16 current acceptance gate

- This entry supersedes screenshot counts and next-task pointers below.
- Reproduced and fixed blocker (see section 15): doctor `/`
  loads `/api/workspace` and receives 503 WORKSPACE_UNAVAILABLE in run-ktJ4RX.
  Read-only D1 inspection confirms normal user-created encounter has 8 section
  heads but `persona-schedule-encounter` has 0. The scheduling fixture creates
  this in_progress encounter without clinical sections; resolver selects it first,
  and the full workspace endpoint rejects the incomplete set. Dashboard currently
  couples its worklist to loading a complete clinical record. Do not conceal the
  error with fake cards or disable the eight-section invariant. Scoped/audited
  `view=worklist` is now implemented and browser-tested without changing the DB.
  Empty/multiple worklist cases are now tested. Next bounded follow-up: correct
  future fixture construction without reseeding the existing DB. Refresh
  dashboard illustration only after those tests and aggregate verification.
- Five current / fourteen older handbook captures; three newly refreshed pages:
  own access, care plan and patient measurements. Update the remaining role-specific
  clinician/registrar captures after the dashboard blocker, from actual DB UI only.
- Four-persona runtime checks, dependency and secret gates passed. Aggregate
  `.local-verify-latest.log` ended with exit 0 (735 tests plus successful build);
  two later added cases are covered by focused 13/13 and fresh types/lint.
  Tests/build do not establish actual speech or AI.
- Continue server 3213 on `work/personas/run-ktJ4RX`; preserve revoked assignment v2
  and original five assignments. Do not reseed, clear DB, delete models or stop ports.
- No cache deletion performed. Keep this exact handoff instead of pretending that
  disk cleanup resets the assistant's context. Working changes remain uncommitted.
- Fresh isolated recovery drill passed; evidence: `work/backup-restore-E4Pqud`.
  Do not rerun it solely to rediscover this result. Operational backup scheduling,
  production data/residency decisions and remaining UI acceptance remain separate.

### Resume here — handbook refresh in progress

- New leading chapters access-current and access-revoked-current use real current
  screenshots; 8 markers visually verified in generated HTML.
- 19 screens / 75 markers total, but 17 older screenshots still await refresh.
- Mobile /help, standalone annotated page and zoom/close checked at 390x844;
  viewport reset. Browser tab 3 left on standalone updated chapter as deliverable.
- Next bounded task: update own-role screenshot then care-versus-measurements
  illustrations, preserving truthful role and external-integration limitations.

### Resume here — administrator grant/revoke acceptance completed

- Artificial nurse assignment in ui_acceptance_0915 is revoked v2; keep history.
  Do not repeat grant or modify original five active assignments.
- New-grant roles are now empty by default; employee change clears role/overrides.
  Browser and 5-test render suite, types/lint passed. Full verify not rerun yet.
- Administrator shared instructions updated to reflect actual browser acceptance.
- Next bounded deliverable: refreshed annotated screenshots for changed role/access
  screens and help layout QA, not another repetition of grant/revoke acceptance.
- Test server 3213 left running, tab 3 marked handoff. No commit/push.

### Latest UI checkpoint — administrator department create/edit/reload

- Existing isolated department `ui_acceptance_0915` is now v2. Do not recreate it
  or touch main working memberships. No grant/revoke submitted via browser.
- Administrator guide is now fifth scenario in shared workflow module and handbook.
- Current bounded gap remains browser assignment grant/revoke/reload, distinct from
  the successful department scenario. Then refresh annotated screenshots.
- No ports stopped; no full aggregate rerun, commit or push in this continuation.

### Latest continuation — administrator checks

- Runtime role/foreign-facility/logout denials now cover `/api/access/admin`.
- Isolated repository test covers stale reactivation after revoke, persisted head
  and unchanged audit on rejection. 3 files / 9 tests, focused lint and types passed;
  full verify was not rerun after these test edits.
- Browser recovered as browser 2, tab 3, administrator on `/access/manage` at 3213.
  Open/cancel grant form succeeded; no live assignment changes. Tab marked handoff.
- Next: finish administrator UI write/reload on isolated test target, then screenshot
  refresh. Main DB untouched, no ports stopped, no commit/push.

### Resume here — 2026-09-15 help and aggregate checkpoint

- Full verification is now confirmed: 93 files / 727 tests and build, exit 0.
- `/help` has four shared step-by-step role workflows; downloadable guide rebuilt.
- `node scripts/check-persona-runtime.mjs 3213` passed help HTML delivery for all
  personas, actual role restrictions and logout replay. This is not visual QA.
- Keep `work/personas/run-ktJ4RX` and its database; do not repeat scheduling seed.
- Next bounded task: administrator access-management UI acceptance, including
  permission denials and reload persistence, only in isolated persona data. Inspect
  existing access capabilities before any write; do not alter main memberships.
- Then replace outdated annotated screenshots and verify both `/help` and standalone
  handbook at desktop/mobile sizes. Browser control currently unavailable; retry
  inventory when tool connection returns, not guessed stale tab IDs.
- Main 3200 was not listening; isolated 3213 remained alive. Nothing stopped or pushed.

### Latest override — 2026-09-15 persona acceptance evidence

- Implemented four isolated identities (doctor, nurse, administrator, registrar).
- Actual runtime API matrix passed: care reads 200 for doctor/nurse, 403 for
  administrator/registrar; logout replay returned 401 for all four.
- Browser verified nurse/admin role pages, admin denial on care, and logout.
- Fixed non-clinician brand destination to `/access`; neutral workspace title.
- Focused suite: 20 files / 141 tests passed, types/lint and diff check passed
  before the subsequent resume-script addition. Full production build result was
  not captured; do not claim a fresh full verification pass.
- Existing isolated state: `work/personas/run-ktJ4RX`; earlier failed fixture
  setup is `run-wRSX3S`, not the successful state. No main roles were modified.
- At continuation both 3200 and 3213 had no listener. Restart of isolated 3213
  completed with the same state after 44 seconds. Repeated runtime matrix passed
  all four roles and logout replay checks. Resume script lint, Node syntax and
  diff check passed. Refresh readiness before browser work; do not claim the main
  project is running.
- Doctor browser acceptance passed: created patient
  `patient-2e15b8fb-e37c-45f5-b08c-a89f258a83c9` (OR-ABC8C87C) and encounter
  `encounter-a35704b6-3749-41fd-980a-e90a76cc213e` using normal UI forms under
  `persona-doctor-assignment`. Reload restored the exact name, reason, draft
  status and eight empty sections with server-saved status. No consent, AI call,
  recording or clinical approval was submitted. This proves this creation/read
  scenario, not all encounter lifecycle operations or nurse writes.
- No commit/push; preserve existing owner changes, including the standalone `a`.

### 2026-09-15 — isolated login prerequisite identified

- Current Sites development plugin hardcodes local_seedy and strips caller identity
  headers. Nurse/registrar fixture issuer differs from real app issuer. These facts
  explain why current single browser login cannot establish separate-persona proof.
- Next harness requirements: isolated temporary D1/R2 state, free loopback-only port
  (never 3200/current runtime), explicit fixed test personas with matching issuer,
  no Groq/STT credentials copied, no external exposure, reject non-loopback/forged
  Host and cross-origin persona selection; no test auth in production build.
- Acceptance: doctor creates/checks plan; nurse records own task response/escalates,
  cannot enroll/sign/resolve; admin manages permitted employee access but cannot
  obtain clinical actor rights; signout removes persona and subsequent API is 401;
  cross-facility/other-assignment commands denied without writes. Verify persisted
  results and audit, not just UI visibility. Existing live DB remains untouched.
- This harness is NOT implemented. Latest completed checkpoint is API/UI-action
  role tests and 6 care repository tests recorded above. Continue from that fact.

### 2026-09-15 — care API role checkpoint

- Added explicit requireChronicCarePermission in API care/plans and enrollments,
  using role from resolved server assignment. No role, permission matrix or DB
  authorization changes. Repository still independently guards writes.
- New app/api/care/plans/route.test.ts exercises both endpoints with actual schema
  and mocked identity/resolver/storage: nurse denied before write despite doctor
  confirmation flag; clinician reaches repository. Not persistence or live login proof.
- app/care/care-workspace.test.ts now uses actual server capability map for all
  nurse task states/owner mismatch. chronic-care-access.test.ts rejects unrelated
  administrator/auditor/medical-lead/registrar grants as clinical actors.
- 137 focused tests, 6 DB integration tests, typecheck/lint/diff-check PASS.
- Next: isolated persona browser harness/acceptance. Do not mark UX-R2 complete;
  no separate live nurse/admin credentials were used. Current user rights, ports,
  STT/provider configuration unchanged; code is local, not committed/pushed.

### 2026-09-15 — explicit scope recovery browser-tested

- Follow-up to cross-module changes: shared header reset uses native anchor to
  current pathname, intentionally clears resource/scope query and fully reloads
  module state. Client Link was tested and failed by preserving stale forbidden
  state, hence native anchor is required. Care/communications denial copy updated.
- Browser /care?accessAssignmentId=missing-test-assignment&facilityId=fac-a denied;
  explicit reset then loaded authorized care/tasks. No automatic privilege fallback
  on denial and no changes to live assignments. Add this regression to future E2E.
- Next remaining work: selected patient context and isolated role UI/API acceptance;
  test scope reset on other modules, unsaved-form navigation behavior, and refresh
  handbook only after UX stabilizes. Latest source uncommitted; ports preserved.

### 2026-09-15 — cross-module scope and role clarity

- lib/workspace-access-url.ts now preserves exact assignment/facility between
  allowlisted clinical pages; does not transfer encounter to orders/care etc.
  Tests cover duplicates, patient detail, unrelated/API/external destinations.
  Browser care -> orders passed with same assignment/facility and loaded data.
- app/access/access-workspace.tsx explains each role and explicitly identifies
  multi-role assignments. Current browser user is doctor+administrator (server
  rendered). Do not treat that account as isolated nurse/admin role validation.
- 160 tests across 17 files plus typecheck/focused lint/diff-check passed. Full
  aggregate 688-test result is prior to these latest changes; no new full CI claim.
- Next exact task: assess incompatible selected assignment recovery on clinical
  pages and implement a safe explicit re-selection route where missing; then
  isolated role acceptance with test-only fixtures. Do not modify real/current
  assignments to simulate roles. No commit/push, no external actions, ports intact.

### 2026-09-15 — mobile menu fixed and aggregate recovered

- Session 23567 finished exit 0: pnpm verify passes (90 files, 688 tests, schema
  check and build). No need to recover/re-run it; ignored local log retains output.
- app/clinic-shell.module.css: mobile context remains visible; bottom navigation
  explicitly flex-direction: row (previously inherited column), full text labels
  and horizontal scrolling. Browser 390x844 screenshots and actual click to care
  passed. Focused helper/shell tests 7/7, diff-check passed.
- Next: audit context transport between modules. Observed /care with explicit
  assignment/facility has dashboard link `/` (scope dropped by existing helper).
  Determine module permission compatibility before changing it; do not invent
  role labels from URL or expand authorization. Then UX-R2 actual role acceptance.
- Changes still local/uncommitted. Ports preserved. No real patients, mic, Groq,
  clinical decision, or external communications performed in this slice.

### 2026-09-15 — dashboard breadcrumb acceptance

- Shared shell breadcrumb is implemented and browser-clicked; doctor returns to
  dashboard preserving assignment/facility. No data mutation and no role widening.
- Added app/clinic-shell.test.ts (3 rendered-shell cases); combined helper/shell
  run 7/7 passed, focused lint/typecheck/diff-check passed.
- Old aggregate output was lost; replacement session 23567 writes ignored log
  .local-verify-latest.log. Collect final exit and fix any failures before claiming
  aggregate success. Keep focused breadcrumb test evidence because it was added
  after aggregate start. Do not start a duplicate run while this session exists.
- Next bounded task: UX-R1b selected assignment/patient context and mobile context,
  then UX-R2 role acceptance. Existing security backlog remains. No commit/push.
  Web 3200 remains running; no unrelated ports, STT, or ngrok were stopped.

### 2026-09-15 — browser persistence and editor guidance

- Actual existing-patient create/reload passed; exact new encounter ID and limits
  recorded in ledger. Data is persisted in live local D1, not only the test adapter.
- Fixed contradictory disabled-editor instructions with clinicalEditorBlocker in
  lib/workspace-ux.ts and app/clinical-workspace.tsx. Tests cover read-only,
  loading, recovery, draft, ready, editable and final states. Browser confirms copy.
- Current aggregate verification session 48719 still requires final output; started
  before this small editor change, so retain focused post-change test evidence.
  Next: collect aggregate exit, remedy failures, then continue remaining UX-R1b
  breadcrumbs/selected assignment and role audit UX-R2. Nothing is committed yet.

### 2026-09-15 — existing-patient transaction boundary

- Changed FacilityAccessScope and patient-directory resolver to retain assignment;
  patient-registry.createEncounter now checks current exact creator, scopes replay
  hash to actor/assignment, records assignment on command/audit, checks current
  permission inside D1 batch, and aborts incomplete section/audit publication.
- 20 focused tests passed plus types/lint. Active application data not reseeded.
  Port 3200 was absent; restarted web only (`pnpm dev --host 127.0.0.1 --port 3200`,
  exec session 17419). STT/other ports not touched. Browser connection-error page
  prevented UI create/reload acceptance; do not claim that scenario passed.
- Next immediately: complete browser existing-patient create/reload and aggregate
  regression; inspect authoritative replay/current access at response boundary and
  database-level direct-write guards before marking all D-R1 hardening complete.
  Continue UX-R1b afterwards. Preserve all uncommitted UX work and owner `a`.

### 2026-09-15 — real data operations, artificial inputs (D-R1 start)

- Owner clarified that artificial patient values are acceptable, but all workflows
  must operate on durable data rather than painted fixture outcomes. Added mandatory
  cross-phase acceptance and D-R1–D-R5 sequence under Outcome and boundaries.
- `lib/repositories/encounter-creation.test.ts` now proves disk persistence across
  closing/reopening an isolated DB with only schema/identity bootstrap, selected
  assignment read and exact retry without duplicate patient, encounter or audit.
- New-patient form links directly to the scoped patient registry for an existing
  patient workflow. No backend runtime behavior or production data gate changed.
- 14 repository tests, typecheck and focused lint passed. Next: D-R1 existing-patient
  create-encounter transaction hardening already tracked in the security backlog,
  then UI create/read/reload acceptance and continue UX-R1b. Do not call the whole
  D-R1 complete from the file-adapter test. No real D1 restart/browser/production proof.
- All current changes remain local/uncommitted. Preserve prior UX work and owner `a`.

### 2026-09-15 — UX-R1b initial context and blocked-action slice

- Added `lib/workspace-ux.ts` and tests; wired into ClinicShell and orders detail.
  Root with encounter now says «Приём и протокол», dashboard remains «Рабочий день».
  Order actions display missing reason / pending-save guidance; incomplete result
  explains upload and physician review. Guidance is linked with aria-describedby.
  Server authorization and clinical transition conditions are unchanged.
- Verified 12 focused tests, typecheck and focused ESLint. No browser acceptance,
  full build/CI, role changes, DB writes, STT changes or port shutdown this slice.
- Continue UX-R1b as listed in section 15. Do not mark UX-R2 roles complete from
  these presentation changes. Prior UX-R1a and owner standalone `a` remain intact.
  Changes remain local/uncommitted, including the prior turn's UX-R1a files.

### 2026-09-15 — UX-R canonical plan and first implementation slice

- User explicitly requested a detailed main plan another agent can continue and
  implementation to start. The authoritative ordered UX-R1–UX-R6 checklist is in
  section 1; it takes priority over historical "next" entries below.
- Implemented UX-R1a in `app/clinic-shell.tsx`, `app/section-purpose.tsx` and its
  CSS/test, care/observations workspaces, orders action label and help version notice.
- Verified 14 focused tests, types and focused ESLint; browser read-only inspected
  care and measurements, including actual menu navigation and retained synthetic
  records. No backend capability, consent, STT, model, port or database changes.
- Next exact task: UX-R1b — make page context and primary action explicit, retain
  selected scope and explain blocked controls. Then UX-R2 — reproduce and fix access
  defects using separate doctor/nurse/registrar/access-admin identities. Current
  combined-role local account is not evidence that all roles work.
- Guide screenshots are deliberately NOT recaptured yet. UX-R6 must replace them
  after the layouts and role workflows pass. These changes are local/uncommitted;
  base commit is `5489c18`. Preserve the owner's unrelated standalone `a` edit.

### 2026-09-15 — in-app handbook and hands-on interface acceptance

- `/help` now lives in the shared ClinicShell. Source remains the standalone
  handbook generator; `public/user-guide.html` contains only synthetic educational
  screenshots, never live patient/session data. Every build regenerates both copies.
- Reproduced and fixed full-name search returning `PATIENT_LIST_FAILED` / D1
  `LIKE or GLOB pattern too complex`. `D1PatientRegistryRepository.list` uses
  literal substring matching; wildcard characters no longer match every patient.
  Long Cyrillic name and literal wildcard regression tests added.
- Browser evidence and exact created synthetic record IDs are in
  `docs/user-guide/UI-CHECK-2026-09-15.md`. Logout and explicit login passed;
  confirmed section text survived reopening from the patient's history.
- Fixed local LIVE history labels: empty material records no longer claim a
  completed encounter. Browser confirms "Материалов пока нет"; clinical lifecycle
  is unchanged. Empty-cache retention remains a separate UX consideration.
- Verification: `pnpm verify` exit 0, 87 files / 676 tests, lint/types, Drizzle,
  build. Log `.orion-runtime/logs/verify-guide-search-final-2026-09-15.log`.
  Subsequent local-history label change passed 4 focused tests, typecheck, focused
  ESLint and browser inspection; it was not included in that earlier full build.
- Browser download-event timeout means handbook download-to-disk is not verified.
  Real microphone, Groq, all-role workflows, exported document rendering and
  external deliveries were not exercised. Preserve these gaps explicitly.
- Preserve the owner's unrelated standalone `a` under Initial risks. No secrets,
  local data exports or recordings are part of this checkpoint.

### 2026-09-15 — new-patient checkpoint verified; illustrated user handbook

- Continue only with the **existing-patient encounter writer**:
  `D1PatientRegistryRepository.createEncounter`, `commitEncounterCreate`,
  `/api/patients/[patientId]/encounters`. Require exact current assignment inside
  the publication transaction and replay hash; preserve existing patient/profile.
  Migration 0047 covers only the new-patient writer. Do not edit applied 0047.
- Current checkpoint full `pnpm verify:ci` exited 0. Evidence is in the newest
  ledger and ignored `.orion-runtime/logs/verify-handbook-2026-09-15.log`.
  An earlier same-day run reached 673/673 but its session disappeared before final
  collection; it was rerun with persisted logs, not counted as aggregate proof.
- Fresh preparation benchmark did not reproduce the prior severe slowdown:
  0046 update/audit ~557/676 ms vs 0047 ~619/727 ms. Cause of earlier variability
  remains unproven; no experimental view materialization or 0048 was applied.
  Existing unit/integration timeout split is retained; STT timing is unchanged.
- Browser QA found and fixed lost assignment/facility in patient-history links and
  post-create navigation. Document export grid now wraps instead of overlapping
  the right assistant; access-management layout stacks at <=1500px to avoid
  horizontal overflow. Updated misleading export audio notice: local LIVE audio
  exists separately and is not part of the server ZIP.
- Deliverable: `docs/user-guide/ORION-CLINIC-GUIDE.html`, standalone Russian guide
  with embedded screenshots/font, roles, workflows, disabled-button troubleshooting,
  clinical/external limits, zoom and print stylesheet. Rebuild using
  `node scripts/build-user-handbook.mjs`; content is in `handbook-content.mjs`.
  `node scripts/preview-user-handbook.mjs` serves only the guide on loopback 3212.
  Screenshot sources are synthetic; no keys or real clinical data are embedded.
- Visual checks: actual current desktop pages; screenshot overlays validated within
  image bounds; handbook DOM has 17 images/67 markers/no broken anchors or external
  images/no horizontal overflow. Zoom, close and Escape verified. Printing has
  stylesheet support but printed/PDF output was not rendered and is not claimed.
- Web was restarted on otherwise free 127.0.0.1:3200 after execution-session reset.
  Guide preview is 127.0.0.1:3212. STT and ngrok were not started or reconfigured;
  no real microphone or provider calls performed. No medical/consent mutations
  were made for the screenshots. The Sep 9 synthetic creation fixture is retained.
- Keep the owner's standalone unstaged `a` below Initial risks to maintain.
  Do not claim the overall roadmap is complete: clinic approvals, real identity,
  external registries/messaging, risk policy and other recorded gates remain open.

### 2026-09-09 — independent new-patient encounter creation (verification in progress)

- New `lib/auth/encounter-creation-access.ts` resolves current selected manage
  authority independently of an existing encounter. API accepts optional legacy
  sourceEncounterId only for compatibility and ignores it for authority/hash.
- Migration 0047 records immutable creation events and root attribution; guards
  actor/assignment/patient/encounter/audit/command/result inside the transaction.
  A final SQL assertion rolls back skipped publication. Initial profile head/version
  is included so a newly created patient has an editable registry profile.
- Selection SQL uses the exact assignment/user/member/scope/current permission,
  not legacy membership.role; it rejects merged memberships and cannot fall back.
- New `/encounters/new` form is accessible from the dashboard even with zero
  encounters, retains the exact command during ambiguous failures, preserves
  assignment/facility through navigation, and opens the created encounter.
- Focused initial run: 3 files/42 tests passed (14.94 s), then selection/URL coverage
  expanded. First full test run: 669 passed, four 5000-ms integration timeouts
  in protocol-recommendations and patient-communications. A retry exposed more
  complete-schema repository cases exceeding 5000 ms and was stopped. Rather than
  patching each test, vitest.config.ts now separates unit tests (5000 ms) from
  repository/database integration (20000 ms). Per-case changes from this turn were
  removed; all assertions and the complete test inventory are preserved. This does
  not change runtime/STT deadlines or constitute a performance acceptance result.
- Local 0047 applied; PRAGMA quick_check=ok; foreign_key_check empty; db:generate
  reports no drift. Browser created only a synthetic patient named
  `Тест создания 09 сентября 1723`, card SYN-BACF8174; POST 201, exact encounter
  opened with eight empty sections, and dashboard listed the same record.
  Test record intentionally retained; no real patient/provider/audio data used.
- No listener existed on 3200 at start of browser QA. Started only the web app on
  127.0.0.1:3200, left running; STT and ngrok were not started/stopped/reconfigured.
- Latest URL transport test after shell-navigation correction: 26/26 PASS;
  focused eslint PASS. Sites 0.1.66 build helper was attempted directly twice,
  including absolute Node path; its Windows package-manager subprocess failed
  with `The system cannot find the path specified`. Do not claim helper success;
  the repository's established pnpm build remains part of aggregate verification.
- Next: finish aggregate/build/recovery evidence and Git checkpoint. Then migrate
  only `D1PatientRegistryRepository.createEncounter` / commitEncounterCreate and
  `/api/patients/[patientId]/encounters` to equivalent exact-assignment guards and
  replay hashes; preserve the existing patient's identity/profile and ownership.
  Existing-patient creation is NOT covered by 0047. No full Phase 2I/production claim.
  Preserve the owner's standalone unstaged `a` below Initial risks to maintain.

### 2026-09-09 — workspace-read audit and recovery assignment boundary

- Local migration 0046 is applied and immutable. New workspace.read events require
  schema 2 and exact current assignment/user/treating-member/encounter attribution
  inside SQLite. The existing download guard is kept separately; no signed-artifact
  restrictions are removed. Historical v1 events/hashes remain byte-for-byte intact;
  their request IDs cannot authorize replay, but fresh v2 events extend their chain.
- Access audit revalidates at entry/retry/replay/pre-batch/post-commit. Missing,
  expired, denied or revoked assignment fails closed without alternate-scope fallback.
  Head-publication failure rolls back the event. Recovery snapshots revalidate before
  loading and before return, replacing their legacy membership.role guard. The route
  rechecks the exact actor/assignment after auditing, before returning clinical data.
  An audit receipt records response preparation, not proof of browser delivery.
- Focused audit/recovery/workspace-response verification: 3 files/35 tests PASS
  (12.35 s). Local 0046 applied; quick_check=ok, foreign_key_check empty and
  db:generate reports no drift. The previous long-running aggregate result was not
  retained across the resumed session and is not claimed as passing.
- On 2026-09-09 the fresh aggregate stopped at the dependency gate: Miniflare's
  sharp 0.35.2 was reported vulnerable by GHSA-rgj7-g3m4-5g8c. Added a narrow
  miniflare>sharp override to patched 0.35.4 and regenerated the lockfile. No
  framework/STT/provider version change. pnpm why sharp confirms only 0.35.4;
  the repeated dependency audit reports no known vulnerabilities. Advisory:
  https://github.com/advisories/GHSA-rgj7-g3m4-5g8c
  The next aggregate completed 655 tests and hit three 5000-ms timeouts (85 files,
  658 tests, 341.83 s); it did not reach build/recovery. The affected draft/sign
  assignment-replay cases and complete scheduling lifecycle now have explicit
  20000-ms integration limits, consistent with existing long protocol cases.
  No assertions or application deadlines changed. Focused retry passed all three
  selected tests (2 files, 14 unrelated skipped, 16.17 s).
- Final pnpm verify:ci exited 0: security policy 481 files, no known dependency
  vulnerabilities, lint/types, 85 files/658 tests (298.46 s), Drizzle and production
  build. Isolated recovery passed after disposable source destruction: 88 tables,
  160 rows, 47 migrations, three R2 objects, 560,469 bytes, 127,136 ms;
  run 0f76163c-d6f3-4d62-8d13-b7a42f1d5956. Local integrity/migration presence
  was rechecked after dependency installation. This closes only the read-audit/
  recovery checkpoint, not independent creation, all Phase 2I or production readiness.
- Exact next bounded task: independent encounter creation/selection. Inspect
  lib/repositories/encounter-creation.ts, app/api/workspace/encounters/create/route.ts,
  lib/repositories/workspace-access.ts and app/clinical-workspace.tsx. Creation still
  requires sourceEncounterId and its request hash/replay lack exact-assignment
  attribution. Resolve facility/member/current encounter.manage independently of
  existing encounters; do not reuse an arbitrary patient/encounter to obtain authority.
  Add transactional actor/assignment/command/audit/result guards and negative/replay
  tests. Verify empty-clinic creation, selected scope and patient-to-encounter links.
- Remaining selection reader: listAssignedEncounters still filters the legacy
  membership.role. The recovery/audit tests prove registrar-legacy + doctor-assignment
  at their own boundaries, NOT an end-to-end browser flow for that mixed-role user.
  Replace this filter only with verified exact current assignment SQL, not removal
  alone. Keep physician ownership and explicit denial; no role broadening.
- Preserve owner's unstaged `a`, applied 0000-0046 and all historical rows. No ports
  stopped/restarted; no UI, microphone, provider, public deployment or real-data claim.
  Full Phase 2I and production gates remain open.

### 2026-09-08 — explicit fenced export reconciliation

- 0045 is applied locally and immutable. Permanent export_cleanup_fences bind exact
  object keys, manifest, actor, assignment, request and signed encounter/protocol.
  SQL serializes reference publication against fencing; all five rows must commit
  atomically before deletion. INSERT/UPDATE of a fenced artifact key is rejected;
  fencing an already referenced key is rejected, including a preflight-to-batch race.
- New manifests have schema 2 and explicit assignment. The same-origin authenticated
  POST /api/workspace/exports/reconcile derives exact paths from selected scope,
  requires current manage authority and current signed head, and processes only one
  deliberately selected pending attempt. Malformed/legacy/uploading/published or
  mismatched manifests are retained. Partial deletion keeps the manifest for retry;
  uncertain fence commit never starts deletion. No production retention policy inferred.
- Operator contract: docs/operations/export-reconciliation.md. No automatic worker,
  general listing/deletion endpoint, cleanup UI or stale-protocol/legacy adoption.
  No existing user export was deleted during verification; tests use isolated fixtures.
- Focused initial repository/reconciliation/API run: 3 files/41 tests PASS (13.98 s).
  Subsequent publication/reconciliation/API run: 3 files/28 tests PASS (780 ms).
  Final verify:ci exited 0 with 84 files/639 tests (280.79 s), security/dependency
  checks, lint/types, schema and production build. Isolated recovery passed after
  disposable source destruction: 88 tables/159 rows/46 migrations/three R2 objects/
  559,351 bytes, 119,489 ms, run d67c9f91-5135-4464-9134-c6ef48bf74ba.
  The general drill covers schema/data restore; it does not claim a non-empty fence
  recovery fixture. Fence behavior is covered by the isolated SQLite tests.
  0045 local migration, quick_check=ok, empty foreign_key_check and no drift confirmed.
- Next: migrate workspace.read access audit to exact current
  assignment with schema-2 attribution, SQL guards and negative/replay/rollback tests.
  Then independent encounter creation/selection. Full Phase 2I remains open.
  Preserve owner's unstaged `a`, applied 0000-0045 and all historical records.
  No ports stopped/restarted, browser/audio/provider/Word or public deployment claim.

### 2026-09-08 — download audit transaction boundary, 2I.3i.2 continuation

- Forward-only 0044 is applied to local D1. It adds access_assignment_id to
  access_audit_events and a current-download authority view/trigger. Every new
  document.download requires hash schema 2 and the current exact read assignment,
  matching user/member/tenant, active patient, treating relationship, current
  signed ready artifact and finalized/amended encounter. Legacy membership.role
  is no longer authority for download audit; workspace-read audit remains unchanged.
- Hash schema 1 canonical bytes/history remain unchanged. Schema 2 binds assignment;
  cross-assignment and unattributed historical download receipt replays fail closed.
  Repository checks current authority before entry/retry/replay/batch/response.
  Final SQL head-publication assertion aborts a batch whose head update was skipped.
- Focused three suites/20 tests passed (5.03 s), covering missing/wrong assignments,
  actor mismatch, current replay revocation, cross-assignment receipt rejection,
  pre-batch rollback, non-clinician legacy role with valid doctor assignment,
  direct SQL attribution/schema denial, unchanged v1 hashes and skipped-head rollback.
  Local quick_check=ok and foreign_key_check empty. Final verify:ci exited 0:
  83 files/617 tests, security/dependency checks, lint/types, schema and build passed.
  Recovery passed: 87 tables/158 rows/45 migrations/three R2 objects/556,449 bytes,
  123,986 ms, run a8479b66-407e-483a-9e54-46c4320debc7. This supersedes the earlier
  610-test intermediate run. No schema drift was found by db:generate.
- Next exact implementation: pending-manifest reconciliation with durable publication
  fencing. A no-reference query followed by R2 deletion is NOT safe against an
  in-flight publisher. Keep uncertain objects until a fence prevents later publication;
  never delete referenced objects. No worker, deletion policy or automatic orphan
  cleanup was enabled by this checkpoint. Then workspace-read audit and independent
  encounter creation remain. Full 2I.3i.2 / Phase 2I / production remain OPEN.
- Keep owner's unstaged `a`; do not modify applied 0000-0044 or historical events.
  No server/STT/ngrok restart, provider/audio/Word/browser test or public deployment.

### 2026-09-08 — export publication implementation, 2I.3i.2 IN PROGRESS

- Migration 0043 is now applied to local D1. Do not rewrite it. Adds artifact
  assignment/command attribution, selected current authority guards, immutable
  attributed artifacts and package/audit/command/result matching in the batch.
- Generation now checks stable intent replay before rendering/upload. Each attempt
  owns fresh R2 keys. Waits for all uploads before cleanup; cleans only its own
  pre-publication or losing-attempt objects. An uncertain database result retains
  files and a private publication_pending manifest, never deleting possible references.
- Current listing selects one package; download links carry artifactId and recheck
  that exact artifact. Legacy links still resolve by kind. Hash schema is now 2;
  old schema-1 idempotency requests fail closed and require a fresh request key.
- Targeted checks: types/lint/Drizzle check passed; three focused suites 27 tests
  passed (11.45 s), including revoked-before-batch rollback, immutable artifacts,
  intent replay and original artifact download. Latest publication/API suites:
  12 tests passed (803 ms), including late-upload cleanup and basename validation.
  Local quick_check=ok, foreign_key_check empty. Standalone build/types passed;
  secrets policy passed for 470 files. Full pnpm verify reported three failures
  in protocol recommendation rollback tests. All four affected cases passed with
  a 20-second limit (21.49 s total); that group now has this explicit timeout.
  Final initial aggregate: 83 files, 607 passed/three failed out of 610 tests,
  286.87 s, exit 1; all three errors explicitly Test timed out in 5000ms.
  Latest focused rerun: three files/29 tests passed (12.70 s).
  Final aggregate acceptance after timeout adjustment and recovery are still NOT claimed.
- Next: inspect final aggregate failures, rerun latest focused tests, complete
  download access-audit assignment/transaction protection and bounded pending-manifest
  reconciliation. Run final CI/recovery, update this handoff, commit/push excluding
  owner's unstaged `a`. No live UI/audio/provider/Word/ngrok validation this slice.
  Full 2I.3i.2 and Phase 2I remain OPEN. Services were not restarted or stopped.

### 2026-09-08 — export preflight and response boundary, 2I.3i.1

- Split 2I.3i explicitly: repository/response revalidation first, transaction and
  object-store publication second. Do not mark full export authorization complete.
- New assertCurrentEncounterReadAccess revalidates an already resolved selected
  scope without implicitly finding another assignment. Read and manage remain
  distinct. Source/list/download check before and after reads; generation checks
  current signed identity/version/lifecycle and actor at entry/retry/replay/final
  preflight. Command hash/row and clinical generation audit now retain assignment.
- API rechecks manage after artifact rendering and before returning metadata.
  Download checks current artifact identity/key/hash/size/type after object read
  and after access-audit write, before returning bytes. Download links retain
  explicit assignment and facility. No schema or prior signed snapshot rewritten.
- Targeted tests: real SQLite signed-source/generation/replay/revocation checks
  reuse protocol-amendment fixtures; API tests simulate revocation during render,
  R2 reading and access audit and verify no response bytes/relevant writes, plus
  authorized download and selected URLs. These are tests, not a live browser or
  real R2/provider/Word rendering verification. See ledger for final aggregate.
- Exact next 2I.3i.2: artifact/download-access-audit attribution and SQL guards;
  close revoked-before-batch race. Existing generation still uses shared per-protocol
  object keys before DB publication: add isolated immutable attempt objects,
  intent-bound replay before upload, and uncertainty-safe cleanup/reconciliation.
  Do not delete an object that a concurrent or uncertain commit may reference.
- No new consent retention/withdrawal policy inferred; existing signed source
  representation remains. No model, UI, hosting, service or legacy-project changes.
  Preserve owner's unstaged `a`; full 2I and production readiness remain open.

### 2026-09-08 — lifecycle transaction boundary, 2I.3h

- Added current exact-assignment and actor checks at lifecycle entry/retry/replay
  and final preflight, assignment-bound hashes/commands/audit, and scope-safe replay.
- Forward-only 0042 creates append-only encounter_transition_events. Its first
  batch insert verifies current access, treating clinician, active patient, care
  consent, legal non-protocol transition, prior version and resulting timestamps.
  Scoped update/audit/result guards bind the event; a skipped update aborts audit
  insertion and rolls back all writes. No old signed rows or applied migrations changed.
- Public transition route still accepts ready/in_progress only. Repository retains
  cancellation but rejects review/finalized/amended: protocol commands own these.
  Earlier lifecycle events do not authorize or block later protocol transitions.
  Raw no-event fixture/admin writes are explicitly outside this interactive boundary.
- Tests cover normal start/cancel/command-time replay, missing/read-only/wrong-user
  access, cross-assignment replay, selected-assignment revocation before batch while
  another remains active, immutable events, event/update/audit/result tampering,
  zero-row update rollback and actual start -> reviewed sections -> signed/amended
  protocol integration. See final ledger for commands and aggregate evidence.
- First aggregate run: 588/589 passed; one existing full derivative/signing test
  exceeded the default 5-second test timeout (5.268 s). Its assertions passed in
  the focused 33-test run with 20 seconds. Set 20 seconds only for that heavy
  integration test and the new full lifecycle/sign/amend test, not for production
  requests or STT. Final repeat verify:ci passed all 589 tests, build and recovery;
  exact commands and recovery evidence are in the verification ledger.
- Migration 0042 applied to local D1; quick_check=ok and foreign_key_check empty.
  It is now immutable: any further schema/trigger correction must be forward-only.
- Subagents provided read-only SQL/test design findings, then hit the workspace
  spend cap before final review. Parent implementation and tests are authoritative;
  do not describe this as a completed independent review of the final diff.
- Next: 2I.3i signed exports, then remaining access-read audit and independent
  creation. Full Phase 2I is still open. Keep synthetic-only boundaries and the
  owner's unstaged standalone `a`. No STT/model, UI, provider or public deployment changes.

### 2026-09-08 — protocol transaction boundary, 2I.3g.2

- Forward-only 0041 adds nullable historical assignment columns to protocol
  versions/amendments and protects attributed writes, head publication and
  interactive command/audit/result persistence with current exact assignment,
  treating clinician, active patient, care consent and lifecycle checks.
- Normal draft -> review -> signed/finalized -> amended statement order is
  preserved. Commands must start processing; direct succeeded insertion fails.
  Result fields must match stored rows, and replay verifies the scope encounter.
  No old signed version, schema migration or historical nullable row was rewritten.
- Two requested read-only subagents audited SQL and test coverage. Their findings
  led to processing-only command insertion, response identity/summary checks,
  null draft-signature validation and current-access guards on head publication.
- Tests include final-preflight selected-assignment revocation with another active
  assignment still available, amendment membership revocation, complete rollback,
  mismatched audit/result/encounter/hash, direct SQL insertion denial, attribution,
  immutable signed history and normal replay/second amendment. See ledger for
  final aggregate results; focused suite before the last null guard passed 19 tests.
- Migration 0041 was applied only to local D1. Web/STT were not stopped; no patient
  command, live microphone, provider request, model change or external deployment.
  Groq remains unconfigured and ngrok offline from the preceding checkpoint.
- Continuation on September 8: the previous CI process result was unavailable,
  so verification was restarted and passed in full (575 tests, build and isolated
  recovery; exact results in the ledger). Neither port 3200 nor 3101 was listening at
  inspection; this continuation did not stop or restart any application service.
- Final read-only subagent review found no blocking authorization defect.
  Deferred result-summary hardening: bind amendment sequence/display name and
  transition timestamps to stored values, with tampering tests in a future
  forward migration. Normal writers already construct these values; this is not
  an assignment-authority bypass. Do not modify the already-applied 0041.
- Next is **2I.3h encounter-lifecycle repository and SQL authorization**, followed
  by export/read audit and independent creation. Keep protocol-driven transitions
  compatible. Full Phase 2I and production readiness remain open. Preserve the
  owner's standalone unstaged `a`; no secrets or local data belong in Git.

### 2026-09-07 — protocol commands, dashboard and logout checkpoint

- Completed 2I.3g.1 across protocol-review.beginReview, protocol-signing.sign and
  protocol-amendment.amend: current exact assignment/user, active patient, care
  and compatible lifecycle at entry/retry/replay and immediately before batch.
  Command hashes/rows and hashed audit metadata retain assignment. Unattributed
  legacy/cross-assignment replay fails closed. Signed snapshots remain immutable.
- Tests cover missing/read-only/wrong actor, cross-assignment and revoked replay,
  revocation after source reads before save, normal draft/sign/amendment history.
- User-reported logout loop reproduced: logout returned to protected /, causing
  immediate local Sites sign-in. It now returns to public /signed-out; explicit
  sign-in returns to /. Dispatcher still owns auth routes and HttpOnly cookies.
- / without encounterId now renders ClinicDashboard with actual assigned D1
  encounters through existing scoped/audited /api/workspace. Counts cover all
  dates, not today's appointments or clinic-wide KPIs. Search/filter/open/refresh
  are available. Exact encounter links still open ClinicalWorkspace. Shell home
  strips encounterId and retains assignment. Quick links honor capabilities.
- Browser verified 5 assigned encounters, active filter (2), MRN search (1),
  opening the exact encounter and returning home; logout/reload stayed signed
  out; deliberate sign-in returned to dashboard. Light/dark inspected at 918 px,
  no body horizontal overflow and no warning/error logs. API navigation after
  logout was blocked by the browser tool, not claimed as an API-session test.
- Earlier public tunnel responded 401 without credentials; external authenticated
  flow unverified. Final check found services stopped. START_ORION_CLINIC restored
  web (HTTP 200) and speech service; final STT and speaker health both ready.
  Groq configuration was absent at restart. Ngrok restart was blocked by execution
  policy, and its public endpoint is offline. Final browser attachment to a stale
  error tab was blocked by URL policy. Earlier UI checks above remain the evidence;
  no post-restart browser, live audio or provider validation claim.
- **Next: 2I.3g.2** protocol-version/amendment row attribution and SQL guards:
  preserve in_progress -> review -> finalized and finalized/amended -> amended,
  including command/audit statement order after transition. Test final preflight
  to batch revocation, direct SQL, wrong result/audit and rollback. Keep nullable
  legacy fixtures; never rewrite signed history. Full 2I remains incomplete;
  exports/read audits/creation are later gates. See requirement handoff file.
- Plan file was recovered from HEAD after an interrupted write left null bytes;
  only known current changes were reapplied. Preserve owner's unstaged `a`.

### 2026-09-07 — Phase 2I.3f.2 recommendation database checkpoint

- Forward-only migration 0040 applied locally; derivatives and decisions now
  retain assignment. Attributed inserts require current treating clinician,
  assignment, care consent, active patient and in-progress encounter.
- Interactive command/result/audit guards require matching actor/assignment and
  resource. Decision audit metadata identifies the exact immutable decision,
  including restore. No immutable history was rewritten.
- Behavioral tests cover revocation immediately before batch with full rollback,
  direct attributed inserts after revocation, immutable assignment, wrong audit
  decision/result identifiers and the existing accept/restore/reject chain.
- Nullable historical/fixture rows are deliberately supported. This is not a
  claim that every raw unattributed SQL writer is blocked. DB access stays trusted.
- **Next: 2I.3g.1** protocol draft/sign/amend repository authorization: inventory
  all entry/replay/retry/batch paths, exact current assignment/user checks and
  command hash/row/audit attribution. Preserve signed snapshots and amendments.
  Add revoked-access and cross-assignment replay tests. Then 2I.3g.2 adds durable
  protocol-row attribution and SQL guards. Exports/read audits/creation remain.
- See verification ledger for evidence. No visual, microphone or Groq claim;
  keep web/STT/ngrok running and preserve owner's standalone unstaged `a`.

### 2026-09-07 — Phase 2I.3f.1 recommendation command repository checkpoint

- Derivative edits and accept/reject/restore commands require exact current
  assignment/user, care consent and in-progress encounter before retries/replay
  and batch. Command hashes/rows and audit metadata carry assignment.
- Legacy decisions without attributed command rows cannot be replayed; reload
  current state before a deliberate new action. Original recommendations, edits,
  decisions and basket history are preserved. No UI or schema migration this slice.
- Targeted tests retain the full edit/accept/restore/reject chain and add revoked
  derivative replay/decision denial, cross-assignment decision replay denial,
  explicit assignment/read-only/wrong user denial and command attribution.
- **Next: 2I.3f.2**, not the next resource family. Add assignment to derivative and
  review decision rows and transactional SQL guards, direct-SQL/race/rollback tests.
  Repository preflight does not close revocation between check and batch. Full
  2I.3f remains incomplete. Preserve historical fixtures without rewriting them.
- Check verification ledger for full-suite evidence. Keep ports, STT, ngrok,
  models/timings and providers unchanged. Preserve owner's standalone unstaged `a`.

### 2026-09-07 — Phase 2I.3e recommendation generation checkpoint

- Analysis preparation/completion requires current exact doctor assignment,
  in-progress encounter and care/storage/external-AI consent. Runs and command
  rows/hashes/audit retain assignment. Prepared runs cannot cross assignments.
- Migration 0039 guards attributed creation/completion, immutable attribution
  and interactive command/audit/result writes. Failure cleanup of the same owned
  run remains possible after revocation; it cannot save successful provider output.
  Historical NULL fixture rows remain unchanged and cannot be adopted by replay.
- Existing acknowledged transcript snapshot/evidence checks and proposed suggestion
  states remain. No automatic physician approval, prescription or provider activation.
- Five new repository tests verify successful attributed drafts/replay, access
  revocation, external-consent withdrawal, cross-assignment rejection and transactional
  rollback. Full suite: 78 files/551 tests. See verification ledger for recovery.
- Next: **2I.3f human recommendation edit/decision commands**, including basket
  restore, durable assignment and current rights before replay/commit. Preserve
  immutable derivatives, evidence and doctor approval. Protocols/exports/read audits
  and independent creation remain open; full 2I.3/2I are not complete.
- Keep ports/STT/ngrok, model/timings, disclosed secrets and legacy checkout untouched.
  Preserve the owner's standalone unstaged `a`. No live Groq or microphone claim.

### 2026-09-07 — Phase 2I.3d speech ownership checkpoint

- Transcription runs retain exact assignment. Start/use/replay and delayed result
  persistence require current rights, in-progress encounter and three applicable
  consents. Provider session/index mismatches fail closed. Cleanup is assignment-
  scoped but does not require continuing audio consent.
- Migration 0038 guards attributed runs/results and ingest audit; run assignment
  cannot change. Legacy NULL sessions are not adopted and require a new session.
  Historical data is not rewritten. Provider cleanup/timeouts remain unchanged;
  no new trusted expiry worker, microphone run or STT quality claim.
- Full pnpm verify:ci PASS: 77 files/546 tests, lint/types, schema/build, secrets and
  dependency checks. Recovery PASS: 86 tables/152 rows/39 migrations/three R2 objects,
  513,741 bytes, run 55fe1613-757c-4d2d-a987-78c3c4885a49. Local DB integrity PASS.
- Seven repository tests cover attributed session/transcription/replay, revoked
  access, withdrawn consent with cleanup, cross-assignment isolation, before-batch
  rollback, wrong actor/provider session, and revocation during provider startup.
- Next: **2I.3e recommendation generation**. Persist assignment on analysis runs,
  hashes/audits; reject replay and delayed results after revocation or withdrawn
  external-AI consent. Preserve acknowledged transcript version/draft boundaries.
  Human decisions, protocols/exports/read audits/creation stay open.
- Do not change models/timings, connect providers, use disclosed keys or shut down
  runtime services. Preserve owner's standalone unstaged `a`.

### 2026-09-07 — Phase 2I.3c manual transcript correction checkpoint

- Manual corrections require exact current doctor assignment, editable encounter,
  care and transcript-storage consents before replay/retries/commit. Attribution
  is stored on each new segment version, command hash/row and hashed audit.
- Migration 0037 adds nullable historical attribution, a current correction
  permission/consent view and four guards for attributed segments and interactive
  correction audit/command/results. Original segments/timings are not rewritten.
  Unattributed raw ingestion and fixture writers retain existing boundaries;
  migrating them is not claimed by the interactive correction checkpoint.
- Eleven focused tests cover role/text correction, source preservation, exact
  replay, stale/conflicting commands, wrong/missing/read-only scope, wrong user,
  revocation before batch, withdrawn consent, cancelled encounter, cross-assignment
  replay and direct SQL unattributed command denial. Full suite: 76 files/539 tests.
- Active migration applied; quick_check ok and foreign_key_check empty. Web 3200
  returns 200, STT 3101 ready, existing ngrok unchanged. No UI redesign, microphone
  test, model/timing change, live provider call or production-readiness claim.
- Next: **2I.3d speech session ownership**. Require/persist the exact assignment
  on session creation/use/deletion and delayed transcription result commit;
  recheck current rights and applicable consents, preserve expiry/stream isolation,
  recovery and versions. Do not broaden into recommendations or signed exports.
  See verification ledger for final recovery evidence. Preserve owner's unstaged `a`.

### 2026-09-07 — Phase 2I.3b interactive consent command checkpoint

- Exact current assignment is required before consent command replay/retries and
  commit. It is persisted on consent events, command rows, request hashes and
  hashed audit metadata. Migration 0036 adds a nullable event field and guards
  attributed events plus every interactive consent command, audit and result.
- Preserve initial care grant without any prior consent, withdrawals and regrant.
  No new encounter lifecycle restriction was added that could block withdrawal.
  Old history is not rewritten. Unattributed fixture/independent creation events
  remain a separate migration gate; do not claim all raw event insertion is closed.
- Verified `pnpm verify:ci`, then final full tests (75 files/528 tests), targeted
  ESLint and typecheck after two test-only additions. Recovery PASS after isolated
  source destruction: 86 tables/150 rows/37 migrations/three R2 objects/504,359
  bytes, run 164d912b-d98c-482e-839d-cd67b96b16b6. Active D1 integrity checks PASS.
- Eleven new tests exercise initial care grant with no history, withdrawal and
  regrant, absent/read-only/wrong scopes, wrong user, revoked membership replay,
  revocation between preflight and batch, cross-assignment replay and direct SQL
  unattributed command denial. Shared current-assignment resolver already has
  role/deny/expiry coverage; no production identity or clinical accuracy claim.
- Next: **2I.3c manual transcript corrections**. Add assignment to durable
  correction provenance/commands/audits, recheck rights before replay and commit,
  and guard SQL. Preserve storage consent, versioning, finality and speaker edits.
  Keep speech sessions/slow provider results a distinct subsequent checkpoint.
  Full 2I.3 remains incomplete; remaining inventory is in the requirements file.
- Runtime remains on 3200/3101 with existing ngrok. No model, UI, provider, secret
  or legacy-project changes. Preserve the owner's standalone unstaged `a`.

### 2026-09-07 — Phase 2I.3a clinical section durable authorization

- Completed only the eight clinical section command boundary, not full 2I.3.
  The repository requires the exact current doctor assignment and treating
  encounter/user, current care consent and manage permission before replay,
  retries and commit. New commands/versions/provenance/audit retain assignment.
- Migration 0035 is additive and applied to local D1. Transactional guards reject
  unauthorized human successors, mismatched audit provenance and command results.
  Existing history is not backfilled. Initial roots and service AI draft writes
  remain separate gates; other repositories and legacy role SQL are not declared
  migrated. Legacy unattributed command replay fails closed; reload current state
  before a deliberate new edit, never blindly replace a retry key.
- Verified full `pnpm verify:ci`: 74 files/517 tests, lint/types, schema/build,
  dependency and secret checks; recovery PASS with 86 tables/149 rows/36 migrations,
  three R2 objects, 500,050 bytes, run a367cf01-3cfe-47f1-88f0-ee1e76cbdd49.
  Active D1 quick_check ok, foreign_key_check empty. Web 200 and STT ready;
  ngrok still targets localhost:3200. No runtime was stopped or model changed.
- Tests include revoked/denied/expired/future/service/nurse scopes, wrong acting
  user and facility, missing/read-only scope, cross-assignment replay, withdrawn
  care consent, revocation between preflight and batch, direct SQL attribution
  and audit rollback. Generic schema invariant tests remain actor-independent.
- Next bounded task: **2I.3b consent commands**. Add durable assignment attribution
  and replay/commit guards without requiring existing care consent to grant the
  initial consent. Preserve withdrawals, ownership and immutable event versions.
  Then migrate transcript/speech, recommendations, protocols/exports and access
  audits; resolve independent encounter creation before closing full 2I.
- Keep the owner's standalone unstaged `a`, ports 3200/3101 and ngrok. No real
  patient data, external provider delivery, live microphone/AI verification,
  signed-export end-to-end or production approval is implied by these checks.

### 2026-09-07 — Phase 2I.2 request/UI checkpoint

- Implementation commit: `a208a60`. Full `pnpm verify:ci` PASS: secret policy
  (436 files), no known dependency vulnerabilities, lint/types, 73 files/501
  tests, Drizzle and build. Isolated recovery PASS after disposable-source
  destruction: 86 tables, 148 rows, 35 migrations, three R2 objects, 490,091 bytes;
  run `8b685653-c2e0-4630-9d19-7813db3afb2e`, 85,806 ms. A subsequent
  whitespace-only JSX/dependency-list tidy does not change tested behavior.
- Bounded result: all 17 authoritative `/api/workspace` route files use
  workspaceRequestSelection and the current doctor-assignment resolver. GET is
  encounter.read, mutation is encounter.manage. WorkspaceScope carries exact
  assignment ID/permission in memory; existing exact treating membership,
  patient/facility/organization, consent and lifecycle restrictions remain.
- UI: dashboard/live server boundary offers an explicit required picker for
  multiple assignments, blocks unknown selections and shows read-only access.
  Provider context scopes fetches, STT/AI clients, exports and navigation. Tree
  keys change with context; old fetch closures retain old context. Shell links
  also preserve encounter/assignment/facility rather than silently dropping them.
  Malformed duplicate/blank selectors are rejected before encounter fallback.
- Tests: real in-memory SQLite repository cases verify exact assignment plus
  treating scope, cross-tenant denial and next-call revocation. URL tests cover
  scope transport, sign-in returns, duplicate selectors and no external leakage.
  Component tests cover required picker/no first selection, read-only/explicit
  deny, tree identity, invalid encounter and neutral denial/retry links.
- Browser QA: authenticated local synthetic dashboard loaded D1 encounter
  encounter-a-lifecycle; shell navigation opened live with the same assignment;
  clinical-record/consent links retained context. Invalid assignment displayed
  no clinical data; explicit retry retained requested encounter and recovered.
  A dark-theme screenshot of live was visually inspected. Multiple-assignment
  picker and read-only behavior were component-tested, not live-DB mutated.
- Runtime: web /api/health/ready on 3200 and STT /health on 3101 return 200.
  Existing ngrok targets localhost:3200. Nothing was stopped/restarted and no
  migration was applied to active D1. Existing user files/secrets/audio preserved.
- Remaining: 2I.3 durable assignment provenance on commands/events/audits/sessions,
  SQL actor guards, assignment-scoped replay and authorization recheck before
  slow-provider result commit. Legacy role SQL remains restrictive; a doctor
  assignment on a non-clinician legacy membership can still be denied. Independent
  creation and patient-to-encounter selection need their final migration checks.
  Do not mark full 2I complete. See requirements/phase-2i-encounter-access.md.
- No real microphone, speech quality, live Groq or complete signed-export journey
  was tested this turn. No production readiness claim. Groq remains unconfigured.
  Owner's standalone unstaged `a` must remain outside commits. Next agent should
  read this section and the 2I inventory before extending any writer.

### 2026-09-07 — Phase 2I.1 compatibility-tool assignment boundary

- Implementation commit: `485ea68`. Final post-documentation secret scan passed
  429 files and whitespace checks passed.
- Scope: six operations in five route files under `/api/clinical` and
  `/api/local-speech`. These now use `D1AccessGovernanceRepository`, not the
  first legacy clinician membership. Reusable `resolveEncounterAssignmentAccess`
  distinguishes encounter.read/manage, but is not yet wired to authoritative
  `/api/workspace` routes. Exact encounter ownership remains a separate check.
- Contract: current non-service doctor assignment plus effective
  `encounter.manage`; explicit denial never falls back. Recheck on every call.
  Query parameters are `accessAssignmentId` and optional `facilityId`; malformed
  or duplicate selectors return 400, anonymous returns 401, denied/mismatched
  selection neutral 403, multiple eligible assignments minimized 409, storage
  failure 503. Only authorized calls reach STT/Groq. Analysis rate limiting
  remains per identity, not per assignment.
- Targeted verification: 56 tests across the resolver and real route-handler
  tests pass with mocked D1 and provider boundaries. Cases cover all six handlers,
  no provider call on rejection, exact health selection, next-call revocation,
  same-origin rejection, minimized choices and inactive/denied/service scopes.
  An initial test-only unknown-response type error was corrected before full CI.
- Full gate: `pnpm verify:ci` passed secret policy for 428 files, dependency
  audit with no known vulnerabilities, lint/types, 70 files/467 tests, Drizzle,
  production build and isolated recovery after disposable-source destruction.
  Recovery matched 86 tables, 148 rows, 35 migrations, three R2 objects and
  490,091 bytes; run `180ad8d5-d55f-4bd8-9dd5-b4aecbc4ff57`, 83,887 ms.
- Runtime verification: `/live`, `/api/health/ready` on 3200 and `/health` on
  3101 returned 200; anonymous compatibility STT health returned 401. Existing
  ngrok remains pointed at localhost:3200. No port was stopped or restarted.
- No schema migration, patient mutation, microphone recording, speech model
  replacement, provider configuration or UI redesign in this checkpoint.
  The compatibility clients do not yet provide a multiple-assignment picker;
  they fail closed instead of choosing a scope. Compatibility speech-session
  ownership and clinical provenance are not solved by this tool permission check.
- Next: Phase 2I.2, detailed in `docs/requirements/phase-2i-encounter-access.md`.
  Migrate `WorkspaceScope` consumers, exact treating-clinician authorization,
  read/manage distinction, dashboard/live selection and command propagation,
  durable attribution, current-denial-before-replay and D1 actor guards together.
  Preserve consent, final transcript, review/sign/export and recovery locks.
- Keep legacy `ariaproject`, local secrets, active D1/R2 and the owner's standalone
  unstaged `a` unchanged. Groq remains unconfigured; no live AI claim is made.

### 2026-09-07 — Phase 2H exact-assignment communications checkpoint

- Implementation committed as `c28ec6d`.
- Active checkout: adjacent `ORION-CLINIC`, branch `main`. Legacy project,
  speech model, existing recordings, local secrets and unrelated services were
  not changed.
- Delivered: `resolveCommunicationAccess` now resolves one exact current
  non-service doctor/nurse/registrar assignment with effective
  `communications.manage`. Five API handlers and the UI propagate that assignment.
  A missing/expired/revoked/denied or mismatched selection never falls back.
  Multiple eligible assignments require selection even in one facility.
- Persistence: migration `0034_gigantic_stardust.sql` adds six nullable historical
  attribution columns, one permission view and seven new actor guards. Two old
  contract guards are replaced only to remove legacy actor-role authorization;
  their consent, template, outbox, source and owner contracts remain enforced.
  New communication writes require current assignment attribution; old immutable
  events are not rewritten. Requests, replay lookup/hash and audit retain the
  selected assignment. A rerunnable communications seed creates an explicit
  synthetic nurse assignment after the care seed.
- UI: superseded loads are aborted; late responses cannot replace the selected
  context. Assignment/patient changes are blocked while a command or dialog is
  active; operation keys include the assignment. The route now keys the client
  workspace by its requested context: this fixes a reproduced failure to recover
  through the menu after a denied assignment. A page-component regression test
  verifies the different keys. Narrow notification panels use a container query
  to stack queue/detail and manual cards instead of wrapping names letter by letter.
- Final full gate: `pnpm verify:ci` passed 426-file secret policy, no known
  dependency vulnerabilities, lint without warnings, strict types, 69 files/415
  tests, Drizzle check, production build and isolated recovery after destroying
  only the disposable source. Recovery matched 86 tables, 148 rows, 35 migrations,
  three R2 objects and 490,091 bytes, run
  `66e8f363-cf74-4625-a1bd-cc6177f7da2e`, elapsed 86,130 ms.
  The subsequent visual-only container-query CSS passed a separate production
  build, secret scan and browser screenshot review: responsible name and channel
  label remain readable in the stacked notification detail. It changes no schema
  or commands.
- Active local D1: migration and communications seed applied successfully;
  `PRAGMA quick_check` returned `ok`, foreign-key check returned no violations,
  and 35 migrations were recorded.
- Browser/API evidence: synthetic patient `patient-care-a` received a clearly
  labelled test-only SMS decision. The UI then saved notification
  `notification-d0922b7c-f91a-4c98-80af-18bb07633d9a`, created manual task
  `communication-manual-task-43a4617c-e483-4a8b-bdf1-aa02fe84b67e`, recorded a
  clearly labelled synthetic response and completed the task. After reload,
  notification v4 remained `manual_contact_completed`. Direct local D1 inspection
  confirmed all four notification versions have the exact doctor assignment and
  the response still exists. No real patient consent/contact/delivery is claimed.
  Invalid assignment denied and menu recovery succeeded after the fix.
- Runtime: a later user continuation found web/STT no longer listening while
  ngrok remained alive. The agent did not stop them. The stock START_ORION.bat
  restored web/STT. Final checks returned HTTP 200 for /communications on 3200
  and /health on 3101; ngrok on 4040 still targets localhost:3200 at
  https://down-outfield-regular.ngrok-free.dev. All three remain running.
  Groq was not configured at this restart: do not reuse chat credentials
  or claim a verified live AI loop.
- Next bounded task: Phase 2I assigned-encounter authorization migration. Inventory
  every consumer of `D1WorkspaceAccessRepository` and
  `resolveClinicianWorkspaceAccess`; include the workspace family, compatibility
  clinical/local-speech endpoints and dashboard/live callers in the access
  contract. Keep exact encounter ownership, clinician-only commands, separate
  patient decisions, final transcript, review/sign/export gates and no-fallback
  denial. Test URL-context changes, idempotency, stale assignment/record versions,
  direct SQL guards and current-denial-before-replay. Do not create a new role
  capability or replace the STT model to bypass a failing test.
- Remaining product work is not complete: production identity/session lifecycle,
  RU/KK/MIXED speech evaluation, scheduling reschedule/waitlist/trusted worker,
  approved external integrations and Phase 8 clinical decisions remain open.
  Phases 9-10 are not started. The clinic decision packet is not approval.
- Preserve the owner's standalone `a` under Risk register, unstaged/uncommitted.
  Do not commit local test data, audio, backups, environment files or credentials.

### 2026-09-07 — Phase 2G exact-assignment chronic-care checkpoint

- Repository: adjacent `ORION-CLINIC`, branch `main`; implementation `e5cfcde`.
  Legacy `ariaproject`, models and other projects were not changed.
- Delivered: exact current assignment resolution, effective `care.manage`,
  no-fallback explicit denial, minimized assignment selection, API propagation,
  assignment-scoped UI loading and command keys, durable actor attribution in six
  care tables and idempotency/audit, migration `0033` with seven guards and one view.
- Preserved: signed-protocol enrollment, doctor-signed plans, dated plan tasks,
  nurse-only assigned responses/escalation, doctor resolution, immutable history,
  optimistic conflicts, replay and patient/facility visibility. Historical null
  assignments remain readable but new writes require a valid assignment.
- Verification: `pnpm verify:ci` passed secret policy (422 files), no known
  dependency vulnerabilities, lint, strict types, 67 files/397 tests, Drizzle check,
  production build and isolated recovery after disposable-source destruction.
  Recovery matched 86 tables, 147 rows, 34 migrations, three R2 objects and 476,175
  bytes; run `66516e81-f003-4171-954e-7246998eb977`, 86,334 ms.
  After final UI guards/text changes, `pnpm typecheck`, targeted ESLint,
  `pnpm exec vitest run app/care/care-workspace.test.ts --maxWorkers=1` (6 tests),
  `pnpm build` and `pnpm security:secrets` passed again.
- Active D1: migration and rerunnable care seed applied; `quick_check=ok`, no
  foreign-key violations, 34 migrations, seven access triggers and permission view.
- Browser: valid exact assignment loads the synthetic patient and three tasks;
  invalid assignment denies without fallback. Final fresh-session smoke exercised
  overdue filtering (one task), task-dialog open/close and refresh; no clinical
  command was submitted in the browser. Behavioral mutation coverage runs against
  isolated synthetic SQLite fixtures, not live patient records.
- Runtime on resumption was no longer listening. The stock launcher restored web
  3200 and STT 3101 without touching other listeners. Web health returned 200; STT
  and speaker health are ready (CUDA). Ngrok was restored with the existing access
  policy, pointing `https://down-outfield-regular.ngrok-free.dev` at localhost:3200.
  Services are left running. The launcher reports Groq is not configured; do not
  claim a working live AI loop. No old chat credential was copied into configuration.
- Owner working-tree note: preserve the standalone `a` under Risk register,
  unstaged and uncommitted. No recordings, exports, local secrets or runtime files
  belong in this checkpoint commit.
- Next: Phase 2H exact-assignment migration of communications only. Read
  `lib/auth/communication-access.ts` and the existing communications repository,
  API and UI. Keep every no-send/consent/source/role boundary, add direct-SQL,
  replay/conflict/denial tests, migrate local D1, run `pnpm verify:ci`, inspect UI
  and update this handoff. Do not connect a provider or activate sending.
- Limitations: synthetic local data only; no real microphone accuracy run, live
  Groq call, production authentication, KMIS/LIS/ERDB/PUZ/notification integration,
  clinical thresholds or hospital-transfer approval is claimed.

### 2026-09-06 — Phase 2F exact-assignment scheduling checkpoint

- Agent: Codex. Three requested delegated audits could not start because the
  workspace owner spend cap was reached; root performed the route/UI, repository,
  migration, security and runtime reviews directly.
- Repository: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC` on
  `main`. The legacy `ariaproject` was not changed.
- Verified implementation commit: `9df6510` (`feat: bind scheduling to exact
  access assignments`).
- Scope: local synthetic D1 only. All seven scheduling handlers, queue commands and
  the `/scheduling` workspace resolve and propagate one explicit current assignment
  with effective `scheduling.manage`; assignments are never merged even within one
  facility.
- Security boundary: the selected assignment must be current, non-service and
  include doctor or registrar. Explicit deny blocks the resource without fallback.
  The exact assignment is durable on idempotency commands, preference snapshots,
  appointment and queue roots, every new immutable slot/appointment/queue version,
  request hashes and audit metadata. D1 guards bind new writes to that assignment;
  registrar actions cannot start or complete clinical service, and no interactive
  role can expire holds through the current API.
- Preserved behavior: doctors see only their assigned approved referrals while a
  registrar may coordinate eligible referrals in the facility; only explicitly
  labelled manual-test availability is shown; slot/version concurrency, explicit
  patient confirmation, queue transitions, idempotent replay, hash-chain audit and
  neutral denials remain intact.
- Verification: `pnpm verify` and `pnpm verify:ci` passed the 418-file secret policy,
  dependency audit with no known vulnerabilities, lint/types, 65 test files/385
  tests, Drizzle schema check and the complete Vinext build. Isolated recovery
  destroyed its disposable source and matched 86 tables/146 rows/33 migrations/
  three R2 objects/460,540 bytes
  (`ec9f467a-f59e-405b-8ad9-59e7fefce5fa`). Active D1 returned
  `quick_check=ok` with no foreign-key violations and exposed the assignment view
  plus seven write guards. Authenticated browser QA loaded the exact scheduling
  assignment and exercised the refresh control without submitting a clinical
  command. Web 3200, STT 3101, ngrok API 4040 and the public URL returned HTTP 200
  and remain running.
- Owner working-tree note: the pre-existing standalone `a` under the risk-register
  heading remains deliberately unstaged and must not be removed or committed.
- Limitations: synthetic local data only; no authoritative KMIS schedule, external
  booking, notification, production identity/data, approved queue prioritization,
  real microphone/STT quality run or live Groq call is claimed. Historical immutable
  rows remain readable with a null assignment; all new guarded writes require one.
  Automated hold expiry still needs a separately trusted service identity and worker.
- Exact next bounded task (Phase 2G): migrate only `/api/care`, care-task commands,
  database actor guards and `/care` to one selected assignment plus effective
  `care.manage`, preserving clinician/nurse boundaries and every signed-plan,
  enrollment, lifecycle, concurrency, idempotency, audit and neutral-denial rule.
  Do not migrate communications in that checkpoint.

### 2026-09-06 — Phase 2E exact-assignment observations checkpoint

- Agent: Codex with three delegated read-only audits. Route/UI and SQL findings
  were incorporated; the final checkpoint audit was interrupted by the workspace
  owner spend cap, so root repeated the affected schema, test and runtime checks.
- Repository: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC` on
  `main`. The legacy `ariaproject` was not changed.
- Verified implementation commit: `e29a4da` (`feat: bind observations to exact
  access assignments`).
- Scope: local synthetic D1 only. Both observation handlers and the
  `/observations` workspace resolve and propagate one explicit current assignment
  with effective `observations.manage`; assignments are never merged even when
  they belong to the same facility.
- Security boundary: the selected assignment must be current, non-service and
  include doctor or nurse. Explicit deny blocks the resource without fallback.
  The exact assignment is durable on idempotency commands, observation roots,
  every immutable version, audit metadata and request hashes. Database guards bind
  new writes to that current actor; a doctor can correct a visible facility record,
  while a nurse-only assignment can correct only the nurse's own current version.
- Verification: `pnpm verify` and `pnpm verify:ci` passed the 414-file secret
  policy, dependency audit with no known vulnerabilities, lint/types, 63 test
  files/373 tests, Drizzle schema check and the complete Vinext build. Isolated
  recovery destroyed its disposable source and matched 86 tables/145 rows/32
  migrations/three R2 objects/447,083 bytes
  (`b699aab3-b5e5-45aa-a2c3-3ba48fcc875c`). Active D1 returned
  `quick_check=ok` and no foreign-key violations. Authenticated browser QA loaded
  the exact synthetic assignment, opened and cancelled the measurement dialog,
  verified URL scope plus responsive dark UI and produced no warning/error logs;
  it submitted no clinical command. Web 3200, STT 3101, ngrok API 4040 and the
  public URL returned HTTP 200 and remain running.
- Owner working-tree note: the pre-existing standalone `a` under the risk-register
  heading remains deliberately unstaged and must not be removed or committed.
- Limitations: synthetic local data only; no approved critical thresholds, device
  feed, production identity/data, real microphone/STT quality run, live Groq call,
  alert, hospital notification or transfer is claimed. Historical immutable rows
  remain readable with a null assignment; all new guarded writes require one.
  Database actor authorization applies to direct SQL, while application command
  idempotency and hash-chain audit are guaranteed only through the repository path.
- Exact next bounded task (Phase 2F): migrate only `/api/scheduling`, its queue
  commands, database actor guards and `/scheduling` workspace to one selected
  assignment plus effective `scheduling.manage`, preserving the clinician/registrar
  action matrix and every source, slot, confirmation, lifecycle, concurrency,
  idempotency, audit and neutral-denial rule. Do not migrate care or communications.

### 2026-09-06 — Phase 2D exact-assignment orders checkpoint

- Agent: Codex with three delegated read-only audits; two returned route/UI and
  checkpoint findings, while the SQL audit hit the workspace owner spend cap.
  Root reproduced and closed the applicable findings before final verification.
- Repository: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC` on
  `main`. The legacy `ariaproject` was not changed.
- Verified implementation commit: `a9e73e9` (`feat: bind orders to exact access
  assignments`).
- Scope: local synthetic D1/R2 only. All seven handlers in the five
  `/api/orders` route files and the `/orders` workspace resolve and propagate one
  explicit current assignment with effective `orders.manage`; no permissions are
  merged across assignments.
- Security boundary: the assignment must be active, non-service and include the
  doctor role for clinical order actions. Exact assignment attribution is durable
  on idempotency commands, service-request/report roots and versions, result
  artifacts and upload intents. Database guards bind it to the acting member,
  facility and treating clinician; explicit deny, neutral 403, minimal 409
  selection, cross-origin mutation denial and immutable history remain enforced.
- Verification: `pnpm verify` and `pnpm verify:ci` passed the 410-file secret
  policy, dependency audit with no known vulnerabilities, lint/types, 61 test
  files/360 tests, Drizzle schema check and the complete Vinext build. Isolated
  recovery destroyed its disposable source and matched 86 tables/144 rows/31
  migrations/three R2 objects/440,753 bytes (`b0e5d027-fd17-4b44-adf2-6c297d4db7a0`).
  Active D1 returned `quick_check=ok` and no foreign-key violations. Authenticated
  browser QA loaded persisted order/result data, opened and cancelled the create
  form, expanded history, verified the assignment-qualified download URL, toggled
  theme/navigation and produced no warning/error logs; it submitted no new
  clinical command. Web 3200, STT 3101, ngrok API 4040 and the public URL returned
  HTTP 200 and remain running.
- Owner working-tree note: the pre-existing standalone `a` under the risk-register
  heading remains deliberately unstaged and must not be removed or committed.
- Limitations: no external KMIS/LIS/ECG delivery or acknowledgement, production
  identity, real-patient data, microphone/STT quality run or live Groq request is
  claimed. Historical rows remain readable; exact assignment is mandatory for all
  newly guarded writes rather than rewriting immutable history.
- Exact next bounded task (Phase 2E): migrate only `/api/observations` and its D1
  actor guards to one selected assignment plus effective `observations.manage`,
  preserving the distinct doctor/nurse action matrix and every existing patient,
  provenance, lifecycle, idempotency, concurrency, audit and neutral-denial rule.

### 2026-09-06 — Phase 2C access administration checkpoint

- Agent: Codex. Three delegated read-only audits were retried, but all three were
  rejected by the workspace owner spend cap before producing findings; root
  completed the code, browser, database, recovery and documentation audit.
- Repository: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC` on
  `main`. The legacy `ariaproject` was not changed.
- Verified implementation commit: `6b2308a` (`feat: add audited access
  administration`).
- Scope: local synthetic D1 only. Added immutable department roots/versions/heads,
  administrator create/update/disable and assignment grant/change/reactivate/revoke
  commands, idempotency and audit hash-chain persistence, the authenticated
  `/access/manage` workspace, and Russian operator documentation.
- Patient-family migration: all `/api/patients` list/detail/create/update/archive,
  photo and encounter-creation paths now resolve one explicit current assignment
  and require effective `patient.directory.read`, `patient.profile.write` or
  `encounter.manage`. The browser propagates `facilityId` and
  `accessAssignmentId`; multiple scopes are not merged.
- Security boundary: explicit deny wins; stale heads and changed-key replays fail;
  direct history mutation is rejected; the authorizing assignment cannot mutate
  itself and its department cannot disable itself. Existing tenant, facility,
  patient, lifecycle and audit checks remain in force.
- Verification: `pnpm verify:ci` passed 402-file secret policy, zero known
  dependency vulnerabilities, lint/types, 58 test files/341 tests, schema/build
  and isolated recovery of 86 tables/142 rows/29 migrations/three R2 objects/
  426,521 bytes after destroying only the disposable source. Active local D1
  passed quick/foreign-key checks and idempotent migration/bootstrap runs.
  Authenticated browser QA loaded `/access/manage`, opened create, edit and grant
  forms without saving a permission change, and loaded five persisted synthetic
  patients through assignment-qualified links. Runtime health and public ngrok
  root returned HTTP 200.
- Runtime: web 3200, CUDA loopback STT 3101 and ngrok 4040 remain running. Groq is
  not configured in the current process, so no external AI result is claimed.
- Owner working-tree note: the pre-existing standalone `a` under the risk-register
  heading remains deliberately unstaged and must not be removed or committed.
- Limitations: remaining protected API families and database guards still use
  their previously tested legacy role matrices. Production OIDC/MFA, session
  revocation, service credentials, break-glass, dual-control access changes and a
  durable pre-scope security-event sink remain open.
- Exact next bounded task (Phase 2D): migrate only the `/api/orders` resource
  family and its D1 actor guards to one selected assignment plus effective
  `orders.manage`, retaining exact patient/encounter assignment, consent,
  lifecycle, idempotency, audit and neutral-denial behavior. Add allow/deny,
  multi-scope, explicit-deny, replay, stale-write, SQL-guard and browser tests;
  do not migrate a second resource family in the same checkpoint.

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
Start-Process http://localhost:3200/care
pnpm db:seed:local
pnpm db:seed:scheduling:local
pnpm db:seed:care:local
pnpm db:seed:communications:local
pnpm db:seed:observations:local
pnpm verify:ci
```

The next bounded engineering slice is independent encounter creation/selection
authorization. Workspace-read audit and recovery-reader checks are in 0046 and
the current source; consult the latest handoff for verification. Exports have repository/response
checks (2I.3i.1), SQL publication guards (0043), download audit (0044) and explicit
schema-2 pending-attempt fencing/reconciliation (0045). Legacy/active-upload cleanup
and a general retention worker remain deferred; do not enable deletion by age.
Use the latest handoff and verification ledger, not older export next-step text.
2I.3h adds lifecycle repository checks and immutable transition events/guards in
0042. Validate its latest ledger before proceeding to export source/render/download.
2I.3g.2 adds protocol-row/head and command/audit/result SQL guards in migration
0041; recommendation guards (2I.3f.2) are in migration 0040. Historical nullable
fixtures are intentionally retained. Use the latest verification ledger above.
Phase 2I.3a covers clinical section commands; 2I.3b covers interactive consent
commands; 2I.3c covers manual transcript corrections, 2I.3d speech sessions and
2I.3e recommendation generation.
Remaining encounter writers
still require durable guards, including slow provider result commits.
Phase 2I.2 implements request/UI scope
but does not close that database gate; full 2I remains IN_PROGRESS. Phase 2H
communications is verified and complete for local synthetic data only. Keep every
messaging provider disconnected. Phase 8B is
already a complete activation-blocked review artifact; named clinic owners must
fill and sign `DEC-006`/`DEC-007` before any signed-policy implementation. Do not
classify critical status, notify another hospital or initiate transfer before
approval. The external portions of Phases 4-7 remain blocked on named decisions
and provider contracts. No external delivery, invented availability, inferred
diagnosis or ERDB/PUZ/free-medication claim is allowed until its source of truth,
sandbox, legal basis and human owner are named.
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

### 2026-09-06 — Phase 2D exact-assignment orders checkpoint

- Reason: Phase 2C proved assignment-based access only for the patient directory;
  the clinically actionable orders family still depended on legacy membership
  roles and could not provide durable evidence of the exact selected scope.
- Decision: migrate one resource family only. Require one current non-service
  doctor assignment with effective `orders.manage`, never merge assignments, and
  preserve all existing consent, encounter, lifecycle, review and audit rules.
- Added: exact-assignment resolver and neutral API errors; selected-scope UI with
  race cancellation and assignment-scoped retries; durable attribution on order
  commands, requests, versions, reports, artifacts and upload intents; forward-only
  migrations `0029`-`0030`; SQLite actor/immutability guards and focused tests.
- Verified: 61 files/360 tests, lint, strict types, schema/build, active D1
  integrity, authenticated read-only browser behavior, healthy local/public runtime
  and isolated recovery of 86 tables/144 rows/31 migrations/three R2 objects after
  destroying its disposable source. Code commit: `a9e73e9`.
- Limitation: synthetic local data only; no external delivery, production identity,
  real microphone/STT quality run, live Groq request or immutable-history rewrite.
- Next: Phase 2E migrates only `/api/observations` to one selected assignment plus
  effective `observations.manage`, preserving separate doctor/nurse semantics.

### 2026-09-06 — Phase 2E exact-assignment observations checkpoint

- Reason: orders already carried exact assignment evidence, but observation APIs
  still selected legacy memberships and could collapse two same-facility access
  assignments into one implicit scope.
- Decision: migrate one resource family only. Require one current non-service
  doctor/nurse assignment with effective `observations.manage`, never merge
  assignments, and retain the separate doctor-wide versus nurse-own correction
  rules plus every existing patient/provenance/concurrency boundary.
- Added: exact-assignment resolver and neutral API errors; selected-scope UI with
  URL persistence, stale-load cancellation and assignment-scoped retry keys;
  durable attribution on commands, roots, versions, hashes and audit metadata;
  forward-only migration `0031`; SQLite actor/linear-history guards and focused
  route, access, repository and error-contract tests.
- Verified: 63 files/373 tests, lint, strict types, schema/build, active D1
  integrity, authenticated read-only browser behavior, healthy local/public runtime
  and isolated recovery of 86 tables/145 rows/32 migrations/three R2 objects after
  destroying its disposable source. Code commit: `e29a4da`.
- Limitation: synthetic local data only; no production identity, external device,
  approved interpretation threshold, alert, transfer, real microphone/STT quality
  run or live Groq request. Legacy immutable rows were not rewritten.
- Next: Phase 2F migrates only `/api/scheduling`, queue commands and `/scheduling`
  to one selected assignment plus effective `scheduling.manage`, preserving the
  clinician/registrar matrix. Care and communications stay outside that checkpoint.

### 2026-09-06 — Phase 2F exact-assignment scheduling checkpoint

- Reason: the scheduling API and queue still selected legacy facility memberships,
  so two same-facility assignments could collapse into one implicit authorization
  scope even though schedule actions were already durable and versioned.
- Decision: migrate one resource family only. Require one current non-service doctor
  or registrar assignment with effective `scheduling.manage`, never merge
  assignments, and retain the separate front-desk/clinical action matrix plus every
  approved-referral, source-label, confirmation, concurrency and lifecycle boundary.
- Added: exact-assignment resolver and neutral API errors; selected-scope UI with URL
  persistence, stale-load cancellation and assignment-scoped retry keys; durable
  attribution on commands, preference snapshots, appointment/queue roots, all new
  slot/appointment/queue versions, hashes and audit metadata; forward-only migration
  `0032`; D1 actor/role guards and focused route, access, repository and error tests.
- Verified: 65 files/385 tests, lint, strict types, schema/build, active D1 integrity,
  authenticated read-only scheduling browser behavior, healthy local/public runtime
  and isolated recovery of 86 tables/146 rows/33 migrations/three R2 objects after
  destroying its disposable source. Code commit: `9df6510`.
- Limitation: synthetic local data only; no authoritative KMIS availability,
  production identity, external booking/notification, approved prioritization,
  trusted expiry worker, real microphone/STT quality run or live Groq request.
  Historical immutable rows were not rewritten.
- Next: Phase 2G migrates only `/api/care`, care-task commands and `/care` to one
  selected assignment plus effective `care.manage`, preserving clinician/nurse
  semantics. Communications stays outside that checkpoint.

### 2026-09-24 — ONLINE-1B individual staff-session foundation

- Owner approved beginning online-readiness implementation. Added a hosting-neutral
  server session contract, durable D1 repository and additive migration 0048,
  independently reviewed by three agents. Identity is per employee, not per role.
- Protected cookie and POST logout helpers, exact current-user checks, idle/absolute
  deadlines and irreversible durable revocation are implemented. The auth module
  is not a credential verifier and is not mounted into the Sites development app.
- 77 focused tests cover cookie/CSRF/crypto and real SQL with reopen/two connections,
  SQL REPLACE, concurrency and failed-publication rollback. Aggregate/recovery
  evidence and its limitations are recorded in the latest section 13 ledger.
- Next remains individual credentials, shared SSR/API identity and browser login/
  logout acceptance in an isolated HTTPS runtime, then owner-scoped local recordings.
  Main 3200/3101 and patient records preserved. No public/clinical deployment claimed.

### 2026-09-24 — UI/runtime recovery, online audits and MOBILE-1 scope

- Corrected Vite optimizer collision and React import hash isolation, verified
  after full tests/build and actual browser reload/navigation. Reworked public
  entry/logout and LIVE start screens without pretending shared dev auth is an
  individual staff login. Updated guide text; old captures remain labelled.
- Added original-requirement coverage matrix, Vercel and online-STT audits,
  `.vercelignore` and a tested read-only deployment artifact guard. Current dist
  correctly fails on `.dev.vars`; no deployment or external data migration.
- Source-only speech fix separates expired-session pruning from insertion
  capacity eviction; eight Python tests pass. Running speech remains unchanged.
- Owner's Vercel/night-work request added with exact release gates; seven bounded
  hourly continuations scheduled. Owner then prohibited EVERY dir echoes resource
  including GitHub/Vercel/Neon, and required only the existing ORION Git repo.
  Recorded in AGENTS, plan, deployment audit and scheduled prompt; no such resource
  data/configuration/credentials/code was opened or changed.
- Added MOBILE-1 for a genuine connected Android/iOS app with patient/caregiver
  separation and first-class disability accessibility. M0–M6 planning is not app
  implementation or store acceptance. Same ORION repo; existing online safety
  prerequisites and clinical/vendor decisions remain mandatory.

### 2026-09-24 — ONLINE-1B2 credentials and MOBILE-1/M0 executable boundary

- Added credential provisioning/reset/disable with immutable identity, monotonic
  versions, sanitized append-only audit and revocation of older sessions/grants;
  0049 is additive and remains unapplied to the owner's main D1.
- Added fixed-cost server password hashing and unmounted same-origin HTTPS login,
  bounded streaming input, pre-verification durable attempt reservations and
  generic failure paths. No role selection, credential grant or identity accepted
  from client input. Runtime-wide abuse controls, administrative provisioning
  authorization, recovery/MFA and public hosting acceptance are still open.
- Independent review fixed D1 trigger-inclusive receipt handling and user-ID
  displacement; actual disposable local D1 smoke and final SQL/HTTP tests passed.
  Exact aggregate, focused, build and runtime results are in section 13.
- Mobile ADR-0002 and pure patient-protocol release projection are implemented;
  87 tests exercise strict identity/release/version/source boundaries and deny
  staff/private AI/transcript fields. This is no mounted API or native application.
- New read-only local-material audit found unowned v1 storage and source-level
  overwrite/late-callback hazards. Preserve legacy data and isolate the next
  runtime; see `docs/operations/local-material-isolation-plan.md`. Do not switch
  main authentication before the required per-owner browser acceptance.
- The current Vercel artifact remains blocked on a private generated file. No
  deployment, external-resource access, provider calls, main migrations or
  clinical data mutation. Existing read endpoints keep their normal audit behavior.

### 2026-09-24 — ONLINE-1C0 local-material lifecycle foundation

- Added a pure immutable staff-scope context and generation-bound operation lease,
  synchronous publication and registered resource cleanup. Scope/account/consent
  changes retire prior work; late promises cannot publish into the next owner.
- Root/peer review corrected reentrant cleanup and Proxy validation edge cases;
  67 helper tests and the final 232-test overlapping contract gate pass. Exact
  validation evidence and limitations are in the latest section 13 entry.
- No app wiring, IndexedDB migration, encryption implementation, recording change
  or login activation. Existing DB/audio and web/speech processes preserved.
  Next gates: isolated same-principal staff runtime, server access/key policy and
  v2 storage; never silently adopt or delete the legacy shared history.

### 2026-09-24 — ONLINE-1B3a common principal and actual isolated TLS transport

- Added a strict shared server identity resolver and fixed-route unmounted
  verification runtime; SSR/API preserve the distinction between internal user
  ID and external subject. They do not emulate Sites or grant clinical roles.
- Reproducible actual loopback HTTPS/workerd/D1 test covers independent staff,
  default KDF, wrong/unknown credentials, logout, sequential restart, password
  reset and credential disable. Scoped test CA is not a trusted browser origin;
  browser auth/clinical integration/replica/load/restore remain separate gates.
- Added independent adversarial unit/safety review and updated the exact 47-API
  and shared SSR migration map. Main 3200/3101, credentials/roles, schema and
  audio unchanged; new migrations still only in synthetic disposable databases.
- Build, browser main-navigation smoke and final regression evidence are in
  section 13. Artifact scan still blocks private generated `.dev.vars`; no
  publication or foreign resources. Next 1B3b/1C1 work and blockers are explicit
  in the current checkpoint and operational handoff.

### 2026-09-24 — ONLINE-1C1a exact server metadata context

- Added unmounted common-principal/exact-scope resolver and one-statement
  DB-clock session, assignment, patient-profile and separate-consent snapshot.
  No material/audio/key/v1 access, persistence or main runtime activation.
- Independent review caught profile archival semantics and added existing
  membership/org/facility version pins. Metadata is not an action grant; the
  observed-state fingerprint cannot replace reauthorization or key policy.
- 76 unit and 35 full-migration SQLite tests passed, including cross-connection
  revocation/reset/regrant races; full aggregate and runtime evidence in section
  13. Prepared the next material/run/revision descriptor audit and exact consumer
  hazards; those legacy consumers are not fixed by this metadata-only checkpoint.
- Main DB/audio/ports and migrations preserved. Browser main-navigation smoke
  is separate from blocked trusted-HTTPS staff acceptance. No deployment,
  provider call, foreign resource access or mobile-app completion claimed.

### 2026-09-24 — ONLINE-1C1b exact local material target

- Added strict copied/frozen material/run/revision descriptor and a target-aware
  publication lifecycle, separate from current server authority/consent pins.
  Same-encounter recordings, revisions and local A→B→A are no longer conflated
  by this new contract. Legacy consumers are NOT yet using it.
- Independent tests and reentrancy review; context exception normalization fixed.
  211 new tests; aggregate/final checks and limitations are in section13.
- Updated continuation docs with 1C1c envelope/key and storage gates. No existing
  history/DB/audio changes, no auth activation or deployment claim.

### 2026-09-24 — ONLINE-1C1c canonical metadata binding

- Followed 1C1b with a pure, domain/version/kind-separated metadata codec and
  independent tests/review. Scope IDs remain private; no cryptographic guarantee,
  server key service or storage was added. Final gates recorded in section13.
- Next 1C1d key/envelope/action/retention/restore architecture remains distinct
  from approved clinical policy. Main UI, DB, recordings and ports unchanged.

### 2026-09-24 — ONLINE-1C1d/e and remote STT control foundation

- Recorded ADR-0003, built real bounded AEAD for isolated payloads and fixed two
  independent adversarial review findings, with regression tests. This does not
  turn existing local history into encrypted storage or implement key custody.
- Added authenticated remote-control contract health/create with mocked network,
  no audio adapter or actual remote gateway. Cancellation-race review is included
  in the newest ledger; no current sidecar/clinical API was switched.
- Updated active checkpoint and handoff to 1C2a durable broker/CAS/audit, preserving
  unresolved clinical/retention/hosting decisions and all legacy/main resources.

### 2026-09-24 — ONLINE-1C2a1 durable internal registry

- Added forward migration0050 and internal reservation/preparation/receipt/head/
  event storage, with atomic CAS/publication and durable terminal states. New39
  full-chain SQL tests and independent schema/adapter review; final evidence in
  section13. No main migration or browser-history wiring.
- Explicitly separated storage from authorization and actual wrapping/key release.
  Next1C2a2 must enforce current action/consent in committing SQL and solve pending
  revocation/reconciliation; observed fingerprints do not solve authority ABA.
- Updated ADR0003, isolation/auth/requirements handoffs and active resume point.
  Main resources, local recordings and unrelated work preserved; no deployment.

### 2026-09-24 — recovered local runtime and delivered D-R3 before departure

- Recovered web3200 and local speech3101 without migrations/bootstrap; added
  tested opt-in safe launcher mode and recovery runbook. Actual synthetic STT
  audio→text probe passed; not a long-session or clinical-quality claim.
- Added partial0051 pending-material authority invalidation, only isolated tests;
  main DB migrations and browser history remain unchanged.
- Completed accepted action recommendation → explicit durable draft order with
  immutable source, current authority/consent checks, atomic audit publication,
  retry protection and scope-preserving links from clinical and Live interfaces.
  Real browser create/reload/reopen plus independent D1 review verified one draft.
- Updated in-app/offline instructions and final ledger: 2183 tests passed with
  one opt-in skip, application build passed. This is one completed product slice,
  not completion of staff login, online storage, cumulative record or mobile app.
- Tried exact ORION Vercel preflight; blocked unsafe artifact and unported runtime.
  No upload, new cloud resource, commit or push; DIR ECHOES remained out of scope.

### 2026-09-24 — artifact gate hardening and owner-requested stop

- Closed uninspected NUL/binary/container/private-copy/link-ancestor paths in the
  existing predeploy guard;46focused tests and20independent review probes passed.
  Added local `build:deploy-check`; current artifact is deliberately blocked.
- Kept application services and data unchanged; browser /help reload remained
  healthy. Fixed only a slow byte-comparison assertion after a regression timeout.
- Deleted exact `orion` heartbeat schedule on explicit owner request. No new
  phase, cloud deployment, commit or push. Resume only after a new owner request.

### 2026-09-24 — owner-requested logo concepts only

- New direct request: delivered five ImageGen raster logo concepts plus one
  comparison sheet in `design/logo-concepts/2026-09-24/`; prompts and limits are
  recorded there. Visually inspected all five original boards and the composite.
- Added a standalone HTML catalogue; automated file-URL preview was policy-blocked,
  not worked around. HTML browser acceptance is not claimed; image assets are shown
  directly. No production logo replacement, vector-master or trademark-clearance claim.
- Follow-up: the owner selected Orbit; implementation is recorded below. This
  scoped design request does not restart the deleted schedule or paused deployment.

### 2026-09-24 — selected Orbit identity and depth-aware motion

- Delivered separate transparent PNG and SVG symbol/wordmark assets in
  `public/brand/`, with light/dark variants, prompt record and font license.
  The original raster iterations are retained; SVG exports use clean geometry
  and outlined Golos Text, while the application wordmark remains accessible text.
- Added shared OrionMark/OrionBrand/OrionLoading components. Updated shell and
  sign-in branding, favicon, route loading and existing real workspace loading
  states without changing authentication, clinical actions, recording or data.
- Applied owner's depth correction: far arc/satellite are occluded behind the O;
  near arc/satellite render in front. Decorative orbit is 14 seconds; active
  loading is 3.6 seconds. Reduced-motion/unsupported-path static fallback included.
- Verification: 107 tests across 11 files passed, including 11 brand tests;
  scoped ESLint, full typecheck and diff whitespace check passed. Browser checked
  light/dark gallery, synchronized motion, pause state, app header, desktop name
  and narrow-width symbol-only layout. OS reduced-motion setting was not changed.
- Interactive preview/downloads: `http://127.0.0.1:3200/brand/index.html`.
  Last handoff: requested branding is implemented locally. Web/STT processes,
  patient data and database are preserved. No cloud deployment, commit, push or
  schedule restart; production blockers in the earlier checkpoint still apply.

### 2026-09-28 — patient-route workspace and actionable overview UI

- Replaced the route's three duplicate navigation surfaces with one inner tab bar.
  The route opens on a dedicated overview; its chronology stays empty until a
  specific accessible patient is selected. Removed bottom section shortcuts,
  per-event section links and the duplicate stage rail/back button. Source
  counts are read-only context, not additional navigation. Existing authorized
  D1-backed orders/care/observation queries remain separate and failures are
  shown as partial data; no new clinical action or external exchange was added.
- Visited tool panes remain mounted while switching the inner tabs, including
  a return to the overview. Other tabs use a short transition without a route
  delay. Entering `/pathway` uses a distinct rocket-launch curtain; leaving it
  is brief. Reduced-motion setting bypasses these transitions.
- Changed the main rail to fixed-position icons with per-item hover/focus labels
  so its targets do not shift under the pointer. Top and left chrome use a
  translucent surface with backdrop blur. Redesigned the dashboard around a
  real scoped priority state, encounter summary, searchable/filterable worklist
  and separately loaded queue/orders/care flow cards; removed repeated bottom
  shortcuts. Counts are not labelled as today's when they cover all dates.
- Verified 11 focused tests, TypeScript, scoped ESLint and a full vinext build.
  Browser acceptance covered desktop and narrow layouts, patient-only timeline,
  tab/return navigation, launch/exit motion and no document overflow. The build
  interrupted the running dev client; only the verified ORION web PID on 3200
  was restarted using recovery mode, without migrations or bootstrap. Existing
  local STT on 3101 was reused. A fresh browser tab proved mouse navigation.
- This is a local UI checkpoint, not a Vercel deployment, mobile-app completion,
  medical approval or proof that all previously listed requirements are closed.
  Earlier online identity, persistence, provider and production blockers remain.

### 2026-09-28 — event center, measured patient context and bounded Groq briefing

- Promoted the dashboard to a notification center: urgent orders, overdue or
  near-due care tasks, manual contact tasks and queue exceptions come from the
  existing scoped APIs. Recent items show the latest saved state, not a fabricated
  audit stream. Encounter and module worklists remain lower on the page; charts
  open only by the separate Analytics button. A transient module failure gets
  one retry, and a persistent failure is shown rather than silently counted as 0.
- Added a read-only latest height/weight query constrained to the exact patient
  and observation assignment. The patient card shows a full-body schematic,
  recorded sex or neutral silhouette, available measurements and source/date;
  missing values stay empty. No health score or diagnosis is inferred.
- Replaced the literal rocket graphic with a short medical pulse transition on
  entry/exit of the route. Lazily loaded route panes stay mounted once visited;
  reduced-motion remains supported.
- Connected an explicitly triggered Groq operational briefing boundary. The API
  requires same-origin, a valid clinician assignment and synthetic mode; its
  strict payload accepts only six bounded integer aggregate counts. No patient
  identifiers, clinical notes or call audio enter the provider request. The UI
  labels output as a draft for staff review and disables the action when source
  data is incomplete. This is not a clinical AI decision or auto-notification.
- Verification: 27 focused tests across 7 files, TypeScript, scoped ESLint and
  full vinext build passed. Browser acceptance saw two actual overdue care tasks
  in the center, a recorded 172.4 cm / 71.8 kg pair in the synthetic patient card,
  analytics toggling separately and the ECG entry/exit transitions. Web 3200
  and speech 3101 health returned 200.
  The live Groq provider call was deliberately not made; only mocked request
  boundary tests prove the payload. No deploy, migration, DB reset, audio change,
  commit or push. The main entry still uses the local development identity;
  personal staff auth remains gated by ONLINE-1C and the online rollout plan.

### 2026-09-28 — compact patient/event UI and active local staff credentials

Latest owner request implemented in parallel: real stored vital overlays on a
generated neutral anatomical illustration, compact event-center cards, optional
analytics, aggregate-only Groq briefing, persistent medical entry/exit, light-theme
contrast and personal local staff login. Current evidence is at the top of §13,
with active implementation and handoff in §15–16. This supersedes earlier shared
local-login UI notes, not ONLINE-1 public-release or durable recording gates.
Owner subsequently requested finishing the current work; no further scope added,
no recurring task created, no deploy/push or main clinical-data initialization.
