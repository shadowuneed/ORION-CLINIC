-- Additive integrity guards; 0001/0002 are already applied and never rewritten.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
CREATE FUNCTION orion_crm.version_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE current_row jsonb; previous integer;
BEGIN
  IF TG_TABLE_NAME='visit_versions' THEN
    SELECT to_jsonb(v) INTO current_row FROM orion_crm.visits v WHERE v.clinic_id=NEW.clinic_id AND v.id=NEW.visit_id;
    SELECT coalesce(max(version),0) INTO previous FROM orion_crm.visit_versions WHERE clinic_id=NEW.clinic_id AND visit_id=NEW.visit_id;
  ELSE
    SELECT to_jsonb(t) INTO current_row FROM orion_crm.tasks t WHERE t.clinic_id=NEW.clinic_id AND t.id=NEW.task_id;
    SELECT coalesce(max(version),0) INTO previous FROM orion_crm.task_versions WHERE clinic_id=NEW.clinic_id AND task_id=NEW.task_id;
  END IF;
  IF NEW.snapshot IS DISTINCT FROM current_row OR NEW.version<>previous+1 OR
    NEW.status IS DISTINCT FROM current_row->>'status' OR NEW.version IS DISTINCT FROM (current_row->>'version')::integer THEN
    RAISE EXCEPTION 'CRM_HISTORY_PUBLICATION_INVALID' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER version_insert_guard BEFORE INSERT ON orion_crm.visit_versions FOR EACH ROW EXECUTE FUNCTION orion_crm.version_insert_guard();
CREATE TRIGGER version_insert_guard BEFORE INSERT ON orion_crm.task_versions FOR EACH ROW EXECUTE FUNCTION orion_crm.version_insert_guard();

CREATE FUNCTION orion_crm.current_history_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE stored jsonb;
BEGIN
  IF TG_TABLE_NAME='visits' THEN
    SELECT snapshot INTO stored FROM orion_crm.visit_versions WHERE clinic_id=NEW.clinic_id AND visit_id=NEW.id AND version=NEW.version;
  ELSE
    SELECT snapshot INTO stored FROM orion_crm.task_versions WHERE clinic_id=NEW.clinic_id AND task_id=NEW.id AND version=NEW.version;
  END IF;
  IF stored IS DISTINCT FROM to_jsonb(NEW) THEN RAISE EXCEPTION 'CRM_HISTORY_PUBLICATION_INVALID' USING ERRCODE='PT409'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER current_history_guard AFTER INSERT OR UPDATE ON orion_crm.visits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orion_crm.current_history_guard();
CREATE CONSTRAINT TRIGGER current_history_guard AFTER INSERT OR UPDATE ON orion_crm.tasks
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orion_crm.current_history_guard();

CREATE FUNCTION orion_crm.audit_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c orion_crm.clinics; stored jsonb; old_status text;
BEGIN
  SELECT * INTO STRICT c FROM orion_crm.clinics WHERE id=NEW.clinic_id FOR UPDATE;
  IF NEW.sequence<>c.audit_sequence+1 OR NEW.previous_hash IS DISTINCT FROM c.audit_hash OR
    NEW.event_hash<>encode(sha256(convert_to((to_jsonb(NEW)-'event_hash')::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'CRM_AUDIT_PUBLICATION_INVALID' USING ERRCODE='PT503'; END IF;
  IF NEW.visit_id IS NOT NULL THEN
    SELECT snapshot INTO stored FROM orion_crm.visit_versions WHERE clinic_id=NEW.clinic_id AND visit_id=NEW.visit_id AND version=NEW.resource_version;
    SELECT status INTO old_status FROM orion_crm.visit_versions WHERE clinic_id=NEW.clinic_id AND visit_id=NEW.visit_id AND version=NEW.resource_version-1;
  ELSIF NEW.task_id IS NOT NULL THEN
    SELECT snapshot INTO stored FROM orion_crm.task_versions WHERE clinic_id=NEW.clinic_id AND task_id=NEW.task_id AND version=NEW.resource_version;
    SELECT status INTO old_status FROM orion_crm.task_versions WHERE clinic_id=NEW.clinic_id AND task_id=NEW.task_id AND version=NEW.resource_version-1;
  END IF;
  IF NEW.kind IN ('visit.created','visit.transitioned','task.created','task.transitioned') AND
    (stored IS NULL OR NEW.to_status IS DISTINCT FROM stored->>'status' OR NEW.from_status IS DISTINCT FROM old_status OR
    coalesce(NEW.payload->'snapshot',NEW.payload) IS DISTINCT FROM stored) THEN
    RAISE EXCEPTION 'CRM_AUDIT_PUBLICATION_INVALID' USING ERRCODE='PT503'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_insert_guard BEFORE INSERT ON orion_crm.audit_entries FOR EACH ROW EXECUTE FUNCTION orion_crm.audit_insert_guard();
CREATE FUNCTION orion_crm.audit_head_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.audit_sequence IS DISTINCT FROM OLD.audit_sequence OR NEW.audit_hash IS DISTINCT FROM OLD.audit_hash THEN
    IF NEW.audit_sequence<>OLD.audit_sequence+1 OR NOT EXISTS(SELECT 1 FROM orion_crm.audit_entries
      WHERE clinic_id=NEW.id AND sequence=NEW.audit_sequence AND event_hash=NEW.audit_hash AND previous_hash IS NOT DISTINCT FROM OLD.audit_hash) THEN
      RAISE EXCEPTION 'CRM_AUDIT_PUBLICATION_INVALID' USING ERRCODE='PT503'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_head_guard BEFORE UPDATE ON orion_crm.clinics FOR EACH ROW EXECUTE FUNCTION orion_crm.audit_head_guard();
CREATE FUNCTION orion_crm.audit_commit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c orion_crm.clinics; last_event orion_crm.audit_entries;
BEGIN
  SELECT * INTO STRICT c FROM orion_crm.clinics WHERE id=NEW.clinic_id;
  SELECT * INTO last_event FROM orion_crm.audit_entries WHERE clinic_id=NEW.clinic_id ORDER BY sequence DESC LIMIT 1;
  IF c.audit_sequence IS DISTINCT FROM last_event.sequence OR c.audit_hash IS DISTINCT FROM last_event.event_hash THEN
    RAISE EXCEPTION 'CRM_AUDIT_PUBLICATION_INVALID' USING ERRCODE='PT503'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER audit_commit_guard AFTER INSERT ON orion_crm.audit_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orion_crm.audit_commit_guard();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_crm FROM PUBLIC;
COMMIT;
