-- Canonical Billboard 200 album chart serving layer (Retroscope-safe).
-- Raw `retroverse_chart_appearances` is unchanged; this is a derived table + audit conflicts.

-- ---------------------------------------------------------------------------
-- Step 1: canonical spine (one album × one chart week → one position)
-- ---------------------------------------------------------------------------

create table if not exists public.canonical_album_chart_runs (
  retroverse_album_id text not null
    references public.retroverse_albums (retroverse_album_id),
  chart_date date not null,
  chart_position integer not null
    check (chart_position between 1 and 200),
  source_chart_name text,
  source_resolution text,
  created_at timestamptz not null default now(),
  primary key (retroverse_album_id, chart_date)
);

create index if not exists idx_canonical_album_chart_runs_date
  on public.canonical_album_chart_runs (chart_date);

create index if not exists idx_canonical_album_chart_runs_album
  on public.canonical_album_chart_runs (retroverse_album_id);

comment on table public.canonical_album_chart_runs is
  'Deterministic Billboard 200 weekly positions per album; derived from retroverse_chart_appearances (dedupe: MIN position per album/week).';

-- ---------------------------------------------------------------------------
-- Step 2: conflict / audit queue (does not block canonical build)
-- ---------------------------------------------------------------------------

create table if not exists public.canonical_album_chart_conflicts (
  id bigserial primary key,
  conflict_type text not null,
  retroverse_album_id text,
  chart_date date,
  chart_position integer,
  source_chart_name text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists idx_canonical_album_chart_conflicts_type
  on public.canonical_album_chart_conflicts (conflict_type);

create index if not exists idx_canonical_album_chart_conflicts_album_date
  on public.canonical_album_chart_conflicts (retroverse_album_id, chart_date);

comment on table public.canonical_album_chart_conflicts is
  'Warehouse anomalies (duplicate keys, multi-position weeks, multi-album rank collisions) for human review; raw table untouched.';

-- ---------------------------------------------------------------------------
-- Base filter (Billboard 200 album rows eligible for spine)
-- ---------------------------------------------------------------------------

-- Clear serving tables on re-apply (migration runs once per environment;
-- for manual refresh, truncate these two tables then re-run INSERT sections).
truncate table public.canonical_album_chart_conflicts, public.canonical_album_chart_runs;

-- ---------------------------------------------------------------------------
-- Step 4a: duplicate logical rows (same album + week + position + chart name)
-- ---------------------------------------------------------------------------

with base as (
  select
    retroverse_chart_id,
    retroverse_album_id,
    chart_date::date as chart_date,
    chart_position,
    chart_name
  from public.retroverse_chart_appearances
  where chart_name = 'Billboard 200'
    and chart_position between 1 and 200
    and retroverse_album_id is not null
    and chart_date is not null
),
dup_groups as (
  select
    retroverse_album_id,
    chart_date,
    chart_position,
    chart_name,
    count(*)::bigint as row_count,
    jsonb_agg(retroverse_chart_id order by retroverse_chart_id) as retroverse_chart_ids
  from base
  group by retroverse_album_id, chart_date, chart_position, chart_name
  having count(*) > 1
)
insert into public.canonical_album_chart_conflicts (
  conflict_type,
  retroverse_album_id,
  chart_date,
  chart_position,
  source_chart_name,
  details
)
select
  'duplicate_source_row',
  retroverse_album_id,
  chart_date,
  chart_position,
  chart_name,
  jsonb_build_object(
    'row_count', row_count,
    'retroverse_chart_ids', retroverse_chart_ids
  )
from dup_groups;

-- ---------------------------------------------------------------------------
-- Step 4b: same album + same week + multiple distinct positions (pre-dedupe)
-- ---------------------------------------------------------------------------

with base as (
  select
    retroverse_chart_id,
    retroverse_album_id,
    chart_date::date as chart_date,
    chart_position,
    chart_name
  from public.retroverse_chart_appearances
  where chart_name = 'Billboard 200'
    and chart_position between 1 and 200
    and retroverse_album_id is not null
    and chart_date is not null
),
multi_pos as (
  select
    retroverse_album_id,
    chart_date,
    chart_name,
    count(*)::bigint as source_row_count,
    count(distinct chart_position)::bigint as distinct_position_count,
    min(chart_position) as min_chart_position,
    max(chart_position) as max_chart_position,
    to_jsonb(
      array_agg(distinct chart_position order by chart_position)
    ) as distinct_positions
  from base
  group by retroverse_album_id, chart_date, chart_name
  having count(distinct chart_position) > 1
)
insert into public.canonical_album_chart_conflicts (
  conflict_type,
  retroverse_album_id,
  chart_date,
  chart_position,
  source_chart_name,
  details
)
select
  'multi_position_same_week',
  retroverse_album_id,
  chart_date,
  null,
  chart_name,
  jsonb_build_object(
    'source_row_count', source_row_count,
    'distinct_position_count', distinct_position_count,
    'min_chart_position', min_chart_position,
    'max_chart_position', max_chart_position,
    'distinct_positions', distinct_positions,
    'canonical_resolution', 'MIN(chart_position) kept in canonical_album_chart_runs'
  )
from multi_pos;

-- ---------------------------------------------------------------------------
-- Step 4c: same chart week + same position + multiple albums
-- ---------------------------------------------------------------------------

with base as (
  select
    retroverse_chart_id,
    retroverse_album_id,
    chart_date::date as chart_date,
    chart_position,
    chart_name
  from public.retroverse_chart_appearances
  where chart_name = 'Billboard 200'
    and chart_position between 1 and 200
    and retroverse_album_id is not null
    and chart_date is not null
),
multi_album as (
  select
    chart_date,
    chart_position,
    chart_name,
    count(distinct retroverse_album_id)::bigint as distinct_album_count,
    to_jsonb(
      array_agg(distinct retroverse_album_id order by retroverse_album_id)
    ) as retroverse_album_ids
  from base
  group by chart_date, chart_position, chart_name
  having count(distinct retroverse_album_id) > 1
)
insert into public.canonical_album_chart_conflicts (
  conflict_type,
  retroverse_album_id,
  chart_date,
  chart_position,
  source_chart_name,
  details
)
select
  'multi_album_same_rank_week',
  null,
  chart_date,
  chart_position,
  chart_name,
    jsonb_build_object(
    'distinct_album_count', distinct_album_count,
    'retroverse_album_ids', coalesce(retroverse_album_ids, '[]'::jsonb)
  )
from multi_album;

-- ---------------------------------------------------------------------------
-- Step 3: populate canonical (MIN chart_position per album + week)
-- ---------------------------------------------------------------------------

insert into public.canonical_album_chart_runs (
  retroverse_album_id,
  chart_date,
  chart_position,
  source_chart_name,
  source_resolution
)
select
  retroverse_album_id,
  chart_date::date,
  min(chart_position)::integer,
  'Billboard 200',
  'dedup_min_position_v1'
from public.retroverse_chart_appearances
where chart_name = 'Billboard 200'
  and chart_position between 1 and 200
  and retroverse_album_id is not null
  and chart_date is not null
group by retroverse_album_id, chart_date::date;

-- ---------------------------------------------------------------------------
-- Validation RPC (service role / SQL console; not wired to Retroscope UI)
-- ---------------------------------------------------------------------------

create or replace function public.canonical_album_chart_validation_report(p_album_id text default 'RVAL000003')
returns jsonb
language sql
stable
as $$
  with raw_f as (
    select *
    from public.retroverse_chart_appearances
    where chart_name = 'Billboard 200'
      and chart_position between 1 and 200
      and retroverse_album_id is not null
      and chart_date is not null
  ),
  conflicts_by_type as (
    select conflict_type, count(*)::bigint as c
    from public.canonical_album_chart_conflicts
    group by conflict_type
  ),
  album_c as (
    select *
    from public.canonical_album_chart_runs
    where retroverse_album_id = p_album_id
  ),
  album_dup_weeks as (
    select coalesce(count(*), 0)::bigint as n
    from (
      select chart_date
      from album_c
      group by chart_date
      having count(*) > 1
    ) s
  ),
  album_oob as (
    select coalesce(count(*), 0)::bigint as n
    from album_c
    where chart_position < 1 or chart_position > 200
  )
  select jsonb_build_object(
    'album_id', p_album_id,
    'album_sample', jsonb_build_object(
      'first_chart_date', (select min(chart_date) from album_c),
      'last_chart_date', (select max(chart_date) from album_c),
      'peak_chart_position', (select min(chart_position) from album_c),
      'total_canonical_weeks', (select count(*) from album_c),
      'positions_outside_1_200', (select n from album_oob),
      'duplicate_album_week_rows_in_canonical', (select n from album_dup_weeks),
      'exactly_one_row_per_week',
      (select case
        when (select count(*) from album_c) = 0 then null::boolean
        else (select count(*) from album_c) = (select count(distinct chart_date) from album_c)
      end)
    ),
    'global', jsonb_build_object(
      'raw_billboard200_rows_used', (select count(*) from raw_f),
      'canonical_rows_created', (select count(*) from public.canonical_album_chart_runs),
      'conflict_rows_total', (select count(*) from public.canonical_album_chart_conflicts),
      'conflicts_by_type', coalesce(
        (select jsonb_object_agg(conflict_type, c) from conflicts_by_type),
        '{}'::jsonb
      )
    )
  );
$$;

comment on function public.canonical_album_chart_validation_report(text) is
  'One-shot sanity JSON for canonical chart spine + optional album spot-check (default Rumours pilot id).';

revoke all on function public.canonical_album_chart_validation_report(text) from public;
grant execute on function public.canonical_album_chart_validation_report(text) to service_role;
