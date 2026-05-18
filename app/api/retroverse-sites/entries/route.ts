import { NextResponse } from "next/server";

import { queryIndexEntries } from "@/lib/retroverse-sites/gallery-data";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const project = url.searchParams.get("project") ?? undefined;
  const q = url.searchParams.get("q") ?? undefined;
  const onlyPreview = url.searchParams.get("onlyPreview") === "1";
  const offset = Number(url.searchParams.get("offset") ?? "0");
  const limit = Number(url.searchParams.get("limit") ?? "48");

  const page = queryIndexEntries({ project, q, onlyPreview, offset, limit });
  return NextResponse.json(page, {
    headers: { "Cache-Control": "private, max-age=30" },
  });
}
