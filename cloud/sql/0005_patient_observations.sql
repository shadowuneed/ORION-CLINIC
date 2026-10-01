-- PREPARED / UNMOUNTED. Forward only after0004; do not replay0001--0004.
-- Review this exact source and obtain migration-owner approval before applying.
-- Synthetic manual measurements only. No consent policy, diagnosis, thresholds,
-- alert classification, imports, owner bootstrap or changes to registry rights.
BEGIN;

CREATE FUNCTION orion_private.observation_id_ok(value text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT value IS NOT NULL AND orion_private.patient_utf16_length(value) BETWEEN 1 AND 160
    AND value=btrim(value) AND value !~ '[[:cntrl:]]'
$$;
CREATE FUNCTION orion_private.observation_clean_text(value text,minimum integer,maximum integer) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE result text:=btrim(value);
BEGIN
  IF result IS NULL OR orion_private.patient_utf16_length(result) NOT BETWEEN minimum AND maximum
    OR result ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
  RETURN result;
END $$;

CREATE TABLE orion_private.patient_observation_records (
  id text PRIMARY KEY CHECK(orion_private.observation_id_ok(id)),
  organization_id text NOT NULL,facility_id text NOT NULL,patient_id text NOT NULL,
  source_type text NOT NULL CHECK(source_type='manual_test'),
  source_label text NOT NULL CHECK(source_label='Облачный ручной ввод · тестовые данные'),
  created_by_membership_id text NOT NULL,access_assignment_id text NOT NULL,
  created_at bigint NOT NULL CHECK(created_at BETWEEN 946684800000 AND 9007199254740991),
  UNIQUE(organization_id,facility_id,id,patient_id),
  FOREIGN KEY(organization_id,facility_id,patient_id) REFERENCES orion_private.patients(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,created_by_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,access_assignment_id) REFERENCES orion_private.department_access_assignments(organization_id,facility_id,id)
);
CREATE TABLE orion_private.patient_observation_versions (
  id text PRIMARY KEY CHECK(orion_private.observation_id_ok(id)),
  organization_id text NOT NULL,facility_id text NOT NULL,patient_id text NOT NULL,observation_id text NOT NULL,
  version integer NOT NULL CHECK(version>0),supersedes_version_id text,
  measured_at bigint NOT NULL CHECK(measured_at BETWEEN 946684800000 AND 9007199254740991),
  measurement_context text NOT NULL CHECK(measurement_context IN ('pre_visit','consultation','follow_up','other')),
  height_mm integer CHECK(height_mm BETWEEN 400 AND 2500),
  weight_grams integer CHECK(weight_grams BETWEEN 1000 AND 500000),
  bmi_hundredths integer CHECK(bmi_hundredths BETWEEN 500 AND 10000),
  systolic_mmhg integer CHECK(systolic_mmhg BETWEEN 40 AND 300),
  diastolic_mmhg integer CHECK(diastolic_mmhg BETWEEN 20 AND 200),
  temperature_milli_c integer CHECK(temperature_milli_c BETWEEN 30000 AND 45000),
  note text CHECK(note IS NULL OR (note=orion_private.observation_clean_text(note,3,1000))),
  recorded_by_membership_id text NOT NULL,access_assignment_id text NOT NULL,
  recorded_by_display_name text NOT NULL CHECK(recorded_by_display_name=orion_private.observation_clean_text(recorded_by_display_name,2,300)),
  recorded_at bigint NOT NULL CHECK(recorded_at BETWEEN 946684800000 AND 9007199254740991),
  change_reason text NOT NULL CHECK(change_reason=orion_private.observation_clean_text(change_reason,3,500)),
  input_hash text NOT NULL CHECK(input_hash ~ '^[a-f0-9]{64}$'),
  UNIQUE(organization_id,facility_id,patient_id,observation_id,id),
  UNIQUE(organization_id,facility_id,patient_id,observation_id,version),
  UNIQUE(supersedes_version_id),
  FOREIGN KEY(organization_id,facility_id,observation_id,patient_id) REFERENCES orion_private.patient_observation_records(organization_id,facility_id,id,patient_id),
  FOREIGN KEY(organization_id,facility_id,recorded_by_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,access_assignment_id) REFERENCES orion_private.department_access_assignments(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,patient_id,observation_id,supersedes_version_id) REFERENCES orion_private.patient_observation_versions(organization_id,facility_id,patient_id,observation_id,id),
  CHECK((version=1 AND supersedes_version_id IS NULL) OR (version>1 AND supersedes_version_id IS NOT NULL)),
  CHECK((height_mm IS NULL AND weight_grams IS NULL AND bmi_hundredths IS NULL)
    OR (height_mm IS NOT NULL AND weight_grams IS NOT NULL AND bmi_hundredths IS NOT NULL
      AND bmi_hundredths=round(weight_grams::numeric*100000/(height_mm::numeric*height_mm)))),
  CHECK((systolic_mmhg IS NULL AND diastolic_mmhg IS NULL)
    OR (systolic_mmhg IS NOT NULL AND diastolic_mmhg IS NOT NULL AND systolic_mmhg>diastolic_mmhg)),
  CHECK(height_mm IS NOT NULL OR systolic_mmhg IS NOT NULL OR temperature_milli_c IS NOT NULL)
);
CREATE TABLE orion_private.patient_observation_heads (
  id text PRIMARY KEY CHECK(orion_private.observation_id_ok(id)),
  organization_id text NOT NULL,facility_id text NOT NULL,patient_id text NOT NULL,observation_id text NOT NULL,
  current_version_id text NOT NULL,lock_version integer NOT NULL CHECK(lock_version>0),
  updated_at bigint NOT NULL CHECK(updated_at BETWEEN 946684800000 AND 9007199254740991),
  UNIQUE(organization_id,facility_id,patient_id,observation_id),
  FOREIGN KEY(organization_id,facility_id,patient_id,observation_id,current_version_id) REFERENCES orion_private.patient_observation_versions(organization_id,facility_id,patient_id,observation_id,id)
);
-- Observation receipts do not widen the patient-only command_idempotency ledger.
-- Snapshot is the exact bounded command-time record, not a later mutable head.
CREATE TABLE orion_private.observation_command_receipts (
  id text PRIMARY KEY CHECK(orion_private.observation_id_ok(id)),
  organization_id text NOT NULL,facility_id text NOT NULL,patient_id text NOT NULL,
  actor_user_id text NOT NULL,actor_membership_id text NOT NULL,access_assignment_id text NOT NULL,
  operation text NOT NULL CHECK(operation IN ('observation.create','observation.correct')),
  idempotency_key uuid NOT NULL,request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  observation_id text NOT NULL,result_version_id text NOT NULL,result_version integer NOT NULL CHECK(result_version>0),
  response_record jsonb NOT NULL CHECK(jsonb_typeof(response_record)='object' AND octet_length(response_record::text)<=65536),
  created_at bigint NOT NULL CHECK(created_at BETWEEN 946684800000 AND 9007199254740991),
  UNIQUE(organization_id,facility_id,actor_membership_id,operation,idempotency_key),
  FOREIGN KEY(organization_id,facility_id,actor_membership_id,actor_user_id) REFERENCES orion_private.memberships(organization_id,facility_id,id,user_id),
  FOREIGN KEY(organization_id,facility_id,access_assignment_id) REFERENCES orion_private.department_access_assignments(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,patient_id,observation_id,result_version_id) REFERENCES orion_private.patient_observation_versions(organization_id,facility_id,patient_id,observation_id,id)
);
-- Head UNIQUE and version UNIQUE already serve scoped patient/history lookups
-- (including a descending version back-scan). Do not pay for duplicate indexes.
CREATE INDEX observation_versions_measured_idx ON orion_private.patient_observation_versions(organization_id,facility_id,patient_id,measured_at DESC,recorded_at DESC,observation_id,id);

CREATE FUNCTION orion_private.observation_scope(assignment_id text,facility_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE scope jsonb;
BEGIN
  IF NOT orion_private.observation_id_ok(assignment_id) OR (facility_id IS NOT NULL AND NOT orion_private.observation_id_ok(facility_id)) THEN
    RAISE EXCEPTION 'OBSERVATION_SCOPE_REQUIRED' USING ERRCODE='PT400'; END IF;
  scope:=orion_private.require_assignment(assignment_id,facility_id,'observations.manage');
  -- The selected assignment itself must have a clinical role. An administrator
  -- allow-list or a separate doctor's assignment cannot lend this role.
  IF NOT ((scope->'roles') ? 'doctor' OR (scope->'roles') ? 'nurse') THEN
    RAISE EXCEPTION 'OBSERVATION_ROLE_FORBIDDEN' USING ERRCODE='PT403'; END IF;
  RETURN scope||jsonb_build_object('observationRole',CASE WHEN (scope->'roles') ? 'doctor' THEN 'clinician' ELSE 'nurse' END);
END $$;
CREATE FUNCTION orion_private.observation_patient(scope jsonb,pat_id text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  IF NOT orion_private.observation_id_ok(pat_id) THEN RAISE EXCEPTION 'OBSERVATION_PATIENT_REQUIRED' USING ERRCODE='PT400'; END IF;
  SELECT jsonb_build_object('id',p.id,'displayName',v.display_name,'medicalRecordNumber',p.medical_record_number)
    INTO result FROM orion_private.patients p
    JOIN orion_private.patient_profile_heads h ON h.organization_id=p.organization_id AND h.facility_id=p.facility_id AND h.patient_id=p.id
    JOIN orion_private.patient_profile_versions v ON v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.patient_id=h.patient_id AND v.id=h.current_version_id
    WHERE p.organization_id=scope#>>'{organization,id}' AND p.facility_id=scope#>>'{facility,id}' AND p.id=pat_id AND v.status='active'
    FOR SHARE OF p,h,v;
  IF result IS NULL THEN RAISE EXCEPTION 'OBSERVATION_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  RETURN result;
END $$;
CREATE FUNCTION orion_private.observation_final_scope(scope jsonb,pat_id text) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE checked jsonb;
BEGIN
  checked:=orion_private.observation_scope(scope->>'assignmentId',scope#>>'{facility,id}');
  IF checked->>'assignmentVersionId' IS DISTINCT FROM scope->>'assignmentVersionId' THEN
    RAISE EXCEPTION 'ACCESS_ASSIGNMENT_FORBIDDEN' USING ERRCODE='PT403'; END IF;
  PERFORM orion_private.observation_patient(checked,pat_id);
END $$;

CREATE FUNCTION orion_private.observation_version_json(v orion_private.patient_observation_versions) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id',v.id,'version',v.version,'supersedesVersionId',v.supersedes_version_id,
    'measuredAt',v.measured_at,'context',v.measurement_context,
    'values',jsonb_build_object('heightCm',v.height_mm::numeric/10,'weightKg',v.weight_grams::numeric/1000,
      'bmi',v.bmi_hundredths::numeric/100,'systolicMmhg',v.systolic_mmhg,'diastolicMmhg',v.diastolic_mmhg,'temperatureC',v.temperature_milli_c::numeric/1000),
    'units',jsonb_build_object('height','cm','weight','kg','bmi','kg/m²','pressure','мм рт. ст.','temperature','°C'),
    'note',v.note,'sourceType','manual_test','sourceLabel','Облачный ручной ввод · тестовые данные',
    'recordedByMembershipId',v.recorded_by_membership_id,'accessAssignmentId',v.access_assignment_id,
    'recordedBy',v.recorded_by_display_name,'recordedAt',v.recorded_at,'changeReason',v.change_reason,'inputHash',v.input_hash)
$$;
CREATE FUNCTION orion_private.observation_cursor_scope(scope jsonb,pat_id text) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('domainVersion',1,'organizationId',scope#>>'{organization,id}','facilityId',scope#>>'{facility,id}',
    'assignmentId',scope->>'assignmentId','assignmentVersionId',scope->>'assignmentVersionId','patientId',pat_id)
$$;
CREATE FUNCTION orion_private.observation_record_json(scope jsonb,patient jsonb,v orion_private.patient_observation_versions) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('id',v.observation_id,'patient',patient,'current',orion_private.observation_version_json(v),
    'history',jsonb_build_array(orion_private.observation_version_json(v)),'historyCount',v.version,'currentVersion',v.version,
    'historyPage',jsonb_build_object('hasMore',v.version>1,'nextCursor',CASE WHEN v.version>1 THEN
      orion_private.observation_cursor_scope(scope,v.patient_id)||jsonb_build_object('kind','observation_history',
        'observationId',v.observation_id,'observationVersion',v.version,'beforeVersion',v.version) ELSE NULL END))
$$;
CREATE FUNCTION orion_private.observation_envelope(scope jsonb,pat_id text) RETURNS jsonb
LANGUAGE sql STABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('organizationId',scope#>>'{organization,id}','facilityId',scope#>>'{facility,id}','patientId',pat_id,
    'accessAssignmentId',scope->>'assignmentId','assignmentVersionId',scope->>'assignmentVersionId','role',scope->>'observationRole',
    'timeZone',f.timezone,'sourceLabel','Облачный ручной ввод · тестовые данные',
    'observedAt',orion_private.now_ms(),'clinicalInterpretation','not_performed')
  FROM orion_private.facilities f WHERE f.organization_id=scope#>>'{organization,id}' AND f.id=scope#>>'{facility,id}'
$$;
CREATE FUNCTION orion_private.observation_bounded_response(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE field text; item jsonb; limit_units integer;
BEGIN
  IF value IS NULL OR octet_length(value::text)>786432 THEN RAISE EXCEPTION 'OBSERVATION_RESPONSE_TOO_LARGE' USING ERRCODE='PT503'; END IF;
  IF jsonb_typeof(value)='object' AND value ? 'domainVersion' THEN
    -- Validate emitted cursors as well as incoming cursors, including receipts.
    PERFORM orion_private.observation_validate_cursor(value,jsonb_build_object('organization',jsonb_build_object('id',value->>'organizationId'),
      'facility',jsonb_build_object('id',value->>'facilityId'),'assignmentId',value->>'assignmentId','assignmentVersionId',value->>'assignmentVersionId'),
      value->>'patientId',value->>'kind',CASE WHEN value->>'kind'='observation_history' THEN value->>'observationId' ELSE NULL END,
      NULL);
  END IF;
  IF jsonb_typeof(value)='array' THEN
    FOR item IN SELECT jsonb_array_elements(value) LOOP PERFORM orion_private.observation_bounded_response(item); END LOOP;
  ELSIF jsonb_typeof(value)='object' THEN
    FOR field,item IN SELECT key,val FROM jsonb_each(value) e(key,val) LOOP
      IF jsonb_typeof(item) IN ('object','array') THEN PERFORM orion_private.observation_bounded_response(item);
      ELSIF item IS DISTINCT FROM 'null'::jsonb THEN
        limit_units:=CASE WHEN field='id' OR field LIKE '%Id' THEN 160
          WHEN field IN ('displayName','medicalRecordNumber','recordedBy') THEN 300
          WHEN field='changeReason' THEN 500 WHEN field='note' THEN 1000 WHEN field='timeZone' THEN 100
          WHEN field='sourceLabel' THEN 160 ELSE NULL END;
        IF limit_units IS NOT NULL AND (jsonb_typeof(item)<>'string' OR length(item#>>'{}')=0
          OR orion_private.patient_utf16_length(item#>>'{}')>limit_units OR (item#>>'{}') ~ '[[:cntrl:]]') THEN
          RAISE EXCEPTION 'INVALID_OBSERVATION_RESPONSE' USING ERRCODE='PT400'; END IF;
        IF field IN ('version','currentVersion','historyCount','observationVersion','beforeVersion','measuredAt','recordedAt','observedAt')
          AND (jsonb_typeof(item)<>'number' OR (item#>>'{}') !~ '^[1-9][0-9]{0,15}$'
            OR (item#>>'{}')::numeric>9007199254740991) THEN RAISE EXCEPTION 'INVALID_OBSERVATION_RESPONSE' USING ERRCODE='PT400'; END IF;
      END IF;
    END LOOP;
  END IF;
  RETURN value;
END $$;

-- Closed observation-only audit writer. Never use the patient/access helper's
-- action-prefix inference for measurements. Preserve existing hash-schema-1.
CREATE FUNCTION orion_private.observation_audit(scope jsonb,action text,entity_id text,metadata jsonb) RETURNS void
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE h orion_private.audit_stream_heads; e orion_private.audit_events; observed bigint:=orion_private.now_ms();
BEGIN
  IF action NOT IN ('observation.list','observation.history.read','observation.latest.read','observation.create','observation.correct','observation.command.replay')
    OR NOT orion_private.observation_id_ok(entity_id) OR jsonb_typeof(metadata) IS DISTINCT FROM 'object'
    OR octet_length(metadata::text)>2048 OR EXISTS(SELECT 1 FROM jsonb_object_keys(metadata) k
      WHERE k<>ALL(ARRAY['resultCount','version','operation','measurementGroups'])) THEN
    RAISE EXCEPTION 'INVALID_OBSERVATION_AUDIT' USING ERRCODE='PT400'; END IF;
  PERFORM orion_private.observation_scope(scope->>'assignmentId',scope#>>'{facility,id}');
  INSERT INTO orion_private.audit_stream_heads(id,organization_id,facility_id,updated_at)
    VALUES('audit-head-'||gen_random_uuid()::text,scope#>>'{organization,id}',scope#>>'{facility,id}',observed)
    ON CONFLICT(organization_id,facility_id) DO NOTHING;
  SELECT * INTO h FROM orion_private.audit_stream_heads WHERE organization_id=scope#>>'{organization,id}' AND facility_id=scope#>>'{facility,id}' FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  e.id:='audit-'||gen_random_uuid()::text; e.organization_id:=h.organization_id; e.facility_id:=h.facility_id; e.sequence:=h.last_sequence+1;
  e.actor_type:='user'; e.actor_id:=scope#>>'{user,id}'; e.actor_membership_id:=scope#>>'{membership,id}';
  e.action:=action; e.outcome:='succeeded'; e.purpose:='synthetic_patient_observation'; e.schema_version:=1;
  e.entity_type:=CASE WHEN action IN ('observation.list','observation.latest.read') THEN 'patient' ELSE 'patient_observation' END;
  e.entity_id:=entity_id; e.request_id:=gen_random_uuid()::text;
  e.metadata_json:=(metadata||jsonb_build_object('accessAssignmentId',scope->>'assignmentId','assignmentVersionId',scope->>'assignmentVersionId'))::text;
  e.previous_hash:=h.last_event_hash; e.occurred_at:=greatest(observed,h.updated_at); e.event_hash:=orion_private.audit_hash(e);
  INSERT INTO orion_private.audit_events SELECT e.*;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
  UPDATE orion_private.audit_stream_heads SET last_sequence=e.sequence,last_event_hash=e.event_hash,
    lock_version=h.lock_version+1,updated_at=e.occurred_at WHERE id=h.id AND lock_version=h.lock_version;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM orion_private.audit_stream_heads WHERE id=h.id
    AND last_sequence=e.sequence AND last_event_hash=e.event_hash AND lock_version=h.lock_version+1)
    OR NOT EXISTS(SELECT 1 FROM orion_private.audit_events WHERE id=e.id AND event_hash=e.event_hash) THEN
    RAISE EXCEPTION 'AUDIT_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
END $$;

CREATE FUNCTION orion_private.observation_guard() RETURNS trigger
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE scope jsonb; previous orion_private.patient_observation_versions; v orion_private.patient_observation_versions;
  root orion_private.patient_observation_records; head orion_private.patient_observation_heads; patient jsonb;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable observation ledger' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='patient_observation_heads' THEN
    SELECT * INTO v FROM orion_private.patient_observation_versions WHERE organization_id=NEW.organization_id AND facility_id=NEW.facility_id
      AND patient_id=NEW.patient_id AND observation_id=NEW.observation_id AND id=NEW.current_version_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'observation head scope mismatch' USING ERRCODE='23514'; END IF;
    scope:=orion_private.observation_scope(v.access_assignment_id,NEW.facility_id);
    IF v.recorded_by_membership_id IS DISTINCT FROM scope#>>'{membership,id}' THEN RAISE EXCEPTION 'OBSERVATION_ROLE_FORBIDDEN' USING ERRCODE='PT403'; END IF;
    IF TG_OP='INSERT' THEN
      IF v.version<>1 OR v.supersedes_version_id IS NOT NULL OR NEW.lock_version<>1 THEN RAISE EXCEPTION 'invalid observation genesis' USING ERRCODE='23514'; END IF;
    ELSE
      SELECT * INTO previous FROM orion_private.patient_observation_versions WHERE id=OLD.current_version_id;
      IF (to_jsonb(NEW)-ARRAY['current_version_id','lock_version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['current_version_id','lock_version','updated_at'])
        OR NEW.lock_version<>OLD.lock_version+1 OR v.version<>NEW.lock_version OR v.supersedes_version_id IS DISTINCT FROM OLD.current_version_id
        OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'observation head must advance by direct successor' USING ERRCODE='23514'; END IF;
      IF scope->>'observationRole'='nurse' AND previous.recorded_by_membership_id IS DISTINCT FROM scope#>>'{membership,id}' THEN
        RAISE EXCEPTION 'OBSERVATION_CORRECTION_FORBIDDEN' USING ERRCODE='PT403'; END IF;
    END IF;
    IF NEW.updated_at IS DISTINCT FROM v.recorded_at THEN RAISE EXCEPTION 'observation head time mismatch' USING ERRCODE='23514'; END IF;
  ELSE
    scope:=orion_private.observation_scope(NEW.access_assignment_id,NEW.facility_id);
    IF scope#>>'{organization,id}' IS DISTINCT FROM NEW.organization_id OR scope#>>'{facility,id}' IS DISTINCT FROM NEW.facility_id
      OR scope#>>'{membership,id}' IS DISTINCT FROM (CASE WHEN TG_TABLE_NAME='patient_observation_records' THEN to_jsonb(NEW)->>'created_by_membership_id'
        WHEN TG_TABLE_NAME='patient_observation_versions' THEN to_jsonb(NEW)->>'recorded_by_membership_id' ELSE to_jsonb(NEW)->>'actor_membership_id' END) THEN
      RAISE EXCEPTION 'OBSERVATION_ACTOR_SCOPE_MISMATCH' USING ERRCODE='PT403'; END IF;
    IF TG_TABLE_NAME='patient_observation_versions' THEN
      SELECT * INTO root FROM orion_private.patient_observation_records WHERE organization_id=NEW.organization_id AND facility_id=NEW.facility_id
        AND patient_id=NEW.patient_id AND id=NEW.observation_id FOR SHARE;
      IF NOT FOUND OR NEW.recorded_by_display_name IS DISTINCT FROM scope#>>'{user,displayName}' OR NEW.recorded_at<root.created_at
        OR NEW.recorded_at>orion_private.now_ms()+300000 OR NEW.measured_at>orion_private.now_ms()+300000 THEN
        RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
      IF NEW.version=1 THEN
        IF NEW.recorded_by_membership_id IS DISTINCT FROM root.created_by_membership_id OR NEW.access_assignment_id IS DISTINCT FROM root.access_assignment_id
          OR NEW.recorded_at IS DISTINCT FROM root.created_at THEN RAISE EXCEPTION 'invalid observation first version' USING ERRCODE='23514'; END IF;
      ELSE
        SELECT * INTO head FROM orion_private.patient_observation_heads WHERE organization_id=NEW.organization_id AND facility_id=NEW.facility_id
          AND patient_id=NEW.patient_id AND observation_id=NEW.observation_id FOR UPDATE;
        IF NOT FOUND OR NEW.supersedes_version_id IS DISTINCT FROM head.current_version_id OR NEW.version<>head.lock_version+1 THEN
          RAISE EXCEPTION 'OBSERVATION_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
        SELECT * INTO previous FROM orion_private.patient_observation_versions WHERE id=head.current_version_id;
        IF NEW.recorded_at<previous.recorded_at OR NEW.input_hash=previous.input_hash THEN
          RAISE EXCEPTION 'OBSERVATION_NO_CHANGE' USING ERRCODE='PT409'; END IF;
        IF scope->>'observationRole'='nurse' AND previous.recorded_by_membership_id IS DISTINCT FROM scope#>>'{membership,id}' THEN
          RAISE EXCEPTION 'OBSERVATION_CORRECTION_FORBIDDEN' USING ERRCODE='PT403'; END IF;
      END IF;
    ELSIF TG_TABLE_NAME='observation_command_receipts' THEN
      IF NEW.actor_user_id IS DISTINCT FROM scope#>>'{user,id}' THEN RAISE EXCEPTION 'OBSERVATION_ACTOR_SCOPE_MISMATCH' USING ERRCODE='PT403'; END IF;
      SELECT pv.* INTO v FROM orion_private.patient_observation_heads ph JOIN orion_private.patient_observation_versions pv
        ON pv.organization_id=ph.organization_id AND pv.facility_id=ph.facility_id AND pv.patient_id=ph.patient_id AND pv.observation_id=ph.observation_id AND pv.id=ph.current_version_id
        WHERE ph.organization_id=NEW.organization_id AND ph.facility_id=NEW.facility_id AND ph.patient_id=NEW.patient_id AND ph.observation_id=NEW.observation_id FOR SHARE OF ph,pv;
      patient:=orion_private.observation_patient(scope,NEW.patient_id);
      IF NOT FOUND OR v.id IS DISTINCT FROM NEW.result_version_id OR v.version IS DISTINCT FROM NEW.result_version
        OR v.recorded_by_membership_id IS DISTINCT FROM NEW.actor_membership_id OR v.access_assignment_id IS DISTINCT FROM NEW.access_assignment_id
        OR NEW.response_record IS DISTINCT FROM orion_private.observation_record_json(scope,patient,v)
        OR (NEW.operation='observation.create' AND v.version<>1) OR (NEW.operation='observation.correct' AND v.version=1) THEN
        RAISE EXCEPTION 'OBSERVATION_PUBLICATION_FAILED' USING ERRCODE='PT503'; END IF;
      PERFORM orion_private.observation_bounded_response(NEW.response_record);
    ELSIF NEW.created_at>orion_private.now_ms()+300000 THEN RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422';
    END IF;
  END IF;
  PERFORM orion_private.observation_patient(scope,NEW.patient_id);
  RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['patient_observation_records','patient_observation_versions','observation_command_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_observation BEFORE UPDATE OR DELETE ON orion_private.%I FOR EACH ROW EXECUTE FUNCTION orion_private.reject_mutation()',tab);
    EXECUTE format('CREATE TRIGGER observation_insert_guard BEFORE INSERT ON orion_private.%I FOR EACH ROW EXECUTE FUNCTION orion_private.observation_guard()',tab);
  END LOOP;
END $$;
CREATE TRIGGER observation_head_guard BEFORE INSERT OR UPDATE OR DELETE ON orion_private.patient_observation_heads
  FOR EACH ROW EXECUTE FUNCTION orion_private.observation_guard();

CREATE FUNCTION orion_private.observation_validate_cursor(value jsonb,scope jsonb,pat_id text,kind text,obs_id text DEFAULT NULL,obs_version integer DEFAULT NULL) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE fields text[]; field text;
BEGIN
  IF value IS NULL THEN RETURN; END IF;
  fields:=ARRAY['domainVersion','kind','organizationId','facilityId','assignmentId','assignmentVersionId','patientId','observationId','observationVersion']
    ||CASE kind WHEN 'observations' THEN ARRAY['measuredAt','recordedAt'] WHEN 'observation_history' THEN ARRAY['beforeVersion'] ELSE NULL END;
  IF fields IS NULL OR jsonb_typeof(value) IS DISTINCT FROM 'object' OR octet_length(value::text)>1536
    OR (SELECT count(*) FROM jsonb_object_keys(value))<>cardinality(fields)
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE k<>ALL(fields)) THEN RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400'; END IF;
  FOREACH field IN ARRAY ARRAY['kind','organizationId','facilityId','assignmentId','assignmentVersionId','patientId','observationId'] LOOP
    IF jsonb_typeof(value->field) IS DISTINCT FROM 'string' OR NOT orion_private.observation_id_ok(value->>field) THEN RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400'; END IF;
  END LOOP;
  IF value->'domainVersion' IS DISTINCT FROM '1'::jsonb OR value->>'kind' IS DISTINCT FROM kind
    OR value->>'organizationId' IS DISTINCT FROM scope#>>'{organization,id}' OR value->>'facilityId' IS DISTINCT FROM scope#>>'{facility,id}'
    OR value->>'assignmentId' IS DISTINCT FROM scope->>'assignmentId' OR value->>'patientId' IS DISTINCT FROM pat_id
    OR (obs_id IS NOT NULL AND value->>'observationId' IS DISTINCT FROM obs_id) THEN RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400'; END IF;
  IF value->>'assignmentVersionId' IS DISTINCT FROM scope->>'assignmentVersionId' THEN RAISE EXCEPTION 'PAGINATION_STALE' USING ERRCODE='PT409'; END IF;
  FOREACH field IN ARRAY (CASE kind WHEN 'observations' THEN ARRAY['observationVersion','measuredAt','recordedAt'] ELSE ARRAY['observationVersion','beforeVersion'] END) LOOP
    IF jsonb_typeof(value->field) IS DISTINCT FROM 'number' OR (value->>field) !~ '^[1-9][0-9]{0,15}$'
      OR (value->>field)::numeric>9007199254740991 OR (field IN ('observationVersion','beforeVersion') AND (value->>field)::numeric>2147483647) THEN
      RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400'; END IF;
  END LOOP;
  IF obs_version IS NOT NULL AND (value->>'observationVersion')::integer IS DISTINCT FROM obs_version THEN RAISE EXCEPTION 'PAGINATION_STALE' USING ERRCODE='PT409'; END IF;
  IF kind='observation_history' AND (value->>'beforeVersion')::integer>(value->>'observationVersion')::integer THEN RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400'; END IF;
END $$;

CREATE FUNCTION public.orion_observations_page(assignment_id text,patient_id text,facility_id text DEFAULT NULL,max_results integer DEFAULT 25,cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope jsonb:=orion_private.observation_scope(assignment_id,facility_id); patient jsonb; results jsonb:='[]'; v orion_private.patient_observation_versions;
  last_v orion_private.patient_observation_versions; total integer:=0; next_cursor jsonb; response jsonb;
BEGIN
  IF max_results IS NULL OR max_results NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'INVALID_PAGE_SIZE' USING ERRCODE='PT400'; END IF;
  patient:=orion_private.observation_patient(scope,patient_id);
  PERFORM orion_private.observation_validate_cursor(cursor,scope,patient_id,'observations');
  IF cursor IS NOT NULL THEN
    -- A separate READ COMMITTED check without this lock could validate an old
    -- anchor, then observe a correction in the following page SELECT. Lock the
    -- anchor even though it is deliberately excluded from continuation rows.
    PERFORM 1 FROM orion_private.patient_observation_heads h JOIN orion_private.patient_observation_versions pv
    ON pv.organization_id=h.organization_id AND pv.facility_id=h.facility_id AND pv.patient_id=h.patient_id AND pv.observation_id=h.observation_id AND pv.id=h.current_version_id
    WHERE h.organization_id=scope#>>'{organization,id}' AND h.facility_id=scope#>>'{facility,id}' AND h.patient_id=orion_observations_page.patient_id
      AND h.observation_id=cursor->>'observationId' AND pv.version=(cursor->>'observationVersion')::integer
      AND pv.measured_at=(cursor->>'measuredAt')::bigint AND pv.recorded_at=(cursor->>'recordedAt')::bigint FOR SHARE OF h,pv;
    IF NOT FOUND THEN RAISE EXCEPTION 'PAGINATION_STALE' USING ERRCODE='PT409'; END IF;
  END IF;
  FOR v IN SELECT pv.* FROM orion_private.patient_observation_heads h JOIN orion_private.patient_observation_versions pv
    ON pv.organization_id=h.organization_id AND pv.facility_id=h.facility_id AND pv.patient_id=h.patient_id AND pv.observation_id=h.observation_id AND pv.id=h.current_version_id
    WHERE h.organization_id=scope#>>'{organization,id}' AND h.facility_id=scope#>>'{facility,id}' AND h.patient_id=orion_observations_page.patient_id
      AND (cursor IS NULL OR pv.measured_at<(cursor->>'measuredAt')::bigint
        OR (pv.measured_at=(cursor->>'measuredAt')::bigint AND pv.recorded_at<(cursor->>'recordedAt')::bigint)
        OR (pv.measured_at=(cursor->>'measuredAt')::bigint AND pv.recorded_at=(cursor->>'recordedAt')::bigint AND pv.observation_id>cursor->>'observationId'))
    ORDER BY pv.measured_at DESC,pv.recorded_at DESC,pv.observation_id ASC LIMIT max_results+1 FOR SHARE OF h,pv
  LOOP
    total:=total+1; IF total>max_results THEN EXIT; END IF;
    results:=results||jsonb_build_array(orion_private.observation_record_json(scope,patient,v)); last_v:=v;
  END LOOP;
  IF total>max_results THEN next_cursor:=orion_private.observation_cursor_scope(scope,patient_id)||jsonb_build_object('kind','observations',
    'observationId',last_v.observation_id,'observationVersion',last_v.version,'measuredAt',last_v.measured_at,'recordedAt',last_v.recorded_at);
    PERFORM orion_private.observation_validate_cursor(next_cursor,scope,patient_id,'observations'); END IF;
  response:=orion_private.observation_bounded_response(orion_private.observation_envelope(scope,patient_id)||jsonb_build_object('patient',patient,'observations',results,
    'page',jsonb_build_object('hasMore',total>max_results,'nextCursor',next_cursor)));
  PERFORM orion_private.observation_audit(scope,'observation.list',patient_id,jsonb_build_object('resultCount',jsonb_array_length(results)));
  PERFORM orion_private.observation_final_scope(scope,patient_id);
  RETURN response;
END $$;
CREATE FUNCTION public.orion_observation_history_page(assignment_id text,patient_id text,observation_id text,facility_id text DEFAULT NULL,max_results integer DEFAULT 25,cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope jsonb:=orion_private.observation_scope(assignment_id,facility_id); current_v orion_private.patient_observation_versions; v orion_private.patient_observation_versions;
  last_v orion_private.patient_observation_versions; items jsonb:='[]'; total integer:=0; next_cursor jsonb; response jsonb;
BEGIN
  IF max_results IS NULL OR max_results NOT BETWEEN 1 AND 50 OR NOT orion_private.observation_id_ok(observation_id) THEN RAISE EXCEPTION 'INVALID_HISTORY_QUERY' USING ERRCODE='PT400'; END IF;
  PERFORM orion_private.observation_patient(scope,patient_id);
  SELECT pv.* INTO current_v FROM orion_private.patient_observation_heads h JOIN orion_private.patient_observation_versions pv
    ON pv.organization_id=h.organization_id AND pv.facility_id=h.facility_id AND pv.patient_id=h.patient_id AND pv.observation_id=h.observation_id AND pv.id=h.current_version_id
    WHERE h.organization_id=scope#>>'{organization,id}' AND h.facility_id=scope#>>'{facility,id}' AND h.patient_id=orion_observation_history_page.patient_id
      AND h.observation_id=orion_observation_history_page.observation_id FOR SHARE OF h,pv;
  IF NOT FOUND THEN RAISE EXCEPTION 'OBSERVATION_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  PERFORM orion_private.observation_validate_cursor(cursor,scope,patient_id,'observation_history',observation_id,current_v.version);
  FOR v IN SELECT pv.* FROM orion_private.patient_observation_versions pv WHERE pv.organization_id=current_v.organization_id AND pv.facility_id=current_v.facility_id
    AND pv.patient_id=orion_observation_history_page.patient_id AND pv.observation_id=orion_observation_history_page.observation_id AND pv.version<=current_v.version
    AND (cursor IS NULL OR pv.version<(cursor->>'beforeVersion')::integer) ORDER BY pv.version DESC LIMIT max_results+1
  LOOP total:=total+1; IF total>max_results THEN EXIT; END IF;
    items:=items||jsonb_build_array(orion_private.observation_version_json(v)); last_v:=v;
  END LOOP;
  IF total>max_results THEN next_cursor:=orion_private.observation_cursor_scope(scope,patient_id)||jsonb_build_object('kind','observation_history',
    'observationId',observation_id,'observationVersion',current_v.version,'beforeVersion',last_v.version);
    PERFORM orion_private.observation_validate_cursor(next_cursor,scope,patient_id,'observation_history',observation_id,current_v.version); END IF;
  response:=orion_private.observation_bounded_response(orion_private.observation_envelope(scope,patient_id)||jsonb_build_object('observationId',observation_id,
    'observationVersion',current_v.version,'items',items,'page',jsonb_build_object('hasMore',total>max_results,'nextCursor',next_cursor)));
  PERFORM orion_private.observation_audit(scope,'observation.history.read',observation_id,jsonb_build_object('resultCount',jsonb_array_length(items),'version',current_v.version));
  PERFORM orion_private.observation_final_scope(scope,patient_id);
  RETURN response;
END $$;
CREATE FUNCTION public.orion_patient_latest_vitals(assignment_id text,patient_id text,facility_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope jsonb:=orion_private.observation_scope(assignment_id,facility_id); group_name text; v orion_private.patient_observation_versions;
  vitals jsonb:='{"anthropometry":null,"bloodPressure":null,"temperature":null}'; source jsonb; response jsonb;
BEGIN
  PERFORM orion_private.observation_patient(scope,patient_id);
  FOREACH group_name IN ARRAY ARRAY['anthropometry','bloodPressure','temperature'] LOOP
    SELECT pv.* INTO v FROM orion_private.patient_observation_heads h JOIN orion_private.patient_observation_versions pv
      ON pv.organization_id=h.organization_id AND pv.facility_id=h.facility_id AND pv.patient_id=h.patient_id AND pv.observation_id=h.observation_id AND pv.id=h.current_version_id
      WHERE h.organization_id=scope#>>'{organization,id}' AND h.facility_id=scope#>>'{facility,id}' AND h.patient_id=orion_patient_latest_vitals.patient_id
        AND CASE group_name WHEN 'anthropometry' THEN pv.height_mm IS NOT NULL AND pv.weight_grams IS NOT NULL
          WHEN 'bloodPressure' THEN pv.systolic_mmhg IS NOT NULL AND pv.diastolic_mmhg IS NOT NULL ELSE pv.temperature_milli_c IS NOT NULL END
      ORDER BY pv.measured_at DESC,pv.recorded_at DESC,pv.observation_id ASC LIMIT 1 FOR SHARE OF h,pv;
    IF FOUND THEN
      source:=jsonb_build_object('observationId',v.observation_id,'version',v.version,'measuredAt',v.measured_at,
        'recordedBy',v.recorded_by_display_name,'sourceLabel','Облачный ручной ввод · тестовые данные')
        ||CASE group_name WHEN 'anthropometry' THEN jsonb_build_object('heightCm',v.height_mm::numeric/10,'weightKg',v.weight_grams::numeric/1000,'bmi',v.bmi_hundredths::numeric/100)
          WHEN 'bloodPressure' THEN jsonb_build_object('systolicMmhg',v.systolic_mmhg,'diastolicMmhg',v.diastolic_mmhg)
          ELSE jsonb_build_object('temperatureC',v.temperature_milli_c::numeric/1000) END;
      vitals:=jsonb_set(vitals,ARRAY[group_name],source);
    END IF;
  END LOOP;
  response:=orion_private.observation_bounded_response(orion_private.observation_envelope(scope,patient_id)||jsonb_build_object('vitals',vitals));
  PERFORM orion_private.observation_audit(scope,'observation.latest.read',patient_id,'{}');
  PERFORM orion_private.observation_final_scope(scope,patient_id);
  RETURN response;
END $$;

CREATE FUNCTION orion_private.observation_normalize_payload(payload jsonb,scope jsonb,operation text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE fields text[]:=ARRAY['patientId','measuredAt','context','values','note','syntheticDataAcknowledged','idempotencyKey','reason']; field text;
  vals jsonb; value jsonb; h integer; w integer; bmi integer; sys integer; dia integer; temp integer; note_text text; reason_text text; normalized jsonb;
BEGIN
  IF operation='observation.correct' THEN fields:=fields||ARRAY['expectedVersion']; END IF;
  IF payload IS NULL OR jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>16384
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(payload) k WHERE k<>ALL(fields||ARRAY['facilityId','accessAssignmentId']))
    OR EXISTS(SELECT 1 FROM unnest(fields) k WHERE NOT payload ? k) THEN RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
  IF payload ? 'facilityId' AND (jsonb_typeof(payload->'facilityId') IS DISTINCT FROM 'string' OR btrim(payload->>'facilityId') IS DISTINCT FROM scope#>>'{facility,id}')
    OR payload ? 'accessAssignmentId' AND (jsonb_typeof(payload->'accessAssignmentId') IS DISTINCT FROM 'string' OR btrim(payload->>'accessAssignmentId') IS DISTINCT FROM scope->>'assignmentId') THEN
    RAISE EXCEPTION 'OBSERVATION_SCOPE_MISMATCH' USING ERRCODE='PT403'; END IF;
  IF jsonb_typeof(payload->'patientId') IS DISTINCT FROM 'string' OR NOT orion_private.observation_id_ok(btrim(payload->>'patientId'))
    OR payload->'syntheticDataAcknowledged' IS DISTINCT FROM 'true'::jsonb
    OR jsonb_typeof(payload->'measuredAt') IS DISTINCT FROM 'number' OR (payload->>'measuredAt') !~ '^[1-9][0-9]{0,15}$'
    OR (payload->>'measuredAt')::numeric NOT BETWEEN 946684800000 AND least(orion_private.now_ms()+300000,9007199254740991)
    OR jsonb_typeof(payload->'context') IS DISTINCT FROM 'string' OR payload->>'context'<>ALL(ARRAY['pre_visit','consultation','follow_up','other'])
    OR jsonb_typeof(payload->'idempotencyKey') IS DISTINCT FROM 'string' OR (payload->>'idempotencyKey') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
    OR jsonb_typeof(payload->'reason') IS DISTINCT FROM 'string' OR jsonb_typeof(payload->'note') NOT IN ('string','null') THEN
    RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
  IF operation='observation.correct' AND (jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'number'
    OR (payload->>'expectedVersion') !~ '^[1-9][0-9]{0,9}$' OR (payload->>'expectedVersion')::numeric>=2147483647) THEN
    RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
  reason_text:=orion_private.observation_clean_text(payload->>'reason',3,500);
  IF payload->'note'<>'null'::jsonb THEN note_text:=orion_private.observation_clean_text(payload->>'note',3,1000); END IF;
  vals:=payload->'values';
  IF jsonb_typeof(vals) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(vals))<>5
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(vals) k WHERE k<>ALL(ARRAY['heightCm','weightKg','systolicMmhg','diastolicMmhg','temperatureC'])) THEN
    RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
  FOREACH field IN ARRAY ARRAY['heightCm','weightKg','systolicMmhg','diastolicMmhg','temperatureC'] LOOP
    value:=vals->field;
    IF jsonb_typeof(value) NOT IN ('number','null') THEN RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
    IF value<>'null'::jsonb AND ((value#>>'{}')::numeric NOT BETWEEN CASE field WHEN 'heightCm' THEN 40 WHEN 'weightKg' THEN 1 WHEN 'systolicMmhg' THEN 40 WHEN 'diastolicMmhg' THEN 20 ELSE 30 END
      AND CASE field WHEN 'heightCm' THEN 250 WHEN 'weightKg' THEN 500 WHEN 'systolicMmhg' THEN 300 WHEN 'diastolicMmhg' THEN 200 ELSE 45 END
      OR (field IN ('systolicMmhg','diastolicMmhg') AND (value#>>'{}')::numeric<>trunc((value#>>'{}')::numeric))) THEN
      RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
  END LOOP;
  h:=round((vals->>'heightCm')::numeric*10)::integer; w:=round((vals->>'weightKg')::numeric*1000)::integer;
  sys:=(vals->>'systolicMmhg')::numeric::integer; dia:=(vals->>'diastolicMmhg')::numeric::integer; temp:=round((vals->>'temperatureC')::numeric*1000)::integer;
  IF (h IS NULL)<>(w IS NULL) OR (sys IS NULL)<>(dia IS NULL) OR sys<=dia OR (h IS NULL AND sys IS NULL AND temp IS NULL) THEN
    RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
  IF h IS NOT NULL THEN bmi:=round(w::numeric*100000/(h::numeric*h))::integer;
    -- DomainZod permits extreme pairs outside the existing persisted BMI range.
    -- Preserve its API contract, but fail explicitly422 before any write.
    IF bmi NOT BETWEEN 500 AND 10000 THEN RAISE EXCEPTION 'OBSERVATION_BMI_OUT_OF_RANGE' USING ERRCODE='PT422'; END IF;
  END IF;
  normalized:=jsonb_build_object('patientId',btrim(payload->>'patientId'),'measuredAt',(payload->>'measuredAt')::bigint,
    'context',payload->>'context','heightMm',h,'weightGrams',w,'bmiHundredths',bmi,'systolicMmhg',sys,'diastolicMmhg',dia,'temperatureMilliC',temp,
    'note',note_text,'reason',reason_text,'idempotencyKey',lower(payload->>'idempotencyKey'),'syntheticDataAcknowledged',true);
  IF operation='observation.correct' THEN normalized:=normalized||jsonb_build_object('expectedVersion',(payload->>'expectedVersion')::integer); END IF;
  RETURN normalized;
END $$;
CREATE FUNCTION orion_private.observation_command(assignment_id text,obs_id text,payload jsonb,facility_id text,operation text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE scope jsonb:=orion_private.observation_scope(assignment_id,facility_id); normalized jsonb; patient jsonb; pat_id text; org_id text; fac_id text;
  key_uuid uuid; request_hash text; input_hash text; observed bigint; root_id text; version_id text;
  previous orion_private.patient_observation_versions; v orion_private.patient_observation_versions; head orion_private.patient_observation_heads;
  receipt orion_private.observation_command_receipts; record_json jsonb; response jsonb;
BEGIN
  IF operation NOT IN ('observation.create','observation.correct') OR (operation='observation.create' AND obs_id IS NOT NULL)
    OR (operation='observation.correct' AND NOT orion_private.observation_id_ok(obs_id)) THEN RAISE EXCEPTION 'OBSERVATION_INVALID' USING ERRCODE='PT422'; END IF;
  normalized:=orion_private.observation_normalize_payload(payload,scope,operation);
  pat_id:=normalized->>'patientId'; patient:=orion_private.observation_patient(scope,pat_id); org_id:=scope#>>'{organization,id}'; fac_id:=scope#>>'{facility,id}';
  key_uuid:=(normalized->>'idempotencyKey')::uuid;
  request_hash:=encode(sha256(convert_to((jsonb_build_object('operation',operation,'observationId',obs_id,'organizationId',org_id,'facilityId',fac_id,
    'actorUserId',scope#>>'{user,id}','actorMembershipId',scope#>>'{membership,id}','assignmentId',assignment_id,'payload',normalized,
    'rawValues',payload->'values'))::text,'UTF8')),'hex');
  -- No pending external side effect exists. Serialize the exact actor/op/key;
  -- committed immutable receipt, version, head and audit are one transaction.
  PERFORM pg_advisory_xact_lock(hashtextextended(org_id||':'||fac_id||':'||(scope#>>'{membership,id}')||':'||operation||':'||key_uuid::text,0));
  SELECT r.* INTO receipt FROM orion_private.observation_command_receipts r WHERE r.organization_id=org_id AND r.facility_id=fac_id
    AND r.actor_membership_id=scope#>>'{membership,id}' AND r.operation=observation_command.operation AND r.idempotency_key=key_uuid;
  IF FOUND THEN
    IF receipt.request_hash IS DISTINCT FROM request_hash OR receipt.access_assignment_id IS DISTINCT FROM assignment_id
      OR receipt.patient_id IS DISTINCT FROM pat_id THEN RAISE EXCEPTION 'OBSERVATION_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
    -- A nurse cannot replay a prior correction after ownership moved to another
    -- recorder. Replays also require current live authority and active patient.
    SELECT pv.* INTO previous FROM orion_private.patient_observation_heads ph JOIN orion_private.patient_observation_versions pv
      ON pv.organization_id=ph.organization_id AND pv.facility_id=ph.facility_id AND pv.patient_id=ph.patient_id AND pv.observation_id=ph.observation_id AND pv.id=ph.current_version_id
      WHERE ph.organization_id=org_id AND ph.facility_id=fac_id AND ph.patient_id=pat_id AND ph.observation_id=receipt.observation_id FOR SHARE OF ph,pv;
    IF NOT FOUND THEN RAISE EXCEPTION 'OBSERVATION_PUBLICATION_FAILED' USING ERRCODE='PT503'; END IF;
    IF scope->>'observationRole'='nurse' AND previous.recorded_by_membership_id IS DISTINCT FROM scope#>>'{membership,id}' THEN
      RAISE EXCEPTION 'OBSERVATION_CORRECTION_FORBIDDEN' USING ERRCODE='PT403'; END IF;
    response:=orion_private.observation_bounded_response(orion_private.observation_envelope(scope,pat_id)||jsonb_build_object('observation',receipt.response_record,'replayed',true));
    PERFORM orion_private.observation_audit(scope,'observation.command.replay',receipt.observation_id,jsonb_build_object('operation',operation,'version',receipt.result_version));
    PERFORM orion_private.observation_final_scope(scope,pat_id); RETURN response;
  END IF;
  input_hash:=encode(sha256(convert_to((normalized-ARRAY['reason','idempotencyKey','expectedVersion','syntheticDataAcknowledged'])::text,'UTF8')),'hex');
  observed:=orion_private.now_ms();
  IF operation='observation.create' THEN
    root_id:='observation-'||gen_random_uuid()::text;
    INSERT INTO orion_private.patient_observation_records VALUES(root_id,org_id,fac_id,pat_id,'manual_test','Облачный ручной ввод · тестовые данные',scope#>>'{membership,id}',assignment_id,observed);
    IF NOT FOUND THEN RAISE EXCEPTION 'OBSERVATION_PUBLICATION_FAILED' USING ERRCODE='PT503'; END IF;
  ELSE
    root_id:=obs_id;
    SELECT ph.* INTO head FROM orion_private.patient_observation_heads ph WHERE ph.organization_id=org_id AND ph.facility_id=fac_id
      AND ph.patient_id=pat_id AND ph.observation_id=root_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'OBSERVATION_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    SELECT * INTO previous FROM orion_private.patient_observation_versions WHERE id=head.current_version_id;
    IF scope->>'observationRole'='nurse' AND previous.recorded_by_membership_id IS DISTINCT FROM scope#>>'{membership,id}' THEN
      RAISE EXCEPTION 'OBSERVATION_CORRECTION_FORBIDDEN' USING ERRCODE='PT403'; END IF;
    IF previous.version IS DISTINCT FROM (normalized->>'expectedVersion')::integer THEN RAISE EXCEPTION 'OBSERVATION_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF previous.input_hash=input_hash THEN RAISE EXCEPTION 'OBSERVATION_NO_CHANGE' USING ERRCODE='PT409'; END IF;
    observed:=greatest(observed,previous.recorded_at);
  END IF;
  version_id:='observation-version-'||gen_random_uuid()::text;
  INSERT INTO orion_private.patient_observation_versions VALUES(version_id,org_id,fac_id,pat_id,root_id,
    coalesce(previous.version,0)+1,previous.id,(normalized->>'measuredAt')::bigint,normalized->>'context',
    (normalized->>'heightMm')::integer,(normalized->>'weightGrams')::integer,(normalized->>'bmiHundredths')::integer,
    (normalized->>'systolicMmhg')::integer,(normalized->>'diastolicMmhg')::integer,(normalized->>'temperatureMilliC')::integer,
    normalized->>'note',scope#>>'{membership,id}',assignment_id,scope#>>'{user,displayName}',observed,normalized->>'reason',input_hash) RETURNING * INTO v;
  IF NOT FOUND THEN RAISE EXCEPTION 'OBSERVATION_PUBLICATION_FAILED' USING ERRCODE='PT503'; END IF;
  IF operation='observation.create' THEN
    INSERT INTO orion_private.patient_observation_heads VALUES('observation-head-'||gen_random_uuid()::text,org_id,fac_id,pat_id,root_id,version_id,1,observed);
  ELSE
    UPDATE orion_private.patient_observation_heads SET current_version_id=version_id,lock_version=v.version,updated_at=observed
      WHERE id=head.id AND current_version_id=previous.id AND lock_version=previous.version;
  END IF;
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM orion_private.patient_observation_heads ph WHERE ph.organization_id=org_id AND ph.facility_id=fac_id
    AND ph.patient_id=pat_id AND ph.observation_id=root_id AND ph.current_version_id=version_id AND ph.lock_version=v.version) THEN
    RAISE EXCEPTION 'OBSERVATION_PUBLICATION_FAILED' USING ERRCODE='PT503'; END IF;
  record_json:=orion_private.observation_record_json(scope,patient,v);
  response:=orion_private.observation_bounded_response(orion_private.observation_envelope(scope,pat_id)||jsonb_build_object('observation',record_json,'replayed',false));
  INSERT INTO orion_private.observation_command_receipts VALUES('observation-command-'||gen_random_uuid()::text,org_id,fac_id,pat_id,
    scope#>>'{user,id}',scope#>>'{membership,id}',assignment_id,operation,key_uuid,request_hash,root_id,version_id,v.version,record_json,observed);
  IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM orion_private.observation_command_receipts r WHERE r.organization_id=org_id AND r.facility_id=fac_id
    AND r.actor_membership_id=scope#>>'{membership,id}' AND r.operation=observation_command.operation AND r.idempotency_key=key_uuid AND r.result_version_id=version_id) THEN
    RAISE EXCEPTION 'OBSERVATION_PUBLICATION_FAILED' USING ERRCODE='PT503'; END IF;
  PERFORM orion_private.observation_audit(scope,operation,root_id,jsonb_build_object('version',v.version,'measurementGroups',
    jsonb_build_object('anthropometry',v.height_mm IS NOT NULL,'bloodPressure',v.systolic_mmhg IS NOT NULL,'temperature',v.temperature_milli_c IS NOT NULL)));
  PERFORM orion_private.observation_final_scope(scope,pat_id);
  RETURN response;
END $$;
CREATE FUNCTION public.orion_observation_create(assignment_id text,payload jsonb,facility_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$ SELECT orion_private.observation_command(assignment_id,NULL,payload,facility_id,'observation.create') $$;
CREATE FUNCTION public.orion_observation_correct(assignment_id text,observation_id text,payload jsonb,facility_id text DEFAULT NULL) RETURNS jsonb
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$ SELECT orion_private.observation_command(assignment_id,observation_id,payload,facility_id,'observation.correct') $$;

ALTER TABLE orion_private.patient_observation_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE orion_private.patient_observation_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE orion_private.patient_observation_heads ENABLE ROW LEVEL SECURITY;
ALTER TABLE orion_private.observation_command_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE orion_private.patient_observation_records,orion_private.patient_observation_versions,
  orion_private.patient_observation_heads,orion_private.observation_command_receipts FROM PUBLIC,anon,authenticated,service_role;
-- Helpers are private; never grant direct schema/table/helper access.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.orion_observations_page(text,text,text,integer,jsonb),
  public.orion_observation_history_page(text,text,text,text,integer,jsonb),public.orion_patient_latest_vitals(text,text,text),
  public.orion_observation_create(text,jsonb,text),public.orion_observation_correct(text,text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orion_observations_page(text,text,text,integer,jsonb),
  public.orion_observation_history_page(text,text,text,text,integer,jsonb),public.orion_patient_latest_vitals(text,text,text),
  public.orion_observation_create(text,jsonb,text),public.orion_observation_correct(text,text,jsonb,text) TO authenticated;
COMMIT;
