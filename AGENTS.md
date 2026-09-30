# ORION Clinic agent protocol

This repository is a clinical product, not a demo. Before changing code, every
human or AI contributor must read `docs/MASTER_PLAN.md` in full.

Owner resource boundary (2026-09-24): work only in this ORION checkout and its
existing GitHub repository `https://github.com/shadowuneed/ORION-CLINIC.git`.
Do not create a replacement repository or change its remote. Never inspect,
modify, link, migrate or reuse ANY dir echoes resource, including GitHub code,
Vercel projects, Neon databases, secrets, configuration and integrations.
`dir-echoes-db` and `dir-echoes-voice-router` are explicitly out of scope.
This prohibition also applies to subagents and unattended scheduled work.

Required start-of-session sequence:

1. Read `docs/MASTER_PLAN.md`, especially **Current checkpoint**, **Open
   decisions**, and **Last handoff**.
2. Run `git status --short` and inspect existing changes. Never discard or
   overwrite unrelated work.
3. Choose one bounded task from the active phase. Do not skip a release gate.
4. Preserve the clinician-control rule: AI creates drafts; an authorized human
   approves every clinical or transactional action.
5. Use synthetic data only until the plan explicitly records approval for real
   patient data.
6. Add or update tests with domain behavior. A successful build alone does not
   prove clinical, microphone, document, authorization, or integration quality.
7. At the end, update **Verification ledger** and **Last handoff** in
   `docs/MASTER_PLAN.md` with exact commands and limitations.

Never commit secrets, real patient data, recordings, exports, certificates, or
local environment files. Never copy the legacy project wholesale. Reuse only a
reviewed component under an explicit migration task.
