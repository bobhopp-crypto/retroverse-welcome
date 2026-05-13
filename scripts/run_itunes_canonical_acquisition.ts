import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { createClient } from "@supabase/supabase-js";
import { resolverIdentity } from "../lib/artwork-resolver-identity";

type AlbumRow = {
  retroverse_album_id: string;
  canonical_album_title: string;
  retroverse_artist_id: string;
  release_year: number | null;
};

type ArtistRow = {
  retroverse_artist_id: string;
  canonical_artist_name: string;
};

type TrackRow = {
  retroverse_track_id: string;
  retroverse_album_id: string | null;
};

type AlbumTrackRow = {
  retroverse_album_edition_id: string;
  retroverse_track_id: string;
};

type EditionRow = {
  retroverse_album_edition_id: string;
  retroverse_album_id: string;
};

type ChartRow = {
  retroverse_track_id: string;
};

type SearchResult = {
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  collectionId?: number;
  collectionType?: string;
  primaryGenreName?: string;
};

type Candidate = {
  artist_name: string;
  collection_name: string;
  release_date: string | null;
  artwork_url_100: string | null;
  artwork_url_600: string | null;
  score: number;
  artist_score: number;
  title_score: number;
  year_score: number;
  penalties: string[];
  reasons: string[];
};

type Tier = "high" | "medium" | "unresolved";

const OUT_ROOT = "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/itunes-pass";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/['".,!?/\\:;`~*+]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeLoose(value: string): string {
  return normalize(value)
    .replace(/\(.*?\)/g, " ")
    .replace(/\[.*?\]/g, " ")
    .replace(/\b(the|a|an)\b/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function clamp01(value: number): number {
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}

function scoreCandidate(targetArtist: string, targetTitle: string, targetYear: number | null, raw: SearchResult): Candidate {
  const artist = raw.artistName?.trim() ?? "";
  const title = raw.collectionName?.trim() ?? "";
  const artistKey = normalize(targetArtist);
  const artistLoose = normalizeLoose(targetArtist);
  const titleKey = normalize(targetTitle);
  const titleLoose = normalizeLoose(targetTitle);
  const candArtistKey = normalize(artist);
  const candArtistLoose = normalizeLoose(artist);
  const candTitleKey = normalize(title);
  const candTitleLoose = normalizeLoose(title);

  let artistScore = 0;
  let titleScore = 0;
  let yearScore = 0;
  const reasons: string[] = [];
  const penalties: string[] = [];

  if (candArtistKey === artistKey) {
    artistScore = 0.5;
    reasons.push("artist_exact");
  } else if (candArtistLoose === artistLoose) {
    artistScore = 0.36;
    reasons.push("artist_loose");
  } else if (candArtistKey.includes(artistLoose) || artistLoose.includes(candArtistKey)) {
    artistScore = 0.2;
    reasons.push("artist_contains");
  }

  if (candTitleKey === titleKey) {
    titleScore = 0.45;
    reasons.push("title_exact");
  } else if (candTitleLoose === titleLoose) {
    titleScore = 0.34;
    reasons.push("title_loose");
  } else if (candTitleKey.includes(titleLoose) || titleLoose.includes(candTitleKey)) {
    titleScore = 0.2;
    reasons.push("title_contains");
  }

  if (targetYear !== null && raw.releaseDate) {
    const year = Number.parseInt(raw.releaseDate.slice(0, 4), 10);
    if (Number.isFinite(year)) {
      const delta = Math.abs(year - targetYear);
      if (delta <= 1) {
        yearScore = 0.08;
        reasons.push("year_near");
      } else if (delta <= 3) {
        yearScore = 0.04;
        reasons.push("year_close");
      }
    }
  }

  let penalty = 0;
  const badTokens = ["karaoke", "tribute", "instrumental", "cover", "greatest hits", "best of"];
  const candCombined = `${candArtistKey} ${candTitleKey}`;
  for (const token of badTokens) {
    if (candCombined.includes(token) && !titleKey.includes(token)) {
      penalty += 0.15;
      penalties.push(`penalty_${token.replace(/\s+/g, "_")}`);
    }
  }

  const score = clamp01(Number((artistScore + titleScore + yearScore - penalty).toFixed(3)));
  const artwork600 = raw.artworkUrl100
    ? raw.artworkUrl100.replace(/100x100bb/gi, "600x600bb").replace(/100x100-75/gi, "600x600-75")
    : null;

  return {
    artist_name: artist,
    collection_name: title,
    release_date: raw.releaseDate ?? null,
    artwork_url_100: raw.artworkUrl100 ?? null,
    artwork_url_600: artwork600,
    score,
    artist_score: Number(artistScore.toFixed(3)),
    title_score: Number(titleScore.toFixed(3)),
    year_score: Number(yearScore.toFixed(3)),
    penalties,
    reasons,
  };
}

function classifyTier(candidate: Candidate | null): Tier {
  if (!candidate) return "unresolved";
  if (candidate.score >= 0.9 && candidate.artist_score >= 0.3 && candidate.title_score >= 0.34) return "high";
  if (candidate.score >= 0.72 && candidate.artist_score >= 0.2 && candidate.title_score >= 0.2) return "medium";
  return "unresolved";
}

async function fetchItunesCandidates(query: string): Promise<SearchResult[]> {
  const term = encodeURIComponent(query);
  const url = `https://itunes.apple.com/search?term=${term}&entity=album&limit=12`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`iTunes search failed: ${res.status}`);
  const json = (await res.json()) as { results?: SearchResult[] };
  return json.results ?? [];
}

async function download(url: string, destination: string): Promise<number> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed (${res.status}) for ${url}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  await writeFile(destination, bytes);
  return bytes.length;
}

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error("Set SUPABASE_URL (or NEXT_PUBLIC_SUPABASE_URL) and SUPABASE_SERVICE_ROLE_KEY before running iTunes acquisition.");
  }

  const supabase = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const [albumsResult, artistsResult, tracksResult, albumTracksResult, editionsResult, chartRowsResult] = await Promise.all([
    supabase.from("retroverse_albums").select("retroverse_album_id, canonical_album_title, retroverse_artist_id, release_year"),
    supabase.from("retroverse_artists").select("retroverse_artist_id, canonical_artist_name"),
    supabase.from("retroverse_tracks").select("retroverse_track_id, retroverse_album_id"),
    supabase.from("retroverse_album_tracks").select("retroverse_album_edition_id, retroverse_track_id"),
    supabase.from("retroverse_album_editions").select("retroverse_album_edition_id, retroverse_album_id"),
    supabase.from("retroverse_chart_appearances").select("retroverse_track_id"),
  ]);
  for (const result of [albumsResult, artistsResult, tracksResult, albumTracksResult, editionsResult, chartRowsResult]) {
    if (result.error) throw result.error;
  }

  const albums = (albumsResult.data ?? []) as AlbumRow[];
  const artists = (artistsResult.data ?? []) as ArtistRow[];
  const tracks = (tracksResult.data ?? []) as TrackRow[];
  const albumTracks = (albumTracksResult.data ?? []) as AlbumTrackRow[];
  const editions = (editionsResult.data ?? []) as EditionRow[];
  const chartRows = (chartRowsResult.data ?? []) as ChartRow[];

  const artistById = new Map(artists.map((row) => [row.retroverse_artist_id, row.canonical_artist_name]));
  const editionToAlbum = new Map(editions.map((row) => [row.retroverse_album_edition_id, row.retroverse_album_id]));
  const chartCountByTrack = new Map<string, number>();
  for (const row of chartRows) {
    chartCountByTrack.set(row.retroverse_track_id, (chartCountByTrack.get(row.retroverse_track_id) ?? 0) + 1);
  }

  const directTrackSetByAlbum = new Map<string, Set<string>>();
  for (const track of tracks) {
    if (!track.retroverse_album_id) continue;
    const set = directTrackSetByAlbum.get(track.retroverse_album_id) ?? new Set<string>();
    set.add(track.retroverse_track_id);
    directTrackSetByAlbum.set(track.retroverse_album_id, set);
  }

  const sequencedTrackSetByAlbum = new Map<string, Set<string>>();
  for (const row of albumTracks) {
    const albumId = editionToAlbum.get(row.retroverse_album_edition_id);
    if (!albumId) continue;
    const set = sequencedTrackSetByAlbum.get(albumId) ?? new Set<string>();
    set.add(row.retroverse_track_id);
    sequencedTrackSetByAlbum.set(albumId, set);
  }

  const acquisitionList = albums
    .map((album) => {
      const artist = artistById.get(album.retroverse_artist_id) ?? "Unknown artist";
      const identity = resolverIdentity({
        canonical_album_title: album.canonical_album_title,
        canonical_artist_name: artist,
        release_year: album.release_year,
      });
      const directTracks = directTrackSetByAlbum.get(album.retroverse_album_id) ?? new Set<string>();
      const seqTracks = sequencedTrackSetByAlbum.get(album.retroverse_album_id) ?? new Set<string>();
      const connected = new Set<string>([...directTracks, ...seqTracks]);
      const charted = [...connected].filter((trackId) => (chartCountByTrack.get(trackId) ?? 0) > 0).length;
      const importanceScore = connected.size * 2 + charted * 3;
      return {
        album_id: album.retroverse_album_id,
        artist,
        title: album.canonical_album_title,
        resolver_identity: identity,
        release_year: album.release_year,
        connected_track_count: connected.size,
        charted_track_count: charted,
        importance_score: importanceScore,
      };
    })
    .sort((a, b) => b.importance_score - a.importance_score || a.artist.localeCompare(b.artist) || a.title.localeCompare(b.title));

  const runId = `itunes_canonical_pass_${new Date().toISOString().replace(/[:.]/g, "-")}`;
  const runRoot = path.join(OUT_ROOT, runId);
  const stageHigh = path.join(runRoot, "staging", "high");
  const stageMedium = path.join(runRoot, "staging", "medium");
  const metaDir = path.join(runRoot, "metadata");
  await mkdir(stageHigh, { recursive: true });
  await mkdir(stageMedium, { recursive: true });
  await mkdir(metaDir, { recursive: true });

  const rows: Array<{
    album_id: string;
    artist: string;
    title: string;
    resolver_identity: ReturnType<typeof resolverIdentity>;
    release_year: number | null;
    connected_track_count: number;
    charted_track_count: number;
    importance_score: number;
    tier: Tier;
    best_candidate: Candidate | null;
    candidates: Candidate[];
    download_status: "downloaded" | "failed" | "not_attempted";
    staged_file: string | null;
    download_error: string | null;
  }> = [];

  let downloadSuccess = 0;
  let downloadFailure = 0;

  for (const album of acquisitionList) {
    let candidatesRaw: SearchResult[] = [];
    try {
      candidatesRaw = await fetchItunesCandidates(album.resolver_identity.artwork_search_query);
    } catch {
      candidatesRaw = [];
    }
    const scored = candidatesRaw
      .map((raw) => scoreCandidate(album.artist, album.title, album.release_year, raw))
      .sort((a, b) => b.score - a.score);
    const best = scored[0] ?? null;
    const tier = classifyTier(best);

    let downloadStatus: "downloaded" | "failed" | "not_attempted" = "not_attempted";
    let stagedFile: string | null = null;
    let downloadError: string | null = null;

    if ((tier === "high" || tier === "medium") && best?.artwork_url_600) {
      const tierDir = tier === "high" ? stageHigh : stageMedium;
      const filename = `${album.album_id}__${slugify(album.artist)}__${slugify(album.title)}.jpg`;
      const targetAbs = path.join(tierDir, filename);
      try {
        const byteSize = await download(best.artwork_url_600, targetAbs);
        if (byteSize >= 10_000) {
          downloadStatus = "downloaded";
          stagedFile = targetAbs;
          downloadSuccess += 1;
        } else {
          downloadStatus = "failed";
          downloadError = `downloaded image too small (${byteSize} bytes)`;
          downloadFailure += 1;
        }
      } catch (error) {
        downloadStatus = "failed";
        downloadError = error instanceof Error ? error.message : "download_error";
        downloadFailure += 1;
      }
    }

    rows.push({
      album_id: album.album_id,
      artist: album.artist,
      title: album.title,
      resolver_identity: album.resolver_identity,
      release_year: album.release_year,
      connected_track_count: album.connected_track_count,
      charted_track_count: album.charted_track_count,
      importance_score: album.importance_score,
      tier,
      best_candidate: best,
      candidates: scored.slice(0, 5),
      download_status: downloadStatus,
      staged_file: stagedFile,
      download_error: downloadError,
    });
  }

  const high = rows.filter((row) => row.tier === "high");
  const medium = rows.filter((row) => row.tier === "medium");
  const unresolved = rows.filter((row) => row.tier === "unresolved");

  const summary = {
    generated_at: new Date().toISOString(),
    run_id: runId,
    totals: {
      albums_queried: rows.length,
      high_confidence: high.length,
      medium_confidence: medium.length,
      unresolved: unresolved.length,
      download_success: downloadSuccess,
      download_failure: downloadFailure,
    },
    confidence_distribution: {
      high_pct: Number(((high.length / rows.length) * 100).toFixed(2)),
      medium_pct: Number(((medium.length / rows.length) * 100).toFixed(2)),
      unresolved_pct: Number(((unresolved.length / rows.length) * 100).toFixed(2)),
    },
    outputs: {
      run_root: runRoot,
      staged_high_dir: stageHigh,
      staged_medium_dir: stageMedium,
    },
    rows,
  };

  const jsonPath = path.join(metaDir, "itunes_acquisition_summary.json");
  const mdPath = path.join(metaDir, "itunes_acquisition_summary.md");
  const acquisitionListPath = path.join(metaDir, "canonical_album_acquisition_list.json");

  await writeFile(jsonPath, JSON.stringify(summary, null, 2), "utf8");
  await writeFile(acquisitionListPath, JSON.stringify({ generated_at: new Date().toISOString(), rows: acquisitionList }, null, 2), "utf8");

  const md = [
    `# Retroverse iTunes Canonical Acquisition ${runId}`,
    "",
    `- albums queried: ${summary.totals.albums_queried}`,
    `- high confidence: ${summary.totals.high_confidence}`,
    `- medium confidence: ${summary.totals.medium_confidence}`,
    `- unresolved: ${summary.totals.unresolved}`,
    `- download success: ${summary.totals.download_success}`,
    `- download failure: ${summary.totals.download_failure}`,
    "",
    "## Top high-confidence albums (first 30)",
    ...high.slice(0, 30).map((row) => `- ${row.album_id} | ${row.artist} - ${row.title} | score=${row.best_candidate?.score ?? "n/a"} | staged=${row.staged_file ? "yes" : "no"}`),
    "",
    "## Top unresolved albums (first 30)",
    ...unresolved.slice(0, 30).map((row) => `- ${row.album_id} | ${row.artist} - ${row.title}`),
  ].join("\n");
  await writeFile(mdPath, md, "utf8");

  console.log(`itunes_pass_root=${runRoot}`);
  console.log(`itunes_summary_json=${jsonPath}`);
  console.log(`itunes_summary_md=${mdPath}`);
  console.log(`canonical_acquisition_list_json=${acquisitionListPath}`);
  console.log(`albums_queried=${summary.totals.albums_queried}`);
  console.log(`high_confidence=${summary.totals.high_confidence}`);
  console.log(`medium_confidence=${summary.totals.medium_confidence}`);
  console.log(`unresolved=${summary.totals.unresolved}`);
  console.log(`download_success=${summary.totals.download_success}`);
  console.log(`download_failure=${summary.totals.download_failure}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
