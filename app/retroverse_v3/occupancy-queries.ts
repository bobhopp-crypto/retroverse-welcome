import { createClient } from "@/lib/supabase";

/** Row shape used by trail builder (warehouse or canonical spine). */
export type ChartAppearanceRow = {
  retroverse_album_id: string | null;
  chart_date: string | null;
  chart_position: number | null;
  chart_name: string | null;
  weeks_on_chart: number | null;
};

const PAGE_SIZE = 1000;

/** Enough for multi-year weekly rows + re-entries (per album, not shared across albums). */
export const MAX_PAGES_PER_ALBUM = 48;

const BILLBOARD_200_LABEL = "Billboard 200";

function toAppearanceRows(
  rows: Array<{
    retroverse_album_id: string;
    chart_date: string;
    chart_position: number;
  }>,
): ChartAppearanceRow[] {
  return rows.map((r) => ({
    retroverse_album_id: r.retroverse_album_id,
    chart_date: r.chart_date,
    chart_position: r.chart_position,
    chart_name: BILLBOARD_200_LABEL,
    weeks_on_chart: null,
  }));
}

/**
 * All canonical Billboard 200 weekly rows for one album, paginated in date order.
 * Source: `canonical_album_chart_runs` (deterministic spine), not the raw warehouse.
 */
async function pagedCanonicalFetchForId(
  supabase: ReturnType<typeof createClient>,
  id: string,
): Promise<ChartAppearanceRow[]> {
  const out: ChartAppearanceRow[] = [];
  for (let page = 0; page < MAX_PAGES_PER_ALBUM; page++) {
    const { data, error } = await supabase
      .from("canonical_album_chart_runs")
      .select("retroverse_album_id, chart_date, chart_position")
      .eq("retroverse_album_id", id)
      .order("chart_date", { ascending: true })
      .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
    if (error || !data?.length) break;
    out.push(...toAppearanceRows(data as Array<{ retroverse_album_id: string; chart_date: string; chart_position: number }>));
    if (data.length < PAGE_SIZE) break;
  }
  return out;
}

export async function fetchBillboard200AppearancesForAlbum(
  supabase: ReturnType<typeof createClient>,
  albumId: string,
): Promise<ChartAppearanceRow[]> {
  const id = albumId.trim();
  let rows = await pagedCanonicalFetchForId(supabase, id);
  if (rows.length === 0 && id !== id.toUpperCase()) {
    rows = await pagedCanonicalFetchForId(supabase, id.toUpperCase());
  }
  return rows;
}
