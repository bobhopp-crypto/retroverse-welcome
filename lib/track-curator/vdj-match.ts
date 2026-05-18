import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";

import { normalizeKeyPart } from "@/lib/legacy-playback/playback-key";
import { vdjMediaRoot } from "./constants";

const execFileAsync = promisify(execFile);

export type VdjMatchTier = "strong" | "weak";

export type VdjFileSuggestion = {
  id: string;
  filePath: string;
  fileName: string;
  tier: VdjMatchTier;
  score: number;
  flags: string[];
};

function tokenize(s: string): string[] {
  return normalizeKeyPart(s)
    .split(" ")
    .filter((t) => t.length > 1);
}

function scoreFileName(fileName: string, artist: string, title: string): { score: number; flags: string[] } {
  const base = fileName.replace(/\.[^.]+$/, "");
  const norm = normalizeKeyPart(base);
  const artistTokens = tokenize(artist);
  const titleTokens = tokenize(title);
  const flags: string[] = [];
  let score = 0;

  const artistHit = artistTokens.filter((t) => norm.includes(t)).length;
  const titleHit = titleTokens.filter((t) => norm.includes(t)).length;
  score += artistHit * 12;
  score += titleHit * 18;

  if (artistHit >= Math.min(1, artistTokens.length) && titleHit >= Math.min(2, titleTokens.length)) {
    score += 40;
  }

  if (/\b(extended|ext|12|version|remix)\b/i.test(base)) flags.push("alt");
  if (/\b(live|montreux|concert)\b/i.test(base)) flags.push("live");
  if (/\b(medley|megamix|mashup)\b/i.test(base)) flags.push("medley");

  if (flags.includes("medley")) score -= 35;
  if (flags.includes("live")) score -= 5;
  if (flags.includes("alt") && titleHit >= 2) score += 8;

  return { score, flags };
}

async function findArtistMp4s(root: string, artist: string): Promise<string[]> {
  const needle = artist.split(/\s+/)[0] ?? artist;
  if (!needle || needle.length < 2) return [];
  try {
    const { stdout } = await execFileAsync(
      "find",
      [root, "-maxdepth", "3", "-iname", `*${needle}*.mp4`, "-type", "f"],
      { maxBuffer: 8 * 1024 * 1024 },
    );
    return stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

/** Score local VDJ filenames against chart track artist/title. */
export async function suggestVdjFiles(input: {
  artist: string;
  title: string;
  limit?: number;
}): Promise<VdjFileSuggestion[]> {
  const root = vdjMediaRoot();
  const paths = await findArtistMp4s(root, input.artist);
  const scored: VdjFileSuggestion[] = [];

  for (const filePath of paths) {
    const fileName = path.basename(filePath);
    const { score, flags } = scoreFileName(fileName, input.artist, input.title);
    if (score < 15) continue;
    const tier: VdjMatchTier =
      score >= 55 && !flags.includes("medley") ? "strong" : score >= 25 ? "weak" : "weak";
    if (tier === "weak" && score < 25) continue;
    scored.push({
      id: Buffer.from(filePath).toString("base64url"),
      filePath,
      fileName,
      tier,
      score,
      flags,
    });
  }

  scored.sort((a, b) => b.score - a.score);
  const cap = input.limit ?? 12;
  return scored.slice(0, cap);
}
