import type { AlbumDossier } from "@/lib/album-dossier-schema";
import type { AggregatedAcousticProfile } from "@/lib/canonical-acoustic-aggregate";
import {
  allocateRetroverseTrackId,
  applyRumoursStemAlias,
  groupTracksByCanonicalStem,
} from "@/lib/canonical-acoustic-aggregate";

/** Local proof: Fleetwood Mac — Rumours dossier (RetroScope spine). */
export const RUMOURS_DOSSIER_PROOF_RVAL = "RVAL000003";

const PSEUDO_ARTIST_KEY = "poc-fleetwood-mac-rumours";

const EMPTY_AGGREGATED: AggregatedAcousticProfile = {
  energy: null,
  valence: null,
  danceability: null,
  acousticness: null,
  instrumentalness: null,
  liveness: null,
  speechiness: null,
  tempo: null,
  loudness: null,
  duration_ms: null,
};

/**
 * 1977 original LP sequencing only (`stem_key` lowercase after split + rumours alias).
 * Dossier excludes deluxe-only / session-only bundles that aren't LP cuts.
 */
export const RUMOURS_LP_TRACKS = [
  { stem: "second hand news", title: "Second Hand News" },
  { stem: "dreams", title: "Dreams" },
  { stem: "never going back again", title: "Never Going Back Again" },
  { stem: "don't stop", title: "Don't Stop" },
  { stem: "go your own way", title: "Go Your Own Way" },
  { stem: "songbird", title: "Songbird" },
  { stem: "the chain", title: "The Chain" },
  { stem: "you make loving fun", title: "You Make Loving Fun" },
  { stem: "i don't want to know", title: "I Don't Want to Know" },
  { stem: "oh daddy", title: "Oh Daddy" },
  { stem: "gold dust woman", title: "Gold Dust Woman" },
] as const;

export type RumoursLpStemKey = (typeof RUMOURS_LP_TRACKS)[number]["stem"];

export type PocPlayState = "unavailable" | "external_available" | "local_verified";
export type PocAddState = "not_added" | "wanted" | "added";

export type RumoursCanonicalTapestryRow = {
  track_number: number;
  display_title: string;
  retroverse_track_id: string;
  profile: AggregatedAcousticProfile;
  source_recording_count: number;
  key_label: string | null | undefined;
  hot100_matched_local_sqlite: false;
  /** Kept on row shape for future chart join — not rendered in dense strip UI. */
  hot100_note: string;
  playState: PocPlayState;
  addState: PocAddState;
};

const PLAY_CYCLE: PocPlayState[] = ["external_available", "unavailable", "local_verified"];
const ADD_CYCLE: PocAddState[] = ["wanted", "not_added", "added"];

/**
 * Exactly one dossier row per original LP sequence (extras / non-LP stems omitted).
 */
export function buildRumoursCanonicalTapestryRows(dossier: AlbumDossier): RumoursCanonicalTapestryRow[] | null {
  if (dossier.albumId !== RUMOURS_DOSSIER_PROOF_RVAL) return null;

  const grouped = groupTracksByCanonicalStem(dossier.acoustic.tracks, applyRumoursStemAlias);
  const usedRvtr = new Set<string>();

  return RUMOURS_LP_TRACKS.map((lp, i) => {
    const g = grouped.get(lp.stem);
    const profile = g?.profile ?? EMPTY_AGGREGATED;
    const rvtr = allocateRetroverseTrackId(lp.title, PSEUDO_ARTIST_KEY, usedRvtr);
    const sourceCount = g?.sources?.length ?? 0;
    return {
      track_number: i + 1,
      display_title: lp.title,
      retroverse_track_id: rvtr,
      profile,
      source_recording_count: sourceCount,
      key_label: g?.representative.key_label,
      hot100_matched_local_sqlite: false,
      hot100_note:
        "Local billboard-hot-100.db `chart_positions` is a 100-row sample — no reliable Hot 100 join for this proof.",
      playState: PLAY_CYCLE[i % PLAY_CYCLE.length],
      addState: ADD_CYCLE[(i + 1) % ADD_CYCLE.length],
    };
  });
}
