/**
 * Curator save smoke tests (no browser).
 * Usage: npx tsx scripts/test-curator-save-e2e.mjs [baseUrl]
 */
import { existsSync, readFileSync } from "node:fs";

const albumId = "RVAL342687";
const stagedPath =
  "/Users/bobhopp/RETROVERSE_DATA/artwork-intake/itunes-pass/RVAL408433/test-cover.jpg";
const publicCover = `public/retroverse/covers/${albumId}/canonical.jpg`;

async function post(baseUrl, body) {
  const res = await fetch(`${baseUrl}/api/artwork-workbench/living-action`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  let json = {};
  try {
    json = JSON.parse(text);
  } catch {
    json = { parseError: true, raw: text.slice(0, 300) };
  }
  return { status: res.status, json, text };
}

async function testLocalPersistModule() {
  process.env.R2_ACCOUNT_ID = "";
  process.env.R2_ACCESS_KEY_ID = "";
  process.env.R2_SECRET_ACCESS_KEY = "";
  process.env.R2_BUCKET_NAME = "";

  const { persistCoverBytes, buildDisplayUrl } = await import("../lib/curator-cover-persist.ts");
  const { upsertCanonicalArtworkLocal, verifyCanonicalArtworkLocal } = await import(
    "../lib/local-canonical-curation.ts"
  );

  const bytes = readFileSync(stagedPath);
  const deployed = await persistCoverBytes({
    albumId,
    bytes,
    contentType: "image/jpeg",
    traceId: "e2e-local",
  });
  if (deployed.storage !== "local") throw new Error(`expected local storage, got ${deployed.storage}`);
  if (!deployed.canonicalPath.startsWith("/retroverse/covers/")) {
    throw new Error(`unexpected path ${deployed.canonicalPath}`);
  }
  if (!existsSync(publicCover)) throw new Error(`missing ${publicCover}`);

  upsertCanonicalArtworkLocal({
    albumId,
    canonicalCoverPath: deployed.canonicalPath,
    traceId: "e2e-local",
  });
  const verify = verifyCanonicalArtworkLocal(albumId, deployed.canonicalPath, "e2e-local");
  if (!verify.ok) throw new Error(verify.error);

  const displayUrl = buildDisplayUrl(deployed.canonicalPath, Date.now(), "local");
  if (!displayUrl?.startsWith(`/retroverse/covers/${albumId}/`)) {
    throw new Error(`bad displayUrl ${displayUrl}`);
  }
  console.log("[e2e] module local persist OK", { deployed, displayUrl });
}

async function testApi(baseUrl, label, expectStorage) {
  const body = {
    action: "replace_artwork",
    albumId,
    artist: "Fleetwood Mac",
    title: "Rumours",
    stagedFilePath: stagedPath,
    replaceSource: "staged",
  };
  const { status, json } = await post(baseUrl, body);
  if (status !== 200 || !json.ok) {
    throw new Error(`[${label}] API failed ${status} ${JSON.stringify(json)}`);
  }
  if (json.storage !== expectStorage) {
    throw new Error(`[${label}] expected storage=${expectStorage}, got ${json.storage}`);
  }
  if (!json.localDbVerified) throw new Error(`[${label}] localDbVerified false`);
  if (!json.displayUrl) throw new Error(`[${label}] missing displayUrl`);
  if (expectStorage === "local" && !json.displayUrl.startsWith("/retroverse/covers/")) {
    throw new Error(`[${label}] displayUrl should be site-local: ${json.displayUrl}`);
  }
  console.log(`[e2e] API ${label} OK`, {
    storage: json.storage,
    displayUrl: json.displayUrl,
    canonicalCoverPath: json.canonicalCoverPath,
  });
}

async function testRouteDirectNoR2() {
  process.env.VERCEL = "";
  process.env.CURATOR_SQLITE_DISABLED = "";
  process.env.LOCAL_RETROVERSE_DB_PATH = "";
  process.env.R2_ACCOUNT_ID = "";
  process.env.R2_ACCESS_KEY_ID = "";
  process.env.R2_SECRET_ACCESS_KEY = "";
  process.env.R2_BUCKET_NAME = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";
  process.env.CANONICAL_ARTWORK_OVERRIDES_PATH = "/dev/null/retroverse-overrides.json";

  const { POST } = await import("../app/api/artwork-workbench/living-action/route.ts");
  const req = new Request("http://local.test/api/artwork-workbench/living-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "replace_artwork",
      albumId,
      artist: "Fleetwood Mac",
      title: "Rumours",
      stagedFilePath: stagedPath,
      replaceSource: "staged",
    }),
  });
  const res = await POST(req);
  const json = await res.json();
  if (res.status !== 200 || !json.ok) {
    throw new Error(`[route-direct-no-r2] failed ${res.status} ${JSON.stringify(json)}`);
  }
  if (json.storage !== "local") throw new Error(`expected local storage, got ${json.storage}`);
  if (!json.localDbVerified) throw new Error("localDbVerified false");
  if (!json.displayUrl?.startsWith("/retroverse/covers/")) {
    throw new Error(`bad local displayUrl ${json.displayUrl}`);
  }
  console.log("[e2e] direct route no-R2 + optional override failure OK", {
    storage: json.storage,
    displayUrl: json.displayUrl,
    canonicalCoverPath: json.canonicalCoverPath,
  });
}

async function testRouteDirectServerlessSkipsSqlite() {
  process.env.VERCEL = "1";
  process.env.LOCAL_RETROVERSE_DB_PATH = "/dev/null/local-retroverse.db";
  process.env.R2_ACCOUNT_ID = "";
  process.env.R2_ACCESS_KEY_ID = "";
  process.env.R2_SECRET_ACCESS_KEY = "";
  process.env.R2_BUCKET_NAME = "";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "";

  const { POST } = await import("../app/api/artwork-workbench/living-action/route.ts");
  const req = new Request("http://local.test/api/artwork-workbench/living-action", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "replace_artwork",
      albumId,
      artist: "Fleetwood Mac",
      title: "Rumours",
      stagedFilePath: stagedPath,
      replaceSource: "staged",
    }),
  });
  const res = await POST(req);
  const json = await res.json();
  if (res.status === 500 && json.stage === "local_db_preflight") {
    throw new Error("serverless route attempted SQLite preflight");
  }
  if (res.status === 500 && json.stage === "local_db_write") {
    throw new Error("serverless route attempted SQLite write");
  }
  if (res.status !== 500 || json.stage !== "image_persist") {
    throw new Error(`expected missing R2 to fail at image_persist, got ${res.status} ${JSON.stringify(json)}`);
  }
  console.log("[e2e] direct route serverless skips SQLite OK", {
    stage: json.stage,
    message: json.message,
  });
}

async function main() {
  const baseFromCli = process.argv[2]?.trim();
  await testLocalPersistModule();

  if (baseFromCli) {
    await testApi(baseFromCli, "existing-dev", "r2");
    return;
  }

  await testRouteDirectNoR2();
  await testRouteDirectServerlessSkipsSqlite();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
