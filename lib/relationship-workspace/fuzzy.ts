import { normalizeKeyPart, trackPlaybackKey } from "@/lib/legacy-playback/playback-key";

export function tokenize(s: string): string[] {
  return normalizeKeyPart(s)
    .split(" ")
    .filter((t) => t.length > 1);
}

const ARTIST_STOPWORDS = new Set(["the", "a", "an", "&", "and"]);

/** Significant artist tokens — every one must appear in VDJ tags or file path. */
export function significantArtistTokens(artist: string): string[] {
  return tokenize(artist).filter((t) => !ARTIST_STOPWORDS.has(t));
}

export function artistMatchesChart(
  chartArtist: string,
  candidate: { artist?: string; filePath?: string },
): boolean {
  const sig = significantArtistTokens(chartArtist);
  if (sig.length === 0) return false;
  const hay = normalizeKeyPart(
    `${candidate.artist ?? ""} ${candidate.filePath ?? ""}`,
  );
  return sig.every((t) => hay.includes(t));
}

export function fuzzyScoreParts(
  haystack: string,
  artist: string,
  title: string,
  freeText?: string,
): { score: number; reason: string } {
  const norm = normalizeKeyPart(haystack);
  const artistTokens = tokenize(artist);
  const titleTokens = tokenize(title);
  const freeTokens = freeText ? tokenize(freeText) : [];
  let score = 0;
  const reasons: string[] = [];

  const artistHit = artistTokens.filter((t) => norm.includes(t)).length;
  const titleHit = titleTokens.filter((t) => norm.includes(t)).length;
  const freeHit = freeTokens.filter((t) => norm.includes(t)).length;

  if (artistHit) {
    score += artistHit * 12;
    reasons.push(`artist×${artistHit}`);
  }
  if (titleHit) {
    score += titleHit * 18;
    reasons.push(`title×${titleHit}`);
  }
  if (freeHit) {
    score += freeHit * 8;
    reasons.push(`text×${freeHit}`);
  }

  if (artistHit >= Math.min(1, artistTokens.length) && titleHit >= Math.min(2, titleTokens.length)) {
    score += 40;
    reasons.push("artist+title");
  }

  return { score, reason: reasons.join(" · ") || "weak" };
}

export function normalizedMatchKey(artist: string, title: string): string {
  return trackPlaybackKey(artist, title);
}
