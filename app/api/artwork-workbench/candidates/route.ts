import { NextResponse } from "next/server";
import path from "node:path";
import { readdir } from "node:fs/promises";

import { canonicalCoverPathToUrl } from "@/lib/canonical-cover-url";
import { ARTWORK_DEPLOY_ROOT } from "@/lib/artwork-storage-model";
import {
  fingerprintCandidateArtworkUrl,
  normalizeCandidateArtworkUrl,
} from "@/lib/artwork-candidate-fingerprint";

export const dynamic = "force-dynamic";

type CandidateResult = {
  source: "discogs" | "itunes" | "local";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url: string | null;
  stagedFilePath?: string | null;
};

function toIntYear(value: string | undefined): number | null {
  if (!value) return null;
  const match = value.match(/\b(19|20)\d{2}\b/);
  if (!match) return null;
  const year = Number.parseInt(match[0], 10);
  return Number.isFinite(year) ? year : null;
}

async function fetchDiscogs(artist: string, title: string): Promise<CandidateResult[]> {
  const q = new URL("https://api.discogs.com/database/search");
  q.searchParams.set("type", "release");
  q.searchParams.set("artist", artist);
  q.searchParams.set("release_title", title);
  q.searchParams.set("per_page", "50");
  const res = await fetch(q, {
    headers: {
      "User-Agent": "RetroverseArtworkWorkbench/1.0",
    },
  });
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: Array<{
      title?: string;
      year?: number;
      thumb?: string;
      cover_image?: string;
      uri?: string;
      resource_url?: string;
    }>;
  };
  return (json.results ?? []).slice(0, 50).map((row) => {
    const fullTitle = row.title?.trim() ?? "";
    const split = fullTitle.split(" - ");
    const candidateArtist = split.length > 1 ? split[0].trim() : artist;
    const candidateTitle = split.length > 1 ? split.slice(1).join(" - ").trim() : fullTitle;
    const rawImg = row.cover_image?.trim() || row.thumb?.trim() || null;
    return {
      source: "discogs",
      title: candidateTitle || title,
      artist: candidateArtist || artist,
      year: row.year ?? null,
      image: normalizeCandidateArtworkUrl(rawImg),
      url: row.uri ? `https://www.discogs.com${row.uri}` : row.resource_url ?? null,
    };
  });
}

async function fetchLocalCandidates(albumId: string, artist: string, title: string): Promise<CandidateResult[]> {
  const albumDir = path.join(ARTWORK_DEPLOY_ROOT, albumId);
  try {
    const files = await readdir(albumDir, { withFileTypes: true });
    return files
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => /\.(jpg|jpeg|png|webp)$/i.test(name))
      .slice(0, 16)
      .map((filename) => ({
        source: "local" as const,
        title,
        artist,
        year: null,
        image: normalizeCandidateArtworkUrl(
          canonicalCoverPathToUrl(`retroverse/covers/${albumId}/${filename}`) ??
            `/retroverse/covers/${albumId}/${filename}`,
        ),
        url: null,
        stagedFilePath: path.join(albumDir, filename),
      }));
  } catch {
    return [];
  }
}

async function fetchItunes(artist: string, title: string): Promise<CandidateResult[]> {
  const q = `https://itunes.apple.com/search?term=${encodeURIComponent(`${artist} ${title}`)}&entity=album&limit=50`;
  const res = await fetch(q);
  if (!res.ok) return [];
  const json = (await res.json()) as {
    results?: Array<{
      artistName?: string;
      collectionName?: string;
      releaseDate?: string;
      artworkUrl100?: string;
      collectionViewUrl?: string;
    }>;
  };
  return (json.results ?? []).slice(0, 36).map((row) => {
    const raw =
      row.artworkUrl100?.replace(/100x100bb/gi, "600x600bb").replace(/100x100-75/gi, "600x600-75") ?? null;
    return {
      source: "itunes" as const,
      title: row.collectionName?.trim() ?? title,
      artist: row.artistName?.trim() ?? artist,
      year: toIntYear(row.releaseDate),
      image: normalizeCandidateArtworkUrl(raw),
      url: row.collectionViewUrl ?? null,
    };
  });
}

function norm(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function tokens(value: string): string[] {
  const cleaned = norm(value);
  if (!cleaned) return [];
  return cleaned.split(/\s+/).filter(Boolean);
}

function tokenSimilarity(a: string, b: string): number {
  const aTokens = new Set(tokens(a));
  const bTokens = new Set(tokens(b));
  if (aTokens.size === 0 || bTokens.size === 0) return 0;
  const overlap = [...aTokens].filter((token) => bTokens.has(token)).length;
  return overlap / Math.max(aTokens.size, bTokens.size);
}

function hasGreatestHitsSignal(value: string): boolean {
  const normalized = norm(value);
  return normalized.includes("greatest hits") || normalized.includes("best of") || normalized.includes("anthology");
}

function hasSoundtrackSignal(value: string): boolean {
  const normalized = norm(value);
  return normalized.includes("soundtrack") || normalized.includes("original motion picture");
}

function scoreCandidate(
  candidate: CandidateResult,
  context: { artist: string; title: string; year: number | null },
): number {
  const titleScore = tokenSimilarity(candidate.title, context.title);
  const artistScore = tokenSimilarity(candidate.artist, context.artist);
  const yearDistance =
    context.year && candidate.year ? Math.min(30, Math.abs(candidate.year - context.year)) : 12;
  const yearScore = 1 - yearDistance / 30;
  const sourceBoost = candidate.source === "discogs" ? 0.4 : candidate.source === "local" ? 0.24 : 0.1;
  let penalty = 0;
  if (hasGreatestHitsSignal(context.title) !== hasGreatestHitsSignal(candidate.title)) penalty += 0.07;
  if (hasSoundtrackSignal(context.title) !== hasSoundtrackSignal(candidate.title)) penalty += 0.08;

  return titleScore * 0.45 + artistScore * 0.28 + yearScore * 0.2 + sourceBoost - penalty;
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const artist = (url.searchParams.get("artist") ?? "").trim();
  const title = (url.searchParams.get("title") ?? "").trim();
  const albumId = (url.searchParams.get("albumId") ?? "").trim();
  const year = toIntYear(url.searchParams.get("year") ?? undefined);
  if (!artist || !title) {
    return NextResponse.json({ ok: false, error: "missing_artist_or_title" }, { status: 400 });
  }

  const [discogs, local, itunes] = await Promise.allSettled([
    fetchDiscogs(artist, title),
    albumId ? fetchLocalCandidates(albumId, artist, title) : Promise.resolve([]),
    fetchItunes(artist, title),
  ]);
  const discogsRows = discogs.status === "fulfilled" ? discogs.value : [];
  const localRows = local.status === "fulfilled" ? local.value : [];
  const itunesRows = itunes.status === "fulfilled" ? itunes.value : [];

  const normalizedRows: CandidateResult[] = [];
  for (const candidate of [...discogsRows, ...localRows, ...itunesRows]) {
    const normImg = normalizeCandidateArtworkUrl(candidate.image);
    if (!normImg) continue;
    normalizedRows.push({ ...candidate, image: normImg });
  }

  const scored = normalizedRows
    .map((candidate) => ({
      candidate,
      score: scoreCandidate(candidate, { artist, title, year }),
    }))
    .sort((a, b) => b.score - a.score);

  const seenFp = new Set<string>();
  const merged: CandidateResult[] = [];
  for (const { candidate } of scored) {
    const fp = fingerprintCandidateArtworkUrl(candidate.image);
    if (!fp || seenFp.has(fp)) continue;
    seenFp.add(fp);
    merged.push(candidate);
    if (merged.length >= 48) break;
  }

  return NextResponse.json({
    ok: true,
    artist,
    title,
    total: merged.length,
    candidates: merged.slice(0, 24),
  });
}