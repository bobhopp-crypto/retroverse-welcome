import { integrityQuery, isCanonicalGraphEnabled } from "./pg";
import type {
  GraphAlbumDetail,
  GraphAlbumMediaAsset,
  GraphAlbumTrackFamily,
  GraphCoverSummary,
  GraphYearAlbum,
} from "./types";

type YearAggRow = {
  pg_album_id: number;
  external_key: string | null;
  artist_name: string;
  album_title: string;
  release_year: number | null;
  peak_position: number | null;
  max_weeks: number | null;
  first_chart_date: string | null;
  week_rows: number;
};

function toGraphYearAlbum(row: YearAggRow, displayRank: number): GraphYearAlbum {
  const pgAlbumId = row.pg_album_id;
  const albumId = row.external_key?.trim().toUpperCase() || `PG:${pgAlbumId}`;
  return {
    albumId,
    pgAlbumId,
    displayRank,
    peakChartPosition: row.peak_position,
    weeksOnChart: row.max_weeks,
    firstChartDate: row.first_chart_date,
    artistName: row.artist_name,
    albumTitle: row.album_title,
    releaseYear: row.release_year,
  };
}

export async function getYearAlbums(year: number): Promise<GraphYearAlbum[]> {
  if (!isCanonicalGraphEnabled()) return [];
  const rows = await integrityQuery<YearAggRow>(
    `
    WITH year_chart AS (
      SELECT
        ca.album_id AS pg_album_id,
        min(ca.chart_position) AS peak_position,
        max(ca.weeks_on_chart) AS max_weeks,
        min(ca.chart_date)::text AS first_chart_date,
        count(*)::int AS week_rows
      FROM chart_appearances ca
      WHERE ca.chart_name = 'Billboard 200'
        AND ca.album_id IS NOT NULL
        AND extract(year FROM ca.chart_date) = $1
      GROUP BY ca.album_id
    )
    SELECT
      yc.pg_album_id,
      ek.external_key,
      ar.canonical_name AS artist_name,
      al.title AS album_title,
      al.release_year,
      yc.peak_position,
      yc.max_weeks,
      yc.first_chart_date,
      yc.week_rows
    FROM year_chart yc
    JOIN albums al ON al.id = yc.pg_album_id
    JOIN artists ar ON ar.id = al.artist_id
    LEFT JOIN album_external_keys ek ON ek.album_id = yc.pg_album_id
    ORDER BY yc.peak_position NULLS LAST, yc.max_weeks DESC NULLS LAST, ar.canonical_name, al.title
    `,
    [year],
  );
  return rows.map((r, i) => toGraphYearAlbum(r, i + 1));
}

export async function getChartWeekAlbums(chartDate: string): Promise<GraphYearAlbum[]> {
  if (!isCanonicalGraphEnabled()) return [];
  const rows = await integrityQuery<YearAggRow & { chart_position: number | null }>(
    `
    SELECT
      ca.album_id AS pg_album_id,
      ek.external_key,
      ar.canonical_name AS artist_name,
      al.title AS album_title,
      al.release_year,
      ca.chart_position AS peak_position,
      ca.weeks_on_chart AS max_weeks,
      ca.chart_date::text AS first_chart_date,
      1 AS week_rows
    FROM chart_appearances ca
    JOIN albums al ON al.id = ca.album_id
    JOIN artists ar ON ar.id = al.artist_id
    LEFT JOIN album_external_keys ek ON ek.album_id = ca.album_id
    WHERE ca.chart_name = 'Billboard 200'
      AND ca.chart_date = $1::date
      AND ca.album_id IS NOT NULL
    ORDER BY ca.chart_position NULLS LAST, ar.canonical_name, al.title
    `,
    [chartDate],
  );
  return rows.map((r, i) => toGraphYearAlbum(r, i + 1));
}

export async function getAlbumDetail(pgAlbumId: number): Promise<GraphAlbumDetail | null> {
  if (!isCanonicalGraphEnabled()) return null;
  const rows = await integrityQuery<{
    pg_album_id: number;
    external_key: string | null;
    artist_name: string;
    album_title: string;
    release_year: number | null;
    peak_position: number | null;
    max_weeks: number | null;
    first_chart_date: string | null;
    last_chart_date: string | null;
    chart_week_count: number;
    track_family_count: number;
    media_asset_count: number;
    has_video_media: boolean;
    has_audio_media: boolean;
    has_youtube_enrichment: boolean;
    canonical_cover_path: string | null;
    r2_cover_key: string | null;
    cover_review_flag: string | null;
  }>(
    `
    SELECT
      al.id AS pg_album_id,
      ek.external_key,
      ar.canonical_name AS artist_name,
      al.title AS album_title,
      al.release_year,
      stats.peak_position,
      stats.max_weeks,
      stats.first_chart_date,
      stats.last_chart_date,
      stats.chart_week_count,
      coalesce(tf.track_family_count, 0)::int AS track_family_count,
      coalesce(ma.media_asset_count, 0)::int AS media_asset_count,
      coalesce(ma.has_video_media, false) AS has_video_media,
      coalesce(ma.has_audio_media, false) AS has_audio_media,
      coalesce(yt.has_youtube_enrichment, false) AS has_youtube_enrichment,
      coalesce(aal.canonical_cover_path, al.canonical_cover_path) AS canonical_cover_path,
      aal.r2_cover_key,
      aal.review_flag AS cover_review_flag
    FROM albums al
    JOIN artists ar ON ar.id = al.artist_id
    LEFT JOIN album_external_keys ek ON ek.album_id = al.id
    LEFT JOIN LATERAL (
      SELECT
        min(ca.chart_position) AS peak_position,
        max(ca.weeks_on_chart) AS max_weeks,
        min(ca.chart_date)::text AS first_chart_date,
        max(ca.chart_date)::text AS last_chart_date,
        count(*)::int AS chart_week_count
      FROM chart_appearances ca
      WHERE ca.album_id = al.id AND ca.chart_name = 'Billboard 200'
    ) stats ON true
    LEFT JOIN LATERAL (
      SELECT count(DISTINCT ctal.track_family_id)::int AS track_family_count
      FROM canonical_track_album_links ctal
      WHERE ctal.album_id = al.id
    ) tf ON true
    LEFT JOIN LATERAL (
      SELECT
        count(*)::int AS media_asset_count,
        bool_or(ma.source_path ~* '\\.(mp4|mov|m4v|mkv)$') AS has_video_media,
        bool_or(ma.source_path IS NOT NULL AND ma.source_path !~* '\\.(mp4|mov|m4v|mkv)$') AS has_audio_media
      FROM media_track_links mtl
      JOIN media_assets ma ON ma.id = mtl.media_asset_id
      LEFT JOIN tracks t ON t.id = mtl.track_id
      WHERE t.album_id = al.id OR EXISTS (
        SELECT 1 FROM canonical_track_album_links c
        WHERE c.album_id = al.id AND c.track_family_id = mtl.track_family_id
      )
    ) ma ON true
    LEFT JOIN LATERAL (
      SELECT true AS has_youtube_enrichment
      FROM album_external_keys ek2
      JOIN staging_youtube_link_imports s
        ON lower(trim(s.artist_text)) = lower(trim(ar.canonical_name))
       AND lower(trim(s.title_text)) = lower(trim(al.title))
      WHERE ek2.album_id = al.id
      LIMIT 1
    ) yt ON true
    LEFT JOIN LATERAL (
      SELECT aal.canonical_cover_path, aal.r2_cover_key, aal.review_flag
      FROM album_artwork_links aal
      WHERE aal.album_id = al.id
      ORDER BY (aal.review_flag IN ('curated', 'ok')) DESC, aal.confidence_score DESC NULLS LAST
      LIMIT 1
    ) aal ON true
    WHERE al.id = $1
    `,
    [pgAlbumId],
  );
  const row = rows[0];
  if (!row) return null;
  return {
    pgAlbumId: row.pg_album_id,
    albumId: row.external_key?.trim().toUpperCase() || `PG:${row.pg_album_id}`,
    artistName: row.artist_name,
    albumTitle: row.album_title,
    releaseYear: row.release_year,
    peakChartPosition: row.peak_position,
    weeksOnChart: row.max_weeks,
    firstChartDate: row.first_chart_date,
    lastChartDate: row.last_chart_date,
    chartWeekCount: row.chart_week_count,
    trackFamilyCount: row.track_family_count,
    mediaAssetCount: row.media_asset_count,
    hasVideoMedia: row.has_video_media,
    hasAudioMedia: row.has_audio_media,
    hasYoutubeEnrichment: row.has_youtube_enrichment,
    canonicalCoverPath: row.canonical_cover_path,
    r2CoverKey: row.r2_cover_key,
    coverReviewFlag: row.cover_review_flag,
  };
}

export async function getAlbumDetailByExternalKey(externalKey: string): Promise<GraphAlbumDetail | null> {
  const key = externalKey.trim().toUpperCase();
  const rows = await integrityQuery<{ album_id: number }>(
    `SELECT album_id FROM album_external_keys WHERE external_key = $1`,
    [key],
  );
  const pgId = rows[0]?.album_id;
  if (!pgId) return null;
  return getAlbumDetail(pgId);
}

export async function getAlbumTrackFamilies(pgAlbumId: number): Promise<GraphAlbumTrackFamily[]> {
  if (!isCanonicalGraphEnabled()) return [];
  return integrityQuery<GraphAlbumTrackFamily>(
    `
    SELECT
      tf.id AS "trackFamilyId",
      tf.canonical_name AS "trackFamilyName",
      t.title AS "trackTitle",
      ctal.track_number AS "trackNumber",
      ctal.disc_number AS "discNumber",
      ctal.source
    FROM canonical_track_album_links ctal
    JOIN track_families tf ON tf.id = ctal.track_family_id
    LEFT JOIN track_family_members tfm ON tfm.track_family_id = tf.id AND tfm.is_primary_recording = true
    LEFT JOIN tracks t ON t.id = tfm.track_id
    WHERE ctal.album_id = $1
    ORDER BY ctal.disc_number NULLS FIRST, ctal.track_number NULLS FIRST, tf.canonical_name
    `,
    [pgAlbumId],
  );
}

export async function getAlbumMediaAssets(pgAlbumId: number): Promise<GraphAlbumMediaAsset[]> {
  if (!isCanonicalGraphEnabled()) return [];
  return integrityQuery<GraphAlbumMediaAsset>(
    `
    SELECT DISTINCT
      ma.id,
      ma.artist_text AS "artistText",
      ma.title_text AS "titleText",
      ma.source_path AS "sourcePath",
      ma.play_count AS "playCount",
      mtl.track_id AS "linkedTrackId"
    FROM media_assets ma
    JOIN media_track_links mtl ON mtl.media_asset_id = ma.id
    LEFT JOIN tracks t ON t.id = mtl.track_id
    LEFT JOIN canonical_track_album_links ctal ON ctal.album_id = $1 AND ctal.track_family_id = mtl.track_family_id
    WHERE t.album_id = $1 OR ctal.id IS NOT NULL
    ORDER BY ma.play_count DESC NULLS LAST, ma.artist_text, ma.title_text
    LIMIT 100
    `,
    [pgAlbumId],
  );
}

export async function getArtistTimeline(artistId: number): Promise<
  Array<{
    year: number;
    albumCount: number;
    peakPosition: number | null;
    chartWeeks: number;
  }>
> {
  if (!isCanonicalGraphEnabled()) return [];
  return integrityQuery(
    `
    SELECT
      extract(year FROM ca.chart_date)::int AS year,
      count(DISTINCT ca.album_id)::int AS "albumCount",
      min(ca.chart_position) AS "peakPosition",
      count(*)::int AS "chartWeeks"
    FROM chart_appearances ca
    JOIN albums al ON al.id = ca.album_id
    WHERE al.artist_id = $1
      AND ca.chart_name = 'Billboard 200'
      AND ca.album_id IS NOT NULL
    GROUP BY 1
    ORDER BY 1
    `,
    [artistId],
  );
}

export async function getCoverSummary(): Promise<GraphCoverSummary> {
  if (!isCanonicalGraphEnabled()) {
    return {
      albumsWithLinks: 0,
      albumsMissingCovers: 0,
      r2CoverLinks: 0,
      curatedCovers: 0,
      unresolvedCovers: 0,
    };
  }
  const rows = await integrityQuery<GraphCoverSummary>(
    `
    SELECT
      (SELECT count(DISTINCT album_id)::int FROM album_artwork_links) AS "albumsWithLinks",
      (
        SELECT count(*)::int FROM albums al
        WHERE NOT EXISTS (
          SELECT 1 FROM album_artwork_links aal
          WHERE aal.album_id = al.id
            AND (coalesce(aal.canonical_cover_path, '') <> '' OR coalesce(aal.r2_cover_key, '') <> '')
        )
        AND coalesce(al.canonical_cover_path, '') = ''
      ) AS "albumsMissingCovers",
      (SELECT count(*)::int FROM album_artwork_links WHERE coalesce(r2_cover_key, '') <> '') AS "r2CoverLinks",
      (SELECT count(*)::int FROM album_artwork_links WHERE review_flag = 'curated') AS "curatedCovers",
      (
        SELECT count(*)::int FROM albums al
        WHERE coalesce(al.canonical_cover_path, '') = ''
          AND NOT EXISTS (SELECT 1 FROM album_artwork_links aal WHERE aal.album_id = al.id)
      ) AS "unresolvedCovers"
    `,
  );
  return (
    rows[0] ?? {
      albumsWithLinks: 0,
      albumsMissingCovers: 0,
      r2CoverLinks: 0,
      curatedCovers: 0,
      unresolvedCovers: 0,
    }
  );
}

/** Map graph year entries to portal viewer entries (RVAL ids when bridged). */
export function graphYearAlbumsToViewerEntries(rows: GraphYearAlbum[]) {
  return rows.map((r) => ({
    albumId: r.albumId,
    displayRank: r.displayRank,
    peakChartPosition: r.peakChartPosition,
    weeksOnChart: r.weeksOnChart,
  }));
}
