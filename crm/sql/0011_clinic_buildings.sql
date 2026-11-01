-- A second real persisted CRM building, rooms, assigned roster and catalogue.
-- No existing room/staff/visit assignment is moved and no queue is fabricated.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
LOCK TABLE orion_crm.clinics,orion_crm.rooms,orion_crm.staff,orion_crm.services IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  PERFORM 1 FROM orion_crm.clinics WHERE id='crm-clinic-local' AND active AND mode='synthetic_simulation' AND name='ORION Clinic' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BUILDINGS_CLINIC_REQUIRED'; END IF;
  PERFORM 1 FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND clinic_id='crm-clinic-local' AND active AND can_read AND can_manage FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BUILDINGS_OPERATOR_REQUIRED'; END IF;
  IF (SELECT count(*) FROM orion_crm.rooms WHERE clinic_id='crm-clinic-local')<>6 OR EXISTS(
    SELECT 1 FROM (VALUES
      ('room-reception','Регистратура','reception',0,0,5,4),
      ('room-consultation-a','Кабинет 101','consultation',6,0,5,4),
      ('room-consultation-b','Кабинет 102','consultation',12,0,5,4),
      ('room-diagnostics','Диагностика','diagnostics',0,6,5,5),
      ('room-treatment','Процедурная','treatment',6,6,5,5),
      ('room-staff','Комната команды','staff',12,6,5,5)) expected(id,name,kind,x,y,width,depth)
      LEFT JOIN orion_crm.rooms r ON r.clinic_id='crm-clinic-local' AND r.id=expected.id
    WHERE r.id IS NULL OR ROW(r.name,r.kind,r.x,r.y,r.width,r.depth) IS DISTINCT FROM
      ROW(expected.name,expected.kind,expected.x,expected.y,expected.width,expected.depth)
  ) THEN RAISE EXCEPTION 'CRM_BUILDINGS_ORIGINAL_ROOMS_CHANGED'; END IF;
  IF EXISTS(SELECT 1 FROM orion_crm.staff WHERE clinic_id='crm-clinic-local' AND id IN
    ('staff-doctor-c','staff-doctor-d','staff-doctor-e','staff-nurse-b','staff-diagnostics-b','staff-support-b')) OR
    EXISTS(SELECT 1 FROM orion_crm.services WHERE clinic_id='crm-clinic-local' AND id IN
      ('service-ultrasound','service-blood-draw','service-follow-up')) THEN RAISE EXCEPTION 'CRM_BUILDINGS_NEW_IDS_ALREADY_USED'; END IF;
END $$;
CREATE TABLE orion_crm.buildings (
  clinic_id text NOT NULL REFERENCES orion_crm.clinics(id), id text NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  x integer NOT NULL CHECK(x BETWEEN 0 AND 100), y integer NOT NULL CHECK(y BETWEEN 0 AND 100),
  width integer NOT NULL CHECK(width BETWEEN 1 AND 100), depth integer NOT NULL CHECK(depth BETWEEN 1 AND 100),
  PRIMARY KEY(clinic_id,id), CHECK(x+width<=100 AND y+depth<=100)
);
CREATE TABLE orion_crm.room_buildings (
  clinic_id text NOT NULL, room_id text NOT NULL, building_id text NOT NULL,
  PRIMARY KEY(clinic_id,room_id), FOREIGN KEY(clinic_id,room_id) REFERENCES orion_crm.rooms(clinic_id,id),
  FOREIGN KEY(clinic_id,building_id) REFERENCES orion_crm.buildings(clinic_id,id)
);
ALTER TABLE orion_crm.buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE orion_crm.room_buildings ENABLE ROW LEVEL SECURITY;
CREATE FUNCTION orion_crm.room_building_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM orion_crm.rooms r JOIN orion_crm.buildings b ON b.clinic_id=r.clinic_id
    WHERE r.clinic_id=NEW.clinic_id AND r.id=NEW.room_id AND b.id=NEW.building_id AND
      r.x>=b.x AND r.y>=b.y AND r.x+r.width<=b.x+b.width AND r.y+r.depth<=b.y+b.depth) THEN
    RAISE EXCEPTION 'CRM_ROOM_BUILDING_INVALID' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER room_building_guard BEFORE INSERT OR UPDATE ON orion_crm.room_buildings FOR EACH ROW EXECUTE FUNCTION orion_crm.room_building_guard_v1();
CREATE TRIGGER immutable_buildings BEFORE UPDATE OR DELETE ON orion_crm.buildings FOR EACH ROW EXECUTE FUNCTION orion_crm.reject_mutation();
CREATE TRIGGER immutable_room_buildings BEFORE UPDATE OR DELETE ON orion_crm.room_buildings FOR EACH ROW EXECUTE FUNCTION orion_crm.reject_mutation();
INSERT INTO orion_crm.buildings VALUES
  ('crm-clinic-local','building-main','Основной корпус',0,0,17,11),
  ('crm-clinic-local','building-outpatient','Корпус Б',28,0,17,11);
INSERT INTO orion_crm.room_buildings SELECT clinic_id,id,'building-main' FROM orion_crm.rooms WHERE clinic_id='crm-clinic-local';
INSERT INTO orion_crm.rooms VALUES
  ('crm-clinic-local','room-consultation-c','Кабинет 103','consultation',28,0,5,4),
  ('crm-clinic-local','room-consultation-d','Кабинет 104','consultation',34,0,5,4),
  ('crm-clinic-local','room-diagnostics-b','УЗИ','diagnostics',40,0,5,4),
  ('crm-clinic-local','room-treatment-b','Забор крови','treatment',28,6,5,5),
  ('crm-clinic-local','room-consultation-e','Кабинет 105','consultation',34,6,5,5),
  ('crm-clinic-local','room-staff-b','Комната команды Б','staff',40,6,5,5);
INSERT INTO orion_crm.room_buildings VALUES
  ('crm-clinic-local','room-consultation-c','building-outpatient'),('crm-clinic-local','room-consultation-d','building-outpatient'),
  ('crm-clinic-local','room-diagnostics-b','building-outpatient'),('crm-clinic-local','room-treatment-b','building-outpatient'),
  ('crm-clinic-local','room-consultation-e','building-outpatient'),('crm-clinic-local','room-staff-b','building-outpatient');
INSERT INTO orion_crm.staff VALUES
  ('crm-clinic-local','staff-doctor-c','Александр','doctor','room-consultation-c'),
  ('crm-clinic-local','staff-doctor-d','Наталья','doctor','room-consultation-d'),
  ('crm-clinic-local','staff-diagnostics-b','Ксения','doctor','room-diagnostics-b'),
  ('crm-clinic-local','staff-nurse-b','Гульмира','nurse','room-treatment-b'),
  ('crm-clinic-local','staff-doctor-e','Руслан','doctor','room-consultation-e'),
  ('crm-clinic-local','staff-support-b','Дамир','support','room-staff-b');
INSERT INTO orion_crm.services VALUES
  ('crm-clinic-local','service-ultrasound','УЗИ',20,'diagnostics'),
  ('crm-clinic-local','service-blood-draw','Забор крови',15,'treatment'),
  ('crm-clinic-local','service-follow-up','Повторная консультация',20,'consultation');
ALTER TABLE orion_crm.audit_entries DROP CONSTRAINT audit_entries_kind_check;
ALTER TABLE orion_crm.audit_entries ADD CONSTRAINT audit_entries_kind_check CHECK(kind IN
  ('snapshot.read','command.replayed','visit.created','visit.transitioned','visit.rescheduled','task.created','task.transitioned',
   'registry.manual_training','catalogue.normalized','buildings.added'));
DO $$ DECLARE actor orion_crm.actor_grants; BEGIN
  SELECT * INTO STRICT actor FROM orion_crm.actor_grants WHERE id='crm-local-operator' AND clinic_id='crm-clinic-local';
  PERFORM orion_crm.append_audit(actor.clinic_id,actor.id,actor.label,'buildings.added',NULL,NULL,NULL,NULL,NULL,NULL,
    jsonb_build_object('batch','second-building-v1','buildings',(SELECT jsonb_agg(to_jsonb(b) ORDER BY id) FROM orion_crm.buildings b WHERE clinic_id=actor.clinic_id),
      'roomMappings',(SELECT jsonb_agg(to_jsonb(m) ORDER BY room_id) FROM orion_crm.room_buildings m WHERE clinic_id=actor.clinic_id),
      'newRooms',(SELECT jsonb_agg(to_jsonb(r) ORDER BY id) FROM orion_crm.rooms r WHERE clinic_id=actor.clinic_id AND id IN
        ('room-consultation-c','room-consultation-d','room-diagnostics-b','room-treatment-b','room-consultation-e','room-staff-b')),
      'newStaff',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM orion_crm.staff s WHERE clinic_id=actor.clinic_id AND id IN
        ('staff-doctor-c','staff-doctor-d','staff-diagnostics-b','staff-nurse-b','staff-doctor-e','staff-support-b')),
      'newServices',(SELECT jsonb_agg(to_jsonb(s) ORDER BY id) FROM orion_crm.services s WHERE clinic_id=actor.clinic_id AND id IN
        ('service-ultrasound','service-blood-draw','service-follow-up')),'existingAssignmentsMoved',false,'visitsCreated',0));
END $$;
ALTER FUNCTION public.orion_crm_snapshot_v1(text,text) SET SCHEMA orion_crm;
ALTER FUNCTION orion_crm.orion_crm_snapshot_v1(text,text) RENAME TO snapshot_registry_v4;
REVOKE ALL ON FUNCTION orion_crm.snapshot_registry_v4(text,text) FROM PUBLIC,orion_crm_app;
CREATE FUNCTION public.orion_crm_snapshot_v1(p_issuer text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor orion_crm.actor_grants:=orion_crm.require_actor(p_issuer,p_subject,false); answer jsonb; buildings jsonb; rooms jsonb;
BEGIN
  answer:=orion_crm.snapshot_registry_v4(p_issuer,p_subject);
  IF NOT EXISTS(SELECT 1 FROM orion_crm.buildings WHERE clinic_id=actor.clinic_id) THEN
    IF actor.clinic_id='crm-clinic-local' OR EXISTS(SELECT 1 FROM orion_crm.room_buildings WHERE clinic_id=actor.clinic_id) THEN
      RAISE EXCEPTION 'CRM_BUILDINGS_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
    RETURN answer; -- Unmapped rollback-only legacy fixture: no optional fields.
  END IF;
  IF EXISTS(SELECT 1 FROM orion_crm.rooms r LEFT JOIN orion_crm.room_buildings m ON m.clinic_id=r.clinic_id AND m.room_id=r.id
    LEFT JOIN orion_crm.buildings b ON b.clinic_id=m.clinic_id AND b.id=m.building_id WHERE r.clinic_id=actor.clinic_id AND
      (b.id IS NULL OR r.x<b.x OR r.y<b.y OR r.x+r.width>b.x+b.width OR r.y+r.depth>b.y+b.depth)) THEN
    RAISE EXCEPTION 'CRM_BUILDINGS_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'x',x,'y',y,'width',width,'depth',depth) ORDER BY id),'[]')
    INTO buildings FROM orion_crm.buildings WHERE clinic_id=actor.clinic_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'kind',r.kind,'x',r.x,'y',r.y,'width',r.width,'depth',r.depth,'buildingId',m.building_id) ORDER BY r.id),'[]')
    INTO rooms FROM orion_crm.rooms r JOIN orion_crm.room_buildings m ON m.clinic_id=r.clinic_id AND m.room_id=r.id WHERE r.clinic_id=actor.clinic_id;
  answer:=answer||jsonb_build_object('buildings',buildings,'rooms',rooms);
  IF octet_length(answer::text)>1048576 THEN RAISE EXCEPTION 'CRM_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
  RETURN answer;
END $$;
REVOKE ALL ON TABLE orion_crm.buildings,orion_crm.room_buildings FROM PUBLIC,orion_crm_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_crm FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_crm_snapshot_v1(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_crm_snapshot_v1(text,text) TO orion_crm_app;
COMMIT;
