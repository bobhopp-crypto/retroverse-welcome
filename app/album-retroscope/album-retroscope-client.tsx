"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import type { RetroscopeCellDTO } from "@/lib/album-retroscope-data";
import {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_GRID_ROWS_MOBILE,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  RETROSCOPE_YEAR_MAX,
  RETROSCOPE_YEAR_MIN,
  retroscopeCellKey,
} from "@/lib/album-retroscope-data";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import {
  fitViewportToIncludeCoordinate,
  loadRetroscopePersistedSession,
  retroscopeCorpusId,
  saveRetroscopePersistedSession,
} from "@/lib/retroscope-persist-session";

const RVAL_RE = /RVAL[0-9]{6}/i;
/** Finger noise only — inside this radius = tap to open dossier; outside = exactly one ±1 movement. */
const PORTAL_TAP_SLOP_PX = 11;
const MOBILE_MQ = "(max-width: 767px)";

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

/** Deterministic ±1 move: dominant axis wins (ties → horizontal). Inside slop = tap. */
function classifyPortalGesture(dx: number, dy: number): "tap" | "l" | "r" | "u" | "d" {
  const r = PORTAL_TAP_SLOP_PX;
  if (dx * dx + dy * dy <= r * r) return "tap";
  if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "r" : "l";
  return dy < 0 ? "u" : "d";
}

/** Static diagram for help card — not the live portal. */
function HelpPortalDiagram() {
  return (
    <svg className="arv-help-diagram-svg" viewBox="0 0 240 132" xmlns="http://www.w3.org/2000/svg" aria-hidden>
      <defs>
        <linearGradient id="arv-help-glare" x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor="#fff9e8" stopOpacity="0.2" />
          <stop offset="45%" stopColor="#fff9e8" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#16262a" stopOpacity="0.15" />
        </linearGradient>
      </defs>
      <rect x="4" y="6" width="232" height="120" rx="8" fill="#dcd0b8" stroke="#4a4338" strokeWidth="3" />
      <rect x="48" y="18" width="144" height="96" rx="4" fill="#0c0b09" stroke="#2a261f" strokeWidth="2" />
      <rect x="54" y="24" width="132" height="84" rx="2" fill="url(#arv-help-glare)" />
      <text
        x="120"
        y="68"
        textAnchor="middle"
        fill="#3d5248"
        opacity={0.45}
        fontSize="11"
        fontFamily="system-ui,sans-serif"
        letterSpacing="0.08em"
      >
        COVER
      </text>
      <line x1="38" y1="74" x2="208" y2="74" stroke="#b85a0f" strokeWidth="2.25" strokeLinecap="square" />
      <polygon points="30,74 41,69 41,79" fill="#b85a0f" />
      <polygon points="216,74 205,69 205,79" fill="#b85a0f" />
      <line x1="28" y1="106" x2="28" y2="30" stroke="#1e5660" strokeWidth="2.25" strokeLinecap="square" />
      <polygon points="28,114 21,103 35,103" fill="#1e5660" />
      <polygon points="28,22 21,34 35,34" fill="#1e5660" />
      <text x="226" y="92" fill="#b85a0f" fontSize="9" fontFamily="system-ui,sans-serif" fontWeight="700" letterSpacing="0.12em" textAnchor="end">
        YEARS ← →
      </text>
      <text x="38" y="22" fill="#1e5660" fontSize="9" fontFamily="system-ui,sans-serif" fontWeight="700" letterSpacing="0.08em">
        RANK ↑ ↓
      </text>
    </svg>
  );
}

function HelpGridDiagram() {
  const cells = [
    { tone: "low" }, { tone: "med" }, { tone: "strong" }, { tone: "med" }, { tone: "low" },
    { tone: "low" }, { tone: "med" }, { tone: "on" }, { tone: "med" }, { tone: "low" },
    { tone: "low" }, { tone: "med" }, { tone: "med" }, { tone: "strong" }, { tone: "low" },
    { tone: "low" }, { tone: "low" }, { tone: "low" }, { tone: "med" }, { tone: "explored" },
  ];
  return (
    <div className="arv-help-grid-diagram" aria-hidden>
      <div className="arv-help-grid-diagram-years">
        <span>Y−2</span>
        <span>Y−1</span>
        <span>Y</span>
        <span>Y+1</span>
        <span>Y+2</span>
      </div>
      <div className="arv-help-grid-diagram-cells">
        {cells.map((c, i) => (
          <span key={i} className={`arv-help-grid-cell arv-help-grid-cell--${c.tone}`} />
        ))}
      </div>
      <div className="arv-help-grid-diagram-ranks" aria-hidden>
        <span>#1 ↑</span>
        <span>↓ deeper</span>
      </div>
    </div>
  );
}

function OperatorConsoleGlyph() {
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden xmlns="http://www.w3.org/2000/svg">
      <circle cx="12" cy="12.5" r="6.75" stroke="currentColor" strokeWidth="1.25" opacity="0.85" />
      <circle cx="12" cy="12.5" r="3.85" stroke="currentColor" strokeWidth="1" opacity="0.65" />
      <circle cx="12" cy="12.5" r="1.1" fill="currentColor" opacity="0.92" />
      <path
        d="M4 8.75h3.45M17.55 8.75H21M7.5 17.95l2.06-3.62M17.94 17.93l-2.06-3.61"
        stroke="currentColor"
        strokeWidth="0.95"
        strokeLinecap="round"
        opacity="0.55"
      />
    </svg>
  );
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

function subscribeRetroscopeViewportRows(cb: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  const mq = window.matchMedia(MOBILE_MQ);
  mq.addEventListener("change", cb);
  window.addEventListener("resize", cb);
  return () => {
    mq.removeEventListener("change", cb);
    window.removeEventListener("resize", cb);
  };
}

function snapshotRetroscopeGridRows(): number {
  if (typeof window === "undefined") return RETROSCOPE_GRID_ROWS;
  return window.matchMedia(MOBILE_MQ).matches ? RETROSCOPE_GRID_ROWS_MOBILE : RETROSCOPE_GRID_ROWS;
}

function serverSnapshotRetroscopeGridRows(): number {
  /** Must match SSR: desktop row count until after hydration when client subscribes. */
  return RETROSCOPE_GRID_ROWS;
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

/** Only when nothing is persisted: random top-5 cell in billboard core band (years per RETROSCOPE_YEAR_*). */
function randomFirstVisitBootstrap(
  cells: RetroscopeCellDTO[],
  rnd: () => number = () => Math.random(),
): { y: number; r: number } {
  const band = cells.filter(
    (c) =>
      c.chartYear >= RETROSCOPE_YEAR_MIN &&
      c.chartYear <= RETROSCOPE_YEAR_MAX &&
      Number.isFinite(c.retroverseRank) &&
      c.retroverseRank >= 1 &&
      c.retroverseRank <= 5,
  );
  if (band.length > 0) {
    const pick = band[Math.floor(rnd() * band.length)]!;
    return { y: pick.chartYear, r: pick.retroverseRank };
  }
  const sorted = [...cells].sort((a, b) =>
    a.chartYear !== b.chartYear ? a.chartYear - b.chartYear : a.retroverseRank - b.retroverseRank,
  );
  const head = sorted[0];
  if (head) return { y: head.chartYear, r: head.retroverseRank };
  return { y: RETROSCOPE_WORLD_YEAR_MIN, r: 1 };
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

  const corpusId = useMemo(() => retroscopeCorpusId(cells), [cells]);

  const visibleGridRows = useSyncExternalStore(
    subscribeRetroscopeViewportRows,
    snapshotRetroscopeGridRows,
    serverSnapshotRetroscopeGridRows,
  );

  const [activeYear, setActiveYear] = useState(safeInit.y);
  const [activeRank, setActiveRank] = useState(safeInit.r);
  const [explored, setExplored] = useState<Set<string>>(() => new Set([retroscopeCellKey(safeInit.y, safeInit.r)]));
  const [operatorFlash, setOperatorFlash] = useState(false);
  const [portalPulse, setPortalPulse] = useState(false);
  const [operatorPanelOpen, setOperatorPanelOpen] = useState(false);
  const router = useRouter();
  const [viewYear0, setViewYear0] = useState(() =>
    clamp(safeInit.y, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1),
  );
  const [viewRank0, setViewRank0] = useState(() =>
    clamp(safeInit.r, 1, RETROSCOPE_RANK_MAX - serverSnapshotRetroscopeGridRows() + 1),
  );

  /** Keep viewport rank clamped when breakpoint row count shifts — avoids hydration mismatch vs SSR desktop rows. */
  const effectiveViewRank0 = useMemo(
    () => clamp(viewRank0, 1, RETROSCOPE_RANK_MAX - visibleGridRows + 1),
    [viewRank0, visibleGridRows],
  );

  const posRef = useRef({ y: safeInit.y, r: safeInit.r });
  const restoreDoneRef = useRef(false);
  const persistSnapRef = useRef({
    corpusId: "",
    activeYear: RETROSCOPE_WORLD_YEAR_MIN,
    activeRank: 1,
    exploredKeys: [] as string[],
    viewYear0: RETROSCOPE_WORLD_YEAR_MIN,
    viewRank0: 1,
  });
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const portalPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Persisted corpus session (localStorage) is external to React — hydrate before paint to avoid SSR/CSR mismatch flashes. */
  /* eslint-disable react-hooks/set-state-in-effect -- hydrate from persisted session */
  useLayoutEffect(() => {
    const saved = loadRetroscopePersistedSession(corpusId);
    const gridRows = snapshotRetroscopeGridRows();

    if (saved) {
      const ay = saved.activeYear;
      const ar = saved.activeRank;
      const fitted = fitViewportToIncludeCoordinate({
        activeYear: ay,
        activeRank: ar,
        viewYear0: saved.viewYear0,
        viewRank0: saved.viewRank0,
        visibleGridRows: gridRows,
      });
      posRef.current = { y: ay, r: ar };
      setActiveYear(ay);
      setActiveRank(ar);
      setViewYear0(fitted.viewYear0);
      setViewRank0(fitted.viewRank0);
      setExplored(new Set(saved.exploredKeys));
      persistSnapRef.current = {
        corpusId,
        activeYear: ay,
        activeRank: ar,
        exploredKeys: [...new Set(saved.exploredKeys)],
        viewYear0: fitted.viewYear0,
        viewRank0: fitted.viewRank0,
      };
    } else {
      const { y: iy, r: ir } = randomFirstVisitBootstrap(cells);
      const fitted = fitViewportToIncludeCoordinate({
        activeYear: iy,
        activeRank: ir,
        viewYear0: clamp(iy, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1),
        viewRank0: clamp(ir, 1, RETROSCOPE_RANK_MAX - gridRows + 1),
        visibleGridRows: gridRows,
      });
      posRef.current = { y: iy, r: ir };
      setActiveYear(iy);
      setActiveRank(ir);
      setExplored(new Set([retroscopeCellKey(iy, ir)]));
      setViewYear0(fitted.viewYear0);
      setViewRank0(fitted.viewRank0);
      const exploredInit = [retroscopeCellKey(iy, ir)];
      persistSnapRef.current = {
        corpusId,
        activeYear: iy,
        activeRank: ir,
        exploredKeys: exploredInit,
        viewYear0: fitted.viewYear0,
        viewRank0: fitted.viewRank0,
      };
      saveRetroscopePersistedSession({
        version: 1,
        corpusId,
        activeYear: iy,
        activeRank: ir,
        exploredKeys: exploredInit,
        viewYear0: fitted.viewYear0,
        viewRank0: fitted.viewRank0,
      });
    }
    restoreDoneRef.current = true;
  }, [corpusId]); // eslint-disable-line react-hooks/exhaustive-deps -- corpus fingerprint already includes cell set; avoids URL bootstrap fighting storage
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!restoreDoneRef.current) return;
    persistSnapRef.current = {
      corpusId,
      activeYear,
      activeRank,
      exploredKeys: [...explored],
      viewYear0,
      viewRank0,
    };
  }, [corpusId, activeYear, activeRank, viewYear0, viewRank0, explored]);

  useEffect(() => {
    const flushPersistFromRef = () => {
      const p = persistSnapRef.current;
      if (!restoreDoneRef.current || !p.corpusId) return;
      saveRetroscopePersistedSession({
        version: 1,
        corpusId: p.corpusId,
        activeYear: p.activeYear,
        activeRank: p.activeRank,
        exploredKeys: p.exploredKeys,
        viewYear0: p.viewYear0,
        viewRank0: p.viewRank0,
      });
    };

    const onHidden = () => {
      if (document.visibilityState === "hidden") flushPersistFromRef();
    };

    window.addEventListener("pagehide", flushPersistFromRef);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      window.removeEventListener("pagehide", flushPersistFromRef);
      document.removeEventListener("visibilitychange", onHidden);
    };
  }, []);

  useEffect(() => {
    if (!restoreDoneRef.current) return;

    const flushPersistFromRef = () => {
      const p = persistSnapRef.current;
      if (!restoreDoneRef.current || !p.corpusId) return;
      saveRetroscopePersistedSession({
        version: 1,
        corpusId: p.corpusId,
        activeYear: p.activeYear,
        activeRank: p.activeRank,
        exploredKeys: p.exploredKeys,
        viewYear0: p.viewYear0,
        viewRank0: p.viewRank0,
      });
    };

    const t = window.setTimeout(flushPersistFromRef, 120);
    return () => {
      window.clearTimeout(t);
      flushPersistFromRef();
    };
  }, [corpusId, activeYear, activeRank, viewYear0, viewRank0, explored]);

  useEffect(() => {
    posRef.current = { y: activeYear, r: activeRank };
  }, [activeYear, activeRank]);

  const activeKey = retroscopeCellKey(activeYear, activeRank);
  const activeCell = byKey.get(activeKey) ?? null;

  const curatorHref = useMemo(() => curatorHrefForCell(activeCell), [activeCell]);

  const flushRetroscopePersistNow = useCallback(() => {
    if (!restoreDoneRef.current) return;
    const snap = {
      corpusId,
      activeYear,
      activeRank,
      exploredKeys: [...explored],
      viewYear0,
      viewRank0,
    };
    persistSnapRef.current = snap;
    saveRetroscopePersistedSession({
      version: 1,
      ...snap,
    });
  }, [corpusId, activeYear, activeRank, explored, viewYear0, viewRank0]);
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
      const g = classifyPortalGesture(dx, dy);
      if (g === "tap") {
        const { y, r } = posRef.current;
        const cell = byKey.get(retroscopeCellKey(y, r)) ?? null;
        const href = archiveHrefForCell(cell);
        if (href) {
          flushRetroscopePersistNow();
          router.push(href);
        }
        return;
      }
      flashPortal();
      onPad(g);
    },
    [byKey, flashPortal, flushRetroscopePersistNow, onPad, router],
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

  const openOperatorCurator = useCallback(() => {
    if (!curatorHref) return;
    setOperatorPanelOpen(false);
    setOperatorFlash(true);
    flushRetroscopePersistNow();
    window.setTimeout(() => router.push(curatorHref), 220);
  }, [curatorHref, flushRetroscopePersistNow, router]);
  useEffect(() => {
    const blockScroll = (e: TouchEvent) => {
      const t = e.target;
      if (!(t instanceof Element)) return;
      if (
        t.closest(
          ".arv-portal, .arv-hero, .arv-pad-btn, .arv-cell, .arv-back, .arv-operator-glyph, .arv-help-overlay, .arv-help-scroll, a",
        )
      ) {
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
    if (!operatorPanelOpen) return;
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        setOperatorPanelOpen(false);
      }
    };
    window.addEventListener("keydown", onEsc);
    return () => window.removeEventListener("keydown", onEsc);
  }, [operatorPanelOpen]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (operatorPanelOpen) return;
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
  }, [onPad, operatorPanelOpen]);

  const onCellTap = useCallback(
    (y: number, r: number) => {
      const k = retroscopeCellKey(y, r);
      const cur = retroscopeCellKey(posRef.current.y, posRef.current.r);
      if (k === cur) {
        const cell = byKey.get(k) ?? null;
        const href = archiveHrefForCell(cell);
        if (href) {
          flushRetroscopePersistNow();
          router.push(href);
        }
        return;
      }
      moveTo(y, r, cur);
    },
    [byKey, flushRetroscopePersistNow, moveTo, router],
  );

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

      <Link href="/welcome" className="arv-back">
        Exit
      </Link>

      <section className="arv-portal" aria-label="Album portal">
        <Link href="/toc" className="arv-portal-tag" aria-label="Retroverse index">
          Portal
        </Link>
        <div className="arv-portal-bezel">
          <button
            type="button"
            className="arv-operator-glyph"
            aria-label="Open Retroscope instruction card"
            title="Instructions"
            onClick={() => setOperatorPanelOpen(true)}
          >
            <OperatorConsoleGlyph />
          </button>
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

      {operatorPanelOpen ? (
        <div className="arv-help-overlay">
          <button
            type="button"
            className="arv-help-backdrop"
            aria-label="Close instruction card"
            onClick={() => setOperatorPanelOpen(false)}
          />
          <div
            className="arv-help-sheet"
            role="dialog"
            aria-modal="true"
            aria-labelledby="arv-help-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              className="arv-help-close"
              aria-label="Close instruction card"
              onClick={() => setOperatorPanelOpen(false)}
            >
              <span aria-hidden className="arv-help-close-symbol">
                ✕
              </span>
              <span className="arv-help-close-label">Return</span>
            </button>
            <p className="arv-help-corner-mark" aria-hidden>
              Ships with unit
            </p>
            <div className="arv-help-scroll">
              <header className="arv-help-hero">
                <h2 id="arv-help-title" className="arv-help-title">
                  How to use the <span className="arv-help-title-em">Retroscope</span>
                </h2>
                <p className="arv-help-tagline">A calibrated archive instrument.</p>
              </header>

              <section className="arv-help-panel">
                <h3 className="arv-help-heading">THE PORTAL</h3>
                <p className="arv-help-micro">Your current selection — main display glass</p>
                <div className="arv-help-diagram-wrap">
                  <HelpPortalDiagram />
                </div>
                <ul className="arv-help-list">
                  <li>
                    <strong>Horizontal drag</strong> — ±1 year
                  </li>
                  <li>
                    <strong>Vertical drag</strong> — ±1 rank
                  </li>
                  <li>
                    <strong>Tap</strong> — open album dossier
                  </li>
                </ul>
              </section>

              <section className="arv-help-panel">
                <h3 className="arv-help-heading">THE GRID</h3>
                <p className="arv-help-micro">Coordinate bay — archive map beneath the portal</p>
                <div className="arv-help-diagram-wrap arv-help-diagram-wrap--grid">
                  <HelpGridDiagram />
                </div>
                <ul className="arv-help-list">
                  <li>
                    <strong>Columns</strong> = years
                  </li>
                  <li>
                    <strong>Rows</strong> = Retroverse ranks
                  </li>
                  <li>
                    <strong>Tap a cell</strong> — tune to it; tap the active cell again — dossier
                  </li>
                  <li>
                    <strong>Bright / revealed cells</strong> — explored signal
                  </li>
                  <li>
                    <strong>Visited cells stay revealed</strong>
                  </li>
                </ul>
              </section>

              <div className="arv-help-tip">
                <p className="arv-help-tip-line">Explore freely. There are no wrong moves.</p>
                <p className="arv-help-tip-line arv-help-tip-line--accent">Follow the signal. Trust your curiosity.</p>
              </div>
            </div>

            <footer className="arv-help-actions" aria-label="Aux channels">
              <button
                type="button"
                className="arv-help-action arv-help-action--curator"
                disabled={!curatorHref}
                onClick={openOperatorCurator}
              >
                <span className="arv-help-action-title">Curator</span>
                <span className="arv-help-action-sub">Operator tools</span>
              </button>
              <button type="button" className="arv-help-action" disabled aria-disabled>
                <span className="arv-help-action-title">Artist mode</span>
                <span className="arv-help-action-sub">Coming soon</span>
              </button>
              <button type="button" className="arv-help-action" disabled aria-disabled>
                <span className="arv-help-action-title">Track mode</span>
                <span className="arv-help-action-sub">Coming soon</span>
              </button>
              <button type="button" className="arv-help-action" disabled aria-disabled>
                <span className="arv-help-action-title">Era mode</span>
                <span className="arv-help-action-sub">Coming soon</span>
              </button>
            </footer>
          </div>
        </div>
      ) : null}

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
            const vr0 = Number.isFinite(effectiveViewRank0) ? effectiveViewRank0 : 1;
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
