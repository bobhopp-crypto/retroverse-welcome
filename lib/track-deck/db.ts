import Database from "better-sqlite3";

import { hot100SqlitePath } from "./constants";

let db: Database.Database | null = null;

export function getHot100Db(): Database.Database {
  if (!db) {
    try {
      db = new Database(hot100SqlitePath(), { readonly: true, fileMustExist: true });
    } catch (e) {
      throw new Error(
        `Cannot open Hot 100 SQLite at ${hot100SqlitePath()}. Set HOT100_SQLITE_PATH or copy billboard-hot-100.db into RETROVERSE_DATA/databases/. (${String(e)})`,
      );
    }
  }
  return db;
}
