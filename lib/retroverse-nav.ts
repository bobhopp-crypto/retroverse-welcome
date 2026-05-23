/** Shared Retroverse navigation targets — single source for header + entity strips. */

import { CHARTS_HREF } from "@/lib/transport-nav";

export type NavItem = { href: string; label: string };

/** @deprecated Use TRANSPORT_NAV + RetroverseTransportDeck. Kept for internal strips only. */
export const PRIMARY_NAV: NavItem[] = [
  { href: "/albums", label: "Albums" },
  { href: "/artists", label: "Artists" },
  { href: CHARTS_HREF, label: "Charts" },
  { href: "/album-retroscope", label: "Retroscope" },
  { href: "/eras", label: "Eras" },
];

export function relationshipWorkspaceHref(artist: string, title: string): string {
  const q = new URLSearchParams({ artist, title });
  return `/relationship-workspace?${q.toString()}`;
}

export function trackDeckWeekHref(issueDate: string): string {
  return `${CHARTS_HREF}?date=${encodeURIComponent(issueDate)}`;
}

export function homeSearchHref(query: string): string {
  return `/?q=${encodeURIComponent(query.trim())}`;
}
