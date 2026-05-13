/**
 * Test: browser-shaped iTunes Search (media=music, no entity filter) — full raw snapshot + album candidates.
 *
 * Raw layer: response bytes as returned (see lib/itunes-raw-snapshot.ts).
 * Candidate layer: track/collection rows → album candidates by collectionId (lib/itunes-candidates-from-raw.ts).
 * Canonical layer: Retroverse DB — not used here.
 *
 * Usage: npx tsx scripts/test_itunes_raw_enrichment.ts
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

import { extractAlbumCandidatesFromItunesResults } from "./lib/itunes-candidates-from-raw";
import { saveItunesRawSnapshot } from "./lib/itunes-raw-snapshot";
import { fetchItunesSearchWithTransport } from "./lib/itunes-transport";

const WORKSPACE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TIMEOUT_MS = Math.max(3000, Number.parseInt(process.env.ITUNES_RAW_TEST_TIMEOUT_MS ?? "20000", 10));

/** Same shape as a browser-successful probe: term + media=music + limit (no entity=album). */
const BROWSER_STYLE_URL = "https://itunes.apple.com/search?term=Eagles&media=music&limit=5";

function uniqueCollectionIds(rows: unknown[]): number {
  const ids = new Set<number>();
  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const cid = (row as { collectionId?: unknown }).collectionId;
    if (typeof cid === "number" && Number.isFinite(cid)) ids.add(cid);
  }
  return ids.size;
}

async function main() {
  const runId = `test-itunes-raw-${new Date().toISOString().replace(/[:.]/g, "-")}`;
  console.log("request:", BROWSER_STYLE_URL);
  const res = await fetchItunesSearchWithTransport(BROWSER_STYLE_URL, TIMEOUT_MS);

  let savedRel = "";
  let saveErr = "";
  if (res.transportTaxonomy === "transport_ok" && res.rawResponseBodyText) {
    const out = await saveItunesRawSnapshot({
      workspaceRoot: WORKSPACE_ROOT,
      runId,
      requestUrl: res.url,
      searchStrategy: "browser_media_music",
      queryTerm: "Eagles",
      billboardArtist: "Eagles",
      billboardAlbum: "",
      chartYear: null,
      httpStatus: res.httpStatus,
      resultCount: res.rawResultCount,
      responseContentLength: res.responseContentLength,
      transportLayer: res.transportLayer,
      transportTaxonomy: res.transportTaxonomy,
      rawBodyText: res.rawResponseBodyText,
    });
    if (out.ok) savedRel = out.relRawPath;
    else saveErr = out.error;
  } else {
    saveErr = `no_raw_body taxonomy=${res.transportTaxonomy}`;
  }

  const candidates = extractAlbumCandidatesFromItunesResults(res.results);
  const uniqueCollections = uniqueCollectionIds(res.results);

  console.log("resultCount:", res.rawResultCount);
  console.log("unique_collection_count (collectionId):", uniqueCollections);
  console.log("saved_raw_path:", savedRel || "(none)");
  if (saveErr) console.log("raw_snapshot_error:", saveErr);
  console.log("extracted_album_candidates:", candidates.length);
  for (const c of candidates) {
    console.log(`  collectionId=${c.collectionId} album=${JSON.stringify(c.collectionName ?? "")} artist=${JSON.stringify(c.artistName ?? "")}`);
  }
  console.log("transport:", res.transportTaxonomy, res.transportLayer, `http=${res.httpStatus}`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
