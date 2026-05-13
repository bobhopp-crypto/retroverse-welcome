-- Run after: migrations/20260510140000_chart_appearances_album_optional_track.sql
-- Confirms album-first chart rows + optional track anchoring.

-- 1) Column exists
select
  column_name,
  is_nullable
from information_schema.columns
where table_schema = 'public'
  and table_name = 'retroverse_chart_appearances'
  and column_name in ('retroverse_album_id', 'retroverse_track_id');

-- 2) CHECK constraint (name may vary slightly by PG version)
select conname, pg_get_constraintdef(c.oid) as def
from pg_constraint c
join pg_class t on t.oid = c.conrelid
join pg_namespace n on n.oid = t.relnamespace
where n.nspname = 'public'
  and t.relname = 'retroverse_chart_appearances'
  and c.contype = 'c';

-- 3) Index on (retroverse_album_id, chart_date)
select indexname, indexdef
from pg_indexes
where schemaname = 'public'
  and tablename = 'retroverse_chart_appearances'
  and indexdef ilike '%retroverse_album_id%chart_date%';
