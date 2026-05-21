/** Subtle row heat multiplier from track-level Retroverse dial (0–100). */
export function trackDialHeatMultiplier(dial: number | null | undefined): number {
  if (dial == null || !Number.isFinite(dial) || dial < 50) return 0.42;
  if (dial < 70) return 0.68;
  if (dial < 85) return 0.86;
  return 1;
}
