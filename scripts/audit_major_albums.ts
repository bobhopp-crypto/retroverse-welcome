/**
 * Live DB audit: canonical albums, artist link, artwork, track linkage.
 * Run: npx tsx scripts/audit_major_albums.ts
 * Reads .env.local from repo root (same keys as Next).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";

function loadEnvLocal() {
  const p = path.join(process.cwd(), ".env.local");
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
      v = v.slice(1, -1);
    }
    if (!process.env[k]) process.env[k] = v;
  }
}

loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
if (!url || !key) {
  console.error("Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY");
  process.exit(2);
}

const sb = createClient(url, key);

const NEEDLES = ["Rumours", "Rumors", "Thriller", "Hotel California", "Abbey Road", "Purple Rain"] as const;

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
};

async function main() {
  const seen = new Set<string>();

  for (const needle of NEEDLES) {
    const { data: albums, error: aErr } = await sb
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year")
      .ilike("canonical_album_title", `%${needle}%`)
      .limit(12);
    if (aErr) {
      console.log(`\n[${needle}] album query error:`, aErr.message);
      continue;
    }
    const list = (albums ?? []) as AlbumRow[];
    console.log(`\n======== ${needle}: ${list.length} album row(s) (sample up to 12) ========`);
    for (const al of list) {
      if (seen.has(al.retroverse_album_id)) continue;
      seen.add(al.retroverse_album_id);

      const [
        { data: artist, error: eArt },
        { data: editions, error: eEd },
        { data: artRows, error: eAw },
        { count: directTrackCount, error: eTr },
      ] = await Promise.all([
        sb
          .from("retroverse_artists")
          .select("retroverse_artist_id, canonical_artist_name")
          .eq("retroverse_artist_id", al.retroverse_artist_id)
          .maybeSingle(),
        sb.from("retroverse_album_editions").select("retroverse_album_edition_id, is_primary").eq("retroverse_album_id", al.retroverse_album_id),
        sb
          .from("retroverse_album_artwork")
          .select("canonical_cover_path, artwork_status, is_primary, artwork_role")
          .eq("retroverse_album_id", al.retroverse_album_id)
          .limit(20),
        sb
          .from("retroverse_tracks")
          .select("retroverse_track_id", { count: "exact", head: true })
          .eq("retroverse_album_id", al.retroverse_album_id),
      ]);

      const editionIds = (editions ?? []).map((r: { retroverse_album_edition_id: string }) => r.retroverse_album_edition_id);
      let editionTrackCount = 0;
      if (editionIds.length > 0) {
        const { count, error: eAt } = await sb
          .from("retroverse_album_tracks")
          .select("retroverse_track_id", { count: "exact", head: true })
          .in("retroverse_album_edition_id", editionIds);
        if (!eAt) editionTrackCount = count ?? 0;
      }

      const art = (artRows ?? []) as Array<{ canonical_cover_path: string | null; artwork_status: string | null }>;
      const withPath = art.filter((r) => r.canonical_cover_path?.trim()).length;

      console.log(JSON.stringify({
        album_id: al.retroverse_album_id,
        title: al.canonical_album_title,
        year: al.release_year,
        artist_id: al.retroverse_artist_id,
        artist_resolved: artist && !eArt ? (artist as { canonical_artist_name: string }).canonical_artist_name : null,
        artist_error: eArt?.message ?? null,
        editions: editions?.length ?? 0,
        edition_ingest_error: eEd?.message ?? null,
        artwork_rows: art.length,
        artwork_with_path: withPath,
        artwork_sample_status: art.slice(0, 3).map((r) => r.artwork_status),
        direct_tracks_count: eTr ? null : directTrackCount ?? 0,
        direct_tracks_error: eTr?.message ?? null,
        /** Count from retroverse_album_tracks for any edition on this album */
        edition_track_rows: editionTrackCount,
      }, null, 2));
    }
  }

  const { count: totalAlbums, error: cErr } = await sb.from("retroverse_albums").select("retroverse_album_id", { count: "exact", head: true });
  console.log("\n--- corpus ---");
  console.log(cErr ? `total albums: error ${cErr.message}` : `total retroverse_albums (count): ${totalAlbums ?? "?"}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
