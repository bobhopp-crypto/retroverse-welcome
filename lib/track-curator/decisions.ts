import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { TRACK_CURATOR_DECISIONS_PATH } from "./constants";

export type TrackCuratorAction =
  | "accept"
  | "reject"
  | "mark_live"
  | "mark_alt"
  | "split"
  | "merge";

export type TrackCuratorDecision = {
  at: string;
  action: TrackCuratorAction;
  retroverseTrackId: string | null;
  artist: string;
  title: string;
  filePath?: string;
  note?: string;
};

type DecisionStore = {
  decisions: TrackCuratorDecision[];
};

async function readStore(): Promise<DecisionStore> {
  const abs = path.isAbsolute(TRACK_CURATOR_DECISIONS_PATH)
    ? TRACK_CURATOR_DECISIONS_PATH
    : path.join(process.cwd(), TRACK_CURATOR_DECISIONS_PATH);
  try {
    const raw = await readFile(abs, "utf8");
    const parsed = JSON.parse(raw) as DecisionStore;
    if (parsed && Array.isArray(parsed.decisions)) return parsed;
  } catch {
    /* new store */
  }
  return { decisions: [] };
}

export async function appendTrackCuratorDecision(
  decision: Omit<TrackCuratorDecision, "at">,
): Promise<void> {
  const abs = path.isAbsolute(TRACK_CURATOR_DECISIONS_PATH)
    ? TRACK_CURATOR_DECISIONS_PATH
    : path.join(process.cwd(), TRACK_CURATOR_DECISIONS_PATH);
  await mkdir(path.dirname(abs), { recursive: true });
  const store = await readStore();
  store.decisions.push({ ...decision, at: new Date().toISOString() });
  await writeFile(abs, JSON.stringify(store, null, 2), "utf8");
}
