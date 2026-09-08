# Explicit reconciliation of one synthetic export attempt

Scope: local synthetic D1/R2 only. This is an operator API, not an automatic
retention policy, general bucket cleaner or clinician-facing cleanup button.
Never run SQL DELETE against `export_cleanup_fences`: those tombstones permanently
prevent a delayed publisher from referencing removed bytes.

## Preconditions

- Forward migration 0045 is applied; application and DB versions match.
- Use the normal authenticated browser session, same origin and one explicit
  current `encounter.manage` doctor assignment for the exact treating encounter.
- The protocol must still be the current signed version of a finalized/amended
  encounter. No fallback to another assignment or old signed protocol is permitted.
- Identify the exact private attempt manifest from authorized local support
  inspection, not a guessed global bucket scan. Do not paste manifests, identities,
  object bytes, cookies or clinical data into logs, chat or Git.
- Its `schemaVersion` must be 2 and status `publication_pending`. Version 1,
  `uploading`, `published`, malformed, differently attributed or oversized manifests
  are retained, not adopted or rewritten. Their separate reconciliation is deferred.

## Request contract

`POST /api/workspace/exports/reconcile?facilityId=<selected>&accessAssignmentId=<selected>`

JSON fields (no arbitrary object paths are accepted):

- `encounterId`: exact selected encounter.
- `protocolId`, `expectedProtocolVersion`: current signed protocol identity/version.
- `attemptId`: UUID from its private `attempt-<UUID>/manifest.json` key.
- `idempotencyKey`: original generation intent key from that manifest; do not invent
  a replacement key for reconciliation.
- `acknowledgeSyntheticCleanup`: literal `true`, supplied only after the operator
  deliberately selects this synthetic attempt for cleanup.

The server derives the prefix from the authorized scope. It validates all five
unique artifact kinds, basenames, exact derived keys, actor, assignment and intent.
No audio asset or general-purpose object deletion endpoint is exposed.

## Outcomes and recovery

| Status | Meaning / next action |
|---|---|
| `absent` | Manifest does not exist. No files were deleted by this request. |
| `retained` | Manifest is not eligible or any file already has a DB reference. No cleanup is performed. |
| `cleaned` | All five files and then the manifest were deleted after durable fencing. Fence rows remain. |
| `retry_required` | At least one file deletion failed; manifest and permanent fences remain. Retry the exact request. |
| HTTP 403/409 | Access or source changed. Reopen the correct encounter; do not substitute another scope automatically. |
| HTTP 503 | Operation outcome may be unknown. Retry the exact request after service recovery; never manually remove files based only on this response. |

All five fence rows must be atomically present with exact matching scope before
deletion begins. SQL rejects fencing an already referenced key and rejects future
artifact INSERT/UPDATE references to a fenced key. A final in-batch assertion
rejects skipped or mismatched fence rows. Current authority is checked again before
the confirmed fence result is returned. If the fence response is lost, no deletion
starts until a later retry verifies the permanent rows.

Concurrent publishers and cleaners are ordered by the DB transaction. A publisher
that wins keeps its files; a cleaner that wins permanently prevents publication of
those exact keys. New generation attempts use fresh UUID keys and are unaffected.

## Deliberate limitations

No age threshold, automatic worker, global list endpoint, production retention
decision, stale-protocol cleanup or adoption of legacy manifests is introduced.
Do not infer such policy from this API. Tests use isolated synthetic storage and
SQLite; no existing user export has been deleted during implementation verification.
