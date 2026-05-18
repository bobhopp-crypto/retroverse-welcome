/**
 * Curator save smoke tests (no browser).
 * Usage: npx tsx scripts/test-curator-save-e2e.mjs [baseUrl]
 */
import { existsSync, readFileSync, rmSync } from "node:fs";
import { spawn } from "node:child_process";

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

function startDevWithoutR2(port) {
  const env = {
    ...process.env,
    PORT: String(port),
    R2_ACCOUNT_ID: "",
    R2_ACCESS_KEY_ID: "",
    R2_SECRET_ACCESS_KEY: "",
    R2_BUCKET_NAME: "",
  };
  return spawn("npm", ["run", "dev"], {
    cwd: process.cwd(),
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

async function waitForServer(baseUrl, timeoutMs = 90_000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      const res = await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok || res.status === 404) return;
    } catch {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }
  throw new Error("dev server did not become ready");
}

async function main() {
  const baseFromCli = process.argv[2]?.trim();
  await testLocalPersistModule();

  if (baseFromCli) {
    await testApi(baseFromCli, "existing-dev", "r2");
    return;
  }

  const port = 3011;
  const baseUrl = `http://localhost:${port}`;
  const child = startDevWithoutR2(port);
  let logs = "";
  child.stdout?.on("data", (d) => {
    logs += d.toString();
  });
  child.stderr?.on("data", (d) => {
    logs += d.toString();
  });
  try {
    await waitForServer(baseUrl);
    await testApi(baseUrl, "no-r2-dev", "local");
  } finally {
    child.kill("SIGTERM");
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
