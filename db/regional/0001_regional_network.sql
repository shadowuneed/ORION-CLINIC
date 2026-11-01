-- Additive PC-only regional training network. Existing clinical tenants are not enrolled.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'REGIONAL_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
CREATE SCHEMA orion_region;
REVOKE ALL ON SCHEMA orion_region FROM PUBLIC,orion_crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_region REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_region REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE orion_region.districts (
  id text PRIMARY KEY, name text NOT NULL, kind text NOT NULL CHECK(kind IN ('district','city')),
  region_id text NOT NULL CHECK(region_id IN ('turkestan','shymkent')),
  CHECK((region_id='shymkent')=(id='shymkent'))
);
CREATE TABLE orion_region.facilities (
  id text PRIMARY KEY, district_id text NOT NULL REFERENCES orion_region.districts(id),
  clinic_id text NOT NULL UNIQUE REFERENCES orion_crm.clinics(id), name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  kind text NOT NULL CHECK(kind IN ('hospital','polyclinic')), latitude double precision NOT NULL CHECK(latitude BETWEEN 40 AND 47),
  longitude double precision NOT NULL CHECK(longitude BETWEEN 66 AND 72), address text NOT NULL,
  data_mode text NOT NULL DEFAULT 'training' CHECK(data_mode='training'), UNIQUE(id,clinic_id)
);
CREATE INDEX regional_facility_district ON orion_region.facilities(district_id);
-- An explicit training-network grant is independent of clinical access to existing tenants.
CREATE TABLE orion_region.network_grants (
  user_id text PRIMARY KEY REFERENCES orion_directory.accounts(id),
  anchor_clinic_id text NOT NULL REFERENCES orion_crm.clinics(id), active boolean NOT NULL DEFAULT true,
  can_manage boolean NOT NULL DEFAULT true, granted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 240)
);
CREATE TABLE orion_region.patient_details (
  clinic_id text NOT NULL REFERENCES orion_region.facilities(clinic_id), patient_id text NOT NULL,
  training_iin text NOT NULL CHECK(training_iin~'^TRAIN-[A-Z0-9-]{3,32}$'), birth_date date NOT NULL,
  allergies text[] NOT NULL DEFAULT '{}', PRIMARY KEY(clinic_id,patient_id), UNIQUE(clinic_id,training_iin),
  FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_crm.patients(clinic_id,id),
  CHECK(birth_date BETWEEN '1900-01-01'::date AND current_date), CHECK(cardinality(allergies)<=20)
);
CREATE TABLE orion_region.conditions (
  clinic_id text NOT NULL, id text NOT NULL, patient_id text NOT NULL, code text NOT NULL, name text NOT NULL,
  since date NOT NULL, status text NOT NULL CHECK(status IN ('active','resolved')), PRIMARY KEY(clinic_id,id),
  FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_region.patient_details(clinic_id,patient_id)
);
CREATE TABLE orion_region.patient_history (
  clinic_id text NOT NULL, id text NOT NULL, patient_id text NOT NULL, recorded_at timestamptz NOT NULL,
  title text NOT NULL, detail text NOT NULL, doctor text NOT NULL, PRIMARY KEY(clinic_id,id),
  FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_region.patient_details(clinic_id,patient_id)
);
-- Imported training visit observations have a recorded historical timeline. They
-- are not new bookings in the physician scheduler (which correctly rejects past bookings).
CREATE TABLE orion_region.visits (
  clinic_id text NOT NULL REFERENCES orion_region.facilities(clinic_id), id text NOT NULL, patient_id text NOT NULL,
  staff_id text NOT NULL, room_id text NOT NULL, service_id text NOT NULL, scheduled_at timestamptz NOT NULL,
  status text NOT NULL CHECK(status IN ('scheduled','arrived','queued','called','in_service','completed','cancelled','no_show')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), updated_at timestamptz NOT NULL, duration_minutes integer NOT NULL CHECK(duration_minutes BETWEEN 5 AND 240),
  queue_order integer CHECK(queue_order>0), source text NOT NULL DEFAULT 'manual_training' CHECK(source='manual_training'),
  PRIMARY KEY(clinic_id,id), UNIQUE(clinic_id,id,patient_id), FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_region.patient_details(clinic_id,patient_id),
  FOREIGN KEY(clinic_id,staff_id) REFERENCES orion_crm.staff(clinic_id,id), FOREIGN KEY(clinic_id,room_id) REFERENCES orion_crm.rooms(clinic_id,id),
  FOREIGN KEY(clinic_id,service_id) REFERENCES orion_crm.services(clinic_id,id), CHECK((status='queued')=(queue_order IS NOT NULL))
);
CREATE UNIQUE INDEX regional_room_reserved ON orion_region.visits(clinic_id,room_id) WHERE status IN ('called','in_service');
CREATE UNIQUE INDEX regional_staff_reserved ON orion_region.visits(clinic_id,staff_id) WHERE status IN ('called','in_service');
CREATE SEQUENCE orion_region.queue_sequence AS integer START 1000;
CREATE FUNCTION orion_region.visit_state_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR (to_jsonb(NEW)-ARRAY['status','version','updated_at','queue_order']) IS DISTINCT FROM
    (to_jsonb(OLD)-ARRAY['status','version','updated_at','queue_order']) OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at OR NOT (
    (OLD.status='scheduled' AND NEW.status IN ('arrived','cancelled')) OR (OLD.status='arrived' AND NEW.status IN ('queued','cancelled')) OR
    (OLD.status='queued' AND NEW.status IN ('called','cancelled')) OR (OLD.status='called' AND NEW.status IN ('queued','in_service','cancelled')))
    THEN RAISE EXCEPTION 'REGIONAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER regional_visit_guard BEFORE UPDATE OR DELETE ON orion_region.visits FOR EACH ROW EXECUTE FUNCTION orion_region.visit_state_guard();
CREATE TABLE orion_region.stocks (
  clinic_id text NOT NULL REFERENCES orion_region.facilities(clinic_id), id text NOT NULL,
  drug_name text NOT NULL, unit text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 0 AND 10000000),
  reorder_point integer NOT NULL CHECK(reorder_point>=0), batch text NOT NULL, expires_at date NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(clinic_id,id)
);
CREATE TABLE orion_region.prescriptions (
  clinic_id text NOT NULL, id text NOT NULL, patient_id text NOT NULL, stock_id text NOT NULL,
  dose text NOT NULL, instructions text NOT NULL, quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 1000),
  status text NOT NULL CHECK(status IN ('approved','dispensed')), prescribed_by text NOT NULL,
  prescribed_at timestamptz NOT NULL, dispensed_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  PRIMARY KEY(clinic_id,id), FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_region.patient_details(clinic_id,patient_id),
  FOREIGN KEY(clinic_id,stock_id) REFERENCES orion_region.stocks(clinic_id,id),
  CHECK((status='dispensed')=(dispensed_at IS NOT NULL))
);
CREATE TABLE orion_region.labs (
  clinic_id text NOT NULL, id text NOT NULL, patient_id text NOT NULL, name text NOT NULL,
  priority text NOT NULL CHECK(priority IN ('routine','urgent')), status text NOT NULL CHECK(status IN ('ordered','ready','reviewed')),
  ordered_at timestamptz NOT NULL, due_at timestamptz NOT NULL, result text, unit text, reference text NOT NULL,
  completed_at timestamptz, reviewed_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK(version>0),
  PRIMARY KEY(clinic_id,id), FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_region.patient_details(clinic_id,patient_id),
  CHECK((status<>'ordered')=(completed_at IS NOT NULL AND result IS NOT NULL AND unit IS NOT NULL)),
  CHECK((status='reviewed')=(reviewed_at IS NOT NULL)), CHECK(length(result)<=1000), CHECK(length(unit)<=40)
);
CREATE TABLE orion_region.procurements (
  clinic_id text NOT NULL, id text NOT NULL, stock_id text NOT NULL, supplier text NOT NULL,
  quantity integer NOT NULL CHECK(quantity BETWEEN 1 AND 100000), amount_kzt numeric(14,2) NOT NULL CHECK(amount_kzt BETWEEN 0 AND 1000000000),
  status text NOT NULL CHECK(status IN ('ordered','received')), ordered_at timestamptz NOT NULL, due_at timestamptz NOT NULL,
  received_at timestamptz, version integer NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(clinic_id,id),
  FOREIGN KEY(clinic_id,stock_id) REFERENCES orion_region.stocks(clinic_id,id),
  CHECK((status='received')=(received_at IS NOT NULL))
);
CREATE TABLE orion_region.work_tasks (
  clinic_id text NOT NULL REFERENCES orion_region.facilities(clinic_id), id text NOT NULL,
  patient_id text, visit_id text, owner_id text NOT NULL, title text NOT NULL CHECK(length(title) BETWEEN 1 AND 1000),
  category text NOT NULL CHECK(category IN ('care','laboratory','pharmacy','procurement')),
  priority text NOT NULL CHECK(priority IN ('routine','urgent')), status text NOT NULL CHECK(status IN ('pending','in_progress','completed','escalated')),
  due_at timestamptz NOT NULL, completed_at timestamptz, created_at timestamptz NOT NULL,
  version integer NOT NULL DEFAULT 1 CHECK(version>0), PRIMARY KEY(clinic_id,id),
  FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_region.patient_details(clinic_id,patient_id),
  FOREIGN KEY(clinic_id,visit_id,patient_id) REFERENCES orion_region.visits(clinic_id,id,patient_id),
  FOREIGN KEY(clinic_id,owner_id) REFERENCES orion_crm.staff(clinic_id,id),
  CHECK(visit_id IS NULL OR patient_id IS NOT NULL), CHECK((status='completed')=(completed_at IS NOT NULL))
);
CREATE INDEX regional_tasks_due ON orion_region.work_tasks(clinic_id,status,due_at);
CREATE INDEX regional_labs_patient ON orion_region.labs(clinic_id,patient_id);
CREATE INDEX regional_rx_patient ON orion_region.prescriptions(clinic_id,patient_id);
CREATE TABLE orion_region.audit_events (
  id text PRIMARY KEY DEFAULT 'regional-event-'||gen_random_uuid(), user_id text NOT NULL REFERENCES orion_directory.accounts(id),
  facility_id text REFERENCES orion_region.facilities(id), action text NOT NULL, resource_id text NOT NULL,
  before_state jsonb, after_state jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX regional_audit_facility ON orion_region.audit_events(facility_id,created_at DESC);
CREATE TABLE orion_region.ai_briefings (
  id text PRIMARY KEY DEFAULT 'briefing-'||gen_random_uuid(), user_id text NOT NULL REFERENCES orion_directory.accounts(id),
  scope_type text NOT NULL CHECK(scope_type IN ('region','district','facility')), scope_id text NOT NULL,
  provider text NOT NULL CHECK(provider='groq'), model text NOT NULL CHECK(length(model) BETWEEN 1 AND 120),
  policy_version text NOT NULL DEFAULT 'regional-kpi-v1' CHECK(policy_version='regional-kpi-v1'),
  source_hash text NOT NULL CHECK(source_hash~'^[a-f0-9]{64}$'), summary text NOT NULL CHECK(length(summary) BETWEEN 1 AND 900),
  priorities text[] NOT NULL CHECK(cardinality(priorities)<=5), status text NOT NULL DEFAULT 'draft' CHECK(status='draft'),
  generated_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE orion_region.command_receipts (
  facility_id text NOT NULL REFERENCES orion_region.facilities(id), user_id text NOT NULL REFERENCES orion_directory.accounts(id),
  idempotency_key uuid NOT NULL, request_hash text NOT NULL, result jsonb NOT NULL,
  PRIMARY KEY(facility_id,user_id,idempotency_key)
);
CREATE TABLE orion_region.stock_movements (
  clinic_id text NOT NULL, id text NOT NULL DEFAULT 'movement-'||gen_random_uuid(), stock_id text NOT NULL,
  delta integer NOT NULL CHECK(delta<>0), balance integer NOT NULL CHECK(balance>=0), resource_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('dispensed','received')), user_id text NOT NULL REFERENCES orion_directory.accounts(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(clinic_id,id),
  FOREIGN KEY(clinic_id,stock_id) REFERENCES orion_region.stocks(clinic_id,id)
);
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['districts','facilities','network_grants','patient_details','conditions','patient_history','visits','stocks','prescriptions','labs','procurements','work_tasks','audit_events','ai_briefings','command_receipts','stock_movements'] LOOP
    EXECUTE format('ALTER TABLE orion_region.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['patient_history','audit_events','ai_briefings','command_receipts','stock_movements'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON orion_region.%I FOR EACH ROW EXECUTE FUNCTION orion_clinical.reject_history_change()',t);
  END LOOP;
END $$;
CREATE FUNCTION orion_region.require_user(p_issuer text,p_subject text) RETURNS text LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM orion_directory.runtime WHERE id=1 AND source='postgres' AND import_complete) THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  SELECT id INTO actor FROM orion_directory.accounts WHERE issuer=p_issuer AND subject=p_subject AND status='active' FOR SHARE;
  IF actor IS NULL OR NOT EXISTS(SELECT 1 FROM orion_directory.memberships m JOIN orion_crm.clinics c ON c.id=m.clinic_id AND c.active WHERE m.user_id=actor AND m.status='active' AND m.interactive) THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  RETURN actor;
END $$;
CREATE FUNCTION orion_region.admin_assignment(p_user text) RETURNS orion_directory.current_assignments LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE g orion_region.network_grants; a orion_directory.current_assignments;
BEGIN
  SELECT * INTO g FROM orion_region.network_grants WHERE user_id=p_user AND active FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  -- Directory changes lock their clinic before changing assignments; shared clinic
  -- lock plus a fresh assignment query prevents a revocation race. No role union.
  PERFORM 1 FROM orion_crm.clinics WHERE id=g.anchor_clinic_id AND active FOR SHARE;
  SELECT * INTO a FROM orion_directory.current_assignments WHERE clinic_id=g.anchor_clinic_id AND user_id=p_user
    AND 'administrator'=ANY(roles) AND 'access.manage'=ANY(permissions) ORDER BY effective_from DESC,id LIMIT 1;
  RETURN a;
END $$;
CREATE FUNCTION orion_region.require_actor(p_issuer text,p_subject text,p_manage boolean) RETURNS text LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor text:=orion_region.require_user(p_issuer,p_subject); a orion_directory.current_assignments;
BEGIN
  a:=orion_region.admin_assignment(actor);
  IF a.id IS NULL OR (p_manage AND NOT EXISTS(SELECT 1 FROM orion_region.network_grants WHERE user_id=actor AND active AND can_manage)) THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  RETURN actor;
END $$;
CREATE FUNCTION orion_region.facility_access(p_issuer text,p_subject text,p_facility text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor text:=orion_region.require_user(p_issuer,p_subject); a orion_directory.current_assignments; f orion_region.facilities; writable boolean:=true; caps jsonb;
BEGIN
  a:=orion_region.admin_assignment(actor);
  SELECT * INTO f FROM orion_region.facilities WHERE id=p_facility AND data_mode='training';
  IF NOT FOUND THEN
    IF a.id IS NULL THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
    RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404';
  END IF;
  PERFORM 1 FROM orion_crm.clinics WHERE id=f.clinic_id AND active FOR SHARE;
  IF a.id IS NOT NULL THEN
    SELECT can_manage INTO writable FROM orion_region.network_grants WHERE user_id=actor AND active;
  ELSE
    SELECT * INTO a FROM orion_directory.current_assignments WHERE clinic_id=f.clinic_id AND user_id=actor
      AND ('clinic.dashboard.read'=ANY(permissions) OR ('administrator'=ANY(roles) AND 'access.manage'=ANY(permissions))) ORDER BY effective_from DESC,id LIMIT 1;
  END IF;
  IF a.id IS NULL OR NOT EXISTS(SELECT 1 FROM orion_crm.clinics WHERE id=f.clinic_id AND active AND mode='synthetic_simulation') THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  caps:=jsonb_build_object('readPatients','patient.directory.read'=ANY(a.permissions),'readClinical','patient.directory.read'=ANY(a.permissions) AND 'encounter.read'=ANY(a.permissions),
    'manageVisits',writable AND 'scheduling.manage'=ANY(a.permissions) AND 'patient.directory.read'=ANY(a.permissions),
    'startVisits',writable AND 'doctor'=ANY(a.roles) AND 'encounter.manage'=ANY(a.permissions) AND 'encounter.read'=ANY(a.permissions) AND 'patient.directory.read'=ANY(a.permissions),
    'manageTasks',writable AND (('care.manage'=ANY(a.permissions) AND 'patient.directory.read'=ANY(a.permissions) AND 'encounter.read'=ANY(a.permissions)) OR ('administrator'=ANY(a.roles) AND 'access.manage'=ANY(a.permissions))),
    'manageLabs',writable AND 'orders.manage'=ANY(a.permissions) AND 'encounter.read'=ANY(a.permissions) AND 'patient.directory.read'=ANY(a.permissions),
    'reviewLabs',writable AND 'doctor'=ANY(a.roles) AND 'orders.manage'=ANY(a.permissions) AND 'encounter.read'=ANY(a.permissions) AND 'patient.directory.read'=ANY(a.permissions),
    'dispense',writable AND 'orders.manage'=ANY(a.permissions) AND 'encounter.read'=ANY(a.permissions) AND 'patient.directory.read'=ANY(a.permissions),
    'receiveProcurement',writable AND 'administrator'=ANY(a.roles) AND 'access.manage'=ANY(a.permissions));
  RETURN jsonb_build_object('userId',actor,'assignmentId',a.id,'capabilities',caps||jsonb_build_object('manage',
    EXISTS(SELECT 1 FROM jsonb_each(caps) x WHERE x.key NOT IN ('readPatients','readClinical') AND x.value='true'::jsonb)));
END $$;
CREATE FUNCTION public.orion_regional_scope_v1(p_issuer text,p_subject text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text:=orion_region.require_user(p_issuer,p_subject); a orion_directory.current_assignments; f record; access jsonb; visible jsonb:='[]';
BEGIN
  IF (SELECT count(*) FROM orion_region.facilities)>200 THEN RAISE EXCEPTION 'REGIONAL_LIMIT' USING ERRCODE='PT503'; END IF;
  a:=orion_region.admin_assignment(actor);
  FOR f IN SELECT x.* FROM orion_region.facilities x JOIN orion_crm.clinics c ON c.id=x.clinic_id AND c.active AND c.mode='synthetic_simulation'
    WHERE x.data_mode='training' AND (a.id IS NOT NULL OR EXISTS(SELECT 1 FROM orion_directory.current_assignments s WHERE s.clinic_id=x.clinic_id AND s.user_id=actor
      AND ('clinic.dashboard.read'=ANY(s.permissions) OR ('administrator'=ANY(s.roles) AND 'access.manage'=ANY(s.permissions))))) ORDER BY x.name LOOP
    access:=orion_region.facility_access(p_issuer,p_subject,f.id);
    visible:=visible||jsonb_build_array(jsonb_build_object('id',f.id,'name',f.name,'kind',f.kind,'clinicId',f.clinic_id,'districtId',f.district_id,'canManage',(access->'capabilities'->>'manage')::boolean));
  END LOOP;
  INSERT INTO orion_region.audit_events(user_id,action,resource_id,after_state) VALUES(actor,'regional.scope.read',actor,'{}');
  RETURN jsonb_build_object('schemaVersion',1,'canViewRegion',a.id IS NOT NULL,'facilities',visible,'generatedAt',orion_crm.iso(clock_timestamp()));
END $$;
CREATE FUNCTION orion_region.metrics(p_clinic text) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  WITH task AS (SELECT count(*)::int total, count(*) FILTER(WHERE status='completed')::int completed,
    count(*) FILTER(WHERE status<>'completed')::int open,
    count(*) FILTER(WHERE status<>'completed' AND due_at<statement_timestamp())::int overdue,
    count(*) FILTER(WHERE due_at>=statement_timestamp()-interval '30 days' AND due_at<=statement_timestamp())::int due,
    count(*) FILTER(WHERE due_at>=statement_timestamp()-interval '30 days' AND due_at<=statement_timestamp() AND status='completed' AND completed_at<=due_at)::int ontime
    FROM orion_region.work_tasks WHERE clinic_id=p_clinic)
  SELECT jsonb_build_object('hospitalCount',CASE WHEN f.kind='hospital' THEN 1 ELSE 0 END,'polyclinicCount',CASE WHEN f.kind='polyclinic' THEN 1 ELSE 0 END,
    'patientCount',(SELECT count(*)::int FROM orion_region.patient_details WHERE clinic_id=p_clinic),
    'activeVisits',(SELECT count(*)::int FROM orion_region.visits WHERE clinic_id=p_clinic AND status NOT IN ('completed','cancelled','no_show')),
    'queuedVisits',(SELECT count(*)::int FROM orion_region.visits WHERE clinic_id=p_clinic AND status='queued'),
    'openTasks',task.open,'overdueTasks',task.overdue,'completedTasks',task.completed,'totalTasks',task.total,
    'onTimeTasks',task.ontime,'dueTasks',task.due,'kpiPercent',CASE WHEN task.due=0 THEN NULL ELSE round(100.0*task.ontime/task.due,1) END)
  FROM orion_region.facilities f CROSS JOIN task WHERE f.clinic_id=p_clinic
$$;
CREATE FUNCTION orion_region.facility_json(p_facility text) RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object('id',f.id,'districtId',f.district_id,'clinicId',f.clinic_id,'name',f.name,'kind',f.kind,
    'latitude',f.latitude,'longitude',f.longitude,'address',f.address,
    'populated',EXISTS(SELECT 1 FROM orion_region.patient_details WHERE clinic_id=f.clinic_id))||orion_region.metrics(f.clinic_id)
  FROM orion_region.facilities f JOIN orion_crm.clinics c ON c.id=f.clinic_id AND c.active AND c.mode='synthetic_simulation' WHERE f.id=p_facility AND f.data_mode='training'
$$;
CREATE FUNCTION orion_region.aggregate_metrics(p_values jsonb) RETURNS jsonb LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  WITH totals AS (SELECT k,sum((v->>k)::integer)::integer n FROM jsonb_array_elements(p_values) v CROSS JOIN unnest(ARRAY[
    'hospitalCount','polyclinicCount','patientCount','activeVisits','queuedVisits','openTasks','overdueTasks','completedTasks','totalTasks','onTimeTasks','dueTasks']) k GROUP BY k),
    result AS (SELECT coalesce(jsonb_object_agg(k,n),'{}') r FROM totals)
  SELECT jsonb_build_object('hospitalCount',0,'polyclinicCount',0,'patientCount',0,'activeVisits',0,'queuedVisits',0,
    'openTasks',0,'overdueTasks',0,'completedTasks',0,'totalTasks',0,'onTimeTasks',0,'dueTasks',0)||r||jsonb_build_object('kpiPercent',
    CASE WHEN coalesce((r->>'dueTasks')::integer,0)=0 THEN NULL ELSE round(100.0*(r->>'onTimeTasks')::integer/(r->>'dueTasks')::integer,1) END) FROM result
$$;
CREATE FUNCTION public.orion_regional_overview_v1(p_issuer text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text:=orion_region.require_actor(p_issuer,p_subject,false); fs jsonb; ds jsonb; insights jsonb;
BEGIN
  IF (SELECT count(*) FROM orion_region.facilities)>200 OR (SELECT count(*) FROM orion_region.districts)>30 THEN RAISE EXCEPTION 'REGIONAL_LIMIT' USING ERRCODE='PT503'; END IF;
  SELECT coalesce(jsonb_agg(orion_region.facility_json(id) ORDER BY id) FILTER(WHERE orion_region.facility_json(id) IS NOT NULL),'[]') INTO fs FROM orion_region.facilities;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'name',d.name,'kind',d.kind,'regionId',d.region_id)||
    orion_region.aggregate_metrics((SELECT coalesce(jsonb_agg(f),'[]') FROM jsonb_array_elements(fs) f WHERE f->>'districtId'=d.id)) ORDER BY d.id),'[]') INTO ds FROM orion_region.districts d;
  SELECT coalesce(jsonb_agg(value ORDER BY value->>'id'),'[]') INTO insights FROM (
    SELECT jsonb_build_object('id','due-'||(f->>'id'),'severity','warning','title','Есть просроченные задачи','detail',
      (f->>'name')||': '||(f->>'overdueTasks')||' задач требуют проверки срока и ответственного.','facilityId',f->>'id','districtId',f->>'districtId') value
    FROM jsonb_array_elements(fs) f WHERE (f->>'overdueTasks')::integer>0 ORDER BY (f->>'overdueTasks')::integer DESC LIMIT 20) q;
  INSERT INTO orion_region.audit_events(user_id,action,resource_id,after_state) VALUES(actor,'regional.overview.read','turkestan','{}');
  RETURN jsonb_build_object('schemaVersion',1,'dataMode','training','generatedAt',orion_crm.iso(clock_timestamp()),'districts',ds,'facilities',fs,
    'totals',orion_region.aggregate_metrics((SELECT coalesce(jsonb_agg(d),'[]') FROM jsonb_array_elements(ds) d WHERE d->>'regionId'='turkestan')),
    'insights',insights,'sourceNote','Ручной учебный набор в PostgreSQL. Организации, пациенты и показатели не являются официальной статистикой; Шымкент учитывается отдельно.',
    'kpiDefinition',jsonb_build_object('title','Задачи, выполненные в срок','formula','Выполнено к сроку / все задачи со сроком в последние 30 дней × 100%',
      'periodStart',orion_crm.iso(statement_timestamp()-interval '30 days'),'periodEnd',orion_crm.iso(statement_timestamp())));
END $$;
CREATE FUNCTION public.orion_regional_facility_v1(p_issuer text,p_subject text,p_facility text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; access jsonb; caps jsonb; f orion_region.facilities; result jsonb; crm jsonb;
BEGIN
  access:=orion_region.facility_access(p_issuer,p_subject,p_facility);actor:=access->>'userId';caps:=access->'capabilities';
  SELECT * INTO f FROM orion_region.facilities WHERE id=p_facility AND data_mode='training';
  IF NOT FOUND OR orion_region.facility_json(p_facility) IS NULL THEN RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  IF (SELECT count(*) FROM orion_crm.patients WHERE clinic_id=f.clinic_id)>1000 OR
    (SELECT count(*) FROM orion_region.visits WHERE clinic_id=f.clinic_id)>1000 OR
    (SELECT count(*) FROM orion_region.work_tasks WHERE clinic_id=f.clinic_id)>2000 OR
    (SELECT count(*) FROM orion_region.labs WHERE clinic_id=f.clinic_id)>2000 OR
    (SELECT count(*) FROM orion_region.prescriptions WHERE clinic_id=f.clinic_id)>2000 THEN RAISE EXCEPTION 'REGIONAL_LIMIT' USING ERRCODE='PT503'; END IF;
  SELECT jsonb_build_object('schemaVersion',1,'mode','synthetic_simulation','clinic',jsonb_build_object('id',c.id,'name',c.name),
    'generatedAt',orion_crm.iso(clock_timestamp()),'capabilities',jsonb_build_object('read',true,'manage',false),
    'buildings',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'x',x,'y',y,'width',width,'depth',depth) ORDER BY id),'[]') FROM orion_crm.buildings WHERE clinic_id=c.id),
    'rooms',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'name',r.name,'kind',r.kind,'x',r.x,'y',r.y,'width',r.width,'depth',r.depth,'buildingId',b.building_id) ORDER BY r.id),'[]') FROM orion_crm.rooms r JOIN orion_crm.room_buildings b ON b.clinic_id=r.clinic_id AND b.room_id=r.id WHERE r.clinic_id=c.id),
    'staff',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'role',role,'roomId',room_id) ORDER BY id),'[]') FROM orion_crm.staff WHERE clinic_id=c.id),
    'services',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'name',name,'durationMinutes',duration_minutes,'roomKind',room_kind) ORDER BY id),'[]') FROM orion_crm.services WHERE clinic_id=c.id),
    'patients',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'mrn',p.mrn,'sex',p.sex,'birthDate',d.birth_date::text,'registrationSource','manual_training') ORDER BY p.id),'[]') FROM orion_crm.patients p JOIN orion_region.patient_details d ON d.clinic_id=p.clinic_id AND d.patient_id=p.id WHERE p.clinic_id=c.id),
    'visits',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'patientId',v.patient_id,'staffId',v.staff_id,'roomId',v.room_id,'serviceId',v.service_id,
      'scheduledAt',orion_crm.iso(v.scheduled_at),'status',v.status,'version',v.version,'updatedAt',orion_crm.iso(v.updated_at),'durationMinutes',v.duration_minutes,
      'queueOrder',v.queue_order) ORDER BY v.scheduled_at,v.id),'[]') FROM orion_region.visits v WHERE v.clinic_id=c.id),
    'tasks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'visitId',visit_id,'patientId',patient_id,'ownerId',owner_id,'kind','follow_up',
      'title',title,'priority',priority,'dueAt',orion_crm.iso(due_at),'status',status,'version',version) ORDER BY due_at,id),'[]') FROM orion_region.work_tasks WHERE clinic_id=c.id AND visit_id IS NOT NULL),
    'events','[]'::jsonb) INTO crm FROM orion_crm.clinics c WHERE c.id=f.clinic_id;
  SELECT jsonb_build_object('schemaVersion',1,'dataMode','training','facility',orion_region.facility_json(f.id),'crm',crm,
    'capabilities',caps,'generatedAt',orion_crm.iso(clock_timestamp()),
    'kpiDefinition',jsonb_build_object('title','Задачи, выполненные в срок','formula','Выполнено к сроку / все задачи со сроком в последние 30 дней × 100%',
      'periodStart',orion_crm.iso(statement_timestamp()-interval '30 days'),'periodEnd',orion_crm.iso(statement_timestamp())),
    'insights',CASE WHEN (orion_region.metrics(f.clinic_id)->>'overdueTasks')::integer>0 THEN jsonb_build_array(jsonb_build_object('id','due-'||f.id,'severity','warning',
      'title','Есть просроченные задачи','detail',(orion_region.metrics(f.clinic_id)->>'overdueTasks')||' задач требуют проверки срока и ответственного.','facilityId',f.id,'districtId',f.district_id)) ELSE '[]'::jsonb END,
    'medicalRecords',(SELECT coalesce(jsonb_agg(jsonb_build_object('patientId',d.patient_id,'trainingIin',d.training_iin,'birthDate',d.birth_date::text,'allergies',to_jsonb(d.allergies),
      'conditions',(SELECT coalesce(jsonb_agg(jsonb_build_object('code',x.code,'name',x.name,'since',x.since::text,'status',x.status) ORDER BY x.since DESC),'[]') FROM orion_region.conditions x WHERE x.clinic_id=d.clinic_id AND x.patient_id=d.patient_id),
      'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',x.id,'date',orion_crm.iso(x.recorded_at),'title',x.title,'detail',x.detail,'doctor',x.doctor) ORDER BY x.recorded_at DESC),'[]') FROM orion_region.patient_history x WHERE x.clinic_id=d.clinic_id AND x.patient_id=d.patient_id)) ORDER BY d.patient_id),'[]') FROM orion_region.patient_details d WHERE d.clinic_id=f.clinic_id),
    'prescriptions',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'patientId',p.patient_id,'stockId',p.stock_id,'drugName',s.drug_name,'dose',p.dose,'instructions',p.instructions,'quantity',p.quantity,'status',p.status,'prescribedBy',p.prescribed_by,'prescribedAt',orion_crm.iso(p.prescribed_at),'dispensedAt',orion_crm.iso(p.dispensed_at),'version',p.version) ORDER BY p.id),'[]') FROM orion_region.prescriptions p JOIN orion_region.stocks s ON s.clinic_id=p.clinic_id AND s.id=p.stock_id WHERE p.clinic_id=f.clinic_id),
    'labs',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'patientId',patient_id,'name',name,'priority',priority,'status',status,'orderedAt',orion_crm.iso(ordered_at),'dueAt',orion_crm.iso(due_at),'result',labs.result,'unit',unit,'reference',reference,'completedAt',orion_crm.iso(completed_at),'reviewedAt',orion_crm.iso(reviewed_at),'version',version) ORDER BY due_at,id),'[]') FROM orion_region.labs WHERE clinic_id=f.clinic_id),
    'stocks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'drugName',drug_name,'unit',unit,'quantity',quantity,'reorderPoint',reorder_point,'batch',batch,'expiresAt',expires_at::text,'version',version) ORDER BY id),'[]') FROM orion_region.stocks WHERE clinic_id=f.clinic_id),
    'procurements',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'stockId',p.stock_id,'drugName',s.drug_name,'supplier',p.supplier,'quantity',p.quantity,'amountKzt',p.amount_kzt,'status',p.status,'orderedAt',orion_crm.iso(p.ordered_at),'dueAt',orion_crm.iso(p.due_at),'receivedAt',orion_crm.iso(p.received_at),'version',p.version) ORDER BY p.due_at,p.id),'[]') FROM orion_region.procurements p JOIN orion_region.stocks s ON s.clinic_id=p.clinic_id AND s.id=p.stock_id WHERE p.clinic_id=f.clinic_id),
    'workTasks',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'patientId',patient_id,'visitId',visit_id,'ownerId',owner_id,'title',title,'category',category,'priority',priority,'status',status,'dueAt',orion_crm.iso(due_at),'completedAt',orion_crm.iso(completed_at),'version',version) ORDER BY due_at,id),'[]') FROM orion_region.work_tasks WHERE clinic_id=f.clinic_id),
    'events',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'action',e.action,'resourceId',e.resource_id,'actorLabel',a.display_name,'createdAt',orion_crm.iso(e.created_at)) ORDER BY e.created_at DESC),'[]') FROM
      (SELECT * FROM orion_region.audit_events WHERE facility_id=f.id AND action NOT LIKE '%.read' ORDER BY created_at DESC LIMIT 50) e JOIN orion_directory.accounts a ON a.id=e.user_id)) INTO result;
  IF NOT (caps->>'readClinical')::boolean THEN
    crm:=crm||jsonb_build_object('tasks','[]'::jsonb);
    result:=result||jsonb_build_object('crm',crm,'medicalRecords','[]'::jsonb,'prescriptions','[]'::jsonb,'labs','[]'::jsonb);
  END IF;
  IF NOT (caps->>'receiveProcurement')::boolean THEN result:=result||jsonb_build_object('procurements','[]'::jsonb); END IF;
  IF NOT (caps->>'readPatients')::boolean THEN
    result:=result||jsonb_build_object('crm',crm||jsonb_build_object('patients','[]'::jsonb,'visits','[]'::jsonb,'tasks','[]'::jsonb));
  END IF;
  result:=result||jsonb_build_object(
    'workTasks',(SELECT coalesce(jsonb_agg(x),'[]') FROM jsonb_array_elements(result->'workTasks') x
      WHERE ((caps->>'readClinical')::boolean OR (x->'patientId'='null'::jsonb AND x->>'category'='procurement')) AND ((caps->>'receiveProcurement')::boolean OR x->>'category'<>'procurement')),
    'events',(SELECT coalesce(jsonb_agg(x),'[]') FROM jsonb_array_elements(result->'events') x WHERE
      (x->>'action' IN ('task.transition','lab.complete','lab.review','prescription.dispense') AND (caps->>'readClinical')::boolean) OR
      (x->>'action'='visit.transition' AND (caps->>'readPatients')::boolean) OR
      (x->>'action'='procurement.receive' AND (caps->>'receiveProcurement')::boolean) OR x->>'action'='regional.briefing.draft'));
  IF octet_length(result::text)>2097152 THEN RAISE EXCEPTION 'REGIONAL_LIMIT' USING ERRCODE='PT503'; END IF;
  INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,after_state) VALUES(actor,f.id,'regional.facility.read',f.id,'{}');
  RETURN result;
END $$;
CREATE FUNCTION public.orion_regional_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; access jsonb; capability text; f orion_region.facilities; kind text:=p_command->>'type'; allowed text[]; field text; key uuid; hash text;
  receipt orion_region.command_receipts; t orion_region.work_tasks; l orion_region.labs; rx orion_region.prescriptions; v orion_region.visits; next_status text;
  po orion_region.procurements; stock orion_region.stocks; before_value jsonb; after_value jsonb; result jsonb; resource text; revision integer;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>8192 OR kind IS NULL OR kind NOT IN ('visit.transition','task.transition','lab.complete','lab.review','prescription.dispense','procurement.receive') THEN RAISE EXCEPTION 'REGIONAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  allowed:=ARRAY['type','facilityId','expectedVersion','idempotencyKey']||CASE kind
    WHEN 'visit.transition' THEN ARRAY['visitId','action'] WHEN 'task.transition' THEN ARRAY['taskId','status'] WHEN 'lab.complete' THEN ARRAY['labId','result','unit'] WHEN 'lab.review' THEN ARRAY['labId']
    WHEN 'prescription.dispense' THEN ARRAY['prescriptionId'] WHEN 'procurement.receive' THEN ARRAY['procurementId'] END;
  IF allowed IS NULL OR EXISTS(SELECT 1 FROM unnest(allowed) k WHERE NOT p_command?k) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE NOT k=ANY(allowed)) THEN RAISE EXCEPTION 'REGIONAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  FOREACH field IN ARRAY allowed LOOP
    IF field<>'expectedVersion' AND (jsonb_typeof(p_command->field) IS DISTINCT FROM 'string' OR length(p_command->>field)>1000) THEN RAISE EXCEPTION 'REGIONAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END LOOP;
  IF jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' OR (p_command->>'expectedVersion')!~'^[1-9][0-9]{0,9}$' OR (p_command->>'expectedVersion')::numeric>2147483647 OR
    (p_command->>'idempotencyKey')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' THEN RAISE EXCEPTION 'REGIONAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  access:=orion_region.facility_access(p_issuer,p_subject,p_command->>'facilityId');actor:=access->>'userId';
  capability:=CASE kind WHEN 'visit.transition' THEN CASE WHEN p_command->>'action'='start' THEN 'startVisits' ELSE 'manageVisits' END WHEN 'task.transition' THEN 'manageTasks' WHEN 'lab.complete' THEN 'manageLabs'
    WHEN 'lab.review' THEN 'reviewLabs' WHEN 'prescription.dispense' THEN 'dispense' WHEN 'procurement.receive' THEN 'receiveProcurement' END;
  IF NOT (access->'capabilities'->>capability)::boolean THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  SELECT * INTO f FROM orion_region.facilities WHERE id=p_command->>'facilityId' AND data_mode='training' FOR UPDATE;
  IF NOT FOUND OR orion_region.facility_json(f.id) IS NULL THEN RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  access:=orion_region.facility_access(p_issuer,p_subject,f.id);actor:=access->>'userId';
  IF NOT (access->'capabilities'->>capability)::boolean THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  -- Check resource-specific authority before idempotent replay as well as writes.
  IF kind='task.transition' THEN
    SELECT * INTO t FROM orion_region.work_tasks WHERE clinic_id=f.clinic_id AND id=p_command->>'taskId';
    IF FOUND AND (((t.patient_id IS NOT NULL OR t.category<>'procurement') AND NOT (access->'capabilities'->>'readClinical')::boolean) OR
      (t.category='procurement' AND NOT (access->'capabilities'->>'receiveProcurement')::boolean)) THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  END IF;
  key:=(p_command->>'idempotencyKey')::uuid; hash:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM orion_region.command_receipts WHERE facility_id=f.id AND user_id=actor AND idempotency_key=key;
  IF FOUND THEN
    IF receipt.request_hash<>hash THEN RAISE EXCEPTION 'REGIONAL_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
    RETURN receipt.result||jsonb_build_object('replayed',true);
  END IF;
  IF kind='visit.transition' THEN
    SELECT * INTO v FROM orion_region.visits WHERE clinic_id=f.clinic_id AND id=p_command->>'visitId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF v.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'REGIONAL_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    next_status:=CASE p_command->>'action' WHEN 'arrive' THEN 'arrived' WHEN 'queue' THEN 'queued' WHEN 'call' THEN 'called' WHEN 'requeue' THEN 'queued' WHEN 'start' THEN 'in_service' WHEN 'cancel' THEN 'cancelled' END;
    IF next_status IS NULL OR NOT ((v.status='scheduled' AND p_command->>'action' IN ('arrive','cancel')) OR
      (v.status='arrived' AND p_command->>'action' IN ('queue','cancel')) OR (v.status='queued' AND p_command->>'action' IN ('call','cancel')) OR
      (v.status='called' AND p_command->>'action' IN ('requeue','start','cancel'))) THEN RAISE EXCEPTION 'REGIONAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    IF next_status IN ('called','in_service') AND EXISTS(SELECT 1 FROM orion_region.visits q WHERE q.clinic_id=f.clinic_id AND q.id<>v.id AND q.status IN ('called','in_service') AND (q.room_id=v.room_id OR q.staff_id=v.staff_id OR q.patient_id=v.patient_id)) THEN RAISE EXCEPTION 'REGIONAL_CAPACITY_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF next_status='called' AND EXISTS(SELECT 1 FROM orion_region.visits q WHERE q.clinic_id=f.clinic_id AND q.status='queued' AND (q.room_id=v.room_id OR q.staff_id=v.staff_id) AND q.queue_order<v.queue_order) THEN RAISE EXCEPTION 'REGIONAL_QUEUE_CONFLICT' USING ERRCODE='PT409'; END IF;
    before_value:=to_jsonb(v);
    UPDATE orion_region.visits SET status=next_status,version=version+1,updated_at=clock_timestamp(),queue_order=CASE WHEN next_status='queued' THEN nextval('orion_region.queue_sequence') ELSE NULL END WHERE clinic_id=f.clinic_id AND id=v.id RETURNING * INTO v;
    resource:=v.id;revision:=v.version;after_value:=to_jsonb(v);
  ELSIF kind='task.transition' THEN
    SELECT * INTO t FROM orion_region.work_tasks WHERE clinic_id=f.clinic_id AND id=p_command->>'taskId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF t.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'REGIONAL_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF NOT ((t.status='pending' AND p_command->>'status' IN ('in_progress','escalated')) OR (t.status='in_progress' AND p_command->>'status' IN ('completed','escalated'))) THEN RAISE EXCEPTION 'REGIONAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    before_value:=to_jsonb(t);
    UPDATE orion_region.work_tasks SET status=p_command->>'status',version=version+1,completed_at=CASE WHEN p_command->>'status'='completed' THEN clock_timestamp() ELSE NULL END WHERE clinic_id=f.clinic_id AND id=t.id RETURNING * INTO t;
    resource:=t.id;revision:=t.version;after_value:=to_jsonb(t);
  ELSIF kind IN ('lab.complete','lab.review') THEN
    SELECT * INTO l FROM orion_region.labs WHERE clinic_id=f.clinic_id AND id=p_command->>'labId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF l.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'REGIONAL_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF (kind='lab.complete' AND l.status<>'ordered') OR (kind='lab.review' AND l.status<>'ready') THEN RAISE EXCEPTION 'REGIONAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    before_value:=to_jsonb(l);
    IF kind='lab.complete' THEN
      IF length(trim(p_command->>'result'))<1 OR length(p_command->>'unit')>40 THEN RAISE EXCEPTION 'REGIONAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      UPDATE orion_region.labs SET status='ready',result=trim(p_command->>'result'),unit=trim(p_command->>'unit'),completed_at=clock_timestamp(),version=version+1 WHERE clinic_id=f.clinic_id AND id=l.id RETURNING * INTO l;
    ELSE
      UPDATE orion_region.labs SET status='reviewed',reviewed_at=clock_timestamp(),version=version+1 WHERE clinic_id=f.clinic_id AND id=l.id RETURNING * INTO l;
    END IF;
    resource:=l.id;revision:=l.version;after_value:=to_jsonb(l);
  ELSIF kind='prescription.dispense' THEN
    SELECT * INTO rx FROM orion_region.prescriptions WHERE clinic_id=f.clinic_id AND id=p_command->>'prescriptionId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF rx.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'REGIONAL_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF rx.status<>'approved' THEN RAISE EXCEPTION 'REGIONAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    SELECT * INTO STRICT stock FROM orion_region.stocks WHERE clinic_id=f.clinic_id AND id=rx.stock_id FOR UPDATE;
    IF stock.quantity<rx.quantity OR stock.expires_at<current_date THEN RAISE EXCEPTION 'REGIONAL_STOCK_UNAVAILABLE' USING ERRCODE='PT409'; END IF;
    before_value:=to_jsonb(rx);
    UPDATE orion_region.stocks SET quantity=quantity-rx.quantity,version=version+1 WHERE clinic_id=f.clinic_id AND id=stock.id RETURNING * INTO stock;
    UPDATE orion_region.prescriptions SET status='dispensed',dispensed_at=clock_timestamp(),version=version+1 WHERE clinic_id=f.clinic_id AND id=rx.id RETURNING * INTO rx;
    INSERT INTO orion_region.stock_movements(clinic_id,stock_id,delta,balance,resource_id,kind,user_id) VALUES(f.clinic_id,stock.id,-rx.quantity,stock.quantity,rx.id,'dispensed',actor);
    resource:=rx.id;revision:=rx.version;after_value:=to_jsonb(rx);
  ELSE
    SELECT * INTO po FROM orion_region.procurements WHERE clinic_id=f.clinic_id AND id=p_command->>'procurementId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF po.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'REGIONAL_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF po.status<>'ordered' THEN RAISE EXCEPTION 'REGIONAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    SELECT * INTO STRICT stock FROM orion_region.stocks WHERE clinic_id=f.clinic_id AND id=po.stock_id FOR UPDATE;
    IF stock.expires_at<current_date OR stock.quantity+po.quantity>10000000 THEN RAISE EXCEPTION 'REGIONAL_STOCK_UNAVAILABLE' USING ERRCODE='PT409'; END IF;
    before_value:=to_jsonb(po);
    UPDATE orion_region.stocks SET quantity=quantity+po.quantity,version=version+1 WHERE clinic_id=f.clinic_id AND id=stock.id RETURNING * INTO stock;
    UPDATE orion_region.procurements SET status='received',received_at=clock_timestamp(),version=version+1 WHERE clinic_id=f.clinic_id AND id=po.id RETURNING * INTO po;
    INSERT INTO orion_region.stock_movements(clinic_id,stock_id,delta,balance,resource_id,kind,user_id) VALUES(f.clinic_id,stock.id,po.quantity,stock.quantity,po.id,'received',actor);
    resource:=po.id;revision:=po.version;after_value:=to_jsonb(po);
  END IF;
  result:=jsonb_build_object('resourceId',resource,'version',revision,'replayed',false);
  INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,before_state,after_state) VALUES(actor,f.id,kind,resource,before_value,after_value);
  INSERT INTO orion_region.command_receipts VALUES(f.id,actor,key,hash,result);
  RETURN result;
END $$;
CREATE FUNCTION public.orion_regional_briefing_save_v1(p_issuer text,p_subject text,p_artifact jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; result_id text; field text; priorities text[];
  allowed text[]:=ARRAY['scopeType','scopeId','sourceHash','provider','model','summary','priorities','generatedAt'];
BEGIN
  IF jsonb_typeof(p_artifact) IS DISTINCT FROM 'object' OR octet_length(p_artifact::text)>8192 OR
    EXISTS(SELECT 1 FROM unnest(allowed) k WHERE NOT p_artifact?k) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_artifact) k WHERE NOT k=ANY(allowed)) THEN RAISE EXCEPTION 'REGIONAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  FOREACH field IN ARRAY ARRAY['scopeType','scopeId','sourceHash','provider','model','summary','generatedAt'] LOOP
    IF jsonb_typeof(p_artifact->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'REGIONAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END LOOP;
  IF (p_artifact->>'scopeType' NOT IN ('region','district','facility')) OR (p_artifact->>'provider')<>'groq' OR
    (p_artifact->>'sourceHash')!~'^[a-f0-9]{64}$' OR length(p_artifact->>'model') NOT BETWEEN 1 AND 120 OR
    length(trim(p_artifact->>'summary')) NOT BETWEEN 1 AND 900 OR jsonb_typeof(p_artifact->'priorities') IS DISTINCT FROM 'array' OR
    jsonb_array_length(p_artifact->'priorities')>5 OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_artifact->'priorities') x WHERE jsonb_typeof(x)<>'string' OR length(trim(x#>>'{}')) NOT BETWEEN 1 AND 300)
    THEN RAISE EXCEPTION 'REGIONAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  IF (p_artifact->>'scopeType'='region' AND p_artifact->>'scopeId'<>'turkestan') OR
    (p_artifact->>'scopeType'='district' AND NOT EXISTS(SELECT 1 FROM orion_region.districts WHERE id=p_artifact->>'scopeId')) OR
    (p_artifact->>'scopeType'='facility' AND orion_region.facility_json(p_artifact->>'scopeId') IS NULL) THEN RAISE EXCEPTION 'REGIONAL_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  IF p_artifact->>'scopeType'='facility' THEN actor:=orion_region.facility_access(p_issuer,p_subject,p_artifact->>'scopeId')->>'userId';
  ELSE actor:=orion_region.require_actor(p_issuer,p_subject,false); END IF;
  SELECT ARRAY(SELECT jsonb_array_elements_text(p_artifact->'priorities')) INTO priorities;
  INSERT INTO orion_region.ai_briefings(user_id,scope_type,scope_id,provider,model,source_hash,summary,priorities,generated_at)
    VALUES(actor,p_artifact->>'scopeType',p_artifact->>'scopeId','groq',p_artifact->>'model',p_artifact->>'sourceHash',p_artifact->>'summary',priorities,(p_artifact->>'generatedAt')::timestamptz) RETURNING id INTO result_id;
  INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,after_state) VALUES(actor,CASE WHEN p_artifact->>'scopeType'='facility' THEN p_artifact->>'scopeId' ELSE NULL END,'regional.briefing.draft',result_id,jsonb_build_object('sourceHash',p_artifact->>'sourceHash','scopeType',p_artifact->>'scopeType','scopeId',p_artifact->>'scopeId'));
  RETURN jsonb_build_object('id',result_id);
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA orion_region FROM PUBLIC,orion_crm_app;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_region FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_regional_scope_v1(text,text),public.orion_regional_overview_v1(text,text),public.orion_regional_facility_v1(text,text,text),public.orion_regional_command_v1(text,text,jsonb),public.orion_regional_briefing_save_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_regional_scope_v1(text,text),public.orion_regional_overview_v1(text,text),public.orion_regional_facility_v1(text,text,text),public.orion_regional_command_v1(text,text,jsonb),public.orion_regional_briefing_save_v1(text,text,jsonb) TO orion_crm_app;
COMMIT;
