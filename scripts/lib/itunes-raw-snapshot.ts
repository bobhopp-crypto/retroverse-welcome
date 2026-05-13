/**
 * Raw layer: persist iTunes Search API responses exactly as received (immutable evidence).
 * Candidate / canonical layers live elsewhere — never mutate these files in place.
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import type { TransportLayer, TransportTaxonomy } from "./itunes-transport";

export type ItunesRawSnapshotMeta = {
  run_id: string;
  provider: "itunes_search";
  request_url: string;
  search_strategy: string;
  query_term: string;
  billboard_artist: string;
  billboard_album: string;
  chart_year: number | null;
  http_status: number;
  result_count: number;
  response_content_length: number;
  transport_layer: TransportLayer;
  transport_taxonomy: TransportTaxonomy;
  /** Path to *.raw.json relative to workspace root. */
  saved_raw_path: string;
  timestamp: string;
};

function slugForFilename(s: string, maxLen: number): string {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, maxLen);
}

/** `data/raw/providers/itunes/YYYY/MM/DD/<run_id>/` */
export function itunesRawSnapshotDayDir(workspaceRoot: string, runId: string): string {
  const d = new Date();
  const y = String(d.getFullYear());
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return path.join(workspaceRoot, "data", "raw", "providers", "itunes", y, m, day, runId);
}

export type SaveItunesRawSnapshotArgs = {
  workspaceRoot: string;
  runId: string;
  requestUrl: string;
  searchStrategy: string;
  queryTerm: string;
  billboardArtist: string;
  billboardAlbum: string;
  chartYear: number | null;
  httpStatus: number;
  resultCount: number;
  responseContentLength: number;
  transportLayer: TransportLayer;
  transportTaxonomy: TransportTaxonomy;
  rawBodyText: string;
};

export type SaveItunesRawSnapshotResult =
  | { ok: true; relRawPath: string; relMetaPath: string; absRawPath: string }
  | { ok: false; error: string };

/**
 * Writes `<base>.raw.json` (exact UTF-8 bytes Apple returned) and `<base>.meta.json`.
 */
export async function saveItunesRawSnapshot(args: SaveItunesRawSnapshotArgs): Promise<SaveItunesRawSnapshotResult> {
  try {
    const dir = itunesRawSnapshotDayDir(args.workspaceRoot, args.runId);
    await mkdir(dir, { recursive: true });

    const strategy = slugForFilename(args.searchStrategy, 24);
    const art = slugForFilename(args.billboardArtist, 48);
    const alb = slugForFilename(args.billboardAlbum || "no-album", 48);
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const hash12 = createHash("sha256").update(args.rawBodyText).digest("hex").slice(0, 12);
    const base = `itunes_${strategy}_${art}_${alb}_${stamp}_${hash12}`;
    const rawName = `${base}.raw.json`;
    const metaName = `${base}.meta.json`;
    const absRaw = path.join(dir, rawName);
    const absMeta = path.join(dir, metaName);

    await writeFile(absRaw, args.rawBodyText, "utf8");

    const relRawPath = path.relative(args.workspaceRoot, absRaw).replace(/\\/g, "/");
    const meta: ItunesRawSnapshotMeta = {
      run_id: args.runId,
      provider: "itunes_search",
      request_url: args.requestUrl,
      search_strategy: args.searchStrategy,
      query_term: args.queryTerm,
      billboard_artist: args.billboardArtist,
      billboard_album: args.billboardAlbum,
      chart_year: args.chartYear,
      http_status: args.httpStatus,
      result_count: args.resultCount,
      response_content_length: args.responseContentLength,
      transport_layer: args.transportLayer,
      transport_taxonomy: args.transportTaxonomy,
      saved_raw_path: relRawPath,
      timestamp: new Date().toISOString(),
    };
    await writeFile(absMeta, `${JSON.stringify(meta, null, 2)}\n`, "utf8");
    const relMetaPath = path.relative(args.workspaceRoot, absMeta).replace(/\\/g, "/");

    return { ok: true, relRawPath, relMetaPath, absRawPath: absRaw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, error: msg };
  }
}
