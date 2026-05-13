/**
 * Shared HTTP transport for iTunes Search API — browser-like headers and multi-layer fallback.
 */

export type TransportTaxonomy =
  | "transport_ok"
  | "transport_403"
  | "transport_empty_body"
  | "transport_timeout"
  | "transport_invalid_json";

export type TransportLayer = "native_fetch" | "fetch_browser_headers" | "axios" | "undici" | "none";

const SAFARI_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15";

/** Realistic browser headers for iTunes / Apple edge. */
export function buildItunesBrowserHeaders(): Record<string, string> {
  return {
    "User-Agent": SAFARI_UA,
    Accept: "application/json",
    "Accept-Language": "en-US,en;q=0.9",
    Origin: "https://music.apple.com",
    Referer: "https://music.apple.com/",
    Connection: "keep-alive",
  };
}

export function summarizeResponseHeaders(get: (name: string) => string | null): string {
  const names = ["content-type", "content-length", "server", "cf-ray", "x-apple-request-id", "date", "cache-control"];
  const parts: string[] = [];
  for (const n of names) {
    const v = get(n);
    if (v) parts.push(`${n}=${v.replace(/\s+/g, " ").slice(0, 160)}`);
  }
  return parts.join("; ").slice(0, 550);
}

type Payload = { resultCount?: number; results?: unknown[] };

function classifyFromHttpStatus(status: number): TransportTaxonomy | null {
  if (status === 403) return "transport_403";
  return null;
}

function parseBodyJson(text: string, httpStatus: number): {
  taxonomy: TransportTaxonomy;
  payload: Payload | null;
  rawResultCount: number;
  results: unknown[];
} {
  if (!text.length) {
    if (httpStatus === 403) return { taxonomy: "transport_403", payload: null, rawResultCount: 0, results: [] };
    return { taxonomy: "transport_empty_body", payload: null, rawResultCount: 0, results: [] };
  }
  try {
    const payload = JSON.parse(text) as Payload;
    const results = payload.results ?? [];
    const rawResultCount = payload.resultCount ?? results.length;
    return { taxonomy: "transport_ok", payload, rawResultCount, results };
  } catch {
    return { taxonomy: "transport_invalid_json", payload: null, rawResultCount: 0, results: [] };
  }
}

export type ItunesTransportResult = {
  results: unknown[];
  rawResultCount: number;
  httpStatus: number;
  url: string;
  transportLayer: TransportLayer;
  transportTaxonomy: TransportTaxonomy;
  responseContentLength: number;
  responseContentType: string;
  responseHeadersSummary: string;
  /** Full response body from Apple when JSON parse succeeded (`transport_ok`). Preserved for raw snapshots. */
  rawResponseBodyText: string | null;
  /** Semicolon-separated tries: layer:status:bytes[:resultCount]; last segment `winner=layer`. */
  transportFallbackSummary: string;
};

type TryOutcome = {
  layer: TransportLayer;
  httpStatus: number;
  byteLength: number;
  resultCount: number;
  taxonomy: TransportTaxonomy;
};

async function responseToOutcome(
  layer: TransportLayer,
  httpStatus: number,
  contentType: string,
  headersSummary: string,
  text: string,
): Promise<{ outcome: TryOutcome; result: Omit<ItunesTransportResult, "transportFallbackSummary"> }> {
  const t403 = classifyFromHttpStatus(httpStatus);
  if (t403) {
    const outcome: TryOutcome = {
      layer,
      httpStatus,
      byteLength: text.length,
      resultCount: 0,
      taxonomy: t403,
    };
    return {
      outcome,
      result: {
        results: [],
        rawResultCount: 0,
        httpStatus,
        url: "",
        transportLayer: layer,
        transportTaxonomy: t403,
        responseContentLength: text.length,
        responseContentType: contentType,
        responseHeadersSummary: headersSummary,
        rawResponseBodyText: null,
      },
    };
  }

  const parsed = parseBodyJson(text, httpStatus);
  const outcome: TryOutcome = {
    layer,
    httpStatus,
    byteLength: text.length,
    resultCount: parsed.rawResultCount,
    taxonomy: parsed.taxonomy,
  };

  return {
    outcome,
    result: {
      results: parsed.results,
      rawResultCount: parsed.rawResultCount,
      httpStatus,
      url: "",
      transportLayer: layer,
      transportTaxonomy: parsed.taxonomy,
      responseContentLength: text.length,
      responseContentType: contentType,
      responseHeadersSummary: headersSummary,
      rawResponseBodyText: parsed.taxonomy === "transport_ok" ? text : null,
    },
  };
}

async function tryNativeFetch(url: string, timeoutMs: number): Promise<TryOutcome & { partial: ItunesTransportResult }> {
  const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const headersSummary = summarizeResponseHeaders((n) => response.headers.get(n));
  const { outcome, result } = await responseToOutcome(
    "native_fetch",
    response.status,
    contentType,
    headersSummary,
    text,
  );
  return { ...outcome, partial: { ...result, url, transportFallbackSummary: "" } };
}

async function tryFetchBrowserHeaders(
  url: string,
  timeoutMs: number,
): Promise<TryOutcome & { partial: ItunesTransportResult }> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: buildItunesBrowserHeaders(),
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const headersSummary = summarizeResponseHeaders((n) => response.headers.get(n));
  const { outcome, result } = await responseToOutcome(
    "fetch_browser_headers",
    response.status,
    contentType,
    headersSummary,
    text,
  );
  return { ...outcome, partial: { ...result, url, transportFallbackSummary: "" } };
}

async function tryAxios(url: string, timeoutMs: number): Promise<TryOutcome & { partial: ItunesTransportResult }> {
  const axios = (await import("axios")).default;
  const res = await axios.get<string>(url, {
    headers: buildItunesBrowserHeaders(),
    timeout: timeoutMs,
    validateStatus: () => true,
    responseType: "text",
    transitional: { forcedJSONParsing: false },
  });
  const text = typeof res.data === "string" ? res.data : String(res.data ?? "");
  const contentType = String(res.headers["content-type"] ?? res.headers["Content-Type"] ?? "");
  const headersSummary = summarizeResponseHeaders((n) => {
    const v = res.headers[n] ?? res.headers[n.toLowerCase()];
    return v != null ? String(v) : null;
  });
  const { outcome, result } = await responseToOutcome("axios", res.status, contentType, headersSummary, text);
  return { ...outcome, partial: { ...result, url, transportFallbackSummary: "" } };
}

async function tryUndici(url: string, timeoutMs: number): Promise<TryOutcome & { partial: ItunesTransportResult }> {
  const { fetch: undiciFetch } = await import("undici");
  const response = await undiciFetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: buildItunesBrowserHeaders(),
  });
  const text = await response.text();
  const contentType = response.headers.get("content-type") ?? "";
  const headersSummary = summarizeResponseHeaders((n) => response.headers.get(n));
  const { outcome, result } = await responseToOutcome("undici", response.status, contentType, headersSummary, text);
  return { ...outcome, partial: { ...result, url, transportFallbackSummary: "" } };
}

function tracePart(o: TryOutcome): string {
  return `${o.layer}:${o.httpStatus}:${o.byteLength}:${o.resultCount}`;
}

/**
 * A) minimal fetch → B) fetch+browser headers → C) axios → D) undici (browser headers).
 * Uses the first response with transport_ok (parseable JSON); otherwise returns the last try.
 */
export async function fetchItunesSearchWithTransport(url: string, timeoutMs: number): Promise<ItunesTransportResult> {
  const tries: TryOutcome[] = [];
  const runners: Array<{
    layer: TransportLayer;
    run: () => Promise<TryOutcome & { partial: ItunesTransportResult }>;
  }> = [
    { layer: "native_fetch", run: () => tryNativeFetch(url, timeoutMs) },
    { layer: "fetch_browser_headers", run: () => tryFetchBrowserHeaders(url, timeoutMs) },
    { layer: "axios", run: () => tryAxios(url, timeoutMs) },
    { layer: "undici", run: () => tryUndici(url, timeoutMs) },
  ];

  let lastPartial: ItunesTransportResult | null = null;

  for (const { layer, run } of runners) {
    try {
      const { partial, ...outcome } = await run();
      const o: TryOutcome = { ...outcome, layer };
      tries.push(o);
      lastPartial = { ...partial, url, transportLayer: layer };
      if (o.taxonomy === "transport_ok" && o.httpStatus >= 200 && o.httpStatus < 300) {
        const summary = `${tries.map(tracePart).join(";")};winner=${layer}`;
        return { ...lastPartial, transportFallbackSummary: summary };
      }
    } catch (e) {
      const isAbort = e instanceof Error && (e.name === "AbortError" || e.message.toLowerCase().includes("aborted"));
      const err = e as NodeJS.ErrnoException;
      const isTimeout =
        e instanceof Error &&
        (err.code === "ETIMEDOUT" || err.code === "UND_ERR_CONNECT_TIMEOUT" || e.message.toLowerCase().includes("timeout"));
      const tax: TransportTaxonomy = isAbort || isTimeout ? "transport_timeout" : "transport_invalid_json";
      tries.push({ layer, httpStatus: 0, byteLength: 0, resultCount: 0, taxonomy: tax });
      lastPartial = {
        results: [],
        rawResultCount: 0,
        httpStatus: 0,
        url,
        transportLayer: layer,
        transportTaxonomy: tax,
        responseContentLength: 0,
        responseContentType: "",
        responseHeadersSummary: e instanceof Error ? e.message.slice(0, 200) : String(e),
        transportFallbackSummary: "",
        rawResponseBodyText: null,
      };
    }
  }

  const summary = `${tries.map(tracePart).join(";")};winner=none`;
  if (lastPartial) {
    return { ...lastPartial, transportLayer: "none", transportFallbackSummary: summary };
  }
  return {
    results: [],
    rawResultCount: 0,
    httpStatus: 0,
    url,
    transportLayer: "none",
    transportTaxonomy: "transport_invalid_json",
    responseContentLength: 0,
    responseContentType: "",
    responseHeadersSummary: "",
    transportFallbackSummary: summary,
    rawResponseBodyText: null,
  };
}

/** Single-layer probe (for diagnostics / test script). */
export async function probeItunesTransportLayer(
  url: string,
  layer: TransportLayer,
  timeoutMs: number,
): Promise<ItunesTransportResult> {
  try {
    let r: TryOutcome & { partial: ItunesTransportResult };
    if (layer === "native_fetch") r = await tryNativeFetch(url, timeoutMs);
    else if (layer === "fetch_browser_headers") r = await tryFetchBrowserHeaders(url, timeoutMs);
    else if (layer === "axios") r = await tryAxios(url, timeoutMs);
    else r = await tryUndici(url, timeoutMs);

    return {
      ...r.partial,
      url,
      transportFallbackSummary: `${tracePart(r)};winner=${r.layer}`,
    };
  } catch (e) {
    const tax: TransportTaxonomy =
      e instanceof Error && (e.name === "AbortError" || e.message.toLowerCase().includes("timeout"))
        ? "transport_timeout"
        : "transport_invalid_json";
    return {
      results: [],
      rawResultCount: 0,
      httpStatus: 0,
      url,
      transportLayer: layer,
      transportTaxonomy: tax,
      responseContentLength: 0,
      responseContentType: "",
      responseHeadersSummary: e instanceof Error ? e.message.slice(0, 200) : String(e),
      transportFallbackSummary: `${layer}:error:0:0`,
      rawResponseBodyText: null,
    };
  }
}
