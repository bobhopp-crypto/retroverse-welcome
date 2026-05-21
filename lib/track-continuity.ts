import { getCanonicalAlbumSequencesBundleOrNull } from "@/lib/canonical-album-sequences";
import {
  normalizeTrackIdentityPart,
  resolveCanonicalTrackIdentity,
  splitPairedChartAlias,
} from "@/lib/canonical-track-identity";
import { getHot100Db } from "@/lib/track-deck/db";
import { hrefForTrack } from "@/lib/retroverse-routes";
import { normalizeEntitySlug } from "@/lib/retroverse-routes";

/** Editorial continuity sections — not generic recommendations. */
export type TrackContinuityKind = "album_context" | "chart_neighbor" | "era_cluster" | "reuse_pattern";

export type TrackContinuityItem = {
  kind: TrackContinuityKind;
  href: string;
  title: string;
  artist: string;
  meta: string | null;
};

export type TrackContinuitySection = {
  kind: TrackContinuityKind;
  heading: string;
  items: TrackContinuityItem[];
};

export const CONTINUITY_SECTION_HEADINGS: Record<TrackContinuityKind, string> = {
  album_context: "From this album",
  chart_neighbor: "Chart neighbors",
  era_cluster: "From this era",
  reuse_pattern: "Later reuse",
};

const SECTION_ORDER: TrackContinuityKind[] = [
  "album_context",
  "chart_neighbor",
  "era_cluster",
  "reuse_pattern",
];

export type TrackAlbumLink = {
  albumId: string;
  albumTitle: string;
};

export function buildSupabaseAlbumLinks(input: {
  appearances: { retroverseAlbumId: string; canonicalAlbumTitle: string }[];
  directAlbum: { retroverse_album_id: string; canonical_album_title: string } | null;
  hero: { albumId: string; title: string } | null | undefined;
}): TrackAlbumLink[] {
  const out: TrackAlbumLink[] = [];
  const seen = new Set<string>();
  for (const row of input.appearances) {
    const id = row.retroverseAlbumId?.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ albumId: id, albumTitle: row.canonicalAlbumTitle });
  }
  if (input.directAlbum) {
    const id = input.directAlbum.retroverse_album_id;
    if (!seen.has(id)) {
      out.push({ albumId: id, albumTitle: input.directAlbum.canonical_album_title });
    }
  }
  return mergeTrackAlbumLinks(out, input.hero);
}

export function mergeTrackAlbumLinks(
  links: TrackAlbumLink[],
  hero: { albumId: string; title: string } | null | undefined,
): TrackAlbumLink[] {
  if (!hero?.albumId?.trim()) return links;
  const heroId = hero.albumId.trim().toUpperCase();
  if (links.some((row) => row.albumId.trim().toUpperCase() === heroId)) return links;
  return [{ albumId: hero.albumId, albumTitle: hero.title }, ...links];
}

function dedupeItems(items: TrackContinuityItem[]): TrackContinuityItem[] {
  const seen = new Set<string>();
  const out: TrackContinuityItem[] = [];
  for (const row of items) {
    const key = row.href.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

export function assembleContinuitySections(
  buckets: Partial<Record<TrackContinuityKind, TrackContinuityItem[]>>,
  limits: Partial<Record<TrackContinuityKind, number>> = {},
): TrackContinuitySection[] {
  const defaultLimits: Record<TrackContinuityKind, number> = {
    album_context: 10,
    chart_neighbor: 8,
    era_cluster: 6,
    reuse_pattern: 6,
  };
  return SECTION_ORDER.map((kind) => {
    const cap = limits[kind] ?? defaultLimits[kind];
    return {
      kind,
      heading: CONTINUITY_SECTION_HEADINGS[kind],
      items: dedupeItems(buckets[kind] ?? []).slice(0, cap),
    };
  }).filter((section) => section.items.length > 0);
}

type Hot100WorkRow = {
  work_id: string;
  title_display: string;
  artist_display: string;
  peak: number | null;
  weeks: number | null;
};

function hot100WorkHref(workId: string): string {
  return `/tracks/hot100-${workId}`;
}

/** Tracks on the same canonical album sequence(s) as the target song. */
export function loadAlbumSequenceContinuity(
  title: string,
  artist: string,
  excludeWorkId?: string | null,
): TrackContinuityItem[] {
  const identity = resolveCanonicalTrackIdentity({ title, artist });
  const pairedParts = splitPairedChartAlias(title);
  const out: TrackContinuityItem[] = [];
  const seen = new Set<string>();

  for (const sequence of Object.values(getCanonicalAlbumSequencesBundleOrNull()?.sequences ?? {})) {
    if (normalizeTrackIdentityPart(sequence.artist) !== identity.artistKey) continue;

    let onAlbum = false;
    for (const track of sequence.tracks) {
      const trackKey = normalizeTrackIdentityPart(track.canonical_title);
      if (trackKey === identity.titleKey || pairedParts.includes(trackKey)) {
        onAlbum = true;
        break;
      }
    }
    if (!onAlbum) continue;

    for (const track of sequence.tracks) {
      const trackKey = normalizeTrackIdentityPart(track.canonical_title);
      if (trackKey === identity.titleKey || pairedParts.includes(trackKey)) continue;
      const slug = normalizeEntitySlug(track.canonical_title);
      const href = slug ? `/tracks/${slug}` : `/tracks/${normalizeEntitySlug(sequence.album)}`;
      if (seen.has(href)) continue;
      seen.add(href);
      out.push({
        kind: "album_context",
        href,
        title: track.canonical_title,
        artist: sequence.artist,
        meta: sequence.album,
      });
    }
  }
  return out.filter((row) => !excludeWorkId || !row.href.includes(excludeWorkId));
}

/** Hot 100 chart-week peers (rank proximity on shared issue dates). */
export function loadHot100ChartNeighborContinuity(
  workId: string,
  limit = 8,
): TrackContinuityItem[] {
  try {
    const db = getHot100Db();
    const rows = db
      .prepare(
        `
          WITH anchor AS (
            SELECT e.issue_date, ee.rank
            FROM event_entry ee
            JOIN event e ON e.event_id = ee.event_id
            WHERE ee.work_id = ?
          ),
          neighbor_entries AS (
            SELECT
              ee.work_id,
              e.issue_date,
              ee.rank,
              MIN(ABS(ee.rank - anchor.rank)) AS rank_gap
            FROM anchor
            JOIN event e ON e.issue_date = anchor.issue_date
            JOIN event_entry ee ON ee.event_id = e.event_id
            WHERE ee.work_id <> ?
              AND ABS(ee.rank - anchor.rank) <= 12
            GROUP BY ee.work_id, e.issue_date, ee.rank
          )
          SELECT
            w.work_id,
            w.title_display,
            p.name_display AS artist_display,
            MIN(CASE WHEN ee.peak_pos IS NOT NULL AND ee.peak_pos > 0 THEN ee.peak_pos ELSE ee.rank END) AS peak,
            MAX(ee.weeks_on_chart) AS weeks,
            MIN(ne.rank_gap) AS best_gap
          FROM neighbor_entries ne
          JOIN work w ON w.work_id = ne.work_id
          JOIN person p ON p.person_id = w.primary_person_id
          JOIN event_entry ee ON ee.work_id = w.work_id
          GROUP BY w.work_id, w.title_display, p.name_display
          ORDER BY best_gap ASC, COALESCE(peak, 999), COALESCE(weeks, 0) DESC, w.title_display
          LIMIT ?
        `,
      )
      .all(workId, workId, limit) as (Hot100WorkRow & { best_gap: number })[];

    return rows.map((row) => ({
      kind: "chart_neighbor" as const,
      href: hot100WorkHref(row.work_id),
      title: row.title_display,
      artist: row.artist_display,
      meta: row.peak != null ? `#${row.peak}` : null,
    }));
  } catch {
    return [];
  }
}

export function buildHot100TrackContinuity(
  workId: string,
  title: string,
  artist: string,
): TrackContinuitySection[] {
  return assembleContinuitySections({
    album_context: loadAlbumSequenceContinuity(title, artist, workId),
    chart_neighbor: loadHot100ChartNeighborContinuity(workId),
  });
}

export type SupabaseContinuityCandidate = {
  retroverseTrackId: string;
  title: string;
  artist: string;
  peakChartPosition: number | null;
  kinds: TrackContinuityKind[];
};

export function buildSupabaseTrackContinuity(candidates: SupabaseContinuityCandidate[]): TrackContinuitySection[] {
  const buckets: Partial<Record<TrackContinuityKind, TrackContinuityItem[]>> = {
    album_context: [],
    chart_neighbor: [],
    era_cluster: [],
    reuse_pattern: [],
  };

  const kindPriority: TrackContinuityKind[] = [
    "album_context",
    "chart_neighbor",
    "era_cluster",
    "reuse_pattern",
  ];

  for (const row of candidates) {
    const primaryKind = kindPriority.find((k) => row.kinds.includes(k)) ?? row.kinds[0];
    if (!primaryKind) continue;
    const meta =
      row.peakChartPosition != null ? `#${row.peakChartPosition}` : null;
    buckets[primaryKind]?.push({
      kind: primaryKind,
      href: hrefForTrack(row.retroverseTrackId),
      title: row.title,
      artist: row.artist,
      meta,
    });
  }

  return assembleContinuitySections(buckets);
}

/** Pick chart-neighbor RVTR ids from in-memory chart rows (same artist not required). */
export function chartNeighborIdsFromAppearances(
  charts: { chart_date: string; chart_position: number }[],
  selfTrackId: string,
  allAppearances: { retroverse_track_id: string; chart_date: string; chart_position: number }[],
  window = 10,
  limit = 24,
): string[] {
  const dates = new Set(charts.map((c) => c.chart_date));
  const scored = new Map<string, number>();

  for (const anchor of charts) {
    if (!dates.has(anchor.chart_date)) continue;
    for (const row of allAppearances) {
      if (row.chart_date !== anchor.chart_date) continue;
      if (row.retroverse_track_id === selfTrackId) continue;
      const gap = Math.abs(row.chart_position - anchor.chart_position);
      if (gap > window) continue;
      const prev = scored.get(row.retroverse_track_id);
      if (prev === undefined || gap < prev) scored.set(row.retroverse_track_id, gap);
    }
  }

  return [...scored.entries()]
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([id]) => id);
}
