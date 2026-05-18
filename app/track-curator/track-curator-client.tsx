"use client";

import Link from "next/link";
import { useCallback, useState } from "react";

import type { ChartTrackContext } from "@/lib/track-curator/load-track";
import type { VdjFileSuggestion } from "@/lib/track-curator/vdj-match";

type Props = {
  track: ChartTrackContext | null;
  suggestions: VdjFileSuggestion[];
  error: string | null;
  initialRvtr: string | null;
};

export default function TrackCuratorClient({ track, suggestions, error, initialRvtr }: Props) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    suggestions.find((s) => s.tier === "strong")?.filePath ?? suggestions[0]?.filePath ?? null,
  );
  const [toast, setToast] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    window.setTimeout(() => setToast(null), 2000);
  }, []);

  const runAction = useCallback(
    async (action: string, filePath?: string) => {
      if (!track) return;
      setBusy(true);
      try {
        const res = await fetch("/api/track-curator/action", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            retroverseTrackId: track.retroverseTrackId ?? initialRvtr,
            artist: track.artist,
            title: track.title,
            filePath: filePath ?? selectedPath ?? undefined,
          }),
        });
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok) throw new Error(body.error ?? `${res.status}`);
        showToast(action.toUpperCase());
      } catch (e) {
        showToast(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
    },
    [track, initialRvtr, selectedPath, showToast],
  );

  const rvtrLabel = track?.retroverseTrackId ?? initialRvtr ?? "—";

  return (
    <div className="track-curator-scope min-h-[calc(100vh-3.5rem)] p-3 text-[var(--tc-fg)]">
      <style>{`
        .track-curator-scope {
          --tc-bg: #15100a;
          --tc-surface: #1f1610;
          --tc-border: rgba(212, 162, 62, 0.2);
          --tc-muted: #a89068;
          --tc-fg: #f1e3c3;
          --tc-accent: #d4a23e;
          --tc-amber: #e8c878;
          --tc-brass: #b99763;
          font-family: var(--font-geist-mono), ui-monospace, monospace;
          background: radial-gradient(ellipse 100% 50% at 50% 0%, rgba(212, 162, 62, 0.06), transparent 55%), var(--tc-bg);
        }
        .tc-panel {
          border: 1px solid var(--tc-border);
          background: var(--tc-surface);
          max-width: 42rem;
        }
        .tc-btn {
          border: 1px solid var(--tc-border);
          background: #2a1d12;
          color: var(--tc-fg);
          padding: 4px 10px;
          font-size: 10px;
          cursor: pointer;
        }
        .tc-btn:hover:not(:disabled) { border-color: rgba(212, 162, 62, 0.45); color: var(--tc-accent); }
        .tc-btn:disabled { opacity: 0.4; cursor: not-allowed; }
        .tc-btn-primary { border-color: rgba(212, 162, 62, 0.55); color: var(--tc-accent); }
        .tc-sug {
          border: 1px solid var(--tc-border);
          padding: 4px 6px;
          font-size: 10px;
          cursor: pointer;
          text-align: left;
        }
        .tc-sug-on { border-color: var(--tc-brass); background: rgba(212, 162, 62, 0.08); }
        .tc-tier-strong { color: var(--tc-accent); }
        .tc-tier-weak { color: var(--tc-brass); }
        .track-curator-scope .rv-entity-nav-back,
        .track-curator-scope .rv-entity-nav-link { color: var(--tc-muted) !important; }
        .track-curator-scope .rv-entity-nav-back:hover,
        .track-curator-scope .rv-entity-nav-link:hover { color: var(--tc-accent) !important; }
      `}</style>

      {toast ? (
        <div
          className="fixed bottom-3 left-1/2 z-50 -translate-x-1/2 border px-2 py-1 text-[10px]"
          style={{ borderColor: "var(--tc-border)", background: "#2a1d12", color: "var(--tc-brass)" }}
        >
          {toast}
        </div>
      ) : null}

      <div className="mb-2 flex items-center gap-2 text-[10px]" style={{ color: "var(--tc-muted)" }}>
        <Link href="/track-deck" className="hover:underline" style={{ color: "var(--tc-accent)" }}>
          ← track deck
        </Link>
        <span>|</span>
        <span>chart track curator</span>
      </div>

      {error || !track ? (
        <p className="text-xs" style={{ color: "#f08070" }}>
          {error ?? "No track"}
        </p>
      ) : (
        <div className="tc-panel p-3">
          <div className="text-[9px] uppercase tracking-[0.16em]" style={{ color: "var(--tc-muted)" }}>
            Chart track
          </div>
          <h1 className="mt-1 text-sm font-semibold leading-tight" style={{ color: "var(--tc-accent)" }}>
            {track.title}
          </h1>
          <p className="text-[11px]" style={{ color: "var(--tc-muted)" }}>
            {track.artist}
          </p>
          <p className="mt-1 font-mono text-[10px]" style={{ color: "var(--tc-accent)" }}>
            {rvtrLabel}
          </p>

          <div className="mt-4 text-[9px] uppercase tracking-wide" style={{ color: "var(--tc-muted)" }}>
            Suggested matches
          </div>
          <ul className="mt-1 space-y-1">
            {suggestions.length === 0 ? (
              <li className="text-[10px]" style={{ color: "var(--tc-muted)" }}>
                No local VDJ files matched (check VDJ_MEDIA_ROOT).
              </li>
            ) : (
              suggestions.map((s) => (
                <li key={s.id}>
                  <button
                    type="button"
                    className={`tc-sug block w-full${selectedPath === s.filePath ? " tc-sug-on" : ""}`}
                    onClick={() => setSelectedPath(s.filePath)}
                  >
                    <span className={s.tier === "strong" ? "tc-tier-strong" : "tc-tier-weak"}>
                      {s.tier === "strong" ? "✓" : "?"}
                    </span>{" "}
                    <span>{s.fileName}</span>
                    {s.flags.length > 0 ? (
                      <span className="ml-1 opacity-70">[{s.flags.join(",")}]</span>
                    ) : null}
                  </button>
                </li>
              ))
            )}
          </ul>

          <div className="mt-4 flex flex-wrap gap-1">
            <button
              type="button"
              className="tc-btn tc-btn-primary"
              disabled={busy || !selectedPath}
              onClick={() => void runAction("accept", selectedPath ?? undefined)}
            >
              Accept
            </button>
            <button type="button" className="tc-btn" disabled={busy} onClick={() => void runAction("reject")}>
              Reject
            </button>
            <button
              type="button"
              className="tc-btn"
              disabled={busy || !selectedPath}
              onClick={() => void runAction("mark_live", selectedPath ?? undefined)}
            >
              Mark Live
            </button>
            <button
              type="button"
              className="tc-btn"
              disabled={busy || !selectedPath}
              onClick={() => void runAction("mark_alt", selectedPath ?? undefined)}
            >
              Mark Alt Version
            </button>
            <button type="button" className="tc-btn" disabled={busy} onClick={() => void runAction("split")}>
              Split
            </button>
            <button type="button" className="tc-btn" disabled={busy} onClick={() => void runAction("merge")}>
              Merge
            </button>
          </div>
          <p className="mt-2 text-[9px]" style={{ color: "var(--tc-muted)" }}>
            Decisions append to data/track-curator-decisions.json (ops log). Accept does not yet write RVSM/RVMA.
          </p>
        </div>
      )}
    </div>
  );
}
