/** Billboard 200 album chart: valid ranks are 1–200 inclusive. */
export function chartRankFromRaw(raw: number | null | undefined): number | null {
  if (raw == null || !Number.isFinite(raw)) return null;
  const n = Math.round(Number(raw));
  if (n < 1 || n > 200) return null;
  return n;
}

/** Shared chart-date → fractional year (UTC) for occupancy / validation. */
export function chartDateToYearFloat(value: string | null): number | null {
  if (!value) return null;
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  const year = date.getUTCFullYear();
  if (year < 1900 || year > 2100) return null;
  const start = Date.UTC(year, 0, 1);
  const end = Date.UTC(year + 1, 0, 1);
  return year + (date.getTime() - start) / (end - start);
}
