"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

type CompactArtworkThumbProps = {
  title: string;
  canonicalCoverPath: string | null;
  albumId?: string;
  artist?: string;
  year?: number | null;
  artworkStatus?: string | null;
  className?: string;
  fallbackLabel?: string;
};

type CandidateChoice = {
  source: "discogs" | "itunes";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url: string | null;
};

function trustTone(status: string | null | undefined, hasCover: boolean): "none" | "soft" | "strong" {
  if (!hasCover || status === "missing") return "strong";
  if (status === "verified") return "none";
  if (status === "pending") return "soft";
  if (status === "rejected") return "strong";
  return "none";
}

export function CompactArtworkThumb({
  title,
  canonicalCoverPath,
  albumId,
  artist,
  year = null,
  artworkStatus = null,
  className = "h-10 w-10",
  fallbackLabel = "NO ART",
}: CompactArtworkThumbProps) {
  const router = useRouter();
  const [imageFailed, setImageFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateChoice[]>([]);
  const [loadingCandidates, setLoadingCandidates] = useState(false);
  const [replacePending, setReplacePending] = useState(false);
  const pressTimer = useRef<number | null>(null);

  const normalizedSrc = useMemo(() => canonicalCoverPathToUrl(canonicalCoverPath), [canonicalCoverPath]);
  const hasCover = Boolean(normalizedSrc && !imageFailed);
  const tone = trustTone(artworkStatus, hasCover);

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function openRepairSheet() {
    if (!albumId || !artist) return;
    setSheetOpen(true);
    if (candidates.length > 0) return;
    setLoadingCandidates(true);
    void fetch(`/api/artwork-workbench/candidates?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(`candidate_fetch_failed_${res.status}`);
        const body = (await res.json()) as { candidates?: CandidateChoice[] };
        setCandidates(body.candidates ?? []);
      })
      .catch(() => {
        setCandidates([]);
      })
      .finally(() => setLoadingCandidates(false));
  }

  function beginLongPress() {
    clearPressTimer();
    pressTimer.current = window.setTimeout(() => {
      if (albumId) router.push(`/portal-v2/curate?albumId=${encodeURIComponent(albumId)}`);
    }, 520);
  }

  async function applyCandidate(candidate: CandidateChoice) {
    if (!albumId || !artist) return;
    setReplacePending(true);
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
          candidateSource: candidate.url ?? candidate.image,
          candidateImageUrl: candidate.image,
          sourceArtist: candidate.artist,
          sourceCollection: candidate.title,
          sourceReleaseDate: candidate.year ? `${candidate.year}-01-01` : null,
          replaceSource: candidate.source,
        }),
      });
      if (!res.ok) throw new Error(`replace_failed_${res.status}`);
      setSheetOpen(false);
      window.location.reload();
    } catch {
      // no-op; keep sheet open so curator can retry
    } finally {
      setReplacePending(false);
    }
  }

  if (!normalizedSrc || imageFailed) {
    return (
      <>
        <button
          type="button"
          onContextMenu={(event) => {
            event.preventDefault();
            if (albumId) router.push(`/portal-v2/curate?albumId=${encodeURIComponent(albumId)}`);
          }}
          onPointerDown={beginLongPress}
          onPointerUp={clearPressTimer}
          onPointerCancel={clearPressTimer}
          className={`relative flex shrink-0 items-center justify-center overflow-hidden rounded-[0.35rem] border border-[var(--card-border)]/65 bg-[var(--surface-raised)] ${className}`}
          aria-label={`Artwork for ${title}`}
        >
          <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_25%,rgba(236,198,148,0.2),transparent_45%),radial-gradient(circle_at_80%_70%,rgba(136,164,206,0.2),transparent_48%),linear-gradient(130deg,rgba(54,48,42,0.9),rgba(28,32,40,0.95))]" />
          <span className="relative font-serif text-[0.56rem] leading-none tracking-[0.04em] text-[var(--text-secondary)]/92">{fallbackLabel}</span>
          <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-rose-500/90 ring-1 ring-black/40" />
        </button>
        {sheetOpen ? (
          <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-2 sm:items-center">
            <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg border border-[var(--card-border)]/80 bg-[var(--surface-raised)] p-3">
              <div className="mb-2 flex items-start justify-between gap-3 border-b border-[var(--card-border)]/60 pb-2">
                <div>
                  <p className="text-xs tracking-[0.08em] text-[var(--text-secondary)] uppercase">Curator Repair</p>
                  <h4 className="font-serif text-lg text-[var(--text-primary)]">{title}</h4>
                  <p className="text-sm text-[var(--text-secondary)]">{artist ?? "Unknown artist"}{year ? ` • ${year}` : ""}</p>
                </div>
                <button type="button" onClick={() => setSheetOpen(false)} className="rounded border border-[var(--card-border)]/75 px-2 py-1 text-xs text-[var(--text-primary)]">
                  close
                </button>
              </div>
              {loadingCandidates ? <p className="text-sm text-[var(--text-secondary)]">Loading candidates...</p> : null}
              {!loadingCandidates ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {candidates.map((candidate, index) => (
                    <button
                      key={`${candidate.source}-${candidate.artist}-${candidate.title}-${index}`}
                      type="button"
                      disabled={!candidate.image || replacePending}
                      onClick={() => void applyCandidate(candidate)}
                      className="overflow-hidden rounded border border-[var(--card-border)]/70 bg-[var(--surface)] text-left transition hover:bg-[var(--surface-raised)] disabled:opacity-45"
                    >
                      <div className="aspect-square w-full bg-[var(--surface)]">
                        {candidate.image ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={candidate.image} alt={candidate.title} className="h-full w-full object-cover" />
                        ) : null}
                      </div>
                      <div className="space-y-0.5 p-2">
                        <p className="line-clamp-2 text-xs text-[var(--text-primary)]">{candidate.title}</p>
                        <p className="line-clamp-1 text-[11px] text-[var(--text-secondary)]">{candidate.artist}</p>
                        <p className="text-[10px] text-[var(--text-secondary)]">{candidate.source}{candidate.year ? ` • ${candidate.year}` : ""}</p>
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

  return (
    <>
      <button
        type="button"
        onContextMenu={(event) => {
          event.preventDefault();
          if (albumId) router.push(`/portal-v2/curate?albumId=${encodeURIComponent(albumId)}`);
        }}
        onPointerDown={beginLongPress}
        onPointerUp={clearPressTimer}
        onPointerCancel={clearPressTimer}
        className={`relative shrink-0 overflow-hidden rounded-[0.35rem] border border-[var(--card-border)]/70 bg-[var(--surface-raised)] ${className}`}
        aria-label={`Artwork for ${title}`}
      >
        <Image
          src={normalizedSrc}
          alt={`${title} cover`}
          width={96}
          height={96}
          unoptimized
          className="h-full w-full object-cover"
          onError={() => setImageFailed(true)}
        />
        {tone === "soft" ? <span className="absolute right-1 top-1 h-2.5 w-2.5 rounded-full bg-amber-300/90 ring-1 ring-black/35" /> : null}
        {tone === "strong" ? (
          <span className="absolute right-0 top-0 block rounded-bl-sm bg-rose-500/90 px-1 py-0.5 text-[8px] font-medium tracking-[0.08em] text-white">
            ?
          </span>
        ) : null}
      </button>
      {sheetOpen ? (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-2 sm:items-center">
          <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg border border-[var(--card-border)]/80 bg-[var(--surface-raised)] p-3">
            <div className="mb-2 flex items-start justify-between gap-3 border-b border-[var(--card-border)]/60 pb-2">
              <div>
                <p className="text-xs tracking-[0.08em] text-[var(--text-secondary)] uppercase">Curator Repair</p>
                <h4 className="font-serif text-lg text-[var(--text-primary)]">{title}</h4>
                <p className="text-sm text-[var(--text-secondary)]">{artist ?? "Unknown artist"}{year ? ` • ${year}` : ""}</p>
              </div>
              <button type="button" onClick={() => setSheetOpen(false)} className="rounded border border-[var(--card-border)]/75 px-2 py-1 text-xs text-[var(--text-primary)]">
                close
              </button>
            </div>
            {loadingCandidates ? <p className="text-sm text-[var(--text-secondary)]">Loading candidates...</p> : null}
            {!loadingCandidates ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                {candidates.map((candidate, index) => (
                  <button
                    key={`${candidate.source}-${candidate.artist}-${candidate.title}-${index}`}
                    type="button"
                    disabled={!candidate.image || replacePending}
                    onClick={() => void applyCandidate(candidate)}
                    className="overflow-hidden rounded border border-[var(--card-border)]/70 bg-[var(--surface)] text-left transition hover:bg-[var(--surface-raised)] disabled:opacity-45"
                  >
                    <div className="aspect-square w-full bg-[var(--surface)]">
                      {candidate.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={candidate.image} alt={candidate.title} className="h-full w-full object-cover" />
                      ) : null}
                    </div>
                    <div className="space-y-0.5 p-2">
                      <p className="line-clamp-2 text-xs text-[var(--text-primary)]">{candidate.title}</p>
                      <p className="line-clamp-1 text-[11px] text-[var(--text-secondary)]">{candidate.artist}</p>
                      <p className="text-[10px] text-[var(--text-secondary)]">{candidate.source}{candidate.year ? ` • ${candidate.year}` : ""}</p>
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
