import { getCanonicalAlbumSequencesBundleOrNull } from "@/lib/canonical-album-sequences";
import {
  detectLikelyDuplicateTracks,
  detectPairedChartAlias,
  normalizeTrackIdentityPart,
  resolveCanonicalTrackIdentity,
  splitPairedChartAlias,
} from "@/lib/canonical-track-identity";
import { getHot100Db } from "@/lib/track-deck/db";
import { normalizeEntitySlug } from "@/lib/retroverse-routes";

export type TrackTrajectoryWeek = {
  issueDate: string;
  rank: number;
  lastWeek: number | null;
  peakToDate: number | null;
  weeksOnChart: number | null;
  x: number;
  previousX: number | null;
  movement: "debut" | "up" | "down" | "same" | "reentry";
  delta: number | null;
  reentry: boolean;
};

export type TrackTrajectoryAlbumLink = {
  albumId: string;
  albumTitle: string;
};

export type TrackTrajectoryRelated = {
  href: string;
  title: string;
  artist: string;
  peak: number | null;
  weeks: number | null;
};

export type TrackTrajectory = {
  workId: string;
  canonicalTitle: string;
  canonicalArtist: string;
  artistHref: string;
  connectedAlbums: TrackTrajectoryAlbumLink[];
  peak: number | null;
  weeksCharted: number | null;
  firstChartWeek: string | null;
  finalChartWeek: string | null;
  weeks: TrackTrajectoryWeek[];
  relatedTracks: TrackTrajectoryRelated[];
  pairedAliases: string[];
  integrityStates: string[];
  unresolvedAlbumCount: number;
  duplicateCandidateCount: number;
  reentryCount: number;
};

type WorkSummaryRow = {
  work_id: string;
  title_display: string;
  artist_display: string;
  peak: number | null;
  weeks: number | null;
};

type WeekRow = {
  issue_date: string;
  rank: number;
  last_week: number | null;
  peak_pos: number | null;
  weeks_on_chart: number | null;
};

function rankX(rank: number): number {
  return Math.round(Math.max(0, Math.min(100, ((101 - rank) / 100) * 100)) * 100) / 100;
}

function daysBetween(a: string, b: string): number {
  return Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86400000);
}

function workHref(workId: string): string {
  return `/tracks/hot100-${workId}`;
}

function resolveWorkId(idParam: string): string | null {
  const raw = idParam.trim();
  const direct = raw.match(/^(?:hot100-)?(W\d{6})$/i);
  if (direct) return direct[1].toUpperCase();

  const targetSlug = normalizeEntitySlug(raw);
  if (!targetSlug) return null;

  try {
    const rows = getHot100Db()
      .prepare(
        `
          SELECT
            w.work_id,
            w.title_display,
            p.name_display AS artist_display,
            MIN(CASE WHEN ee.peak_pos IS NOT NULL AND ee.peak_pos > 0 THEN ee.peak_pos ELSE ee.rank END) AS peak,
            MAX(ee.weeks_on_chart) AS weeks
          FROM work w
          JOIN person p ON p.person_id = w.primary_person_id
          JOIN event_entry ee ON ee.work_id = w.work_id
          GROUP BY w.work_id
          ORDER BY COALESCE(peak, 999), COALESCE(weeks, 0) DESC
        `,
      )
      .all() as WorkSummaryRow[];
    const match = rows.find((row) => normalizeEntitySlug(row.title_display) === targetSlug);
    return match?.work_id ?? null;
  } catch {
    return null;
  }
}

function canonicalAlbumLinks(title: string, artist: string): TrackTrajectoryAlbumLink[] {
  const identity = resolveCanonicalTrackIdentity({ title, artist });
  const pairedParts = splitPairedChartAlias(title);
  const links: TrackTrajectoryAlbumLink[] = [];
  const seen = new Set<string>();

  for (const sequence of Object.values(getCanonicalAlbumSequencesBundleOrNull()?.sequences ?? {})) {
    if (normalizeTrackIdentityPart(sequence.artist) !== identity.artistKey) continue;
    for (const track of sequence.tracks) {
      const trackKey = normalizeTrackIdentityPart(track.canonical_title);
      const exact = trackKey === identity.titleKey;
      const paired = pairedParts.includes(trackKey);
      if (!exact && !paired) continue;
      if (seen.has(sequence.album_id)) continue;
      seen.add(sequence.album_id);
      links.push({ albumId: sequence.album_id, albumTitle: sequence.album });
    }
  }
  return links;
}

function movementFor(row: WeekRow, previous: WeekRow | null): TrackTrajectoryWeek["movement"] {
  if (!previous) return "debut";
  if (daysBetween(previous.issue_date, row.issue_date) > 10) return "reentry";
  if (row.rank < previous.rank) return "up";
  if (row.rank > previous.rank) return "down";
  return "same";
}

export function loadTrackTrajectory(idParam: string): TrackTrajectory | null {
  const workId = resolveWorkId(idParam);
  if (!workId) return null;

  try {
    const db = getHot100Db();
    const work = db
      .prepare(
        `
          SELECT w.work_id, w.title_display, p.name_display AS artist_display
          FROM work w
          JOIN person p ON p.person_id = w.primary_person_id
          WHERE w.work_id = ?
          LIMIT 1
        `,
      )
      .get(workId) as Pick<WorkSummaryRow, "work_id" | "title_display" | "artist_display"> | undefined;
    if (!work) return null;

    const weekRows = db
      .prepare(
        `
          SELECT e.issue_date, ee.rank, ee.last_week, ee.peak_pos, ee.weeks_on_chart
          FROM event_entry ee
          JOIN event e ON e.event_id = ee.event_id
          WHERE ee.work_id = ?
          ORDER BY e.issue_date ASC, ee.rank ASC
        `,
      )
      .all(workId) as WeekRow[];
    if (weekRows.length === 0) return null;

    const connectedAlbums = canonicalAlbumLinks(work.title_display, work.artist_display);
    const identity = resolveCanonicalTrackIdentity({
      title: work.title_display,
      artist: work.artist_display,
      albumTitle: connectedAlbums[0]?.albumTitle ?? null,
    });
    const duplicateGroups = detectLikelyDuplicateTracks([{ title: work.title_display, artist: work.artist_display }]);

    const weeks: TrackTrajectoryWeek[] = weekRows.map((row, index) => {
      const previous = index > 0 ? weekRows[index - 1] : null;
      const movement = movementFor(row, previous);
      const previousX = previous ? rankX(previous.rank) : null;
      return {
        issueDate: row.issue_date,
        rank: row.rank,
        lastWeek: row.last_week && row.last_week > 0 ? row.last_week : null,
        peakToDate: row.peak_pos,
        weeksOnChart: row.weeks_on_chart,
        x: rankX(row.rank),
        previousX,
        movement,
        delta: previous ? previous.rank - row.rank : null,
        reentry: movement === "reentry",
      };
    });

    const relatedRows = db
      .prepare(
        `
          SELECT
            w.work_id,
            w.title_display,
            p.name_display AS artist_display,
            MIN(CASE WHEN ee.peak_pos IS NOT NULL AND ee.peak_pos > 0 THEN ee.peak_pos ELSE ee.rank END) AS peak,
            MAX(ee.weeks_on_chart) AS weeks
          FROM work w
          JOIN person p ON p.person_id = w.primary_person_id
          JOIN event_entry ee ON ee.work_id = w.work_id
          WHERE p.name_display = ? AND w.work_id <> ?
          GROUP BY w.work_id
          ORDER BY COALESCE(peak, 999), COALESCE(weeks, 0) DESC, w.title_display
          LIMIT 8
        `,
      )
      .all(work.artist_display, workId) as WorkSummaryRow[];

    const integrityStates: string[] = identity.variantKinds.map((kind) => {
      if (kind === "paired_alias") return "paired alias";
      if (kind === "live_variant") return "live/studio ambiguity";
      if (kind === "soundtrack_contamination") return "soundtrack contamination";
      if (kind === "bonus_or_expanded") return "bonus/expanded";
      return "archive variant";
    });
    if (connectedAlbums.length === 0) integrityStates.push("unresolved canonical album");
    if (duplicateGroups.size > 0) integrityStates.push("duplicate candidate");

    return {
      workId,
      canonicalTitle: work.title_display,
      canonicalArtist: work.artist_display,
      artistHref: `/artists/${normalizeEntitySlug(work.artist_display)}`,
      connectedAlbums,
      peak: Math.min(...weekRows.map((row) => row.rank)),
      weeksCharted: Math.max(...weekRows.map((row) => row.weeks_on_chart ?? 0)),
      firstChartWeek: weekRows[0]?.issue_date ?? null,
      finalChartWeek: weekRows[weekRows.length - 1]?.issue_date ?? null,
      weeks,
      relatedTracks: relatedRows.map((row) => ({
        href: workHref(row.work_id),
        title: row.title_display,
        artist: row.artist_display,
        peak: row.peak,
        weeks: row.weeks,
      })),
      pairedAliases: detectPairedChartAlias(work.title_display) ? splitPairedChartAlias(work.title_display) : [],
      integrityStates,
      unresolvedAlbumCount: connectedAlbums.length === 0 ? 1 : 0,
      duplicateCandidateCount: duplicateGroups.size,
      reentryCount: weeks.filter((week) => week.reentry).length,
    };
  } catch {
    return null;
  }
}
