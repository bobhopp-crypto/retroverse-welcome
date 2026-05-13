-- Retroverse canonical identity layer (pilot foundation)
-- This schema keeps Retroverse IDs independent from external source systems.

create table if not exists public.retroverse_eras (
  retroverse_era_id text primary key
    check (retroverse_era_id ~ '^RVER[0-9]{6}$'),
  start_year integer not null
    check (start_year between 1800 and 2100),
  end_year integer not null
    check (end_year between 1800 and 2100 and end_year >= start_year),
  slug text not null unique,
  display_name text not null,
  summary text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.retroverse_artists (
  retroverse_artist_id text primary key
    check (retroverse_artist_id ~ '^RVAR[0-9]{6}$'),
  canonical_artist_name text not null,
  sort_name text,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.retroverse_albums (
  retroverse_album_id text primary key
    check (retroverse_album_id ~ '^RVAL[0-9]{6}$'),
  canonical_album_title text not null,
  retroverse_artist_id text not null references public.retroverse_artists(retroverse_artist_id),
  era_id text references public.retroverse_eras(retroverse_era_id),
  release_year integer
    check (release_year between 1800 and 2100),
  soundtrack_flag boolean not null default false,
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.retroverse_tracks (
  retroverse_track_id text primary key
    check (retroverse_track_id ~ '^RVTR[0-9]{6}$'),
  canonical_title text not null,
  retroverse_artist_id text not null references public.retroverse_artists(retroverse_artist_id),
  retroverse_album_id text references public.retroverse_albums(retroverse_album_id),
  release_year integer
    check (release_year between 1800 and 2100),
  era_id text references public.retroverse_eras(retroverse_era_id),
  notes text,
  created_at timestamptz not null default now()
);

create table if not exists public.retroverse_source_matches (
  retroverse_source_match_id text primary key
    check (retroverse_source_match_id ~ '^RVSM[0-9]{6}$'),
  source text not null,
  source_key text not null,
  source_title text,
  source_artist text,
  retroverse_entity_type text not null
    check (retroverse_entity_type in ('artist', 'album', 'track', 'chart', 'era')),
  retroverse_entity_id text not null,
  confidence_score numeric(5,4) not null
    check (confidence_score >= 0 and confidence_score <= 1),
  manual_override boolean not null default false,
  verified_by text,
  notes text,
  created_at timestamptz not null default now(),
  unique (source, source_key, retroverse_entity_type),
  check (
    (retroverse_entity_type = 'artist' and retroverse_entity_id ~ '^RVAR[0-9]{6}$') or
    (retroverse_entity_type = 'album' and retroverse_entity_id ~ '^RVAL[0-9]{6}$') or
    (retroverse_entity_type = 'track' and retroverse_entity_id ~ '^RVTR[0-9]{6}$') or
    (retroverse_entity_type = 'chart' and retroverse_entity_id ~ '^RVCH[0-9]{6}$') or
    (retroverse_entity_type = 'era' and retroverse_entity_id ~ '^RVER[0-9]{6}$')
  )
);

create table if not exists public.retroverse_chart_appearances (
  retroverse_chart_id text primary key
    check (retroverse_chart_id ~ '^RVCH[0-9]{6}$'),
  retroverse_track_id text not null references public.retroverse_tracks(retroverse_track_id),
  chart_date date not null,
  chart_name text not null,
  chart_position integer not null check (chart_position > 0),
  weeks_on_chart integer check (weeks_on_chart >= 0),
  created_at timestamptz not null default now()
);

create index if not exists idx_retroverse_albums_artist
  on public.retroverse_albums (retroverse_artist_id);

create index if not exists idx_retroverse_albums_era
  on public.retroverse_albums (era_id);

create index if not exists idx_retroverse_tracks_artist
  on public.retroverse_tracks (retroverse_artist_id);

create index if not exists idx_retroverse_tracks_album
  on public.retroverse_tracks (retroverse_album_id);

create index if not exists idx_retroverse_tracks_era
  on public.retroverse_tracks (era_id);

create index if not exists idx_retroverse_source_matches_entity
  on public.retroverse_source_matches (retroverse_entity_type, retroverse_entity_id);

create index if not exists idx_retroverse_source_matches_source
  on public.retroverse_source_matches (source, source_key);

create index if not exists idx_retroverse_chart_appearances_track_date
  on public.retroverse_chart_appearances (retroverse_track_id, chart_date);
