import { albumTitleSearchRank, sanitizeSearchQuery } from "@/lib/corpus-search";
import { getAlbumDossiersBundleOrNull } from "@/lib/load-album-dossier";
import { hrefForAlbum, hrefForArtist, normalizeEntitySlug } from "@/lib/retroverse-routes";

import { sortByMatchScore } from "./rank";
import type { HomeSearchAlbum, HomeSearchArtist } from "./types";

export function searchDossierAlbums(q: string, limit = 6): HomeSearchAlbum[] {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2) return [];

  const bundle = getAlbumDossiersBundleOrNull();
  if (!bundle) return [];

  const rows: HomeSearchAlbum[] = [];
  for (const dossier of Object.values(bundle.dossiers)) {
    const title = dossier.identity.album?.trim() ?? "";
    const artist = dossier.identity.artist?.trim() ?? "—";
    if (!title) continue;
    const hay = `${title} ${artist}`.toLowerCase();
    if (!hay.includes(needle.toLowerCase()) && albumTitleSearchRank(title, needle) > 2) continue;
    rows.push({
      kind: "album",
      title,
      artist,
      year: dossier.identity.chart_year ?? null,
      href: hrefForAlbum(dossier.albumId, title),
      relation: "ALBUM",
    });
  }

  return sortByMatchScore(rows, needle, (r) => r.title, limit);
}

export function searchDossierArtists(q: string, limit = 6): HomeSearchArtist[] {
  const needle = sanitizeSearchQuery(q);
  if (needle.length < 2) return [];

  const bundle = getAlbumDossiersBundleOrNull();
  if (!bundle) return [];

  const bySlug = new Map<string, HomeSearchArtist>();
  for (const dossier of Object.values(bundle.dossiers)) {
    const name = dossier.identity.artist?.trim();
    if (!name) continue;
    if (!name.toLowerCase().includes(needle.toLowerCase())) continue;
    const slug = normalizeEntitySlug(name);
    if (!bySlug.has(slug)) {
      bySlug.set(slug, {
        kind: "artist",
        name,
        href: hrefForArtist(null, name),
      });
    }
  }

  return sortByMatchScore([...bySlug.values()], needle, (r) => r.name, limit);
}
