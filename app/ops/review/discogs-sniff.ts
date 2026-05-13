/**
 * Minimal Discogs release HTML sniff — og tags only, no full scraper.
 */

export type DiscogsSniffResult = {
  sourceUrl: string;
  ogTitle: string | null;
  imageUrl: string | null;
  artistGuess: string | null;
  albumGuess: string | null;
  releaseYear: number | null;
};

function metaContent(html: string, prop: string): string | null {
  const re = new RegExp(`<meta[^>]+property=["']${prop}["'][^>]+content=["']([^"']+)["']`, "i");
  const m = html.match(re);
  if (m?.[1]) return decodeHtmlEntities(m[1].trim());
  const re2 = new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+property=["']${prop}["']`, "i");
  const m2 = html.match(re2);
  return m2?.[1] ? decodeHtmlEntities(m2[1].trim()) : null;
}

function decodeHtmlEntities(s: string): string {
  return s
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function splitArtistAlbum(title: string): { artist: string | null; album: string | null } {
  const t = title.replace(/\s+/g, " ").trim();
  const split = t.split(/\s[–—-]\s|\s-\s/u);
  if (split.length >= 2) {
    return { artist: split[0]!.trim() || null, album: split.slice(1).join(" - ").trim() || null };
  }
  return { artist: null, album: t || null };
}

function yearFromText(text: string | null): number | null {
  if (!text) return null;
  const m = text.match(/\b(19\d{2}|20\d{2})\b/);
  if (!m) return null;
  const y = Number(m[1]);
  return Number.isFinite(y) ? y : null;
}

export function sniffDiscogsReleaseHtml(html: string, sourceUrl: string): DiscogsSniffResult {
  const ogTitle = metaContent(html, "og:title");
  const imageUrl = metaContent(html, "og:image");
  const description = metaContent(html, "og:description");
  const { artist, album } = ogTitle ? splitArtistAlbum(ogTitle.replace(/\s*[·•]\s*Discogs\s*$/i, "").trim()) : { artist: null, album: null };
  const releaseYear =
    yearFromText(ogTitle) ?? yearFromText(description) ?? yearFromText(album);
  return {
    sourceUrl,
    ogTitle,
    imageUrl,
    artistGuess: artist,
    albumGuess: album,
    releaseYear,
  };
}
