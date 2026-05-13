export type CanonicalAlbumKind =
  | "soundtrack"
  | "greatest_hits"
  | "compilation"
  | "self_titled"
  | "studio_or_live";

export type SoundtrackOwnerMode =
  | "not_soundtrack"
  | "dominant_contributor"
  | "various_artists";

export type ResolverIdentity = {
  canonical_album_title: string;
  canonical_artist_name: string;
  release_year: number | null;
  album_kind: CanonicalAlbumKind;
  soundtrack_owner_mode: SoundtrackOwnerMode;
  artwork_search_query: string;
  normalized_search_tokens: string[];
  resolver_notes: string[];
};

function normalizeBase(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['".,!?/\\:;`~*+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalAlbumKind(title: string, artist: string): CanonicalAlbumKind {
  const t = title.toLowerCase();
  const a = artist.toLowerCase();
  if (/soundtrack|original motion picture|motion picture/i.test(t) || /various artists/i.test(a)) return "soundtrack";
  if (/greatest hits|best of|anthology/i.test(t)) return "greatest_hits";
  if (/collection|compilation/i.test(t)) return "compilation";
  if (normalizeBase(title) === normalizeBase(artist)) return "self_titled";
  return "studio_or_live";
}

export function soundtrackOwnerMode(title: string, artist: string): SoundtrackOwnerMode {
  if (!/soundtrack|original motion picture|motion picture/i.test(title.toLowerCase()) && !/various artists/i.test(artist.toLowerCase())) {
    return "not_soundtrack";
  }
  if (/various artists/i.test(artist.toLowerCase())) return "various_artists";
  return "dominant_contributor";
}

function normalizeTitleForSearch(title: string): string {
  return normalizeBase(
    title
      .replace(/\(.*?\)/g, " ")
      .replace(/\[.*?\]/g, " ")
      .replace(/\b(deluxe|expanded|remaster(?:ed)?|special edition|anniversary edition)\b/gi, " ")
      .replace(/\s[-:]\s.*$/, " "),
  );
}

export function resolverIdentity(input: {
  canonical_album_title: string;
  canonical_artist_name: string;
  release_year: number | null;
}): ResolverIdentity {
  const { canonical_album_title, canonical_artist_name, release_year } = input;
  const kind = canonicalAlbumKind(canonical_album_title, canonical_artist_name);
  const soundtrackMode = soundtrackOwnerMode(canonical_album_title, canonical_artist_name);
  const normalizedArtist = normalizeBase(canonical_artist_name);
  const normalizedTitle = normalizeTitleForSearch(canonical_album_title);
  const tokens = [...new Set(`${normalizedArtist} ${normalizedTitle}`.split(/\s+/).filter(Boolean))];
  const notes: string[] = [];
  if (kind === "soundtrack") {
    notes.push("soundtrack_handling");
    notes.push(soundtrackMode === "various_artists" ? "prefer_soundtrack_album_over_contributor_album" : "allow_dominant_contributor_match");
  }
  if (kind === "greatest_hits" || kind === "compilation") notes.push("compilation_wording_relaxed");
  if (kind === "self_titled") notes.push("self_titled_disambiguation_required");

  return {
    canonical_album_title,
    canonical_artist_name,
    release_year,
    album_kind: kind,
    soundtrack_owner_mode: soundtrackMode,
    artwork_search_query: `${canonical_artist_name} ${canonical_album_title}`.replace(/\s+/g, " ").trim(),
    normalized_search_tokens: tokens,
    resolver_notes: notes,
  };
}
