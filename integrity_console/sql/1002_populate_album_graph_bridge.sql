-- 1002_populate_album_graph_bridge.sql
-- Load album_external_keys from CSV (see scripts/populate_album_graph_bridge.py).
--
-- \copy staging_album_external_key_buffer (album_id, external_key, source, confidence_score)
--   FROM 'exports/graph/album_external_keys.csv' CSV HEADER

BEGIN;

INSERT INTO album_external_keys (album_id, external_key, source, confidence_score)
SELECT
  b.album_id::bigint,
  upper(trim(b.external_key)),
  coalesce(nullif(trim(b.source), ''), 'dossier_match'),
  NULLIF(trim(b.confidence_score), '')::int
FROM staging_album_external_key_buffer b
WHERE b.album_id ~ '^[0-9]+$'
  AND b.external_key ~* '^RVAL[0-9]{6}$'
ON CONFLICT (external_key) DO NOTHING;

COMMIT;

SELECT count(*)::int AS external_keys FROM album_external_keys;
