-- Rank inspection report: fast keyset pages via SQL (avoids PostgREST table parser timeouts on large corpora).

create index if not exists idx_retroverse_chart_appearances_date_chart_id
  on public.retroverse_chart_appearances (chart_date, retroverse_chart_id);

create index if not exists idx_retroverse_chart_appearances_chart_name
  on public.retroverse_chart_appearances (chart_name);

-- Single-plan read: appearance album + optional track album (LEFT JOIN only when resolving fallback in app).
create or replace function public.retroverse_rank_inspection_chart_page(
  p_chart_date_start date,
  p_chart_date_end_exclusive date,
  p_after_date date default null,
  p_after_chart_id text default null,
  p_limit integer default 2500
)
returns table (
  retroverse_chart_id text,
  chart_date date,
  chart_name text,
  chart_position integer,
  weeks_on_chart integer,
  appearance_album_id text,
  retroverse_track_id text,
  track_album_id text
)
language sql
stable
security invoker
set search_path = public
as $$
  select
    ch.retroverse_chart_id,
    ch.chart_date,
    ch.chart_name,
    ch.chart_position,
    ch.weeks_on_chart,
    ch.retroverse_album_id as appearance_album_id,
    ch.retroverse_track_id,
    t.retroverse_album_id as track_album_id
  from public.retroverse_chart_appearances ch
  left join public.retroverse_tracks t
    on t.retroverse_track_id = ch.retroverse_track_id
  where ch.chart_date >= p_chart_date_start
    and ch.chart_date < p_chart_date_end_exclusive
    and (
      p_after_date is null
      or row (ch.chart_date, ch.retroverse_chart_id) > row (p_after_date, p_after_chart_id)
    )
  order by ch.chart_date, ch.retroverse_chart_id
  limit greatest(1, least(coalesce(p_limit, 2500), 8000));
$$;

comment on function public.retroverse_rank_inspection_chart_page(date, date, date, text, integer) is
  'Paged chart rows for scripts/report_retroverse_rank_inspection.ts (keyset on chart_date, retroverse_chart_id).';

create or replace function public.retroverse_rank_inspection_chart_date_bounds()
returns table (
  min_date date,
  max_date date
)
language sql
stable
security invoker
set search_path = public
as $$
  select min(ch.chart_date), max(ch.chart_date)
  from public.retroverse_chart_appearances ch;
$$;

comment on function public.retroverse_rank_inspection_chart_date_bounds() is
  'Min/max chart_date for rank inspection report year span.';

grant execute on function public.retroverse_rank_inspection_chart_page(date, date, date, text, integer)
  to anon, authenticated, service_role;
grant execute on function public.retroverse_rank_inspection_chart_date_bounds()
  to anon, authenticated, service_role;
