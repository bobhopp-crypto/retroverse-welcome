import { createReadStream } from "node:fs";

import { resolveVdjDatabaseXmlPath } from "./constants";
import { fuzzyScoreParts, normalizedMatchKey } from "./fuzzy";
import type { VdjPanelEntry } from "./types";
import { classifyVdjPath, videoMatchBoost, type VdjMediaKind } from "./vdj-media";

function decodeXml(s: string): string {
  return s
    .replace(/&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function attr(block: string, name: string): string {
  const re = new RegExp(`${name}="([^"]*)"`, "i");
  const m = block.match(re);
  return m?.[1] ? decodeXml(m[1]) : "";
}

function parseSongBlock(block: string): {
  filePath: string;
  artist: string;
  title: string;
  remix: string | null;
  album: string | null;
  year: string | null;
} | null {
  const filePath = attr(block, "FilePath");
  if (!filePath || filePath.startsWith("netsearch://")) return null;
  const tagsMatch = block.match(/<Tags\b([^/]*)\/>/i) ?? block.match(/<Tags\b([^>]*)>/i);
  const tags = tagsMatch?.[1] ?? "";
  const artist = attr(`<x ${tags}`, "Author");
  const title = attr(`<x ${tags}`, "Title");
  return {
    filePath,
    artist,
    title,
    remix: attr(`<x ${tags}`, "Remix") || null,
    album: attr(`<x ${tags}`, "Album") || null,
    year: attr(`<x ${tags}`, "Year") || null,
  };
}

async function* iterSongBlocks(xmlPath: string): AsyncGenerator<string> {
  const stream = createReadStream(xmlPath, { encoding: "utf8", highWaterMark: 256 * 1024 });
  let buf = "";
  for await (const chunk of stream) {
    buf += chunk;
    for (;;) {
      const start = buf.indexOf("<Song ");
      if (start === -1) break;
      const end = buf.indexOf("</Song>", start);
      if (end === -1) break;
      yield buf.slice(start, end + 7);
      buf = buf.slice(end + 7);
    }
    if (buf.length > 400_000) buf = buf.slice(-200_000);
  }
}

function blockMatchesNeedles(
  block: string,
  needles: { artist: string; title: string; freeText: string; vdjPath: string | null },
): boolean {
  if (needles.vdjPath) {
    const fp = attr(block, "FilePath");
    return fp === needles.vdjPath || fp.toLowerCase().includes(needles.vdjPath.toLowerCase());
  }
  const lower = block.toLowerCase();
  const artistNeedle = needles.artist.split(/\s+/)[0]?.toLowerCase() ?? "";
  if (artistNeedle.length >= 2 && !lower.includes(artistNeedle)) return false;
  if (needles.freeText) {
    const parts = needles.freeText.toLowerCase().split(/\s+/).filter((p) => p.length > 2);
    if (parts.some((p) => !lower.includes(p))) return false;
  }
  const titleToken = needles.title.split(/\s+/).find((t) => t.length > 3)?.toLowerCase();
  if (titleToken && !lower.includes(titleToken)) return false;
  return true;
}

/** Search live VirtualDJ database.xml (streaming scan). */
export async function searchVdjDatabaseXml(input: {
  artist: string;
  title: string;
  freeText?: string;
  vdjPath?: string | null;
  limit?: number;
}): Promise<{ path: string | null; entries: VdjPanelEntry[] }> {
  const xmlPath = await resolveVdjDatabaseXmlPath();
  if (!xmlPath) return { path: null, entries: [] };

  const limit = input.limit ?? 20;
  const scanCap = limit * 8;
  const needles = {
    artist: input.artist.trim(),
    title: input.title.trim(),
    freeText: (input.freeText ?? "").trim(),
    vdjPath: input.vdjPath?.trim() || null,
  };

  const scored: Array<VdjPanelEntry & { mediaKind: VdjMediaKind; rankScore: number }> = [];

  for await (const block of iterSongBlocks(xmlPath)) {
    if (!blockMatchesNeedles(block, needles)) continue;
    const parsed = parseSongBlock(block);
    if (!parsed) continue;

    const label = `${parsed.artist} — ${parsed.title}`.trim();
    const { score, reason } = fuzzyScoreParts(
      `${label} ${parsed.filePath} ${parsed.remix ?? ""} ${parsed.album ?? ""}`,
      needles.artist,
      needles.title,
      needles.freeText,
    );

    if (needles.vdjPath && parsed.filePath === needles.vdjPath) {
      const mediaKind = classifyVdjPath(parsed.filePath);
      if (mediaKind !== "ignored") {
        scored.push({
          title: parsed.title || "—",
          artist: parsed.artist || "—",
          filePath: parsed.filePath,
          normalizedKey: normalizedMatchKey(parsed.artist, parsed.title),
          score: 100,
          reason: "exact vdjPath",
          remix: parsed.remix,
          album: parsed.album,
          year: parsed.year,
          mediaKind,
          rankScore: 100 + videoMatchBoost(parsed.filePath, mediaKind),
        });
      }
      break;
    }

    if (score < 12) continue;

    const mediaKind = classifyVdjPath(parsed.filePath);
    if (mediaKind === "ignored") continue;

    const rankScore = score + videoMatchBoost(parsed.filePath, mediaKind);

    scored.push({
      title: parsed.title || "—",
      artist: parsed.artist || "—",
      filePath: parsed.filePath,
      normalizedKey: normalizedMatchKey(parsed.artist, parsed.title),
      score,
      reason,
      remix: parsed.remix,
      album: parsed.album,
      year: parsed.year,
      mediaKind,
      rankScore,
    });

    if (scored.length >= scanCap) break;
  }

  scored.sort((a, b) => b.rankScore - a.rankScore || b.score - a.score);
  return { path: xmlPath, entries: scored.slice(0, limit) };
}
