-- Read path for Retroscope / anon key: aggregate week counts + explicit SELECT on spine table.

create or replace view public.canonical_album_chart_week_counts as
select
  retroverse_album_id,
  count(*)::bigint as chart_weeks
from public.canonical_album_chart_runs
group by retroverse_album_id;

grant select on public.canonical_album_chart_runs to anon, authenticated, service_role;
grant select on public.canonical_album_chart_week_counts to anon, authenticated, service_role;

comment on view public.canonical_album_chart_week_counts is
  'Album-level row count in canonical_album_chart_runs (Billboard 200 weeks per album) for heavy-hitter selection.';
