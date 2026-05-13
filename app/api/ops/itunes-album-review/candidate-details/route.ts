import fs from "node:fs";
import path from "node:path";

import { NextResponse } from "next/server";

import {
  collectionIdAsNumber,
  findResultRowForCandidate,
  pickArtworkUrlFromRow,
  upgradeArtworkTo600,
} from "../../../../ops/review/itunes-snapshot-artwork";

const ALLOWED_ROOT = path.resolve(process.cwd(), "data", "raw", "providers", "itunes");

function isSafeRelative(p: string): boolean {
  if (!p || p.includes("..")) return false;
  const normalized = path.normalize(p).replace(/^(\.\/)+/, "");
  if (normalized.startsWith("..")) return false;
  return (
    normalized.startsWith(`data${path.sep}raw${path.sep}providers${path.sep}itunes`) ||
    normalized.startsWith(`data/raw/providers/itunes`)
  );
}

function releaseYearFromIso(iso: string | undefined): number | null {
  if (!iso || !iso.trim()) return null;
  const y = Number(iso.slice(0, 4));
  return Number.isFinite(y) ? y : null;
}

type Body = {
  rawPath?: string;
  candidates?: Array<{ candidateArtist: string; candidateAlbum: string }>;
  /** When true, include `_artDebug` with counts / first resolved URL (for calibration UI). */
  debugArt?: boolean;
};

export async function POST(req: Request) {
  const body = (await req.json().catch(() => ({}))) as Body;
  const rawPath = (body.rawPath ?? "").trim();
  const candidates = body.candidates ?? [];
  const debugArt = Boolean(body.debugArt);

  if (!rawPath || !isSafeRelative(rawPath)) {
    return NextResponse.json({ error: "invalid path" }, { status: 400 });
  }

  const absolute = path.resolve(process.cwd(), rawPath);
  if (!absolute.startsWith(ALLOWED_ROOT)) {
    return NextResponse.json({ error: "path outside itunes raw root" }, { status: 403 });
  }

  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let parsed: { results?: Record<string, unknown>[] };
  try {
    parsed = JSON.parse(fs.readFileSync(absolute, "utf8")) as typeof parsed;
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 422 });
  }

  const rows = parsed.results ?? [];
  const previews = candidates.map((c) => {
    const hit = findResultRowForCandidate(rows, c.candidateArtist, c.candidateAlbum);
    if (!hit) {
      return {
        artworkUrl: null as string | null,
        releaseYear: null as number | null,
        collectionId: null as string | null,
        artworkSourceField: null as string | null,
      };
    }
    const rawArt = pickArtworkUrlFromRow(hit);
    let sourceField: string | null = null;
    if (rawArt) {
      for (const k of Object.keys(hit)) {
        if (/^artworkUrl\d*$/i.test(k) && hit[k] === rawArt) {
          sourceField = k;
          break;
        }
      }
    }
    const cid = collectionIdAsNumber(hit.collectionId);
    return {
      artworkUrl: upgradeArtworkTo600(rawArt),
      releaseYear: releaseYearFromIso(
        typeof hit.releaseDate === "string" ? hit.releaseDate : undefined,
      ),
      collectionId: cid != null ? String(cid) : null,
      artworkSourceField: sourceField,
    };
  });

  let withUrl = 0;
  for (const p of previews) {
    if (p.artworkUrl) withUrl += 1;
  }

  const payload: Record<string, unknown> = { previews };
  if (debugArt) {
    const first = previews.find((p) => p.artworkUrl);
    payload._artDebug = {
      rawPath,
      resultsCount: rows.length,
      candidatesRequested: candidates.length,
      previewsWithArtworkUrl: withUrl,
      selectedArtworkExample: first?.artworkUrl ?? null,
    };
  }

  return NextResponse.json(payload);
}
