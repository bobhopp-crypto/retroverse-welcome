"use client";

import Link from "next/link";
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
};

export default function TrackDeckClient({
  sqlitePath,
  initialDate,
  initialYear,
  initialIndex,
  initialWeek,
  linkedKeys: initialLinkedKeys,
  dbError: initialDbError,
}: Props) {
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

  return (
    <div className="track-deck-scope flex h-[calc(100vh-3.5rem)] flex-col text-[var(--td-fg)]">
      <style>{`
        .track-deck-scope {
          --td-bg: #15100a;
          --td-surface: #1f1610;
          --td-elevated: #2a1d12;
          --td-border: rgba(212, 162, 62, 0.2);
          --td-muted: #a89068;
          --td-fg: #f1e3c3;
          --td-accent: #d4a23e;
          --td-amber: #e8c878;
          --td-brass: #b99763;
          --td-dim: #6e5238;
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          background: radial-gradient(ellipse 120% 60% at 50% 0%, rgba(212, 162, 62, 0.08), transparent 50%),
            var(--td-bg);
        }
        .td-cmd {
          border: 1px solid var(--td-border);
          background: var(--td-elevated);
          color: var(--td-fg);
          border-radius: 2px;
          padding: 2px 6px;
          font-size: 10px;
          line-height: 1.25;
          cursor: pointer;
        }
        .td-cmd:hover:not(:disabled) { border-color: rgba(212, 162, 62, 0.45); color: var(--td-accent); }
        .td-cmd:disabled { opacity: 0.35; cursor: not-allowed; }
        .td-cmd-on { border-color: rgba(212, 162, 62, 0.55); color: var(--td-accent); }
        .td-inp {
          border: 1px solid var(--td-border);
          background: var(--td-bg);
          color: var(--td-fg);
          border-radius: 2px;
          padding: 2px 4px;
          font-size: 10px;
          line-height: 1.25;
        }
        .td-row {
          border-bottom: 1px solid var(--td-border);
          background: var(--td-surface);
          min-height: 2.65rem;
        }
        .td-row:hover { background: #241a10; }
        .td-row-marked { box-shadow: inset 2px 0 0 var(--td-brass); }
        .td-row-hold { background: #2a1d12; }
        .td-play {
          width: 26px;
          height: 26px;
          flex-shrink: 0;
          border-radius: 2px;
          border: 1px solid transparent;
          font-size: 10px;
          font-weight: 600;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
        }
        .td-play-local {
          border-color: rgba(212, 162, 62, 0.75);
          background: rgba(212, 162, 62, 0.18);
          color: #f1e3c3;
          box-shadow:
            0 0 12px rgba(212, 162, 62, 0.32),
            inset 0 0 6px rgba(212, 162, 62, 0.12);
        }
        .td-play-local:hover {
          box-shadow:
            0 0 16px rgba(212, 162, 62, 0.42),
            inset 0 0 8px rgba(212, 162, 62, 0.16);
        }
        .td-play-youtube {
          border-color: rgba(184, 151, 99, 0.65);
          background: rgba(184, 151, 99, 0.14);
          color: #e8d4a8;
          box-shadow: 0 0 10px rgba(184, 151, 99, 0.28);
        }
        .td-play-youtube:hover {
          box-shadow: 0 0 14px rgba(184, 151, 99, 0.38);
        }
        .td-play-search {
          border-color: var(--td-dim);
          background: rgba(110, 82, 56, 0.12);
          color: var(--td-muted);
        }
        .td-play-search:hover {
          border-color: var(--td-muted);
          color: var(--td-fg);
          box-shadow: 0 0 6px rgba(168, 144, 104, 0.18);
        }
        .td-cur {
          border: 1px solid var(--td-border);
          background: transparent;
          color: var(--td-muted);
          border-radius: 2px;
          width: 22px;
          height: 22px;
          flex-shrink: 0;
          font-size: 9px;
          line-height: 1;
          cursor: pointer;
          display: flex;
          align-items: center;
          justify-content: center;
          text-decoration: none;
        }
        .td-cur:hover {
          border-color: rgba(212, 162, 62, 0.45);
          color: var(--td-accent);
        }
        .td-acq {
          border: 1px solid var(--td-border);
          background: transparent;
          color: var(--td-muted);
          border-radius: 2px;
          padding: 2px 6px;
          min-width: 22px;
          font-size: 10px;
          line-height: 1.2;
          cursor: pointer;
        }
        .td-acq-on { border-color: var(--td-brass); color: var(--td-brass); box-shadow: 0 0 8px rgba(185, 151, 99, 0.25); }
        .track-deck-scope .rv-entity-nav-back,
        .track-deck-scope .rv-entity-nav-link { color: var(--td-muted) !important; }
        .track-deck-scope .rv-entity-nav-back:hover,
        .track-deck-scope .rv-entity-nav-link:hover { color: var(--td-accent) !important; }
      `}</style>

      {toast ? (
        <div
          className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 border px-2 py-1 text-[10px]"
          style={{ borderColor: "var(--td-border)", background: "var(--td-elevated)", color: "var(--td-accent)" }}
        >
          {toast}
        </div>
      ) : null}

      {fatalError ? (
        <div className="p-4 text-xs">
          <p style={{ color: "var(--td-accent)" }}>Track deck — DB unavailable</p>
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
          <header
            className="shrink-0 border-b px-2 py-1"
            style={{ borderColor: "var(--td-border)", background: "var(--td-elevated)" }}
          >
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="text-[9px] font-semibold uppercase tracking-[0.18em]" style={{ color: "var(--td-accent)" }}>
                Track deck
              </span>
              <span className="text-[9px]" style={{ color: "var(--td-muted)" }}>
                HOT 100
              </span>
              <span className="text-[var(--td-border)]">|</span>

              <button type="button" className="td-cmd" disabled={loadingIndex} onClick={() => setYear((y) => y - 1)}>
                Y−
              </button>
              <input
                type="number"
                className="td-inp w-[3.2rem] text-center tabular-nums"
                value={year}
                min={1958}
                max={2030}
                onChange={(e) => {
                  const n = Number.parseInt(e.target.value, 10);
                  if (Number.isFinite(n)) setYear(n);
                }}
              />
              <button type="button" className="td-cmd" disabled={loadingIndex} onClick={() => setYear((y) => y + 1)}>
                Y+
              </button>

              <button type="button" className="td-cmd" disabled={!issueDate} onClick={() => void stepWeek("prev")}>
                ◀W
              </button>
              <select
                className="td-inp max-w-[7.5rem]"
                value={issueDate ?? ""}
                disabled={loadingIndex || !index?.weeksForYear.length}
                onChange={(e) => onSelectWeek(e.target.value)}
              >
                {(index?.weeksForYear ?? []).map((d) => (
                  <option key={d} value={d}>
                    {formatWeekShort(d)}
                  </option>
                ))}
              </select>
              <button type="button" className="td-cmd" disabled={!issueDate} onClick={() => void stepWeek("next")}>
                W▶
              </button>

              {issueDate ? (
                <span className="text-[10px] tabular-nums" style={{ color: "var(--td-accent)" }}>
                  {formatWeekShort(issueDate)}
                  {loadingWeek ? (
                    <span className="ml-1" style={{ color: "var(--td-muted)" }}>
                      …
                    </span>
                  ) : null}
                </span>
              ) : null}

              {playbackStats ? (
                <span className="text-[9px] tabular-nums" style={{ color: "var(--td-muted)" }}>
                  <span style={{ color: "var(--td-accent)" }}>{playbackStats.vdj}</span> vdj ·
                  <span style={{ color: "var(--td-amber)" }}> {playbackStats.yt}</span> yt ·
                  {playbackStats.total} trk
                </span>
              ) : null}

              <span className="ml-auto flex flex-wrap gap-0.5">
                {(
                  [
                    ["all", "ALL"],
                    ["vdj", "VDJ"],
                    ["yt", "YT"],
                  ] as const
                ).map(([key, label]) => (
                  <button
                    key={key}
                    type="button"
                    className={`td-cmd${playbackFilter === key ? " td-cmd-on" : ""}`}
                    onClick={() => setPlaybackFilter(key)}
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
              <p className="p-2 text-[10px]" style={{ color: "var(--td-muted)" }}>
                Select week
              </p>
            ) : null}

            <ul className="divide-y" style={{ borderColor: "var(--td-border)" }}>
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
              <p className="p-2 text-[10px]" style={{ color: "var(--td-muted)" }}>
                No matches
              </p>
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

function playLabel(source: TrackDeckPlaybackSource): string {
  if (source === "local") return "▶";
  if (source === "youtube") return "YT";
  return "?";
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
    <li
      className={`td-row flex items-center gap-2 px-2 py-1.5${linked ? " td-row-marked" : ""}`}
      title={linked ? "Linked · open workspace to change" : "Link chart track to VDJ file"}
    >
      <span
        className="w-[2.25rem] shrink-0 text-right text-[11px] font-bold tabular-nums leading-none"
        style={{ color: "var(--td-accent)" }}
      >
        {track.rank}
      </span>

      <button
        type="button"
        className={playClass(track.playbackSource)}
        title={track.playableUrl ?? "No playback URL"}
        onClick={handlePlay}
        aria-label="Play"
      >
        {playLabel(track.playbackSource)}
      </button>

      <div className="min-w-0 flex-1 leading-snug">
        <div className="truncate text-[13px] font-semibold leading-tight" title={track.title}>
          {track.title}
        </div>
        <div className="mt-0.5 truncate text-[11px] leading-tight" style={{ color: "var(--td-muted)" }} title={track.artist}>
          {track.artist}
        </div>
        <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0 text-[10px] tabular-nums" style={{ color: "var(--td-dim)" }}>
          {track.peakPos != null ? <span>pk{track.peakPos}</span> : null}
          {track.weeksOnChart != null ? <span>{track.weeksOnChart}w</span> : null}
          {track.lastWeek != null ? <span>LW{track.lastWeek}</span> : null}
        </div>
      </div>

      <Link
        href={workspaceUrl}
        className={`td-acq shrink-0 no-underline${linked ? " td-acq-on" : ""}`}
        title={linked ? "Linked — open link workspace" : "Link to VDJ + R2"}
      >
        {linked ? "✓" : "+"}
      </Link>
    </li>
  );
}
