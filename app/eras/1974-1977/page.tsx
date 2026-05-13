import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { ArtworkFrame } from "@/app/components/artwork-frame";
import { HistoryBackButton } from "@/app/history-back-button";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { buildEraCulturalThreads, buildEraSummaryLine } from "@/lib/retroverse-editorial";
import { generateEraPathways } from "@/lib/retroverse-pathways";
import { albumRoute, artistRoute } from "@/lib/retroverse-routes";
import { createClient } from "@/lib/supabase";

export const metadata: Metadata = {
  title: "1974-1977 Era - Retroverse",
  description: "Canonical Retroverse era exploration powered by the retroverse graph.",
};
export const dynamic = "force-dynamic";

const FEATURED_ALBUMS = [
  "Saturday Night Fever",
  "Eagles Their Greatest Hits (1971-1975)",
  "Rumours",
] as const;

type EraRow = {
  retroverse_era_id: string;
  start_year: number;
  end_year: number;
  display_name: string;
  summary: string | null;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  album_type: string | null;
  soundtrack_flag: boolean;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
  soundtrack_exclusive: boolean;
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
};

type ChartRow = {
  retroverse_track_id: string;
  chart_position: number;
};

type ArtworkRow = {
  retroverse_album_id: string;
  retroverse_album_edition_id: string | null;
  artwork_role: string;
  is_primary?: boolean;
  canonical_cover_path: string | null;
};

type FeaturedAlbumCard = {
  id: string;
  title: string;
  href: string;
  artist: string;
  albumType: string;
  releaseYear: number | null;
  coverPath: string | null;
};

type ChartingTrack = {
  id: string;
  title: string;
  artist: string;
  albumTitle: string;
  peakChartPosition: number;
};

function albumTypeLabel(albumType: string | null, soundtrackFlag: boolean): string {
  if (soundtrackFlag) return "Soundtrack";
  if (!albumType) return "Album";
  if (albumType === "compilation") return "Compilation";
  if (albumType === "studio") return "Studio album";
  return "Album";
}

async function loadEraExperience() {
  const supabase = createClient();

  const eraResult = await supabase
    .from("retroverse_eras")
    .select("retroverse_era_id, start_year, end_year, display_name, summary")
    .eq("start_year", 1974)
    .limit(1)
    .maybeSingle<EraRow>();

  if (eraResult.error) throw eraResult.error;
  if (!eraResult.data) return null;

  const albumResult = await supabase
    .from("retroverse_albums")
    .select(
      "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, album_type, soundtrack_flag",
    )
    .in(
      "canonical_album_title",
      FEATURED_ALBUMS.map((title) => title),
    );

  if (albumResult.error) throw albumResult.error;
  const albums = (albumResult.data ?? []) as AlbumRow[];
  if (albums.length === 0) return null;

  const albumIds = albums.map((album) => album.retroverse_album_id);
  const albumArtistIds = [...new Set(albums.map((album) => album.retroverse_artist_id))];

  const [albumArtistsResult, primaryEditionsResult, artworkRows] = await Promise.all([
    albumArtistIds.length > 0
      ? supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .in("retroverse_artist_id", albumArtistIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .in("retroverse_album_id", albumIds)
      .eq("is_primary", true),
    loadAlbumArtworkRows(supabase, albumIds),
  ]);

  if (albumArtistsResult.error) throw albumArtistsResult.error;
  if (primaryEditionsResult.error) throw primaryEditionsResult.error;

  const albumArtists = (albumArtistsResult.data ?? []) as ArtistRow[];
  const primaryEditions = (primaryEditionsResult.data ?? []) as EditionRow[];

  const primaryEditionIds = primaryEditions.map((edition) => edition.retroverse_album_edition_id);
  const albumTracksResult =
    primaryEditionIds.length > 0
      ? await supabase
          .from("retroverse_album_tracks")
          .select("retroverse_album_edition_id, retroverse_track_id, soundtrack_exclusive")
          .in("retroverse_album_edition_id", primaryEditionIds)
      : { data: [], error: null };

  if (albumTracksResult.error) throw albumTracksResult.error;
  const albumTracks = (albumTracksResult.data ?? []) as AlbumTrackRow[];

  const trackIds = [...new Set(albumTracks.map((row) => row.retroverse_track_id))];
  const [tracksResult, chartsResult] = await Promise.all([
    trackIds.length > 0
      ? supabase
          .from("retroverse_tracks")
          .select("retroverse_track_id, canonical_title, retroverse_artist_id, release_year")
          .in("retroverse_track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
    trackIds.length > 0
      ? supabase
          .from("retroverse_chart_appearances")
          .select("retroverse_track_id, chart_position")
          .in("retroverse_track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (tracksResult.error) throw tracksResult.error;
  if (chartsResult.error) throw chartsResult.error;

  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const charts = (chartsResult.data ?? []) as ChartRow[];

  const trackArtistIds = [...new Set(tracks.map((track) => track.retroverse_artist_id))];
  const trackArtistsResult =
    trackArtistIds.length > 0
      ? await supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .in("retroverse_artist_id", trackArtistIds)
      : { data: [], error: null };

  if (trackArtistsResult.error) throw trackArtistsResult.error;
  const trackArtists = (trackArtistsResult.data ?? []) as ArtistRow[];

  const albumByTitle = new Map(albums.map((album) => [album.canonical_album_title, album]));
  const albumArtistById = new Map(albumArtists.map((artist) => [artist.retroverse_artist_id, artist]));
  const primaryEditionByAlbumId = new Map(primaryEditions.map((row) => [row.retroverse_album_id, row]));
  const albumIdByEditionId = new Map(primaryEditions.map((row) => [row.retroverse_album_edition_id, row.retroverse_album_id]));
  const trackById = new Map(tracks.map((track) => [track.retroverse_track_id, track]));
  const trackArtistById = new Map(trackArtists.map((artist) => [artist.retroverse_artist_id, artist]));

  const featuredAlbums: FeaturedAlbumCard[] = FEATURED_ALBUMS.map((title) => {
    const album = albumByTitle.get(title);
    if (!album) {
      return {
        id: title,
        title,
        href: albumRoute(title),
        artist: "Unknown artist",
        albumType: "Album",
        releaseYear: null,
        coverPath: null,
      };
    }
    const albumArtist = albumArtistById.get(album.retroverse_artist_id);
    const primaryEdition = primaryEditionByAlbumId.get(album.retroverse_album_id);
    const artwork = selectCanonicalArtwork(
      artworkRows as ArtworkRow[],
      album.retroverse_album_id,
      primaryEdition?.retroverse_album_edition_id ?? null,
    );

    return {
      id: album.retroverse_album_id,
      title: album.canonical_album_title,
      href: albumRoute(album.canonical_album_title),
      artist: albumArtist?.canonical_artist_name ?? "Unknown artist",
      albumType: albumTypeLabel(album.album_type, album.soundtrack_flag),
      releaseYear: album.release_year,
      coverPath: artwork?.canonical_cover_path ?? null,
    };
  });

  const albumIdByTrackId = new Map<string, string>();
  let soundtrackExclusiveCount = 0;
  for (const row of albumTracks) {
    const albumId = albumIdByEditionId.get(row.retroverse_album_edition_id);
    if (!albumId) continue;
    if (!albumIdByTrackId.has(row.retroverse_track_id)) {
      albumIdByTrackId.set(row.retroverse_track_id, albumId);
    }
    if (row.soundtrack_exclusive) {
      soundtrackExclusiveCount += 1;
    }
  }

  const peakChartByTrackId = new Map<string, number>();
  for (const chart of charts) {
    const previous = peakChartByTrackId.get(chart.retroverse_track_id);
    if (previous === undefined || chart.chart_position < previous) {
      peakChartByTrackId.set(chart.retroverse_track_id, chart.chart_position);
    }
  }

  const chartingTracks: ChartingTrack[] = [...peakChartByTrackId.entries()]
    .map(([trackId, peakChartPosition]) => {
      const track = trackById.get(trackId);
      const albumId = albumIdByTrackId.get(trackId);
      const album = albumId ? albums.find((row) => row.retroverse_album_id === albumId) ?? null : null;
      if (!track || !album) return null;
      const trackArtist = trackArtistById.get(track.retroverse_artist_id);
      return {
        id: track.retroverse_track_id,
        title: track.canonical_title,
        artist: trackArtist?.canonical_artist_name ?? "Unknown artist",
        albumTitle: album.canonical_album_title,
        peakChartPosition,
      };
    })
    .filter((row): row is ChartingTrack => row !== null)
    .sort((a, b) => a.peakChartPosition - b.peakChartPosition || a.title.localeCompare(b.title))
    .slice(0, 8);

  const uniqueTrackCount = trackIds.length;
  const chartedTrackCount = peakChartByTrackId.size;
  const albumCutCount = Math.max(0, uniqueTrackCount - chartedTrackCount);
  const soundtrackAlbumCount = albums.filter((album) => album.soundtrack_flag).length;
  const compilationAlbumCount = albums.filter((album) => album.album_type === "compilation").length;

  const historicalReuseCount = trackIds.reduce((count, trackId) => {
    const track = trackById.get(trackId);
    const albumId = albumIdByTrackId.get(trackId);
    const album = albumId ? albums.find((row) => row.retroverse_album_id === albumId) ?? null : null;
    if (!track || !album || track.release_year === null || album.release_year === null) return count;
    return track.release_year < album.release_year ? count + 1 : count;
  }, 0);

  const artistAlbumMembership = new Map<string, Set<string>>();
  for (const [trackId, albumId] of albumIdByTrackId.entries()) {
    const track = trackById.get(trackId);
    if (!track) continue;
    const memberships = artistAlbumMembership.get(track.retroverse_artist_id) ?? new Set<string>();
    memberships.add(albumId);
    artistAlbumMembership.set(track.retroverse_artist_id, memberships);
  }

  const recurringArtists = [...artistAlbumMembership.entries()]
    .filter(([, albumMembership]) => albumMembership.size > 1)
    .map(([artistId, albumMembership]) => ({
      artist: trackArtistById.get(artistId)?.canonical_artist_name ?? "Unknown artist",
      albums: albumMembership.size,
    }))
    .sort((a, b) => b.albums - a.albums || a.artist.localeCompare(b.artist));

  const crossoverHitCount = chartingTracks.filter((track) => {
    const album = albums.find((row) => row.canonical_album_title === track.albumTitle);
    return album ? album.soundtrack_flag || album.album_type === "compilation" : false;
  }).length;

  const pathways = await generateEraPathways(supabase, eraResult.data.retroverse_era_id);

  return {
    era: eraResult.data,
    featuredAlbums,
    chartingTracks,
    pathways,
    threads: {
      soundtrackAlbumCount,
      soundtrackExclusiveCount,
      compilationAlbumCount,
      historicalReuseCount,
      recurringArtists,
      crossoverHitCount,
      chartedTrackCount,
      albumCutCount,
    },
  };
}

export default async function Era1974to1977Page() {
  const data = await loadEraExperience();
  if (!data) notFound();
  const summaryLine = buildEraSummaryLine(data.threads);
  const culturalThreads = buildEraCulturalThreads(data.threads);
  const pathways = data.pathways;

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="mx-auto max-w-[54rem] px-4 py-10 pb-16 sm:px-6 sm:py-[4.25rem]">
        <header className="mb-11 space-y-3 border-b border-[var(--card-border)]/60 pb-6 sm:mb-14">
          <p className="text-[0.74rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <Link href="/eras" className="underline-offset-2 hover:underline">
              Eras
            </Link>
            {" → "}
            {data.era.display_name}
          </p>
          <p className="text-[0.9rem] tracking-[0.04em] text-[var(--text-secondary)]">
            Cultural environment
          </p>
          <h1 className="font-serif text-[2.4rem] leading-[1.05] tracking-tight text-[var(--text-primary)] sm:text-[3rem]">
            {data.era.display_name}
          </h1>
          <p className="text-sm uppercase tracking-[0.14em] text-[var(--text-secondary)]/85">
            1974-1977
          </p>
          <p className="max-w-[42ch] text-[1.04rem] leading-[1.68] text-[var(--text-secondary)] sm:text-[1.1rem]">
            {summaryLine}
          </p>
        </header>

        <div className="mb-9">
          <HistoryBackButton
            fallbackHref="/eras"
            label="Back"
            className="inline-flex items-center rounded-full border border-[var(--card-border)] px-4 py-2.5 text-base font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
          />
        </div>

        <section className="mb-12 max-w-[40rem] space-y-4 border-l-2 border-[var(--card-border)]/62 pl-4 sm:pl-5">
          <h2 className="font-serif text-[1.46rem] leading-[1.16] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.58rem]">
            Cultural Threads
          </h2>
          <ul className="space-y-4 text-[0.98rem] leading-[1.74] text-[var(--text-secondary)] sm:text-[1.03rem]">
            {culturalThreads.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        <section className="mb-14 space-y-4">
          <h2 className="font-serif text-[1.56rem] leading-[1.14] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.82rem]">
            Featured Albums
          </h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {data.featuredAlbums.map((album) => (
              <Link
                key={album.id}
                href={album.href}
                className="rounded-2xl border border-[var(--card-border)] bg-[var(--surface-raised)] p-3 transition-colors hover:bg-[var(--surface-muted)]"
              >
                <div className="mb-3 overflow-hidden rounded-xl border border-[var(--card-border)] bg-[var(--surface-muted)]">
                  <ArtworkFrame
                    title={album.title}
                    canonicalCoverPath={album.coverPath}
                    albumId={album.id}
                    artist={album.artist}
                    year={album.releaseYear}
                  />
                </div>
                <p className="font-serif text-[1.15rem] leading-tight text-[var(--text-primary)]">{album.title}</p>
                <p className="mt-1 text-sm text-[var(--text-secondary)]">{album.artist}</p>
                <p className="mt-2 text-[0.69rem] uppercase tracking-[0.13em] text-[var(--text-secondary)]/82">
                  {album.albumType}
                  {album.releaseYear !== null ? ` · ${album.releaseYear}` : ""}
                </p>
              </Link>
            ))}
          </div>
        </section>

        <section className="mb-12 max-w-[42rem] space-y-3">
          <h2 className="font-serif text-[1.5rem] leading-[1.15] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.72rem]">
            Charting Tracks
          </h2>
          <ul className="space-y-1">
            {data.chartingTracks.map((track) => (
              <li key={track.id} className="py-2.5">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div className="min-w-0 pr-2">
                    <p className="text-[0.98rem] font-medium text-[var(--text-primary)] sm:text-[1.01rem]">
                      <Link href={`/tracks/${track.id}`} className="underline-offset-2 hover:underline">
                        {track.title}
                      </Link>{" "}
                      -{" "}
                      <Link href={artistRoute(track.artist)} className="underline-offset-2 hover:underline">
                        {track.artist}
                      </Link>
                    </p>
                    <p className="text-[0.9rem] text-[var(--text-secondary)]">
                      <Link href={albumRoute(track.albumTitle)} className="underline-offset-2 hover:underline">
                        {track.albumTitle}
                      </Link>
                    </p>
                  </div>
                  <span className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/82">
                    Peak #{track.peakChartPosition}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>

        <section className="mt-10 max-w-[40rem] space-y-4">
          <h2 className="font-serif text-[1.46rem] leading-[1.16] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.58rem]">
            Continue Through...
          </h2>
          <ul className="space-y-1">
            {pathways.length > 0 ? (
              pathways.map((pathway) => (
                <li key={pathway.key} className="py-2.5">
                  <Link href={pathway.href} className="block hover:underline">
                    <p className="text-[0.98rem] font-medium text-[var(--text-primary)] sm:text-[1.01rem]">{pathway.label}</p>
                    <p className="text-[0.84rem] text-[var(--text-secondary)]/85 sm:text-[0.88rem]">{pathway.summary}</p>
                  </Link>
                </li>
              ))
            ) : (
              <li className="py-2.5">
                <Link href="/random" className="block hover:underline">
                  <p className="text-[0.98rem] font-medium text-[var(--text-primary)] sm:text-[1.01rem]">Explore Randomly</p>
                  <p className="text-[0.84rem] text-[var(--text-secondary)]/85 sm:text-[0.88rem]">
                    Continue through another connected era, album, artist, or track.
                  </p>
                </Link>
              </li>
            )}
          </ul>
        </section>
      </article>
    </div>
  );
}
