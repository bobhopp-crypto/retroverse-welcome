-- Retroverse pilot seed: Saturday Night Fever (complete album graph)
-- Requires migrations:
--   1) 20260506195500_retroverse_canonical_graph.sql
--   2) 20260506202000_expand_album_graph.sql
--   3) 20260506214500_album_artwork_primary_flag.sql
--   4) 20260506220500_retroverse_media_assets.sql
-- Canonical rows and source rows are intentionally separated.

insert into public.retroverse_eras (
  retroverse_era_id, start_year, end_year, slug, display_name, summary, notes
)
values
  ('RVER001958', 1958, 1961, 'birth-of-hot-100', 'Birth of Hot 100 Era', 'Pilot baseline era segment.', null),
  ('RVER001962', 1962, 1965, 'pre-british-invasion', 'Pre-British Invasion', 'Pilot baseline era segment.', null),
  ('RVER001966', 1966, 1969, 'late-60s-transition', 'Late 60s Transition', 'Pilot baseline era segment.', null),
  ('RVER001970', 1970, 1973, 'early-70s-songwriter', 'Early 70s Songwriter Era', 'Album-oriented songwriting and country-rock crossover period.', 'Used for early Eagles catalog tracks in pilot.'),
  ('RVER001974', 1974, 1979, 'disco-mainstream', 'Disco Mainstream', 'Disco becomes dominant in US pop charts.', 'Used by Saturday Night Fever pilot tracks.')
on conflict (retroverse_era_id) do update
set
  start_year = excluded.start_year,
  end_year = excluded.end_year,
  slug = excluded.slug,
  display_name = excluded.display_name,
  summary = excluded.summary,
  notes = excluded.notes;

insert into public.retroverse_artists (
  retroverse_artist_id, canonical_artist_name, sort_name, notes
)
values
  ('RVAR000001', 'Bee Gees', 'Bee Gees', null),
  ('RVAR000002', 'Yvonne Elliman', 'Elliman, Yvonne', null),
  ('RVAR000003', 'Various Artists', 'Various Artists', 'Soundtrack container artist for multi-artist releases.'),
  ('RVAR000004', 'Walter Murphy', 'Murphy, Walter', null),
  ('RVAR000005', 'Tavares', 'Tavares', null),
  ('RVAR000006', 'David Shire', 'Shire, David', null),
  ('RVAR000007', 'Ralph MacDonald', 'MacDonald, Ralph', null),
  ('RVAR000008', 'Kool & the Gang', 'Kool & the Gang', null),
  ('RVAR000009', 'KC and the Sunshine Band', 'KC and the Sunshine Band', null),
  ('RVAR000010', 'MFSB', 'MFSB', null),
  ('RVAR000011', 'The Trammps', 'Trammps, The', null),
  ('RVAR000012', 'Eagles', 'Eagles', null),
  ('RVAR000013', 'Fleetwood Mac', 'Fleetwood Mac', null)
on conflict (retroverse_artist_id) do update
set
  canonical_artist_name = excluded.canonical_artist_name,
  sort_name = excluded.sort_name,
  notes = excluded.notes;

insert into public.retroverse_albums (
  retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, soundtrack_flag, era_id, release_date, album_type, notes
)
values
  ('RVAL000001', 'Saturday Night Fever', 'RVAR000003', 1977, true, 'RVER001974', '1977-11-15', 'soundtrack', 'Pilot canonical soundtrack album.'),
  ('RVAL000002', 'Eagles Their Greatest Hits (1971-1975)', 'RVAR000012', 1976, false, 'RVER001974', '1976-02-17', 'compilation', 'Pilot canonical compilation album to stress-test multi-album graph membership.'),
  ('RVAL000003', 'Rumours', 'RVAR000013', 1977, false, 'RVER001974', '1977-02-04', 'studio', 'Pilot canonical studio album for band-era sequencing and deep-cut context.')
on conflict (retroverse_album_id) do update
set
  canonical_album_title = excluded.canonical_album_title,
  retroverse_artist_id = excluded.retroverse_artist_id,
  release_year = excluded.release_year,
  soundtrack_flag = excluded.soundtrack_flag,
  era_id = excluded.era_id,
  release_date = excluded.release_date,
  album_type = excluded.album_type,
  notes = excluded.notes;

insert into public.retroverse_album_editions (
  retroverse_album_edition_id, retroverse_album_id, edition_key, edition_name, release_date, release_year, era_id, is_primary, notes
)
values
  ('RVED000001', 'RVAL000001', 'original-1977-us', 'Original Motion Picture Soundtrack (1977 US)', '1977-11-15', 1977, 'RVER001974', true, 'Pilot primary edition for canonical ordering.'),
  ('RVED000002', 'RVAL000002', 'original-1976-us', 'Original 1976 US Compilation', '1976-02-17', 1976, 'RVER001974', true, 'Pilot primary edition for Eagles greatest-hits sequencing.'),
  ('RVED000003', 'RVAL000003', 'original-1977-us', 'Original 1977 US Studio Release', '1977-02-04', 1977, 'RVER001974', true, 'Pilot primary edition for Rumours sequencing.')
on conflict (retroverse_album_edition_id) do update
set
  retroverse_album_id = excluded.retroverse_album_id,
  edition_key = excluded.edition_key,
  edition_name = excluded.edition_name,
  release_date = excluded.release_date,
  release_year = excluded.release_year,
  era_id = excluded.era_id,
  is_primary = excluded.is_primary,
  notes = excluded.notes;

insert into public.retroverse_album_artist_roles (
  retroverse_album_artist_role_id, retroverse_album_id, retroverse_artist_id, relationship_role, billing_order, notes
)
values
  ('RVRL000001', 'RVAL000001', 'RVAR000003', 'primary', 1, 'Canonical soundtrack album-level artist.'),
  ('RVRL000002', 'RVAL000001', 'RVAR000001', 'soundtrack_primary', 2, 'Major recurring artist on soundtrack.'),
  ('RVRL000003', 'RVAL000002', 'RVAR000012', 'primary', 1, 'Canonical primary artist for compilation album.'),
  ('RVRL000004', 'RVAL000003', 'RVAR000013', 'primary', 1, 'Canonical primary artist for studio album.')
on conflict (retroverse_album_artist_role_id) do update
set
  retroverse_album_id = excluded.retroverse_album_id,
  retroverse_artist_id = excluded.retroverse_artist_id,
  relationship_role = excluded.relationship_role,
  billing_order = excluded.billing_order,
  notes = excluded.notes;

insert into public.retroverse_tracks (
  retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, release_year, era_id, notes
)
values
  ('RVTR000001', 'Stayin'' Alive', 'RVAR000001', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000002', 'Night Fever', 'RVAR000001', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000003', 'How Deep Is Your Love', 'RVAR000001', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000004', 'If I Can''t Have You', 'RVAR000002', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000005', 'More Than a Woman', 'RVAR000001', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000006', 'A Fifth of Beethoven', 'RVAR000004', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000007', 'More Than a Woman', 'RVAR000005', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000008', 'Manhattan Skyline', 'RVAR000006', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000009', 'Calypso Breakdown', 'RVAR000007', 'RVAL000001', 1977, 'RVER001974', 'Instrumental soundtrack cut.'),
  ('RVTR000010', 'Night on Disco Mountain', 'RVAR000006', 'RVAL000001', 1977, 'RVER001974', 'Instrumental soundtrack cut.'),
  ('RVTR000011', 'Open Sesame', 'RVAR000008', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000012', 'Jive Talkin''', 'RVAR000001', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000013', 'You Should Be Dancing', 'RVAR000001', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000014', 'Boogie Shoes', 'RVAR000009', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000015', 'Salsation', 'RVAR000006', 'RVAL000001', 1977, 'RVER001974', 'Instrumental soundtrack cut.'),
  ('RVTR000016', 'K-Jee', 'RVAR000010', 'RVAL000001', 1977, 'RVER001974', null),
  ('RVTR000017', 'Disco Inferno', 'RVAR000011', 'RVAL000001', 1977, 'RVER001974', null),
  -- No conceptual overlap with existing pilot tracks; these are new canonical identities.
  -- Future original-album/reissue memberships should reuse these RVTR IDs via retroverse_album_tracks.
  ('RVTR000018', 'Take It Easy', 'RVAR000012', 'RVAL000002', 1972, 'RVER001970', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000019', 'Witchy Woman', 'RVAR000012', 'RVAL000002', 1972, 'RVER001970', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000020', 'Lyin'' Eyes', 'RVAR000012', 'RVAL000002', 1975, 'RVER001974', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000021', 'Already Gone', 'RVAR000012', 'RVAL000002', 1974, 'RVER001974', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000022', 'Desperado', 'RVAR000012', 'RVAL000002', 1973, 'RVER001970', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000023', 'One of These Nights', 'RVAR000012', 'RVAL000002', 1975, 'RVER001974', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000024', 'Tequila Sunrise', 'RVAR000012', 'RVAL000002', 1973, 'RVER001970', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000025', 'Take It to the Limit', 'RVAR000012', 'RVAL000002', 1975, 'RVER001974', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000026', 'Peaceful Easy Feeling', 'RVAR000012', 'RVAL000002', 1972, 'RVER001970', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000027', 'Best of My Love', 'RVAR000012', 'RVAL000002', 1974, 'RVER001974', 'Compilation inclusion; original release predates compilation album.'),
  ('RVTR000028', 'Second Hand News', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', null),
  ('RVTR000029', 'Dreams', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', null),
  ('RVTR000030', 'Never Going Back Again', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', 'Album cut.'),
  ('RVTR000031', 'Don''t Stop', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', null),
  ('RVTR000032', 'Go Your Own Way', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', null),
  ('RVTR000033', 'Songbird', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', 'Album cut.'),
  ('RVTR000034', 'The Chain', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', 'Album cut.'),
  ('RVTR000035', 'You Make Loving Fun', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', null),
  ('RVTR000036', 'I Don''t Want to Know', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', 'Album cut.'),
  ('RVTR000037', 'Oh Daddy', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', 'Album cut.'),
  ('RVTR000038', 'Gold Dust Woman', 'RVAR000013', 'RVAL000003', 1977, 'RVER001974', 'Album cut.')
on conflict (retroverse_track_id) do update
set
  canonical_title = excluded.canonical_title,
  retroverse_artist_id = excluded.retroverse_artist_id,
  retroverse_album_id = excluded.retroverse_album_id,
  release_year = excluded.release_year,
  era_id = excluded.era_id,
  notes = excluded.notes;

insert into public.retroverse_album_tracks (
  retroverse_album_track_id, retroverse_album_edition_id, retroverse_track_id,
  disc_number, track_number, side_code, side_position, is_interlude, soundtrack_exclusive, notes
)
values
  ('RVAT000001', 'RVED000001', 'RVTR000001', 1, 1, 'A', 1, false, false, null),
  ('RVAT000002', 'RVED000001', 'RVTR000003', 1, 2, 'A', 2, false, false, null),
  ('RVAT000003', 'RVED000001', 'RVTR000002', 1, 3, 'A', 3, false, false, null),
  ('RVAT000004', 'RVED000001', 'RVTR000005', 1, 4, 'A', 4, false, false, null),
  ('RVAT000005', 'RVED000001', 'RVTR000004', 1, 5, 'A', 5, false, false, null),
  ('RVAT000006', 'RVED000001', 'RVTR000006', 1, 6, 'B', 1, false, false, null),
  ('RVAT000007', 'RVED000001', 'RVTR000007', 1, 7, 'B', 2, false, false, null),
  ('RVAT000008', 'RVED000001', 'RVTR000008', 1, 8, 'B', 3, false, true, 'Soundtrack-sequenced orchestral piece.'),
  ('RVAT000009', 'RVED000001', 'RVTR000009', 1, 9, 'B', 4, false, true, 'Soundtrack-sequenced instrumental.'),
  ('RVAT000010', 'RVED000001', 'RVTR000010', 1, 10, 'B', 5, false, true, 'Soundtrack-sequenced orchestral piece.'),
  ('RVAT000011', 'RVED000001', 'RVTR000011', 2, 1, 'C', 1, false, false, null),
  ('RVAT000012', 'RVED000001', 'RVTR000012', 2, 2, 'C', 2, false, false, null),
  ('RVAT000013', 'RVED000001', 'RVTR000013', 2, 3, 'C', 3, false, false, null),
  ('RVAT000014', 'RVED000001', 'RVTR000014', 2, 4, 'C', 4, false, false, null),
  ('RVAT000015', 'RVED000001', 'RVTR000015', 2, 5, 'C', 5, false, true, 'Soundtrack-sequenced instrumental.'),
  ('RVAT000016', 'RVED000001', 'RVTR000016', 2, 6, 'D', 1, false, false, null),
  ('RVAT000017', 'RVED000001', 'RVTR000017', 2, 7, 'D', 2, false, false, null),
  ('RVAT000018', 'RVED000002', 'RVTR000018', 1, 1, 'A', 1, false, false, null),
  ('RVAT000019', 'RVED000002', 'RVTR000019', 1, 2, 'A', 2, false, false, null),
  ('RVAT000020', 'RVED000002', 'RVTR000020', 1, 3, 'A', 3, false, false, null),
  ('RVAT000021', 'RVED000002', 'RVTR000021', 1, 4, 'A', 4, false, false, null),
  ('RVAT000022', 'RVED000002', 'RVTR000022', 1, 5, 'A', 5, false, false, null),
  ('RVAT000023', 'RVED000002', 'RVTR000023', 1, 6, 'B', 1, false, false, null),
  ('RVAT000024', 'RVED000002', 'RVTR000024', 1, 7, 'B', 2, false, false, null),
  ('RVAT000025', 'RVED000002', 'RVTR000025', 1, 8, 'B', 3, false, false, null),
  ('RVAT000026', 'RVED000002', 'RVTR000026', 1, 9, 'B', 4, false, false, null),
  ('RVAT000027', 'RVED000002', 'RVTR000027', 1, 10, 'B', 5, false, false, null),
  ('RVAT000028', 'RVED000003', 'RVTR000028', 1, 1, 'A', 1, false, false, null),
  ('RVAT000029', 'RVED000003', 'RVTR000029', 1, 2, 'A', 2, false, false, null),
  ('RVAT000030', 'RVED000003', 'RVTR000030', 1, 3, 'A', 3, false, false, null),
  ('RVAT000031', 'RVED000003', 'RVTR000031', 1, 4, 'A', 4, false, false, null),
  ('RVAT000032', 'RVED000003', 'RVTR000032', 1, 5, 'A', 5, false, false, null),
  ('RVAT000033', 'RVED000003', 'RVTR000033', 1, 6, 'A', 6, false, false, null),
  ('RVAT000034', 'RVED000003', 'RVTR000034', 1, 7, 'B', 1, false, false, null),
  ('RVAT000035', 'RVED000003', 'RVTR000035', 1, 8, 'B', 2, false, false, null),
  ('RVAT000036', 'RVED000003', 'RVTR000036', 1, 9, 'B', 3, false, false, null),
  ('RVAT000037', 'RVED000003', 'RVTR000037', 1, 10, 'B', 4, false, false, null),
  ('RVAT000038', 'RVED000003', 'RVTR000038', 1, 11, 'B', 5, false, false, null)
on conflict (retroverse_album_track_id) do update
set
  retroverse_album_edition_id = excluded.retroverse_album_edition_id,
  retroverse_track_id = excluded.retroverse_track_id,
  disc_number = excluded.disc_number,
  track_number = excluded.track_number,
  side_code = excluded.side_code,
  side_position = excluded.side_position,
  is_interlude = excluded.is_interlude,
  soundtrack_exclusive = excluded.soundtrack_exclusive,
  notes = excluded.notes;

insert into public.retroverse_album_artwork (
  retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id,
  artwork_role, is_primary, canonical_cover_path, cover_source, artwork_status, width_px, height_px, notes
)
values
  ('RVAW000001', 'RVAL000001', 'RVED000001', 'primary', true, 'retroverse/covers/RVAL000001/original-1977-us-primary.jpg', 'retroverse_cover_archive', 'verified', 1400, 1400, 'Pilot canonical cover path from Retroverse album-cover archive.'),
  ('RVAW000002', 'RVAL000001', null, 'alternate', false, 'retroverse/covers/RVAL000001/alternate-placeholder.jpg', 'retroverse_placeholder', 'pending', null, null, 'Placeholder for future alternate artwork ingestion.'),
  ('RVAW000003', 'RVAL000002', 'RVED000002', 'primary', true, 'retroverse/covers/RVAL000002/original-1976-us-primary.jpg', 'retroverse_cover_archive', 'verified', 1400, 1400, 'Pilot canonical cover path for Eagles greatest-hits compilation from Retroverse album-cover archive.'),
  ('RVAW000004', 'RVAL000002', null, 'alternate', false, 'retroverse/covers/RVAL000002/alternate-placeholder.jpg', 'retroverse_placeholder', 'pending', null, null, 'Placeholder for future alternate artwork ingestion.'),
  ('RVAW000005', 'RVAL000003', 'RVED000003', 'primary', true, 'retroverse/covers/RVAL000003/original-1977-us-primary.jpg', 'retroverse_cover_archive', 'verified', 1400, 1400, 'Pilot canonical cover path for Rumours studio release from Retroverse album-cover archive.'),
  ('RVAW000006', 'RVAL000003', null, 'alternate', false, 'retroverse/covers/RVAL000003/alternate-placeholder.jpg', 'retroverse_placeholder', 'pending', null, null, 'Placeholder for future alternate artwork ingestion.')
on conflict (retroverse_album_artwork_id) do update
set
  retroverse_album_id = excluded.retroverse_album_id,
  retroverse_album_edition_id = excluded.retroverse_album_edition_id,
  artwork_role = excluded.artwork_role,
  is_primary = excluded.is_primary,
  canonical_cover_path = excluded.canonical_cover_path,
  cover_source = excluded.cover_source,
  artwork_status = excluded.artwork_status,
  width_px = excluded.width_px,
  height_px = excluded.height_px,
  notes = excluded.notes;

insert into public.retroverse_chart_appearances (
  retroverse_chart_id, retroverse_track_id, chart_date, chart_name, chart_position, weeks_on_chart
)
values
  ('RVCH000001', 'RVTR000001', '1978-02-04', 'Billboard Hot 100', 1, 27),
  ('RVCH000002', 'RVTR000002', '1978-03-18', 'Billboard Hot 100', 1, 19),
  ('RVCH000003', 'RVTR000003', '1977-12-24', 'Billboard Hot 100', 1, 17),
  ('RVCH000004', 'RVTR000004', '1978-05-13', 'Billboard Hot 100', 1, 18),
  ('RVCH000005', 'RVTR000018', '1972-07-22', 'Billboard Hot 100', 12, 20),
  ('RVCH000006', 'RVTR000027', '1975-03-01', 'Billboard Hot 100', 1, 23),
  ('RVCH000007', 'RVTR000029', '1977-06-18', 'Billboard Hot 100', 1, 17),
  ('RVCH000008', 'RVTR000031', '1977-10-08', 'Billboard Hot 100', 3, 21),
  ('RVCH000009', 'RVTR000032', '1977-03-26', 'Billboard Hot 100', 10, 20),
  ('RVCH000010', 'RVTR000035', '1978-01-21', 'Billboard Hot 100', 9, 19)
on conflict (retroverse_chart_id) do update
set
  retroverse_track_id = excluded.retroverse_track_id,
  chart_date = excluded.chart_date,
  chart_name = excluded.chart_name,
  chart_position = excluded.chart_position,
  weeks_on_chart = excluded.weeks_on_chart;

insert into public.retroverse_media_assets (
  retroverse_media_asset_id,
  retroverse_track_id,
  media_type,
  media_source,
  local_path,
  thumbnail_path,
  file_name,
  duration_seconds,
  video_width,
  video_height,
  source_confidence,
  is_primary
)
values
  (
    'RVMA000001',
    'RVTR000001',
    'video',
    'virtualdj_local',
    '/Users/bobhopp/DJ MEDIA/VIDEO/1970''s/Bee Gees - Stayin'' Alive (Saturday Night Fever).mp4',
    'media-thumbnails/RVTR000001.jpg',
    'Bee Gees - Stayin'' Alive (Saturday Night Fever).mp4',
    null,
    null,
    null,
    0.9600,
    true
  ),
  (
    'RVMA000002',
    'RVTR000002',
    'video',
    'virtualdj_local',
    '/Users/bobhopp/DJ MEDIA/VIDEO/1970''s/Bee Gees - Night Fever.mp4',
    'media-thumbnails/RVTR000002.jpg',
    'Bee Gees - Night Fever.mp4',
    null,
    null,
    null,
    0.9600,
    true
  ),
  (
    'RVMA000003',
    'RVTR000029',
    'video',
    'virtualdj_local',
    '/Users/bobhopp/DJ MEDIA/VIDEO/1970''s/Fleetwood Mac - Dreams.mp4',
    'media-thumbnails/RVTR000029.jpg',
    'Fleetwood Mac - Dreams.mp4',
    null,
    null,
    null,
    0.9600,
    true
  ),
  (
    'RVMA000004',
    'RVTR000032',
    'video',
    'virtualdj_local',
    '/Users/bobhopp/DJ MEDIA/VIDEO/1970''s/Fleetwood Mac - Go Your Own Way.mp4',
    'media-thumbnails/RVTR000032.jpg',
    'Fleetwood Mac - Go Your Own Way.mp4',
    null,
    null,
    null,
    0.9600,
    true
  )
on conflict (retroverse_media_asset_id) do update
set
  retroverse_track_id = excluded.retroverse_track_id,
  media_type = excluded.media_type,
  media_source = excluded.media_source,
  local_path = excluded.local_path,
  thumbnail_path = excluded.thumbnail_path,
  file_name = excluded.file_name,
  duration_seconds = excluded.duration_seconds,
  video_width = excluded.video_width,
  video_height = excluded.video_height,
  source_confidence = excluded.source_confidence,
  is_primary = excluded.is_primary;

insert into public.retroverse_source_matches (
  retroverse_source_match_id, source, source_key, source_title, source_artist,
  retroverse_entity_type, retroverse_entity_id, confidence_score, manual_override, verified_by, notes
)
values
  ('RVSM000001', 'musicbrainz', 'b6f1d2f8-5f8a-3e2a-bf26-6f7ccf9f4f39', null, 'Bee Gees', 'artist', 'RVAR000001', 0.9900, false, 'seed:pilot', 'Artist identity match.'),
  ('RVSM000002', 'spotify', '3mQBpAOMWYqAZyxtyeo4Lo', null, 'Bee Gees', 'artist', 'RVAR000001', 0.9800, false, 'seed:pilot', 'Artist identity match.'),
  ('RVSM000003', 'musicbrainz', 'f2fdd6cb-baf8-4f2d-bc93-9c7af3f72f6b', null, 'Yvonne Elliman', 'artist', 'RVAR000002', 0.9800, false, 'seed:pilot', 'Artist identity match.'),
  ('RVSM000004', 'discogs', 'R-36098', 'Saturday Night Fever (The Original Movie Sound Track)', 'Various', 'album', 'RVAL000001', 0.9700, false, 'seed:pilot', 'Album source spelling retained.'),
  ('RVSM000005', 'spotify', '6W9w4riE6MS2f5z0yB1JxY', 'Saturday Night Fever [The Original Movie Sound Track]', 'Various Artists', 'album', 'RVAL000001', 0.9600, false, 'seed:pilot', 'Bracketed source title retained.'),
  ('RVSM000006', 'billboard', 'hot-100:1978-02-04:stayin-alive', 'Stayin Alive', 'Bee Gees', 'track', 'RVTR000001', 0.9950, false, 'seed:pilot', 'Variant without apostrophe.'),
  ('RVSM000007', 'spotify', '5ubvP9oKmxLUVq506fgLhk', 'Stayin'' Alive - From "Saturday Night Fever" Soundtrack', 'Bee Gees', 'track', 'RVTR000001', 0.9700, false, 'seed:pilot', 'Remaster/soundtrack wording stays in source layer.'),
  ('RVSM000008', 'virtualdj', 'vdj:file:Bee Gees - STAYIN ALIVE.mp4', 'Bee Gees - STAYIN ALIVE', 'Bee Gees', 'track', 'RVTR000001', 0.9300, true, 'seed:pilot', 'Manual override example from local file naming.'),
  ('RVSM000009', 'billboard', 'hot-100:1978-03-18:night-fever', 'Night Fever', 'Bee Gees', 'track', 'RVTR000002', 0.9950, false, 'seed:pilot', null),
  ('RVSM000010', 'billboard', 'hot-100:1977-12-24:how-deep-is-your-love', 'How Deep Is Your Love', 'Bee Gees', 'track', 'RVTR000003', 0.9950, false, 'seed:pilot', null),
  ('RVSM000011', 'billboard', 'hot-100:1978-05-13:if-i-cant-have-you', 'If I Can''t Have You', 'Yvonne Elliman', 'track', 'RVTR000004', 0.9950, false, 'seed:pilot', null),
  ('RVSM000012', 'musicbrainz', 'ffd3d8c8-91f1-4ecc-8f04-8f26a3f4bd4d', null, 'Eagles', 'artist', 'RVAR000012', 0.9900, false, 'seed:pilot', 'Artist identity match.'),
  ('RVSM000013', 'spotify', '0ECwFtbIWEVNwjlrfc6xoL', null, 'Eagles', 'artist', 'RVAR000012', 0.9800, false, 'seed:pilot', 'Artist identity match.'),
  ('RVSM000014', 'discogs', 'R-1265425', 'Their Greatest Hits (1971-1975)', 'Eagles', 'album', 'RVAL000002', 0.9800, false, 'seed:pilot', 'Compilation album source title retained.'),
  ('RVSM000015', 'spotify', '4yP0hdKOZPNshxUOjY0cZj', 'Their Greatest Hits 1971-1975 (2013 Remaster)', 'Eagles', 'album', 'RVAL000002', 0.9700, false, 'seed:pilot', 'Remaster phrasing retained in source layer.'),
  ('RVSM000016', 'billboard', 'hot-100:1972-07-22:take-it-easy', 'Take It Easy', 'Eagles', 'track', 'RVTR000018', 0.9800, false, 'seed:pilot', null),
  ('RVSM000017', 'billboard', 'hot-100:1975-03-01:best-of-my-love', 'Best of My Love', 'Eagles', 'track', 'RVTR000027', 0.9950, false, 'seed:pilot', null),
  ('RVSM000018', 'spotify', '4v8KEbRnL3Hjxj6WnOqxyW', 'Take It Easy - 2013 Remaster', 'Eagles', 'track', 'RVTR000018', 0.9700, false, 'seed:pilot', 'Remaster phrasing retained in source layer.'),
  ('RVSM000019', 'spotify', '4x6lD6VY2fG3VkA6dAqJ5s', 'Lyin'' Eyes - 2013 Remaster', 'Eagles', 'track', 'RVTR000020', 0.9700, false, 'seed:pilot', 'Remaster phrasing retained in source layer.'),
  ('RVSM000020', 'spotify', '6QhXQOpyYvbpdbyjgA6RDP', 'Best of My Love - 2013 Remaster', 'Eagles', 'track', 'RVTR000027', 0.9700, false, 'seed:pilot', 'Remaster phrasing retained in source layer.'),
  ('RVSM000021', 'musicbrainz', 'd7002d2b-f9f4-3dbd-a0f8-6ac66baf7e63', null, 'Fleetwood Mac', 'artist', 'RVAR000013', 0.9900, false, 'seed:pilot', 'Artist identity match.'),
  ('RVSM000022', 'spotify', '08GQAI4eElDnROBrJRGE0X', null, 'Fleetwood Mac', 'artist', 'RVAR000013', 0.9800, false, 'seed:pilot', 'Artist identity match.'),
  ('RVSM000023', 'discogs', 'R-377464', 'Rumours', 'Fleetwood Mac', 'album', 'RVAL000003', 0.9800, false, 'seed:pilot', 'Studio album source title retained.'),
  ('RVSM000024', 'spotify', '1bt6q2SruMsBtcerNVtpZB', 'Rumours (Super Deluxe)', 'Fleetwood Mac', 'album', 'RVAL000003', 0.9600, false, 'seed:pilot', 'Edition naming retained in source layer.'),
  ('RVSM000025', 'billboard', 'hot-100:1977-06-18:dreams', 'Dreams', 'Fleetwood Mac', 'track', 'RVTR000029', 0.9950, false, 'seed:pilot', null),
  ('RVSM000026', 'billboard', 'hot-100:1977-03-26:go-your-own-way', 'Go Your Own Way', 'Fleetwood Mac', 'track', 'RVTR000032', 0.9900, false, 'seed:pilot', null),
  ('RVSM000027', 'billboard', 'hot-100:1977-10-08:dont-stop', 'Don''t Stop', 'Fleetwood Mac', 'track', 'RVTR000031', 0.9900, false, 'seed:pilot', null),
  ('RVSM000028', 'spotify', '0ofHAoxe9vBkTCp2UQIavz', 'Dreams - 2004 Remaster', 'Fleetwood Mac', 'track', 'RVTR000029', 0.9700, false, 'seed:pilot', 'Remaster phrasing retained in source layer.'),
  ('RVSM000029', 'spotify', '07GvNcU1WdyZJq3XxP0kZa', 'Go Your Own Way - 2004 Remaster', 'Fleetwood Mac', 'track', 'RVTR000032', 0.9700, false, 'seed:pilot', 'Remaster phrasing retained in source layer.'),
  ('RVSM000030', 'spotify', '4bEb3KE4mSKlTFjtWJQBqO', 'You Make Loving Fun - 2004 Remaster', 'Fleetwood Mac', 'track', 'RVTR000035', 0.9700, false, 'seed:pilot', 'Remaster phrasing retained in source layer.')
on conflict (retroverse_source_match_id) do update
set
  source = excluded.source,
  source_key = excluded.source_key,
  source_title = excluded.source_title,
  source_artist = excluded.source_artist,
  retroverse_entity_type = excluded.retroverse_entity_type,
  retroverse_entity_id = excluded.retroverse_entity_id,
  confidence_score = excluded.confidence_score,
  manual_override = excluded.manual_override,
  verified_by = excluded.verified_by,
  notes = excluded.notes;
