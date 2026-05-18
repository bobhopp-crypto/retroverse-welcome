import { getLocalRetroverseDb } from "@/lib/local-retroverse-db";
import { curatorPipelineLog } from "@/lib/curator-pipeline-log";

export type CanonicalArtworkLocalRow = {
  album_id: string;
  canonical_cover_path: string | null;
  source_url: string | null;
  source_type: string | null;
  curator_notes: string | null;
  approved_at: string | null;
  updated_at: string;
};

export type CuratorActionLocalRow = {
  id: number;
  album_id: string;
  action_type: string;
  previous_value: string | null;
  new_value: string | null;
  created_at: string;
  client_info: string | null;
};

export type VdjLinkLocalRow = {
  id: number;
  album_id: string | null;
  track_id: string | null;
  vdj_file_path: string;
  created_at: string;
  updated_at: string;
};

export type CuratorSaveVerification = {
  localDb: { ok: boolean; error?: string };
  r2?: { ok: boolean; error?: string; key?: string };
  overrides: { ok: boolean; error?: string };
  supabaseMirror: { ok: boolean; skipped?: boolean; error?: string };
};

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeAlbumId(albumId: string): string {
  return albumId.trim().toUpperCase();
}

export function upsertCanonicalArtworkLocal(input: {
  albumId: string;
  canonicalCoverPath: string | null;
  sourceUrl?: string | null;
  sourceType?: string | null;
  curatorNotes?: string | null;
  approvedAt?: string | null;
  traceId?: string;
}): CanonicalArtworkLocalRow {
  const album_id = normalizeAlbumId(input.albumId);
  if (!/^RVAL\d{6}$/i.test(album_id)) {
    throw new Error("invalid_rval_album_id");
  }
  const updated_at = nowIso();
  const db = getLocalRetroverseDb();
  db.prepare(
    `INSERT INTO canonical_artwork (
      album_id, canonical_cover_path, source_url, source_type, curator_notes, approved_at, updated_at
    ) VALUES (
      @album_id, @canonical_cover_path, @source_url, @source_type, @curator_notes, @approved_at, @updated_at
    )
    ON CONFLICT(album_id) DO UPDATE SET
      canonical_cover_path = excluded.canonical_cover_path,
      source_url = excluded.source_url,
      source_type = excluded.source_type,
      curator_notes = excluded.curator_notes,
      approved_at = excluded.approved_at,
      updated_at = excluded.updated_at`,
  ).run({
    album_id,
    canonical_cover_path: input.canonicalCoverPath,
    source_url: input.sourceUrl ?? null,
    source_type: input.sourceType ?? null,
    curator_notes: input.curatorNotes ?? null,
    approved_at: input.approvedAt ?? null,
    updated_at,
  });
  curatorPipelineLog("local_db_write", {
    traceId: input.traceId,
    ok: true,
    albumId: album_id,
    canonicalCoverPath: input.canonicalCoverPath,
  });
  return {
    album_id,
    canonical_cover_path: input.canonicalCoverPath,
    source_url: input.sourceUrl ?? null,
    source_type: input.sourceType ?? null,
    curator_notes: input.curatorNotes ?? null,
    approved_at: input.approvedAt ?? null,
    updated_at,
  };
}

export function preflightCanonicalArtworkLocalWrite(albumId: string, traceId?: string): void {
  const album_id = normalizeAlbumId(albumId);
  if (!/^RVAL\d{6}$/i.test(album_id)) {
    throw new Error("invalid_rval_album_id");
  }
  const db = getLocalRetroverseDb();
  let began = false;
  try {
    db.prepare("BEGIN IMMEDIATE").run();
    began = true;
    db.prepare("SELECT 1 FROM canonical_artwork WHERE album_id = ?").get(album_id);
    db.prepare("ROLLBACK").run();
    began = false;
    curatorPipelineLog("local_db_preflight", { traceId, ok: true, albumId: album_id });
  } catch (e) {
    if (began) {
      try {
        db.prepare("ROLLBACK").run();
      } catch {
        /* best effort rollback */
      }
    }
    const error = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    curatorPipelineLog("local_db_preflight", { traceId, ok: false, albumId: album_id, error });
    throw e;
  }
}

export function readCanonicalArtworkLocal(albumId: string): CanonicalArtworkLocalRow | null {
  const album_id = normalizeAlbumId(albumId);
  const row = getLocalRetroverseDb()
    .prepare(
      `SELECT album_id, canonical_cover_path, source_url, source_type, curator_notes, approved_at, updated_at
       FROM canonical_artwork WHERE album_id = ?`,
    )
    .get(album_id) as CanonicalArtworkLocalRow | undefined;
  return row ?? null;
}

export function verifyCanonicalArtworkLocal(
  albumId: string,
  expectedPath: string | null,
  traceId?: string,
): { ok: true } | { ok: false; error: string } {
  const row = readCanonicalArtworkLocal(albumId);
  if (!row) {
    const error = "local_db_row_missing";
    curatorPipelineLog("local_db_verify", { traceId, ok: false, albumId, error });
    return { ok: false, error };
  }
  const a = (row.canonical_cover_path ?? "").trim();
  const b = (expectedPath ?? "").trim();
  if (a !== b) {
    const error = `local_db_path_mismatch:expected=${b || "null"}:got=${a || "null"}`;
    curatorPipelineLog("local_db_verify", { traceId, ok: false, albumId, error });
    return { ok: false, error };
  }
  curatorPipelineLog("local_db_verify", { traceId, ok: true, albumId, canonicalCoverPath: a || null });
  return { ok: true };
}

export function insertCuratorActionLocal(input: {
  albumId: string;
  actionType: string;
  previousValue?: unknown;
  newValue?: unknown;
  clientInfo?: string | null;
  traceId?: string;
}): CuratorActionLocalRow {
  const album_id = normalizeAlbumId(input.albumId);
  const created_at = nowIso();
  const previous_value =
    input.previousValue === undefined ? null : JSON.stringify(input.previousValue);
  const new_value = input.newValue === undefined ? null : JSON.stringify(input.newValue);
  const result = getLocalRetroverseDb()
    .prepare(
      `INSERT INTO curator_actions (album_id, action_type, previous_value, new_value, created_at, client_info)
       VALUES (@album_id, @action_type, @previous_value, @new_value, @created_at, @client_info)`,
    )
    .run({
      album_id,
      action_type: input.actionType,
      previous_value,
      new_value,
      created_at,
      client_info: input.clientInfo ?? null,
    });
  const row: CuratorActionLocalRow = {
    id: Number(result.lastInsertRowid),
    album_id,
    action_type: input.actionType,
    previous_value,
    new_value,
    created_at,
    client_info: input.clientInfo ?? null,
  };
  curatorPipelineLog("local_db_write", {
    traceId: input.traceId,
    ok: true,
    kind: "curator_action",
    actionId: row.id,
    albumId: album_id,
    actionType: input.actionType,
  });
  return row;
}

export function upsertVdjLinkLocal(input: {
  albumId?: string | null;
  trackId: string;
  vdjFilePath: string;
  traceId?: string;
}): VdjLinkLocalRow {
  const track_id = input.trackId.trim();
  const vdj_file_path = input.vdjFilePath.trim();
  if (!track_id || !vdj_file_path) throw new Error("vdj_link_track_and_path_required");
  const album_id = input.albumId?.trim().toUpperCase() || null;
  const ts = nowIso();
  const db = getLocalRetroverseDb();
  const existing = db
    .prepare(`SELECT id FROM vdj_links WHERE track_id = ? AND vdj_file_path = ?`)
    .get(track_id, vdj_file_path) as { id: number } | undefined;
  if (existing?.id) {
    db.prepare(
      `UPDATE vdj_links SET album_id = @album_id, updated_at = @updated_at WHERE id = @id`,
    ).run({ id: existing.id, album_id, updated_at: ts });
    const row = db
      .prepare(`SELECT * FROM vdj_links WHERE id = ?`)
      .get(existing.id) as VdjLinkLocalRow;
    curatorPipelineLog("local_db_write", { traceId: input.traceId, ok: true, kind: "vdj_link", trackId: track_id });
    return row;
  }
  const result = db
    .prepare(
      `INSERT INTO vdj_links (album_id, track_id, vdj_file_path, created_at, updated_at)
       VALUES (@album_id, @track_id, @vdj_file_path, @created_at, @updated_at)`,
    )
    .run({
      album_id,
      track_id,
      vdj_file_path,
      created_at: ts,
      updated_at: ts,
    });
  const row = db
    .prepare(`SELECT * FROM vdj_links WHERE id = ?`)
    .get(Number(result.lastInsertRowid)) as VdjLinkLocalRow;
  curatorPipelineLog("local_db_write", { traceId: input.traceId, ok: true, kind: "vdj_link", trackId: track_id });
  return row;
}
