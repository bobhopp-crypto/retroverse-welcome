import { integrityQuery } from "./pg";
import type {
  AlbumB200Row,
  AlbumDetail,
  AlbumEditionRow,
  AlbumListItem,
  AlbumPopulationRow,
  AlbumTracklistRow,
  B200TimelineRow,
  ExplorerData,
  IntegrityView,
} from "./types";

export async function loadAlbums(searchQ: string): Promise<AlbumListItem[]> {
  const pattern = searchQ.trim() ? `%${searchQ.trim()}%` : null;
  return integrityQuery<AlbumListItem>(
    `
    SELECT
      al.id,
      al.title,
      a.canonical_name AS artist_name,
      al.release_year,
      count(DISTINCT ae.id)::int AS edition_count,
      count(DISTINCT t.id)::int AS track_count,
      count(DISTINCT ca.id)::int AS b200_chart_rows
    FROM albums al
    JOIN artists a ON a.id = al.artist_id
    LEFT JOIN album_editions ae ON ae.album_id = al.id
    LEFT JOIN tracks t ON t.album_id = al.id
    LEFT JOIN chart_appearances ca
      ON ca.album_id = al.id AND ca.chart_name = 'Billboard 200'
    WHERE ($1::text IS NULL OR al.title ILIKE $1 OR a.canonical_name ILIKE $1)
    GROUP BY al.id, al.title, a.canonical_name, al.release_year
    ORDER BY a.canonical_name, al.title
    LIMIT 300
    `,
    [pattern],
  );
}

export async function loadAlbumDetail(albumId: number): Promise<AlbumDetail | null> {
  const header = await integrityQuery<{
    id: number;
    title: string;
    artist_id: number;
    artist_name: string;
    release_year: number | null;
  }>(
    `
    SELECT al.id, al.title, al.artist_id, a.canonical_name AS artist_name, al.release_year
    FROM albums al
    JOIN artists a ON a.id = al.artist_id
    WHERE al.id = $1
    `,
    [albumId],
  );
  const h = header[0];
  if (!h) return null;

  const editions = await integrityQuery<{
    id: number;
    edition_name: string;
    release_year: number | null;
    is_canonical: boolean;
  }>(
    `SELECT id, edition_name, release_year, is_canonical
     FROM album_editions WHERE album_id = $1 ORDER BY is_canonical DESC, edition_name`,
    [albumId],
  );

  let lineage: AlbumTracklistRow[] = [];
  try {
    lineage = await integrityQuery<AlbumTracklistRow>(
      `
      SELECT
        atl.disc_number,
        atl.track_number,
        atl.sequence_index,
        tf.canonical_name AS track_family_name,
        t.title AS track_title,
        atl.source_provenance,
        tfm.relationship_type,
        tfm.is_primary_recording
      FROM album_track_lineage atl
      LEFT JOIN tracks t ON t.id = atl.track_id
      LEFT JOIN track_families tf ON tf.id = atl.track_family_id
      LEFT JOIN track_family_members tfm
        ON tfm.track_family_id = atl.track_family_id AND tfm.track_id = atl.track_id
      WHERE atl.album_id = $1
      ORDER BY atl.sequence_index NULLS LAST, atl.disc_number, atl.track_number
    `,
      [albumId],
    );
  } catch {
    lineage = [];
  }

  const b200 = await integrityQuery<AlbumB200Row>(
    `
    SELECT chart_date, chart_position, weeks_on_chart
    FROM chart_appearances
    WHERE album_id = $1 AND chart_name = 'Billboard 200'
    ORDER BY chart_date
    LIMIT 500
    `,
    [albumId],
  );

  const families = await integrityQuery<{
    track_family_id: number;
    track_family_name: string;
    member_count: number;
  }>(
    `
    SELECT
      tf.id AS track_family_id,
      tf.canonical_name AS track_family_name,
      count(tfm.id)::int AS member_count
    FROM tracks t
    JOIN track_family_members tfm ON tfm.track_id = t.id
    JOIN track_families tf ON tf.id = tfm.track_family_id
    WHERE t.album_id = $1
    GROUP BY tf.id, tf.canonical_name
    ORDER BY tf.canonical_name
    `,
    [albumId],
  );

  return { ...h, editions, lineage, b200, families };
}

export async function loadAlbumPopulation(): Promise<AlbumPopulationRow[]> {
  try {
    return integrityQuery<AlbumPopulationRow>(
      `
      SELECT
        r.proposed_album_key,
        r.canonical_album_name,
        a.canonical_name AS artist_name,
        r.album_id,
        r.staging_row_count,
        count(DISTINCT ae.id)::int AS edition_count,
        r.first_chart_date::text,
        r.last_chart_date::text
      FROM album_population_registry r
      JOIN artists a ON a.id = r.canonical_artist_id
      LEFT JOIN album_editions ae ON ae.album_id = r.album_id
      GROUP BY
        r.proposed_album_key,
        r.canonical_album_name,
        a.canonical_name,
        r.album_id,
        r.staging_row_count,
        r.first_chart_date,
        r.last_chart_date
      ORDER BY r.staging_row_count DESC NULLS LAST, a.canonical_name, r.canonical_album_name
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadAllEditions(): Promise<AlbumEditionRow[]> {
  return integrityQuery<AlbumEditionRow>(
    `
    SELECT
      ae.id AS edition_id,
      al.id AS album_id,
      al.title AS album_title,
      a.canonical_name AS artist_name,
      ae.edition_name,
      ae.release_year,
      ae.is_canonical
    FROM album_editions ae
    JOIN albums al ON al.id = ae.album_id
    JOIN artists a ON a.id = al.artist_id
    ORDER BY a.canonical_name, al.title, ae.is_canonical DESC, ae.edition_name
    LIMIT 500
    `,
  );
}

export async function loadB200Timelines(): Promise<B200TimelineRow[]> {
  return integrityQuery<B200TimelineRow>(
    `
    SELECT
      al.id AS album_id,
      al.title AS album_title,
      a.canonical_name AS artist_name,
      count(*)::int AS chart_weeks,
      min(ca.chart_position) AS peak_position,
      min(ca.chart_date)::text AS first_chart_date,
      max(ca.chart_date)::text AS last_chart_date
    FROM chart_appearances ca
    JOIN albums al ON al.id = ca.album_id
    JOIN artists a ON a.id = al.artist_id
    WHERE ca.chart_name = 'Billboard 200'
    GROUP BY al.id, al.title, a.canonical_name
    ORDER BY chart_weeks DESC, peak_position
    LIMIT 200
    `,
  );
}

export async function loadB200Summary(): Promise<AlbumB200Row[]> {
  return integrityQuery<AlbumB200Row>(
    `
    SELECT
      ca.chart_date,
      ca.chart_position,
      ca.weeks_on_chart,
      al.title AS album_title,
      a.canonical_name AS artist_name
    FROM chart_appearances ca
    JOIN albums al ON al.id = ca.album_id
    JOIN artists a ON a.id = al.artist_id
    WHERE ca.chart_name = 'Billboard 200'
    ORDER BY ca.chart_date DESC, ca.chart_position
    LIMIT 200
    `,
  );
}

export async function loadTracklistLinkage(): Promise<AlbumTracklistRow[]> {
  try {
    return integrityQuery<AlbumTracklistRow>(
      `
      SELECT
        atl.disc_number,
        atl.track_number,
        atl.sequence_index,
        tf.canonical_name AS track_family_name,
        t.title AS track_title,
        atl.source_provenance,
        tfm.relationship_type,
        tfm.is_primary_recording,
        al.title AS album_title,
        a.canonical_name AS artist_name
      FROM album_track_lineage atl
      JOIN albums al ON al.id = atl.album_id
      JOIN artists a ON a.id = al.artist_id
      LEFT JOIN tracks t ON t.id = atl.track_id
      LEFT JOIN track_families tf ON tf.id = atl.track_family_id
      LEFT JOIN track_family_members tfm
        ON tfm.track_family_id = atl.track_family_id AND tfm.track_id = atl.track_id
      ORDER BY a.canonical_name, al.title, atl.sequence_index
      LIMIT 500
      `,
    );
  } catch {
    return [];
  }
}

export async function loadExplorerDataWithAlbums(opts: {
  artistId: number | null;
  familyId: number | null;
  albumId: number | null;
  searchQ: string;
  view: IntegrityView;
}): Promise<ExplorerData> {
  const { loadExplorerData } = await import("./queries");
  const { isLinkageView, loadLinkageExplorerSlice } = await import("./linkage-queries");
  const { isMediaView, loadMediaExplorerSlice } = await import("./media-queries");
  const { isCoverView, loadCoverExplorerSlice } = await import("./cover-queries");
  const { isAcousticView, loadAcousticExplorerSlice } = await import("./acoustic-queries");
  const base = await loadExplorerData({
    artistId: opts.artistId,
    familyId: opts.familyId,
    searchQ: opts.searchQ,
    view:
      opts.view === "albums" ||
      opts.view === "album-families" ||
      opts.view === "editions" ||
      opts.view === "b200" ||
      opts.view === "tracklists" ||
      isLinkageView(opts.view) ||
      isMediaView(opts.view) ||
      isCoverView(opts.view) ||
      isAcousticView(opts.view)
        ? "artists"
        : opts.view,
  });
  const linkageSlice = isLinkageView(opts.view)
    ? await loadLinkageExplorerSlice(opts.view)
    : {
        linkageSummary: null,
        albumTrackLinks: [],
        hot100AlbumLinks: [],
      };
  const mediaSlice = isMediaView(opts.view)
    ? await loadMediaExplorerSlice(opts.view)
    : {
        mediaGraphSummary: null,
        mediaAssets: [],
        vdjAssets: [],
        vdjCandidates: [],
        r2SyncRows: [],
        thumbnailCoverage: [],
        youtubeEnrichment: [],
      };
  const coverSlice = isCoverView(opts.view)
    ? await loadCoverExplorerSlice(opts.view)
    : {
        coverSummary: null,
        coverLinks: [],
        coverMissing: [],
        coverR2Links: [],
        coverCurated: [],
        coverReviewQueue: [],
      };
  const acousticSlice = isAcousticView(opts.view)
    ? await loadAcousticExplorerSlice(opts.view)
    : {
        acousticSummary: null,
        acousticTracklists: [],
        acousticHot100Links: [],
        acousticAmbiguous: [],
      };

  const albums = await loadAlbums(opts.searchQ);
  const selectedAlbumId = opts.albumId ?? albums[0]?.id ?? null;
  const albumDetail = selectedAlbumId ? await loadAlbumDetail(selectedAlbumId) : null;
  const b200Rows = opts.view === "b200" ? await loadB200Summary() : [];
  const b200Timelines = opts.view === "b200" ? await loadB200Timelines() : [];
  const albumPopulationRows =
    opts.view === "album-families" ? await loadAlbumPopulation() : [];
  const editionRows = opts.view === "editions" ? await loadAllEditions() : [];
  const tracklistRows = opts.view === "tracklists" ? await loadTracklistLinkage() : [];

  return {
    ...base,
    view: opts.view,
    albums,
    selectedAlbumId,
    albumDetail,
    b200Rows,
    b200Timelines,
    albumPopulationRows,
    editionRows,
    tracklistRows,
    ...linkageSlice,
    ...mediaSlice,
    ...coverSlice,
    ...acousticSlice,
  };
}
