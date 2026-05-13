-- Retroverse canonical media linkage layer (pilot)
-- Minimal table for linking canonical tracks to local media assets.

create table if not exists public.retroverse_media_assets (
  retroverse_media_asset_id text primary key
    check (retroverse_media_asset_id ~ '^RVMA[0-9]{6}$'),
  retroverse_track_id text not null references public.retroverse_tracks(retroverse_track_id),
  media_type text not null
    check (media_type in ('video', 'audio', 'image', 'other')),
  media_source text not null,
  local_path text not null,
  thumbnail_path text,
  file_name text not null,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  video_width integer check (video_width is null or video_width > 0),
  video_height integer check (video_height is null or video_height > 0),
  source_confidence numeric(5,4) not null
    check (source_confidence >= 0 and source_confidence <= 1),
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (retroverse_track_id, media_source, local_path)
);

create index if not exists idx_retroverse_media_assets_track
  on public.retroverse_media_assets (retroverse_track_id);

create index if not exists idx_retroverse_media_assets_primary
  on public.retroverse_media_assets (retroverse_track_id, is_primary);
