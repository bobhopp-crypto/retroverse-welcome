import { integrityQuery, isCanonicalGraphEnabled } from "@/lib/canonical-graph";

export type CanonicalAlbumGraphTrack = {
  id: number;
  album_id: number;
  retroverse_album_key: string | null;
  position: number;
  canonical_title: string;
  duration_seconds: number | null;
  acoustic_source_id: number | null;
  canonical_source: string;
  confidence_score: number;
  review_flag: string;
  acoustic_title: string | null;
  acousticness: number | null;
  danceability: number | null;
  energy: number | null;
  valence: number | null;
  liveness: number | null;
  speechiness: number | null;
  tempo: number | null;
  loudness: number | null;
  instrumentalness: number | null;
  signal_score: number | null;
};

/** Persistent canonical sequence from local Postgres graph (via album_external_keys). */
export async function loadCanonicalAlbumGraphTracks(
  albumId: string,
): Promise<CanonicalAlbumGraphTrack[] | null> {
  const rval = albumId?.trim().toUpperCase();
  if (!rval || !/^RVAL\d{6}$/.test(rval)) return null;
  if (!isCanonicalGraphEnabled()) return null;

  try {
    const rows = await integrityQuery<CanonicalAlbumGraphTrack>(
      `
      SELECT
        id,
        album_id,
        retroverse_album_key,
        position,
        canonical_title,
        duration_seconds,
        acoustic_source_id,
        canonical_source,
        confidence_score::float8 AS confidence_score,
        review_flag,
        acoustic_title,
        acousticness,
        danceability,
        energy,
        valence,
        liveness,
        speechiness,
        tempo,
        loudness,
        instrumentalness,
        signal_score
      FROM canonical_album_track_display
      WHERE retroverse_album_key = $1
      ORDER BY position ASC
      `,
      [rval],
    );
    return rows.length ? rows : null;
  } catch {
    return null;
  }
}
