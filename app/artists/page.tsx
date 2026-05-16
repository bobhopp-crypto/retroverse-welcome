import type { Metadata } from "next";
import Link from "next/link";

import { listArtistsFromDossierBundle } from "@/lib/load-artist-dossier-fallback";
import { getArtistUniverseBundle, listArtistUniverseIndex } from "@/lib/load-artist-universe";
import { hrefForUniverseArtist } from "@/lib/load-artist-universe-experience";
import type { ArtistUniverseIndexRow } from "@/lib/artist-universe-schema";
import { artistRoute } from "@/lib/retroverse-routes";

import "./artist-universe.css";

export const metadata: Metadata = {
  title: "Artists - Retroverse",
  description: "Canonical artist archive index.",
};

export const revalidate = 3600;

type ArtistsPageProps = {
  searchParams: Promise<{ q?: string }>;
};

function formatYearSpan(row: ArtistUniverseIndexRow): string | null {
  if (row.active_first === null && row.active_last === null) return null;
  if (row.active_first === row.active_last) return String(row.active_first);
  if (row.active_first !== null && row.active_last !== null) {
    return `${row.active_first}–${row.active_last}`;
  }
  return row.active_last !== null ? String(row.active_last) : String(row.active_first);
}

function formatDominantYears(years: number[]): string | null {
  if (years.length === 0) return null;
  return years.slice(0, 3).join(" · ");
}

export default async function ArtistsIndexPage({ searchParams }: ArtistsPageProps) {
  const { q } = await searchParams;
  const query = (q ?? "").trim().toLowerCase();

  if (getArtistUniverseBundle()) {
    const rows = listArtistUniverseIndex({ query });
    return renderArtistsUniverseIndex(rows, q);
  }

  console.warn("[artists:index:fallback] artist-universe.json missing — dossier index");
  return renderDossierFallbackIndex(q, query);
}

function renderDossierFallbackIndex(q: string | undefined, query: string) {
  const dossierRows = listArtistsFromDossierBundle().filter((row) =>
    query.length > 0 ? row.canonicalName.toLowerCase().includes(query) : true,
  );
  const rows: ArtistUniverseIndexRow[] = dossierRows.map((row) => ({
    artist_id: `local:${row.slug}`,
    display_name: row.canonicalName,
    slug: row.slug,
    album_count: row.albumIds.length,
    ranked_year_count: 0,
    dominant_years: [],
    active_first: null,
    active_last: null,
    signal_hue: 0,
  }));
  return renderArtistsUniverseIndex(rows, q, { hrefForRow: (row) => artistRoute(row.display_name) });
}

function renderArtistsUniverseIndex(
  rows: ArtistUniverseIndexRow[],
  q?: string,
  opts?: { hrefForRow?: (row: ArtistUniverseIndexRow) => string },
) {
  const hrefForRow = opts?.hrefForRow ?? ((row) => hrefForUniverseArtist({
    artist_id: row.artist_id,
    display_name: row.display_name,
    slug: row.slug,
  }));

  return (
    <div className="artist-universe min-h-full">
      <div className="artist-uni-atmosphere" aria-hidden />
      <article className="artist-uni-article mx-auto max-w-[46rem] px-4 py-10 pb-14 sm:px-6 sm:py-14">
        <header className="artist-uni-hero mb-8 space-y-3">
          <p className="artist-uni-eyebrow">Retroverse archive</p>
          <h1 className="artist-uni-title text-[2.2rem] sm:text-[2.8rem]">Artists</h1>
          <p className="artist-uni-sub text-[0.98rem]">Local artist universe · yearly Retroverse dominance</p>
          <form action="/artists" method="get" className="artist-uni-search pt-1">
            <input
              name="q"
              defaultValue={q ?? ""}
              placeholder="Search artists"
              className="artist-uni-search-input"
            />
          </form>
        </header>

        <ul className="artist-uni-plate artist-uni-list overflow-hidden py-1">
          {rows.length > 0 ? (
            rows.map((row) => {
              const years = formatYearSpan(row);
              const dominant = formatDominantYears(row.dominant_years);
              return (
                <li key={row.artist_id} className="artist-uni-row">
                  <div className="flex items-start gap-3">
                    <span
                      className="artist-uni-signal-dot mt-1 shrink-0"
                      style={{ ["--au-signal-hue" as string]: String(row.signal_hue) }}
                      aria-hidden
                    />
                    <div className="min-w-0 flex-1">
                      <Link href={hrefForRow(row)} className="artist-uni-inline-link text-[0.98rem] no-underline">
                        {row.display_name}
                      </Link>
                      <p className="artist-uni-meta-line text-[0.8rem]">
                        {row.album_count} albums
                        {row.ranked_year_count > 0 ? ` · ${row.ranked_year_count} ranked years` : ""}
                        {years ? ` · ${years}` : ""}
                      </p>
                      {dominant ? (
                        <p className="artist-uni-meta-line text-[0.76rem] opacity-80">
                          Peak signal · {dominant}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </li>
              );
            })
          ) : (
            <li className="artist-uni-row text-[0.94rem] opacity-80">No artists match this query.</li>
          )}
        </ul>
      </article>
    </div>
  );
}
