# 0004 bounded patient pagination — forward migration review

Status: **APPLIED once on 2026-10-01** in dedicated Supabase
`bctyswbqjgpmtsanrfhp`, after the owner's explicit action-time approval of 0004.
The SQL Editor returned `Success. No rows returned`; subsequent read-only catalog
verification confirmed 18 RLS tables, zero direct API table grants, seven
authenticated-only public RPCs, zero unintended/private-helper EXECUTE grants,
three new indexes and exactly one list signature. The existing assignment remains
one and cloud patients remain zero. No local data was imported.

Do not replay 0002, owner 0003 **or 0004**. Reviewed source SHA-256:
`283FD54B4775E3D0549E3784D4489ABCB26BAD647F6DF09D2C8CF8E9E1B9BB19`.
The entire editor selection was copied back and compared to the reviewed source
before execution (only CRLF/LF normalization); 26831 normalized characters matched.
Deployment must use the matching new API/DTO contract: old 0002 callers cannot
interpret the explicit paginated response contract safely. Vercel publication
and real browser Auth/CRUD acceptance are separate, not established by DDL success.

## Why this migration is needed

0002 builds every profile-history and encounter row for patient detail and
mutation responses. Its TypeScript parser previously allowed at most 1000 rows,
and transport permits 1 MiB. A successful mutation could therefore commit while
the returned unbounded detail later failed to parse. A retry remains subject to
idempotency, but the original response must not falsely imply a rollback.

0004 projects 25 initial rows of each history, returns explicit continuation
metadata, and checks the final emitted JSON before the SQL transaction commits.
No historical row is truncated, rewritten or deleted. Every older row can be
read through a current authorized continuation request.

## Reviewed public contract

Directory RPC (one signature, not an ambiguous overload):

```text
orion_patients_list(assignment_id text,facility_id text DEFAULT NULL,
  query text DEFAULT NULL,status text DEFAULT 'active',
  max_results integer DEFAULT 25,cursor jsonb DEFAULT NULL)

{patients:PatientSummary[],page:{hasMore:boolean,nextCursor:object|null},
 accessAssignmentId:string,observedAt:millisecondInteger}
```

The directory accepts 1–50 rows per request. It uses a 51-row maximum lookahead
and literal search, preserving `%` as ordinary text. Directory projection joins
selected patients to tenant-scoped encounter counts/latest rows as sets, instead
of calling the detail helper per returned patient. The obsolete five-argument
signature is dropped transactionally; omitted cursor arguments still work via
the replacement's default. Callers must deploy the matching explicit page DTO.

Existing detail/create/update/archive signatures remain unchanged. Their
`patient` now has the existing summary fields plus:

```text
encounters:EncounterSummary[<=25]
encounterCount:exact count of that patient's catalog encounters
encountersPage:{hasMore,nextCursor}
profileHistory:ProfileHistoryEntry[<=25]
profileHistoryCount:current published profile version
profileHistoryPage:{hasMore,nextCursor}
```

The linear immutable profile/head invariants make the published profile version
the exact count of its published lineage. Unpublished successor rows cannot leak
through the history window. The current profile is always first.

New seventh RPC:

```text
orion_patient_history_page(assignment_id text,patient_id text,history_kind text,
  facility_id text DEFAULT NULL,max_results integer DEFAULT 25,
  cursor jsonb DEFAULT NULL)

{items:ProfileHistoryEntry[]|EncounterSummary[],page:{hasMore,nextCursor},
 historyKind:'profile'|'encounters',patientId:string,profileVersion:integer,
 accessAssignmentId:string,observedAt:millisecondInteger}
```

History accepts 1–50 rows and the exact `profile`/`encounters` kind. An absent or
inaccessible patient gets the same neutral `PATIENT_NOT_FOUND` in the selected
valid facility. A wrong/unauthorized assignment or facility stays denied before
patient lookup. Every successful page appends the normal facility audit chain;
an audit failure releases no data.

## Cursor semantics and consistency

Cursors are bounded JSON positions at the SQL boundary, not authorization or
bearer tokens. Server transport serializes them to at most 2048 base64url
characters. SQL enforces a 1536-byte UTF-8 cursor bound, strict known keys/types,
UTF-16 ID/query lengths and safe nonnegative integer millisecond timestamps
both on receipt and **before emitting a new cursor**.

All kinds contain `domainVersion:1`, `kind`, `organizationId`, `facilityId`,
`assignmentId`, `assignmentVersionId`, `patientId`. Directory adds normalized
`query`, `status`, `updatedAt`; profile adds `profileVersion`, `beforeVersion`;
encounters adds `profileVersion`, `updatedAt`, `encounterId`.

Current live Auth session and selected assignment are independently checked on
every request. Cursor scope/filter mismatch or malformed input gets PT400
`INVALID_CURSOR`; current assignment version or profile version change gets PT409
`PAGINATION_STALE`. Revocation/logout remains 403/401. The history RPC takes a
SHARE lock on the patient head before comparing its profile version and reading
the window, preventing a profile writer from advancing it between those steps.
Each emitted cursor is bound to the committing RPC's exact selected assignment.
Prior application preflight metadata is not the returned version's authority.

Directory uses descending `(head.updated_at,patient_id)`; profiles use descending
`version`; encounters use descending `(updated_at,id)`. Exact scoped anchors
must still exist at their stated position. The next cursor is null exactly when
`hasMore` is false. A retained cursor whose anchor changes requires refresh.

Directory and encounter paging are **live keysets, not a frozen snapshot**.
Concurrent new records or edits can move rows ahead of a previously issued
cursor. Clients deduplicate IDs and refresh to see such moves; a page does not
claim a complete historical snapshot or permanent overall count. Encounter
writes are not mounted by this slice. Future encounter publication must define
its own revision/snapshot policy before stronger consistency is claimed.

## Atomicity and response validation

`orion_private.patient_command` is unchanged, including latest-head mutation,
current session/assignment checks, facility writer mutex, duplicate protection,
immutable versions, exact idempotency/replay and transactional audit. Public
mutation wrappers finish cursor scope binding and full-response checks in that
same SQL transaction. Validation exceptions therefore roll back patient version,
head, audit and idempotency together. Lost-network/after-commit application
failures are still unknown outcomes, not promised rollbacks.

Each final response permits at most 786432 UTF-8 bytes, below transport 1 MiB.
The projected scalar gate matches JavaScript UTF-16 string limits, verifies
calendar-date representation, IDs, IIN, private photo null, positive versions
and safe timestamp/count ranges. Astral characters cannot bypass a Zod length
limit via PostgreSQL's code-point `length`. Oversized data fails explicitly;
no text is silently shortened. An additive encounter-reason CHECK also limits
code points to 500; the emitted UTF-16 gate handles astral text. Invalid existing
reasons abort migration installation for explicit reconciliation.

## Schema/permission changes requiring owner approval

- Three additive indexes: current heads `(organization_id,facility_id,
  updated_at DESC,patient_id DESC)`; memberships by user/scope; assignments by
  member/scope. Existing indexes are retained.
- One additive encounter reason constraint; no patient/staff/bootstrap writes.
- Replace private patient projection and public list/detail/mutation wrappers;
  add private response/cursor/window helpers and one public history RPC.
- Exactly 7 authenticated EXECUTE RPCs after installation (previously 6), with
  no anon/service_role EXECUTE. New private functions revoke PUBLIC/anon/
  authenticated/service_role. All 18 existing tables retain RLS and zero direct
  API grants; schema USAGE remains denied.

No raw SQL endpoint, service key, public bucket, audit retention deletion,
cross-request authority cache, identity change or clinical module is added.

## Local verification receipt

```powershell
pnpm.cmd exec vitest run cloud/sql/0004_bounded_patient_pagination.test.ts --project unit --no-file-parallelism --maxWorkers=1
pnpm.cmd exec eslint cloud/sql/0004_bounded_patient_pagination.test.ts
git diff --check
```

2026-10-01 final source after the Next.js 16.3.6 dependency update: 11/11
PostgreSQL PGlite tests PASS, 19.75s. Focused ESLint and whitespace check PASS.
The preceding parser-integration run was 10/10 PASS, 17.19s. Fixture bugs in an
earlier 9-test run were corrected; that earlier run was 6 passed/3 failed and is
not a success receipt.

The disposable engine applies 0001+0002+0004 from source into empty artificial
Auth tables, never the owner bootstrap or actual Supabase. Tests exercise 1005
profile versions and 1101 encounters, complete continuation with no duplicate
IDs, current update/replay, invalid/stale/version/scope cursors, 403/401 denials,
RLS/grants, mandatory audit failure and mutation publication rollback for a
forced oversized envelope, generated cursor byte overflow and direct-RPC astral
strings. Actual SQL directory, initial detail, every history continuation and
mutation replies also pass the current strict TypeScript response parsers.
Actual `pg_proc` verifies
the original patient-command body is unchanged. No external patient/password/
database resource is read or written.

These tests are not live Supabase query-plan/egress/MAU/load/concurrency proof,
browser acceptance or deployment. The installation and catalog checks above are
live; they do not establish query performance or clinical functionality. Review
actual scoped Supabase EXPLAIN plans and size measurements before making quota
claims; do not infer a percentage or future price guarantee from index presence.
