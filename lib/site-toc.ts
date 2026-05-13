export type SiteTocEntry = {
  href: string;
  label: string;
  note?: string;
};

export type SiteTocPattern = {
  pattern: string;
  label: string;
  examples: SiteTocEntry[];
  note?: string;
};

/** Primary shortcuts (also in header). */
export const indexPrimaryNav: SiteTocEntry[] = [
  { href: "/", label: "Discover" },
  { href: "/eras", label: "Eras" },
  { href: "/artists", label: "Artists" },
  { href: "/albums", label: "Albums" },
  { href: "/search", label: "Search" },
  { href: "/index", label: "Index", note: "this page — tools + coverage" },
  { href: "/toc", label: "Full route table", note: "verbose TOC" },
];

/** Internal: curator, ops, legacy entry points; not in main header. */
export const indexToolsNav: SiteTocEntry[] = [
  { href: "/internal/curator", label: "Curator" },
  { href: "/internal/artwork", label: "Internal artwork" },
  { href: "/artwork-workbench", label: "Artwork workbench" },
  { href: "/ops/review", label: "Review console" },
  { href: "/ops/itunes-album-review", label: "iTunes calibration" },
  { href: "/api/discover/review-state", label: "POST discover review-state", note: "API" },
  { href: "/welcome", label: "Welcome landing" },
  { href: "/week", label: "This week" },
  { href: "/random", label: "Random" },
  { href: "/tracks", label: "Tracks index" },
  { href: "/discover", label: "Discover redirect", note: "→ /" },
];

/** Fixed app routes (no params). */
export const siteTocStaticPages: SiteTocEntry[] = [
  { href: "/", label: "Discover (home)" },
  { href: "/welcome", label: "Welcome landing", note: "early-access marketing page" },
  { href: "/week", label: "This Week" },
  { href: "/eras", label: "Eras index" },
  { href: "/eras/1974-1977", label: "Era 1974–1977 (canonical graph)" },
  { href: "/artists", label: "Artists index" },
  { href: "/albums", label: "Albums index" },
  { href: "/tracks", label: "Tracks index" },
  { href: "/search", label: "Search" },
  { href: "/index", label: "Index", note: "internal TOC + coverage" },
  { href: "/discover", label: "Discover", note: "redirects to /" },
  { href: "/random", label: "Random explore (redirect)" },
  { href: "/toc", label: "Table of contents", note: "this page" },
];

export const siteTocDynamicPatterns: SiteTocPattern[] = [
  {
    pattern: "/eras/[slug]",
    label: "Era archive detail",
    note: "Examples filled at build time from eras.json on the TOC page.",
    examples: [],
  },
  {
    pattern: "/albums/[slug]",
    label: "Album detail",
    examples: [
      { href: "/albums/saturday-night-fever", label: "Saturday Night Fever" },
      { href: "/albums/rumours", label: "Rumours" },
      { href: "/albums/eagles-their-greatest-hits-1971-1975", label: "Eagles Greatest Hits" },
    ],
  },
  {
    pattern: "/artists/[slug]",
    label: "Artist detail",
    examples: [{ href: "/artists/bee-gees", label: "Bee Gees" }],
  },
  {
    pattern: "/tracks/[id]",
    label: "Track detail",
    note: "RVTR… id or matched slug",
    examples: [{ href: "/tracks/RVTR000001", label: "Example RVTR id" }],
  },
];

export const siteTocInternalPages: SiteTocEntry[] = [
  { href: "/internal/curator", label: "Curator / repair surface" },
  { href: "/internal/artwork", label: "Internal artwork (archived notice)" },
  { href: "/artwork-workbench", label: "Artwork workbench", note: "redirects → /internal/curator" },
];

export const siteTocApiRoutes: SiteTocEntry[] = [
  { href: "/api/welcome-interest", label: "POST welcome interest" },
  { href: "/api/artwork-workbench/candidates", label: "Artwork candidates" },
  { href: "/api/artwork-workbench/decision", label: "Artwork decision" },
  { href: "/api/artwork-workbench/image", label: "Artwork image" },
  { href: "/api/artwork-workbench/living-action", label: "Living archive action" },
];
