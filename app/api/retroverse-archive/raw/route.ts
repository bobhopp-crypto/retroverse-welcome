import { readFile, stat } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

import { resolveSafeArchiveFile } from "@/lib/retroverse-archive/validate-path";

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const rel = url.searchParams.get("path")?.trim();
  if (!rel) {
    return NextResponse.json({ ok: false, error: "missing_path" }, { status: 400 });
  }

  const resolved = resolveSafeArchiveFile(rel);
  if (!resolved) {
    return NextResponse.json({ ok: false, error: "forbidden_path" }, { status: 403 });
  }

  let st;
  try {
    st = await stat(resolved.abs);
  } catch {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!st.isFile()) {
    return NextResponse.json({ ok: false, error: "not_file" }, { status: 404 });
  }

  const buf = await readFile(resolved.abs);
  const ext = path.extname(resolved.abs).toLowerCase();
  const type = MIME[ext] ?? "application/octet-stream";

  return new NextResponse(buf, {
    status: 200,
    headers: {
      "Content-Type": type,
      "Cache-Control": "private, max-age=120",
      "X-Archive-Rel-Path": resolved.rel,
    },
  });
}
