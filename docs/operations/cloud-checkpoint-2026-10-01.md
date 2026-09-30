# ORION Cloud resumed checkpoint — 2026-10-01

Owner explicitly resumed the separate cloud checkout. This is a bounded patient
pagination/security checkpoint, not the completed online platform. The owner
subsequently explicitly instructed publication of this incomplete slice.
**Published and anonymously verified on 2026-10-01:**
https://orion-clinic-cloud.vercel.app/sign-in
Application checkpoint: `021ef89bd53f0de77e8b3593276ac94a38ff1e14`, committed and
pushed to existing ORION origin's `codex/cloud-vercel-supabase`. Exact local HEAD
and `git ls-remote origin refs/heads/codex/cloud-vercel-supabase` matched; cloud
status was clean. This supersedes `bc17cdb775832ccdb84339bf5ef9eff48f23ce8f`.
The later documentation receipt does not change application code.

## Login compatibility repair — 2026-10-01

Owner reported that their manually created Supabase credentials failed on the
published canonical form. Read-only dedicated Vercel login request metadata showed
503 responses and one401; no password, request body, cookies or tokens were read.
Two parallel source audits found no universal client/CSRF navigation blocker.

Confirmed source defect: ORION required refresh tokens of at least16 characters,
but official Supabase Auth creates legacy12-character refresh tokens:
https://github.com/supabase/auth/blob/master/internal/models/refresh_token.go
and recognizes them in
https://github.com/supabase/auth/blob/master/internal/api/token_refresh.go .
That makes a valid password response fail locally before cookie publication. This
is a reproduced provider-format incompatibility, not proof that every observed401
was caused by it or that the owner's actual password/token was inspected.

The shared validator now accepts length12–2048 and rejects every character outside
the existing cookie-safe alphabet, including lone LF/CRLF/delimiters. It performs
transport validation only; Supabase still validates tokens and ORION still verifies
identity/session claims and internal assignments. No origin, CSRF or cookie guard
was relaxed. Default mocks now use12 characters;32-character compatibility remains
tested, with negative short/overlong/injection cases and refresh-only logout.

```powershell
pnpm.cmd test lib/cloud/auth-session.test.ts lib/cloud/auth-handlers.test.ts lib/cloud/supabase-principal.test.ts app/sign-in/page.test.ts
pnpm.cmd exec eslint lib/cloud/auth-session.server.ts lib/cloud/auth-session.test.ts lib/cloud/auth-handlers.test.ts
pnpm.cmd typecheck
pnpm.cmd security:secrets
```

Four files /104 tests PASS; scoped ESLint and final TypeScript PASS. Source secret
scan766 files PASS after this receipt; native provider build is the publication
gate. Independent read-only diff review found no material regression. Owner
password is unchanged and never read; local resources/data and all unrelated
resources remain untouched.

**Patched version genuinely published:** exact source
`5db36eca8bb5d6bbd681b48ae2b5c0277e20b66f` committed/pushed and local/remote SHA matched.
New clean Git archive extracted in a dedicated temporary directory; source private
DB/key/audio count0. Vercel dry-run760 files, unsafe uploads0 and.env.example excluded.
Source deployment (not Windows prebuilt) used the same exact project/scope and
`--archive=tgz --meta sourceCommit=5db36eca8bb5d6bbd681b48ae2b5c0277e20b66f`.
Provider Linux Next16.3.6 compile/TypeScript/build PASS, CLI exit0/READY/production.

- Deployment: `dpl_Xu2B6KCwdjxd78TktuzVSczyaPNJ`.
- Canonical alias: https://orion-clinic-cloud.vercel.app/sign-in .
- Unique diagnostic URL: https://orion-clinic-cloud-4hmlzf2lr-shadowocc.vercel.app .
- Inspector: https://vercel.com/shadowocc/orion-clinic-cloud/Xu2B6KCwdjxd78TktuzVSczyaPNJ .

Fresh canonical public HTTPS checks: sign-in200, health/live200, anonymous
session401 and patients401, CSRF200 with Secure/HttpOnly/__Host cookie, wrong-Origin
CSRF403; responses no-store. Browser read visible text only, not field values:
personal email/password form is present. Owner was asked to refresh and retry their
existing credentials manually. Owner replied **`Да, вошёл`**, confirming successful
login with their unchanged credentials after the repair. This is owner-reported
login acceptance, not agent password handling or authenticated patient CRUD,
reload, logout/revocation or two-account browser proof. Do not claim every401 is resolved.
Original main SHA/sole owner plan edit reverified unchanged. No migration replay,
local account import, external AI/audio request or other resource access occurred.

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

Publication is complete; see the receipt below. Next: actual Auth/patient HTTPS
acceptance on the canonical origin, paired with applied 0004.
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

## Owner-approved Vercel publication receipt

Owner explicitly requested `публикуй. Я же сказал задеплоить` after the scope and
limitations above were explained. Published ONLY the dedicated ORION project;
no unrelated account/project/resource or paid build tier was used.

The initial Windows-prebuilt upload failed, not succeeded: Vercel could not resolve
Windows absolute paths in generated `.vc-config.json` dependency mappings.
Its failed inspector is https://vercel.com/shadowocc/orion-clinic-cloud/ak6AH7KFFAir13FFMGscfccm4aLn
Do not reuse that Windows output for future production publication. A local
artifact policy pass is not cross-platform packaging acceptance.

Recovery used a clean `git archive` of the exact pushed commit
`f983b995a6f9daefc5d453d59a2b6d34536d24af`, extracted into an isolated temporary
source directory. No ignored local environment, DB, recordings or credentials
were copied. Source snapshot had only the tracked `.env.example`; Vercel dry-run
explicitly excluded it, with zero database/private-key/audio files. Then the
provider performed its own Linux Next 16.3.6 build; no security/origin bypass.

```powershell
pnpm.cmd dlx vercel@59.25.4 deploy --dry --json --prod --yes --scope shadowocc --project prj_gi2FOCNltptWjiZA8uLDrojBQUHT
pnpm.cmd dlx vercel@59.25.4 deploy --prod --yes --scope shadowocc --project prj_gi2FOCNltptWjiZA8uLDrojBQUHT --archive=tgz --meta sourceCommit=f983b995a6f9daefc5d453d59a2b6d34536d24af
```

Run these from the clean Git snapshot, not a checkout containing ignored files.
Vercel returned exit0/READY/production, deployment
`dpl_7VR2qTLRTP2C2To6r7sdJ2oLNGkt`, and assigned the canonical alias:

- Entry: https://orion-clinic-cloud.vercel.app/sign-in
- Deployment: https://orion-clinic-cloud-ou7mjbghp-shadowocc.vercel.app
- Inspector: https://vercel.com/shadowocc/orion-clinic-cloud/7VR2qTLRTP2C2To6r7sdJ2oLNGkt

The entry's canonical hostname is required by exact-origin Auth. Deployment
hostname is diagnostic, not a substitute login URL.

Fresh public HTTPS checks, without passwords/tokens or identity headers:
sign-in200; health/live200 with `clinicalReady:false`; patient API401;
unauthenticated session401; CSRF200 with Secure/HttpOnly/__Host cookie flags;
wrong-Origin CSRF403; pathway503 as intentionally unported. Responses no-store.
Two actual stylesheet URLs and the webpack script returned200 with correct
content types. Browser AX and screenshot showed the styled personal email/password
form, with no shared technical account. Login tab kept as a deliverable.

No owner password was read, entered, stored or reset. This is publication and
anonymous entry/denial acceptance, not authenticated CRUD/reload/revocation/
two-account proof or completion of the remaining clinical modules. Cloud login
uses the manually created Supabase account, not local `accounts.html` credentials.
