-- Retroverse Canonical Graph Validation Suite
-- Purpose: quick human-readable inspection of pilot architecture behavior.
-- Safety: read-only (SELECT-only) validation queries.

-- ==================================================
-- 1) ARTIST VALIDATION
-- ==================================================

-- 1A. List all artists
select
  a.retroverse_artist_id,
  a.canonical_artist_name,
  a.sort_name,
  a.created_at
from public.retroverse_artists a
order by a.canonical_artist_name, a.retroverse_artist_id;

-- 1B. Duplicate canonical artist names (case-insensitive, trimmed)
select
  lower(trim(a.canonical_artist_name)) as normalized_artist_name,
  count(*) as duplicate_count,
  array_agg(a.retroverse_artist_id order by a.retroverse_artist_id) as artist_ids
from public.retroverse_artists a
group by lower(trim(a.canonical_artist_name))
having count(*) > 1
order by duplicate_count desc, normalized_artist_name;

-- 1C. Artist ID format validation
select
  a.retroverse_artist_id,
  case
    when a.retroverse_artist_id ~ '^RVAR[0-9]{6}$' then 'valid'
    else 'invalid'
  end as id_status
from public.retroverse_artists a
order by id_status desc, a.retroverse_artist_id;

-- ==================================================
-- 2) ALBUM VALIDATION
-- ==================================================

-- 2A. List albums with linked canonical artists
select
  al.retroverse_album_id,
  al.canonical_album_title,
  ar.retroverse_artist_id,
  ar.canonical_artist_name,
  al.release_year,
  al.soundtrack_flag,
  al.created_at
from public.retroverse_albums al
join public.retroverse_artists ar
  on ar.retroverse_artist_id = al.retroverse_artist_id
order by al.release_year nulls last, al.canonical_album_title;

-- 2B. Soundtrack flag behavior summary
select
  al.soundtrack_flag,
  count(*) as album_count
from public.retroverse_albums al
group by al.soundtrack_flag
order by al.soundtrack_flag desc;

-- 2C. Album IDs with format status
select
  al.retroverse_album_id,
  case
    when al.retroverse_album_id ~ '^RVAL[0-9]{6}$' then 'valid'
    else 'invalid'
  end as id_status
from public.retroverse_albums al
order by id_status desc, al.retroverse_album_id;

-- ==================================================
-- 3) TRACK VALIDATION
-- ==================================================

-- 3A. List tracks with linked artists and albums
select
  t.retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name,
  al.canonical_album_title,
  t.release_year,
  t.era_id,
  t.created_at
from public.retroverse_tracks t
left join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
left join public.retroverse_albums al
  on al.retroverse_album_id = t.retroverse_album_id
order by ar.canonical_artist_name, t.canonical_title, t.retroverse_track_id;

-- 3B. Canonical title normalization check (trim + collapse spaces)
select
  t.retroverse_track_id,
  t.canonical_title,
  regexp_replace(trim(t.canonical_title), '\s+', ' ', 'g') as normalized_title,
  case
    when t.canonical_title = regexp_replace(trim(t.canonical_title), '\s+', ' ', 'g')
      then 'clean'
    else 'needs_review'
  end as title_status
from public.retroverse_tracks t
order by title_status desc, t.retroverse_track_id;

-- 3C. Duplicate canonical track names for same artist (case-insensitive, trimmed)
select
  t.retroverse_artist_id,
  ar.canonical_artist_name,
  lower(trim(t.canonical_title)) as normalized_track_title,
  count(*) as duplicate_count,
  array_agg(t.retroverse_track_id order by t.retroverse_track_id) as track_ids
from public.retroverse_tracks t
join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
group by t.retroverse_artist_id, ar.canonical_artist_name, lower(trim(t.canonical_title))
having count(*) > 1
order by duplicate_count desc, ar.canonical_artist_name, normalized_track_title;

-- 3D. Track ID format validation
select
  t.retroverse_track_id,
  case
    when t.retroverse_track_id ~ '^RVTR[0-9]{6}$' then 'valid'
    else 'invalid'
  end as id_status
from public.retroverse_tracks t
order by id_status desc, t.retroverse_track_id;

-- ==================================================
-- 4) SOURCE MATCH VALIDATION
-- ==================================================

-- 4A. Source variants grouped under canonical tracks
select
  sm.retroverse_entity_id as retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name,
  count(*) as source_variant_count,
  array_agg(
    sm.source || ':' || sm.source_key || ' -> ' || coalesce(sm.source_title, '<null>')
    order by sm.source, sm.source_key
  ) as source_variants
from public.retroverse_source_matches sm
join public.retroverse_tracks t
  on t.retroverse_track_id = sm.retroverse_entity_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
where sm.retroverse_entity_type = 'track'
group by sm.retroverse_entity_id, t.canonical_title, ar.canonical_artist_name
order by source_variant_count desc, ar.canonical_artist_name, t.canonical_title;

-- 4B. Verify canonical tracks with multiple source variants
select
  sm.retroverse_entity_id as retroverse_track_id,
  count(*) as variant_count
from public.retroverse_source_matches sm
where sm.retroverse_entity_type = 'track'
group by sm.retroverse_entity_id
having count(*) > 1
order by variant_count desc, retroverse_track_id;

-- 4C. Orphaned source matches (no matching canonical row)
select
  sm.retroverse_source_match_id,
  sm.retroverse_entity_type,
  sm.retroverse_entity_id,
  sm.source,
  sm.source_key
from public.retroverse_source_matches sm
left join public.retroverse_artists ar
  on sm.retroverse_entity_type = 'artist'
 and ar.retroverse_artist_id = sm.retroverse_entity_id
left join public.retroverse_albums al
  on sm.retroverse_entity_type = 'album'
 and al.retroverse_album_id = sm.retroverse_entity_id
left join public.retroverse_tracks t
  on sm.retroverse_entity_type = 'track'
 and t.retroverse_track_id = sm.retroverse_entity_id
left join public.retroverse_chart_appearances ch
  on sm.retroverse_entity_type = 'chart'
 and ch.retroverse_chart_id = sm.retroverse_entity_id
left join public.retroverse_eras e
  on sm.retroverse_entity_type = 'era'
 and e.retroverse_era_id = sm.retroverse_entity_id
where ar.retroverse_artist_id is null
  and al.retroverse_album_id is null
  and t.retroverse_track_id is null
  and ch.retroverse_chart_id is null
  and e.retroverse_era_id is null
order by sm.retroverse_source_match_id;

-- 4D. Entity type vs ID prefix consistency check
select
  sm.retroverse_source_match_id,
  sm.retroverse_entity_type,
  sm.retroverse_entity_id,
  case
    when sm.retroverse_entity_type = 'artist' and sm.retroverse_entity_id ~ '^RVAR[0-9]{6}$' then 'valid'
    when sm.retroverse_entity_type = 'album' and sm.retroverse_entity_id ~ '^RVAL[0-9]{6}$' then 'valid'
    when sm.retroverse_entity_type = 'track' and sm.retroverse_entity_id ~ '^RVTR[0-9]{6}$' then 'valid'
    when sm.retroverse_entity_type = 'chart' and sm.retroverse_entity_id ~ '^RVCH[0-9]{6}$' then 'valid'
    when sm.retroverse_entity_type = 'era' and sm.retroverse_entity_id ~ '^RVER[0-9]{6}$' then 'valid'
    else 'invalid'
  end as consistency_status
from public.retroverse_source_matches sm
order by consistency_status desc, sm.retroverse_source_match_id;

-- ==================================================
-- 5) CHART VALIDATION
-- ==================================================

-- 5A. Chart appearances with canonical track context
select
  ch.retroverse_chart_id,
  ch.chart_name,
  ch.chart_date,
  ch.chart_position,
  ch.weeks_on_chart,
  t.retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name
from public.retroverse_chart_appearances ch
left join public.retroverse_tracks t
  on t.retroverse_track_id = ch.retroverse_track_id
left join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
order by ch.chart_date, ch.chart_position;

-- 5B. Orphaned chart rows (chart row references missing canonical track)
select
  ch.retroverse_chart_id,
  ch.retroverse_track_id,
  ch.chart_name,
  ch.chart_date
from public.retroverse_chart_appearances ch
left join public.retroverse_tracks t
  on t.retroverse_track_id = ch.retroverse_track_id
where t.retroverse_track_id is null
order by ch.retroverse_chart_id;

-- 5C. Chart rows are independent from track identity (many chart rows per one track allowed)
select
  ch.retroverse_track_id,
  t.canonical_title,
  count(*) as chart_rows_for_track
from public.retroverse_chart_appearances ch
join public.retroverse_tracks t
  on t.retroverse_track_id = ch.retroverse_track_id
group by ch.retroverse_track_id, t.canonical_title
order by chart_rows_for_track desc, ch.retroverse_track_id;

-- ==================================================
-- 6) ERA VALIDATION
-- ==================================================

-- 6A. Era ID format validation
select
  e.retroverse_era_id,
  case
    when e.retroverse_era_id ~ '^RVER[0-9]{6}$' then 'valid'
    else 'invalid'
  end as id_status
from public.retroverse_eras e
order by id_status desc, e.retroverse_era_id;

-- 6B. Era year range validation
select
  e.retroverse_era_id,
  e.start_year,
  e.end_year,
  case
    when e.end_year >= e.start_year then 'valid'
    else 'invalid'
  end as year_range_status
from public.retroverse_eras e
order by year_range_status desc, e.retroverse_era_id;

-- 6C. Tracks by era
select
  e.retroverse_era_id,
  e.display_name,
  t.retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name,
  t.release_year
from public.retroverse_eras e
left join public.retroverse_tracks t
  on t.era_id = e.retroverse_era_id
left join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
order by e.start_year, ar.canonical_artist_name, t.canonical_title;

-- ==================================================
-- 7) GRAPH INTEGRITY
-- ==================================================

-- 7A. Orphan checks across graph edges (single result row)
select
  (select count(*) from public.retroverse_albums al
    left join public.retroverse_artists ar on ar.retroverse_artist_id = al.retroverse_artist_id
    where ar.retroverse_artist_id is null
  ) as albums_with_missing_artist,
  (select count(*) from public.retroverse_tracks t
    left join public.retroverse_artists ar on ar.retroverse_artist_id = t.retroverse_artist_id
    where ar.retroverse_artist_id is null
  ) as tracks_with_missing_artist,
  (select count(*) from public.retroverse_tracks t
    left join public.retroverse_albums al on al.retroverse_album_id = t.retroverse_album_id
    where t.retroverse_album_id is not null and al.retroverse_album_id is null
  ) as tracks_with_missing_album,
  (select count(*) from public.retroverse_tracks t
    left join public.retroverse_eras e on e.retroverse_era_id = t.era_id
    where t.era_id is not null and e.retroverse_era_id is null
  ) as tracks_with_missing_era,
  (select count(*) from public.retroverse_chart_appearances ch
    left join public.retroverse_tracks t on t.retroverse_track_id = ch.retroverse_track_id
    where ch.retroverse_track_id is not null
      and t.retroverse_track_id is null
  ) as chart_rows_with_missing_track,

-- 7B. Duplicate canonical checks (single result row)
select
  (select count(*) from (
    select lower(trim(canonical_artist_name))
    from public.retroverse_artists
    group by lower(trim(canonical_artist_name))
    having count(*) > 1
  ) x) as duplicate_artist_name_groups,
  (select count(*) from (
    select retroverse_artist_id, lower(trim(canonical_title))
    from public.retroverse_tracks
    group by retroverse_artist_id, lower(trim(canonical_title))
    having count(*) > 1
  ) y) as duplicate_track_name_groups_per_artist;

-- 7C. Invalid ID counts by entity type (single result row)
select
  (select count(*) from public.retroverse_artists where retroverse_artist_id !~ '^RVAR[0-9]{6}$') as invalid_artist_ids,
  (select count(*) from public.retroverse_albums where retroverse_album_id !~ '^RVAL[0-9]{6}$') as invalid_album_ids,
  (select count(*) from public.retroverse_tracks where retroverse_track_id !~ '^RVTR[0-9]{6}$') as invalid_track_ids,
  (select count(*) from public.retroverse_chart_appearances where retroverse_chart_id !~ '^RVCH[0-9]{6}$') as invalid_chart_ids,
  (select count(*) from public.retroverse_source_matches where retroverse_source_match_id !~ '^RVSM[0-9]{6}$') as invalid_source_match_ids,
  (select count(*) from public.retroverse_eras where retroverse_era_id !~ '^RVER[0-9]{6}$') as invalid_era_ids;

-- 7D. Null relationship check (single result row)
select
  (select count(*) from public.retroverse_albums where retroverse_artist_id is null) as null_album_artist_fk,
  (select count(*) from public.retroverse_tracks where retroverse_artist_id is null) as null_track_artist_fk,
  (select count(*) from public.retroverse_chart_appearances ch
    left join public.retroverse_albums al on al.retroverse_album_id = ch.retroverse_album_id
    where ch.retroverse_album_id is not null
      and al.retroverse_album_id is null
  ) as chart_rows_with_missing_album,
  (select count(*) from public.retroverse_chart_appearances
    where retroverse_track_id is null and retroverse_album_id is null
  ) as chart_rows_missing_both_anchors,
  (select count(*) from public.retroverse_chart_appearances where retroverse_track_id is null) as chart_rows_track_null_album_ok,
  (select count(*) from public.retroverse_source_matches where retroverse_entity_id is null) as null_source_entity_id,
  (select count(*) from public.retroverse_source_matches where retroverse_entity_type is null) as null_source_entity_type;

-- ==================================================
-- 8) COMPLETE ALBUM GRAPH (PILOT EXPANSION)
-- ==================================================

-- 8A. Album editions with chronology and era linkage
select
  ed.retroverse_album_edition_id,
  ed.retroverse_album_id,
  al.canonical_album_title,
  ed.edition_key,
  ed.edition_name,
  ed.release_date,
  ed.release_year,
  ed.era_id,
  e.display_name as era_display_name,
  ed.is_primary
from public.retroverse_album_editions ed
join public.retroverse_albums al
  on al.retroverse_album_id = ed.retroverse_album_id
left join public.retroverse_eras e
  on e.retroverse_era_id = ed.era_id
order by al.canonical_album_title, ed.release_date nulls last, ed.retroverse_album_edition_id;

-- 8B. Ordered tracklist (disc + side + track order)
select
  ed.retroverse_album_edition_id,
  al.canonical_album_title,
  at.disc_number,
  at.track_number,
  at.side_code,
  at.side_position,
  t.retroverse_track_id,
  t.canonical_title,
  ar.canonical_artist_name,
  at.soundtrack_exclusive,
  at.is_interlude
from public.retroverse_album_tracks at
join public.retroverse_album_editions ed
  on ed.retroverse_album_edition_id = at.retroverse_album_edition_id
join public.retroverse_albums al
  on al.retroverse_album_id = ed.retroverse_album_id
join public.retroverse_tracks t
  on t.retroverse_track_id = at.retroverse_track_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = t.retroverse_artist_id
order by ed.retroverse_album_edition_id, at.disc_number, at.track_number;

-- 8C. Duplicate ordering conflicts in album tracklists
select
  at.retroverse_album_edition_id,
  at.disc_number,
  at.track_number,
  count(*) as duplicate_slot_count
from public.retroverse_album_tracks at
group by at.retroverse_album_edition_id, at.disc_number, at.track_number
having count(*) > 1
order by duplicate_slot_count desc, at.retroverse_album_edition_id, at.disc_number, at.track_number;

-- 8D. Album artist relationship matrix
select
  al.retroverse_album_id,
  al.canonical_album_title,
  rel.relationship_role,
  rel.billing_order,
  rel.retroverse_artist_id,
  ar.canonical_artist_name
from public.retroverse_album_artist_roles rel
join public.retroverse_albums al
  on al.retroverse_album_id = rel.retroverse_album_id
join public.retroverse_artists ar
  on ar.retroverse_artist_id = rel.retroverse_artist_id
order by al.retroverse_album_id, rel.billing_order, rel.relationship_role, ar.canonical_artist_name;

-- 8E. Album artwork linkage and status
select
  art.retroverse_album_artwork_id,
  art.retroverse_album_id,
  al.canonical_album_title,
  art.retroverse_album_edition_id,
  art.artwork_role,
  art.canonical_cover_path,
  art.cover_source,
  art.artwork_status
from public.retroverse_album_artwork art
join public.retroverse_albums al
  on al.retroverse_album_id = art.retroverse_album_id
order by art.retroverse_album_id, art.artwork_role, art.retroverse_album_artwork_id;

-- 8F. Era inheritance consistency: album -> track
select
  t.retroverse_track_id,
  t.canonical_title,
  t.era_id as track_era_id,
  al.era_id as album_era_id,
  case
    when t.era_id = al.era_id then 'inherited_or_aligned'
    else 'mismatch'
  end as era_alignment_status
from public.retroverse_tracks t
join public.retroverse_albums al
  on al.retroverse_album_id = t.retroverse_album_id
order by era_alignment_status desc, t.retroverse_track_id;

-- ==================================================
-- 9) TRACK LINEAGE + REUSE INTEGRITY
-- ==================================================

-- 9A. Reuse integrity summary (single result row)
with membership_rollup as (
  select
    t.retroverse_track_id,
    t.retroverse_album_id as origin_album_id,
    count(distinct ed.retroverse_album_id) as album_membership_count,
    bool_or(ed.retroverse_album_id = t.retroverse_album_id) as origin_album_is_member
  from public.retroverse_tracks t
  left join public.retroverse_album_tracks at
    on at.retroverse_track_id = t.retroverse_track_id
  left join public.retroverse_album_editions ed
    on ed.retroverse_album_edition_id = at.retroverse_album_edition_id
  group by t.retroverse_track_id, t.retroverse_album_id
)
select
  count(*) as total_tracks,
  count(*) filter (where album_membership_count > 0) as tracks_with_any_membership,
  count(*) filter (where album_membership_count = 0) as tracks_without_membership,
  count(*) filter (where album_membership_count > 1) as tracks_with_cross_album_membership,
  count(*) filter (where album_membership_count > 0 and origin_album_is_member = false) as tracks_missing_origin_membership
from membership_rollup;

-- 9B. Tracks whose origin album is not represented in album-track membership
with membership_rollup as (
  select
    t.retroverse_track_id,
    t.canonical_title,
    t.retroverse_album_id as origin_album_id,
    count(distinct ed.retroverse_album_id) as album_membership_count,
    bool_or(ed.retroverse_album_id = t.retroverse_album_id) as origin_album_is_member
  from public.retroverse_tracks t
  left join public.retroverse_album_tracks at
    on at.retroverse_track_id = t.retroverse_track_id
  left join public.retroverse_album_editions ed
    on ed.retroverse_album_edition_id = at.retroverse_album_edition_id
  group by t.retroverse_track_id, t.canonical_title, t.retroverse_album_id
)
select
  mr.retroverse_track_id,
  mr.canonical_title,
  mr.origin_album_id,
  al.canonical_album_title as origin_album_title,
  mr.album_membership_count
from membership_rollup mr
left join public.retroverse_albums al
  on al.retroverse_album_id = mr.origin_album_id
where mr.album_membership_count > 0
  and mr.origin_album_is_member = false
order by mr.retroverse_track_id;

-- 9C. Chronological lineage for tracks reused across multiple albums
with track_memberships as (
  select
    t.retroverse_track_id,
    t.canonical_title,
    t.release_year as track_release_year,
    ed.retroverse_album_id,
    al.canonical_album_title,
    al.album_type,
    al.soundtrack_flag,
    coalesce(ed.release_year, al.release_year) as appearance_year,
    at.disc_number,
    at.track_number
  from public.retroverse_tracks t
  join public.retroverse_album_tracks at
    on at.retroverse_track_id = t.retroverse_track_id
  join public.retroverse_album_editions ed
    on ed.retroverse_album_edition_id = at.retroverse_album_edition_id
  join public.retroverse_albums al
    on al.retroverse_album_id = ed.retroverse_album_id
),
membership_counts as (
  select
    tm.retroverse_track_id,
    count(distinct tm.retroverse_album_id) as album_membership_count
  from track_memberships tm
  group by tm.retroverse_track_id
)
select
  tm.retroverse_track_id,
  tm.canonical_title,
  mc.album_membership_count,
  tm.canonical_album_title,
  tm.album_type,
  tm.soundtrack_flag,
  tm.appearance_year,
  tm.track_release_year,
  row_number() over (
    partition by tm.retroverse_track_id
    order by tm.appearance_year nulls last, tm.canonical_album_title, tm.disc_number, tm.track_number
  ) as appearance_ordinal
from track_memberships tm
join membership_counts mc
  on mc.retroverse_track_id = tm.retroverse_track_id
where mc.album_membership_count > 1
order by tm.retroverse_track_id, appearance_ordinal;
