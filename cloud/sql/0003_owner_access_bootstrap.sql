-- OPERATOR TEMPLATE ONLY. Never run automatically during signup/signin/build.
-- The owner must explicitly approve the particular confirmed Supabase Auth
-- UUID and email. No owner identity or credentials are stored in this file.
-- Run as migration owner after 0001 + 0002, replacing BOTH placeholder strings
-- using safely quoted SQL parameters. An unchanged template fails closed.
-- This creates ONE fresh cloud scope; it does not import any local records.
BEGIN;
SELECT set_config('orion.bootstrap_owner_subject','__CONFIRMED_OWNER_AUTH_UUID__',true);
SELECT set_config('orion.bootstrap_owner_email','__CONFIRMED_OWNER_AUTH_EMAIL__',true);

DO $bootstrap$
DECLARE
  owner_subject uuid := current_setting('orion.bootstrap_owner_subject')::uuid;
  owner_email text := lower(btrim(current_setting('orion.bootstrap_owner_email')));
  owner_auth record;
  observed bigint := orion_private.now_ms();
  scope jsonb;
BEGIN
  IF owner_email='' OR owner_email='__confirmed_owner_auth_email__' THEN RAISE EXCEPTION 'explicit owner email is required'; END IF;
  SELECT u.* INTO owner_auth FROM auth.users u WHERE u.id=owner_subject
    AND lower(u.email)=owner_email
    AND coalesce(to_jsonb(u)->>'is_anonymous','false')='false'
    AND to_jsonb(u)->>'email_confirmed_at' IS NOT NULL
    AND to_jsonb(u)->>'deleted_at' IS NULL
    AND (to_jsonb(u)->>'banned_until' IS NULL OR (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp())
    FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'confirmed, nonanonymous exact owner identity required'; END IF;
  IF EXISTS(SELECT 1 FROM orion_private.users WHERE external_issuer='https://bctyswbqjgpmtsanrfhp.supabase.co/auth/v1' AND external_subject=owner_subject::text)
    OR EXISTS(SELECT 1 FROM orion_private.organizations WHERE id='org-orion-cloud') THEN
    RAISE EXCEPTION 'bootstrap already initialized; use reviewed access governance, not bootstrap again';
  END IF;

  INSERT INTO orion_private.organizations VALUES('org-orion-cloud','ORION Cloud','active',observed,observed,1);
  INSERT INTO orion_private.facilities VALUES('fac-orion-cloud','org-orion-cloud','ORION Clinic','Asia/Almaty','active',observed,observed,1);
  INSERT INTO orion_private.users VALUES('staff-cloud-owner','https://bctyswbqjgpmtsanrfhp.supabase.co/auth/v1',owner_subject::text,owner_email,'Владелец ORION','active',observed,observed,1);
  INSERT INTO orion_private.memberships VALUES('member-cloud-owner','org-orion-cloud','fac-orion-cloud','staff-cloud-owner','clinician','active',observed,observed,1);
  INSERT INTO orion_private.departments VALUES('dept-orion-cloud-medicine','org-orion-cloud','fac-orion-cloud','general-medicine','Общая медицина','clinical','active',observed,observed,1);
  INSERT INTO orion_private.department_versions VALUES('dept-orion-cloud-medicine-v1','org-orion-cloud','fac-orion-cloud','dept-orion-cloud-medicine',1,NULL,'Общая медицина','clinical','active','Подтверждённая настройка отдельного облачного проекта','member-cloud-owner',observed,observed);
  INSERT INTO orion_private.department_heads VALUES('dept-orion-cloud-medicine-head','org-orion-cloud','fac-orion-cloud','dept-orion-cloud-medicine','dept-orion-cloud-medicine-v1',1,observed,observed);
  INSERT INTO orion_private.department_access_assignments VALUES('access-assignment-owner-general-medicine','org-orion-cloud','fac-orion-cloud','dept-orion-cloud-medicine','member-cloud-owner','member-cloud-owner',observed);
  INSERT INTO orion_private.department_access_assignment_versions VALUES('access-assignment-owner-general-medicine-v1','org-orion-cloud','fac-orion-cloud','access-assignment-owner-general-medicine','dept-orion-cloud-medicine','member-cloud-owner',1,NULL,'active','bootstrap','["doctor","administrator"]','[]','[]',observed,NULL,'Владелец явно подтвердил облачный доступ','member-cloud-owner',observed,observed);
  INSERT INTO orion_private.department_access_assignment_heads VALUES('access-assignment-owner-general-medicine-head','org-orion-cloud','fac-orion-cloud','access-assignment-owner-general-medicine','dept-orion-cloud-medicine','member-cloud-owner','access-assignment-owner-general-medicine-v1',1,observed,observed);

  SELECT a INTO scope FROM orion_private.own_assignments('staff-cloud-owner') a WHERE a->>'assignmentId'='access-assignment-owner-general-medicine';
  IF scope IS NULL THEN RAISE EXCEPTION 'bootstrap access failed to resolve'; END IF;
  PERFORM orion_private.append_audit(scope,'access.owner.bootstrap','access-assignment-owner-general-medicine',jsonb_build_object('assignmentVersion',1,'roles','["doctor","administrator"]'::jsonb,'source','operator-confirmed-bootstrap'));
END $bootstrap$;
COMMIT;

-- Non-sensitive acceptance proof only; no Auth email/subject/token returned.
SELECT o.id AS organization_id,f.id AS facility_id,a.id AS assignment_id,
  v.version AS assignment_version,v.roles_json AS roles,h.last_sequence AS audit_sequence
FROM orion_private.organizations o JOIN orion_private.facilities f ON f.organization_id=o.id
JOIN orion_private.department_access_assignments a ON a.organization_id=o.id AND a.facility_id=f.id
JOIN orion_private.department_access_assignment_heads ah ON ah.organization_id=a.organization_id AND ah.facility_id=a.facility_id AND ah.assignment_id=a.id
JOIN orion_private.department_access_assignment_versions v ON v.organization_id=ah.organization_id AND v.facility_id=ah.facility_id AND v.assignment_id=ah.assignment_id AND v.id=ah.current_version_id
JOIN orion_private.audit_stream_heads h ON h.organization_id=o.id AND h.facility_id=f.id
WHERE o.id='org-orion-cloud' AND a.id='access-assignment-owner-general-medicine';
