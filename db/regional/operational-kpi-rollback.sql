-- Transaction-only acceptance fixtures. No workflow, clinical publication,
-- patient data, grants or uploaded documents survive this ROLLBACK.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'WRONG_OPERATIONAL_KPI_TEST_DATABASE'; END IF;
  IF to_regprocedure('orion_region.operational_kpi_records(text[],timestamptz,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'OPERATIONAL_KPI_MIGRATION_REQUIRED';
  END IF;
END $$;
CREATE FUNCTION pg_temp.ops_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'OPERATIONAL_KPI_CHECK_FAILED: %',label; END IF; END $$;
INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES
 ('ops-rollback-admin','orion:ops-rollback','admin','Rollback administrator','active','postgres'),
 ('ops-rollback-doctor','orion:ops-rollback','doctor','Rollback doctor','active','postgres'),
 ('ops-rollback-none','orion:ops-rollback','none','Rollback unassigned','active','postgres');
INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES
 ('region-turkestan-hospital','ops-rollback-admin','ops-rollback-admin','active'),
 ('region-turkestan-hospital','ops-rollback-doctor','ops-rollback-doctor','active'),
 ('crm-clinic-local','ops-rollback-none','ops-rollback-none','active');
INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES
 ('region-turkestan-hospital','ops-rollback-admin','ops-rollback-admin',ARRAY['administrator'],'active',clock_timestamp()-interval '1 day'),
 ('region-turkestan-hospital','ops-rollback-doctor','ops-rollback-doctor',ARRAY['doctor'],'active',clock_timestamp()-interval '1 day'),
 ('crm-clinic-local','ops-rollback-none','ops-rollback-none',ARRAY['doctor'],'active',clock_timestamp()-interval '1 day');
INSERT INTO orion_region.network_grants(user_id,anchor_clinic_id,reason) VALUES
 ('ops-rollback-admin','region-turkestan-hospital','Rollback-only operational KPI checks');

INSERT INTO orion_region.prescriptions(clinic_id,id,patient_id,stock_id,dose,instructions,quantity,status,prescribed_by,prescribed_at,dispensed_at)
SELECT 'region-turkestan-hospital','ops-rx-'||n,'patient-1','stock-medication','ROLLBACK_PRIVATE_DOSE','ROLLBACK_PRIVATE_INSTRUCTIONS',1,
  'dispensed','ROLLBACK_PRIVATE_DOCTOR',prescribed::timestamptz,dispensed::timestamptz FROM (VALUES
 (1,'2025-01-01 00:00+05','2025-01-01 10:00+05'),(2,'2025-01-10 10:00+05','2025-02-01 00:00+05'),
 (3,'2025-01-31 23:30+05','2025-01-31 23:40+05'),(4,'2025-02-01 00:00+05','2025-02-01 10:00+05')) x(n,prescribed,dispensed);
INSERT INTO orion_region.procurements(clinic_id,id,stock_id,supplier,quantity,amount_kzt,status,ordered_at,due_at,received_at)
SELECT 'region-'||facility,'ops-proc-'||n,'stock-dressing','ROLLBACK_PRIVATE_SUPPLIER',1,1,
  CASE WHEN received IS NULL THEN 'ordered' ELSE 'received' END,'2024-12-25 09:00+05',due::timestamptz,received::timestamptz FROM (VALUES
 ('turkestan-hospital',1,'2025-01-10 10:00+05','2025-01-10 10:00+05'),
 ('turkestan-hospital',2,'2025-01-20 10:00+05','2025-01-21 10:00+05'),
 ('turkestan-hospital',3,'2025-01-30 10:00+05',NULL),
 ('turkestan-hospital',4,'2025-02-01 00:00+05','2025-01-31 10:00+05'),
 ('kentau-hospital',1,'2025-01-10 10:00+05','2025-01-09 10:00+05'),
 ('kentau-hospital',2,'2025-01-20 10:00+05','2025-01-19 10:00+05')) x(facility,n,due,received);
INSERT INTO orion_region.work_tasks(clinic_id,id,owner_id,title,category,priority,status,due_at,completed_at,created_at)
SELECT 'region-turkestan-hospital','ops-task-'||n,'doctor','ROLLBACK_PRIVATE_TASK','care','routine',
  CASE WHEN completed IS NULL THEN 'pending' ELSE 'completed' END,due::timestamptz,completed::timestamptz,'2024-12-25 09:00+05' FROM (VALUES
 (1,'2025-01-10 10:00+05','2025-01-10 10:00+05'),(2,'2025-01-20 10:00+05','2025-01-21 10:00+05'),
 (3,'2025-01-30 10:00+05',NULL),(4,'2025-02-01 00:00+05','2025-01-31 10:00+05')) x(n,due,completed);
INSERT INTO orion_region.work_tasks(clinic_id,id,owner_id,title,category,priority,status,due_at,created_at)
SELECT 'region-turkestan-hospital','ops-page-'||n,'doctor','ROLLBACK_PRIVATE_TASK','care','routine','pending',
  '2025-01-15 10:00+05','2024-12-25 09:00+05' FROM generate_series(1,25) n;
INSERT INTO orion_region.visits(clinic_id,id,patient_id,staff_id,room_id,service_id,scheduled_at,status,updated_at,duration_minutes)
SELECT 'region-turkestan-hospital','ops-visit-'||n,'patient-1','doctor','consultation','consultation',scheduled::timestamptz,status,updated::timestamptz,30 FROM (VALUES
 (1,'2025-01-05 10:00+05','completed','2025-01-05 10:30+05'),(2,'2025-01-20 10:00+05','completed','2025-02-01 00:00+05'),
 (3,'2025-01-27 10:00+05','cancelled','2025-01-26 10:00+05'),(4,'2025-02-01 00:00+05','completed','2025-02-01 00:30+05')) x(n,scheduled,status,updated);
DO $$ DECLARE practitioner text; n integer; BEGIN
  SELECT id INTO practitioner FROM orion_clinical.practitioners WHERE clinic_id='region-turkestan-hospital' AND staff_id='doctor';
  IF practitioner IS NULL THEN
    practitioner:='ops-rollback-practitioner';
    INSERT INTO orion_clinical.practitioners(clinic_id,id,staff_id,issuer,subject,display_name,specialty,verified_at,verification_reference)
      VALUES('region-turkestan-hospital',practitioner,'doctor','orion:ops-rollback','clinical-fixture','Rollback-only fixture','Rollback',clock_timestamp(),'ROLLBACK_ONLY');
  END IF;
  FOR n IN 1..3 LOOP
    INSERT INTO orion_clinical.encounters(clinic_id,id,patient_id,practitioner_id,status,created_at,updated_at)
      VALUES('region-turkestan-hospital','ops-encounter-'||n,'patient-1',practitioner,'completed','2025-01-02 09:00+05','2025-01-02 10:00+05');
    INSERT INTO orion_clinical.note_versions(clinic_id,id,encounter_id,patient_id,practitioner_id,version,content,source,status,created_at)
      VALUES('region-turkestan-hospital','ops-note-draft-'||n,'ops-encounter-'||n,'patient-1',practitioner,1,'{"secret":"ROLLBACK_PRIVATE_NOTE"}','clinician','draft','2025-01-02 10:00+05');
    IF n<>2 THEN
      INSERT INTO orion_clinical.note_versions(clinic_id,id,encounter_id,patient_id,practitioner_id,version,content,source,status,reviewed_draft_id,created_at,published_at)
        VALUES('region-turkestan-hospital','ops-note-published-'||n,'ops-encounter-'||n,'patient-1',practitioner,2,'{"secret":"ROLLBACK_PRIVATE_NOTE"}',
          'clinician','published','ops-note-draft-'||n,CASE WHEN n=1 THEN '2025-01-02 10:15+05'::timestamptz ELSE '2025-02-01 00:00+05'::timestamptz END,
          CASE WHEN n=1 THEN '2025-01-02 10:15+05'::timestamptz ELSE '2025-02-01 00:00+05'::timestamptz END);
    END IF;
  END LOOP;
  INSERT INTO orion_clinical.note_versions(clinic_id,id,encounter_id,patient_id,practitioner_id,version,content,source,status,reviewed_draft_id,created_at,published_at)
    VALUES('region-turkestan-hospital','ops-note-second-publication','ops-encounter-1','patient-1',practitioner,3,'{}','clinician','published',
      'ops-note-draft-1','2025-01-03 10:00+05','2025-01-03 10:00+05');
END $$;

DO $$ DECLARE snapshot jsonb; obs jsonb; q jsonb:='{"start":"2025-01-01","end":"2025-01-31","facilityId":"turkestan-hospital"}'; f record; evidence jsonb; later jsonb;
BEGIN
  snapshot:=public.orion_regional_kpi_v1('orion:ops-rollback','doctor',q);
  PERFORM pg_temp.ops_assert(jsonb_array_length(snapshot->'definitions')=9 AND jsonb_array_length(snapshot->'facilities')=1 AND jsonb_array_length(snapshot->'observations')=8,'nine definitions, authorized hospital pairs only');
  PERFORM pg_temp.ops_assert((SELECT count(*) FROM jsonb_array_elements(snapshot->'definitions') d WHERE d->>'sourceType'='internal' AND d->'target'='null'::jsonb)=5,'five internal metrics without invented government targets');
  FOR f IN SELECT * FROM (VALUES ('pharmacy-fulfillment',2,3),('procurement-on-time',1,3),('tasks-on-time',1,28),('visits-completion',1,3),('encounter-documentation',1,3)) x(indicator,numerator,denominator) LOOP
    SELECT x INTO obs FROM jsonb_array_elements(snapshot->'observations') x WHERE x->>'indicatorId'=f.indicator;
    PERFORM pg_temp.ops_assert((obs->>'numerator')::integer=f.numerator AND (obs->>'denominator')::integer=f.denominator AND
      (obs->>'sourceCount')::integer=f.denominator AND obs->'lastObservedAt'<>'null'::jsonb,'cohort and as-of formula: '||f.indicator);
    evidence:=public.orion_regional_kpi_evidence_v1('orion:ops-rollback','doctor',q||jsonb_build_object('indicatorId',f.indicator));
    PERFORM pg_temp.ops_assert((evidence->>'total')::int=f.denominator AND jsonb_array_length(evidence->'items')=least(20,f.denominator),'evidence reconciles denominator: '||f.indicator);
    PERFORM pg_temp.ops_assert(evidence::text !~ 'ROLLBACK_PRIVATE|patient-1|patientId|practitioner|prescribed_by|content|supplier','no PHI in evidence');
    PERFORM pg_temp.ops_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence->'items') i WHERE i->>'id'!~'^[a-z_]+:[a-f0-9]{32}$' OR (i->>'value')::numeric NOT IN (0,1)),'opaque evidence IDs and numeric facts only');
  END LOOP;
  evidence:=public.orion_regional_kpi_evidence_v1('orion:ops-rollback','doctor',q||'{"indicatorId":"tasks-on-time"}');
  later:=public.orion_regional_kpi_evidence_v1('orion:ops-rollback','doctor',q||'{"indicatorId":"tasks-on-time","offset":20}');
  PERFORM pg_temp.ops_assert(evidence->>'nextOffset'='20' AND jsonb_array_length(later->'items')=8 AND later->'nextOffset'='null'::jsonb,'bounded stable task pages');
  PERFORM pg_temp.ops_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(evidence->'items') a JOIN jsonb_array_elements(later->'items') b ON a->>'id'=b->>'id'),'evidence pages do not duplicate');
  PERFORM pg_temp.ops_assert((SELECT sum((i->>'value')::numeric) FROM jsonb_array_elements((evidence->'items')||(later->'items')) i)=1,'full evidence page sum reconciles numerator');
  snapshot:=public.orion_regional_kpi_v1('orion:ops-rollback','admin',q-'facilityId');
  PERFORM pg_temp.ops_assert((SELECT sum((o->>'numerator')::numeric) FROM jsonb_array_elements(snapshot->'observations') o WHERE o->>'indicatorId'='procurement-on-time')=3 AND
    (SELECT sum((o->>'denominator')::numeric) FROM jsonb_array_elements(snapshot->'observations') o WHERE o->>'indicatorId'='procurement-on-time')=5,'weighted network source sums, not averaging institutions');
  snapshot:=public.orion_regional_kpi_v1('orion:ops-rollback','doctor',q||'{"start":"2024-01-01","end":"2024-01-31"}');
  PERFORM pg_temp.ops_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'observations') o WHERE (o->>'sourceCount')::integer<>0 OR o->'lastObservedAt'<>'null'::jsonb),'empty period remains missing');
  snapshot:=public.orion_regional_kpi_v1('orion:ops-rollback','doctor',q||jsonb_build_object('start',((clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date+1)::text,'end',((clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date+30)::text));
  PERFORM pg_temp.ops_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'observations') o WHERE o->>'indicatorId' IN
    ('pharmacy-fulfillment','procurement-on-time','tasks-on-time','visits-completion','encounter-documentation') AND (o->>'denominator')::int<>0),'future periods never manufacture due or complete work');
  BEGIN PERFORM public.orion_regional_kpi_evidence_v1('orion:ops-rollback','doctor',q||'{"facilityId":"kentau-hospital","indicatorId":"procurement-on-time"}');
    RAISE EXCEPTION 'CROSS_FACILITY_EVIDENCE'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_kpi_v1('orion:ops-rollback','none',q); RAISE EXCEPTION 'UNASSIGNED_AGGREGATE'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_kpi_evidence_v1('orion:ops-rollback','doctor',q||'{"indicatorId":"tasks-on-time","offset":10001}');
    RAISE EXCEPTION 'UNBOUNDED_EVIDENCE'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
END $$;
DO $$ DECLARE q jsonb:='{"start":"2026-09-01","end":"2026-09-30","facilityId":"turkestan-hospital"}'; current_value jsonb; core jsonb; evidence jsonb; BEGIN
  current_value:=public.orion_regional_kpi_v1('orion:ops-rollback','doctor',q);
  core:=orion_region.regional_kpi_core_v1('orion:ops-rollback','doctor',q);
  PERFORM pg_temp.ops_assert((SELECT jsonb_agg(o ORDER BY o->>'indicatorId') FROM jsonb_array_elements(current_value->'observations') o WHERE o->>'indicatorId' IN ('complaints-hospital','doctor-staffing','lab-turnaround'))=
    (SELECT jsonb_agg(o ORDER BY o->>'indicatorId') FROM jsonb_array_elements(core->'observations') o),'legacy observations unchanged');
  evidence:=public.orion_regional_kpi_evidence_v1('orion:ops-rollback','doctor',q||'{"indicatorId":"lab-turnaround"}');
  PERFORM pg_temp.ops_assert((evidence->>'total')::integer=3,'legacy evidence path remains callable without recursion');
  PERFORM pg_temp.ops_assert(NOT has_function_privilege('orion_crm_app','orion_region.regional_kpi_core_v1(text,text,jsonb)','EXECUTE') AND
    NOT has_function_privilege('public','orion_region.regional_kpi_core_v1(text,text,jsonb)','EXECUTE'),'private aggregate core closed');
  PERFORM pg_temp.ops_assert(NOT has_function_privilege('orion_crm_app','orion_region.regional_kpi_evidence_core_v1(text,text,jsonb)','EXECUTE') AND
    NOT has_function_privilege('public','orion_region.regional_kpi_evidence_core_v1(text,text,jsonb)','EXECUTE'),'private evidence core closed');
  PERFORM pg_temp.ops_assert(NOT has_function_privilege('orion_crm_app','orion_region.operational_kpi_records(text[],timestamptz,timestamptz,text)','EXECUTE'),'raw cohort seam closed');
  UPDATE orion_directory.memberships SET interactive=false WHERE user_id='ops-rollback-doctor';
  BEGIN PERFORM public.orion_regional_kpi_v1('orion:ops-rollback','doctor',q); RAISE EXCEPTION 'REVOKED_READ'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
END $$;
-- Forward-fixed file validation: Cyrillic case-insensitive duplicates fail closed.
DO $$ BEGIN
  BEGIN PERFORM orion_region.validate_directive_files('[{"fileName":"Отчёт.txt","mimeType":"text/plain","purpose":"report","contentBase64":"aGVsbG8="},{"fileName":"ОТЧЁТ.TXT","mimeType":"text/plain","purpose":"supporting","contentBase64":"aGVsbG8="}]','report');
    RAISE EXCEPTION 'CYRILLIC_DUPLICATE_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
END $$;
SET LOCAL ROLE orion_crm_app;
SELECT public.orion_regional_kpi_v1('orion:ops-rollback','admin','{"start":"2025-01-01","end":"2025-01-31"}') IS NOT NULL AS operational_kpi_runtime_rpc_ok;
RESET ROLE;
ROLLBACK;
