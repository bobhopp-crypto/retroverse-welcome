import { writeFile } from "node:fs/promises";

import { createClient } from "@supabase/supabase-js";

import { ensureAcousticLogDir, latestAcousticLogPath, logFileBase } from "./lib/acoustic-enrichment";
import type { RetroverseSupabase } from "../lib/retroverse-supabase";

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

function mean(nums: number[]): number | null {
  const f = nums.filter((n) => Number.isFinite(n));
  if (f.length === 0) return null;
  return f.reduce((a, b) => a + b, 0) / f.length;
}

function decadeOf(year: number | null): string {
  if (!year || year < 1900) return "unknown";
  return `${Math.floor(year / 10) * 10}s`;
}

function bumpStringCount(map: Map<string, number>, raw: string | null) {
  const t = raw?.trim() ?? "";
  if (!t) return;
  map.set(t, (map.get(t) ?? 0) + 1);
}

function topStringCounts(map: Map<string, number>, limit: number): { name: string; count: number }[] {
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([name, count]) => ({ name, count }));
}

function numStr(n: number | null | undefined): string {
  return n !== null && n !== undefined && Number.isFinite(n) ? String(n) : "";
}

type EnrichmentRow = {
  enrichment_id: string;
  source_fingerprint: string;
  retroverse_track_id: string | null;
  source_artist: string | null;
  source_song: string | null;
  source_album: string | null;
  source_album_identity: string | null;
  acousticness: number | null;
  danceability: number | null;
  energy: number | null;
  valence: number | null;
  tempo: number | null;
  loudness: number | null;
  speechiness: number | null;
  instrumentalness: number | null;
  duration_ms: number | null;
  time_signature: number | null;
  match_confidence: number | null;
};

async function fetchAll<T>(
  supabase: RetroverseSupabase,
  table: string,
  columns: string,
): Promise<T[]> {
  const out: T[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data, error } = await supabase.from(table).select(columns).range(from, from + pageSize - 1);
    if (error) throw error;
    const rows = (data ?? []) as T[];
    if (rows.length === 0) break;
    out.push(...rows);
    if (rows.length < pageSize) break;
  }
  return out;
}

function toCsv(headers: string[], rows: string[][]): string {
  return [headers.join(","), ...rows.map((r) => r.map(csvEscape).join(","))].join("\n") + "\n";
}

const numericKeys = [
  "acousticness",
  "danceability",
  "energy",
  "valence",
  "tempo",
  "loudness",
  "speechiness",
  "instrumentalness",
] as const;

type Agg = { n: number; vals: Record<(typeof numericKeys)[number], number[]> };

function bumpAgg(map: Map<string, Agg>, key: string, e: EnrichmentRow) {
  const cur =
    map.get(key) ??
    ({
      n: 0,
      vals: Object.fromEntries(numericKeys.map((k) => [k, [] as number[]])) as Agg["vals"],
    } as Agg);
  cur.n += 1;
  for (const k of numericKeys) {
    const v = e[k];
    if (v !== null && Number.isFinite(v)) cur.vals[k].push(v);
  }
  map.set(key, cur);
}

async function main() {
  await ensureAcousticLogDir();
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY.");
  }
  const supabase: RetroverseSupabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const enrichments = await fetchAll<EnrichmentRow>(
    supabase,
    "retroverse_track_enrichment",
    [
      "enrichment_id",
      "source_fingerprint",
      "retroverse_track_id",
      "source_artist",
      "source_song",
      "source_album",
      "source_album_identity",
      "acousticness",
      "danceability",
      "energy",
      "valence",
      "tempo",
      "loudness",
      "speechiness",
      "instrumentalness",
      "duration_ms",
      "time_signature",
      "match_confidence",
    ].join(","),
  );

  const sourceAlbumRowCounts = new Map<string, number>();
  const sourceArtistRowCounts = new Map<string, number>();
  for (const e of enrichments) {
    bumpStringCount(sourceAlbumRowCounts, e.source_album);
    bumpStringCount(sourceArtistRowCounts, e.source_artist);
  }
  const topSourceAlbums = topStringCounts(sourceAlbumRowCounts, 50);
  const topSourceArtists = topStringCounts(sourceArtistRowCounts, 50);

  const matched = enrichments.filter((e) => e.retroverse_track_id);
  const unmatched = enrichments.filter((e) => !e.retroverse_track_id);

  const tracksTotalRes = await supabase
    .from("retroverse_tracks")
    .select("retroverse_track_id", { count: "exact", head: true });
  const tracksTotal = tracksTotalRes.count;
  const trackIdsWithEnrichment = new Set(matched.map((m) => m.retroverse_track_id!));

  const unmatchedPath = logFileBase("unmatched_enrichment", "csv");
  await writeFile(
    unmatchedPath,
    toCsv(
      ["enrichment_id", "source_artist", "source_song", "source_album", "acousticness", "energy", "valence"],
      unmatched.map((r) => [
        r.enrichment_id,
        r.source_artist ?? "",
        r.source_song ?? "",
        r.source_album ?? "",
        r.acousticness !== null ? String(r.acousticness) : "",
        r.energy !== null ? String(r.energy) : "",
        r.valence !== null ? String(r.valence) : "",
      ]),
    ),
    "utf8",
  );

  const rawTracks = await fetchAll<{
    retroverse_track_id: string;
    retroverse_album_id: string | null;
    retroverse_artist_id: string;
    release_year: number | null;
  }>(supabase, "retroverse_tracks", "retroverse_track_id,retroverse_album_id,retroverse_artist_id,release_year");

  const trackMeta = new Map(rawTracks.map((t) => [t.retroverse_track_id, t]));

  const artists = await fetchAll<{ retroverse_artist_id: string; canonical_artist_name: string }>(
    supabase,
    "retroverse_artists",
    "retroverse_artist_id,canonical_artist_name",
  );
  const artistName = new Map(artists.map((a) => [a.retroverse_artist_id, a.canonical_artist_name]));

  const albums = await fetchAll<{ retroverse_album_id: string; canonical_album_title: string }>(
    supabase,
    "retroverse_albums",
    "retroverse_album_id,canonical_album_title",
  );
  const albumTitle = new Map(albums.map((a) => [a.retroverse_album_id, a.canonical_album_title]));

  const clusteringPath = logFileBase("clustering_features", "csv");
  const clusterHeader = [
    "enrichment_id",
    "source_fingerprint",
    "retroverse_track_id",
    "source_album_identity",
    "release_year",
    "decade",
    ...numericKeys,
    "duration_ms",
    "time_signature",
  ];

  const clusterBody: string[][] = [];
  for (const e of enrichments) {
    const tm = e.retroverse_track_id ? trackMeta.get(e.retroverse_track_id) : undefined;
    const yr = tm?.release_year ?? null;
    clusterBody.push([
      e.enrichment_id,
      e.source_fingerprint,
      e.retroverse_track_id ?? "",
      e.source_album_identity ?? "",
      yr !== null ? String(yr) : "",
      decadeOf(yr),
      ...numericKeys.map((k) => numStr(e[k])),
      e.duration_ms !== null ? String(e.duration_ms) : "",
      e.time_signature !== null ? String(e.time_signature) : "",
    ]);
  }
  await writeFile(clusteringPath, toCsv(clusterHeader, clusterBody), "utf8");

  const byAlbum = new Map<string, Agg>();
  const byArtist = new Map<string, Agg>();
  const byDecade = new Map<string, Agg>();

  for (const e of matched) {
    const tm = trackMeta.get(e.retroverse_track_id!);
    if (!tm) continue;
    if (tm.retroverse_album_id) {
      const title = albumTitle.get(tm.retroverse_album_id) ?? tm.retroverse_album_id;
      bumpAgg(byAlbum, title, e);
    }
    const an = artistName.get(tm.retroverse_artist_id) ?? tm.retroverse_artist_id;
    bumpAgg(byArtist, an, e);
    bumpAgg(byDecade, decadeOf(tm.release_year), e);
  }

  function aggToRows(map: Map<string, Agg>, label: string): string[][] {
    const rows: string[][] = [];
    for (const [name, agg] of map.entries()) {
      rows.push([
        label,
        name,
        String(agg.n),
        ...numericKeys.map((k) => {
          const m = mean(agg.vals[k]);
          return m !== null ? m.toFixed(6) : "";
        }),
      ]);
    }
    return rows.sort((a, b) => Number(b[2]) - Number(a[2]));
  }

  const avgHeader = ["kind", "name", "enrichment_count", ...numericKeys];
  await writeFile(
    logFileBase("album_feature_averages", "csv"),
    toCsv(avgHeader, aggToRows(byAlbum, "album")),
    "utf8",
  );
  await writeFile(
    logFileBase("artist_feature_averages", "csv"),
    toCsv(avgHeader, aggToRows(byArtist, "artist")),
    "utf8",
  );
  await writeFile(
    logFileBase("decade_feature_averages", "csv"),
    toCsv(avgHeader, aggToRows(byDecade, "decade")),
    "utf8",
  );

  const ranked = async (key: (typeof numericKeys)[number], dir: "asc" | "desc", fname: string, limit = 80) => {
    const scored = enrichments
      .filter((e) => e[key] !== null && Number.isFinite(e[key]!))
      .map((e) => ({ e, v: e[key]! }))
      .sort((a, b) => (dir === "desc" ? b.v - a.v : a.v - b.v))
      .slice(0, limit);
    await writeFile(
      logFileBase(fname, "csv"),
      toCsv(
        ["enrichment_id", "retroverse_track_id", "source_artist", "source_song", String(key)],
        scored.map((s) => [
          s.e.enrichment_id,
          s.e.retroverse_track_id ?? "",
          s.e.source_artist ?? "",
          s.e.source_song ?? "",
          String(s.v),
        ]),
      ),
      "utf8",
    );
  };

  await ranked("acousticness", "desc", "top_acoustic_tracks");
  await ranked("energy", "desc", "top_energetic_tracks");
  await ranked("valence", "asc", "low_valence_tracks");

  const densityAlbums = [...byAlbum.entries()]
    .map(([name, agg]) => ({ name, count: agg.n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);
  const densityArtists = [...byArtist.entries()]
    .map(([name, agg]) => ({ name, count: agg.n }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 50);

  const overlapPctEnrichment =
    enrichments.length > 0 ? Number(((matched.length / enrichments.length) * 100).toFixed(2)) : 0;
  const overlapPctTracks =
    tracksTotal && tracksTotal > 0 ? Number(((trackIdsWithEnrichment.size / tracksTotal) * 100).toFixed(2)) : 0;

  const latestAmbiguous = await latestAcousticLogPath("ambiguous_matches", "csv");

  const coveragePath = logFileBase("enrichment_coverage", "json");
  await writeFile(
    coveragePath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        enrichment_rows_total: enrichments.length,
        enrichment_rows_matched: matched.length,
        enrichment_rows_unmatched: unmatched.length,
        overlap_pct_of_enrichment_linked: overlapPctEnrichment,
        canonical_tracks_total: tracksTotal,
        canonical_tracks_with_any_enrichment: trackIdsWithEnrichment.size,
        overlap_pct_of_tracks_with_enrichment: overlapPctTracks,
        top_albums_by_matched_density: densityAlbums,
        top_artists_by_matched_density: densityArtists,
        top_source_albums_by_row_count: topSourceAlbums,
        top_source_artists_by_row_count: topSourceArtists,
        outputs: {
          unmatched_csv: unmatchedPath,
          clustering_features_csv: clusteringPath,
          latest_ambiguous_matches_csv: latestAmbiguous,
        },
      },
      null,
      2,
    ),
    "utf8",
  );

  const mdPath = logFileBase("validation_summary", "md");
  await writeFile(
    mdPath,
    [
      "# Acoustic enrichment validation",
      "",
      `- enrichment rows: **${enrichments.length}**`,
      `- matched to canonical track: **${matched.length}** (${overlapPctEnrichment}%)`,
      `- unmatched: **${unmatched.length}**`,
      `- canonical tracks: **${tracksTotal ?? "n/a"}**`,
      `- tracks with ≥1 enrichment row: **${trackIdsWithEnrichment.size}** (${overlapPctTracks}%)`,
      "",
      "## Top canonical albums by matched row count",
      ...densityAlbums.slice(0, 15).map((r) => `- ${r.name}: ${r.count}`),
      "",
      "## Top canonical artists by matched row count",
      ...densityArtists.slice(0, 15).map((r) => `- ${r.name}: ${r.count}`),
      "",
      "## Top source album strings by enrichment row count",
      ...topSourceAlbums.slice(0, 15).map((r) => `- ${r.name}: ${r.count}`),
      "",
      "## Top source artist strings by enrichment row count",
      ...topSourceArtists.slice(0, 15).map((r) => `- ${r.name}: ${r.count}`),
      "",
      "## Artifacts",
      `- Clustering prep CSV: \`${clusteringPath}\``,
      `- Latest ambiguous matches (if \`acoustic:match\` was run): \`${latestAmbiguous ?? "(none found)"}\``,
      `- Coverage JSON: \`${coveragePath}\``,
      `- Unmatched CSV: \`${unmatchedPath}\``,
      "",
    ].join("\n"),
    "utf8",
  );

  console.log(`validation_md=${mdPath}`);
  console.log(`coverage_json=${coveragePath}`);
  console.log(`unmatched_csv=${unmatchedPath}`);
  console.log(`clustering_csv=${clusteringPath}`);
  if (latestAmbiguous) console.log(`latest_ambiguous_csv=${latestAmbiguous}`);
  console.log(
    `enrichment_total=${enrichments.length} matched=${matched.length} unmatched=${unmatched.length} tracks_with_features=${trackIdsWithEnrichment.size}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
