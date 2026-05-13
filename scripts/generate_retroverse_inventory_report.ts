/**
 * Generates docs/RETROVERSE_INVENTORY_REPORT.md from Supabase + local public/ cover files.
 * Run: npx tsx scripts/generate_retroverse_inventory_report.ts
 */
import { createWriteStream } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { readFileSync } from "node:fs";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { BILLBOARD200_SOURCE } from "../lib/billboard200-source";
import { computeDiscoverCoverageReport } from "../lib/discover-coverage";
import { discoverReviewMapFilterIds, loadDiscoverReviewMap } from "../lib/discover-review-state";
import { sortCorpusRowsForDiscoverFeed } from "../lib/discover-feed-order-shared";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "../lib/retroverse-artwork";
import { RETROVERSE_ALBUM_CORPUS_PAGE, loadAllRetroverseAlbumRows, type CorpusAlbumRow } from "../lib/retroverse-albums-corpus";

const WORKSPACE = process.cwd();
const OUT = path.join(WORKSPACE, "docs", "RETROVERSE_INVENTORY_REPORT.md");
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

function loadEnvLocal() {
  const p = path.join(WORKSPACE, ".env.local");
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[k] = v;
  }
}

function mdEscape(s: string): string {
  return s.replace(/\|/g, "\\|").replace(/\n/g, " ");
}

async function walkImages(dir: string, baseLen: number, acc: string[]): Promise<void> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const ent of entries) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) await walkImages(full, baseLen, acc);
    else if (ent.isFile()) {
      const ext = path.extname(ent.name).toLowerCase();
      if (IMAGE_EXT.has(ext)) acc.push(full.slice(baseLen).split(path.sep).join("/"));
    }
  }
}

/** Normalize DB path to repo-relative `public/...` for comparison with walk output. */
function normalizeCoverRefToPublicRel(p: string): string | null {
  const t = p.trim();
  if (!t || /^https?:\/\//i.test(t)) return null;
  let rel = t.replace(/^\/+/, "").replace(/\\/g, "/");
  if (rel.startsWith("public/")) return rel;
  return `public/${rel}`;
}

function refToAbs(repoRel: string): string {
  return path.join(WORKSPACE, ...repoRel.split("/"));
}

function chunk<T>(rows: T[], size: number): T[][] {
  if (rows.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < rows.length; i += size) out.push(rows.slice(i, i + size));
  return out;
}

type EditionRow = { retroverse_album_edition_id: string; retroverse_album_id: string };

async function distinctAlbumIdsFromEditionTracksInner(supabase: SupabaseClient): Promise<Set<string>> {
  const editionIds = new Set<string>();
  let from = 0;
  for (;;) {
    const part = await supabase
      .from("retroverse_album_tracks")
      .select("retroverse_album_edition_id")
      .order("retroverse_track_id", { ascending: true })
      .range(from, from + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = part.data ?? [];
    for (const r of rows) {
      const eid = (r as { retroverse_album_edition_id: string }).retroverse_album_edition_id;
      if (eid) editionIds.add(eid);
    }
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    from += RETROVERSE_ALBUM_CORPUS_PAGE;
  }
  const albumIds = new Set<string>();
  const editionList = [...editionIds];
  for (const idChunk of chunk(editionList, 120)) {
    const ed = await supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .in("retroverse_album_edition_id", idChunk);
    if (ed.error) throw ed.error;
    for (const row of (ed.data ?? []) as EditionRow[]) {
      if (row.retroverse_album_id) albumIds.add(row.retroverse_album_id);
    }
  }
  return albumIds;
}

function usableAlbumIdsList(rows: CorpusAlbumRow[]): string[] {
  return rows.map((r) => r.retroverse_album_id);
}

async function allAlbumIdsFromSourceMatches(supabase: SupabaseClient, sourceFilter: string | undefined): Promise<Set<string>> {
  const ids = new Set<string>();
  let from = 0;
  for (;;) {
    let q = supabase.from("retroverse_source_matches").select("retroverse_entity_id").eq("retroverse_entity_type", "album");
    if (sourceFilter) q = q.eq("source", sourceFilter);
    const part = await q.range(from, from + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = part.data ?? [];
    for (const r of rows) {
      const id = (r as { retroverse_entity_id: string | null }).retroverse_entity_id;
      if (id) ids.add(id);
    }
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    from += RETROVERSE_ALBUM_CORPUS_PAGE;
  }
  return ids;
}

async function main() {
  loadEnvLocal();
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.error("Missing Supabase env");
    process.exit(2);
  }
  const supabase = createClient(url, key);
  const generatedAt = new Date().toISOString();

  const coverage = await computeDiscoverCoverageReport();

  const [{ count: totalArtists, error: eArt }, { count: totalTracks, error: eTr }] = await Promise.all([
    supabase.from("retroverse_artists").select("retroverse_artist_id", { count: "exact", head: true }),
    supabase.from("retroverse_tracks").select("retroverse_track_id", { count: "exact", head: true }),
  ]);
  if (eArt) throw eArt;
  if (eTr) throw eTr;

  const [billboardAlbumSet, anySourceAlbumSet] = await Promise.all([
    allAlbumIdsFromSourceMatches(supabase, BILLBOARD200_SOURCE),
    allAlbumIdsFromSourceMatches(supabase, undefined),
  ]);

  const albumArtistRows: { retroverse_album_id: string; retroverse_artist_id: string }[] = [];
  let albumFrom = 0;
  for (;;) {
    const part = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, retroverse_artist_id")
      .range(albumFrom, albumFrom + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = (part.data ?? []) as { retroverse_album_id: string; retroverse_artist_id: string }[];
    albumArtistRows.push(...rows);
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    albumFrom += RETROVERSE_ALBUM_CORPUS_PAGE;
  }

  const allAlbumIdsFromTable = new Set(albumArtistRows.map((r) => r.retroverse_album_id));
  const albumsWithoutAnySourceMatch = [...allAlbumIdsFromTable].filter((id) => !anySourceAlbumSet.has(id)).length;
  const albumsWithoutBillboardMatch = [...allAlbumIdsFromTable].filter((id) => !billboardAlbumSet.has(id)).length;

  const artistsWithAlbum = new Set(albumArtistRows.map((r) => r.retroverse_artist_id).filter(Boolean)).size;

  /** Distinct artwork paths (local only) from retroverse_album_artwork */
  const referencedPublicRels = new Set<string>();
  const allArtworkPaths: string[] = [];
  let artFrom = 0;
  for (;;) {
    const part = await supabase
      .from("retroverse_album_artwork")
      .select("canonical_cover_path")
      .not("canonical_cover_path", "is", null)
      .range(artFrom, artFrom + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = part.data ?? [];
    for (const r of rows) {
      const p = (r as { canonical_cover_path: string }).canonical_cover_path?.trim() ?? "";
      if (!p) continue;
      allArtworkPaths.push(p);
      const rel = normalizeCoverRefToPublicRel(p);
      if (rel) referencedPublicRels.add(rel);
    }
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    artFrom += RETROVERSE_ALBUM_CORPUS_PAGE;
  }

  const publicRoot = path.join(WORKSPACE, "public");
  const absBase = publicRoot + path.sep;
  const localImageRels: string[] = [];
  await walkImages(publicRoot, absBase.length, localImageRels);
  const localImageSet = new Set(localImageRels.map((r) => `public/${r}`));

  let referencedMissingLocal = 0;
  for (const rel of referencedPublicRels) {
    try {
      const st = await stat(refToAbs(rel));
      if (!st.isFile()) referencedMissingLocal += 1;
    } catch {
      referencedMissingLocal += 1;
    }
  }

  let orphanedLocalCoverFiles = 0;
  for (const rel of localImageSet) {
    if (!referencedPublicRels.has(rel)) orphanedLocalCoverFiles += 1;
  }

  /** Rows with non-null retroverse_album_id */
  let tracksLinkedToAlbum = 0;
  const trackCountByAlbum = new Map<string, number>();
  let tf = 0;
  for (;;) {
    const part = await supabase
      .from("retroverse_tracks")
      .select("retroverse_track_id, retroverse_album_id")
      .not("retroverse_album_id", "is", null)
      .range(tf, tf + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = part.data ?? [];
    tracksLinkedToAlbum += rows.length;
    for (const r of rows) {
      const aid = (r as { retroverse_album_id: string }).retroverse_album_id;
      if (!aid) continue;
      trackCountByAlbum.set(aid, (trackCountByAlbum.get(aid) ?? 0) + 1);
    }
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    tf += RETROVERSE_ALBUM_CORPUS_PAGE;
  }

  const editionAlbumSet = await distinctAlbumIdsFromEditionTracksInner(supabase);
  const directAlbumSet = new Set(trackCountByAlbum.keys());
  const onlyEdition = [...editionAlbumSet].filter((id) => !directAlbumSet.has(id)).length;
  const onlyDirect = [...directAlbumSet].filter((id) => !editionAlbumSet.has(id)).length;
  const bothLinksCount = [...directAlbumSet].filter((id) => editionAlbumSet.has(id)).length;
  const unionTrackAlbums = new Set([...directAlbumSet, ...editionAlbumSet]);

  const usableList = (await loadAllRetroverseAlbumRows(supabase)).filter(
    (a) => a.retroverse_album_id?.trim() && a.canonical_album_title?.trim(),
  );
  const albumsNoTracksUsable =
    usableList.length === 0 ? 0 : usableAlbumIdsList(usableList).filter((id) => !unionTrackAlbums.has(id)).length;

  const avgTracksPerDirectAlbum = directAlbumSet.size === 0 ? 0 : tracksLinkedToAlbum / directAlbumSet.size;

  /** Discover-eligible id list (home / all) */
  const reviewMap = await loadDiscoverReviewMap();
  const allRows = sortCorpusRowsForDiscoverFeed(usableList);
  const discoverAllEraIds = discoverReviewMapFilterIds(
    allRows.map((r) => r.retroverse_album_id),
    reviewMap,
  );
  const discoverEligibleCount = discoverAllEraIds.length;

  const idChunkSize = 120;
  const editionByAlbum = new Map<string, string>();
  for (const idChunk of chunk(discoverAllEraIds, idChunkSize)) {
    const part = await supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .in("retroverse_album_id", idChunk)
      .eq("is_primary", true);
    if (part.error) throw part.error;
    for (const row of (part.data ?? []) as EditionRow[]) {
      editionByAlbum.set(row.retroverse_album_id, row.retroverse_album_edition_id);
    }
  }
  let eligibleCovered = 0;
  let eligibleUncovered = 0;
  for (const idChunk of chunk(discoverAllEraIds, idChunkSize)) {
    const artworkAcc = await loadAlbumArtworkRows(supabase, idChunk);
    for (const id of idChunk) {
      const aw = selectCanonicalArtwork(artworkAcc, id, editionByAlbum.get(id) ?? null);
      const pathVal = aw?.canonical_cover_path?.trim() ?? "";
      if (pathVal) eligibleCovered += 1;
      else eligibleUncovered += 1;
    }
  }

  const usableRows = allRows;
  const artworkAccAll: Awaited<ReturnType<typeof loadAlbumArtworkRows>> = [];
  const usableIds = usableRows.map((r) => r.retroverse_album_id);
  for (const idChunk of chunk(usableIds, idChunkSize)) {
    artworkAccAll.push(...(await loadAlbumArtworkRows(supabase, idChunk)));
  }
  const editionUsable = new Map<string, string>();
  for (const idChunk of chunk(usableIds, idChunkSize)) {
    const part = await supabase
      .from("retroverse_album_editions")
      .select("retroverse_album_edition_id, retroverse_album_id")
      .in("retroverse_album_id", idChunk)
      .eq("is_primary", true);
    if (part.error) throw part.error;
    for (const row of (part.data ?? []) as EditionRow[]) {
      editionUsable.set(row.retroverse_album_id, row.retroverse_album_edition_id);
    }
  }
  const artistsWithCoveredAlbum = new Set<string>();
  for (const album of usableRows) {
    const aw = selectCanonicalArtwork(artworkAccAll, album.retroverse_album_id, editionUsable.get(album.retroverse_album_id) ?? null);
    if (aw?.canonical_cover_path?.trim()) artistsWithCoveredAlbum.add(album.retroverse_artist_id);
  }

  const lines: string[] = [];
  lines.push("# Retroverse inventory report");
  lines.push("");
  lines.push(`**Generated:** ${generatedAt} (UTC)`);
  lines.push(
    `**Sources:** Supabase (\`${mdEscape(url)}\`) — \`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY\`; local repo \`${path.relative(WORKSPACE, publicRoot)}/\` (image files).`,
  );
  lines.push("");
  lines.push("> This file is produced by `npx tsx scripts/generate_retroverse_inventory_report.ts`. Re-run to refresh counts.");
  lines.push("");

  lines.push("## 1. Album counts");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Total rows in \`retroverse_albums\` | ${coverage.totalAlbumsInDb} |`);
  lines.push(`| Usable in app (non-empty id + title; Discover/search corpus) | ${coverage.fullCorpusUsableAlbums} |`);
  lines.push(`| Distinct albums with Billboard 200 SQLite source match (\`source=${BILLBOARD200_SOURCE}\`) | ${coverage.billboardMatchAlbumIdsDistinct} |`);
  lines.push(`| Albums with **no** row in \`retroverse_source_matches\` (entity_type=\`album\`) | ${albumsWithoutAnySourceMatch} |`);
  lines.push(`| Albums with **no** Billboard SQLite source match | ${albumsWithoutBillboardMatch} |`);
  lines.push("");

  lines.push("## 2. Cover counts");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(
    `| Usable albums with resolved canonical cover path (\`selectCanonicalArtwork\` on \`retroverse_album_artwork\`) | ${coverage.withCanonicalCover} |`,
  );
  lines.push(`| Usable albums **without** canonical cover | ${coverage.withoutCanonicalCover} |`);
  lines.push(`| % of usable albums covered | ${coverage.pctCoverOfUsable} |`);
  lines.push(`| Rows in \`retroverse_album_artwork\` with non-null \`canonical_cover_path\` | ${allArtworkPaths.length} |`);
  lines.push(`| Distinct **local** paths referenced (non-URL), normalized under \`public/\` | ${referencedPublicRels.size} |`);
  lines.push(`| Image files under \`public/\` (jpg/jpeg/png/webp/gif) | ${localImageSet.size} |`);
  lines.push(`| Referenced local paths **missing** on disk (file not found) | ${referencedMissingLocal} |`);
  lines.push(`| Local image files **not** matching any referenced \`public/...\` path | ${orphanedLocalCoverFiles} |`);
  lines.push("");
  lines.push("");
  lines.push("**Note:** Remote URLs in `canonical_cover_path` are not checked on disk.");
  lines.push("");

  lines.push("## 3. Artist counts");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Total rows in \`retroverse_artists\` | ${totalArtists ?? 0} |`);
  lines.push(`| Distinct artists appearing on ≥1 album in \`retroverse_albums\` | ${artistsWithAlbum} |`);
  lines.push(
    `| Distinct artists with ≥1 **usable** album that has a canonical cover path | ${artistsWithCoveredAlbum.size} |`,
  );
  lines.push(
    `| Artists searchable on \`/search\` | ${totalArtists ?? 0} (all rows; query is \`ilike\` on \`canonical_artist_name\`) |`,
  );
  lines.push("");
  lines.push(
    `*${(totalArtists ?? 0) - artistsWithAlbum} artists in \`retroverse_artists\` have no row in \`retroverse_albums\` (orphan artist stubs).`,
  );
  lines.push("");

  lines.push("## 4. Track / tracklist counts");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(`| Total rows in \`retroverse_tracks\` | ${totalTracks ?? 0} |`);
  lines.push(`| Track rows with non-null \`retroverse_album_id\` | ${tracksLinkedToAlbum} |`);
  lines.push(`| Distinct albums with ≥1 such track | ${directAlbumSet.size} |`);
  lines.push(`| Distinct albums reachable via \`retroverse_album_tracks\` → edition | ${editionAlbumSet.size} |`);
  lines.push(`| Albums in **both** direct and edition graphs | ${bothLinksCount} |`);
  lines.push(`| Albums **only** direct (no edition track rows) | ${onlyDirect} |`);
  lines.push(`| Albums **only** edition (no direct \`retroverse_album_id\` on tracks) | ${onlyEdition} |`);
  lines.push(`| **Union** of albums with any track linkage | ${unionTrackAlbums.size} |`);
  lines.push(`| Usable albums with **no** track linkage (neither direct nor edition) | ${albumsNoTracksUsable} |`);
  lines.push(
    `| Avg tracks per album among **direct-linked** albums (\`retroverse_tracks.retroverse_album_id\`) | ${avgTracksPerDirectAlbum.toFixed(2)} |`,
  );
  lines.push("");
  lines.push("### Album page track resolution (current code)");
  lines.push("");
  lines.push(
    "- **Primary path:** `retroverse_album_tracks` for primary (or best track-rich) edition, ordered by disc/track.",
  );
  lines.push(
    "- **Merge:** Tracks linked on the edition are unioned with extra rows where `retroverse_tracks.retroverse_album_id` matches the album and wasn’t already in the edition list (appended after the last edition track number).",
  );
  lines.push(
    "- **Fallback:** If the edition has no tracks, the page maps **all** `retroverse_tracks` with `retroverse_album_id = album`, sorted by year + title.",
  );
  lines.push(
    "- **Assessment:** Linkage is **mixed** — edition-based sequencing when `retroverse_album_tracks` is populated; **direct `retroverse_album_id`** fills gaps or replaces when editions are empty. Gaps indicate **partial ingestion**, not a broken resolver.",
  );
  lines.push("");

  lines.push("## 5. Discover feed status");
  lines.push("");
  lines.push("| Metric | Count |");
  lines.push("| --- | ---: |");
  lines.push(
    `| Albums **eligible** for Discover home (\`all\` era, after repo \`discover_review_state.json\` filter: not \`hidden\` / \`fixed\`) | ${discoverEligibleCount} |`,
  );
  lines.push(`| Usable albums marked **hidden** (repo file) | ${coverage.reviewHidden} |`);
  lines.push(`| Usable albums marked **fixed** (repo file; excluded from feed) | ${coverage.reviewFixed} |`);
  lines.push(`| Usable albums marked **skipped** | ${coverage.reviewSkipped} |`);
  lines.push(`| Usable albums marked **reviewed** | ${coverage.reviewReviewed} |`);
  lines.push(`| Eligible-for-Discover albums **with** canonical cover (same resolver as UI) | ${eligibleCovered} |`);
  lines.push(`| Eligible-for-Discover albums **without** canonical cover | ${eligibleUncovered} |`);
  lines.push(
    `| Eligible covered % | ${discoverEligibleCount === 0 ? "—" : `${((eligibleCovered / discoverEligibleCount) * 100).toFixed(1)}%`} |`,
  );
  lines.push("");
  lines.push(
    "**Implementation:** Ordered id list is cached server-side (`unstable_cache`, 300s). Each request hydrates a **window** of up to 48 ids for artwork/interleave, then returns 12.",
  );
  lines.push(
    "**Client:** Per-device `localStorage` (`retroverse_discover_memory_v1`) can hide/snooze albums; not reflected in the table above.",
  );
  lines.push("");

  lines.push("## 6. Search status");
  lines.push("");
  lines.push("| Capability | Supported? |");
  lines.push("| --- | --- |");
  lines.push("| Album **title** substring match on `retroverse_albums.canonical_album_title` | Yes (`ilike`, cap 500/variant) |");
  lines.push("| **Spelling variants** (e.g. Rumors/Rumours, color/colour) | Yes (`lib/corpus-search.ts`) |");
  lines.push("| **Artist name** match on `retroverse_artists.canonical_artist_name` | Yes |");
  lines.push("| Album results expanded by **matched artists** (discography slice per artist) | Yes |");
  lines.push("| **Aliases** / alternate artist strings without a DB row | No (no alias table wired in) |");
  lines.push("| Full-text / fuzzy index | No |");
  lines.push("");

  lines.push("## 7. Known problems before ship");
  lines.push("");
  lines.push("- **Feed generation:** First rebuild of the ordered id cache still walks all `retroverse_albums` (paginated); hot path is cached ~5m. Cold starts can feel slow.");
  lines.push(
    `- **Covers:** ${coverage.withoutCanonicalCover} usable albums lack a canonical path; ${referencedMissingLocal} referenced local paths are missing on disk in this checkout.`,
  );
  lines.push(
    `- **Tracks:** ${albumsNoTracksUsable} usable albums have no track linkage; many catalogs are **partially** linked (edition vs direct skew: only-edition ${onlyEdition}, only-direct ${onlyDirect}).`,
  );
  lines.push("- **Era streams:** Each era uses the same resolver with a year filter on the cached ordering; very large eras still pay hydrate cost per page.");
  lines.push("- **Public ship readiness:** Verify env, Supabase RLS, and that production hosts the same `public/` assets (or URLs) referenced by `canonical_cover_path`.");
  lines.push("");

  lines.push("## 8. Ship readiness (honest snapshot)");
  lines.push("");
  lines.push("| Area | Status |");
  lines.push("| --- | --- |");
  const coverPct = parseFloat(coverage.pctCoverOfUsable.replace("%", "")) || 0;
  const trackPct = parseFloat(coverage.pctAlbumsWithTracks.replace("%", "")) || 0;
  lines.push(`| Corpus present (\`retroverse_albums\`) | **Yes** — ${coverage.totalAlbumsInDb.toLocaleString()} rows |`);
  lines.push(`| Search + album routes | **Functional** — full table title search + slug/id resolution |`);
  lines.push(`| Discover | **Functional** — cached ordering + windowed hydrate (see §5) |`);
  lines.push(
    `| Covers (usable %) | ${coverPct >= 15 ? "**Strong**" : coverPct >= 5 ? "**Weak**" : "**Critical gap**"} — ${coverage.pctCoverOfUsable} |`,
  );
  lines.push(
    `| Tracklists (usable %) | ${trackPct >= 50 ? "**Strong**" : trackPct >= 15 ? "**Partial**" : "**Critical gap**"} — ${coverage.pctAlbumsWithTracks} |`,
  );
  lines.push(`| Local cover files vs DB refs | **${referencedMissingLocal === 0 ? "OK" : "Mismatch"}** — ${referencedMissingLocal} missing paths, ${orphanedLocalCoverFiles} unreferenced image files under \`public/\` |`);
  lines.push("");

  const ws = createWriteStream(OUT, { encoding: "utf8" });
  for (const line of lines) ws.write(`${line}\n`);
  ws.end();
  await new Promise<void>((res, rej) => {
    ws.on("finish", res);
    ws.on("error", rej);
  });
  console.log(`Wrote ${OUT}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
