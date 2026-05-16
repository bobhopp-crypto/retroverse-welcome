import { readFileSync } from "node:fs";
import path from "node:path";
import { cache } from "react";

import seedBundled from "@/data/album-retroscope-seed.json";
import type { AlbumRetroscopeSeedFile, AlbumRetroscopeSeedRow } from "@/lib/album-retroscope-seed";
import type { RetroscopeCoordinateCell, RetroscopeCoordinatesFile } from "@/lib/retroscope-coordinates-schema";
import {
  retroscopeCellKey,
  type RetroscopeCellDTO,
} from "@/lib/album-retroscope-constants";
import { mergeCanonicalArtworkOverridesIntoRetroscopeCells } from "@/lib/canonical-artwork-overrides";
import { retroscopeDatasetCorpusId } from "@/lib/retroscope-persist-session";

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
  const title = row.album?.trim() || "—";
  const artist = row.artist?.trim() || "—";
  return {
    chartYear: row.chartYear,
    retroverseRank: row.chartRank,
    entityKind: "album",
    entityId: id,
    albumId: id,
    title,
    artist,
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
  const title = row.album.trim() || "—";
  const artist = row.artist.trim() || "—";
  return {
    chartYear: row.year,
    retroverseRank: row.rank,
    entityKind: "album",
    entityId: id,
    albumId: id,
    title,
    artist,
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

export type AlbumRetroscopeDataset = {
  cells: RetroscopeCellDTO[];
  initialActiveKey: string;
  corpusId: string;
};

/** Server-only: Billboard 200 corpus from materialized runtime JSON or small bundled seed (no Supabase). */
async function loadAlbumRetroscopeDatasetUncached(): Promise<AlbumRetroscopeDataset | null> {
  const log = "[album-retroscope:data]";

  const coords = loadCoordinatesFile();
  if (coords) {
    const rawCells = cellsFromCoordinates(coords);
    if (rawCells.length === 0) {
      console.warn(log, "coordinates file produced zero cells");
      return null;
    }

    const cells = sortCellsStableForRetroscope(await mergeCanonicalArtworkOverridesIntoRetroscopeCells(rawCells));
    const firstCell = cells[0]!;
    const initialActiveKey = retroscopeCellKey(firstCell.chartYear, firstCell.retroverseRank);
    const corpusId = retroscopeDatasetCorpusId({
      source: coords.source_db ?? "retroscope-coordinates",
      version: coords.version,
      generatedAt: coords.generated_at,
      cellCount: coords.cell_count ?? cells.length,
    });

    console.info(log, {
      corpusSize: cells.length,
      initialActiveKey,
      corpusId,
      source: coords.source_db,
      generatedAt: coords.generated_at,
      runtime: "retroscope-coordinates.json",
    });
    return { cells, initialActiveKey, corpusId };
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

  const cells = sortCellsStableForRetroscope(await mergeCanonicalArtworkOverridesIntoRetroscopeCells(rawCells));
  const firstCell = cells[0]!;
  const initialActiveKey = retroscopeCellKey(firstCell.chartYear, firstCell.retroverseRank);
  const corpusId = retroscopeDatasetCorpusId({
    source: seed.source_db ?? "bundled-seed",
    version: 1,
    generatedAt: seed.generated_at,
    cellCount: cells.length,
  });

  console.info(log, {
    corpusSize: cells.length,
    initialActiveKey,
    corpusId,
    source: seed.source_db ?? "bundled-seed",
    generatedAt: seed.generated_at,
  });

  return { cells, initialActiveKey, corpusId };
}

const loadAlbumRetroscopeDatasetPerRequest = cache(loadAlbumRetroscopeDatasetUncached);

let moduleAlbumDataset: AlbumRetroscopeDataset | null | undefined;
let moduleAlbumInFlight: Promise<AlbumRetroscopeDataset | null> | null = null;

/** Dedupes within a request (`cache`) and across warm server instances (module memo). */
export async function loadAlbumRetroscopeDataset(): Promise<AlbumRetroscopeDataset | null> {
  if (moduleAlbumDataset !== undefined) return moduleAlbumDataset;
  if (moduleAlbumInFlight) return moduleAlbumInFlight;

  moduleAlbumInFlight = loadAlbumRetroscopeDatasetPerRequest().then((result) => {
    moduleAlbumDataset = result;
    moduleAlbumInFlight = null;
    return result;
  });

  return moduleAlbumInFlight;
}
