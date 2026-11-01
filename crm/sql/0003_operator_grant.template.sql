-- OPERATOR TEMPLATE, NOT AN AUTOMATIC MIGRATION.
-- psql variables must be projected from one exact CURRENT provisioned local
-- account after identity verification. No local password/clinical role is copied.
-- Example variables: actor_issuer, actor_subject, actor_label (no defaults).
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage)
VALUES('crm-local-operator','crm-clinic-local', :'actor_issuer', :'actor_subject', :'actor_label',true,true);
-- Local simulation capability only; never modifies D1, staff roles or Supabase.
COMMIT;
