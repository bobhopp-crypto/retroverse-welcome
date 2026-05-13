/**
 * Central Discogs outbound logging + duplicate URL detection inside a curator ingest run.
 */

export type CuratorDiscogsTelemetry = {
  ingestRunId: string;
};

let globalFetchOrdinal = 0;

/** before|caller|url */
const signaturesBeforeOutbound = new Map<string, Set<string>>();

export function curatorDiscogsIngestLedgerReset(runId: string): void {
  signaturesBeforeOutbound.delete(runId);
}

export function curatorDiscogsLog(opts: {
  telemetry: CuratorDiscogsTelemetry;
  caller: string;
  urlRedacted: string;
  phase: "before" | "after";
  httpStatus?: number | null;
  ok?: boolean | null;
  query?: string;
  searchType?: "master" | "release";
}): void {
  const ts = new Date().toISOString();
  globalFetchOrdinal += 1;

  let set = signaturesBeforeOutbound.get(opts.telemetry.ingestRunId);
  if (!set) {
    set = new Set<string>();
    signaturesBeforeOutbound.set(opts.telemetry.ingestRunId, set);
  }
  const sig = `before|${opts.caller}|${opts.urlRedacted}`;
  const duplicateWithinIngest =
    opts.phase === "before" ? set.has(sig) : false;
  if (opts.phase === "before") set.add(sig);

  console.warn("[curator/discogs_fetch]", {
    ts,
    ordinal: globalFetchOrdinal,
    ingestRunId: opts.telemetry.ingestRunId,
    caller: opts.caller,
    phase: opts.phase,
    httpStatus: opts.httpStatus ?? null,
    transportOk: opts.ok ?? null,
    discogs429: opts.phase === "after" && opts.httpStatus === 429,
    queryPreview: opts.query != null ? opts.query.slice(0, 240) : null,
    searchType: opts.searchType ?? null,
    urlSample: opts.urlRedacted.slice(0, 320),
    duplicateWithinCuratorLogicalHop: duplicateWithinIngest,
  });
}
