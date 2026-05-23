import { hrefForTrack } from "@/lib/retroverse-routes";
import { loadAlbumCanonicalTrackRouteIndex } from "@/lib/load-canonical-track-graph";
import { tryCreateClient } from "@/lib/supabase";

const RE_RVAL = /^RVAL\d{6}$/i;
const RE_RVTR = /^RVTR\d{6}$/i;

/** Normalized title key for dossier row ↔ canonical track matching. */
export function normalizeAlbumTrackTitleKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\s*[-–—]\s*.*\bremaster(?:ed)?\b.*$/i, "")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export type AlbumTrackRouteIndex = Record<string, string>;

function addRoute(map: AlbumTrackRouteIndex, title: string, rvtr: string): void {
  const id = rvtr.trim().toUpperCase();
  if (!RE_RVTR.test(id)) return;
  const href = hrefForTrack(id);
  if (href === "/track-deck") return;
  const key = normalizeAlbumTrackTitleKey(title);
  if (key && !map[key]) map[key] = href;
}

/** Resolve canonical `/tracks/RVTR…` hrefs — graph first, Supabase fallback. */
export async function loadAlbumTrackRouteIndex(
  albumId: string,
  artistName: string,
): Promise<AlbumTrackRouteIndex> {
  const graphIndex = await loadAlbumCanonicalTrackRouteIndex(albumId);
  const map: AlbumTrackRouteIndex = { ...graphIndex };

  const rval = albumId.trim().toUpperCase();
  const artist = artistName.trim();
  if (!artist) return map;

  const supabase = tryCreateClient();
  if (!supabase) return map;

  if (RE_RVAL.test(rval)) {
    const originRows = await supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title")
      .eq("retroverse_album_id", rval);
    if (!originRows.error) {
      for (const row of originRows.data ?? []) {
        addRoute(map, row.canonical_title ?? "", row.retroverse_track_id);
      }
    }

    const editionRows = await supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id")
      .eq("retroverse_album_id", rval);
    const editionIds = (editionRows.data ?? [])
      .map((r) => r.retroverse_album_edition_id as string)
      .filter(Boolean);

    if (editionIds.length) {
      const membership = await supabase
        .from("retroverse_album_tracks")
        .select("retroverse_track_id")
        .in("retroverse_album_edition_id", editionIds);
      const trackIds = [
        ...new Set(
          (membership.data ?? [])
            .map((r) => r.retroverse_track_id as string)
            .filter((id) => RE_RVTR.test(id)),
        ),
      ];
      if (trackIds.length) {
        const trackRows = await supabase
          .from("retroverse_tracks")
          .select("retroverse_track_id, canonical_title")
          .in("retroverse_track_id", trackIds);
        if (!trackRows.error) {
          for (const row of trackRows.data ?? []) {
            addRoute(map, row.canonical_title ?? "", row.retroverse_track_id);
          }
        }
      }
    }
  }

  const artistRows = await supabase
    .from("retroverse_artists")
    .select("retroverse_artist_id, canonical_artist_name")
    .ilike("canonical_artist_name", artist)
    .limit(8);
  const artistId = (artistRows.data ?? []).find(
    (r) => normalizeAlbumTrackTitleKey(r.canonical_artist_name ?? "") === normalizeAlbumTrackTitleKey(artist),
  )?.retroverse_artist_id;

  if (artistId) {
    const artistTracks = await supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title")
      .eq("retroverse_artist_id", artistId)
      .limit(500);
    if (!artistTracks.error) {
      for (const row of artistTracks.data ?? []) {
        addRoute(map, row.canonical_title ?? "", row.retroverse_track_id);
      }
    }
  }

  return map;
}

export function resolveAlbumTrackHref(
  title: string,
  spotifyTrackId: string | null | undefined,
  routeIndex: AlbumTrackRouteIndex,
): string | null {
  const rawId = spotifyTrackId?.trim() ?? "";
  if (rawId && RE_RVTR.test(rawId)) {
    const href = hrefForTrack(rawId);
    return href !== "/track-deck" ? href : null;
  }
  const key = normalizeAlbumTrackTitleKey(title);
  return key ? (routeIndex[key] ?? null) : null;
}
