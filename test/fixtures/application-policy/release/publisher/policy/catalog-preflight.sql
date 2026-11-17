
DO $preflight$
DECLARE
  current_payload jsonb;
  catalog_schema_version integer;
  catalog_level_count integer;
  catalog_release_hash text;
  allowed_hashes constant text[] := {{allowedHashes}};
BEGIN
  IF to_regclass('public.t_bacteria_level_catalog') IS NULL THEN
    RAISE NOTICE 'bacteria catalog is absent and will be initialized by the release';
    RETURN;
  END IF;
  SELECT payload::jsonb INTO current_payload FROM t_bacteria_level_catalog WHERE id = 1;
  IF current_payload IS NULL THEN
    RAISE EXCEPTION 'Bacteria catalog row 1 is missing';
  END IF;
  catalog_schema_version := (current_payload->>'schemaVersion')::integer;
  catalog_level_count := jsonb_array_length(current_payload->'levels');
  catalog_release_hash := current_payload->>'releaseHash';
  IF catalog_schema_version < 1 OR catalog_level_count < 500 THEN
    RAISE EXCEPTION 'Bacteria catalog is incomplete: schema %, levels %', catalog_schema_version, catalog_level_count;
  END IF;
  IF catalog_release_hash IS NOT NULL AND array_length(allowed_hashes, 1) IS NOT NULL
     AND NOT catalog_release_hash = ANY(allowed_hashes) THEN
    RAISE EXCEPTION 'Bacteria catalog hash % is outside the declared migration chain', catalog_release_hash;
  END IF;
  RAISE NOTICE 'bacteria catalog compatible: schema %, levels %, hash %', catalog_schema_version, catalog_level_count, catalog_release_hash;
END
$preflight$;
