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

/** RetroScope — primary product entry points. */
export const indexRetroscopeNav: SiteTocEntry[] = [
  { href: "/album-retroscope", label: "Album mode", note: "year × rank · Billboard 200" },
  { href: "/artist-retroscope", label: "Artist mode", note: "year × artist rank" },
  { href: "/track-retroscope", label: "Track mode", note: "Hot 100 stub" },
];

/** Browse surfaces (header nav). */
export const indexPrimaryNav: SiteTocEntry[] = [
  { href: "/artists", label: "Artists" },
  { href: "/albums", label: "Albums" },
  { href: "/eras", label: "Eras" },
  { href: "/search", label: "Search" },
  { href: "/track-deck", label: "Charts", note: "Hot 100 exploration · track find" },
];

/** Editorial and utilities. */
export const indexSecondaryNav: SiteTocEntry[] = [
  { href: "/welcome", label: "Welcome", note: "marketing landing" },
  { href: "/week", label: "This week", note: "editorial" },
  { href: "/random", label: "Random jump", note: "weighted explore" },
];

/** Internal / ops — not in main header. */
export const indexToolsNav: SiteTocEntry[] = [
  { href: "/track-deck", label: "Charts", note: "Hot 100 · VDJ · track find" },
  { href: "/track-curator", label: "Track curator", note: "VDJ match · accept/reject" },
  { href: "/relationship-workspace", label: "Relationship workspace", note: "multi-panel reconcile" },
  { href: "/internal/curator", label: "Curator", note: "artwork triage" },
  { href: "/portal-v2/curate", label: "Curator deep link", note: "?albumId=RVAL…" },
  { href: "/dev-index", label: "Dev route index", note: "all routes + status" },
  { href: "/retroverse-archive", label: "Retroverse Archive", note: "historical prototypes excavation" },
  { href: "/toc", label: "Full route table" },
];

/** Fixed app routes (no params) — used by /toc. */
export const siteTocStaticPages: SiteTocEntry[] = [
  { href: "/", label: "Home · Ask Retroverse", note: "search front door" },
  { href: "/album-retroscope", label: "RetroScope · Albums" },
  { href: "/artist-retroscope", label: "RetroScope · Artists" },
  { href: "/track-retroscope", label: "RetroScope · Tracks" },
  { href: "/welcome", label: "Welcome landing" },
  { href: "/week", label: "This week" },
  { href: "/eras", label: "Eras index" },
  { href: "/eras/1974-1977", label: "Era 1974–1977 (canonical graph)" },
  { href: "/artists", label: "Artists index" },
  { href: "/albums", label: "Albums index" },
  { href: "/track-deck", label: "Charts", note: "redirects from legacy /tracks" },
  { href: "/search", label: "Search" },
  { href: "/random", label: "Random explore" },
  { href: "/site-index", label: "Index", note: "this page" },
  { href: "/discover", label: "Discover", note: "→ /album-retroscope" },
  { href: "/viewer", label: "Viewer", note: "→ /album-retroscope" },
  { href: "/toc", label: "Table of contents" },
  { href: "/track-curator", label: "Track curator (internal)", note: "chart track · VDJ files" },
  {
    href: "/relationship-workspace",
    label: "Relationship workspace (internal)",
    note: "chart · RVTR · VDJ · R2",
  },
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
    label: "Album dossier",
    examples: [
      { href: "/albums/RVAL275844", label: "Sample RVAL dossier" },
      { href: "/albums/rumours", label: "Rumours (slug)" },
    ],
  },
  {
    pattern: "/artists/[slug]",
    label: "Artist profile",
    examples: [{ href: "/artists/linda-ronstadt", label: "Linda Ronstadt" }],
  },
  {
    pattern: "/tracks/[id]",
    label: "Track detail",
    note: "RVTR… id",
    examples: [{ href: "/tracks/RVTR000001", label: "Example RVTR id" }],
  },
];

export const siteTocInternalPages: SiteTocEntry[] = [
  { href: "/internal/curator", label: "Curator / repair surface" },
  { href: "/internal/artwork", label: "Internal artwork (archived notice)" },
  { href: "/internal/ops-pin", label: "Ops PIN gate" },
  { href: "/artwork-workbench", label: "Artwork workbench", note: "→ /internal/curator" },
  { href: "/ops/review", label: "Review console" },
  { href: "/ops/itunes-album-review", label: "iTunes calibration" },
];

export const siteTocApiRoutes: SiteTocEntry[] = [
  { href: "/api/welcome-interest", label: "POST welcome interest" },
  { href: "/api/artwork-workbench/candidates", label: "Artwork candidates" },
  { href: "/api/artwork-workbench/decision", label: "Artwork decision" },
  { href: "/api/artwork-workbench/image", label: "Artwork image" },
  { href: "/api/artwork-workbench/living-action", label: "Living archive action" },
];
