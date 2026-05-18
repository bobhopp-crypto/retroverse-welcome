import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { RELATIONSHIP_WORKSPACE_DECISIONS_PATH } from "./constants";

export type RelationshipWorkspaceAction =
  | "link"
  | "reject"
  | "mark_same_track"
  | "mark_alt_version"
  | "mark_live_version"
  | "mark_needs_review";

export type RelationshipWorkspaceDecision = {
  at: string;
  action: RelationshipWorkspaceAction;
  artist: string;
  title: string;
  retroverseTrackId?: string | null;
  vdjPath?: string;
  r2Url?: string;
  note?: string;
};

type DecisionStore = { decisions: RelationshipWorkspaceDecision[] };

function decisionsAbs(): string {
  return path.isAbsolute(RELATIONSHIP_WORKSPACE_DECISIONS_PATH)
    ? RELATIONSHIP_WORKSPACE_DECISIONS_PATH
    : path.join(process.cwd(), RELATIONSHIP_WORKSPACE_DECISIONS_PATH);
}

async function readStore(): Promise<DecisionStore> {
  try {
    const raw = await readFile(decisionsAbs(), "utf8");
    const parsed = JSON.parse(raw) as DecisionStore;
    if (parsed?.decisions && Array.isArray(parsed.decisions)) return parsed;
  } catch {
    /* new */
  }
  return { decisions: [] };
}

export async function appendRelationshipWorkspaceDecision(
  decision: Omit<RelationshipWorkspaceDecision, "at">,
): Promise<void> {
  const abs = decisionsAbs();
  await mkdir(path.dirname(abs), { recursive: true });
  const store = await readStore();
  store.decisions.push({ ...decision, at: new Date().toISOString() });
  await writeFile(abs, JSON.stringify(store, null, 2), "utf8");
}
