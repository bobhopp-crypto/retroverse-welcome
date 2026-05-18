/** Lower score = better match for sorting search hits. */
export function textMatchScore(text: string, query: string): number {
  const t = text.trim().toLowerCase();
  const q = query.trim().toLowerCase();
  if (!t || !q) return 99;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((tok) => t.includes(tok))) return 2;
  if (t.includes(q)) return 3;
  return 50;
}

export function sortByMatchScore<T>(
  rows: T[],
  query: string,
  pickText: (row: T) => string,
  limit: number,
): T[] {
  return [...rows]
    .map((row) => ({ row, score: textMatchScore(pickText(row), query) }))
    .filter((x) => x.score < 50)
    .sort((a, b) => a.score - b.score || pickText(a.row).localeCompare(pickText(b.row)))
    .slice(0, limit)
    .map((x) => x.row);
}
