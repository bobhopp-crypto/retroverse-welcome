-- Stabilize canonical artwork path namespace for deploy layer.
-- Moves legacy `covers/...` references to `retroverse/covers/...`.

update public.retroverse_album_artwork
set canonical_cover_path = regexp_replace(canonical_cover_path, '^/?covers/', 'retroverse/covers/')
where canonical_cover_path ~ '^/?covers/';
