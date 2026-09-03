# ORION Clinic — clinic discovery and review pack

- Version: `0.1-draft`
- Prepared: 2026-08-31
- Input catalogue: `docs/requirements/clinic-leadership-catalogue.md`
- State: `READY_FOR_WORKSHOP`, not clinic-approved

This pack turns the open parts of the clinic-leadership catalogue into a
repeatable review process. It is designed so a product owner, clinical lead,
clinic operations, IT/vendor representative, legal/privacy lead and engineering
lead can make explicit decisions without relying on assumptions from chat.

## 1. Required workshop participants

| Participant | Required for | Decision authority expected |
|---|---|---|
| Clinic product owner | All sessions | Intended business flow, scope and priority |
| Clinical lead/committee representative | Clinical documentation, registry, observations, transfer | Human decision rights, safety rules, exceptions |
| Primary doctor and endocrinologist | Encounter, referral, longitudinal care | Real as-is steps and usable to-be workflow |
| Nurse/observation-area representative | Monitoring, measurements, escalation | Task ownership, measurement SOP, fallback |
| Registrar/clinic operations | Scheduling and queue | Arrival, slot, queue, exception and reconciliation rules |
| Clinic IT/KMIS owner/vendor | All integrations | Product/version, API, sandbox, source of truth and SLA |
| Legal/privacy lead | Consent, retention, messaging, transfer | Legal basis, minimum data, signature and retention |
| Engineering/security lead | Architecture and release gates | Feasibility, audit, authorization, idempotency and operations |

If a decision owner is absent, record the item as `PENDING_OWNER`; do not turn
the discussion outcome into an approved implementation requirement.

## 2. High-impact decision questionnaire

Answers must name the reviewer, date and supporting artifact. “Да/нет” without
the rule, owner and exception path is insufficient.

### 2.1 Clinical encounter and documents

| Question ID | Requirement/decision | Question to resolve | Required evidence |
|---|---|---|---|
| `Q-ENC-01` | `REQ-ENC-001` | Which of the eight sections are mandatory for each pilot specialty, and who may enter/review objective findings? | Approved specialty matrix |
| `Q-ENC-02` | `REQ-ENC-002`, DEC-011 | What is the exact meaning and legal status of “preliminary conclusion”; who authors, confirms, signs and may see it? | Approved document-state definition |
| `Q-ENC-03` | Phase 3 | Which corrections are allowed before and after signing, and must amendments be co-signed? | Document correction SOP |
| `Q-ENC-04` | DEC-010 | Retention for audio, transcript, AI drafts, rejected items, protocols and backup copies? | Retention/legal-basis matrix |
| `Q-ENC-05` | DEC-016 | Minimum RU/KK/mixed STT, speaker attribution, negation, medicine and unit metrics for shadow/pilot stop/go? | Approved evaluation protocol |

### 2.2 Tests, ECG and referrals

| Question ID | Requirement/decision | Question to resolve | Required evidence |
|---|---|---|---|
| `Q-ORD-01` | `REQ-ORD-001/002` | Which roles may create, approve, amend and cancel each referral/service request? | Role-to-command matrix |
| `Q-ORD-02` | DEC-001/002 | Exact KMIS product/version, owner, API documentation, sandbox, auth, scopes and read/write permission? | Integration passport |
| `Q-ORD-03` | DEC-005 | Does ECG mean request, PDF, image, structured result, waveform, official conclusion or some combination? | Format samples and clinical scope |
| `Q-ORD-04` | `REQ-ORD-003` | What external acknowledgement proves request/result success, and who owns unknown/failed reconciliation? | State mapping and SLA |
| `Q-ORD-05` | Billing/coverage | Are payment, insurance, benefit eligibility or pre-authorization part of referral flow? | To-be process and source of truth |

### 2.3 Scheduling and electronic queue

| Question ID | Requirement/decision | Question to resolve | Required evidence |
|---|---|---|---|
| `Q-SCH-01` | `REQ-SCH-001` | Which system is authoritative for provider, specialty, service, duration, branch and availability? | Data/source mapping |
| `Q-SCH-02` | `REQ-SCH-003` | Who confirms booking: doctor, patient, both, or policy-dependent; what counts as explicit confirmation? | Approval-state table |
| `Q-SCH-03` | Concurrency | Is there a hold/reservation API, what is its TTL, and how are double booking and stale slots handled? | Vendor contract and concurrency test |
| `Q-SCH-04` | `REQ-SCH-004` | What does “doctor enables booking reasonably” mean: template, schedule ownership, referral indication or service capacity? | Approved terminology/process |
| `Q-SCH-05` | `REQ-SCH-005` | Is electronic queue virtual, in-building or both; what are arrival, priority, late, walk-in and emergency rules? | As-is/to-be BPMN and queue policy |
| `Q-SCH-06` | Manual fallback | Who can override/book/cancel during outage, and how is KMIS reconciliation completed later? | Downtime SOP |

### 2.4 Registry, care plan and free medicines

| Question ID | Requirement/decision | Question to resolve | Required evidence |
|---|---|---|---|
| `Q-CHR-01` | `REQ-CHR-002/003` | Which clinician and criteria authorize diabetes/dispensary enrollment; is consent, commission or external confirmation required? | Clinical enrollment policy |
| `Q-CHR-02` | DEC-003 | Exact expansion/owner/API/source-of-truth/read-write scope of “ЭРДБ/ERDB”? | Named integration passport |
| `Q-CHR-03` | DEC-004 | Exact expansion and workflow meaning of “ПУЗ/PUZ”? | Named process/system artifact |
| `Q-CHR-04` | `REQ-CHR-004/005` | Required medication, diet, goal, interval and correction fields; who may change each? | Care-plan template and role matrix |
| `Q-CHR-05` | `REQ-CHR-006/007` | How are due/overdue windows calculated, who owns each task, and when is it escalated/closed? | Rule examples and SLA |
| `Q-CHR-06` | DEC-014 | Authoritative source and permitted actions for free-medicine/social eligibility, stock, prescription and dispensing? | Pharmacy/social integration passport |

### 2.5 Communications and nurse monitoring

| Question ID | Requirement/decision | Question to resolve | Required evidence |
|---|---|---|---|
| `Q-COM-01` | DEC-012 | Which official WhatsApp/Telegram/SMS/telephony business accounts and providers are approved? | Contracts/account owners |
| `Q-COM-02` | Consent | Channel opt-in/out, destination verification, preferred language and protected-link policy? | Approved notice/consent versions |
| `Q-COM-03` | Content | Who approves templates, what medical detail is allowed, what are quiet hours and retry limits? | Template catalogue and policy |
| `Q-COM-04` | Nurse workflow | Which patient responses create tasks/escalations and what may a nurse advise without a doctor? | Script, thresholds and role policy |
| `Q-COM-05` | DEC-015 | Owner and SLA for failed delivery, no response and urgent patient response? | Operational responsibility/SLA |

### 2.6 Observation and transfer

| Question ID | Requirement/decision | Question to resolve | Required evidence |
|---|---|---|---|
| `Q-OBS-01` | `REQ-OBS-002` | What exactly are “room 2” and the two observation areas; which branches, routes and staff use them? | Floor/process map and as-is BPMN |
| `Q-OBS-02` | `REQ-OBS-001/003` | Required measurements, units, repeat/correction rules, devices, calibration and operator roles? | Measurement SOP and device list |
| `Q-OBS-03` | DEC-006 | Versioned criteria, exceptions, acknowledgement and SLA for a “red/critical” patient? | Clinical committee policy |
| `Q-TRF-01` | DEC-013 | Pilot sending/receiving facilities, responsible departments and contacts? | Signed pilot roster |
| `Q-TRF-02` | `REQ-TRF-003/005` | Notification channel and exact acknowledgement semantics; what happens on reject/timeout? | Transfer state map and downtime SOP |
| `Q-TRF-03` | `REQ-TRF-004` | Minimum transfer dataset, signature, legal basis, access duration and revocation? | Approved packet schema/policy |
| `Q-TRF-04` | DEC-007 | Does “digital twin” mean read-only chronology, synchronized record, risk model or simulation? | Separate signed product definition |

### 2.7 Reference and pilot

| Question ID | Requirement/decision | Question to resolve | Required evidence |
|---|---|---|---|
| `Q-DIS-01` | `REQ-DIS-001` | Exact organization/link meant by “Айдын емхана”, permission to study it, and which process is considered a reference? | Named source and review scope |
| `Q-PILOT-01` | DEC-016 | Pilot branch, specialty, users, duration, synthetic/shadow/limited-patient stage and stop criteria? | Signed pilot charter |
| `Q-PILOT-02` | Responsibility | Who owns clinical safety, privacy, integration failure, patient communication, incidents and go/no-go? | Signed RACI |

## 3. BPMN workshop plan

Produce both `AS_IS` and `TO_BE` diagrams. Each task/event must name an actor,
system, input, output, time/SLA, exception and evidence record.

### Workshop A — first visit and documentation

- Start: patient identified and visit requested.
- Lanes: patient, registrar, observation staff, primary doctor, ORION, STT/AI,
  clinical record system.
- Required branches: identity mismatch; consent refused/withdrawn; no microphone;
  unknown speaker; STT/AI outage; incomplete required section; correction;
  signing/amendment.
- End: signed/reviewed record or explicitly documented incomplete/manual path.

### Workshop B — test/referral, appointment and queue

- Start: doctor identifies need.
- Lanes: doctor, patient, ORION, KMIS/schedule, registrar fallback,
  specialist/lab/ECG, notification provider.
- Required branches: referral rejected/edited; no slots; preference mismatch;
  concurrent slot loss; external timeout; cancellation/reschedule; no-show;
  arrival/queue exception; reconciliation.
- End: confirmed service/result path or owned failed/manual path.

### Workshop C — chronic care and communication

- Start: specialist confirms basis for enrollment.
- Lanes: specialist, patient, nurse, ORION, ERDB/PUZ, pharmacy/free-medicine
  source, notification provider.
- Required branches: candidate not enrolled; external mismatch; plan amendment;
  missed test/visit; patient opt-out; failed contact; concerning response;
  nurse-to-doctor escalation.
- End: active/closed/superseded care plan with reproducible task history.

### Workshop D — observation and critical transfer

- Start: patient arrives for pre-visit observation.
- Lanes: patient, observation staff, doctor, ORION/rule engine, sending facility,
  receiving facility, transport/manual call.
- Required branches: invalid/repeated measurement; alert override; emergency SOP
  without ORION; destination reject/timeout; incomplete packet; offline transfer;
  late reconciliation.
- End: acknowledged transfer/handback or documented exception with owner.

## 4. Draft responsibility matrix

`A` = accountable decision owner, `R` = executes, `C` = consulted, `I` = informed.
Every row remains `PROPOSED` until named people approve it.

| Activity | Patient | Doctor/specialist | Nurse/observation | Registrar/operations | Medical lead | Clinic IT/vendor | Legal/privacy | ORION/AI |
|---|---|---|---|---|---|---|---|---|
| Confirm clinical documentation/diagnosis/treatment | I | `A/R` | C | I | C | I | I | Draft only |
| Consent and communication preference | `A/R` for choice | C | R capture | R capture | I | I | C | Enforce only |
| Referral/order approval | C | `A/R` | I | R fallback | C | R adapter | I | Draft/rank only |
| Appointment confirmation | `A/R` proposed | C/A where clinical referral required | I | R fallback | I | R source | I | Rank only |
| Registry enrollment/care plan | I | `A/R` | R assigned tasks | I | C | R external sync | C | Draft only |
| Reminder template/policy | C | C | R exceptions | R operations | `A` | R delivery | C | Draft/localize only |
| Critical status/transfer | I | `A/R` | R measure/escalate | C | C | R transport/exchange | C | Alert/draft only |
| Production incident | I | C | C | R operations | I | `A/R` technical | C | No ownership |

Items requiring explicit clinic correction: appointment accountability, consent
capture role, external-registry owner, transfer command authority and incident
accountability.

## 5. Candidate pilot KPIs — definitions, not targets

The clinic must set baselines, targets, exclusions, sample size and stop rules.
Efficiency must never be accepted by hiding clinical error or manual work.

| KPI ID | Candidate measure | Definition draft | Safety/quality guardrail |
|---|---|---|---|
| `KPI-ENC-01` | Documentation completion time | Median from encounter end to doctor-reviewed protocol | Missing/unsupported/incorrect section rate does not worsen |
| `KPI-ENC-02` | Doctor edit burden | Proportion of AI draft retained, edited and fully replaced by section | High retention is not assumed to mean correctness |
| `KPI-STT-01` | RU/KK transcript quality | Word/entity/negation/medicine/unit and speaker-attribution error rates on approved corpus | Stop on defined critical-error threshold |
| `KPI-SCH-01` | Successful booking | Confirmed appointments / eligible booking attempts | Double-booking and false-success count equals zero |
| `KPI-SCH-02` | Manual registrar work | Median manual steps per completed appointment | Reconciliation backlog and patient complaints do not rise |
| `KPI-CHR-01` | Follow-up completion | Due tasks completed in approved window / due tasks | No silent exclusion from cohort; reason visible |
| `KPI-COM-01` | Effective reminder | Delivered/acknowledged reminders by consented channel | Opt-out violations and duplicate messages equal zero |
| `KPI-NUR-01` | Escalation timeliness | Time from qualifying response/overdue task to staff acknowledgement | Missed urgent escalation equals zero in pilot |
| `KPI-TRF-01` | Transfer acknowledgement | Time from doctor-approved transfer to receiving acknowledgement | System never displays complete before acknowledgement |
| `KPI-OPS-01` | Degraded/manual continuity | Percentage of outage scenarios completed through approved fallback | Confirmed clinical data loss equals zero |

## 6. Integration passport template

Create one passport per external system before adapter implementation:

```text
System/product/version:
Business and technical owner:
Purpose and approved workflow requirement IDs:
Source of truth by field/state:
Data classification and minimum dataset:
Legal basis/consent/retention/residency:
Documentation and sample payload version:
Sandbox and test accounts:
Authentication, scopes, network restrictions and key rotation:
Read/write operations and prohibited operations:
External identifiers and mapping:
Idempotency/deduplication contract:
Acknowledgement and terminal-state semantics:
Rate limits, timeout, retry and backoff:
Webhook/polling behavior:
Reconciliation and manual fallback:
SLA, support and incident owner:
Audit/logging requirements:
Contract/version-change process:
Security/privacy/clinical approvals:
```

## 7. Review record template

For every review session append a record; never overwrite earlier decisions.

```text
Review date/time/timezone:
Catalogue version/hash:
Participants and decision roles:
Requirement IDs reviewed:
Approved as written:
Approved with changes:
Rejected/deferred:
New requirements:
Open questions and named owner/due date:
Evidence links/attachments:
Clinical lead sign-off:
Product owner sign-off:
Legal/IT sign-off where required:
Next implementation slice explicitly authorized:
```
