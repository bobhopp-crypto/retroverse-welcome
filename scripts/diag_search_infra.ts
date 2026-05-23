import { canonicalGraphPing } from "@/lib/canonical-graph/pg";
import { runHomeSearch } from "@/lib/home-search";
import { searchCanonicalTracksByArtist } from "@/lib/load-canonical-track-graph";
import { tryCreateClient } from "@/lib/supabase";

async function probeSupabase(label: string, table: string) {
  const sb = tryCreateClient();
  if (!sb) {
    console.log(label, "no client");
    return;
  }
  const t0 = Date.now();
  const { data, error } = await sb.from(table).select("*").limit(1);
  console.log(
    label,
    table,
    `${Date.now() - t0}ms`,
    error ? `ERR ${error.code}: ${error.message}` : `ok rows=${data?.length ?? 0}`,
  );
}

async function main() {
  console.log("env", {
    url: process.env.NEXT_PUBLIC_SUPABASE_URL?.slice(0, 40),
    pubKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?.slice(0, 20),
    pg: process.env.RETROVERSE_PG_DATABASE ?? "retroverse(default)",
  });

  console.log("graph ping", await canonicalGraphPing());

  for (const name of ["Madonna", "Eagles", "Bruce Springsteen"]) {
    const rows = await searchCanonicalTracksByArtist(name, 4);
    console.log("graph artist", name, rows.length, rows[0]?.canonicalTitle, rows[0]?.retroverseTrackId);
  }

  await probeSupabase("supabase", "retroverse_artists");
  await probeSupabase("supabase", "retroverse_tracks");

  for (const q of ["Madonna", "Eagles", "Bruce Springsteen"]) {
    const r = await runHomeSearch(q);
    console.log("\n===", q, "===");
    console.log("artists", r.artists.map((a) => a.name));
    console.log("albums", r.albums.slice(0, 4).map((a) => a.title));
    console.log("tracks", r.tracks.slice(0, 4).map((t) => `${t.title} | ${t.href}`));
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
