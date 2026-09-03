# Legacy live consultation migration

Date: 2026-09-02
Source checkout: `C:\Users\profm\OneDrive\Документы\ChatGPT\ariaproject`
Destination: `C:\Users\profm\OneDrive\Документы\ChatGPT\ORION-CLINIC`

## Purpose

The working face-to-face consultation experience from the preserved ORION
prototype is available inside ORION Clinic at `/live`. The old checkout remains
unchanged and is not started as a second web application.

## Reviewed source-to-destination map

| Capability | Legacy source | ORION Clinic destination |
| --- | --- | --- |
| Live visit UI | `app/orion-workspace.tsx` | `app/orion-workspace.tsx`, route `app/live/page.tsx` |
| History and rename | `app/encounter-history-panel.tsx` | `app/encounter-history-panel.tsx` |
| VAD/STT browser capture | `lib/local-speech-client.ts` | `lib/live-local-speech-client.ts` |
| AudioWorklet | `public/orion-pcm-processor.js` | `public/orion-live-pcm-processor.js` |
| Local STT proxy | `app/api/local-speech/*` | `app/api/local-speech/*` |
| Groq drafts/research | `app/api/clinical/*`, `lib/clinical-*` | same compatibility API paths and contracts |
| Browser history and export | `lib/encounter-history.ts`, `lib/encounter-export.ts` | same compatibility modules |
| GigaAM/CAMPPlus service | `local-ai/*` | already adapted under `services/local-speech/*` |

The source is internal project code; no third-party UI template or copied
patient data was introduced by this migration. Dependencies remain those
declared in the ORION Clinic repository and in `services/local-speech`.

## Runtime

`START_ORION.bat` starts one ORION Clinic web process on `127.0.0.1:3200` and
one loopback-only speech process on `127.0.0.1:3101`. Use:

- `http://localhost:3200/` for the main server-backed ORION Clinic dashboard;
- `http://localhost:3200/live` for the additional migrated working consultation
  module.

Both screens use the same local speech process. A fresh ignored `GROQ_API_KEY`
is still required for real Groq output; no disclosed legacy secret was copied.

## Verified acceptance evidence

- TypeScript typecheck and ESLint pass.
- Vinext production build includes `/live`, `/api/local-speech/*`, and
  `/api/clinical/*`.
- All 20 test files / 97 tests pass.
- `/live` returns HTTP 200 from the clean restarted launcher.
- Browser check found the visit-start control, history panel, clinic return
  link, consent gate, and dark-theme switch with no console errors on `/live`.
- The compatibility STT health API returned the ready local GigaAM/CAMPPlus
  state from port 3101.

## Deliberate compatibility boundaries

The `/live` module preserves the old browser-local encounter history, optional
recording, automatic live Groq cadence, and export behavior because those are
the functions the owner requested to carry over. They are not the authoritative
medical record and must not be described as production persistence.

The server-backed `/` workspace remains the target architecture for tenant
authorization, D1/R2 persistence, immutable transcript and suggestion versions,
signed DOCX/PDF packages, and access audit. Before a real pilot, each
compatibility behavior must move behind those server repositories and approved
consent/retention policies. Use synthetic data only in the meantime.
