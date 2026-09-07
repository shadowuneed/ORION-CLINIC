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
The current compatibility clients do not yet render the multiple-assignment
choice. A single eligible assignment works; multiple assignments fail closed.
Do not introduce a first-assignment client fallback to hide that state.

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

## Next bounded checkpoint: 2I.2

1. Read the current master-plan handoff and preserve the owner's unstaged `a`.
2. Reuse the 2I.1 assignment resolver, but also enforce the exact encounter's
   `clinicianMembershipId`, organization and facility. Do not grant nurses or
   medical leads clinician-only actions through encounter.read.
3. Inventory every writer using `WorkspaceScope` before extending it. Scope
   must retain assignment identity and appropriate permission. Read-only access
   must not accidentally authorize a mutation.
4. Propagate exact selection through API schemas, dashboard/live request URLs,
   command keys and sign-in return URLs. Keep recovery/unknown-outcome locks.
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
