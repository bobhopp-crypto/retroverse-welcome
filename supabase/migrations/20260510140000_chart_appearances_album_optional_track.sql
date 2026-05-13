-- Album-chart appearances may anchor on `retroverse_album_id` without a track (Billboard 200 traversal).
-- Existing rows stay track-anchored; optional backfill copies `retroverse_album_id` from the track row.

alter table public.retroverse_chart_appearances
  add column if not exists retroverse_album_id text
  references public.retroverse_albums (retroverse_album_id);

-- Populate album FK for legacy track-anchored rows (idempotent).
update public.retroverse_chart_appearances ch
set retroverse_album_id = t.retroverse_album_id
from public.retroverse_tracks t
where ch.retroverse_track_id = t.retroverse_track_id
  and t.retroverse_album_id is not null
  and ch.retroverse_album_id is null;

alter table public.retroverse_chart_appearances
  alter column retroverse_track_id drop not null;

alter table public.retroverse_chart_appearances
  drop constraint if exists retroverse_chart_appearances_track_or_album_ck;

alter table public.retroverse_chart_appearances
  add constraint retroverse_chart_appearances_track_or_album_ck
  check (retroverse_track_id is not null or retroverse_album_id is not null);

create index if not exists idx_retroverse_chart_appearances_album_date
  on public.retroverse_chart_appearances (retroverse_album_id, chart_date);

-- Rollback (manual): drop index; drop constraint; delete album-only rows; set
-- retroverse_track_id not null; drop column retroverse_album_id.
