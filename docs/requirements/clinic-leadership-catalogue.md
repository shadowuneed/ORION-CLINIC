# ORION Clinic — clinic leadership requirements catalogue

- Catalogue version: `0.1-draft`
- Prepared: 2026-08-31
- Review state: `DRAFT_FOR_CLINIC_REVIEW`
- Product data state: synthetic only
- Required approvers: clinic product owner and clinical lead

This catalogue translates the two WhatsApp screenshots supplied by the product
owner into traceable product requirements. It is deliberately a draft: source
intent is recorded, but unclear terminology, external-system behavior, clinical
rules, and legal responsibilities are not invented.

The catalogue does not authorize real patient data, live integrations,
autonomous clinical actions, messaging, booking, registration, or transfer.

The focused review artifact for `DEC-006`/`DEC-007` is
[`phase-8b-clinic-decision-packet.ru.md`](phase-8b-clinic-decision-packet.ru.md).
Its companion JSON is an unapproved, activation-blocked template; it contains no
clinical thresholds and cannot activate runtime behavior.

## 1. Source registry

| Source ID | Artifact | Source content covered | Evidence state |
|---|---|---|---|
| `SRC-WA-001` | First clinic-leadership WhatsApp screenshot supplied in the ORION conversation | Eight clinical sections, laboratory/ECG, preliminary conclusion, endocrinology referral, free slots, automatic booking, electronic queue, patient notification, diabetes/registry/care-plan flow | Product-owner supplied; clinic wording requires confirmation |
| `SRC-WA-002` | Second clinic-leadership WhatsApp screenshot supplied in the ORION conversation | ERDB/PUZ, multi-month treatment, repeat tests/visits, reminders, patient cohorts, free medicines, nurse monitoring, pre-visit observations, critical transfer, longitudinal history and “digital twin” | Product-owner supplied; clinic wording requires confirmation |
| `POL-ORION-001` | `docs/MASTER_PLAN.md`, sections 2, 6–8 and 10–11 | Clinician control, versioning, evidence, audit, consent, authorization, idempotency, fallback and release gates | Accepted engineering/clinical safety boundary; not a clinic workflow sign-off |

Origin codes:

- `D`: direct paraphrase of the clinic-leadership source.
- `I`: interpretation needed to turn source wording into testable behavior.
- `S`: safety, privacy, reliability, or audit control derived from ORION policy.

Requirement states:

- `DRAFT`: testable wording exists but has not been approved by the clinic.
- `OPEN_TERM`: a term or workflow is not defined well enough to implement.
- `BLOCKED_EXTERNAL`: implementation needs a named external owner/system.
- `POLICY_REQUIRED`: required even when not explicitly written in the screenshot.

## 2. Actors

| Actor ID | Actor | Intended responsibility | Must not be assumed |
|---|---|---|---|
| `ACT-PATIENT` | Patient | Gives consent/preferences, receives approved care and reminders, attends visits | Ability to approve clinical content or silently opt into messaging |
| `ACT-DOCTOR-PRIMARY` | First-contact/primary doctor | Reviews encounter, confirms clinical content, requests tests/referral, initiates routing | Autonomous AI diagnosis, medication or referral |
| `ACT-SPECIALIST` | Endocrinologist or other specialist | Reviews authorized chronology, confirms specialist decisions and follow-up | Unrestricted access to every patient |
| `ACT-NURSE` | Nurse | Executes assigned monitoring tasks and records patient responses/observations | Changing diagnosis, prescription, registry or transfer decisions |
| `ACT-REGISTRAR` | Registrar | Demographics, manual scheduling/queue fallback and reconciliation | Access to full transcript, diagnosis or unrestricted clinical notes |
| `ACT-OBSERVATION` | Observation-area staff | Captures pre-visit measurements with provenance | Interpreting measurements as a final diagnosis |
| `ACT-MEDICAL-LEAD` | Medical lead | Approves policy, thresholds, templates and oversight rules | Routine access without purpose and audit |
| `ACT-RECEIVING` | Authorized receiving-facility clinician | Reviews minimum transfer packet and acknowledges receipt | Access before an approved transfer/legal basis |
| `ACT-INTEGRATION` | Narrow service identity | Exchanges approved deterministic commands/results with external systems | Interactive user behavior or broad clinical access |
| `ACT-AI` | Drafting/ranking assistant | Transcribes, structures, highlights, ranks real options, drafts summaries | Signing, diagnosing, prescribing, booking, registering or transferring independently |

### 2.1 Product-owner context constraints

These constraints come from the ORION product-owner conversation, not from the
clinic-leadership screenshots. They govern implementation until explicitly
changed through the product/clinical review process.

| Context ID | Confirmed product constraint |
|---|---|
| `CTX-001` | Suggestions are visible to the doctor only; the assistant does not interrupt the consultation. |
| `CTX-002` | The doctor makes the final clinical decision. AI content remains a proposal until accepted or edited. |
| `CTX-003` | The doctor reviews/adds required material before protocol creation; rejected suggestions remain in a basket/audit and do not disappear. |
| `CTX-004` | One-room/one-microphone capture must distinguish doctor, patient and unresolved speaker; RU, KK and mixed speech are required. |
| `CTX-005` | Encounter history should retain transcript, permitted audio and final protocol, with an all-files package when policy allows. |
| `CTX-006` | Encounters need a human-readable patient/visit title in history. |
| `CTX-007` | Word/DOCX export must include the reviewed protocol and full labelled conversation text. |
| `CTX-008` | This is a real client product developed locally first and prepared for a later server; simulated integrations must never be presented as live. |

## 3. Functional requirements

### 3.1 Encounter documentation and chronology

| ID | Origin/state | Requirement and result | Actors | Mandatory decision boundary | Draft acceptance criterion | Dependency |
|---|---|---|---|---|---|---|
| `REQ-ENC-001` | `D / DRAFT` | Every encounter provides eight structured sections: complaints; history of present illness; past medical/life history; allergy status; objective findings; preliminary diagnosis; examination plan; treatment/correction plan. | Primary doctor, specialist | AI may draft; doctor reviews each required section or explicitly marks it absent. | A protocol cannot be signed while a required section is neither reviewed nor explicitly absent; saved versions and original AI text remain auditable. | Phase 3 |
| `REQ-ENC-002` | `D+I / DRAFT` | The workflow can produce a preliminary conclusion before downstream referral/testing. | Primary doctor | “Preliminary” must remain visibly non-final until the authorized doctor confirms it. | The conclusion shows author, time, evidence and state; AI output cannot appear as a signed conclusion. | DEC-011 terminology/legal status |
| `REQ-ENC-003` | `D / DRAFT` | Laboratory tests and ECG can be included in the examination plan and later linked to results. | Primary doctor, specialist | A doctor creates/approves the request; AI only proposes it. | An approved request has indication, requester, patient/encounter, status and audit trail; an unapproved suggestion creates no external request. | Phase 4, DEC-005 |
| `REQ-ENC-004` | `D+I / DRAFT` | Authorized clinicians see a chronological patient history across encounters, results, referrals, plans and follow-up. | Primary doctor, specialist, nurse within scope | Access depends on facility, treatment relationship and purpose; chronology is not a global unrestricted feed. | Each item links to its source record/version and access is audited; unauthorized roles cannot infer record existence. | Phase 2 authorization |
| `REQ-ENC-005` | `S / POLICY_REQUIRED` | AI suggestions retain provider/model/policy/input/evidence metadata and explicit accepted, edited, rejected or expired review state. | Doctor, medical lead | Only accepted or doctor-edited content may enter a protocol or deterministic command. | Rejecting an item keeps the immutable original in audit and excludes it from the signed protocol. | Existing foundation, expand in Phase 3 |

### 3.2 Tests, referrals and services

| ID | Origin/state | Requirement and result | Actors | Mandatory decision boundary | Draft acceptance criterion | Dependency |
|---|---|---|---|---|---|---|
| `REQ-ORD-001` | `D / DRAFT` | A doctor can refer a patient to an endocrinologist or another specialist after the first visit. | Primary doctor, patient, specialist | The doctor confirms clinical justification; patient scheduling preference is captured separately. | One approved referral produces one idempotent referral record with requested specialty, reason and status. | Phase 4 |
| `REQ-ORD-002` | `D+I / DRAFT` | After approval, specialist, laboratory, ECG or service routing should proceed without requiring a registrar to re-enter the same request. | Doctor, registrar fallback, integration service | “Without registrar” means workflow automation after authorization, not bypassing required consent or source-system controls. | Replayed commands do not duplicate a request; unavailable integration creates a visible manual-reconciliation task. | DEC-001/002/005 |
| `REQ-ORD-003` | `S / POLICY_REQUIRED` | Requests have requested, transmitted, acknowledged, completed, cancelled, failed and reconciled states with provenance. | Doctor, integration service, registrar fallback | AI never directly changes an external request state. | A request cannot appear completed until a trusted result/acknowledgement is linked; failures have an owner and retry/manual path. | Phase 4 |
| `REQ-ORD-004` | `I / OPEN_TERM` | Define which “analysis” types are ordered, where results originate, and whether ECG means report/image/structured data/raw waveform. | Clinical lead, clinic IT, ECG/lab vendor | Raw waveform interpretation is separate validated clinical scope. | No adapter/schema mapping is approved until source format, owner and reconciliation behavior are documented. | DEC-001/002/005 |

### 3.3 Availability, appointment and electronic queue

| ID | Origin/state | Requirement and result | Actors | Mandatory decision boundary | Draft acceptance criterion | Dependency |
|---|---|---|---|---|---|---|
| `REQ-SCH-001` | `D / DRAFT` | The system shows real free appointment windows by doctor/specialty/date/time. | Patient, primary doctor, registrar | Availability comes from an authoritative schedule; AI must not invent slots. | Every shown slot has provider/source identifier, start/end, service and freshness timestamp. | DEC-001/002 |
| `REQ-SCH-002` | `D+S / DRAFT` | AI may rank returned free slots using patient time/date/provider preferences. | Patient, doctor, AI | Ranking cannot create or hide source availability and must explain applied preferences. | Given the same slots/preferences, the ranked response references only supplied slot IDs and preserves an option to view all. | Phase 5 |
| `REQ-SCH-003` | `D+I / DRAFT` | An approved referral can proceed to appointment confirmation without duplicate registrar data entry. | Doctor, patient, integration service | Required confirmation owner is unresolved: doctor, patient, or both; booking is never an AI-only action. | A booking requires a valid referral/purpose, explicit confirmation record and idempotency key. | Clinic confirmation, DEC-001/002 |
| `REQ-SCH-004` | `D+I / OPEN_TERM` | Each specialist/doctor exposes appointment capacity in a clinically and operationally justified way while considering patient preferences. | Specialist, scheduler/admin, patient | “Обоснованно включал запись” needs an exact owner and rule definition. | No implementation until slot publication, overbooking, duration and exception policies are approved. | Discovery workshop |
| `REQ-SCH-005` | `D / DRAFT` | ORION supports an electronic queue linked to appointment/arrival/service state. | Patient, registrar, clinician | Queue order and priority rules are deterministic clinic policy, not AI judgment. | A ticket has issued, arrived, called, in-service, completed, cancelled and exception states; transitions are auditable. | Phase 5, KMIS scope |
| `REQ-SCH-006` | `D / DRAFT` | Patients receive appointment/queue notifications. | Patient, registrar, notification service | Message requires valid channel consent, approved template and minimum necessary data. | Delivery, failure, retry and patient response are recorded; opt-out blocks future non-mandatory messages. | Phase 7, DEC-012 |
| `REQ-SCH-007` | `S / POLICY_REQUIRED` | Cancellation, rescheduling, waitlist, no-show, source outage and reconciliation have explicit manual fallbacks. | Patient, registrar, integration service | No silent local/source-system divergence. | A failed external update remains pending/failed with owner; reconciliation can prove final source state. | Phase 5 |

### 3.4 Endocrinology, registry and longitudinal care

| ID | Origin/state | Requirement and result | Actors | Mandatory decision boundary | Draft acceptance criterion | Dependency |
|---|---|---|---|---|---|---|
| `REQ-CHR-001` | `D / DRAFT` | The endocrinologist sees the authorized chronology relevant to the consultation. | Specialist | Treatment relationship and purpose limit data; access is audited. | The consultation view shows sourced encounter/referral/result/plan versions and excludes unauthorized facilities/patients. | Phase 2/6 |
| `REQ-CHR-002` | `D+S / DRAFT` | The endocrinologist, not AI, confirms the diagnosis and whether chronic/dispensary enrollment is appropriate. | Specialist | AI may summarize evidence or flag missing facts but cannot establish diabetes or enrollment. | Enrollment is impossible without an authorized doctor decision referencing the diagnosis basis. | Phase 6 |
| `REQ-CHR-003` | `D / DRAFT` | A doctor-confirmed patient can be placed on the appropriate registry/dispensary follow-up workflow. | Specialist, integration service | Registry destination and legal workflow must be confirmed; external write requires deterministic approved command. | Local/external enrollment records show requested, confirmed, failed and reconciled states without duplicates. | DEC-003/004 |
| `REQ-CHR-004` | `D / DRAFT` | A signed care plan can include medication plan, diet plan, goals and follow-up actions. | Specialist, patient, nurse | Only a doctor can start/stop/dose medication and sign the plan. | Every plan item records author, effective dates, instructions, version and supersession; edits create a new version. | Phase 6, DEC-011 |
| `REQ-CHR-005` | `D / DRAFT` | Treatment can span several months with planned follow-up visits and repeat examination after a defined interval. | Specialist, patient | Interval derives from the signed plan, not an AI guess. | Due dates are reproducible from plan rules and remain linked to the version that created them. | Phase 6 |
| `REQ-CHR-006` | `D / DRAFT` | Follow-up laboratory/diagnostic tasks can be scheduled, including a source example of “after one month”. | Doctor, nurse, patient | The one-month interval is an example until confirmed per care protocol. | A task cannot be generated without a signed plan item; completion links the result and overdue status is deterministic. | Phase 4/6 |
| `REQ-CHR-007` | `D / DRAFT` | Staff can see a reproducible cohort of patients due or overdue for examination/follow-up. | Nurse, specialist, medical lead | Cohort inclusion reason is visible; AI may summarize but not arbitrarily add/remove patients. | Each row shows rule/plan source, due date, status, owner and next action; filters do not change authoritative state. | Phase 6 |
| `REQ-CHR-008` | `D+I / OPEN_TERM` | The client expects “ЭРДБ/ERDB” participation in registry or follow-up. | Clinic IT, health authority, integration service | Exact system name, owner, legal basis, API, read/write scope and source of truth are unknown. | No live adapter or table semantics are approved until an integration passport resolves DEC-003. | DEC-003 |
| `REQ-CHR-009` | `D+I / OPEN_TERM` | The client expects “ПУЗ/PUZ” participation, apparently around follow-up analysis/tasking. | Clinic IT, clinical lead | Meaning, workflow and data contract are unknown. | No implementation until the clinic supplies exact expansion, screenshots/process and system owner. | DEC-004 |
| `REQ-CHR-010` | `D+I / BLOCKED_EXTERNAL` | Chronic-care workflow should account for eligibility/dispensing of free medicines and social registration/category. | Doctor, nurse, pharmacy/social service | Source of truth and write authority are unresolved; ORION must not infer eligibility. | Displayed eligibility/dispensing state names its authoritative source and freshness; changes require approved external workflow. | DEC-014 |

### 3.5 Reminders, calls and nurse worklists

| ID | Origin/state | Requirement and result | Actors | Mandatory decision boundary | Draft acceptance criterion | Dependency |
|---|---|---|---|---|---|---|
| `REQ-COM-001` | `D / DRAFT` | Patients may receive automated calls or WhatsApp/Telegram reminders. | Patient, notification service, nurse fallback | Channel business account, consent, language, quiet hours and content template must be approved first. | No message/call is attempted without channel permission and signed appointment/care-plan trigger. | Phase 7, DEC-012 |
| `REQ-COM-002` | `D / DRAFT` | Reminders cover appointments, treatment actions and follow-up plans so staff/patients do not forget. | Patient, nurse, doctor | Reminder repeats approved facts; AI cannot add clinical advice. | Message content resolves to an approved template and source record/version; delivery outcome is auditable. | Phase 7 |
| `REQ-COM-003` | `S / POLICY_REQUIRED` | Communication stores opt-in/out, preferred RU/KK language, destination verification and minimum necessary content. | Patient, registrar/nurse | Clinical detail is not placed in an insecure message when a protected link is required. | Opt-out immediately blocks applicable future sends; every send records purpose, template version and destination token/identifier safely. | Consent/retention decisions |
| `REQ-COM-004` | `S / POLICY_REQUIRED` | Delivery failure, retry, patient reply and staff escalation have explicit states and owners. | Nurse, notification service | Repeated failure cannot silently close a care task. | Exhausted retry creates a visible manual-contact task and does not duplicate successful delivery. | Phase 7 |
| `REQ-NUR-001` | `D / DRAFT` | Nurses receive worklists for assigned patients needing consultation, wellbeing check or follow-up. | Nurse, specialist | Tasks derive from signed plan/rule and scoped assignment; nurses do not make doctor-only decisions. | Worklist shows reason, due time, patient preference, attempt history and escalation owner. | Phase 6 |
| `REQ-NUR-002` | `D+S / DRAFT` | Nurses record structured patient-reported wellbeing and escalate concerning responses. | Nurse, patient, doctor | Escalation thresholds and response SLA are clinic-approved; no autonomous diagnosis. | Response is timestamped/sourced; threshold breach creates an acknowledged escalation without altering diagnosis/medication. | Phase 6/8, DEC-006/015 |

### 3.6 Pre-visit observation area

| ID | Origin/state | Requirement and result | Actors | Mandatory decision boundary | Draft acceptance criterion | Dependency |
|---|---|---|---|---|---|---|
| `REQ-OBS-001` | `D / DRAFT` | Before the doctor visit, the observation area captures BMI/body-mass index, weight and blood pressure. | Observation staff, patient, doctor | Staff capture observations; interpretation remains clinician responsibility. | Each measurement records value, unit, time, operator, encounter and correction history; BMI inputs/calculation are traceable. | Phase 8 |
| `REQ-OBS-002` | `D+I / OPEN_TERM` | The source mentions “room/number 2 before the doctor” and two observation areas. | Registrar, observation staff | Physical routing, numbering, capacity and branch scope need confirmation. | No routing UI is finalized until clinic supplies current as-is path and desired two-area rules. | BPMN workshop |
| `REQ-OBS-003` | `S / POLICY_REQUIRED` | Device/manual source, calibration/provenance and invalid/corrected readings are retained. | Observation staff, system operator | A corrected measurement creates a new version or correction record. | Doctor can distinguish manual/device/imported value and see correction/audit history. | Device/interface decision |
| `REQ-OBS-004` | `S / POLICY_REQUIRED` | Abnormal observations create a visible, clinic-approved escalation rather than an AI-only “red” status. | Observation staff, doctor | Thresholds, repeat-measurement rule, acknowledgement and SLA are approved by clinical committee. | A threshold event requires human acknowledgement and records repeat/override/reason. | DEC-006/015 |

### 3.7 Critical patient transfer and “digital twin”

| ID | Origin/state | Requirement and result | Actors | Mandatory decision boundary | Draft acceptance criterion | Dependency |
|---|---|---|---|---|---|---|
| `REQ-TRF-001` | `D+S / DRAFT` | ORION can identify a patient who meets clinic-approved “red/critical” rules and surface an urgent alert. | Observation staff, doctor, medical lead | Rules are deterministic/versioned; AI cannot independently assign final critical status. | Alert shows triggering values/rule/version and remains pending until an authorized clinician acknowledges it. | DEC-006 |
| `REQ-TRF-002` | `S / POLICY_REQUIRED` | A doctor confirms critical status, destination and transfer decision. | Doctor, patient/representative as applicable | No notification packet or transfer state is finalized from AI alone. | Confirm action records actor, reason, destination, time and source observations; reject/override is auditable. | Phase 8, legal workflow |
| `REQ-TRF-003` | `D / DRAFT` | After approved transfer initiation, the receiving hospital is notified automatically with manual-call fallback. | Doctor, integration service, receiving clinician | Destination/endpoint and permitted data are preconfigured; failures have owner and SLA. | Notification has requested, delivered, acknowledged, failed and reconciled states; retry is idempotent. | DEC-013/015 |
| `REQ-TRF-004` | `D+S / DRAFT` | The receiving clinician can receive the authorized chronology/minimum transfer packet for the critical patient. | Sending doctor, receiving clinician | Packet contains only approved signed records and minimum necessary data. | Every item has source/version/hash; access and download are audited; rejected/expired transfer access is denied. | DEC-007/010/011/013 |
| `REQ-TRF-005` | `S / POLICY_REQUIRED` | Transfer is not complete until the receiving organization explicitly acknowledges the patient/packet. | Receiving clinician, integration service | Delivery is not equivalent to clinical acceptance. | Timeout/rejection creates escalation and manual path; acknowledgement records actor/system/time. | Phase 8 |
| `REQ-TRF-006` | `D+S / DRAFT` | ORION may recommend special supervision for a transferred critical patient. | Sending/receiving doctor, AI | Recommendation is a draft with evidence; receiving clinician confirms/edits/rejects it. | Unreviewed supervision text is visibly draft and cannot become an order/care plan. | Clinical policy |
| `REQ-TRF-007` | `D+I / OPEN_TERM` | The source calls the longitudinal transfer view a “digital twin”. Until separately specified, ORION defines it only as a read-only sourced longitudinal summary. | Authorized clinicians | No predictive simulation, autonomous risk scoring or treatment control is implied. | Every displayed fact links to a trusted record and timestamp; inferred text is labelled and reviewable. | DEC-007 |

### 3.8 Discovery-only source request

| ID | Origin/state | Requirement and result | Actors | Mandatory boundary | Draft acceptance criterion | Dependency |
|---|---|---|---|---|---|---|
| `REQ-DIS-001` | `D+I / OPEN_TERM` | The source asks to study the “Айдын емхана” clinic/concept as a possible process reference. | Product owner, clinic operations | This is a discovery task, not permission to copy a product, data or workflow. Exact organization/link and allowed study scope must be supplied. | A review note identifies the exact reference, observable as-is process, transferable principles, differences and source permissions; no implementation claim is made before that. | Clinic supplies exact reference |

## 4. Cross-cutting requirements

| ID | Origin/state | Requirement | Draft acceptance criterion |
|---|---|---|---|
| `REQ-NFR-001` | `S / POLICY_REQUIRED` | Server-side authorization combines organization, facility, role, treatment relationship, resource state and purpose for every read/write/export/download. | Allow and deny tests prove cross-tenant requests reveal neither existence nor content. |
| `REQ-NFR-002` | `S / POLICY_REQUIRED` | Clinical and transactional changes store actor, time, version, provenance, correlation and immutable audit. | Direct mutation that bypasses the approved command/audit path is rejected by service and database invariants. |
| `REQ-NFR-003` | `S / POLICY_REQUIRED` | Consent decisions are separate for STT processing, recording, transcript, AI egress, integrations and each communication channel. | A missing/withdrawn consent blocks the corresponding action without deleting records that policy requires to retain. |
| `REQ-NFR-004` | `S / POLICY_REQUIRED` | External commands use idempotency, retries, acknowledgement, reconciliation, failure owner and manual fallback. | Replaying the same key cannot create duplicate booking/order/message/enrollment/transfer. |
| `REQ-NFR-005` | `D+S / DRAFT` | Patient/clinician surfaces and approved communications support Russian and Kazakh, including mixed-language clinical text where required. | Language choice does not alter source facts; untranslated/low-confidence content remains visibly unresolved. |
| `REQ-NFR-006` | `S / POLICY_REQUIRED` | Development remains synthetic-only until legal, security, clinical and operational gates approve real data. | Runtime fails closed when synthetic-only policy is violated; CI rejects secrets and clinical artifacts outside reviewed fixtures. |
| `REQ-NFR-007` | `S / POLICY_REQUIRED` | Availability of AI/STT/integrations must not destroy confirmed clinical work. | Provider failure preserves saved versions, exposes degraded/manual continuation and records a bounded technical error without PHI logs. |
| `REQ-NFR-008` | `S / POLICY_REQUIRED` | Accessibility, readable typography, stable status labels and non-color-only role/state cues are release requirements. | Keyboard, focus, contrast, screen-reader names and minimum readable recommendation text pass agreed checks. |

## 5. Workflow acceptance scenarios

These scenarios are drafts for clinic validation and later automated tests.

### `SCN-01` — first visit to reviewed protocol

1. Authorized doctor opens the correct synthetic patient/encounter.
2. Required consent is recorded.
3. Eight sections receive sourced drafts or manual text.
4. Doctor reviews, replaces or marks each required section explicitly absent.
5. Rejected AI content remains in audit and outside the protocol.
6. Only reviewed sections form a versioned protocol draft; signing is a separate
   authorized action.

### `SCN-02` — referral and real appointment

1. Doctor confirms a clinically justified referral.
2. ORION receives real slots from the authoritative schedule source.
3. AI may rank those exact slot IDs against captured patient preferences.
4. Required human confirmation creates one idempotent booking request.
5. Source acknowledgement determines confirmed state; failure creates manual
   reconciliation and never fabricates success.

### `SCN-03` — chronic-care enrollment and follow-up

1. Specialist reviews the authorized chronology and confirms diagnosis basis.
2. Specialist explicitly confirms registry enrollment and signs a versioned
   medication/diet/follow-up plan.
3. Deterministic tasks and due dates derive from the signed plan.
4. Nurse cohort/worklist shows why each patient is due/overdue.
5. External registry/free-medication states remain pending until their source
   systems acknowledge them.

### `SCN-04` — reminders with failed delivery

1. Signed appointment/plan creates a reminder intent.
2. Channel consent, preferred language, quiet hours and template are validated.
3. Delivery failure follows bounded retry.
4. Exhaustion creates a nurse/manual-contact task; it does not mark the patient
   contacted and does not duplicate a later successful message.

### `SCN-05` — pre-visit observation and critical transfer

1. Observation staff records sourced, unit-safe measurements.
2. A versioned clinic rule raises an alert; doctor acknowledges/repeats/overrides.
3. Doctor confirms critical status, destination and transfer.
4. ORION sends a minimum signed packet and notification with idempotency.
5. Transfer remains pending until receiving-facility acknowledgement.
6. The “digital twin” view is a read-only sourced chronology; draft supervision
   suggestions require receiving-clinician review.

## 6. Scope sequence proposed for review

| Sequence | Product slice | Why this order | Entry condition |
|---|---|---|---|
| 1 | Identity, tenant membership, patient directory and consent | Every later read/write needs correct patient, actor and purpose | Phase 2 authorization design; still synthetic |
| 2 | Complete encounter, RU/KK transcript review and signed documents | Establishes the authoritative clinical record and clinician-control loop | Consent/retention decisions and reviewed STT adapter |
| 3 | Tests/referrals and result linkage | Adds deterministic doctor-approved commands without booking complexity | Integration passport or sandbox contract |
| 4 | Real scheduling and electronic queue | Requires authoritative availability and concurrency/reconciliation | KMIS owner/API/sandbox confirmed |
| 5 | Registry, care plans, cohorts, nurse worklists | Depends on signed diagnosis/plan and patient identity | ERDB/PUZ terminology resolved where applicable |
| 6 | Patient communication | Depends on signed triggers, consent and business channels | Approved channel accounts/templates |
| 7 | Observation, red-patient escalation and transfer | Highest clinical/operational risk | Approved criteria, hospitals, SLA and legal transfer packet |

This sequence is a proposal, not clinic approval. Safe local foundation work may
continue, but live integrations and real-data workflows remain blocked by their
named decisions.

## 7. Approval record

| Review item | Owner | State | Required evidence |
|---|---|---|---|
| Source wording and workflow intent | Clinic product owner | `PENDING` | Reviewed requirement IDs and corrections |
| Clinical decisions and safety boundaries | Clinical lead/committee | `PENDING` | Approved human decision points, criteria and exceptions |
| As-is/to-be operational process | Clinic operations | `PENDING` | BPMN/workshop notes, branches, roles and manual fallbacks |
| External systems and data contracts | Clinic IT/vendors | `PENDING` | Integration passports, sandbox, auth, source-of-truth and SLA |
| Consent, retention, signature and transfer legality | Legal/privacy lead | `PENDING` | Approved policy matrices and document status |
| Pilot KPIs and go/no-go thresholds | Product + clinical lead | `PENDING` | Signed KPI definitions, measurement method and stop criteria |

No row in this table may be changed to `APPROVED` without a named reviewer,
date, version and linked review evidence.
