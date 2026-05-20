/** Shared Retroverse navigation targets — single source for header + entity strips. */

export type NavItem = { href: string; label: string };

/** Public header only — labs/tools live off-nav (Retroscope, Portal, integrity, etc.). */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/albums", label: "Albums" },
  { href: "/artists", label: "Artists" },
  { href: "/tracks", label: "Tracks" },
];

export function relationshipWorkspaceHref(artist: string, title: string): string {
  const q = new URLSearchParams({ artist, title });
  return `/relationship-workspace?${q.toString()}`;
}

export function trackDeckWeekHref(issueDate: string): string {
  return `/track-deck?date=${encodeURIComponent(issueDate)}`;
}

export function homeSearchHref(query: string): string {
  return `/?q=${encodeURIComponent(query.trim())}`;
}
