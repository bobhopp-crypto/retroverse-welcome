/**
 * Mass reconcile legacy cover archive → retroverse_album_artwork + public/retroverse/covers.
 *
 * Inventory: scans legacy tree (recursive), reports patterns and counts.
 * Passes: M (CSV mapping), Id (RVAL folder/filename), A exact, B fuzzy keys,
 *         C token/Jaccard, C2 strong artist + partial album, D loose staging fallback.
 *
 * Safety: does NOT update albums whose primary artwork is curator/workbench provenance
 *         (cover_source workbench:* or notes containing living-archive action=).
 *
 * Usage:
 *   load .env.local (SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL)
 *   npx tsx scripts/reconcile_legacy_cover_archive.ts              # dry-run + report
 *   npx tsx scripts/reconcile_legacy_cover_archive.ts --apply      # copy + DB writes
 *
 * Env:
 *   RETROVERSE_LEGACY_COVERS_ROOT — single root (default master path below)
 *   RETROVERSE_LEGACY_COVERS_ROOTS — comma/semicolon list; merged scan (paths prefixed as basename::relpath)
 *   RETROVERSE_COVER_LEGACY_MAPPING — optional CSV: relative_path,retroverse_album_id (path may include root:: prefix)
 */
import { copyFile, mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { readFileSync } from "node:fs";

import { createClient } from "@supabase/supabase-js";
import type { SupabaseClient } from "@supabase/supabase-js";

import { computeDiscoverCoverageReport } from "@/lib/discover-coverage";
import { selectCanonicalArtwork, type RetroverseArtworkRow } from "@/lib/retroverse-artwork";

const WORKSPACE = process.cwd();
const PAGE = 1000;
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

type ArtworkDbRow = RetroverseArtworkRow & {
  retroverse_album_artwork_id: string;
  notes?: string | null;
};

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
};

type LegacyFile = {
  relPath: string;
  absPath: string;
  ext: string;
  sizeBytes: number;
  parentAlbumId: string | null;
  parseKind: "rval_slug" | "artist_album_underscore" | "artist_album_dash" | "unparsed";
  artistRaw: string | null;
  albumRaw: string | null;
  rvalInFilename: string | null;
  artistKey: string | null;
  albumKey: string | null;
  artistLooseKey: string | null;
  albumLooseKey: string | null;
  albumKeyFuzzy: string | null;
  artistTokens: string[];
  albumTokens: string[];
};

type MatchPlan = {
  albumId: string;
  legacyRel: string;
  pass: "M" | "Id" | "A" | "B" | "C" | "C2" | "D";
  confidence: number;
  ambScoreGap?: number;
};

function loadEnvLocal() {
  const p = path.join(WORKSPACE, ".env.local");
  const raw = readFileSync(p, "utf8");
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.startsWith("#")) continue;
    const eq = t.indexOf("=");
    if (eq <= 0) continue;
    const k = t.slice(0, eq).trim();
    let v = t.slice(eq + 1).trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    if (!process.env[k]) process.env[k] = v;
  }
}

function parseArgs() {
  const argv = process.argv.slice(2);
  return {
    apply: argv.includes("--apply"),
    legacyRoot: (() => {
      const i = argv.indexOf("--legacy-root");
      return i >= 0 && argv[i + 1] ? argv[i + 1] : null;
    })(),
    mappingPath: process.env.RETROVERSE_COVER_LEGACY_MAPPING?.trim() || null,
    limit: (() => {
      const i = argv.indexOf("--limit");
      if (i < 0 || !argv[i + 1]) return Infinity;
      const n = Number.parseInt(argv[i + 1], 10);
      return Number.isFinite(n) ? n : Infinity;
    })(),
  };
}

/** Default: flat legacy corpus under old Retroverse web app (50k+ `artist_-_album.jpg`). */
const DEFAULT_LEGACY_SITES_COVERS = "/Users/bobhopp/Sites/retroverse/apps/web/public/covers";

function defaultLegacyRoot(): string {
  if (process.env.RETROVERSE_LEGACY_COVERS_ROOT?.trim()) return path.resolve(process.env.RETROVERSE_LEGACY_COVERS_ROOT.trim());
  if (process.env.RETROVERSE_COVERS_MASTER_ROOT?.trim()) return path.resolve(process.env.RETROVERSE_COVERS_MASTER_ROOT.trim());
  return DEFAULT_LEGACY_SITES_COVERS;
}

function resolveLegacyRoots(cliRoot: string | null): string[] {
  const raw = process.env.RETROVERSE_LEGACY_COVERS_ROOTS?.split(/[;,]/);
  const multi = (raw ?? [])
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p.replace(/^~/, process.env.HOME ?? "~")));
  if (multi.length > 0) return [...new Set(multi)];
  return [path.resolve(cliRoot ?? defaultLegacyRoot())];
}

function rootPathLabel(rootAbs: string): string {
  const base = path.basename(rootAbs).replace(/[^a-zA-Z0-9._-]+/g, "_");
  return base || "root";
}

async function walkLegacyForest(roots: string[]): Promise<LegacyFile[]> {
  const acc: LegacyFile[] = [];
  const labels = new Map<string, number>();
  for (const root of roots) {
    let label = rootPathLabel(root);
    const n = (labels.get(label) ?? 0) + 1;
    labels.set(label, n);
    if (n > 1) label = `${label}~${n}`;
    const files = await walkLegacyImages(root);
    for (const f of files) acc.push({ ...f, relPath: `${label}::${f.relPath}` });
  }
  return acc;
}

function stripParenthetical(value: string): string {
  return value.replace(/\(.*?\)/g, " ").replace(/\[.*?\]/g, " ");
}

function normalizeKey(value: string): string {
  return value
    .normalize("NFKC")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['".,!?/\\:;`~*+|•·]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function stripEditionNoise(value: string): string {
  return value
    .replace(/\b(deluxe|super\s*deluxe)\b/gi, " ")
    .replace(/\b(remaster|remastered)\b/gi, " ")
    .replace(/\b(special\s+edition|expanded\s+edition)\b/gi, " ")
    .replace(/\b(anniversary\s+edition|\d+(st|nd|rd|th)\s+anniversary)\b/gi, " ")
    .replace(/\b(explicit|clean)\b/gi, " ")
    .replace(/\b(live(\s+(at|from|in))?|unplugged|acoustic(\s+session(s)?)?)\b/gi, " ")
    .replace(/\b(bonus\s+track(s)?|bonus\s+disc)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLooseKey(value: string): string {
  return normalizeKey(stripParenthetical(value))
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeFuzzyAlbumTitle(value: string): string {
  return normalizeKey(stripEditionNoise(stripParenthetical(value)));
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

function tokenize(norm: string): string[] {
  return norm.split(/\s+/).filter((t) => t.length >= 3);
}

function jaccard(a: string[], b: string[]): number {
  const A = new Set(a);
  const B = new Set(b);
  if (A.size === 0 && B.size === 0) return 1;
  let inter = 0;
  for (const x of A) if (B.has(x)) inter += 1;
  const u = A.size + B.size - inter;
  return u === 0 ? 0 : inter / u;
}

function normalizeDashSeparators(s: string): string {
  return s.replace(/[–—−]/g, "-");
}

function parseLegacyFilename(name: string): Pick<
  LegacyFile,
  | "parseKind"
  | "artistRaw"
  | "albumRaw"
  | "rvalInFilename"
  | "artistKey"
  | "albumKey"
  | "artistLooseKey"
  | "albumLooseKey"
  | "albumKeyFuzzy"
  | "artistTokens"
  | "albumTokens"
> {
  const stem = normalizeDashSeparators(name.replace(/\.[^.]+$/, ""));
  const rvalM = stem.match(/^(RVAL\d{6,})__(.+)$/i);
  if (rvalM) {
    const id = rvalM[1].toUpperCase();
    const rest = rvalM[2];
    const parts = rest.split("__").filter(Boolean);
    const artistGuess = parts[0]?.replace(/-/g, " ").trim() ?? null;
    const albumGuess = parts.slice(1).join(" ").replace(/-/g, " ").trim() || null;
    const ak = artistGuess ? normalizeKey(artistGuess) : null;
    const alb = albumGuess ? normalizeKey(albumGuess) : null;
    return {
      parseKind: "rval_slug",
      artistRaw: artistGuess,
      albumRaw: albumGuess,
      rvalInFilename: id,
      artistKey: ak,
      albumKey: alb,
      artistLooseKey: artistGuess ? normalizeLooseKey(artistGuess) : null,
      albumLooseKey: albumGuess ? normalizeLooseKey(albumGuess) : null,
      albumKeyFuzzy: albumGuess ? normalizeFuzzyAlbumTitle(albumGuess) : null,
      artistTokens: ak ? tokenize(ak) : [],
      albumTokens: alb ? tokenize(alb) : [],
    };
  }
  if (stem.includes("_-_")) {
    const [artistRaw, ...rest] = stem.split("_-_");
    const ar = artistRaw.replace(/_/g, " ").trim();
    const al = rest.join("_-_").replace(/_/g, " ").trim();
    const ak = normalizeKey(ar);
    const bk = normalizeKey(al);
    return {
      parseKind: "artist_album_underscore",
      artistRaw: ar,
      albumRaw: al,
      rvalInFilename: null,
      artistKey: ak,
      albumKey: bk,
      artistLooseKey: normalizeLooseKey(ar),
      albumLooseKey: normalizeLooseKey(al),
      albumKeyFuzzy: normalizeFuzzyAlbumTitle(al),
      artistTokens: tokenize(ak),
      albumTokens: tokenize(bk),
    };
  }
  const dashFlex = stem.match(/^(.+?)\s*-\s*(.+)$/);
  if (dashFlex && !stem.includes("_-_")) {
    const ar = dashFlex[1].replace(/_/g, " ").trim();
    const al = dashFlex[2].replace(/_/g, " ").trim();
    if (ar.length >= 1 && al.length >= 1) {
      const ak = normalizeKey(ar);
      const bk = normalizeKey(al);
      return {
        parseKind: "artist_album_dash",
        artistRaw: ar,
        albumRaw: al,
        rvalInFilename: null,
        artistKey: ak,
        albumKey: bk,
        artistLooseKey: normalizeLooseKey(ar),
        albumLooseKey: normalizeLooseKey(al),
        albumKeyFuzzy: normalizeFuzzyAlbumTitle(al),
        artistTokens: tokenize(ak),
        albumTokens: tokenize(bk),
      };
    }
  }
  return {
    parseKind: "unparsed",
    artistRaw: null,
    albumRaw: null,
    rvalInFilename: null,
    artistKey: null,
    albumKey: null,
    artistLooseKey: null,
    albumLooseKey: null,
    albumKeyFuzzy: null,
    artistTokens: [],
    albumTokens: [],
  };
}

function patternLabel(f: LegacyFile): string {
  if (f.parentAlbumId) return "nested_rval_folder";
  if (f.parseKind === "rval_slug") return "rval_filename";
  if (f.parseKind === "artist_album_underscore") return "artist_-_album";
  if (f.parseKind === "artist_album_dash") return "artist_-_album_space";
  return "unparsed";
}

function isCuratorProtected(primary: ArtworkDbRow | null): boolean {
  if (!primary?.canonical_cover_path?.trim()) return false;
  const src = (primary.cover_source ?? "").trim();
  if (src.startsWith("workbench:")) return true;
  if (src === "itunes_canonical_pass") return true;
  const notes = primary.notes ?? "";
  if (notes.includes("living-archive action=")) return true;
  if (/\bcurator_approved\b/i.test(notes) || /\bmanual_cover\b/i.test(notes)) return true;
  if (/\bcurator_lock\b/i.test(notes) || /\bhigh_confidence_manual\b/i.test(notes)) return true;
  return false;
}

/** User-facing staging pass A–D for reports + `notes` (alongside technical pass Id/M/A/B/C/C2/D). */
function stagingPassLetter(technical: MatchPlan["pass"]): "A" | "B" | "C" | "D" {
  if (technical === "Id" || technical === "M" || technical === "A") return "A";
  if (technical === "B" || technical === "C") return "B";
  if (technical === "C2") return "C";
  return "D";
}

function buildReconNotes(
  plan: MatchPlan,
  file: LegacyFile,
  legacyRoots: string[],
): string {
  const archive0 = legacyRoots[0] ?? DEFAULT_LEGACY_SITES_COVERS;
  const stage = stagingPassLetter(plan.pass);
  return [
    `legacy_cover_recon`,
    `archive=${archive0}`,
    `staging_pass=${stage}`,
    `pass=${plan.pass}`,
    `conf=${plan.confidence}`,
    `src=${file.relPath}`,
  ].join(" ");
}

function hasLocalDeployCover(pathVal: string | null | undefined): boolean {
  const p = pathVal?.trim();
  if (!p) return false;
  if (/^https?:\/\//i.test(p)) return false;
  return true;
}

async function paginateAllAlbums(supabase: SupabaseClient): Promise<AlbumRow[]> {
  const out: AlbumRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as AlbumRow[];
    out.push(...rows);
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function paginateAllArtists(supabase: SupabaseClient): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("retroverse_artists")
      .select("retroverse_artist_id, canonical_artist_name")
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = data ?? [];
    for (const r of rows as { retroverse_artist_id: string; canonical_artist_name: string }[]) {
      map.set(r.retroverse_artist_id, r.canonical_artist_name);
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return map;
}

async function paginateAllArtwork(supabase: SupabaseClient): Promise<ArtworkDbRow[]> {
  const out: ArtworkDbRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("retroverse_album_artwork")
      .select(
        "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, is_primary, canonical_cover_path, cover_source, artwork_status, notes",
      )
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const rows = (data ?? []) as ArtworkDbRow[];
    out.push(
      ...rows.map((row) => ({
        ...row,
        is_primary: row.is_primary ?? row.artwork_role === "primary",
      })),
    );
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return out;
}

async function walkLegacyImages(root: string): Promise<LegacyFile[]> {
  const baseLen = root.length + 1;
  const acc: LegacyFile[] = [];

  async function walk(dir: string) {
    let ents;
    try {
      ents = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of ents) {
      if (e.name.startsWith(".")) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) await walk(full);
      else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!IMAGE_EXT.has(ext)) continue;
        const rel = full.slice(baseLen).split(path.sep).join("/");
        const st = await stat(full);
        const parent = path.basename(path.dirname(full));
        const parentAlbumId = /^RVAL\d{6,}$/i.test(parent) ? parent.toUpperCase() : null;
        const parsed = parseLegacyFilename(e.name);
        acc.push({
          relPath: rel,
          absPath: full,
          ext: ext.replace(".", ""),
          sizeBytes: st.size,
          parentAlbumId,
          ...parsed,
        });
      }
    }
  }

  await walk(root);
  return acc;
}

function legacyRootLabels(roots: string[]): string[] {
  const counts = new Map<string, number>();
  const out: string[] = [];
  for (const root of roots) {
    let label = rootPathLabel(root);
    const n = (counts.get(label) ?? 0) + 1;
    counts.set(label, n);
    if (n > 1) label = `${label}~${n}`;
    out.push(label);
  }
  return out;
}

function resolveMappedLegacyAbs(rel: string, roots: string[], labels: string[]): string | null {
  const trimmed = rel.trim();
  if (!trimmed) return null;
  if (trimmed.includes("::")) {
    const [label, inner] = trimmed.split("::", 2);
    const idx = labels.indexOf(label.trim());
    if (idx < 0) return null;
    const abs = path.resolve(roots[idx], inner.trim());
    if (!abs.startsWith(path.resolve(roots[idx]))) return null;
    return abs;
  }
  if (roots.length === 1) {
    const abs = path.resolve(roots[0], trimmed);
    if (!abs.startsWith(path.resolve(roots[0]))) return null;
    return abs;
  }
  return null;
}

function absToLegacyRel(absNormalized: string, roots: string[], labels: string[]): string | null {
  for (let i = 0; i < roots.length; i++) {
    const r = path.resolve(roots[i]);
    const abs = path.resolve(absNormalized);
    if (abs.startsWith(r)) {
      const inner = abs.slice(r.length).replace(/^[\\/]+/, "").split(path.sep).join("/");
      return `${labels[i]}::${inner}`;
    }
  }
  return null;
}

async function loadMappingCsv(
  filePath: string,
  roots: string[],
  labels: string[],
): Promise<Map<string, string>> {
  const raw = await readFile(filePath, "utf8");
  const map = new Map<string, string>();
  for (const line of raw.split("\n")) {
    const t = line.trim();
    if (!t || t.toLowerCase().startsWith("relative_path")) continue;
    const comma = t.indexOf(",");
    if (comma <= 0) continue;
    const rel = t.slice(0, comma).trim();
    const albumId = t.slice(comma + 1).trim();
    if (!rel || !/^RVAL\d{6,}$/i.test(albumId)) continue;
    const abs = resolveMappedLegacyAbs(rel, roots, labels);
    if (!abs) continue;
    const relKey = absToLegacyRel(abs, roots, labels);
    if (!relKey) continue;
    map.set(albumId.toUpperCase(), relKey);
  }
  return map;
}

function pickPrimaryArtwork(rows: ArtworkDbRow[], albumId: string): ArtworkDbRow | null {
  const cast = rows as RetroverseArtworkRow[];
  return selectCanonicalArtwork(cast, albumId, null) as ArtworkDbRow | null;
}

function nextArtworkId(rows: ArtworkDbRow[]): number {
  const max = Math.max(
    0,
    ...rows.map((r) => {
      const m = String(r.retroverse_album_artwork_id ?? "").match(/^RVAW(\d+)$/);
      return m ? Number.parseInt(m[1], 10) : 0;
    }),
  );
  return max + 1;
}

function albumExactKey(artistName: string, albumTitle: string): string {
  return `${normalizeKey(artistName)}::${normalizeKey(albumTitle)}`;
}

function albumFuzzyKey(artistName: string, albumTitle: string): string {
  return `${normalizeKey(stripEditionNoise(stripParenthetical(artistName)))}::${normalizeFuzzyAlbumTitle(albumTitle)}`;
}

function scorePassC2(file: LegacyFile, artist: string, albumTitle: string): number | null {
  if (!file.artistKey || file.albumTokens.length === 0) return null;
  const artistKey = normalizeKey(artist);
  const titleFuzzy = normalizeFuzzyAlbumTitle(albumTitle);
  const dbATok = tokenize(artistKey);
  const dbTok = tokenize(titleFuzzy.length > 0 ? titleFuzzy : normalizeKey(albumTitle));
  const aj = jaccard(dbATok, file.artistTokens);
  const loose = file.artistLooseKey === normalizeLooseKey(artist);
  if (aj < 0.35 && !loose) return null;
  let hit = 0;
  const dbset = new Set(dbTok);
  for (const t of file.albumTokens) if (dbset.has(t)) hit += 1;
  const frac = hit / Math.max(1, file.albumTokens.length);
  const ak = file.albumKey ?? "";
  const titleNorm = normalizeKey(stripEditionNoise(stripParenthetical(albumTitle)));
  const substr = ak.length >= 3 && (titleNorm.includes(ak) || normalizeKey(albumTitle).includes(ak));
  if (frac < 0.28 && !substr) return null;
  return 0.5 + 0.35 * frac + 0.15 * aj;
}

function scorePassD(file: LegacyFile, artist: string, albumTitle: string): number | null {
  if (file.parseKind === "unparsed" && !file.parentAlbumId && !file.rvalInFilename) return null;
  const titleFuzzy = normalizeFuzzyAlbumTitle(albumTitle);
  const dbATok = tokenize(normalizeKey(artist));
  const dbTok = tokenize(titleFuzzy.length > 0 ? titleFuzzy : normalizeKey(albumTitle));
  if (dbATok.length === 0 && dbTok.length === 0) return null;
  const aj = jaccard(dbATok, file.artistTokens);
  const tj = jaccard(dbTok, file.albumTokens);
  const combined = 0.45 * aj + 0.55 * tj;
  const firstTok = dbATok[0];
  const looseBoost = Boolean(firstTok && file.artistTokens.includes(firstTok) && tj >= 0.14);
  if (combined < 0.22 && !looseBoost) return null;
  if (aj < 0.06 && tj < 0.14) return null;
  return combined;
}

function tryPickScored(
  albumId: string,
  candidates: LegacyFile[],
  usedFiles: Set<string>,
  pass: MatchPlan["pass"],
  scorer: (f: LegacyFile) => number | null,
  ambiguous: Array<{ albumId: string; detail: string }>,
  minGap: number,
): MatchPlan | null {
  const avail = candidates.filter((c) => !usedFiles.has(c.relPath));
  if (avail.length === 0) return null;
  const scored = avail
    .map((file) => {
      const s = scorer(file);
      return s === null ? null : { file, score: s };
    })
    .filter((x): x is { file: LegacyFile; score: number } => x !== null)
    .sort((a, b) => b.score - a.score || b.file.sizeBytes - a.file.sizeBytes);
  if (scored.length === 0) return null;
  const best = scored[0];
  const second = scored[1];
  const gap = second ? best.score - second.score : 1;
  if (avail.length > 1 && gap < minGap) {
    ambiguous.push({ albumId, detail: `${pass} gap=${gap.toFixed(3)} ties=${avail.length}` });
  }
  return {
    albumId,
    legacyRel: best.file.relPath,
    pass,
    confidence: Number(Math.min(0.99, best.score).toFixed(3)),
    ambScoreGap: Number(gap.toFixed(3)),
  };
}

async function main() {
  loadEnvLocal();
  const { apply, legacyRoot: rootArg, mappingPath, limit } = parseArgs();
  const legacyRoots = resolveLegacyRoots(rootArg);

  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Need SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY (from .env.local).");
  }
  const supabase = createClient(supabaseUrl, serviceRoleKey, { auth: { persistSession: false, autoRefreshToken: false } });

  const beforeCoverage = await computeDiscoverCoverageReport();

  let legacyFiles: LegacyFile[] = [];
  try {
    legacyFiles = await walkLegacyForest(legacyRoots);
  } catch (e) {
    console.error("Failed to read legacy roots:", legacyRoots.join(", "), e);
    throw e;
  }

  const rootLabels = legacyRootLabels(legacyRoots);

  const patternCounts: Record<string, number> = {};
  const extCounts: Record<string, number> = {};
  const topFolders: Record<string, number> = {};
  let rvalTagged = 0;
  for (const f of legacyFiles) {
    const pl = patternLabel(f);
    patternCounts[pl] = (patternCounts[pl] ?? 0) + 1;
    extCounts[f.ext] = (extCounts[f.ext] ?? 0) + 1;
    const top = f.relPath.split("/")[0]?.split("::")[0] ?? "";
    if (top) topFolders[top] = (topFolders[top] ?? 0) + 1;
    if (f.rvalInFilename || f.parentAlbumId) rvalTagged += 1;
  }

  const [albums, artistById, artworkRows] = await Promise.all([
    paginateAllAlbums(supabase),
    paginateAllArtists(supabase),
    paginateAllArtwork(supabase),
  ]);

  const artworkByAlbum = new Map<string, ArtworkDbRow[]>();
  for (const row of artworkRows) {
    artworkByAlbum.set(row.retroverse_album_id, [...(artworkByAlbum.get(row.retroverse_album_id) ?? []), row]);
  }

  let passMmap = new Map<string, string>();
  if (mappingPath) {
    passMmap = await loadMappingCsv(mappingPath, legacyRoots, rootLabels);
  }

  const legacyByRel = new Map(legacyFiles.map((f) => [f.relPath, f]));
  const filesByExactKey = new Map<string, LegacyFile[]>();
  const filesByFuzzyKey = new Map<string, LegacyFile[]>();
  for (const f of legacyFiles) {
    if (f.artistKey && f.albumKey) {
      const k = `${f.artistKey}::${f.albumKey}`;
      filesByExactKey.set(k, [...(filesByExactKey.get(k) ?? []), f]);
    }
    if (f.artistKey && f.albumKeyFuzzy) {
      const fk = `${normalizeKey(stripEditionNoise(stripParenthetical(f.artistRaw ?? "")))}::${f.albumKeyFuzzy}`;
      filesByFuzzyKey.set(fk, [...(filesByFuzzyKey.get(fk) ?? []), f]);
    }
  }

  const albumTokenToFiles = new Map<string, Set<LegacyFile>>();
  const artistTokenToFiles = new Map<string, Set<LegacyFile>>();
  for (const f of legacyFiles) {
    for (const t of f.albumTokens) {
      if (!albumTokenToFiles.has(t)) albumTokenToFiles.set(t, new Set());
      albumTokenToFiles.get(t)!.add(f);
    }
    for (const t of f.artistTokens) {
      if (!artistTokenToFiles.has(t)) artistTokenToFiles.set(t, new Set());
      artistTokenToFiles.get(t)!.add(f);
    }
  }

  const filesByRvalAlbum = new Map<string, LegacyFile[]>();
  for (const f of legacyFiles) {
    const id = f.parentAlbumId ?? f.rvalInFilename ?? null;
    if (!id) continue;
    const arr = filesByRvalAlbum.get(id) ?? [];
    if (!arr.some((x) => x.relPath === f.relPath)) arr.push(f);
    filesByRvalAlbum.set(id, arr);
  }

  const eligibleAlbums = albums.filter((album) => {
    const primary = pickPrimaryArtwork(artworkRows, album.retroverse_album_id);
    if (isCuratorProtected(primary)) return false;
    if (hasLocalDeployCover(primary?.canonical_cover_path)) return false;
    return true;
  });

  const orderedEligible = [...eligibleAlbums].sort((a, b) => a.retroverse_album_id.localeCompare(b.retroverse_album_id));
  const capped = Number.isFinite(limit) ? orderedEligible.slice(0, limit) : orderedEligible;

  const usedFiles = new Set<string>();
  const plans: MatchPlan[] = [];
  const ambiguous: Array<{ albumId: string; detail: string }> = [];

  for (const album of capped) {
    const artist = artistById.get(album.retroverse_artist_id) ?? "Unknown artist";
    const exK = albumExactKey(artist, album.canonical_album_title);
    const fzK = albumFuzzyKey(artist, album.canonical_album_title);
    const artistKey = normalizeKey(artist);
    const titleKey = normalizeKey(album.canonical_album_title);
    const artistLoose = normalizeLooseKey(artist);
    const titleLoose = normalizeLooseKey(album.canonical_album_title);
    const titleFuzzy = normalizeFuzzyAlbumTitle(album.canonical_album_title);
    const dbArtistTok = tokenize(artistKey);
    const dbAlbumTok = tokenize(titleFuzzy.length > 0 ? titleFuzzy : titleKey);

    const tryPick = (candidates: LegacyFile[], pass: MatchPlan["pass"], baseConfidence: number): MatchPlan | null => {
      const avail = candidates.filter((c) => !usedFiles.has(c.relPath));
      if (avail.length === 0) return null;
      const scored = avail
        .map((file) => {
          let score = baseConfidence;
          if (file.artistKey === artistKey && file.albumKey === titleKey) score += 0.2;
          else if (file.artistLooseKey === artistLoose && file.albumLooseKey === titleLoose) score += 0.15;
          else if (pass === "C") {
            const aj = jaccard(dbArtistTok, file.artistTokens);
            const tj = jaccard(dbAlbumTok, file.albumTokens);
            score = 0.45 * aj + 0.55 * tj;
          }
          return { file, score };
        })
        .sort((a, b) => b.score - a.score || b.file.sizeBytes - a.file.sizeBytes);
      const best = scored[0];
      const second = scored[1];
      const gap = second ? best.score - second.score : 1;
      if (pass === "C" && (best.score < 0.36 || jaccard(dbArtistTok, best.file.artistTokens) < 0.14)) return null;
      if (pass === "B" && best.score < 0.7) return null;
      if (avail.length > 1 && gap < 0.02) {
        ambiguous.push({ albumId: album.retroverse_album_id, detail: `${pass} gap=${gap.toFixed(3)} ties=${avail.length}` });
      }
      return {
        albumId: album.retroverse_album_id,
        legacyRel: best.file.relPath,
        pass,
        confidence: Number(Math.min(0.99, best.score).toFixed(3)),
        ambScoreGap: Number(gap.toFixed(3)),
      };
    };

    let plan: MatchPlan | null = null;

    const mRel = passMmap.get(album.retroverse_album_id.toUpperCase());
    if (mRel) {
      const file = legacyByRel.get(mRel);
      if (file && !usedFiles.has(file.relPath)) {
        plan = { albumId: album.retroverse_album_id, legacyRel: file.relPath, pass: "M", confidence: 0.98, ambScoreGap: 1 };
      }
    }

    if (!plan) {
      const idFiles = filesByRvalAlbum.get(album.retroverse_album_id) ?? [];
      const idPick = idFiles.length > 0 ? tryPick(idFiles, "Id", 0.86) : null;
      plan = idPick;
    }

    if (!plan) {
      const exactCandidates = filesByExactKey.get(exK) ?? [];
      plan = tryPick(exactCandidates, "A", 0.92);
    }

    if (!plan) {
      const fuzzyCandidates = filesByFuzzyKey.get(fzK) ?? [];
      plan = tryPick(fuzzyCandidates, "B", 0.8);
    }

    if (!plan && dbAlbumTok.length > 0) {
      const candSet = new Set<LegacyFile>();
      for (const t of dbAlbumTok) {
        for (const f of albumTokenToFiles.get(t) ?? []) candSet.add(f);
      }
      plan = tryPick([...candSet], "C", 0.5);
    }

    if (!plan) {
      const candC2 = new Set<LegacyFile>();
      for (const t of dbArtistTok) for (const f of artistTokenToFiles.get(t) ?? []) candC2.add(f);
      for (const t of dbAlbumTok) for (const f of albumTokenToFiles.get(t) ?? []) candC2.add(f);
      plan = tryPickScored(
        album.retroverse_album_id,
        [...candC2],
        usedFiles,
        "C2",
        (f) => scorePassC2(f, artist, album.canonical_album_title),
        ambiguous,
        0.015,
      );
    }

    if (!plan) {
      const candD = new Set<LegacyFile>();
      for (const t of dbArtistTok) for (const f of artistTokenToFiles.get(t) ?? []) candD.add(f);
      for (const t of dbAlbumTok) for (const f of albumTokenToFiles.get(t) ?? []) candD.add(f);
      plan = tryPickScored(
        album.retroverse_album_id,
        [...candD],
        usedFiles,
        "D",
        (f) => scorePassD(f, artist, album.canonical_album_title),
        ambiguous,
        0.01,
      );
    }

    if (plan) {
      usedFiles.add(plan.legacyRel);
      plans.push(plan);
    }
  }

  const unmatchedLegacy = legacyFiles.filter((f) => !usedFiles.has(f.relPath));

  let applied = 0;
  let ordinal = nextArtworkId(artworkRows);

  if (apply) {
    for (const plan of plans) {
      const album = albums.find((a) => a.retroverse_album_id === plan.albumId);
      if (!album) continue;
      const artist = artistById.get(album.retroverse_artist_id) ?? "unknown-artist";
      const file = legacyByRel.get(plan.legacyRel);
      if (!file) continue;

      const ext = path.extname(file.absPath).replace(".", "") || "jpg";
      const targetFilename = `${plan.albumId}__${slugify(artist)}__${slugify(album.canonical_album_title)}.${ext}`;
      const albumDir = path.join(WORKSPACE, "public/retroverse/covers", plan.albumId);
      await mkdir(albumDir, { recursive: true });
      const targetAbs = path.join(albumDir, targetFilename);
      await copyFile(file.absPath, targetAbs);

      const canonicalPath = `public/retroverse/covers/${plan.albumId}/${targetFilename}`;
      const status = plan.pass === "A" || plan.pass === "M" || plan.pass === "Id" ? "verified" : "pending";
      const notes = buildReconNotes(plan, file, legacyRoots);

      const rows = artworkByAlbum.get(plan.albumId) ?? [];
      const targetRow =
        rows.find((row) => row.is_primary) ?? rows.find((row) => row.artwork_role === "primary") ?? rows[0];

      if (targetRow?.retroverse_album_artwork_id) {
        const { error } = await supabase
          .from("retroverse_album_artwork")
          .update({
            canonical_cover_path: canonicalPath,
            cover_source: "legacy_sites_web_covers",
            artwork_status: status,
            artwork_role: "primary",
            is_primary: true,
            notes,
          })
          .eq("retroverse_album_artwork_id", targetRow.retroverse_album_artwork_id);
        if (error) throw error;
      } else {
        const newId = `RVAW${String(ordinal).padStart(6, "0")}`;
        ordinal += 1;
        const { error } = await supabase.from("retroverse_album_artwork").insert({
          retroverse_album_artwork_id: newId,
          retroverse_album_id: plan.albumId,
          retroverse_album_edition_id: null,
          artwork_role: "primary",
          is_primary: true,
          canonical_cover_path: canonicalPath,
          cover_source: "legacy_sites_web_covers",
          artwork_status: status,
          width_px: null,
          height_px: null,
          notes,
        });
        if (error) throw error;
        artworkRows.push({
          retroverse_album_artwork_id: newId,
          retroverse_album_id: plan.albumId,
          retroverse_album_edition_id: null,
          artwork_role: "primary",
          is_primary: true,
          canonical_cover_path: canonicalPath,
          cover_source: "legacy_sites_web_covers",
          artwork_status: status,
          notes,
        });
        artworkByAlbum.set(plan.albumId, [...(artworkByAlbum.get(plan.albumId) ?? []), artworkRows[artworkRows.length - 1]]);
      }
      applied += 1;
    }
  }

  const afterCoverage = apply ? await computeDiscoverCoverageReport() : null;

  const runId = `legacy_cover_recon_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const outDir = path.join(WORKSPACE, "data", "generated", "legacy_cover_recon");
  await mkdir(outDir, { recursive: true });
  const jsonPath = path.join(outDir, `${runId}.json`);
  const resolverPath = path.join(outDir, `${runId}_resolver_map.json`);

  const albumById = new Map(albums.map((a) => [a.retroverse_album_id, a]));

  const stagingPassByLetter = plans.reduce<Record<string, number>>((acc, p) => {
    const s = stagingPassLetter(p.pass);
    acc[s] = (acc[s] ?? 0) + 1;
    return acc;
  }, {});

  const examplesSuccess = plans.slice(0, 25).map((p) => {
    const al = albumById.get(p.albumId);
    const ar = al ? (artistById.get(al.retroverse_artist_id) ?? "?") : "?";
    return {
      album_id: p.albumId,
      artist: ar,
      album: al?.canonical_album_title ?? "?",
      technical_pass: p.pass,
      staging_pass: stagingPassLetter(p.pass),
      confidence: p.confidence,
      legacy_file: p.legacyRel,
    };
  });

  const examplesAmbiguous = ambiguous.slice(0, 40).map((row) => {
    const al = albumById.get(row.albumId);
    const ar = al ? (artistById.get(al.retroverse_artist_id) ?? "?") : "?";
    return {
      album_id: row.albumId,
      artist: ar,
      album: al?.canonical_album_title ?? "?",
      detail: row.detail,
    };
  });

  const summary = {
    run_id: runId,
    generated_at: new Date().toISOString(),
    apply,
    legacy_roots: legacyRoots,
    inventory: {
      total_image_files: legacyFiles.length,
      extension_counts: extCounts,
      pattern_counts: patternCounts,
      top_level_folder_counts: Object.fromEntries(
        Object.entries(topFolders).sort((a, b) => b[1] - a[1]).slice(0, 40),
      ),
      rval_embedded_folder_or_filename: rvalTagged,
    },
    protection: {
      curator_skips_primary_with_workbench_or_living_notes: true,
    },
    eligibility: {
      total_albums: albums.length,
      eligible_missing_local_non_curator: eligibleAlbums.length,
      capped_to_limit: capped.length,
    },
    passes: {
      M_mapping_rows: passMmap.size,
      planned_matches: plans.length,
      by_pass: plans.reduce<Record<string, number>>((acc, p) => {
        acc[p.pass] = (acc[p.pass] ?? 0) + 1;
        return acc;
      }, {}),
    },
    discover_coverage: {
      before: beforeCoverage,
      after: afterCoverage,
    },
    staging_pass_counts_ABCD: stagingPassByLetter,
    examples_successful_matches: examplesSuccess,
    examples_ambiguous_ties: examplesAmbiguous,
    unmatched_legacy_files: unmatchedLegacy.map((f) => f.relPath),
    ambiguous_albums: ambiguous,
    applied_count: applied,
    resolver_map: plans.map((p) => ({ retroverse_album_id: p.albumId, legacy_relative_path: p.legacyRel, pass: p.pass })),
  };

  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");
  await writeFile(resolverPath, JSON.stringify(summary.resolver_map, null, 2), "utf8");

  const docPath = path.join(WORKSPACE, "docs", "LEGACY_COVER_RECONCILIATION.md");
  const md = [
    "# Legacy cover archive reconciliation",
    "",
    `Run id: \`${runId}\``,
    `- Legacy roots: \`${legacyRoots.join(", ")}\``,
    `- Mode: **${apply ? "APPLY (DB + public copy)" : "DRY-RUN"}**`,
    "",
    "## Step 1 — Legacy inventory",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Total image files | ${legacyFiles.length} |`,
    `| Files with RVAL parent folder or RVAL-prefixed name | ${rvalTagged} |`,
    "",
    "### Filename / folder patterns",
    "",
    "| Pattern | Count |",
    "|---------|-------|",
    ...Object.entries(patternCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "### Extensions",
    "",
    "| Ext | Count |",
    "|-----|-------|",
    ...Object.entries(extCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "### Resolver conventions (this repo)",
    "",
    "- Nested folder name `RVAL######` (canonical album id)",
    "- Filename `RVAL######__slugified-artist__slugified-album.ext`",
    "- Flat files: `Artist_-_Album.ext` or `Artist - Album.ext`",
    "",
    "## Step 2 — Matching passes",
    "",
    "| Pass | Meaning |",
    "|------|---------|",
    "| M | CSV mapping: `RETROVERSE_COVER_LEGACY_MAPPING` (use `rootLabel::relative` when multiple roots) |",
    "| Id | Legacy path embeds same `RVAL` id as canonical album (folder or filename) |",
    "| A | Exact normalized artist + album keys |",
    "| B | Fuzzy keys (parentheticals, edition words, punctuation noise) |",
    "| C | Token overlap / Jaccard on normalized artist + album tokens |",
    "| C2 | Strong artist + partial album tokens |",
    "| D | Loose staging fallback (shared tokens; favors matches over gaps) |",
    "",
    "## Step 3 — Apply rules",
    "",
    "- Skipped **curator / workbench** primaries: `workbench:`, `itunes_canonical_pass`, notes with `living-archive action=`, `curator_approved`, `manual_cover`.",
    "- Skipped albums that already have a **local** `canonical_cover_path` (non-HTTP).",
    "- **Id / A / M** → `artwork_status` **verified**; **B / C / C2 / D** → **pending** (staging: visible density; refine later).",
    "- `cover_source` set to `legacy_sites_web_covers` (notes include `staging_pass=` A–D and technical `pass=`).",
    "",
    "## Step 4 — Results",
    "",
    "| Metric | Value |",
    "|--------|-------|",
    `| Eligible albums (missing local cover, not curator-locked) | ${eligibleAlbums.length} |`,
    `| Planned matches (this run) | ${plans.length} |`,
    `| Applied writes | ${applied} |`,
    `| Unmatched legacy files | ${unmatchedLegacy.length} |`,
    `| Ambiguous tie warnings | ${ambiguous.length} |`,
    "",
    "### By pass",
    "",
    "| Pass | Count |",
    "|------|-------|",
    ...Object.entries(
      plans.reduce<Record<string, number>>((acc, p) => {
        acc[p.pass] = (acc[p.pass] ?? 0) + 1;
        return acc;
      }, {}),
    )
      .sort((a, b) => b[1] - a[1])
      .map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "### Discover corpus coverage (`computeDiscoverCoverageReport`)",
    "",
    "| | Before | After |",
    "|---|-----|-------|",
    `| Usable albums | ${beforeCoverage.fullCorpusUsableAlbums} | ${afterCoverage?.fullCorpusUsableAlbums ?? "— (dry-run)"} |`,
    `| With any canonical_cover_path | ${beforeCoverage.withCanonicalCover} | ${afterCoverage?.withCanonicalCover ?? "—"} |`,
    `| Without cover path | ${beforeCoverage.withoutCanonicalCover} | ${afterCoverage?.withoutCanonicalCover ?? "—"} |`,
    `| % covered | ${beforeCoverage.pctCoverOfUsable} | ${afterCoverage?.pctCoverOfUsable ?? "re-run with --apply"} |`,
    "",
    "## Artifacts",
    "",
    `- Full JSON: \`${path.relative(WORKSPACE, jsonPath)}\``,
    `- Resolver map: \`${path.relative(WORKSPACE, resolverPath)}\``,
    "",
    "## Sample planned matches (first 30)",
    "",
    "| Album | Pass | Legacy file |",
    "|-------|------|-------------|",
    ...plans.slice(0, 30).map((p) => `| ${p.albumId} | ${p.pass} | \`${p.legacyRel}\` |`),
    "",
  ].join("\n");

  await writeFile(docPath, md, "utf8");

  const massReportPath = path.join(outDir, `${runId}_MASS_RECONCILIATION_REPORT.md`);
  const byTechnical = plans.reduce<Record<string, number>>((acc, p) => {
    acc[p.pass] = (acc[p.pass] ?? 0) + 1;
    return acc;
  }, {});
  const topStrategies = Object.entries(byTechnical)
    .sort((a, b) => b[1] - a[1])
    .map(([k, v]) => `- **${k}**: ${v}`)
    .join("\n");
  const stageStr = Object.entries(stagingPassByLetter)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([k, v]) => `- **Staging ${k}** (exact / fuzzy / partial / loose): ${v}`)
    .join("\n");
  const massMd = [
    `# Mass cover reconciliation — ${runId}`,
    "",
    "## Summary",
    "",
    `| Metric | Value |`,
    `|--------|-------|`,
    `| Legacy archive roots | ${legacyRoots.join(" \\| ")} |`,
    `| Total archive images scanned | ${legacyFiles.length} |`,
    `| Albums matched (planned) | ${plans.length} |`,
    `| Albums applied to DB + \`public/retroverse/covers\` | ${applied} |`,
    `| Archive images not matched to any album this run | ${unmatchedLegacy.length} |`,
    `| Ambiguous tie warnings (close scores) | ${ambiguous.length} |`,
    "",
    "## Discover corpus coverage",
    "",
    "| | Before | After |",
    "|---|-----|-------|",
    `| Usable albums | ${beforeCoverage.fullCorpusUsableAlbums} | ${afterCoverage?.fullCorpusUsableAlbums ?? "— (dry-run)"} |`,
    `| With \`canonical_cover_path\` | ${beforeCoverage.withCanonicalCover} | ${afterCoverage?.withCanonicalCover ?? "—"} |`,
    `| Without cover path | ${beforeCoverage.withoutCanonicalCover} | ${afterCoverage?.withoutCanonicalCover ?? "—"} |`,
    `| % covered (usable) | ${beforeCoverage.pctCoverOfUsable} | ${afterCoverage?.pctCoverOfUsable ?? "—"} |`,
    "",
    "## Matching — staging passes (A–D)",
    "",
    "Mapping: **A** = exact (technical Id / M / A); **B** = fuzzy + token (B / C); **C** = strong artist + partial album (C2); **D** = loose fallback.",
    "",
    stageStr || "_(none)_",
    "",
    "## Top technical strategies",
    "",
    topStrategies || "_(none)_",
    "",
    "## Examples — successful matches",
    "",
    ...examplesSuccess.slice(0, 15).map(
      (e) =>
        `- **${e.album_id}** ${e.artist} — *${e.album}* → \`${e.legacy_file}\` (staging **${e.staging_pass}**, technical \`${e.technical_pass}\`, conf ${e.confidence})`,
    ),
    "",
    "## Examples — ambiguous / tie-break warnings",
    "",
    ...examplesAmbiguous.slice(0, 15).map((e) => `- **${e.album_id}** ${e.artist} — *${e.album}*: ${e.detail}`),
    "",
    "## Artifacts",
    "",
    `- JSON: \`${path.relative(WORKSPACE, jsonPath)}\``,
    `- Resolver map: \`${path.relative(WORKSPACE, resolverPath)}\``,
    `- Legacy doc: \`${path.relative(WORKSPACE, docPath)}\``,
    "",
  ].join("\n");
  await writeFile(massReportPath, massMd, "utf8");

  console.log(`legacy_roots=${legacyRoots.join(";")}`);
  console.log(`total_legacy_images=${legacyFiles.length}`);
  console.log(`eligible_albums=${eligibleAlbums.length}`);
  console.log(`planned_matches=${plans.length}`);
  console.log(`applied=${applied}`);
  console.log(`unmatched_legacy=${unmatchedLegacy.length}`);
  console.log(`ambiguous=${ambiguous.length}`);
  console.log(`docs=${docPath}`);
  console.log(`json=${jsonPath}`);
  console.log(`mass_report=${massReportPath}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
