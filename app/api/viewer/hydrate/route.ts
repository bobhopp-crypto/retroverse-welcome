import { NextResponse } from "next/server";

import type { DiscoverStableAlbumRow } from "@/app/discover/discover-feed-types";
import { hydrateDiscoverAlbumRows, hydrateDiscoverAlbumRowsFresh } from "@/lib/discover-hydrate-rows";
import {
  hydrateSqliteAlbumRows,
  isSqliteCorpusAlbumId,
} from "@/lib/viewer-corpus-sqlite";

/** Portal/Discover cover rows: overrides → dossier → Supabase artwork fallback. */
export const dynamic = "force-dynamic";

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
  const rvalIds: string[] = [];
  const sqliteIds: string[] = [];
  for (const raw of idsRaw) {
    if (typeof raw !== "string") continue;
    const id = raw.trim();
    if (isSqliteCorpusAlbumId(id)) {
      if (!sqliteIds.includes(id)) sqliteIds.push(id);
    } else {
      const upper = id.toUpperCase();
      if (RVAL.test(upper) && !rvalIds.includes(upper)) rvalIds.push(upper);
    }
    if (rvalIds.length + sqliteIds.length >= HYDRATE_MAX) break;
  }
  if (rvalIds.length === 0 && sqliteIds.length === 0) {
    return NextResponse.json({ rows: [] satisfies DiscoverStableAlbumRow[] });
  }

  const rows: DiscoverStableAlbumRow[] = hydrateSqliteAlbumRows(sqliteIds, null);

  if (rvalIds.length === 0) {
    return NextResponse.json({ rows });
  }

  try {
    const supabaseRows = forceFresh
      ? await hydrateDiscoverAlbumRowsFresh(rvalIds)
      : await hydrateDiscoverAlbumRows(rvalIds);
    return NextResponse.json({ rows: [...rows, ...supabaseRows] });
  } catch (e) {
    console.warn(`[viewer/hydrate] supabase_offline error=${e instanceof Error ? e.message : String(e)}`);
    if (rows.length > 0) return NextResponse.json({ rows });
    return NextResponse.json({ error: "hydrate failed" }, { status: 500 });
  }
}
