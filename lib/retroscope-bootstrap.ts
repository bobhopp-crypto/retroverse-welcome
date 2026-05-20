import {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  RETROSCOPE_YEAR_MAX,
  RETROSCOPE_YEAR_MIN,
  retroscopeCellKey,
  type RetroscopeCellDTO,
} from "@/lib/album-retroscope-constants";
import { retroscopeStorageKeys, type RetroscopePersistScope } from "@/lib/retroscope-mode";
import {
  defaultViewportOrigin,
  ensureViewportIncludesSelection,
  isValidRetroscopeCoordKey,
  loadRetroscopeExploredKeys,
  loadRetroscopePersistedSession,
  mergeRetroscopeExploredKeys,
  saveRetroscopeExploredKeys,
  saveRetroscopePersistedSession,
} from "@/lib/retroscope-persist-session";

export type RetroscopeBootstrapSource =
  | "persisted_session"
  | "explored_fallback"
  | "initial_active_key"
  | "random_first_visit"
  | "ssr_placeholder";

export type RetroscopeBootstrapResult = {
  activeYear: number;
  activeRank: number;
  viewYear0: number;
  viewRank0: number;
  exploredKeys: string[];
  source: RetroscopeBootstrapSource;
  randomized: boolean;
  restoredFromPersist: boolean;
  corpusIdMismatch: boolean;
};

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

export function parseRetroscopeCoordKey(key: string): { y: number; r: number } {
  const [a, b] = key.split(":");
  const y = Math.round(Number(a));
  const r = Math.round(Number(b));
  if (!Number.isFinite(y) || !Number.isFinite(r)) {
    return { y: RETROSCOPE_WORLD_YEAR_MIN, r: 1 };
  }
  return {
    y: clamp(y, RETROSCOPE_WORLD_YEAR_MIN, RETROSCOPE_WORLD_YEAR_MAX),
    r: clamp(r, 1, RETROSCOPE_RANK_MAX),
  };
}

function cellKeySet(cells: RetroscopeCellDTO[]): Set<string> {
  const out = new Set<string>();
  for (const c of cells) {
    if (!Number.isFinite(c.chartYear) || !Number.isFinite(c.retroverseRank)) continue;
    out.add(retroscopeCellKey(c.chartYear, c.retroverseRank));
  }
  return out;
}

/** First visit only: random top-5 cell in billboard core band. */
export function randomFirstVisitBootstrap(
  cells: RetroscopeCellDTO[],
  rnd: () => number = () => Math.random(),
): { y: number; r: number } {
  const band = cells.filter(
    (c) =>
      c.chartYear >= RETROSCOPE_YEAR_MIN &&
      c.chartYear <= RETROSCOPE_YEAR_MAX &&
      Number.isFinite(c.retroverseRank) &&
      c.retroverseRank >= 1 &&
      c.retroverseRank <= 5,
  );
  if (band.length > 0) {
    const pick = band[Math.floor(rnd() * band.length)]!;
    return { y: pick.chartYear, r: pick.retroverseRank };
  }
  const sorted = [...cells].sort((a, b) =>
    a.chartYear !== b.chartYear ? a.chartYear - b.chartYear : a.retroverseRank - b.retroverseRank,
  );
  const head = sorted[0];
  if (head) return { y: head.chartYear, r: head.retroverseRank };
  return { y: RETROSCOPE_WORLD_YEAR_MIN, r: 1 };
}

function coordinateFromExploredFallback(
  explored: string[],
  initialActiveKey: string,
  keys: Set<string>,
): { y: number; r: number } {
  if (isValidRetroscopeCoordKey(initialActiveKey) && keys.has(initialActiveKey)) {
    return parseRetroscopeCoordKey(initialActiveKey);
  }
  for (let i = explored.length - 1; i >= 0; i--) {
    const k = explored[i]!;
    if (keys.has(k)) return parseRetroscopeCoordKey(k);
  }
  return parseRetroscopeCoordKey(initialActiveKey);
}

function fittedViewport(
  activeYear: number,
  activeRank: number,
  visibleGridRows: number,
  prior?: { viewYear0: number; viewRank0: number },
) {
  if (prior) {
    return ensureViewportIncludesSelection({
      activeYear,
      activeRank,
      viewYear0: prior.viewYear0,
      viewRank0: prior.viewRank0,
      visibleGridRows,
    });
  }
  return defaultViewportOrigin(activeYear, activeRank, visibleGridRows);
}

function logBootstrap(scope: RetroscopePersistScope, detail: Record<string, unknown>) {
  if (process.env.NODE_ENV === "production") return;
  console.info("[retroscope:init]", { scope, ...detail });
}

/**
 * Single canonical RetroScope coordinate bootstrap.
 * Randomizes only when there is no persisted session and no explored history (first visit).
 */
export function resolveRetroscopeBootstrap(opts: {
  scope: RetroscopePersistScope;
  corpusId: string;
  cells: RetroscopeCellDTO[];
  initialActiveKey: string;
  visibleGridRows: number;
}): RetroscopeBootstrapResult {
  const { scope, corpusId, cells, initialActiveKey, visibleGridRows } = opts;
  const gridRows = clamp(
    Number.isFinite(visibleGridRows) && visibleGridRows > 0
      ? Math.round(visibleGridRows)
      : RETROSCOPE_GRID_ROWS,
    1,
    RETROSCOPE_RANK_MAX,
  );
  const keys = cellKeySet(cells);
  const parsedInitial = parseRetroscopeCoordKey(initialActiveKey);

  if (typeof window === "undefined") {
    const fitted = fittedViewport(parsedInitial.y, parsedInitial.r, gridRows);
    const activeK = retroscopeCellKey(parsedInitial.y, parsedInitial.r);
    return {
      activeYear: parsedInitial.y,
      activeRank: parsedInitial.r,
      viewYear0: fitted.viewYear0,
      viewRank0: fitted.viewRank0,
      exploredKeys: [activeK],
      source: "ssr_placeholder",
      randomized: false,
      restoredFromPersist: false,
      corpusIdMismatch: false,
    };
  }

  const storedExplored = loadRetroscopeExploredKeys(scope);
  const saved = loadRetroscopePersistedSession(corpusId, scope);
  let storedCorpusId: string | null = null;
  try {
    const raw = window.localStorage.getItem(retroscopeStorageKeys(scope).session);
    if (raw) {
      const parsed = JSON.parse(raw) as { corpusId?: string };
      if (typeof parsed.corpusId === "string") storedCorpusId = parsed.corpusId;
    }
  } catch {
    /* ignore */
  }
  const corpusIdMismatch = Boolean(saved && storedCorpusId && storedCorpusId !== corpusId);

  if (saved) {
    const ay = saved.activeYear;
    const ar = saved.activeRank;
    const fitted = fittedViewport(ay, ar, gridRows, {
      viewYear0: saved.viewYear0,
      viewRank0: saved.viewRank0,
    });
    const exploredKeys = mergeRetroscopeExploredKeys(storedExplored, saved.exploredKeys);
    saveRetroscopeExploredKeys(exploredKeys, scope);
    const result: RetroscopeBootstrapResult = {
      activeYear: ay,
      activeRank: ar,
      viewYear0: fitted.viewYear0,
      viewRank0: fitted.viewRank0,
      exploredKeys,
      source: "persisted_session",
      randomized: false,
      restoredFromPersist: true,
      corpusIdMismatch,
    };
    logBootstrap(scope, {
      source: result.source,
      randomized: false,
      activeKey: retroscopeCellKey(ay, ar),
      corpusId,
      savedCorpusId: saved.corpusId,
      corpusIdMismatch,
      exploredCount: exploredKeys.length,
    });
    return result;
  }

  const isFirstVisit = storedExplored.length === 0;

  if (isFirstVisit) {
    const { y, r } = randomFirstVisitBootstrap(cells);
    const fitted = fittedViewport(y, r, gridRows);
    const exploredKeys = mergeRetroscopeExploredKeys(storedExplored, [retroscopeCellKey(y, r)]);
    saveRetroscopeExploredKeys(exploredKeys, scope);
    saveRetroscopePersistedSession(
      {
        version: 1,
        corpusId,
        activeYear: y,
        activeRank: r,
        exploredKeys,
        viewYear0: fitted.viewYear0,
        viewRank0: fitted.viewRank0,
      },
      scope,
    );
    const result: RetroscopeBootstrapResult = {
      activeYear: y,
      activeRank: r,
      viewYear0: fitted.viewYear0,
      viewRank0: fitted.viewRank0,
      exploredKeys,
      source: "random_first_visit",
      randomized: true,
      restoredFromPersist: false,
      corpusIdMismatch: false,
    };
    logBootstrap(scope, {
      source: result.source,
      randomized: true,
      activeKey: retroscopeCellKey(y, r),
      corpusId,
    });
    return result;
  }

  const { y, r } = coordinateFromExploredFallback(storedExplored, initialActiveKey, keys);
  const fitted = fittedViewport(y, r, gridRows);
  const exploredKeys = mergeRetroscopeExploredKeys(storedExplored, [retroscopeCellKey(y, r)]);
  saveRetroscopeExploredKeys(exploredKeys, scope);
  saveRetroscopePersistedSession(
    {
      version: 1,
      corpusId,
      activeYear: y,
      activeRank: r,
      exploredKeys,
      viewYear0: fitted.viewYear0,
      viewRank0: fitted.viewRank0,
    },
    scope,
  );
  const result: RetroscopeBootstrapResult = {
    activeYear: y,
    activeRank: r,
    viewYear0: fitted.viewYear0,
    viewRank0: fitted.viewRank0,
    exploredKeys,
    source: storedExplored.length > 0 ? "explored_fallback" : "initial_active_key",
    randomized: false,
    restoredFromPersist: false,
    corpusIdMismatch: false,
  };
  logBootstrap(scope, {
    source: result.source,
    randomized: false,
    activeKey: retroscopeCellKey(y, r),
    corpusId,
    exploredCount: exploredKeys.length,
  });
  return result;
}
