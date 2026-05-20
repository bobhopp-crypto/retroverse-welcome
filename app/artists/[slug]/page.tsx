import type { Metadata } from "next";
import Link from "next/link";
import { EntityStatus } from "@/app/components/entity-status";
import { RetroverseEntityNav } from "@/app/components/retroverse-entity-nav";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { generateArtistPathways } from "@/lib/retroverse-pathways";
import { hrefForAlbum, hrefForTrack, normalizeEntitySlug } from "@/lib/retroverse-routes";
import type { SignalTier } from "@/lib/signal-curation";
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

type AlbumChartRunRow = {
  retroverse_album_id: string;
  chart_date: string | null;
  chart_position: number | null;
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
  chartPeak?: number | null;
  chartWeeks?: number;
  chartingTrackCount?: number;
  trackCount?: number;
  majorTracks?: Array<{
    id: string;
    title: string;
    peakChartPosition: number | null;
  }>;
};

type ArtistChartTrack = {
  id: string;
  title: string;
  albumTitle: string;
  albumHref: string;
  releaseYear: number | null;
  peakChartPosition: number;
  chartWeeks?: number;
  signalTier?: SignalTier;
  signalReason?: string;
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

async function fetchAlbumChartRunsForAlbumIds(
  supabase: ReturnType<typeof createClient>,
  albumIds: string[],
): Promise<AlbumChartRunRow[]> {
  if (albumIds.length === 0) return [];
  const rows = await Promise.all(
    chunkIds(albumIds).map(async (chunk) => {
      const r = await supabase
        .from("canonical_album_chart_runs")
        .select("retroverse_album_id, chart_date, chart_position")
        .in("retroverse_album_id", chunk);
      throwSupabase(`loadArtistExperience:album_chart_runs(chunk ${chunk.length})`, r.error);
      return (r.data ?? []) as AlbumChartRunRow[];
    }),
  );
  return rows.flat();
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

  const [charts, sequencingRows, albumChartRuns] = await Promise.all([
    fetchChartAppearancesForTrackIds(supabase, trackIds),
    trackIds.length > 0 && primaryEditions.length > 0
      ? fetchAlbumTracksForEditionsAndTracks(
          supabase,
          primaryEditions.map((edition) => edition.retroverse_album_edition_id),
          trackIds,
        )
      : Promise.resolve([] as AlbumTrackRow[]),
    fetchAlbumChartRunsForAlbumIds(supabase, albumIds),
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
  const chartWeeksByTrackId = new Map<string, number>();
  for (const chart of charts) {
    const current = peakChartByTrackId.get(chart.retroverse_track_id);
    if (current === undefined || chart.chart_position < current) {
      peakChartByTrackId.set(chart.retroverse_track_id, chart.chart_position);
    }
    chartWeeksByTrackId.set(
      chart.retroverse_track_id,
      Math.max(chartWeeksByTrackId.get(chart.retroverse_track_id) ?? 0, chart.weeks_on_chart ?? 0),
    );
  }

  const roleByAlbumId = new Map<string, AlbumRoleRow>();
  for (const role of [...albumRoles].sort((a, b) => (a.role_priority ?? 999) - (b.role_priority ?? 999))) {
    if (!roleByAlbumId.has(role.retroverse_album_id)) {
      roleByAlbumId.set(role.retroverse_album_id, role);
    }
  }

  const tracksByAlbumId = new Map<string, TrackRow[]>();
  for (const track of tracks) {
    if (!track.retroverse_album_id) continue;
    const rows = tracksByAlbumId.get(track.retroverse_album_id) ?? [];
    rows.push(track);
    tracksByAlbumId.set(track.retroverse_album_id, rows);
  }

  const chartWeeksByAlbumId = new Map<string, number>();
  const chartingTrackIdsByAlbumId = new Map<string, Set<string>>();
  const chartPeakByAlbumId = new Map<string, number>();
  for (const chart of albumChartRuns) {
    if (!chart.retroverse_album_id || chart.chart_position === null) continue;
    chartWeeksByAlbumId.set(chart.retroverse_album_id, (chartWeeksByAlbumId.get(chart.retroverse_album_id) ?? 0) + 1);
    const currentPeak = chartPeakByAlbumId.get(chart.retroverse_album_id);
    if (currentPeak === undefined || chart.chart_position < currentPeak) {
      chartPeakByAlbumId.set(chart.retroverse_album_id, chart.chart_position);
    }
  }
  for (const chart of charts) {
    const track = tracks.find((row) => row.retroverse_track_id === chart.retroverse_track_id);
    if (!track?.retroverse_album_id) continue;
    const chartingTrackIds = chartingTrackIdsByAlbumId.get(track.retroverse_album_id) ?? new Set<string>();
    chartingTrackIds.add(track.retroverse_track_id);
    chartingTrackIdsByAlbumId.set(track.retroverse_album_id, chartingTrackIds);
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
      const albumTracks = tracksByAlbumId.get(album.retroverse_album_id) ?? [];
      const majorTracks = albumTracks
        .map((track) => ({
          id: track.retroverse_track_id,
          title: track.canonical_title,
          peakChartPosition: peakChartByTrackId.get(track.retroverse_track_id) ?? null,
        }))
        .sort((a, b) => {
          const aPeak = a.peakChartPosition ?? 999;
          const bPeak = b.peakChartPosition ?? 999;
          if (aPeak !== bPeak) return aPeak - bPeak;
          return a.title.localeCompare(b.title);
        })
        .slice(0, 4);

      return {
        id: album.retroverse_album_id,
        title: album.canonical_album_title,
        href: hrefForAlbum(album.retroverse_album_id, album.canonical_album_title),
        albumTypeLabel: albumTypeLabel(album.album_type, album.soundtrack_flag),
        releaseYear: album.release_year,
        roleLabel: roleLabel(role?.role ?? null),
        coverPath: artwork?.canonical_cover_path ?? null,
        artworkStatus: artwork?.artwork_status ?? null,
        chartPeak: chartPeakByAlbumId.get(album.retroverse_album_id) ?? null,
        chartWeeks: chartWeeksByAlbumId.get(album.retroverse_album_id) ?? 0,
        chartingTrackCount: chartingTrackIdsByAlbumId.get(album.retroverse_album_id)?.size ?? 0,
        trackCount: albumTracks.length,
        majorTracks,
      };
    })
    .sort((a, b) => {
      if (a.releaseYear === null && b.releaseYear === null) return a.title.localeCompare(b.title);
      if (a.releaseYear === null) return 1;
      if (b.releaseYear === null) return -1;
      return a.releaseYear - b.releaseYear || a.title.localeCompare(b.title);
    });

  const chartingTracks = tracks
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
        chartWeeks: chartWeeksByTrackId.get(track.retroverse_track_id) ?? 0,
        signalTier: "primary" as SignalTier,
        signalReason: "canonical chart signal",
        contextLabel,
        eraId: track.era_id,
      };
    })
    .filter((row) => row !== null)
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
      return null;
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
    description: "Albums, tracks, and chart highlights for this artist.",
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

function chartPeakStrength(peak: number | null | undefined): number {
  if (!peak || peak <= 0) return 0;
  return Math.max(4, Math.round(((101 - Math.min(100, peak)) / 100) * 100));
}

function chartWeeksStrength(weeks: number | null | undefined): number {
  if (!weeks || weeks <= 0) return 5;
  return Math.max(12, Math.min(100, Math.round(Math.log2(weeks + 1) * 18)));
}

function chartPeakPlacement(peak: number | null | undefined): number {
  if (!peak || peak <= 0) return 100;
  return Math.max(2, Math.min(100, Math.round(((200 - Math.min(200, peak)) / 199) * 98 + 2)));
}

function chartPeakLabel(peak: number | null | undefined): string {
  return peak ? `Peak #${peak}` : "No chart peak";
}

function chartMomentLabel(album: AlbumAppearance): string {
  if (album.chartPeak === 1) return "No. 1 run";
  if (album.chartPeak && album.chartPeak <= 10) return "Breakthrough";
  if ((album.chartWeeks ?? 0) >= 20) return "Long chart life";
  if ((album.trackCount ?? 0) >= 8) return "Deep cut field";
  return "Catalog signal";
}

function trackCountLabel(count: number | null | undefined): string {
  if (count && count > 0) return `${count} tracks`;
  return "tracks resolving";
}

function trackSignalLabel(track: Pick<ArtistChartTrack, "peakChartPosition" | "chartWeeks" | "contextLabel">): string {
  if (track.peakChartPosition <= 1) return `No. 1 single · ${track.chartWeeks ?? 0} weeks`;
  if (track.peakChartPosition <= 10) return `Top 10 single · ${track.chartWeeks ?? 0} weeks`;
  if ((track.chartWeeks ?? 0) >= 20) return `Long Hot 100 run · ${track.chartWeeks ?? 0} weeks`;
  return `${track.contextLabel} · ${track.chartWeeks ?? 0} weeks`;
}

function sortTrackSignals(a: ArtistChartTrack, b: ArtistChartTrack): number {
  const tierOrder: Record<SignalTier, number> = { primary: 0, related: 1, archive: 2 };
  const tierDelta = tierOrder[a.signalTier ?? "primary"] - tierOrder[b.signalTier ?? "primary"];
  if (tierDelta !== 0) return tierDelta;
  return a.peakChartPosition - b.peakChartPosition || (b.chartWeeks ?? 0) - (a.chartWeeks ?? 0) || a.title.localeCompare(b.title);
}

function albumCoverUrl(album: Pick<AlbumAppearance, "coverPath">): string | null {
  return canonicalCoverPathToUrl(album.coverPath, {});
}

function trackHref(trackId: string, title?: string): string {
  const canonicalHref = hrefForTrack(trackId);
  if (canonicalHref !== "/tracks") return canonicalHref;
  return title?.trim() ? `/tracks?q=${encodeURIComponent(title.trim())}` : canonicalHref;
}

function fallbackEraTitle(index: number): string {
  if (index === 0) return "Early Recordings";
  if (index === 1) return "Breakthrough Years";
  if (index === 2) return "Peak Years";
  if (index === 3) return "Reinvention";
  return "Legacy Era";
}

export default async function ArtistEntityPage({ params }: ArtistPageProps) {
  const { slug } = await params;
  let data: Awaited<ReturnType<typeof loadArtistExperience>> = null;
  try {
    data = await loadArtistExperience(slug);
  } catch (e) {
    logArtistPageError("ArtistEntityPage", slug, e);
  }
  if (!data) {
    return (
      <EntityStatus
        title="Entity unavailable"
        message="This artist could not be loaded. Try search or browse the archive."
        backHref="/artists"
        backLabel="Artists"
      />
    );
  }

  const universe = (data as Partial<ArtistUniverseExperience>).universe ?? null;

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
  const primaryChartTracks = data.chartingTracks
    .filter((track) => (track.signalTier ?? "primary") === "primary")
    .sort(sortTrackSignals);
  const relatedSignalCount = data.chartingTracks.filter((track) => (track.signalTier ?? "primary") !== "primary").length;
  const keySongs =
    primaryChartTracks.length > 0
      ? primaryChartTracks
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
            chartWeeks: 0,
            contextLabel: "Album track",
            signalTier: "archive" as const,
            signalReason: "fallback album landmark",
            eraId: null,
          }));
  const hasChartedKeySongs = primaryChartTracks.length > 0;
  const visualDiscography = data.connectedAlbums.slice(0, densityTier === "minimal" ? 8 : densityTier === "standard" ? 16 : 28);
  const iconicAlbums = [...data.connectedAlbums]
    .sort((a, b) => {
      const aPeak = a.chartPeak ?? 999;
      const bPeak = b.chartPeak ?? 999;
      if (a.coverPath && !b.coverPath) return -1;
      if (!a.coverPath && b.coverPath) return 1;
      if (aPeak !== bPeak) return aPeak - bPeak;
      return (a.releaseYear ?? 9999) - (b.releaseYear ?? 9999);
    })
    .slice(0, 4);
  const peakChartYear =
    data.chartingTracks
      .filter((row) => row.releaseYear !== null)
      .sort((a, b) => a.peakChartPosition - b.peakChartPosition || (a.releaseYear ?? 9999) - (b.releaseYear ?? 9999))[0]
      ?.releaseYear ?? null;
  const strongestYears = [
    ...new Set([
      ...(universe?.dominant_years ?? []),
      ...data.chartingTracks
        .filter((row) => row.releaseYear !== null)
        .sort((a, b) => a.peakChartPosition - b.peakChartPosition)
        .map((row) => row.releaseYear as number),
      ...data.connectedAlbums
        .filter((row) => row.releaseYear !== null && (row.chartPeak !== null || row.coverPath))
        .map((row) => row.releaseYear as number),
    ]),
  ].slice(0, 5);
  return (
    <div className="artist-universe min-h-full">
      <div className="artist-uni-atmosphere" aria-hidden />
      <article className="artist-uni-article mx-auto max-w-[52rem] px-4 py-10 pb-16 sm:px-6 sm:py-[4.25rem]">
        <header className="artist-uni-hero artist-uni-hero--discography mb-8 space-y-4 sm:mb-10">
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
          <div className="artist-uni-hero-grid">
            <div className="artist-uni-hero-copy">
              <p className="artist-uni-eyebrow">Artist · albums &amp; chart highlights</p>
              <h1 className="artist-uni-title text-[2.55rem] sm:text-[3.35rem]">{data.artist.canonical_artist_name}</h1>
              <p className="artist-uni-sub text-[1.02rem] sm:text-[1.08rem]">
                {hasYearRange ? `${firstActiveYear}-${lastActiveYear}` : "Career years resolving"} · {data.connectedAlbums.length} album
                {data.connectedAlbums.length === 1 ? "" : "s"} · {data.connectedTrackRows.length} tracks in the archive
                {peakChartYear ? ` · peak chart year ${peakChartYear}` : ""}
              </p>
            </div>
            {iconicAlbums.length > 0 ? (
              <div className="artist-uni-cover-stack" aria-label="Iconic album covers">
                {iconicAlbums.map((album, idx) => {
                  const cover = albumCoverUrl(album);
                  return (
                    <Link
                      key={`hero-cover-${album.id}`}
                      href={album.href}
                      className="artist-uni-hero-cover"
                      style={{ ["--au-cover-tilt" as string]: `${idx % 2 === 0 ? -2 : 2}deg` }}
                    >
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" loading={idx === 0 ? "eager" : "lazy"} draggable={false} />
                      ) : (
                        <span>{album.title}</span>
                      )}
                    </Link>
                  );
                })}
              </div>
            ) : null}
          </div>
          <div className="artist-uni-hero-facts" aria-label="Career signals">
            {strongestYears.length > 0 ? (
              <div>
                <span className="artist-uni-fact-label">Strongest years</span>
                <span className="artist-uni-fact-value">{strongestYears.join(" · ")}</span>
              </div>
            ) : null}
            {peakChartYear ? (
              <div>
                <span className="artist-uni-fact-label">Peak chart year</span>
                <span className="artist-uni-fact-value">{peakChartYear}</span>
              </div>
            ) : null}
            {data.metrics.numberOneCount > 0 ? (
              <div>
                <span className="artist-uni-fact-label">No. 1 records</span>
                <span className="artist-uni-fact-value">{data.metrics.numberOneCount}</span>
              </div>
            ) : null}
            {data.primaryEra ? (
              <Link href={data.primaryEra.href} className="artist-uni-hero-era">
                {data.primaryEra.name}
              </Link>
            ) : null}
          </div>
          {showChapters ? (
            <div className="artist-uni-era-orbit" aria-label="Career eras">
              {chapters.map((chapter, index) => (
                <a key={chapter.key} href={`#${chapter.key}`} className="artist-uni-era-chip">
                  {chapter.title || fallbackEraTitle(index)}
                  <span className="sr-only"> · {chapter.rangeLabel}</span>
                </a>
              ))}
            </div>
          ) : null}
        </header>

        {visualDiscography.length > 0 ? (
          <section className="artist-uni-discography mb-12 space-y-4" aria-labelledby="visual-discography">
            <div className="artist-uni-section-intro">
              <p className="artist-uni-section-label">Visual discography</p>
              <h2 id="visual-discography" className="artist-uni-h2 !mb-0">Career trajectory</h2>
              <div className="artist-uni-trajectory-key" aria-label="Trajectory legend">
                <span>Weeks = length</span>
                <span>Peak = glow</span>
                <span>Tracks = texture</span>
              </div>
            </div>
            <div className="artist-uni-discography-list">
              {visualDiscography.map((album, index) => {
                const cover = albumCoverUrl(album);
                const peakStrength = chartPeakStrength(album.chartPeak);
                const weeksStrength = chartWeeksStrength(album.chartWeeks);
                const peakPlacement = chartPeakPlacement(album.chartPeak);
                const hasChartSignal = peakStrength > 0 || (album.chartWeeks ?? 0) > 0;
                return (
                  <article
                    key={`discography-${album.id}`}
                    className="artist-uni-album-card"
                    data-album-id={album.id}
                    data-chart-peak={album.chartPeak ?? "unresolved"}
                    data-track-count={album.trackCount ?? 0}
                    style={{
                      ["--au-peak-glow" as string]: `${peakStrength / 100}`,
                      ["--au-impact-hue" as string]: `${26 + Math.round(peakStrength * 0.24)}deg`,
                      ["--au-chart-placement" as string]: `${peakPlacement}%`,
                      ["--au-chart-weeks" as string]: `${weeksStrength}%`,
                    }}
                  >
                    <Link href={album.href} className="artist-uni-album-cover" aria-label={album.title}>
                      {cover ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={cover} alt="" loading={index < 4 ? "eager" : "lazy"} draggable={false} />
                      ) : (
                        <span>{album.title}</span>
                      )}
                    </Link>
                    <div className="artist-uni-album-body">
                      <div className="artist-uni-album-head">
                        <div>
                          <p className="artist-uni-album-year">{album.releaseYear ?? "Year unknown"}</p>
                          <h3>
                            <Link href={album.href} className="artist-uni-inline-link">
                              {album.title}
                            </Link>
                          </h3>
                        </div>
                        <span className="artist-uni-album-type">{chartMomentLabel(album)}</span>
                      </div>
                      <div className="artist-uni-chart-bar" aria-label={`${album.title} chart trajectory`}>
                        <span
                          className="artist-uni-chart-bar-fill"
                          style={{ width: `${hasChartSignal ? peakPlacement : 100}%` }}
                        />
                        {album.chartPeak ? (
                          <span
                            className="artist-uni-chart-peak-pin"
                            style={{ left: `${peakPlacement}%` }}
                          />
                        ) : null}
                        <span className="artist-uni-chart-weeks-glow" style={{ width: `${weeksStrength}%` }} />
                      </div>
                      <div className="artist-uni-album-stats">
                        <span>{chartPeakLabel(album.chartPeak)}</span>
                        <span>{album.chartWeeks ?? 0} chart weeks</span>
                        <span>{trackCountLabel(album.trackCount)}</span>
                        {album.roleLabel ? <span>{album.roleLabel}</span> : null}
                      </div>
                      {album.majorTracks && album.majorTracks.length > 0 ? (
                        <div className="artist-uni-album-tracks" aria-label={`Major tracks from ${album.title}`}>
                          {album.majorTracks.map((track) => (
                            <Link key={`${album.id}-${track.id}`} href={trackHref(track.id, track.title)} className="artist-uni-track-chip">
                              {track.title}
                              {track.peakChartPosition ? <span>#{track.peakChartPosition}</span> : null}
                            </Link>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>
        ) : null}

        {showChapters ? (
          <section className="mb-12 space-y-8">
            <p className="artist-uni-section-label">Career eras</p>
            <div className="space-y-8">
              {chapters.map((chapter, index) => (
                <article
                  key={chapter.key}
                  id={chapter.key}
                  className="artist-uni-chapter-card sm:pl-5"
                  style={{ ["--au-era-hue" as string]: `${24 + index * 34}deg` }}
                >
                  <header className="space-y-1.5">
                    <p className="artist-uni-muted text-[0.78rem] uppercase tracking-[0.12em]">{chapter.rangeLabel}</p>
                    <h3 className="font-serif text-[1.34rem] leading-tight text-[color:rgba(252,248,255,0.95)] sm:text-[1.46rem]">
                      {chapter.title}
                    </h3>
                    <p className="artist-uni-muted text-[0.92rem]">{chapter.summary}</p>
                  </header>

                  {chapter.albums.length > 0 ? (
                    <div className="artist-uni-era-covers" aria-label={`${chapter.title} album landmarks`}>
                      {chapter.albums.slice(0, 6).map((album) => {
                        const cover = albumCoverUrl(album);
                        return (
                          <Link key={`${chapter.key}-${album.id}`} href={album.href} className="artist-uni-era-cover">
                            {cover ? (
                              // eslint-disable-next-line @next/next/no-img-element
                              <img src={cover} alt="" loading="lazy" draggable={false} />
                            ) : (
                              <span>{album.title}</span>
                            )}
                          </Link>
                        );
                      })}
                    </div>
                  ) : null}

                  {chapter.chartTracks.length > 0 ? (
                    <ul className="artist-uni-plate artist-uni-list mt-3 overflow-hidden py-1">
                      {chapter.chartTracks.map((track) => (
                        <li key={`${chapter.key}-${track.id}`} className="artist-uni-row">
                          <div className="artist-uni-track-line">
                            <div className="min-w-0">
                              <p className="text-[0.96rem]">
                                <Link href={trackHref(track.id, track.title)} className="artist-uni-inline-link">
                                  {track.title}
                                </Link>{" "}
                                ·{" "}
                                <Link href={track.albumHref} className="artist-uni-inline-link">
                                  {track.albumTitle}
                                </Link>
                              </p>
                              <span className="artist-uni-track-mini-bar">
                                <span style={{ width: `${chartPeakStrength(track.peakChartPosition)}%` }} />
                              </span>
                            </div>
                            <span className="artist-uni-track-peak">Peak #{track.peakChartPosition}</span>
                          </div>
                        </li>
                      ))}
                    </ul>
                  ) : null}

                  {chapter.representativeTracks.length > 0 ? (
                    <p className="artist-uni-muted mt-2 text-[0.9rem] leading-[1.58]">
                      Also heard:{" "}
                      {chapter.representativeTracks.map((track, idx) => (
                        <span key={`${chapter.key}-rep-${track.id}`}>
                          {idx > 0 ? " · " : ""}
                          <Link href={trackHref(track.id, track.title)} className="artist-uni-inline-link">
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
          <section className="artist-uni-major-tracks mb-10 space-y-3">
            <p className="artist-uni-section-label -mt-1 !mb-1">
              {hasChartedKeySongs ? "Hot 100 public signal" : "Album landmarks"}
            </p>
            <h2 className="artist-uni-h2">Major tracks</h2>
            <div className="artist-uni-track-grid">
              {keySongs.map((track, index) => {
                const trackStrength = chartPeakStrength(track.peakChartPosition);
                const trackWeeksStrength = chartWeeksStrength(track.chartWeeks);
                return (
                  <article
                    key={track.id}
                    className="artist-uni-track-card"
                    data-track-id={track.id}
                    data-track-peak={hasChartedKeySongs ? track.peakChartPosition : "fallback"}
                    data-signal-tier={track.signalTier ?? (hasChartedKeySongs ? "primary" : "archive")}
                    data-track-weeks={track.chartWeeks ?? 0}
                    style={{
                      ["--au-track-strength" as string]: `${trackStrength || 18}%`,
                      ["--au-track-weeks" as string]: `${trackWeeksStrength}%`,
                      ["--au-track-hue" as string]: `${24 + index * 11}deg`,
                    }}
                  >
                    <Link href={trackHref(track.id, track.title)} className="artist-uni-track-title">
                      {track.title}
                    </Link>
                    <p>
                      <Link href={track.albumHref} className="artist-uni-inline-link">
                        {track.albumTitle}
                      </Link>
                      {track.releaseYear !== null ? ` · ${track.releaseYear}` : ""}
                    </p>
                    <span className="artist-uni-track-mini-bar">
                      <span style={{ width: `${trackStrength || 18}%` }} />
                    </span>
                    {hasChartedKeySongs ? (
                      <span className="artist-uni-track-peak">{trackSignalLabel(track)}</span>
                    ) : (
                      <span className="artist-uni-track-peak">Album landmark</span>
                    )}
                  </article>
                );
              })}
            </div>
            {relatedSignalCount > 0 ? (
              <p className="artist-uni-muted text-[0.78rem]">
                {relatedSignalCount} related chart variant{relatedSignalCount === 1 ? "" : "s"} not shown in the main list.
              </p>
            ) : null}
          </section>
        ) : (
          <section className="artist-uni-plate mb-10 max-w-[36rem] px-5 py-5">
            <h2 className="artist-uni-h2 !mb-1">Track relationships</h2>
            <p className="artist-uni-muted text-[0.9rem] leading-relaxed">
              Track-level links for this artist are still resolving. Album relationships remain available above, and the canonical track index stays reachable through the archive.
            </p>
            <Link href="/tracks" className="artist-uni-inline-link mt-3 inline-block">
              Open track index
            </Link>
          </section>
        )}

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
                          <Link href={trackHref(track.id, track.title)} className="artist-uni-inline-link">
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

        <div className="artist-uni-secondary-nav mb-10">
          <p className="artist-uni-section-label">Connected entity context</p>
          <RetroverseEntityNav
            back={{ href: "/artists", label: "Artists" }}
            items={[
              { href: "/", label: "Home" },
              { href: "/albums", label: "Albums" },
              { href: `/tracks?q=${encodeURIComponent(data.artist.canonical_artist_name)}`, label: "Tracks" },
              { href: "/track-deck", label: "Charts" },
              { href: "/album-retroscope", label: "Retroscope" },
            ]}
          />
        </div>

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
