"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

import {
  CURATOR_LONG_PRESS_MS,
  CURATOR_MOVE_CANCEL_PX,
} from "@/app/components/album-curator-repair";
import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import {
  firstUnseenAlbumIndex,
  loadPortalViewedAlbums,
  nextPortalAlbumIndexPreferUnseen,
  orderPortalAlbumIds,
  recordPortalAlbumViewed,
} from "@/lib/portal-session-variety";
import type { ViewerBootstrap } from "@/lib/viewer-scope";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

const ACTIVATION_PX = 48;

function PortalCoverImg({ canonicalCoverPath, alt }: { canonicalCoverPath: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  const url = !broken ? canonicalCoverPathToUrl(canonicalCoverPath) : null;
  if (!url) {
    return (
      <div
        className="h-full w-full bg-[radial-gradient(circle_at_38%_32%,rgba(236,206,164,0.12),transparent_52%),linear-gradient(154deg,rgba(44,39,34,0.96),rgba(16,17,21,1))]"
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
      decoding="sync"
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onError={() => setBroken(true)}
    />
  );
}

function peekCoverUrl(
  cache: Map<string, DiscoverStableAlbumRow>,
  albumId: string | null,
): string | null {
  if (!albumId) return null;
  const row = cache.get(albumId);
  const path = row?.kind === "album" ? row.canonicalCoverPath : null;
  return canonicalCoverPathToUrl(path);
}

function PeekRail({
  albumId,
  cache,
  side: _side,
}: {
  albumId: string | null;
  cache: Map<string, DiscoverStableAlbumRow>;
  side: "left" | "right";
}) {
  const url = peekCoverUrl(cache, albumId);
  const lean = _side === "left" ? "object-left" : "object-right";
  return (
    <div
      className={`pointer-events-none relative h-[min(78vw,22.5rem)] w-[2rem] shrink-0 overflow-hidden rounded-xl border border-[#c9a86c]/10 shadow-[inset_0_0_24px_rgba(0,0,0,0.65)] opacity-[0.38] sm:w-[min(10vw,3.15rem)]`}
      aria-hidden
    >
      {url ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={url}
          alt=""
          className={`h-full w-full scale-110 object-cover ${lean} select-none blur-[0.35px]`}
          draggable={false}
        />
      ) : (
        <div className="h-full w-full bg-[#0a0e16]" />
      )}
    </div>
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

async function hydrateRemote(ids: string[]): Promise<DiscoverStableAlbumRow[]> {
  const res = await fetch("/api/viewer/hydrate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) return [];
  const body = (await res.json()) as { rows?: DiscoverStableAlbumRow[] };
  return body.rows ?? [];
}

async function fetchYearAlbumIds(year: number): Promise<string[]> {
  const res = await fetch(`/api/viewer/year-albums?year=${encodeURIComponent(String(year))}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { ids?: string[] };
  return Array.isArray(body.ids) ? body.ids : [];
}

export default function PortalClient({ bootstrap }: { bootstrap: ViewerBootstrap }) {
  const router = useRouter();
  const { years } = bootstrap;
  const bootstrapYearIdxRaw = years.indexOf(bootstrap.year);
  const bootstrapYearIdx = bootstrapYearIdxRaw >= 0 ? bootstrapYearIdxRaw : 0;

  const idsByYearRef = useRef<Map<number, string[]>>(new Map([[bootstrap.year, [...bootstrap.albumIds]]]));
  const skipYearEffectRef = useRef(true);
  const cacheRef = useRef<Map<string, DiscoverStableAlbumRow>>(new Map());

  const gestureStartRef = useRef<{ x: number; y: number } | null>(null);
  const gestureAxisRef = useRef<null | "h" | "v">(null);
  const gesturePointerIdRef = useRef<number | null>(null);
  const swipeSuppressClickRef = useRef(false);
  const curatorSwipeCancelRef = useRef<(() => void) | null>(null);

  const longPressTimerRef = useRef<number | null>(null);
  const longPressStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressConsumedNavRef = useRef(false);

  const [yearIdx, setYearIdx] = useState(bootstrapYearIdx);
  const [idsYear, setIdsYear] = useState(bootstrap.year);
  const [albumIds, setAlbumIds] = useState<string[]>(() => [...bootstrap.albumIds]);
  const [albumIdx, setAlbumIdx] = useState(0);

  const albumIdsRef = useRef(albumIds);
  albumIdsRef.current = albumIds;

  const [cache, setCache] = useState<Map<string, DiscoverStableAlbumRow>>(() => {
    const m = new Map<string, DiscoverStableAlbumRow>();
    for (const row of bootstrap.hydrated) {
      if (row.kind === "album") m.set(row.albumId, row);
    }
    cacheRef.current = m;
    return m;
  });

  const mergeRowsCached = useCallback((rows: DiscoverStableAlbumRow[]) => {
    setCache((prev) => {
      const next = mergeRows(prev, rows);
      cacheRef.current = next;
      return next;
    });
  }, []);

  const ensureHydrated = useCallback(
    async (idsNeeding: string[]) => {
      const need = [...new Set(idsNeeding.filter(Boolean).filter((id) => !cacheRef.current.has(id)))];
      if (need.length === 0) return;
      const rows = await hydrateRemote(need);
      mergeRowsCached(rows);
    },
    [mergeRowsCached],
  );

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  /** Client-only: reorder by session “seen” + cover trust; avoids SSR/sessionStorage hydration mismatch. */
  useLayoutEffect(() => {
    if (bootstrap.albumIds.length === 0) return;
    const viewed = loadPortalViewedAlbums();
    const ordered = orderPortalAlbumIds([...bootstrap.albumIds], viewed, cacheRef.current);
    const idx = firstUnseenAlbumIndex(ordered, viewed);
    setAlbumIds(ordered);
    setAlbumIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- bootstrap list is stable for this surface mount
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

  useEffect(() => {
    const id = albumIds.length > 0 ? albumIds[Math.min(albumIdx, albumIds.length - 1)]! : null;
    if (!id) return;
    recordPortalAlbumViewed(id);
  }, [albumIds, albumIdx]);

  useEffect(() => {
    const y = years[yearIdx];
    if (typeof y !== "number") return;

    if (skipYearEffectRef.current) {
      skipYearEffectRef.current = false;
      return;
    }

    const cached = idsByYearRef.current.get(y);
    if (cached) {
      const viewed = loadPortalViewedAlbums();
      const ordered = orderPortalAlbumIds(cached, viewed, cacheRef.current);
      const idx = firstUnseenAlbumIndex(ordered, viewed);
      setAlbumIds(ordered);
      setIdsYear(y);
      setAlbumIdx(idx);
      return;
    }

    let cancelled = false;
    void (async () => {
      const next = await fetchYearAlbumIds(y);
      if (cancelled) return;
      idsByYearRef.current.set(y, next);
      const viewed = loadPortalViewedAlbums();
      const ordered = orderPortalAlbumIds(next, viewed, cacheRef.current);
      const idx = firstUnseenAlbumIndex(ordered, viewed);
      setAlbumIds(ordered);
      setIdsYear(y);
      setAlbumIdx(idx);
    })();

    return () => {
      cancelled = true;
    };
  }, [yearIdx, years]);

  useEffect(() => {
    const need: string[] = [];
    for (const offset of [-2, -1, 0, 1, 2]) {
      const i = albumIdx + offset;
      if (i >= 0 && i < albumIds.length) need.push(albumIds[i]!);
    }
    void ensureHydrated(need);
  }, [albumIds, albumIdx, ensureHydrated]);

  const centeredAlbumId = albumIds.length > 0 ? albumIds[Math.min(albumIdx, albumIds.length - 1)]! : null;
  const heroRowHydrated =
    centeredAlbumId && cache.has(centeredAlbumId)
      ? (cache.get(centeredAlbumId) as DiscoverStableAlbumRow | undefined) ?? null
      : null;

  function dominantAxis(dx: number, dy: number): "h" | "v" {
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    return ady > adx ? "v" : "h";
  }

  function stepYear(direction: -1 | 1) {
    setYearIdx((yi) => Math.min(years.length - 1, Math.max(0, yi + direction)));
  }

  function stepAlbum(direction: -1 | 1) {
    setAlbumIdx((i) => {
      const ids = albumIdsRef.current;
      const viewed = loadPortalViewedAlbums();
      return nextPortalAlbumIndexPreferUnseen(ids, i, direction, viewed);
    });
  }

  function resetGesture(target: HTMLElement | null, pid: number | null) {
    gestureStartRef.current = null;
    gestureAxisRef.current = null;
    gesturePointerIdRef.current = null;
    if (!target || pid == null) return;
    try {
      target.releasePointerCapture(pid);
    } catch {
      /* no-op */
    }
  }

  function onViewportPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipeSuppressClickRef.current = false;
    gesturePointerIdRef.current = e.pointerId;
    gestureStartRef.current = { x: e.clientX, y: e.clientY };
    gestureAxisRef.current = null;
  }

  function onViewportPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (gesturePointerIdRef.current !== e.pointerId || !gestureStartRef.current) return;
    const s = gestureStartRef.current;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (dx * dx + dy * dy >= CURATOR_MOVE_CANCEL_PX * CURATOR_MOVE_CANCEL_PX) {
      curatorSwipeCancelRef.current?.();
    }

    if (gestureAxisRef.current === null && dx * dx + dy * dy >= 12 * 12) {
      gestureAxisRef.current = dominantAxis(dx, dy);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* optional */
      }
    }
  }

  function onViewportPointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (gesturePointerIdRef.current !== e.pointerId) return;

    const start = gestureStartRef.current;
    const lockedDuringStroke = gestureAxisRef.current;
    resetGesture(e.currentTarget, e.pointerId);

    if (!start || albumIds.length === 0) return;

    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    const axis =
      lockedDuringStroke ?? (Math.max(adx, ady) >= ACTIVATION_PX ? dominantAxis(dx, dy) : null);
    if (axis === null) return;

    if (axis === "h") {
      if (adx < ACTIVATION_PX) return;
      swipeSuppressClickRef.current = true;
      if (dx > 0) stepYear(-1);
      else stepYear(1);
      return;
    }

    if (ady < ACTIVATION_PX) return;
    swipeSuppressClickRef.current = true;
    // Swipe up (dy < 0) advances; swipe down goes back — matches vertical media feeds.
    if (dy > 0) stepAlbum(-1);
    else stepAlbum(1);
  }

  function onViewportPointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (gesturePointerIdRef.current !== e.pointerId) return;
    resetGesture(e.currentTarget, e.pointerId);
  }

  function onCoverPointerDown(e: React.PointerEvent) {
    if (!centeredAlbumId) return;
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    longPressConsumedNavRef.current = false;
    longPressStartRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressConsumedNavRef.current = true;
      router.push(`/portal-v2/curate?albumId=${encodeURIComponent(centeredAlbumId)}`);
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
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      const tg = e.target;
      if (tg instanceof HTMLElement) {
        if (tg.isContentEditable) return;
        const tag = tg.tagName.toLowerCase();
        if (tag === "input" || tag === "textarea" || tag === "select" || tag === "button") return;
      }
      if (years.length === 0 || albumIdsRef.current.length === 0) return;

      const k = e.key;
      if (k !== "ArrowUp" && k !== "ArrowDown" && k !== "ArrowLeft" && k !== "ArrowRight") return;
      e.preventDefault();

      if (k === "ArrowLeft") {
        stepYear(1);
        return;
      }
      if (k === "ArrowRight") {
        stepYear(-1);
        return;
      }
      if (k === "ArrowUp") {
        stepAlbum(1);
        return;
      }
      stepAlbum(-1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [years.length, albumIds.length]);

  if (years.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 py-28 text-center">
        {bootstrap.sourceOffline ? (
          <p className="text-[13px] tracking-[0.2em] text-[#a89e94]">Source offline</p>
        ) : null}
      </div>
    );
  }

  if (albumIds.length === 0 || !centeredAlbumId) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-6 py-20">
        {bootstrap.sourceOffline ? (
          <p className="text-[12px] tracking-[0.18em] text-[#a89e94]">Source offline</p>
        ) : null}
        <p className="text-[clamp(0.95rem,4vw,1.2rem)] tracking-[0.35em] text-[#a89e94]">&middot;&nbsp;&nbsp;{idsYear}&nbsp;&nbsp;&middot;</p>
        <span className="h-px w-10 bg-[#4a4139]" aria-hidden />
      </div>
    );
  }

  const heroHref = `/albums/${centeredAlbumId}`;
  const displayTitle = heroRowHydrated?.kind === "album" ? heroRowHydrated.title : "";
  const displayArtist = heroRowHydrated?.kind === "album" ? heroRowHydrated.artist || "" : "";
  const displayYearMeta = heroRowHydrated?.kind === "album" ? heroRowHydrated.year : idsYear;
  const coverPath = heroRowHydrated?.kind === "album" ? heroRowHydrated.canonicalCoverPath : null;

  const prevAlbumId = albumIdx > 0 ? albumIds[albumIdx - 1]! : null;
  const nextAlbumId = albumIdx < albumIds.length - 1 ? albumIds[albumIdx + 1]! : null;

  return (
    <section
      tabIndex={0}
      className="outline-none relative mx-auto flex min-h-[calc(100dvh-var(--rv-header-offset))] w-full flex-1 flex-col items-center px-[max(0.35rem,env(safe-area-inset-left))] pb-[max(0.5rem,env(safe-area-inset-bottom))] pr-[max(0.35rem,env(safe-area-inset-right))] pt-[max(0.2rem,env(safe-area-inset-top))]"
      aria-label="Retroverse portal — arrow keys or swipe; long-press cover for curator."
    >
      <p
        className="mb-2 shrink-0 text-[clamp(0.82rem,3.2vw,0.98rem)] font-medium uppercase tracking-[0.42em] text-[#d4b896]/90"
        style={{ fontFamily: "var(--font-portal-sans), system-ui, sans-serif" }}
        aria-hidden
      >
        Retroverse
      </p>

      <div
        role="presentation"
        className="w-full touch-none overscroll-none flex flex-col items-center"
        onPointerDown={onViewportPointerDown}
        onPointerMove={onViewportPointerMove}
        onPointerUp={onViewportPointerUp}
        onPointerCancel={onViewportPointerCancel}
      >
        <div className="flex w-full max-w-[min(96vw,28rem)] flex-row items-center justify-center gap-1.5 px-[max(0.25rem,env(safe-area-inset-left))] sm:gap-2.5">
          <PeekRail albumId={prevAlbumId} cache={cache} side="left" />

          <div className="flex min-w-0 shrink flex-col items-center">
            <p
              className="mb-2 text-[clamp(0.92rem,3.6vw,1.12rem)] tabular-nums tracking-[0.42em] text-[#c9a86c]"
              style={{ fontFamily: "var(--font-portal-sans), system-ui, sans-serif" }}
            >
              {idsYear}
            </p>

            <div className="rounded-[1.65rem] border border-[#c9a86c]/22 bg-gradient-to-b from-[#1c2431]/98 to-[#070910] p-[0.42rem] shadow-[0_26px_52px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.07),inset_0_-12px_28px_rgba(0,0,0,0.52)] sm:p-2.5">
              <div
                className="relative aspect-square w-[min(78vw,22.5rem)] touch-manipulation select-none [-webkit-touch-callout:none] overflow-hidden rounded-[1.12rem] shadow-[inset_0_0_36px_rgba(0,0,0,0.55)] ring-1 ring-black/55"
                onPointerDown={onCoverPointerDown}
                onPointerMove={onCoverPointerMove}
                onPointerUp={onCoverPointerEnd}
                onPointerCancel={onCoverPointerEnd}
                onPointerLeave={onCoverPointerEnd}
                onClickCapture={onCoverClickCapture}
                onContextMenu={(ev) => {
                  ev.preventDefault();
                  router.push(`/portal-v2/curate?albumId=${encodeURIComponent(centeredAlbumId)}`);
                }}
                role="presentation"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-4 top-2.5 z-[1] h-px bg-gradient-to-r from-transparent via-white/16 to-transparent"
                />
                <div
                  aria-hidden
                  className="pointer-events-none absolute inset-x-3 bottom-2 z-[1] h-px bg-gradient-to-r from-transparent via-black/40 to-transparent"
                />
                <Link
                  href={heroHref}
                  aria-label={displayTitle || "Open album"}
                  className="relative z-0 block h-full w-full focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#c9a86c]/45"
                  onClick={(evt) => {
                    if (swipeSuppressClickRef.current) {
                      evt.preventDefault();
                      swipeSuppressClickRef.current = false;
                    }
                  }}
                >
                  <div key={centeredAlbumId} className="portal-aperture-art h-full w-full">
                    <PortalCoverImg canonicalCoverPath={coverPath} alt={displayTitle ? `${displayTitle} cover` : "Album"} />
                  </div>
                </Link>
              </div>
            </div>

            <div className="mt-3 flex justify-center gap-3" aria-hidden>
              <span className="h-1.5 w-1.5 rounded-full bg-[#c9a86c]/85" />
              <span className="h-1.5 w-1.5 rounded-full bg-[#c9a86c]/85" />
            </div>
          </div>

          <PeekRail albumId={nextAlbumId} cache={cache} side="right" />
        </div>
      </div>

      <div
        className="mt-5 flex w-full max-w-[min(92vw,26rem)] shrink-0 flex-col items-center gap-1 px-2 pb-2 text-center"
        style={{ fontFamily: "var(--font-portal-sans), system-ui, sans-serif" }}
      >
        <p className="text-[clamp(1.15rem,4.5vw,1.55rem)] leading-snug tracking-[0.02em] text-[#c8bdb0]">
          {displayArtist || "\u00a0"}
        </p>
        <p
          className="max-w-[28ch] text-balance font-semibold leading-[1.06] tracking-[-0.02em] text-[#f3ebe0]"
          style={{
            fontFamily: "var(--font-portal-display), ui-serif, Georgia, serif",
            fontSize: "clamp(2.35rem,10.5vw,3.75rem)",
          }}
        >
          {displayTitle || "\u2026"}
        </p>
        <p className="pt-1.5 text-[clamp(1.05rem,3.8vw,1.28rem)] tabular-nums tracking-[0.2em] text-[#9a8f7e]">
          {typeof displayYearMeta === "number" ? displayYearMeta : idsYear}
        </p>
      </div>
    </section>
  );
}
