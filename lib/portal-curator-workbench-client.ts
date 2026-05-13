"use client";

/** Browser session dedupe/cache for curator → GET /api/artwork-workbench/candidates */

const CLIENT_CURATOR_INGEST_MS = Math.max(
  0,
  Number.parseInt(
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_CURATOR_CLIENT_CACHE_MS
      ? process.env.NEXT_PUBLIC_CURATOR_CLIENT_CACHE_MS
      : `${14 * 60 * 1000}`,
    10,
  ),
);

const DEBOUNCE_INGRESS_MS = Math.max(
  0,
  Number.parseInt(
    typeof process !== "undefined" && process.env.NEXT_PUBLIC_CURATOR_CLIENT_DEBOUNCE_MS
      ? process.env.NEXT_PUBLIC_CURATOR_CLIENT_DEBOUNCE_MS
      : "275",
    10,
  ),
);

/** Debounce curator route GET after modal mount (StrictMode jitter + swipe noise). See use in portal overlays. */
export const CURATOR_CLIENT_INGRESS_DEBOUNCE_MS = DEBOUNCE_INGRESS_MS;

type WorkbenchCandidate = {
  source: "discogs";
  title: string;
  artist: string;
  year: number | null;
  image: string | null;
  url?: string | null;
  stagedFilePath?: string | null;
};

export type CuratorIngestLite = {
  discogsSearchesUnreachable?: boolean;
  composedQuery?: string;
  masterSearch?: { ok?: boolean; httpStatus?: number | null; resultCount?: number };
  releaseSearch?: { ok?: boolean; httpStatus?: number | null; resultCount?: number };
  masterIdsSelected?: number[];
};

type CandidateApiFailureDetail = {
  kind: "http" | "network" | "parse";
  endpoint: string;
  requestUrl: string;
  httpStatus: number | null;
  detail: string;
  bodySnippet?: string;
};

export type PortalCuratorWorkbenchOk = {
  ok: true;
  candidates: WorkbenchCandidate[];
  warnings: string[];
  ingest: CuratorIngestLite | null;
  ingestFull: unknown | null;
  discogsUnavailable: boolean;
  requestUrl: string;
};

export type PortalCuratorWorkbenchResult = PortalCuratorWorkbenchOk | { ok: false; error: CandidateApiFailureDetail };

function collapseSpaces(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function curatorClientCacheKey(params: {
  artist: string;
  title: string;
  albumId: string;
  year: number | null;
  debugCurator: boolean;
}): string {
  const yr = params.year != null && Number.isFinite(params.year) ? String(Math.round(params.year)) : "";
  const id = params.albumId.trim().toUpperCase();
  return `${id}\x1f${collapseSpaces(params.artist)}\x1f${collapseSpaces(params.title)}\x1f${yr}\x1fdc=${params.debugCurator ? "1" : "0"}`;
}

const memoryCacheByKey = new Map<string, { at: number; result: PortalCuratorWorkbenchOk }>();
const inflightByKey = new Map<string, Promise<PortalCuratorWorkbenchResult>>();
let ingressOrdinal = 0;

export async function fetchPortalCuratorWorkbenchRaw(params: {
  artist: string;
  title: string;
  albumId: string;
  year: number | null;
}): Promise<PortalCuratorWorkbenchResult> {
  const endpointPath = "/api/artwork-workbench/candidates";
  const u = new URL(endpointPath, window.location.origin);
  u.searchParams.set("artist", params.artist.trim());
  u.searchParams.set("title", params.title.trim());
  u.searchParams.set("albumId", params.albumId.trim());
  if (params.year != null && Number.isFinite(params.year)) u.searchParams.set("year", String(params.year));
  const debugCurator = typeof process !== "undefined" && process.env.NODE_ENV === "development";
  if (debugCurator) {
    u.searchParams.set("debugCurator", "1");
  }

  const requestUrl = u.toString();

  let res: Response;
  try {
    res = await fetch(requestUrl);
  } catch (e) {
    const detail = e instanceof Error ? `${e.name}: ${e.message}` : String(e);
    const err: CandidateApiFailureDetail = {
      kind: "network",
      endpoint: endpointPath,
      requestUrl,
      httpStatus: null,
      detail,
    };
    console.error("[portal-curator/client] candidates_fetch_network", err);
    return { ok: false, error: err };
  }

  const textBody = await res.text();
  const snippet = textBody.slice(0, 1200);

  if (!res.ok) {
    const detail =
      res.status === 401 && textBody.includes("ops_gate_required")
        ? "Ops gate rejected this route (retroverse PIN). GET /api/artwork-workbench/candidates should be allowlisted."
        : `HTTP ${res.status}`;
    const err: CandidateApiFailureDetail = {
      kind: "http",
      endpoint: endpointPath,
      requestUrl,
      httpStatus: res.status,
      detail: snippet ? `${detail} Body: ${snippet.slice(0, 320)}${snippet.length > 320 ? "…" : ""}` : detail,
      bodySnippet: snippet || undefined,
    };
    console.error("[portal-curator/client] candidates_fetch_http", {
      httpStatus: res.status,
      endpoint: endpointPath,
      urlSample: requestUrl.slice(0, 480),
      bodyHead: snippet.slice(0, 400),
    });
    return { ok: false, error: err };
  }

  let body: unknown;
  try {
    body = JSON.parse(textBody || "{}") as unknown;
  } catch (e) {
    const err: CandidateApiFailureDetail = {
      kind: "parse",
      endpoint: endpointPath,
      requestUrl,
      httpStatus: res.status,
      detail: e instanceof Error ? e.message : String(e),
      bodySnippet: snippet || undefined,
    };
    console.error("[portal-curator/client] candidates_json_parse_failed", err);
    return { ok: false, error: err };
  }

  const typed = body as {
    ok?: unknown;
    candidates?: WorkbenchCandidate[];
    warnings?: unknown;
    curatorIngest?: CuratorIngestLite;
    curatorIngestFull?: unknown;
    discogsUnavailable?: boolean;
    error?: unknown;
    message?: unknown;
  };
  if (typed.ok === false) {
    const err: CandidateApiFailureDetail = {
      kind: "http",
      endpoint: endpointPath,
      requestUrl,
      httpStatus: res.status,
      detail: typed.message != null ? String(typed.message) : typed.error != null ? String(typed.error) : "API returned ok: false",
      bodySnippet: snippet || undefined,
    };
    console.error("[portal-curator/client] candidates_envelope_failure", err);
    return { ok: false, error: err };
  }

  const w = Array.isArray(typed.warnings) ? typed.warnings.filter((x): x is string => typeof x === "string") : [];
  const ingestFull = typed.curatorIngestFull ?? null;
  const debugVerbose = typeof process !== "undefined" && process.env.NODE_ENV === "development";
  if (debugVerbose && ingestFull) {
    console.log("[portal-curator/client] curatorIngestFull", ingestFull);
  }

  return {
    ok: true,
    candidates: Array.isArray(typed.candidates) ? typed.candidates : [],
    warnings: w,
    ingest: typed.curatorIngest ?? null,
    ingestFull,
    discogsUnavailable: Boolean(typed.discogsUnavailable ?? typed.curatorIngest?.discogsSearchesUnreachable),
    requestUrl,
  };
}

/**
 * Dedupes overlapping React 18 StrictMode effects (dev) + remount jitter with in-flight joins + TTL memory cache.
 */
export async function fetchPortalCuratorWorkbenchSession(params: {
  artist: string;
  title: string;
  albumId: string;
  year: number | null;
}): Promise<PortalCuratorWorkbenchResult> {
  const ts = () => new Date().toISOString();
  ingressOrdinal += 1;
  const ord = ingressOrdinal;

  const debugCurator =
    typeof process !== "undefined" &&
    typeof window !== "undefined" &&
    process.env.NODE_ENV === "development";

  const key = curatorClientCacheKey({ ...params, debugCurator });
  const now = Date.now();
  const memHit = memoryCacheByKey.get(key);
  if (memHit && CLIENT_CURATOR_INGEST_MS > 0 && now - memHit.at < CLIENT_CURATOR_INGEST_MS) {
    console.warn("[curator/client_ingress]", {
      ts: ts(),
      ordinal: ord,
      event: "browser_memory_cache_hit",
      caller: "fetchPortalCuratorWorkbenchSession",
      keyPreview: key.slice(0, 200),
      ageMs: now - memHit.at,
      strictModeDuplicateEffectHint:
        typeof process !== "undefined" && process.env.NODE_ENV === "development"
          ? "React 18 StrictMode runs effects twice in dev; session cache skips the second curator route GET."
          : null,
    });
    return { ...memHit.result };
  }

  const pendingIngress = inflightByKey.get(key);
  if (pendingIngress) {
    console.warn("[curator/client_ingress]", {
      ts: ts(),
      ordinal: ord,
      event: "browser_inflight_coalesce",
      caller: "fetchPortalCuratorWorkbenchSession",
      keyPreview: key.slice(0, 200),
    });
    return pendingIngress;
  }

  console.warn("[curator/client_ingress]", {
    ts: ts(),
    ordinal: ord,
    event: "candidate_route_FETCH_begin",
    caller: "PortalOverlayOrStageModal",
    keyPreview: key.slice(0, 200),
    debugCurator,
  });

  const work = fetchPortalCuratorWorkbenchRaw(params)
    .then((r) => {
      if (r.ok && CLIENT_CURATOR_INGEST_MS > 0) {
        memoryCacheByKey.set(key, { at: Date.now(), result: r });
      }
      return r;
    })
    .finally(() => {
      inflightByKey.delete(key);
    });
  inflightByKey.set(key, work);
  return work;
}
