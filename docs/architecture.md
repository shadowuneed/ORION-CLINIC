# ORION architecture decisions

## Product boundary

ORION is a silent assistant visible only to the clinician. It may surface
clarifying questions, safety signals, differential considerations,
investigation options, and treatment options. Every item starts in `pending`
state. A clinician must accept, edit, or reject it before it can contribute to a
protocol.

## Delivery shape

The first version is a responsive web application/PWA. That makes pilot rollout,
updates, and testing across clinic computers much simpler. The production design
keeps the web UI but can wrap it in a managed desktop shell with a local audio
agent if device policy, offline operation, or tighter microphone control requires
it. This avoids maintaining two user interfaces.

## Speech pipeline

```text
one room microphone
  -> browser capture (WebM/Opus when supported)
  -> regional Soniox realtime WebSocket
  -> final and provisional RU/KZ tokens
  -> speaker calibration and doctor correction
  -> verified transcript
  -> clinical analysis
  -> doctor review
  -> protocol
```

Soniox is used for the first bilingual proof because its public API documents the
combination ORION needs: `ru` and `kk` language hints, token-level language
identification, and realtime speaker diarization in one stream. The first text
frame configures the session before any binary audio frames are sent.

Final tokens are append-only. Provisional tokens are replaced on every response
and must never be persisted or used to create irreversible clinical output.

## Credential boundary

The long-lived Soniox key exists only in the server environment. The browser asks
ORION for a temporary key that is:

- restricted to `transcribe_websocket`;
- valid for opening a stream for 60 seconds;
- single-use;
- capped to a two-hour session;
- associated with a random ORION reference rather than patient identity.

## Data boundary

ORION does not create a raw audio object and has no R2/audio storage binding. The
data model stores only structured encounter state, final transcript segments,
the evidence links behind suggestions, clinician actions, protocol versions, and
audit events.

The current hosted-development database is not approved for real patient data.
Production persistence must be deployed in Kazakhstan and integrated with the
clinic identity/KMIS boundary. Using a foreign speech provider for real visits
requires explicit patient information, a legal basis, contracts, and a documented
cross-border-transfer decision.

## Role calibration

Speaker diarization returns anonymous labels, not medical roles. ORION asks the
doctor to speak first and maps the first detected label to `doctor`. The clinician
can swap the two roles at any time. A later version should store role corrections
as audit events and re-label affected transcript segments.

## Remaining production gates

1. Configure a non-production Soniox project and test only consented sample audio.
2. Benchmark RU/KZ medical terminology, code-switching, overlapping speech,
   latency, and speaker attribution.
3. Connect the clinical-analysis model through a server-only contract and add
   source-segment citations to every suggestion.
4. Implement the accept/edit/reject API and protocol generation exclusively from
   reviewed items.
5. Move patient-data persistence to an approved Kazakhstan environment, then add
   clinic SSO, roles, retention, export, monitoring, and incident controls.
