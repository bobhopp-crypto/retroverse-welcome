-- VirtualDJ operational layer: one row per database.xml Song (media instance) + cue points.
-- Canonical history remains retroverse_tracks; database.xml is behavioral / DJ workflow truth.

create table if not exists public.retroverse_track_instances (
  track_instance_id text primary key
    check (track_instance_id ~ '^RVIN[0-9]{6}$'),
  retroverse_track_id text references public.retroverse_tracks(retroverse_track_id),
  file_path text not null,
  filepath_hash text not null,
  file_hash text,
  media_type text not null default 'other'
    check (media_type in ('video', 'audio', 'image', 'other')),
  play_count integer check (play_count is null or play_count >= 0),
  last_played timestamptz,
  vdj_song_flag integer,
  vdj_tags_flag integer,
  bpm_raw text,
  musical_key text,
  duration_seconds integer check (duration_seconds is null or duration_seconds >= 0),
  comments text,
  tags jsonb not null default '{}'::jsonb,
  linked_cover_url text,
  linked_netsearch_id text,
  thumbnail_path text,
  vdj_guid text,
  match_confidence numeric(6,4)
    check (match_confidence is null or (match_confidence >= 0 and match_confidence <= 1)),
  match_method text,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (filepath_hash)
);

create index if not exists idx_retroverse_track_instances_rvtr
  on public.retroverse_track_instances (retroverse_track_id);

create index if not exists idx_retroverse_track_instances_path
  on public.retroverse_track_instances (file_path);

create table if not exists public.retroverse_track_cues (
  cue_id text primary key
    check (cue_id ~ '^RVCU[0-9]{6}$'),
  track_instance_id text not null references public.retroverse_track_instances(track_instance_id) on delete cascade,
  cue_number integer not null check (cue_number >= 0 and cue_number <= 64),
  cue_name text,
  cue_type text not null default 'cue',
  time_position_seconds numeric(12,6),
  color bigint,
  loop_data jsonb,
  is_thumbnail boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (track_instance_id, cue_number)
);

create index if not exists idx_retroverse_track_cues_instance
  on public.retroverse_track_cues (track_instance_id);

create index if not exists idx_retroverse_track_cues_thumbnail
  on public.retroverse_track_cues (track_instance_id)
  where is_thumbnail = true;

create table if not exists public.retroverse_vdj_ingest_runs (
  ingest_run_id bigserial primary key,
  source_xml_path text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running'
    check (status in ('running', 'completed', 'failed')),
  instances_upserted integer not null default 0,
  cues_upserted integer not null default 0,
  instances_matched integer not null default 0,
  thumbnail_cues integer not null default 0,
  error_message text,
  notes text
);

comment on table public.retroverse_track_instances is
  'One VirtualDJ database.xml Song (local media object). Links to canonical RVTR when matched.';
comment on table public.retroverse_track_cues is
  'VDJ cue points per track instance. Cue 8 is canonical thumbnail (is_thumbnail=true).';
comment on column public.retroverse_track_cues.is_thumbnail is
  'True when cue_number=8 (canonical) or cue name contains thumbnail/thumb (secondary).';
