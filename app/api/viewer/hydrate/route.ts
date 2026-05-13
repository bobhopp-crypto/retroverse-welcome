import { NextResponse } from "next/server";

import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { hydrateDiscoverAlbumRows, hydrateDiscoverAlbumRowsFresh } from "@/lib/discover-hydrate-rows";

const RVAL = /^RVAL[0-9]{6}$/;
const HYDRATE_MAX = 72;

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const typed = body as { ids?: unknown; fresh?: unknown };
  const forceFresh = typed.fresh === true;
  const idsRaw = Array.isArray(typed.ids) ? typed.ids : [];
  const ids: string[] = [];
  for (const raw of idsRaw) {
    if (typeof raw !== "string") continue;
    const id = raw.trim().toUpperCase();
    if (RVAL.test(id) && !ids.includes(id)) ids.push(id);
    if (ids.length >= HYDRATE_MAX) break;
  }
  if (ids.length === 0) {
    return NextResponse.json({ rows: [] satisfies DiscoverStableAlbumRow[] });
  }
  try {
    const rows = forceFresh ? await hydrateDiscoverAlbumRowsFresh(ids) : await hydrateDiscoverAlbumRows(ids);
    return NextResponse.json({ rows });
  } catch (e) {
    console.error("[viewer/hydrate]", e);
    return NextResponse.json({ error: "hydrate failed" }, { status: 500 });
  }
}
