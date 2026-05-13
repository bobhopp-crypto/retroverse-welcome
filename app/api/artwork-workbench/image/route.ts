import { readFile } from "node:fs/promises";
import path from "node:path";

import { NextResponse } from "next/server";

export const dynamic = "force-dynamic";

const ALLOWED_PREFIXES = [
  "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/itunes-pass/",
  "/Users/bobhopp/RETROVERSE_DATA/covers_master/",
  "/Users/bobhopp/RETROVERSE_v2/apps/retroverse-welcome/public/retroverse/covers/",
];

function contentTypeFor(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpeg" || ext === ".jpg") return "image/jpeg";
  return "application/octet-stream";
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const input = url.searchParams.get("path");
  if (!input) return new NextResponse("missing path", { status: 400 });
  const resolved = path.resolve(input);

  if (!ALLOWED_PREFIXES.some((prefix) => resolved.startsWith(prefix))) {
    return new NextResponse("forbidden", { status: 403 });
  }

  try {
    const bytes = await readFile(resolved);
    return new NextResponse(bytes, {
      status: 200,
      headers: {
        "Content-Type": contentTypeFor(resolved),
        "Cache-Control": "no-store",
      },
    });
  } catch {
    return new NextResponse("not found", { status: 404 });
  }
}
