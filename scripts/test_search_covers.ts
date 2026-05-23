import { attachCoverUrlsToSearchPayload } from "@/lib/home-search/attach-cover-urls";
import { runHomeSearch } from "@/lib/home-search";

async function main() {
  process.env.HOME_SEARCH_TIMING = "1";
  const sample = await attachCoverUrlsToSearchPayload({
    ok: true,
    q: "sample",
    albums: [
      {
        kind: "album",
        title: "Sample",
        artist: "Sample",
        year: 1984,
        href: "/albums/RVAL408433",
      },
    ],
    tracks: [],
    artists: [],
    charts: [],
  });
  console.log("sample cover:", sample.albums[0]?.coverUrl);

  for (const q of ["Madonna", "Eagles", "Fleetwood Mac", "Prince"]) {
    const r = await runHomeSearch(q);
    console.log(`\n--- ${q} ---`);
    for (const a of r.albums.slice(0, 3)) {
      console.log(`album: ${a.title} | ${a.coverUrl ? "COVER" : "no cover"}`);
      if (a.coverUrl) console.log("  ", a.coverUrl);
    }
    for (const t of r.tracks.slice(0, 2)) {
      console.log(`track: ${t.title} | ${t.coverUrl ? "COVER" : "no cover"}`);
    }
  }
}

main().catch(console.error);
