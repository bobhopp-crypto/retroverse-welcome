import type { AlbumDossier } from "@/lib/album-dossier-schema";
import { getAlbumDossiersBundleOrNull } from "@/lib/load-album-dossier";
import { hrefForAlbum, normalizeEntitySlug } from "@/lib/retroverse-routes";

export type DossierArtistIndexRow = {
  slug: string;
  canonicalName: string;
  albumIds: string[];
};

function dossiersForArtistName(bundle: NonNullable<ReturnType<typeof getAlbumDossiersBundleOrNull>>, name: string): AlbumDossier[] {
  const target = name.trim().toLowerCase();
  if (!target) return [];
  return Object.values(bundle.dossiers).filter((d) => d.identity.artist.trim().toLowerCase() === target);
}

/** Local artist index from materialized album dossiers (no Supabase). */
export function listArtistsFromDossierBundle(): DossierArtistIndexRow[] {
  const bundle = getAlbumDossiersBundleOrNull();
  if (!bundle) return [];

  const bySlug = new Map<string, DossierArtistIndexRow>();
  for (const dossier of Object.values(bundle.dossiers)) {
    const canonicalName = dossier.identity.artist?.trim();
    if (!canonicalName) continue;
    const slug = normalizeEntitySlug(canonicalName);
    const row = bySlug.get(slug) ?? { slug, canonicalName, albumIds: [] };
    row.albumIds.push(dossier.albumId);
    bySlug.set(slug, row);
  }

  return [...bySlug.values()].sort((a, b) => a.canonicalName.localeCompare(b.canonicalName));
}

export function resolveArtistSlugFromDossierBundle(slug: string): DossierArtistIndexRow | null {
  const normalized = normalizeEntitySlug(slug);
  return listArtistsFromDossierBundle().find((row) => row.slug === normalized) ?? null;
}

export type DossierArtistExperience = {
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
};

/** Minimal artist universe from local dossiers when Supabase is unavailable. */
export function loadArtistExperienceFromDossierBundle(slug: string): DossierArtistExperience | null {
  const bundle = getAlbumDossiersBundleOrNull();
  if (!bundle) return null;

  const indexRow = resolveArtistSlugFromDossierBundle(slug);
  if (!indexRow) return null;

  const dossiers = dossiersForArtistName(bundle, indexRow.canonicalName);
  if (dossiers.length === 0) return null;

  const connectedAlbums = dossiers
    .map((d) => ({
      id: d.albumId,
      title: d.identity.album.trim() || "—",
      href: hrefForAlbum(d.albumId, d.identity.album),
      albumTypeLabel: "Album",
      releaseYear: d.identity.chart_year ?? null,
      roleLabel: "Primary artist",
      coverPath: d.identity.canonical_cover_path?.trim() || null,
      artworkStatus: d.identity.trust_state ?? null,
    }))
    .sort((a, b) => {
      if (a.releaseYear === null && b.releaseYear === null) return a.title.localeCompare(b.title);
      if (a.releaseYear === null) return 1;
      if (b.releaseYear === null) return -1;
      return a.releaseYear - b.releaseYear || a.title.localeCompare(b.title);
    });

  const connectedTrackRows: DossierArtistExperience["connectedTrackRows"] = [];
  for (const d of dossiers) {
    const albumTitle = d.identity.album.trim() || "—";
    const albumHref = hrefForAlbum(d.albumId, d.identity.album);
    const releaseYear = d.identity.chart_year ?? null;
    for (const [i, track] of d.acoustic.tracks.entries()) {
      const title = track.title?.trim();
      if (!title) continue;
      connectedTrackRows.push({
        id: `${d.albumId}:${i}`,
        title,
        albumTitle,
        albumHref,
        releaseYear,
        peakChartPosition: null,
      });
    }
  }

  return {
    artist: {
      retroverse_artist_id: `local:${indexRow.slug}`,
      canonical_artist_name: indexRow.canonicalName,
    },
    connectedAlbums,
    chartingTracks: [],
    connectedTrackRows: connectedTrackRows.slice(0, 24),
    eraConnections: [],
    primaryEra: null,
    metrics: {
      numberOneCount: 0,
      soundtrackLinkedSinglesCount: 0,
      soundtrackAlbumAppearances: 0,
      sequencingTrackCount: connectedTrackRows.length,
      sequencingSides: 0,
      dominantEra: null,
    },
    pathways: [],
  };
}
