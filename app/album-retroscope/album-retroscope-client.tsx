"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import type { RetroscopeCellDTO } from "@/lib/album-retroscope-data";
import {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_GRID_ROWS_MOBILE,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  retroscopeCellKey,
} from "@/lib/album-retroscope-data";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

const SWIPE_MIN_PX = 28;
const CURATOR_DOUBLE_TAP_MS = 420;
const MOBILE_MQ = "(max-width: 767px)";
const RVAL_RE = /RVAL[0-9]{6}/i;

function rvalFromCoverPath(path: string | null | undefined): string | null {
  if (!path) return null;
  const m = path.match(RVAL_RE);
  return m ? m[0].toUpperCase() : null;
}

function curatorHrefForCell(cell: RetroscopeCellDTO | null): string | null {
  if (!cell) return null;
  const rval = rvalFromCoverPath(cell.canonicalCoverPath);
  if (rval) return `/portal-v2/curate?albumId=${encodeURIComponent(rval)}`;
  if (RVAL_RE.test(cell.albumId)) {
    return `/portal-v2/curate?albumId=${encodeURIComponent(cell.albumId.toUpperCase())}`;
  }
  return "/internal/curator";
}

/** RVAL album page, or search fallback when identity is bb200-only. */
function archiveHrefForCell(cell: RetroscopeCellDTO | null): string | null {
  if (!cell) return null;
  const rval = rvalFromCoverPath(cell.canonicalCoverPath);
  if (rval) return `/albums/${rval}`;
  if (RVAL_RE.test(cell.albumId)) return `/albums/${cell.albumId.toUpperCase()}`;
  const q = `${cell.artist} ${cell.title}`.trim();
  if (q) return `/search?q=${encodeURIComponent(q)}`;
  return null;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function visibleRowsForViewport(): number {
  if (typeof window === "undefined") return RETROSCOPE_GRID_ROWS;
  return window.matchMedia(MOBILE_MQ).matches ? RETROSCOPE_GRID_ROWS_MOBILE : RETROSCOPE_GRID_ROWS;
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
  const initialRows = visibleRowsForViewport();

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

  const [visibleGridRows, setVisibleGridRows] = useState(initialRows);
  const [activeYear, setActiveYear] = useState(safeInit.y);
  const [activeRank, setActiveRank] = useState(safeInit.r);
  const [explored, setExplored] = useState<Set<string>>(() => new Set([retroscopeCellKey(safeInit.y, safeInit.r)]));
  const [operatorFlash, setOperatorFlash] = useState(false);
  const [portalPulse, setPortalPulse] = useState(false);
  const router = useRouter();
  const [viewYear0, setViewYear0] = useState(() =>
    clamp(safeInit.y, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1),
  );
  const [viewRank0, setViewRank0] = useState(() =>
    clamp(safeInit.r, 1, RETROSCOPE_RANK_MAX - initialRows + 1),
  );

  const posRef = useRef({ y: safeInit.y, r: safeInit.r });
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const curatorTapRef = useRef<number | null>(null);
  const portalPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(MOBILE_MQ);
    const apply = () => setVisibleGridRows(mq.matches ? RETROSCOPE_GRID_ROWS_MOBILE : RETROSCOPE_GRID_ROWS);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);

  useEffect(() => {
    posRef.current = { y: activeYear, r: activeRank };
  }, [activeYear, activeRank]);

  const activeKey = retroscopeCellKey(activeYear, activeRank);
  const activeCell = byKey.get(activeKey) ?? null;

  const bumpViewportToInclude = useCallback(
    (ny: number, nr: number) => {
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
        const rMax = r0 + visibleGridRows - 1;
        let next = r0;
        if (rnn < r0) next = rnn;
        else if (rnn > rMax) next = rnn - (visibleGridRows - 1);
        return clamp(next, 1, RETROSCOPE_RANK_MAX - visibleGridRows + 1);
      });
    },
    [visibleGridRows],
  );

  const flashPortal = useCallback(() => {
    setPortalPulse(true);
    if (portalPulseTimer.current) clearTimeout(portalPulseTimer.current);
    portalPulseTimer.current = setTimeout(() => setPortalPulse(false), 120);
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
      flashPortal();
      if (dir === "l") moveTo(y - 1, r, from);
      if (dir === "r") moveTo(y + 1, r, from);
      if (dir === "u") moveTo(y, r - 1, from);
      if (dir === "d") moveTo(y, r + 1, from);
    },
    [flashPortal, moveTo],
  );

  const resolveSwipe = useCallback(
    (dx: number, dy: number) => {
      if (Math.abs(dx) < SWIPE_MIN_PX && Math.abs(dy) < SWIPE_MIN_PX) {
        const { y, r } = posRef.current;
        const cell = byKey.get(retroscopeCellKey(y, r)) ?? null;
        const href = archiveHrefForCell(cell);
        if (href) router.push(href);
        return;
      }
      flashPortal();
      if (Math.abs(dx) >= Math.abs(dy)) {
        onPad(dx > 0 ? "r" : "l");
        return;
      }
      onPad(dy < 0 ? "u" : "d");
    },
    [byKey, flashPortal, onPad, router],
  );

  const onPortalTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    if (!t) return;
    swipeRef.current = { x: t.clientX, y: t.clientY };
  };

  const onPortalTouchMove = (e: React.TouchEvent) => {
    if (swipeRef.current) e.preventDefault();
  };

  const onPortalTouchEnd = (e: React.TouchEvent) => {
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    const t = e.changedTouches[0];
    if (!t) return;
    resolveSwipe(t.clientX - start.x, t.clientY - start.y);
  };

  const onPortalPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    swipeRef.current = { x: e.clientX, y: e.clientY };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const onPortalPointerUp = (e: React.PointerEvent) => {
    if (e.pointerType === "touch") return;
    const start = swipeRef.current;
    swipeRef.current = null;
    if (!start) return;
    resolveSwipe(e.clientX - start.x, e.clientY - start.y);
  };

  const onCuratorHotspotTap = () => {
    const now = Date.now();
    if (curatorTapRef.current != null && now - curatorTapRef.current < CURATOR_DOUBLE_TAP_MS) {
      curatorTapRef.current = null;
      const href = curatorHrefForCell(activeCell);
      if (!href) return;
      setOperatorFlash(true);
      window.setTimeout(() => router.push(href), 220);
      return;
    }
    curatorTapRef.current = now;
  };

  useEffect(() => {
    const blockScroll = (e: TouchEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (t.closest(".arv-portal, .arv-hero, .arv-pad-btn, .arv-cell, .arv-back, .arv-curator-hotspot, a")) {
        return;
      }
      e.preventDefault();
    };
    document.addEventListener("touchmove", blockScroll, { passive: false });
    return () => document.removeEventListener("touchmove", blockScroll);
  }, []);

  useEffect(() => {
    return () => {
      if (portalPulseTimer.current) clearTimeout(portalPulseTimer.current);
    };
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
    const cur = retroscopeCellKey(posRef.current.y, posRef.current.r);
    if (k === cur) {
      const cell = byKey.get(k) ?? null;
      const href = archiveHrefForCell(cell);
      if (href) router.push(href);
      return;
    }
    moveTo(y, r, cur);
  };

  const searchHref =
    activeCell != null
      ? `/search?q=${encodeURIComponent(`${activeCell.artist} ${activeCell.title}`.trim())}`
      : null;

  const cellCount = visibleGridRows * RETROSCOPE_GRID_COLS;

  return (
    <div className={`arv-machine${operatorFlash ? " arv-machine--operator" : ""}`}>
      <div className="arv-device-face" aria-hidden>
        <span className="arv-screw arv-screw--tl" />
        <span className="arv-screw arv-screw--tr" />
        <span className="arv-device-led arv-device-led--pwr" />
        <span className="arv-device-led arv-device-led--sig" />
        <span className="arv-device-brand">
          Retroscope<span className="arv-device-model"> 2000</span>
        </span>
        <span className="arv-device-sub">
          <span className="arv-device-sub-line">Solid State</span>
          <span className="arv-device-sub-line">Catalog Explorer</span>
        </span>
        <span className="arv-device-vents" />
        <span className="arv-screw arv-screw--bl" />
        <span className="arv-screw arv-screw--br" />
      </div>

      <button
        type="button"
        className="arv-curator-hotspot"
        aria-label="Operator access"
        onClick={onCuratorHotspotTap}
      />

      <Link href="/welcome" className="arv-back">
        Exit
      </Link>

      <section className="arv-portal" aria-label="Album portal">
        <Link href="/toc" className="arv-portal-tag" aria-label="Retroverse index">
          Portal
        </Link>
        <div className="arv-portal-bezel">
          <span className="arv-portal-rim" aria-hidden />
          <div
            className={`arv-hero arv-hero--surface${portalPulse ? " arv-hero--pulse" : ""}`}
            onTouchStart={onPortalTouchStart}
            onTouchMove={onPortalTouchMove}
            onTouchEnd={onPortalTouchEnd}
            onTouchCancel={() => {
              swipeRef.current = null;
            }}
            onPointerDown={onPortalPointerDown}
            onPointerUp={onPortalPointerUp}
            onPointerCancel={() => {
              swipeRef.current = null;
            }}
          >
            <HeroCover key={activeKey} cell={activeCell} />
            <span className="arv-portal-glass" aria-hidden />
            <span className="arv-portal-scan" aria-hidden />
          </div>
        </div>
      </section>

      <section className="arv-meta" aria-live="polite">
        <span className="arv-meta-plate-label" aria-hidden>
          Readout
        </span>
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

      <section className="arv-strip arv-strip--secondary" aria-label="Retroscope controls (secondary)">
        <div className="arv-readout arv-readout--year">
          <span className="arv-readout-lamp" aria-hidden />
          <div className="arv-readout-label">Year</div>
          <div className="arv-readout-value">{activeYear}</div>
        </div>

        <span className="arv-strip-plate-label" aria-hidden>
          Nav
        </span>
        <div className="arv-controls" aria-label="Directional fallback">
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
          <span className="arv-readout-lamp" aria-hidden />
          <span className="arv-readout-dot" aria-hidden />
          <div className="arv-readout-label">Rank</div>
          <div className="arv-readout-value">#{activeRank}</div>
        </div>
      </section>

      <section className="arv-viewport" aria-label="Exploration viewport">
        <span className="arv-viewport-label" aria-hidden>
          Coordinate Bay
        </span>
        <div
          className="arv-grid"
          role="grid"
          style={{ gridTemplateRows: `repeat(${visibleGridRows}, minmax(0, 1fr))` }}
        >
          {Array.from({ length: cellCount }, (_, i) => {
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
