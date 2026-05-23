"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { chartTrackLinkKey } from "@/lib/track-link-key";
import { relationshipWorkspaceHref } from "@/lib/retroverse-nav";
import type {
  TrackDeckPlaybackSource,
  TrackDeckTrackRow,
  TrackDeckWeekPayload,
} from "@/lib/track-deck/types";

type WeekIndex = {
  minDate: string;
  maxDate: string;
  weekCount: number;
  years: Array<{ year: number; weekCount: number }>;
  weeksForYear: string[];
};

type PlaybackFilter = "all" | "vdj" | "yt";

function formatWeekShort(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "2-digit" });
}

function linkWorkspaceHref(
  artist: string,
  title: string,
  opts?: { chartWeek?: string; chartRank?: number },
): string {
  const base = relationshipWorkspaceHref(artist, title);
  if (!opts?.chartWeek && opts?.chartRank == null) return base;
  const q = new URLSearchParams(base.split("?")[1] ?? "");
  if (opts.chartWeek) q.set("chartWeek", opts.chartWeek);
  if (opts.chartRank != null) q.set("chartRank", String(opts.chartRank));
  return `/relationship-workspace?${q.toString()}`;
}

type Props = {
  sqlitePath: string;
  initialDate: string | null;
  initialYear: number;
  initialIndex: WeekIndex | null;
  initialWeek: TrackDeckWeekPayload | null;
  linkedKeys: string[];
  dbError: string | null;
  initialTrackQuery?: string | null;
};

export default function TrackDeckClient({
  sqlitePath,
  initialDate,
  initialYear,
  initialIndex,
  initialWeek,
  linkedKeys: initialLinkedKeys,
  dbError: initialDbError,
  initialTrackQuery = null,
}: Props) {
  const router = useRouter();
  const [index, setIndex] = useState<WeekIndex | null>(initialIndex);
  const [year, setYear] = useState(initialYear);
  const [issueDate, setIssueDate] = useState<string | null>(initialDate);
  const [week, setWeek] = useState<TrackDeckWeekPayload | null>(initialWeek);
  const [loadingIndex, setLoadingIndex] = useState(!initialIndex && !initialDbError);
  const [loadingWeek, setLoadingWeek] = useState(false);
  const [error, setError] = useState<string | null>(initialDbError);
  const [playbackFilter, setPlaybackFilter] = useState<PlaybackFilter>("all");
  const [linkedKeys] = useState<Set<string>>(() => new Set(initialLinkedKeys));
  const [toast, setToast] = useState<string | null>(null);
  const [trackQuery, setTrackQuery] = useState(initialTrackQuery ?? "");
  const [searchingTrack, setSearchingTrack] = useState(false);

  const loadedDateRef = useRef<string | null>(initialWeek?.week.issueDate ?? null);
  const yearRef = useRef(year);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 1800);
  }, []);

  const loadIndex = useCallback(async (y: number) => {
    setLoadingIndex(true);
    setError(null);
    try {
      const res = await fetch(`/api/track-deck/weeks?year=${y}`);
      const body = (await res.json()) as WeekIndex & { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      setIndex({
        minDate: body.minDate,
        maxDate: body.maxDate,
        weekCount: body.weekCount,
        years: body.years,
        weeksForYear: body.weeksForYear,
      });
      return body;
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setIndex(null);
      return null;
    } finally {
      setLoadingIndex(false);
    }
  }, []);

  const loadWeek = useCallback(async (date: string) => {
    if (loadedDateRef.current === date && week?.week.issueDate === date) return;
    setLoadingWeek(true);
    setError(null);
    try {
      const res = await fetch(`/api/track-deck/week?date=${encodeURIComponent(date)}`);
      const body = (await res.json()) as TrackDeckWeekPayload & { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      loadedDateRef.current = date;
      setWeek({
        week: body.week,
        tracks: body.tracks,
        stats: body.stats,
      });
      setIssueDate(date);
      const next = new URL(window.location.href);
      next.searchParams.set("date", date);
      window.history.replaceState(null, "", `${next.pathname}?${next.searchParams.toString()}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setWeek(null);
    } finally {
      setLoadingWeek(false);
    }
  }, [week?.week.issueDate]);

  useEffect(() => {
    if (yearRef.current === year && initialIndex && index) return;
    yearRef.current = year;
    loadedDateRef.current = null;

    let cancelled = false;
    (async () => {
      const body = await loadIndex(year);
      if (cancelled || !body?.weeksForYear.length) return;
      const keep =
        issueDate && body.weeksForYear.includes(issueDate)
          ? issueDate
          : body.weeksForYear[Math.floor(body.weeksForYear.length / 2)]!;
      await loadWeek(keep);
    })();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [year]);

  const stepWeek = useCallback(
    async (dir: "prev" | "next") => {
      if (!issueDate) return;
      const res = await fetch(
        `/api/track-deck/week?date=${encodeURIComponent(issueDate)}&neighbor=${dir}`,
      );
      const body = (await res.json()) as { ok?: boolean; issueDate?: string | null; error?: string };
      if (!res.ok || !body.issueDate) return;
      const nextYear = Number.parseInt(body.issueDate.slice(0, 4), 10);
      loadedDateRef.current = null;
      if (nextYear !== year) setYear(nextYear);
      else await loadWeek(body.issueDate);
    },
    [issueDate, year, loadWeek],
  );

  const onSelectWeek = useCallback(
    (date: string) => {
      loadedDateRef.current = null;
      void loadWeek(date);
    },
    [loadWeek],
  );

  const playbackStats = useMemo(() => {
    if (!week) return null;
    let vdj = 0;
    let yt = 0;
    for (const t of week.tracks) {
      if (t.playbackSource === "local") vdj += 1;
      else if (t.playbackSource === "youtube") yt += 1;
    }
    return { vdj, yt, total: week.tracks.length };
  }, [week]);

  const filteredTracks = useMemo(() => {
    if (!week) return [];
    return week.tracks.filter((t) => {
      if (playbackFilter === "vdj") return t.playbackSource === "local";
      if (playbackFilter === "yt") return t.playbackSource === "youtube";
      return true;
    });
  }, [week, playbackFilter]);

  const fatalError = error && !week && !loadingWeek && !loadingIndex;

  const findTrack = useCallback(async () => {
    const q = trackQuery.trim();
    if (q.length < 2) {
      showToast("Type at least 2 characters");
      return;
    }
    setSearchingTrack(true);
    try {
      const res = await fetch(`/api/home-search?q=${encodeURIComponent(q)}`);
      const body = (await res.json()) as {
        ok?: boolean;
        tracks?: Array<{ href: string; title: string; artist: string }>;
      };
      const hit = body.tracks?.[0];
      if (hit?.href) {
        router.push(hit.href);
        return;
      }
      showToast("No track found");
    } catch {
      showToast("Search failed");
    } finally {
      setSearchingTrack(false);
    }
  }, [trackQuery, router, showToast]);

  return (
    <div className="track-deck-scope flex h-[calc(100vh-3.5rem)] flex-col text-[var(--td-fg)]">
      <style>{`
        .track-deck-scope {
          --td-bg: #0a0a09;
          --td-graphite: #141413;
          --td-panel: #111110;
          --td-border: rgba(255, 255, 255, 0.08);
          --td-border-lit: rgba(255, 255, 255, 0.14);
          --td-muted: #9a9a92;
          --td-fg: #eceae4;
          --td-brass: #c9b070;
          --td-cyan: #6eb8b0;
          --td-teal: #5a9e96;
          --td-olive: #7a8468;
          --td-dim: #6e6e66;
          --td-burgundy: rgba(56, 22, 30, 0.45);
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          font-size: 15px;
          line-height: 1.38;
          color: var(--td-fg);
          background:
            radial-gradient(ellipse 80% 40% at 50% -5%, rgba(110, 184, 176, 0.07), transparent 55%),
            radial-gradient(ellipse 40% 50% at 100% 80%, var(--td-burgundy), transparent 70%),
            var(--td-bg);
        }
        .td-timeline {
          border-bottom: 1px solid var(--td-border);
          background: var(--td-graphite);
          box-shadow: inset 0 -1px 0 rgba(0, 0, 0, 0.5);
        }
        .td-header-title {
          font-family: var(--d-font-editorial, Georgia, "Times New Roman", serif);
          font-size: 1.12rem;
          font-weight: 650;
          letter-spacing: 0.1em;
          text-transform: uppercase;
          color: var(--td-fg);
        }
        .td-header-sub {
          font-size: 0.76rem;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--td-cyan);
        }
        .td-console {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 0.35rem 0.55rem;
          padding: 0.55rem 0;
          border-top: 1px solid rgba(255, 255, 255, 0.04);
        }
        .td-cmd {
          border: none;
          background: transparent;
          color: var(--td-muted);
          border-radius: 2px;
          padding: 0.35rem 0.5rem;
          font-size: 0.84rem;
          line-height: 1.25;
          cursor: pointer;
          min-height: 2.25rem;
        }
        .td-cmd:hover:not(:disabled) { color: var(--td-fg); background: rgba(255, 255, 255, 0.04); }
        .td-cmd:disabled { opacity: 0.35; cursor: not-allowed; }
        .td-cmd-go {
          border: 1px solid rgba(201, 176, 112, 0.35);
          background: rgba(201, 176, 112, 0.08);
          color: var(--td-brass);
          padding: 0.35rem 0.75rem;
        }
        .td-cmd-go:hover:not(:disabled) {
          border-color: rgba(201, 176, 112, 0.55);
          box-shadow: 0 0 14px rgba(201, 176, 112, 0.15);
        }
        .td-filter-seg {
          display: inline-flex;
          margin-left: auto;
          border: 1px solid var(--td-border);
          border-radius: 3px;
          overflow: hidden;
          background: var(--td-panel);
        }
        .td-filter-seg .td-cmd {
          border-radius: 0;
          padding: 0.35rem 0.6rem;
          font-size: 0.8rem;
        }
        .td-filter-seg .td-cmd-on {
          color: var(--td-cyan);
          background: rgba(110, 184, 176, 0.12);
        }
        .td-inp {
          border: none;
          border-bottom: 1px solid var(--td-border);
          background: transparent;
          color: var(--td-fg);
          border-radius: 0;
          padding: 0.4rem 0.35rem;
          font-size: 0.92rem;
          line-height: 1.35;
          min-height: 2.25rem;
        }
        .td-inp:focus {
          outline: none;
          border-bottom-color: var(--td-cyan);
        }
        .td-inp-year {
          width: 4.5rem;
          text-align: center;
        }
        .td-inp-week {
          min-width: 10rem;
          max-width: 12rem;
        }
        .td-find {
          display: flex;
          align-items: flex-end;
          gap: 0.5rem;
          min-width: min(18rem, 100%);
          flex: 1 1 16rem;
        }
        .td-find .td-inp { flex: 1; min-width: 0; }
        .td-stats {
          font-size: 0.86rem;
          color: var(--td-muted);
        }
        .td-stats strong { color: var(--td-fg); font-weight: 600; }
        .td-rail {
          list-style: none;
          margin: 0;
          padding: 0.55rem 0.4rem 1.5rem;
        }
        .td-row {
          display: flex;
          align-items: center;
          gap: 0.75rem;
          min-height: 4.35rem;
          margin: 0 0 0.35rem;
          padding: 0.7rem 0.65rem 0.75rem 0.7rem;
          border: 1px solid rgba(255, 255, 255, 0.06);
          border-radius: 4px;
          background: linear-gradient(
            180deg,
            rgba(22, 22, 21, 0.98) 0%,
            rgba(12, 12, 11, 1) 100%
          );
          box-shadow:
            inset 0 1px 0 rgba(255, 255, 255, 0.04),
            inset 0 -12px 28px rgba(0, 0, 0, 0.55);
        }
        .td-row:hover {
          border-color: rgba(110, 184, 176, 0.2);
          box-shadow:
            inset 2px 0 0 var(--td-brass),
            inset 0 1px 0 rgba(255, 255, 255, 0.05),
            0 0 20px -8px rgba(110, 184, 176, 0.12);
        }
        .td-row-marked {
          box-shadow:
            inset 2px 0 0 var(--td-teal),
            inset 0 0 24px rgba(90, 158, 150, 0.05);
        }
        .td-row-body { flex: 1; min-width: 0; }
        .td-row-actions {
          display: flex;
          flex-shrink: 0;
          align-items: center;
          gap: 0.35rem;
        }
        .td-rank-well {
          flex-shrink: 0;
          width: 2.9rem;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 0.4rem 0.15rem;
          border-radius: 3px;
          background: rgba(0, 0, 0, 0.45);
          border: 1px solid rgba(255, 255, 255, 0.07);
          box-shadow: inset 0 -6px 12px rgba(0, 0, 0, 0.5);
        }
        .td-rank {
          font-size: 1.22rem;
          font-weight: 700;
          line-height: 1;
          color: var(--td-brass);
          text-shadow: 0 0 12px rgba(201, 176, 112, 0.25);
        }
        .td-title-link {
          display: block;
          font-family: var(--d-font-editorial, Georgia, "Times New Roman", serif);
          font-size: 1.14rem;
          font-weight: 620;
          line-height: 1.22;
          color: var(--td-fg);
          text-decoration: none;
        }
        .td-title-link:hover {
          color: #fff;
          text-decoration: underline;
          text-underline-offset: 3px;
        }
        .td-artist {
          margin-top: 0.22rem;
          font-size: 0.96rem;
          line-height: 1.28;
          color: var(--td-muted);
        }
        .td-meta {
          margin-top: 0.3rem;
          font-size: 0.84rem;
          line-height: 1.25;
          color: var(--td-dim);
        }
        .td-meta em { font-style: normal; color: var(--td-olive); }
        .td-play {
          width: 3.35rem;
          height: 3.35rem;
          flex-shrink: 0;
          border-radius: 5px;
          border: 1px solid transparent;
          font-size: 1rem;
          font-weight: 700;
          line-height: 1;
          cursor: pointer;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 0.1rem;
        }
        .td-play-label {
          font-size: 0.52rem;
          font-weight: 600;
          letter-spacing: 0.08em;
          opacity: 0.85;
        }
        .td-play-local {
          border-color: rgba(201, 176, 112, 0.5);
          background: linear-gradient(180deg, rgba(42, 38, 32, 0.95), rgba(14, 14, 13, 1));
          color: var(--td-brass);
          box-shadow:
            0 0 22px rgba(201, 176, 112, 0.22),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }
        .td-play-local:hover {
          border-color: rgba(201, 176, 112, 0.75);
          box-shadow:
            0 0 28px rgba(201, 176, 112, 0.32),
            inset 0 0 16px rgba(201, 176, 112, 0.08);
          color: #f5f0e4;
        }
        .td-play-youtube {
          border-color: rgba(110, 184, 176, 0.45);
          background: linear-gradient(180deg, rgba(28, 36, 34, 0.95), rgba(10, 12, 12, 1));
          color: var(--td-cyan);
          box-shadow: 0 0 18px rgba(110, 184, 176, 0.18);
        }
        .td-play-search {
          border-color: rgba(255, 255, 255, 0.12);
          background: rgba(0, 0, 0, 0.35);
          color: var(--td-muted);
        }
        .td-link-util {
          width: 1.65rem;
          height: 1.65rem;
          flex-shrink: 0;
          border: none;
          background: transparent;
          color: var(--td-dim);
          font-size: 0.72rem;
          line-height: 1;
          cursor: pointer;
          text-decoration: none;
          display: flex;
          align-items: center;
          justify-content: center;
          opacity: 0.55;
        }
        .td-link-util:hover {
          opacity: 0.9;
          color: var(--td-muted);
        }
        .td-link-util-on {
          opacity: 0.85;
          color: var(--td-teal);
        }
        .td-empty {
          padding: 1rem 0.85rem;
          font-size: 0.92rem;
          color: var(--td-muted);
        }
        @media (max-width: 639px) {
          .track-deck-scope { font-size: 16px; }
          .td-play { width: 3.1rem; height: 3.1rem; }
          .td-title-link { font-size: 1.1rem; }
        }
        .track-deck-scope .rv-entity-nav-back,
        .track-deck-scope .rv-entity-nav-link { color: var(--td-muted) !important; }
        .track-deck-scope .rv-entity-nav-back:hover,
        .track-deck-scope .rv-entity-nav-link:hover { color: var(--td-brass) !important; }
      `}</style>

      {toast ? (
        <div
          className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 border px-3 py-1.5 text-[0.82rem]"
          style={{ borderColor: "var(--td-border)", background: "var(--td-graphite)", color: "var(--td-brass)" }}
        >
          {toast}
        </div>
      ) : null}

      {fatalError ? (
        <div className="p-4 text-xs">
          <p style={{ color: "var(--td-brass)" }}>Charts — database unavailable</p>
          <p className="mt-2" style={{ color: "#f08070" }}>
            {error}
          </p>
          <p className="mt-2 text-[10px]" style={{ color: "var(--td-muted)" }}>
            {sqlitePath}
          </p>
          <Link href="/dev-index" className="td-cmd mt-3 inline-block no-underline">
            dev
          </Link>
        </div>
      ) : (
        <>
          <header className="td-timeline shrink-0 px-3 py-2.5">
            <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
              <span className="td-header-title">Charts</span>
              <span className="td-header-sub">Hot 100</span>
            </div>
            <form
              className="td-find mb-2"
              onSubmit={(e) => {
                e.preventDefault();
                void findTrack();
              }}
            >
              <input
                type="search"
                className="td-inp"
                placeholder="Find track…"
                value={trackQuery}
                onChange={(e) => setTrackQuery(e.target.value)}
                aria-label="Find track"
              />
              <button type="submit" className="td-cmd td-cmd-go" disabled={searchingTrack}>
                {searchingTrack ? "…" : "Find"}
              </button>
            </form>
            <div className="td-console">
              <button type="button" className="td-cmd" disabled={loadingIndex} onClick={() => setYear((y) => y - 1)}>
                −
              </button>
              <input
                type="number"
                className="td-inp td-inp-year tabular-nums"
                value={year}
                min={1958}
                max={2030}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) setYear(n);
                }}
                aria-label="Chart year"
              />
              <button type="button" className="td-cmd" disabled={loadingIndex} onClick={() => setYear((y) => y + 1)}>
                +
              </button>
              <span className="text-[0.72rem] uppercase tracking-[0.1em]" style={{ color: "var(--td-dim)" }}>
                Week
              </span>
              <button type="button" className="td-cmd" disabled={!issueDate} onClick={() => void stepWeek("prev")}>
                ◀
              </button>
              <select
                className="td-inp td-inp-week"
                value={issueDate ?? ""}
                disabled={loadingIndex || !index?.weeksForYear.length}
                onChange={(e) => onSelectWeek(e.target.value)}
                aria-label="Chart week"
              >
                {(index?.weeksForYear ?? []).map((d) => (
                  <option key={d} value={d}>
                    {formatWeekShort(d)}
                  </option>
                ))}
              </select>
              <button type="button" className="td-cmd" disabled={!issueDate} onClick={() => void stepWeek("next")}>
                ▶
              </button>
              {loadingWeek ? <span className="td-stats">Loading…</span> : null}
              {playbackStats ? (
                <span className="td-stats tabular-nums">
                  <strong>{playbackStats.total}</strong> on chart · {playbackStats.vdj} library · {playbackStats.yt} stream
                </span>
              ) : null}
              <span className="td-filter-seg">
                {(
                  [
                    ["all", "All"],
                    ["vdj", "VDJ"],
                    ["yt", "YT"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`td-cmd${playbackFilter === key ? " td-cmd-on" : ""}`}
                    onClick={() => setPlaybackFilter(key)}
                    title={key === "all" ? "All playback" : key === "vdj" ? "VDJ only" : "YouTube only"}
                  >
                    {label}
                  </button>
                ))}
              </span>
            </div>
          </header>

          {error && week ? (
            <p className="shrink-0 border-b px-2 py-0.5 text-[10px]" style={{ color: "#f08070", borderColor: "var(--td-border)" }}>
              {error}
            </p>
          ) : null}

          <div className="min-h-0 flex-1 overflow-auto">
            {!week && !loadingWeek && !loadingIndex ? (
              <p className="td-empty">Select a chart week</p>
            ) : null}

            <ul className="td-rail">
              {filteredTracks.map((track) => (
                <TrackRow
                  key={track.entryId}
                  track={track}
                  chartWeek={issueDate}
                  linked={linkedKeys.has(chartTrackLinkKey(track.artist, track.title))}
                  onToast={showToast}
                />
              ))}
            </ul>

            {week && filteredTracks.length === 0 ? (
              <p className="td-empty">No tracks match this filter</p>
            ) : null}
          </div>
        </>
      )}
    </div>
  );
}

function playClass(source: TrackDeckPlaybackSource): string {
  if (source === "local") return "td-play td-play-local";
  if (source === "youtube") return "td-play td-play-youtube";
  return "td-play td-play-search";
}

function playGlyph(source: TrackDeckPlaybackSource): string {
  if (source === "local") return "▶";
  if (source === "youtube") return "▶";
  return "?";
}

function playCaption(source: TrackDeckPlaybackSource): string | null {
  if (source === "local") return "PLAY";
  if (source === "youtube") return "YT";
  return null;
}

function TrackRow({
  track,
  chartWeek,
  linked,
  onToast,
}: {
  track: TrackDeckTrackRow;
  chartWeek: string | null;
  linked: boolean;
  onToast: (msg: string) => void;
}) {
  const workspaceUrl = linkWorkspaceHref(track.artist, track.title, {
    chartWeek: chartWeek ?? undefined,
    chartRank: track.rank,
  });

  const handlePlay = () => {
    if (!track.playableUrl) return;
    window.open(track.playableUrl, "_blank", "noopener,noreferrer");
    if (track.playbackSource === "local") onToast("R2");
    else if (track.playbackSource === "youtube") onToast("YouTube");
    else onToast("Search");
  };

  return (
    <li className={`td-row${linked ? " td-row-marked" : ""}`}>
      <span className="td-rank-well" aria-hidden>
        <span className="td-rank tabular-nums">{track.rank}</span>
      </span>

      <div className="td-row-body">
        <Link
          href={`/tracks/hot100-${track.workId}`}
          className="td-title-link truncate"
          title={track.title}
        >
          {track.title}
        </Link>
        <div className="td-artist truncate" title={track.artist}>
          {track.artist}
        </div>
        <div className="td-meta tabular-nums">
          {track.peakPos != null ? (
            <>
              Peak <em>#{track.peakPos}</em>
            </>
          ) : null}
          {track.weeksOnChart != null ? (
            <span>
              {track.peakPos != null ? " · " : ""}
              {track.weeksOnChart} weeks on chart
            </span>
          ) : null}
        </div>
      </div>

      <div className="td-row-actions">
        <button
          type="button"
          className={playClass(track.playbackSource)}
          title={track.playableUrl ?? "No playback URL"}
          onClick={handlePlay}
          aria-label="Play track"
        >
          <span aria-hidden>{playGlyph(track.playbackSource)}</span>
          {playCaption(track.playbackSource) ? (
            <span className="td-play-label">{playCaption(track.playbackSource)}</span>
          ) : null}
        </button>
        <Link
          href={workspaceUrl}
          className={`td-link-util no-underline${linked ? " td-link-util-on" : ""}`}
          title={linked ? "VDJ linked — open curator" : "Link to VirtualDJ archive"}
          aria-label={linked ? "VDJ linked" : "Link to VDJ"}
        >
          {linked ? "●" : "⛓"}
        </Link>
      </div>
    </li>
  );
}
