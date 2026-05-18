/**
 * VDJ + video cache shared key: normalized artist and title, joined with "__".
 * Ported from Sites/retroverse/apps/music-browser/lib/playback-key.ts
 */
export function normalizeKeyPart(s: string): string {
  let t = String(s ?? "");
  t = t.toLowerCase();
  t = t.replace(/\[[^\]]*\]/g, " ");
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/\([^)]*\)/g, " ");
  t = t.replace(/[^a-z0-9 ]/g, " ");
  t = t.replace(/\s+/g, " ").trim();
  return t;
}

export function trackPlaybackKey(artist: string, titleOrName: string): string {
  const a = normalizeKeyPart(artist);
  const t = normalizeKeyPart(titleOrName);
  if (!a || !t) return "";
  return `${a}__${t}`;
}

/** charts_app videoResolver.js compact key (spaces only, no punctuation strip). */
export function legacyVideoTrackKey(artist: string, title: string): string {
  const normalizedArtist = String(artist ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  const normalizedTitle = String(title ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
  if (!normalizedArtist || !normalizedTitle) return "";
  return `${normalizedArtist}__${normalizedTitle}`;
}
