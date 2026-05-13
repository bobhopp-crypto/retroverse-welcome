/**
 * Normalize remote/local artwork URLs for browser use and for deduplication.
 */
export function normalizeCandidateArtworkUrl(raw: string | null | undefined): string | null {
  const s = raw?.trim();
  if (!s) return null;
  if (s.startsWith("/")) return s;
  if (s.startsWith("//")) return `https:${s}`;
  if (s.startsWith("http://")) return `https://${s.slice(7)}`;
  return s;
}

/** Exact match on normalized curator image URL (what Discogs returns). */
export function normalizedArtworkUrlsEqual(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const na = normalizeCandidateArtworkUrl(a);
  const nb = normalizeCandidateArtworkUrl(b);
  return na != null && nb != null && na === nb;
}

/**
 * Stable fingerprint for "same image" across CDN size variants, query strings, etc.
 */
export function fingerprintCandidateArtworkUrl(raw: string | null | undefined): string {
  const n = normalizeCandidateArtworkUrl(raw);
  if (!n) return "";
  if (n.startsWith("/")) return n.toLowerCase();
  try {
    const u = new URL(n);
    u.search = "";
    u.hash = "";
    let p = u.pathname.toLowerCase();
    p = p.replace(/\d+x\d+bb/gi, "nxnbb");
    p = p.replace(/\d+x\d+(-|\.)(jpg|jpeg|png|webp)/gi, "nxn$2");
    return `${u.hostname}${p}`;
  } catch {
    return n.toLowerCase();
  }
}
