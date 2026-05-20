import { tryCreateClient } from "@/lib/supabase";

export type AlbumChartRunWeek = {
  chart_date: string;
  chart_position: number;
};

/** Week-by-week Billboard 200 run from `canonical_album_chart_runs` (empty when Supabase unavailable). */
export async function loadAlbumChartRunWeeks(albumId: string): Promise<AlbumChartRunWeek[]> {
  const supabase = tryCreateClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("canonical_album_chart_runs")
    .select("chart_date, chart_position")
    .eq("retroverse_album_id", albumId)
    .order("chart_date", { ascending: true });

  if (error) return [];

  return (data ?? [])
    .map((row) => ({
      chart_date: String(row.chart_date ?? "").slice(0, 10),
      chart_position: Number(row.chart_position),
    }))
    .filter((row) => row.chart_date && Number.isFinite(row.chart_position) && row.chart_position >= 1);
}
