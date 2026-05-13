"use client";

import { useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import type { CandidateBreakdown, ReviewBucket, ReviewRow } from "./load-review-data";

type Props = {
  initialRows: ReviewRow[];
};

type StatusFilter = ReviewBucket;

export function ReviewConsoleClient({ initialRows }: Props) {
  const [statusFilters, setStatusFilters] = useState<Set<StatusFilter>>(new Set());
  const [flagLowConf, setFlagLowConf] = useState(false);
  const [flagSoundtrack, setFlagSoundtrack] = useState(false);
  const [flagGreatestHits, setFlagGreatestHits] = useState(false);
  const [flagYearGap, setFlagYearGap] = useState(false);
  const [qArtist, setQArtist] = useState("");
  const [qAlbum, setQAlbum] = useState("");
  const [qYear, setQYear] = useState("");
  const [inspect, setInspect] = useState<ReviewRow | null>(null);
  const [rawJson, setRawJson] = useState<string>("");
  const [rawError, setRawError] = useState<string>("");
  const [rawLoading, setRawLoading] = useState(false);

  const toggleStatus = (s: StatusFilter) => {
    setStatusFilters((prev) => {
      const next = new Set(prev);
      if (next.has(s)) next.delete(s);
      else next.add(s);
      return next;
    });
  };

  const filtered = useMemo(() => {
    const qa = qArtist.trim().toLowerCase();
    const qb = qAlbum.trim().toLowerCase();
    const qy = qYear.trim();
    return initialRows.filter((r) => {
      if (statusFilters.size > 0 && !statusFilters.has(r.reviewBucket)) return false;
      if (flagLowConf && !r.isLowConfidence) return false;
      if (flagSoundtrack && !r.isSoundtrack) return false;
      if (flagGreatestHits && !r.isGreatestHits) return false;
      if (flagYearGap && !r.isLargeYearGap) return false;
      if (qa && !r.billboardArtist.toLowerCase().includes(qa)) return false;
      if (qb && !r.billboardAlbum.toLowerCase().includes(qb)) return false;
      if (qy) {
        const yn = Number(qy);
        if (Number.isFinite(yn) && r.chartYear !== yn) return false;
        if (!Number.isFinite(yn) && !String(r.chartYear).includes(qy)) return false;
      }
      return true;
    });
  }, [
    initialRows,
    statusFilters,
    flagLowConf,
    flagSoundtrack,
    flagGreatestHits,
    flagYearGap,
    qArtist,
    qAlbum,
    qYear,
  ]);

  const firstRawPath = inspect?.rawSnapshotPaths[0] ?? "";

  useEffect(() => {
    if (!inspect || !firstRawPath) {
      setRawJson("");
      setRawError("");
      setRawLoading(false);
      return;
    }
    const ac = new AbortController();
    setRawLoading(true);
    setRawError("");
    setRawJson("");
    fetch(`/api/ops/review/raw?path=${encodeURIComponent(firstRawPath)}`, { signal: ac.signal })
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(`${res.status} ${await res.text()}`);
        }
        return res.text();
      })
      .then((t) => {
        try {
          const o = JSON.parse(t);
          setRawJson(JSON.stringify(o, null, 2));
        } catch {
          setRawJson(t);
        }
      })
      .catch((e) => {
        if (e?.name === "AbortError") return;
        setRawError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => setRawLoading(false));
    return () => ac.abort();
  }, [inspect, firstRawPath]);

  const selectedCandidate = useMemo((): CandidateBreakdown | null => {
    if (!inspect) return null;
    const a = inspect.matchedArtist.trim();
    const b = inspect.matchedAlbum.trim();
    if (!a && !b) return inspect.candidates[0] ?? null;
    return (
      inspect.candidates.find(
        (c) => c.candidateArtist.trim() === a && c.candidateAlbum.trim() === b,
      ) ??
      inspect.candidates[0] ??
      null
    );
  }, [inspect]);

  const stub = useCallback((label: string, row: ReviewRow) => {
    console.info("[ops/review stub]", label, row.id, row.billboardArtist, row.billboardAlbum);
  }, []);

  return (
    <div className="ops-review-scope min-h-[calc(100vh-3.5rem)] text-[var(--ops-fg)]">
      <style>{`
        .ops-review-scope {
          --ops-bg: #141210;
          --ops-surface: #1c1916;
          --ops-elevated: #242019;
          --ops-border: rgba(212, 196, 176, 0.14);
          --ops-muted: #a89f94;
          --ops-fg: #ebe4da;
          --ops-accent: #c4a882;
          --ops-verified: rgba(110, 140, 112, 0.33);
          --ops-verified-border: rgba(110, 140, 112, 0.5);
          --ops-pending: rgba(168, 132, 76, 0.3);
          --ops-pending-border: rgba(176, 140, 82, 0.5);
          --ops-failed: rgba(140, 92, 88, 0.34);
          --ops-failed-border: rgba(160, 96, 92, 0.52);
          --ops-shadow: 0 1px 0 rgba(255,255,255,0.04), 0 10px 28px rgba(0,0,0,0.45);
          font-family: var(--font-geist-sans), system-ui, sans-serif;
          background: var(--ops-bg);
        }
        .ops-btn {
          border: 1px solid var(--ops-border);
          background: var(--ops-elevated);
          color: var(--ops-fg);
          border-radius: 4px;
          padding: 3px 7px;
          font-size: 11px;
          cursor: pointer;
          line-height: 1.2;
        }
        .ops-btn:hover { background: #2a2622; }
        .ops-chip {
          display: flex;
          align-items: center;
          gap: 6px;
          font-size: 12px;
          color: var(--ops-muted);
          cursor: pointer;
          user-select: none;
        }
        .ops-chip input { accent-color: #8f7a5e; }
      `}</style>

      <div className="flex min-h-[calc(100vh-3.5rem)]">
        <aside
          className="w-[260px] shrink-0 border-r p-4"
          style={{ borderColor: "var(--ops-border)", background: "var(--ops-surface)" }}
        >
          <div className="text-[10px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ops-muted)" }}>
            Retroverse Review
          </div>
          <h1 className="mt-1 text-lg font-semibold leading-tight">iTunes enrichment</h1>
          <p className="mt-1 text-xs leading-relaxed" style={{ color: "var(--ops-muted)" }}>
            Local diagnostics — attempts + candidates + raw snapshots.
          </p>

          <div className="mt-5 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
              Status
            </div>
            {(
              [
                ["verified", "Verified"] as const,
                ["pending", "Pending"] as const,
                ["failed", "Failed"] as const,
              ] as const
            ).map(([key, label]) => (
              <label key={key} className="ops-chip">
                <input
                  type="checkbox"
                  checked={statusFilters.has(key)}
                  onChange={() => toggleStatus(key)}
                />
                {label}
              </label>
            ))}
          </div>

          <div className="mt-5 space-y-3">
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
              Flags
            </div>
            <label className="ops-chip">
              <input type="checkbox" checked={flagLowConf} onChange={(e) => setFlagLowConf(e.target.checked)} />
              Low confidence
            </label>
            <label className="ops-chip">
              <input type="checkbox" checked={flagSoundtrack} onChange={(e) => setFlagSoundtrack(e.target.checked)} />
              Soundtrack
            </label>
            <label className="ops-chip">
              <input
                type="checkbox"
                checked={flagGreatestHits}
                onChange={(e) => setFlagGreatestHits(e.target.checked)}
              />
              Greatest hits
            </label>
            <label className="ops-chip">
              <input type="checkbox" checked={flagYearGap} onChange={(e) => setFlagYearGap(e.target.checked)} />
              Large year gap
            </label>
          </div>

          <div className="mt-5 space-y-2">
            <div className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
              Search
            </div>
            <input
              className="w-full rounded border px-2 py-1.5 text-xs outline-none"
              style={{
                borderColor: "var(--ops-border)",
                background: "var(--ops-bg)",
                color: "var(--ops-fg)",
              }}
              placeholder="Artist contains…"
              value={qArtist}
              onChange={(e) => setQArtist(e.target.value)}
            />
            <input
              className="w-full rounded border px-2 py-1.5 text-xs outline-none"
              style={{
                borderColor: "var(--ops-border)",
                background: "var(--ops-bg)",
                color: "var(--ops-fg)",
              }}
              placeholder="Album contains…"
              value={qAlbum}
              onChange={(e) => setQAlbum(e.target.value)}
            />
            <input
              className="w-full rounded border px-2 py-1.5 text-xs outline-none"
              style={{
                borderColor: "var(--ops-border)",
                background: "var(--ops-bg)",
                color: "var(--ops-fg)",
              }}
              placeholder="Chart year…"
              value={qYear}
              onChange={(e) => setQYear(e.target.value)}
            />
          </div>

          <div
            className="mt-6 border-t pt-4 text-[11px]"
            style={{ borderColor: "var(--ops-border)", color: "var(--ops-muted)" }}
          >
            Showing <span className="font-mono" style={{ color: "var(--ops-fg)" }}>{filtered.length}</span> of{" "}
            <span className="font-mono" style={{ color: "var(--ops-fg)" }}>{initialRows.length}</span>
          </div>
        </aside>

        <main className="min-w-0 flex-1 overflow-auto p-4">
          <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
            {filtered.map((row) => (
              <ReviewCard
                key={row.id}
                row={row}
                onInspect={() => setInspect(row)}
                onStub={stub}
              />
            ))}
          </div>
          {filtered.length === 0 && (
            <p className="mt-10 text-center text-sm" style={{ color: "var(--ops-muted)" }}>
              No rows match filters.
            </p>
          )}
        </main>
      </div>

      {inspect && (
        <InspectPanel
          row={inspect}
          selectedCandidate={selectedCandidate}
          rawJson={rawJson}
          rawError={rawError}
          rawLoading={rawLoading}
          onClose={() => setInspect(null)}
        />
      )}
    </div>
  );
}

function bucketStyle(bucket: ReviewBucket): CSSProperties {
  if (bucket === "verified") {
    return {
      background: "var(--ops-verified)",
      borderColor: "var(--ops-verified-border)",
    };
  }
  if (bucket === "pending") {
    return {
      background: "var(--ops-pending)",
      borderColor: "var(--ops-pending-border)",
    };
  }
  return {
    background: "var(--ops-failed)",
    borderColor: "var(--ops-failed-border)",
  };
}

function ReviewCard({
  row,
  onInspect,
  onStub,
}: {
  row: ReviewRow;
  onInspect: () => void;
  onStub: (label: string, row: ReviewRow) => void;
}) {
  const bs = bucketStyle(row.reviewBucket);
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={onInspect}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          onInspect();
        }
      }}
      className="cursor-pointer rounded-md border text-left shadow-sm outline-none transition hover:brightness-[1.03] focus-visible:ring-2 focus-visible:ring-amber-700/50"
      style={{ ...bs, boxShadow: "var(--ops-shadow)" }}
    >
      <div className="flex gap-3 p-2.5">
        <div
          className="h-[88px] w-[88px] shrink-0 overflow-hidden rounded-sm bg-black/25"
          style={{ border: "1px solid var(--ops-border)" }}
        >
          {row.artworkUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={row.artworkUrl} alt="" className="h-full w-full object-cover" loading="lazy" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-[10px]" style={{ color: "var(--ops-muted)" }}>
              No art
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold leading-snug line-clamp-2">{row.billboardAlbum}</div>
          <div className="text-[11px] opacity-85 line-clamp-1">{row.billboardArtist}</div>
          <div className="mt-1 font-mono text-[10px]" style={{ color: "var(--ops-muted)" }}>
            {row.chartYear} · {row.reviewBucket}
          </div>
        </div>
      </div>
      <div className="space-y-1 border-t px-2.5 py-2 text-[10px]" style={{ borderColor: "var(--ops-border)" }}>
        <div className="line-clamp-1">
          <span style={{ color: "var(--ops-muted)" }}>Match </span>
          <span className="font-medium">{row.matchedAlbum || "—"}</span>
        </div>
        <div className="line-clamp-1">
          <span style={{ color: "var(--ops-muted)" }}>Artist </span>
          <span>{row.matchedArtist || "—"}</span>
        </div>
        <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-[10px]" style={{ color: "var(--ops-muted)" }}>
          <span>
            rel <span style={{ color: "var(--ops-fg)" }}>{row.matchedReleaseYear ?? "—"}</span>
          </span>
          <span>
            Δ{" "}
            <span style={{ color: "var(--ops-fg)" }}>
              {row.releaseYearDelta == null ? "—" : row.releaseYearDelta}
            </span>
          </span>
          <span>
            score <span style={{ color: "var(--ops-fg)" }}>{row.finalScore ?? "—"}</span>
          </span>
          <span>
            hist <span style={{ color: "var(--ops-fg)" }}>{row.historicalConfidence ?? "—"}</span>
          </span>
        </div>
        {!row.accepted && row.rejectionReason && (
          <div className="rounded-sm bg-black/20 px-1.5 py-1 text-[10px] leading-snug" style={{ color: "#d8b8b4" }}>
            {row.rejectionReason}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-1 border-t px-2.5 py-2" style={{ borderColor: "var(--ops-border)" }}>
        {(
          [
            ["✓ Correct", "correct"] as const,
            ["~ OK", "ok"] as const,
            ["✗ Wrong", "wrong"] as const,
            ["⟳ Retry", "retry"] as const,
            ["🔍 Inspect", "inspect"] as const,
          ] as const
        ).map(([label, key]) => (
          <button
            key={key}
            type="button"
            className="ops-btn"
            onClick={(e) => {
              e.stopPropagation();
              if (key === "inspect") onInspect();
              else onStub(label, row);
            }}
          >
            {label}
          </button>
        ))}
      </div>
    </article>
  );
}

function InspectPanel({
  row,
  selectedCandidate,
  rawJson,
  rawError,
  rawLoading,
  onClose,
}: {
  row: ReviewRow;
  selectedCandidate: CandidateBreakdown | null;
  rawJson: string;
  rawError: string;
  rawLoading: boolean;
  onClose: () => void;
}) {
  const alts = row.candidates.slice(0, 24);
  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/55 px-4 py-8 backdrop-blur-[2px]"
      onClick={onClose}
      role="presentation"
    >
      <div
        className="ops-review-scope max-h-[90vh] w-full max-w-5xl overflow-hidden rounded-lg border shadow-2xl"
        style={{
          borderColor: "var(--ops-border)",
          background: "var(--ops-surface)",
          boxShadow: "var(--ops-shadow)",
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Inspection"
      >
        <header
          className="flex items-start justify-between gap-3 border-b px-5 py-4"
          style={{ borderColor: "var(--ops-border)" }}
        >
          <div className="min-w-0">
            <div className="text-[10px] font-medium uppercase tracking-[0.14em]" style={{ color: "var(--ops-muted)" }}>
              Inspection
            </div>
            <h2 className="mt-1 text-base font-semibold leading-snug">{row.billboardAlbum}</h2>
            <p className="text-xs opacity-90">{row.billboardArtist}</p>
            <p className="mt-1 font-mono text-[11px]" style={{ color: "var(--ops-muted)" }}>
              Chart {row.chartYear} · {row.reviewBucket} · score {row.finalScore ?? "—"}
            </p>
          </div>
          <button
            type="button"
            className="ops-btn shrink-0 px-3 py-1.5 text-xs"
            onClick={onClose}
          >
            Close
          </button>
        </header>

        <div className="max-h-[calc(90vh-5rem)] overflow-y-auto px-5 py-4">
          <div className="grid gap-6 lg:grid-cols-2">
            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
                Normalized keys
              </h3>
              <dl className="mt-2 space-y-1 font-mono text-[11px]">
                <div>
                  <dt className="inline" style={{ color: "var(--ops-muted)" }}>artist </dt>
                  <dd className="inline">{row.normalizedArtist || "—"}</dd>
                </div>
                <div>
                  <dt className="inline" style={{ color: "var(--ops-muted)" }}>album </dt>
                  <dd className="inline">{row.normalizedAlbum || "—"}</dd>
                </div>
              </dl>

              <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
                Search strategy
              </h3>
              <dl className="mt-2 space-y-1 font-mono text-[10px] leading-relaxed">
                <div>
                  <dt style={{ color: "var(--ops-muted)" }}>Retry strategy</dt>
                  <dd className="break-all">{row.retryStrategy || "—"}</dd>
                </div>
                <div>
                  <dt style={{ color: "var(--ops-muted)" }}>Fetch taxonomy</dt>
                  <dd className="break-all">{row.fetchStrategyTaxonomy || "—"}</dd>
                </div>
                <div>
                  <dt style={{ color: "var(--ops-muted)" }}>Search query</dt>
                  <dd className="break-all">{row.searchQuery || "—"}</dd>
                </div>
                <div>
                  <dt style={{ color: "var(--ops-muted)" }}>API URL</dt>
                  <dd className="break-all opacity-90">{row.apiQueryUrl || "—"}</dd>
                </div>
                <div className="flex flex-wrap gap-3">
                  <span style={{ color: "var(--ops-muted)" }}>candidates</span>
                  <span>{row.candidateCount ?? "—"}</span>
                  <span style={{ color: "var(--ops-muted)" }}>elapsed ms</span>
                  <span>{row.elapsedMs ?? "—"}</span>
                </div>
              </dl>

              <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
                Year &amp; confidence
              </h3>
              <dl className="mt-2 space-y-1 font-mono text-[11px]">
                <div>
                  <span style={{ color: "var(--ops-muted)" }}>Release year (match) </span>
                  {row.matchedReleaseYear ?? "—"}
                </div>
                <div>
                  <span style={{ color: "var(--ops-muted)" }}>Chart year Δ </span>
                  {row.releaseYearDelta == null ? "—" : row.releaseYearDelta}
                </div>
                <div>
                  <span style={{ color: "var(--ops-muted)" }}>Historical confidence (row) </span>
                  {row.historicalConfidence ?? "—"}
                </div>
                <div>
                  <span style={{ color: "var(--ops-muted)" }}>Historical penalty (row) </span>
                  {row.historicalPenaltyReason || "—"}
                </div>
                <div>
                  <span style={{ color: "var(--ops-muted)" }}>Rejected </span>
                  {row.rejectionReason || "—"}
                </div>
              </dl>
            </section>

            <section>
              <h3 className="text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
                Selected candidate breakdown
              </h3>
              {!selectedCandidate && (
                <p className="mt-2 text-xs" style={{ color: "var(--ops-muted)" }}>
                  No candidate row matched the selection.
                </p>
              )}
              {selectedCandidate && (
                <div className="mt-2 overflow-x-auto rounded border text-[10px]" style={{ borderColor: "var(--ops-border)" }}>
                  <table className="w-full border-collapse">
                    <tbody>
                      {(
                        [
                          ["Artist", selectedCandidate.candidateArtist],
                          ["Album", selectedCandidate.candidateAlbum],
                          ["artist_match_score", selectedCandidate.artistMatchScore],
                          ["album_match_score", selectedCandidate.albumMatchScore],
                          ["token_overlap_score", selectedCandidate.tokenOverlapScore],
                          ["year_distance_score", selectedCandidate.yearDistanceScore],
                          ["release_year_distance", selectedCandidate.releaseYearDistance],
                          ["historical_year_distance_score", selectedCandidate.historicalYearDistanceScore],
                          ["historical_confidence", selectedCandidate.historicalConfidence],
                          ["historical_penalty_reason", selectedCandidate.historicalPenaltyReason],
                          ["final_score", selectedCandidate.finalScore],
                          ["accepted_for_ranking", String(selectedCandidate.acceptedForRanking)],
                          ["rejected_reason", selectedCandidate.rejectedReason || "—"],
                        ] as const
                      ).map(([k, v]) => (
                        <tr key={k} className="border-t" style={{ borderColor: "var(--ops-border)" }}>
                          <td className="px-2 py-1 align-top font-mono" style={{ color: "var(--ops-muted)" }}>
                            {k}
                          </td>
                          <td className="px-2 py-1 align-top">{String(v)}</td>
                        </tr>
                      ))}
                      <tr className="border-t" style={{ borderColor: "var(--ops-border)" }}>
                        <td className="px-2 py-1 font-mono" style={{ color: "var(--ops-muted)" }}>
                          penalties
                        </td>
                        <td className="px-2 py-1 font-mono text-[10px] leading-snug">
                          comp {selectedCandidate.compilationPenalty ?? "—"} · rem{" "}
                          {selectedCandidate.remasterPenalty ?? "—"} · trib {selectedCandidate.tributePenalty ?? "—"} ·
                          kara {selectedCandidate.karaokePenalty ?? "—"} · single {selectedCandidate.singlePenalty ?? "—"}{" "}
                          · ep {selectedCandidate.epPenalty ?? "—"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
                Alternate candidates (top {alts.length})
              </h3>
              <div
                className="mt-2 max-h-[240px] overflow-auto rounded border font-mono text-[10px]"
                style={{ borderColor: "var(--ops-border)" }}
              >
                <table className="w-full border-collapse">
                  <thead>
                    <tr className="border-b text-left" style={{ borderColor: "var(--ops-border)" }}>
                      <th className="px-2 py-1" style={{ color: "var(--ops-muted)" }}>score</th>
                      <th className="px-2 py-1" style={{ color: "var(--ops-muted)" }}>artist</th>
                      <th className="px-2 py-1" style={{ color: "var(--ops-muted)" }}>album</th>
                      <th className="px-2 py-1" style={{ color: "var(--ops-muted)" }}>hist</th>
                    </tr>
                  </thead>
                  <tbody>
                    {alts.map((c, i) => {
                      const sel =
                        c.candidateArtist.trim() === row.matchedArtist.trim() &&
                        c.candidateAlbum.trim() === row.matchedAlbum.trim();
                      return (
                        <tr
                          key={`${c.candidateArtist}-${c.candidateAlbum}-${i}`}
                          className="border-t"
                          style={{
                            borderColor: "var(--ops-border)",
                            background: sel ? "rgba(196,168,130,0.12)" : undefined,
                          }}
                        >
                          <td className="px-2 py-1 align-top">{c.finalScore ?? "—"}</td>
                          <td className="px-2 py-1 align-top">{c.candidateArtist}</td>
                          <td className="px-2 py-1 align-top">{c.candidateAlbum}</td>
                          <td className="px-2 py-1 align-top">{c.historicalConfidence ?? "—"}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <h3 className="mt-5 text-[11px] font-semibold uppercase tracking-wide" style={{ color: "var(--ops-accent)" }}>
                Raw provider JSON
              </h3>
              <p className="mt-1 text-[10px]" style={{ color: "var(--ops-muted)" }}>
                {row.rawSnapshotPaths[0] || "—"}
              </p>
              <div
                className="mt-2 max-h-[320px] overflow-auto rounded border bg-black/20 p-3"
                style={{ borderColor: "var(--ops-border)" }}
              >
                {rawLoading && <p className="text-xs" style={{ color: "var(--ops-muted)" }}>Loading…</p>}
                {rawError && !rawLoading && (
                  <p className="text-xs text-red-300/90">{rawError}</p>
                )}
                {!rawLoading && !rawError && (
                  <pre className="whitespace-pre-wrap break-all font-mono text-[10px] leading-relaxed">{rawJson}</pre>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}