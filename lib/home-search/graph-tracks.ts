import type { CanonicalTrackEntity } from "@/lib/load-canonical-track-graph";
import { hrefForTrack } from "@/lib/retroverse-routes";

import { filterSearchTracks } from "./corpus-filters";
import type { HomeSearchRelation, HomeSearchTrack } from "./types";

function graphTrackRelation(hasHot100: boolean, hasVdjMedia: boolean, hasVideo: boolean): HomeSearchRelation {
  if (hasVdjMedia || hasVideo) return "VDJ";
  if (hasHot100) return "HOT100";
  return "TRACK";
}

export function trackConfidenceSubtitle(
  peak: number | null | undefined,
  weeks: number | null | undefined,
  linkedAlbum?: string | null,
): string | null {
  const parts: string[] = [];
  if (peak != null && Number.isFinite(peak)) parts.push(`Peak #${peak}`);
  if (weeks != null && weeks > 0) parts.push(`${weeks} wks`);
  if (linkedAlbum?.trim()) parts.push(linkedAlbum.trim());
  return parts.length ? parts.join(" · ") : null;
}

export function mapGraphTracksToSearch(
  graphMatches: CanonicalTrackEntity[],
  opts?: { linkedAlbumByTitle?: Map<string, { albumTitle: string; albumHref: string }> },
): HomeSearchTrack[] {
  return graphMatches.map((t) => {
    const linked = opts?.linkedAlbumByTitle?.get(normalizeTrackTitleKey(t.canonicalTitle));
    return {
      kind: "track" as const,
      title: t.canonicalTitle,
      artist: t.canonicalArtistName ?? "—",
      href: hrefForTrack(t.retroverseTrackId ?? t.trackId),
      subtitle: trackConfidenceSubtitle(
        t.peakHot100Position,
        t.chartWeeks,
        linked?.albumTitle,
      ),
      linkedAlbum: linked?.albumTitle ?? null,
      linkedAlbumHref: linked?.albumHref ?? null,
      relation: graphTrackRelation(t.hasHot100, t.hasVdjMedia, t.hasVideo),
      hasVideo: t.hasVideo || t.hasVdjMedia,
    };
  });
}

export function finalizeArtistFirstTracks(rows: HomeSearchTrack[], limit: number): HomeSearchTrack[] {
  return filterSearchTracks(rows.slice(0, limit));
}

function normalizeTrackTitleKey(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/\s*[-–—]\s*(?:remaster(?:ed)?|live|mono|stereo|sessions?|roughs?|outtakes?).*$/i, "")
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s*\/.*$/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function buildLinkedAlbumByTitle(
  rows: Array<{ title: string; album_title: string; album_href: string }>,
): Map<string, { albumTitle: string; albumHref: string }> {
  const out = new Map<string, { albumTitle: string; albumHref: string }>();
  for (const row of rows) {
    const key = normalizeTrackTitleKey(row.title);
    if (!key || out.has(key)) continue;
    out.set(key, { albumTitle: row.album_title, albumHref: row.album_href });
  }
  return out;
}
