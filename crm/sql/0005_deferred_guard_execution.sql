-- Constraint triggers fire at COMMIT, after the SECURITY DEFINER RPC returned.
-- They need owner execution to inspect private rows; the runtime gets no table
-- or helper EXECUTE grants. Search paths remain empty and bodies are unchanged.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
ALTER FUNCTION orion_crm.current_history_guard() SECURITY DEFINER;
ALTER FUNCTION orion_crm.audit_commit_guard() SECURITY DEFINER;
REVOKE ALL ON FUNCTION orion_crm.current_history_guard(),orion_crm.audit_commit_guard() FROM PUBLIC,orion_crm_app;
COMMIT;
