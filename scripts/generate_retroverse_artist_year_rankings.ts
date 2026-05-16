/**
 * Build canonical yearly Retroverse artist rankings (dominance per calendar year).
 *
 * Run: npm run generate:artist-year-rankings
 * Then: npm run report:artist-rank-inspection
 *
 * Requires (preferred): NEXT_PUBLIC_SUPABASE_URL + NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
 * Fallback: retroscope-coordinates.json + album-dossiers.json (spatial album layer only)
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import {
  RETROSCOPE_YEAR_MAX,
  RETROSCOPE_YEAR_MIN,
} from "../lib/album-retroscope-constants";
import {
  applyRetroscopeAlbumSlot,
  createArtistYearRankingBuild,
  feedArtistAlbumChartRow,
  feedArtistTrackChartRow,
  finalizeArtistYearRankings,
} from "../lib/artist-year-ranking-aggregate";
import {
  artistSlugId,
  isGenericArtistBucket,
  resolveArtistIdentityForAlbum,
  type ArtistIdentity,
} from "../lib/artist-identity-resolve";
import { retroverseAlbumChartAppearances } from "../lib/billboard-album-chart-appearance";
import { albumIdFromChartAppearanceRow } from "../lib/chart-appearance-album-id";
import { getAlbumDossiersBundleOrNull } from "../lib/load-album-dossier";
import type { RetroscopeCoordinatesFile } from "../lib/retroscope-coordinates-schema";
import { isHot100ChartName } from "../lib/artist-year-ranking-score";

const WORKSPACE = process.cwd();
const OUT_JSON = path.join(WORKSPACE, "public", "data", "artists", "retroverse-artist-year-rankings.json");
const TOP_N = 200;
const CHART_PAGE = 1000;

type ChartRow = {
  chart_date: string;
  chart_name: string;
  chart_position: number;
  weeks_on_chart: number | null;
  retroverse_album_id?: string | null;
  retroverse_track_id?: string | null;
  retroverse_tracks?:
    | { retroverse_album_id?: string | null; retroverse_track_id?: string | null }
    | Array<{ retroverse_album_id?: string | null; retroverse_track_id?: string | null }>
    | null;
};

function loadEnvLocal() {
  try {
    const raw = readFileSync(path.join(WORKSPACE, ".env.local"), "utf8");
    for (const line of raw.split("\n")) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const eq = t.indexOf("=");
      if (eq <= 0) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (process.env[k] === undefined) process.env[k] = v;
    }
  } catch {
    /* optional */
  }
}

function calendarYear(chartDate: string): number | null {
  const y = Number.parseInt(String(chartDate).slice(0, 4), 10);
  return Number.isFinite(y) ? y : null;
}

function chunk<T>(xs: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

function loadRetroscopeCoordinates(): RetroscopeCoordinatesFile | null {
  const envPath = process.env.ALBUM_RETROSCOPE_COORDINATES_PATH?.trim();
  const fromRoot = process.env.RETROVERSE_DATA_ROOT?.trim()
    ? path.join(process.env.RETROVERSE_DATA_ROOT!.trim(), "runtime", "retroscope-coordinates.json")
    : "";
  const publicBundled = path.join(WORKSPACE, "public", "data", "retroscope", "retroscope-coordinates.json");
  for (const p of [envPath, fromRoot, publicBundled]) {
    if (!p) continue;
    try {
      const parsed = JSON.parse(readFileSync(p, "utf8")) as RetroscopeCoordinatesFile;
      if (parsed?.cells?.length) return parsed;
    } catch {
      /* try next */
    }
  }
  return null;
}

function seedFromRetroscopeCoordinates(
  build: ReturnType<typeof createArtistYearRankingBuild>,
  coords: RetroscopeCoordinatesFile,
  albumArtist: Map<string, ArtistIdentity>,
  nameIndex: Map<string, ArtistIdentity>,
): Set<number> {
  const years = new Set<number>();
  for (const cell of coords.cells) {
    const year = cell.chartYear;
    if (!Number.isFinite(year)) continue;
    years.add(year);
    const albumId = cell.albumId?.trim().toUpperCase();
    if (!albumId) continue;
    let artist = albumArtist.get(albumId);
    if (!artist) {
      artist = resolveArtistIdentityForAlbum(albumId, cell.artist) ?? undefined;
      if (!artist) continue;
      nameIndex.set(artistSlugId(artist.artist_name), artist);
      albumArtist.set(albumId, artist);
    }
    applyRetroscopeAlbumSlot(build, year, artist, albumId, cell.chartRank);
  }
  return years;
}

function seedFromDossiers(
  albumArtist: Map<string, ArtistIdentity>,
  nameIndex: Map<string, ArtistIdentity>,
): void {
  const bundle = getAlbumDossiersBundleOrNull();
  if (!bundle) return;
  for (const d of Object.values(bundle.dossiers)) {
    const albumId = d.albumId?.trim().toUpperCase();
    if (!albumId) continue;
    if (albumArtist.has(albumId)) continue;
    const artist = resolveArtistIdentityForAlbum(albumId, d.identity.artist);
    if (!artist) continue;
    nameIndex.set(artistSlugId(artist.artist_name), artist);
    albumArtist.set(albumId, artist);
  }
}

async function loadAlbumArtistMap(supabase: SupabaseClient): Promise<{
  albumArtist: Map<string, ArtistIdentity>;
  nameIndex: Map<string, ArtistIdentity>;
}> {
  const albumArtist = new Map<string, ArtistIdentity>();
  const nameIndex = new Map<string, ArtistIdentity>();

  seedFromDossiers(albumArtist, nameIndex);

  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const part = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
      .range(from, from + pageSize - 1);
    if (part.error) throw new Error(`retroverse_albums: ${part.error.message}`);
    const rows = part.data ?? [];
    if (rows.length === 0) break;

    const artistIds = [
      ...new Set(
        rows
          .map((r) => String((r as { retroverse_artist_id?: string }).retroverse_artist_id ?? "").trim())
          .filter(Boolean),
      ),
    ];
    const artistNameById = new Map<string, string>();
    for (const idChunk of chunk(artistIds, 120)) {
      const ar = await supabase
        .from("retroverse_artists")
        .select("retroverse_artist_id, canonical_artist_name")
        .in("retroverse_artist_id", idChunk);
      if (ar.error) throw new Error(`retroverse_artists: ${ar.error.message}`);
      for (const row of ar.data ?? []) {
        const id = String((row as { retroverse_artist_id: string }).retroverse_artist_id).trim().toUpperCase();
        const name = String((row as { canonical_artist_name?: string }).canonical_artist_name ?? "").trim() || "Unknown artist";
        artistNameById.set(id, name);
        if (!isGenericArtistBucket(name)) {
          nameIndex.set(artistSlugId(name), { artist_id: id, artist_name: name });
        }
      }
    }

    for (const row of rows) {
      const albumId = String((row as { retroverse_album_id: string }).retroverse_album_id).trim().toUpperCase();
      const arId = String((row as { retroverse_artist_id: string }).retroverse_artist_id).trim().toUpperCase();
      const title = String((row as { canonical_album_title?: string }).canonical_album_title ?? "").trim();
      const name = artistNameById.get(arId) ?? (title || "Unknown artist");
      const fromDossier = resolveArtistIdentityForAlbum(albumId, name);
      const ident: ArtistIdentity = fromDossier ?? { artist_id: arId, artist_name: name };
      if (isGenericArtistBucket(ident.artist_name)) continue;
      nameIndex.set(artistSlugId(ident.artist_name), ident);
      albumArtist.set(albumId, ident);
    }

    if (rows.length < pageSize) break;
  }

  return { albumArtist, nameIndex };
}

async function loadTrackArtistMap(
  supabase: SupabaseClient,
  trackIds: string[],
): Promise<Map<string, ArtistIdentity>> {
  const out = new Map<string, ArtistIdentity>();
  for (const idChunk of chunk(trackIds, 120)) {
    const part = await supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id")
      .in("retroverse_track_id", idChunk);
    if (part.error) throw new Error(`retroverse_tracks: ${part.error.message}`);
    const artistIds = [
      ...new Set(
        (part.data ?? []).map((r) =>
          String((r as { retroverse_artist_id?: string }).retroverse_artist_id ?? "").trim().toUpperCase(),
        ),
      ),
    ].filter(Boolean);
    const artistNameById = new Map<string, string>();
    for (const arChunk of chunk(artistIds, 120)) {
      const ar = await supabase
        .from("retroverse_artists")
        .select("retroverse_artist_id, canonical_artist_name")
        .in("retroverse_artist_id", arChunk);
      if (ar.error) throw new Error(`retroverse_artists(track): ${ar.error.message}`);
      for (const row of ar.data ?? []) {
        const id = String((row as { retroverse_artist_id: string }).retroverse_artist_id).trim().toUpperCase();
        const name = String((row as { canonical_artist_name?: string }).canonical_artist_name ?? "").trim() || "Unknown artist";
        artistNameById.set(id, name);
      }
    }
    for (const row of part.data ?? []) {
      const trackId = String((row as { retroverse_track_id: string }).retroverse_track_id).trim().toUpperCase();
      const arId = String((row as { retroverse_artist_id: string }).retroverse_artist_id).trim().toUpperCase();
      const name = artistNameById.get(arId) ?? "Unknown artist";
      if (isGenericArtistBucket(name)) continue;
      out.set(trackId, { artist_id: arId, artist_name: name });
    }
  }
  return out;
}

type PendingTrackRow = {
  year: number;
  trackId: string;
  peak: number;
  weeks: number;
};

async function flushPendingTracks(
  supabase: SupabaseClient,
  build: ReturnType<typeof createArtistYearRankingBuild>,
  pending: PendingTrackRow[],
): Promise<void> {
  if (pending.length === 0) return;
  const ids = [...new Set(pending.map((p) => p.trackId))];
  const trackArtist = await loadTrackArtistMap(supabase, ids);
  for (const row of pending) {
    const artist = trackArtist.get(row.trackId);
    if (!artist) continue;
    feedArtistTrackChartRow(build, row.year, artist, row.trackId, row.peak, row.weeks);
  }
  pending.length = 0;
}

async function ingestSupabaseCharts(
  supabase: SupabaseClient,
  build: ReturnType<typeof createArtistYearRankingBuild>,
  albumArtist: Map<string, ArtistIdentity>,
): Promise<void> {
  const pendingTracks: PendingTrackRow[] = [];

  for (let from = 0; ; from += CHART_PAGE) {
    const part = await supabase
      .from("retroverse_chart_appearances")
      .select(
        "chart_date, chart_name, chart_position, weeks_on_chart, retroverse_album_id, retroverse_track_id, retroverse_tracks(retroverse_album_id, retroverse_track_id)",
      )
      .order("chart_date", { ascending: true })
      .range(from, from + CHART_PAGE - 1);

    if (part.error) throw new Error(`retroverse_chart_appearances: ${part.error.message}`);
    const rows = (part.data ?? []) as unknown as ChartRow[];
    if (rows.length === 0) break;

    for (const row of rows) {
      const year = calendarYear(row.chart_date);
      if (year === null) continue;
      const pos = row.chart_position;
      if (typeof pos !== "number" || !Number.isFinite(pos) || pos <= 0) continue;
      const weeks =
        typeof row.weeks_on_chart === "number" && Number.isFinite(row.weeks_on_chart) && row.weeks_on_chart >= 0
          ? row.weeks_on_chart
          : 0;
      const chartName = row.chart_name ?? "";

      if (retroverseAlbumChartAppearances(chartName)) {
        const albumId = albumIdFromChartAppearanceRow(row);
        if (!albumId) continue;
        const artist = albumArtist.get(albumId);
        if (!artist) continue;
        feedArtistAlbumChartRow(build, year, artist, albumId, pos, weeks);
        continue;
      }

      if (isHot100ChartName(chartName)) {
        const link = Array.isArray(row.retroverse_tracks) ? row.retroverse_tracks[0] : row.retroverse_tracks;
        const trackId = (
          row.retroverse_track_id?.trim().toUpperCase() ||
          link?.retroverse_track_id?.trim().toUpperCase() ||
          ""
        );
        if (!trackId) continue;
        pendingTracks.push({ year, trackId, peak: pos, weeks });
        if (pendingTracks.length >= 8000) {
          await flushPendingTracks(supabase, build, pendingTracks);
        }
      }
    }

    if (rows.length < CHART_PAGE) break;
    if (from > 0 && from % 50_000 === 0) {
      process.stderr.write(`[artist-year-rankings] … chart rows ${from}\n`);
    }
  }

  await flushPendingTracks(supabase, build, pendingTracks);
}

async function main() {
  loadEnvLocal();
  const coords = loadRetroscopeCoordinates();
  if (!coords) {
    throw new Error("retroscope-coordinates.json not found — required for RetroScope year coverage");
  }

  const build = createArtistYearRankingBuild();
  const albumArtist = new Map<string, ArtistIdentity>();
  const nameIndex = new Map<string, ArtistIdentity>();
  seedFromDossiers(albumArtist, nameIndex);
  const retroYears = seedFromRetroscopeCoordinates(build, coords, albumArtist, nameIndex);

  let source = "retroscope-coordinates+dossiers";

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (url && key) {
    try {
      const supabase = createClient(url, key);
      process.stderr.write("[artist-year-rankings] Loading album→artist map from Supabase…\n");
      const maps = await loadAlbumArtistMap(supabase);
      for (const [k, v] of maps.albumArtist) albumArtist.set(k, v);
      for (const [k, v] of maps.nameIndex) nameIndex.set(k, v);
      seedFromRetroscopeCoordinates(build, coords, albumArtist, nameIndex);
      process.stderr.write("[artist-year-rankings] Ingesting chart appearances (album + Hot 100)…\n");
      await ingestSupabaseCharts(supabase, build, albumArtist);
      source = "supabase-charts+retroscope-coordinates+dossiers";
    } catch (e) {
      process.stderr.write(
        `[artist-year-rankings] Supabase ingest failed (${e instanceof Error ? e.message : String(e)}); using RetroScope grid only.\n`,
      );
      source = "retroscope-coordinates+dossiers (supabase-unavailable)";
    }
  } else {
    process.stderr.write("[artist-year-rankings] No Supabase env — RetroScope grid only.\n");
    source = "retroscope-coordinates+dossiers (no-supabase)";
  }

  const yearFilter = (y: number) => y >= RETROSCOPE_YEAR_MIN && y <= RETROSCOPE_YEAR_MAX && retroYears.has(y);

  const artifact = finalizeArtistYearRankings(build, {
    source,
    topNPerYear: TOP_N,
    yearFilter,
  });

  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");

  process.stderr.write(
    `[artist-year-rankings] Wrote ${OUT_JSON} · years=${artifact.years.length} · source=${source}\n`,
  );
  for (const y of [1972, 1977, 1984]) {
    const top = artifact.by_year[String(y)]?.[0];
    process.stderr.write(
      `  ${y} #1: ${top ? `${top.artist_name} (score=${top.peak_momentum_score})` : "(no rows)"}\n`,
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
