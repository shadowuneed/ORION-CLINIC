-- FORWARD ONLY after already applied 0002/0003. Apply once, as migration owner,
-- only after review and explicit approval of this exact dedicated-project change.
-- No data copy, bootstrap, raw SQL gateway, elevated application key or new table.
BEGIN;

CREATE INDEX patient_profile_heads_directory_idx ON orion_private.patient_profile_heads
  (organization_id,facility_id,updated_at DESC,patient_id DESC);
CREATE INDEX memberships_user_scope_idx ON orion_private.memberships
  (user_id,organization_id,facility_id,id);
CREATE INDEX access_assignments_member_scope_idx ON orion_private.department_access_assignments
  (organization_id,facility_id,membership_id,id);

-- Never trim a clinical reason to make the DTO parse. Existing invalid content
-- aborts this migration for explicit reconciliation; subsequent writes are bounded.
ALTER TABLE orion_private.encounters ADD CONSTRAINT encounters_reason_dto_bound
  CHECK (reason_for_visit IS NULL OR length(reason_for_visit)<=500);

CREATE FUNCTION orion_private.bounded_patient_response(value jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN
  -- 768KiB UTF-8 for the full SQL JSON envelope leaves transport headroom below
  -- the server's 1MiB limit. An exception here is INSIDE the command transaction.
  IF value IS NULL OR octet_length(value::text)>786432 THEN
    RAISE EXCEPTION 'PATIENT_RESPONSE_TOO_LARGE' USING ERRCODE='PT503';
  END IF;
  PERFORM orion_private.validate_patient_response_scalars(value);
  RETURN value;
END $$;

-- PostgreSQL length counts Unicode code points; JavaScript/Zod string limits
-- count UTF-16 code units. Validate the emitted bytes using the latter contract
-- before a transaction can commit, including direct RPC callers bypassing API.
CREATE FUNCTION orion_private.patient_utf16_length(value text) RETURNS integer
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT length(value)+coalesce(sum(CASE WHEN ascii(c)>65535 THEN 1 ELSE 0 END),0)::integer
  FROM regexp_split_to_table(value,'') c
$$;
CREATE FUNCTION orion_private.validate_patient_response_scalars(value jsonb) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE field text; item jsonb; limit_units integer; date_value date;
BEGIN
  IF jsonb_typeof(value)='array' THEN
    FOR item IN SELECT jsonb_array_elements(value) LOOP PERFORM orion_private.validate_patient_response_scalars(item); END LOOP;
  ELSIF jsonb_typeof(value)='object' THEN
    FOR field,item IN SELECT key,val FROM jsonb_each(value) e(key,val) LOOP
      IF jsonb_typeof(item) IN ('array','object') THEN
        PERFORM orion_private.validate_patient_response_scalars(item);
      ELSIF item IS DISTINCT FROM 'null'::jsonb THEN
        limit_units:=CASE
          WHEN field='id' OR field LIKE '%Id' THEN 160
          WHEN field IN ('displayName','medicalRecordNumber','actorDisplayName','changeReason','address') THEN 300
          WHEN field='phone' THEN 40 WHEN field='email' THEN 160 WHEN field='reasonForVisit' THEN 500
          ELSE NULL END;
        IF limit_units IS NOT NULL AND (jsonb_typeof(item)<>'string'
          OR orion_private.patient_utf16_length(item#>>'{}')>limit_units
          OR (field IN ('id','displayName','medicalRecordNumber','actorDisplayName') AND length(item#>>'{}')=0)) THEN
          RAISE EXCEPTION 'INVALID_PATIENT_RESPONSE' USING ERRCODE='PT400';
        END IF;
        IF field IN ('createdAt','updatedAt','startedAt','endedAt','observedAt','version','profileVersion','beforeVersion','encounterCount','profileHistoryCount')
          AND (jsonb_typeof(item)<>'number' OR (item#>>'{}') !~ '^(0|[1-9][0-9]{0,15})$'
            OR (item#>>'{}')::numeric>9007199254740991
            OR (field IN ('version','profileVersion','beforeVersion') AND (item#>>'{}')::numeric=0)) THEN
          RAISE EXCEPTION 'INVALID_PATIENT_RESPONSE' USING ERRCODE='PT400';
        END IF;
        IF field='birthDate' THEN
          IF jsonb_typeof(item)<>'string' OR (item#>>'{}') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN
            RAISE EXCEPTION 'INVALID_PATIENT_RESPONSE' USING ERRCODE='PT400';
          END IF;
          BEGIN date_value:=(item#>>'{}')::date;
            EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'INVALID_PATIENT_RESPONSE' USING ERRCODE='PT400';
          END;
          IF to_char(date_value,'YYYY-MM-DD')<>item#>>'{}' THEN RAISE EXCEPTION 'INVALID_PATIENT_RESPONSE' USING ERRCODE='PT400'; END IF;
        END IF;
        IF field='testIin' AND (jsonb_typeof(item)<>'string' OR (item#>>'{}') !~ '^[0-9]{12}$') THEN
          RAISE EXCEPTION 'INVALID_PATIENT_RESPONSE' USING ERRCODE='PT400';
        END IF;
        IF field='photoUrl' THEN RAISE EXCEPTION 'INVALID_PATIENT_RESPONSE' USING ERRCODE='PT400'; END IF;
      END IF;
    END LOOP;
  END IF;
END $$;

CREATE FUNCTION orion_private.patient_cursor_scope(scope jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  SELECT jsonb_build_object('domainVersion',1,'organizationId',scope#>>'{organization,id}',
    'facilityId',scope#>>'{facility,id}','assignmentId',scope->>'assignmentId',
    'assignmentVersionId',scope->>'assignmentVersionId')
$$;

CREATE FUNCTION orion_private.validate_patient_cursor(value jsonb,scope jsonb,kind text,
  pat_id text DEFAULT NULL,profile_version integer DEFAULT NULL,q text DEFAULT NULL,
  patient_status text DEFAULT NULL) RETURNS void
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE field text; fields text[];
BEGIN
  IF value IS NULL THEN RETURN; END IF;
  IF jsonb_typeof(value) IS DISTINCT FROM 'object' OR octet_length(value::text)>1536 THEN
    RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
  END IF;
  fields:=ARRAY['domainVersion','kind','organizationId','facilityId','assignmentId','assignmentVersionId','patientId']
    ||CASE kind WHEN 'directory' THEN ARRAY['query','status','updatedAt']
       WHEN 'profile' THEN ARRAY['profileVersion','beforeVersion']
       WHEN 'encounters' THEN ARRAY['profileVersion','updatedAt','encounterId'] ELSE NULL END;
  IF fields IS NULL OR (SELECT count(*) FROM jsonb_object_keys(value))<>cardinality(fields)
    OR EXISTS(SELECT 1 FROM jsonb_object_keys(value) k WHERE k<>ALL(fields)) THEN
    RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
  END IF;
  FOREACH field IN ARRAY ARRAY['kind','organizationId','facilityId','assignmentId','assignmentVersionId','patientId'] LOOP
    IF jsonb_typeof(value->field) IS DISTINCT FROM 'string' OR orion_private.patient_utf16_length(value->>field) NOT BETWEEN 1 AND 160 THEN
      RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
    END IF;
  END LOOP;
  IF value->'domainVersion' IS DISTINCT FROM '1'::jsonb OR value->>'kind' IS DISTINCT FROM kind
    OR value->>'organizationId' IS DISTINCT FROM scope#>>'{organization,id}'
    OR value->>'facilityId' IS DISTINCT FROM scope#>>'{facility,id}'
    OR value->>'assignmentId' IS DISTINCT FROM scope->>'assignmentId' THEN
    RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
  END IF;
  IF value->>'assignmentVersionId' IS DISTINCT FROM scope->>'assignmentVersionId' THEN
    RAISE EXCEPTION 'PAGINATION_STALE' USING ERRCODE='PT409';
  END IF;
  IF kind='directory' THEN
    IF jsonb_typeof(value->'query') IS DISTINCT FROM 'string' OR orion_private.patient_utf16_length(value->>'query')>120
      OR value->>'query' IS DISTINCT FROM q OR value->>'status' IS DISTINCT FROM patient_status
      OR jsonb_typeof(value->'status') IS DISTINCT FROM 'string' THEN
      RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
    END IF;
  ELSE
    IF value->>'patientId' IS DISTINCT FROM pat_id OR jsonb_typeof(value->'profileVersion') IS DISTINCT FROM 'number'
      OR (value->>'profileVersion') !~ '^[1-9][0-9]{0,9}$'
      OR (value->>'profileVersion')::numeric>2147483647 THEN
      RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
    END IF;
    IF (value->>'profileVersion')::integer IS DISTINCT FROM profile_version THEN
      RAISE EXCEPTION 'PAGINATION_STALE' USING ERRCODE='PT409';
    END IF;
  END IF;
  IF kind='profile' THEN
    IF jsonb_typeof(value->'beforeVersion') IS DISTINCT FROM 'number'
      OR (value->>'beforeVersion') !~ '^[1-9][0-9]{0,9}$'
      OR (value->>'beforeVersion')::numeric>2147483647 THEN
      RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
    END IF;
  ELSE
    IF jsonb_typeof(value->'updatedAt') IS DISTINCT FROM 'number'
      OR (value->>'updatedAt') !~ '^(0|[1-9][0-9]{0,15})$'
      OR (value->>'updatedAt')::numeric>9007199254740991 THEN
      RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
    END IF;
    IF kind='encounters' AND (jsonb_typeof(value->'encounterId') IS DISTINCT FROM 'string'
      OR orion_private.patient_utf16_length(value->>'encounterId') NOT BETWEEN 1 AND 160) THEN
      RAISE EXCEPTION 'INVALID_CURSOR' USING ERRCODE='PT400';
    END IF;
  END IF;
END $$;

-- Internal projection only. Public entry points validate and bind assignment
-- scope; unscoped raw cursors from this helper never leave a public response.
CREATE FUNCTION orion_private.patient_history_window(org_id text,fac_id text,pat_id text,
  profile_version integer,kind text,max_results integer,cursor jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE items jsonb; has_more boolean; next_cursor jsonb;
BEGIN
  IF kind='profile' THEN
    WITH paged_rows AS MATERIALIZED (
      SELECT v.id,v.version,v.status,v.change_reason,v.created_at,u.display_name,
        row_number() OVER(ORDER BY v.version DESC) ordinal
      FROM orion_private.patient_profile_versions v
      JOIN orion_private.memberships m ON m.organization_id=v.organization_id AND m.facility_id=v.facility_id AND m.id=v.created_by_membership_id
      JOIN orion_private.users u ON u.id=m.user_id
      WHERE v.organization_id=org_id AND v.facility_id=fac_id AND v.patient_id=pat_id
        AND v.version<=profile_version AND (cursor IS NULL OR v.version<(cursor->>'beforeVersion')::integer)
      ORDER BY v.version DESC LIMIT max_results+1
    ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',w.id,'version',w.version,'status',w.status,
        'changeReason',w.change_reason,'createdAt',w.created_at,'actorDisplayName',w.display_name)
        ORDER BY w.version DESC) FILTER(WHERE w.ordinal<=max_results),'[]'::jsonb),
      count(*)>max_results,
      (SELECT jsonb_build_object('kind','profile','patientId',pat_id,'profileVersion',profile_version,'beforeVersion',last.version)
       FROM paged_rows last WHERE last.ordinal=max_results)
      INTO items,has_more,next_cursor FROM paged_rows w;
  ELSE
    WITH paged_rows AS MATERIALIZED (
      SELECT e.*,row_number() OVER(ORDER BY e.updated_at DESC,e.id DESC) ordinal
      FROM orion_private.encounters e
      WHERE e.organization_id=org_id AND e.facility_id=fac_id AND e.patient_id=pat_id
        AND (cursor IS NULL OR (e.updated_at,e.id)<((cursor->>'updatedAt')::bigint,cursor->>'encounterId'))
      ORDER BY e.updated_at DESC,e.id DESC LIMIT max_results+1
    ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',w.id,'status',w.status,'reasonForVisit',w.reason_for_visit,
        'startedAt',w.started_at,'endedAt',w.ended_at,'createdAt',w.created_at,'updatedAt',w.updated_at,'version',w.version)
        ORDER BY w.updated_at DESC,w.id DESC) FILTER(WHERE w.ordinal<=max_results),'[]'::jsonb),
      count(*)>max_results,
      (SELECT jsonb_build_object('kind','encounters','patientId',pat_id,'profileVersion',profile_version,
        'updatedAt',last.updated_at,'encounterId',last.id) FROM paged_rows last WHERE last.ordinal=max_results)
      INTO items,has_more,next_cursor FROM paged_rows w;
  END IF;
  RETURN jsonb_build_object('items',items,'page',jsonb_build_object('hasMore',has_more,
    'nextCursor',CASE WHEN has_more THEN next_cursor||jsonb_build_object('organizationId',org_id,'facilityId',fac_id) ELSE NULL END));
END $$;

CREATE OR REPLACE FUNCTION orion_private.patient_json(org_id text,fac_id text,pat_id text,detail boolean DEFAULT false)
RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE result jsonb; profile_window jsonb; encounter_window jsonb;
BEGIN
  SELECT jsonb_build_object('id',p.id,'medicalRecordNumber',p.medical_record_number,'displayName',v.display_name,
    'birthDate',v.birth_date,'sexAtBirth',v.sex_at_birth,'status',v.status,
    'testIin',(SELECT i.normalized_value FROM orion_private.patient_identifiers i WHERE i.organization_id=p.organization_id AND i.facility_id=p.facility_id AND i.patient_id=p.id AND i.kind='test_iin' AND i.status='active'),
    'phone',v.phone,'email',v.email,'address',v.address,'photoUrl',NULL,
    'encounterCount',(SELECT count(*) FROM orion_private.encounters e WHERE e.organization_id=p.organization_id AND e.facility_id=p.facility_id AND e.patient_id=p.id),
    'latestEncounter',(SELECT jsonb_build_object('id',e.id,'status',e.status,'reasonForVisit',e.reason_for_visit,'updatedAt',e.updated_at)
      FROM orion_private.encounters e WHERE e.organization_id=p.organization_id AND e.facility_id=p.facility_id AND e.patient_id=p.id ORDER BY e.updated_at DESC,e.id DESC LIMIT 1),
    'createdAt',p.created_at,'updatedAt',h.updated_at,'version',v.version)
  INTO result FROM orion_private.patients p
  JOIN orion_private.patient_profile_heads h ON h.organization_id=p.organization_id AND h.facility_id=p.facility_id AND h.patient_id=p.id
  JOIN orion_private.patient_profile_versions v ON v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.patient_id=h.patient_id AND v.id=h.current_version_id
  WHERE p.organization_id=org_id AND p.facility_id=fac_id AND p.id=pat_id;
  IF result IS NULL THEN RETURN NULL; END IF;
  IF detail THEN
    profile_window:=orion_private.patient_history_window(org_id,fac_id,pat_id,(result->>'version')::integer,'profile',25);
    encounter_window:=orion_private.patient_history_window(org_id,fac_id,pat_id,(result->>'version')::integer,'encounters',25);
    result:=result||jsonb_build_object('profileHistory',profile_window->'items','profileHistoryCount',result->'version',
      'profileHistoryPage',profile_window->'page','encounters',encounter_window->'items','encountersPage',encounter_window->'page');
  END IF;
  RETURN orion_private.bounded_patient_response(result);
END $$;

CREATE FUNCTION orion_private.scoped_patient_response(value jsonb,scope jsonb) RETURNS jsonb
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE key text; page jsonb;
BEGIN
  IF value->'patient' IS DISTINCT FROM 'null'::jsonb THEN
    FOREACH key IN ARRAY ARRAY['profileHistoryPage','encountersPage'] LOOP
      page:=value#>ARRAY['patient',key];
      IF page->'nextCursor' IS DISTINCT FROM 'null'::jsonb THEN
        value:=jsonb_set(value,ARRAY['patient',key,'nextCursor'],(page->'nextCursor')||orion_private.patient_cursor_scope(scope));
        PERFORM orion_private.validate_patient_cursor(value#>ARRAY['patient',key,'nextCursor'],scope,
          CASE key WHEN 'profileHistoryPage' THEN 'profile' ELSE 'encounters' END,
          value#>>'{patient,id}',(value#>>'{patient,version}')::integer);
      END IF;
    END LOOP;
  END IF;
  RETURN orion_private.bounded_patient_response(value);
END $$;

-- Replace, do not overload: PostgREST must see exactly one list signature.
DROP FUNCTION public.orion_patients_list(text,text,text,text,integer);
CREATE FUNCTION public.orion_patients_list(assignment_id text,facility_id text DEFAULT NULL,
  query text DEFAULT NULL,status text DEFAULT 'active',max_results integer DEFAULT 25,cursor jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope jsonb:=orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read');
  org_id text:=scope#>>'{organization,id}'; fac_id text:=scope#>>'{facility,id}';
  q text:=lower(btrim(coalesce(query,''))); results jsonb; has_more boolean; next_cursor jsonb;
BEGIN
  IF status IS NULL OR status NOT IN ('active','inactive','merged','all') OR max_results IS NULL
    OR max_results NOT BETWEEN 1 AND 50 OR orion_private.patient_utf16_length(q)>120 THEN RAISE EXCEPTION 'INVALID_QUERY' USING ERRCODE='PT400'; END IF;
  PERFORM orion_private.validate_patient_cursor(cursor,scope,'directory',NULL,NULL,q,status);
  IF cursor IS NOT NULL AND NOT EXISTS(SELECT 1 FROM orion_private.patient_profile_heads h
    WHERE h.organization_id=org_id AND h.facility_id=fac_id AND h.patient_id=cursor->>'patientId'
      AND h.updated_at=(cursor->>'updatedAt')::bigint) THEN
    RAISE EXCEPTION 'PAGINATION_STALE' USING ERRCODE='PT409';
  END IF;
  WITH paged_rows AS MATERIALIZED (
    SELECT p.*,h.updated_at head_updated_at,v.display_name profile_name,v.birth_date profile_birth,
      v.sex_at_birth profile_sex,v.status profile_status,v.phone,v.email,v.address,v.version profile_version,
      i.normalized_value test_iin,row_number() OVER(ORDER BY h.updated_at DESC,p.id DESC) ordinal
    FROM orion_private.patient_profile_heads h
    JOIN orion_private.patients p ON p.organization_id=h.organization_id AND p.facility_id=h.facility_id AND p.id=h.patient_id
    JOIN orion_private.patient_profile_versions v ON v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.patient_id=h.patient_id AND v.id=h.current_version_id
    LEFT JOIN orion_private.patient_identifiers i ON i.organization_id=p.organization_id AND i.facility_id=p.facility_id AND i.patient_id=p.id AND i.kind='test_iin' AND i.status='active'
    WHERE h.organization_id=org_id AND h.facility_id=fac_id
      AND (orion_patients_list.status='all' OR v.status=orion_patients_list.status)
      AND (cursor IS NULL OR (h.updated_at,p.id)<((cursor->>'updatedAt')::bigint,cursor->>'patientId'))
      AND (q='' OR position(q IN lower(v.display_name))>0 OR position(q IN lower(p.medical_record_number))>0
        OR position(q IN coalesce(lower(v.phone),''))>0 OR position(q IN coalesce(i.normalized_value,''))>0)
    ORDER BY h.updated_at DESC,p.id DESC LIMIT max_results+1
  ), selected AS MATERIALIZED (SELECT * FROM paged_rows WHERE ordinal<=max_results),
  encounter_counts AS (
    SELECT e.patient_id,count(*) total FROM orion_private.encounters e JOIN selected s ON s.id=e.patient_id
    WHERE e.organization_id=org_id AND e.facility_id=fac_id GROUP BY e.patient_id
  ), latest_encounters AS (
    SELECT DISTINCT ON(e.patient_id) e.patient_id,jsonb_build_object('id',e.id,'status',e.status,
      'reasonForVisit',e.reason_for_visit,'updatedAt',e.updated_at) item
    FROM orion_private.encounters e JOIN selected s ON s.id=e.patient_id
    WHERE e.organization_id=org_id AND e.facility_id=fac_id ORDER BY e.patient_id,e.updated_at DESC,e.id DESC
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'medicalRecordNumber',s.medical_record_number,
      'displayName',s.profile_name,'birthDate',s.profile_birth,'sexAtBirth',s.profile_sex,'status',s.profile_status,
      'testIin',s.test_iin,'phone',s.phone,'email',s.email,'address',s.address,'photoUrl',NULL,
      'encounterCount',coalesce(c.total,0),'latestEncounter',l.item,'createdAt',s.created_at,
      'updatedAt',s.head_updated_at,'version',s.profile_version) ORDER BY s.head_updated_at DESC,s.id DESC),'[]'::jsonb),
    (SELECT count(*)>max_results FROM paged_rows),
    (SELECT jsonb_build_object('kind','directory','query',q,'status',orion_patients_list.status,'updatedAt',last.head_updated_at,'patientId',last.id)
      FROM selected last WHERE last.ordinal=max_results)
    INTO results,has_more,next_cursor FROM selected s
    LEFT JOIN encounter_counts c ON c.patient_id=s.id LEFT JOIN latest_encounters l ON l.patient_id=s.id;
  next_cursor:=CASE WHEN has_more THEN next_cursor||orion_private.patient_cursor_scope(scope) ELSE NULL END;
  PERFORM orion_private.validate_patient_cursor(next_cursor,scope,'directory',NULL,NULL,q,status);
  PERFORM orion_private.append_audit(scope,'patient.list','directory',jsonb_build_object('resultCount',jsonb_array_length(results),'hasMore',has_more));
  PERFORM orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read');
  RETURN orion_private.bounded_patient_response(jsonb_build_object('patients',results,'page',jsonb_build_object(
    'hasMore',has_more,'nextCursor',next_cursor),
    'accessAssignmentId',assignment_id,'observedAt',orion_private.now_ms()));
END $$;

CREATE OR REPLACE FUNCTION public.orion_patient_detail(assignment_id text,patient_id text,facility_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope jsonb:=orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read'); result jsonb;
BEGIN
  result:=orion_private.patient_json(scope#>>'{organization,id}',scope#>>'{facility,id}',patient_id,true);
  IF result IS NOT NULL THEN PERFORM orion_private.append_audit(scope,'patient.read',patient_id,jsonb_build_object('profileVersion',result->'version')); END IF;
  PERFORM orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read');
  RETURN orion_private.scoped_patient_response(jsonb_build_object('patient',result,'accessAssignmentId',assignment_id,'observedAt',orion_private.now_ms()),scope);
END $$;

CREATE FUNCTION public.orion_patient_history_page(assignment_id text,patient_id text,history_kind text,
  facility_id text DEFAULT NULL,max_results integer DEFAULT 25,cursor jsonb DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope jsonb:=orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read');
  org_id text:=scope#>>'{organization,id}'; fac_id text:=scope#>>'{facility,id}'; profile_version integer; result_window jsonb; page jsonb;
BEGIN
  IF history_kind IS NULL OR history_kind NOT IN ('profile','encounters') OR max_results IS NULL OR max_results NOT BETWEEN 1 AND 50
    OR patient_id IS NULL OR orion_private.patient_utf16_length(patient_id) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'INVALID_QUERY' USING ERRCODE='PT400'; END IF;
  SELECT v.version INTO profile_version FROM orion_private.patient_profile_heads h
    JOIN orion_private.patient_profile_versions v ON v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.patient_id=h.patient_id AND v.id=h.current_version_id
    WHERE h.organization_id=org_id AND h.facility_id=fac_id AND h.patient_id=orion_patient_history_page.patient_id FOR SHARE OF h;
  IF NOT FOUND THEN RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  PERFORM orion_private.validate_patient_cursor(cursor,scope,history_kind,patient_id,profile_version);
  IF cursor IS NOT NULL AND ((history_kind='profile' AND NOT EXISTS(SELECT 1 FROM orion_private.patient_profile_versions v
      WHERE v.organization_id=org_id AND v.facility_id=fac_id AND v.patient_id=orion_patient_history_page.patient_id
        AND v.version=(cursor->>'beforeVersion')::integer AND v.version<=profile_version))
    OR (history_kind='encounters' AND NOT EXISTS(SELECT 1 FROM orion_private.encounters e
      WHERE e.organization_id=org_id AND e.facility_id=fac_id AND e.patient_id=orion_patient_history_page.patient_id
        AND e.id=cursor->>'encounterId' AND e.updated_at=(cursor->>'updatedAt')::bigint))) THEN
    RAISE EXCEPTION 'PAGINATION_STALE' USING ERRCODE='PT409';
  END IF;
  result_window:=orion_private.patient_history_window(org_id,fac_id,patient_id,profile_version,history_kind,max_results,cursor);
  page:=result_window->'page';
  IF page->'nextCursor' IS DISTINCT FROM 'null'::jsonb THEN
    page:=jsonb_set(page,'{nextCursor}',(page->'nextCursor')||orion_private.patient_cursor_scope(scope));
    PERFORM orion_private.validate_patient_cursor(page->'nextCursor',scope,history_kind,patient_id,profile_version);
  END IF;
  PERFORM orion_private.append_audit(scope,'patient.history.read',patient_id,jsonb_build_object('historyKind',history_kind,
    'profileVersion',profile_version,'resultCount',jsonb_array_length(result_window->'items'),'hasMore',page->'hasMore'));
  PERFORM orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read');
  RETURN orion_private.bounded_patient_response(jsonb_build_object('items',result_window->'items','page',page,'historyKind',history_kind,
    'patientId',patient_id,'profileVersion',profile_version,'accessAssignmentId',assignment_id,'observedAt',orion_private.now_ms()));
END $$;

-- The existing transactional command body (validation, current-head mutation,
-- replay, idempotency, audit and authorization) is deliberately unchanged.
-- Scope binding and whole-response size validation complete within its caller's
-- same transaction. Any exception here rolls back that command and its audit.
CREATE OR REPLACE FUNCTION public.orion_patient_create(assignment_id text,payload jsonb,facility_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  result:=orion_private.patient_command(assignment_id,payload,facility_id,'patient.create');
  RETURN orion_private.scoped_patient_response(result,orion_private.require_assignment(assignment_id,facility_id,'patient.profile.write'));
END $$;
CREATE OR REPLACE FUNCTION public.orion_patient_update(assignment_id text,payload jsonb,facility_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  result:=orion_private.patient_command(assignment_id,payload,facility_id,'patient.update');
  RETURN orion_private.scoped_patient_response(result,orion_private.require_assignment(assignment_id,facility_id,'patient.profile.write'));
END $$;
CREATE OR REPLACE FUNCTION public.orion_patient_archive(assignment_id text,payload jsonb,facility_id text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  result:=orion_private.patient_command(assignment_id,payload,facility_id,'patient.archive');
  RETURN orion_private.scoped_patient_response(result,orion_private.require_assignment(assignment_id,facility_id,'patient.profile.write'));
END $$;

-- Existing table/schema/RLS policy is unchanged. Explicit grants cover only the
-- reviewed seven public RPCs; every new private helper remains inaccessible.
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.orion_patients_list(text,text,text,text,integer,jsonb),
  public.orion_patient_history_page(text,text,text,text,integer,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orion_patients_list(text,text,text,text,integer,jsonb),
  public.orion_patient_history_page(text,text,text,text,integer,jsonb) TO authenticated;
COMMIT;
