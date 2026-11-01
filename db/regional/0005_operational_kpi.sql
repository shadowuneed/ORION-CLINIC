-- Additive operational indicators over existing records only. No clinical data,
-- approvals, identities, role grants or source history are inserted or modified.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'REGIONAL_TARGET_DATABASE_REQUIRED'; END IF;
  IF to_regprocedure('public.orion_regional_kpi_v1(text,text,jsonb)') IS NULL OR
    to_regprocedure('orion_region.validate_directive_files(jsonb,text)') IS NULL THEN RAISE EXCEPTION 'OPERATIONAL_KPI_DEPENDENCY_REQUIRED'; END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_collation c JOIN pg_namespace n ON n.oid=c.collnamespace
    WHERE n.nspname='pg_catalog' AND c.collname='und-x-icu' AND c.collprovider='i') THEN
    RAISE EXCEPTION 'DIRECTIVE_UNICODE_COLLATION_REQUIRED';
  END IF;
END $$;

INSERT INTO orion_region.kpi_definitions(id,title,category,source_type,source_title,source_url,source_version,
  applicable_kinds,basis,direction,target,unit,numerator_label,denominator_label,period_kind,target_period,note) VALUES
('pharmacy-fulfillment','Выдача по рецептам','operations','internal','Внутренняя метрика ORION: журнал рецептов',NULL,'orion-operations-v1',
 ARRAY['hospital','polyclinic'],'percent','higher',NULL,'%','Выданные рецепты','Рецепты, выписанные за период','interval','any',
 'Доля рецептов регионального журнала, выданных к концу выбранного периода. Будущие назначения исключены; частичная выдача не поддерживается источником. Не норматив Минздрава.'),
('procurement-on-time','Поставки в срок','operations','internal','Внутренняя метрика ORION: журнал закупок',NULL,'orion-operations-v1',
 ARRAY['hospital','polyclinic'],'percent','higher',NULL,'%','Поставки, полученные к сроку','Поставки с наступившим сроком в периоде','interval','any',
 'Когорта по сроку поставки; срок уже наступил на конец периода или на текущий момент. Будущие сроки не ухудшают показатель. Не норматив Минздрава.'),
('tasks-on-time','Задачи в срок','operations','internal','Внутренняя метрика ORION: рабочие задачи учреждений',NULL,'orion-operations-v1',
 ARRAY['hospital','polyclinic'],'percent','higher',NULL,'%','Задачи, завершённые к сроку','Задачи с наступившим сроком в периоде','interval','any',
 'Операционные задачи регионального журнала, не административные поручения. Завершение после срока не считается своевременным. Не норматив Минздрава.'),
('visits-completion','Завершённые визиты','operations','internal','Внутренняя метрика ORION: региональный журнал визитов',NULL,'orion-operations-v1',
 ARRAY['hospital','polyclinic'],'percent','higher',NULL,'%','Завершённые визиты','Записанные визиты с наступившей датой','interval','any',
 'Когорта по запланированной дате; отмены и неявки остаются в знаменателе. Завершение учитывается по времени обновления источника, не является оценкой качества лечения.'),
('encounter-documentation','Опубликованные протоколы','operations','internal','Внутренняя метрика ORION: очные приёмы и версии протоколов',NULL,'orion-operations-v1',
 ARRAY['hospital','polyclinic'],'percent','higher',NULL,'%','Приёмы с опубликованным протоколом','Приёмы, начатые за период','interval','any',
 'Один приём считается один раз при наличии опубликованной врачом версии к концу периода. Черновики и тексты ИИ не учитываются; содержание медкарты не раскрывается. Текущий период неполный.');

CREATE INDEX regional_rx_kpi_period ON orion_region.prescriptions(clinic_id,prescribed_at);
CREATE INDEX regional_procurement_kpi_period ON orion_region.procurements(clinic_id,due_at);
CREATE INDEX regional_work_task_kpi_period ON orion_region.work_tasks(clinic_id,due_at);
CREATE INDEX regional_visit_kpi_period ON orion_region.visits(clinic_id,scheduled_at);
CREATE INDEX clinical_encounter_kpi_period ON orion_clinical.encounters(clinic_id,created_at);
CREATE INDEX clinical_published_note_kpi ON orion_clinical.note_versions(clinic_id,encounter_id,published_at) WHERE status='published';

-- A single typed source seam is shared by aggregates and drill-down, so page
-- counts and the weighted numerator always reconcile. The caller supplies ONLY
-- the exact facility IDs returned by the existing authenticated KPI authorizer.
CREATE FUNCTION orion_region.operational_kpi_records(p_facilities text[],p_start timestamptz,p_cutoff timestamptz,p_indicator text DEFAULT NULL)
RETURNS TABLE(facility_id text,indicator_id text,id text,observed_at timestamptz,kind text,label text,value numeric,unit text)
LANGUAGE sql STABLE SET search_path='' AS $$
  WITH facilities AS (SELECT id,clinic_id FROM orion_region.facilities WHERE id=ANY(p_facilities) AND data_mode='training'),
  raw AS (
    SELECT f.id facility_id,'pharmacy-fulfillment'::text indicator_id,'prescription'::text kind,p.id source_id,p.clinic_id,
      p.prescribed_at observed_at,
      p.status='dispensed' AND p.dispensed_at>=p.prescribed_at AND p.dispensed_at<p_cutoff done
      FROM facilities f JOIN orion_region.prescriptions p ON p.clinic_id=f.clinic_id
      WHERE (p_indicator IS NULL OR p_indicator='pharmacy-fulfillment') AND p.prescribed_at>=p_start AND p.prescribed_at<p_cutoff
    UNION ALL SELECT f.id,'procurement-on-time','procurement',p.id,p.clinic_id,p.due_at,
      p.status='received' AND p.received_at>=p.ordered_at AND p.received_at<=p.due_at AND p.received_at<p_cutoff
      FROM facilities f JOIN orion_region.procurements p ON p.clinic_id=f.clinic_id
      WHERE (p_indicator IS NULL OR p_indicator='procurement-on-time') AND p.due_at>=p_start AND p.due_at<p_cutoff AND p.ordered_at<p_cutoff
    UNION ALL SELECT f.id,'tasks-on-time','work_task',t.id,t.clinic_id,t.due_at,
      t.status='completed' AND t.completed_at>=t.created_at AND t.completed_at<=t.due_at AND t.completed_at<p_cutoff
      FROM facilities f JOIN orion_region.work_tasks t ON t.clinic_id=f.clinic_id
      WHERE (p_indicator IS NULL OR p_indicator='tasks-on-time') AND t.due_at>=p_start AND t.due_at<p_cutoff AND t.created_at<p_cutoff
    UNION ALL SELECT f.id,'visits-completion','visit',v.id,v.clinic_id,v.scheduled_at,
      v.status='completed' AND v.updated_at>=v.scheduled_at AND v.updated_at<p_cutoff
      FROM facilities f JOIN orion_region.visits v ON v.clinic_id=f.clinic_id
      WHERE (p_indicator IS NULL OR p_indicator='visits-completion') AND v.scheduled_at>=p_start AND v.scheduled_at<p_cutoff
    UNION ALL SELECT f.id,'encounter-documentation','encounter',e.id,e.clinic_id,e.created_at,
      EXISTS(SELECT 1 FROM orion_clinical.note_versions n WHERE n.clinic_id=e.clinic_id AND n.encounter_id=e.id
        AND n.status='published' AND n.published_at>=e.created_at AND n.published_at<p_cutoff)
      FROM facilities f JOIN orion_clinical.encounters e ON e.clinic_id=f.clinic_id
      WHERE (p_indicator IS NULL OR p_indicator='encounter-documentation') AND e.created_at>=p_start AND e.created_at<p_cutoff
  ) SELECT facility_id,indicator_id,
      kind||':'||left(encode(sha256(convert_to(clinic_id||chr(31)||source_id,'UTF8')),'hex'),32),observed_at,kind,
      CASE kind WHEN 'prescription' THEN 'Рецепт' WHEN 'procurement' THEN 'Поставка' WHEN 'work_task' THEN 'Рабочая задача'
        WHEN 'visit' THEN 'Визит' ELSE 'Очный приём: протокол' END||CASE WHEN done THEN ' · учтено в выполнении' ELSE ' · не учтено в выполнении' END,
      CASE WHEN done THEN 1::numeric ELSE 0::numeric END,'выполнено'::text FROM raw
$$;

-- Preserve the applied implementation as a private core. No privilege remains
-- on the renamed functions; wrappers below are the only runtime entry points.
ALTER FUNCTION public.orion_regional_kpi_v1(text,text,jsonb) RENAME TO regional_kpi_core_v1;
ALTER FUNCTION public.regional_kpi_core_v1(text,text,jsonb) SET SCHEMA orion_region;
ALTER FUNCTION public.orion_regional_kpi_evidence_v1(text,text,jsonb) RENAME TO regional_kpi_evidence_core_v1;
ALTER FUNCTION public.regional_kpi_evidence_core_v1(text,text,jsonb) SET SCHEMA orion_region;
REVOKE ALL ON FUNCTION orion_region.regional_kpi_core_v1(text,text,jsonb),orion_region.regional_kpi_evidence_core_v1(text,text,jsonb),
  orion_region.operational_kpi_records(text[],timestamptz,timestamptz,text) FROM PUBLIC,orion_crm_app;

CREATE FUNCTION public.orion_regional_kpi_v1(p_issuer text,p_subject text,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE snapshot jsonb:=orion_region.regional_kpi_core_v1(p_issuer,p_subject,p_query); visible text[]; extra jsonb;
  start_at timestamptz; cutoff timestamptz;
BEGIN
  SELECT ARRAY(SELECT x->>'id' FROM jsonb_array_elements(snapshot->'facilities') x) INTO visible;
  start_at:=(p_query->>'start')::date::timestamp AT TIME ZONE 'Asia/Qyzylorda';
  cutoff:=least(((p_query->>'end')::date+1)::timestamp AT TIME ZONE 'Asia/Qyzylorda',clock_timestamp());
  WITH observations AS (SELECT facility_id,indicator_id,sum(value) numerator,count(*) denominator,max(observed_at) latest
    FROM orion_region.operational_kpi_records(visible,start_at,cutoff) GROUP BY facility_id,indicator_id),
  pairs AS (SELECT f.id facility_id,d.id indicator_id FROM orion_region.facilities f CROSS JOIN orion_region.kpi_definitions d
    WHERE f.id=ANY(visible) AND d.id IN ('pharmacy-fulfillment','procurement-on-time','tasks-on-time','visits-completion','encounter-documentation'))
  SELECT coalesce(jsonb_agg(jsonb_build_object('facilityId',p.facility_id,'indicatorId',p.indicator_id,
    'numerator',coalesce(o.numerator,0),'denominator',coalesce(o.denominator,0),'sourceCount',coalesce(o.denominator,0),
    'lastObservedAt',orion_crm.iso(o.latest)) ORDER BY p.facility_id,p.indicator_id),'[]') INTO extra
    FROM pairs p LEFT JOIN observations o ON o.facility_id=p.facility_id AND o.indicator_id=p.indicator_id;
  snapshot:=jsonb_set(snapshot,'{observations}',(snapshot->'observations')||extra);
  IF octet_length(snapshot::text)>524288 THEN RAISE EXCEPTION 'REGIONAL_LIMIT' USING ERRCODE='PT503'; END IF;
  RETURN snapshot;
END $$;
CREATE FUNCTION public.orion_regional_kpi_evidence_v1(p_issuer text,p_subject text,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text:=orion_region.require_user(p_issuer,p_subject); indicator text; facility text; snapshot jsonb;
  page_offset integer:=0; total_records integer; records jsonb; start_at timestamptz; cutoff timestamptz; result jsonb;
BEGIN
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR octet_length(p_query::text)>1536 THEN RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400'; END IF;
  indicator:=p_query->>'indicatorId';
  IF indicator IS NULL OR indicator NOT IN ('pharmacy-fulfillment','procurement-on-time','tasks-on-time','visits-completion','encounter-documentation') THEN
    RETURN orion_region.regional_kpi_evidence_core_v1(p_issuer,p_subject,p_query);
  END IF;
  IF NOT(p_query?'facilityId') OR jsonb_typeof(p_query->'indicatorId') IS DISTINCT FROM 'string' OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_query) k WHERE k NOT IN ('start','end','facilityId','indicatorId','offset')) OR
    (p_query?'offset' AND (jsonb_typeof(p_query->'offset') IS DISTINCT FROM 'number' OR (p_query->>'offset')!~'^(0|[1-9][0-9]{0,6})$')) THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  IF p_query?'offset' THEN page_offset:=(p_query->>'offset')::integer; END IF;
  IF page_offset>10000 THEN RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400'; END IF;
  snapshot:=public.orion_regional_kpi_v1(p_issuer,p_subject,p_query-ARRAY['indicatorId','offset']);
  facility:=p_query->>'facilityId';
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'observations') x WHERE x->>'facilityId'=facility AND x->>'indicatorId'=indicator) THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  start_at:=(p_query->>'start')::date::timestamp AT TIME ZONE 'Asia/Qyzylorda';
  cutoff:=least(((p_query->>'end')::date+1)::timestamp AT TIME ZONE 'Asia/Qyzylorda',clock_timestamp());
  WITH source AS (SELECT * FROM orion_region.operational_kpi_records(ARRAY[facility],start_at,cutoff,indicator)),
  page AS (SELECT * FROM source ORDER BY observed_at DESC,id COLLATE "C" OFFSET page_offset LIMIT 20)
  SELECT (SELECT count(*)::integer FROM source),coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,'observedAt',orion_crm.iso(observed_at),
    'kind',kind,'label',label,'value',value,'unit',unit) ORDER BY observed_at DESC,id COLLATE "C") FROM page),'[]') INTO total_records,records;
  result:=jsonb_build_object('schemaVersion',1,'facilityId',facility,'indicatorId',indicator,'period',snapshot->'period',
    'total',total_records,'offset',page_offset,'items',records,'nextOffset',CASE WHEN page_offset+20<total_records AND page_offset+20<=10000 THEN page_offset+20 ELSE NULL END);
  INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,after_state)
    VALUES(actor,facility,'regional.kpi.evidence.read',indicator,jsonb_build_object('start',p_query->>'start','end',p_query->>'end','offset',page_offset,'returned',jsonb_array_length(records)));
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION public.orion_regional_kpi_v1(text,text,jsonb),public.orion_regional_kpi_evidence_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_regional_kpi_v1(text,text,jsonb),public.orion_regional_kpi_evidence_v1(text,text,jsonb) TO orion_crm_app;

-- The file validator is forward-replaced below: explicit Unicode lower handles
-- Cyrillic duplicate filenames even when the cluster default collation is C.
CREATE OR REPLACE FUNCTION orion_region.validate_directive_files(p_files jsonb,p_required_purpose text) RETURNS void
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
    IF NOT orion_region.directive_filename_valid(name) OR lower(name COLLATE pg_catalog."und-x-icu")=ANY(names) OR
      f->>'purpose' NOT IN (p_required_purpose,'supporting') OR length(encoded) NOT BETWEEN 4 AND 2796204 OR
      encoded!~'^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$' THEN
      RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
    END IF;
    names:=array_append(names,lower(name COLLATE pg_catalog."und-x-icu"));
    raw:=decode(encoded,'base64');
    IF octet_length(raw) NOT BETWEEN 1 AND 2097152 OR replace(encode(raw,'base64'),E'\n','')<>encoded THEN
      RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
    END IF;
    total_bytes:=total_bytes+octet_length(raw);
    IF total_bytes>6291456 THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    IF mime='application/pdf' THEN
      IF lower(name COLLATE pg_catalog."und-x-icu")!~'[.]pdf$' OR substring(raw FROM 1 FOR 5)<>convert_to('%PDF-','UTF8') THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    ELSIF mime='image/png' THEN
      IF lower(name COLLATE pg_catalog."und-x-icu")!~'[.]png$' OR substring(raw FROM 1 FOR 8)<>decode('89504e470d0a1a0a','hex') THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    ELSIF mime='image/jpeg' THEN
      IF lower(name COLLATE pg_catalog."und-x-icu")!~'[.](jpg|jpeg)$' OR substring(raw FROM 1 FOR 3)<>decode('ffd8ff','hex') THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
    ELSIF mime='application/vnd.openxmlformats-officedocument.wordprocessingml.document' THEN
      IF lower(name COLLATE pg_catalog."und-x-icu")!~'[.]docx$' OR substring(raw FROM 1 FOR 4)<>decode('504b0304','hex') OR
        position(convert_to('[Content_Types].xml','UTF8') IN raw)=0 OR position(convert_to('word/document.xml','UTF8') IN raw)=0 THEN
        RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
      END IF;
    ELSIF mime='text/plain' THEN
      IF lower(name COLLATE pg_catalog."und-x-icu")!~'[.]txt$' THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END IF;
      BEGIN text_content:=convert_from(raw,'UTF8');
      EXCEPTION WHEN character_not_in_repertoire OR untranslatable_character THEN RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400'; END;
      IF text_content~('['||chr(1)||'-'||chr(8)||chr(11)||chr(12)||chr(14)||'-'||chr(31)||']') THEN
        RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
      END IF;
    ELSE RAISE EXCEPTION 'DIRECTIVE_FILE_INVALID' USING ERRCODE='PT400';
    END IF;
  END LOOP;
END $$;
REVOKE ALL ON FUNCTION orion_region.validate_directive_files(jsonb,text) FROM PUBLIC,orion_crm_app;
COMMIT;
