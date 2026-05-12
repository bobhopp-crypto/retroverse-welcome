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

export function canonicalCoverPathToUrl(canonicalCoverPath: string | null | undefined): string | null {
  if (!canonicalCoverPath?.trim()) return null;
  const raw = canonicalCoverPath.trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const rel = normalizeRelativeCoverPath(raw);
  if (!rel) return null;

  const rawBase =
    typeof process.env.NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL === "string"
      ? process.env.NEXT_PUBLIC_RETROVERSE_COVER_BASE_URL.trim()
      : "";
  if (rawBase) {
    const origin = stripTrailingRetroverseCoversFromBase(rawBase);
    if (!origin) return `/${rel}`;
    return `${origin.replace(/\/+$/, "")}/${rel}`;
  }
  return `/${rel}`;
}
