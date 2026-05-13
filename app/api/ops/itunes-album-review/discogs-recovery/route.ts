import { appendFile, mkdir } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  appendCalibrationLearning,
  getRowState,
  upsertRowState,
} from "@/app/ops/itunes-album-review/calibration-state";
import { sniffDiscogsReleaseHtml } from "@/app/ops/review/discogs-sniff";

const LOG_DIR = path.join(process.cwd(), "data", "diagnostics", "itunes");
const RECOVERY_LOG = path.join(LOG_DIR, "discogs_human_recovery.jsonl");

function allowedDiscogsUrl(raw: string): URL | null {
  try {
    const u = new URL(raw.trim());
    if (u.protocol !== "https:" && u.protocol !== "http:") return null;
    const h = u.hostname.toLowerCase();
    if (h !== "www.discogs.com" && h !== "discogs.com") return null;
    return u;
  } catch {
    return null;
  }
}

type Body = {
  url?: string;
  billboardArtist?: string;
  billboardAlbum?: string;
  chartYear?: number;
  rowId?: string;
  workflowTier?: "easy" | "calibration" | "hard";
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const url = body.url?.trim();
  if (!url) {
    return NextResponse.json({ error: "url required" }, { status: 400 });
  }
  const parsed = allowedDiscogsUrl(url);
  if (!parsed) {
    return NextResponse.json({ error: "only https://www.discogs.com/... URLs allowed" }, { status: 400 });
  }

  let html: string;
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), 18_000);
  try {
    const res = await fetch(parsed.toString(), {
      signal: ac.signal,
      headers: {
        Accept: "text/html",
        "User-Agent": "RetroverseCalibrationWorkstation/1.0 (+local)",
      },
    });
    if (!res.ok) {
      return NextResponse.json({ error: `Discogs HTTP ${res.status}` }, { status: 502 });
    }
    html = await res.text();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `fetch failed: ${msg}` }, { status: 502 });
  } finally {
    clearTimeout(t);
  }

  const sniff = sniffDiscogsReleaseHtml(html, parsed.toString());

  await mkdir(LOG_DIR, { recursive: true });
  const line =
    JSON.stringify({
      ts: new Date().toISOString(),
      kind: "human_confirmed_recovery",
      workflow: "discogs_url_paste",
      discogsUrl: parsed.toString(),
      billboardArtist: body.billboardArtist ?? "",
      billboardAlbum: body.billboardAlbum ?? "",
      chartYear: body.chartYear ?? null,
      rowId: body.rowId ?? null,
      extracted: sniff,
    }) + "\n";

  await appendFile(RECOVERY_LOG, line, "utf8");

  const artist = (body.billboardArtist ?? "").trim();
  const album = (body.billboardAlbum ?? "").trim();
  if (artist && album) {
    const prior = await getRowState(artist, album);
    const wf = body.workflowTier === "calibration" || body.workflowTier === "hard" ? body.workflowTier : "easy";
    await upsertRowState(artist, album, {
      state: "MANUAL_RESOLVED",
      discogs: { url: parsed.toString(), extracted: sniff, savedAt: new Date().toISOString() },
    });
    await appendCalibrationLearning({
      ts: new Date().toISOString(),
      kind: "discogs_save",
      billboardArtist: artist,
      billboardAlbum: album,
      chartYear: body.chartYear ?? null,
      workflowTier: wf,
      retryStage: prior.escalationStage,
      strategyUsed: null,
      matchScore: null,
      artistSimilarity: null,
      albumSimilarity: null,
      tokenOverlap: null,
      yearDistance: null,
      alternateSelected: false,
      pipelineRejectionReason: "",
      reviewBucket: "",
      queueStateAfter: "MANUAL_RESOLVED",
    });
  }

  return NextResponse.json({
    ok: true,
    logPath: "data/diagnostics/itunes/discogs_human_recovery.jsonl",
    extracted: sniff,
  });
}
