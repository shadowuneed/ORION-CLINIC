# Separate local and cloud versions — 2026-09-30

Owner explicitly chose two versions: preserve the existing local project and
configure a separate cloud version for Vercel with a dedicated Supabase project.
This supersedes the Cloudflare deployment direction for the test online version,
not clinical production approval, patient-data residency or recording consent.

## Isolation

- Local checkout: `../ORION-CLINIC`, branch `main`, unchanged source checkpoint
  `fe5d1c6dfa6edbfddd842c19b020630b31deec38`. Owner's unrelated plan edit remains.
- Cloud checkout: `../ORION-CLINIC-CLOUD`, branch `codex/cloud-vercel-supabase`,
  created from the same commit in the EXISTING ORION Git repository.
- No copied local passwords, `.dev.vars`, SQLite files, recordings or runtime state.
- No DIR ECHOES resources, integrations or credentials may be inspected or reused.
- Cloud ingress must stay closed until real PostgreSQL authorization and persistence
  are mounted. A native build is preparation, not a working clinical deployment.
- Local STT is not exposed online. No laptop proxy, external audio or AI call.

Source checkpoint `eecc79dba87c7788d0be189e0911fa35b062b34a` was pushed to the
existing GitHub remote's `codex/cloud-vercel-supabase` branch; remote HEAD was
verified equal. This is source publication only; original main remains untouched.

The newer continuation checkpoint is documented in
`cloud-checkpoint-2026-09-30.md`. Historical foundation results below are
superseded where that checkpoint records mounted Auth/patient routes, applied
0002 and cleared packaging guards. Source publication still is NOT deployment.

## Supabase setup

The owner-facing new-project form was prepared for `orion-clinic-cloud`, Free
organization, Frankfurt. Automatically expose new tables is OFF; automatic RLS
is ON. The owner entered the database password and submitted creation. The
project dashboard now confirms `orion-clinic-cloud`, ref `bctyswbqjgpmtsanrfhp`,
Healthy, Frankfurt. No GitHub integration yet. No password was
read or copied. Never put passwords in chat.

Project Auth configuration: public signups disabled; anonymous sign-ins and
manual identity linking disabled; email confirmation remains enabled. The owner
created a Supabase Auth account themselves. After separate exact-account owner
approval, its doctor + administrator assignment was bootstrapped in ORION Cloud.
Auth registration/sign-in itself never grants clinical access.
No invitation email or local credential import was performed.

`cloud/sql/0001_private_schema_boundary.sql` defines a closed `orion_private`
schema with no anonymous/authenticated/service-role schema access or default
table/function/sequence grants. This is a boundary bootstrap, NOT a clinical
schema port. Apply only to the exact new test project and verify its result.

0001 was applied to the dedicated project through its SQL Editor. Its row was
`orion_private | false | false | false` for anonymous/authenticated/service-role
schema USAGE. No clinical rows, local migrations or credentials were transferred.

After explicit owner approval, 0002 was applied in the same dedicated project's
SQL Editor. This creates 18 private RLS tables and six narrow authenticated-only
RPCs for staff access and patient list/detail/create/update/archive. Actual
catalog proof: 18 tables, all RLS=true, anon/authenticated table grants=0,
authenticated schema USAGE=false, RPC count=6, anon RPC grants=0,
authenticated RPC grants=6, service_role RPC grants=0. The schema is empty of
imported local clinical data. 0003 was applied once after separate exact-account
approval: org-orion-cloud / fac-orion-cloud /
access-assignment-owner-general-medicine, version1, roles doctor+administrator,
audit_sequence1. The committed file remains a parameterized operator template,
not stored account identifiers. Never rerun it automatically or on resume.

Created a separate Vercel project `shadowocc/orion-clinic-cloud` and linked ONLY
this cloud checkout. No deployment was uploaded. Vercel link generated an
ignored local OIDC environment file; its contents were not read or copied.

Vercel server production configuration contains ORION_SUPABASE_PROJECT_REF,
ORION_SUPABASE_URL, ORION_SUPABASE_PUBLISHABLE_KEY,
ORION_SYNTHETIC_DATA_ONLY and ORION_CLOUD_PUBLIC_ORIGIN. The publishable key is
not an elevated secret. No database password, service-role or secret key is
needed by this adapter or was copied. Ignored generated env files must remain
unstaged and unread. No upload or deployed URL is claimed.

## Verified build foundation

Native Next production build and TypeScript passed. Five focused files passed
134 tests: closed ingress, unchanged access response, bounded server Auth
verification and packaging regressions. All 80 route paths, six forged-identity
probes and four POST probes stayed closed503 in the isolated3215 preview;
liveness200 explicitly reported clinicalReady:false. Preview was then stopped.

Dependency audit reports zero vulnerabilities after narrow cloud-only overrides.
The source secret scan passed; it cannot prove universal absence of secrets.
The former legitimate `exports` route-name false positive is resolved with
strict context-aware Next/Vercel profiles, not a global private-folder allowlist.
Exact standalone Vercel output was built and scanned. The only three confirmed
internal `_global-error` aliases are materialized by a validating helper, then
the entire artifact is scanned again. Rebuild and re-scan after ANY source edit;
a previously scanned artifact is not evidence for a later commit. No upload.

The retained `build:deploy-check:local` command also passed on all522Vinext dist
files, with zero env/dev.vars names. It is a packaging regression check in the
cloud checkout, not an alternative public deployment. Vinext rewrites generated
Next route types; a fresh native build was run last to restore cloud types.
Continue normal local work in the untouched original checkout, not these cloud
compatibility scripts. Do not run both build systems concurrently in one checkout.

Only a new, dedicated ORION project can be used. Server configuration validates
the exact project ref/HTTPS origin. Elevated keys and database credentials never
enter browser props or `NEXT_PUBLIC_*` variables. Supabase secret keys bypass RLS;
RLS alone does not authorize a privileged server connection. Public-table grants
and policies require review even with automatic RLS enabled.

## Current mounted slice and remaining migration gates

Mounted in cloud source: server-verified email/password Auth, secure HttpOnly
cookies/CSRF/refresh/logout, internal assignment resolution, and patient
list/detail/create/update/archive. RPC mutations preserve immutable history,
idempotency and audit in one PostgreSQL transaction. Account-generation fences
hide/unload stale SSR documents and forms on account changes. Shared local
IndexedDB material archives are disabled in the cloud path.

Unported pages/APIs (including `/`, pathway, encounters/protocols, orders, care,
observations, scheduling, communications and storage) remain explicitly closed
503. The route allowlist is method-specific; do not reopen them with a runtime
flag, D1 shim, raw-SQL RPC or fake response. This is not a complete online release.

1. Owner bootstrap is already applied. Do NOT apply 0002/0003 again.
   Prove real login, live assignment/revocation and two-account isolation through
   the mounted routes; unit/PGlite tests do not prove a live Supabase session.
2. Port the SQLite/D1 schema and repositories to PostgreSQL. Current source has
   53 migrations, 97 SQLite table declarations and 27 production D1 repository
   files. Changing `db/index.ts` does not migrate raw repository SQL.
3. Preserve one-transaction batch publication, idempotency, audit chains, revocation
   and disable/reactivate fences. PostgreSQL exception/trigger semantics must
   replace `RAISE(ABORT)` and invalid-JSON rollback assertions, not remove them.
4. Preserve milliseconds with bigint/timestamp conversion tests; rewrite numbered
   bindings, SQLite JSON functions, scalar min/max and INSERT OR IGNORE/REPLACE.
5. Complete the next read slice: latest recorded measurements and dashboard,
   then real encounter/clinical write slices. Staff/patient source exists, but
   live browser CRUD/reload acceptance is still open. No invented charts.
6. Port clinical writes module by module with PostgreSQL concurrency, rollback,
   revocation and cross-account tests. Original local DB remains unchanged.
7. Private Storage, authorized signed uploads/downloads and reconciliation; no
   public bucket. Fix browser material isolation before multi-account acceptance.
8. Exact artifact scan, dependency audit, two-account browser acceptance, reload/
   restart proof and Vercel deployment inspection. Only then call it deployed.

## Supabase usage checkpoint

Actual read-only catalog measurement on 2026-09-30: project database
12,151,955 bytes; private ORION table/index allocation 589,824 bytes. This is an
initial-size snapshot, NOT an egress/MAU measurement or a future quota guarantee.
No Realtime subscription or Storage upload is enabled in this mounted slice.
Usage fixes/results and remaining pagination/index/audit-growth work are recorded
in the continuation checkpoint. Keep audit and live authorization checks; never
reduce usage by deleting clinical history or caching rights across requests.

References: [Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture),
[server authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs),
[API key safety](https://supabase.com/docs/guides/getting-started/api-keys).
