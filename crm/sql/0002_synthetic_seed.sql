-- Explicit one-time simulation scenario. Not normal startup; never reset/reseed.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM orion_crm.clinics) THEN RAISE EXCEPTION 'CRM_SEED_REQUIRES_EMPTY_NEW_DATABASE'; END IF;
END $$;
INSERT INTO orion_crm.clinics(id,name) VALUES('crm-clinic-local','ORION · тестовая клиника');
INSERT INTO orion_crm.rooms VALUES
  ('crm-clinic-local','room-reception','Регистратура','reception',0,0,5,4),
  ('crm-clinic-local','room-consultation-a','Кабинет 101','consultation',6,0,5,4),
  ('crm-clinic-local','room-consultation-b','Кабинет 102','consultation',12,0,5,4),
  ('crm-clinic-local','room-diagnostics','Диагностика','diagnostics',0,6,5,5),
  ('crm-clinic-local','room-treatment','Процедурная','treatment',6,6,5,5),
  ('crm-clinic-local','room-staff','Комната команды','staff',12,6,5,5);
INSERT INTO orion_crm.staff VALUES
  ('crm-clinic-local','staff-registrar','Тест · Алия','registrar','room-reception'),
  ('crm-clinic-local','staff-doctor-a','Тест · Мария','doctor','room-consultation-a'),
  ('crm-clinic-local','staff-doctor-b','Тест · Данияр','doctor','room-consultation-b'),
  ('crm-clinic-local','staff-diagnostics','Тест · София','doctor','room-diagnostics'),
  ('crm-clinic-local','staff-nurse','Тест · Айгерим','nurse','room-treatment'),
  ('crm-clinic-local','staff-support','Тест · Арман','support','room-staff');
INSERT INTO orion_crm.services VALUES
  ('crm-clinic-local','service-consultation','Учебная консультация',30,'consultation'),
  ('crm-clinic-local','service-diagnostics','Учебная диагностика',20,'diagnostics'),
  ('crm-clinic-local','service-preparation','Учебная подготовка',15,'treatment');
INSERT INTO orion_crm.patients(clinic_id,id,name,mrn,sex)
SELECT 'crm-clinic-local','patient-test-'||i,'Тестовый пациент '||lpad(i::text,2,'0'),
  'CRM-TEST-'||lpad(i::text,4,'0'),CASE WHEN i%3=0 THEN 'unknown' WHEN i%2=0 THEN 'female' ELSE 'male' END
FROM generate_series(1,12) i;

DO $$ DECLARE c text:='crm-clinic-local'; observed timestamptz:=clock_timestamp();
  v orion_crm.visits; t orion_crm.tasks; i integer; worker text; room text; service text; state text;
BEGIN
  FOR i IN 1..8 LOOP
    worker:=CASE WHEN i IN (3,7) THEN 'staff-doctor-b' WHEN i IN (4,8) THEN 'staff-diagnostics' ELSE 'staff-doctor-a' END;
    room:=CASE worker WHEN 'staff-doctor-b' THEN 'room-consultation-b' WHEN 'staff-diagnostics' THEN 'room-diagnostics' ELSE 'room-consultation-a' END;
    service:=CASE worker WHEN 'staff-diagnostics' THEN 'service-diagnostics' ELSE 'service-consultation' END;
    state:=CASE i WHEN 1 THEN 'queued' WHEN 2 THEN 'in_service' WHEN 3 THEN 'arrived' WHEN 4 THEN 'queued' WHEN 5 THEN 'completed' ELSE 'scheduled' END;
    INSERT INTO orion_crm.visits VALUES(c,'visit-test-'||i,'patient-test-'||i,worker,room,service,
      date_trunc('minute',observed)+(i-3)*interval '20 minutes',state,1,observed) RETURNING * INTO v;
    INSERT INTO orion_crm.visit_versions VALUES(c,v.id,1,v.status,to_jsonb(v),observed);
    PERFORM orion_crm.append_audit(c,NULL,'Тестовый сценарий','visit.created',v.id,NULL,1,NULL,v.status,NULL,
      jsonb_build_object('source','explicit_synthetic_seed','snapshot',to_jsonb(v)));
    INSERT INTO orion_crm.tasks VALUES(c,'task-test-'||i,v.id,v.patient_id,'staff-nurse',
      CASE WHEN i%2=0 THEN 'follow_up' ELSE 'preparation' END,
      CASE WHEN i%2=0 THEN 'Проверка готовности тестового визита' ELSE 'Подготовка тестового визита' END,
      CASE WHEN i=1 THEN 'urgent' ELSE 'routine' END,v.scheduled_at,
      CASE WHEN i=5 THEN 'completed' WHEN i=2 THEN 'in_progress' ELSE 'pending' END,1,observed) RETURNING * INTO t;
    INSERT INTO orion_crm.task_versions VALUES(c,t.id,1,t.status,to_jsonb(t),observed);
    PERFORM orion_crm.append_audit(c,NULL,'Тестовый сценарий','task.created',NULL,t.id,1,NULL,t.status,NULL,
      jsonb_build_object('source','explicit_synthetic_seed','snapshot',to_jsonb(t)));
  END LOOP;
END $$;
COMMIT;
