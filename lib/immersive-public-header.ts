/** Routes that render without the global tan public header (immersive entity surfaces). */
const IMMERSIVE_PREFIXES = ["/albums"] as const;

export function hidesPublicSiteHeader(pathname: string): boolean {
  return IMMERSIVE_PREFIXES.some((prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`));
}
