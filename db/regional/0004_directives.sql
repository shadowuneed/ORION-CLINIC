-- DIRECTIVES-1: dedicated, local-only administrative work. No clinical grants,
-- existing account changes, external delivery or government integration.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'REGIONAL_TARGET_DATABASE_REQUIRED'; END IF;
  IF (SELECT count(*) FROM orion_region.facilities WHERE data_mode='training')<>36 THEN RAISE EXCEPTION 'DIRECTIVE_CATALOGUE_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM orion_directory.accounts WHERE id='directive-admin' OR id LIKE 'head-%' OR issuer='orion:local:directives') THEN
    RAISE EXCEPTION 'DIRECTIVE_NEW_IDENTITIES_CONFLICT';
  END IF;
END $$;

CREATE TABLE orion_region.directive_grants (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES orion_directory.accounts(id),
  role text NOT NULL CHECK(role IN ('administrator','head')), facility_id text REFERENCES orion_region.facilities(id),
  clinic_id text NOT NULL, membership_id text NOT NULL, active boolean NOT NULL DEFAULT true,
  reason text NOT NULL CHECK(length(reason) BETWEEN 1 AND 500), created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(clinic_id,membership_id) REFERENCES orion_directory.memberships(clinic_id,id),
  CHECK((role='administrator' AND facility_id IS NULL) OR (role='head' AND facility_id IS NOT NULL))
);
CREATE UNIQUE INDEX directive_admin_grant ON orion_region.directive_grants(user_id) WHERE role='administrator';
CREATE UNIQUE INDEX directive_head_grant ON orion_region.directive_grants(user_id,facility_id) WHERE role='head';
CREATE TABLE orion_region.directives (
  id text PRIMARY KEY DEFAULT 'directive-'||gen_random_uuid(), title text NOT NULL CHECK(length(title) BETWEEN 1 AND 180),
  authority_reference text NOT NULL CHECK(length(authority_reference) BETWEEN 1 AND 180),
  details text NOT NULL CHECK(length(details) BETWEEN 1 AND 4000),
  issued_by text NOT NULL REFERENCES orion_directory.accounts(id), issued_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  issued_date date NOT NULL, due_date date NOT NULL CHECK(due_date>=issued_date),
  data_mode text NOT NULL DEFAULT 'training' CHECK(data_mode='training'), CHECK(isfinite(issued_at) AND isfinite(issued_date) AND isfinite(due_date))
);
CREATE TABLE orion_region.directive_assignments (
  id text PRIMARY KEY DEFAULT 'directive-assignment-'||gen_random_uuid(), directive_id text NOT NULL REFERENCES orion_region.directives(id),
  facility_id text NOT NULL REFERENCES orion_region.facilities(id), UNIQUE(directive_id,facility_id),
  version integer NOT NULL DEFAULT 1 CHECK(version>0),
  status text NOT NULL DEFAULT 'assigned' CHECK(status IN ('assigned','in_progress','submitted','returned_documents','returned_work','accepted')),
  progress integer NOT NULL DEFAULT 0 CHECK(progress BETWEEN 0 AND 100),
  actual_completed_date date, submitted_at timestamptz, submitted_by text REFERENCES orion_directory.accounts(id),
  reviewed_at timestamptz, review_remark text CHECK(length(review_remark)<=2000),
  work_cycle integer NOT NULL DEFAULT 1 CHECK(work_cycle>0), explained_cycle integer CHECK(explained_cycle>0),
  work_not_before date, updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK((status IN ('submitted','returned_documents','accepted'))=(actual_completed_date IS NOT NULL)),
  CHECK((actual_completed_date IS NOT NULL)=(submitted_at IS NOT NULL AND submitted_by IS NOT NULL)),
  CHECK(explained_cycle IS NULL OR explained_cycle<=work_cycle),
  CHECK(actual_completed_date IS NULL OR isfinite(actual_completed_date)), CHECK(work_not_before IS NULL OR isfinite(work_not_before))
);
CREATE INDEX directive_assignment_facility ON orion_region.directive_assignments(facility_id,directive_id);
CREATE TABLE orion_region.directive_events (
  id text PRIMARY KEY DEFAULT 'directive-event-'||gen_random_uuid(), assignment_id text NOT NULL REFERENCES orion_region.directive_assignments(id),
  version integer NOT NULL CHECK(version>0), user_id text NOT NULL REFERENCES orion_directory.accounts(id),
  action text NOT NULL CHECK(action IN ('create','progress','submit','explain','review')),
  status text NOT NULL CHECK(status IN ('assigned','in_progress','submitted','returned_documents','returned_work','accepted')),
  progress integer NOT NULL CHECK(progress BETWEEN 0 AND 100), actual_completed_date date,
  work_cycle integer NOT NULL CHECK(work_cycle>0), remark text CHECK(length(remark)<=4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), UNIQUE(assignment_id,version), UNIQUE(assignment_id,id)
);
CREATE TABLE orion_region.directive_attachments (
  id text PRIMARY KEY DEFAULT 'directive-file-'||gen_random_uuid(), assignment_id text NOT NULL,
  event_id text NOT NULL, file_name text NOT NULL CHECK(length(file_name) BETWEEN 1 AND 180),
  mime_type text NOT NULL CHECK(mime_type IN ('application/pdf','application/vnd.openxmlformats-officedocument.wordprocessingml.document','image/png','image/jpeg','text/plain')),
  purpose text NOT NULL CHECK(purpose IN ('report','explanation','supporting')),
  content bytea NOT NULL CHECK(octet_length(content) BETWEEN 1 AND 2097152),
  byte_length integer GENERATED ALWAYS AS (octet_length(content)) STORED,
  sha256 text GENERATED ALWAYS AS (encode(sha256(content),'hex')) STORED,
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(assignment_id,event_id) REFERENCES orion_region.directive_events(assignment_id,id)
);
CREATE INDEX directive_attachment_assignment ON orion_region.directive_attachments(assignment_id,event_id);
CREATE TABLE orion_region.directive_receipts (
  user_id text NOT NULL REFERENCES orion_directory.accounts(id), idempotency_key uuid NOT NULL,
  request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'), result jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,idempotency_key)
);
CREATE FUNCTION orion_region.directive_assignment_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR NEW.id<>OLD.id OR NEW.directive_id<>OLD.directive_id OR NEW.facility_id<>OLD.facility_id OR NEW.version<>OLD.version+1 THEN
    RAISE EXCEPTION 'DIRECTIVE_IMMUTABLE_OR_VERSION' USING ERRCODE='PT409';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER directive_assignment_guard BEFORE UPDATE OR DELETE ON orion_region.directive_assignments
FOR EACH ROW EXECUTE FUNCTION orion_region.directive_assignment_guard();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['directive_grants','directives','directive_assignments','directive_events','directive_attachments','directive_receipts'] LOOP
    EXECUTE format('ALTER TABLE orion_region.%I ENABLE ROW LEVEL SECURITY',t);
  END LOOP;
  FOREACH t IN ARRAY ARRAY['directives','directive_events','directive_attachments','directive_receipts'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_directive_evidence BEFORE UPDATE OR DELETE ON orion_region.%I FOR EACH ROW EXECUTE FUNCTION orion_clinical.reject_history_change()',t);
  END LOOP;
END $$;

CREATE FUNCTION orion_region.directive_access(p_issuer text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor text:=orion_region.require_user(p_issuer,p_subject); g record; is_admin boolean:=false; heads text[]:='{}'; visible text[];
BEGIN
  -- Lock the same clinic rows used by directory mutation before reading exact
  -- memberships. A platform administrator assignment is NOT a directive grant.
  PERFORM c.id FROM orion_crm.clinics c WHERE c.id IN (
    SELECT x.clinic_id FROM orion_region.directive_grants x WHERE x.user_id=actor AND x.active
    UNION SELECT f.clinic_id FROM orion_region.facilities f WHERE f.data_mode='training' AND EXISTS(
      SELECT 1 FROM orion_region.directive_grants x WHERE x.user_id=actor AND x.active AND x.role='administrator'))
    ORDER BY c.id FOR SHARE OF c;
  FOR g IN SELECT x.* FROM orion_region.directive_grants x
    JOIN orion_directory.memberships m ON m.clinic_id=x.clinic_id AND m.id=x.membership_id AND m.user_id=x.user_id
    JOIN orion_crm.clinics c ON c.id=x.clinic_id AND c.active AND c.mode='synthetic_simulation'
    WHERE x.user_id=actor AND x.active AND m.status='active' AND m.interactive
      AND (x.role='administrator' OR EXISTS(SELECT 1 FROM orion_region.facilities f WHERE f.id=x.facility_id AND f.clinic_id=x.clinic_id AND f.data_mode='training'))
    ORDER BY x.id FOR SHARE OF x,m LOOP
    IF g.role='administrator' THEN is_admin:=true; ELSE heads:=array_append(heads,g.facility_id); END IF;
  END LOOP;
  IF NOT is_admin AND cardinality(heads)=0 THEN RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  SELECT coalesce(array_agg(f.id ORDER BY f.id),'{}') INTO visible FROM orion_region.facilities f
    JOIN orion_crm.clinics c ON c.id=f.clinic_id AND c.active AND c.mode='synthetic_simulation'
    WHERE f.data_mode='training' AND (is_admin OR f.id=ANY(heads));
  IF cardinality(visible)>36 THEN RAISE EXCEPTION 'DIRECTIVE_LIMIT' USING ERRCODE='PT503'; END IF;
  RETURN jsonb_build_object('actorId',actor,'administrator',is_admin,'headFacilities',heads,'facilities',visible);
END $$;
CREATE FUNCTION orion_region.directive_needs_explanation(p_assignment orion_region.directive_assignments,p_due date,p_today date)
RETURNS boolean LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_assignment.explained_cycle IS DISTINCT FROM p_assignment.work_cycle AND
    CASE WHEN p_assignment.actual_completed_date IS NOT NULL THEN p_assignment.actual_completed_date>p_due ELSE p_today>p_due END
$$;
CREATE FUNCTION orion_region.directive_attachment_metadata(p_row orion_region.directive_attachments) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT jsonb_build_object('id',p_row.id,'fileName',p_row.file_name,'mimeType',p_row.mime_type,'byteLength',p_row.byte_length,
    'sha256',p_row.sha256,'purpose',p_row.purpose,'uploadedAt',orion_crm.iso(p_row.uploaded_at))
$$;
CREATE FUNCTION orion_region.directive_assignment_json(p_assignment orion_region.directive_assignments,p_due date,p_today date)
RETURNS jsonb LANGUAGE sql STABLE SET search_path='' AS $$
  SELECT jsonb_build_object('id',p_assignment.id,'facilityId',p_assignment.facility_id,'version',p_assignment.version,'status',p_assignment.status,
    'progress',p_assignment.progress,'actualCompletedDate',p_assignment.actual_completed_date::text,
    'submittedAt',orion_crm.iso(p_assignment.submitted_at),'reviewedAt',orion_crm.iso(p_assignment.reviewed_at),
    'reviewRemark',p_assignment.review_remark,'explanationRequired',orion_region.directive_needs_explanation(p_assignment,p_due,p_today),
    'attachments',(SELECT coalesce(jsonb_agg(orion_region.directive_attachment_metadata(f) ORDER BY f.uploaded_at,f.id),'[]')
      FROM orion_region.directive_attachments f WHERE f.assignment_id=p_assignment.id),
    'history',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'version',e.version,'at',orion_crm.iso(e.created_at),
      'actorLabel',u.display_name,'action',e.action,'status',e.status,'progress',e.progress,'actualCompletedDate',e.actual_completed_date::text,
      'remark',e.remark,'attachmentIds',(SELECT coalesce(jsonb_agg(f.id ORDER BY f.id),'[]') FROM orion_region.directive_attachments f WHERE f.event_id=e.id)) ORDER BY e.version DESC),'[]')
      FROM (SELECT * FROM orion_region.directive_events WHERE assignment_id=p_assignment.id ORDER BY version DESC LIMIT 50) e
      JOIN orion_directory.accounts u ON u.id=e.user_id))
$$;
CREATE FUNCTION public.orion_regional_directives_v1(p_issuer text,p_subject text,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE access jsonb:=orion_region.directive_access(p_issuer,p_subject); actor text:=access->>'actorId';
  visible text[]; heads text[]; selected text; fs jsonb; ds jsonb; result jsonb;
  today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date;
BEGIN
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR octet_length(p_query::text)>512 THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_QUERY' USING ERRCODE='PT400'; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_object_keys(p_query) k WHERE k<>'facilityId') OR
    (p_query?'facilityId' AND (jsonb_typeof(p_query->'facilityId') IS DISTINCT FROM 'string' OR length(p_query->>'facilityId') NOT BETWEEN 1 AND 160)) THEN
    RAISE EXCEPTION 'DIRECTIVE_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  selected:=p_query->>'facilityId';
  SELECT ARRAY(SELECT jsonb_array_elements_text(access->'facilities')) INTO visible;
  SELECT ARRAY(SELECT jsonb_array_elements_text(access->'headFacilities')) INTO heads;
  IF selected IS NOT NULL THEN
    IF NOT selected=ANY(visible) THEN RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
    visible:=ARRAY[selected];
  END IF;
  IF (SELECT count(DISTINCT directive_id) FROM orion_region.directive_assignments WHERE facility_id=ANY(visible))>100 OR
    EXISTS(SELECT 1 FROM orion_region.directive_attachments x JOIN orion_region.directive_assignments a ON a.id=x.assignment_id WHERE a.facility_id=ANY(visible) GROUP BY a.id HAVING count(*)>150) THEN
    RAISE EXCEPTION 'DIRECTIVE_LIMIT' USING ERRCODE='PT503';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'canSubmit',f.id=ANY(heads)) ORDER BY f.name,f.id),'[]')
    INTO fs FROM orion_region.facilities f WHERE f.id=ANY(visible);
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',d.id,'title',d.title,'authorityReference',d.authority_reference,'details',d.details,
    'issuedAt',orion_crm.iso(d.issued_at),'issuedDate',d.issued_date::text,'dueDate',d.due_date::text,
    'assignments',(SELECT jsonb_agg(orion_region.directive_assignment_json(a,d.due_date,today) ORDER BY a.facility_id)
      FROM orion_region.directive_assignments a WHERE a.directive_id=d.id AND a.facility_id=ANY(visible))) ORDER BY d.issued_at DESC,d.id),'[]')
    INTO ds FROM orion_region.directives d WHERE EXISTS(SELECT 1 FROM orion_region.directive_assignments a WHERE a.directive_id=d.id AND a.facility_id=ANY(visible));
  result:=jsonb_build_object('schemaVersion',1,'dataMode','training','actorId',actor,'generatedAt',orion_crm.iso(clock_timestamp()),'today',today::text,
    'capabilities',jsonb_build_object('issue',(access->>'administrator')::boolean,'review',(access->>'administrator')::boolean),'facilities',fs,'directives',ds);
  IF octet_length(result::text)>4194304 THEN RAISE EXCEPTION 'DIRECTIVE_LIMIT' USING ERRCODE='PT503'; END IF;
  INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,after_state)
    VALUES(actor,selected,'directive.snapshot.read',coalesce(selected,'authorized-directives'),'{}');
  RETURN result;
END $$;

CREATE FUNCTION orion_region.directive_text_valid(p_text text,p_max integer,p_allow_blank boolean DEFAULT false) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT p_text IS NOT NULL AND (p_allow_blank OR
    length(btrim(p_text,E' \t\r\n\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF'))>0) AND
    (SELECT coalesce(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0)<=p_max FROM regexp_split_to_table(p_text,'') ch)
$$;
CREATE FUNCTION orion_region.directive_filename_valid(p_name text) RETURNS boolean
LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  -- Match the HTTP/DTO boundary, including format characters and Windows names.
  SELECT p_name IS NOT NULL AND length(p_name)>0 AND
    p_name=btrim(p_name,E' \t\r\n\f'||chr(11)||U&'\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF') AND
    p_name!~'[<>:"|?*]' AND strpos(p_name,'/')=0 AND strpos(p_name,E'\\')=0 AND
    left(p_name,1)<>'.' AND p_name!~'[. ]$' AND lower(p_name)!~'^(con|prn|aux|nul|com[1-9]|lpt[1-9])([.]|$)' AND
    (SELECT coalesce(sum(CASE WHEN ascii(ch)>65535 THEN 2 ELSE 1 END),0)<=180 AND
      NOT coalesce(bool_or(ascii(ch) BETWEEN 0 AND 31 OR ascii(ch) BETWEEN 127 AND 159 OR
        ascii(ch) IN (173,1564,1757,1807,2274,6158,65279,69821,69837,917505) OR
        ascii(ch) BETWEEN 1536 AND 1541 OR ascii(ch) BETWEEN 2192 AND 2193 OR
        ascii(ch) BETWEEN 8203 AND 8207 OR ascii(ch) BETWEEN 8234 AND 8238 OR
        ascii(ch) BETWEEN 8288 AND 8292 OR ascii(ch) BETWEEN 8294 AND 8303 OR
        ascii(ch) BETWEEN 65529 AND 65531 OR ascii(ch) BETWEEN 78896 AND 78911 OR
        ascii(ch) BETWEEN 113824 AND 113827 OR ascii(ch) BETWEEN 119155 AND 119162 OR
        ascii(ch) BETWEEN 917536 AND 917631),false)
      FROM regexp_split_to_table(p_name,'') ch)
$$;
CREATE FUNCTION orion_region.validate_directive_files(p_files jsonb,p_required_purpose text) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE f jsonb; raw bytea; mime text; name text; encoded text; total_bytes integer:=0; text_content text; names text[]:='{}';
BEGIN
  IF jsonb_typeof(p_files) IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
  IF jsonb_array_length(p_files) NOT BETWEEN 1 AND 3 OR
    (SELECT count(*) FROM jsonb_array_elements(p_files) x WHERE x->>'purpose'=p_required_purpose)<>1 THEN
    RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
  END IF;
  FOR f IN SELECT value FROM jsonb_array_elements(p_files) LOOP
    IF jsonb_typeof(f) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(ARRAY['fileName','mimeType','contentBase64','purpose']) k WHERE jsonb_typeof(f->k) IS DISTINCT FROM 'string') OR
      EXISTS(SELECT 1 FROM jsonb_object_keys(f) k WHERE k NOT IN ('fileName','mimeType','contentBase64','purpose')) THEN
      RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
    END IF;
    name:=f->>'fileName'; mime:=f->>'mimeType'; encoded:=f->>'contentBase64';
    IF NOT orion_region.directive_filename_valid(name) OR lower(name)=ANY(names) OR
      f->>'purpose' NOT IN (p_required_purpose,'supporting') OR length(encoded) NOT BETWEEN 4 AND 2796204 OR
      encoded!~'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN
      RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
    END IF;
    names:=array_append(names,lower(name));
    raw:=decode(encoded,'base64');
    IF octet_length(raw) NOT BETWEEN 1 AND 2097152 OR replace(encode(raw,'base64'),E'\n','')<>encoded THEN
      RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
    END IF;
    total_bytes:=total_bytes+octet_length(raw);
    IF total_bytes>6291456 THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    IF mime='application/pdf' THEN
      IF lower(name)!~'[.]pdf$' OR substring(raw FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    ELSIF mime='image/png' THEN
      IF lower(name)!~'[.]png$' OR substring(raw FROM 1 FOR 8)<>decode('89504e470d0a1a0a','hex') THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    ELSIF mime='image/jpeg' THEN
      IF lower(name)!~'[.](jpg|jpeg)$' OR substring(raw FROM 1 FOR 3)<>decode('ffd8ff','hex') THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    ELSIF mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN
      IF lower(name)!~'[.]docx$' OR substring(raw FROM 1 FOR 4)<>decode('504b0304','hex') OR
        position(convert_to('[Content_Types].xml','UTF8') IN raw)=0 OR position(convert_to('word/document.xml','UTF8') IN raw)=0 THEN
        RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
      END IF;
    ELSIF mime='text/plain' THEN
      IF lower(name)!~'[.]txt$' THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
      BEGIN text_content:=convert_from(raw,'UTF8');
      EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END;
      IF EXISTS(SELECT 1 FROM regexp_split_to_table(text_content,'') ch WHERE ascii(ch)<32 AND ascii(ch) NOT IN (9,10,13)) THEN
        RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
      END IF;
    ELSE RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
    END IF;
  END LOOP;
END $$;

CREATE FUNCTION public.orion_regional_directive_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE access jsonb:=orion_region.directive_access(p_issuer,p_subject); actor text:=access->>'actorId';
  is_admin boolean:=(access->>'administrator')::boolean; visible text[]; heads text[]; targets text[];
  kind text; allowed text[]; required text[]; field text; key uuid; request_hash text; receipt orion_region.directive_receipts;
  a orion_region.directive_assignments; d orion_region.directives; before_state jsonb; event_id text; event_remark text;
  result jsonb; expected integer; due date; actual date; decision text; file jsonb; target text;
  today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>9437184 THEN
    RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
  END IF;
  kind:=p_command->>'type';
  IF jsonb_typeof(p_command->'type') IS DISTINCT FROM 'string' OR kind NOT IN ('create','progress','submit','explain','review') THEN
    RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
  END IF;
  required:=ARRAY['type','idempotencyKey','expectedVersion']||CASE kind
    WHEN 'create' THEN ARRAY['title','authorityReference','details','dueDate','facilityIds']
    WHEN 'progress' THEN ARRAY['assignmentId','progress']
    WHEN 'submit' THEN ARRAY['assignmentId','actualCompletedDate','attachments']
    WHEN 'explain' THEN ARRAY['assignmentId','message','attachments']
    WHEN 'review' THEN ARRAY['assignmentId','decision'] END;
  allowed:=required||CASE WHEN kind='review' THEN ARRAY['remark'] ELSE '{}'::text[] END;
  IF EXISTS(SELECT 1 FROM unnest(required) k WHERE NOT p_command?k) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE NOT k=ANY(allowed)) OR
    jsonb_typeof(p_command->'idempotencyKey') IS DISTINCT FROM 'string' OR (p_command->>'idempotencyKey')!~'^[a-fA-F0-9]{8}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{4}-[a-fA-F0-9]{12}$' OR
    jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' OR (p_command->>'expectedVersion')!~'^(0|[1-9][0-9]{0,9})$' OR (p_command->>'expectedVersion')::numeric>2147483647 THEN
    RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
  END IF;
  expected:=(p_command->>'expectedVersion')::integer;
  IF (kind='create' AND expected<>0) OR (kind<>'create' AND expected<1) THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  SELECT ARRAY(SELECT jsonb_array_elements_text(access->'facilities')) INTO visible;
  SELECT ARRAY(SELECT jsonb_array_elements_text(access->'headFacilities')) INTO heads;
  IF kind='create' THEN
    IF NOT is_admin THEN RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
    FOREACH field IN ARRAY ARRAY['title','authorityReference','details','dueDate'] LOOP
      IF jsonb_typeof(p_command->field) IS DISTINCT FROM 'string' OR NOT orion_region.directive_text_valid(p_command->>field,
        CASE WHEN field='details' THEN 4000 WHEN field='dueDate' THEN 10 ELSE 180 END) THEN
        RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
      END IF;
    END LOOP;
    IF (p_command->>'dueDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR jsonb_typeof(p_command->'facilityIds') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    BEGIN due:=(p_command->>'dueDate')::date;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400'; END;
    IF due<'1900-01-01' OR due>'2200-12-31' OR jsonb_array_length(p_command->'facilityIds') NOT BETWEEN 1 AND 36 OR
      EXISTS(SELECT 1 FROM jsonb_array_elements(p_command->'facilityIds') x WHERE jsonb_typeof(x) IS DISTINCT FROM 'string') THEN
      RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
    END IF;
    SELECT ARRAY(SELECT jsonb_array_elements_text(p_command->'facilityIds')) INTO targets;
    IF (SELECT count(DISTINCT t) FROM unnest(targets) t)<>cardinality(targets) THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    IF EXISTS(SELECT 1 FROM unnest(targets) t WHERE NOT t=ANY(visible)) THEN RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
    PERFORM c.id FROM orion_crm.clinics c JOIN orion_region.facilities f ON f.clinic_id=c.id WHERE f.id=ANY(targets) ORDER BY c.id FOR SHARE OF c;
    IF EXISTS(SELECT 1 FROM orion_region.facilities f JOIN orion_crm.clinics c ON c.id=f.clinic_id WHERE f.id=ANY(targets) AND (NOT c.active OR c.mode<>'synthetic_simulation')) THEN
      RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403';
    END IF;
  ELSE
    IF jsonb_typeof(p_command->'assignmentId') IS DISTINCT FROM 'string' OR length(p_command->>'assignmentId') NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
    END IF;
    SELECT * INTO a FROM orion_region.directive_assignments WHERE id=p_command->>'assignmentId' AND facility_id=ANY(visible) FOR UPDATE;
    IF NOT FOUND THEN
      IF NOT is_admin THEN RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
      RAISE EXCEPTION 'DIRECTIVE_NOT_FOUND' USING ERRCODE='PT404';
    END IF;
    PERFORM c.id FROM orion_crm.clinics c JOIN orion_region.facilities f ON f.clinic_id=c.id WHERE f.id=a.facility_id FOR SHARE OF c;
    IF NOT EXISTS(SELECT 1 FROM orion_region.facilities f JOIN orion_crm.clinics c ON c.id=f.clinic_id AND c.active AND c.mode='synthetic_simulation' WHERE f.id=a.facility_id) THEN
      RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403';
    END IF;
    IF (kind='review' AND (NOT is_admin OR a.submitted_by=actor)) OR (kind<>'review' AND NOT a.facility_id=ANY(heads)) THEN
      RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403';
    END IF;
    SELECT * INTO d FROM orion_region.directives WHERE id=a.directive_id;
  END IF;
  key:=(p_command->>'idempotencyKey')::uuid;
  request_hash:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  -- Serialize same-principal retries even when two create commands have no row
  -- to lock yet. Authorization above is repeated BEFORE receipt replay.
  PERFORM pg_advisory_xact_lock(hashtextextended('orion-directive:'||actor||':'||key::text,0));
  SELECT * INTO receipt FROM orion_region.directive_receipts WHERE user_id=actor AND idempotency_key=key;
  IF FOUND THEN
    IF receipt.request_hash<>request_hash THEN RAISE EXCEPTION 'DIRECTIVE_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
    RETURN receipt.result||jsonb_build_object('replayed',true);
  END IF;
  IF kind='create' THEN
    IF due<today THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    PERFORM pg_advisory_xact_lock(7791324004);
    IF (SELECT count(*) FROM orion_region.directives)>=100 THEN RAISE EXCEPTION 'DIRECTIVE_LIMIT' USING ERRCODE='PT503'; END IF;
    INSERT INTO orion_region.directives(title,authority_reference,details,issued_by,issued_date,due_date)
      VALUES(btrim(p_command->>'title'),btrim(p_command->>'authorityReference'),btrim(p_command->>'details'),actor,today,due) RETURNING * INTO d;
    FOREACH target IN ARRAY targets LOOP
      INSERT INTO orion_region.directive_assignments(directive_id,facility_id) VALUES(d.id,target) RETURNING * INTO a;
      INSERT INTO orion_region.directive_events(assignment_id,version,user_id,action,status,progress,work_cycle)
        VALUES(a.id,1,actor,'create','assigned',0,1);
    END LOOP;
    result:=jsonb_build_object('directiveId',d.id,'assignmentId',NULL,'version',1,'replayed',false);
    INSERT INTO orion_region.audit_events(user_id,action,resource_id,after_state)
      VALUES(actor,'directive.create',d.id,jsonb_build_object('facilityIds',targets,'dueDate',due));
  ELSE
    IF a.version<>expected THEN RAISE EXCEPTION 'DIRECTIVE_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    before_state:=to_jsonb(a);
    IF kind='progress' THEN
      IF a.status NOT IN ('assigned','in_progress','returned_work') THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
      IF jsonb_typeof(p_command->'progress') IS DISTINCT FROM 'number' OR (p_command->>'progress')!~'^(0|[1-9][0-9]?|100)$' THEN
        RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
      END IF;
      UPDATE orion_region.directive_assignments SET status='in_progress',progress=(p_command->>'progress')::integer,
        version=version+1,updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
    ELSIF kind='submit' THEN
      IF a.status NOT IN ('assigned','in_progress','returned_documents','returned_work') THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
      IF jsonb_typeof(p_command->'actualCompletedDate') IS DISTINCT FROM 'string' OR (p_command->>'actualCompletedDate')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
        RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
      END IF;
      BEGIN actual:=(p_command->>'actualCompletedDate')::date;
      EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400'; END;
      IF actual<d.issued_date OR actual>today THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      IF a.status='returned_documents' AND actual<>a.actual_completed_date THEN RAISE EXCEPTION 'DIRECTIVE_COMPLETION_DATE_LOCKED' USING ERRCODE='PT409'; END IF;
      IF a.work_not_before IS NOT NULL AND actual<a.work_not_before THEN RAISE EXCEPTION 'DIRECTIVE_REWORK_DATE_REQUIRED' USING ERRCODE='PT409'; END IF;
      PERFORM orion_region.validate_directive_files(p_command->'attachments','report');
      UPDATE orion_region.directive_assignments SET status='submitted',progress=100,actual_completed_date=actual,submitted_at=clock_timestamp(),submitted_by=actor,
        reviewed_at=NULL,review_remark=NULL,version=version+1,updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
    ELSIF kind='explain' THEN
      IF a.status='accepted' OR NOT (today>d.due_date OR coalesce(a.actual_completed_date>d.due_date,false)) THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
      IF jsonb_typeof(p_command->'message') IS DISTINCT FROM 'string' OR NOT orion_region.directive_text_valid(p_command->>'message',4000) THEN
        RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400';
      END IF;
      PERFORM orion_region.validate_directive_files(p_command->'attachments','explanation');
      event_remark:=btrim(p_command->>'message');
      UPDATE orion_region.directive_assignments SET explained_cycle=work_cycle,version=version+1,updated_at=clock_timestamp() WHERE id=a.id RETURNING * INTO a;
    ELSIF kind='review' THEN
      IF a.status<>'submitted' THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
      decision:=p_command->>'decision';
      IF jsonb_typeof(p_command->'decision') IS DISTINCT FROM 'string' OR decision NOT IN ('accept','return_documents','return_work') OR
        (p_command?'remark' AND (jsonb_typeof(p_command->'remark') IS DISTINCT FROM 'string' OR NOT orion_region.directive_text_valid(p_command->>'remark',2000,true))) OR
        (decision<>'accept' AND NOT orion_region.directive_text_valid(p_command->>'remark',2000)) THEN RAISE EXCEPTION 'DIRECTIVE_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      IF decision='accept' AND orion_region.directive_needs_explanation(a,d.due_date,today) THEN RAISE EXCEPTION 'DIRECTIVE_EXPLANATION_REQUIRED' USING ERRCODE='PT409'; END IF;
      event_remark:=nullif(btrim(p_command->>'remark'),'');
      UPDATE orion_region.directive_assignments SET
        status=CASE decision WHEN 'accept' THEN 'accepted' WHEN 'return_documents' THEN 'returned_documents' ELSE 'returned_work' END,
        progress=CASE WHEN decision='return_work' THEN 0 ELSE progress END,
        actual_completed_date=CASE WHEN decision='return_work' THEN NULL ELSE actual_completed_date END,
        submitted_at=CASE WHEN decision='return_work' THEN NULL ELSE submitted_at END,
        submitted_by=CASE WHEN decision='return_work' THEN NULL ELSE submitted_by END,
        work_cycle=work_cycle+CASE WHEN decision='return_work' THEN 1 ELSE 0 END,
        work_not_before=CASE WHEN decision='return_work' THEN today ELSE work_not_before END,
        reviewed_at=clock_timestamp(),review_remark=event_remark,version=version+1,updated_at=clock_timestamp()
        WHERE id=a.id RETURNING * INTO a;
    END IF;
    INSERT INTO orion_region.directive_events(assignment_id,version,user_id,action,status,progress,actual_completed_date,work_cycle,remark)
      VALUES(a.id,a.version,actor,kind,a.status,a.progress,a.actual_completed_date,a.work_cycle,event_remark) RETURNING id INTO event_id;
    IF kind IN ('submit','explain') THEN
      IF (SELECT count(*) FROM orion_region.directive_attachments WHERE assignment_id=a.id)+jsonb_array_length(p_command->'attachments')>150 THEN
        RAISE EXCEPTION 'DIRECTIVE_LIMIT' USING ERRCODE='PT503';
      END IF;
      FOR file IN SELECT value FROM jsonb_array_elements(p_command->'attachments') LOOP
        INSERT INTO orion_region.directive_attachments(assignment_id,event_id,file_name,mime_type,purpose,content)
          VALUES(a.id,event_id,file->>'fileName',file->>'mimeType',file->>'purpose',decode(file->>'contentBase64','base64'));
      END LOOP;
    END IF;
    result:=jsonb_build_object('directiveId',a.directive_id,'assignmentId',a.id,'version',a.version,'replayed',false);
    INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,before_state,after_state)
      VALUES(actor,a.facility_id,'directive.'||kind,a.id,before_state,to_jsonb(a));
  END IF;
  -- Explicit fresh authority check still occurs while all grant/membership locks
  -- are held; repository also revalidates the login before committing this RPC.
  PERFORM orion_region.directive_access(p_issuer,p_subject);
  INSERT INTO orion_region.directive_receipts(user_id,idempotency_key,request_hash,result) VALUES(actor,key,request_hash,result);
  RETURN result;
END $$;

CREATE FUNCTION public.orion_regional_directive_attachment_v1(p_issuer text,p_subject text,p_attachment text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE access jsonb:=orion_region.directive_access(p_issuer,p_subject); visible text[]; f orion_region.directive_attachments; facility text;
BEGIN
  IF p_attachment IS NULL OR length(p_attachment) NOT BETWEEN 1 AND 160 OR p_attachment!~'^[A-Za-z0-9_-]+$' THEN
    RAISE EXCEPTION 'DIRECTIVE_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  SELECT ARRAY(SELECT jsonb_array_elements_text(access->'facilities')) INTO visible;
  SELECT x.* INTO f FROM orion_region.directive_attachments x
    JOIN orion_region.directive_assignments a ON a.id=x.assignment_id WHERE x.id=p_attachment AND a.facility_id=ANY(visible);
  IF f.id IS NULL THEN RAISE EXCEPTION 'DIRECTIVE_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  SELECT facility_id INTO facility FROM orion_region.directive_assignments WHERE id=f.assignment_id;
  INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,after_state)
    VALUES(access->>'actorId',facility,'directive.attachment.read',f.id,jsonb_build_object('sha256',f.sha256,'byteLength',f.byte_length));
  RETURN jsonb_build_object('schemaVersion',1,'attachment',orion_region.directive_attachment_metadata(f),'contentBase64',replace(encode(f.content,'base64'),E'\n',''));
END $$;

-- Only NEW identities: no role inheritance, no clinical/administrator directory
-- assignments, no passwords in PostgreSQL or source. Main provisions credentials.
INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source)
VALUES('directive-admin','orion:local:directives','directive-admin','Администратор поручений','active','postgres');
INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status,interactive)
VALUES('crm-clinic-local','directive-membership-admin','directive-admin','active',true);
INSERT INTO orion_region.directive_grants(id,user_id,role,clinic_id,membership_id,reason)
VALUES('directive-grant-admin','directive-admin','administrator','crm-clinic-local','directive-membership-admin','Отдельная учебная роль для поручений; без доступа к медицинским данным');
INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source)
SELECT 'head-'||id,'orion:local:directives','head-'||id,'Руководитель · '||name,'active','postgres' FROM orion_region.facilities WHERE data_mode='training';
INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status,interactive)
SELECT clinic_id,'directive-membership-'||id,'head-'||id,'active',true FROM orion_region.facilities WHERE data_mode='training';
INSERT INTO orion_region.directive_grants(id,user_id,role,facility_id,clinic_id,membership_id,reason)
SELECT 'directive-grant-'||id,'head-'||id,'head',id,clinic_id,'directive-membership-'||id,
  'Учебный руководитель только своего учреждения; подача отчётов без медицинских прав' FROM orion_region.facilities WHERE data_mode='training';
INSERT INTO orion_directory.audit_events(clinic_id,actor_user_id,action,resource_id,after_state,reason)
SELECT g.clinic_id,NULL,'directive.identity.bootstrap',g.user_id,jsonb_build_object('role',g.role,'facilityId',g.facility_id,'clinicalAssignments',0),
  'Explicit owner authorization DIRECTIVES-1; new dedicated identities only, no existing grants changed' FROM orion_region.directive_grants g;

-- Manually authored local examples are explicitly NOT real government orders.
-- Every assignment starts awaiting work: no invented progress or approval.
DO $$ DECLARE all_facilities text[]; hospitals text[]; today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date;
BEGIN
  SELECT array_agg(id ORDER BY id) INTO all_facilities FROM orion_region.facilities WHERE data_mode='training';
  SELECT array_agg(id ORDER BY id) INTO hospitals FROM orion_region.facilities WHERE kind='hospital' AND data_mode='training';
  PERFORM public.orion_regional_directive_command_v1('orion:local:directives','directive-admin',jsonb_build_object(
    'type','create','idempotencyKey','d1000000-1000-4000-8000-000000000001','expectedVersion',0,
    'title','Представить акт проверки хранения лекарств','authorityReference','Учебное письмо ORION №01; не документ государственного органа',
    'details','Проверьте условия хранения, сроки годности и учёт остатков. Руководитель учреждения подаёт подписанный отчёт и подтверждающие материалы. Получение поручения не означает выполнение.',
    'dueDate',(today+10)::text,'facilityIds',to_jsonb(all_facilities)));
  PERFORM public.orion_regional_directive_command_v1('orion:local:directives','directive-admin',jsonb_build_object(
    'type','create','idempotencyKey','d1000000-1000-4000-8000-000000000002','expectedVersion',0,
    'title','Сверить кадровый план врачебных должностей','authorityReference','Учебное письмо ORION №02; не документ государственного органа',
    'details','Сопоставьте штатное расписание с числом врачей по основному месту работы. Приложите итоговый отчёт без персональных данных сотрудников. Это административная сверка, а не медицинский KPI.',
    'dueDate',(today+21)::text,'facilityIds',to_jsonb(hospitals)));
  PERFORM public.orion_regional_directive_command_v1('orion:local:directives','directive-admin',jsonb_build_object(
    'type','create','idempotencyKey','d1000000-1000-4000-8000-000000000003','expectedVersion',0,
    'title','Представить план сокращения лабораторных задержек','authorityReference','Учебное письмо ORION №03; не документ государственного органа',
    'details','Разберите этапы получения образца и выдачи результата. В отчёте укажите причины задержек и согласованные действия; не прикладывайте данные пациентов. Подтверждение выполняет отдельный администратор поручений.',
    'dueDate',(today+14)::text,'facilityIds',jsonb_build_array('sozak-hospital','sozak-polyclinic','saryagash-hospital','saryagash-polyclinic','shardara-hospital','shardara-polyclinic')));
END $$;

REVOKE ALL ON orion_region.directive_grants,orion_region.directives,orion_region.directive_assignments,
  orion_region.directive_events,orion_region.directive_attachments,orion_region.directive_receipts FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION orion_region.directive_assignment_guard(),orion_region.directive_access(text,text),
  orion_region.directive_needs_explanation(orion_region.directive_assignments,date,date),
  orion_region.directive_attachment_metadata(orion_region.directive_attachments),
  orion_region.directive_assignment_json(orion_region.directive_assignments,date,date),
  orion_region.directive_text_valid(text,integer,boolean),orion_region.directive_filename_valid(text),orion_region.validate_directive_files(jsonb,text) FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_regional_directives_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_regional_directives_v1(text,text,jsonb) TO orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_regional_directive_command_v1(text,text,jsonb),public.orion_regional_directive_attachment_v1(text,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_regional_directive_command_v1(text,text,jsonb),public.orion_regional_directive_attachment_v1(text,text,text) TO orion_crm_app;
COMMIT;
