/**
 * Ingest VirtualDJ database.xml exports into retroverse_track_instances + retroverse_track_cues.
 *
 * Prerequisite:
 *   python3 scripts/parse_virtualdj_database.py
 *
 * Env: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (or NEXT_PUBLIC_* + service role)
 */

import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { createClient } from "@supabase/supabase-js";

import { isThumbnailCue } from "../lib/vdj-database-ingest/cue-thumbnail";
import { trackCueId, trackInstanceId } from "../lib/vdj-database-ingest/ids";
import {
  buildTrackMatchIndex,
  matchVdjInstanceToTrack,
  mediaTypeFromPath,
  type CanonicalTrackMatchRow,
} from "../lib/vdj-database-ingest/match-track";
import type { RetroverseSupabase } from "../lib/retroverse-supabase";
import { parseCsvFile } from "./lib/vdj-csv";

const WORKSPACE = resolve(__dirname, "..");
const DEFAULT_TRACKS_CSV = resolve(WORKSPACE, "exports/virtualdj/virtualdj_tracks.csv");
const DEFAULT_CUES_CSV = resolve(WORKSPACE, "exports/virtualdj/virtualdj_cues.csv");
const DEFAULT_XML =
  process.env.VDJ_DATABASE_XML ??
  "/Users/bobhopp/Library/Application Support/VirtualDJ/database.xml";

const BATCH = Math.max(50, Math.min(400, Number.parseInt(process.env.VDJ_INGEST_BATCH ?? "200", 10)));
const PARSE_FIRST = process.env.VDJ_SKIP_PARSE !== "1";

function intOrNull(v: string): number | null {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? n : null;
}

function floatOrNull(v: string): number | null {
  const n = Number.parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

async function fetchCanonicalTracks(supabase: RetroverseSupabase): Promise<CanonicalTrackMatchRow[]> {
  const tracks: CanonicalTrackMatchRow[] = [];
  const pageSize = 1000;
  for (let from = 0; ; from += pageSize) {
    const { data: trackRows, error: trackErr } = await supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, canonical_title, retroverse_artist_id, release_year")
      .range(from, from + pageSize - 1);
    if (trackErr) throw trackErr;
    if (!trackRows?.length) break;

    const artistIds = [...new Set(trackRows.map((r) => r.retroverse_artist_id))];
    const { data: artists, error: artistErr } = await supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .in("retroverse_artist_id", artistIds);
    if (artistErr) throw artistErr;
    const artistName = new Map((artists ?? []).map((a) => [a.retroverse_artist_id, a.canonical_artist_name]));

    for (const row of trackRows) {
      tracks.push({
        retroverse_track_id: row.retroverse_track_id,
        canonical_title: row.canonical_title,
        artist_name: artistName.get(row.retroverse_artist_id) ?? "",
        release_year: row.release_year,
      });
    }
    if (trackRows.length < pageSize) break;
  }
  return tracks;
}

async function runParse(xmlPath: string, tracksCsv: string, cuesCsv: string): Promise<void> {
  const py = spawnSync(
    "python3",
    [
      resolve(WORKSPACE, "scripts/parse_virtualdj_database.py"),
      "--xml",
      xmlPath,
      "--out",
      tracksCsv,
      "--cues-out",
      cuesCsv,
    ],
    { cwd: WORKSPACE, encoding: "utf8" },
  );
  if (py.status !== 0) {
    console.error(py.stdout);
    console.error(py.stderr);
    throw new Error(`parse_virtualdj_database failed: ${py.status}`);
  }
  process.stdout.write(py.stdout);
}

async function main(): Promise<void> {
  const xmlPath = process.argv[2] ?? DEFAULT_XML;
  const tracksCsv = process.argv[3] ?? DEFAULT_TRACKS_CSV;
  const cuesCsv = process.argv[4] ?? DEFAULT_CUES_CSV;

  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SUPABASE_SECRET_KEY;
  if (!url || !key) {
    throw new Error("Missing SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY");
  }

  if (PARSE_FIRST) {
    console.log(`[vdj-ingest] parsing ${xmlPath}`);
    await runParse(xmlPath, tracksCsv, cuesCsv);
  }

  const trackRows = await parseCsvFile(tracksCsv);
  const cueRows = await parseCsvFile(cuesCsv);
  console.log(`[vdj-ingest] tracks=${trackRows.length} cues=${cueRows.length}`);

  const supabase = createClient(url, key, { auth: { persistSession: false } }) as RetroverseSupabase;
  const startedAt = new Date().toISOString();

  const { data: runRow, error: runErr } = await supabase
    .from("retroverse_vdj_ingest_runs")
    .insert({ source_xml_path: xmlPath, status: "running", started_at: startedAt })
    .select("ingest_run_id")
    .single();
  if (runErr) throw runErr;
  const ingestRunId = runRow.ingest_run_id as number;

  const canonicalTracks = await fetchCanonicalTracks(supabase);
  const matchIndex = buildTrackMatchIndex(canonicalTracks);
  const usedInstanceIds = new Set<string>();
  const usedCueIds = new Set<string>();

  const cuesByHash = new Map<string, typeof cueRows>();
  for (const cue of cueRows) {
    const h = cue.filepath_hash ?? "";
    if (!h) continue;
    const bucket = cuesByHash.get(h) ?? [];
    bucket.push(cue);
    cuesByHash.set(h, bucket);
  }

  let instancesUpserted = 0;
  let cuesUpserted = 0;
  let instancesMatched = 0;
  let thumbnailCues = 0;
  const touchedInstanceIds: string[] = [];

  for (let i = 0; i < trackRows.length; i += BATCH) {
    const slice = trackRows.slice(i, i + BATCH);
    const instancePayload = slice.map((row) => {
      const filepathHash = row.filepath_hash ?? "";
      const instanceId = trackInstanceId(filepathHash, usedInstanceIds);
      const duration = intOrNull(row.duration_seconds ?? "");
      const match = matchVdjInstanceToTrack(
        {
          artist_text: row.artist_text ?? "",
          title_text: row.title_text ?? "",
          duration_seconds: duration,
          file_path: row.source_path ?? "",
        },
        matchIndex,
        canonicalTracks,
      );
      if (match) instancesMatched += 1;

      let tags: Record<string, unknown> = {};
      try {
        tags = row.tags_json ? (JSON.parse(row.tags_json) as Record<string, unknown>) : {};
      } catch {
        tags = {};
      }

      return {
        track_instance_id: instanceId,
        retroverse_track_id: match?.retroverse_track_id ?? null,
        file_path: row.source_path ?? "",
        filepath_hash: filepathHash,
        file_hash: row.file_hash || null,
        media_type: row.media_type || mediaTypeFromPath(row.source_path ?? ""),
        play_count: intOrNull(row.play_count ?? ""),
        last_played: row.last_played ? new Date(row.last_played).toISOString() : null,
        vdj_song_flag: intOrNull(row.vdj_song_flag ?? ""),
        vdj_tags_flag: intOrNull(row.vdj_tags_flag ?? ""),
        bpm_raw: row.bpm_raw || null,
        musical_key: row.musical_key || null,
        duration_seconds: duration,
        comments: row.comments || null,
        tags,
        linked_cover_url: row.linked_cover_url || null,
        linked_netsearch_id: row.linked_netsearch_id || null,
        thumbnail_path: row.thumbnail_path || null,
        vdj_guid: row.vdj_guid || null,
        match_confidence: match?.match_confidence ?? null,
        match_method: match?.match_method ?? null,
        updated_at: startedAt,
      };
    });

    const { error: instUpsertErr } = await supabase
      .from("retroverse_track_instances")
      .upsert(instancePayload, { onConflict: "filepath_hash" });
    if (instUpsertErr) throw instUpsertErr;
    instancesUpserted += instancePayload.length;

    const instanceIdByHash = new Map(instancePayload.map((r) => [r.filepath_hash, r.track_instance_id]));

    const cuePayload: Array<Record<string, unknown>> = [];
    for (const row of slice) {
      const filepathHash = row.filepath_hash ?? "";
      const instanceId = instanceIdByHash.get(filepathHash);
      if (!instanceId) continue;
      touchedInstanceIds.push(instanceId);
      const cues = cuesByHash.get(filepathHash) ?? [];
      for (const cue of cues) {
        const cueNumber = intOrNull(cue.cue_number ?? "") ?? 0;
        const cueName = cue.cue_name || null;
        const isThumb =
          cue.is_thumbnail === "1" || isThumbnailCue(cueNumber, cueName ?? undefined);
        if (isThumb) thumbnailCues += 1;
        let loopData: Record<string, unknown> | null = null;
        if (cue.loop_data) {
          try {
            loopData = JSON.parse(cue.loop_data) as Record<string, unknown>;
          } catch {
            loopData = null;
          }
        }
        cuePayload.push({
          cue_id: trackCueId(filepathHash, cueNumber, usedCueIds),
          track_instance_id: instanceId,
          cue_number: cueNumber,
          cue_name: cueName,
          cue_type: cue.cue_type || "cue",
          time_position_seconds: floatOrNull(cue.time_position_seconds ?? ""),
          color: intOrNull(cue.color ?? ""),
          loop_data: loopData,
          is_thumbnail: isThumb,
          updated_at: startedAt,
        });
      }
    }

    if (cuePayload.length) {
      const { error: cueUpsertErr } = await supabase
        .from("retroverse_track_cues")
        .upsert(cuePayload, { onConflict: "track_instance_id,cue_number" });
      if (cueUpsertErr) throw cueUpsertErr;
      cuesUpserted += cuePayload.length;
    }
  }

  if (touchedInstanceIds.length) {
    const uniqueIds = [...new Set(touchedInstanceIds)];
    for (let i = 0; i < uniqueIds.length; i += BATCH) {
      const ids = uniqueIds.slice(i, i + BATCH);
      const { error: staleErr } = await supabase
        .from("retroverse_track_cues")
        .delete()
        .in("track_instance_id", ids)
        .lt("updated_at", startedAt);
      if (staleErr) throw staleErr;
    }
  }

  const { error: finishErr } = await supabase
    .from("retroverse_vdj_ingest_runs")
    .update({
      status: "completed",
      finished_at: new Date().toISOString(),
      instances_upserted: instancesUpserted,
      cues_upserted: cuesUpserted,
      instances_matched: instancesMatched,
      thumbnail_cues: thumbnailCues,
      notes: `tracks_csv=${tracksCsv}`,
    })
    .eq("ingest_run_id", ingestRunId);
  if (finishErr) throw finishErr;

  console.log(
    `[vdj-ingest] done run=${ingestRunId} instances=${instancesUpserted} matched=${instancesMatched} cues=${cuesUpserted} thumbnails=${thumbnailCues}`,
  );
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});
