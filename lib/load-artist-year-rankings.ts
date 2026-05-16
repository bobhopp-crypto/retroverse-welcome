import { readFileSync } from "node:fs";
import path from "node:path";

import type { ArtistYearPresence, ArtistYearRankingsFile } from "@/lib/artist-year-ranking-schema";
import {
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  RETROSCOPE_YEAR_MAX,
  RETROSCOPE_YEAR_MIN,
} from "@/lib/album-retroscope-constants";

let cached: ArtistYearRankingsFile | null = null;
let loadAttempted = false;

function defaultArtifactPath(): string {
  const env = process.env.ARTIST_YEAR_RANKINGS_PATH?.trim();
  if (env) return path.resolve(env);
  const fromRoot = process.env.RETROVERSE_DATA_ROOT?.trim()
    ? path.join(process.env.RETROVERSE_DATA_ROOT!.trim(), "runtime", "retroverse-artist-year-rankings.json")
    : "";
  const publicBundled = path.join(
    process.cwd(),
    "public",
    "data",
    "artists",
    "retroverse-artist-year-rankings.json",
  );
  return fromRoot || publicBundled;
}

function loadBundle(): ArtistYearRankingsFile | null {
  if (loadAttempted) return cached;
  loadAttempted = true;
  const p = defaultArtifactPath();
  try {
    const raw = readFileSync(p, "utf8");
    const parsed = JSON.parse(raw) as ArtistYearRankingsFile;
    if (parsed?.version === 1 && parsed.by_year && typeof parsed.by_year === "object") {
      cached = parsed;
      return cached;
    }
  } catch {
    /* missing artifact */
  }
  cached = null;
  return null;
}

export function getArtistYearRankingsBundle(): ArtistYearRankingsFile | null {
  return loadBundle();
}

/** Years present in the canonical artist-rank artifact (RetroScope-aligned when filtered). */
export function getArtistRankingYears(opts?: { retroscopeCoreOnly?: boolean }): number[] {
  const bundle = loadBundle();
  if (!bundle) return [];
  const coreOnly = opts?.retroscopeCoreOnly !== false;
  return bundle.years.filter((y) => {
    if (y < RETROSCOPE_WORLD_YEAR_MIN || y > RETROSCOPE_WORLD_YEAR_MAX) return false;
    if (coreOnly && (y < RETROSCOPE_YEAR_MIN || y > RETROSCOPE_YEAR_MAX)) return false;
    return true;
  });
}

export function getArtistYearRanking(year: number): ArtistYearPresence[] {
  const bundle = loadBundle();
  if (!bundle) return [];
  return bundle.by_year[String(year)] ?? [];
}

export function getArtistYearPresence(
  year: number,
  artistId: string,
): ArtistYearPresence | null {
  const id = artistId.trim();
  return getArtistYearRanking(year).find((row) => row.artist_id === id) ?? null;
}

export function getArtistYearPresenceByRank(
  year: number,
  retroverseArtistRank: number,
): ArtistYearPresence | null {
  return (
    getArtistYearRanking(year).find((row) => row.retroverse_artist_rank === retroverseArtistRank) ?? null
  );
}
