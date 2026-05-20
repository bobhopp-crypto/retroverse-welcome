import type { AlbumDossierTrack } from "@/lib/album-dossier-schema";
import {
  aggregateAcousticMeans,
  applyRumoursStemAlias,
  groupTracksByCanonicalStem,
  splitCanonicalStem,
  type AggregatedAcousticProfile,
} from "@/lib/canonical-acoustic-aggregate";
import { getCanonicalAlbumSequence, type CanonicalAlbumSequence } from "@/lib/canonical-album-sequences";
import type { CanonicalAlbumGraphTrack } from "@/lib/load-canonical-album-graph-tracks";
import {
  getDossierMusicBrainzSidecar,
  type DossierMbSidecarAlbum,
  type DossierMbSidecarTrack,
} from "@/lib/load-dossier-musicbrainz-sidecar";
import { RUMOURS_DOSSIER_PROOF_RVAL } from "@/lib/rumours-proof-poc";
import { curateTrackSignals } from "@/lib/signal-curation";

export type DossierDisplayTrack = AlbumDossierTrack & {
  canonicalRefLabel?: string;
  canonicalSequenceLabel?: string;
};

export type DossierTrackRow = {
  track: DossierDisplayTrack;
  profile: AggregatedAcousticProfile;
  position: number | string;
  retroverseDial: number;
};

export type BuildDossierTrackRowsOptions = {
  /** Persistent graph sequence (highest priority when present). */
  graphTracks?: CanonicalAlbumGraphTrack[] | null;
  /** Preloaded sidecar (skips loader); album dossier pages should pass when available. */
  mbSidecar?: DossierMbSidecarAlbum | null;
};

const HARD_POLLUTED_ACOUSTIC_ROW =
  /\b(2008|25th|anniversary|interview|voice[- ]?over|excerpt|karaoke|quincy|carousel|for all time|bonus|deluxe|rough|outtake|sessions?|alternate|underground|home demo|remix|reprise)\b/i;

const SOFT_VARIANT_ACOUSTIC_ROW = /\b(single version|remaster(?:ed)?|demo|mix)\b/i;

function normalizeCanonicalTitle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/\s*[-–—]\s*.*\bremaster(?:ed)?\b.*$/i, "")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isPollutedAcousticTitle(title: string): boolean {
  return HARD_POLLUTED_ACOUSTIC_ROW.test(title);
}

function resolveCanonicalSequenceTracks(
  sequence: CanonicalAlbumSequence,
  sourceTracks: AlbumDossierTrack[],
): DossierDisplayTrack[] {
  const sourceByTitle = new Map<string, AlbumDossierTrack>();
  const sourceByRawTitle = new Map<string, AlbumDossierTrack>();
  for (const track of sourceTracks) {
    const key = normalizeCanonicalTitle(track.title);
    if (key && !sourceByTitle.has(key)) sourceByTitle.set(key, track);
    sourceByRawTitle.set(track.title.trim(), track);
  }

  return sequence.tracks.map((track) => {
    const source = track.source_title
      ? sourceByRawTitle.get(track.source_title.trim()) ??
        sourceByTitle.get(normalizeCanonicalTitle(track.source_title))
      : sourceByTitle.get(normalizeCanonicalTitle(track.canonical_title));

    return enrichCanonicalDisplayTrack(track.canonical_title, track.global_position, source, {
      canonicalRefLabel: sequence.source_label,
      canonicalSequenceLabel:
        track.side_label && track.side_position != null
          ? `${track.side_label}${track.side_position}`
          : String(track.global_position),
      duration_ms: track.duration_ms ?? source?.duration_ms ?? null,
    });
  });
}

function scoreAcousticMatch(canonicalTitle: string, candidate: AlbumDossierTrack, expectedPosition?: number): number {
  const canonNorm = normalizeCanonicalTitle(canonicalTitle);
  const titleNorm = normalizeCanonicalTitle(candidate.title);
  const stemNorm = normalizeCanonicalTitle(splitCanonicalStem(candidate.title));
  let score = 0;

  if (titleNorm === canonNorm || stemNorm === canonNorm) score += 120;
  else if (titleNorm.startsWith(`${canonNorm} `) || stemNorm.startsWith(`${canonNorm} `)) score += 70;
  else if (canonNorm.length >= 4 && (titleNorm.includes(canonNorm) || stemNorm.includes(canonNorm))) score += 35;

  if (isPollutedAcousticTitle(candidate.title)) score -= 150;
  else if (SOFT_VARIANT_ACOUSTIC_ROW.test(candidate.title) && stemNorm !== canonNorm) score -= 90;
  else if (SOFT_VARIANT_ACOUSTIC_ROW.test(candidate.title) && stemNorm === canonNorm) score -= 8;

  const mbPos = candidate.musicbrainz?.position;
  if (
    expectedPosition != null &&
    typeof mbPos === "number" &&
    Number.isFinite(mbPos) &&
    mbPos === expectedPosition
  ) {
    score += 45;
  }

  if (candidate.energy != null || candidate.valence != null) score += 5;

  return score;
}

function findAcousticEnrichment(
  canonicalTitle: string,
  sourceTracks: AlbumDossierTrack[],
  expectedPosition?: number,
): AlbumDossierTrack | undefined {
  let best: AlbumDossierTrack | undefined;
  let bestScore = 0;

  for (const candidate of sourceTracks) {
    if (isPollutedAcousticTitle(candidate.title)) continue;
    const score = scoreAcousticMatch(canonicalTitle, candidate, expectedPosition);
    if (score > bestScore) {
      bestScore = score;
      best = candidate;
    }
  }

  return bestScore >= 50 ? best : undefined;
}

function enrichCanonicalDisplayTrack(
  canonicalTitle: string,
  position: number,
  source: AlbumDossierTrack | undefined,
  extra: Partial<DossierDisplayTrack>,
): DossierDisplayTrack {
  const base: AlbumDossierTrack = source
    ? {
        acousticness: source.acousticness,
        danceability: source.danceability,
        duration_ms: source.duration_ms,
        energy: source.energy,
        instrumentalness: source.instrumentalness,
        key: source.key,
        key_label: source.key_label,
        liveness: source.liveness,
        loudness: source.loudness,
        mode: source.mode,
        speechiness: source.speechiness,
        tempo: source.tempo,
        time_signature: source.time_signature,
        valence: source.valence,
        spotify_album_id: source.spotify_album_id,
        spotify_track_id: source.spotify_track_id,
        retroverse_score: source.retroverse_score,
        musicbrainz: { ...(source.musicbrainz ?? {}), position },
      }
    : {
        title: canonicalTitle,
        duration_ms: null,
        musicbrainz: { position },
      };

  return {
    ...base,
    title: canonicalTitle,
    duration_ms: extra.duration_ms ?? base.duration_ms ?? null,
    ...extra,
  };
}

function graphTrackToDossierTrack(row: CanonicalAlbumGraphTrack): AlbumDossierTrack {
  const durationMs =
    row.duration_seconds != null && Number.isFinite(row.duration_seconds)
      ? Math.round(row.duration_seconds * 1000)
      : null;
  return {
    title: row.canonical_title,
    duration_ms: durationMs,
    acousticness: row.acousticness,
    danceability: row.danceability,
    energy: row.energy,
    valence: row.valence,
    liveness: row.liveness,
    speechiness: row.speechiness,
    tempo: row.tempo,
    loudness: row.loudness,
    instrumentalness: row.instrumentalness,
    musicbrainz: { position: row.position },
  };
}

function resolveGraphCanonicalTracks(
  graphTracks: CanonicalAlbumGraphTrack[],
  sourceTracks: AlbumDossierTrack[],
): DossierDisplayTrack[] {
  return [...graphTracks]
    .sort((a, b) => a.position - b.position)
    .map((row) => {
      const source = findAcousticEnrichment(row.canonical_title, sourceTracks, row.position);
      const merged = source ?? graphTrackToDossierTrack(row);
      return enrichCanonicalDisplayTrack(row.canonical_title, row.position, merged, {
        canonicalRefLabel: row.canonical_source,
        canonicalSequenceLabel: String(row.position),
        duration_ms:
          merged.duration_ms ??
          (row.duration_seconds != null ? Math.round(row.duration_seconds * 1000) : null),
      });
    });
}

function resolveMusicBrainzSidecarTracks(
  sidecar: DossierMbSidecarAlbum,
  sourceTracks: AlbumDossierTrack[],
): DossierDisplayTrack[] {
  const ordered = [...sidecar.tracks].sort((a, b) => a.position - b.position);
  return ordered.map((row: DossierMbSidecarTrack) => {
    const source = findAcousticEnrichment(row.title, sourceTracks, row.position);
    return enrichCanonicalDisplayTrack(row.title, row.position, source, {
      canonicalRefLabel: "musicbrainz_cache",
      canonicalSequenceLabel: String(row.position),
    });
  });
}

function resolveMusicBrainzPositionTracks(sourceTracks: AlbumDossierTrack[]): DossierDisplayTrack[] {
  const positioned = sourceTracks
    .filter((t) => {
      const pos = t.musicbrainz?.position;
      return typeof pos === "number" && Number.isFinite(pos) && pos > 0 && !isPollutedAcousticTitle(t.title);
    })
    .sort((a, b) => (a.musicbrainz!.position! as number) - (b.musicbrainz!.position! as number));

  const seen = new Set<number>();
  const out: DossierDisplayTrack[] = [];

  for (const track of positioned) {
    const pos = track.musicbrainz!.position as number;
    if (seen.has(pos)) continue;
    seen.add(pos);
    const title = splitCanonicalStem(track.title).trim() || track.title;
    out.push(
      enrichCanonicalDisplayTrack(title, pos, track, {
        canonicalRefLabel: "musicbrainz_dossier_position",
        canonicalSequenceLabel: String(pos),
      }),
    );
  }

  return out;
}

/** Fallback: shortest clean primary-stem set in source order (no MB sidecar). */
function resolveCleanAcousticFallbackTracks(sourceTracks: AlbumDossierTrack[]): DossierDisplayTrack[] {
  const cleanPool = sourceTracks.filter((t) => !isPollutedAcousticTitle(t.title));
  const curated = curateTrackSignals(cleanPool).filter((t) => t.signalTier === "primary");

  const seen = new Set<string>();
  const ordered: DossierDisplayTrack[] = [];
  let position = 1;

  for (const track of curated) {
    const stem = splitCanonicalStem(track.title).trim().toLowerCase();
    if (!stem || seen.has(stem)) continue;
    seen.add(stem);
    ordered.push(
      enrichCanonicalDisplayTrack(stem.trim() || track.title, position, track, {
        canonicalRefLabel: "clean_acoustic_fallback",
        canonicalSequenceLabel: String(position),
      }),
    );
    position += 1;
  }

  if (ordered.length >= 3) return ordered;

  for (const track of cleanPool) {
    const stem = splitCanonicalStem(track.title).trim().toLowerCase();
    if (!stem || seen.has(stem)) continue;
    seen.add(stem);
    ordered.push(
      enrichCanonicalDisplayTrack(stem.trim() || track.title, position, track, {
        canonicalRefLabel: "clean_acoustic_fallback",
        canonicalSequenceLabel: String(position),
      }),
    );
    position += 1;
  }

  return ordered;
}

function trackPosition(track: DossierDisplayTrack, fallbackIndex: number): number | string {
  if (track.canonicalSequenceLabel) return track.canonicalSequenceLabel;
  const pos = track.musicbrainz?.position;
  return typeof pos === "number" && Number.isFinite(pos) && pos > 0 ? pos : fallbackIndex + 1;
}

function retroverseDialFromTrack(track: AlbumDossierTrack, profile: AggregatedAcousticProfile): number {
  if (track.retroverse_score != null && Number.isFinite(track.retroverse_score)) {
    return Math.min(99, Math.max(0, Math.round(track.retroverse_score)));
  }
  const pts: number[] = [];
  for (const n of [profile.energy, profile.valence, profile.danceability, profile.liveness]) {
    if (n != null && Number.isFinite(n)) pts.push(n);
  }
  if (!pts.length) return 0;
  return Math.min(99, Math.round((pts.reduce((a, b) => a + b, 0) / pts.length) * 100));
}

function profileForTrack(
  track: DossierDisplayTrack,
  grouped: Map<string, { profile: AggregatedAcousticProfile }>,
  stemAlias?: (stem: string) => string,
): AggregatedAcousticProfile {
  let stem = splitCanonicalStem(track.title);
  if (stemAlias) stem = stemAlias(stem);
  const bucket = grouped.get(stem.trim().toLowerCase());
  if (bucket) return bucket.profile;
  return aggregateAcousticMeans([track]);
}

/**
 * Album dossier track rows — graph / canonical sequence only; acoustic is enrichment, never primary order.
 * Priority: graph canonical_album_tracks → manual JSON → MB sidecar → dossier MB positions → clean acoustic fallback.
 */
export function buildDossierTrackRows(
  albumId: string,
  sourceTracks: AlbumDossierTrack[],
  options?: BuildDossierTrackRowsOptions,
): DossierTrackRow[] {
  const stemAlias = albumId === RUMOURS_DOSSIER_PROOF_RVAL ? applyRumoursStemAlias : undefined;
  const grouped = groupTracksByCanonicalStem(sourceTracks, stemAlias);
  const graphTracks = options?.graphTracks ?? null;
  const manualSequence = getCanonicalAlbumSequence(albumId);
  const mbSidecar = options?.mbSidecar ?? getDossierMusicBrainzSidecar(albumId);

  let displayTracks: DossierDisplayTrack[];

  if (graphTracks?.length) {
    displayTracks = resolveGraphCanonicalTracks(graphTracks, sourceTracks);
  } else if (manualSequence) {
    displayTracks = resolveCanonicalSequenceTracks(manualSequence, sourceTracks);
  } else if (mbSidecar?.tracks?.length) {
    displayTracks = resolveMusicBrainzSidecarTracks(mbSidecar, sourceTracks);
  } else {
    const fromPositions = resolveMusicBrainzPositionTracks(sourceTracks);
    if (fromPositions.length >= 3) {
      displayTracks = fromPositions;
    } else {
      displayTracks = resolveCleanAcousticFallbackTracks(sourceTracks);
    }
  }

  return displayTracks.map((track, i) => {
    const profile = profileForTrack(track, grouped, stemAlias);
    const graphScore = graphTracks?.find((g) => g.position === (track.musicbrainz?.position ?? i + 1))
      ?.signal_score;
    const dial =
      graphScore != null && Number.isFinite(graphScore)
        ? Math.min(99, Math.max(0, Math.round(graphScore)))
        : retroverseDialFromTrack(track, profile);
    return {
      track,
      profile,
      position: trackPosition(track, i),
      retroverseDial: dial,
    };
  });
}
