/**
 * Build dossier MusicBrainz sidecar from existing cache (no scrape).
 * Run: npx tsx scripts/build_dossier_musicbrainz_sidecar.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const WORKSPACE = process.cwd();
const DATA_ROOT = (process.env.RETROVERSE_DATA_ROOT ?? "/Users/bobhopp/RETROVERSE_DATA").trim();
const MB_CACHE_PATH =
  process.env.MUSICBRAINZ_ALBUM_CACHE_PATH?.trim() ??
  "/Users/bobhopp/Sites/retroverse/data/derived/albums/source_musicbrainz_album_cache.json";
const COORDS_PATH =
  process.env.RETROSCOPE_COORDINATES_PATH?.trim() ??
  path.join(DATA_ROOT, "runtime", "retroscope-coordinates.json");
const DOSSIERS_PATH =
  process.env.ALBUM_DOSSIERS_PATH?.trim() ??
  path.join(WORKSPACE, "public", "data", "albums", "album-dossiers.json");
const CANONICAL_SEQUENCES_PATH =
  process.env.CANONICAL_ALBUM_SEQUENCES_PATH?.trim() ??
  path.join(WORKSPACE, "public", "data", "albums", "canonical-album-sequences.json");
const OUT_SIDECAR_PATH =
  process.env.DOSSIER_MUSICBRAINZ_SIDECAR_PATH?.trim() ??
  path.join(DATA_ROOT, "runtime", "dossier-musicbrainz-by-rval.json");
const OUT_REPORT_PATH = path.join(WORKSPACE, "reports", "musicbrainz-sidecar-recovery-summary.json");

const RVAL_RE = /^RVAL\d{6}$/i;
const THRILLER_RVAL = "RVAL586982";
const VARIANT_RE =
  /\b(2008|25th|anniversary|remaster(?:ed)?|demo|mix|alternate|single version|karaoke|reprise|bonus|deluxe|expanded|rough|outtake|sessions?)\b/i;

type MbCacheEntry = {
  match_status?: string;
  match_score?: number;
  match_source?: string;
  matched_album?: string;
  matched_artist?: string;
  matched_year?: string;
  mbid?: string;
  top_tracks?: string;
  track_count?: number;
  error?: string;
};

type CoordCell = {
  albumId?: string;
  artist?: string;
  album?: string;
  chartYear?: number;
  chartRank?: number;
  trust_score?: number;
  identity_state?: string;
};

type SidecarTrack = {
  position: number;
  title: string;
  source: "musicbrainz_cache";
  confidence: "recovered_cache_order";
};

type SidecarAlbum = {
  artist: string;
  album: string;
  normalized_artist: string;
  normalized_album: string;
  release_mbid?: string;
  musicbrainz?: {
    match_status?: string;
    match_score?: number;
    match_source?: string;
    matched_year?: string;
    mbid?: string;
    track_count?: number;
  };
  tracks: SidecarTrack[];
};

/** Match Python materialize_album_dossiers.norm_key */
export function normKey(...parts: string[]): string {
  const blob = parts
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .replace(/[^\w\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return blob;
}

function rvalId(cell: CoordCell): string | null {
  const mid = (cell.albumId ?? "").trim().toUpperCase();
  if (mid && RVAL_RE.test(mid)) return mid;
  const cover = (cell as { canonical_cover_path?: string }).canonical_cover_path ?? "";
  const m = cover.match(/RVAL\d{6}/i);
  return m ? m[0].toUpperCase() : null;
}

function pickCanonicalCell(cells: CoordCell[]): CoordCell {
  return cells.reduce((best, c) => {
    const score = Number(c.trust_score ?? 0);
    const canon = c.identity_state === "canonical" ? 1 : 0;
    const bestScore = Number(best.trust_score ?? 0);
    const bestCanon = best.identity_state === "canonical" ? 1 : 0;
    if (score > bestScore || (score === bestScore && canon > bestCanon)) return c;
    return best;
  });
}

function parseTopTracks(raw: string): string[] {
  return raw
    .split("|")
    .map((t) => t.trim())
    .filter(Boolean);
}

function loadManualSequenceRvals(): Set<string> {
  const skip = new Set<string>();
  try {
    const bundle = JSON.parse(readFileSync(CANONICAL_SEQUENCES_PATH, "utf8")) as {
      sequences?: Record<string, unknown>;
    };
    for (const id of Object.keys(bundle.sequences ?? {})) {
      skip.add(id.trim().toUpperCase());
    }
  } catch {
    /* no manual sequences file */
  }
  return skip;
}

function buildMbIndex(cache: Record<string, MbCacheEntry>) {
  const byNorm = new Map<string, { cacheKey: string; entry: MbCacheEntry }[]>();
  let cacheMatched = 0;
  for (const [cacheKey, entry] of Object.entries(cache)) {
    if (entry.match_status !== "matched") continue;
    cacheMatched++;
    const nk = normKey(entry.matched_artist ?? "", entry.matched_album ?? "");
    if (!nk) continue;
    const list = byNorm.get(nk) ?? [];
    list.push({ cacheKey, entry });
    byNorm.set(nk, list);
  }
  return { byNorm, cacheMatched, cacheTotal: Object.keys(cache).length };
}

function main() {
  const generatedAt = new Date().toISOString();
  const manualSkip = loadManualSequenceRvals();

  const cache = JSON.parse(readFileSync(MB_CACHE_PATH, "utf8")) as Record<string, MbCacheEntry>;
  const { byNorm, cacheMatched, cacheTotal } = buildMbIndex(cache);

  const coordsPayload = JSON.parse(readFileSync(COORDS_PATH, "utf8")) as { cells?: CoordCell[] };
  const cells = coordsPayload.cells ?? [];

  const byRval = new Map<string, CoordCell[]>();
  for (const c of cells) {
    const id = rvalId(c);
    if (!id) continue;
    const list = byRval.get(id) ?? [];
    list.push(c);
    byRval.set(id, list);
  }

  let dossierBundle: { dossiers?: Record<string, { identity?: { artist?: string; album?: string }; chart?: { peak_rank?: number } }> } =
    {};
  try {
    dossierBundle = JSON.parse(readFileSync(DOSSIERS_PATH, "utf8"));
  } catch {
    console.warn(`[mb-sidecar] No dossier bundle at ${DOSSIERS_PATH}`);
  }
  const dossierIds = Object.keys(dossierBundle.dossiers ?? {});

  const sidecar: Record<string, SidecarAlbum> = {};
  const unmatchedCoords: Array<{ rval: string; artist: string; album: string; norm: string }> = [];
  const duplicateMatches: Array<{
    norm: string;
    rval: string;
    cacheKeys: string[];
    matched_albums: string[];
  }> = [];
  let skippedManual = 0;
  let matchedRval = 0;
  let matchedNoTracks = 0;

  for (const [rval, clist] of [...byRval.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (manualSkip.has(rval)) {
      skippedManual++;
      continue;
    }
    const canon = pickCanonicalCell(clist);
    const artist = String(canon.artist ?? "").trim();
    const album = String(canon.album ?? "").trim();
    const nk = normKey(artist, album);
    if (!nk) continue;

    const candidates = byNorm.get(nk);
    if (!candidates?.length) {
      unmatchedCoords.push({ rval, artist, album, norm: nk });
      continue;
    }

    if (candidates.length > 1) {
      duplicateMatches.push({
        norm: nk,
        rval,
        cacheKeys: candidates.map((c) => c.cacheKey),
        matched_albums: candidates.map((c) => c.entry.matched_album ?? ""),
      });
    }

    const chosen = [...candidates].sort(
      (a, b) => Number(b.entry.match_score ?? 0) - Number(a.entry.match_score ?? 0),
    )[0];
    const entry = chosen.entry;
    const topRaw = entry.top_tracks ?? "";
    const titles = parseTopTracks(topRaw);
    if (!titles.length) {
      matchedNoTracks++;
      continue;
    }

    const tracks: SidecarTrack[] = titles.map((title, i) => ({
      position: i + 1,
      title,
      source: "musicbrainz_cache",
      confidence: "recovered_cache_order",
    }));

    sidecar[rval] = {
      artist,
      album,
      normalized_artist: normKey(artist),
      normalized_album: normKey(album),
      release_mbid: entry.mbid?.trim() || undefined,
      musicbrainz: {
        match_status: entry.match_status,
        match_score: entry.match_score,
        match_source: entry.match_source,
        matched_year: entry.matched_year,
        mbid: entry.mbid,
        track_count: entry.track_count ?? titles.length,
      },
      tracks,
    };
    matchedRval++;
  }

  const unmatchedDossiers: Array<{
    rval: string;
    artist: string;
    album: string;
    peak_rank?: number | null;
  }> = [];
  let dossierMatched = 0;

  for (const rval of dossierIds) {
    const id = rval.toUpperCase();
    if (manualSkip.has(id)) continue;
    const d = dossierBundle.dossiers![id];
    if (!d) continue;
    if (sidecar[id]) {
      dossierMatched++;
      continue;
    }
    unmatchedDossiers.push({
      rval: id,
      artist: String(d.identity?.artist ?? ""),
      album: String(d.identity?.album ?? ""),
      peak_rank: d.chart?.peak_rank ?? null,
    });
  }

  unmatchedDossiers.sort((a, b) => {
    const pa = a.peak_rank ?? 9999;
    const pb = b.peak_rank ?? 9999;
    if (pa !== pb) return pa - pb;
    return a.album.localeCompare(b.album);
  });

  const thrillerSidecar = sidecar[THRILLER_RVAL];
  const thrillerValidation = {
    in_sidecar: Boolean(thrillerSidecar),
    track_count: thrillerSidecar?.tracks.length ?? 0,
    position_1_title: thrillerSidecar?.tracks[0]?.title ?? null,
    position_1_ok: (thrillerSidecar?.tracks[0]?.title ?? "")
      .replace(/\u2019/g, "'")
      .toLowerCase()
      .includes("wanna be startin"),
    variant_titles_in_sequence: (thrillerSidecar?.tracks ?? [])
      .filter((t) => VARIANT_RE.test(t.title))
      .map((t) => t.title),
    sequence_clean: !(thrillerSidecar?.tracks ?? []).some((t) => VARIANT_RE.test(t.title)),
  };

  mkdirSync(path.dirname(OUT_SIDECAR_PATH), { recursive: true });
  mkdirSync(path.dirname(OUT_REPORT_PATH), { recursive: true });

  writeFileSync(OUT_SIDECAR_PATH, JSON.stringify(sidecar, null, 2) + "\n", "utf8");

  const report = {
    generated_at: generatedAt,
    paths: {
      musicbrainz_cache: MB_CACHE_PATH,
      retroscope_coordinates: COORDS_PATH,
      dossiers_bundle: DOSSIERS_PATH,
      sidecar_output: OUT_SIDECAR_PATH,
      canonical_sequences_skipped: CANONICAL_SEQUENCES_PATH,
    },
    cache: {
      total_albums: cacheTotal,
      matched_status_count: cacheMatched,
    },
    coordinates: {
      total_cells: cells.length,
      unique_rval: byRval.size,
    },
    sidecar: {
      albums_written: Object.keys(sidecar).length,
      skipped_manual_canonical_sequences: skippedManual,
      skipped_rvals: [...manualSkip],
      matched_no_top_tracks: matchedNoTracks,
    },
    dossiers: {
      total_checked: dossierIds.length,
      matched_in_sidecar: dossierMatched,
      unmatched_count: dossierIds.length - dossierMatched - manualSkip.size,
    },
    matching: {
      rval_matched_from_coordinates: matchedRval,
      rval_unmatched_from_coordinates: unmatchedCoords.length,
      duplicate_norm_candidates: duplicateMatches.length,
    },
    thriller_validation: thrillerValidation,
    top_25_unmatched_charted_dossiers: unmatchedDossiers
      .filter((u) => u.peak_rank != null && u.peak_rank > 0)
      .slice(0, 25),
    sample_unmatched_coordinates: unmatchedCoords.slice(0, 50),
    sample_duplicate_matches: duplicateMatches.slice(0, 25),
  };

  writeFileSync(OUT_REPORT_PATH, JSON.stringify(report, null, 2) + "\n", "utf8");

  console.log(`[mb-sidecar] wrote ${Object.keys(sidecar).length} albums → ${OUT_SIDECAR_PATH}`);
  console.log(`[mb-sidecar] report → ${OUT_REPORT_PATH}`);
  console.log(
    `[mb-sidecar] dossiers ${dossierMatched}/${dossierIds.length} matched; coordinates unmatched ${unmatchedCoords.length}`,
  );
  console.log(`[mb-sidecar] Thriller validation:`, JSON.stringify(thrillerValidation));
}

main();
