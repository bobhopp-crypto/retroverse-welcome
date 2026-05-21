/**
 * Assign deterministic RVAL keys to PG albums missing album_external_keys.
 *
 * Usage:
 *   npx tsx scripts/repair_missing_album_external_keys.ts [--dry-run] [--min-score N]
 */
import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

const WORKSPACE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DOSSIERS_PATH = path.join(WORKSPACE, "public/data/albums/album-dossiers.json");
const OUT_CSV = path.join(WORKSPACE, "exports/graph/album_external_keys_repair.csv");
const REPORT_PATH = path.join(WORKSPACE, "docs/missing_album_external_keys_repair.md");

const PG = {
  host: process.env.RETROVERSE_PG_HOST ?? "localhost",
  database: process.env.RETROVERSE_PG_DATABASE ?? "retroverse",
  user: process.env.RETROVERSE_PG_USER ?? "bobhopp",
  password: process.env.RETROVERSE_PG_PASSWORD ?? "",
};

const PRIORITY_SPOTLIGHT = [
  { artist: "adele", title: "21" },
  { artist: "santana", title: "supernatural" },
  { artist: "michael jackson", title: "thriller" },
  { artist: "fleetwood mac", title: "rumours" },
  { artist: "eagles", title: "hotel california" },
];

type AlbumRow = {
  album_id: number;
  title: string;
  release_year: number | null;
  artist_id: number;
  artist_name: string;
  has_bb200: boolean;
  has_ctal: boolean;
  hot100_track_links: number;
  acoustic_ok: number;
  acoustic_any: number;
  has_artwork: boolean;
  cat_rows: number;
};

type Assignment = {
  album_id: number;
  external_key: string;
  source: string;
  confidence_score: number;
  priority_score: number;
  skip_reason: string | null;
};

function normalizeText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function albumGroupKey(artistId: number, title: string): string {
  return `${artistId}::${normalizeText(title)}`;
}

function hashToSixDigits(input: string): number {
  const digest = createHash("sha1").update(input).digest("hex");
  return Number.parseInt(digest.slice(0, 12), 16) % 1_000_000;
}

function allocateRval(used: Set<string>, canonicalKey: string): string {
  let probe = hashToSixDigits(`RVAL:album::${canonicalKey}`);
  for (let attempt = 0; attempt < 1_000_000; attempt += 1) {
    const candidate = `RVAL${String(probe).padStart(6, "0")}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
    probe = (probe + 1) % 1_000_000;
  }
  throw new Error(`Unable to allocate RVAL for ${canonicalKey}`);
}

function priorityScore(row: AlbumRow): number {
  let score = 0;
  if (row.has_bb200) score += 40;
  if (row.has_ctal) score += 35;
  if (row.hot100_track_links > 0) score += 30;
  if (row.acoustic_ok >= 6) score += 25;
  else if (row.acoustic_any > 0) score += 10;
  if (row.has_artwork) score += 20;
  if (row.cat_rows > 0) score += 15;
  return score;
}

async function loadDossierRvalByArtistTitle(): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const raw = await readFile(DOSSIERS_PATH, "utf8");
    const json = JSON.parse(raw) as { dossiers?: Record<string, { identity?: { artist?: string; album?: string } }> };
    for (const [rval, d] of Object.entries(json.dossiers ?? {})) {
      if (!/^RVAL\d{6}$/i.test(rval)) continue;
      const artist = normalizeText(String(d.identity?.artist ?? ""));
      const title = normalizeText(String(d.identity?.album ?? ""));
      if (!artist || !title) continue;
      map.set(`${artist}::${title}`, rval.toUpperCase());
    }
  } catch {
    // dossiers optional
  }
  return map;
}

async function main(): Promise<void> {
  const dryRun = process.argv.includes("--dry-run");
  const minScoreArg = process.argv.find((a) => a.startsWith("--min-score="));
  const minScore = minScoreArg ? Number.parseInt(minScoreArg.split("=")[1] ?? "1", 10) : 1;

  const pool = new Pool(PG);
  const dossierByArtistTitle = await loadDossierRvalByArtistTitle();

  const before = await pool.query<{ n: number; cat: number }>(`
    SELECT
      (SELECT count(*)::int FROM albums al WHERE NOT EXISTS (
        SELECT 1 FROM album_external_keys aek WHERE aek.album_id = al.id
      )) AS n,
      (SELECT count(*)::int FROM canonical_album_tracks) AS cat
  `);
  const missingBefore = before.rows[0]?.n ?? 0;
  const catBefore = before.rows[0]?.cat ?? 0;

  const usedKeys = new Set<string>();
  const keyOwner = new Map<string, number>();
  const existing = await pool.query<{ external_key: string; album_id: number }>(
    `SELECT external_key, album_id FROM album_external_keys WHERE external_key ~* '^RVAL[0-9]{6}$'`,
  );
  for (const row of existing.rows) {
    const key = row.external_key.toUpperCase();
    usedKeys.add(key);
    keyOwner.set(key, Number(row.album_id));
  }

  const candidates = await pool.query<AlbumRow>(`
    SELECT
      al.id AS album_id,
      al.title,
      al.release_year,
      al.artist_id,
      ar.canonical_name AS artist_name,
      EXISTS (
        SELECT 1 FROM chart_appearances ca
        WHERE ca.album_id = al.id AND ca.chart_name = 'Billboard 200'
      ) AS has_bb200,
      EXISTS (
        SELECT 1 FROM canonical_track_album_links ctal WHERE ctal.album_id = al.id
      ) AS has_ctal,
      (
        SELECT count(DISTINCT ct.track_id)::int
        FROM canonical_track_album_links ctal
        JOIN canonical_tracks ct ON ct.track_family_id = ctal.track_family_id
        WHERE ctal.album_id = al.id AND ct.has_hot100
      ) AS hot100_track_links,
      (
        SELECT count(*)::int FROM acoustic_track_album_candidates c
        WHERE c.album_id = al.id AND c.review_flag IN ('ok', 'pending')
      ) AS acoustic_ok,
      (
        SELECT count(*)::int FROM acoustic_track_album_candidates c WHERE c.album_id = al.id
      ) AS acoustic_any,
      EXISTS (
        SELECT 1 FROM album_artwork_links aal WHERE aal.album_id = al.id
      ) AS has_artwork,
      (
        SELECT count(*)::int FROM canonical_album_tracks cat WHERE cat.album_id = al.id
      ) AS cat_rows
    FROM albums al
    JOIN artists ar ON ar.id = al.artist_id
    WHERE NOT EXISTS (SELECT 1 FROM album_external_keys aek WHERE aek.album_id = al.id)
  `);

  const byGroup = new Map<string, AlbumRow[]>();
  for (const row of candidates.rows) {
    const g = albumGroupKey(row.artist_id, row.title);
    const list = byGroup.get(g) ?? [];
    list.push(row);
    byGroup.set(g, list);
  }

  const keyedGroups = new Set<string>();
  const keyed = await pool.query<{ artist_id: number; title: string }>(`
    SELECT al.artist_id, al.title
    FROM albums al
    JOIN album_external_keys aek ON aek.album_id = al.id
  `);
  for (const row of keyed.rows) {
    keyedGroups.add(albumGroupKey(Number(row.artist_id), row.title));
  }

  const assignments: Assignment[] = [];
  let skippedReview = 0;

  for (const [group, rows] of byGroup) {
    if (keyedGroups.has(group)) {
      for (const row of rows) {
        assignments.push({
          album_id: row.album_id,
          external_key: "",
          source: "skipped",
          confidence_score: 0,
          priority_score: priorityScore(row),
          skip_reason: "sibling_album_has_external_key",
        });
        skippedReview += 1;
      }
      continue;
    }

    if (rows.length > 1) {
      rows.sort(
        (a, b) =>
          priorityScore(b) - priorityScore(a) ||
          (b.has_bb200 ? 1 : 0) - (a.has_bb200 ? 1 : 0) ||
          b.hot100_track_links - a.hot100_track_links ||
          a.album_id - b.album_id,
      );
      const [winner, ...losers] = rows;
      const winnerAssign = buildAssignment(winner, dossierByArtistTitle, usedKeys, keyOwner, minScore);
      assignments.push(winnerAssign);
      if (winnerAssign.skip_reason) skippedReview += 1;
      for (const loser of losers) {
        assignments.push({
          album_id: loser.album_id,
          external_key: "",
          source: "skipped",
          confidence_score: 0,
          priority_score: priorityScore(loser),
          skip_reason: "duplicate_artist_title_loser",
        });
        skippedReview += 1;
      }
      continue;
    }

    const assign = buildAssignment(rows[0]!, dossierByArtistTitle, usedKeys, keyOwner, minScore);
    assignments.push(assign);
    if (assign.skip_reason) skippedReview += 1;
  }

  const toInsert = assignments.filter((a) => !a.skip_reason && a.external_key);
  await mkdir(path.dirname(OUT_CSV), { recursive: true });
  const csvLines = [
    "album_id,external_key,source,confidence_score,priority_score,skip_reason",
    ...assignments.map(
      (a) =>
        `${a.album_id},${a.external_key},${a.source},${a.confidence_score},${a.priority_score},"${(a.skip_reason ?? "").replace(/"/g, '""')}"`,
    ),
  ];
  await writeFile(OUT_CSV, `${csvLines.join("\n")}\n`, "utf8");

  if (!dryRun && toInsert.length > 0) {
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const row of toInsert) {
        await client.query(
          `INSERT INTO album_external_keys (album_id, external_key, source, confidence_score)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT (album_id) DO NOTHING`,
          [row.album_id, row.external_key, row.source, row.confidence_score],
        );
      }
      await client.query("COMMIT");
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  const after = await pool.query<{ n: number; cat: number }>(`
    SELECT
      (SELECT count(*)::int FROM albums al WHERE NOT EXISTS (
        SELECT 1 FROM album_external_keys aek WHERE aek.album_id = al.id
      )) AS n,
      (SELECT count(*)::int FROM canonical_album_tracks) AS cat
  `);
  const missingAfter = after.rows[0]?.n ?? 0;
  const catAfter = after.rows[0]?.cat ?? 0;

  const adele21 = await pool.query<{
    album_id: number;
    external_key: string | null;
    cat_n: number;
  }>(`
    SELECT al.id AS album_id, aek.external_key,
      (SELECT count(*)::int FROM canonical_album_tracks cat WHERE cat.album_id = al.id) AS cat_n
    FROM albums al
    JOIN artists ar ON ar.id = al.artist_id
    LEFT JOIN album_external_keys aek ON aek.album_id = al.id
    WHERE lower(ar.canonical_name) = 'adele' AND lower(al.title) = '21'
  `);

  const rolling = await pool.query<{ album_title: string; external_key: string | null; cat_key: string | null }>(`
    SELECT al.title AS album_title, aek.external_key, cat.canonical_track_key AS cat_key
    FROM canonical_tracks ct
    LEFT JOIN canonical_track_album_links ctal ON ctal.track_family_id = ct.track_family_id
    LEFT JOIN albums al ON al.id = ctal.album_id
    LEFT JOIN album_external_keys aek ON aek.album_id = al.id
    LEFT JOIN canonical_album_tracks cat ON cat.album_id = al.id AND cat.canonical_track_key = ct.track_id
    WHERE ct.track_id = 'RVTR672189'
    LIMIT 5
  `);

  const spotlight: string[] = [];
  for (const spot of PRIORITY_SPOTLIGHT) {
    const r = await pool.query(
      `SELECT al.id, al.title, ar.canonical_name, aek.external_key,
        (SELECT count(*)::int FROM canonical_album_tracks cat WHERE cat.album_id = al.id) cat_n
       FROM albums al JOIN artists ar ON ar.id = al.artist_id
       LEFT JOIN album_external_keys aek ON aek.album_id = al.id
       WHERE lower(ar.canonical_name) = $1 AND lower(al.title) = $2
       ORDER BY al.id`,
      [spot.artist, spot.title],
    );
    spotlight.push(
      `| ${spot.artist} | ${spot.title} | ${r.rows.map((x) => `${x.external_key ?? "—"} (cat=${x.cat_n}, id=${x.id})`).join("; ")} |`,
    );
  }

  const assigned = toInsert.length;
  const report = `# Missing album external keys repair

Generated: ${new Date().toISOString()}
Mode: ${dryRun ? "dry-run" : "apply"}
Min priority score: ${minScore}

## Summary

| Metric | Value |
|--------|------:|
| Albums missing RVAL before | ${missingBefore} |
| Candidates evaluated | ${candidates.rows.length} |
| RVAL assigned | ${assigned} |
| Skipped / review | ${skippedReview} |
| Albums missing RVAL after | ${missingAfter} |
| \`canonical_album_tracks\` rows before | ${catBefore} |
| \`canonical_album_tracks\` rows after | ${catAfter} |

## Assignment log

CSV: \`exports/graph/album_external_keys_repair.csv\`

## Priority albums

| Artist | Album | Result |
|--------|-------|--------|
${spotlight.join("\n")}

## Adele — 21

\`\`\`json
${JSON.stringify(adele21.rows, null, 2)}
\`\`\`

## Rolling in the Deep (RVTR672189)

\`\`\`json
${JSON.stringify(rolling.rows, null, 2)}
\`\`\`

## Next steps

\`\`\`bash
npm run graph:canonical-tracks:export
npm run graph:canonical-tracks:load
psql -h localhost -U bobhopp -d retroverse -f integrity_console/sql/1104_backfill_canonical_album_track_rvtr_keys.sql
\`\`\`
`;

  await writeFile(REPORT_PATH, report, "utf8");

  console.log(`Missing before: ${missingBefore}`);
  console.log(`Assigned: ${assigned} (${dryRun ? "dry-run" : "applied"})`);
  console.log(`Skipped: ${skippedReview}`);
  console.log(`Missing after: ${missingAfter}`);
  console.log(`Report: ${REPORT_PATH}`);
  console.log(`CSV: ${OUT_CSV}`);

  await pool.end();
}

function buildAssignment(
  row: AlbumRow,
  dossierByArtistTitle: Map<string, string>,
  usedKeys: Set<string>,
  keyOwner: Map<string, number>,
  minScore: number,
): Assignment {
  const score = priorityScore(row);
  if (score < minScore) {
    return {
      album_id: row.album_id,
      external_key: "",
      source: "skipped",
      confidence_score: 0,
      priority_score: score,
      skip_reason: "below_min_priority_score",
    };
  }

  const dossierKey = dossierByArtistTitle.get(`${normalizeText(row.artist_name)}::${normalizeText(row.title)}`);
  const canonicalKey = `${normalizeText(row.title)}::${row.artist_id}`;
  let external_key = dossierKey ?? "";
  let source = dossierKey ? "dossier_match" : "deterministic_hash";
  let confidence_score = dossierKey ? 90 : 80;

  if (!external_key) {
    external_key = allocateRval(usedKeys, canonicalKey);
  } else if (usedKeys.has(external_key) && keyOwner.get(external_key) !== row.album_id) {
    return {
      album_id: row.album_id,
      external_key: "",
      source: "skipped",
      confidence_score: 0,
      priority_score: score,
      skip_reason: "dossier_rval_collision",
    };
  } else {
    usedKeys.add(external_key);
    keyOwner.set(external_key, row.album_id);
  }

  return {
    album_id: row.album_id,
    external_key,
    source,
    confidence_score,
    priority_score: score,
    skip_reason: null,
  };
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
