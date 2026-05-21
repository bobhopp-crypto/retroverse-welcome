-- 1104_repair_missing_album_external_keys.sql
-- Load repair CSV produced by scripts/repair_missing_album_external_keys.ts
-- Idempotent: skips external_key collisions.

BEGIN;

CREATE TABLE IF NOT EXISTS staging_album_external_key_buffer (
  album_id text,
  external_key text,
  source text,
  confidence_score text
);

INSERT INTO album_external_keys (album_id, external_key, source, confidence_score)
SELECT
  b.album_id::bigint,
  upper(trim(b.external_key)),
  coalesce(nullif(trim(b.source), ''), 'deterministic_hash'),
  NULLIF(trim(b.confidence_score), '')::int
FROM staging_album_external_key_buffer b
WHERE b.album_id ~ '^[0-9]+$'
  AND b.external_key ~* '^RVAL[0-9]{6}$'
ON CONFLICT (external_key) DO NOTHING;

COMMIT;

SELECT count(*)::int AS external_keys FROM album_external_keys;
