-- PC-only additive evidence for DISPATCH-KPI-1. This is a small, fictional
-- training cohort, NOT an official report or the full activity of an institution.
-- Existing clinical records, accounts and applied migrations are not changed.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'REGIONAL_TARGET_DATABASE_REQUIRED'; END IF;
  IF (SELECT count(*) FROM orion_region.facilities WHERE data_mode='training')<>36 THEN
    RAISE EXCEPTION 'REGIONAL_KPI_EXPECTED_TRAINING_CATALOGUE';
  END IF;
END $$;

CREATE TABLE orion_region.kpi_definitions (
  id text PRIMARY KEY,
  title text NOT NULL, category text NOT NULL CHECK(category IN ('quality','resources','laboratory','operations')),
  source_type text NOT NULL CHECK(source_type IN ('official','internal')),
  source_title text NOT NULL, source_url text, source_version text NOT NULL,
  applicable_kinds text[] NOT NULL CHECK(cardinality(applicable_kinds)>0 AND applicable_kinds<@ARRAY['hospital','polyclinic']::text[]),
  basis text NOT NULL CHECK(basis IN ('ratio_per_1000','percent','mean_minutes')),
  direction text NOT NULL CHECK(direction IN ('lower','higher')),
  target numeric CHECK(target>=0 AND target<1000000), unit text NOT NULL,
  numerator_label text NOT NULL, denominator_label text NOT NULL,
  period_kind text NOT NULL CHECK(period_kind IN ('interval','snapshot')),
  target_period text NOT NULL CHECK(target_period IN ('calendar_month','snapshot','any')),
  note text NOT NULL
);
CREATE TABLE orion_region.kpi_evidence_batches (
  id text PRIMARY KEY, data_mode text NOT NULL CHECK(data_mode='training'),
  source_label text NOT NULL, provenance text NOT NULL,
  period_start date NOT NULL, period_end date NOT NULL CHECK(period_end>=period_start),
  created_by_database_role text NOT NULL DEFAULT session_user,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
-- One completed inpatient episode / outpatient encounter per row. These source
-- identifiers are not patient accounts, real IINs or clinical patient records.
CREATE TABLE orion_region.kpi_care_episodes (
  facility_id text NOT NULL REFERENCES orion_region.facilities(id), id text NOT NULL,
  batch_id text NOT NULL REFERENCES orion_region.kpi_evidence_batches(id),
  subject_ref text NOT NULL CHECK(subject_ref LIKE 'TRAIN-KPI-%'),
  started_at timestamptz NOT NULL, completed_at timestamptz NOT NULL CHECK(completed_at>=started_at),
  PRIMARY KEY(facility_id,id)
);
CREATE INDEX regional_kpi_episode_period ON orion_region.kpi_care_episodes(facility_id,completed_at);
CREATE TABLE orion_region.kpi_complaint_decisions (
  facility_id text NOT NULL, id text NOT NULL, episode_id text NOT NULL,
  batch_id text NOT NULL REFERENCES orion_region.kpi_evidence_batches(id),
  filed_at timestamptz NOT NULL, decided_at timestamptz NOT NULL CHECK(decided_at>=filed_at),
  substantiated boolean NOT NULL, evidence_ref text NOT NULL,
  PRIMARY KEY(facility_id,id),
  FOREIGN KEY(facility_id,episode_id) REFERENCES orion_region.kpi_care_episodes(facility_id,id)
);
CREATE INDEX regional_kpi_complaint_period ON orion_region.kpi_complaint_decisions(facility_id,decided_at);
CREATE TABLE orion_region.kpi_staffing_snapshots (
  facility_id text NOT NULL REFERENCES orion_region.facilities(id), id text NOT NULL,
  batch_id text NOT NULL REFERENCES orion_region.kpi_evidence_batches(id),
  observed_at timestamptz NOT NULL, evidence_ref text NOT NULL,
  PRIMARY KEY(facility_id,id), UNIQUE(facility_id,observed_at)
);
CREATE TABLE orion_region.kpi_doctor_positions (
  facility_id text NOT NULL, snapshot_id text NOT NULL, position_ref text NOT NULL,
  authorized_fte numeric(6,2) NOT NULL CHECK(authorized_fte>0 AND authorized_fte<=1),
  PRIMARY KEY(facility_id,snapshot_id,position_ref),
  FOREIGN KEY(facility_id,snapshot_id) REFERENCES orion_region.kpi_staffing_snapshots(facility_id,id)
);
CREATE TABLE orion_region.kpi_main_doctors (
  facility_id text NOT NULL, snapshot_id text NOT NULL,
  person_ref text NOT NULL CHECK(person_ref LIKE 'TRAIN-KPI-DOCTOR-%'),
  PRIMARY KEY(facility_id,snapshot_id,person_ref),
  FOREIGN KEY(facility_id,snapshot_id) REFERENCES orion_region.kpi_staffing_snapshots(facility_id,id)
);
-- Each sample contains the actual endpoints needed by the official TAT formula.
-- No fabricated result text, order-time substitution or universal deadline.
CREATE TABLE orion_region.kpi_lab_samples (
  facility_id text NOT NULL REFERENCES orion_region.facilities(id), id text NOT NULL,
  batch_id text NOT NULL REFERENCES orion_region.kpi_evidence_batches(id),
  assay_code text NOT NULL, received_at timestamptz NOT NULL,
  result_sent_at timestamptz NOT NULL CHECK(result_sent_at>=received_at),
  evidence_ref text NOT NULL, PRIMARY KEY(facility_id,id)
);
CREATE INDEX regional_kpi_lab_period ON orion_region.kpi_lab_samples(facility_id,result_sent_at);
CREATE TABLE orion_region.kpi_source_audit (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  source_table text NOT NULL, row_identity jsonb NOT NULL,
  row_sha256 text NOT NULL CHECK(row_sha256~'^[a-f0-9]{64}$'),
  recorded_by_database_role text NOT NULL DEFAULT session_user,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION orion_region.audit_kpi_source() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  INSERT INTO orion_region.kpi_source_audit(source_table,row_identity,row_sha256)
  VALUES(TG_TABLE_NAME,jsonb_strip_nulls(jsonb_build_object('facilityId',to_jsonb(NEW)->'facility_id',
    'id',to_jsonb(NEW)->'id','snapshotId',to_jsonb(NEW)->'snapshot_id',
    'positionRef',to_jsonb(NEW)->'position_ref','personRef',to_jsonb(NEW)->'person_ref')),
    encode(sha256(convert_to(to_jsonb(NEW)::text,'UTF8')),'hex'));
  RETURN NEW;
END $$;
-- No browser write API is introduced. Evidence is immutable; corrections require
-- a separately reviewed additive migration, never rewriting submitted evidence.
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['kpi_definitions','kpi_evidence_batches','kpi_care_episodes','kpi_complaint_decisions',
    'kpi_staffing_snapshots','kpi_doctor_positions','kpi_main_doctors','kpi_lab_samples','kpi_source_audit'] LOOP
    EXECUTE format('ALTER TABLE orion_region.%I ENABLE ROW LEVEL SECURITY',t);
    EXECUTE format('CREATE TRIGGER immutable_kpi_evidence BEFORE UPDATE OR DELETE ON orion_region.%I FOR EACH ROW EXECUTE FUNCTION orion_clinical.reject_history_change()',t);
    IF t<>'kpi_source_audit' THEN
      EXECUTE format('CREATE TRIGGER audit_kpi_evidence AFTER INSERT ON orion_region.%I FOR EACH ROW EXECUTE FUNCTION orion_region.audit_kpi_source()',t);
    END IF;
  END LOOP;
END $$;

INSERT INTO orion_region.kpi_definitions VALUES
 ('complaints-hospital','Обоснованные жалобы · стационар','quality','official','МЗ РК № ҚР ДСМ-230/2020, приложение 1',
  'https://old.adilet.zan.kz/rus/docs/V2000021727/compare','Редакция с изменениями 18.09.2025',ARRAY['hospital'],
  'ratio_per_1000','lower',1,'на 1 000','Обоснованные жалобы','Пролеченные пациенты','interval','calendar_month',
  'Месячный показатель: обоснованные жалобы / пролеченные пациенты × 1 000. Норматив ≤1 применяется только к полному календарному месяцу. Малый учебный набор, не официальная статистика. Жалоба учитывается по дате решения, пролеченный случай — по дате выписки.'),
 ('complaints-polyclinic','Обоснованные жалобы · поликлиника','quality','official','МЗ РК № ҚР ДСМ-230/2020, приложение 1',
  'https://old.adilet.zan.kz/rus/docs/V2000021727/compare','Редакция с изменениями 18.09.2025',ARRAY['polyclinic'],
  'ratio_per_1000','lower',3,'на 1 000','Обоснованные жалобы','Завершённые посещения','interval','calendar_month',
  'Месячный показатель: обоснованные жалобы / посещения × 1 000. Норматив ≤3 применяется только к полному календарному месяцу. Малый учебный набор, не официальная статистика. Жалоба учитывается по дате решения, посещение — по дате завершения.'),
 ('doctor-staffing','Укомплектованность врачами G1','resources','official','МЗ РК №170 от 30.11.2023, показатель G1',
  'https://old.adilet.zan.kz/rus/docs/V2300033712','Редакция 22.11.2024',ARRAY['hospital'],
  'percent','higher',80,'%','Врачи по основному месту работы','Штатные врачебные должности','snapshot','snapshot',
  'Физические лица по основному месту работы / штатные врачебные должности × 100%. G1 рейтинга стационарных поставщиков ГОБМП/ОСМС: минимум 80%, цель 100%. Это не универсальная оценка качества. Последний кадровый срез не позднее конца выбранного периода; срезы не суммируются.'),
 ('lab-turnaround','Время выдачи лабораторного результата','laboratory','official','МЗ РК № ҚР ДСМ-257/2020, приложения 3–4',
  'https://old.adilet.zan.kz/rus/docs/V2000021768','Действующая редакция на 09.10.2026; без ещё не вступивших в силу изменений №118',ARRAY['hospital','polyclinic'],
  'mean_minutes','lower',NULL,'мин','Минуты от получения образца до отправки результата','Выданные лабораторные результаты','interval','any',
  'Среднее время: сумма (отправка результата − получение образца) / число выданных результатов. Отбор по дате отправки. Единого нормативного срока для всех исследований нет. Малый учебный набор, не официальная отчётность.');

INSERT INTO orion_region.kpi_evidence_batches(id,data_mode,source_label,provenance,period_start,period_end)
VALUES('dispatch-kpi-training-2026-q3','training','Ручной учебный журнал ORION: июль–сентябрь 2026',
 'Вымышленные малые когорты для 36 учебных организаций из существующего каталога. Явно заданные планы ниже развёрнуты в отдельные случаи, образцы и кадровые строки. Не импорт из государственных систем; не полная деятельность учреждений и не реальные пациенты.',
 '2026-07-01','2026-09-30');

-- Explicitly authored facility cohorts. Arrays correspond to July/August/September.
-- Expansion only assigns stable identifiers and timestamps to individual source
-- records. No percentage, KPI score or aggregated observation is stored.
DO $$
DECLARE f record; m integer; n integer; month_start date; end_at timestamptz; received timestamptz;
  snapshot text; ep text; total_positions numeric; sample_minutes integer;
BEGIN
  FOR f IN SELECT * FROM (VALUES
    ('baydibek-hospital',ARRAY[12,14,15],10.5,ARRAY[7,8,9],ARRAY[84,78,67]),
    ('baydibek-polyclinic',ARRAY[18,20,22],0,ARRAY[0,0,0],ARRAY[66,62,59]),
    ('kazygurt-hospital',ARRAY[14,15,16],12,ARRAY[9,9,10],ARRAY[96,89,83]),
    ('kazygurt-polyclinic',ARRAY[20,22,24],0,ARRAY[0,0,0],ARRAY[78,73,67]),
    ('maktaaral-hospital',ARRAY[16,18,17],14,ARRAY[10,11,11],ARRAY[102,91,87]),
    ('maktaaral-polyclinic',ARRAY[24,23,25],0,ARRAY[0,0,0],ARRAY[85,80,74]),
    ('ordabasy-hospital',ARRAY[13,15,17],11,ARRAY[8,9,9],ARRAY[79,74,70]),
    ('ordabasy-polyclinic',ARRAY[19,21,23],0,ARRAY[0,0,0],ARRAY[63,60,58]),
    ('otyrar-hospital',ARRAY[9,10,12],8,ARRAY[6,6,7],ARRAY[110,98,89]),
    ('otyrar-polyclinic',ARRAY[14,15,17],0,ARRAY[0,0,0],ARRAY[87,80,76]),
    ('sayram-hospital',ARRAY[18,20,22],16,ARRAY[12,13,14],ARRAY[76,70,64]),
    ('sayram-polyclinic',ARRAY[26,28,30],0,ARRAY[0,0,0],ARRAY[62,58,55]),
    ('saryagash-hospital',ARRAY[20,22,23],18,ARRAY[13,14,14],ARRAY[115,105,99]),
    ('saryagash-polyclinic',ARRAY[28,30,32],0,ARRAY[0,0,0],ARRAY[96,92,84]),
    ('sozak-hospital',ARRAY[8,9,10],8,ARRAY[5,5,6],ARRAY[132,126,118]),
    ('sozak-polyclinic',ARRAY[13,15,16],0,ARRAY[0,0,0],ARRAY[104,98,93]),
    ('tolebi-hospital',ARRAY[15,16,18],12,ARRAY[9,10,10],ARRAY[88,84,77]),
    ('tolebi-polyclinic',ARRAY[22,24,25],0,ARRAY[0,0,0],ARRAY[72,69,64]),
    ('tulkibas-hospital',ARRAY[12,13,15],10,ARRAY[8,8,9],ARRAY[91,86,79]),
    ('tulkibas-polyclinic',ARRAY[18,20,21],0,ARRAY[0,0,0],ARRAY[70,67,62]),
    ('shardara-hospital',ARRAY[10,12,13],9.5,ARRAY[6,7,7],ARRAY[117,109,101]),
    ('shardara-polyclinic',ARRAY[17,18,20],0,ARRAY[0,0,0],ARRAY[91,87,82]),
    ('zhetisay-hospital',ARRAY[17,19,20],15,ARRAY[11,12,13],ARRAY[97,90,85]),
    ('zhetisay-polyclinic',ARRAY[25,27,29],0,ARRAY[0,0,0],ARRAY[76,72,68]),
    ('keles-hospital',ARRAY[14,16,17],12.5,ARRAY[8,9,10],ARRAY[107,102,94]),
    ('keles-polyclinic',ARRAY[21,23,24],0,ARRAY[0,0,0],ARRAY[82,78,73]),
    ('sauran-hospital',ARRAY[9,11,12],8,ARRAY[5,6,7],ARRAY[102,96,90]),
    ('sauran-polyclinic',ARRAY[15,17,19],0,ARRAY[0,0,0],ARRAY[80,76,71]),
    ('turkestan-hospital',ARRAY[24,26,28],20,ARRAY[17,18,19],ARRAY[69,64,60]),
    ('turkestan-polyclinic',ARRAY[30,32,34],0,ARRAY[0,0,0],ARRAY[58,54,50]),
    ('kentau-hospital',ARRAY[18,19,21],16,ARRAY[13,13,14],ARRAY[81,76,72]),
    ('kentau-polyclinic',ARRAY[24,25,27],0,ARRAY[0,0,0],ARRAY[67,63,59]),
    ('arys-hospital',ARRAY[11,12,14],10,ARRAY[7,8,8],ARRAY[98,92,86]),
    ('arys-polyclinic',ARRAY[17,19,20],0,ARRAY[0,0,0],ARRAY[79,74,68]),
    ('shymkent-hospital',ARRAY[26,28,30],24,ARRAY[21,22,23],ARRAY[65,60,56]),
    ('shymkent-polyclinic',ARRAY[32,34,36],0,ARRAY[0,0,0],ARRAY[53,49,46])
  ) x(facility_id,episodes,positions,doctors,lab_minutes) LOOP
    IF NOT EXISTS(SELECT 1 FROM orion_region.facilities WHERE id=f.facility_id AND data_mode='training') THEN
      RAISE EXCEPTION 'REGIONAL_KPI_UNKNOWN_SEED_FACILITY';
    END IF;
    FOR m IN 1..3 LOOP
      month_start:=make_date(2026,6+m,1);
      FOR n IN 1..f.episodes[m] LOOP
        ep:='episode-'||to_char(month_start,'YYYY-MM')||'-'||lpad(n::text,3,'0');
        end_at:=((month_start+(1+(n-1)%24))+time '10:00'+make_interval(mins=>((n-1)/24)*40)) AT TIME ZONE 'Asia/Qyzylorda';
        INSERT INTO orion_region.kpi_care_episodes VALUES(f.facility_id,ep,'dispatch-kpi-training-2026-q3',
          'TRAIN-KPI-'||f.facility_id||'-'||to_char(month_start,'YYYYMM')||'-'||n,
          end_at-CASE WHEN f.positions>0 THEN interval '3 days' ELSE interval '25 minutes' END,end_at);
      END LOOP;
      FOR n IN 1..3 LOOP
        received:=((month_start+(4+n*5))+time '09:15') AT TIME ZONE 'Asia/Qyzylorda';
        sample_minutes:=f.lab_minutes[m]+CASE n WHEN 1 THEN -12 WHEN 2 THEN 0 ELSE 18 END;
        INSERT INTO orion_region.kpi_lab_samples VALUES(f.facility_id,'sample-'||to_char(month_start,'YYYY-MM')||'-'||n,
          'dispatch-kpi-training-2026-q3',CASE n WHEN 1 THEN 'CBC' WHEN 2 THEN 'GLUCOSE' ELSE 'BIOCHEMISTRY' END,
          received,received+make_interval(mins=>sample_minutes),'TRAIN-LAB-REGISTER-'||to_char(month_start,'YYYYMM')||'-'||n);
      END LOOP;
      IF f.positions>0 THEN
        snapshot:='staff-'||to_char(month_start,'YYYY-MM');
        INSERT INTO orion_region.kpi_staffing_snapshots VALUES(f.facility_id,snapshot,'dispatch-kpi-training-2026-q3',
          ((month_start+interval '1 month'-interval '1 day')::date+time '17:00') AT TIME ZONE 'Asia/Qyzylorda',
          'TRAIN-HR-ROSTER-'||to_char(month_start,'YYYYMM'));
        FOR n IN 1..ceil(f.positions)::integer LOOP
          total_positions:=least(1,f.positions-(n-1));
          INSERT INTO orion_region.kpi_doctor_positions VALUES(f.facility_id,snapshot,'position-'||n,total_positions);
        END LOOP;
        FOR n IN 1..f.doctors[m] LOOP
          INSERT INTO orion_region.kpi_main_doctors VALUES(f.facility_id,snapshot,'TRAIN-KPI-DOCTOR-'||f.facility_id||'-'||n);
        END LOOP;
      END IF;
    END LOOP;
  END LOOP;
END $$;
-- Deliberately small complaint register: both substantiated and rejected cases.
-- One complaint in a small cohort has a high per-1000 rate: do not disguise this
-- by inventing thousands of encounters or interpreting it as population data.
INSERT INTO orion_region.kpi_complaint_decisions VALUES
 ('saryagash-hospital','complaint-2026-07','episode-2026-07-001','dispatch-kpi-training-2026-q3','2026-07-08 10:00+05','2026-07-21 14:00+05',true,'TRAIN-DECISION-001'),
 ('sozak-hospital','complaint-2026-08','episode-2026-08-001','dispatch-kpi-training-2026-q3','2026-08-09 09:00+05','2026-08-23 15:00+05',true,'TRAIN-DECISION-002'),
 ('saryagash-polyclinic','complaint-2026-09','episode-2026-09-001','dispatch-kpi-training-2026-q3','2026-09-07 11:00+05','2026-09-22 10:00+05',true,'TRAIN-DECISION-003'),
 ('turkestan-hospital','complaint-2026-07','episode-2026-07-001','dispatch-kpi-training-2026-q3','2026-07-08 10:00+05','2026-07-20 14:00+05',false,'TRAIN-DECISION-004'),
 ('sayram-polyclinic','complaint-2026-08','episode-2026-08-001','dispatch-kpi-training-2026-q3','2026-08-09 10:00+05','2026-08-22 14:00+05',false,'TRAIN-DECISION-005'),
 ('kentau-hospital','complaint-2026-09','episode-2026-09-001','dispatch-kpi-training-2026-q3','2026-09-07 10:00+05','2026-09-21 14:00+05',false,'TRAIN-DECISION-006');

CREATE FUNCTION public.orion_regional_kpi_v1(p_issuer text,p_subject text,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; scope jsonb; visible text[]; selected text; start_date date; end_date date;
  start_at timestamptz; end_at timestamptz; definitions jsonb; facilities jsonb; observations jsonb; result jsonb;
BEGIN
  -- Authentication remains server-derived, using the unchanged directory authorizer.
  actor:=orion_region.require_user(p_issuer,p_subject);
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR octet_length(p_query::text)>1024 THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  IF NOT(p_query?'start') OR NOT(p_query?'end') OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_query) k WHERE k NOT IN ('start','end','facilityId')) OR
    jsonb_typeof(p_query->'start') IS DISTINCT FROM 'string' OR jsonb_typeof(p_query->'end') IS DISTINCT FROM 'string' OR
    (p_query->>'start')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (p_query->>'end')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR
    (p_query?'facilityId' AND (jsonb_typeof(p_query->'facilityId') IS DISTINCT FROM 'string' OR
      length(p_query->>'facilityId') NOT BETWEEN 1 AND 160)) THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  BEGIN
    start_date:=(p_query->>'start')::date; end_date:=(p_query->>'end')::date;
  EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END;
  IF start_date>end_date OR end_date-start_date>365 OR start_date<'1900-01-01' OR end_date>'2200-12-31' THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  selected:=p_query->>'facilityId';
  IF selected IS NOT NULL THEN PERFORM orion_region.facility_access(p_issuer,p_subject,selected); END IF;
  scope:=public.orion_regional_scope_v1(p_issuer,p_subject);
  SELECT coalesce(array_agg(x->>'id'),'{}') INTO visible FROM jsonb_array_elements(scope->'facilities') x
    WHERE selected IS NULL OR x->>'id'=selected;
  IF selected IS NOT NULL AND cardinality(visible)=0 THEN RAISE EXCEPTION 'REGIONAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  start_at:=start_date::timestamp AT TIME ZONE 'Asia/Qyzylorda';
  end_at:=(end_date+1)::timestamp AT TIME ZONE 'Asia/Qyzylorda';
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'title',title,'category',category,'sourceType',source_type,
    'sourceTitle',source_title,'sourceUrl',source_url,'sourceVersion',source_version,'applicableKinds',applicable_kinds,
    'basis',basis,'direction',direction,'target',target,'unit',unit,'numeratorLabel',numerator_label,
    'denominatorLabel',denominator_label,'periodKind',period_kind,'targetPeriod',target_period,'note',note) ORDER BY id),'[]')
    INTO definitions FROM orion_region.kpi_definitions;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',f.id,'name',f.name,'kind',f.kind,'districtId',f.district_id,
    'regionId',d.region_id) ORDER BY f.id),'[]') INTO facilities
    FROM orion_region.facilities f JOIN orion_region.districts d ON d.id=f.district_id WHERE f.id=ANY(visible);
  WITH authorized AS (SELECT id,kind FROM orion_region.facilities WHERE id=ANY(visible)),
  episodes AS (SELECT e.facility_id,count(*)::numeric denominator,max(e.completed_at) latest
    FROM orion_region.kpi_care_episodes e JOIN authorized a ON a.id=e.facility_id
    WHERE e.completed_at>=start_at AND e.completed_at<end_at GROUP BY e.facility_id),
  complaints AS (SELECT c.facility_id,count(*) FILTER(WHERE c.substantiated)::numeric numerator,
    count(*)::integer sources,max(c.decided_at) latest FROM orion_region.kpi_complaint_decisions c
    JOIN authorized a ON a.id=c.facility_id WHERE c.decided_at>=start_at AND c.decided_at<end_at GROUP BY c.facility_id),
  labs AS (SELECT l.facility_id,sum(extract(epoch FROM l.result_sent_at-l.received_at)/60)::numeric numerator,
    count(*)::numeric denominator,max(l.result_sent_at) latest FROM orion_region.kpi_lab_samples l
    JOIN authorized a ON a.id=l.facility_id WHERE l.result_sent_at>=start_at AND l.result_sent_at<end_at GROUP BY l.facility_id),
  snapshots AS (SELECT DISTINCT ON(s.facility_id) s.* FROM orion_region.kpi_staffing_snapshots s
    JOIN authorized a ON a.id=s.facility_id AND a.kind='hospital' WHERE s.observed_at<end_at ORDER BY s.facility_id,s.observed_at DESC,s.id),
  staffing AS (SELECT s.facility_id,s.observed_at latest,
    (SELECT count(*) FROM orion_region.kpi_main_doctors p WHERE p.facility_id=s.facility_id AND p.snapshot_id=s.id)::numeric numerator,
    (SELECT coalesce(sum(p.authorized_fte),0) FROM orion_region.kpi_doctor_positions p WHERE p.facility_id=s.facility_id AND p.snapshot_id=s.id)::numeric denominator,
    (SELECT count(*) FROM orion_region.kpi_main_doctors p WHERE p.facility_id=s.facility_id AND p.snapshot_id=s.id)+
    (SELECT count(*) FROM orion_region.kpi_doctor_positions p WHERE p.facility_id=s.facility_id AND p.snapshot_id=s.id) sources FROM snapshots s),
  values_to_return AS (
    SELECT a.id facility_id,'complaints-'||a.kind indicator_id,coalesce(c.numerator,0) numerator,coalesce(e.denominator,0) denominator,
      (coalesce(e.denominator,0)+coalesce(c.sources,0))::integer source_count,greatest(e.latest,c.latest) latest
      FROM authorized a LEFT JOIN episodes e ON e.facility_id=a.id LEFT JOIN complaints c ON c.facility_id=a.id
    UNION ALL SELECT a.id,'lab-turnaround',coalesce(l.numerator,0),coalesce(l.denominator,0),coalesce(l.denominator,0)::integer,l.latest
      FROM authorized a LEFT JOIN labs l ON l.facility_id=a.id
    UNION ALL SELECT a.id,'doctor-staffing',coalesce(s.numerator,0),coalesce(s.denominator,0),coalesce(s.sources,0)::integer,CASE WHEN s.sources>0 THEN s.latest ELSE NULL END
      FROM authorized a LEFT JOIN staffing s ON s.facility_id=a.id WHERE a.kind='hospital'
  ) SELECT coalesce(jsonb_agg(jsonb_build_object('facilityId',facility_id,'indicatorId',indicator_id,'numerator',numerator,
    'denominator',denominator,'sourceCount',source_count,'lastObservedAt',orion_crm.iso(latest)) ORDER BY facility_id,indicator_id),'[]')
    INTO observations FROM values_to_return;
  result:=jsonb_build_object('schemaVersion',1,'dataMode','training','generatedAt',orion_crm.iso(clock_timestamp()),
    'period',jsonb_build_object('start',start_date::text,'end',end_date::text),'definitions',definitions,'facilities',facilities,'observations',observations);
  IF octet_length(result::text)>524288 THEN RAISE EXCEPTION 'REGIONAL_LIMIT' USING ERRCODE='PT503'; END IF;
  INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,after_state)
    VALUES(actor,selected,'regional.kpi.read',coalesce(selected,'authorized-facilities'),
      jsonb_build_object('start',start_date,'end',end_date,'facilityCount',cardinality(visible)));
  RETURN result;
END $$;

CREATE FUNCTION public.orion_regional_kpi_evidence_v1(p_issuer text,p_subject text,p_query jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text; snapshot jsonb; selected text; indicator text; page_offset integer:=0;
  start_date date; end_date date; start_at timestamptz; end_at timestamptz; staff_snapshot text;
  evidence jsonb; total_records integer; result jsonb;
BEGIN
  actor:=orion_region.require_user(p_issuer,p_subject);
  IF jsonb_typeof(p_query) IS DISTINCT FROM 'object' OR octet_length(p_query::text)>1536 THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  IF NOT(p_query?'facilityId') OR NOT(p_query?'indicatorId') OR
    EXISTS(SELECT 1 FROM jsonb_object_keys(p_query) k WHERE k NOT IN ('start','end','facilityId','indicatorId','offset')) OR
    jsonb_typeof(p_query->'indicatorId') IS DISTINCT FROM 'string' OR length(p_query->>'indicatorId')>80 OR
    (p_query?'offset' AND (jsonb_typeof(p_query->'offset') IS DISTINCT FROM 'number' OR (p_query->>'offset')!~'^(0|[1-9][0-9]{0,6})$')) THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  IF p_query?'offset' THEN page_offset:=(p_query->>'offset')::integer; END IF;
  IF page_offset>10000 THEN RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400'; END IF;
  -- Reuse the exact authorized facility filter and date parser, not browser actor IDs.
  snapshot:=public.orion_regional_kpi_v1(p_issuer,p_subject,p_query-ARRAY['indicatorId','offset']);
  selected:=p_query->>'facilityId'; indicator:=p_query->>'indicatorId';
  IF NOT EXISTS(SELECT 1 FROM jsonb_array_elements(snapshot->'observations') x WHERE x->>'facilityId'=selected AND x->>'indicatorId'=indicator) THEN
    RAISE EXCEPTION 'REGIONAL_KPI_INVALID_QUERY' USING ERRCODE='PT400';
  END IF;
  start_date:=(p_query->>'start')::date; end_date:=(p_query->>'end')::date;
  start_at:=start_date::timestamp AT TIME ZONE 'Asia/Qyzylorda'; end_at:=(end_date+1)::timestamp AT TIME ZONE 'Asia/Qyzylorda';
  IF indicator='doctor-staffing' THEN
    SELECT id INTO staff_snapshot FROM orion_region.kpi_staffing_snapshots WHERE facility_id=selected AND observed_at<end_at ORDER BY observed_at DESC,id LIMIT 1;
  END IF;
  -- Only pseudonymous source IDs and numeric facts leave the private register.
  -- Full source rows, batch internals, patient references and actor identity do not.
  WITH records AS (
    SELECT 'care:'||e.id id,e.completed_at observed_at,'care_episode'::text kind,
      CASE WHEN indicator='complaints-hospital' THEN 'Завершённый стационарный случай' ELSE 'Завершённое посещение' END label,
      1::numeric value,'случай'::text unit FROM orion_region.kpi_care_episodes e
      WHERE e.facility_id=selected AND indicator IN ('complaints-hospital','complaints-polyclinic') AND e.completed_at>=start_at AND e.completed_at<end_at
    UNION ALL SELECT 'complaint:'||c.id,c.decided_at,'complaint_decision',
      CASE WHEN c.substantiated THEN 'Обоснованная жалоба' ELSE 'Жалоба не признана обоснованной' END,
      CASE WHEN c.substantiated THEN 1 ELSE 0 END,'жалоба' FROM orion_region.kpi_complaint_decisions c
      WHERE c.facility_id=selected AND indicator IN ('complaints-hospital','complaints-polyclinic') AND c.decided_at>=start_at AND c.decided_at<end_at
    UNION ALL SELECT 'lab:'||l.id,l.result_sent_at,'lab_sample','Образец: получение → отправка результата',
      extract(epoch FROM l.result_sent_at-l.received_at)/60,'мин' FROM orion_region.kpi_lab_samples l
      WHERE l.facility_id=selected AND indicator='lab-turnaround' AND l.result_sent_at>=start_at AND l.result_sent_at<end_at
    UNION ALL SELECT 'position:'||p.snapshot_id||'-'||p.position_ref,s.observed_at,'doctor_position','Штатная врачебная должность',p.authorized_fte,'ставка'
      FROM orion_region.kpi_doctor_positions p JOIN orion_region.kpi_staffing_snapshots s ON s.facility_id=p.facility_id AND s.id=p.snapshot_id
      WHERE p.facility_id=selected AND indicator='doctor-staffing' AND p.snapshot_id=staff_snapshot
    UNION ALL SELECT 'doctor:'||p.snapshot_id||'-'||p.person_ref,s.observed_at,'main_doctor','Врач по основному месту работы',1,'человек'
      FROM orion_region.kpi_main_doctors p JOIN orion_region.kpi_staffing_snapshots s ON s.facility_id=p.facility_id AND s.id=p.snapshot_id
      WHERE p.facility_id=selected AND indicator='doctor-staffing' AND p.snapshot_id=staff_snapshot
  ), page AS (SELECT * FROM records ORDER BY observed_at DESC,id COLLATE "C" OFFSET page_offset LIMIT 20)
  SELECT (SELECT count(*)::integer FROM records),coalesce((SELECT jsonb_agg(jsonb_build_object('id',id,
    'observedAt',orion_crm.iso(observed_at),'kind',kind,'label',label,'value',value,'unit',unit) ORDER BY observed_at DESC,id COLLATE "C") FROM page),'[]')
    INTO total_records,evidence;
  result:=jsonb_build_object('schemaVersion',1,'facilityId',selected,'indicatorId',indicator,
    'period',jsonb_build_object('start',start_date::text,'end',end_date::text),'total',total_records,'offset',page_offset,'items',evidence,
    'nextOffset',CASE WHEN page_offset+20<total_records AND page_offset+20<=10000 THEN page_offset+20 ELSE NULL END);
  INSERT INTO orion_region.audit_events(user_id,facility_id,action,resource_id,after_state)
    VALUES(actor,selected,'regional.kpi.evidence.read',indicator,jsonb_build_object('start',start_date,'end',end_date,'offset',page_offset,'returned',jsonb_array_length(evidence)));
  RETURN result;
END $$;

REVOKE ALL ON orion_region.kpi_definitions,orion_region.kpi_evidence_batches,orion_region.kpi_care_episodes,
  orion_region.kpi_complaint_decisions,orion_region.kpi_staffing_snapshots,orion_region.kpi_doctor_positions,
  orion_region.kpi_main_doctors,orion_region.kpi_lab_samples,orion_region.kpi_source_audit FROM PUBLIC,orion_crm_app;
REVOKE ALL ON SEQUENCE orion_region.kpi_source_audit_id_seq FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION orion_region.audit_kpi_source() FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_regional_kpi_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_regional_kpi_v1(text,text,jsonb) TO orion_crm_app;
REVOKE ALL ON FUNCTION public.orion_regional_kpi_evidence_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_regional_kpi_evidence_v1(text,text,jsonb) TO orion_crm_app;
COMMIT;
