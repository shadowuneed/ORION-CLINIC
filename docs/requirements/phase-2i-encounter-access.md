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
| `/api/workspace/exports/generate`, `/download` | appropriate read/manage permission; immutable artifact, exact source and read audit |
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

## Next bounded checkpoint: 2I.3d — speech session ownership

Bind speech session creation/use/deletion to the exact assignment, persist that
ownership, and recheck current rights and audio/storage consents before use and
before accepting delayed transcription results. Preserve session expiry, stream
isolation, transcript versioning and recovery locks. Do not replace STT models or
change audio timings. Recommendations and signed exports remain later families;
2I.3 and full 2I remain incomplete.

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
