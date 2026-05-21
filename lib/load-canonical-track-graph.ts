import { integrityQuery, isCanonicalGraphEnabled } from "@/lib/canonical-graph";
import { normalizeAlbumTrackTitleKey } from "@/lib/load-album-track-routes";

export type CanonicalTrackEntity = {
  trackId: string;
  canonicalTitle: string;
  normalizedTitleKey: string;
  canonicalArtistName: string | null;
  firstChartDate: string | null;
  peakHot100Position: number | null;
  chartWeeks: number;
  hasHot100: boolean;
  hasVdjMedia: boolean;
  hasVideo: boolean;
  hasAudio: boolean;
  hasYoutube: boolean;
  identitySource: string;
  versionCount: number;
  retroverseTrackId: string | null;
};

export type CanonicalTrackVersion = {
  sourceType: string;
  sourceTitle: string;
  sourceArtist: string | null;
  sourceAlbum: string | null;
  versionType: string;
  isPrimary: boolean;
  confidenceScore: number;
};

const RE_RVTR = /^RVTR\d{6}$/i;

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export async function loadCanonicalTrackById(
  trackId: string,
): Promise<CanonicalTrackEntity | null> {
  const id = trackId.trim().toUpperCase();
  if (!RE_RVTR.test(id) || !isCanonicalGraphEnabled()) return null;

  try {
    const rows = await integrityQuery<{
      track_id: string;
      canonical_title: string;
      normalized_title_key: string;
      canonical_artist_name: string | null;
      first_chart_date: string | null;
      peak_hot100_position: number | null;
      chart_weeks: number;
      has_hot100: boolean;
      has_vdj_media: boolean;
      has_video: boolean;
      has_audio: boolean;
      has_youtube: boolean;
      identity_source: string;
      version_count: number;
      retroverse_track_id: string | null;
    }>(
      `
      SELECT
        track_id,
        canonical_title,
        normalized_title_key,
        canonical_artist_name,
        first_chart_date::text,
        peak_hot100_position,
        chart_weeks,
        has_hot100,
        has_vdj_media,
        has_video,
        has_audio,
        has_youtube,
        identity_source,
        version_count,
        retroverse_track_id
      FROM canonical_track_display
      WHERE track_id = $1
      LIMIT 1
      `,
      [id],
    );
    const row = rows[0];
    if (!row) return null;
    return mapEntity(row);
  } catch {
    return null;
  }
}

export async function loadCanonicalTrackByTitleSlug(
  titleSlug: string,
): Promise<CanonicalTrackEntity | null> {
  const slug = normalizeSlug(titleSlug);
  if (!slug || !isCanonicalGraphEnabled()) return null;

  try {
    const rows = await integrityQuery<{
      track_id: string;
      canonical_title: string;
      normalized_title_key: string;
      canonical_artist_name: string | null;
      first_chart_date: string | null;
      peak_hot100_position: number | null;
      chart_weeks: number;
      has_hot100: boolean;
      has_vdj_media: boolean;
      has_video: boolean;
      has_audio: boolean;
      has_youtube: boolean;
      identity_source: string;
      version_count: number;
      retroverse_track_id: string | null;
    }>(
      `
      SELECT
        track_id,
        canonical_title,
        normalized_title_key,
        canonical_artist_name,
        first_chart_date::text,
        peak_hot100_position,
        chart_weeks,
        has_hot100,
        has_vdj_media,
        has_video,
        has_audio,
        has_youtube,
        identity_source,
        version_count,
        retroverse_track_id
      FROM canonical_track_display
      WHERE lower(regexp_replace(canonical_title, '[^a-z0-9]+', '-', 'g')) = $1
      ORDER BY has_hot100 DESC, peak_hot100_position ASC NULLS LAST, chart_weeks DESC
      LIMIT 1
      `,
      [slug],
    );
    const row = rows[0];
    if (!row) return null;
    return mapEntity(row);
  } catch {
    return null;
  }
}

export async function loadCanonicalTrackVersions(trackId: string): Promise<CanonicalTrackVersion[]> {
  const id = trackId.trim().toUpperCase();
  if (!RE_RVTR.test(id) || !isCanonicalGraphEnabled()) return [];

  try {
    const rows = await integrityQuery<{
      source_type: string;
      source_title: string;
      source_artist: string | null;
      source_album: string | null;
      version_type: string;
      is_primary: boolean;
      confidence_score: number;
    }>(
      `
      SELECT
        v.source_type,
        v.source_title,
        v.source_artist,
        v.source_album,
        v.version_type,
        v.is_primary,
        v.confidence_score::float8 AS confidence_score
      FROM canonical_track_versions v
      JOIN canonical_tracks ct ON ct.id = v.canonical_track_id
      WHERE ct.track_id = $1
      ORDER BY v.is_primary DESC, v.confidence_score DESC, v.source_title ASC
      `,
      [id],
    );
    return rows.map((r) => ({
      sourceType: r.source_type,
      sourceTitle: r.source_title,
      sourceArtist: r.source_artist,
      sourceAlbum: r.source_album,
      versionType: r.version_type,
      isPrimary: r.is_primary,
      confidenceScore: r.confidence_score,
    }));
  } catch {
    return [];
  }
}

export async function loadAlbumCanonicalTrackRouteIndex(
  albumId: string,
): Promise<Record<string, string>> {
  const rval = albumId.trim().toUpperCase();
  if (!/^RVAL\d{6}$/.test(rval) || !isCanonicalGraphEnabled()) return {};

  try {
    const rows = await integrityQuery<{
      canonical_title: string;
      track_id: string;
    }>(
      `
      SELECT cat.title AS canonical_title, ct.track_id
      FROM canonical_album_tracks cat
      JOIN albums al ON al.id = cat.album_id
      JOIN album_external_keys aek ON aek.album_id = al.id
      JOIN artists ar ON ar.id = al.artist_id
      JOIN canonical_tracks ct ON ct.artist_id = ar.id
        AND ct.normalized_title_key = lower(
          trim(
            regexp_replace(
              regexp_replace(
                regexp_replace(lower(trim(cat.title)), '[''[\](){}]', ' ', 'g'),
                '[–—−]', '-', 'g'
              ),
              '\\s*[-]\\s*(remastered?|live|radio edit|mono|stereo|explicit|clean|instrumental|karaoke|acoustic|extended mix|remix).*$',
              '',
              'gi'
            )
          )
        )
      WHERE upper(trim(aek.external_key)) = $1
        AND ct.track_id IS NOT NULL

      UNION

      SELECT cat.title AS canonical_title, cat.canonical_track_key AS track_id
      FROM canonical_album_tracks cat
      JOIN album_external_keys aek ON aek.album_id = cat.album_id
      WHERE upper(trim(aek.external_key)) = $1
        AND cat.canonical_track_key IS NOT NULL
        AND cat.canonical_track_key ~ '^RVTR[0-9]{6}$'
      `,
      [rval],
    );

    const index: Record<string, string> = {};
    for (const row of rows) {
      const key = normalizeAlbumTrackTitleKey(row.canonical_title);
      const id = row.track_id?.trim().toUpperCase();
      if (key && id && RE_RVTR.test(id) && !index[key]) {
        index[key] = `/tracks/${id}`;
      }
    }
    return index;
  } catch {
    return {};
  }
}

export async function searchCanonicalTracksByTitle(
  needle: string,
  limit = 8,
): Promise<CanonicalTrackEntity[]> {
  const q = needle.trim();
  if (q.length < 2 || !isCanonicalGraphEnabled()) return [];

  try {
    const rows = await integrityQuery<{
      track_id: string;
      canonical_title: string;
      normalized_title_key: string;
      canonical_artist_name: string | null;
      first_chart_date: string | null;
      peak_hot100_position: number | null;
      chart_weeks: number;
      has_hot100: boolean;
      has_vdj_media: boolean;
      has_video: boolean;
      has_audio: boolean;
      has_youtube: boolean;
      identity_source: string;
      version_count: number;
      retroverse_track_id: string | null;
    }>(
      `
      SELECT
        track_id,
        canonical_title,
        normalized_title_key,
        canonical_artist_name,
        first_chart_date::text,
        peak_hot100_position,
        chart_weeks,
        has_hot100,
        has_vdj_media,
        has_video,
        has_audio,
        has_youtube,
        identity_source,
        version_count,
        retroverse_track_id
      FROM canonical_track_display
      WHERE canonical_title ILIKE '%' || $1 || '%'
      ORDER BY has_hot100 DESC, peak_hot100_position ASC NULLS LAST, chart_weeks DESC, canonical_title ASC
      LIMIT $2
      `,
      [q.replace(/[%_]/g, ""), limit * 3],
    );

    const seen = new Set<string>();
    const out: CanonicalTrackEntity[] = [];
    for (const row of rows) {
      const key = `${row.canonical_artist_name ?? ""}::${row.normalized_title_key}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(mapEntity(row));
      if (out.length >= limit) break;
    }
    return out;
  } catch {
    return [];
  }
}

function mapEntity(row: {
  track_id: string;
  canonical_title: string;
  normalized_title_key: string;
  canonical_artist_name: string | null;
  first_chart_date: string | null;
  peak_hot100_position: number | null;
  chart_weeks: number;
  has_hot100: boolean;
  has_vdj_media: boolean;
  has_video: boolean;
  has_audio: boolean;
  has_youtube: boolean;
  identity_source: string;
  version_count: number;
  retroverse_track_id: string | null;
}): CanonicalTrackEntity {
  return {
    trackId: row.track_id,
    canonicalTitle: row.canonical_title,
    normalizedTitleKey: row.normalized_title_key,
    canonicalArtistName: row.canonical_artist_name,
    firstChartDate: row.first_chart_date,
    peakHot100Position: row.peak_hot100_position,
    chartWeeks: row.chart_weeks,
    hasHot100: row.has_hot100,
    hasVdjMedia: row.has_vdj_media,
    hasVideo: row.has_video,
    hasAudio: row.has_audio,
    hasYoutube: row.has_youtube,
    identitySource: row.identity_source,
    versionCount: row.version_count,
    retroverseTrackId: row.retroverse_track_id ?? row.track_id,
  };
}
