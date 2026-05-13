import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HistoryBackButton } from "@/app/history-back-button";
import { CompactArtworkThumb } from "@/app/components/compact-artwork-thumb";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { buildArtistContextLine, buildArtistCulturalRole } from "@/lib/retroverse-editorial";
import { generateArtistPathways } from "@/lib/retroverse-pathways";
import { albumRoute, normalizeEntitySlug } from "@/lib/retroverse-routes";
import { createClient } from "@/lib/supabase";

/**
 * Artist metadata is essentially static. ISR keeps cross-page navigation
 * fast; data refreshes hourly or on-demand via revalidateTag from saves.
 */
export const revalidate = 3600;

type ArtistPageProps = {
  params: Promise<{ slug: string }>;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_album_id: string | null;
  era_id: string | null;
  release_year: number | null;
};

type AlbumRoleRow = {
  retroverse_album_id: string;
  role: string;
  role_priority: number | null;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  album_type: string | null;
  soundtrack_flag: boolean;
  era_id: string | null;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
  disc_number: number;
  side_code: string | null;
};

type ChartRow = {
  retroverse_track_id: string;
  chart_position: number;
};

type EraRow = {
  retroverse_era_id: string;
  slug: string;
  display_name: string;
  start_year: number;
  end_year: number;
};

type AlbumAppearance = {
  id: string;
  title: string;
  href: string;
  albumTypeLabel: string;
  releaseYear: number | null;
  roleLabel: string | null;
  coverPath: string | null;
  artworkStatus: string | null;
};

type ArtistChartTrack = {
  id: string;
  title: string;
  albumTitle: string;
  albumHref: string;
  releaseYear: number | null;
  peakChartPosition: number;
  contextLabel: string;
  eraId: string | null;
};

type EraConnection = {
  id: string;
  name: string;
  href: string;
  trackCount: number;
  chartingTrackCount: number;
};

function roleLabel(role: string | null): string | null {
  if (!role) return null;
  if (role === "primary") return "Primary artist";
  if (role === "soundtrack_primary") return "Soundtrack contributor";
  return role.replaceAll("_", " ");
}

function albumTypeLabel(albumType: string | null, soundtrackFlag: boolean): string {
  if (soundtrackFlag) return "Soundtrack";
  if (albumType === "compilation") return "Compilation";
  if (albumType === "studio") return "Studio album";
  return "Album";
}

function eraHref(era: EraRow): string {
  if (era.start_year === 1974) return "/eras/1974-1977";
  return `/eras/${era.slug}`;
}

async function resolveArtistBySlug(slug: string, supabase: ReturnType<typeof createClient>): Promise<ArtistRow | null> {
  if (/^RVAR[0-9]{6}$/i.test(slug)) {
    const byIdResult = await supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .eq("retroverse_artist_id", slug.toUpperCase())
      .limit(1)
      .maybeSingle<ArtistRow>();
    if (byIdResult.error) throw byIdResult.error;
    return byIdResult.data ?? null;
  }

  const sourceMatchResult = await supabase
    .from("retroverse_source_matches")
    .select("retroverse_entity_id")
    .eq("retroverse_entity_type", "artist")
    .ilike("source_key", `%::${slug.toLowerCase()}`)
    .limit(1);
  if (sourceMatchResult.error) throw sourceMatchResult.error;
  const matchedArtistId = sourceMatchResult.data?.[0]?.retroverse_entity_id;
  if (matchedArtistId) {
    const bySourceResult = await supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .eq("retroverse_artist_id", matchedArtistId)
      .limit(1)
      .maybeSingle<ArtistRow>();
    if (bySourceResult.error) throw bySourceResult.error;
    if (bySourceResult.data) return bySourceResult.data;
  }

  const allArtistsResult = await supabase
    .from("retroverse_artists")
    .select("retroverse_artist_id, canonical_artist_name")
    .range(0, 5000);
  if (allArtistsResult.error) throw allArtistsResult.error;
  const normalized = normalizeEntitySlug(slug);
  return (
    ((allArtistsResult.data ?? []) as ArtistRow[]).find(
      (row) => normalizeEntitySlug(row.canonical_artist_name) === normalized,
    ) ?? null
  );
}

async function loadArtistExperience(slug: string) {
  const supabase = createClient();
  const artist = await resolveArtistBySlug(slug, supabase);
  if (!artist) return null;

  const [tracksResult, albumRolesResult] = await Promise.all([
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_album_id, era_id, release_year")
      .eq("retroverse_artist_id", artist.retroverse_artist_id),
    supabase
      .from("retroverse_album_artist_roles")
      .select("retroverse_album_id, role:relationship_role, role_priority:billing_order")
      .eq("retroverse_artist_id", artist.retroverse_artist_id),
  ]);

  if (tracksResult.error) throw tracksResult.error;
  if (albumRolesResult.error) throw albumRolesResult.error;

  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const albumRoles = (albumRolesResult.data ?? []) as AlbumRoleRow[];
  const trackIds = tracks.map((track) => track.retroverse_track_id);
  const albumIds = [
    ...new Set([
      ...tracks.map((track) => track.retroverse_album_id).filter((id): id is string => Boolean(id)),
      ...albumRoles.map((role) => role.retroverse_album_id),
    ]),
  ];

  const [albumsResult, editionsResult, artworkRows] = await Promise.all([
    albumIds.length > 0
      ? supabase
          .from("retroverse_albums")
          .select(
            "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, album_type, soundtrack_flag, era_id",
          )
          .in("retroverse_album_id", albumIds)
      : Promise.resolve({ data: [], error: null }),
    albumIds.length > 0
      ? supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id")
          .in("retroverse_album_id", albumIds)
          .eq("is_primary", true)
      : Promise.resolve({ data: [], error: null }),
    loadAlbumArtworkRows(supabase, albumIds),
  ]);
  if (albumsResult.error) throw albumsResult.error;
  if (editionsResult.error) throw editionsResult.error;

  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const primaryEditions = (editionsResult.data ?? []) as EditionRow[];
  const albumPrimaryEditionByAlbumId = new Map(primaryEditions.map((row) => [row.retroverse_album_id, row]));
  const albumById = new Map(albums.map((album) => [album.retroverse_album_id, album]));

  const [chartsResult, sequencingResult] = await Promise.all([
    trackIds.length > 0
      ? supabase
          .from("retroverse_chart_appearances")
          .select("retroverse_track_id, chart_position")
          .in("retroverse_track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
    trackIds.length > 0 && primaryEditions.length > 0
      ? supabase
          .from("retroverse_album_tracks")
          .select("retroverse_album_edition_id, retroverse_track_id, disc_number, side_code")
          .in(
            "retroverse_album_edition_id",
            primaryEditions.map((edition) => edition.retroverse_album_edition_id),
          )
          .in("retroverse_track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (chartsResult.error) throw chartsResult.error;
  if (sequencingResult.error) throw sequencingResult.error;

  const charts = (chartsResult.data ?? []) as ChartRow[];
  const sequencingRows = (sequencingResult.data ?? []) as AlbumTrackRow[];

  const eraIds = [
    ...new Set([
      ...tracks.map((track) => track.era_id).filter((id): id is string => Boolean(id)),
      ...albums.map((album) => album.era_id).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const erasResult =
    eraIds.length > 0
      ? await supabase
          .from("retroverse_eras")
          .select("retroverse_era_id, slug, display_name, start_year, end_year")
          .in("retroverse_era_id", eraIds)
      : { data: [], error: null };
  if (erasResult.error) throw erasResult.error;
  const eras = (erasResult.data ?? []) as EraRow[];
  const eraById = new Map(eras.map((era) => [era.retroverse_era_id, era]));

  const peakChartByTrackId = new Map<string, number>();
  for (const chart of charts) {
    const current = peakChartByTrackId.get(chart.retroverse_track_id);
    if (current === undefined || chart.chart_position < current) {
      peakChartByTrackId.set(chart.retroverse_track_id, chart.chart_position);
    }
  }

  const roleByAlbumId = new Map<string, AlbumRoleRow>();
  for (const role of [...albumRoles].sort((a, b) => (a.role_priority ?? 999) - (b.role_priority ?? 999))) {
    if (!roleByAlbumId.has(role.retroverse_album_id)) {
      roleByAlbumId.set(role.retroverse_album_id, role);
    }
  }

  const connectedAlbums: AlbumAppearance[] = albums
    .map((album) => {
      const role = roleByAlbumId.get(album.retroverse_album_id);
      const primaryEdition = albumPrimaryEditionByAlbumId.get(album.retroverse_album_id);
      const artwork = selectCanonicalArtwork(
        artworkRows,
        album.retroverse_album_id,
        primaryEdition?.retroverse_album_edition_id ?? null,
      );

      return {
        id: album.retroverse_album_id,
        title: album.canonical_album_title,
        href: albumRoute(album.canonical_album_title),
        albumTypeLabel: albumTypeLabel(album.album_type, album.soundtrack_flag),
        releaseYear: album.release_year,
        roleLabel: roleLabel(role?.role ?? null),
        coverPath: artwork?.canonical_cover_path ?? null,
        artworkStatus: artwork?.artwork_status ?? null,
      };
    })
    .sort((a, b) => {
      if (a.releaseYear === null && b.releaseYear === null) return a.title.localeCompare(b.title);
      if (a.releaseYear === null) return 1;
      if (b.releaseYear === null) return -1;
      return a.releaseYear - b.releaseYear || a.title.localeCompare(b.title);
    });

  const chartingTracks: ArtistChartTrack[] = tracks
    .map((track) => {
      const peak = peakChartByTrackId.get(track.retroverse_track_id);
      if (peak === undefined) return null;
      const album = track.retroverse_album_id ? albumById.get(track.retroverse_album_id) : null;
      if (!album) return null;
      const contextLabel = album.soundtrack_flag
        ? "Soundtrack-linked single"
        : album.album_type === "compilation"
        ? "Compilation-linked track"
        : "Album single";
      return {
        id: track.retroverse_track_id,
        title: track.canonical_title,
        albumTitle: album.canonical_album_title,
        albumHref: albumRoute(album.canonical_album_title),
        releaseYear: track.release_year,
        peakChartPosition: peak,
        contextLabel,
        eraId: track.era_id,
      };
    })
    .filter((row): row is ArtistChartTrack => row !== null)
    .sort((a, b) => a.peakChartPosition - b.peakChartPosition || a.title.localeCompare(b.title));

  const eraTrackCounts = new Map<string, number>();
  const eraChartingCounts = new Map<string, number>();
  for (const track of tracks) {
    if (!track.era_id) continue;
    eraTrackCounts.set(track.era_id, (eraTrackCounts.get(track.era_id) ?? 0) + 1);
  }
  for (const track of chartingTracks) {
    if (!track.eraId) continue;
    eraChartingCounts.set(track.eraId, (eraChartingCounts.get(track.eraId) ?? 0) + 1);
  }

  const eraConnections: EraConnection[] = [...eraTrackCounts.entries()]
    .map(([eraId, trackCount]) => {
      const era = eraById.get(eraId);
      if (!era) return null;
      return {
        id: era.retroverse_era_id,
        name: era.display_name,
        href: eraHref(era),
        trackCount,
        chartingTrackCount: eraChartingCounts.get(eraId) ?? 0,
      };
    })
    .filter((row): row is EraConnection => row !== null)
    .sort((a, b) => b.trackCount - a.trackCount || a.name.localeCompare(b.name));

  const primaryEra = eraConnections[0] ?? null;
  const numberOneCount = chartingTracks.filter((track) => track.peakChartPosition === 1).length;
  const soundtrackLinkedSinglesCount = chartingTracks.filter(
    (track) => track.contextLabel === "Soundtrack-linked single",
  ).length;
  const soundtrackAlbumAppearances = connectedAlbums.filter((album) => album.albumTypeLabel === "Soundtrack").length;
  const sequencingSides = new Set(
    sequencingRows.map((row) => `D${row.disc_number}:${row.side_code ?? "?"}`),
  ).size;
  const sequencingTrackCount = sequencingRows.length;

  const chartingCountByEra = new Map<string, number>();
  for (const track of chartingTracks) {
    if (!track.eraId) continue;
    chartingCountByEra.set(track.eraId, (chartingCountByEra.get(track.eraId) ?? 0) + 1);
  }
  const dominantEraEntry = [...chartingCountByEra.entries()].sort((a, b) => b[1] - a[1])[0] ?? null;
  const dominantEra =
    dominantEraEntry && eraById.get(dominantEraEntry[0])
      ? {
          id: dominantEraEntry[0],
          name: eraById.get(dominantEraEntry[0])?.display_name ?? "Unknown era",
          count: dominantEraEntry[1],
        }
      : null;

  const pathways = await generateArtistPathways(supabase, artist.retroverse_artist_id);
  const connectedTrackRows = tracks
    .map((track) => {
      const album = track.retroverse_album_id ? albumById.get(track.retroverse_album_id) : null;
      return {
        id: track.retroverse_track_id,
        title: track.canonical_title,
        albumTitle: album?.canonical_album_title ?? "Album unknown",
        albumHref: album ? albumRoute(album.canonical_album_title) : "/albums",
        releaseYear: track.release_year,
        peakChartPosition: peakChartByTrackId.get(track.retroverse_track_id) ?? null,
      };
    })
    .sort((a, b) => {
      const aPeak = a.peakChartPosition ?? 999;
      const bPeak = b.peakChartPosition ?? 999;
      if (aPeak !== bPeak) return aPeak - bPeak;
      return a.title.localeCompare(b.title);
    })
    .slice(0, 24);

  return {
    artist,
    connectedAlbums,
    chartingTracks,
    connectedTrackRows,
    eraConnections,
    primaryEra,
    metrics: {
      numberOneCount,
      soundtrackLinkedSinglesCount,
      soundtrackAlbumAppearances,
      sequencingTrackCount,
      sequencingSides,
      dominantEra,
    },
    pathways,
  };
}

export async function generateMetadata({ params }: ArtistPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `${slug.replaceAll("-", " ")} - Retroverse`,
    description: "Canonical artist exploration powered by the Retroverse graph.",
  };
}

type CareerChapter = {
  key: string;
  title: string;
  summary: string;
  albums: AlbumAppearance[];
  chartTracks: ArtistChartTrack[];
  representativeTracks: Array<{
    id: string;
    title: string;
    albumTitle: string;
    albumHref: string;
    releaseYear: number | null;
    peakChartPosition: number | null;
  }>;
  rangeLabel: string;
};

type ArtistDensityTier = "minimal" | "standard" | "expansive";

function resolveArtistDensityTier(input: {
  albumCount: number;
  trackCount: number;
  chartCount: number;
  eraCount: number;
  activeYears: number;
}): ArtistDensityTier {
  if (
    input.albumCount >= 3 &&
    (input.trackCount >= 8 || input.chartCount >= 4) &&
    input.activeYears >= 4
  ) {
    return "expansive";
  }

  if (
    input.albumCount <= 2 &&
    input.trackCount <= 6 &&
    input.chartCount <= 2 &&
    input.activeYears <= 3
  ) {
    return "minimal";
  }

  return "standard";
}

function buildCareerChapters(data: Awaited<ReturnType<typeof loadArtistExperience>>): CareerChapter[] {
  if (!data) return [];

  const albumsByYear = data.connectedAlbums.filter((row) => row.releaseYear !== null) as Array<
    AlbumAppearance & { releaseYear: number }
  >;
  const tracksByYear = data.connectedTrackRows.filter((row) => row.releaseYear !== null) as Array<
    (typeof data.connectedTrackRows)[number] & { releaseYear: number }
  >;
  const chartByYear = data.chartingTracks.filter((row) => row.releaseYear !== null) as Array<
    ArtistChartTrack & { releaseYear: number }
  >;

  const datedYears = [...albumsByYear.map((row) => row.releaseYear), ...tracksByYear.map((row) => row.releaseYear)];
  if (datedYears.length === 0) return [];

  const minYear = Math.min(...datedYears);
  const maxYear = Math.max(...datedYears);
  const breakthroughYear =
    chartByYear.filter((row) => row.peakChartPosition <= 10).sort((a, b) => a.releaseYear - b.releaseYear)[0]
      ?.releaseYear ??
    chartByYear.sort((a, b) => a.releaseYear - b.releaseYear)[0]?.releaseYear ??
    minYear + 2;
  const peakYear =
    chartByYear.sort((a, b) => a.peakChartPosition - b.peakChartPosition || a.releaseYear - b.releaseYear)[0]
      ?.releaseYear ?? breakthroughYear;
  const lastChartYear = chartByYear.length > 0 ? Math.max(...chartByYear.map((row) => row.releaseYear)) : peakYear;

  const phaseDefs = [
    {
      key: "early-years",
      title: "Early Recordings",
      start: minYear,
      end: Math.min(breakthroughYear - 1, peakYear - 1),
    },
    {
      key: "breakthrough",
      title: "Breakthrough Years",
      start: breakthroughYear,
      end: Math.max(breakthroughYear + 2, breakthroughYear),
    },
    {
      key: "peak-era",
      title: "Peak Years",
      start: Math.max(peakYear - 1, breakthroughYear),
      end: Math.max(peakYear + 2, breakthroughYear + 2),
    },
    {
      key: "reinvention",
      title: "After the Peak",
      start: Math.max(peakYear + 3, breakthroughYear + 3),
      end: Math.max(lastChartYear, peakYear + 3),
    },
    {
      key: "legacy-years",
      title: "Still in Circulation",
      start: Math.max(lastChartYear + 1, peakYear + 4),
      end: maxYear,
    },
  ];

  const chapters: CareerChapter[] = [];
  for (const phase of phaseDefs) {
    const albums = albumsByYear.filter((row) => row.releaseYear >= phase.start && row.releaseYear <= phase.end);
    const chartTracks = chartByYear.filter((row) => row.releaseYear >= phase.start && row.releaseYear <= phase.end);
    const representativeTracks = tracksByYear
      .filter((row) => row.releaseYear >= phase.start && row.releaseYear <= phase.end)
      .slice(0, 6);
    if (albums.length === 0 && chartTracks.length === 0 && representativeTracks.length === 0) continue;

    const summary = `${albums.length} releases · ${chartTracks.length} chart entries · ${representativeTracks.length} in rotation`;
    const rangeLabel = phase.start === phase.end ? `${phase.start}` : `${phase.start}-${Math.min(phase.end, maxYear)}`;
    chapters.push({
      key: phase.key,
      title: phase.title,
      summary,
      albums: albums.slice(0, 8),
      chartTracks: chartTracks.slice(0, 8),
      representativeTracks,
      rangeLabel,
    });
  }

  return chapters;
}

export default async function ArtistEntityPage({ params }: ArtistPageProps) {
  const { slug } = await params;
  const data = await loadArtistExperience(slug);
  if (!data) notFound();

  const contextLine = buildArtistContextLine({
    numberOneCount: data.metrics.numberOneCount,
    soundtrackLinkedSinglesCount: data.metrics.soundtrackLinkedSinglesCount,
    soundtrackAlbumAppearances: data.metrics.soundtrackAlbumAppearances,
    sequencingTrackCount: data.metrics.sequencingTrackCount,
    sequencingSides: data.metrics.sequencingSides,
    dominantEraName: data.metrics.dominantEra?.name ?? null,
    dominantEraChartingCount: data.metrics.dominantEra?.count ?? 0,
    totalChartingTracks: data.chartingTracks.length,
  });
  const culturalRoleLines = buildArtistCulturalRole({
    numberOneCount: data.metrics.numberOneCount,
    soundtrackLinkedSinglesCount: data.metrics.soundtrackLinkedSinglesCount,
    soundtrackAlbumAppearances: data.metrics.soundtrackAlbumAppearances,
    sequencingTrackCount: data.metrics.sequencingTrackCount,
    sequencingSides: data.metrics.sequencingSides,
    dominantEraName: data.metrics.dominantEra?.name ?? null,
    dominantEraChartingCount: data.metrics.dominantEra?.count ?? 0,
    totalChartingTracks: data.chartingTracks.length,
  });
  const chapters = buildCareerChapters(data);
  const firstActiveYear = Math.min(
    ...[
      ...data.connectedAlbums.map((row) => row.releaseYear).filter((row): row is number => row !== null),
      ...data.connectedTrackRows.map((row) => row.releaseYear).filter((row): row is number => row !== null),
    ],
  );
  const lastActiveYear = Math.max(
    ...[
      ...data.connectedAlbums.map((row) => row.releaseYear).filter((row): row is number => row !== null),
      ...data.connectedTrackRows.map((row) => row.releaseYear).filter((row): row is number => row !== null),
    ],
  );
  const hasYearRange = Number.isFinite(firstActiveYear) && Number.isFinite(lastActiveYear);
  const activeYears = hasYearRange ? Math.max(1, lastActiveYear - firstActiveYear + 1) : 0;
  const densityTier = resolveArtistDensityTier({
    albumCount: data.connectedAlbums.length,
    trackCount: data.connectedTrackRows.length,
    chartCount: data.chartingTracks.length,
    eraCount: data.eraConnections.length,
    activeYears,
  });
  const showChapters = densityTier === "expansive" && chapters.length >= 3;
  const keySongs =
    data.chartingTracks.length > 0
      ? data.chartingTracks
          .slice()
          .sort((a, b) => a.peakChartPosition - b.peakChartPosition)
          .slice(0, densityTier === "minimal" ? 6 : 10)
      : data.connectedTrackRows
          .slice(0, densityTier === "minimal" ? 6 : 10)
          .map((row) => ({
            id: row.id,
            title: row.title,
            albumTitle: row.albumTitle,
            albumHref: row.albumHref,
            releaseYear: row.releaseYear,
            peakChartPosition: row.peakChartPosition ?? 999,
            contextLabel: "Track",
            eraId: null,
          }));
  const releaseAnchors = data.connectedAlbums.slice(0, densityTier === "minimal" ? 4 : densityTier === "standard" ? 7 : 9);
  const topSongAnchors = keySongs.slice(0, densityTier === "minimal" ? 3 : 4);

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="mx-auto max-w-[52rem] px-4 py-10 pb-16 sm:px-6 sm:py-[4.25rem]">
        <header className="mb-10 space-y-3 border-b border-[var(--card-border)]/65 pb-5 sm:mb-12 sm:pb-6">
          <p className="text-[0.74rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <Link href="/artists" className="underline-offset-2 hover:underline">
              Artists
            </Link>
            {" → "}
            {data.artist.canonical_artist_name}
            {data.primaryEra ? (
              <>
                {" → "}
                <Link href={data.primaryEra.href} className="underline-offset-2 hover:underline">
                  {data.primaryEra.name}
                </Link>
              </>
            ) : null}
          </p>
          <p className="text-[0.9rem] tracking-[0.04em] text-[var(--text-secondary)]">Artist archive</p>
          <h1 className="font-serif text-[2.35rem] leading-[1.05] tracking-tight text-[var(--text-primary)] sm:text-[3rem]">
            {data.artist.canonical_artist_name}
          </h1>
          {data.primaryEra ? (
            <Link
              href={data.primaryEra.href}
              className="inline-flex text-[0.74rem] uppercase tracking-[0.13em] text-[var(--text-secondary)]/84 underline decoration-[var(--card-border)]/65 underline-offset-4 transition-colors hover:text-[var(--text-primary)]"
            >
              Primary era: {data.primaryEra.name}
            </Link>
          ) : null}
          <p className="max-w-[44ch] text-[1.03rem] leading-[1.68] text-[var(--text-secondary)] sm:text-[1.08rem]">
            {contextLine}
          </p>
          <p className="text-[0.9rem] tracking-[0.03em] text-[var(--text-secondary)]">
            {hasYearRange ? `${firstActiveYear}-${lastActiveYear} on record` : "Years still resolving"}
            {data.metrics.numberOneCount > 0 ? ` · ${data.metrics.numberOneCount} #1 records` : ""}
            {data.metrics.dominantEra ? ` · peak era: ${data.metrics.dominantEra.name}` : ""}
          </p>
          {showChapters ? (
            <nav className="flex flex-wrap gap-x-4 gap-y-1 pt-1 text-[0.78rem] tracking-[0.06em] text-[var(--text-secondary)]">
              {chapters.map((chapter) => (
                <a key={chapter.key} href={`#${chapter.key}`} className="uppercase underline-offset-2 hover:underline">
                  {chapter.title}
                </a>
              ))}
            </nav>
          ) : null}
        </header>

        <div className="mb-9">
          <HistoryBackButton
            fallbackHref="/artists"
            label="Back"
            className="inline-flex items-center rounded-full border border-[var(--card-border)] px-4 py-2.5 text-base font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
          />
        </div>

        {releaseAnchors.length > 0 ? (
          <section className="mb-10 space-y-2.5">
            <p className="text-[0.72rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/86">Selected releases</p>
            <ul className="border-y border-[var(--card-border)]/50">
              {releaseAnchors.map((album) => {
                return (
                  <li key={`anchor-${album.id}`} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                    <Link href={album.href} className="flex items-start gap-3 underline-offset-2 hover:underline">
                      <CompactArtworkThumb
                        title={album.title}
                        canonicalCoverPath={album.coverPath}
                        albumId={album.id}
                        artist={data.artist.canonical_artist_name}
                        year={album.releaseYear}
                        artworkStatus={album.artworkStatus}
                        className="h-14 w-14"
                      />
                      <div className="min-w-0 space-y-0.5">
                        <p className="text-[0.98rem] leading-tight text-[var(--text-primary)]">{album.title}</p>
                        <p className="text-[0.83rem] leading-tight text-[var(--text-secondary)]">
                          {album.releaseYear ?? "Year unknown"} · {album.albumTypeLabel}
                        </p>
                      </div>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </section>
        ) : null}

        {topSongAnchors.length > 0 ? (
          <section className="mb-10 space-y-2.5">
            <p className="text-[0.72rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/86">Notable songs</p>
            <ul className="border-y border-[var(--card-border)]/50">
              {topSongAnchors.map((track) => (
                <li key={`song-anchor-${track.id}`} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="min-w-0 text-[0.95rem] text-[var(--text-primary)]">
                      <Link href={`/tracks/${track.id}`} className="underline-offset-2 hover:underline">
                        {track.title}
                      </Link>
                      {" · "}
                      <Link href={track.albumHref} className="underline-offset-2 hover:underline">
                        {track.albumTitle}
                      </Link>
                    </p>
                    {track.releaseYear !== null ? (
                      <span className="text-[0.72rem] uppercase tracking-[0.1em] text-[var(--text-secondary)]/82">{track.releaseYear}</span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showChapters ? (
          <section className="mb-12 space-y-8">
            <div className="space-y-8">
              {chapters.map((chapter) => (
                <article key={chapter.key} id={chapter.key} className="border-l-2 border-[var(--card-border)]/60 pl-4 sm:pl-5">
                  <header className="space-y-1.5">
                    <p className="text-[0.78rem] uppercase tracking-[0.1em] text-[var(--text-secondary)]">{chapter.rangeLabel}</p>
                    <h3 className="font-serif text-[1.34rem] leading-tight text-[var(--text-primary)] sm:text-[1.46rem]">
                      {chapter.title}
                    </h3>
                    <p className="text-[0.92rem] text-[var(--text-secondary)]">{chapter.summary}</p>
                  </header>

                  {chapter.chartTracks.length > 0 ? (
                    <ul className="mt-3 border-y border-[var(--card-border)]/50">
                      {chapter.chartTracks.map((track) => (
                        <li key={`${chapter.key}-${track.id}`} className="border-b border-[var(--card-border)]/42 py-2 last:border-b-0">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[0.96rem] text-[var(--text-primary)]">
                              <Link href={`/tracks/${track.id}`} className="underline-offset-2 hover:underline">
                                {track.title}
                              </Link>{" "}
                              ·{" "}
                              <Link href={track.albumHref} className="underline-offset-2 hover:underline">
                                {track.albumTitle}
                              </Link>
                            </p>
                            <span className="text-[0.72rem] uppercase tracking-[0.1em] text-[var(--text-secondary)]">
                              Peak #{track.peakChartPosition}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {chapter.albums.length > 0 ? (
                    <p className="mt-3 text-[0.92rem] leading-[1.58] text-[var(--text-secondary)]">
                      Album landmarks:{" "}
                      {chapter.albums.map((album, idx) => (
                        <span key={`${chapter.key}-${album.id}`}>
                          {idx > 0 ? " · " : ""}
                          <Link href={album.href} className="underline-offset-2 hover:underline">
                            {album.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : null}

                  {chapter.representativeTracks.length > 0 ? (
                    <p className="mt-2 text-[0.9rem] leading-[1.58] text-[var(--text-secondary)]">
                      Also heard:{" "}
                      {chapter.representativeTracks.map((track, idx) => (
                        <span key={`${chapter.key}-rep-${track.id}`}>
                          {idx > 0 ? " · " : ""}
                          <Link href={`/tracks/${track.id}`} className="underline-offset-2 hover:underline">
                            {track.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : null}
                </article>
              ))}
            </div>
          </section>
        ) : null}

        {keySongs.length > 0 ? (
          <section className="mb-10 space-y-3">
            <h2 className="font-serif text-[1.5rem] leading-[1.15] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.72rem]">
              {densityTier === "minimal" ? "Key Songs" : "In Rotation"}
            </h2>
            <ul className="border-y border-[var(--card-border)]/50">
              {keySongs.map((track) => (
                <li key={track.id} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 pr-2">
                      <p className="text-[0.98rem] font-medium text-[var(--text-primary)] sm:text-[1.01rem]">
                        <Link href={`/tracks/${track.id}`} className="underline-offset-2 hover:underline">
                          {track.title}
                        </Link>
                      </p>
                      <p className="text-[0.9rem] text-[var(--text-secondary)]">
                        <Link href={track.albumHref} className="underline-offset-2 hover:underline">
                          {track.albumTitle}
                        </Link>
                        {track.releaseYear !== null ? ` · ${track.releaseYear}` : ""}
                      </p>
                    </div>
                    {track.peakChartPosition !== null && track.peakChartPosition !== 999 ? (
                      <span className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/82">
                        Peak #{track.peakChartPosition}
                      </span>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {densityTier !== "minimal" && data.chartingTracks.length > 0 ? (
          <section className="mb-10 space-y-3">
            <h2 className="font-serif text-[1.5rem] leading-[1.15] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.72rem]">
              Chart Run
            </h2>
            <ul className="border-y border-[var(--card-border)]/50">
              {data.chartingTracks
                .slice()
                .sort((a, b) => {
                  const ay = a.releaseYear ?? 0;
                  const by = b.releaseYear ?? 0;
                  return by - ay || a.peakChartPosition - b.peakChartPosition;
                })
                .slice(0, 12)
                .map((track) => (
                <li key={track.id} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 pr-2">
                      <p className="text-[0.98rem] font-medium text-[var(--text-primary)] sm:text-[1.01rem]">
                        <Link href={`/tracks/${track.id}`} className="underline-offset-2 hover:underline">
                          {track.title}
                        </Link>
                      </p>
                      <p className="text-[0.88rem] text-[var(--text-secondary)] sm:text-[0.9rem]">
                        <Link href={track.albumHref} className="underline-offset-2 hover:underline">
                          {track.albumTitle}
                        </Link>
                        {track.releaseYear !== null ? ` · ${track.releaseYear}` : ""}
                        {" · "}
                        {track.contextLabel}
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
        ) : null}

        {densityTier === "expansive" && culturalRoleLines.length > 0 ? (
          <section className="mb-14 max-w-[35.5rem] space-y-4 pl-1 sm:pl-2">
            <h2 className="font-serif text-[1.46rem] leading-[1.16] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.58rem]">
              Cultural Role
            </h2>
            <ul className="space-y-4 text-[0.98rem] leading-[1.74] text-[var(--text-secondary)] sm:text-[1.03rem]">
              {culturalRoleLines.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.eraConnections.length > 0 ? (
          <section className="space-y-4">
            <h2 className="font-serif text-[1.42rem] leading-[1.18] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.5rem]">
              {densityTier === "minimal" ? "Around This Time" : "Era Movement"}
            </h2>
            <ul className="max-w-[36rem] border-y border-[var(--card-border)]/50">
              {data.eraConnections.slice(0, densityTier === "minimal" ? 3 : data.eraConnections.length).map((era) => (
                <li key={era.id} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                  <Link
                    href={era.href}
                    className="flex flex-wrap items-center justify-between gap-2 pl-1.5 transition-colors hover:text-[var(--text-primary)]"
                  >
                    <span className="text-[0.95rem] font-medium text-[var(--text-primary)] sm:text-[0.99rem]">{era.name}</span>
                    <span className="text-[0.67rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/82 sm:text-[0.7rem]">
                      {era.trackCount} tracks{densityTier === "minimal" ? "" : ` · ${era.chartingTrackCount} charting`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mt-10 space-y-4">
          <h2 className="font-serif text-[1.42rem] leading-[1.18] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.5rem]">
            Continue Through...
          </h2>
          <ul className="max-w-[36rem] border-y border-[var(--card-border)]/50">
            {data.pathways.length > 0 ? (
              data.pathways.map((pathway) => (
                <li key={pathway.key} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                  <Link href={pathway.href} className="block hover:underline">
                    <span className="text-[0.95rem] font-medium text-[var(--text-primary)]">{pathway.label}</span>
                    <p className="text-[0.84rem] text-[var(--text-secondary)]/85 sm:text-[0.88rem]">{pathway.summary}</p>
                  </Link>
                </li>
              ))
            ) : (
              <li className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                <Link href="/random" className="block hover:underline">
                  <span className="text-[0.95rem] font-medium text-[var(--text-primary)]">Explore Randomly</span>
                  <p className="text-[0.84rem] text-[var(--text-secondary)]/85 sm:text-[0.88rem]">
                    Continue to another connected artist, album, track, or era node.
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
