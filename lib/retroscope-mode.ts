/** RetroScope entity layer (same grid physics, different payload). */
export type RetroscopeMode = "album" | "artist" | "track";

export type RetroscopePersistScope = RetroscopeMode;

export function retroscopeRouteForMode(mode: RetroscopeMode): string {
  if (mode === "artist") return "/artist-retroscope";
  if (mode === "track") return "/track-retroscope";
  return "/album-retroscope";
}

export function retroscopeModeFromPath(pathname: string): RetroscopeMode {
  if (pathname.startsWith("/artist-retroscope")) return "artist";
  if (pathname.startsWith("/track-retroscope")) return "track";
  return "album";
}

export function retroscopeStorageKeys(scope: RetroscopePersistScope): {
  session: string;
  explored: string;
} {
  if (scope === "artist") {
    return {
      session: "retroverse:artist-retroscope:v1",
      explored: "retroverse:artist-retroscope:explored:v1",
    };
  }
  if (scope === "track") {
    return {
      session: "retroverse:track-retroscope:v1",
      explored: "retroverse:track-retroscope:explored:v1",
    };
  }
  return {
    session: "retroverse:album-retroscope:v1",
    explored: "retroverse:album-retroscope:explored:v1",
  };
}

/** Display label for artist-layer rank (grid still uses numeric rank). */
export function retroscopeArtistRankLabel(rank: number): string {
  return `A${rank}`;
}

/** Display label for track-layer rank (placeholder). */
export function retroscopeTrackRankLabel(rank: number): string {
  return `T${rank}`;
}

/** Human readout for year strip / meta (album + artist use chart rank `#n`). */
export function retroscopeRankDisplayLabel(rank: number, mode: RetroscopeMode): string {
  if (mode === "track") return retroscopeTrackRankLabel(rank);
  return `#${rank}`;
}
