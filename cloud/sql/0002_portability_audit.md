# PostgreSQL access/patient checkpoint

This is a real PostgreSQL vertical, not SQLite stored in Supabase, a D1 API
emulator, or a second copy of the local database. No external SQL has been
applied by this task. Local clinical rows, credential hashes and environment
files have not been read or imported.

Source audit: all 53 committed SQLite/D1 migrations applied in an isolated
in-memory database yield 97 tables, 386 active triggers and 22 views. The 27
repository implementations rely on tenant-composite keys, append-only versions,
monotonic heads, atomic D1 batches and audited reads. Replacing only the database
URL cannot preserve those contracts.

`0002_access_patient_registry.sql` supplies 18 private PostgreSQL tables: the ten
organization/facility/user/membership/department/assignment tables, four patient
registry tables, an encounter **read catalog only**, two facility audit tables
and command idempotency. It preserves text IDs, millisecond bigint times,
composite tenant FKs, immutable versions/roots, direct-successor head fences,
role-default permissions with deny precedence, actor-bound permissions,
terminal identifier revocation and the ordered SHA256 hash-schema-1 bytes.

The six public RPCs are `SECURITY DEFINER`, `search_path=''`, executable only by
`authenticated`. No API role, including `service_role`, has schema/table/helper
access. All 18 tables have RLS enabled and no permissive table policy. Identity
comes from the verified JWT issuer/subject and a live locked `auth.sessions`
row; roles come only from the current internal DB assignment. Logout, banning,
staff disabling and expired/revoked assignments deny subsequent calls.

## RPC contracts

- `orion_access_overview()` → `{user:{id,displayName},assignments,observedAt}`.
- `orion_patients_list(assignment_id,facility_id=null,query=null,status='active',max_results=50)` → `{patients,accessAssignmentId,observedAt}`.
- `orion_patient_detail(assignment_id,patient_id,facility_id=null)` → `{patient:PatientDetail|null,accessAssignmentId,observedAt}`.
- `orion_patient_create/update/archive(assignment_id,payload,facility_id=null)` → `{patient:PatientDetail,accessAssignmentId,observedAt,replayed}`.

Payloads use the existing patient form names; update/archive include patientId.
SQL independently validates the exact per-operation field allowlist and literal
`testDataAcknowledged:true`. No actor ID, roles, hash, version-row ID or audit
provenance is accepted from the client. Trusted request IDs are SQL-generated.
Photos remain null until a governed storage port exists.

Writes are one PostgreSQL RPC transaction with current authority SHARE fences,
tenant/facility advisory writer serialization, duplicate guard, immutable
successor/head change, actor/operation idempotency and mandatory hash audit.
Reads and idempotency replay are audited before returning; an audit failure
rolls back the complete RPC. Idempotency replay returns the current readable
profile, not a stale snapshot, without creating another mutation/version.
Search is literal substring matching, not client-supplied LIKE wildcards.

## Test evidence and limitations

Run `pnpm exec vitest run cloud/sql/0002_access_patient_registry.test.ts --project unit --no-file-parallelism --maxWorkers=1`.
Tests execute both migrations inside PGlite (WASM PostgreSQL), with isolated
Auth tables and fake identities. They exercise real function/trigger execution,
API grants, audited read/write rollback, versions, replay, archive, current
authority, cross-tenant denial, payload validation and Node/PG audit byte parity.
The separate one-time owner bootstrap template is tested against unconfirmed,
confirmed and already-provisioned identities. It contains no real UUID/email.

PGlite does not establish deployed Supabase/PostgREST/JWT-signature acceptance,
two-connection race/deadlock behavior, backups, actual browser persistence or
clinical approval. The migration owner must separately verify live `auth.users`
and `auth.sessions` compatibility, RPC grants and complete cloud UI/API behavior.
The bootstrap template requires a fresh, specifically approved confirmed Auth
identity. It does not select the first user or grant access during signup.

Unported observation/order/care/scheduling/communications/protocol/audio/photo
workflows remain closed and must be shown as unavailable, not invented zeroes.
The catalog's encounter table does not authorize encounter creation/finalization.
Further migrations must explicitly port those lifecycle and audit invariants.

Portability hazards: SQLite `IS` becomes `IS NOT DISTINCT FROM`; json_each needs
validated jsonb arrays; `INSERT OR REPLACE` is not a safe head UPSERT; D1 batch
must become one PG function transaction, not sequential REST calls; PG integer
casts round, so BMI later needs explicit floor/numeric arithmetic; latest vitals
must select each measurement family independently. Local Auth/password tables
are deliberately not transferred to Supabase Auth.

Relevant primary documentation:
[Supabase session revocation](https://supabase.com/docs/guides/auth/sessions),
[JWT fields](https://supabase.com/docs/guides/auth/jwt-fields),
[PostgreSQL binary-string SHA256](https://www.postgresql.org/docs/16/functions-binarystring.html).
