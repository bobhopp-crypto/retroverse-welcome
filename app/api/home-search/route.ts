import { NextResponse } from "next/server";

import { normalizeHomeSearchPayload, runHomeSearch } from "@/lib/home-search";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const EMPTY_HEADERS = { "Cache-Control": "private, max-age=0" } as const;

export async function GET(request: Request) {
  const url = new URL(request.url);
  const q = url.searchParams.get("q")?.trim() ?? "";

  if (q.length < 2) {
    return NextResponse.json(
      { ok: true, q, tracks: [], albums: [], artists: [], charts: [] },
      { headers: EMPTY_HEADERS },
    );
  }

  try {
    const result = await runHomeSearch(q);
    return NextResponse.json(result, {
      headers: { "Cache-Control": result.incomplete ? "private, max-age=0" : "private, max-age=15" },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[home-search:api]", { q, route: "/api/home-search", message });
    return NextResponse.json(
      normalizeHomeSearchPayload(null, q),
      { headers: { ...EMPTY_HEADERS, "X-Search-Incomplete": "1" } },
    );
  }
}
