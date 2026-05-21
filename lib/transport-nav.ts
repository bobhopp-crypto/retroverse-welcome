/** Canonical bottom transport deck — single public movement layer. */

export type TransportNavItem = {
  href: string;
  label: string;
  glyph: string;
};

export const TRANSPORT_NAV: TransportNavItem[] = [
  { href: "/albums", label: "Albums", glyph: "▣" },
  { href: "/artists", label: "Artists", glyph: "✦" },
  { href: "/tracks", label: "Tracks", glyph: "♪" },
  { href: "/track-deck", label: "Charts", glyph: "◇" },
  { href: "/album-retroscope", label: "Retroscope", glyph: "◎" },
  { href: "/eras", label: "Eras", glyph: "⌁" },
];

/** Lab / fullscreen routes — no transport deck (immersion preserved). */
export const TRANSPORT_EXCLUDED_PREFIXES = [
  "/portal-v2",
  "/portal",
  "/portal-stage",
  "/integrity",
  "/relationship-workspace",
  "/track-curator",
  "/dev-index",
  "/chart-inspector",
] as const;

export function transportNavVisible(pathname: string): boolean {
  return !TRANSPORT_EXCLUDED_PREFIXES.some((prefix) => pathname.startsWith(prefix));
}

export type BackAffordance = { href: string; label: string };

/** Subtle back target for top chrome on entity/detail routes. */
export function backAffordanceForPath(pathname: string): BackAffordance | null {
  const parts = pathname.split("/").filter(Boolean);
  if (!parts.length) return null;

  if (parts[0] === "albums" && parts[1]) {
    if (parts[2] === "chart-run") return { href: `/albums/${parts[1]}`, label: "Album" };
    return { href: "/albums", label: "Albums" };
  }
  if (parts[0] === "tracks" && parts[1]) return { href: "/tracks", label: "Tracks" };
  if (parts[0] === "artists" && parts[1]) return { href: "/artists", label: "Artists" };
  if (parts[0] === "search") return { href: "/", label: "Home" };
  if (parts[0] === "track-deck") return null;
  if (parts[0] === "album-retroscope") return null;
  if (parts[0] === "eras") return parts[1] ? { href: "/eras", label: "Eras" } : null;

  const top = parts[0];
  if (top === "albums" || top === "tracks" || top === "artists" || top === "eras") return null;
  return { href: "/", label: "Home" };
}

export function transportItemActive(pathname: string, href: string): boolean {
  if (href === "/") return pathname === "/";
  if (href === "/track-deck") return pathname.startsWith("/track-deck");
  if (href === "/album-retroscope") return pathname.startsWith("/album-retroscope");
  return pathname === href || pathname.startsWith(`${href}/`);
}
