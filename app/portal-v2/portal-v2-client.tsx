"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import { CURATOR_LONG_PRESS_MS, CURATOR_MOVE_CANCEL_PX } from "@/app/components/album-curator-repair";
import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import {
  clampRankIndex,
  loadPortalRankSession,
  portalAppearanceKey,
  savePortalRankSession,
  type PortalRankSessionV1,
} from "@/lib/portal-rank-session";
import { artistRoute } from "@/lib/retroverse-routes";
import type { ViewerBootstrap, ViewerYearAlbumEntry } from "@/lib/viewer-scope";

import PortalV2CurateClient from "./curate/portal-v2-curate-client";

const ACTIVATION_PX = 42;
const AXIS_COMMIT_PX = 12;
/** px/ms threshold for inertia commit */
const FLING_V_THRESHOLD = 0.42;
const EDGE_RUBBER = 0.24;
/** Max samples retained for flick velocity estimates */
const VMAX_SAMPLES = 10;

function CoverImg({
  canonicalCoverPath,
  alt,
  fetchPriority,
  cacheBust,
}: {
  canonicalCoverPath: string | null;
  alt: string;
  fetchPriority?: "high" | "low" | "auto";
  cacheBust?: number | string | null;
}) {
  const [broken, setBroken] = useState(false);
  /**
   * `cacheBust` is set by the parent after a successful curator save (savedAt epoch),
   * appended as `?v=<ts>` so the browser/CDN refetch the canonical R2 object even
   * though the storage key is unchanged.
   */
  const url = !broken
    ? canonicalCoverPathToUrl(canonicalCoverPath, cacheBust ? { cacheBust } : undefined)
    : null;
  if (!url) {
    return (
      <div
        className="h-full w-full bg-[radial-gradient(circle_at_40%_38%,rgba(200,169,107,0.12),transparent_55%),linear-gradient(165deg,#08111d,#05070b)]"
        aria-hidden
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={url}
      alt={alt}
      className="pointer-events-none h-full w-full object-cover object-center select-none [-webkit-touch-callout:none]"
      draggable={false}
      loading="eager"
      decoding="async"
      fetchPriority={fetchPriority}
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onError={() => setBroken(true)}
    />
  );
}

function mergeRows(prev: Map<string, DiscoverStableAlbumRow>, rows: DiscoverStableAlbumRow[]) {
  if (rows.length === 0) return prev;
  const next = new Map(prev);
  for (const row of rows) {
    if (row.kind === "album") next.set(row.albumId, row);
  }
  return next;
}

async function hydrateRemote(ids: string[], opts?: { fresh?: boolean }): Promise<DiscoverStableAlbumRow[]> {
  const res = await fetch("/api/viewer/hydrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids, ...(opts?.fresh ? { fresh: true } : {}) }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { rows?: DiscoverStableAlbumRow[] };
  return body.rows ?? [];
}

async function fetchYearAlbumEntries(year: number): Promise<ViewerYearAlbumEntry[]> {
  const res = await fetch(`/api/viewer/year-albums?year=${encodeURIComponent(String(year))}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { entries?: ViewerYearAlbumEntry[]; ids?: string[] };
  if (Array.isArray(body.entries)) return body.entries;
  if (Array.isArray(body.ids)) {
    return body.ids.map((albumId, i) => ({
      albumId,
      displayRank: i + 1,
      peakChartPosition: null,
      weeksOnChart: null,
    }));
  }
  return [];
}

type MotionSample = { t: number; x: number; y: number };

function axisVelocity(samples: MotionSample[], axis: "h" | "v"): number {
  if (samples.length < 2) return 0;
  const a = samples[0]!;
  const b = samples[samples.length - 1]!;
  const dt = b.t - a.t;
  if (dt <= 0.5) return 0;
  return axis === "v" ? (b.y - a.y) / dt : (b.x - a.x) / dt;
}

export default function PortalV2Client({ bootstrap }: { bootstrap: ViewerBootstrap }) {
  const { years } = bootstrap;
  const bootstrapYearIdxRaw = years.indexOf(bootstrap.year);
  const bootstrapYearIdx = bootstrapYearIdxRaw >= 0 ? bootstrapYearIdxRaw : 0;

  const idsByYearRef = useRef<Map<number, ViewerYearAlbumEntry[]>>(new Map([[bootstrap.year, [...bootstrap.entries]]]));
  /** Filled client-side only (`loadPortalRankSession`). Must stay null during SSR/first hydration render. */
  const restoreRef = useRef<PortalRankSessionV1 | null>(null);
  const hasAppliedRestoreRef = useRef(false);
  const prevIdsYearRef = useRef(bootstrap.year);

  const cacheRef = useRef<Map<string, DiscoverStableAlbumRow>>(new Map());

  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);
  const gestureAxisRef = useRef<null | "h" | "v">(null);
  const gesturePointerIdRef = useRef<number | null>(null);
  const swipeSuppressClickRef = useRef(false);
  const curatorSwipeCancelRef = useRef<(() => void) | null>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressConsumedNavRef = useRef(false);

  const surfaceRef = useRef<HTMLDivElement | null>(null);
  const motionSamplesRef = useRef<MotionSample[]>([]);

  const yearEntriesRef = useRef<ViewerYearAlbumEntry[]>(bootstrap.entries);

  /** Mirrors session length — initial 0 avoids SSR/client mismatch until session is loaded. */
  const [exploredCount, setExploredCount] = useState(0);
  /** When false, omit localStorage-derived explored copy so server and client markup match on first paint. */
  const [portalClientReady, setPortalClientReady] = useState(false);

  const [yearIdx, setYearIdx] = useState(bootstrapYearIdx);
  const [yearEntries, setYearEntries] = useState<ViewerYearAlbumEntry[]>(() => [...bootstrap.entries]);
  const [idsYear, setIdsYear] = useState(bootstrap.year);
  const [albumIdx, setAlbumIdx] = useState(0);

  const yearIdxRef = useRef(yearIdx);
  yearIdxRef.current = yearIdx;

  const albumIdxRef = useRef(albumIdx);
  albumIdxRef.current = albumIdx;

  const [menuOpen, setMenuOpen] = useState(false);
  const [curatorRow, setCuratorRow] = useState<DiscoverStableAlbumRow | null>(null);

  const displayCalendarYear =
    typeof years[yearIdx] === "number" && Number.isFinite(years[yearIdx]) ? years[yearIdx]! : idsYear;
  const ranksSynced = idsYear === displayCalendarYear;
  const rankTier = ranksSynced ? yearEntries : [];

  const ranksSyncedRef = useRef(ranksSynced);
  ranksSyncedRef.current = ranksSynced;

  yearEntriesRef.current = rankTier;

  const [cache, setCache] = useState<Map<string, DiscoverStableAlbumRow>>(() => {
    const m = new Map<string, DiscoverStableAlbumRow>();
    for (const row of bootstrap.hydrated) {
      if (row.kind === "album") m.set(row.albumId, row);
    }
    cacheRef.current = m;
    return m;
  });

  /**
   * Per-album cache-bust token (savedAt epoch ms) set by the curator after a
   * successful save. Forces the canonical R2 image URL to refetch even though
   * the object key is stable. Never persisted — purely in-memory for this tab.
   */
  const [coverBustByAlbumId, setCoverBustByAlbumId] = useState<Map<string, number>>(() => new Map());

  const mergeRowsCached = useCallback((rows: DiscoverStableAlbumRow[]) => {
    setCache((prev) => {
      const next = mergeRows(prev, rows);
      cacheRef.current = next;
      return next;
    });
  }, []);

  /**
   * Called by `PortalV2CurateClient` when "Use this cover" succeeds. Patches the
   * row cache so the hero re-renders against the new canonical path immediately,
   * stamps a per-album cache-bust token, and asks Next to refresh the server
   * tree (revalidateTag has already invalidated `artwork:<id>`).
   */
  const applyCuratorSave = useCallback(
    ({ albumId, canonicalCoverPath, savedAt }: { albumId: string; canonicalCoverPath: string | null; savedAt: number }) => {
      setCache((prev) => {
        const existing = prev.get(albumId);
        if (!existing || existing.kind !== "album") return prev;
        const next = new Map(prev);
        next.set(albumId, {
          ...existing,
          canonicalCoverPath,
          canonicalCoverCacheBust: String(savedAt),
        });
        cacheRef.current = next;
        return next;
      });
      setCoverBustByAlbumId((prev) => {
        const next = new Map(prev);
        next.set(albumId, savedAt);
        return next;
      });
    },
    [],
  );

  const ensureHydrated = useCallback(
    async (idsNeeding: string[]) => {
      const need = [...new Set(idsNeeding.filter(Boolean).filter((id) => !cacheRef.current.has(id)))];
      if (need.length === 0) return;
      const rows = await hydrateRemote(need);
      mergeRowsCached(rows);
    },
    [mergeRowsCached],
  );

  /** Preload neighbouring chart years while viewing (rank list + thumbnails). */
  useEffect(() => {
    function preloadEntries(entries: ViewerYearAlbumEntry[]) {
      const ids: string[] = [];
      const n = entries.length;
      for (let j = 0; j < Math.min(8, n); j++) {
        const id = entries[j]?.albumId;
        if (id) ids.push(id);
      }
      for (let j = Math.max(0, n - 8); j < n; j++) {
        const id = entries[j]?.albumId;
        if (id) ids.push(id);
      }
      void ensureHydrated([...new Set(ids)]);
    }

    async function warmup(ai: number) {
      const y = years[ai];
      if (typeof y !== "number") return;
      const cached = idsByYearRef.current.get(y);
      if (cached) {
        preloadEntries(cached);
        return;
      }
      try {
        const next = await fetchYearAlbumEntries(y);
        idsByYearRef.current.set(y, next);
        preloadEntries(next);
      } catch {
        /* idle prefetch */
      }
    }

    void warmup(yearIdx + 1);
    void warmup(yearIdx - 1);
  }, [yearIdx, years, ensureHydrated]);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  useLayoutEffect(() => {
    const r = loadPortalRankSession();
    restoreRef.current = r;
    setExploredCount(r?.appearanceKeys.length ?? 0);
    if (!r || years.length === 0) return;
    const yi = years.indexOf(r.lastYear);
    if (yi < 0) return;
    setYearIdx(yi);
  }, [years]);

  useEffect(() => {
    setPortalClientReady(true);
  }, []);

  useEffect(() => {
    curatorSwipeCancelRef.current = () => {
      clearLongPressTimer();
      longPressStartRef.current = null;
      longPressConsumedNavRef.current = false;
    };
    return () => {
      curatorSwipeCancelRef.current = null;
    };
  }, []);

  /** Closing curator/backdrop dismiss: release stage pointer capture and clear surface transform. */
  useEffect(() => {
    if (curatorRow) return;
    clearLongPressTimer();
    longPressStartRef.current = null;
    longPressConsumedNavRef.current = false;
    finalizeCoverStageMotion();
  }, [curatorRow]);

  /** Year list + rank restore / year-change index rules. */
  useEffect(() => {
    const target = typeof years[yearIdx] === "number" ? years[yearIdx]! : null;
    if (target === null || yearEntries.length === 0) return;
    if (idsYear !== target) return;

    if (!hasAppliedRestoreRef.current) {
      const r = restoreRef.current;
      if (r && r.lastYear === idsYear) {
        setAlbumIdx(clampRankIndex(r.lastRankIndex, yearEntries.length));
      }
      hasAppliedRestoreRef.current = true;
      prevIdsYearRef.current = idsYear;
      return;
    }
    if (prevIdsYearRef.current !== idsYear) {
      prevIdsYearRef.current = idsYear;
      setAlbumIdx(0);
    }
  }, [yearEntries, idsYear, years, yearIdx]);

  useEffect(() => {
    const y = years[yearIdx];
    if (typeof y !== "number") return;

    const cached = idsByYearRef.current.get(y);
    if (cached) {
      setYearEntries(cached);
      setIdsYear(y);
      return;
    }

    let cancelled = false;
    void (async () => {
      const next = await fetchYearAlbumEntries(y);
      if (cancelled) return;
      idsByYearRef.current.set(y, next);
      setYearEntries(next);
      setIdsYear(y);
    })();

    return () => {
      cancelled = true;
    };
  }, [yearIdx, years]);

  useEffect(() => {
    if (!ranksSynced) return;
    const slot = rankTier[albumIdx];
    const id = slot?.albumId ?? null;
    if (!id) return;

    const prior = loadPortalRankSession();
    const keys = [...(prior?.appearanceKeys ?? [])];
    const k = portalAppearanceKey(idsYear, id);
    if (!keys.includes(k)) keys.push(k);

    savePortalRankSession({
      lastYear: idsYear,
      lastRankIndex: albumIdx,
      appearanceKeys: keys,
    });
    setExploredCount(keys.length);
  }, [ranksSynced, idsYear, albumIdx, rankTier]);

  useEffect(() => {
    if (!ranksSynced || rankTier.length === 0) return;
    setAlbumIdx((i) => clampRankIndex(i, rankTier.length));
  }, [rankTier.length, idsYear, ranksSynced]);

  useEffect(() => {
    if (!ranksSynced) return;
    const need: string[] = [];
    for (const offset of [-2, -1, 0, 1, 2]) {
      const e = rankTier[albumIdx + offset];
      if (e?.albumId) need.push(e.albumId);
    }
    void ensureHydrated(need);
  }, [ranksSynced, rankTier, albumIdx, ensureHydrated]);

  const centeredSlot = rankTier[albumIdx];
  const centeredAlbumId = centeredSlot?.albumId ?? null;

  const heroRow =
    centeredAlbumId && cache.has(centeredAlbumId)
      ? (cache.get(centeredAlbumId) as DiscoverStableAlbumRow | undefined) ?? null
      : null;

  const heroRowLiveRef = useRef(heroRow);
  heroRowLiveRef.current = heroRow;

  const centeredAlbumLiveRef = useRef(centeredAlbumId);
  centeredAlbumLiveRef.current = centeredAlbumId;

  function dominantAxis(dx: number, dy: number): "h" | "v" {
    return Math.abs(dy) > Math.abs(dx) ? "v" : "h";
  }

  function stepYear(direction: -1 | 1) {
    setYearIdx((yi) => Math.min(years.length - 1, Math.max(0, yi + direction)));
  }

  function stepAlbum(direction: -1 | 1) {
    setAlbumIdx((i) => clampRankIndex(i + direction, yearEntriesRef.current.length));
  }

  function resetGesture(target: HTMLElement | null, pid: number | null) {
    gestureStartRef.current = null;
    gestureAxisRef.current = null;
    gesturePointerIdRef.current = null;
    motionSamplesRef.current = [];
    if (!target || pid == null) return;
    try {
      target.releasePointerCapture(pid);
    } catch {
      /* no-op */
    }
  }

  /** Drop inline translate/transition from swipe surface (prevents cover “stuck” offset + subpixel shrink). */
  function finalizeCoverStageMotion() {
    const surf = surfaceRef.current;
    const stage = surf?.closest(".pv2-device-stage") as HTMLDivElement | null;
    const pid = gesturePointerIdRef.current;
    resetGesture(stage, pid);
    if (!surf) return;
    surf.style.transition = "none";
    surf.style.transform = "translate3d(0,0,0)";
    requestAnimationFrame(() => {
      surf.style.removeProperty("transform");
      surf.style.removeProperty("transition");
    });
  }

  function freezeSurfaceImmediate() {
    const el = surfaceRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = "translate3d(0,0,0)";
  }

  function applySurfacePx(x: number, y: number) {
    const el = surfaceRef.current;
    if (!el) return;
    el.style.transition = "none";
    el.style.transform = `translate3d(${x}px,${y}px,0)`;
  }

  function springSurfaceHome() {
    const el = surfaceRef.current;
    if (!el) return;
    el.style.transition =
      typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches
        ? "transform 220ms linear"
        : "transform 480ms cubic-bezier(0.32, 1.24, 0.58, 1)";
    el.style.transform = "translate3d(0,0,0)";
  }

  /** Rubber-band drag when navigating past corpus edges */
  function projectDrag(dx: number, dy: number, locked: "h" | "v"): [number, number] {
    const yi = yearIdxRef.current;
    const tiers = yearEntriesRef.current;
    const n = tiers.length;
    const ai = n > 0 ? clampRankIndex(albumIdxRef.current, Math.max(n - 1, 0)) : 0;

    if (locked === "v") {
      let oy = dy;
      const atFirstRank = ai <= 0;
      const lastIdx = Math.max(n - 1, 0);
      const atLastRank = ai >= lastIdx || n <= 1;
      if (atFirstRank && oy > 0) oy *= EDGE_RUBBER;
      if (atLastRank && oy < 0) oy *= EDGE_RUBBER;
      return [0, oy];
    }

    let ox = dx;
    const atYearFirst = yi <= 0;
    const ym = Math.max(years.length - 1, 0);
    const atYearLast = yi >= ym;
    if (atYearFirst && ox > 0) ox *= EDGE_RUBBER;
    if (atYearLast && ox < 0) ox *= EDGE_RUBBER;
    return [ox, 0];
  }

  function onStagePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipeSuppressClickRef.current = false;
    gesturePointerIdRef.current = e.pointerId;
    gestureStartRef.current = { x: e.clientX, y: e.clientY };
    gestureAxisRef.current = null;
    motionSamplesRef.current = [{ t: performance.now(), x: e.clientX, y: e.clientY }];
    const el = surfaceRef.current;
    if (el) el.style.transition = "none";
  }

  function onStagePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (gesturePointerIdRef.current !== e.pointerId || !gestureStartRef.current) return;
    const s = gestureStartRef.current;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;

    const samp = motionSamplesRef.current;
    samp.push({ t: performance.now(), x: e.clientX, y: e.clientY });
    if (samp.length > VMAX_SAMPLES) samp.shift();

    if (dx * dx + dy * dy >= CURATOR_MOVE_CANCEL_PX * CURATOR_MOVE_CANCEL_PX) {
      curatorSwipeCancelRef.current?.();
    }

    if (gestureAxisRef.current === null && dx * dx + dy * dy >= AXIS_COMMIT_PX * AXIS_COMMIT_PX) {
      gestureAxisRef.current = dominantAxis(dx, dy);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* optional — Safari quirks */
      }
    }

    if (Math.abs(dx) > 14 || Math.abs(dy) > 14) swipeSuppressClickRef.current = true;

    const ax = gestureAxisRef.current;
    if (ax) {
      const [px, py] = projectDrag(dx, dy, ax);
      applySurfacePx(px, py);
    }
  }

  function onStagePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (gesturePointerIdRef.current !== e.pointerId) return;

    const samp = [...motionSamplesRef.current];
    const start = gestureStartRef.current;
    const lockedDuringStroke = gestureAxisRef.current;
    const target = e.currentTarget as HTMLDivElement;
    resetGesture(target, e.pointerId);

    if (!start || !ranksSyncedRef.current || yearEntriesRef.current.length === 0) {
      freezeSurfaceImmediate();
      return;
    }

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    const axis =
      lockedDuringStroke ??
      (Math.max(adx, ady) >= ACTIVATION_PX ? dominantAxis(dx, dy) : null);

    if (axis === null) {
      springSurfaceHome();
      return;
    }

    const v = axisVelocity(samp, axis);

    let navigated = false;

    if (axis === "h") {
      if (adx >= ACTIVATION_PX || (adx >= 28 && Math.abs(v) >= FLING_V_THRESHOLD)) {
        if (dx > 0 && yearIdxRef.current > 0) {
          stepYear(-1);
          navigated = true;
        } else if (dx < 0 && yearIdxRef.current < Math.max(years.length - 1, 0)) {
          stepYear(1);
          navigated = true;
        }
      }
    } else if (axis === "v") {
      if (ady >= ACTIVATION_PX || (ady >= 28 && Math.abs(v) >= FLING_V_THRESHOLD)) {
        const tiers = yearEntriesRef.current;
        const last = Math.max(tiers.length - 1, 0);
        if ((dy < 0 || v < -FLING_V_THRESHOLD) && albumIdxRef.current < last) {
          stepAlbum(1);
          navigated = true;
        } else if ((dy > 0 || v > FLING_V_THRESHOLD) && albumIdxRef.current > 0) {
          stepAlbum(-1);
          navigated = true;
        }
      }
    }

    if (navigated) {
      freezeSurfaceImmediate();
      swipeSuppressClickRef.current = true;
    } else {
      springSurfaceHome();
    }
  }

  function onStagePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (gesturePointerIdRef.current !== e.pointerId) return;
    resetGesture(e.currentTarget as HTMLDivElement, e.pointerId);
    springSurfaceHome();
  }

  async function openCuratorForCurrentAlbum() {
    const id = centeredAlbumLiveRef.current;
    if (!id) return;
    finalizeCoverStageMotion();

    const rows = await hydrateRemote([id], { fresh: true });
    mergeRowsCached(rows);
    const row = rows.find((r) => r.kind === "album" && r.albumId === id) ?? null;
    /* Fallback only if hydrate returned nothing — never prefer stale bootstrap for curator IDs. */
    const resolved =
      row ??
      (heroRowLiveRef.current?.kind === "album" && heroRowLiveRef.current.albumId === id
        ? heroRowLiveRef.current
        : null);
    if (resolved?.kind === "album") setCuratorRow(resolved);
  }

  function onCoverPointerDown(e: React.PointerEvent) {
    if (!centeredAlbumLiveRef.current) return;
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    longPressConsumedNavRef.current = false;
    longPressStartRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressConsumedNavRef.current = true;
      void openCuratorForCurrentAlbum();
    }, CURATOR_LONG_PRESS_MS);
  }

  function onCoverPointerMove(e: React.PointerEvent) {
    if (!longPressStartRef.current || longPressTimerRef.current === null) return;
    const s = longPressStartRef.current;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (dx * dx + dy * dy > CURATOR_MOVE_CANCEL_PX * CURATOR_MOVE_CANCEL_PX) {
      clearLongPressTimer();
      longPressStartRef.current = null;
    }
  }

  function onCoverPointerEnd() {
    clearLongPressTimer();
    longPressStartRef.current = null;
  }

  function onCoverClickCapture(e: React.MouseEvent) {
    if (longPressConsumedNavRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressConsumedNavRef.current = false;
    }
  }

  useEffect(() => {
    function onDocKey(ev: KeyboardEvent) {
      if (ev.repeat) return;
      if (ev.key === "Escape") {
        if (curatorRow) setCuratorRow(null);
        else setMenuOpen(false);
        return;
      }
      const tg = ev.target;
      if (tg instanceof HTMLElement) {
        if (tg.isContentEditable) return;
        const tag = tg.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return;
      }
      if (curatorRow) return;

      const yearsLen = years.length;
      const tiersLen = yearEntriesRef.current.length;
      if (!ranksSyncedRef.current || tiersLen === 0 || yearsLen === 0) return;

      const k = ev.key;
      if (k !== "ArrowUp" && k !== "ArrowDown" && k !== "ArrowLeft" && k !== "ArrowRight") return;
      ev.preventDefault();

      if (k === "ArrowLeft") {
        stepYear(1);
        freezeSurfaceImmediate();
        return;
      }
      if (k === "ArrowRight") {
        stepYear(-1);
        freezeSurfaceImmediate();
        return;
      }
      if (k === "ArrowUp") {
        stepAlbum(1);
        freezeSurfaceImmediate();
        return;
      }
      stepAlbum(-1);
      freezeSurfaceImmediate();
    }
    window.addEventListener("keydown", onDocKey);
    return () => window.removeEventListener("keydown", onDocKey);
  }, [years.length, curatorRow]);

  if (years.length === 0) {
    return (
      <div className="pv2-device-column flex flex-1 items-center justify-center py-16 text-[var(--pv2-muted,#8f8574)]">
        No years in corpus.
      </div>
    );
  }

  if (!ranksSynced) {
    return (
      <div className="pv2-device-column flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="pv2-device-yearline" aria-live="polite">
          {displayCalendarYear}
        </p>
        <div className="h-px w-12 bg-[rgba(205,164,90,.25)]" aria-hidden />
        <p className="text-[13px] leading-relaxed text-[var(--pv2-muted,#8f8574)]">Loading ranks…</p>
      </div>
    );
  }

  if (rankTier.length === 0 || !centeredAlbumId) {
    return (
      <div className="pv2-device-column flex flex-1 flex-col items-center justify-center gap-3 py-12 text-center">
        <p className="font-[family-name:var(--font-pv2-display)] max-w-[22rem] text-lg text-[var(--pv2-soft,#c9bda7)]">
          · {displayCalendarYear} ·
        </p>
        <div className="h-px w-12 bg-[rgba(205,164,90,.25)]" aria-hidden />
        <p className="text-[13px] leading-relaxed text-[var(--pv2-muted,#8f8574)]">No albums for this year yet.</p>
      </div>
    );
  }

  const displayRank = centeredSlot.displayRank;

  const title = heroRow?.kind === "album" ? heroRow.title : "";
  const artist = heroRow?.kind === "album" ? heroRow.artist || "" : "";
  const coverPath = heroRow?.kind === "album" ? heroRow.canonicalCoverPath : null;
  const heroHref = `/albums/${centeredAlbumId}`;

  return (
    <div tabIndex={0} className="flex min-h-0 flex-1 flex-col outline-none" aria-label="Retroverse Portal — swipe to change rank or year.">
      {menuOpen ? (
        <div id="retroverse-device-menu-dialog" className="pv2-device-menu-sheet" role="dialog" aria-modal="true" aria-label="Archive menu">
          <button
            type="button"
            className="pv2-device-menu-backdrop"
            aria-label="Dismiss menu"
            onClick={() => setMenuOpen(false)}
          />
          <div className="pv2-device-menu-inner shadow-[0_-12px_40px_rgba(0,0,0,0.55)]">
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.22em] text-[rgba(205,164,90,0.75)]">
              Navigate
            </p>
            <div className="grid gap-2 text-center font-[family-name:var(--font-pv2-sans)]">
              <Link
                href="/eras"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl border border-[rgba(205,164,90,0.18)] bg-[rgba(255,255,255,0.03)] px-4 py-3.5 text-[15px] text-[#ede4d6] no-underline"
              >
                Eras
              </Link>
              <Link
                href="/albums"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl border border-[rgba(205,164,90,0.18)] bg-[rgba(255,255,255,0.03)] px-4 py-3.5 text-[15px] text-[#ede4d6] no-underline"
              >
                Albums
              </Link>
              <Link
                href="/artists"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl border border-[rgba(205,164,90,0.18)] bg-[rgba(255,255,255,0.03)] px-4 py-3.5 text-[15px] text-[#ede4d6] no-underline"
              >
                Artists
              </Link>
              <Link
                href="/search"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl border border-[rgba(205,164,90,0.18)] bg-[rgba(255,255,255,0.03)] px-4 py-3.5 text-[15px] text-[#ede4d6] no-underline"
              >
                Search
              </Link>
              <Link
                href="/site-index"
                onClick={() => setMenuOpen(false)}
                className="rounded-xl border border-[rgba(205,164,90,0.18)] bg-[rgba(255,255,255,0.03)] px-4 py-3.5 text-[15px] text-[#ede4d6] no-underline"
              >
                Index
              </Link>
              <button
                type="button"
                className="mt-1 rounded-full border border-transparent py-3 text-[14px] font-medium uppercase tracking-[0.18em] text-[#8f8574]"
                onClick={() => setMenuOpen(false)}
              >
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {curatorRow && curatorRow.kind === "album" ? (
        <div className="pv2-curator-overlay" role="dialog" aria-modal="true" aria-label="Curator">
          <button
            type="button"
            className="absolute inset-0 z-0 cursor-default border-0 bg-transparent p-0"
            aria-label="Dismiss curator backdrop"
            onClick={() => setCuratorRow(null)}
          />
          <div className="pv2-curator-sheet shadow-[0_-20px_64px_rgba(0,0,0,0.65)]">
            <PortalV2CurateClient
              key={curatorRow.albumId}
              presentation="overlay"
              row={curatorRow}
              onDismiss={() => setCuratorRow(null)}
              onSaved={applyCuratorSave}
            />
          </div>
        </div>
      ) : null}

      <div
        role="presentation"
        className="pv2-device-stage flex min-h-0 flex-1 touch-none flex-col overscroll-none"
        onPointerDown={onStagePointerDown}
        onPointerMove={onStagePointerMove}
        onPointerUp={onStagePointerUp}
        onPointerCancel={onStagePointerCancel}
      >
        <div className="pv2-device-column">
          <header className="pv2-device-masthead">
            <p className="pv2-device-wordmark">Retroverse</p>
            <button
              type="button"
              aria-expanded={menuOpen}
              aria-controls="retroverse-device-menu-dialog"
              className="pv2-device-menu-btn"
              aria-label="Open Retroverse archive menu"
              onClick={() => setMenuOpen(true)}
            >
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden stroke="currentColor" strokeWidth="1.75">
                <path d="M5 8h14M5 12h14M5 16h14" strokeLinecap="round" />
              </svg>
            </button>
          </header>

          <div ref={surfaceRef} className="pv2-surface-drag flex min-h-0 flex-1 flex-col justify-center">
            <div className="pv2-device-frame-slot w-full">
              <div
                onPointerDown={onCoverPointerDown}
                onPointerMove={onCoverPointerMove}
                onPointerUp={onCoverPointerEnd}
                onPointerCancel={onCoverPointerEnd}
                onPointerLeave={onCoverPointerEnd}
                onClickCapture={onCoverClickCapture}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  void openCuratorForCurrentAlbum();
                }}
                role="presentation"
                className="mx-auto block w-full max-w-[96vw] select-none [-webkit-touch-callout:none]"
              >
                <div className="pv2-proto-frame mx-auto box-border">
                  <Link
                    href={heroHref}
                    aria-label={title ? `Open album details: ${title}` : "Open album details"}
                    className="block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-[4px] focus-visible:outline-[rgba(205,164,90,.55)]"
                    onClick={(evt) => {
                      if (swipeSuppressClickRef.current) {
                        evt.preventDefault();
                        swipeSuppressClickRef.current = false;
                      }
                    }}
                  >
                    <div key={centeredAlbumId} className="pv2-proto-cover-slot pv2-cover-swap select-none">
                      <CoverImg
                        canonicalCoverPath={coverPath}
                        alt={title ? `${title} cover` : "Album cover"}
                        fetchPriority="high"
                        cacheBust={
                          heroRow?.kind === "album"
                            ? heroRow.canonicalCoverCacheBust ??
                              (centeredAlbumId ? coverBustByAlbumId.get(centeredAlbumId) ?? null : null)
                            : null
                        }
                      />
                    </div>
                  </Link>
                </div>
              </div>
            </div>

            <div className="pv2-device-meta shrink-0">
              <div>
                <p className="pv2-device-rank-sub" aria-live="polite">
                  #{displayRank} of {displayCalendarYear}
                </p>
              </div>
              <p className="pv2-proto-artist text-pretty px-1">
                {artist ? (
                  <Link href={artistRoute(artist)} className="pv2-proto-artist-link">
                    {artist}
                  </Link>
                ) : (
                  "\u00a0"
                )}
              </p>
              <p className="pv2-proto-album px-1 text-pretty">{title || "…"}</p>
              <p className="pv2-device-explored-line" aria-live="polite">
                {portalClientReady ? (
                  <>
                    Explored {exploredCount}
                    {exploredCount === 1 ? " album" : " albums"}
                  </>
                ) : (
                  "\u00a0"
                )}
              </p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
