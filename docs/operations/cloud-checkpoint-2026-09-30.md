# ORION Cloud continuation checkpoint — 2026-09-30

Historical receipt below. The resumed pagination/security checkpoint and applied
0004 migration are recorded in `cloud-checkpoint-2026-10-01.md`; use that newer
handoff first. Do not replay already applied migrations.

Owner requested a bounded stopping point, not a partial deployment represented
as the finished platform. This checkpoint is **source + applied database setup**.
There is **no published Vercel deployment or verified project URL** yet.

Application source checkpoint:
`cfdbea10219d8af1f79e62911f21187db7304a07`. Pushed to the existing ORION remote's
`codex/cloud-vercel-supabase`; exact local/remote SHA equality and clean cloud
status verified. Later documentation receipt does not change application code.

## Preserve these boundaries

- Work only in `ORION-CLINIC-CLOUD`, branch `codex/cloud-vercel-supabase`.
- Existing origin: `https://github.com/shadowuneed/ORION-CLINIC.git`.
- Original `ORION-CLINIC/main` stays at
  `fe5d1c6dfa6edbfddd842c19b020630b31deec38`; only the owner's existing plan edit.
- Supabase: `orion-clinic-cloud`, project `bctyswbqjgpmtsanrfhp`.
- Vercel: `shadowocc/orion-clinic-cloud`, project
  `prj_gi2FOCNltptWjiZA8uLDrojBQUHT`, org `team_5L2dEayNehKjDLOe3j5PJjKg`.
- No DIR ECHOES reads/reuse; no copied local DB, passwords, recordings or env.
- Synthetic inputs only. AI remains draft-only. Local STT is unchanged/deferred.

## Finished in this checkpoint

1. Native Next cloud build, server-verified Supabase email/password login,
   HttpOnly Secure cookies, CSRF, refresh/logout and explicit session generation.
   Forwarded Sites/identity headers cannot authenticate cloud requests.
2. Internal staff/access resolution and patient list/detail/create/update/archive
   adapters. Narrow RPCs enforce current live session/assignment, immutable
   history, idempotency and atomic mutation + audit. No service-role key or raw
   SQL gateway. Browser material archives from the local version are disabled.
3. Exact 0002 migration approved and applied remotely. Catalog results:
   18 private tables, all RLS=true; anon/authenticated direct table grants=0;
   authenticated schema USAGE=false; six RPCs with anon EXECUTE=0,
   authenticated EXECUTE=6, service_role EXECUTE=0.
4. Owner created an Auth account manually and separately approved doctor +
   administrator access. 0003 applied once; result:
   `org-orion-cloud`, `fac-orion-cloud`,
   `access-assignment-owner-general-medicine`, version1,
   roles `["doctor","administrator"]`, audit_sequence1.
   **0002 and 0003 must not be rerun on resume.** Committed 0003 is still only a
   parameterized operator template. No password/subject/email is saved here.
5. Account A→B/A→null cannot reuse the old SSR document/forms. Cookie changes,
   401 and SESSION_CHANGED hide/unload it. Background/session checks are
   single-flight, focus bursts deduplicated, hidden requests aborted, and timers
   disposed. Local 300ms cookie fence is deliberately retained.
6. One no-args access overview Promise is reused only within one SSR request.
   `/access`: duplicate access RPCs 2→1. API/mutations and subsequent requests
   remain fresh; there is no global user/rights TTL cache.
7. Strict source/artifact secret checks and context-aware packaging profiles.
   Only three confirmed internal Vercel `_global-error` aliases may be safely
   materialized; the full output must then be scanned again. No broad allowlist.

## Verification receipt

Cloud-only commands, not production/clinical acceptance:

```powershell
pnpm.cmd exec vitest run lib/cloud cloud/runtime/build-boundary.test.ts cloud/sql/0002_access_patient_registry.test.ts app/sign-in/page.test.ts app/chatgpt-auth.test.ts lib/config/deployment-artifact.test.ts lib/config/secret-scanner.test.ts lib/config/vercel-function-links.test.ts --project unit --no-file-parallelism --maxWorkers=1
pnpm.cmd lint
pnpm.cmd typecheck
pnpm.cmd security:dependencies
pnpm.cmd security:secrets
pnpm.cmd build:deploy-check
pnpm.cmd dlx vercel@59.25.4 build --prod --standalone --yes --scope shadowocc
node scripts/materialize-vercel-function-links.mjs --dir .vercel/output
node scripts/materialize-vercel-function-links.mjs --dir .vercel/output --apply
node scripts/check-deployment-artifact.mjs --dir .vercel/output --profile vercel
```

Focused suite: **14 files / 359 tests PASS**, 26.78s. Lint/typecheck PASS.
Dependency audit: no known vulnerabilities. Final source scanner:755 files PASS,
including this documentation receipt; `git diff --check` PASS. Native guards:
314 server +132 static files PASS.
Final standalone Vercel build PASS; dry-run confirmed3internal aliases and apply
materialized only those; final full Vercel guard **525 files PASS**. Native
314/132 guards passed again after Vercel build. No artifact was uploaded.
No full legacy/local `verify:ci`, clinical acceptance, live login/CRUD browser
proof, two-account proof or load-test claim. Later edits require fresh guards.

## Supabase usage: measured and estimated separately

Read-only size measurement immediately before owner bootstrap:
database12,151,955 bytes (~12MB), ORION tables/indexes589,824 bytes (~0.6MB).
This does not measure egress, MAU or eventual cost. No Realtime/Storage is enabled
by this slice. No paid plan/upgrade was requested or activated.

By-code steady foreground session verification remains one/10s (up to360/hour,
plus genuine returns from hidden state). The previous visibility guard already
prevented new hidden-tab network calls; the new fix stops its no-op timer and
aborts an in-flight check. Do not claim an invented 360→0 saving. Repeated focus
events no longer add one provider check per focus. Server live authorization and
clinical audit must not be removed for quota savings.

Current request estimates (valid access, no retries/prefetch/heartbeat):
SSR access=1Auth+1RPC; patient API=1Auth+2RPC; initial patient screen
SSR+client API=2Auth+3RPC. These are code-path counts, not provider measurements.

## Resume in this order

1. Read AGENTS.md and MASTER_PLAN.md, verify checkout/branch/origin/dirty state.
   Reuse the already applied cloud owner assignment; never import local accounts.
2. Run real Supabase Auth/login + patient create/update/archive/reload acceptance
   using the owner's password entry. Check logout/revocation and two-account
   isolation, malformed/oversized payloads, audit/idempotency and response parsing.
   Never ask for passwords or secret keys in chat.
3. Complete cursor pagination before large histories: SQL detail currently returns
   all profileHistory/encounters, but parser caps1000 and transport1MiB. A mutation
   can commit before a later oversized-response parse fails. Use a reviewed
   FORWARD migration/DTO contract, not edits to applied0002 or silent truncation.
4. Review real query plans for a heads index
   `(organization_id,facility_id,updated_at DESC,patient_id DESC)` (current list
   sorts heads, not the indexed patient root). Review membership/assignment
   lookup indexes and replace per-row detail work with tenant-scoped set queries.
   Patient UI asks100; smaller first window needs cursor/next-page UI, not hiding
   records. Audit/idempotency growth needs controlled retention/archive design.
5. Port dashboard/latest measured observations, then encounter/protocol, orders,
   care, scheduling, communications and private storage in real vertical slices.
   `/` and these unported routes currently stay503. Disable unavailable photo/
   vitals controls until their capabilities exist; don't fake data or success.
6. Fresh tests/typecheck/lint/dependency/source scans and exact Vercel artifact
   scan; deploy ONLY the dedicated ORION project, verify actual public URL and
   online login/workflows. Build and Git push are not deployment.
7. STT hosting is a separate later choice; no dependence on the laptop staying on
   should be added to an online service.

Production server config already has the five ORION cloud variables described
in `cloud-supabase-port.md`. Elevated keys/database password aren't required by
the current RPC adapter. Ignored `.env*`/`.vercel` must remain untracked.
