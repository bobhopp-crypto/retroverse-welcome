type RecurringArtist = {
  artist: string;
  albums: number;
};

export type RetroverseProvenanceLevel =
  | "verified"
  | "canonicalized"
  | "inferred"
  | "editorial"
  | "placeholder";

export const RETROVERSE_EDITORIAL_PROVENANCE: RetroverseProvenanceLevel = "editorial";

export function buildEditorialProvenanceNote(section: string): string {
  return `${section} uses editorial interpretation grounded in canonical and inferred graph facts.`;
}

type EraThreadsInput = {
  soundtrackAlbumCount: number;
  soundtrackExclusiveCount: number;
  compilationAlbumCount: number;
  historicalReuseCount: number;
  crossoverHitCount: number;
  chartedTrackCount: number;
  albumCutCount: number;
  recurringArtists: RecurringArtist[];
};

type ArtistRoleInput = {
  numberOneCount: number;
  soundtrackLinkedSinglesCount: number;
  soundtrackAlbumAppearances: number;
  sequencingTrackCount: number;
  sequencingSides: number;
  dominantEraName: string | null;
  dominantEraChartingCount: number;
  totalChartingTracks: number;
};

type SoundtrackAlbumContextInput = {
  multiArtistAlbum: boolean;
  hasChartingBeeGeesSingles: boolean;
  hasSoundtrackInstrumentals: boolean;
};

type StudioAlbumContextInput = {
  hasChartingSingles: boolean;
  hasDeepCuts: boolean;
  bandDrivenAlbum: boolean;
};

type CompilationAlbumContextInput = {
  reusedTracks: number;
  chartedTracks: number;
  albumCuts: number;
};

type TrackEditorialInput = {
  peakChartPosition: number | null;
  chartEntryCount: number;
  maxWeeksOnChart: number | null;
  soundtrackFlag: boolean;
  lineageAppearanceCount: number;
  laterReuseCount: number;
  primaryEraName: string | null;
  sequenceLabel: string | null;
};

export function buildEraSummaryLine(input: EraThreadsInput): string {
  if (input.soundtrackAlbumCount > 0 && input.compilationAlbumCount > 0) {
    return "Soundtrack-driven singles and catalog compilations share chart space as FM radio expands mainstream crossover.";
  }
  if (input.soundtrackAlbumCount > 0) {
    return "Soundtrack sequencing and radio singles operate side by side in the era's chart-facing releases.";
  }
  return "Album sequencing, chart singles, and catalog reuse are documented together within the same commercial window.";
}

export function buildEraCulturalThreads(input: EraThreadsInput): string[] {
  const recurringLine =
    input.recurringArtists.length > 0
      ? `Recurring artists move across multiple albums in the set (${input.recurringArtists
          .map((row) => `${row.artist} on ${row.albums}`)
          .join(", ")}), linking soundtrack, studio, and compilation contexts.`
      : "Artist activity is distributed across separate albums rather than repeated across the current featured set.";

  return [
    `Soundtrack structure remains visible: ${input.soundtrackExclusiveCount} soundtrack-sequence tracks sit alongside chart-facing singles in ${input.soundtrackAlbumCount} soundtrack release.`,
    `Compilation behavior is active: ${input.historicalReuseCount} tracks predate their containing album release, showing deliberate catalog reuse rather than new-session sequencing.`,
    `${input.crossoverHitCount} charting tracks are tied to soundtrack or compilation formats, indicating crossover routes outside standard studio-album cycles.`,
    `Chart records and deeper sequence tracks remain in balance (${input.chartedTrackCount} charting, ${input.albumCutCount} album cuts), preserving both radio impact and full-album context.`,
    recurringLine,
  ];
}

export function buildArtistContextLine(input: ArtistRoleInput): string {
  if (input.dominantEraName && input.soundtrackLinkedSinglesCount > 0) {
    return `Chart activity concentrates in ${input.dominantEraName}, where soundtrack-linked singles and pop-radio crossover move together.`;
  }
  if (input.dominantEraName) {
    return `Most chart activity falls within ${input.dominantEraName}, with album sequencing and singles operating as one release cycle.`;
  }
  return "Charting singles, album sequencing, and release context align within a single canonical artist node.";
}

export function buildArtistCulturalRole(input: ArtistRoleInput): string[] {
  const eraLine = input.dominantEraName
    ? `${input.dominantEraChartingCount} of ${input.totalChartingTracks} charting tracks cluster in ${input.dominantEraName}, marking the group's strongest chart-era concentration.`
    : "Charting material is distributed across the available era links without a single dominant era cluster.";

  return [
    `Chart dominance is sustained across ${input.totalChartingTracks} singles, including ${input.numberOneCount} records that reached #1.`,
    `Soundtrack crossover is explicit: ${input.soundtrackLinkedSinglesCount} soundtrack-linked charting singles connect to ${input.soundtrackAlbumAppearances} soundtrack album appearance.`,
    `Sequencing presence remains central, with tracks placed across ${input.sequencingSides} side contexts instead of isolated single releases (${input.sequencingTrackCount} placements).`,
    eraLine,
  ];
}

export function buildSoundtrackAlbumContext(input: SoundtrackAlbumContextInput): string[] {
  const lines: string[] = [];
  if (input.multiArtistAlbum) {
    lines.push("Structured as a multi-artist soundtrack rather than a single-artist studio sequence.");
  }
  if (input.hasChartingBeeGeesSingles) {
    lines.push("Bee Gees singles provide the soundtrack's primary chart anchors.");
  }
  if (input.hasSoundtrackInstrumentals) {
    lines.push("Instrumental and interlude material preserves film-sequence continuity between radio-driven cuts.");
  }
  if (lines.length === 0) {
    lines.push("Soundtrack sequencing is retained as an album object, independent of chart outcomes.");
  }
  return lines;
}

export function buildStudioAlbumContext(input: StudioAlbumContextInput): string[] {
  const lines: string[] = ["Studio album sequence led by a consistent band lineup."];
  if (input.hasChartingSingles && input.hasDeepCuts) {
    lines.push("Charting singles are embedded inside the same side sequencing as non-single album cuts.");
  } else if (input.hasChartingSingles) {
    lines.push("Charting singles carry most of the documented album visibility.");
  } else if (input.hasDeepCuts) {
    lines.push("Sequence emphasis is on album cuts rather than radio singles.");
  }
  if (input.bandDrivenAlbum) {
    lines.push("Track authorship remains band-centered across both sides.");
  }
  return lines;
}

export function buildCompilationAlbumContext(input: CompilationAlbumContextInput): string[] {
  return [
    "Compilation sequence reframes previously released material within a single mid-70s commercial package.",
    `${input.reusedTracks} tracks predate the compilation release, documenting catalog consolidation rather than new-session chronology.`,
    `${input.chartedTracks} charting tracks are presented alongside ${input.albumCuts} album cuts to preserve both radio history and broader catalog context.`,
  ];
}

export function buildTrackContextLine(input: TrackEditorialInput): string {
  if (input.soundtrackFlag && input.peakChartPosition === 1) {
    return "A soundtrack-sequenced single that also reached top-chart radio status within its core release window.";
  }
  if (input.soundtrackFlag) {
    return "Anchored in soundtrack sequencing while maintaining direct chart visibility.";
  }
  if (input.laterReuseCount > 0) {
    return "First documented in an album sequence, then carried forward through later catalog contexts.";
  }
  return "Documented as a canonical single with stable album and chart context.";
}

export function buildTrackCulturalRole(input: TrackEditorialInput): string[] {
  const chartLine =
    input.peakChartPosition !== null
      ? `Chart profile: peak #${input.peakChartPosition} across ${input.chartEntryCount} chart records${input.maxWeeksOnChart !== null ? `, with up to ${input.maxWeeksOnChart} weeks on chart` : ""}.`
      : "No chart history is currently linked in the canonical chart layer.";

  const sequenceLine = input.sequenceLabel
    ? `Sequence placement: ${input.sequenceLabel}, preserving album-order context alongside chart history.`
    : "Sequence placement is unresolved in current primary-edition metadata and should be reviewed.";

  const lineageLine =
    input.laterReuseCount > 0
      ? `Lineage persistence: ${input.laterReuseCount} later appearances beyond the original anchor (${input.lineageAppearanceCount} total documented contexts).`
      : `Lineage anchor is stable in a single documented context (${input.lineageAppearanceCount} appearance record).`;

  const eraLine = input.primaryEraName
    ? `Era anchoring: chart and release activity concentrates in ${input.primaryEraName}.`
    : "Era anchoring is pending additional era linkage data.";

  return [chartLine, sequenceLine, lineageLine, eraLine];
}
