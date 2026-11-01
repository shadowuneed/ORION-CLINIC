-- Bounded display-name maintenance in the dedicated local CRM only.
-- Original task versions/audit actors stay immutable; no task-edit RPC is added.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
LOCK TABLE orion_crm.clinics,orion_crm.staff,orion_crm.services,orion_crm.tasks IN ACCESS EXCLUSIVE MODE;
DO $$
BEGIN
  PERFORM 1 FROM orion_crm.clinics WHERE id='crm-clinic-local' AND active AND mode='synthetic_simulation'
    AND name='ORION · тестовая клиника' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_CATALOGUE_ORIGINAL_NAMES_CHANGED'; END IF;
  IF (SELECT count(*) FROM orion_crm.staff WHERE clinic_id='crm-clinic-local')<>6 OR EXISTS(
    SELECT 1 FROM (VALUES ('staff-registrar','Тест · Алия'),('staff-doctor-a','Тест · Мария'),
      ('staff-doctor-b','Тест · Данияр'),('staff-diagnostics','Тест · София'),('staff-nurse','Тест · Айгерим'),('staff-support','Тест · Арман'))
      expected(id,name) LEFT JOIN orion_crm.staff s ON s.clinic_id='crm-clinic-local' AND s.id=expected.id
      WHERE s.id IS NULL OR s.name IS DISTINCT FROM expected.name
  ) OR (SELECT count(*) FROM orion_crm.services WHERE clinic_id='crm-clinic-local')<>3 OR EXISTS(
    SELECT 1 FROM (VALUES ('service-consultation','Учебная консультация'),('service-diagnostics','Учебная диагностика'),
      ('service-preparation','Учебная подготовка')) expected(id,name)
      LEFT JOIN orion_crm.services s ON s.clinic_id='crm-clinic-local' AND s.id=expected.id
      WHERE s.id IS NULL OR s.name IS DISTINCT FROM expected.name
  ) THEN RAISE EXCEPTION 'CRM_CATALOGUE_ORIGINAL_NAMES_CHANGED'; END IF;
  PERFORM 1 FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND clinic_id='crm-clinic-local'
    AND active AND can_read AND can_manage FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_CATALOGUE_OPERATOR_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='orion_crm.tasks'::regclass AND tgname='task_state_guard' AND tgenabled='O') THEN
    RAISE EXCEPTION 'CRM_CATALOGUE_TASK_GUARD_REQUIRED'; END IF;
END $$;
ALTER TABLE orion_crm.audit_entries DROP CONSTRAINT audit_entries_kind_check;
ALTER TABLE orion_crm.audit_entries ADD CONSTRAINT audit_entries_kind_check CHECK(kind IN
  ('snapshot.read','command.replayed','visit.created','visit.transitioned','visit.rescheduled','task.created','task.transitioned',
   'registry.manual_training','catalogue.normalized'));
-- The exclusive lock prevents any concurrent runtime task write. Only this
-- reviewed migration bypasses the stage-only guard to publish a title version.
ALTER TABLE orion_crm.tasks DISABLE TRIGGER task_state_guard;
DO $$
DECLARE actor orion_crm.actor_grants; before_catalogue jsonb; after_catalogue jsonb; changes jsonb:='[]';
  previous orion_crm.tasks; current_task orion_crm.tasks; definition text; before_hash text; after_hash text;
  old_literal text:='Подготовка к тестовому визиту'; new_literal text:='Подготовка к приёму';
BEGIN
  SELECT * INTO STRICT actor FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND clinic_id='crm-clinic-local';
  before_catalogue:=jsonb_build_object('clinic',(SELECT name FROM orion_crm.clinics WHERE id=actor.clinic_id),
    'staff',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id) FROM orion_crm.staff WHERE clinic_id=actor.clinic_id),
    'services',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id) FROM orion_crm.services WHERE clinic_id=actor.clinic_id));
  UPDATE orion_crm.clinics SET name='ORION Clinic' WHERE id=actor.clinic_id;
  UPDATE orion_crm.staff s SET name=normal.name FROM (VALUES ('staff-registrar','Алия'),('staff-doctor-a','Мария'),
    ('staff-doctor-b','Данияр'),('staff-diagnostics','София'),('staff-nurse','Айгерим'),('staff-support','Арман')) normal(id,name)
    WHERE s.clinic_id=actor.clinic_id AND s.id=normal.id;
  UPDATE orion_crm.services s SET name=normal.name FROM (VALUES ('service-consultation','Консультация'),
    ('service-diagnostics','Диагностика'),('service-preparation','Подготовка')) normal(id,name)
    WHERE s.clinic_id=actor.clinic_id AND s.id=normal.id;
  FOR previous IN SELECT t.* FROM orion_crm.tasks t WHERE t.clinic_id=actor.clinic_id AND
    t.title IN ('Подготовка к тестовому визиту','Подготовка тестового визита','Проверка готовности тестового визита') AND EXISTS(
      SELECT 1 FROM orion_crm.audit_entries e WHERE e.clinic_id=t.clinic_id AND e.task_id=t.id AND e.kind='task.created' AND
      ((t.title IN ('Подготовка тестового визита','Проверка готовности тестового визита') AND
        e.command_key IS NULL AND e.actor_grant_id IS NULL AND e.payload->>'source'='explicit_synthetic_seed') OR
       (t.title='Подготовка к тестовому визиту' AND EXISTS(SELECT 1 FROM orion_crm.command_receipts r
         WHERE r.clinic_id=e.clinic_id AND r.actor_grant_id=e.actor_grant_id AND r.idempotency_key=e.command_key AND r.result->>'resourceId'=t.visit_id))))
    ORDER BY t.id
  LOOP
    UPDATE orion_crm.tasks SET title=CASE WHEN previous.title='Проверка готовности тестового визита' THEN 'Проверка готовности к приёму' ELSE new_literal END,
      version=version+1,updated_at=greatest(updated_at,clock_timestamp()) WHERE clinic_id=previous.clinic_id AND id=previous.id RETURNING * INTO current_task;
    INSERT INTO orion_crm.task_versions VALUES(current_task.clinic_id,current_task.id,current_task.version,current_task.status,to_jsonb(current_task),current_task.updated_at);
    changes:=changes||jsonb_build_array(jsonb_build_object('taskId',previous.id,'priorVersion',previous.version,'currentVersion',current_task.version,
      'priorTitle',previous.title,'currentTitle',current_task.title,'status',current_task.status));
  END LOOP;
  definition:=pg_get_functiondef('orion_crm.command_core_v1(text,text,jsonb)'::regprocedure);
  IF (length(definition)-length(replace(definition,old_literal,'')))/length(old_literal)<>1 THEN
    RAISE EXCEPTION 'CRM_CATALOGUE_PREP_TEMPLATE_CHANGED'; END IF;
  before_hash:=encode(sha256(convert_to(definition,'UTF8')),'hex');
  definition:=replace(definition,old_literal,new_literal);
  EXECUTE definition;
  after_hash:=encode(sha256(convert_to(pg_get_functiondef('orion_crm.command_core_v1(text,text,jsonb)'::regprocedure),'UTF8')),'hex');
  after_catalogue:=jsonb_build_object('clinic',(SELECT name FROM orion_crm.clinics WHERE id=actor.clinic_id),
    'staff',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id) FROM orion_crm.staff WHERE clinic_id=actor.clinic_id),
    'services',(SELECT jsonb_agg(jsonb_build_object('id',id,'name',name) ORDER BY id) FROM orion_crm.services WHERE clinic_id=actor.clinic_id));
  PERFORM orion_crm.append_audit(actor.clinic_id,actor.id,actor.label,'catalogue.normalized',NULL,NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('batch','catalogue-display-names-v1','purpose','display_names_only','priorCatalogue',before_catalogue,
      'currentCatalogue',after_catalogue,'taskVersions',changes,'priorTemplateHash',before_hash,'currentTemplateHash',after_hash));
END $$;
-- Flush exact history/audit publication before ALTER TABLE restores the guard.
SET CONSTRAINTS ALL IMMEDIATE;
ALTER TABLE orion_crm.tasks ENABLE TRIGGER task_state_guard;
SET CONSTRAINTS ALL DEFERRED;
DO $$ BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='orion_crm.tasks'::regclass AND tgname='task_state_guard' AND tgenabled='O') THEN
    RAISE EXCEPTION 'CRM_CATALOGUE_TASK_GUARD_NOT_RESTORED'; END IF;
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_crm FROM PUBLIC,orion_crm_app;
COMMIT;
