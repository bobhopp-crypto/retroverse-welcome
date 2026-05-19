import type { ArtistUniverseRecord } from "@/lib/artist-universe-schema";
import {
  readCanonicalArtworkOverridesSync,
  resolveLocalFirstCanonicalCover,
} from "@/lib/canonical-artwork-overrides";
import { getAlbumDossier } from "@/lib/load-album-dossier";
import { getArtistUniverseBySlug } from "@/lib/load-artist-universe";
import { HOT100_SOURCE_SYSTEM } from "@/lib/track-deck/constants";
import { getHot100Db } from "@/lib/track-deck/db";
import { hrefForArtist } from "@/lib/retroverse-routes";

type ArtistHot100Track = {
  id: string;
  title: string;
  artist: string;
  releaseYear: number | null;
  peakChartPosition: number;
  chartWeeks: number;
  firstChartDate: string | null;
};

export type ArtistUniverseExperience = {
  artist: { retroverse_artist_id: string; canonical_artist_name: string };
  connectedAlbums: Array<{
    id: string;
    title: string;
    href: string;
    albumTypeLabel: string;
    releaseYear: number | null;
    roleLabel: string | null;
    coverPath: string | null;
    artworkStatus: string | null;
    chartPeak: number | null;
    chartWeeks: number;
    chartingTrackCount: number;
    trackCount: number;
    majorTracks: Array<{
      id: string;
      title: string;
      peakChartPosition: number | null;
    }>;
  }>;
  chartingTracks: Array<{
    id: string;
    title: string;
    albumTitle: string;
    albumHref: string;
    releaseYear: number | null;
    peakChartPosition: number;
    chartWeeks: number;
    contextLabel: string;
    eraId: null;
  }>;
  connectedTrackRows: Array<{
    id: string;
    title: string;
    albumTitle: string;
    albumHref: string;
    releaseYear: number | null;
    peakChartPosition: number | null;
  }>;
  eraConnections: [];
  primaryEra: null;
  metrics: {
    numberOneCount: number;
    soundtrackLinkedSinglesCount: number;
    soundtrackAlbumAppearances: number;
    sequencingTrackCount: number;
    sequencingSides: number;
    dominantEra: null;
  };
  pathways: [];
  universe: ArtistUniverseRecord;
};

function normalizeHot100Name(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeTrackTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|live|mono|stereo|sessions?|roughs?|outtakes?).*$/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\/.*$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function loadArtistHot100Tracks(artistName: string, limit = 18): ArtistHot100Track[] {
  try {
    const db = getHot100Db();
    const artistExact = artistName.trim().toLowerCase();
    const artistNorm = normalizeHot100Name(artistName);
    const rows = db.prepare(`
      SELECT
        w.work_id AS work_id,
        w.title_display AS title,
        p.name_display AS artist,
        MIN(ee.rank) AS peak,
        COUNT(*) AS week_count,
        MAX(COALESCE(ee.weeks_on_chart, 0)) AS max_weeks,
        MIN(e.issue_date) AS first_date
      FROM work w
      JOIN person p ON p.person_id = w.primary_person_id
      JOIN event_entry ee ON ee.work_id = w.work_id
      JOIN event e ON e.event_id = ee.event_id
      WHERE e.source_system = @source
        AND (
          lower(p.name_display) = @artistExact
          OR p.name_norm = @artistExact
          OR p.name_norm = @artistNorm
        )
      GROUP BY w.work_id
      ORDER BY peak ASC, max_weeks DESC, week_count DESC, w.title_display ASC
      LIMIT @limit
    `).all({ source: HOT100_SOURCE_SYSTEM, artistExact, artistNorm, limit }) as Array<{
      work_id: string;
      title: string;
      artist: string;
      peak: number;
      week_count: number;
      max_weeks: number | null;
      first_date: string | null;
    }>;
    return rows
      .filter((row) => Number.isFinite(row.peak))
      .map((row) => ({
        id: `hot100:${row.work_id}`,
        title: row.title.trim(),
        artist: row.artist.trim(),
        releaseYear: row.first_date ? Number.parseInt(row.first_date.slice(0, 4), 10) : null,
        peakChartPosition: row.peak,
        chartWeeks: Math.max(row.week_count, row.max_weeks ?? 0),
        firstChartDate: row.first_date,
      }));
  } catch {
    return [];
  }
}

function recordToExperience(record: ArtistUniverseRecord): ArtistUniverseExperience {
  const artworkOverrides = readCanonicalArtworkOverridesSync();
  const trackRows = record.primary_tracks.map((track) => ({
    id: track.id,
    title: track.title,
    albumTitle: track.album_title,
    albumHref: track.album_href,
    releaseYear: track.release_year,
    peakChartPosition: track.peak_chart_position,
  }));
  const tracksByAlbumId = new Map<string, typeof trackRows>();
  for (const [index, source] of record.primary_tracks.entries()) {
    if (!source.album_id) continue;
    const track = trackRows[index];
    if (!track) continue;
    const rows = tracksByAlbumId.get(source.album_id) ?? [];
    rows.push(track);
    tracksByAlbumId.set(source.album_id, rows);
  }
  const albumTrackByTitle = new Map<string, (typeof record.primary_tracks)[number]>();
  for (const track of record.primary_tracks) {
    const key = normalizeTrackTitle(track.title);
    if (key && !albumTrackByTitle.has(key)) albumTrackByTitle.set(key, track);
  }
  const hot100Tracks = loadArtistHot100Tracks(record.display_name);
  const chartingTracks = hot100Tracks
    .map((track) => {
      const albumTrack = albumTrackByTitle.get(normalizeTrackTitle(track.title));
      return {
        id: track.id,
        title: track.title,
        albumTitle: albumTrack?.album_title ?? "Hot 100 single",
        albumHref: albumTrack?.album_href ?? "/track-deck",
        releaseYear: track.releaseYear,
        peakChartPosition: track.peakChartPosition,
        chartWeeks: track.chartWeeks,
        contextLabel: track.peakChartPosition <= 10 ? "Top 10 single" : "Hot 100 signal",
        eraId: null,
      };
    })
    .sort((a, b) => a.peakChartPosition - b.peakChartPosition || a.title.localeCompare(b.title));
  const numberOneTracks = chartingTracks.filter((track) => track.peakChartPosition === 1).length;

  return {
    artist: {
      retroverse_artist_id: record.artist_id,
      canonical_artist_name: record.display_name,
    },
    connectedAlbums: record.primary_albums.map((album) => {
      const albumTracks = tracksByAlbumId.get(album.album_id) ?? [];
      const artwork = resolveLocalFirstCanonicalCover(album.album_id, artworkOverrides, null);
      const dossier = getAlbumDossier(album.album_id);
      const chartPeak = dossier?.chart.peak_rank ?? null;
      const chartWeeks = dossier?.chart.weeks_on_chart ?? 0;
      const dossierTracks = (dossier?.acoustic.tracks ?? [])
        .map((track, index) => ({
          id: `${album.album_id}:${index}`,
          title: track.title?.trim() ?? "",
          peakChartPosition: null,
        }))
        .filter((track) => track.title.length > 0);
      const trackCount = Math.max(albumTracks.length, dossier?.acoustic.track_count ?? dossierTracks.length);
      const majorTracks = albumTracks.length > 0
        ? albumTracks
            .slice()
            .sort((a, b) => {
              const aPeak = a.peakChartPosition ?? 999;
              const bPeak = b.peakChartPosition ?? 999;
              if (aPeak !== bPeak) return aPeak - bPeak;
              return a.title.localeCompare(b.title);
            })
            .slice(0, 4)
            .map((track) => ({
              id: track.id,
              title: track.title,
              peakChartPosition: track.peakChartPosition,
            }))
        : dossierTracks.slice(0, 4);
      return {
        id: album.album_id,
        title: album.title,
        href: album.href,
        albumTypeLabel: "Album",
        releaseYear: album.release_year,
        roleLabel: "Primary artist",
        coverPath: artwork.path,
        artworkStatus: artwork.trustState ?? null,
        chartPeak,
        chartWeeks,
        chartingTrackCount: chartingTracks.filter((track) => track.albumHref === album.href).length,
        trackCount,
        majorTracks,
      };
    }),
    chartingTracks,
    connectedTrackRows: trackRows,
    eraConnections: [],
    primaryEra: null,
    metrics: {
      numberOneCount: numberOneTracks,
      soundtrackLinkedSinglesCount: 0,
      soundtrackAlbumAppearances: 0,
      sequencingTrackCount: record.primary_tracks.length,
      sequencingSides: 0,
      dominantEra: null,
    },
    pathways: [],
    universe: record,
  };
}

/** Local-first artist page payload (no Supabase). */
export function loadArtistExperienceFromUniverse(slug: string): ArtistUniverseExperience | null {
  const record = getArtistUniverseBySlug(slug);
  if (!record) return null;
  return recordToExperience(record);
}

export function hrefForUniverseArtist(record: Pick<ArtistUniverseRecord, "artist_id" | "display_name" | "slug">): string {
  return hrefForArtist(record.artist_id, record.display_name);
}
