import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import DiscoverFeedShell from "@/app/discover/discover-feed-shell";
import { loadDiscoverStableFeed } from "@/app/discover/load-discover-stable";
import { HistoryBackButton } from "@/app/history-back-button";
import { getAllEras, getEraBySlug, type EraYearEntry } from "@/lib/eras";
import { albumRoute, artistRoute } from "@/lib/retroverse-routes";
import { createClient } from "@/lib/supabase";

type Search = Record<string, string | string[] | undefined>;

type EraPageProps = {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Search>;
};

function firstString(v: string | string[] | undefined): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v) && typeof v[0] === "string") return v[0];
  return undefined;
}

type CanonicalArtistRow = {
  canonical_artist_name: string;
};

type CanonicalAlbumRow = {
  canonical_album_title: string;
};

type CanonicalTrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
};

type CanonicalEntityLookup = {
  artistNameByKey: Map<string, string>;
  albumTitleByKey: Map<string, string>;
  trackByTitleKey: Map<string, { id: string; title: string }>;
};

function canonicalKey(value: string): string {
  return value.trim().toLowerCase();
}

function splitArtistTokens(value: string): string[] {
  return value
    .split(",")
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

export async function generateStaticParams() {
  return getAllEras().map((era) => ({ slug: era.slug }));
}

export async function generateMetadata({ params }: EraPageProps): Promise<Metadata> {
  const { slug } = await params;
  const era = getEraBySlug(slug);
  if (!era) {
    return { title: "Era Not Found - Retroverse" };
  }
  return {
    title: `${era.years} - ${era.title} | Retroverse`,
    description: era.summary,
  };
}

function ArchiveList({
  title,
  items,
  kind,
  lookup,
}: {
  title: string;
  items: string[];
  kind: "album" | "song";
  lookup: CanonicalEntityLookup;
}) {
  return (
    <section className="era-block space-y-2.5">
      <h2 className="font-serif text-[1.4rem] leading-tight text-[var(--text-primary)] sm:text-[1.54rem]">
        {title}
      </h2>
      <ul className="space-y-2 text-[0.98rem] leading-relaxed text-[var(--text-secondary)] sm:text-[1.04rem]">
        {items.map((item) => (
          <li key={item} className="flex gap-2.5">
            <span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--text-secondary)]/70" aria-hidden />
            {kind === "album" ? (
              lookup.albumTitleByKey.has(canonicalKey(item)) ? (
                <Link href={albumRoute(lookup.albumTitleByKey.get(canonicalKey(item)) ?? item)} className="underline-offset-2 hover:underline">
                  {item}
                </Link>
              ) : (
                <span>{item}</span>
              )
            ) : lookup.trackByTitleKey.has(canonicalKey(item)) ? (
              <Link
                href={`/tracks/${lookup.trackByTitleKey.get(canonicalKey(item))?.id ?? ""}`}
                className="underline-offset-2 hover:underline"
              >
                {item}
              </Link>
            ) : (
              <span>{item}</span>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

function KeyValue({
  label,
  value,
  lookup,
}: {
  label: string;
  value: string;
  lookup: CanonicalEntityLookup;
}) {
  const isDefiningArtists = label === "Defining artists";
  const artistTokens = isDefiningArtists ? splitArtistTokens(value) : [];

  return (
    <section className="era-block space-y-2.5">
      <h2 className="font-serif text-[1.4rem] leading-tight text-[var(--text-primary)] sm:text-[1.54rem]">
        {label}
      </h2>
      {isDefiningArtists ? (
        <p className="text-[0.98rem] leading-relaxed text-[var(--text-secondary)] sm:text-[1.04rem]">
          {artistTokens.map((token, idx) => {
            const canonicalArtistName = lookup.artistNameByKey.get(canonicalKey(token));
            return (
              <span key={`${token}-${idx}`}>
                {idx > 0 ? ", " : ""}
                {canonicalArtistName ? (
                  <Link href={artistRoute(canonicalArtistName)} className="underline-offset-2 hover:underline">
                    {token}
                  </Link>
                ) : (
                  token
                )}
              </span>
            );
          })}
        </p>
      ) : (
        <p className="text-[0.98rem] leading-relaxed text-[var(--text-secondary)] sm:text-[1.04rem]">{value}</p>
      )}
    </section>
  );
}

function YearEntry({ yearData }: { yearData: EraYearEntry }) {
  const fields = [
    { title: "Defining Musical Traits", value: yearData["Defining Musical Traits"] },
    { title: "Emotional Atmosphere", value: yearData["Emotional Atmosphere"] },
    { title: "Chart/Radio Identity", value: yearData["Chart/Radio Identity"] },
    { title: "Major Transitions", value: yearData["Major Transitions"] },
    { title: "Notable Cultural Moments", value: yearData["Notable Cultural Moments"] },
    { title: "Dominant Sounds", value: yearData["Dominant Sounds"] },
    { title: "Artist Breakthroughs", value: yearData["Artist Breakthroughs"] },
  ].filter((field) => field.value && field.value.trim().length > 0);

  return (
    <article className="era-year-block border-l-2 pl-3 sm:pl-4">
      <h3 className="font-serif text-[1.22rem] text-[var(--text-primary)] sm:text-[1.35rem]">{yearData.year}</h3>
      <div className="mt-2.5 space-y-3.5">
        {fields.map((field) => (
          <div key={`${yearData.year}-${field.title}`}>
            <p className="text-[0.78rem] uppercase tracking-[0.09em] text-[var(--text-secondary)]">{field.title}</p>
            <p className="mt-1 text-[0.98rem] leading-relaxed text-[var(--text-secondary)] sm:text-[1.04rem]">
              {field.value}
            </p>
          </div>
        ))}
      </div>
    </article>
  );
}

/**
 * Era pages are essentially static (chart data only changes when Bob runs an
 * import). `generateStaticParams` above pre-renders all era slugs at build
 * time; this ISR window keeps them fresh without re-rendering on every nav.
 * Artwork swaps still take effect via `revalidateTag('artwork:<id>')` from
 * the save endpoint.
 */
export const revalidate = 3600;

export default async function EraDetailPage({ params, searchParams }: EraPageProps) {
  const { slug } = await params;
  const era = getEraBySlug(slug);
  if (!era) {
    notFound();
  }

  const sp = await searchParams;
  const pageRaw = parseInt(firstString(sp.page) ?? "1", 10);
  const page = Number.isFinite(pageRaw) && pageRaw > 0 ? pageRaw : 1;
  const feedBundle = await loadDiscoverStableFeed({ eraSlug: slug, page });

  const supabase = createClient();
  const [artistsResult, albumsResult, tracksResult] = await Promise.all([
    supabase.from("retroverse_artists").select("canonical_artist_name"),
    supabase.from("retroverse_albums").select("canonical_album_title"),
    supabase.from("retroverse_tracks").select("retroverse_track_id, canonical_title").range(0, 5000),
  ]);
  if (artistsResult.error) throw artistsResult.error;
  if (albumsResult.error) throw albumsResult.error;
  if (tracksResult.error) throw tracksResult.error;

  const lookup: CanonicalEntityLookup = {
    artistNameByKey: new Map(
      ((artistsResult.data ?? []) as CanonicalArtistRow[]).map((row) => [canonicalKey(row.canonical_artist_name), row.canonical_artist_name]),
    ),
    albumTitleByKey: new Map(
      ((albumsResult.data ?? []) as CanonicalAlbumRow[]).map((row) => [canonicalKey(row.canonical_album_title), row.canonical_album_title]),
    ),
    trackByTitleKey: new Map(
      ((tracksResult.data ?? []) as CanonicalTrackRow[]).map((row) => [
        canonicalKey(row.canonical_title),
        { id: row.retroverse_track_id, title: row.canonical_title },
      ]),
    ),
  };

  return (
    <>
      <div className="min-h-full bg-[var(--page-gradient)]">
        <article className="eras-shell mx-auto max-w-[54rem] px-4 py-10 pb-8 sm:px-6 sm:py-14">
          <header className="eras-head mb-9 border-l-4 pl-3 sm:pl-4" style={{ borderLeftColor: era.accent }}>
            <p className="text-[0.74rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
              <Link href="/eras" className="underline-offset-2 hover:underline">
                Eras
              </Link>
              {" → "}
              {era.title}
            </p>
            <p className="text-[0.9rem] tracking-[0.04em] text-[var(--text-secondary)]">Archive issue</p>
            <h1 className="mt-2 font-serif text-[2.2rem] leading-[1.08] tracking-tight text-[var(--text-primary)] sm:text-[2.8rem]">
              {era.title}
            </h1>
            <p className="mt-1 text-[0.88rem] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{era.years}</p>
            <p className="mt-4 max-w-[42ch] text-[1.02rem] leading-relaxed text-[var(--text-secondary)] sm:text-[1.08rem]">
              {era.summary}
            </p>
          </header>

          <div className="mb-8">
            <HistoryBackButton
              fallbackHref="/eras"
              label="Back"
              className="inline-flex items-center rounded-full border border-[var(--card-border)] px-4 py-2.5 text-base font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
            />
          </div>
        </article>
      </div>

      <DiscoverFeedShell
        rows={feedBundle.rows}
        stats={feedBundle.stats}
        pagination={feedBundle.pagination}
        eraNav={feedBundle.eraNav}
        eraSlug={slug}
      />

      <div className="min-h-full bg-[var(--page-gradient)]">
        <article className="eras-shell mx-auto max-w-[54rem] px-4 pb-14 pt-4 sm:px-6 sm:pb-16">
          <main className="eras-grid space-y-10">
          <section className="max-w-[42rem] space-y-8 border-l-2 border-[var(--card-border)]/62 pl-4 sm:pl-5">
            <KeyValue label="Cultural atmosphere" value={era.sections.culturalMood} lookup={lookup} />
            <KeyValue label="Dominant sounds and movements" value={era.sections.dominantGenres} lookup={lookup} />
            <KeyValue label="Radio and chart identity" value={era.sections.chartBehavior} lookup={lookup} />
          </section>

          <section className="grid gap-8 lg:grid-cols-2">
            <KeyValue label="Defining artists" value={era.sections.definingArtists} lookup={lookup} />
            <KeyValue label="Technology and media shifts" value={era.sections.technologyMedia} lookup={lookup} />
          </section>

          {((era.definingAlbums && era.definingAlbums.length > 0) || (era.definingSongs && era.definingSongs.length > 0)) ? (
            <section className="space-y-4">
              <h2 className="font-serif text-[1.5rem] leading-tight text-[var(--text-primary)] sm:text-[1.64rem]">
                Dominant works in circulation
              </h2>
              {era.definingAlbums && era.definingAlbums.length > 0 ? (
                <ArchiveList title="Albums" items={era.definingAlbums} kind="album" lookup={lookup} />
              ) : null}
              {era.definingSongs && era.definingSongs.length > 0 ? (
                <ArchiveList title="Songs" items={era.definingSongs} kind="song" lookup={lookup} />
              ) : null}
            </section>
          ) : null}

          <section className="max-w-[42rem]">
            <KeyValue label="Transition from previous era" value={era.sections.transitionFromPrevious} lookup={lookup} />
          </section>

          {era.chronology && era.chronology.length > 0 ? (
            <section className="era-block">
              <h2 className="font-serif text-[1.42rem] leading-tight text-[var(--text-primary)] sm:text-[1.56rem]">
                Year-by-year archive
              </h2>
              <div className="mt-4 space-y-7">
                {era.chronology.map((entry) => (
                  <YearEntry key={entry.year} yearData={entry} />
                ))}
              </div>
            </section>
          ) : null}
        </main>
        </article>
      </div>
    </>
  );
}
