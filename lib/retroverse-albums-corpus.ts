/**
 * Single canonical album source for Discover: all rows in public.retroverse_albums.
 * Paginated range queries (Supabase default row limits).
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export const RETROVERSE_ALBUM_CORPUS_PAGE = 1000;

export type CorpusAlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
  notes: string | null;
};

export async function loadAllRetroverseAlbumRows(supabase: SupabaseClient): Promise<CorpusAlbumRow[]> {
  const out: CorpusAlbumRow[] = [];
  let from = 0;
  for (;;) {
    const part = await supabase
      .from("retroverse_albums")
      .select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year, notes")
      .order("retroverse_album_id", { ascending: true })
      .range(from, from + RETROVERSE_ALBUM_CORPUS_PAGE - 1);
    if (part.error) throw part.error;
    const rows = (part.data ?? []) as CorpusAlbumRow[];
    out.push(...rows);
    if (rows.length < RETROVERSE_ALBUM_CORPUS_PAGE) break;
    from += RETROVERSE_ALBUM_CORPUS_PAGE;
  }
  return out;
}
