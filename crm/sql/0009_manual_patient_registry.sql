-- Twenty explicitly hand-authored fictional TRAINING profiles, never real care.
-- No random names, phones, IINs, diagnoses, old D1, cloud or credential changes.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
-- Validate the complete original patient scope BEFORE any schema/data changes.
DO $$
DECLARE actor orion_crm.actor_grants;
BEGIN
  -- Hold the existing patient table against inserts/edits until commit. Checking
  -- rows first and obtaining the later FK/schema lock could overwrite a racing edit.
  LOCK TABLE orion_crm.patients IN SHARE ROW EXCLUSIVE MODE;
  PERFORM 1 FROM orion_crm.clinics WHERE id='crm-clinic-local' AND active AND mode='synthetic_simulation' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_MANUAL_REGISTRY_CLINIC_REQUIRED'; END IF;
  SELECT * INTO actor FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND clinic_id='crm-clinic-local'
    AND active AND can_read AND can_manage FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_MANUAL_REGISTRY_OPERATOR_REQUIRED'; END IF;
  IF (SELECT count(*) FROM orion_crm.patients WHERE clinic_id='crm-clinic-local')<>12 OR EXISTS(
    SELECT 1 FROM (VALUES
      ('patient-test-1','Тестовый пациент 01','CRM-TEST-0001','male'),
      ('patient-test-2','Тестовый пациент 02','CRM-TEST-0002','female'),
      ('patient-test-3','Тестовый пациент 03','CRM-TEST-0003','unknown'),
      ('patient-test-4','Тестовый пациент 04','CRM-TEST-0004','female'),
      ('patient-test-5','Тестовый пациент 05','CRM-TEST-0005','male'),
      ('patient-test-6','Тестовый пациент 06','CRM-TEST-0006','unknown'),
      ('patient-test-7','Тестовый пациент 07','CRM-TEST-0007','male'),
      ('patient-test-8','Тестовый пациент 08','CRM-TEST-0008','female'),
      ('patient-test-9','Тестовый пациент 09','CRM-TEST-0009','unknown'),
      ('patient-test-10','Тестовый пациент 10','CRM-TEST-0010','female'),
      ('patient-test-11','Тестовый пациент 11','CRM-TEST-0011','male'),
      ('patient-test-12','Тестовый пациент 12','CRM-TEST-0012','unknown')
    ) expected(id,name,mrn,sex) LEFT JOIN orion_crm.patients p ON p.clinic_id='crm-clinic-local' AND p.id=expected.id
    WHERE p.id IS NULL OR p.name IS DISTINCT FROM expected.name OR p.mrn IS DISTINCT FROM expected.mrn OR p.sex IS DISTINCT FROM expected.sex
  ) THEN RAISE EXCEPTION 'CRM_MANUAL_REGISTRY_ORIGINAL_PROFILES_CHANGED'; END IF;
END $$;

ALTER TABLE orion_crm.patients DROP CONSTRAINT patients_mrn_check;
ALTER TABLE orion_crm.patients ADD CONSTRAINT patients_mrn_check CHECK(mrn LIKE 'CRM-TEST-%' OR mrn ~ '^CRM-[0-9]{4}$');
CREATE TABLE orion_crm.patient_registry_history (
  clinic_id text NOT NULL, patient_id text NOT NULL, version integer NOT NULL CHECK(version>0),
  previous_version integer, name text NOT NULL CHECK(length(name) BETWEEN 2 AND 160),
  mrn text NOT NULL CHECK(mrn LIKE 'CRM-TEST-%' OR mrn ~ '^CRM-[0-9]{4}$'), sex text NOT NULL CHECK(sex IN ('female','male','unknown')),
  birth_date date CHECK(birth_date>='1900-01-01' AND birth_date<=current_date-interval '18 years'),
  source text NOT NULL CHECK(source IN ('synthetic_seed_capture','manual_training')),
  batch_id text NOT NULL CHECK(length(batch_id) BETWEEN 1 AND 160),
  actor_grant_id text NOT NULL, recorded_at timestamptz NOT NULL, provenance jsonb NOT NULL CHECK(jsonb_typeof(provenance)='object'),
  PRIMARY KEY(clinic_id,patient_id,version),
  FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_crm.patients(clinic_id,id),
  FOREIGN KEY(clinic_id,patient_id,previous_version) REFERENCES orion_crm.patient_registry_history(clinic_id,patient_id,version),
  FOREIGN KEY(clinic_id,actor_grant_id) REFERENCES orion_crm.actor_grants(clinic_id,id),
  CHECK((version=1 AND previous_version IS NULL) OR (version>1 AND previous_version IS NOT NULL AND previous_version=version-1)),
  CHECK(source<>'manual_training' OR birth_date IS NOT NULL)
);
ALTER TABLE orion_crm.patient_registry_history ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable_registry_history BEFORE UPDATE OR DELETE ON orion_crm.patient_registry_history
  FOR EACH ROW EXECUTE FUNCTION orion_crm.reject_mutation();
CREATE FUNCTION orion_crm.registry_version_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE predecessor integer; record_mrn text;
BEGIN
  PERFORM 1 FROM orion_crm.clinics WHERE id=NEW.clinic_id FOR UPDATE;
  SELECT coalesce(max(version),0) INTO predecessor FROM orion_crm.patient_registry_history WHERE clinic_id=NEW.clinic_id AND patient_id=NEW.patient_id;
  SELECT mrn INTO record_mrn FROM orion_crm.patients WHERE clinic_id=NEW.clinic_id AND id=NEW.patient_id FOR SHARE;
  IF NEW.version<>predecessor+1 OR NEW.previous_version IS DISTINCT FROM (CASE WHEN predecessor=0 THEN NULL ELSE predecessor END) OR
    NEW.mrn IS DISTINCT FROM record_mrn THEN RAISE EXCEPTION 'CRM_REGISTRY_VERSION_INVALID' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registry_version_guard BEFORE INSERT ON orion_crm.patient_registry_history
  FOR EACH ROW EXECUTE FUNCTION orion_crm.registry_version_guard_v1();

ALTER TABLE orion_crm.audit_entries DROP CONSTRAINT audit_entries_kind_check;
ALTER TABLE orion_crm.audit_entries ADD CONSTRAINT audit_entries_kind_check CHECK(kind IN
  ('snapshot.read','command.replayed','visit.created','visit.transitioned','visit.rescheduled','task.created','task.transitioned','registry.manual_training'));

DO $$
DECLARE actor orion_crm.actor_grants; planned_day date; initial_visits jsonb; initial_tasks jsonb;
  old_visit_ids text[]; old_task_ids text[]; profile record; booking record; result jsonb;
  batch text:='manual-training-registry-2026-10-06-v1';
BEGIN
  SELECT * INTO STRICT actor FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND clinic_id='crm-clinic-local';
  SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]'),array_agg(v.id) INTO initial_visits,old_visit_ids FROM orion_crm.visits v WHERE clinic_id=actor.clinic_id;
  SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]'),array_agg(t.id) INTO initial_tasks,old_task_ids FROM orion_crm.tasks t WHERE clinic_id=actor.clinic_id;
  -- These records describe a capture NOW. They do not invent an original DOB
  -- or claim that today's capture timestamp was a historical registration.
  INSERT INTO orion_crm.patient_registry_history
    SELECT p.clinic_id,p.id,1,NULL,p.name,p.mrn,p.sex,NULL,'synthetic_seed_capture',batch,actor.id,clock_timestamp(),
      jsonb_build_object('capturedBeforeBatch',batch,'originalSource','0002_synthetic_seed.sql','birthDatePreviouslyRecorded',false)
    FROM orion_crm.patients p WHERE p.clinic_id=actor.clinic_id;
  FOR profile IN SELECT * FROM (VALUES
    ('patient-test-1','Ерлан Нурланович Садыков','CRM-0001','male','1984-05-12'::date),
    ('patient-test-2','Алия Сериковна Омарова','CRM-0002','female','1990-09-23'::date),
    ('patient-test-3','Дмитрий Андреевич Волков','CRM-0003','male','1978-03-04'::date),
    ('patient-test-4','Айгерим Ермековна Касымова','CRM-0004','female','1994-11-18'::date),
    ('patient-test-5','Сергей Викторович Петров','CRM-0005','male','1982-07-30'::date),
    ('patient-test-6','Жанна Маратовна Ибраева','CRM-0006','female','1988-01-15'::date),
    ('patient-test-7','Арман Бекенович Тлеубаев','CRM-0007','male','1997-06-08'::date),
    ('patient-test-8','Елена Павловна Соколова','CRM-0008','female','1975-12-02'::date),
    ('patient-test-9','Данияр Русланович Ахметов','CRM-0009','male','1992-04-21'::date),
    ('patient-test-10','Ольга Николаевна Кузнецова','CRM-0010','female','1969-10-16'::date),
    ('patient-test-11','Тимур Асхатович Исмаилов','CRM-0011','male','1986-08-09'::date),
    ('patient-test-12','Мадина Болатовна Сейткалиева','CRM-0012','female','1999-02-27'::date),
    ('patient-test-13','Алексей Игоревич Морозов','CRM-0013','male','1987-03-19'::date),
    ('patient-test-14','Асель Нурлановна Жумабаева','CRM-0014','female','1991-05-06'::date),
    ('patient-test-15','Руслан Ермекович Абдрахманов','CRM-0015','male','1980-12-11'::date),
    ('patient-test-16','Наталья Сергеевна Орлова','CRM-0016','female','1973-08-24'::date),
    ('patient-test-17','Бауыржан Серикович Есенов','CRM-0017','male','1995-01-09'::date),
    ('patient-test-18','Гульмира Кайратовна Смагулова','CRM-0018','female','1989-06-17'::date),
    ('patient-test-19','Андрей Михайлович Крылов','CRM-0019','male','1965-09-14'::date),
    ('patient-test-20','Диана Тимуровна Нургалиева','CRM-0020','female','2000-04-03'::date)
  ) manual(id,name,mrn,sex,birth_date) LOOP
    IF NOT EXISTS(SELECT 1 FROM orion_crm.patients WHERE clinic_id=actor.clinic_id AND id=profile.id) THEN
      INSERT INTO orion_crm.patients VALUES(actor.clinic_id,profile.id,profile.name,profile.mrn,profile.sex);
    END IF;
    UPDATE orion_crm.patients SET name=profile.name,mrn=profile.mrn,sex=profile.sex WHERE clinic_id=actor.clinic_id AND id=profile.id;
    INSERT INTO orion_crm.patient_registry_history VALUES(actor.clinic_id,profile.id,
      CASE WHEN EXISTS(SELECT 1 FROM orion_crm.patient_registry_history WHERE clinic_id=actor.clinic_id AND patient_id=profile.id) THEN 2 ELSE 1 END,
      CASE WHEN EXISTS(SELECT 1 FROM orion_crm.patient_registry_history WHERE clinic_id=actor.clinic_id AND patient_id=profile.id) THEN 1 ELSE NULL END,
      profile.name,profile.mrn,profile.sex,profile.birth_date,'manual_training',batch,actor.id,clock_timestamp(),
      jsonb_build_object('source','manual_training','fictional',true,'batch',batch,'medicalDataImported',false));
  END LOOP;
  -- Eight calendar days keeps the morning slots at least seven full days
  -- ahead even when this migration runs late in the current clinic day.
  planned_day:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date+8;
  WHILE extract(isodow FROM planned_day)::integer NOT IN (1,2,3,4,5) LOOP planned_day:=planned_day+1; END LOOP;
  FOR booking IN SELECT * FROM (VALUES
    ('patient-test-13','staff-doctor-a','room-consultation-a','service-consultation','09:00'::time,'00900000-0000-4000-8000-000000000013'::uuid),
    ('patient-test-14','staff-doctor-a','room-consultation-a','service-consultation','09:40'::time,'00900000-0000-4000-8000-000000000014'::uuid),
    ('patient-test-15','staff-doctor-b','room-consultation-b','service-consultation','09:00'::time,'00900000-0000-4000-8000-000000000015'::uuid),
    ('patient-test-16','staff-doctor-b','room-consultation-b','service-consultation','09:40'::time,'00900000-0000-4000-8000-000000000016'::uuid),
    ('patient-test-17','staff-diagnostics','room-diagnostics','service-diagnostics','10:00'::time,'00900000-0000-4000-8000-000000000017'::uuid),
    ('patient-test-18','staff-diagnostics','room-diagnostics','service-diagnostics','10:30'::time,'00900000-0000-4000-8000-000000000018'::uuid),
    ('patient-test-19','staff-nurse','room-treatment','service-preparation','11:00'::time,'00900000-0000-4000-8000-000000000019'::uuid),
    ('patient-test-20','staff-nurse','room-treatment','service-preparation','11:30'::time,'00900000-0000-4000-8000-000000000020'::uuid)
  ) planned(patient_id,staff_id,room_id,service_id,local_time,command_key) LOOP
    result:=public.orion_crm_command_v1(actor.issuer,actor.subject,jsonb_build_object('type','visit.create',
      'patientId',booking.patient_id,'staffId',booking.staff_id,'roomId',booking.room_id,'serviceId',booking.service_id,
      'scheduledAt',orion_crm.iso((planned_day+booking.local_time) AT TIME ZONE 'Asia/Qyzylorda'),
      'testDataAcknowledged',true,'idempotencyKey',booking.command_key));
    IF (result->>'replayed')::boolean THEN RAISE EXCEPTION 'CRM_MANUAL_REGISTRY_BOOKING_KEY_ALREADY_USED'; END IF;
  END LOOP;
  IF (SELECT count(*) FROM orion_crm.patients WHERE clinic_id=actor.clinic_id)<>20 OR
    (SELECT coalesce(jsonb_agg(to_jsonb(v) ORDER BY v.id),'[]') FROM orion_crm.visits v WHERE clinic_id=actor.clinic_id AND id=ANY(old_visit_ids)) IS DISTINCT FROM initial_visits OR
    (SELECT coalesce(jsonb_agg(to_jsonb(t) ORDER BY t.id),'[]') FROM orion_crm.tasks t WHERE clinic_id=actor.clinic_id AND id=ANY(old_task_ids)) IS DISTINCT FROM initial_tasks THEN
    RAISE EXCEPTION 'CRM_MANUAL_REGISTRY_PUBLICATION_INVALID'; END IF;
  PERFORM orion_crm.append_audit(actor.clinic_id,actor.id,actor.label,'registry.manual_training',NULL,NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('batch',batch,'source','manual_training','fictional',true,'patients',20,'capturedPriorProfiles',12,'newCards',8,'newBookings',8));
END $$;

CREATE FUNCTION orion_crm.registered_patient_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE profile orion_crm.patient_registry_history;
BEGIN
  SELECT * INTO profile FROM orion_crm.patient_registry_history WHERE clinic_id=OLD.clinic_id AND patient_id=OLD.id ORDER BY version DESC LIMIT 1;
  IF FOUND AND (TG_OP='DELETE' OR NEW.id IS DISTINCT FROM OLD.id OR NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR
    NEW.mrn IS DISTINCT FROM profile.mrn OR NEW.name IS DISTINCT FROM profile.name OR NEW.sex IS DISTINCT FROM profile.sex) THEN
    RAISE EXCEPTION 'CRM_REGISTRY_PUBLICATION_INVALID' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER registered_patient_guard BEFORE UPDATE OR DELETE ON orion_crm.patients FOR EACH ROW EXECUTE FUNCTION orion_crm.registered_patient_guard_v1();
CREATE FUNCTION orion_crm.registry_commit_guard_v1() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE profile orion_crm.patient_registry_history; patient orion_crm.patients;
BEGIN
  SELECT * INTO profile FROM orion_crm.patient_registry_history WHERE clinic_id=NEW.clinic_id AND patient_id=NEW.patient_id ORDER BY version DESC LIMIT 1;
  SELECT * INTO patient FROM orion_crm.patients WHERE clinic_id=NEW.clinic_id AND id=NEW.patient_id;
  IF patient.id IS NULL OR ROW(patient.name,patient.mrn,patient.sex) IS DISTINCT FROM ROW(profile.name,profile.mrn,profile.sex) THEN
    RAISE EXCEPTION 'CRM_REGISTRY_PUBLICATION_INVALID' USING ERRCODE='PT409'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER registry_commit_guard AFTER INSERT ON orion_crm.patient_registry_history
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orion_crm.registry_commit_guard_v1();

ALTER FUNCTION public.orion_crm_snapshot_v1(text,text) SET SCHEMA orion_crm;
ALTER FUNCTION orion_crm.orion_crm_snapshot_v1(text,text) RENAME TO snapshot_scheduling_v3;
REVOKE ALL ON FUNCTION orion_crm.snapshot_scheduling_v3(text,text) FROM PUBLIC,orion_crm_app;
CREATE FUNCTION public.orion_crm_snapshot_v1(p_issuer text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor orion_crm.actor_grants:=orion_crm.require_actor(p_issuer,p_subject,false); answer jsonb; patients jsonb;
BEGIN
  IF EXISTS(SELECT 1 FROM orion_crm.patients p JOIN LATERAL(SELECT * FROM orion_crm.patient_registry_history h
    WHERE h.clinic_id=p.clinic_id AND h.patient_id=p.id ORDER BY version DESC LIMIT 1) h ON true
    WHERE p.clinic_id=actor.clinic_id AND ROW(p.name,p.mrn,p.sex) IS DISTINCT FROM ROW(h.name,h.mrn,h.sex)) THEN
    RAISE EXCEPTION 'CRM_REGISTRY_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  answer:=orion_crm.snapshot_scheduling_v3(p_issuer,p_subject);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'mrn',p.mrn,'sex',p.sex)||
    CASE WHEN h.source='manual_training' THEN jsonb_build_object('birthDate',to_char(h.birth_date,'YYYY-MM-DD'),'registrationSource','manual_training') ELSE '{}'::jsonb END ORDER BY p.id),'[]')
    INTO patients FROM orion_crm.patients p LEFT JOIN LATERAL(SELECT * FROM orion_crm.patient_registry_history h
      WHERE h.clinic_id=p.clinic_id AND h.patient_id=p.id ORDER BY version DESC LIMIT 1) h ON true WHERE p.clinic_id=actor.clinic_id;
  answer:=answer||jsonb_build_object('patients',patients);
  IF octet_length(answer::text)>1048576 THEN RAISE EXCEPTION 'CRM_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
  RETURN answer;
END $$;
REVOKE ALL ON TABLE orion_crm.patient_registry_history FROM PUBLIC,orion_crm_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_crm FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_crm_snapshot_v1(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_crm_snapshot_v1(text,text) TO orion_crm_app;
COMMIT;
