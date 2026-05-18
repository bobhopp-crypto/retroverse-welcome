import { NextResponse } from "next/server";

import { loadSitesGalleryMeta } from "@/lib/retroverse-sites/gallery-data";

export async function GET() {
  const meta = loadSitesGalleryMeta();
  return NextResponse.json(meta, {
    headers: { "Cache-Control": "private, max-age=60" },
  });
}
