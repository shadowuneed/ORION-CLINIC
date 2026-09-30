-- Real PostgreSQL foundation, not a D1 emulator. Apply after 0001, once, as
-- the migration owner. No local identities, passwords, or patient rows copied.
BEGIN;

CREATE FUNCTION orion_private.now_ms() RETURNS bigint
LANGUAGE sql VOLATILE SET search_path = '' AS $$
  SELECT floor(extract(epoch FROM clock_timestamp()) * 1000)::bigint
$$;

CREATE TABLE orion_private.organizations (
  id text PRIMARY KEY, name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  status text NOT NULL CHECK (status IN ('active','suspended')),
  created_at bigint NOT NULL, updated_at bigint NOT NULL,
  version integer NOT NULL CHECK (version > 0), CHECK (updated_at >= created_at)
);
CREATE TABLE orion_private.facilities (
  id text PRIMARY KEY, organization_id text NOT NULL REFERENCES orion_private.organizations(id),
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 160),
  timezone text NOT NULL DEFAULT 'Asia/Almaty',
  status text NOT NULL CHECK (status IN ('active','suspended')),
  created_at bigint NOT NULL, updated_at bigint NOT NULL, version integer NOT NULL CHECK (version > 0),
  UNIQUE(organization_id,id), UNIQUE(organization_id,name), CHECK(updated_at >= created_at)
);
CREATE TABLE orion_private.users (
  id text PRIMARY KEY, external_issuer text NOT NULL, external_subject text NOT NULL,
  email_normalized text, display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 2 AND 160),
  status text NOT NULL CHECK(status IN ('invited','active','disabled')),
  created_at bigint NOT NULL, updated_at bigint NOT NULL, version integer NOT NULL CHECK(version > 0),
  UNIQUE(external_issuer,external_subject), CHECK(updated_at >= created_at)
);
CREATE TABLE orion_private.memberships (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL,
  user_id text NOT NULL REFERENCES orion_private.users(id),
  role text NOT NULL CHECK(role IN ('clinician','nurse','registrar','administrator','auditor')),
  status text NOT NULL CHECK(status IN ('active','disabled')),
  created_at bigint NOT NULL, updated_at bigint NOT NULL, version integer NOT NULL CHECK(version > 0),
  UNIQUE(organization_id,facility_id,user_id), UNIQUE(organization_id,facility_id,id),
  UNIQUE(organization_id,facility_id,id,user_id),
  FOREIGN KEY(organization_id,facility_id) REFERENCES orion_private.facilities(organization_id,id),
  CHECK(updated_at >= created_at)
);
CREATE TABLE orion_private.departments (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL,
  code text NOT NULL CHECK(code ~ '^[a-z0-9_-]{2,40}$'),
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 160),
  kind text NOT NULL CHECK(kind IN ('clinical','diagnostic','administrative','support')),
  status text NOT NULL CHECK(status IN ('active','disabled')),
  created_at bigint NOT NULL, updated_at bigint NOT NULL, version integer NOT NULL CHECK(version > 0),
  UNIQUE(organization_id,facility_id,id), UNIQUE(organization_id,facility_id,code),
  FOREIGN KEY(organization_id,facility_id) REFERENCES orion_private.facilities(organization_id,id),
  CHECK(updated_at >= created_at)
);
CREATE TABLE orion_private.department_versions (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL, department_id text NOT NULL,
  version integer NOT NULL CHECK(version > 0), supersedes_version_id text,
  name text NOT NULL CHECK(length(btrim(name)) BETWEEN 2 AND 160),
  kind text NOT NULL CHECK(kind IN ('clinical','diagnostic','administrative','support')),
  status text NOT NULL CHECK(status IN ('active','disabled')),
  change_reason text NOT NULL CHECK(length(btrim(change_reason)) BETWEEN 3 AND 500),
  changed_by_membership_id text NOT NULL, changed_at bigint NOT NULL, created_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,department_id,version),
  UNIQUE(organization_id,facility_id,department_id,id), UNIQUE(supersedes_version_id),
  FOREIGN KEY(organization_id,facility_id,department_id) REFERENCES orion_private.departments(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,changed_by_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,department_id,supersedes_version_id) REFERENCES orion_private.department_versions(organization_id,facility_id,department_id,id),
  CHECK((version = 1 AND supersedes_version_id IS NULL) OR (version > 1 AND supersedes_version_id IS NOT NULL)),
  CHECK(changed_at >= created_at)
);
CREATE TABLE orion_private.department_heads (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL, department_id text NOT NULL,
  current_version_id text NOT NULL, lock_version integer NOT NULL CHECK(lock_version > 0),
  created_at bigint NOT NULL, updated_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,department_id),
  FOREIGN KEY(organization_id,facility_id,department_id,current_version_id) REFERENCES orion_private.department_versions(organization_id,facility_id,department_id,id),
  CHECK(updated_at >= created_at)
);
CREATE TABLE orion_private.department_access_assignments (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL,
  department_id text NOT NULL, membership_id text NOT NULL, created_by_membership_id text NOT NULL, created_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,id), UNIQUE(organization_id,facility_id,id,department_id,membership_id),
  UNIQUE(organization_id,facility_id,department_id,membership_id),
  FOREIGN KEY(organization_id,facility_id,department_id) REFERENCES orion_private.departments(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,created_by_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id)
);

CREATE FUNCTION orion_private.valid_access_arrays(roles jsonb, allows jsonb, denies jsonb) RETURNS boolean
LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE valid_permissions text[] := ARRAY['clinic.dashboard.read','patient.directory.read','patient.profile.write','encounter.read','encounter.manage','orders.manage','scheduling.manage','care.manage','observations.manage','communications.manage','access.self.read','access.manage','audit.read','clinical_policy.review','service.integration.execute'];
BEGIN
  IF jsonb_typeof(roles) IS DISTINCT FROM 'array' OR jsonb_typeof(allows) IS DISTINCT FROM 'array' OR jsonb_typeof(denies) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  IF jsonb_array_length(roles) = 0 OR EXISTS(SELECT 1 FROM jsonb_array_elements(roles) e WHERE jsonb_typeof(e) <> 'string') OR EXISTS(SELECT 1 FROM jsonb_array_elements(allows) e WHERE jsonb_typeof(e) <> 'string') OR EXISTS(SELECT 1 FROM jsonb_array_elements(denies) e WHERE jsonb_typeof(e) <> 'string') THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(roles) r WHERE r <> ALL(ARRAY['doctor','nurse','registrar','administrator','medical_lead','auditor','service'])) OR (roles ? 'service' AND jsonb_array_length(roles) <> 1) THEN RETURN false; END IF;
  IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(allows) p WHERE p <> ALL(valid_permissions)) OR EXISTS(SELECT 1 FROM jsonb_array_elements_text(denies) p WHERE p <> ALL(valid_permissions)) THEN RETURN false; END IF;
  RETURN (SELECT count(*) = count(DISTINCT r) FROM jsonb_array_elements_text(roles) r)
    AND (SELECT count(*) = count(DISTINCT p) FROM jsonb_array_elements_text(allows) p)
    AND (SELECT count(*) = count(DISTINCT p) FROM jsonb_array_elements_text(denies) p)
    AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements_text(allows) p WHERE denies ? p);
END $$;
CREATE FUNCTION orion_private.effective_permissions(roles jsonb, allows jsonb, denies jsonb) RETURNS jsonb
LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
  WITH role_permissions(role,permissions) AS (VALUES
    ('doctor',ARRAY['clinic.dashboard.read','patient.directory.read','patient.profile.write','encounter.read','encounter.manage','orders.manage','scheduling.manage','care.manage','observations.manage','communications.manage','access.self.read']),
    ('nurse',ARRAY['clinic.dashboard.read','patient.directory.read','encounter.read','care.manage','observations.manage','communications.manage','access.self.read']),
    ('registrar',ARRAY['clinic.dashboard.read','patient.directory.read','patient.profile.write','scheduling.manage','communications.manage','access.self.read']),
    ('administrator',ARRAY['access.self.read','access.manage','audit.read']),
    ('medical_lead',ARRAY['clinic.dashboard.read','patient.directory.read','encounter.read','access.self.read','audit.read','clinical_policy.review']),
    ('auditor',ARRAY['access.self.read','audit.read']), ('service',ARRAY['service.integration.execute'])
  ), granted AS (
    SELECT unnest(permissions) AS permission FROM role_permissions WHERE roles ? role
    UNION SELECT jsonb_array_elements_text(allows)
  ), ordered AS (
    SELECT permission, ordinal FROM unnest(ARRAY['clinic.dashboard.read','patient.directory.read','patient.profile.write','encounter.read','encounter.manage','orders.manage','scheduling.manage','care.manage','observations.manage','communications.manage','access.self.read','access.manage','audit.read','clinical_policy.review','service.integration.execute']) WITH ORDINALITY p(permission,ordinal)
    WHERE permission IN (SELECT permission FROM granted) AND NOT denies ? permission
  ) SELECT coalesce(jsonb_agg(permission ORDER BY ordinal),'[]'::jsonb) FROM ordered
$$;
CREATE TABLE orion_private.department_access_assignment_versions (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL,
  assignment_id text NOT NULL, department_id text NOT NULL, membership_id text NOT NULL,
  version integer NOT NULL CHECK(version > 0), supersedes_version_id text,
  status text NOT NULL CHECK(status IN ('active','revoked')), source_type text NOT NULL CHECK(source_type IN ('bootstrap','administrator')),
  roles_json jsonb NOT NULL, allow_permissions_json jsonb NOT NULL DEFAULT '[]', deny_permissions_json jsonb NOT NULL DEFAULT '[]',
  effective_from bigint NOT NULL, effective_until bigint,
  change_reason text NOT NULL CHECK(length(btrim(change_reason)) BETWEEN 3 AND 500),
  changed_by_membership_id text NOT NULL, changed_at bigint NOT NULL, created_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,assignment_id,version), UNIQUE(organization_id,facility_id,assignment_id,id),
  UNIQUE(organization_id,facility_id,assignment_id,department_id,membership_id,id), UNIQUE(supersedes_version_id),
  FOREIGN KEY(organization_id,facility_id,assignment_id,department_id,membership_id) REFERENCES orion_private.department_access_assignments(organization_id,facility_id,id,department_id,membership_id),
  FOREIGN KEY(organization_id,facility_id,changed_by_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,assignment_id,supersedes_version_id) REFERENCES orion_private.department_access_assignment_versions(organization_id,facility_id,assignment_id,id),
  CHECK((version = 1 AND supersedes_version_id IS NULL) OR (version > 1 AND supersedes_version_id IS NOT NULL)),
  CHECK(effective_until IS NULL OR effective_until > effective_from),
  CHECK(orion_private.valid_access_arrays(roles_json,allow_permissions_json,deny_permissions_json)), CHECK(changed_at >= created_at)
);
CREATE TABLE orion_private.department_access_assignment_heads (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL,
  assignment_id text NOT NULL, department_id text NOT NULL, membership_id text NOT NULL,
  current_version_id text NOT NULL, lock_version integer NOT NULL CHECK(lock_version > 0),
  created_at bigint NOT NULL, updated_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,assignment_id),
  FOREIGN KEY(organization_id,facility_id,assignment_id,department_id,membership_id,current_version_id) REFERENCES orion_private.department_access_assignment_versions(organization_id,facility_id,assignment_id,department_id,membership_id,id),
  CHECK(updated_at >= created_at)
);

CREATE TABLE orion_private.patients (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL,
  medical_record_number text NOT NULL CHECK(length(medical_record_number) BETWEEN 3 AND 80),
  display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 2 AND 160), birth_date text,
  sex_at_birth text NOT NULL CHECK(sex_at_birth IN ('female','male','unknown','not_recorded')),
  status text NOT NULL CHECK(status IN ('active','inactive','merged')),
  created_at bigint NOT NULL, updated_at bigint NOT NULL, version integer NOT NULL CHECK(version > 0),
  UNIQUE(organization_id,facility_id,id), UNIQUE(organization_id,facility_id,medical_record_number),
  FOREIGN KEY(organization_id,facility_id) REFERENCES orion_private.facilities(organization_id,id), CHECK(updated_at >= created_at)
);
CREATE TABLE orion_private.patient_profile_versions (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL, patient_id text NOT NULL,
  version integer NOT NULL CHECK(version > 0), display_name text NOT NULL CHECK(length(btrim(display_name)) BETWEEN 2 AND 160),
  birth_date text, sex_at_birth text NOT NULL CHECK(sex_at_birth IN ('female','male','unknown','not_recorded')),
  phone text, email text, address text, status text NOT NULL CHECK(status IN ('active','inactive','merged')),
  created_by_membership_id text NOT NULL, change_reason text NOT NULL CHECK(length(btrim(change_reason)) BETWEEN 3 AND 300),
  supersedes_profile_version_id text, created_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,patient_id,version), UNIQUE(organization_id,facility_id,patient_id,id), UNIQUE(supersedes_profile_version_id),
  FOREIGN KEY(organization_id,facility_id,patient_id) REFERENCES orion_private.patients(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,created_by_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,patient_id,supersedes_profile_version_id) REFERENCES orion_private.patient_profile_versions(organization_id,facility_id,patient_id,id),
  CHECK((version = 1 AND supersedes_profile_version_id IS NULL) OR (version > 1 AND supersedes_profile_version_id IS NOT NULL)),
  CHECK(phone IS NULL OR length(btrim(phone)) BETWEEN 5 AND 40), CHECK(email IS NULL OR length(email) <= 160), CHECK(address IS NULL OR length(btrim(address)) BETWEEN 3 AND 300)
);
CREATE TABLE orion_private.patient_profile_heads (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL, patient_id text NOT NULL,
  current_version_id text NOT NULL, lock_version integer NOT NULL CHECK(lock_version > 0), updated_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,patient_id),
  FOREIGN KEY(organization_id,facility_id,patient_id,current_version_id) REFERENCES orion_private.patient_profile_versions(organization_id,facility_id,patient_id,id)
);
CREATE TABLE orion_private.patient_identifiers (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL, patient_id text NOT NULL,
  kind text NOT NULL CHECK(kind IN ('test_iin','other')), normalized_value text NOT NULL,
  display_last4 text NOT NULL, status text NOT NULL CHECK(status IN ('active','revoked')),
  created_by_membership_id text NOT NULL, created_at bigint NOT NULL, updated_at bigint NOT NULL, version integer NOT NULL CHECK(version > 0),
  FOREIGN KEY(organization_id,facility_id,patient_id) REFERENCES orion_private.patients(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,created_by_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  CHECK(kind <> 'test_iin' OR normalized_value ~ '^[0-9]{12}$'), CHECK(updated_at >= created_at)
);
CREATE UNIQUE INDEX patient_active_identifier_unique ON orion_private.patient_identifiers(organization_id,facility_id,kind,normalized_value) WHERE status = 'active';
CREATE UNIQUE INDEX patient_active_iin_one ON orion_private.patient_identifiers(organization_id,facility_id,patient_id,kind) WHERE status = 'active' AND kind = 'test_iin';
-- Catalog read support only. No encounter mutation RPC exists in this slice.
CREATE TABLE orion_private.encounters (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL, patient_id text NOT NULL,
  clinician_membership_id text NOT NULL,
  status text NOT NULL CHECK(status IN ('draft','ready','in_progress','review','finalized','amended','cancelled')),
  reason_for_visit text, started_at bigint, ended_at bigint, finalized_at bigint,
  created_at bigint NOT NULL, updated_at bigint NOT NULL, version integer NOT NULL CHECK(version > 0),
  UNIQUE(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,patient_id) REFERENCES orion_private.patients(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,clinician_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  CHECK(ended_at IS NULL OR (started_at IS NOT NULL AND ended_at >= started_at)),
  CHECK(finalized_at IS NULL OR status IN ('finalized','amended')), CHECK(updated_at >= created_at)
);
CREATE INDEX patients_scope_idx ON orion_private.patients(organization_id,facility_id,updated_at DESC,id DESC);
CREATE INDEX encounters_patient_idx ON orion_private.encounters(organization_id,facility_id,patient_id,updated_at DESC,id DESC);

CREATE TABLE orion_private.audit_events (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL, sequence bigint NOT NULL CHECK(sequence > 0),
  actor_type text NOT NULL CHECK(actor_type IN ('user','service')), actor_id text NOT NULL, actor_membership_id text,
  action text NOT NULL, outcome text NOT NULL CHECK(outcome IN ('succeeded','denied','failed')), purpose text NOT NULL,
  schema_version integer NOT NULL CHECK(schema_version = 1), entity_type text NOT NULL, entity_id text NOT NULL,
  request_id text NOT NULL, metadata_json text NOT NULL CHECK(jsonb_typeof(metadata_json::jsonb) = 'object'),
  previous_hash text, event_hash text NOT NULL CHECK(event_hash ~ '^[a-f0-9]{64}$'), occurred_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,sequence), UNIQUE(event_hash), UNIQUE(organization_id,facility_id,sequence,event_hash),
  FOREIGN KEY(organization_id,facility_id) REFERENCES orion_private.facilities(organization_id,id),
  FOREIGN KEY(organization_id,facility_id,actor_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  CHECK((sequence = 1 AND previous_hash IS NULL) OR (sequence > 1 AND previous_hash ~ '^[a-f0-9]{64}$')),
  CHECK((actor_type = 'user' AND actor_membership_id IS NOT NULL) OR (actor_type = 'service' AND actor_membership_id IS NULL))
);
CREATE TABLE orion_private.audit_stream_heads (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL,
  last_sequence bigint NOT NULL DEFAULT 0 CHECK(last_sequence >= 0), last_event_hash text,
  lock_version bigint NOT NULL DEFAULT 1 CHECK(lock_version > 0), updated_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id),
  FOREIGN KEY(organization_id,facility_id) REFERENCES orion_private.facilities(organization_id,id),
  FOREIGN KEY(organization_id,facility_id,last_sequence,last_event_hash) REFERENCES orion_private.audit_events(organization_id,facility_id,sequence,event_hash),
  CHECK((last_sequence = 0 AND last_event_hash IS NULL) OR (last_sequence > 0 AND last_event_hash ~ '^[a-f0-9]{64}$'))
);
CREATE TABLE orion_private.command_idempotency (
  id text PRIMARY KEY, organization_id text NOT NULL, facility_id text NOT NULL, actor_membership_id text NOT NULL,
  access_assignment_id text NOT NULL, operation text NOT NULL CHECK(operation IN ('patient.create','patient.update','patient.archive')),
  idempotency_key uuid NOT NULL, request_hash text NOT NULL CHECK(request_hash ~ '^[a-f0-9]{64}$'),
  result_resource_id text NOT NULL, created_at bigint NOT NULL,
  UNIQUE(organization_id,facility_id,actor_membership_id,operation,idempotency_key),
  FOREIGN KEY(organization_id,facility_id,actor_membership_id) REFERENCES orion_private.memberships(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,access_assignment_id) REFERENCES orion_private.department_access_assignments(organization_id,facility_id,id),
  FOREIGN KEY(organization_id,facility_id,result_resource_id) REFERENCES orion_private.patients(organization_id,facility_id,id)
);

CREATE FUNCTION orion_private.reject_mutation() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN RAISE EXCEPTION 'immutable ledger: %', TG_TABLE_NAME USING ERRCODE = '23514'; END $$;
CREATE FUNCTION orion_private.mutable_identity_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE mutable_fields text[];
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'governed identity cannot be deleted' USING ERRCODE='23514'; END IF;
  mutable_fields:=CASE TG_TABLE_NAME
    WHEN 'organizations' THEN ARRAY['name','status','updated_at','version']
    WHEN 'facilities' THEN ARRAY['name','timezone','status','updated_at','version']
    WHEN 'users' THEN ARRAY['email_normalized','display_name','status','updated_at','version']
    WHEN 'memberships' THEN ARRAY['role','status','updated_at','version']
    WHEN 'patient_identifiers' THEN ARRAY['status','updated_at','version'] END;
  IF (to_jsonb(NEW)-mutable_fields) IS DISTINCT FROM (to_jsonb(OLD)-mutable_fields) OR NEW.version<>OLD.version+1 OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'identity/version fence violated' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='patient_identifiers' AND OLD.status='revoked' THEN RAISE EXCEPTION 'identifier revocation is terminal' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['organizations','facilities','users','memberships','patient_identifiers'] LOOP
    EXECUTE format('CREATE TRIGGER identity_fence BEFORE UPDATE OR DELETE ON orion_private.%I FOR EACH ROW EXECUTE FUNCTION orion_private.mutable_identity_guard()',tab);
  END LOOP;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['departments','department_versions','department_access_assignments','department_access_assignment_versions','patients','patient_profile_versions','audit_events','command_idempotency'] LOOP
    EXECUTE format('CREATE TRIGGER immutable_row BEFORE UPDATE OR DELETE ON orion_private.%I FOR EACH ROW EXECUTE FUNCTION orion_private.reject_mutation()',tab);
  END LOOP;
END $$;

CREATE FUNCTION orion_private.version_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE old_version record; head_id text; actor_active boolean;
BEGIN
  IF TG_TABLE_NAME = 'patient_profile_versions' THEN
    SELECT true INTO actor_active FROM orion_private.memberships m JOIN orion_private.users u ON u.id=m.user_id WHERE m.organization_id=NEW.organization_id AND m.facility_id=NEW.facility_id AND m.id=NEW.created_by_membership_id AND m.status='active' AND u.status='active' FOR SHARE OF m,u;
    IF actor_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'inactive profile actor' USING ERRCODE='23514'; END IF;
    IF NOT orion_private.actor_has_permission(NEW.organization_id,NEW.facility_id,NEW.created_by_membership_id,NEW.created_at,'patient.profile.write') THEN RAISE EXCEPTION 'current profile writer required' USING ERRCODE='23514'; END IF;
    IF NEW.version > 1 THEN
      SELECT v.* INTO old_version FROM orion_private.patient_profile_heads h JOIN orion_private.patient_profile_versions v ON v.id=h.current_version_id AND v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.patient_id=h.patient_id WHERE h.organization_id=NEW.organization_id AND h.facility_id=NEW.facility_id AND h.patient_id=NEW.patient_id FOR UPDATE OF h;
      IF NOT FOUND OR old_version.id IS DISTINCT FROM NEW.supersedes_profile_version_id OR old_version.version+1 <> NEW.version OR old_version.status <> 'active' OR NEW.created_at < old_version.created_at THEN RAISE EXCEPTION 'profile must extend current active head' USING ERRCODE='23514'; END IF;
    END IF;
  ELSIF TG_TABLE_NAME = 'department_versions' THEN
    SELECT true INTO actor_active FROM orion_private.memberships m JOIN orion_private.users u ON u.id=m.user_id JOIN orion_private.facilities f ON f.organization_id=m.organization_id AND f.id=m.facility_id JOIN orion_private.organizations o ON o.id=m.organization_id WHERE m.organization_id=NEW.organization_id AND m.facility_id=NEW.facility_id AND m.id=NEW.changed_by_membership_id AND m.status='active' AND u.status='active' AND f.status='active' AND o.status='active' FOR SHARE OF m,u,f,o;
    IF actor_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'inactive department actor' USING ERRCODE='23514'; END IF;
    IF NEW.version > 1 THEN
      IF NOT orion_private.actor_has_permission(NEW.organization_id,NEW.facility_id,NEW.changed_by_membership_id,NEW.changed_at,'access.manage') THEN RAISE EXCEPTION 'current access.manage required' USING ERRCODE='23514'; END IF;
      SELECT v.* INTO old_version FROM orion_private.department_heads h JOIN orion_private.department_versions v ON v.id=h.current_version_id AND v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.department_id=h.department_id WHERE h.organization_id=NEW.organization_id AND h.facility_id=NEW.facility_id AND h.department_id=NEW.department_id FOR UPDATE OF h;
      IF NOT FOUND OR old_version.id IS DISTINCT FROM NEW.supersedes_version_id OR old_version.version+1 <> NEW.version OR NEW.changed_at < old_version.changed_at THEN RAISE EXCEPTION 'department must extend current head' USING ERRCODE='23514'; END IF;
    END IF;
  ELSE
    IF NEW.version > 1 THEN
      SELECT v.* INTO old_version FROM orion_private.department_access_assignment_heads h JOIN orion_private.department_access_assignment_versions v ON v.id=h.current_version_id AND v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.assignment_id=h.assignment_id WHERE h.organization_id=NEW.organization_id AND h.facility_id=NEW.facility_id AND h.assignment_id=NEW.assignment_id FOR UPDATE OF h;
      IF NOT FOUND OR old_version.id IS DISTINCT FROM NEW.supersedes_version_id OR old_version.version+1 <> NEW.version OR NEW.changed_at < old_version.changed_at THEN RAISE EXCEPTION 'assignment must extend current head' USING ERRCODE='23514'; END IF;
    END IF;
    SELECT true INTO actor_active FROM orion_private.memberships m JOIN orion_private.users u ON u.id=m.user_id WHERE m.organization_id=NEW.organization_id AND m.facility_id=NEW.facility_id AND m.id=NEW.changed_by_membership_id AND m.status='active' AND u.status='active' FOR SHARE OF m,u;
    IF actor_active IS DISTINCT FROM true THEN RAISE EXCEPTION 'inactive assignment actor' USING ERRCODE='23514'; END IF;
    IF NEW.source_type='administrator' AND NOT EXISTS (
      SELECT 1 FROM orion_private.department_access_assignments a JOIN orion_private.department_access_assignment_heads h ON h.organization_id=a.organization_id AND h.facility_id=a.facility_id AND h.assignment_id=a.id JOIN orion_private.department_access_assignment_versions v ON v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.assignment_id=h.assignment_id AND v.id=h.current_version_id JOIN orion_private.department_heads dh ON dh.organization_id=a.organization_id AND dh.facility_id=a.facility_id AND dh.department_id=a.department_id JOIN orion_private.department_versions dv ON dv.organization_id=dh.organization_id AND dv.facility_id=dh.facility_id AND dv.department_id=dh.department_id AND dv.id=dh.current_version_id JOIN orion_private.facilities f ON f.organization_id=a.organization_id AND f.id=a.facility_id JOIN orion_private.organizations o ON o.id=a.organization_id
      WHERE a.organization_id=NEW.organization_id AND a.facility_id=NEW.facility_id AND a.membership_id=NEW.changed_by_membership_id AND v.status='active' AND v.effective_from <= NEW.changed_at AND (v.effective_until IS NULL OR v.effective_until > NEW.changed_at) AND dv.status='active' AND f.status='active' AND o.status='active' AND orion_private.effective_permissions(v.roles_json,v.allow_permissions_json,v.deny_permissions_json) ? 'access.manage'
    ) THEN RAISE EXCEPTION 'current access.manage required' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER version_append_guard BEFORE INSERT ON orion_private.department_versions FOR EACH ROW EXECUTE FUNCTION orion_private.version_guard();
CREATE TRIGGER version_append_guard BEFORE INSERT ON orion_private.department_access_assignment_versions FOR EACH ROW EXECUTE FUNCTION orion_private.version_guard();
CREATE TRIGGER version_append_guard BEFORE INSERT ON orion_private.patient_profile_versions FOR EACH ROW EXECUTE FUNCTION orion_private.version_guard();

CREATE FUNCTION orion_private.assignment_root_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  PERFORM 1 FROM orion_private.memberships m JOIN orion_private.users u ON u.id=m.user_id JOIN orion_private.memberships actor ON actor.organization_id=m.organization_id AND actor.facility_id=m.facility_id AND actor.id=NEW.created_by_membership_id JOIN orion_private.users au ON au.id=actor.user_id JOIN orion_private.facilities f ON f.organization_id=m.organization_id AND f.id=m.facility_id JOIN orion_private.organizations o ON o.id=m.organization_id JOIN orion_private.department_heads dh ON dh.organization_id=m.organization_id AND dh.facility_id=m.facility_id AND dh.department_id=NEW.department_id JOIN orion_private.department_versions dv ON dv.organization_id=dh.organization_id AND dv.facility_id=dh.facility_id AND dv.department_id=dh.department_id AND dv.id=dh.current_version_id
  WHERE m.organization_id=NEW.organization_id AND m.facility_id=NEW.facility_id AND m.id=NEW.membership_id AND m.status='active' AND u.status='active' AND actor.status='active' AND au.status='active' AND f.status='active' AND o.status='active' AND dv.status='active' FOR SHARE OF m,u,actor,au,f,o,dh,dv;
  IF NOT FOUND THEN RAISE EXCEPTION 'active assignment relations required' USING ERRCODE='23514'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER assignment_relations BEFORE INSERT ON orion_private.department_access_assignments FOR EACH ROW EXECUTE FUNCTION orion_private.assignment_root_guard();

CREATE FUNCTION orion_private.head_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE next_version integer; predecessor text; next_identity jsonb; old_identity jsonb;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'head cannot be deleted' USING ERRCODE='23514'; END IF;
  IF TG_TABLE_NAME='patient_profile_heads' THEN
    SELECT version,supersedes_profile_version_id INTO next_version,predecessor FROM orion_private.patient_profile_versions WHERE organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND patient_id=NEW.patient_id AND id=NEW.current_version_id;
  ELSIF TG_TABLE_NAME='department_heads' THEN
    SELECT version,supersedes_version_id INTO next_version,predecessor FROM orion_private.department_versions WHERE organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND department_id=NEW.department_id AND id=NEW.current_version_id;
  ELSE
    SELECT version,supersedes_version_id INTO next_version,predecessor FROM orion_private.department_access_assignment_versions WHERE organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND assignment_id=NEW.assignment_id AND department_id=NEW.department_id AND membership_id=NEW.membership_id AND id=NEW.current_version_id;
  END IF;
  IF NOT FOUND THEN RAISE EXCEPTION 'head version scope mismatch' USING ERRCODE='23514'; END IF;
  IF TG_OP='INSERT' THEN
    IF next_version<>1 OR NEW.lock_version<>1 OR predecessor IS NOT NULL THEN RAISE EXCEPTION 'initial head must be version one' USING ERRCODE='23514'; END IF;
  ELSE
    next_identity := to_jsonb(NEW)-ARRAY['current_version_id','lock_version','updated_at'];
    old_identity := to_jsonb(OLD)-ARRAY['current_version_id','lock_version','updated_at'];
    IF next_identity IS DISTINCT FROM old_identity OR NEW.lock_version<>OLD.lock_version+1 OR next_version<>NEW.lock_version OR predecessor IS DISTINCT FROM OLD.current_version_id OR NEW.updated_at<OLD.updated_at THEN RAISE EXCEPTION 'head must advance by direct successor' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
DO $$ DECLARE tab text; BEGIN
  FOREACH tab IN ARRAY ARRAY['department_heads','department_access_assignment_heads','patient_profile_heads'] LOOP EXECUTE format('CREATE TRIGGER monotonic_head BEFORE INSERT OR UPDATE OR DELETE ON orion_private.%I FOR EACH ROW EXECUTE FUNCTION orion_private.head_guard()',tab); END LOOP;
END $$;

-- Core SHA256 is available in PostgreSQL; preserve the ordered hash-schema-1
-- JSON string contract. metadata_json remains text, never rewritten as jsonb.
CREATE FUNCTION orion_private.audit_hash(e orion_private.audit_events) RETURNS text LANGUAGE sql IMMUTABLE SET search_path = '' AS $$
 SELECT encode(sha256(convert_to(
  '{"hashSchemaVersion":1,"previousHash":'||coalesce(to_json(e.previous_hash)::text,'null')||
  ',"organizationId":'||to_json(e.organization_id)::text||',"facilityId":'||to_json(e.facility_id)::text||
  ',"sequence":'||e.sequence::text||',"actorType":'||to_json(e.actor_type)::text||',"actorId":'||to_json(e.actor_id)::text||
  ',"actorMembershipId":'||coalesce(to_json(e.actor_membership_id)::text,'null')||',"action":'||to_json(e.action)::text||
  ',"outcome":'||to_json(e.outcome)::text||',"purpose":'||to_json(e.purpose)::text||',"schemaVersion":'||e.schema_version::text||
  ',"entityType":'||to_json(e.entity_type)::text||',"entityId":'||to_json(e.entity_id)::text||',"requestId":'||to_json(e.request_id)::text||
  ',"metadataJson":'||to_json(e.metadata_json)::text||',"occurredAt":'||e.occurred_at::text||'}','UTF8')),'hex')
$$;
CREATE FUNCTION orion_private.audit_guard() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE h orion_private.audit_stream_heads;
BEGIN
  IF TG_TABLE_NAME='audit_events' THEN
    IF NEW.actor_type='user' AND NOT EXISTS(SELECT 1 FROM orion_private.memberships m WHERE m.organization_id=NEW.organization_id AND m.facility_id=NEW.facility_id AND m.id=NEW.actor_membership_id AND m.user_id=NEW.actor_id) THEN RAISE EXCEPTION 'audit actor identity mismatch' USING ERRCODE='23514'; END IF;
    SELECT * INTO h FROM orion_private.audit_stream_heads WHERE organization_id=NEW.organization_id AND facility_id=NEW.facility_id FOR UPDATE;
    IF NOT FOUND OR NEW.sequence<>h.last_sequence+1 OR NEW.previous_hash IS DISTINCT FROM h.last_event_hash OR NEW.event_hash IS DISTINCT FROM orion_private.audit_hash(NEW) OR NEW.occurred_at<h.updated_at THEN RAISE EXCEPTION 'invalid audit append' USING ERRCODE='23514'; END IF;
  ELSIF TG_OP='DELETE' THEN RAISE EXCEPTION 'audit head cannot be deleted' USING ERRCODE='23514';
  ELSIF TG_OP='INSERT' THEN
    IF NEW.last_sequence<>0 OR NEW.last_event_hash IS NOT NULL OR NEW.lock_version<>1 THEN RAISE EXCEPTION 'invalid audit genesis' USING ERRCODE='23514'; END IF;
  ELSE
    IF (to_jsonb(NEW)-ARRAY['last_sequence','last_event_hash','lock_version','updated_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['last_sequence','last_event_hash','lock_version','updated_at']) OR NEW.last_sequence<>OLD.last_sequence+1 OR NEW.lock_version<>OLD.lock_version+1 OR NEW.updated_at<OLD.updated_at OR NOT EXISTS(SELECT 1 FROM orion_private.audit_events WHERE organization_id=NEW.organization_id AND facility_id=NEW.facility_id AND sequence=NEW.last_sequence AND event_hash=NEW.last_event_hash AND previous_hash IS NOT DISTINCT FROM OLD.last_event_hash) THEN RAISE EXCEPTION 'invalid audit head advance' USING ERRCODE='23514'; END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER audit_append_guard BEFORE INSERT ON orion_private.audit_events FOR EACH ROW EXECUTE FUNCTION orion_private.audit_guard();
CREATE TRIGGER audit_head_guard BEFORE INSERT OR UPDATE OR DELETE ON orion_private.audit_stream_heads FOR EACH ROW EXECUTE FUNCTION orion_private.audit_guard();

CREATE FUNCTION orion_private.principal() RETURNS orion_private.users LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE claims jsonb := auth.jwt(); subject uuid := auth.uid(); session_uuid uuid; result orion_private.users;
BEGIN
  IF subject IS NULL OR claims->>'role' IS DISTINCT FROM 'authenticated' OR claims->>'iss' IS DISTINCT FROM 'https://bctyswbqjgpmtsanrfhp.supabase.co/auth/v1' OR coalesce(claims->>'is_anonymous','false') <> 'false' OR coalesce((claims->>'exp')::numeric,0) <= extract(epoch FROM clock_timestamp()) THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='PT401'; END IF;
  BEGIN session_uuid := (claims->>'session_id')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='PT401'; END;
  PERFORM 1 FROM auth.sessions s WHERE s.id=session_uuid AND s.user_id=subject AND (s.not_after IS NULL OR s.not_after>clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='PT401'; END IF;
  PERFORM 1 FROM auth.users u WHERE u.id=subject AND to_jsonb(u)->>'deleted_at' IS NULL AND ((to_jsonb(u)->>'banned_until') IS NULL OR (to_jsonb(u)->>'banned_until')::timestamptz<=clock_timestamp()) FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'UNAUTHENTICATED' USING ERRCODE='PT401'; END IF;
  SELECT * INTO result FROM orion_private.users u WHERE u.external_issuer=claims->>'iss' AND u.external_subject=subject::text AND u.status='active' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'ACTIVE_STAFF_REQUIRED' USING ERRCODE='PT403'; END IF;
  RETURN result;
END $$;

CREATE FUNCTION orion_private.own_assignments(staff_id text) RETURNS SETOF jsonb LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE r record; observed bigint := orion_private.now_ms();
BEGIN
  FOR r IN SELECT a.id, v.id version_id,v.version,v.status assignment_status,v.source_type,v.effective_from,v.effective_until,v.roles_json,v.allow_permissions_json,v.deny_permissions_json,
    o.id organization_id,o.name organization_name,o.status organization_status,f.id facility_id,f.name facility_name,f.status facility_status,
    d.id department_id,d.code department_code,dv.name department_name,dv.kind department_kind,dv.status department_status,
    m.id membership_id,m.role legacy_role,m.status membership_status,u.id user_id,u.display_name,u.status user_status
    FROM orion_private.department_access_assignments a
    JOIN orion_private.department_access_assignment_heads ah ON ah.organization_id=a.organization_id AND ah.facility_id=a.facility_id AND ah.assignment_id=a.id AND ah.department_id=a.department_id AND ah.membership_id=a.membership_id
    JOIN orion_private.department_access_assignment_versions v ON v.organization_id=ah.organization_id AND v.facility_id=ah.facility_id AND v.assignment_id=ah.assignment_id AND v.id=ah.current_version_id AND v.department_id=ah.department_id AND v.membership_id=ah.membership_id
    JOIN orion_private.memberships m ON m.organization_id=a.organization_id AND m.facility_id=a.facility_id AND m.id=a.membership_id
    JOIN orion_private.users u ON u.id=m.user_id
    JOIN orion_private.departments d ON d.organization_id=a.organization_id AND d.facility_id=a.facility_id AND d.id=a.department_id
    JOIN orion_private.department_heads dh ON dh.organization_id=d.organization_id AND dh.facility_id=d.facility_id AND dh.department_id=d.id
    JOIN orion_private.department_versions dv ON dv.organization_id=dh.organization_id AND dv.facility_id=dh.facility_id AND dv.department_id=dh.department_id AND dv.id=dh.current_version_id
    JOIN orion_private.facilities f ON f.organization_id=a.organization_id AND f.id=a.facility_id JOIN orion_private.organizations o ON o.id=a.organization_id
    WHERE u.id=staff_id ORDER BY a.id FOR SHARE OF a,ah,v,m,u,d,dh,dv,f,o
  LOOP
    RETURN NEXT jsonb_build_object('assignmentId',r.id,'assignmentVersionId',r.version_id,'assignmentVersion',r.version,
      'status',CASE WHEN r.assignment_status='revoked' THEN 'revoked' WHEN r.effective_until IS NOT NULL AND r.effective_until<=observed THEN 'expired' ELSE 'active' END,
      'source',r.source_type,'effectiveFrom',r.effective_from,'effectiveUntil',r.effective_until,
      'organization',jsonb_build_object('id',r.organization_id,'name',r.organization_name,'status',r.organization_status),
      'facility',jsonb_build_object('id',r.facility_id,'name',r.facility_name,'status',r.facility_status),
      'department',jsonb_build_object('id',r.department_id,'code',r.department_code,'name',r.department_name,'kind',r.department_kind,'status',r.department_status),
      'membership',jsonb_build_object('id',r.membership_id,'legacyRole',r.legacy_role,'status',r.membership_status),
      'user',jsonb_build_object('id',r.user_id,'displayName',r.display_name,'status',r.user_status),
      'roles',r.roles_json,'allowPermissions',r.allow_permissions_json,'denyPermissions',r.deny_permissions_json,
      'effectivePermissions',orion_private.effective_permissions(r.roles_json,r.allow_permissions_json,r.deny_permissions_json));
  END LOOP;
END $$;
CREATE FUNCTION orion_private.actor_has_permission(org_id text, fac_id text, actor_member_id text, observed bigint, permission text) RETURNS boolean LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE staff_id text; a jsonb;
BEGIN
  SELECT m.user_id INTO staff_id FROM orion_private.memberships m WHERE m.organization_id=org_id AND m.facility_id=fac_id AND m.id=actor_member_id AND m.status='active' FOR SHARE;
  IF NOT FOUND THEN RETURN false; END IF;
  FOR a IN SELECT * FROM orion_private.own_assignments(staff_id) LOOP
    IF a#>>'{organization,id}'=org_id AND a#>>'{facility,id}'=fac_id AND a#>>'{membership,id}'=actor_member_id AND a->>'status'='active' AND a#>>'{organization,status}'='active' AND a#>>'{facility,status}'='active' AND a#>>'{department,status}'='active' AND a#>>'{membership,status}'='active' AND a#>>'{user,status}'='active' AND (a->>'effectiveFrom')::bigint<=observed AND ((a->>'effectiveUntil') IS NULL OR (a->>'effectiveUntil')::bigint>observed) AND NOT (a->'roles') ? 'service' AND (a->'effectivePermissions') ? permission THEN RETURN true; END IF;
  END LOOP;
  RETURN false;
END $$;
CREATE FUNCTION orion_private.require_assignment(assignment_id text, facility_id text, permission text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE staff orion_private.users := orion_private.principal(); selected jsonb; observed bigint := orion_private.now_ms();
BEGIN
  SELECT a INTO selected FROM orion_private.own_assignments(staff.id) a WHERE a->>'assignmentId'=assignment_id AND (facility_id IS NULL OR a#>>'{facility,id}'=facility_id);
  IF selected IS NULL OR selected->>'status'<>'active' OR selected#>>'{organization,status}'<>'active' OR selected#>>'{facility,status}'<>'active' OR selected#>>'{department,status}'<>'active' OR selected#>>'{membership,status}'<>'active' OR selected#>>'{user,status}'<>'active' OR (selected->>'effectiveFrom')::bigint>observed OR ((selected->>'effectiveUntil') IS NOT NULL AND (selected->>'effectiveUntil')::bigint<=observed) OR (selected->'roles') ? 'service' OR NOT (selected->'effectivePermissions') ? permission THEN RAISE EXCEPTION 'ACCESS_ASSIGNMENT_FORBIDDEN' USING ERRCODE='PT403'; END IF;
  RETURN selected;
END $$;

CREATE FUNCTION orion_private.append_audit(scope jsonb, action text, entity_id text, metadata jsonb DEFAULT '{}') RETURNS void LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE h orion_private.audit_stream_heads; e orion_private.audit_events; observed bigint := orion_private.now_ms();
BEGIN
  INSERT INTO orion_private.audit_stream_heads(id,organization_id,facility_id,updated_at) VALUES('audit-head-'||gen_random_uuid()::text,scope#>>'{organization,id}',scope#>>'{facility,id}',observed) ON CONFLICT(organization_id,facility_id) DO NOTHING;
  SELECT * INTO h FROM orion_private.audit_stream_heads WHERE organization_id=scope#>>'{organization,id}' AND facility_id=scope#>>'{facility,id}' FOR UPDATE;
  e.id:='audit-'||gen_random_uuid()::text; e.organization_id:=h.organization_id; e.facility_id:=h.facility_id; e.sequence:=h.last_sequence+1;
  e.actor_type:='user'; e.actor_id:=scope#>>'{user,id}'; e.actor_membership_id:=scope#>>'{membership,id}'; e.action:=action; e.outcome:='succeeded';
  e.purpose:=CASE WHEN action LIKE 'patient.%' THEN 'patient_identity_management' ELSE 'access_self_review' END; e.schema_version:=1;
  e.entity_type:=CASE WHEN action LIKE 'patient.%' THEN 'patient' ELSE 'access_assignment' END; e.entity_id:=entity_id; e.request_id:=gen_random_uuid()::text;
  e.metadata_json:=metadata::text; e.previous_hash:=h.last_event_hash; e.occurred_at:=greatest(observed,h.updated_at); e.event_hash:=orion_private.audit_hash(e);
  INSERT INTO orion_private.audit_events SELECT e.*;
  UPDATE orion_private.audit_stream_heads SET last_sequence=e.sequence,last_event_hash=e.event_hash,lock_version=lock_version+1,updated_at=e.occurred_at WHERE id=h.id;
  IF NOT FOUND THEN RAISE EXCEPTION 'AUDIT_UNAVAILABLE' USING ERRCODE='PT503'; END IF;
END $$;

CREATE FUNCTION orion_private.patient_json(org_id text, fac_id text, pat_id text, detail boolean DEFAULT false) RETURNS jsonb LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE result jsonb;
BEGIN
  SELECT jsonb_build_object('id',p.id,'medicalRecordNumber',p.medical_record_number,'displayName',v.display_name,'birthDate',v.birth_date,'sexAtBirth',v.sex_at_birth,'status',v.status,
    'testIin',(SELECT i.normalized_value FROM orion_private.patient_identifiers i WHERE i.organization_id=p.organization_id AND i.facility_id=p.facility_id AND i.patient_id=p.id AND i.kind='test_iin' AND i.status='active'),
    'phone',v.phone,'email',v.email,'address',v.address,'photoUrl',NULL,
    'encounterCount',(SELECT count(*) FROM orion_private.encounters e WHERE e.organization_id=p.organization_id AND e.facility_id=p.facility_id AND e.patient_id=p.id),
    'latestEncounter',(SELECT jsonb_build_object('id',e.id,'status',e.status,'reasonForVisit',e.reason_for_visit,'updatedAt',e.updated_at) FROM orion_private.encounters e WHERE e.organization_id=p.organization_id AND e.facility_id=p.facility_id AND e.patient_id=p.id ORDER BY e.updated_at DESC,e.id DESC LIMIT 1),
    'createdAt',p.created_at,'updatedAt',h.updated_at,'version',v.version)
    INTO result FROM orion_private.patients p JOIN orion_private.patient_profile_heads h ON h.organization_id=p.organization_id AND h.facility_id=p.facility_id AND h.patient_id=p.id JOIN orion_private.patient_profile_versions v ON v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.patient_id=h.patient_id AND v.id=h.current_version_id WHERE p.organization_id=org_id AND p.facility_id=fac_id AND p.id=pat_id;
  IF result IS NOT NULL AND detail THEN
    result:=result||jsonb_build_object('encounters',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',e.id,'status',e.status,'reasonForVisit',e.reason_for_visit,'startedAt',e.started_at,'endedAt',e.ended_at,'createdAt',e.created_at,'updatedAt',e.updated_at,'version',e.version) ORDER BY e.updated_at DESC,e.id DESC),'[]'::jsonb) FROM orion_private.encounters e WHERE e.organization_id=org_id AND e.facility_id=fac_id AND e.patient_id=pat_id),
      'profileHistory',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',v.id,'version',v.version,'status',v.status,'changeReason',v.change_reason,'createdAt',v.created_at,'actorDisplayName',u.display_name) ORDER BY v.version DESC),'[]'::jsonb) FROM orion_private.patient_profile_versions v JOIN orion_private.memberships m ON m.organization_id=v.organization_id AND m.facility_id=v.facility_id AND m.id=v.created_by_membership_id JOIN orion_private.users u ON u.id=m.user_id WHERE v.organization_id=org_id AND v.facility_id=fac_id AND v.patient_id=pat_id));
  END IF;
  RETURN result;
END $$;

CREATE FUNCTION public.orion_access_overview() RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE staff orion_private.users := orion_private.principal(); assignments jsonb; a jsonb;
BEGIN
  SELECT coalesce(jsonb_agg(x),'[]'::jsonb) INTO assignments FROM orion_private.own_assignments(staff.id) x;
  -- Global stream order, not per-staff assignmentId order, prevents two
  -- multi-facility overviews from taking the same audit heads in reverse.
  FOR a IN SELECT value FROM jsonb_array_elements(assignments) ORDER BY value#>>'{organization,id}',value#>>'{facility,id}',value->>'assignmentId' LOOP
    IF a->>'status'='active' AND a#>>'{organization,status}'='active' AND a#>>'{facility,status}'='active' AND a#>>'{department,status}'='active' AND a#>>'{membership,status}'='active' AND (a->'effectivePermissions') ? 'access.self.read' AND NOT (a->'roles') ? 'service' AND (a->>'effectiveFrom')::bigint<=orion_private.now_ms() THEN PERFORM orion_private.append_audit(a,'access.self.read',a->>'assignmentId',jsonb_build_object('assignmentVersion',a->'assignmentVersion')); END IF;
  END LOOP;
  PERFORM orion_private.principal();
  RETURN jsonb_build_object('user',jsonb_build_object('id',staff.id,'displayName',staff.display_name),'assignments',assignments,'observedAt',orion_private.now_ms());
END $$;
CREATE FUNCTION public.orion_patients_list(assignment_id text, facility_id text DEFAULT NULL, query text DEFAULT NULL, status text DEFAULT 'active', max_results integer DEFAULT 50) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope jsonb := orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read'); results jsonb; q text := lower(btrim(coalesce(query,'')));
BEGIN
  IF status IS NULL OR status NOT IN ('active','inactive','merged','all') OR max_results IS NULL OR max_results NOT BETWEEN 1 AND 100 OR length(q)>120 THEN RAISE EXCEPTION 'INVALID_QUERY' USING ERRCODE='PT400'; END IF;
  SELECT coalesce(jsonb_agg(item ORDER BY updated_at DESC,id DESC),'[]'::jsonb) INTO results FROM (
    SELECT p.id,h.updated_at,orion_private.patient_json(p.organization_id,p.facility_id,p.id) item FROM orion_private.patients p
    JOIN orion_private.patient_profile_heads h ON h.organization_id=p.organization_id AND h.facility_id=p.facility_id AND h.patient_id=p.id JOIN orion_private.patient_profile_versions v ON v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.patient_id=h.patient_id AND v.id=h.current_version_id
    WHERE p.organization_id=scope#>>'{organization,id}' AND p.facility_id=scope#>>'{facility,id}' AND (orion_patients_list.status='all' OR v.status=orion_patients_list.status)
      AND (q='' OR position(q IN lower(v.display_name))>0 OR position(q IN lower(p.medical_record_number))>0 OR position(q IN coalesce(lower(v.phone),''))>0 OR EXISTS(SELECT 1 FROM orion_private.patient_identifiers i WHERE i.organization_id=p.organization_id AND i.facility_id=p.facility_id AND i.patient_id=p.id AND i.status='active' AND i.kind='test_iin' AND position(q IN i.normalized_value)>0))
    ORDER BY h.updated_at DESC,p.id DESC LIMIT max_results
  ) listed;
  PERFORM orion_private.append_audit(scope,'patient.list','directory',jsonb_build_object('resultCount',jsonb_array_length(results)));
  PERFORM orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read');
  RETURN jsonb_build_object('patients',results,'accessAssignmentId',assignment_id,'observedAt',orion_private.now_ms());
END $$;
CREATE FUNCTION public.orion_patient_detail(assignment_id text, patient_id text, facility_id text DEFAULT NULL) RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = '' AS $$
DECLARE scope jsonb := orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read'); result jsonb;
BEGIN
  result:=orion_private.patient_json(scope#>>'{organization,id}',scope#>>'{facility,id}',patient_id,true);
  IF result IS NOT NULL THEN PERFORM orion_private.append_audit(scope,'patient.read',patient_id,jsonb_build_object('profileVersion',result->'version')); END IF;
  PERFORM orion_private.require_assignment(assignment_id,facility_id,'patient.directory.read');
  RETURN jsonb_build_object('patient',result,'accessAssignmentId',assignment_id,'observedAt',orion_private.now_ms());
END $$;

CREATE FUNCTION orion_private.clean_text(value text, minimum integer, maximum integer) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE cleaned text:=regexp_replace(btrim(value),'[[:space:]]+',' ','g');
BEGIN
  IF cleaned IS NULL OR length(cleaned) NOT BETWEEN minimum AND maximum OR value ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF; RETURN cleaned;
END $$;
CREATE FUNCTION orion_private.optional_text(value text, minimum integer, maximum integer) RETURNS text LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
BEGIN IF value IS NULL OR btrim(value)='' THEN RETURN NULL; END IF; RETURN orion_private.clean_text(value,minimum,maximum); END $$;
CREATE FUNCTION orion_private.valid_birth(value text) RETURNS text LANGUAGE plpgsql STABLE SET search_path = '' AS $$
DECLARE parsed date;
BEGIN
  IF value IS NULL THEN RETURN NULL; END IF;
  IF value !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF;
  BEGIN parsed:=value::date; EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END;
  IF to_char(parsed,'YYYY-MM-DD')<>value OR parsed>(clock_timestamp() AT TIME ZONE 'UTC')::date THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF; RETURN value;
END $$;
CREATE FUNCTION orion_private.patient_command(assignment_id text, payload jsonb, facility_id text, operation text) RETURNS jsonb LANGUAGE plpgsql VOLATILE SET search_path = '' AS $$
DECLARE scope jsonb:=orion_private.require_assignment(assignment_id,facility_id,'patient.profile.write');
  org_id text:=scope#>>'{organization,id}'; fac_id text:=scope#>>'{facility,id}'; member_id text:=scope#>>'{membership,id}';
  normalized jsonb; name text; birth text; sex text; phone text; email text; address text; iin text; reason text;
  key uuid; expected integer; pat_id text; request_hash text; replay orion_private.command_idempotency;
  current_profile orion_private.patient_profile_versions; head orion_private.patient_profile_heads;
  observed bigint; profile_id text; result jsonb; supplied_field text; allowed_fields text[];
BEGIN
  IF jsonb_typeof(payload) IS DISTINCT FROM 'object' OR octet_length(payload::text)>16384 THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF;
  IF payload->'testDataAcknowledged' IS DISTINCT FROM 'true'::jsonb THEN RAISE EXCEPTION 'DATA_MODE_NOT_ACKNOWLEDGED' USING ERRCODE='PT400'; END IF;
  allowed_fields:=CASE operation
    WHEN 'patient.create' THEN ARRAY['displayName','birthDate','sexAtBirth','phone','email','address','testIin','idempotencyKey','testDataAcknowledged']
    WHEN 'patient.update' THEN ARRAY['displayName','birthDate','sexAtBirth','phone','email','address','changeReason','expectedVersion','idempotencyKey','patientId','testDataAcknowledged']
    WHEN 'patient.archive' THEN ARRAY['changeReason','expectedVersion','idempotencyKey','patientId','testDataAcknowledged']
    ELSE NULL END;
  IF allowed_fields IS NULL THEN RAISE EXCEPTION 'INVALID_OPERATION' USING ERRCODE='PT400'; END IF;
  FOR supplied_field IN SELECT jsonb_object_keys(payload) LOOP
    IF supplied_field <> ALL(allowed_fields) THEN RAISE EXCEPTION 'INVALID_PATIENT_FIELD' USING ERRCODE='PT400'; END IF;
  END LOOP;
  BEGIN key:=(payload->>'idempotencyKey')::uuid; EXCEPTION WHEN invalid_text_representation THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END;
  IF key IS NULL THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF;
  IF operation<>'patient.create' THEN
    pat_id:=orion_private.clean_text(payload->>'patientId',1,160); reason:=orion_private.clean_text(payload->>'changeReason',3,300);
    IF jsonb_typeof(payload->'expectedVersion') IS DISTINCT FROM 'number' OR (payload->>'expectedVersion') !~ '^[1-9][0-9]{0,8}$' THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF; expected:=(payload->>'expectedVersion')::integer;
  END IF;
  IF operation<>'patient.archive' THEN
    FOREACH supplied_field IN ARRAY ARRAY['displayName','birthDate','sexAtBirth','phone','email','address'] LOOP
      IF NOT payload ? supplied_field OR (payload->supplied_field <> 'null'::jsonb AND jsonb_typeof(payload->supplied_field) <> 'string') THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF;
    END LOOP;
    name:=orion_private.clean_text(payload->>'displayName',2,160); birth:=orion_private.valid_birth(payload->>'birthDate'); sex:=payload->>'sexAtBirth';
    IF sex IS NULL OR sex NOT IN ('female','male','unknown','not_recorded') THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF;
    phone:=orion_private.optional_text(payload->>'phone',5,40); email:=lower(orion_private.optional_text(payload->>'email',3,160)); address:=orion_private.optional_text(payload->>'address',3,300);
    IF email IS NOT NULL AND email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF;
    normalized:=jsonb_build_object('displayName',name,'birthDate',birth,'sexAtBirth',sex,'phone',phone,'email',email,'address',address);
  ELSE normalized:='{}'; END IF;
  IF operation='patient.create' THEN
    IF NOT payload ? 'testIin' OR (payload->'testIin'<>'null'::jsonb AND jsonb_typeof(payload->'testIin')<>'string') THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF;
    iin:=nullif(btrim(payload->>'testIin'),''); IF iin IS NOT NULL AND iin !~ '^[0-9]{12}$' THEN RAISE EXCEPTION 'INVALID_PATIENT' USING ERRCODE='PT400'; END IF;
    normalized:=normalized||jsonb_build_object('testIin',iin);
  ELSE normalized:=normalized||jsonb_build_object('patientId',pat_id,'expectedVersion',expected,'changeReason',reason); END IF;
  request_hash:=encode(sha256(convert_to((normalized||jsonb_build_object('operation',operation,'accessAssignmentId',assignment_id,'actorId',scope#>>'{user,id}'))::text,'UTF8')),'hex');
  -- One writer mutex per tenant/facility covers duplicate detection, commands,
  -- profiles and audit. Other facilities proceed independently. It is acquired
  -- before replay lookup and every clinical write; no preflight grant is used.
  -- Advisory lock avoids upgrading the authority row's SHARE lock to UPDATE:
  -- concurrent writers must not deadlock while retaining revocation fences.
  PERFORM pg_advisory_xact_lock(hashtextextended(org_id||':'||fac_id,0));
  SELECT * INTO replay FROM orion_private.command_idempotency c WHERE c.organization_id=org_id AND c.facility_id=fac_id AND c.actor_membership_id=member_id AND c.operation=patient_command.operation AND c.idempotency_key=key;
  IF FOUND THEN
    IF replay.request_hash<>request_hash OR replay.access_assignment_id<>assignment_id THEN RAISE EXCEPTION 'PATIENT_COMMAND_CONFLICT' USING ERRCODE='PT409'; END IF;
    result:=orion_private.patient_json(org_id,fac_id,replay.result_resource_id,true);
    IF result IS NULL THEN RAISE EXCEPTION 'PATIENT_COMMAND_CONFLICT' USING ERRCODE='PT409'; END IF;
    PERFORM orion_private.append_audit(scope,'patient.command.replay',replay.result_resource_id,jsonb_build_object('operation',operation,'profileVersion',result->'version'));
    PERFORM orion_private.require_assignment(assignment_id,facility_id,'patient.profile.write');
    RETURN jsonb_build_object('patient',result,'accessAssignmentId',assignment_id,'observedAt',orion_private.now_ms(),'replayed',true);
  END IF;
  observed:=orion_private.now_ms(); profile_id:='patient-profile-'||gen_random_uuid()::text;
  IF operation<>'patient.create' THEN
    SELECT * INTO head FROM orion_private.patient_profile_heads h WHERE h.organization_id=org_id AND h.facility_id=fac_id AND h.patient_id=pat_id FOR UPDATE;
    IF NOT FOUND THEN RAISE EXCEPTION 'PATIENT_NOT_FOUND' USING ERRCODE='PT404'; END IF;
    SELECT * INTO current_profile FROM orion_private.patient_profile_versions v WHERE v.organization_id=org_id AND v.facility_id=fac_id AND v.patient_id=pat_id AND v.id=head.current_version_id;
    IF current_profile.version<>expected THEN RAISE EXCEPTION 'PATIENT_VERSION_CONFLICT' USING ERRCODE='PT409', DETAIL=jsonb_build_object('currentVersion',current_profile.version,'currentStatus',current_profile.status)::text; END IF;
    IF current_profile.status='inactive' AND operation='patient.archive' THEN RAISE EXCEPTION 'PATIENT_ALREADY_ARCHIVED' USING ERRCODE='PT422'; END IF;
    IF current_profile.status<>'active' THEN RAISE EXCEPTION 'PATIENT_PROFILE_NOT_ACTIVE' USING ERRCODE='PT409'; END IF;
    IF operation='patient.archive' THEN name:=current_profile.display_name; birth:=current_profile.birth_date; sex:=current_profile.sex_at_birth; phone:=current_profile.phone; email:=current_profile.email; address:=current_profile.address;
    ELSIF ROW(name,birth,sex,phone,email,address) IS NOT DISTINCT FROM ROW(current_profile.display_name,current_profile.birth_date,current_profile.sex_at_birth,current_profile.phone,current_profile.email,current_profile.address) THEN RAISE EXCEPTION 'PATIENT_PROFILE_UNCHANGED' USING ERRCODE='PT422'; END IF;
    SELECT i.normalized_value INTO iin FROM orion_private.patient_identifiers i WHERE i.organization_id=org_id AND i.facility_id=fac_id AND i.patient_id=pat_id AND i.kind='test_iin' AND i.status='active';
  END IF;
  IF operation<>'patient.archive' AND EXISTS(
    SELECT 1 FROM orion_private.patients p JOIN orion_private.patient_profile_heads h ON h.organization_id=p.organization_id AND h.facility_id=p.facility_id AND h.patient_id=p.id JOIN orion_private.patient_profile_versions v ON v.organization_id=h.organization_id AND v.facility_id=h.facility_id AND v.patient_id=h.patient_id AND v.id=h.current_version_id
    WHERE p.organization_id=org_id AND p.facility_id=fac_id AND v.status='active' AND p.id IS DISTINCT FROM pat_id AND ((lower(v.display_name)=lower(name) AND v.birth_date IS NOT DISTINCT FROM birth) OR (iin IS NOT NULL AND EXISTS(SELECT 1 FROM orion_private.patient_identifiers i WHERE i.organization_id=org_id AND i.facility_id=fac_id AND i.patient_id=p.id AND i.kind='test_iin' AND i.status='active' AND i.normalized_value=iin)))
  ) THEN RAISE EXCEPTION 'PATIENT_DUPLICATE_CANDIDATE' USING ERRCODE='PT409'; END IF;
  IF operation='patient.create' THEN
    pat_id:='patient-'||gen_random_uuid()::text;
    INSERT INTO orion_private.patients VALUES(pat_id,org_id,fac_id,'OR-'||upper(substr(gen_random_uuid()::text,1,8)),name,birth,sex,'active',observed,observed,1);
    INSERT INTO orion_private.patient_profile_versions VALUES(profile_id,org_id,fac_id,pat_id,1,name,birth,sex,phone,email,address,'active',member_id,'Первичная регистрация карточки',NULL,observed);
    INSERT INTO orion_private.patient_profile_heads VALUES('patient-profile-head-'||gen_random_uuid()::text,org_id,fac_id,pat_id,profile_id,1,observed);
    IF iin IS NOT NULL THEN INSERT INTO orion_private.patient_identifiers VALUES('patient-identifier-'||gen_random_uuid()::text,org_id,fac_id,pat_id,'test_iin',iin,right(iin,4),'active',member_id,observed,observed,1); END IF;
  ELSE
    observed:=greatest(observed,head.updated_at,current_profile.created_at);
    INSERT INTO orion_private.patient_profile_versions VALUES(profile_id,org_id,fac_id,pat_id,current_profile.version+1,name,birth,sex,phone,email,address,CASE WHEN operation='patient.archive' THEN 'inactive' ELSE 'active' END,member_id,reason,current_profile.id,observed);
    UPDATE orion_private.patient_profile_heads SET current_version_id=profile_id,lock_version=lock_version+1,updated_at=observed WHERE id=head.id AND current_version_id=current_profile.id AND lock_version=head.lock_version;
    IF NOT FOUND THEN RAISE EXCEPTION 'PATIENT_VERSION_CONFLICT' USING ERRCODE='PT409'; END IF;
  END IF;
  INSERT INTO orion_private.command_idempotency VALUES('command-'||gen_random_uuid()::text,org_id,fac_id,member_id,assignment_id,operation,key,request_hash,pat_id,observed);
  result:=orion_private.patient_json(org_id,fac_id,pat_id,true);
  PERFORM orion_private.append_audit(scope,operation,pat_id,jsonb_build_object('profileVersion',result->'version','hasTestIin',iin IS NOT NULL,'hasContact',phone IS NOT NULL OR email IS NOT NULL OR address IS NOT NULL));
  PERFORM orion_private.require_assignment(assignment_id,facility_id,'patient.profile.write');
  RETURN jsonb_build_object('patient',result,'accessAssignmentId',assignment_id,'observedAt',orion_private.now_ms(),'replayed',false);
END $$;
CREATE FUNCTION public.orion_patient_create(assignment_id text, payload jsonb, facility_id text DEFAULT NULL) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$ SELECT orion_private.patient_command(assignment_id,payload,facility_id,'patient.create') $$;
CREATE FUNCTION public.orion_patient_update(assignment_id text, payload jsonb, facility_id text DEFAULT NULL) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$ SELECT orion_private.patient_command(assignment_id,payload,facility_id,'patient.update') $$;
CREATE FUNCTION public.orion_patient_archive(assignment_id text, payload jsonb, facility_id text DEFAULT NULL) RETURNS jsonb LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = '' AS $$ SELECT orion_private.patient_command(assignment_id,payload,facility_id,'patient.archive') $$;

-- API roles have no table path; only the six checked entry points are callable.
DO $$ DECLARE tab record; BEGIN
  FOR tab IN SELECT tablename FROM pg_tables WHERE schemaname='orion_private' LOOP EXECUTE format('ALTER TABLE orion_private.%I ENABLE ROW LEVEL SECURITY',tab.tablename); END LOOP;
END $$;
REVOKE ALL ON SCHEMA orion_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA orion_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA orion_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA orion_private FROM PUBLIC,anon,authenticated,service_role;
REVOKE ALL ON FUNCTION public.orion_access_overview(),public.orion_patients_list(text,text,text,text,integer),public.orion_patient_detail(text,text,text),public.orion_patient_create(text,jsonb,text),public.orion_patient_update(text,jsonb,text),public.orion_patient_archive(text,jsonb,text) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.orion_access_overview(),public.orion_patients_list(text,text,text,text,integer),public.orion_patient_detail(text,text,text),public.orion_patient_create(text,jsonb,text),public.orion_patient_update(text,jsonb,text),public.orion_patient_archive(text,jsonb,text) TO authenticated;
COMMIT;
