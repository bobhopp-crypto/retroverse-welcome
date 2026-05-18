"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useMemo, useState } from "react";

import { RetroverseEntityNav } from "@/app/components/retroverse-entity-nav";
import type { LinkWorkspacePayload, VdjFileRow } from "@/lib/relationship-workspace/load-link-workspace";
import type { PlaybackStatus } from "@/lib/relationship-workspace/playback-check";

type Props = {
  initial: LinkWorkspacePayload | null;
  shellError: string | null;
  hasContext: boolean;
};

type FileFilter = "video" | "all";

function statusLabel(status: PlaybackStatus): string {
  if (status === "playable") return "PLAYABLE";
  if (status === "possible") return "POSSIBLE MATCH";
  return "NOT FOUND";
}

function formatBadge(f: VdjFileRow): string {
  if (f.videoFormat === "mp4") return "MP4";
  if (f.videoFormat === "mov") return "MOV";
  if (f.videoFormat === "m4v") return "M4V";
  if (f.mediaKind === "video") return "VIDEO";
  return "AUDIO";
}

function firstVideoPath(files: VdjFileRow[]): string | null {
  return files.find((f) => f.mediaKind === "video")?.filePath ?? null;
}

function FileRow({
  f,
  selected,
  onSelect,
}: {
  f: VdjFileRow;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      className={`lk-file${selected ? " lk-file-on" : ""}`}
      onClick={onSelect}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="lk-fname">{f.fileName}</span>
        <span className="flex gap-2">
          <span className={`lk-type${f.mediaKind === "video" ? " lk-type-video" : ""}`}>
            {formatBadge(f)}
          </span>
          <span className="lk-score">{f.score}</span>
        </span>
      </div>
      <div className="lk-fpath">{f.filePath}</div>
    </button>
  );
}

export default function RelationshipWorkspaceClient({
  initial,
  shellError,
  hasContext,
}: Props) {
  const router = useRouter();
  const [data] = useState<LinkWorkspacePayload | null>(initial);
  const [fileFilter, setFileFilter] = useState<FileFilter>("video");
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initial ? firstVideoPath(initial.files) ?? initial.files[0]?.filePath ?? null : null,
  );
  const [busy, setBusy] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const videoFiles = useMemo(
    () => data?.files.filter((f) => f.mediaKind === "video") ?? [],
    [data],
  );
  const audioFiles = useMemo(
    () => data?.files.filter((f) => f.mediaKind === "audio") ?? [],
    [data],
  );

  const showAudio = fileFilter === "all";

  const selected = useMemo(() => {
    if (!data) return null;
    const hit = data.files.find((f) => f.filePath === selectedPath);
    if (hit) return hit;
    if (fileFilter === "video") {
      return videoFiles[0] ?? null;
    }
    return data.files[0] ?? null;
  }, [data, selectedPath, fileFilter, videoFiles]);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  }, []);

  const accept = useCallback(async () => {
    if (!data || !selected || selected.mediaKind !== "video") return;
    setBusy(true);
    try {
      const res = await fetch("/api/track-links/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chartArtist: data.source.artist,
          chartTitle: data.source.title,
          chartWeek: data.source.chartWeek,
          chartRank: data.source.chartRank,
          vdjPath: selected.filePath,
          r2Url: selected.playback.playUrl,
        }),
      });
      const body = (await res.json()) as { ok?: boolean; error?: string };
      if (!res.ok) throw new Error(body.error ?? `${res.status}`);
      showToast("Saved");
      const back = data.source.chartWeek
        ? `/track-deck?date=${encodeURIComponent(data.source.chartWeek)}`
        : "/track-deck";
      window.setTimeout(() => router.push(back), 500);
    } catch (e) {
      showToast(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, [data, selected, router, showToast]);

  const playback = selected?.playback;
  const canPlay = Boolean(playback?.playUrl);
  const canAccept = selected?.mediaKind === "video";

  return (
    <div className="lk-scope min-h-[calc(100vh-3.5rem)] flex flex-col">
      <style>{`
        .lk-scope {
          --lk-bg: #15100a;
          --lk-surface: #1f1610;
          --lk-border: rgba(212, 162, 62, 0.2);
          --lk-muted: #a89068;
          --lk-fg: #f1e3c3;
          --lk-accent: #d4a23e;
          --lk-amber: #e8c878;
          --lk-brass: #b99763;
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          background: radial-gradient(ellipse 100% 50% at 50% 0%, rgba(212, 162, 62, 0.06), transparent 55%), var(--lk-bg);
          color: var(--lk-fg);
        }
        .lk-header {
          border-bottom: 1px solid var(--lk-border);
          background: #2a1d12;
          padding: 8px 12px;
          font-size: 11px;
        }
        .lk-cols {
          display: grid;
          grid-template-columns: minmax(12rem, 1fr) minmax(18rem, 2fr) minmax(12rem, 1fr);
          gap: 8px;
          padding: 8px;
          flex: 1;
          min-height: 0;
        }
        @media (max-width: 900px) { .lk-cols { grid-template-columns: 1fr; } }
        .lk-panel {
          border: 1px solid var(--lk-border);
          background: var(--lk-surface);
          display: flex;
          flex-direction: column;
          min-height: 14rem;
          max-height: calc(100vh - 7rem);
        }
        .lk-panel-head {
          padding: 8px 10px;
          border-bottom: 1px solid var(--lk-border);
          font-size: 10px;
          letter-spacing: 0.12em;
          text-transform: uppercase;
          color: var(--lk-muted);
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
        }
        .lk-filter {
          display: flex;
          gap: 4px;
        }
        .lk-filter button {
          font: inherit;
          font-size: 9px;
          letter-spacing: 0.06em;
          padding: 2px 6px;
          border: 1px solid var(--lk-border);
          background: transparent;
          color: var(--lk-muted);
          cursor: pointer;
        }
        .lk-filter button.lk-filter-on {
          border-color: var(--lk-brass);
          color: var(--lk-accent);
        }
        .lk-section {
          font-size: 9px;
          letter-spacing: 0.1em;
          color: var(--lk-muted);
          margin: 8px 0 4px;
        }
        .lk-panel-body { padding: 10px; overflow: auto; flex: 1; }
        .lk-title { font-size: 16px; font-weight: 600; color: var(--lk-fg); line-height: 1.25; }
        .lk-artist { font-size: 13px; color: var(--lk-muted); margin-top: 4px; }
        .lk-meta { font-size: 11px; color: var(--lk-muted); margin-top: 10px; }
        .lk-file {
          width: 100%;
          text-align: left;
          border: 1px solid var(--lk-border);
          background: transparent;
          color: inherit;
          padding: 8px;
          margin-bottom: 6px;
          cursor: pointer;
          font: inherit;
        }
        .lk-file:hover { background: #241a10; }
        .lk-file-on { border-color: var(--lk-brass); background: rgba(212, 162, 62, 0.08); }
        .lk-fname { font-size: 12px; color: var(--lk-fg); }
        .lk-fpath { font-size: 10px; color: var(--lk-muted); margin-top: 3px; word-break: break-all; }
        .lk-score { font-size: 11px; color: var(--lk-brass); }
        .lk-type {
          font-size: 9px;
          border: 1px solid var(--lk-border);
          padding: 1px 4px;
          color: var(--lk-muted);
        }
        .lk-type-video { border-color: rgba(212, 162, 62, 0.4); color: var(--lk-accent); }
        .lk-status {
          font-size: 13px;
          font-weight: 700;
          letter-spacing: 0.08em;
          margin-top: 12px;
        }
        .lk-status-playable { color: var(--lk-amber); text-shadow: 0 0 14px rgba(212, 162, 62, 0.35); }
        .lk-status-possible { color: var(--lk-brass); }
        .lk-status-not_found { color: var(--lk-muted); opacity: 0.85; }
        .lk-play {
          margin-top: 16px;
          width: 100%;
          padding: 14px;
          font-size: 14px;
          font-weight: 700;
          border: 1px solid rgba(212, 162, 62, 0.55);
          border-radius: 4px;
          background: rgba(212, 162, 62, 0.22);
          color: #f1e3c3;
          cursor: pointer;
          box-shadow: 0 0 20px rgba(212, 162, 62, 0.28);
        }
        .lk-play:disabled { opacity: 0.35; cursor: not-allowed; box-shadow: none; }
        .lk-accept {
          margin-top: 10px;
          width: 100%;
          padding: 10px;
          font-size: 12px;
          border: 1px solid var(--lk-border);
          background: #2a1d12;
          color: var(--lk-fg);
          cursor: pointer;
        }
        .lk-accept:hover:not(:disabled) { border-color: var(--lk-brass); color: var(--lk-brass); }
        .lk-accept:disabled { opacity: 0.4; }
        .lk-hint { font-size: 10px; color: var(--lk-muted); margin-top: 8px; }
        .lk-link { color: var(--lk-accent); text-decoration: none; }
        .lk-empty { color: var(--lk-muted); font-size: 12px; padding: 12px 0; }
        .lk-toast {
          position: fixed;
          bottom: 12px;
          left: 50%;
          transform: translateX(-50%);
          background: #2a1d12;
          border: 1px solid var(--lk-border);
          padding: 6px 12px;
          font-size: 11px;
          color: var(--lk-brass);
        }
        .lk-scope .rv-entity-nav-back,
        .lk-scope .rv-entity-nav-link { color: var(--lk-muted) !important; }
        .lk-scope .rv-entity-nav-back:hover,
        .lk-scope .rv-entity-nav-link:hover { color: var(--lk-accent) !important; }
      `}</style>

      {toast ? <div className="lk-toast">{toast}</div> : null}

      <header className="lk-header flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <span style={{ color: "var(--lk-accent)", fontSize: "11px", letterSpacing: "0.12em" }}>
          Match your video
        </span>
        <RetroverseEntityNav
          back={{ href: "/", label: "Home" }}
          items={[
            { href: "/track-deck", label: "Charts" },
            { href: "/album-retroscope", label: "Retroscope" },
          ]}
          className="!text-[9px]"
        />
      </header>

      {!hasContext ? (
        <p className="p-4 lk-empty">Pick a chart track in Track Deck and tap +</p>
      ) : shellError && !data ? (
        <p className="p-4" style={{ color: "#f08070" }}>
          {shellError}
        </p>
      ) : data ? (
        <div className="lk-cols">
          <section className="lk-panel">
            <div className="lk-panel-head">Chart track</div>
            <div className="lk-panel-body">
              <div className="lk-title">{data.source.title}</div>
              <div className="lk-artist">{data.source.artist}</div>
              {data.source.chartWeek ? (
                <div className="lk-meta">Week {data.source.chartWeek}</div>
              ) : null}
              {data.source.chartRank != null ? (
                <div className="lk-meta">Rank #{data.source.chartRank}</div>
              ) : null}
            </div>
          </section>

          <section className="lk-panel">
            <div className="lk-panel-head">
              <span>My videos</span>
              <div className="lk-filter">
                <button
                  type="button"
                  className={fileFilter === "video" ? "lk-filter-on" : ""}
                  onClick={() => {
                    setFileFilter("video");
                    const vp = firstVideoPath(data.files);
                    if (vp) setSelectedPath(vp);
                  }}
                >
                  video
                </button>
                <button
                  type="button"
                  className={fileFilter === "all" ? "lk-filter-on" : ""}
                  onClick={() => setFileFilter("all")}
                >
                  all
                </button>
              </div>
            </div>
            <div className="lk-panel-body">
              {videoFiles.length === 0 ? (
                <p className="lk-empty">No DJ video files matched</p>
              ) : (
                <>
                  <div className="lk-section">VIDEO</div>
                  {videoFiles.map((f) => (
                    <FileRow
                      key={f.filePath}
                      f={f}
                      selected={selected?.filePath === f.filePath}
                      onSelect={() => setSelectedPath(f.filePath)}
                    />
                  ))}
                </>
              )}
              {showAudio && audioFiles.length > 0 ? (
                <>
                  <div className="lk-section">AUDIO</div>
                  {audioFiles.map((f) => (
                    <FileRow
                      key={f.filePath}
                      f={f}
                      selected={selected?.filePath === f.filePath}
                      onSelect={() => setSelectedPath(f.filePath)}
                    />
                  ))}
                </>
              ) : null}
            </div>
          </section>

          <section className="lk-panel">
            <div className="lk-panel-head">Playback</div>
            <div className="lk-panel-body">
              {!selected ? (
                <p className="lk-empty">Select a video file</p>
              ) : (
                <>
                  <div
                    className={`lk-status lk-status-${playback?.status ?? "not_found"}`}
                  >
                    {statusLabel(playback?.status ?? "not_found")}
                  </div>
                  <button
                    type="button"
                    className="lk-play"
                    disabled={!canPlay}
                    onClick={() => {
                      if (playback?.playUrl) {
                        window.open(playback.playUrl, "_blank", "noopener,noreferrer");
                      }
                    }}
                  >
                    PLAY
                  </button>
                  <button
                    type="button"
                    className="lk-accept"
                    disabled={busy || !canAccept}
                    onClick={() => void accept()}
                  >
                    ACCEPT LINK
                  </button>
                  {!canAccept ? (
                    <p className="lk-hint">Select a video file (MP4/MOV) to link.</p>
                  ) : playback?.status === "possible" && !canPlay ? (
                    <p className="lk-hint">Stream may need a sync — you can still link this video.</p>
                  ) : null}
                </>
              )}
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
