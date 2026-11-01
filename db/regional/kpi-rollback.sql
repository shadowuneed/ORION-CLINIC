-- Execute only using the exact owned local cluster runner, AFTER 0003 is applied.
-- All fixtures, audit writes and temporary checks roll back. No account credentials
-- are read, printed, replaced or persisted. Failure must roll back the connection.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'WRONG_KPI_TEST_DATABASE'; END IF;
  IF to_regprocedure('public.orion_regional_kpi_v1(text,text,jsonb)') IS NULL THEN RAISE EXCEPTION 'KPI_MIGRATION_REQUIRED'; END IF;
END $$;
CREATE FUNCTION pg_temp.kpi_assert(ok boolean, label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'KPI_CHECK_FAILED: %',label; END IF; END $$;

-- Dedicated transaction-local principals, never the user's real login records.
INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES
 ('kpi-rollback-admin','orion:kpi-rollback','admin','KPI rollback administrator','active','postgres'),
 ('kpi-rollback-doctor','orion:kpi-rollback','doctor','KPI rollback physician','active','postgres'),
 ('kpi-rollback-none','orion:kpi-rollback','none','KPI rollback unassigned','active','postgres');
INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES
 ('region-turkestan-hospital','kpi-rollback-admin','kpi-rollback-admin','active'),
 ('region-turkestan-hospital','kpi-rollback-doctor','kpi-rollback-doctor','active'),
 ('crm-clinic-local','kpi-rollback-none','kpi-rollback-none','active');
INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES
 ('region-turkestan-hospital','kpi-rollback-admin','kpi-rollback-admin',ARRAY['administrator'],'active',clock_timestamp()-interval '1 day'),
 ('region-turkestan-hospital','kpi-rollback-doctor','kpi-rollback-doctor',ARRAY['doctor'],'active',clock_timestamp()-interval '1 day'),
 ('crm-clinic-local','kpi-rollback-none','kpi-rollback-none',ARRAY['doctor'],'active',clock_timestamp()-interval '1 day');
INSERT INTO orion_region.network_grants(user_id,anchor_clinic_id,reason) VALUES
 ('kpi-rollback-admin','region-turkestan-hospital','Transaction-only KPI acceptance');

DO $$ DECLARE v jsonb; q jsonb:='{"start":"2026-09-01","end":"2026-09-30"}'; expected numeric; t text;
BEGIN
  v:=public.orion_regional_kpi_v1('orion:kpi-rollback','admin',q);
  PERFORM pg_temp.kpi_assert(v->>'dataMode'='training' AND
    (SELECT count(*) FROM jsonb_array_elements(v->'definitions') d WHERE d->>'id' IN ('complaints-hospital','complaints-polyclinic','doctor-staffing','lab-turnaround'))=4,'four sourced training definitions');
  PERFORM pg_temp.kpi_assert(jsonb_array_length(v->'facilities')=36 AND
    (SELECT count(*) FROM jsonb_array_elements(v->'observations') o WHERE o->>'indicatorId' IN ('complaints-hospital','complaints-polyclinic','doctor-staffing','lab-turnaround'))=90,'36 facilities and only applicable sourced pairs');
  PERFORM pg_temp.kpi_assert((SELECT count(*) FROM jsonb_array_elements(v->'facilities') f WHERE f->>'regionId'='shymkent')=2,'Shymkent is not Turkestan');
  PERFORM pg_temp.kpi_assert(v::text !~ 'subject_ref|TRAIN-KPI-DOCTOR|patientId|birthDate|allergies|password|issuer','aggregate contains no private evidence or identities');
  PERFORM pg_temp.kpi_assert((SELECT count(DISTINCT facility_id) FROM orion_region.kpi_care_episodes)=36,'all facilities have persisted case sources');
  PERFORM pg_temp.kpi_assert((SELECT count(*) FROM orion_region.kpi_lab_samples)=324,'three specimens per facility per month');
  PERFORM pg_temp.kpi_assert((SELECT count(*) FROM orion_region.kpi_staffing_snapshots)=54,'three dated snapshots per hospital');
  PERFORM pg_temp.kpi_assert((SELECT count(DISTINCT date_trunc('month',completed_at AT TIME ZONE 'Asia/Qyzylorda')) FROM orion_region.kpi_care_episodes)=3,'three fixed closed months');
  PERFORM pg_temp.kpi_assert(NOT EXISTS(SELECT 1 FROM orion_region.kpi_lab_samples WHERE result_sent_at<received_at),'valid specimen chronology');
  SELECT count(*) INTO expected FROM orion_region.kpi_care_episodes e JOIN orion_region.facilities f ON f.id=e.facility_id
    WHERE f.kind='hospital' AND e.completed_at>='2026-09-01 00:00+05' AND e.completed_at<'2026-10-01 00:00+05';
  PERFORM pg_temp.kpi_assert((SELECT sum((x->>'denominator')::numeric) FROM jsonb_array_elements(v->'observations') x WHERE x->>'indicatorId'='complaints-hospital')=expected,'hospital weighted denominator comes from completed cases');
  SELECT sum(extract(epoch FROM result_sent_at-received_at)/60) INTO expected FROM orion_region.kpi_lab_samples
    WHERE result_sent_at>='2026-09-01 00:00+05' AND result_sent_at<'2026-10-01 00:00+05';
  PERFORM pg_temp.kpi_assert((SELECT sum((x->>'numerator')::numeric) FROM jsonb_array_elements(v->'observations') x WHERE x->>'indicatorId'='lab-turnaround')=expected,'laboratory sum uses both true timestamps');
  PERFORM pg_temp.kpi_assert((SELECT sum((x->>'denominator')::numeric) FROM jsonb_array_elements(v->'observations') x WHERE x->>'indicatorId'='lab-turnaround')=108,'network lab denominator sums specimens, not facility averages');
  PERFORM pg_temp.kpi_assert((SELECT count(*) FROM orion_region.kpi_source_audit)=
    (SELECT count(*) FROM orion_region.kpi_definitions)+(SELECT count(*) FROM orion_region.kpi_evidence_batches)+
    (SELECT count(*) FROM orion_region.kpi_care_episodes)+(SELECT count(*) FROM orion_region.kpi_complaint_decisions)+
    (SELECT count(*) FROM orion_region.kpi_staffing_snapshots)+(SELECT count(*) FROM orion_region.kpi_doctor_positions)+
    (SELECT count(*) FROM orion_region.kpi_main_doctors)+(SELECT count(*) FROM orion_region.kpi_lab_samples),'every persisted evidence row audited');
  FOREACH t IN ARRAY ARRAY['kpi_definitions','kpi_evidence_batches','kpi_care_episodes','kpi_complaint_decisions',
    'kpi_staffing_snapshots','kpi_doctor_positions','kpi_main_doctors','kpi_lab_samples','kpi_source_audit'] LOOP
    PERFORM pg_temp.kpi_assert(NOT has_table_privilege('orion_crm_app','orion_region.'||t,'SELECT,INSERT,UPDATE,DELETE'),'private table closed: '||t);
    PERFORM pg_temp.kpi_assert((SELECT relrowsecurity FROM pg_class WHERE oid=('orion_region.'||t)::regclass),'RLS enabled: '||t);
  END LOOP;
  PERFORM pg_temp.kpi_assert(NOT has_function_privilege('public','public.orion_regional_kpi_v1(text,text,jsonb)','EXECUTE'),'public cannot execute KPI');
  PERFORM pg_temp.kpi_assert(NOT has_function_privilege('public','public.orion_regional_kpi_evidence_v1(text,text,jsonb)','EXECUTE'),'public cannot execute evidence');
  PERFORM pg_temp.kpi_assert(has_function_privilege('orion_crm_app','public.orion_regional_kpi_v1(text,text,jsonb)','EXECUTE'),'runtime can execute authenticated RPC');
END $$;

DO $$ DECLARE v jsonb; obs jsonb; q jsonb:='{"start":"2026-08-01","end":"2026-08-31","facilityId":"sozak-hospital"}';
BEGIN
  v:=public.orion_regional_kpi_v1('orion:kpi-rollback','admin',q);
  SELECT x INTO obs FROM jsonb_array_elements(v->'observations') x WHERE x->>'indicatorId'='complaints-hospital';
  PERFORM pg_temp.kpi_assert((obs->>'numerator')::numeric=1 AND (obs->>'denominator')::numeric=9 AND (obs->>'sourceCount')::int=10,'August source decision and completed-case cohort');
  SELECT x INTO obs FROM jsonb_array_elements(v->'observations') x WHERE x->>'indicatorId'='doctor-staffing';
  PERFORM pg_temp.kpi_assert((obs->>'numerator')::numeric=5 AND (obs->>'denominator')::numeric=8 AND (obs->>'lastObservedAt')::timestamptz='2026-08-31 17:00+05','August selects August HR snapshot');
  v:=public.orion_regional_kpi_v1('orion:kpi-rollback','admin',q||'{"start":"2026-07-01","end":"2026-09-30"}');
  SELECT x INTO obs FROM jsonb_array_elements(v->'observations') x WHERE x->>'indicatorId'='doctor-staffing';
  PERFORM pg_temp.kpi_assert((obs->>'numerator')::numeric=6 AND (obs->>'denominator')::numeric=8,'three-month request selects latest HR, never sum snapshots');
  v:=public.orion_regional_kpi_v1('orion:kpi-rollback','admin',q||'{"start":"2026-01-01","end":"2026-01-31"}');
  PERFORM pg_temp.kpi_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'observations') x WHERE (x->>'sourceCount')::int<>0 OR x->'lastObservedAt'<>'null'::jsonb),'empty historical period is missing, not fabricated zero score');
  v:=public.orion_regional_kpi_v1('orion:kpi-rollback','admin',q||'{"start":"2026-08-23","end":"2026-08-23"}');
  SELECT x INTO obs FROM jsonb_array_elements(v->'observations') x WHERE x->>'indicatorId'='complaints-hospital';
  PERFORM pg_temp.kpi_assert((obs->>'numerator')::numeric=1 AND (obs->>'denominator')::numeric=0 AND (obs->>'sourceCount')::int=1,'independent complaints survive zero-denominator day');
END $$;

DO $$ DECLARE v jsonb; first_page jsonb; second_page jsonb; q jsonb:='{"start":"2026-09-01","end":"2026-09-30","facilityId":"turkestan-hospital","indicatorId":"complaints-hospital"}';
BEGIN
  first_page:=public.orion_regional_kpi_evidence_v1('orion:kpi-rollback','doctor',q);
  second_page:=public.orion_regional_kpi_evidence_v1('orion:kpi-rollback','doctor',q||'{"offset":20}');
  PERFORM pg_temp.kpi_assert((first_page->>'total')::int=28 AND jsonb_array_length(first_page->'items')=20 AND first_page->>'nextOffset'='20','bounded case evidence first page');
  PERFORM pg_temp.kpi_assert(jsonb_array_length(second_page->'items')=8 AND second_page->'nextOffset'='null'::jsonb,'bounded case evidence last page');
  PERFORM pg_temp.kpi_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(first_page->'items') a JOIN jsonb_array_elements(second_page->'items') b ON a->>'id'=b->>'id'),'stable pages do not duplicate');
  PERFORM pg_temp.kpi_assert(first_page::text !~ 'subject_ref|patientId|birthDate|allergies|issuer|TRAIN-KPI-turkestan','evidence contains no patient references');
  v:=public.orion_regional_kpi_evidence_v1('orion:kpi-rollback','doctor',q||'{"indicatorId":"lab-turnaround"}');
  PERFORM pg_temp.kpi_assert((v->>'total')::int=3 AND (SELECT sum((x->>'value')::numeric) FROM jsonb_array_elements(v->'items') x)=186,'per-sample evidence reconciles laboratory numerator');
  v:=public.orion_regional_kpi_evidence_v1('orion:kpi-rollback','doctor',q||'{"indicatorId":"doctor-staffing"}');
  PERFORM pg_temp.kpi_assert((v->>'total')::int=39,'staffing evidence includes 20 positions plus 19 distinct persons');
END $$;

DO $$ DECLARE q jsonb:='{"start":"2026-09-01","end":"2026-09-30"}'; v jsonb; malformed jsonb;
BEGIN
  v:=public.orion_regional_kpi_v1('orion:kpi-rollback','doctor',q);
  PERFORM pg_temp.kpi_assert(jsonb_array_length(v->'facilities')=1 AND v->'facilities'->0->>'id'='turkestan-hospital','doctor sees only exact assignment');
  v:=public.orion_regional_kpi_v1('orion:kpi-rollback','none',q);
  PERFORM pg_temp.kpi_assert(v->'facilities'='[]'::jsonb AND v->'observations'='[]'::jsonb,'unassigned user does not inherit regional grants');
  BEGIN PERFORM public.orion_regional_kpi_v1('orion:kpi-rollback','missing',q); RAISE EXCEPTION 'AUTH_NOT_DENIED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_kpi_v1('orion:kpi-rollback','doctor',q||'{"facilityId":"sayram-hospital"}'); RAISE EXCEPTION 'CROSS_FACILITY_NOT_DENIED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_kpi_v1('orion:kpi-rollback','doctor',q||'{"facilityId":"unknown"}'); RAISE EXCEPTION 'UNKNOWN_NOT_HIDDEN'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_kpi_v1('orion:kpi-rollback','admin',q||'{"facilityId":"unknown"}'); RAISE EXCEPTION 'UNKNOWN_NOT_REJECTED'; EXCEPTION WHEN SQLSTATE 'PT404' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_kpi_evidence_v1('orion:kpi-rollback','doctor',q||'{"facilityId":"sayram-hospital","indicatorId":"lab-turnaround"}'); RAISE EXCEPTION 'CROSS_EVIDENCE_NOT_DENIED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_kpi_evidence_v1('orion:kpi-rollback','admin',q||'{"facilityId":"sayram-polyclinic","indicatorId":"doctor-staffing"}'); RAISE EXCEPTION 'INAPPLICABLE_NOT_REJECTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_kpi_evidence_v1('orion:kpi-rollback','admin',q||'{"facilityId":"sayram-polyclinic","indicatorId":"lab-turnaround","offset":10001}'); RAISE EXCEPTION 'UNBOUNDED_PAGE'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
  FOR malformed IN SELECT * FROM (VALUES
    ('null'::jsonb),('[]'::jsonb),('{}'::jsonb),
    ('{"start":"2026-02-30","end":"2026-03-31"}'::jsonb),
    ('{"start":"2026-09-30","end":"2026-09-01"}'::jsonb),
    ('{"start":"2025-09-01","end":"2026-09-30"}'::jsonb),
    ('{"start":"2026-09-01","end":"2026-09-30","userId":"kpi-rollback-admin"}'::jsonb),
    ('{"start":"2026-09-01","end":"2026-09-30","facilityId":null}'::jsonb)
  ) x(body) LOOP
    BEGIN PERFORM public.orion_regional_kpi_v1('orion:kpi-rollback','admin',malformed); RAISE EXCEPTION 'INVALID_QUERY_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
  END LOOP;
  UPDATE orion_directory.assignments SET deny_permissions=ARRAY['clinic.dashboard.read'] WHERE id='kpi-rollback-doctor';
  BEGIN PERFORM public.orion_regional_kpi_v1('orion:kpi-rollback','doctor',q||'{"facilityId":"turkestan-hospital"}'); RAISE EXCEPTION 'PERMISSION_REVOKE_IGNORED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  UPDATE orion_region.network_grants SET active=false WHERE user_id='kpi-rollback-admin';
  v:=public.orion_regional_kpi_v1('orion:kpi-rollback','admin',q);
  PERFORM pg_temp.kpi_assert(jsonb_array_length(v->'facilities')=1,'revoked network grant retains only own explicit administrator facility');
END $$;

DO $$ BEGIN
  BEGIN UPDATE orion_region.kpi_care_episodes SET completed_at=completed_at+interval '1 hour' WHERE facility_id='turkestan-hospital'; RAISE EXCEPTION 'EVIDENCE_MUTABLE';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN DELETE FROM orion_region.kpi_source_audit; RAISE EXCEPTION 'AUDIT_MUTABLE';
  EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN INSERT INTO orion_region.kpi_complaint_decisions VALUES('turkestan-hospital','bad-cross-facility','nonexistent-episode',
    'dispatch-kpi-training-2026-q3','2026-09-01','2026-09-02',true,'TRAIN-BAD'); RAISE EXCEPTION 'SOURCE_FK_NOT_CHECKED';
  EXCEPTION WHEN foreign_key_violation THEN NULL; END;
  BEGIN INSERT INTO orion_region.kpi_lab_samples VALUES('turkestan-hospital','bad-clock','dispatch-kpi-training-2026-q3','CBC',
    '2026-09-02','2026-09-01','TRAIN-BAD'); RAISE EXCEPTION 'SOURCE_TIME_NOT_CHECKED';
  EXCEPTION WHEN check_violation THEN NULL; END;
END $$;
-- This verifies actual execution under the runtime role without granting table access.
SET LOCAL ROLE orion_crm_app;
SELECT public.orion_regional_kpi_v1('orion:kpi-rollback','none','{"start":"2026-09-01","end":"2026-09-30"}') IS NOT NULL AS runtime_rpc_ok;
RESET ROLE;
ROLLBACK;
