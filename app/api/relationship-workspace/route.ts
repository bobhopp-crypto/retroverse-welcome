import { NextResponse } from "next/server";

import { loadRelationshipWorkspace } from "@/lib/relationship-workspace/load-workspace";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  try {
    const result = await loadRelationshipWorkspace({
      artist: url.searchParams.get("artist") ?? undefined,
      title: url.searchParams.get("title") ?? undefined,
      rvtr: url.searchParams.get("rvtr") ?? undefined,
      vdjPath: url.searchParams.get("vdjPath") ?? undefined,
      chartWeek: url.searchParams.get("chartWeek") ?? undefined,
      chartRank: url.searchParams.get("chartRank") ?? undefined,
      q: url.searchParams.get("q") ?? undefined,
    });

    if (!("ok" in result) || result.ok === false) {
      return NextResponse.json(result, { status: 400 });
    }

    return NextResponse.json(result);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error(`[relationship-workspace] api GET fatal error=${message}`);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
