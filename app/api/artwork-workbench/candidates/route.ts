import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";

import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { fetchCuratorArtworkCandidatesDetailed } from "@/lib/curator-artwork-candidates";
import { createClient } from "@/lib/supabase";
import { loadAlbumArtworkRows, selectCanonicalArtwork } from "@/lib/retroverse-artwork";

export const dynamic = "force-dynamic";

const RVAL_ALBUM_ID = /^RVAL[0-9]{6}$/i;

/** Monotonic ingress counter — pairs with StrictMode-double client logs in `[curator/client_ingress]`. */
let curatorRouteIngressOrdinal = 0;

function parseYear(v: string | null): number | null {
  if (v == null || v.trim() === "") return null;
  const y = Number.parseInt(v.trim(), 10);
  return Number.isFinite(y) ? y : null;
}

async function resolveApprovedRetroverseCoverUrl(albumId: string | null): Promise<string | null> {
  const id = albumId?.trim().toUpperCase();
  if (!id || !RVAL_ALBUM_ID.test(id)) return null;

  try {
    const supabase = createClient();
    const rows = await loadAlbumArtworkRows(supabase, [id]);
    const canon = selectCanonicalArtwork(rows, id);
    return canonicalCoverPathToUrl(canon?.canonical_cover_path ?? null);
  } catch {
    return null;
  }
}

/**
 * Album artwork candidate discovery for Curator / Portal (no UI here).
 *
 * GET ?artist=&title=&year=&albumId=&debugCurator=1
 *
 * Enable verbose server logs + expanded JSON with `CURATOR_ARTWORK_DEBUG=1` or `?debugCurator=1`.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const artist = searchParams.get("artist")?.trim() ?? "";
  const title = searchParams.get("title")?.trim() ?? "";
  const year = parseYear(searchParams.get("year"));
  const albumIdRaw = searchParams.get("albumId")?.trim() ?? "";
  const debugCurator =
    searchParams.get("debugCurator") === "1" || process.env.CURATOR_ARTWORK_DEBUG === "1";

  if (artist.length < 1 || title.length < 1) {
    return NextResponse.json({ ok: false, error: "missing_artist_or_title", candidates: [] }, { status: 400 });
  }

  const discogsQueryPreview = `${artist} ${title}`.replace(/\s+/g, " ").trim();

  const albumNorm = albumIdRaw.trim().toUpperCase();

  curatorRouteIngressOrdinal += 1;
  console.warn("[artwork-workbench/candidates] route_ingress", {
    ts: new Date().toISOString(),
    ordinal: curatorRouteIngressOrdinal,
    caller: "NextRoute.GET /api/artwork-workbench/candidates",
    albumId: albumNorm || null,
    artistPreview: artist.slice(0, 72),
    titlePreview: title.slice(0, 96),
    year,
    discogsQueryPreview: discogsQueryPreview.slice(0, 160),
    debugCurator,
    strictMountHint:
      "Pair with browser `[curator/client_ingress]`: duplicates here without user action usually mean double client GET (React StrictMode dev, remount jitter, uncached callers). Server-side `[curator/ingest_session]` coalesces simultaneous identical ingests.",
  });

  try {
    const approvedCoverUrl = await resolveApprovedRetroverseCoverUrl(albumIdRaw || null);
    console.log("[artwork-workbench/candidates] request_context", {
      albumId: albumNorm || null,
      artistPreview: artist.slice(0, 72),
      titlePreview: title.slice(0, 96),
      year,
      discogsQueryPreview: discogsQueryPreview.slice(0, 160),
      hasApprovedArchiveUrl: Boolean(approvedCoverUrl),
      debugCurator,
      metadata_resolution_ok_for_query: true,
    });
    const { candidates, ingest, ingestFull } = await fetchCuratorArtworkCandidatesDetailed({
      albumId: RVAL_ALBUM_ID.test(albumNorm) ? albumNorm : null,
      artist,
      title,
      albumYear: year,
      approvedCoverUrl,
      debug: debugCurator,
    });
    console.warn("[artwork-workbench/candidates] discogs_pipeline", {
      albumId: albumNorm?.trim()?.toUpperCase() || null,
      composedQueryPreview: ingest.composedQuery.slice(0, 140),
      searchesUnreachable: ingest.discogsSearchesUnreachable,
      master: { ok: ingest.masterSearch.ok, http: ingest.masterSearch.httpStatus, hits: ingest.masterSearch.resultCount },
      release: { ok: ingest.releaseSearch.ok, http: ingest.releaseSearch.httpStatus, hits: ingest.releaseSearch.resultCount },
      finalCandidateCount: ingest.finalCandidateCount,
      rowsBeforeDedupe: ingest.rowsBeforeDedupe,
      tokenPresent: ingest.discogsTokenPresent,
    });
    return NextResponse.json({
      ok: true,
      candidates,
      warnings: ingest.warnings,
      curatorIngest: ingest,
      discogsUnavailable: ingest.discogsSearchesUnreachable,
      ...(ingestFull != null ? { curatorIngestFull: ingestFull } : {}),
    });
  } catch (e) {
    console.error("[artwork-workbench/candidates] fetchCuratorArtworkCandidatesDetailed threw", {
      artistPreview: artist.slice(0, 48),
      titlePreview: title.slice(0, 72),
      err: e instanceof Error ? `${e.name}: ${e.message}\n${e.stack ?? ""}` : String(e),
    });
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: "candidates_failed", message: msg, candidates: [] }, { status: 500 });
  }
}
