# ADR-0001: Separate production-oriented ORION Clinic codebase

- Status: Accepted
- Date: 2026-08-28

## Context

The legacy ORION checkout has a useful local RU/KZ speech loop, speaker mapping,
clinician-only suggestions, review controls, browser history, and export. It is
also explicitly a prototype and contains uncommitted user work, development
authentication bypasses, browser-authoritative persistence, and no clinic-wide
workflow modules.

The clinic requirements introduce patient identity, longitudinal records,
orders, scheduling, queues, care plans, notifications, monitoring, and
inter-hospital transfer. Retrofitting all of those directly into the legacy
checkout would couple production work to prototype assumptions and risk losing
the known-good speech baseline.

## Decision

Create `ORION-CLINIC` as a separate repository. Preserve the legacy checkout and
move only individually reviewed components through explicit migration tasks.

The first release is a modular monolith. Microservices are not introduced until
independent scaling, security isolation, ownership, or SLA requirements justify
them.

The current Sites scaffold provides a fast local web surface and local D1/R2
bindings. Those bindings are not yet approved as the production medical data
plane. Production persistence and hosting remain behind interfaces until the
clinic, legal, security, and data-residency decisions are recorded in DEC-008.

## Consequences

- Existing ORION remains runnable and recoverable.
- Migration is slower than copying all files, but each dependency and clinical
  behavior becomes auditable.
- Speech integration is deliberately deferred until the new encounter contract,
  consent model, persistence, and authorization boundaries exist.
- The product can move from local development to a compliant server without
  embedding browser storage or a single vendor directly in domain logic.
