-- Additive directory schema. Starts inactive; explicit exact-scope import,
-- global consistency checks and a fail-closed one-way cutover are required.
-- Passwords/sessions remain in the private PC credential store, not these tables.
BEGIN;
DO $$ BEGIN IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CLINICAL_TARGET_DATABASE_REQUIRED'; END IF; END $$;
CREATE SCHEMA orion_directory;
REVOKE ALL ON SCHEMA orion_directory FROM PUBLIC,orion_crm_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_directory REVOKE ALL ON TABLES FROM PUBLIC;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_directory REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
CREATE TABLE orion_directory.runtime (
  id integer PRIMARY KEY CHECK(id=1), source text NOT NULL CHECK(source IN ('legacy_d1','postgres')),
  revision integer NOT NULL CHECK(revision>0), import_complete boolean NOT NULL DEFAULT false, activated_at timestamptz,
  CHECK((source='postgres')=(activated_at IS NOT NULL)), CHECK(source<>'postgres' OR import_complete)
);
INSERT INTO orion_directory.runtime VALUES(1,'legacy_d1',1,false,NULL);
CREATE TABLE orion_directory.scope_maps (
  source_organization_id text NOT NULL, source_facility_id text NOT NULL, clinic_id text NOT NULL REFERENCES orion_crm.clinics(id),
  source_snapshot_hash text NOT NULL CHECK(source_snapshot_hash~'^[a-f0-9]{64}$'), imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(source_organization_id,source_facility_id), UNIQUE(clinic_id)
);
CREATE TABLE orion_directory.accounts (
  id text PRIMARY KEY, issuer text NOT NULL CHECK(length(issuer) BETWEEN 1 AND 256), subject text NOT NULL CHECK(length(subject) BETWEEN 1 AND 256),
  display_name text NOT NULL CHECK(length(display_name) BETWEEN 1 AND 160), status text NOT NULL CHECK(status IN ('active','disabled')),
  version integer NOT NULL DEFAULT 1 CHECK(version>0), source text NOT NULL CHECK(source IN ('legacy_d1','postgres')),
  legacy_user_id text UNIQUE, source_hash text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(issuer,subject), CHECK((source='legacy_d1' AND legacy_user_id IS NOT NULL AND source_hash IS NOT NULL) OR (source='postgres' AND legacy_user_id IS NULL AND source_hash IS NULL)),
  CHECK(source_hash IS NULL OR source_hash~'^[a-f0-9]{64}$')
);
CREATE TABLE orion_directory.memberships (
  clinic_id text NOT NULL REFERENCES orion_crm.clinics(id), id text NOT NULL, user_id text NOT NULL REFERENCES orion_directory.accounts(id),
  status text NOT NULL CHECK(status IN ('active','disabled')), version integer NOT NULL DEFAULT 1 CHECK(version>0), interactive boolean NOT NULL DEFAULT true,
  source_membership_id text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(clinic_id,id), UNIQUE(clinic_id,user_id), UNIQUE(clinic_id,source_membership_id)
);
CREATE FUNCTION orion_directory.known_roles() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT ARRAY['doctor','nurse','registrar','administrator','medical_lead','auditor','service']::text[]
$$;
CREATE FUNCTION orion_directory.known_permissions() RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  SELECT ARRAY['clinic.dashboard.read','patient.directory.read','patient.profile.write','encounter.read','encounter.manage','orders.manage',
    'scheduling.manage','care.manage','observations.manage','communications.manage','access.self.read','access.manage','audit.read','clinical_policy.review','service.integration.execute']::text[]
$$;
CREATE FUNCTION orion_directory.effective_permissions(p_roles text[],p_allow text[],p_deny text[]) RETURNS text[] LANGUAGE sql IMMUTABLE SET search_path='' AS $$
  WITH baseline(role,permissions) AS (VALUES
    ('doctor',ARRAY['clinic.dashboard.read','patient.directory.read','patient.profile.write','encounter.read','encounter.manage','orders.manage','scheduling.manage','care.manage','observations.manage','communications.manage','access.self.read']),
    ('nurse',ARRAY['clinic.dashboard.read','patient.directory.read','encounter.read','care.manage','observations.manage','communications.manage','access.self.read']),
    ('registrar',ARRAY['clinic.dashboard.read','patient.directory.read','patient.profile.write','scheduling.manage','communications.manage','access.self.read']),
    ('administrator',ARRAY['access.self.read','access.manage','audit.read']),
    ('medical_lead',ARRAY['clinic.dashboard.read','patient.directory.read','encounter.read','access.self.read','audit.read','clinical_policy.review']),
    ('auditor',ARRAY['access.self.read','audit.read']),('service',ARRAY['service.integration.execute']))
  SELECT coalesce(array_agg(p.permission ORDER BY p.ordinality),'{}'::text[]) FROM unnest(orion_directory.known_permissions()) WITH ORDINALITY p(permission,ordinality)
    WHERE NOT p.permission=ANY(p_deny) AND (p.permission=ANY(p_allow) OR EXISTS(SELECT 1 FROM baseline b WHERE b.role=ANY(p_roles) AND p.permission=ANY(b.permissions)))
$$;
CREATE TABLE orion_directory.assignments (
  clinic_id text NOT NULL, id text NOT NULL, membership_id text NOT NULL, source_assignment_id text,
  roles text[] NOT NULL CHECK(cardinality(roles)>0 AND roles<@orion_directory.known_roles()),
  allow_permissions text[] NOT NULL DEFAULT '{}' CHECK(allow_permissions<@orion_directory.known_permissions()),
  deny_permissions text[] NOT NULL DEFAULT '{}' CHECK(deny_permissions<@orion_directory.known_permissions()),
  status text NOT NULL CHECK(status IN ('active','revoked')), version integer NOT NULL DEFAULT 1 CHECK(version>0),
  effective_from timestamptz NOT NULL, effective_until timestamptz, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(clinic_id,id), FOREIGN KEY(clinic_id,membership_id) REFERENCES orion_directory.memberships(clinic_id,id),
  CHECK(NOT allow_permissions&&deny_permissions), CHECK(NOT 'service'=ANY(roles) OR cardinality(roles)=1),
  CHECK(effective_until IS NULL OR effective_until>effective_from)
);
CREATE INDEX directory_assignments_active ON orion_directory.assignments(clinic_id,membership_id,status);
CREATE TABLE orion_directory.audit_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, clinic_id text NOT NULL REFERENCES orion_crm.clinics(id), actor_user_id text REFERENCES orion_directory.accounts(id),
  action text NOT NULL, resource_id text NOT NULL, before_state jsonb, after_state jsonb NOT NULL, reason text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE orion_directory.command_receipts (
  clinic_id text NOT NULL, actor_user_id text NOT NULL, idempotency_key uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash~'^[a-f0-9]{64}$'), result jsonb NOT NULL,
  PRIMARY KEY(clinic_id,actor_user_id,idempotency_key), FOREIGN KEY(actor_user_id) REFERENCES orion_directory.accounts(id)
);
CREATE FUNCTION orion_directory.mode_guard() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN
  IF TG_OP='DELETE' OR OLD.source='postgres' AND NEW.source<>'postgres' OR NEW.revision<>OLD.revision+1 THEN RAISE EXCEPTION 'DIRECTORY_DOWNGRADE_FORBIDDEN' USING ERRCODE='PT409'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER directory_mode_guard BEFORE UPDATE OR DELETE ON orion_directory.runtime FOR EACH ROW EXECUTE FUNCTION orion_directory.mode_guard();
DO $$ DECLARE t text; BEGIN
  FOREACH t IN ARRAY ARRAY['runtime','scope_maps','accounts','memberships','assignments','audit_events','command_receipts'] LOOP EXECUTE format('ALTER TABLE orion_directory.%I ENABLE ROW LEVEL SECURITY',t); END LOOP;
  FOREACH t IN ARRAY ARRAY['scope_maps','audit_events','command_receipts'] LOOP EXECUTE format('CREATE TRIGGER immutable_history BEFORE UPDATE OR DELETE ON orion_directory.%I FOR EACH ROW EXECUTE FUNCTION orion_clinical.reject_history_change()',t); END LOOP;
END $$;
CREATE VIEW orion_directory.current_assignments AS
  SELECT a.*,m.user_id,u.issuer,u.subject,u.display_name,orion_directory.effective_permissions(a.roles,a.allow_permissions,a.deny_permissions) AS permissions
    FROM orion_directory.assignments a JOIN orion_directory.memberships m ON m.clinic_id=a.clinic_id AND m.id=a.membership_id AND m.status='active' AND m.interactive
    JOIN orion_directory.accounts u ON u.id=m.user_id AND u.status='active'
    JOIN orion_crm.clinics c ON c.id=a.clinic_id AND c.active
    WHERE a.status='active' AND a.effective_from<=clock_timestamp() AND (a.effective_until IS NULL OR a.effective_until>clock_timestamp());
CREATE FUNCTION public.orion_directory_mode_v1() RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
  SELECT jsonb_build_object('source',source,'revision',revision,'importComplete',import_complete) FROM orion_directory.runtime WHERE id=1
$$;
CREATE FUNCTION public.orion_directory_principals_v1() RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM orion_directory.runtime WHERE id=1 AND source='postgres' AND import_complete) THEN RAISE EXCEPTION 'DIRECTORY_NOT_ACTIVE' USING ERRCODE='PT503'; END IF;
  RETURN (SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'issuer',u.issuer,'subject',u.subject,'name',u.display_name) ORDER BY u.id),'[]')
    FROM orion_directory.accounts u WHERE u.status='active' AND EXISTS(SELECT 1 FROM orion_directory.memberships m JOIN orion_crm.clinics c ON c.id=m.clinic_id AND c.active WHERE m.user_id=u.id AND m.status='active' AND m.interactive));
END $$;
CREATE FUNCTION orion_directory.require_admin(p_issuer text,p_subject text,p_clinic text) RETURNS text LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE actor text;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM orion_directory.runtime WHERE id=1 AND source='postgres' AND import_complete) THEN RAISE EXCEPTION 'DIRECTORY_NOT_ACTIVE' USING ERRCODE='PT503'; END IF;
  SELECT user_id INTO actor FROM orion_directory.current_assignments WHERE clinic_id=p_clinic AND issuer=p_issuer AND subject=p_subject AND 'access.manage'=ANY(permissions) AND NOT 'service'=ANY(roles) LIMIT 1;
  IF actor IS NULL THEN RAISE EXCEPTION 'DIRECTORY_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  RETURN actor;
END $$;
CREATE FUNCTION public.orion_directory_snapshot_v1(p_issuer text,p_subject text,p_clinic text) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE actor text:=orion_directory.require_admin(p_issuer,p_subject,p_clinic); result jsonb;
BEGIN
  SELECT jsonb_build_object('schemaVersion',1,'clinic',jsonb_build_object('id',c.id,'name',c.name),
    'accounts',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',u.id,'name',u.display_name,'status',u.status,'version',u.version) ORDER BY u.display_name),'[]') FROM orion_directory.accounts u WHERE EXISTS(SELECT 1 FROM orion_directory.memberships m WHERE m.clinic_id=p_clinic AND m.user_id=u.id)),
    'memberships',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',m.id,'userId',m.user_id,'status',m.status,'version',m.version,'interactive',m.interactive)),'[]') FROM orion_directory.memberships m WHERE m.clinic_id=p_clinic),
    'assignments',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'membershipId',a.membership_id,'roles',a.roles,'allowPermissions',a.allow_permissions,'denyPermissions',a.deny_permissions,'effectivePermissions',orion_directory.effective_permissions(a.roles,a.allow_permissions,a.deny_permissions),'version',a.version,'status',a.status,'effectiveFrom',orion_crm.iso(a.effective_from),'effectiveUntil',CASE WHEN a.effective_until IS NULL THEN NULL ELSE orion_crm.iso(a.effective_until) END,'staffId',p.staff_id,'specialty',p.specialty)),'[]')
      FROM orion_directory.assignments a JOIN orion_directory.memberships m ON m.clinic_id=a.clinic_id AND m.id=a.membership_id JOIN orion_directory.accounts u ON u.id=m.user_id
      LEFT JOIN orion_clinical.practitioners p ON p.clinic_id=a.clinic_id AND p.issuer=u.issuer AND p.subject=u.subject WHERE a.clinic_id=p_clinic),
    'staff',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',s.id,'name',s.name,'role',s.role)),'[]') FROM orion_crm.staff s WHERE s.clinic_id=p_clinic),
    'generatedAt',orion_crm.iso(clock_timestamp())) INTO result FROM orion_crm.clinics c WHERE c.id=p_clinic;
  INSERT INTO orion_directory.audit_events(clinic_id,actor_user_id,action,resource_id,after_state,reason) VALUES(p_clinic,actor,'directory.read',p_clinic,'{}','directory administration');
  RETURN result;
END $$;
-- Compatibility grants serve only the old scheduling engine, behind scoped
-- clinical RPCs. Directory assignments are the sole post-cutover authority.
CREATE FUNCTION orion_directory.sync_clinical_projection(p_clinic text,p_user text) RETURNS void LANGUAGE plpgsql SET search_path='' AS $$
DECLARE u orion_directory.accounts; allowed boolean;
BEGIN
  SELECT * INTO STRICT u FROM orion_directory.accounts WHERE id=p_user;
  allowed:=EXISTS(SELECT 1 FROM orion_directory.current_assignments WHERE clinic_id=p_clinic AND user_id=p_user AND 'doctor'=ANY(roles) AND 'encounter.read'=ANY(permissions) AND 'encounter.manage'=ANY(permissions));
  UPDATE orion_clinical.practitioners SET active=allowed,display_name=u.display_name WHERE clinic_id=p_clinic AND issuer=u.issuer AND subject=u.subject;
  UPDATE orion_crm.actor_grants SET active=allowed,can_read=allowed,can_manage=allowed,version=version+1 WHERE clinic_id=p_clinic AND issuer=u.issuer AND subject=u.subject;
END $$;
CREATE FUNCTION public.orion_directory_command_v1(p_issuer text,p_subject text,p_command jsonb) RETURNS jsonb
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path='' AS $$
DECLARE clinic text:=p_command->>'clinicId'; actor text; kind text:=p_command->>'type'; key uuid; fingerprint text; receipt orion_directory.command_receipts;
  u orion_directory.accounts; m orion_directory.memberships; a orion_directory.assignments; before_state jsonb; after_state jsonb;
  result jsonb; resource text; revision integer; target_user text; grant_roles text[]; grant_allow text[]; grant_deny text[]; permitted text[]; field text;
BEGIN
  IF jsonb_typeof(p_command) IS DISTINCT FROM 'object' OR octet_length(p_command::text)>16384 THEN RAISE EXCEPTION 'DIRECTORY_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  permitted:=CASE kind
    WHEN 'account.create' THEN ARRAY['type','clinicId','name','idempotencyKey']
    WHEN 'assignment.create' THEN ARRAY['type','clinicId','membershipId','roles','allowPermissions','denyPermissions','staffId','specialty','reason','idempotencyKey']
    WHEN 'assignment.replace' THEN ARRAY['type','clinicId','assignmentId','expectedVersion','roles','allowPermissions','denyPermissions','staffId','specialty','reason','idempotencyKey']
    WHEN 'assignment.revoke' THEN ARRAY['type','clinicId','assignmentId','expectedVersion','reason','idempotencyKey']
    WHEN 'membership.disable' THEN ARRAY['type','clinicId','membershipId','expectedVersion','reason','idempotencyKey'] END;
  IF permitted IS NULL OR EXISTS(SELECT 1 FROM unnest(permitted) k WHERE NOT p_command?k) OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_command) k WHERE NOT k=ANY(permitted)) THEN RAISE EXCEPTION 'DIRECTORY_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  FOREACH field IN ARRAY ARRAY['type','clinicId','name','membershipId','assignmentId','reason','idempotencyKey'] LOOP
    IF p_command?field AND (jsonb_typeof(p_command->field) IS DISTINCT FROM 'string' OR length(p_command->>field) NOT BETWEEN 1 AND 1000) THEN RAISE EXCEPTION 'DIRECTORY_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  END LOOP;
  IF p_command?'expectedVersion' AND (jsonb_typeof(p_command->'expectedVersion') IS DISTINCT FROM 'number' OR (p_command->>'expectedVersion')!~'^[1-9][0-9]{0,9}$' OR (p_command->>'expectedVersion')::numeric>2147483647) THEN RAISE EXCEPTION 'DIRECTORY_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  -- Clinical commands lock the affected practitioner before the clinic. Use
  -- that same order before synchronizing its compatibility projection; otherwise
  -- a concurrent encounter.start and membership.disable can deadlock.
  actor:=orion_directory.require_admin(p_issuer,p_subject,clinic);
  IF kind IN ('assignment.create','membership.disable') THEN
    SELECT user_id INTO target_user FROM orion_directory.memberships WHERE clinic_id=clinic AND id=p_command->>'membershipId';
  ELSIF kind IN ('assignment.replace','assignment.revoke') THEN
    SELECT m2.user_id INTO target_user FROM orion_directory.assignments a2 JOIN orion_directory.memberships m2 ON m2.clinic_id=a2.clinic_id AND m2.id=a2.membership_id WHERE a2.clinic_id=clinic AND a2.id=p_command->>'assignmentId';
  END IF;
  PERFORM 1 FROM orion_clinical.practitioners p JOIN orion_directory.accounts u2 ON u2.issuer=p.issuer AND u2.subject=p.subject WHERE p.clinic_id=clinic AND u2.id=target_user FOR UPDATE OF p;
  -- Serialize administrator changes and recheck authority after lock waits.
  PERFORM 1 FROM orion_crm.clinics WHERE id=clinic AND active FOR UPDATE;
  actor:=orion_directory.require_admin(p_issuer,p_subject,clinic);
  key:=(p_command->>'idempotencyKey')::uuid; fingerprint:=encode(sha256(convert_to(p_command::text,'UTF8')),'hex');
  SELECT * INTO receipt FROM orion_directory.command_receipts WHERE clinic_id=clinic AND actor_user_id=actor AND idempotency_key=key;
  IF FOUND THEN IF receipt.request_hash<>fingerprint THEN RAISE EXCEPTION 'DIRECTORY_IDEMPOTENCY_CONFLICT' USING ERRCODE='PT409'; END IF; RETURN receipt.result||jsonb_build_object('replayed',true); END IF;
  IF kind='account.create' THEN
    IF length(trim(p_command->>'name')) NOT BETWEEN 2 AND 160 THEN RAISE EXCEPTION 'DIRECTORY_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
    target_user:='user-'||gen_random_uuid();
    INSERT INTO orion_directory.accounts(id,issuer,subject,display_name,status,source) VALUES(target_user,'orion:local:postgres',gen_random_uuid()::text,trim(p_command->>'name'),'active','postgres') RETURNING * INTO u;
    resource:='membership-'||gen_random_uuid();
    INSERT INTO orion_directory.memberships(clinic_id,id,user_id,status) VALUES(clinic,resource,target_user,'active') RETURNING * INTO m;
    after_state:=jsonb_build_object('account',to_jsonb(u),'membership',to_jsonb(m));revision:=1;
  ELSIF kind='membership.disable' THEN
    SELECT * INTO m FROM orion_directory.memberships WHERE clinic_id=clinic AND id=p_command->>'membershipId' FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'DIRECTORY_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    IF m.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'DIRECTORY_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
    IF m.status<>'active' THEN RAISE EXCEPTION 'DIRECTORY_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
    before_state:=to_jsonb(m);target_user:=m.user_id;
    UPDATE orion_directory.memberships SET status='disabled',version=version+1 WHERE clinic_id=clinic AND id=m.id RETURNING * INTO m;
    resource:=m.id;revision:=m.version;after_state:=to_jsonb(m);
  ELSE
    IF kind='assignment.create' THEN
      SELECT * INTO m FROM orion_directory.memberships WHERE clinic_id=clinic AND id=p_command->>'membershipId' AND status='active' FOR SHARE;
      IF NOT FOUND THEN RAISE EXCEPTION 'DIRECTORY_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
      target_user:=m.user_id;resource:='assignment-'||gen_random_uuid();
    ELSE
      SELECT * INTO a FROM orion_directory.assignments WHERE clinic_id=clinic AND id=p_command->>'assignmentId' FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'DIRECTORY_RESOURCE_NOT_FOUND' USING ERRCODE='PT404'; END IF;
      IF a.version<>(p_command->>'expectedVersion')::integer THEN RAISE EXCEPTION 'DIRECTORY_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
      IF a.status<>'active' THEN RAISE EXCEPTION 'DIRECTORY_INVALID_TRANSITION' USING ERRCODE='PT409'; END IF;
      SELECT * INTO STRICT m FROM orion_directory.memberships WHERE clinic_id=clinic AND id=a.membership_id AND status='active' FOR SHARE;
      target_user:=m.user_id;resource:=a.id;before_state:=to_jsonb(a);
    END IF;
    IF kind='assignment.revoke' THEN
      UPDATE orion_directory.assignments SET status='revoked',version=version+1 WHERE clinic_id=clinic AND id=a.id RETURNING * INTO a;
    ELSE
      FOREACH field IN ARRAY ARRAY['roles','allowPermissions','denyPermissions'] LOOP
        IF jsonb_typeof(p_command->field) IS DISTINCT FROM 'array' OR EXISTS(SELECT 1 FROM jsonb_array_elements(p_command->field) e WHERE jsonb_typeof(e)<>'string') OR
          (SELECT count(*) FROM jsonb_array_elements(p_command->field))<>(SELECT count(DISTINCT e) FROM jsonb_array_elements(p_command->field)e) THEN RAISE EXCEPTION 'DIRECTORY_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
      END LOOP;
      SELECT coalesce(array_agg(x),'{}') INTO grant_roles FROM jsonb_array_elements_text(p_command->'roles') x;
      SELECT coalesce(array_agg(x),'{}') INTO grant_allow FROM jsonb_array_elements_text(p_command->'allowPermissions') x;
      SELECT coalesce(array_agg(x),'{}') INTO grant_deny FROM jsonb_array_elements_text(p_command->'denyPermissions') x;
      IF kind='assignment.create' THEN
        INSERT INTO orion_directory.assignments(clinic_id,id,membership_id,roles,allow_permissions,deny_permissions,status,effective_from) VALUES(clinic,resource,m.id,grant_roles,grant_allow,grant_deny,'active',clock_timestamp()) RETURNING * INTO a;
      ELSE UPDATE orion_directory.assignments x SET roles=grant_roles,allow_permissions=grant_allow,deny_permissions=grant_deny,version=x.version+1 WHERE x.clinic_id=clinic AND x.id=resource RETURNING * INTO a; END IF;
      IF 'doctor'=ANY(grant_roles) AND 'encounter.manage'=ANY(orion_directory.effective_permissions(grant_roles,grant_allow,grant_deny)) THEN
        SELECT * INTO STRICT u FROM orion_directory.accounts WHERE id=target_user AND status='active';
        PERFORM 1 FROM orion_crm.staff WHERE clinic_id=clinic AND id=p_command->>'staffId' AND role='doctor' FOR SHARE;
        IF NOT FOUND OR jsonb_typeof(p_command->'specialty') IS DISTINCT FROM 'string' OR length(trim(p_command->>'specialty')) NOT BETWEEN 1 AND 160 THEN RAISE EXCEPTION 'DIRECTORY_STAFF_MAPPING_REQUIRED' USING ERRCODE='PT409'; END IF;
        IF EXISTS(SELECT 1 FROM orion_clinical.practitioners WHERE (issuer=u.issuer AND subject=u.subject) AND (clinic_id<>clinic OR staff_id<>p_command->>'staffId')) THEN RAISE EXCEPTION 'DIRECTORY_MAPPING_CONFLICT' USING ERRCODE='PT409'; END IF;
        INSERT INTO orion_crm.actor_grants(id,clinic_id,issuer,subject,label,can_read,can_manage) VALUES('directory-grant-'||gen_random_uuid(),clinic,u.issuer,u.subject,u.display_name,true,true) ON CONFLICT(issuer,subject) DO NOTHING;
        INSERT INTO orion_clinical.practitioners(clinic_id,id,staff_id,issuer,subject,display_name,specialty,verified_at,verification_reference)
          VALUES(clinic,'practitioner-'||gen_random_uuid(),p_command->>'staffId',u.issuer,u.subject,u.display_name,p_command->>'specialty',clock_timestamp(),'directory-assignment:'||a.id)
          ON CONFLICT(issuer,subject) DO UPDATE SET active=true,display_name=excluded.display_name,specialty=excluded.specialty,verification_reference=excluded.verification_reference,verified_at=excluded.verified_at;
      END IF;
    END IF;
    revision:=a.version;after_state:=to_jsonb(a);
  END IF;
  IF NOT EXISTS(SELECT 1 FROM orion_directory.current_assignments WHERE clinic_id=clinic AND 'access.manage'=ANY(permissions) AND NOT 'service'=ANY(roles)) THEN RAISE EXCEPTION 'DIRECTORY_LAST_ADMIN_REQUIRED' USING ERRCODE='PT409'; END IF;
  IF kind<>'account.create' THEN PERFORM orion_directory.sync_clinical_projection(clinic,target_user); END IF;
  INSERT INTO orion_directory.audit_events(clinic_id,actor_user_id,action,resource_id,before_state,after_state,reason) VALUES(clinic,actor,kind,resource,before_state,after_state,coalesce(p_command->>'reason','Create employee identity; no credentials assigned'));
  result:=jsonb_build_object('resourceId',resource,'userId',target_user,'version',revision,'replayed',false);
  INSERT INTO orion_directory.command_receipts VALUES(clinic,actor,key,fingerprint,result);
  RETURN result;
EXCEPTION WHEN invalid_text_representation OR numeric_value_out_of_range OR check_violation OR not_null_violation THEN RAISE EXCEPTION 'DIRECTORY_INVALID_COMMAND' USING ERRCODE='PT400';
WHEN unique_violation THEN RAISE EXCEPTION 'DIRECTORY_MAPPING_CONFLICT' USING ERRCODE='PT409';
END $$;
-- Preserve the original function OID with CREATE OR REPLACE: renaming it would
-- let already-planned callers retain a reference to the pre-cutover authority.
CREATE FUNCTION orion_clinical.require_actor_legacy_v1(p_issuer text,p_subject text) RETURNS orion_clinical.practitioners LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE a orion_clinical.practitioners;
BEGIN
  SELECT p.* INTO a FROM orion_clinical.practitioners p JOIN orion_crm.staff s ON s.clinic_id=p.clinic_id AND s.id=p.staff_id AND s.role='doctor'
    JOIN orion_crm.clinics c ON c.id=p.clinic_id AND c.active
    JOIN orion_crm.actor_grants g ON g.clinic_id=p.clinic_id AND g.issuer=p.issuer AND g.subject=p.subject AND g.active AND g.can_read
    WHERE p.issuer=p_issuer AND p.subject=p_subject AND p.active FOR SHARE OF p,g,s;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLINICAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  RETURN a;
END $$;
CREATE OR REPLACE FUNCTION orion_clinical.require_actor(p_issuer text,p_subject text) RETURNS orion_clinical.practitioners LANGUAGE plpgsql VOLATILE SET search_path='' AS $$
DECLARE p orion_clinical.practitioners;
BEGIN
  IF (SELECT source FROM orion_directory.runtime WHERE id=1)='legacy_d1' THEN RETURN orion_clinical.require_actor_legacy_v1(p_issuer,p_subject); END IF;
  SELECT practitioner.* INTO p FROM orion_clinical.practitioners practitioner
    JOIN orion_crm.staff s ON s.clinic_id=practitioner.clinic_id AND s.id=practitioner.staff_id AND s.role='doctor'
    WHERE practitioner.issuer=p_issuer AND practitioner.subject=p_subject AND practitioner.active AND EXISTS(
      SELECT 1 FROM orion_directory.current_assignments a WHERE a.clinic_id=practitioner.clinic_id AND a.issuer=p_issuer AND a.subject=p_subject
        AND 'doctor'=ANY(a.roles) AND 'encounter.read'=ANY(a.permissions) AND 'encounter.manage'=ANY(a.permissions)) FOR SHARE OF practitioner,s;
  IF NOT FOUND THEN RAISE EXCEPTION 'CLINICAL_ACCESS_DENIED' USING ERRCODE='PT403'; END IF;
  RETURN p;
END $$;
REVOKE ALL ON FUNCTION public.orion_directory_mode_v1(),public.orion_directory_principals_v1(),public.orion_directory_snapshot_v1(text,text,text),public.orion_directory_command_v1(text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.orion_directory_mode_v1(),public.orion_directory_principals_v1(),public.orion_directory_snapshot_v1(text,text,text),public.orion_directory_command_v1(text,text,jsonb) TO orion_crm_app;
COMMIT;
