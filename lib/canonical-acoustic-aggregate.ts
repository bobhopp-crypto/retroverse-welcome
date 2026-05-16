import { createHash } from "node:crypto";

import type { AlbumDossierTrack } from "@/lib/album-dossier-schema";

/** Hint that text after " - " is an edition/variant, not subtitle of the work title. */
const VARIANT_TAIL_HINT =
  /live|demo|session|remaster|digital|take\s*\d+|take\b|instrumental|acoustic|duet|outtake|early|rough|deluxe|forum|inglewood|fabulous|vocals?|with vocal|planets|sessions?|outtakes|\d{4}\s+remaster|; 20\d{2}/i;

/**
 * Strip trailing variant suffixes (Spotify-style "Title - Live 1977").
 * If there is no variant tail, returns the full trimmed title.
 */
export function splitCanonicalStem(raw: string): string {
  const t = raw.trim();
  const idx = t.search(/\s+-\s+/);
  if (idx === -1) return t;
  const head = t.slice(0, idx).trim();
  const tail = t.slice(idx).replace(/^\s+-\s+/, "").trim();
  if (VARIANT_TAIL_HINT.test(tail)) return head;
  return t;
}

/** Rumours-only: fold numbered Gold Dust takes into the album cut identity. */
export function applyRumoursStemAlias(stem: string): string {
  const s = stem.trim();
  const plain = s.replace(/^Gold Dust Woman\s*#\s*\d+/i, "Gold Dust Woman").replace(/^Gold Dust Woman\s+#\d+/i, "Gold Dust Woman");
  return plain;
}

export type AggregatedAcousticProfile = {
  energy: number | null;
  valence: number | null;
  danceability: number | null;
  acousticness: number | null;
  instrumentalness: number | null;
  liveness: number | null;
  speechiness: number | null;
  tempo: number | null;
  loudness: number | null;
  duration_ms: number | null;
};

const NUMERIC_KEYS = [
  "energy",
  "valence",
  "danceability",
  "acousticness",
  "instrumentalness",
  "liveness",
  "speechiness",
  "tempo",
  "loudness",
  "duration_ms",
] as const satisfies readonly (keyof AlbumDossierTrack)[];

export function meanFinite(vals: number[]): number | null {
  const ok = vals.filter((x) => typeof x === "number" && Number.isFinite(x));
  if (!ok.length) return null;
  return ok.reduce((a, b) => a + b, 0) / ok.length;
}

/** Aggregate Spotify-style acoustic metrics across source rows (means). */
export function aggregateAcousticMeans(sources: AlbumDossierTrack[]): AggregatedAcousticProfile {
  const out: AggregatedAcousticProfile = {
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

  for (const k of NUMERIC_KEYS) {
    const vals = sources.map((s) => s[k]).filter((x): x is number => typeof x === "number" && Number.isFinite(x));
    const m = meanFinite(vals);
    out[k] = m;
  }

  return out;
}

/** Prefer album-master style row for key display; else shortest title. */
export function pickRepresentativeAcousticSource(sources: AlbumDossierTrack[]): AlbumDossierTrack {
  const studioish = sources.find((s) => /\b2004\s+remaster\b/i.test(s.title));
  if (studioish) return studioish;
  return [...sources].sort((a, b) => a.title.length - b.title.length)[0] ?? sources[0];
}

/** Editorial line from aggregated means (compact, dossier voice). */
export function emotionalDescriptorFromAggregate(means: AggregatedAcousticProfile): string {
  const v = means.valence;
  const e = means.energy;
  const d = means.danceability;
  const a = means.acousticness;
  const parts: string[] = [];
  if (typeof v === "number" && v >= 0.6) parts.push("bright lift");
  else if (typeof v === "number" && v <= 0.38) parts.push("muted glow");
  if (typeof e === "number" && e >= 0.65) parts.push("charged motion");
  else if (typeof e === "number" && e <= 0.32) parts.push("soft weight");
  if (typeof d === "number" && d >= 0.62) parts.push("groove pocket");
  if (typeof a === "number" && a >= 0.38) parts.push("air & wood");
  if (typeof means.tempo === "number" && means.tempo >= 125) parts.push("driving pulse");
  else if (typeof means.tempo === "number" && means.tempo <= 95) parts.push("slow burn");
  if (!parts.length) return "Balanced cluster — variant sources averaged.";
  return `Canonical read: ${parts.slice(0, 3).join(" · ")}.`;
}

export type CanonicalGroupedSources = {
  canonical_stem_key: string;
  display_title: string;
  sources: AlbumDossierTrack[];
  profile: AggregatedAcousticProfile;
  representative: AlbumDossierTrack;
  emotional_descriptor: string;
};

/** Group raw dossier acoustic rows by canonical stem; aggregate metrics per bucket. */
export function groupTracksByCanonicalStem(
  tracks: AlbumDossierTrack[],
  stemAlias?: (stem: string) => string,
): Map<string, CanonicalGroupedSources> {
  const buckets = new Map<string, AlbumDossierTrack[]>();

  for (const tr of tracks) {
    let stem = splitCanonicalStem(tr.title);
    if (stemAlias) stem = stemAlias(stem);
    const key = stem.trim().toLowerCase();

    let list = buckets.get(key);
    if (!list) {
      list = [];
      buckets.set(key, list);
    }
    list.push(tr);
  }

  const out = new Map<string, CanonicalGroupedSources>();
  for (const [key, sources] of buckets) {
    const rep = pickRepresentativeAcousticSource(sources);
    let displayStem = splitCanonicalStem(rep.title);
    if (stemAlias) displayStem = stemAlias(displayStem);
    displayStem = displayStem.trim();
    const profile = aggregateAcousticMeans(sources);
    out.set(key, {
      canonical_stem_key: key,
      display_title: displayStem,
      sources,
      representative: rep,
      profile,
      emotional_descriptor: emotionalDescriptorFromAggregate(profile),
    });
  }

  return out;
}

export function hashToSixDigitsWave1(input: string): number {
  const digest = createHash("sha1").update(input).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16) % 1_000_000;
}

export function allocateRetroverseTrackId(canonicalStemForId: string, artistPseudoKey: string, used: Set<string>): string {
  const normalizedTitle = canonicalStemForId.trim().toLowerCase().replace(/\s+/g, " ");
  const canonicalKey = `${normalizedTitle}::${artistPseudoKey}`;
  const bundle = `track::${canonicalKey}`;
  let probe = hashToSixDigitsWave1(`RVTR:${bundle}`);
  for (let attempt = 0; attempt < 1_000_000; attempt += 1) {
    const candidate = `RVTR${String(probe).padStart(6, "0")}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    probe = (probe + 1) % 1_000_000;
  }
  throw new Error(`unable_to_allocate_rvtr:${bundle}`);
}
