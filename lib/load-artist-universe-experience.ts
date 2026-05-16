import type { ArtistUniverseRecord } from "@/lib/artist-universe-schema";
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
    coverPath: null;
    artworkStatus: null;
  }>;
  chartingTracks: [];
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
  const numberOneYears = record.yearly_rankings.filter((r) => r.retroverse_artist_rank === 1).length;

  return {
    artist: {
      retroverse_artist_id: record.artist_id,
      canonical_artist_name: record.display_name,
    },
    connectedAlbums: record.primary_albums.map((album) => ({
      id: album.album_id,
      title: album.title,
      href: album.href,
      albumTypeLabel: "Album",
      releaseYear: album.release_year,
      roleLabel: "Primary artist",
      coverPath: null,
      artworkStatus: null,
    })),
    chartingTracks: [],
    connectedTrackRows: record.primary_tracks.map((track) => ({
      id: track.id,
      title: track.title,
      albumTitle: track.album_title,
      albumHref: track.album_href,
      releaseYear: track.release_year,
      peakChartPosition: track.peak_chart_position,
    })),
    eraConnections: [],
    primaryEra: null,
    metrics: {
      numberOneCount: numberOneYears,
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
