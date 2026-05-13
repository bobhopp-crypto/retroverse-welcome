import type { SupabaseClient } from "@supabase/supabase-js";

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

export async function loadAlbumArtworkRows(
  supabase: SupabaseClient,
  retroverseAlbumIds: string[],
): Promise<RetroverseArtworkRow[]> {
  if (retroverseAlbumIds.length === 0) return [];

  const withPrimaryResult = await supabase
    .from("retroverse_album_artwork")
    .select(
      "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, is_primary, canonical_cover_path, cover_source, artwork_status",
    )
    .in("retroverse_album_id", retroverseAlbumIds)
    .order("created_at", { ascending: true })
    .limit(10_000);

  const fallbackResult =
    withPrimaryResult.error && withPrimaryResult.error.code === "42703"
      ? await supabase
          .from("retroverse_album_artwork")
          .select(
            "retroverse_album_artwork_id, retroverse_album_id, retroverse_album_edition_id, artwork_role, canonical_cover_path, cover_source, artwork_status",
          )
          .in("retroverse_album_id", retroverseAlbumIds)
          .order("created_at", { ascending: true })
          .limit(10_000)
      : null;

  if (withPrimaryResult.error && !fallbackResult) {
    throw withPrimaryResult.error;
  }
  if (fallbackResult?.error) {
    throw fallbackResult.error;
  }

  return ((fallbackResult?.data ?? withPrimaryResult.data ?? []) as RetroverseArtworkRow[]).map((row) => ({
    ...row,
    is_primary: row.is_primary ?? row.artwork_role === "primary",
  }));
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
