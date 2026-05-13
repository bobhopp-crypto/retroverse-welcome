const STORAGE_KEY = "retroverse-portal-rank-v1";
const MAX_KEYS = 12_000;

export type PortalRankSessionV1 = {
  lastYear: number;
  /** Zero-based index in the year's list (= display rank − 1). */
  lastRankIndex: number;
  appearanceKeys: string[];
};

export function portalAppearanceKey(year: number, albumId: string): string {
  const id = albumId.trim().toUpperCase();
  return `${year}::${id}`;
}

export function loadPortalRankSession(): PortalRankSessionV1 | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return null;
    const o = parsed as Record<string, unknown>;
    const lastYear = typeof o.lastYear === "number" && Number.isFinite(o.lastYear) ? o.lastYear : NaN;
    const lastRankIndex =
      typeof o.lastRankIndex === "number" && Number.isFinite(o.lastRankIndex) ? Math.floor(o.lastRankIndex) : NaN;
    const ak = o.appearanceKeys;
    if (!Number.isFinite(lastYear) || !Number.isFinite(lastRankIndex)) return null;
    if (!Array.isArray(ak)) return { lastYear, lastRankIndex, appearanceKeys: [] };
    const appearanceKeys = ak.filter((x): x is string => typeof x === "string" && x.length > 0).slice(-MAX_KEYS);
    return { lastYear, lastRankIndex, appearanceKeys };
  } catch {
    return null;
  }
}

export function savePortalRankSession(session: PortalRankSessionV1): void {
  if (typeof window === "undefined") return;
  try {
    const appearanceKeys = session.appearanceKeys.slice(-MAX_KEYS);
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        lastYear: session.lastYear,
        lastRankIndex: session.lastRankIndex,
        appearanceKeys,
      }),
    );
  } catch {
    /* no-op */
  }
}

export function clampRankIndex(idx: number, len: number): number {
  if (len <= 0) return 0;
  return Math.min(len - 1, Math.max(0, idx));
}
