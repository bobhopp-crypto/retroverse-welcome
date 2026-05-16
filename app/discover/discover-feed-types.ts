export type DiscoverTrustState = "verified" | "provisional" | "unresolved";

export type DiscoverStableAlbumRow = {
  kind: "album";
  albumId: string;
  title: string;
  artist: string;
  year: number | null;
  canonicalCoverPath: string | null;
  /** ISO timestamp or epoch token for `?v=` after curator override. */
  canonicalCoverCacheBust?: string | null;
  trustState: DiscoverTrustState;
};

export type DiscoverStableGapRow = {
  kind: "gap";
  key: string;
};

export type DiscoverStableRow = DiscoverStableAlbumRow | DiscoverStableGapRow;

/** Fixed discover page size (home + era album streams). */
export const DISCOVER_ALBUMS_PER_PAGE = 12;

export type DiscoverFeedStats = {
  totalRows: number;
  albumRows: number;
  gapRows: number;
  rowsWithCover: number;
  albumsInScope: number;
};

export type DiscoverPagination = {
  page: number;
  pageSize: typeof DISCOVER_ALBUMS_PER_PAGE;
  totalAlbums: number;
  totalPages: number;
};

export type DiscoverEraNav = {
  headline: string;
  subline: string | null;
  /** Pagination base: `/` (Discover home) or `/eras/slug`. */
  listBasePath: string;
  prevEraSlug: string | null;
  nextEraSlug: string | null;
};
