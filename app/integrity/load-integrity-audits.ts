import { createClient } from "@/lib/supabase";

export type Severity = "INFO" | "WARNING" | "CRITICAL";

export type OrphanAlbum = {
  retroverse_album_id: string;
  canonical_album_title: string;
  artist_name: string;
};

export type DuplicateTitleCluster = {
  artist_id: string;
  artist_name: string;
  normalized_title: string;
  albums: Array<{ retroverse_album_id: string; title: string; release_year: number | null }>;
};

export type SplitChartCluster = {
  normalized_artist: string;
  normalized_title: string;
  albums: Array<{
    retroverse_album_id: string;
    title: string;
    artist_name: string;
    chart_weeks: number;
    first_chart_date: string;
    last_chart_date: string;
  }>;
};

export type ChronologyViolation = {
  retroverse_album_id: string;
  title: string;
  artist_name: string;
  release_year: number;
  earliest_chart_date: string;
  years_before_release: number;
};

export type SpineViolationSummary = {
  duplicate_week_rows: number;
  invalid_position_rows: number;
  null_key_rows: number;
  rows_scanned: number;
  scan_capped: boolean;
  duplicate_week_samples: Array<{
    retroverse_album_id: string;
    chart_date: string;
    chart_position: number;
    row_count: number;
  }>;
  invalid_position_samples: Array<{
    retroverse_album_id: string;
    chart_date: string;
    chart_position: number | null;
  }>;
};

export type IntegrityAuditResult = {
  generatedAt: string;
  error: string | null;
  /** False when `canonical_album_chart_runs` is missing from PostgREST (migration / project mismatch). */
  canonical_spine_reachable: boolean;
  warnings: string[];
  album_table_total: number | null;
  albums_scanned_for_heuristics: number;
  heuristics_cap: number;
  /** Distinct album ids on canonical spine (full table scan). */
  albums_with_canonical_rows: number;
  audit1_orphans: {
    skipped?: boolean;
    skip_reason?: string;
    severity: Severity;
    total_orphan_albums: number;
    samples: OrphanAlbum[];
  };
  audit2_duplicate_titles: {
    severity: Severity;
    cluster_count: number;
    clusters: DuplicateTitleCluster[];
    note: string;
  };
  audit3_split_charts: {
    skipped?: boolean;
    skip_reason?: string;
    severity: Severity;
    cluster_count: number;
    clusters: SplitChartCluster[];
    note: string;
  };
  audit4_chronology: {
    skipped?: boolean;
    skip_reason?: string;
    severity: Severity;
    /** Total rows matching the rule during the scan (may exceed `violations.length`). */
    violation_count: number;
    albums_checked: number;
    violations: ChronologyViolation[];
    note: string;
  };
  audit5_spine: {
    skipped?: boolean;
    skip_reason?: string;
    severity: Severity;
    summary: SpineViolationSummary;
  };
};

function norm(s: string | null | undefined): string {
  return (s ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function chunks<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function chartRangesRelated(a: { min: string; max: string }, b: { min: string; max: string }): boolean {
  const a0 = new Date(`${a.min.slice(0, 10)}T00:00:00Z`).getTime();
  const a1 = new Date(`${a.max.slice(0, 10)}T00:00:00Z`).getTime();
  const b0 = new Date(`${b.min.slice(0, 10)}T00:00:00Z`).getTime();
  const b1 = new Date(`${b.max.slice(0, 10)}T00:00:00Z`).getTime();
  const overlap = Math.max(a0, b0) <= Math.min(a1, b1);
  if (overlap) return true;
  const gapAB = b0 - a1;
  const gapBA = a0 - b1;
  const g = gapAB > 0 ? gapAB : gapBA > 0 ? gapBA : 0;
  return g > 0 && g <= 45 * 86400000;
}

async function fetchArtistMap(
  supabase: ReturnType<typeof createClient>,
  artistIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  for (const c of chunks([...new Set(artistIds)].filter(Boolean), 100)) {
    const { data, error } = await supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .in("retroverse_artist_id", c);
    if (error || !data) continue;
    for (const r of data as Array<{ retroverse_artist_id: string; canonical_artist_name: string | null }>) {
      map.set(r.retroverse_artist_id, (r.canonical_artist_name ?? "—").trim() || "—");
    }
  }
  return map;
}

async function fetchCanonicalBoundsForAlbums(
  supabase: ReturnType<typeof createClient>,
  ids: string[],
): Promise<Map<string, { min: string; max: string; weeks: number }>> {
  const bounds = new Map<string, { min: string; max: string; weeks: number }>();
  for (const chunk of chunks(ids, 80)) {
    const { data, error } = await supabase
      .from("canonical_album_chart_runs")
      .select("retroverse_album_id, chart_date")
      .in("retroverse_album_id", chunk);
    if (error || !data) continue;
    for (const row of data as Array<{ retroverse_album_id: string; chart_date: string }>) {
      const id = row.retroverse_album_id;
      const d = row.chart_date.slice(0, 10);
      const cur = bounds.get(id);
      if (!cur) {
        bounds.set(id, { min: d, max: d, weeks: 1 });
      } else {
        if (d < cur.min) cur.min = d;
        if (d > cur.max) cur.max = d;
        cur.weeks += 1;
      }
    }
  }
  return bounds;
}

const HEURISTICS_CAP = 10_000;
const MAX_ORPHAN_SAMPLES = 150;
const MAX_DUP_CLUSTERS_SHOW = 45;
const MAX_SPLIT_CLUSTERS_SHOW = 40;
const MAX_CHRONO_SHOW = 55;
const MAX_CHRONO_ALBUMS_SCAN = 12_000;
const SPINE_SCAN_PAGE = 4000;
const SPINE_SCAN_MAX_ROWS = 320_000;

const CANONICAL_SPINE_HELP =
  "PostgREST cannot see public.canonical_album_chart_runs (table missing or not in schema cache). Apply repo migration supabase/migrations/20260513120000_canonical_album_chart_runs.sql to this Supabase project, reload the API schema, and confirm NEXT_PUBLIC_SUPABASE_URL points at that project. See docs/canonical_album_chart_runs_serving.md.";

function canonicalSpineTableUnavailable(message: string): boolean {
  const m = message.toLowerCase();
  return (
    m.includes("schema cache") ||
    m.includes("does not exist") ||
    m.includes("could not find the table") ||
    (m.includes("relation") && m.includes("canonical_album_chart_runs"))
  );
}

type HeuristicAlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string | null;
  retroverse_artist_id: string | null;
  release_year?: number | null;
};

const emptySpineSummary = (): SpineViolationSummary => ({
  duplicate_week_rows: 0,
  invalid_position_rows: 0,
  null_key_rows: 0,
  rows_scanned: 0,
  scan_capped: false,
  duplicate_week_samples: [],
  invalid_position_samples: [],
});

async function loadHeuristicDuplicateAndSplitMaps(
  supabase: ReturnType<typeof createClient>,
): Promise<{
  heuristicsScanned: number;
  duplicateClusters: DuplicateTitleCluster[];
  splitKeyMap: Map<string, HeuristicAlbumRow[]>;
  heuristicsArtistMap: Map<string, string>;
}> {
  const dupByArtistTitle = new Map<string, HeuristicAlbumRow[]>();
  const splitKeyMap = new Map<string, HeuristicAlbumRow[]>();
  const heuristicAlbums: HeuristicAlbumRow[] = [];

  for (let aFrom = 0; aFrom < HEURISTICS_CAP; aFrom += 500) {
    const { data: albums, error: aErr } = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year")
      .order("retroverse_album_id", { ascending: true })
      .range(aFrom, aFrom + 499);
    if (aErr) throw new Error(aErr.message);
    if (!albums?.length) break;
    const batch = albums as HeuristicAlbumRow[];
    heuristicAlbums.push(...batch);
    for (const a of batch) {
      const title = norm(a.canonical_album_title);
      const aid = a.retroverse_artist_id ?? "__no_artist__";
      const dk = `${aid}||${title}`;
      if (!dupByArtistTitle.has(dk)) dupByArtistTitle.set(dk, []);
      dupByArtistTitle.get(dk)!.push(a);
    }
    if (batch.length < 500) break;
  }

  const heuristicsScanned = heuristicAlbums.length;
  const heuristicsArtistIds = [...new Set(heuristicAlbums.map((a) => a.retroverse_artist_id).filter(Boolean))] as string[];
  const heuristicsArtistMap = await fetchArtistMap(supabase, heuristicsArtistIds);

  for (const a of heuristicAlbums) {
    const title = norm(a.canonical_album_title);
    const anName = norm(
      a.retroverse_artist_id ? heuristicsArtistMap.get(a.retroverse_artist_id) ?? "" : "",
    );
    const sk = `${anName}||${title}`;
    if (!splitKeyMap.has(sk)) splitKeyMap.set(sk, []);
    splitKeyMap.get(sk)!.push(a);
  }

  const duplicateClusters: DuplicateTitleCluster[] = [];
  for (const [k, list] of dupByArtistTitle) {
    if (list.length <= 1) continue;
    const [artist_id, normalized_title] = k.split("||");
    const artist_name =
      artist_id === "__no_artist__" ? "—" : heuristicsArtistMap.get(artist_id) ?? "—";
    duplicateClusters.push({
      artist_id: artist_id === "__no_artist__" ? "—" : artist_id,
      artist_name,
      normalized_title,
      albums: list.map((a) => ({
        retroverse_album_id: a.retroverse_album_id,
        title: (a.canonical_album_title ?? "—").trim() || "—",
        release_year: a.release_year ?? null,
      })),
    });
  }

  return { heuristicsScanned, duplicateClusters, splitKeyMap, heuristicsArtistMap };
}

export async function loadIntegrityAudits(): Promise<IntegrityAuditResult> {
  const base = (error: string): IntegrityAuditResult => ({
    generatedAt: new Date().toISOString(),
    error,
    canonical_spine_reachable: false,
    warnings: [],
    album_table_total: null,
    albums_scanned_for_heuristics: 0,
    heuristics_cap: HEURISTICS_CAP,
    albums_with_canonical_rows: 0,
    audit1_orphans: { severity: "INFO", total_orphan_albums: 0, samples: [] },
    audit2_duplicate_titles: {
      severity: "INFO",
      cluster_count: 0,
      clusters: [],
      note: "",
    },
    audit3_split_charts: { severity: "INFO", cluster_count: 0, clusters: [], note: "" },
    audit4_chronology: {
      severity: "INFO",
      violation_count: 0,
      albums_checked: 0,
      violations: [],
      note: "",
    },
    audit5_spine: {
      severity: "INFO",
      summary: emptySpineSummary(),
    },
  });

  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY) {
    return base("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.");
  }

  const supabase = createClient();

  const { count: albumTotal, error: countErr } = await supabase
    .from("retroverse_albums")
    .select("*", { count: "exact", head: true });
  if (countErr) return base(countErr.message);

  const { error: spineProbeErr } = await supabase
    .from("canonical_album_chart_runs")
    .select("retroverse_album_id")
    .limit(1);

  const spineMissing =
    spineProbeErr != null && canonicalSpineTableUnavailable(spineProbeErr.message ?? "");
  if (spineProbeErr != null && !spineMissing) {
    return base(spineProbeErr.message ?? "canonical_album_chart_runs probe failed.");
  }

  if (spineMissing) {
    let duplicateClusters: DuplicateTitleCluster[] = [];
    let heuristicsScanned = 0;
    try {
      const h = await loadHeuristicDuplicateAndSplitMaps(supabase);
      duplicateClusters = h.duplicateClusters;
      heuristicsScanned = h.heuristicsScanned;
    } catch (e) {
      return base(e instanceof Error ? e.message : String(e));
    }
    const dupSeverity: Severity =
      duplicateClusters.length > 30 ? "WARNING" : duplicateClusters.length ? "WARNING" : "INFO";
    return {
      generatedAt: new Date().toISOString(),
      error: null,
      canonical_spine_reachable: false,
      warnings: [CANONICAL_SPINE_HELP],
      album_table_total: albumTotal ?? null,
      albums_scanned_for_heuristics: heuristicsScanned,
      heuristics_cap: HEURISTICS_CAP,
      albums_with_canonical_rows: 0,
      audit1_orphans: {
        skipped: true,
        skip_reason: CANONICAL_SPINE_HELP,
        severity: "WARNING",
        total_orphan_albums: 0,
        samples: [],
      },
      audit2_duplicate_titles: {
        severity: dupSeverity,
        cluster_count: duplicateClusters.length,
        clusters: duplicateClusters.slice(0, MAX_DUP_CLUSTERS_SHOW),
        note: `Duplicate-title heuristic: normalized title + same retroverse_artist_id, first ${HEURISTICS_CAP.toLocaleString()} albums by id (deterministic). Audits 1 and 3–5 require canonical_album_chart_runs.`,
      },
      audit3_split_charts: {
        skipped: true,
        skip_reason: CANONICAL_SPINE_HELP,
        severity: "WARNING",
        cluster_count: 0,
        clusters: [],
        note: "",
      },
      audit4_chronology: {
        skipped: true,
        skip_reason: CANONICAL_SPINE_HELP,
        severity: "WARNING",
        violation_count: 0,
        albums_checked: 0,
        violations: [],
        note: "",
      },
      audit5_spine: {
        skipped: true,
        skip_reason: CANONICAL_SPINE_HELP,
        severity: "WARNING",
        summary: emptySpineSummary(),
      },
    };
  }

  const seenCanonicalAlbums = new Set<string>();
  let cFrom = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("canonical_album_chart_runs")
      .select("retroverse_album_id")
      .range(cFrom, cFrom + 999);
    if (error) return base(error.message);
    if (!data?.length) break;
    for (const r of data as Array<{ retroverse_album_id: string }>) {
      seenCanonicalAlbums.add(r.retroverse_album_id);
    }
    if (data.length < 1000) break;
    cFrom += 1000;
  }

  let orphanTotal = 0;
  const orphanSamples: OrphanAlbum[] = [];

  for (let aFrom = 0; ; aFrom += 500) {
    const { data: albums, error: aErr } = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
      .order("retroverse_album_id", { ascending: true })
      .range(aFrom, aFrom + 499);
    if (aErr) return base(aErr.message);
    if (!albums?.length) break;
    const batch = albums as HeuristicAlbumRow[];
    const artistMap = await fetchArtistMap(
      supabase,
      batch.map((a) => a.retroverse_artist_id).filter((x): x is string => Boolean(x)),
    );
    for (const a of batch) {
      if (!seenCanonicalAlbums.has(a.retroverse_album_id)) {
        orphanTotal++;
        if (orphanSamples.length < MAX_ORPHAN_SAMPLES) {
          const an = a.retroverse_artist_id ? artistMap.get(a.retroverse_artist_id) ?? "—" : "—";
          orphanSamples.push({
            retroverse_album_id: a.retroverse_album_id,
            canonical_album_title: (a.canonical_album_title ?? "—").trim() || "—",
            artist_name: an,
          });
        }
      }
    }
    if (batch.length < 500) break;
  }

  let heuristicsScanned: number;
  let duplicateClusters: DuplicateTitleCluster[];
  let splitKeyMap: Map<string, HeuristicAlbumRow[]>;
  let heuristicsArtistMap: Map<string, string>;
  try {
    const h = await loadHeuristicDuplicateAndSplitMaps(supabase);
    heuristicsScanned = h.heuristicsScanned;
    duplicateClusters = h.duplicateClusters;
    splitKeyMap = h.splitKeyMap;
    heuristicsArtistMap = h.heuristicsArtistMap;
  } catch (e) {
    return base(e instanceof Error ? e.message : String(e));
  }

  const splitClusters: SplitChartCluster[] = [];
  const splitCandidates = [...splitKeyMap.entries()].filter(
    ([, list]) => list.length >= 2 && norm(list[0]?.canonical_album_title ?? "") !== "",
  );

  for (const [, list] of splitCandidates.slice(0, 220)) {
    const ids = list.map((a) => a.retroverse_album_id);
    const bounds = await fetchCanonicalBoundsForAlbums(supabase, ids);
    if (ids.some((id) => !bounds.has(id))) continue;
    const bvals = ids.map((id) => bounds.get(id)!);
    let related = false;
    for (let i = 0; i < ids.length && !related; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        if (chartRangesRelated(bvals[i]!, bvals[j]!)) {
          related = true;
        }
      }
    }
    if (!related) continue;

    splitClusters.push({
      normalized_artist: norm(heuristicsArtistMap.get(list[0]!.retroverse_artist_id ?? "") ?? ""),
      normalized_title: norm(list[0]!.canonical_album_title),
      albums: list.map((a) => {
        const b = bounds.get(a.retroverse_album_id)!;
        return {
          retroverse_album_id: a.retroverse_album_id,
          title: (a.canonical_album_title ?? "—").trim() || "—",
          artist_name: a.retroverse_artist_id
            ? heuristicsArtistMap.get(a.retroverse_artist_id) ?? "—"
            : "—",
          chart_weeks: b.weeks,
          first_chart_date: b.min,
          last_chart_date: b.max,
        };
      }),
    });
    if (splitClusters.length >= MAX_SPLIT_CLUSTERS_SHOW) break;
  }

  const chronologyViolations: ChronologyViolation[] = [];
  let chronoViolationTotal = 0;
  let chronoChecked = 0;
  for (let aFrom = 0; aFrom < MAX_CHRONO_ALBUMS_SCAN; aFrom += 200) {
    const { data: albums, error } = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year")
      .not("release_year", "is", null)
      .order("retroverse_album_id", { ascending: true })
      .range(aFrom, aFrom + 199);
    if (error || !albums?.length) break;
    const batch = albums as HeuristicAlbumRow[];
    chronoChecked += batch.length;
    const ids = batch.map((a) => a.retroverse_album_id);
    const artistMap = await fetchArtistMap(
      supabase,
      batch.map((a) => a.retroverse_artist_id).filter((x): x is string => Boolean(x)),
    );

    const { data: rows } = await supabase
      .from("canonical_album_chart_runs")
      .select("retroverse_album_id, chart_date")
      .in("retroverse_album_id", ids);
    const earliest = new Map<string, string>();
    for (const r of (rows ?? []) as Array<{ retroverse_album_id: string; chart_date: string }>) {
      const d = r.chart_date.slice(0, 10);
      const cur = earliest.get(r.retroverse_album_id);
      if (!cur || d < cur) earliest.set(r.retroverse_album_id, d);
    }

    for (const a of batch) {
      const ry = a.release_year;
      if (ry == null || ry < 1800 || ry > 2100) continue;
      const ed = earliest.get(a.retroverse_album_id);
      if (!ed) continue;
      const chartYear = parseInt(ed.slice(0, 4), 10);
      if (!Number.isFinite(chartYear)) continue;
      if (chartYear < ry) {
        chronoViolationTotal++;
        if (chronologyViolations.length < MAX_CHRONO_SHOW) {
          chronologyViolations.push({
            retroverse_album_id: a.retroverse_album_id,
            title: (a.canonical_album_title ?? "—").trim() || "—",
            artist_name: a.retroverse_artist_id
              ? artistMap.get(a.retroverse_artist_id) ?? "—"
              : "—",
            release_year: ry,
            earliest_chart_date: ed,
            years_before_release: ry - chartYear,
          });
        }
      }
    }
    if (batch.length < 200) break;
  }

  type DupAgg = { count: number; firstPosition: number };
  const dupWeekAgg = new Map<string, DupAgg>();
  let invalidPosition = 0;
  let nullRows = 0;
  let rowsScanned = 0;
  const invSamples: SpineViolationSummary["invalid_position_samples"] = [];
  let scanCapped = false;

  for (let p = 0; rowsScanned < SPINE_SCAN_MAX_ROWS; p += SPINE_SCAN_PAGE) {
    const { data, error } = await supabase
      .from("canonical_album_chart_runs")
      .select("retroverse_album_id, chart_date, chart_position")
      .range(p, p + SPINE_SCAN_PAGE - 1);
    if (error) break;
    if (!data?.length) break;
    for (const r of data as Array<{
      retroverse_album_id: string | null;
      chart_date: string | null;
      chart_position: number | null;
    }>) {
      rowsScanned++;
      if (!r.retroverse_album_id || !r.chart_date || r.chart_position == null) {
        nullRows++;
        if (invSamples.length < 30) {
          invSamples.push({
            retroverse_album_id: r.retroverse_album_id ?? "—",
            chart_date: (r.chart_date ?? "—").slice(0, 10),
            chart_position: r.chart_position,
          });
        }
        continue;
      }
      const pos = Number(r.chart_position);
      if (!Number.isFinite(pos) || pos < 1 || pos > 200) {
        invalidPosition++;
        if (invSamples.length < 45) {
          invSamples.push({
            retroverse_album_id: r.retroverse_album_id,
            chart_date: r.chart_date.slice(0, 10),
            chart_position: r.chart_position,
          });
        }
      }
      const k = `${r.retroverse_album_id}|${r.chart_date.slice(0, 10)}`;
      const cur = dupWeekAgg.get(k);
      if (!cur) {
        dupWeekAgg.set(k, { count: 1, firstPosition: pos });
      } else {
        cur.count += 1;
      }
    }
    if (data.length < SPINE_SCAN_PAGE) break;
  }
  scanCapped = rowsScanned >= SPINE_SCAN_MAX_ROWS;

  let duplicateWeekRows = 0;
  const dupSamples: SpineViolationSummary["duplicate_week_samples"] = [];
  for (const [k, agg] of dupWeekAgg) {
    if (agg.count > 1) {
      duplicateWeekRows += agg.count - 1;
      if (dupSamples.length < 40) {
        const [id, date] = k.split("|");
        dupSamples.push({
          retroverse_album_id: id,
          chart_date: date,
          chart_position: agg.firstPosition,
          row_count: agg.count,
        });
      }
    }
  }

  const spineSummary: SpineViolationSummary = {
    duplicate_week_rows: duplicateWeekRows,
    invalid_position_rows: invalidPosition,
    null_key_rows: nullRows,
    rows_scanned: rowsScanned,
    scan_capped: scanCapped,
    duplicate_week_samples: dupSamples,
    invalid_position_samples: invSamples,
  };

  const orphanSeverity: Severity = orphanTotal > 2000 ? "WARNING" : orphanTotal > 0 ? "INFO" : "INFO";
  const dupSeverity: Severity = duplicateClusters.length > 30 ? "WARNING" : duplicateClusters.length ? "WARNING" : "INFO";
  const splitSeverity: Severity = splitClusters.length ? "CRITICAL" : "INFO";
  const chronoSeverity: Severity = chronoViolationTotal ? "CRITICAL" : "INFO";
  const spineSeverity: Severity =
    spineSummary.duplicate_week_rows + spineSummary.invalid_position_rows + spineSummary.null_key_rows > 0
      ? "CRITICAL"
      : spineSummary.scan_capped
        ? "WARNING"
        : "INFO";

  return {
    generatedAt: new Date().toISOString(),
    error: null,
    canonical_spine_reachable: true,
    warnings: [],
    album_table_total: albumTotal ?? null,
    albums_scanned_for_heuristics: heuristicsScanned,
    heuristics_cap: HEURISTICS_CAP,
    albums_with_canonical_rows: seenCanonicalAlbums.size,
    audit1_orphans: {
      severity: orphanSeverity,
      total_orphan_albums: orphanTotal,
      samples: orphanSamples,
    },
    audit2_duplicate_titles: {
      severity: dupSeverity,
      cluster_count: duplicateClusters.length,
      clusters: duplicateClusters.slice(0, MAX_DUP_CLUSTERS_SHOW),
      note: `Duplicate-title heuristic: normalized title + same retroverse_artist_id, first ${HEURISTICS_CAP.toLocaleString()} albums by id (deterministic).`,
    },
    audit3_split_charts: {
      severity: splitSeverity,
      cluster_count: splitClusters.length,
      clusters: splitClusters,
      note:
        "Split-chart heuristic: same normalized artist name + title, ≥2 RVALs, canonical date ranges overlap or within 45 days (candidate scan capped).",
    },
    audit4_chronology: {
      severity: chronoSeverity,
      violation_count: chronoViolationTotal,
      albums_checked: chronoChecked,
      violations: chronologyViolations,
      note: `Earliest canonical chart calendar year < release_year; scanned first ${MAX_CHRONO_ALBUMS_SCAN.toLocaleString()} albums with non-null release_year (ordered by id). Table: first ${MAX_CHRONO_SHOW} samples.`,
    },
    audit5_spine: {
      severity: spineSeverity,
      summary: spineSummary,
    },
  };
}
