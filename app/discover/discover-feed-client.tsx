"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AlbumCuratorRepair } from "@/app/components/album-curator-repair";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import {
  appendDiscoverHiddenAlbumId,
  appendDiscoverSeenAlbumId,
  discoverMemoryHiddenSet,
  discoverMemorySeenSet,
  discoverMemorySnoozedSet,
  readDiscoverClientMemory,
  snoozeDiscoverAlbumId,
} from "@/lib/discover-client-memory";
import { rankDiscoverRowsClientSide } from "@/lib/discover-diversity-rank";

import type { DiscoverEraNav, DiscoverFeedStats, DiscoverPagination, DiscoverStableAlbumRow } from "./discover-feed-types";

export type { DiscoverStableAlbumRow, DiscoverStableRow, DiscoverFeedStats } from "./discover-feed-types";

type DiscoverFeedProps = {
  rows: DiscoverStableAlbumRow[];
  stats: DiscoverFeedStats;
  pagination: DiscoverPagination;
  eraNav: DiscoverEraNav;
  eraSlug: string;
};

function memoryContextLine(row: DiscoverStableAlbumRow): string {
  if (row.trustState === "verified") return "Billboard 200 · cover settled";
  if (row.trustState === "provisional") return "Billboard 200 · cover in progress";
  return "Billboard 200 · cover open";
}

function FeedCover({ src, alt }: { src: string | null; alt: string }) {
  const [broken, setBroken] = useState(false);
  const url = !broken ? canonicalCoverPathToUrl(src) : null;
  if (!url) {
    return (
      <div
        className="h-full w-full bg-[radial-gradient(circle_at_25%_25%,rgba(236,198,148,0.18),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(136,164,206,0.16),transparent_48%),linear-gradient(130deg,rgba(54,48,42,0.96),rgba(28,32,40,0.98))]"
        aria-hidden
      />
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- stable feed; external URLs + onError fallback
    <img
      src={url}
      alt={alt}
      className="pointer-events-none h-full w-full select-none object-cover [-webkit-touch-callout:none]"
      draggable={false}
      loading="lazy"
      decoding="async"
      onDragStart={(e) => e.preventDefault()}
      onContextMenu={(e) => e.preventDefault()}
      onError={() => setBroken(true)}
    />
  );
}

function AlbumCard({
  row,
  onMarkSeen,
  onDeviceMemoryChange,
}: {
  row: DiscoverStableAlbumRow;
  onMarkSeen: (id: string) => void;
  onDeviceMemoryChange: () => void;
}) {
  const href = `/albums/${row.albumId}`;
  const curatorContext = {
    albumId: row.albumId,
    albumSlug: row.albumId,
    albumTitle: row.title,
    artist: row.artist,
    year: row.year,
    trustState: row.trustState,
    canonicalCoverPath: row.canonicalCoverPath,
    trackCount: null,
  };

  return (
    <Link
      href={href}
      aria-label={`Open album: ${row.title}`}
      onClick={() => onMarkSeen(row.albumId)}
      className="group relative z-0 block overflow-hidden rounded-2xl border border-[var(--card-border)]/55 bg-[var(--surface-raised)]/80 shadow-[0_22px_48px_-28px_rgba(0,0,0,0.75)] transition hover:border-[var(--card-border)]/80"
    >
      <AlbumCuratorRepair
        context={curatorContext}
        captureLinkNavigationClicks
        showDiscoverReviewActions
        deviceDiscoverActions={{
          onHideAlbum: () => {
            appendDiscoverHiddenAlbumId(row.albumId);
            onDeviceMemoryChange();
          },
          onHideForNow: () => {
            snoozeDiscoverAlbumId(row.albumId);
            onDeviceMemoryChange();
          },
        }}
        className="block w-full"
      >
        <div className="aspect-square w-full overflow-hidden bg-[var(--surface)]">
          <FeedCover src={row.canonicalCoverPath} alt={`${row.title} cover`} />
        </div>
      </AlbumCuratorRepair>
      <div className="space-y-2 px-4 pb-5 pt-4">
        <p className="line-clamp-3 font-serif text-lg leading-snug tracking-tight text-[var(--text-primary)] sm:text-xl group-hover:underline">{row.title}</p>
        <p className="text-[0.95rem] leading-snug text-[var(--text-secondary)]">{row.artist}</p>
        {row.year ? <p className="text-sm tabular-nums text-[var(--text-secondary)]/88">{row.year}</p> : null}
        <p className="pt-1 text-[0.65rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/55">{memoryContextLine(row)}</p>
      </div>
    </Link>
  );
}

export default function DiscoverFeedClient({ rows, stats: _stats, pagination, eraNav, eraSlug }: DiscoverFeedProps) {
  const { page, pageSize, totalAlbums, totalPages } = pagination;
  const { listBasePath } = eraNav;
  const isDiscoverHome = listBasePath === "/";

  const [memoryTick, setMemoryTick] = useState(0);
  const bumpMemory = useCallback(() => setMemoryTick((n) => n + 1), []);

  const [extraRows, setExtraRows] = useState<DiscoverStableAlbumRow[]>([]);
  const [nextPage, setNextPage] = useState(page + 1);
  const [loadMoreLoading, setLoadMoreLoading] = useState(false);
  const [loadMoreError, setLoadMoreError] = useState<string | null>(null);

  useEffect(() => {
    setExtraRows([]);
    setNextPage(page + 1);
    setLoadMoreError(null);
  }, [page, eraSlug]);

  const deviceMemory = useMemo(() => readDiscoverClientMemory(), [memoryTick]);
  const seenSet = useMemo(() => discoverMemorySeenSet(deviceMemory), [deviceMemory]);
  const hiddenSet = useMemo(() => discoverMemoryHiddenSet(deviceMemory), [deviceMemory]);
  const snoozedSet = useMemo(() => discoverMemorySnoozedSet(deviceMemory), [deviceMemory]);

  const accumulated = useMemo(() => [...rows, ...extraRows], [rows, extraRows]);

  const displayRows = useMemo(
    () => rankDiscoverRowsClientSide(accumulated, seenSet, hiddenSet, snoozedSet),
    [accumulated, seenSet, hiddenSet, snoozedSet],
  );

  const markSeen = useCallback(
    (albumId: string) => {
      appendDiscoverSeenAlbumId(albumId);
      bumpMemory();
    },
    [bumpMemory],
  );

  const loadMore = useCallback(async () => {
    if (loadMoreLoading || nextPage > totalPages) return;
    setLoadMoreLoading(true);
    setLoadMoreError(null);
    try {
      const res = await fetch(`/api/discover/feed?era=${encodeURIComponent(eraSlug)}&page=${nextPage}`);
      if (!res.ok) throw new Error(`feed_${res.status}`);
      const body = (await res.json()) as { rows?: DiscoverStableAlbumRow[]; error?: string };
      if (body.error) throw new Error(body.error);
      const incoming = body.rows ?? [];
      if (incoming.length === 0) {
        setNextPage(totalPages + 1);
        return;
      }
      setExtraRows((prev) => {
        const known = new Set([...rows.map((r) => r.albumId), ...prev.map((r) => r.albumId)]);
        const merged = [...prev];
        for (const r of incoming) {
          if (!known.has(r.albumId)) {
            known.add(r.albumId);
            merged.push(r);
          }
        }
        return merged;
      });
      setNextPage((p) => p + 1);
    } catch {
      setLoadMoreError("Could not load more.");
    } finally {
      setLoadMoreLoading(false);
    }
  }, [eraSlug, nextPage, totalPages, loadMoreLoading, rows]);

  const navBtn =
    "inline-flex min-h-[2.75rem] items-center justify-center rounded border border-[var(--card-border)]/45 bg-[var(--surface-raised)]/35 px-4 py-2.5 text-[0.8rem] uppercase tracking-[0.14em] text-[var(--text-primary)] transition hover:border-[var(--accent-primary)]/40 hover:text-[var(--accent-primary)] disabled:pointer-events-none disabled:opacity-35";

  const hiddenOrSnoozedThisDevice = accumulated.length - displayRows.length;

  const scrollerRef = useRef<HTMLDivElement>(null);
  /** Mobile-only: album visually locked in the center "exhibit" frame. */
  const [heroAlbumId, setHeroAlbumId] = useState<string | null>(null);

  const updateHeroFromScroller = useCallback(() => {
    const rootEl = scrollerRef.current;
    if (!rootEl || displayRows.length === 0) return;
    if (typeof window !== "undefined" && window.matchMedia("(min-width: 768px)").matches) {
      setHeroAlbumId(null);
      return;
    }
    const rb = rootEl.getBoundingClientRect();
    const midY = rb.top + rb.height / 2;
    let bestId: string | null = null;
    let bestDist = Number.POSITIVE_INFINITY;
    for (const row of displayRows) {
      const el = document.getElementById(`discover-slot-${row.albumId}`);
      if (!el) continue;
      const er = el.getBoundingClientRect();
      const c = er.top + er.height / 2;
      const d = Math.abs(c - midY);
      if (d < bestDist) {
        bestDist = d;
        bestId = row.albumId;
      }
    }
    if (bestId) setHeroAlbumId(bestId);
  }, [displayRows]);

  useEffect(() => {
    const rootEl = scrollerRef.current;
    if (!rootEl) return;

    let raf = 0;
    const schedule = () => {
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        updateHeroFromScroller();
      });
    };

    const mq = window.matchMedia("(max-width: 767px)");
    const onMq = () => schedule();
    mq.addEventListener("change", onMq);

    rootEl.addEventListener("scroll", schedule, { passive: true });
    rootEl.addEventListener("scrollend", schedule);

    schedule();

    return () => {
      mq.removeEventListener("change", onMq);
      rootEl.removeEventListener("scroll", schedule);
      rootEl.removeEventListener("scrollend", schedule);
      if (raf) cancelAnimationFrame(raf);
    };
  }, [displayRows, updateHeroFromScroller]);

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-[#0a0807] text-[#d9c4a8] md:min-h-dvh md:flex-none md:overflow-visible">
      <header className="shrink-0 border-b border-[#3d2e22]/55 px-4 pb-5 pt-6 sm:px-6">
        <p className="font-serif text-[1.05rem] tracking-[0.06em] text-[#e8dcc8] sm:text-[1.15rem]">{eraNav.headline}</p>
        {eraNav.subline ? <p className="mt-2 max-w-prose text-sm leading-relaxed text-[#b79c82]/92">{eraNav.subline}</p> : null}
        <p className="mt-3 text-[0.75rem] text-[#8f735c]/88">
          {totalAlbums === 0 ? (
            "No albums in this chapter yet."
          ) : (
            <>
              Showing {displayRows.length} album
              {displayRows.length === 1 ? "" : "s"}
              {hiddenOrSnoozedThisDevice > 0 ? ` · ${hiddenOrSnoozedThisDevice} hidden on this device` : ""} · {totalAlbums} in this stream
            </>
          )}
        </p>
      </header>

      <div
        ref={scrollerRef}
        className="min-h-0 flex-1 overflow-y-auto overscroll-y-contain [scrollbar-gutter:stable] scroll-py-3 snap-y snap-mandatory motion-reduce:snap-none max-md:[scroll-behavior:auto] md:flex-none md:overflow-visible md:snap-none"
      >
        <div className="mx-auto max-w-lg px-4 py-6 sm:max-w-xl md:px-5 md:py-10">
          <ol className="list-none max-md:space-y-0 md:space-y-20">
            {displayRows.map((row) => {
              /**
               * The mobile focal-carousel fade was removed — every slot now
               * renders fully on phone, same as desktop. `mobileFrame` keeps
               * the snap layout so scroll-snap still works.
               */
              const mobileFrame =
                "flex max-md:snap-center max-md:snap-always max-md:min-h-[calc(100dvh-var(--rv-header-offset)-8.5rem)] max-md:shrink-0 max-md:items-center max-md:justify-center max-md:px-0 max-md:py-2 max-md:relative";
              return (
                <li
                  id={`discover-slot-${row.albumId}`}
                  key={row.albumId}
                  aria-current={heroAlbumId === row.albumId ? "true" : undefined}
                  className={`${mobileFrame} md:min-h-0 md:block md:py-0`}
                >
                  <div className="w-full max-w-lg md:max-w-none">
                    <AlbumCard row={row} onMarkSeen={markSeen} onDeviceMemoryChange={bumpMemory} />
                  </div>
                </li>
              );
            })}
          </ol>

          {displayRows.length === 0 && totalAlbums > 0 ? (
            <p className="mt-8 text-center text-sm text-[#8f735c]">Every album in this stream is hidden on this device. Clear site data or use “Search” to jump to an album.</p>
          ) : null}

          <nav className="mt-16 border-t border-[#3d2e22]/45 pt-10 pb-28 max-md:mt-12 max-md:pb-16 md:mt-16" aria-label="Browse albums">
          {!isDiscoverHome && (eraNav.prevEraSlug !== null || eraNav.nextEraSlug !== null) ? (
            <div className="flex flex-col gap-4 sm:flex-row sm:flex-wrap sm:justify-center sm:gap-3">
              {eraNav.prevEraSlug !== null ? (
                <Link href={`/eras/${eraNav.prevEraSlug}`} className={navBtn}>
                  ← Previous era
                </Link>
              ) : (
                <span className={`${navBtn} opacity-35`} aria-disabled>
                  ← Previous era
                </span>
              )}
              {eraNav.nextEraSlug !== null ? (
                <Link href={`/eras/${eraNav.nextEraSlug}`} className={navBtn}>
                  Next era →
                </Link>
              ) : (
                <span className={`${navBtn} opacity-35`} aria-disabled>
                  Next era →
                </span>
              )}
            </div>
          ) : null}

          <div
            className={`flex flex-col items-stretch gap-3 sm:items-center ${!isDiscoverHome ? "mt-8" : ""}`}
          >
            <div className="flex flex-col gap-2 sm:flex-row sm:justify-center sm:gap-4">
              {page > 1 ? (
                <Link
                  href={
                    listBasePath === "/" ? (page <= 2 ? "/" : `/?page=${page - 1}`) : `${listBasePath}?page=${page - 1}`
                  }
                  className={navBtn}
                >
                  Earlier batch
                </Link>
              ) : null}
              <button type="button" disabled={nextPage > totalPages || loadMoreLoading} onClick={() => void loadMore()} className={navBtn}>
                {loadMoreLoading ? "Loading…" : nextPage > totalPages ? "End of archive" : "Load more from archive"}
              </button>
            </div>
            <p className="text-center text-[0.7rem] text-[#7d6554]/85">
              Page {page} served · up to {pageSize} per batch · {totalPages} batch
              {totalPages === 1 ? "" : "es"} total
            </p>
            {loadMoreError ? <p className="text-center text-sm text-red-400">{loadMoreError}</p> : null}
          </div>

          <p className="mt-8 flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-center text-[0.7rem] tracking-[0.08em] text-[#7d6554]/85">
            {isDiscoverHome ? (
              <>
                <Link href="/portal" className="underline-offset-2 hover:text-[#c4a990] hover:underline">
                  Portal
                </Link>
                <span aria-hidden>·</span>
                <Link href="/eras" className="underline-offset-2 hover:text-[#c4a990] hover:underline">
                  Browse by era
                </Link>
                <span aria-hidden>·</span>
                <Link href="/search" className="underline-offset-2 hover:text-[#c4a990] hover:underline">
                  Search
                </Link>
              </>
            ) : (
                <Link href="/portal" className="underline-offset-2 hover:text-[#c4a990] hover:underline">
                Portal
                </Link>
            )}
          </p>
        </nav>
        </div>
      </div>
    </div>
  );
}
