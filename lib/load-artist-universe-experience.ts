import type { ArtistUniverseRecord } from "@/lib/artist-universe-schema";
import {
  readCanonicalArtworkOverridesSync,
  resolveLocalFirstCanonicalCover,
} from "@/lib/canonical-artwork-overrides";
import { getAlbumDossier } from "@/lib/load-album-dossier";
import { getArtistUniverseBySlug } from "@/lib/load-artist-universe";
import { hrefForArtist } from "@/lib/retroverse-routes";

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
  const chartingTracks = record.primary_tracks
    .filter((track) => track.peak_chart_position !== null)
    .map((track) => ({
      id: track.id,
      title: track.title,
      albumTitle: track.album_title,
      albumHref: track.album_href,
      releaseYear: track.release_year,
      peakChartPosition: track.peak_chart_position as number,
      contextLabel: "Artist track",
      eraId: null,
    }))
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
