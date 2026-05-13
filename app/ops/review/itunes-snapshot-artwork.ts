/**
 * Shared iTunes Search API snapshot helpers — artwork fields and loose title matching
 * for review / candidate-details pipelines.
 */

/** Preferred order (larger first; we still shrink in UI via replace if needed). */
const ARTWORK_KEYS = [
  "artworkUrl600",
  "artworkUrl512",
  "artworkUrl100",
  "artworkUrl60",
] as const;

export function pickArtworkUrlFromRow(r: Record<string, unknown>): string | null {
  for (const k of ARTWORK_KEYS) {
    const v = r[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  for (const k of Object.keys(r)) {
    if (!/^artworkUrl\d*$/i.test(k)) continue;
    const v = r[k];
    if (typeof v === "string" && v.startsWith("http")) return v;
  }
  return null;
}

export function collectionIdAsNumber(id: unknown): number | null {
  if (id == null || id === "") return null;
  const n = typeof id === "number" ? id : Number(String(id).trim());
  return Number.isFinite(n) ? n : null;
}

/** Strict join (legacy) + looser forms for CSV ↔ iTunes string drift. */
export function normJoinStrict(a: string, b: string): string {
  return `${a.trim().toLowerCase().replace(/\s+/g, " ")}\n${b.trim().toLowerCase().replace(/\s+/g, " ")}`;
}

export function normLoose(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[\u2018\u2019\u201A\u201B\u2032\u2035]/g, "'")
    .replace(/[^\p{L}\p{N}\s'-]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function loosePairKey(a: string, b: string): string {
  return `${normLoose(a)}\n${normLoose(b)}`;
}

function albumCloseEnough(candidateAlbum: string, collectionName: string): boolean {
  const ca = normLoose(candidateAlbum);
  const cn = normLoose(collectionName);
  if (!ca || !cn) return false;
  if (ca === cn) return true;
  if (ca.length >= 8 && cn.length >= 8 && (cn.includes(ca) || ca.includes(cn))) return true;
  return false;
}

/**
 * Find the iTunes `results[]` row for a ranked candidate. Tries strict key, loose key,
 * then same loose artist + album substring; finally loose album match if strings are long enough.
 */
export function findResultRowForCandidate(
  rows: Record<string, unknown>[],
  candidateArtist: string,
  candidateAlbum: string,
): Record<string, unknown> | undefined {
  const wantStrict = normJoinStrict(candidateArtist, candidateAlbum);
  const wantLoose = loosePairKey(candidateArtist, candidateAlbum);

  const hitStrict = rows.find((r) => {
    const an = typeof r.artistName === "string" ? r.artistName : "";
    const cn = typeof r.collectionName === "string" ? r.collectionName : "";
    if (!cn.trim()) return false;
    return wantStrict === normJoinStrict(an, cn);
  });
  if (hitStrict) return hitStrict;

  const hitLoose = rows.find((r) => {
    const an = typeof r.artistName === "string" ? r.artistName : "";
    const cn = typeof r.collectionName === "string" ? r.collectionName : "";
    if (!cn.trim()) return false;
    return wantLoose === loosePairKey(an, cn);
  });
  if (hitLoose) return hitLoose;

  const hitArtistAlbum = rows.find((r) => {
    const an = typeof r.artistName === "string" ? r.artistName : "";
    const cn = typeof r.collectionName === "string" ? r.collectionName : "";
    if (!cn.trim()) return false;
    if (normLoose(an) !== normLoose(candidateArtist)) return false;
    return albumCloseEnough(candidateAlbum, cn);
  });
  if (hitArtistAlbum) return hitArtistAlbum;

  return rows.find((r) => {
    const cn = typeof r.collectionName === "string" ? r.collectionName : "";
    if (!cn.trim()) return false;
    return albumCloseEnough(candidateAlbum, cn);
  });
}

export function upgradeArtworkTo600(url: string | null | undefined): string | null {
  if (!url) return null;
  return url
    .replace(/60x60bb/g, "600x600bb")
    .replace(/100x100bb/g, "600x600bb")
    .replace(/200x200bb/g, "600x600bb");
}
