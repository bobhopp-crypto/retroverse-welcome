-- Reset only Retroverse pilot schema objects (retroverse_* tables).
-- Safe for partial migration drift: uses IF EXISTS + CASCADE.
-- Does NOT touch production app tables like songs/artists/albums/weekly_song_charts.

begin;

drop table if exists public.retroverse_album_artwork cascade;
drop table if exists public.retroverse_album_tracks cascade;
drop table if exists public.retroverse_album_artist_roles cascade;
drop table if exists public.retroverse_album_editions cascade;
drop table if exists public.retroverse_chart_appearances cascade;
drop table if exists public.retroverse_source_matches cascade;
drop table if exists public.retroverse_tracks cascade;
drop table if exists public.retroverse_albums cascade;
drop table if exists public.retroverse_artists cascade;
drop table if exists public.retroverse_eras cascade;

commit;
