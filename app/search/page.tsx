import type { Metadata } from "next";
import Link from "next/link";

import {
  albumTitleSearchRank,
  albumTitleSearchVariants,
  ilikePattern,
  sanitizeSearchQuery,
} from "@/lib/corpus-search";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { artistRoute } from "@/lib/retroverse-routes";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { createClient } from "@/lib/supabase";

import { SearchAlbumRow, type SearchAlbumRowProps } from "./search-album-row";

export const metadata: Metadata = {
  title: "Search · Retroverse",
  description: "Find an album or artist in the archive.",
};

export const dynamic = "force-dynamic";

const ID_CHUNK = 120;
const ALBUM_SUBSTRING_FETCH_CAP = 500;
const ARTIST_NAME_FETCH_CAP = 80;
const ARTIST_EXPAND_MAX_ARTISTS = 28;
const ALBUMS_PER_ARTIST_CAP = 36;
const ALBUM_RESULTS_DISPLAY_CAP = 200;

type ArtistHit = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type MatchSource = "title" | "artist";

type WorkingAlbum = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  matchSource: MatchSource;
};

function chunk<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) {
    out.push(rows.slice(i, i + size));
  }
  return out;
}

function classifyTrustState(
  artworkStatus: string | null | undefined,
  canonicalCoverPath: string | null,
): SearchAlbumRowProps["trustState"] {
  const status = (artworkStatus ?? "").toLowerCase();
  if (
    !canonicalCoverPath?.trim() ||
    status === "missing" ||
    status === "rejected" ||
    status === "low_confidence" ||
    status === "unresolved"
  ) {
    return "unresolved";
  }
  if (
    status === "pending" ||
    status === "needs_review" ||
    status === "provisional" ||
    status === "review_needed" ||
    status === "candidate"
  ) {
    return "provisional";
  }
  return "verified";
}

async function loadArtistDiscographyStats(
  supabase: ReturnType<typeof createClient>,
  artistIds: string[],
): Promise<Map<string, { count: number; minYear: number | null; maxYear: number | null }>> {
  const map = new Map<string, { count: number; minYear: number | null; maxYear: number | null }>();
  for (const id of artistIds) {
    map.set(id, { count: 0, minYear: null, maxYear: null });
  }
  if (artistIds.length === 0) return map;

  let from = 0;
  const pageSize = 1000;
  for (;;) {
    const { data, error } = await supabase
      .from("retroverse_albums")
      .select("retroverse_artist_id, release_year")
      .in("retroverse_artist_id", artistIds)
      .range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as { retroverse_album_id?: string; retroverse_artist_id: string; release_year: number | null }[];
    if (rows.length === 0) break;
    for (const row of rows) {
      const s = map.get(row.retroverse_artist_id);
      if (!s) continue;
      s.count += 1;
      const y = row.release_year;
      if (y !== null && Number.isFinite(y)) {
        s.minYear = s.minYear === null ? y : Math.min(s.minYear, y);
        s.maxYear = s.maxYear === null ? y : Math.max(s.maxYear, y);
      }
    }
    from += pageSize;
    if (rows.length < pageSize) break;
  }
  return map;
}

function sortMergedAlbums(a: WorkingAlbum, b: WorkingAlbum, q: string): number {
  const tierA = a.matchSource === "title" ? 0 : 1;
  const tierB = b.matchSource === "title" ? 0 : 1;
  if (tierA !== tierB) return tierA - tierB;
  if (tierA === 0) {
    const ra = albumTitleSearchRank(a.canonical_album_title, q);
    const rb = albumTitleSearchRank(b.canonical_album_title, q);
    if (ra !== rb) return ra - rb;
  }
  const ya = a.release_year ?? 0;
  const yb = b.release_year ?? 0;
  if (ya !== yb) return yb - ya;
  return a.canonical_album_title.localeCompare(b.canonical_album_title);
}

function formatArtistYears(minY: number | null, maxY: number | null): string | null {
  if (minY === null && maxY === null) return null;
  if (minY !== null && maxY !== null) {
    if (minY === maxY) return String(minY);
    return `${minY}–${maxY}`;
  }
  return String(minY ?? maxY);
}

export default async function SearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const sp = await searchParams;
  const q = sanitizeSearchQuery(typeof sp.q === "string" ? sp.q : "");
  const supabase = createClient();

  let albumPayload: SearchAlbumRowProps[] = [];
  let albumListTruncated = false;
  let albumTotalCount = 0;
  const artists: ArtistHit[] = [];
  let error: string | null = null;
  let artistStats = new Map<string, { count: number; minYear: number | null; maxYear: number | null }>();

  if (q.length >= 2) {
    try {
      /** Dedup: prefer title match over artist match */
      const albumById = new Map<string, WorkingAlbum>();

      const titleVariants = albumTitleSearchVariants(q);
      for (const variant of titleVariants) {
        const pattern = ilikePattern(variant);
        const aRes = await supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year")
          .ilike("canonical_album_title", pattern)
          .limit(ALBUM_SUBSTRING_FETCH_CAP);
        if (aRes.error) throw aRes.error;
        for (const row of (aRes.data ?? []) as WorkingAlbum[]) {
          const id = row.retroverse_album_id;
          const prev = albumById.get(id);
          const next: WorkingAlbum = {
            retroverse_album_id: id,
            canonical_album_title: row.canonical_album_title,
            retroverse_artist_id: row.retroverse_artist_id,
            release_year: row.release_year,
            matchSource: "title",
          };
          if (!prev || prev.matchSource === "artist") albumById.set(id, next);
        }
      }

      const rRes = await supabase
        .from("retroverse_artists")
        .select("retroverse_artist_id, canonical_artist_name")
        .ilike("canonical_artist_name", ilikePattern(q))
        .order("canonical_artist_name", { ascending: true })
        .limit(ARTIST_NAME_FETCH_CAP);
      if (rRes.error) throw rRes.error;
      artists.push(...((rRes.data ?? []) as ArtistHit[]));

      const expandIds = artists.slice(0, ARTIST_EXPAND_MAX_ARTISTS).map((a) => a.retroverse_artist_id);
      await Promise.all(
        expandIds.map(async (artistId) => {
          const sub = await supabase
            .from("retroverse_albums")
            .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year")
            .eq("retroverse_artist_id", artistId)
            .order("release_year", { ascending: false })
            .limit(ALBUMS_PER_ARTIST_CAP);
          if (sub.error) throw sub.error;
          for (const row of (sub.data ?? []) as WorkingAlbum[]) {
            const id = row.retroverse_album_id;
            const prev = albumById.get(id);
            const next: WorkingAlbum = {
              retroverse_album_id: id,
              canonical_album_title: row.canonical_album_title,
              retroverse_artist_id: row.retroverse_artist_id,
              release_year: row.release_year,
              matchSource: "artist",
            };
            if (!prev) albumById.set(id, next);
          }
        }),
      );

      const merged = [...albumById.values()];
      merged.sort((a, b) => sortMergedAlbums(a, b, q));
      const mergedLimited = merged.slice(0, ALBUM_RESULTS_DISPLAY_CAP);
      albumTotalCount = merged.length;
      albumListTruncated = merged.length > ALBUM_RESULTS_DISPLAY_CAP;

      const artistNameById = new Map<string, string>();
      const neededArtistIds = [...new Set(mergedLimited.map((a) => a.retroverse_artist_id))];
      for (const idChunk of chunk(neededArtistIds, ID_CHUNK)) {
        const part = await supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .in("retroverse_artist_id", idChunk);
        if (part.error) throw part.error;
        for (const row of (part.data ?? []) as ArtistHit[]) {
          artistNameById.set(row.retroverse_artist_id, row.canonical_artist_name);
        }
      }

      const editionByAlbum = new Map<string, string>();
      const albumIds = mergedLimited.map((a) => a.retroverse_album_id);
      for (const idChunk of chunk(albumIds, ID_CHUNK)) {
        const part = await supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id")
          .in("retroverse_album_id", idChunk)
          .eq("is_primary", true);
        if (part.error) throw part.error;
        for (const row of (part.data ?? []) as { retroverse_album_edition_id: string; retroverse_album_id: string }[]) {
          editionByAlbum.set(row.retroverse_album_id, row.retroverse_album_edition_id);
        }
      }

      const artworkAcc: Awaited<ReturnType<typeof loadAlbumArtworkRows>> = [];
      for (const idChunk of chunk(albumIds, ID_CHUNK)) {
        artworkAcc.push(...(await loadAlbumArtworkRows(supabase, idChunk)));
      }

      albumPayload = mergedLimited.map((album) => {
        const aw = selectCanonicalArtwork(artworkAcc, album.retroverse_album_id, editionByAlbum.get(album.retroverse_album_id) ?? null);
        const path = aw?.canonical_cover_path ?? null;
        const trustState = classifyTrustState(aw?.artwork_status ?? null, path);
        return {
          albumId: album.retroverse_album_id,
          title: album.canonical_album_title.trim(),
          artist: (artistNameById.get(album.retroverse_artist_id) ?? "Unknown artist").trim() || "Unknown artist",
          year: album.release_year,
          coverUrl: canonicalCoverPathToUrl(path),
          canonicalCoverPath: path,
          trustState,
        };
      });

      artistStats = await loadArtistDiscographyStats(
        supabase,
        artists.map((r) => r.retroverse_artist_id),
      );
    } catch (e) {
      error = e instanceof Error ? e.message : "search_failed";
    }
  }

  return (
    <div className="mx-auto max-w-xl px-4 py-8 sm:px-6">
      <header className="mb-2">
        <h1 className="font-serif text-[1.75rem] tracking-tight text-[var(--text-primary)] sm:text-[2rem]">Search</h1>
        <p className="mt-2 max-w-md text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">
          Albums by title (with spelling variants) and by matching artist names. Same archive data as Discover.
        </p>
      </header>

      <form className="mt-7 flex flex-col gap-3 sm:flex-row sm:items-stretch" action="/search" method="get" role="search">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rumours, Fleetwood Mac, Thriller…"
          className="min-h-[3rem] min-w-0 flex-1 rounded-xl border border-[var(--card-border)]/70 bg-[var(--surface-raised)]/50 px-4 py-3 text-base text-[var(--text-primary)]"
          autoComplete="off"
        />
        <button
          type="submit"
          className="min-h-[3rem] shrink-0 rounded-xl border border-[var(--card-border)]/85 bg-[var(--surface-muted)] px-6 text-base font-medium text-[var(--text-primary)]"
        >
          Search
        </button>
      </form>

      {q.length > 0 && q.length < 2 ? (
        <p className="mt-5 text-[0.95rem] text-[var(--text-secondary)]">Enter at least 2 characters.</p>
      ) : null}

      {error ? <p className="mt-5 text-[0.95rem] text-red-400">{error}</p> : null}

      {q.length >= 2 && !error ? (
        <div className="mt-10 space-y-12">
          <section>
            <h2 className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Albums</h2>
            {albumPayload.length === 0 ? (
              <p className="text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">No albums matched this query.</p>
            ) : (
              <ul className="flex flex-col gap-3 sm:gap-4">
                {albumPayload.map((a) => (
                  <li key={a.albumId}>
                    <SearchAlbumRow {...a} />
                  </li>
                ))}
              </ul>
            )}
            {albumListTruncated ? (
              <p className="mt-4 text-[0.85rem] leading-relaxed text-[var(--text-secondary)]">
                Showing the top {ALBUM_RESULTS_DISPLAY_CAP} album results ({albumTotalCount} total matches). Refine your query to narrow the list.
              </p>
            ) : null}
          </section>

          <section>
            <h2 className="mb-4 text-[0.72rem] font-semibold uppercase tracking-[0.2em] text-[var(--text-secondary)]">Artists</h2>
            {artists.length === 0 ? (
              <p className="text-[0.95rem] leading-relaxed text-[var(--text-secondary)]">No artist names matched this query.</p>
            ) : (
              <ul className="flex flex-col gap-3 sm:gap-4">
                {artists.map((r) => {
                  const st = artistStats.get(r.retroverse_artist_id);
                  const count = st?.count ?? 0;
                  const years = formatArtistYears(st?.minYear ?? null, st?.maxYear ?? null);
                  const meta =
                    count === 0
                      ? "No albums in corpus"
                      : years
                        ? `${count} album${count === 1 ? "" : "s"} · ${years}`
                        : `${count} album${count === 1 ? "" : "s"}`;
                  return (
                    <li key={r.retroverse_artist_id}>
                      <Link
                        href={artistRoute(r.canonical_artist_name)}
                        className="block rounded-2xl border border-[var(--card-border)]/50 bg-[var(--surface-raised)]/55 px-4 py-4 shadow-[0_16px_40px_-28px_rgba(0,0,0,0.75)] transition hover:border-[var(--card-border)]/85 hover:bg-[var(--surface-raised)]/75 active:scale-[0.99] sm:px-5 sm:py-[1.15rem]"
                      >
                        <p className="font-serif text-xl leading-snug tracking-tight text-[var(--text-primary)] sm:text-[1.35rem]">
                          {r.canonical_artist_name}
                        </p>
                        <p className="mt-2 text-[0.72rem] font-medium uppercase tracking-[0.16em] text-[var(--text-secondary)]/90">Artist</p>
                        <p className="mt-2 font-mono text-[0.68rem] leading-snug text-[var(--text-secondary)]/55">{meta}</p>
                        <p className="mt-1 font-mono text-[0.65rem] text-[var(--text-secondary)]/45">{r.retroverse_artist_id}</p>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
