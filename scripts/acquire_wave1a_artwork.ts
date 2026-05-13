import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

type AcquisitionPrepRow = {
  likely_itunes_search_query: string;
  normalized_artist: string;
  normalized_album: string;
  normalized_album_query: string;
  release_year: number | null;
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
  uri?: string;
  resource_url?: string;
};

type Candidate = {
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

type TrustState = "canonical_verified" | "provisional" | "unresolved";

type OutputRow = {
  normalized_artist: string;
  normalized_album: string;
  release_year: number | null;
  artwork_url: string;
  acquisition_source: string;
  trust_state: TrustState;
  acquisition_confidence: number;
  query_used: string;
  notes: string;
};

const INPUT_CSV =
  process.env.WAVE1A_ACQUISITION_PREP_CSV ??
  "/Users/bobhopp/RETROVERSE_DATA/generated/discover_wave1a/acquisition_prep.csv";
const OUTPUT_CSV =
  process.env.WAVE1A_ACQUISITION_RESULTS_CSV ??
  "/Users/bobhopp/RETROVERSE_DATA/generated/discover_wave1a/artwork_acquisition_results.csv";
const ITUNES_LIMIT = Number.parseInt(process.env.WAVE1A_ITUNES_LIMIT ?? "18", 10);
const CONCURRENCY = Number.parseInt(process.env.WAVE1A_ACQUISITION_CONCURRENCY ?? "1", 10);
const REQUEST_DELAY_MS = Number.parseInt(process.env.WAVE1A_REQUEST_DELAY_MS ?? "1200", 10);
const REQUEST_JITTER_MS = Number.parseInt(process.env.WAVE1A_REQUEST_JITTER_MS ?? "800", 10);
const REQUEST_TIMEOUT_MS = Number.parseInt(process.env.WAVE1A_REQUEST_TIMEOUT_MS ?? "15000", 10);
const DISCOVER_ACQUISITION_LIMIT = Number.parseInt(process.env.DISCOVER_ACQUISITION_LIMIT ?? "0", 10);
const TRANSPORT_DEBUG = (process.env.WAVE1A_TRANSPORT_DEBUG ?? "true").toLowerCase() !== "false";
const STAGING_DIR =
  process.env.WAVE1A_STAGING_DIR ?? "/Users/bobhopp/RETROVERSE_DATA/generated/discover_wave1a/artwork_staging";
const DISCOGS_LIMIT = Number.parseInt(process.env.WAVE1A_DISCOGS_LIMIT ?? "4", 10);
const DISCOGS_429_MIN_BACKOFF_MS = Number.parseInt(process.env.WAVE1A_DISCOGS_429_MIN_BACKOFF_MS ?? "8000", 10);
const DISCOGS_429_MAX_BACKOFF_MS = Number.parseInt(process.env.WAVE1A_DISCOGS_429_MAX_BACKOFF_MS ?? "15000", 10);

const BROWSER_HEADERS: Record<string, string> = {
  "user-agent":
    process.env.WAVE1A_USER_AGENT ??
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_5) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36",
  accept: "application/json, text/plain, */*",
  "accept-language": "en-US,en;q=0.9",
  referer: "https://music.apple.com/",
  origin: "https://music.apple.com",
  dnt: "1",
};

const discogsSearchCache = new Map<string, Candidate[]>();

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
  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"') {
      if (inQuotes && next === '"') {
        current += '"';
        index += 1;
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
  if (!value || value.trim().length === 0) return null;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function tokenSimilarity(left: string, right: string): number {
  const leftTokens = new Set(normalize(left).split(" ").filter((token) => token.length > 1));
  const rightTokens = new Set(normalize(right).split(" ").filter((token) => token.length > 1));
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  let overlap = 0;
  for (const token of leftTokens) if (rightTokens.has(token)) overlap += 1;
  return overlap / Math.max(leftTokens.size, rightTokens.size);
}

function hasGreatestHitsSignal(value: string): boolean {
  return /greatest hits|best of|anthology|essentials|collection/i.test(value);
}

function hasSoundtrackSignal(value: string): boolean {
  return /soundtrack|original motion picture|ost/i.test(value);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function jitterMs(max: number): number {
  if (max <= 0) return 0;
  return Math.floor(Math.random() * max);
}

function randomBetween(min: number, max: number): number {
  if (max <= min) return min;
  return min + Math.floor(Math.random() * (max - min + 1));
}

function transportLog(message: string): void {
  if (!TRANSPORT_DEBUG) return;
  console.log(`[transport] ${message}`);
}

function stripArtistPrefixFromAlbum(normalizedArtist: string, normalizedAlbum: string): string {
  const artist = normalize(normalizedArtist);
  const album = normalize(normalizedAlbum);
  if (!artist || !album) return album || normalizedAlbum;
  const directPrefix = `${artist} `;
  if (album.startsWith(directPrefix)) {
    const stripped = album.slice(directPrefix.length).trim();
    return stripped.length > 0 ? stripped : album;
  }
  return album;
}

function parseCsvRows(raw: string): Record<string, string>[] {
  const lines = raw
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (lines.length === 0) return [];
  const headers = splitCsvLine(lines[0]).map((header) => header.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((header, index) => {
      row[header] = values[index] ?? "";
    });
    return row;
  });
}

function buildPrepRows(rawRows: Record<string, string>[]): AcquisitionPrepRow[] {
  return rawRows.map((row) => {
    const normalizedArtist = (row.normalized_artist ?? "").trim();
    const normalizedAlbum = (row.normalized_album ?? "").trim();
    return {
      likely_itunes_search_query: (row.likely_itunes_search_query ?? "").trim(),
      normalized_artist: normalizedArtist,
      normalized_album: normalizedAlbum,
      normalized_album_query: stripArtistPrefixFromAlbum(normalizedArtist, normalizedAlbum),
      release_year: parseInteger(row.release_year),
    };
  });
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
    artistScore = 0.54;
    reasons.push("artist_exact");
  } else if (candArtistLoose === artistLoose) {
    artistScore = 0.4;
    reasons.push("artist_loose");
  } else if (candArtistKey.includes(artistLoose) || artistLoose.includes(candArtistKey)) {
    artistScore = 0.2;
    reasons.push("artist_contains");
  }

  if (candTitleKey === titleKey) {
    titleScore = 0.44;
    reasons.push("title_exact");
  } else if (candTitleLoose === titleLoose) {
    titleScore = 0.32;
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
        yearScore = 0.09;
        reasons.push("year_near");
      } else if (delta <= 3) {
        yearScore = 0.05;
        reasons.push("year_close");
      }
    }
  }

  let penalty = 0;
  const badTokens = ["karaoke", "tribute", "instrumental", "cover", "remix", "re-recorded"];
  const combined = `${candArtistKey} ${candTitleKey}`;
  for (const token of badTokens) {
    if (combined.includes(token)) {
      penalty += 0.2;
      penalties.push(`penalty_${token.replace(/\s+/g, "_")}`);
    }
  }
  if ((raw.collectionType ?? "").toLowerCase() === "single") {
    penalty += 0.12;
    penalties.push("penalty_collection_type_single");
  }

  const score = Math.max(0, Math.min(1, Number((artistScore + titleScore + yearScore - penalty).toFixed(3))));
  const artworkUrl = raw.artworkUrl100
    ? raw.artworkUrl100.replace(/100x100bb/gi, "600x600bb").replace(/100x100-75/gi, "600x600-75")
    : null;

  return {
    artist_name: artist,
    collection_name: title,
    release_date: raw.releaseDate ?? null,
    artwork_url: artworkUrl,
    score,
    artist_score: Number(artistScore.toFixed(3)),
    title_score: Number(titleScore.toFixed(3)),
    year_score: Number(yearScore.toFixed(3)),
    penalties,
    reasons,
  };
}

function chooseTrustState(best: Candidate | null): TrustState {
  if (!best || !best.artwork_url) return "unresolved";
  const exactArtist = best.reasons.includes("artist_exact");
  const exactTitle = best.reasons.includes("title_exact");
  const yearNear = best.reasons.includes("year_near");
  const hasPenalty = best.penalties.length > 0;

  if (exactArtist && exactTitle && yearNear && best.score >= 0.95 && !hasPenalty) return "canonical_verified";
  if (best.score >= 0.83 && best.artist_score >= 0.2 && best.title_score >= 0.2 && !hasPenalty) return "provisional";
  return "unresolved";
}

async function searchItunes(query: string): Promise<SearchResult[]> {
  const maxAttempts = 4;
  const baseDelayMs = 450;
  const term = encodeURIComponent(query);
  const url = `https://itunes.apple.com/search?term=${term}&entity=album&media=music&country=US&limit=${ITUNES_LIMIT}`;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    await sleep(REQUEST_DELAY_MS + jitterMs(REQUEST_JITTER_MS));
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: BROWSER_HEADERS,
        redirect: "follow",
      });
      transportLog(
        `url="${url}" query="${query}" attempt=${attempt}/${maxAttempts} status=${response.status} redirected=${response.redirected}`,
      );
    } catch (error) {
      transportLog(
        `query="${query}" attempt=${attempt}/${maxAttempts} network_error=${error instanceof Error ? error.message : String(error)}`,
      );
      if (attempt === maxAttempts) return [];
      const waitMs = baseDelayMs * attempt * 2;
      await sleep(waitMs + jitterMs(REQUEST_JITTER_MS));
      continue;
    }
    if (response.ok) {
      const payload = (await response.json()) as { results?: SearchResult[] };
      return payload.results ?? [];
    }
    if (response.status === 403 || response.status === 429) {
      if (attempt === maxAttempts) {
        transportLog(`url="${url}" final_failure=status_${response.status} after_attempts=${attempt}`);
        return [];
      }
      const waitMs = baseDelayMs * attempt * 2;
      transportLog(`query="${query}" attempt=${attempt}/${maxAttempts} retrying_after_ms=${waitMs} reason=status_${response.status}`);
      await sleep(waitMs + jitterMs(REQUEST_JITTER_MS));
      continue;
    }
    if (response.status >= 500) {
      if (attempt === maxAttempts) {
        transportLog(`url="${url}" final_failure=status_${response.status} after_attempts=${attempt}`);
        return [];
      }
      const waitMs = baseDelayMs * attempt * 2;
      transportLog(`query="${query}" attempt=${attempt}/${maxAttempts} retrying_after_ms=${waitMs} reason=status_${response.status}`);
      await sleep(waitMs + jitterMs(REQUEST_JITTER_MS));
      continue;
    }
    throw new Error(`iTunes search failed (${response.status}) for query: ${query}`);
  }
  transportLog(`query="${query}" exhausted_retries`);
  return [];
}

function scoreDiscogsCandidate(
  targetArtist: string,
  targetTitle: string,
  targetYear: number | null,
  candidateArtist: string,
  candidateTitle: string,
  candidateYear: number | null,
): { score: number; reasons: string[]; penalties: string[] } {
  const reasons: string[] = [];
  const penalties: string[] = [];

  const artistScore = tokenSimilarity(targetArtist, candidateArtist);
  const titleScore = tokenSimilarity(targetTitle, candidateTitle);
  const yearDistance = targetYear && candidateYear ? Math.abs(candidateYear - targetYear) : 12;
  const yearScore = targetYear && candidateYear ? Math.max(0, 1 - Math.min(30, yearDistance) / 30) : 0.25;

  if (artistScore >= 0.95) reasons.push("artist_exact-ish");
  else if (artistScore >= 0.75) reasons.push("artist_close");
  if (titleScore >= 0.95) reasons.push("title_exact-ish");
  else if (titleScore >= 0.75) reasons.push("title_close");
  if (yearDistance <= 1) reasons.push("year_near");
  else if (yearDistance <= 3) reasons.push("year_close");

  let penalty = 0;
  if (hasGreatestHitsSignal(targetTitle) !== hasGreatestHitsSignal(candidateTitle)) {
    penalty += 0.1;
    penalties.push("penalty_greatest_hits_mismatch");
  }
  if (hasSoundtrackSignal(targetTitle) !== hasSoundtrackSignal(candidateTitle)) {
    penalty += 0.1;
    penalties.push("penalty_soundtrack_mismatch");
  }

  const score = Number((titleScore * 0.46 + artistScore * 0.34 + yearScore * 0.2 - penalty).toFixed(3));
  return { score: Math.max(0, Math.min(1, score)), reasons, penalties };
}

async function searchDiscogs(targetArtist: string, targetTitle: string, targetYear: number | null): Promise<Candidate[]> {
  const discogsCacheKey = `${normalize(targetArtist)}::${normalize(targetTitle)}::${targetYear ?? "unknown"}`;
  const cached = discogsSearchCache.get(discogsCacheKey);
  if (cached) {
    transportLog(`discogs cache_hit key="${discogsCacheKey}" candidates=${cached.length}`);
    return cached;
  }

  const url = new URL("https://api.discogs.com/database/search");
  url.searchParams.set("type", "release");
  url.searchParams.set("artist", targetArtist);
  url.searchParams.set("release_title", targetTitle);
  url.searchParams.set("per_page", String(DISCOGS_LIMIT));

  const token = process.env.DISCOGS_TOKEN;
  if (token) url.searchParams.set("token", token);

  let response: Response;
  try {
    await sleep(REQUEST_DELAY_MS + jitterMs(REQUEST_JITTER_MS));
    response = await fetch(url, {
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      headers: {
        ...BROWSER_HEADERS,
        "user-agent": "RetroverseWave1AArtwork/1.0 +https://retroverse.local",
        accept: "application/json",
      },
      redirect: "follow",
    });
  } catch (error) {
    transportLog(`discogs query="${targetArtist} ${targetTitle}" network_error=${error instanceof Error ? error.message : String(error)}`);
    return [];
  }
  transportLog(`discogs url="${url.toString()}" status=${response.status}`);
  if (response.status === 429) {
    const cooldown = randomBetween(DISCOGS_429_MIN_BACKOFF_MS, DISCOGS_429_MAX_BACKOFF_MS);
    transportLog(`discogs status=429 cooldown_ms=${cooldown} query="${targetArtist} ${targetTitle}"`);
    await sleep(cooldown);
    discogsSearchCache.set(discogsCacheKey, []);
    return [];
  }
  if (!response.ok) {
    discogsSearchCache.set(discogsCacheKey, []);
    return [];
  }

  const payload = (await response.json()) as { results?: DiscogsResult[] };
  const results = payload.results ?? [];
  async function resolveDiscogsImage(resourceUrl: string | undefined): Promise<string | null> {
    if (!resourceUrl) return null;
    const detailUrl = new URL(resourceUrl);
    if (token) detailUrl.searchParams.set("token", token);
    let response: Response;
    try {
      response = await fetch(detailUrl, {
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        headers: {
          ...BROWSER_HEADERS,
          "user-agent": "RetroverseWave1AArtwork/1.0 +https://retroverse.local",
          accept: "application/json",
        },
        redirect: "follow",
      });
    } catch {
      return null;
    }
    if (!response.ok) return null;
    const payload = (await response.json()) as {
      images?: Array<{ uri?: string; uri150?: string }>;
    };
    const first = payload.images?.[0];
    return first?.uri ?? first?.uri150 ?? null;
  }

  const mapped: Candidate[] = [];
  for (const row of results) {
    const fullTitle = row.title?.trim() ?? "";
    const split = fullTitle.split(" - ");
    const artist = split.length > 1 ? split[0].trim() : targetArtist;
    const title = split.length > 1 ? split.slice(1).join(" - ").trim() : fullTitle || targetTitle;
    const image =
      row.cover_image && row.cover_image.trim().length > 0
        ? row.cover_image
        : row.thumb && row.thumb.trim().length > 0
          ? row.thumb
          : await resolveDiscogsImage(row.resource_url);
    const urlRef = row.uri ? `https://www.discogs.com${row.uri}` : row.resource_url ?? null;
    const candidateYear = row.year ? Number.parseInt(String(row.year), 10) : null;
    const scored = scoreDiscogsCandidate(targetArtist, targetTitle, targetYear, artist, title, candidateYear);

    mapped.push({
      artist_name: artist,
      collection_name: title,
      release_date: candidateYear ? `${candidateYear}-01-01` : null,
      artwork_url: image,
      score: scored.score,
      artist_score: Number(tokenSimilarity(targetArtist, artist).toFixed(3)),
      title_score: Number(tokenSimilarity(targetTitle, title).toFixed(3)),
      year_score: Number(
        (targetYear && candidateYear ? Math.max(0, 1 - Math.min(30, Math.abs(candidateYear - targetYear)) / 30) : 0.25).toFixed(3),
      ),
      penalties: [...scored.penalties, ...(urlRef ? [] : ["penalty_missing_url_ref"])],
      reasons: [...scored.reasons, "discogs_fallback"],
    });
  }
  const ranked = mapped
    .filter((row) => Boolean(row.artwork_url))
    .sort((a, b) => b.score - a.score)
    .slice(0, DISCOGS_LIMIT);
  discogsSearchCache.set(discogsCacheKey, ranked);
  return ranked;
}

function buildQueryVariants(row: AcquisitionPrepRow): string[] {
  const artist = row.normalized_artist.replace(/\s+/g, " ").trim();
  const album = row.normalized_album_query.replace(/\s+/g, " ").trim();
  const primary = row.likely_itunes_search_query.replace(/\s+/g, " ").trim();
  const year = row.release_year ? String(row.release_year) : "";
  const variants = [
    `${artist} ${album}`.trim(),
    primary,
    year ? `${artist} ${album} ${year}`.trim() : "",
    `${album} ${artist}`.trim(),
  ].filter((value) => value.length > 0);
  return [...new Set(variants)];
}

async function evaluateRow(row: AcquisitionPrepRow): Promise<OutputRow> {
  const queries = buildQueryVariants(row);
  const targetArtist = row.normalized_artist;
  const targetAlbum = row.normalized_album_query;

  const candidateMap = new Map<string, { candidate: Candidate; query: string }>();
  const queryErrors: string[] = [];
  for (const query of queries.slice(0, 1)) {
    let results: SearchResult[] = [];
    try {
      results = await searchItunes(query);
    } catch (error) {
      queryErrors.push(`${query}:${error instanceof Error ? error.message : String(error)}`);
      continue;
    }
    for (const raw of results) {
      const candidate = scoreCandidate(targetArtist, targetAlbum, row.release_year, raw);
      const key = `${raw.collectionId ?? ""}::${candidate.artist_name}::${candidate.collection_name}`;
      const existing = candidateMap.get(key);
      if (!existing || candidate.score > existing.candidate.score) {
        candidateMap.set(key, { candidate, query });
      }
    }
  }

  const sorted = [...candidateMap.values()].sort((a, b) => b.candidate.score - a.candidate.score);
  let best = sorted[0]?.candidate ?? null;
  let queryUsed = sorted[0]?.query ?? queries[0] ?? `${targetArtist} ${targetAlbum}`.trim();
  let trustState = chooseTrustState(best);
  let acquisitionSource = trustState === "unresolved" ? "itunes_primary+discogs_fallback_prep" : "itunes_primary";
  let confidence = best?.score ?? 0;
  let ambiguityNotes = "none";

  if (trustState === "unresolved") {
    const discogsCandidates = await searchDiscogs(targetArtist, targetAlbum, row.release_year);
    const bestDiscogs = discogsCandidates[0] ?? null;
    const secondDiscogs = discogsCandidates[1] ?? null;
    const margin = bestDiscogs ? Number((bestDiscogs.score - (secondDiscogs?.score ?? 0)).toFixed(3)) : 0;
    const discogsSafeProvisional = Boolean(
      bestDiscogs &&
        bestDiscogs.score >= 0.9 &&
        bestDiscogs.artist_score >= 0.88 &&
        bestDiscogs.title_score >= 0.88 &&
        margin >= 0.08 &&
        bestDiscogs.penalties.length === 0,
    );

    if (bestDiscogs) {
      best = bestDiscogs;
      queryUsed = `${targetArtist} ${targetAlbum}`.trim();
      confidence = bestDiscogs.score;
      acquisitionSource = "discogs_fallback";
      ambiguityNotes = `discogs_candidates=${discogsCandidates.length}; margin=${margin}`;
      if (discogsSafeProvisional) {
        trustState = "provisional";
      } else {
        trustState = "unresolved";
      }
    }
  }

  const fallbackDiscogsQuery = `${targetArtist} ${targetAlbum} ${row.release_year ?? ""}`.replace(/\s+/g, " ").trim();

  const notesParts = [
    best ? `selected_best_artist=${best.artist_name}` : "selected_best_artist=none",
    best ? `selected_best_album=${best.collection_name}` : "selected_best_album=none",
    best ? `reasons=${best.reasons.join("|") || "none"}` : "reasons=none",
    best ? `penalties=${best.penalties.join("|") || "none"}` : "penalties=none",
    `ambiguity=${ambiguityNotes}`,
  ];
  if (queryErrors.length > 0) notesParts.push(`query_errors=${queryErrors.join("|")}`);
  if (trustState === "unresolved") notesParts.push(`discogs_fallback_query=${fallbackDiscogsQuery}`);

  return {
    normalized_artist: targetArtist,
    normalized_album: targetAlbum,
    release_year: row.release_year,
    artwork_url: best?.artwork_url ?? "",
    acquisition_source: acquisitionSource,
    trust_state: trustState,
    acquisition_confidence: Number(confidence.toFixed(3)),
    query_used: queryUsed,
    notes: notesParts.join("; "),
  };
}

async function runConcurrent<T, U>(items: T[], worker: (item: T) => Promise<U>, concurrency: number): Promise<U[]> {
  const results: U[] = new Array(items.length);
  let cursor = 0;
  let completed = 0;
  const total = items.length;
  const workers = Array.from({ length: Math.max(1, concurrency) }).map(async () => {
    while (true) {
      const index = cursor;
      cursor += 1;
      if (index >= items.length) return;
      results[index] = await worker(items[index]);
      completed += 1;
      if (completed % 50 === 0 || completed === total) {
        console.log(`progress: ${completed}/${total}`);
      }
    }
  });
  await Promise.all(workers);
  return results;
}

async function downloadStagedArtwork(url: string, destinationPath: string): Promise<void> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    headers: { ...BROWSER_HEADERS, accept: "image/avif,image/webp,image/apng,image/*,*/*;q=0.8" },
    redirect: "follow",
  });
  if (!response.ok) throw new Error(`download_status_${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(destinationPath, bytes);
}

async function stageArtworkFiles(rows: OutputRow[]): Promise<{ stagedCount: number; stagedFailures: number }> {
  await mkdir(STAGING_DIR, { recursive: true });
  let stagedCount = 0;
  let stagedFailures = 0;
  for (const row of rows) {
    if (!row.artwork_url) continue;
    const name = `${row.normalized_artist.replace(/\s+/g, "-")}__${row.normalized_album.replace(/\s+/g, "-")}__${
      row.release_year ?? "unknown"
    }.jpg`;
    const destinationPath = path.join(STAGING_DIR, name);
    try {
      await downloadStagedArtwork(row.artwork_url, destinationPath);
      row.notes = `${row.notes}; staged_file=${destinationPath}`;
      stagedCount += 1;
      transportLog(`staged_artwork ok file="${destinationPath}"`);
    } catch (error) {
      row.notes = `${row.notes}; staging_error=${error instanceof Error ? error.message : String(error)}`;
      stagedFailures += 1;
      transportLog(`staged_artwork fail file="${destinationPath}" error="${error instanceof Error ? error.message : String(error)}"`);
    }
  }
  return { stagedCount, stagedFailures };
}

function toCsv(rows: OutputRow[]): string {
  const headers = [
    "normalized_artist",
    "normalized_album",
    "release_year",
    "artwork_url",
    "acquisition_source",
    "trust_state",
    "acquisition_confidence",
    "query_used",
    "notes",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const values = [
      row.normalized_artist,
      row.normalized_album,
      row.release_year ? String(row.release_year) : "",
      row.artwork_url,
      row.acquisition_source,
      row.trust_state,
      String(row.acquisition_confidence),
      row.query_used,
      row.notes,
    ];
    lines.push(values.map((value) => csvEscape(value)).join(","));
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const inputRaw = await readFile(INPUT_CSV, "utf8");
  const prepRows = buildPrepRows(parseCsvRows(inputRaw));
  const filteredRows = prepRows.filter((row) => row.normalized_artist.length > 0 && row.normalized_album.length > 0);
  const scopedRows =
    DISCOVER_ACQUISITION_LIMIT > 0 ? filteredRows.slice(0, Math.min(DISCOVER_ACQUISITION_LIMIT, filteredRows.length)) : filteredRows;
  if (DISCOVER_ACQUISITION_LIMIT > 0) {
    console.log(`validation_mode_limit: ${DISCOVER_ACQUISITION_LIMIT}`);
  }

  const outputRows = await runConcurrent(scopedRows, evaluateRow, CONCURRENCY);
  const staging = await stageArtworkFiles(outputRows);

  await mkdir(path.dirname(OUTPUT_CSV), { recursive: true });
  await writeFile(OUTPUT_CSV, toCsv(outputRows), "utf8");

  const total = outputRows.length;
  const successful = outputRows.filter((row) => row.artwork_url.length > 0).length;
  const provisional = outputRows.filter((row) => row.trust_state === "provisional").length;
  const canonicalVerified = outputRows.filter((row) => row.trust_state === "canonical_verified").length;
  const unresolved = outputRows.filter((row) => row.trust_state === "unresolved").length;
  const lowConfidence = outputRows.filter((row) => row.acquisition_confidence < 0.83).length;
  const exactMatch = outputRows.filter((row) => row.notes.includes("artist_exact") && row.notes.includes("title_exact")).length;
  const repairNeededPct = total > 0 ? Number(((unresolved / total) * 100).toFixed(2)) : 0;

  console.log("\nWave 1A Artwork Acquisition Complete");
  console.log(`input_csv: ${INPUT_CSV}`);
  console.log(`output_csv: ${OUTPUT_CSV}`);
  console.log(`total_processed: ${total}`);
  console.log(`successful_acquisitions: ${successful}`);
  console.log(`canonical_verified_count: ${canonicalVerified}`);
  console.log(`provisional_count: ${provisional}`);
  console.log(`unresolved_count: ${unresolved}`);
  console.log(`low_confidence_count: ${lowConfidence}`);
  console.log(`exact_match_count: ${exactMatch}`);
  console.log(`staged_artwork_files: ${staging.stagedCount}`);
  console.log(`staging_failures: ${staging.stagedFailures}`);
  console.log(`estimated_repair_needed_pct: ${repairNeededPct}`);
}

main().catch((error) => {
  console.error("wave1a_artwork_acquisition_failed:", error);
  process.exitCode = 1;
});
