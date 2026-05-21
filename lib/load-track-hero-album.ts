import { pickCanonicalCoverForAlbum } from "@/lib/canonical-artwork-overrides";
import { resolveAlbumCoverUrl } from "@/lib/canonical-graph";
import { integrityQuery, isCanonicalGraphEnabled } from "@/lib/canonical-graph";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { hrefForAlbum } from "@/lib/retroverse-routes";
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

async function loadCoverForAlbum(albumId: string): Promise<string | null> {
  const rval = normalizeRvalId(albumId);
  if (!rval) return null;

  const fromGraph = await resolveAlbumCoverUrl(rval);
  if (fromGraph) return fromGraph;

  const picked = await pickCanonicalCoverForAlbum(rval);
  if (picked.path?.trim()) {
    return canonicalCoverPathToUrl(picked.path, { cacheBust: picked.cacheBust });
  }

  const supabase = tryCreateClient();
  if (!supabase) return null;
  const rows = await loadAlbumArtworkRows(supabase, [rval]);
  const path = selectCanonicalArtwork(rows, rval, null)?.canonical_cover_path ?? null;
  return canonicalCoverPathToUrl(path);
}

async function graphAlbumForTrack(
  artist: string,
  title: string,
  retroverseTrackId?: string | null,
): Promise<TrackHeroAlbumCandidate | null> {
  if (!isCanonicalGraphEnabled()) return null;
  const rvtr = retroverseTrackId?.trim().toUpperCase();
  if (!title.trim() && !rvtr) return null;

  try {
    const rows = await integrityQuery<{
      album_id: string;
      album_title: string;
      release_year: number | null;
    }>(
      `
      SELECT
        upper(trim(aek.external_key)) AS album_id,
        al.title AS album_title,
        al.release_year
      FROM canonical_tracks ct
      JOIN artists ar ON ar.id = ct.artist_id
      JOIN canonical_album_tracks cat ON (
        (cat.canonical_track_key IS NOT NULL AND cat.canonical_track_key = ct.track_id)
        OR lower(trim(cat.title)) = lower(trim(ct.canonical_title))
      )
      JOIN albums al ON al.id = cat.album_id
      JOIN album_external_keys aek ON aek.album_id = al.id
      WHERE lower(trim(ar.canonical_name)) = lower(trim($1))
        AND (
          ($3::text IS NOT NULL AND ct.track_id = $3)
          OR lower(trim(ct.canonical_title)) = lower(trim($2))
          OR (
            cat.canonical_track_key IS NOT NULL
            AND cat.canonical_track_key = ct.track_id
          )
        )
      ORDER BY
        CASE WHEN cat.canonical_track_key = ct.track_id THEN 0 ELSE 1 END,
        cat.disc_number NULLS FIRST,
        cat.track_number NULLS FIRST,
        al.release_year DESC NULLS LAST
      LIMIT 1
      `,
      [artist, title, rvtr && RE_RVTR.test(rvtr) ? rvtr : null],
    );
    const row = rows[0];
    if (!row) return null;
    return candidateFrom(row.album_id, row.album_title, row.release_year);
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

/**
 * Resolve the best album link for a track hero (source album or first known album).
 * Loads cover art when available.
 */
export async function resolveTrackHeroAlbum(input: {
  artist: string;
  title: string;
  retroverseTrackId?: string | null;
  /** Ordered fallbacks — first valid RVAL wins. */
  candidates?: TrackHeroAlbumCandidate[];
}): Promise<TrackHeroAlbumResolved | null> {
  const ordered: TrackHeroAlbumCandidate[] = [];

  for (const c of input.candidates ?? []) {
    const norm = candidateFrom(c.albumId, c.albumTitle, c.releaseYear);
    if (norm) ordered.push(norm);
  }

  const graph = await graphAlbumForTrack(input.artist, input.title, input.retroverseTrackId);
  if (graph) ordered.push(graph);

  const supa = await supabaseAlbumForTrack(input.retroverseTrackId);
  if (supa) ordered.push(supa);

  const pick = ordered[0];
  if (!pick) return null;

  const href = hrefForAlbum(pick.albumId, pick.albumTitle);
  const coverUrl = await loadCoverForAlbum(pick.albumId);

  return {
    albumId: pick.albumId,
    href: href === "/albums" ? `/albums/${pick.albumId}` : href,
    title: pick.albumTitle,
    releaseYear: pick.releaseYear ?? null,
    coverUrl,
  };
}
