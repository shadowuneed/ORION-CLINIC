# ORION

ORION is a doctor-facing assistant for an in-person consultation. It listens to
one shared microphone, transcribes Russian and Kazakh speech, separates speakers,
and prepares clinical options for the doctor to review. It never addresses or
interrupts the patient, and it never makes the final clinical decision.

## Current vertical slice

- consent gate before microphone access;
- live RU/KZ transcription contract with speaker diarization;
- temporary, single-use Soniox credentials minted by the backend;
- no raw-audio object storage or audio-retention table;
- manual doctor/patient speaker-role correction;
- review-first workflow before protocol generation;
- D1 schema for encounters, consent, transcript segments, suggestions, clinician
  reviews, protocol versions, and audit events.

The current D1 database is suitable only for product development. Real patient
data must not be used until Kazakhstan hosting, access control, contracts,
retention rules, and a legal review are complete.

## Local development

1. Copy `.env.example` to `.env.local`.
2. Set the Soniox project region (`us`, `eu`, or `jp`) and the server-only API
   key. Never expose the long-lived key to client code.
3. Run `pnpm dev` with the bundled workspace runtime.

The browser receives only a 60-second, single-use key capped to a two-hour
transcription session. ORION sends encoded microphone chunks directly to the
regional Soniox WebSocket and does not create an audio file.

## Source layout

- `app/orion-workspace.tsx` — doctor workspace and consultation state machine.
- `lib/soniox-client.ts` — microphone, WebSocket, token buffering, and cleanup.
- `app/api/realtime/credentials/route.ts` — protected temporary-key minting.
- `db/schema.ts` — reviewable clinical data and audit model.
- `drizzle/` — generated SQL migrations.

See `docs/architecture.md` for the product and safety decisions.
