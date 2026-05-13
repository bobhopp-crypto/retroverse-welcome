import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { DECISIONS_FILE } from "@/app/artwork-workbench/data";

export const dynamic = "force-dynamic";

type Decision = "approve" | "reject" | "defer";

type DecisionRecord = {
  decision: Decision;
  notes: string;
  updated_at: string;
  album_id: string;
  artist: string;
  title: string;
  run_id: string;
};

async function readDecisions(): Promise<Record<string, DecisionRecord>> {
  try {
    const raw = await readFile(DECISIONS_FILE, "utf8");
    return JSON.parse(raw) as Record<string, DecisionRecord>;
  } catch {
    return {};
  }
}

export async function POST(request: Request) {
  const body = (await request.json()) as {
    runId?: string;
    albumId?: string;
    decision?: Decision;
    notes?: string;
    artist?: string;
    title?: string;
  };

  if (!body.runId || !body.albumId) {
    return NextResponse.json({ ok: false, error: "missing_run_or_album" }, { status: 400 });
  }
  if (body.decision !== "approve" && body.decision !== "reject" && body.decision !== "defer") {
    return NextResponse.json({ ok: false, error: "invalid_decision" }, { status: 400 });
  }

  const dir = path.dirname(DECISIONS_FILE);
  await mkdir(dir, { recursive: true });
  const decisions = await readDecisions();

  const key = `${body.runId}:${body.albumId}`;
  decisions[key] = {
    decision: body.decision,
    notes: body.notes ?? "",
    updated_at: new Date().toISOString(),
    album_id: body.albumId,
    artist: body.artist ?? "",
    title: body.title ?? "",
    run_id: body.runId,
  };
  await writeFile(DECISIONS_FILE, JSON.stringify(decisions, null, 2), "utf8");

  return NextResponse.json({ ok: true, key, decision: body.decision });
}
