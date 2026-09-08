CREATE TABLE `export_cleanup_fences` (
	`object_key` text PRIMARY KEY NOT NULL,
	`manifest_key` text NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`encounter_id` text NOT NULL,
	`protocol_id` text NOT NULL,
	`access_assignment_id` text NOT NULL,
	`actor_membership_id` text NOT NULL,
	`actor_id` text NOT NULL,
	`request_id` text NOT NULL,
	`created_at` integer DEFAULT (unixepoch() * 1000) NOT NULL,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`encounter_id`) REFERENCES `encounters`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`protocol_id`) REFERENCES `protocol_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`access_assignment_id`) REFERENCES `department_access_assignments`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`actor_id`) REFERENCES `users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TRIGGER export_cleanup_current_authority BEFORE INSERT ON export_cleanup_fences
WHEN NOT EXISTS (
  SELECT 1 FROM current_export_write_access access JOIN memberships member ON member.id=access.membership_id
  WHERE access.assignment_id=NEW.access_assignment_id AND access.organization_id=NEW.organization_id
    AND access.facility_id=NEW.facility_id AND access.encounter_id=NEW.encounter_id
    AND access.protocol_id=NEW.protocol_id AND access.membership_id=NEW.actor_membership_id
    AND member.user_id=NEW.actor_id
)
BEGIN SELECT RAISE(ABORT,'export cleanup requires current assignment'); END;
--> statement-breakpoint
CREATE TRIGGER export_cleanup_unreferenced BEFORE INSERT ON export_cleanup_fences
WHEN EXISTS (SELECT 1 FROM document_artifacts WHERE object_key=NEW.object_key)
BEGIN SELECT RAISE(ABORT,'referenced export cannot be fenced'); END;
--> statement-breakpoint
CREATE TRIGGER export_cleanup_no_update BEFORE UPDATE ON export_cleanup_fences
BEGIN SELECT RAISE(ABORT,'export cleanup fence is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER export_cleanup_no_delete BEFORE DELETE ON export_cleanup_fences
BEGIN SELECT RAISE(ABORT,'export cleanup fence is permanent'); END;
--> statement-breakpoint
CREATE TRIGGER document_export_fenced_insert BEFORE INSERT ON document_artifacts
WHEN EXISTS (SELECT 1 FROM export_cleanup_fences WHERE object_key=NEW.object_key)
BEGIN SELECT RAISE(ABORT,'export object publication was fenced'); END;
--> statement-breakpoint
CREATE TRIGGER document_export_fenced_update BEFORE UPDATE OF object_key ON document_artifacts
WHEN EXISTS (SELECT 1 FROM export_cleanup_fences WHERE object_key=NEW.object_key)
BEGIN SELECT RAISE(ABORT,'export object publication was fenced'); END;
