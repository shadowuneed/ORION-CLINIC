-- Owner-authorized, manually specified fictional institution records.
-- Dataset AS OF 2026-10-09 10:00 Asia/Qyzylorda, not a moving simulation clock.
-- Existing patients, accounts, permissions, KPI definitions and clinical notes
-- are untouched. No real IIN, prescription approval, result or completion seed.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'REGIONAL_TARGET_DATABASE_REQUIRED'; END IF;
  IF to_regprocedure('orion_region.operational_kpi_records(text[],timestamptz,timestamptz,text)') IS NULL THEN
    RAISE EXCEPTION 'FACILITY_DATASET_DEPENDENCY_REQUIRED';
  END IF;
END $$;
CREATE TABLE orion_region.training_datasets (
  id text PRIMARY KEY, as_of timestamptz NOT NULL, data_mode text NOT NULL CHECK(data_mode='training'),
  source_label text NOT NULL, provenance text NOT NULL, manifest jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(), CHECK(jsonb_typeof(manifest)='object')
);
CREATE TABLE orion_region.training_dataset_patients (
  dataset_id text NOT NULL REFERENCES orion_region.training_datasets(id), facility_id text NOT NULL,
  clinic_id text NOT NULL, patient_id text NOT NULL, PRIMARY KEY(dataset_id,clinic_id,patient_id),
  FOREIGN KEY(facility_id,clinic_id) REFERENCES orion_region.facilities(id,clinic_id),
  FOREIGN KEY(clinic_id,patient_id) REFERENCES orion_region.patient_details(clinic_id,patient_id)
);
ALTER TABLE orion_region.training_datasets ENABLE ROW LEVEL SECURITY;
ALTER TABLE orion_region.training_dataset_patients ENABLE ROW LEVEL SECURITY;
CREATE TRIGGER immutable_training_dataset BEFORE UPDATE OR DELETE ON orion_region.training_datasets
  FOR EACH ROW EXECUTE FUNCTION orion_clinical.reject_history_change();
CREATE TRIGGER immutable_training_dataset_patient BEFORE UPDATE OR DELETE ON orion_region.training_dataset_patients
  FOR EACH ROW EXECUTE FUNCTION orion_clinical.reject_history_change();

-- Private owner-only importer with an immutable completion receipt. Repeating
-- this function never reseeds, duplicates or changes user records. The migration
-- itself remains checksum-ledgered and is applied once, like all prior files.
CREATE FUNCTION orion_region.seed_facility_dataset_20261009() RETURNS jsonb
LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE batch_id constant text:='regional-live-records-20261009-v1'; observed constant timestamptz:='2026-10-09 10:00+05';
  manifest jsonb; profiles jsonb; existing jsonb; eligible text[]; skipped text[]; r jsonb; p jsonb;
  c text; facility text; patient text; visit text; task text; condition_ref text; sex text; title text;
  n integer; idx integer; profile_id integer; stage text; scheduled timestamptz; due timestamptz;
  patients_count integer:=0; labs_count integer:=0; total_labs integer:=0; queue_count integer:=0; summary jsonb;
BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'REGIONAL_TARGET_DATABASE_REQUIRED'; END IF;
  PERFORM pg_advisory_xact_lock(7791324006);
  SELECT d.manifest INTO existing FROM orion_region.training_datasets d WHERE d.id=batch_id;
  IF FOUND THEN RETURN existing||jsonb_build_object('replayed',true); END IF;
  -- Prevent a concurrent real user registration from racing the empty-institution
  -- check. No existing patient row is updated; the bounded import releases this
  -- lock on transaction completion or error.
  LOCK TABLE orion_crm.patients IN SHARE ROW EXCLUSIVE MODE;
  SELECT jsonb_agg(to_jsonb(x) ORDER BY x.idx) INTO manifest FROM (VALUES
   (1,'baydibek-hospital','Ермек Қуанышев','male','1971-03-12',1,'queued','09:20','Әсел Сәрсенова','female','1987-07-24',3,'arrived','09:50',24,18,120),
   (2,'baydibek-polyclinic','Динара Жұмаханова','female','1969-11-08',2,'in_service','09:30','Нұрбол Қалдыбаев','male','1993-05-19',6,'queued','10:10',16,12,80),
   (3,'kazygurt-hospital','Самат Есенқұлов','male','1963-01-27',1,'called','09:50','Меруерт Ахметжанова','female','1981-09-03',4,'arrived','10:20',30,22,140),
   (4,'kazygurt-polyclinic','Гаухар Қабылова','female','1977-04-15',5,'queued','09:40','Бауыржан Мұсабеков','male','1989-12-21',7,'scheduled','11:00',12,9,75),
   (5,'maktaaral-hospital','Азамат Өмірзақов','male','1970-06-09',2,'in_service','09:15','Ақмарал Тілеубергенова','female','1991-02-17',3,'queued','10:00',28,16,160),
   (6,'maktaaral-polyclinic','Салтанат Бекмұратова','female','1966-10-30',8,'arrived','09:45','Елдос Рысқұлов','male','1984-08-11',1,'scheduled','11:20',19,7,90),
   (7,'ordabasy-hospital','Қанат Жүнісов','male','1958-05-26',9,'queued','09:10','Айнұр Мақсұтова','female','1980-03-07',4,'arrived','09:55',21,20,130),
   (8,'ordabasy-polyclinic','Мадина Сейдахметова','female','1995-01-18',3,'in_service','09:30','Серікбай Тоқтаров','male','1962-07-02',2,'queued','10:15',17,11,85),
   (9,'otyrar-hospital','Дәулет Ниязбеков','male','1974-09-14',7,'called','09:50','Жанар Жақсылықова','female','1983-11-29',1,'arrived','10:20',25,24,150),
   (10,'otyrar-polyclinic','Шолпан Әлімбекова','female','1967-12-05',4,'queued','09:35','Мақсат Қожамқұлов','male','1997-04-23',5,'scheduled','11:30',14,8,65),
   (11,'sayram-polyclinic','Гүлнар Сапарова','female','1972-08-16',2,'arrived','09:40','Нұрдәулет Аманов','male','1986-02-28',6,'scheduled','10:50',22,14,95),
   (12,'saryagash-hospital','Рүстем Тұрсынбеков','male','1960-10-04',1,'in_service','09:20','Айсәуле Оразова','female','1988-06-13',3,'queued','10:05',31,21,170),
   (13,'sozak-hospital','Ерлан Бекенов','male','1975-03-22',1,'in_service','09:30','Мөлдір Құдайбергенова','female','1990-09-10',3,'queued','10:10',26,18,135),
   (14,'sozak-polyclinic','Айсұлу Төлебекова','female','1968-04-06',2,'queued','09:25','Нұрсұлтан Сүлейменов','male','1994-12-18',5,'arrived','09:55',15,10,85),
   (15,'tolebi-hospital','Болат Әбдіқадыров','male','1961-07-31',8,'called','09:50','Ләззат Қасенова','female','1979-05-12',4,'arrived','10:20',29,19,145),
   (16,'tolebi-polyclinic','Әлия Еркінова','female','1985-02-03',3,'in_service','09:10','Асқар Мұратбеков','male','1973-11-25',9,'queued','10:00',18,12,100),
   (17,'tulkibas-hospital','Сәкен Оралбай','male','1965-08-09',2,'queued','09:30','Назгүл Смағұлова','female','1982-01-20',1,'arrived','10:00',23,17,125),
   (18,'tulkibas-polyclinic','Жазира Досжанова','female','1992-06-27',5,'arrived','09:45','Еркебұлан Нұрмағанбет','male','1987-10-15',7,'scheduled','11:10',13,9,70),
   (19,'shardara-polyclinic','Зейнеп Баймұратова','female','1964-03-02',1,'in_service','09:20','Данияр Тасболатов','male','1996-07-17',6,'queued','10:05',20,13,110),
   (20,'zhetisay-hospital','Мұхтар Қалдыбеков','male','1957-09-28',9,'called','09:40','Кәмшат Қуатова','female','1984-04-19',4,'arrived','10:10',27,23,155),
   (21,'keles-hospital','Талғат Садықов','male','1978-12-07',2,'queued','09:15','Сандуғаш Әбілқасымова','female','1989-08-24',3,'arrived','09:50',24,16,130),
   (22,'keles-polyclinic','Раушан Мырзахметова','female','1970-05-11',8,'in_service','09:35','Әділет Жолдасбек','male','1998-02-16',5,'queued','10:10',16,11,80),
   (23,'sauran-hospital','Серік Есенбай','male','1966-01-13',1,'called','09:55','Аружан Қанатова','female','1993-10-08',3,'arrived','10:25',22,20,120),
   (24,'sauran-polyclinic','Фариза Әбдірахманова','female','1981-06-22',4,'queued','09:35','Руслан Бисенов','male','1976-11-04',9,'scheduled','11:40',18,10,90),
   (25,'kentau-polyclinic','Бақытгүл Тілеуова','female','1969-02-14',2,'in_service','09:25','Алмас Сейтқали','male','1990-07-30',6,'queued','10:00',21,15,105),
   (26,'arys-hospital','Ораз Әбділдаев','male','1959-04-18',1,'queued','09:20','Гүлсім Мәмбетова','female','1986-12-01',3,'arrived','09:55',28,22,150),
   (27,'arys-polyclinic','Нұргүл Қайратова','female','1974-09-06',4,'called','09:45','Бекжан Рахымов','male','1995-03-26',5,'arrived','10:15',17,8,95),
   (28,'shymkent-hospital','Темірлан Оспанов','male','1967-06-05',9,'in_service','09:30','Дариға Бекболатова','female','1980-10-21',2,'queued','10:05',35,26,190)
  ) x(idx,facility,name1,sex1,dob1,profile1,stage1,time1,name2,sex2,dob2,profile2,stage2,time2,medication,dressing,syringe);
  -- Explicit scenario catalogue, not generated clinical conclusions. All findings
  -- are fictional background; no prescription or treatment approval is created.
  SELECT jsonb_agg(to_jsonb(x)) INTO profiles FROM (VALUES
   (1,'I10','Артериальная гипертензия','2023-02-15','Контроль артериального давления','В учебной карте описаны эпизоды повышения давления. На визите требуется сверить дневник самоконтроля.','Креатинин крови','Сверить дневник давления и подготовить вопросы врачу'),
   (2,'E11.9','Сахарный диабет 2 типа','2021-07-09','Плановое наблюдение','Вымышленный пациент пришёл на плановый контроль. Результаты текущего обследования ещё не получены.','Глюкоза плазмы натощак','Уточнить дату контроля глюкозы'),
   (3,'D50.9','Железодефицитная анемия','2025-11-12','Контроль показателей крови','В учебном анамнезе отмечалась утомляемость. Предыдущий диагноз задан сценарием; новая оценка врача отсутствует.','Клинический анализ крови','Проверить поступление общего анализа крови'),
   (4,'E03.9','Гипотиреоз','2022-05-18','Эндокринологическое наблюдение','Вымышленная история планового наблюдения щитовидной железы. Изменения лечения в этом наборе не назначены.','Тиреотропный гормон','Подготовить сведения о прошлых обследованиях'),
   (5,'J30.1','Сезонный аллергический ринит','2024-04-20','Сезонные жалобы','Учебная карточка содержит жалобы на сезонный насморк. Требуется опрос; назначений и лабораторного результата нет.',NULL,'Уточнить сезонность симптомов и аллергологический анамнез'),
   (6,'M54.5','Боль в нижней части спины','2026-08-19','Повторная консультация','Вымышленный пациент записан для оценки дискомфорта в спине. Диагноз является фоном сценария, не новым заключением.',NULL,'Подготовить данные о динамике жалоб'),
   (7,'S93.4','Растяжение связок голеностопа','2026-09-25','Контроль восстановления','Учебный анамнез после бытовой травмы. Осмотр и решение о дальнейших действиях в системе ещё не оформлены.',NULL,'Уточнить самочувствие перед повторным осмотром'),
   (8,'M17.9','Остеоартроз коленного сустава','2020-10-14','Плановая консультация','В вымышленной карте отмечен дискомфорт при нагрузке. Этот импорт не подтверждает лечение или выполнение процедуры.',NULL,'Уточнить ограничения повседневной активности'),
   (9,'E78.5','Дислипидемия','2023-03-28','Контроль факторов риска','Учебные сведения о длительном наблюдении. Текущий лабораторный результат и рекомендации врача пока отсутствуют.','Липидный профиль','Дождаться результата назначенного исследования')
  ) x(id,code,condition,since,title,detail,lab,task);
  IF jsonb_array_length(manifest)<>28 OR EXISTS(SELECT 1 FROM jsonb_array_elements(manifest) x WHERE NOT EXISTS(
    SELECT 1 FROM orion_region.facilities f JOIN orion_crm.clinics c ON c.id=f.clinic_id AND c.active AND c.mode='synthetic_simulation'
    WHERE f.id=x->>'facility' AND f.data_mode='training')) THEN RAISE EXCEPTION 'FACILITY_DATASET_CATALOGUE_MISMATCH'; END IF;
  SELECT coalesce(array_agg(x->>'facility' ORDER BY x->>'facility'),'{}') INTO eligible FROM jsonb_array_elements(manifest) x
    JOIN orion_region.facilities f ON f.id=x->>'facility' WHERE NOT EXISTS(SELECT 1 FROM orion_crm.patients p WHERE p.clinic_id=f.clinic_id);
  SELECT coalesce(array_agg(x->>'facility' ORDER BY x->>'facility'),'{}') INTO skipped FROM jsonb_array_elements(manifest) x WHERE NOT (x->>'facility')=ANY(eligible);
  FOR r IN SELECT value FROM jsonb_array_elements(manifest) x WHERE (x->>'facility')=ANY(eligible) LOOP
    FOR n IN 1..2 LOOP
      SELECT value INTO p FROM jsonb_array_elements(profiles) x WHERE (x->>'id')::integer=(r->>('profile'||n))::integer;
      IF p->>'lab' IS NOT NULL THEN total_labs:=total_labs+1; END IF;
      IF r->>('stage'||n)='queued' THEN queue_count:=queue_count+1; END IF;
    END LOOP;
  END LOOP;
  summary:=jsonb_build_object('plannedFacilities',28,'populatedFacilityIds',eligible,'skippedNonemptyFacilityIds',skipped,
    'patients',2*cardinality(eligible),'visits',2*cardinality(eligible),'medicalRecords',2*cardinality(eligible),
    'labs',total_labs,'stocks',3*cardinality(eligible),'tasks',3*cardinality(eligible),'queuedVisits',queue_count,
    'prescriptions',0,'clinicalNotes',0,'completedWork',0,'source','explicit hand-authored fictional cases; no real IIN');
  INSERT INTO orion_region.training_datasets(id,as_of,data_mode,source_label,provenance,manifest)
    VALUES(batch_id,observed,'training','Ручной учебный набор учреждений — 09.10.2026',
      'Owner-authorized fictional records for previously empty institutions. Names may coincide by chance; TRAIN identifiers are invalid IINs. No clinical approval or official statistics.',summary);
  FOR r IN SELECT value FROM jsonb_array_elements(manifest) x WHERE (x->>'facility')=ANY(eligible) LOOP
    facility:=r->>'facility'; idx:=(r->>'idx')::integer;
    SELECT clinic_id INTO c FROM orion_region.facilities WHERE id=facility;
    PERFORM id FROM orion_crm.clinics WHERE id=c FOR SHARE;
    IF NOT EXISTS(SELECT 1 FROM orion_crm.staff WHERE clinic_id=c AND id='doctor' AND role='doctor') OR
      NOT EXISTS(SELECT 1 FROM orion_crm.staff WHERE clinic_id=c AND id='laboratory') OR
      NOT EXISTS(SELECT 1 FROM orion_crm.staff WHERE clinic_id=c AND id='supply') OR
      NOT EXISTS(SELECT 1 FROM orion_crm.rooms WHERE clinic_id=c AND id='consultation') OR
      NOT EXISTS(SELECT 1 FROM orion_crm.services WHERE clinic_id=c AND id='consultation') THEN RAISE EXCEPTION 'FACILITY_DATASET_RESOURCE_MISSING'; END IF;
    INSERT INTO orion_region.stocks(clinic_id,id,drug_name,unit,quantity,reorder_point,batch,expires_at) VALUES
      (c,'dataset-20261009-medication','Парацетамол 500 мг','упаковка',(r->>'medication')::integer,20,'EDU-NET-20261009-M','2028-12-31'),
      (c,'dataset-20261009-dressing','Стерильная повязка','штука',(r->>'dressing')::integer,15,'EDU-NET-20261009-D','2029-06-30'),
      (c,'dataset-20261009-syringe','Шприц одноразовый 5 мл','штука',(r->>'syringe')::integer,100,'EDU-NET-20261009-S','2029-03-31');
    INSERT INTO orion_region.work_tasks(clinic_id,id,owner_id,title,category,priority,status,due_at,created_at)
      VALUES(c,'dataset-20261009-supply','supply','Сверить остатки расходных материалов','procurement','routine','pending','2026-10-10 15:00+05','2026-10-09 09:00+05');
    FOR n IN 1..2 LOOP
      patient:='dataset-20261009-p'||n; visit:='dataset-20261009-v'||n; task:='dataset-20261009-t'||n;
      profile_id:=(r->>('profile'||n))::integer;
      SELECT value INTO p FROM jsonb_array_elements(profiles) x WHERE (x->>'id')::integer=profile_id;
      stage:=r->>('stage'||n);
      scheduled:=(date '2026-10-09'+(r->>('time'||n))::time) AT TIME ZONE 'Asia/Qyzylorda';
      due:=CASE WHEN n=1 THEN '2026-10-09 12:00+05'::timestamptz ELSE '2026-10-10 11:00+05'::timestamptz END;
      INSERT INTO orion_crm.patients(clinic_id,id,name,mrn,sex)
        VALUES(c,patient,r->>('name'||n),'ORION-'||upper(left(encode(sha256(convert_to(batch_id||':'||facility||':'||n,'UTF8')),'hex'),16)),r->>('sex'||n));
      INSERT INTO orion_region.patient_details(clinic_id,patient_id,training_iin,birth_date,allergies)
        VALUES(c,patient,'TRAIN-NET-20261009-'||lpad(((idx-1)*2+n)::text,3,'0'),(r->>('dob'||n))::date,
          CASE WHEN profile_id=5 THEN ARRAY['Пыльца растений — учебный анамнез'] ELSE '{}'::text[] END);
      INSERT INTO orion_region.conditions(clinic_id,id,patient_id,code,name,since,status)
        VALUES(c,'dataset-20261009-condition'||n,patient,p->>'code',p->>'condition',(p->>'since')::date,'active');
      INSERT INTO orion_region.patient_history(clinic_id,id,patient_id,recorded_at,title,detail,doctor)
        VALUES(c,'dataset-20261009-history'||n,patient,'2026-10-01 10:00+05',p->>'title',p->>'detail','Учебный сценарий ORION');
      INSERT INTO orion_region.visits(clinic_id,id,patient_id,staff_id,room_id,service_id,scheduled_at,status,updated_at,duration_minutes,queue_order)
        VALUES(c,visit,patient,'doctor','consultation','consultation',scheduled,stage,observed,30,
          CASE WHEN stage='queued' THEN nextval('orion_region.queue_sequence') ELSE NULL END);
      INSERT INTO orion_region.work_tasks(clinic_id,id,patient_id,visit_id,owner_id,title,category,priority,status,due_at,created_at)
        VALUES(c,task,patient,visit,CASE WHEN p->>'lab' IS NOT NULL THEN 'laboratory' ELSE 'doctor' END,p->>'task',
          CASE WHEN p->>'lab' IS NOT NULL THEN 'laboratory' ELSE 'care' END,'routine',
          CASE WHEN stage='in_service' THEN 'in_progress' ELSE 'pending' END,due,'2026-10-09 08:30+05');
      IF p->>'lab' IS NOT NULL THEN
        INSERT INTO orion_region.labs(clinic_id,id,patient_id,name,priority,status,ordered_at,due_at,reference)
          VALUES(c,'dataset-20261009-lab'||n,patient,p->>'lab','routine','ordered','2026-10-08 15:00+05',due,
            'Учебная заявка: результат не внесён и не проверен врачом; диапазон определяет лаборатория');
        labs_count:=labs_count+1;
      END IF;
      INSERT INTO orion_region.training_dataset_patients(dataset_id,facility_id,clinic_id,patient_id) VALUES(batch_id,facility,c,patient);
      patients_count:=patients_count+1;
    END LOOP;
  END LOOP;
  IF patients_count<>2*cardinality(eligible) OR labs_count<>total_labs THEN RAISE EXCEPTION 'FACILITY_DATASET_IMPORT_INCOMPLETE'; END IF;
  RETURN summary||jsonb_build_object('replayed',false);
END $$;
REVOKE ALL ON orion_region.training_datasets,orion_region.training_dataset_patients FROM PUBLIC,orion_crm_app;
REVOKE ALL ON FUNCTION orion_region.seed_facility_dataset_20261009() FROM PUBLIC,orion_crm_app;
SELECT orion_region.seed_facility_dataset_20261009();
COMMIT;
