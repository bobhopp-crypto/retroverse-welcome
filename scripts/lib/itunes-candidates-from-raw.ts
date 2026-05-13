/**
 * Candidate layer: transform provider rows into comparable album entities for matching / ranking.
 *
 * Raw layer:     provider JSON exactly as received (see itunes-raw-snapshot.ts).
 * Candidate layer: this module — derived working rows, safe to evolve.
 * Canonical layer: Retroverse DB / curated album identity — not handled here.
 *
 * iTunes returns both `collection` and `track` wrapperTypes; tracks often carry album-level
 * fields (collectionId, collectionName, artwork, …). We dedupe by collectionId into one row
 * per album for downstream scoring.
 */

import {
  groupHasCollectionWrapper,
  maxTrackCountInGroup,
  shouldDropItunesAlbumCandidate,
} from "./itunes-album-candidate-hygiene";

/** Album-shaped candidate plus optional catalogue track sample (from same collectionId group). */
export type ItunesAlbumCandidate = {
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  collectionType?: string;
  collectionId?: number;
  trackCount?: number;
  primaryGenreName?: string;
  wrapperType?: string;
  /** First N distinct track names from provider rows (ordered by trackNumber when present). */
  trackTitleSample?: string[];
};

type ItunesProviderRow = Record<string, unknown>;

function str(r: ItunesProviderRow, k: string): string | undefined {
  const v = r[k];
  if (v == null) return undefined;
  const s = String(v).trim();
  return s || undefined;
}

function num(r: ItunesProviderRow, k: string): number | undefined {
  const v = r[k];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number.parseInt(v, 10);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

function rowScoreForMerge(r: ItunesProviderRow): number {
  let s = 0;
  const wt = str(r, "wrapperType")?.toLowerCase() ?? "";
  if (wt === "collection") s += 40;
  if (wt === "track") s += 10;
  if (str(r, "collectionName")) s += 20;
  if (str(r, "artworkUrl100")) s += 15;
  if (num(r, "trackCount") != null) s += 5;
  if (str(r, "primaryGenreName")) s += 3;
  return s;
}

function rowToAlbumCandidate(r: ItunesProviderRow, collectionId: number, trackTitleSample: string[]): ItunesAlbumCandidate {
  const base = rowToAlbumCandidateRow(r, collectionId);
  return trackTitleSample.length > 0 ? { ...base, trackTitleSample } : base;
}

function rowToAlbumCandidateRow(r: ItunesProviderRow, collectionId: number): ItunesAlbumCandidate {
  return {
    artistName: str(r, "artistName"),
    collectionName: str(r, "collectionName"),
    releaseDate: str(r, "releaseDate"),
    artworkUrl100: str(r, "artworkUrl100"),
    collectionType: str(r, "collectionType"),
    collectionId,
    trackCount: num(r, "trackCount"),
    primaryGenreName: str(r, "primaryGenreName"),
    wrapperType: str(r, "wrapperType"),
  };
}

/**
 * Distinct track titles from a collectionId group, ordered by trackNumber, capped.
 */
export function extractTrackTitleSampleFromGroup(group: ItunesProviderRow[], maxTracks: number): string[] {
  const withMeta: { n: number; name: string }[] = [];
  for (const r of group) {
    const name = str(r, "trackName");
    if (!name) continue;
    const tn = num(r, "trackNumber");
    const disc = num(r, "discNumber") ?? 0;
    const n = disc * 1000 + (tn ?? 999);
    withMeta.push({ n, name: name.trim() });
  }
  withMeta.sort((a, b) => a.n - b.n);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { name } of withMeta) {
    const k = name.toLowerCase();
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(name);
    if (out.length >= maxTracks) break;
  }
  return out;
}

/**
 * Groups provider `results` by `collectionId` and merges each group into one album-shaped candidate
 * (prefer collection rows; else richest track row).
 */
export function extractAlbumCandidatesFromItunesResults(rows: unknown[]): ItunesAlbumCandidate[] {
  const byCid = new Map<number, ItunesProviderRow[]>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as ItunesProviderRow;
    const cid = num(r, "collectionId");
    if (cid == null) continue;
    const list = byCid.get(cid) ?? [];
    list.push(r);
    byCid.set(cid, list);
  }

  const out: ItunesAlbumCandidate[] = [];
  for (const [cid, group] of byCid) {
    let best = group[0]!;
    let bestScore = rowScoreForMerge(best);
    for (let i = 1; i < group.length; i++) {
      const g = group[i]!;
      const sc = rowScoreForMerge(g);
      if (sc > bestScore) {
        best = g;
        bestScore = sc;
      }
    }
    const trackSample = extractTrackTitleSampleFromGroup(group, 5);
    const effectiveTc = maxTrackCountInGroup(group);
    const hasColl = groupHasCollectionWrapper(group);
    const merged = rowToAlbumCandidate(best, cid, trackSample);
    const candidate: ItunesAlbumCandidate = {
      ...merged,
      trackCount: effectiveTc ?? merged.trackCount,
    };
    if (
      shouldDropItunesAlbumCandidate({
        collectionName: candidate.collectionName,
        collectionType: candidate.collectionType,
        primaryGenreName: candidate.primaryGenreName,
        effectiveTrackCount: candidate.trackCount ?? null,
        hasCollectionWrapper: hasColl,
        group,
      })
    ) {
      continue;
    }
    out.push(candidate);
  }
  return out;
}
