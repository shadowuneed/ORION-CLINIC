-- DIRECTIVES-1 acceptance seam: public authenticated RPCs only for behavior.
-- Execute on the guarded owned local database; every fixture and write rolls back.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'WRONG_DIRECTIVE_TEST_DATABASE'; END IF;
  IF to_regprocedure('public.orion_regional_directives_v1(text,text,jsonb)') IS NULL THEN
    RAISE EXCEPTION 'DIRECTIVE_MIGRATION_REQUIRED';
  END IF;
END $$;
CREATE FUNCTION pg_temp.directive_assert(ok boolean,label text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'DIRECTIVE_CHECK_FAILED: %',label; END IF; END $$;
DO $$ DECLARE snapshot jsonb; BEGIN
  snapshot:=public.orion_regional_directives_v1('orion:local:directives','directive-admin','{}');
  PERFORM pg_temp.directive_assert(snapshot->'capabilities'->>'issue'='true' AND snapshot->'capabilities'->>'review'='true','dedicated administrator may issue and review');
  PERFORM pg_temp.directive_assert(jsonb_array_length(snapshot->'facilities')=36,'administrator can target all institutions');
  snapshot:=public.orion_regional_directives_v1('orion:local:directives','head-turkestan-hospital','{}');
  PERFORM pg_temp.directive_assert(snapshot->>'actorId'='head-turkestan-hospital' AND jsonb_array_length(snapshot->'facilities')=1,'head sees only own institution');
  PERFORM pg_temp.directive_assert(snapshot->'capabilities'->>'issue'='false' AND snapshot->'facilities'->0->>'canSubmit'='true','head submits without administrator privileges');
END $$;
DO $$ DECLARE result jsonb; replay jsonb; snapshot jsonb; command jsonb; invalid text;
BEGIN
  command:=jsonb_build_object('type','create','idempotencyKey','d1000000-0000-4000-8000-000000000001','expectedVersion',0,
    'title','Rollback-only source report','authorityReference','Учебное письмо; проверка транзакции','details','Подать документ, затем дождаться решения.',
    'dueDate',((clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date+7)::text,'facilityIds',jsonb_build_array('turkestan-hospital','sayram-hospital'));
  result:=public.orion_regional_directive_command_v1('orion:local:directives','directive-admin',command);
  replay:=public.orion_regional_directive_command_v1('orion:local:directives','directive-admin',command);
  PERFORM pg_temp.directive_assert(result->>'directiveId'=replay->>'directiveId' AND replay->>'replayed'='true','create replay returns same saved directive');
  snapshot:=public.orion_regional_directives_v1('orion:local:directives','head-turkestan-hospital','{}');
  PERFORM pg_temp.directive_assert((SELECT jsonb_array_length(d->'assignments') FROM jsonb_array_elements(snapshot->'directives') d WHERE d->>'id'=result->>'directiveId')=1,'head sees only own assignment of multi-institution directive');
  FOREACH invalid IN ARRAY ARRAY[chr(160),repeat(chr(128512),91)] LOOP
    BEGIN PERFORM public.orion_regional_directive_command_v1('orion:local:directives','directive-admin',
      command||jsonb_build_object('idempotencyKey',gen_random_uuid()::text,'title',invalid));
      RAISE EXCEPTION 'DTO_INVALID_TEXT_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;
    END;
  END LOOP;
END $$;
-- Time-boundary fixtures model earlier issued letters, not mutated deadlines.
-- This setup is transaction-local; all behavior below goes through public RPCs.
INSERT INTO orion_region.directives(id,title,authority_reference,details,issued_by,issued_at,issued_date,due_date)
SELECT 'rollback-'||n,n,'Учебная фикстура срока','Проверка фактической даты и проверки.',
  'directive-admin',clock_timestamp()-interval '10 days',(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date-10,
  (clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date-2
FROM unnest(ARRAY['timely','late','documents','work','permissions','files']) n;
INSERT INTO orion_region.directive_assignments(id,directive_id,facility_id)
SELECT 'rollback-assignment-'||n,'rollback-'||n,'turkestan-hospital' FROM unnest(ARRAY['timely','late','documents','work','permissions','files']) n;
INSERT INTO orion_region.directive_events(assignment_id,version,user_id,action,status,progress,work_cycle)
SELECT 'rollback-assignment-'||n,1,'directive-admin','create','assigned',0,1 FROM unnest(ARRAY['timely','late','documents','work','permissions','files']) n;
DO $$ DECLARE command jsonb; result jsonb; replay jsonb; BEGIN
  -- A receipt created when the letter was issued must still replay after its
  -- deadline. This historical receipt is rollback-only setup, not an RPC bypass.
  command:=jsonb_build_object('type','create','idempotencyKey','d1000000-0000-4000-8000-000000000009','expectedVersion',0,
    'title','timely','authorityReference','Учебная фикстура срока','details','Проверка фактической даты и проверки.',
    'dueDate',((clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date-2)::text,'facilityIds',jsonb_build_array('turkestan-hospital'));
  result:=jsonb_build_object('directiveId','rollback-timely','assignmentId',NULL,'version',1,'replayed',false);
  INSERT INTO orion_region.directive_receipts(user_id,idempotency_key,request_hash,result,created_at)
    VALUES('directive-admin',(command->>'idempotencyKey')::uuid,encode(sha256(convert_to(command::text,'UTF8')),'hex'),result,clock_timestamp()-interval '10 days');
  replay:=public.orion_regional_directive_command_v1('orion:local:directives','directive-admin',command);
  PERFORM pg_temp.directive_assert(replay->>'directiveId'='rollback-timely' AND replay->>'replayed'='true','expired create receipt remains replayable');
  BEGIN
    PERFORM public.orion_regional_directive_command_v1('orion:local:directives','directive-admin',command||jsonb_build_object('idempotencyKey',gen_random_uuid()::text));
    RAISE EXCEPTION 'NEW_EXPIRED_DIRECTIVE_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;
  END;
END $$;
CREATE FUNCTION pg_temp.directive_assignment(p_subject text,p_id text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT a FROM jsonb_array_elements(public.orion_regional_directives_v1('orion:local:directives',p_subject,'{}')->'directives') d
    CROSS JOIN jsonb_array_elements(d->'assignments') a WHERE a->>'id'=p_id
$$;
CREATE FUNCTION pg_temp.directive_file(p_purpose text) RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_build_array(jsonb_build_object('fileName','report.txt','mimeType','text/plain','purpose',p_purpose,'contentBase64','aGVsbG8='))
$$;
CREATE FUNCTION pg_temp.directive_command(p_subject text,p_id text,p_version integer,p_body jsonb) RETURNS jsonb LANGUAGE sql AS $$
  SELECT public.orion_regional_directive_command_v1('orion:local:directives',p_subject,
    p_body||jsonb_build_object('assignmentId',p_id,'expectedVersion',p_version,'idempotencyKey',gen_random_uuid()::text))
$$;
DO $$ DECLARE today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date; a jsonb; result jsonb;
BEGIN
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-timely',1,
    jsonb_build_object('type','submit','actualCompletedDate',(today-3)::text,'attachments',pg_temp.directive_file('report')));
  a:=pg_temp.directive_assignment('directive-admin','rollback-assignment-timely');
  PERFORM pg_temp.directive_assert(a->>'status'='submitted' AND a->>'explanationRequired'='false','late submission of timely work does not require late-work letter');
  PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-timely',2,'{"type":"review","decision":"accept"}');
  a:=pg_temp.directive_assignment('head-turkestan-hospital','rollback-assignment-timely');
  PERFORM pg_temp.directive_assert(a->>'status'='accepted' AND a->>'actualCompletedDate'=(today-3)::text,'late verification preserves actual timely completion');
  result:=public.orion_regional_directive_attachment_v1('orion:local:directives','directive-admin',a->'attachments'->0->>'id');
  PERFORM pg_temp.directive_assert(result->>'contentBase64'='aGVsbG8=' AND result->'attachment'->>'byteLength'='5' AND
    result->'attachment'->>'sha256'='2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824','download matches original bytes and independently known SHA256');
  PERFORM pg_temp.directive_assert(NOT(a::text LIKE '%contentBase64%'),'snapshot contains metadata but no file bytes');
  BEGIN PERFORM public.orion_regional_directive_attachment_v1('orion:local:directives','head-sayram-hospital',a->'attachments'->0->>'id'); RAISE EXCEPTION 'CROSS_ATTACHMENT_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-timely',3,'{"type":"progress","progress":95}'); RAISE EXCEPTION 'ACCEPTED_PROGRESS_CHANGED'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
END $$;
DO $$ DECLARE today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date; a jsonb;
BEGIN
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-late',1,
    jsonb_build_object('type','submit','actualCompletedDate',today::text,'attachments',pg_temp.directive_file('report')));
  a:=pg_temp.directive_assignment('directive-admin','rollback-assignment-late');
  PERFORM pg_temp.directive_assert(a->>'explanationRequired'='true','late actual work requires explanatory letter');
  BEGIN PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-late',2,'{"type":"review","decision":"accept"}'); RAISE EXCEPTION 'LATE_ACCEPTED_WITHOUT_LETTER'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-late',2,
    jsonb_build_object('type','explain','message','Поставка материалов задержалась. Срок не переносим.','attachments',pg_temp.directive_file('explanation')));
  PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-late',3,'{"type":"review","decision":"accept"}');
  a:=pg_temp.directive_assignment('head-turkestan-hospital','rollback-assignment-late');
  PERFORM pg_temp.directive_assert(a->>'status'='accepted' AND a->>'actualCompletedDate'=today::text AND jsonb_array_length(a->'attachments')=2,'accepted late work retains late date and both immutable documents');
END $$;
DO $$ DECLARE today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date; a jsonb;
BEGIN
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-documents',1,
    jsonb_build_object('type','submit','actualCompletedDate',(today-3)::text,'attachments',pg_temp.directive_file('report')));
  PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-documents',2,'{"type":"review","decision":"return_documents","remark":"Добавьте подпись на отчёте."}');
  BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-documents',3,
    jsonb_build_object('type','submit','actualCompletedDate',(today-2)::text,'attachments',pg_temp.directive_file('report'))); RAISE EXCEPTION 'DOCUMENT_RETURN_CHANGED_DATE'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-documents',3,
    jsonb_build_object('type','submit','actualCompletedDate',(today-3)::text,'attachments',pg_temp.directive_file('report')));
  PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-documents',4,'{"type":"review","decision":"accept"}');
  a:=pg_temp.directive_assignment('directive-admin','rollback-assignment-documents');
  PERFORM pg_temp.directive_assert(a->>'actualCompletedDate'=(today-3)::text AND a->>'status'='accepted' AND jsonb_array_length(a->'history')=5,'document correction keeps original actual date and full revision history');
END $$;
DO $$ DECLARE today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date; a jsonb;
BEGIN
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-work',1,
    jsonb_build_object('type','submit','actualCompletedDate',(today-3)::text,'attachments',pg_temp.directive_file('report')));
  PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-work',2,'{"type":"review","decision":"return_work","remark":"Проверка склада фактически не завершена."}');
  a:=pg_temp.directive_assignment('directive-admin','rollback-assignment-work');
  PERFORM pg_temp.directive_assert(a->>'status'='returned_work' AND a->'actualCompletedDate'='null'::jsonb AND a->>'progress'='0','work return clears completion without erasing history');
  BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-work',3,
    jsonb_build_object('type','submit','actualCompletedDate',(today-3)::text,'attachments',pg_temp.directive_file('report'))); RAISE EXCEPTION 'REWORK_BACKDATED'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-work',3,
    jsonb_build_object('type','submit','actualCompletedDate',today::text,'attachments',pg_temp.directive_file('report')));
  BEGIN PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-work',4,'{"type":"review","decision":"accept"}'); RAISE EXCEPTION 'REWORK_WITHOUT_EXPLANATION'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-work',4,
    jsonb_build_object('type','explain','message','Работа завершена после замечания.','attachments',pg_temp.directive_file('explanation')));
  PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-work',5,'{"type":"review","decision":"accept"}');
  a:=pg_temp.directive_assignment('directive-admin','rollback-assignment-work');
  PERFORM pg_temp.directive_assert(a->>'actualCompletedDate'=today::text AND a->>'status'='accepted','same-day rework permitted but cannot conceal late completion');
END $$;
DO $$ DECLARE today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date; a jsonb; command jsonb; result jsonb; file jsonb; invalid jsonb;
BEGIN
  command:=jsonb_build_object('type','progress','assignmentId','rollback-assignment-permissions','expectedVersion',1,
    'idempotencyKey','d1000000-0000-4000-8000-000000000010','progress',85);
  result:=public.orion_regional_directive_command_v1('orion:local:directives','head-turkestan-hospital',command);
  PERFORM pg_temp.directive_assert(result->>'version'='2','head progress creates durable revision');
  result:=public.orion_regional_directive_command_v1('orion:local:directives','head-turkestan-hospital',command);
  PERFORM pg_temp.directive_assert(result->>'replayed'='true' AND result->>'version'='2','same request replays without another progress update');
  BEGIN PERFORM public.orion_regional_directive_command_v1('orion:local:directives','head-turkestan-hospital',command||'{"progress":99}'); RAISE EXCEPTION 'KEY_REUSED_WITH_DIFFERENT_PAYLOAD'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-permissions',1,'{"type":"progress","progress":99}'); RAISE EXCEPTION 'STALE_WRITE_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_directive_command_v1('orion:local:directives','head-sayram-hospital',command); RAISE EXCEPTION 'CROSS_ASSIGNMENT_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_directives_v1('orion:local:directives','head-sayram-hospital','{"facilityId":"turkestan-hospital"}'); RAISE EXCEPTION 'CROSS_SNAPSHOT_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM pg_temp.directive_command('directive-admin','rollback-assignment-permissions',2,'{"type":"progress","progress":99}'); RAISE EXCEPTION 'ADMIN_ACTED_AS_HEAD'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-files',1,jsonb_build_object('type','submit','actualCompletedDate',(today+1)::text,'attachments',pg_temp.directive_file('report'))); RAISE EXCEPTION 'FUTURE_COMPLETION_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
  BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-files',1,jsonb_build_object('type','submit','actualCompletedDate',today::text,'attachments','[]'::jsonb)); RAISE EXCEPTION 'REPORT_NOT_REQUIRED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
  file:=pg_temp.directive_file('report')->0;
  FOR invalid IN SELECT value FROM jsonb_array_elements(jsonb_build_array(
    file||'{"fileName":"../report.txt"}',file||'{"fileName":"report.html","mimeType":"text/html"}',
    file||'{"fileName":"con.txt"}',file||'{"fileName":"report:stream.txt"}',file||'{"fileName":".report.txt"}',
    file||jsonb_build_object('fileName','report'||chr(8238)||'.txt'),
    file||'{"fileName":"report.docx","mimeType":"application/vnd.openxmlformats-officedocument.wordprocessingml.document","contentBase64":"UEsDBA=="}',
    file||'{"contentBase64":"aGVsbG8B"}',
    file||'{"contentBase64":"aGVsbG8=\n"}',file||'{"contentBase64":"AAAAA"}',
    file||'{"fileName":"report.pdf","mimeType":"application/pdf"}',file||'{"sha256":"attacker-claim"}',
    file||jsonb_build_object('contentBase64',replace(encode(convert_to(repeat('a',2097153),'UTF8'),'base64'),E'\n','')))) LOOP
    BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-files',1,
      jsonb_build_object('type','submit','actualCompletedDate',today::text,'attachments',jsonb_build_array(invalid)));
      RAISE EXCEPTION 'INVALID_FILE_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
  END LOOP;
  BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-files',1,
    jsonb_build_object('type','submit','actualCompletedDate',today::text,'attachments',jsonb_build_array(file,file||'{"fileName":"REPORT.TXT","purpose":"supporting"}')));
    RAISE EXCEPTION 'DUPLICATE_FILE_NAMES_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL;
  END;
  a:=pg_temp.directive_assignment('head-turkestan-hospital','rollback-assignment-files');
  PERFORM pg_temp.directive_assert(a->>'version'='1' AND jsonb_array_length(a->'attachments')=0,'failed uploads leave no partial submission or files');
  BEGIN PERFORM public.orion_regional_directive_command_v1('orion:local:directives','head-turkestan-hospital',command||jsonb_build_object('dueDate',(today+10)::text)); RAISE EXCEPTION 'DEADLINE_FIELD_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT400' THEN NULL; END;
  UPDATE orion_region.directive_grants SET active=false WHERE user_id='head-turkestan-hospital';
  BEGIN PERFORM public.orion_regional_directive_command_v1('orion:local:directives','head-turkestan-hospital',command); RAISE EXCEPTION 'REVOKED_REPLAY_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  UPDATE orion_region.directive_grants SET active=true WHERE user_id='head-turkestan-hospital';
  UPDATE orion_directory.memberships SET interactive=false WHERE user_id='head-turkestan-hospital';
  BEGIN PERFORM public.orion_regional_directives_v1('orion:local:directives','head-turkestan-hospital','{}'); RAISE EXCEPTION 'NONINTERACTIVE_MEMBERSHIP_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  UPDATE orion_directory.memberships SET interactive=true WHERE user_id='head-turkestan-hospital';
END $$;
-- A generic platform administrator is not a directive reviewer.
INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source)
VALUES('directive-rollback-platform','orion:directive-rollback','platform-admin','Rollback administrator','active','postgres');
INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status)
VALUES('crm-clinic-local','directive-rollback-platform','directive-rollback-platform','active');
INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,status,effective_from)
VALUES('crm-clinic-local','directive-rollback-platform','directive-rollback-platform',ARRAY['administrator'],'active',clock_timestamp()-interval '1 day');
DO $$ DECLARE t text; BEGIN
  BEGIN PERFORM public.orion_regional_directives_v1('orion:directive-rollback','platform-admin','{}'); RAISE EXCEPTION 'PLATFORM_ADMIN_INHERITED_DIRECTIVES'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN PERFORM public.orion_regional_facility_v1('orion:local:directives','directive-admin','turkestan-hospital'); RAISE EXCEPTION 'DIRECTIVE_ADMIN_INHERITED_CLINICAL'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
  BEGIN UPDATE orion_region.directives SET due_date=due_date+1 WHERE id='rollback-timely'; RAISE EXCEPTION 'DEADLINE_MUTABLE'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN DELETE FROM orion_region.directive_attachments; RAISE EXCEPTION 'ATTACHMENTS_MUTABLE'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  BEGIN DELETE FROM orion_region.directive_events; RAISE EXCEPTION 'REVISION_HISTORY_MUTABLE'; EXCEPTION WHEN SQLSTATE 'PT409' THEN NULL; END;
  FOREACH t IN ARRAY ARRAY['directive_grants','directives','directive_assignments','directive_events','directive_attachments','directive_receipts'] LOOP
    PERFORM pg_temp.directive_assert(NOT has_table_privilege('orion_crm_app','orion_region.'||t,'SELECT,INSERT,UPDATE,DELETE'),'runtime has no direct table access: '||t);
  END LOOP;
  PERFORM pg_temp.directive_assert(NOT has_function_privilege('public','public.orion_regional_directives_v1(text,text,jsonb)','EXECUTE'),'snapshot not public');
  PERFORM pg_temp.directive_assert(NOT has_function_privilege('public','public.orion_regional_directive_command_v1(text,text,jsonb)','EXECUTE'),'command not public');
  PERFORM pg_temp.directive_assert(NOT has_function_privilege('public','public.orion_regional_directive_attachment_v1(text,text,text)','EXECUTE'),'attachment not public');
END $$;
-- Dedicated dual-role rollback grant demonstrates separation of reviewer/submitter.
INSERT INTO orion_region.directive_grants(id,user_id,role,clinic_id,membership_id,reason)
VALUES('directive-rollback-dual','head-turkestan-hospital','administrator','region-turkestan-hospital','directive-membership-turkestan-hospital','Rollback-only dual-role rejection');
DO $$ DECLARE today date:=(clock_timestamp() AT TIME ZONE 'Asia/Qyzylorda')::date; BEGIN
  PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-files',1,jsonb_build_object('type','submit','actualCompletedDate',today::text,'attachments',pg_temp.directive_file('report')));
  BEGIN PERFORM pg_temp.directive_command('head-turkestan-hospital','rollback-assignment-files',2,'{"type":"review","decision":"return_documents","remark":"Self review"}'); RAISE EXCEPTION 'SELF_REVIEW_ACCEPTED'; EXCEPTION WHEN SQLSTATE 'PT403' THEN NULL; END;
END $$;
SET LOCAL ROLE orion_crm_app;
SELECT public.orion_regional_directives_v1('orion:local:directives','directive-admin','{}') IS NOT NULL AS directive_runtime_rpc_ok;
RESET ROLE;
ROLLBACK;
