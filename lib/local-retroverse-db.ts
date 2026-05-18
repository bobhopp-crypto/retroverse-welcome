import Database from "better-sqlite3";
import { mkdirSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_DB_PATH = path.join(process.cwd(), "data", "local-retroverse.db");
const SCHEMA_PATH = path.join(process.cwd(), "data", "local-retroverse.schema.sql");

let dbInstance: Database.Database | null = null;

export function localRetroverseDbPath(): string {
  const env = process.env.LOCAL_RETROVERSE_DB_PATH?.trim();
  if (!env) return DEFAULT_DB_PATH;
  return path.isAbsolute(env) ? env : path.join(process.cwd(), env);
}

function applySchema(db: Database.Database): void {
  const schema = readFileSync(SCHEMA_PATH, "utf8");
  db.exec(schema);
}

/** Writable SQLite handle — schema applied on first open. */
export function getLocalRetroverseDb(): Database.Database {
  if (dbInstance) return dbInstance;
  const dbPath = localRetroverseDbPath();
  mkdirSync(path.dirname(dbPath), { recursive: true });
  dbInstance = new Database(dbPath);
  dbInstance.pragma("journal_mode = WAL");
  dbInstance.pragma("foreign_keys = ON");
  applySchema(dbInstance);
  return dbInstance;
}

/** Close handle (tests / graceful shutdown). */
export function closeLocalRetroverseDb(): void {
  if (dbInstance) {
    dbInstance.close();
    dbInstance = null;
  }
}
