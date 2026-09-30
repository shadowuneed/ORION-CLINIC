-- MOBILE-1/M1a: unmounted adult-self link registry, not an authentication grant.
CREATE TABLE `patient_self_links` (
	`id` text PRIMARY KEY NOT NULL,
	`identity_issuer` text NOT NULL,
	`identity_subject` text NOT NULL,
	`organization_id` text NOT NULL,
	`facility_id` text NOT NULL,
	`patient_id` text NOT NULL,
	`purpose` text NOT NULL,
	`verification_ref` text NOT NULL,
	`verified_by_membership_id` text NOT NULL,
	`status` text NOT NULL,
	`version` integer NOT NULL,
	`created_at` integer NOT NULL,
	`expires_at` integer NOT NULL,
	`revoked_at` integer,
	FOREIGN KEY (`organization_id`) REFERENCES `organizations`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`facility_id`) REFERENCES `facilities`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`patient_id`) REFERENCES `patients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`verified_by_membership_id`) REFERENCES `memberships`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`patient_id`) REFERENCES `patients`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`organization_id`,`facility_id`,`verified_by_membership_id`) REFERENCES `memberships`(`organization_id`,`facility_id`,`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "patient_self_links_purpose" CHECK("patient_self_links"."purpose" in ('protocol.read')),
	CONSTRAINT "patient_self_links_status" CHECK("patient_self_links"."status" in ('active', 'revoked')),
	CONSTRAINT "patient_self_links_version" CHECK("patient_self_links"."version" > 0),
	CONSTRAINT "patient_self_links_clock" CHECK("patient_self_links"."created_at" > 0 and "patient_self_links"."expires_at" > "patient_self_links"."created_at" and ("patient_self_links"."revoked_at" is null or "patient_self_links"."revoked_at" >= "patient_self_links"."created_at")),
	CONSTRAINT "patient_self_links_state" CHECK(("patient_self_links"."status" = 'active' and "patient_self_links"."revoked_at" is null) or ("patient_self_links"."status" = 'revoked' and "patient_self_links"."revoked_at" is not null)),
	CONSTRAINT "patient_self_links_identity" CHECK(length(trim("patient_self_links"."identity_issuer")) between 1 and 128 and length(trim("patient_self_links"."identity_subject")) between 1 and 256),
	CONSTRAINT "patient_self_links_verification" CHECK(length(trim("patient_self_links"."verification_ref")) between 1 and 128)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `patient_self_links_active_identity_patient_uidx` ON `patient_self_links` (`identity_issuer`,`identity_subject`,`organization_id`,`facility_id`,`patient_id`,`purpose`) WHERE "patient_self_links"."status" = 'active';--> statement-breakpoint
CREATE INDEX `patient_self_links_patient_idx` ON `patient_self_links` (`organization_id`,`facility_id`,`patient_id`,`status`);
--> statement-breakpoint
-- Inserts and terminal revocations are internal clinic commands. There is no
-- public self-link endpoint: the future adapter must independently verify the
-- patient identity, staff authority and evidence before issuing the command.
CREATE TRIGGER patient_self_links_insert_guard BEFORE INSERT ON patient_self_links
WHEN NEW.version <> 1 OR NEW.status <> 'active' OR NEW.revoked_at IS NOT NULL
  OR EXISTS (SELECT 1 FROM patient_self_links existing WHERE existing.id = NEW.id)
  OR NEW.created_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NEW.expires_at <= NEW.created_at
  OR NOT EXISTS (
    SELECT 1 FROM patients patient
    WHERE patient.id = NEW.patient_id AND patient.organization_id = NEW.organization_id
      AND patient.facility_id = NEW.facility_id AND patient.status = 'active'
  )
  OR NOT EXISTS (
    SELECT 1 FROM memberships verifier
    WHERE verifier.id = NEW.verified_by_membership_id
      AND verifier.organization_id = NEW.organization_id
      AND verifier.facility_id = NEW.facility_id AND verifier.status = 'active'
  )
BEGIN SELECT RAISE(ABORT, 'patient self link requires current scoped verification'); END;
--> statement-breakpoint
CREATE TRIGGER patient_self_links_update_guard BEFORE UPDATE ON patient_self_links
WHEN OLD.status <> 'active' OR NEW.status <> 'revoked'
  OR NEW.version <> OLD.version + 1
  OR NEW.revoked_at <> CAST(unixepoch('subsec') * 1000 AS INTEGER)
  OR NEW.id IS NOT OLD.id OR NEW.identity_issuer IS NOT OLD.identity_issuer
  OR NEW.identity_subject IS NOT OLD.identity_subject
  OR NEW.organization_id IS NOT OLD.organization_id
  OR NEW.facility_id IS NOT OLD.facility_id OR NEW.patient_id IS NOT OLD.patient_id
  OR NEW.purpose IS NOT OLD.purpose OR NEW.verification_ref IS NOT OLD.verification_ref
  OR NEW.verified_by_membership_id IS NOT OLD.verified_by_membership_id
  OR NEW.created_at IS NOT OLD.created_at OR NEW.expires_at IS NOT OLD.expires_at
BEGIN SELECT RAISE(ABORT, 'patient self link is terminal after revocation'); END;
--> statement-breakpoint
CREATE TRIGGER patient_self_links_no_delete BEFORE DELETE ON patient_self_links
BEGIN SELECT RAISE(ABORT, 'patient self link tombstone cannot be deleted'); END;
