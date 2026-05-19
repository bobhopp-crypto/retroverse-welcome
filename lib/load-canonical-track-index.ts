import { getCanonicalAlbumSequencesBundleOrNull } from "@/lib/canonical-album-sequences";
import { getAlbumDossiersBundleOrNull } from "@/lib/load-album-dossier";
import { getHot100Db } from "@/lib/track-deck/db";
import {
  detectLikelyDuplicateTracks,
  detectPairedChartAlias,
  normalizeTrackIdentityPart,
  resolveCanonicalTrackIdentity,
  splitPairedChartAlias,
  type TrackVariantKind,
} from "@/lib/canonical-track-identity";

export type CanonicalTrackIndexRow = {
  identityId: string;
  canonicalTitle: string;
  canonicalArtist: string;
  connectedAlbumId: string | null;
  connectedAlbumTitle: string | null;
  connectedAlbumYear: number | null;
  hot100WorkId: string | null;
  hot100Peak: number | null;
  hot100Weeks: number | null;
  linkedAlbumCount: number;
  linkedVdjCount: number;
  integrityStates: string[];
  identityConfidence: "high" | "medium" | "low";
  source: "canonical_sequence" | "hot100_work";
  identityKey: string;
};

export type CanonicalTrackIndexResult = {
  rows: CanonicalTrackIndexRow[];
  totalRows: number;
  unresolvedAlbumCount: number;
  duplicateCandidateCount: number;
  unresolvedChartCount: number;
  unresolvedVdjCount: number;
  pairedAliasCount: number;
  liveAmbiguityCount: number;
  soundtrackContaminationCount: number;
  hot100Available: boolean;
};

type Hot100Row = {
  work_id: string;
  title_display: string;
  artist_display: string;
  peak: number | null;
  weeks: number | null;
  appearance_count: number;
  vdj_count: number;
};

type LoadOptions = {
  query?: string;
  artist?: string;
  limit?: number;
  offset?: number;
};

const DEFAULT_LIMIT = 90;

function norm(value: string | null | undefined): string {
  return normalizeTrackIdentityPart(value ?? "");
}

function queryMatches(row: CanonicalTrackIndexRow, query: string, artist: string): boolean {
  if (query) {
    const haystack = `${row.canonicalTitle} ${row.canonicalArtist} ${row.connectedAlbumTitle ?? ""} ${row.identityId}`.toLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (artist && !row.canonicalArtist.toLowerCase().includes(artist)) return false;
  return true;
}

function loadHot100Rows(): Hot100Row[] {
  try {
    const db = getHot100Db();
    return db
      .prepare(
        `
          SELECT
            w.work_id,
            w.title_display,
            p.name_display AS artist_display,
            MIN(CASE WHEN ee.peak_pos IS NOT NULL AND ee.peak_pos > 0 THEN ee.peak_pos ELSE ee.rank END) AS peak,
            MAX(ee.weeks_on_chart) AS weeks,
            COUNT(*) AS appearance_count,
            COALESCE(v.vdj_count, 0) AS vdj_count
          FROM work w
          JOIN person p ON p.person_id = w.primary_person_id
          JOIN event_entry ee ON ee.work_id = w.work_id
          LEFT JOIN (
            SELECT work_id, COUNT(*) AS vdj_count
            FROM work_asset_link
            GROUP BY work_id
          ) v ON v.work_id = w.work_id
          GROUP BY w.work_id
          ORDER BY COALESCE(peak, 999), COALESCE(weeks, 0) DESC, w.title_display
        `,
      )
      .all() as Hot100Row[];
  } catch {
    return [];
  }
}

function stateLabels(variantKinds: TrackVariantKind[]): string[] {
  return variantKinds.map((kind) => {
    switch (kind) {
      case "paired_alias":
        return "paired alias";
      case "live_variant":
        return "live/studio ambiguity";
      case "archive_variant":
        return "archive variant";
      case "bonus_or_expanded":
        return "bonus/expanded";
      case "soundtrack_contamination":
        return "soundtrack contamination";
      default:
        return "canonical";
    }
  }).filter((label) => label !== "canonical");
}

function mergeChart(row: CanonicalTrackIndexRow, hot: Hot100Row, pairedAlias: boolean): void {
  row.hot100WorkId = hot.work_id;
  row.hot100Peak = hot.peak;
  row.hot100Weeks = hot.weeks;
  row.linkedVdjCount = hot.vdj_count;
  if (pairedAlias && !row.integrityStates.includes("paired alias")) row.integrityStates.push("paired alias");
}

export function loadCanonicalTrackIndex(options: LoadOptions = {}): CanonicalTrackIndexResult {
  const limit = Math.max(1, Math.min(options.limit ?? DEFAULT_LIMIT, 140));
  const offset = Math.max(0, Math.min(options.offset ?? 0, 1000));
  const query = (options.query ?? "").trim().toLowerCase();
  const artist = (options.artist ?? "").trim().toLowerCase();

  const albumBundle = getAlbumDossiersBundleOrNull();
  const sequences = Object.values(getCanonicalAlbumSequencesBundleOrNull()?.sequences ?? {});
  const rowsByIdentity = new Map<string, CanonicalTrackIndexRow>();

  for (const sequence of sequences) {
    const album = albumBundle?.dossiers[sequence.album_id] ?? null;
    for (const track of sequence.tracks) {
      const identity = resolveCanonicalTrackIdentity({
        title: track.canonical_title,
        artist: sequence.artist,
        albumTitle: sequence.album,
      });
      const current = rowsByIdentity.get(identity.identityKey);
      if (current) {
        current.linkedAlbumCount += 1;
        continue;
      }
      const states = stateLabels(identity.variantKinds);
      rowsByIdentity.set(identity.identityKey, {
        identityId: `seq:${sequence.album_id}:${track.global_position}`,
        canonicalTitle: identity.canonicalTitle,
        canonicalArtist: identity.canonicalArtist,
        connectedAlbumId: sequence.album_id,
        connectedAlbumTitle: sequence.album,
        connectedAlbumYear: album?.identity.chart_year ?? album?.chart.retroscope_snapshot_year ?? null,
        hot100WorkId: null,
        hot100Peak: null,
        hot100Weeks: null,
        linkedAlbumCount: 1,
        linkedVdjCount: 0,
        integrityStates: states,
        identityConfidence: identity.confidence,
        source: "canonical_sequence",
        identityKey: identity.identityKey,
      });
    }
  }

  const hotRows = loadHot100Rows();
  const hot100Available = hotRows.length > 0;
  const sequenceByExactKey = rowsByIdentity;
  const sequenceByArtistAndTitle = new Map<string, CanonicalTrackIndexRow>();
  for (const row of rowsByIdentity.values()) {
    sequenceByArtistAndTitle.set(`${norm(row.canonicalArtist)}::${norm(row.canonicalTitle)}`, row);
  }

  for (const hot of hotRows) {
    const identity = resolveCanonicalTrackIdentity({
      title: hot.title_display,
      artist: hot.artist_display,
    });
    const pairedParts = splitPairedChartAlias(hot.title_display);
    const exact = sequenceByExactKey.get(identity.identityKey);
    if (exact) {
      mergeChart(exact, hot, detectPairedChartAlias(hot.title_display));
      continue;
    }

    let mergedPaired = false;
    if (pairedParts.length > 1) {
      for (const part of pairedParts) {
        const target = sequenceByArtistAndTitle.get(`${identity.artistKey}::${part}`);
        if (target) {
          mergeChart(target, hot, true);
          mergedPaired = true;
        }
      }
    }
    if (mergedPaired) continue;

    const states = stateLabels(identity.variantKinds);
    if (!states.includes("unresolved album")) states.push("unresolved album");
    if (hot.vdj_count <= 0) states.push("unresolved VDJ linkage");
    rowsByIdentity.set(`hot100:${hot.work_id}`, {
      identityId: `hot100:${hot.work_id}`,
      canonicalTitle: identity.canonicalTitle,
      canonicalArtist: identity.canonicalArtist,
      connectedAlbumId: null,
      connectedAlbumTitle: null,
      connectedAlbumYear: null,
      hot100WorkId: hot.work_id,
      hot100Peak: hot.peak,
      hot100Weeks: hot.weeks,
      linkedAlbumCount: 0,
      linkedVdjCount: hot.vdj_count,
      integrityStates: states,
      identityConfidence: identity.confidence === "high" ? "medium" : identity.confidence,
      source: "hot100_work",
      identityKey: identity.identityKey,
    });
  }

  const allRows = [...rowsByIdentity.values()];
  const duplicates = detectLikelyDuplicateTracks(
    allRows.map((row) => ({
      title: row.canonicalTitle,
      artist: row.canonicalArtist,
      albumTitle: row.connectedAlbumTitle,
      row,
    })),
  );
  for (const rows of duplicates.values()) {
    for (const wrapped of rows) {
      const row = wrapped.row as CanonicalTrackIndexRow;
      if (!row.integrityStates.includes("duplicate candidate")) row.integrityStates.push("duplicate candidate");
      if (row.identityConfidence === "high") row.identityConfidence = "medium";
    }
  }

  for (const row of allRows) {
    if (row.hot100Peak == null && !row.integrityStates.includes("unresolved chart linkage")) {
      row.integrityStates.push("unresolved chart linkage");
    }
    if (row.linkedVdjCount <= 0 && !row.integrityStates.includes("unresolved VDJ linkage")) {
      row.integrityStates.push("unresolved VDJ linkage");
    }
  }

  const filtered = allRows
    .filter((row) => queryMatches(row, query, artist))
    .sort((a, b) => {
      const peakDelta = (a.hot100Peak ?? 999) - (b.hot100Peak ?? 999);
      if (peakDelta !== 0) return peakDelta;
      const weeksDelta = (b.hot100Weeks ?? 0) - (a.hot100Weeks ?? 0);
      if (weeksDelta !== 0) return weeksDelta;
      if (a.source !== b.source) return a.source === "canonical_sequence" ? -1 : 1;
      return a.canonicalTitle.localeCompare(b.canonicalTitle);
    });

  return {
    rows: filtered.slice(0, offset + limit),
    totalRows: filtered.length,
    unresolvedAlbumCount: filtered.filter((row) => row.connectedAlbumId == null).length,
    duplicateCandidateCount: filtered.filter((row) => row.integrityStates.includes("duplicate candidate")).length,
    unresolvedChartCount: filtered.filter((row) => row.hot100Peak == null).length,
    unresolvedVdjCount: filtered.filter((row) => row.linkedVdjCount <= 0).length,
    pairedAliasCount: filtered.filter((row) => row.integrityStates.includes("paired alias")).length,
    liveAmbiguityCount: filtered.filter((row) => row.integrityStates.includes("live/studio ambiguity")).length,
    soundtrackContaminationCount: filtered.filter((row) => row.integrityStates.includes("soundtrack contamination")).length,
    hot100Available,
  };
}
