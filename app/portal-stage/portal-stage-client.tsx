"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FormEvent } from "react";

import { CURATOR_LONG_PRESS_MS, CURATOR_MOVE_CANCEL_PX } from "@/app/components/album-curator-repair";
import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import {
  normalizeCandidateArtworkUrl,
  normalizedArtworkUrlsEqual,
} from "@/lib/artwork-candidate-fingerprint";
import { fetchPortalCuratorWorkbenchSession } from "@/lib/portal-curator-workbench-client";
import {
  firstUnseenAlbumIndex,
  loadPortalViewedAlbums,
  nextPortalAlbumIndexPreferUnseen,
  orderPortalAlbumIds,
  recordPortalAlbumViewed,
} from "@/lib/portal-session-variety";
import type { ViewerBootstrap } from "@/lib/viewer-scope";

const ACTIVATION_PX = 44;

type WorkbenchCandidate = {
  source: "discogs";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url?: string | null;
  stagedFilePath?: string | null;
};

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

async function fetchYearAlbumIds(year: number): Promise<string[]> {
  const res = await fetch(`/api/viewer/year-albums?year=${encodeURIComponent(String(year))}`);
  if (!res.ok) return [];
  const body = (await res.json()) as { ids?: string[] };
  return Array.isArray(body.ids) ? body.ids : [];
}

type CuratorCandidatesFetchOk = {
  ok: true;
  candidates: WorkbenchCandidate[];
};
type CuratorCandidatesFetchBad = {
  ok: false;
  discogsUnreachable: boolean;
  detail: string;
};
type CuratorCandidatesFetchResult = CuratorCandidatesFetchOk | CuratorCandidatesFetchBad;

async function fetchCandidates(params: {
  artist: string;
  title: string;
  albumId: string;
  year: number | null;
}): Promise<CuratorCandidatesFetchResult> {
  const r = await fetchPortalCuratorWorkbenchSession(params);
  if (!r.ok) {
    const unreachable =
      r.error.kind === "network" || (typeof r.error.httpStatus === "number" && r.error.httpStatus >= 500);
    return {
      ok: false,
      discogsUnreachable: unreachable,
      detail: r.error.detail,
    };
  }
  if (r.discogsUnavailable) {
    return {
      ok: false,
      discogsUnreachable: true,
      detail: "Discogs master and release searches both failed (network or HTTP error).",
    };
  }
  const candidates = r.candidates.filter((c) => c.source === "discogs");

  return { ok: true, candidates };
}

function candidatesMatch(a: WorkbenchCandidate | null, b: WorkbenchCandidate | null): boolean {
  if (!a || !b) return false;
  return normalizedArtworkUrlsEqual(a.image, b.image);
}

function CoverImg({ canonicalCoverPath, alt }: { canonicalCoverPath: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  const url = !broken ? canonicalCoverPathToUrl(canonicalCoverPath) : null;
  if (!url) {
    return <div className="portal-stage-art-fallback" aria-hidden />;
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

export default function PortalStageClient({ bootstrap }: { bootstrap: ViewerBootstrap }) {
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

  /* eslint-disable react-hooks/refs -- ref mirrors albumIds/cache for gesture closures */
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
  /* eslint-enable react-hooks/refs */

  const [modalAlbumId, setModalAlbumId] = useState<string | null>(null);
  const [candidates, setCandidates] = useState<WorkbenchCandidate[]>([]);
  const [curatorAlternateError, setCuratorAlternateError] = useState<string | null>(null);
  const [candidatesLoading, setCandidatesLoading] = useState(false);
  const [selectedCandidate, setSelectedCandidate] = useState<WorkbenchCandidate | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const [modalSearch, setModalSearch] = useState("");

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

  useLayoutEffect(() => {
    if (bootstrap.albumIds.length === 0) return;
    const viewed = loadPortalViewedAlbums();
    const ordered = orderPortalAlbumIds([...bootstrap.albumIds], viewed, cacheRef.current);
    const idx = firstUnseenAlbumIndex(ordered, viewed);
    setAlbumIds(ordered);
    setAlbumIdx(idx);
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    for (const offset of [-1, 0, 1]) {
      const i = albumIdx + offset;
      if (i >= 0 && i < albumIds.length) need.push(albumIds[i]!);
    }
    void ensureHydrated(need);
  }, [albumIds, albumIdx, ensureHydrated]);

  const centeredAlbumId = albumIds.length > 0 ? albumIds[Math.min(albumIdx, albumIds.length - 1)]! : null;
  const heroRow =
    centeredAlbumId && cache.has(centeredAlbumId)
      ? (cache.get(centeredAlbumId) as DiscoverStableAlbumRow | undefined) ?? null
      : null;

  const modalRow =
    modalAlbumId && cache.has(modalAlbumId)
      ? (cache.get(modalAlbumId) as DiscoverStableAlbumRow | undefined) ?? null
      : null;

  const currentCoverUrlModal = modalRow?.kind === "album"
    ? normalizeCandidateArtworkUrl(canonicalCoverPathToUrl(modalRow.canonicalCoverPath))
    : null;

  const grid = useMemo(() => {
    const out: WorkbenchCandidate[] = [];
    for (const c of candidates) {
      if (c.source !== "discogs") continue;
      const u = normalizeCandidateArtworkUrl(c.image);
      if (!u) continue;
      out.push({ ...c, image: u });
    }
    return out;
  }, [candidates]);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect -- modal open/close and async Discogs ingest reset grid state here */
    if (!modalAlbumId || !modalRow || modalRow.kind !== "album") {
      setCandidates([]);
      setCuratorAlternateError(null);
      setSelectedCandidate(null);
      setCandidatesLoading(false);
      return;
    }
    let cancelled = false;
    setCandidatesLoading(true);
    setCuratorAlternateError(null);
    setSelectedCandidate(null);
    void (async () => {
      const result = await fetchCandidates({
        artist: modalRow.artist,
        title: modalRow.title,
        albumId: modalRow.albumId,
        year: modalRow.year,
      });
      if (cancelled) return;
      if (!result.ok) {
        setCandidates([]);
        setCuratorAlternateError(result.detail);
      } else {
        setCandidates(result.candidates);
        setCuratorAlternateError(null);
      }
      setCandidatesLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [modalAlbumId, modalRow]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const previewSrc = selectedCandidate ? normalizeCandidateArtworkUrl(selectedCandidate.image) : null;
  const heroModalSrc = previewSrc ?? currentCoverUrlModal;

  function dominantAxis(dx: number, dy: number): "h" | "v" {
    return Math.abs(dy) > Math.abs(dx) ? "v" : "h";
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

  function onStagePointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (modalAlbumId) return;
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    swipeSuppressClickRef.current = false;
    gesturePointerIdRef.current = e.pointerId;
    gestureStartRef.current = { x: e.clientX, y: e.clientY };
    gestureAxisRef.current = null;
  }

  function onStagePointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (modalAlbumId) return;
    if (gesturePointerIdRef.current !== e.pointerId || !gestureStartRef.current) return;
    const s = gestureStartRef.current;
    const dx = e.clientX - s.x;
    const dy = e.clientY - s.y;
    if (dx * dx + dy * dy >= CURATOR_MOVE_CANCEL_PX * CURATOR_MOVE_CANCEL_PX) {
      curatorSwipeCancelRef.current?.();
    }

    if (gestureAxisRef.current === null && dx * dx + dy * dy >= 10 * 10) {
      gestureAxisRef.current = dominantAxis(dx, dy);
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* optional */
      }
    }
  }

  function onStagePointerUp(e: React.PointerEvent<HTMLDivElement>) {
    if (modalAlbumId) return;
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

  function onStagePointerCancel(e: React.PointerEvent<HTMLDivElement>) {
    if (!e.isPrimary) return;
    if (gesturePointerIdRef.current !== e.pointerId) return;
    resetGesture(e.currentTarget, e.pointerId);
  }

  function onCoverPointerDown(e: React.PointerEvent) {
    if (modalAlbumId) return;
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
      if (modalAlbumId) {
        if (e.key === "Escape") {
          e.preventDefault();
          setModalAlbumId(null);
          setSelectedCandidate(null);
        }
        return;
      }
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
  }, [years.length, modalAlbumId]);

  async function applySelectedCurator() {
    if (!selectedCandidate || !modalRow || modalRow.kind !== "album" || applyPending) return;
    const stagedAbs =
      typeof selectedCandidate.stagedFilePath === "string" ? selectedCandidate.stagedFilePath.trim() : "";
    const img = typeof selectedCandidate.image === "string" ? selectedCandidate.image.trim() : "";

    let remoteHttps: string | null = null;
    if (/^https:\/\//i.test(img)) {
      remoteHttps = img;
    } else if (typeof selectedCandidate.url === "string" && /^https:\/\//i.test(selectedCandidate.url)) {
      remoteHttps = selectedCandidate.url;
    }

    const hasStaged = stagedAbs.length > 0;
    const hasRemote = remoteHttps !== null && selectedCandidate.source === "discogs";

    if (!hasStaged && !hasRemote) return;

    const replaceSource: "discogs" | "staged" = hasStaged ? "staged" : "discogs";

    setApplyPending(true);
    try {
      const res = await fetch("/api/artwork-workbench/living-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace_artwork",
          albumId: modalRow.albumId,
          artist: modalRow.artist,
          title: modalRow.title,
          confidence: null,
          candidateSource: selectedCandidate.image ?? remoteHttps,
          candidateImageUrl: hasRemote ? remoteHttps : null,
          stagedFilePath: hasStaged ? stagedAbs : null,
          sourceArtist: selectedCandidate.artist,
          sourceCollection: selectedCandidate.title,
          sourceReleaseDate: selectedCandidate.year ? `${selectedCandidate.year}-01-01` : null,
          replaceSource,
        }),
      });
      if (!res.ok) throw new Error();
      setModalAlbumId(null);
      setSelectedCandidate(null);
      router.refresh();
    } catch {
      /* no-op */
    } finally {
      setApplyPending(false);
    }
  }

  function submitModalSearch(ev: FormEvent) {
    ev.preventDefault();
    const q = modalSearch.trim();
    if (!q) return;
    setModalAlbumId(null);
    router.push(`/search?q=${encodeURIComponent(q)}`);
  }

  if (years.length === 0) {
    return (
      <div className="portal-stage-main">
        <div className="portal-stage-empty">
          {bootstrap.sourceOffline ? <p>Source offline</p> : null}
          <p>No years.</p>
        </div>
      </div>
    );
  }

  if (albumIds.length === 0 || !centeredAlbumId || !heroRow || heroRow.kind !== "album") {
    return (
      <div className="portal-stage-main">
        <div className="portal-stage-empty">
          {bootstrap.sourceOffline ? <p>Source offline</p> : null}
          <p className="portal-stage-empty-year">{idsYear}</p>
        </div>
      </div>
    );
  }

  const heroHref = `/albums/${centeredAlbumId}`;

  const displaySlots: WorkbenchCandidate[] = candidatesLoading ? [] : grid;
  return (
    <>
      <div className="portal-stage-main" role="presentation">
        <div
          className="portal-stage-stack"
          onPointerDown={onStagePointerDown}
          onPointerMove={onStagePointerMove}
          onPointerUp={onStagePointerUp}
          onPointerCancel={onStagePointerCancel}
        >
          <header className="portal-stage-header">
            <Link href="/portal-stage">Retroverse</Link>
          </header>

          <p className="portal-stage-year">{idsYear}</p>

          <div
            className="portal-stage-cover-slot select-none [-webkit-touch-callout:none]"
            onPointerDown={onCoverPointerDown}
            onPointerMove={onCoverPointerMove}
            onPointerUp={onCoverPointerEnd}
            onPointerCancel={onCoverPointerEnd}
            onPointerLeave={onCoverPointerEnd}
            onClickCapture={onCoverClickCapture}
            onContextMenu={(ev) => {
              ev.preventDefault();
              void (async () => {
                const id = centeredAlbumId;
                const rows = await hydrateRemote([id], { fresh: true });
                mergeRowsCached(rows);
                setModalAlbumId(id);
              })();
            }}
            role="presentation"
          >
            <div className="portal-stage-bezel portal-stage-frame">
              <Link
                href={heroHref}
                className="portal-stage-art-link"
                onClick={(evt) => {
                  if (swipeSuppressClickRef.current) {
                    evt.preventDefault();
                    swipeSuppressClickRef.current = false;
                  }
                }}
              >
                <CoverImg canonicalCoverPath={heroRow.canonicalCoverPath} alt={`${heroRow.title} cover`} />
              </Link>
            </div>
          </div>

          <p className="portal-stage-artist">{heroRow.artist || "\u00a0"}</p>

          <h1 className="portal-stage-title">{heroRow.title}</h1>
        </div>
      </div>

      <nav className="portal-stage-nav" aria-label="Navigation">
        <Link href="/search">Search</Link>
        <Link href="/albums">Albums</Link>
        <Link href="/eras">Eras</Link>
      </nav>

      {modalAlbumId && modalRow && modalRow.kind === "album" ? (
        <div className="portal-stage-modal" role="dialog" aria-modal="true" aria-label="Curator">
          <div className="portal-stage-modal-top">
            <button
              type="button"
              className="absolute right-4 top-4 rounded border-0 bg-transparent px-3 py-2 text-[15px] text-[#c8a96b]"
              style={{ fontFamily: "system-ui, sans-serif" }}
              onClick={() => {
                setModalAlbumId(null);
                setSelectedCandidate(null);
                setCuratorAlternateError(null);
              }}
            >
              Done
            </button>

            <div
              className="overflow-hidden rounded-md"
              style={{
                width: "min(72vw, 280px)",
                aspectRatio: "1 / 1",
                border: "1px solid rgba(200, 169, 107, 0.35)",
                boxShadow: "inset 0 0 24px rgba(0,0,0,0.5)",
              }}
            >
              {heroModalSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroModalSrc}
                  alt=""
                  className="h-full w-full"
                  style={{ objectFit: "cover", objectPosition: "center" }}
                  draggable={false}
                />
              ) : (
                <div className="h-full w-full bg-[#08111d]" />
              )}
            </div>

            <div className="flex w-full max-w-[360px] flex-wrap justify-center gap-x-5 gap-y-1 text-[14px]" style={{ fontFamily: "system-ui, sans-serif" }}>
              <a
                href={`https://www.discogs.com/search/?q=${encodeURIComponent(`${modalRow.artist} ${modalRow.title}`.replace(/\s+/g, " ").trim())}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#c8a96b]"
                style={{ textDecoration: "underline" }}
              >
                Search Discogs
              </a>
              <a
                href={
                  selectedCandidate?.url ??
                  `https://www.discogs.com/search/?q=${encodeURIComponent(`${modalRow.artist} ${modalRow.title}`.replace(/\s+/g, " ").trim())}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#c8a96b]"
                style={{ textDecoration: "underline" }}
              >
                Open in Discogs
              </a>
            </div>

            {candidatesLoading ? (
              <p className="w-full max-w-[360px] text-center text-[13px] text-[#b7aa95]">Loading alternates…</p>
            ) : null}
            {curatorAlternateError ? (
              <div
                role="alert"
                className="w-full max-w-[360px] rounded px-3 py-2 text-left text-[13px] text-[#f0dcd8]"
                style={{ background: "rgba(80,28,28,0.22)", border: "1px solid rgba(239,83,80,0.35)" }}
              >
                <p className="font-semibold text-[#f3e6e4]">Unable to fetch alternate artwork.</p>
              </div>
            ) : null}
            {!candidatesLoading && !curatorAlternateError && displaySlots.length === 0 ? (
              <p className="w-full max-w-[360px] text-center text-[13px] text-[#b7aa95]" role="status">
                Discogs returned no usable cover images for this search.
              </p>
            ) : null}
            <div className="grid w-full max-w-[360px] grid-cols-3 gap-2">
              {displaySlots.map((c, index) => {
                const active = candidatesMatch(selectedCandidate, c);
                const primary = normalizeCandidateArtworkUrl(c.image);
                return (
                  <button
                    key={`${primary ?? "c"}:${index}`}
                    type="button"
                    onClick={() => setSelectedCandidate(c)}
                    className="aspect-square overflow-hidden rounded-md bg-[#08111d]"
                    style={{
                      border: active ? "2px solid #c8a96b" : "1px solid rgba(200, 169, 107, 0.28)",
                    }}
                  >
                    {primary ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={primary} alt="" className="h-full w-full" style={{ objectFit: "cover" }} draggable={false} />
                    ) : null}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              disabled={!selectedCandidate || applyPending}
              onClick={() => void applySelectedCurator()}
              className="w-full max-w-[360px] rounded py-3 text-[16px] font-medium disabled:opacity-40"
              style={{
                fontFamily: "system-ui, sans-serif",
                background: "#c8a96b",
                color: "#05070b",
                border: "none",
              }}
            >
              {applyPending ? "Saving…" : "Use this cover"}
            </button>
          </div>

          <div className="portal-stage-modal-bottom">
            <form onSubmit={submitModalSearch} className="flex flex-col gap-2">
              <label htmlFor="stage-curator-q" className="sr-only">
                Search
              </label>
              <input
                id="stage-curator-q"
                type="search"
                value={modalSearch}
                onChange={(e) => setModalSearch(e.target.value)}
                placeholder="Search…"
                className="w-full rounded px-4 py-3 text-[17px] text-[#f3eadb]"
                style={{
                  fontFamily: "system-ui, sans-serif",
                  background: "#08111d",
                  border: "1px solid rgba(200, 169, 107, 0.35)",
                  outline: "none",
                }}
                autoComplete="off"
              />
              <button
                type="submit"
                className="w-full rounded py-3 text-[16px] text-[#f3eadb]"
                style={{
                  fontFamily: "system-ui, sans-serif",
                  background: "#08111d",
                  border: "1px solid rgba(200, 169, 107, 0.35)",
                }}
              >
                Search
              </button>
            </form>
            <div className="flex justify-center gap-6 text-[15px]">
              <Link href="/albums" className="text-[#b7aa95]" style={{ textDecoration: "none" }}>
                Albums
              </Link>
              <Link href="/search" className="text-[#b7aa95]" style={{ textDecoration: "none" }}>
                Search
              </Link>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
