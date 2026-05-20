import type { DossierTrackRow } from "@/lib/album-dossier-display-tracks";

/** Row emphasis tier from Retroverse dial (0–100); no visible ranks. */
export type AlbumSignalHeatTier = "none" | "warm" | "strong" | "peak";

export type AlbumTrackSignalPresentation = {
  heatTier: AlbumSignalHeatTier;
};

/** Absolute dial bands — editorial row emphasis only. */
function heatTierFromDial(dial: number): AlbumSignalHeatTier {
  if (!Number.isFinite(dial) || dial < 50) return "none";
  if (dial < 70) return "warm";
  if (dial < 85) return "strong";
  return "peak";
}

export function buildAlbumTrackSignalPresentation(
  rows: DossierTrackRow[],
): AlbumTrackSignalPresentation[] {
  return rows.map((row) => ({
    heatTier: heatTierFromDial(row.retroverseDial),
  }));
}
