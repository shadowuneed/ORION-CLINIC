-- Explicit, hand-authored fictional records. No real identifiers, clinical import or automatic reseed.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'REGIONAL_TARGET_DATABASE_REQUIRED'; END IF;
  IF EXISTS(SELECT 1 FROM orion_region.facilities) THEN RAISE EXCEPTION 'REGIONAL_FIXTURES_ALREADY_EXIST'; END IF;
  IF NOT EXISTS(SELECT 1 FROM orion_directory.current_assignments WHERE user_id='user-a' AND clinic_id='crm-clinic-local'
    AND 'administrator'=ANY(roles) AND 'access.manage'=ANY(permissions)) THEN RAISE EXCEPTION 'REGIONAL_OWNER_AUTHORITY_REQUIRED'; END IF;
END $$;
INSERT INTO orion_region.network_grants(user_id,anchor_clinic_id,reason) VALUES('user-a','crm-clinic-local','Owner-authorized PC regional training network, 2026-10-08; no clinical grants to other tenants');
INSERT INTO orion_region.districts VALUES
 ('baydibek','Байдибекский район','district','turkestan'),('kazygurt','Казыгуртский район','district','turkestan'),
 ('maktaaral','Мактааральский район','district','turkestan'),('ordabasy','Ордабасинский район','district','turkestan'),
 ('otyrar','Отырарский район','district','turkestan'),('sayram','Сайрамский район','district','turkestan'),
 ('saryagash','Сарыагашский район','district','turkestan'),('sozak','Сузакский район','district','turkestan'),
 ('tolebi','Толебийский район','district','turkestan'),('tulkibas','Тюлькубасский район','district','turkestan'),
 ('shardara','Шардаринский район','district','turkestan'),('zhetisay','Жетысайский район','district','turkestan'),
 ('keles','Келесский район','district','turkestan'),('sauran','Сауранский район','district','turkestan'),
 ('turkestan','Туркестан','city','turkestan'),('kentau','Кентау','city','turkestan'),('arys','Арыс','city','turkestan'),
 ('shymkent','Шымкент','city','shymkent');
-- Coordinates are approximate demonstration placements around district centres, not verified hospital addresses.
DO $$ DECLARE d record; k text; facility text; c text; label text; BEGIN
 FOR d IN SELECT * FROM (VALUES
  ('baydibek',43.032307,69.380745),('kazygurt',41.758801,69.385651),('maktaaral',40.6654951,68.5499938),
  ('ordabasy',42.5999908,69.2581088),('otyrar',42.7869666,68.3709214),('sayram',42.4234022,69.8252591),
  ('saryagash',41.4673309,69.1705119),('sozak',43.766701,69.17688),('tolebi',42.182169,69.8873166),
  ('tulkibas',42.5344182,70.3501763),('shardara',41.255856,67.975266),('zhetisay',40.777134,68.324677),
  ('keles',41.3494551,68.9522597),('sauran',43.3952837,68.0236546),('turkestan',43.3019457,68.2703698),
  ('kentau',43.5165919,68.4996044),('arys',42.4324695,68.8134889),('shymkent',42.3146962,69.5883282)
 ) x(id,lat,lng) LOOP
  FOREACH k IN ARRAY ARRAY['hospital','polyclinic'] LOOP
   facility:=d.id||'-'||k;c:='region-'||facility;
   SELECT name INTO label FROM orion_region.districts WHERE id=d.id;
   label:=CASE WHEN k='hospital' THEN 'Больница · ' ELSE 'Поликлиника · ' END||label;
   INSERT INTO orion_crm.clinics(id,name) VALUES(c,label);
   INSERT INTO orion_crm.clinic_calendar VALUES(c,'Asia/Qyzylorda',ARRAY[1,2,3,4,5],540,1080,'synthetic_policy');
   INSERT INTO orion_region.facilities(id,district_id,clinic_id,name,kind,latitude,longitude,address)
    VALUES(facility,d.id,c,label,k,d.lat+CASE WHEN k='hospital' THEN 0.012 ELSE -0.012 END,d.lng+CASE WHEN k='hospital' THEN -0.01 ELSE 0.01 END,'Учебное расположение; адрес не относится к действующей организации');
   INSERT INTO orion_crm.buildings VALUES(c,'building-main','Главный корпус',0,0,17,11);
   INSERT INTO orion_crm.rooms VALUES
    (c,'reception','Регистратура','reception',0,0,5,4),(c,'consultation','Кабинет врача','consultation',6,0,5,4),
    (c,'diagnostics','Лаборатория','diagnostics',12,0,5,4),(c,'pharmacy','Аптека','treatment',0,6,5,5),
    (c,'treatment','Процедурная','treatment',6,6,5,5),(c,'staff','Команда и снабжение','staff',12,6,5,5);
   INSERT INTO orion_crm.room_buildings SELECT c,id,'building-main' FROM orion_crm.rooms WHERE clinic_id=c;
   INSERT INTO orion_crm.staff VALUES
    (c,'registrar','Айжан Сейітова','registrar','reception'),(c,'doctor','Марат Әбдіров','doctor','consultation'),
    (c,'laboratory','Салтанат Нұрланова','doctor','diagnostics'),(c,'pharmacist','Әлия Қасымова','nurse','pharmacy'),
    (c,'nurse','Айсұлу Ермекова','nurse','treatment'),(c,'supply','Бекзат Сапаров','support','staff');
   INSERT INTO orion_crm.services VALUES(c,'consultation','Консультация врача',30,'consultation'),(c,'laboratory','Лабораторное обследование',20,'diagnostics'),(c,'treatment','Процедура',15,'treatment');
  END LOOP;
 END LOOP;
END $$;
-- Each profile and medical history is written explicitly; identifiers intentionally cannot be real IINs.
DO $$ DECLARE p record; c text; observed timestamptz:=clock_timestamp(); slot timestamptz; BEGIN
 FOR p IN SELECT * FROM (VALUES
 (1,'turkestan-hospital','Айдана Төлегенова','female','1984-04-12','I10','Артериальная гипертензия','2023-02-14','Пенициллин: сыпь','Контроль артериального давления','В карте отмечен план повторного контроля давления. Самочувствие стабильное.','queued','pending','care',-2),
 (2,'turkestan-hospital','Ерлан Мұратов','male','1976-09-08','E11.9','Сахарный диабет 2 типа','2021-06-10','','Плановый осмотр эндокринолога','Обсуждены дневник самоконтроля и дата следующего обследования.','in_service','in_progress','laboratory',-1),
 (3,'turkestan-hospital','Назерке Қалиева','female','1992-01-22','D50.9','Железодефицитная анемия','2025-11-03','','Контроль показателей крови','Назначен контроль общего анализа крови по сохранённому плану врача.','scheduled','completed','care',-4),
 (4,'turkestan-polyclinic','Руслан Жұмабеков','male','1988-07-16','J45.9','Бронхиальная астма','2019-05-20','Пыльца: сезонные симптомы','План наблюдения','Проверена техника использования ранее назначенного ингалятора.','arrived','pending','care',1),
 (5,'turkestan-polyclinic','Мөлдір Әбілова','female','1968-12-05','M17.9','Остеоартроз коленного сустава','2022-08-11','','Повторный осмотр','Сохраняется дискомфорт при ходьбе; план обследования занесён в карту.','queued','in_progress','care',-3),
 (6,'turkestan-polyclinic','Арман Сағындықов','male','2001-03-28','J30.1','Сезонный аллергический ринит','2024-04-09','Пыльца берёзы','Сезонное наблюдение','План наблюдения и симптомы обсуждены на консультации.','scheduled','completed','laboratory',-6),
 (7,'kentau-hospital','Гүлмира Оспанова','female','1959-05-19','I10','Артериальная гипертензия','2018-09-17','','Контроль терапии','Зарегистрированы сведения о переносимости ранее назначенного лечения.','in_service','pending','care',-1),
 (8,'kentau-hospital','Нұрсұлтан Беков','male','1995-11-02','S93.4','Растяжение связок голеностопа','2026-09-28','','Осмотр травматолога','Повторная оценка восстановления после бытовой травмы.','scheduled','completed','care',-5),
 (9,'saryagash-polyclinic','Аружан Исабекова','female','1998-06-14','E03.9','Гипотиреоз','2020-03-24','','План эндокринологического наблюдения','Контроль лабораторных показателей запланирован в медицинской карте.','queued','pending','laboratory',-2),
 (10,'saryagash-polyclinic','Данияр Рахметов','male','1979-10-30','E78.5','Дислипидемия','2023-07-07','','Профилактический осмотр','Результаты прошлого обследования сопоставлены с планом наблюдения.','arrived','in_progress','care',2),
 (11,'saryagash-polyclinic','Ақбота Ниязова','female','1986-02-17','K29.5','Хронический гастрит','2021-10-15','','Плановая консультация','Отмечены текущие жалобы и ранее проведённые обследования.','scheduled','completed','care',-7),
 (12,'sayram-hospital','Серік Әлімжанов','male','1965-08-23','I25.9','Хроническая ишемическая болезнь сердца','2020-12-02','','Кардиологическое наблюдение','Уточнены сведения о наблюдении у кардиолога и выданных назначениях.','in_service','in_progress','care',-1),
 (13,'sayram-hospital','Жанар Қожахметова','female','1990-04-04','D50.9','Железодефицитная анемия','2026-01-20','','Контрольный анализ','Запланирована проверка ранее изменённых показателей крови.','queued','pending','laboratory',1),
 (14,'zhetisay-polyclinic','Бекзат Сұлтанов','male','1982-09-25','M54.5','Боль в нижней части спины','2025-08-19','','Повторная консультация','Сведения о динамике жалоб сохранены после повторного осмотра.','arrived','pending','care',-2),
 (15,'zhetisay-polyclinic','Перизат Әуезова','female','1973-11-13','I10','Артериальная гипертензия','2019-04-06','','Проверка плана наблюдения','Уточнены дата следующего визита и записи домашнего контроля.','queued','completed','care',-3),
 (16,'zhetisay-polyclinic','Әсет Құдайбергенов','male','1997-01-09','J30.9','Аллергический ринит','2022-05-16','Домашняя пыль','Консультация аллерголога','Жалобы связаны с сезонными факторами; анамнез обновлён.','scheduled','in_progress','care',2),
 (17,'shardara-hospital','Ләззат Ахметова','female','1961-03-11','E11.9','Сахарный диабет 2 типа','2017-09-08','','Повторный осмотр','Сохранён план регулярного контроля и сведения о предыдущих анализах.','in_service','pending','laboratory',-4),
 (18,'shardara-hospital','Мұрат Жолдасов','male','1987-12-27','S52.5','Перелом дистального отдела лучевой кости','2026-08-31','','Контроль восстановления','Последовательность наблюдения после травмы отражена в карте.','scheduled','completed','care',-2),
 (19,'shymkent-polyclinic','Айнұр Тұрсынова','female','1980-05-06','E03.9','Гипотиреоз','2024-02-12','','Плановый контроль','Результаты и назначения рассматриваются на очередном приёме.','queued','pending','laboratory',-1),
 (20,'shymkent-polyclinic','Олжас Байсейітов','male','1993-07-07','J45.9','Бронхиальная астма','2015-06-23','','Диспансерное наблюдение','Проверен план наблюдения; новых острых жалоб в учебной записи нет.','scheduled','completed','care',-5)
 ) x(n,facility,name,sex,dob,code,condition,since,allergy,title,detail,stage,task_status,category,due_days) ORDER BY (x.stage='in_service') DESC,x.n LOOP
  c:='region-'||p.facility;
  INSERT INTO orion_crm.patients VALUES(c,'patient-'||p.n,p.name,'CRM-'||lpad((8000+p.n)::text,4,'0'),p.sex);
  INSERT INTO orion_region.patient_details VALUES(c,'patient-'||p.n,'TRAIN-ORION-'||lpad(p.n::text,3,'0'),p.dob::date,CASE WHEN p.allergy='' THEN '{}'::text[] ELSE ARRAY[p.allergy] END);
  INSERT INTO orion_region.conditions VALUES(c,'condition-'||p.n,'patient-'||p.n,p.code,p.condition,p.since::date,'active');
  INSERT INTO orion_region.patient_history VALUES(c,'history-'||p.n,'patient-'||p.n,observed-interval '14 days',p.title,p.detail,'Марат Әбдіров');
  slot:=CASE WHEN p.stage='scheduled' THEN observed+interval '1 day' ELSE observed-interval '30 minutes' END;
  INSERT INTO orion_region.visits(clinic_id,id,patient_id,staff_id,room_id,service_id,scheduled_at,status,version,updated_at,duration_minutes,queue_order)
    VALUES(c,'visit-'||p.n,'patient-'||p.n,'doctor','consultation','consultation',slot,p.stage,1,observed-interval '5 minutes',30,CASE WHEN p.stage='queued' THEN p.n ELSE NULL END);
  INSERT INTO orion_region.work_tasks VALUES(c,'task-'||p.n,'patient-'||p.n,'visit-'||p.n,CASE WHEN p.category='laboratory' THEN 'laboratory' ELSE 'doctor' END,
    CASE WHEN p.category='laboratory' THEN 'Проверить результат назначенного исследования' ELSE 'Уточнить выполнение плана наблюдения' END,p.category,
    CASE WHEN p.n IN (2,7,12,17) THEN 'urgent' ELSE 'routine' END,p.task_status,observed+make_interval(days=>p.due_days),
    CASE WHEN p.task_status='completed' THEN observed+make_interval(days=>p.due_days)-interval '2 hours' ELSE NULL END,observed-interval '10 days',1);
  INSERT INTO orion_region.labs VALUES(c,'lab-'||p.n,'patient-'||p.n,CASE WHEN p.code LIKE 'E0%' THEN 'Тиреотропный гормон' WHEN p.code LIKE 'E11%' THEN 'Гликированный гемоглобин' ELSE 'Гемоглобин' END,
    CASE WHEN p.n IN (2,13,17) THEN 'urgent' ELSE 'routine' END,CASE WHEN p.n IN (3,6,8,11,15,18,20) THEN 'reviewed' WHEN p.n IN (2,7,12,17) THEN 'ready' ELSE 'ordered' END,
    observed-interval '2 days',observed+make_interval(days=>p.due_days),
    CASE WHEN p.n IN (2,17) THEN '6.7' WHEN p.n IN (3,6,7,8,11,12,15,18,20) THEN '132' ELSE NULL END,
    CASE WHEN p.n IN (2,17) THEN '%' WHEN p.n IN (3,6,7,8,11,12,15,18,20) THEN 'г/л' ELSE NULL END,
    'Справочное значение определяется лабораторией и контекстом пациента',
    CASE WHEN p.n IN (2,3,6,7,8,11,12,15,17,18,20) THEN observed-interval '1 day' ELSE NULL END,
    CASE WHEN p.n IN (3,6,8,11,15,18,20) THEN observed-interval '12 hours' ELSE NULL END,1);
 END LOOP;
END $$;
-- Explicit stock positions; no generated KPI values are stored.
DO $$ DECLARE f record; observed timestamptz:=clock_timestamp(); BEGIN
 FOR f IN SELECT * FROM (VALUES
  ('turkestan-hospital',18,5,140),('turkestan-polyclinic',8,12,80),('kentau-hospital',22,3,180),
  ('saryagash-polyclinic',4,8,60),('sayram-hospital',30,11,200),('zhetisay-polyclinic',6,6,90),
  ('shardara-hospital',2,4,110),('shymkent-polyclinic',28,16,150)
 ) x(id,medicine,dressing,syringe) LOOP
  INSERT INTO orion_region.stocks VALUES
   ('region-'||f.id,'stock-medication','Парацетамол 500 мг','упаковка',f.medicine,10,'EDU-M-2026','2028-12-31',1),
   ('region-'||f.id,'stock-dressing','Стерильная повязка','штука',f.dressing,10,'EDU-D-2026','2029-06-30',1),
   ('region-'||f.id,'stock-syringe','Шприц одноразовый 5 мл','штука',f.syringe,100,'EDU-S-2026','2029-03-31',1);
  INSERT INTO orion_region.procurements VALUES('region-'||f.id,'procurement-dressing','stock-dressing','ТОО «МедСнаб Оқу» — учебный поставщик',40,24000,'ordered',observed-interval '3 days',observed+interval '2 days',NULL,1);
  INSERT INTO orion_region.work_tasks VALUES('region-'||f.id,'task-supply',NULL,NULL,'supply','Проверить поступление расходных материалов','procurement','routine','pending',observed+interval '2 days',NULL,observed-interval '3 days',1);
 END LOOP;
END $$;
-- Reviewed fictional prescriptions; dispensing is a later explicit staff command.
INSERT INTO orion_region.prescriptions VALUES
 ('region-turkestan-hospital','rx-1','patient-1','stock-medication','500 мг','Учебное назначение врача; по требованию, до 3 дней',1,'approved','Марат Әбдіров',clock_timestamp()-interval '1 day',NULL,1),
 ('region-turkestan-polyclinic','rx-5','patient-5','stock-dressing','1 стерильная повязка','Учебное назначение расходного материала',2,'approved','Марат Әбдіров',clock_timestamp()-interval '1 day',NULL,1),
 ('region-kentau-hospital','rx-8','patient-8','stock-dressing','1 стерильная повязка','Учебное назначение расходного материала',2,'approved','Марат Әбдіров',clock_timestamp()-interval '1 day',NULL,1),
 ('region-saryagash-polyclinic','rx-10','patient-10','stock-medication','500 мг','Учебное краткосрочное назначение; проверить перед выдачей',1,'approved','Марат Әбдіров',clock_timestamp()-interval '1 day',NULL,1),
 ('region-sayram-hospital','rx-12','patient-12','stock-dressing','1 стерильная повязка','Учебное назначение расходного материала',2,'approved','Марат Әбдіров',clock_timestamp()-interval '1 day',NULL,1),
 ('region-zhetisay-polyclinic','rx-14','patient-14','stock-medication','500 мг','Учебное краткосрочное назначение; проверить перед выдачей',1,'approved','Марат Әбдіров',clock_timestamp()-interval '1 day',NULL,1),
 ('region-shardara-hospital','rx-18','patient-18','stock-dressing','1 стерильная повязка','Учебное назначение расходного материала',2,'approved','Марат Әбдіров',clock_timestamp()-interval '1 day',NULL,1),
 ('region-shymkent-polyclinic','rx-20','patient-20','stock-dressing','1 стерильная повязка','Учебное назначение расходного материала',2,'approved','Марат Әбдіров',clock_timestamp()-interval '1 day',NULL,1);
INSERT INTO orion_region.audit_events(user_id,action,resource_id,after_state) VALUES('user-a','regional.training.import','manual-2026-10-08',
 jsonb_build_object('patients',20,'facilities',36,'populatedFacilities',8,'source','hand-authored fictional records','validIin',false,'existingPatientRowsChanged',false));
COMMIT;
