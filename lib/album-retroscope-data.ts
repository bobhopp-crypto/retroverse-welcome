import { ALBUM_RETROSCOPE_SEED } from "@/lib/album-retroscope-seed";

export const RETROSCOPE_YEAR_MIN = 1965;
export const RETROSCOPE_YEAR_MAX = 1995;
/** Pointer may traverse empty coordinates outside the seed corridor (map bounds). */
export const RETROSCOPE_WORLD_YEAR_MIN = 1950;
export const RETROSCOPE_WORLD_YEAR_MAX = 2030;
export const RETROSCOPE_GRID_COLS = 7;
export const RETROSCOPE_GRID_ROWS = 10;
/** Soft ceiling for vertical navigation in this prototype. */
export const RETROSCOPE_RANK_MAX = 200;

export type RetroscopeCellDTO = {
  chartYear: number;
  retroverseRank: number;
  albumId: string;
  title: string;
  artist: string;
  releaseYear: number | null;
  canonicalCoverPath: string | null;
  trustState: "verified" | "provisional" | "unresolved";
};

export function retroscopeCellKey(chartYear: number, retroverseRank: number): string {
  return `${chartYear}:${retroverseRank}`;
}

function shuffleInPlace<T>(xs: T[], random: () => number): void {
  for (let i = xs.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [xs[i], xs[j]] = [xs[j]!, xs[i]!];
  }
}

function seedToCells(): RetroscopeCellDTO[] {
  const out: RetroscopeCellDTO[] = [];
  const seen = new Set<string>();
  for (const row of ALBUM_RETROSCOPE_SEED) {
    const id = row.albumId.trim();
    const path = row.canonicalCoverPath.trim();
    if (!id || !path || !Number.isFinite(row.year) || !Number.isFinite(row.rank) || row.rank < 1) continue;
    const k = retroscopeCellKey(row.year, row.rank);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({
      chartYear: row.year,
      retroverseRank: row.rank,
      albumId: id,
      title: row.title.trim() || "—",
      artist: row.artist.trim() || "—",
      releaseYear: row.year,
      canonicalCoverPath: path,
      trustState: "verified",
    });
    if (out.length >= 25) break;
  }
  return out;
}

/**
 * Local-first corpus for `/album-retroscope` — static seed only (no Supabase).
 */
export function loadAlbumRetroscopeDataset(seedRandom?: () => number): {
  cells: RetroscopeCellDTO[];
  initialActiveKey: string;
} | null {
  const rnd = seedRandom ?? Math.random;
  const log = "[album-retroscope:data]";

  const cells = seedToCells();
  if (cells.length === 0) {
    console.warn(log, "seed produced zero cells");
    return null;
  }

  const topBand = cells.filter(
    (c) =>
      c.chartYear >= RETROSCOPE_YEAR_MIN &&
      c.chartYear <= RETROSCOPE_YEAR_MAX &&
      c.retroverseRank >= 1 &&
      c.retroverseRank <= 10,
  );

  const firstCell = cells[0]!;
  let initialActiveKey = retroscopeCellKey(firstCell.chartYear, firstCell.retroverseRank);
  let usedTop10Random = false;

  if (topBand.length > 0) {
    const shuffled = [...topBand];
    shuffleInPlace(shuffled, rnd);
    const chosen = shuffled[0]!;
    initialActiveKey = retroscopeCellKey(chosen.chartYear, chosen.retroverseRank);
    usedTop10Random = true;
  } else {
    console.warn(log, "no top-10 in band; fallback first corpus entry", initialActiveKey);
  }

  const keyInCorpus = cells.some(
    (c) => retroscopeCellKey(c.chartYear, c.retroverseRank) === initialActiveKey,
  );
  if (!keyInCorpus) {
    initialActiveKey = retroscopeCellKey(firstCell.chartYear, firstCell.retroverseRank);
    usedTop10Random = false;
    console.warn(log, "initial key not in corpus; reset to first cell", initialActiveKey);
  }

  console.info(log, {
    corpusSize: cells.length,
    initialActiveKey,
    top10Pool: topBand.length,
    usedTop10Random,
    source: "static-seed",
  });

  return { cells, initialActiveKey };
}
