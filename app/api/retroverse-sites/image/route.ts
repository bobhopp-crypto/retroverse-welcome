import { existsSync } from "node:fs";
import { readFile, stat } from "node:fs/promises";

import { NextResponse } from "next/server";
import sharp from "sharp";

import { capturePngAbsForId } from "@/lib/retroverse-sites/index-store";
import {
  imageApiHref,
  logImageResolve,
  mimeForPath,
  resolveIndexedImage,
  resolveSitesFile,
  sitesImageDebugEnabled,
} from "@/lib/retroverse-sites/paths";

const MAX_THUMB_W = 640;
const MAX_THUMB_H = 480;

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const id = url.searchParams.get("id")?.trim();
  const rel = url.searchParams.get("path")?.trim();
  const browserUrl = url.pathname + url.search;
  const thumbW = Math.min(MAX_THUMB_W, Number(url.searchParams.get("w") ?? "0") || 0);
  const thumbH = Math.min(MAX_THUMB_H, Number(url.searchParams.get("h") ?? "0") || 0);

  let hit = null as ReturnType<typeof resolveIndexedImage>;

  if (id) {
    hit = resolveIndexedImage(id);
    if (hit && sitesImageDebugEnabled()) {
      logImageResolve("hit", {
        id,
        browserUrl,
        abs: hit.abs,
        source: hit.source,
        exists: true,
      });
    }
  } else if (rel) {
    hit = resolveSitesFile(rel);
    if (hit && sitesImageDebugEnabled()) {
      logImageResolve("hit", { rel, browserUrl, abs: hit.abs, source: hit.source, exists: true });
    }
  } else {
    return NextResponse.json({ ok: false, error: "missing_id_or_path" }, { status: 400 });
  }

  if (!hit) {
    const capturePath = id ? capturePngAbsForId(id) : null;
    console.warn("[retroverse-sites/image] miss", {
      id,
      rel,
      browserUrl: id ? imageApiHref(id) : browserUrl,
      filesystemPath: capturePath,
      captureExists: capturePath ? existsSync(capturePath) : undefined,
      thumbW: thumbW || undefined,
    });
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const abs = hit.abs;
  let st;
  try {
    st = await stat(abs);
  } catch {
    console.warn("[retroverse-sites/image] stat-fail", { id, rel, browserUrl, filesystemPath: abs });
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }
  if (!st.isFile()) {
    return NextResponse.json({ ok: false, error: "not_found" }, { status: 404 });
  }

  const raw = await readFile(abs);

  if (thumbW > 0) {
    try {
      const thumb = await sharp(raw)
        .rotate()
        .resize(thumbW, thumbH > 0 ? thumbH : undefined, { fit: "inside", withoutEnlargement: true })
        .jpeg({ quality: 72, mozjpeg: true })
        .toBuffer();
      return new NextResponse(new Uint8Array(thumb), {
        status: 200,
        headers: {
          "Content-Type": "image/jpeg",
          "Cache-Control": "private, max-age=86400",
          "X-Sites-Image-Source": hit.source,
        },
      });
    } catch (err) {
      console.warn("[retroverse-sites/image] thumb-fail", {
        id,
        browserUrl,
        filesystemPath: abs,
        error: err instanceof Error ? err.message : err,
      });
    }
  }

  return new NextResponse(new Uint8Array(raw), {
    status: 200,
    headers: {
      "Content-Type": hit.mime || mimeForPath(abs),
      "Cache-Control": "private, max-age=300",
      "X-Sites-Image-Source": hit.source,
    },
  });
}
