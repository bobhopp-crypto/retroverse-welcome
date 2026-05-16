import { redirect } from "next/navigation";

import { getAllEras } from "@/lib/eras";
import { albumRoute, artistRoute } from "@/lib/retroverse-routes";
import { createClient } from "@/lib/supabase";

export const dynamic = "force-dynamic";

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  era_id: string | null;
};

type TrackRow = {
  retroverse_track_id: string;
  retroverse_artist_id: string;
  era_id: string | null;
};

type EraRow = {
  retroverse_era_id: string;
  slug: string;
};

type WeightedRow = {
  weight: number;
};

type WeightedDestination = {
  href: string;
  weight: number;
};

function weightedPick<T extends WeightedRow>(rows: T[]): T | null {
  if (rows.length === 0) return null;
  const total = rows.reduce((sum, row) => sum + row.weight, 0);
  if (total <= 0) return rows[Math.floor(Math.random() * rows.length)] ?? null;
  let cursor = Math.random() * total;
  for (const row of rows) {
    cursor -= row.weight;
    if (cursor <= 0) return row;
  }
  return rows[rows.length - 1] ?? null;
}

export default async function RandomTraversalPage() {
  const supabase = createClient();
  const knownEraSlugs = new Set(getAllEras().map((row) => row.slug));

  const [artistsResult, albumsResult, tracksResult, erasResult, chartRowsResult, albumTracksResult, albumRolesResult, editionsResult] =
    await Promise.all([
      supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
      supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, era_id"),
      supabase.from("retroverse_tracks").select("retroverse_track_id, retroverse_artist_id, era_id").range(0, 5000),
      supabase.from("retroverse_eras").select("retroverse_era_id, slug"),
      supabase.from("retroverse_chart_appearances").select("retroverse_track_id"),
      supabase.from("retroverse_album_tracks").select("retroverse_album_edition_id, retroverse_track_id"),
      supabase.from("retroverse_album_artist_roles").select("retroverse_album_id, retroverse_artist_id"),
      supabase.from("retroverse_album_editions").select("retroverse_album_edition_id, retroverse_album_id"),
    ]);

  if (artistsResult.error) throw artistsResult.error;
  if (albumsResult.error) throw albumsResult.error;
  if (tracksResult.error) throw tracksResult.error;
  if (erasResult.error) throw erasResult.error;
  if (chartRowsResult.error) throw chartRowsResult.error;
  if (albumTracksResult.error) throw albumTracksResult.error;
  if (albumRolesResult.error) throw albumRolesResult.error;
  if (editionsResult.error) throw editionsResult.error;

  const artists = (artistsResult.data ?? []) as ArtistRow[];
  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const eras = (erasResult.data ?? []) as EraRow[];
  const chartRows = chartRowsResult.data ?? [];
  const albumTracks = albumTracksResult.data ?? [];
  const albumRoles = albumRolesResult.data ?? [];
  const editions = editionsResult.data ?? [];

  const albumIdByEditionId = new Map(editions.map((row) => [row.retroverse_album_edition_id, row.retroverse_album_id]));
  const chartCountByTrackId = new Map<string, number>();
  const membershipCountByTrackId = new Map<string, number>();
  const trackCountByAlbumId = new Map<string, number>();
  const trackCountByArtistId = new Map<string, number>();
  const albumRoleCountByArtistId = new Map<string, number>();
  const albumCountByEraId = new Map<string, number>();
  const trackCountByEraId = new Map<string, number>();

  for (const row of chartRows) {
    chartCountByTrackId.set(row.retroverse_track_id, (chartCountByTrackId.get(row.retroverse_track_id) ?? 0) + 1);
  }
  for (const row of albumTracks) {
    membershipCountByTrackId.set(row.retroverse_track_id, (membershipCountByTrackId.get(row.retroverse_track_id) ?? 0) + 1);
    const albumId = albumIdByEditionId.get(row.retroverse_album_edition_id);
    if (albumId) {
      trackCountByAlbumId.set(albumId, (trackCountByAlbumId.get(albumId) ?? 0) + 1);
    }
  }
  for (const row of tracks) {
    if (row.era_id) trackCountByEraId.set(row.era_id, (trackCountByEraId.get(row.era_id) ?? 0) + 1);
  }
  for (const row of albums) {
    if (row.era_id) albumCountByEraId.set(row.era_id, (albumCountByEraId.get(row.era_id) ?? 0) + 1);
  }
  for (const row of tracks) {
    trackCountByArtistId.set(row.retroverse_artist_id, (trackCountByArtistId.get(row.retroverse_artist_id) ?? 0) + 1);
  }
  for (const row of albumRoles) {
    albumRoleCountByArtistId.set(row.retroverse_artist_id, (albumRoleCountByArtistId.get(row.retroverse_artist_id) ?? 0) + 1);
  }

  const artistTargets: WeightedDestination[] = artists
    .map((artist) => ({
      href: artistRoute(artist.canonical_artist_name),
      weight:
        1 +
        (trackCountByArtistId.get(artist.retroverse_artist_id) ?? 0) +
        (albumRoleCountByArtistId.get(artist.retroverse_artist_id) ?? 0),
    }));
  const richArtistTargets = artistTargets.filter((row) => row.weight > 1);

  const albumTargets: WeightedDestination[] = albums
    .map((album) => ({
      href: albumRoute(album.canonical_album_title),
      weight: 1 + (trackCountByAlbumId.get(album.retroverse_album_id) ?? 0),
    }));
  const richAlbumTargets = albumTargets.filter((row) => row.weight > 1);

  const trackTargets: WeightedDestination[] = tracks.map((track) => ({
    href: `/tracks/${track.retroverse_track_id}`,
    weight: 1 + (chartCountByTrackId.get(track.retroverse_track_id) ?? 0) + (membershipCountByTrackId.get(track.retroverse_track_id) ?? 0),
  }));
  const richTrackTargets = trackTargets.filter((row) => row.weight > 1);

  const eraTargets: WeightedDestination[] = eras
    .map((era) => {
      if (!knownEraSlugs.has(era.slug) && era.slug !== "1974-1977") return null;
      const href = era.slug === "1974-1977" ? "/eras/1974-1977" : `/eras/${era.slug}`;
      const weight = 1 + (albumCountByEraId.get(era.retroverse_era_id) ?? 0) + (trackCountByEraId.get(era.retroverse_era_id) ?? 0);
      return { href, weight };
    })
    .filter((row): row is WeightedDestination => row !== null);
  const richEraTargets = eraTargets.filter((row) => row.weight > 1);

  const artistPool = richArtistTargets.length > 0 ? richArtistTargets : artistTargets;
  const albumPool = richAlbumTargets.length > 0 ? richAlbumTargets : albumTargets;
  const trackPool = richTrackTargets.length > 0 ? richTrackTargets : trackTargets;
  const eraPool = richEraTargets.length > 0 ? richEraTargets : eraTargets;

  const typeTargets: Array<{ kind: "artist" | "album" | "track" | "era"; weight: number }> = [
    { kind: "artist" as const, weight: artistPool.length > 0 ? 1 : 0 },
    { kind: "album" as const, weight: albumPool.length > 0 ? 1 : 0 },
    { kind: "track" as const, weight: trackPool.length > 0 ? 1 : 0 },
    { kind: "era" as const, weight: eraPool.length > 0 ? 1 : 0 },
  ].filter((row) => row.weight > 0);

  const chosenType = weightedPick(typeTargets);
  const destination =
    chosenType?.kind === "artist"
      ? weightedPick(artistPool)?.href
      : chosenType?.kind === "album"
        ? weightedPick(albumPool)?.href
        : chosenType?.kind === "track"
          ? weightedPick(trackPool)?.href
          : weightedPick(eraPool)?.href;

  redirect(destination ?? "/album-retroscope");
}
