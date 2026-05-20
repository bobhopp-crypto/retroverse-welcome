-- 801_acoustic_features_track_album_candidates.sql
-- Candidate track ↔ album links from Spotify acoustic_features staging.
-- READ-ONLY (SELECT). Does not mutate canonical graph.
--
-- Prerequisite: staging_acoustic_features loaded from SQLite acoustic_features
-- (billboard-200-albums-charts.db). See docs/acoustics_linkage_investigation.md
--
-- Example load:
--   sqlite3 -header -csv $ACOUSTIC_DB \
--     "SELECT id,song,album,artist,acousticness,danceability,duration_ms,energy,
--             instrumentalness,key,liveness,loudness,mode,speechiness,tempo,
--             time_signature,valence,album_id,date FROM acoustic_features;" \
--     > /tmp/acoustic_features.csv
--   psql ... -c "\copy staging_acoustic_features FROM '/tmp/acoustic_features.csv' CSV HEADER"

-- One-time staging DDL (safe to re-run):
CREATE TABLE IF NOT EXISTS staging_acoustic_features (
  id                 text PRIMARY KEY,
  song               text,
  album              text,
  artist             text,
  acousticness       double precision,
  danceability       double precision,
  duration_ms        double precision,
  energy             double precision,
  instrumentalness   double precision,
  key                integer,
  liveness           double precision,
  loudness           double precision,
  mode               integer,
  speechiness        double precision,
  tempo              double precision,
  time_signature     integer,
  valence            double precision,
  album_id           text,
  date               text
);

CREATE INDEX IF NOT EXISTS idx_staging_acoustic_artist_title
  ON staging_acoustic_features (lower(trim(artist)), lower(trim(song)));

CREATE INDEX IF NOT EXISTS idx_staging_acoustic_artist_album
  ON staging_acoustic_features (lower(trim(artist)), lower(trim(album)));

WITH acoustic_norm AS (
  SELECT
    af.id AS spotify_track_id,
    af.song,
    af.album,
    af.artist,
    af.album_id AS spotify_album_id,
    af.duration_ms,
    af.date,
    lower(trim(af.artist)) AS norm_artist,
    lower(trim(af.album)) AS norm_album,
    lower(trim(af.song)) AS norm_song,
    round(af.duration_ms / 1000.0)::int AS duration_sec
  FROM staging_acoustic_features af
  WHERE coalesce(trim(af.song), '') <> ''
    AND coalesce(trim(af.album), '') <> ''
    AND coalesce(trim(af.artist), '') <> ''
),
track_matches AS (
  SELECT
    an.*,
    t.id AS track_id,
    tfm.track_family_id,
    a.id AS matched_artist_id,
    a.canonical_name AS matched_artist_name,
    t.title AS matched_track_title,
    t.duration_seconds AS pg_duration_sec,
    CASE
      WHEN lower(trim(t.title)) = an.norm_song THEN 50
      WHEN lower(trim(t.title)) LIKE an.norm_song || '%' THEN 35
      WHEN an.norm_song LIKE lower(trim(t.title)) || '%' THEN 30
      ELSE 15
    END AS title_score,
    CASE
      WHEN t.duration_seconds IS NOT NULL
       AND an.duration_sec IS NOT NULL
       AND abs(t.duration_seconds - an.duration_sec) <= 3 THEN 15
      WHEN t.duration_seconds IS NULL OR an.duration_sec IS NULL THEN 0
      ELSE -20
    END AS duration_score
  FROM acoustic_norm an
  JOIN artists a ON lower(trim(a.canonical_name)) = an.norm_artist
  JOIN tracks t ON t.artist_id = a.id
  LEFT JOIN track_family_members tfm ON tfm.track_id = t.id
  WHERE lower(trim(t.title)) = an.norm_song
     OR lower(trim(t.title)) LIKE an.norm_song || '%'
     OR an.norm_song LIKE lower(trim(t.title)) || '%'
),
album_candidates AS (
  SELECT
    tm.*,
    al.id AS resolved_album_id,
    al.title AS resolved_album_title,
    r.canonical_album_name AS registry_album_title,
    row_number() OVER (
      PARTITION BY tm.spotify_track_id, tm.track_id
      ORDER BY
        (lower(trim(al.title)) = tm.norm_album) DESC,
        (r.proposed_album_key IS NOT NULL) DESC,
        al.id
    ) AS album_rank
  FROM track_matches tm
  LEFT JOIN albums al
    ON al.artist_id = tm.matched_artist_id
   AND lower(trim(al.title)) = tm.norm_album
  LEFT JOIN album_population_registry r
    ON r.canonical_artist_id = tm.matched_artist_id
   AND lower(trim(r.canonical_album_name)) = tm.norm_album
),
scored AS (
  SELECT
    ac.track_id,
    ac.track_family_id,
    ac.album AS album_candidate,
    ac.artist AS artist_candidate,
    coalesce(ac.resolved_album_title, ac.album) AS album_match_name,
    ac.spotify_track_id,
    ac.spotify_album_id,
    ac.duration_sec,
    ac.pg_duration_sec,
    (ac.title_score + ac.duration_score + 25
      + CASE WHEN ac.resolved_album_id IS NOT NULL THEN 20 ELSE 0 END
    )::int AS confidence_score,
    CASE
      WHEN ac.pg_duration_sec IS NOT NULL AND ac.duration_sec IS NOT NULL
       AND abs(ac.pg_duration_sec - ac.duration_sec) <= 3 THEN true
      ELSE false
    END AS duration_match,
    count(*) OVER (PARTITION BY ac.track_id, ac.norm_album) AS album_title_hits
  FROM album_candidates ac
  WHERE ac.album_rank = 1
)
SELECT
  track_id,
  track_family_id,
  album_candidate,
  artist_candidate,
  duration_match,
  confidence_score,
  CASE
    WHEN confidence_score >= 85 AND duration_match THEN 'ok'
    WHEN confidence_score >= 70 THEN 'review_required'
    ELSE 'review_required'
  END AS review_flag
FROM scored
WHERE confidence_score >= 55
ORDER BY confidence_score DESC, artist_candidate, album_candidate, track_id
LIMIT 20000;
