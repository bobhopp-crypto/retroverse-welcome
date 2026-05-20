import { integrityQuery } from "./pg";
import type {
  AcousticAmbiguousRow,
  AcousticLinkageSummary,
  AcousticTracklistRow,
  ExplorerData,
  Hot100AlbumLinkRow,
  IntegrityView,
} from "./types";

export async function loadAcousticLinkageSummary(): Promise<AcousticLinkageSummary> {
  try {
    const rows = await integrityQuery<AcousticLinkageSummary>(
      `
      SELECT
        (SELECT count(*)::int FROM staging_acoustic_tracks) AS staging_rows,
        (SELECT count(*)::int FROM acoustic_track_album_candidates) AS candidates,
        (SELECT count(*)::int FROM acoustic_track_album_candidates WHERE review_flag = 'ok') AS ok_candidates,
        (SELECT count(*)::int FROM acoustic_track_album_candidates WHERE review_flag = 'review_required') AS review_candidates,
        (SELECT count(*)::int FROM album_track_lineage WHERE source_provenance = 'acoustics') AS acoustics_lineage,
        (SELECT count(*)::int FROM canonical_track_album_links WHERE source = 'acoustics') AS acoustics_ctal,
        (
          SELECT count(*)::int FROM chart_track_album_links
          WHERE source = 'acoustics_hot100_backfill'
        ) AS hot100_acoustic_links,
        (
          SELECT count(*)::int
          FROM chart_appearances ca
          WHERE ca.chart_name = 'Billboard Hot 100'
            AND ca.track_id IS NOT NULL
            AND NOT EXISTS (
              SELECT 1 FROM chart_track_album_links l WHERE l.chart_appearance_id = ca.id
            )
        ) AS hot100_unresolved
      `,
    );
    return (
      rows[0] ?? {
        staging_rows: 0,
        candidates: 0,
        ok_candidates: 0,
        review_candidates: 0,
        acoustics_lineage: 0,
        acoustics_ctal: 0,
        hot100_acoustic_links: 0,
        hot100_unresolved: 0,
      }
    );
  } catch {
    return {
      staging_rows: 0,
      candidates: 0,
      ok_candidates: 0,
      review_candidates: 0,
      acoustics_lineage: 0,
      acoustics_ctal: 0,
      hot100_acoustic_links: 0,
      hot100_unresolved: 0,
    };
  }
}

export async function loadAcousticTracklists(): Promise<AcousticTracklistRow[]> {
  try {
    return integrityQuery<AcousticTracklistRow>(
      `
      SELECT
        a.canonical_name AS artist_name,
        al.title AS album_title,
        sat.source_song,
        atl.sequence_index,
        tf.canonical_name AS track_family_name,
        t.title AS track_title,
        c.review_flag,
        c.confidence_score
      FROM album_track_lineage atl
      JOIN albums al ON al.id = atl.album_id
      JOIN artists a ON a.id = al.artist_id
      JOIN staging_acoustic_tracks sat
        ON atl.source_row_hash = 'acoustic:' || sat.content_hash
      LEFT JOIN acoustic_track_album_candidates c
        ON c.staging_acoustic_id = sat.id AND c.album_id = atl.album_id
      LEFT JOIN tracks t ON t.id = atl.track_id
      LEFT JOIN track_families tf ON tf.id = atl.track_family_id
      WHERE atl.source_provenance = 'acoustics'
      ORDER BY a.canonical_name, al.title, atl.sequence_index NULLS LAST
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadAcousticHot100Backfill(): Promise<Hot100AlbumLinkRow[]> {
  try {
    return integrityQuery<Hot100AlbumLinkRow>(
      `
      SELECT
        l.id,
        ca.chart_date::text,
        ca.chart_position,
        ar.canonical_name AS artist,
        t.title AS track_title,
        al.title AS album_title,
        l.confidence_score,
        l.review_flag
      FROM chart_track_album_links l
      JOIN chart_appearances ca ON ca.id = l.chart_appearance_id
      JOIN tracks t ON t.id = l.track_id
      JOIN artists ar ON ar.id = t.artist_id
      LEFT JOIN albums al ON al.id = l.album_id
      WHERE l.source = 'acoustics_hot100_backfill'
      ORDER BY ca.chart_date DESC, ca.chart_position
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadAcousticAmbiguous(): Promise<AcousticAmbiguousRow[]> {
  try {
    return integrityQuery<AcousticAmbiguousRow>(
      `
      SELECT
        source_artist,
        source_song,
        count(DISTINCT source_album)::int AS album_count,
        count(*)::int AS staging_rows
      FROM staging_acoustic_tracks
      GROUP BY source_artist, source_song
      HAVING count(DISTINCT source_album) > 1
      ORDER BY album_count DESC, staging_rows DESC
      LIMIT 200
      `,
    );
  } catch {
    return [];
  }
}

const ACOUSTIC_VIEWS = new Set<IntegrityView>([
  "acoustic-linkage",
  "acoustic-tracklists",
  "acoustic-hot100",
  "acoustic-ambiguous",
]);

export function isAcousticView(view: IntegrityView): boolean {
  return ACOUSTIC_VIEWS.has(view);
}

export async function loadAcousticExplorerSlice(view: IntegrityView): Promise<
  Pick<
    ExplorerData,
    | "acousticSummary"
    | "acousticTracklists"
    | "acousticHot100Links"
    | "acousticAmbiguous"
  >
> {
  if (view === "acoustic-linkage") {
    return {
      acousticSummary: await loadAcousticLinkageSummary(),
      acousticTracklists: [],
      acousticHot100Links: [],
      acousticAmbiguous: [],
    };
  }
  if (view === "acoustic-tracklists") {
    return {
      acousticSummary: null,
      acousticTracklists: await loadAcousticTracklists(),
      acousticHot100Links: [],
      acousticAmbiguous: [],
    };
  }
  if (view === "acoustic-hot100") {
    return {
      acousticSummary: null,
      acousticTracklists: [],
      acousticHot100Links: await loadAcousticHot100Backfill(),
      acousticAmbiguous: [],
    };
  }
  if (view === "acoustic-ambiguous") {
    return {
      acousticSummary: null,
      acousticTracklists: [],
      acousticHot100Links: [],
      acousticAmbiguous: await loadAcousticAmbiguous(),
    };
  }
  return {
    acousticSummary: null,
    acousticTracklists: [],
    acousticHot100Links: [],
    acousticAmbiguous: [],
  };
}
