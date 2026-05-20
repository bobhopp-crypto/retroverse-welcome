import { integrityQuery } from "./pg";
import type {
  ArtistListItem,
  ArtistSummary,
  ExplorerData,
  FamilyDetail,
  FamilyMemberRow,
  FamilyRow,
  IntegrityView,
  RelationshipRow,
} from "./types";

function classifyVariant(relationshipType: string, title: string): string {
  const t = title.toLowerCase();
  if (relationshipType === "primary_recording") return "studio";
  if (relationshipType.includes("live") || t.includes("live")) return "live";
  if (relationshipType.includes("remix") || t.includes("remix")) return "remix";
  if (relationshipType.includes("remaster") || t.includes("remaster")) return "remaster";
  if (t.includes("radio edit")) return "radio_edit";
  if (t.includes("acoustic")) return "acoustic";
  if (t.includes("instrumental")) return "instrumental";
  if (t.includes("karaoke")) return "karaoke";
  if (t.includes("explicit")) return "explicit";
  if (t.includes("clean")) return "clean";
  if (relationshipType === "medley_member" || t.includes("medley")) return "medley";
  return relationshipType.replace(/_/g, " ");
}

export async function loadArtists(searchQ: string): Promise<ArtistListItem[]> {
  const q = searchQ.trim();
  const pattern = q ? `%${q}%` : null;

  return integrityQuery<ArtistListItem>(
    `
    SELECT
      a.id,
      a.canonical_name,
      count(DISTINCT tf.id)::int AS family_count,
      count(DISTINCT t.id)::int AS track_count
    FROM artists a
    LEFT JOIN track_families tf ON tf.canonical_artist_id = a.id
    LEFT JOIN tracks t ON t.artist_id = a.id
    WHERE ($1::text IS NULL OR a.canonical_name ILIKE $1 OR tf.canonical_name ILIKE $1)
    GROUP BY a.id, a.canonical_name
    HAVING count(DISTINCT tf.id) > 0
    ORDER BY a.canonical_name
    LIMIT 500
    `,
    [pattern],
  );
}

export async function loadDefaultArtistId(): Promise<number | null> {
  const rows = await integrityQuery<{ id: number }>(
    `
    SELECT a.id
    FROM artists a
    JOIN track_families tf ON tf.canonical_artist_id = a.id
    GROUP BY a.id
    ORDER BY count(tf.id) DESC, a.canonical_name
    LIMIT 1
    `,
  );
  return rows[0]?.id ?? null;
}

export async function loadArtistSummary(artistId: number): Promise<ArtistSummary | null> {
  const rows = await integrityQuery<ArtistSummary>(
    `
    SELECT
      a.id,
      a.canonical_name,
      count(DISTINCT tf.id)::int AS family_count,
      count(DISTINCT t.id)::int AS track_count,
      count(DISTINCT tfm.id) FILTER (WHERE NOT tfm.is_primary_recording)::int AS variant_count
    FROM artists a
    LEFT JOIN track_families tf ON tf.canonical_artist_id = a.id
    LEFT JOIN track_family_members tfm ON tfm.track_family_id = tf.id
    LEFT JOIN tracks t ON t.artist_id = a.id
    WHERE a.id = $1
    GROUP BY a.id, a.canonical_name
    `,
    [artistId],
  );
  return rows[0] ?? null;
}

export async function loadFamiliesForArtist(artistId: number): Promise<FamilyRow[]> {
  return integrityQuery<FamilyRow>(
    `
    SELECT
      tf.id,
      tf.canonical_name,
      count(tfm.id)::int AS track_count,
      max(t.title) FILTER (WHERE tfm.is_primary_recording) AS primary_recording,
      count(tfm.id) FILTER (WHERE NOT tfm.is_primary_recording)::int AS variant_count
    FROM track_families tf
    JOIN track_family_members tfm ON tfm.track_family_id = tf.id
    JOIN tracks t ON t.id = tfm.track_id
    WHERE tf.canonical_artist_id = $1
    GROUP BY tf.id, tf.canonical_name
    ORDER BY tf.canonical_name
    `,
    [artistId],
  );
}

export async function loadFamilyDetail(familyId: number): Promise<FamilyDetail | null> {
  const header = await integrityQuery<{
    id: number;
    canonical_name: string;
    normalized_family_key: string;
    artist_id: number;
    artist_name: string;
  }>(
    `
    SELECT
      tf.id,
      tf.canonical_name,
      tf.normalized_family_key,
      tf.canonical_artist_id AS artist_id,
      a.canonical_name AS artist_name
    FROM track_families tf
    JOIN artists a ON a.id = tf.canonical_artist_id
    WHERE tf.id = $1
    `,
    [familyId],
  );
  const h = header[0];
  if (!h) return null;

  const members = await integrityQuery<{
    track_id: number;
    title: string;
    relationship_type: string;
    is_primary_recording: boolean;
    chart_row_count: number;
  }>(
    `
    SELECT
      t.id AS track_id,
      t.title,
      tfm.relationship_type,
      tfm.is_primary_recording,
      count(ca.id)::int AS chart_row_count
    FROM track_family_members tfm
    JOIN tracks t ON t.id = tfm.track_id
    LEFT JOIN chart_appearances ca ON ca.track_id = t.id
    WHERE tfm.track_family_id = $1
    GROUP BY t.id, t.title, tfm.relationship_type, tfm.is_primary_recording
    ORDER BY tfm.is_primary_recording DESC, chart_row_count DESC, t.title
    `,
    [familyId],
  );

  return {
    ...h,
    members: members.map((m) => ({
      ...m,
      variant_classification: classifyVariant(m.relationship_type, m.title),
    })),
  };
}

export async function loadRelationshipsForArtist(
  artistId: number,
  limit = 80,
): Promise<RelationshipRow[]> {
  return integrityQuery<RelationshipRow>(
    `
    WITH members AS (
      SELECT
        tf.id AS family_id,
        tf.canonical_name AS family_name,
        t.id AS track_id,
        t.title,
        tfm.relationship_type,
        tfm.is_primary_recording,
        lower(trim(t.title)) AS norm_title
      FROM track_families tf
      JOIN track_family_members tfm ON tfm.track_family_id = tf.id
      JOIN tracks t ON t.id = tfm.track_id
      WHERE tf.canonical_artist_id = $1
    )
    SELECT
      a.track_id AS track_a_id,
      a.title AS track_a_title,
      b.track_id AS track_b_id,
      b.title AS track_b_title,
      a.family_name,
      CASE
        WHEN a.norm_title = b.norm_title
          AND NOT a.title ~* 'live|remix'
          AND NOT b.title ~* 'live|remix' THEN 'probable_exact_duplicate'
        WHEN a.title ~* 'remaster|re-master' OR b.title ~* 'remaster|re-master' THEN 'probable_remaster_chain'
        WHEN a.title ~* 'live' OR b.title ~* 'live' THEN 'probable_live_variant'
        ELSE 'related_variant'
      END AS relationship_type,
      CASE
        WHEN a.norm_title = b.norm_title THEN 90
        WHEN a.title ~* 'remaster|re-master' OR b.title ~* 'remaster|re-master' THEN 75
        WHEN a.title ~* 'live' OR b.title ~* 'live' THEN 55
        ELSE 60
      END AS confidence_score
    FROM members a
    JOIN members b
      ON b.family_id = a.family_id
     AND b.track_id > a.track_id
    ORDER BY confidence_score DESC, a.family_name, a.track_id
    LIMIT $2
    `,
    [artistId, limit],
  );
}

export async function loadExplorerData(opts: {
  artistId: number | null;
  familyId: number | null;
  searchQ: string;
  view: IntegrityView;
}): Promise<ExplorerData> {
  const artists = await loadArtists(opts.searchQ);

  let selectedArtistId = opts.artistId;
  if (!selectedArtistId && artists.length > 0) {
    selectedArtistId = artists[0]!.id;
  }
  if (!selectedArtistId) {
    selectedArtistId = await loadDefaultArtistId();
  }

  const artist = selectedArtistId ? await loadArtistSummary(selectedArtistId) : null;
  let families = selectedArtistId ? await loadFamiliesForArtist(selectedArtistId) : [];

  if (opts.view === "variants") {
    families = families.filter((f) => f.variant_count > 0);
  }

  let familyDetail: FamilyDetail | null = null;
  if (opts.familyId) {
    familyDetail = await loadFamilyDetail(opts.familyId);
  }

  const relationships =
    selectedArtistId && opts.view === "relationships"
      ? await loadRelationshipsForArtist(selectedArtistId)
      : [];

  return {
    artists,
    artist,
    families,
    familyDetail,
    relationships,
    albums: [],
    albumDetail: null,
    b200Rows: [],
    b200Timelines: [],
    albumPopulationRows: [],
    editionRows: [],
    tracklistRows: [],
    linkageSummary: null,
    albumTrackLinks: [],
    hot100AlbumLinks: [],
    mediaGraphSummary: null,
    mediaAssets: [],
    vdjAssets: [],
    vdjCandidates: [],
    r2SyncRows: [],
    thumbnailCoverage: [],
    youtubeEnrichment: [],
    coverSummary: null,
    coverLinks: [],
    coverMissing: [],
    coverR2Links: [],
    coverCurated: [],
    coverReviewQueue: [],
    acousticSummary: null,
    acousticTracklists: [],
    acousticHot100Links: [],
    acousticAmbiguous: [],
    selectedArtistId,
    selectedFamilyId: opts.familyId,
    selectedAlbumId: null,
    searchQ: opts.searchQ,
    view: opts.view,
  };
}
