import { readFileSync } from "node:fs";
import path from "node:path";

import seedBundled from "@/data/album-retroscope-seed.json";
import type { AlbumRetroscopeSeedFile, AlbumRetroscopeSeedRow } from "@/lib/album-retroscope-seed";
import type { RetroscopeCoordinateCell, RetroscopeCoordinatesFile } from "@/lib/retroscope-coordinates-schema";
import {
  retroscopeCellKey,
  type RetroscopeCellDTO,
} from "@/lib/album-retroscope-constants";
import { mergeCanonicalArtworkOverridesIntoRetroscopeCells } from "@/lib/canonical-artwork-overrides";

export type { RetroscopeCellDTO } from "@/lib/album-retroscope-constants";
export {
  RETROSCOPE_GRID_COLS,
  RETROSCOPE_GRID_ROWS,
  RETROSCOPE_RANK_MAX,
  RETROSCOPE_WORLD_YEAR_MAX,
  RETROSCOPE_WORLD_YEAR_MIN,
  RETROSCOPE_YEAR_MAX,
  RETROSCOPE_YEAR_MIN,
  retroscopeCellKey,
} from "@/lib/album-retroscope-constants";

function loadCoordinatesFile(): RetroscopeCoordinatesFile | null {
  const envPath = process.env.ALBUM_RETROSCOPE_COORDINATES_PATH?.trim();
  const fromRoot = process.env.RETROVERSE_DATA_ROOT?.trim()
    ? path.join(process.env.RETROVERSE_DATA_ROOT!.trim(), "runtime", "retroscope-coordinates.json")
    : "";
  const publicBundled = path.join(
    process.cwd(),
    "public",
    "data",
    "retroscope",
    "retroscope-coordinates.json",
  );

  for (const p of [envPath, fromRoot, publicBundled]) {
    if (!p) continue;
    try {
      const raw = readFileSync(p, "utf8");
      const parsed = JSON.parse(raw) as RetroscopeCoordinatesFile;
      if (parsed && Array.isArray(parsed.cells) && parsed.cells.length > 0) {
        return parsed;
      }
    } catch {
      /* try next */
    }
  }
  return null;
}

function loadSeedFile(): AlbumRetroscopeSeedFile {
  const override = process.env.ALBUM_RETROSCOPE_SEED_PATH?.trim();
  if (override) {
    const raw = readFileSync(override, "utf8");
    return JSON.parse(raw) as AlbumRetroscopeSeedFile;
  }
  const runtime = process.env.RETROVERSE_DATA_ROOT
    ? path.join(process.env.RETROVERSE_DATA_ROOT, "runtime", "album-retroscope-seed.json")
    : "";
  if (runtime) {
    try {
      const raw = readFileSync(runtime, "utf8");
      return JSON.parse(raw) as AlbumRetroscopeSeedFile;
    } catch {
      /* bundled fallback */
    }
  }
  return seedBundled as AlbumRetroscopeSeedFile;
}

function normalizeTrustState(raw: string | undefined): RetroscopeCellDTO["trustState"] {
  if (raw === "verified" || raw === "provisional") return raw;
  return "unresolved";
}

function coordToDto(row: RetroscopeCoordinateCell): RetroscopeCellDTO | null {
  if (!Number.isFinite(row.chartYear) || !Number.isFinite(row.chartRank) || row.chartRank < 1) return null;
  const id = row.albumId?.trim();
  if (!id) return null;
  const pathVal = row.canonical_cover_path?.trim() || null;
  return {
    chartYear: row.chartYear,
    retroverseRank: row.chartRank,
    albumId: id,
    title: row.album?.trim() || "—",
    artist: row.artist?.trim() || "—",
    releaseYear: row.chartYear,
    canonicalCoverPath: pathVal,
    trustState: normalizeTrustState(row.trustState),
    sourceNote: row.source_note?.trim() || null,
    trustScore: Number.isFinite(row.trust_score) ? row.trust_score : undefined,
    identityState: row.identity_state?.trim() || undefined,
  };
}

function rowToCell(row: AlbumRetroscopeSeedRow): RetroscopeCellDTO | null {
  const id = row.albumId.trim();
  if (!id || !Number.isFinite(row.year) || !Number.isFinite(row.rank) || row.rank < 1) return null;
  const pathVal = row.canonical_cover_path?.trim() || null;
  return {
    chartYear: row.year,
    retroverseRank: row.rank,
    albumId: id,
    title: row.album.trim() || "—",
    artist: row.artist.trim() || "—",
    releaseYear: row.year,
    canonicalCoverPath: pathVal,
    trustState: pathVal ? "verified" : "unresolved",
    sourceNote: row.source_note?.trim() || null,
  };
}

function seedToCells(seed: AlbumRetroscopeSeedFile): RetroscopeCellDTO[] {
  const out: RetroscopeCellDTO[] = [];
  const seen = new Set<string>();
  for (const row of seed.albums ?? []) {
    const cell = rowToCell(row);
    if (!cell) continue;
    const k = retroscopeCellKey(cell.chartYear, cell.retroverseRank);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cell);
    if (out.length >= 25) break;
  }
  return out;
}

function cellsFromCoordinates(file: RetroscopeCoordinatesFile): RetroscopeCellDTO[] {
  const out: RetroscopeCellDTO[] = [];
  const seen = new Set<string>();
  for (const row of file.cells) {
    const cell = coordToDto(row);
    if (!cell) continue;
    const k = retroscopeCellKey(cell.chartYear, cell.retroverseRank);
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(cell);
  }
  return out;
}

/** Stable corpus order → stable `retroscopeCorpusId` and SSR `initialActiveKey` (never random — client picks random start on first-ever visit via localStorage). */
function sortCellsStableForRetroscope(cells: RetroscopeCellDTO[]): RetroscopeCellDTO[] {
  return [...cells].sort((a, b) => {
    if (a.chartYear !== b.chartYear) return a.chartYear - b.chartYear;
    return a.retroverseRank - b.retroverseRank;
  });
}

/** Server-only: Billboard 200 corpus from materialized runtime JSON or small bundled seed (no Supabase). */
export function loadAlbumRetroscopeDataset(): {
  cells: RetroscopeCellDTO[];
  initialActiveKey: string;
} | null {
  const log = "[album-retroscope:data]";

  const coords = loadCoordinatesFile();
  if (coords) {
    const rawCells = cellsFromCoordinates(coords);
    if (rawCells.length === 0) {
      console.warn(log, "coordinates file produced zero cells");
      return null;
    }

    const cells = sortCellsStableForRetroscope(mergeCanonicalArtworkOverridesIntoRetroscopeCells(rawCells));
    const firstCell = cells[0]!;
    const initialActiveKey = retroscopeCellKey(firstCell.chartYear, firstCell.retroverseRank);

    console.info(log, {
      corpusSize: cells.length,
      initialActiveKey,
      source: coords.source_db,
      generatedAt: coords.generated_at,
      runtime: "retroscope-coordinates.json",
    });
    return { cells, initialActiveKey };
  }

  let seed: AlbumRetroscopeSeedFile;
  try {
    seed = loadSeedFile();
  } catch (e) {
    console.warn(log, "seed file load failed", e);
    return null;
  }

  const rawCells = seedToCells(seed);
  if (rawCells.length === 0) {
    console.warn(log, "seed produced zero cells");
    return null;
  }

  const cells = sortCellsStableForRetroscope(mergeCanonicalArtworkOverridesIntoRetroscopeCells(rawCells));
  const firstCell = cells[0]!;
  const initialActiveKey = retroscopeCellKey(firstCell.chartYear, firstCell.retroverseRank);

  console.info(log, {
    corpusSize: cells.length,
    initialActiveKey,
    source: seed.source_db ?? "bundled-seed",
    generatedAt: seed.generated_at,
  });

  return { cells, initialActiveKey };
}
