import { pickCanonicalCoverForAlbum } from "@/lib/canonical-artwork-overrides";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { resolveAlbumCoverUrl } from "@/lib/canonical-graph";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { hrefForAlbum } from "@/lib/retroverse-routes";
import { resolvePrimaryTrackAlbumFromGraph } from "@/lib/resolve-primary-track-album";
import { tryCreateClient } from "@/lib/supabase";

const RE_RVAL = /^RVAL\d{6}$/i;
const RE_RVTR = /^RVTR\d{6}$/i;

export type TrackHeroAlbumCandidate = {
  albumId: string;
  albumTitle: string;
  releaseYear?: number | null;
};

export type TrackHeroAlbumResolved = {
  albumId: string;
  href: string;
  title: string;
  releaseYear: number | null;
  coverUrl: string | null;
};

function normalizeRvalId(id: string): string | null {
  const u = id.trim().toUpperCase();
  return RE_RVAL.test(u) ? u : null;
}

function candidateFrom(
  albumId: string | null | undefined,
  albumTitle: string | null | undefined,
  releaseYear?: number | null,
): TrackHeroAlbumCandidate | null {
  const id = normalizeRvalId(albumId ?? "");
  const title = albumTitle?.trim();
  if (!id || !title) return null;
  return { albumId: id, albumTitle: title, releaseYear: releaseYear ?? null };
}

async function loadCoverForAlbum(albumId: string, pgAlbumId?: number): Promise<string | null> {
  const rval = normalizeRvalId(albumId);
  if (!rval && pgAlbumId == null) return null;

  if (rval) {
    const fromGraph = await resolveAlbumCoverUrl(rval, { pgAlbumId });
    if (fromGraph) return fromGraph;

    const picked = await pickCanonicalCoverForAlbum(rval);
    if (picked.path?.trim()) {
      return canonicalCoverPathToUrl(picked.path, { cacheBust: picked.cacheBust });
    }
  } else if (pgAlbumId != null) {
    const fromGraph = await resolveAlbumCoverUrl(`PG:${pgAlbumId}`, { pgAlbumId });
    if (fromGraph) return fromGraph;
  }

  if (!rval) return null;

  try {
    const supabase = tryCreateClient();
    if (!supabase) return null;
    const rows = await loadAlbumArtworkRows(supabase, [rval]);
    const path = selectCanonicalArtwork(rows, rval, null)?.canonical_cover_path ?? null;
    return canonicalCoverPathToUrl(path);
  } catch {
    return null;
  }
}

async function supabaseAlbumForTrack(
  retroverseTrackId: string | null | undefined,
): Promise<TrackHeroAlbumCandidate | null> {
  const rvtr = retroverseTrackId?.trim().toUpperCase();
  if (!rvtr || !RE_RVTR.test(rvtr)) return null;

  const supabase = tryCreateClient();
  if (!supabase) return null;

  const trackResult = await supabase
    .from("retroverse_tracks")
    .select("retroverse_album_id, release_year")
    .eq("retroverse_track_id", rvtr)
    .limit(1)
    .maybeSingle();

  const albumId = trackResult.data?.retroverse_album_id ?? null;
  if (!albumId) return null;

  const albumResult = await supabase
    .from("retroverse_albums")
    .select("retroverse_album_id, canonical_album_title, release_year")
    .eq("retroverse_album_id", albumId)
    .limit(1)
    .maybeSingle();

  if (!albumResult.data) return null;
  return candidateFrom(
    albumResult.data.retroverse_album_id,
    albumResult.data.canonical_album_title,
    trackResult.data?.release_year ?? albumResult.data.release_year,
  );
}

function heroFromGraphPrimary(
  primary: Awaited<ReturnType<typeof resolvePrimaryTrackAlbumFromGraph>>,
): TrackHeroAlbumResolved | null {
  if (!primary) return null;
  const rval = normalizeRvalId(primary.albumId);
  return {
    albumId: rval ?? primary.albumId,
    href: primary.href,
    title: primary.title,
    releaseYear: primary.releaseYear,
    coverUrl: primary.coverUrl,
  };
}

async function heroFromCandidate(
  pick: TrackHeroAlbumCandidate,
  pgAlbumId?: number,
): Promise<TrackHeroAlbumResolved | null> {
  const href = hrefForAlbum(pick.albumId, pick.albumTitle);
  let coverUrl: string | null = null;
  try {
    coverUrl = await loadCoverForAlbum(pick.albumId, pgAlbumId);
  } catch {
    coverUrl = null;
  }
  return {
    albumId: pick.albumId,
    href: href === "/albums" ? `/albums/${pick.albumId}` : href,
    title: pick.albumTitle,
    releaseYear: pick.releaseYear ?? null,
    coverUrl,
  };
}

/**
 * Resolve the PRIMARY album for a track hero (graph-native, deterministic).
 * Legacy candidates and Supabase are fallback-only.
 */
export async function resolveTrackHeroAlbum(input: {
  artist: string;
  title: string;
  retroverseTrackId?: string | null;
  /** Fallback-only — graph PRIMARY wins when present. */
  candidates?: TrackHeroAlbumCandidate[];
}): Promise<TrackHeroAlbumResolved | null> {
  const graphPrimary = await resolvePrimaryTrackAlbumFromGraph({
    artist: input.artist,
    title: input.title,
    retroverseTrackId: input.retroverseTrackId,
  });
  const fromGraph = heroFromGraphPrimary(graphPrimary);
  if (fromGraph) return fromGraph;

  for (const c of input.candidates ?? []) {
    const norm = candidateFrom(c.albumId, c.albumTitle, c.releaseYear);
    if (norm) return heroFromCandidate(norm);
  }

  const supa = await supabaseAlbumForTrack(input.retroverseTrackId);
  if (supa) return heroFromCandidate(supa);

  return null;
}
