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
  const [explored, setExplored] = useState<Set<string>>(() => new Set([retroscopeCellKey(safeInit.y, safeInit.r)]));
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

  const moveTo = useCallback(
    (nextYear: number, nextRank: number, markExploredFrom: string | null) => {
      const { y: cy, r: cr } = posRef.current;
      const ny = clamp(nextYear, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX);
      const nr = clamp(nextRank, 1, RETROSCOPE_RANK_MAX);
      const nk = retroscopeCellKey(ny, nr);
      if (nk === retroscopeCellKey(cy, cr)) return;
      setExplored((prev) => {
        const n = new Set(prev);
        if (markExploredFrom) n.add(markExploredFrom);
        n.add(nk);
        return n;
      });
      posRef.current = { y: ny, r: nr };
      setActiveYear(ny);
      setActiveRank(nr);
      bumpViewportToInclude(ny, nr);
    },
    [bumpViewportToInclude],
  );

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
    const blockScroll = (e: TouchEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".arv-pad-btn, .arv-cell, .arv-back, a")) return;
      e.preventDefault();
    };
    document.addEventListener("touchmove", blockScroll, { passive: false });
    return () => document.removeEventListener("touchmove", blockScroll);
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

  const searchHref =
    activeCell != null
      ? `/search?q=${encodeURIComponent(`${activeCell.artist} ${activeCell.title}`.trim())}`
      : null;

  return (
    <div className="arv-machine">
      <Link href="/" className="arv-back">
        ← Portal
      </Link>

      <section className="arv-portal" aria-label="Album portal">
        <div className="arv-hero">
          <HeroCover key={activeKey} cell={activeCell} />
        </div>
      </section>

      <section className="arv-meta" aria-live="polite">
        <div className="arv-meta-inner">
          {activeCell ? (
            <>
              <p className="arv-eyebrow">
                {activeCell.chartYear} · #{activeCell.retroverseRank}
                {searchHref ? (
                  <Link href={searchHref} className="arv-meta-link">
                    · search
                  </Link>
                ) : null}
              </p>
              <p className="arv-title-line">
                {activeCell.artist} — {activeCell.title}
              </p>
            </>
          ) : (
            <>
              <p className="arv-eyebrow">
                {activeYear} · #{activeRank}
              </p>
              <p className="arv-title-line opacity-70">Off corpus · keep moving</p>
            </>
          )}
        </div>
      </section>

      <section className="arv-strip" aria-label="Retroscope controls">
        <div className="arv-readout arv-readout--year">
          <div className="arv-readout-label">Year</div>
          <div className="arv-readout-value">{activeYear}</div>
        </div>

        <div className="arv-controls">
          <button
            type="button"
            className="arv-pad-btn arv-pad-btn--lr"
            aria-label="Previous year"
            onClick={() => onPad("l")}
          >
            ←
          </button>
          <div className="arv-pad-col">
            <button type="button" className="arv-pad-btn" aria-label="Up toward number one" onClick={() => onPad("u")}>
              ↑
            </button>
            <button type="button" className="arv-pad-btn" aria-label="Deeper rank" onClick={() => onPad("d")}>
              ↓
            </button>
          </div>
          <button
            type="button"
            className="arv-pad-btn arv-pad-btn--lr"
            aria-label="Next year"
            onClick={() => onPad("r")}
          >
            →
          </button>
        </div>

        <div className="arv-readout arv-readout--rank">
          <div className="arv-readout-label">Rank</div>
          <div className="arv-readout-value">#{activeRank}</div>
        </div>
      </section>

      <section className="arv-viewport" aria-label="Exploration viewport">
        <div className="arv-grid" role="grid">
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

            return (
              <button
                key={k}
                type="button"
                role="gridcell"
                aria-current={isActive ? "true" : undefined}
                aria-label={
                  cell ? `${cell.title}, ${y}, rank ${r}` : `Empty coordinate ${y} rank ${r}`
                }
                className={`arv-cell ${stateClass} ${isVoid ? "arv-cell--void" : ""}`}
                onClick={() => onCellTap(y, r)}
              >
                <div className="arv-cell-inner">
                  {isExplored && !isVoid ? <span className="arv-cell-reveal" aria-hidden /> : null}
                  {thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="arv-cell-thumb" draggable={false} loading="lazy" />
                  ) : null}
                  {!isVoid && !isExplored && !isActive ? (
                    <span className="arv-cell-mask" aria-hidden />
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
      </section>
    </div>
  );
}
