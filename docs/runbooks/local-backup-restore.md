# Local synthetic backup and restore drill

## Purpose

This runbook proves that the current ORION data shape can be backed up and
restored without using the developer's active `.wrangler/state`. It is a CI and
engineering control for synthetic data only. It is not the production backup
policy.

## Prerequisites

- Node.js `24.19.0` and pnpm `11.19.0`.
- Dependencies installed with `pnpm install --frozen-lockfile`.
- At least 64 MiB free on the filesystem containing the repository.
- No real patient information anywhere in the repository or fixture inputs.

The active local server does not need to be running.

## Run

From the ORION Clinic repository root:

```powershell
pnpm backup:drill:local
```

A passing run prints one final JSON object with `"status": "PASS"` and removes
its temporary run directory. To retain the synthetic backup, restored state,
and verification files for inspection:

```powershell
pnpm backup:drill:local -- --keep
```

Retained artifacts are written under a unique ignored directory named
`work/backup-restore-*`. A failed run is also retained and prints its exact
evidence directory. Inspect the error before removing that one directory.

## What the drill does

1. Creates a unique empty source directory and copies only the Wrangler binding
   declaration and checked-in migrations into it.
2. Applies all migrations, loads the idempotent synthetic seed, writes three
   cross-store fixture references, and stores three R2 objects, including a
   zero-byte edge case.
3. Runs SQLite `quick_check`, foreign-key checks, migration-history checks,
   audit-head continuity checks, and canonical schema/data hashes.
4. Exports separately hashed D1 schema and data files, downloads every known R2
   object, hashes all bytes, writes `manifest.json`, and writes `COMPLETE.json`
   last as the completed-backup marker.
5. Verifies the marker and every manifest/file hash, then recursively removes
   only the unique synthetic source directory.
6. Restores D1 into a different empty local state, restores all R2 objects,
   checks every object hash, and compares the restored database with the source
   snapshot. D1 references to the document, audio, and consent evidence objects
   must all resolve in the backup manifest.

The restore target has a fail-closed non-empty-directory guard. The script also
self-tests that guard before touching the synthetic source.

## Safety properties

- The drill never points migrations, exports, deletes, or restores at the root
  `.wrangler/state`.
- The source and restore paths must be descendants of the unique run directory;
  recursive removal refuses any path outside that boundary.
- Backup paths are resolved beneath the backup directory to block path
  traversal.
- Fixtures are deterministic, synthetic, and intentionally small.
- Secrets and real recordings/documents are forbidden by the repository secret
  scanner and artifact policy.
- Failure preserves evidence instead of deleting it.

## Passing criteria

A run passes only when all of these are true:

- the expected five checked-in migrations were applied and restored;
- SQLite `quick_check` returns `ok` and `foreign_key_check` is empty;
- schema and canonical table data hashes are identical before and after restore;
- audit stream heads point to their expected last event;
- all R2 sizes and SHA-256 hashes match;
- every synthetic database-to-object reference resolves;
- the isolated source was deleted before restore began.

The result reports table, row, migration, object, byte, and elapsed-time counts
for evidence. Counts may grow as the synthetic seed and schema evolve; the
script's invariant checks are authoritative.

## What this does not prove

- production D1, PostgreSQL, S3, or any vendor-specific backup operation;
- point-in-time recovery, backup encryption, key recovery, immutability, or
  geographic separation;
- a backup schedule, expiry aligned with deletion policy, RPO, or RTO;
- recovery of identity providers, STT/AI providers, KMIS, messaging, or DNS;
- legal approval for real patient data.

Production recovery remains blocked by DEC-008, DEC-010, and DEC-015 in
`docs/MASTER_PLAN.md`.

## Failure handling

1. Keep the printed failed evidence directory.
2. Record the command, final error, environment, and any changed counts.
3. Do not weaken hash, foreign-key, audit, or non-empty-target checks to make the
   run pass.
4. Fix the exporter/restore logic or migration and rerun from a new isolated
   directory.
5. Remove only the exact failed `work/backup-restore-*` directory after the
   evidence is no longer needed.
