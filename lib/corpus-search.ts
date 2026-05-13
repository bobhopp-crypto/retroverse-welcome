/** Full-corpus album title search helpers (no Discover subset). */

export function sanitizeSearchQuery(raw: string): string {
  return raw.trim().replace(/[%_\\]/g, " ").replace(/\s+/g, " ").slice(0, 96);
}

/**
 * Generate ilike needle variants so US/UK spellings still hit canonical titles
 * (e.g. Rumors → Rumours) without a separate search index.
 */
export function albumTitleSearchVariants(q: string): string[] {
  const base = q.trim();
  if (!base) return [];
  const out = new Set<string>([base]);
  if (/rumor/i.test(base)) {
    out.add(base.replace(/rumors/gi, "rumours"));
    out.add(base.replace(/rumours/gi, "rumors"));
    out.add(base.replace(/rumor/gi, "rumour"));
    out.add(base.replace(/rumour/gi, "rumor"));
  }
  if (/color/i.test(base)) {
    out.add(base.replace(/color/gi, "colour"));
    out.add(base.replace(/colour/gi, "color"));
  }
  if (/favorite/i.test(base)) {
    out.add(base.replace(/favorite/gi, "favourite"));
    out.add(base.replace(/favourite/gi, "favorite"));
  }
  return [...out];
}

export function ilikePattern(variant: string): string {
  return `%${variant}%`;
}

/** Lower = better. Used after DB fetch so substring queries are not chopped by low row limits. */
export function albumTitleSearchRank(canonicalTitle: string, rawQuery: string): number {
  const t = canonicalTitle.trim().toLowerCase();
  const q = rawQuery.trim().toLowerCase();
  if (!q) return 99;
  if (t === q) return 0;
  if (t.startsWith(q)) return 1;
  const variants = albumTitleSearchVariants(rawQuery.trim()).map((v) => v.trim().toLowerCase()).filter(Boolean);
  for (const v of variants) {
    if (t === v) return 0;
    if (t.startsWith(v)) return 1;
  }
  return 2;
}
