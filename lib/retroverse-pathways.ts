import type { SupabaseClient } from "@supabase/supabase-js";

import type { RetroverseProvenanceLevel } from "@/lib/retroverse-editorial";
import { hrefForAlbum, hrefForArtist } from "@/lib/retroverse-routes";
import { loadTrackLineage } from "@/lib/retroverse-lineage";

type PathwayEntityKind = "track" | "album" | "artist" | "era";

export type PathwaySignal = {
  key:
    | "shared_album_membership"
    | "soundtrack_reuse"
    | "compilation_reuse"
    | "chart_overlap"
    | "era_overlap"
    | "chronology"
    | "artist_recurrence"
    | "sequencing_adjacency";
  value: number;
  weight: number;
  points: number;
  detail: string;
};

export type RetroversePathway = {
  key: string;
  label: string;
  summary: string;
  href: string;
  provenanceLevel: RetroverseProvenanceLevel;
  score: number;
  qualityScoreAdjustment: number;
  qualityNotes: string[];
  signals: PathwaySignal[];
};

type TrackRow = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_artist_id: string;
  retroverse_album_id?: string | null;
  era_id: string | null;
  release_year: number | null;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  era_id: string | null;
  release_year: number | null;
  album_type: string | null;
  soundtrack_flag: boolean;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type EraRow = {
  retroverse_era_id: string;
  slug: string;
  display_name: string;
  start_year: number;
  end_year: number;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
  disc_number: number;
  track_number: number;
  side_code: string | null;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type ChartRow = {
  retroverse_track_id: string;
  chart_position: number;
};

function signal(key: PathwaySignal["key"], value: number, weight: number, detail: string): PathwaySignal {
  return {
    key,
    value,
    weight,
    points: value * weight,
    detail,
  };
}

function buildPathway(args: Omit<RetroversePathway, "score">): RetroversePathway {
  const score = args.signals.reduce((sum, row) => sum + row.points, 0);
  return { ...args, score };
}

function normalizeLabel(label: string): string {
  return label.trim().toLowerCase();
}

function scoreForSignal(pathway: RetroversePathway, key: PathwaySignal["key"]): number {
  return pathway.signals.find((row) => row.key === key)?.points ?? 0;
}

function applyQualityHeuristics(pathway: RetroversePathway, labelFrequency: Map<string, number>): RetroversePathway {
  const nonZeroSignals = pathway.signals.filter((row) => row.points > 0);
  const totalPoints = nonZeroSignals.reduce((sum, row) => sum + row.points, 0);
  const topSignalPoints = nonZeroSignals.reduce((max, row) => (row.points > max ? row.points : max), 0);
  const topSignalShare = totalPoints > 0 ? topSignalPoints / totalPoints : 1;

  let adjustment = 0;
  const notes: string[] = [];

  const labelCount = labelFrequency.get(normalizeLabel(pathway.label)) ?? 1;
  if (labelCount > 1) {
    const penalty = 3 * (labelCount - 1);
    adjustment -= penalty;
    notes.push(`label-repeat:-${penalty}`);
  }

  if (nonZeroSignals.length <= 1) {
    adjustment -= 8;
    notes.push("single-signal:-8");
  } else if (nonZeroSignals.length === 2) {
    adjustment -= 3;
    notes.push("low-signal-diversity:-3");
  }

  if (topSignalShare >= 0.8) {
    adjustment -= 4;
    notes.push("dominant-signal-penalty:-4");
  }

  const chronologyPoints = scoreForSignal(pathway, "chronology");
  if (chronologyPoints >= 3) {
    adjustment += 3;
    notes.push("chronology-depth:+3");
  }

  const reuseDepth = scoreForSignal(pathway, "soundtrack_reuse") + scoreForSignal(pathway, "compilation_reuse");
  if (reuseDepth >= 6) {
    adjustment += 4;
    notes.push("reuse-depth:+4");
  }

  const multiHopContinuity =
    scoreForSignal(pathway, "shared_album_membership") > 0 &&
    scoreForSignal(pathway, "era_overlap") > 0 &&
    chronologyPoints > 0;
  if (multiHopContinuity) {
    adjustment += 4;
    notes.push("multi-hop:+4");
  }

  const recurringChartMovement =
    scoreForSignal(pathway, "chart_overlap") > 0 &&
    scoreForSignal(pathway, "artist_recurrence") > 0 &&
    chronologyPoints > 0;
  if (recurringChartMovement) {
    adjustment += 3;
    notes.push("recurring-chart:+3");
  }

  return {
    ...pathway,
    qualityScoreAdjustment: adjustment,
    qualityNotes: notes,
    score: pathway.score + adjustment,
  };
}

function rankPathways(pathways: RetroversePathway[]): RetroversePathway[] {
  const frequency = new Map<string, number>();
  for (const row of pathways) {
    const key = normalizeLabel(row.label);
    frequency.set(key, (frequency.get(key) ?? 0) + 1);
  }

  return pathways
    .map((row) => applyQualityHeuristics(row, frequency))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 6);
}

function maybeDebugPathways(kind: PathwayEntityKind, entityId: string, pathways: RetroversePathway[]) {
  if (process.env.NODE_ENV !== "production" || process.env.RETROVERSE_DEBUG_PATHWAYS === "1") {
    const top = pathways.slice(0, 3).map((row) => ({
      label: row.label,
      provenanceLevel: row.provenanceLevel,
      score: row.score,
      qualityScoreAdjustment: row.qualityScoreAdjustment,
      qualityNotes: row.qualityNotes,
      topSignals: [...row.signals].sort((a, b) => b.points - a.points).slice(0, 3),
    }));
    console.debug(`[retroverse-pathways] ${kind}:${entityId}`, top);
  }
}

function eraHref(era: EraRow): string {
  if (era.start_year === 1974 && era.end_year === 1977) return "/eras/1974-1977";
  return `/eras/${era.slug}`;
}

function toUniqueCount(values: Array<string | null | undefined>): number {
  return new Set(values.filter((row): row is string => Boolean(row))).size;
}

export async function generateTrackPathways(supabase: SupabaseClient, retroverseTrackId: string): Promise<RetroversePathway[]> {
  const [trackResult, chartsResult, lineage] = await Promise.all([
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id, era_id, release_year")
      .eq("retroverse_track_id", retroverseTrackId)
      .limit(1)
      .maybeSingle<TrackRow>(),
    supabase
      .from("retroverse_chart_appearances")
      .select("retroverse_track_id, chart_position")
      .eq("retroverse_track_id", retroverseTrackId),
    loadTrackLineage(supabase, retroverseTrackId),
  ]);

  if (trackResult.error) throw trackResult.error;
  if (chartsResult.error) throw chartsResult.error;
  if (!trackResult.data || !lineage) return [];

  const track = trackResult.data;
  const charts = (chartsResult.data ?? []) as ChartRow[];
  const appearances = lineage.appearances;
  const soundtrackReuseCount = appearances.filter((row) => row.soundtrackFlag).length;
  const compilationReuseCount = appearances.filter((row) => row.albumType === "compilation").length;
  const firstYear = appearances[0]?.editionReleaseYear ?? appearances[0]?.albumReleaseYear ?? track.release_year;
  const latestYear =
    appearances[appearances.length - 1]?.editionReleaseYear ??
    appearances[appearances.length - 1]?.albumReleaseYear ??
    track.release_year;
  const chronologySpan =
    firstYear !== null && latestYear !== null && latestYear >= firstYear ? latestYear - firstYear : 0;

  const appearanceAlbumIds = [...new Set(appearances.map((row) => row.retroverseAlbumId))];
  const appearanceAlbumsResult =
    appearanceAlbumIds.length > 0
      ? await supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, era_id")
          .in("retroverse_album_id", appearanceAlbumIds)
      : { data: [], error: null };
  if (appearanceAlbumsResult.error) throw appearanceAlbumsResult.error;
  const eraOverlap = toUniqueCount((appearanceAlbumsResult.data ?? []).map((row) => row.era_id));

  const editionIds = [...new Set(appearances.map((row) => row.retroverseAlbumEditionId))];
  const adjacencyRowsResult =
    editionIds.length > 0
      ? await supabase
          .from("retroverse_album_tracks")
          .select("retroverse_album_edition_id, retroverse_track_id, disc_number, track_number, side_code")
          .in("retroverse_album_edition_id", editionIds)
      : { data: [], error: null };
  if (adjacencyRowsResult.error) throw adjacencyRowsResult.error;
  const adjacencyRows = (adjacencyRowsResult.data ?? []) as AlbumTrackRow[];

  const targetPositions = new Map<string, Array<{ disc: number; track: number; side: string | null }>>();
  for (const row of appearances) {
    const items = targetPositions.get(row.retroverseAlbumEditionId) ?? [];
    items.push({ disc: row.discNumber, track: row.trackNumber, side: row.sideCode });
    targetPositions.set(row.retroverseAlbumEditionId, items);
  }
  const adjacentTrackIds = new Set<string>();
  for (const row of adjacencyRows) {
    const targets = targetPositions.get(row.retroverse_album_edition_id) ?? [];
    if (row.retroverse_track_id === retroverseTrackId) continue;
    for (const target of targets) {
      const sideMatch = target.side === row.side_code || target.side === null || row.side_code === null;
      if (target.disc === row.disc_number && sideMatch && Math.abs(target.track - row.track_number) === 1) {
        adjacentTrackIds.add(row.retroverse_track_id);
      }
    }
  }

  const soundtrackAppearance = appearances.find((row) => row.soundtrackFlag) ?? null;
  const compilationAppearance = appearances.find((row) => row.albumType === "compilation") ?? null;
  const firstAppearance = appearances[0] ?? null;

  const pathways: RetroversePathway[] = [];

  if (soundtrackAppearance) {
    pathways.push(
      buildPathway({
        key: "soundtrack-crossover",
        label: "Soundtrack crossover corridor",
        summary: `${track.canonical_title} moves through soundtrack sequencing while retaining chart and album identity.`,
        href: hrefForAlbum(soundtrackAppearance.retroverseAlbumId, soundtrackAppearance.canonicalAlbumTitle),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("soundtrack_reuse", soundtrackReuseCount, 4, `${soundtrackReuseCount} soundtrack appearances`),
          signal("chart_overlap", charts.length, 2, `${charts.length} chart rows`),
          signal("chronology", chronologySpan, 1, `${chronologySpan} year chronology span`),
          signal("shared_album_membership", appearances.length, 1, `${appearances.length} total album memberships`),
        ],
      }),
    );
  }

  if (compilationAppearance) {
    pathways.push(
      buildPathway({
        key: "compilation-canonization",
        label: "Compilation-era canonization",
        summary: "The track is re-anchored in later compilation sequencing as catalog memory hardens.",
        href: hrefForAlbum(compilationAppearance.retroverseAlbumId, compilationAppearance.canonicalAlbumTitle),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("compilation_reuse", compilationReuseCount, 4, `${compilationReuseCount} compilation memberships`),
          signal("chronology", chronologySpan, 2, `${chronologySpan} year span between first and later contexts`),
          signal("shared_album_membership", appearances.length, 1, `${appearances.length} context memberships`),
          signal("era_overlap", eraOverlap, 1, `${eraOverlap} connected eras`),
        ],
      }),
    );
  }

  if (firstAppearance && adjacentTrackIds.size > 0) {
    const adjacentTrackId = [...adjacentTrackIds].sort()[0];
    pathways.push(
      buildPathway({
        key: "chart-to-album-transition",
        label: "Chart-to-album transition",
        summary: "Chart-facing status stays tied to adjacent sequence neighbors inside the album context.",
        href: `/tracks/${adjacentTrackId}`,
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("sequencing_adjacency", adjacentTrackIds.size, 3, `${adjacentTrackIds.size} adjacent sequenced neighbors`),
          signal("chart_overlap", charts.length, 2, `${charts.length} chart rows`),
          signal("shared_album_membership", appearances.length, 1, `${appearances.length} album memberships`),
          signal("chronology", chronologySpan, 1, `${chronologySpan} year span`),
        ],
      }),
    );
  }

  if (eraOverlap > 1) {
    pathways.push(
      buildPathway({
        key: "era-carry-forward",
        label: "Era carry-forward chain",
        summary: "The track persists beyond its first period and remains active in later-era album contexts.",
        href: firstAppearance
          ? hrefForAlbum(firstAppearance.retroverseAlbumId, firstAppearance.canonicalAlbumTitle)
          : `/tracks/${retroverseTrackId}`,
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("era_overlap", eraOverlap, 3, `${eraOverlap} eras touched by memberships`),
          signal("chronology", chronologySpan, 2, `${chronologySpan} years of carry-forward`),
          signal("shared_album_membership", appearances.length, 1, `${appearances.length} album placements`),
        ],
      }),
    );
  }

  const ranked = rankPathways(pathways);
  maybeDebugPathways("track", retroverseTrackId, ranked);
  return ranked;
}

export async function generateAlbumPathways(supabase: SupabaseClient, retroverseAlbumId: string): Promise<RetroversePathway[]> {
  const [albumResult, editionResult] = await Promise.all([
    supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, era_id, release_year, album_type, soundtrack_flag")
      .eq("retroverse_album_id", retroverseAlbumId)
      .limit(1)
      .maybeSingle<AlbumRow>(),
    supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .eq("retroverse_album_id", retroverseAlbumId)
      .eq("is_primary", true)
      .limit(1)
      .maybeSingle<EditionRow>(),
  ]);
  if (albumResult.error) throw albumResult.error;
  if (editionResult.error) throw editionResult.error;
  if (!albumResult.data || !editionResult.data) return [];

  const album = albumResult.data;
  const edition = editionResult.data;

  const albumTracksResult = await supabase
    .from("retroverse_album_tracks")
    .select("retroverse_album_edition_id, retroverse_track_id, disc_number, track_number, side_code")
    .eq("retroverse_album_edition_id", edition.retroverse_album_edition_id);
  if (albumTracksResult.error) throw albumTracksResult.error;
  const albumTracks = (albumTracksResult.data ?? []) as AlbumTrackRow[];
  const trackIds = [...new Set(albumTracks.map((row) => row.retroverse_track_id))];
  if (trackIds.length === 0) return [];

  const [trackRowsResult, chartsResult, crossMembershipsResult] = await Promise.all([
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, retroverse_artist_id")
      .in("retroverse_track_id", trackIds),
    supabase
      .from("retroverse_chart_appearances")
      .select("retroverse_track_id, chart_position")
      .in("retroverse_track_id", trackIds),
    supabase
      .from("retroverse_album_tracks")
      .select("retroverse_album_edition_id, retroverse_track_id")
      .in("retroverse_track_id", trackIds),
  ]);
  if (trackRowsResult.error) throw trackRowsResult.error;
  if (chartsResult.error) throw chartsResult.error;
  if (crossMembershipsResult.error) throw crossMembershipsResult.error;

  const trackRows = trackRowsResult.data ?? [];
  const charts = (chartsResult.data ?? []) as ChartRow[];
  const crossMemberships = crossMembershipsResult.data ?? [];
  const chartOverlap = new Set(charts.map((row) => row.retroverse_track_id)).size;

  const connectedEditionIds = [...new Set(crossMemberships.map((row) => row.retroverse_album_edition_id))];
  const connectedEditionsResult =
    connectedEditionIds.length > 0
      ? await supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id, release_year")
          .in("retroverse_album_edition_id", connectedEditionIds)
      : { data: [], error: null };
  if (connectedEditionsResult.error) throw connectedEditionsResult.error;
  const connectedEditions = connectedEditionsResult.data ?? [];

  const connectedAlbumIds = [...new Set(connectedEditions.map((row) => row.retroverse_album_id))];
  const connectedAlbumsResult =
    connectedAlbumIds.length > 0
      ? await supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, era_id, release_year, album_type, soundtrack_flag")
          .in("retroverse_album_id", connectedAlbumIds)
      : { data: [], error: null };
  if (connectedAlbumsResult.error) throw connectedAlbumsResult.error;
  const connectedAlbums = (connectedAlbumsResult.data ?? []) as AlbumRow[];

  const compilationReuseCount = connectedAlbums.filter(
    (row) => row.retroverse_album_id !== album.retroverse_album_id && row.album_type === "compilation",
  ).length;
  const soundtrackReuseCount = connectedAlbums.filter(
    (row) => row.retroverse_album_id !== album.retroverse_album_id && row.soundtrack_flag,
  ).length;
  const eraOverlap = toUniqueCount(connectedAlbums.map((row) => row.era_id));

  const targetYear = album.release_year;
  let chronologyForwardCount = 0;
  for (const row of connectedAlbums) {
    if (row.retroverse_album_id === album.retroverse_album_id) continue;
    if (targetYear !== null && row.release_year !== null && row.release_year > targetYear) chronologyForwardCount += 1;
  }

  const artistRecurrence = new Set(trackRows.map((row) => row.retroverse_artist_id)).size;
  let sequencingAdjacency = 0;
  for (const a of albumTracks) {
    for (const b of albumTracks) {
      if (a.retroverse_track_id === b.retroverse_track_id) continue;
      if (a.disc_number === b.disc_number && a.side_code === b.side_code && Math.abs(a.track_number - b.track_number) === 1) {
        sequencingAdjacency += 1;
      }
    }
  }

  const firstCompilation = connectedAlbums
    .filter((row) => row.album_type === "compilation" && row.retroverse_album_id !== album.retroverse_album_id)
    .sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))[0];
  const firstSoundtrack = connectedAlbums
    .filter((row) => row.soundtrack_flag && row.retroverse_album_id !== album.retroverse_album_id)
    .sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))[0];
  const eraCarrierAlbum = connectedAlbums.find((row) => row.era_id !== album.era_id) ?? null;

  const pathways: RetroversePathway[] = [
    buildPathway({
      key: "chart-album-transition",
      label: "Chart-to-album transition",
      summary: "Charting tracks remain embedded inside sequence order rather than detached as single-only artifacts.",
      href: `/tracks/${trackIds[0]}`,
      provenanceLevel: "inferred",
      qualityScoreAdjustment: 0,
      qualityNotes: [],
      signals: [
        signal("chart_overlap", chartOverlap, 3, `${chartOverlap} chart-linked tracks in sequence`),
        signal("sequencing_adjacency", sequencingAdjacency, 1, `${sequencingAdjacency} adjacency links`),
        signal("shared_album_membership", connectedAlbumIds.length, 1, `${connectedAlbumIds.length} connected album contexts`),
      ],
    }),
  ];

  if (firstCompilation) {
    pathways.push(
      buildPathway({
        key: "compilation-canonization",
        label: "Compilation-era canonization",
        summary: "Tracks from this album reappear in compilation packaging and consolidate catalog memory.",
        href: hrefForAlbum(firstCompilation.retroverse_album_id, firstCompilation.canonical_album_title),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("compilation_reuse", compilationReuseCount, 4, `${compilationReuseCount} compilation-linked reuse albums`),
          signal("chronology", chronologyForwardCount, 2, `${chronologyForwardCount} later-year reuse contexts`),
          signal("shared_album_membership", connectedAlbumIds.length, 1, `${connectedAlbumIds.length} total reuse-linked albums`),
        ],
      }),
    );
  }

  if (firstSoundtrack || album.soundtrack_flag) {
    pathways.push(
      buildPathway({
        key: "soundtrack-crossover",
        label: "Soundtrack crossover pathway",
        summary: "Album tracks intersect with soundtrack circulation, linking sequence context to soundtrack exposure.",
        href: firstSoundtrack
          ? hrefForAlbum(firstSoundtrack.retroverse_album_id, firstSoundtrack.canonical_album_title)
          : hrefForAlbum(album.retroverse_album_id, album.canonical_album_title),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("soundtrack_reuse", soundtrackReuseCount + (album.soundtrack_flag ? 1 : 0), 4, `${soundtrackReuseCount} soundtrack reuse albums`),
          signal("chart_overlap", chartOverlap, 2, `${chartOverlap} chart-linked tracks`),
          signal("artist_recurrence", artistRecurrence, 1, `${artistRecurrence} artists in sequenced tracks`),
        ],
      }),
    );
  }

  if (eraCarrierAlbum) {
    pathways.push(
      buildPathway({
        key: "era-bridge",
        label: "Era bridge traversal",
        summary: "Track reuse moves out of the album's origin era and into adjacent chronology windows.",
        href: hrefForAlbum(eraCarrierAlbum.retroverse_album_id, eraCarrierAlbum.canonical_album_title),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("era_overlap", eraOverlap, 3, `${eraOverlap} eras across connected albums`),
          signal("chronology", chronologyForwardCount, 2, `${chronologyForwardCount} later chronology links`),
          signal("shared_album_membership", connectedAlbumIds.length, 1, `${connectedAlbumIds.length} connected albums`),
        ],
      }),
    );
  }

  const ranked = rankPathways(pathways);
  maybeDebugPathways("album", retroverseAlbumId, ranked);
  return ranked;
}

export async function generateArtistPathways(supabase: SupabaseClient, retroverseArtistId: string): Promise<RetroversePathway[]> {
  const [artistResult, tracksResult, albumRolesResult] = await Promise.all([
    supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .eq("retroverse_artist_id", retroverseArtistId)
      .limit(1)
      .maybeSingle<ArtistRow>(),
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id, era_id, retroverse_album_id, release_year")
      .eq("retroverse_artist_id", retroverseArtistId),
    supabase
      .from("retroverse_album_artist_roles")
      .select("retroverse_album_id, retroverse_artist_id")
      .eq("retroverse_artist_id", retroverseArtistId),
  ]);
  if (artistResult.error) throw artistResult.error;
  if (tracksResult.error) throw tracksResult.error;
  if (albumRolesResult.error) throw albumRolesResult.error;
  if (!artistResult.data) return [];

  const artist = artistResult.data;
  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const trackIds = tracks.map((row) => row.retroverse_track_id);
  const roleAlbumIds = (albumRolesResult.data ?? []).map((row) => row.retroverse_album_id);
  const albumIds = [...new Set([...tracks.map((row) => row.retroverse_album_id).filter(Boolean), ...roleAlbumIds])] as string[];
  if (albumIds.length === 0) return [];

  const [albumsResult, chartsResult, editionsResult] = await Promise.all([
    supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, era_id, release_year, album_type, soundtrack_flag")
      .in("retroverse_album_id", albumIds),
    trackIds.length > 0
      ? supabase
          .from("retroverse_chart_appearances")
          .select("retroverse_track_id, chart_position")
          .in("retroverse_track_id", trackIds)
      : Promise.resolve({ data: [], error: null }),
    supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .in("retroverse_album_id", albumIds)
      .eq("is_primary", true),
  ]);
  if (albumsResult.error) throw albumsResult.error;
  if (chartsResult.error) throw chartsResult.error;
  if (editionsResult.error) throw editionsResult.error;

  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const charts = (chartsResult.data ?? []) as ChartRow[];
  const editions = (editionsResult.data ?? []) as EditionRow[];

  const editionIds = editions.map((row) => row.retroverse_album_edition_id);
  const sequencingResult =
    editionIds.length > 0 && trackIds.length > 0
      ? await supabase
          .from("retroverse_album_tracks")
          .select("retroverse_album_edition_id, retroverse_track_id, disc_number, track_number, side_code")
          .in("retroverse_album_edition_id", editionIds)
          .in("retroverse_track_id", trackIds)
      : { data: [], error: null };
  if (sequencingResult.error) throw sequencingResult.error;
  const sequencingRows = (sequencingResult.data ?? []) as AlbumTrackRow[];

  const soundtrackAlbums = albums.filter((row) => row.soundtrack_flag);
  const compilationAlbums = albums.filter((row) => row.album_type === "compilation");
  const eraOverlap = toUniqueCount([...tracks.map((row) => row.era_id), ...albums.map((row) => row.era_id)]);
  const chartOverlap = new Set(charts.map((row) => row.retroverse_track_id)).size;
  const albumMembership = albumIds.length;
  const chronologyYears = tracks.map((row) => row.release_year).filter((row): row is number => row !== null);
  const chronologySpan =
    chronologyYears.length > 0 ? Math.max(...chronologyYears) - Math.min(...chronologyYears) : 0;
  const artistRecurrence = new Set(albums.map((row) => row.retroverse_artist_id)).size;

  let sequencingAdjacency = 0;
  for (const a of sequencingRows) {
    for (const b of sequencingRows) {
      if (a.retroverse_album_edition_id !== b.retroverse_album_edition_id) continue;
      if (a.retroverse_track_id === b.retroverse_track_id) continue;
      if (a.disc_number === b.disc_number && a.side_code === b.side_code && Math.abs(a.track_number - b.track_number) === 1) {
        sequencingAdjacency += 1;
      }
    }
  }

  const dominantEraId = [...new Set(tracks.map((row) => row.era_id).filter(Boolean))][0] ?? null;
  const eraResult =
    dominantEraId !== null
      ? await supabase
          .from("retroverse_eras")
          .select("retroverse_era_id, slug, display_name, start_year, end_year")
          .eq("retroverse_era_id", dominantEraId)
          .limit(1)
          .maybeSingle<EraRow>()
      : { data: null, error: null };
  if (eraResult.error) throw eraResult.error;

  const firstCompilation = compilationAlbums.sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))[0];
  const firstSoundtrack = soundtrackAlbums.sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))[0];
  const firstAlbum = albums.sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))[0];

  const pathways: RetroversePathway[] = [
    buildPathway({
      key: "album-dominance",
      label: `${eraResult.data?.display_name ?? "Era"} album dominance`,
      summary: `${artist.canonical_artist_name} maintains repeat album presence inside a concentrated chronology window.`,
      href: eraResult.data ? eraHref(eraResult.data) : hrefForArtist(artist.retroverse_artist_id, artist.canonical_artist_name),
      provenanceLevel: "inferred",
      qualityScoreAdjustment: 0,
      qualityNotes: [],
      signals: [
        signal("shared_album_membership", albumMembership, 3, `${albumMembership} album memberships`),
        signal("era_overlap", eraOverlap, 2, `${eraOverlap} linked eras`),
        signal("chronology", chronologySpan, 1, `${chronologySpan} year active span`),
        signal("artist_recurrence", artistRecurrence, 1, `${artistRecurrence} recurrent artists across linked albums`),
      ],
    }),
    buildPathway({
      key: "chart-album-transition",
      label: "Chart-to-album transition",
      summary: "Chart outcomes remain connected to album sequencing rather than separated single logic.",
      href: firstAlbum
        ? hrefForAlbum(firstAlbum.retroverse_album_id, firstAlbum.canonical_album_title)
        : hrefForArtist(artist.retroverse_artist_id, artist.canonical_artist_name),
      provenanceLevel: "inferred",
      qualityScoreAdjustment: 0,
      qualityNotes: [],
      signals: [
        signal("chart_overlap", chartOverlap, 3, `${chartOverlap} charting tracks`),
        signal("sequencing_adjacency", sequencingAdjacency, 1, `${sequencingAdjacency} adjacency links`),
        signal("shared_album_membership", albumMembership, 1, `${albumMembership} albums in artist graph`),
      ],
    }),
  ];

  if (firstSoundtrack) {
    pathways.push(
      buildPathway({
        key: "soundtrack-crossover",
        label: "Disco soundtrack crossover",
        summary: "Soundtrack memberships route artist identity into broader chart-facing circulation.",
        href: hrefForAlbum(firstSoundtrack.retroverse_album_id, firstSoundtrack.canonical_album_title),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("soundtrack_reuse", soundtrackAlbums.length, 4, `${soundtrackAlbums.length} soundtrack albums`),
          signal("chart_overlap", chartOverlap, 2, `${chartOverlap} charting tracks`),
          signal("chronology", chronologySpan, 1, `${chronologySpan} year span`),
        ],
      }),
    );
  }

  if (firstCompilation) {
    pathways.push(
      buildPathway({
        key: "compilation-canonization",
        label: "Compilation-era canonization",
        summary: "Compilation memberships convert release history into a durable artist canon layer.",
        href: hrefForAlbum(firstCompilation.retroverse_album_id, firstCompilation.canonical_album_title),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("compilation_reuse", compilationAlbums.length, 4, `${compilationAlbums.length} compilation albums`),
          signal("shared_album_membership", albumMembership, 2, `${albumMembership} total album memberships`),
          signal("chronology", chronologySpan, 1, `${chronologySpan} year span`),
        ],
      }),
    );
  }

  const ranked = rankPathways(pathways);
  maybeDebugPathways("artist", retroverseArtistId, ranked);
  return ranked;
}

export async function generateEraPathways(supabase: SupabaseClient, retroverseEraId: string): Promise<RetroversePathway[]> {
  const [eraResult, albumsResult] = await Promise.all([
    supabase
      .from("retroverse_eras")
      .select("retroverse_era_id, slug, display_name, start_year, end_year")
      .eq("retroverse_era_id", retroverseEraId)
      .limit(1)
      .maybeSingle<EraRow>(),
    supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, era_id, release_year, album_type, soundtrack_flag")
      .eq("era_id", retroverseEraId),
  ]);
  if (eraResult.error) throw eraResult.error;
  if (albumsResult.error) throw albumsResult.error;
  if (!eraResult.data) return [];

  const era = eraResult.data;
  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const albumIds = albums.map((row) => row.retroverse_album_id);
  if (albumIds.length === 0) return [];

  const editionsResult = await supabase
    .from("retroverse_album_editions")
    .select("retroverse_album_edition_id, retroverse_album_id")
    .in("retroverse_album_id", albumIds)
    .eq("is_primary", true);
  if (editionsResult.error) throw editionsResult.error;
  const editions = (editionsResult.data ?? []) as EditionRow[];
  const editionIds = editions.map((row) => row.retroverse_album_edition_id);
  const tracksResult =
    editionIds.length > 0
      ? await supabase
          .from("retroverse_album_tracks")
          .select("retroverse_album_edition_id, retroverse_track_id, disc_number, track_number, side_code")
          .in("retroverse_album_edition_id", editionIds)
      : { data: [], error: null };
  if (tracksResult.error) throw tracksResult.error;
  const albumTracks = (tracksResult.data ?? []) as AlbumTrackRow[];
  const trackIds = [...new Set(albumTracks.map((row) => row.retroverse_track_id))];
  if (trackIds.length === 0) return [];

  const [trackRowsResult, chartsResult] = await Promise.all([
    supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, retroverse_artist_id, release_year")
      .in("retroverse_track_id", trackIds),
    supabase
      .from("retroverse_chart_appearances")
      .select("retroverse_track_id, chart_position")
      .in("retroverse_track_id", trackIds),
  ]);
  if (trackRowsResult.error) throw trackRowsResult.error;
  if (chartsResult.error) throw chartsResult.error;
  const trackRows = (trackRowsResult.data ?? []) as Array<Pick<TrackRow, "retroverse_track_id" | "retroverse_artist_id" | "release_year">>;
  const charts = (chartsResult.data ?? []) as ChartRow[];

  const crossMembershipsResult = await supabase
    .from("retroverse_album_tracks")
    .select("retroverse_album_edition_id, retroverse_track_id")
    .in("retroverse_track_id", trackIds);
  if (crossMembershipsResult.error) throw crossMembershipsResult.error;
  const crossMemberships = crossMembershipsResult.data ?? [];
  const connectedEditionIds = [...new Set(crossMemberships.map((row) => row.retroverse_album_edition_id))];

  const connectedEditionsResult =
    connectedEditionIds.length > 0
      ? await supabase
          .from("retroverse_album_editions")
          .select("retroverse_album_edition_id, retroverse_album_id, release_year")
          .in("retroverse_album_edition_id", connectedEditionIds)
      : { data: [], error: null };
  if (connectedEditionsResult.error) throw connectedEditionsResult.error;
  const connectedEditions = connectedEditionsResult.data ?? [];

  const connectedAlbumIds = [...new Set(connectedEditions.map((row) => row.retroverse_album_id))];
  const connectedAlbumsResult =
    connectedAlbumIds.length > 0
      ? await supabase
          .from("retroverse_albums")
          .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, era_id, release_year, album_type, soundtrack_flag")
          .in("retroverse_album_id", connectedAlbumIds)
      : { data: [], error: null };
  if (connectedAlbumsResult.error) throw connectedAlbumsResult.error;
  const connectedAlbums = (connectedAlbumsResult.data ?? []) as AlbumRow[];

  const foreignEraAlbums = connectedAlbums.filter((row) => row.era_id !== null && row.era_id !== retroverseEraId);
  const firstForeignEraAlbum = foreignEraAlbums.sort((a, b) => (a.release_year ?? 9999) - (b.release_year ?? 9999))[0];

  const soundtrackReuse = connectedAlbums.filter((row) => row.soundtrack_flag).length;
  const compilationReuse = connectedAlbums.filter((row) => row.album_type === "compilation").length;
  const chartOverlap = new Set(charts.map((row) => row.retroverse_track_id)).size;
  const sharedAlbumMembership = connectedAlbumIds.length;
  const eraOverlap = toUniqueCount(connectedAlbums.map((row) => row.era_id));
  const chronologyYears = connectedAlbums.map((row) => row.release_year).filter((row): row is number => row !== null);
  const chronologySpan =
    chronologyYears.length > 0 ? Math.max(...chronologyYears) - Math.min(...chronologyYears) : 0;
  const artistRecurrence = new Set(trackRows.map((row) => row.retroverse_artist_id)).size;

  let sequencingAdjacency = 0;
  for (const a of albumTracks) {
    for (const b of albumTracks) {
      if (a.retroverse_album_edition_id !== b.retroverse_album_edition_id) continue;
      if (a.retroverse_track_id === b.retroverse_track_id) continue;
      if (a.disc_number === b.disc_number && a.side_code === b.side_code && Math.abs(a.track_number - b.track_number) === 1) {
        sequencingAdjacency += 1;
      }
    }
  }

  const pathways: RetroversePathway[] = [
    buildPathway({
      key: "chart-album-transition",
      label: "Chart-to-album transition",
      summary: "The era's chart tracks remain connected to album sequencing structures.",
      href: eraHref(era),
      provenanceLevel: "inferred",
      qualityScoreAdjustment: 0,
      qualityNotes: [],
      signals: [
        signal("chart_overlap", chartOverlap, 3, `${chartOverlap} charting tracks in-era`),
        signal("sequencing_adjacency", sequencingAdjacency, 1, `${sequencingAdjacency} sequence adjacency links`),
        signal("shared_album_membership", sharedAlbumMembership, 1, `${sharedAlbumMembership} connected album contexts`),
      ],
    }),
    buildPathway({
      key: "artist-recurrence",
      label: "Artist recurrence spine",
      summary: "Recurring artist presence keeps the era culturally coherent across multiple album contexts.",
      href: eraHref(era),
      provenanceLevel: "inferred",
      qualityScoreAdjustment: 0,
      qualityNotes: [],
      signals: [
        signal("artist_recurrence", artistRecurrence, 3, `${artistRecurrence} artists across linked track rows`),
        signal("shared_album_membership", sharedAlbumMembership, 1, `${sharedAlbumMembership} album memberships`),
        signal("era_overlap", eraOverlap, 1, `${eraOverlap} connected eras`),
      ],
    }),
  ];

  if (soundtrackReuse > 0) {
    pathways.push(
      buildPathway({
        key: "soundtrack-crossover",
        label: "Soundtrack crossover corridor",
        summary: "Soundtrack-linked albums route era tracks into broader circulation channels.",
        href: firstForeignEraAlbum
          ? hrefForAlbum(firstForeignEraAlbum.retroverse_album_id, firstForeignEraAlbum.canonical_album_title)
          : eraHref(era),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("soundtrack_reuse", soundtrackReuse, 4, `${soundtrackReuse} soundtrack albums in connected graph`),
          signal("chronology", chronologySpan, 1, `${chronologySpan} years across connected chronology`),
          signal("era_overlap", eraOverlap, 1, `${eraOverlap} eras connected`),
        ],
      }),
    );
  }

  if (compilationReuse > 0) {
    pathways.push(
      buildPathway({
        key: "compilation-canonization",
        label: "Compilation-era canonization",
        summary: "Compilation releases stabilize the era's track memory across later catalog windows.",
        href: firstForeignEraAlbum
          ? hrefForAlbum(firstForeignEraAlbum.retroverse_album_id, firstForeignEraAlbum.canonical_album_title)
          : eraHref(era),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("compilation_reuse", compilationReuse, 4, `${compilationReuse} compilation albums in connected graph`),
          signal("chronology", chronologySpan, 2, `${chronologySpan} year catalog span`),
          signal("shared_album_membership", sharedAlbumMembership, 1, `${sharedAlbumMembership} album memberships`),
        ],
      }),
    );
  }

  if (firstForeignEraAlbum) {
    pathways.push(
      buildPathway({
        key: "later-era-bridge",
        label: "Later-era carry-forward",
        summary: "Tracks from this era continue into later-era album contexts through reuse and re-sequencing.",
        href: hrefForAlbum(firstForeignEraAlbum.retroverse_album_id, firstForeignEraAlbum.canonical_album_title),
        provenanceLevel: "inferred",
        qualityScoreAdjustment: 0,
        qualityNotes: [],
        signals: [
          signal("era_overlap", eraOverlap, 3, `${eraOverlap} eras represented`),
          signal("chronology", chronologySpan, 2, `${chronologySpan} year carry-forward span`),
          signal("shared_album_membership", sharedAlbumMembership, 1, `${sharedAlbumMembership} connected albums`),
        ],
      }),
    );
  }

  const ranked = rankPathways(pathways);
  maybeDebugPathways("era", retroverseEraId, ranked);
  return ranked;
}

