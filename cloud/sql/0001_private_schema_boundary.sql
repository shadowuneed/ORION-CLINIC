-- Dedicated ORION test project only. Does not migrate any local clinical rows.
-- Clinical schema stays outside the automatically exposed public Data API.
BEGIN;

CREATE SCHEMA IF NOT EXISTS orion_private;
REVOKE ALL ON SCHEMA orion_private FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_private
  REVOKE ALL ON TABLES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_private
  REVOKE ALL ON SEQUENCES FROM PUBLIC, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA orion_private
  REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon, authenticated, service_role;

COMMIT;

-- Proof only; there are intentionally no patient or employee tables yet.
SELECT nspname AS schema_name,
  has_schema_privilege('anon', nspname, 'USAGE') AS anonymous_access,
  has_schema_privilege('authenticated', nspname, 'USAGE') AS authenticated_access,
  has_schema_privilege('service_role', nspname, 'USAGE') AS service_role_access
FROM pg_namespace WHERE nspname = 'orion_private';
