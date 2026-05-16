/**
 * Materialize local-first artist universe from rankings + album dossiers.
 *
 * Run: npm run generate:artist-universe
 * Prerequisite: npm run generate:artist-year-rankings
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

import { isGenericArtistBucket } from "../lib/artist-identity-resolve";
import type {
  ArtistUniverseFile,
  ArtistUniverseRecord,
  ArtistYearRankingRef,
} from "../lib/artist-universe-schema";
import { getAlbumDossiersBundleOrNull } from "../lib/load-album-dossier";
import type { ArtistYearRankingsFile } from "../lib/artist-year-ranking-schema";
import { hrefForAlbum, normalizeEntitySlug } from "../lib/retroverse-routes";

const WORKSPACE = process.cwd();
const RANKINGS_PATH = path.join(WORKSPACE, "public", "data", "artists", "retroverse-artist-year-rankings.json");
const OUT_JSON = path.join(WORKSPACE, "public", "data", "artists", "artist-universe.json");

function signalPaletteForSlug(slug: string): { hue: number; accent: string } {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) >>> 0;
  const hue = hash % 360;
  return { hue, accent: `hsl(${hue} 68% 58%)` };
}

function loadRankings(): ArtistYearRankingsFile | null {
  try {
    const parsed = JSON.parse(readFileSync(RANKINGS_PATH, "utf8")) as ArtistYearRankingsFile;
    if (parsed?.version === 1 && parsed.by_year) return parsed;
  } catch {
    /* missing */
  }
  return null;
}

type MutableArtist = {
  artist_id: string;
  display_name: string;
  slug: string;
  yearly_rankings: ArtistYearRankingRef[];
  albumById: Map<string, ArtistUniverseRecord["primary_albums"][number]>;
  trackRows: ArtistUniverseRecord["primary_tracks"];
  discography_album_ids: Set<string>;
  source_notes: Set<string>;
};

function artistKey(artistId: string, displayName: string): string {
  const slug = normalizeEntitySlug(displayName);
  return artistId.startsWith("slug:") ? slug : `${artistId}::${slug}`;
}

function getOrCreate(
  map: Map<string, MutableArtist>,
  artistId: string,
  displayName: string,
): MutableArtist {
  const key = artistKey(artistId, displayName);
  const slug = normalizeEntitySlug(displayName);
  const existing = map.get(key);
  if (existing) return existing;
  const row: MutableArtist = {
    artist_id: artistId,
    display_name: displayName,
    slug,
    yearly_rankings: [],
    albumById: new Map(),
    trackRows: [],
    discography_album_ids: new Set(),
    source_notes: new Set(),
  };
  map.set(key, row);
  return row;
}

function finalizeRecord(row: MutableArtist): ArtistUniverseRecord {
  const years = row.yearly_rankings.map((r) => r.year);
  const releaseYears = [
    ...row.albumById.values().map((a) => a.release_year).filter((y): y is number => y !== null),
    ...row.trackRows.map((t) => t.release_year).filter((y): y is number => y !== null),
  ];
  const allYears = [...years, ...releaseYears];
  const activeFirst = allYears.length > 0 ? Math.min(...allYears) : null;
  const activeLast = allYears.length > 0 ? Math.max(...allYears) : null;

  const sortedRankings = [...row.yearly_rankings].sort((a, b) => a.year - b.year);
  const dominant_years = [...sortedRankings]
    .sort((a, b) => b.peak_momentum_score - a.peak_momentum_score || a.retroverse_artist_rank - b.retroverse_artist_rank)
    .slice(0, 5)
    .map((r) => r.year);

  const best = [...sortedRankings].sort(
    (a, b) => a.retroverse_artist_rank - b.retroverse_artist_rank || b.peak_momentum_score - a.peak_momentum_score,
  )[0];

  const peak_momentum_score = Math.max(0, ...sortedRankings.map((r) => r.peak_momentum_score));

  const primary_albums = [...row.albumById.values()].sort((a, b) => {
    if (a.release_year === null && b.release_year === null) return a.title.localeCompare(b.title);
    if (a.release_year === null) return 1;
    if (b.release_year === null) return -1;
    return a.release_year - b.release_year || a.title.localeCompare(b.title);
  });

  const navigation_coordinates = sortedRankings.map((r) => r.artist_retroscope_key);

  return {
    artist_id: row.artist_id,
    display_name: row.display_name,
    slug: row.slug,
    active_years: { first: activeFirst, last: activeLast },
    yearly_rankings: sortedRankings,
    dominant_years,
    retroverse_summary: {
      ranked_year_count: sortedRankings.length,
      best_year: best?.year ?? null,
      best_year_rank: best?.retroverse_artist_rank ?? null,
      peak_momentum_score,
      top_coordinate: best?.artist_retroscope_key ?? null,
    },
    primary_albums: primary_albums.slice(0, 24),
    primary_tracks: row.trackRows.slice(0, 32),
    navigation_coordinates,
    discography_album_ids: [...row.discography_album_ids],
    dossier_summary:
      row.albumById.size > 0
        ? { album_count: row.albumById.size, track_count: row.trackRows.length }
        : null,
    signal_palette: signalPaletteForSlug(row.slug),
    source_notes: [...row.source_notes],
  };
}

async function main() {
  const rankings = loadRankings();
  const dossiers = getAlbumDossiersBundleOrNull();
  const map = new Map<string, MutableArtist>();
  const sourceParts: string[] = [];

  if (rankings) {
    sourceParts.push("retroverse-artist-year-rankings");
    for (const year of rankings.years) {
      for (const row of rankings.by_year[String(year)] ?? []) {
        if (isGenericArtistBucket(row.artist_name)) continue;
        const artist = getOrCreate(map, row.artist_id, row.artist_name);
        artist.yearly_rankings.push({
          year: row.year,
          retroverse_artist_rank: row.retroverse_artist_rank,
          artist_retroscope_key: row.artist_retroscope_key,
          peak_momentum_score: row.peak_momentum_score,
          best_album_rank: row.best_album_rank,
          best_track_rank: row.best_track_rank,
          dominant_album_ids: row.dominant_album_ids ?? [],
          dominant_track_ids: row.dominant_track_ids ?? [],
        });
        artist.source_notes.add("yearly-rankings");
        for (const albumId of row.dominant_album_ids ?? []) {
          artist.discography_album_ids.add(albumId);
        }
      }
    }
  }

  if (dossiers) {
    sourceParts.push("album-dossiers");
    for (const dossier of Object.values(dossiers.dossiers)) {
      const name = dossier.identity.artist?.trim();
      if (!name || isGenericArtistBucket(name)) continue;
      const slug = normalizeEntitySlug(name);
      const artistId = `slug:${slug}`;
      const artist = getOrCreate(map, artistId, name);
      artist.source_notes.add("dossiers");

      const albumId = dossier.albumId.trim().toUpperCase();
      const albumTitle = dossier.identity.album.trim() || "—";
      const releaseYear = dossier.identity.chart_year ?? null;
      artist.discography_album_ids.add(albumId);
      if (!artist.albumById.has(albumId)) {
        artist.albumById.set(albumId, {
          album_id: albumId,
          title: albumTitle,
          href: hrefForAlbum(albumId, albumTitle),
          release_year: releaseYear,
        });
      }

      for (const [i, track] of dossier.acoustic.tracks.entries()) {
        const title = track.title?.trim();
        if (!title) continue;
        const id = `${albumId}:${i}`;
        if (artist.trackRows.some((t) => t.id === id)) continue;
        artist.trackRows.push({
          id,
          title,
          album_id: albumId,
          album_title: albumTitle,
          album_href: hrefForAlbum(albumId, albumTitle),
          release_year: releaseYear,
          peak_chart_position: null,
        });
      }
    }
  }

  if (map.size === 0) {
    throw new Error("No artist universe rows — run generate:artist-year-rankings and ensure dossiers exist");
  }

  const artists_by_slug: Record<string, ArtistUniverseRecord> = {};
  const artists_by_id: Record<string, string> = {};

  for (const row of map.values()) {
    const record = finalizeRecord(row);
    artists_by_slug[record.slug] = record;
    artists_by_id[record.artist_id] = record.slug;
    if (/^RVAR[0-9]{6}$/i.test(record.artist_id)) {
      artists_by_id[record.artist_id.toUpperCase()] = record.slug;
    }
    artists_by_id[`slug:${record.slug}`] = record.slug;
  }

  const index = Object.values(artists_by_slug)
    .map((r) => ({
      artist_id: r.artist_id,
      display_name: r.display_name,
      slug: r.slug,
      album_count: r.discography_album_ids.length,
      ranked_year_count: r.retroverse_summary.ranked_year_count,
      dominant_years: r.dominant_years,
      active_first: r.active_years.first,
      active_last: r.active_years.last,
      signal_hue: r.signal_palette.hue,
    }))
    .sort((a, b) => a.display_name.localeCompare(b.display_name));

  const artifact: ArtistUniverseFile = {
    version: 1,
    generated_at: new Date().toISOString(),
    source: sourceParts.join("+") || "local",
    artist_count: index.length,
    artists_by_slug,
    artists_by_id,
    index,
  };

  await mkdir(path.dirname(OUT_JSON), { recursive: true });
  await writeFile(OUT_JSON, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  process.stderr.write(
    `[artist-universe] Wrote ${OUT_JSON} · artists=${artifact.artist_count} · source=${artifact.source}\n`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
