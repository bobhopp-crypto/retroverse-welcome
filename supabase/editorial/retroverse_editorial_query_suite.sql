-- Retroverse Editorial Query Suite (Pilot)
-- Purpose: reusable, culturally oriented exploration queries for the canonical graph.
--
-- Reuse notes:
-- - Update values in each params CTE to target a different album / era / track.
-- - These are read-only SELECT queries designed for editorial exploration.

-- ==================================================
-- 1) CHARTING VS NON-CHARTING TRACKS
-- Goal: distinguish hit singles from album cuts.
-- ==================================================

with params as (
  select 'RVAL000001'::text as target_album_id
),
chart_peaks as (
  select
    ch.retroverse_track_id,
    min(ch.chart_position) as peak_chart_position,
    count(*) as chart_entry_count
  from public.retroverse_chart_appearances ch
  group by ch.retroverse_track_id
)
select
  al.canonical_album_title,
  at.disc_number,
  at.track_number,
  at.side_code,
  at.side_position,
  t.retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name as track_artist,
  case when cp.retroverse_track_id is null then false else true end as charted_flag,
  cp.peak_chart_position,
  cp.chart_entry_count,
  case
    when cp.peak_chart_position = 1 then 'hit single'
    when cp.peak_chart_position is not null then 'charting track'
    else 'album cut'
  end as editorial_classification
from params p
join public.retroverse_album_editions ed
  on ed.retroverse_album_id = p.target_album_id
 and ed.is_primary = true
join public.retroverse_albums al
  on al.retroverse_album_id = ed.retroverse_album_id
join public.retroverse_album_tracks at
  on at.retroverse_album_edition_id = ed.retroverse_album_edition_id
join public.retroverse_tracks t
  on t.retroverse_track_id = at.retroverse_track_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
left join chart_peaks cp
  on cp.retroverse_track_id = t.retroverse_track_id
order by at.disc_number, at.track_number;

-- ==================================================
-- 2) SOUNDTRACK EXPERIENCE QUERY
-- Goal: reconstruct original listening experience.
-- ==================================================

with params as (
  select 'RVAL000001'::text as target_album_id
),
album_contributors as (
  select
    rel.retroverse_album_id,
    string_agg(
      ar.canonical_artist_name || ' [' || rel.relationship_role || ']',
      ', ' order by rel.billing_order, ar.canonical_artist_name
    ) as contributor_roster
  from public.retroverse_album_artist_roles rel
  join public.retroverse_artists ar
    on ar.retroverse_artist_id = rel.retroverse_artist_id
  group by rel.retroverse_album_id
)
select
  al.canonical_album_title,
  ed.edition_name,
  at.disc_number,
  at.track_number,
  coalesce(at.side_code, '?') as side_code,
  at.side_position,
  t.canonical_title,
  tr_ar.canonical_artist_name as performing_artist,
  at.soundtrack_exclusive,
  at.is_interlude,
  ac.contributor_roster as album_contributors
from params p
join public.retroverse_album_editions ed
  on ed.retroverse_album_id = p.target_album_id
 and ed.is_primary = true
join public.retroverse_albums al
  on al.retroverse_album_id = ed.retroverse_album_id
join public.retroverse_album_tracks at
  on at.retroverse_album_edition_id = ed.retroverse_album_edition_id
join public.retroverse_tracks t
  on t.retroverse_track_id = at.retroverse_track_id
join public.retroverse_artists tr_ar
  on tr_ar.retroverse_artist_id = t.retroverse_artist_id
left join album_contributors ac
  on ac.retroverse_album_id = al.retroverse_album_id
order by at.disc_number, at.track_number;

-- ==================================================
-- 3) SOURCE VARIANT INTELLIGENCE
-- Goal: document source variance mapped to one canonical identity.
-- ==================================================

with params as (
  select 'RVTR000001'::text as target_track_id
)
select
  t.retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name as canonical_artist,
  sm.source,
  count(*) as variant_count_in_source,
  round(avg(sm.confidence_score)::numeric, 4) as avg_confidence,
  max(sm.confidence_score) as max_confidence,
  string_agg(
    coalesce(sm.source_title, '<null title>') || ' :: ' || coalesce(sm.source_artist, '<null artist>'),
    ' | ' order by sm.source_key
  ) as preserved_source_variants
from params p
join public.retroverse_tracks t
  on t.retroverse_track_id = p.target_track_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
join public.retroverse_source_matches sm
  on sm.retroverse_entity_type = 'track'
 and sm.retroverse_entity_id = t.retroverse_track_id
group by t.retroverse_track_id, t.canonical_title, ar.canonical_artist_name, sm.source
order by sm.source;

-- ==================================================
-- 4) ARTIST RELATIONSHIP GRAPH
-- Goal: map soundtrack contributors, roles, and charting contributions.
-- ==================================================

with params as (
  select 'RVAL000001'::text as target_album_id
),
album_scope_tracks as (
  select t.retroverse_track_id, t.retroverse_artist_id
  from public.retroverse_tracks t
  where t.retroverse_album_id = (select target_album_id from params)
),
artist_chart_impact as (
  select
    ast.retroverse_artist_id,
    count(*) as charting_track_rows,
    min(ch.chart_position) as best_peak_position
  from album_scope_tracks ast
  join public.retroverse_chart_appearances ch
    on ch.retroverse_track_id = ast.retroverse_track_id
  group by ast.retroverse_artist_id
)
select
  al.retroverse_album_id,
  al.canonical_album_title,
  ar.retroverse_artist_id,
  ar.canonical_artist_name,
  rel.relationship_role,
  rel.billing_order,
  count(distinct ast.retroverse_track_id) as tracks_on_album,
  coalesce(aci.charting_track_rows, 0) as charting_track_rows,
  aci.best_peak_position
from params p
join public.retroverse_albums al
  on al.retroverse_album_id = p.target_album_id
join public.retroverse_album_artist_roles rel
  on rel.retroverse_album_id = al.retroverse_album_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = rel.retroverse_artist_id
left join album_scope_tracks ast
  on ast.retroverse_artist_id = ar.retroverse_artist_id
left join artist_chart_impact aci
  on aci.retroverse_artist_id = ar.retroverse_artist_id
group by
  al.retroverse_album_id, al.canonical_album_title,
  ar.retroverse_artist_id, ar.canonical_artist_name,
  rel.relationship_role, rel.billing_order,
  aci.charting_track_rows, aci.best_peak_position
order by rel.billing_order, rel.relationship_role, charting_track_rows desc, ar.canonical_artist_name;

-- ==================================================
-- 5) ERA INTELLIGENCE
-- Goal: contextualize era activity through albums, tracks, charts, and recurrence.
-- ==================================================

-- 5A. Albums + tracks inside target era (with soundtrack identity)
with params as (
  select 'RVER001974'::text as target_era_id
)
select
  e.display_name as era_name,
  al.retroverse_album_id,
  al.canonical_album_title,
  al.soundtrack_flag,
  t.retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name
from params p
join public.retroverse_eras e
  on e.retroverse_era_id = p.target_era_id
join public.retroverse_albums al
  on al.era_id = e.retroverse_era_id
join public.retroverse_tracks t
  on t.retroverse_album_id = al.retroverse_album_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
order by al.canonical_album_title, t.canonical_title;

-- 5B. Soundtrack density inside target era
with params as (
  select 'RVER001974'::text as target_era_id
)
select
  e.display_name as era_name,
  count(*) as album_count,
  count(*) filter (where al.soundtrack_flag) as soundtrack_album_count,
  round(
    (count(*) filter (where al.soundtrack_flag)::numeric / nullif(count(*), 0)) * 100,
    2
  ) as soundtrack_density_pct
from params p
join public.retroverse_eras e
  on e.retroverse_era_id = p.target_era_id
join public.retroverse_albums al
  on al.era_id = e.retroverse_era_id
group by e.display_name;

-- 5C. Top charting tracks in era
with params as (
  select 'RVER001974'::text as target_era_id
),
era_chart_peaks as (
  select
    t.retroverse_track_id,
    min(ch.chart_position) as peak_chart_position
  from public.retroverse_tracks t
  join public.retroverse_chart_appearances ch
    on ch.retroverse_track_id = t.retroverse_track_id
  where t.era_id = (select target_era_id from params)
  group by t.retroverse_track_id
)
select
  t.retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name,
  al.canonical_album_title,
  ecp.peak_chart_position
from era_chart_peaks ecp
join public.retroverse_tracks t
  on t.retroverse_track_id = ecp.retroverse_track_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
join public.retroverse_albums al
  on al.retroverse_album_id = t.retroverse_album_id
order by ecp.peak_chart_position asc, t.canonical_title;

-- 5D. Artist recurrence in era (track-level recurrence)
with params as (
  select 'RVER001974'::text as target_era_id
)
select
  ar.retroverse_artist_id,
  ar.canonical_artist_name,
  count(*) as track_count_in_era,
  count(distinct t.retroverse_album_id) as album_count_in_era
from params p
join public.retroverse_tracks t
  on t.era_id = p.target_era_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
group by ar.retroverse_artist_id, ar.canonical_artist_name
order by track_count_in_era desc, album_count_in_era desc, ar.canonical_artist_name;

-- ==================================================
-- 6) DEEP CUT DETECTION
-- Goal: surface non-single tracks on culturally significant albums.
-- ==================================================

with culturally_significant_albums as (
  select
    al.retroverse_album_id,
    al.canonical_album_title,
    al.soundtrack_flag,
    case
      when exists (
        select 1
        from public.retroverse_tracks t
        join public.retroverse_chart_appearances ch
          on ch.retroverse_track_id = t.retroverse_track_id
        where t.retroverse_album_id = al.retroverse_album_id
          and ch.chart_position = 1
      ) then true
      else false
    end as has_number_one_track
  from public.retroverse_albums al
),
non_charting_tracks as (
  select
    t.retroverse_track_id,
    t.canonical_title,
    t.retroverse_artist_id,
    t.retroverse_album_id
  from public.retroverse_tracks t
  left join public.retroverse_chart_appearances ch
    on ch.retroverse_track_id = t.retroverse_track_id
  where ch.retroverse_chart_id is null
)
select
  csa.canonical_album_title,
  nt.retroverse_track_id,
  nt.canonical_title,
  ar.canonical_artist_name,
  at.disc_number,
  at.track_number,
  at.side_code,
  at.soundtrack_exclusive,
  csa.soundtrack_flag,
  csa.has_number_one_track,
  case
    when at.is_interlude then 'score/interlude'
    when at.soundtrack_exclusive then 'soundtrack sequence track'
    else 'non-single track'
  end as editorial_signal
from non_charting_tracks nt
join culturally_significant_albums csa
  on csa.retroverse_album_id = nt.retroverse_album_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = nt.retroverse_artist_id
left join public.retroverse_album_editions ed
  on ed.retroverse_album_id = nt.retroverse_album_id
 and ed.is_primary = true
left join public.retroverse_album_tracks at
  on at.retroverse_album_edition_id = ed.retroverse_album_edition_id
 and at.retroverse_track_id = nt.retroverse_track_id
where csa.soundtrack_flag = true or csa.has_number_one_track = true
order by csa.canonical_album_title, at.disc_number nulls last, at.track_number nulls last, nt.canonical_title;

-- ==================================================
-- 7) ALBUM NARRATIVE DATASET
-- Goal: sequence + chart impact + contributor structure.
-- ==================================================

with params as (
  select 'RVAL000001'::text as target_album_id
),
primary_edition as (
  select ed.*
  from public.retroverse_album_editions ed
  where ed.retroverse_album_id = (select target_album_id from params)
    and ed.is_primary = true
),
album_contributor_counts as (
  select
    rel.retroverse_album_id,
    count(*) as contributor_count
  from public.retroverse_album_artist_roles rel
  group by rel.retroverse_album_id
),
track_chart_impact as (
  select
    ch.retroverse_track_id,
    min(ch.chart_position) as peak_chart_position,
    count(*) as chart_entry_count
  from public.retroverse_chart_appearances ch
  group by ch.retroverse_track_id
)
select
  al.retroverse_album_id,
  al.canonical_album_title,
  al.release_year,
  al.soundtrack_flag,
  pe.edition_name as primary_edition_name,
  at.disc_number,
  at.track_number,
  at.side_code,
  at.side_position,
  t.retroverse_track_id,
  t.canonical_title as sequence_track_title,
  ar.canonical_artist_name as sequence_track_artist,
  at.soundtrack_exclusive,
  at.is_interlude,
  tci.peak_chart_position,
  tci.chart_entry_count,
  acc.contributor_count as album_contributor_count,
  case
    when at.side_position = 1 then 'side opener'
    when at.is_interlude then 'score/interlude'
    when at.side_position is not null and at.side_position <= 3 then 'early-side track'
    when at.side_position is not null then 'late-side track'
    else 'album sequence'
  end as sequence_role,
  case
    when tci.peak_chart_position = 1 then 'radio staple'
    when tci.peak_chart_position is not null then 'charting track'
    when at.soundtrack_exclusive then 'soundtrack sequence'
    when at.is_interlude then 'score/interlude'
    else 'album cut'
  end as track_context_label
from params p
join public.retroverse_albums al
  on al.retroverse_album_id = p.target_album_id
left join primary_edition pe
  on pe.retroverse_album_id = al.retroverse_album_id
left join public.retroverse_album_tracks at
  on at.retroverse_album_edition_id = pe.retroverse_album_edition_id
left join public.retroverse_tracks t
  on t.retroverse_track_id = at.retroverse_track_id
left join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
left join track_chart_impact tci
  on tci.retroverse_track_id = t.retroverse_track_id
left join album_contributor_counts acc
  on acc.retroverse_album_id = al.retroverse_album_id
order by at.disc_number nulls last, at.track_number nulls last;

-- ==================================================
-- 8) HISTORICAL REUSE QUERY
-- Goal: show tracks reused in later compilation contexts.
-- ==================================================

with scoped_album_tracks as (
  select
    al.retroverse_album_id,
    al.canonical_album_title,
    al.album_type,
    al.release_year as album_release_year,
    ed.retroverse_album_edition_id,
    ed.edition_name,
    at.disc_number,
    at.track_number,
    t.retroverse_track_id,
    t.canonical_title,
    t.release_year as track_release_year,
    ar.canonical_artist_name as track_artist
  from public.retroverse_albums al
  join public.retroverse_album_editions ed
    on ed.retroverse_album_id = al.retroverse_album_id
   and ed.is_primary = true
  join public.retroverse_album_tracks at
    on at.retroverse_album_edition_id = ed.retroverse_album_edition_id
  join public.retroverse_tracks t
    on t.retroverse_track_id = at.retroverse_track_id
  join public.retroverse_artists ar
    on ar.retroverse_artist_id = t.retroverse_artist_id
  where al.album_type = 'compilation'
)
select
  sat.retroverse_album_id,
  sat.canonical_album_title,
  sat.edition_name,
  sat.disc_number,
  sat.track_number,
  sat.retroverse_track_id,
  sat.canonical_title,
  sat.track_artist,
  sat.track_release_year,
  sat.album_release_year,
  (sat.album_release_year - sat.track_release_year) as years_preceding_compilation,
  case
    when sat.track_release_year < sat.album_release_year then 'historical reuse'
    when sat.track_release_year = sat.album_release_year then 'same-year inclusion'
    else 'chronology review needed'
  end as reuse_context
from scoped_album_tracks sat
where sat.track_release_year is not null
  and sat.album_release_year is not null
order by sat.canonical_album_title, sat.disc_number, sat.track_number;

-- ==================================================
-- 9) MULTI-ALBUM MEMBERSHIP QUERY
-- Goal: validate reusable canonical track identity across albums/editions.
-- ==================================================

with track_memberships as (
  select
    t.retroverse_track_id,
    t.canonical_title,
    tr_ar.canonical_artist_name as track_artist,
    al.retroverse_album_id,
    al.canonical_album_title,
    al.album_type,
    al.release_year as album_release_year,
    ed.retroverse_album_edition_id,
    ed.edition_name,
    at.disc_number,
    at.track_number,
    at.side_code
  from public.retroverse_tracks t
  join public.retroverse_album_tracks at
    on at.retroverse_track_id = t.retroverse_track_id
  join public.retroverse_album_editions ed
    on ed.retroverse_album_edition_id = at.retroverse_album_edition_id
  join public.retroverse_albums al
    on al.retroverse_album_id = ed.retroverse_album_id
  join public.retroverse_artists tr_ar
    on tr_ar.retroverse_artist_id = t.retroverse_artist_id
),
membership_counts as (
  select
    tm.retroverse_track_id,
    count(distinct tm.retroverse_album_id) as album_membership_count,
    count(distinct tm.retroverse_album_edition_id) as edition_membership_count
  from track_memberships tm
  group by tm.retroverse_track_id
)
select
  tm.retroverse_track_id,
  tm.canonical_title,
  tm.track_artist,
  mc.album_membership_count,
  mc.edition_membership_count,
  tm.retroverse_album_id,
  tm.canonical_album_title,
  tm.album_type,
  tm.album_release_year,
  tm.retroverse_album_edition_id,
  tm.edition_name,
  tm.disc_number,
  tm.track_number,
  tm.side_code
from track_memberships tm
join membership_counts mc
  on mc.retroverse_track_id = tm.retroverse_track_id
where mc.album_membership_count > 1
order by mc.album_membership_count desc, tm.retroverse_track_id, tm.album_release_year, tm.disc_number, tm.track_number;

-- ==================================================
-- 10) COMPILATION INTELLIGENCE QUERY
-- Goal: profile compilations as cultural summaries with chronology spread.
-- ==================================================

with compilation_tracks as (
  select
    al.retroverse_album_id,
    al.canonical_album_title,
    al.release_year as album_release_year,
    ed.retroverse_album_edition_id,
    t.retroverse_track_id,
    t.canonical_title,
    t.release_year as track_release_year,
    t.era_id as track_era_id
  from public.retroverse_albums al
  join public.retroverse_album_editions ed
    on ed.retroverse_album_id = al.retroverse_album_id
   and ed.is_primary = true
  join public.retroverse_album_tracks at
    on at.retroverse_album_edition_id = ed.retroverse_album_edition_id
  join public.retroverse_tracks t
    on t.retroverse_track_id = at.retroverse_track_id
  where al.album_type = 'compilation'
),
compilation_summary as (
  select
    ct.retroverse_album_id,
    ct.canonical_album_title,
    ct.album_release_year,
    count(*) as track_count,
    min(ct.track_release_year) as earliest_track_year,
    max(ct.track_release_year) as latest_track_year,
    (max(ct.track_release_year) - min(ct.track_release_year)) as recording_year_span
  from compilation_tracks ct
  group by ct.retroverse_album_id, ct.canonical_album_title, ct.album_release_year
),
era_counts as (
  select
    ct.retroverse_album_id,
    ct.track_era_id,
    coalesce(e.display_name, ct.track_era_id) as era_name,
    coalesce(e.start_year, 9999) as era_sort_year,
    count(*) as era_track_count
  from compilation_tracks ct
  left join public.retroverse_eras e
    on e.retroverse_era_id = ct.track_era_id
  group by ct.retroverse_album_id, ct.track_era_id, coalesce(e.display_name, ct.track_era_id), coalesce(e.start_year, 9999)
),
era_distribution as (
  select
    ec.retroverse_album_id,
    string_agg(
      ec.era_name || ': ' || ec.era_track_count::text,
      '; ' order by ec.era_sort_year, ec.era_name
    ) as track_era_distribution
  from era_counts ec
  group by ec.retroverse_album_id
)
select
  cs.retroverse_album_id,
  cs.canonical_album_title,
  cs.album_release_year,
  cs.track_count,
  cs.earliest_track_year,
  cs.latest_track_year,
  cs.recording_year_span,
  ed.track_era_distribution
from compilation_summary cs
left join era_distribution ed
  on ed.retroverse_album_id = cs.retroverse_album_id
order by cs.canonical_album_title;

-- ==================================================
-- 11) ERA SPAN QUERY
-- Goal: show multi-year recording span and artist recurrence for any album type.
-- ==================================================

with params as (
  select 'RVAL000002'::text as target_album_id
),
album_scope as (
  select
    al.retroverse_album_id,
    al.canonical_album_title,
    al.release_year as album_release_year
  from public.retroverse_albums al
  where al.retroverse_album_id = (select target_album_id from params)
),
album_tracks as (
  select
    ascp.retroverse_album_id,
    ascp.canonical_album_title,
    ascp.album_release_year,
    t.retroverse_track_id,
    t.canonical_title,
    t.release_year as track_release_year,
    t.era_id,
    ar.retroverse_artist_id,
    ar.canonical_artist_name,
    at.disc_number,
    at.track_number
  from album_scope ascp
  join public.retroverse_album_editions ed
    on ed.retroverse_album_id = ascp.retroverse_album_id
   and ed.is_primary = true
  join public.retroverse_album_tracks at
    on at.retroverse_album_edition_id = ed.retroverse_album_edition_id
  join public.retroverse_tracks t
    on t.retroverse_track_id = at.retroverse_track_id
  join public.retroverse_artists ar
    on ar.retroverse_artist_id = t.retroverse_artist_id
),
artist_recurrence as (
  select
    at.retroverse_artist_id,
    at.canonical_artist_name,
    count(*) as tracks_in_album
  from album_tracks at
  group by at.retroverse_artist_id, at.canonical_artist_name
)
select
  at.retroverse_album_id,
  at.canonical_album_title,
  at.album_release_year,
  min(at.track_release_year) over (partition by at.retroverse_album_id) as earliest_track_year,
  max(at.track_release_year) over (partition by at.retroverse_album_id) as latest_track_year,
  (max(at.track_release_year) over (partition by at.retroverse_album_id)
    - min(at.track_release_year) over (partition by at.retroverse_album_id)) as recording_year_span,
  at.retroverse_track_id,
  at.canonical_title,
  at.track_release_year,
  at.era_id,
  at.canonical_artist_name,
  arx.tracks_in_album as artist_track_recurrence,
  at.disc_number,
  at.track_number
from album_tracks at
join artist_recurrence arx
  on arx.retroverse_artist_id = at.retroverse_artist_id
order by at.disc_number, at.track_number;

-- ==================================================
-- 12) ALBUM TYPE COVERAGE QUERY
-- Goal: verify editorial queries can run across soundtrack, compilation, and studio albums.
-- ==================================================

with album_stats as (
  select
    al.retroverse_album_id,
    al.canonical_album_title,
    al.album_type,
    al.release_year,
    count(distinct at.retroverse_track_id) as track_count,
    count(distinct at.retroverse_track_id) filter (
      where exists (
        select 1
        from public.retroverse_chart_appearances ch
        where ch.retroverse_track_id = at.retroverse_track_id
      )
    ) as charting_track_count,
    count(distinct t.retroverse_artist_id) as distinct_track_artist_count
  from public.retroverse_albums al
  left join public.retroverse_album_editions ed
    on ed.retroverse_album_id = al.retroverse_album_id
   and ed.is_primary = true
  left join public.retroverse_album_tracks at
    on at.retroverse_album_edition_id = ed.retroverse_album_edition_id
  left join public.retroverse_tracks t
    on t.retroverse_track_id = at.retroverse_track_id
  group by al.retroverse_album_id, al.canonical_album_title, al.album_type, al.release_year
)
select
  album_type,
  retroverse_album_id,
  canonical_album_title,
  release_year,
  track_count,
  charting_track_count,
  distinct_track_artist_count
from album_stats
order by album_type, release_year, canonical_album_title;

-- ==================================================
-- 13) TRACK LINEAGE JOURNEY QUERY
-- Goal: map a canonical track across album contexts in chronological order.
-- ==================================================

with params as (
  select 'RVTR000018'::text as target_track_id
),
track_core as (
  select
    t.retroverse_track_id,
    t.canonical_title,
    t.retroverse_album_id as origin_album_id,
    t.release_year as canonical_track_year
  from public.retroverse_tracks t
  where t.retroverse_track_id = (select target_track_id from params)
),
lineage_rows as (
  select
    tc.retroverse_track_id,
    tc.canonical_title,
    tc.origin_album_id,
    tc.canonical_track_year,
    al.retroverse_album_id as appearance_album_id,
    al.canonical_album_title as appearance_album_title,
    al.album_type as appearance_album_type,
    al.soundtrack_flag,
    coalesce(ed.release_year, al.release_year) as appearance_year,
    ed.retroverse_album_edition_id,
    ed.edition_name,
    at.disc_number,
    at.track_number,
    at.side_code
  from track_core tc
  join public.retroverse_album_tracks at
    on at.retroverse_track_id = tc.retroverse_track_id
  join public.retroverse_album_editions ed
    on ed.retroverse_album_edition_id = at.retroverse_album_edition_id
  join public.retroverse_albums al
    on al.retroverse_album_id = ed.retroverse_album_id
),
ordered_lineage as (
  select
    lr.*,
    row_number() over (
      partition by lr.retroverse_track_id
      order by lr.appearance_year nulls last, lr.appearance_album_title, lr.disc_number, lr.track_number
    ) as appearance_order,
    lag(lr.appearance_album_id) over (
      partition by lr.retroverse_track_id
      order by lr.appearance_year nulls last, lr.appearance_album_title, lr.disc_number, lr.track_number
    ) as previous_album_id,
    lag(lr.appearance_album_title) over (
      partition by lr.retroverse_track_id
      order by lr.appearance_year nulls last, lr.appearance_album_title, lr.disc_number, lr.track_number
    ) as previous_album_title
  from lineage_rows lr
)
select
  ol.retroverse_track_id,
  ol.canonical_title,
  ol.canonical_track_year,
  ol.appearance_order,
  ol.appearance_album_id,
  ol.appearance_album_title,
  ol.appearance_album_type,
  ol.soundtrack_flag,
  ol.appearance_year,
  ol.edition_name,
  ol.disc_number,
  ol.track_number,
  ol.side_code,
  case
    when ol.appearance_order = 1 and ol.appearance_album_id = ol.origin_album_id then 'original album appearance'
    when ol.appearance_order = 1 and ol.appearance_album_id <> ol.origin_album_id then 'early documented appearance'
    when ol.appearance_album_type = 'compilation' and ol.canonical_track_year is not null and ol.appearance_year is not null and ol.canonical_track_year < ol.appearance_year
      then 'later compilation reuse'
    when ol.soundtrack_flag and ol.canonical_track_year is not null and ol.appearance_year is not null and ol.canonical_track_year < ol.appearance_year
      then 'soundtrack reuse'
    when ol.appearance_album_type = 'live' and ol.canonical_track_year is not null and ol.appearance_year is not null and ol.canonical_track_year < ol.appearance_year
      then 'live-set carryover'
    else 'cross-context appearance'
  end as lineage_context,
  case
    when ol.previous_album_id is null then 'lineage anchor'
    when ol.previous_album_id = ol.appearance_album_id then 'same-album variant step'
    else 'album-context transition from ' || ol.previous_album_title
  end as transition_signal
from ordered_lineage ol
order by ol.appearance_order;
