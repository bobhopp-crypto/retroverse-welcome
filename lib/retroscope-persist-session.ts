import {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  retroscopeCellKey,
  type RetroscopeCellDTO,
} from "@/lib/album-retroscope-constants";
import {
  retroscopeStorageKeys,
  type RetroscopePersistScope,
} from "@/lib/retroscope-mode";

/** Active coordinate + viewport (corpus-scoped). */
export const RETROSCOPE_SESSION_STORAGE_KEY = "retroverse:album-retroscope:v1";

/** Visited/revealed coordinates — durable across corpus bumps, deploys, artwork merges. */
export const RETROSCOPE_EXPLORED_STORAGE_KEY = "retroverse:album-retroscope:explored:v1";

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

type RetroscopeExploredStoreV1 = {
  version: 1;
  keys: string[];
  savedAt: number;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Stable corpus id from materialized runtime metadata (not a hash of every cell). */
export function retroscopeDatasetCorpusId(meta: {
  source: string;
  version?: number;
  generatedAt?: string;
  cellCount?: number;
}): string {
  const v = meta.version ?? 1;
  const src = meta.source.trim() || "unknown";
  const gen = meta.generatedAt?.trim() || "unknown";
  const n = Number.isFinite(meta.cellCount) ? Math.round(meta.cellCount!) : 0;
  return `v${v}:${src}:${gen}:n${n}`;
}

/** @deprecated Legacy fingerprint — only used to migrate old sessions. */
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

export function normalizeRetroscopeExploredKeys(keys: Iterable<string>): string[] {
  const out = new Set<string>();
  for (const raw of keys) {
    if (typeof raw !== "string") continue;
    const k = raw.trim();
    if (isValidRetroscopeCoordKey(k)) out.add(k);
  }
  return [...out].sort();
}

export function mergeRetroscopeExploredKeys(
  base: Iterable<string>,
  added: Iterable<string>,
): string[] {
  const out = new Set<string>();
  for (const k of normalizeRetroscopeExploredKeys(base)) out.add(k);
  for (const k of normalizeRetroscopeExploredKeys(added)) out.add(k);
  return [...out].sort();
}

function readLegacySessionExploredKeys(scope: RetroscopePersistScope = "album"): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(retroscopeStorageKeys(scope).session);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as Partial<RetroscopePersistedSessionV1>;
    if (!Array.isArray(parsed.exploredKeys)) return [];
    return normalizeRetroscopeExploredKeys(parsed.exploredKeys);
  } catch {
    return [];
  }
}

/** Load all visited coordinate keys (survives corpus / deploy changes). */
export function loadRetroscopeExploredKeys(scope: RetroscopePersistScope = "album"): string[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(retroscopeStorageKeys(scope).explored);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<RetroscopeExploredStoreV1>;
      if (parsed.version === 1 && Array.isArray(parsed.keys)) {
        return normalizeRetroscopeExploredKeys(parsed.keys);
      }
    }
  } catch {
    /* fall through to legacy */
  }
  return readLegacySessionExploredKeys(scope);
}

export function saveRetroscopeExploredKeys(
  keys: Iterable<string>,
  scope: RetroscopePersistScope = "album",
): void {
  if (typeof window === "undefined") return;
  try {
    const merged = mergeRetroscopeExploredKeys(loadRetroscopeExploredKeys(scope), keys);
    const out: RetroscopeExploredStoreV1 = {
      version: 1,
      keys: merged,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(retroscopeStorageKeys(scope).explored, JSON.stringify(out));
  } catch {
    /* quota / private mode */
  }
}

/** Grid indices where the tuned selection sits (fixed reticle / playhead lock). */
export function retroscopeViewportFocusIndices(visibleGridRows: number): {
  yearCol: number;
  rankRow: number;
} {
  const rows = clamp(
    Number.isFinite(visibleGridRows) && visibleGridRows > 0
      ? Math.round(visibleGridRows)
      : RETROSCOPE_GRID_ROWS,
    1,
    RETROSCOPE_RANK_MAX,
  );
  return {
    yearCol: Math.floor((RETROSCOPE_GRID_COLS - 1) / 2),
    rankRow: Math.floor((rows - 1) / 2),
  };
}

/**
 * Keep the active coordinate under the center reticle — the world scrolls, not the lock point.
 * Legacy viewYear0/viewRank0 args are ignored (included only for call-site compatibility).
 */
export function centerViewportOnSelection(opts: {
  activeYear: number;
  activeRank: number;
  visibleGridRows: number;
  viewYear0?: number;
  viewRank0?: number;
}): { viewYear0: number; viewRank0: number } {
  const visibleGridRows = clamp(
    Number.isFinite(opts.visibleGridRows) && opts.visibleGridRows > 0
      ? Math.round(opts.visibleGridRows)
      : RETROSCOPE_GRID_ROWS,
    1,
    RETROSCOPE_RANK_MAX,
  );
  const { yearCol, rankRow } = retroscopeViewportFocusIndices(visibleGridRows);
  const ynn = clamp(Math.round(opts.activeYear), RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX);
  const rnn = clamp(Math.round(opts.activeRank), 1, RETROSCOPE_RANK_MAX);

  const viewYear0 = clamp(
    ynn - yearCol,
    RETROSCOPE_WORLD_YEAR_MIN,
    RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1,
  );
  const viewRank0 = clamp(rnn - rankRow, 1, RETROSCOPE_RANK_MAX - visibleGridRows + 1);

  return { viewYear0, viewRank0 };
}

/** Pan viewport only when the active coordinate would leave the visible grid (playhead moves on arrows). */
export function panViewportToIncludeActive(opts: {
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
  const ynn = clamp(Math.round(opts.activeYear), RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX);
  const rnn = clamp(Math.round(opts.activeRank), 1, RETROSCOPE_RANK_MAX);
  let viewYear0 = clamp(
    Math.round(opts.viewYear0),
    RETROSCOPE_WORLD_YEAR_MIN,
    RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1,
  );
  let viewRank0 = clamp(Math.round(opts.viewRank0), 1, RETROSCOPE_RANK_MAX - visibleGridRows + 1);

  const activeCol = ynn - viewYear0;
  const activeRow = rnn - viewRank0;

  if (activeCol < 0) viewYear0 = ynn;
  else if (activeCol >= RETROSCOPE_GRID_COLS) viewYear0 = ynn - (RETROSCOPE_GRID_COLS - 1);

  if (activeRow < 0) viewRank0 = rnn;
  else if (activeRow >= visibleGridRows) viewRank0 = rnn - (visibleGridRows - 1);

  viewYear0 = clamp(viewYear0, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX - RETROSCOPE_GRID_COLS + 1);
  viewRank0 = clamp(viewRank0, 1, RETROSCOPE_RANK_MAX - visibleGridRows + 1);

  return { viewYear0, viewRank0 };
}

/** @deprecated Prefer `centerViewportOnSelection` — same center-lock behavior. */
export function fitViewportToIncludeCoordinate(opts: {
  activeYear: number;
  activeRank: number;
  viewYear0: number;
  viewRank0: number;
  visibleGridRows: number;
}): { viewYear0: number; viewRank0: number } {
  return centerViewportOnSelection(opts);
}

export function loadRetroscopePersistedSession(
  corpusId: string,
  scope: RetroscopePersistScope = "album",
): RetroscopePersistedSessionV1 | null {
  if (typeof window === "undefined") return null;

  const exploredKeys = loadRetroscopeExploredKeys(scope);

  try {
    const raw = window.localStorage.getItem(retroscopeStorageKeys(scope).session);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<RetroscopePersistedSessionV1>;
    if (parsed.version !== 1 || typeof parsed.corpusId !== "string") {
      return null;
    }
    /** World coordinates persist across corpus regenerations; refresh id on next save. */

    const activeYear = Math.round(Number(parsed.activeYear));
    const activeRank = Math.round(Number(parsed.activeRank));
    const viewYear0 = Math.round(Number(parsed.viewYear0));
    const viewRank0 = Math.round(Number(parsed.viewRank0));
    if (!Number.isFinite(activeYear) || !Number.isFinite(activeRank)) return null;
    if (!Number.isFinite(viewYear0) || !Number.isFinite(viewRank0)) return null;

    const activeK = retroscopeCellKey(activeYear, activeRank);
    const mergedExplored = mergeRetroscopeExploredKeys(
      exploredKeys,
      Array.isArray(parsed.exploredKeys) ? parsed.exploredKeys : [activeK],
    );

    return {
      version: 1,
      corpusId,
      activeYear: clamp(activeYear, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX),
      activeRank: clamp(activeRank, 1, RETROSCOPE_RANK_MAX),
      exploredKeys: mergedExplored,
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

export function saveRetroscopePersistedSession(
  payload: Omit<RetroscopePersistedSessionV1, "savedAt">,
  scope: RetroscopePersistScope = "album",
): void {
  if (typeof window === "undefined") return;
  try {
    const exploredKeys = mergeRetroscopeExploredKeys(payload.exploredKeys, []);
    saveRetroscopeExploredKeys(exploredKeys, scope);

    const out: RetroscopePersistedSessionV1 = {
      ...payload,
      exploredKeys,
      savedAt: Date.now(),
    };
    window.localStorage.setItem(retroscopeStorageKeys(scope).session, JSON.stringify(out));
  } catch {
    /* quota / private mode */
  }
}

/** Wipe session + explored fog-of-war for this Retroscope layer (album / artist / track). */
export function clearRetroscopePersistedState(scope: RetroscopePersistScope = "album"): void {
  if (typeof window === "undefined") return;
  try {
    const keys = retroscopeStorageKeys(scope);
    window.localStorage.removeItem(keys.session);
    window.localStorage.removeItem(keys.explored);
  } catch {
    /* private mode */
  }
}
