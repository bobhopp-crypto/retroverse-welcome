/**
 * Batch retrieval escalation for albums that are not human-calibration tasks yet
 * (no artwork and fewer than two meaningful ranked candidates in the diagnostics join).
 *
 * Order per album: artist_only → artist_album → broad_search → loose_match → title_only (fill-native),
 * then manual queries: normalized album only, Various-Artists-style strip, subtitle strip,
 * punctuation-stripped combined term.
 *
 * Env: ITUNES_ESCALATION_LIMIT=N (default 50), ITUNES_ESCALATION_DRY_RUN=1 (print only).
 * Same requirements as `run_itunes_artwork_fill.ts` (e.g. SUPABASE_* when persisting).
 */

import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { isRetrievalDeadEndForHumanReview } from "../app/ops/review/calibration-eligibility";
import { loadReviewDataAndStats, type ReviewRow } from "../app/ops/review/load-review-data";
import { normalizeAlbumForItunesQuery, normalizeArtistForItunesQuery } from "./lib/itunes-query-normalize";

const execFileAsync = promisify(execFile);

function dedupeNewestFirst(all: ReviewRow[]): ReviewRow[] {
  const byKey = new Map<string, ReviewRow>();
  for (const row of all) {
    const k = `${row.billboardArtist}\n${row.billboardAlbum}`;
    const prev = byKey.get(k);
    if (!prev || row.rowIndex > prev.rowIndex) byKey.set(k, row);
  }
  return [...byKey.values()].sort((a, b) => b.rowIndex - a.rowIndex);
}

type Strat =
  | {
      kind: "strategy";
      id: "artist_only" | "artist_album" | "broad_search" | "loose_match" | "title_only" | "ignore_year";
    }
  | { kind: "manual"; query: string };

function buildEscalationSteps(artist: string, album: string): Strat[] {
  const a = artist.trim();
  const b = album.trim();
  const combined = `${normalizeArtistForItunesQuery(a)} ${normalizeAlbumForItunesQuery(b)}`.replace(/\s+/g, " ").trim();
  const albumNorm = normalizeAlbumForItunesQuery(b);
  const stripSubtitle = b.replace(/\s*[\(\[].*$/u, "").trim();
  const stripPunct = combined.replace(/[^\p{L}\p{N}\s'-]+/gu, " ").replace(/\s+/g, " ").trim();
  const withoutVarious =
    /^various artists$/i.test(a) || /^soundtrack$/i.test(a)
      ? albumNorm
      : `${normalizeArtistForItunesQuery(a.replace(/^various artists$/i, "").trim() || a)} ${albumNorm}`
          .replace(/\s+/g, " ")
          .trim();

  return [
    { kind: "strategy", id: "artist_only" },
    { kind: "strategy", id: "artist_album" },
    { kind: "strategy", id: "broad_search" },
    { kind: "strategy", id: "loose_match" },
    { kind: "strategy", id: "ignore_year" },
    { kind: "strategy", id: "title_only" },
    { kind: "manual", query: albumNorm },
    { kind: "manual", query: withoutVarious },
    { kind: "manual", query: stripSubtitle || albumNorm },
    { kind: "manual", query: stripPunct || albumNorm },
  ];
}

async function runFill(artist: string, album: string, step: Strat): Promise<{ ok: boolean; log: string }> {
  const env: Record<string, string | undefined> = {
    ...process.env,
    ITUNES_FILL_LIMIT: "1",
    ITUNES_FILL_FORCE_REVIEW: `${artist}\t${album}`,
  };
  delete env.ITUNES_FILL_CALIBRATION_STRATEGY;
  delete env.ITUNES_FILL_OVERRIDE_QUERY;
  if (step.kind === "manual") {
    env.ITUNES_FILL_OVERRIDE_QUERY = step.query;
  } else {
    env.ITUNES_FILL_CALIBRATION_STRATEGY = step.id;
  }
  try {
    const { stdout, stderr } = await execFileAsync("npx", ["tsx", "scripts/run_itunes_artwork_fill.ts"], {
      cwd: process.cwd(),
      env: env as NodeJS.ProcessEnv,
      maxBuffer: 24 * 1024 * 1024,
      timeout: 180_000,
    });
    return { ok: true, log: [stdout?.trim(), stderr?.trim()].filter(Boolean).join("\n") };
  } catch (e) {
    const err = e as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      log: [err.message, err.stdout?.trim(), err.stderr?.trim()].filter(Boolean).join("\n"),
    };
  }
}

function reloadRow(artist: string, album: string) {
  const { rows } = loadReviewDataAndStats();
  const d = dedupeNewestFirst(rows);
  return d.find((r) => r.billboardArtist === artist && r.billboardAlbum === album) ?? null;
}

async function main() {
  const dry = process.env.ITUNES_ESCALATION_DRY_RUN === "1";
  const limitRaw = process.env.ITUNES_ESCALATION_LIMIT?.trim();
  const limitN = limitRaw ? parseInt(limitRaw, 10) : 50;
  const limit = Number.isFinite(limitN) ? Math.max(1, limitN) : 50;

  const { rows } = loadReviewDataAndStats();
  const deduped = dedupeNewestFirst(rows);
  const dead = deduped.filter(isRetrievalDeadEndForHumanReview).slice(0, limit);

  console.log(`escalation: ${dead.length} retrieval dead-end album(s) (cap ${limit})`);
  if (dead.length === 0) return;

  for (const row of dead) {
    const artist = row.billboardArtist;
    const album = row.billboardAlbum;
    console.log(`\n--- ${artist} / ${album}`);
    if (dry) {
      console.log(
        "  steps:",
        buildEscalationSteps(artist, album).map((s) => (s.kind === "manual" ? `m:${s.query}` : s.id)),
      );
      continue;
    }
    for (const step of buildEscalationSteps(artist, album)) {
      const label = step.kind === "manual" ? `manual:${step.query.slice(0, 72)}` : step.id;
      process.stdout.write(`  try ${label} ... `);
      const r = await runFill(artist, album, step);
      if (!r.ok) {
        console.log(`FAIL\n${r.log}`);
        continue;
      }
      const again = reloadRow(artist, album);
      if (again && !isRetrievalDeadEndForHumanReview(again)) {
        console.log("recovered");
        break;
      }
      console.log("still dead-end");
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
