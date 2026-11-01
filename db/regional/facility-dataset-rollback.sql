-- Public snapshot acceptance of the fictional 2026-10-09 facility dataset.
-- Principals and audit calls below are transaction-local and always roll back.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'WRONG_FACILITY_DATASET_DATABASE'; END IF;
END $$;
CREATE FUNCTION pg_temp.facility_dataset_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'FACILITY_DATASET_CHECK_FAILED: %',label; END IF; END $$;
INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES
 ('facility-dataset-rollback-admin','orion:facility-dataset-rollback','admin','Dataset rollback administrator','active','postgres'),
 ('facility-dataset-rollback-doctor','orion:facility-dataset-rollback','doctor','Dataset rollback doctor','active','postgres'),
 ('facility-dataset-rollback-directive','orion:facility-dataset-rollback','directive','Dataset rollback nonclinical administrator','active','postgres');
INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES
 ('region-sozak-hospital','facility-dataset-rollback-admin','facility-dataset-rollback-admin','active'),
 ('region-sozak-hospital','facility-dataset-rollback-doctor','facility-dataset-rollback-doctor','active'),
 ('region-sozak-hospital','facility-dataset-rollback-directive','facility-dataset-rollback-directive','active');
INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from) VALUES
 ('region-sozak-hospital','facility-dataset-rollback-admin','facility-dataset-rollback-admin',ARRAY['administrator','doctor'],'active',clock_timestamp()-interval '1 day'),
 ('region-sozak-hospital','facility-dataset-rollback-doctor','facility-dataset-rollback-doctor',ARRAY['doctor'],'active',clock_timestamp()-interval '1 day');
INSERT INTO orion_region.network_grants(user_id,anchor_clinic_id,reason) VALUES
 ('facility-dataset-rollback-admin','region-sozak-hospital','Rollback-only dataset verification');
DO $$ DECLARE v jsonb; f jsonb; overview jsonb; cohort jsonb; manifest jsonb; scope jsonb; before_replay jsonb; after_replay jsonb;
  before_cards jsonb:='{}'::jsonb; after_cards jsonb:='{}'::jsonb;
  facility text; patients integer:=0; visits integer:=0; labs integer:=0; tasks integer:=0; stocks integer:=0; queued integer:=0; replay jsonb;
BEGIN
  v:=public.orion_regional_facility_v1('orion:facility-dataset-rollback','doctor','sozak-hospital');
  PERFORM pg_temp.facility_dataset_assert(jsonb_array_length(v->'crm'->'patients')=2,'Sozak hospital has two persisted patient cards');
  PERFORM pg_temp.facility_dataset_assert(v->'crm'->'patients' @> '[{"name":"Ерлан Бекенов"},{"name":"Мөлдір Құдайбергенова"}]'::jsonb,'Sozak hospital names are hand authored');
  PERFORM pg_temp.facility_dataset_assert(jsonb_array_length(v->'medicalRecords')=2 AND jsonb_array_length(v->'labs')=2,'Sozak hospital records and labs are persisted');
  PERFORM pg_temp.facility_dataset_assert(jsonb_array_length(v->'workTasks')=2 AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'workTasks') t WHERE t->>'category'='procurement'),'Doctor does not acquire procurement access');
  v:=public.orion_regional_facility_v1('orion:facility-dataset-rollback','admin','sozak-polyclinic');
  PERFORM pg_temp.facility_dataset_assert(v->'crm'->'patients' @> '[{"name":"Айсұлу Төлебекова"},{"name":"Нұрсұлтан Сүлейменов"}]'::jsonb AND
    jsonb_array_length(v->'labs')=1,'Sozak polyclinic has distinct patients and clinical background');
  scope:=public.orion_regional_scope_v1('orion:facility-dataset-rollback','doctor');
  PERFORM pg_temp.facility_dataset_assert(scope->>'canViewRegion'='false' AND jsonb_array_length(scope->'facilities')=1 AND
    scope->'facilities'->0->>'id'='sozak-hospital','Doctor scope remains one assigned institution');
  BEGIN PERFORM public.orion_regional_facility_v1('orion:facility-dataset-rollback','doctor','sozak-polyclinic');
    RAISE EXCEPTION 'CROSS_INSTITUTION_DATASET_READ'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_overview_v1('orion:facility-dataset-rollback','doctor');
    RAISE EXCEPTION 'DOCTOR_NETWORK_DATASET_READ'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  -- Membership without a clinical directory assignment, as used by dedicated
  -- directive accounts, must never inherit clinical permissions from new data.
  BEGIN PERFORM public.orion_regional_facility_v1('orion:facility-dataset-rollback','directive','sozak-hospital');
    RAISE EXCEPTION 'NONCLINICAL_DATASET_READ'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;

  SELECT d.manifest INTO manifest FROM orion_region.training_datasets d WHERE d.id='regional-live-records-20261009-v1';
  PERFORM pg_temp.facility_dataset_assert(manifest IS NOT NULL AND (manifest->>'plannedFacilities')::integer=28,'Dataset has persisted provenance and bounded catalogue');
  PERFORM pg_temp.facility_dataset_assert((SELECT d.as_of='2026-10-09 10:00+05'::timestamptz AND d.data_mode='training' AND length(d.provenance)>40
    FROM orion_region.training_datasets d WHERE d.id='regional-live-records-20261009-v1'),'Dataset date and fictional provenance are explicit');
  overview:=public.orion_regional_overview_v1('orion:facility-dataset-rollback','admin');
  FOR facility IN SELECT jsonb_array_elements_text(manifest->'populatedFacilityIds') LOOP
    v:=public.orion_regional_facility_v1('orion:facility-dataset-rollback','admin',facility);
    SELECT x INTO f FROM jsonb_array_elements(overview->'facilities') x WHERE x->>'id'=facility;
    PERFORM pg_temp.facility_dataset_assert(v->>'dataMode'='training' AND f->>'populated'='true' AND (f->>'patientCount')::integer=2 AND
      jsonb_array_length(v->'crm'->'patients')=2 AND (v->'facility'->>'patientCount')::integer=2,'Overview and facility patient counts match persisted sources');
    PERFORM pg_temp.facility_dataset_assert(jsonb_array_length(v->'crm'->'visits')=2 AND jsonb_array_length(v->'crm'->'tasks')=2 AND
      jsonb_array_length(v->'workTasks')=3 AND (f->>'activeVisits')::integer=2 AND (f->>'openTasks')::integer=3,'Visits and task cards match overview counts');
    PERFORM pg_temp.facility_dataset_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'visits') x WHERE
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'patients') y WHERE y->>'id'=x->>'patientId') OR
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'staff') y WHERE y->>'id'=x->>'staffId') OR
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'rooms') y WHERE y->>'id'=x->>'roomId') OR
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'services') y WHERE y->>'id'=x->>'serviceId')),'Visit graph resolves through public snapshot');
    PERFORM pg_temp.facility_dataset_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'tasks') x WHERE
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'visits') y WHERE y->>'id'=x->>'visitId' AND y->>'patientId'=x->>'patientId') OR
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'staff') y WHERE y->>'id'=x->>'ownerId')),'Task graph resolves patient visit and owner');
    PERFORM pg_temp.facility_dataset_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'medicalRecords') x WHERE
      x->>'trainingIin' !~ '^TRAIN-NET-20261009-[0-9]{3}$' OR jsonb_array_length(x->'conditions')<>1 OR jsonb_array_length(x->'history')<>1 OR
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'patients') y WHERE y->>'id'=x->>'patientId')),'Each card has fictional identifier condition and history');
    PERFORM pg_temp.facility_dataset_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'labs') x WHERE
      x->>'status'<>'ordered' OR x->'result'<>'null'::jsonb OR x->'completedAt'<>'null'::jsonb OR x->'reviewedAt'<>'null'::jsonb OR
      (x->>'orderedAt')::timestamptz>(x->>'dueAt')::timestamptz OR NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'patients') y WHERE y->>'id'=x->>'patientId')),'Labs are linked orders without fabricated results');
    PERFORM pg_temp.facility_dataset_assert(jsonb_array_length(v->'prescriptions')=0 AND jsonb_array_length(v->'procurements')=0 AND
      NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'workTasks') x WHERE x->>'status'='completed' OR x->'completedAt'<>'null'::jsonb),'Import does not invent approvals or completed work');
    PERFORM pg_temp.facility_dataset_assert(NOT EXISTS(SELECT 1 FROM jsonb_array_elements(v->'crm'->'visits') x WHERE
      (x->>'status'='queued') IS DISTINCT FROM (x->'queueOrder'<>'null'::jsonb)) AND
      (SELECT count(*) FROM jsonb_array_elements(v->'crm'->'visits') x WHERE x->>'status' IN ('called','in_service'))<=1,'Queue and room occupancy constraints remain valid');
    -- Check the schedule doctors actually receive, not only the private import
    -- catalogue. Adjacent half-open slots are allowed; sharing either a doctor
    -- or a room during overlapping active visits is not.
    PERFORM pg_temp.facility_dataset_assert(NOT EXISTS(
      SELECT 1 FROM jsonb_array_elements(v->'crm'->'visits') a
      CROSS JOIN jsonb_array_elements(v->'crm'->'visits') b
      WHERE a->>'id'<b->>'id'
        AND a->>'status' IN ('scheduled','arrived','queued','called','in_service')
        AND b->>'status' IN ('scheduled','arrived','queued','called','in_service')
        AND (a->>'staffId'=b->>'staffId' OR a->>'roomId'=b->>'roomId')
        AND tstzrange((a->>'scheduledAt')::timestamptz,
          (a->>'scheduledAt')::timestamptz+make_interval(mins=>(a->>'durationMinutes')::integer),'[)')
          && tstzrange((b->>'scheduledAt')::timestamptz,
            (b->>'scheduledAt')::timestamptz+make_interval(mins=>(b->>'durationMinutes')::integer),'[)')
      ),'Active planned visits do not overlap for the same doctor or room');
    patients:=patients+jsonb_array_length(v->'crm'->'patients'); visits:=visits+jsonb_array_length(v->'crm'->'visits');
    labs:=labs+jsonb_array_length(v->'labs'); tasks:=tasks+jsonb_array_length(v->'workTasks'); stocks:=stocks+jsonb_array_length(v->'stocks');
    queued:=queued+(SELECT count(*) FROM jsonb_array_elements(v->'crm'->'visits') x WHERE x->>'status'='queued');
    before_cards:=before_cards||jsonb_build_object(facility,(v-'generatedAt')||jsonb_build_object('crm',(v->'crm')-'generatedAt'));
  END LOOP;
  PERFORM pg_temp.facility_dataset_assert(patients=(manifest->>'patients')::integer AND visits=(manifest->>'visits')::integer AND labs=(manifest->>'labs')::integer AND
    tasks=(manifest->>'tasks')::integer AND stocks=(manifest->>'stocks')::integer AND queued=(manifest->>'queuedVisits')::integer,'Public source totals equal immutable dataset manifest');
  PERFORM pg_temp.facility_dataset_assert((SELECT count(*)=patients FROM orion_region.training_dataset_patients WHERE dataset_id='regional-live-records-20261009-v1'),'All imported cards have provenance foreign keys');
  PERFORM pg_temp.facility_dataset_assert((SELECT count(DISTINCT p.name)=patients AND bool_and(p.name NOT ILIKE '%тест%') FROM orion_crm.patients p
    JOIN orion_region.training_dataset_patients d ON d.clinic_id=p.clinic_id AND d.patient_id=p.id WHERE d.dataset_id='regional-live-records-20261009-v1'),'Display names are distinct and do not contain TEST labels');

  cohort:=public.orion_regional_kpi_v1('orion:facility-dataset-rollback','admin','{"start":"2026-10-09","end":"2026-10-09","facilityId":"sozak-hospital"}');
  PERFORM pg_temp.facility_dataset_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(cohort->'observations') x WHERE x->>'indicatorId'='visits-completion' AND
    (x->>'denominator')::integer=2 AND (x->>'numerator')::integer=0),'Operational KPI reads real seeded visits without invented completion');
  PERFORM pg_temp.facility_dataset_assert(EXISTS(SELECT 1 FROM jsonb_array_elements(cohort->'observations') x WHERE x->>'indicatorId'='encounter-documentation' AND
    (x->>'denominator')::integer=0 AND (x->>'numerator')::integer=0),'Clinical documentation KPI stays missing without published encounters');

  before_replay:=overview-'generatedAt'; replay:=orion_region.seed_facility_dataset_20261009();
  after_replay:=public.orion_regional_overview_v1('orion:facility-dataset-rollback','admin')-'generatedAt';
  PERFORM pg_temp.facility_dataset_assert(replay->>'replayed'='true' AND replay-'replayed'=manifest AND before_replay=after_replay,'Importer replay is idempotent and does not alter public data');
  FOR facility IN SELECT jsonb_array_elements_text(manifest->'populatedFacilityIds') LOOP
    v:=public.orion_regional_facility_v1('orion:facility-dataset-rollback','admin',facility);
    after_cards:=after_cards||jsonb_build_object(facility,(v-'generatedAt')||jsonb_build_object('crm',(v->'crm')-'generatedAt'));
  END LOOP;
  PERFORM pg_temp.facility_dataset_assert(before_cards=after_cards,'Importer replay preserves patient visits queues medical records labs tasks and stock snapshots');
  PERFORM pg_temp.facility_dataset_assert(NOT has_function_privilege('orion_crm_app','orion_region.seed_facility_dataset_20261009()','EXECUTE') AND
    NOT has_function_privilege('public','orion_region.seed_facility_dataset_20261009()','EXECUTE'),'Owner importer is not exposed to application or public');
  PERFORM pg_temp.facility_dataset_assert(NOT has_table_privilege('orion_crm_app','orion_region.training_datasets','SELECT') AND
    NOT has_table_privilege('orion_crm_app','orion_region.training_dataset_patients','SELECT') AND
    NOT has_table_privilege('public','orion_region.training_datasets','SELECT'),'Provenance tables are private');
  PERFORM pg_temp.facility_dataset_assert((SELECT bool_and(relrowsecurity) FROM pg_class WHERE oid IN
    ('orion_region.training_datasets'::regclass,'orion_region.training_dataset_patients'::regclass)),'Provenance has RLS enabled');
END $$;
DO $$ BEGIN
  BEGIN UPDATE orion_region.training_datasets SET provenance='overwritten' WHERE id='regional-live-records-20261009-v1';
    RAISE EXCEPTION 'DATASET_PROVENANCE_MUTABLE'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN DELETE FROM orion_region.training_dataset_patients WHERE dataset_id='regional-live-records-20261009-v1';
    RAISE EXCEPTION 'DATASET_LINK_MUTABLE'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;
ROLLBACK;
