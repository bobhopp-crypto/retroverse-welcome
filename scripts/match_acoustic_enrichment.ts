import { createWriteStream } from "node:fs";
import { writeFile } from "node:fs/promises";
import { finished } from "node:stream/promises";

import { createClient } from "@supabase/supabase-js";

import { ensureAcousticLogDir, logFileBase, normalizeKey } from "./lib/acoustic-enrichment";
import type { RetroverseSupabase } from "../lib/retroverse-supabase";

const STRONG = Number.parseFloat(process.env.ACOUSTIC_MATCH_STRONG ?? "0.92");
const WITH_ALBUM = Number.parseFloat(process.env.ACOUSTIC_MATCH_WITH_ALBUM ?? "0.97");
const PAGE_SIZE = Math.max(100, Math.min(5000, Number.parseInt(process.env.ACOUSTIC_MATCH_PAGE_SIZE ?? "800", 10)));
const UPDATE_CONCURRENCY = Math.max(
  1,
  Math.min(128, Number.parseInt(process.env.ACOUSTIC_MATCH_UPDATE_CONCURRENCY ?? "32", 10)),
);

type TrackRec = {
  retroverse_track_id: string;
  canonical_title: string;
  retroverse_album_id: string | null;
  release_year: number | null;
  artist_name: string;
  album_title: string | null;
};

type EnrichmentRow = {
  enrichment_id: string;
  source_song: string | null;
  source_album: string | null;
  source_artist: string | null;
  retroverse_track_id: string | null;
};

function csvEscape(v: string): string {
  if (v.includes(",") || v.includes('"') || v.includes("\n")) return `"${v.replace(/"/g, '""')}"`;
  return v;
}

async function fetchAllRows<T>(
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

function artistTitleKey(artist: string, title: string): string {
  return `${normalizeKey(artist)}|${normalizeKey(title)}`;
}

function albumLooseEq(sourceAlbum: string, albumTitle: string | null): boolean {
  const a = normalizeKey(sourceAlbum);
  const b = normalizeKey(albumTitle ?? "");
  if (!a || !b) return false;
  return a === b || a.includes(b) || b.includes(a);
}

type PendingUpdate = {
  enrichment_id: string;
  retroverse_track_id: string;
  match_confidence: number;
  match_method: string;
};

async function runUpdatesWithConcurrency(
  supabase: RetroverseSupabase,
  items: PendingUpdate[],
  updatedAt: string,
): Promise<number> {
  let ok = 0;
  for (let i = 0; i < items.length; i += UPDATE_CONCURRENCY) {
    const slice = items.slice(i, i + UPDATE_CONCURRENCY);
    const results = await Promise.all(
      slice.map((row) =>
        supabase
          .from("retroverse_track_enrichment")
          .update({
            retroverse_track_id: row.retroverse_track_id,
            match_confidence: row.match_confidence,
            match_method: row.match_method,
            updated_at: updatedAt,
          })
          .eq("enrichment_id", row.enrichment_id)
          .then((res) => res),
      ),
    );
    for (let j = 0; j < results.length; j++) {
      const res = results[j]!;
      if (res.error) {
        console.error("match_update_error", slice[j]!.enrichment_id, res.error.message);
      } else {
        ok += 1;
      }
    }
  }
  return ok;
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

  const started = performance.now();

  const artists = await fetchAllRows<{ retroverse_artist_id: string; canonical_artist_name: string }>(
    supabase,
    "retroverse_artists",
    "retroverse_artist_id,canonical_artist_name",
  );
  const artistById = new Map(artists.map((a) => [a.retroverse_artist_id, a.canonical_artist_name]));

  const albums = await fetchAllRows<{ retroverse_album_id: string; canonical_album_title: string }>(
    supabase,
    "retroverse_albums",
    "retroverse_album_id,canonical_album_title",
  );
  const albumById = new Map(albums.map((a) => [a.retroverse_album_id, a.canonical_album_title]));

  const rawTracks = await fetchAllRows<{
    retroverse_track_id: string;
    canonical_title: string;
    retroverse_album_id: string | null;
    retroverse_artist_id: string;
    release_year: number | null;
  }>(supabase, "retroverse_tracks", "retroverse_track_id,canonical_title,retroverse_album_id,retroverse_artist_id,release_year");

  const tracks: TrackRec[] = rawTracks.map((t) => ({
    retroverse_track_id: t.retroverse_track_id,
    canonical_title: t.canonical_title,
    retroverse_album_id: t.retroverse_album_id,
    release_year: t.release_year,
    artist_name: artistById.get(t.retroverse_artist_id) ?? "",
    album_title: t.retroverse_album_id ? albumById.get(t.retroverse_album_id) ?? null : null,
  }));

  const byKey = new Map<string, TrackRec[]>();
  for (const t of tracks) {
    const k = artistTitleKey(t.artist_name, t.canonical_title);
    const list = byKey.get(k) ?? [];
    list.push(t);
    byKey.set(k, list);
  }

  const { count: pendingTotal, error: countErr } = await supabase
    .from("retroverse_track_enrichment")
    .select("enrichment_id", { count: "exact", head: true })
    .is("retroverse_track_id", null);
  if (countErr) throw countErr;
  const totalUnmatched = pendingTotal ?? 0;

  console.log(
    `acoustic_match_start unmatched_rows=${totalUnmatched} page_size=${PAGE_SIZE} update_concurrency=${UPDATE_CONCURRENCY} strong=${STRONG} with_album=${WITH_ALBUM}`,
  );

  const ambPath = logFileBase("ambiguous_matches", "csv");
  const ambStream = createWriteStream(ambPath, { flags: "w" });
  const ambHeader = [
    "enrichment_id",
    "source_artist",
    "source_song",
    "source_album",
    "candidate_count",
    "candidate_track_ids",
  ];
  ambStream.write(`${ambHeader.join(",")}\n`);

  let cumulativeScanned = 0;
  let candidateMatchesAttempted = 0;
  let successfulMatches = 0;
  let ambiguousMatches = 0;
  let emptyKeys = 0;
  let noCandidatesTotal = 0;
  let lastCursor: string | null = null;
  let batchIndex = 0;

  const columns = "enrichment_id,source_song,source_album,source_artist,retroverse_track_id";

  try {
    while (true) {
    let q = supabase
      .from("retroverse_track_enrichment")
      .select(columns)
      .is("retroverse_track_id", null)
      .order("enrichment_id", { ascending: true })
      .limit(PAGE_SIZE);
    if (lastCursor !== null) {
      q = q.gt("enrichment_id", lastCursor);
    }
    const { data, error } = await q;
    if (error) throw error;
    const page = (data ?? []) as EnrichmentRow[];
    if (page.length === 0) break;

    batchIndex += 1;
    const batchStart = performance.now();

    let batchCandidateAttempts = 0;
    let batchAmbiguous = 0;
    const pendingUpdates: PendingUpdate[] = [];
    const ambLines: string[] = [];
    let batchNoCandidates = 0;

    for (const e of page) {
      const song = e.source_song ?? "";
      const artist = e.source_artist ?? "";
      if (!normalizeKey(song) || !normalizeKey(artist)) {
        emptyKeys += 1;
        continue;
      }
      batchCandidateAttempts += 1;
      candidateMatchesAttempted += 1;

      const key = artistTitleKey(artist, song);
      const cand = byKey.get(key) ?? [];
      let chosen: TrackRec | null = null;
      let conf = 0;
      let method = "";

      if (cand.length === 1) {
        chosen = cand[0]!;
        conf = STRONG;
        method = "artist_title_exact_single";
      } else if (cand.length > 1 && e.source_album?.trim()) {
        const filtered = cand.filter((c) => albumLooseEq(e.source_album ?? "", c.album_title));
        if (filtered.length === 1) {
          chosen = filtered[0]!;
          conf = WITH_ALBUM;
          method = "artist_title_album_disambiguated";
        } else {
          batchAmbiguous += 1;
          ambiguousMatches += 1;
          ambLines.push(
            [
              e.enrichment_id,
              e.source_artist ?? "",
              e.source_song ?? "",
              e.source_album ?? "",
              String(cand.length),
              cand.map((c) => c.retroverse_track_id).join(";"),
            ]
              .map(csvEscape)
              .join(","),
          );
        }
      } else if (cand.length > 1) {
        batchAmbiguous += 1;
        ambiguousMatches += 1;
        ambLines.push(
          [
            e.enrichment_id,
            e.source_artist ?? "",
            e.source_song ?? "",
            e.source_album ?? "",
            String(cand.length),
            cand.map((c) => c.retroverse_track_id).join(";"),
          ]
            .map(csvEscape)
            .join(","),
        );
      } else {
        batchNoCandidates += 1;
        noCandidatesTotal += 1;
      }

      if (chosen && conf >= STRONG) {
        pendingUpdates.push({
          enrichment_id: e.enrichment_id,
          retroverse_track_id: chosen.retroverse_track_id,
          match_confidence: conf,
          match_method: method,
        });
      }
    }

    for (const line of ambLines) {
      ambStream.write(`${line}\n`);
    }

    const updatedAt = new Date().toISOString();
    const batchMatched =
      pendingUpdates.length > 0 ? await runUpdatesWithConcurrency(supabase, pendingUpdates, updatedAt) : 0;
    successfulMatches += batchMatched;

    cumulativeScanned += page.length;
    lastCursor = page[page.length - 1]!.enrichment_id;

    const elapsedSec = (performance.now() - started) / 1000;
    const rate = cumulativeScanned / Math.max(elapsedSec, 1e-6);
    const remaining = Math.max(0, totalUnmatched - cumulativeScanned);
    const etaSec = rate > 0 ? remaining / rate : null;

    console.log(
      [
        `acoustic_match_batch batch=${batchIndex}`,
        `page_rows=${page.length}`,
        `cumulative_scanned=${cumulativeScanned}`,
        `total_unmatched_start=${totalUnmatched}`,
        `candidate_attempts_batch=${batchCandidateAttempts}`,
        `candidate_attempts_total=${candidateMatchesAttempted}`,
        `matched_batch=${batchMatched}`,
        `matched_total=${successfulMatches}`,
        `ambiguous_batch=${batchAmbiguous}`,
        `ambiguous_total=${ambiguousMatches}`,
        `no_candidates_batch=${batchNoCandidates}`,
        `no_candidates_total=${noCandidatesTotal}`,
        `empty_keys_total=${emptyKeys}`,
        `page_ms=${(performance.now() - batchStart).toFixed(0)}`,
        `elapsed_sec=${elapsedSec.toFixed(1)}`,
        `scan_rate_per_s=${rate.toFixed(0)}`,
        etaSec !== null ? `eta_sec_remaining≈${Math.round(etaSec)}` : "eta_sec_remaining=n/a",
      ].join(" "),
    );

    if (page.length < PAGE_SIZE) break;
    }
  } finally {
    ambStream.end();
    await finished(ambStream).catch(() => {});
  }

  const summaryPath = logFileBase("match_summary", "json");
  await writeFile(
    summaryPath,
    JSON.stringify(
      {
        generated_at: new Date().toISOString(),
        thresholds: { STRONG, WITH_ALBUM },
        page_size: PAGE_SIZE,
        update_concurrency: UPDATE_CONCURRENCY,
        unmatched_at_start: totalUnmatched,
        enrichment_rows_scanned: cumulativeScanned,
        candidate_matches_attempted: candidateMatchesAttempted,
        updated_rows: successfulMatches,
        empty_key_rows: emptyKeys,
        no_candidate_rows: noCandidatesTotal,
        no_candidates_or_empty_keys: emptyKeys + noCandidatesTotal,
        ambiguous_rows: ambiguousMatches,
        ambiguous_csv: ambPath,
        elapsed_sec: (performance.now() - started) / 1000,
      },
      null,
      2,
    ),
    "utf8",
  );

  console.log(`match_summary=${summaryPath}`);
  console.log(`ambiguous_csv=${ambPath}`);
  console.log(
    `acoustic_match_done scanned=${cumulativeScanned} matched=${successfulMatches} ambiguous=${ambiguousMatches} candidate_attempts=${candidateMatchesAttempted}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
