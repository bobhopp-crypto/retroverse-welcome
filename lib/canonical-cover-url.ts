/**
 * Single resolver for `retroverse_album_artwork.canonical_cover_path` → browser URL.
 * All surfaces (Discover, album hero, artist thumbs, etc.) should use this.
 * Do not probe the filesystem — missing files are handled by onError/broken state in UI.
 *
 * Final URL shape when `NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL` is set (R2, etc.):
 *   `${origin}/retroverse/covers/<RVAL folder>/<filename>`
 *
 * The env value should be the **origin only** (e.g. `https://pub-… .r2.dev`), but if it
 * mistakenly ends with `/retroverse/covers`, that suffix is stripped so paths are not doubled.
 */
const COVERS_SEGMENT = "retroverse/covers/";

function stripTrailingRetroverseCoversFromBase(base: string): string {
  let b = base.trim().replace(/\/+$/, "");
  const suffix = /\/retroverse\/covers$/i;
  if (suffix.test(b)) {
    b = b.replace(suffix, "").replace(/\/+$/, "");
  }
  return b;
}

/** DB / file path → `retroverse/covers/...` (no leading slash); preserves filename & folder casing. */
function normalizeRelativeCoverPath(raw: string): string | null {
  let rel = raw.trim().replace(/^\/+/, "").replace(/^public\//, "");
  if (!rel) return null;
  rel = rel.replace(/^(retroverse\/covers\/)+/i, COVERS_SEGMENT);
  if (!rel.startsWith(COVERS_SEGMENT)) {
    if (/^RVAL[0-9]{6}\//i.test(rel)) {
      rel = `${COVERS_SEGMENT}${rel}`;
    }
  }
  return rel;
}

/**
 * Optional `cacheBust` (epoch ms or any monotonic token) appends `?v=<token>` so
 * the browser/CDN refetch the canonical R2 object after a save without us having
 * to change the storage key. Used by Portal after a curator save.
 */
export function canonicalCoverPathToUrl(
  canonicalCoverPath: string | null | undefined,
  options?: { cacheBust?: number | string | null },
): string | null {
  if (!canonicalCoverPath?.trim()) return null;
  const raw = canonicalCoverPath.trim();

  const appendBust = (url: string): string => {
    const bust = options?.cacheBust;
    if (bust === null || bust === undefined || bust === "" || bust === 0) return url;
    const sep = url.includes("?") ? "&" : "?";
    return `${url}${sep}v=${encodeURIComponent(String(bust))}`;
  };

  if (raw.startsWith("http://") || raw.startsWith("https://")) return appendBust(raw);
  const rel = normalizeRelativeCoverPath(raw);
  if (!rel) return null;

  const rawBase =
    typeof process.env.NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL === "string"
      ? process.env.NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL.trim()
      : "";
  if (rawBase) {
    const origin = stripTrailingRetroverseCoversFromBase(rawBase);
    if (!origin) return appendBust(`/${rel}`);
    return appendBust(`${origin.replace(/\/+$/, "")}/${rel}`);
  }
  return appendBust(`/${rel}`);
}
