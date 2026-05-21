import type { Metadata } from "next";
import type { CSSProperties } from "react";
import Link from "next/link";
import { TrackPageBody } from "@/app/tracks/track-page-body";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { buildTrackContextLine, buildTrackCulturalRole } from "@/lib/retroverse-editorial";
import { getEraBySlug } from "@/lib/eras";
import { hrefForAlbum, hrefForArtist } from "@/lib/retroverse-routes";
import { loadTrackLineage, type TrackLineageAppearance } from "@/lib/retroverse-lineage";
import { generateTrackPathways } from "@/lib/retroverse-pathways";
import {
  loadCanonicalTrackById,
  loadCanonicalTrackByTitleSlug,
  loadCanonicalTrackVersions,
} from "@/lib/load-canonical-track-graph";
import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";
import { chartsToTrajectoryWeeks } from "@/lib/charts-to-trajectory-weeks";
import {
  loadTrackAcousticProfile,
  resolveTrackRetroverseId,
} from "@/lib/load-track-acoustic-profile";
import { loadTrackTrajectory, type TrackTrajectory, type TrackTrajectoryWeek } from "@/lib/load-track-trajectory";
import { trackDialHeatMultiplier } from "@/lib/track-dial-heat-scale";
import { resolveTrajectoryHistoricalHeat } from "@/lib/trajectory-historical-heat";
import { TrackDetailHero } from "@/app/tracks/track-detail-hero";
import { resolveTrackHeroAlbum, type TrackHeroAlbumCandidate } from "@/lib/load-track-hero-album";
import { TrackInstrumentationStrip } from "@/app/tracks/track-instrumentation-strip";
import { logEntityLoaderError } from "@/lib/entity-safe";
import { createClient, tryCreateClient } from "@/lib/supabase";
import { EntityStatus } from "@/app/components/entity-status";
import "@/app/retroverse-public.css";
import "@/app/albums/album-dossier.css";

export const metadata: Metadata = {
  title: "Track - Retroverse",
  description: "Hot 100 chart run, peak, and album links for a song.",
};
export const dynamic = "force-dynamic";

type TrackPageProps = {
  params: Promise<{ id: string }>;
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  retroverse_album_id: string | null;
  release_year: number | null;
  era_id: string | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  release_year: number | null;
  album_type: string | null;
  soundtrack_flag: boolean;
  era_id: string | null;
};

type EraRow = {
  retroverse_era_id: string;
  slug: string;
  display_name: string;
  start_year: number;
};

type ChartRow = {
  retroverse_chart_id: string;
  chart_date: string;
  chart_name: string;
  chart_position: number;
  weeks_on_chart: number | null;
};

type RelatedTrack = {
  retroverseTrackId: string;
  retroverseArtistId: string | null;
  title: string;
  artist: string;
  albumId: string | null;
  albumTitle: string;
  albumHref: string;
  coverPath: string | null;
  artworkStatus: string | null;
  releaseYear: number | null;
  peakChartPosition: number | null;
  reasons: string[];
};

function normalizeSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function albumTypeLabel(albumType: string | null, soundtrackFlag: boolean): string {
  if (soundtrackFlag) return "Soundtrack";
  if (albumType === "compilation") return "Compilation";
  if (albumType === "studio") return "Studio album";
  if (albumType === "live") return "Live album";
  return "Album";
}

function eraHref(era: EraRow): string {
  if (era.start_year === 1974) return "/eras/1974-1977";
  return `/eras/${era.slug}`;
}

function appearanceContextLabel(context: TrackLineageAppearance["appearanceContext"]): string {
  switch (context) {
    case "original_album_anchor":
      return "First release";
    case "same_album_variant":
      return "Alternate album cut";
    case "later_compilation_reuse":
      return "Compilation cut";
    case "later_soundtrack_reuse":
      return "Soundtrack cut";
    case "later_live_reuse":
      return "Live release";
    case "later_reissue_or_recut":
      return "Reissue/recut";
    default:
      return "Another release";
  }
}

function lineageSentence(appearance: TrackLineageAppearance, index: number): string {
  const year = appearance.editionReleaseYear ?? appearance.albumReleaseYear;
  const yearLabel = year !== null ? `${year}` : "year not set";
  if (index === 0) {
    return `First heard on ${appearance.canonicalAlbumTitle} (${yearLabel}).`;
  }
  switch (appearance.appearanceContext) {
    case "later_compilation_reuse":
      return `Later heard on ${appearance.canonicalAlbumTitle} (${yearLabel}) as a compilation cut.`;
    case "later_soundtrack_reuse":
      return `Later heard on ${appearance.canonicalAlbumTitle} (${yearLabel}) in a soundtrack release.`;
    case "later_live_reuse":
      return `Later heard on ${appearance.canonicalAlbumTitle} (${yearLabel}) in a live release.`;
    case "same_album_variant":
      return `Also issued on an alternate album version: ${appearance.canonicalAlbumTitle} (${yearLabel}).`;
    case "later_reissue_or_recut":
      return `Returns on a later release: ${appearance.canonicalAlbumTitle} (${yearLabel}).`;
    default:
      return `Appears again on ${appearance.canonicalAlbumTitle} (${yearLabel}).`;
  }
}

async function resolveTrackIdFromParam(
  supabase: ReturnType<typeof createClient>,
  idParam: string,
): Promise<string | null> {
  if (/^RVTR[0-9]{6}$/i.test(idParam)) {
    const fromGraph = await loadCanonicalTrackById(idParam);
    return (fromGraph?.retroverseTrackId ?? idParam).toUpperCase();
  }

  const slugMatch = await loadCanonicalTrackByTitleSlug(idParam);
  if (slugMatch?.retroverseTrackId) return slugMatch.retroverseTrackId.toUpperCase();

  const sourceMatchResult = await supabase
    .from("retroverse_source_matches")
    .select("retroverse_entity_id, source_key")
    .eq("retroverse_entity_type", "track")
    .ilike("source_key", `%::${idParam.toLowerCase()}`)
    .limit(1);

  if (sourceMatchResult.error) {
    logEntityLoaderError("resolveTrackId:sourceMatch", "/tracks/[id]", idParam, sourceMatchResult.error);
    return null;
  }
  if (sourceMatchResult.data && sourceMatchResult.data.length > 0) {
    return sourceMatchResult.data[0].retroverse_entity_id;
  }

  const normalizedId = normalizeSlug(idParam);
  const titleMatchResult = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id, canonical_title")
    .range(0, 5000);

  if (titleMatchResult.error) {
    logEntityLoaderError("resolveTrackId:titleMatch", "/tracks/[id]", idParam, titleMatchResult.error);
    return null;
  }
  const exactSlugMatch =
    titleMatchResult.data?.find((row) => normalizeSlug(row.canonical_title) === normalizedId) ?? null;
  return exactSlugMatch?.retroverse_track_id ?? null;
}

async function loadTrackGraph(idParam: string) {
  const route = `/tracks/${idParam}`;
  const supabase = tryCreateClient() ?? (() => {
    try {
      return createClient();
    } catch (e) {
      logEntityLoaderError("createClient", route, idParam, e);
      return null;
    }
  })();
  if (!supabase) return null;

  const resolvedTrackId = await resolveTrackIdFromParam(supabase, idParam);
  if (!resolvedTrackId) return null;

  const canonicalEntity =
    (await loadCanonicalTrackById(resolvedTrackId)) ??
    (await loadCanonicalTrackByTitleSlug(idParam));
  const canonicalVersions = await loadCanonicalTrackVersions(resolvedTrackId);

  const trackResult = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, release_year, era_id")
    .eq("retroverse_track_id", resolvedTrackId)
    .limit(1)
    .maybeSingle<TrackRow>();

  if (trackResult.error) {
    logEntityLoaderError("retroverse_tracks", route, resolvedTrackId, trackResult.error);
    return null;
  }
  if (!trackResult.data) return null;
  const track = trackResult.data;

  let lineage: Awaited<ReturnType<typeof loadTrackLineage>> = null;
  try {
    lineage = await loadTrackLineage(supabase, track.retroverse_track_id);
  } catch (e) {
    logEntityLoaderError("loadTrackLineage", route, track.retroverse_track_id, e);
  }

  const appearanceAlbumIds = [...new Set((lineage?.appearances ?? []).map((row) => row.retroverseAlbumId))];

  const [artistResult, chartsResult, appearanceAlbumsResult] = await Promise.all([
    supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .eq("retroverse_artist_id", track.retroverse_artist_id)
      .limit(1)
      .maybeSingle<ArtistRow>(),
    supabase
      .from("retroverse_chart_appearances")
      .select("retroverse_chart_id, chart_date, chart_name, chart_position, weeks_on_chart")
      .eq("retroverse_track_id", track.retroverse_track_id)
      .order("chart_date", { ascending: true })
      .order("chart_position", { ascending: true }),
    appearanceAlbumIds.length > 0
      ? supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, release_year, album_type, soundtrack_flag, era_id")
          .in("retroverse_album_id", appearanceAlbumIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  if (artistResult.error) logEntityLoaderError("retroverse_artists", route, track.retroverse_artist_id, artistResult.error);
  if (chartsResult.error) logEntityLoaderError("retroverse_chart_appearances", route, track.retroverse_track_id, chartsResult.error);
  if (appearanceAlbumsResult.error) {
    logEntityLoaderError("retroverse_albums", route, track.retroverse_track_id, appearanceAlbumsResult.error);
  }

  const artist: ArtistRow =
    artistResult.data ?? {
      retroverse_artist_id: track.retroverse_artist_id,
      canonical_artist_name: "Unknown artist",
    };
  const charts = (chartsResult.data ?? []) as ChartRow[];
  const appearanceAlbums = (appearanceAlbumsResult.data ?? []) as AlbumRow[];
  const albumById = new Map(appearanceAlbums.map((row) => [row.retroverse_album_id, row]));

  const artworkRows = await loadAlbumArtworkRows(supabase, appearanceAlbumIds);

  const appearancesWithAlbum = (lineage?.appearances ?? [])
    .map((row) => ({
      ...row,
      album: albumById.get(row.retroverseAlbumId) ?? null,
      coverPath:
        selectCanonicalArtwork(artworkRows, row.retroverseAlbumId, row.retroverseAlbumEditionId)?.canonical_cover_path ?? null,
    }))
    .sort((a, b) => {
      const ay = a.editionReleaseYear ?? a.albumReleaseYear ?? 9999;
      const by = b.editionReleaseYear ?? b.albumReleaseYear ?? 9999;
      if (ay !== by) return ay - by;
      return a.canonicalAlbumTitle.localeCompare(b.canonicalAlbumTitle);
    });

  const directTrackAlbum = track.retroverse_album_id ? albumById.get(track.retroverse_album_id) ?? null : null;
  const originalAppearance =
    appearancesWithAlbum.find((row) => row.appearanceContext === "original_album_anchor") ?? appearancesWithAlbum[0] ?? null;
  const laterAppearances = appearancesWithAlbum.slice(1);

  const connectedEraIds = [...new Set([track.era_id, ...appearanceAlbums.map((row) => row.era_id)].filter(Boolean))] as string[];
  const erasResult =
    connectedEraIds.length > 0
      ? await supabase
          .from("retroverse_eras")
          .select("retroverse_era_id, slug, display_name, start_year")
          .in("retroverse_era_id", connectedEraIds)
      : { data: [], error: null };
  if (erasResult.error) logEntityLoaderError("retroverse_eras", route, track.retroverse_track_id, erasResult.error);
  const eras = (erasResult.data ?? []) as EraRow[];
  const eraById = new Map(eras.map((row) => [row.retroverse_era_id, row]));

  const eraAppearanceCounts = new Map<string, number>();
  for (const appearance of appearancesWithAlbum) {
    const eraId = appearance.album?.era_id ?? null;
    if (!eraId) continue;
    eraAppearanceCounts.set(eraId, (eraAppearanceCounts.get(eraId) ?? 0) + 1);
  }
  if (track.era_id && !eraAppearanceCounts.has(track.era_id)) {
    eraAppearanceCounts.set(track.era_id, 1);
  }
  const erasConnected = [...eraAppearanceCounts.entries()]
    .map(([eraId, count]) => ({
      era: eraById.get(eraId) ?? null,
      count,
    }))
    .filter((row): row is { era: EraRow; count: number } => row.era !== null)
    .sort((a, b) => a.era.start_year - b.era.start_year || a.era.display_name.localeCompare(b.era.display_name));

  const firstEra = erasConnected[0]?.era ?? null;
  const dominantEra =
    [...erasConnected].sort((a, b) => b.count - a.count || a.era.start_year - b.era.start_year)[0]?.era ?? null;
  const reuseIntoLaterEra =
    firstEra && erasConnected.some((row) => row.era.start_year > firstEra.start_year) ? true : false;

  const peakChartPosition = charts.length > 0 ? Math.min(...charts.map((row) => row.chart_position)) : null;
  const maxWeeksOnChart = charts.length > 0 ? Math.max(...charts.map((row) => row.weeks_on_chart ?? 0), 0) || null : null;

  const sequenceLabel = originalAppearance
    ? `Disc ${originalAppearance.discNumber}, ${originalAppearance.sideCode ? `Side ${originalAppearance.sideCode}` : "Side not set"}, Track ${originalAppearance.trackNumber}`
    : null;

  const contextLine = buildTrackContextLine({
    peakChartPosition,
    chartEntryCount: charts.length,
    maxWeeksOnChart,
    soundtrackFlag: originalAppearance?.album?.soundtrack_flag ?? false,
    lineageAppearanceCount: appearancesWithAlbum.length,
    laterReuseCount: laterAppearances.length,
    primaryEraName: firstEra?.display_name ?? null,
    sequenceLabel,
  });

  const culturalRoleLines = buildTrackCulturalRole({
    peakChartPosition,
    chartEntryCount: charts.length,
    maxWeeksOnChart,
    soundtrackFlag: originalAppearance?.album?.soundtrack_flag ?? false,
    lineageAppearanceCount: appearancesWithAlbum.length,
    laterReuseCount: laterAppearances.length,
    primaryEraName: dominantEra?.display_name ?? null,
    sequenceLabel,
  });

  const primaryEditionIds = [...new Set((lineage?.appearances ?? []).map((row) => row.retroverseAlbumEditionId))];
  const albumTracksForContextResult =
    primaryEditionIds.length > 0
      ? await supabase
          .from("retroverse_album_tracks")
          .select("retroverse_album_edition_id, retroverse_track_id")
          .in("retroverse_album_edition_id", primaryEditionIds)
      : { data: [], error: null };
  if (albumTracksForContextResult.error) {
    logEntityLoaderError("retroverse_album_tracks:context", route, track.retroverse_track_id, albumTracksForContextResult.error);
  }
  const albumTracksForContext = albumTracksForContextResult.data ?? [];

  const shareAlbumCandidateIds = new Set<string>();
  for (const row of albumTracksForContext) {
    if (row.retroverse_track_id !== track.retroverse_track_id) shareAlbumCandidateIds.add(row.retroverse_track_id);
  }

  const sameEraTracksResult =
    connectedEraIds.length > 0
      ? await supabase
          .from("retroverse_tracks")
          .select("retroverse_track_id, era_id")
          .in("era_id", connectedEraIds)
          .neq("retroverse_track_id", track.retroverse_track_id)
          .limit(200)
      : { data: [], error: null };
  if (sameEraTracksResult.error) {
    logEntityLoaderError("retroverse_tracks:sameEra", route, track.retroverse_track_id, sameEraTracksResult.error);
  }
  const sameEraCandidateIds = new Set((sameEraTracksResult.data ?? []).map((row) => row.retroverse_track_id));

  const reuseAlbumIds = new Set(
    laterAppearances
      .filter((row) => row.appearanceContext === "later_compilation_reuse" || row.appearanceContext === "later_soundtrack_reuse")
      .map((row) => row.retroverseAlbumId),
  );
  const reuseEditionIds = (lineage?.appearances ?? [])
    .filter((row) => reuseAlbumIds.has(row.retroverseAlbumId))
    .map((row) => row.retroverseAlbumEditionId);
  const reuseTracksResult =
    reuseEditionIds.length > 0
      ? await supabase
          .from("retroverse_album_tracks")
          .select("retroverse_track_id")
          .in("retroverse_album_edition_id", reuseEditionIds)
          .neq("retroverse_track_id", track.retroverse_track_id)
      : { data: [], error: null };
  if (reuseTracksResult.error) {
    logEntityLoaderError("retroverse_album_tracks:reuse", route, track.retroverse_track_id, reuseTracksResult.error);
  }
  const reusePatternCandidateIds = new Set((reuseTracksResult.data ?? []).map((row) => row.retroverse_track_id));

  const allRelatedIds = [...new Set([...shareAlbumCandidateIds, ...sameEraCandidateIds, ...reusePatternCandidateIds])].slice(0, 80);
  const [relatedTracksResult, relatedChartsResult] = await Promise.all([
    allRelatedIds.length > 0
      ? supabase
          .from("retroverse_tracks")
          .select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, release_year")
          .in("retroverse_track_id", allRelatedIds)
      : Promise.resolve({ data: [], error: null }),
    allRelatedIds.length > 0
      ? supabase
          .from("retroverse_chart_appearances")
          .select("retroverse_track_id, chart_position")
          .in("retroverse_track_id", allRelatedIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (relatedTracksResult.error) {
    logEntityLoaderError("retroverse_tracks:related", route, track.retroverse_track_id, relatedTracksResult.error);
  }
  if (relatedChartsResult.error) {
    logEntityLoaderError("retroverse_chart_appearances:related", route, track.retroverse_track_id, relatedChartsResult.error);
  }

  const relatedTracks = relatedTracksResult.data ?? [];
  const relatedAlbumIds = [
    ...new Set(relatedTracks.map((row) => row.retroverse_album_id).filter((row): row is string => Boolean(row))),
  ];
  const [relatedAlbumsResult, relatedEditionsResult, relatedArtworkRows] = await Promise.all([
    relatedAlbumIds.length > 0
      ? supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title")
          .in("retroverse_album_id", relatedAlbumIds)
      : Promise.resolve({ data: [], error: null }),
    relatedAlbumIds.length > 0
      ? supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id")
          .in("retroverse_album_id", relatedAlbumIds)
          .eq("is_primary", true)
      : Promise.resolve({ data: [], error: null }),
    loadAlbumArtworkRows(supabase, relatedAlbumIds),
  ]);
  if (relatedAlbumsResult.error) {
    logEntityLoaderError("retroverse_albums:related", route, track.retroverse_track_id, relatedAlbumsResult.error);
  }
  if (relatedEditionsResult.error) {
    logEntityLoaderError("retroverse_album_editions:related", route, track.retroverse_track_id, relatedEditionsResult.error);
  }

  const relatedAlbumTitleById = new Map(
    (relatedAlbumsResult.data ?? []).map((row) => [row.retroverse_album_id, row.canonical_album_title]),
  );
  const relatedPrimaryEditionByAlbumId = new Map(
    (relatedEditionsResult.data ?? []).map((row) => [row.retroverse_album_id, row.retroverse_album_edition_id]),
  );

  const relatedArtistIds = [...new Set(relatedTracks.map((row) => row.retroverse_artist_id))];
  const artistsForRelatedResult =
    relatedArtistIds.length > 0
      ? await supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .in("retroverse_artist_id", relatedArtistIds)
      : { data: [], error: null };
  if (artistsForRelatedResult.error) {
    logEntityLoaderError("retroverse_artists:related", route, track.retroverse_track_id, artistsForRelatedResult.error);
  }
  const relatedArtistById = new Map(
    (artistsForRelatedResult.data ?? []).map((row) => [row.retroverse_artist_id, row.canonical_artist_name]),
  );

  const peakByTrackId = new Map<string, number>();
  for (const row of relatedChartsResult.data ?? []) {
    const current = peakByTrackId.get(row.retroverse_track_id);
    if (current === undefined || row.chart_position < current) {
      peakByTrackId.set(row.retroverse_track_id, row.chart_position);
    }
  }

  const relatedRows: RelatedTrack[] = relatedTracks
    .map((row) => {
      const reasons: string[] = [];
      if (shareAlbumCandidateIds.has(row.retroverse_track_id)) reasons.push("Shares album context");
      if (sameEraCandidateIds.has(row.retroverse_track_id)) reasons.push("Shares era cluster");
      if (reusePatternCandidateIds.has(row.retroverse_track_id)) reasons.push("Shares reuse pattern");
      return {
        retroverseTrackId: row.retroverse_track_id,
        retroverseArtistId: row.retroverse_artist_id,
        title: row.canonical_title,
        artist: relatedArtistById.get(row.retroverse_artist_id) ?? "Unknown artist",
        albumId: row.retroverse_album_id ?? null,
        albumTitle: row.retroverse_album_id
          ? relatedAlbumTitleById.get(row.retroverse_album_id) ?? "Album unknown"
          : "Album unknown",
        albumHref:
          row.retroverse_album_id
            ? hrefForAlbum(row.retroverse_album_id, relatedAlbumTitleById.get(row.retroverse_album_id) ?? "")
            : "/albums",
        coverPath:
          row.retroverse_album_id
            ? selectCanonicalArtwork(
                relatedArtworkRows,
                row.retroverse_album_id,
                relatedPrimaryEditionByAlbumId.get(row.retroverse_album_id) ?? null,
              )?.canonical_cover_path ?? null
            : null,
        artworkStatus:
          row.retroverse_album_id
            ? selectCanonicalArtwork(
                relatedArtworkRows,
                row.retroverse_album_id,
                relatedPrimaryEditionByAlbumId.get(row.retroverse_album_id) ?? null,
              )?.artwork_status ?? null
            : null,
        releaseYear: row.release_year ?? null,
        peakChartPosition: peakByTrackId.get(row.retroverse_track_id) ?? null,
        reasons,
      };
    })
    .filter((row) => row.reasons.length > 0)
    .sort((a, b) => {
      if (a.reasons.length !== b.reasons.length) return b.reasons.length - a.reasons.length;
      const aPeak = a.peakChartPosition ?? 999;
      const bPeak = b.peakChartPosition ?? 999;
      if (aPeak !== bPeak) return aPeak - bPeak;
      return a.title.localeCompare(b.title);
    })
    .slice(0, 14);

  let pathways: Awaited<ReturnType<typeof generateTrackPathways>> = [];
  try {
    pathways = await generateTrackPathways(supabase, track.retroverse_track_id);
  } catch (e) {
    logEntityLoaderError("generateTrackPathways", route, track.retroverse_track_id, e);
  }

  return {
    partial: !lineage,
    canonicalEntity,
    canonicalVersions,
    track,
    artist,
    charts,
    peakChartPosition,
    maxWeeksOnChart,
    contextLine,
    culturalRoleLines,
    appearancesWithAlbum,
    originalAppearance,
    directTrackAlbum,
    erasConnected,
    firstEra,
    dominantEra,
    reuseIntoLaterEra,
    relatedRows,
    pathways,
  };
}

function formatChartDate(value: string | null): string {
  if (!value) return "—";
  const date = new Date(`${value}T00:00:00Z`);
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(date);
}

function mean01(...vals: Array<number | null | undefined>): number {
  const ok = vals.filter((x): x is number => x != null && Number.isFinite(x));
  if (!ok.length) return 0;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

function retroverseDialFromProfile(profile: AggregatedAcousticProfile): number {
  const cultural = mean01(profile.liveness, profile.speechiness, profile.danceability);
  const replay = mean01(profile.danceability, profile.energy, profile.valence != null ? profile.valence * 0.85 : null);
  return Math.min(
    99,
    Math.round(mean01(profile.energy, profile.valence, cultural, replay) * 100),
  );
}

type TrackInstrumentationContext = {
  profile: AggregatedAcousticProfile;
  retroverseTrackId: string | null;
  heroAlbum: Awaited<ReturnType<typeof resolveTrackHeroAlbum>>;
};

function renderTrackChartRunRail(
  weeks: TrackTrajectoryWeek[],
  peak: number | null,
  dialMultiplier: number,
) {
  return (
    <section
      className="dossier-panel dossier-panel--band-teal dossier-trajectory-panel"
      aria-label="Hot 100 chart run"
    >
      <div className="dossier-trajectory-scale" aria-hidden>
        <span>#100</span>
        <span>#50</span>
        <span>#1</span>
      </div>
      <ol className="dossier-trajectory-rail">
        {weeks.map((week, index) => {
          const momentClasses = trajectoryMomentClasses(weeks, index);
          const heat = resolveTrajectoryHistoricalHeat(week, index, weeks, peak);
          const intensity = Math.min(1, heat.intensity * dialMultiplier);
          return (
            <li
              key={`${week.issueDate}-${index}`}
              className={`dossier-trajectory-week ${momentClasses}`.trim()}
              style={
                {
                  "--rank-x": `${week.x}%`,
                  "--heat-intensity": String(intensity),
                  "--heat-bg": heat.atmosphereBg,
                  "--heat-border": heat.atmosphereBorder,
                  "--heat-glow": heat.atmosphereGlow,
                  "--heat-rail": heat.railTint,
                  "--heat-bar": heat.barFill,
                } as CSSProperties
              }
            >
              <div className="dossier-trajectory-date">
                <span>{formatChartDate(week.issueDate)}</span>
                <small>week {week.weeksOnChart ?? index + 1}</small>
              </div>
              <div className="dossier-trajectory-track" aria-hidden />
              <div className="dossier-trajectory-rank">
                <strong>#{week.rank}</strong>
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function trajectoryMomentClasses(weeks: TrackTrajectoryWeek[], index: number): string {
  const week = weeks[index];
  const previous = index > 0 ? weeks[index - 1] : null;
  const twoBack = index > 1 ? weeks[index - 2] : null;
  const classes: string[] = [];

  if (week.rank === 1) classes.push("dossier-trajectory-week--number-one");
  if (week.rank <= 10 && (!previous || previous.rank > 10)) classes.push("dossier-trajectory-week--top-ten");
  if (week.rank <= 40 && (!previous || previous.rank > 40)) classes.push("dossier-trajectory-week--top-forty");
  if (week.movement === "reentry") classes.push("dossier-trajectory-week--recurrence");
  if ((week.weeksOnChart ?? 0) >= 20) classes.push("dossier-trajectory-week--long-run");
  if (previous && twoBack && previous.rank > twoBack.rank && week.rank < previous.rank) {
    classes.push("dossier-trajectory-week--rebound");
  }

  return classes.join(" ");
}

function renderTrajectoryPage(data: TrackTrajectory, instrumentation: TrackInstrumentationContext) {
  const dialMultiplier = trackDialHeatMultiplier(retroverseDialFromProfile(instrumentation.profile));
  const heroAlbum = instrumentation.heroAlbum;
  return (
    <>
      <TrackPageBody />
      <div className="dossier-shell dossier-shell--trajectory">
        <header className="dossier-top dossier-top--nav">
          <Link href="/tracks" className="dossier-a dossier-a--quiet">
            Tracks
          </Link>
          <Link href="/track-deck" className="dossier-a dossier-a--quiet">
            Hot 100 deck
          </Link>
        </header>

        <div className="dossier-track-identity">
          <TrackDetailHero
            title={data.canonicalTitle}
            artistName={data.canonicalArtist}
            artistHref={data.artistHref}
            sourceLabel="Hot 100"
            releaseYear={heroAlbum?.releaseYear ?? null}
            album={heroAlbum}
            chart={{
              peak: data.peak,
              weeks: data.weeksCharted,
              firstChartWeek: data.firstChartWeek,
              finalChartWeek: data.finalChartWeek,
            }}
          />

          <TrackInstrumentationStrip title={data.canonicalTitle} profile={instrumentation.profile} />
        </div>

        {renderTrackChartRunRail(data.weeks, data.peak, dialMultiplier)}

        <section className="dossier-track-support">
          <article className="dossier-panel dossier-panel--band-plank">
            <h2 className="dossier-panel-label">Related albums</h2>
            {data.connectedAlbums.length ? (
              <ul className="dossier-support-list">
                {data.connectedAlbums.map((album) => (
                  <li key={album.albumId}>
                    <Link href={`/albums/${album.albumId}`}>{album.albumTitle}</Link>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="dossier-provenance">No linked albums yet</p>
            )}
          </article>

          <article className="dossier-panel dossier-panel--band-gold">
            <h2 className="dossier-panel-label">Related tracks</h2>
            <ul className="dossier-support-list">
              {data.relatedTracks.map((track) => (
                <li key={track.href}>
                  <Link href={track.href}>{track.title}</Link>
                  <span>{track.peak != null ? `#${track.peak}` : "—"} · {track.weeks ?? "—"} weeks</span>
                </li>
              ))}
            </ul>
          </article>

          {data.reentryCount > 0 ? (
            <article className="dossier-panel dossier-panel--band-teal">
              <h2 className="dossier-panel-label">Chart notes</h2>
              <p className="dossier-provenance">
                Re-entered the Hot 100 {data.reentryCount} time{data.reentryCount === 1 ? "" : "s"} after leaving the chart.
              </p>
            </article>
          ) : null}
        </section>
      </div>
    </>
  );
}

export default async function TrackDetailPage({ params }: TrackPageProps) {
  const { id } = await params;
  const trajectory = loadTrackTrajectory(id);
  if (trajectory) {
    const retroverseTrackId = await resolveTrackRetroverseId(
      trajectory.canonicalArtist,
      trajectory.canonicalTitle,
    );
    const profile = await loadTrackAcousticProfile(
      trajectory.canonicalArtist,
      trajectory.canonicalTitle,
      retroverseTrackId,
    );
    const heroAlbum = await resolveTrackHeroAlbum({
      artist: trajectory.canonicalArtist,
      title: trajectory.canonicalTitle,
      retroverseTrackId,
      candidates: trajectory.connectedAlbums.map((a) => ({
        albumId: a.albumId,
        albumTitle: a.albumTitle,
      })),
    });
    return renderTrajectoryPage(trajectory, { profile, retroverseTrackId, heroAlbum });
  }

  let data: Awaited<ReturnType<typeof loadTrackGraph>> = null;
  try {
    data = await loadTrackGraph(id);
  } catch (e) {
    logEntityLoaderError("loadTrackGraph", `/tracks/${id}`, id, e);
  }
  if (!data) {
    return (
      <EntityStatus
        title="Track not found"
        message="This track could not be loaded. Try search or browse tracks."
        backHref="/"
      />
    );
  }

  const {
    track,
    artist,
    charts,
    peakChartPosition,
    maxWeeksOnChart,
    originalAppearance,
    directTrackAlbum,
    appearancesWithAlbum,
    relatedRows,
  } = data;

  const artistHref = hrefForArtist(artist.retroverse_artist_id, artist.canonical_artist_name);

  const retroverseTrackId =
    data.canonicalEntity?.trackId ?? track.retroverse_track_id;
  const profile = await loadTrackAcousticProfile(
    artist.canonical_artist_name,
    track.canonical_title,
    retroverseTrackId,
  );
  const heroCandidates: TrackHeroAlbumCandidate[] = [];
  if (originalAppearance) {
    heroCandidates.push({
      albumId: originalAppearance.retroverseAlbumId,
      albumTitle: originalAppearance.canonicalAlbumTitle,
      releaseYear: originalAppearance.editionReleaseYear ?? originalAppearance.albumReleaseYear,
    });
  } else if (directTrackAlbum) {
    heroCandidates.push({
      albumId: directTrackAlbum.retroverse_album_id,
      albumTitle: directTrackAlbum.canonical_album_title,
      releaseYear: directTrackAlbum.release_year,
    });
  } else {
    const fallbackAppearance =
      appearancesWithAlbum.find((row) => row.appearanceContext === "original_album_anchor") ??
      appearancesWithAlbum[0];
    if (fallbackAppearance) {
      heroCandidates.push({
        albumId: fallbackAppearance.retroverseAlbumId,
        albumTitle: fallbackAppearance.canonicalAlbumTitle,
        releaseYear:
          fallbackAppearance.editionReleaseYear ?? fallbackAppearance.albumReleaseYear ?? null,
      });
    }
  }

  const heroAlbum = await resolveTrackHeroAlbum({
    artist: artist.canonical_artist_name,
    title: track.canonical_title,
    retroverseTrackId,
    candidates: heroCandidates,
  });

  const releaseYear =
    heroAlbum?.releaseYear ??
    track.release_year ??
    originalAppearance?.editionReleaseYear ??
    originalAppearance?.albumReleaseYear ??
    directTrackAlbum?.release_year ??
    null;

  const instrumentation: TrackInstrumentationContext = {
    profile,
    retroverseTrackId: retroverseTrackId?.toUpperCase() ?? null,
    heroAlbum,
  };
  const trajectoryWeeks = charts.length > 0 ? chartsToTrajectoryWeeks(charts) : [];
  const dialMultiplier = trackDialHeatMultiplier(retroverseDialFromProfile(profile));

  if (trajectoryWeeks.length > 0) {
    return (
      <>
        <TrackPageBody />
        <div className="dossier-shell dossier-shell--trajectory">
          <header className="dossier-top dossier-top--nav">
            <Link href="/tracks" className="dossier-a dossier-a--quiet">
              Tracks
            </Link>
            <Link href="/" className="dossier-a dossier-a--quiet">
              Search
            </Link>
          </header>

          <div className="dossier-track-identity">
            <TrackDetailHero
              title={track.canonical_title}
              artistName={artist.canonical_artist_name}
              artistHref={artistHref}
              releaseYear={releaseYear}
              sourceLabel="Hot 100"
              album={heroAlbum}
              chart={{
                peak: peakChartPosition,
                weeks: maxWeeksOnChart ?? charts[0]?.weeks_on_chart ?? null,
                firstChartWeek: charts[0]?.chart_date ?? null,
                finalChartWeek: charts[charts.length - 1]?.chart_date ?? null,
              }}
            />

            <TrackInstrumentationStrip title={track.canonical_title} profile={instrumentation.profile} />
          </div>

          {renderTrackChartRunRail(trajectoryWeeks, peakChartPosition, dialMultiplier)}

          {relatedRows.length > 0 ? (
            <section className="dossier-track-support">
              <article className="dossier-panel dossier-panel--band-gold">
                <h2 className="dossier-panel-label">Related tracks</h2>
                <ul className="dossier-support-list">
                  {relatedRows.map((row) => (
                    <li key={row.retroverseTrackId}>
                      <Link href={`/tracks/${row.retroverseTrackId}`}>{row.title}</Link>
                      <span>
                        {row.peakChartPosition !== null ? `#${row.peakChartPosition}` : "—"} · {row.artist}
                      </span>
                    </li>
                  ))}
                </ul>
              </article>
            </section>
          ) : null}
        </div>
      </>
    );
  }

  return (
    <>
      <TrackPageBody />
      <div className="dossier-shell dossier-shell--trajectory">
        <header className="dossier-top dossier-top--nav">
          <Link href="/tracks" className="dossier-a dossier-a--quiet">
            Tracks
          </Link>
          <Link href="/" className="dossier-a dossier-a--quiet">
            Search
          </Link>
        </header>

        <div className="dossier-track-identity">
          <TrackDetailHero
            title={track.canonical_title}
            artistName={artist.canonical_artist_name}
            artistHref={artistHref}
            releaseYear={releaseYear}
            album={heroAlbum}
          />

          <TrackInstrumentationStrip title={track.canonical_title} profile={instrumentation.profile} />
        </div>

        {relatedRows.length > 0 ? (
          <section className="dossier-track-support">
            <article className="dossier-panel dossier-panel--band-gold">
              <h2 className="dossier-panel-label">Related tracks</h2>
              <ul className="dossier-support-list">
                {relatedRows.map((row) => (
                  <li key={row.retroverseTrackId}>
                    <Link href={`/tracks/${row.retroverseTrackId}`}>{row.title}</Link>
                    <span>{row.artist}</span>
                  </li>
                ))}
              </ul>
            </article>
          </section>
        ) : null}
      </div>
    </>
  );
}
