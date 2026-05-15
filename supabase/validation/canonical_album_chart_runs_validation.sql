-- Ad-hoc checks after applying 20260513120000_canonical_album_chart_runs.sql
-- Run in SQL editor or: psql $DATABASE_URL -f supabase/validation/canonical_album_chart_runs_validation.sql

select public.canonical_album_chart_validation_report('RVAL000003') as report;

-- Optional: spot-check raw vs canonical for one week
-- select chart_date, chart_position, retroverse_chart_id
-- from public.retroverse_chart_appearances
-- where chart_name = 'Billboard 200' and retroverse_album_id = 'RVAL000003'
-- order by chart_date desc limit 20;
