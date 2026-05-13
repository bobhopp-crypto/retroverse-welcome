import type { CorpusAlbumRow } from "@/lib/retroverse-albums-corpus";

export function billboardChartWeekKey(notes: string | null): string {
  if (!notes) return "";
  const m = notes.match(/First Billboard 200 chart week:\s*(\d{4}-\d{2}-\d{2})/);
  return m?.[1] ?? "";
}

export function sortCorpusRowsForDiscoverFeed(rows: CorpusAlbumRow[]): CorpusAlbumRow[] {
  const out = [...rows];
  out.sort((a, b) => {
    const da = billboardChartWeekKey(a.notes);
    const db = billboardChartWeekKey(b.notes);
    const aBill = da !== "";
    const bBill = db !== "";
    if (aBill && bBill && da !== db) return db.localeCompare(da);
    if (aBill && !bBill) return -1;
    if (!aBill && bBill) return 1;
    const ya = a.release_year ?? 0;
    const yb = b.release_year ?? 0;
    if (ya !== yb) return yb - ya;
    return a.retroverse_album_id.localeCompare(b.retroverse_album_id);
  });
  return out;
}
