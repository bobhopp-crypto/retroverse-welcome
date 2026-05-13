-- Retroverse canonical graph expansion: complete album graph support
-- Scope: additive migration for ordered tracklists, album artist roles, artwork, and era chronology inheritance.

alter table public.retroverse_albums
  add column if not exists era_id text references public.retroverse_eras(retroverse_era_id),
  add column if not exists release_date date,
  add column if not exists album_type text not null default 'studio'
    check (album_type in ('studio', 'soundtrack', 'compilation', 'live', 'ep', 'single', 'other'));

create table if not exists public.retroverse_album_editions (
  retroverse_album_edition_id text primary key
    check (retroverse_album_edition_id ~ '^RVED[0-9]{6}$'),
  retroverse_album_id text not null references public.retroverse_albums(retroverse_album_id),
  edition_key text not null,
  edition_name text not null,
  release_date date,
  release_year integer check (release_year between 1800 and 2100),
  era_id text references public.retroverse_eras(retroverse_era_id),
  is_primary boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (retroverse_album_id, edition_key)
);

create unique index if not exists idx_retroverse_album_editions_one_primary
  on public.retroverse_album_editions (retroverse_album_id)
  where is_primary = true;

create index if not exists idx_retroverse_album_editions_album
  on public.retroverse_album_editions (retroverse_album_id);

create index if not exists idx_retroverse_album_editions_era
  on public.retroverse_album_editions (era_id);

create table if not exists public.retroverse_album_tracks (
  retroverse_album_track_id text primary key
    check (retroverse_album_track_id ~ '^RVAT[0-9]{6}$'),
  retroverse_album_edition_id text not null references public.retroverse_album_editions(retroverse_album_edition_id),
  retroverse_track_id text not null references public.retroverse_tracks(retroverse_track_id),
  disc_number integer not null check (disc_number > 0),
  track_number integer not null check (track_number > 0),
  side_code text check (side_code in ('A', 'B', 'C', 'D', 'E', 'F', 'G', 'H')),
  side_position integer check (side_position > 0),
  is_interlude boolean not null default false,
  soundtrack_exclusive boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  unique (retroverse_album_edition_id, disc_number, track_number)
);

create unique index if not exists idx_retroverse_album_tracks_unique_side_order
  on public.retroverse_album_tracks (retroverse_album_edition_id, side_code, side_position)
  where side_code is not null and side_position is not null;

create index if not exists idx_retroverse_album_tracks_track
  on public.retroverse_album_tracks (retroverse_track_id);

create table if not exists public.retroverse_album_artist_roles (
  retroverse_album_artist_role_id text primary key
    check (retroverse_album_artist_role_id ~ '^RVRL[0-9]{6}$'),
  retroverse_album_id text not null references public.retroverse_albums(retroverse_album_id),
  retroverse_artist_id text not null references public.retroverse_artists(retroverse_artist_id),
  relationship_role text not null
    check (relationship_role in ('primary', 'soundtrack_primary', 'contributing', 'featured')),
  billing_order integer not null default 1 check (billing_order > 0),
  notes text,
  created_at timestamptz not null default now(),
  unique (retroverse_album_id, retroverse_artist_id, relationship_role)
);

create index if not exists idx_retroverse_album_artist_roles_album
  on public.retroverse_album_artist_roles (retroverse_album_id, billing_order);

create index if not exists idx_retroverse_album_artist_roles_artist
  on public.retroverse_album_artist_roles (retroverse_artist_id);

create table if not exists public.retroverse_album_artwork (
  retroverse_album_artwork_id text primary key
    check (retroverse_album_artwork_id ~ '^RVAW[0-9]{6}$'),
  retroverse_album_id text not null references public.retroverse_albums(retroverse_album_id),
  retroverse_album_edition_id text references public.retroverse_album_editions(retroverse_album_edition_id),
  artwork_role text not null
    check (artwork_role in ('primary', 'alternate', 'booklet', 'back')),
  canonical_cover_path text,
  cover_source text,
  artwork_status text not null
    check (artwork_status in ('missing', 'pending', 'verified', 'rejected')),
  width_px integer check (width_px > 0),
  height_px integer check (height_px > 0),
  notes text,
  created_at timestamptz not null default now()
);

create index if not exists idx_retroverse_album_artwork_album
  on public.retroverse_album_artwork (retroverse_album_id, artwork_role);

create index if not exists idx_retroverse_album_artwork_edition
  on public.retroverse_album_artwork (retroverse_album_edition_id);

create or replace function public.retroverse_apply_track_album_inheritance()
returns trigger
language plpgsql
as $$
declare
  album_release_year integer;
  album_era_id text;
begin
  if new.retroverse_album_id is not null then
    select al.release_year, al.era_id
      into album_release_year, album_era_id
    from public.retroverse_albums al
    where al.retroverse_album_id = new.retroverse_album_id;

    if new.release_year is null then
      new.release_year := album_release_year;
    end if;

    if new.era_id is null then
      new.era_id := album_era_id;
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists trg_retroverse_track_album_inheritance on public.retroverse_tracks;

create trigger trg_retroverse_track_album_inheritance
before insert or update on public.retroverse_tracks
for each row
execute function public.retroverse_apply_track_album_inheritance();

-- Backfill album era_id from release_year if empty (first matching era range).
update public.retroverse_albums al
set era_id = e.retroverse_era_id
from public.retroverse_eras e
where al.era_id is null
  and al.release_year between e.start_year and e.end_year
  and not exists (
    select 1
    from public.retroverse_eras e2
    where al.release_year between e2.start_year and e2.end_year
      and e2.start_year > e.start_year
  );

-- Backfill track inheritance from album when values are missing.
update public.retroverse_tracks t
set
  release_year = coalesce(t.release_year, al.release_year),
  era_id = coalesce(t.era_id, al.era_id)
from public.retroverse_albums al
where t.retroverse_album_id = al.retroverse_album_id
  and (t.release_year is null or t.era_id is null);
