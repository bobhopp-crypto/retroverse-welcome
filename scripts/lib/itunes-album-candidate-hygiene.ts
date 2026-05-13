/**
 * Album-oriented candidate hygiene for iTunes Search API rows.
 *
 * Ground truth from real raw snapshots under `data/raw/providers/itunes`:
 * - `entity=album` responses are almost entirely `wrapperType=collection`; `kind` is usually absent on those rows.
 * - `collectionType` is most often `Album` even for retail singles; `Single` / `EP` appear but many singles still say Album.
 * - Contamination is visible as `collectionType=Album` + very low `trackCount` + titles like "Song Name - Single".
 */

type Row = Record<string, unknown>;

function str(r: Row, k: string): string | undefined {
  const v = r[k];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function num(r: Row, k: string): number | undefined {
  const v = r[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/** Largest `trackCount` seen on any row in the collectionId group (collection + track rows repeat it). */
export function maxTrackCountInGroup(group: Row[]): number | null {
  let best: number | null = null;
  for (const r of group) {
    const t = num(r, "trackCount");
    if (t != null && t >= 0) {
      if (best == null || t > best) best = t;
    }
  }
  return best;
}

export function groupHasCollectionWrapper(group: Row[]): boolean {
  return group.some((r) => str(r, "wrapperType")?.toLowerCase() === "collection");
}

function groupHasBlockedKind(group: Row[]): boolean {
  for (const r of group) {
    const k = str(r, "kind")?.toLowerCase();
    if (k === "music-video" || k === "ringtone") return true;
  }
  return false;
}

/** Heuristic: retail single / partial drop packaging (not perfect discography). */
export function collectionNameLooksLikeRetailSingleOrPartial(name: string | undefined): boolean {
  if (!name) return false;
  const n = name;
  if (/\b-\s*single\b/i.test(n)) return true;
  if (/\bsingle\s*\(/i.test(n) && /\bfeat\.?/i.test(n)) return true;
  if (/\bfly,?\s+eagles\s+fly\b/i.test(n) && /\b(single|fight song|philly)\b/i.test(n)) return true;
  if (/\(original motion picture soundtrack\)/i.test(n)) return false;
  return false;
}

/**
 * Hard-drop non–album-shaped candidates before ranking / track overlap.
 * Prefer false negatives (drop a marginal EP) over keeping single contamination.
 */
export function shouldDropItunesAlbumCandidate(args: {
  collectionName: string | undefined;
  collectionType: string | undefined;
  primaryGenreName: string | undefined;
  effectiveTrackCount: number | null;
  hasCollectionWrapper: boolean;
  group: Row[];
}): boolean {
  const { collectionName, collectionType, primaryGenreName, effectiveTrackCount, hasCollectionWrapper, group } = args;
  const ct = (collectionType ?? "").toLowerCase();
  const genre = (primaryGenreName ?? "").toLowerCase();
  const tc = effectiveTrackCount;

  if (groupHasBlockedKind(group)) return true;
  if (/\bringtone\b/i.test(genre)) return true;

  if (ct === "single") return true;
  if (ct === "maxisingle" || ct === "mini-album") return true;

  if (tc != null) {
    if (tc <= 1) return true;
    if (tc <= 2) return true;
    if (ct === "ep" && tc <= 4) return true;
    if (collectionNameLooksLikeRetailSingleOrPartial(collectionName) && tc <= 5) return true;
    if (!hasCollectionWrapper && tc <= 4) return true;
    if (tc === 3 && collectionNameLooksLikeRetailSingleOrPartial(collectionName)) return true;
  } else {
    const distinctTracks = new Set<string>();
    for (const r of group) {
      const tn = str(r, "trackName");
      if (tn) distinctTracks.add(tn.toLowerCase());
    }
    if (distinctTracks.size <= 1 && !hasCollectionWrapper) return true;
  }

  return false;
}

/**
 * Soft scoring adjustments for survivors (track-count–aware, not a single magic threshold).
 */
export function albumDepthPenaltiesAndBoosts(args: {
  collectionType: string | undefined;
  effectiveTrackCount: number | null;
}): { penalty: number; boost: number; tags: string[] } {
  const ct = (args.collectionType ?? "").toLowerCase();
  const tc = args.effectiveTrackCount;
  let penalty = 0;
  let boost = 0;
  const tags: string[] = [];

  if (tc != null) {
    if (tc <= 4) {
      penalty += 0.09;
      tags.push(`short_album_tc:${tc}`);
    } else if (tc <= 6) {
      penalty += 0.045;
      tags.push(`mid_short_tc:${tc}`);
    } else if (tc >= 18) {
      boost += 0.028;
      tags.push(`deep_album_tc:${tc}`);
    } else if (tc >= 12) {
      boost += 0.018;
      tags.push(`albumish_tc:${tc}`);
    }
  }

  if (ct === "ep" && tc != null && tc <= 7) {
    penalty += 0.035;
    tags.push("ep_thin");
  }

  return { penalty, boost, tags };
}

/** Suppress misleading track overlap when the catalogue object is not multi-track enough. */
export function trackOverlapDepthMultiplier(effectiveTrackCount: number | null | undefined): number {
  if (effectiveTrackCount == null) return 0.35;
  if (effectiveTrackCount >= 8) return 1;
  if (effectiveTrackCount >= 6) return 0.72;
  if (effectiveTrackCount >= 4) return 0.38;
  return 0;
}
