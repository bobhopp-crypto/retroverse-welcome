export type TrackVariantKind =
  | "canonical"
  | "paired_alias"
  | "live_variant"
  | "archive_variant"
  | "bonus_or_expanded"
  | "soundtrack_contamination";

export type TrackIdentityInput = {
  title: string;
  artist: string;
  albumTitle?: string | null;
};

export type CanonicalTrackIdentity = {
  canonicalTitle: string;
  canonicalArtist: string;
  identityKey: string;
  titleKey: string;
  artistKey: string;
  variantKinds: TrackVariantKind[];
  confidence: "high" | "medium" | "low";
};

const ARCHIVE_VARIANT_RE =
  /\b(remaster(?:ed)?|mono|stereo|demo|session|sessions|rough|roughs|outtake|outtakes|alternate|version|edit|mix|acoustic|instrumental|karaoke|reprise)\b/i;
const BONUS_OR_EXPANDED_RE = /\b(bonus|expanded|deluxe|previously\s+unissued|incomplete)\b/i;
const LIVE_RE = /\blive\b|live at|live from|in concert/i;
const SOUNDTRACK_RE = /\bsoundtrack\b|\bfrom ["'“][^"'”]+["'”]|\bvarious artists\b|\bglee cast\b/i;

export function normalizeTrackIdentityPart(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\u2019/g, "'")
    .replace(/&/g, " and ")
    .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|mono|stereo|demo|sessions?|roughs?|outtakes?|version|edit|mix).*$/i, "")
    .replace(/\s*\([^)]*(?:remaster(?:ed)?|mono|stereo|live|demo|version|edit|mix)[^)]*\)\s*/gi, " ")
    .replace(/[^a-z0-9']+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectPairedChartAlias(title: string): boolean {
  return title.split(/\s*\/\s*/).map(normalizeTrackIdentityPart).filter(Boolean).length > 1;
}

export function splitPairedChartAlias(title: string): string[] {
  return title.split(/\s*\/\s*/).map(normalizeTrackIdentityPart).filter(Boolean);
}

export function detectLiveVariant(input: TrackIdentityInput): boolean {
  return LIVE_RE.test(`${input.title} ${input.albumTitle ?? ""}`);
}

export function classifyTrackVariant(input: TrackIdentityInput): TrackVariantKind[] {
  const combined = `${input.title} ${input.artist} ${input.albumTitle ?? ""}`;
  const variants: TrackVariantKind[] = [];
  if (detectPairedChartAlias(input.title)) variants.push("paired_alias");
  if (detectLiveVariant(input)) variants.push("live_variant");
  if (BONUS_OR_EXPANDED_RE.test(combined)) variants.push("bonus_or_expanded");
  if (ARCHIVE_VARIANT_RE.test(input.title)) variants.push("archive_variant");
  if (SOUNDTRACK_RE.test(combined)) variants.push("soundtrack_contamination");
  return variants;
}

export function resolveCanonicalTrackIdentity(input: TrackIdentityInput): CanonicalTrackIdentity {
  const titleKey = normalizeTrackIdentityPart(input.title);
  const artistKey = normalizeTrackIdentityPart(input.artist);
  const variantKinds = classifyTrackVariant(input);
  const confidence = variantKinds.some((kind) => kind === "bonus_or_expanded" || kind === "soundtrack_contamination")
    ? "low"
    : variantKinds.length > 0
    ? "medium"
    : "high";

  return {
    canonicalTitle: input.title.trim(),
    canonicalArtist: input.artist.trim(),
    identityKey: `${artistKey}::${titleKey}`,
    titleKey,
    artistKey,
    variantKinds,
    confidence,
  };
}

export function detectLikelyDuplicateTracks<T extends TrackIdentityInput>(tracks: T[]): Map<string, T[]> {
  const groups = new Map<string, T[]>();
  for (const track of tracks) {
    const identity = resolveCanonicalTrackIdentity(track);
    const current = groups.get(identity.identityKey) ?? [];
    current.push(track);
    groups.set(identity.identityKey, current);
  }
  return new Map([...groups].filter(([, rows]) => rows.length > 1));
}
