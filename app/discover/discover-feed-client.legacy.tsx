"use client";

/** Archived Discover feed (tuning, search, virtualization). Not imported — see `discover-feed-client.tsx`. */

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type CSSProperties } from "react";

export type DiscoverFeedItem = {
  albumId: string;
  title: string;
  artist: string;
  year: number | null;
  canonicalCoverPath: string | null;
  trustState: "verified" | "provisional" | "unresolved";
  mood: "iconic" | "forgotten" | "bubble_under" | "repair";
  peakChartPosition: number | null;
  searchText?: string;
  trackSearchText?: string;
  eraSlug?: string | null;
};

type DiscoverFeedProps = {
  items: DiscoverFeedItem[];
  eras: Array<{
    slug: string;
    title: string;
    startYear: number;
    endYear: number;
  }>;
  stats: {
    totalItems: number;
    realCoverItems: number;
    verifiedItems: number;
    provisionalItems: number;
    unresolvedItems: number;
  };
};

type CandidateChoice = {
  source: "discogs" | "itunes" | "local";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url: string | null;
  stagedFilePath?: string | null;
};

const unresolvedLabels = ["FIX THIS", "UNVERIFIED", "WHO AM I?"];

/** Must match `DISCOVER_STABILIZE_FEED_ROWS` in page.tsx (client-only cap for deterministic list). */
const DISCOVER_STABLE_ROW_CAP = 20;

function numericHash(input: string): number {
  let hash = 0;
  for (let index = 0; index < input.length; index += 1) {
    hash = (hash * 33 + input.charCodeAt(index)) % 1_000_000_007;
  }
  return hash;
}

function toPublicCoverPath(canonicalCoverPath: string | null): string | null {
  if (!canonicalCoverPath?.trim()) return null;
  const raw = canonicalCoverPath.trim();
  if (raw.startsWith("http://") || raw.startsWith("https://")) return raw;
  const path = `/${raw.replace(/^\/+/, "").replace(/^public\//, "")}`;
  if (path.length <= 1) return null;
  return path;
}

function atmosphereClass(item: DiscoverFeedItem): string {
  if (item.trustState === "unresolved") {
    return "bg-[radial-gradient(120%_90%_at_70%_18%,rgba(122,51,45,0.18),transparent_60%),radial-gradient(90%_80%_at_20%_82%,rgba(86,57,36,0.16),transparent_62%),linear-gradient(180deg,rgba(12,8,6,0.93)_0%,rgba(12,8,6,0.9)_100%)]";
  }
  if (item.mood === "iconic") {
    return "bg-[radial-gradient(120%_90%_at_72%_18%,rgba(119,83,52,0.16),transparent_62%),radial-gradient(90%_80%_at_22%_82%,rgba(84,62,43,0.12),transparent_64%),linear-gradient(180deg,rgba(10,8,7,0.94)_0%,rgba(10,8,7,0.9)_100%)]";
  }
  if (item.mood === "bubble_under") {
    return "bg-[radial-gradient(120%_90%_at_72%_18%,rgba(85,74,108,0.14),transparent_62%),radial-gradient(90%_80%_at_22%_82%,rgba(58,77,98,0.14),transparent_64%),linear-gradient(180deg,rgba(9,8,10,0.94)_0%,rgba(9,8,10,0.9)_100%)]";
  }
  return "bg-[radial-gradient(120%_90%_at_72%_18%,rgba(88,70,52,0.12),transparent_62%),radial-gradient(90%_80%_at_22%_82%,rgba(64,55,46,0.12),transparent_64%),linear-gradient(180deg,rgba(10,9,8,0.94)_0%,rgba(10,9,8,0.9)_100%)]";
}

function normalizeSearch(input: string): string {
  return input
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsWord(text: string, token: string): boolean {
  if (!token) return false;
  const regex = new RegExp(`\\b${escapeRegex(token)}\\b`, "i");
  return regex.test(text);
}

function scoreMemoryMatch(item: DiscoverFeedItem, query: string): number {
  const q = normalizeSearch(query);
  if (!q) return 0;
  const title = normalizeSearch(item.title);
  const artist = normalizeSearch(item.artist);
  const tracks = normalizeSearch(item.trackSearchText ?? "");
  const qTokens = q.split(" ").filter(Boolean);
  let score = 0;

  // Priority order:
  // 1) exact artist, 2) exact album, 3) partial artist, 4) partial album, 5) track fragments.
  if (artist === q) score += 1200;
  if (title === q) score += 1000;

  if (containsWord(artist, q)) score += 520;
  else if (artist.includes(q)) score += 260;

  if (containsWord(title, q)) score += 360;
  else if (title.includes(q)) score += 190;

  if (tracks.includes(q)) score += 55;

  for (const token of qTokens) {
    const shortToken = token.length <= 3;
    const artistWhole = containsWord(artist, token);
    const titleWhole = containsWord(title, token);
    const trackWhole = containsWord(tracks, token);
    const artistPartial = artist.includes(token);
    const titlePartial = title.includes(token);
    const trackPartial = tracks.includes(token);

    if (artistWhole) score += 110;
    else if (artistPartial) score += shortToken ? 6 : 34;

    if (titleWhole) score += 72;
    else if (titlePartial) score += shortToken ? 4 : 22;

    if (trackWhole) score += 18;
    else if (trackPartial) score += shortToken ? 1 : 7;

    if (shortToken && artistPartial && !artistWhole) score -= 12;
    if (shortToken && titlePartial && !titleWhole) score -= 8;
  }

  return score;
}

function isRenderableFeedRow(item: DiscoverFeedItem): boolean {
  return Boolean(item.albumId?.trim() && item.title?.trim() && item.artist?.trim());
}

const FALLBACK_COVER_STYLE: CSSProperties = {
  backgroundImage:
    "radial-gradient(circle at 16% 22%, rgba(255,244,219,0.58), transparent 35%), radial-gradient(circle at 82% 78%, rgba(94,72,53,0.5), transparent 38%), repeating-linear-gradient(0deg, rgba(39,26,15,0.11) 0px, rgba(39,26,15,0.11) 1px, transparent 1px, transparent 4px)",
};

type FeedRowItem = DiscoverFeedItem & { coverSrc: string | null };

function DiscoverAlbumCover({
  item,
  unresolvedLabel,
}: {
  item: FeedRowItem;
  unresolvedLabel: string;
}) {
  const [loadFailed, setLoadFailed] = useState(false);
  const url = item.coverSrc?.trim() ?? "";
  const showImg = Boolean(url) && !loadFailed;

  return (
    <div className="relative aspect-square w-full bg-[#22160d]">
      {showImg ? (
        // eslint-disable-next-line @next/next/no-img-element -- native img for reliable onError in long lists
        <img
          src={url}
          alt={`${item.title} album cover`}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-500 group-active:scale-[1.01] group-hover:scale-[1.006]"
          loading="lazy"
          decoding="async"
          referrerPolicy="no-referrer"
          onError={() => setLoadFailed(true)}
          onLoad={(event) => {
            const el = event.currentTarget;
            if (!el.naturalWidth) setLoadFailed(true);
          }}
        />
      ) : (
        <div className="absolute inset-0" style={FALLBACK_COVER_STYLE} aria-hidden />
      )}

      {item.trustState === "provisional" ? (
        <span className="absolute bottom-2 right-2 h-2.5 w-2.5 rounded-full bg-[#e9b553]/95 ring-1 ring-black/35" />
      ) : null}

      {item.trustState === "unresolved" ? (
        <span className="absolute right-2 top-2 rounded bg-[#7a332d]/88 px-1.5 py-0.5 text-[0.55rem] font-semibold tracking-[0.12em] text-[#fff5ef]">
          {unresolvedLabel}
        </span>
      ) : null}
    </div>
  );
}

export default function DiscoverFeed({ items, stats, eras }: DiscoverFeedProps) {
  const router = useRouter();
  const longPressTimerRef = useRef<number | null>(null);
  const longPressTriggeredRef = useRef(false);
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const spindleRef = useRef<HTMLDivElement | null>(null);
  const eraScrollPickRef = useRef<number | null>(null);
  const activeEraSlugRef = useRef<string | null>(eras[0]?.slug ?? null);
  const itemsSigRef = useRef<string | null>(null);
  const [feedItems, setFeedItems] = useState<DiscoverFeedItem[]>(items);
  const [sheetAlbumId, setSheetAlbumId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeEraSlug, setActiveEraSlug] = useState<string | null>(eras[0]?.slug ?? null);
  const [candidates, setCandidates] = useState<CandidateChoice[]>([]);
  const [candidateLoading, setCandidateLoading] = useState(false);
  const [candidateError, setCandidateError] = useState<string | null>(null);
  const [applyPending, setApplyPending] = useState(false);

  /** Defined so an identifier `tunePulse` always exists (avoids ReferenceError from stale dev chunks). Not used for ordering. */
  const tunePulse = 0;

  const normalizedItems = useMemo(
    () =>
      feedItems.map((item) => ({
        ...item,
        coverSrc: toPublicCoverPath(item.canonicalCoverPath),
      })),
    [feedItems],
  );

  const sheetAlbum = useMemo(
    () => normalizedItems.find((item) => item.albumId === sheetAlbumId) ?? null,
    [normalizedItems, sheetAlbumId],
  );
  const visibleItems = useMemo(() => {
    const query = searchQuery.trim();
    if (!query) return normalizedItems;
    return normalizedItems
      .map((item) => ({
        item,
        score: scoreMemoryMatch(item, query),
      }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((entry) => entry.item);
  }, [normalizedItems, searchQuery]);

  const listRows = useMemo(
    () => visibleItems.filter(isRenderableFeedRow).slice(0, DISCOVER_STABLE_ROW_CAP),
    [visibleItems, tunePulse],
  );

  useEffect(() => {
    const first = items[0];
    console.log("[CLIENT] discover rows", items.length, {
      albumId: first?.albumId,
      title: first?.title,
      cover: first?.canonicalCoverPath ?? null,
    });
  }, [items]);

  useEffect(() => {
    activeEraSlugRef.current = activeEraSlug;
  }, [activeEraSlug]);

  useEffect(() => {
    const sig = items.map((item) => item.albumId).join("|");
    if (itemsSigRef.current === null) {
      itemsSigRef.current = sig;
      return;
    }
    if (sig === itemsSigRef.current) return;
    itemsSigRef.current = sig;
    setFeedItems(items);
  }, [items]);

  useEffect(() => {
    document.body.classList.add("discover-immersive");
    return () => {
      document.body.classList.remove("discover-immersive");
    };
  }, []);

  useEffect(() => {
    return () => {
      if (eraScrollPickRef.current !== null) {
        window.clearTimeout(eraScrollPickRef.current);
      }
    };
  }, []);

  useEffect(() => {
    if (!spindleRef.current || !activeEraSlug) return;
    const target = spindleRef.current.querySelector<HTMLElement>(`[data-era="${activeEraSlug}"]`);
    target?.scrollIntoView({ behavior: "smooth", inline: "center", block: "nearest" });
  }, [activeEraSlug]);

  function clearLongPressTimer() {
    if (longPressTimerRef.current !== null) {
      window.clearTimeout(longPressTimerRef.current);
      longPressTimerRef.current = null;
    }
  }

  function beginLongPress(item: DiscoverFeedItem) {
    clearLongPressTimer();
    longPressTriggeredRef.current = false;
    longPressTimerRef.current = window.setTimeout(() => {
      longPressTriggeredRef.current = true;
      void openSheet(item);
    }, 520);
  }

  function finishTap(item: DiscoverFeedItem) {
    const wasLongPress = longPressTriggeredRef.current;
    clearLongPressTimer();
    if (wasLongPress) return;
    router.push(`/albums/${item.albumId}`);
  }

  async function loadCandidates(
    album: Pick<DiscoverFeedItem, "albumId" | "artist" | "title" | "year">,
    queryTitleOverride?: string,
  ) {
    setCandidateLoading(true);
    setCandidateError(null);
    const queryTitle = queryTitleOverride ?? album.title;
    try {
      const res = await fetch(
        `/api/artwork-workbench/candidates?albumId=${encodeURIComponent(album.albumId)}&artist=${encodeURIComponent(album.artist)}&title=${encodeURIComponent(queryTitle)}&year=${encodeURIComponent(String(album.year ?? ""))}`,
      );
      if (!res.ok) throw new Error("candidate_fetch_failed");
      const body = (await res.json()) as { candidates?: CandidateChoice[] };
      setCandidates((body.candidates ?? []).slice(0, 3));
      if ((body.candidates ?? []).length === 0) {
        setCandidateError("No candidates found yet.");
      }
    } catch {
      setCandidates([]);
      setCandidateError("Could not load candidates.");
    } finally {
      setCandidateLoading(false);
    }
  }

  async function openSheet(item: DiscoverFeedItem) {
    setSheetAlbumId(item.albumId);
    await loadCandidates(item);
  }

  function closeSheet() {
    setSheetAlbumId(null);
    setCandidates([]);
    setCandidateError(null);
    setCandidateLoading(false);
    setApplyPending(false);
  }

  async function applyCandidate(candidate: CandidateChoice) {
    if (!sheetAlbum || (!candidate.image && !candidate.stagedFilePath) || applyPending) return;
    setApplyPending(true);
    setCandidateError(null);
    try {
      const payload = {
        action: "replace_artwork",
        albumId: sheetAlbum.albumId,
        artist: sheetAlbum.artist,
        title: sheetAlbum.title,
        confidence: null,
        candidateSource: candidate.image,
        candidateImageUrl: candidate.stagedFilePath ? null : candidate.image,
        stagedFilePath: candidate.stagedFilePath ?? null,
        sourceArtist: candidate.artist,
        sourceCollection: candidate.title,
        sourceReleaseDate: candidate.year ? `${candidate.year}-01-01` : null,
        replaceSource: candidate.source,
      };
      const res = await fetch("/api/artwork-workbench/living-action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error("apply_failed");
      const body = (await res.json()) as { canonicalPath?: string | null };
      const canonicalCoverPath = body.canonicalPath ?? candidate.image ?? sheetAlbum.canonicalCoverPath;
      setFeedItems((prev) =>
        prev.map((item) =>
          item.albumId === sheetAlbum.albumId
            ? {
                ...item,
                canonicalCoverPath,
                trustState: "verified",
              }
            : item,
        ),
      );
      closeSheet();
    } catch {
      setCandidateError("Could not apply candidate.");
    } finally {
      setApplyPending(false);
    }
  }

  return (
    <div
      className="relative min-h-dvh w-full overflow-x-hidden bg-[#0e0b09] text-[#f3eadf]"
      data-discover-total-items={stats.totalItems}
      data-discover-real-covers={stats.realCoverItems}
      data-discover-verified={stats.verifiedItems}
      data-discover-provisional={stats.provisionalItems}
      data-discover-unresolved={stats.unresolvedItems}
    >
      <div
        aria-hidden
        className="pointer-events-none fixed inset-0 z-20"
        style={{
          boxShadow:
            "inset 0 0 0 1px rgba(255,255,255,0.06), inset 0 24px 38px -24px rgba(255,255,255,0.08), inset 0 -36px 52px -34px rgba(0,0,0,0.72), inset 16px 0 24px -22px rgba(26,19,14,0.78), inset -16px 0 24px -22px rgba(26,19,14,0.78)",
        }}
      />

      <header className="fixed inset-x-0 top-0 z-40 border-b border-[#5d4b39]/74 bg-[linear-gradient(180deg,rgba(23,18,14,0.99)_0%,rgba(14,11,9,0.99)_100%)] pt-[env(safe-area-inset-top,0px)] shadow-[0_12px_24px_-14px_rgba(0,0,0,0.92)]">
        <div className="mx-auto flex h-11 w-full max-w-[40rem] items-center gap-2 px-2.5 md:h-12 md:gap-3 md:px-3">
          <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
            <span className="h-1 w-1 rounded-full bg-[#d2a86d] shadow-[0_0_6px_rgba(210,168,109,0.55)] md:h-1.5 md:w-1.5" />
            <p className="text-[0.5rem] tracking-[0.2em] text-[#dbc7ad]/78 md:text-[0.56rem] md:tracking-[0.24em]">RETROVERSE</p>
          </div>
          <div
            role="button"
            tabIndex={0}
            onClick={() => searchInputRef.current?.focus()}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                searchInputRef.current?.focus();
              }
            }}
            className="relative h-9 flex-1 overflow-hidden rounded-lg border border-[#8f7657]/55 bg-[linear-gradient(180deg,rgba(23,18,14,0.76)_0%,rgba(14,11,9,0.84)_100%)] px-2 shadow-[inset_0_1px_0_rgba(255,240,210,0.08)] md:h-10 md:rounded-[0.7rem] md:px-2.5"
          >
            <input
              ref={searchInputRef}
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search memory..."
              className="h-full w-full bg-transparent text-[0.85rem] text-[#f3eadf] outline-none placeholder:text-[#e7d9c9]/54 md:text-[0.95rem]"
            />
          </div>
        </div>
      </header>

      <section className="relative mx-auto w-full max-w-[100vw] md:max-w-[36rem]">
        <ol className="space-y-4 pb-[calc(env(safe-area-inset-bottom,0px)+4.5rem)] pt-[calc(env(safe-area-inset-top,0px)+3rem)] md:space-y-5 md:pb-[5.5rem] md:pt-[4.25rem]">
          {listRows.map((item) => {
            const unresolvedLabel = unresolvedLabels[numericHash(item.albumId) % unresolvedLabels.length];

            return (
              <li key={item.albumId} className="relative" data-feed-row={item.albumId}>
                <article className="relative flex flex-col px-1.5 pb-3 pt-1 md:px-4">
                  <div className={`absolute inset-0 overflow-hidden ${atmosphereClass(item)}`}>
                    <div
                      className="pointer-events-none absolute inset-0 opacity-[0.26]"
                      style={{
                        background:
                          "radial-gradient(90% 70% at 50% 40%, rgba(0,0,0,0) 0%, rgba(0,0,0,0.5) 100%), repeating-radial-gradient(circle at center, rgba(255,255,255,0.012), rgba(255,255,255,0.012) 1px, transparent 1px, transparent 4px)",
                      }}
                    />
                  </div>

                  <div className="relative z-10 mx-auto w-[95.7vw] max-w-[36rem] rounded-[0.95rem] border border-white/10 bg-black/12 p-[0.36rem] shadow-[0_20px_36px_-24px_rgba(0,0,0,0.82)]">
                    <button
                      type="button"
                      aria-label={`Open album ${item.title}`}
                      className="group relative block w-full overflow-hidden rounded-[0.72rem] bg-black/10"
                      onContextMenu={(event) => {
                        event.preventDefault();
                        void openSheet(item);
                      }}
                      onPointerDown={() => beginLongPress(item)}
                      onPointerUp={() => finishTap(item)}
                      onPointerCancel={clearLongPressTimer}
                      onPointerLeave={clearLongPressTimer}
                    >
                      <DiscoverAlbumCover item={item} unresolvedLabel={unresolvedLabel} />
                    </button>

                    <div className="relative z-20 mx-1 -mt-2.5 rounded-md border border-white/8 bg-black/38 px-2.5 pb-2.5 pt-2.5 backdrop-blur-[1px]">
                      <h2 className="font-serif text-[1.64rem] leading-[1.06] tracking-tight text-[#f6eee3] drop-shadow-[0_1px_1px_rgba(0,0,0,0.35)]">
                        {item.title}
                      </h2>
                      <p className="mt-1 text-[0.96rem] tracking-[0.01em] text-[#eadcca]/84">
                        {item.artist}
                        {item.year ? ` · ${item.year}` : ""}
                      </p>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      </section>

      <footer className="fixed inset-x-0 bottom-0 z-40 border-t border-[#5d4b39]/74 bg-[linear-gradient(180deg,rgba(16,13,10,0.99)_0%,rgba(9,7,6,1)_100%)] shadow-[0_-12px_24px_-14px_rgba(0,0,0,0.92)] pb-[env(safe-area-inset-bottom,0px)]">
        <div className="mx-auto w-full max-w-[40rem] px-2 py-1.5 md:px-3 md:py-2">
          <div className="relative overflow-hidden">
            <div className="absolute inset-0 opacity-20" style={{ background: "linear-gradient(180deg,rgba(255,255,255,0.08)_0%,rgba(255,255,255,0)_55%)" }} />
            <div className="absolute inset-y-0 left-0 z-10 w-6 bg-[linear-gradient(90deg,rgba(9,7,6,0.98)_0%,rgba(9,7,6,0)_100%)] md:w-8" />
            <div className="absolute inset-y-0 right-0 z-10 w-6 bg-[linear-gradient(270deg,rgba(9,7,6,0.98)_0%,rgba(9,7,6,0)_100%)] md:w-8" />
            <div className="relative flex items-center">
              <div
                ref={spindleRef}
                onScroll={(event) => {
                  const target = event.currentTarget;
                  if (eraScrollPickRef.current !== null) {
                    window.clearTimeout(eraScrollPickRef.current);
                  }
                  eraScrollPickRef.current = window.setTimeout(() => {
                    eraScrollPickRef.current = null;
                    const center = target.scrollLeft + target.clientWidth / 2;
                    const options = Array.from(target.querySelectorAll<HTMLElement>("[data-era]"));
                    if (options.length === 0) return;
                    let closest: { slug: string; distance: number } | null = null;
                    for (const option of options) {
                      const left = option.offsetLeft;
                      const mid = left + option.offsetWidth / 2;
                      const distance = Math.abs(mid - center);
                      const slug = option.dataset.era;
                      if (!slug) continue;
                      if (!closest || distance < closest.distance) {
                        closest = { slug, distance };
                      }
                    }
                    if (closest && closest.slug !== activeEraSlugRef.current) {
                      setActiveEraSlug(closest.slug);
                    }
                  }, 160);
                }}
                className="flex max-h-14 w-full snap-x snap-mandatory gap-1 overflow-x-auto overflow-y-hidden py-0.5 [scrollbar-width:none] md:max-h-[3.25rem] [&::-webkit-scrollbar]:hidden"
              >
                {eras.map((era) => {
                  const active = activeEraSlug === era.slug;
                  return (
                    <button
                      key={era.slug}
                      data-era={era.slug}
                      type="button"
                      onClick={() => setActiveEraSlug(era.slug)}
                      className={`shrink-0 snap-center rounded-lg px-0 transition duration-300 first:pl-0.5 last:pr-0.5 ${
                        active
                          ? "text-[#f4e4ca] opacity-100"
                          : "text-[#d9c4a6]/62 opacity-45"
                      }`}
                    >
                      <span
                        className={`inline-flex h-8 max-w-[92vw] items-center rounded-md border border-[#8f7657]/58 bg-[linear-gradient(180deg,rgba(37,28,21,0.82)_0%,rgba(23,18,14,0.9)_100%)] px-2.5 shadow-[inset_0_1px_0_rgba(255,240,210,0.11)] md:h-9 md:max-w-none md:rounded-[0.76rem] md:px-3.5`}
                      >
                        <span className="whitespace-nowrap text-[0.58rem] tracking-[0.1em] md:text-[0.72rem] md:tracking-[0.12em]">{era.title.toUpperCase()}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </footer>

      {sheetAlbum ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/45 p-2 sm:items-center">
          <div className="w-full max-w-md rounded-2xl border border-[#b59675]/70 bg-[#f9f1e4] p-4 shadow-[0_28px_46px_-24px_rgba(28,17,9,0.85)]">
            <p className="text-[0.65rem] tracking-[0.16em] text-[#71543f]/80">CURATOR REPAIR</p>
            <h3 className="mt-1 font-serif text-[1.45rem] leading-tight text-[#2d2217]">{sheetAlbum.title}</h3>
            <p className="mt-1 text-sm text-[#5c4534]">
              {sheetAlbum.artist}
              {sheetAlbum.year ? ` · ${sheetAlbum.year}` : ""}
            </p>

            <div className="mt-4 rounded-lg border border-[#c8aa89]/75 bg-[#f1e3cd]/52 p-3">
              <p className="text-[0.62rem] tracking-[0.13em] text-[#71553f]/88">CURRENT ARTWORK</p>
              <div className="mt-2 overflow-hidden rounded-md border border-[#bfa281]/80 bg-[#e5d4bb]">
                <div className="relative aspect-square w-full">
                  {toPublicCoverPath(sheetAlbum.canonicalCoverPath) ? (
                    <Image
                      src={toPublicCoverPath(sheetAlbum.canonicalCoverPath) ?? ""}
                      alt={`${sheetAlbum.title} current artwork`}
                      fill
                      unoptimized
                      className="object-cover"
                    />
                  ) : (
                    <div
                      className="absolute inset-0"
                      style={{
                        backgroundImage:
                          "radial-gradient(circle at 22% 18%, rgba(255,245,221,0.72), transparent 38%), radial-gradient(circle at 78% 82%, rgba(86,64,45,0.28), transparent 44%), repeating-linear-gradient(0deg, rgba(39,26,15,0.08) 0px, rgba(39,26,15,0.08) 1px, transparent 1px, transparent 4px)",
                      }}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="mt-3 rounded-lg border border-[#c8aa89]/75 bg-[#f1e3cd]/52 p-3">
              <p className="text-[0.62rem] tracking-[0.13em] text-[#71553f]/88">TOP CANDIDATES</p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {candidateLoading
                  ? [0, 1, 2].map((slot) => (
                      <div
                        key={`loading-${slot}`}
                        className="relative aspect-square overflow-hidden rounded-md border border-[#bfa281]/70 bg-[#e8d9c3] opacity-70"
                      />
                    ))
                  : candidates.map((candidate, index) => (
                      <button
                        key={`${candidate.source}-${candidate.image ?? "none"}-${index}`}
                        type="button"
                        disabled={applyPending || (!candidate.image && !candidate.stagedFilePath)}
                        onClick={() => void applyCandidate(candidate)}
                        className="overflow-hidden rounded-md border border-[#bfa281]/80 bg-[#e5d4bb] text-left transition hover:scale-[1.01] disabled:opacity-55"
                      >
                        <div className="relative aspect-square w-full">
                          {candidate.image ? (
                            <Image
                              src={toPublicCoverPath(candidate.image) ?? candidate.image}
                              alt={`${sheetAlbum.title} candidate ${index + 1}`}
                              fill
                              unoptimized
                              className="object-cover saturate-[0.95]"
                            />
                          ) : (
                            <div
                              className="absolute inset-0"
                              style={{
                                backgroundImage:
                                  "radial-gradient(circle at 18% 22%, rgba(255,241,208,0.66), transparent 34%), radial-gradient(circle at 82% 76%, rgba(99,71,48,0.3), transparent 42%), repeating-linear-gradient(0deg, rgba(39,26,15,0.09) 0px, rgba(39,26,15,0.09) 1px, transparent 1px, transparent 4px)",
                              }}
                            />
                          )}
                        </div>
                      </button>
                    ))}
                {!candidateLoading && candidates.length < 3
                  ? Array.from({ length: 3 - candidates.length }).map((_, fillerIndex) => (
                      <button
                        key={`empty-${fillerIndex}`}
                        type="button"
                        disabled
                        className="relative aspect-square overflow-hidden rounded-md border border-[#bfa281]/70 bg-[#e8d9c3] opacity-70"
                      />
                    ))
                  : null}
              </div>
              {candidateError ? <p className="mt-2 text-[0.75rem] text-[#7a332d]">{candidateError}</p> : null}
            </div>

            <div className="mt-3 grid grid-cols-3 gap-2">
              <button
                type="button"
                onClick={() => {
                  const term = encodeURIComponent(`${sheetAlbum.artist} ${sheetAlbum.title}`);
                  window.open(`https://www.discogs.com/search/?q=${term}&type=all`, "_blank", "noopener,noreferrer");
                }}
                className="rounded-lg border border-[#9f8264]/55 bg-[#efe1cc]/72 px-2 py-2 text-xs text-[#654a35]/72"
              >
                Search Discogs
              </button>
              <button
                type="button"
                onClick={async () => {
                  const value = window.prompt("Paste image URL");
                  if (!value) return;
                  await applyCandidate({
                    source: "discogs",
                    title: sheetAlbum.title,
                    artist: sheetAlbum.artist,
                    year: sheetAlbum.year,
                    image: value.trim(),
                    url: value.trim(),
                    stagedFilePath: null,
                  });
                }}
                className="rounded-lg border border-[#9f8264]/55 bg-[#efe1cc]/72 px-2 py-2 text-xs text-[#654a35]/72"
              >
                Paste image URL
              </button>
              <button
                type="button"
                onClick={async () => {
                  const query = window.prompt("Manual search query", `${sheetAlbum.artist} ${sheetAlbum.title}`) ?? "";
                  const cleaned = query.trim();
                  if (!cleaned) return;
                  await loadCandidates(sheetAlbum, cleaned);
                }}
                className="rounded-lg border border-[#9f8264]/55 bg-[#efe1cc]/72 px-2 py-2 text-xs text-[#654a35]/72"
              >
                Manual search
              </button>
            </div>

            <div className="mt-4 flex gap-2">
              <button
                type="button"
                onClick={closeSheet}
                className="flex-1 rounded-lg border border-[#9f8264]/80 bg-[#f7eedf] px-3 py-2 text-sm text-[#35281d]"
              >
                Close
              </button>
              <button
                type="button"
                disabled
                className="flex-1 rounded-lg border border-[#9f8264]/60 bg-[#e8d9c3] px-3 py-2 text-sm text-[#70533d]/75"
              >
                Repair Queue (Soon)
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
