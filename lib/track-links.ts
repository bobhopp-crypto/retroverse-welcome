import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { chartTrackLinkKey } from "@/lib/track-link-key";

export const TRACK_LINKS_PATH =
  process.env.TRACK_LINKS_PATH?.trim() || "data/track-links.json";

export type TrackLinkRecord = {
  chartArtist: string;
  chartTitle: string;
  chartWeek: string | null;
  chartRank: number | null;
  vdjPath: string;
  r2Url: string | null;
  at: string;
};

type TrackLinkStore = {
  links: TrackLinkRecord[];
};

function storeAbs(): string {
  return path.isAbsolute(TRACK_LINKS_PATH)
    ? TRACK_LINKS_PATH
    : path.join(process.cwd(), TRACK_LINKS_PATH);
}

export { chartTrackLinkKey } from "@/lib/track-link-key";

function normalizeRecord(raw: unknown): TrackLinkRecord | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const chartArtist = typeof o.chartArtist === "string" ? o.chartArtist.trim() : "";
  const chartTitle = typeof o.chartTitle === "string" ? o.chartTitle.trim() : "";
  const vdjPath = typeof o.vdjPath === "string" ? o.vdjPath.trim() : "";
  if (!chartArtist || !chartTitle || !vdjPath) return null;
  const chartWeek = typeof o.chartWeek === "string" ? o.chartWeek.trim() || null : null;
  const chartRankRaw = o.chartRank;
  const chartRank =
    typeof chartRankRaw === "number" && Number.isFinite(chartRankRaw)
      ? chartRankRaw
      : Number.isFinite(Number(chartRankRaw))
        ? Number(chartRankRaw)
        : null;
  const r2Url =
    typeof o.r2Url === "string" && o.r2Url.trim() ? o.r2Url.trim() : null;
  const at = typeof o.at === "string" && o.at ? o.at : new Date().toISOString();
  return { chartArtist, chartTitle, chartWeek, chartRank, vdjPath, r2Url, at };
}

async function readStore(): Promise<TrackLinkStore> {
  try {
    const raw = await readFile(storeAbs(), "utf8");
    const parsed = JSON.parse(raw) as { links?: unknown[] };
    const links: TrackLinkRecord[] = [];
    for (const row of parsed.links ?? []) {
      const rec = normalizeRecord(row);
      if (rec) links.push(rec);
    }
    return { links };
  } catch {
    return { links: [] };
  }
}

export async function readTrackLinkIndex(): Promise<Map<string, TrackLinkRecord>> {
  const store = await readStore();
  const index = new Map<string, TrackLinkRecord>();
  for (const link of store.links) {
    const key = chartTrackLinkKey(link.chartArtist, link.chartTitle);
    if (!key) continue;
    index.set(key, link);
  }
  return index;
}

export async function upsertTrackLink(
  record: Omit<TrackLinkRecord, "at">,
): Promise<TrackLinkRecord> {
  const abs = storeAbs();
  await mkdir(path.dirname(abs), { recursive: true });
  const store = await readStore();
  const key = chartTrackLinkKey(record.chartArtist, record.chartTitle);
  const entry: TrackLinkRecord = {
    ...record,
    at: new Date().toISOString(),
  };
  store.links = store.links.filter(
    (l) => chartTrackLinkKey(l.chartArtist, l.chartTitle) !== key,
  );
  store.links.push(entry);
  await writeFile(abs, JSON.stringify(store, null, 2), "utf8");
  return entry;
}
