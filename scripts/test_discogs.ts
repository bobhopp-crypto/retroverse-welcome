/**
 * Standalone Discogs API probe (learning only — no curator / product logic).
 *
 * Uses: native `fetch`, `URL`, `URLSearchParams` only for requests.
 * Auth: append `token` via `URLSearchParams` (Discogs supports query token).
 *
 * Env: DISCOGS_TOKEN or DISCOGS_PERSONAL_TOKEN must be set in the shell
 *      (ex: `export DISCOGS_TOKEN=...`, or CI secrets).
 *
 * Usage: npx tsx scripts/test_discogs.ts
 */

const SEARCHES: Array<{ label: string; query: string }> = [
  { label: "Elton John — Greatest Hits", query: "Elton John Greatest Hits" },
  { label: "Earth, Wind & Fire — Gratitude", query: "Earth, Wind & Fire Gratitude" },
  { label: "Grease soundtrack", query: "Grease soundtrack" },
];

const TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.DISCOGS_PROBE_TIMEOUT_MS ?? "15000", 10));

function secret(): string {
  return (process.env.DISCOGS_TOKEN ?? process.env.DISCOGS_PERSONAL_TOKEN ?? "").trim();
}

function pickStr(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === "string") return v;
  if (typeof v === "number" && Number.isFinite(v)) return String(v);
  return null;
}

function pickNum(v: unknown): number | null {
  if (typeof v !== "number" || !Number.isFinite(v)) return null;
  return v;
}

function redactSignedUrl(urlStr: string, tok: string): string {
  if (!tok.length) return urlStr;
  return urlStr.split(tok).join("<TOKEN_REDACTED>");
}

/** Full URL passed to fetch (includes token). */
function buildSearchUrl(query: string, tok: string): string {
  const u = new URL("https://api.discogs.com/database/search");
  u.searchParams.set("q", query);
  u.searchParams.set("per_page", "40");
  u.searchParams.set("token", tok);
  return u.toString();
}

/** Full URL passed to fetch (includes token). */
function buildMasterUrl(masterId: number, tok: string): string {
  const u = new URL(`https://api.discogs.com/masters/${masterId}`);
  u.searchParams.set("token", tok);
  return u.toString();
}

async function GET(urlFull: string): Promise<{ ok: boolean; status: number; text: string }> {
  const res = await fetch(urlFull, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  const text = await res.text();
  return { ok: res.ok, status: res.status, text };
}

function summarizeHit(hit: Record<string, unknown>): {
  title: string | null;
  year: string | null;
  type: string | null;
  master_id: unknown;
  cover_image: string | null;
  thumb: string | null;
} {
  const masterIdRaw = hit["master_id"];
  return {
    title: pickStr(hit["title"]),
    year: pickStr(hit["year"]),
    type: pickStr(hit["type"]),
    master_id: masterIdRaw === undefined ? null : masterIdRaw,
    cover_image: pickStr(hit["cover_image"]),
    thumb: pickStr(hit["thumb"]),
  };
}

/** First Discogs master row in API order (whole first page slice). */
function firstMasterId(results: Record<string, unknown>[]): number | null {
  for (const raw of results) {
    const t = pickStr(raw["type"]);
    const id = pickNum(raw["id"]);
    if (t === "master" && id != null) return id;
  }
  return null;
}

async function probeMaster(tok: string, masterId: number): Promise<void> {
  const urlFull = buildMasterUrl(masterId, tok);
  console.log("");
  console.log("--- MASTER DETAIL ---");
  console.log("A. request URL (token redacted):");
  console.log(redactSignedUrl(urlFull, tok));

  const { ok, status, text } = await GET(urlFull);

  console.log("");
  console.log("B. HTTP status:", status, ok ? "OK" : "NOT OK");
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(text || "{}") as Record<string, unknown>;
  } catch {
    console.log("parse_error body_head=", JSON.stringify(text.slice(0, 400)));
    return;
  }

  const imagesRaw = body["images"];
  const imagesArr = Array.isArray(imagesRaw) ? imagesRaw : [];
  console.log("");
  console.log("C. uri:", pickStr(body["uri"]) ?? "(none)");
  console.log(
    "D. styles:",
    Array.isArray(body["styles"]) ? JSON.stringify(body["styles"]) : String(body["styles"] ?? "(none)"),
  );
  console.log("E. year:", body["year"] ?? "(none)");
  console.log("F. main_release:", body["main_release"] ?? "(none)");
  console.log("G. image count:", imagesArr.length);
  console.log("");
  console.log("H. images:");
  console.log(JSON.stringify(imagesRaw, null, 2));
}

async function main(): Promise<void> {
  const tok = secret();
  if (!tok) {
    console.error("Missing DISCOGS_TOKEN or DISCOGS_PERSONAL_TOKEN.");
    process.exitCode = 1;
    return;
  }

  console.log("timeout_ms=", TIMEOUT_MS);

  for (const { label, query } of SEARCHES) {
    const urlFull = buildSearchUrl(query, tok);

    console.log("");
    console.log("=".repeat(72));
    console.log("SEARCH:", label);
    console.log("=".repeat(72));

    console.log("");
    console.log("A. exact request URL (token redacted — real token is last query param `token`):");
    console.log(redactSignedUrl(urlFull, tok));

    const { ok, status, text } = await GET(urlFull);

    console.log("");
    console.log("B. HTTP status:", status, ok ? "OK" : "NOT OK");

    let parsed: { results?: unknown };
    try {
      parsed = JSON.parse(text || "{}") as { results?: unknown };
    } catch {
      console.log("");
      console.log("parse_error search body_head=", JSON.stringify(text.slice(0, 400)));
      continue;
    }

    const resultsList = Array.isArray(parsed.results) ? (parsed.results as Record<string, unknown>[]) : [];
    console.log("");
    console.log("C. result count:", resultsList.length);

    console.log("");
    console.log("D. first 5 results:");
    for (let i = 0; i < Math.min(5, resultsList.length); i += 1) {
      console.log(`   [${i + 1}]`, JSON.stringify(summarizeHit(resultsList[i]!), null, 2));
    }
    if (resultsList.length === 0) {
      console.log("   (none)");
    }

    const mid = firstMasterId(resultsList);
    if (mid != null) {
      console.log("");
      console.log(`→ first valid master in this page (type=master, id=${mid})`);
      await probeMaster(tok, mid);
    } else {
      console.log("");
      console.log("→ no master row in result page — skipping /masters/{id} for this search");
    }
  }

  console.log("");
  console.log("Done.");
}

void main();
