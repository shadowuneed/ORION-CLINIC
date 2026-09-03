# ORION Clinic runtime topology

- Status: engineering baseline
- Last verified: 2026-08-28
- Decision dependency: DEC-008 remains open

This document separates what runs today from the intended deployment shape.
It must not be read as approval to store real patient data in D1, R2, a public
cloud, or any particular country or region.

Status labels used below:

- `VERIFIED_CURRENT`: present in this repository and exercised locally.
- `TARGET_PROPOSAL`: an intended boundary that is not implemented yet.
- `BLOCKED_BY_DEC_008`: requires clinic IT, legal, and security decisions.

## 1. Current local topology — VERIFIED_CURRENT

```text
Clinician browser
      |
      | HTTP on localhost:3200
      v
Vinext/Vite development command
  - React server/client application
  - API route handlers
  - identity-header parsing supplied by Sites local sign-in
  - domain services and repositories
      |
      +---- DB binding ----> local D1 state under .wrangler/state
      |
      +--- FILES binding --> local R2 state under .wrangler/state
```

One developer command starts the application runtime:

```powershell
pnpm dev -- --port 3200
```

Vinext, Vite, Wrangler, and the Cloudflare runtime may create their own child
processes. They are one managed application runtime, not independently operated
ORION services. There is currently no separate background worker, scheduler,
message broker, PostgreSQL server, S3 emulator, OpenTelemetry collector,
Dockerfile, or Compose file.

| Concern | Verified current behavior | Limitation |
|---|---|---|
| Web and API | One Vinext application serves UI and route handlers | Not horizontally scaled |
| Structured data | Repositories use the `DB` D1 binding | Fixed synthetic clinic scope only |
| Files | Readiness uses the `FILES` R2 binding | No production document/audio pipeline |
| Identity | Sites local sign-in headers are parsed server-side | Not clinic OIDC, MFA, or real membership authorization |
| Async work | Commands may commit outbox rows atomically with domain/audit data | No outbox dispatcher is running |
| Liveness | `/api/health/live` checks that the application can answer | Does not prove dependencies |
| Readiness | `/api/health/ready` checks runtime configuration plus D1/R2 bindings | Does not yet check STT, AI, identity, or integrations |
| Logs | Correlation-aware, allowlisted technical request logs | No centralized telemetry backend |

The local database and object state are developer state, not an approved
medical-record system. The application must remain synthetic-only until a later
release gate explicitly changes that rule.

## 2. Local deployment-parity shape — TARGET_PROPOSAL

The target remains a modular monolith with independently runnable process roles,
not a premature microservice estate:

```text
browser -> web role -> PostgreSQL-compatible repository ports
                    -> S3-compatible ObjectStorageProvider

                     same transactional database
                               |
                               v
                         outbox_events
                               |
                               v
                         worker role
                               |
                  STT / LLM / clinic adapters

migrate role -> forward-only schema migrations -> database
```

Proposed process contracts:

- `web`: synchronous UI/API work only. A clinical command, audit event,
  idempotency record, and outbox event commit in one database transaction.
- `worker`: leases durable outbox work, uses idempotency keys, records attempts,
  applies bounded retry/backoff, and moves exhausted work to a visible failed or
  dead-letter state. It never relies on an in-memory queue.
- `migrate`: a one-shot pre-deployment role. Only one instance runs for a
  release, and web readiness is enabled only after compatible migrations pass.

The future local-parity environment should use the same application artifact
and commands as the server environment, with disposable PostgreSQL and
S3-compatible dependencies. Container files are intentionally not created at
this checkpoint: selecting images, health probes, storage products, encryption,
and restore tooling before DEC-008 would encode an unapproved production
decision.

## 3. Server candidate — BLOCKED_BY_DEC_008

The following is a boundary diagram, not a selected vendor or deployable stack:

```text
trusted ingress / TLS / WAF
            |
            v
       web replicas  <------> clinic-approved IdP
            |
            +------> highly available transactional database
            |                    |
            |                    +----> worker replicas -> external adapters
            |
            +------> encrypted object storage

one-shot migration job
central PHI-minimized logs, metrics, traces, and alerts
independent encrypted backups with tested restore
```

DEC-008 must decide hosting jurisdiction and residency, database and object
storage, encryption/key custody, network boundaries, backup provider, and
disaster-recovery location. DEC-015 must decide SLO, RPO, RTO, support hours,
and incident ownership. Until both decisions are signed, this topology cannot
be called production-ready.

## 4. Health, rollout, and rollback contract

- Liveness means only that the web process can serve a bounded request.
- Readiness means required configuration and the authoritative database/object
  dependencies for that role are usable. Each future adapter adds its own
  readiness or degraded-state policy; one optional AI provider must not make
  confirmed clinical records unavailable.
- Deployments apply reviewed forward migrations before enabling new web/worker
  code. Migration generation must leave `db/schema.ts`, `drizzle/`, and the
  Drizzle journal clean in CI.
- Application rollback is allowed only while the previous version is compatible
  with the migrated schema. Destructive down-migrations are not an automatic
  rollback mechanism; a reviewed corrective forward migration is preferred.
- Every externally retried operation uses a durable idempotency key and a
  reconciled terminal state.

## 5. Secrets and observability contract

- Local non-secret settings are declared in the checked-in runtime config.
- Secrets enter through environment/platform secret injection and are never
  baked into an image, written to this plan, or committed in `.env` files.
- Logs allow technical identifiers, correlation IDs, status, latency, and
  bounded error codes. They do not accept transcripts, diagnoses, prompts with
  PHI, authorization headers, or file contents.
- Production must add centralized logs, metrics, traces, alert routing, audit
  retention, and access controls. Current request logging is a foundation, not
  an operated observability service.

## 6. Backup boundary

`pnpm backup:drill:local` verifies a non-empty synthetic logical D1 backup plus
R2 objects, destroys only its isolated source, restores into a new empty local
state, and compares schema, data, migration, audit, foreign-key, and object
hashes. See `docs/runbooks/local-backup-restore.md`.

This demonstrates recoverability of the local data shape. It does not establish
a production backup schedule, retention, immutability, geographic separation,
RPO, RTO, or legal suitability. Those remain blocked by DEC-008, DEC-010, and
DEC-015.
