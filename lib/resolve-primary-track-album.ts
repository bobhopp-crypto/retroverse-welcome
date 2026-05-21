import { resolveAlbumCoverUrl } from "@/lib/canonical-graph";
import { integrityQuery, isCanonicalGraphEnabled } from "@/lib/canonical-graph";
import { normalizeAlbumTrackTitleKey } from "@/lib/load-album-track-routes";
import { hrefForAlbum } from "@/lib/retroverse-routes";

const RE_RVTR = /^RVTR\d{6}$/i;
const RE_RVAL = /^RVAL\d{6}$/i;

export type PrimaryTrackAlbumResolved = {
  albumId: string;
  pgAlbumId: number;
  href: string;
  title: string;
  releaseYear: number | null;
  coverUrl: string | null;
  artistName: string | null;
};

type CanonicalTrackRow = {
  track_id: string;
  canonical_title: string;
  normalized_title_key: string;
  artist_id: number | null;
  track_family_id: number | null;
  canonical_artist_name: string | null;
};

type AlbumCandidateRow = {
  pg_album_id: number;
  album_id: string | null;
  album_title: string;
  release_year: number | null;
  track_title: string | null;
  position: number | null;
  rvtr_key_match: boolean;
  link_source: "canonical_album_tracks" | "canonical_track_album_links";
};

type ScoredAlbumCandidate = {
  pgAlbumId: number;
  albumId: string | null;
  albumTitle: string;
  releaseYear: number | null;
  trackTitle: string | null;
  position: number | null;
  rvtrKeyMatch: boolean;
  linkSource: AlbumCandidateRow["link_source"];
};

/** Penalty tiers — lower total score wins. */
export function primaryAlbumRankScore(albumTitle: string, row: ScoredAlbumCandidate): number {
  const t = albumTitle.toLowerCase();
  let score = 0;
  if (/greatest hits|best of|number ones|anthology|the very best|gold:|platinum collection|super hits|ultimate /.test(t)) {
    score += 100;
  }
  if (/compilation|celebration|essential|definitive|collection|now that's what|pure .+ hits/.test(t)) {
    score += 90;
  }
  if (/soundtrack|motion picture| original cast|music from| ost\b/.test(t)) {
    score += 80;
  }
  if (/deluxe|expanded|anniversary|special edition|bonus tracks|super deluxe|legacy edition/.test(t)) {
    score += 60;
  }
  if (/remaster|re-master|\(\d{4} version\)/.test(t)) {
    score += 50;
  }
  if (/\blive\b|live at|unplugged|concert|mtv unplugged/.test(t)) {
    score += 70;
  }
  if (row.linkSource === "canonical_album_tracks") score -= 5;
  if (row.rvtrKeyMatch) score -= 30;
  return score;
}

function dedupeCandidates(rows: ScoredAlbumCandidate[]): ScoredAlbumCandidate[] {
  const byAlbum = new Map<number, ScoredAlbumCandidate>();
  for (const row of rows) {
    const prev = byAlbum.get(row.pgAlbumId);
    if (!prev) {
      byAlbum.set(row.pgAlbumId, row);
      continue;
    }
    const better =
      primaryAlbumRankScore(row.albumTitle, row) < primaryAlbumRankScore(prev.albumTitle, prev) ||
      (row.rvtrKeyMatch && !prev.rvtrKeyMatch);
    if (better) byAlbum.set(row.pgAlbumId, row);
  }
  return [...byAlbum.values()];
}

export function pickPrimaryAlbumCandidate(
  rows: ScoredAlbumCandidate[],
  normalizedTitleKey: string,
): ScoredAlbumCandidate | null {
  const filtered = rows.filter((row) => {
    if (row.linkSource === "canonical_track_album_links") return true;
    if (row.rvtrKeyMatch) return true;
    const trackTitle = row.trackTitle?.trim();
    if (!trackTitle) return false;
    return normalizeAlbumTrackTitleKey(trackTitle) === normalizedTitleKey;
  });
  const unique = dedupeCandidates(filtered);
  unique.sort((a, b) => {
    const scoreDiff =
      primaryAlbumRankScore(a.albumTitle, a) - primaryAlbumRankScore(b.albumTitle, b);
    if (scoreDiff !== 0) return scoreDiff;
    const yearA = a.releaseYear ?? 9999;
    const yearB = b.releaseYear ?? 9999;
    if (yearA !== yearB) return yearA - yearB;
    const posA = a.position ?? 999;
    const posB = b.position ?? 999;
    if (posA !== posB) return posA - posB;
    return a.pgAlbumId - b.pgAlbumId;
  });
  return unique[0] ?? null;
}

async function loadCanonicalTrackRow(input: {
  retroverseTrackId?: string | null;
  artist: string;
  title: string;
}): Promise<CanonicalTrackRow | null> {
  const rvtr = input.retroverseTrackId?.trim().toUpperCase();
  const hasRvtr = rvtr && RE_RVTR.test(rvtr);
  const artist = input.artist.trim();
  const title = input.title.trim();
  if (!hasRvtr && !title) return null;

  const rows = await integrityQuery<CanonicalTrackRow>(
    `
    SELECT
      ct.track_id,
      ct.canonical_title,
      ct.normalized_title_key,
      ct.artist_id,
      ct.track_family_id,
      coalesce(ar.canonical_name, ct.canonical_artist_name) AS canonical_artist_name
    FROM canonical_tracks ct
    LEFT JOIN artists ar ON ar.id = ct.artist_id
    WHERE
      ($1::text IS NOT NULL AND ct.track_id = $1)
      OR (
        $2::text <> ''
        AND lower(trim(ct.canonical_title)) = lower(trim($2))
        AND (
          $3::text = ''
          OR lower(trim(coalesce(ar.canonical_name, ct.canonical_artist_name))) = lower(trim($3))
        )
      )
    ORDER BY
      CASE WHEN $1::text IS NOT NULL AND ct.track_id = $1 THEN 0 ELSE 1 END,
      CASE
        WHEN $3::text <> ''
          AND lower(trim(coalesce(ar.canonical_name, ct.canonical_artist_name))) = lower(trim($3))
        THEN 0
        ELSE 1
      END,
      ct.id
    LIMIT 1
    `,
    [hasRvtr ? rvtr : null, title, artist],
  );
  return rows[0] ?? null;
}

async function loadAlbumCandidatesForTrack(
  ct: CanonicalTrackRow,
): Promise<ScoredAlbumCandidate[]> {
  const rows = await integrityQuery<AlbumCandidateRow>(
    `
    SELECT
      al.id AS pg_album_id,
      upper(trim(aek.external_key)) AS album_id,
      al.title AS album_title,
      al.release_year,
      cat.title AS track_title,
      cat.position,
      (cat.canonical_track_key = $1) AS rvtr_key_match,
      'canonical_album_tracks'::text AS link_source
    FROM canonical_album_tracks cat
    JOIN albums al ON al.id = cat.album_id
    LEFT JOIN album_external_keys aek ON aek.album_id = al.id
    WHERE
      cat.canonical_track_key = $1
      OR ($2::bigint IS NOT NULL AND cat.track_family_id = $2)
    UNION ALL
    SELECT
      al.id AS pg_album_id,
      upper(trim(aek.external_key)) AS album_id,
      al.title AS album_title,
      al.release_year,
      NULL::text AS track_title,
      ctal.track_number AS position,
      false AS rvtr_key_match,
      'canonical_track_album_links'::text AS link_source
    FROM canonical_track_album_links ctal
    JOIN albums al ON al.id = ctal.album_id
    LEFT JOIN album_external_keys aek ON aek.album_id = al.id
    WHERE $2::bigint IS NOT NULL AND ctal.track_family_id = $2
    `,
    [ct.track_id, ct.track_family_id],
  );

  return rows.map((row) => ({
      pgAlbumId: row.pg_album_id,
      albumId: row.album_id,
      albumTitle: row.album_title,
      releaseYear: row.release_year,
      trackTitle: row.track_title,
      position: row.position,
      rvtrKeyMatch: row.rvtr_key_match,
      linkSource: row.link_source,
    }));
}

/**
 * Deterministic PRIMARY album from the canonical graph.
 * Path: canonical_tracks → canonical_album_tracks (then track_album_links when sequence rows missing).
 */
export async function resolvePrimaryTrackAlbumFromGraph(input: {
  artist: string;
  title: string;
  retroverseTrackId?: string | null;
}): Promise<PrimaryTrackAlbumResolved | null> {
  if (!isCanonicalGraphEnabled()) return null;

  try {
    const ct = await loadCanonicalTrackRow(input);
    if (!ct) return null;

    const rawCandidates = await loadAlbumCandidatesForTrack(ct);
    const artistScoped = await filterCandidatesByArtist(rawCandidates, ct.artist_id, input.artist);
    const pick = pickPrimaryAlbumCandidate(artistScoped, ct.normalized_title_key);
    if (!pick) return null;

    const albumId =
      pick.albumId && RE_RVAL.test(pick.albumId) ? pick.albumId : `PG:${pick.pgAlbumId}`;
    const href = hrefForAlbum(
      pick.albumId && RE_RVAL.test(pick.albumId) ? pick.albumId : null,
      pick.albumTitle,
    );
    const coverUrl = await resolveAlbumCoverUrl(
      pick.albumId && RE_RVAL.test(pick.albumId) ? pick.albumId : albumId,
      { pgAlbumId: pick.pgAlbumId },
    );

    return {
      albumId: pick.albumId && RE_RVAL.test(pick.albumId) ? pick.albumId : albumId,
      pgAlbumId: pick.pgAlbumId,
      href: href === "/albums" ? hrefForAlbum(null, pick.albumTitle) : href,
      title: pick.albumTitle,
      releaseYear: pick.releaseYear,
      coverUrl,
      artistName: ct.canonical_artist_name,
    };
  } catch {
    return null;
  }
}

async function filterCandidatesByArtist(
  candidates: ScoredAlbumCandidate[],
  canonicalArtistId: number | null,
  artistName: string,
): Promise<ScoredAlbumCandidate[]> {
  if (!canonicalArtistId && !artistName.trim()) return candidates;
  const pgIds = [...new Set(candidates.map((c) => c.pgAlbumId))];
  if (pgIds.length === 0) return candidates;

  const rows = await integrityQuery<{ pg_album_id: number; artist_id: number; canonical_name: string }>(
    `
    SELECT al.id AS pg_album_id, al.artist_id, ar.canonical_name
    FROM albums al
    JOIN artists ar ON ar.id = al.artist_id
    WHERE al.id = ANY($1::bigint[])
    `,
    [pgIds],
  );
  const artistNorm = artistName.trim().toLowerCase();
  const allowed = new Set(
    rows
      .filter((r) => {
        if (canonicalArtistId != null && r.artist_id === canonicalArtistId) return true;
        if (artistNorm && r.canonical_name.trim().toLowerCase() === artistNorm) return true;
        return false;
      })
      .map((r) => r.pg_album_id),
  );
  if (allowed.size === 0) return candidates;
  return candidates.filter((c) => allowed.has(c.pgAlbumId));
}
