import { readFile, stat } from "node:fs/promises";

import { NextResponse } from "next/server";

import { screenshotAbsForId } from "@/lib/retroverse-archive/screenshots";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim() ?? "";
  if (!/^[a-f0-9]{12}$/i.test(id)) {
    return NextResponse.json({ ok: false, error: "invalid_id" }, { status: 400 });
  }

  const abs = screenshotAbsForId(id);
  let st;
  try {
    st = await stat(abs);
  } catch {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!st.isFile()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const buf = await readFile(abs);
  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": "image/png",
      "Cache-Control": "private, max-age=300",
    },
  });
}
