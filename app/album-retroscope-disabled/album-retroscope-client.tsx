"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RetroscopeCellDTO } from "@/lib/album-retroscope-data";
import {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  retroscopeCellKey,
} from "@/lib/album-retroscope-data";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function parseInitialKey(key: string): { y: number; r: number } {
  const [a, b] = key.split(":");
  const y = Math.round(Number(a));
  const r = Math.round(Number(b));
  if (!Number.isFinite(y) || !Number.isFinite(r)) {
    return { y: RETROSCOPE_WORLD_YEAR_MIN, r: 1 };
  }
  return {
    y: clamp(y, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX),
    r: clamp(r, 1, RETROSCOPE_RANK_MAX),
  };
}

function HeroCover({ cell }: { cell: RetroscopeCellDTO | null }) {
  const [broken, setBroken] = useState(false);
  const url = cell && !broken ? canonicalCoverPathToUrl(cell.canonicalCoverPath) : null;
  if (!cell) {
    return <div className="arv-hero-void">No anchor · move or scan</div>;
  }
  if (!url) {
    return <div className="arv-hero-void">Cover unresolved</div>;
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- canonical R2 / http URLs; onError fallback
    <img
      src={url}
      alt=""
      className="arv-hero-img"
      draggable={false}
      decoding="async"
      onError={() => setBroken(true)}
    />
  );
}

export default function AlbumRetroscopeClient({
  cells,
  initialActiveKey,
}: {
  cells: RetroscopeCellDTO[];
  initialActiveKey: string;
}) {
  const byKey = useMemo(() => {
    const m = new Map<string, RetroscopeCellDTO>();
    for (const c of cells) {
      if (!c || typeof c.chartYear !== "number" || typeof c.retroverseRank !== "number") continue;
      m.set(retroscopeCellKey(c.chartYear, c.retroverseRank), c);
    }
    return m;
  }, [cells]);

  const safeInit = useMemo(() => {
    const parsed = parseInitialKey(initialActiveKey);
    const k = retroscopeCellKey(parsed.y, parsed.r);
    if (cells.some((c) => retroscopeCellKey(c.chartYear, c.retroverseRank) === k)) return parsed;
    const c0 = cells[0];
    if (c0 && Number.isFinite(c0.chartYear) && Number.isFinite(c0.retroverseRank)) {
      return { y: c0.chartYear, r: c0.retroverseRank };
    }
    return parsed;
  }, [cells, initialActiveKey]);

  const [activeYear, setActiveYear] = useState(safeInit.y);
  const [activeRank, setActiveRank] = useState(safeInit.r);
  const [explored, setExplored] = useState<Set<string>>(() => new Set());
  const [viewYear0, setViewYear0] = useState(() =>
    clamp(safeInit.y, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1),
  );
  const [viewRank0, setViewRank0] = useState(() =>
    clamp(safeInit.r, 1, RETROSCOPE_RANK_MAX - RETROSCOPE_GRID_ROWS + 1),
  );

  const posRef = useRef({ y: safeInit.y, r: safeInit.r });
  useEffect(() => {
    posRef.current = { y: activeYear, r: activeRank };
  }, [activeYear, activeRank]);

  const activeKey = retroscopeCellKey(activeYear, activeRank);
  const activeCell = byKey.get(activeKey) ?? null;

  /** Shift viewport only when `(ny, nr)` would sit outside current visible bounds (no per-move recenter). */
  const bumpViewportToInclude = useCallback((ny: number, nr: number) => {
    const ynn = Number.isFinite(ny) ? Math.round(ny) : RETROSCOPE_WORLD_YEAR_MIN;
    const rnn = Number.isFinite(nr) ? Math.round(nr) : 1;

    setViewYear0((prev) => {
      const v0 = Number.isFinite(prev) ? prev : RETROSCOPE_WORLD_YEAR_MIN;
      const yMax = v0 + RETROSCOPE_GRID_COLS - 1;
      let next = v0;
      if (ynn < v0) next = ynn;
      else if (ynn > yMax) next = ynn - (RETROSCOPE_GRID_COLS - 1);
      return clamp(next, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1);
    });

    setViewRank0((prev) => {
      const r0 = Number.isFinite(prev) ? prev : 1;
      const rMax = r0 + RETROSCOPE_GRID_ROWS - 1;
      let next = r0;
      if (rnn < r0) next = rnn;
      else if (rnn > rMax) next = rnn - (RETROSCOPE_GRID_ROWS - 1);
      return clamp(next, 1, RETROSCOPE_RANK_MAX - RETROSCOPE_GRID_ROWS + 1);
    });
  }, []);

  const moveTo = useCallback((nextYear: number, nextRank: number, markExploredFrom: string | null) => {
    const { y: cy, r: cr } = posRef.current;
    const ny = clamp(nextYear, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX);
    const nr = clamp(nextRank, 1, RETROSCOPE_RANK_MAX);
    const nk = retroscopeCellKey(ny, nr);
    if (nk === retroscopeCellKey(cy, cr)) return;
    setExplored((prev) => {
      const n = new Set(prev);
      if (markExploredFrom) n.add(markExploredFrom);
      return n;
    });
    posRef.current = { y: ny, r: nr };
    setActiveYear(ny);
    setActiveRank(nr);
    bumpViewportToInclude(ny, nr);
  }, [bumpViewportToInclude]);

  const onPad = useCallback(
    (dir: "u" | "d" | "l" | "r") => {
      const { y, r } = posRef.current;
      const from = retroscopeCellKey(y, r);
      if (dir === "l") moveTo(y - 1, r, from);
      if (dir === "r") moveTo(y + 1, r, from);
      if (dir === "u") moveTo(y, r - 1, from);
      if (dir === "d") moveTo(y, r + 1, from);
    },
    [moveTo],
  );

  useEffect(() => {
    const k = retroscopeCellKey(activeYear, activeRank);
    console.info("[album-retroscope:client]", {
      corpusSize: cells.length,
      initialActiveKey,
      selectedCoordinate: k,
      activeLookup: byKey.has(k) ? "hit" : "miss",
      viewport: {
        year0: viewYear0,
        rank0: viewRank0,
        yearEnd: viewYear0 + RETROSCOPE_GRID_COLS - 1,
        rankEnd: viewRank0 + RETROSCOPE_GRID_ROWS - 1,
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot mount debug
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        onPad("l");
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        onPad("r");
      }
      if (e.key === "ArrowUp") {
        e.preventDefault();
        onPad("u");
      }
      if (e.key === "ArrowDown") {
        e.preventDefault();
        onPad("d");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPad]);

  const onCellTap = (y: number, r: number) => {
    const k = retroscopeCellKey(y, r);
    if (k === retroscopeCellKey(posRef.current.y, posRef.current.r)) return;
    moveTo(y, r, retroscopeCellKey(posRef.current.y, posRef.current.r));
  };

  return (
    <div className="arv-root-inner px-2 pb-2 pt-2">
      <Link href="/" className="arv-back">
        ← Portal
      </Link>

      <p className="arv-kicker">Album Retroscope</p>

      <div className="arv-hero mx-auto mt-3">
        <HeroCover key={activeKey} cell={activeCell} />
      </div>

      <div className="arv-title-block">
        {activeCell ? (
          <>
            <p className="arv-eyebrow">
              {activeCell.chartYear} · Year rank #{activeCell.retroverseRank}
              {activeCell.releaseYear != null && activeCell.releaseYear !== activeCell.chartYear
                ? ` · release ${activeCell.releaseYear}`
                : ""}
            </p>
            <p className="arv-title">{activeCell.artist}</p>
            <p className="arv-title mt-1 opacity-90">{activeCell.title}</p>
            <p className="arv-eyebrow mt-2">
              <Link href={`/albums/${activeCell.albumId}`} className="underline-offset-4 hover:underline">
                Open album
              </Link>
            </p>
          </>
        ) : (
          <>
            <p className="arv-eyebrow">
              {activeYear} · Rank #{activeRank}
            </p>
            <p className="arv-title opacity-70">Off corpus · keep moving</p>
          </>
        )}
      </div>

      <div className="arv-strip">
        <div className="arv-readout">
          <div className="arv-readout-label">Year axis</div>
          <div className="arv-readout-value">{activeYear}</div>
          <div className="arv-readout-sub">West · East · calendar</div>
        </div>

        <div className="arv-controls" aria-label="Retroscope pad">
          <span className="arv-pad-spacer" />
          <button type="button" className="arv-pad-btn" aria-label="Up toward number one" onClick={() => onPad("u")}>
            ↑
          </button>
          <span className="arv-pad-spacer" />
          <button type="button" className="arv-pad-btn" aria-label="Previous year" onClick={() => onPad("l")}>
            ←
          </button>
          <span className="arv-pad-spacer" />
          <button type="button" className="arv-pad-btn" aria-label="Next year" onClick={() => onPad("r")}>
            →
          </button>
          <span className="arv-pad-spacer" />
          <button type="button" className="arv-pad-btn" aria-label="Deeper in year ranking" onClick={() => onPad("d")}>
            ↓
          </button>
          <span className="arv-pad-spacer" />
        </div>

        <div className="arv-readout">
          <div className="arv-readout-label">Rank axis</div>
          <div className="arv-readout-value">#{activeRank}</div>
          <div className="arv-readout-sub">North · South · Retroverse order</div>
        </div>
      </div>

      <div className="arv-grid-wrap">
        <p className="arv-readout-label mb-2 text-center">Exploration grid · 7 × 10 viewport</p>
        <div className="arv-grid" role="grid" aria-label="Year and rank viewport">
          {Array.from({ length: RETROSCOPE_GRID_ROWS * RETROSCOPE_GRID_COLS }, (_, i) => {
            const col = i % RETROSCOPE_GRID_COLS;
            const row = Math.floor(i / RETROSCOPE_GRID_COLS);
            const vy0 = Number.isFinite(viewYear0) ? viewYear0 : RETROSCOPE_WORLD_YEAR_MIN;
            const vr0 = Number.isFinite(viewRank0) ? viewRank0 : 1;
            const y = vy0 + col;
            const r = vr0 + row;
            const k = retroscopeCellKey(y, r);
            const cell = byKey.get(k) ?? null;
            const isActive = k === activeKey;
            const isExplored = explored.has(k);
            const isVoid = !cell;

            let stateClass = "arv-cell--unexplored";
            if (isActive) stateClass = "arv-cell--active";
            else if (isExplored) stateClass = "arv-cell--explored";

            const thumb = cell ? canonicalCoverPathToUrl(cell.canonicalCoverPath) : null;
            const signalStub = cell?.trustState === "unresolved" ? "signal" : "none";
            const relatedStub = false;

            return (
              <button
                key={k}
                type="button"
                role="gridcell"
                aria-current={isActive ? "true" : undefined}
                aria-label={
                  cell
                    ? `${cell.title}, ${y}, rank ${r}`
                    : `Empty coordinate ${y} rank ${r}`
                }
                className={`arv-cell ${stateClass} ${isVoid ? "arv-cell--void" : ""} ${
                  relatedStub ? "arv-cell--related" : ""
                } ${signalStub === "signal" ? "arv-cell--signal" : ""}`}
                data-signal={signalStub}
                data-related={relatedStub ? "1" : "0"}
                onClick={() => onCellTap(y, r)}
              >
                <div className="arv-cell-inner">
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="arv-cell-thumb" draggable={false} loading="lazy" />
                  ) : null}
                  <span className="arv-cell-meta">
                    {y}
                    <br />#{r}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}
