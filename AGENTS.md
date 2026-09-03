# ORION Clinic agent protocol

This repository is a clinical product, not a demo. Before changing code, every
human or AI contributor must read `docs/MASTER_PLAN.md` in full.

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
