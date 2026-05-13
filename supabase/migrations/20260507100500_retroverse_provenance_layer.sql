-- Retroverse provenance + confidence layer (minimal additive)

do $$
begin
  if not exists (
    select 1
    from pg_type t
    join pg_namespace n on n.oid = t.typnamespace
    where t.typname = 'retroverse_provenance_level'
      and n.nspname = 'public'
  ) then
    create type public.retroverse_provenance_level as enum (
      'verified',
      'canonicalized',
      'inferred',
      'editorial',
      'placeholder'
    );
  end if;
end $$;

alter table public.retroverse_albums
  add column if not exists provenance_level public.retroverse_provenance_level not null default 'canonicalized';

alter table public.retroverse_tracks
  add column if not exists provenance_level public.retroverse_provenance_level not null default 'canonicalized';

alter table public.retroverse_chart_appearances
  add column if not exists provenance_level public.retroverse_provenance_level not null default 'verified';

create index if not exists idx_retroverse_albums_provenance
  on public.retroverse_albums (provenance_level);

create index if not exists idx_retroverse_tracks_provenance
  on public.retroverse_tracks (provenance_level);

create index if not exists idx_retroverse_chart_appearances_provenance
  on public.retroverse_chart_appearances (provenance_level);
