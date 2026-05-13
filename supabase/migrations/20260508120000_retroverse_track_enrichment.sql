-- Enrichment-only layer: measurable acoustic / audio features from external Billboard + Spotify-derived SQLite.
-- Does NOT modify canonical charts, albums, or track identity tables.

create table if not exists public.retroverse_track_enrichment (
  enrichment_id text primary key
    check (enrichment_id ~ '^RVEN[0-9]{6}$'),
  retroverse_track_id text references public.retroverse_tracks(retroverse_track_id),
  source_song text,
  source_album text,
  source_artist text,
  acousticness double precision,
  danceability double precision,
  energy double precision,
  valence double precision,
  tempo double precision,
  loudness double precision,
  speechiness double precision,
  instrumentalness double precision,
  duration_ms integer,
  time_signature integer,
  source_album_identity text,
  source_fingerprint text not null unique,
  enrichment_source text not null default 'billboard_acoustic_sqlite',
  source_date date,
  match_confidence numeric(6,4)
    check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1)),
  match_method text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_retroverse_track_enrichment_track
  on public.retroverse_track_enrichment (retroverse_track_id);

create index if not exists idx_retroverse_track_enrichment_album_identity
  on public.retroverse_track_enrichment (source_album_identity);

create index if not exists idx_retroverse_track_enrichment_artist_song
  on public.retroverse_track_enrichment (source_artist, source_song);

create index if not exists idx_retroverse_track_enrichment_source_date
  on public.retroverse_track_enrichment (source_date);

comment on table public.retroverse_track_enrichment is
  'Measurable acoustic/audio features for clustering and recommendations. Not canonical chart history.';
