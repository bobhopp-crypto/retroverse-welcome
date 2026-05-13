"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";

import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";

type ArtworkFrameProps = {
  title: string;
  canonicalCoverPath: string | null;
  albumId?: string;
  artist?: string;
  year?: number | null;
  artworkStatus?: string | null;
};

type CandidateChoice = {
  source: "discogs" | "itunes";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
};

function trustTone(status: string | null | undefined, hasCover: boolean): "none" | "soft" | "strong" {
  if (!hasCover || status === "missing") return "strong";
  if (status === "verified") return "none";
  if (status === "pending") return "soft";
  if (status === "rejected") return "strong";
  return "none";
}

export function ArtworkFrame({ title, canonicalCoverPath, albumId, artist, year = null, artworkStatus = null }: ArtworkFrameProps) {
  const router = useRouter();
  const [imageFailed, setImageFailed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [candidates, setCandidates] = useState<CandidateChoice[]>([]);
  const [loading, setLoading] = useState(false);
  const [applyPending, setApplyPending] = useState(false);
  const pressTimer = useRef<number | null>(null);

  const normalizedSrc = useMemo(() => canonicalCoverPathToUrl(canonicalCoverPath), [canonicalCoverPath]);
  const tone = trustTone(artworkStatus, Boolean(normalizedSrc && !imageFailed));

  function clearPressTimer() {
    if (pressTimer.current !== null) {
      window.clearTimeout(pressTimer.current);
      pressTimer.current = null;
    }
  }

  function openSheet() {
    if (!albumId || !artist) return;
    setSheetOpen(true);
    if (candidates.length > 0) return;
    setLoading(true);
    void fetch(`/api/artwork-workbench/candidates?artist=${encodeURIComponent(artist)}&title=${encodeURIComponent(title)}`)
      .then(async (res) => {
        if (!res.ok) throw new Error();
        const body = (await res.json()) as { candidates?: CandidateChoice[] };
        setCandidates(body.candidates ?? []);
      })
      .catch(() => setCandidates([]))
      .finally(() => setLoading(false));
  }

  async function applyCandidate(candidate: CandidateChoice) {
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

  if (!normalizedSrc || imageFailed) {
    return (
      <>
        <button
          type="button"
          onContextMenu={(event) => {
            event.preventDefault();
            if (albumId) router.push(`/portal-v2/curate?albumId=${encodeURIComponent(albumId)}`);
          }}
          onPointerDown={() => {
            clearPressTimer();
            pressTimer.current = window.setTimeout(() => {
              if (albumId) router.push(`/portal-v2/curate?albumId=${encodeURIComponent(albumId)}`);
            }, 520);
          }}
          onPointerUp={clearPressTimer}
          onPointerCancel={clearPressTimer}
          className="relative flex aspect-square w-full items-center justify-center rounded-xl border border-[var(--card-border)] bg-[var(--surface-raised)] p-4 text-center text-sm text-[var(--text-secondary)]"
        >
          <p>Cover unavailable</p>
          <span className="absolute right-2 top-2 h-3 w-3 rounded-full bg-rose-500/90 ring-1 ring-black/40" />
        </button>
        {sheetOpen ? (
          <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/50 p-2 sm:items-center">
            <div className="max-h-[85vh] w-full max-w-3xl overflow-auto rounded-lg border border-[var(--card-border)]/80 bg-[var(--surface-raised)] p-3">
              <div className="mb-2 flex items-start justify-between gap-3 border-b border-[var(--card-border)]/60 pb-2">
                <div>
                  <p className="text-xs tracking-[0.08em] text-[var(--text-secondary)] uppercase">Curator Repair</p>
                  <h4 className="font-serif text-lg text-[var(--text-primary)]">{title}</h4>
                </div>
                <button type="button" onClick={() => setSheetOpen(false)} className="rounded border border-[var(--card-border)]/75 px-2 py-1 text-xs text-[var(--text-primary)]">
                  close
                </button>
              </div>
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
        onPointerDown={() => {
          clearPressTimer();
          pressTimer.current = window.setTimeout(() => {
            if (albumId) router.push(`/portal-v2/curate?albumId=${encodeURIComponent(albumId)}`);
          }, 520);
        }}
        onPointerUp={clearPressTimer}
        onPointerCancel={clearPressTimer}
        className="relative overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--surface-raised)] shadow-[var(--card-shadow)]"
      >
        <Image
          src={normalizedSrc}
          alt={`${title} canonical artwork`}
          width={1200}
          height={1200}
          unoptimized
          className="h-auto w-full object-cover"
          onError={() => setImageFailed(true)}
        />
        {tone === "soft" ? <span className="absolute right-2 top-2 h-2.5 w-2.5 rounded-full bg-amber-300/90 ring-1 ring-black/35" /> : null}
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
