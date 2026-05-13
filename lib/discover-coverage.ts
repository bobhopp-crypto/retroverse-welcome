import { BILLBOARD200_SOURCE } from "@/lib/billboard200-source";
import { loadDiscoverReviewMap, type DiscoverReviewMark } from "@/lib/discover-review-state";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { RETROVERSE_ALBUM_CORPUS_PAGE, loadAllRetroverseAlbumRows, type CorpusAlbumRow } from "@/lib/retroverse-albums-corpus";
import { createClient } from "@/lib/supabase";

const ID_CHUNK = 120;

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

function chunk<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

export type DiscoverCoverageReport = {
  totalAlbumsInDb: number;
  /** Distinct album IDs tied to Billboard 200 SQLite import (subset marker). */
  billboardMatchAlbumIdsDistinct: number;
  /** Full Discover / search corpus: usable album rows. */
  fullCorpusUsableAlbums: number;
  withCanonicalCover: number;
  withoutCanonicalCover: number;
  reviewHidden: number;
  reviewFixed: number;
  reviewSkipped: number;
  reviewReviewed: number;
  inVisibleDiscoverFeed: number;
  /** Albums with ≥1 row in retroverse_tracks.retroverse_album_id */
  albumsWithDirectTrackLink: number;
  /** Albums reachable via retroverse_album_tracks → edition → album (may overlap direct). */
  albumsWithEditionTrackLink: number;
  /** |union| of the two track signals. */
  albumsWithAnyTrackLink: number;
  pctCoverOfUsable: string;
  pctAlbumsWithTracks: string;
  pctVisibleOfUsable: string;
};

async function distinctAlbumIdsFromDirectTrackRows(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  for (;;) {
    const part = await supabase
      .from("retroverse_tracks")
      .select("retroverse_album_id")
      .not("retroverse_album_id", "is", null)
      .order("retroverse_track_id", { ascending: true })
      .range(from, from + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = part.data ?? [];
    for (const r of rows) {
      const id = (r as { retroverse_album_id: string | null }).retroverse_album_id;
      if (id) ids.add(id);
    }
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    from += RETROVERSE_ALBUM_CORPUS_PAGE;
  }
  return ids;
}

async function distinctAlbumIdsFromEditionTracks(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  const editionIds = new Set<string>();
  let from = 0;
  for (;;) {
    const part = await supabase
      .from("retroverse_album_tracks")
      .select("retroverse_album_edition_id")
      .order("retroverse_track_id", { ascending: true })
      .range(from, from + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = part.data ?? [];
    for (const r of rows) {
      const eid = (r as { retroverse_album_edition_id: string }).retroverse_album_edition_id;
      if (eid) editionIds.add(eid);
    }
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    from += RETROVERSE_ALBUM_CORPUS_PAGE;
  }

  const albumIds = new Set<string>();
  const editionList = [...editionIds];
  for (const idChunk of chunk(editionList, ID_CHUNK)) {
    const ed = await supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .in("retroverse_album_edition_id", idChunk);
    if (ed.error) throw ed.error;
    for (const row of (ed.data ?? []) as EditionRow[]) {
      if (row.retroverse_album_id) albumIds.add(row.retroverse_album_id);
    }
  }
  return albumIds;
}

async function distinctBillboardAlbumIdsFromSourceMatches(supabase: ReturnType<typeof createClient>): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  for (;;) {
    const part = await supabase
      .from("retroverse_source_matches")
      .select("retroverse_entity_id")
      .eq("source", BILLBOARD200_SOURCE)
      .eq("retroverse_entity_type", "album")
      .range(from, from + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = part.data ?? [];
    for (const r of rows) {
      const id = (r as { retroverse_entity_id: string | null }).retroverse_entity_id;
      if (id) ids.add(id);
    }
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    from += RETROVERSE_ALBUM_CORPUS_PAGE;
  }
  return ids;
}

/**
 * Coverage for the unified corpus: all `retroverse_albums` rows (Discover + Search + album pages).
 */
export async function computeDiscoverCoverageReport(): Promise<DiscoverCoverageReport> {
  const supabase = createClient();

  const dbCountResult = await supabase.from("retroverse_albums").select("retroverse_album_id", { count: "exact", head: true });
  if (dbCountResult.error) throw dbCountResult.error;
  const totalAlbumsInDb = dbCountResult.count ?? 0;

  const billboardIdSet = await distinctBillboardAlbumIdsFromSourceMatches(supabase);
  const billboardMatchAlbumIdsDistinct = billboardIdSet.size;

  const [allAlbums, directTrackAlbums, editionTrackAlbums] = await Promise.all([
    loadAllRetroverseAlbumRows(supabase),
    distinctAlbumIdsFromDirectTrackRows(supabase),
    distinctAlbumIdsFromEditionTracks(supabase),
  ]);

  const usable = allAlbums.filter((a: CorpusAlbumRow) => a.retroverse_album_id?.trim() && a.canonical_album_title?.trim());
  const fullCorpusUsableAlbums = usable.length;

  const albumIds = usable.map((a) => a.retroverse_album_id);
  const editionByAlbum = new Map<string, string>();
  for (const idChunk of chunk(albumIds, ID_CHUNK)) {
    const part = await supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .in("retroverse_album_id", idChunk)
      .eq("is_primary", true);
    if (part.error) throw part.error;
    for (const row of (part.data ?? []) as EditionRow[]) {
      editionByAlbum.set(row.retroverse_album_id, row.retroverse_album_edition_id);
    }
  }

  const artworkAcc: Awaited<ReturnType<typeof loadAlbumArtworkRows>> = [];
  for (const idChunk of chunk(albumIds, ID_CHUNK)) {
    artworkAcc.push(...(await loadAlbumArtworkRows(supabase, idChunk)));
  }

  let withCanonicalCover = 0;
  let withoutCanonicalCover = 0;
  for (const album of usable) {
    const selected = selectCanonicalArtwork(
      artworkAcc,
      album.retroverse_album_id,
      editionByAlbum.get(album.retroverse_album_id) ?? null,
    );
    const path = selected?.canonical_cover_path?.trim() ?? "";
    if (path) withCanonicalCover += 1;
    else withoutCanonicalCover += 1;
  }

  const reviewMap = await loadDiscoverReviewMap();
  let reviewHidden = 0;
  let reviewFixed = 0;
  let reviewSkipped = 0;
  let reviewReviewed = 0;
  for (const id of usable.map((a) => a.retroverse_album_id)) {
    const m: DiscoverReviewMark | undefined = reviewMap[id];
    if (m === "hidden") reviewHidden += 1;
    else if (m === "fixed") reviewFixed += 1;
    else if (m === "skipped") reviewSkipped += 1;
    else if (m === "reviewed") reviewReviewed += 1;
  }

  const inVisibleDiscoverFeed = usable.filter((a) => {
    const m = reviewMap[a.retroverse_album_id];
    return m !== "hidden" && m !== "fixed";
  }).length;

  const anyTrackAlbums = new Set<string>([...directTrackAlbums, ...editionTrackAlbums]);

  const pctCoverOfUsable =
    fullCorpusUsableAlbums === 0 ? "—" : `${((withCanonicalCover / fullCorpusUsableAlbums) * 100).toFixed(1)}%`;
  const pctAlbumsWithTracks =
    fullCorpusUsableAlbums === 0
      ? "—"
      : `${((anyTrackAlbums.size / fullCorpusUsableAlbums) * 100).toFixed(1)}%`;
  const pctVisibleOfUsable =
    fullCorpusUsableAlbums === 0 ? "—" : `${((inVisibleDiscoverFeed / fullCorpusUsableAlbums) * 100).toFixed(1)}%`;

  return {
    totalAlbumsInDb,
    billboardMatchAlbumIdsDistinct,
    fullCorpusUsableAlbums,
    withCanonicalCover,
    withoutCanonicalCover,
    reviewHidden,
    reviewFixed,
    reviewSkipped,
    reviewReviewed,
    inVisibleDiscoverFeed,
    albumsWithDirectTrackLink: directTrackAlbums.size,
    albumsWithEditionTrackLink: editionTrackAlbums.size,
    albumsWithAnyTrackLink: anyTrackAlbums.size,
    pctCoverOfUsable,
    pctAlbumsWithTracks,
    pctVisibleOfUsable,
  };
}
