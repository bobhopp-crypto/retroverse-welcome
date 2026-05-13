/**
 * Retroverse Rank: restrict chart rows to **US Billboard album charts** only (exclude singles / Hot 100, etc.).
 * Used by `viewer-scope` and inspection reports.
 */
export function retroverseAlbumChartAppearances(chartName: string): boolean {
  const n = chartName.trim().toLowerCase();
  if (!n.includes("billboard")) return false;

  // Non‑US Billboard album lists / global aggregates (not Retroverse Rank US corpus).
  if (
    /\bcanada\b|\bmexico\b|\b(?:united\s+)?kingdom\b|\buk\b|\baustralia\b|\bnew\s+zealand\b|\bjapan\b|\bgermany\b|\bfrance\b|\bspain\b|\bitaly\b|\b(?:the\s+)?netherlands\b|\bsweden\b|\bnorway\b|\bbrasil\b|\bbrazil\b|\bbillboard\s+global\b|\b(?:global|world)\s+200\b|\bex[\s-]?us\b/i.test(
      n,
    )
  ) {
    return false;
  }

  // Singles / hybrid song charts — exclude from album-only universe.
  if (
    /\bhot\b\s*100\b|hot100|streaming\s+songs|tiktok\b|youtube\b|christian\b\s+gospel\b|christian\b\s+ac\b|christian\b\s+songs|r&b\b.*hip-?hop\s+songs|country\s+songs\b|latin\s+songs\b|digital\s+song\b|digital\s+sales\b|radi(r|o)o\s+songs\b|pop\s+songs\b|rock\b\s+songs\b|adult\b\s+(pop|alternative)\s+.*songs\b|^spotify\b|^apple\s+business\b|^shazam\b/i.test(n)
  ) {
    return false;
  }

  // Billboard **album** chart families (US-ish naming)
  if (/\b200\b|\btop\b[^\n]{0,24}\balbum\b|\balbum[^\n]{0,12}\bchart\b|catalog(?:ue)?\b|\bvinyl[^\n]{0,12}\balbum\b|top[^\n]{0,12}\balbum[^\n]{0,12}\bsales\b/i.test(n)) {
    return true;
  }

  return false;
}
