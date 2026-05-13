/**
 * Lightweight tracklist overlap vs Billboard anchor text — ranking + human hint only.
 */

const STOPWORDS = new Set([
  "the",
  "a",
  "an",
  "and",
  "or",
  "of",
  "for",
  "to",
  "in",
  "on",
  "at",
  "by",
  "from",
  "with",
  "volume",
  "vol",
  "pt",
  "part",
  "cd",
  "disc",
  "edition",
]);

function normalizeForTokens(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Significant tokens from Billboard artist + album (proxy for “expected hits” / title family). */
export function billboardAnchorTokens(billboardArtist: string, billboardAlbum: string): string[] {
  const blob = normalizeForTokens(`${billboardArtist} ${billboardAlbum}`);
  return blob
    .split(" ")
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function tokenJaccard(a: string, b: string): number {
  const ta = new Set(normalizeForTokens(a).split(" ").filter((x) => x.length > 1));
  const tb = new Set(normalizeForTokens(b).split(" ").filter((x) => x.length > 1));
  if (ta.size === 0 || tb.size === 0) return 0;
  let inter = 0;
  for (const x of ta) if (tb.has(x)) inter += 1;
  const u = ta.size + tb.size - inter;
  return u === 0 ? 0 : inter / u;
}

function trackMatchesAnchors(
  trackTitle: string,
  anchors: string[],
  billboardAlbumNorm: string,
): boolean {
  const nt = normalizeForTokens(trackTitle);
  if (!nt) return false;
  if (billboardAlbumNorm.length >= 6 && nt.includes(billboardAlbumNorm)) return true;
  let longHits = 0;
  let anyHits = 0;
  for (const a of anchors) {
    if (a.length >= 4 && nt.includes(a)) longHits += 1;
    else if (a.length >= 3 && nt.includes(a)) anyHits += 1;
  }
  if (longHits >= 1) return true;
  if (anyHits >= 2) return true;
  const anchorBlob = anchors.join(" ");
  return anchorBlob.length > 0 && tokenJaccard(anchorBlob, trackTitle) >= 0.22;
}

export type TrackOverlapSignal = {
  /** 0–1 heuristic strength */
  overlapScore: number;
  /** Up to 3 iTunes track titles that matched (display order). */
  matchedSample: string[];
  matchedCount: number;
  anchorCount: number;
};

export function computeTrackOverlapSignal(args: {
  billboardArtist: string;
  billboardAlbum: string;
  trackSample: string[];
  catalogTrackCount: number | null | undefined;
}): TrackOverlapSignal {
  const anchors = billboardAnchorTokens(args.billboardArtist, args.billboardAlbum);
  const albumNorm = normalizeForTokens(args.billboardAlbum);
  const sample = args.trackSample.filter(Boolean).slice(0, 8);
  if (sample.length === 0 && (args.catalogTrackCount == null || args.catalogTrackCount <= 0)) {
    return { overlapScore: 0, matchedSample: [], matchedCount: 0, anchorCount: anchors.length };
  }

  const matched: string[] = [];
  for (const t of sample) {
    if (trackMatchesAnchors(t, anchors, albumNorm)) matched.push(t);
  }

  let overlapScore = 0;
  if (matched.length >= 1) overlapScore += 0.22 * Math.min(3, matched.length);
  if (matched.length >= 2) overlapScore += 0.12;
  if (matched.length >= 3) overlapScore += 0.1;
  const trc = args.catalogTrackCount;
  if (trc != null && trc > 0 && sample.length > 0) {
    const ratio = sample.length / Math.max(trc, sample.length);
    if (ratio >= 0.15) overlapScore += 0.06;
  }
  overlapScore = Math.max(0, Math.min(1, overlapScore));

  return {
    overlapScore,
    matchedSample: matched.slice(0, 3),
    matchedCount: matched.length,
    anchorCount: anchors.length,
  };
}

export type TrackOverlapUiTier = "high" | "medium" | "mismatch" | "unknown";

export function trackOverlapUiTier(signal: TrackOverlapSignal, hasTrackSample: boolean): TrackOverlapUiTier {
  if (!hasTrackSample && signal.overlapScore <= 0) return "unknown";
  if (signal.overlapScore >= 0.45) return "high";
  if (signal.overlapScore >= 0.18) return "medium";
  if (hasTrackSample && signal.matchedCount === 0) return "mismatch";
  return "unknown";
}

export function trackOverlapHeadline(tier: TrackOverlapUiTier): string {
  switch (tier) {
    case "high":
      return "TRACK OVERLAP HIGH";
    case "medium":
      return "TRACK OVERLAP MEDIUM";
    case "mismatch":
      return "TRACK FAMILY MISMATCH";
    default:
      return "TRACK OVERLAP — NO SAMPLE";
  }
}
