CREATE TABLE `analysis_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`kind` text NOT NULL,
	`provider` text NOT NULL,
	`model` text NOT NULL,
	`model_version` text NOT NULL,
	`policy_version` text NOT NULL,
	`input_hash` text NOT NULL,
	`source_record_ids_json` text NOT NULL,
	`status` text DEFAULT 'queued' NOT NULL,
	`raw_result_json` text,
	`validation_result_json` text,
	`metrics_json` text,
	`error_code` text,
	`started_at` integer,
	`completed_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "analysis_kind_enum" CHECK("analysis_runs"."kind" in ('clinical_note', 'suggestions', 'risk_review')),
	CONSTRAINT "analysis_status_enum" CHECK("analysis_runs"."status" in ('queued', 'running', 'succeeded', 'failed', 'superseded')),
	CONSTRAINT "analysis_source_records_json" CHECK(json_valid("analysis_runs"."source_record_ids_json")),
	CONSTRAINT "analysis_raw_result_json" CHECK("analysis_runs"."raw_result_json" is null or json_valid("analysis_runs"."raw_result_json")),
	CONSTRAINT "analysis_validation_result_json" CHECK("analysis_runs"."validation_result_json" is null or json_valid("analysis_runs"."validation_result_json")),
	CONSTRAINT "analysis_metrics_json" CHECK("analysis_runs"."metrics_json" is null or json_valid("analysis_runs"."metrics_json")),
	CONSTRAINT "analysis_completion_valid" CHECK("analysis_runs"."completed_at" is null or ("analysis_runs"."started_at" is not null and "analysis_runs"."completed_at" >= "analysis_runs"."started_at"))
);
--> statement-breakpoint
CREATE INDEX `analysis_encounter_status_idx` ON `analysis_runs` (`encounter_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_encounter_input_policy_uidx` ON `analysis_runs` (`encounter_id`,`input_hash`,`policy_version`);--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_scope_id_uidx` ON `analysis_runs` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_scope_encounter_id_uidx` ON `analysis_runs` (`organization_id`,`facility_id`,`encounter_id`,`id`);--> statement-breakpoint
CREATE TABLE `audio_assets` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`duration_ms` integer,
	`retention_state` text DEFAULT 'temporary' NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audio_assets_byte_size_valid" CHECK("audio_assets"."byte_size" >= 0),
	CONSTRAINT "audio_assets_retention_state_enum" CHECK("audio_assets"."retention_state" in ('temporary', 'retained', 'deletion_due', 'deleted')),
	CONSTRAINT "audio_assets_duration_valid" CHECK("audio_assets"."duration_ms" is null or "audio_assets"."duration_ms" >= 0)
);
--> statement-breakpoint
CREATE INDEX `audio_assets_encounter_idx` ON `audio_assets` (`encounter_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `audio_assets_scope_object_key_uidx` ON `audio_assets` (`organization_id`,`facility_id`,`object_key`);--> statement-breakpoint
CREATE TABLE `audit_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`actor_type` text NOT NULL,
	`actor_id` text NOT NULL,
	`actor_membership_id` text,
	`action` text NOT NULL,
	`outcome` text NOT NULL,
	`purpose` text NOT NULL,
	`schema_version` integer DEFAULT 1 NOT NULL,
	`entity_type` text NOT NULL,
	`entity_id` text NOT NULL,
	`request_id` text NOT NULL,
	`metadata_json` text NOT NULL,
	`previous_hash` text,
	`event_hash` text NOT NULL,
	`occurred_at` integer NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`actor_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_sequence_positive" CHECK("audit_events"."sequence" > 0),
	CONSTRAINT "audit_schema_version_positive" CHECK("audit_events"."schema_version" > 0),
	CONSTRAINT "audit_genesis_consistent" CHECK(("audit_events"."sequence" = 1 and "audit_events"."previous_hash" is null) or ("audit_events"."sequence" > 1 and "audit_events"."previous_hash" is not null)),
	CONSTRAINT "audit_actor_consistent" CHECK(("audit_events"."actor_type" = 'user' and "audit_events"."actor_membership_id" is not null) or ("audit_events"."actor_type" = 'service' and "audit_events"."actor_membership_id" is null)),
	CONSTRAINT "audit_actor_type_enum" CHECK("audit_events"."actor_type" in ('user', 'service')),
	CONSTRAINT "audit_outcome_enum" CHECK("audit_events"."outcome" in ('succeeded', 'denied', 'failed')),
	CONSTRAINT "audit_metadata_json" CHECK(json_valid("audit_events"."metadata_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_scope_sequence_uidx` ON `audit_events` (`organization_id`,`facility_id`,`sequence`);--> statement-breakpoint
CREATE INDEX `audit_scope_time_idx` ON `audit_events` (`organization_id`,`facility_id`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `audit_entity_time_idx` ON `audit_events` (`entity_type`,`entity_id`,`occurred_at`);--> statement-breakpoint
CREATE UNIQUE INDEX `audit_event_hash_uidx` ON `audit_events` (`event_hash`);--> statement-breakpoint
CREATE TABLE `audit_stream_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`last_sequence` integer DEFAULT 0 NOT NULL,
	`last_event_hash` text,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`last_event_hash`) REFERENCES `audit_events`(`event_hash`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "audit_stream_heads_sequence_nonnegative" CHECK("audit_stream_heads"."last_sequence" >= 0),
	CONSTRAINT "audit_stream_heads_lock_positive" CHECK("audit_stream_heads"."lock_version" > 0),
	CONSTRAINT "audit_stream_heads_genesis_consistent" CHECK(("audit_stream_heads"."last_sequence" = 0 and "audit_stream_heads"."last_event_hash" is null) or ("audit_stream_heads"."last_sequence" > 0 and "audit_stream_heads"."last_event_hash" is not null))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `audit_stream_heads_scope_uidx` ON `audit_stream_heads` (`organization_id`,`facility_id`);--> statement-breakpoint
CREATE TABLE `clinical_section_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`code` text NOT NULL,
	`current_version_id` text NOT NULL,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_version_id`) REFERENCES `clinical_section_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`code`,`current_version_id`) REFERENCES `clinical_section_versions`(`organization_id`,`facility_id`,`encounter_id`,`code`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clinical_section_heads_lock_positive" CHECK("clinical_section_heads"."lock_version" > 0),
	CONSTRAINT "clinical_section_heads_code_enum" CHECK("clinical_section_heads"."code" in ('complaints', 'history_of_present_illness', 'past_medical_history', 'allergy_status', 'objective_findings', 'preliminary_diagnosis', 'examination_plan', 'treatment_plan'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_section_heads_scope_subject_uidx` ON `clinical_section_heads` (`organization_id`,`facility_id`,`encounter_id`,`code`);--> statement-breakpoint
CREATE TABLE `clinical_section_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`code` text NOT NULL,
	`content` text NOT NULL,
	`review_state` text DEFAULT 'empty' NOT NULL,
	`provenance_json` text NOT NULL,
	`created_by_type` text NOT NULL,
	`created_by_id` text NOT NULL,
	`reviewed_by_membership_id` text,
	`reviewed_at` integer,
	`version` integer DEFAULT 1 NOT NULL,
	`supersedes_section_version_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_section_version_id`) REFERENCES `clinical_section_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`reviewed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "clinical_section_versions_human_review_valid" CHECK(("clinical_section_versions"."review_state" not in ('reviewed', 'explicitly_absent')) or ("clinical_section_versions"."reviewed_by_membership_id" is not null and "clinical_section_versions"."reviewed_at" is not null)),
	CONSTRAINT "clinical_section_versions_version_positive" CHECK("clinical_section_versions"."version" > 0),
	CONSTRAINT "clinical_section_versions_code_enum" CHECK("clinical_section_versions"."code" in ('complaints', 'history_of_present_illness', 'past_medical_history', 'allergy_status', 'objective_findings', 'preliminary_diagnosis', 'examination_plan', 'treatment_plan')),
	CONSTRAINT "clinical_section_versions_review_state_enum" CHECK("clinical_section_versions"."review_state" in ('empty', 'ai_draft', 'clinician_edited', 'reviewed', 'explicitly_absent')),
	CONSTRAINT "clinical_section_versions_created_by_type_enum" CHECK("clinical_section_versions"."created_by_type" in ('user', 'service')),
	CONSTRAINT "clinical_section_versions_provenance_json" CHECK(json_valid("clinical_section_versions"."provenance_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_section_versions_encounter_code_version_uidx` ON `clinical_section_versions` (`encounter_id`,`code`,`version`);--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_section_versions_scope_subject_id_uidx` ON `clinical_section_versions` (`organization_id`,`facility_id`,`encounter_id`,`code`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `clinical_section_versions_supersedes_once_uidx` ON `clinical_section_versions` (`supersedes_section_version_id`);--> statement-breakpoint
CREATE TABLE `clinical_suggestions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`analysis_run_id` text NOT NULL,
	`category` text NOT NULL,
	`risk_level` text DEFAULT 'informational' NOT NULL,
	`title` text NOT NULL,
	`original_content` text NOT NULL,
	`evidence_json` text NOT NULL,
	`expires_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`analysis_run_id`) REFERENCES `analysis_runs`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`analysis_run_id`) REFERENCES `analysis_runs`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suggestions_category_enum" CHECK("clinical_suggestions"."category" in ('clarification', 'safety', 'action', 'medication', 'clinical_section')),
	CONSTRAINT "suggestions_risk_level_enum" CHECK("clinical_suggestions"."risk_level" in ('informational', 'attention', 'urgent')),
	CONSTRAINT "suggestions_evidence_json" CHECK(json_valid("clinical_suggestions"."evidence_json"))
);
--> statement-breakpoint
CREATE INDEX `suggestions_encounter_created_idx` ON `clinical_suggestions` (`encounter_id`,`created_at`);--> statement-breakpoint
CREATE INDEX `suggestions_analysis_run_idx` ON `clinical_suggestions` (`analysis_run_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_scope_id_uidx` ON `clinical_suggestions` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `suggestions_scope_encounter_id_uidx` ON `clinical_suggestions` (`organization_id`,`facility_id`,`encounter_id`,`id`);--> statement-breakpoint
CREATE TABLE `command_idempotency` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`actor_membership_id` text NOT NULL,
	`operation` text NOT NULL,
	`idempotency_key` text NOT NULL,
	`request_hash` text NOT NULL,
	`status` text DEFAULT 'processing' NOT NULL,
	`result_resource_type` text,
	`result_resource_id` text,
	`response_json` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`completed_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`actor_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "command_idempotency_completion_consistent" CHECK(("command_idempotency"."status" = 'processing' and "command_idempotency"."completed_at" is null) or ("command_idempotency"."status" <> 'processing' and "command_idempotency"."completed_at" is not null)),
	CONSTRAINT "command_idempotency_status_enum" CHECK("command_idempotency"."status" in ('processing', 'succeeded', 'failed')),
	CONSTRAINT "command_idempotency_response_json" CHECK("command_idempotency"."response_json" is null or json_valid("command_idempotency"."response_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `command_idempotency_scope_operation_key_uidx` ON `command_idempotency` (`organization_id`,`facility_id`,`actor_membership_id`,`operation`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `command_idempotency_scope_id_uidx` ON `command_idempotency` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE TABLE `consent_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`encounter_id` text,
	`consent_type` text NOT NULL,
	`decision` text NOT NULL,
	`captured_by_membership_id` text NOT NULL,
	`policy_version` text NOT NULL,
	`policy_hash` text NOT NULL,
	`notice_language` text NOT NULL,
	`external_processor` text,
	`evidence_object_key` text,
	`source` text NOT NULL,
	`occurred_at` integer NOT NULL,
	`effective_at` integer NOT NULL,
	`expires_at` integer,
	`supersedes_consent_event_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`captured_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_consent_event_id`) REFERENCES `consent_events`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`captured_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "consent_withdrawal_has_source" CHECK("consent_events"."decision" <> 'withdrawn' or "consent_events"."supersedes_consent_event_id" is not null),
	CONSTRAINT "consent_expiry_valid" CHECK("consent_events"."expires_at" is null or "consent_events"."expires_at" > "consent_events"."effective_at"),
	CONSTRAINT "consent_type_enum" CHECK("consent_events"."consent_type" in ('care', 'transient_audio_processing', 'audio_retention', 'transcript_storage', 'external_ai_processing', 'data_exchange', 'notifications')),
	CONSTRAINT "consent_decision_enum" CHECK("consent_events"."decision" in ('granted', 'denied', 'withdrawn')),
	CONSTRAINT "consent_notice_language_enum" CHECK("consent_events"."notice_language" in ('ru', 'kk')),
	CONSTRAINT "consent_source_enum" CHECK("consent_events"."source" in ('written', 'verbal', 'digital'))
);
--> statement-breakpoint
CREATE INDEX `consent_patient_type_time_idx` ON `consent_events` (`patient_id`,`consent_type`,`occurred_at`);--> statement-breakpoint
CREATE INDEX `consent_encounter_idx` ON `consent_events` (`encounter_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_scope_id_uidx` ON `consent_events` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `consent_scope_subject_id_uidx` ON `consent_events` (`organization_id`,`facility_id`,`patient_id`,`consent_type`,`id`);--> statement-breakpoint
CREATE TABLE `document_artifacts` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`protocol_version_id` text,
	`kind` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`sha256` text NOT NULL,
	`byte_size` integer NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`protocol_version_id`) REFERENCES `protocol_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`protocol_version_id`) REFERENCES `protocol_versions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "documents_byte_size_valid" CHECK("document_artifacts"."byte_size" >= 0),
	CONSTRAINT "documents_kind_enum" CHECK("document_artifacts"."kind" in ('protocol_docx', 'protocol_pdf', 'transcript_txt', 'audit_json', 'bundle_zip')),
	CONSTRAINT "documents_status_enum" CHECK("document_artifacts"."status" in ('pending', 'ready', 'failed', 'deleted'))
);
--> statement-breakpoint
CREATE INDEX `documents_encounter_kind_idx` ON `document_artifacts` (`encounter_id`,`kind`);--> statement-breakpoint
CREATE UNIQUE INDEX `documents_scope_object_key_uidx` ON `document_artifacts` (`organization_id`,`facility_id`,`object_key`);--> statement-breakpoint
CREATE TABLE `encounters` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`clinician_membership_id` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`reason_for_visit` text,
	`started_at` integer,
	`ended_at` integer,
	`finalized_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`clinician_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`clinician_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "encounters_status_enum" CHECK("encounters"."status" in ('draft', 'ready', 'in_progress', 'review', 'finalized', 'amended', 'cancelled')),
	CONSTRAINT "encounters_version_positive" CHECK("encounters"."version" > 0),
	CONSTRAINT "encounters_timing_valid" CHECK("encounters"."ended_at" is null or ("encounters"."started_at" is not null and "encounters"."ended_at" >= "encounters"."started_at")),
	CONSTRAINT "encounters_finalization_valid" CHECK("encounters"."finalized_at" is null or "encounters"."status" in ('finalized', 'amended'))
);
--> statement-breakpoint
CREATE INDEX `encounters_scope_status_idx` ON `encounters` (`organization_id`,`facility_id`,`status`);--> statement-breakpoint
CREATE INDEX `encounters_patient_started_idx` ON `encounters` (`patient_id`,`started_at`);--> statement-breakpoint
CREATE INDEX `encounters_clinician_status_idx` ON `encounters` (`clinician_membership_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `encounters_scope_id_uidx` ON `encounters` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE TABLE `facilities` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`name` text NOT NULL,
	`timezone` text DEFAULT 'Asia/Almaty' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "facilities_status_enum" CHECK("facilities"."status" in ('active', 'suspended')),
	CONSTRAINT "facilities_version_positive" CHECK("facilities"."version" > 0)
);
--> statement-breakpoint
CREATE INDEX `facilities_organization_idx` ON `facilities` (`organization_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `facilities_scope_id_uidx` ON `facilities` (`organization_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `facilities_org_name_uidx` ON `facilities` (`organization_id`,`name`);--> statement-breakpoint
CREATE TABLE `memberships` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`user_id` text NOT NULL,
	`role` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`user_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "memberships_role_enum" CHECK("memberships"."role" in ('clinician', 'nurse', 'registrar', 'administrator', 'auditor')),
	CONSTRAINT "memberships_status_enum" CHECK("memberships"."status" in ('active', 'disabled')),
	CONSTRAINT "memberships_version_positive" CHECK("memberships"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_scope_user_uidx` ON `memberships` (`organization_id`,`facility_id`,`user_id`);--> statement-breakpoint
CREATE INDEX `memberships_user_idx` ON `memberships` (`user_id`);--> statement-breakpoint
CREATE UNIQUE INDEX `memberships_scope_id_uidx` ON `memberships` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE TABLE `organizations` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "organizations_status_enum" CHECK("organizations"."status" in ('active', 'suspended')),
	CONSTRAINT "organizations_version_positive" CHECK("organizations"."version" > 0)
);
--> statement-breakpoint
CREATE TABLE `outbox_events` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`aggregate_type` text NOT NULL,
	`aggregate_id` text NOT NULL,
	`aggregate_version` integer NOT NULL,
	`command_id` text,
	`event_type` text NOT NULL,
	`payload_json` text NOT NULL,
	`event_idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`next_attempt_at` integer NOT NULL,
	`lease_owner` text,
	`lease_expires_at` integer,
	`claimed_at` integer,
	`completed_at` integer,
	`last_error_code` text,
	`last_error_at` integer,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`command_id`) REFERENCES `command_idempotency`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`command_id`) REFERENCES `command_idempotency`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "outbox_attempts_nonnegative" CHECK("outbox_events"."attempts" >= 0),
	CONSTRAINT "outbox_aggregate_version_positive" CHECK("outbox_events"."aggregate_version" > 0),
	CONSTRAINT "outbox_lease_consistent" CHECK(("outbox_events"."status" = 'processing' and "outbox_events"."lease_owner" is not null and "outbox_events"."lease_expires_at" is not null and "outbox_events"."claimed_at" is not null) or ("outbox_events"."status" <> 'processing')),
	CONSTRAINT "outbox_completion_consistent" CHECK(("outbox_events"."status" = 'succeeded' and "outbox_events"."completed_at" is not null) or ("outbox_events"."status" <> 'succeeded')),
	CONSTRAINT "outbox_status_enum" CHECK("outbox_events"."status" in ('pending', 'processing', 'succeeded', 'failed', 'dead_letter')),
	CONSTRAINT "outbox_payload_json" CHECK(json_valid("outbox_events"."payload_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `outbox_scope_event_idempotency_uidx` ON `outbox_events` (`organization_id`,`facility_id`,`event_idempotency_key`);--> statement-breakpoint
CREATE INDEX `outbox_dispatch_idx` ON `outbox_events` (`status`,`next_attempt_at`);--> statement-breakpoint
CREATE INDEX `outbox_aggregate_idx` ON `outbox_events` (`aggregate_type`,`aggregate_id`);--> statement-breakpoint
CREATE TABLE `patients` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`medical_record_number` text NOT NULL,
	`display_name` text NOT NULL,
	`birth_date` text,
	`sex_at_birth` text DEFAULT 'not_recorded' NOT NULL,
	`status` text DEFAULT 'active' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patients_sex_at_birth_enum" CHECK("patients"."sex_at_birth" in ('female', 'male', 'unknown', 'not_recorded')),
	CONSTRAINT "patients_status_enum" CHECK("patients"."status" in ('active', 'inactive', 'merged')),
	CONSTRAINT "patients_version_positive" CHECK("patients"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patients_scope_mrn_uidx` ON `patients` (`organization_id`,`facility_id`,`medical_record_number`);--> statement-breakpoint
CREATE INDEX `patients_scope_name_idx` ON `patients` (`organization_id`,`facility_id`,`display_name`);--> statement-breakpoint
CREATE UNIQUE INDEX `patients_scope_id_uidx` ON `patients` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE TABLE `protocol_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`current_protocol_version_id` text NOT NULL,
	`current_signed_protocol_version_id` text,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_protocol_version_id`) REFERENCES `protocol_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_signed_protocol_version_id`) REFERENCES `protocol_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`current_protocol_version_id`) REFERENCES `protocol_versions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`current_signed_protocol_version_id`) REFERENCES `protocol_versions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "protocol_heads_lock_positive" CHECK("protocol_heads"."lock_version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `protocol_heads_scope_encounter_uidx` ON `protocol_heads` (`organization_id`,`facility_id`,`encounter_id`);--> statement-breakpoint
CREATE TABLE `protocol_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`version` integer NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`content_json` text NOT NULL,
	`source_hash` text NOT NULL,
	`created_by_membership_id` text NOT NULL,
	`signed_by_membership_id` text,
	`signed_at` integer,
	`supersedes_protocol_version_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`created_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`signed_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_protocol_version_id`) REFERENCES `protocol_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`created_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`signed_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "protocol_versions_version_positive" CHECK("protocol_versions"."version" > 0),
	CONSTRAINT "protocol_versions_signature_consistent" CHECK(("protocol_versions"."status" = 'signed' and "protocol_versions"."signed_by_membership_id" is not null and "protocol_versions"."signed_at" is not null) or ("protocol_versions"."status" = 'draft' and "protocol_versions"."signed_by_membership_id" is null and "protocol_versions"."signed_at" is null)),
	CONSTRAINT "protocol_versions_status_enum" CHECK("protocol_versions"."status" in ('draft', 'signed')),
	CONSTRAINT "protocol_versions_content_json" CHECK(json_valid("protocol_versions"."content_json"))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `protocol_versions_encounter_version_uidx` ON `protocol_versions` (`encounter_id`,`version`);--> statement-breakpoint
CREATE INDEX `protocol_versions_encounter_status_idx` ON `protocol_versions` (`encounter_id`,`status`);--> statement-breakpoint
CREATE UNIQUE INDEX `protocol_versions_scope_id_uidx` ON `protocol_versions` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `protocol_versions_scope_encounter_id_uidx` ON `protocol_versions` (`organization_id`,`facility_id`,`encounter_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `protocol_versions_supersedes_once_uidx` ON `protocol_versions` (`supersedes_protocol_version_id`);--> statement-breakpoint
CREATE TABLE `review_decisions` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`reviewer_membership_id` text NOT NULL,
	`sequence` integer NOT NULL,
	`expected_version` integer NOT NULL,
	`idempotency_key` text NOT NULL,
	`decision` text NOT NULL,
	`result_state` text NOT NULL,
	`edited_content` text,
	`reason` text,
	`decided_at` integer NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `clinical_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`reviewer_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`) REFERENCES `clinical_suggestions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`reviewer_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "review_decisions_sequence_positive" CHECK("review_decisions"."sequence" > 0),
	CONSTRAINT "review_decisions_version_positive" CHECK("review_decisions"."expected_version" > 0),
	CONSTRAINT "review_decisions_edited_content_valid" CHECK(("review_decisions"."decision" = 'edit_and_accept' and length(trim(coalesce("review_decisions"."edited_content", ''))) > 0) or ("review_decisions"."decision" <> 'edit_and_accept' and "review_decisions"."edited_content" is null)),
	CONSTRAINT "review_decisions_decision_enum" CHECK("review_decisions"."decision" in ('accept', 'edit_and_accept', 'reject', 'restore')),
	CONSTRAINT "review_decisions_result_state_enum" CHECK("review_decisions"."result_state" in ('proposed', 'accepted', 'edited_and_accepted', 'rejected')),
	CONSTRAINT "review_decisions_transition_consistent" CHECK(("review_decisions"."decision" = 'accept' and "review_decisions"."result_state" = 'accepted') or ("review_decisions"."decision" = 'edit_and_accept' and "review_decisions"."result_state" = 'edited_and_accepted') or ("review_decisions"."decision" = 'reject' and "review_decisions"."result_state" = 'rejected') or ("review_decisions"."decision" = 'restore' and "review_decisions"."result_state" = 'proposed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `review_decisions_suggestion_sequence_uidx` ON `review_decisions` (`suggestion_id`,`sequence`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_decisions_scope_idempotency_uidx` ON `review_decisions` (`organization_id`,`facility_id`,`idempotency_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_decisions_scope_id_uidx` ON `review_decisions` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `review_decisions_scope_subject_id_uidx` ON `review_decisions` (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`);--> statement-breakpoint
CREATE INDEX `review_decisions_encounter_time_idx` ON `review_decisions` (`encounter_id`,`decided_at`);--> statement-breakpoint
CREATE TABLE `suggestion_review_heads` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`suggestion_id` text NOT NULL,
	`state` text DEFAULT 'proposed' NOT NULL,
	`current_decision_id` text,
	`lock_version` integer DEFAULT 1 NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`suggestion_id`) REFERENCES `clinical_suggestions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`current_decision_id`) REFERENCES `review_decisions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`) REFERENCES `clinical_suggestions`(`organization_id`,`facility_id`,`encounter_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`current_decision_id`) REFERENCES `review_decisions`(`organization_id`,`facility_id`,`encounter_id`,`suggestion_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "suggestion_review_heads_lock_positive" CHECK("suggestion_review_heads"."lock_version" > 0),
	CONSTRAINT "suggestion_review_heads_decision_consistency" CHECK("suggestion_review_heads"."state" = 'proposed' or "suggestion_review_heads"."current_decision_id" is not null),
	CONSTRAINT "suggestion_review_heads_state_enum" CHECK("suggestion_review_heads"."state" in ('proposed', 'accepted', 'edited_and_accepted', 'rejected', 'expired'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `suggestion_review_heads_scope_suggestion_uidx` ON `suggestion_review_heads` (`organization_id`,`facility_id`,`suggestion_id`);--> statement-breakpoint
CREATE TABLE `transcript_segments` (
	`id` text PRIMARY KEY NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`segment_index` integer NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`speaker_role` text DEFAULT 'unknown' NOT NULL,
	`speaker_role_source` text DEFAULT 'unassigned' NOT NULL,
	`speaker_confidence_basis_points` integer,
	`language_code` text DEFAULT 'unknown' NOT NULL,
	`text` text NOT NULL,
	`started_at_ms` integer NOT NULL,
	`ended_at_ms` integer NOT NULL,
	`state` text DEFAULT 'provisional' NOT NULL,
	`corrected_by_membership_id` text,
	`supersedes_segment_id` text,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`corrected_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`supersedes_segment_id`) REFERENCES `transcript_segments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`) REFERENCES `facilities`(`organization_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`encounter_id`) REFERENCES `encounters`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`corrected_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "transcript_timing_valid" CHECK("transcript_segments"."started_at_ms" >= 0 and "transcript_segments"."ended_at_ms" >= "transcript_segments"."started_at_ms"),
	CONSTRAINT "transcript_confidence_valid" CHECK("transcript_segments"."speaker_confidence_basis_points" is null or ("transcript_segments"."speaker_confidence_basis_points" >= 0 and "transcript_segments"."speaker_confidence_basis_points" <= 10000)),
	CONSTRAINT "transcript_correction_has_provenance" CHECK("transcript_segments"."state" <> 'corrected' or ("transcript_segments"."supersedes_segment_id" is not null and "transcript_segments"."corrected_by_membership_id" is not null)),
	CONSTRAINT "transcript_version_positive" CHECK("transcript_segments"."version" > 0),
	CONSTRAINT "transcript_speaker_role_enum" CHECK("transcript_segments"."speaker_role" in ('doctor', 'patient', 'other', 'unknown')),
	CONSTRAINT "transcript_speaker_source_enum" CHECK("transcript_segments"."speaker_role_source" in ('unassigned', 'model', 'voice_calibration', 'manual')),
	CONSTRAINT "transcript_language_enum" CHECK("transcript_segments"."language_code" in ('ru', 'kk', 'mixed', 'unknown')),
	CONSTRAINT "transcript_state_enum" CHECK("transcript_segments"."state" in ('provisional', 'final', 'corrected'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_encounter_segment_version_uidx` ON `transcript_segments` (`encounter_id`,`segment_index`,`version`);--> statement-breakpoint
CREATE INDEX `transcript_encounter_time_idx` ON `transcript_segments` (`encounter_id`,`started_at_ms`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_scope_id_uidx` ON `transcript_segments` (`organization_id`,`facility_id`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_scope_segment_id_uidx` ON `transcript_segments` (`organization_id`,`facility_id`,`encounter_id`,`segment_index`,`id`);--> statement-breakpoint
CREATE UNIQUE INDEX `transcript_supersedes_once_uidx` ON `transcript_segments` (`supersedes_segment_id`);--> statement-breakpoint
CREATE TABLE `users` (
	`id` text PRIMARY KEY NOT NULL,
	`external_issuer` text NOT NULL,
	`external_subject` text NOT NULL,
	`email_normalized` text,
	`display_name` text NOT NULL,
	`status` text DEFAULT 'invited' NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`updated_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	CONSTRAINT "users_status_enum" CHECK("users"."status" in ('invited', 'active', 'disabled')),
	CONSTRAINT "users_version_positive" CHECK("users"."version" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `users_issuer_subject_uidx` ON `users` (`external_issuer`,`external_subject`);--> statement-breakpoint
CREATE INDEX `users_email_normalized_idx` ON `users` (`email_normalized`);