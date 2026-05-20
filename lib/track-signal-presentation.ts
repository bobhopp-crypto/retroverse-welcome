import type { DossierTrackRow } from "@/lib/album-dossier-display-tracks";

export type AlbumSignalHeatTier = "peak" | "high" | "mid" | "low" | "dim" | "none";

export type AlbumTrackSignalPresentation = {
  /** 1 = strongest signal on this album (LP order unchanged). */
  signalRank: number | null;
  heatTier: AlbumSignalHeatTier;
};

function heatTierFromDial(dial: number, min: number, max: number): AlbumSignalHeatTier {
  if (dial <= 0) return "none";
  if (max <= min) return "peak";
  const t = (dial - min) / (max - min);
  if (t >= 0.82) return "peak";
  if (t >= 0.58) return "high";
  if (t >= 0.34) return "mid";
  if (t >= 0.12) return "low";
  return "dim";
}

/** Album-internal signal ranks + heat tiers; does not reorder tracks. */
export function buildAlbumTrackSignalPresentation(
  rows: DossierTrackRow[],
): AlbumTrackSignalPresentation[] {
  const dials = rows.map((r) => (r.retroverseDial > 0 && Number.isFinite(r.retroverseDial) ? r.retroverseDial : 0));
  const scored = rows
    .map((row, index) => ({ index, dial: dials[index] ?? 0 }))
    .filter((x) => x.dial > 0)
    .sort((a, b) => b.dial - a.dial || a.index - b.index);

  const min = scored.length ? Math.min(...scored.map((s) => s.dial)) : 0;
  const max = scored.length ? Math.max(...scored.map((s) => s.dial)) : 0;

  const rankByIndex = new Map<number, number>();
  let rank = 0;
  let prev = -1;
  for (const item of scored) {
    if (item.dial !== prev) {
      rank += 1;
      prev = item.dial;
    }
    rankByIndex.set(item.index, rank);
  }

  return rows.map((row, index) => {
    const dial = dials[index] ?? 0;
    const signalRank = rankByIndex.get(index) ?? null;
    return {
      signalRank,
      heatTier: heatTierFromDial(dial, min, max),
    };
  });
}
