-- Forward-only integration: CRM transitions cannot bypass the clinical workflow.
-- Patient demographics and encounter status share the canonical PostgreSQL rows.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CLINICAL_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
CREATE OR REPLACE FUNCTION public.orion_clinical_crm_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_clinical.practitioners:=orion_clinical.require_actor(p_issuer,p_subject); kind text:=p_command->>'type'; patient text;
BEGIN
  PERFORM 1 FROM orion_crm.clinics WHERE id=a.clinic_id AND active FOR UPDATE;
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

CREATE OR REPLACE FUNCTION public.orion_clinical_crm_snapshot_v1(p_issuer text,p_subject text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE a orion_clinical.practitioners:=orion_clinical.require_actor(p_issuer,p_subject); answer jsonb; visits jsonb; tasks jsonb; patients jsonb; events jsonb; staff jsonb;
BEGIN
  answer:=public.orion_crm_snapshot_v1(p_issuer,p_subject);
  SELECT coalesce(jsonb_agg(v),'[]') INTO visits FROM jsonb_array_elements(answer->'visits') v WHERE v->>'staffId'=a.staff_id;
  SELECT coalesce(jsonb_agg(t),'[]') INTO tasks FROM jsonb_array_elements(answer->'tasks') t WHERE t->>'ownerId'=a.staff_id AND EXISTS(SELECT 1 FROM jsonb_array_elements(visits) v WHERE v->>'id'=t->>'visitId');
  SELECT coalesce(jsonb_agg((p-'birthDate')||jsonb_strip_nulls(jsonb_build_object('birthDate',(
      SELECT to_char(h.birth_date,'YYYY-MM-DD') FROM orion_crm.patient_registry_history h
      WHERE h.clinic_id=a.clinic_id AND h.patient_id=p->>'id' ORDER BY h.version DESC LIMIT 1)))),'[]')
    INTO patients FROM jsonb_array_elements(answer->'patients') p WHERE orion_clinical.can_read_patient(a.clinic_id,a.id,a.staff_id,p->>'id');
  SELECT coalesce(jsonb_agg(e),'[]') INTO events FROM jsonb_array_elements(answer->'events') e WHERE EXISTS(SELECT 1 FROM jsonb_array_elements(visits) v WHERE v->>'id'=e->>'resourceId') OR EXISTS(SELECT 1 FROM jsonb_array_elements(tasks) t WHERE t->>'id'=e->>'resourceId');
  SELECT coalesce(jsonb_agg(CASE WHEN p.id IS NULL THEN s ELSE s||jsonb_build_object('name',p.display_name) END),'[]') INTO staff FROM jsonb_array_elements(answer->'staff') s LEFT JOIN orion_clinical.practitioners p ON p.clinic_id=a.clinic_id AND p.staff_id=s->>'id' AND p.active;
  RETURN answer||jsonb_build_object('visits',visits,'tasks',tasks,'patients',patients,'events',events,'staff',staff,'capabilities',(answer->'capabilities')||jsonb_build_object('staffId',a.staff_id));
END $$;
REVOKE ALL ON FUNCTION public.orion_clinical_crm_snapshot_v1(text,text),public.orion_clinical_crm_command_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_clinical_crm_snapshot_v1(text,text),public.orion_clinical_crm_command_v1(text,text,jsonb) TO orion_crm_app;
COMMIT;
