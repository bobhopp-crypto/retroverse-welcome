"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";

import type { DiscoverReviewMark } from "@/lib/discover-review-state";

export const CURATOR_LONG_PRESS_MS = 450;
export const CURATOR_MOVE_CANCEL_PX = 12;

export type CuratorAlbumContext = {
  albumId: string;
  albumSlug: string;
  albumTitle: string;
  artist: string;
  year: number | null;
  trustState: string;
  canonicalCoverPath: string | null;
  trackCount: number | null;
};

type CandidateChoice = {
  source: "discogs";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
};

type AlbumCuratorRepairProps = {
  context: CuratorAlbumContext;
  children: React.ReactNode;
  /**
   * When set, assigns a callable that clears the pending long-press timer (viewer swipe vs hold coordination).
   * Ref is cleared on unmount.
   */
  viewerGestureCancelRef?: React.MutableRefObject<(() => void) | null>;
  /** Set when wrapped inside a parent <Link> so a long-press does not trigger navigation */
  captureLinkNavigationClicks?: boolean;
  /** Discover-style review filters (writes discover_review_state.json) */
  showDiscoverReviewActions?: boolean;
  /** Per-device only (localStorage); does not change server corpus */
  deviceDiscoverActions?: {
    onHideAlbum: () => void;
    onHideForNow: () => void;
  };
  className?: string;
};

async function postDiscoverReview(albumId: string, state: DiscoverReviewMark): Promise<boolean> {
  const res = await fetch("/api/discover/review-state", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ albumId, state }),
  });
  return res.ok;
}

export function AlbumCuratorRepair({
  context,
  children,
  viewerGestureCancelRef,
  captureLinkNavigationClicks = false,
  showDiscoverReviewActions = false,
  deviceDiscoverActions,
  className = "",
}: AlbumCuratorRepairProps) {
  const router = useRouter();
  const [sheetOpen, setSheetOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyPending, setApplyPending] = useState(false);
  const [reviewPending, setReviewPending] = useState(false);
  const longPressTimerRef = useRef<number | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const longPressConsumedNavRef = useRef(false);
  const candidatesRef = useRef<CandidateChoice[]>(candidates);
  candidatesRef.current = candidates;

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  useEffect(() => {
    const r = viewerGestureCancelRef;
    if (!r) return undefined;
    r.current = () => {
      clearLongPressTimer();
      pointerStartRef.current = null;
      longPressConsumedNavRef.current = false;
    };
    return () => {
      r.current = null;
    };
  }, [viewerGestureCancelRef]);

  const openCuratorSheet = useCallback(() => {
    const albumId = context.albumId;
    const artist = context.artist;
    const title = context.albumTitle;
    if (!albumId || !artist) return;
    setSheetOpen(true);
    if (candidatesRef.current.length > 0) return;
    setLoading(true);
    void fetch(`/api/artwork-workbench/candidates?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { candidates?: CandidateChoice[] };
        setCandidates(body.candidates ?? []);
      })
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }, [context.albumId, context.artist, context.albumTitle]);

  async function applyCandidate(candidate: CandidateChoice) {
    const albumId = context.albumId;
    const artist = context.artist;
    const title = context.albumTitle;
    if (!albumId || !artist || !candidate.image) return;
    setApplyPending(true);
    try {
      const res = await fetch("/api/artwork-workbench/living-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace_artwork",
          albumId,
          artist,
          title,
          confidence: null,
          candidateSource: candidate.image,
          candidateImageUrl: candidate.image,
          sourceArtist: candidate.artist,
          sourceCollection: candidate.title,
          sourceReleaseDate: candidate.year ? `${candidate.year}-01-01` : null,
          replaceSource: candidate.source,
        }),
      });
      if (!res.ok) throw new Error();
      setSheetOpen(false);
      window.location.reload();
    } catch {
      // no-op
    } finally {
      setApplyPending(false);
    }
  }

  async function onReviewMark(state: DiscoverReviewMark) {
    setReviewPending(true);
    try {
      const ok = await postDiscoverReview(context.albumId, state);
      if (!ok) return;
      setSheetOpen(false);
      router.refresh();
    } finally {
      setReviewPending(false);
    }
  }

  function onPointerDown(e: React.PointerEvent) {
    if (!e.isPrimary) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    longPressConsumedNavRef.current = false;
    pointerStartRef.current = { x: e.clientX, y: e.clientY };
    clearLongPressTimer();
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTimerRef.current = null;
      longPressConsumedNavRef.current = true;
      if (context.albumId) {
        router.push(`/portal-v2/curate?albumId=${encodeURIComponent(context.albumId)}`);
      }
    }, CURATOR_LONG_PRESS_MS);
  }

  function onPointerMove(e: React.PointerEvent) {
    if (!pointerStartRef.current || longPressTimerRef.current === null) return;
    const dx = e.clientX - pointerStartRef.current.x;
    const dy = e.clientY - pointerStartRef.current.y;
    if (dx * dx + dy * dy > CURATOR_MOVE_CANCEL_PX * CURATOR_MOVE_CANCEL_PX) {
      clearLongPressTimer();
      pointerStartRef.current = null;
    }
  }

  function onPointerEnd() {
    clearLongPressTimer();
    pointerStartRef.current = null;
  }

  function onClickCapture(e: React.MouseEvent) {
    if (!captureLinkNavigationClicks) {
      if (longPressConsumedNavRef.current) {
        longPressConsumedNavRef.current = false;
      }
      return;
    }
    if (longPressConsumedNavRef.current) {
      e.preventDefault();
      e.stopPropagation();
      longPressConsumedNavRef.current = false;
    }
  }

  const coverPathNote = context.canonicalCoverPath?.trim()
    ? context.canonicalCoverPath.startsWith("http")
      ? " · url"
      : " · path set"
    : " · none";

  return (
    <>
      <div
        className={`touch-manipulation select-none [-webkit-touch-callout:none] ${className}`.trim()}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerEnd}
        onPointerCancel={onPointerEnd}
        onPointerLeave={onPointerEnd}
        onClickCapture={onClickCapture}
        onContextMenu={(event) => {
          event.preventDefault();
          if (context.albumId) {
            router.push(`/portal-v2/curate?albumId=${encodeURIComponent(context.albumId)}`);
          }
        }}
        role="presentation"
      >
        {children}
      </div>
      {sheetOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-2 sm:items-center">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg border border-[var(--card-border)]/80 bg-[var(--surface-raised)] p-3">
            <div className="mb-2 flex items-start justify-between gap-3 border-b border-[var(--card-border)]/60 pb-2">
              <div className="min-w-0">
                <p className="text-xs tracking-[0.08em] text-[var(--text-secondary)] uppercase">Curator</p>
                <h4 className="font-serif text-lg text-[var(--text-primary)]">{context.albumTitle}</h4>
                <p className="text-sm text-[var(--text-secondary)]">
                  {context.artist}
                  {context.year !== null ? ` • ${context.year}` : ""}
                </p>
                <p className="mt-1 break-all font-mono text-[10px] text-[var(--text-secondary)]/80">
                  slug {context.albumSlug} · id {context.albumId}
                </p>
                <p className="mt-1 text-[11px] text-[var(--text-secondary)]/85">
                  Cover: {context.trustState}
                  {coverPathNote}
                  {context.trackCount !== null ? ` · ${context.trackCount} tracks` : ""}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="shrink-0 rounded border border-[var(--card-border)]/75 px-2 py-1 text-xs text-[var(--text-primary)]"
              >
                close
              </button>
            </div>

            {deviceDiscoverActions ? (
              <div className="mb-3 flex flex-col gap-2 border-b border-[var(--card-border)]/40 pb-3">
                <p className="text-[0.65rem] font-medium uppercase tracking-[0.14em] text-[var(--text-secondary)]/88">This device only</p>
                <div className="flex flex-wrap gap-2">
                  <button
                    type="button"
                    onClick={() => {
                      deviceDiscoverActions.onHideAlbum();
                      setSheetOpen(false);
                    }}
                    className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                  >
                    Hide album here
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      deviceDiscoverActions.onHideForNow();
                      setSheetOpen(false);
                    }}
                    className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)]"
                  >
                    Hide for now (~24h)
                  </button>
                </div>
              </div>
            ) : null}

            {showDiscoverReviewActions ? (
              <div className="mb-3 flex flex-wrap gap-2 border-b border-[var(--card-border)]/40 pb-3">
                <p className="w-full text-[0.65rem] font-medium uppercase tracking-[0.14em] text-[var(--text-secondary)]/88">Curator queue (repo)</p>
                <button
                  type="button"
                  disabled={reviewPending}
                  onClick={() => void onReviewMark("fixed")}
                  className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-45"
                >
                  Mark fixed
                </button>
                <button
                  type="button"
                  disabled={reviewPending}
                  onClick={() => void onReviewMark("hidden")}
                  className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-45"
                >
                  Hide
                </button>
                <button
                  type="button"
                  disabled={reviewPending}
                  onClick={() => void onReviewMark("skipped")}
                  className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-45"
                >
                  Skip for now
                </button>
                <button
                  type="button"
                  disabled={reviewPending}
                  onClick={() => void onReviewMark("reviewed")}
                  className="rounded border border-[var(--card-border)]/70 bg-[var(--surface)] px-3 py-1.5 text-xs text-[var(--text-primary)] disabled:opacity-45"
                >
                  Mark reviewed
                </button>
              </div>
            ) : null}

            {loading ? <p className="text-sm text-[var(--text-secondary)]">Loading candidates...</p> : null}
            {!loading ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {candidates.map((candidate, index) => (
                  <button
                    key={`${candidate.source}-${candidate.artist}-${candidate.title}-${index}`}
                    type="button"
                    disabled={!candidate.image || applyPending}
                    onClick={() => void applyCandidate(candidate)}
                    className="overflow-hidden rounded border border-[var(--card-border)]/70 bg-[var(--surface)] text-left transition hover:bg-[var(--surface-raised)] disabled:opacity-45"
                  >
                    <div className="aspect-square w-full bg-[var(--surface)]">
                      {candidate.image ? (
                        // eslint-disable-next-line @next/next/no-img-element -- candidate preview URLs
                        <img src={candidate.image} alt={candidate.title} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="space-y-0.5 p-2">
                      <p className="line-clamp-2 text-xs text-[var(--text-primary)]">{candidate.title}</p>
                      <p className="line-clamp-1 text-[11px] text-[var(--text-secondary)]">{candidate.artist}</p>
                      <p className="text-[10px] text-[var(--text-secondary)]">
                        {candidate.source}
                        {candidate.year ? ` • ${candidate.year}` : ""}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            ) : null}
          </div>
        </div>
      ) : null}
    </>
  );
}
