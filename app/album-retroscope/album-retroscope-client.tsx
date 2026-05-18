"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
} from "react";

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
import { retroscopeRankDisplayLabel, type RetroscopeMode } from "@/lib/retroscope-mode";
import { hrefForArtist, hrefForTrack } from "@/lib/retroverse-routes";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

import {
  artistSignalVars,
  cellNeighborhoodSuffix,
  HeroArtistSignal,
  HeroAlbumFocus,
  HeroTrackStub,
} from "./retroscope-hero";
import { RetroscopeMapOverlay } from "./retroscope-map-overlay";
import { RetroscopeModeStrip } from "./retroscope-mode-strip";
import { parseRetroscopeCoordKey, resolveRetroscopeBootstrap } from "@/lib/retroscope-bootstrap";
import {
  centerViewportOnSelection,
  clearRetroscopePersistedState,
  retroscopeViewportFocusIndices,
  saveRetroscopeExploredKeys,
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
  if (cell.entityKind === "artist") return null;
  if (RVAL_RE.test(cell.entityId)) {
    return `/portal-v2/curate?albumId=${encodeURIComponent(cell.entityId.toUpperCase())}`;
  }
  return "/internal/curator";
}

/** Entity dossier route (album or artist). */
function entityHrefForCell(cell: RetroscopeCellDTO | null, mode: RetroscopeMode): string | null {
  if (!cell) return null;
  if (mode === "artist" || cell.entityKind === "artist") {
    return hrefForArtist(cell.entityId, cell.title);
  }
  if (mode === "track" || cell.entityKind === "track") {
    if (cell.entityId && /^RVTR\d{6}$/i.test(cell.entityId)) {
      return hrefForTrack(cell.entityId);
    }
    const q = cell.title.trim();
    return q ? `/tracks?q=${encodeURIComponent(q)}` : null;
  }
  const rval = rvalFromCoverPath(cell.canonicalCoverPath);
  if (rval) return `/albums/${rval}`;
  if (RVAL_RE.test(cell.entityId)) return `/albums/${cell.entityId.toUpperCase()}`;
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

export type RetroscopeClientProps = {
  mode?: RetroscopeMode;
  cells: RetroscopeCellDTO[];
  initialActiveKey: string;
  corpusId: string;
};

export default function RetroscopeClient({
  mode = "album",
  cells,
  initialActiveKey,
  corpusId,
}: RetroscopeClientProps) {
  const persistScope = mode;
  const isArtistMode = mode === "artist";
  const isTrackMode = mode === "track";
  const byKey = useMemo(() => {
    const m = new Map<string, RetroscopeCellDTO>();
    for (const c of cells) {
      if (!c || typeof c.chartYear !== "number" || typeof c.retroverseRank !== "number") continue;
      m.set(retroscopeCellKey(c.chartYear, c.retroverseRank), c);
    }
    return m;
  }, [cells]);

  const visibleGridRows = useSyncExternalStore(
    subscribeRetroscopeViewportRows,
    snapshotRetroscopeGridRows,
    serverSnapshotRetroscopeGridRows,
  );

  const ssrInit = useMemo(() => parseRetroscopeCoordKey(initialActiveKey), [initialActiveKey]);

  const [activeYear, setActiveYear] = useState(ssrInit.y);
  const [activeRank, setActiveRank] = useState(ssrInit.r);
  const [explored, setExplored] = useState<Set<string>>(() =>
    new Set([retroscopeCellKey(ssrInit.y, ssrInit.r)]),
  );
  const [operatorFlash, setOperatorFlash] = useState(false);
  const [portalPulse, setPortalPulse] = useState(false);
  const [operatorPanelOpen, setOperatorPanelOpen] = useState(false);
  const [mapOpen, setMapOpen] = useState(false);
  const [mapResetEpoch, setMapResetEpoch] = useState(0);
  const router = useRouter();
  const [viewYear0, setViewYear0] = useState(() => {
    const rows = serverSnapshotRetroscopeGridRows();
    return centerViewportOnSelection({
      activeYear: ssrInit.y,
      activeRank: ssrInit.r,
      visibleGridRows: rows,
    }).viewYear0;
  });
  const [viewRank0, setViewRank0] = useState(() => {
    const rows = serverSnapshotRetroscopeGridRows();
    return centerViewportOnSelection({
      activeYear: ssrInit.y,
      activeRank: ssrInit.r,
      visibleGridRows: rows,
    }).viewRank0;
  });

  /** Keep viewport rank clamped when breakpoint row count shifts — avoids hydration mismatch vs SSR desktop rows. */
  const effectiveViewRank0 = useMemo(
    () => clamp(viewRank0, 1, RETROSCOPE_RANK_MAX - visibleGridRows + 1),
    [viewRank0, visibleGridRows],
  );

  const posRef = useRef({ y: ssrInit.y, r: ssrInit.r });
  const exploredRef = useRef(new Set<string>([retroscopeCellKey(ssrInit.y, ssrInit.r)]));
  const [bootstrapped, setBootstrapped] = useState(false);
  const restoreDoneRef = useRef(false);
  const persistSnapRef = useRef({
    corpusId: "",
    activeYear: ssrInit.y,
    activeRank: ssrInit.r,
    exploredKeys: [retroscopeCellKey(ssrInit.y, ssrInit.r)] as string[],
    viewYear0: RETROSCOPE_WORLD_YEAR_MIN,
    viewRank0: 1,
  });
  const swipeRef = useRef<{ x: number; y: number } | null>(null);
  const portalPulseTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* Bootstrap before first paint: coordinate UI stays hidden until persisted state is applied. */
  /* eslint-disable react-hooks/set-state-in-effect -- hydrate from persisted session */
  useLayoutEffect(() => {
    if (restoreDoneRef.current) {
      if (persistSnapRef.current.corpusId !== corpusId) {
        persistSnapRef.current.corpusId = corpusId;
        saveRetroscopePersistedSession(
          { version: 1, ...persistSnapRef.current, corpusId },
          persistScope,
        );
      }
      if (!bootstrapped) setBootstrapped(true);
      return;
    }

    const boot = resolveRetroscopeBootstrap({
      scope: persistScope,
      corpusId,
      cells,
      initialActiveKey,
      visibleGridRows: snapshotRetroscopeGridRows(),
    });

    const nextExplored = new Set(boot.exploredKeys);
    exploredRef.current = nextExplored;
    setExplored(nextExplored);
    posRef.current = { y: boot.activeYear, r: boot.activeRank };
    setActiveYear(boot.activeYear);
    setActiveRank(boot.activeRank);
    setViewYear0(boot.viewYear0);
    setViewRank0(boot.viewRank0);
    persistSnapRef.current = {
      corpusId,
      activeYear: boot.activeYear,
      activeRank: boot.activeRank,
      exploredKeys: boot.exploredKeys,
      viewYear0: boot.viewYear0,
      viewRank0: boot.viewRank0,
    };
    restoreDoneRef.current = true;
    setBootstrapped(true);
  }, [corpusId, persistScope, initialActiveKey, cells.length]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    exploredRef.current = explored;
  }, [explored]);

  useEffect(() => {
    if (!restoreDoneRef.current) return;
    const exploredKeys = [...exploredRef.current];
    persistSnapRef.current = {
      corpusId,
      activeYear,
      activeRank,
      exploredKeys,
      viewYear0,
      viewRank0,
    };
  }, [corpusId, activeYear, activeRank, viewYear0, viewRank0, explored]);

  useEffect(() => {
    const flushPersistFromRef = () => {
      const p = persistSnapRef.current;
      if (!restoreDoneRef.current || !p.corpusId) return;
      saveRetroscopePersistedSession(
        {
          version: 1,
          corpusId: p.corpusId,
          activeYear: p.activeYear,
          activeRank: p.activeRank,
          exploredKeys: p.exploredKeys,
          viewYear0: p.viewYear0,
          viewRank0: p.viewRank0,
        },
        persistScope,
      );
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
      saveRetroscopePersistedSession(
        {
          version: 1,
          corpusId: p.corpusId,
          activeYear: p.activeYear,
          activeRank: p.activeRank,
          exploredKeys: p.exploredKeys,
          viewYear0: p.viewYear0,
          viewRank0: p.viewRank0,
        },
        persistScope,
      );
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

  /** Re-lock center when mobile/desktop grid row count changes. */
  useEffect(() => {
    if (!bootstrapped) return;
    centerViewportOnActive(activeYear, activeRank);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only reflow on row-band change
  }, [visibleGridRows]);

  const activeKey = retroscopeCellKey(activeYear, activeRank);
  const activeCell = byKey.get(activeKey) ?? null;
  const viewportFocus = useMemo(
    () => retroscopeViewportFocusIndices(visibleGridRows),
    [visibleGridRows],
  );

  const curatorHref = useMemo(() => curatorHrefForCell(activeCell), [activeCell]);

  const flushRetroscopePersistNow = useCallback(() => {
    if (!restoreDoneRef.current) return;
    const exploredKeys = [...exploredRef.current];
    const snap = {
      corpusId,
      activeYear: posRef.current.y,
      activeRank: posRef.current.r,
      exploredKeys,
      viewYear0,
      viewRank0,
    };
    persistSnapRef.current = snap;
    saveRetroscopeExploredKeys(exploredKeys, persistScope);
    saveRetroscopePersistedSession(
      {
        version: 1,
        ...snap,
      },
      persistScope,
    );
  }, [corpusId, viewYear0, viewRank0, persistScope]);
  const centerViewportOnActive = useCallback(
    (ny: number, nr: number) => {
      const origin = centerViewportOnSelection({
        activeYear: ny,
        activeRank: nr,
        visibleGridRows,
      });
      setViewYear0(origin.viewYear0);
      setViewRank0(origin.viewRank0);
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
        exploredRef.current = n;
        if (restoreDoneRef.current) saveRetroscopeExploredKeys(n, persistScope);
        return n;
      });
      posRef.current = { y: ny, r: nr };
      setActiveYear(ny);
      setActiveRank(nr);
      centerViewportOnActive(ny, nr);
    },
    [centerViewportOnActive, persistScope],
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
        const href = entityHrefForCell(cell, mode);
        if (href) {
          flushRetroscopePersistNow();
          router.push(href);
        }
        return;
      }
      flashPortal();
      onPad(g);
    },
    [byKey, flashPortal, flushRetroscopePersistNow, mode, onPad, router],
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

  const onMapSelectCoordinate = useCallback(
    (ny: number, nr: number) => {
      const cur = retroscopeCellKey(posRef.current.y, posRef.current.r);
      setMapOpen(false);
      moveTo(ny, nr, cur);
    },
    [moveTo],
  );

  const onResetRetroscope = useCallback(() => {
    clearRetroscopePersistedState(persistScope);
    const init = parseRetroscopeCoordKey(initialActiveKey);
    const startKey = retroscopeCellKey(init.y, init.r);
    const nextExplored = new Set([startKey]);
    exploredRef.current = nextExplored;
    setExplored(nextExplored);
    posRef.current = { y: init.y, r: init.r };
    setActiveYear(init.y);
    setActiveRank(init.r);
    const origin = centerViewportOnSelection({
      activeYear: init.y,
      activeRank: init.r,
      visibleGridRows,
    });
    setViewYear0(origin.viewYear0);
    setViewRank0(origin.viewRank0);
    persistSnapRef.current = {
      corpusId,
      activeYear: init.y,
      activeRank: init.r,
      exploredKeys: [startKey],
      viewYear0: origin.viewYear0,
      viewRank0: origin.viewRank0,
    };
    saveRetroscopePersistedSession(
      { version: 1, ...persistSnapRef.current },
      persistScope,
    );
    setMapResetEpoch((n) => n + 1);
  }, [corpusId, initialActiveKey, persistScope, visibleGridRows]);

  const onCellTap = useCallback(
    (y: number, r: number) => {
      const k = retroscopeCellKey(y, r);
      const cur = retroscopeCellKey(posRef.current.y, posRef.current.r);
      if (k === cur) {
        const cell = byKey.get(k) ?? null;
        const href = entityHrefForCell(cell, mode);
        if (href) {
          flushRetroscopePersistNow();
          router.push(href);
        }
        return;
      }
      moveTo(y, r, cur);
    },
    [byKey, flushRetroscopePersistNow, mode, moveTo, router],
  );

  const searchHref =
    activeCell != null
      ? `/?q=${encodeURIComponent(`${activeCell.artist} ${activeCell.title}`.trim())}`
      : null;

  const cellCount = visibleGridRows * RETROSCOPE_GRID_COLS;

  const rankLabel = retroscopeRankDisplayLabel(activeRank, mode);

  return (
    <div
      className={`arv-machine${isArtistMode ? " arv-mode-artist" : ""}${isTrackMode ? " arv-mode-track" : ""}${operatorFlash ? " arv-machine--operator" : ""}${!bootstrapped ? " arv-machine--bootstrapping" : ""}`}
      style={isArtistMode && activeCell ? (artistSignalVars(activeCell) as CSSProperties) : undefined}
    >
      <div className="arv-device-face">
        <span className="arv-screw arv-screw--tl" aria-hidden />
        <span className="arv-screw arv-screw--tr" />
        <span className="arv-device-led arv-device-led--pwr" />
        <span className="arv-device-led arv-device-led--sig" />
        <span className="arv-device-brand">
          Retroscope
          <span className="arv-device-model">
            {isArtistMode ? "Artist" : isTrackMode ? "Track" : "2000"}
          </span>
        </span>
        <span className="arv-device-sub">
          <span className="arv-device-sub-line">
            {isArtistMode ? "Signal Field" : isTrackMode ? "Hot 100 Band" : "Solid State"}
          </span>
          <span className="arv-device-sub-line">
            {isArtistMode ? "Dominance Map" : isTrackMode ? "Scan Layer" : "Catalog Explorer"}
          </span>
        </span>
        <span className="arv-device-vents" />
        <span className="arv-screw arv-screw--bl" />
        <span className="arv-screw arv-screw--br" />
      </div>

      <Link href="/welcome" className="arv-back">
        Exit
      </Link>

      <section
        className={`arv-portal${isArtistMode ? " arv-portal--field" : ""}${isTrackMode ? " arv-portal--track" : ""}`}
        aria-label={isArtistMode ? "Artist signal field" : isTrackMode ? "Track scan field" : "Album portal"}
      >
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
            className={`arv-hero arv-hero--surface${isArtistMode ? " arv-hero--field" : ""}${portalPulse ? " arv-hero--pulse" : ""}`}
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
            {isArtistMode ? (
              <HeroArtistSignal key={activeKey} cell={activeCell} />
            ) : isTrackMode ? (
              <HeroTrackStub key={activeKey} cell={activeCell} />
            ) : (
              <HeroAlbumFocus key={activeKey} cell={activeCell} />
            )}
            {isTrackMode ? <span className="arv-portal-glass" aria-hidden /> : null}
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
                    <strong>Tap</strong> — {isArtistMode ? "open artist profile" : "open album dossier"}
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
              {isArtistMode ? (
                <Link href="/album-retroscope" className="arv-help-action">
                  <span className="arv-help-action-title">Album mode</span>
                  <span className="arv-help-action-sub">Chart albums</span>
                </Link>
              ) : (
                <Link href="/artist-retroscope" className="arv-help-action">
                  <span className="arv-help-action-title">Artist mode</span>
                  <span className="arv-help-action-sub">Year dominance</span>
                </Link>
              )}
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
              <p className="arv-title-line">
                {isArtistMode ? activeCell.title : `${activeCell.artist} — ${activeCell.title}`}
                {searchHref && !isArtistMode && !isTrackMode ? (
                  <>
                    {" "}
                    <Link href={searchHref} className="arv-meta-link arv-meta-link--inline">
                      search
                    </Link>
                  </>
                ) : null}
              </p>
              {isTrackMode ? (
                <p className="arv-meta-artist-detail">Track layer placeholder · search or scan</p>
              ) : null}
            </>
          ) : (
            <p className="arv-title-line opacity-70">Off corpus · keep moving</p>
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
          Layer
        </span>
        <RetroscopeModeStrip
          active={mode}
          mapOpen={mapOpen}
          variant="deck"
          onMapOpen={() => setMapOpen((v) => !v)}
        />

        <div className="arv-readout arv-readout--rank">
          <span className="arv-readout-lamp" aria-hidden />
          <span className="arv-readout-dot" aria-hidden />
          <div className="arv-readout-label">Rank</div>
          <div className="arv-readout-value">{rankLabel}</div>
        </div>
      </section>

      <section
        className="arv-viewport"
        aria-label="Exploration viewport"
        style={
          {
            "--arv-focus-col": viewportFocus.yearCol,
            "--arv-focus-row": viewportFocus.rankRow,
            "--arv-grid-rows": visibleGridRows,
          } as CSSProperties
        }
      >
        <span className="arv-viewport-label" aria-hidden>
          Coordinate Bay
        </span>
        <span className="arv-viewport-reticle" aria-hidden />
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
            const slotY = vy0 + col;
            const slotR = vr0 + row;
            const isFocusSlot =
              col === viewportFocus.yearCol && row === viewportFocus.rankRow;
            /** Center lock: playhead stays on focus slot; world coords scroll underneath. */
            const y = isFocusSlot ? activeYear : slotY;
            const r = isFocusSlot ? activeRank : slotR;
            const k = retroscopeCellKey(y, r);
            const cell = byKey.get(k) ?? null;
            const isActive = isFocusSlot;
            const isExplored = explored.has(k);
            const isVoid = !cell;

            let stateClass = "arv-cell--unexplored";
            if (isActive) stateClass = "arv-cell--active";
            else if (isExplored) stateClass = "arv-cell--explored";

            const thumb =
              !isArtistMode && cell
                ? canonicalCoverPathToUrl(cell.canonicalCoverPath, {
                    cacheBust: cell.canonicalCoverCacheBust ?? null,
                  })
                : null;
            const rankMeta = retroscopeRankDisplayLabel(r, mode);
            const nearSuffix =
              isArtistMode && !isVoid ? cellNeighborhoodSuffix(activeYear, activeRank, y, r) : "";

            return (
              <button
                key={`${col}:${row}`}
                type="button"
                role="gridcell"
                aria-current={isActive ? "true" : undefined}
                aria-label={
                  cell
                    ? `${cell.title}, ${y}, rank ${rankMeta}`
                    : `Empty coordinate ${y} rank ${r}`
                }
                className={`arv-cell ${stateClass} ${isVoid ? "arv-cell--void" : ""}${isArtistMode && cell ? " arv-cell--artist" : ""}${isTrackMode && cell ? " arv-cell--track" : ""}${nearSuffix}`}
                onClick={() => onCellTap(y, r)}
                style={isArtistMode && cell ? (artistSignalVars(cell) as CSSProperties) : undefined}
              >
                <div className="arv-cell-inner">
                  {isExplored && !isVoid ? <span className="arv-cell-reveal" aria-hidden /> : null}
                  {isArtistMode && cell ? (
                    <>
                      <span className="arv-cell-glyph" aria-hidden />
                      <span className="arv-cell-artist-name">{cell.title}</span>
                    </>
                  ) : isTrackMode && cell ? (
                    <>
                      <span className="arv-cell-track-bar" aria-hidden />
                      <span className="arv-cell-artist-name">{cell.title}</span>
                    </>
                  ) : thumb ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={thumb} alt="" className="arv-cell-thumb" draggable={false} loading="lazy" />
                  ) : null}
                  {!isVoid && !isExplored && !isActive ? (
                    <span className="arv-cell-mask" aria-hidden />
                  ) : null}
                  <span className="arv-cell-meta">
                    {y}
                    <br />
                    {rankMeta}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {mapOpen && bootstrapped ? (
        <RetroscopeMapOverlay
          mode={mode}
          activeYear={activeYear}
          activeRank={activeRank}
          activeKey={activeKey}
          explored={explored}
          byKey={byKey}
          resetEpoch={mapResetEpoch}
          onClose={() => setMapOpen(false)}
          onSelectCoordinate={onMapSelectCoordinate}
          onResetApp={onResetRetroscope}
        />
      ) : null}
    </div>
  );
}
