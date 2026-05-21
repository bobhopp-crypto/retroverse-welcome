import type { SupabaseClient } from "@supabase/supabase-js";

import {
  chunkIds,
  isRetryableSupabaseError,
  isSchemaCacheSupabaseError,
  logSupabaseReadFailure,
  throwSupabase,
} from "@/lib/supabase-in-query";

export type RetroverseArtworkRow = {
  retroverse_album_artwork_id?: string;
  retroverse_album_id: string;
  retroverse_album_edition_id: string | null;
  artwork_role: string;
  is_primary?: boolean;
  canonical_cover_path: string | null;
  cover_source?: string | null;
  artwork_status?: string;
};

type PgErr = { message: string; code?: string; details?: string | null; hint?: string | null };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function shouldSoftFailArtworkQuery(err: PgErr | null): boolean {
  return isSchemaCacheSupabaseError(err) || isRetryableSupabaseError(err?.code);
}

async function queryArtworkChunk(
  supabase: SupabaseClient,
  albumChunk: string[],
  opts?: { retries?: number },
): Promise<RetroverseArtworkRow[] | null> {
  const max = Math.max(1, opts?.retries ?? 3);
  const context = `retroverse_album_artwork(albums chunk ${albumChunk.length})`;

  for (let attempt = 0; attempt < max; attempt++) {
    const withPrimaryResult = await supabase
      .from("retroverse_album_artwork")
      .select(
        "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, is_primary, canonical_cover_path, cover_source, artwork_status",
      )
      .in("retroverse_album_id", albumChunk)
      .order("created_at", { ascending: true })
      .limit(10_000);

    const fallbackResult =
      withPrimaryResult.error && withPrimaryResult.error.code === "42703"
        ? await supabase
            .from("retroverse_album_artwork")
            .select(
              "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, canonical_cover_path, cover_source, artwork_status",
            )
            .in("retroverse_album_id", albumChunk)
            .order("created_at", { ascending: true })
            .limit(10_000)
        : null;

    const err = fallbackResult?.error ?? withPrimaryResult.error;
    if (!err) {
      const rows = (fallbackResult?.data ?? withPrimaryResult.data ?? []) as RetroverseArtworkRow[];
      return rows.map((row) => ({
        ...row,
        is_primary: row.is_primary ?? row.artwork_role === "primary",
      }));
    }

    if (isRetryableSupabaseError(err.code) && attempt < max - 1) {
      await sleep(400 * (attempt + 1));
      continue;
    }

    if (shouldSoftFailArtworkQuery(err)) {
      logSupabaseReadFailure(context, err);
      return null;
    }

    if (withPrimaryResult.error && !fallbackResult) {
      throwSupabase(context, withPrimaryResult.error);
    }
    if (fallbackResult?.error) {
      throwSupabase(`${context} fallback`, fallbackResult.error);
    }
  }

  return null;
}

/**
 * Load album artwork rows. Never throws on schema-cache / transient PostgREST failures (PGRST002).
 * Returns partial/empty rows so pages can render without cover art.
 */
export async function loadAlbumArtworkRows(
  supabase: SupabaseClient,
  retroverseAlbumIds: string[],
): Promise<RetroverseArtworkRow[]> {
  if (retroverseAlbumIds.length === 0) return [];

  const merged: RetroverseArtworkRow[] = [];
  for (const albumChunk of chunkIds(retroverseAlbumIds)) {
    try {
      const rows = await queryArtworkChunk(supabase, albumChunk);
      if (rows) merged.push(...rows);
    } catch (err) {
      logSupabaseReadFailure(
        `retroverse_album_artwork(unhandled chunk ${albumChunk.length})`,
        err instanceof Error ? { message: err.message } : { message: String(err) },
      );
    }
  }
  return merged;
}

function artworkStatusScore(status: string | undefined): number {
  const s = (status ?? "").toLowerCase();
  if (s === "verified") return 64;
  if (s === "pending") return 32;
  if (s === "missing") return 0;
  if (s === "rejected") return -128;
  return 16;
}

function artworkPriority(
  row: RetroverseArtworkRow,
  retroverseAlbumEditionId: string | null | undefined,
): number {
  let score = 0;
  if (row.canonical_cover_path?.trim()) score += 32;
  score += artworkStatusScore(row.artwork_status);
  if (row.is_primary) score += 16;
  if (row.artwork_role === "primary") score += 8;
  if (retroverseAlbumEditionId && row.retroverse_album_edition_id === retroverseAlbumEditionId) score += 4;
  if (row.retroverse_album_edition_id === null) score += 2;
  return score;
}

export function selectCanonicalArtwork(
  artworkRows: RetroverseArtworkRow[],
  retroverseAlbumId: string,
  retroverseAlbumEditionId?: string | null,
): RetroverseArtworkRow | null {
  const candidates = artworkRows.filter((row) => row.retroverse_album_id === retroverseAlbumId);
  if (candidates.length === 0) return null;

  const sorted = [...candidates].sort(
    (a, b) =>
      artworkPriority(b, retroverseAlbumEditionId) - artworkPriority(a, retroverseAlbumEditionId) ||
      (a.retroverse_album_artwork_id ?? "").localeCompare(b.retroverse_album_artwork_id ?? ""),
  );
  return sorted[0] ?? null;
}
