import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/** Persisted marks only; missing album id = unseen */
export type DiscoverReviewMark = "reviewed" | "fixed" | "hidden" | "skipped";

const FILE_NAME = "discover_review_state.json";

export function discoverReviewStatePath(): string {
  return path.join(process.cwd(), "data", FILE_NAME);
}

export async function loadDiscoverReviewMap(): Promise<Record<string, DiscoverReviewMark>> {
  const filePath = discoverReviewStatePath();
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    return parsed as Record<string, DiscoverReviewMark>;
  } catch {
    return {};
  }
}

export function isDiscoverReviewMark(v: string): v is DiscoverReviewMark {
  return v === "reviewed" || v === "fixed" || v === "hidden" || v === "skipped";
}

/** Rank for sort: lower = sooner in Discover. unseen (no entry) = 0 */
export function discoverReviewSortRank(mark: DiscoverReviewMark | undefined): number {
  if (!mark) return 0;
  if (mark === "skipped") return 1;
  if (mark === "reviewed") return 2;
  return 0;
}

/** Remove ids suppressed by server-side Discover review map (curator file). */
export function discoverReviewMapFilterIds(
  albumIds: string[],
  reviewMap: Record<string, DiscoverReviewMark>,
): string[] {
  return albumIds.filter((id) => {
    const m = reviewMap[id];
    return m !== "hidden" && m !== "fixed";
  });
}

export async function upsertDiscoverReviewMark(albumId: string, mark: DiscoverReviewMark): Promise<void> {
  const dir = path.join(process.cwd(), "data");
  await mkdir(dir, { recursive: true });
  const filePath = discoverReviewStatePath();
  const map = await loadDiscoverReviewMap();
  map[albumId] = mark;
  await writeFile(filePath, `${JSON.stringify(map, null, 2)}\n`, "utf8");
}
