import path from "node:path";

/** Billboard Hot 100 chart universe (event / work / VDJ bridge). */
export const DEFAULT_HOT100_SQLITE =
  "/Users/bobhopp/RETROVERSE_DATA/databases/billboard-hot-100.db";

export function hot100SqlitePath(): string {
  const raw = process.env.HOT100_SQLITE_PATH?.trim();
  if (!raw) return DEFAULT_HOT100_SQLITE;
  return path.isAbsolute(raw) ? raw : path.join(process.cwd(), raw);
}

export const HOT100_SOURCE_SYSTEM = "RVA-HOT100";
