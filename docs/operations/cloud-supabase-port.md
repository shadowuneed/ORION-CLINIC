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

## Supabase setup

The owner-facing new-project form was prepared for `orion-clinic-cloud`, Free
organization, Frankfurt. Automatically expose new tables is OFF; automatic RLS
is ON. The owner entered the database password and submitted creation. The
project dashboard now confirms `orion-clinic-cloud`, ref `bctyswbqjgpmtsanrfhp`,
Healthy, Frankfurt. No migrations or GitHub integration yet. No password was
read or copied. Never put passwords in chat.

Project Auth configuration: public signups disabled; anonymous sign-ins and
manual identity linking disabled; email confirmation remains enabled. No staff
account, invitation email or local credential import is part of this checkpoint.

`cloud/sql/0001_private_schema_boundary.sql` defines a closed `orion_private`
schema with no anonymous/authenticated/service-role schema access or default
table/function/sequence grants. This is a boundary bootstrap, NOT a clinical
schema port. Apply only to the exact new test project and verify its result.

Applied to the dedicated project through its SQL Editor. The returned row was
`orion_private | false | false | false` for anonymous/authenticated/service-role
schema USAGE. No clinical rows, local migrations or credentials were transferred.

Created a separate Vercel project `shadowocc/orion-clinic-cloud` and linked ONLY
this cloud checkout. No deployment was uploaded. Vercel link generated an
ignored local OIDC environment file; its contents were not read or copied.

Vercel server production configuration contains only the exact Supabase project
ref, URL and synthetic-data-only flag. The database credential and publishable
key are not configured; do not request secret values in chat. A later secure
owner credential-entry flow is required before mounted PostgreSQL acceptance.

## Verified build foundation

Native Next production build and TypeScript passed. Five focused files passed
134 tests: closed ingress, unchanged access response, bounded server Auth
verification and packaging regressions. All 80 route paths, six forged-identity
probes and four POST probes stayed closed503 in the isolated3215 preview;
liveness200 explicitly reported clinicalReady:false. Preview was then stopped.

Dependency audit reports zero vulnerabilities after narrow cloud-only overrides.
The source secret scan passed; it cannot prove universal absence of secrets.
Native artifact guard is still blocked by legitimate API directories named
`exports` in `.next/server` and `.next/static`; their skipped subtrees are not
cleared. No exact `.vercel/output` artifact has been generated or uploaded.
Resolve context-aware packaging inspection before publishing, without globally
allowing private export folders, database files or credential files.

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

## Migration gates (not yet implemented)

1. Mount server-verified Auth and map issuer/subject to existing internal staff;
   authentication must not create a clinical membership or an administrator.
2. Port the SQLite/D1 schema and repositories to PostgreSQL. Current source has
   53 migrations, 97 SQLite table declarations and 27 production D1 repository
   files. Changing `db/index.ts` does not migrate raw repository SQL.
3. Preserve one-transaction batch publication, idempotency, audit chains, revocation
   and disable/reactivate fences. PostgreSQL exception/trigger semantics must
   replace `RAISE(ABORT)` and invalid-JSON rollback assertions, not remove them.
4. Preserve milliseconds with bigint/timestamp conversion tests; rewrite numbered
   bindings, SQLite JSON functions, scalar min/max and INSERT OR IGNORE/REPLACE.
5. First real vertical slice: staff access, patients, latest recorded measurements
   and dashboard read models. Do not seed invented charts or fabricate success.
6. Port clinical writes module by module with PostgreSQL concurrency, rollback,
   revocation and cross-account tests. Original local DB remains unchanged.
7. Private Storage, authorized signed uploads/downloads and reconciliation; no
   public bucket. Fix browser material isolation before multi-account acceptance.
8. Exact artifact scan, dependency audit, two-account browser acceptance, reload/
   restart proof and Vercel deployment inspection. Only then call it deployed.

References: [Supabase architecture](https://supabase.com/docs/guides/getting-started/architecture),
[server authentication](https://supabase.com/docs/guides/auth/server-side/creating-a-client?queryGroups=framework&framework=nextjs),
[API key safety](https://supabase.com/docs/guides/getting-started/api-keys).
