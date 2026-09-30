# ORION Cloud resumed checkpoint — 2026-10-01

Owner explicitly resumed the separate cloud checkout. This is a bounded patient
pagination/security checkpoint, not the completed online platform. There is no
published Vercel deployment or verified final project URL at this receipt.
The previous source checkpoint is `bc17cdb775832ccdb84339bf5ef9eff48f23ce8f`;
current changes must be committed/pushed on the same dedicated branch after guards.

## Exact preservation boundary

- Cloud checkout only: `ORION-CLINIC-CLOUD`, `codex/cloud-vercel-supabase`.
- Existing Git remote: `https://github.com/shadowuneed/ORION-CLINIC.git`.
- Original `ORION-CLINIC/main` remains
  `fe5d1c6dfa6edbfddd842c19b020630b31deec38`; its only dirty path is the owner's
  existing `docs/MASTER_PLAN.md`. No original source, DB, accounts, recordings,
  environment, ports 3200/3101 or local STT was changed.
- Dedicated Supabase: `orion-clinic-cloud`, `bctyswbqjgpmtsanrfhp`.
- Dedicated Vercel: `shadowocc/orion-clinic-cloud`, project
  `prj_gi2FOCNltptWjiZA8uLDrojBQUHT`, org `team_5L2dEayNehKjDLOe3j5PJjKg`.
- No DIR ECHOES reads/reuse. No paid upgrade, local data import, new credentials,
  public bucket, real patient data or external audio/AI request.

## Implemented and applied

1. Patient directory defaults to 25 rows with explicit load-more continuation.
   Detail returns 25 profile versions and 25 encounters, with counts and separate
   history continuations. Older records are not dropped or silently truncated.
2. Strict cursor kind/filter/patient/facility/assignment validation. Every page
   obtains current server authority; a cursor never supplies permission. Current
   assignment or profile changes reject continuation and require refresh.
3. Whole-response UTF-8 byte, UTF-16 scalar, date/number and generated cursor
   validation is inside the SQL mutation transaction. Invalid output rolls back
   publication, audit and idempotency. Lost-network outcomes remain unknown,
   not a promised rollback. The existing private command body is unchanged.
4. UI continuation requests are scoped and generation-fenced. Account/scope
   changes retire pending requests; 401/403 clears protected data/forms. Refresh,
   retry and deduplication are explicit. Unported photo/vitals/encounter controls
   are disabled instead of calling unavailable cloud APIs.
5. Owner expressly approved migration 0004. Root applied exactly the reviewed SQL
   once via the dedicated SQL Editor. Full editor selection matched reviewed
   source after newline normalization. SQL source SHA-256:
   `283FD54B4775E3D0549E3784D4489ABCB26BAD647F6DF09D2C8CF8E9E1B9BB19`.
   SQL Editor returned `Success. No rows returned`.
6. Fresh read-only remote catalog: 18 private tables, all RLS=true; direct API
   table grants=0; authenticated private-schema USAGE=false; seven public RPCs,
   authenticated EXECUTE=7; anon/service-role RPC EXECUTE=0; private-helper API
   EXECUTE=0. Three new indexes and exactly one list signature. Cloud assignments=1,
   cloud patients=0. No owner/bootstrap mutation occurred. **0001–0004 are now
   applied; never replay 0002/0003/0004.**
7. Cloud Next.js and eslint-config-next upgraded from 16.3.3 to 16.3.6 after the
   fresh dependency audit found critical GHSA-vcvr-r3jv-pc5j/CVE-2026-94545.
   Official advisory: https://github.com/vercel/next.js/security/advisories/GHSA-vcvr-r3jv-pc5j
   No `next/og`/ImageResponse use was found in scoped app source; no exploitation
   is claimed. The post-update audit reports no known vulnerabilities.

## Fresh verification

```powershell
pnpm.cmd exec vitest run lib/cloud cloud/runtime/build-boundary.test.ts cloud/sql/0002_access_patient_registry.test.ts cloud/sql/0004_bounded_patient_pagination.test.ts app/patients/pagination-client.test.ts app/patients/patient-pagination-ui.test.ts app/sign-in/page.test.ts app/chatgpt-auth.test.ts lib/config/deployment-artifact.test.ts lib/config/secret-scanner.test.ts lib/config/vercel-function-links.test.ts --project unit --no-file-parallelism --maxWorkers=1
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

Post-update focused suite: **19 files / 438 tests PASS**, 47.25s. Full lint and
typecheck PASS; dependency audit PASS. Source secret scanner **766 files PASS**,
including the operation/plan receipts; `git diff --check` PASS.
Native Next 16.3.6 build PASS, server317
and static133 artifact files PASS. Exact standalone Vercel build PASS; dry-run
validated three confirmed internal aliases, apply materialized only those, final
Vercel artifact guard **530 files PASS**. No artifact was uploaded.
Agent's final focused PostgreSQL suite: 11/11 PASS, 19.75s; UI helper/handler suite:
18/18 PASS. Independent final read-only review found no new pagination blocker.
All are source/disposable-engine evidence, not live browser acceptance.

The PostgreSQL suite traverses artificial 1005 profile versions/1101 encounters,
ties, stale/scope/session denials, current SQL-to-DTO responses and forced mutation
rollback. Those records exist only in disposable tests, not remote Supabase.

## Known limits and next bounded task

Directory/encounter continuations are live keysets, not frozen snapshots. A
concurrent edit can move an unseen record above an issued cursor; refresh shows
current positions. No stronger snapshot claim or invented quota savings.
Source/index audit is not live EXPLAIN, egress, MAU, load, CWV or cost proof.

Cloud auth requires the configured canonical HTTPS origin and Secure host-only
cookies. HTTP loopback cannot prove this login flow. A prior tool-policy-blocked
local launch/SQL transport must not be retried through alternate env/tunnel/proxy
workarounds. Do not weaken origin/cookie checks for acceptance.

Next: owner-confirmed publication of the clearly incomplete Auth/patient HTTPS
acceptance slice on ONLY the dedicated Vercel project, paired with applied 0004.
Use the owner's manual password entry; never request it in chat. Verify actual
login/access, patient create/update/archive/reload, logout/revocation and
two-account isolation before calling this slice accepted. External session
revocation eviction cadence remains a live gate; SQL clinical/access checks do
verify live sessions, but the session display endpoint is not proof of immediate
provider-revocation eviction.

Then port measured dashboard/observations and remaining encounter/protocol,
orders, care, scheduling, communications/private storage in real vertical slices.
Those routes, including `/` and pathway, remain closed503 today. STT is deferred.
Do not present an incomplete URL as the finished platform or infer deployment
from builds/Git push. Ignored `.env*`, `.vercel`, DB/password/media stay untracked.
