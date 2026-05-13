/**
 * Scan persisted iTunes raw JSON and print entity / trackCount distributions.
 *
 * Run: `npx tsx scripts/audit_itunes_entity_distribution.ts [maxFiles]`
 */

import fs from "node:fs";
import path from "node:path";

const ROOT = path.join(process.cwd(), "data", "raw", "providers", "itunes");

function walkJsonFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkJsonFiles(p, out);
    else if (ent.name.endsWith(".raw.json")) out.push(p);
  }
}

type Agg = {
  files: number;
  rows: number;
  wrapperType: Record<string, number>;
  collectionType: Record<string, number>;
  kind: Record<string, number>;
  trackCounts: number[];
  thinCollectionExamples: { artist: string; name: string; tc: number; ct: string; wt: string }[];
};

function main(): void {
  const maxFiles = Math.max(1, Number.parseInt(process.argv[2] ?? "200", 10));
  const files: string[] = [];
  walkJsonFiles(ROOT, files);
  files.sort();
  const take = files.slice(0, maxFiles);

  const agg: Agg = {
    files: take.length,
    rows: 0,
    wrapperType: {},
    collectionType: {},
    kind: {},
    trackCounts: [],
    thinCollectionExamples: [],
  };

  for (const f of take) {
    let j: { results?: Record<string, unknown>[] };
    try {
      j = JSON.parse(fs.readFileSync(f, "utf8")) as { results?: Record<string, unknown>[] };
    } catch {
      continue;
    }
    const rows = j.results ?? [];
    for (const r of rows) {
      agg.rows += 1;
      const w = String(r["wrapperType"] ?? "?").toLowerCase();
      const ct = String(r["collectionType"] ?? "-").toLowerCase();
      const kRaw = r["kind"];
      const k = kRaw == null || kRaw === "" ? "-" : String(kRaw).toLowerCase();
      agg.wrapperType[w] = (agg.wrapperType[w] ?? 0) + 1;
      agg.collectionType[ct] = (agg.collectionType[ct] ?? 0) + 1;
      agg.kind[k] = (agg.kind[k] ?? 0) + 1;
      const tc = r["trackCount"];
      const tcn = typeof tc === "number" ? tc : null;
      if (tcn != null) agg.trackCounts.push(tcn);

      if (w === "collection" && tcn != null && tcn <= 3) {
        const name = String(r["collectionName"] ?? "").slice(0, 72);
        const artist = String(r["artistName"] ?? "").slice(0, 40);
        if (agg.thinCollectionExamples.length < 15) {
          agg.thinCollectionExamples.push({ artist, name, tc: tcn, ct, wt: w });
        }
      }
    }
  }

  agg.trackCounts.sort((a, b) => a - b);
  const pct = (p: number) => {
    if (agg.trackCounts.length === 0) return null;
    const idx = Math.min(agg.trackCounts.length - 1, Math.max(0, Math.floor((p / 100) * (agg.trackCounts.length - 1))));
    return agg.trackCounts[idx];
  };

  console.log(JSON.stringify({ root: ROOT, ...agg, trackCount_p50: pct(50), trackCount_p90: pct(90) }, null, 2));
}

main();
