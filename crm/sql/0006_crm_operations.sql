-- CRM-2 additive local simulation operations. Applied 0001-0005 stay immutable.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
ALTER TABLE orion_crm.audit_entries DROP CONSTRAINT audit_entries_kind_check;
ALTER TABLE orion_crm.audit_entries ADD CONSTRAINT audit_entries_kind_check CHECK(kind IN
  ('snapshot.read','command.replayed','visit.created','visit.transitioned','visit.rescheduled','task.created','task.transitioned'));

CREATE OR REPLACE FUNCTION orion_crm.state_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE allowed boolean;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'CRM_DELETE_FORBIDDEN' USING ERRCODE='PT409'; END IF;
  IF TG_TABLE_NAME='visits' THEN
    IF (to_jsonb(NEW)-ARRAY['status','version','updated_at','scheduled_at']) IS DISTINCT FROM
      (to_jsonb(OLD)-ARRAY['status','version','updated_at','scheduled_at']) THEN
      RAISE EXCEPTION 'CRM_IMMUTABLE_RELATION' USING ERRCODE='PT409'; END IF;
    IF NEW.scheduled_at IS DISTINCT FROM OLD.scheduled_at THEN
      allowed:=OLD.status='scheduled' AND NEW.status='scheduled';
    ELSE
      allowed:= (OLD.status='scheduled' AND NEW.status IN ('arrived','cancelled')) OR
        (OLD.status='arrived' AND NEW.status IN ('queued','cancelled')) OR
        (OLD.status='queued' AND NEW.status IN ('in_service','cancelled')) OR
        (OLD.status='in_service' AND NEW.status='completed');
    END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['status','priority','version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','priority','version','updated_at']) THEN
      RAISE EXCEPTION 'CRM_IMMUTABLE_RELATION' USING ERRCODE='PT409'; END IF;
    allowed:= (OLD.status='pending' AND NEW.status IN ('in_progress','escalated')) OR
      (OLD.status='in_progress' AND NEW.status IN ('completed','escalated')) OR
      (OLD.status='escalated' AND NEW.status='in_progress');
    IF NEW.priority IS DISTINCT FROM OLD.priority AND NOT (NEW.status='escalated' AND NEW.priority='urgent') THEN
      RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
  END IF;
  IF NOT allowed OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN
    RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;

CREATE OR REPLACE FUNCTION orion_crm.audit_insert_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
DECLARE c orion_crm.clinics; stored jsonb; prior jsonb; old_status text;
BEGIN
  SELECT * INTO STRICT c FROM orion_crm.clinics WHERE id=NEW.clinic_id FOR UPDATE;
  IF NEW.sequence<>c.audit_sequence+1 OR NEW.previous_hash IS DISTINCT FROM c.audit_hash OR
    NEW.event_hash<>encode(sha256(convert_to((to_jsonb(NEW)-'event_hash')::text,'UTF8')),'hex') THEN
    RAISE EXCEPTION 'CRM_AUDIT_PUBLICATION_INVALID' USING ERRCODE='PT503'; END IF;
  IF NEW.visit_id IS NOT NULL THEN
    SELECT snapshot INTO stored FROM orion_crm.visit_versions WHERE clinic_id=NEW.clinic_id AND visit_id=NEW.visit_id AND version=NEW.resource_version;
    SELECT snapshot INTO prior FROM orion_crm.visit_versions WHERE clinic_id=NEW.clinic_id AND visit_id=NEW.visit_id AND version=NEW.resource_version-1;
  ELSIF NEW.task_id IS NOT NULL THEN
    SELECT snapshot INTO stored FROM orion_crm.task_versions WHERE clinic_id=NEW.clinic_id AND task_id=NEW.task_id AND version=NEW.resource_version;
    SELECT snapshot INTO prior FROM orion_crm.task_versions WHERE clinic_id=NEW.clinic_id AND task_id=NEW.task_id AND version=NEW.resource_version-1;
  END IF;
  old_status:=prior->>'status';
  IF NEW.kind IN ('visit.created','visit.transitioned','visit.rescheduled','task.created','task.transitioned') AND
    (stored IS NULL OR NEW.to_status IS DISTINCT FROM stored->>'status' OR NEW.from_status IS DISTINCT FROM old_status OR
    coalesce(NEW.payload->'snapshot',NEW.payload) IS DISTINCT FROM stored) THEN
    RAISE EXCEPTION 'CRM_AUDIT_PUBLICATION_INVALID' USING ERRCODE='PT503'; END IF;
  IF NEW.kind='visit.rescheduled' AND (old_status IS DISTINCT FROM 'scheduled' OR NEW.to_status IS DISTINCT FROM 'scheduled' OR
    prior->'scheduled_at' IS NOT DISTINCT FROM stored->'scheduled_at') THEN
    RAISE EXCEPTION 'CRM_AUDIT_PUBLICATION_INVALID' USING ERRCODE='PT503'; END IF;
  RETURN NEW;
END $$;

CREATE FUNCTION orion_crm.command_time_v1(p_value jsonb) RETURNS timestamptz
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE text_value text; result timestamptz;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  text_value:=p_value#>>'{}';
  IF text_value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}\.[0-9]{3}Z$' THEN
    RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  BEGIN result:=text_value::timestamptz;
  EXCEPTION WHEN datetime_field_overflow OR invalid_datetime_format THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END;
  IF result<'2020-01-01' OR result>='2100-01-01' OR orion_crm.iso(result)<>text_value THEN
    RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  RETURN result;
END $$;
CREATE FUNCTION orion_crm.command_title_v1(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text; utf16_length integer;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  result:=p_value#>>'{}';
  SELECT coalesce(sum(CASE WHEN ascii(c)>65535 THEN 2 ELSE 1 END),0)::integer INTO utf16_length FROM regexp_split_to_table(result,'') c;
  IF utf16_length NOT BETWEEN 1 AND 240 OR result ~ U&'[\0001-\001F\007F-\009F]' OR
    result ~ U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]|[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]$' THEN
    RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  RETURN result;
END $$;

-- Retain the reviewed CRM-1 implementation privately; API surface stays two RPCs.
ALTER FUNCTION public.orion_crm_command_v1(text,text,jsonb) SET SCHEMA orion_crm;
ALTER FUNCTION orion_crm.orion_crm_command_v1(text,text,jsonb) RENAME TO command_core_v1;
REVOKE ALL ON FUNCTION orion_crm.command_core_v1(text,text,jsonb) FROM PUBLIC,orion_crm_app;
ALTER FUNCTION public.orion_crm_snapshot_v1(text,text) SET SCHEMA orion_crm;
ALTER FUNCTION orion_crm.orion_crm_snapshot_v1(text,text) RENAME TO snapshot_core_v1;
REVOKE ALL ON FUNCTION orion_crm.snapshot_core_v1(text,text) FROM PUBLIC,orion_crm_app;

CREATE FUNCTION public.orion_crm_snapshot_v1(p_issuer text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_crm.actor_grants:=orion_crm.require_actor(p_issuer,p_subject,false); answer jsonb; events jsonb;
BEGIN
  answer:=orion_crm.snapshot_core_v1(p_issuer,p_subject);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'resourceId',coalesce(e.visit_id,e.task_id),'kind',e.kind,
    'actorLabel',e.actor_label,'createdAt',orion_crm.iso(e.created_at),'fromStatus',e.from_status,'toStatus',e.to_status) ORDER BY e.sequence DESC),'[]')
    INTO events FROM (SELECT * FROM orion_crm.audit_entries WHERE clinic_id=a.clinic_id AND
      kind IN ('visit.created','visit.transitioned','visit.rescheduled','task.created','task.transitioned') ORDER BY sequence DESC LIMIT 50) e;
  answer:=answer||jsonb_build_object('events',events);
  IF octet_length(answer::text)>1048576 THEN RAISE EXCEPTION 'CRM_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
  RETURN answer;
END $$;

CREATE FUNCTION public.orion_crm_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_crm.actor_grants; kind text; allowed text[]; field text; key uuid; request_hash text;
  receipt orion_crm.command_receipts; v orion_crm.visits; t orion_crm.tasks; expected integer;
  observed timestamptz:=clock_timestamp(); target_time timestamptz; title text; result jsonb; event_id text;
  previous_status text; new_status text; action text;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>8192 OR
    p_command->'testDataAcknowledged' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  kind:=p_command->>'type';
  IF kind IN ('visit.create','visit.transition') THEN RETURN orion_crm.command_core_v1(p_issuer,p_subject,p_command); END IF;
  a:=orion_crm.require_actor(p_issuer,p_subject,true);
  allowed:=CASE kind
    WHEN 'task.create' THEN ARRAY['type','visitId','ownerId','kind','title','priority','dueAt','testDataAcknowledged','idempotencyKey']
    WHEN 'visit.reschedule' THEN ARRAY['type','visitId','expectedVersion','scheduledAt','testDataAcknowledged','idempotencyKey']
    WHEN 'task.transition' THEN ARRAY['type','taskId','expectedVersion','action','testDataAcknowledged','idempotencyKey'] ELSE NULL END;
  IF allowed IS NULL OR (SELECT count(*) FROM jsonb_object_keys(p_command))<>array_length(allowed,1) THEN
    RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  FOREACH field IN ARRAY allowed LOOP
    IF NOT p_command ? field THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    IF field NOT IN ('expectedVersion','testDataAcknowledged') AND jsonb_typeof(p_command->field) IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    IF field LIKE '%Id' AND p_command->>field !~ '^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$' THEN
      RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END LOOP;
  IF p_command->>'idempotencyKey' !~ '^([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[1-8][0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}|00000000-0000-0000-0000-000000000000|ffffffff-ffff-ffff-ffff-ffffffffffff)$' THEN
    RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  BEGIN key:=(p_command->>'idempotencyKey')::uuid;
  EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END;
  IF key IS NULL THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  IF kind IN ('visit.reschedule','task.transition') THEN
    IF jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' OR p_command->>'expectedVersion' !~ '^[1-9][0-9]{0,9}$' THEN
      RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    IF (p_command->>'expectedVersion')::numeric>2147483647 THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    expected:=(p_command->>'expectedVersion')::integer;
  END IF;
  IF kind='task.create' THEN
    title:=orion_crm.command_title_v1(p_command->'title'); target_time:=orion_crm.command_time_v1(p_command->'dueAt');
    IF p_command->>'kind' NOT IN ('preparation','follow_up','service') OR p_command->>'priority' NOT IN ('routine','urgent') THEN
      RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  ELSIF kind='visit.reschedule' THEN target_time:=orion_crm.command_time_v1(p_command->'scheduledAt');
  ELSE
    action:=p_command->>'action';
    IF action NOT IN ('start','complete','escalate') THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END IF;
  request_hash:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM orion_crm.command_receipts WHERE clinic_id=a.clinic_id AND actor_grant_id=a.id AND idempotency_key=key;
  IF FOUND THEN
    IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'CRM_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
    PERFORM orion_crm.append_audit(a.clinic_id,a.id,a.label,'command.replayed',NULL,NULL,NULL,NULL,NULL,key,jsonb_build_object('receiptAuditId',receipt.audit_id));
    RETURN receipt.result||jsonb_build_object('replayed',true);
  END IF;
  IF kind='task.create' THEN
    SELECT * INTO v FROM orion_crm.visits WHERE clinic_id=a.clinic_id AND id=p_command->>'visitId' FOR SHARE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    PERFORM 1 FROM orion_crm.staff WHERE clinic_id=a.clinic_id AND id=p_command->>'ownerId';
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF v.status='cancelled' OR (v.status='completed' AND p_command->>'kind'<>'follow_up') THEN
      RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    IF (SELECT count(*) FROM orion_crm.tasks WHERE clinic_id=a.clinic_id)>=2000 THEN RAISE EXCEPTION 'CRM_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
    INSERT INTO orion_crm.tasks VALUES(a.clinic_id,'task-'||gen_random_uuid()::text,v.id,v.patient_id,p_command->>'ownerId',
      p_command->>'kind',title,p_command->>'priority',target_time,'pending',1,observed) RETURNING * INTO t;
    INSERT INTO orion_crm.task_versions VALUES(t.clinic_id,t.id,t.version,t.status,to_jsonb(t),observed);
    event_id:=orion_crm.append_audit(a.clinic_id,a.id,a.label,'task.created',NULL,t.id,1,NULL,t.status,key,to_jsonb(t));
    result:=jsonb_build_object('resourceId',t.id,'version',t.version,'replayed',false);
  ELSIF kind='visit.reschedule' THEN
    SELECT * INTO v FROM orion_crm.visits WHERE clinic_id=a.clinic_id AND id=p_command->>'visitId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF v.version<>expected THEN RAISE EXCEPTION 'CRM_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF v.status<>'scheduled' OR v.scheduled_at=target_time THEN RAISE EXCEPTION 'CRM_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    UPDATE orion_crm.visits SET scheduled_at=target_time,version=version+1,updated_at=greatest(updated_at,observed)
      WHERE clinic_id=a.clinic_id AND id=v.id RETURNING * INTO v;
    INSERT INTO orion_crm.visit_versions VALUES(v.clinic_id,v.id,v.version,v.status,to_jsonb(v),observed);
    event_id:=orion_crm.append_audit(a.clinic_id,a.id,a.label,'visit.rescheduled',v.id,NULL,v.version,v.status,v.status,key,to_jsonb(v));
    -- Existing task deadlines are independent, never silently moved with a visit.
    result:=jsonb_build_object('resourceId',v.id,'version',v.version,'replayed',false);
  ELSE
    SELECT * INTO t FROM orion_crm.tasks WHERE clinic_id=a.clinic_id AND id=p_command->>'taskId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF t.version<>expected THEN RAISE EXCEPTION 'CRM_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    new_status:=CASE WHEN action='start' AND t.status IN ('pending','escalated') THEN 'in_progress'
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
END $$;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_crm FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_crm_snapshot_v1(text,text),public.orion_crm_command_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_crm_snapshot_v1(text,text),public.orion_crm_command_v1(text,text,jsonb) TO orion_crm_app;
COMMIT;
