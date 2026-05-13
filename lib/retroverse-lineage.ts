import type { SupabaseClient } from "@supabase/supabase-js";

export type TrackLineageAppearance = {
  retroverseAlbumId: string;
  canonicalAlbumTitle: string;
  albumType: string | null;
  soundtrackFlag: boolean;
  albumReleaseYear: number | null;
  retroverseAlbumEditionId: string;
  editionName: string;
  editionReleaseDate: string | null;
  editionReleaseYear: number | null;
  discNumber: number;
  trackNumber: number;
  sideCode: string | null;
  appearanceContext:
    | "original_album_anchor"
    | "same_album_variant"
    | "later_compilation_reuse"
    | "later_soundtrack_reuse"
    | "later_live_reuse"
    | "later_reissue_or_recut"
    | "cross_context_membership";
};

export type TrackLineage = {
  retroverseTrackId: string;
  canonicalTitle: string;
  retroverseArtistId: string;
  retroverseOriginAlbumId: string | null;
  originalReleaseYear: number | null;
  appearances: TrackLineageAppearance[];
};

type TrackCoreRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  retroverse_album_id: string | null;
  release_year: number | null;
};

type MembershipRow = {
  retroverse_album_edition_id: string;
  disc_number: number;
  track_number: number;
  side_code: string | null;
  retroverse_album_editions: Array<{
    retroverse_album_id: string;
    edition_name: string;
    release_date: string | null;
    release_year: number | null;
    retroverse_albums: Array<{
      canonical_album_title: string;
      album_type: string | null;
      soundtrack_flag: boolean;
      release_year: number | null;
    }>;
  }> | null;
};

function contextForAppearance(args: {
  originAlbumId: string | null;
  appearanceAlbumId: string;
  albumType: string | null;
  soundtrackFlag: boolean;
  appearanceYear: number | null;
  trackYear: number | null;
}): TrackLineageAppearance["appearanceContext"] {
  if (args.originAlbumId && args.appearanceAlbumId === args.originAlbumId) {
    return "original_album_anchor";
  }
  if (args.albumType === "compilation" && args.trackYear !== null && args.appearanceYear !== null && args.trackYear < args.appearanceYear) {
    return "later_compilation_reuse";
  }
  if (args.soundtrackFlag && args.trackYear !== null && args.appearanceYear !== null && args.trackYear < args.appearanceYear) {
    return "later_soundtrack_reuse";
  }
  if (args.albumType === "live" && args.trackYear !== null && args.appearanceYear !== null && args.trackYear < args.appearanceYear) {
    return "later_live_reuse";
  }
  if (
    args.trackYear !== null &&
    args.appearanceYear !== null &&
    args.trackYear <= args.appearanceYear &&
    (args.albumType === "studio" || args.albumType === "other" || args.albumType === "ep" || args.albumType === "single")
  ) {
    return "later_reissue_or_recut";
  }
  return "cross_context_membership";
}

function sortAppearance(a: TrackLineageAppearance, b: TrackLineageAppearance): number {
  const aYear = a.editionReleaseYear ?? a.albumReleaseYear ?? 9999;
  const bYear = b.editionReleaseYear ?? b.albumReleaseYear ?? 9999;
  if (aYear !== bYear) return aYear - bYear;
  if (a.canonicalAlbumTitle !== b.canonicalAlbumTitle) return a.canonicalAlbumTitle.localeCompare(b.canonicalAlbumTitle);
  if (a.discNumber !== b.discNumber) return a.discNumber - b.discNumber;
  return a.trackNumber - b.trackNumber;
}

export async function loadTrackLineage(
  supabase: SupabaseClient,
  retroverseTrackId: string,
): Promise<TrackLineage | null> {
  const trackResult = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, release_year")
    .eq("retroverse_track_id", retroverseTrackId)
    .limit(1)
    .maybeSingle<TrackCoreRow>();

  if (trackResult.error) throw trackResult.error;
  if (!trackResult.data) return null;
  const track = trackResult.data;

  const membershipResult = await supabase
    .from("retroverse_album_tracks")
    .select(
      "retroverse_album_edition_id, disc_number, track_number, side_code, retroverse_album_editions!inner(retroverse_album_id, edition_name, release_date, release_year, retroverse_albums!inner(canonical_album_title, album_type, soundtrack_flag, release_year))",
    )
    .eq("retroverse_track_id", retroverseTrackId);

  if (membershipResult.error) throw membershipResult.error;
  const rows = (membershipResult.data ?? []) as MembershipRow[];

  const appearances: TrackLineageAppearance[] = rows
    .filter((row) => row.retroverse_album_editions !== null && row.retroverse_album_editions.length > 0)
    .map((row) => {
      const edition = row.retroverse_album_editions![0];
      const album = edition.retroverse_albums[0];
      if (!album) {
        return null;
      }
      const albumId = edition.retroverse_album_id;
      return {
        retroverseAlbumId: albumId,
        canonicalAlbumTitle: album.canonical_album_title,
        albumType: album.album_type,
        soundtrackFlag: album.soundtrack_flag,
        albumReleaseYear: album.release_year,
        retroverseAlbumEditionId: row.retroverse_album_edition_id,
        editionName: edition.edition_name,
        editionReleaseDate: edition.release_date,
        editionReleaseYear: edition.release_year,
        discNumber: row.disc_number,
        trackNumber: row.track_number,
        sideCode: row.side_code,
        appearanceContext: contextForAppearance({
          originAlbumId: track.retroverse_album_id,
          appearanceAlbumId: albumId,
          albumType: album.album_type,
          soundtrackFlag: album.soundtrack_flag,
          appearanceYear: edition.release_year ?? album.release_year,
          trackYear: track.release_year,
        }),
      };
    })
    .filter((row): row is TrackLineageAppearance => row !== null)
    .sort(sortAppearance);

  return {
    retroverseTrackId: track.retroverse_track_id,
    canonicalTitle: track.canonical_title,
    retroverseArtistId: track.retroverse_artist_id,
    retroverseOriginAlbumId: track.retroverse_album_id,
    originalReleaseYear: track.release_year,
    appearances,
  };
}
