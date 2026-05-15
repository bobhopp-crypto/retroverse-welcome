import type { Trail } from "./types";

type DepthBand = { min: number; max: number };

const DEFAULT_BANDS: DepthBand[] = [
  { min: 1, max: 10 },
  { min: 11, max: 25 },
  { min: 26, max: 40 },
  { min: 41, max: 60 },
  { min: 61, max: 100 },
  { min: 101, max: 200 },
];

/**
 * Chart-space adjacency: albums whose weekly rows fall nearest this cell's
 * (time × chart depth) — not recommendations, pure coordinate proximity.
 */
export function chartAdjacentNeighborsAtCell(
  col: number,
  row: number,
  columnStarts: number[],
  columnSpan: number,
  depthBands: DepthBand[],
  trails: Trail[],
  excludeAlbumId: string | null,
  maxResults: number,
): Trail[] {
  if (trails.length === 0 || columnStarts.length === 0) return [];
  const tCell = columnStarts[col]! + columnSpan / 2;
  const band = depthBands[row];
  if (!band) return [];
  const dMid = (band.min + band.max) / 2;

  const scored: { trail: Trail; score: number }[] = [];
  for (const trail of trails) {
    if (excludeAlbumId && trail.id === excludeAlbumId) continue;
    let best = Infinity;
    for (const p of trail.points) {
      const dy = (p.yearFloat - tCell) / Math.max(columnSpan * 0.48, 0.08);
      const dd = (p.position - dMid) / 26;
      const s = dy * dy + dd * dd;
      if (s < best) best = s;
    }
    if (best < Infinity && best < 2.4) scored.push({ trail, score: best });
  }
  scored.sort((a, b) => a.score - b.score);
  const out: Trail[] = [];
  const seen = new Set<string>();
  for (const { trail } of scored) {
    if (seen.has(trail.id)) continue;
    seen.add(trail.id);
    out.push(trail);
    if (out.length >= maxResults) break;
  }
  return out;
}

/**
 * Albums with chart activity inside [windowStart, windowEnd] whose trajectory
 * lies nearest the tuned signal in (time × rank) — contextual, not recommendations.
 */
export function contextualNeighborsInObservation(
  tuned: Trail,
  all: Trail[],
  windowStart: number,
  windowEnd: number,
  maxResults: number,
): Trail[] {
  if (tuned.points.length === 0 || all.length === 0) return [];
  const mid = (windowStart + windowEnd) / 2;
  const winW = Math.max(windowEnd - windowStart, 0.08);

  let ref = tuned.points[0]!;
  for (const p of tuned.points) {
    if (p.position < ref.position) ref = p;
  }
  if (ref.yearFloat < windowStart || ref.yearFloat > windowEnd) {
    let best = tuned.points[0]!;
    let bestAbs = Infinity;
    for (const p of tuned.points) {
      if (p.yearFloat < windowStart || p.yearFloat > windowEnd) continue;
      const d = Math.abs(p.yearFloat - mid);
      if (d < bestAbs) {
        bestAbs = d;
        best = p;
      }
    }
    ref = best;
  }

  const scored: { trail: Trail; score: number }[] = [];
  for (const trail of all) {
    if (trail.id === tuned.id) continue;
    let best = Infinity;
    for (const p of trail.points) {
      if (p.yearFloat < windowStart || p.yearFloat > windowEnd) continue;
      const dy = (p.yearFloat - ref.yearFloat) / winW;
      const dd = (p.position - ref.position) / 42;
      const s = dy * dy + dd * dd;
      if (s < best) best = s;
    }
    if (best < Infinity && best < 2.2) scored.push({ trail, score: best });
  }
  scored.sort((a, b) => a.score - b.score);
  const out: Trail[] = [];
  const seen = new Set<string>();
  for (const { trail } of scored) {
    if (seen.has(trail.id)) continue;
    seen.add(trail.id);
    out.push(trail);
    if (out.length >= maxResults) break;
  }
  return out;
}

function meanChartPositionInWindow(trail: Trail, windowStart: number, windowEnd: number): number | null {
  let sum = 0;
  let n = 0;
  for (const p of trail.points) {
    if (p.yearFloat >= windowStart && p.yearFloat <= windowEnd) {
      sum += p.position;
      n += 1;
    }
  }
  return n > 0 ? sum / n : null;
}

/** Chart-depth order among signals active in the observation window (cultural zone). */
export function culturalZoneDepthOrderedIds(
  trails: Trail[],
  windowStart: number,
  windowEnd: number,
): string[] {
  if (trails.length === 0) return [];
  const items: { id: string; d: number }[] = [];
  for (const t of trails) {
    const m = meanChartPositionInWindow(t, windowStart, windowEnd);
    if (m === null) continue;
    items.push({ id: t.id, d: m });
  }
  items.sort((a, b) => a.d - b.d);
  return items.map((x) => x.id);
}

export function buildNeighborCellMatrix(
  cols: number,
  rows: number,
  columnStarts: number[],
  columnSpan: number,
  trails: Trail[],
  excludeAlbumId: string | null,
  maxPerCell: number,
): Trail[][][] {
  const m: Trail[][][] = [];
  for (let row = 0; row < rows; row++) {
    const line: Trail[][] = [];
    for (let col = 0; col < cols; col++) {
      line.push(
        chartAdjacentNeighborsAtCell(
          col,
          row,
          columnStarts,
          columnSpan,
          DEFAULT_BANDS,
          trails,
          excludeAlbumId,
          maxPerCell,
        ),
      );
    }
    m.push(line);
  }
  return m;
}
