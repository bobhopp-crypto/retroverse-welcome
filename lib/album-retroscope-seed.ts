/**
 * Types for `/album-retroscope` local seed (see `data/album-retroscope-seed.json`).
 */
export type AlbumRetroscopeSeedRow = {
  albumId: string;
  year: number;
  rank: number;
  artist: string;
  album: string;
  canonical_cover_path: string | null;
  chart_date?: string;
  source?: string;
  source_note?: string;
};

export type AlbumRetroscopeSeedFile = {
  generated_at: string;
  source_db: string;
  album_count: number;
  year_range: [number, number];
  albums: AlbumRetroscopeSeedRow[];
};
