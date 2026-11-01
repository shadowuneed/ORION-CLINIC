-- Exact calendar selection + current referral-recipient authority.
-- Operation-specific permissions remain authoritative after directory cutover.
-- Forward-only: 0001/0002/0003 remain unchanged. CREATE OR REPLACE preserves the
-- existing public function OIDs and explicitly reapplies the same narrow grants.
BEGIN;
CREATE FUNCTION orion_clinical.has_current_permission(p_clinic text,p_practitioner text,p_permission text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path='' AS $$
  SELECT EXISTS(SELECT 1 FROM orion_clinical.practitioners p
    JOIN orion_crm.staff s ON s.clinic_id=p.clinic_id AND s.id=p.staff_id AND s.role='doctor'
    JOIN orion_crm.clinics c ON c.id=p.clinic_id AND c.active
    WHERE p.clinic_id=p_clinic AND p.id=p_practitioner AND p.active AND
    CASE WHEN (SELECT source FROM orion_directory.runtime WHERE id=1)='postgres' THEN EXISTS(
      SELECT 1 FROM orion_directory.current_assignments a WHERE a.clinic_id=p.clinic_id AND a.issuer=p.issuer AND a.subject=p.subject
      AND 'doctor'=ANY(a.roles) AND 'encounter.read'=ANY(a.permissions) AND 'encounter.manage'=ANY(a.permissions) AND p_permission=ANY(a.permissions))
    WHEN (SELECT source FROM orion_directory.runtime WHERE id=1)='legacy_d1' THEN EXISTS(SELECT 1 FROM orion_crm.actor_grants g WHERE g.clinic_id=p.clinic_id AND g.issuer=p.issuer AND g.subject=p.subject AND g.active AND g.can_read AND g.can_manage)
    ELSE false END)
$$;
REVOKE ALL ON FUNCTION orion_clinical.has_current_permission(text,text,text) FROM PUBLIC,orion_crm_app;
CREATE FUNCTION orion_clinical.is_current_recipient(p_clinic text,p_practitioner text) RETURNS boolean
LANGUAGE sql VOLATILE SET search_path='' AS $$
  SELECT orion_clinical.has_current_permission(p_clinic,p_practitioner,'encounter.manage')
$$;
REVOKE ALL ON FUNCTION orion_clinical.is_current_recipient(text,text) FROM PUBLIC,orion_crm_app;

CREATE OR REPLACE FUNCTION public.orion_clinical_snapshot_v1(p_issuer text,p_subject text,p_patient text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_clinical.practitioners:=orion_clinical.require_actor(p_issuer,p_subject); answer jsonb;
BEGIN
  IF p_patient IS NOT NULL AND NOT orion_clinical.can_read_patient(a.clinic_id,a.id,a.staff_id,p_patient) THEN
    RAISE EXCEPTION 'CLINICAL_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  WITH visible_patients AS (
    SELECT p.* FROM orion_crm.patients p WHERE p.clinic_id=a.clinic_id AND (p_patient IS NULL OR p.id=p_patient)
      AND orion_clinical.can_read_patient(a.clinic_id,a.id,a.staff_id,p.id)
  ), visible_notes AS (
    SELECT n.* FROM orion_clinical.note_versions n JOIN orion_clinical.encounters e ON e.clinic_id=n.clinic_id AND e.id=n.encounter_id
    WHERE n.clinic_id=a.clinic_id AND n.patient_id IN (SELECT id FROM visible_patients) AND
      ((e.practitioner_id=a.id AND n.id IN (e.current_note_id,e.published_note_id)) OR
       (n.status='published' AND (n.id=e.published_note_id AND EXISTS(SELECT 1 FROM orion_clinical.care_relationships r WHERE r.clinic_id=a.clinic_id AND r.patient_id=n.patient_id AND r.practitioner_id=a.id AND r.active)
         OR EXISTS(SELECT 1 FROM orion_clinical.referrals r WHERE r.clinic_id=a.clinic_id AND r.note_id=n.id AND r.recipient_practitioner_id=a.id AND r.status IN ('pending','accepted')))))
  ), visible_encounters AS (
    SELECT e.* FROM orion_clinical.encounters e WHERE e.clinic_id=a.clinic_id AND e.patient_id IN (SELECT id FROM visible_patients)
      AND (e.practitioner_id=a.id OR e.id IN (SELECT encounter_id FROM visible_notes))
  ), own_encounters AS (SELECT * FROM visible_encounters WHERE practitioner_id=a.id),
  consents AS (SELECT DISTINCT ON(c.encounter_id) c.* FROM orion_clinical.consent_events c JOIN own_encounters e ON e.id=c.encounter_id AND e.clinic_id=c.clinic_id ORDER BY c.encounter_id,c.version DESC)
  SELECT jsonb_build_object('schemaVersion',1,'clinicId',a.clinic_id,
    'practitioner',jsonb_build_object('id',a.id,'staffId',a.staff_id,'name',a.display_name,'specialty',a.specialty),
    'practitioners',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'staffId',p.staff_id,'name',p.display_name,'specialty',p.specialty) ORDER BY p.display_name),'[]') FROM orion_clinical.practitioners p JOIN orion_crm.staff s ON s.clinic_id=p.clinic_id AND s.id=p.staff_id AND s.role='doctor' WHERE p.clinic_id=a.clinic_id AND orion_clinical.is_current_recipient(p.clinic_id,p.id)),
    'patients',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',p.id,'name',p.name,'mrn',p.mrn,'sex',p.sex,'birthDate',(SELECT to_char(h.birth_date,'YYYY-MM-DD') FROM orion_crm.patient_registry_history h WHERE h.clinic_id=p.clinic_id AND h.patient_id=p.id ORDER BY h.version DESC LIMIT 1)) ORDER BY p.name),'[]') FROM visible_patients p),
    'encounters',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'patientId',e.patient_id,'practitionerId',e.practitioner_id,'visitId',e.visit_id,'referralId',e.referral_id,'status',e.status,'version',e.version,
      'currentNoteId',CASE WHEN e.practitioner_id=a.id THEN e.current_note_id ELSE e.published_note_id END,'publishedNoteId',e.published_note_id,'createdAt',orion_crm.iso(e.created_at),'updatedAt',orion_crm.iso(e.updated_at)) ORDER BY e.updated_at DESC),'[]') FROM visible_encounters e),
    'notes',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',n.id,'encounterId',n.encounter_id,'patientId',n.patient_id,'practitionerId',n.practitioner_id,'version',n.version,'content',n.content,'source',n.source,'status',n.status,'createdAt',orion_crm.iso(n.created_at),'publishedAt',CASE WHEN n.published_at IS NULL THEN NULL ELSE orion_crm.iso(n.published_at) END) ORDER BY n.created_at),'[]') FROM visible_notes n),
    'referrals',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',r.id,'patientId',r.patient_id,'encounterId',r.encounter_id,'sourcePractitionerId',r.source_practitioner_id,'recipientPractitionerId',r.recipient_practitioner_id,'noteId',r.note_id,'reason',r.reason,'priority',r.priority,'status',r.status,'version',r.version,'resultingEncounterId',r.resulting_encounter_id,'createdAt',orion_crm.iso(r.created_at),'updatedAt',orion_crm.iso(r.updated_at)) ORDER BY r.created_at DESC),'[]') FROM orion_clinical.referrals r WHERE r.clinic_id=a.clinic_id AND (r.source_practitioner_id=a.id OR r.recipient_practitioner_id=a.id) AND (p_patient IS NULL OR r.patient_id=p_patient)),
    'consents',(SELECT coalesce(jsonb_agg(jsonb_build_object('encounterId',c.encounter_id,'care',c.care,'transcriptStorage',c.transcript_storage,'localAudioProcessing',c.local_audio_processing,'externalAiProcessing',c.external_ai_processing,'version',c.version)),'[]') FROM consents c),
    'transcript',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',t.id,'encounterId',t.encounter_id,'sequence',t.sequence,'role',t.role,'language',t.language,'text',t.text,'startedAtMs',t.started_at_ms,'endedAtMs',t.ended_at_ms,'createdAt',orion_crm.iso(t.created_at)) ORDER BY t.encounter_id,t.sequence),'[]') FROM orion_clinical.transcript_segments t JOIN consents c ON c.encounter_id=t.encounter_id AND c.clinic_id=t.clinic_id AND c.transcript_storage WHERE p_patient IS NOT NULL),
    'generatedAt',orion_crm.iso(clock_timestamp())) INTO answer;
  IF octet_length(answer::text)>4194304 THEN RAISE EXCEPTION 'CLINICAL_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
  INSERT INTO orion_clinical.audit_events(clinic_id,practitioner_id,action,resource_id) VALUES(a.clinic_id,a.id,'snapshot.read',p_patient);
  RETURN answer;
END $$;

CREATE OR REPLACE FUNCTION public.orion_clinical_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_clinical.practitioners:=orion_clinical.require_actor(p_issuer,p_subject);
  kind text:=p_command->>'type'; key uuid; fingerprint text; receipt orion_clinical.command_receipts;
  e orion_clinical.encounters; n orion_clinical.note_versions; r orion_clinical.referrals; c orion_clinical.consent_events; visit_row orion_crm.visits; transition text;
  result jsonb; resource text; revision integer; enc_id text; patient text; visit text; next_note integer; permitted text[]; field text; mrn text;
BEGIN
  IF jsonb_typeof(p_command)<>'object' OR octet_length(p_command::text)>131072 THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  permitted:=CASE kind
    WHEN 'patient.register' THEN ARRAY['type','idempotencyKey','name','birthDate','sex']
    WHEN 'encounter.start' THEN ARRAY['type','idempotencyKey','patientId','visitId']
    WHEN 'note.save' THEN ARRAY['type','idempotencyKey','encounterId','expectedVersion','content','source']
    WHEN 'note.publish' THEN ARRAY['type','idempotencyKey','encounterId','expectedVersion','noteId','reviewAcknowledged']
    WHEN 'encounter.complete' THEN ARRAY['type','idempotencyKey','encounterId','expectedVersion']
    WHEN 'consent.record' THEN ARRAY['type','idempotencyKey','encounterId','expectedVersion','care','transcriptStorage','localAudioProcessing','externalAiProcessing','patientConfirmed']
    WHEN 'referral.create' THEN ARRAY['type','idempotencyKey','encounterId','expectedVersion','recipientPractitionerId','reason','priority','reviewAcknowledged']
    WHEN 'referral.accept' THEN ARRAY['type','idempotencyKey','referralId','expectedVersion']
    WHEN 'referral.decline' THEN ARRAY['type','idempotencyKey','referralId','expectedVersion','reason']
    WHEN 'referral.revoke' THEN ARRAY['type','idempotencyKey','referralId','expectedVersion','reason']
    WHEN 'transcript.append' THEN ARRAY['type','idempotencyKey','encounterId','sessionId','utteranceIndex','inputHash','text','role','language','startedAtMs','endedAtMs'] END;
  IF permitted IS NULL OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE NOT k=ANY(permitted)) OR
    EXISTS(SELECT 1 FROM unnest(permitted) k WHERE NOT p_command?k AND NOT(kind='encounter.start' AND k='visitId')) OR EXISTS(SELECT 1 FROM jsonb_each(p_command) j WHERE jsonb_typeof(j.value)='null' AND NOT(kind='patient.register' AND j.key='birthDate')) THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  IF p_command?'expectedVersion' AND (jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' OR
    (p_command->>'expectedVersion')!~'^[1-9][0-9]{0,9}$' OR (p_command->>'expectedVersion')::numeric>2147483647) THEN
    RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  FOREACH field IN ARRAY ARRAY['type','idempotencyKey','name','sex','patientId','visitId','encounterId','referralId','noteId','recipientPractitionerId','reason','priority','source','sessionId','inputHash','text','role','language'] LOOP
    IF p_command?field AND jsonb_typeof(p_command->field) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END LOOP;
  IF p_command?'visitId' AND (p_command->>'visitId')!~'^[a-zA-Z0-9_-]{1,160}$' THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  key:=(p_command->>'idempotencyKey')::uuid;
  fingerprint:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  -- Serializes start/resume, receipts and note publication per exact clinician;
  -- resource row locks below serialize actions by different clinicians.
  PERFORM pg_advisory_xact_lock(hashtextextended(a.clinic_id||':'||a.id,619071));
  SELECT * INTO receipt FROM orion_clinical.command_receipts WHERE clinic_id=a.clinic_id AND practitioner_id=a.id AND idempotency_key=key;
  IF FOUND THEN
    IF receipt.request_hash<>fingerprint THEN RAISE EXCEPTION 'CLINICAL_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
    RETURN receipt.result||jsonb_build_object('replayed',true);
  END IF;
  -- Same lock order as the booking/queue module: clinic, then visit. Avoids
  -- a cross-module row-lock inversion and preserves all capacity guards.
  IF kind IN ('patient.register','encounter.start','encounter.complete') THEN
    PERFORM 1 FROM orion_crm.clinics WHERE id=a.clinic_id AND active FOR UPDATE;
  END IF;
  IF kind='patient.register' THEN
    IF NOT orion_clinical.has_current_permission(a.clinic_id,a.id,'patient.profile.write') THEN RAISE EXCEPTION 'CLINICAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
    IF length(trim(p_command->>'name')) NOT BETWEEN 2 AND 160 OR p_command->>'sex' NOT IN ('female','male','unknown') OR
      (p_command->>'birthDate' IS NOT NULL AND ((p_command->>'birthDate')!~'^\d{4}-\d{2}-\d{2}$' OR (p_command->>'birthDate')::date<date '1900-01-01' OR (p_command->>'birthDate')::date>current_date)) THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    resource:='patient-'||gen_random_uuid(); mrn:='ORION-'||upper(substr(replace(gen_random_uuid()::text,'-',''),1,16));
    INSERT INTO orion_crm.patients(clinic_id,id,name,mrn,sex) VALUES(a.clinic_id,resource,trim(p_command->>'name'),mrn,p_command->>'sex');
    INSERT INTO orion_crm.patient_registry_history(clinic_id,patient_id,version,previous_version,name,mrn,sex,birth_date,source,batch_id,actor_grant_id,recorded_at,provenance)
      VALUES(a.clinic_id,resource,1,NULL,trim(p_command->>'name'),mrn,p_command->>'sex',(p_command->>'birthDate')::date,'clinician_registration','registration-'||key,
        (SELECT id FROM orion_crm.actor_grants WHERE clinic_id=a.clinic_id AND issuer=a.issuer AND subject=a.subject),clock_timestamp(),jsonb_build_object('entryMethod','clinician_manual_entry','practitionerId',a.id));
    INSERT INTO orion_clinical.care_relationships(clinic_id,patient_id,practitioner_id,source_kind) VALUES(a.clinic_id,resource,a.id,'registration');
    revision:=1;
  ELSIF kind='encounter.start' THEN
    patient:=p_command->>'patientId';
    -- An explicit calendar selection is an exact resource, never a hint. Check
    -- ownership/patient before exposing whether another encounter is active.
    IF p_command?'visitId' THEN
      SELECT v.id INTO visit FROM orion_crm.visits v WHERE v.clinic_id=a.clinic_id AND v.id=p_command->>'visitId'
        AND v.patient_id=patient AND v.staff_id=a.staff_id AND v.status IN ('scheduled','arrived','queued','called','in_service') FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'CLINICAL_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    END IF;
    SELECT * INTO e FROM orion_clinical.encounters WHERE clinic_id=a.clinic_id AND patient_id=patient AND practitioner_id=a.id AND status='in_progress' FOR UPDATE;
    IF FOUND AND p_command?'visitId' AND e.visit_id IS NOT NULL AND e.visit_id IS DISTINCT FROM visit THEN
      RAISE EXCEPTION 'CLINICAL_INVALID_TRANSITION' USING ERRCODE='PT409';
    END IF;
    IF p_command?'visitId' AND EXISTS(SELECT 1 FROM orion_clinical.encounters x WHERE x.clinic_id=a.clinic_id AND x.visit_id=visit AND x.id IS DISTINCT FROM e.id) THEN
      RAISE EXCEPTION 'CLINICAL_RESOURCE_NOT_FOUND' USING ERRCODE='PT404';
    END IF;
    IF e.id IS NULL THEN
      IF NOT p_command?'visitId' THEN
      SELECT v.id INTO visit FROM orion_crm.visits v WHERE v.clinic_id=a.clinic_id AND v.patient_id=patient AND v.staff_id=a.staff_id
        AND v.status IN ('scheduled','arrived','queued','called','in_service') AND NOT EXISTS(SELECT 1 FROM orion_clinical.encounters x WHERE x.clinic_id=a.clinic_id AND x.visit_id=v.id)
        ORDER BY v.scheduled_at LIMIT 1 FOR SHARE;
      END IF;
      IF visit IS NULL AND NOT EXISTS(SELECT 1 FROM orion_clinical.care_relationships WHERE clinic_id=a.clinic_id AND patient_id=patient AND practitioner_id=a.id AND active) THEN
        RAISE EXCEPTION 'CLINICAL_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
      INSERT INTO orion_clinical.encounters(clinic_id,id,patient_id,practitioner_id,visit_id,status)
        VALUES(a.clinic_id,'encounter-'||gen_random_uuid(),patient,a.id,visit,'in_progress') RETURNING * INTO e;
      INSERT INTO orion_clinical.care_relationships(clinic_id,patient_id,practitioner_id,source_encounter_id)
        VALUES(a.clinic_id,patient,a.id,e.id) ON CONFLICT(clinic_id,patient_id,practitioner_id) DO NOTHING;
    END IF;
    IF e.visit_id IS NULL THEN
      IF NOT p_command?'visitId' THEN
      SELECT v2.id INTO visit FROM orion_crm.visits v2 WHERE v2.clinic_id=a.clinic_id AND v2.patient_id=e.patient_id AND v2.staff_id=a.staff_id
        AND v2.status IN ('scheduled','arrived','queued','called','in_service') AND NOT EXISTS(SELECT 1 FROM orion_clinical.encounters x WHERE x.clinic_id=a.clinic_id AND x.visit_id=v2.id)
        ORDER BY v2.scheduled_at LIMIT 1;
      END IF;
      IF visit IS NOT NULL THEN UPDATE orion_clinical.encounters SET visit_id=visit WHERE clinic_id=a.clinic_id AND id=e.id RETURNING * INTO e; END IF;
    END IF;
    IF e.visit_id IS NOT NULL THEN
      LOOP
        SELECT * INTO STRICT visit_row FROM orion_crm.visits WHERE clinic_id=a.clinic_id AND id=e.visit_id;
        EXIT WHEN visit_row.status='in_service';
        IF NOT orion_clinical.has_current_permission(a.clinic_id,a.id,'scheduling.manage') THEN RAISE EXCEPTION 'CLINICAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
        transition:=CASE visit_row.status WHEN 'scheduled' THEN 'arrive' WHEN 'arrived' THEN 'queue' WHEN 'queued' THEN 'call' WHEN 'called' THEN 'start' END;
        IF transition IS NULL THEN RAISE EXCEPTION 'CLINICAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
        -- One explicit start action advances the operational stages atomically;
        -- it cannot jump another patient in the queue or occupy a busy room.
        PERFORM public.orion_crm_command_v1(a.issuer,a.subject,jsonb_build_object('type','visit.transition','visitId',visit_row.id,'expectedVersion',visit_row.version,'action',transition,'testDataAcknowledged',true,'idempotencyKey',gen_random_uuid()));
      END LOOP;
    END IF;
    resource:=e.id; enc_id:=e.id; revision:=e.version;
  ELSIF kind IN ('referral.accept','referral.decline','referral.revoke') THEN
    SELECT * INTO r FROM orion_clinical.referrals WHERE clinic_id=a.clinic_id AND id=p_command->>'referralId' AND
      (CASE WHEN kind='referral.revoke' THEN source_practitioner_id=a.id ELSE recipient_practitioner_id=a.id END) FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CLINICAL_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF r.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'CLINICAL_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF r.status<>'pending' THEN RAISE EXCEPTION 'CLINICAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    IF kind='referral.accept' THEN
      SELECT * INTO e FROM orion_clinical.encounters WHERE clinic_id=a.clinic_id AND patient_id=r.patient_id AND practitioner_id=a.id AND status='in_progress' FOR UPDATE;
      IF NOT FOUND THEN
        INSERT INTO orion_clinical.encounters(clinic_id,id,patient_id,practitioner_id,referral_id,status)
          VALUES(a.clinic_id,'encounter-'||gen_random_uuid(),r.patient_id,a.id,r.id,'in_progress') RETURNING * INTO e;
      END IF;
      INSERT INTO orion_clinical.care_relationships(clinic_id,patient_id,practitioner_id,source_encounter_id)
        VALUES(a.clinic_id,r.patient_id,a.id,e.id) ON CONFLICT(clinic_id,patient_id,practitioner_id) DO UPDATE SET active=true,ended_at=NULL,source_encounter_id=excluded.source_encounter_id,source_kind='encounter',started_at=clock_timestamp();
      UPDATE orion_clinical.referrals SET status='accepted',resulting_encounter_id=e.id,version=version+1,updated_at=clock_timestamp() WHERE clinic_id=a.clinic_id AND id=r.id RETURNING * INTO r;
      enc_id:=e.id;
    ELSE
      IF length(trim(p_command->>'reason')) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      UPDATE orion_clinical.referrals SET status=CASE WHEN kind='referral.decline' THEN 'declined' ELSE 'revoked' END,status_reason=p_command->>'reason',version=version+1,updated_at=clock_timestamp() WHERE clinic_id=a.clinic_id AND id=r.id RETURNING * INTO r;
    END IF;
    resource:=r.id; revision:=r.version;
  ELSE
    SELECT * INTO e FROM orion_clinical.encounters WHERE clinic_id=a.clinic_id AND id=p_command->>'encounterId' AND practitioner_id=a.id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'CLINICAL_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF kind<>'transcript.append' AND e.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'CLINICAL_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF e.status<>'in_progress' AND kind<>'referral.create' THEN RAISE EXCEPTION 'CLINICAL_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    SELECT * INTO c FROM orion_clinical.consent_events WHERE clinic_id=a.clinic_id AND encounter_id=e.id ORDER BY version DESC LIMIT 1;
    IF kind<>'consent.record' AND NOT coalesce(c.care,false) THEN RAISE EXCEPTION 'CLINICAL_CONSENT_REQUIRED' USING ERRCODE='PT409'; END IF;
    enc_id:=e.id;
    IF kind='consent.record' THEN
      IF p_command->'patientConfirmed'<>'true'::jsonb THEN RAISE EXCEPTION 'CLINICAL_CONSENT_REQUIRED' USING ERRCODE='PT409'; END IF;
      FOREACH field IN ARRAY ARRAY['care','transcriptStorage','localAudioProcessing','externalAiProcessing'] LOOP
        IF jsonb_typeof(p_command->field)<>'boolean' THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      END LOOP;
      INSERT INTO orion_clinical.consent_events(clinic_id,encounter_id,version,practitioner_id,care,transcript_storage,local_audio_processing,external_ai_processing,patient_confirmed)
        VALUES(a.clinic_id,e.id,coalesce(c.version,0)+1,a.id,(p_command->>'care')::boolean,(p_command->>'transcriptStorage')::boolean,(p_command->>'localAudioProcessing')::boolean,(p_command->>'externalAiProcessing')::boolean,true);
      resource:=e.id;
    ELSIF kind='note.save' THEN
      IF jsonb_typeof(p_command->'content')<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_command->'content'))<>5 OR p_command->>'source' NOT IN ('clinician','ai_assisted') THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      FOREACH field IN ARRAY ARRAY['complaints','history','examination','assessment','plan'] LOOP
        IF jsonb_typeof(p_command->'content'->field) IS DISTINCT FROM 'string' OR length(p_command->'content'->>field)>20000 THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      END LOOP;
      SELECT coalesce(max(version),0)+1 INTO next_note FROM orion_clinical.note_versions WHERE clinic_id=a.clinic_id AND encounter_id=e.id;
      resource:='note-'||gen_random_uuid();
      INSERT INTO orion_clinical.note_versions(clinic_id,id,encounter_id,patient_id,practitioner_id,version,content,source,status)
        VALUES(a.clinic_id,resource,e.id,e.patient_id,a.id,next_note,p_command->'content',p_command->>'source','draft');
      UPDATE orion_clinical.encounters SET current_note_id=resource WHERE clinic_id=a.clinic_id AND id=e.id;
    ELSIF kind='note.publish' THEN
      IF p_command->'reviewAcknowledged'<>'true'::jsonb OR e.current_note_id IS DISTINCT FROM p_command->>'noteId' THEN RAISE EXCEPTION 'CLINICAL_REVIEW_REQUIRED' USING ERRCODE='PT409'; END IF;
      SELECT * INTO n FROM orion_clinical.note_versions WHERE clinic_id=a.clinic_id AND id=e.current_note_id AND status='draft';
      IF NOT FOUND OR NOT EXISTS(SELECT 1 FROM jsonb_each_text(n.content) v WHERE length(trim(v.value))>0) THEN RAISE EXCEPTION 'CLINICAL_REVIEW_REQUIRED' USING ERRCODE='PT409'; END IF;
      resource:='note-'||gen_random_uuid();
      INSERT INTO orion_clinical.note_versions(clinic_id,id,encounter_id,patient_id,practitioner_id,version,content,source,status,reviewed_draft_id,published_at)
        VALUES(a.clinic_id,resource,e.id,e.patient_id,a.id,n.version+1,n.content,n.source,'published',n.id,clock_timestamp());
      UPDATE orion_clinical.encounters SET current_note_id=resource,published_note_id=resource WHERE clinic_id=a.clinic_id AND id=e.id;
    ELSIF kind='encounter.complete' THEN
      IF e.published_note_id IS NULL OR e.current_note_id IS DISTINCT FROM e.published_note_id THEN RAISE EXCEPTION 'CLINICAL_REVIEW_REQUIRED' USING ERRCODE='PT409'; END IF;
      UPDATE orion_clinical.encounters SET status='completed' WHERE clinic_id=a.clinic_id AND id=e.id; resource:=e.id;
      IF e.visit_id IS NOT NULL THEN
        SELECT * INTO STRICT visit_row FROM orion_crm.visits WHERE clinic_id=a.clinic_id AND id=e.visit_id;
        IF visit_row.status='in_service' AND NOT orion_clinical.has_current_permission(a.clinic_id,a.id,'scheduling.manage') THEN RAISE EXCEPTION 'CLINICAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
        IF visit_row.status='in_service' THEN PERFORM public.orion_crm_command_v1(a.issuer,a.subject,jsonb_build_object('type','visit.transition','visitId',visit_row.id,'expectedVersion',visit_row.version,'action','complete','testDataAcknowledged',true,'idempotencyKey',gen_random_uuid())); END IF;
      END IF;
    ELSIF kind='referral.create' THEN
      IF e.published_note_id IS NULL OR e.current_note_id IS DISTINCT FROM e.published_note_id OR p_command->'reviewAcknowledged'<>'true'::jsonb THEN RAISE EXCEPTION 'CLINICAL_REVIEW_REQUIRED' USING ERRCODE='PT409'; END IF;
      IF length(trim(p_command->>'reason')) NOT BETWEEN 1 AND 4000 OR p_command->>'priority' NOT IN ('routine','urgent') OR p_command->>'recipientPractitionerId'=a.id THEN RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      PERFORM 1 FROM orion_clinical.practitioners p JOIN orion_crm.staff s ON s.clinic_id=p.clinic_id AND s.id=p.staff_id AND s.role='doctor'
        WHERE p.clinic_id=a.clinic_id AND p.id=p_command->>'recipientPractitionerId' AND p.active FOR SHARE OF p,s;
      -- Recheck after recipient row-lock wait: an expired assignment must not
      -- receive new clinical material even when its cached mapping is active.
      IF NOT orion_clinical.is_current_recipient(a.clinic_id,p_command->>'recipientPractitionerId') THEN RAISE EXCEPTION 'CLINICAL_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
      IF NOT FOUND THEN RAISE EXCEPTION 'CLINICAL_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
      resource:='referral-'||gen_random_uuid();
      INSERT INTO orion_clinical.referrals(clinic_id,id,patient_id,encounter_id,source_practitioner_id,recipient_practitioner_id,note_id,reason,priority,status)
        VALUES(a.clinic_id,resource,e.patient_id,e.id,a.id,p_command->>'recipientPractitionerId',e.published_note_id,p_command->>'reason',p_command->>'priority','pending');
    ELSIF kind='transcript.append' THEN
      IF NOT coalesce(c.transcript_storage AND c.local_audio_processing,false) THEN RAISE EXCEPTION 'CLINICAL_CONSENT_REQUIRED' USING ERRCODE='PT409'; END IF;
      IF EXISTS(SELECT 1 FROM orion_clinical.transcript_segments WHERE clinic_id=a.clinic_id AND encounter_id=e.id AND session_id=(p_command->>'sessionId')::uuid AND utterance_index=(p_command->>'utteranceIndex')::integer) THEN RAISE EXCEPTION 'CLINICAL_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF;
      SELECT coalesce(max(sequence),0)+1 INTO revision FROM orion_clinical.transcript_segments WHERE clinic_id=a.clinic_id AND encounter_id=e.id;
      IF revision>4000 THEN RAISE EXCEPTION 'CLINICAL_SNAPSHOT_LIMIT' USING ERRCODE='PT503'; END IF;
      resource:='segment-'||gen_random_uuid();
      INSERT INTO orion_clinical.transcript_segments(clinic_id,id,encounter_id,sequence,session_id,utterance_index,input_hash,text,role,language,started_at_ms,ended_at_ms)
        VALUES(a.clinic_id,resource,e.id,revision,(p_command->>'sessionId')::uuid,(p_command->>'utteranceIndex')::integer,p_command->>'inputHash',p_command->>'text',p_command->>'role',p_command->>'language',(p_command->>'startedAtMs')::integer,(p_command->>'endedAtMs')::integer);
    END IF;
    IF kind<>'transcript.append' THEN
      UPDATE orion_clinical.encounters SET version=version+1,updated_at=clock_timestamp() WHERE clinic_id=a.clinic_id AND id=e.id RETURNING version INTO revision;
    END IF;
  END IF;
  result:=jsonb_build_object('resourceId',resource,'encounterId',enc_id,'version',revision,'replayed',false);
  INSERT INTO orion_clinical.audit_events(clinic_id,practitioner_id,action,resource_id,resource_version,command_key,request_hash) VALUES(a.clinic_id,a.id,kind,resource,revision,key,fingerprint);
  INSERT INTO orion_clinical.command_receipts(clinic_id,practitioner_id,idempotency_key,request_hash,result) VALUES(a.clinic_id,a.id,key,fingerprint,result);
  RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation OR invalid_datetime_format OR datetime_field_overflow THEN
  RAISE EXCEPTION 'CLINICAL_INVALID_COMMAND' USING ERRCODE='PT400';
WHEN SQLSTATE 'PT409' THEN
  IF SQLERRM='CRM_CAPACITY_CONFLICT' THEN RAISE EXCEPTION 'CLINICAL_CAPACITY_CONFLICT' USING ERRCODE='PT409';
  ELSIF SQLERRM='CRM_QUEUE_ORDER_CONFLICT' THEN RAISE EXCEPTION 'CLINICAL_QUEUE_ORDER_CONFLICT' USING ERRCODE='PT409';
  ELSE RAISE; END IF;
END $$;
REVOKE ALL ON FUNCTION public.orion_clinical_snapshot_v1(text,text,text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.orion_clinical_command_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_clinical_snapshot_v1(text,text,text),public.orion_clinical_command_v1(text,text,jsonb) TO orion_crm_app;
CREATE OR REPLACE FUNCTION public.orion_clinical_crm_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_clinical.practitioners:=orion_clinical.require_actor(p_issuer,p_subject); kind text:=p_command->>'type'; patient text;
BEGIN
  PERFORM 1 FROM orion_crm.clinics WHERE id=a.clinic_id AND active FOR UPDATE;
  -- Every write needs the operation's permission on one current doctor
  -- assignment. A separate role must not reconstruct denied permissions.
  IF kind IN ('visit.create','visit.transition','visit.reschedule') AND NOT orion_clinical.has_current_permission(a.clinic_id,a.id,'scheduling.manage') THEN
    RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='PT403';
  ELSIF kind IN ('task.create','task.transition') AND NOT orion_clinical.has_current_permission(a.clinic_id,a.id,'care.manage') THEN
    RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='PT403';
  END IF;
  IF kind='visit.create' THEN
    IF p_command->>'staffId' IS DISTINCT FROM a.staff_id OR NOT orion_clinical.can_read_patient(a.clinic_id,a.id,a.staff_id,p_command->>'patientId') THEN RAISE EXCEPTION 'CRM_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  ELSIF kind IN ('visit.transition','visit.reschedule','task.create') THEN
    SELECT v.patient_id INTO patient FROM orion_crm.visits v WHERE v.clinic_id=a.clinic_id AND v.id=p_command->>'visitId' AND v.staff_id=a.staff_id FOR SHARE;
    IF NOT FOUND OR (kind='task.create' AND p_command->>'ownerId' IS DISTINCT FROM a.staff_id) THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF kind='visit.transition' AND (p_command->>'action' IN ('start','complete') OR
      (p_command->>'action' IN ('requeue','cancel','mark_no_show') AND EXISTS(
        SELECT 1 FROM orion_clinical.encounters e WHERE e.clinic_id=a.clinic_id AND e.visit_id=p_command->>'visitId' AND e.status='in_progress'))) THEN
      RAISE EXCEPTION 'CRM_CLINICAL_WORKFLOW_REQUIRED' USING ERRCODE='PT409';
    END IF;
  ELSIF kind='task.transition' THEN
    PERFORM 1 FROM orion_crm.tasks t JOIN orion_crm.visits v ON v.clinic_id=t.clinic_id AND v.id=t.visit_id WHERE t.clinic_id=a.clinic_id AND t.id=p_command->>'taskId' AND t.owner_id=a.staff_id AND v.staff_id=a.staff_id FOR SHARE OF t,v;
    IF NOT FOUND THEN RAISE EXCEPTION 'CRM_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
  ELSE RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  RETURN public.orion_crm_command_v1(p_issuer,p_subject,p_command);
END $$;
REVOKE ALL ON FUNCTION public.orion_clinical_crm_command_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_clinical_crm_command_v1(text,text,jsonb) TO orion_crm_app;
COMMIT;
