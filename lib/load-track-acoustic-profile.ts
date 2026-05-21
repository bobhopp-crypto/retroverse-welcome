import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";
import { integrityQuery, isCanonicalGraphEnabled } from "@/lib/canonical-graph";
import { normalizeAlbumTrackTitleKey } from "@/lib/load-album-track-routes";

const EMPTY_PROFILE: AggregatedAcousticProfile = {
  energy: null,
  valence: null,
  danceability: null,
  liveness: null,
  speechiness: null,
  tempo: null,
  loudness: null,
  duration_ms: null,
  instrumentalness: null,
  acousticness: null,
};

export async function loadTrackAcousticProfile(
  artist: string,
  title: string,
  retroverseTrackId?: string | null,
): Promise<AggregatedAcousticProfile> {
  const rvtr = retroverseTrackId?.trim().toUpperCase();
  if (rvtr && /^RVTR\d{6}$/.test(rvtr) && isCanonicalGraphEnabled()) {
    const fromGraph = await loadAcousticFromGraph(rvtr);
    if (fromGraph) return fromGraph;
  }

  const resolved = rvtr ?? (await resolveTrackRetroverseId(artist, title));
  if (resolved) {
    const fromGraph = await loadAcousticFromGraph(resolved);
    if (fromGraph) return fromGraph;
  }

  return EMPTY_PROFILE;
}

export async function resolveTrackRetroverseId(
  artist: string,
  title: string,
): Promise<string | null> {
  if (!normalizeAlbumTrackTitleKey(title) || !isCanonicalGraphEnabled()) return null;

  try {
    const rows = await integrityQuery<{ track_id: string }>(
      `
      SELECT track_id
      FROM canonical_track_display
      WHERE lower(trim(canonical_title)) = lower(trim($1))
        AND lower(trim(coalesce(canonical_artist_name, ''))) = lower(trim($2))
      ORDER BY has_hot100 DESC, peak_hot100_position ASC NULLS LAST
      LIMIT 1
      `,
      [title, artist],
    );
    const id = rows[0]?.track_id?.trim().toUpperCase();
    return id && /^RVTR\d{6}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}

async function loadAcousticFromGraph(trackId: string): Promise<AggregatedAcousticProfile | null> {
  try {
    const rows = await integrityQuery<{
      acousticness: number | null;
      danceability: number | null;
      energy: number | null;
      valence: number | null;
      liveness: number | null;
      speechiness: number | null;
      tempo: number | null;
      loudness: number | null;
      instrumentalness: number | null;
      source_duration: number | null;
    }>(
      `
      SELECT
        sat.acousticness,
        sat.danceability,
        sat.energy,
        sat.valence,
        sat.liveness,
        sat.speechiness,
        sat.tempo,
        sat.loudness,
        sat.instrumentalness,
        sat.source_duration
      FROM canonical_track_versions v
      JOIN canonical_tracks ct ON ct.id = v.canonical_track_id
      JOIN staging_acoustic_tracks sat ON sat.id = v.acoustic_source_id
      WHERE ct.track_id = $1
      ORDER BY v.is_primary DESC, v.confidence_score DESC
      LIMIT 1
      `,
      [trackId],
    );
    const row = rows[0];
    if (!row) return null;
    return {
      energy: row.energy,
      valence: row.valence,
      danceability: row.danceability,
      liveness: row.liveness,
      speechiness: row.speechiness,
      tempo: row.tempo,
      loudness: row.loudness,
      duration_ms: row.source_duration,
      instrumentalness: row.instrumentalness,
      acousticness: row.acousticness,
    };
  } catch {
    return null;
  }
}
