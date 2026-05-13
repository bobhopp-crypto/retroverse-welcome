/**
 * High-throughput iTunes-only cover acquisition: artist-term catalog search + normalized album matching.
 *
 * Layering (enrichment architecture):
 * - Raw layer: full provider JSON persisted exactly as received (`data/raw/providers/itunes/...`, see `itunes-raw-snapshot.ts`).
 * - Candidate layer: provider rows transformed into comparable entities (`extractAlbumCandidatesFromItunesResults` — includes track→album via collectionId).
 * - Canonical layer: Retroverse DB / curated album identity — this script reads albums from Supabase, not defined here.
 */
import { appendFile, copyFile, mkdir, writeFile } from "node:fs/promises";
import { existsSync, statSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

import type { RetroverseSupabase } from "../lib/retroverse-supabase";
import {
  BILLBOARD200_SOURCE,
  EXCLUDED_INFERRED_NOTES_SNIPPETS,
  isExcludedSyntheticTitle,
} from "./lib/billboard200-historical";
import {
  albumKeyForNearExactMatch,
  buildArtistSearchAttempts,
  normalizeAlbumForItunesQuery,
  normalizeArtistForItunesQuery,
  normalizedAlbumComparisonKey,
} from "./lib/itunes-query-normalize";
import { extractAlbumCandidatesFromItunesResults } from "./lib/itunes-candidates-from-raw";
import {
  albumDepthPenaltiesAndBoosts,
  trackOverlapDepthMultiplier,
} from "./lib/itunes-album-candidate-hygiene";
import { saveItunesRawSnapshot } from "./lib/itunes-raw-snapshot";
import type { ItunesTransportResult, TransportLayer, TransportTaxonomy } from "./lib/itunes-transport";
import { fetchItunesSearchWithTransport } from "./lib/itunes-transport";
import { computeTrackOverlapSignal } from "../app/ops/review/track-overlap";

const WORKSPACE_ROOT = "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome";
const LOG_ROOT = "/Users/bobhopp/RETROVERSE_DATA/logs/itunes-artwork-fill";
const DIAGNOSTICS_ROOT = path.join(WORKSPACE_ROOT, "data", "diagnostics", "itunes");
/** Versioned diagnostics files — prior `itunes_attempts.csv` is left untouched (see env overrides). */
const ITUNES_ATTEMPTS_CSV_NAME = process.env.ITUNES_ATTEMPTS_CSV ?? "itunes_attempts_v2.csv";
const ITUNES_CANDIDATES_CSV_NAME = process.env.ITUNES_CANDIDATES_CSV ?? "itunes_candidates_v3.csv";
const RAW_ITUNES_ROOT = path.join(WORKSPACE_ROOT, "data", "raw", "providers", "itunes");

const PAGE_SIZE = 1000;
const CONCURRENCY = Math.max(1, Math.min(32, Number.parseInt(process.env.ITUNES_FILL_CONCURRENCY ?? "8", 10)));
const PROGRESS_EVERY = Math.max(1, Number.parseInt(process.env.ITUNES_FILL_PROGRESS_EVERY ?? "25", 10));
const DIAG_SUMMARY_EVERY = Math.max(1, Number.parseInt(process.env.ITUNES_FILL_DIAG_SUMMARY_EVERY ?? "100", 10));
/** Max album rows per iTunes artist-term search (attribute=artistTerm). */
const ARTIST_CATALOG_LIMIT = Math.max(
  25,
  Math.min(
    200,
    Number.parseInt(
      process.env.ITUNES_FILL_ARTIST_CATALOG_LIMIT ?? process.env.ITUNES_FILL_SEARCH_LIMIT ?? "100",
      10,
    ),
  ),
);
const REQUEST_DELAY_MS = Math.max(0, Number.parseInt(process.env.ITUNES_FILL_REQUEST_DELAY_MS ?? "60", 10));
const REQUEST_TIMEOUT_MS = Math.max(3000, Number.parseInt(process.env.ITUNES_FILL_REQUEST_TIMEOUT_MS ?? "15000", 10));
const RUN_LIMIT = Math.max(0, Number.parseInt(process.env.ITUNES_FILL_LIMIT ?? "0", 10));
/** Minimum match score to accept image at all (otherwise failed). */
const MIN_SCORE = Number.parseFloat(process.env.ITUNES_FILL_MIN_SCORE ?? "0.58");
/** Strong match → verified; else pending. */
const VERIFY_SCORE = Number.parseFloat(process.env.ITUNES_FILL_VERIFY_SCORE ?? "0.86");
/** `all` (default) or `billboard200` — limit acquisition to albums tagged via Billboard 200 import source matches. */
const FILL_SCOPE = (process.env.ITUNES_FILL_SCOPE ?? "all").toLowerCase();
/** After a primary iTunes call returns zero rows, run alternate URL shapes and record result counts (no scoring change). */
const RECALL_EXPERIMENTS = (process.env.ITUNES_FILL_RECALL_EXPERIMENTS ?? "0").trim() === "1";
/** Log full iTunes API URLs to stderr (primary + recall experiments when enabled). */
const LOG_API_URLS = (process.env.ITUNES_FILL_LOG_API_URLS ?? "0").trim() === "1";

/** Tab-separated `canonical_artist_from_db` + TAB + `canonical_album_title`. With `ITUNES_FILL_LIMIT=1`, forces that row into the queue even when primary artwork is already verified (calibration / diagnostics rerun). */
function parseForceReviewPairFromEnv(): { artist: string; album: string } | null {
  const raw = process.env.ITUNES_FILL_FORCE_REVIEW?.trim();
  if (!raw) return null;
  const tab = raw.indexOf("\t");
  if (tab <= 0) return null;
  const artist = raw.slice(0, tab).trim();
  const album = raw.slice(tab + 1).trim();
  if (!artist || !album) return null;
  return { artist, album };
}

const FORCE_REVIEW_PAIR = parseForceReviewPairFromEnv();

/** With `ITUNES_FILL_FORCE_REVIEW`, run a single primary fetch using this taxonomy (calibration UI). */
type CalibrationRetryTaxonomy =
  | "artist_only"
  | "artist_album"
  | "broad_search"
  | "loose_match"
  | "title_only"
  | "ignore_year";

function parseCalibrationStrategyFromEnv(): CalibrationRetryTaxonomy | null {
  const v = (process.env.ITUNES_FILL_CALIBRATION_STRATEGY ?? "").trim().toLowerCase();
  if (
    v === "artist_only" ||
    v === "artist_album" ||
    v === "broad_search" ||
    v === "loose_match" ||
    v === "title_only" ||
    v === "ignore_year"
  ) {
    return v;
  }
  return null;
}

const CALIBRATION_STRATEGY = parseCalibrationStrategyFromEnv();

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  album_type: string;
  notes: string | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type ArtworkRow = {
  retroverse_album_artwork_id: string;
  retroverse_album_id: string;
  retroverse_album_edition_id: string | null;
  artwork_role: string;
  is_primary: boolean;
  artwork_status: string;
  canonical_cover_path: string | null;
};

type SearchResult = {
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  collectionType?: string;
  collectionId?: number;
  trackCount?: number;
  primaryGenreName?: string;
  wrapperType?: string;
  /** First titles from grouped iTunes results (same collectionId), ordered by trackNumber. */
  trackTitleSample?: string[];
};

type Scored = {
  score: number;
  artist_score: number;
  title_score: number;
  artwork_url: string;
  reasons: string[];
};

type QueryAudit = {
  query_original: string;
  artist_query_used: string;
  artist_retry_level: string;
  candidate_count: number;
  matched_title: string;
  normalized_local_album: string;
  normalized_matched_album: string;
};

type RejectionTaxonomy =
  | ""
  | "no_results"
  | "artist_mismatch"
  | "low_album_similarity"
  | "compilation_noise"
  | "remaster_noise"
  | "single_or_ep"
  | "score_below_threshold"
  | "ambiguous_match"
  | "invalid_release_type"
  | "db_persist_failed"
  | "exception";

type CatalogDiagBase = {
  artist_match_score: number;
  album_match_score: number;
  token_overlap_score: number;
  /** Legacy CSV column: mirrors `historical_year_distance_score` (0–1 proximity). */
  year_distance_score: number;
  compilation_penalty: number;
  remaster_penalty: number;
  tribute_penalty: number;
  karaoke_penalty: number;
  single_penalty: number;
  ep_penalty: number;
  /** |Billboard year − iTunes release year| when both known. */
  release_year_distance: number | null;
  /** 1 = same year, decays as calendar distance grows. */
  historical_year_distance_score: number;
  /** 0–1 trust after gap + title-era penalties (weighted signal, not hard gate). */
  historical_confidence: number;
  historical_penalty_reason: string;
  /** iTunes `trackCount` on collection when present. */
  catalog_track_count: number | null;
  /** 0–1 tracklist vs Billboard anchor overlap (heuristic). */
  track_overlap_score: number;
  /** ` ;; `-joined sample titles persisted in CSV. */
  track_sample_csv: string;
  /** ` ;; `-joined matched track titles for UI. */
  track_matched_csv: string;
};

type CatalogEvaluation = {
  raw: SearchResult;
  scored: Scored | null;
  rankingRejectedReason: string;
  diag: CatalogDiagBase;
};

/** iTunes Search URL shape; primary path is usually artist_only or artist_album_combined_search_mode. */
type FetchStrategyTaxonomy =
  | "artist_only"
  | "artist_album_combined_search_mode"
  | "no_attribute"
  | "no_entity_filter"
  | "artist_album"
  | "broad_search";

type ItunesAttemptDiag = {
  billboard_artist: string;
  billboard_album: string;
  chart_year: number | null;
  normalized_artist: string;
  normalized_album: string;
  retry_strategy: string;
  search_query: string;
  candidate_count: number;
  raw_api_result_count: number;
  http_status: number;
  response_content_length: number;
  response_content_type: string;
  response_headers_summary: string;
  transport_taxonomy: TransportTaxonomy;
  transport_layer: TransportLayer;
  transport_fallback_summary: string;
  api_query_url: string;
  /** Primary catalog fetch strategy (production path). */
  fetch_strategy_taxonomy: FetchStrategyTaxonomy;
  /**
   * Populated when `ITUNES_FILL_RECALL_EXPERIMENTS=1` and the primary call returned 0 rows.
   * `recall_experiment_artist_only` is recorded as 0 without an extra HTTP call.
   */
  recall_experiment_artist_only: string;
  recall_experiment_no_attribute: string;
  recall_experiment_no_entity_filter: string;
  recall_experiment_artist_album: string;
  recall_experiment_broad_search: string;
  /** Semicolon-separated workspace-relative paths to `*.raw.json` snapshots for this attempt. */
  raw_snapshot_path: string;
  raw_snapshot_saved: string;
  raw_snapshot_error: string;
  selected_candidate: string;
  selected_artist: string;
  selected_collection_id: string;
  selected_release_date: string;
  selected_track_count: string;
  selected_primary_genre: string;
  selected_collection_type: string;
  final_score: string;
  elapsed_ms: number;
  candidate_csv_lines: string[];
  results_len: number;
  ranked: Array<{ raw: SearchResult; scored: Scored }>;
  best: { raw: SearchResult; scored: Scored } | null;
  match_rejection: RejectionTaxonomy;
  prepare_exception?: string;
};

type Prepared =
  | {
      album: AlbumRow;
      artistName: string;
      scored: Scored;
      tmpPath: string;
      deployRel: string;
      verified: boolean;
      audit: QueryAudit;
      itunesDiag: ItunesAttemptDiag;
    }
  | {
      album: AlbumRow;
      artistName: string;
      error: string;
      audit?: QueryAudit;
      itunesDiag: ItunesAttemptDiag;
    };

function transportDiagFromFetch(f: ItunesTransportResult): Pick<
  ItunesAttemptDiag,
  | "raw_api_result_count"
  | "http_status"
  | "response_content_length"
  | "response_content_type"
  | "response_headers_summary"
  | "transport_taxonomy"
  | "transport_layer"
  | "transport_fallback_summary"
  | "api_query_url"
> {
  return {
    raw_api_result_count: f.rawResultCount,
    http_status: f.httpStatus,
    response_content_length: f.responseContentLength,
    response_content_type: f.responseContentType,
    response_headers_summary: f.responseHeadersSummary,
    transport_taxonomy: f.transportTaxonomy,
    transport_layer: f.transportLayer,
    transport_fallback_summary: f.transportFallbackSummary,
    api_query_url: f.url,
  };
}

function emptyTransportDiag(): Pick<
  ItunesAttemptDiag,
  | "raw_api_result_count"
  | "http_status"
  | "response_content_length"
  | "response_content_type"
  | "response_headers_summary"
  | "transport_taxonomy"
  | "transport_layer"
  | "transport_fallback_summary"
  | "api_query_url"
> {
  return {
    raw_api_result_count: 0,
    http_status: 0,
    response_content_length: 0,
    response_content_type: "",
    response_headers_summary: "",
    transport_taxonomy: "transport_invalid_json",
    transport_layer: "native_fetch",
    transport_fallback_summary: "",
    api_query_url: "",
  };
}

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['".,!?/\\:;`~*+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value: string): string {
  return normalize(value)
    .replace(/\(.*?\)/g, " ")
    .replace(/\[.*?\]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function artworkPickScore(row: ArtworkRow & { canonical_cover_path?: string | null }): number {
  let s = 0;
  if (row.canonical_cover_path?.trim()) s += 32;
  if (row.is_primary) s += 16;
  if (row.artwork_role === "primary") s += 8;
  return s;
}

function pickPrimaryArtwork(rows: ArtworkRow[]): ArtworkRow | null {
  if (rows.length === 0) return null;
  return [...rows].sort((a, b) => artworkPickScore(b) - artworkPickScore(a))[0]!;
}

function albumNeedsArtwork(rows: ArtworkRow[]): boolean {
  if (rows.length === 0) return true;
  const p = pickPrimaryArtwork(rows)!;
  const st = (p.artwork_status ?? "").toLowerCase();
  if (st === "verified") return false;
  if (st === "missing" || st === "pending") return true;
  if (!p.canonical_cover_path?.trim()) return true;
  return false;
}

type Exclusion = { kind: "title" | "notes" };

/** Skip synthetic/editorial Retroverse constructs; keep real studio/compilation/soundtrack/live/etc. */
function exclusionForItunesFill(album: AlbumRow): Exclusion | null {
  if (isExcludedSyntheticTitle(album.canonical_album_title)) return { kind: "title" };
  const notes = (album.notes ?? "").toLowerCase();
  for (const snippet of EXCLUDED_INFERRED_NOTES_SNIPPETS) {
    if (notes.includes(snippet)) return { kind: "notes" };
  }
  return null;
}

function tokenJaccardKeys(a: string, b: string): number {
  const ta = new Set(a.split(" ").filter((t) => t.length > 1));
  const tb = new Set(b.split(" ").filter((t) => t.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) {
    if (tb.has(x)) inter += 1;
  }
  const u = ta.size + tb.size - inter;
  return u === 0 ? 0 : inter / u;
}

function artistLikelyMatch(target: string, cand: string): boolean {
  const a = normalize(target);
  const b = normalize(cand);
  if (!b) return false;
  if (!a) return true;
  if (a === b) return true;
  if (a.includes(b) || b.includes(a)) return true;
  return tokenJaccardKeys(a, b) >= 0.35;
}

function isSingleCollection(raw: SearchResult): boolean {
  const c = (raw.collectionType ?? "").toLowerCase();
  return c === "single" || c === "maxisingle";
}

function catalogVariantFluffRaw(title: string): boolean {
  return /\b(deluxe|remaster(?:ed)?|expanded|super\s+deluxe|bonus\s+tracks?|anniversary\s+edition)\b/i.test(title);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/** Later-era charting is plausible for these packages — soften year-anomaly penalties when titles align. */
function looksLikeGreatestHitsPackage(normKey: string): boolean {
  return (
    (/\bgreatest\b/.test(normKey) && /\bhits\b/.test(normKey)) ||
    /\bbest of\b/.test(normKey) ||
    /\b(greatest hits|best of)\b/.test(normKey)
  );
}

function needsArtistAlbumCombinedSearchMode(canonicalArtist: string): boolean {
  const a = canonicalArtist.trim().toLowerCase();
  if (!a) return false;
  if (a === "various artists" || a.startsWith("various artists")) return true;
  if (/\bvarious artists\b/.test(a)) return true;
  if (/\bsoundtrack\b/.test(a) || /\boriginal motion picture\b/.test(a) || /\bost\b/.test(a)) return true;
  if (/\boriginal broadway cast\b/.test(a) || /\bbroadway cast recording\b/.test(a)) return true;
  return false;
}

function parseItunesReleaseYear(releaseDate: string | undefined): number | null {
  if (!releaseDate) return null;
  const y = Number.parseInt(releaseDate.slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function computeHistoricalYearProximity(
  targetYear: number | null,
  itunesYear: number | null,
): {
  release_year_distance: number | null;
  historical_year_distance_score: number;
  baseYearGapPenalty: number;
} {
  if (targetYear === null || itunesYear === null) {
    return { release_year_distance: null, historical_year_distance_score: 0.55, baseYearGapPenalty: 0 };
  }
  const d = Math.abs(itunesYear - targetYear);
  let historical_year_distance_score: number;
  let baseYearGapPenalty: number;
  if (d === 0) {
    historical_year_distance_score = 1;
    baseYearGapPenalty = 0;
  } else if (d <= 2) {
    historical_year_distance_score = 0.9;
    baseYearGapPenalty = 0.05;
  } else if (d <= 5) {
    historical_year_distance_score = 0.65;
    baseYearGapPenalty = 0.1;
  } else if (d <= 10) {
    historical_year_distance_score = 0.38;
    baseYearGapPenalty = 0.16;
  } else {
    historical_year_distance_score = 0.14;
    baseYearGapPenalty = 0.26;
  }
  return { release_year_distance: d, historical_year_distance_score, baseYearGapPenalty };
}

function crossEraReissuePenalty(
  targetYear: number | null,
  itunesYear: number | null,
  releaseDist: number | null,
): { penalty: number; tag: string | null } {
  if (targetYear == null || itunesYear == null || releaseDist == null) return { penalty: 0, tag: null };
  let penalty = 0;
  let tag: string | null = null;
  if (targetYear <= 1975 && itunesYear >= 2020 && releaseDist >= 40) {
    penalty = 0.22;
    tag = "cross_era_modern_live_or_reissue";
  } else if (targetYear < 1985 && itunesYear >= 2015 && releaseDist >= 25) {
    penalty = 0.14;
    tag = "cross_era_reissue";
  } else if (targetYear < 1990 && itunesYear >= 2005 && releaseDist >= 18) {
    penalty = 0.09;
    tag = "cross_era_stretch";
  }
  return { penalty, tag };
}

function titleEraAndAnomalyPenalties(args: {
  candTitle: string;
  targetYear: number | null;
  itunesYear: number | null;
  release_year_distance: number | null;
  hitsFriendly: boolean;
}): { penalty: number; reasons: string[] } {
  const { candTitle, targetYear, itunesYear, release_year_distance, hitsFriendly } = args;
  const t = candTitle.toLowerCase();
  const plausibleYear = release_year_distance != null && release_year_distance <= 3;
  const damp = hitsFriendly ? 0.45 : plausibleYear ? 0.3 : 1;

  const reasons: string[] = [];
  let penalty = 0;
  const add = (amount: number, tag: string) => {
    const a = amount * damp;
    if (a <= 0) return;
    penalty += a;
    reasons.push(tag);
  };

  if (!plausibleYear) {
    if (/\b(deluxe edition|super deluxe)\b/.test(t)) add(0.08, "title_deluxe_edition");
    else if (/\bdeluxe\b/.test(t)) add(0.06, "title_deluxe");
    if (/\bexpanded edition\b/.test(t)) add(0.09, "title_expanded_edition");
    if (/\banniversary\b/.test(t)) add(0.08, "title_anniversary");
    if (/\bbonus tracks?\b/.test(t)) add(0.07, "title_bonus_tracks");

    if (/\bremaster(ed)?\b/.test(t)) {
      let r = 0.07;
      if (
        targetYear != null &&
        targetYear < 1975 &&
        itunesYear != null &&
        itunesYear >= 2010 &&
        (release_year_distance ?? 99) > 12
      ) {
        r += 0.15;
        reasons.push("remaster_deep_cross_era");
      }
      add(r, "title_remaster");
    }
  }

  const liveModern =
    /\blive\b.*\b20(1[4-9]|[2-9][0-9])\b/i.test(t) || /\b20(1[4-9]|[2-9][0-9])\b.*\blive\b/i.test(t);
  if (liveModern && !plausibleYear) {
    if (targetYear != null && targetYear <= 1990) add(0.26, "live_modern_year_vs_historical_chart");
    else add(0.1, "live_recent_year_in_title");
  } else if (/\blive\b/i.test(t) && !plausibleYear && targetYear != null && targetYear < 1985) {
    add(0.06, "live_keyword_historical_target");
  }

  return { penalty, reasons };
}

function artworkUrl600(raw: SearchResult): string | null {
  const u = raw.artworkUrl100;
  if (!u) return null;
  return u.replace(/100x100bb/gi, "600x600bb").replace(/100x100-75/gi, "600x600-75");
}

function isEpCollection(raw: SearchResult): boolean {
  const c = (raw.collectionType ?? "").toLowerCase();
  return c === "ep" || /\bep\b/.test(c);
}

/**
 * Candidate layer: historical proximity + title-era signals (weighted soft penalties, not hard rejection).
 * Raw layer unchanged. Canonical = Retroverse album identity.
 */
function evaluateCatalogCandidate(
  raw: SearchResult,
  targetArtist: string,
  rawBillboardAlbum: string,
  localNormKey: string,
  targetYear: number | null,
): {
  scored: Scored | null;
  rankingRejectedReason: string;
  diag: CatalogDiagBase;
} {
  const emptyHist = (partial: Partial<CatalogDiagBase> = {}): CatalogDiagBase => ({
    artist_match_score: 0,
    album_match_score: 0,
    token_overlap_score: 0,
    year_distance_score: 0,
    compilation_penalty: 0,
    remaster_penalty: 0,
    tribute_penalty: 0,
    karaoke_penalty: 0,
    single_penalty: 0,
    ep_penalty: 0,
    release_year_distance: null,
    historical_year_distance_score: 0,
    historical_confidence: 0,
    historical_penalty_reason: "",
    catalog_track_count: null,
    track_overlap_score: 0,
    track_sample_csv: "",
    track_matched_csv: "",
    ...partial,
  });

  const trackSidecar = (
    r: SearchResult,
  ): Pick<CatalogDiagBase, "catalog_track_count" | "track_overlap_score" | "track_sample_csv" | "track_matched_csv"> => {
    const sample = r.trackTitleSample ?? [];
    const sig = computeTrackOverlapSignal({
      billboardArtist: targetArtist,
      billboardAlbum: rawBillboardAlbum,
      trackSample: sample,
      catalogTrackCount: r.trackCount ?? null,
    });
    const depthMult = trackOverlapDepthMultiplier(r.trackCount ?? null);
    const dampedOverlap = Math.max(0, Math.min(1, sig.overlapScore * depthMult));
    const esc = (s: string) => s.replace(/\s*;;\s*/g, " ");
    return {
      catalog_track_count: r.trackCount ?? null,
      track_overlap_score: dampedOverlap,
      track_sample_csv: sample.map(esc).join(" ;; "),
      track_matched_csv: sig.matchedSample.map(esc).join(" ;; "),
    };
  };

  const ts = trackSidecar(raw);
  const candArtist = raw.artistName?.trim() ?? "";
  const candTitle = raw.collectionName?.trim() ?? "";
  if (!candTitle) {
    return { scored: null, rankingRejectedReason: "invalid_release_type", diag: emptyHist({ ...ts }) };
  }

  const artwork600 = artworkUrl600(raw);
  if (!artwork600) {
    return { scored: null, rankingRejectedReason: "invalid_release_type", diag: emptyHist({ ...ts }) };
  }

  const candNormKey = normalizedAlbumComparisonKey(candTitle);
  const tokenJac = tokenJaccardKeys(localNormKey, candNormKey);

  const genre = (raw.primaryGenreName ?? "").toLowerCase();
  const compilation_penalty = genre.includes("compilation") ? 0.05 : 0;

  const artistKey = normalize(targetArtist);
  const artistLoose = normalizeLoose(targetArtist);
  const candArtistKey = normalize(candArtist);
  const candArtistLoose = normalizeLoose(candArtist);

  let artistScore = 0;
  const reasons: string[] = [];

  if (candArtistKey === artistKey) {
    artistScore = 0.54;
    reasons.push("artist_exact");
  } else if (candArtistLoose === artistLoose) {
    artistScore = 0.38;
    reasons.push("artist_loose");
  } else if (candArtistKey.includes(artistLoose) || artistLoose.includes(candArtistKey)) {
    artistScore = 0.2;
    reasons.push("artist_contains");
  } else {
    return {
      scored: null,
      rankingRejectedReason: "artist_mismatch",
      diag: emptyHist({
        token_overlap_score: tokenJac,
        compilation_penalty,
        ...ts,
      }),
    };
  }

  let titleScore = 0;
  if (!localNormKey || !candNormKey) {
    return {
      scored: null,
      rankingRejectedReason: "low_album_similarity",
      diag: emptyHist({
        artist_match_score: artistScore,
        token_overlap_score: tokenJac,
        compilation_penalty,
        ...ts,
      }),
    };
  }

  if (localNormKey === candNormKey) {
    titleScore = 0.46;
    reasons.push("norm_album_exact");
  } else if (localNormKey.length >= 4 && candNormKey.includes(localNormKey)) {
    titleScore = 0.38;
    reasons.push("norm_catalog_contains_local");
  } else if (candNormKey.length >= 4 && localNormKey.includes(candNormKey)) {
    titleScore = 0.32;
    reasons.push("norm_local_contains_catalog");
  } else {
    const jac = tokenJaccardKeys(localNormKey, candNormKey);
    if (jac >= 0.55) {
      titleScore = 0.28 + jac * 0.12;
      reasons.push(`norm_token_jaccard:${jac.toFixed(2)}`);
    } else if (jac >= 0.38) {
      titleScore = 0.22;
      reasons.push(`norm_token_jaccard:${jac.toFixed(2)}`);
    } else {
      return {
        scored: null,
        rankingRejectedReason: "low_album_similarity",
        diag: emptyHist({
          artist_match_score: artistScore,
          album_match_score: 0,
          token_overlap_score: jac,
          compilation_penalty,
          ...ts,
        }),
      };
    }
  }

  const nearKeyLocal = albumKeyForNearExactMatch(rawBillboardAlbum);
  const nearKeyCand = albumKeyForNearExactMatch(candTitle);
  if (
    nearKeyLocal.length >= 4 &&
    nearKeyCand.length >= 4 &&
    nearKeyLocal === nearKeyCand &&
    localNormKey !== candNormKey
  ) {
    titleScore = Math.min(0.46, titleScore + 0.12);
    reasons.push("near_exact_punctuation_variant");
  }

  const itunesYear = parseItunesReleaseYear(raw.releaseDate);
  const histCore = computeHistoricalYearProximity(targetYear, itunesYear);
  const cross = crossEraReissuePenalty(targetYear, itunesYear, histCore.release_year_distance);
  const hitsFriendly =
    looksLikeGreatestHitsPackage(localNormKey) && looksLikeGreatestHitsPackage(normalizedAlbumComparisonKey(candTitle));
  const era = titleEraAndAnomalyPenalties({
    candTitle,
    targetYear,
    itunesYear,
    release_year_distance: histCore.release_year_distance,
    hitsFriendly,
  });

  let totalHistPenalty = histCore.baseYearGapPenalty + cross.penalty + era.penalty;
  if (hitsFriendly && histCore.release_year_distance != null && histCore.release_year_distance > 10) {
    totalHistPenalty *= 0.52;
  }
  totalHistPenalty = Math.min(0.52, totalHistPenalty);

  const historical_penalty_reason = [cross.tag, ...era.reasons].filter(Boolean).join("; ");
  const historical_year_distance_score = histCore.historical_year_distance_score;
  const historical_confidence = clamp01(historical_year_distance_score - totalHistPenalty);
  const historicalWeightedBonus = 0.12 * historical_year_distance_score;

  let typeAdjust = 0;
  let single_penalty = 0;
  if (isSingleCollection(raw)) {
    typeAdjust = -0.11;
    single_penalty = 0.11;
    reasons.push("collection_single_penalty");
  } else {
    typeAdjust = 0.04;
    reasons.push("prefer_album_collection");
  }

  let variantPenalty = 0;
  let remaster_penalty = 0;
  if (catalogVariantFluffRaw(candTitle)) {
    variantPenalty = 0.035;
    remaster_penalty = 0.035;
    reasons.push("catalog_deluxe_variant_depriority");
  }

  const combined = `${candArtistKey} ${normalizedAlbumComparisonKey(candTitle)}`;
  let junkPenalty = 0;
  let tributePenalty = 0;
  let karaokePenalty = 0;
  for (const token of ["karaoke", "tribute", "instrumental", "cover", "re-recorded"]) {
    if (combined.includes(token)) {
      junkPenalty += 0.22;
      if (token === "tribute") tributePenalty += 0.22;
      if (token === "karaoke") karaokePenalty += 0.22;
    }
  }

  const albumDepth = albumDepthPenaltiesAndBoosts({
    collectionType: raw.collectionType,
    effectiveTrackCount: raw.trackCount ?? null,
  });
  for (const t of albumDepth.tags) reasons.push(t);

  const trackBoost = 0.13 * ts.track_overlap_score;
  if (trackBoost >= 0.02) reasons.push(`track_overlap:${ts.track_overlap_score.toFixed(2)}`);

  const score = Math.max(
    0,
    Math.min(
      1,
      Number(
        (
          artistScore +
          titleScore +
          historicalWeightedBonus +
          typeAdjust +
          trackBoost +
          albumDepth.boost -
          variantPenalty -
          junkPenalty -
          albumDepth.penalty -
          totalHistPenalty
        ).toFixed(3),
      ),
    ),
  );

  const scored: Scored = { score, artist_score: artistScore, title_score: titleScore, artwork_url: artwork600, reasons };

  const ep_penalty_obs = isEpCollection(raw) ? 0.08 : 0;

  return {
    scored,
    rankingRejectedReason: "",
    diag: {
      artist_match_score: artistScore,
      album_match_score: titleScore,
      token_overlap_score: tokenJac,
      year_distance_score: historical_year_distance_score,
      compilation_penalty,
      remaster_penalty,
      tribute_penalty: tributePenalty,
      karaoke_penalty: karaokePenalty,
      single_penalty,
      ep_penalty: ep_penalty_obs,
      release_year_distance: histCore.release_year_distance,
      historical_year_distance_score,
      historical_confidence,
      historical_penalty_reason,
      ...ts,
    },
  };
}

function isVerifiedMatch(s: Scored): boolean {
  if (s.score < VERIFY_SCORE) return false;
  if (s.artist_score < 0.18) return false;
  if (s.title_score < 0.22) return false;
  return true;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

function buildItunesSearchUrl(args: { term: string; limit: number; strategy: FetchStrategyTaxonomy }): string {
  const term = encodeURIComponent(args.term);
  const lim = args.limit;
  let u = `https://itunes.apple.com/search?term=${term}&media=music&country=US&limit=${lim}`;
  if (args.strategy === "artist_only") {
    u += "&entity=album&attribute=artistTerm";
  } else if (
    args.strategy === "no_attribute" ||
    args.strategy === "artist_album" ||
    args.strategy === "artist_album_combined_search_mode"
  ) {
    u += "&entity=album";
  }
  return u;
}

async function runRecallExperiments(args: {
  artistTerm: string;
  combinedTerm: string;
  limit: number;
  saveRaw?: (f: ItunesTransportResult, strategy: FetchStrategyTaxonomy, queryTerm: string) => Promise<void>;
}): Promise<{
  recall_experiment_artist_only: string;
  recall_experiment_no_attribute: string;
  recall_experiment_no_entity_filter: string;
  recall_experiment_artist_album: string;
  recall_experiment_broad_search: string;
}> {
  const { artistTerm, combinedTerm, limit, saveRaw } = args;
  const log = (strategy: FetchStrategyTaxonomy, url: string) => {
    if (LOG_API_URLS || RECALL_EXPERIMENTS) console.log(`itunes_api_recall strategy=${strategy} url=${url}`);
  };

  const urlB = buildItunesSearchUrl({ term: artistTerm, limit, strategy: "no_attribute" });
  log("no_attribute", urlB);
  if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  const b = await fetchItunesSearchWithTransport(urlB, REQUEST_TIMEOUT_MS);
  await saveRaw?.(b, "no_attribute", artistTerm);

  const urlC = buildItunesSearchUrl({ term: artistTerm, limit, strategy: "no_entity_filter" });
  log("no_entity_filter", urlC);
  if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  const c = await fetchItunesSearchWithTransport(urlC, REQUEST_TIMEOUT_MS);
  await saveRaw?.(c, "no_entity_filter", artistTerm);

  const urlD = buildItunesSearchUrl({ term: combinedTerm, limit, strategy: "artist_album" });
  log("artist_album", urlD);
  if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  const d = await fetchItunesSearchWithTransport(urlD, REQUEST_TIMEOUT_MS);
  await saveRaw?.(d, "artist_album", combinedTerm);

  const urlE = buildItunesSearchUrl({ term: combinedTerm, limit, strategy: "broad_search" });
  log("broad_search", urlE);
  if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
  const e = await fetchItunesSearchWithTransport(urlE, REQUEST_TIMEOUT_MS);
  await saveRaw?.(e, "broad_search", combinedTerm);

  return {
    recall_experiment_artist_only: "0",
    recall_experiment_no_attribute: String(b.rawResultCount),
    recall_experiment_no_entity_filter: String(c.rawResultCount),
    recall_experiment_artist_album: String(d.rawResultCount),
    recall_experiment_broad_search: String(e.rawResultCount),
  };
}

function rankEvaluatedCatalogCandidates(
  candidates: SearchResult[],
  targetArtist: string,
  rawBillboardAlbum: string,
  localNormKey: string,
  targetYear: number | null,
): {
  evaluations: CatalogEvaluation[];
  ranked: Array<{ raw: SearchResult; scored: Scored }>;
} {
  const evaluations: CatalogEvaluation[] = candidates.map((raw) => {
    const { scored, rankingRejectedReason, diag } = evaluateCatalogCandidate(
      raw,
      targetArtist,
      rawBillboardAlbum,
      localNormKey,
      targetYear,
    );
    return { raw, scored, rankingRejectedReason, diag };
  });

  const ranked = evaluations
    .filter((e): e is CatalogEvaluation & { scored: Scored } => e.scored !== null)
    .sort((ea, eb) => {
      const d = eb.scored.score - ea.scored.score;
      if (Math.abs(d) > 1e-6) return d;
      const hc = eb.diag.historical_confidence - ea.diag.historical_confidence;
      if (Math.abs(hc) > 1e-6) return hc;
      const ya = ea.diag.release_year_distance ?? 9999;
      const yb = eb.diag.release_year_distance ?? 9999;
      if (ya !== yb) return ya - yb;
      const sa = isSingleCollection(ea.raw) ? 1 : 0;
      const sb = isSingleCollection(eb.raw) ? 1 : 0;
      if (sa !== sb) return sa - sb;
      const fa = catalogVariantFluffRaw(ea.raw.collectionName ?? "") ? 1 : 0;
      const fb = catalogVariantFluffRaw(eb.raw.collectionName ?? "") ? 1 : 0;
      if (fa !== fb) return fa - fb;
      const tb = eb.diag.track_overlap_score - ea.diag.track_overlap_score;
      if (Math.abs(tb) > 1e-6) return tb;
      return (ea.raw.collectionName ?? "").length - (eb.raw.collectionName ?? "").length;
    })
    .map((e) => ({ raw: e.raw, scored: e.scored }));

  return { evaluations, ranked };
}

function dominantReason(counts: Map<string, number>): string {
  let best = "";
  let n = -1;
  for (const [k, v] of counts) {
    if (v > n) {
      n = v;
      best = k;
    }
  }
  return best;
}

function classifyMatchRejection(args: {
  resultsLen: number;
  evaluations: CatalogEvaluation[];
  ranked: Array<{ raw: SearchResult; scored: Scored }>;
  best: { raw: SearchResult; scored: Scored } | null;
}): RejectionTaxonomy {
  const { resultsLen, evaluations, ranked, best } = args;
  if (resultsLen === 0) return "no_results";

  if (!best) {
    const counts = new Map<string, number>();
    for (const e of evaluations) {
      if (e.scored) continue;
      const r = e.rankingRejectedReason || "low_album_similarity";
      counts.set(r, (counts.get(r) ?? 0) + 1);
    }
    const dom = dominantReason(counts);
    if (dom === "artist_mismatch" || dom === "low_album_similarity" || dom === "invalid_release_type") {
      return dom as RejectionTaxonomy;
    }
    return "low_album_similarity";
  }

  if (best.scored.score < MIN_SCORE) {
    const second = ranked[1];
    if (second && Math.abs(best.scored.score - second.scored.score) < 0.02) {
      return "ambiguous_match";
    }
    if (isSingleCollection(best.raw) || isEpCollection(best.raw)) {
      return "single_or_ep";
    }
    if (catalogVariantFluffRaw(best.raw.collectionName ?? "")) {
      return "remaster_noise";
    }
    const genre = (best.raw.primaryGenreName ?? "").toLowerCase();
    if (genre.includes("compilation")) {
      return "compilation_noise";
    }
    return "score_below_threshold";
  }

  return "";
}

function candidateCsvLine(
  billboardArtist: string,
  billboardAlbum: string,
  ev: CatalogEvaluation,
): string {
  const raw = ev.raw;
  const candArtist = raw.artistName?.trim() ?? "";
  const candAlbum = raw.collectionName?.trim() ?? "";
  const normCandArtist = normalize(candArtist);
  const normCandAlbum = normalizedAlbumComparisonKey(candAlbum);
  const scored = ev.scored;
  const d = ev.diag;
  return [
    csvEscape(billboardArtist),
    csvEscape(billboardAlbum),
    csvEscape(candArtist),
    csvEscape(candAlbum),
    csvEscape(normCandArtist),
    csvEscape(normCandAlbum),
    String(d.artist_match_score),
    String(d.album_match_score),
    String(d.token_overlap_score),
    String(d.year_distance_score),
    String(d.compilation_penalty),
    String(d.remaster_penalty),
    String(d.tribute_penalty),
    String(d.karaoke_penalty),
    String(d.single_penalty),
    String(d.ep_penalty),
    d.release_year_distance == null ? "" : String(d.release_year_distance),
    String(d.historical_year_distance_score),
    String(d.historical_confidence),
    csvEscape(d.historical_penalty_reason),
    scored ? String(scored.score) : "",
    scored ? "true" : "false",
    scored ? "" : csvEscape(ev.rankingRejectedReason || "invalid_release_type"),
    d.catalog_track_count == null ? "" : String(d.catalog_track_count),
    csvEscape(d.track_sample_csv),
    String(d.track_overlap_score),
    csvEscape(d.track_matched_csv),
  ].join(",");
}

/** One CSV row when iTunes returned zero rows for a primary fetch (still scored/evaluated later as empty pool). */
function emptyCandidatePoolCsvLine(billboardArtist: string, billboardAlbum: string, reason: string): string {
  return [
    csvEscape(billboardArtist),
    csvEscape(billboardAlbum),
    "", // candidate_artist
    "", // candidate_album
    "", // normalized_candidate_artist
    "", // normalized_candidate_album
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "0",
    "",
    "",
    "",
    "",
    "", // final_score
    "false",
    csvEscape(reason),
    "", // itunes_track_count
    "", // track_sample
    "0", // track_overlap_score
    "", // matched_tracks
  ].join(",");
}

function emptyRecallExperimentFields(): Pick<
  ItunesAttemptDiag,
  | "recall_experiment_artist_only"
  | "recall_experiment_no_attribute"
  | "recall_experiment_no_entity_filter"
  | "recall_experiment_artist_album"
  | "recall_experiment_broad_search"
> {
  return {
    recall_experiment_artist_only: "",
    recall_experiment_no_attribute: "",
    recall_experiment_no_entity_filter: "",
    recall_experiment_artist_album: "",
    recall_experiment_broad_search: "",
  };
}

function accumulateStrategyRetrievalTotals(diag: ItunesAttemptDiag, totals: Map<string, number>): void {
  const primaryKey =
    diag.fetch_strategy_taxonomy === "artist_album_combined_search_mode"
      ? "artist_album_combined_search_mode"
      : "artist_only";
  totals.set(primaryKey, (totals.get(primaryKey) ?? 0) + diag.raw_api_result_count);
  const addParsed = (key: string, cell: string) => {
    if (!cell.trim()) return;
    const n = Number.parseInt(cell, 10);
    if (!Number.isFinite(n)) return;
    totals.set(key, (totals.get(key) ?? 0) + n);
  };
  addParsed("no_attribute", diag.recall_experiment_no_attribute);
  addParsed("no_entity_filter", diag.recall_experiment_no_entity_filter);
  addParsed("artist_album", diag.recall_experiment_artist_album);
  addParsed("broad_search", diag.recall_experiment_broad_search);
}

const ITUNES_ATTEMPTS_HEADER =
  "billboard_artist,billboard_album,chart_year,normalized_artist,normalized_album,retry_strategy,search_query,candidate_count,raw_api_result_count,http_status,response_content_length,response_content_type,response_headers_summary,transport_taxonomy,transport_layer,transport_fallback_summary,api_query_url,fetch_strategy_taxonomy,recall_experiment_artist_only,recall_experiment_no_attribute,recall_experiment_no_entity_filter,recall_experiment_artist_album,recall_experiment_broad_search,selected_candidate,selected_artist,selected_collection_id,selected_release_date,selected_track_count,selected_primary_genre,selected_collection_type,final_score,accepted,rejection_reason,raw_snapshot_path,raw_snapshot_saved,raw_snapshot_error,elapsed_ms";

const ITUNES_CANDIDATES_HEADER =
  "billboard_artist,billboard_album,candidate_artist,candidate_album,normalized_candidate_artist,normalized_candidate_album,artist_match_score,album_match_score,token_overlap_score,year_distance_score,compilation_penalty,remaster_penalty,tribute_penalty,karaoke_penalty,single_penalty,ep_penalty,release_year_distance,historical_year_distance_score,historical_confidence,historical_penalty_reason,final_score,accepted_for_ranking,rejected_reason,itunes_track_count,track_sample,track_overlap_score,matched_tracks";

async function ensureDiagnosticsCsvFiles(attemptsPath: string, candidatesPath: string): Promise<void> {
  await mkdir(DIAGNOSTICS_ROOT, { recursive: true });
  if (!existsSync(attemptsPath) || statSync(attemptsPath).size === 0) {
    await writeFile(attemptsPath, `${ITUNES_ATTEMPTS_HEADER}\n`, "utf8");
  }
  if (!existsSync(candidatesPath) || statSync(candidatesPath).size === 0) {
    await writeFile(candidatesPath, `${ITUNES_CANDIDATES_HEADER}\n`, "utf8");
  }
}

async function appendDiagnosticsDataLine(filePath: string, line: string): Promise<void> {
  await appendFile(filePath, `${line}\n`, "utf8");
}

function attemptDiagCsvLine(
  diag: ItunesAttemptDiag,
  accepted: boolean,
  rejectionOverride?: RejectionTaxonomy,
): string {
  let rr: string;
  if (rejectionOverride !== undefined) {
    rr = rejectionOverride;
  } else if (accepted) {
    rr = "";
  } else if (diag.prepare_exception) {
    rr = "exception";
  } else {
    rr = diag.match_rejection || "exception";
  }
  return [
    csvEscape(diag.billboard_artist),
    csvEscape(diag.billboard_album),
    diag.chart_year === null ? "" : String(diag.chart_year),
    csvEscape(diag.normalized_artist),
    csvEscape(diag.normalized_album),
    csvEscape(diag.retry_strategy),
    csvEscape(diag.search_query),
    String(diag.candidate_count),
    String(diag.raw_api_result_count),
    String(diag.http_status),
    String(diag.response_content_length),
    csvEscape(diag.response_content_type),
    csvEscape(diag.response_headers_summary),
    csvEscape(diag.transport_taxonomy),
    csvEscape(diag.transport_layer),
    csvEscape(diag.transport_fallback_summary),
    csvEscape(diag.api_query_url),
    csvEscape(diag.fetch_strategy_taxonomy),
    csvEscape(diag.recall_experiment_artist_only),
    csvEscape(diag.recall_experiment_no_attribute),
    csvEscape(diag.recall_experiment_no_entity_filter),
    csvEscape(diag.recall_experiment_artist_album),
    csvEscape(diag.recall_experiment_broad_search),
    csvEscape(diag.selected_candidate),
    csvEscape(diag.selected_artist),
    csvEscape(diag.selected_collection_id),
    csvEscape(diag.selected_release_date),
    csvEscape(diag.selected_track_count),
    csvEscape(diag.selected_primary_genre),
    csvEscape(diag.selected_collection_type),
    csvEscape(diag.final_score),
    accepted ? "true" : "false",
    csvEscape(rr),
    csvEscape(diag.raw_snapshot_path),
    csvEscape(diag.raw_snapshot_saved),
    csvEscape(diag.raw_snapshot_error),
    String(Math.round(diag.elapsed_ms)),
  ].join(",");
}

async function downloadImage(url: string, dest: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "image/*,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`http_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 6000) throw new Error("image_too_small");
  await writeFile(dest, bytes);
}

async function fetchBillboardTaggedAlbumIds(supabase: RetroverseSupabase): Promise<Set<string>> {
  const out = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("retroverse_source_matches")
      .select("retroverse_entity_id")
      .eq("source", BILLBOARD200_SOURCE)
      .eq("retroverse_entity_type", "album")
      .order("retroverse_source_match_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = data ?? [];
    if (rows.length === 0) break;
    for (const r of rows as { retroverse_entity_id: string }[]) {
      out.add(r.retroverse_entity_id);
    }
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

function primaryCoverPathFromMap(artworkByAlbum: Map<string, ArtworkRow[]>, albumId: string): string | null {
  const rows = artworkByAlbum.get(albumId) ?? [];
  if (rows.length === 0) return null;
  const p = pickPrimaryArtwork(rows)!;
  const pathVal = p.canonical_cover_path?.trim();
  return pathVal ? p.canonical_cover_path : null;
}

async function fetchAllRows<T>(
  supabase: RetroverseSupabase,
  table: string,
  columns: string,
  orderColumn: string,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderColumn, { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE_SIZE) break;
  }
  return out;
}

async function fetchArtworkByAlbum(supabase: RetroverseSupabase): Promise<Map<string, ArtworkRow[]>> {
  const rows = await fetchAllRows<ArtworkRow>(
    supabase,
    "retroverse_album_artwork",
    "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, is_primary, artwork_status, canonical_cover_path",
    "retroverse_album_artwork_id",
  );
  const map = new Map<string, ArtworkRow[]>();
  for (const row of rows) {
    map.set(row.retroverse_album_id, [...(map.get(row.retroverse_album_id) ?? []), row]);
  }
  return map;
}

async function nextRvawOrdinal(supabase: RetroverseSupabase): Promise<number> {
  const { data, error } = await supabase.from("retroverse_album_artwork").select("retroverse_album_artwork_id");
  if (error) throw error;
  return (
    Math.max(
      0,
      ...(data ?? []).map((row) => {
        const m = String(row.retroverse_album_artwork_id).match(/^RVAW(\d+)$/);
        return m ? Number.parseInt(m[1], 10) : 0;
      }),
    ) + 1
  );
}

async function runPool<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = [];
  let idx = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx;
      idx += 1;
      if (i >= items.length) return;
      results[i] = await worker(items[i]!);
    }
  });
  await Promise.all(runners);
  return results;
}


function emptyAudit(original: string): QueryAudit {
  return {
    query_original: original,
    artist_query_used: "",
    artist_retry_level: "",
    candidate_count: 0,
    matched_title: "",
    normalized_local_album: "",
    normalized_matched_album: "",
  };
}

function formatAuditCsv(audit: QueryAudit | undefined): string {
  const a = audit ?? emptyAudit("");
  return [
    csvEscape(a.query_original),
    csvEscape(a.artist_query_used),
    csvEscape(a.artist_retry_level),
    String(a.candidate_count),
    csvEscape(a.matched_title),
    csvEscape(a.normalized_local_album),
    csvEscape(a.normalized_matched_album),
  ].join(",");
}

function mergeRecallSnapshotForDiag(
  snap: Awaited<ReturnType<typeof runRecallExperiments>> | null,
): Pick<
  ItunesAttemptDiag,
  | "recall_experiment_artist_only"
  | "recall_experiment_no_attribute"
  | "recall_experiment_no_entity_filter"
  | "recall_experiment_artist_album"
  | "recall_experiment_broad_search"
> {
  if (!snap) return emptyRecallExperimentFields();
  return snap;
}

function rawSnapshotCsvFields(paths: string[], errors: string[]): Pick<
  ItunesAttemptDiag,
  "raw_snapshot_path" | "raw_snapshot_saved" | "raw_snapshot_error"
> {
  return {
    raw_snapshot_path: paths.join(";"),
    raw_snapshot_saved: paths.length > 0 ? "true" : "false",
    raw_snapshot_error: errors.join(" | "),
  };
}

async function prepareOne(
  album: AlbumRow,
  artistName: string,
  stagingDir: string,
  runId: string,
): Promise<Prepared> {
  const t0 = performance.now();
  const rawArtist = artistName.trim();
  const rawAlbum = album.canonical_album_title.trim();
  const queryOriginal = `${rawArtist} ${rawAlbum}`.replace(/\s+/g, " ").trim();
  const localNormKey = normalizedAlbumComparisonKey(rawAlbum);
  const normalizedArtistKey = normalizeArtistForItunesQuery(rawArtist);
  const combinedTerm = `${normalizeArtistForItunesQuery(rawArtist)} ${normalizeAlbumForItunesQuery(rawAlbum)}`
    .replace(/\s+/g, " ")
    .trim();
  const artistAttempts = buildArtistSearchAttempts(rawArtist);
  const useCombinedPrimary = needsArtistAlbumCombinedSearchMode(rawArtist);
  type PrimaryAttempt = { level: string; query: string; fetchStrategy: FetchStrategyTaxonomy };
  const isForceTarget =
    FORCE_REVIEW_PAIR != null &&
    rawArtist === FORCE_REVIEW_PAIR.artist &&
    rawAlbum === FORCE_REVIEW_PAIR.album;
  const calibrationStrategy = isForceTarget ? CALIBRATION_STRATEGY : null;
  let skipArtistPoolFilter = false;
  const overrideQuery =
    isForceTarget && process.env.ITUNES_FILL_OVERRIDE_QUERY
      ? process.env.ITUNES_FILL_OVERRIDE_QUERY.trim()
      : "";
  let primaryAttempts: PrimaryAttempt[];
  if (overrideQuery) {
    primaryAttempts = [{ level: "MAN", query: overrideQuery, fetchStrategy: "broad_search" }];
  } else if (calibrationStrategy === "artist_only") {
    const ao = buildArtistSearchAttempts(rawArtist)[0];
    primaryAttempts = [{ level: "CAL-AO", query: ao?.query ?? rawArtist, fetchStrategy: "artist_only" }];
  } else if (calibrationStrategy === "artist_album") {
    primaryAttempts = [{ level: "CAL-A+A", query: combinedTerm, fetchStrategy: "artist_album_combined_search_mode" }];
  } else if (calibrationStrategy === "broad_search") {
    primaryAttempts = [{ level: "CAL-BR", query: combinedTerm, fetchStrategy: "broad_search" }];
  } else if (calibrationStrategy === "loose_match") {
    primaryAttempts = [{ level: "CAL-LS", query: combinedTerm, fetchStrategy: "no_attribute" }];
    skipArtistPoolFilter = true;
  } else if (calibrationStrategy === "title_only") {
    primaryAttempts = [
      {
        level: "CAL-TO",
        query: normalizeAlbumForItunesQuery(rawAlbum),
        fetchStrategy: "no_attribute",
      },
    ];
    skipArtistPoolFilter = true;
  } else if (calibrationStrategy === "ignore_year") {
    const albumNoYear = rawAlbum.replace(/\b(19|20)\d{2}\b/g, " ").replace(/\s+/g, " ").trim();
    const combinedNoYear = `${normalizeArtistForItunesQuery(rawArtist)} ${normalizeAlbumForItunesQuery(albumNoYear)}`
      .replace(/\s+/g, " ")
      .trim();
    primaryAttempts = [{ level: "CAL-IY", query: combinedNoYear, fetchStrategy: "broad_search" }];
  } else {
    primaryAttempts = useCombinedPrimary
      ? [{ level: "AB", query: combinedTerm, fetchStrategy: "artist_album_combined_search_mode" }]
      : artistAttempts.map((a) => ({ level: a.level, query: a.query, fetchStrategy: "artist_only" as const }));
  }
  let lastAudit: QueryAudit = {
    ...emptyAudit(queryOriginal),
    normalized_local_album: localNormKey,
  };

  const allCandidateLines: string[] = [];
  let lastEvaluations: CatalogEvaluation[] = [];
  let lastRanked: Array<{ raw: SearchResult; scored: Scored }> = [];
  let lastBest: { raw: SearchResult; scored: Scored } | null = null;
  let lastResultsLen = 0;
  let lastLevel = "";
  let lastQuery = "";
  let lastFetchStrategy: FetchStrategyTaxonomy = "artist_only";
  let lastTransportDiag = emptyTransportDiag();
  let recallSnapshot: Awaited<ReturnType<typeof runRecallExperiments>> | null = null;
  const rawSnapshotPaths: string[] = [];
  const rawSnapshotErrors: string[] = [];

  const maybeSaveRaw = async (
    f: ItunesTransportResult,
    strategy: FetchStrategyTaxonomy,
    queryTerm: string,
  ): Promise<void> => {
    if (f.transportTaxonomy !== "transport_ok" || f.rawResponseBodyText == null) return;
    const res = await saveItunesRawSnapshot({
      workspaceRoot: WORKSPACE_ROOT,
      runId,
      requestUrl: f.url,
      searchStrategy: strategy,
      queryTerm,
      billboardArtist: rawArtist,
      billboardAlbum: rawAlbum,
      chartYear: album.release_year,
      httpStatus: f.httpStatus,
      resultCount: f.rawResultCount,
      responseContentLength: f.responseContentLength,
      transportLayer: f.transportLayer,
      transportTaxonomy: f.transportTaxonomy,
      rawBodyText: f.rawResponseBodyText,
    });
    if (res.ok) rawSnapshotPaths.push(res.relRawPath);
    else rawSnapshotErrors.push(res.error);
  };

  try {
    for (const { level, query, fetchStrategy } of primaryAttempts) {
      const primaryUrl = buildItunesSearchUrl({
        term: query,
        limit: ARTIST_CATALOG_LIMIT,
        strategy: fetchStrategy,
      });
      if (LOG_API_URLS || RECALL_EXPERIMENTS) {
        console.log(`itunes_api_fetch fetch_strategy_taxonomy=${fetchStrategy} url=${primaryUrl}`);
      }
      if (REQUEST_DELAY_MS) await sleep(REQUEST_DELAY_MS);
      const fetched = await fetchItunesSearchWithTransport(primaryUrl, REQUEST_TIMEOUT_MS);
      await maybeSaveRaw(fetched, fetchStrategy, query);
      lastTransportDiag = transportDiagFromFetch(fetched);

      const results = extractAlbumCandidatesFromItunesResults(fetched.results) as SearchResult[];

      if (RECALL_EXPERIMENTS && fetched.results.length === 0 && !recallSnapshot) {
        recallSnapshot = await runRecallExperiments({
          artistTerm: useCombinedPrimary ? normalizeArtistForItunesQuery(rawArtist) : query,
          combinedTerm,
          limit: ARTIST_CATALOG_LIMIT,
          saveRaw: maybeSaveRaw,
        });
      }

      if (fetched.results.length === 0) {
        allCandidateLines.push(emptyCandidatePoolCsvLine(rawArtist, rawAlbum, "no_api_results"));
      }

      let pool = results;
      const skipArtistFilter = Boolean(overrideQuery) || skipArtistPoolFilter;
      if (!useCombinedPrimary && !skipArtistFilter) {
        const filtered = results.filter((r) => artistLikelyMatch(artistName, r.artistName ?? ""));
        pool = filtered.length > 0 ? filtered : results;
      }

      const { evaluations, ranked } = rankEvaluatedCatalogCandidates(
        pool,
        artistName,
        rawAlbum,
        localNormKey,
        album.release_year,
      );
      for (const ev of evaluations) {
        allCandidateLines.push(candidateCsvLine(rawArtist, rawAlbum, ev));
      }

      const best = ranked[0] ?? null;
      const matchedNorm = best ? normalizedAlbumComparisonKey(best.raw.collectionName ?? "") : "";
      const matchedTitle = best?.raw.collectionName?.trim() ?? "";

      lastEvaluations = evaluations;
      lastRanked = ranked;
      lastBest = best;
      lastResultsLen = results.length;
      lastLevel = level;
      lastQuery = query;
      lastFetchStrategy = fetchStrategy;

      lastAudit = {
        query_original: queryOriginal,
        artist_query_used: query,
        artist_retry_level: level,
        candidate_count: results.length,
        matched_title: matchedTitle,
        normalized_local_album: localNormKey,
        normalized_matched_album: matchedNorm,
      };

      if (best && best.scored.score >= MIN_SCORE) {
        const filename = `${album.retroverse_album_id}__${slugify(artistName)}__${slugify(album.canonical_album_title)}.jpg`;
        const tmpPath = path.join(stagingDir, filename);
        await downloadImage(best.scored.artwork_url, tmpPath);
        const deployRel = `public/retroverse/covers/${album.retroverse_album_id}/${filename}`;
        const verified = isVerifiedMatch(best.scored);
        if (process.env.ITUNES_FILL_LOG_QUERY_HITS === "1") {
          console.log(
            `itunes_catalog_hit album=${album.retroverse_album_id} level=${level} artist_q=${JSON.stringify(query)} candidates=${results.length} matched=${JSON.stringify(matchedTitle)} norm_local=${JSON.stringify(localNormKey)} norm_hit=${JSON.stringify(matchedNorm)} score=${best.scored.score}`,
          );
        }
        const elapsed_ms = performance.now() - t0;
        const recallFields = mergeRecallSnapshotForDiag(recallSnapshot);
        const rawSnapFields = rawSnapshotCsvFields(rawSnapshotPaths, rawSnapshotErrors);
        const itunesDiag: ItunesAttemptDiag = {
          billboard_artist: rawArtist,
          billboard_album: rawAlbum,
          chart_year: album.release_year,
          normalized_artist: normalizedArtistKey,
          normalized_album: localNormKey,
          retry_strategy: level,
          search_query: query,
          candidate_count: results.length,
          ...transportDiagFromFetch(fetched),
          fetch_strategy_taxonomy: fetchStrategy,
          ...recallFields,
          ...rawSnapFields,
          selected_candidate: matchedTitle,
          selected_artist: best.raw.artistName?.trim() ?? "",
          selected_collection_id: best.raw.collectionId != null ? String(best.raw.collectionId) : "",
          selected_release_date: best.raw.releaseDate ?? "",
          selected_track_count: best.raw.trackCount != null ? String(best.raw.trackCount) : "",
          selected_primary_genre: best.raw.primaryGenreName ?? "",
          selected_collection_type: best.raw.collectionType ?? "",
          final_score: String(best.scored.score),
          elapsed_ms,
          candidate_csv_lines: allCandidateLines,
          results_len: lastResultsLen,
          ranked: lastRanked,
          best,
          match_rejection: "",
        };
        return { album, artistName, scored: best.scored, tmpPath, deployRel, verified, audit: lastAudit, itunesDiag };
      }
    }

    const elapsed_ms = performance.now() - t0;
    const match_rejection = classifyMatchRejection({
      resultsLen: lastResultsLen,
      evaluations: lastEvaluations,
      ranked: lastRanked,
      best: lastBest,
    });

    const recallFields = mergeRecallSnapshotForDiag(recallSnapshot);
    const rawSnapFields = rawSnapshotCsvFields(rawSnapshotPaths, rawSnapshotErrors);
    const itunesDiag: ItunesAttemptDiag = {
      billboard_artist: rawArtist,
      billboard_album: rawAlbum,
      chart_year: album.release_year,
      normalized_artist: normalizedArtistKey,
      normalized_album: localNormKey,
      retry_strategy: lastLevel,
      search_query: lastQuery,
      candidate_count: lastResultsLen,
      ...lastTransportDiag,
      fetch_strategy_taxonomy: lastFetchStrategy,
      ...recallFields,
      ...rawSnapFields,
      selected_candidate: lastBest?.raw.collectionName?.trim() ?? "",
      selected_artist: lastBest?.raw.artistName?.trim() ?? "",
      selected_collection_id: lastBest?.raw.collectionId != null ? String(lastBest.raw.collectionId) : "",
      selected_release_date: lastBest?.raw.releaseDate ?? "",
      selected_track_count: lastBest?.raw.trackCount != null ? String(lastBest.raw.trackCount) : "",
      selected_primary_genre: lastBest?.raw.primaryGenreName ?? "",
      selected_collection_type: lastBest?.raw.collectionType ?? "",
      final_score: lastBest ? String(lastBest.scored.score) : "",
      elapsed_ms,
      candidate_csv_lines: allCandidateLines,
      results_len: lastResultsLen,
      ranked: lastRanked,
      best: lastBest,
      match_rejection,
    };

    return { album, artistName, error: `no_catalog_hit:${match_rejection}`, audit: lastAudit, itunesDiag };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const elapsed_ms = performance.now() - t0;
    const recallFields = mergeRecallSnapshotForDiag(recallSnapshot);
    const rawSnapFields = rawSnapshotCsvFields(rawSnapshotPaths, rawSnapshotErrors);
    const itunesDiag: ItunesAttemptDiag = {
      billboard_artist: rawArtist,
      billboard_album: rawAlbum,
      chart_year: album.release_year,
      normalized_artist: normalizedArtistKey,
      normalized_album: localNormKey,
      retry_strategy: lastLevel,
      search_query: lastQuery,
      candidate_count: lastResultsLen,
      ...lastTransportDiag,
      fetch_strategy_taxonomy: lastFetchStrategy,
      ...recallFields,
      ...rawSnapFields,
      selected_candidate: lastBest?.raw.collectionName?.trim() ?? "",
      selected_artist: lastBest?.raw.artistName?.trim() ?? "",
      selected_collection_id: lastBest?.raw.collectionId != null ? String(lastBest.raw.collectionId) : "",
      selected_release_date: lastBest?.raw.releaseDate ?? "",
      selected_track_count: lastBest?.raw.trackCount != null ? String(lastBest.raw.trackCount) : "",
      selected_primary_genre: lastBest?.raw.primaryGenreName ?? "",
      selected_collection_type: lastBest?.raw.collectionType ?? "",
      final_score: lastBest ? String(lastBest.scored.score) : "",
      elapsed_ms,
      candidate_csv_lines: allCandidateLines,
      results_len: lastResultsLen,
      ranked: lastRanked,
      best: lastBest,
      match_rejection: "exception",
      prepare_exception: msg,
    };
    return {
      album,
      artistName,
      error: msg,
      audit: { ...lastAudit, query_original: queryOriginal, normalized_local_album: localNormKey },
      itunesDiag,
    };
  }
}

async function appendCsv(logPath: string, line: string, wroteHeader: { v: boolean }) {
  if (!wroteHeader.v) {
    const header = [
      "ts_iso",
      "retroverse_album_id",
      "artist",
      "album",
      "outcome",
      "artwork_status",
      "score",
      "artist_score",
      "title_score",
      "canonical_cover_path",
      "itunes_query_original",
      "artist_query_used",
      "artist_retry_level",
      "catalog_candidate_count",
      "itunes_matched_album",
      "normalized_local_album",
      "normalized_matched_album",
      "notes",
    ].join(",");
    await appendFile(logPath, `${header}\n`, "utf8");
    wroteHeader.v = true;
  }
  await appendFile(logPath, line, "utf8");
}

async function flushItunesRunDiagnostics(args: {
  itunesDiag: ItunesAttemptDiag;
  attemptsPath: string;
  candidatesPath: string;
  accepted: boolean;
  rejectionOverride?: RejectionTaxonomy;
}) {
  const { itunesDiag, attemptsPath, candidatesPath, accepted, rejectionOverride } = args;
  for (const line of itunesDiag.candidate_csv_lines) {
    await appendDiagnosticsDataLine(candidatesPath, line);
  }
  await appendDiagnosticsDataLine(attemptsPath, attemptDiagCsvLine(itunesDiag, accepted, rejectionOverride));
}

async function main() {
  const runId = new Date().toISOString().replace(/[:.]/g, "-");
  const stagingDir = path.join(LOG_ROOT, `staging_${runId}`);
  const logPath = path.join(LOG_ROOT, `run_${runId}.csv`);
  const attemptsPath = path.join(DIAGNOSTICS_ROOT, ITUNES_ATTEMPTS_CSV_NAME);
  const candidatesPath = path.join(DIAGNOSTICS_ROOT, ITUNES_CANDIDATES_CSV_NAME);

  await mkdir(stagingDir, { recursive: true });
  await mkdir(LOG_ROOT, { recursive: true });
  await ensureDiagnosticsCsvFiles(attemptsPath, candidatesPath);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const billboardScope = FILL_SCOPE === "billboard200" || FILL_SCOPE === "billboard";
  const billboardAlbumIds = billboardScope ? await fetchBillboardTaggedAlbumIds(supabase) : null;

  const [albums, artists] = await Promise.all([
    fetchAllRows<AlbumRow>(
      supabase,
      "retroverse_albums",
      "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, album_type, notes",
      "retroverse_album_id",
    ),
    fetchAllRows<ArtistRow>(
      supabase,
      "retroverse_artists",
      "retroverse_artist_id, canonical_artist_name",
      "retroverse_artist_id",
    ),
  ]);

  const artistById = new Map(artists.map((a) => [a.retroverse_artist_id, a.canonical_artist_name]));

  const artworkByAlbum = await fetchArtworkByAlbum(supabase);

  let needsArtworkRaw = 0;
  let excludedSynthetic = 0;
  const excludedBy = { title: 0, notes: 0 };

  let skippedNotBillboardTagged = 0;

  const work: Array<{ album: AlbumRow; artist: string }> = [];
  for (const album of albums) {
    const rows = artworkByAlbum.get(album.retroverse_album_id) ?? [];
    const canonArtist = (artistById.get(album.retroverse_artist_id) ?? "").trim();
    const canonAlbum = album.canonical_album_title.trim();
    const forceThis =
      FORCE_REVIEW_PAIR != null &&
      canonArtist === FORCE_REVIEW_PAIR.artist &&
      canonAlbum === FORCE_REVIEW_PAIR.album;
    if (!albumNeedsArtwork(rows) && !forceThis) continue;
    if (billboardAlbumIds && !billboardAlbumIds.has(album.retroverse_album_id)) {
      skippedNotBillboardTagged += 1;
      continue;
    }
    needsArtworkRaw += 1;
    const ex = exclusionForItunesFill(album);
    if (ex) {
      excludedSynthetic += 1;
      excludedBy[ex.kind] += 1;
      continue;
    }
    work.push({
      album,
      artist: artistById.get(album.retroverse_artist_id) ?? "Unknown artist",
    });
  }

  const estimatedHistoricalPool = work.length;
  const toProcess = RUN_LIMIT > 0 ? work.slice(0, RUN_LIMIT) : work;
  let nextOrdinal = await nextRvawOrdinal(supabase);

  console.log(
    `itunes_fill_queue scope=${FILL_SCOPE}${billboardAlbumIds ? ` billboard_tagged_albums=${billboardAlbumIds.size} skipped_not_billboard_tagged=${skippedNotBillboardTagged}` : ""} corpus_albums=${albums.length} needs_artwork_in_scope=${needsArtworkRaw} excluded_synthetic=${excludedSynthetic} excluded_by_title=${excludedBy.title} excluded_by_notes=${excludedBy.notes} queued_real_albums=${estimatedHistoricalPool}`,
  );
  console.log(
    `itunes_fill_start run=${runId} scope=${FILL_SCOPE} will_process=${toProcess.length} estimated_historical_acquisition_pool=${estimatedHistoricalPool}${RUN_LIMIT > 0 ? ` (this_run_capped_by_ITUNES_FILL_LIMIT=${RUN_LIMIT})` : ""} concurrency=${CONCURRENCY} min_score=${MIN_SCORE} verify_score=${VERIFY_SCORE}`,
  );
  console.log(`diagnostics_dir=${DIAGNOSTICS_ROOT}`);
  console.log(`raw_itunes_root=${RAW_ITUNES_ROOT}`);
  console.log(`diagnostics_attempts_csv=${attemptsPath}`);
  console.log(`diagnostics_candidates_csv=${candidatesPath}`);
  console.log(`staging_dir=${stagingDir}`);
  console.log(`ops_incremental_csv=${logPath}`);
  console.log(`diag_summary_every=${DIAG_SUMMARY_EVERY} (env ITUNES_FILL_DIAG_SUMMARY_EVERY)`);
  console.log(
    `itunes_api_recall_experiments=${RECALL_EXPERIMENTS ? "1" : "0"} (env ITUNES_FILL_RECALL_EXPERIMENTS=1 to enable)`,
  );
  console.log(`itunes_log_api_urls=${LOG_API_URLS ? "1" : "0"} (env ITUNES_FILL_LOG_API_URLS=1; primary+recall URLs also log when ITUNES_FILL_RECALL_EXPERIMENTS=1)`);

  const started = performance.now();
  let processed = 0;
  let verified = 0;
  let pending = 0;
  let failed = 0;
  const wroteHeader = { v: false };
  let sumCandidateCounts = 0;
  let sumWinningScores = 0;
  let winningScoreN = 0;
  const rejectionReasonCounts = new Map<string, number>();
  const strategyRetrievalTotals = new Map<string, number>();
  const TRANSPORT_403_LOG_EVERY = 25;
  let transport403AlbumAttempts = 0;
  let catalogEmptyOkTransport = 0;

  for (let offset = 0; offset < toProcess.length; offset += CONCURRENCY) {
    const slice = toProcess.slice(offset, offset + CONCURRENCY);
    const prepared = await runPool(slice, CONCURRENCY, (item) =>
      prepareOne(item.album, item.artist, stagingDir, runId),
    );

    const ts = new Date().toISOString();
    for (const p of prepared) {
      processed += 1;
      if ("error" in p) {
        failed += 1;
        sumCandidateCounts += p.itunesDiag.candidate_count;
        await appendCsv(
          logPath,
          `${csvEscape(ts)},${csvEscape(p.album.retroverse_album_id)},${csvEscape(p.artistName)},${csvEscape(p.album.canonical_album_title)},failed,,,,,${formatAuditCsv(p.audit)},${csvEscape(p.error)}\n`,
          wroteHeader,
        );
        await flushItunesRunDiagnostics({
          itunesDiag: p.itunesDiag,
          attemptsPath,
          candidatesPath,
          accepted: false,
        });
        accumulateStrategyRetrievalTotals(p.itunesDiag, strategyRetrievalTotals);
        const rej = p.itunesDiag.prepare_exception ? "exception" : p.itunesDiag.match_rejection || "exception";
        rejectionReasonCounts.set(rej, (rejectionReasonCounts.get(rej) ?? 0) + 1);
      } else {
        sumCandidateCounts += p.itunesDiag.candidate_count;
        const deployAbs = path.join(WORKSPACE_ROOT, p.deployRel);
        await mkdir(path.dirname(deployAbs), { recursive: true });
        await copyFile(p.tmpPath, deployAbs);

        const statusDb = p.verified ? "verified" : "pending";

        const notes = `itunes_catalog_autofill score=${p.scored.score} reasons=${p.scored.reasons.join("|")} artist_retry=${p.audit.artist_retry_level} candidates=${p.audit.candidate_count}`;
        const rows = artworkByAlbum.get(p.album.retroverse_album_id) ?? [];
        const target =
          rows.find((r) => r.is_primary) ?? rows.find((r) => r.artwork_role === "primary") ?? rows[0];

        let dbOk = false;
        if (target?.retroverse_album_artwork_id) {
          const { error } = await supabase
            .from("retroverse_album_artwork")
            .update({
              canonical_cover_path: p.deployRel,
              cover_source: "itunes_autofill",
              artwork_status: statusDb,
              artwork_role: "primary",
              is_primary: true,
              notes,
            })
            .eq("retroverse_album_artwork_id", target.retroverse_album_artwork_id);
          if (error) {
            failed += 1;
            await appendCsv(
              logPath,
              `${csvEscape(ts)},${csvEscape(p.album.retroverse_album_id)},${csvEscape(p.artistName)},${csvEscape(p.album.canonical_album_title)},failed,${csvEscape(statusDb)},${String(p.scored.score)},${String(p.scored.artist_score)},${String(p.scored.title_score)},${csvEscape(p.deployRel)},${formatAuditCsv(p.audit)},${csvEscape(`db_update:${error.message}`)}\n`,
              wroteHeader,
            );
            await flushItunesRunDiagnostics({
              itunesDiag: p.itunesDiag,
              attemptsPath,
              candidatesPath,
              accepted: false,
              rejectionOverride: "db_persist_failed",
            });
            accumulateStrategyRetrievalTotals(p.itunesDiag, strategyRetrievalTotals);
            rejectionReasonCounts.set(
              "db_persist_failed",
              (rejectionReasonCounts.get("db_persist_failed") ?? 0) + 1,
            );
          } else {
            dbOk = true;
            artworkByAlbum.set(
              p.album.retroverse_album_id,
              rows.map((r) =>
                r.retroverse_album_artwork_id === target.retroverse_album_artwork_id
                  ? {
                      ...r,
                      canonical_cover_path: p.deployRel,
                      artwork_status: statusDb,
                      is_primary: true,
                      artwork_role: "primary",
                    }
                  : r,
              ),
            );
          }
        } else {
          const newId = `RVAW${String(nextOrdinal).padStart(6, "0")}`;
          nextOrdinal += 1;
          const { error } = await supabase.from("retroverse_album_artwork").insert({
            retroverse_album_artwork_id: newId,
            retroverse_album_id: p.album.retroverse_album_id,
            retroverse_album_edition_id: null,
            artwork_role: "primary",
            is_primary: true,
            canonical_cover_path: p.deployRel,
            cover_source: "itunes_autofill",
            artwork_status: statusDb,
            width_px: null,
            height_px: null,
            notes,
          });
          if (error) {
            failed += 1;
            nextOrdinal -= 1;
            await appendCsv(
              logPath,
              `${csvEscape(ts)},${csvEscape(p.album.retroverse_album_id)},${csvEscape(p.artistName)},${csvEscape(p.album.canonical_album_title)},failed,${csvEscape(statusDb)},${String(p.scored.score)},${String(p.scored.artist_score)},${String(p.scored.title_score)},${csvEscape(p.deployRel)},${formatAuditCsv(p.audit)},${csvEscape(`db_insert:${error.message}`)}\n`,
              wroteHeader,
            );
            await flushItunesRunDiagnostics({
              itunesDiag: p.itunesDiag,
              attemptsPath,
              candidatesPath,
              accepted: false,
              rejectionOverride: "db_persist_failed",
            });
            accumulateStrategyRetrievalTotals(p.itunesDiag, strategyRetrievalTotals);
            rejectionReasonCounts.set(
              "db_persist_failed",
              (rejectionReasonCounts.get("db_persist_failed") ?? 0) + 1,
            );
          } else {
            dbOk = true;
            artworkByAlbum.set(p.album.retroverse_album_id, [
              ...rows,
              {
                retroverse_album_artwork_id: newId,
                retroverse_album_id: p.album.retroverse_album_id,
                retroverse_album_edition_id: null,
                artwork_role: "primary",
                is_primary: true,
                artwork_status: statusDb,
                canonical_cover_path: p.deployRel,
              },
            ]);
          }
        }

        if (dbOk) {
          if (p.verified) verified += 1;
          else pending += 1;
          await appendCsv(
            logPath,
            `${csvEscape(ts)},${csvEscape(p.album.retroverse_album_id)},${csvEscape(p.artistName)},${csvEscape(p.album.canonical_album_title)},ok,${csvEscape(statusDb)},${String(p.scored.score)},${String(p.scored.artist_score)},${String(p.scored.title_score)},${csvEscape(p.deployRel)},${formatAuditCsv(p.audit)},${csvEscape(notes)}\n`,
            wroteHeader,
          );
          await flushItunesRunDiagnostics({
            itunesDiag: p.itunesDiag,
            attemptsPath,
            candidatesPath,
            accepted: true,
          });
          accumulateStrategyRetrievalTotals(p.itunesDiag, strategyRetrievalTotals);
          sumWinningScores += p.scored.score;
          winningScoreN += 1;
        }
      }

      {
        const d = p.itunesDiag;
        if (d.transport_taxonomy === "transport_403") {
          transport403AlbumAttempts += 1;
          if (transport403AlbumAttempts % TRANSPORT_403_LOG_EVERY === 0) {
            console.warn(
              `itunes_transport_403_checkpoint albums_with_403_transport=${transport403AlbumAttempts} processed=${processed} sample_status=${d.http_status} sample_fallback=${d.transport_fallback_summary.slice(0, 220)}`,
            );
          }
        }
        if (d.transport_taxonomy === "transport_ok" && d.candidate_count === 0) {
          catalogEmptyOkTransport += 1;
        }
      }

      if (processed % PROGRESS_EVERY === 0 || processed === toProcess.length) {
        const elapsed = (performance.now() - started) / 1000;
        const rate = processed / Math.max(elapsed, 1e-6);
        const remaining = toProcess.length - processed;
        const etaSec = rate > 0 ? remaining / rate : 0;
        console.log(
          `itunes_fill_progress processed=${processed}/${toProcess.length} verified=${verified} pending=${pending} failed=${failed} throughput_per_s=${rate.toFixed(2)} eta_sec≈${Math.round(etaSec)}`,
        );
      }

      if (processed % DIAG_SUMMARY_EVERY === 0 || processed === toProcess.length) {
        if (processed > 0) {
          const verifiedPct = (100 * verified) / processed;
          const failPct = (100 * failed) / processed;
          const avgCand = sumCandidateCounts / processed;
          const avgWinScore = winningScoreN > 0 ? sumWinningScores / winningScoreN : 0;
          const topReject = [...rejectionReasonCounts.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
          const topStrategies = [...strategyRetrievalTotals.entries()]
            .sort((a, b) => b[1] - a[1])
            .slice(0, 5)
            .map(([k, v]) => `${k}=${v}`)
            .join(" ");
          const t403Pct = (100 * transport403AlbumAttempts) / processed;
          const emptyOkPct = (100 * catalogEmptyOkTransport) / processed;
          console.log(
            `itunes_fill_diag_summary processed=${processed} verified_pct=${verifiedPct.toFixed(1)} failure_pct=${failPct.toFixed(1)} transport_403_album_pct=${t403Pct.toFixed(1)} catalog_empty_http_ok_pct=${emptyOkPct.toFixed(1)} avg_api_candidate_count=${avgCand.toFixed(1)} avg_winning_candidate_score=${avgWinScore.toFixed(3)} top_rejection_reasons=[${topReject}] top_strategies_by_api_result_count=[${topStrategies}]`,
          );
        }
      }
    }
  }

  const elapsed = (performance.now() - started) / 1000;
  const topStrategiesFinal = [...strategyRetrievalTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([k, v]) => `${k}=${v}`)
    .join(" ");
  console.log(
    `itunes_fill_done processed=${processed} verified=${verified} pending=${pending} failed=${failed} elapsed_sec=${elapsed.toFixed(1)} ops_csv=${logPath} diagnostics_attempts=${attemptsPath} diagnostics_candidates=${candidatesPath} top_strategies_by_api_result_count=[${topStrategiesFinal}]`,
  );

  if (billboardAlbumIds && billboardAlbumIds.size > 0) {
    let withPrimaryPath = 0;
    for (const id of billboardAlbumIds) {
      if (primaryCoverPathFromMap(artworkByAlbum, id)) withPrimaryPath += 1;
    }
    const pct = (100 * withPrimaryPath) / billboardAlbumIds.size;
    console.log(
      `billboard200_artwork_coverage tagged_albums=${billboardAlbumIds.size} primary_cover_path_present=${withPrimaryPath} coverage_pct=${pct.toFixed(2)}`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
