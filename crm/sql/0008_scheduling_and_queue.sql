-- CRM-3: dedicated PC simulation only. No prior visit/history row is rewritten.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
CREATE TABLE orion_crm.clinic_calendar (
  clinic_id text PRIMARY KEY REFERENCES orion_crm.clinics(id),
  time_zone text NOT NULL CHECK(time_zone='Asia/Qyzylorda'),
  weekdays integer[] NOT NULL CHECK(weekdays=ARRAY[1,2,3,4,5]),
  open_minute integer NOT NULL CHECK(open_minute=540), close_minute integer NOT NULL CHECK(close_minute=1080),
  source text NOT NULL CHECK(source='synthetic_policy')
);
INSERT INTO orion_crm.clinic_calendar SELECT id,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy' FROM orion_crm.clinics;
CREATE TABLE orion_crm.visit_booking (
  clinic_id text NOT NULL, visit_id text NOT NULL,
  duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 240),
  source text NOT NULL CHECK(source IN ('catalogue_backfill','booking')), created_at timestamptz NOT NULL,
  PRIMARY KEY(clinic_id,visit_id), FOREIGN KEY(clinic_id,visit_id) REFERENCES orion_crm.visits(clinic_id,id)
);
-- Explicit provenance: historical durations were not captured by CRM-1/2.
-- Their current catalogue value is recorded once, without inventing old evidence.
INSERT INTO orion_crm.visit_booking
  SELECT v.clinic_id,v.id,s.duration_minutes,'catalogue_backfill',clock_timestamp()
  FROM orion_crm.visits v JOIN orion_crm.services s ON s.clinic_id=v.clinic_id AND s.id=v.service_id;
CREATE TRIGGER immutable_calendar BEFORE UPDATE OR DELETE ON orion_crm.clinic_calendar
  FOR EACH ROW EXECUTE FUNCTION orion_crm.reject_mutation();
CREATE TRIGGER immutable_booking BEFORE UPDATE OR DELETE ON orion_crm.visit_booking
  FOR EACH ROW EXECUTE FUNCTION orion_crm.reject_mutation();
ALTER TABLE orion_crm.clinic_calendar ENABLE ROW LEVEL SECURITY;
ALTER TABLE orion_crm.visit_booking ENABLE ROW LEVEL SECURITY;

ALTER TABLE orion_crm.visits DROP CONSTRAINT visits_status_check;
ALTER TABLE orion_crm.visits ADD CONSTRAINT visits_status_check CHECK(status IN
  ('scheduled','arrived','queued','called','in_service','completed','cancelled','no_show'));
-- Existing in-service reservations already satisfy these broader indexes.
CREATE UNIQUE INDEX one_room_reserved ON orion_crm.visits(clinic_id,room_id) WHERE status IN ('called','in_service');
CREATE UNIQUE INDEX one_staff_reserved ON orion_crm.visits(clinic_id,staff_id) WHERE status IN ('called','in_service');
CREATE UNIQUE INDEX one_patient_reserved ON orion_crm.visits(clinic_id,patient_id) WHERE status IN ('called','in_service');

CREATE FUNCTION orion_crm.visit_stage_time_v1(p_clinic text,p_visit text,p_status text) RETURNS timestamptz
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT date_trunc('milliseconds',(snapshot->>'updated_at')::timestamptz) FROM orion_crm.visit_versions
    WHERE clinic_id=p_clinic AND visit_id=p_visit AND status=p_status ORDER BY version DESC LIMIT 1
$$;
CREATE INDEX visit_audit_version_idx ON orion_crm.audit_entries(clinic_id,visit_id,resource_version) WHERE visit_id IS NOT NULL;
CREATE FUNCTION orion_crm.visit_queue_order_v1(p_clinic text,p_visit text) RETURNS integer
LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT CASE WHEN count(*)=1 THEN min(e.sequence) ELSE NULL END FROM orion_crm.audit_entries e
  WHERE e.clinic_id=p_clinic AND e.visit_id=p_visit AND e.to_status='queued' AND e.kind IN ('visit.created','visit.transitioned') AND
    e.resource_version=(SELECT version FROM orion_crm.visit_versions WHERE clinic_id=p_clinic AND visit_id=p_visit AND status='queued' ORDER BY version DESC LIMIT 1)
$$;
CREATE FUNCTION orion_crm.require_slot_v1(p_visit orion_crm.visits,p_duration integer) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE policy orion_crm.clinic_calendar; local_start timestamp; local_end timestamp; end_at timestamptz;
BEGIN
  -- A single clinic mutex serializes all slot publications, including direct
  -- trusted SQL inserts/time changes; browser availability is never authority.
  PERFORM 1 FROM orion_crm.clinics WHERE id=p_visit.clinic_id AND active AND mode='synthetic_simulation' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  SELECT * INTO policy FROM orion_crm.clinic_calendar WHERE clinic_id=p_visit.clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_CALENDAR_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  IF p_visit.scheduled_at<=clock_timestamp() THEN RAISE EXCEPTION 'CRM_PAST_SLOT' USING ERRCODE='PT409'; END IF;
  end_at:=p_visit.scheduled_at+make_interval(mins=>p_duration);
  local_start:=p_visit.scheduled_at AT TIME ZONE policy.time_zone;
  local_end:=end_at AT TIME ZONE policy.time_zone;
  IF NOT extract(isodow FROM local_start)::integer=ANY(policy.weekdays) OR local_start::date<>local_end::date OR
    local_start::time<make_time(policy.open_minute/60,policy.open_minute%60,0) OR
    local_end::time>make_time(policy.close_minute/60,policy.close_minute%60,0) THEN
    RAISE EXCEPTION 'CRM_OUTSIDE_HOURS' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM orion_crm.visits v JOIN orion_crm.visit_booking b ON b.clinic_id=v.clinic_id AND b.visit_id=v.id
    WHERE v.clinic_id=p_visit.clinic_id AND v.id<>p_visit.id AND v.status NOT IN ('completed','cancelled','no_show') AND
      (v.room_id=p_visit.room_id OR v.staff_id=p_visit.staff_id OR v.patient_id=p_visit.patient_id) AND
      tstzrange(v.scheduled_at,v.scheduled_at+make_interval(mins=>b.duration_minutes),'[)') && tstzrange(p_visit.scheduled_at,end_at,'[)')) THEN
    RAISE EXCEPTION 'CRM_SCHEDULE_CONFLICT' USING ERRCODE='PT409'; END IF;
END $$;

CREATE FUNCTION orion_crm.visit_schedule_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE duration integer;
BEGIN
  PERFORM 1 FROM orion_crm.clinics WHERE id=NEW.clinic_id FOR UPDATE;
  IF TG_OP='INSERT' THEN
    IF NEW.status<>'scheduled' OR NEW.version<>1 THEN RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    SELECT x.duration_minutes INTO duration FROM orion_crm.services x
      JOIN orion_crm.rooms r ON r.clinic_id=x.clinic_id AND r.id=NEW.room_id AND r.kind=x.room_kind
      JOIN orion_crm.staff s ON s.clinic_id=r.clinic_id AND s.id=NEW.staff_id AND s.room_id=r.id AND s.role IN ('doctor','nurse')
      JOIN orion_crm.patients p ON p.clinic_id=r.clinic_id AND p.id=NEW.patient_id
      WHERE x.clinic_id=NEW.clinic_id AND x.id=NEW.service_id FOR SHARE OF x,r,s,p;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF (SELECT count(*) FROM orion_crm.visits WHERE clinic_id=NEW.clinic_id)>=1000 OR
      (SELECT count(*) FROM orion_crm.tasks WHERE clinic_id=NEW.clinic_id)>=2000 THEN RAISE EXCEPTION 'CRM_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
    PERFORM orion_crm.require_slot_v1(NEW,duration);
  ELSIF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
    SELECT duration_minutes INTO duration FROM orion_crm.visit_booking WHERE clinic_id=NEW.clinic_id AND visit_id=NEW.id;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_BOOKING_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
    PERFORM orion_crm.require_slot_v1(NEW,duration);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_schedule_guard BEFORE INSERT OR UPDATE ON orion_crm.visits
  FOR EACH ROW EXECUTE FUNCTION orion_crm.visit_schedule_guard_v1();
CREATE FUNCTION orion_crm.booking_insert_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE duration integer;
BEGIN
  SELECT s.duration_minutes INTO duration FROM orion_crm.visits v JOIN orion_crm.services s ON s.clinic_id=v.clinic_id AND s.id=v.service_id
    WHERE v.clinic_id=NEW.clinic_id AND v.id=NEW.visit_id FOR SHARE OF s;
  IF NEW.source<>'booking' OR NEW.duration_minutes IS DISTINCT FROM duration THEN RAISE EXCEPTION 'CRM_BOOKING_INVALID' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER booking_insert_guard BEFORE INSERT ON orion_crm.visit_booking
  FOR EACH ROW EXECUTE FUNCTION orion_crm.booking_insert_guard_v1();
CREATE FUNCTION orion_crm.publish_booking_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  INSERT INTO orion_crm.visit_booking SELECT NEW.clinic_id,NEW.id,duration_minutes,'booking',clock_timestamp()
    FROM orion_crm.services WHERE clinic_id=NEW.clinic_id AND id=NEW.service_id;
  RETURN NULL;
END $$;
CREATE TRIGGER publish_booking AFTER INSERT ON orion_crm.visits FOR EACH ROW EXECUTE FUNCTION orion_crm.publish_booking_v1();
CREATE FUNCTION orion_crm.booking_commit_guard_v1() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM orion_crm.visit_booking WHERE clinic_id=NEW.clinic_id AND visit_id=NEW.id) THEN
    RAISE EXCEPTION 'CRM_BOOKING_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER booking_commit_guard AFTER INSERT ON orion_crm.visits
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION orion_crm.booking_commit_guard_v1();

CREATE OR REPLACE FUNCTION orion_crm.state_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_DELETE_FORBIDDEN' USING ERRCODE='PT409'; END IF;
  IF TG_TABLE_NAME='visits' THEN
    PERFORM 1 FROM orion_crm.clinics WHERE id=NEW.clinic_id FOR UPDATE;
    IF (to_jsonb(NEW)-ARRAY['status','version','updated_at','scheduled_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','version','updated_at','scheduled_at']) THEN RAISE EXCEPTION 'CRM_IMMUTABLE_RELATION' USING ERRCODE='PT409'; END IF;
    IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN allowed:=OLD.status='scheduled' AND NEW.status='scheduled';
    ELSE
      allowed:=(OLD.status='scheduled' AND NEW.status IN ('arrived','cancelled','no_show')) OR
        (OLD.status='arrived' AND NEW.status IN ('queued','cancelled')) OR
        (OLD.status='queued' AND NEW.status IN ('called','cancelled')) OR
        (OLD.status='called' AND NEW.status IN ('queued','in_service','cancelled')) OR
        (OLD.status='in_service' AND NEW.status='completed');
    END IF;
    IF NEW.status='no_show' AND OLD.scheduled_at>clock_timestamp() THEN RAISE EXCEPTION 'CRM_NO_SHOW_TOO_EARLY' USING ERRCODE='PT409'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','priority','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','priority','version','updated_at']) THEN
      RAISE EXCEPTION 'CRM_IMMUTABLE_RELATION' USING ERRCODE='PT409'; END IF;
    allowed:=(OLD.status='pending' AND NEW.status IN ('in_progress','escalated')) OR
      (OLD.status='in_progress' AND NEW.status IN ('completed','escalated')) OR (OLD.status='escalated' AND NEW.status='in_progress');
    IF NEW.priority IS DISTINCT FROM OLD.priority AND NOT (NEW.status='escalated' AND NEW.priority='urgent') THEN
      RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
  END IF;
  IF NOT allowed OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION orion_crm.require_queue_head_v1(p_visit orion_crm.visits) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE entered integer:=orion_crm.visit_queue_order_v1(p_visit.clinic_id,p_visit.id);
BEGIN
  IF entered IS NULL OR EXISTS(SELECT 1 FROM orion_crm.visits v WHERE v.clinic_id=p_visit.clinic_id AND v.status='queued' AND
    (v.room_id=p_visit.room_id OR v.staff_id=p_visit.staff_id) AND orion_crm.visit_queue_order_v1(v.clinic_id,v.id) IS NULL) THEN
    RAISE EXCEPTION 'CRM_QUEUE_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  IF EXISTS(SELECT 1 FROM orion_crm.visits v WHERE v.clinic_id=p_visit.clinic_id AND v.id<>p_visit.id AND
    v.status IN ('called','in_service') AND (v.room_id=p_visit.room_id OR v.staff_id=p_visit.staff_id OR v.patient_id=p_visit.patient_id)) THEN
    RAISE EXCEPTION 'CRM_CAPACITY_CONFLICT' USING ERRCODE='PT409'; END IF;
  IF EXISTS(SELECT 1 FROM orion_crm.visits v WHERE v.clinic_id=p_visit.clinic_id AND v.status='queued' AND
    (v.room_id=p_visit.room_id OR v.staff_id=p_visit.staff_id) AND
    ROW(orion_crm.visit_queue_order_v1(v.clinic_id,v.id),v.scheduled_at,v.id)<
    ROW(entered,p_visit.scheduled_at,p_visit.id)) THEN RAISE EXCEPTION 'CRM_QUEUE_ORDER_CONFLICT' USING ERRCODE='PT409'; END IF;
END $$;
CREATE FUNCTION orion_crm.visit_call_guard_v1() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF NEW.status='called' AND OLD.status IS DISTINCT FROM 'called' THEN
    PERFORM 1 FROM orion_crm.clinics WHERE id=NEW.clinic_id FOR UPDATE;
    PERFORM orion_crm.require_queue_head_v1(OLD);
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER visit_call_guard BEFORE UPDATE ON orion_crm.visits FOR EACH ROW EXECUTE FUNCTION orion_crm.visit_call_guard_v1();

ALTER FUNCTION public.orion_crm_command_v1(text,text,jsonb) SET SCHEMA orion_crm;
ALTER FUNCTION orion_crm.orion_crm_command_v1(text,text,jsonb) RENAME TO command_operations_v2;
REVOKE ALL ON FUNCTION orion_crm.command_operations_v2(text,text,jsonb) FROM PUBLIC,orion_crm_app;
CREATE FUNCTION public.orion_crm_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_crm.actor_grants; key uuid; field text; expected integer; action text; request_hash text;
  receipt orion_crm.command_receipts; v orion_crm.visits; previous_status text; new_status text;
  observed timestamptz:=clock_timestamp(); event_id text; result jsonb;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>8192 OR
    p_command->'testDataAcknowledged' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  IF p_command->>'type'<>'visit.transition' THEN
    IF p_command->>'type'='task.create' THEN
      a:=orion_crm.require_actor(p_issuer,p_subject,true);
      result:=orion_crm.command_operations_v2(p_issuer,p_subject,p_command);
      -- Historical command replay is independent of a later visit state.
      -- A rejected new task rolls its complete inner publication back atomically.
      IF (result->>'replayed')::boolean=false AND p_command->>'kind'<>'follow_up' AND EXISTS(SELECT 1 FROM orion_crm.visits WHERE clinic_id=a.clinic_id AND
        id=p_command->>'visitId' AND status='no_show') THEN RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
      RETURN result;
    END IF;
    RETURN orion_crm.command_operations_v2(p_issuer,p_subject,p_command);
  END IF;
  a:=orion_crm.require_actor(p_issuer,p_subject,true);
  IF (SELECT count(*) FROM jsonb_object_keys(p_command))<>6 THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  FOREACH field IN ARRAY ARRAY['type','visitId','expectedVersion','action','testDataAcknowledged','idempotencyKey'] LOOP
    IF NOT p_command ? field OR (field NOT IN ('expectedVersion','testDataAcknowledged') AND jsonb_typeof(p_command->field) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END LOOP;
  IF p_command->>'visitId' !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$' OR jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' OR
    p_command->>'expectedVersion' !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  IF (p_command->>'expectedVersion')::numeric>2147483647 THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  expected:=(p_command->>'expectedVersion')::integer; action:=p_command->>'action';
  IF action NOT IN ('arrive','queue','call','requeue','start','complete','cancel','mark_no_show') OR
    p_command->>'idempotencyKey' !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' THEN
    RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  key:=(p_command->>'idempotencyKey')::uuid; request_hash:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM orion_crm.command_receipts WHERE clinic_id=a.clinic_id AND actor_grant_id=a.id AND idempotency_key=key;
  IF FOUND THEN
    IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'CRM_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
    PERFORM orion_crm.append_audit(a.clinic_id,a.id,a.label,'command.replayed',NULL,NULL,NULL,NULL,NULL,key,jsonb_build_object('receiptAuditId',receipt.audit_id));
    RETURN receipt.result||jsonb_build_object('replayed',true);
  END IF;
  SELECT * INTO v FROM orion_crm.visits WHERE clinic_id=a.clinic_id AND id=p_command->>'visitId' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  IF v.version<>expected THEN RAISE EXCEPTION 'CRM_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  new_status:=CASE WHEN action='arrive' AND v.status='scheduled' THEN 'arrived'
    WHEN action='queue' AND v.status='arrived' THEN 'queued' WHEN action='call' AND v.status='queued' THEN 'called'
    WHEN action='requeue' AND v.status='called' THEN 'queued' WHEN action='start' AND v.status='called' THEN 'in_service'
    WHEN action='complete' AND v.status='in_service' THEN 'completed'
    WHEN action='cancel' AND v.status IN ('scheduled','arrived','queued','called') THEN 'cancelled'
    WHEN action='mark_no_show' AND v.status='scheduled' THEN 'no_show' ELSE NULL END;
  IF new_status IS NULL THEN RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
  IF new_status='no_show' AND v.scheduled_at>clock_timestamp() THEN RAISE EXCEPTION 'CRM_NO_SHOW_TOO_EARLY' USING ERRCODE='PT409'; END IF;
  IF new_status='called' THEN PERFORM orion_crm.require_queue_head_v1(v); END IF;
  previous_status:=v.status;
  UPDATE orion_crm.visits SET status=new_status,version=version+1,updated_at=greatest(updated_at,observed)
    WHERE clinic_id=a.clinic_id AND id=v.id RETURNING * INTO v;
  INSERT INTO orion_crm.visit_versions VALUES(v.clinic_id,v.id,v.version,v.status,to_jsonb(v),observed);
  event_id:=orion_crm.append_audit(a.clinic_id,a.id,a.label,'visit.transitioned',v.id,NULL,v.version,previous_status,v.status,key,to_jsonb(v));
  result:=jsonb_build_object('resourceId',v.id,'version',v.version,'replayed',false);
  INSERT INTO orion_crm.command_receipts VALUES(a.clinic_id,a.id,key,request_hash,result,event_id,observed);
  RETURN result;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'CRM_CAPACITY_CONFLICT' USING ERRCODE='PT409';
END $$;

CREATE OR REPLACE FUNCTION public.orion_crm_snapshot_v1(p_issuer text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_crm.actor_grants:=orion_crm.require_actor(p_issuer,p_subject,false); answer jsonb; events jsonb; visits jsonb; policy orion_crm.clinic_calendar;
BEGIN
  SELECT * INTO policy FROM orion_crm.clinic_calendar WHERE clinic_id=a.clinic_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'CRM_CALENDAR_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  IF EXISTS(SELECT 1 FROM orion_crm.visits v LEFT JOIN orion_crm.visit_booking b ON b.clinic_id=v.clinic_id AND b.visit_id=v.id
    WHERE v.clinic_id=a.clinic_id AND b.visit_id IS NULL) THEN RAISE EXCEPTION 'CRM_BOOKING_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  IF EXISTS(SELECT 1 FROM orion_crm.visits v WHERE v.clinic_id=a.clinic_id AND v.status='queued' AND
    orion_crm.visit_queue_order_v1(v.clinic_id,v.id) IS NULL) THEN RAISE EXCEPTION 'CRM_QUEUE_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  answer:=orion_crm.snapshot_core_v1(p_issuer,p_subject);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'patientId',v.patient_id,'staffId',v.staff_id,'roomId',v.room_id,
    'serviceId',v.service_id,'scheduledAt',orion_crm.iso(v.scheduled_at),'status',v.status,'version',v.version,'updatedAt',orion_crm.iso(v.updated_at),
    'durationMinutes',b.duration_minutes,'bookingSource',b.source,'queueOrder',orion_crm.visit_queue_order_v1(v.clinic_id,v.id),
    'arrivedAt',orion_crm.iso(orion_crm.visit_stage_time_v1(v.clinic_id,v.id,'arrived')),
    'queuedAt',orion_crm.iso(orion_crm.visit_stage_time_v1(v.clinic_id,v.id,'queued')),
    'calledAt',orion_crm.iso(orion_crm.visit_stage_time_v1(v.clinic_id,v.id,'called')),
    'startedAt',orion_crm.iso(orion_crm.visit_stage_time_v1(v.clinic_id,v.id,'in_service')),
    'completedAt',orion_crm.iso(orion_crm.visit_stage_time_v1(v.clinic_id,v.id,'completed'))) ORDER BY v.scheduled_at,v.id),'[]') INTO visits
    FROM orion_crm.visits v JOIN orion_crm.visit_booking b ON b.clinic_id=v.clinic_id AND b.visit_id=v.id WHERE v.clinic_id=a.clinic_id;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'resourceId',coalesce(e.visit_id,e.task_id),'kind',e.kind,'actorLabel',e.actor_label,
    'createdAt',orion_crm.iso(e.created_at),'fromStatus',e.from_status,'toStatus',e.to_status) ORDER BY e.sequence DESC),'[]') INTO events
    FROM (SELECT * FROM orion_crm.audit_entries WHERE clinic_id=a.clinic_id AND kind IN
      ('visit.created','visit.transitioned','visit.rescheduled','task.created','task.transitioned') ORDER BY sequence DESC LIMIT 50) e;
  answer:=answer||jsonb_build_object('visits',visits,'events',events,'calendar',jsonb_build_object('timeZone',policy.time_zone,
    'weekdays',to_jsonb(policy.weekdays),'openMinute',policy.open_minute,'closeMinute',policy.close_minute,'source',policy.source));
  IF octet_length(answer::text)>1048576 THEN RAISE EXCEPTION 'CRM_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
  RETURN answer;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA orion_crm FROM PUBLIC,orion_crm_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_crm FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_crm_snapshot_v1(text,text),public.orion_crm_command_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_crm_snapshot_v1(text,text),public.orion_crm_command_v1(text,text,jsonb) TO orion_crm_app;
COMMIT;
