/**
 * Standalone iTunes Search API transport probe: compares native vs browser-header fetch, axios, undici.
 *
 * Usage: npx tsx scripts/test_itunes_transport.ts
 */
import {
  buildItunesBrowserHeaders,
  fetchItunesSearchWithTransport,
  probeItunesTransportLayer,
} from "./lib/itunes-transport";
import type { ItunesTransportResult, TransportLayer } from "./lib/itunes-transport";

const TIMEOUT_MS = Math.max(3000, Number.parseInt(process.env.ITUNES_TRANSPORT_TEST_TIMEOUT_MS ?? "20000", 10));

const ARTISTS = [
  "Taylor Swift",
  "The Beatles",
  "Eagles",
  "Fleetwood Mac",
  "Queen",
];

const LAYERS: TransportLayer[] = ["native_fetch", "fetch_browser_headers", "axios", "undici"];

function searchUrl(term: string, limit = 10): string {
  const t = encodeURIComponent(term);
  return `https://itunes.apple.com/search?term=${t}&media=music&country=US&limit=${limit}&entity=album`;
}

function ok(r: ItunesTransportResult): boolean {
  return r.transportTaxonomy === "transport_ok" && r.httpStatus >= 200 && r.httpStatus < 300 && r.rawResultCount >= 0;
}

async function main() {
  console.log("itunes_transport_test timeout_ms=", TIMEOUT_MS);
  console.log("browser_headers_preview=", JSON.stringify(buildItunesBrowserHeaders()));

  let firstWinningLayer: TransportLayer | null = null;

  for (const artist of ARTISTS) {
    const url = searchUrl(artist);
    console.log("\n=== artist:", artist);
    console.log("url:", url);

    for (const layer of LAYERS) {
      const r = await probeItunesTransportLayer(url, layer, TIMEOUT_MS);
      console.log(
        `  layer=${layer.padEnd(22)} status=${String(r.httpStatus).padStart(3)} resultCount=${String(r.rawResultCount).padStart(4)} bytes=${String(r.responseContentLength).padStart(6)} taxonomy=${r.transportTaxonomy}`,
      );
      if (!firstWinningLayer && ok(r)) firstWinningLayer = layer;
    }

    const chain = await fetchItunesSearchWithTransport(url, TIMEOUT_MS);
    console.log(
      `  chain_winner=${chain.transportLayer} status=${chain.httpStatus} resultCount=${chain.rawResultCount} taxonomy=${chain.transportTaxonomy}`,
    );
    console.log(`  chain_trace=${chain.transportFallbackSummary}`);
    if (!firstWinningLayer && ok(chain)) firstWinningLayer = chain.transportLayer;
  }

  console.log(
    "\nitunes_transport_test_summary first_successful_layer=",
    firstWinningLayer ?? "(none — all probes failed transport_ok)",
  );
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
