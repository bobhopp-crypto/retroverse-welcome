-- Retroverse canonical temporal backbone (RVWK).
-- Immutable sequential week coordinates; NOT calendar ISO weeks; NOT Billboard-specific.
-- Epoch: 1940-01-07 = RVWK000001 (Sunday-aligned 7-day inclusive span).
-- Internal joins/sorts: always week_sequence (integer). rvwk_id is presentation only.

-- ---------------------------------------------------------------------------
-- Step 1 — retroverse_weeks
-- ---------------------------------------------------------------------------

create table if not exists public.retroverse_weeks (
  week_sequence integer primary key,
  rvwk_id text not null unique,
  start_date date not null,
  end_date date not null,
  calendar_year integer not null,
  calendar_month integer not null,
  quarter integer not null,
  decade integer not null,
  retroverse_era text,
  display_label text not null,
  created_at timestamptz not null default now(),
  constraint chk_retroverse_weeks_span check (end_date = start_date + 6),
  constraint chk_retroverse_weeks_anchor check (
    start_date = date '1940-01-07' + (week_sequence - 1) * interval '7 days'
  ),
  constraint chk_retroverse_weeks_month check (calendar_month between 1 and 12),
  constraint chk_retroverse_weeks_quarter check (quarter between 1 and 4),
  constraint chk_retroverse_weeks_rvwk_format check (rvwk_id ~ '^RVWK[0-9]{6}$')
);

comment on table public.retroverse_weeks is
  'RVWK: universal Retroverse week index. week_sequence is the canonical coordinate; rvwk_id is zero-padded display only.';

-- ---------------------------------------------------------------------------
-- Step 2 — generate rows (epoch through week containing 2035-12-31)
-- ---------------------------------------------------------------------------

insert into public.retroverse_weeks (
  week_sequence,
  rvwk_id,
  start_date,
  end_date,
  calendar_year,
  calendar_month,
  quarter,
  decade,
  retroverse_era,
  display_label
)
select
  s,
  'RVWK' || lpad(s::text, 6, '0'),
  (date '1940-01-07' + (s - 1) * 7) as sd,
  (date '1940-01-07' + (s - 1) * 7 + 6) as ed,
  extract(year from (date '1940-01-07' + (s - 1) * 7))::integer,
  extract(month from (date '1940-01-07' + (s - 1) * 7))::integer,
  extract(quarter from (date '1940-01-07' + (s - 1) * 7))::integer,
  (floor(extract(year from (date '1940-01-07' + (s - 1) * 7)) / 10) * 10)::integer,
  null::text,
  'RVWK' || lpad(s::text, 6, '0')
    || ' · '
    || to_char(date '1940-01-07' + (s - 1) * 7, 'YYYY-MM-DD')
    || ' — '
    || to_char(date '1940-01-07' + (s - 1) * 7 + 6, 'YYYY-MM-DD')
from generate_series(
  1,
  (date '2035-12-31' - date '1940-01-07') / 7 + 1
) as s
on conflict (week_sequence) do nothing;

-- If re-run after partial insert, ensure full range exists (idempotent guard)
-- (on conflict only fires if PK collides; empty table → full insert)

-- ---------------------------------------------------------------------------
-- Step 3 — indexes (PK/UNIQUE already index week_sequence / rvwk_id)
-- ---------------------------------------------------------------------------

create index if not exists idx_retroverse_weeks_start_date
  on public.retroverse_weeks (start_date);

create index if not exists idx_retroverse_weeks_end_date
  on public.retroverse_weeks (end_date);

-- ---------------------------------------------------------------------------
-- Step 4 — validation
-- ---------------------------------------------------------------------------

do $val$
declare
  span_bad integer;
  gap_bad integer;
  epoch_bad integer;
  tail_bad integer;
  row_cnt bigint;
begin
  select count(*) into span_bad
  from public.retroverse_weeks
  where end_date <> start_date + 6;

  if span_bad > 0 then
    raise exception 'RVWK validation failed: % rows with span != 7 days', span_bad;
  end if;

  select count(*) into gap_bad
  from (
    select
      week_sequence,
      start_date,
      lag(end_date) over (order by week_sequence) as prev_end
    from public.retroverse_weeks
  ) x
  where x.week_sequence > 1
    and x.start_date <> x.prev_end + 1;

  if gap_bad > 0 then
    raise exception 'RVWK validation failed: % gaps between consecutive weeks', gap_bad;
  end if;

  select count(*) into epoch_bad
  from public.retroverse_weeks
  where week_sequence = 1
    and start_date <> date '1940-01-07';

  if epoch_bad > 0 then
    raise exception 'RVWK validation failed: RVWK000001 epoch mismatch';
  end if;

  select count(*) into tail_bad
  from public.retroverse_weeks
  where date '2035-12-31' between start_date and end_date;

  if tail_bad <> 1 then
    raise exception 'RVWK validation failed: expected exactly one week containing 2035-12-31, got %', tail_bad;
  end if;

  select count(*) into row_cnt from public.retroverse_weeks;

  if (select max(end_date) - min(start_date) + 1 from public.retroverse_weeks) <> 7 * row_cnt then
    raise exception 'RVWK validation failed: coverage length != 7 * row count';
  end if;
end
$val$;

-- ---------------------------------------------------------------------------
-- Step 5 — temporal helper view
-- ---------------------------------------------------------------------------

create or replace view public.retroverse_temporal_view as
select
  week_sequence,
  rvwk_id,
  start_date,
  end_date,
  calendar_year as year,
  calendar_month as month,
  decade,
  quarter,
  display_label
from public.retroverse_weeks;

comment on view public.retroverse_temporal_view is
  'RVWK presentation slice; prefer retroverse_weeks.week_sequence for joins and ordering.';

-- ---------------------------------------------------------------------------
-- Step 6 — map chart tables (week_sequence only; rvwk_id is not stored on facts)
-- ---------------------------------------------------------------------------

alter table public.canonical_album_chart_runs
  add column if not exists rvwk_sequence integer;

update public.canonical_album_chart_runs c
set rvwk_sequence = w.week_sequence
from public.retroverse_weeks w
where c.chart_date between w.start_date and w.end_date;

create index if not exists idx_canonical_album_chart_runs_rvwk
  on public.canonical_album_chart_runs (rvwk_sequence);

comment on column public.canonical_album_chart_runs.rvwk_sequence is
  'Immutable Retroverse week index (retroverse_weeks.week_sequence) for chart_date; join/sort on this integer, not rvwk_id text.';

do $song$
begin
  if to_regclass('public.weekly_song_charts') is null then
    raise notice 'RVWK: public.weekly_song_charts not found — skip (add table + chart_date, then re-run column in a follow-up migration if needed).';
    return;
  end if;

  if not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'weekly_song_charts'
      and column_name = 'chart_date'
  ) then
    raise notice 'RVWK: weekly_song_charts has no chart_date column — skip rvwk_sequence (adjust migration when date column is known).';
    return;
  end if;

  execute 'alter table public.weekly_song_charts add column if not exists rvwk_sequence integer';
  execute '
    update public.weekly_song_charts s
    set rvwk_sequence = w.week_sequence
    from public.retroverse_weeks w
    where s.chart_date between w.start_date and w.end_date
  ';
  execute 'create index if not exists idx_weekly_song_charts_rvwk on public.weekly_song_charts (rvwk_sequence)';
end
$song$;

-- Optional FK: enforce week_sequence integrity on album spine (nullable preserves out-of-range dates)
alter table public.canonical_album_chart_runs
  drop constraint if exists fk_canonical_album_chart_runs_rvwk;

alter table public.canonical_album_chart_runs
  add constraint fk_canonical_album_chart_runs_rvwk
  foreign key (rvwk_sequence) references public.retroverse_weeks (week_sequence)
  on delete restrict;

-- ---------------------------------------------------------------------------
-- Grants (read paths for app / PostgREST)
-- ---------------------------------------------------------------------------

grant select on public.retroverse_weeks to anon, authenticated, service_role;
grant select on public.retroverse_temporal_view to anon, authenticated, service_role;
