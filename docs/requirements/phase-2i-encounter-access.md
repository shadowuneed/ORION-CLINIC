# Phase 2I — encounter authorization migration

Status: IN_PROGRESS. Synthetic local data only. This is not a new identity
provider, clinical permission grant, speech model change or production release.

## 2I.1: compatibility tool boundary

Implemented in `lib/auth/encounter-assignment-access.ts` and
`lib/auth/clinical-tool-access.ts`:

- Resolve one current non-service doctor assignment from the current D1 head.
- Require effective `encounter.manage`; legacy membership role is not authority.
- Accept `accessAssignmentId` and optional `facilityId` in the request query.
- Reject blank, duplicate, control-character and oversized explicit selectors.
- Return neutral 403 for unknown, denied, expired, revoked or mismatched scope.
- With multiple eligible assignments, return 409 and only assignment ID,
  organization/facility/department display names and facility ID. Never choose
  the first assignment or combine permissions.
- Recheck before each provider call; D1 failures return 503 and no provider call.
- Keep the analysis rate limit keyed to identity, not assignment: switching
  assignments does not provide an additional quota.

Wired handlers (six operations, five files):

| Resource | Methods | 2I.1 status |
| --- | --- | --- |
| `/api/clinical/analyze` | POST | exact tool assignment |
| `/api/clinical/research` | POST | exact tool assignment |
| `/api/local-speech/health` | GET | exact tool assignment |
| `/api/local-speech/session` | POST, DELETE | exact tool assignment |
| `/api/local-speech/transcribe` | POST | exact tool assignment |

These compatibility routes are not authoritative encounter repositories.
Assignment authorization does not prove patient consent, treatment relationship,
session ownership or durable clinical provenance. Their existing compatibility
limitations remain; use `/api/workspace` for the authoritative encounter flow.
The dashboard/live clients now receive the exact selection from their page
boundary. Direct API callers still receive 409 if they omit an ambiguous scope.
Do not introduce a first-assignment client fallback to hide that state.

## 2I.2: request and UI checkpoint (2026-09-07)

Implemented: all 17 `/api/workspace` route files use the shared request selector
and current doctor-assignment resolver. GET requires encounter.read; mutations
require encounter.manage. The existing exact treating-membership, organization,
facility and consent/lifecycle checks remain in place. WorkspaceScope carries
the selected accessAssignmentId and permission in memory.

Dashboard and live pages render an explicit multiple-assignment picker, deny
unknown selections without fallback and explain read-only access. Their clients
propagate the same selection through requests, speech calls, export links,
sign-in return paths and dashboard/live navigation, including the shell menu.
Context changes remount the workspace; scoped fetch closures retain their own
selection instead of reading a changed global URL. Explicit malformed encounter
or assignment selectors are rejected, not silently removed.

This is a partial implementation of the originally combined 2I.2 gate:
**durable command/event/session/audit attribution and database actor guards are
not implemented by this checkpoint.** Legacy clinician-role SQL is still an
additional restrictive gate. A doctor assignment on a non-clinician legacy
membership can therefore remain denied. Do not remove that SQL before replacing
it with verified exact-assignment guards. Existing encounter-create compatibility
still requires a source encounter; independent creation remains below.

No applied migrations or immutable history were changed. No active clinical
records, consents, audio, provider settings or speech model were changed.

## Remaining consumers: 2I is not complete

| Consumer | Required migration |
| --- | --- |
| `lib/auth/workspace-access.ts` and `lib/repositories/workspace-access.ts` | exact assignment plus exact treating clinician; no legacy role authority |
| `/api/workspace` GET | encounter.read; minimized selected context, audit attribution; preserve consent-filtered transcript and recovery snapshot |
| `/api/workspace/encounters/create`, `/transition` | encounter.manage; creation separately authorized without requiring a pre-existing encounter |
| `/api/workspace/consents/command` | encounter.manage; preserve separate current consent heads and version checks |
| `/api/workspace/sections/command` | encounter.manage; human review, explicit absence, signed-record lock |
| `/api/workspace/transcript/correct` | encounter.manage; immutable correction lineage |
| `/api/workspace/transcript/speech/health`, `/session`, `/transcribe` | exact assignment, encounter, ownership, lifecycle and consent; session attribution |
| `/api/workspace/recommendations/generate`, `/edit`, `/decision` | encounter.manage; exact acknowledged transcript, durable analysis, pending drafts, human decisions |
| `/api/workspace/protocols/draft`, `/sign`, `/amend` | encounter.manage; immutable signed snapshots and amendments |
| `/api/workspace/exports/generate`, `/download`, `/reconcile` | appropriate read/manage permission; immutable artifact, exact source, read audit and explicit scoped cleanup fence |
| `app/authenticated-clinic-page.tsx` | remove legacy clinician capability lookup; shell visibility never substitutes for API authorization |
| dashboard, `/live`, patient-to-encounter links, compatibility clients | selection/URL propagation, no stale-response context replacement, no stream reuse across assignments |

## 2I.3a — clinical section write boundary

Implemented for `clinical_section.command` only: exact current assignment is
required at repository entry, before completed replay, retries and commit. The
assignment is included in request hashes, command rows, new section versions,
provenance and hashed audit metadata. Migration 0035 adds a nullable historical
column, a current-assignment permission view and transactional actor guards.
The guards preserve exact treating-doctor ownership, active patient, care consent
and encounter lifecycle. Missing/read-only/expired/revoked/denied scopes fail closed.

Historical rows are not backfilled. A legacy command without assignment cannot
be replayed as a new attributed command; reload the current section and resolve
its current version before a fresh edit. Initial version-one creation and service
AI drafts retain their existing boundaries and are NOT covered by this migration.
Read audits, transcript, speech sessions, recommendation generation and
decisions, protocols, exports and independent creation remain open below.

## 2I.3b — consent command authorization

Implemented current-assignment checks at repository entry, replay, retry and
commit; assignment is stored on consent events, command rows, hashes and audit
metadata. Migration 0036 guards attributed events and every interactive consent
command/audit/result. No pre-existing care consent is required, including for
initial care grant or withdrawal. Historical/fixture and independent creation
events may still have NULL attribution; their separate writer remains a later
gate. Do not infer protection of all direct consent-event SQL from command tests.

## 2I.3c — transcript correction commands

Manual corrections now store assignment on the segment version, command and
hashed audit metadata. Current access, editable encounter and care/storage
consents are checked before replay, retries and commit. Migration 0037 guards
attributed segments plus correction command/audit/results, using current consent
heads and current assignment at database execution time. Original text/timing
and role history remain intact. Unattributed raw ingestion and legacy fixtures
retain their existing boundaries; do not claim every raw SQL writer is migrated.

## 2I.3d — speech session ownership

Implemented exact assignment on runs, scoped use/replay/cleanup, current rights
and consents before text replay and delayed result commit. Migration 0038 guards
attributed runs/results and ingest audits. Provider result session/index must
match. Cleanup requires ownership but not continuing audio consent. Legacy NULL
sessions are not adopted: start a new session after migration. Existing provider
timeouts/cleanup remain unchanged; no new trusted expiry worker or live microphone
verification. Raw fixture writes retain existing boundaries. Models/timings unchanged.

## 2I.3e — recommendation generation

Implemented exact assignment on analysis runs, command hashes/rows and audits;
current rights, lifecycle and care/storage/external-AI consent are checked before
replay and delayed result persistence. Migration 0039 guards attributed runs,
completion and interactive command/audit/results. Transcript snapshot checks and
unapproved drafts remain. Failure cleanup may mark the same owned run failed after
revocation, but cannot store a successful provider output. Historical unattributed
fixtures are unchanged and not adopted by interactive replay.

## 2I.3f.1 — recommendation repository authorization

Implemented current assignment/user, care consent and in-progress encounter checks
at edit/decision entry, retry, replay and immediately before batch. Commands and
hashed audit metadata now retain assignment. Unattributed legacy decision replay
fails closed: reload current state before a deliberate new action; history remains.
Existing immutable derivatives and accept/reject/restore behavior are preserved.

## 2I.3f.2 — recommendation database guards

Migration 0040 retains the exact assignment on derivative and decision rows.
Attributed inserts require current assignment, treating clinician, active patient,
in-progress encounter and care consent. Interactive command, result and audit
guards bind matching assignment/member/resource; decision audits name the exact
decision even for restore (whose current-decision head is intentionally null).
Tests cover pre-batch revocation rollback, direct attributed SQL rejection,
immutable attribution, mismatched result/audit and accept/restore/reject history.
Historical nullable attribution is preserved for fixtures, not a blanket ban on
all raw unattributed SQL. Production DB access remains trusted and restricted.

## 2I.3g.1 — protocol repository authorization

Draft, sign and amend now require the exact current encounter assignment/user,
active patient, care consent and compatible lifecycle at entry/retry/replay and
before batch. Commands retain assignment in request hashes, rows and audit
metadata. Unattributed old command replays fail closed without rewriting history.
Successful same-assignment replay remains possible after the command's lifecycle
transition. Source snapshot, section review and transcript consent checks remain.
Tests cover missing/read-only/wrong actor, cross-assignment replay, revocation
after source reads before saving, immutable signing/amendments and replay denial.

## 2I.3g.2 — protocol database guards

Implemented in forward-only migration 0041: assignment attribution on protocol
versions/amendments, current authority and care consent at row/head writes,
processing-only command insertion, exact final-state audit and result guards.
Draft changes in_progress -> review; signing review -> finalized; amendments
finalized/amended -> amended. Guards respect the repository statement order.
Response protocol/encounter identifiers, versions, hashes and signature fields
must match stored rows. Replay additionally verifies the scope encounter.
Historical nullable rows remain unchanged; direct unattributed fixture writers
are explicitly not covered. Normal interactive commands cannot adopt those rows.
See the master-plan verification ledger for the final test/migration evidence.

## 2I.3h — encounter lifecycle commands

`D1EncounterLifecycleRepository.recordTransition` now checks current exact assignment
at entry/retry/replay/pre-batch and preserves current care consent and expected
versions. Assignment is bound to command hashes, command rows and hashed audit
metadata. Replay checks both selected assignment and response encounter identity,
while retaining the original command-time result after subsequent valid transitions.
Migration 0042 adds append-only `encounter_transition_events` as the first batch
write, with exact assignment/actor/scope/current-version/consent checks. Matching
encounter writes, successful audit and command results are transaction-guarded.
Audit insertion is unconditional: its trigger aborts a skipped encounter update,
instead of committing an orphan event and detecting a zero-row write afterwards.
Only ready/in_progress/cancelled are allowed in this repository. The public route
continues to expose ready/in_progress only; no cancellation UI/API expansion.
Protocol-driven review/finalized/amended remain owned by protocol repositories.
Raw historical fixture writers without a new transition event are not globally
reclassified as interactive lifecycle commands. Database administration remains
trusted; no rewrite of existing encounter/history rows or migrations.
See the master-plan ledger for verification, including an actual start -> section
review -> protocol draft -> sign -> amendment integration test.

## 2I.3i.1 — signed export repository and response authorization

Added exact current read checks (read permission is not manage permission) before
and after source/list/download reads, including active patient, treating member,
selected assignment time window and optional explicit actor identity. Generation
checks exact manage access, actor and current signed head at entry/retry/replay,
after rendering, before metadata batch and before returning the package. Existing
signed snapshot/consent representation is unchanged; this is not a new retention
or consent-withdrawal policy. Commands and generation audit retain assignment.
Cross-assignment, unattributed legacy and cross-encounter replay fail closed.
Download rechecks exact artifact identity/key/hash/size/type and current access
after R2 reading and after access audit, immediately before returning bytes.
Generated download URLs preserve assignment and facility. No migration in this slice.

## 2I.3i.2 — export transactions and R2 publication (partial)

Migration 0043 adds artifact assignment/command attribution and transactional
package/audit/command/result guards. Published attributed artifacts are immutable.
Each generation owns isolated attempt keys; stable intent replay occurs before
render/upload. Pre-publication cleanup waits for every upload; concurrent losers
clean only their own objects. An uncertain commit retains objects and a private
publication_pending manifest. Current listing returns one package, and download
links pin artifactId. Old schema-1 command hashes require a fresh deliberate request.

Migration 0044 attributes new document.download access events to the exact selected
assignment with canonical hash schema 2. Historical hash schema 1 remains unchanged;
unattributed historical download events cannot authorize replay. Read permission
is sufficient, manage permission is not silently required. Entry/retry/replay and
post-commit checks verify current user, assignment, active patient, treating
relationship, signed head, ready artifact and finalized/amended lifecycle. SQL
checks authority within insertion and preserves append-only history. A final SQL
head-publication assertion rolls back the entire batch if head advancement is skipped.
Workspace-read audit was a separate gate; its migration is described below.

Migration 0045 adds permanent per-object cleanup fences and SQL mutual exclusion
between publication and cleanup. The explicit same-origin, assigned-doctor POST
`/api/workspace/exports/reconcile` handles exactly one schema-2 publication_pending
manifest with a matching current protocol, actor, assignment and intent. It derives
paths from authorized scope, retains any referenced package, atomically fences all
five keys before deletion and retains the manifest after partial deletion for retry.
Unknown fence outcomes never authorize deletion. See
`docs/operations/export-reconciliation.md` for the operator contract and limitations.
Old schema-1/uploading/published manifests and stale protocols remain retained;
no age policy, automatic worker or general bucket deletion is enabled.
See master-plan ledger for final verification before accepting this bounded slice.
Next complete independent-creation boundaries. Full 2I
remains open; no provider activation, model replacement or real patient data.

## Workspace-read audit and recovery authorization

Migration 0046 requires every new workspace.read event to carry hash schema 2
and the exact current read assignment, user, treating membership and encounter.
The SQL guard permits only a successful authorized-response event (HTTP 200).
The download guard remains separate and retains its current signed-artifact checks.
Historical schema-1 rows and hashes are not rewritten. Their old request IDs
cannot authorize replay; a fresh request appends a schema-2 event to the same chain.

The repository checks exact current read access at entry, retry, replay, before
the batch and after commit. Missing assignment, explicit deny, expiry, revocation
and another selected assignment never fall back to membership.role. Event/head
publication remains atomic, including rollback when a head update is skipped.
The recovery reader uses the same current assignment before loading and before
returning its snapshot. An active doctor assignment works even if the old
membership role is registrar. The workspace route rechecks actor and assignment
after access audit immediately before returning clinical resources.

These read controls do not grant manage permission or change consent, protocol,
clinical recommendations, STT or UI. A successful access event means an authorized
response was prepared, not proof that bytes reached a browser. If a subsequent
check denies access, no clinical response is returned; immutable audit is retained.
See the latest master-plan ledger for aggregate verification. Independent encounter
creation/selection is the next bounded audit; full Phase 2I is not complete.

## Remaining 2I.3 acceptance gates

1. Read the current master-plan handoff and preserve the owner's unstaged `a`.
2. Reuse the 2I.1 assignment resolver, but also enforce the exact encounter's
   `clinicianMembershipId`, organization and facility. Do not grant nurses or
   medical leads clinician-only actions through encounter.read.
3. Inventory every writer using `WorkspaceScope`. Its optional assignment fields
   currently preserve compatibility with legacy tests; make authoritative writers
   require them when their database guards are migrated. Read-only scope must
   never authorize a mutation. The request/UI work above is not a DB guarantee.
4. Keep the implemented URL/context propagation and recovery/unknown-outcome
   locks. Add assignment to command keys, request hashes and session ownership;
   test that an old outcome cannot be replayed under a different assignment.
5. Add durable assignment attribution to clinical commands/events and access
   audit. Generate additive schema migrations and inspect SQLite actor guards;
   never edit an applied migration or rewrite immutable history.
6. Recheck current authorization before idempotent replay and before committing
   a slow provider result. Preserve consent and expected-version conflicts.
7. Test allowed/denied roles, multiple assignments, explicit deny/no fallback,
   URL changes, revoked sessions, stale versions, replay, direct SQL bypasses,
   and the complete consent -> transcript -> review -> signed export path using
   synthetic data. No browser microphone or real provider call is implied.
8. Run full `pnpm verify:ci`, inspect the affected UI when authorized, update
   verification and handoff. Only mark full 2I complete after all rows above,
   database guards and user-facing selection are verified.

Keep web 3200, local STT 3101 and existing ngrok running. Do not connect a
messaging provider, reuse disclosed keys or replace the local STT model.
