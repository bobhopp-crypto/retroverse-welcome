-- Retroverse artwork primary-flag support
-- Adds explicit primary artwork flag while preserving existing artwork_role model.

alter table public.retroverse_album_artwork
  add column if not exists is_primary boolean not null default false;

-- Align legacy rows where artwork_role is already primary.
update public.retroverse_album_artwork
set is_primary = true
where artwork_role = 'primary';

alter table public.retroverse_album_artwork
  drop constraint if exists retroverse_album_artwork_primary_role_check;

alter table public.retroverse_album_artwork
  add constraint retroverse_album_artwork_primary_role_check
  check (is_primary = false or artwork_role = 'primary');

-- One primary artwork per album edition when edition is present.
create unique index if not exists idx_retroverse_album_artwork_primary_per_edition
  on public.retroverse_album_artwork (retroverse_album_id, retroverse_album_edition_id)
  where is_primary = true and retroverse_album_edition_id is not null;

-- One album-level primary artwork when edition is not specified.
create unique index if not exists idx_retroverse_album_artwork_primary_album_level
  on public.retroverse_album_artwork (retroverse_album_id)
  where is_primary = true and retroverse_album_edition_id is null;
