import {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  retroscopeCellKey,
  type RetroscopeCellDTO,
} from "@/lib/album-retroscope-constants";

export const RETROSCOPE_SESSION_STORAGE_KEY = "retroverse:album-retroscope:v1";

export type RetroscopePersistedSessionV1 = {
  version: 1;
  corpusId: string;
  activeYear: number;
  activeRank: number;
  exploredKeys: string[];
  viewYear0: number;
  viewRank0: number;
  savedAt: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Cheap fingerprint — invalidates persisted session when corpus changes materially. */
export function retroscopeCorpusId(cells: RetroscopeCellDTO[]): string {
  if (cells.length === 0) return "empty";
  let h = cells.length >>> 0;
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i]!;
    const y = Number(c.chartYear);
    const r = Number(c.retroverseRank);
    h = (h * 33 + ((y << 16) ^ r)) >>> 0;
  }
  const k0 = retroscopeCellKey(cells[0]!.chartYear, cells[0]!.retroverseRank);
  const kl = retroscopeCellKey(cells[cells.length - 1]!.chartYear, cells[cells.length - 1]!.retroverseRank);
  return `n${cells.length}:${k0}:${kl}:${h.toString(16)}`;
}

/** World-bounds numeric coordinate key `year:rank`. */
export function isValidRetroscopeCoordKey(raw: string): boolean {
  const [a, b] = raw.split(":");
  const y = Math.round(Number(a));
  const r = Math.round(Number(b));
  if (!Number.isFinite(y) || !Number.isFinite(r)) return false;
  if (y < RETROSCOPE_WORLD_YEAR_MIN || y > RETROSCOPE_WORLD_YEAR_MAX) return false;
  if (r < 1 || r > RETROSCOPE_RANK_MAX) return false;
  return true;
}

export function fitViewportToIncludeCoordinate(opts: {
  activeYear: number;
  activeRank: number;
  viewYear0: number;
  viewRank0: number;
  visibleGridRows: number;
}): { viewYear0: number; viewRank0: number } {
  const visibleGridRows = clamp(
    Number.isFinite(opts.visibleGridRows) && opts.visibleGridRows > 0
      ? Math.round(opts.visibleGridRows)
      : RETROSCOPE_GRID_ROWS,
    1,
    RETROSCOPE_RANK_MAX,
  );

  let v0 = clamp(
    opts.viewYear0,
    RETROSCOPE_WORLD_YEAR_MIN,
    RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1,
  );
  const ynn = clamp(Math.round(opts.activeYear), RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX);
  const yMax = v0 + RETROSCOPE_GRID_COLS - 1;
  if (ynn < v0) v0 = ynn;
  else if (ynn > yMax) v0 = ynn - (RETROSCOPE_GRID_COLS - 1);
  v0 = clamp(v0, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1);

  let r0 = clamp(opts.viewRank0, 1, RETROSCOPE_RANK_MAX - visibleGridRows + 1);
  const rnn = clamp(Math.round(opts.activeRank), 1, RETROSCOPE_RANK_MAX);
  const rMaxPanel = r0 + visibleGridRows - 1;
  if (rnn < r0) r0 = rnn;
  else if (rnn > rMaxPanel) r0 = rnn - (visibleGridRows - 1);
  r0 = clamp(r0, 1, RETROSCOPE_RANK_MAX - visibleGridRows + 1);

  return { viewYear0: v0, viewRank0: r0 };
}

export function loadRetroscopePersistedSession(
  corpusId: string,
): RetroscopePersistedSessionV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(RETROSCOPE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RetroscopePersistedSessionV1>;
    if (parsed.version !== 1 || typeof parsed.corpusId !== "string" || parsed.corpusId !== corpusId) return null;

    const activeYear = Math.round(Number(parsed.activeYear));
    const activeRank = Math.round(Number(parsed.activeRank));
    const viewYear0 = Math.round(Number(parsed.viewYear0));
    const viewRank0 = Math.round(Number(parsed.viewRank0));
    if (!Number.isFinite(activeYear) || !Number.isFinite(activeRank)) return null;
    if (!Number.isFinite(viewYear0) || !Number.isFinite(viewRank0)) return null;

    const exploredKeys = Array.isArray(parsed.exploredKeys)
      ? [...new Set(parsed.exploredKeys.filter((x) => typeof x === "string" && isValidRetroscopeCoordKey(x)))]
      : [];

    const activeK = retroscopeCellKey(activeYear, activeRank);
    if (!exploredKeys.includes(activeK)) exploredKeys.push(activeK);

    return {
      version: 1,
      corpusId,
      activeYear: clamp(activeYear, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX),
      activeRank: clamp(activeRank, 1, RETROSCOPE_RANK_MAX),
      exploredKeys,
      viewYear0: clamp(
        viewYear0,
        RETROSCOPE_WORLD_YEAR_MIN,
        RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1,
      ),
      viewRank0: clamp(viewRank0, 1, RETROSCOPE_RANK_MAX),
      savedAt:
        typeof parsed.savedAt === "number" && Number.isFinite(parsed.savedAt)
          ? parsed.savedAt
          : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveRetroscopePersistedSession(payload: Omit<RetroscopePersistedSessionV1, "savedAt">): void {
  if (typeof window === "undefined") return;
  try {
    const out: RetroscopePersistedSessionV1 = {
      ...payload,
      exploredKeys: [...new Set(payload.exploredKeys)].sort(),
      savedAt: Date.now(),
    };
    window.localStorage.setItem(RETROSCOPE_SESSION_STORAGE_KEY, JSON.stringify(out));
  } catch {
    /* quota / private mode */
  }
}
