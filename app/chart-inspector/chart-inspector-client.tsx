"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { createClient } from "@/lib/supabase";
import { chartDateToYearFloat } from "@/app/retroverse_v3/occupancy-chart-math";

/** Same order of magnitude as Retroscope weekly spine: break line if > ~20d between chart rows. */
const SEGMENT_GAP_YEAR_FLOAT = 0.055;

const W = 920;
const H = 480;
const PAD = { l: 56, r: 24, t: 28, b: 44 };

type AlbumPick = {
  retroverse_album_id: string;
  canonical_album_title: string | null;
  retroverse_artist_id: string | null;
  artist_name: string;
};

type RunRow = { chart_date: string; chart_position: number };

function escapeIlike(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

async function artistNameMap(
  supabase: ReturnType<typeof createClient>,
  artistIds: string[],
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  const uniq = [...new Set(artistIds)].filter(Boolean);
  if (uniq.length === 0) return map;
  for (let i = 0; i < uniq.length; i += 80) {
    const chunk = uniq.slice(i, i + 80);
    const { data, error } = await supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .in("retroverse_artist_id", chunk);
    if (error || !data) continue;
    for (const row of data as Array<{
      retroverse_artist_id: string;
      canonical_artist_name: string | null;
    }>) {
      map.set(
        row.retroverse_artist_id,
        (row.canonical_artist_name ?? "—").trim() || "—",
      );
    }
  }
  return map;
}

function splitSegments(points: RunRow[]): RunRow[][] {
  const sorted = [...points].sort(
    (a, b) => new Date(a.chart_date).getTime() - new Date(b.chart_date).getTime(),
  );
  if (sorted.length === 0) return [];
  const segments: RunRow[][] = [];
  let cur: RunRow[] = [sorted[0]!];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1]!;
    const p = sorted[i]!;
    const y0 = chartDateToYearFloat(prev.chart_date);
    const y1 = chartDateToYearFloat(p.chart_date);
    if (y0 !== null && y1 !== null && y1 - y0 > SEGMENT_GAP_YEAR_FLOAT) {
      segments.push(cur);
      cur = [p];
    } else {
      cur.push(p);
    }
  }
  segments.push(cur);
  return segments;
}

/** Album ids: legacy `RVAL…` text keys or UUID-shaped ids. */
const RVAL_ID_RE =
  /^(?:RVAL\d+|[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;

type ChartInspectorClientProps = {
  initialAlbumId?: string | null;
};

export default function ChartInspectorClient({ initialAlbumId = null }: ChartInspectorClientProps) {
  const supabase = useMemo(() => createClient(), []);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<AlbumPick[]>([]);
  const [searching, setSearching] = useState(false);
  const [selected, setSelected] = useState<AlbumPick | null>(null);
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [loadingRuns, setLoadingRuns] = useState(false);
  const [hover, setHover] = useState<{ date: string; pos: number } | null>(null);

  const search = useCallback(async () => {
    const q = query.trim();
    if (q.length < 2) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      const pat = `%${escapeIlike(q)}%`;
      const { data: byTitle, error: e1 } = await supabase
        .from("retroverse_albums")
        .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
        .ilike("canonical_album_title", pat)
        .limit(16);
      if (e1) throw e1;

      const { data: artists, error: e2 } = await supabase
        .from("retroverse_artists")
        .select("retroverse_artist_id")
        .ilike("canonical_artist_name", pat)
        .limit(24);
      if (e2) throw e2;

      const artistIds = [...new Set((artists ?? []).map((r) => r.retroverse_artist_id))];
      let byArtistRows: Array<{
        retroverse_album_id: string;
        canonical_album_title: string | null;
        retroverse_artist_id: string | null;
      }> = [];
      if (artistIds.length > 0) {
        const { data: albums, error: e3 } = await supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
          .in("retroverse_artist_id", artistIds)
          .limit(16);
        if (e3) throw e3;
        byArtistRows = (albums ?? []) as typeof byArtistRows;
      }

      const raw = [...(byTitle ?? []), ...byArtistRows] as typeof byArtistRows;
      const aid = raw.map((r) => r.retroverse_artist_id).filter((x): x is string => Boolean(x));
      const names = await artistNameMap(supabase, aid);

      const seen = new Set<string>();
      const merged: AlbumPick[] = [];
      for (const row of raw) {
        const id = row.retroverse_album_id;
        if (seen.has(id)) continue;
        seen.add(id);
        merged.push({
          ...row,
          artist_name:
            (row.retroverse_artist_id && names.get(row.retroverse_artist_id)) ?? "—",
        });
        if (merged.length >= 24) break;
      }
      setResults(merged);
    } catch {
      setResults([]);
    } finally {
      setSearching(false);
    }
  }, [query, supabase]);

  useEffect(() => {
    const t = window.setTimeout(() => {
      void search();
    }, 280);
    return () => window.clearTimeout(t);
  }, [search]);

  const loadRuns = useCallback(
    async (albumId: string) => {
      setLoadingRuns(true);
      setRuns([]);
      try {
        const { data, error } = await supabase
          .from("canonical_album_chart_runs")
          .select("chart_date, chart_position")
          .eq("retroverse_album_id", albumId)
          .order("chart_date", { ascending: true });
        if (error) throw error;
        setRuns((data ?? []) as RunRow[]);
      } catch {
        setRuns([]);
      } finally {
        setLoadingRuns(false);
      }
    },
    [supabase],
  );

  const pickAlbum = useCallback(
    (row: AlbumPick) => {
      setSelected(row);
      setResults([]);
      void loadRuns(row.retroverse_album_id);
    },
    [loadRuns],
  );

  useEffect(() => {
    if (!initialAlbumId || !RVAL_ID_RE.test(initialAlbumId)) return;
    let cancelled = false;
    void (async () => {
      const { data, error } = await supabase
        .from("retroverse_albums")
        .select("retroverse_album_id, canonical_album_title, retroverse_artist_id")
        .eq("retroverse_album_id", initialAlbumId)
        .maybeSingle();
      if (cancelled || error || !data) return;
      const aid = data.retroverse_artist_id;
      const names = await artistNameMap(supabase, aid ? [aid] : []);
      const row: AlbumPick = {
        retroverse_album_id: data.retroverse_album_id,
        canonical_album_title: data.canonical_album_title,
        retroverse_artist_id: data.retroverse_artist_id,
        artist_name: aid ? names.get(aid) ?? "—" : "—",
      };
      pickAlbum(row);
    })();
    return () => {
      cancelled = true;
    };
  }, [initialAlbumId, pickAlbum, supabase]);

  const stats = useMemo(() => {
    if (runs.length === 0) {
      return {
        first: null as string | null,
        last: null as string | null,
        weeks: 0,
        peak: null as number | null,
      };
    }
    const sorted = [...runs].sort(
      (a, b) => new Date(a.chart_date).getTime() - new Date(b.chart_date).getTime(),
    );
    const peak = Math.min(...runs.map((r) => r.chart_position));
    return {
      first: sorted[0]!.chart_date,
      last: sorted[sorted.length - 1]!.chart_date,
      weeks: runs.length,
      peak,
    };
  }, [runs]);

  const { polylines, pointsPx } = useMemo(() => {
    const innerW = W - PAD.l - PAD.r;
    const innerH = H - PAD.t - PAD.b;
    if (runs.length === 0) {
      return { polylines: [] as string[], pointsPx: [] as { x: number; y: number; date: string; pos: number }[] };
    }
    const tms = runs.map((r) => new Date(`${r.chart_date.slice(0, 10)}T00:00:00Z`).getTime());
    const xMinT = Math.min(...tms);
    const xMaxT = Math.max(...tms);
    const span = Math.max(xMaxT - xMinT, 86400000);

    const xOf = (dateStr: string) => {
      const t = new Date(`${dateStr.slice(0, 10)}T00:00:00Z`).getTime();
      return PAD.l + ((t - xMinT) / span) * innerW;
    };
    const yOf = (pos: number) => {
      const p = Math.max(1, Math.min(200, pos));
      return PAD.t + ((p - 1) / 199) * innerH;
    };

    const segments = splitSegments(runs);
    const polylines = segments
      .filter((s) => s.length >= 2)
      .map((seg) =>
        seg
          .map((r) => `${xOf(r.chart_date).toFixed(2)},${yOf(r.chart_position).toFixed(2)}`)
          .join(" "),
      );

    const pointsPx = runs.map((r) => ({
      x: xOf(r.chart_date),
      y: yOf(r.chart_position),
      date: r.chart_date.slice(0, 10),
      pos: r.chart_position,
    }));

    return { polylines, pointsPx };
  }, [runs]);

  const gridLinesY = useMemo(() => {
    const innerH = H - PAD.t - PAD.b;
    const lines: { y: number; label: string }[] = [];
    for (const pos of [1, 10, 25, 50, 100, 150, 200]) {
      const y = PAD.t + ((pos - 1) / 199) * innerH;
      lines.push({ y, label: String(pos) });
    }
    return lines;
  }, []);

  return (
    <div className="ci-root">
      <header className="ci-header">
        <h1 className="ci-title">Chart inspector</h1>
        <p className="ci-sub">Internal · canonical_album_chart_runs only</p>
      </header>

      <section className="ci-toolbar">
        <label className="ci-label" htmlFor="ci-search">
          Album search
        </label>
        <div className="ci-search-wrap">
          <input
            id="ci-search"
            className="ci-input"
            type="search"
            placeholder="Title or artist…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoComplete="off"
          />
          {searching ? <span className="ci-muted">Searching…</span> : null}
        </div>
        {results.length > 0 ? (
          <ul className="ci-results" role="listbox">
            {results.map((r) => {
              const title = (r.canonical_album_title ?? "—").trim();
              return (
                <li key={r.retroverse_album_id}>
                  <button type="button" className="ci-result-btn" onClick={() => pickAlbum(r)}>
                    <span className="ci-result-title">{title}</span>
                    <span className="ci-result-artist">{r.artist_name}</span>
                    <span className="ci-result-id">{r.retroverse_album_id}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : null}
      </section>

      {selected ? (
        <section className="ci-meta">
          <h2 className="ci-album-title">{(selected.canonical_album_title ?? "—").trim()}</h2>
          <p className="ci-artist">{selected.artist_name}</p>
          <dl className="ci-dl">
            <div>
              <dt>Album id</dt>
              <dd>{selected.retroverse_album_id}</dd>
            </div>
            <div>
              <dt>First week</dt>
              <dd>{stats.first ?? "—"}</dd>
            </div>
            <div>
              <dt>Last week</dt>
              <dd>{stats.last ?? "—"}</dd>
            </div>
            <div>
              <dt>Weeks</dt>
              <dd>{stats.weeks}</dd>
            </div>
            <div>
              <dt>Peak (#)</dt>
              <dd>{stats.peak ?? "—"}</dd>
            </div>
          </dl>
        </section>
      ) : null}

      <section className="ci-chart-wrap">
        {loadingRuns ? <p className="ci-muted">Loading canonical spine…</p> : null}
        {!loadingRuns && selected && runs.length === 0 ? (
          <p className="ci-warn">No rows in canonical_album_chart_runs for this album.</p>
        ) : null}
        {runs.length > 0 ? (
          <div className="ci-svg-outer">
            <svg
              className="ci-svg"
              viewBox={`0 0 ${W} ${H}`}
              role="img"
              aria-label="Billboard 200 canonical trajectory"
            >
              <rect width={W} height={H} className="ci-svg-bg" />
              {gridLinesY.map(({ y, label }) => (
                <g key={label}>
                  <line x1={PAD.l} x2={W - PAD.r} y1={y} y2={y} className="ci-grid" />
                  <text x={PAD.l - 8} y={y + 4} textAnchor="end" className="ci-axis-label">
                    {label}
                  </text>
                </g>
              ))}
              <line x1={PAD.l} x2={PAD.l} y1={PAD.t} y2={H - PAD.b} className="ci-axis" />
              <line x1={PAD.l} x2={W - PAD.r} y1={H - PAD.b} y2={H - PAD.b} className="ci-axis" />
              <text x={PAD.l} y={PAD.t - 8} className="ci-axis-title">
                Rank (1 top)
              </text>
              <text x={W / 2} y={H - 8} textAnchor="middle" className="ci-axis-title">
                chart_date (UTC)
              </text>

              {polylines.map((pts, i) => (
                <polyline key={`pl-${i}`} fill="none" className="ci-line" points={pts} />
              ))}
              {pointsPx.map((p, i) => (
                <circle
                  key={`pt-${i}`}
                  cx={p.x}
                  cy={p.y}
                  r={5}
                  className="ci-hit"
                  onMouseEnter={() => setHover({ date: p.date, pos: p.pos })}
                  onMouseLeave={() => setHover(null)}
                />
              ))}
              {pointsPx.map((p, i) => (
                <circle key={`dot-${i}`} cx={p.x} cy={p.y} r={1.8} className="ci-dot" />
              ))}
            </svg>
            <div className="ci-tip-bar">{hover ? `Week ${hover.date} · Position ${hover.pos}` : "Hover a point"}</div>
          </div>
        ) : null}
      </section>

      <style jsx>{`
        .ci-root {
          min-height: 100vh;
          background: #0f1114;
          color: #e8eaed;
          padding: 1.25rem 1.5rem 3rem;
          font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
          font-size: 13px;
        }
        .ci-header {
          margin-bottom: 1.25rem;
          border-bottom: 1px solid #2a3038;
          padding-bottom: 0.75rem;
        }
        .ci-title {
          margin: 0;
          font-size: 1.1rem;
          font-weight: 600;
          letter-spacing: 0.02em;
        }
        .ci-sub {
          margin: 0.35rem 0 0;
          color: #8b939e;
          font-size: 12px;
        }
        .ci-toolbar {
          max-width: 520px;
          margin-bottom: 1rem;
        }
        .ci-label {
          display: block;
          color: #8b939e;
          margin-bottom: 0.35rem;
        }
        .ci-input {
          width: 100%;
          box-sizing: border-box;
          padding: 0.45rem 0.6rem;
          background: #1a1e24;
          border: 1px solid #3d4654;
          color: #e8eaed;
          border-radius: 2px;
        }
        .ci-input:focus {
          outline: 1px solid #5a6575;
        }
        .ci-search-wrap {
          display: flex;
          align-items: center;
          gap: 0.75rem;
        }
        .ci-muted {
          color: #6d7684;
        }
        .ci-warn {
          color: #c9a227;
        }
        .ci-results {
          list-style: none;
          margin: 0.5rem 0 0;
          padding: 0;
          border: 1px solid #2a3038;
          max-height: 220px;
          overflow-y: auto;
          background: #15191e;
        }
        .ci-result-btn {
          display: grid;
          grid-template-columns: 1fr auto;
          grid-template-rows: auto auto;
          width: 100%;
          text-align: left;
          padding: 0.45rem 0.6rem;
          border: none;
          border-bottom: 1px solid #252a32;
          background: transparent;
          color: inherit;
          cursor: pointer;
          font: inherit;
        }
        .ci-result-btn:hover {
          background: #1e242c;
        }
        .ci-result-title {
          grid-column: 1;
          font-weight: 500;
        }
        .ci-result-artist {
          grid-column: 1;
          grid-row: 2;
          color: #8b939e;
          font-size: 12px;
        }
        .ci-result-id {
          grid-column: 2;
          grid-row: 1 / span 2;
          align-self: center;
          color: #5c6570;
          font-size: 11px;
        }
        .ci-meta {
          margin-bottom: 1rem;
          padding: 0.75rem 0;
          border-bottom: 1px solid #2a3038;
        }
        .ci-album-title {
          margin: 0;
          font-size: 1rem;
        }
        .ci-artist {
          margin: 0.25rem 0 0.75rem;
          color: #9aa3ad;
        }
        .ci-dl {
          display: flex;
          flex-wrap: wrap;
          gap: 1rem 1.5rem;
          margin: 0;
        }
        .ci-dl dt {
          color: #6d7684;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.04em;
        }
        .ci-dl dd {
          margin: 0.15rem 0 0;
        }
        .ci-chart-wrap {
          margin-top: 0.5rem;
        }
        .ci-svg-outer {
          position: relative;
          max-width: 920px;
        }
        .ci-svg {
          width: 100%;
          height: auto;
          display: block;
          border: 1px solid #2a3038;
        }
        .ci-svg-bg {
          fill: #12161c;
        }
        .ci-grid {
          stroke: #252b34;
          stroke-width: 1;
        }
        .ci-axis {
          stroke: #3d4654;
          stroke-width: 1;
        }
        .ci-axis-label {
          fill: #6d7684;
          font-size: 10px;
        }
        .ci-axis-title {
          fill: #8b939e;
          font-size: 11px;
        }
        .ci-line {
          stroke: #d8dde4;
          stroke-width: 1.25;
          stroke-linejoin: round;
          stroke-linecap: round;
        }
        .ci-dot {
          fill: #c5cbd3;
        }
        .ci-hit {
          fill: transparent;
          cursor: crosshair;
        }
        .ci-tip-bar {
          margin-top: 0.35rem;
          padding: 0.35rem 0.5rem;
          background: #1a1e24;
          border: 1px solid #2a3038;
          color: #c5cbd3;
          font-size: 12px;
        }
      `}</style>
    </div>
  );
}
