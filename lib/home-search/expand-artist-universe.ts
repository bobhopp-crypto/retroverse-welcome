import type { AlbumDossier } from "@/lib/album-dossier-schema";
import type { ArtistUniverseRecord } from "@/lib/artist-universe-schema";
import { getAlbumDossier, getAlbumDossiersBundleOrNull } from "@/lib/load-album-dossier";
import { getArtistUniverseById, getArtistUniverseBySlug } from "@/lib/load-artist-universe";
import {
  searchCanonicalTracksByArtist,
  type CanonicalTrackEntity,
} from "@/lib/load-canonical-track-graph";
import { hrefForAlbum, hrefForArtist, hrefForTrack, normalizeEntitySlug } from "@/lib/retroverse-routes";
import { primaryAlbumRankScore } from "@/lib/resolve-primary-track-album";

import { loadArtistHot100TracksForSearch } from "./artist-hot100-tracks";
import {
  filterSearchAlbums,
  filterSearchTracks,
  type PrimaryCanonicalArtist,
} from "./corpus-filters";
import {
  buildLinkedAlbumByTitle,
  finalizeArtistFirstTracks,
  mapGraphTracksToSearch,
  trackConfidenceSubtitle,
} from "./graph-tracks";
import {
  HOME_SEARCH_ARTIST_ALBUM_LIMIT,
  HOME_SEARCH_ARTIST_CHART_LIMIT,
  HOME_SEARCH_ARTIST_TRACK_LIMIT,
} from "./limits";
import { textMatchScore } from "./rank";
import type { HomeSearchAlbum, HomeSearchChart, HomeSearchPayload, HomeSearchTrack } from "./types";

function normalizeTrackTitleKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|live|mono|stereo|sessions?|roughs?|outtakes?).*$/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\/.*$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function trackDedupeKey(row: HomeSearchTrack): string {
  return normalizeTrackTitleKey(row.title) || row.href;
}

function albumRankScore(title: string, year: number | null, chartPeak: number | null): number {
  let score = primaryAlbumRankScore(title, {
    linkSource: "canonical_album_tracks",
    rvtrKeyMatch: false,
  });
  if (chartPeak != null && Number.isFinite(chartPeak)) {
    score -= Math.max(0, 40 - chartPeak);
  }
  if (year != null && year >= 1960 && year <= 1999) score -= 3;
  return score;
}

function albumSubtitle(year: number | null, chartPeak: number | null, chartWeeks: number): string | null {
  const parts: string[] = [];
  if (chartPeak != null && Number.isFinite(chartPeak)) parts.push(`Peak #${chartPeak}`);
  if (chartWeeks > 0) parts.push(`${chartWeeks} wks`);
  if (year != null) parts.push(String(year));
  return parts.length ? parts.join(" · ") : year != null ? String(year) : null;
}

function dossiersForArtistName(bundle: NonNullable<ReturnType<typeof getAlbumDossiersBundleOrNull>>, name: string): AlbumDossier[] {
  const target = name.trim().toLowerCase();
  if (!target) return [];
  return Object.values(bundle.dossiers).filter((d) => d.identity.artist.trim().toLowerCase() === target);
}

function dominantAlbumBoostIds(universe: ArtistUniverseRecord): Set<string> {
  const ids = new Set<string>();
  for (const year of universe.dominant_years.slice(0, 4)) {
    const row = universe.yearly_rankings.find((r) => r.year === year);
    for (const albumId of row?.dominant_album_ids ?? []) {
      if (albumId?.trim()) ids.add(albumId.trim().toUpperCase());
    }
  }
  return ids;
}

function resolveUniverseRecord(primary: PrimaryCanonicalArtist): ArtistUniverseRecord | null {
  const bySlug = getArtistUniverseBySlug(normalizeEntitySlug(primary.name));
  if (bySlug) return bySlug;
  if (primary.artistId?.trim()) {
    return getArtistUniverseById(primary.artistId) ?? null;
  }
  return null;
}

function albumsFromUniverse(universe: ArtistUniverseRecord, artistName: string): HomeSearchAlbum[] {
  const boostIds = dominantAlbumBoostIds(universe);
  const rows: Array<HomeSearchAlbum & { _rank: number }> = [];
  for (const album of universe.primary_albums) {
    const dossier = getAlbumDossier(album.album_id);
    const chartPeak = dossier?.chart.peak_rank ?? null;
    const chartWeeks = dossier?.chart.weeks_on_chart ?? 0;
    const year = album.release_year ?? dossier?.identity.chart_year ?? null;
    const title = album.title.trim() || "—";
    const albumId = album.album_id.trim().toUpperCase();
    let rank = albumRankScore(title, year, chartPeak);
    if (boostIds.has(albumId)) rank -= 45;
    rows.push({
      kind: "album",
      title,
      artist: artistName,
      year,
      href: album.href,
      subtitle: albumSubtitle(year, chartPeak, chartWeeks),
      relation: "ALBUM",
      _rank: rank,
    });
  }
  return rows
    .sort((a, b) => a._rank - b._rank || (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title))
    .map(({ _rank: _ignored, ...row }) => row);
}

function albumsFromDossiers(artistName: string): HomeSearchAlbum[] {
  const bundle = getAlbumDossiersBundleOrNull();
  if (!bundle) return [];
  const rows: Array<HomeSearchAlbum & { _rank: number }> = [];
  for (const d of dossiersForArtistName(bundle, artistName)) {
    const title = d.identity.album.trim() || "—";
    const year = d.identity.chart_year ?? null;
    const chartPeak = d.chart.peak_rank ?? null;
    const chartWeeks = d.chart.weeks_on_chart ?? 0;
    rows.push({
      kind: "album",
      title,
      artist: artistName,
      year,
      href: hrefForAlbum(d.albumId, title),
      subtitle: albumSubtitle(year, chartPeak, chartWeeks),
      relation: "ALBUM",
      _rank: albumRankScore(title, year, chartPeak),
    });
  }
  return rows
    .sort((a, b) => a._rank - b._rank || (a.year ?? 9999) - (b.year ?? 9999) || a.title.localeCompare(b.title))
    .map(({ _rank: _ignored, ...row }) => row);
}

function graphHrefByTitle(graphMatches: CanonicalTrackEntity[]): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of graphMatches) {
    const key = normalizeTrackTitleKey(row.canonicalTitle);
    if (!key || out.has(key)) continue;
    out.set(key, hrefForTrack(row.retroverseTrackId ?? row.trackId));
  }
  return out;
}

function tracksFromUniverse(
  universe: ArtistUniverseRecord,
  artistName: string,
  linkedByTitle: Map<string, { albumTitle: string; albumHref: string }>,
  hrefByTitle: Map<string, string>,
): HomeSearchTrack[] {
  const rows: HomeSearchTrack[] = [];
  for (const track of universe.primary_tracks) {
    const key = normalizeTrackTitleKey(track.title);
    const href = hrefByTitle.get(key);
    if (!href) continue;
    const linked = linkedByTitle.get(key);
    const albumTitle = linked?.albumTitle ?? track.album_title;
    const albumHref = linked?.albumHref ?? track.album_href;
    const peak = track.peak_chart_position;
    rows.push({
      kind: "track",
      title: track.title.trim(),
      artist: artistName,
      href,
      subtitle: trackConfidenceSubtitle(peak, null, albumTitle),
      linkedAlbum: albumTitle,
      linkedAlbumHref: albumHref,
      relation: peak != null ? "HOT100" : "TRACK",
    });
  }
  return filterSearchTracks(rows);
}

function mergeTracks(primary: HomeSearchTrack[], secondary: HomeSearchTrack[], limit: number): HomeSearchTrack[] {
  const seen = new Set<string>();
  const out: HomeSearchTrack[] = [];
  for (const row of [...primary, ...secondary]) {
    const key = trackDedupeKey(row);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
    if (out.length >= limit) break;
  }
  return out;
}

function enrichTracksWithHot100(tracks: HomeSearchTrack[], hot100: ReturnType<typeof loadArtistHot100TracksForSearch>): HomeSearchTrack[] {
  const peakByTitle = new Map(
    hot100.map((hit) => [normalizeTrackTitleKey(hit.title), hit] as const),
  );
  return tracks.map((row) => {
    const hit = peakByTitle.get(normalizeTrackTitleKey(row.title));
    if (!hit) return row;
    return {
      ...row,
      subtitle: trackConfidenceSubtitle(hit.peakChartPosition, hit.chartWeeks, row.linkedAlbum),
      relation: "HOT100" as const,
    };
  });
}

function chartMomentsFromArtist(
  artistName: string,
  universe: ArtistUniverseRecord | null,
  hot100: ReturnType<typeof loadArtistHot100TracksForSearch>,
): HomeSearchChart[] {
  const charts: HomeSearchChart[] = [];

  if (universe?.dominant_years?.length) {
    for (const year of universe.dominant_years.slice(0, 3)) {
      charts.push({
        kind: "chart",
        label: `${year} · ${artistName}`,
        year,
        weekDate: "Peak Retroverse year",
        href: hrefForArtist(universe.artist_id, artistName),
        relation: "TRACK",
      });
    }
  } else if (universe?.active_years?.first) {
    const first = universe.active_years.first;
    const last = universe.active_years.last ?? first;
    charts.push({
      kind: "chart",
      label: `${first}${last !== first ? `–${last}` : ""} · ${artistName}`,
      year: last,
      weekDate: "Active years",
      href: hrefForArtist(universe.artist_id, artistName),
      relation: "TRACK",
    });
  }

  for (const hit of hot100.slice(0, Math.max(0, HOME_SEARCH_ARTIST_CHART_LIMIT - charts.length))) {
    const year = hit.releaseYear ?? (hit.firstChartDate ? Number.parseInt(hit.firstChartDate.slice(0, 4), 10) : 0);
    charts.push({
      kind: "chart",
      label: `Peak #${hit.peakChartPosition} · ${hit.title}`,
      year: Number.isFinite(year) ? year : 0,
      weekDate: hit.firstChartDate?.trim() || `${hit.chartWeeks} wks on chart`,
      href: `/track-deck?work=${encodeURIComponent(hit.id.replace(/^hot100:/, ""))}`,
      relation: "HOT100",
    });
    if (charts.length >= HOME_SEARCH_ARTIST_CHART_LIMIT) break;
  }

  return charts;
}

/** True when the query is clearly an artist name (not a song/album title probe). */
export function isArtistFirstSearchQuery(q: string, primary: PrimaryCanonicalArtist): boolean {
  return textMatchScore(primary.name, q) <= 2;
}

/**
 * Canonical artist expansion: universe + dossier albums, graph/Hot100 tracks, chart moments.
 * Local-first; no broad fuzzy scan.
 */
export async function buildArtistExpandedSearch(
  q: string,
  primary: PrimaryCanonicalArtist,
): Promise<HomeSearchPayload | null> {
  if (!isArtistFirstSearchQuery(q, primary)) return null;

  const artistName = primary.name.trim();
  const universe = resolveUniverseRecord(primary);
  const linkedByTitle = universe
    ? buildLinkedAlbumByTitle(
        universe.primary_tracks.map((t) => ({
          title: t.title,
          album_title: t.album_title,
          album_href: t.album_href,
        })),
      )
    : new Map<string, { albumTitle: string; albumHref: string }>();

  const graphMatches = await searchCanonicalTracksByArtist(artistName, HOME_SEARCH_ARTIST_TRACK_LIMIT);
  const graphTracks = finalizeArtistFirstTracks(
    mapGraphTracksToSearch(graphMatches, { linkedAlbumByTitle: linkedByTitle }),
    HOME_SEARCH_ARTIST_TRACK_LIMIT,
  );

  const hrefByTitle = graphHrefByTitle(graphMatches);
  const universeTracks = universe
    ? tracksFromUniverse(universe, artistName, linkedByTitle, hrefByTitle)
    : [];
  const hot100Raw = loadArtistHot100TracksForSearch(artistName, 20);

  let tracks = mergeTracks(graphTracks, universeTracks, HOME_SEARCH_ARTIST_TRACK_LIMIT);
  tracks = enrichTracksWithHot100(tracks, hot100Raw);

  let albums =
    universe && universe.primary_albums.length > 0
      ? albumsFromUniverse(universe, artistName)
      : albumsFromDossiers(artistName);
  albums = filterSearchAlbums(albums).slice(0, HOME_SEARCH_ARTIST_ALBUM_LIMIT);

  const artistId = universe?.artist_id?.trim() || primary.artistId?.trim() || "";
  const artistHref =
    artistId && /^RVAR\d{6}$/i.test(artistId)
      ? hrefForArtist(artistId, artistName)
      : primary.href;

  const artists = [
    {
      kind: "artist" as const,
      name: universe?.display_name ?? artistName,
      href: artistHref,
    },
  ];

  const charts = chartMomentsFromArtist(artistName, universe, hot100Raw);

  if (tracks.length === 0 && albums.length === 0) return null;

  return {
    ok: true,
    q,
    tracks,
    albums,
    artists,
    charts,
  };
}
