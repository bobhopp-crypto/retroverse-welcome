import { NextResponse } from "next/server";

import { loadViewerRankedAlbumEntriesForYear } from "@/lib/viewer-scope";


function parseYear(raw: string | null): number | null {
  if (!raw?.trim()) return null;
  const y = Number.parseInt(raw.trim(), 10);
  if (!Number.isFinite(y)) return null;
  if (y < 1800 || y > 2100) return null;
  return y;
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const year = parseYear(url.searchParams.get("year"));
  if (year === null) {
    return NextResponse.json({ error: "bad year" }, { status: 400 });
  }
  try {
    const entries = await loadViewerRankedAlbumEntriesForYear(year);
    const ids = entries.map((e) => e.albumId);
    return NextResponse.json({ entries, ids });
  } catch (e) {
    console.warn(`[viewer/year-albums] error=${e instanceof Error ? e.message : String(e)}`);
    return NextResponse.json({ error: "fetch failed" }, { status: 500 });
  }
}
