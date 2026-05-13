import { writeFile } from "node:fs/promises";
import path from "node:path";
import { statSync } from "node:fs";

import Database from "better-sqlite3";

import {
  ACOUSTIC_DB_PATH,
  ACOUSTIC_SOURCE_TABLE,
  buildColumnMap,
  ensureAcousticLogDir,
  logFileBase,
} from "./lib/acoustic-enrichment";

type PragmaCol = { cid: number; name: string; type: string; notnull: number; pk: number };

function safeStat(p: string): { size: number; exists: boolean } {
  try {
    const s = statSync(p);
    return { size: s.size, exists: true };
  } catch {
    return { size: 0, exists: false };
  }
}

async function main() {
  await ensureAcousticLogDir();
  const stat = safeStat(ACOUSTIC_DB_PATH);
  const runId = new Date().toISOString();

  const report: Record<string, unknown> = {
    generated_at: runId,
    db_path: ACOUSTIC_DB_PATH,
    file_exists: stat.exists,
    file_size_bytes: stat.size,
    tables: [] as unknown[],
    acoustic_features_audit: null as unknown,
    column_mapping_suggestion: null as unknown,
    warnings: [] as string[],
  };

  if (!stat.exists || stat.size === 0) {
    (report.warnings as string[]).push(
      "Database file is missing or empty — run this audit again after the real SQLite file is present.",
    );
    const jsonPath = logFileBase("audit_report", "json");
    const mdPath = logFileBase("audit_summary", "md");
    await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");
    await writeFile(
      mdPath,
      [`# Acoustic source audit`, ``, `- path: \`${ACOUSTIC_DB_PATH}\``, `- **file empty or missing**`, ``].join("\n"),
      "utf8",
    );
    console.log(`audit_json=${jsonPath}`);
    console.log(`audit_md=${mdPath}`);
    return;
  }

  const db = new Database(ACOUSTIC_DB_PATH, { readonly: true });

  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as { name: string }[];
    (report.tables as unknown[]) = tables.map((t) => {
      const c = db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(t.name)}`).get() as { n: number };
      const info = db.prepare(`PRAGMA table_info(${quoteIdent(t.name)})`).all() as PragmaCol[];
      const indexes = db
        .prepare(`PRAGMA index_list(${quoteIdent(t.name)})`)
        .all() as { name: string; unique: number }[];
      return {
        name: t.name,
        row_count: c.n,
        columns: info.map((r) => ({ name: r.name, type: r.type, notnull: !!r.notnull, pk: !!r.pk })),
        indexes,
      };
    });

    const hasAcoustic = tables.some((t) => t.name === ACOUSTIC_SOURCE_TABLE);
    if (!hasAcoustic) {
      (report.warnings as string[]).push(
        `Table "${ACOUSTIC_SOURCE_TABLE}" not found. Set ACOUSTIC_SOURCE_TABLE to an existing table name.`,
      );
    } else {
      const cols = db.prepare(`PRAGMA table_info(${quoteIdent(ACOUSTIC_SOURCE_TABLE)})`).all() as PragmaCol[];
      const colNames = new Set(cols.map((c) => c.name));
      const mapping = buildColumnMap(colNames);
      report.column_mapping_suggestion = mapping;

      const total = (
        db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(ACOUSTIC_SOURCE_TABLE)}`).get() as { n: number }
      ).n;

      const numericCols = [
        "acousticness",
        "danceability",
        "energy",
        "valence",
        "tempo",
        "loudness",
        "speechiness",
        "instrumentalness",
      ] as const;

      const nullDensity: Record<string, number> = {};
      for (const logical of numericCols) {
        const sqliteCol = mapping[logical];
        if (!sqliteCol) {
          nullDensity[logical] = 1;
          continue;
        }
        const nulls = (
          db
            .prepare(
              `SELECT SUM(CASE WHEN ${quoteIdent(sqliteCol)} IS NULL THEN 1 ELSE 0 END) AS nulls FROM ${quoteIdent(ACOUSTIC_SOURCE_TABLE)}`,
            )
            .get() as { nulls: number }
        ).nulls;
        nullDensity[logical] = total > 0 ? Number((nulls / total).toFixed(4)) : 0;
      }

      const distinctQueries: { label: string; sql: string }[] = [];
      if (mapping.source_album_identity) {
        distinctQueries.push({
          label: "distinct_album_identities",
          sql: `SELECT COUNT(DISTINCT ${quoteIdent(mapping.source_album_identity)}) AS n FROM ${quoteIdent(ACOUSTIC_SOURCE_TABLE)}`,
        });
      }
      if (mapping.source_artist) {
        distinctQueries.push({
          label: "distinct_artists",
          sql: `SELECT COUNT(DISTINCT ${quoteIdent(mapping.source_artist)}) AS n FROM ${quoteIdent(ACOUSTIC_SOURCE_TABLE)}`,
        });
      }
      if (mapping.source_song) {
        distinctQueries.push({
          label: "distinct_songs",
          sql: `SELECT COUNT(DISTINCT ${quoteIdent(mapping.source_song)}) AS n FROM ${quoteIdent(ACOUSTIC_SOURCE_TABLE)}`,
        });
      }

      const distincts: Record<string, number> = {};
      for (const q of distinctQueries) {
        const row = db.prepare(q.sql).get() as { n: number };
        distincts[q.label] = row.n;
      }

      report.acoustic_features_audit = {
        table: ACOUSTIC_SOURCE_TABLE,
        row_count: total,
        null_density_numeric: nullDensity,
        distincts,
        sqlite_columns: cols,
      };
    }
  } finally {
    db.close();
  }

  const jsonPath = logFileBase("audit_report", "json");
  const mdPath = logFileBase("audit_summary", "md");
  await writeFile(jsonPath, JSON.stringify(report, null, 2), "utf8");

  const mdLines = [
    "# Acoustic source audit",
    "",
    `- Generated: ${runId}`,
    `- DB: \`${ACOUSTIC_DB_PATH}\` (${stat.size} bytes)`,
    "",
    "## Tables",
    "",
    ...((report.tables as { name: string; row_count: number }[]).map((t) => `- **${t.name}**: ${t.row_count} rows`)),
    "",
  ];
  if (report.acoustic_features_audit) {
    const a = report.acoustic_features_audit as { row_count: number; null_density_numeric: Record<string, number>; distincts: Record<string, number> };
    mdLines.push("## acoustic_features", "", `- rows: ${a.row_count}`, "");
    mdLines.push("### Null density (numeric)", "");
    for (const [k, v] of Object.entries(a.null_density_numeric)) {
      mdLines.push(`- ${k}: ${v}`);
    }
    mdLines.push("", "### Distinct counts", "");
    for (const [k, v] of Object.entries(a.distincts)) {
      mdLines.push(`- ${k}: ${v}`);
    }
  }
  if ((report.warnings as string[]).length) {
    mdLines.push("", "## Warnings", ...((report.warnings as string[]).map((w) => `- ${w}`)));
  }
  await writeFile(mdPath, mdLines.join("\n"), "utf8");

  console.log(`audit_json=${path.resolve(jsonPath)}`);
  console.log(`audit_md=${path.resolve(mdPath)}`);
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
