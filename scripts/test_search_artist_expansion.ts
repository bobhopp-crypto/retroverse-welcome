/**
 * Local artist-first search expansion check.
 * Run: HOME_SEARCH_TIMING=1 node --env-file=.env.local --import tsx scripts/test_search_artist_expansion.ts
 */
import { runHomeSearch } from "@/lib/home-search";

const ARTISTS = [
  "Fleetwood Mac",
  "Eagles",
  "Madonna",
  "Elton John",
  "Bruce Springsteen",
  "Prince",
];

async function main() {
  for (const q of ARTISTS) {
    const t0 = performance.now();
    const payload = await runHomeSearch(q);
    const ms = Math.round(performance.now() - t0);
    const topAlbums = payload.albums.slice(0, 6).map((a) => `${a.title} (${a.year ?? "?"})`);
    const topTracks = payload.tracks.slice(0, 8).map((t) => `${t.title} — ${t.subtitle ?? ""}`);
    const charts = payload.charts.slice(0, 4).map((c) => c.label);
    console.log("\n===", q, `=== ${ms}ms`);
    console.log("albums:", topAlbums.join(" | "));
    console.log("tracks:", topTracks.join(" | "));
    console.log("charts:", charts.join(" | "));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
