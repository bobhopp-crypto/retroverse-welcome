/**
 * Portal Curator artwork — **Discogs only**.
 *
 * Discover → preview → approve: Discogs master + release search,
 * traversal order preserved, duplicate covers collapsed by normalized image URL only.
 */

import { randomUUID } from "node:crypto";

import { normalizeCandidateArtworkUrl } from "@/lib/artwork-candidate-fingerprint";
import { curatorDiscogsIngestLedgerReset, curatorDiscogsLog, type CuratorDiscogsTelemetry } from "@/lib/curator-discogs-instrument";
import { sanitizeAlbumTitleForDiscogsLookup } from "@/lib/curator-discogs-query";

export type CuratorApiCandidate = {
  source: "discogs";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url?: string | null;
};

export type CuratorDedupElimination = {
  reason: "empty_image" | "duplicate_url";
  source: CuratorApiCandidate["source"];
  title: string;
  artist: string;
  ordinal: number;
  urlPreview: string;
};

export type CuratorIngestCompact = {
  discogsTokenPresent: boolean;
  composedQuery: string;
  masterSearch: { ok: boolean; httpStatus: number | null; resultCount: number; urlRedacted: string };
  releaseSearch: { ok: boolean; httpStatus: number | null; resultCount: number; urlRedacted: string };
  masterIdsSelected: number[];
  masterDetailFetches: number;
  releasesWithExtractedImage: number;
  rowsBeforeDedupe: number;
  finalCandidateCount: number;
  dedupEliminationCount: number;
  /** Both master and release searches failed transport (timeouts / HTTP errors before JSON). */
  discogsSearchesUnreachable: boolean;
  warnings: string[];
};

export type CuratorIngestFull = CuratorIngestCompact & {
  masterIdsRawFromApi: Array<number | string>;
  candidateTrace: Array<{ title: string; artist: string; year: number | null; imageSample: string }>;
  dedupEliminations: CuratorDedupElimination[];
  debugLog: string[];
};

export type CuratorFetchResult = {
  candidates: CuratorApiCandidate[];
  ingest: CuratorIngestCompact;
  ingestFull?: CuratorIngestFull;
};

const DISCOGS_UA =
  "RetroverseCurator/3.0 +https://retroverse.local - manual Discogs-assisted artwork; respects-discogs-guidelines";

const DISCOGS_TIMEOUT_MS = Math.max(9000, Number.parseInt(process.env.DISCOGS_FETCH_TIMEOUT_MS ?? "20000", 10));

function abortDeadline(timeoutMs: number): AbortSignal {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  const c = new AbortController();
  globalThis.setTimeout(() => {
    try {
      c.abort();
    } catch {
      /* no-op */
    }
  }, timeoutMs);
  return c.signal;
}
/**
 * Stabilization-pass caps — we only display ~3 final tiles, so the ingest path is
 * tuned to fetch just enough detail to surface 3 strong matches quickly.
 */
const MASTER_DETAIL_CAP = 5;
const RELEASE_SEARCH_PAGE = 20;
const MAX_CANDIDATES = 24;
const MAX_RELEASE_DETAIL_FETCHES = 10;
const MAX_FINAL_CANDIDATES = 3;

/** Lowercase, alphanumeric tokens — used by the strong-match scorer below. */
function tokenize(raw: string): string[] {
  return raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 0 && t !== "the" && t !== "and");
}

function joinTokens(tokens: string[]): string {
  return tokens.join(" ");
}

/** Fraction of expected tokens present in candidate tokens, scaled to `maxPoints`. */
function tokenOverlapScore(candidate: string[], expected: string[], maxPoints: number): number {
  if (expected.length === 0) return 0;
  const set = new Set(candidate);
  let hit = 0;
  for (const tok of expected) if (set.has(tok)) hit += 1;
  return Math.round((hit / expected.length) * maxPoints);
}

/** Throttle bursts to Discogs (429). Set DISCOGS_INTER_REQUEST_GAP_MS=0 to disable. */
const INTER_DISCOGS_GAP_MS = Math.max(0, Number.parseInt(process.env.DISCOGS_INTER_REQUEST_GAP_MS ?? "85", 10));

const CURATOR_INGEST_CACHE_MS = Math.max(
  0,
  Number.parseInt(process.env.CURATOR_INGEST_SERVER_CACHE_MS ?? `${10 * 60 * 1000}`, 10),
);

const ingestResultCache = new Map<string, { at: number; result: CuratorFetchResult }>();
const ingestInflightByKey = new Map<string, Promise<CuratorFetchResult>>();

let lastDiscogsOutboundAt = 0;

async function paceDiscogsOutbound(): Promise<void> {
  if (INTER_DISCOGS_GAP_MS <= 0) return;
  const now = Date.now();
  const wait = INTER_DISCOGS_GAP_MS - (now - lastDiscogsOutboundAt);
  if (wait > 0) {
    await new Promise<void>((resolve) => {
      globalThis.setTimeout(resolve, wait);
    });
  }
}

function bumpDiscogsOutboundClock(): void {
  lastDiscogsOutboundAt = Date.now();
}

function curatorIngestCacheKey(opts: {
  artist: string;
  title: string;
  albumYear?: number | null;
  albumId?: string | null;
  debug: boolean;
}): string {
  const id = (opts.albumId ?? "").trim().toUpperCase();
  const yr = opts.albumYear != null && Number.isFinite(Number(opts.albumYear)) ? String(Math.round(Number(opts.albumYear))) : "";
  return `${id}\x1f${collapseWhitespace(opts.artist)}\x1f${collapseWhitespace(opts.title)}\x1f${yr}\x1fdbg=${opts.debug ? "1" : "0"}`;
}

function collapseWhitespace(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function envDebugCurator(): boolean {
  return process.env.CURATOR_ARTWORK_DEBUG === "1" || process.env.CURATOR_ARTWORK_DEBUG === "true";
}

function curatorLog(debug: boolean, debugLog: string[], line: string, alwaysConsoleWarn = false): void {
  debugLog.push(line);
  if (alwaysConsoleWarn) {
    console.warn(line);
    return;
  }
  if (debug || envDebugCurator()) {
    console.log(line);
  }
}

function discogsTokenPresent(): boolean {
  return Boolean((process.env.DISCOGS_TOKEN ?? process.env.DISCOGS_PERSONAL_TOKEN ?? "").trim());
}

function redactDiscogsUrl(u: URL): string {
  const c = new URL(u.toString());
  c.searchParams.delete("token");
  return c.toString();
}

function parseYearFlexible(raw: string | number | null | undefined): number | null {
  if (raw == null || raw === "") return null;
  if (typeof raw === "number") {
    return Number.isFinite(raw) && raw >= 1900 && raw <= 2099 ? raw : null;
  }
  const digits = raw.match(/^(\d{4})/) ?? raw.match(/(\d{4})/);
  if (!digits?.[1]) return null;
  const y = Number.parseInt(digits[1], 10);
  return Number.isFinite(y) && y >= 1900 && y <= 2099 ? y : null;
}

type DiscogsSearchHit = {
  id?: number;
  type?: string;
  title?: string;
  thumb?: string;
  cover_image?: string;
  year?: string;
  uri?: string;
  resource_url?: string;
  master_id?: number;
};

type DiscogsMasterDetail = {
  id: number;
  title?: string;
  year?: number;
  main_release?: number;
  uri?: string;
  images?: Array<{ type?: string; uri?: string; uri150?: string; width?: number; height?: number }>;
};

/** Token is sent ONLY via URL query (?token=...) to mirror verified probe + avoid conflicting auth schemes. */
function discogsHeaders(): HeadersInit {
  return {
    accept: "application/json",
    "user-agent": DISCOGS_UA,
  };
}

function discogsTokenQuery(u: URL): void {
  const token = (process.env.DISCOGS_TOKEN ?? process.env.DISCOGS_PERSONAL_TOKEN ?? "").trim();
  if (token) u.searchParams.set("token", token);
}

/**
 * One-line server log per cold outbound Discogs call.
 *
 * Lets us confirm in the terminal that:
 *   - the request was authenticated  (auth=true)
 *   - which rate-limit tier the API thinks we are on (limit)
 *   - how much budget is left in the current minute (remaining)
 *
 * Discogs documents `X-Discogs-Ratelimit`, `X-Discogs-Ratelimit-Used`, and
 * `X-Discogs-Ratelimit-Remaining`. Anonymous tier is 25/min, authenticated is 60/min.
 */
function logDiscogsRateHeaders(caller: string, requestUrl: URL, res: Response): void {
  const limit = res.headers.get("x-discogs-ratelimit");
  const used = res.headers.get("x-discogs-ratelimit-used");
  const remaining = res.headers.get("x-discogs-ratelimit-remaining");
  const authed = requestUrl.searchParams.has("token");
  console.log("[curator/discogs] rate", {
    caller,
    http: res.status,
    auth: authed,
    limit,
    used,
    remaining,
  });
}

async function discogsDatabaseSearchDetailed(opts: {
  telemetry: CuratorDiscogsTelemetry;
  query: string;
  type?: "release" | "master";
  perPage?: number;
}): Promise<{
  hits: DiscogsSearchHit[];
  status: number | null;
  ok: boolean;
  urlRedacted: string;
  errorSnippet: string | null;
}> {
  const callerBase =
    opts.type === "master" ? "discogs_database_search_master" : "discogs_database_search_release";
  const st = opts.type === "master" ? "master" : "release";
  const u = new URL("https://api.discogs.com/database/search");
  u.searchParams.set("q", opts.query);
  u.searchParams.set("type", opts.type ?? "release");
  u.searchParams.set("per_page", String(opts.perPage ?? RELEASE_SEARCH_PAGE));
  discogsTokenQuery(u);
  const fetchUrl = u.toString();
  const urlRedacted = redactDiscogsUrl(u);

  await paceDiscogsOutbound();
  curatorDiscogsLog({
    telemetry: opts.telemetry,
    caller: callerBase,
    urlRedacted,
    phase: "before",
    query: opts.query,
    searchType: st,
  });

  try {
    const res = await fetch(fetchUrl, {
      signal: abortDeadline(DISCOGS_TIMEOUT_MS),
      headers: discogsHeaders(),
      redirect: "follow",
    });
    bumpDiscogsOutboundClock();
    logDiscogsRateHeaders(callerBase, u, res);

    curatorDiscogsLog({
      telemetry: opts.telemetry,
      caller: callerBase,
      urlRedacted,
      phase: "after",
      httpStatus: res.status,
      ok: res.ok,
      query: opts.query,
      searchType: st,
    });

    const text = await res.text();
    let hits: DiscogsSearchHit[] = [];
    if (res.ok) {
      try {
        const body = JSON.parse(text) as { results?: DiscogsSearchHit[] };
        hits = body.results ?? [];
      } catch {
        hits = [];
      }
    }
    return {
      hits,
      status: res.status,
      ok: res.ok,
      urlRedacted,
      errorSnippet: res.ok ? null : text.slice(0, 500),
    };
  } catch (e) {
    bumpDiscogsOutboundClock();
    curatorDiscogsLog({
      telemetry: opts.telemetry,
      caller: callerBase,
      urlRedacted,
      phase: "after",
      httpStatus: null,
      ok: false,
      query: opts.query,
      searchType: st,
    });
    const msg = e instanceof Error ? e.message : String(e);
    return {
      hits: [],
      status: null,
      ok: false,
      urlRedacted,
      errorSnippet: msg,
    };
  }
}

async function discogsFetchJsonDetailed<T>(
  telemetry: CuratorDiscogsTelemetry,
  pathWithLeadingSlash: string,
): Promise<{
  data: T | null;
  status: number | null;
  ok: boolean;
  urlRedacted: string;
  errorSnippet: string | null;
}> {
  const callerLabel = `discogs_api_json${pathWithLeadingSlash}`;
  const u = new URL(`https://api.discogs.com${pathWithLeadingSlash}`);
  discogsTokenQuery(u);
  const fetchUrl = u.toString();
  const urlRedacted = redactDiscogsUrl(u);

  await paceDiscogsOutbound();
  curatorDiscogsLog({
    telemetry,
    caller: callerLabel,
    urlRedacted,
    phase: "before",
  });

  try {
    const res = await fetch(fetchUrl, {
      redirect: "follow",
      signal: abortDeadline(DISCOGS_TIMEOUT_MS),
      headers: discogsHeaders(),
    });
    bumpDiscogsOutboundClock();
    logDiscogsRateHeaders(callerLabel, u, res);
    curatorDiscogsLog({
      telemetry,
      caller: callerLabel,
      urlRedacted,
      phase: "after",
      httpStatus: res.status,
      ok: res.ok,
    });

    const text = await res.text();
    let data: T | null = null;
    if (res.ok) {
      try {
        data = JSON.parse(text) as T;
      } catch {
        data = null;
      }
    }
    return {
      data,
      status: res.status,
      ok: res.ok,
      urlRedacted,
      errorSnippet: res.ok ? null : text.slice(0, 500),
    };
  } catch (e) {
    bumpDiscogsOutboundClock();
    curatorDiscogsLog({
      telemetry,
      caller: callerLabel,
      urlRedacted,
      phase: "after",
      httpStatus: null,
      ok: false,
    });
    const msg = e instanceof Error ? e.message : String(e);
    return {
      data: null,
      status: null,
      ok: false,
      urlRedacted,
      errorSnippet: msg,
    };
  }
}

function pickLargestDiscogsImage(images?: DiscogsMasterDetail["images"]): string | null {
  if (!images?.length) return null;
  const withUri = images.filter((i) => i.uri || i.uri150);
  if (!withUri.length) return null;
  const primary = withUri.filter((i) => String(i.type ?? "").toLowerCase() === "primary");
  const pool = primary.length ? primary : withUri;
  pool.sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  const best = pool[0];
  return normalizeCandidateArtworkUrl(best?.uri ?? best?.uri150 ?? null);
}

function splitDiscogsListTitle(full: string, fallbackArtist: string): { artist: string; title: string } {
  const t = collapseWhitespace(full);
  const parts = t.split(/\s-\s/).map((p) => p.trim());
  if (parts.length >= 2 && parts[0] && parts.slice(1).join(" - ").trim()) {
    return { artist: parts[0], title: parts.slice(1).join(" - ") };
  }
  return { artist: fallbackArtist, title: t || fallbackArtist };
}

/** @deprecated Prefer `fetchCuratorArtworkCandidatesDetailed` — kept for callers that only need rows */
export async function fetchCuratorArtworkCandidates(opts: {
  artist: string;
  title: string;
  albumYear?: number | null;
  approvedCoverUrl?: string | null;
  albumId?: string | null;
  debug?: boolean;
}): Promise<CuratorApiCandidate[]> {
  const r = await fetchCuratorArtworkCandidatesDetailed(opts);
  return r.candidates;
}

export async function fetchCuratorArtworkCandidatesDetailed(opts: {
  artist: string;
  title: string;
  albumYear?: number | null;
  /** Ignored — kept for backward-compatible call signatures. */
  approvedCoverUrl?: string | null;
  albumId?: string | null;
  debug?: boolean;
}): Promise<CuratorFetchResult> {
  const debugEffective = Boolean(opts.debug) || envDebugCurator();
  const cacheKey = curatorIngestCacheKey({
    artist: opts.artist,
    title: opts.title,
    albumYear: opts.albumYear ?? null,
    albumId: opts.albumId ?? null,
    debug: debugEffective,
  });
  const now = Date.now();
  const hit = ingestResultCache.get(cacheKey);
  if (hit && CURATOR_INGEST_CACHE_MS > 0 && now - hit.at < CURATOR_INGEST_CACHE_MS) {
    console.warn("[curator/ingest_session]", {
      ts: new Date().toISOString(),
      event: "server_memory_cache_hit",
      keyPreview: cacheKey.slice(0, 200),
      ageMs: now - hit.at,
    });
    return structuredClone(hit.result);
  }

  const existing = ingestInflightByKey.get(cacheKey);
  if (existing) {
    console.warn("[curator/ingest_session]", {
      ts: new Date().toISOString(),
      event: "server_inflight_wait_same_key",
      keyPreview: cacheKey.slice(0, 200),
      note: "Coalescing duplicate GET /api/.../candidates ingest (often React StrictMode or parallel callers).",
    });
    return existing;
  }

  const ingestRunId = randomUUID();
  console.warn("[curator/ingest_session]", {
    ts: new Date().toISOString(),
    event: "ingest_begin_discogs_pipeline",
    ingestRunId,
    keyPreview: cacheKey.slice(0, 200),
    debugEffective,
  });

  const work = curatorIngestDetailedWork(opts, ingestRunId, debugEffective)
    .then((result) => {
      if (CURATOR_INGEST_CACHE_MS > 0) {
        ingestResultCache.set(cacheKey, { at: Date.now(), result });
      }
      return result;
    })
    .finally(() => {
      ingestInflightByKey.delete(cacheKey);
      curatorDiscogsIngestLedgerReset(ingestRunId);
    });

  ingestInflightByKey.set(cacheKey, work);
  return work;
}

async function curatorIngestDetailedWork(
  opts: {
    artist: string;
    title: string;
    albumYear?: number | null;
    approvedCoverUrl?: string | null;
    albumId?: string | null;
    debug?: boolean;
  },
  ingestRunId: string,
  debugEffective: boolean,
): Promise<CuratorFetchResult> {
  const telemetry: CuratorDiscogsTelemetry = { ingestRunId };
  const debug = debugEffective;
  const debugLog: string[] = [];
  const warnings: string[] = [];
  const dedupEliminations: CuratorDedupElimination[] = [];
  const hasToken = discogsTokenPresent();

  const rawArtist = collapseWhitespace(opts.artist);
  const albumSupplied = collapseWhitespace(opts.title);
  const targetYear =
    opts.albumYear != null && Number.isFinite(Number(opts.albumYear)) ? Math.round(Number(opts.albumYear)) : null;

  const emptyIngestBase = (): CuratorIngestCompact => ({
    discogsTokenPresent: hasToken,
    composedQuery: "",
    masterSearch: { ok: false, httpStatus: null, resultCount: 0, urlRedacted: "" },
    releaseSearch: { ok: false, httpStatus: null, resultCount: 0, urlRedacted: "" },
    masterIdsSelected: [],
    masterDetailFetches: 0,
    releasesWithExtractedImage: 0,
    rowsBeforeDedupe: 0,
    finalCandidateCount: 0,
    dedupEliminationCount: 0,
    discogsSearchesUnreachable: true,
    warnings: [],
  });

  if (!rawArtist || !albumSupplied) {
    curatorLog(debug, debugLog, "[curator] abort: missing artist or title");
    return {
      candidates: [],
      ingest: {
        ...emptyIngestBase(),
        warnings: ["missing artist or title"],
      },
    };
  }

  const album = sanitizeAlbumTitleForDiscogsLookup(albumSupplied) || albumSupplied;

  const composedQuery = collapseWhitespace(
    targetYear != null ? `${rawArtist} ${album} ${targetYear}` : `${rawArtist} ${album}`,
  );

  console.log("[curator/query]", {
    artist: rawArtist,
    album,
    year: targetYear,
    composedQuery,
    sourceAlbumId: (opts.albumId ?? "").trim().toUpperCase() || null,
    ingestRunId,
  });

  curatorLog(
    debug,
    debugLog,
    `[curator] --- ingest start ingestRunId=${ingestRunId} albumId="${(opts.albumId ?? "").trim().toUpperCase() || "none"}" artist="${rawArtist}" album_discogs="${album}" album_supplied="${albumSupplied}" year=${targetYear ?? "?"}`,
  );
  curatorLog(debug, debugLog, `[curator] DISCOGS_TOKEN present=${hasToken}`);

  if (album !== albumSupplied) {
    const w = `Discogs search uses cleaned album string (supplied "${albumSupplied.slice(0, 120)}" → "${album.slice(0, 120)}").`;
    warnings.push(w);
    curatorLog(debug, debugLog, `[curator] ${w}`);
  }
  if (!hasToken) {
    const w =
      "Discogs auth token not set (DISCOGS_TOKEN / DISCOGS_PERSONAL_TOKEN). Anonymous requests are rate-limited.";
    warnings.push(w);
    curatorLog(debug, debugLog, `[curator] WARN: ${w}`, true);
  }

  const masterMeta = await discogsDatabaseSearchDetailed({
    telemetry,
    query: composedQuery,
    type: "master",
    perPage: MASTER_DETAIL_CAP + 6,
  });
  curatorLog(
    debug,
    debugLog,
    `[curator/discogs] master search GET ${masterMeta.urlRedacted} -> ok=${masterMeta.ok} http=${masterMeta.status} results=${masterMeta.hits.length}`,
  );
  if (!masterMeta.ok) {
    warnings.push(
      `discogs_transport_master_failed http=${masterMeta.status ?? "?"} snippet=${masterMeta.errorSnippet ?? ""}`.slice(0, 400),
    );
    curatorLog(debug, debugLog, `[curator] master search unreachable`, true);
  }

  const masterHits = masterMeta.hits;
  const masterIdsRawFromApi = masterHits.filter((h) => h.type === "master").map((h) => h.id ?? "?");

  const masterIdsQueued = new Set<number>();
  const masterDetailLimited: DiscogsSearchHit[] = [];
  for (const hit of masterHits) {
    if (hit.type !== "master" || typeof hit.id !== "number") continue;
    if (masterIdsQueued.has(hit.id)) continue;
    masterIdsQueued.add(hit.id);
    if (masterDetailLimited.length >= MASTER_DETAIL_CAP) break;
    masterDetailLimited.push(hit);
  }

  const orderedRaw: CuratorApiCandidate[] = [];
  /** Tracks which pipeline produced each candidate so master releases can be ranked higher. */
  const kindByCandidate = new WeakMap<CuratorApiCandidate, "master" | "release">();
  let masterDetailFetchCount = 0;

  for (const hit of masterDetailLimited) {
    const mid = hit.id!;
    const detailMeta = await discogsFetchJsonDetailed<DiscogsMasterDetail>(telemetry, `/masters/${mid}`);
    masterDetailFetchCount += 1;
    if (!detailMeta.ok || !detailMeta.data) {
      curatorLog(
        debug,
        debugLog,
        `[curator/discogs] master ${mid} detail dropped snippet=${detailMeta.errorSnippet ?? ""}`,
        Boolean(detailMeta.errorSnippet),
      );
      continue;
    }
    const detail = detailMeta.data;
    const { artist: mArtist, title: mTitle } = splitDiscogsListTitle(detail.title ?? hit.title ?? "", rawArtist);
    const rowYear =
      typeof detail.year === "number" && Number.isFinite(detail.year) ? detail.year : parseYearFlexible(hit.year);
    const imageRaw = pickLargestDiscogsImage(detail.images);
    const thumbRaw = normalizeCandidateArtworkUrl(hit.cover_image ?? hit.thumb ?? null);
    const finalImg = imageRaw ?? thumbRaw;
    if (!finalImg) continue;

    const masterCandidate: CuratorApiCandidate = {
      source: "discogs",
      title: mTitle,
      artist: mArtist,
      year: rowYear,
      image: finalImg,
      url: detail.uri ? `https://www.discogs.com${detail.uri}` : `https://www.discogs.com/master/${mid}`,
    };
    kindByCandidate.set(masterCandidate, "master");
    orderedRaw.push(masterCandidate);
  }

  const releaseMeta = await discogsDatabaseSearchDetailed({
    telemetry,
    query: composedQuery,
    type: "release",
    perPage: RELEASE_SEARCH_PAGE,
  });
  curatorLog(
    debug,
    debugLog,
    `[curator/discogs] release search GET ${releaseMeta.urlRedacted} -> ok=${releaseMeta.ok} http=${releaseMeta.status} results=${releaseMeta.hits.length}`,
  );
  if (!releaseMeta.ok) {
    warnings.push(
      `discogs_transport_release_failed http=${releaseMeta.status ?? "?"} snippet=${releaseMeta.errorSnippet ?? ""}`.slice(
        0,
        400,
      ),
    );
    curatorLog(debug, debugLog, `[curator] release search unreachable`, true);
  }

  const releaseHits = releaseMeta.hits;
  let releasesWithImage = 0;
  let releaseDetailSlots = 0;

  for (const row of releaseHits) {
    if (row.type && row.type !== "release") continue;
    if (row.resource_url?.includes("/masters/")) continue;

    const fullTitle = row.title ?? "";
    const { artist: dArtist, title: dTitle } = splitDiscogsListTitle(fullTitle, rawArtist);
    let yRaw = parseYearFlexible(row.year);
    let img = normalizeCandidateArtworkUrl(row.cover_image ?? row.thumb ?? null);

    if (
      typeof row.id === "number" &&
      row.resource_url &&
      releaseDetailSlots < MAX_RELEASE_DETAIL_FETCHES &&
      (!img || yRaw == null)
    ) {
      const relMeta = await discogsFetchJsonDetailed<{
        artists?: Array<{ name?: string }>;
        title?: string;
        year?: number | string;
        images?: DiscogsMasterDetail["images"];
        uri?: string;
      }>(telemetry, `/releases/${row.id}`);
      releaseDetailSlots += 1;

      const rel = relMeta.data;
      if (relMeta.ok && rel?.images?.length) {
        const picked = pickLargestDiscogsImage(rel.images);
        if (picked) img = picked;
      }
      if (!yRaw && rel?.year != null) yRaw = parseYearFlexible(rel.year);
    }

    if (!img) continue;
    releasesWithImage += 1;

    const releaseCandidate: CuratorApiCandidate = {
      source: "discogs",
      title: dTitle,
      artist: dArtist,
      year: yRaw,
      image: img,
      url: row.uri ? `https://www.discogs.com${row.uri}` : row.resource_url ?? null,
    };
    kindByCandidate.set(releaseCandidate, "release");
    orderedRaw.push(releaseCandidate);
  }

  const discogsSearchesUnreachable = !masterMeta.ok && !releaseMeta.ok;

  const candidateTrace = orderedRaw.map((r) => ({
    title: r.title,
    artist: r.artist,
    year: r.year,
    imageSample: (r.image ?? "").slice(0, 120),
  }));

  const seenUrl = new Set<string>();
  const dedupedRaw: CuratorApiCandidate[] = [];
  let ordinal = 0;

  for (const row of orderedRaw) {
    ordinal += 1;
    const normalized = normalizeCandidateArtworkUrl(row.image);
    if (!normalized) {
      dedupEliminations.push({
        reason: "empty_image",
        source: "discogs",
        title: row.title,
        artist: row.artist,
        ordinal,
        urlPreview: "",
      });
      continue;
    }
    if (seenUrl.has(normalized)) {
      dedupEliminations.push({
        reason: "duplicate_url",
        source: "discogs",
        title: row.title,
        artist: row.artist,
        ordinal,
        urlPreview: normalized.slice(0, 160),
      });
      continue;
    }
    seenUrl.add(normalized);
    const normalizedRow: CuratorApiCandidate = { ...row, image: normalized };
    const inheritedKind = kindByCandidate.get(row);
    if (inheritedKind) kindByCandidate.set(normalizedRow, inheritedKind);
    dedupedRaw.push(normalizedRow);
    if (dedupedRaw.length >= MAX_CANDIDATES) break;
  }

  /**
   * Strong-match filter (Part B stabilization):
   *   - normalize-equal title  → +100
   *   - title token coverage   → +0..30
   *   - normalize-equal artist → +80
   *   - artist token coverage  → +0..20
   *   - master kind            → +25
   *   - year matches album     → +10
   *   - bad markers in title (single / promo / hits / compilation / anthology / best of)
   *     → -200 (effectively excluded unless album title itself contains them)
   *
   * Picks top `MAX_FINAL_CANDIDATES` by score. If filtering would yield zero,
   * we keep the top scores anyway so the curator never shows an empty grid when
   * Discogs did return something — the warnings already cover that case.
   */
  const albumTokens = tokenize(albumSupplied);
  const artistTokens = tokenize(rawArtist);
  const albumWantsHits = /\b(hits|best of|anthology|collection|compilation|singles)\b/i.test(albumSupplied);

  const scored = dedupedRaw.map((row, idx) => {
    const titleTokens = tokenize(row.title);
    const rowArtistTokens = tokenize(row.artist);

    let score = 0;
    if (joinTokens(titleTokens) === joinTokens(albumTokens) && albumTokens.length > 0) score += 100;
    score += tokenOverlapScore(titleTokens, albumTokens, 30);
    if (joinTokens(rowArtistTokens) === joinTokens(artistTokens) && artistTokens.length > 0) score += 80;
    score += tokenOverlapScore(rowArtistTokens, artistTokens, 20);
    if (kindByCandidate.get(row) === "master") score += 25;
    if (row.year != null && targetYear != null && row.year === targetYear) score += 10;
    if (!albumWantsHits && /\b(greatest hits|best of|anthology|compilation|singles|single|promo|advance)\b/i.test(row.title)) {
      score -= 200;
    }
    return { row, score, idx };
  });

  scored.sort((a, b) => (b.score - a.score) || (a.idx - b.idx));

  const STRONG_SCORE_MIN = 60;
  const strong = scored.filter((s) => s.score >= STRONG_SCORE_MIN);
  const ranked = (strong.length > 0 ? strong : scored).slice(0, MAX_FINAL_CANDIDATES);
  const out: CuratorApiCandidate[] = ranked.map((s) => s.row);

  console.log("[curator] step=strong_match_filter", {
    ingestRunId,
    rowsBeforeRanking: dedupedRaw.length,
    rankedFinal: out.length,
    topScores: scored.slice(0, Math.min(6, scored.length)).map((s) => ({
      score: s.score,
      kind: kindByCandidate.get(s.row) ?? "?",
      title: s.row.title.slice(0, 60),
      artist: s.row.artist.slice(0, 40),
      year: s.row.year,
    })),
  });

  const authWall =
    masterMeta.status === 401 ||
    masterMeta.status === 403 ||
    releaseMeta.status === 401 ||
    releaseMeta.status === 403;

  if (authWall) {
    warnings.push("Discogs returned 401/403 — configure DISCOGS_TOKEN for stable access.");
  }

  if (!discogsSearchesUnreachable && out.length === 0) {
    warnings.push("Discogs returned no usable cover images for this search.");
    curatorLog(debug, debugLog, `[curator] zero candidates after ingest`, true);
  }

  const ingest: CuratorIngestCompact = {
    discogsTokenPresent: hasToken,
    composedQuery,
    masterSearch: {
      ok: masterMeta.ok,
      httpStatus: masterMeta.status,
      resultCount: masterHits.length,
      urlRedacted: masterMeta.urlRedacted,
    },
    releaseSearch: {
      ok: releaseMeta.ok,
      httpStatus: releaseMeta.status,
      resultCount: releaseHits.length,
      urlRedacted: releaseMeta.urlRedacted,
    },
    masterIdsSelected: masterDetailLimited.map((h) => h.id!),
    masterDetailFetches: masterDetailFetchCount,
    releasesWithExtractedImage: releasesWithImage,
    rowsBeforeDedupe: orderedRaw.length,
    finalCandidateCount: out.length,
    dedupEliminationCount: dedupEliminations.length,
    discogsSearchesUnreachable,
    warnings,
  };

  curatorLog(
    debug,
    debugLog,
    `[curator] --- ingest end ingestRunId=${ingestRunId} FINAL_COUNT=${out.length} unreachable=${discogsSearchesUnreachable}`,
  );

  const ingestFull: CuratorIngestFull | undefined = debug
    ? {
        ...ingest,
        masterIdsRawFromApi,
        candidateTrace,
        dedupEliminations,
        debugLog,
      }
    : undefined;

  return { candidates: out, ingest, ingestFull };
}
