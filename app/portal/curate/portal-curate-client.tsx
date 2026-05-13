"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";

import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import {
  normalizeCandidateArtworkUrl,
  normalizedArtworkUrlsEqual,
} from "@/lib/artwork-candidate-fingerprint";
import { artistRoute } from "@/lib/retroverse-routes";

type WorkbenchCandidate = {
  source: "discogs";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url?: string | null;
  stagedFilePath?: string | null;
};

function candidatesMatch(a: WorkbenchCandidate | null, b: WorkbenchCandidate | null): boolean {
  if (!a || !b) return false;
  return normalizedArtworkUrlsEqual(a.image, b.image);
}

async function fetchCuratorCandidates(params: {
  artist: string;
  title: string;
  albumId: string;
  year: number | null;
}): Promise<
  | { ok: true; candidates: WorkbenchCandidate[] }
  | { ok: false; unreachable: boolean; detail: string }
> {
  const u = new URL("/api/artwork-workbench/candidates", window.location.origin);
  u.searchParams.set("artist", params.artist.trim());
  u.searchParams.set("title", params.title.trim());
  u.searchParams.set("albumId", params.albumId.trim());
  if (params.year != null && Number.isFinite(params.year)) u.searchParams.set("year", String(params.year));

  let res: Response;
  try {
    res = await fetch(u.toString());
  } catch (e) {
    return {
      ok: false,
      unreachable: true,
      detail: e instanceof Error ? `${e.name}: ${e.message}` : String(e),
    };
  }

  let body: Record<string, unknown>;
  try {
    body = (await res.json()) as Record<string, unknown>;
  } catch {
    return {
      ok: false,
      unreachable: !res.ok,
      detail: !res.ok ? `HTTP ${res.status}` : "Invalid candidates response.",
    };
  }

  if (!res.ok || body.ok === false) {
    const detail =
      typeof body.message === "string"
        ? body.message
        : typeof body.error === "string"
          ? body.error
          : `HTTP ${res.status}`;
    return { ok: false, unreachable: Boolean(body.discogsUnavailable), detail };
  }

  const unreachable = Boolean(body.discogsUnavailable);
  if (unreachable) {
    return {
      ok: false,
      unreachable: true,
      detail: "Discogs master and release searches both failed (network or HTTP error).",
    };
  }

  const raw = Array.isArray(body.candidates) ? body.candidates : [];
  const candidates = (raw as WorkbenchCandidate[]).filter((c) => c?.source === "discogs");

  return { ok: true, candidates };
}

function MechanicalBezel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-[1.65rem] border border-[#c9a86c]/22 bg-gradient-to-b from-[#1c2431]/98 to-[#070910] p-[0.42rem] shadow-[0_26px_52px_rgba(0,0,0,0.72),inset_0_1px_0_rgba(255,255,255,0.07),inset_0_-12px_28px_rgba(0,0,0,0.52)] sm:p-2.5 ${className}`}
    >
      {children}
    </div>
  );
}

function HeroCover({
  src,
  fallbackLabel,
  remixKey,
}: {
  src: string | null;
  fallbackLabel: string;
  remixKey: string;
}) {
  if (src) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        key={remixKey}
        src={src}
        alt=""
        className="h-full w-full object-cover object-center"
        draggable={false}
        loading="eager"
        decoding="sync"
      />
    );
  }
  return (
    <div
      className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_40%_35%,rgba(236,206,164,0.14),transparent_55%),linear-gradient(154deg,rgba(36,32,28,0.98),rgba(14,15,18,1))] px-4 text-center"
      role="img"
      aria-label={fallbackLabel}
    >
      <span className="text-[clamp(1rem,3.8vw,1.25rem)] leading-snug text-[#c9bfb2]">{fallbackLabel}</span>
    </div>
  );
}

function CandidateTile({
  candidate,
  active,
  hasSelection,
  onPick,
}: {
  candidate: WorkbenchCandidate;
  active: boolean;
  hasSelection: boolean;
  onPick: (c: WorkbenchCandidate) => void;
}) {
  const primary = normalizeCandidateArtworkUrl(candidate.image);
  const [showImg, setShowImg] = useState(true);

  const dimPeer = hasSelection && !active;

  return (
    <button
      type="button"
      onClick={() => onPick(candidate)}
      className={[
        "relative w-full overflow-hidden rounded-xl transition-[transform,opacity,box-shadow] duration-200 ease-out",
        "touch-manipulation active:scale-[0.98]",
        dimPeer ? "scale-100 opacity-42" : "opacity-100",
        active
          ? "z-[2] scale-[1.04] ring-[2.5px] ring-[#c9a86c]/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4),0_12px_28px_rgba(0,0,0,0.45)]"
          : "z-[1] scale-100 ring-[1.5px] ring-[#c9a86c]/22 hover:ring-[#c9a86c]/40",
      ].join(" ")}
      aria-pressed={active}
    >
      <span className="block aspect-square w-full bg-[#16141a]">
        {primary && showImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={primary}
            alt=""
            className={`h-full w-full object-cover object-center ${active ? "brightness-[1.05]" : ""}`}
            draggable={false}
            loading="eager"
            decoding="async"
            onError={() => setShowImg(false)}
          />
        ) : (
          <span className="block h-full w-full bg-[#1c1916]" aria-hidden />
        )}
      </span>
      {active ? (
        <span
          className="pointer-events-none absolute inset-0 rounded-xl bg-gradient-to-t from-[#c9a86c]/12 via-transparent to-transparent"
          aria-hidden
        />
      ) : null}
    </button>
  );
}

export default function PortalCurateClient({ row }: { row: DiscoverStableAlbumRow }) {
  const router = useRouter();
  const [candidates, setCandidates] = useState<WorkbenchCandidate[]>([]);
  const [candidateFetchFailed, setCandidateFetchFailed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<WorkbenchCandidate | null>(null);
  const [applyPending, setApplyPending] = useState(false);
  const [noteDraft, setNoteDraft] = useState("");

  const currentCoverUrl = normalizeCandidateArtworkUrl(canonicalCoverPathToUrl(row.canonicalCoverPath));

  const discogsSearchHref = useMemo(() => {
    const q = `${row.artist} ${row.title}`.replace(/\s+/g, " ").trim();
    return `https://www.discogs.com/search/?q=${encodeURIComponent(q)}`;
  }, [row.artist, row.title]);

  const grid = useMemo(() => {
    const out: WorkbenchCandidate[] = [];
    for (const c of candidates) {
      if (c.source !== "discogs") continue;
      const url = normalizeCandidateArtworkUrl(c.image);
      if (!url) continue;
      out.push({ ...c, image: url });
    }
    return out;
  }, [candidates]);

  const load = useCallback(async () => {
    setLoading(true);
    setCandidateFetchFailed(false);
    try {
      const result = await fetchCuratorCandidates({
        artist: row.artist,
        title: row.title,
        albumId: row.albumId,
        year: row.year,
      });
      if (!result.ok) {
        setCandidates([]);
        setCandidateFetchFailed(true);
        setSelected(null);
        return;
      }
      setCandidates(result.candidates);
      setSelected(null);
    } catch {
      setCandidates([]);
      setCandidateFetchFailed(true);
    } finally {
      setLoading(false);
    }
  }, [row.albumId, row.artist, row.title, row.year]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- Discogs ingest when album row context updates
    void load();
  }, [load]);

  const previewSrc = selected ? normalizeCandidateArtworkUrl(selected.image) : null;
  const heroSrc = previewSrc ?? currentCoverUrl;
  const heroRemixKey = selected
    ? `pick-${normalizeCandidateArtworkUrl(selected.image) ?? "none"}`
    : `archive-${normalizeCandidateArtworkUrl(currentCoverUrl) ?? "none"}`;

  const hasSelection = Boolean(selected);

  useEffect(() => {
    if (loading || candidateFetchFailed) return;
    for (const c of grid) {
      const u = normalizeCandidateArtworkUrl(c.image);
      if (u) {
        const img = new Image();
        img.src = u;
      }
    }
  }, [loading, candidateFetchFailed, grid]);

  async function applySelected() {
    if (!selected || applyPending) return;
    const stagedAbs = typeof selected.stagedFilePath === "string" ? selected.stagedFilePath.trim() : "";
    const img = typeof selected.image === "string" ? selected.image.trim() : "";

    let remoteHttps: string | null = null;
    if (/^https:\/\//i.test(img)) {
      remoteHttps = img;
    } else if (typeof selected.url === "string" && /^https:\/\//i.test(selected.url)) {
      remoteHttps = selected.url;
    }

    const hasStaged = stagedAbs.length > 0;
    const hasRemote = remoteHttps !== null && selected.source === "discogs";

    if (!hasStaged && !hasRemote) return;

    const replaceSource: "discogs" | "staged" = hasStaged ? "staged" : "discogs";

    setApplyPending(true);
    try {
      const res = await fetch("/api/artwork-workbench/living-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "replace_artwork",
          albumId: row.albumId,
          artist: row.artist,
          title: row.title,
          confidence: null,
          candidateSource: selected.image ?? remoteHttps,
          candidateImageUrl: hasRemote ? remoteHttps : null,
          stagedFilePath: hasStaged ? stagedAbs : null,
          sourceArtist: selected.artist,
          sourceCollection: selected.title,
          sourceReleaseDate: selected.year ? `${selected.year}-01-01` : null,
          replaceSource,
        }),
      });
      if (!res.ok) throw new Error();
      router.push("/portal");
      router.refresh();
    } catch {
      /* no-op */
    } finally {
      setApplyPending(false);
    }
  }

  const searchQ = encodeURIComponent(`${row.artist} ${row.title}`.trim());

  return (
    <div
      className="mx-auto flex min-h-[calc(100dvh-var(--rv-header-offset))] w-full max-w-[30rem] flex-col gap-4 px-[max(0.5rem,env(safe-area-inset-left))] pb-[max(1rem,env(safe-area-inset-bottom))] pr-[max(0.5rem,env(safe-area-inset-right))] pt-2"
      style={{ fontFamily: "var(--font-portal-sans), system-ui, sans-serif" }}
    >
      <div className="flex items-center justify-between gap-3 px-1">
        <Link
          href="/portal"
          className="min-h-[2.75rem] min-w-[2.75rem] touch-manipulation rounded-lg px-2 py-2 text-[1.35rem] font-medium leading-none text-[#e8dfd6] active:bg-white/[0.06]"
          aria-label="Back to portal"
        >
          ←
        </Link>
        <span className="text-center text-[clamp(0.82rem,3.4vw,0.96rem)] font-semibold uppercase tracking-[0.32em] text-[#c9a86c]">
          Curator
        </span>
        <Link
          href="/portal"
          className="min-h-[2.75rem] touch-manipulation px-3 py-2 text-[clamp(1rem,4vw,1.12rem)] font-medium text-[#c8bdb0] hover:text-[#f3ebe0]"
        >
          Done
        </Link>
      </div>

      <div className="mx-auto w-[min(92vw,calc(100vw-0.75rem))] shrink-0">
        <MechanicalBezel>
          <div
            className={`relative aspect-square w-[min(88vw,22.5rem)] overflow-hidden rounded-[1.12rem] shadow-[inset_0_0_36px_rgba(0,0,0,0.55)] ring-1 ring-black/55 transition-[box-shadow] duration-200 ${
              hasSelection ? "shadow-[inset_0_0_36px_rgba(0,0,0,0.5),0_0_0_1px_rgba(201,168,108,0.35)]" : ""
            }`}
          >
            <div
              aria-hidden
              className="pointer-events-none absolute inset-x-4 top-2.5 z-[1] h-px bg-gradient-to-r from-transparent via-white/16 to-transparent"
            />
            <HeroCover src={heroSrc} fallbackLabel={row.title} remixKey={heroRemixKey} />
          </div>
        </MechanicalBezel>
      </div>

      <div className="mx-auto w-[min(92vw,calc(100vw-0.75rem))] space-y-1.5 px-0.5 text-center">
        <p
          className="font-semibold leading-tight text-[#f3ebe0]"
          style={{
            fontFamily: "var(--font-portal-display), ui-serif, Georgia, serif",
            fontSize: "clamp(1.5rem,6.2vw,2.05rem)",
          }}
        >
          {row.title}
        </p>
        <p className="text-[clamp(1.08rem,4vw,1.32rem)] text-[#c8bdb0]">
          <Link href={artistRoute(row.artist)} className="hover:text-[#f3ebe0] hover:underline">
            {row.artist}
          </Link>
          {row.year != null ? (
            <span className="tabular-nums text-[#9a8f7e]"> · {row.year}</span>
          ) : null}
        </p>
        <div className="mt-4 flex flex-wrap justify-center gap-x-5 gap-y-2 px-2 text-[14px]">
          <a
            href={discogsSearchHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#c9a86c] underline decoration-[rgba(201,168,108,0.35)] underline-offset-2 hover:text-[#f3ebe0]"
          >
            Search Discogs
          </a>
          <a
            href={selected?.url ?? discogsSearchHref}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[#c9a86c] underline decoration-[rgba(201,168,108,0.35)] underline-offset-2 hover:text-[#f3ebe0]"
          >
            Open in Discogs
          </a>
        </div>
      </div>

      <div className="mx-auto w-[min(92vw,calc(100vw-0.75rem))]">
        {candidateFetchFailed ? (
          <div
            role="alert"
            className="mb-4 rounded-xl border border-red-500/35 bg-[rgba(80,28,28,0.22)] px-3 py-2.5 text-left text-[13px] leading-snug text-[#f0dcd8]"
          >
            <p className="font-semibold text-[#f3e6e4]">Unable to fetch alternate artwork.</p>
          </div>
        ) : null}
        {!candidateFetchFailed && loading ? (
          <p className="mb-4 text-center text-[13px] text-[#8a7f6f]">Loading alternates…</p>
        ) : null}
        {grid.length > 0 ? (
          <ul className="grid grid-cols-3 gap-2.5 sm:gap-3">
            {grid.map((c, index) => {
              const active = candidatesMatch(selected, c);
              return (
                <li key={`${normalizeCandidateArtworkUrl(c.image) ?? "c"}:${index}`} className="list-none">
                  <CandidateTile
                    candidate={c}
                    active={active}
                    hasSelection={hasSelection}
                    onPick={setSelected}
                  />
                </li>
              );
            })}
          </ul>
        ) : null}
        {!candidateFetchFailed && !loading && grid.length === 0 ? (
          <p
            className="mt-4 px-1 text-center text-[clamp(1rem,3.8vw,1.12rem)] leading-snug text-[#9a9085]"
            role="status"
          >
            Discogs returned no usable cover images for this search.
          </p>
        ) : null}
      </div>

      <div className="mx-auto w-[min(92vw,calc(100vw-0.75rem))]">
        <label htmlFor="curator-note" className="sr-only">
          Note
        </label>
        <textarea
          id="curator-note"
          name="curator-note"
          rows={3}
          value={noteDraft}
          onChange={(e) => setNoteDraft(e.target.value)}
          placeholder="Add a note…"
          className="w-full resize-none rounded-xl border border-[#c9a86c]/18 bg-[rgba(8,10,16,0.75)] px-3 py-2.5 text-[clamp(1rem,3.8vw,1.12rem)] text-[#ebe6dc] shadow-[inset_0_2px_12px_rgba(0,0,0,0.35)] placeholder:text-[#6d655c] focus:border-[#c9a86c]/40 focus:outline-none focus:ring-1 focus:ring-[#c9a86c]/25"
        />
      </div>

      <div className="mx-auto w-[min(92vw,calc(100vw-0.75rem))] flex flex-col gap-2 pt-0.5">
        <button
          type="button"
          disabled={!selected || applyPending}
          onClick={() => void applySelected()}
          className={[
            "touch-manipulation rounded-2xl py-4 text-[clamp(1.08rem,4vw,1.22rem)] font-semibold tracking-[0.08em] transition-all duration-200",
            !selected
              ? "border border-[#c9a86c]/15 bg-[#12161e] text-[#5c564e] shadow-none disabled:opacity-55"
              : applyPending
                ? "border border-[#c9a86c]/35 bg-[#2a2318] text-[#f3ebe0] opacity-90"
                : "border border-[#c9a86c]/55 bg-gradient-to-b from-[#4a3f2e] to-[#2e261c] text-[#faf6ef] shadow-[0_10px_28px_rgba(0,0,0,0.45),inset_0_1px_0_rgba(255,255,255,0.12)] active:scale-[0.99]",
          ].join(" ")}
        >
          {applyPending ? "Saving…" : "Save"}
        </button>
      </div>

      <div className="mx-auto mt-1 w-[min(92vw,calc(100vw-0.75rem))] space-y-1 border-t border-[#c9a86c]/10 pt-4">
        <nav className="flex flex-col gap-0.5 text-[clamp(1.02rem,3.9vw,1.15rem)] font-medium text-[#c8bdb0]" aria-label="Archive">
          <Link
            href={`/search?q=${searchQ}`}
            className="flex items-center justify-between rounded-lg py-2.5 pr-1 hover:bg-white/[0.04] hover:text-[#f3ebe0]"
          >
            <span>Search</span>
            <span className="text-[#c9a86c]/70" aria-hidden>
              →
            </span>
          </Link>
          <Link href="/albums" className="flex items-center justify-between rounded-lg py-2.5 pr-1 hover:bg-white/[0.04] hover:text-[#f3ebe0]">
            <span>Albums</span>
            <span className="text-[#c9a86c]/70" aria-hidden>
              →
            </span>
          </Link>
          <Link
            href={`/albums/${row.albumId}`}
            className="flex items-center justify-between rounded-lg py-2.5 pr-1 hover:bg-white/[0.04] hover:text-[#f3ebe0]"
          >
            <span>This album</span>
            <span className="text-[#c9a86c]/70" aria-hidden>
              →
            </span>
          </Link>
        </nav>
      </div>
    </div>
  );
}
