/**
 * Initialize data/local-retroverse.db from data/local-retroverse.schema.sql
 *
 * Run: npx tsx scripts/init-local-retroverse-db.ts
 */
import { mkdirSync } from "node:fs";
import path from "node:path";

import { closeLocalRetroverseDb, getLocalRetroverseDb, localRetroverseDbPath } from "@/lib/local-retroverse-db";

function main() {
  const dbPath = localRetroverseDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = getLocalRetroverseDb();
  const tables = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name`)
    .all() as { name: string }[];
  console.log("[local-retroverse] initialized", {
    path: dbPath,
    tables: tables.map((t) => t.name),
  });
  closeLocalRetroverseDb();
}

main();
