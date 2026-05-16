import { readFileSync } from "node:fs";
import path from "node:path";
import { cache } from "react";

import type { RetroscopeCellDTO } from "@/lib/album-retroscope-constants";
import { retroscopeCellKey } from "@/lib/album-retroscope-constants";
import type { ArtistYearRankingsFile } from "@/lib/artist-year-ranking-schema";
import { artistRetroscopeKey } from "@/lib/artist-year-ranking-schema";
import { getArtistUniverseBundle } from "@/lib/load-artist-universe";
import { computeArtistSignalPalette } from "@/lib/artist-signal-palette";
import { retroscopeDatasetCorpusId } from "@/lib/retroscope-persist-session";
import { normalizeEntitySlug } from "@/lib/retroverse-routes";

export type { RetroscopeCellDTO } from "@/lib/album-retroscope-constants";
export {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_GRID_ROWS_MOBILE,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  RETROSCOPE_YEAR_MAX,
  RETROSCOPE_YEAR_MIN,
  retroscopeCellKey,
} from "@/lib/album-retroscope-constants";

let rankingsFileCache: ArtistYearRankingsFile | null | undefined;

function loadRankingsFile(): ArtistYearRankingsFile | null {
  if (rankingsFileCache !== undefined) return rankingsFileCache;

  const env = process.env.ARTIST_YEAR_RANKINGS_PATH?.trim();
  const publicBundled = path.join(
    process.cwd(),
    "public",
    "data",
    "artists",
    "retroverse-artist-year-rankings.json",
  );
  for (const p of [env, publicBundled].filter(Boolean)) {
    try {
      const parsed = JSON.parse(readFileSync(p!, "utf8")) as ArtistYearRankingsFile;
      if (parsed?.version === 1 && parsed.by_year) {
        rankingsFileCache = parsed;
        return rankingsFileCache;
      }
    } catch {
      /* try next */
    }
  }
  rankingsFileCache = null;
  return null;
}

function sortCellsStable(cells: RetroscopeCellDTO[]): RetroscopeCellDTO[] {
  return [...cells].sort((a, b) => {
    if (a.chartYear !== b.chartYear) return a.chartYear - b.chartYear;
    return a.retroverseRank - b.retroverseRank;
  });
}

export type ArtistRetroscopeDataset = {
  cells: RetroscopeCellDTO[];
  initialActiveKey: string;
  corpusId: string;
};

/** Server-only: yearly artist dominance grid (local rankings + universe enrichment). */
async function loadArtistRetroscopeDatasetUncached(): Promise<ArtistRetroscopeDataset | null> {
  const log = "[artist-retroscope:data]";
  const rankings = loadRankingsFile();
  if (!rankings) {
    console.warn(log, "retroverse-artist-year-rankings.json missing");
    return null;
  }

  const universe = getArtistUniverseBundle();
  const cells: RetroscopeCellDTO[] = [];
  const seen = new Set<string>();

  for (const year of rankings.years) {
    for (const row of rankings.by_year[String(year)] ?? []) {
      if (!Number.isFinite(row.year) || !Number.isFinite(row.retroverse_artist_rank)) continue;
      const k = retroscopeCellKey(row.year, row.retroverse_artist_rank);
      if (seen.has(k)) continue;
      seen.add(k);

      const slug =
        universe?.artists_by_id[row.artist_id] ??
        normalizeEntitySlug(row.artist_name);
      const uni = universe?.artists_by_slug[slug];

      const displayName = row.artist_name.trim() || "—";
      const dominantYears = uni?.dominant_years ?? [row.year];
      const palette = computeArtistSignalPalette({
        displayName,
        slug,
        peakMomentumScore: row.peak_momentum_score,
        rankedYearCount: uni?.retroverse_summary.ranked_year_count ?? 1,
        retroverseRank: row.retroverse_artist_rank,
        chartYear: row.year,
        dominantYears,
        activeYearsFirst: uni?.active_years.first ?? row.year,
        activeYearsLast: uni?.active_years.last ?? row.year,
      });
      cells.push({
        chartYear: row.year,
        retroverseRank: row.retroverse_artist_rank,
        entityKind: "artist",
        entityId: row.artist_id,
        albumId: row.artist_id,
        title: displayName,
        artist: artistRetroscopeKey(row.year, row.retroverse_artist_rank),
        releaseYear: row.year,
        canonicalCoverPath: null,
        trustState: "verified",
        sourceNote: rankings.source,
        artistRetroscopeKey: row.artist_retroscope_key,
        artistSlug: slug,
        signalHue: palette.hue,
        signalHueSecondary: palette.hueSecondary,
        signalAccent: palette.accent,
        signalAccentWarm: palette.accentWarm,
        signalBloom: palette.bloom,
        signalDescriptor: palette.descriptor,
        dominantYears,
        peakMomentumScore: row.peak_momentum_score,
        rankedYearCount: uni?.retroverse_summary.ranked_year_count ?? 1,
        activeYearsFirst: uni?.active_years.first ?? row.year,
        activeYearsLast: uni?.active_years.last ?? row.year,
        primaryAlbumTitles: (uni?.primary_albums ?? []).slice(0, 4).map((a) => a.title),
        primaryTrackTitles: (uni?.primary_tracks ?? []).slice(0, 4).map((t) => t.title),
      });
    }
  }

  if (cells.length === 0) {
    console.warn(log, "zero artist cells");
    return null;
  }

  const sorted = sortCellsStable(cells);
  const first = sorted[0]!;
  const initialActiveKey = retroscopeCellKey(first.chartYear, first.retroverseRank);
  const corpusId = retroscopeDatasetCorpusId({
    source: `artist-rankings:${rankings.source}`,
    version: rankings.version,
    generatedAt: rankings.generated_at,
    cellCount: sorted.length,
  });

  console.info(log, {
    corpusSize: sorted.length,
    initialActiveKey,
    corpusId,
    universeEnriched: Boolean(universe),
    generatedAt: rankings.generated_at,
  });

  return { cells: sorted, initialActiveKey, corpusId };
}

const loadArtistRetroscopeDatasetPerRequest = cache(loadArtistRetroscopeDatasetUncached);

let moduleArtistDataset: ArtistRetroscopeDataset | null | undefined;
let moduleArtistInFlight: Promise<ArtistRetroscopeDataset | null> | null = null;

/** Dedupes within a request (`cache`) and across warm server instances (module memo). */
export async function loadArtistRetroscopeDataset(): Promise<ArtistRetroscopeDataset | null> {
  if (moduleArtistDataset !== undefined) return moduleArtistDataset;
  if (moduleArtistInFlight) return moduleArtistInFlight;

  moduleArtistInFlight = loadArtistRetroscopeDatasetPerRequest().then((result) => {
    moduleArtistDataset = result;
    moduleArtistInFlight = null;
    return result;
  });

  return moduleArtistInFlight;
}
