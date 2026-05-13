import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

const ALLOWED_ROOT = path.join(
  /* turbopackIgnore: true */ process.cwd(),
  "data",
  "raw",
  "providers",
  "itunes",
);

function isSafeRelative(p: string): boolean {
  if (!p || p.includes("..")) return false;
  const normalized = path.normalize(p).replace(/^(\.\/)+/, "");
  if (normalized.startsWith("..")) return false;
  return (
    normalized.startsWith(`data${path.sep}raw${path.sep}providers${path.sep}itunes`) ||
    normalized.startsWith(`data/raw/providers/itunes`)
  );
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rel = url.searchParams.get("path") ?? "";
  const decoded = decodeURIComponent(rel.trim());
  if (!isSafeRelative(decoded)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }
  const absolute = path.join(/* turbopackIgnore: true */ process.cwd(), decoded);
  const resolved = path.resolve(absolute);
  if (!resolved.startsWith(path.resolve(ALLOWED_ROOT))) {
    return NextResponse.json({ error: "path outside itunes raw root" }, { status: 403 });
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const text = fs.readFileSync(resolved, "utf8");
  return new NextResponse(text, {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, max-age=60",
    },
  });
}
