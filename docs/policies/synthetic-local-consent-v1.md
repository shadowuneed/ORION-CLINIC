# ORION Clinic — synthetic local consent notice v1

Status: `SYNTHETIC_TEST_ONLY`, not reviewed or approved by a clinic, legal
team, privacy officer, or clinical committee.

This notice exists only to exercise versioning, withdrawal, authorization,
idempotency, and audit behavior with invented records in the local development
environment. It is not a patient-facing form, does not establish a legal basis,
and must never be used for a real person.

The synthetic subject may grant, deny, or later withdraw each purpose
independently:

- delivery and documentation of the synthetic encounter (`care`);
- transient local audio processing (`transient_audio_processing`);
- retention of a synthetic audio file (`audio_retention`);
- storage of synthetic transcript segments (`transcript_storage`);
- sending synthetic text to an external AI processor (`external_ai_processing`);
- exchange with a synthetic external system (`data_exchange`);
- synthetic reminders (`notifications`).

No purpose is implied by another. A current denial or withdrawal must stop the
corresponding future processing path. Historical audit events remain immutable.
Production work remains blocked until the clinic approves the exact RU/KK
notices, capture evidence, retention, legal basis, processor list, withdrawal
semantics, and responsible roles.
