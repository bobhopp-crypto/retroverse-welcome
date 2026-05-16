import type { RetroscopeCellDTO } from "@/lib/album-retroscope-constants";
import { retroscopeCellKey } from "@/lib/album-retroscope-constants";
import { loadAlbumRetroscopeDataset } from "@/lib/load-album-retroscope-dataset";
import { retroscopeDatasetCorpusId } from "@/lib/retroscope-persist-session";
import { retroscopeTrackRankLabel } from "@/lib/retroscope-mode";

export type { RetroscopeCellDTO } from "@/lib/album-retroscope-constants";
export {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_GRID_ROWS_MOBILE,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  RETROSCOPE_YEAR_MAX,
  RETROSCOPE_YEAR_MIN,
  retroscopeCellKey,
} from "@/lib/album-retroscope-constants";

/**
 * Track RetroScope placeholder — same coordinate shell, album corpus remapped as track stubs.
 * Replace with Hot 100 track rankings when materialized.
 */
export async function loadTrackRetroscopeDataset(): Promise<{
  cells: RetroscopeCellDTO[];
  initialActiveKey: string;
  corpusId: string;
} | null> {
  const album = await loadAlbumRetroscopeDataset();
  if (!album || album.cells.length === 0) return null;

  const cells: RetroscopeCellDTO[] = album.cells.map((row) => ({
    ...row,
    entityKind: "track",
    entityId: `track:${row.entityId}`,
    albumId: row.entityId,
    title: row.title,
    artist: row.artist,
    canonicalCoverPath: null,
    sourceNote: "track-mode-stub",
    artistRetroscopeKey: `${row.chartYear}:${retroscopeTrackRankLabel(row.retroverseRank)}`,
  }));

  const corpusId = retroscopeDatasetCorpusId({
    source: "track-stub-from-album-corpus",
    version: 0,
    generatedAt: "stub",
    cellCount: cells.length,
  });

  return {
    cells,
    initialActiveKey: retroscopeCellKey(cells[0]!.chartYear, cells[0]!.retroverseRank),
    corpusId,
  };
}
