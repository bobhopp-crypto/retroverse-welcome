import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { HistoryBackButton } from "@/app/history-back-button";
import { CompactArtworkThumb } from "@/app/components/compact-artwork-thumb";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import { buildTrackContextLine, buildTrackCulturalRole } from "@/lib/retroverse-editorial";
import { getEraBySlug } from "@/lib/eras";
import { albumRoute, artistRoute } from "@/lib/retroverse-routes";
import { loadTrackLineage, type TrackLineageAppearance } from "@/lib/retroverse-lineage";
import { generateTrackPathways } from "@/lib/retroverse-pathways";
import { createClient } from "@/lib/supabase";
import { ArtworkFrame } from "@/app/components/artwork-frame";

export const metadata: Metadata = {
  title: "Track - Retroverse",
  description: "Canonical track graph traversal powered by Retroverse.",
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

function albumHrefFromTitle(title: string): string {
  return albumRoute(title);
}

function artistHrefFromName(name: string): string {
  return artistRoute(name);
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
  if (/^RVTR[0-9]{6}$/i.test(idParam)) return idParam.toUpperCase();

  const sourceMatchResult = await supabase
    .from("retroverse_source_matches")
    .select("retroverse_entity_id, source_key")
    .eq("retroverse_entity_type", "track")
    .ilike("source_key", `%::${idParam.toLowerCase()}`)
    .limit(1);

  if (sourceMatchResult.error) throw sourceMatchResult.error;
  if (sourceMatchResult.data && sourceMatchResult.data.length > 0) {
    return sourceMatchResult.data[0].retroverse_entity_id;
  }

  const normalizedId = normalizeSlug(idParam);
  const titleMatchResult = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id, canonical_title")
    .range(0, 5000);

  if (titleMatchResult.error) throw titleMatchResult.error;
  const exactSlugMatch =
    titleMatchResult.data?.find((row) => normalizeSlug(row.canonical_title) === normalizedId) ?? null;
  return exactSlugMatch?.retroverse_track_id ?? null;
}

async function loadTrackGraph(idParam: string) {
  const supabase = createClient();
  const resolvedTrackId = await resolveTrackIdFromParam(supabase, idParam);
  if (!resolvedTrackId) return null;

  const trackResult = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id, canonical_title, retroverse_artist_id, retroverse_album_id, release_year, era_id")
    .eq("retroverse_track_id", resolvedTrackId)
    .limit(1)
    .maybeSingle<TrackRow>();

  if (trackResult.error) throw trackResult.error;
  if (!trackResult.data) return null;
  const track = trackResult.data;

  const lineage = await loadTrackLineage(supabase, track.retroverse_track_id);
  if (!lineage) return null;

  const appearanceAlbumIds = [...new Set(lineage.appearances.map((row) => row.retroverseAlbumId))];

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

  if (artistResult.error) throw artistResult.error;
  if (chartsResult.error) throw chartsResult.error;
  if (appearanceAlbumsResult.error) throw appearanceAlbumsResult.error;

  const artist = artistResult.data;
  if (!artist) return null;
  const charts = (chartsResult.data ?? []) as ChartRow[];
  const appearanceAlbums = (appearanceAlbumsResult.data ?? []) as AlbumRow[];
  const albumById = new Map(appearanceAlbums.map((row) => [row.retroverse_album_id, row]));

  const artworkRows = await loadAlbumArtworkRows(supabase, appearanceAlbumIds);

  const appearancesWithAlbum = lineage.appearances
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
  if (erasResult.error) throw erasResult.error;
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

  const primaryEditionIds = [...new Set(lineage.appearances.map((row) => row.retroverseAlbumEditionId))];
  const albumTracksForContextResult =
    primaryEditionIds.length > 0
      ? await supabase
          .from("retroverse_album_tracks")
          .select("retroverse_album_edition_id, retroverse_track_id")
          .in("retroverse_album_edition_id", primaryEditionIds)
      : { data: [], error: null };
  if (albumTracksForContextResult.error) throw albumTracksForContextResult.error;
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
  if (sameEraTracksResult.error) throw sameEraTracksResult.error;
  const sameEraCandidateIds = new Set((sameEraTracksResult.data ?? []).map((row) => row.retroverse_track_id));

  const reuseAlbumIds = new Set(
    laterAppearances
      .filter((row) => row.appearanceContext === "later_compilation_reuse" || row.appearanceContext === "later_soundtrack_reuse")
      .map((row) => row.retroverseAlbumId),
  );
  const reuseEditionIds = lineage.appearances
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
  if (reuseTracksResult.error) throw reuseTracksResult.error;
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
  if (relatedTracksResult.error) throw relatedTracksResult.error;
  if (relatedChartsResult.error) throw relatedChartsResult.error;

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
  if (relatedAlbumsResult.error) throw relatedAlbumsResult.error;
  if (relatedEditionsResult.error) throw relatedEditionsResult.error;

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
  if (artistsForRelatedResult.error) throw artistsForRelatedResult.error;
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
        title: row.canonical_title,
        artist: relatedArtistById.get(row.retroverse_artist_id) ?? "Unknown artist",
        albumId: row.retroverse_album_id ?? null,
        albumTitle: row.retroverse_album_id
          ? relatedAlbumTitleById.get(row.retroverse_album_id) ?? "Album unknown"
          : "Album unknown",
        albumHref:
          row.retroverse_album_id && relatedAlbumTitleById.get(row.retroverse_album_id)
            ? albumRoute(relatedAlbumTitleById.get(row.retroverse_album_id) ?? "")
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

  const pathways = await generateTrackPathways(supabase, track.retroverse_track_id);

  return {
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

export default async function TrackDetailPage({ params }: TrackPageProps) {
  const { id } = await params;
  const data = await loadTrackGraph(id);
  if (!data) notFound();

  const {
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
  } = data;

  const chartYearLabel =
    charts.length > 0
      ? `${new Date(charts[0].chart_date).getFullYear()}-${new Date(charts[charts.length - 1].chart_date).getFullYear()}`
      : "No chart years available";
  const firstEraRecord = firstEra ? getEraBySlug(firstEra.slug) : undefined;
  const eraAccent = firstEraRecord?.accent ?? "#b9a48a";
  const atmosphericPanelStyle = {
    borderLeftColor: eraAccent,
    background: `color-mix(in srgb, var(--surface-raised) 86%, ${eraAccent} 14%)`,
  } as const;
  const artistHref = artistHrefFromName(artist.canonical_artist_name);
  const primaryAlbumHref = originalAppearance
    ? albumHrefFromTitle(originalAppearance.canonicalAlbumTitle)
    : directTrackAlbum
    ? albumHrefFromTitle(directTrackAlbum.canonical_album_title)
    : "/albums";

  return (
    <div className="min-h-full bg-[var(--page-gradient)]">
      <article className="mx-auto max-w-[44rem] px-4 py-9 pb-14 sm:px-6 sm:py-[4rem]">
        <header className="mb-7 space-y-2.5 border-b border-[var(--card-border)]/65 pb-4 sm:mb-8 sm:pb-5">
          <p className="text-[0.74rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]">
            <Link href="/artists" className="underline-offset-2 hover:underline">
              Artists
            </Link>
            {" → "}
            <Link href={artistHref} className="underline-offset-2 hover:underline">
              {artist.canonical_artist_name}
            </Link>
            {" → "}
            {track.canonical_title}
            {originalAppearance || directTrackAlbum ? (
              <>
                {" → "}
                <Link
                  href={primaryAlbumHref}
                  className="underline-offset-2 hover:underline"
                >
                  {originalAppearance?.canonicalAlbumTitle ?? directTrackAlbum?.canonical_album_title}
                </Link>
              </>
            ) : null}
            {firstEra ? (
              <>
                {" → "}
                <Link href={eraHref(firstEra)} className="underline-offset-2 hover:underline">
                  {firstEra.display_name}
                </Link>
              </>
            ) : null}
          </p>
          <p className="text-[0.88rem] tracking-[0.04em] text-[var(--text-secondary)]">
            Track record
          </p>
          <h1 className="font-serif text-[2.55rem] leading-[1.02] tracking-tight text-[var(--text-primary)] sm:text-[3.15rem]">
            {track.canonical_title}
          </h1>
          <p className="font-serif text-[1.22rem] italic text-[var(--text-secondary)] sm:text-[1.35rem]">
            <Link href={artistHref} className="underline-offset-4 hover:underline">
              {artist.canonical_artist_name}
            </Link>
          </p>
          <p className="text-[0.9rem] tracking-[0.02em] text-[var(--text-secondary)]">
            {track.release_year !== null ? `${track.release_year} release` : "Release year unknown"}
            {peakChartPosition !== null ? ` · peak #${peakChartPosition}` : ""}
            {charts.length > 0 ? ` · ${charts.length} chart entries` : ""}
          </p>
          <p className="max-w-[40ch] text-[1.03rem] leading-[1.7] text-[var(--text-secondary)] sm:text-[1.08rem]">
            {contextLine}
          </p>
        </header>

        <div className="mb-8">
          <HistoryBackButton
            fallbackHref="/tracks"
            label="Back"
            className="inline-flex items-center rounded-full border border-[var(--card-border)] px-4 py-2 text-[0.95rem] font-medium text-[var(--text-primary)] transition-colors hover:bg-[var(--surface-muted)]"
          />
        </div>

        {charts.length > 0 ? (
          <section id="track-charts" className="mb-8 space-y-2.5">
            <h2 className="font-serif text-[1.62rem] leading-[1.1] tracking-[0.006em] text-[var(--text-primary)] sm:text-[1.8rem]">
              Chart Movement
            </h2>
            <p className="text-[0.9rem] tracking-[0.02em] text-[var(--text-secondary)]">
              {peakChartPosition !== null ? `Peak #${peakChartPosition}` : "No chart position linked"}
              {maxWeeksOnChart !== null ? ` · up to ${maxWeeksOnChart} weeks` : ""}
              {charts.length > 0 ? ` · ${chartYearLabel}` : ""}
            </p>
            <ul className="border-l-2 border-[var(--card-border)]/60 pl-3">
              {charts.map((row) => (
                <li key={row.retroverse_chart_id} className="py-2.5">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="text-[1rem] font-medium text-[var(--text-primary)]">{row.chart_name}</p>
                    <span className="text-[0.74rem] uppercase tracking-[0.11em] text-[var(--text-secondary)]">
                      #{row.chart_position}
                    </span>
                  </div>
                  <p className="text-[0.9rem] text-[var(--text-secondary)]">
                    {new Date(row.chart_date).toISOString().slice(0, 10)}
                    {row.weeks_on_chart !== null ? ` · ${row.weeks_on_chart} weeks` : ""}
                  </p>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section id="track-anchor" className="mb-8 space-y-3">
          <h2 className="font-serif text-[1.56rem] leading-[1.14] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.82rem]">
            From the Album
          </h2>
          {originalAppearance ? (
            <div className="grid gap-3 sm:grid-cols-[12.25rem_1fr] sm:items-start">
              <ArtworkFrame
                title={originalAppearance.canonicalAlbumTitle}
                canonicalCoverPath={originalAppearance.coverPath}
                albumId={originalAppearance.retroverseAlbumId}
                artist={artist.canonical_artist_name}
                year={originalAppearance.editionReleaseYear ?? originalAppearance.albumReleaseYear ?? null}
              />
              <div className="space-y-2.5">
                <p className="font-serif text-[1.2rem] leading-tight text-[var(--text-primary)]">
                  <Link
                    href={primaryAlbumHref}
                    className="underline-offset-4 hover:underline"
                  >
                    {originalAppearance.canonicalAlbumTitle}
                  </Link>
                </p>
                <p className="text-[0.88rem] tracking-[0.02em] text-[var(--text-secondary)]">
                  {albumTypeLabel(originalAppearance.albumType, originalAppearance.soundtrackFlag)}
                  {(originalAppearance.editionReleaseYear ?? originalAppearance.albumReleaseYear) !== null
                    ? ` · ${originalAppearance.editionReleaseYear ?? originalAppearance.albumReleaseYear}`
                    : ""}
                </p>
                <p className="text-[0.95rem] leading-[1.62] text-[var(--text-secondary)]">
                  Disc {originalAppearance.discNumber}, {originalAppearance.sideCode ? `Side ${originalAppearance.sideCode}, ` : ""}
                  Track {originalAppearance.trackNumber}.
                </p>
                <p className="text-[0.95rem] leading-[1.62] text-[var(--text-secondary)]">
                  {lineageSentence(originalAppearance, 0)}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-[0.94rem] leading-[1.68] text-[var(--text-secondary)]">
                Album placement is still resolving.
              </p>
              {directTrackAlbum ? (
                <p className="text-[0.95rem] text-[var(--text-secondary)]">
                  Album link:{" "}
                  <Link href={albumHrefFromTitle(directTrackAlbum.canonical_album_title)} className="underline-offset-2 hover:underline">
                    {directTrackAlbum.canonical_album_title}
                  </Link>
                </p>
              ) : null}
            </div>
          )}
        </section>

        {appearancesWithAlbum.length > 0 ? (
          <section id="track-lineage" className="mb-8 space-y-3">
            <h2 className="font-serif text-[1.5rem] leading-[1.15] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.72rem]">
              Across Releases
            </h2>
            <ol className="max-w-[38rem] space-y-1.5 text-[0.96rem] leading-[1.58] text-[var(--text-secondary)]">
              {appearancesWithAlbum.map((appearance, index) => (
                <li key={`${appearance.retroverseAlbumEditionId}-${appearance.discNumber}-${appearance.trackNumber}-${index}`}>
                  {lineageSentence(appearance, index)}
                </li>
              ))}
            </ol>
          </section>
        ) : null}

        {appearancesWithAlbum.length > 0 ? (
          <section className="mb-8 space-y-3 rounded-md p-3 sm:p-4" style={atmosphericPanelStyle}>
            <h2 className="font-serif text-[1.5rem] leading-[1.15] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.72rem]">
              Also Playing
            </h2>
            <ul className="border-y border-[var(--card-border)]/56">
              {appearancesWithAlbum.map((appearance, index) => (
                <li
                  key={`${appearance.retroverseAlbumEditionId}-${appearance.discNumber}-${appearance.trackNumber}-${index}`}
                  className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0"
                >
                  <div className="grid gap-3 sm:grid-cols-[5rem_1fr] sm:items-start">
                    <ArtworkFrame
                      title={appearance.canonicalAlbumTitle}
                      canonicalCoverPath={appearance.coverPath}
                      albumId={appearance.retroverseAlbumId}
                      artist={artist.canonical_artist_name}
                      year={appearance.editionReleaseYear ?? appearance.albumReleaseYear ?? null}
                    />
                    <div className="min-w-0">
                      <p className="text-[0.98rem] font-medium text-[var(--text-primary)] sm:text-[1.01rem]">
                        <Link href={albumHrefFromTitle(appearance.canonicalAlbumTitle)} className="underline-offset-4 hover:underline">
                          {appearance.canonicalAlbumTitle}
                        </Link>
                      </p>
                      <p className="text-[0.9rem] text-[var(--text-secondary)]">
                        {appearance.editionReleaseYear ?? appearance.albumReleaseYear ?? "Year unknown"} ·{" "}
                        {albumTypeLabel(appearance.albumType, appearance.soundtrackFlag)}
                      </p>
                      <p className="text-[0.85rem] tracking-[0.02em] text-[var(--text-secondary)]">
                        {appearanceContextLabel(appearance.appearanceContext)}
                      </p>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <section className="mb-8 space-y-3 p-1 sm:p-2">
          <h2 className="font-serif text-[1.42rem] leading-[1.18] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.5rem]">
            Around This Time
          </h2>
          {firstEra || dominantEra || reuseIntoLaterEra ? (
            <p className="max-w-[40ch] text-[0.96rem] leading-[1.58] text-[var(--text-secondary)]">
              {firstEra ? `First heard in ${firstEra.display_name}. ` : ""}
              {dominantEra ? `Most often heard in ${dominantEra.display_name}. ` : ""}
              {reuseIntoLaterEra ? "Later years include new appearances." : ""}
            </p>
          ) : null}
          <ul className="max-w-[36rem] border-y border-[var(--card-border)]/50">
            {erasConnected.map((row) => (
              <li key={row.era.retroverse_era_id} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                <Link href={eraHref(row.era)} className="flex items-center justify-between gap-2 hover:underline">
                  <span className="text-[0.95rem] text-[var(--text-primary)]">{row.era.display_name}</span>
                  <span className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/82">
                    {row.count} appearances
                  </span>
                </Link>
              </li>
            ))}
          </ul>
          <ul className="space-y-2 text-[0.96rem] leading-[1.58] text-[var(--text-secondary)]">
            {culturalRoleLines.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </section>

        {relatedRows.length > 0 ? (
          <section id="track-related" className="mb-10 space-y-3">
            <h2 className="font-serif text-[1.42rem] leading-[1.18] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.5rem]">
              Neighboring Singles
            </h2>
            <ul className="max-w-[38rem] border-y border-[var(--card-border)]/50">
              {relatedRows.map((row) => {
                return (
                <li key={row.retroverseTrackId} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-start gap-2.5 pr-2">
                      <CompactArtworkThumb
                        title={row.albumTitle}
                        canonicalCoverPath={row.coverPath}
                        albumId={row.albumId ?? undefined}
                        artist={row.artist}
                        year={row.releaseYear}
                        artworkStatus={row.artworkStatus}
                      />
                      <div className="min-w-0">
                        <p className="text-[0.98rem] font-medium text-[var(--text-primary)] sm:text-[1.01rem]">
                          <Link href={`/tracks/${row.retroverseTrackId}`} className="underline-offset-4 hover:underline">
                            {row.title}
                          </Link>{" "}
                          -{" "}
                          <Link href={artistHrefFromName(row.artist)} className="underline-offset-2 hover:underline">
                            {row.artist}
                          </Link>
                        </p>
                        <p className="truncate text-[0.82rem] text-[var(--text-secondary)]/86 sm:text-[0.86rem]">
                          <Link href={row.albumHref} className="underline-offset-2 hover:underline">
                            {row.albumTitle}
                          </Link>
                          {row.releaseYear !== null ? ` · ${row.releaseYear}` : ""}
                        </p>
                        <p className="text-[0.82rem] text-[var(--text-secondary)]/84 sm:text-[0.86rem]">{row.reasons.join(" · ")}</p>
                      </div>
                    </div>
                    {row.peakChartPosition !== null ? (
                      <span className="text-[0.68rem] uppercase tracking-[0.12em] text-[var(--text-secondary)]/82">
                        Peak #{row.peakChartPosition}
                      </span>
                    ) : null}
                  </div>
                </li>
              )})}
            </ul>
          </section>
        ) : null}

        <section className="space-y-4">
          <h2 className="font-serif text-[1.42rem] leading-[1.18] tracking-[0.008em] text-[var(--text-primary)] sm:text-[1.5rem]">
            Continue Through...
          </h2>
          <ul className="max-w-[36rem] border-y border-[var(--card-border)]/50">
            {pathways.length > 0 ? (
              pathways.map((pathway) => (
                <li key={pathway.key} className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                  <Link href={pathway.href} className="block hover:underline">
                    <p className="text-[0.95rem] text-[var(--text-primary)]">{pathway.label}</p>
                    <p className="text-[0.84rem] text-[var(--text-secondary)]/85 sm:text-[0.88rem]">{pathway.summary}</p>
                  </Link>
                </li>
              ))
            ) : (
              <li className="border-b border-[var(--card-border)]/42 py-2.5 last:border-b-0">
                <Link href="/random" className="block hover:underline">
                  <p className="text-[0.95rem] text-[var(--text-primary)]">Explore Randomly</p>
                  <p className="text-[0.84rem] text-[var(--text-secondary)]/85 sm:text-[0.88rem]">
                    Follow a random jump to keep moving.
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
