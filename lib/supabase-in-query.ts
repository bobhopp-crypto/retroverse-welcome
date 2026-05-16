import type { SupabaseClient } from "@supabase/supabase-js";

/** PostgREST GET queries embed `in.(...)` in the URL — keep chunks small to avoid 414 / generic failures. */
export const SUPABASE_IN_CHUNK = 100;

export function chunkIds<T>(ids: readonly T[], size = SUPABASE_IN_CHUNK): T[][] {
  if (ids.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < ids.length; i += size) out.push(ids.slice(i, i + size));
  return out;
}

type PgErr = { message: string; code?: string; details?: string | null; hint?: string | null };

const RETRYABLE_SUPABASE_CODES = new Set(["PGRST002", "57014"]);

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function throwSupabase(context: string, err: PgErr | null): void {
  if (!err) return;
  const msg = [context, err.message, err.code && `code=${err.code}`, err.details && `details=${err.details}`, err.hint && `hint=${err.hint}`]
    .filter(Boolean)
    .join(" · ");
  throw new Error(msg);
}

/** Run a Supabase read with short retries for transient PostgREST / schema-cache failures. */
export async function awaitSupabase<T>(
  context: string,
  run: () => PromiseLike<{ data: T | null; error: PgErr | null }>,
  opts?: { retries?: number },
): Promise<T | null> {
  const max = Math.max(1, opts?.retries ?? 3);
  let lastErr: PgErr | null = null;
  for (let attempt = 0; attempt < max; attempt++) {
    const { data, error } = await run();
    if (!error) return data;
    lastErr = error;
    if (RETRYABLE_SUPABASE_CODES.has(error.code ?? "") && attempt < max - 1) {
      await sleep(400 * (attempt + 1));
      continue;
    }
    throwSupabase(context, error);
  }
  throwSupabase(context, lastErr ?? { message: "unknown" });
  return null;
}

type ChartAppearanceRow = {
  retroverse_track_id: string;
  chart_position: number;
};

export async function fetchChartAppearancesForTrackIds(
  supabase: SupabaseClient,
  trackIds: string[],
): Promise<ChartAppearanceRow[]> {
  if (trackIds.length === 0) return [];
  const parts = await Promise.all(
    chunkIds(trackIds).map(async (chunk) => {
      const r = await supabase
        .from("retroverse_chart_appearances")
        .select("retroverse_track_id, chart_position")
        .in("retroverse_track_id", chunk);
      throwSupabase(`retroverse_chart_appearances(trackIds chunk ${chunk.length})`, r.error);
      return (r.data ?? []) as ChartAppearanceRow[];
    }),
  );
  return parts.flat();
}

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
  disc_number: number;
  track_number?: number;
  side_code: string | null;
};

export async function fetchAlbumTracksForEditionsAndTracks(
  supabase: SupabaseClient,
  editionIds: string[],
  trackIds: string[],
): Promise<AlbumTrackRow[]> {
  if (editionIds.length === 0 || trackIds.length === 0) return [];
  const editionChunks = chunkIds(editionIds, 80);
  const trackChunks = chunkIds(trackIds, 80);
  const batches: AlbumTrackRow[][] = await Promise.all(
    editionChunks.flatMap((ec) =>
      trackChunks.map(async (tc) => {
        const r = await supabase
          .from("retroverse_album_tracks")
          .select("retroverse_album_edition_id, retroverse_track_id, disc_number, track_number, side_code")
          .in("retroverse_album_edition_id", ec)
          .in("retroverse_track_id", tc);
        throwSupabase(`retroverse_album_tracks(editions×tracks chunk ${ec.length}×${tc.length})`, r.error);
        return (r.data ?? []) as AlbumTrackRow[];
      }),
    ),
  );
  return batches.flat();
}
