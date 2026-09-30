# ADR-0003: Online-first encrypted staff materials and explicit action authority

- Date: 2026-09-24.
- Status: Accepted as the engineering direction for isolated synthetic implementation. **Not activated**, not a key service, not approval for clinical retention, real data or offline access.
- Checkpoint: ONLINE-1C1d. Prerequisites: individual staff identity ONLINE-1B and [local-material isolation plan](../operations/local-material-isolation-plan.md).
- Scope: a separate encrypted staff-material repository. Existing `orion-local-history` v1, main D1, audio, development identity and running services remain unchanged.

## 1. Decision and threat boundary

The first v2 implementation is **online-first**. A future dedicated ORION key
broker keeps a recoverable wrapped data key and releases an operation-scoped key
only after current server authorization. A browser keeps the released key only
in memory; it never persists raw keys, a wrapping key, passwords, cookies or
`CryptoKey` handles alongside ciphertext. No hard-coded key or process-local
`Map` substitutes for a durable broker. Broker unavailable means no new reveal,
export or durable sensitive save in the new runtime, not a plaintext fallback.

This decision prevents an application from treating a stored row as permission;
it does **not** make browser-held keys remotely revocable. A retained key handle
can still decrypt its ciphertext. `extractable: false` restricts key export, not
subsequent use or all forms of persistence. Online-only is therefore an
application authorization rule, not cryptographic proof that a disconnected or
compromised client cannot read previously released material. Web Crypto defines
both key usage and serialization separately from extractability.
[Web Crypto key interface](https://www.w3.org/TR/webcrypto/#cryptokey-interface).

Threats addressed: accidental cross-staff/assignment/patient reads, stale async
publication, swapped/corrupted envelopes, lost updates, rollback to an older
local row, and local ciphertext disclosure without the broker key. Threats not
solved: active same-origin XSS/extensions, compromised OS, an authorized user
copying plaintext, old v1 plaintext, screenshots, browser memory recovery or
forcibly recalling an already downloaded export. Minimize plaintext lifetime,
clear application references and revoke Object URLs, but do not promise secure
erasure of all copies from JavaScript memory.

An alternative where the broker alone encrypts/decrypts would avoid releasing
DEKs, but sends every plaintext audio/transcript through that server, changing
the current local-audio data flow and throughput requirements. It is **not** an
automatic fallback. It requires its own processor/residency/consent decision.

## 2. Data and key ownership

Use one immutable, random data-encryption key (DEK) for each payload of a material
revision. Audio and transcript keys are distinct. A fresh content revision uses
a fresh DEK, even when retrying after an uncertain encryption result. IDs are
allocated by the trusted broker and uniqueness is enforced durably, not inferred
from a display name, encounter ID or a browser's claimed owner.

The broker stores only scoped key metadata, wrapped DEKs, state and minimal
audit/receipts. Ciphertext stays in the new local repository in this first
design; it is not a backup and is not the authoritative signed clinical record.
The broker's wrapping key belongs to a dedicated approved ORION key-management
facility, separate from the clinical DB and browser bundle. No such facility is
configured by this ADR. No other project's key, database or infrastructure may
be used. D1 could hold wrapped bytes, but D1 alone is not key custody.

The key record binds the full immutable owner from `descriptor.ts`, material/run/
revision, payload kind, key ID/version, encryption profile, policy version and
creation/retirement state. Client metadata is a selector, not proof of this
binding. Password reset, account re-enable or a new session must not resurrect
retired grants/keys. Future reassignment/recovery must be an explicit separately
authorized operation; no changing the owner on a saved envelope.

Rotation distinguishes rewrapping a DEK under a new wrapping-key version from
reencrypting content under a new DEK. Rewrapping does not revoke an already
released DEK. A suspected exposed DEK requires new content encryption and an
incident decision; it cannot make an attacker's old copy unreadable. Backups and
restore must preserve terminal retirement and receipt uniqueness before key
release is re-enabled. Recovery/destruction rules and backup key availability
are outstanding operational decisions, not implicit effects of logout.
[OWASP key lifecycle guidance](https://cheatsheetseries.owasp.org/cheatsheets/Key_Management_Cheat_Sheet.html).

## 3. Envelope profile and isolated primitive

Use platform Web Crypto AES-256-GCM, 96-bit random nonce and 128-bit tag. One
encryption invocation per fresh DEK avoids relying on a counter surviving reload
or two-tab races. Retries replay the exact stored ciphertext/receipt, or allocate
a new DEK and operation; never encrypt modified bytes with a prior key/nonce.
Use the platform random source, not timestamps or `Math.random()`.
Authenticated encryption protects integrity as well as confidentiality;
plaintext must not be published if authentication fails.
[OWASP storage guidance](https://cheatsheetseries.owasp.org/cheatsheets/Cryptographic_Storage_Cheat_Sheet.html),
[Web Crypto AES-GCM](https://www.w3.org/TR/webcrypto/#aes-gcm).

The future envelope contains an allowlisted versioned header, nonce and bounded
ciphertext including tag. The authenticated additional data must bind:

- the exact canonical `serializeLocalMaterialBinding` string (kind, complete
  owner, schema, material/run/revision);
- envelope/profile version, exact key ID/version, payload encoding/content type
  and lengths; no user-selectable algorithm fallback;
- for segmented audio: immutable manifest ID, chunk index and total/finalized
  manifest binding, with a separate DEK per chunk and authenticated manifest.

Current `envelope-binding.ts` supplies **only the first item**, not this complete
header, encryption or a signature. Stored metadata is untrusted until verified
against the broker's expected scope and successful authentication. A copied
valid older ciphertext also needs a current server head check: AEAD alone does
not prevent rollback. Do not deserialize clinical content before that check.

Names, transcript, AI analysis and decisions belong inside ciphertext. Persist
only opaque material/key references and required crypto parameters locally;
retrieve the expected descriptor from the scoped server registry and reconstruct
AAD in memory. Do not serialize the owner descriptor or canonical AAD as a clear
header/index. A different clear owner index requires explicit privacy review.
Even opaque IDs/header/size/time can reveal relationships; they are not anonymous.
Do not log the binding or send it to analytics. Final wire format, per-kind size limits and
bounded chunking must be pinned by tests before any v2 write. Never encrypt an
unbounded full audio recording in one UI-blocking buffer by default.

## 4. Action authority and consent matrix

Every future operation resolves the individual principal and exact current
assignment/facility/patient/encounter. The current `server-context.ts` result is
**metadata only**: `resolved`, `authorizationGeneration` and `effectiveByTime`
are not action grants; a readable assignment may not manage an encounter.
Consent requires the correct approved policy/version/purpose and time, not
just a granted enum. This matrix is a conservative synthetic engineering
default; it does not define legal access to a medical record after withdrawal.

| Operation | Required server authority | Additional purpose checks |
| --- | --- | --- |
| Select minimal material metadata | Read exact clinical scope and own material | No plaintext or key. A scoped index must not reveal other staff's materials. |
| Capture/transcribe local speech | Manage current writable encounter | Care + transient audio processing; transcript storage when persisting text. Existing speech contract still applies. |
| Persist transcript revision | Manage current writable encounter, expected current head | Care + transcript storage, approved local retention profile. |
| Persist audio revision | Manage current writable encounter, expected current head | Care + audio retention, approved local retention profile; STT consent alone is insufficient. |
| Reveal transcript / play audio | Read exact scope, exact owner/material/current head | Care plus transcript storage / audio retention respectively; explicit current-policy permission for this action. No implicit write permission. |
| Send transcript to AI | Manage current writable encounter | Care + transcript storage + external AI processing, exact approved processor/policy and source versions. A local key lease does not grant egress. |
| Export/download | Separately approved export permission/policy | **Disabled initially**; explicit format/scope, current authority after async assembly, audit and user warning about uncontrolled copies. |
| Offline reveal/save | Separate offline entitlement/key/retention contract | **Disabled initially**; no assumption that server revoke reaches an offline tab. |
| Recover/reassign/erase | Dedicated operation and operator authority | **Disabled initially** pending policy. Withdrawal must not require the withdrawn consent to be granted again. Logout is not erasure. |

Unknown action, audience, policy, missing source, stale version, authority
failure, broker failure or audit failure denies key release/publication. Patient
and caregiver principals are not accepted here; MOBILE-1 has a separate boundary.

## 5. Durable commands, CAS and honest commit states

There is no atomic transaction across D1 and a browser IndexedDB database.
Implement explicit durable states and recovery, not a promise that two writes
are one transaction. Proposed sequence for each immutable revision:

1. The server atomically verifies current authority/consent, expected material
   head and unique operation fingerprint, then reserves a pending revision/key
   record with audit. Allocation may involve an external wrapping facility:
   incomplete preparation is not a readable head and must have reconciliation.
2. Only after that durable decision may the browser receive the encryption key
   through an authenticated no-store response. The caller captures a target lease
   before awaiting; no credential/key in URL, localStorage, telemetry or logs.
3. Encrypt outside the IndexedDB transaction. After checking the target lease,
   use one readwrite transaction for exact owner/run/current local revision,
   pending ciphertext and local receipt. A same-revision conflicting payload is
   an error, not last-write-wins. Transaction complete, not request success, is
   local persistence evidence. Invalidation aborts a still-active transaction.
4. Finalize on the server with the same operation ID, expected head and digest
   of exact envelope bytes. Recheck current action authority/consent and commit
   head + receipt + audit atomically. Same operation/same fingerprint returns
   its receipt; a different fingerprint conflicts. A concurrent loser cannot
   advance or relabel the winner's head. Lost responses use operation status.
5. Mark the local row acknowledged by the exact server receipt. If this final
   local write fails, reconcile on next authorized open. Never report a signed
   protocol or server-backed audio copy: the server has a key/head receipt, not
   the local audio bytes. Loss of local ciphertext may be unrecoverable.

UI states distinguish in-memory, pending encrypted local save, server-acknowledged
material, conflict and inaccessible/revoked. Abandoned pending keys/ciphertexts
need bounded quotas and a policy-approved orphan cleanup; no automatic deletion
of v1 or acknowledged material. A source snapshot changing during encryption
must fail final publication and remain explicitly pending/conflicted.

For reveal, perform a durable current-head/authority/audit decision before release,
then authenticate the envelope and revalidate before UI publication. In-flight
response races cannot be called instantaneous revocation: the release decision
is a defined server authorization point, with application fencing afterwards.
Generation hashes are observations, not monotonic revocation tokens. Two-tab
coordination invalidates UI; server checks and transactional heads decide access.

## 6. Rollout and remaining decisions

Implementation order:

1. Isolated envelope crypto/strict parser and tamper/size/nonce tests, no IO or
   existing-record migration. An injected test key is not broker implementation.
2. Disposable durable broker state machine/CAS/audit tests with a deliberately
   injected wrapping facility; fail when missing. No real key service allocation.
3. New encrypted IndexedDB repository and recovery tests on a dedicated origin,
   using only synthetic test records, never opening v1.
4. Individual staff runtime integration and two-tab browser acceptance:
   account/scope switch, logout/revoke, old-key residual, ABA, late success/error,
   save interruption, quota/full disk, corrupted row, replay and browser restart.
5. Only after key custody, policies and legacy-profile gate: activation in a
   separately protected pilot. Existing main runtime is not silently switched.

Before activation, an accountable owner must approve: retention durations and
withdrawal handling for each purpose; key service/location/cost; export/recovery
operator powers; backup/restore terminal-revocation procedure; incident response;
offline entitlement if any; bounded audio chunk/manifest limits; shared-device
and old-v1-profile treatment. No paid resource, legal approval, external access,
real-data egress or key material is created by this engineering decision.

Acceptance must include wrong staff/assignment/patient/run/kind/revision/key,
header/tag/nonce mutation, truncation, unknown format, replay of older valid rows,
two concurrent writers, consent/session revoke at every await, audit failure,
broker restart/restore and old pending-operation retry. Demonstrate actual
encryption, actual transaction rollback and actual browser behavior separately.

### Isolated implementation checkpoint 1C1e

`lib/local-materials/envelope.ts` now implements bounded **opaque payload**
encryption/decryption, with no IO or consumer wiring. Its envelope holds only
schema/profile, opaque key ID/version, IV and ciphertext. Scope/kind are supplied
independently and bound through AAD, not serialized as clear owner metadata.
The fixed opaque-bytes profile has a 1 MiB per-call engineering bound; it does
not implement the future segmented-audio manifest, clinical format validation,
broker, key allocation, storage or action permission. This bound does not change
current recording/upload limits or imply that a whole recording fits in it.

The primitive accepts an exact 32-byte raw key from its future trusted caller,
copies it before awaiting, imports AES-256-GCM internally as non-extractable and
clears its own temporary raw-key copy. An arbitrary external `CryptoKey` is not
accepted: its public algorithm metadata can be changed without changing the
native key's actual strength. The caller retains responsibility for its original
key bytes; clearing one copy is not key revocation or guaranteed memory erasure.
One sealer permits one attempt, including failed attempts. It cannot prove that
another instance/process did not reuse the same input key. That is a durable
broker allocation invariant, not a claim of this primitive.

Byte views are copied with native typed-array getters and intrinsic backing-buffer
checks, not overrideable `buffer`/`byteLength` properties. Shared buffers, detached
views, subclasses, proxies and oversized payloads fail closed. Real Web Crypto
roundtrip/tamper tests run in Node; browser crypto and persistence acceptance are
still separate gates. The newest MASTER_PLAN ledger records exact verification.

This ADR closes the engineering direction of 1C1d and the isolated 1C1e crypto
primitive, not ONLINE-1C. Metadata, crypto and lifecycle tests are not proof of
secure local history, deployed key custody or current browser authorization.

### Isolated storage checkpoint 1C2a1

The next step has been split: migration0050 and `D1LocalMaterialRegistry` now
implement durable internal reservations, opaque prepared-key references,
receipt/head CAS and immutable minimal storage events. Receipt publication,
head advancement and terminal commit are one guarded SQL operation. Replays
return the historical receipt and distinguish it from a current head. The
120-second reservation lifetime is an engineering preparation deadline, not
clinical retention or an offline entitlement. No main migration was applied.

This is deliberately **not the broker described in section5**. Required
policy/wrapping-provider configuration contains identifiers only; the storage
adapter does not invoke a wrapping facility or prove its opaque input is wrapped.
It does not release keys. The session reference and authority fingerprint do not
authorize an action, and the registry events are not a complete clinical access
audit. Full descriptor parsing is a caller/adapter invariant; SQL guards core
binding and stable stream identity, not arbitrary direct-SQL JSON input.

Next1C2a2 must provide the injected wrapping coordinator, current action/consent
checks inside committing SQL, preparation-failure reconciliation and terminal
revocation fences before mounting any consumer. Existing membership/org/facility
versions do not enforce monotonic changes for every direct update; equal observed
fingerprints after disable/re-enable cannot prove that a pending operation was
never revoked. No key release or protected browser storage may rely on that.

### Follow-on 1C2a2-fence, 2026-09-24

Additive migration0051 now terminally retires pending registry preparations when
their organization, facility or membership authority changes. Successful INSERT,
UPDATE, DELETE and same-key/unique-key REPLACE are covered, including
disable/re-enable with unchanged version; ignored/no-op mutations do not revoke
valid pending work. Existing preparing/prepared rows are retired on installation
because their earlier authority history cannot be proved. Committed receipts and
heads are preserved. Retirement and its event share the authority transaction;
failure to retire aborts it. This fence does not grant any operation or issue keys.

The exact test evidence is in MASTER_PLAN §13: 80 persistent repository SQL tests
and 59 independent adversarial scenarios. Main0048–0051 remain unapplied. These
three authority sources do not exhaust action/consent/session/assignment checks;
the coordinator must still authorize inside committing SQL. In particular do not
generalize this result to every mutable authority head or treat a fingerprint as
an access lease. No v1 bytes, clinical runtime identity or key facility changed.
