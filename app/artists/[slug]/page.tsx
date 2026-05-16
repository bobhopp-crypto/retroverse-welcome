import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HistoryBackButton } from "@/app/history-back-button";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { buildArtistContextLine, buildArtistCulturalRole } from "@/lib/retroverse-editorial";
import { generateArtistPathways } from "@/lib/retroverse-pathways";
import { hrefForAlbum, normalizeEntitySlug } from "@/lib/retroverse-routes";
import { createClient } from "@/lib/supabase";
import { loadArtistExperienceFromDossierBundle } from "@/lib/load-artist-dossier-fallback";
import {
  loadArtistExperienceFromUniverse,
  type ArtistUniverseExperience,
} from "@/lib/load-artist-universe-experience";
import {
  awaitSupabase,
  chunkIds,
  fetchAlbumTracksForEditionsAndTracks,
  fetchChartAppearancesForTrackIds,
  throwSupabase,
} from "@/lib/supabase-in-query";

function logArtistPageFallback(phase: string, slug: string, e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  console.warn("[artists:slug:fallback]", {
    phase,
    slug,
    message: err.message,
  });
}

function logArtistPageError(phase: string, slug: string, e: unknown): void {
  const err = e instanceof Error ? e : new Error(String(e));
  console.error("[artists:slug]", {
    phase,
    slug,
    message: err.message,
    stack: err.stack,
  });
}

function slugToNameGuess(slug: string): string {
  return slug.replace(/-/g, " ").replace(/\s+/g, " ").trim();
}
import "../artist-universe.css";
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
  const normalized = normalizeEntitySlug(slug);

  if (/^RVAR[0-9]{6}$/i.test(slug)) {
    const row = await awaitSupabase(
      "resolveArtistBySlug:byId",
      () =>
        supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .eq("retroverse_artist_id", slug.toUpperCase())
          .limit(1)
          .maybeSingle<ArtistRow>(),
    );
    return row ?? null;
  }

  const nameGuess = slugToNameGuess(slug);
  if (nameGuess.length >= 2) {
    const nameCandidates = await awaitSupabase(
      "resolveArtistBySlug:name_ilike",
      () =>
        supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .ilike("canonical_artist_name", `%${nameGuess}%`)
          .limit(40),
    );
    const exact = ((nameCandidates ?? []) as ArtistRow[]).find(
      (row) => normalizeEntitySlug(row.canonical_artist_name) === normalized,
    );
    if (exact) return exact;
    if ((nameCandidates ?? []).length === 1) return (nameCandidates as ArtistRow[])[0]!;
  }

  try {
    const sourceMatchResult = await awaitSupabase(
      "resolveArtistBySlug:source_matches",
      () =>
        supabase
          .from("retroverse_source_matches")
          .select("retroverse_entity_id")
          .eq("retroverse_entity_type", "artist")
          .ilike("source_key", `%::${slug.toLowerCase()}`)
          .limit(1),
    );
    const matchedArtistId = (sourceMatchResult as { retroverse_entity_id: string }[] | null)?.[0]
      ?.retroverse_entity_id;
    if (matchedArtistId) {
      const bySource = await awaitSupabase(
        "resolveArtistBySlug:by_source",
        () =>
          supabase
            .from("retroverse_artists")
            .select("retroverse_artist_id, canonical_artist_name")
            .eq("retroverse_artist_id", matchedArtistId)
            .limit(1)
            .maybeSingle<ArtistRow>(),
      );
      if (bySource) return bySource;
    }
  } catch (e) {
    console.warn("[artists:slug] resolveArtistBySlug:source_matches skipped", {
      slug,
      error: e instanceof Error ? e.message : String(e),
    });
  }

  const pageSize = 500;
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const batch = await awaitSupabase(
      `resolveArtistBySlug:scan(offset=${offset})`,
      () =>
        supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .order("canonical_artist_name", { ascending: true })
          .range(offset, offset + pageSize - 1),
    );
    const rows = (batch ?? []) as ArtistRow[];
    const hit = rows.find((row) => normalizeEntitySlug(row.canonical_artist_name) === normalized);
    if (hit) return hit;
    if (rows.length < pageSize) break;
  }

  return null;
}

async function loadArtistExperienceFromSupabase(slug: string) {
  const supabase = createClient();

  const artist = await resolveArtistBySlug(slug, supabase);
  if (!artist) return null;

  const [tracksRows, albumRoleRows] = await Promise.all([
    awaitSupabase("loadArtistExperience:tracks", () =>
      supabase
        .from("retroverse_tracks")
        .select("retroverse_track_id, canonical_title, retroverse_album_id, era_id, release_year")
        .eq("retroverse_artist_id", artist.retroverse_artist_id),
    ),
    awaitSupabase("loadArtistExperience:album_roles", () =>
      supabase
        .from("retroverse_album_artist_roles")
        .select("retroverse_album_id, role:relationship_role, role_priority:billing_order")
        .eq("retroverse_artist_id", artist.retroverse_artist_id),
    ),
  ]);
  const tracks = (tracksRows ?? []) as TrackRow[];
  const albumRoles = (albumRoleRows ?? []) as AlbumRoleRow[];
  const trackIds = tracks.map((track) => track.retroverse_track_id);
  const albumIds = [
    ...new Set([
      ...tracks.map((track) => track.retroverse_album_id).filter((id): id is string => Boolean(id)),
      ...albumRoles.map((role) => role.retroverse_album_id),
    ]),
  ];

  const [albumsResultFlat, editionsResultFlat, artworkRows] = await Promise.all([
    albumIds.length > 0
      ? Promise.all(
          chunkIds(albumIds).map(async (chunk) => {
            const r = await supabase
              .from("retroverse_albums")
              .select(
                "retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, album_type, soundtrack_flag, era_id",
              )
              .in("retroverse_album_id", chunk);
            throwSupabase(`loadArtistExperience:albums(chunk ${chunk.length})`, r.error);
            return (r.data ?? []) as AlbumRow[];
          }),
        ).then((chunks) => chunks.flat())
      : Promise.resolve([] as AlbumRow[]),
    albumIds.length > 0
      ? Promise.all(
          chunkIds(albumIds).map(async (chunk) => {
            const r = await supabase
              .from("retroverse_album_editions")
              .select("retroverse_album_edition_id, retroverse_album_id")
              .in("retroverse_album_id", chunk)
              .eq("is_primary", true);
            throwSupabase(`loadArtistExperience:editions(chunk ${chunk.length})`, r.error);
            return (r.data ?? []) as EditionRow[];
          }),
        ).then((chunks) => chunks.flat())
      : Promise.resolve([] as EditionRow[]),
    loadAlbumArtworkRows(supabase, albumIds),
  ]);

  const albums = albumsResultFlat;
  const primaryEditions = editionsResultFlat;
  const albumPrimaryEditionByAlbumId = new Map(primaryEditions.map((row) => [row.retroverse_album_id, row]));
  const albumById = new Map(albums.map((album) => [album.retroverse_album_id, album]));

  const [charts, sequencingRows] = await Promise.all([
    fetchChartAppearancesForTrackIds(supabase, trackIds),
    trackIds.length > 0 && primaryEditions.length > 0
      ? fetchAlbumTracksForEditionsAndTracks(
          supabase,
          primaryEditions.map((edition) => edition.retroverse_album_edition_id),
          trackIds,
        )
      : Promise.resolve([] as AlbumTrackRow[]),
  ]);

  const eraIds = [
    ...new Set([
      ...tracks.map((track) => track.era_id).filter((id): id is string => Boolean(id)),
      ...albums.map((album) => album.era_id).filter((id): id is string => Boolean(id)),
    ]),
  ];
  const erasResultRows =
    eraIds.length > 0
      ? (
          await Promise.all(
            chunkIds(eraIds).map(async (chunk) => {
              const r = await supabase
                .from("retroverse_eras")
                .select("retroverse_era_id, slug, display_name, start_year, end_year")
                .in("retroverse_era_id", chunk);
              throwSupabase(`loadArtistExperience:eras(chunk ${chunk.length})`, r.error);
              return (r.data ?? []) as EraRow[];
            }),
          )
        ).flat()
      : ([] as EraRow[]);
  const eras = erasResultRows;
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
        href: hrefForAlbum(album.retroverse_album_id, album.canonical_album_title),
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
        albumHref: hrefForAlbum(album.retroverse_album_id, album.canonical_album_title),
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
        albumHref: album ? hrefForAlbum(album.retroverse_album_id, album.canonical_album_title) : "/albums",
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

async function loadArtistExperience(slug: string) {
  const local = loadArtistExperienceFromUniverse(slug);
  if (local) return local;

  if (process.env.ARTIST_SUPABASE_ENRICH === "1") {
    try {
      return await loadArtistExperienceFromSupabase(slug);
    } catch (e) {
      const dossier = loadArtistExperienceFromDossierBundle(slug);
      if (dossier) {
        logArtistPageFallback("loadArtistExperienceFromSupabase", slug, e);
        return dossier;
      }
      logArtistPageError("loadArtistExperienceFromSupabase", slug, e);
      throw e;
    }
  }

  const dossier = loadArtistExperienceFromDossierBundle(slug);
  if (dossier) {
    console.warn("[artists:slug:fallback] artist-universe miss — dossier bundle", { slug });
    return dossier;
  }

  return null;
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

  const universe = (data as Partial<ArtistUniverseExperience>).universe ?? null;

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
  const releaseAnchors = data.connectedAlbums.slice(0, densityTier === "minimal" ? 4 : densityTier === "standard" ? 10 : 14);
  return (
    <div className="artist-universe min-h-full">
      <div className="artist-uni-atmosphere" aria-hidden />
      <article className="artist-uni-article mx-auto max-w-[52rem] px-4 py-10 pb-16 sm:px-6 sm:py-[4.25rem]">
        <header className="artist-uni-hero mb-10 space-y-3 sm:mb-12">
          <p className="artist-uni-breadcrumb text-[0.74rem] uppercase tracking-[0.14em]">
            <Link href="/artists">
              Artists
            </Link>
            {" → "}
            <span>{data.artist.canonical_artist_name}</span>
            {data.primaryEra ? (
              <>
                {" → "}
                <Link href={data.primaryEra.href}>{data.primaryEra.name}</Link>
              </>
            ) : null}
          </p>
          <p className="artist-uni-eyebrow">Artist universe · constellation view</p>
          <h1 className="artist-uni-title text-[2.35rem] sm:text-[3rem]">{data.artist.canonical_artist_name}</h1>
          {universe ? (
            <>
              <div
                className="artist-uni-signal-field"
                style={
                  {
                    ["--au-signal-hue" as string]: String(universe.signal_palette.hue),
                    ["--au-signal-accent" as string]: universe.signal_palette.accent,
                  } as Record<string, string>
                }
                aria-hidden
              />
              <p className="artist-uni-meta-line text-[0.88rem]">
                {universe.active_years.first !== null && universe.active_years.last !== null
                  ? `${universe.active_years.first}–${universe.active_years.last} in archive`
                  : "Years still resolving"}
                {universe.retroverse_summary.best_year !== null &&
                universe.retroverse_summary.best_year_rank !== null
                  ? ` · Retroverse #${universe.retroverse_summary.best_year_rank} in ${universe.retroverse_summary.best_year}`
                  : ""}
                {universe.retroverse_summary.top_coordinate
                  ? ` · coordinate ${universe.retroverse_summary.top_coordinate}`
                  : ""}
              </p>
              {universe.dominant_years.length > 0 ? (
                <div className="artist-uni-coord-orbit" aria-label="Dominant Retroverse years">
                  {universe.dominant_years.map((year) => {
                    const row = universe.yearly_rankings.find((yr) => yr.year === year);
                    if (!row) return null;
                    return (
                      <span key={year} className="artist-uni-coord-chip">
                        {year} · A{row.retroverse_artist_rank}
                      </span>
                    );
                  })}
                </div>
              ) : null}
            </>
          ) : null}
          {data.primaryEra ? (
            <Link href={data.primaryEra.href} className="artist-uni-inline-link artist-uni-eyebrow !text-[0.56rem] !tracking-[0.2em]">
              Primary orbit · {data.primaryEra.name}
            </Link>
          ) : null}
          <p className="artist-uni-sub text-[1.03rem] sm:text-[1.08rem]">{contextLine}</p>
          <p className="artist-uni-meta-line text-[0.9rem] tracking-[0.03em]">
            {hasYearRange ? `${firstActiveYear}-${lastActiveYear} on record` : "Years still resolving"}
            {data.metrics.numberOneCount > 0 ? ` · ${data.metrics.numberOneCount} #1 records` : ""}
            {data.metrics.dominantEra ? ` · peak era signal: ${data.metrics.dominantEra.name}` : ""}
          </p>
          {data.eraConnections.length > 0 ? (
            <div className="artist-uni-era-orbit" aria-label="ERA CONSTELLATION">
              {data.eraConnections.slice(0, densityTier === "minimal" ? 5 : 10).map((era) => (
                <Link key={era.id} href={era.href} className="artist-uni-era-chip">
                  {era.name}
                  <span className="sr-only">
                    · {era.trackCount} archive tracks{densityTier === "minimal" ? "" : `, ${era.chartingTrackCount} charting`}
                  </span>
                </Link>
              ))}
            </div>
          ) : null}
          {showChapters ? (
            <nav className="artist-uni-chapter-nav" aria-label="Career arcs">
              {chapters.map((chapter) => (
                <a key={chapter.key} href={`#${chapter.key}`}>
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
            className="artist-uni-back inline-flex items-center rounded-full px-4 py-2.5 text-base font-medium"
          />
        </div>

        {releaseAnchors.length > 0 ? (
          <section className="artist-uni-sector mb-10 space-y-2.5">
            <p className="artist-uni-section-label">Major albums</p>
            <ul className="artist-uni-plate artist-uni-list overflow-hidden py-1">
              {releaseAnchors.map((album) => (
                <li key={`anchor-${album.id}`} className="artist-uni-row">
                  <Link href={album.href} className="group flex min-w-0 flex-col gap-0.5 no-underline">
                      <p className="text-[0.98rem] font-medium leading-tight text-[color:rgba(255,248,255,0.95)] underline-offset-2 group-hover:underline">
                        {album.title}
                      </p>
                      <p className="artist-uni-muted text-[0.83rem] leading-tight">
                        {album.releaseYear ?? "Year unknown"} · {album.albumTypeLabel}
                        {album.roleLabel ? ` · ${album.roleLabel}` : ""}
                      </p>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        {showChapters ? (
          <section className="mb-12 space-y-8">
            <p className="artist-uni-section-label">Temporal arcs</p>
            <div className="space-y-8">
              {chapters.map((chapter) => (
                <article key={chapter.key} id={chapter.key} className="artist-uni-chapter-card sm:pl-5">
                  <header className="space-y-1.5">
                    <p className="artist-uni-muted text-[0.78rem] uppercase tracking-[0.12em]">{chapter.rangeLabel}</p>
                    <h3 className="font-serif text-[1.34rem] leading-tight text-[color:rgba(252,248,255,0.95)] sm:text-[1.46rem]">
                      {chapter.title}
                    </h3>
                    <p className="artist-uni-muted text-[0.92rem]">{chapter.summary}</p>
                  </header>

                  {chapter.chartTracks.length > 0 ? (
                    <ul className="artist-uni-plate artist-uni-list mt-3 overflow-hidden py-1">
                      {chapter.chartTracks.map((track) => (
                        <li key={`${chapter.key}-${track.id}`} className="artist-uni-row">
                          <div className="flex items-center justify-between gap-2">
                            <p className="text-[0.96rem]">
                              <Link href={`/tracks/${track.id}`} className="artist-uni-inline-link">
                                {track.title}
                              </Link>{" "}
                              ·{" "}
                              <Link href={track.albumHref} className="artist-uni-inline-link">
                                {track.albumTitle}
                              </Link>
                            </p>
                            <span className="text-[0.65rem] uppercase tracking-[0.12em] text-[color:rgba(180,220,240,0.45)]">
                              Peak #{track.peakChartPosition}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {chapter.albums.length > 0 ? (
                    <p className="artist-uni-muted mt-3 text-[0.92rem] leading-[1.58]">
                      Album landmarks:{" "}
                      {chapter.albums.map((album, idx) => (
                        <span key={`${chapter.key}-${album.id}`}>
                          {idx > 0 ? " · " : ""}
                          <Link href={album.href} className="artist-uni-inline-link">
                            {album.title}
                          </Link>
                        </span>
                      ))}
                    </p>
                  ) : null}

                  {chapter.representativeTracks.length > 0 ? (
                    <p className="artist-uni-muted mt-2 text-[0.9rem] leading-[1.58]">
                      Also heard:{" "}
                      {chapter.representativeTracks.map((track, idx) => (
                        <span key={`${chapter.key}-rep-${track.id}`}>
                          {idx > 0 ? " · " : ""}
                          <Link href={`/tracks/${track.id}`} className="artist-uni-inline-link">
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
            <h2 className="artist-uni-h2">Major tracks</h2>
            <p className="artist-uni-section-label -mt-1 !mb-2">
              {densityTier === "minimal" ? "Signals in heavy rotation" : "Phosphor pathways through the archive"}
            </p>
            <ul className="artist-uni-plate artist-uni-list overflow-hidden py-1">
              {keySongs.map((track) => (
                <li key={track.id} className="artist-uni-row">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0 pr-2">
                      <p className="text-[0.98rem] font-medium sm:text-[1.01rem]">
                        <Link href={`/tracks/${track.id}`} className="artist-uni-inline-link">
                          {track.title}
                        </Link>
                      </p>
                      <p className="artist-uni-muted text-[0.9rem]">
                        <Link href={track.albumHref} className="artist-uni-inline-link">
                          {track.albumTitle}
                        </Link>
                        {track.releaseYear !== null ? ` · ${track.releaseYear}` : ""}
                      </p>
                    </div>
                    {track.peakChartPosition !== null && track.peakChartPosition !== 999 ? (
                      <span className="text-[0.65rem] uppercase tracking-[0.12em] text-[color:rgba(180,220,240,0.42)]">
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
            <h2 className="artist-uni-h2">Chart broadcast</h2>
            <ul className="artist-uni-plate artist-uni-list max-w-[36rem] overflow-hidden py-1">
              {data.chartingTracks
                .slice()
                .sort((a, b) => {
                  const ay = a.releaseYear ?? 0;
                  const by = b.releaseYear ?? 0;
                  return by - ay || a.peakChartPosition - b.peakChartPosition;
                })
                .slice(0, 12)
                .map((track) => (
                  <li key={track.id} className="artist-uni-row">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="min-w-0 pr-2">
                        <p className="text-[0.98rem] font-medium sm:text-[1.01rem]">
                          <Link href={`/tracks/${track.id}`} className="artist-uni-inline-link">
                            {track.title}
                          </Link>
                        </p>
                        <p className="artist-uni-muted text-[0.88rem] sm:text-[0.9rem]">
                          <Link href={track.albumHref} className="artist-uni-inline-link">
                            {track.albumTitle}
                          </Link>
                          {track.releaseYear !== null ? ` · ${track.releaseYear}` : ""}
                          {" · "}
                          {track.contextLabel}
                        </p>
                      </div>
                      <span className="text-[0.65rem] uppercase tracking-[0.12em] text-[color:rgba(180,220,240,0.42)]">
                        Peak #{track.peakChartPosition}
                      </span>
                    </div>
                  </li>
                ))}
            </ul>
          </section>
        ) : null}

        {culturalRoleLines.length > 0 ? (
          <section className="artist-uni-plate mb-14 max-w-[35.5rem] space-y-3 px-5 py-6 sm:space-y-4">
            <h2 className="artist-uni-h2 !mb-0">Archive mood</h2>
            <ul className="space-y-4 text-[0.98rem] leading-[1.74] text-[color:rgba(210,215,240,0.65)] sm:text-[1.03rem]">
              {(densityTier === "minimal"
                ? culturalRoleLines.slice(0, 2)
                : densityTier === "standard"
                  ? culturalRoleLines.slice(0, 4)
                  : culturalRoleLines
              ).map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          </section>
        ) : null}

        {data.eraConnections.length > 0 ? (
          <section className="mb-10 space-y-4">
            <h2 className="artist-uni-h2">Era signal detail</h2>
            <p className="artist-uni-muted -mt-1 text-[0.85rem] leading-relaxed">
              How this voice maps across Retroverse time corridors (same chips also ring the hero — follow any thread).
            </p>
            <ul className="artist-uni-plate artist-uni-list max-w-[36rem] overflow-hidden py-1">
              {data.eraConnections.slice(0, densityTier === "minimal" ? 3 : data.eraConnections.length).map((era) => (
                <li key={era.id} className="artist-uni-row">
                  <Link href={era.href} className="flex flex-wrap items-center justify-between gap-2 pl-0.5 no-underline">
                    <span className="text-[0.95rem] font-medium text-[color:rgba(252,248,255,0.92)] sm:text-[0.99rem]">
                      {era.name}
                    </span>
                    <span className="text-[0.65rem] uppercase tracking-[0.12em] text-[color:rgba(180,220,240,0.42)] sm:text-[0.7rem]">
                      {era.trackCount} tracks{densityTier === "minimal" ? "" : ` · ${era.chartingTrackCount} charting`}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="exploration-grid mb-10 space-y-3">
          <h2 className="artist-uni-h2">Exploration</h2>
          <p className="artist-uni-muted text-[0.88rem] leading-relaxed">
            Leave the lane without leaving the constellation.
          </p>
          <div className="flex flex-wrap gap-2.5 pt-1">
            <Link href="/album-retroscope" className="artist-uni-inline-link">
              RetroScope grid
            </Link>
            <Link href="/random" className="artist-uni-inline-link">
              Random doorway
            </Link>
            <Link href="/search" className="artist-uni-inline-link">
              Search the archive
            </Link>
            <Link href="/eras" className="artist-uni-inline-link">
              Era stack
            </Link>
          </div>
        </section>

        <section className="mt-2 space-y-4">
          <h2 className="artist-uni-h2">Retroverse pathways</h2>
          <p className="artist-uni-muted -mt-1 text-[0.85rem]">
            Graph edges to nearby artists, albums, sessions, and eras — not a directory, a neighborhood.
          </p>
          <ul className="artist-uni-plate artist-uni-list max-w-[36rem] overflow-hidden py-1">
            {data.pathways.length > 0 ? (
              data.pathways.map((pathway) => (
                <li key={pathway.key} className="artist-uni-row">
                  <Link href={pathway.href} className="block no-underline">
                    <span className="text-[0.95rem] font-medium text-[color:rgba(252,248,255,0.92)]">{pathway.label}</span>
                    <p className="artist-uni-muted mt-0.5 text-[0.84rem] sm:text-[0.88rem]">{pathway.summary}</p>
                  </Link>
                </li>
              ))
            ) : (
              <li className="artist-uni-row">
                <Link href="/random" className="block no-underline">
                  <span className="text-[0.95rem] font-medium text-[color:rgba(252,248,255,0.92)]">Open a random node</span>
                  <p className="artist-uni-muted mt-0.5 text-[0.84rem]">
                    Continue to another connected artist, album, track, or era.
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
