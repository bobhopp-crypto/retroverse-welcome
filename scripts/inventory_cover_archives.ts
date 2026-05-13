/**
 * Scan candidate legacy cover roots (RETROVERSE_DATA, app public covers, env overrides).
 * Prints + writes JSON inventory: counts, extensions, top-level layout, parse probes.
 *
 *   npx tsx scripts/inventory_cover_archives.ts
 *   npx tsx scripts/inventory_cover_archives.ts --root /path/to/covers --root /other
 *
 * Env:
 *   RETROVERSE_LEGACY_COVERS_ROOTS — comma/semicolon-separated absolute paths (optional)
 */
import { readdir, stat, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".gif"]);

type RootReport = {
  root: string;
  exists: boolean;
  total_images: number;
  extension_counts: Record<string, number>;
  top_segment_counts: Record<string, number>;
  pattern_probe: {
    rval_nested_dirs: number;
    rval_in_filename: number;
    artist_dash_album: number;
    unparsed_sample: string[];
  };
};

function parseArgs() {
  const argv = process.argv.slice(2);
  const roots: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--root" && argv[i + 1]) {
      roots.push(path.resolve(argv[++i]));
    }
  }
  return { roots };
}

function defaultCandidateRoots(): string[] {
  const home = process.env.HOME ?? "";
  const fromEnv = process.env.RETROVERSE_LEGACY_COVERS_ROOTS?.split(/[;,]/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => path.resolve(p.replace(/^~/, home)));
  const base = [
    process.env.RETROVERSE_LEGACY_COVERS_ROOT?.trim() && path.resolve(process.env.RETROVERSE_LEGACY_COVERS_ROOT.trim()),
    process.env.RETROVERSE_COVERS_MASTER_ROOT?.trim() && path.resolve(process.env.RETROVERSE_COVERS_MASTER_ROOT.trim()),
    path.join(home, "RETROVERSE_DATA/covers_master"),
    path.join(home, "RETROVERSE_DATA/artwork-intake"),
    path.join(home, "RETROVERSE_DATA/generated"),
    path.join(process.cwd(), "public/retroverse/covers"),
  ].filter(Boolean) as string[];
  const merged = [...(fromEnv ?? []), ...base];
  return [...new Set(merged)];
}

async function walkCount(root: string): Promise<RootReport> {
  try {
    await stat(root);
  } catch {
    return {
      root,
      exists: false,
      total_images: 0,
      extension_counts: {},
      top_segment_counts: {},
      pattern_probe: { rval_nested_dirs: 0, rval_in_filename: 0, artist_dash_album: 0, unparsed_sample: [] },
    };
  }

  const extension_counts: Record<string, number> = {};
  const top_segment_counts: Record<string, number> = {};
  let rval_nested_dirs = 0;
  let rval_in_filename = 0;
  let artist_dash_album = 0;
  const unparsed_sample: string[] = [];
  const baseLen = root.length + 1;
  let total = 0;

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
      if (e.isDirectory()) {
        if (/^RVAL\d{6,}$/i.test(e.name)) rval_nested_dirs += 1;
        await walk(full);
      } else if (e.isFile()) {
        const ext = path.extname(e.name).toLowerCase();
        if (!IMAGE_EXT.has(ext)) continue;
        total += 1;
        const ek = ext.replace(".", "") || "unknown";
        extension_counts[ek] = (extension_counts[ek] ?? 0) + 1;
        const rel = full.length >= baseLen ? full.slice(baseLen) : e.name;
        const seg = rel.split(path.sep)[0] ?? "_root";
        top_segment_counts[seg] = (top_segment_counts[seg] ?? 0) + 1;

        const stem = e.name.replace(/\.[^.]+$/, "");
        if (/^RVAL\d{6,}__/i.test(stem)) rval_in_filename += 1;
        else if (/\s-\s|_-_|–|—/.test(stem)) artist_dash_album += 1;
        else if (unparsed_sample.length < 12) unparsed_sample.push(rel.split(path.sep).join("/"));
      }
    }
  }

  await walk(root);

  return {
    root,
    exists: true,
    total_images: total,
    extension_counts,
    top_segment_counts,
    pattern_probe: {
      rval_nested_dirs,
      rval_in_filename,
      artist_dash_album,
      unparsed_sample,
    },
  };
}

async function main() {
  const { roots: argRoots } = parseArgs();
  const roots = argRoots.length > 0 ? argRoots : defaultCandidateRoots();

  const reports: RootReport[] = [];
  for (const r of roots) reports.push(await walkCount(r));

  const grandTotal = reports.reduce((s, r) => s + r.total_images, 0);
  const outDir = path.join(process.cwd(), "data", "generated", "cover_archive_inventory");
  await mkdir(outDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `inventory_${stamp}.json`);
  const payload = { generated_at: new Date().toISOString(), grand_total_images: grandTotal, roots: reports };
  await writeFile(jsonPath, JSON.stringify(payload, null, 2), "utf8");

  console.log(JSON.stringify({ grand_total_images: grandTotal, jsonPath, roots: reports.map((r) => ({ root: r.root, n: r.total_images, ok: r.exists })) }, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
