-- Forward correction: regexp_split_to_table('', '') yields an empty element,
-- whose ascii value must not count as one valid title character.
BEGIN;
DO $$ BEGIN
  IF current_database()<>'orion_crm_local' THEN RAISE EXCEPTION 'CRM_TARGET_DATABASE_REQUIRED'; END IF;
END $$;
CREATE OR REPLACE FUNCTION orion_crm.command_title_v1(p_value jsonb) RETURNS text
LANGUAGE plpgsql IMMUTABLE SET search_path='' AS $$
DECLARE result text; utf16_length integer;
BEGIN
  IF jsonb_typeof(p_value) IS DISTINCT FROM 'string' THEN RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  result:=p_value#>>'{}';
  SELECT coalesce(sum(CASE WHEN ascii(c)>65535 THEN 2 ELSE 1 END),0)::integer INTO utf16_length FROM regexp_split_to_table(result,'') c;
  IF length(result)=0 OR utf16_length NOT BETWEEN 1 AND 240 OR result ~ U&'[\0001-\001F\007F-\009F]' OR
    result ~ U&'^[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]|[\0009-\000D\0020\00A0\1680\2000-\200A\2028\2029\202F\205F\3000\FEFF]$' THEN
    RAISE EXCEPTION 'CRM_INVALID_COMMAND' USING ERRCODE='PT400'; END IF;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION orion_crm.command_title_v1(jsonb) FROM PUBLIC,orion_crm_app;
COMMIT;
