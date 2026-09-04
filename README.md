# ORION Clinic

ORION Clinic is a production-oriented foundation, not a production-ready system,
for a clinician-controlled care workflow. It is being built separately from the
legacy ORION prototype so the working speech experience remains available while
identity, persistence, audit, clinical documentation, scheduling, longitudinal
care, and integrations are rebuilt on explicit domain boundaries.

The canonical implementation and handoff plan is:

- [`docs/MASTER_PLAN.md`](docs/MASTER_PLAN.md)

Operational foundation:

- [`docs/architecture/runtime-topology.md`](docs/architecture/runtime-topology.md)
- [`docs/operations/ci-quality-gates.md`](docs/operations/ci-quality-gates.md)
- [`docs/runbooks/local-backup-restore.md`](docs/runbooks/local-backup-restore.md)
- [`docs/user-guide/clinician-workspace.ru.md`](docs/user-guide/clinician-workspace.ru.md)
- [`docs/user-guide/orders-results.ru.md`](docs/user-guide/orders-results.ru.md)
- [`docs/user-guide/scheduling-queue.ru.md`](docs/user-guide/scheduling-queue.ru.md)

Clinic requirements and review:

- [`docs/requirements/clinic-leadership-catalogue.md`](docs/requirements/clinic-leadership-catalogue.md)
- [`docs/requirements/clinic-discovery-pack.md`](docs/requirements/clinic-discovery-pack.md)

## Local development

The supported Windows path starts the web workspace, local D1 state, and the
local GigaAM/CAMPPlus speech service together. From PowerShell:

```powershell
cd "C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC"
.\SETUP_ORION_CLINIC.bat       # first run only
.\CONFIGURE_GROQ.bat           # optional; prompts for a NEW key without echo
.\START_ORION.bat
```

Open `http://localhost:3200/` for the main ORION Clinic dashboard. The D1-backed
patient registry is available at `http://localhost:3200/patients`: it supports
facility-scoped search, creation of an artificial patient card, a persisted
patient detail view, explicit facility selection for multi-facility memberships,
fail-closed read auditing, append-only versioned profile corrections, non-destructive
archive with active/archive/all filters, and creation of a separate encounter for
that patient. The
working face-to-face consultation migrated from the preserved ORION prototype
is an additional module at `http://localhost:3200/live`; the dashboard item
**«Очный приём · LIVE»** opens the exact selected D1 encounter by its
`encounterId`. In this authoritative mode the server rechecks the clinician
assignment, lifecycle and current consent for every speech, analysis and review
command. Browser-local history, an optional browser recording and compatibility
downloads remain convenience artifacts and are explicitly not the signed D1/R2
medical record. The D1/R2-backed Phase 4 local slice is available at
`http://localhost:3200/orders`: a clinician can create and separately approve a
laboratory, ECG, service or specialist request, attach a PDF/JPEG/PNG result, mark
reconciliation or review, and complete only a reviewed final result. Every
request/report version remains immutable. Before any result bytes are written to
R2, D1 stores a durable upload intent; exact retries reuse the original
command-time patient and encounter snapshot. The authenticated, same-origin
`POST /api/orders/result-uploads/reconcile` maintenance endpoint performs
two-pass cleanup only for expired, uncommitted uploads. It is not an automatic
scheduler and never removes committed clinical artifacts. No external
KMIS/LIS/ECG delivery is connected or claimed by this slice.

The Phase 5 local scheduling and electronic-queue slice is available at
`http://localhost:3200/scheduling`. It reads approved synthetic referrals from
D1, captures immutable patient-preference snapshots, performs version-checked
slot hold/confirmation/cancellation, prevents concurrent double booking, and
advances an auditable queue ticket through arrival, call, service and completion.
Every slot is labelled **«Тестовое ручное расписание · не КМИС»**. No AI-generated
availability, real KMIS booking, notification delivery, waitlist/rescheduling or
automatic expired-hold worker is connected or claimed.

The launcher refuses to replace unrelated
processes on ports `3200` or `3101`, applies forward-only local migrations,
loads only the idempotent technical bootstrap needed for local sign-in, writes
logs under `.orion-runtime/logs`, and keeps secrets in the ignored `.dev.vars`
file. Stop only this checkout with:

```powershell
.\STOP_ORION_CLINIC.bat
```

`START_ORION_CLINIC.bat` remains as a compatibility alias; the normal entry point
is the shorter `START_ORION.bat` carried over from the earlier local workflow.
The migrated source map and its deliberate compatibility limits are recorded in
[`docs/migrations/legacy-live-consultation.md`](docs/migrations/legacy-live-consultation.md).

The manual web-only path requires Node.js `24.19.0` and pnpm `11.19.0`. The
exact Node baseline is also recorded in `.node-version`.

```powershell
pnpm install --frozen-lockfile
pnpm db:migrate:local
pnpm db:bootstrap:local
pnpm dev -- --port 3200
```

`pnpm db:seed:local` is an explicit optional fixture command for engineering
tests and screenshots. Normal startup no longer inserts patient or encounter
fixtures automatically. Existing local D1 records are preserved.

After the base fixture, a separate rerunnable scheduling fixture can populate one
approved referral and four explicitly manual test slots:

```powershell
pnpm db:seed:scheduling:local
```

It is never run by normal startup and must not be treated as clinic availability.

The local workspace is available at `http://localhost:3200/`. Verify a checkout
with:

```powershell
pnpm verify
```

Run the aggregate local foundation gate, including secret and dependency checks
plus a destructive-in-isolation backup/restore drill, with:

```powershell
pnpm verify:ci
```

The recovery drill uses only unique synthetic state under `work/` and does not
touch the active `.wrangler/state`:

```powershell
pnpm backup:drill:local
```

Current development is artificial-data only and is not production-ready. After
Sites sign-in, a provider-neutral identity adapter resolves an active D1 clinic
membership and facility before listing or creating patients; exact clinician
assignment is then enforced for encounter-scoped workspace content. The visible
workspace loads the patient/encounter context,
current transcript segments, recommendation state, all eight clinical sections,
and the current protocol head from local D1. Transcript corrections and manual
speaker assignments are append-only. Recommendation decisions and section edits,
reviews, and explicit-absence decisions create immutable versions, idempotency
records, and correlated append-only audit events.

The current bounded checkpoint supports versioned RU/KK synthetic consent,
audited encounter transitions through clinician review, readiness-gated protocol
drafting and signing, immutable finalized records, and append-only signed
amendments that create a new protocol version without rewriting its predecessor.
A clinician can start and stop local microphone capture during an `in_progress`
encounter after the required consent decisions and recovery confirmation. The
browser performs voice-activity segmentation, uploads short 16 kHz mono WAV
utterances to the authenticated encounter-scoped API, and persists only the
returned final transcript segments; raw audio is not retained by this checkpoint.
The local speech provider uses the pinned multilingual GigaAM model and local
CAMPPlus speaker attribution service on loopback port `3101`.

The same server-owned encounter, patient, consent, transcript and pending
recommendation state is used on both `/` and `/live`. Opening `/live` without an
identifier resolves an accessible encounter on the server and rewrites the URL;
an inaccessible or non-`in_progress` encounter remains locked instead of falling
back to a random or browser-only patient. The live screen never auto-runs Groq in
authoritative mode: the physician must acknowledge the exact text, languages and
speaker roles before requesting new drafts.

An optional server-side Groq adapter can generate structured clinical drafts
from an exact doctor-acknowledged final/corrected transcript snapshot. It uses
`openai/gpt-oss-120b`, validates JSON-schema output and evidence quotations, and
creates only pending suggestions/AI drafts. Nothing is accepted into the
protocol without an explicit clinician action. The Groq key is never sent to the
browser; a fresh key must be configured locally before this path can run.

A signed protocol can be exported as genuine DOCX and rendered PDF with the full
labelled transcript and amendment history, transcript TXT, audit/provenance JSON,
or one integrity-manifested ZIP package. Generation and every download are
authenticated, encounter-scoped, and audited. New encounters never receive
implicit consent. After signing, the UI and server repositories reject transcript,
section, and recommendation mutations; only the dedicated amendment flow can
advance the signed protocol head.

Production identity provisioning, real patient search/merge, clinic-approved
consent, production audio/STT operations, clinically validated AI, legally
significant electronic signature, external clinic integrations, and deployment
are not connected yet. Local speech and optional Groq drafts are prototype-grade
synthetic workflows, not authorization for patient care. Do not enter real
patient information.

## Engineering principles

- AI drafts; the doctor decides.
- Signed clinical records are versioned and never silently overwritten.
- Every AI statement links to its evidence and inference metadata.
- Rejected suggestions stay in audit and do not enter the signed protocol.
- Server-side authorization must protect every read, write, export, and download.
- External systems are accessed through explicit adapters with idempotency,
  retry, reconciliation, and a manual fallback.
- The legacy project at
  `C:\Users\profm\OneDrive\Документы\ChatGPT\ariaproject` is preserved.
