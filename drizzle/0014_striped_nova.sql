DROP INDEX `analysis_encounter_input_policy_uidx`;--> statement-breakpoint
CREATE INDEX `analysis_encounter_input_policy_idx` ON `analysis_runs` (`encounter_id`,`input_hash`,`policy_version`);
--> statement-breakpoint
CREATE UNIQUE INDEX `analysis_active_input_uidx`
ON `analysis_runs` (`organization_id`, `facility_id`, `encounter_id`, `input_hash`, `policy_version`)
WHERE `status` = 'running';
