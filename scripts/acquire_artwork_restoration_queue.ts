import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type QueueRow = {
  retroverse_album_id: string;
  artist: string;
  album: string;
  release_year: number | null;
  era_slug: string;
  priority_score: number;
  artwork_status: string;
  likely_itunes_search_query: string;
  discogs_fallback_query: string;
};

type SearchResult = {
  artistName?: string;
  collectionName?: string;
  releaseDate?: string;
  artworkUrl100?: string;
  collectionId?: number;
  collectionType?: string;
};

type DiscogsResult = {
  title?: string;
  year?: number | string;
  thumb?: string;
  cover_image?: string;
  resource_url?: string;
};

type Candidate = {
  source: "itunes" | "discogs";
  artist_name: string;
  collection_name: string;
  release_date: string | null;
  artwork_url: string | null;
  score: number;
  artist_score: number;
  title_score: number;
  year_score: number;
  penalties: string[];
  reasons: string[];
};

type OutputRow = {
  retroverse_album_id: string;
  artist: string;
  album: string;
  release_year: number | null;
  source: string;
  artwork_url: string;
  staged_file_path: string;
  proposed_status: "verified" | "pending" | "missing";
  confidence: number;
  query_used: string;
  notes: string;
};

const OUTPUT_ROOT = "/Users/bobhopp/RETROVERSE_DATA/generated/artwork_restoration";
const INPUT_CSV = path.join(OUTPUT_ROOT, "queue.csv");
const OUTPUT_CSV = path.join(OUTPUT_ROOT, "acquisition_results.csv");
const STAGING_DIR = path.join(OUTPUT_ROOT, "staging");
const CONCURRENCY = Number.parseInt(process.env.ARTWORK_RESTORE_ACQUIRE_CONCURRENCY ?? "2", 10);
const LIMIT = Number.parseInt(process.env.ARTWORK_RESTORE_ACQUIRE_LIMIT ?? "0", 10);
const REQUEST_DELAY_MS = Number.parseInt(process.env.ARTWORK_RESTORE_REQUEST_DELAY_MS ?? "500", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.ARTWORK_RESTORE_REQUEST_TIMEOUT_MS ?? "12000", 10);
const ITUNES_LIMIT = Number.parseInt(process.env.ARTWORK_RESTORE_ITUNES_LIMIT ?? "12", 10);
const DISCOGS_LIMIT = Number.parseInt(process.env.ARTWORK_RESTORE_DISCOGS_LIMIT ?? "4", 10);

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

function tokenize(value: string): Set<string> {
  return new Set(normalize(value).split(" ").filter((token) => token.length > 1));
}

function similarity(left: string, right: string): number {
  const leftTokens = tokenize(left);
  const rightTokens = tokenize(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function csvEscape(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    const next = line[i + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (char === "," && !inQuotes) {
      values.push(current);
      current = "";
      continue;
    }
    current += char;
  }
  values.push(current);
  return values.map((value) => value.trim());
}

function parseInteger(value: string | undefined): number | null {
  if (!value || value.length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
}

function hasAmbiguousContext(title: string, artist: string): boolean {
  return /greatest hits|best of|anthology|soundtrack|original motion picture|various artists/i.test(`${title} ${artist}`);
}

function parseQueueCsv(raw: string): QueueRow[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length <= 1) return [];
  const headers = splitCsvLine(lines[0]);
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return {
      retroverse_album_id: row.retroverse_album_id,
      artist: row.artist,
      album: row.album,
      release_year: parseInteger(row.release_year),
      era_slug: row.era_slug,
      priority_score: Number.parseFloat(row.priority_score) || 0,
      artwork_status: row.artwork_status || "none",
      likely_itunes_search_query: row.likely_itunes_search_query || `${row.artist} ${row.album}`.trim(),
      discogs_fallback_query: row.discogs_fallback_query || `${row.artist} ${row.album} ${row.release_year ?? ""}`.trim(),
    };
  });
}

function scoreItunesCandidate(targetArtist: string, targetAlbum: string, targetYear: number | null, raw: SearchResult): Candidate {
  const artist = raw.artistName?.trim() ?? "";
  const title = raw.collectionName?.trim() ?? "";
  const artistKey = normalize(targetArtist);
  const artistLoose = normalizeLoose(targetArtist);
  const titleKey = normalize(targetAlbum);
  const titleLoose = normalizeLoose(targetAlbum);
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
    artistScore = 0.54;
    reasons.push("artist_exact");
  } else if (candArtistLoose === artistLoose) {
    artistScore = 0.38;
    reasons.push("artist_loose");
  } else if (candArtistKey.includes(artistLoose) || artistLoose.includes(candArtistKey)) {
    artistScore = 0.2;
    reasons.push("artist_contains");
  }

  if (candTitleKey === titleKey) {
    titleScore = 0.42;
    reasons.push("title_exact");
  } else if (candTitleLoose === titleLoose) {
    titleScore = 0.3;
    reasons.push("title_loose");
  } else if (candTitleKey.includes(titleLoose) || titleLoose.includes(candTitleKey)) {
    titleScore = 0.16;
    reasons.push("title_contains");
  }

  if (targetYear !== null && raw.releaseDate) {
    const candidateYear = Number.parseInt(raw.releaseDate.slice(0, 4), 10);
    if (Number.isFinite(candidateYear)) {
      const delta = Math.abs(candidateYear - targetYear);
      if (delta <= 1) {
        yearScore = 0.09;
        reasons.push("year_near");
      } else if (delta <= 3) {
        yearScore = 0.05;
        reasons.push("year_close");
      }
    }
  }

  let penalty = 0;
  const combined = `${candArtistKey} ${candTitleKey}`;
  for (const token of ["karaoke", "tribute", "instrumental", "cover", "re-recorded"]) {
    if (combined.includes(token)) {
      penalty += 0.22;
      penalties.push(`penalty_${token}`);
    }
  }
  if ((raw.collectionType ?? "").toLowerCase() === "single") {
    penalty += 0.08;
    penalties.push("penalty_collection_type_single");
  }

  const score = Math.max(0, Math.min(1, Number((artistScore + titleScore + yearScore - penalty).toFixed(3))));
  const artwork600 = raw.artworkUrl100
    ? raw.artworkUrl100.replace(/100x100bb/gi, "600x600bb").replace(/100x100-75/gi, "600x600-75")
    : null;

  return {
    source: "itunes",
    artist_name: artist,
    collection_name: title,
    release_date: raw.releaseDate ?? null,
    artwork_url: artwork600,
    score,
    artist_score: Number(artistScore.toFixed(3)),
    title_score: Number(titleScore.toFixed(3)),
    year_score: Number(yearScore.toFixed(3)),
    penalties,
    reasons,
  };
}

function scoreDiscogsCandidate(targetArtist: string, targetAlbum: string, targetYear: number | null, row: DiscogsResult): Candidate | null {
  const full = row.title?.trim() ?? "";
  if (!full) return null;
  const split = full.split(" - ");
  const artist = split.length > 1 ? split[0].trim() : targetArtist;
  const title = split.length > 1 ? split.slice(1).join(" - ").trim() : full;
  const artwork = row.cover_image ?? row.thumb ?? null;
  if (!artwork) return null;
  const year = row.year ? Number.parseInt(String(row.year), 10) : null;

  const artistScore = similarity(targetArtist, artist);
  const titleScore = similarity(targetAlbum, title);
  const yearScore =
    targetYear !== null && year !== null
      ? Math.max(0, 1 - Math.min(20, Math.abs(targetYear - year)) / 20)
      : 0.25;
  const score = Number((artistScore * 0.42 + titleScore * 0.44 + yearScore * 0.14).toFixed(3));

  return {
    source: "discogs",
    artist_name: artist,
    collection_name: title,
    release_date: year ? `${year}-01-01` : null,
    artwork_url: artwork,
    score: Math.max(0, Math.min(1, score)),
    artist_score: Number(artistScore.toFixed(3)),
    title_score: Number(titleScore.toFixed(3)),
    year_score: Number(yearScore.toFixed(3)),
    penalties: [],
    reasons: ["discogs_reference"],
  };
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchItunes(query: string): Promise<SearchResult[]> {
  await sleep(REQUEST_DELAY_MS);
  const term = encodeURIComponent(query);
  const url = `https://itunes.apple.com/search?term=${term}&entity=album&media=music&country=US&limit=${ITUNES_LIMIT}`;
  const response = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) return [];
  const payload = (await response.json()) as { results?: SearchResult[] };
  return payload.results ?? [];
}

async function fetchDiscogs(query: string): Promise<DiscogsResult[]> {
  const token = process.env.DISCOGS_TOKEN;
  if (!token) return [];
  await sleep(REQUEST_DELAY_MS);
  const url = new URL("https://api.discogs.com/database/search");
  url.searchParams.set("q", query);
  url.searchParams.set("type", "release");
  url.searchParams.set("per_page", String(DISCOGS_LIMIT));
  url.searchParams.set("token", token);
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { "user-agent": "RetroverseArtworkRestoration/2.0" },
  });
  if (!response.ok) return [];
  const payload = (await response.json()) as { results?: DiscogsResult[] };
  return payload.results ?? [];
}

async function stageImage(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
  });
  if (!response.ok) throw new Error(`download_status_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 8000) throw new Error("image_too_small");
  await writeFile(destinationPath, bytes);
}

function chooseStatus(bestItunes: Candidate | null, bestDiscogs: Candidate | null, queueRow: QueueRow): {
  source: string;
  candidate: Candidate | null;
  proposedStatus: "verified" | "pending" | "missing";
  confidence: number;
  notes: string;
} {
  const ambiguous = hasAmbiguousContext(queueRow.album, queueRow.artist);
  if (bestItunes && bestItunes.artwork_url) {
    const veryStrong =
      bestItunes.score >= 0.93 &&
      bestItunes.artist_score >= 0.38 &&
      bestItunes.title_score >= 0.3 &&
      bestItunes.reasons.includes("year_near") &&
      bestItunes.penalties.length === 0 &&
      !ambiguous;
    if (veryStrong) {
      return {
        source: "itunes",
        candidate: bestItunes,
        proposedStatus: "verified",
        confidence: bestItunes.score,
        notes: `itunes_strong_match reasons=${bestItunes.reasons.join("|") || "none"}`,
      };
    }
    if (bestItunes.score >= 0.75) {
      return {
        source: "itunes",
        candidate: bestItunes,
        proposedStatus: "pending",
        confidence: bestItunes.score,
        notes: `itunes_review_needed ambiguous=${ambiguous ? "yes" : "no"} penalties=${bestItunes.penalties.join("|") || "none"}`,
      };
    }
  }
  if (bestDiscogs && bestDiscogs.artwork_url) {
    return {
      source: "discogs_reference",
      candidate: bestDiscogs,
      proposedStatus: "pending",
      confidence: bestDiscogs.score,
      notes: "discogs_reference_only_not_auto_verified",
    };
  }
  return {
    source: "none",
    candidate: null,
    proposedStatus: "missing",
    confidence: 0,
    notes: "no_safe_candidate",
  };
}

async function runConcurrent<T, U>(items: T[], worker: (item: T) => Promise<U>, concurrency: number): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  const runners = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
    }
  });
  await Promise.all(runners);
  return results;
}

function toCsv(rows: OutputRow[]): string {
  const headers = [
    "retroverse_album_id",
    "artist",
    "album",
    "release_year",
    "source",
    "artwork_url",
    "staged_file_path",
    "proposed_status",
    "confidence",
    "query_used",
    "notes",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(
      [
        row.retroverse_album_id,
        row.artist,
        row.album,
        row.release_year === null ? "" : String(row.release_year),
        row.source,
        row.artwork_url,
        row.staged_file_path,
        row.proposed_status,
        String(row.confidence),
        row.query_used,
        row.notes,
      ]
        .map((value) => csvEscape(value))
        .join(","),
    );
  }
  return `${lines.join("\n")}\n`;
}

async function evaluateQueueRow(row: QueueRow): Promise<OutputRow> {
  const iTunesQuery = row.likely_itunes_search_query || `${row.artist} ${row.album}`.trim();
  const itunesRaw = await fetchItunes(iTunesQuery);
  const itunesCandidates = itunesRaw
    .map((candidate) => scoreItunesCandidate(row.artist, row.album, row.release_year, candidate))
    .filter((candidate) => Boolean(candidate.artwork_url))
    .sort((a, b) => b.score - a.score);
  const bestItunes = itunesCandidates[0] ?? null;

  let bestDiscogs: Candidate | null = null;
  if (!bestItunes || bestItunes.score < 0.75) {
    const discogsRaw = await fetchDiscogs(row.discogs_fallback_query);
    const discogsCandidates = discogsRaw
      .map((candidate) => scoreDiscogsCandidate(row.artist, row.album, row.release_year, candidate))
      .filter((candidate): candidate is Candidate => Boolean(candidate))
      .sort((a, b) => b.score - a.score);
    bestDiscogs = discogsCandidates[0] ?? null;
  }

  const decision = chooseStatus(bestItunes, bestDiscogs, row);
  let stagedFilePath = "";
  if (decision.candidate?.artwork_url) {
    const filename = `${row.retroverse_album_id}__${slugify(row.artist)}__${slugify(row.album)}.jpg`;
    const destination = path.join(STAGING_DIR, filename);
    try {
      await stageImage(decision.candidate.artwork_url, destination);
      stagedFilePath = destination;
    } catch (error) {
      const failure = error instanceof Error ? error.message : String(error);
      return {
        retroverse_album_id: row.retroverse_album_id,
        artist: row.artist,
        album: row.album,
        release_year: row.release_year,
        source: decision.source,
        artwork_url: decision.candidate.artwork_url,
        staged_file_path: "",
        proposed_status: "missing",
        confidence: 0,
        query_used: iTunesQuery,
        notes: `${decision.notes}; staging_failed=${failure}`,
      };
    }
  }

  return {
    retroverse_album_id: row.retroverse_album_id,
    artist: row.artist,
    album: row.album,
    release_year: row.release_year,
    source: decision.source,
    artwork_url: decision.candidate?.artwork_url ?? "",
    staged_file_path: stagedFilePath,
    proposed_status: decision.proposedStatus,
    confidence: Number(decision.confidence.toFixed(3)),
    query_used: decision.source === "itunes" ? iTunesQuery : row.discogs_fallback_query,
    notes: decision.notes,
  };
}

async function main() {
  const raw = await readFile(INPUT_CSV, "utf8");
  const allRows = parseQueueCsv(raw);
  const rows = LIMIT > 0 ? allRows.slice(0, LIMIT) : allRows;
  await mkdir(OUTPUT_ROOT, { recursive: true });
  await mkdir(STAGING_DIR, { recursive: true });

  const results = await runConcurrent(rows, evaluateQueueRow, CONCURRENCY);
  await writeFile(OUTPUT_CSV, toCsv(results), "utf8");

  const processed = results.length;
  const verified = results.filter((row) => row.proposed_status === "verified").length;
  const pending = results.filter((row) => row.proposed_status === "pending").length;
  const missing = results.filter((row) => row.proposed_status === "missing").length;
  const stagedFiles = results.filter((row) => row.staged_file_path.length > 0).length;

  console.log(`acquisition_results_csv=${OUTPUT_CSV}`);
  console.log(`staging_dir=${STAGING_DIR}`);
  console.log(`processed=${processed}`);
  console.log(`verified_candidates=${verified}`);
  console.log(`pending_candidates=${pending}`);
  console.log(`missing=${missing}`);
  console.log(`staged_files=${stagedFiles}`);
}

main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(message);
  process.exitCode = 1;
});
