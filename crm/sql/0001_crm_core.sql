-- Forward-only, dedicated local simulation database. Never apply to D1/Supabase.
BEGIN;
DO $$ BEGIN
  IF current_database() <> 'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
CREATE SCHEMA orion_crm;
REVOKE ALL ON SCHEMA orion_crm FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_crm REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_crm REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

CREATE TABLE orion_crm.clinics (
  id text PRIMARY KEY, name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  mode text NOT NULL DEFAULT 'synthetic_simulation' CHECK (mode = 'synthetic_simulation'),
  active boolean NOT NULL DEFAULT true,
  audit_sequence integer NOT NULL DEFAULT 0 CHECK (audit_sequence >= 0), audit_hash text
);
CREATE TABLE orion_crm.actor_grants (
  id text PRIMARY KEY, clinic_id text NOT NULL REFERENCES orion_crm.clinics(id),
  issuer text NOT NULL CHECK (length(issuer) BETWEEN 1 AND 256),
  subject text NOT NULL CHECK (length(subject) BETWEEN 1 AND 256),
  label text NOT NULL CHECK (length(label) BETWEEN 1 AND 160),
  can_read boolean NOT NULL DEFAULT true, can_manage boolean NOT NULL DEFAULT false,
  active boolean NOT NULL DEFAULT true, version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE(issuer,subject), UNIQUE(clinic_id,id), CHECK (NOT can_manage OR can_read)
);
CREATE TABLE orion_crm.rooms (
  clinic_id text NOT NULL REFERENCES orion_crm.clinics(id), id text NOT NULL,
  name text NOT NULL CHECK (length(name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK (kind IN ('reception','consultation','diagnostics','treatment','staff')),
  x integer NOT NULL CHECK (x BETWEEN 0 AND 100), y integer NOT NULL CHECK (y BETWEEN 0 AND 100),
  width integer NOT NULL CHECK (width BETWEEN 1 AND 100), depth integer NOT NULL CHECK (depth BETWEEN 1 AND 100),
  PRIMARY KEY(clinic_id,id)
);
CREATE TABLE orion_crm.staff (
  clinic_id text NOT NULL, id text NOT NULL, name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  role text NOT NULL CHECK(role IN ('doctor','nurse','registrar','support')), room_id text NOT NULL,
  PRIMARY KEY(clinic_id,id), FOREIGN KEY(clinic_id,room_id) REFERENCES orion_crm.rooms(clinic_id,id)
);
CREATE TABLE orion_crm.services (
  clinic_id text NOT NULL REFERENCES orion_crm.clinics(id), id text NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 240),
  room_kind text NOT NULL CHECK(room_kind IN ('reception','consultation','diagnostics','treatment','staff')),
  PRIMARY KEY(clinic_id,id)
);
CREATE TABLE orion_crm.patients (
  clinic_id text NOT NULL REFERENCES orion_crm.clinics(id), id text NOT NULL,
  name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160), mrn text NOT NULL CHECK(mrn LIKE 'CRM-TEST-%'),
  sex text NOT NULL CHECK(sex IN ('female','male','unknown')), PRIMARY KEY(clinic_id,id), UNIQUE(clinic_id,mrn)
);
CREATE TABLE orion_crm.visits (
  clinic_id text NOT NULL, id text NOT NULL, patient_id text NOT NULL,
  staff_id text NOT NULL, room_id text NOT NULL, service_id text NOT NULL,
  scheduled_at timestamptz NOT NULL CHECK(scheduled_at >= '2020-01-01' AND scheduled_at < '2100-01-01'),
  status text NOT NULL CHECK(status IN ('scheduled','arrived','queued','in_service','completed','cancelled')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0), updated_at timestamptz NOT NULL,
  PRIMARY KEY(clinic_id,id), UNIQUE(clinic_id,id,patient_id),
  FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_crm.patients(clinic_id,id),
  FOREIGN KEY(clinic_id,staff_id) REFERENCES orion_crm.staff(clinic_id,id),
  FOREIGN KEY(clinic_id,room_id) REFERENCES orion_crm.rooms(clinic_id,id),
  FOREIGN KEY(clinic_id,service_id) REFERENCES orion_crm.services(clinic_id,id)
);
-- Simulation capacity is a stored invariant, not a browser animation decision.
CREATE UNIQUE INDEX one_room_in_service ON orion_crm.visits(clinic_id,room_id) WHERE status='in_service';
CREATE UNIQUE INDEX one_staff_in_service ON orion_crm.visits(clinic_id,staff_id) WHERE status='in_service';
CREATE UNIQUE INDEX one_patient_in_service ON orion_crm.visits(clinic_id,patient_id) WHERE status='in_service';
CREATE TABLE orion_crm.tasks (
  clinic_id text NOT NULL, id text NOT NULL, visit_id text NOT NULL, patient_id text NOT NULL, owner_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('preparation','follow_up','service')),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 240), priority text NOT NULL CHECK(priority IN ('routine','urgent')),
  due_at timestamptz NOT NULL CHECK(due_at >= '2020-01-01' AND due_at < '2100-01-01'),
  status text NOT NULL CHECK(status IN ('pending','in_progress','completed','escalated')),
  version integer NOT NULL DEFAULT 1 CHECK(version > 0), updated_at timestamptz NOT NULL,
  PRIMARY KEY(clinic_id,id),
  FOREIGN KEY(clinic_id,visit_id,patient_id) REFERENCES orion_crm.visits(clinic_id,id,patient_id),
  FOREIGN KEY(clinic_id,owner_id) REFERENCES orion_crm.staff(clinic_id,id)
);
CREATE TABLE orion_crm.visit_versions (
  clinic_id text NOT NULL, visit_id text NOT NULL, version integer NOT NULL CHECK(version>0),
  status text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(clinic_id,visit_id,version), FOREIGN KEY(clinic_id,visit_id) REFERENCES orion_crm.visits(clinic_id,id)
);
CREATE TABLE orion_crm.task_versions (
  clinic_id text NOT NULL, task_id text NOT NULL, version integer NOT NULL CHECK(version>0),
  status text NOT NULL, snapshot jsonb NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(clinic_id,task_id,version), FOREIGN KEY(clinic_id,task_id) REFERENCES orion_crm.tasks(clinic_id,id)
);
CREATE TABLE orion_crm.audit_entries (
  id text PRIMARY KEY, clinic_id text NOT NULL REFERENCES orion_crm.clinics(id), sequence integer NOT NULL CHECK(sequence>0),
  actor_grant_id text, actor_label text NOT NULL, kind text NOT NULL CHECK(kind IN
    ('snapshot.read','command.replayed','visit.created','visit.transitioned','task.created','task.transitioned')),
  visit_id text, task_id text, resource_version integer, from_status text, to_status text,
  command_key uuid, payload jsonb NOT NULL, created_at timestamptz NOT NULL,
  previous_hash text, event_hash text NOT NULL CHECK(event_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE(clinic_id,sequence), UNIQUE(clinic_id,id),
  FOREIGN KEY(clinic_id,actor_grant_id) REFERENCES orion_crm.actor_grants(clinic_id,id),
  FOREIGN KEY(clinic_id,visit_id,resource_version) REFERENCES orion_crm.visit_versions(clinic_id,visit_id,version),
  FOREIGN KEY(clinic_id,task_id,resource_version) REFERENCES orion_crm.task_versions(clinic_id,task_id,version),
  CHECK(visit_id IS NULL OR task_id IS NULL),
  CHECK((sequence=1 AND previous_hash IS NULL) OR (sequence>1 AND previous_hash ~ '^[a-f0-9]{64}$'))
);
CREATE TABLE orion_crm.command_receipts (
  clinic_id text NOT NULL, actor_grant_id text NOT NULL, idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  result jsonb NOT NULL, audit_id text NOT NULL, created_at timestamptz NOT NULL,
  PRIMARY KEY(clinic_id,actor_grant_id,idempotency_key),
  FOREIGN KEY(clinic_id,actor_grant_id) REFERENCES orion_crm.actor_grants(clinic_id,id),
  FOREIGN KEY(clinic_id,audit_id) REFERENCES orion_crm.audit_entries(clinic_id,id)
);

CREATE FUNCTION orion_crm.reject_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'CRM_IMMUTABLE_HISTORY' USING ERRCODE='PT409'; END $$;
CREATE FUNCTION orion_crm.state_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_DELETE_FORBIDDEN' USING ERRCODE='PT409'; END IF;
  IF TG_TABLE_NAME='visits' THEN
    IF (to_jsonb(NEW)-ARRAY['status','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','version','updated_at']) THEN
      RAISE EXCEPTION 'CRM_IMMUTABLE_RELATION' USING ERRCODE='PT409'; END IF;
    allowed:= (OLD.status='scheduled' AND NEW.status IN ('arrived','cancelled')) OR
      (OLD.status='arrived' AND NEW.status IN ('queued','cancelled')) OR
      (OLD.status='queued' AND NEW.status IN ('in_service','cancelled')) OR
      (OLD.status='in_service' AND NEW.status='completed');
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','priority','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','priority','version','updated_at']) THEN
      RAISE EXCEPTION 'CRM_IMMUTABLE_RELATION' USING ERRCODE='PT409'; END IF;
    allowed:= (OLD.status='pending' AND NEW.status IN ('in_progress','escalated')) OR
      (OLD.status='in_progress' AND NEW.status IN ('completed','escalated'));
    IF NEW.priority IS DISTINCT FROM OLD.priority AND NOT (NEW.status='escalated' AND NEW.priority='urgent') THEN
      RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
  END IF;
  IF NOT allowed OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_state_guard BEFORE UPDATE OR DELETE ON orion_crm.visits FOR EACH ROW EXECUTE FUNCTION orion_crm.state_guard();
CREATE TRIGGER task_state_guard BEFORE UPDATE OR DELETE ON orion_crm.tasks FOR EACH ROW EXECUTE FUNCTION orion_crm.state_guard();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['visit_versions','task_versions','audit_entries','command_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON orion_crm.%I FOR EACH ROW EXECUTE FUNCTION orion_crm.reject_mutation()',t);
  END LOOP;
END $$;

CREATE FUNCTION orion_crm.require_actor(p_issuer text,p_subject text,p_manage boolean) RETURNS orion_crm.actor_grants
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE a orion_crm.actor_grants;
BEGIN
  SELECT * INTO a FROM orion_crm.actor_grants WHERE issuer=p_issuer AND subject=p_subject FOR SHARE;
  IF NOT FOUND OR NOT a.active OR NOT a.can_read OR (p_manage AND NOT a.can_manage) THEN
    RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  PERFORM 1 FROM orion_crm.clinics WHERE id=a.clinic_id AND active AND mode='synthetic_simulation' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  RETURN a;
END $$;
CREATE FUNCTION orion_crm.iso(p_time timestamptz) RETURNS text LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT to_char(p_time AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
$$;
CREATE FUNCTION orion_crm.append_audit(p_clinic text,p_actor text,p_label text,p_kind text,
  p_visit text,p_task text,p_version integer,p_from text,p_to text,p_key uuid,p_payload jsonb) RETURNS text
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE c orion_crm.clinics; e orion_crm.audit_entries; canonical jsonb;
BEGIN
  SELECT * INTO STRICT c FROM orion_crm.clinics WHERE id=p_clinic FOR UPDATE;
  e.id:='event-'||gen_random_uuid()::text; e.clinic_id:=p_clinic; e.sequence:=c.audit_sequence+1;
  e.actor_grant_id:=p_actor; e.actor_label:=p_label; e.kind:=p_kind; e.visit_id:=p_visit; e.task_id:=p_task;
  e.resource_version:=p_version; e.from_status:=p_from; e.to_status:=p_to; e.command_key:=p_key;
  e.payload:=p_payload; e.created_at:=clock_timestamp(); e.previous_hash:=c.audit_hash;
  canonical:=to_jsonb(e)-'event_hash';
  e.event_hash:=encode(sha256(convert_to(canonical::text,'UTF8')),'hex');
  INSERT INTO orion_crm.audit_entries SELECT e.*;
  UPDATE orion_crm.clinics SET audit_sequence=e.sequence,audit_hash=e.event_hash WHERE id=c.id;
  RETURN e.id;
END $$;

CREATE FUNCTION public.orion_crm_snapshot_v1(p_issuer text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_crm.actor_grants:=orion_crm.require_actor(p_issuer,p_subject,false); answer jsonb;
BEGIN
  IF (SELECT count(*) FROM orion_crm.rooms WHERE clinic_id=a.clinic_id)>100 OR
    (SELECT count(*) FROM orion_crm.staff WHERE clinic_id=a.clinic_id)>200 OR
    (SELECT count(*) FROM orion_crm.services WHERE clinic_id=a.clinic_id)>200 OR
    (SELECT count(*) FROM orion_crm.patients WHERE clinic_id=a.clinic_id)>1000 OR
    (SELECT count(*) FROM orion_crm.visits WHERE clinic_id=a.clinic_id)>1000 OR
    (SELECT count(*) FROM orion_crm.tasks WHERE clinic_id=a.clinic_id)>2000 THEN
    RAISE EXCEPTION 'CRM_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
  SELECT jsonb_build_object('schemaVersion',1,'mode','synthetic_simulation',
    'clinic',jsonb_build_object('id',c.id,'name',c.name),'generatedAt',orion_crm.iso(clock_timestamp()),
    'capabilities',jsonb_build_object('read',true,'manage',a.can_manage),
    'rooms',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'kind',kind,'x',x,'y',y,'width',width,'depth',depth) ORDER BY id),'[]') FROM orion_crm.rooms WHERE clinic_id=c.id),
    'staff',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,'roomId',room_id) ORDER BY id),'[]') FROM orion_crm.staff WHERE clinic_id=c.id),
    'services',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'durationMinutes',duration_minutes,'roomKind',room_kind) ORDER BY id),'[]') FROM orion_crm.services WHERE clinic_id=c.id),
    'patients',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'mrn',mrn,'sex',sex) ORDER BY id),'[]') FROM orion_crm.patients WHERE clinic_id=c.id),
    'visits',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'patientId',patient_id,'staffId',staff_id,'roomId',room_id,'serviceId',service_id,'scheduledAt',orion_crm.iso(scheduled_at),'status',status,'version',version,'updatedAt',orion_crm.iso(updated_at)) ORDER BY scheduled_at,id),'[]') FROM orion_crm.visits WHERE clinic_id=c.id),
    'tasks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'visitId',visit_id,'patientId',patient_id,'ownerId',owner_id,'kind',kind,'title',title,'priority',priority,'dueAt',orion_crm.iso(due_at),'status',status,'version',version) ORDER BY due_at,id),'[]') FROM orion_crm.tasks WHERE clinic_id=c.id),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'resourceId',coalesce(e.visit_id,e.task_id),'kind',e.kind,'actorLabel',e.actor_label,'createdAt',orion_crm.iso(e.created_at),'fromStatus',e.from_status,'toStatus',e.to_status) ORDER BY e.sequence DESC),'[]') FROM
      (SELECT * FROM orion_crm.audit_entries WHERE clinic_id=c.id AND kind IN ('visit.created','visit.transitioned','task.created','task.transitioned') ORDER BY sequence DESC LIMIT 50) e))
    INTO answer FROM orion_crm.clinics c WHERE c.id=a.clinic_id;
  PERFORM orion_crm.append_audit(a.clinic_id,a.id,a.label,'snapshot.read',NULL,NULL,NULL,NULL,NULL,NULL,'{}');
  IF octet_length(answer::text)>1048576 THEN RAISE EXCEPTION 'CRM_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
  RETURN answer;
END $$;

CREATE FUNCTION public.orion_crm_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_crm.actor_grants:=orion_crm.require_actor(p_issuer,p_subject,true);
  kind text:=p_command->>'type'; action text; key uuid; request_hash text; receipt orion_crm.command_receipts;
  allowed text[]; field text; v orion_crm.visits; t orion_crm.tasks; new_status text; previous_status text;
  expected integer; result jsonb; event_id text; observed timestamptz:=clock_timestamp(); target_time timestamptz; nurse text;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>8192 OR
    p_command->'testDataAcknowledged' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  allowed:=CASE kind
    WHEN 'visit.create' THEN ARRAY['type','patientId','staffId','roomId','serviceId','scheduledAt','testDataAcknowledged','idempotencyKey']
    WHEN 'visit.transition' THEN ARRAY['type','visitId','expectedVersion','action','testDataAcknowledged','idempotencyKey']
    WHEN 'task.transition' THEN ARRAY['type','taskId','expectedVersion','action','testDataAcknowledged','idempotencyKey'] ELSE NULL END;
  IF allowed IS NULL OR (SELECT count(*) FROM jsonb_object_keys(p_command))<>array_length(allowed,1) THEN
    RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  FOREACH field IN ARRAY allowed LOOP
    IF NOT p_command ? field THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    IF field NOT IN ('expectedVersion','testDataAcknowledged') AND jsonb_typeof(p_command->field) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    IF field LIKE '%Id' AND (p_command->>field !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$') THEN
      RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END LOOP;
  BEGIN key:=(p_command->>'idempotencyKey')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END;
  IF key IS NULL THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  IF kind<>'visit.create' THEN
    IF jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' OR
      p_command->>'expectedVersion' !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    expected:=(p_command->>'expectedVersion')::integer; action:=p_command->>'action';
    IF (kind='visit.transition' AND action NOT IN ('arrive','queue','start','complete','cancel')) OR
      (kind='task.transition' AND action NOT IN ('start','complete','escalate')) THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END IF;
  request_hash:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM orion_crm.command_receipts WHERE clinic_id=a.clinic_id AND actor_grant_id=a.id AND idempotency_key=key;
  IF FOUND THEN
    IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'CRM_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
    PERFORM orion_crm.append_audit(a.clinic_id,a.id,a.label,'command.replayed',NULL,NULL,NULL,NULL,NULL,key,jsonb_build_object('receiptAuditId',receipt.audit_id));
    RETURN receipt.result||jsonb_build_object('replayed',true);
  END IF;
  IF kind='visit.create' THEN
    IF p_command->>'scheduledAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
      RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    BEGIN target_time:=(p_command->>'scheduledAt')::timestamptz;
    EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END;
    IF target_time<'2020-01-01' OR target_time>='2100-01-01' OR orion_crm.iso(target_time)<>p_command->>'scheduledAt' THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    PERFORM 1 FROM orion_crm.patients p,orion_crm.staff s,orion_crm.rooms r,orion_crm.services x
      WHERE p.clinic_id=a.clinic_id AND p.id=p_command->>'patientId' AND s.clinic_id=a.clinic_id AND s.id=p_command->>'staffId'
      AND r.clinic_id=a.clinic_id AND r.id=p_command->>'roomId' AND x.clinic_id=a.clinic_id AND x.id=p_command->>'serviceId'
      AND s.room_id=r.id AND r.kind=x.room_kind AND s.role IN ('doctor','nurse');
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    INSERT INTO orion_crm.visits VALUES(a.clinic_id,'visit-'||gen_random_uuid()::text,p_command->>'patientId',p_command->>'staffId',p_command->>'roomId',p_command->>'serviceId',target_time,'scheduled',1,observed) RETURNING * INTO v;
    INSERT INTO orion_crm.visit_versions VALUES(v.clinic_id,v.id,v.version,v.status,to_jsonb(v),observed);
    event_id:=orion_crm.append_audit(a.clinic_id,a.id,a.label,'visit.created',v.id,NULL,v.version,NULL,v.status,key,to_jsonb(v));
    SELECT id INTO nurse FROM orion_crm.staff WHERE clinic_id=a.clinic_id AND role='nurse' ORDER BY id LIMIT 1;
    INSERT INTO orion_crm.tasks VALUES(a.clinic_id,'task-'||gen_random_uuid()::text,v.id,v.patient_id,coalesce(nurse,v.staff_id),'preparation','Подготовка к тестовому визиту','routine',v.scheduled_at,'pending',1,observed) RETURNING * INTO t;
    INSERT INTO orion_crm.task_versions VALUES(t.clinic_id,t.id,t.version,t.status,to_jsonb(t),observed);
    PERFORM orion_crm.append_audit(a.clinic_id,a.id,a.label,'task.created',NULL,t.id,t.version,NULL,t.status,key,to_jsonb(t));
    result:=jsonb_build_object('resourceId',v.id,'version',v.version,'replayed',false);
  ELSIF kind='visit.transition' THEN
    SELECT * INTO v FROM orion_crm.visits WHERE clinic_id=a.clinic_id AND id=p_command->>'visitId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF v.version<>expected THEN RAISE EXCEPTION 'CRM_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    new_status:=CASE WHEN action='arrive' AND v.status='scheduled' THEN 'arrived'
      WHEN action='queue' AND v.status='arrived' THEN 'queued' WHEN action='start' AND v.status='queued' THEN 'in_service'
      WHEN action='complete' AND v.status='in_service' THEN 'completed'
      WHEN action='cancel' AND v.status IN ('scheduled','arrived','queued') THEN 'cancelled' ELSE NULL END;
    IF new_status IS NULL THEN RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    previous_status:=v.status;
    UPDATE orion_crm.visits SET status=new_status,version=version+1,updated_at=greatest(updated_at,observed) WHERE clinic_id=a.clinic_id AND id=v.id RETURNING * INTO v;
    INSERT INTO orion_crm.visit_versions VALUES(v.clinic_id,v.id,v.version,v.status,to_jsonb(v),observed);
    event_id:=orion_crm.append_audit(a.clinic_id,a.id,a.label,'visit.transitioned',v.id,NULL,v.version,previous_status,v.status,key,to_jsonb(v));
    result:=jsonb_build_object('resourceId',v.id,'version',v.version,'replayed',false);
  ELSE
    SELECT * INTO t FROM orion_crm.tasks WHERE clinic_id=a.clinic_id AND id=p_command->>'taskId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF t.version<>expected THEN RAISE EXCEPTION 'CRM_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    new_status:=CASE WHEN action='start' AND t.status='pending' THEN 'in_progress'
      WHEN action='complete' AND t.status='in_progress' THEN 'completed'
      WHEN action='escalate' AND t.status IN ('pending','in_progress') THEN 'escalated' ELSE NULL END;
    IF new_status IS NULL THEN RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    previous_status:=t.status;
    UPDATE orion_crm.tasks SET status=new_status,priority=CASE WHEN new_status='escalated' THEN 'urgent' ELSE priority END,
      version=version+1,updated_at=greatest(updated_at,observed) WHERE clinic_id=a.clinic_id AND id=t.id RETURNING * INTO t;
    INSERT INTO orion_crm.task_versions VALUES(t.clinic_id,t.id,t.version,t.status,to_jsonb(t),observed);
    event_id:=orion_crm.append_audit(a.clinic_id,a.id,a.label,'task.transitioned',NULL,t.id,t.version,previous_status,t.status,key,to_jsonb(t));
    result:=jsonb_build_object('resourceId',t.id,'version',t.version,'replayed',false);
  END IF;
  INSERT INTO orion_crm.command_receipts VALUES(a.clinic_id,a.id,key,request_hash,result,event_id,observed);
  RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CRM_CAPACITY_CONFLICT' USING ERRCODE='PT409';
END $$;

DO $$ DECLARE t record; BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname='orion_crm' LOOP
    EXECUTE format('ALTER TABLE orion_crm.%I ENABLE ROW LEVEL SECURITY',t.tablename);
  END LOOP;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA orion_crm FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_crm FROM PUBLIC;
REVOKE ALL ON FUNCTION public.orion_crm_snapshot_v1(text,text),public.orion_crm_command_v1(text,text,jsonb) FROM PUBLIC;
-- Role creation/password belongs to the dedicated-cluster operator, not migrations.
GRANT EXECUTE ON FUNCTION public.orion_crm_snapshot_v1(text,text),public.orion_crm_command_v1(text,text,jsonb) TO orion_crm_app;
COMMIT;
