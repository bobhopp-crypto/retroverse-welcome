import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AlbumPageHeroCurator } from "@/app/components/album-page-hero-curator";
import { BodyClassName } from "@/app/components/body-class-name";
import { HistoryBackButton } from "@/app/history-back-button";
import { logRetroverseAlbumDiagnosticsOnce } from "@/lib/retroverse-album-diagnostics";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";
import {
  buildCompilationAlbumContext,
  buildSoundtrackAlbumContext,
  buildStudioAlbumContext,
} from "@/lib/retroverse-editorial";
import { generateAlbumPathways } from "@/lib/retroverse-pathways";
import { artistRoute, normalizeEntitySlug } from "@/lib/retroverse-routes";
import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { createClient } from "@/lib/supabase";

/**
 * Album metadata is essentially static; covers change but the save endpoint
 * already calls `revalidateTag('artwork:<id>')`. ISR keeps navigation snappy.
 */
export const revalidate = 3600;

type AlbumPageProps = {
  params: Promise<{ slug: string }>;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  soundtrack_flag: boolean;
  album_type: string | null;
  era_id: string | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type EraRow = {
  retroverse_era_id: string;
  slug: string;
  display_name: string;
};

type EditionRow = {
  retroverse_album_id: string;
  retroverse_album_edition_id: string;
  edition_name: string;
  is_primary: boolean;
  release_year: number | null;
};

type SiblingEditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type AlbumTrackRow = {
  retroverse_album_edition_id?: string;
  retroverse_track_id: string;
  disc_number: number;
  track_number: number;
  side_code: string | null;
  side_position: number | null;
  soundtrack_exclusive: boolean;
  is_interlude: boolean;
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  notes: string | null;
};

type ChartRow = {
  retroverse_track_id: string;
  chart_position: number;
  weeks_on_chart: number | null;
};

type MediaAssetRow = {
  retroverse_track_id: string;
  thumbnail_path: string | null;
  is_primary: boolean;
};

type SequencedTrack = {
  retroverseTrackId: string | null;
  title: string;
  artist: string;
  trackNumber: number;
  discNumber: number;
  sideCode: string;
  sidePosition: number | null;
  peakChartPosition: number | null;
  weeksOnChart: number | null;
  charted: boolean;
  releaseYear: number | null;
  notes: string | null;
  soundtrackExclusive: boolean;
  isInterlude: boolean;
  mediaThumbnailPath: string | null;
};

type SideGroup = {
  sideCode: string;
  tracks: SequencedTrack[];
};

type DiscGroup = {
  discNumber: number;
  sides: SideGroup[];
};

function sideSortValue(sideCode: string): number {
  const values = ["A", "B", "C", "D", "E", "F", "G", "H", "?"];
  const idx = values.indexOf(sideCode);
  return idx === -1 ? values.length : idx;
}

function dedupeAlbumTrackRows(rows: AlbumTrackRow[]): AlbumTrackRow[] {
  const seen = new Set<string>();
  const out: AlbumTrackRow[] = [];
  for (const row of rows) {
    if (seen.has(row.retroverse_track_id)) continue;
    seen.add(row.retroverse_track_id);
    out.push(row);
  }
  return out;
}

async function resolveAlbumBySlug(slug: string, supabase: ReturnType<typeof createClient>): Promise<AlbumRow | null> {
  if (/^RVAL[0-9]{6}$/i.test(slug)) {
    const byIdResult = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, soundtrack_flag, album_type, era_id")
      .eq("retroverse_album_id", slug.toUpperCase())
      .limit(1)
      .maybeSingle<AlbumRow>();
    if (byIdResult.error) throw byIdResult.error;
    return byIdResult.data ?? null;
  }

  const sourceMatchResult = await supabase
    .from("retroverse_source_matches")
    .select("retroverse_entity_id")
    .eq("retroverse_entity_type", "album")
    .ilike("source_key", `%::${slug.toLowerCase()}`)
    .limit(1);
  if (sourceMatchResult.error) throw sourceMatchResult.error;
  const matchedAlbumId = sourceMatchResult.data?.[0]?.retroverse_entity_id;
  if (matchedAlbumId) {
    const matchResult = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, soundtrack_flag, album_type, era_id")
      .eq("retroverse_album_id", matchedAlbumId)
      .limit(1)
      .maybeSingle<AlbumRow>();
    if (matchResult.error) throw matchResult.error;
    if (matchResult.data) return matchResult.data;
  }

  const listResult = await supabase
    .from("retroverse_albums")
    .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, soundtrack_flag, album_type, era_id")
    .range(0, 5000);
  if (listResult.error) throw listResult.error;

  const normalized = normalizeEntitySlug(slug);
  const exact = ((listResult.data ?? []) as AlbumRow[]).find(
    (row) => normalizeEntitySlug(row.canonical_album_title) === normalized,
  );
  return exact ?? null;
}

async function loadAlbumEntity(slug: string) {
  const supabase = createClient();
  await logRetroverseAlbumDiagnosticsOnce(supabase);
  const album = await resolveAlbumBySlug(slug, supabase);
  if (!album) return null;

  const [albumArtistResult, eraResult, editionsResult] = await Promise.all([
    supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .eq("retroverse_artist_id", album.retroverse_artist_id)
      .limit(1)
      .maybeSingle<ArtistRow>(),
    album.era_id
      ? supabase
          .from("retroverse_eras")
          .select("retroverse_era_id, slug, display_name")
          .eq("retroverse_era_id", album.era_id)
          .limit(1)
          .maybeSingle<EraRow>()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_id, retroverse_album_edition_id, edition_name, is_primary, release_year")
      .eq("retroverse_album_id", album.retroverse_album_id)
      .order("is_primary", { ascending: false })
      .order("release_year", { ascending: true }),
  ]);

  if (albumArtistResult.error) throw albumArtistResult.error;
  if (eraResult.error) throw eraResult.error;
  if (editionsResult.error) throw editionsResult.error;

  const editions = (editionsResult.data ?? []) as EditionRow[];
  const primaryEdition = editions.find((row) => row.is_primary) ?? null;
  const editionIds = editions.map((row) => row.retroverse_album_edition_id);

  const [allAlbumTracksResult, artworkRows, siblingAlbumsResult, directTrackFallbackResult] = await Promise.all([
    editionIds.length > 0
      ? supabase
          .from("retroverse_album_tracks")
          .select(
            "retroverse_album_edition_id, retroverse_track_id, disc_number, track_number, side_code, side_position, soundtrack_exclusive, is_interlude",
          )
          .in("retroverse_album_edition_id", editionIds)
          .order("disc_number", { ascending: true })
          .order("track_number", { ascending: true })
      : Promise.resolve({ data: [], error: null }),
    loadAlbumArtworkRows(supabase, [album.retroverse_album_id]),
    supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, release_year, album_type, soundtrack_flag")
      .eq("retroverse_artist_id", album.retroverse_artist_id)
      .neq("retroverse_album_id", album.retroverse_album_id)
      .order("release_year", { ascending: true })
      .limit(8),
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id, release_year, notes")
      .eq("retroverse_album_id", album.retroverse_album_id),
  ]);

  if (allAlbumTracksResult.error) throw allAlbumTracksResult.error;
  if (siblingAlbumsResult.error) throw siblingAlbumsResult.error;
  if (directTrackFallbackResult.error) throw directTrackFallbackResult.error;

  const allAlbumTracks = (allAlbumTracksResult.data ?? []) as AlbumTrackRow[];
  const directTrackFallbackRows = (directTrackFallbackResult.data ?? []) as TrackRow[];
  const trackCountByEditionId = new Map<string, number>();
  for (const row of allAlbumTracks) {
    if (!row.retroverse_album_edition_id) continue;
    trackCountByEditionId.set(
      row.retroverse_album_edition_id,
      (trackCountByEditionId.get(row.retroverse_album_edition_id) ?? 0) + 1,
    );
  }

  const selectedEdition =
    (primaryEdition && (trackCountByEditionId.get(primaryEdition.retroverse_album_edition_id) ?? 0) > 0
      ? primaryEdition
      : editions
          .slice()
          .sort((a, b) => {
            const aCount = trackCountByEditionId.get(a.retroverse_album_edition_id) ?? 0;
            const bCount = trackCountByEditionId.get(b.retroverse_album_edition_id) ?? 0;
            if (aCount !== bCount) return bCount - aCount;
            if (a.is_primary !== b.is_primary) return a.is_primary ? -1 : 1;
            const aYear = a.release_year ?? 9999;
            const bYear = b.release_year ?? 9999;
            return aYear - bYear;
          })[0]) ?? null;

  const sequencedAlbumTracks =
    selectedEdition !== null
      ? allAlbumTracks.filter((row) => row.retroverse_album_edition_id === selectedEdition.retroverse_album_edition_id)
      : [];
  const dedupedEditionTracks = dedupeAlbumTrackRows(sequencedAlbumTracks);

  let albumTracks: AlbumTrackRow[];
  let sequenceSource: "edition_sequence" | "direct_album_membership" | "merged_internal";

  if (dedupedEditionTracks.length > 0) {
    const editionTrackIds = new Set(dedupedEditionTracks.map((r) => r.retroverse_track_id));
    const extraDirect = directTrackFallbackRows
      .filter((t) => !editionTrackIds.has(t.retroverse_track_id))
      .slice()
      .sort((a, b) => {
        const ay = a.release_year ?? 9999;
        const by = b.release_year ?? 9999;
        if (ay !== by) return ay - by;
        return a.canonical_title.localeCompare(b.canonical_title);
      });
    const maxTrackNo = dedupedEditionTracks.reduce((m, r) => Math.max(m, r.track_number), 0);
    let n = maxTrackNo;
    const appended: AlbumTrackRow[] = extraDirect.map((track) => {
      n += 1;
      return {
        retroverse_track_id: track.retroverse_track_id,
        disc_number: 1,
        track_number: n,
        side_code: null,
        side_position: n,
        soundtrack_exclusive: false,
        is_interlude: false,
      };
    });
    albumTracks = dedupeAlbumTrackRows([...dedupedEditionTracks, ...appended]);
    sequenceSource = extraDirect.length > 0 ? "merged_internal" : "edition_sequence";
  } else {
    albumTracks = dedupeAlbumTrackRows(
      directTrackFallbackRows
        .slice()
        .sort((a, b) => {
          const ay = a.release_year ?? 9999;
          const by = b.release_year ?? 9999;
          if (ay !== by) return ay - by;
          return a.canonical_title.localeCompare(b.canonical_title);
        })
        .map((track, index) => ({
          retroverse_track_id: track.retroverse_track_id,
          disc_number: 1,
          track_number: index + 1,
          side_code: null,
          side_position: index + 1,
          soundtrack_exclusive: false,
          is_interlude: false,
        })),
    );
    sequenceSource = "direct_album_membership";
  }
  const trackIds = [...new Set(albumTracks.map((row) => row.retroverse_track_id))];

  const [trackResult, chartResult, mediaResult] = await Promise.all([
    trackIds.length > 0
      ? supabase
          .from("retroverse_tracks")
          .select("retroverse_track_id, canonical_title, retroverse_artist_id, release_year, notes")
          .in("retroverse_track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
    trackIds.length > 0
      ? supabase
          .from("retroverse_chart_appearances")
          .select("retroverse_track_id, chart_position, weeks_on_chart")
          .in("retroverse_track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
    trackIds.length > 0
      ? supabase
          .from("retroverse_media_assets")
          .select("retroverse_track_id, thumbnail_path, is_primary")
          .in("retroverse_track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (trackResult.error) throw trackResult.error;
  if (chartResult.error) throw chartResult.error;

  const mediaFallbackResult =
    mediaResult.error && mediaResult.error.code === "42P01"
      ? await supabase
          .from("retroverse_media_assets")
          .select("retroverse_track_id, thumbnail_path")
          .in("retroverse_track_id", trackIds)
      : null;
  if (mediaResult.error && !mediaFallbackResult) throw mediaResult.error;
  if (mediaFallbackResult?.error) throw mediaFallbackResult.error;

  const tracks = (trackResult.data ?? []) as TrackRow[];
  const charts = (chartResult.data ?? []) as ChartRow[];
  const mediaRows = ((mediaFallbackResult?.data ?? mediaResult.data ?? []) as MediaAssetRow[]).map((row) => ({
    ...row,
    is_primary: row.is_primary ?? false,
  }));
  const artistIds = [...new Set(tracks.map((track) => track.retroverse_artist_id))];
  const allArtistIds = [...new Set([album.retroverse_artist_id, ...artistIds])];

  const artistsResult =
    allArtistIds.length > 0
      ? await supabase
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .in("retroverse_artist_id", allArtistIds)
      : { data: [], error: null };
  if (artistsResult.error) throw artistsResult.error;
  const artists = (artistsResult.data ?? []) as ArtistRow[];

  const trackById = new Map(tracks.map((track) => [track.retroverse_track_id, track]));
  const artistById = new Map(artists.map((artist) => [artist.retroverse_artist_id, artist]));

  const peakChartByTrackId = new Map<string, number>();
  const maxWeeksByTrackId = new Map<string, number>();
  for (const chartRow of charts) {
    const previous = peakChartByTrackId.get(chartRow.retroverse_track_id);
    if (previous === undefined || chartRow.chart_position < previous) {
      peakChartByTrackId.set(chartRow.retroverse_track_id, chartRow.chart_position);
    }
    if (chartRow.weeks_on_chart !== null) {
      const prevWeeks = maxWeeksByTrackId.get(chartRow.retroverse_track_id);
      if (prevWeeks === undefined || chartRow.weeks_on_chart > prevWeeks) {
        maxWeeksByTrackId.set(chartRow.retroverse_track_id, chartRow.weeks_on_chart);
      }
    }
  }

  const mediaThumbByTrackId = new Map<string, string>();
  for (const media of mediaRows) {
    if (!media.thumbnail_path) continue;
    const current = mediaThumbByTrackId.get(media.retroverse_track_id);
    if (!current || media.is_primary) {
      mediaThumbByTrackId.set(media.retroverse_track_id, media.thumbnail_path);
    }
  }

  const sequence: SequencedTrack[] = albumTracks.map((row) => {
    const track = trackById.get(row.retroverse_track_id);
    const artist = track ? artistById.get(track.retroverse_artist_id) : null;
    const peakChartPosition = peakChartByTrackId.get(row.retroverse_track_id) ?? null;

    return {
      retroverseTrackId: row.retroverse_track_id,
      title: track?.canonical_title ?? "Unknown track",
      artist: artist?.canonical_artist_name ?? "Unknown artist",
      trackNumber: row.track_number,
      discNumber: row.disc_number,
      sideCode: row.side_code ?? "?",
      sidePosition: row.side_position,
      peakChartPosition,
      weeksOnChart: maxWeeksByTrackId.get(row.retroverse_track_id) ?? null,
      charted: peakChartPosition !== null,
      releaseYear: track?.release_year ?? null,
      notes: track?.notes ?? null,
      soundtrackExclusive: row.soundtrack_exclusive,
      isInterlude: row.is_interlude,
      mediaThumbnailPath: mediaThumbByTrackId.get(row.retroverse_track_id) ?? null,
    };
  });

  const canonicalOrderedTracklist = sequence;

  const discsMap = new Map<number, Map<string, SequencedTrack[]>>();
  for (const item of canonicalOrderedTracklist) {
    const discSides = discsMap.get(item.discNumber) ?? new Map<string, SequencedTrack[]>();
    const sideTracks = discSides.get(item.sideCode) ?? [];
    sideTracks.push(item);
    discSides.set(item.sideCode, sideTracks);
    discsMap.set(item.discNumber, discSides);
  }

  const discs: DiscGroup[] = [...discsMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([discNumber, sides]) => ({
      discNumber,
      sides: [...sides.entries()]
        .sort(([a], [b]) => sideSortValue(a) - sideSortValue(b))
        .map(([sideCode, tracksForSide]) => ({
          sideCode,
          tracks: [...tracksForSide].sort((a, b) => a.trackNumber - b.trackNumber),
        })),
    }));

  const primaryArtwork = selectCanonicalArtwork(
    artworkRows,
    album.retroverse_album_id,
    selectedEdition?.retroverse_album_edition_id ?? null,
  );

  const pathways = await generateAlbumPathways(supabase, album.retroverse_album_id);
  const siblingAlbums = (siblingAlbumsResult.data ?? []) as Array<{
    retroverse_album_id: string;
    canonical_album_title: string;
    release_year: number | null;
    album_type: string | null;
    soundtrack_flag: boolean;
  }>;
  const siblingAlbumIds = siblingAlbums.map((row) => row.retroverse_album_id);
  const [siblingEditionsResult, siblingArtworkRows] = await Promise.all([
    siblingAlbumIds.length > 0
      ? supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id")
          .in("retroverse_album_id", siblingAlbumIds)
          .eq("is_primary", true)
      : Promise.resolve({ data: [], error: null }),
    loadAlbumArtworkRows(supabase, siblingAlbumIds),
  ]);
  if (siblingEditionsResult.error) throw siblingEditionsResult.error;
  const siblingPrimaryEditionByAlbumId = new Map(
    ((siblingEditionsResult.data ?? []) as SiblingEditionRow[]).map((row) => [row.retroverse_album_id, row.retroverse_album_edition_id]),
  );
  const siblingAlbumsWithArtwork = siblingAlbums.map((sibling) => ({
    ...sibling,
    coverPath:
      selectCanonicalArtwork(
        siblingArtworkRows,
        sibling.retroverse_album_id,
        siblingPrimaryEditionByAlbumId.get(sibling.retroverse_album_id) ?? null,
      )?.canonical_cover_path ?? null,
    artworkStatus:
      selectCanonicalArtwork(
        siblingArtworkRows,
        sibling.retroverse_album_id,
        siblingPrimaryEditionByAlbumId.get(sibling.retroverse_album_id) ?? null,
      )?.artwork_status ?? null,
  }));

  const hasChartingSingles = canonicalOrderedTracklist.some((row) => row.charted);
  const hasDeepCuts = canonicalOrderedTracklist.some((row) => !row.charted);
  const bandDrivenAlbum = new Set(canonicalOrderedTracklist.map((row) => row.artist)).size <= 1;
  const reusedTracks = canonicalOrderedTracklist.filter(
    (track) => track.releaseYear !== null && album.release_year !== null && track.releaseYear < album.release_year,
  ).length;
  const chartedTracks = canonicalOrderedTracklist.filter((track) => track.charted).length;
  const albumCuts = Math.max(0, canonicalOrderedTracklist.length - chartedTracks);
  const hasSoundtrackInstrumentals = canonicalOrderedTracklist.some(
    (row) => row.isInterlude || row.soundtrackExclusive || (row.notes !== null && /instrumental/i.test(row.notes)),
  );

  let contextLines: string[];
  if (album.soundtrack_flag || album.album_type === "soundtrack") {
    contextLines = buildSoundtrackAlbumContext({
      multiArtistAlbum: new Set(canonicalOrderedTracklist.map((row) => row.artist)).size > 1,
      hasChartingBeeGeesSingles: canonicalOrderedTracklist.some(
        (row) => row.artist === "Bee Gees" && row.peakChartPosition !== null,
      ),
      hasSoundtrackInstrumentals,
    });
  } else if (album.album_type === "compilation") {
    contextLines = buildCompilationAlbumContext({ reusedTracks, chartedTracks, albumCuts });
  } else {
    contextLines = buildStudioAlbumContext({ hasChartingSingles, hasDeepCuts, bandDrivenAlbum });
  }

  return {
    album,
    albumArtist: artistById.get(album.retroverse_artist_id) ?? albumArtistResult.data,
    era: eraResult.data as EraRow | null,
    edition: selectedEdition,
    sequenceSource,
    primaryArtwork,
    discs,
    contextLines,
    pathways,
    siblingAlbums: siblingAlbumsWithArtwork,
  };
}

function albumTypeDisplay(albumType: string | null, soundtrackFlag: boolean): string {
  if (soundtrackFlag || albumType === "soundtrack") return "Soundtrack";
  if (albumType === "compilation") return "Compilation";
  if (albumType === "studio") return "Studio album";
  if (albumType === "live") return "Live album";
  if (albumType === "ep") return "EP";
  return "Album";
}

export async function generateMetadata({ params }: AlbumPageProps): Promise<Metadata> {
  const { slug } = await params;
  return {
    title: `${slug.replaceAll("-", " ")} - Retroverse`,
    description: "Canonical album experience powered by the Retroverse graph.",
  };
}

export default async function AlbumEntityPage({ params }: AlbumPageProps) {
  const { slug } = await params;
  const data = await loadAlbumEntity(slug);
  if (!data) notFound();

  const { album, albumArtist, era, primaryArtwork, discs } = data;
  const artistName = albumArtist?.canonical_artist_name ?? "Unknown artist";
  const heroSrc = canonicalCoverPathToUrl(primaryArtwork?.canonical_cover_path ?? null);
  const trustState =
    !primaryArtwork?.canonical_cover_path ||
    !primaryArtwork?.artwork_status ||
    ["missing", "rejected", "low_confidence", "unresolved"].includes(primaryArtwork.artwork_status)
      ? "unresolved"
      : ["pending", "needs_review", "provisional", "review_needed", "candidate"].includes(primaryArtwork.artwork_status)
        ? "provisional"
        : "verified";
  const allTracks = discs
    .flatMap((disc) => disc.sides.flatMap((side) => side.tracks))
    .sort((a, b) => (a.discNumber !== b.discNumber ? a.discNumber - b.discNumber : a.trackNumber - b.trackNumber));
  const peakChartPosition = allTracks
    .map((track) => track.peakChartPosition)
    .filter((value): value is number => value !== null)
    .reduce<number | null>((best, value) => (best === null ? value : Math.min(best, value)), null);
  const maxWeeksOnChart = allTracks
    .map((track) => track.weeksOnChart)
    .filter((value): value is number => value !== null)
    .reduce<number | null>((best, value) => (best === null ? value : Math.max(best, value)), null);
  const trackCount = allTracks.length;
  const curatorContext = {
    albumId: album.retroverse_album_id,
    albumSlug: slug,
    albumTitle: album.canonical_album_title,
    artist: artistName,
    year: album.release_year,
    trustState,
    canonicalCoverPath: primaryArtwork?.canonical_cover_path ?? null,
    trackCount,
  };

  return (
    <div className="min-h-screen bg-[#0b0807] text-[#f2e6d8]">
      <BodyClassName className="album-immersive" />
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(circle_at_50%_0%,rgba(194,147,78,0.16),transparent_58%),radial-gradient(circle_at_85%_85%,rgba(164,112,61,0.11),transparent_45%)]" />
      <article className="relative mx-auto w-full max-w-[33rem] px-4 pb-16 pt-4 sm:px-6 sm:pt-6">
        <header className="mb-6 flex items-center justify-between">
          <HistoryBackButton
            fallbackHref="/albums"
            label="Back"
            className="inline-flex items-center rounded-full border border-[#8b6a44]/35 bg-[#140f0b]/72 px-4 py-2 text-sm text-[#ead5bb]"
          />
          <p className="text-[0.68rem] uppercase tracking-[0.18em] text-[#b49572]/85">Retroverse</p>
        </header>

        <section className="space-y-6">
          <div className="-mx-4 sm:-mx-6">
            {heroSrc ? (
              <div className="relative h-[68vh] min-h-[26rem] max-h-[42rem] overflow-hidden">
                <div className="pointer-events-none absolute inset-0 z-10 bg-[radial-gradient(circle_at_48%_4%,rgba(255,224,175,0.14),transparent_48%),linear-gradient(180deg,rgba(11,8,7,0.08)_0%,rgba(11,8,7,0.02)_46%,rgba(11,8,7,0.86)_100%)]" />
                <div className="pointer-events-none absolute inset-0 z-10 shadow-[inset_0_-70px_130px_-70px_rgba(0,0,0,0.92),0_36px_80px_-42px_rgba(0,0,0,0.95),0_0_90px_-24px_rgba(196,151,86,0.55)]" />
                <AlbumPageHeroCurator context={curatorContext} className="absolute inset-0 z-0">
                  <Image
                    src={heroSrc}
                    alt={`${album.canonical_album_title} cover`}
                    fill
                    unoptimized
                    priority
                    sizes="(max-width: 640px) 100vw, 33rem"
                    className="object-cover object-center"
                  />
                </AlbumPageHeroCurator>
              </div>
            ) : (
              <AlbumPageHeroCurator context={curatorContext} className="block">
                <div className="relative h-[68vh] min-h-[26rem] max-h-[42rem] overflow-hidden bg-[radial-gradient(circle_at_50%_12%,rgba(190,142,79,0.28),rgba(48,32,21,0.66)_40%,rgba(16,12,10,0.96)_88%),linear-gradient(145deg,#241a14,#0f0b09)]">
                  <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_35%_22%,rgba(239,197,142,0.12),transparent_40%),radial-gradient(circle_at_72%_68%,rgba(146,98,56,0.24),transparent_48%)] blur-[2px]" />
                  <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(180deg,rgba(11,8,7,0.02)_0%,rgba(11,8,7,0.78)_100%)]" />
                  <p className="absolute bottom-7 left-5 text-[0.78rem] uppercase tracking-[0.16em] text-[#c3a27a]/86">
                    Artwork being restored
                  </p>
                </div>
              </AlbumPageHeroCurator>
            )}
          </div>

          <header className="space-y-3 px-0.5">
            {era ? <p className="text-[0.7rem] uppercase tracking-[0.16em] text-[#b99870]/88">{era.display_name}</p> : null}
            <h1 className="font-serif text-[2.8rem] leading-[0.96] tracking-tight text-[#f8ede0] sm:text-[3.2rem]">
              {album.canonical_album_title}
            </h1>
            <p className="text-[1.3rem] text-[#dfc7ab]">
              <Link href={artistRoute(artistName)} className="underline-offset-2 hover:underline">
                {artistName}
              </Link>
              {album.release_year !== null ? <span className="text-[#b4946f]"> · {album.release_year}</span> : null}
            </p>

            <p className="pt-1 text-[0.88rem] tracking-[0.02em] text-[#b79975]">
              {albumTypeDisplay(album.album_type, album.soundtrack_flag)}
              {peakChartPosition !== null ? <span> · Peak #{peakChartPosition}</span> : null}
              {maxWeeksOnChart !== null ? <span> · {maxWeeksOnChart} weeks</span> : null}
              {trustState !== "verified" ? <span> · {trustState}</span> : null}
            </p>
            {trustState === "unresolved" ? (
              <p className="pt-2 text-[0.82rem] leading-snug text-[#9c7f5c]/92">
                Tip: long-press the cover here (or on <Link href="/portal" className="underline-offset-2 hover:underline">Portal</Link>) to open the curator and pick artwork.
              </p>
            ) : null}
          </header>
        </section>

        <section className="mt-10">
          <h2 className="mb-5 font-serif text-[1.45rem] tracking-tight text-[#f3e8db]">Tracks</h2>
          {trackCount > 0 ? (
            <ol className="list-none space-y-0.5 text-[0.98rem] leading-snug sm:text-[1.02rem]">
              {allTracks.map((track, idx) => {
                const displayNum = String(idx + 1).padStart(2, "0");
                return (
                  <li key={track.retroverseTrackId ?? `${track.discNumber}-${track.trackNumber}-${track.title}`}>
                    <div className="flex gap-3 py-2">
                      <span className="w-8 shrink-0 tabular-nums text-[#a38466]">{displayNum}</span>
                      <span className="min-w-0 flex-1 text-[#f4ebdf]">{track.title}</span>
                    </div>
                    {track.artist !== artistName ? (
                      <p className="pl-11 text-[0.82rem] text-[#a89075]">with {track.artist}</p>
                    ) : null}
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="rounded-[1rem] border border-[#5c4128]/55 bg-[#120d0a]/84 px-4 py-4 text-[0.95rem] text-[#b79c80]">
              Tracklist unavailable.
            </p>
          )}
        </section>
      </article>
    </div>
  );
}
