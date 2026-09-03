# CI quality gates

## Scope

The repository CI is an engineering gate for synthetic development. It does not
deploy, publish artifacts, connect to clinic systems, or approve a medical
release. All jobs run with `ORION_SYNTHETIC_DATA_ONLY=true`.

Workflow: `.github/workflows/ci.yml`

Triggers:

- pull requests;
- pushes to `main`;
- explicit `workflow_dispatch` runs.

The workflow has read-only repository permissions, pinned action revisions,
concurrency cancellation for superseded branch runs, and bounded timeouts.

## Required jobs

| Job | Runtime | Gate |
|---|---|---|
| `quality` | Ubuntu and Windows, Node from `.node-version` | frozen install, lint, TypeScript, 37+ unit/integration tests, Drizzle journal check, production build, whitespace check |
| `security` | Ubuntu | tracked and untracked repository-file secret/artifact scan and dependency audit with High/Critical as failures |
| `recovery` | Ubuntu | migration generation must produce no repository drift; isolated D1/R2 backup-and-restore drill must pass |

The branch protection policy should require every matrix result plus `security`
and `recovery` before merge. Administrators should not routinely bypass failed
clinical-foundation gates.

## Gate behavior

### Reproducible dependency install

CI installs the exact pnpm version declared in `package.json` and runs:

```text
pnpm install --frozen-lockfile
```

The lockfile may change only in an explicitly reviewed dependency update.

### Code and domain verification

`pnpm verify` runs lint, strict TypeScript checking, tests, Drizzle metadata
checks, and the Vinext production build. Build success alone is not a clinical
acceptance result; tests must assert the domain and persistence invariants.

### Secret and sensitive-artifact scan

`pnpm security:secrets` scans all tracked files plus untracked files not excluded
by `.gitignore`, and fails on known API-key,
private-key, credential-assignment, database, audio, clinical-document, or
archive patterns. It prints file/rule names but never the matched value.

This scanner is a repository baseline, not a complete data-loss-prevention
system. Before Gate 1, the hosting organization must enable provider-side secret
scanning with push protection, rotate all credentials previously disclosed in
development conversations, and run a reviewed historical scan.

### Dependency audit

`pnpm security:dependencies` fails on High or Critical advisories. Lower-severity
findings remain visible in logs and require triage; they are not silently
ignored. An exception must name the advisory, reachable surface, compensating
control, owner, and expiry in a reviewed security decision.

### Migration drift

The recovery job runs `pnpm db:generate` and then fails if `db/schema.ts` or any
file beneath `drizzle/` is modified or newly generated. Custom migrations must
be represented in `drizzle/meta/_journal.json` and corresponding snapshots so a
clean generation is stable.

### Recovery

`pnpm backup:drill:local` uses unique synthetic D1/R2 state and verifies a
non-empty backup after destroying its isolated source. The active developer
state and any production system are outside the command's path boundary.

## Pull-request evidence

A change that affects a release gate should record:

- the user-visible or domain behavior changed;
- tests added or updated;
- migration and data compatibility impact;
- security, consent, retention, and audit impact;
- exact CI results and known limitations;
- rollback or safe-disable path.

Changes to workflows, pinned action revisions, dependency overrides, secret
rules, migration policy, or recovery validation require explicit engineering
review.

## Failure policy

- Do not bypass a failing gate by deleting tests, reducing audit severity,
  weakening secret patterns, accepting migration drift, or excluding referenced
  R2 objects.
- A flaky test is a defect. Quarantine requires an owner, expiry, linked issue,
  and a safe remaining gate.
- A failed backup drill blocks the foundation gate even if lint/build pass.
- CI never supplies production credentials and never uses real patient data.

## Remaining production controls

Before a real pilot, CI/CD still needs signed artifact provenance, an SBOM,
container/image scanning after the deployment artifact is selected, protected
environments, approval separation, deployment smoke tests, rollback exercises,
and clinic-approved vulnerability and incident ownership. Their exact
implementation depends on DEC-008 and the future hosting platform.
