-- Local canonical curation store (SQLite).
-- Authoritative for curator decisions during local-first migration.

PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS canonical_artwork (
  album_id TEXT PRIMARY KEY NOT NULL,
  canonical_cover_path TEXT,
  source_url TEXT,
  source_type TEXT,
  curator_notes TEXT,
  approved_at TEXT,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_canonical_artwork_updated
  ON canonical_artwork (updated_at DESC);

CREATE TABLE IF NOT EXISTS curator_actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  previous_value TEXT,
  new_value TEXT,
  created_at TEXT NOT NULL,
  client_info TEXT
);

CREATE INDEX IF NOT EXISTS idx_curator_actions_album
  ON curator_actions (album_id, created_at DESC);

CREATE TABLE IF NOT EXISTS vdj_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  album_id TEXT,
  track_id TEXT,
  vdj_file_path TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_vdj_links_track_path
  ON vdj_links (track_id, vdj_file_path)
  WHERE track_id IS NOT NULL;
