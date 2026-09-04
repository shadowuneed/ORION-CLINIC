CREATE TRIGGER `service_requests_patient_matches_encounter`
BEFORE INSERT ON `service_requests`
WHEN NOT EXISTS (
  SELECT 1
  FROM `encounters` encounter
  WHERE encounter.`organization_id` = NEW.`organization_id`
    AND encounter.`facility_id` = NEW.`facility_id`
    AND encounter.`id` = NEW.`encounter_id`
    AND encounter.`patient_id` = NEW.`patient_id`
)
BEGIN
  SELECT RAISE(ABORT, 'service request patient must match the exact scoped encounter');
END;--> statement-breakpoint
CREATE TRIGGER `service_request_versions_require_active_care_context`
BEFORE INSERT ON `service_request_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `service_requests` request
  JOIN `encounters` encounter
    ON encounter.`organization_id` = request.`organization_id`
    AND encounter.`facility_id` = request.`facility_id`
    AND encounter.`id` = request.`encounter_id`
    AND encounter.`patient_id` = request.`patient_id`
  JOIN `patients` patient
    ON patient.`organization_id` = request.`organization_id`
    AND patient.`facility_id` = request.`facility_id`
    AND patient.`id` = request.`patient_id`
  LEFT JOIN `patient_profile_heads` profile_head
    ON profile_head.`organization_id` = patient.`organization_id`
    AND profile_head.`facility_id` = patient.`facility_id`
    AND profile_head.`patient_id` = patient.`id`
  LEFT JOIN `patient_profile_versions` profile
    ON profile.`organization_id` = profile_head.`organization_id`
    AND profile.`facility_id` = profile_head.`facility_id`
    AND profile.`patient_id` = profile_head.`patient_id`
    AND profile.`id` = profile_head.`current_version_id`
  JOIN `consent_heads` consent_head
    ON consent_head.`organization_id` = request.`organization_id`
    AND consent_head.`facility_id` = request.`facility_id`
    AND consent_head.`patient_id` = request.`patient_id`
    AND consent_head.`encounter_id` = request.`encounter_id`
    AND consent_head.`consent_type` = 'care'
  JOIN `consent_events` consent_event
    ON consent_event.`organization_id` = consent_head.`organization_id`
    AND consent_event.`facility_id` = consent_head.`facility_id`
    AND consent_event.`patient_id` = consent_head.`patient_id`
    AND consent_event.`encounter_id` = consent_head.`encounter_id`
    AND consent_event.`consent_type` = consent_head.`consent_type`
    AND consent_event.`id` = consent_head.`current_consent_event_id`
  WHERE request.`organization_id` = NEW.`organization_id`
    AND request.`facility_id` = NEW.`facility_id`
    AND request.`id` = NEW.`service_request_id`
    AND encounter.`status` <> 'cancelled'
    AND patient.`status` = 'active'
    AND coalesce(profile.`status`, patient.`status`) = 'active'
    AND consent_event.`decision` = 'granted'
    AND consent_event.`effective_at` <= NEW.`created_at`
    AND (
      consent_event.`expires_at` IS NULL
      OR consent_event.`expires_at` > NEW.`created_at`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'service request version requires an active encounter, patient, profile, and effective care consent');
END;--> statement-breakpoint
CREATE TRIGGER `service_request_versions_complete_after_reviewed_result`
BEFORE INSERT ON `service_request_versions`
WHEN NEW.`status` = 'completed'
  AND NOT EXISTS (
    SELECT 1
    FROM `diagnostic_reports` report
    JOIN `diagnostic_report_heads` report_head
      ON report_head.`organization_id` = report.`organization_id`
      AND report_head.`facility_id` = report.`facility_id`
      AND report_head.`service_request_id` = report.`service_request_id`
      AND report_head.`diagnostic_report_id` = report.`id`
    JOIN `diagnostic_report_versions` report_version
      ON report_version.`organization_id` = report_head.`organization_id`
      AND report_version.`facility_id` = report_head.`facility_id`
      AND report_version.`service_request_id` = report_head.`service_request_id`
      AND report_version.`diagnostic_report_id` = report_head.`diagnostic_report_id`
      AND report_version.`id` = report_head.`current_version_id`
    WHERE report.`organization_id` = NEW.`organization_id`
      AND report.`facility_id` = NEW.`facility_id`
      AND report.`service_request_id` = NEW.`service_request_id`
      AND report_version.`report_status` IN ('final', 'amended', 'corrected')
      AND report_version.`review_state` = 'reviewed'
  )
BEGIN
  SELECT RAISE(ABORT, 'service request completion requires the current reviewed final result');
END;--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_versions_require_active_care_context`
BEFORE INSERT ON `diagnostic_report_versions`
WHEN NOT EXISTS (
  SELECT 1
  FROM `diagnostic_reports` report
  JOIN `service_requests` request
    ON request.`organization_id` = report.`organization_id`
    AND request.`facility_id` = report.`facility_id`
    AND request.`id` = report.`service_request_id`
  JOIN `encounters` encounter
    ON encounter.`organization_id` = request.`organization_id`
    AND encounter.`facility_id` = request.`facility_id`
    AND encounter.`id` = request.`encounter_id`
    AND encounter.`patient_id` = request.`patient_id`
  JOIN `patients` patient
    ON patient.`organization_id` = request.`organization_id`
    AND patient.`facility_id` = request.`facility_id`
    AND patient.`id` = request.`patient_id`
  LEFT JOIN `patient_profile_heads` profile_head
    ON profile_head.`organization_id` = patient.`organization_id`
    AND profile_head.`facility_id` = patient.`facility_id`
    AND profile_head.`patient_id` = patient.`id`
  LEFT JOIN `patient_profile_versions` profile
    ON profile.`organization_id` = profile_head.`organization_id`
    AND profile.`facility_id` = profile_head.`facility_id`
    AND profile.`patient_id` = profile_head.`patient_id`
    AND profile.`id` = profile_head.`current_version_id`
  JOIN `consent_heads` consent_head
    ON consent_head.`organization_id` = request.`organization_id`
    AND consent_head.`facility_id` = request.`facility_id`
    AND consent_head.`patient_id` = request.`patient_id`
    AND consent_head.`encounter_id` = request.`encounter_id`
    AND consent_head.`consent_type` = 'care'
  JOIN `consent_events` consent_event
    ON consent_event.`organization_id` = consent_head.`organization_id`
    AND consent_event.`facility_id` = consent_head.`facility_id`
    AND consent_event.`patient_id` = consent_head.`patient_id`
    AND consent_event.`encounter_id` = consent_head.`encounter_id`
    AND consent_event.`consent_type` = consent_head.`consent_type`
    AND consent_event.`id` = consent_head.`current_consent_event_id`
  WHERE report.`organization_id` = NEW.`organization_id`
    AND report.`facility_id` = NEW.`facility_id`
    AND report.`service_request_id` = NEW.`service_request_id`
    AND report.`id` = NEW.`diagnostic_report_id`
    AND encounter.`status` <> 'cancelled'
    AND patient.`status` = 'active'
    AND coalesce(profile.`status`, patient.`status`) = 'active'
    AND consent_event.`decision` = 'granted'
    AND consent_event.`effective_at` <= NEW.`created_at`
    AND (
      consent_event.`expires_at` IS NULL
      OR consent_event.`expires_at` > NEW.`created_at`
    )
)
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report version requires an active encounter, patient, profile, and effective care consent');
END;--> statement-breakpoint
CREATE TRIGGER `diagnostic_report_versions_review_from_pending`
BEFORE INSERT ON `diagnostic_report_versions`
WHEN NEW.`review_state` IN ('reviewed', 'needs_reconciliation')
  AND NOT EXISTS (
    SELECT 1
    FROM `diagnostic_report_versions` previous
    WHERE previous.`organization_id` = NEW.`organization_id`
      AND previous.`facility_id` = NEW.`facility_id`
      AND previous.`service_request_id` = NEW.`service_request_id`
      AND previous.`diagnostic_report_id` = NEW.`diagnostic_report_id`
      AND previous.`id` = NEW.`supersedes_version_id`
      AND previous.`review_state` = 'pending'
      AND previous.`report_status` IS NEW.`report_status`
      AND previous.`conclusion` IS NEW.`conclusion`
      AND previous.`artifact_id` IS NEW.`artifact_id`
  )
BEGIN
  SELECT RAISE(ABORT, 'diagnostic report review must preserve the exact pending payload');
END;
