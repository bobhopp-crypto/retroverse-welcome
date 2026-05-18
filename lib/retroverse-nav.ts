/** Shared Retroverse navigation targets — single source for header + entity strips. */

export type NavItem = { href: string; label: string };

export const PRIMARY_NAV: NavItem[] = [
  { href: "/", label: "Home" },
  { href: "/album-retroscope", label: "Retroscope" },
  { href: "/track-deck", label: "Charts" },
  { href: "/artists", label: "Artists" },
  { href: "/albums", label: "Albums" },
  { href: "/tracks", label: "Tracks" },
  { href: "/relationship-workspace", label: "Link" },
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
