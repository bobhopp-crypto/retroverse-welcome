"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import type { RetroscopeCellDTO } from "@/lib/album-retroscope-data";
import {
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  retroscopeCellKey,
} from "@/lib/album-retroscope-data";
import {
  retroscopeArtistRankLabel,
  retroscopeRankDisplayLabel,
  retroscopeTrackRankLabel,
  type RetroscopeMode,
} from "@/lib/retroscope-mode";

const MIN_CELL_PX = 6;
const MAX_CELL_PX = 44;
const DEFAULT_CELL_PX = 18;
const GAP_PX = 1;
const TAP_SLOP_PX = 10;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function modeLabel(mode: RetroscopeMode): string {
  if (mode === "artist") return "Artists";
  if (mode === "track") return "Tracks";
  return "Albums";
}

type MapTransform = {
  panX: number;
  panY: number;
  cellPx: number;
};

function centerTransform(
  width: number,
  height: number,
  activeYear: number,
  activeRank: number,
  cellPx: number,
): MapTransform {
  const step = cellPx + GAP_PX;
  const wx = (activeYear - RETROSCOPE_WORLD_YEAR_MIN) * step;
  const wy = (activeRank - 1) * step;
  return {
    cellPx,
    panX: width / 2 - wx - cellPx / 2,
    panY: height / 2 - wy - cellPx / 2,
  };
}

function screenToCoord(
  sx: number,
  sy: number,
  t: MapTransform,
): { year: number; rank: number } {
  const step = t.cellPx + GAP_PX;
  const year = RETROSCOPE_WORLD_YEAR_MIN + Math.floor((sx - t.panX) / step);
  const rank = 1 + Math.floor((sy - t.panY) / step);
  return {
    year: clamp(year, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX),
    rank: clamp(rank, 1, RETROSCOPE_RANK_MAX),
  };
}

function visibleBounds(width: number, height: number, t: MapTransform) {
  const tl = screenToCoord(0, 0, t);
  const br = screenToCoord(width, height, t);
  return {
    yearMin: Math.min(tl.year, br.year) - 1,
    yearMax: Math.max(tl.year, br.year) + 1,
    rankMin: Math.min(tl.rank, br.rank) - 1,
    rankMax: Math.max(tl.rank, br.rank) + 1,
  };
}

type RetroscopeMapOverlayProps = {
  mode: RetroscopeMode;
  activeYear: number;
  activeRank: number;
  activeKey: string;
  explored: Set<string>;
  byKey: Map<string, RetroscopeCellDTO>;
  onClose: () => void;
  onSelectCoordinate: (year: number, rank: number) => void;
};

export function RetroscopeMapOverlay({
  mode,
  activeYear,
  activeRank,
  activeKey,
  explored,
  byKey,
  onClose,
  onSelectCoordinate,
}: RetroscopeMapOverlayProps) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const transformRef = useRef<MapTransform>({ panX: 0, panY: 0, cellPx: DEFAULT_CELL_PX });
  const [size, setSize] = useState({ w: 0, h: 0 });
  const dragRef = useRef<{ x: number; y: number; panX: number; panY: number } | null>(null);
  const pinchRef = useRef<{ dist: number; cellPx: number } | null>(null);
  const movedRef = useRef(false);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || size.w <= 0 || size.h <= 0) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = size.w;
    const h = size.h;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const t = transformRef.current;
    const step = t.cellPx + GAP_PX;
    const isArtist = mode === "artist";

    const bg = ctx.createLinearGradient(0, 0, w, h);
    bg.addColorStop(0, "#06040c");
    bg.addColorStop(0.45, "#0a1420");
    bg.addColorStop(1, "#08060a");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    ctx.globalAlpha = 0.07;
    ctx.fillStyle = "#88e8ff";
    for (let y = 0; y < h; y += 3) {
      ctx.fillRect(0, y, w, 1);
    }
    ctx.globalAlpha = 1;

    const { yearMin, yearMax, rankMin, rankMax } = visibleBounds(w, h, t);

    for (let year = yearMin; year <= yearMax; year++) {
      for (let rank = rankMin; rank <= rankMax; rank++) {
        const x = t.panX + (year - RETROSCOPE_WORLD_YEAR_MIN) * step;
        const y = t.panY + (rank - 1) * step;
        if (x + t.cellPx < 0 || y + t.cellPx < 0 || x > w || y > h) continue;

        const key = retroscopeCellKey(year, rank);
        const cell = byKey.get(key);
        const isActive = key === activeKey;
        const isExplored = explored.has(key);
        const isVoid = !cell;

        if (isVoid) {
          ctx.fillStyle = "rgba(12, 16, 22, 0.55)";
          ctx.strokeStyle = "rgba(40, 52, 64, 0.35)";
        } else if (isActive) {
          ctx.fillStyle = isArtist ? "hsla(180, 90%, 62%, 0.95)" : "rgba(255, 174, 56, 0.92)";
          ctx.strokeStyle = isArtist ? "hsla(200, 100%, 88%, 1)" : "rgba(255, 240, 200, 1)";
        } else if (isExplored) {
          if (isArtist && cell.signalHue != null) {
            ctx.fillStyle = `hsla(${cell.signalHue}, 72%, 48%, 0.72)`;
            ctx.strokeStyle = `hsla(${cell.signalHue}, 80%, 70%, 0.55)`;
          } else {
            ctx.fillStyle = isArtist ? "hsla(195, 65%, 42%, 0.55)" : "rgba(196, 104, 20, 0.62)";
            ctx.strokeStyle = "rgba(255, 200, 120, 0.35)";
          }
        } else {
          if (isArtist && cell.signalHue != null) {
            ctx.fillStyle = `hsla(${cell.signalHue}, 55%, 32%, 0.42)`;
            ctx.strokeStyle = `hsla(${cell.signalHue}, 60%, 50%, 0.28)`;
          } else {
            ctx.fillStyle = "rgba(28, 48, 42, 0.65)";
            ctx.strokeStyle = "rgba(60, 90, 80, 0.4)";
          }
        }

        ctx.fillRect(x, y, t.cellPx, t.cellPx);
        ctx.lineWidth = isActive ? 2 : 1;
        ctx.strokeRect(x + 0.5, y + 0.5, t.cellPx - 1, t.cellPx - 1);

        if (isActive) {
          ctx.shadowColor = isArtist ? "hsla(190, 100%, 70%, 0.9)" : "rgba(255, 180, 60, 0.85)";
          ctx.shadowBlur = 14;
          ctx.strokeRect(x, y, t.cellPx, t.cellPx);
          ctx.shadowBlur = 0;
        }
      }
    }

    const ax = t.panX + (activeYear - RETROSCOPE_WORLD_YEAR_MIN) * step + t.cellPx / 2;
    const ay = t.panY + (activeRank - 1) * step + t.cellPx / 2;
    ctx.strokeStyle = isArtist ? "rgba(120, 255, 255, 0.35)" : "rgba(255, 200, 100, 0.3)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, ay);
    ctx.lineTo(w, ay);
    ctx.moveTo(ax, 0);
    ctx.lineTo(ax, h);
    ctx.stroke();
  }, [activeKey, activeRank, activeYear, byKey, explored, mode, size.h, size.w]);

  const scheduleDraw = useCallback(() => {
    requestAnimationFrame(draw);
  }, [draw]);

  useLayoutEffect(() => {
    const el = viewportRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      setSize({ w: cr.width, h: cr.height });
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    if (size.w <= 0 || size.h <= 0) return;
    transformRef.current = centerTransform(size.w, size.h, activeYear, activeRank, DEFAULT_CELL_PX);
    scheduleDraw();
  }, [activeRank, activeYear, scheduleDraw, size.h, size.w]);

  useEffect(() => {
    scheduleDraw();
  }, [explored, byKey, scheduleDraw]);

  useEffect(() => {
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const t = transformRef.current;
    const before = screenToCoord(mx, my, t);
    const nextPx = clamp(t.cellPx * (e.deltaY < 0 ? 1.12 : 0.9), MIN_CELL_PX, MAX_CELL_PX);
    const step = nextPx + GAP_PX;
    transformRef.current = {
      cellPx: nextPx,
      panX: mx - (before.year - RETROSCOPE_WORLD_YEAR_MIN) * step - nextPx / 2,
      panY: my - (before.rank - 1) * step - nextPx / 2,
    };
    scheduleDraw();
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.pointerType === "touch" && e.isPrimary === false) return;
    movedRef.current = false;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    dragRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: transformRef.current.panX,
      panY: transformRef.current.panY,
    };
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const d = dragRef.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (dx * dx + dy * dy > TAP_SLOP_PX * TAP_SLOP_PX) movedRef.current = true;
    transformRef.current = {
      ...transformRef.current,
      panX: d.panX + dx,
      panY: d.panY + dy,
    };
    scheduleDraw();
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const d = dragRef.current;
    dragRef.current = null;
    if (!d) return;
    const rect = canvasRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!movedRef.current) {
      const { year, rank } = screenToCoord(e.clientX - rect.left, e.clientY - rect.top, transformRef.current);
      onSelectCoordinate(year, rank);
    }
  };

  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      const [a, b] = [e.touches[0]!, e.touches[1]!];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { dist, cellPx: transformRef.current.cellPx };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length !== 2 || !pinchRef.current) return;
    e.preventDefault();
    const [a, b] = [e.touches[0]!, e.touches[1]!];
    const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
    const scale = dist / pinchRef.current.dist;
    transformRef.current = {
      ...transformRef.current,
      cellPx: clamp(pinchRef.current.cellPx * scale, MIN_CELL_PX, MAX_CELL_PX),
    };
    scheduleDraw();
  };

  const onTouchEnd = () => {
    pinchRef.current = null;
  };

  const rankLabel = retroscopeRankDisplayLabel(activeRank, mode);

  return (
    <div className="arv-map-overlay" role="dialog" aria-modal="true" aria-label="RetroScope navigation map">
      <div className="arv-map-scan" aria-hidden />
      <div className="arv-map-bloom" aria-hidden />
      <header className="arv-map-header">
        <div className="arv-map-readout">
          <span className="arv-map-readout-label">Plot</span>
          <span className="arv-map-readout-value">
            {activeYear} · {rankLabel}
          </span>
          <span className="arv-map-readout-mode">{modeLabel(mode)} layer</span>
        </div>
        <button type="button" className="arv-map-close" onClick={onClose}>
          Close
        </button>
      </header>
      <div ref={viewportRef} className="arv-map-viewport">
        <canvas
          ref={canvasRef}
          className="arv-map-canvas"
          aria-label="Coordinate navigation map"
          onWheel={onWheel}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            dragRef.current = null;
          }}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        />
        <div className="arv-map-axis arv-map-axis--years" aria-hidden>
          <span>{RETROSCOPE_WORLD_YEAR_MIN}</span>
          <span>years →</span>
          <span>{RETROSCOPE_WORLD_YEAR_MAX}</span>
        </div>
        <div className="arv-map-axis arv-map-axis--ranks" aria-hidden>
          <span>
            {mode === "artist" ? retroscopeArtistRankLabel(1) : mode === "track" ? retroscopeTrackRankLabel(1) : "#1"} ↑
          </span>
          <span>rank ↓</span>
          <span>
            {mode === "artist"
              ? retroscopeArtistRankLabel(RETROSCOPE_RANK_MAX)
              : mode === "track"
                ? retroscopeTrackRankLabel(RETROSCOPE_RANK_MAX)
                : `#${RETROSCOPE_RANK_MAX}`}
          </span>
        </div>
      </div>
      <footer className="arv-map-footer">
        <span>Drag · pinch · wheel to navigate</span>
        <span>Tap coordinate to tune</span>
      </footer>
    </div>
  );
}
